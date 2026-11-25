"use client";

import { ChartBar, ChevronRight, LayoutGrid, Table2 } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { HBarChart } from "@/components/charts";
import { CardHeader, Well } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
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

/** Telefondaki "Sırala" seçimi: tablodaki başlık tıklamalarının karşılığı (ilk değer menü sırası) */
const PHONE_SORTS: { value: string; label: string }[] = [
  { value: "", label: "Menü sırası" },
  { value: "name:asc", label: "Ada göre (A→Z)" },
  { value: "count:desc", label: "Ürün sayısı" },
  { value: "avgMargin:desc", label: "Ort. kâr marjı" },
  { value: "avgUnitProfit:desc", label: "Ort. birim kâr" },
  { value: "avgCostRatio:desc", label: "Ort. maliyet oranı" },
  { value: "soldQty:desc", label: "Satış (adet)" },
  { value: "weightedMargin:desc", label: "Satış ağırlıklı marj" },
];

/** Maliyet oranının hedefe göre tonu: 10 puandan fazla üstünde kırmızı, üstünde turuncu */
function costTone(ratio: number, target: number): "over" | "warn" | null {
  if (ratio > target + 0.1) return "over";
  if (ratio > target) return "warn";
  return null;
}

/**
 * Genel bakış · Kategoriler sekmesi: sıralanabilir tablo (ilk tıklamada büyükten küçüğe, adda A→Z;
 * üçüncü tıklama menü sırasına döner) ya da kategori marjı grafiği. Altta menünün toplamı.
 * `salesMonth`: satış adetleri seçili aydan değil başka bir aydan geliyorsa o ayın kısa adı ("Eyl 2026");
 * satış sütunlarının başlığına eklenir, rakamın hangi aya ait olduğu sessizce kaybolmaz.
 * Telefon ve tablette (lg altı) tablo yerine kategori kartları (yana kaydırma yok); sıralama kartların üstündeki "Sırala" ile.
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
  /** "Bütün menü" ortalamaları (reçeteli ürünlerin basit ortalaması, her ürün bir oy) */
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
          {/* Telefon ve tablet (lg altı): her kategori bir kart, bütün ortalamalar etiketleriyle. Yedi sütunlu tablo
              dik tutulan tablette (720px) sığmaz, son sütunlar yana kaydırmadan görünmezdi; tablette kartlar iki sütun. */}
          <div className="space-y-2 px-4 sm:px-5 lg:hidden">
            <Select
              aria-label="Kategorileri sırala"
              value={sort ? `${sort.key}:${sort.dir}` : ""}
              onChange={(e) => {
                const [key, dir] = e.target.value.split(":") as [SortKey, "asc" | "desc"];
                setSort(e.target.value ? { key, dir } : null);
              }}
              className={cn("w-full sm:w-72", sort && "ring-ink/40")}
            >
              {PHONE_SORTS.some((o) => o.value === (sort ? `${sort.key}:${sort.dir}` : "")) ? null : (
                <option value={sort ? `${sort.key}:${sort.dir}` : ""}>Tablodaki sıra</option>
              )}
              {PHONE_SORTS.map((o) => (
                <option key={o.value} value={o.value}>
                  Sırala: {o.label}
                </option>
              ))}
            </Select>
            <ul className="grid gap-2 sm:grid-cols-2" aria-label="Kategoriler">
              {rows.map((c) => (
                <li key={c.categoryId}>
                  <CategoryCard
                    href={`/panel/urunler?kategori=${c.categoryId}`}
                    name={c.name}
                    count={c.count}
                    margin={pct(c.avgMargin)}
                    unitProfit={tl(c.avgUnitProfit, 2)}
                    costRatio={pct(c.avgCostRatio)}
                    tone={costTone(c.avgCostRatio, target)}
                    soldQty={num(c.soldQty)}
                    weighted={c.soldQty ? pct(c.weightedMargin) : "–"}
                    salesMonth={salesMonth}
                  />
                </li>
              ))}
            </ul>
            <CategoryCard
              total
              name="Bütün menü"
              info={
                menu && menu.count !== totalCount
                  ? `Ortalamalar reçetesi olan ${num(menu.count)} ürünün basit ortalaması (her ürün bir oy); reçetesi olmayan ${num(totalCount - menu.count)} ürün kategori satırlarının ortalamalarına da katılmaz.`
                  : undefined
              }
              count={totalCount}
              margin={menu?.margin != null ? pct(menu.margin) : "–"}
              unitProfit={menu?.unitProfit != null ? tl(menu.unitProfit, 2) : "–"}
              costRatio={menu?.costRatio != null ? pct(menu.costRatio) : "–"}
              tone={null}
              soldQty={num(totalQty)}
              weighted={totalRevenue ? pct(totalProfit / totalRevenue) : "–"}
              salesMonth={salesMonth}
            />
          </div>
          <TableWrap className="pb-0 max-lg:hidden">
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
                  const tone = costTone(c.avgCostRatio, target);
                  const over = tone === "over";
                  const warn = tone === "warn";
                  return (
                    <TR key={c.categoryId}>
                      <TD sticky className="py-1">
                        <Link
                          href={`/panel/urunler?kategori=${c.categoryId}`}
                          className="inline-flex min-h-10 items-center gap-2.5 font-medium whitespace-nowrap text-ink hover:underline pointer-coarse:min-h-11"
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
                        <InfoTip text={`Ortalamalar reçetesi olan ${num(menu.count)} ürünün basit ortalaması (her ürün bir oy); reçetesi olmayan ${num(totalCount - menu.count)} ürün kategori satırlarının ortalamalarına da katılmaz.`} />
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
          <p className="mt-2 px-5 text-xs text-ink-mute max-lg:mt-3 max-sm:px-4">
            Maliyet oranı hedefin ({pct(target, 0)}) üstündeyse <span className="font-medium text-warn">turuncu</span>, 10 puandan fazla
            üstündeyse <span className="font-medium text-bad">kırmızı</span>.{" "}
            <span className="max-lg:hidden">Başlığa tıklayınca sıralanır; kategori adı ürün listesini açar.</span>
            <span className="lg:hidden">Kategoriye dokununca ürün listesi açılır.</span>
          </p>
        </div>
      )}
    </>
  );
}

/** Telefon ve tabletteki kategori kartı: ad (ürün listesine gider) + ürün sayısı, altında altı ortalama */
function CategoryCard({
  href,
  name,
  info,
  total,
  count,
  margin,
  unitProfit,
  costRatio,
  tone,
  soldQty,
  weighted,
  salesMonth,
}: {
  href?: string;
  name: string;
  info?: string;
  /** "Bütün menü" satırı: koyu zemin, bağlantısız */
  total?: boolean;
  count: number;
  margin: string;
  unitProfit: string;
  costRatio: string;
  tone: "over" | "warn" | null;
  soldQty: string;
  weighted: string;
  salesMonth?: string | null;
}) {
  const head = (
    <span className="flex min-h-11 items-center gap-2.5">
      {total ? null : <Avatar name={name} size="sm" />}
      <span className="min-w-0 flex-1 text-[15px] font-semibold text-pretty text-ink">{name}</span>
      {info ? <InfoTip text={info} /> : null}
      <span className="shrink-0 text-[13px] text-ink-mute tabular">{num(count)} ürün</span>
      {href ? <ChevronRight size={16} className="shrink-0 text-ink-quiet" aria-hidden="true" /> : null}
    </span>
  );
  // Üç sütunlu ızgara: kartlar alt alta karşılaştırılırken aynı değer hep aynı yerde (tablodaki sütun gibi)
  const cell = (label: string, value: ReactNode, className?: string, span?: string) => (
    <div className={cn("min-w-0", span)}>
      <dt className="truncate text-[11px] leading-4 text-ink-mute">{label}</dt>
      <dd className={cn("text-sm leading-5 font-semibold whitespace-nowrap text-ink tabular", className)}>{value}</dd>
    </div>
  );
  return (
    <div className={cn("rounded-2xl px-3.5 pt-1.5 pb-3", total ? "bg-panel-deep/60" : "bg-surface ring-1 ring-line")}>
      {href ? (
        <Link href={href} className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ink/30">
          {head}
        </Link>
      ) : (
        head
      )}
      <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5">
        {cell("Ort. marj", margin)}
        {cell("Birim kâr", unitProfit)}
        {cell(
          "Maliyet",
          <>
            {costRatio}
            {tone ? (
              <>
                <span aria-hidden="true"> ↑</span>
                <span className="sr-only">{tone === "over" ? " (hedefin 10 puandan fazla üstünde)" : " (hedefin üstünde)"}</span>
              </>
            ) : null}
          </>,
          tone === "over" ? "text-bad" : tone === "warn" ? "text-warn" : undefined,
        )}
        {cell(salesMonth ? `Satış · ${salesMonth}` : "Satış (adet)", soldQty)}
        {cell("Satış ağırlıklı marj", weighted, undefined, "col-span-2")}
      </dl>
    </div>
  );
}
