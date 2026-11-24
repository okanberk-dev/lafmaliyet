/**
 * Kayan rakamlı sayacın (animated-counter.tsx) saf hesabı: değeri basamaklara böler, Türkçe biçimler ve her
 * basamağa sağdan sayılan kalıcı bir anahtar verir. React ve tarayıcı içermez; testler doğrudan bunu okur.
 *
 * Biçim `tl()` / `num()` ile aynıdır: binlik ayırıcı nokta, ondalık virgül, yuvarlama sıfırdan uzağa.
 */

export const MAX_DECIMALS = 15;
export const MAX_PAD = 24;
export const MIN_DURATION = 0.01;
export const MAX_DURATION = 60;

export const mod = (n: number, m: number) => ((n % m) + m) % m;

export const clamp = (n: number, low: number, high: number) =>
  Math.min(high, Math.max(low, Number.isFinite(n) ? n : low));

const isDigit = (char: string) => char >= "0" && char <= "9";

const EVERY_THREE = /\B(?=(\d{3})+(?!\d))/g;

export type Shape = {
  /** Gelen değer (NaN / sonsuz → 0) */
  amount: number;
  /** |değer| × 10^ondalık, yuvarlanmış tam sayı */
  scaled: number;
  places: number;
  /** Saniye cinsinden yay süresi */
  pace: number;
  /** Basamak sayısı (baştaki sıfırlar dahil) */
  width: number;
};

export function measure(value: number, decimals: number, padStart: number, duration: number): Shape {
  // NaN bir önceki değerle karşılaştırmayı sonsuza dek "değişti" yapar
  const amount = Number.isFinite(value) ? value : 0;
  const places = clamp(Math.trunc(decimals), 0, MAX_DECIMALS);
  const pad = clamp(Math.trunc(padStart), 1, MAX_PAD);
  // MAX_SAFE_INTEGER'dan sonrası gürültü, 1e21'den sonra String() üslü yazar
  const scaled = Math.min(Number.MAX_SAFE_INTEGER, Math.round(Math.abs(amount) * 10 ** places));
  return {
    amount,
    scaled,
    places,
    pace: clamp(duration, MIN_DURATION, MAX_DURATION),
    width: Math.max(String(scaled).length, places + pad),
  };
}

/** Eksi işaretsiz biçim: 12.500 / 12.500,50 */
export function format({ scaled, places, width }: Shape, separator = ".", decimalSeparator = ","): string {
  const raw = String(scaled).padStart(width, "0");
  const wholeDigits = raw.slice(0, raw.length - places) || "0";
  const whole = separator ? wholeDigits.replace(EVERY_THREE, separator) : wholeDigits;
  return places ? `${whole}${decimalSeparator}${raw.slice(raw.length - places)}` : whole;
}

/** Sıfıra yuvarlanan eksi değer (−0,4 → "0") eksi işareti almaz */
export const isNegative = (shape: Shape) => shape.amount < 0 && shape.scaled > 0;

/**
 * Basamaklar sağdan uzaklıklarıyla anahtarlanır: sayı bir basamak büyüyünce sütunlar yer değiştirir, baştan
 * kurulmaz. İşaret (nokta, virgül) bir sonraki basamağın konumuyla anahtarlanır.
 */
export type Cell = { kind: "digit"; key: number; digit: number } | { kind: "mark"; key: string; char: string };

export function toCells(chars: string, width: number): Cell[] {
  const cells: Cell[] = [];
  let seen = 0;
  // yalnız basamak konumu ilerletir; çok karakterli ayırıcı aynı anahtarı tekrarlamasın
  let run = 0;
  for (const char of chars) {
    if (isDigit(char)) {
      run = 0;
      cells.push({ kind: "digit", key: width - seen++, digit: Number(char) });
    } else {
      cells.push({ kind: "mark", key: `mark-${width - seen}-${run++}`, char });
    }
  }
  return cells;
}
