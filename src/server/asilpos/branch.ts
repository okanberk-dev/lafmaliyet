import "server-only";

import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import { ASILPOS_GROUP } from "@/lib/branch-settings/groups";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "@/lib/karaoke/signature";
import { staffBlindDay } from "@/lib/asilpos/kor-kasa";
import { posEnvName } from "@/lib/asilpos/env";
import { envSyncSecret, secretFrom, secretProblem, type SecretProblem } from "@/lib/asilpos/request";
import { isAsilposDay } from "@/lib/asilpos/switch";
import { LEGACY_POS_BRANCH_ID } from "@/lib/pos/tills";
import { putBranchSetting, resolveBranchSetting, resolveForTills } from "@/server/branch-settings";
import { forgetPosTills, loadBranchSwitchDay, loadPosTillIds, switchDayOf } from "@/server/pos/tills";

import { getDb, schema as s, type DB } from "../db";

/**
 * AsilPOS kasalarının anahtarları ve şubeye bağlı küçük okumalar (çok şube; docs/ASILPOS.md › Şubeler). Her AsilPOS kasasının
 * kendi imza anahtarı vardır (Şube ayarları'nda, şifreli); kasanın şubesini panel anahtardan bulur: imza hangi şubenin
 * anahtarıyla tutuyorsa istek o şubenindir (kurulu kasa devir, ürün ve gider kategorisi isteklerinde şube göndermez).
 * Ortamdaki anahtar (ASILPOS_SYNC_SECRET, yoksa eski adı) yalnız eski tek kasalı kurulumun şubesinindir (Marina,
 * LEGACY_POS_BRANCH_ID) ve yalnız o şubenin saklanan anahtarı yokken. İki şubenin anahtarı aynıysa ikisi de kullanılmaz
 * (bir şubenin günü öbürüne yazılmasın; Ayarlar kartı söyler).
 */

type Reader = Pick<DB, "select">;
type Env = Record<string, string | undefined>;

export { forgetPosTills, loadBranchSwitchDay, switchDayOf };

/** Anahtarların önbellek süresi (döndürülen anahtar en geç bu kadar sonra her örnekte geçersiz; imzası tutanda hemen) */
export const POS_KEYS_CACHE_MS = 60_000;

/**
 * İmzası tutmayan istekte anahtarlar önbellekten en çok bu sıklıkla yeniden okunur (sunucu örneği başına): başka bir
 * örnekte kaydedilen yeni anahtar en geç bu kadar sonra kabul edilir; imzasız istek yağmuru veritabanını bundan sık okutamaz
 */
export const POS_KEYS_RELOAD_MS = 10_000;

/** Şubenin anahtarının durumu (Ayarlar kartı, Şube ayarları) */
export interface PosKeyInfo {
  /** Kullanılan anahtar (yoksa null) */
  secret: string | null;
  /** Nereden: şubenin saklanan anahtarı ya da ortamdaki (yalnız eski kurulumun şubesi); yoksa null */
  source: "panel" | "ortam" | null;
  /** Sorun (yok, kısa, sitenin anahtarıyla ya da başka şubenin anahtarıyla aynı); null: bağlantı açık */
  problem: SecretProblem | null;
}

/** Anahtarların okunuşu: şube → durum; kullanılabilen (benzersiz, sorunsuz) anahtarlar `keys`'te */
interface KeyRead {
  info: Map<string, PosKeyInfo>;
  keys: Map<string, string>;
}

/** Veritabanından: her şubenin saklanan anahtarı, eski kurulumun şubesine ortamdaki; aynı olanlar kullanılmaz */
async function readKeys(db: Reader, env: Env): Promise<KeyRead> {
  const settings = await resolveForTills(ASILPOS_GROUP, db, { closed: true });
  const raw = new Map<string, { value: string; source: "panel" | "ortam" }>();
  for (const [id, r] of settings) {
    const v = r.value.secret?.trim();
    if (v) raw.set(id, { value: v, source: "panel" });
  }
  const env0 = envSyncSecret(env)?.trim();
  if (!raw.has(LEGACY_POS_BRANCH_ID) && env0) raw.set(LEGACY_POS_BRANCH_ID, { value: env0, source: "ortam" });
  const count = new Map<string, number>();
  for (const { value } of raw.values()) count.set(value, (count.get(value) ?? 0) + 1);
  const info = new Map<string, PosKeyInfo>();
  const keys = new Map<string, string>();
  for (const [id, { value, source }] of raw) {
    const problem = secretProblem(value, env) ?? ((count.get(value) ?? 0) > 1 ? "same_as_other_branch" : null);
    info.set(id, { secret: problem ? null : value, source, problem });
    if (!problem) keys.set(id, secretFrom(value, env)!);
  }
  if ([...count.values()].some((n) => n > 1)) console.error("[asilpos] iki şubenin anahtarı aynı: o anahtar kullanılmıyor");
  return { info, keys };
}

let keyCache = new WeakMap<object, { at: number; read: KeyRead }>();

/** Anahtarlar (önbellekli); `force`: veritabanından. Veritabanı okunamazsa null */
async function keyEntry(db: Reader, env: Env, now: number, force = false): Promise<{ read: KeyRead; at: number; fresh: boolean } | null> {
  const hit = force ? undefined : keyCache.get(db);
  if (hit && now - hit.at < POS_KEYS_CACHE_MS) return { ...hit, fresh: false };
  try {
    const entry = { at: now, read: await readKeys(db, env) };
    keyCache.set(db, entry);
    return { ...entry, fresh: true };
  } catch (e) {
    console.error("[asilpos] anahtarlar okunamadı", e);
    return null;
  }
}

/** Anahtarların önbelleğini düşürür (panelde anahtar kaydedildi ya da silindi; kasa kaynağı değişti) */
export function forgetPosKeys(): void {
  keyCache = new WeakMap();
}

/** Şubeler ve anahtar önbelleği birlikte (Şubeler eylemleri) */
export function forgetPosBranches(): void {
  forgetPosTills();
  forgetPosKeys();
}

/** En az bir kasanın kullanılabilen anahtarı var mı (gün sonu ucunun ön süzgeci; önbellekli). Okunamazsa false */
export async function posKeysConfigured(db: Reader = getDb(), env: Env = process.env, now: number = Date.now()): Promise<boolean> {
  return ((await keyEntry(db, env, now))?.read.keys.size ?? 0) > 0;
}

/**
 * İmzalı isteği yapan kasa. `branchId`: imzanın tuttuğu anahtarın şubesi; `secret`: uç isteği bununla yeniden denetler
 * (checkAsilposRequest). Hiçbir anahtar tutmazsa `branchId` null, `secret` kasalardan birinin anahtarı (uç 401 döner);
 * hiçbir anahtar yoksa ya da okunamazsa ikisi de null (uç 503).
 */
export type PosCaller = { branchId: string; secret: string } | { branchId: null; secret: string | null };

/**
 * İmzalı AsilPOS isteğinin kasası (döndürülen anahtar her sunucu örneğinde hemen geçersiz; güvenlik notu 26 Kasım 2026).
 * Önbellekteki anahtarlar yalnız ön süzgeçtir:
 *
 * - İmza önbellekteki bir anahtarla **tutuyorsa** anahtarlar kabulden önce veritabanından yeniden okunur ve eşleşme o
 *   okumayla yapılır: anahtar başka bir örnekte döndürüldüyse eski anahtarla imzalanmış istek 401 alır.
 * - İmza **tutmuyorsa** önbellek `POS_KEYS_RELOAD_MS`'tan eskiyse bir kez yeniden okunur (yeni anahtarla imzalanmış
 *   istek beklemeden geçsin); değilse veritabanı okunmaz.
 * - Anahtarlar bu çağrıda zaten veritabanından okunduysa yeniden okunmaz.
 *
 * Anahtarlar az (şube başına bir); her biri sabit süreli HMAC karşılaştırmasıyla denenir.
 */
export async function resolvePosCaller(
  req: { method: string; url: URL; body: string; timestamp: string | null; signature: string | null },
  db: Reader = getDb(),
  env: Env = process.env,
  now: number = Date.now(),
): Promise<PosCaller> {
  const match = (keys: Map<string, string>): PosCaller => {
    for (const [branchId, secret] of keys) if (verifySignature(secret, { ...req, now })) return { branchId, secret };
    return { branchId: null, secret: keys.values().next().value ?? null };
  };
  const first = await keyEntry(db, env, now);
  if (!first) return { branchId: null, secret: null };
  const got = match(first.read.keys);
  if (first.fresh) return got;
  if (got.branchId !== null || now - first.at >= POS_KEYS_RELOAD_MS) {
    const again = await keyEntry(db, env, now, true);
    return again ? match(again.read.keys) : { branchId: null, secret: null };
  }
  return got;
}

/** Yol işleyicisinin isteğinden `resolvePosCaller` (GET gövdesiz; POST'ta okunan gövde verilir) */
export function posRequestCaller(request: Request, body = ""): Promise<PosCaller> {
  return resolvePosCaller({
    method: request.method,
    url: new URL(request.url),
    body,
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
  });
}

/**
 * Şubenin anahtarının durumu (Ayarlar'daki AsilPOS kartı, Şube ayarları; önbelleksiz): kullanılan anahtar, kaynağı, sorunu
 * ve ortamdaki değişkenin adı (durum metinleri; ikisi de yoksa eklenecek yeni ad)
 */
export async function posKeyState(branchId: string, db: Reader = getDb(), env: Env = process.env): Promise<PosKeyInfo & { envName: string }> {
  const { info } = await readKeys(db, env);
  const own = info.get(branchId) ?? { secret: null, source: null, problem: "missing" as const };
  return { ...own, envName: posEnvName("SYNC_SECRET", env) };
}

/** Şubenin kullanılan anahtarı (kurulum kodu kasaya bunu verir); yoksa null */
export async function posKeyOf(branchId: string, db: Reader = getDb(), env: Env = process.env): Promise<string | null> {
  return (await posKeyState(branchId, db, env)).secret;
}

/**
 * Anahtar başka bir şubenin anahtarıyla (ya da ortamdaki eski kurulum anahtarıyla) aynı mı: aynı anahtar bir şubenin
 * günlerini öbürüne yazdırırdı. Şube ayarlarına kayıt ve kurulum kodu bunu sorar
 */
export async function posKeyTaken(branchId: string, secret: string, db: Reader = getDb(), env: Env = process.env): Promise<string | null> {
  const v = secret.trim();
  const settings = await resolveForTills(ASILPOS_GROUP, db, { closed: true });
  for (const [id, r] of settings) if (id !== branchId && r.value.secret?.trim() === v) return id;
  if (branchId !== LEGACY_POS_BRANCH_ID && envSyncSecret(env)?.trim() === v) return LEGACY_POS_BRANCH_ID;
  return null;
}

/**
 * Kör kasa (bulgu 0; src/lib/asilpos/kor-kasa.ts): bu kasanın bu günü personele kör mü (şubenin kendi AsilPOS günü). Geç
 * raporun açılış önerisi ve açılış ↔ devir denetimi önceki halkanın günü için sorar: kör günün devri (sayılan − teslim)
 * personele gitmez. İşlemin içinden de okunur
 */
export async function staffBlindOn(date: string, branchId: string, db: Reader = getDb()): Promise<boolean> {
  return staffBlindDay({ admin: false, asilposDay: isAsilposDay(date, await switchDayOf(branchId, db)) });
}

/**
 * Şube AsilPOS'u kullanıyor mu: geçiş günü var ya da kayıtlı AsilPOS günü var. Kasa kaynağı AsilPOS'tan ModPOS'a dönerken
 * onay istenir (Şubeler eylemleri)
 */
export async function asilposInUse(branchId: string, db: Reader = getDb()): Promise<boolean> {
  const [setting, [row]] = await Promise.all([
    resolveBranchSetting(ASILPOS_GROUP, branchId, db),
    db.select({ date: s.posDayReports.date }).from(s.posDayReports).where(eq(s.posDayReports.branchId, branchId)).limit(1),
  ]);
  return !!setting.value.switchDay || !!row;
}

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/**
 * Şubenin kullanılabilen anahtarı yoksa yenisini üretip şubenin ayarına saklar (kurulum kodu; çok şube): kasa kurulumda
 * yalnız kendi şubesinin anahtarını alır, başka şubenin (ya da ortamdaki eski kurulum) anahtarını hiçbir zaman. Var olan
 * kullanılabilen anahtar değişmez (kurulu kasa çalışmaya devam eder). Üretildiyse true
 */
export async function ensurePosKey(tx: Tx, branchId: string, by: string, env: Env = process.env): Promise<boolean> {
  const { info } = await readKeys(tx, env);
  if (info.get(branchId)?.secret) return false;
  await putBranchSetting(tx, ASILPOS_GROUP, branchId, { secret: randomBytes(32).toString("base64url") }, by);
  forgetPosKeys();
  return true;
}

/** Kasa listesinin önbelleksiz okunuşu (anahtarın güncelliği; testler) */
export async function freshPosTillIds(db: Reader = getDb()): Promise<string[]> {
  return (await loadPosTillIds(db, Date.now(), true)).ids;
}
