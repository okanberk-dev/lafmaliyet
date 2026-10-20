/**
 * Özet kartlarının dökümü (karta dokununca açılan pencere): satırlar, bölümler, paylar ve toplam. Saf fonksiyonlar;
 * görünüm `components/ui/stat-breakdown.tsx`te. Veriyi sayfa sunucuda kurar, pencere yalnızca sıralar ve payı bulur.
 */

import { pct } from "./format";

/** Dökümde bir kalem (kategori, tedarikçi ya da tek kayıt) */
export interface BreakdownRow {
  key: string;
  label: string;
  /** Alt satır: tarih, açıklama, kayıt sayısı */
  sub?: string;
  amount: number;
  /** Kaleme dokununca gidilecek sayfa (ör. o ayın o tedarikçi faturaları) */
  href?: string;
}

/** Kalemleri başlık altında toplayan bölüm (ör. "Personel giderleri") */
export interface BreakdownGroup {
  key: string;
  /** Tek bölümlü dökümde boş bırakılır */
  label?: string;
  note?: string;
  rows: BreakdownRow[];
  /** Toplama girmeyen bölüm (ör. kafe dışı faturalar): payı yok, ara toplamı ayrı, en sonda */
  apart?: boolean;
}

export interface PreparedRow extends BreakdownRow {
  /** Toplamdaki payı; toplam 0 ya da eksiyse, bölüm toplama girmiyorsa null */
  share: number | null;
}

export interface PreparedGroup extends Omit<BreakdownGroup, "rows"> {
  rows: PreparedRow[];
  subtotal: number;
  share: number | null;
}

export interface PreparedBreakdown {
  groups: PreparedGroup[];
  /** Toplam satırı: kartın rakamı (verilmediyse toplama giren bölümlerin toplamı) */
  total: number;
  /** Payların paydası: toplama giren bölümlerin toplamı */
  base: number;
}

/** Pay yazısı: %10'dan küçükte bir ondalık (%4,3), büyükte tam (%25); %0,05'ten küçük artı pay "%0,1'den az" */
export function shareLabel(share: number): string {
  if (share > 0 && share < 0.0005) return "%0,1'den az";
  return pct(share, Math.abs(share) < 0.1 ? 1 : 0);
}

/** Kuruştan küçük tutarlar (0, kayan nokta artığı) dökümde satır olmaz */
const isZero = (v: number) => Math.abs(v) < 0.005;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Dökümü sıralar ve payları bulur. Boş kalemler ve kalemsiz bölümler düşer. Kalemler tutara göre büyükten küçüğe
 * (eksi toplamlı bölümde en büyük gider önce); bölümler de ara toplamlarına göre, toplama girmeyenler en sonda.
 * `order: "given"` verilen sırayı korur (ör. kâr dökümünde önce ciro, sonra giderler).
 */
export function prepareBreakdown(groups: BreakdownGroup[], opts: { total?: number; order?: "amount" | "given" } = {}): PreparedBreakdown {
  const byAmount = opts.order !== "given";
  const live = groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => Number.isFinite(r.amount) && !isZero(r.amount)) }))
    .filter((g) => g.rows.length)
    .map((g) => ({ ...g, subtotal: sum(g.rows.map((r) => r.amount)) }));
  const base = sum(live.filter((g) => !g.apart).map((g) => g.subtotal));
  const shareOf = (v: number, apart?: boolean) => (apart || !(base > 0) ? null : v / base);
  const sorted = byAmount ? [...live].sort((a, b) => Number(Boolean(a.apart)) - Number(Boolean(b.apart)) || Math.abs(b.subtotal) - Math.abs(a.subtotal)) : live;
  return {
    groups: sorted.map((g) => {
      const sign = g.subtotal < 0 ? -1 : 1;
      const rows = byAmount ? [...g.rows].sort((a, b) => sign * (b.amount - a.amount) || a.label.localeCompare(b.label, "tr")) : g.rows;
      return { ...g, rows: rows.map((r) => ({ ...r, share: shareOf(r.amount, g.apart) })), share: shareOf(g.subtotal, g.apart) };
    }),
    total: opts.total ?? base,
    base,
  };
}

/**
 * Kalemler kartın rakamını tutmuyorsa farkı "Diğer" kalemi olarak ekler (ör. tabloda satırı olmayan eski bir elle
 * giriş); döküm her zaman kartla aynı toplamı verir. Yarım liradan küçük fark yuvarlama sayılır.
 */
export function withRemainder(rows: BreakdownRow[], total: number, label: string, key = "remainder"): BreakdownRow[] {
  const diff = total - sum(rows.map((r) => r.amount));
  return Math.abs(diff) < 0.5 ? rows : [...rows, { key, label, amount: diff }];
}
