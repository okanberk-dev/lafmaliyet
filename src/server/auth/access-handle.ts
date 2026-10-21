import "server-only";

import { open, seal } from "@/server/secret-box";

/** "Giriş bilgileri"ndeki parolanın e-postayla gönderilebileceği süre */
const HANDLE_MS = 15 * 60_000;

/**
 * Yöneticinin az önce belirlediği parolanın mühürlü kopyası: "Giriş bilgileri" penceresinin e-posta düğmesi parolayı
 * değil bunu geri yollar. E-posta eylemi böylece parola tahmini için kullanılamaz (eskiden gönderilen parola kişinin
 * kayıtlı parolasıyla karşılaştırılıyordu: sınırsız deneme). 15 dakika geçerli, yalnız o kişi için.
 */
export function accessMailHandle(userId: number, password: string): string {
  return seal(JSON.stringify({ u: userId, p: password, exp: Date.now() + HANDLE_MS }), "access-mail");
}

/** Mühürlü kopyadan parola; kişi tutmuyorsa, süresi geçtiyse ya da bozuksa null */
export function openAccessMailHandle(handle: string, userId: number): string | null {
  const raw = open(handle, "access-mail");
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { u?: unknown; p?: unknown; exp?: unknown };
    if (v.u !== userId || typeof v.p !== "string" || typeof v.exp !== "number" || v.exp < Date.now()) return null;
    return v.p;
  } catch {
    return null;
  }
}
