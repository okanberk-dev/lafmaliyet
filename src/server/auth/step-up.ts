import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { PASSWORD_MISSING, REAUTH_LIMIT, REAUTH_MINUTES, STEP_UP_REQUIRED, TOO_MANY_REAUTH, WRONG_PASSWORD, type StepUpConfirm } from "@/lib/step-up";
import { logActivity } from "@/server/actions/log";
import { UserError } from "@/server/actions/util";
import { getDb, schema as s } from "@/server/db";

import type { CurrentUser } from "./dal";
import { verifyPassword } from "./password";
import { createLimiter } from "./rate-limit";

/*
 * Değişikliği onaylayan parola: Hesabım (parola, e-posta, iki adımlı doğrulama, oturumları kapat) ve Kullanıcılar
 * (yönetici işlemleri, kural src/lib/step-up.ts'te). Bu dosya bilerek "use server" değil: buradaki işlevler istemciden
 * çağrılabilseydi oturumu açık herkese bir parola deneme kapısı olurdu. Eylemler bunları içeriden çağırır.
 */

/**
 * İşlem geçmişindeki "Hatalı parola onayı (…)" satırının yeri. "Yedek": yedekten geri yükleme de aynı onayı kullanır;
 * "Claude bağlantısı": onay ekranında (/baglan) izin verirken
 */
export type StepUpWhere = "Hesabım" | "Kullanıcılar" | "Yedek" | "Claude bağlantısı";

/**
 * Kişi başına 15 dakikada 5 hata; bütün yerler aynı payı kullanır (açık kalmış bir oturumla her ekranda ayrı 5 tahmin
 * yapılamasın). Giriş kilidine dokunmaz: sahibi kendi girişini kilitlemez. Bellekte, örnek başına: ilk savunma.
 */
const reauthFails = createLimiter({ limit: REAUTH_LIMIT, windowMs: REAUTH_MINUTES * 60_000 });

const passwordOnly = z.string().min(1, PASSWORD_MISSING);

/**
 * Deneme doğrulamadan ÖNCE sayılır (eşzamanlı istekler sınırı aşamasın), doğrusu geri verilir. Hatalı deneme işlem
 * geçmişine yazılır; `what` neyin denendiğini ekler (Hesabım'ın satırı eskisiyle aynı kalsın diye orada verilmez).
 */
export async function confirmPassword(
  me: CurrentUser,
  password: string,
  where: StepUpWhere,
  what?: string,
): Promise<{ ok: true; user: typeof s.users.$inferSelect } | { ok: false; error: string }> {
  const key = String(me.id);
  if (!reauthFails.hit(key)) return { ok: false, error: TOO_MANY_REAUTH };
  const [u] = await getDb().select().from(s.users).where(eq(s.users.id, me.id)).limit(1);
  if (u && (await verifyPassword(password, u.passwordHash))) {
    reauthFails.undo(key);
    return { ok: true, user: u };
  }
  await logActivity(me, `Hatalı parola onayı (${where})`, what ? `${me.email} · ${what}` : me.email);
  return { ok: false, error: WRONG_PASSWORD };
}

/** attempt() içindeki eylemler için: parola boşsa "Parolanızı girin", tutmazsa kullanıcıya gösterilen hata */
export async function requirePassword(me: CurrentUser, password: string, where: StepUpWhere, what?: string) {
  passwordOnly.parse(password);
  const c = await confirmPassword(me, password, where, what);
  if (!c.ok) throw new UserError(c.error);
  return c.user;
}

/** Parolalar en çok 200 karakter: daha uzunu kimsenin parolası olamaz */
const zConfirm: z.ZodType<StepUpConfirm | undefined> = z.object({ password: z.string().max(200, WRONG_PASSWORD) }).optional();

/**
 * Kullanıcılar: kural onay istediğinde, bütün denetimlerden sonra ve ilk yazımdan önce çağrılır. Onay yoksa
 * STEP_UP_REQUIRED (istemci parola penceresini açıp aynı çağrıyı yineler), varsa parola Hesabım'la aynı payla denenir.
 */
export async function requireStepUp(me: CurrentUser, confirm: unknown, what: string): Promise<void> {
  const parsed = zConfirm.safeParse(confirm);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]?.message === WRONG_PASSWORD ? WRONG_PASSWORD : STEP_UP_REQUIRED);
  if (!parsed.data?.password) throw new UserError(STEP_UP_REQUIRED);
  await requirePassword(me, parsed.data.password, "Kullanıcılar", what);
}
