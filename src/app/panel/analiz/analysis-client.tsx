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
  X,
} from "lucide-react";
import { LayoutGroup, motion } from "motion/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Activity, useId, useMemo, useState, type ReactNode } from "react";

import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT, SPRING_PRESS, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { RangeSlider } from "@/components/akmanos/range-slider";
import { MenuMatrix } from "@/components/charts";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button, IconLink } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, Well } from "@/components/ui/card";
import { Field, NumberInput, SearchInput, Select } from "@/components/ui/form";
import { IconTile, type PastelTone } from "@/components/ui/icon-tile";
import { EmptyState, GrowthPill, InfoTip, Signed, Stat } from "@/components/ui/misc";
import { Pagination, usePaged } from "@/components/ui/pagination";
import { Segmented } from "@/components/ui/segmented";
import { SortButton, Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import { parseNumberTR } from "@/lib/calc/expr";
import { applyScenario, type MenuClass, type ScenarioBase } from "@/lib/calc/insights";
import { num, pct, tl } from "@/lib/format";
import { cn, matchesSearch } from "@/lib/utils";

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
      <Segmented
        label="Analiz aracı"
        value={view}
        onChange={change}
        className="self-start"
        options={[
          {
            value: "menu",
            label: (
              <>
                <ChartScatter size={15} aria-hidden="true" />
                Menü mühendisliği
              </>
            ),
          },
          {
            value: "senaryo",
            label: (
              <>
                <SlidersHorizontal size={15} aria-hidden="true" />
                Senaryo simülatörü
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
const CLASS_LOOK: Record<MenuClass, { icon: ReactNode; tile: PastelTone }> = {
  star: { icon: <Star />, tile: 0 },
  plowhorse: { icon: <Tractor />, tile: 1 },
  puzzle: { icon: <Puzzle />, tile: 2 },
  dog: { icon: <TrendingDown />, tile: 3 },
};

type SortKey = "name" | "cls" | "qty" | "mix" | "cm" | "totalCm" | "margin" | "price";
type SortDir = "asc" | "desc";

function compare(a: Item, b: Item, key: SortKey) {
  if (key === "name") return `${a.name} ${a.size}`.localeCompare(`${b.name} ${b.size}`, "tr");
  if (key === "cls") return ORDER.indexOf(a.cls) - ORDER.indexOf(b.cls);
  return a[key] - b[key];
}

const PAGE_SIZE = 25;

export function MenuEngineering({
  monthLabel,
  items: allItems,
  popThreshold: allThreshold,
  avgCm: allAvg,
  classInfo,
  categories,
}: {
  monthLabel: string;
  items: Item[];
  popThreshold: number;
  avgCm: number;
  classInfo: Record<MenuClass, { label: string; advice: string; tone: string }>;
  categories: { id: number; name: string }[];
}) {
  const [cat, setCat] = useState<number | null>(null);
  const [cls, setCls] = useState<MenuClass | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "totalCm", dir: "desc" });
  const reduce = useCalmMotion();
  const tilesId = useId();

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

  const sign = sort.dir === "asc" ? 1 : -1;
  const shown = items
    .filter((i) => (!cls || i.cls === cls) && matchesSearch(`${i.name} ${i.size} ${i.category}`, q))
    .sort((a, b) => sign * compare(a, b, sort.key) || b.totalCm - a.totalCm);
  const paged = usePaged(shown, PAGE_SIZE, `${cat}|${cls}|${q}|${sort.key}|${sort.dir}`);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" || key === "cls" ? "asc" : "desc" }));
  const sortProps = (key: SortKey) => ({ active: sort.key === key ? sort.dir : null, onSort: () => toggleSort(key) });

  const catName = cat === null ? "Bütün menü" : (categories.find((c) => c.id === cat)?.name ?? "Kategori");

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
          actions={
            <Select value={cat ?? ""} onChange={(e) => setCat(e.target.value ? Number(e.target.value) : null)} className="w-auto min-w-44" aria-label="Kategori">
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
                <EmptyState icon={<ChartScatter />} title="Grafikte gösterilecek satış yok" description={`${catName} için bu ay satılan ürün yok.`} />
              )}
            </Well>
            <p className="mt-2 text-xs text-ink-mute">
              Grafikte yalnızca bu ay satılan ürünler var; hiç satılmayanlar tabloda &quot;Zayıf&quot; ya da &quot;Bilmece&quot; olarak görünür. Tabloyu
              süzmek için bir gruba tıklayın.
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
                    title={active ? "Filtreyi kaldır" : `Tabloda yalnızca ${classInfo[k].label} ürünleri`}
                    onClick={() => setCls(active ? null : k)}
                    initial={reduce ? false : REVEAL_FROM}
                    animate={{ opacity: 1, y: 0, transition: revealTransition(reduce, index) }}
                    whileTap={reduce ? undefined : { scale: 0.98 }}
                    transition={SPRING_PRESS}
                    className="relative flex cursor-pointer flex-col items-start gap-3 rounded-2xl bg-surface p-3.5 text-left ring-1 ring-line ring-inset transition-shadow hover:ring-line-strong"
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
                        <span>
                          <Signed value={sum}>{tl(sum)}</Signed> brüt kâr
                        </span>
                        {share !== null ? <span title="Toplam brüt kârdaki payı">{pct(share, 0)}</span> : null}
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          icon={<ListOrdered />}
          title="Ürünler"
          meta={
            <>
              <span>{catName}</span>
              <span className="text-ink-quiet">·</span>
              <span className="tabular">{num(shown.length)} ürün</span>
              {cls ? (
                <button
                  type="button"
                  onClick={() => setCls(null)}
                  aria-label={`${classInfo[cls].label} filtresini kaldır`}
                  className="-my-2 ml-1 inline-flex cursor-pointer items-center py-2"
                >
                  <Badge tone={classInfo[cls].tone as Tone} dot>
                    {classInfo[cls].label}
                    <X size={12} aria-hidden="true" />
                  </Badge>
                </button>
              ) : null}
            </>
          }
          actions={<SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ürün ara…" aria-label="Ürün ara" wrapperClassName="w-full sm:w-60" />}
          actionsClassName="max-sm:w-full"
        />
        {paged.slice.length ? (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <SortTH sticky {...sortProps("name")}>
                    Ürün
                  </SortTH>
                  <SortTH {...sortProps("cls")}>Grup</SortTH>
                  <SortTH numeric {...sortProps("qty")}>
                    Satış
                  </SortTH>
                  <SortTH numeric {...sortProps("mix")}>
                    Satış payı
                  </SortTH>
                  <SortTH numeric {...sortProps("cm")}>
                    Birim kâr
                  </SortTH>
                  <SortTH numeric {...sortProps("totalCm")}>
                    Toplam brüt kâr
                  </SortTH>
                  <SortTH numeric {...sortProps("margin")}>
                    Marj
                  </SortTH>
                  <SortTH numeric {...sortProps("price")}>
                    Fiyat (→ önerilen)
                  </SortTH>
                  <TH>
                    <span className="sr-only">Eylem</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {paged.slice.map((i) => (
                  <TR key={i.id}>
                    <TD sticky className="min-w-40">
                      <Link href={`/panel/urunler/${i.id}`} className="font-medium text-ink hover:underline">
                        {i.name} · {i.size}
                      </Link>
                      <span className="block text-xs text-ink-mute">{i.category}</span>
                    </TD>
                    <TD>
                      <Badge tone={classInfo[i.cls].tone as Tone} dot>
                        {classInfo[i.cls].label}
                      </Badge>
                    </TD>
                    <TD numeric>{num(i.qty)}</TD>
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
                      {i.price < i.suggestedPrice ? (
                        <span className="text-bad" title="Önerilen fiyat">
                          {" "}
                          → {tl(i.suggestedPrice)}
                        </span>
                      ) : null}
                    </TD>
                    <TD className="w-0">
                      <div className="flex justify-end">
                        <IconLink href={`/panel/urunler/${i.id}`} label={`${i.name} · ${i.size} ürün kartını aç`}>
                          <Eye size={15} aria-hidden="true" />
                        </IconLink>
                      </div>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState
            title="Bu filtreye uyan ürün yok"
            description={items.length ? "Arama sözcüğünü ya da grup filtresini değiştirin." : `${catName} içinde aktif ürün yok.`}
            action={
              cls || q ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setCls(null);
                    setQ("");
                  }}
                >
                  Filtreleri temizle
                </Button>
              ) : undefined
            }
          />
        )}
        <Pagination page={paged.page} pageCount={paged.pageCount} onChange={paged.setPage} className="border-t border-line" />
      </Card>
    </div>
  );
}

/** Sıralanabilir tablo başlığı: etkin sütunda yön oku ve aria-sort */
function SortTH({
  children,
  numeric,
  sticky,
  active,
  onSort,
}: {
  children: ReactNode;
  numeric?: boolean;
  sticky?: boolean;
  active: SortDir | null;
  onSort: () => void;
}) {
  return (
    <TH numeric={numeric} sticky={sticky} aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : undefined}>
      <SortButton numeric={numeric} dir={active} onClick={onSort}>
        {children}
      </SortButton>
    </TH>
  );
}

/* ───────────────────────── Senaryo simülatörü ───────────────────────── */

/** Yüzde değişim gösterimi: +%5, -%10, %0 */
const signedPct = (v: number) => (v > 0 ? `+${pct(v / 100, 0)}` : pct(v / 100, 0));

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

export function ScenarioSimulator({ base, acikGun, monthLabel }: { base: ScenarioBase; acikGun: number; monthLabel: string }) {
  const [price, setPrice] = useState(0);
  const [cost, setCost] = useState(0);
  const [volume, setVolume] = useState(0);
  const [extra, setExtra] = useState("0");
  const [target, setTarget] = useState("50.000");
  const extraNum = parseNumberTR(extra) ?? 0;
  const { base: b, scenario: s } = applyScenario(base, { priceChangePct: price / 100, costChangePct: cost / 100, volumeChangePct: volume / 100, extraFixed: extraNum }, acikGun);

  // Başabaş için gereken ortalama zam ve satış artışı (diğerleri sabitken)
  const priceForBreakEven = base.net - base.commission - base.discountsNet > 0 ? (base.material + base.fixed) / (base.net - base.commission - base.discountsNet) - 1 : null;
  const unitContribution = base.net - base.material - base.commission - base.discountsNet;
  const volumeForBreakEven = unitContribution > 0 ? base.fixed / unitContribution - 1 : null;
  const targetNum = parseNumberTR(target) ?? 0;
  const dailyForTarget = s.grossRatio > 0 ? (s.fixed + targetNum) / s.grossRatio / acikGun : null;
  const baseDailyForTarget = b.grossRatio > 0 ? (b.fixed + targetNum) / b.grossRatio / acikGun : null;

  const dirty = price !== 0 || cost !== 0 || volume !== 0 || extra !== "0";
  const profitDiff = s.profit - b.profit;

  const rows: { label: string; b: number; s: number; good: "up" | "down" }[] = [
    { label: "Ciro (KDV dahil)", b: b.revenue, s: s.revenue, good: "up" },
    { label: "Net satış (KDV hariç)", b: b.net, s: s.net, good: "up" },
    { label: "– Malzeme + ambalaj", b: b.material, s: s.material, good: "down" },
    { label: "– POS komisyonu", b: b.commission, s: s.commission, good: "down" },
    { label: "Brüt kâr", b: b.gross, s: s.gross, good: "up" },
    { label: "– İndirimler", b: b.discountsNet, s: s.discountsNet, good: "down" },
    { label: "– Sabit giderler", b: b.fixed, s: s.fixed, good: "down" },
  ];

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
          description={`${monthLabel} satış karmasından yola çıkar.`}
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
            <Field label="Aylık sabit gider değişimi (₺)" hint="ör. reklamı 30.000 ₺ azaltmak için -30000" htmlFor="sc-extra">
              <NumberInput id="sc-extra" value={extra} onChange={(e) => setExtra(e.target.value)} className="cell-input" />
            </Field>
          </Well>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4 xl:col-span-8">
        <div className="grid gap-3 sm:grid-cols-2">
          <Reveal index={0}>
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
          </Reveal>
          <Reveal index={1}>
            <Stat
              className="h-full"
              icon={<Scale />}
              label="Başabaş günlük ciro"
              info={`Sabit giderleri karşılamak için gereken günlük ciro, ${acikGun} açık güne göre.`}
              value={<CountUp value={s.breakEvenDaily} />}
              badge={dirty && s.breakEvenDaily !== null && b.breakEvenDaily !== null ? <DiffPill diff={s.breakEvenDaily - b.breakEvenDaily} lowerIsBetter /> : null}
              sub={`Şu an ${tl(b.breakEvenDaily)}`}
            />
          </Reveal>
          <Reveal index={2}>
            <Stat
              className="h-full"
              icon={<ShieldCheck />}
              label="Zarar etmemek için"
              info="Diğer her şey sabitken, tek başına gereken ortalama zam ya da satış artışı (şu anki aya göre)."
              value={priceForBreakEven !== null ? pct(priceForBreakEven, 1) : "–"}
              suffix={priceForBreakEven !== null ? "ortalama zam" : undefined}
              sub={volumeForBreakEven !== null ? `ya da ${pct(volumeForBreakEven, 0)} daha fazla satış` : undefined}
            />
          </Reveal>
          <Reveal index={3}>
            <Stat
              className="h-full"
              icon={<Target />}
              label="Hedef kâr için günlük ciro"
              info="Senaryodaki brüt kâr oranıyla sabit giderleri ve hedef kârı karşılayan günlük ciro."
              value={<CountUp value={dailyForTarget} />}
              badge={dirty && dailyForTarget !== null && baseDailyForTarget !== null ? <DiffPill diff={dailyForTarget - baseDailyForTarget} lowerIsBetter /> : null}
              sub={`Şu an ${tl(baseDailyForTarget)}`}
            >
              <Field label="Hedef aylık kâr (₺)" htmlFor="sc-target">
                <NumberInput id="sc-target" value={target} onChange={(e) => setTarget(e.target.value)} className="cell-input" />
              </Field>
            </Stat>
          </Reveal>
        </div>

        <Card>
          <CardHeader icon={<Calculator />} title="Aylık karşılaştırma" description="Şu anki ay ile senaryo, kalem kalem." />
          <TableWrap>
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
