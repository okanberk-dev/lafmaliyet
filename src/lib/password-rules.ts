/*
 * Yeni parolanın kuralı: sunucu (Hesabım, kullanıcı ekleme / düzenleme, davet ve sıfırlama) ve formlar (alanın altında)
 * aynı denetimi kullanır. Saf modül.
 */

/** Parolanın en kısa uzunluğu (her yerde aynı) */
export const PASSWORD_MIN = 8;

/**
 * Tahmin listelerinin başındaki parolalar (sadeleştirilmiş: küçük harf, Türkçe harfler ASCII, harf ve rakam dışı
 * yok). Bunlar ve bunlarla başlayıp yalnız rakamla süren parolalar ("parola2024") kabul edilmez.
 */
const COMMON = [
  "password", "parola", "sifre", "sifrem", "qwerty", "qwertyui", "asdfghjk", "asdasdasd", "zxcvbnm", "1q2w3e4r", "q1w2e3r4",
  "abc123", "abcd1234", "iloveyou", "admin", "administrator", "yonetici", "welcome", "letmein", "monkey", "dragon",
  "sunshine", "princess", "football", "baseball", "superman", "batman", "galatasaray", "fenerbahce", "besiktas",
  "trabzonspor", "istanbul", "ankara", "izmir", "turkiye", "turkey", "kahve", "coffee", "cafe", "kafe", "espresso",
  "latte", "barista", "seniseviyorum", "askim", "canim", "allah", "bismillah", "mustafa", "mehmet", "ahmet",
];
const AS_ASCII: Record<string, string> = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u" };

function simplify(s: string): string {
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıİöşü]/g, (c) => AS_ASCII[c] ?? c)
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Yeni parolanın denetimi (Hesabım, kullanıcı ekleme / düzenleme, davet ve sıfırlama): en az PASSWORD_MIN karakter;
 * yaygın parolalar, kafenin adı ("laffogato", "affogato"), e-postanın kendisi ya da @'ten önceki kısmı, tek
 * karakterin tekrarı ve düz sayı / harf dizileri ("12345678", "abcdefgh") kabul edilmez. Sorun yoksa null.
 */
export function passwordProblem(password: string, email?: string | null): string | null {
  if (password.length < PASSWORD_MIN) return `Parola en az ${PASSWORD_MIN} karakter olmalı`;
  if (password.length > 200) return "Parola en fazla 200 karakter olabilir";
  const p = simplify(password);
  const weak = "Bu parola çok kolay tahmin edilir; kelime, sayı ve işaret karışık daha uzun bir parola seçin";
  if (!p || /^(.)\1*$/.test(p)) return weak;
  if (isSequence(p)) return weak;
  if (COMMON.some((w) => p === w || (p.startsWith(w) && /^\d*$/.test(p.slice(w.length))))) return weak;
  if (p.includes("affogato") || p.includes("lafogato") || p.includes("laffogat")) return "Parolada kafenin adı olmasın";
  if (email) {
    const e = email.trim().toLowerCase();
    const local = simplify(e.split("@")[0] ?? "");
    if (simplify(e) === p || (local.length >= 4 && p.includes(local))) return "Parola e-posta adresinizi içermesin";
  }
  return null;
}

/** Klavyede ya da alfabede art arda gelen karakterler ("12345678", "87654321", "abcdefgh", "qwertyui") */
const RUNS = ["01234567890123456789", "98765432109876543210", "abcdefghijklmnopqrstuvwxyz", "zyxwvutsrqponmlkjihgfedcba", "qwertyuiopasdfghjklzxcvbnm"];

function isSequence(p: string): boolean {
  return RUNS.some((r) => r.includes(p));
}
