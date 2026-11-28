import "server-only";

import { and, eq, isNull, lte, or, sql } from "drizzle-orm";

import { logActivity } from "@/server/actions/log";
import { getDb, schema as s } from "@/server/db";
import { open } from "@/server/secret-box";

import { consumeRecoveryList, consumeTotpStep, DEVICE_MAX_FAILED, refundDeviceAttempt, reserveDeviceAttempt, type Reservation } from "./login-locks";
import { hashPassword, verifyPassword } from "./password";
import { createLimiter, createLockout } from "./rate-limit";
import { isKnownDevice, type DeviceToken } from "./session";
import { consumeRecoveryCode, verifyTotp } from "./totp";

/*
 * Girişin korumaları, iki kapı için ortak (docs/ROLLER.md › Asıl yönetici): panelin girişi (src/server/actions/auth.ts,
 * çerezli) ve kasa açılışının ladmin girişi (POST /api/asilpos/acilis/giris; src/server/asilpos/acilis.ts, çerezsiz).
 * İkisi aynı sayaçları ve aynı kilidi kullanır: kasadan denenen yanlış parola panelin hesap kilidine de sayılır.
 * Bu dosya bilerek "use server" değil: buradaki işlevler istemciden çağrılamaz.
 *
 * Kaba kuvvete karşı üç katman. Her deneme doğrulanmadan ÖNCE sayılır, denetim ve sayım tek adımdadır: aynı anda
 * gönderilen yüzlerce istek de sınırı aşamaz (önce sorup sonra sayınca hepsi kilitten önce geçiyordu). IP sınırı
 * bellekte, sunucusuz örnek başına sayılır, ilk savunmadır; iki kilit veritabanındadır.
 * - Aynı IP'den 15 dakikada en fazla 20 deneme, bilinen cihazınki de. Başarılı giriş geri verilir: kafedeki ortak IP
 *   kapanmasın.
 * - Hesap kilidi: 5 denemede 15 dakika. Bilinen cihaza (bu tarayıcıdan güncel oturum sürümüyle girilmiş) uygulanmaz;
 *   e-postayı bilen biri 5 yanlış parolayla sahibini panelden kapatamasın.
 * - Bilinen cihazın kendi payı (src/server/auth/login-locks.ts): cihaz + kişi başına 10 denemede 15 dakika. Bunu
 *   yalnızca o cihaz tüketebilir. Önceden bellekteydi ve kilidi yazılmazdı: ortak tablette biri sahibinin parolasını
 *   kimse görmeden deneyebiliyordu.
 * İki kilit de başlayınca işlem geçmişine yazılır. Parola doğruysa ve kod adımına geçiliyorsa deneme geri verilir; kod
 * adımı kendi denemelerini aynı paydan sayar.
 */

/** Bu kadar denemeden sonra hesap kısa süre kilitlenir (parola ve kod adımı birlikte sayılır) */
export const MAX_FAILED = 5;
export const LOCK_MINUTES = 15;
export const LOCK_MS = LOCK_MINUTES * 60_000;

export const loginIp = createLimiter({ limit: 20, windowMs: LOCK_MS });
/** Kayıtsız / pasif e-posta da 5. denemede aynı kilit mesajını alır: girişten hesap var mı yok mu anlaşılmasın */
const ghostLock = createLockout({ max: MAX_FAILED, lockMs: LOCK_MS });
/** Kayıtsız e-postada da bir parola özeti denenir (işlemci yükü kayıtlı hesapla aynı olsun) */
let ghostHash: Promise<string> | undefined;

export const WRONG = "E-posta ya da parola hatalı";
export const TOO_MANY = `Çok fazla deneme yapıldı. ${LOCK_MINUTES} dakika sonra yeniden deneyin.`;
/** Başarısız giriş yanıtı en erken bu sürede döner: özet, sorgu ve sayaç yazımı süreden okunmasın */
const FAIL_MS = 900;

export const slow = () => new Promise((r) => setTimeout(r, 600));

export async function padTo(started: number) {
  const left = FAIL_MS - (Date.now() - started);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
}

/** Veritabanındaki kilit sürüyorsa bitişi */
const activeLock = (u: { lockedUntil: Date | null }) => (u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil : null);

/** Bu tarayıcı kişi için bilinen cihazsa (güncel oturum sürümüyle) cihazın kimliği (hata payının anahtarı), değilse null */
export const knownDeviceId = (user: { id: number; sessionVersion: number }, device: DeviceToken | null) => (device && isKnownDevice(device, user) ? device.did : null);

export function lockedMessage(until: Date) {
  const min = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  return `Çok fazla hatalı deneme. ${min} dakika sonra yeniden deneyin.`;
}

/**
 * Kayıtsız ya da pasif hesap: parola yine bir özetle denenir, kilit bellekte tutulur (kayıtlı hesapla aynı kural).
 * `undoIp`: kilitliyken deneme değerlendirilmedi, IP'nin payı geri verilir
 */
export async function ghostAttempt(email: string, password: string): Promise<{ error: string; undoIp: boolean }> {
  const r = ghostLock.attempt(email);
  if (!r.ok) return { error: lockedMessage(r.until), undoIp: true };
  await verifyPassword(password, await (ghostHash ??= hashPassword("yok")));
  return { error: r.locked ? lockedMessage(r.locked) : WRONG, undoIp: false };
}

/**
 * Denemeyi doğrulamadan ÖNCE hesabın sayacından düşer ve kilidi aynı UPDATE'te verir. Kilit sürüyorsa satır
 * güncellenmez (eşzamanlı istekler satır kilidinde sıraya girer; kilidi gören geri çevrilir). 5. deneme sayacı
 * sıfırlar ve 15 dakikalık kilidi başlatır, kendisi yine değerlendirilir; doğruysa completeLogin kilidi kaldırır.
 * Kilit bitince yeniden 5 hak. Sayaç hiçbir zaman kilitsiz 5'te kalmaz (yarıda kalan istek hesabı süresiz kilitlemez).
 */
async function reserveAttempt(userId: number): Promise<Reservation> {
  const db = getDb();
  const [row] = await db
    .update(s.users)
    .set({
      failedLogins: sql`CASE WHEN ${s.users.failedLogins} + 1 >= ${sql.raw(String(MAX_FAILED))} THEN 0 ELSE ${s.users.failedLogins} + 1 END`,
      lockedUntil: sql`CASE WHEN ${s.users.failedLogins} + 1 >= ${sql.raw(String(MAX_FAILED))} THEN now() + interval '${sql.raw(String(LOCK_MINUTES))} minutes' ELSE ${s.users.lockedUntil} END`,
    })
    .where(and(eq(s.users.id, userId), or(isNull(s.users.lockedUntil), lte(s.users.lockedUntil, sql`now()`))))
    .returning({ lockedUntil: s.users.lockedUntil });
  if (row) return { ok: true, locked: activeLock(row) };
  const [cur] = await db.select({ lockedUntil: s.users.lockedUntil }).from(s.users).where(eq(s.users.id, userId)).limit(1);
  return { ok: false, until: (cur && activeLock(cur)) ?? new Date(Date.now() + LOCK_MS) };
}

/**
 * reserveAttempt'in saydığı denemeyi geri verir (parola doğru, kod adımına geçiliyor). Sayaç bir azalır, sıfırlanmaz:
 * parolayı bilen biri kod denemelerinin sayacını silemesin. Satırın o anki hâline bakılır (bellekteki kilidin
 * refund()'u gibi): sayaç sıfır ve kilit sürüyorsa kilit bu denemeden sonra (bu ya da eşzamanlı bir denemeyle)
 * başlamıştır; kilit kalkar, sayaç 4'te kalır. Kilitliyken yeni deneme sayılmadığı için bu kilit başkası olamaz.
 */
async function refundAttempt(userId: number) {
  const locked = sql`${s.users.failedLogins} = 0 AND ${s.users.lockedUntil} > now()`;
  await getDb()
    .update(s.users)
    .set({
      failedLogins: sql`CASE WHEN ${s.users.failedLogins} > 0 THEN ${s.users.failedLogins} - 1 WHEN ${locked} THEN ${sql.raw(String(MAX_FAILED - 1))} ELSE 0 END`,
      lockedUntil: sql`CASE WHEN ${locked} THEN NULL ELSE ${s.users.lockedUntil} END`,
    })
    .where(eq(s.users.id, userId));
}

/** Denemeyi doğrulamadan önce sayar: bilinen cihazda cihazın payından, değilse hesabın kilidinden (ikisi de veritabanında) */
export const charge = (userId: number, deviceId: string | null): Promise<Reservation> => (deviceId ? reserveDeviceAttempt(getDb(), userId, deviceId) : reserveAttempt(userId));

/** charge()'ın saydığı denemeyi geri verir */
export async function refund(userId: number, deviceId: string | null) {
  if (deviceId) await refundDeviceAttempt(getDb(), userId, deviceId);
  else await refundAttempt(userId);
}

/**
 * Kilit başladı: işlem geçmişine yazılır (sahibi kimin denediğini görsün). Bilinen cihazın kilidi de: yalnız o cihaz
 * kilitlenir ama ortak tablette sahibinin parolasını deneyen biri böyle görünür.
 */
export async function logLock(user: { id: number; name: string; email: string }, where: string, deviceId: string | null) {
  const detail = deviceId
    ? `${user.email}: ${where}, bilinen bir cihazdan ${DEVICE_MAX_FAILED} hatalı deneme · o cihaz ${LOCK_MINUTES} dakika`
    : `${user.email}: ${where}, ${MAX_FAILED} hatalı deneme · ${LOCK_MINUTES} dakika`;
  await logActivity({ id: user.id, name: user.name }, "Hesap kilitlendi", detail);
}

/**
 * İkinci adım (kasa açılışının girişi; panelin kod adımıyla aynı kural, src/server/actions/auth.ts ›
 * verifyLoginCodeAction): doğrulama uygulamasının 6 haneli kodu ya da tek seferlik kurtarma kodu. Kod ve kurtarma kodu
 * tek yazımda tüketilir (tekrar koruması): aynı kod iki kez gönderilirse yalnız biri geçer. Kurtarma koduyla giriş
 * işlem geçmişine yazılır. Döner: geçti mi. Deneme bu çağrıdan önce `charge` ile sayılmış olmalı
 */
export async function secondFactorOk(
  user: { id: number; name: string; totpSecret: string | null; totpLastStep: number | null; recoveryCodes: string[] | null },
  code: string,
  where: string,
): Promise<boolean> {
  const secret = user.totpSecret ? open(user.totpSecret, "totp") : null;
  const step = secret ? verifyTotp(secret, code, user.totpLastStep) : null;
  if (step !== null && (await consumeTotpStep(getDb(), user.id, step))) return true;
  const codes = user.recoveryCodes ?? [];
  const remaining = await consumeRecoveryCode(user.id, codes, code);
  if (remaining && (await consumeRecoveryList(getDb(), user.id, codes, remaining))) {
    await logActivity(user, "Kurtarma koduyla giriş", `${remaining.length} kod kaldı · ${where}`);
    return true;
  }
  return false;
}
