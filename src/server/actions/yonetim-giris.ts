"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { needsTwoFactorSetup } from "@/lib/admin-security";
import { isAnaAdmin, isAnaAdminEmail } from "@/lib/asil-yonetici";
import { YONETIM_GIRIS, YONETIM_KURULUM_GEREKLI, YONETIM_YOLU } from "@/lib/yonetim-host";
import { clearYonetimPending, endYonetimSession, readDevice, readYonetimPending, rememberDevice, startYonetimPending, startYonetimSession } from "@/server/auth/dal";
import { charge, ghostAttempt, knownDeviceId, lockedMessage, logLock, loginIp, padTo, refund, secondFactorOk, slow, TOO_MANY, WRONG } from "@/server/auth/giris-korumalari";
import { clearDeviceAttempts } from "@/server/auth/login-locks";
import { noteNewDevice } from "@/server/auth/new-device";
import { verifyPassword } from "@/server/auth/password";
import { clientIp } from "@/server/auth/rate-limit";
import { deviceSeenBefore, verifyYonetimPending } from "@/server/auth/session";
import { wrongLoginCodeMessage } from "@/server/auth/totp";
import { getDb, schema as s } from "@/server/db";

/*
 * Yönetim konsolunun girişi (docs/planlar/yonetim-konsolu.md › Kim girer; sayfa src/app/yonetim/giris). Yalnız asıl
 * yönetici (docs/ROLLER.md › Asıl yönetici):
 * - Asıl yöneticinin adresi dışındaki HER e-posta (başka bir yöneticinin doğru parolasıyla bile) parolaya ve hesabın
 *   varlığına bakılmadan kayıtsız e-posta gibi yanıtlanır (giris-korumalari.ts › ghostAttempt): aynı süre, aynı söz
 *   ("E-posta ya da parola hatalı"); o hesabın kilit sayacına dokunulmaz, oturum açılmaz, e-posta gitmez, son giriş
 *   zamanı yazılmaz. Asıl yöneticinin adresi ama hesap yok, pasif ya da yönetici değilse de aynısı.
 * - Asıl yönetici için panelin korumaları aynen: IP sınırı, hesap kilidi ve bilinen cihazın payı (sayaçlar panelle
 *   ortak), iki adımlı kod ya da kurtarma kodu, yeni cihaz e-postası. İki adımlı zorunluyken (ADMIN_2FA_REQUIRED) kurmamış
 *   hesap konsola giremez: kurulum ladmin'de (panelin kurulum ekranı panel oturumu ister).
 * - Başarıda yalnız konsol çerezi yazılır (src/server/auth/dal.ts › startYonetimSession) ve /yonetim açılır; panelin
 *   oturumuna dokunulmaz. Çıkış da yalnız konsol çerezini siler.
 * Parola, kod ve belirteç hiçbir kayda ya da günlüğe yazılmaz.
 */

export type YonetimGirisState = { error?: string; email?: string; step?: "totp"; kurulum?: boolean };
/** Panelin kod adımıyla aynı biçim (src/app/giris/login-form.tsx › CodeStep) */
export type YonetimKodState = { error?: string; expired?: boolean };

const girisSchema = z.object({
  email: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin"),
  password: z.string().min(1, "Parola gerekli"),
});

/** Başarılı giriş: sayaçlar sıfırlanır, cihaz bilinir, konsol oturumu açılır, yeni cihazsa uyarı; sonra /yonetim */
async function tamamla(user: typeof s.users.$inferSelect): Promise<never> {
  await getDb().update(s.users).set({ lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null }).where(eq(s.users.id, user.id));
  // Yeni cihaz (src/lib/admin-security.ts): bu tarayıcıdan bu hesapla daha önce giriş yapılmadıysa; konsolun adresinde
  // cihaz çerezi ayrı olduğu için ilk konsol girişi yeni cihaz sayılır (giriş sayfası bunu söyler)
  const fresh = user.lastLoginAt !== null && !deviceSeenBefore(await readDevice(), user.id);
  const did = await rememberDevice(user);
  await clearDeviceAttempts(getDb(), user.id, did);
  await startYonetimSession(user);
  if (fresh) await noteNewDevice(user, await headers()).catch((e: unknown) => console.error("[konsol girişi] yeni cihaz uyarısı", e));
  redirect(YONETIM_YOLU);
}

export async function yonetimGirisAction(_prev: YonetimGirisState, formData: FormData): Promise<YonetimGirisState> {
  const started = Date.now();
  const parsed = girisSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, email: String(formData.get("email") ?? "") };
  const { email, password } = parsed.data;

  // Her başarısız yanıt aynı sürede ve aynı sözlerle döner: asıl yönetici, başka hesap ve kayıtsız adres ayırt edilemesin
  const fail = async (error: string): Promise<YonetimGirisState> => {
    await padTo(started);
    return { error, email };
  };
  const ip = clientIp(await headers());
  // Her deneme IP'nin payından düşer (panelle aynı pay); doğru parola geri verir
  if (!loginIp.hit(ip)) return fail(TOO_MANY);

  const [user] = isAnaAdminEmail(email) ? await getDb().select().from(s.users).where(eq(s.users.email, email)).limit(1) : [];
  // Asıl yönetici değil (adres başka, hesap yok, pasif ya da yönetici değil): hesaba hiç dokunulmadan kayıtsız e-posta gibi
  if (!user || !user.active || !isAnaAdmin(user)) {
    const g = await ghostAttempt(email, password);
    if (g.undoIp) loginIp.undo(ip);
    return fail(g.error);
  }

  const deviceId = knownDeviceId(user, await readDevice());
  const r = await charge(user.id, deviceId);
  if (!r.ok) {
    // Kilitliyken deneme değerlendirilmez; IP'nin payından da düşmez
    loginIp.undo(ip);
    return fail(lockedMessage(r.until));
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    if (r.locked) await logLock(user, "parola (yönetim konsolu)", deviceId);
    return fail(r.locked ? lockedMessage(r.locked) : WRONG);
  }
  loginIp.undo(ip);

  if (user.totpEnabled && user.totpSecret) {
    await refund(user.id, deviceId);
    await startYonetimPending(user);
    return { step: "totp", email };
  }
  if (needsTwoFactorSetup(user)) {
    // Parola doğru ama zorunlu iki adımlı kurulmamış: konsol oturumu açılmaz, deneme geri verilir
    await refund(user.id, deviceId);
    return { error: YONETIM_KURULUM_GEREKLI, email, kurulum: true };
  }
  return tamamla(user);
}

/** Konsolun ikinci adımı: doğrulama uygulamasındaki 6 haneli kod ya da tek seferlik kurtarma kodu (panelinkiyle aynı kural) */
export async function yonetimKodAction(_prev: YonetimKodState, formData: FormData): Promise<YonetimKodState> {
  const pending = await verifyYonetimPending(await readYonetimPending());
  if (!pending) return { error: "Süre doldu, yeniden giriş yapın.", expired: true };
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "Kodu girin" };

  const [user] = await getDb().select().from(s.users).where(eq(s.users.id, Number(pending.sub))).limit(1);
  // Arada LADMIN_ANA_ADMIN değiştiyse, hesap pasifleştiyse ya da parola değiştiyse kod adımı geçmez
  if (!user || !user.active || !isAnaAdmin(user) || !user.totpEnabled || !user.totpSecret || user.sessionVersion !== pending.sv) {
    await clearYonetimPending();
    return { error: "Oturum açılamadı, yeniden giriş yapın.", expired: true };
  }
  const deviceId = knownDeviceId(user, await readDevice());
  // Kod da doğrulanmadan önce sayılır (panelle ortak pay)
  const r = await charge(user.id, deviceId);
  if (!r.ok) {
    await clearYonetimPending();
    return { error: lockedMessage(r.until), expired: true };
  }
  if (await secondFactorOk(user, code, "Yönetim konsolu")) return tamamla(user);

  if (r.locked) await logLock(user, "iki adımlı kod (yönetim konsolu)", deviceId);
  await slow();
  if (r.locked) {
    await clearYonetimPending();
    return { error: lockedMessage(r.locked), expired: true };
  }
  return { error: wrongLoginCodeMessage(code, formData.get("mode") === "recovery") };
}

/** Kod adımından "Geri": bekleyen kod adımının çerezi silinir */
export async function yonetimKodVazgecAction() {
  await clearYonetimPending();
}

/** Konsoldan çıkış: yalnız konsol oturumu kapanır (ladmin'deki oturum açık kalır) */
export async function yonetimCikisAction() {
  await endYonetimSession();
  redirect(YONETIM_GIRIS);
}
