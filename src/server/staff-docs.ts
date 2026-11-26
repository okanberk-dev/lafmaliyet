import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, count, eq, inArray, isNotNull } from "drizzle-orm";

import { ALL_BRANCHES, type BranchScope } from "@/lib/branches";
import { extensionFor, sniffMime, type DocumentMime } from "@/lib/documents";
import {
  docAlerts,
  docDigestBox,
  docFileProblem,
  docInputProblem,
  freshDocAlerts,
  MAX_DOCS_PER_STAFF,
  staffDocFileName,
  supersededIds,
  type DocAlert,
  type DocDigestBox,
  type DocInput,
} from "@/lib/staff-docs";
import type { DB } from "@/server/db";
import * as s from "@/server/db/schema";
import { storedKey } from "@/server/storage/drivers";
import { storageDriver } from "@/server/storage/photos";
import { UserError } from "@/server/user-error";

/*
 * Personel belgeleri (docs/PERSONEL-BELGE.md): satır veritabanında (staff_documents), dosya fotoğraflarla aynı özel
 * depoda ("personel-belge/<yıl>/<ay>/<uuid>.<uzantı>"; src/server/storage). Dosya yalnız yöneticiye
 * /api/personel/belge/{id}'den verilir; deponun adresi hiçbir yerde görünmez. Dosyasız belge de girilir (yalnız tarih
 * takibi): depo kurulu değilse (Vercel önizlemesi) yükleme reddedilir, tarih kaydı yine yapılır.
 *
 * Çekirdekler veritabanını dışarıdan alır (tests/personel-belge-db.test.ts); yetki eylemlerde ve yollarda (requireAdmin).
 */

export const DOC_KEY_PREFIX = "personel-belge";
export const NO_DOC_STORAGE_TEXT = "Belge deposu bu ortamda kurulu değil; belgeyi dosyasız (yalnız tarihleriyle) kaydedin.";
export const DOC_NOT_FOUND_TEXT = "Belge bulunamadı; silinmiş olabilir.";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/** Ekranda gösterilen belge (dosyanın kendisi değil) */
export interface StaffDocRow {
  id: number;
  staffId: number;
  staffName: string;
  branchId: string | null;
  kind: string;
  label: string | null;
  issuedOn: string | null;
  validUntil: string | null;
  note: string | null;
  hasFile: boolean;
  contentType: string | null;
  sizeBytes: number | null;
  fileName: string | null;
  createdByName: string | null;
  createdAt: string;
  /** Aynı kişinin aynı türden daha geç biten belgesi var (yenilendi; hatırlatılmaz) */
  superseded: boolean;
}

const scopeWhere = (scope: BranchScope) => (scope === ALL_BRANCHES ? undefined : eq(s.staff.branchId, scope));

/** Kapsamdaki kişiler (Maaşlar'daki sırayla): belge ve avans ekranlarının kişi listesi */
export async function listScopeStaff(db: DB, scope: BranchScope = ALL_BRANCHES) {
  return db
    .select({ id: s.staff.id, name: s.staff.name, branchId: s.staff.branchId, startMonth: s.staff.startMonth, endMonth: s.staff.endMonth, active: s.staff.active })
    .from(s.staff)
    .where(scopeWhere(scope))
    .orderBy(asc(s.staff.sortOrder), asc(s.staff.id));
}

/** Kapsamdaki kişilerin belgeleri (kişinin adı ve şubesiyle); sıra: kişi, sonra eklenme */
export async function listStaffDocs(db: DB, scope: BranchScope = ALL_BRANCHES): Promise<StaffDocRow[]> {
  const rows = await db
    .select({
      id: s.staffDocuments.id,
      staffId: s.staffDocuments.staffId,
      staffName: s.staff.name,
      branchId: s.staff.branchId,
      kind: s.staffDocuments.kind,
      label: s.staffDocuments.label,
      issuedOn: s.staffDocuments.issuedOn,
      validUntil: s.staffDocuments.validUntil,
      note: s.staffDocuments.note,
      storageKey: s.staffDocuments.storageKey,
      contentType: s.staffDocuments.contentType,
      sizeBytes: s.staffDocuments.sizeBytes,
      fileName: s.staffDocuments.fileName,
      createdByName: s.staffDocuments.createdByName,
      createdAt: s.staffDocuments.createdAt,
    })
    .from(s.staffDocuments)
    .innerJoin(s.staff, eq(s.staff.id, s.staffDocuments.staffId))
    .where(scopeWhere(scope))
    .orderBy(asc(s.staff.sortOrder), asc(s.staff.id), asc(s.staffDocuments.id));
  const old = supersededIds(rows);
  return rows.map(({ storageKey, createdAt, ...r }) => ({ ...r, hasFile: Boolean(storageKey), createdAt: createdAt.toISOString(), superseded: old.has(r.id) }));
}

/**
 * Bitmiş ya da 30 gün içinde bitecek, yenilenmemiş, kişisi çalışan belgeler (src/lib/staff-docs.ts docAlerts). Bütün
 * belgeler okunur: süresiz (bitişi boş) bir yenisi de aynı türün eskisini yeniler (supersededIds).
 */
export async function loadDocAlerts(db: DB, today: string, scope: BranchScope = ALL_BRANCHES): Promise<DocAlert[]> {
  const facts = await db
    .select({
      id: s.staffDocuments.id,
      staffId: s.staffDocuments.staffId,
      staffName: s.staff.name,
      staffEndMonth: s.staff.endMonth,
      staffActive: s.staff.active,
      branchId: s.staff.branchId,
      kind: s.staffDocuments.kind,
      label: s.staffDocuments.label,
      validUntil: s.staffDocuments.validUntil,
    })
    .from(s.staffDocuments)
    .innerJoin(s.staff, eq(s.staff.id, s.staffDocuments.staffId))
    .where(scopeWhere(scope));
  return docAlerts(facts, today);
}

/**
 * Sabah e-postasının kutusu (src/server/notify/digest-extras.ts): yalnız daha önce bildirilmemiş aşamalar (bitişe 30
 * gün kala bir kez, bitince bir kez; anahtar notification_log'da). Yeni haber yoksa null.
 */
export async function loadDocDigest(db: DB, today: string, scope: BranchScope = ALL_BRANCHES): Promise<{ box: DocDigestBox; logKeys: string[] } | null> {
  const alerts = await loadDocAlerts(db, today, scope);
  if (!alerts.length) return null;
  const keys = alerts.map((a) => a.key);
  const sent = new Set((await db.select({ key: s.notificationLog.key }).from(s.notificationLog).where(inArray(s.notificationLog.key, keys))).map((r) => r.key));
  const fresh = freshDocAlerts(alerts, sent);
  const box = docDigestBox(fresh, today);
  return box ? { box, logKeys: fresh.map((a) => a.key) } : null;
}

export interface DocFile {
  bytes: Uint8Array;
  /** Kullanıcının dosyasının adı (yalnız gösterim için) */
  name: string | null;
}

const cleanFileName = (v: string | null) =>
  v
    ? v
        .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "")
        .trim()
        .slice(0, 120) || null
    : null;

const cleanText = (v: string | null | undefined, max: number) => (v ? v.replace(/\s+/g, " ").trim().slice(0, max) || null : null);

export interface NewStaffDoc extends DocInput {
  staffId: number;
  note?: string | null;
}

/** Dosyanın türü ve hatası (tür içerikten; tarayıcının söylediğine güvenilmez) */
function checkedFile(file: DocFile): DocumentMime {
  const mime = sniffMime(file.bytes);
  const problem = docFileProblem(file.bytes.length, mime);
  if (problem) throw new UserError(problem);
  return mime!;
}

/**
 * Belge ekler. Dosya verildiyse önce depoya yazılır, sonra satır; satır yazılamazsa dosya geri silinir. Kişi başına en
 * çok MAX_DOCS_PER_STAFF belge.
 */
export async function addStaffDoc(db: DB, me: { id: number; name: string }, input: NewStaffDoc, file: DocFile | null, now = new Date()): Promise<{ id: number; staffName: string }> {
  const problem = docInputProblem(input);
  if (problem) throw new UserError(problem);
  const [person] = await db.select({ id: s.staff.id, name: s.staff.name }).from(s.staff).where(eq(s.staff.id, input.staffId)).limit(1);
  if (!person) throw new UserError("Kişi bulunamadı; sayfayı yenileyin.");
  const [{ n }] = await db.select({ n: count() }).from(s.staffDocuments).where(eq(s.staffDocuments.staffId, input.staffId));
  if (n >= MAX_DOCS_PER_STAFF) throw new UserError(`${person.name} için en çok ${MAX_DOCS_PER_STAFF} belge saklanır; eskilerini silin.`);
  let stored: { key: string; mime: DocumentMime; size: number; name: string | null } | null = null;
  if (file) {
    const mime = checkedFile(file);
    const driver = storageDriver();
    if (!driver) throw new UserError(NO_DOC_STORAGE_TEXT);
    const key = storedKey(DOC_KEY_PREFIX, now, randomUUID(), extensionFor(mime) as "pdf" | "jpg" | "png" | "webp");
    await driver.put(key, file.bytes, mime);
    stored = { key, mime, size: file.bytes.length, name: cleanFileName(file.name) };
  }
  try {
    const [row] = await db
      .insert(s.staffDocuments)
      .values({
        staffId: input.staffId,
        kind: input.kind,
        label: cleanText(input.label, 80),
        issuedOn: input.issuedOn || null,
        validUntil: input.validUntil || null,
        note: cleanText(input.note, 300),
        storageKey: stored?.key ?? null,
        contentType: stored?.mime ?? null,
        sizeBytes: stored?.size ?? null,
        fileName: stored?.name ?? null,
        createdBy: me.id,
        createdByName: me.name,
      })
      .returning({ id: s.staffDocuments.id });
    return { id: row.id, staffName: person.name };
  } catch (e) {
    if (stored) await storageDriver()?.del([stored.key]).catch(() => {});
    throw e;
  }
}

/** Belgenin tarihlerini, türünü, adını ve notunu düzeltir (dosya değişmez; yeni dosya için yeni belge eklenir) */
export async function updateStaffDoc(db: DB, id: number, input: DocInput & { note?: string | null }): Promise<{ staffName: string }> {
  const problem = docInputProblem(input);
  if (problem) throw new UserError(problem);
  const [row] = await db
    .update(s.staffDocuments)
    .set({ kind: input.kind, label: cleanText(input.label, 80), issuedOn: input.issuedOn || null, validUntil: input.validUntil || null, note: cleanText(input.note, 300) })
    .where(eq(s.staffDocuments.id, id))
    .returning({ staffId: s.staffDocuments.staffId });
  if (!row) throw new UserError(DOC_NOT_FOUND_TEXT);
  const [person] = await db.select({ name: s.staff.name }).from(s.staff).where(eq(s.staff.id, row.staffId)).limit(1);
  return { staffName: person?.name ?? "" };
}

/**
 * Belgeyi siler: önce dosya (depo silemezse hata, satır kalır), sonra satır. Silinen belgenin bilgisi döner (işlem
 * geçmişi için).
 */
export async function deleteStaffDoc(db: DB, id: number): Promise<{ staffName: string; kind: string; label: string | null }> {
  const [row] = await db
    .select({ key: s.staffDocuments.storageKey, kind: s.staffDocuments.kind, label: s.staffDocuments.label, staffName: s.staff.name })
    .from(s.staffDocuments)
    .innerJoin(s.staff, eq(s.staff.id, s.staffDocuments.staffId))
    .where(eq(s.staffDocuments.id, id))
    .limit(1);
  if (!row) throw new UserError(DOC_NOT_FOUND_TEXT);
  if (row.key) {
    const driver = storageDriver();
    if (!driver) throw new UserError("Belge deposu bu ortamda kurulu değil; dosyalı belge buradan silinemez.");
    await driver.del([row.key]);
  }
  await db.delete(s.staffDocuments).where(eq(s.staffDocuments.id, id));
  return { staffName: row.staffName, kind: row.kind, label: row.label };
}

/** Belgenin dosyası: satır ya da dosya yoksa null; depo yoksa UserError */
export async function readStaffDocFile(db: DB, id: number): Promise<{ bytes: Uint8Array; contentType: string; fileName: string } | null> {
  const [row] = await db
    .select({
      key: s.staffDocuments.storageKey,
      contentType: s.staffDocuments.contentType,
      kind: s.staffDocuments.kind,
      label: s.staffDocuments.label,
      validUntil: s.staffDocuments.validUntil,
      staffName: s.staff.name,
    })
    .from(s.staffDocuments)
    .innerJoin(s.staff, eq(s.staff.id, s.staffDocuments.staffId))
    .where(eq(s.staffDocuments.id, id))
    .limit(1);
  if (!row?.key || !row.contentType) return null;
  const driver = storageDriver();
  if (!driver) throw new UserError(NO_DOC_STORAGE_TEXT);
  const bytes = await driver.get(row.key);
  if (!bytes) return null;
  return { bytes, contentType: row.contentType, fileName: staffDocFileName(row, row.contentType as DocumentMime) };
}

/** Silinecek kişilerin belge dosyalarının anahtarları (kişi silme işleminin içinde okunur, işlemden sonra silinir) */
export async function staffDocKeys(tx: Tx | DB, staffIds: number[]): Promise<string[]> {
  if (!staffIds.length) return [];
  const rows = await tx
    .select({ key: s.staffDocuments.storageKey })
    .from(s.staffDocuments)
    .where(and(inArray(s.staffDocuments.staffId, staffIds), isNotNull(s.staffDocuments.storageKey)));
  return rows.map((r) => r.key!).filter(Boolean);
}

/** Kişi silindikten sonra (satırlar cascade ile gitti) dosyalar: silinemezse günlüğe yazılır, kayıt bozulmaz */
export async function dropStaffDocFiles(keys: string[]): Promise<void> {
  if (!keys.length) return;
  try {
    await storageDriver()?.del(keys);
  } catch (e) {
    console.error("[personel-belge] silinen kişinin dosyaları silinemedi", keys.length, e instanceof Error ? e.message : e);
  }
}
