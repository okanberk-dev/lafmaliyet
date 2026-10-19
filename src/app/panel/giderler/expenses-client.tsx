"use client";

import { ArrowUpRight, House, Pencil, PiggyBank, Plus, SearchX, Store, Target, Trash2, Users, Wallet, Zap } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useId, useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { SERIES } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton, IconLink } from "@/components/ui/button";
import { Card, CardHeader, Well } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { clearQuery, FilterBar, matches, releaseScroll, SearchField, useQueryState, useQueryText } from "@/components/ui/filters";
import { Checkbox, Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { SortButton, Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import { parseNumberTR } from "@/lib/calc/expr";
import type { FixedExpense, FixedPeriod, FixedSection } from "@/lib/calc/types";
import { FIXED_PERIODS, FIXED_SECTIONS } from "@/lib/constants";
import { monthLabel, num, pct, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deleteFixedExpense, deleteInvestment, saveFixedExpense, saveInvestment } from "@/server/actions/costs";

const PERIOD_LABEL = Object.fromEntries(FIXED_PERIODS.map((p) => [p.key, p.label])) as Record<FixedPeriod, string>;

const SECTION_ICON: Record<FixedSection, ReactNode> = {
  personel: <Users />,
  faturalar: <Zap />,
  kira: <House />,
  genel: <Store />,
};

/** Süzgeçteki kısa bölüm adları (tam adlar tabloda) */
const SECTION_SHORT: Record<FixedSection, string> = {
  personel: "Personel",
  faturalar: "Faturalar",
  kira: "Kira",
  genel: "Genel",
};

/** Dağılım çubuğunda ve tablodaki bölüm başlıklarında aynı renk: mürekkep, mavi, turuncu, gri */
const SECTION_COLOR: Record<FixedSection, string> = {
  personel: "var(--foreground)",
  faturalar: SERIES[0],
  kira: SERIES[1],
  genel: "var(--chart-muted)",
};

function periodRule(period: FixedPeriod, acikGun: number) {
  return period === "gunluk" ? `× ${acikGun} gün` : period === "haftalik" ? "× 52 ÷ 12" : period === "yillik" ? "÷ 12" : "";
}

function monthlyOf(amount: number, period: FixedPeriod, acikGun: number) {
  return period === "gunluk" ? amount * acikGun : period === "haftalik" ? (amount * 52) / 12 : period === "yillik" ? amount / 12 : amount;
}

/** Küçük tutarlarda kuruş da görünsün (50,00 ₺ yıllık → 4,17 ₺ aylık) */
const money = (v: number) => tl(v, Math.abs(v) < 100 ? 2 : 0);

/**
 * Sıralama adreste "ad", "-ad" (azalan) gibi tutulur. Başlığa tıklamak sırayla artan → azalan → kayıt sırası
 * arasında döner; tutar sütunlarında önce büyükten küçüğe.
 */
function nextSort(current: string, key: string, firstDesc = false): string {
  const order = firstDesc ? [`-${key}`, key, ""] : [key, `-${key}`, ""];
  const i = order.indexOf(current);
  return i === -1 ? order[0] : order[(i + 1) % order.length];
}

function sortDir(current: string, key: string): "asc" | "desc" | null {
  return current === key ? "asc" : current === `-${key}` ? "desc" : null;
}

function sortRows<T>(list: T[], sort: string, keys: Record<string, (x: T) => string | number>): T[] {
  const desc = sort.startsWith("-");
  const get = keys[desc ? sort.slice(1) : sort];
  if (!get) return list;
  return [...list].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    const c = typeof x === "string" && typeof y === "string" ? x.localeCompare(y, "tr-TR") : Number(x) - Number(y);
    return desc ? -c : c;
  });
}

/** Telefonda satır eylemleri ve anahtarlar en az 40px dokunma alanı */
const TOUCH = "pointer-coarse:size-10";
/** Pencere düğmeleri için aynısı (yükseklik) */
const TOUCH_BTN = "pointer-coarse:h-10";

/** Az önce eklenen / düzenlenen satırın kısa süreli vurgusu (TR'nin renk geçişiyle söner) */
const FLASH = "bg-lime/20 hover:bg-lime/25";

/** Vurgulanan satırı görünür alana getirir; telefonda gizli tablo satırı (display: none) yerinde kalır */
function revealRow(el: HTMLElement | null) {
  if (!el || el.offsetParent === null) return;
  // Süzgeç adresteyken eylem sonrası kaydırma koruması bu bilinçli kaydırmayı geri almasın
  releaseScroll();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
}

/** Kaydedilen satırın kimliği: 3 sn vurgulanır, sonra kendiliğinden söner */
function useFlash(): [number | null, (id: number) => void] {
  const [flash, setFlash] = useState<number | null>(null);
  useEffect(() => {
    if (flash === null) return;
    const t = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(t);
  }, [flash]);
  return [flash, setFlash];
}

// ============================================================================ Ortak parçalar (Personel de kullanır)

/** Açılışta sıfırdan sayan tutar (AkmanOS AnimatedNumber); ekran okuyucu son değeri okur */
export function CountUp({ value, digits = 0 }: { value: number; digits?: number }) {
  return (
    <>
      <span aria-hidden="true">
        <AnimatedNumber value={value} format={(v) => tl(v, digits)} />
      </span>
      <span className="sr-only">{tl(value, digits)}</span>
    </>
  );
}

/** Kart başlığındaki kenarlıklı beyaz ikon kutusu (CardHeader ile aynı), büyük rakamlı özet kartlarında */
export function HeadIcon({ children }: { children: ReactNode }) {
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink [&>svg]:size-[18px] [&>svg]:stroke-[1.75]"
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

export type ShareSegment = { key: string; label: string; value: number; color: string; note?: ReactNode };

/**
 * AkmanOS agent-limits-card dili: tek yuvarlak çubukta renkli parçalar + tutar ve yüzdeli lejant.
 * Parçalar açılışta sırayla yayla dolar; lejantın üzerine gelince ilgili parça öne çıkar.
 */
export function ShareBreakdown({
  segments,
  total,
  className,
  legendClassName,
}: {
  segments: ShareSegment[];
  /** Yüzdelerin paydası; verilmezse parçaların toplamı */
  total?: number;
  className?: string;
  legendClassName?: string;
}) {
  const reduce = useCalmMotion();
  const [focus, setFocus] = useState<string | null>(null);
  const sum = total ?? segments.reduce((a, s) => a + s.value, 0);
  // Geçersiz oranlarda (ör. işçi kesintisi %100) tutarlar sonsuz/negatif olabilir; çubuk o zaman boş kalır
  const valid = Number.isFinite(sum) && sum > 0;
  const filled = segments.filter((s) => Number.isFinite(s.value) && s.value > 0);

  return (
    <div className={className}>
      <div className="flex h-2.5 w-full gap-1" aria-hidden="true">
        {filled.length > 0 && valid ? (
          filled.map((s, i) => (
            <motion.span
              key={s.key}
              title={`${s.label}: ${tl(s.value)} (${pct(s.value / sum, 0)})`}
              onMouseEnter={() => setFocus(s.key)}
              onMouseLeave={() => setFocus(null)}
              className={cn("h-full min-w-1.5 basis-0 rounded-full transition-opacity duration-200", focus && focus !== s.key && "opacity-25")}
              style={{ backgroundColor: s.color, originX: 0 }}
              initial={reduce ? false : { scaleX: 0, flexGrow: s.value }}
              animate={{ scaleX: 1, flexGrow: s.value }}
              transition={reduce ? { duration: 0 } : { ...SPRING_SWAP, delay: 0.12 + i * 0.06 }}
            />
          ))
        ) : (
          <span className="h-full w-full rounded-full bg-panel-deep" />
        )}
      </div>

      <ul className={cn("mt-4 grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-4", legendClassName)}>
        {segments.map((s, i) => (
          <motion.li
            key={s.key}
            onMouseEnter={() => setFocus(s.key)}
            onMouseLeave={() => setFocus(null)}
            className={cn("min-w-0 transition-opacity duration-200", focus && focus !== s.key && "opacity-50")}
            initial={reduce ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.3, ease: EASE_OUT, delay: 0.18 + i * 0.04 }}
          >
            <div className="flex items-start gap-2 text-[13px] leading-5 text-ink-mute">
              <span className="mt-[5px] size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: s.color }} aria-hidden="true" />
              <span className="min-w-0">{s.label}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 pl-[18px]">
              <span className="text-base font-semibold text-ink tabular">{tl(s.value)}</span>
              <span className="text-xs font-medium text-ink-mute tabular">{valid ? pct(s.value / sum, 0) : "–"}</span>
            </div>
            {s.note ? <div className="pl-[18px] text-xs leading-5 text-ink-mute">{s.note}</div> : null}
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================================ Özet ve dağılım

export type SectionTotal = { key: FixedSection; label: string; total: number };

export function FixedSummary({
  total,
  acikGun,
  sections,
  personnelCount,
  breakEvenDaily,
  breakEvenRef,
}: {
  total: number;
  acikGun: number;
  sections: SectionTotal[];
  personnelCount: number;
  breakEvenDaily: number | null;
  /** Başabaş hesabında kullanılan satış ayı, ör. "Eylül 2026" */
  breakEvenRef: string | null;
}) {
  return (
    <Card className="mb-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <HeadIcon>
              <Wallet />
            </HeadIcon>
            <h2 className="text-base font-semibold tracking-tight text-ink">Aylık sabit gider</h2>
          </div>
          <p className="mt-4 text-3xl font-semibold tracking-tight text-ink tabular sm:text-4xl">
            <CountUp value={total} />
          </p>
          <p className="mt-1 text-[13px] text-ink-mute">{acikGun} açık gün varsayımıyla · KDV hariç</p>
        </div>

        {breakEvenDaily ? (
          <Well className="flex w-full items-start gap-3 p-3.5 sm:w-auto sm:max-w-sm">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info" aria-hidden="true">
              <Target size={16} />
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[13px] text-ink-mute">
                Başabaş için günlük ciro
                <InfoTip text="Bu giderleri karşılamak için günde ortalama gereken ciro (KDV dahil)." />
              </p>
              <p className="text-lg font-semibold text-ink tabular">{tl(breakEvenDaily)}</p>
              <p className="text-xs leading-5 text-ink-mute">KDV dahil{breakEvenRef ? ` · ${breakEvenRef} brüt kâr oranıyla` : null}</p>
            </div>
          </Well>
        ) : null}
      </div>

      <ShareBreakdown
        className="mt-6"
        total={total}
        segments={sections.map((s) => ({
          key: s.key,
          label: s.label,
          value: s.total,
          color: SECTION_COLOR[s.key],
          note: s.key === "personel" ? `${personnelCount} kişi, maaş + SGK` : undefined,
        }))}
      />
    </Card>
  );
}


// ============================================================================ Sabit giderler

type FixedRow = FixedExpense & { monthly: number };
type Bolum = "tumu" | FixedSection;
type Durum = "tumu" | "aktif" | "pasif";

/** "Temizle" ile sıfırlanan süzgeçler (sıralama korunur) */
const FIXED_FILTERS = ["ara", "bolum", "durum"];

export function FixedExpensesClient({
  rows: serverRows,
  personnel,
  acikGun,
}: {
  rows: FixedRow[];
  personnel: { total: number; count: number };
  acikGun: number;
}) {
  const [editing, setEditing] = useState<FixedRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<FixedRow | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  // Aktif/pasif anahtarı hemen döner; sunucunun yenilediği liste gelince onun yerine geçer, hata olursa geri döner
  const [, startToggle] = useTransition();
  const [rows, setOptimisticActive] = useOptimistic(serverRows, (state, p: { id: number; active: boolean }) =>
    state.map((r) => (r.id === p.id ? { ...r, active: p.active } : r)),
  );
  // Aynı satıra art arda basılınca istekler yarışmasın
  const busy = useRef(new Set<number>());
  const [flash, setFlash] = useFlash();

  const [q, setQ] = useQueryText("ara");
  const [bolum, setBolum] = useQueryState<Bolum>("bolum", "tumu");
  const [durum, setDurum] = useQueryState<Durum>("durum", "tumu");
  const [sira, setSira] = useQueryState<string>("sirala", "");
  const filtered = q.trim() !== "" || bolum !== "tumu" || durum !== "tumu";
  const clearFilters = () => {
    setQ("");
    clearQuery(FIXED_FILTERS);
  };

  // Personel satırı Personel sayfasından gelir: her zaman aktif, düzenlenemez, yine de aranır ve süzülür
  const personnelLabel = `Personel (${personnel.count} kişi, maaş + SGK)`;
  const showPersonnel = (bolum === "tumu" || bolum === "personel") && durum !== "pasif" && matches(`${personnelLabel} SGK otomatik`, q);
  const visible = sortRows(
    rows.filter(
      (r) =>
        (bolum === "tumu" || r.section === bolum) &&
        (durum === "tumu" || r.active === (durum === "aktif")) &&
        matches(`${r.name} ${r.note ?? ""} ${PERIOD_LABEL[r.period]}`, q),
    ),
    sira,
    { ad: (r) => r.name, tutar: (r) => r.amount, aylik: (r) => r.monthly },
  );
  const groups = FIXED_SECTIONS.filter((sec) => bolum === "tumu" || sec.key === bolum)
    .map((sec) => {
      const list = visible.filter((r) => r.section === sec.key);
      const withPersonnel = sec.key === "personel" && showPersonnel;
      // Bölüm toplamı görünen aktif kalemlerden: süzgeç ve anahtar değişince hemen güncellenir
      const subtotal = list.filter((r) => r.active).reduce((a, r) => a + r.monthly, 0) + (withPersonnel ? personnel.total : 0);
      return { ...sec, rows: list, withPersonnel, subtotal };
    })
    .filter((g) => g.rows.length > 0 || g.withPersonnel);

  const shownTotal = groups.reduce((a, g) => a + g.subtotal, 0);
  const shownCount = visible.length + (showPersonnel ? 1 : 0);
  const activeCount = rows.filter((r) => r.active).length + 1;
  const inactiveCount = rows.length + 1 - activeCount;
  const shownInactive = visible.some((r) => !r.active);
  const sectionCount = (key: FixedSection) => rows.filter((r) => r.section === key).length + (key === "personel" ? 1 : 0);
  const totalLabel = filtered ? "Gösterilen kalemlerin toplamı" : "Toplam";

  function toggleActive(r: FixedRow) {
    if (busy.current.has(r.id)) return;
    busy.current.add(r.id);
    const next = !r.active;
    startToggle(async () => {
      setOptimisticActive({ id: r.id, active: next });
      const res = await saveFixedExpense({ id: r.id, name: r.name, section: r.section, period: r.period, amount: r.amount, note: r.note, active: next });
      busy.current.delete(r.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(next ? `${r.name} aktifleştirildi` : `${r.name} pasife alındı`, {
        description: next ? `Aylık toplama ${money(r.monthly)} eklendi.` : "Aylık toplama ve gelir-gider tablosuna girmez.",
      });
    });
  }

  /** Kayıttan sonra satır vurgulanır; yeni kalem süzgece takılacaksa süzgeç kaldırılır (eklenen hemen görünsün) */
  function onSaved(id: number, isNew: boolean) {
    if (isNew && filtered) clearFilters();
    setFlash(id);
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeletePending(true);
    const res = await deleteFixedExpense(deleting.id);
    setDeletePending(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`${deleting.name} silindi`);
    setDeleting(null);
    setEditing(null);
  }

  const sortHead = (key: string, label: ReactNode, numeric?: boolean) => (
    <SortButton dir={sortDir(sira, key)} numeric={numeric} onClick={() => setSira(nextSort(sira, key, numeric))}>
      {label}
    </SortButton>
  );

  const addButton = (
    <Button size="sm" onClick={() => setEditing("new")} className={TOUCH_BTN}>
      <Plus size={16} /> Gider ekle
    </Button>
  );

  return (
    <Card>
      <CardHeader
        icon={<Wallet />}
        title="Aylık sabit giderler"
        description="Satıra tıklayınca düzenlenir. Pasif kalemler toplama girmez."
        meta={
          <>
            <span>Aktif · {activeCount}</span>
            {inactiveCount ? <span className="text-ink-quiet">· Pasif · {inactiveCount}</span> : null}
          </>
        }
        actions={addButton}
      />

      <div className="px-5 pb-3">
        <FilterBar active={filtered} onClear={clearFilters} shown={shownCount} total={rows.length + 1} unit="kalem">
          <SearchField value={q} onChange={setQ} placeholder="Gider ara" label="Gider ara (ad ya da not)" className="w-full sm:w-56" />
          {/* Beş seçenek telefona sığmaz: orada aynı süzgeç açılır liste olarak */}
          <Segmented<Bolum>
            label="Bölüm"
            value={bolum}
            onChange={setBolum}
            className="max-sm:hidden"
            options={[{ value: "tumu", label: "Tümü" }, ...FIXED_SECTIONS.map((s) => ({ value: s.key, label: SECTION_SHORT[s.key], count: sectionCount(s.key) }))]}
          />
          <Select value={bolum} onChange={(e) => setBolum(e.target.value as Bolum)} aria-label="Bölüm" className="w-auto flex-1 sm:hidden pointer-coarse:h-10">
            <option value="tumu">Tüm bölümler</option>
            {FIXED_SECTIONS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label} ({sectionCount(s.key)})
              </option>
            ))}
          </Select>
          <Segmented<Durum>
            label="Durum"
            value={durum}
            onChange={setDurum}
            options={[
              { value: "tumu", label: "Tümü" },
              { value: "aktif", label: "Aktif", count: activeCount },
              { value: "pasif", label: "Pasif", count: inactiveCount },
            ]}
          />
        </FilterBar>
      </div>

      {shownCount === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title="Bu süzgece uyan gider yok"
          description="Aramayı kısaltın ya da bölüm ve durum seçimini kaldırın. Aradığınız kalem yoksa yeni gider olarak ekleyin."
          action={
            <>
              <Button size="sm" variant="secondary" onClick={clearFilters} className={TOUCH_BTN}>
                Süzgeci temizle
              </Button>
              {addButton}
            </>
          }
        />
      ) : (
        <>
          {/* Masaüstü / tablet: tablo */}
          <TableWrap className="max-sm:hidden">
            <Table>
              <THead>
                <tr>
                  <TH>{sortHead("ad", "Gider kalemi")}</TH>
                  <TH numeric>{sortHead("tutar", "Tutar", true)}</TH>
                  <TH>Dönem</TH>
                  <TH numeric>{sortHead("aylik", "Aylık karşılığı", true)}</TH>
                  <TH>Kaynak / not</TH>
                  <TH>
                    <span className="inline-flex items-center gap-1">
                      Durum <InfoTip text="Pasif kalemler aylık toplama ve gelir-gider tablosuna girmez. Silmeden durdurmak için kullanın." />
                    </span>
                  </TH>
                  <TH>
                    <span className="sr-only">Eylemler</span>
                  </TH>
                </tr>
              </THead>
              {groups.map((g, gi) => {
                const pad = gi === 0 ? "pt-3" : "pt-6";
                return (
                  <tbody key={g.key}>
                    <tr className="border-b border-line">
                      <th scope="rowgroup" colSpan={3} className={cn("px-3 pb-2 text-left font-normal", pad)}>
                        <SectionLabel section={g.key} label={g.label} count={g.rows.length + (g.withPersonnel ? 1 : 0)} />
                      </th>
                      <td className={cn("px-3 pb-2 text-right text-[13px] font-semibold whitespace-nowrap text-ink tabular", pad)}>
                        <span className="sr-only">Bölüm toplamı </span>
                        {tl(g.subtotal)}
                      </td>
                      <td colSpan={3} className={pad} />
                    </tr>

                    {g.withPersonnel ? (
                      <TR>
                        <TD className="font-medium">
                          <Link href="/panel/personel" className="rounded-md hover:underline">
                            {personnelLabel}
                          </Link>
                        </TD>
                        <TD numeric className="text-ink-quiet">
                          –
                        </TD>
                        <TD className="text-[13px] whitespace-nowrap text-ink-mute">Personel sayfasından</TD>
                        <TD numeric className="font-semibold">
                          {tl(personnel.total)}
                        </TD>
                        <TD className="min-w-44 text-[13px] text-ink-mute">Toplam işveren maliyeti, otomatik</TD>
                        <TD>
                          <Badge tone="blue">Otomatik</Badge>
                        </TD>
                        <TD>
                          <div className="flex justify-end gap-1.5">
                            <IconLink href="/panel/personel" label="Personel sayfasına git">
                              <ArrowUpRight size={16} />
                            </IconLink>
                          </div>
                        </TD>
                      </TR>
                    ) : null}

                    {g.rows.map((r) => {
                      const dim = !r.active && "opacity-50";
                      const rule = periodRule(r.period, acikGun);
                      return (
                        <TR
                          key={r.id}
                          ref={r.id === flash ? revealRow : undefined}
                          className={cn("cursor-pointer", r.id === flash && FLASH)}
                          onClick={() => setEditing(r)}
                        >
                          <TD className={cn("font-medium", dim)}>{r.name}</TD>
                          <TD numeric className={cn(dim)}>
                            {money(r.amount)}
                          </TD>
                          <TD className={cn("whitespace-nowrap", dim)}>
                            <span className="inline-flex items-center gap-1.5">
                              <Badge tone="gray">{PERIOD_LABEL[r.period]}</Badge>
                              {rule ? <span className="text-xs text-ink-mute tabular">{rule}</span> : null}
                            </span>
                          </TD>
                          <TD numeric className={cn("font-semibold", dim)}>
                            {money(r.monthly)}
                          </TD>
                          <TD className={cn("max-w-80 min-w-44 text-[13px] text-ink-mute", dim)}>
                            {r.note ? (
                              <span className="line-clamp-2" title={r.note}>
                                {r.note}
                              </span>
                            ) : null}
                          </TD>
                          <TD onClick={(e) => e.stopPropagation()}>
                            <Switch checked={r.active} label={`${r.name} aktif`} onChange={() => toggleActive(r)} showText />
                          </TD>
                          <TD onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-end gap-1.5">
                              <IconButton label={`${r.name}: düzenle`} onClick={() => setEditing(r)}>
                                <Pencil size={15} />
                              </IconButton>
                              <IconButton label={`${r.name}: sil`} tone="danger" onClick={() => setDeleting(r)}>
                                <Trash2 size={15} />
                              </IconButton>
                            </div>
                          </TD>
                        </TR>
                      );
                    })}
                  </tbody>
                );
              })}
              <tfoot>
                <TFootRow>
                  <TD colSpan={3}>{totalLabel}</TD>
                  <TD numeric>{tl(shownTotal)}</TD>
                  <TD colSpan={3} className="text-[13px] font-normal text-ink-mute">
                    {shownInactive ? "Pasif kalemler dahil değil" : null}
                  </TD>
                </TFootRow>
              </tfoot>
            </Table>
          </TableWrap>

          {/* Telefon: aynı bilgiler kart listesi olarak; yatay kaydırma yok, aylık tutar her satırda görünür */}
          <div className="sm:hidden">
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label} className="border-t border-line first:border-t-0">
                <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-1.5">
                  <SectionLabel section={g.key} label={g.label} count={g.rows.length + (g.withPersonnel ? 1 : 0)} />
                  <span className="shrink-0 text-[13px] font-semibold text-ink tabular">
                    <span className="sr-only">Bölüm toplamı </span>
                    {tl(g.subtotal)}
                  </span>
                </div>
                <ul className="divide-y divide-line">
                  {g.withPersonnel ? (
                    <li>
                      <Link href="/panel/personel" className="flex min-h-14 items-center justify-between gap-3 px-5 py-3">
                        <span className="min-w-0">
                          <span className="block font-medium text-ink">{personnelLabel}</span>
                          <span className="mt-1 flex items-center gap-1.5 text-xs text-ink-mute">
                            <Badge tone="blue">Otomatik</Badge> Personel sayfasından
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="font-semibold text-ink tabular">{tl(personnel.total)}</span>
                          <ArrowUpRight size={16} className="text-ink-mute" aria-hidden="true" />
                        </span>
                      </Link>
                    </li>
                  ) : null}
                  {g.rows.map((r) => (
                    <FixedCard
                      key={r.id}
                      row={r}
                      flash={r.id === flash}
                      acikGun={acikGun}
                      onEdit={() => setEditing(r)}
                      onToggle={() => toggleActive(r)}
                      onDelete={() => setDeleting(r)}
                    />
                  ))}
                </ul>
              </section>
            ))}
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-line-strong px-5 py-3.5">
              <span className="font-semibold text-ink">{totalLabel}</span>
              <span className="font-semibold text-ink tabular">{tl(shownTotal)}</span>
              {shownInactive ? <span className="w-full text-xs text-ink-mute">Pasif kalemler dahil değil</span> : null}
            </div>
          </div>
        </>
      )}

      {editing ? (
        <FixedDialog
          row={editing === "new" ? null : editing}
          defaultSection={bolum === "tumu" ? "genel" : bolum}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
          onDelete={setDeleting}
          acikGun={acikGun}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        pending={deletePending}
        title="Gideri sil"
        confirmLabel="Gideri sil"
        description={
          deleting ? (
            <>
              <strong className="font-semibold text-ink">{deleting.name}</strong> (aylık {money(deleting.monthly)}) kalıcı olarak silinecek
              {deleting.active ? " ve gelir-gider tablosundan da kalkacak" : ""}. Bu işlem geri alınamaz.
              {deleting.active ? " Yalnızca bir süre durdurmak istiyorsanız pasife alın." : null}
            </>
          ) : null
        }
      />
    </Card>
  );
}

/** Bölüm başlığı: renkli ikon karosu + ad + kalem sayısı (tabloda ve telefon listesinde aynı) */
function SectionLabel({ section, label, count }: { section: FixedSection; label: string; count: number }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface [&>svg]:size-3.5 [&>svg]:stroke-[2]"
        style={{ color: SECTION_COLOR[section] }}
        aria-hidden="true"
      >
        {SECTION_ICON[section]}
      </span>
      <span className="truncate text-[13px] font-semibold text-ink">{label}</span>
      <span className="text-[13px] whitespace-nowrap text-ink-mute tabular">{count} kalem</span>
    </span>
  );
}

/** Telefonda bir sabit gider: ad, dönem kuralı, not; sağda aylık karşılığı; altta anahtar ve eylemler */
function FixedCard({
  row: r,
  flash,
  acikGun,
  onEdit,
  onToggle,
  onDelete,
}: {
  row: FixedRow;
  /** Az önce kaydedildi: kısa süre vurgulanır */
  flash?: boolean;
  acikGun: number;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const rule = periodRule(r.period, acikGun);
  return (
    <li ref={flash ? revealRow : undefined} className={cn("px-5 py-3 transition-colors", flash && FLASH)}>
      <button type="button" onClick={onEdit} className={cn("flex w-full cursor-pointer items-start justify-between gap-3 text-left", !r.active && "opacity-50")}>
        <span className="min-w-0">
          <span className="block font-medium break-words text-ink">{r.name}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-mute tabular">
            <Badge tone="gray">{PERIOD_LABEL[r.period]}</Badge>
            {money(r.amount)}
            {rule ? ` ${rule}` : ""}
          </span>
          {r.note ? <span className="mt-1 line-clamp-2 text-xs text-ink-mute">{r.note}</span> : null}
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-semibold text-ink tabular">{money(r.monthly)}</span>
          <span className="block text-xs text-ink-mute">aylık</span>
        </span>
      </button>
      <div className="mt-1 flex items-center justify-between gap-2">
        <Switch checked={r.active} label={`${r.name} aktif`} onChange={onToggle} showText className={TOUCH_BTN} />
        <div className="flex gap-1.5">
          <IconButton label={`${r.name}: düzenle`} onClick={onEdit} className={TOUCH}>
            <Pencil size={15} />
          </IconButton>
          <IconButton label={`${r.name}: sil`} tone="danger" onClick={onDelete} className={TOUCH}>
            <Trash2 size={15} />
          </IconButton>
        </div>
      </div>
    </li>
  );
}

function FixedDialog({
  row,
  defaultSection,
  onClose,
  onSaved,
  onDelete,
  acikGun,
}: {
  row: FixedRow | null;
  /** Yeni giderde seçili bölüm (süzgeçte bir bölüm seçiliyse o) */
  defaultSection: FixedSection;
  onClose: () => void;
  /** Kayıttan sonra: listede satırı vurgulamak için kimlik ve yeni mi */
  onSaved: (id: number, isNew: boolean) => void;
  /** Silme onayını açar; onaylanınca bu pencere de kapanır */
  onDelete: (row: FixedRow) => void;
  acikGun: number;
}) {
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  /** "Kaydet, yenisini ekle" ile bu pencerede eklenen kalem sayısı */
  const [added, setAdded] = useState(0);
  const [f, setF] = useState({
    name: row?.name ?? "",
    section: row?.section ?? defaultSection,
    period: row?.period ?? ("aylik" as FixedPeriod),
    amount: row ? num(row.amount, 2) : "",
    note: row?.note ?? "",
    active: row?.active ?? true,
  });
  const amount = f.amount.trim() === "" ? 0 : parseNumberTR(f.amount);
  const amountError = amount === null || amount < 0 ? "Geçerli bir tutar yazın, ör. 1.250,50" : null;
  const nameError = tried && !f.name.trim() ? "Gider adını yazın" : null;
  const monthly = monthlyOf(amount ?? 0, f.period, acikGun);

  async function save(again: boolean) {
    setTried(true);
    if (!f.name.trim()) return nameRef.current?.focus();
    if (amountError || amount === null) return amountRef.current?.focus();
    setBusy(true);
    const res = await saveFixedExpense({ id: row?.id ?? null, name: f.name, section: f.section, period: f.period, amount, note: f.note, active: f.active });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    onSaved(res.data.id, !row);
    toast.success(row ? `${f.name.trim()} güncellendi` : `${f.name.trim()} eklendi`, { description: `Aylık karşılığı ${money(monthly)}${f.active ? "" : " · pasif"}` });
    if (!again) return onClose();
    // Bölüm, dönem ve durum korunur: aynı türden kalemler arka arkaya girilir
    setF((x) => ({ ...x, name: "", amount: "", note: "" }));
    setTried(false);
    setAdded((n) => n + 1);
    nameRef.current?.focus();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={row ? "Gideri düzenle" : "Sabit gider ekle"}
      description={row ? undefined : "Günlük, haftalık ya da yıllık tutar yazabilirsiniz; aylık karşılığı otomatik hesaplanır."}
      footerStart={
        row ? (
          <Button variant="ghost" className={cn("text-bad hover:bg-bad-soft hover:text-bad", TOUCH_BTN)} onClick={() => onDelete(row)} disabled={busy}>
            <Trash2 size={16} /> Sil
          </Button>
        ) : added ? (
          <span className="text-[13px] text-ink-mute tabular" aria-live="polite">
            {added} gider eklendi
          </span>
        ) : null
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className={TOUCH_BTN}>
            {added ? "Kapat" : "Vazgeç"}
          </Button>
          {/* type="button": Enter her zaman asıl "Kaydet"i çalıştırsın */}
          {!row ? (
            <Button variant="secondary" onClick={() => void save(true)} disabled={busy} className={TOUCH_BTN}>
              {/* Telefonda üç düğme tek satıra sığsın */}
              <span className="sm:hidden">Kaydet ve yeni</span>
              <span className="max-sm:hidden">Kaydet, yenisini ekle</span>
            </Button>
          ) : null}
          <Button type="submit" form={formId} disabled={busy} className={TOUCH_BTN}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-3 pb-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
      >
        <Field label="Gider kalemi" htmlFor="fx-n" error={nameError}>
          <Input
            ref={nameRef}
            id="fx-n"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            placeholder="ör. Elektrik, Muhasebeci"
            aria-invalid={nameError ? true : undefined}
            maxLength={120}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Bölüm" tip="Gelir-gider tablosunda bu kalemin görüneceği bölüm." htmlFor="fx-s">
            <Select id="fx-s" value={f.section} onChange={(e) => setF({ ...f, section: e.target.value as FixedSection })}>
              {FIXED_SECTIONS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dönem" htmlFor="fx-p" hint={FIXED_PERIODS.find((p) => p.key === f.period)?.hint}>
            <Select id="fx-p" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value as FixedPeriod })}>
              {FIXED_PERIODS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label={`${PERIOD_LABEL[f.period]} tutar (₺, KDV hariç)`}
          htmlFor="fx-a"
          error={amountError}
          hint={
            <>
              Aylık karşılığı: <span className="font-semibold text-ink tabular">{tl(monthly, 2)}</span>
              {f.period === "gunluk" ? ` (${acikGun} açık gün)` : null}
            </>
          }
        >
          <NumberInput
            ref={amountRef}
            id="fx-a"
            value={f.amount}
            onChange={(e) => setF({ ...f, amount: e.target.value })}
            placeholder="0,00"
            aria-invalid={amountError ? true : undefined}
            className="cell-input"
          />
        </Field>
        <Field label="Kaynak / not" htmlFor="fx-note" hint="İsteğe bağlı: fatura, sözleşme ya da hesap notu.">
          <Textarea id="fx-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} rows={2} maxLength={1000} />
        </Field>
        <Checkbox label="Aktif (aylık toplama ve gelir-gider tablosuna girer)" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
      </form>
    </Dialog>
  );
}

// ============================================================================ Yatırımlar

type Investment = { id: number; name: string; amount: number; date: string | null; note: string | null };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "2026-07" ise "Temmuz 2026", değilse yazıldığı gibi */
function periodText(date: string | null) {
  if (!date) return "–";
  return MONTH_RE.test(date) ? monthLabel(date) : date;
}

export function InvestmentsClient({ rows, total }: { rows: Investment[]; total: number }) {
  const [editing, setEditing] = useState<Investment | "new" | null>(null);
  const [deleting, setDeleting] = useState<Investment | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [sira, setSira] = useQueryState<string>("ysirala", "");
  const sorted = sortRows(rows, sira, { ad: (r) => r.name, donem: (r) => r.date ?? "", tutar: (r) => r.amount });
  const [flash, setFlash] = useFlash();

  async function confirmDelete() {
    if (!deleting) return;
    setDeletePending(true);
    const res = await deleteInvestment(deleting.id);
    setDeletePending(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`${deleting.name} silindi`);
    setDeleting(null);
    setEditing(null);
  }

  const sortHead = (key: string, label: ReactNode, numeric?: boolean) => (
    <SortButton dir={sortDir(sira, key)} numeric={numeric} onClick={() => setSira(nextSort(sira, key, numeric))}>
      {label}
    </SortButton>
  );

  const addButton = (
    <Button size="sm" variant="secondary" onClick={() => setEditing("new")} className={TOUCH_BTN}>
      <Plus size={16} /> Yatırım ekle
    </Button>
  );

  return (
    <Card>
      <CardHeader
        icon={<PiggyBank />}
        title="Tek seferlik yatırımlar"
        description="Bilgi amaçlı, aylık gidere dahil değil."
        meta={
          <>
            <span className="font-medium text-ink tabular">Toplam {tl(total)}</span>
            <span>(KDV hariç)</span>
            <span className="text-ink-quiet">· {rows.length} kayıt</span>
          </>
        }
        actions={addButton}
      />
      {rows.length ? (
        <>
          <TableWrap className="max-sm:hidden">
            <Table>
              <THead>
                <tr>
                  <TH>{sortHead("ad", "Yatırım")}</TH>
                  <TH>{sortHead("donem", "Dönem")}</TH>
                  <TH numeric>{sortHead("tutar", "Tutar", true)}</TH>
                  <TH>Not</TH>
                  <TH>
                    <span className="sr-only">Eylemler</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {sorted.map((r) => (
                  <TR
                    key={r.id}
                    ref={r.id === flash ? revealRow : undefined}
                    className={cn("cursor-pointer", r.id === flash && FLASH)}
                    onClick={() => setEditing(r)}
                  >
                    <TD className="font-medium">{r.name}</TD>
                    <TD className="whitespace-nowrap text-ink-soft" title={r.date ?? undefined}>
                      {periodText(r.date)}
                    </TD>
                    <TD numeric className="font-semibold">
                      {tl(r.amount)}
                    </TD>
                    <TD className="max-w-96 min-w-44 text-[13px] text-ink-mute">
                      {r.note ? (
                        <span className="line-clamp-2" title={r.note}>
                          {r.note}
                        </span>
                      ) : null}
                    </TD>
                    <TD onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1.5">
                        <IconButton label={`${r.name}: düzenle`} onClick={() => setEditing(r)}>
                          <Pencil size={15} />
                        </IconButton>
                        <IconButton label={`${r.name}: sil`} tone="danger" onClick={() => setDeleting(r)}>
                          <Trash2 size={15} />
                        </IconButton>
                      </div>
                    </TD>
                  </TR>
                ))}
              </tbody>
              <tfoot>
                <TFootRow>
                  <TD colSpan={2}>Toplam</TD>
                  <TD numeric>{tl(total)}</TD>
                  <TD colSpan={2} className="text-[13px] font-normal text-ink-mute">
                    KDV hariç
                  </TD>
                </TFootRow>
              </tfoot>
            </Table>
          </TableWrap>

          <div className="sm:hidden">
            <ul className="divide-y divide-line border-t border-line">
              {/* Tutar ve eylemler sağda alt alta: her kayıt için ayrı bir eylem satırı açılmaz */}
              {sorted.map((r) => (
                <li
                  key={r.id}
                  ref={r.id === flash ? revealRow : undefined}
                  className={cn("flex items-start gap-3 px-5 py-3 transition-colors", r.id === flash && FLASH)}
                >
                  <button type="button" onClick={() => setEditing(r)} className="min-w-0 flex-1 cursor-pointer self-stretch text-left">
                    <span className="block font-medium break-words text-ink">{r.name}</span>
                    <span className="mt-0.5 block text-xs text-ink-mute">{periodText(r.date)}</span>
                    {r.note ? <span className="mt-1 line-clamp-2 text-xs text-ink-mute">{r.note}</span> : null}
                  </button>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="font-semibold text-ink tabular">{tl(r.amount)}</span>
                    <div className="flex gap-1.5">
                      <IconButton label={`${r.name}: düzenle`} onClick={() => setEditing(r)} className={TOUCH}>
                        <Pencil size={15} />
                      </IconButton>
                      <IconButton label={`${r.name}: sil`} tone="danger" onClick={() => setDeleting(r)} className={TOUCH}>
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between gap-3 border-t border-line-strong px-5 py-3.5 font-semibold text-ink">
              <span>Toplam</span>
              <span className="tabular">{tl(total)}</span>
            </div>
          </div>
        </>
      ) : (
        <EmptyState
          icon={<PiggyBank />}
          title="Yatırım kaydı yok"
          description="Açılış, ekipman, dekorasyon gibi tek seferlik harcamaları buraya ekleyin."
          action={addButton}
        />
      )}
      {editing ? (
        <InvestmentDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={setFlash} onDelete={setDeleting} />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        pending={deletePending}
        title="Yatırımı sil"
        confirmLabel="Yatırımı sil"
        description={
          deleting ? (
            <>
              <strong className="font-semibold text-ink">{deleting.name}</strong> ({tl(deleting.amount)}) kalıcı olarak silinecek. Bu işlem geri alınamaz.
            </>
          ) : null
        }
      />
    </Card>
  );
}

function InvestmentDialog({
  row,
  onClose,
  onSaved,
  onDelete,
}: {
  row: Investment | null;
  onClose: () => void;
  /** Kayıttan sonra listede vurgulanacak satır */
  onSaved: (id: number) => void;
  onDelete: (row: Investment) => void;
}) {
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [name, setName] = useState(row?.name ?? "");
  const [amount, setAmount] = useState(row ? num(row.amount, 2) : "");
  const [date, setDate] = useState(row?.date ?? "");
  const [note, setNote] = useState(row?.note ?? "");
  // Ay seçici yalnızca dönem boşsa ya da YYYY-AA ise; elle yazılmış eski değerler metin olarak kalır
  const [monthPicker] = useState(() => !row?.date || MONTH_RE.test(row.date));
  const parsed = amount.trim() === "" ? 0 : parseNumberTR(amount);
  const amountError = parsed === null || parsed < 0 ? "Geçerli bir tutar yazın, ör. 12.500" : null;
  const nameError = tried && !name.trim() ? "Yatırımın adını yazın" : null;

  async function save() {
    setTried(true);
    if (!name.trim()) return nameRef.current?.focus();
    if (amountError || parsed === null) return amountRef.current?.focus();
    setBusy(true);
    const res = await saveInvestment({ id: row?.id ?? null, name, amount: parsed, date, note });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    onSaved(res.data.id);
    toast.success(row ? `${name.trim()} güncellendi` : `${name.trim()} eklendi`, { description: `${tl(parsed)} · KDV hariç` });
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={row ? "Yatırımı düzenle" : "Yatırım ekle"}
      footerStart={
        row ? (
          <Button variant="ghost" className={cn("text-bad hover:bg-bad-soft hover:text-bad", TOUCH_BTN)} onClick={() => onDelete(row)} disabled={busy}>
            <Trash2 size={16} /> Sil
          </Button>
        ) : null
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className={TOUCH_BTN}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={busy} className={TOUCH_BTN}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-3 pb-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Yatırım" htmlFor="iv-n" error={nameError}>
          <Input
            ref={nameRef}
            id="iv-n"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ör. Kahve makinesi, tabela"
            aria-invalid={nameError ? true : undefined}
            maxLength={160}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tutar (₺, KDV hariç)" htmlFor="iv-a" error={amountError}>
            <NumberInput
              ref={amountRef}
              id="iv-a"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
              aria-invalid={amountError ? true : undefined}
              className="cell-input"
            />
          </Field>
          <Field label="Dönem" htmlFor="iv-d" hint="Harcamanın yapıldığı ay; boş bırakılabilir.">
            <Input
              id="iv-d"
              type={monthPicker ? "month" : "text"}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              placeholder="2026-07"
              maxLength={10}
            />
          </Field>
        </div>
        <Field label="Not" htmlFor="iv-note">
          <Textarea id="iv-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
        </Field>
      </form>
    </Dialog>
  );
}
