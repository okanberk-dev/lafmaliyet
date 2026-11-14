import "server-only";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { isCalendarDate } from "@/lib/reminders";
import { UserError } from "@/server/user-error";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

/** Eylemi çalıştırır; yönlendirme hatalarını geçirir, diğer hataları kullanıcıya uygun mesaja çevirir. */
export async function attempt<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof z.ZodError) {
      return { ok: false, error: e.issues[0]?.message ?? "Geçersiz veri" };
    }
    if (e instanceof UserError) return { ok: false, error: e.message };
    const code = (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") return { ok: false, error: "Bu kayıt zaten var (aynı isim kullanılıyor)" };
    if (code === "23503") return { ok: false, error: "Bu kayıt başka yerlerde kullanıldığı için silinemez" };
    console.error(e);
    return { ok: false, error: "İşlem tamamlanamadı. Lütfen tekrar deneyin." };
  }
}

/** Kullanıcıya olduğu gibi gösterilecek hata (testli çekirdekler de fırlatır: src/server/user-error.ts) */
export { UserError } from "@/server/user-error";

export const zMoney = z.number({ message: "Sayı girin" }).finite("Geçersiz sayı");
/** Kasa tutarı: eksi olamaz (kasa raporu, kasadan çıkanlar) */
export const zAmount = z.number({ message: "Tutar girin" }).finite("Geçersiz tutar").min(0, "Tutar eksi olamaz").max(100_000_000, "Tutar çok büyük");
/** Eksi olabilen tutar (iade, düzeltme): en çok ±100.000.000 ₺, fazladan yazılmış bir sıfır ayın kârını silmesin (FC-06) */
export const zSignedAmount = zMoney.min(-100_000_000, "Tutar çok büyük").max(100_000_000, "Tutar çok büyük");
export const zRate = z.number({ message: "Oran girin" }).min(0, "Oran negatif olamaz").max(1, "Oran %100'den büyük olamaz");
export const zMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Geçersiz ay");
/** Takvimde var olan gün (YYYY-MM-DD): 2026-02-30 ve 2026-00-10 reddedilir (KP-09) */
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Geçersiz tarih").refine(isCalendarDate, "Geçersiz tarih");
export const zText = (label: string, max = 200) =>
  z.string({ message: `${label} gerekli` }).trim().min(1, `${label} gerekli`).max(max, `${label} çok uzun`);
export const zOptText = (max = 1000) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
/**
 * Yeni kaydın istemci anahtarı (pencerenin ya da formun ürettiği UUID; başarılı kayıttan sonra yenilenir). Aynı anahtarla
 * gelen ikinci istek (kısayola ikinci basış, yanıtı yolda kalan isteğin tekrarı) yeni satır açmaz, var olanı döner
 * (denetim UI-01, UI-03). Verilmezse eski davranış
 */
export const zClientKey = z
  .string()
  .min(8)
  .max(80)
  .nullish()
  .transform((v) => v ?? null);
