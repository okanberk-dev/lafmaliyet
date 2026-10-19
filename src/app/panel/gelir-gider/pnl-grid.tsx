"use client";

import { CalendarRange, RotateCcw } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT } from "@/components/akmanos/lib/motion-ease";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, Well } from "@/components/ui/card";
import { clearQuery, FilterBar, FilterChip, matches, SearchField, useQueryState, useQueryText } from "@/components/ui/filters";
import { Select } from "@/components/ui/form";
import { EmptyState, InfoTip, SegmentStrip } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { TableWrap, TD, TH } from "@/components/ui/table";
import type { PnlCell, PnlRowDef } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import { MONTH_NAMES } from "@/lib/constants";
import { num, pct, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { setMonthField, setPnlCell } from "@/server/actions/pnl";

export interface GridSection {
  key: string;
  label: string;
  rows: { def: PnlRowDef; cells: PnlCell[]; total: number | null }[];
}

/** Yıl şeridinin bir ayı (sayfa hesaplar, tablo gösterir) */
export interface StripMonth {
  key: string;
  tone: "good" | "bad" | "warn" | "empty";
  label: string;
  /** Çubuğun altındaki kısa ad, ör. "Eyl" */
  short: string;
}

/**
 * Sunucu sayfasının özet rakamları için AkmanOS sayacı (charts/animated-number).
 * Biçim işlevi sunucudan istemciye geçemediği için adıyla verilir.
 */
export function CountUp({ value, format = "tl" }: { value: number | null; format?: "tl" | "pct" }) {
  if (value === null) return <>{format === "pct" ? pct(null) : tl(null)}</>;
  return <AnimatedNumber value={value} format={format === "pct" ? (v) => pct(v) : (v) => tl(v)} className="tabular" />;
}

/** Çok yıl olduğunda sekmeler yerine açılır liste */
export function YearPicker({ year, years }: { year: number; years: number[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Select
      value={year}
      onChange={(e) => start(() => router.push(`/panel/gelir-gider?yil=${e.target.value}`))}
      className={cn("w-32", pending && "opacity-60")}
      aria-label="Yıl"
    >
      {years.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </Select>
  );
}

function fmt(v: number | null, format?: string) {
  if (v === null || v === undefined) return "–";
  if (format === "percent") return pct(v);
  if (format === "days") return num(v);
  return tl(v);
}

/**
 * Sabit ilk sütun: paylaşılan TH/TD `sticky` (opak panel zemini, satır üzerine gelince aynı ton) +
 * genişlik ve sağında ince çizgi. Telefonda dar: "Son ay" görünümünde kalem + ay + yıl toplamı 375px ekrana
 * yatay kaydırmasız sığar. Geniş ekranda tam ad sığar.
 */
const STICKY = "w-32 min-w-32 pl-4 pr-2 shadow-[inset_-1px_0_0_var(--color-line-strong)] sm:w-72 sm:min-w-72 sm:pl-5 sm:pr-3";
/** Yıl toplamı sütunu */
const YEAR_COL = "bg-ink/[0.03] pr-3 pl-2 text-right whitespace-nowrap tabular sm:pr-5 sm:pl-3";
/** Girilebilir hücrenin en dar hali (telefonda biraz daha dar) */
const CELL_MIN = "min-w-20 sm:min-w-24";
/**
 * Başlık satırı tablo kabının içinde yukarıda sabit kalır (uzun tabloda ay adları kaybolmasın).
 * Zemin opak olmalı: altından geçen satırlar görünmesin. Yıl sütununun başlığı aynı tonun opak karşılığı.
 */
const HEAD = "sticky top-0 z-20 bg-panel";
const HEAD_YEAR = "sticky top-0 z-20 bg-[color-mix(in_oklab,var(--color-panel),black_3%)]";
/**
 * Hücre çizgileri hücrede (border-separate): sabit sütun kayarken çizgisini korur.
 * Üzerine gelme tonu paylaşılan TR ile aynı (surface/60); sabit hücre TD sticky ile eşleşir.
 */
const ROW = "group transition-colors hover:bg-surface/60 [&>td]:border-t [&>td]:border-line";
/** Değer hücrelerinin ortak dolgusu (paylaşılan TD'nin 12px'i bu sık ızgarada fazla) */
const CELL = "px-1.5 py-1";

function EditableCell({
  value,
  computed,
  overridden,
  kind,
  format,
  label,
  col,
  onSave,
}: {
  value: number | null;
  computed: number | null;
  overridden: boolean;
  kind: string;
  format?: string;
  /** Ekran okuyucu için "Satır · Ay" */
  label: string;
  /** Sütun (ay): Enter'dan sonra odak aynı sütunda alttaki hücreye geçer */
  col: string;
  onSave: (v: number | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  /** Düzenlemeye başlarken gösterilen metin: değişmeden çıkılırsa kaydedilmez (2 ondalığa yuvarlanmış değer üzerine yazılmasın) */
  const startText = useRef("");
  /** Esc ile vazgeçildi: ardından gelebilecek blur kaydetmesin */
  const cancelled = useRef(false);
  /** Klavyeyle bitince odak nereye: Esc hücrenin kendisine, Enter (Excel'deki gibi) alttaki hücreye */
  const refocus = useRef<"self" | "next" | null>(null);
  const negative = value !== null && value < 0;
  const invalid = text.trim() !== "" && parseNumberTR(text.trim()) === null;

  /** Düzenlemeyi başlatır; `typed` verilirse (hücre seçiliyken rakama basıldı) kutu o karakterle açılır */
  function begin(typed?: string) {
    const initial = value === null ? "" : format === "days" ? String(value) : num(value, 2);
    startText.current = initial;
    cancelled.current = false;
    refocus.current = null;
    setText(typed ?? initial);
    setEditing(true);
  }

  if (editing) {
    return (
      <input
        autoFocus
        inputMode="decimal"
        autoComplete="off"
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onBlur={async () => {
          if (cancelled.current) return;
          const t = text.trim();
          const v = t === "" ? null : parseNumberTR(t);
          if (t !== "" && v === null) {
            toast.error("Geçerli bir sayı girin");
            setEditing(false);
            return;
          }
          if (t === startText.current.trim() || v === value || (v === null && !overridden && kind !== "manual")) {
            setEditing(false);
            return;
          }
          setBusy(true);
          try {
            await onSave(v);
          } finally {
            setBusy(false);
            setEditing(false);
          }
        }}
        onFocus={(e) => {
          // Değerle açıldıysa tümü seçili (yazınca yerine geçer); rakamla açıldıysa imleç sona
          const el = e.currentTarget;
          if (text === startText.current) el.select();
          else el.setSelectionRange(el.value.length, el.value.length);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            refocus.current = "next";
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            // Açık bir pencere yokken Esc yalnızca bu hücreden vazgeçer
            e.preventDefault();
            cancelled.current = true;
            refocus.current = "self";
            setEditing(false);
          }
        }}
        className={cn(
          // Form kontrolleriyle aynı dil: beyaz, ince halka, odakta mürekkep halkası; telefonda 16px (iOS yakınlaştırmasın)
          "h-8 w-full rounded-lg border-0 bg-surface px-2 text-right text-base tabular ring-2 ring-ink/20 outline-none pointer-coarse:h-10 sm:text-sm",
          CELL_MIN,
          "aria-invalid:bg-bad-soft aria-invalid:text-bad aria-invalid:ring-bad/50 disabled:opacity-60",
          // .cell-input katmansız: geçersizken kırmızı metnin önüne geçmesin
          !invalid && "cell-input",
        )}
      />
    );
  }
  return (
    <button
      type="button"
      data-pnl-col={col}
      ref={(el) => {
        if (!el || !refocus.current) return;
        const where = refocus.current;
        refocus.current = null;
        if (where === "next") {
          // Aynı aydaki bir sonraki girilebilir hücre (sayfadaki sırayla); yoksa bu hücrede kalır
          const list = [...document.querySelectorAll<HTMLButtonElement>(`button[data-pnl-col="${col}"]`)];
          const next = list[list.indexOf(el) + 1];
          (next ?? el).focus();
          next?.scrollIntoView({ block: "nearest", inline: "nearest" });
        } else el.focus();
      }}
      onClick={() => begin()}
      onKeyDown={(e) => {
        // Excel gibi: hücre seçiliyken rakam yazmak düzenlemeyi o rakamla başlatır
        if (!e.metaKey && !e.ctrlKey && !e.altKey && /^[\d,.-]$/.test(e.key)) {
          e.preventDefault();
          begin(e.key);
        }
      }}
      title={overridden && computed !== null ? `Elle girildi. Hesaplanan: ${fmt(computed, format)}` : "Değer girmek için tıklayın ya da rakam yazın"}
      aria-label={`${label}: ${fmt(value, format)}. Değiştirmek için tıklayın`}
      className={cn(
        "relative flex h-8 w-full cursor-text items-center justify-end rounded-lg bg-surface/80 px-2 tabular ring-1 ring-line ring-inset transition-[background-color,box-shadow] pointer-coarse:h-10",
        CELL_MIN,
        "hover:bg-surface hover:ring-line-strong focus-visible:ring-2 focus-visible:ring-ink/25",
        // .cell-input katmansız bir kural olduğu için negatifte kırmızının önüne geçmesin
        (overridden || kind === "manual") && !negative && "cell-input",
        overridden && kind === "auto" && "bg-info-soft font-medium hover:bg-info-soft",
        negative && "text-bad",
        value === null && "text-ink-quiet",
      )}
    >
      {fmt(value, format)}
      {overridden && kind === "auto" ? <span className="absolute top-1 right-1 size-1.5 rounded-full bg-info" aria-hidden="true" /> : null}
    </button>
  );
}

/** Gösterilen aylar: verisi olan aylar, yılın tamamı ya da yalnızca son ay (telefonda tek ay + yıl toplamı) */
type MonthView = "aktif" | "12" | "son";
type Flag = "" | "1";
type GridRow = GridSection["rows"][number];

const FILTER_KEYS = ["ara", "bolum", "girilebilir", "yazilan", "dolu"];
const OPEN_DAYS_LABEL = "Açık gün sayısı";

export function PnlGrid({
  year,
  months,
  activeMonths,
  sections,
  openDays,
  strip,
  latestMonth,
}: {
  year: number;
  months: string[];
  activeMonths: string[];
  sections: GridSection[];
  openDays: (number | null)[];
  strip: StripMonth[];
  /** Verisi olan son ay: şeritte çerçevelenir */
  latestMonth?: string;
}) {
  const reduce = useCalmMotion();
  const [view, setView] = useQueryState<MonthView>("aylar", activeMonths.length ? "aktif" : "12");
  const [q, setQ] = useQueryText("ara");
  const [bolum, setBolum] = useQueryState<string>("bolum", "tumu");
  const [onlyEditable, setOnlyEditable] = useQueryState<Flag>("girilebilir", "");
  const [onlyOverridden, setOnlyOverridden] = useQueryState<Flag>("yazilan", "");
  const [hideEmpty, setHideEmpty] = useQueryState<Flag>("dolu", "");

  const visibleIdx = months
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => {
      if (view === "son" && latestMonth) return m === latestMonth;
      if (view === "aktif" && activeMonths.length) return activeMonths.includes(m);
      return true;
    });
  const profitable = strip.filter((s) => s.tone === "good").length;
  const losing = strip.filter((s) => s.tone === "bad").length;
  const latestIdx = latestMonth ? months.indexOf(latestMonth) : -1;

  // Satır süzgeçleri yalnızca görünen aylara bakar ("boş" = görünen aylarda değer yok)
  const isOverridden = (r: GridRow) => r.def.kind === "auto" && visibleIdx.some(({ i }) => r.cells[i].overridden);
  const isEmpty = (r: GridRow) => visibleIdx.every(({ i }) => !r.cells[i].value);
  const rowMatches = (sec: GridSection, r: GridRow) =>
    (bolum === "tumu" || sec.key === bolum) &&
    matches(`${r.def.label} ${sec.label}`, q) &&
    (!onlyEditable || r.def.editable) &&
    (!onlyOverridden || isOverridden(r)) &&
    (!hideEmpty || !isEmpty(r));
  const shownSections = sections.map((sec) => ({ ...sec, rows: sec.rows.filter((r) => rowMatches(sec, r)) })).filter((sec) => sec.rows.length > 0);
  // Açık gün satırı bölümsüz, her zaman girilebilir; "üzerine yazılan" süzgecinde yer almaz
  const showOpenDays =
    bolum === "tumu" &&
    matches(OPEN_DAYS_LABEL, q) &&
    !onlyOverridden &&
    (!hideEmpty || visibleIdx.some(({ i }) => openDays[i] !== null && openDays[i] !== 0));

  const allRows = sections.flatMap((s) => s.rows);
  const totalRows = allRows.length + 1;
  const shownRows = shownSections.reduce((a, s) => a + s.rows.length, 0) + (showOpenDays ? 1 : 0);
  const overriddenCount = allRows.filter(isOverridden).length;
  const editableCount = allRows.filter((r) => r.def.editable).length + 1;
  const filtered = q.trim() !== "" || bolum !== "tumu" || onlyEditable === "1" || onlyOverridden === "1" || hideEmpty === "1";
  const clearFilters = () => {
    setQ("");
    clearQuery(FILTER_KEYS);
  };

  async function save(month: string, key: string, v: number | null) {
    const res =
      key === "revenue"
        ? await setMonthField(month, "posRevenue", v)
        : key === "openDays"
          ? await setMonthField(month, "openDays", v)
          : await setPnlCell(month, key, v);
    if (!res.ok) toast.error(res.error);
  }

  return (
    <Card>
      <CardHeader
        icon={<CalendarRange />}
        title={`${year} gelir-gider tablosu`}
        description="KDV hariç. Hücreye tıklayın ya da seçip rakam yazın; Enter kaydedip alttaki hücreye geçer, Esc vazgeçer."
        actions={
          <Segmented<MonthView>
            label="Gösterilen aylar"
            value={view === "aktif" && !activeMonths.length ? "12" : view}
            onChange={setView}
            options={[
              ...(activeMonths.length ? [{ value: "aktif" as const, label: "Aktif aylar", count: activeMonths.length }] : []),
              { value: "12", label: "12 ay" },
              ...(latestIdx >= 0 ? [{ value: "son" as const, label: `Son ay · ${MONTH_NAMES[latestIdx]}` }] : []),
            ]}
          />
        }
      />

      <CardContent className="pb-4">
        <Well className="p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
            <p className="text-[13px] font-medium text-ink">
              Aylara göre kâr / zarar
              <span className="ml-2 font-normal text-ink-mute tabular">
                <AnimatedNumber value={profitable} format={(v) => num(v)} /> kârlı · <AnimatedNumber value={losing} format={(v) => num(v)} /> zararlı ay
              </span>
            </p>
            <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-mute">
              <LegendItem tone="good">Kâr</LegendItem>
              <LegendItem tone="bad">Zarar</LegendItem>
              <LegendItem tone="warn">Ciro girilmedi</LegendItem>
              <LegendItem tone="empty">Veri yok</LegendItem>
            </ul>
          </div>
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: EASE_OUT }}
          >
            {/* Şerit beyaz kuyuda: son ayın çerçeve boşluğu da beyaz olsun (bileşen panel zeminine göre çizer) */}
            <SegmentStrip segments={strip} activeKey={latestMonth} showLabels className="[&_li]:ring-offset-surface" />
          </motion.div>
        </Well>
      </CardContent>

      <div className="space-y-3 px-5 pb-3">
        <FilterBar active={filtered} onClear={clearFilters} shown={shownRows} total={totalRows} unit="kalem">
          <SearchField value={q} onChange={setQ} placeholder="Kalem ara" label="Kalem ara (tedarikçi, gider adı)" className="w-full sm:w-64" />
          <Select value={bolum} onChange={(e) => setBolum(e.target.value)} aria-label="Bölüm" className="w-auto max-sm:flex-1 pointer-coarse:h-10">
            <option value="tumu">Tüm bölümler</option>
            {sections.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label} ({s.rows.length})
              </option>
            ))}
          </Select>
          <FilterChip active={onlyEditable === "1"} onToggle={() => setOnlyEditable(onlyEditable ? "" : "1")} count={editableCount}>
            Girilebilir
          </FilterChip>
          <FilterChip active={onlyOverridden === "1"} onToggle={() => setOnlyOverridden(onlyOverridden ? "" : "1")} count={overriddenCount}>
            Üzerine yazılan
          </FilterChip>
          <FilterChip active={hideEmpty === "1"} onToggle={() => setHideEmpty(hideEmpty ? "" : "1")}>
            Boşları gizle
          </FilterChip>
        </FilterBar>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-ink-mute">
          <span className="flex items-center gap-1.5">
            <span className="cell-input inline-flex h-6 items-center rounded-md bg-surface px-1.5 font-semibold tabular ring-1 ring-line ring-inset">123</span>
            elle girilen / girilebilen
          </span>
          <span className="flex items-center gap-1.5">
            <span className="relative inline-flex h-6 w-9 items-center rounded-md bg-info-soft ring-1 ring-line ring-inset">
              <span className="absolute top-1 right-1 size-1.5 rounded-full bg-info" />
            </span>
            hesaplananın üzerine yazılmış
            <InfoTip text="İçini silip Enter'a basınca hücre hesaplanan değere döner." />
          </span>
        </div>
      </div>

      {shownRows === 0 ? (
        <EmptyState
          title="Bu süzgece uyan kalem yok"
          description="Aramayı kısaltın ya da seçili bölümü ve süzgeçleri kaldırın."
          action={
            <Button size="sm" variant="secondary" onClick={clearFilters}>
              Süzgeci temizle
            </Button>
          }
        />
      ) : (
        // Tablo kendi içinde kayar: başlık satırı ve kalem sütunu kaydırırken yerinde kalır. `isolate`: sabit
        // hücrelerin z sırası tablonun içinde kalır, telefondaki üst çubuğun (z-30) üzerine çıkmaz.
        <TableWrap className="isolate max-h-[calc(100dvh-7rem)] overflow-y-auto px-0 pb-0">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <TH sticky className={cn(STICKY, "top-0 z-30")}>
                  Kalem
                </TH>
                {visibleIdx.map(({ m, i }) => (
                  <TH key={m} numeric className={cn(HEAD, "min-w-24 px-1.5 sm:min-w-28")}>
                    <span className="px-2">{MONTH_NAMES[i]}</span>
                  </TH>
                ))}
                <TH numeric className={cn(YEAR_COL, HEAD_YEAR, "min-w-28 text-ink sm:min-w-32")}>
                  {year} yılı
                </TH>
              </tr>
            </thead>
            <tbody>
              {showOpenDays ? (
                <tr className={cn(ROW, "[&>td]:border-t-0")}>
                  <TD sticky className={cn(STICKY, "py-1.5 font-medium")}>
                    <span className="flex items-center gap-1.5">
                      {OPEN_DAYS_LABEL}
                      <InfoTip text="O ay işletmenin açık olduğu gün. Kira, personel, reklam gibi aylık giderler gün ÷ ayın gün sayısı oranıyla hesaplanır." />
                    </span>
                  </TD>
                  {visibleIdx.map(({ m, i }) => (
                    <td key={m} className={CELL}>
                      <EditableCell
                        value={openDays[i]}
                        computed={null}
                        overridden={openDays[i] !== null}
                        kind="manual"
                        format="days"
                        label={`${OPEN_DAYS_LABEL} · ${MONTH_NAMES[i]}`}
                        col={m}
                        onSave={(v) => save(m, "openDays", v)}
                      />
                    </td>
                  ))}
                  <td className={cn(YEAR_COL, "font-semibold text-ink")}>{num(openDays.reduce<number>((a, v) => a + (v ?? 0), 0))} gün</td>
                </tr>
              ) : null}
              {shownSections.map((sec) => (
                <SectionRows key={sec.key} sec={sec} visibleIdx={visibleIdx} onSave={save} />
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      <CardFooter className="justify-start gap-2">
        <RotateCcw size={14} className="shrink-0 text-ink-quiet" aria-hidden="true" />
        <span>
          Bir hücreyi hesaplanan değere döndürmek için içini silip Enter&apos;a basın. Faturadan gelen mal alışlarını değiştirmek için{" "}
          <Link href="/panel/faturalar" className="font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink">
            Faturalar
          </Link>{" "}
          sayfasını kullanın.
        </span>
      </CardFooter>
    </Card>
  );
}

/**
 * Şerit açıklaması. Örnek kare, şeridin kendisiyle (SegmentStrip) çizilir:
 * renkler paylaşılan bileşende tanımlı, burada tekrar yazılmaz.
 */
function LegendItem({ tone, children }: { tone: StripMonth["tone"]; children: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <div aria-hidden="true" className="flex">
        <SegmentStrip segments={[{ key: tone, tone, label: children }]} className="w-2.5 [&_ul]:h-2.5" />
      </div>
      {children}
    </li>
  );
}

function SectionRows({
  sec,
  visibleIdx,
  onSave,
}: {
  sec: GridSection;
  visibleIdx: { m: string; i: number }[];
  onSave: (month: string, key: string, v: number | null) => Promise<void>;
}) {
  return (
    <>
      <tr>
        <TD sticky className={cn(STICKY, "pt-6 pb-2 text-[13px] font-semibold text-ink-soft")}>
          {sec.label}
        </TD>
        <td colSpan={visibleIdx.length} className="pt-6 pb-2" />
        {/* Yıl sütununun gri şeridi bölüm başlığında da kesilmesin */}
        <td className={cn(YEAR_COL, "pt-6 pb-2")} />
      </tr>
      {sec.rows.map(({ def, cells, total }) => {
        const isProfit = def.key === "profit" || def.key === "ratio:profit";
        const tone = (v: number | null) => (v !== null && v < 0 ? "text-bad" : isProfit && v !== null && v > 0 ? "text-good" : null);
        return (
          <tr key={`${sec.key}-${def.key}`} className={cn(ROW, def.strong && "font-semibold [&>td]:border-line-strong")}>
            <TD sticky className={cn(STICKY, "py-1.5", def.strong ? "text-ink" : "text-ink-soft")}>
              <span className="flex items-center gap-1.5">
                <span className="min-w-0">{def.label}</span>
                {def.hint ? <InfoTip text={def.hint} className="shrink-0" /> : null}
              </span>
            </TD>
            {visibleIdx.map(({ m, i }) => {
              const c = cells[i];
              return (
                <td key={m} className={cn(CELL, "text-right")}>
                  {def.editable ? (
                    <EditableCell
                      value={c.value}
                      computed={c.computed}
                      overridden={c.overridden}
                      kind={def.kind}
                      format={def.format}
                      label={`${def.label} · ${MONTH_NAMES[i]}`}
                      col={m}
                      onSave={(v) => onSave(m, def.key, v)}
                    />
                  ) : (
                    <span
                      className={cn(
                        "block px-2 py-1 whitespace-nowrap tabular",
                        def.strong ? "text-ink" : "text-ink-mute",
                        tone(c.value),
                        c.value === null && "text-ink-quiet",
                      )}
                    >
                      {fmt(c.value, def.format)}
                    </span>
                  )}
                </td>
              );
            })}
            <td className={cn(YEAR_COL, def.strong ? "font-semibold text-ink" : "text-ink-soft", tone(total))}>{fmt(total, def.format)}</td>
          </tr>
        );
      })}
    </>
  );
}
