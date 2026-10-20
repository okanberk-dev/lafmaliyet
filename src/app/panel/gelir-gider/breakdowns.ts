import { withRemainder, type BreakdownGroup, type BreakdownRow } from "@/lib/breakdown";
import type { PnlMonthCalc, PnlRowDef } from "@/lib/calc/engine";
import { monthLabel, num, tl } from "@/lib/format";

import type { GridSection } from "./pnl-grid";

/** Excel'den gelen büyük harfli satır adlarını cümle düzenine çevirir; kısaltmalar büyük kalır */
const ACRONYMS = ["POS", "SGK", "KDV", "AVM"];
export function sentenceCase(s: string): string {
  let out = s.toLocaleLowerCase("tr-TR");
  // Kısaltmalar önce: ad bir kısaltmayla başlasa da ("KDV …") doğru kalır
  for (const a of ACRONYMS) out = out.replace(new RegExp(`(^|[^\\p{L}])${a.toLocaleLowerCase("tr-TR")}(?![\\p{L}])`, "gu"), `$1${a}`);
  return out.charAt(0).toLocaleUpperCase("tr-TR") + out.slice(1);
}

/**
 * Gelir-gider satırının görünen adı (tablo, kart dökümleri, Genel bakış'taki faturaya göre kâr): tedarikçi ve sabit
 * gider adları girildiği gibi, diğerleri cümle düzeninde. `fixedNames`: "fixed:<id>" → sabit giderin adı.
 */
export function pnlRowLabel(def: Pick<PnlRowDef, "key" | "label">, fixedNames: ReadonlyMap<string, string>): string {
  if (def.key.startsWith("purchase:")) return def.key.slice("purchase:".length);
  if (def.key.startsWith("commission:") && def.key !== "commission:pos") return `${def.key.slice("commission:".length)} komisyonu`;
  return fixedNames.get(def.key) ?? sentenceCase(def.label);
}

/** Yılın ay hesaplarından dökümün kullandıkları */
export type YearMonthCalc = Pick<PnlMonthCalc, "opening" | "closing" | "cogs" | "sections" | "revenueNet">;

/** Ciro dökümünün ay hesabından kullandıkları (açık gün: Satışlar'a girilen, girilmediyse null) */
export type RevenueMonthCalc = Pick<PnlMonthCalc, "month" | "revenue" | "revenueNet"> & { info?: { openDays: number | null } | undefined };

/**
 * Yıl cirosu kartının dökümü: ay ay ciro (KDV hariç), takvim sırasıyla; aya dokununca Satışlar'da o ay açılır.
 * Kalemler kartın rakamını (ayların KDV hariç cirosu toplamı) tutar. Gideri ya da açık günü olup cirosu girilmemiş
 * aylar ("aktif ay" sayılır) toplama girmeyen ayrı bölümde: kartın "N aktif ay" yazısı dökümde de görünsün.
 */
export function revenueBreakdown(calcs: RevenueMonthCalc[], activeMonths: string[]): BreakdownGroup[] {
  const days = (c: RevenueMonthCalc) => (c.info?.openDays ? `${num(c.info.openDays)} açık gün` : null);
  const missing = calcs.filter((c) => c.revenueNet === null && activeMonths.includes(c.month));
  return [
    {
      key: "ciro",
      rows: calcs
        .filter((c) => c.revenueNet !== null)
        .map((c) => ({
          key: c.month,
          label: monthLabel(c.month),
          sub: [`POS cirosu ${tl(c.revenue)} (KDV dahil)`, days(c)].filter(Boolean).join(" · "),
          amount: c.revenueNet ?? 0,
          href: `/panel/satislar?ay=${c.month}`,
          // Sıfır girilen ay da görünsün: cirosu girilmemiş aydan ayrı
          ...(c.revenueNet === 0 ? { display: tl(0) } : {}),
        })),
    },
    {
      key: "girilmedi",
      label: "Cirosu girilmemiş aylar",
      note: "Gideri ya da açık günü var, POS cirosu yok. Aya dokununca Satışlar'da ciro girilir.",
      apart: true,
      noSubtotal: true,
      rows: missing.map((c) => ({
        key: c.month,
        label: monthLabel(c.month),
        sub: days(c) ?? undefined,
        amount: 0,
        display: "Girilmedi",
        tone: "warn" as const,
        href: `/panel/satislar?ay=${c.month}#m-pos`,
      })),
    },
  ];
}

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
