"use server";

import { and, count, eq, ne, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { z } from "zod";

import { nameTakenBy, sameName } from "@/lib/activity-person";
import { ASIL_EPOSTA_SABIT, asilAdresRet, isAnaAdminEmail } from "@/lib/asil-yonetici";
import { needsTwoFactorSetup, twoFactorSetupHref } from "@/lib/admin-security";
import { PROFILE_LIST_REFUSAL, PROFILE_OWN_LIST_REFUSAL } from "@/lib/notify-recipients";
import type { Role } from "@/lib/constants";
import { canOpen, homeFor } from "@/lib/roles";
import { WRONG_PASSWORD } from "@/lib/step-up";
import { openPendingSecret, pendingSecret, SETUP_EXPIRED, SETUP_MAX, SETUP_STOPPED } from "@/lib/two-factor-setup";
import { hashPassword, passwordProblem, verifyPassword } from "@/server/auth/password";
import { clearPending, endSession, managerWithoutBranch, readDevice, readPending, rememberDevice, requireSignedIn, requireUser, startPending, startSession } from "@/server/auth/dal";
import { charge, ghostAttempt, knownDeviceId, LOCK_MS, lockedMessage, logLock, loginIp, padTo, refund, slow, TOO_MANY, WRONG } from "@/server/auth/giris-korumalari";
import { clearDeviceAttempts, consumeRecoveryList, consumeTotpStep } from "@/server/auth/login-locks";
import { clientIp, createLimiter } from "@/server/auth/rate-limit";
import { noteNewDevice } from "@/server/auth/new-device";
import { deviceSeenBefore, verifyPending } from "@/server/auth/session";
import { confirmPassword, requirePassword } from "@/server/auth/step-up";
import {
  consumeRecoveryCode,
  formatSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUri,
  verifyTotp,
  wrongLoginCodeMessage,
} from "@/server/auth/totp";
import { expireUserTokens } from "@/server/auth/user-tokens";
import { getDb, schema as s } from "@/server/db";
import { listsWithEmail } from "@/server/notify/recipients";
import { open, seal } from "@/server/secret-box";

import { logActivity } from "./log";
import { attempt, UserError, zText } from "./util";

/*
 * Girişin korumaları (IP sınırı, hesap kilidi, bilinen cihazın payı, kayıtsız e-postada sahte bekleme, kilidin işlem
 * geçmişi) kasa açılışının girişiyle ortak: src/server/auth/giris-korumalari.ts. Davranış ve sayaçlar aynı.
 */

export type LoginState = { error?: string; email?: string; step?: "password" | "totp" };

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin"),
  password: z.string().min(1, "Parola gerekli"),
  next: z.string().optional(),
});

/**
 * Girişten sonra gidilecek adres: yalnız panel içi ve rolün açabildiği bir ekran ya da Claude bağlantısının onay ekranı
 * (/baglan?istek=…), yoksa rolün ana sayfası
 */
function safeNext(next: string | undefined, role: Role) {
  const fallback = homeFor(role);
  if (!next || !(next.startsWith("/panel") || next.startsWith("/baglan?")) || next.startsWith("//") || next.includes("\\")) return fallback;
  return canOpen(role, next.split(/[?#]/)[0]) ? next : fallback;
}

/** Şubesi olmayan ya da şubesi pasif müdürün girişi */
const MANAGER_NO_BRANCH = "Müdür hesabınızın şubesi seçili değil ya da şube kapalı. Yöneticiden Kullanıcılar & roller'de şubenizi seçmesini isteyin.";

async function completeLogin(user: typeof s.users.$inferSelect, next: string | undefined) {
  await getDb().update(s.users).set({ lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null }).where(eq(s.users.id, user.id));
  // Yeni cihaz (src/lib/admin-security.ts): bu tarayıcıdan bu hesapla daha önce giriş yapılmadıysa; hesabın ilk girişi sayılmaz
  const fresh = user.lastLoginAt !== null && !deviceSeenBefore(await readDevice(), user.id);
  const did = await rememberDevice(user);
  await clearDeviceAttempts(getDb(), user.id, did);
  await startSession(user);
  // Uyarı girişi bozmaz (noteNewDevice hata fırlatmamaya çalışır; yine de)
  if (fresh) await noteNewDevice(user, await headers()).catch((e: unknown) => console.error("[giriş] yeni cihaz uyarısı", e));
  const target = safeNext(next, user.role);
  // İki adımlısı kapalı yönetici, müdür ya da muhasebeci panel yerine kurulum ekranına (yalnız ADMIN_2FA_REQUIRED=1 iken zorunlu)
  redirect(needsTwoFactorSetup(user) ? twoFactorSetupHref(target) : target);
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
  const deviceId = user?.active ? knownDeviceId(user, await readDevice()) : null;
  const ip = clientIp(await headers());
  // Her deneme IP'nin payından düşer (bilinen cihazınki de); doğru parola geri verir
  if (!loginIp.hit(ip)) return fail(TOO_MANY);

  // Kayıtsız ya da pasif: parola yine bir özetle denenir, kilit bellekte tutulur (kayıtlı hesapla aynı kural)
  if (!user || !user.active) {
    const g = await ghostAttempt(email, password);
    if (g.undoIp) loginIp.undo(ip);
    return fail(g.error);
  }

  const r = await charge(user.id, deviceId);
  if (!r.ok) {
    // Kilitliyken deneme değerlendirilmez; IP'nin payından da düşmez
    loginIp.undo(ip);
    return fail(lockedMessage(r.until));
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    if (r.locked) await logLock(user, "parola", deviceId);
    return fail(r.locked ? lockedMessage(r.locked) : WRONG);
  }
  loginIp.undo(ip);

  // Müdür şubesine kilitli olmak zorunda (docs/ROLLER.md): şubesi yoksa ya da pasifse giriş açılmaz (oturum da geçmez,
  // src/server/auth/dal.ts › managerWithoutBranch). Parola doğru: nedeni söylenir
  if (user.role === "manager") {
    const [b] = user.branchId ? await db.select({ active: s.branches.active }).from(s.branches).where(eq(s.branches.id, user.branchId)).limit(1) : [];
    if (managerWithoutBranch({ role: user.role, branchId: user.branchId, branchActive: b?.active ?? null })) {
      await refund(user.id, deviceId);
      return fail(MANAGER_NO_BRANCH);
    }
  }

  if (user.totpEnabled && user.totpSecret) {
    await refund(user.id, deviceId);
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
  const deviceId = knownDeviceId(user, await readDevice());
  // Kod da doğrulanmadan önce sayılır: aynı anda gönderilen yüzlerce kod 15 dakikada 5 denemeyi aşamaz
  const r = await charge(user.id, deviceId);
  if (!r.ok) {
    await clearPending();
    return { error: lockedMessage(r.until), expired: true };
  }

  // Kod ve kurtarma kodu oturum açılmadan önce tek yazımda tüketilir: aynı kod aynı anda iki kez gönderilirse yalnız
  // biri geçer (okuyup sonra yazınca ikisi de geçiyordu); yarışı kaybeden geçersiz kod sayılır
  const secret = open(user.totpSecret, "totp");
  const step = secret ? verifyTotp(secret, code, user.totpLastStep) : null;
  if (step !== null && (await consumeTotpStep(getDb(), user.id, step))) {
    await completeLogin(user, pending.next);
    return {};
  }
  const codes = user.recoveryCodes ?? [];
  const remaining = await consumeRecoveryCode(user.id, codes, code);
  if (remaining && (await consumeRecoveryList(getDb(), user.id, codes, remaining))) {
    await logActivity(user, "Kurtarma koduyla giriş", `${remaining.length} kod kaldı`);
    await completeLogin(user, pending.next);
    return {};
  }

  if (r.locked) await logLock(user, "iki adımlı kod", deviceId);
  await slow();
  if (r.locked) {
    await clearPending();
    return { error: lockedMessage(r.locked), expired: true };
  }
  // Kurtarma kodu kipinde (form `mode` gönderir) ya da kod 6 haneli değilse metin kurtarma koduna göre
  return { error: wrongLoginCodeMessage(code, formData.get("mode") === "recovery") };
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

/*
 * Hesabım'daki parola onayı src/server/auth/step-up.ts'te (confirmPassword / requirePassword): kişi başına 15
 * dakikada 5 hata, Kullanıcılar'daki yönetici onaylarıyla aynı pay; hatalı deneme işlem geçmişine yazılır. Buradan
 * dışa açılmaz: "use server" dosyasının dışa açtığı her işlev istemciden çağrılabilir.
 */

export type PasswordState = { error?: string; ok?: boolean };

export async function changePasswordAction(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const me = await requireUser();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const repeat = String(formData.get("repeat") ?? "");
  const problem = passwordProblem(next, me.email);
  if (problem) return { error: problem };
  if (next !== repeat) return { error: "Yeni parolalar aynı değil" };
  const c = await confirmPassword(me, current, "Hesabım");
  if (!c.ok) return { error: c.error === WRONG_PASSWORD ? "Mevcut parola hatalı" : c.error };
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

/**
 * Ad ve giriş e-postası; parola ile onaylanır. Ad başka bir hesabın adı olamaz: işlem geçmişinde ve sitenin olay
 * kaydında o kişi gibi görünmesin (İşlem geçmişi hesabın e-postasını da gösterir, src/lib/activity-person.ts). Asıl
 * yöneticinin e-postası değişmez (yetki adrese bağlı) ve hiçbir hesap adresini asıl yöneticinin adresine çeviremez.
 */
export async function updateProfile(input: z.input<typeof profileSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    const data = profileSchema.parse(input);
    const db = getDb();
    const u = await requirePassword(me, data.password, "Hesabım");
    // Asıl yöneticinin adresi sabit (yetki ona bağlı) ve başka bir hesaba verilemez (docs/ROLLER.md › Asıl yönetici)
    if (data.email !== u.email && isAnaAdminEmail(u.email)) throw new UserError(ASIL_EPOSTA_SABIT);
    const address = asilAdresRet({ next: data.email, before: u.email });
    if (address) throw new UserError(address);
    const [{ n }] = await db
      .select({ n: count() })
      .from(s.users)
      .where(and(eq(s.users.email, data.email), ne(s.users.id, me.id)));
    // Personele "listede" ile "başka hesapta" aynı metin (PROFILE_LIST_REFUSAL): adres deneyerek liste öğrenilmesin
    if (n > 0) throw new UserError(me.role === "admin" ? "Bu e-posta başka bir kullanıcıda kayıtlı" : PROFILE_LIST_REFUSAL);
    // Personel ve müdür giriş e-postasını kasa raporu alıcılarındaki, sabah e-postasının bildirim adreslerindeki ya da
    // muhasebeci paketinin alıcılarındaki bir adrese çeviremez (E-52): gönderim bu hesabın adresini düşürür, e-posta
    // sahibine uyarısız gitmezdi. Kendi adresi bir listedeyken de değiştiremez (E-53): gönderim adresi hesaba bakarak
    // düşürür, hesabı kalmayan eski adres yeniden kasa ve sabah e-postasını ya da bütün şubelerin paketini alır, zil
    // susardı. Yönetici listeyi düzeltir
    if (me.role !== "admin" && data.email !== u.email) {
      if ((await listsWithEmail(u.email)).length) throw new UserError(PROFILE_OWN_LIST_REFUSAL);
      if ((await listsWithEmail(data.email)).length) throw new UserError(PROFILE_LIST_REFUSAL);
    }
    // Ad değişmediyse (eskiden aynı adla açılmış iki hesap) e-posta yine değiştirilebilir
    if (!sameName(data.name, u.name) && nameTakenBy(data.name, me.id, await db.select({ id: s.users.id, name: s.users.name }).from(s.users))) {
      throw new UserError("Bu ad başka bir kullanıcıda kayıtlı; ayırt edilecek bir ad yazın (ör. soyadının baş harfiyle)");
    }
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
    await requirePassword(me, password, "Hesabım");
    await rotateSessions(me.id);
    await logActivity(me, "Diğer cihazlardaki oturumlar kapatıldı", me.email);
    return null;
  });
}

// ---------------------------------------------------------------- İki adımlı doğrulama

/**
 * Kurulum onayının hatalı kodları, bekleyen anahtar başına (anahtar her kurulumda yeniden şifrelenir: yeni kurulum
 * yeni sayaç). Bellekte, örnek başına: ilk savunma; sınıra ulaşan hata anahtarı veritabanından siler, bu bütün örneklere
 * geçer (src/lib/two-factor-setup.ts, denetim YO-05).
 */
const setupFails = createLimiter({ limit: SETUP_MAX, windowMs: LOCK_MS });

/** Onaylanmamış anahtarı siler (açık iki adımlıya ve bu arada başlamış yeni kuruluma dokunmaz) */
async function dropPendingSecret(userId: number, sealed?: string) {
  await getDb()
    .update(s.users)
    .set({ totpSecret: null, totpLastStep: null })
    .where(and(eq(s.users.id, userId), eq(s.users.totpEnabled, false), sealed ? eq(s.users.totpSecret, sealed) : undefined));
}

/**
 * Kurulumu başlatır: yeni anahtar (henüz açık değil, SETUP_MINUTES dakika geçerli) ve QR kodu. Parola ister: açık kalmış
 * bir oturumla başkası kendi telefonunu bağlayıp sahibini dışarıda bırakamasın.
 */
export async function beginTotpSetup(password: string) {
  return attempt(async () => {
    // Kurulum ekranından da (iki adımlısı olmayan yönetici, müdür ya da muhasebeci; src/lib/admin-security.ts) çağrılır
    const me = await requireSignedIn();
    const u = await requirePassword(me, password, "Hesabım");
    if (u.totpEnabled) throw new UserError("İki adımlı doğrulama zaten açık");
    const secret = generateTotpSecret();
    await getDb().update(s.users).set({ totpSecret: seal(pendingSecret(secret), "totp"), totpLastStep: null }).where(eq(s.users.id, me.id));
    const uri = otpauthUri(u.email, secret);
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 232, errorCorrectionLevel: "M", color: { dark: "#18181b", light: "#ffffff" } });
    return { qr, secret: formatSecret(secret), uri };
  });
}

/** Kurtarma kodlarının saklanan özetleri (kişiye özel, yavaş özet; totp.ts) */
const hashCodes = (userId: number, codes: string[]) => Promise.all(codes.map((c) => hashRecoveryCode(userId, c)));

/**
 * Uygulamadaki kodla kurulumu onaylar; kurtarma kodlarını bir kez gösterilmek üzere döndürür. Parola istemez (kurulumu
 * başlatmak istedi), bu yüzden sınırlıdır: bekleyen anahtar SETUP_MINUTES dakika geçerli, onunla en çok SETUP_MAX hatalı
 * kod; süresi geçen ya da sınıra ulaşan anahtar silinir, kurulum parolayla yeniden başlar ve işlem geçmişine yazılır
 * (denetim YO-05).
 */
export async function confirmTotpSetup(code: string) {
  return attempt(async () => {
    const me = await requireSignedIn();
    const db = getDb();
    const [u] = await db.select().from(s.users).where(eq(s.users.id, me.id)).limit(1);
    if (!u?.totpSecret || u.totpEnabled) throw new UserError("Önce kurulumu başlatın");
    const sealed = u.totpSecret;
    const secret = openPendingSecret(open(sealed, "totp"));
    if (!secret) {
      await dropPendingSecret(me.id, sealed);
      throw new UserError(SETUP_EXPIRED);
    }
    // Deneme doğrulamadan ÖNCE sayılır: aynı anda gönderilen kodlar da sınırı aşamaz
    const key = `${me.id}:${sealed}`;
    if (!setupFails.hit(key)) {
      await dropPendingSecret(me.id, sealed);
      throw new UserError(SETUP_STOPPED);
    }
    const step = verifyTotp(secret, String(code), null);
    if (step === null) {
      if (!setupFails.blocked(key)) throw new UserError("Kod tutmadı. Telefonun saati doğru mu? Uygulamadaki güncel kodu girin.");
      await dropPendingSecret(me.id, sealed);
      await logActivity(me, "İki adımlı kurulum durduruldu", `${me.email}: ${SETUP_MAX} hatalı kod`);
      throw new UserError(SETUP_STOPPED);
    }
    const codes = generateRecoveryCodes();
    // Anahtar onaylanmış biçimde yeniden yazılır; okunan bekleyen anahtar bu arada değiştiyse (yeni kurulum, silindi) açılmaz
    const [done] = await db
      .update(s.users)
      .set({ totpSecret: seal(secret, "totp"), totpEnabled: true, totpLastStep: step, recoveryCodes: await hashCodes(me.id, codes) })
      .where(and(eq(s.users.id, me.id), eq(s.users.totpSecret, sealed), eq(s.users.totpEnabled, false)))
      .returning({ id: s.users.id });
    if (!done) throw new UserError("Önce kurulumu başlatın");
    await rotateSessions(me.id);
    await logActivity(me, "İki adımlı doğrulama açıldı", me.email);
    return { codes };
  });
}

/**
 * Kurulum penceresi kapandı: onaylanmamış anahtar silinir (açık iki adımlıya dokunmaz). Yarım bırakılan kurulumun
 * anahtarı veritabanında beklemesin; pencere kapanmadan bırakıldıysa süresi (SETUP_MINUTES) dolunca onaylanamaz.
 */
export async function cancelTotpSetup() {
  return attempt(async () => {
    const me = await requireSignedIn();
    await dropPendingSecret(me.id);
    return null;
  });
}

/** Kapatma parola ister */
export async function disableTotp(password: string) {
  return attempt(async () => {
    const me = await requireUser();
    await requirePassword(me, password, "Hesabım");
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
    const u = await requirePassword(me, password, "Hesabım");
    if (!u.totpEnabled) throw new UserError("İki adımlı doğrulama kapalı");
    const codes = generateRecoveryCodes();
    await getDb().update(s.users).set({ recoveryCodes: await hashCodes(me.id, codes) }).where(eq(s.users.id, me.id));
    await logActivity(me, "Kurtarma kodları yenilendi", me.email);
    return { codes };
  });
}
