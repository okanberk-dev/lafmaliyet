"use client";

import { ChartBar, LayoutGrid, Table2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { HBarChart } from "@/components/charts";
import { CardHeader, Well } from "@/components/ui/card";
import { Avatar } from "@/components/ui/icon-tile";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { SortButton, Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import type { CategoryStat } from "@/lib/calc/insights";
import { num, pct, tl } from "@/lib/format";
import { cn } from "@/lib/utils";

type SortKey = "name" | "count" | "avgMargin" | "avgUnitProfit" | "avgCostRatio" | "soldQty" | "weightedMargin";
type Sort = { key: SortKey; dir: "asc" | "desc" } | null;

/** Satış adedine bağlı sütunlar (ayın satış listesinden) */
const SALES_COLUMNS = new Set<SortKey>(["soldQty", "weightedMargin"]);

const COLUMNS: { key: Exclude<SortKey, "name">; label: string }[] = [
  { key: "count", label: "Ürün" },
  { key: "avgMargin", label: "Ort. kâr marjı" },
  { key: "avgUnitProfit", label: "Ort. birim kâr" },
  { key: "avgCostRatio", label: "Ort. maliyet oranı" },
  { key: "soldQty", label: "Satış (adet)" },
  { key: "weightedMargin", label: "Satış ağırlıklı marj" },
];

/**
 * Genel bakış · Kategoriler sekmesi: sıralanabilir tablo (ilk tıklamada büyükten küçüğe, adda A→Z;
 * üçüncü tıklama menü sırasına döner) ya da kategori marjı grafiği. Altta menünün toplamı.
 * `salesMonth`: satış adetleri seçili aydan değil başka bir aydan geliyorsa o ayın kısa adı ("Eyl 2026");
 * satış sütunlarının başlığına eklenir, rakamın hangi aya ait olduğu sessizce kaybolmaz.
 */
export function CategoriesPanel({
  cats,
  target,
  description,
  salesMonth,
  menu,
}: {
  cats: CategoryStat[];
  target: number;
  description: string;
  salesMonth?: string | null;
  /** "Bütün menü" ortalamaları (reçeteli ürünlerin basit ortalaması, Excel Ürün Kârlılık satır 134) */
  menu?: { count: number; margin: number | null; costRatio: number | null; unitProfit: number | null };
}) {
  const [sort, setSort] = useState<Sort>(null);
  const [view, setView] = useState<"tablo" | "grafik">("tablo");

  const toggle = (key: SortKey) =>
    setSort((s) => {
      const first = key === "name" ? "asc" : "desc";
      if (!s || s.key !== key) return { key, dir: first };
      if (s.dir === first) return { key, dir: first === "asc" ? "desc" : "asc" };
      return null;
    });
  const dirOf = (key: SortKey) => (sort?.key === key ? sort.dir : null);
  const ariaSort = (key: SortKey) => (sort?.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined);

  const rows = sort
    ? [...cats].sort((a, b) => {
        const d = sort.key === "name" ? a.name.localeCompare(b.name, "tr") : a[sort.key] - b[sort.key];
        return sort.dir === "asc" ? d : -d;
      })
    : cats;

  const totalCount = cats.reduce((s, c) => s + c.count, 0);
  const totalQty = cats.reduce((s, c) => s + c.soldQty, 0);
  const totalRevenue = cats.reduce((s, c) => s + c.revenueNet, 0);
  const totalProfit = cats.reduce((s, c) => s + c.profit, 0);

  return (
    <>
      <CardHeader
        icon={<LayoutGrid />}
        title="Kategori bazında"
        description={description}
        meta={<span className="tabular">{cats.length} kategori</span>}
        actions={
          cats.length ? (
            <Segmented
              label="Kategori görünümü"
              value={view}
              onChange={setView}
              options={[
                {
                  value: "tablo",
                  label: (
                    <>
                      <Table2 size={14} aria-hidden="true" /> Tablo
                    </>
                  ),
                },
                {
                  value: "grafik",
                  label: (
                    <>
                      <ChartBar size={14} aria-hidden="true" /> Grafik
                    </>
                  ),
                },
              ]}
            />
          ) : null
        }
      />
      {!cats.length ? (
        <EmptyState title="Kategori yok" description="Ürünlere kategori atanınca ortalamalar burada görünür." />
      ) : view === "grafik" ? (
        <div className="px-5 pb-5">
          <Well className="p-2 sm:p-4">
            <h3 className="mb-2 px-2 text-[13px] font-semibold text-ink sm:px-0">Kategoriye göre ortalama kâr marjı</h3>
            <HBarChart data={rows.map((c) => ({ label: c.name, value: c.avgMargin }))} format="percent" valueLabel="Ort. kâr marjı" />
          </Well>
        </div>
      ) : (
        <div className="pb-5">
          <TableWrap className="pb-0">
            <Table>
              <THead>
                <tr>
                  <TH sticky aria-sort={ariaSort("name")}>
                    <SortButton dir={dirOf("name")} onClick={() => toggle("name")}>
                      Kategori
                    </SortButton>
                  </TH>
                  {COLUMNS.map((c) => (
                    <TH key={c.key} numeric aria-sort={ariaSort(c.key)}>
                      <SortButton numeric dir={dirOf(c.key)} onClick={() => toggle(c.key)}>
                        {c.label}
                        {salesMonth && SALES_COLUMNS.has(c.key) ? <span className="font-normal text-ink-mute"> · {salesMonth}</span> : null}
                      </SortButton>
                    </TH>
                  ))}
                </tr>
              </THead>
              <tbody>
                {rows.map((c) => {
                  const over = c.avgCostRatio > target + 0.1;
                  const warn = !over && c.avgCostRatio > target;
                  return (
                    <TR key={c.categoryId}>
                      <TD sticky className="py-1">
                        <Link
                          href={`/panel/urunler?kategori=${c.categoryId}`}
                          className="inline-flex min-h-10 items-center gap-2.5 font-medium whitespace-nowrap text-ink hover:underline"
                        >
                          <Avatar name={c.name} size="sm" />
                          {c.name}
                        </Link>
                      </TD>
                      <TD numeric>{c.count}</TD>
                      <TD numeric>{pct(c.avgMargin)}</TD>
                      <TD numeric>{tl(c.avgUnitProfit, 2)}</TD>
                      <TD
                        numeric
                        className={cn(over && "font-medium text-bad", warn && "font-medium text-warn")}
                        title={over ? "Hedefin 10 puandan fazla üstünde" : warn ? "Hedefin üstünde" : undefined}
                      >
                        {pct(c.avgCostRatio)}
                        {over ? <span className="sr-only"> (hedefin 10 puandan fazla üstünde)</span> : warn ? <span className="sr-only"> (hedefin üstünde)</span> : null}
                      </TD>
                      <TD numeric>{num(c.soldQty)}</TD>
                      <TD numeric>{c.soldQty ? pct(c.weightedMargin) : "–"}</TD>
                    </TR>
                  );
                })}
              </tbody>
              <tfoot>
                <TFootRow>
                  <TD sticky>
                    <span className="inline-flex items-center gap-1.5">
                      Bütün menü
                      {menu && menu.count !== totalCount ? (
                        <InfoTip text={`Ortalamalar reçetesi olan ${num(menu.count)} ürünün basit ortalaması (Excel Ürün Kârlılık, ORTALAMA satırı); reçetesi olmayan ${num(totalCount - menu.count)} ürün katılmaz.`} />
                      ) : null}
                    </span>
                  </TD>
                  <TD numeric>{num(totalCount)}</TD>
                  <TD numeric className={cn(menu?.margin == null && "font-normal text-ink-mute")}>{menu?.margin != null ? pct(menu.margin) : "–"}</TD>
                  <TD numeric className={cn(menu?.unitProfit == null && "font-normal text-ink-mute")}>{menu?.unitProfit != null ? tl(menu.unitProfit, 2) : "–"}</TD>
                  <TD numeric className={cn(menu?.costRatio == null && "font-normal text-ink-mute")}>{menu?.costRatio != null ? pct(menu.costRatio) : "–"}</TD>
                  <TD numeric>{num(totalQty)}</TD>
                  <TD numeric>{totalRevenue ? pct(totalProfit / totalRevenue) : "–"}</TD>
                </TFootRow>
              </tfoot>
            </Table>
          </TableWrap>
          <p className="mt-2 px-5 text-xs text-ink-mute">
            Maliyet oranı hedefin ({pct(target, 0)}) üstündeyse <span className="font-medium text-warn">turuncu</span>, 10 puandan fazla
            üstündeyse <span className="font-medium text-bad">kırmızı</span>. Başlığa tıklayınca sıralanır; kategori adı ürün listesini açar.
          </p>
        </div>
      )}
    </>
  );
}
