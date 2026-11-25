import "server-only";

import { eq } from "drizzle-orm";

import { LAFPOS_GROUP } from "@/lib/branch-settings/groups";
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

/** LafPOS'un şubesi (türetilmiş; önbellekli). `now` testler için */
export async function lafposBranchId(db: Reader = getDb(), now: number = Date.now()): Promise<string> {
  const hit = cache.get(db);
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
 * LafPOS'un anahtarı (panelde saklanan, yoksa ortamdaki; en az 32 karakter, sitenin anahtarından ayrı); yoksa null (uçlar
 * 503). İmzalı uçlar imzayı denetlemeden önce bunu okur: imzasız istek her seferinde veritabanını okutmasın diye panelde
 * saklanan anahtar LafPOS'un şubesi gibi önbellekli (`LAFPOS_BRANCH_CACHE_MS`; anahtar kaydedilince ya da kasa kaynağı
 * değişince hemen düşer). Veritabanı okunamazsa null: uç 500 değil 503 döner (anahtar okunamadı, istek kabul edilmez)
 */
export async function lafposSecret(db: Reader = getDb(), env: Env = process.env, now: number = Date.now()): Promise<string | null> {
  let stored: string | null;
  const hit = secretCache.get(db);
  if (hit && now - hit.at < LAFPOS_BRANCH_CACHE_MS) stored = hit.stored;
  else {
    try {
      stored = (await resolveBranchSetting(LAFPOS_GROUP, await lafposBranchId(db), db)).value.secret ?? null;
    } catch (e) {
      console.error("[lafpos] anahtar okunamadı", e);
      return null;
    }
    secretCache.set(db, { at: now, stored });
  }
  return lafposSecretFrom(stored ? { ...env, LAFPOS_SYNC_SECRET: stored } : env);
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
