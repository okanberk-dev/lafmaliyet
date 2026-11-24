/**
 * Bildirim zilinin (notification-bell.tsx) saf hesabı: rozetin yazısı, ekran okuyucu etiketi ve sayı artınca zilin
 * ne kadar sallanacağı. React ve tarayıcı içermez; testler doğrudan bunu okur (tests/zil-bildirim-sifre.test.ts).
 */

/** Rozette en çok bu kadar rakam; fazlası "9+" (alt menünün rozetiyle aynı, nav.ts › badgeText) */
export const BADGE_MAX = 9;

/** Geçersiz, eksi ya da kesirli sayı 0'a / tam sayıya iner */
export const unreadOf = (count: number | null | undefined): number =>
  typeof count === "number" && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;

/** Rozetin dönen rakamı ve sonundaki "+": 0'da rozet yok (null) */
export function badgeOf(count: number | null | undefined, max = BADGE_MAX): { value: number; plus: boolean } | null {
  const n = unreadOf(count);
  if (n === 0) return null;
  return n > max ? { value: max, plus: true } : { value: n, plus: false };
}

/** Düğmenin ekran okuyucu etiketi */
export function bellLabel(count: number | null | undefined): string {
  const n = unreadOf(count);
  return n > 0 ? `Bildirimler, ${n} okunmamış` : "Bildirimler";
}

// derece / saniye: sayı ne kadar çok artarsa o kadar güçlü, ama bir sınırı var
const IMPULSE = 500;
const MAX_VELOCITY = 900;
const BURST = 5;

/**
 * Zilin sallanma hızı (derece / saniye) ya da sallanmaz (null). Yalnız okunmamış sayısı arttığında sallanır: ilk
 * okuma (önceki değer bilinmiyor), azalma ve aynı kalma sessizdir; sayfa her açıldığında zil çalmaz, yalnız sayfa
 * açıkken yeni bildirim gelince çalar. `moving`: zil zaten sallanıyorsa o yöne itilir (daha güçlü sallanır).
 */
export function ringVelocity(previous: number | null, next: number | null, moving = 0): number | null {
  if (previous === null || next === null) return null;
  const delta = unreadOf(next) - unreadOf(previous);
  if (delta <= 0) return null;
  const weight = 0.7 + (0.6 * Math.min(delta, BURST)) / BURST;
  const along = moving > 1 ? 1 : -1;
  const v = moving + along * IMPULSE * weight;
  return Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, v));
}
