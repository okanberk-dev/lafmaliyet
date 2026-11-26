import "server-only";

import { eq } from "drizzle-orm";

import { LAFPOS_GROUP } from "@/lib/branch-settings/groups";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "@/lib/karaoke/signature";
import { staffBlindDay } from "@/lib/lafpos/kor-kasa";
import { lafposSecretFrom, lafposSecretProblem } from "@/lib/lafpos/request";
import { branchSwitchDay, isLafposDay, lafposBranchOf } from "@/lib/lafpos/switch";
import { resolveBranchSetting } from "@/server/branch-settings";

import { getDb, schema as s, type DB } from "../db";

/**
 * LafPOS'un şubesinin sunucu okuyucusu (şube kapsamı B6; docs/LAFPOS.md › Şubeler): kütükte kasa kaynağı LafPOS olan
 * etkin fiziksel şube, yoksa geri düşüş `LAFPOS_BRANCH_ID` (saf kural `lafposBranchOf`, src/lib/lafpos/switch.ts).
 * Gün sonunun yazıldığı şube, geçiş gününün kasası, LafPOS'un fotoğraf, kasadan çıkan ve devir uçları bunu okur.
 *
 * Önbellekli: değer kurulumun tamamı için tektir ve yalnız Şubeler'de kasa kaynağı değişince değişir; kasanın her
 * gönderimi, zil ve gün sonu otomasyonu ayrı sorgu atmasın diye bağlantı (ya da işlem) başına `LAFPOS_BRANCH_CACHE_MS` boyunca
 * saklanır. Şube eylemleri (src/server/actions/branches.ts) yazınca `forgetLafposBranch` ile hemen düşer; başka bir
 * sunucu örneğinde en geç `CACHE_MS` sonra yenilenir. İşlemin (`tx`) içinden okunan değer o işlemin kendi okumasıdır.
 */

type Reader = Pick<DB, "select">;

/** Önbelleğin süresi: kasa kaynağı değiştikten sonra başka sunucu örneklerinin en geç bu kadar eski değeri görür */
export const LAFPOS_BRANCH_CACHE_MS = 60_000;

let cache = new WeakMap<object, { at: number; id: string }>();

/** LafPOS'un şubesi (türetilmiş; önbellekli). `now` testler için; `fresh`: önbelleğe bakmadan kütükten (anahtarın güncelliği) */
export async function lafposBranchId(db: Reader = getDb(), now: number = Date.now(), fresh = false): Promise<string> {
  const hit = fresh ? undefined : cache.get(db);
  if (hit && now - hit.at < LAFPOS_BRANCH_CACHE_MS) return hit.id;
  const rows = await db.select({ id: s.branches.id, kind: s.branches.kind, posSource: s.branches.posSource, active: s.branches.active, sortOrder: s.branches.sortOrder, name: s.branches.name }).from(s.branches);
  // Kütüğün sırası (sortBranches ile aynı: sıra, sonra ad): birden çok LafPOS şubesinde seçim sabit kalsın
  rows.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "tr"));
  const id = lafposBranchOf(rows);
  cache.set(db, { at: now, id });
  return id;
}

/** Önbelleği düşürür (şube eklendi, kasa kaynağı ya da durumu değişti, şube silindi) */
export function forgetLafposBranch(): void {
  cache = new WeakMap();
  forgetLafposSecret();
}

/**
 * LafPOS'a geçiş günü: LafPOS'un şubesinin şube ayarı (grup `pos.lafpos`; docs/SUBE.md › Şube başına ayarlar). Satırı
 * yokken eski genel kayıt (settings › lafposGecisGunu) yalnız Marina'nındır: kasa kaynağı başka şubeye geçerse o şube
 * kendi gününü alır, Marina'nın günü ona geçmez. Panelin geçiş gününü okuyan her yer bunu çağırır (status.ts
 * loadLafposSwitchDay ve lafpos-ikram.ts lafposSwitchDayOf da buna iner; tests/sube-ayarlari-2.test.ts kilitler)
 */
export async function lafposSwitchDay(db: Reader = getDb()): Promise<string | null> {
  return switchDayOf(await lafposBranchId(db), db);
}

/**
 * Kör kasa (bulgu 0; src/lib/lafpos/kor-kasa.ts): bu kasanın bu günü personele kör mü (LafPOS'un şubesi, geçiş gününden
 * itibaren). Geç raporun açılış önerisi ve açılış ↔ devir denetimi önceki halkanın günü için sorar: kör günün devri
 * (sayılan − teslim) personele gitmez. İşlemin içinden de okunur
 */
export async function staffBlindOn(date: string, branchId: string, db: Reader = getDb()): Promise<boolean> {
  const [branch, switchDay] = await Promise.all([lafposBranchId(db), lafposSwitchDay(db)]);
  return staffBlindDay({ admin: false, branchId, lafposDay: isLafposDay(date, switchDay), lafposBranch: branch });
}

/**
 * Verilen şubenin LafPOS geçiş günü (şube ayarı pos.lafpos). Gün sonunu yazan ve silen işlem bunu yazdığı şubeyle çağırır:
 * şube bir kez okunur, geçiş günü aynı şubeninki olur (işlemin içinde şube yeniden türetilip başka şubeye düşmez)
 */
export async function switchDayOf(branchId: string, db: Reader = getDb()): Promise<string | null> {
  return (await resolveBranchSetting(LAFPOS_GROUP, branchId, db)).value.switchDay;
}

/**
 * Bir şubenin kasasının geçiş günü (branchSwitchDay, türetilmiş LafPOS şubesiyle): geçiş günü ve LafPOS'un şubesi
 * birlikte okunur. Tek kasanın gününe bakan sunucu okumaları bunu çağırır
 */
export async function loadBranchSwitchDay(branchId: string | null | undefined, db: Reader = getDb()): Promise<string | null> {
  const [day, lafposBranch] = await Promise.all([lafposSwitchDay(db), lafposBranchId(db)]);
  return branchSwitchDay(day, branchId, lafposBranch);
}

/**
 * Şube LafPOS'u kullanıyor mu: geçiş günü var ya da kayıtlı LafPOS günü var. Geri düşüşle LafPOS'un şubesi olan şube
 * (kütükte kaynağı ModPOS) kullanıyorsa kasa kaynağı başka şubede LafPOS yapılamaz (lafposSourceError; Şubeler eylemleri)
 */
export async function lafposInUse(branchId: string, db: Reader = getDb()): Promise<boolean> {
  const [day, [row]] = await Promise.all([
    switchDayOf(branchId, db),
    db.select({ date: s.posDayReports.date }).from(s.posDayReports).where(eq(s.posDayReports.branchId, branchId)).limit(1),
  ]);
  return !!day || !!row;
}

type Env = Record<string, string | undefined>;

/**
 * LafPOS'un anahtarının ortamı: LafPOS'un şubesinin Şube ayarları'nda saklanan anahtar (şifreli; açılamıyorsa yok
 * sayılır) ortamdaki LAFPOS_SYNC_SECRET'ın önüne geçer. Yoksa ortam olduğu gibi (bugünkü kurulum hiçbir şey yapmadan
 * çalışır). `source`: kullanılan anahtar nereden ("panel", "ortam"; anahtar yoksa null)
 */
export async function lafposSecretEnv(db: Reader = getDb(), env: Env = process.env): Promise<{ env: Env; source: "panel" | "ortam" | null }> {
  const branch = await lafposBranchId(db);
  const stored = (await resolveBranchSetting(LAFPOS_GROUP, branch, db)).value.secret;
  if (stored) return { env: { ...env, LAFPOS_SYNC_SECRET: stored }, source: "panel" };
  return { env, source: env.LAFPOS_SYNC_SECRET?.trim() ? "ortam" : null };
}

let secretCache = new WeakMap<object, { at: number; stored: string | null }>();

/**
 * Anahtarın okunuşu: anahtar (yoksa null), önbelleğe yazıldığı an ve bu çağrıda veritabanından mı okundu (`fresh`).
 * Veritabanından okunurken LafPOS'un şubesi de kütükten taze okunur (anahtar şubenin ayarı). `force`: önbelleğe
 * bakılmaz. Veritabanı okunamazsa null
 */
async function secretEntry(db: Reader, env: Env, now: number, force = false): Promise<{ secret: string | null; at: number; fresh: boolean } | null> {
  const hit = force ? undefined : secretCache.get(db);
  let entry: { at: number; stored: string | null };
  let fresh = false;
  if (hit && now - hit.at < LAFPOS_BRANCH_CACHE_MS) entry = hit;
  else {
    try {
      entry = { at: now, stored: (await resolveBranchSetting(LAFPOS_GROUP, await lafposBranchId(db, now, true), db)).value.secret ?? null };
    } catch (e) {
      console.error("[lafpos] anahtar okunamadı", e);
      return null;
    }
    secretCache.set(db, entry);
    fresh = true;
  }
  return { secret: lafposSecretFrom(entry.stored ? { ...env, LAFPOS_SYNC_SECRET: entry.stored } : env), at: entry.at, fresh };
}

/**
 * LafPOS'un anahtarı (panelde saklanan, yoksa ortamdaki; en az 32 karakter, sitenin anahtarından ayrı); yoksa null (uçlar
 * 503). Önbellekli (`LAFPOS_BRANCH_CACHE_MS`; bu sunucu örneğinde anahtar kaydedilince ya da kasa kaynağı değişince
 * hemen düşer): imzasız istek her seferinde veritabanını okutmaz. Veritabanı okunamazsa null: uç 500 değil 503 döner
 * (anahtar okunamadı, istek kabul edilmez). İmzalı uçlar isteği kabul etmeden önce `lafposRequestSecret` ile okur:
 * önbellek yalnız ön süzgeçtir, döndürülen eski anahtar başka bir sunucu örneğinde de hemen geçmez
 */
export async function lafposSecret(db: Reader = getDb(), env: Env = process.env, now: number = Date.now()): Promise<string | null> {
  return (await secretEntry(db, env, now))?.secret ?? null;
}

/**
 * İmzası tutmayan istekte anahtar önbellekten en çok bu sıklıkla yeniden okunur (sunucu örneği başına): başka bir
 * örnekte kaydedilen yeni anahtar 60 sn değil en geç bu kadar sonra kabul edilir; imzasız istek yağmuru veritabanını
 * bundan sık okutamaz
 */
export const LAFPOS_SECRET_RELOAD_MS = 10_000;

/**
 * İmzalı LafPOS isteğinin denetleneceği anahtar (döndürülen anahtar her sunucu örneğinde hemen geçersiz; güvenlik notu
 * 26 Kasım 2026, docs/LAFPOS.md). Önbellekteki anahtar yalnız ön süzgeçtir:
 *
 * - İmza önbellekteki anahtarla **tutuyorsa** anahtar kabulden önce veritabanından (LafPOS'un şubesi dahil, önbelleksiz)
 *   yeniden okunur ve o döner. Anahtar başka bir örnekte döndürüldüyse uç yeni anahtarla denetler: eski anahtarla
 *   imzalanmış istek 401 alır, önbellek de yenilenir. Bu okuma yalnız imzası tutan (LafPOS'un kendi) isteklerinde
 *   olur; uçların her biri zaten veritabanında iş yapar.
 * - İmza **tutmuyorsa** önbellekteki anahtar döner (uç 401 verir, veritabanı okunmaz); önbellek
 *   `LAFPOS_SECRET_RELOAD_MS`'tan eskiyse bir kez yeniden okunur (yeni anahtarla imzalanmış istek beklemeden geçsin).
 * - Anahtar bu çağrıda zaten veritabanından okunduysa yeniden okunmaz.
 *
 * Uç dönen anahtarla `checkLafposRequest`'i her zamanki gibi çağırır (imza bir kez daha denetlenir).
 */
export async function lafposSecretFor(
  req: { method: string; url: URL; body: string; timestamp: string | null; signature: string | null },
  db: Reader = getDb(),
  env: Env = process.env,
  now: number = Date.now(),
): Promise<string | null> {
  const first = await secretEntry(db, env, now);
  if (!first) return null;
  if (first.fresh) return first.secret;
  const signed = first.secret !== null && verifySignature(first.secret, { ...req, now });
  if (signed || now - first.at >= LAFPOS_SECRET_RELOAD_MS) return (await secretEntry(db, env, now, true))?.secret ?? null;
  return first.secret;
}

/** Yol işleyicisinin isteğinden `lafposSecretFor` (GET gövdesiz; POST'ta okunan gövde verilir) */
export function lafposRequestSecret(request: Request, body = ""): Promise<string | null> {
  return lafposSecretFor({
    method: request.method,
    url: new URL(request.url),
    body,
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
  });
}

/** Anahtarın önbelleğini düşürür (panelde anahtar kaydedildi ya da silindi; kasa kaynağı değişti) */
export function forgetLafposSecret(): void {
  secretCache = new WeakMap();
}

/** Anahtarın sorunu (Ayarlar'daki LafPOS kartı ve Şube ayarları söyler; lafposSecretProblem) */
export async function lafposSecretState(db: Reader = getDb()): Promise<{ problem: ReturnType<typeof lafposSecretProblem>; source: "panel" | "ortam" | null }> {
  const { env, source } = await lafposSecretEnv(db);
  return { problem: lafposSecretProblem(env), source };
}
