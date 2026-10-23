"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";
import { z } from "zod";

import { ACCESS_REASONS, accessEmail, linkAccessInfo, type AccessInfo, type AccessKind } from "@/app/panel/kullanicilar/access";
import { needsStepUp, stepUpWhat, type StepUpCase, type StepUpConfirm } from "@/lib/step-up";
import { openAccessMailHandle } from "@/server/auth/access-handle";
import { requireAdmin } from "@/server/auth/dal";
import { hashPassword, passwordProblem, verifyPassword } from "@/server/auth/password";
import { clientIp, createLimiter } from "@/server/auth/rate-limit";
import { requireStepUp } from "@/server/auth/step-up";
import { appUrl, isPendingInvite, TOKEN_HOURS, tokenStatus, type TokenKind, type TokenStatus } from "@/server/auth/tokens";
import { consumeTokenAndSetPassword, countTokenAttempt, issueUserToken, loadToken, recentResetCount } from "@/server/auth/user-tokens";
import { getDb, schema as s } from "@/server/db";
import { isEmailConfigured, resolveFrom, sendEmail } from "@/server/notify/resend";
import { loadNotifySettings } from "@/server/notify/settings";

import { logActivity } from "./log";
import { attempt, UserError } from "./util";

/*
 * Davet ve parola sıfırlama. Yönetici eylemleri requireAdmin ister; /davet ve "Parolamı unuttum" eylemleri
 * herkese açıktır, bu yüzden IP, e-posta ve bağlantı başına sınırlanır. Ham anahtar ve parola hiçbir zaman
 * günlüğe yazılmaz.
 */

const zId = z.number().int().positive();

const linkInfo = (user: { id: number; name: string; email: string }, kind: TokenKind, raw: string, expiresAt: Date) =>
  linkAccessInfo(appUrl(), user, kind, raw, expiresAt);

/**
 * Yönetici: davet bekleyen kişiye yeni davet bağlantısı (72 saat), parolası olan kişiye parola sıfırlama
 * bağlantısı (24 saat). Eski bağlantı hemen geçersiz olur. Kişinin mevcut parolası bağlantı kullanılana kadar değişmez.
 * Yöneticiye bağlantı işlemi yapanın kendi parolasını ister: bağlantıyı alan kişi yönetici hesabına parola belirler.
 */
export async function createAccessLink(id: number, confirm?: StepUpConfirm) {
  return attempt(async () => {
    const me = await requireAdmin();
    const userId = zId.parse(id);
    // Kendi parolanız Hesabım'da (mevcut parolayla) değişir: kendine alınan bağlantı o parola onayını atlatmasın
    if (userId === me.id) throw new UserError("Kendi parolanızı Hesabım'dan değiştirin");
    const [u] = await getDb()
      .select({ id: s.users.id, name: s.users.name, email: s.users.email, role: s.users.role, active: s.users.active, passwordHash: s.users.passwordHash })
      .from(s.users)
      .where(eq(s.users.id, userId))
      .limit(1);
    if (!u) throw new UserError("Kullanıcı bulunamadı");
    if (!u.active) throw new UserError("Pasif kullanıcıya bağlantı oluşturulamaz; önce aktif yapın");
    const change: StepUpCase = { kind: "link", targetRole: u.role };
    if (needsStepUp(change)) await requireStepUp(me, confirm, `${stepUpWhat(change)}: ${u.email}`);
    const kind: TokenKind = isPendingInvite(u.passwordHash) ? "invite" : "reset";
    const { raw, expiresAt } = await issueUserToken(u.id, kind, kind === "invite" ? TOKEN_HOURS.invite : TOKEN_HOURS.reset);
    await logActivity(me, kind === "invite" ? "Davet bağlantısı yenilendi" : "Parola sıfırlama bağlantısı oluşturuldu", `${u.name} (${u.email})`);
    refresh();
    return linkInfo(u, kind, raw, expiresAt);
  });
}

const emailSchema = z.object({
  userId: zId,
  kind: z.enum(["password", "invite", "reset"]),
  /** "password": kaydederken dönen mühürlü kopya (accessMailHandle); "invite"/"reset": bağlantının ham anahtarı */
  secret: z.string().min(1).max(2000),
  /** Yeni kullanıcı mı, davetliye ya da var olan kişiye parola mı, yenilenen bağlantı mı (e-postanın metni) */
  reason: z.enum(ACCESS_REASONS).optional(),
});

/**
 * Yönetici: "Giriş bilgileri"ni kişinin giriş e-postasına gönderir (Resend). Parola yerine kaydederken dönen mühürlü
 * kopya gelir (15 dakika; eylem parola tahmini için kullanılamasın); içindeki parola hâlâ kişinin parolası olmalı.
 * Bağlantı kişinin geçerli bağlantısıyla eşleşmelidir.
 */
export async function emailAccess(input: z.input<typeof emailSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = emailSchema.parse(input);
    if (!isEmailConfigured()) throw new UserError("E-posta gönderimi kapalı (RESEND_API_KEY tanımlı değil); bilgileri kopyalayıp iletin");
    const [u] = await getDb()
      .select({ id: s.users.id, name: s.users.name, email: s.users.email, active: s.users.active, passwordHash: s.users.passwordHash })
      .from(s.users)
      .where(eq(s.users.id, data.userId))
      .limit(1);
    if (!u) throw new UserError("Kullanıcı bulunamadı");
    let info: AccessInfo;
    if (data.kind === "password") {
      const password = openAccessMailHandle(data.secret, u.id);
      if (!password) throw new UserError("Parolanın e-postayla gönderilme süresi (15 dakika) doldu; kopyalayıp iletin ya da yeniden belirleyin");
      if (!(await verifyPassword(password, u.passwordHash))) throw new UserError("Parola artık bu kullanıcının parolası değil; yeniden belirleyin");
      info = { kind: "password", reason: data.reason, userId: u.id, name: u.name, email: u.email, loginUrl: `${appUrl()}/giris`, password };
    } else {
      const found = await loadToken(data.secret);
      if (!found || found.token.userId !== u.id || found.token.kind !== data.kind || tokenStatus(found.token, found.user) !== "ok") {
        throw new UserError("Bu bağlantı artık geçerli değil; yeni bağlantı oluşturun");
      }
      info = { ...linkInfo(u, data.kind, data.secret, found.token.expiresAt), reason: data.reason };
    }
    const mail = accessEmail(info);
    const notify = await loadNotifySettings();
    const res = await sendEmail({ from: resolveFrom(notify.from), to: [u.email], subject: mail.subject, html: mail.html, text: mail.text });
    if (!res.ok) throw new UserError(res.error);
    const label: Record<AccessKind, string> = { password: "Giriş bilgileri e-postayla gönderildi", invite: "Davet e-postayla gönderildi", reset: "Sıfırlama bağlantısı e-postayla gönderildi" };
    await logActivity(me, label[data.kind], u.email);
    return { to: u.email };
  });
}

// ---------------------------------------------------------------- Herkese açık: /davet

/** Aynı IP'den 15 dakikada en fazla 20 parola belirleme denemesi */
const setPasswordIp = createLimiter({ limit: 20, windowMs: 15 * 60_000 });

export type SetPasswordState = {
  error?: string;
  /** Bağlantı kullanılamaz (geçersiz, süresi dolmuş, kullanılmış): sayfa formu kaldırır */
  status?: Exclude<TokenStatus, "ok"> | "invalid";
  done?: boolean;
};

/**
 * /davet: bağlantıdaki anahtarla yeni parolayı yazar, bağlantıyı kullanılmış sayar, kişinin oturum sürümünü artırır.
 * Oturum AÇMAZ (aynı tarayıcıdaki diğer sekmeler aynı çerezi paylaşır); kişi ardından /giris'ten girer.
 */
export async function setPasswordWithToken(_prev: SetPasswordState, formData: FormData): Promise<SetPasswordState> {
  const raw = formData.get("t");
  const password = String(formData.get("password") ?? "");
  const repeat = String(formData.get("repeat") ?? "");
  if (!setPasswordIp.hit(clientIp(await headers()))) return { error: "Çok fazla deneme yapıldı. 15 dakika sonra yeniden deneyin." };
  const found = await loadToken(raw);
  if (!found) return { status: "invalid" };
  const attempts = await countTokenAttempt(found.token.id);
  const status = tokenStatus({ ...found.token, attempts: attempts - 1 }, found.user);
  if (status !== "ok") return { status };

  const problem = passwordProblem(password, found.user.email);
  if (problem) return { error: problem };
  if (password !== repeat) return { error: "İki parola aynı değil" };

  const ok = await consumeTokenAndSetPassword(found.token.id, found.user.id, await hashPassword(password));
  if (!ok) return { status: "used" };
  await logActivity({ id: found.user.id, name: found.user.name }, found.token.kind === "invite" ? "Davet kabul edildi, parola belirlendi" : "Parola bağlantıyla sıfırlandı", found.user.email);
  return { done: true };
}

// ---------------------------------------------------------------- Herkese açık: "Parolamı unuttum"

/** Aynı IP'den 15 dakikada 10, aynı e-posta için saatte 3 istek; kişi başına saatte en fazla 3 bağlantı (veritabanı) */
const forgotIp = createLimiter({ limit: 10, windowMs: 15 * 60_000 });
const forgotEmail = createLimiter({ limit: 3, windowMs: 60 * 60_000 });
const RESETS_PER_HOUR = 3;

export type ForgotState = { message?: string; tone?: "ok" | "info"; error?: string };

const GENERIC = `Bu e-posta kayıtlıysa parola sıfırlama bağlantısı gönderildi. Gelen kutunuza (ve istenmeyen klasörüne) bakın; bağlantı ${TOKEN_HOURS.forgot} saat geçerli.`;
const NO_EMAIL = "Bu panelde e-posta gönderimi kapalı. Parolanızı sıfırlaması için yöneticinize başvurun; size yeni bir bağlantı iletebilir.";

/** Yanıt süresi kayıtlı / kayıtsız e-postada aynı olsun (hesap var mı yok mu süreden anlaşılmasın) */
async function padTo(started: number, ms: number) {
  const left = ms - (Date.now() - started);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
}

/**
 * Giriş sayfası: her durumda aynı genel yanıt ("kayıtlıysa gönderildi"). Resend kuruluysa ve kişi aktifse
 * 2 saatlik sıfırlama bağlantısı gönderilir; kurulu değilse kişiye yöneticisine başvurması söylenir.
 */
export async function requestPasswordReset(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const started = Date.now();
  const parsed = z.string().trim().toLowerCase().email().max(200).safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Geçerli bir e-posta girin" };
  if (!isEmailConfigured()) return { message: NO_EMAIL, tone: "info" };
  const email = parsed.data;
  if (!forgotIp.hit(clientIp(await headers())) || !forgotEmail.hit(email)) {
    await padTo(started, 800);
    return { error: "Çok fazla istek yapıldı. Biraz sonra yeniden deneyin." };
  }
  // Arama ve gönderim yanıttan sonra çalışır: yanıt süresi hesabın var olup olmadığını ele vermez
  after(async () => {
    try {
      const [u] = await getDb()
        .select({ id: s.users.id, name: s.users.name, email: s.users.email, active: s.users.active })
        .from(s.users)
        .where(eq(s.users.email, email))
        .limit(1);
      if (!u?.active || (await recentResetCount(u.id, 60)) >= RESETS_PER_HOUR) return;
      const { raw, expiresAt } = await issueUserToken(u.id, "reset", TOKEN_HOURS.forgot);
      const mail = accessEmail(linkInfo(u, "reset", raw, expiresAt));
      const notify = await loadNotifySettings();
      const res = await sendEmail({ from: resolveFrom(notify.from), to: [u.email], subject: mail.subject, html: mail.html, text: mail.text });
      if (res.ok) await logActivity({ id: u.id, name: u.name }, "Parola sıfırlama istendi", u.email);
      else console.error("Parola sıfırlama e-postası gönderilemedi:", res.error);
    } catch (e) {
      console.error("Parola sıfırlama isteği:", (e as Error).message);
    }
  });
  await padTo(started, 800);
  return { message: GENERIC, tone: "ok" };
}
