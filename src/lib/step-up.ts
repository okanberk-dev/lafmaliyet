/*
 * Yönetici işlemlerinde parolayla onay (step-up): yönetici gücü veren ya da bir yönetici hesabına dokunan kullanıcı
 * işlemleri, işlemi yapanın kendi parolasını ister. Kural tek yerde: istemci parola penceresini açıp açmayacağına
 * buradan karar verir, sunucu aynı kuralı veritabanındaki "önceki" hâlle yeniden denetler. Saf modül.
 */

import type { Role } from "./constants";

/** Kural parola istedi, çağrıda parola yok (istemci eski satıra bakıyorsa da gelir) */
export const STEP_UP_REQUIRED = "Bu işlem için kendi parolanızı girin";
export const PASSWORD_MISSING = "Parolanızı girin";
export const WRONG_PASSWORD = "Parola hatalı";
/** Hesabım ve Kullanıcılar aynı payı kullanır: kişi başına bu sürede en fazla REAUTH_LIMIT hata */
export const REAUTH_LIMIT = 5;
export const REAUTH_MINUTES = 15;
export const TOO_MANY_REAUTH = `Çok fazla hatalı parola. ${REAUTH_MINUTES} dakika sonra yeniden deneyin.`;

/** Parola penceresinde kalan hatalar; ötekiler (aynı e-posta, son yönetici…) pencereyi kapatıp yerinde gösterilir */
export function isStepUpError(message: string): boolean {
  return message === STEP_UP_REQUIRED || message === PASSWORD_MISSING || message === WRONG_PASSWORD || message === TOO_MANY_REAUTH;
}

/** Eylemlere giden onay. Nesne: ileride iki adımlı kod alanı eylem imzaları değişmeden eklenebilir */
export type StepUpConfirm = { password: string };

type Account = { role: Role; active: boolean; email: string };

export type StepUpCase =
  | { kind: "create"; role: Role }
  | { kind: "save"; before: Account; after: Account & { password: boolean } }
  | { kind: "link" | "2fa" | "delete"; targetRole: Role };

export type StepUpChange = "promote" | "demote" | "deactivate" | "activate" | "email" | "password";

/** Formlar ve zod şemaları e-postayı böyle yazar: yalnız büyük harf ya da boşluk farkı değişiklik sayılmaz */
const normEmail = (email: string) => email.trim().toLowerCase();

/**
 * Düzenlemede onay isteyen değişiklikler, pencerede yazılacağı sırayla. İşlemde yönetici yoksa (personel kalıyor)
 * boş: personel işleri bugünkü gibi tek dokunuş. Ad değişikliği hiçbir zaman onay istemez.
 */
export function stepUpChanges(c: Extract<StepUpCase, { kind: "save" }>): StepUpChange[] {
  const { before, after } = c;
  if (before.role !== "admin" && after.role !== "admin") return [];
  const out: StepUpChange[] = [];
  if (before.role !== after.role) out.push(after.role === "admin" ? "promote" : "demote");
  // İki yönde de: pasif bir yöneticiyi yeniden aktif yapmak yönetici girişini geri verir
  if (before.active !== after.active) out.push(after.active ? "activate" : "deactivate");
  // E-posta + "Parolamı unuttum" hesabı başkasına geçirir
  if (normEmail(before.email) !== normEmail(after.email)) out.push("email");
  if (after.password) out.push("password");
  return out;
}

export function needsStepUp(c: StepUpCase): boolean {
  switch (c.kind) {
    case "create":
      return c.role === "admin";
    case "save":
      return stepUpChanges(c).length > 0;
    default:
      return c.targetRole === "admin";
  }
}

/** İşlem geçmişindeki hatalı parola satırında ne denendiği */
export function stepUpWhat(c: StepUpCase): string {
  return {
    create: "yönetici ekleme",
    save: "yönetici hesabı değişikliği",
    link: "yönetici için bağlantı",
    "2fa": "yöneticinin iki adımlısını sıfırlama",
    delete: "yönetici silme",
  }[c.kind];
}
