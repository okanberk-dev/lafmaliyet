"use server";

import { and, count, eq, isNull, lte, ne, or, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { z } from "zod";

import { canOpen, homeFor } from "@/lib/roles";
import { hashPassword, passwordProblem, verifyPassword } from "@/server/auth/password";
import { clearPending, endSession, readDevice, readPending, rememberDevice, requireUser, startPending, startSession, type CurrentUser } from "@/server/auth/dal";
import { clientIp, createLimiter, createLockout } from "@/server/auth/rate-limit";
import { isKnownDevice, verifyPending, type DeviceToken } from "@/server/auth/session";
import {
  consumeRecoveryCode,
  formatSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUri,
  verifyTotp,
} from "@/server/auth/totp";
import { expireUserTokens } from "@/server/auth/user-tokens";
import { getDb, schema as s } from "@/server/db";
import { open, seal } from "@/server/secret-box";

import { logActivity } from "./log";
import { attempt, UserError, zText } from "./util";

/** Bu kadar denemeden sonra hesap kısa süre kilitlenir (parola ve kod adımı birlikte sayılır) */
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const LOCK_MS = LOCK_MINUTES * 60_000;

/*
 * Kaba kuvvete karşı üç katman. Her deneme doğrulanmadan ÖNCE sayılır, denetim ve sayım tek adımdadır: aynı anda
 * gönderilen yüzlerce istek de sınırı aşamaz (önce sorup sonra sayınca hepsi kilitten önce geçiyordu). Bellektekiler
 * sunucusuz örnek başına sayılır, ilk savunmadır.
 * - Aynı IP'den 15 dakikada en fazla 20 deneme. Başarılı giriş geri verilir: kafedeki ortak IP kapanmasın.
 * - Hesap kilidi (veritabanı): 5 denemede 15 dakika. Bilinen cihaza (bu tarayıcıdan güncel oturum sürümüyle girilmiş)
 *   uygulanmaz; e-postayı bilen biri 5 yanlış parolayla sahibini panelden kapatamasın.
 * - Bilinen cihazın kendi payı: cihaz + kişi başına 10 denemede 15 dakika. Bunu yalnızca o cihaz tüketebilir.
 * Parola doğruysa ve kod adımına geçiliyorsa deneme geri verilir; kod adımı kendi denemelerini aynı paydan sayar.
 */
const loginIp = createLimiter({ limit: 20, windowMs: LOCK_MS });
const deviceLock = createLockout({ max: MAX_FAILED * 2, lockMs: LOCK_MS });
/** Kayıtsız / pasif e-posta da 5. denemede aynı kilit mesajını alır: girişten hesap var mı yok mu anlaşılmasın */
const ghostLock = createLockout({ max: MAX_FAILED, lockMs: LOCK_MS });
/** Kayıtsız e-postada da bir parola özeti denenir (işlemci yükü kayıtlı hesapla aynı olsun) */
let ghostHash: Promise<string> | undefined;
/**
 * Hesabım'daki parola onayları (parola, e-posta, iki adımlı doğrulama, oturumları kapat): kişi başına 15 dakikada 5
 * hata. Açık kalmış bir oturumla parola tahmin edilemesin. Giriş kilidine dokunmaz: sahibi kendi girişini kilitlemez.
 */
const reauthFails = createLimiter({ limit: MAX_FAILED, windowMs: LOCK_MS });

const WRONG = "E-posta ya da parola hatalı";
const TOO_MANY = `Çok fazla deneme yapıldı. ${LOCK_MINUTES} dakika sonra yeniden deneyin.`;
/** Başarısız giriş yanıtı en erken bu sürede döner: özet, sorgu ve sayaç yazımı süreden okunmasın */
const FAIL_MS = 900;

export type LoginState = { error?: string; email?: string; step?: "password" | "totp" };

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin"),
  password: z.string().min(1, "Parola gerekli"),
  next: z.string().optional(),
});

/** Girişten sonra gidilecek adres: yalnız panel içi ve rolün açabildiği bir ekran, yoksa rolün ana sayfası */
function safeNext(next: string | undefined, role: "admin" | "staff") {
  const fallback = homeFor(role);
  if (!next || !next.startsWith("/panel") || next.startsWith("//") || next.includes("\\")) return fallback;
  return canOpen(role, next.split(/[?#]/)[0]) ? next : fallback;
}

const slow = () => new Promise((r) => setTimeout(r, 600));

async function padTo(started: number) {
  const left = FAIL_MS - (Date.now() - started);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
}

/** Veritabanındaki kilit sürüyorsa bitişi */
const activeLock = (u: { lockedUntil: Date | null }) => (u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil : null);

/** Bu tarayıcı kişi için bilinen cihazsa (güncel oturum sürümüyle) cihazın hata payı anahtarı, değilse null */
const knownDeviceKey = (user: { id: number; sessionVersion: number }, device: DeviceToken | null) =>
  device && isKnownDevice(device, user) ? `${user.id}:${device.did}` : null;

function lockedMessage(until: Date) {
  const min = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  return `Çok fazla hatalı deneme. ${min} dakika sonra yeniden deneyin.`;
}

/** Sayılan deneme: kilit sürüyorsa değerlendirilmez (`until`), değilse `locked` bu denemeyle başlayan kilidin bitişi */
type Reservation = { ok: true; locked: Date | null } | { ok: false; until: Date };

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
 * parolayı bilen biri kod denemelerinin sayacını silemesin. Bu deneme kilidi başlattıysa kilit kalkar, sayaç 4'te kalır.
 */
async function refundAttempt(userId: number, r: { locked: Date | null }) {
  const db = getDb();
  if (r.locked) {
    await db
      .update(s.users)
      .set({ failedLogins: MAX_FAILED - 1, lockedUntil: null })
      .where(and(eq(s.users.id, userId), eq(s.users.failedLogins, 0), sql`${s.users.lockedUntil} > now()`));
  } else {
    await db
      .update(s.users)
      .set({ failedLogins: sql`greatest(${s.users.failedLogins} - 1, 0)` })
      .where(eq(s.users.id, userId));
  }
}

/** Denemeyi doğrulamadan önce sayar: bilinen cihazda cihazın payından (bellek), değilse hesabın kilidinden */
const charge = (userId: number, deviceKey: string | null): Promise<Reservation> | Reservation => (deviceKey ? deviceLock.attempt(deviceKey) : reserveAttempt(userId));

/** charge()'ın saydığı denemeyi geri verir */
async function refund(userId: number, deviceKey: string | null, r: { locked: Date | null }) {
  if (deviceKey) deviceLock.refund(deviceKey);
  else await refundAttempt(userId, r);
}

/** Hesap kilidi başladı: işlem geçmişine yazılır (sahibi kimin denediğini görsün) */
async function logLock(user: { name: string; email: string }, where: string) {
  await logActivity({ name: user.name }, "Hesap kilitlendi", `${user.email}: ${where}, ${MAX_FAILED} hatalı deneme · ${LOCK_MINUTES} dakika`);
}

async function completeLogin(user: typeof s.users.$inferSelect, next: string | undefined, extra: Partial<typeof s.users.$inferInsert> = {}) {
  await getDb()
    .update(s.users)
    .set({ lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null, ...extra })
    .where(eq(s.users.id, user.id));
  const did = await rememberDevice(user);
  deviceLock.clear(`${user.id}:${did}`);
  await startSession(user);
  redirect(safeNext(next, user.role));
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const started = Date.now();
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, email: String(formData.get("email") ?? "") };
  const { email, password, next } = parsed.data;
  const db = getDb();

  let [user] = await db.select().from(s.users).where(eq(s.users.email, email)).limit(1);

  // İlk kurulum: hiç kullanıcı yoksa ortam değişkenindeki yönetici bilgileriyle hesap açılır
  if (!user) {
    const [{ n }] = await db.select({ n: count() }).from(s.users);
    const envEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    if (n === 0 && envEmail && process.env.ADMIN_PASSWORD && email === envEmail && password === process.env.ADMIN_PASSWORD) {
      [user] = await db
        .insert(s.users)
        .values({ email, name: process.env.ADMIN_NAME ?? "Yönetici", passwordHash: await hashPassword(password), role: "admin" })
        .returning();
    }
  }

  // Her başarısız yanıt aynı sürede ve aynı sözlerle döner: kayıtlı / kayıtsız e-posta ayırt edilemesin
  const fail = async (error: string): Promise<LoginState> => {
    await padTo(started);
    return { error, email };
  };
  const deviceKey = user?.active ? knownDeviceKey(user, await readDevice()) : null;
  const ip = clientIp(await headers());
  // Bilinen cihaz dışında her deneme IP'nin payından düşer; doğru parola geri verir
  if (!deviceKey && !loginIp.hit(ip)) return fail(TOO_MANY);

  // Kayıtsız ya da pasif: parola yine bir özetle denenir, kilit bellekte tutulur (kayıtlı hesapla aynı kural)
  if (!user || !user.active) {
    const r = ghostLock.attempt(email);
    if (!r.ok) {
      loginIp.undo(ip);
      return fail(lockedMessage(r.until));
    }
    await verifyPassword(password, await (ghostHash ??= hashPassword("yok")));
    return fail(r.locked ? lockedMessage(r.locked) : WRONG);
  }

  const r = await charge(user.id, deviceKey);
  if (!r.ok) {
    // Kilitliyken deneme değerlendirilmez; IP'nin payından da düşmez
    if (!deviceKey) loginIp.undo(ip);
    return fail(lockedMessage(r.until));
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    if (r.locked && !deviceKey) await logLock(user, "parola");
    return fail(r.locked ? lockedMessage(r.locked) : WRONG);
  }
  if (!deviceKey) loginIp.undo(ip);

  if (user.totpEnabled && user.totpSecret) {
    await refund(user.id, deviceKey, r);
    await startPending(user, next ?? "");
    return { step: "totp", email };
  }
  await completeLogin(user, next);
  return {};
}

export type TotpState = { error?: string; expired?: boolean };

/** Giriş, ikinci adım: doğrulama uygulamasındaki 6 haneli kod ya da tek seferlik kurtarma kodu */
export async function verifyLoginCodeAction(_prev: TotpState, formData: FormData): Promise<TotpState> {
  const pending = await verifyPending(await readPending());
  if (!pending) return { error: "Süre doldu, yeniden giriş yapın.", expired: true };
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "Kodu girin" };

  const db = getDb();
  const [user] = await db.select().from(s.users).where(eq(s.users.id, Number(pending.sub))).limit(1);
  if (!user || !user.active || !user.totpEnabled || !user.totpSecret || user.sessionVersion !== pending.sv) {
    await clearPending();
    return { error: "Oturum açılamadı, yeniden giriş yapın.", expired: true };
  }
  const deviceKey = knownDeviceKey(user, await readDevice());
  // Kod da doğrulanmadan önce sayılır: aynı anda gönderilen yüzlerce kod 15 dakikada 5 denemeyi aşamaz
  const r = await charge(user.id, deviceKey);
  if (!r.ok) {
    await clearPending();
    return { error: lockedMessage(r.until), expired: true };
  }

  const secret = open(user.totpSecret, "totp");
  const step = secret ? verifyTotp(secret, code, user.totpLastStep) : null;
  if (step !== null) {
    await completeLogin(user, pending.next, { totpLastStep: step });
    return {};
  }
  const remaining = await consumeRecoveryCode(user.id, user.recoveryCodes ?? [], code);
  if (remaining) {
    await logActivity(user, "Kurtarma koduyla giriş", `${remaining.length} kod kaldı`);
    await completeLogin(user, pending.next, { recoveryCodes: remaining });
    return {};
  }

  if (r.locked && !deviceKey) await logLock(user, "iki adımlı kod");
  await slow();
  if (r.locked) {
    await clearPending();
    return { error: lockedMessage(r.locked), expired: true };
  }
  return { error: "Kod geçersiz ya da süresi geçmiş. Uygulamadaki güncel kodu girin." };
}

export async function cancelLoginCodeAction() {
  await clearPending();
}

export async function logoutAction() {
  await endSession();
  redirect("/giris");
}

// ---------------------------------------------------------------- Hesabım

/**
 * Oturum sürümünü artırır (diğer cihazlardaki oturumlar kapanır) ve bu cihazın oturumunu yeniler. Bu tarayıcı yeni
 * sürümle bilinen cihaz kalır (öteki cihazların kaydı eski sürümde kalıp geçersizleşir).
 */
async function rotateSessions(userId: number) {
  const [u] = await getDb()
    .update(s.users)
    .set({ sessionVersion: sql`${s.users.sessionVersion} + 1` })
    .where(eq(s.users.id, userId))
    .returning();
  if (u) {
    await startSession(u);
    await rememberDevice(u);
  }
}

const passwordOnly = z.string().min(1, "Parolanızı girin");

/**
 * Hesabım'da değişikliği onaylayan parola. Deneme doğrulamadan önce sayılır (kişi başına 15 dakikada 5 hata; doğrusu
 * geri verilir) ve hatalı deneme işlem geçmişine yazılır: açık kalmış bir oturumla parola tahmin edilemesin.
 */
async function confirmPassword(me: CurrentUser, password: string): Promise<{ ok: true; user: typeof s.users.$inferSelect } | { ok: false; error: string }> {
  const key = String(me.id);
  if (!reauthFails.hit(key)) return { ok: false, error: `Çok fazla hatalı parola. ${LOCK_MINUTES} dakika sonra yeniden deneyin.` };
  const [u] = await getDb().select().from(s.users).where(eq(s.users.id, me.id)).limit(1);
  if (u && (await verifyPassword(password, u.passwordHash))) {
    reauthFails.undo(key);
    return { ok: true, user: u };
  }
  await logActivity(me, "Hatalı parola onayı (Hesabım)", me.email);
  return { ok: false, error: "Parola hatalı" };
}

/** attempt() içindeki eylemler için: parola tutmazsa kullanıcıya gösterilen hata */
async function requirePassword(me: CurrentUser, password: string) {
  passwordOnly.parse(password);
  const c = await confirmPassword(me, password);
  if (!c.ok) throw new UserError(c.error);
  return c.user;
}

export type PasswordState = { error?: string; ok?: boolean };

export async function changePasswordAction(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const me = await requireUser();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const repeat = String(formData.get("repeat") ?? "");
  const problem = passwordProblem(next, me.email);
  if (problem) return { error: problem };
  if (next !== repeat) return { error: "Yeni parolalar aynı değil" };
  const c = await confirmPassword(me, current);
  if (!c.ok) return { error: c.error === "Parola hatalı" ? "Mevcut parola hatalı" : c.error };
  await getDb().update(s.users).set({ passwordHash: await hashPassword(next) }).where(eq(s.users.id, me.id));
  // Bekleyen sıfırlama / davet bağlantıları eski parolayla birlikte geçersiz olur
  await expireUserTokens(me.id);
  await rotateSessions(me.id);
  await logActivity(me, "Parola değiştirildi", me.email);
  return { ok: true };
}

const profileSchema = z.object({
  name: zText("Ad", 80),
  email: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin"),
  password: z.string().min(1, "Değişikliği onaylamak için parolanızı girin"),
});

/** Ad ve giriş e-postası; parola ile onaylanır */
export async function updateProfile(input: z.input<typeof profileSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    const data = profileSchema.parse(input);
    const db = getDb();
    const u = await requirePassword(me, data.password);
    const [{ n }] = await db
      .select({ n: count() })
      .from(s.users)
      .where(and(eq(s.users.email, data.email), ne(s.users.id, me.id)));
    if (n > 0) throw new UserError("Bu e-posta başka bir kullanıcıda kayıtlı");
    await db.update(s.users).set({ name: data.name, email: data.email }).where(eq(s.users.id, me.id));
    // Eski adrese gönderilmiş sıfırlama bağlantısı artık parola belirleyemez
    if (data.email !== u.email) await expireUserTokens(me.id);
    // Ad oturum çerezinde de duruyor
    const [fresh] = await db.select().from(s.users).where(eq(s.users.id, me.id)).limit(1);
    if (fresh) await startSession(fresh);
    await logActivity(me, "Hesap bilgileri değişti", data.email !== u.email ? `${u.email} → ${data.email}` : data.name);
    return null;
  });
}

/** Diğer cihazlardaki bütün oturumları kapatır (bu cihaz açık kalır); parola ile onaylanır */
export async function signOutOtherSessions(password: string) {
  return attempt(async () => {
    const me = await requireUser();
    await requirePassword(me, password);
    await rotateSessions(me.id);
    await logActivity(me, "Diğer cihazlardaki oturumlar kapatıldı", me.email);
    return null;
  });
}

// ---------------------------------------------------------------- İki adımlı doğrulama

/**
 * Kurulumu başlatır: yeni anahtar (henüz açık değil) ve QR kodu. Parola ister: açık kalmış bir oturumla başkası kendi
 * telefonunu bağlayıp sahibini dışarıda bırakamasın.
 */
export async function beginTotpSetup(password: string) {
  return attempt(async () => {
    const me = await requireUser();
    const u = await requirePassword(me, password);
    if (u.totpEnabled) throw new UserError("İki adımlı doğrulama zaten açık");
    const secret = generateTotpSecret();
    await getDb().update(s.users).set({ totpSecret: seal(secret, "totp"), totpLastStep: null }).where(eq(s.users.id, me.id));
    const uri = otpauthUri(u.email, secret);
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 232, errorCorrectionLevel: "M", color: { dark: "#18181b", light: "#ffffff" } });
    return { qr, secret: formatSecret(secret), uri };
  });
}

/** Kurtarma kodlarının saklanan özetleri (kişiye özel, yavaş özet; totp.ts) */
const hashCodes = (userId: number, codes: string[]) => Promise.all(codes.map((c) => hashRecoveryCode(userId, c)));

/** Uygulamadaki kodla kurulumu onaylar; kurtarma kodlarını bir kez gösterilmek üzere döndürür */
export async function confirmTotpSetup(code: string) {
  return attempt(async () => {
    const me = await requireUser();
    const db = getDb();
    const [u] = await db.select().from(s.users).where(eq(s.users.id, me.id)).limit(1);
    if (!u?.totpSecret || u.totpEnabled) throw new UserError("Önce kurulumu başlatın");
    const secret = open(u.totpSecret, "totp");
    const step = secret ? verifyTotp(secret, code, null) : null;
    if (step === null) throw new UserError("Kod tutmadı. Telefonun saati doğru mu? Uygulamadaki güncel kodu girin.");
    const codes = generateRecoveryCodes();
    await db
      .update(s.users)
      .set({ totpEnabled: true, totpLastStep: step, recoveryCodes: await hashCodes(me.id, codes) })
      .where(eq(s.users.id, me.id));
    await rotateSessions(me.id);
    await logActivity(me, "İki adımlı doğrulama açıldı", me.email);
    return { codes };
  });
}

/** Kapatma parola ister */
export async function disableTotp(password: string) {
  return attempt(async () => {
    const me = await requireUser();
    await requirePassword(me, password);
    await getDb().update(s.users).set({ totpEnabled: false, totpSecret: null, totpLastStep: null, recoveryCodes: null }).where(eq(s.users.id, me.id));
    await rotateSessions(me.id);
    await logActivity(me, "İki adımlı doğrulama kapatıldı", me.email);
    return null;
  });
}

/** Yeni kurtarma kodları (eskiler geçersiz olur) */
export async function regenerateRecoveryCodes(password: string) {
  return attempt(async () => {
    const me = await requireUser();
    const u = await requirePassword(me, password);
    if (!u.totpEnabled) throw new UserError("İki adımlı doğrulama kapalı");
    const codes = generateRecoveryCodes();
    await getDb().update(s.users).set({ recoveryCodes: await hashCodes(me.id, codes) }).where(eq(s.users.id, me.id));
    await logActivity(me, "Kurtarma kodları yenilendi", me.email);
    return { codes };
  });
}
