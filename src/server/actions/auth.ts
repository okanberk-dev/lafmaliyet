"use server";

import { and, count, eq, ne, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { z } from "zod";

import { canOpen, homeFor } from "@/lib/roles";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { clearPending, endSession, readDevice, rememberDevice, requireUser, startPending, startSession } from "@/server/auth/dal";
import { clientIp, createLimiter, createLockout } from "@/server/auth/rate-limit";
import { PENDING_COOKIE, verifyPending, type DeviceToken } from "@/server/auth/session";
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

/** Bu kadar hatalı denemeden sonra hesap kısa süre kilitlenir (parola ve kod adımı birlikte sayılır) */
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const LOCK_MS = LOCK_MINUTES * 60_000;

/*
 * Kaba kuvvete karşı üç katman (bellektekiler sunucusuz örnek başına sayılır, ilk savunmadır):
 * - Aynı IP'den 15 dakikada en fazla 20 hatalı deneme. Başarılı giriş sayılmaz: kafedeki ortak IP kapanmasın.
 * - Hesap kilidi (veritabanı): 5 hatada 15 dakika. Bilinen cihaza (bu tarayıcıdan daha önce girilmiş) uygulanmaz;
 *   e-postayı bilen biri 5 yanlış parolayla sahibini panelden kapatamasın.
 * - Bilinen cihazın kendi payı: cihaz + kişi başına 10 hatada 15 dakika. Bunu yalnızca o cihaz tüketebilir.
 */
const loginIp = createLimiter({ limit: 20, windowMs: LOCK_MS });
const deviceLock = createLockout({ max: MAX_FAILED * 2, lockMs: LOCK_MS });
/** Kayıtsız / pasif e-posta da 5. hatada aynı kilit mesajını alır: girişten hesap var mı yok mu anlaşılmasın */
const ghostLock = createLockout({ max: MAX_FAILED, lockMs: LOCK_MS });
/** Kayıtsız e-postada da bir parola özeti denenir (işlemci yükü kayıtlı hesapla aynı olsun) */
let ghostHash: Promise<string> | undefined;

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

/** Bu tarayıcı kişi için bilinen cihazsa cihazın hata payı anahtarı, değilse null */
const knownDeviceKey = (userId: number, device: DeviceToken | null) => (device?.ids.includes(userId) ? `${userId}:${device.did}` : null);

function lockedMessage(until: Date) {
  const min = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  return `Çok fazla hatalı deneme. ${min} dakika sonra yeniden deneyin.`;
}

/** Hatalı denemeyi sayar; sınır aşılırsa hesabı kilitler. Kilitlendiyse kilidin bitişi, yoksa null. */
async function registerFailure(userId: number): Promise<Date | null> {
  const [row] = await getDb()
    .update(s.users)
    // Tek UPDATE: eşzamanlı denemeler sırayla sayılır. Kilitlenince sayaç sıfırlanır; kilit bitince yeniden 5 hak.
    .set({
      failedLogins: sql`CASE WHEN ${s.users.failedLogins} + 1 >= ${sql.raw(String(MAX_FAILED))} THEN 0 ELSE ${s.users.failedLogins} + 1 END`,
      lockedUntil: sql`CASE WHEN ${s.users.failedLogins} + 1 >= ${sql.raw(String(MAX_FAILED))} THEN now() + interval '${sql.raw(String(LOCK_MINUTES))} minutes' ELSE ${s.users.lockedUntil} END`,
    })
    .where(eq(s.users.id, userId))
    .returning({ failedLogins: s.users.failedLogins, lockedUntil: s.users.lockedUntil });
  return row ? activeLock(row) : null;
}

async function completeLogin(user: typeof s.users.$inferSelect, next: string | undefined, extra: Partial<typeof s.users.$inferInsert> = {}) {
  await getDb()
    .update(s.users)
    .set({ lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null, ...extra })
    .where(eq(s.users.id, user.id));
  const did = await rememberDevice(user.id);
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
  const deviceKey = user?.active ? knownDeviceKey(user.id, await readDevice()) : null;
  const ip = clientIp(await headers());
  if (!deviceKey && loginIp.blocked(ip)) return fail(TOO_MANY);

  // Kayıtsız ya da pasif: parola yine bir özetle denenir, kilit bellekte tutulur (kayıtlı hesapla aynı kural)
  if (!user || !user.active) {
    const until = ghostLock.lockedUntil(email);
    if (until) return fail(lockedMessage(until));
    await verifyPassword(password, await (ghostHash ??= hashPassword("yok")));
    loginIp.hit(ip);
    const locked = ghostLock.fail(email);
    return fail(locked ? lockedMessage(locked) : WRONG);
  }
  const until = deviceKey ? deviceLock.lockedUntil(deviceKey) : activeLock(user);
  if (until) return fail(lockedMessage(until));

  if (!(await verifyPassword(password, user.passwordHash))) {
    let locked: Date | null;
    if (deviceKey) locked = deviceLock.fail(deviceKey);
    else {
      loginIp.hit(ip);
      locked = await registerFailure(user.id);
    }
    return fail(locked ? lockedMessage(locked) : WRONG);
  }

  if (user.totpEnabled && user.totpSecret) {
    await startPending(user, next ?? "");
    return { step: "totp", email };
  }
  await completeLogin(user, next);
  return {};
}

export type TotpState = { error?: string; expired?: boolean };

/** Giriş, ikinci adım: doğrulama uygulamasındaki 6 haneli kod ya da tek seferlik kurtarma kodu */
export async function verifyLoginCodeAction(_prev: TotpState, formData: FormData): Promise<TotpState> {
  const pending = await verifyPending((await cookies()).get(PENDING_COOKIE)?.value);
  if (!pending) return { error: "Süre doldu, yeniden giriş yapın.", expired: true };
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "Kodu girin" };

  const db = getDb();
  const [user] = await db.select().from(s.users).where(eq(s.users.id, Number(pending.sub))).limit(1);
  if (!user || !user.active || !user.totpEnabled || !user.totpSecret || user.sessionVersion !== pending.sv) {
    await clearPending();
    return { error: "Oturum açılamadı, yeniden giriş yapın.", expired: true };
  }
  const deviceKey = knownDeviceKey(user.id, await readDevice());
  const until = deviceKey ? deviceLock.lockedUntil(deviceKey) : activeLock(user);
  if (until) {
    await clearPending();
    return { error: lockedMessage(until), expired: true };
  }

  const secret = open(user.totpSecret, "totp");
  const step = secret ? verifyTotp(secret, code, user.totpLastStep) : null;
  if (step !== null) {
    await completeLogin(user, pending.next, { totpLastStep: step });
    return {};
  }
  const remaining = consumeRecoveryCode(user.recoveryCodes ?? [], code);
  if (remaining) {
    await logActivity(user, "Kurtarma koduyla giriş", `${remaining.length} kod kaldı`);
    await completeLogin(user, pending.next, { recoveryCodes: remaining });
    return {};
  }

  const locked = deviceKey ? deviceLock.fail(deviceKey) : await registerFailure(user.id);
  await slow();
  if (locked) {
    await clearPending();
    return { error: lockedMessage(locked), expired: true };
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

/** Oturum sürümünü artırır (diğer cihazlardaki oturumlar kapanır) ve bu cihazın oturumunu yeniler */
async function rotateSessions(userId: number) {
  const [u] = await getDb()
    .update(s.users)
    .set({ sessionVersion: sql`${s.users.sessionVersion} + 1` })
    .where(eq(s.users.id, userId))
    .returning();
  if (u) await startSession(u);
}

export type PasswordState = { error?: string; ok?: boolean };

export async function changePasswordAction(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const me = await requireUser();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const repeat = String(formData.get("repeat") ?? "");
  if (next.length < 8) return { error: "Yeni parola en az 8 karakter olmalı" };
  if (next !== repeat) return { error: "Yeni parolalar aynı değil" };
  const db = getDb();
  const [u] = await db.select().from(s.users).where(eq(s.users.id, me.id)).limit(1);
  if (!u || !(await verifyPassword(current, u.passwordHash))) return { error: "Mevcut parola hatalı" };
  await db.update(s.users).set({ passwordHash: await hashPassword(next) }).where(eq(s.users.id, me.id));
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
    const [u] = await db.select().from(s.users).where(eq(s.users.id, me.id)).limit(1);
    if (!u || !(await verifyPassword(data.password, u.passwordHash))) throw new UserError("Parola hatalı");
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

// ---------------------------------------------------------------- İki adımlı doğrulama

/** Kurulumu başlatır: yeni anahtar (henüz açık değil) ve QR kodu */
export async function beginTotpSetup() {
  return attempt(async () => {
    const me = await requireUser();
    const db = getDb();
    const [u] = await db.select().from(s.users).where(eq(s.users.id, me.id)).limit(1);
    if (!u) throw new UserError("Kullanıcı bulunamadı");
    if (u.totpEnabled) throw new UserError("İki adımlı doğrulama zaten açık");
    const secret = generateTotpSecret();
    await db.update(s.users).set({ totpSecret: seal(secret, "totp"), totpLastStep: null }).where(eq(s.users.id, me.id));
    const uri = otpauthUri(u.email, secret);
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 232, errorCorrectionLevel: "M", color: { dark: "#18181b", light: "#ffffff" } });
    return { qr, secret: formatSecret(secret), uri };
  });
}

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
      .set({ totpEnabled: true, totpLastStep: step, recoveryCodes: codes.map(hashRecoveryCode) })
      .where(eq(s.users.id, me.id));
    await rotateSessions(me.id);
    await logActivity(me, "İki adımlı doğrulama açıldı", me.email);
    return { codes };
  });
}

const passwordOnly = z.string().min(1, "Parolanızı girin");

/** Kapatma parola ister */
export async function disableTotp(password: string) {
  return attempt(async () => {
    const me = await requireUser();
    passwordOnly.parse(password);
    const db = getDb();
    const [u] = await db.select().from(s.users).where(eq(s.users.id, me.id)).limit(1);
    if (!u || !(await verifyPassword(password, u.passwordHash))) throw new UserError("Parola hatalı");
    await db.update(s.users).set({ totpEnabled: false, totpSecret: null, totpLastStep: null, recoveryCodes: null }).where(eq(s.users.id, me.id));
    await rotateSessions(me.id);
    await logActivity(me, "İki adımlı doğrulama kapatıldı", me.email);
    return null;
  });
}

/** Yeni kurtarma kodları (eskiler geçersiz olur) */
export async function regenerateRecoveryCodes(password: string) {
  return attempt(async () => {
    const me = await requireUser();
    passwordOnly.parse(password);
    const db = getDb();
    const [u] = await db.select().from(s.users).where(eq(s.users.id, me.id)).limit(1);
    if (!u || !(await verifyPassword(password, u.passwordHash))) throw new UserError("Parola hatalı");
    if (!u.totpEnabled) throw new UserError("İki adımlı doğrulama kapalı");
    const codes = generateRecoveryCodes();
    await db.update(s.users).set({ recoveryCodes: codes.map(hashRecoveryCode) }).where(eq(s.users.id, me.id));
    await logActivity(me, "Kurtarma kodları yenilendi", me.email);
    return { codes };
  });
}
