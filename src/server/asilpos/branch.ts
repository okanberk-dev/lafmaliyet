import "server-only";

import { eq } from "drizzle-orm";

import { ASILPOS_GROUP } from "@/lib/branch-settings/groups";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "@/lib/karaoke/signature";
import { staffBlindDay } from "@/lib/asilpos/kor-kasa";
import { posEnvName } from "@/lib/asilpos/env";
import { envSyncSecret, secretFrom, secretProblem, type SecretProblem } from "@/lib/asilpos/request";
import { branchSwitchDay, isAsilposDay, asilposBranchOf } from "@/lib/asilpos/switch";
import { resolveBranchSetting } from "@/server/branch-settings";

import { getDb, schema as s, type DB } from "../db";

/**
 * AsilPOS'un şubesinin sunucu okuyucusu (şube kapsamı B6; docs/ASILPOS.md › Şubeler): kütükte kasa kaynağı AsilPOS olan
 * etkin fiziksel şube, yoksa geri düşüş `ASILPOS_BRANCH_ID` (saf kural `asilposBranchOf`, src/lib/asilpos/switch.ts).
 * Gün sonunun yazıldığı şube, geçiş gününün kasası, AsilPOS'un fotoğraf, kasadan çıkan ve devir uçları bunu okur.
 *
 * Önbellekli: değer kurulumun tamamı için tektir ve yalnız Şubeler'de kasa kaynağı değişince değişir; kasanın her
 * gönderimi, zil ve gün sonu otomasyonu ayrı sorgu atmasın diye bağlantı (ya da işlem) başına `ASILPOS_BRANCH_CACHE_MS` boyunca
 * saklanır. Şube eylemleri (src/server/actions/branches.ts) yazınca `forgetAsilposBranch` ile hemen düşer; başka bir
 * sunucu örneğinde en geç `CACHE_MS` sonra yenilenir. İşlemin (`tx`) içinden okunan değer o işlemin kendi okumasıdır.
 */

type Reader = Pick<DB, "select">;

/** Önbelleğin süresi: kasa kaynağı değiştikten sonra başka sunucu örneklerinin en geç bu kadar eski değeri görür */
export const ASILPOS_BRANCH_CACHE_MS = 60_000;

let cache = new WeakMap<object, { at: number; id: string }>();

/** AsilPOS'un şubesi (türetilmiş; önbellekli). `now` testler için; `fresh`: önbelleğe bakmadan kütükten (anahtarın güncelliği) */
export async function asilposBranchId(db: Reader = getDb(), now: number = Date.now(), fresh = false): Promise<string> {
  const hit = fresh ? undefined : cache.get(db);
  if (hit && now - hit.at < ASILPOS_BRANCH_CACHE_MS) return hit.id;
  const rows = await db.select({ id: s.branches.id, kind: s.branches.kind, posSource: s.branches.posSource, active: s.branches.active, sortOrder: s.branches.sortOrder, name: s.branches.name }).from(s.branches);
  // Kütüğün sırası (sortBranches ile aynı: sıra, sonra ad): birden çok AsilPOS şubesinde seçim sabit kalsın
  rows.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "tr"));
  const id = asilposBranchOf(rows);
  cache.set(db, { at: now, id });
  return id;
}

/** Önbelleği düşürür (şube eklendi, kasa kaynağı ya da durumu değişti, şube silindi) */
export function forgetAsilposBranch(): void {
  cache = new WeakMap();
  forgetAsilposSecret();
}

/**
 * AsilPOS'a geçiş günü: AsilPOS'un şubesinin şube ayarı (grup `SUBE_AYAR_GRUBU`; docs/SUBE.md › Şube başına ayarlar). Satırı
 * yokken eski genel kayıt (settings › asilposGecisGunu) yalnız Marina'nındır: kasa kaynağı başka şubeye geçerse o şube
 * kendi gününü alır, Marina'nın günü ona geçmez. Panelin geçiş gününü okuyan her yer bunu çağırır (status.ts
 * loadAsilposSwitchDay ve asilpos-ikram.ts asilposSwitchDayOf da buna iner; tests/sube-ayarlari-2.test.ts kilitler)
 */
export async function asilposSwitchDay(db: Reader = getDb()): Promise<string | null> {
  return switchDayOf(await asilposBranchId(db), db);
}

/**
 * Kör kasa (bulgu 0; src/lib/asilpos/kor-kasa.ts): bu kasanın bu günü personele kör mü (AsilPOS'un şubesi, geçiş gününden
 * itibaren). Geç raporun açılış önerisi ve açılış ↔ devir denetimi önceki halkanın günü için sorar: kör günün devri
 * (sayılan − teslim) personele gitmez. İşlemin içinden de okunur
 */
export async function staffBlindOn(date: string, branchId: string, db: Reader = getDb()): Promise<boolean> {
  const [branch, switchDay] = await Promise.all([asilposBranchId(db), asilposSwitchDay(db)]);
  return staffBlindDay({ admin: false, branchId, asilposDay: isAsilposDay(date, switchDay), asilposBranch: branch });
}

/**
 * Verilen şubenin AsilPOS geçiş günü (şube ayarı SUBE_AYAR_GRUBU). Gün sonunu yazan ve silen işlem bunu yazdığı şubeyle çağırır:
 * şube bir kez okunur, geçiş günü aynı şubeninki olur (işlemin içinde şube yeniden türetilip başka şubeye düşmez)
 */
export async function switchDayOf(branchId: string, db: Reader = getDb()): Promise<string | null> {
  return (await resolveBranchSetting(ASILPOS_GROUP, branchId, db)).value.switchDay;
}

/**
 * Bir şubenin kasasının geçiş günü (branchSwitchDay, türetilmiş AsilPOS şubesiyle): geçiş günü ve AsilPOS'un şubesi
 * birlikte okunur. Tek kasanın gününe bakan sunucu okumaları bunu çağırır
 */
export async function loadBranchSwitchDay(branchId: string | null | undefined, db: Reader = getDb()): Promise<string | null> {
  const [day, asilposBranch] = await Promise.all([asilposSwitchDay(db), asilposBranchId(db)]);
  return branchSwitchDay(day, branchId, asilposBranch);
}

/**
 * Şube AsilPOS'u kullanıyor mu: geçiş günü var ya da kayıtlı AsilPOS günü var. Geri düşüşle AsilPOS'un şubesi olan şube
 * (kütükte kaynağı ModPOS) kullanıyorsa kasa kaynağı başka şubede AsilPOS yapılamaz (asilposSourceError; Şubeler eylemleri)
 */
export async function asilposInUse(branchId: string, db: Reader = getDb()): Promise<boolean> {
  const [day, [row]] = await Promise.all([
    switchDayOf(branchId, db),
    db.select({ date: s.posDayReports.date }).from(s.posDayReports).where(eq(s.posDayReports.branchId, branchId)).limit(1),
  ]);
  return !!day || !!row;
}

type Env = Record<string, string | undefined>;

/**
 * AsilPOS'un kullanılan anahtarı: AsilPOS'un şubesinin Şube ayarları'nda saklanan anahtar (şifreli; açılamıyorsa yok
 * sayılır) ortamdakinin (ASILPOS_SYNC_SECRET, yoksa eski adı; envSyncSecret) önüne geçer. Yoksa ortamdaki (bugünkü kurulum
 * hiçbir şey yapmadan çalışır). `source`: kullanılan anahtar nereden ("panel", "ortam"; anahtar yoksa null); `envName`:
 * ortamda okunan değişkenin adı (durum metinleri; ikisi de yoksa eklenecek yeni ad)
 */
export async function asilposSecretValue(db: Reader = getDb(), env: Env = process.env): Promise<{ secret: string | null; source: "panel" | "ortam" | null; envName: string }> {
  const branch = await asilposBranchId(db);
  const stored = (await resolveBranchSetting(ASILPOS_GROUP, branch, db)).value.secret;
  const envName = posEnvName("SYNC_SECRET", env);
  if (stored) return { secret: stored, source: "panel", envName };
  const own = envSyncSecret(env);
  return { secret: own ?? null, source: own?.trim() ? "ortam" : null, envName };
}

let secretCache = new WeakMap<object, { at: number; stored: string | null }>();

/**
 * Anahtarın okunuşu: anahtar (yoksa null), önbelleğe yazıldığı an ve bu çağrıda veritabanından mı okundu (`fresh`).
 * Veritabanından okunurken AsilPOS'un şubesi de kütükten taze okunur (anahtar şubenin ayarı). `force`: önbelleğe
 * bakılmaz. Veritabanı okunamazsa null
 */
async function secretEntry(db: Reader, env: Env, now: number, force = false): Promise<{ secret: string | null; at: number; fresh: boolean } | null> {
  const hit = force ? undefined : secretCache.get(db);
  let entry: { at: number; stored: string | null };
  let fresh = false;
  if (hit && now - hit.at < ASILPOS_BRANCH_CACHE_MS) entry = hit;
  else {
    try {
      entry = { at: now, stored: (await resolveBranchSetting(ASILPOS_GROUP, await asilposBranchId(db, now, true), db)).value.secret ?? null };
    } catch (e) {
      console.error("[asilpos] anahtar okunamadı", e);
      return null;
    }
    secretCache.set(db, entry);
    fresh = true;
  }
  return { secret: secretFrom(entry.stored ?? envSyncSecret(env), env), at: entry.at, fresh };
}

/**
 * AsilPOS'un anahtarı (panelde saklanan, yoksa ortamdaki; en az 32 karakter, sitenin anahtarından ayrı); yoksa null (uçlar
 * 503). Önbellekli (`ASILPOS_BRANCH_CACHE_MS`; bu sunucu örneğinde anahtar kaydedilince ya da kasa kaynağı değişince
 * hemen düşer): imzasız istek her seferinde veritabanını okutmaz. Veritabanı okunamazsa null: uç 500 değil 503 döner
 * (anahtar okunamadı, istek kabul edilmez). İmzalı uçlar isteği kabul etmeden önce `asilposRequestSecret` ile okur:
 * önbellek yalnız ön süzgeçtir, döndürülen eski anahtar başka bir sunucu örneğinde de hemen geçmez
 */
export async function asilposSecret(db: Reader = getDb(), env: Env = process.env, now: number = Date.now()): Promise<string | null> {
  return (await secretEntry(db, env, now))?.secret ?? null;
}

/**
 * İmzası tutmayan istekte anahtar önbellekten en çok bu sıklıkla yeniden okunur (sunucu örneği başına): başka bir
 * örnekte kaydedilen yeni anahtar 60 sn değil en geç bu kadar sonra kabul edilir; imzasız istek yağmuru veritabanını
 * bundan sık okutamaz
 */
export const ASILPOS_SECRET_RELOAD_MS = 10_000;

/**
 * İmzalı AsilPOS isteğinin denetleneceği anahtar (döndürülen anahtar her sunucu örneğinde hemen geçersiz; güvenlik notu
 * 26 Kasım 2026, docs/ASILPOS.md). Önbellekteki anahtar yalnız ön süzgeçtir:
 *
 * - İmza önbellekteki anahtarla **tutuyorsa** anahtar kabulden önce veritabanından (AsilPOS'un şubesi dahil, önbelleksiz)
 *   yeniden okunur ve o döner. Anahtar başka bir örnekte döndürüldüyse uç yeni anahtarla denetler: eski anahtarla
 *   imzalanmış istek 401 alır, önbellek de yenilenir. Bu okuma yalnız imzası tutan (AsilPOS'un kendi) isteklerinde
 *   olur; uçların her biri zaten veritabanında iş yapar.
 * - İmza **tutmuyorsa** önbellekteki anahtar döner (uç 401 verir, veritabanı okunmaz); önbellek
 *   `ASILPOS_SECRET_RELOAD_MS`'tan eskiyse bir kez yeniden okunur (yeni anahtarla imzalanmış istek beklemeden geçsin).
 * - Anahtar bu çağrıda zaten veritabanından okunduysa yeniden okunmaz.
 *
 * Uç dönen anahtarla `checkAsilposRequest`'i her zamanki gibi çağırır (imza bir kez daha denetlenir).
 */
export async function asilposSecretFor(
  req: { method: string; url: URL; body: string; timestamp: string | null; signature: string | null },
  db: Reader = getDb(),
  env: Env = process.env,
  now: number = Date.now(),
): Promise<string | null> {
  const first = await secretEntry(db, env, now);
  if (!first) return null;
  if (first.fresh) return first.secret;
  const signed = first.secret !== null && verifySignature(first.secret, { ...req, now });
  if (signed || now - first.at >= ASILPOS_SECRET_RELOAD_MS) return (await secretEntry(db, env, now, true))?.secret ?? null;
  return first.secret;
}

/** Yol işleyicisinin isteğinden `asilposSecretFor` (GET gövdesiz; POST'ta okunan gövde verilir) */
export function asilposRequestSecret(request: Request, body = ""): Promise<string | null> {
  return asilposSecretFor({
    method: request.method,
    url: new URL(request.url),
    body,
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
  });
}

/** Anahtarın önbelleğini düşürür (panelde anahtar kaydedildi ya da silindi; kasa kaynağı değişti) */
export function forgetAsilposSecret(): void {
  secretCache = new WeakMap();
}

/** Anahtarın sorunu (Ayarlar'daki AsilPOS kartı ve Şube ayarları söyler; secretProblem) ve ortamdaki değişkenin adı */
export async function asilposSecretState(db: Reader = getDb()): Promise<{ problem: SecretProblem | null; source: "panel" | "ortam" | null; envName: string }> {
  const { secret, source, envName } = await asilposSecretValue(db);
  return { problem: secretProblem(secret), source, envName };
}
