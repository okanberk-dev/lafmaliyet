"use client";

import {
  Calculator,
  ChartScatter,
  Eye,
  ListOrdered,
  Puzzle,
  RotateCcw,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Target,
  Tractor,
  TrendingDown,
  Wallet,
} from "lucide-react";
import { LayoutGroup, motion } from "motion/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Activity, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT, SPRING_PRESS, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { RangeSlider } from "@/components/akmanos/range-slider";
import { MenuMatrix } from "@/components/charts";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button, IconLink } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, Well } from "@/components/ui/card";
import { clearQuery, FilterBar, FilterChip, matches, SearchField, useQueryState, useQueryText } from "@/components/ui/filters";
import { Field, NumberInput, Select } from "@/components/ui/form";
import { IconTile, type PastelTone } from "@/components/ui/icon-tile";
import { EmptyState, GrowthPill, InfoTip, Signed, Stat } from "@/components/ui/misc";
import { Pagination, usePaged } from "@/components/ui/pagination";
import { Segmented } from "@/components/ui/segmented";
import { StatBreakdown } from "@/components/ui/stat-breakdown";
import { SortButton, Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import type { BreakdownRow } from "@/lib/breakdown";
import { parseNumberTR } from "@/lib/calc/expr";
import { applyScenario, type MenuClass, type ScenarioBase } from "@/lib/calc/insights";
import { num, pct, tl } from "@/lib/format";
import type { MonthKasa } from "@/lib/lafpos/kasa";
import { cn } from "@/lib/utils";

import { productHref } from "../urunler/logic";
import { breakEvenGroups, breakEvenNeedGroups, breakEvenNeeds, profitGroups, targetDaily, targetGroups } from "./breakdowns";
import { CARD_SORTS, DEFAULT_SORT, flipSign, normalizeSign, parseSort, selectionAfterSign, sortSlug, type SortDir, type SortKey } from "./logic";

/* ───────────────────────── Ortak hareket ───────────────────────── */

const fmtTl = (v: number) => tl(v);
const fmtNum = (v: number) => num(v);

/**
 * AkmanOS sayacı (charts/animated-number): değer açılışta ve her değişimde yumuşakça sayılır, her karede
 * Türkçe biçimlenir. Ekran okuyucu yalnızca son değeri duyar; hareket azaltıldığında doğrudan son değer yazılır.
 */
function CountUp({ value, format = fmtTl }: { value: number | null | undefined; format?: (v: number) => string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <>–</>;
  return (
    <>
      <span className="sr-only">{format(value)}</span>
      <span aria-hidden="true">
        <AnimatedNumber value={value} format={format} />
      </span>
    </>
  );
}

/**
 * Sırayla belirme (karolar için): kısa yukarı kayma + solma, hareket azaltılmışsa anında.
 * `initial` sunucuda da istemcide de aynı kalır (useReducedMotion sunucuda null döner); yalnızca süre değişir,
 * böylece hareketi azaltan kullanıcıda hidrasyon uyuşmazlığı olmaz.
 */
const REVEAL_FROM = { opacity: 0, y: 8 } as const;
const revealTransition = (reduce: boolean | null, index: number) =>
  reduce ? { duration: 0 } : { duration: 0.34, ease: EASE_OUT, delay: index * 0.05 };

function Reveal({ index, className, children }: { index: number; className?: string; children: ReactNode }) {
  const reduce = useCalmMotion();
  return (
    <motion.div className={className} initial={reduce ? false : REVEAL_FROM} animate={{ opacity: 1, y: 0 }} transition={revealTransition(reduce, index)}>
      {children}
    </motion.div>
  );
}

/* ───────────────────────── Sekmeler ───────────────────────── */

export type AnalysisView = "menu" | "senaryo";

/**
 * Sayfanın iki aracı arasında bölümlü seçim. İki araç da bağlı kalır (React <Activity>): sekme değişince
 * senaryodaki kaydırıcılar ve menüdeki filtreler kaybolmaz, gizli sekmedeki grafik ölçülmez.
 * Seçim adres satırına (?gorunum=senaryo) yazılır; ay değişince ya da bağlantı paylaşılınca korunur.
 * Tıklayınca sekme hemen geçer; adres dışarıdan değişirse (ör. kenar çubuğundaki bağlantı ?gorunum'u siler)
 * görünüm adrese uyar, ikisi ayrışmaz.
 */
export function AnalysisTabs({ menu, scenario }: { menu: ReactNode; scenario: ReactNode }) {
  const urlView: AnalysisView = useSearchParams().get("gorunum") === "senaryo" ? "senaryo" : "menu";
  const [view, setView] = useState<AnalysisView>(urlView);
  const [synced, setSynced] = useState<AnalysisView>(urlView);
  if (urlView !== synced) {
    setSynced(urlView);
    setView(urlView);
  }

  const change = (v: AnalysisView) => {
    setView(v);
    const sp = new URLSearchParams(window.location.search);
    if (v === "menu") sp.delete("gorunum");
    else sp.set("gorunum", v);
    const qs = sp.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Telefonda iki sekme satırı eşit paylaşır, adlar kısalır (yana kaymadan sığsın) */}
      <Segmented
        label="Analiz aracı"
        value={view}
        onChange={change}
        className="self-start max-sm:flex max-sm:w-full max-sm:[&>button]:flex-1 max-sm:[&>button]:justify-center"
        options={[
          {
            value: "menu",
            label: (
              <>
                <ChartScatter size={15} aria-hidden="true" />
                <span className="sm:hidden">Menü analizi</span>
                <span className="max-sm:hidden">Menü mühendisliği</span>
              </>
            ),
          },
          {
            value: "senaryo",
            label: (
              <>
                <SlidersHorizontal size={15} aria-hidden="true" />
                <span className="sm:hidden">Senaryo</span>
                <span className="max-sm:hidden">Senaryo simülatörü</span>
              </>
            ),
          },
        ]}
      />
      <Activity mode={view === "menu" ? "visible" : "hidden"}>{menu}</Activity>
      <Activity mode={view === "senaryo" ? "visible" : "hidden"}>{scenario}</Activity>
    </div>
  );
}

/* ───────────────────────── Menü mühendisliği ───────────────────────── */

interface Item {
  id: number;
  name: string;
  size: string;
  categoryId: number;
  category: string;
  qty: number;
  mix: number;
  cm: number;
  totalCm: number;
  cls: MenuClass;
  margin: number;
  price: number;
  suggestedPrice: number;
}

const ORDER: MenuClass[] = ["star", "plowhorse", "puzzle", "dog"];

/** Sınıfın karo rengi ve ikonu (rozet tonlarıyla aynı sıra: yeşil, turuncu, mavi, kırmızı) */
const CLASS_LOOK: Record<MenuClass, { icon: ReactNode; tile: PastelTone; dot: string }> = {
  star: { icon: <Star />, tile: 0, dot: "bg-good" },
  plowhorse: { icon: <Tractor />, tile: 1, dot: "bg-brass-500" },
  puzzle: { icon: <Puzzle />, tile: 2, dot: "bg-info" },
  dog: { icon: <TrendingDown />, tile: 3, dot: "bg-bad" },
};

/** Adresteki Türkçe karşılıklar: ?grup=yildiz, ?sirala=toplam-kar-azalan */
const CLASS_SLUG: Record<MenuClass, string> = { star: "yildiz", plowhorse: "beygir", puzzle: "bilmece", dog: "zayif" };

function compare(a: Item, b: Item, key: SortKey) {
  if (key === "name") return `${a.name} ${a.size}`.localeCompare(`${b.name} ${b.size}`, "tr");
  if (key === "cls") return ORDER.indexOf(a.cls) - ORDER.indexOf(b.cls);
  return a[key] - b[key];
}

const PAGE_SIZE = 25;

/** Ürünler tablosunun süzgeçleri (kategori ayrı: sınıfları da yeniden hesaplar) */
const TABLE_FILTERS = ["ara", "grup", "zam", "satilmayan"];

/** Gruplara girmeyen ürün: reçetesi boş (maliyeti bilinmiyor; insights.ts menuEngineering.noRecipe) */
interface SkippedItem {
  id: number;
  name: string;
  size: string;
  categoryId: number;
  qty: number;
}

/**
 * Reçetesi boş ürünler: maliyeti 0 görünür, birim kârı ~fiyatı kadar olur; gruplara ve eşiklere girmez (denetim E-47).
 * Satılanlar önce; her ürün reçete kartına gider
 */
function NoRecipeNote({ items, month }: { items: SkippedItem[]; month: string }) {
  if (!items.length) return null;
  const list = [...items].sort((a, b) => b.qty - a.qty || `${a.name} ${a.size}`.localeCompare(`${b.name} ${b.size}`, "tr"));
  const sold = list.filter((i) => i.qty > 0).length;
  return (
    <div role="note" className="space-y-2 rounded-2xl bg-warn-soft px-4 py-3 text-sm leading-5 text-warn">
      <p className="font-medium">
        {sold === items.length
          ? `Bu ay satılan ${num(sold)} ürünün reçetesi boş; gruplara girmedi`
          : `Reçetesi boş ${num(items.length)} ürün gruplara girmedi${sold ? ` (${num(sold)} tanesi bu ay satıldı)` : ""}`}
      </p>
      <p className="text-[13px]">
        Maliyeti bilinmediği için birim kârı neredeyse fiyatı kadar görünür ve kâr eşiğini yükseltirdi. Reçetesini girince
        gruplara katılır; o zamana kadar satışlarının maliyeti ortalama maliyet oranıyla tahmin edilir.
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {list.map((i) => (
          <li key={i.id}>
            <Link
              href={productHref(i.id, month)}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-xl bg-surface px-2.5 text-[13px] font-medium text-ink ring-1 ring-line ring-inset hover:ring-line-strong pointer-coarse:min-h-11"
            >
              {i.name} · {i.size}
              <span className="font-normal text-ink-mute tabular">{num(i.qty)} adet</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MenuEngineering({
  month,
  monthLabel,
  items: allItems,
  popThreshold: allThreshold,
  avgCm: allAvg,
  noRecipe: allNoRecipe = [],
  classInfo,
  categories,
}: {
  /** Seçili ay (YYYY-MM): ürün kartı bağlantısı bu ayı taşır */
  month: string;
  monthLabel: string;
  items: Item[];
  popThreshold: number;
  avgCm: number;
  /** Reçetesi boş ürünler: sınıflanmaz, eşiklere girmez; kartta ayrı not */
  noRecipe?: SkippedItem[];
  classInfo: Record<MenuClass, { label: string; advice: string; tone: string }>;
  categories: { id: number; name: string }[];
}) {
  // Süzgeçler adreste: ?kategori=3&grup=yildiz&ara=latte&zam=1&satilmayan=1&sirala=satis-azalan
  const [catParam, setCatParam] = useQueryState<string>("kategori", "");
  const [clsParam, setClsParam] = useQueryState<string>("grup", "");
  const [q, setQ] = useQueryText("ara");
  const [lowPrice, setLowPrice] = useQueryState<string>("zam", "");
  const [unsold, setUnsold] = useQueryState<string>("satilmayan", "");
  const [sortParam, setSortParam] = useQueryState<string>("sirala", DEFAULT_SORT);
  const cat = categories.some((c) => String(c.id) === catParam) ? Number(catParam) : null;
  const cls = ORDER.find((k) => CLASS_SLUG[k] === clsParam) ?? null;
  const setCls = (k: MenuClass | null) => setClsParam(k ? CLASS_SLUG[k] : "");
  const sort = parseSort(sortParam);
  const reduce = useCalmMotion();
  const tilesId = useId();
  const tableRef = useRef<HTMLElement>(null);

  // Kategori seçilince sınıflar o kategori içinde yeniden hesaplanır
  const { items, popThreshold, avgCm } = useMemo(() => {
    if (cat === null) return { items: allItems, popThreshold: allThreshold, avgCm: allAvg };
    const list = allItems.filter((i) => i.categoryId === cat);
    const totalQty = list.reduce((a, i) => a + i.qty, 0);
    const thr = list.length ? (1 / list.length) * 0.7 : 0;
    const avg = totalQty ? list.reduce((a, i) => a + i.cm * i.qty, 0) / totalQty : 0;
    return {
      items: list.map((i) => {
        const mix = totalQty ? i.qty / totalQty : 0;
        const c: MenuClass = mix >= thr ? (i.cm >= avg ? "star" : "plowhorse") : i.cm >= avg ? "puzzle" : "dog";
        return { ...i, mix, cls: c };
      }),
      popThreshold: thr,
      avgCm: avg,
    };
  }, [cat, allItems, allThreshold, allAvg]);

  const points = items
    .filter((i) => i.qty > 0)
    .map((i) => ({ name: `${i.name} · ${i.size}`, mix: i.mix, cm: i.cm, qty: i.qty, cls: classInfo[i.cls].label }));

  // Grup karoları: ürün sayısı, toplam brüt kâr ve (toplam kâr pozitifse) kârdaki payı
  const totalCmAll = items.reduce((a, i) => a + i.totalCm, 0);
  const groups = ORDER.map((k) => {
    const list = items.filter((i) => i.cls === k);
    const sum = list.reduce((a, i) => a + i.totalCm, 0);
    return { k, count: list.length, sum, share: totalCmAll > 0 ? sum / totalCmAll : null };
  });
  const lowPriceCount = items.filter((i) => i.price < i.suggestedPrice).length;
  const unsoldCount = items.filter((i) => i.qty === 0).length;

  const sign = sort.dir === "asc" ? 1 : -1;
  const shown = items
    .filter(
      (i) =>
        (!cls || i.cls === cls) &&
        (!lowPrice || i.price < i.suggestedPrice) &&
        (!unsold || i.qty === 0) &&
        matches(`${i.name} ${i.size} ${i.category}`, q),
    )
    .sort((a, b) => sign * compare(a, b, sort.key) || b.totalCm - a.totalCm);
  const paged = usePaged(shown, PAGE_SIZE, `${cat}|${cls}|${q}|${lowPrice}|${unsold}|${sortParam}`);
  const filtered = !!(cls || q.trim() || lowPrice || unsold);
  const clearFilters = () => {
    setQ("");
    clearQuery(TABLE_FILTERS);
  };

  const shownQty = shown.reduce((a, i) => a + i.qty, 0);
  const shownMix = shown.reduce((a, i) => a + i.mix, 0);
  const shownCm = shown.reduce((a, i) => a + i.totalCm, 0);

  const toggleSort = (key: SortKey) =>
    setSortParam(sortSlug(key, sort.key === key ? (sort.dir === "asc" ? "desc" : "asc") : key === "name" || key === "cls" ? "asc" : "desc"));
  const sortProps = (key: SortKey) => ({ active: sort.key === key ? sort.dir : null, onSort: () => toggleSort(key) });

  // Karoya tıklayınca tablo ekranın altında kalıyorsa (telefonda hep) tabloya kaydırılır: süzgecin etkisi görünsün
  const pickGroup = (k: MenuClass, active: boolean) => {
    setCls(active ? null : k);
    const el = tableRef.current;
    if (!active && el && el.getBoundingClientRect().top > window.innerHeight * 0.6) {
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
  };

  const catName = cat === null ? "Bütün menü" : (categories.find((c) => c.id === cat)?.name ?? "Kategori");
  const noRecipe = cat === null ? allNoRecipe : allNoRecipe.filter((i) => i.categoryId === cat);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          icon={<ChartScatter />}
          title="Menü mühendisliği"
          description="Her ürün satış payına (adet) ve birim kârına göre dört gruba ayrılır."
          meta={
            <>
              <span>{monthLabel}</span>
              <span className="text-ink-quiet">·</span>
              <span className="inline-flex items-center gap-1">
                Popülerlik eşiği ≥ <span className="font-medium text-ink tabular">%{num(popThreshold * 100, 1)}</span>
                <InfoTip text="Satış payı (adet) bu eşiğe eşit ya da üstündeyse ürün popüler sayılır. Eşik, eşit payın %70'idir." />
              </span>
              <span className="text-ink-quiet">·</span>
              <span className="inline-flex items-center gap-1">
                Kâr eşiği <span className="font-medium text-ink tabular">{tl(avgCm, 1)}</span>
                <InfoTip text="Satış ağırlıklı ortalama birim kâr. Birim kârı bu eşiğe eşit ya da üstünde olan ürün çok kazandırır." />
              </span>
            </>
          }
          actionsClassName="max-sm:w-full"
          actions={
            <Select
              value={cat ?? ""}
              onChange={(e) => setCatParam(e.target.value)}
              className="w-auto min-w-44 max-sm:w-full"
              aria-label="Kategori (sınıflar bu kategori içinde yeniden hesaplanır)"
            >
              <option value="">Bütün menü</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          }
        />
        <CardContent className="space-y-4">
          <div>
            <Well className="p-2 sm:p-4">
              {points.length ? (
                <MenuMatrix points={points} popThreshold={popThreshold} avgCm={avgCm} />
              ) : (
                <EmptyState
                  icon={<ChartScatter />}
                  title="Grafikte gösterilecek satış yok"
                  description={`${catName} için bu ay satılan ürün yok.`}
                  action={
                    cat !== null ? (
                      <Button variant="secondary" size="sm" onClick={() => setCatParam("")}>
                        Bütün menüye dön
                      </Button>
                    ) : undefined
                  }
                />
              )}
            </Well>
            <p className="mt-2 text-xs text-ink-mute">
              Grafikte yalnızca bu ay satılan ürünler var; hiç satılmayanlar tabloda &quot;Zayıf&quot; ya da &quot;Bilmece&quot; olarak görünür. Bir
              gruba tıklayınca tablo o gruba süzülür; yeniden tıklayınca süzgeç kalkar.
            </p>
          </div>

          {/* Grup lejantı: dört karo; seçili karonun mürekkep çerçevesi yaylı hareketle kayar */}
          <LayoutGroup id={tilesId}>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {groups.map(({ k, count, sum, share }, index) => {
                const active = cls === k;
                return (
                  <motion.button
                    key={k}
                    type="button"
                    aria-pressed={active}
                    title={active ? "Süzgeci kaldır" : `Tabloda yalnızca ${classInfo[k].label} ürünleri`}
                    onClick={() => pickGroup(k, active)}
                    initial={reduce ? false : REVEAL_FROM}
                    animate={{ opacity: 1, y: 0, transition: revealTransition(reduce, index) }}
                    whileTap={reduce ? undefined : { scale: 0.98 }}
                    transition={SPRING_PRESS}
                    className="relative flex min-w-0 cursor-pointer flex-col items-start gap-3 rounded-2xl bg-surface p-3.5 text-left ring-1 ring-line ring-inset transition-shadow hover:ring-line-strong"
                  >
                    {active ? (
                      <motion.span
                        layoutId={`${tilesId}-ring`}
                        transition={reduce ? { duration: 0 } : SPRING_SWAP}
                        className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-ink ring-inset"
                        aria-hidden="true"
                      />
                    ) : null}
                    <span className="flex w-full items-center justify-between gap-2">
                      <IconTile tone={CLASS_LOOK[k].tile}>{CLASS_LOOK[k].icon}</IconTile>
                      <span className="text-2xl leading-none font-semibold tracking-tight text-ink tabular">
                        <CountUp value={count} format={fmtNum} />
                        <span className="sr-only"> ürün</span>
                      </span>
                    </span>
                    <span className="flex w-full flex-col gap-1">
                      <span className="text-sm font-semibold text-ink">{classInfo[k].label}</span>
                      <span className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs text-ink-mute tabular">
                        <span className="whitespace-nowrap">
                          <Signed value={sum}>{tl(sum)}</Signed> brüt kâr
                        </span>
                        {share !== null ? (
                          <span title="Toplam brüt kârdaki payı">
                            <span className="sr-only">Toplam brüt kârdaki payı </span>
                            {pct(share, 0)}
                          </span>
                        ) : null}
                      </span>
                      {share !== null ? (
                        // Düğme içinde yalnızca satır içi öğe olabilir: Progress'in görünümü span ile
                        <span className="block h-1 w-full overflow-hidden rounded-full bg-panel-deep" aria-hidden="true">
                          <span
                            className="block h-full rounded-full bg-ink transition-[width] duration-500"
                            style={{ width: `${Math.round(Math.max(0, Math.min(1, share)) * 1000) / 10}%` }}
                          />
                        </span>
                      ) : null}
                    </span>
                    <span className="text-[13px] leading-5 text-ink-mute">{classInfo[k].advice}</span>
                  </motion.button>
                );
              })}
            </div>
          </LayoutGroup>
          <NoRecipeNote items={noRecipe} month={month} />
        </CardContent>
      </Card>

      <Card ref={tableRef} className="scroll-mt-20 lg:scroll-mt-6">
        <CardHeader
          icon={<ListOrdered />}
          title="Ürünler"
          description="Başlığa tıklayınca sıralanır; ürün adı ürün kartını açar."
          meta={
            <>
              <span>{catName}</span>
              <span className="text-ink-quiet">·</span>
              <span>{monthLabel}</span>
            </>
          }
        />
        <FilterBar className="px-5 pb-4" active={filtered} onClear={clearFilters} shown={shown.length} total={items.length} unit="ürün">
          <SearchField value={q} onChange={setQ} placeholder="Ürün ya da kategori ara" label="Ürün ara" className="w-full sm:w-64" />
          {groups.map(({ k, count }) => (
            <FilterChip key={k} active={cls === k} count={count} onToggle={() => setCls(cls === k ? null : k)}>
              <span aria-hidden="true" className={cn("size-1.5 rounded-full", CLASS_LOOK[k].dot)} />
              {classInfo[k].label}
            </FilterChip>
          ))}
          <span aria-hidden="true" className="mx-0.5 hidden h-5 w-px bg-line-strong sm:block" />
          <FilterChip active={!!lowPrice} count={lowPriceCount} onToggle={() => setLowPrice(lowPrice ? "" : "1")}>
            Zam önerilen
          </FilterChip>
          <FilterChip active={!!unsold} count={unsoldCount} onToggle={() => setUnsold(unsold ? "" : "1")}>
            Bu ay satılmayan
          </FilterChip>
          {/* Kart görünümünde (xl altı) tablo başlığı yok: sıralama seçimle, başlıkların iki yönü de var */}
          <Select value={sortSlug(sort.key, sort.dir)} onChange={(e) => setSortParam(e.target.value)} aria-label="Sırala" className="w-full sm:w-auto xl:hidden">
            {CARD_SORTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </FilterBar>
        {/* Sayfa değişince buraya kaydırılır (Pagination): yeni sayfanın ilk ürünü üst çubuğun hemen altında */}
        <div data-page-top>
          {paged.slice.length ? (
            <>
              {/*
                Telefon ve tablet: her ürün bir kart; satır kartı ürün kartını açar. Tablo xl ve üstünde: kenar çubuğu lg'de
                açılınca içerik 768px'teki kadar bile geniş kalmıyor (Marj, Fiyat ve göz düğmesi yana kayıp gizlenirdi).
              */}
              <ul className="divide-y divide-line border-t border-line xl:hidden">
                {paged.slice.map((i) => (
                  <li key={i.id}>
                    <Link href={productHref(i.id, month)} className="flex min-h-16 items-start gap-3 px-5 py-3 active:bg-surface/60">
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium break-words text-ink">
                          {i.name} · {i.size}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-mute">
                          <Badge tone={classInfo[i.cls].tone as Tone} dot>
                            {classInfo[i.cls].label}
                          </Badge>
                          <span className="min-w-0 break-words">{i.category}</span>
                        </span>
                        <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-mute tabular">
                          <span className={cn(i.qty === 0 && "text-ink-quiet")}>
                            {num(i.qty)} adet · {pct(i.mix)}
                          </span>
                          <span>
                            Birim <Signed value={i.cm}>{tl(i.cm, 2)}</Signed>
                          </span>
                          <span>Marj {pct(i.margin)}</span>
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-semibold text-ink tabular">
                          <Signed value={i.totalCm}>{tl(i.totalCm)}</Signed>
                        </span>
                        <span className="block text-xs text-ink-mute">brüt kâr</span>
                        <span className="mt-1 block text-xs text-ink-soft tabular">
                          <span className="text-ink-mute">Fiyat </span>
                          {tl(i.price)}
                          {i.price < i.suggestedPrice ? (
                            <span className="block text-bad" title="Önerilen fiyat">
                              → {tl(i.suggestedPrice)}
                              <span className="sr-only"> önerilen</span>
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
                {shown.length > 1 ? (
                  <li className="flex flex-wrap items-baseline justify-between gap-x-3 px-5 py-3.5 text-sm font-semibold text-ink">
                    <span>
                      {filtered ? "Süzülen" : "Toplam"} · {num(shown.length)} ürün
                    </span>
                    <span className="tabular">
                      <Signed value={shownCm}>{tl(shownCm)}</Signed>
                    </span>
                    <span className="w-full text-xs font-normal text-ink-mute tabular">
                      {num(shownQty)} adet · satış payı {pct(shownMix)}
                    </span>
                  </li>
                ) : null}
              </ul>
              <TableWrap className="max-xl:hidden">
                <Table>
                  <THead>
                    <tr>
                      <SortTH sticky {...sortProps("name")}>
                        Ürün
                      </SortTH>
                      <SortTH {...sortProps("cls")}>Grup</SortTH>
                      <SortTH numeric wrap {...sortProps("qty")}>
                        Satış (adet)
                      </SortTH>
                      <SortTH numeric wrap {...sortProps("mix")}>
                        Satış payı
                      </SortTH>
                      <SortTH numeric wrap {...sortProps("cm")}>
                        Birim kâr
                      </SortTH>
                      <SortTH numeric wrap {...sortProps("totalCm")}>
                        Toplam brüt kâr
                      </SortTH>
                      <SortTH numeric {...sortProps("margin")}>
                        Marj
                      </SortTH>
                      <SortTH numeric wrap {...sortProps("price")}>
                        Fiyat (→ önerilen)
                      </SortTH>
                      <TH className="align-bottom">
                        <span className="sr-only">Eylem</span>
                      </TH>
                    </tr>
                  </THead>
                  <tbody>
                    {paged.slice.map((i) => (
                      <TR key={i.id}>
                        <TD sticky className="min-w-40 max-sm:max-w-48">
                          <Link href={productHref(i.id, month)} className="font-medium text-ink hover:underline">
                            {i.name} · {i.size}
                          </Link>
                          <span className="block truncate text-xs text-ink-mute">{i.category}</span>
                        </TD>
                        <TD>
                          <Badge tone={classInfo[i.cls].tone as Tone} dot>
                            {classInfo[i.cls].label}
                          </Badge>
                        </TD>
                        <TD numeric className={cn(i.qty === 0 && "text-ink-mute")}>
                          {num(i.qty)}
                        </TD>
                        <TD numeric>{pct(i.mix)}</TD>
                        <TD numeric>
                          <Signed value={i.cm}>{tl(i.cm, 2)}</Signed>
                        </TD>
                        <TD numeric className="font-semibold">
                          <Signed value={i.totalCm}>{tl(i.totalCm)}</Signed>
                        </TD>
                        <TD numeric>{pct(i.margin)}</TD>
                        <TD numeric>
                          {tl(i.price)}
                          {/* Önerilen fiyat alt satırda: sütun dar kalır, tablo xl'de yana kaymadan sığar */}
                          {i.price < i.suggestedPrice ? (
                            <span className="block text-xs text-bad" title="Önerilen fiyat">
                              → {tl(i.suggestedPrice)}
                              <span className="sr-only"> önerilen</span>
                            </span>
                          ) : null}
                        </TD>
                        <TD className="w-0">
                          <div className="flex justify-end">
                            <IconLink href={productHref(i.id, month)} label={`${i.name} · ${i.size} ürün kartını aç`}>
                              <Eye size={15} aria-hidden="true" />
                            </IconLink>
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </tbody>
                  {shown.length > 1 ? (
                    <tfoot>
                      <TFootRow>
                        <TD sticky className="whitespace-nowrap">
                          {filtered ? "Süzülen" : "Toplam"} · {num(shown.length)} ürün
                        </TD>
                        <TD />
                        <TD numeric>{num(shownQty)}</TD>
                        <TD numeric>{pct(shownMix)}</TD>
                        <TD />
                        <TD numeric>
                          <Signed value={shownCm}>{tl(shownCm)}</Signed>
                        </TD>
                        <TD />
                        <TD />
                        <TD />
                      </TFootRow>
                    </tfoot>
                  ) : null}
                </Table>
              </TableWrap>
            </>
          ) : (
            <EmptyState
              title={items.length ? "Bu süzgece uyan ürün yok" : `${catName} içinde aktif ürün yok`}
              description={
                items.length
                  ? "Arama sözcüğünü ya da seçili grupları değiştirin; süzgeçleri temizleyince bütün ürünler geri gelir."
                  : "Başka bir kategori seçin ya da bütün menüye dönün."
              }
              action={
                filtered ? (
                  <Button variant="secondary" size="sm" onClick={clearFilters}>
                    Süzgeci temizle
                  </Button>
                ) : cat !== null ? (
                  <Button variant="secondary" size="sm" onClick={() => setCatParam("")}>
                    Bütün menüye dön
                  </Button>
                ) : undefined
              }
            />
          )}
          {/* Telefonda sayfa düğmeleri karta sığsın: yan boşluk ve aralık daralır */}
          <Pagination page={paged.page} pageCount={paged.pageCount} onChange={paged.setPage} className="border-t border-line max-sm:px-3 max-sm:[&>div]:gap-1" />
        </div>
      </Card>
    </div>
  );
}

/**
 * Sıralanabilir tablo başlığı: etkin sütunda yön oku ve aria-sort. Başlıklar alta hizalı; `wrap` uzun başlığı iki
 * satıra sarar (tablo 1280px ekranda yana kaymadan sığsın).
 */
function SortTH({
  children,
  numeric,
  sticky,
  wrap,
  active,
  onSort,
}: {
  children: ReactNode;
  numeric?: boolean;
  sticky?: boolean;
  wrap?: boolean;
  active: SortDir | null;
  onSort: () => void;
}) {
  return (
    <TH
      numeric={numeric}
      sticky={sticky}
      className={cn("align-bottom", wrap && "leading-5 whitespace-normal")}
      aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : undefined}
    >
      <SortButton numeric={numeric} dir={active} onClick={onSort}>
        {children}
      </SortButton>
    </TH>
  );
}

/* ───────────────────────── Senaryo simülatörü ───────────────────────── */

/** Yüzde değişim gösterimi: +%5, -%10, %0 */
const signedPct = (v: number) => (v > 0 ? `+${pct(v / 100, 0)}` : pct(v / 100, 0));

/**
 * Senaryo alanları: Türkçe yazım kabul edilir (-30.000, 12.500,50); boş alan ve yazılmakta olan tek "-" 0 sayılır,
 * okunamayan değer null döner ve alanda işaretlenir.
 */
const readTR = (v: string) => (v.trim() === "" || v.trim() === "-" ? 0 : parseNumberTR(v));

/** Tutar farkı: +1.200 ₺, -800 ₺ */
const signedTl = (v: number) => `${v > 0 ? "+" : ""}${tl(v)}`;

/**
 * Yüzde kaydırıcısı: AkmanOS RangeSlider (sürükleme, iz üzerine tıklama, ok / PageUp / Home / End tuşları
 * ve yaylı kayan tutamaç). Üstte etiket + ⓘ + değer hapı, izde %0 işareti, altta uçlar.
 */
function PercentSlider({
  label,
  value,
  onChange,
  min,
  max,
  info,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  info?: string;
}) {
  // Tutamacın merkezi izde 3px ile (genişlik - 3px) arasında gezer; %0 işareti aynı aralığa oturur
  const zero = (0 - min) / (max - min);
  const zeroLeft = `calc(3px + (100% - 6px) * ${zero})`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="text-[13px] font-medium text-ink-soft">{label}</span>
          {info ? <InfoTip text={info} /> : null}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular transition-colors",
            value === 0 ? "bg-panel text-ink-mute" : "bg-info-soft text-info",
          )}
        >
          {signedPct(value)}
        </span>
      </div>
      <div className="relative">
        <RangeSlider
          value={value}
          onValueChange={onChange}
          min={min}
          max={max}
          step={1}
          showTicks={false}
          aria-label={label}
          formatValueText={signedPct}
        />
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-2.5 w-px -translate-x-1/2 bg-ink/25" style={{ left: zeroLeft }} />
      </div>
      <div className="relative h-4 text-[11px] text-ink-mute tabular" aria-hidden="true">
        <span className="absolute left-0">{signedPct(min)}</span>
        <span className="absolute -translate-x-1/2" style={{ left: zeroLeft }}>
          %0
        </span>
        <span className="absolute right-0">{signedPct(max)}</span>
      </div>
    </div>
  );
}

/**
 * Şu an → senaryo farkı (AkmanOS büyüme rozeti). `lowerIsBetter` başabaş gibi azalması iyi olan değerler için:
 * renk iyileşmeyi, işaret yönü gösterir.
 */
function DiffPill({ diff, lowerIsBetter }: { diff: number; lowerIsBetter?: boolean }) {
  const flat = Math.abs(diff) < 1;
  return (
    <GrowthPill value={flat ? 0 : lowerIsBetter ? -diff : diff}>
      <span className="sr-only">Şu ana göre fark: </span>
      {flat ? "0 ₺" : signedTl(diff)}
    </GrowthPill>
  );
}

export function ScenarioSimulator({
  base,
  acikGun,
  month,
  monthLabel,
  fixedItems,
  breakEvenItems,
  kasa = "ModPOS",
}: {
  base: ScenarioBase;
  acikGun: number;
  /** Seçili ay (YYYY-MM): döküm satırlarının bağlantıları bu ayı taşır */
  month: string;
  monthLabel: string;
  /** Ayın kasası (src/lib/lafpos/kasa.ts monthKasa: "ModPOS", "LafPOS", geçiş ayında "Kasa"; denetim E-39) */
  kasa?: MonthKasa["short"];
  /** Bu ayın sabit gider kalemleri (Genel bakış'taki net kârla aynı tutarlar, sunucuda kurulur): net kâr dökümünde */
  fixedItems: BreakdownRow[];
  /** Başabaşın sabit gider kalemleri (standart ay + her ay girilen harcamalar): başabaş dökümünde */
  breakEvenItems?: BreakdownRow[];
}) {
  const [price, setPrice] = useState(0);
  const [cost, setCost] = useState(0);
  const [volume, setVolume] = useState(0);
  const [extra, setExtra] = useState("0");
  const [target, setTarget] = useState("50.000");
  const extraParsed = readTR(extra);
  const targetParsed = readTR(target);
  const extraNum = extraParsed ?? 0;
  const { base: b, scenario: s } = applyScenario(base, { priceChangePct: price / 100, costChangePct: cost / 100, volumeChangePct: volume / 100, extraFixed: extraNum }, acikGun);

  // Başabaş için gereken ortalama zam ve satış artışı (diğerleri sabitken); hesap dökümle ortak (breakdowns.ts)
  const { price: priceForBreakEven, volume: volumeForBreakEven } = breakEvenNeeds(base);
  const targetNum = targetParsed ?? 0;
  const dailyForTarget = targetDaily(s, targetNum, acikGun);
  const baseDailyForTarget = targetDaily(b, targetNum, acikGun);

  const dirty = price !== 0 || cost !== 0 || volume !== 0 || extraNum !== 0;
  const profitDiff = s.profit - b.profit;
  // Kartların dökümü: kaydırıcılar değişince yeniden kurulur, pencere kartın o anki rakamını gösterir
  const sides = { b, s, dirty, extraFixed: extraNum };
  const scope = dirty ? " Senaryodaki değerlerle; alt satırda şu anki değer." : "";

  const rows: { label: string; b: number; s: number; good: "up" | "down" }[] = [
    { label: "Ciro (KDV dahil)", b: b.revenue, s: s.revenue, good: "up" },
    { label: "Net satış (KDV hariç)", b: b.net, s: s.net, good: "up" },
    { label: "– Malzeme + ambalaj", b: b.material, s: s.material, good: "down" },
    { label: "– POS komisyonu", b: b.commission, s: s.commission, good: "down" },
    { label: "Brüt kâr", b: b.gross, s: s.gross, good: "up" },
    { label: "– İndirimler", b: b.discountsNet, s: s.discountsNet, good: "down" },
    { label: "– Sabit giderler", b: b.fixed, s: s.fixed, good: "down" },
    ...(b.online ? [{ label: "+ laffogato.net online brüt kârı", b: b.online, s: s.online, good: "up" as const }] : []),
  ];
  const period = base.listPeriod ? `${base.listPeriod} listesi` : `${monthLabel} satış karması`;

  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <Card className="xl:sticky xl:top-6 xl:col-span-4 xl:self-start">
        <CardHeader
          icon={<SlidersHorizontal />}
          title={
            <span className="inline-flex items-center gap-1.5">
              Senaryo
              <InfoTip text="Örnek: “Bütün menüye %5 zam yaparsam, süt %10 zamlanırsa, satışlar %15 artarsa ay sonu ne olur?”" />
            </span>
          }
          // Senaryo kasanın satış listesinin karmasıyladır; "Şu an" Genel bakış'taki net kârla aynı taban (denetim E-12):
          // liste döneminin sabit gideri ve indirimi, online brüt kâr ayrı satır (kaydırıcılar değiştirmez)
          description={`${base.listPeriod ? `${base.listPeriod} ${kasa} listesinin` : `${monthLabel} ${kasa} satış`} karmasından yola çıkar. laffogato.net online brüt kârı ayrı satırda; kaydırıcılar onu değiştirmez.`}
          actions={
            <Button
              variant="secondary"
              size="sm"
              disabled={!dirty}
              onClick={() => {
                setPrice(0);
                setCost(0);
                setVolume(0);
                setExtra("0");
              }}
            >
              <RotateCcw size={14} aria-hidden="true" />
              Sıfırla
            </Button>
          }
        />
        <CardContent>
          <Well className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
            <PercentSlider
              label="Menü fiyatları"
              value={price}
              onChange={setPrice}
              min={-20}
              max={40}
              info="Bütün ürünlere aynı oranda zam / indirim. Müşterinin satın alma alışkanlığı aynı kalır varsayılır."
            />
            <PercentSlider label="Malzeme maliyetleri" value={cost} onChange={setCost} min={-20} max={50} info="Tedarikçi zamları ya da daha ucuz tedarikçi." />
            <PercentSlider label="Satış adedi" value={volume} onChange={setVolume} min={-50} max={100} info="Daha çok / daha az müşteri." />
            <Field
              label="Aylık sabit gider değişimi (₺)"
              hint="ör. reklamı 30.000 ₺ azaltmak için -30.000 (± düğmesi eksi yapar), yeni personel için 25.000"
              error={extraParsed === null ? "Sayı okunamadı. Örnek: -30.000 ya da 12.500,50" : undefined}
              htmlFor="sc-extra"
            >
              {/*
                iPhone'un sayı klavyesinde eksi tuşu yok: ± düğmesi işareti çevirir. Düğme odağı almaz; yazarken
                basılınca klavye kapanmaz, imleç sonda kalır. Odaklanınca eksi işareti seçime girmez (üstüne yazılmaz);
                imleç yine de başa düşüp "5000-" yazılırsa eksi başa alınır.
              */}
              <div className="flex gap-2">
                <NumberInput
                  id="sc-extra"
                  value={extra}
                  onChange={(e) => setExtra(normalizeSign(e.target.value))}
                  onFocus={(e) => e.currentTarget.setSelectionRange(...selectionAfterSign(e.currentTarget.value))}
                  aria-invalid={extraParsed === null || undefined}
                  className="cell-input min-w-0 flex-1"
                />
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label="Artı / eksi: işareti çevir"
                  title="Artı / eksi"
                  aria-controls="sc-extra"
                  onPointerDown={(e) => e.preventDefault()}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setExtra(flipSign(extra))}
                  className="text-base font-semibold text-ink"
                >
                  ±
                </Button>
              </div>
            </Field>
          </Well>
        </CardContent>
        {/* Telefonda ve tablette sonuçlar kaydırıcıların altında kalır: kart boyunca altta yapışık özet */}
        <div className="sticky bottom-[calc(var(--mobile-nav-h,0px)+0.75rem)] z-10 mx-3 mb-3 xl:hidden">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-2xl bg-surface px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.14)] ring-1 ring-line-strong">
            <span className="text-[13px] text-ink-mute">Senaryoda aylık net kâr / zarar</span>
            <span className="flex items-baseline gap-2">
              <Signed value={s.profit} className={cn("text-base font-semibold whitespace-nowrap", s.profit >= 0 && "text-good")}>
                {tl(s.profit)}
              </Signed>
              {dirty ? <DiffPill diff={profitDiff} /> : null}
            </span>
          </div>
        </div>
      </Card>

      <div className="flex flex-col gap-4 xl:col-span-8">
        {/* Kartlara dokununca rakamın dökümü açılır (senaryonun o anki değerleriyle) */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Reveal index={0}>
            <StatBreakdown
              className="h-full"
              title={dirty ? "Senaryoda aylık net kâr / zarar" : "Aylık net kâr / zarar"}
              description={`${period} ile: brüt kâr − indirimler − sabit giderler${b.online ? " + laffogato.net online brüt kârı" : ""} (KDV hariç). Genel bakış'taki net kârla aynı hesap: sabit giderler bu ayın tutarlarıdır${base.listPeriod ? ", listenin dönemine düşen payıyla" : ""}.${scope}`}
              groups={profitGroups({ ...sides, fixedItems, month })}
              total={s.profit}
              totalLabel={dirty ? "Senaryoda net kâr / zarar" : "Net kâr / zarar"}
              order="given"
              shares={false}
              empty="Bu ay için satış ya da gider yok."
            >
              <Stat
                className="h-full"
                icon={<Wallet />}
                label="Aylık net kâr / zarar"
                value={<CountUp value={s.profit} />}
                tone={s.profit < 0 ? "bad" : "good"}
                badge={dirty ? <DiffPill diff={profitDiff} /> : null}
                sub={
                  <>
                    Şu an <Signed value={b.profit}>{tl(b.profit)}</Signed>
                  </>
                }
              />
            </StatBreakdown>
          </Reveal>
          <Reveal index={1}>
            <StatBreakdown
              className="h-full"
              title="Başabaş günlük ciro"
              description={`Genel bakış'taki başabaşla aynı: (standart aylık sabit gider + her ay girilen harcamalar${b.onlineCover ? " − laffogato.net online brüt kârı" : ""}) ÷ brüt kâr oranı ÷ ${num(acikGun)} açık gün. Ciro KDV dahil; indirimler bu hesaba girmez.${scope}`}
              groups={breakEvenGroups({ ...sides, acikGun, breakEvenItems })}
              total={s.breakEvenDaily ?? 0}
              totalLabel="Başabaş günlük ciro"
              totalDisplay={tl(s.breakEvenDaily)}
              order="given"
              shares={false}
            >
              <Stat
                className="h-full"
                icon={<Scale />}
                label="Başabaş günlük ciro"
                info={`Sabit giderleri karşılamak için gereken günlük ciro, ${acikGun} açık güne göre.`}
                value={<CountUp value={s.breakEvenDaily} />}
                badge={dirty && s.breakEvenDaily !== null && b.breakEvenDaily !== null ? <DiffPill diff={s.breakEvenDaily - b.breakEvenDaily} lowerIsBetter /> : null}
                sub={`Şu an ${tl(b.breakEvenDaily)}`}
              />
            </StatBreakdown>
          </Reveal>
          <Reveal index={2}>
            <StatBreakdown
              className="h-full"
              title="Zarar etmemek için"
              description={`${monthLabel} rakamlarıyla, diğer her şey sabitken tek başına gereken ortalama zam ya da satış artışı. Kaydırıcılar bu kartı değiştirmez.`}
              groups={breakEvenNeedGroups(b)}
              order="given"
              shares={false}
              hideTotal
            >
              <Stat
                className="h-full"
                icon={<ShieldCheck />}
                label="Zarar etmemek için"
                info="Diğer her şey sabitken, tek başına gereken ortalama zam ya da satış artışı (şu anki aya göre)."
                value={priceForBreakEven !== null ? pct(priceForBreakEven, 1) : "–"}
                suffix={priceForBreakEven !== null ? "ortalama zam" : undefined}
                sub={volumeForBreakEven !== null ? `ya da ${pct(volumeForBreakEven, 0)} daha fazla satış` : undefined}
              />
            </StatBreakdown>
          </Reveal>
          <Reveal index={3}>
            <StatBreakdown
              className="h-full"
              title="Hedef kâr için günlük ciro"
              description={`(Sabit giderler${b.onlineCover ? " − online brüt kâr" : ""} + hedef kâr) ÷ brüt kâr oranı ÷ ${num(acikGun)} açık gün. Ciro KDV dahil.${scope}`}
              groups={targetGroups({ ...sides, acikGun, target: targetNum, targetValid: targetParsed !== null })}
              total={dailyForTarget ?? 0}
              totalLabel="Hedef kâr için günlük ciro"
              totalDisplay={tl(dailyForTarget)}
              order="given"
              shares={false}
            >
              <Stat
                className="h-full"
                icon={<Target />}
                label="Hedef kâr için günlük ciro"
                info="Senaryodaki brüt kâr oranıyla sabit giderleri ve hedef kârı karşılayan günlük ciro."
                value={<CountUp value={dailyForTarget} />}
                badge={dirty && dailyForTarget !== null && baseDailyForTarget !== null ? <DiffPill diff={dailyForTarget - baseDailyForTarget} lowerIsBetter /> : null}
                sub={`Şu an ${tl(baseDailyForTarget)}`}
              >
                {/* Alan döküm düğmesinin üstünde (konumlu): dokununca pencere değil alan açılır */}
                <div className="relative">
                  <Field
                    label="Hedef aylık kâr (₺)"
                    error={targetParsed === null ? "Sayı okunamadı. Örnek: 50.000" : undefined}
                    htmlFor="sc-target"
                  >
                    <NumberInput
                      id="sc-target"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                      onFocus={(e) => e.currentTarget.select()}
                      aria-invalid={targetParsed === null || undefined}
                      className="cell-input"
                    />
                  </Field>
                </div>
              </Stat>
            </StatBreakdown>
          </Reveal>
        </div>

        <Card>
          <CardHeader icon={<Calculator />} title="Aylık karşılaştırma" description="Şu anki ay ile senaryo, kalem kalem." />
          {/* Telefonda dört sütun sığmaz: her kalem iki satır (senaryo değeri, altında şu an ve fark) */}
          <ul className="divide-y divide-line px-5 pb-2 sm:hidden">
            {rows.map((r) => {
              const d = r.s - r.b;
              const better = r.good === "up" ? d > 0 : d < 0;
              return (
                <li key={r.label} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 text-ink">{r.label}</span>
                    <span className="shrink-0 font-semibold whitespace-nowrap text-ink tabular">{tl(r.s)}</span>
                  </div>
                  <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-ink-mute tabular">
                    <span className="whitespace-nowrap">Şu an {tl(r.b)}</span>
                    <span className={cn("whitespace-nowrap", Math.abs(d) < 1 ? "" : better ? "text-good" : "text-bad")}>
                      {Math.abs(d) < 1 ? "fark yok" : signedTl(d)}
                    </span>
                  </div>
                </li>
              );
            })}
            <li className="py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-ink">Net kâr / zarar</span>
                <Signed value={s.profit} className="text-base font-semibold whitespace-nowrap">
                  {tl(s.profit)}
                </Signed>
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-ink-mute tabular">
                <span className="whitespace-nowrap">
                  Şu an <Signed value={b.profit}>{tl(b.profit)}</Signed>
                </span>
                <span className={cn("whitespace-nowrap", Math.abs(profitDiff) < 1 ? "" : profitDiff > 0 ? "text-good" : "text-bad")}>
                  {Math.abs(profitDiff) < 1 ? "fark yok" : signedTl(profitDiff)}
                </span>
              </div>
            </li>
          </ul>
          <TableWrap className="max-sm:hidden">
            <Table>
              <THead>
                <tr>
                  <TH sticky>Aylık</TH>
                  <TH numeric>Şu an</TH>
                  <TH numeric>Senaryo</TH>
                  <TH numeric>Fark</TH>
                </tr>
              </THead>
              <tbody>
                {rows.map((r) => {
                  const d = r.s - r.b;
                  const better = r.good === "up" ? d > 0 : d < 0;
                  return (
                    <TR key={r.label}>
                      <TD sticky className="whitespace-nowrap">
                        {r.label}
                      </TD>
                      <TD numeric>{tl(r.b)}</TD>
                      <TD numeric>{tl(r.s)}</TD>
                      <TD numeric className={cn(Math.abs(d) < 1 ? "text-ink-mute" : better ? "text-good" : "text-bad")}>
                        {Math.abs(d) < 1 ? "–" : signedTl(d)}
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
              <tfoot>
                <TFootRow className="text-base">
                  <TD sticky className="whitespace-nowrap">
                    Net kâr / zarar
                  </TD>
                  <TD numeric>
                    <Signed value={b.profit}>{tl(b.profit)}</Signed>
                  </TD>
                  <TD numeric>
                    <Signed value={s.profit}>{tl(s.profit)}</Signed>
                  </TD>
                  <TD numeric className={cn(Math.abs(profitDiff) < 1 ? "text-ink-mute" : profitDiff > 0 ? "text-good" : "text-bad")}>
                    {Math.abs(profitDiff) < 1 ? "–" : signedTl(profitDiff)}
                  </TD>
                </TFootRow>
              </tfoot>
            </Table>
          </TableWrap>
          <CardFooter>
            <p className="text-xs">
              Varsayımlar: satış karması ve indirim oranı sabit; komisyon cironun aynı yüzdesi; sabit giderler {acikGun} açık güne göre. Malzeme maliyeti
              reçetelere göredir (fire ve ikram hariç).
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
