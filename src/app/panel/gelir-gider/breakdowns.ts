import { withRemainder, type BreakdownGroup, type BreakdownRow } from "@/lib/breakdown";
import type { PnlMonthCalc } from "@/lib/calc/engine";

import type { GridSection } from "./pnl-grid";

/** Yılın ay hesaplarından dökümün kullandıkları */
export type YearMonthCalc = Pick<PnlMonthCalc, "opening" | "closing" | "cogs" | "sections" | "revenueNet">;

/** Satılan mal maliyetinden sonraki gider bölümleri (tablodaki sırayla) */
const EXPENSE_SECTIONS = [
  { key: "personel", label: "Personel giderleri" },
  { key: "faturalar", label: "Faturalar" },
  { key: "kira", label: "Kira" },
  { key: "genel", label: "İşletme genel giderleri" },
  { key: "komisyon", label: "Komisyon giderleri" },
] as const;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Gelir-gider kartlarının yıl dökümü, tablonun satırlarından (yıl toplamı sütunu): giderler bölüm bölüm, satılan mal
 * maliyeti (mal alışları + stok devri) ve kâr (ciro − bölüm giderleri). Her bölüm ay hesaplarının toplamını tutar:
 * tabloda satırı olmayan bir tutar (ör. eski bir elle giriş) "Diğer" kalemi olur, döküm kartla aynı toplamı verir.
 */
export function yearBreakdowns(sections: GridSection[], calcs: YearMonthCalc[]): { cogs: BreakdownGroup[]; expenses: BreakdownGroup[]; profit: BreakdownGroup[] } {
  const rowsOf = (key: string): BreakdownRow[] =>
    (sections.find((s) => s.key === key)?.rows ?? [])
      .filter((r) => r.def.kind !== "total" && r.total !== null)
      .map((r) => ({ key: r.def.key, label: r.def.label, sub: r.def.sub, amount: r.total ?? 0 }));
  const cogsRows = withRemainder(
    [
      ...rowsOf("mal"),
      { key: "stock:change", label: "Stok devri", sub: "Önceki aydan devir − ay sonu stok (sayım)", amount: sum(calcs.map((c) => c.opening - c.closing)) },
    ],
    sum(calcs.map((c) => c.cogs)),
    "Diğer",
    "cogs:other",
  );
  const expenses: BreakdownGroup[] = [
    { key: "cogs", label: "Satılan mal maliyeti", rows: cogsRows },
    ...EXPENSE_SECTIONS.map(({ key, label }) => ({
      key,
      label,
      rows: withRemainder(rowsOf(key), sum(calcs.map((c) => c.sections[key])), "Diğer (tabloda ayrı satırı yok)", `${key}:other`),
    })),
  ];
  const revenueNet = sum(calcs.map((c) => c.revenueNet ?? 0));
  return {
    cogs: [{ key: "cogs", rows: cogsRows }],
    expenses,
    // Kâr: önce ciro, sonra bölüm giderleri eksi olarak, büyükten küçüğe
    profit: [
      { key: "gelir", label: "Gelir", rows: [{ key: "revenueNet", label: "Ciro (KDV hariç)", amount: revenueNet }] },
      {
        key: "gider",
        label: "Giderler",
        rows: expenses.map((g) => ({ key: g.key, label: g.label ?? g.key, amount: -sum(g.rows.map((r) => r.amount)) })).sort((a, b) => a.amount - b.amount),
      },
    ],
  };
}
