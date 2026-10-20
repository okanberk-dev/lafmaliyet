/**
 * Sayım sayfasındaki "Toplam stok" kartının dökümü (karta dokununca açılan pencere). Saf fonksiyon: form yazılan
 * miktarlarla her an yeniden kurar. Kural `liveTotals` ile aynı (miktar × birim fiyat, KDV hariç; ek kalemler
 * miktar × fiyat), döküm kartın rakamını kuruşu kuruşuna tutar.
 */
import type { BreakdownGroup, BreakdownRow } from "@/lib/breakdown";
import { num, tl } from "@/lib/format";

import { listHref as hammaddeHref } from "../hammaddeler/breakdowns";

import { linePrice, type CountLineValue } from "./logic";

export interface StockBreakdownLine extends CountLineValue {
  name: string;
  /** Kayıtlı sayımın birimi (sayılmamış satırda bugünkü sayım birimi) */
  countUnit: string;
  /** Bugünkü sayım birimi; null = Hammaddeler'de "Sayılmaz" */
  unitNow: string | null;
}

export interface StockBreakdownExtra {
  name: string;
  unit: string;
  qty: number | null;
  unitPrice: number | null;
}

/** Satırın birimi, fiyatıyla aynı kural: kayıtlı miktar aynı kaldıkça (ya da arşivde) sayıldığı birim, değilse bugünkü */
export function lineUnit(line: StockBreakdownLine, value: number | null): string {
  if (line.archived || (line.qty !== null && value === line.qty)) return line.countUnit;
  return line.unitNow ?? line.countUnit;
}

/** "2,5 KG × 412,30 ₺" */
const qtyPrice = (qty: number, unit: string, price: number) => `${num(qty, 3)} ${unit} × ${tl(price, 2)}`;

/**
 * Toplam stok (KDV hariç) grup grup, malzeme malzeme; "Listede olmayanlar" ayrı bölüm. Sayılıp birim fiyatı olmayan
 * kalemler (toplama 0 ₺ girer) toplama girmeyen ayrı bölümde, malzemenin fiyatı için Hammaddeler'e bağlantıyla.
 * Miktarı 0 ya da boş kalem dökümde yer almaz.
 */
export function stockBreakdown(
  groups: { name: string; lines: StockBreakdownLine[] }[],
  valueOf: (line: StockBreakdownLine) => number | null,
  extras: StockBreakdownExtra[],
): BreakdownGroup[] {
  const unpriced: BreakdownRow[] = [];
  const out: BreakdownGroup[] = groups.map((g) => {
    const rows: BreakdownRow[] = [];
    for (const l of g.lines) {
      // liveTotals gibi: arşiv satırı kayıtlı miktarıyla, diğerleri formdaki değerle
      const v = l.archived ? l.qty : valueOf(l);
      if (v === null || !Number.isFinite(v) || v === 0) continue;
      const price = linePrice(l, v);
      const unit = lineUnit(l, v);
      if (!price) {
        unpriced.push({
          key: `l${l.id}`,
          label: l.name,
          sub: `${num(v, 3)} ${unit} · ${g.name}`,
          amount: 0,
          display: "Fiyat yok",
          tone: "warn",
          // Hammaddeler'de süzülmüş listeye iner (çapa: liste kartların altında)
          href: hammaddeHref({ ara: l.name }),
        });
        continue;
      }
      rows.push({ key: `l${l.id}`, label: l.name, sub: `${qtyPrice(v, unit, price)}${l.archived ? " · arşiv kalemi" : ""}`, amount: v * price });
    }
    return { key: `g:${g.name}`, label: g.name, rows };
  });

  const extraRows: BreakdownRow[] = [];
  extras.forEach((e, i) => {
    const q = e.qty ?? 0;
    if (!Number.isFinite(q) || q === 0) return;
    const price = e.unitPrice ?? 0;
    const label = e.name.trim() || "Adı yazılmamış kalem";
    const unit = e.unit.trim() || "ADET";
    if (!price) {
      unpriced.push({ key: `e${i}`, label, sub: `${num(q, 3)} ${unit} · Listede olmayanlar`, amount: 0, display: "Fiyat yok", tone: "warn" });
      return;
    }
    extraRows.push({ key: `e${i}`, label, sub: qtyPrice(q, unit, price), amount: q * price });
  });
  out.push({ key: "ek", label: "Listede olmayanlar", rows: extraRows });

  out.push({
    key: "fiyatsiz",
    label: "Birim fiyatı olmayanlar",
    note: "Sayıldı ama birim fiyatı yok; toplama 0 ₺ girer. Malzemenin fiyatı Hammaddeler'de, ek kalemin fiyatı Listede olmayanlar tablosunda girilir.",
    apart: true,
    noSubtotal: true,
    rows: unpriced,
  });
  return out;
}
