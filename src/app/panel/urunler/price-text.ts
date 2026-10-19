import { num } from "@/lib/format";

/** Fiyat alanına yazılan metin: tam sayıysa "1.113", kuruşluysa iki hane ("259,90", "259,9" değil) */
export const priceText = (v: number) => num(v, 2, Number.isInteger(Math.round(v * 100) / 100) ? 0 : 2);
