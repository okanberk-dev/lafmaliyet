import "server-only";

import { randomUUID } from "node:crypto";
import { join } from "node:path";

import * as blob from "@vercel/blob";
import { and, asc, count, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";

import { sniffMime } from "@/lib/documents";
import { daysFrom, imageSize, isPhotoKind, MAX_PHOTO_BYTES, photoExt, RELEASED_DAYS, sizeProblem, UNLINKED_DAYS, type PhotoKind, type PhotoMime } from "@/lib/photo-rules";
import { isScanKind, type ScanInfo } from "@/lib/photo-scan";
import { getDb, schema as s } from "@/server/db";

import { blobDriver, fsDriver, photoKey, type PhotoDriver } from "./drivers";

/*
 * Fotoğraf deposu (sözleşme: docs/planlar/CRITIQUE2.md R9; kontrol listeleri de kullanır). Satır veritabanında, dosya
 * sürücüde. Her yükleme bağlanmamış başlar ve 2 günde silinir; onu kullanan kayıt kendi işleminde keepPhoto ile bağlar.
 * Kontroller (boyut, tür, ölçü) savePhoto'da: yollar yinelemez. Süresi dolanları sabah işi siler (cleanupPhotos).
 * Sürücü ortamdan: BLOB_READ_WRITE_TOKEN → özel Blob; yoksa Vercel'de (önizlemeler canlının veritabanını paylaşır,
 * atılacak bir dosya sistemine işaret eden satır yazmasın) depo yok ve fotoğraf düğmeleri görünmez; yerelde .data/photos.
 * Taranarak yüklenen belgenin iki dosyası olur (docs/FOTOGRAF.md › Belge tarama): taranmış hâl (`storage_key`; okunan
 * ve gösterilen) ve küçültülmüş asıl fotoğraf (`original_key`); ikisi birlikte yazılır, birlikte silinir.
 */

export { PHOTO_KINDS, type PhotoKind } from "@/lib/photo-rules";

/** Yolların durum koduyla döndüğü hata (metni personele gösterilir) */
export class PhotoError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface PhotoRow {
  id: number;
  kind: PhotoKind;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  linkedAt: Date | null;
  /** Asıl fotoğrafın boyutu; null: taranmadan yüklendi (asıl hâli yok) */
  originalSize: number | null;
}

/** Fotoğrafın iki hâli: gösterilen (taranmış ya da taranmadan yüklenen tek hâl) ve taranan belgenin asıl fotoğrafı */
export type PhotoVariant = "goster" | "asil";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const NO_STORAGE_TEXT = "Fotoğraf deposu bu ortamda kurulu değil.";
export const NOT_FOUND_TEXT = "Fotoğraf bulunamadı; silinmiş ya da saklama süresi dolmuş olabilir.";

let testDriver: PhotoDriver | null | undefined;

/** Testler bellek sürücüsü verir (undefined: ortamdan seçilir) */
export function __setPhotoDriverForTests(d: PhotoDriver | null | undefined) {
  testDriver = d;
}

function selectDriver(): PhotoDriver | null {
  if (testDriver !== undefined) return testDriver;
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (token) return blobDriver(blob, token);
  // Vercel'in yeni bağlantısı anahtar yerine mağaza kimliği + OIDC verebilir; SDK kendisi çözer
  if (process.env.VERCEL) return process.env.BLOB_STORE_ID?.trim() ? blobDriver(blob) : null;
  return fsDriver(process.env.PHOTO_DIR?.trim() || join(process.cwd(), ".data", "photos"));
}

/** Depo hangisi ve fotoğraf eklenebilir mi (değilse fotoğraf düğmeleri hiç görünmez) */
export function photoStorage(): { driver: PhotoDriver["name"] | "none"; available: boolean } {
  const d = selectDriver();
  return { driver: d?.name ?? "none", available: d !== null };
}

const rowColumns = {
  id: s.photos.id,
  kind: s.photos.kind,
  contentType: s.photos.contentType,
  sizeBytes: s.photos.sizeBytes,
  width: s.photos.width,
  height: s.photos.height,
  createdBy: s.photos.createdBy,
  createdByName: s.photos.createdByName,
  createdAt: s.photos.createdAt,
  expiresAt: s.photos.expiresAt,
  linkedAt: s.photos.linkedAt,
  originalSize: s.photos.originalSize,
};

/** Asıl fotoğrafın türü anahtarın uzantısından (photoKey yalnız üç uzantı üretir) */
export function mimeOfKey(key: string): PhotoMime {
  return key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : "image/jpeg";
}

/** Görselin denetimi: boyut, içerikten tür (gönderilen türle aynı olmalı), ölçü; tutmazsa PhotoError */
function checkImage(bytes: Uint8Array, contentType: PhotoMime, what: "Fotoğraf" | "Asıl fotoğraf"): PhotoMime {
  if (!bytes.length) throw new PhotoError(`${what} boş; yeniden çekin.`, 400);
  if (bytes.length > MAX_PHOTO_BYTES) throw new PhotoError(`${what} 2 MB'tan büyük; uygulama küçültemedi, yeniden deneyin.`, 413);
  const mime = sniffMime(bytes);
  if (!mime || mime === "application/pdf" || mime !== contentType) throw new PhotoError("Yalnız JPG, PNG ya da WebP fotoğraf eklenebilir.", 415);
  const problem = sizeProblem(imageSize(bytes));
  if (problem) throw new PhotoError(problem, 400);
  return contentType;
}

/**
 * Fotoğrafı saklar: boyut (≤ 2 MB), içerikten tür (JPG, PNG, WebP; PDF ve HEIC değil) ve ölçü (200–4096 px) burada
 * denetlenir. Önce dosya(lar) yazılır, sonra satır; satır yazılamazsa dosyalar geri silinir. `expiresAt`: verilmezse 2
 * gün (bağlanmamış), null süresiz. Taranan belgede (`original`; yalnız taranan türler) `bytes` taranmış hâldir,
 * `original` küçültülmüş asıl fotoğraf; ikisi de aynı denetimden geçer. `scan`: taramanın bilgisi (parseScanInfo'dan).
 */
export async function savePhoto(input: {
  kind: PhotoKind;
  bytes: Uint8Array;
  contentType: PhotoMime;
  userId: number;
  expiresAt?: Date | null;
  original?: { bytes: Uint8Array; contentType: PhotoMime } | null;
  scan?: ScanInfo | null;
}): Promise<{ id: number }> {
  const driver = selectDriver();
  if (!driver) throw new PhotoError(NO_STORAGE_TEXT, 503);
  if (!isPhotoKind(input.kind)) throw new PhotoError("Geçersiz fotoğraf türü.", 400);
  if (input.original && !isScanKind(input.kind)) throw new PhotoError("Bu fotoğraf türü taranmaz.", 400);
  const mime = checkImage(input.bytes, input.contentType, "Fotoğraf");
  const original = input.original ? { bytes: input.original.bytes, mime: checkImage(input.original.bytes, input.original.contentType, "Asıl fotoğraf") } : null;
  const size = imageSize(input.bytes);
  const db = getDb();
  const now = new Date();
  const key = photoKey(input.kind, now, randomUUID(), photoExt(mime));
  const originalKey = original ? photoKey(input.kind, now, randomUUID(), photoExt(original.mime)) : null;
  const [user] = await db.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, input.userId)).limit(1);
  const written: string[] = [];
  try {
    await driver.put(key, input.bytes, mime);
    written.push(key);
    if (original && originalKey) {
      await driver.put(originalKey, original.bytes, original.mime);
      written.push(originalKey);
    }
    const [row] = await db
      .insert(s.photos)
      .values({
        kind: input.kind,
        storageKey: key,
        contentType: mime,
        sizeBytes: input.bytes.length,
        width: size?.width ?? null,
        height: size?.height ?? null,
        createdBy: input.userId,
        createdByName: user?.name ?? null,
        expiresAt: input.expiresAt === undefined ? daysFrom(now, UNLINKED_DAYS) : input.expiresAt,
        originalKey,
        originalSize: original ? original.bytes.length : null,
        scan: input.scan ?? null,
      })
      .returning({ id: s.photos.id });
    return row;
  } catch (e) {
    if (written.length) await driver.del(written).catch(() => {});
    throw e;
  }
}

/** Fotoğrafın satırı (dosyası değil); yoksa null */
export async function getPhoto(id: number, tx?: Tx): Promise<PhotoRow | null> {
  const [row] = await (tx ?? getDb()).select(rowColumns).from(s.photos).where(eq(s.photos.id, id)).limit(1);
  return row ?? null;
}

/**
 * Fotoğrafın baytları: satır yoksa, süresi dolmuşsa ya da dosya yoksa null; depo yoksa PhotoError 503. `variant`
 * "asil": taranan belgenin asıl fotoğrafı (taranmadan yüklenende null)
 */
export async function readPhoto(id: number, variant: PhotoVariant = "goster"): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const [row] = await getDb()
    .select({ key: s.photos.storageKey, originalKey: s.photos.originalKey, contentType: s.photos.contentType, expiresAt: s.photos.expiresAt })
    .from(s.photos)
    .where(eq(s.photos.id, id))
    .limit(1);
  if (!row || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) return null;
  const key = variant === "asil" ? row.originalKey : row.key;
  if (!key) return null;
  const driver = selectDriver();
  if (!driver) throw new PhotoError(NO_STORAGE_TEXT, 503);
  const bytes = await driver.get(key);
  return bytes ? { bytes, contentType: variant === "asil" ? mimeOfKey(key) : row.contentType } : null;
}

/** Bağlanmamış kasa fotoğrafının türü (Z bölümüne okutulan POS fişi Kart bölümüne geçince) */
export async function setPhotoKind(id: number, kind: PhotoKind): Promise<void> {
  await getDb()
    .update(s.photos)
    .set({ kind })
    .where(and(eq(s.photos.id, id), isNull(s.photos.linkedAt)));
}

/** Fotoğrafı bir kayda bağlar: linked_at = şimdi, expires_at = until (null: süresiz). tx verilirse onun içinde */
export async function keepPhoto(id: number, until: Date | null, tx?: Tx): Promise<void> {
  await (tx ?? getDb()).update(s.photos).set({ linkedAt: new Date(), expiresAt: until }).where(eq(s.photos.id, id));
}

/**
 * Onay bekleyen bir isteğin tuttuğu fotoğraf (geç kasa raporu, kasadan çıkan isteği): bağlanmaz, süresi kalkar
 * (expires_at boş; istek beklerken silinmez). İstek karara bağlanınca ya onayda bağlanır ya da bırakılır (releasePhoto).
 * Bağlanmış fotoğrafa dokunulmaz. Tutulan fotoğraf başka bir isteğe ya da kayda bağlanamaz: her bağlama yolu
 * src/server/staff-requests/core.ts assertNotHeld çağırır.
 */
export async function holdPhoto(tx: Tx, id: number): Promise<void> {
  await tx
    .update(s.photos)
    .set({ expiresAt: null })
    .where(and(eq(s.photos.id, id), isNull(s.photos.linkedAt)));
}

/** Bağı kalkan fotoğraf: `days` gün sonra silinir (geri alma payı), yeniden bağlanabilir */
export async function releasePhoto(id: number, days = RELEASED_DAYS, tx?: Tx): Promise<void> {
  await (tx ?? getDb()).update(s.photos).set({ linkedAt: null, expiresAt: daysFrom(new Date(), days) }).where(eq(s.photos.id, id));
}

/**
 * Fotoğrafı hemen siler: önce dosya(lar: taranmış ve asıl hâl), sonra satır (bağları: kasa raporu bağı silinir,
 * kasadan çıkan / harcama / okuma kayıtlarında boşalır; okumanın sonucu da silinir, maliyet satırı kalır). Satır yoksa
 * bir şey yapmaz; dosya silinemezse hata atar (satır kalır, sabah işi yeniden dener).
 */
export async function deletePhoto(id: number): Promise<void> {
  const db = getDb();
  const [row] = await db.select({ key: s.photos.storageKey, originalKey: s.photos.originalKey }).from(s.photos).where(eq(s.photos.id, id)).limit(1);
  if (!row) return;
  const driver = selectDriver();
  if (!driver) throw new PhotoError(NO_STORAGE_TEXT, 503);
  await driver.del(keysOf(row));
  await db.transaction(async (tx) => {
    await tx.update(s.aiCalls).set({ result: null }).where(eq(s.aiCalls.photoId, id));
    await tx.delete(s.photos).where(eq(s.photos.id, id));
  });
}

/** Satırın depodaki dosyaları: taranmış (ya da tek) hâl ve varsa asıl fotoğraf */
function keysOf(row: { key: string; originalKey: string | null }): string[] {
  return row.originalKey ? [row.key, row.originalKey] : [row.key];
}

/**
 * Sabah işi: süresi dolan fotoğrafları siler (önce depo, tek çağrıda, taranan belgenin asıl fotoğrafıyla; sonra satırlar ve okumalarının sonucu: fişteki
 * ad, tarih ve kalemler fotoğraftan uzun kalmaz). En çok `limit` adet; `deadlineAt` geçtiyse başlamaz. Depo yoksa
 * `off`. Silinemeyen dosyanın satırı kalır, ertesi sabah yeniden denenir.
 */
export async function cleanupPhotos(opts: { limit?: number; deadlineAt?: number } = {}): Promise<{ deleted: number; failed: number; off: boolean }> {
  const driver = selectDriver();
  if (!driver) return { deleted: 0, failed: 0, off: true };
  if (opts.deadlineAt !== undefined && Date.now() >= opts.deadlineAt) return { deleted: 0, failed: 0, off: false };
  const db = getDb();
  const now = new Date();
  const rows = await db
    .select({ id: s.photos.id, key: s.photos.storageKey, originalKey: s.photos.originalKey })
    .from(s.photos)
    .where(lt(s.photos.expiresAt, now))
    .orderBy(asc(s.photos.expiresAt))
    .limit(Math.max(1, Math.min(opts.limit ?? 100, 1000)));
  if (!rows.length) return { deleted: 0, failed: 0, off: false };
  try {
    await driver.del(rows.flatMap(keysOf));
  } catch (e) {
    console.error("[foto] temizlik: depo silemedi", e instanceof Error ? e.message : e);
    return { deleted: 0, failed: rows.length, off: false };
  }
  const expired = and(inArray(s.photos.id, rows.map((r) => r.id)), lt(s.photos.expiresAt, now));
  const gone = await db.transaction(async (tx) => {
    await tx
      .update(s.aiCalls)
      .set({ result: null })
      .where(inArray(s.aiCalls.photoId, tx.select({ id: s.photos.id }).from(s.photos).where(expired)));
    return tx.delete(s.photos).where(expired).returning({ id: s.photos.id });
  });
  return { deleted: gone.length, failed: 0, off: false };
}

/** Ayarlar › Fotoğraftan okuma: kaç fotoğraf, toplam boyut (taranan belgenin asıl fotoğrafı dahil), bağlanmamış (bırakılmış formdan) kaç tane */
export async function photoStorageStats(): Promise<{ count: number; bytes: number; unlinked: number }> {
  const [row] = await getDb()
    .select({
      count: count(),
      bytes: sql<number>`coalesce(sum(${s.photos.sizeBytes} + coalesce(${s.photos.originalSize}, 0)), 0)`.mapWith(Number),
      unlinked: sql<number>`count(*) filter (where ${s.photos.linkedAt} is null)`.mapWith(Number),
    })
    .from(s.photos);
  return { count: row?.count ?? 0, bytes: row?.bytes ?? 0, unlinked: row?.unlinked ?? 0 };
}

/** Kişinin son bir saatteki yüklemeleri (saatte 30 sınırı) */
export async function recentUploads(userId: number): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(s.photos)
    .where(and(eq(s.photos.createdBy, userId), gte(s.photos.createdAt, new Date(Date.now() - 3600_000))));
  return row?.n ?? 0;
}

/** Bağlanmamış ve süresi dolmamış mı (kayda bağlanabilir mi) */
export function linkable(p: PhotoRow, now = new Date()): boolean {
  return p.linkedAt === null && (p.expiresAt === null || p.expiresAt.getTime() > now.getTime());
}

