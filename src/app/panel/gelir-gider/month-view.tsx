"use client";

import { ChevronLeft, ChevronRight, Eraser, MessageSquareText, PencilLine, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useLayoutEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, NumberInput, Textarea } from "@/components/ui/form";
import { InfoTip } from "@/components/ui/misc";
import { SHEET_BTN } from "@/components/ui/mobile-filters";
import { useIsPhone } from "@/components/ui/use-media";
import type { PnlCell, PnlRowDef } from "@/lib/calc/engine";
import { MONTH_NAMES } from "@/lib/constants";
import { money, monthLabel, num, pct, tl } from "@/lib/format";
import { monthKasa } from "@/lib/lafpos/kasa";
import { cn } from "@/lib/utils";

import { CELL_NOTE_MAX, noteSaveEffect, openDaysError, planCellEdit, planCellRestore, sectionTotalKey, shiftMonth, type CellEditPlan, type CellField } from "./cell-rules";
import type { GridSection } from "./pnl-grid";

/**
 * Gelir-gider telefonda: tek ay. Üstte yapışkan ay seçici (yıl sınırını geçer), ayın özeti (kâr / zarar, ciro,
 * gider, açık gün, ay notu), altta bölüm bölüm tek sütun kalemler; bölüm toplamı başlıkta. Girilebilen kaleme
 * dokununca alttan açılan sayfada tutar (ve not) girilir. 12 aylık ızgara md'den itibaren aynen kalır.
 */

function fmt(v: number | null, format?: string, exact = false) {
  if (v === null || v === undefined) return "–";
  if (format === "percent") return pct(v);
  if (format === "days") return num(v);
  // Elle girilen tutar kuruşuyla görünür (12,50 girildiyse 13 ₺ değil); hesaplananlar tam lira
  return exact ? money(v) : tl(v);
}

/** Düzenleme sayfasına giden hücre */
interface EditTarget {
  field: CellField;
  rowKey: string;
  label: string;
  hint?: string;
  kind: "auto" | "manual";
  format?: string;
  cell: PnlCell;
  /** Açık günde ayın gün sayısı */
  dim?: number;
}

const ROW = "flex min-h-12 w-full items-center gap-3 px-3.5 py-2.5 text-left";

/**
 * Yıl sınırını geçen ay değişiminde kaydırma yeri. Başka yılın sayfası yeni bir sayfa olarak açılır; Next eskisini
 * gizlerken (Activity, display: none) sayfa bir an kısalır ve tarayıcı kaydırmayı başa çeker ({ scroll: false }
 * bunu önlemez). Yeni sayfanın ay görünümü açılınca okunan yer geri verilir.
 */
let carryScroll: { month: string; y: number } | null = null;

export function MonthView({
  year,
  months,
  month,
  onMonth,
  activeMonths,
  sections,
  shownSections,
  showOpenDays,
  openDays,
  openDaysKasa,
  openDaysManual,
  dims,
  monthNotes,
  currentMonth,
  onMonthNote,
  onSave,
  expectedDebts,
  lafposSwitch = null,
}: {
  year: number;
  months: string[];
  /** Seçili ay (bu yılın aylarından biri) */
  month: string;
  onMonth: (m: string) => void;
  activeMonths: string[];
  /** Süzgeçsiz bölümler: özet ve bölüm toplamı bunlardan */
  sections: GridSection[];
  /** Süzgece uyan bölümler (bu aya göre) */
  shownSections: GridSection[];
  showOpenDays: boolean;
  openDays: (number | null)[];
  /** Kasa raporlarından açık gün ve elle yazılan (verilmezse açık gün hep elle) */
  openDaysKasa?: (number | null)[];
  openDaysManual?: (number | null)[];
  dims: number[];
  monthNotes: (string | null)[];
  currentMonth: string;
  onMonthNote: (i: number) => void;
  /** Kaydı yapar; hata varsa metnini döndürür */
  onSave: (month: string, field: CellField, rowKey: string, plan: Extract<CellEditPlan, { action: "save" | "clear" }>) => Promise<string | null>;
  /** Ay → faturası beklenen cari alımlar: Mal alışları'nın altında bilgi satırı (toplamlara katılmaz) */
  expectedDebts?: Readonly<Record<string, { total: number; href: string | null; name: string }>>;
  /** LafPOS'a geçiş günü (yalnız metinler: ayın kasası; denetim E-39) */
  lafposSwitch?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [target, setTarget] = useState<EditTarget | null>(null);
  const i = months.indexOf(month);
  const all = sections.flatMap((s) => s.rows);
  const cellOf = (key: string): PnlCell | undefined => all.find((r) => r.def.key === key)?.cells[i];
  const profit = cellOf("profit")?.value ?? null;
  const revenueNet = cellOf("revenueNet")?.value ?? null;
  // laffogato.net online satışı (KDV hariç): ay çekildiyse kâr ve oranlar ModPOS + online cirosuyla
  const onlineCells = ["site:cafe", "site:shop", "site:karaoke"].map((k) => cellOf(k)?.value ?? null);
  const online = onlineCells.some((v) => v !== null) ? onlineCells.reduce<number>((a, v) => a + (v ?? 0), 0) : null;
  const revenueBase = online !== null ? (revenueNet ?? 0) + online : revenueNet;
  const revenue = cellOf("revenue")?.value ?? null;
  const expenses = cellOf("total:expenses")?.value ?? null;
  const active = activeMonths.includes(month);
  const note = monthNotes[i];
  // Telefonda en sık girilen kalem (POS cirosu) listenin en altında: özetteki ciroya dokununca da açılır
  const revenueRow = all.find((r) => r.def.key === "revenue" && r.def.editable);

  /** Ay değiştir: yılın dışına çıkınca o yılın sayfasına geçilir (?yil=…&ay=…) */
  const go = (m: string) => {
    if (months.includes(m)) return onMonth(m);
    // Kaydırma korunur: okunan bölüm ve yapışkan ay seçici yerinde kalır
    carryScroll = { month: m, y: window.scrollY };
    start(() => router.push(`/panel/gelir-gider?yil=${m.slice(0, 4)}&ay=${m}`, { scroll: false }));
  };
  useLayoutEffect(() => {
    const c = carryScroll;
    if (!c || c.month !== month) return;
    carryScroll = null;
    if (Math.abs(window.scrollY - c.y) > 40) window.scrollTo({ top: c.y, behavior: "instant" });
  }, [month]);

  const openEdit = (def: PnlRowDef, cell: PnlCell) =>
    setTarget({
      field: def.key === "revenue" ? "revenue" : "pnl",
      rowKey: def.key,
      label: def.label,
      hint: def.hint,
      // Kasa raporlarından gelen ciro hesaplanan gibi: elle yazılanı boşaltmak kasaya döndürür
      kind: def.kind === "manual" && !(def.key === "revenue" && cell.computed !== null) ? "manual" : "auto",
      format: def.format,
      cell,
    });
  const daysKasa = openDaysKasa?.[i] ?? null;
  const daysManual = openDaysManual ? openDaysManual[i] !== null : openDays[i] !== null;

  return (
    <div className="md:hidden">
      {/* Yapışkan ay seçici: telefondaki üst çubuğun (--mobile-top-h) hemen altında */}
      <div className="sticky top-(--mobile-top-h) z-20 border-y border-line bg-panel/95 px-4 py-2 backdrop-blur-md">
        <div role="group" aria-label="Ay" aria-busy={pending || undefined} className={cn("flex items-center gap-2", pending && "opacity-60")}>
          <button
            type="button"
            onClick={() => go(shiftMonth(month, -1))}
            aria-label={`Önceki ay: ${monthLabel(shiftMonth(month, -1))}`}
            className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-surface text-ink-mute ring-1 ring-line-strong ring-inset hover:text-ink"
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <select
            value={month}
            onChange={(e) => go(e.target.value)}
            aria-label="Ay seçin"
            className="h-11 min-w-0 flex-1 cursor-pointer appearance-none rounded-xl border-0 bg-surface px-3 text-center text-base font-semibold text-ink ring-1 ring-line-strong ring-inset focus:ring-2 focus:ring-ink/25 focus:outline-none"
          >
            {months.map((m, idx) => (
              <option key={m} value={m}>
                {MONTH_NAMES[idx]} {year}
                {m === currentMonth ? " · bu ay" : activeMonths.includes(m) ? "" : " · veri yok"}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => go(shiftMonth(month, 1))}
            aria-label={`Sonraki ay: ${monthLabel(shiftMonth(month, 1))}`}
            className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-surface text-ink-mute ring-1 ring-line-strong ring-inset hover:text-ink"
          >
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Ayın özeti */}
      <div className="px-4 pt-3">
        <div className="rounded-2xl bg-surface p-4 ring-1 ring-line" aria-live="polite">
          <p className="text-[13px] text-ink-mute">{monthLabel(month)} kâr / zarar</p>
          <p className={cn("mt-0.5 text-2xl font-semibold tracking-tight tabular", profit !== null && profit < 0 ? "text-bad" : profit ? "text-good" : "text-ink")}>
            {revenue === null && !expenses ? "–" : fmt(profit)}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="min-w-0">
              <dt className="text-xs text-ink-mute">Ciro (KDV hariç)</dt>
              <dd className={cn("font-medium tabular", revenueNet === null ? "text-warn" : "text-ink")}>
                {revenueRow ? (
                  <button
                    type="button"
                    onClick={() => openEdit(revenueRow.def, revenueRow.cells[i])}
                    className="-mx-1 -my-2 inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-1 text-left underline decoration-line-strong decoration-dotted underline-offset-4"
                    aria-label={`Aylık ciroyu (KDV dahil, POS) ${revenueNet === null ? "girin" : "düzenleyin"}`}
                  >
                    {revenueNet === null ? "girilmedi · gir" : fmt(revenueNet)}
                    <PencilLine size={13} className="shrink-0 text-ink-quiet" aria-hidden="true" />
                  </button>
                ) : revenueNet === null ? (
                  "girilmedi"
                ) : (
                  fmt(revenueNet)
                )}
                {online !== null ? <span className="block text-xs font-normal text-ink-mute">+ online {fmt(online)} (laffogato.net)</span> : null}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-ink-mute">Giderler</dt>
              <dd className="font-medium text-ink tabular">{fmt(expenses)}</dd>
            </div>
            {revenueBase ? (
              <div className="col-span-2 min-w-0">
                <dt className="sr-only">Maliyet oranı</dt>
                <dd className="text-xs text-ink-mute tabular">
                  Giderler cironun {pct((expenses ?? 0) / revenueBase, 0)} · kâr oranı {pct((profit ?? 0) / revenueBase)}
                  {online !== null ? ` (ciro: ${monthKasa(month, lafposSwitch).short} + online)` : ""}
                </dd>
              </div>
            ) : null}
          </dl>
          {!active ? <p className="mt-2 text-xs text-ink-mute">Bu ayda henüz veri yok. Tutar girdikçe hesaplanır.</p> : null}
          <button
            type="button"
            onClick={() => onMonthNote(i)}
            className="mt-3 flex min-h-11 w-full cursor-pointer items-start gap-2 rounded-xl bg-panel px-3 py-2.5 text-left text-[13px] text-ink-soft"
          >
            <MessageSquareText size={15} className={cn("mt-0.5 shrink-0", note ? "text-warn" : "text-ink-quiet")} aria-hidden="true" />
            <span className="min-w-0 flex-1 break-words">{note ? note : <span className="text-ink-mute">Ay notu ekle</span>}</span>
            <span className="sr-only">{note ? "Ay notunu düzenle" : ""}</span>
          </button>
        </div>
      </div>

      {showOpenDays ? (
        <ul className="mx-4 mt-3 rounded-2xl bg-surface ring-1 ring-line">
          <li>
            <button
              type="button"
              onClick={() =>
                setTarget({
                  field: "openDays",
                  rowKey: "openDays",
                  label: "Açık gün sayısı",
                  hint: "Kira, personel, reklam gibi aylık giderler gün ÷ ayın gün sayısı oranıyla hesaplanır: açık günü elle yazarsanız o gün, kasa raporlarından gelirse raporların kapsadığı takvim günü (kapalı bir gün kirayı ve maaşı düşürmez). Süren ayda bugüne kadarki açık gün yazılır.",
                  kind: daysKasa !== null ? "auto" : "manual",
                  format: "days",
                  cell: { value: openDays[i], computed: daysKasa, overridden: daysManual },
                  dim: dims[i],
                })
              }
              className={cn(ROW, "cursor-pointer rounded-2xl")}
            >
              <span className="min-w-0 flex-1 text-[15px] font-medium text-ink">
                Açık gün sayısı
                {daysKasa !== null && !daysManual ? <span className="block text-xs font-normal text-ink-mute">Kasa raporlarından</span> : null}
              </span>
              <Value value={openDays[i]} format="days" suffix={`/${dims[i]}`} editable manual={daysKasa === null || daysManual} overridden={daysKasa !== null && daysManual} />
            </button>
          </li>
        </ul>
      ) : null}

      {shownSections.length === 0 && !showOpenDays ? (
        <p className="mx-4 mt-4 rounded-2xl bg-surface px-4 py-6 text-center text-sm text-ink-mute ring-1 ring-line">Bu süzgece uyan kalem yok.</p>
      ) : null}

      {shownSections.map((sec) => {
        const full = sections.find((s) => s.key === sec.key) ?? sec;
        const totalKey = sectionTotalKey(full.rows);
        const totalRow = totalKey ? full.rows.find((r) => r.def.key === totalKey) : undefined;
        const rows = sec.rows.filter((r) => r.def.key !== totalKey);
        return (
          <section key={sec.key} aria-label={sec.label} className="mt-5">
            {/* Bölüm başlığı ay seçicinin (üst çubuk + 62px) altında yapışık: uzun bölümde nerede olunduğu belli */}
            <h3 className="sticky top-[calc(var(--mobile-top-h)+3.875rem)] z-10 flex items-baseline justify-between gap-3 bg-panel/95 px-5 pt-2 pb-2 text-[13px] font-semibold text-ink-soft backdrop-blur-md">
              <span>{sec.label}</span>
              {totalRow ? (
                <span className={cn("text-sm text-ink tabular", (totalRow.cells[i].value ?? 0) < 0 && "text-bad")}>
                  <span className="sr-only">Toplam </span>
                  {fmt(totalRow.cells[i].value, totalRow.def.format)}
                </span>
              ) : null}
            </h3>
            {rows.length ? (
              <ul className="mx-4 divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
                {rows.map(({ def, cells }) => {
                  const c = cells[i];
                  const isProfit = def.key === "profit" || def.key === "ratio:profit";
                  const label = (
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-[15px] leading-5 break-words", def.strong ? "font-semibold text-ink" : "text-ink-soft")}>{def.label}</span>
                      {def.sub ? <span className="mt-0.5 block text-xs leading-4 text-ink-mute">{def.sub}</span> : null}
                      {c.note ? (
                        <span className="mt-1 flex items-start gap-1 text-xs leading-4 text-warn">
                          <MessageSquareText size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                          <span className="min-w-0 break-words">
                            <span className="sr-only">Not: </span>
                            {c.note}
                          </span>
                        </span>
                      ) : null}
                      {c.warn ? (
                        <span className="mt-1 flex items-start gap-1 text-xs leading-4 font-medium text-warn">
                          <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                          <span className="min-w-0 break-words">
                            <span className="sr-only">Dikkat: </span>
                            {c.warn}
                          </span>
                        </span>
                      ) : null}
                    </span>
                  );
                  return (
                    <li key={def.key}>
                      {def.editable ? (
                        <button type="button" onClick={() => openEdit(def, c)} className={cn(ROW, "cursor-pointer")}>
                          {label}
                          <Value
                            value={c.value}
                            format={def.format}
                            editable
                            manual={def.kind === "manual" && !(def.key === "revenue" && c.computed !== null && !c.overridden)}
                            overridden={c.overridden && (def.kind === "auto" || (def.key === "revenue" && c.computed !== null))}
                            muted={c.outOfRange && !c.overridden}
                          />
                        </button>
                      ) : def.key.startsWith("purchase:") ? (
                        // Tedarikçi satırı faturalardan gelir: dokununca o ayın o tedarikçi faturaları açılır
                        <Link
                          href={`/panel/faturalar?ara=${encodeURIComponent(def.key.slice("purchase:".length))}&ay=${month}#fatura-listesi`}
                          className={cn(ROW, "cursor-pointer")}
                          aria-label={`${def.label}: ${fmt(c.value, def.format)}, faturaları göster`}
                        >
                          {label}
                          <span className={cn("shrink-0 text-right text-[15px] text-ink-mute tabular", c.value === null && "text-ink-quiet")}>{fmt(c.value, def.format)}</span>
                          <ChevronRight size={16} className="-mr-1 shrink-0 text-ink-quiet" aria-hidden="true" />
                        </Link>
                      ) : def.key.startsWith("expense:") ? (
                        // Aylık harcama satırı Aylık harcamalar'dan gelir: dokununca o ayın harcamaları açılır (tutar orada girilir)
                        <Link href={`/panel/harcamalar?ay=${month}`} className={cn(ROW, "cursor-pointer")} aria-label={`${def.label}: ${fmt(c.value, def.format)}, harcamaları göster`}>
                          {label}
                          <span className={cn("shrink-0 text-right text-[15px] text-ink-mute tabular", c.value === null && "text-ink-quiet", c.value !== null && c.value < 0 && "text-bad")}>
                            {fmt(c.value, def.format)}
                          </span>
                          <ChevronRight size={16} className="-mr-1 shrink-0 text-ink-quiet" aria-hidden="true" />
                        </Link>
                      ) : (
                        <div className={ROW}>
                          {label}
                          {def.hint ? <InfoTip text={def.hint} className="shrink-0" /> : null}
                          <span
                            className={cn(
                              "shrink-0 text-right text-[15px] tabular",
                              def.strong ? "font-semibold text-ink" : "text-ink-mute",
                              c.value !== null && c.value < 0 && "text-bad",
                              isProfit && c.value !== null && c.value > 0 && "text-good",
                              c.value === null && "text-ink-quiet",
                            )}
                          >
                            {fmt(c.value, def.format)}
                          </span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {sec.key === "mal" && expectedDebts?.[month]?.total ? (
              <p className="mx-5 mt-2 text-xs leading-5 text-ink-mute">
                Faturası beklenen alımlar: {tl(expectedDebts[month].total, 2)} (bu ayın giderinde yok)
                {expectedDebts[month].href ? (
                  <>
                    {" · "}
                    <Link href={expectedDebts[month].href!} className="font-medium text-info underline-offset-2 hover:underline">
                      Tedarikçiler
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
          </section>
        );
      })}

      <p className="px-5 pt-4 pb-5 text-xs leading-5 text-ink-mute">
        Mavi tutarlar elle girilmiş; mavi zeminli olanlar hesaplananın üzerine yazılmış. Kaleme dokunup tutarı silerseniz hesaplanan değere
        döner.
      </p>

      {target ? (
        <CellSheet
          key={`${month}-${target.rowKey}`}
          target={target}
          title={`${target.label} · ${monthLabel(month)}`}
          month={month}
          onClose={() => setTarget(null)}
          onSave={async (plan) => {
            const err = await onSave(month, target.field, target.rowKey, plan);
            if (err) return err;
            setTarget(null);
            return null;
          }}
        />
      ) : null}
    </div>
  );
}

/** Kalemin sağındaki değer: girilebilen hücre beyaz kutu (dokunulacağı belli), elle girilen mavi, üzerine yazılan mavi zeminli */
function Value({
  value,
  format,
  suffix,
  editable,
  manual,
  overridden,
  muted,
}: {
  value: number | null;
  format?: string;
  suffix?: string;
  editable?: boolean;
  manual?: boolean;
  overridden?: boolean;
  muted?: boolean;
}) {
  const negative = value !== null && value < 0;
  return (
    <span
      className={cn(
        "relative inline-flex h-10 min-w-24 shrink-0 items-center justify-end gap-1.5 rounded-xl px-3 text-[15px] tabular",
        editable && "bg-panel ring-1 ring-line ring-inset",
        (manual || overridden) && !negative && value !== null && "cell-input font-medium",
        overridden && "bg-info-soft",
        negative && "text-bad",
        value === null && "text-ink-quiet",
        muted && "bg-transparent outline-1 -outline-offset-1 outline-line-strong outline-dashed",
      )}
    >
      {fmt(value, format, manual || overridden)}
      {suffix ? <span className="text-xs font-normal text-ink-quiet">{suffix}</span> : null}
      {editable ? <PencilLine size={13} className="shrink-0 text-ink-quiet" aria-hidden="true" /> : null}
      {overridden ? <span className="absolute top-1 right-1 size-1.5 rounded-full bg-info" aria-hidden="true" /> : null}
      {overridden ? <span className="sr-only"> (hesaplananın üzerine yazılmış)</span> : null}
    </span>
  );
}

/** Tek hücrenin düzenleme sayfası: büyük tutar alanı, varsa not; "Temizle" hesaplanana döndürür / boşaltır */
function CellSheet({
  target,
  title,
  month,
  onClose,
  onSave,
}: {
  target: EditTarget;
  title: string;
  month: string;
  onClose: () => void;
  onSave: (plan: Extract<CellEditPlan, { action: "save" | "clear" }>) => Promise<string | null>;
}) {
  const formId = useId();
  const { cell, field, kind, format } = target;
  const initial = cell.value === null ? "" : format === "days" ? String(cell.value) : num(cell.value, 2);
  const [amountText, setAmountText] = useState(initial);
  const [noteText, setNoteText] = useState(cell.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = field === "openDays";
  const validate = days ? (v: number | null) => openDaysError(month, v) : undefined;
  const input = { field, kind, overridden: cell.overridden, value: cell.value, computed: cell.computed, prevNote: cell.note ?? null, noteText, validate };
  const plan = planCellEdit({ ...input, amountText });
  const clearPlan = planCellEdit({ ...input, amountText: "", noteText: "" });
  const canClear = clearPlan.action === "clear";
  const amount = plan.action === "save" ? plan.amount : null;
  const freezeWarn =
    field === "pnl" && amount !== null && noteText.trim() && noteSaveEffect({ kind, overridden: cell.overridden, amount, computed: cell.computed }) === "freeze";

  async function run(p: CellEditPlan) {
    if (p.action === "error") return setError(p.message);
    if (p.action === "none") return onClose();
    setBusy(true);
    const err = await onSave(p);
    setBusy(false);
    if (err) {
      setError(err);
      toast.error(err);
      return;
    }
    if (p.action !== "clear") return void toast.success(p.message);
    // Temizle tek dokunuşla siler: bildirimde 10 saniye "Geri al" (önceki tutar ve not aynen geri yazılır)
    const restore = planCellRestore({ field, kind, overridden: cell.overridden, value: cell.value, prevNote: cell.note ?? null });
    toast.success(p.message, {
      duration: 10000,
      action: restore
        ? {
            label: "Geri al",
            onClick: () => {
              void onSave(restore).then((e) => (e ? toast.error(e) : toast.success(restore.message)));
            },
          }
        : undefined,
    });
  }

  // Telefonda "Temizle" altbilgide Vazgeç'in yanında değil, tutar alanının altında durur: başparmağın durduğu
  // köşede yanlışlıkla dokunulmasın. Masaüstü ve tablette altbilginin solunda.
  const phone = useIsPhone();
  // Ciro ve açık gün kasa raporlarından geliyorsa (kind "auto"): boşaltmak kasaya döndürür
  const fromKasa = kind === "auto" && field !== "pnl";
  const clearLabel = kind === "auto" && field === "pnl" ? "Hesaplanana dön" : fromKasa ? "Kasaya dön" : "Temizle";

  return (
    <Dialog
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      size="sm"
      title={title}
      description={
        fromKasa && cell.computed !== null
          ? `Kasa raporlarından: ${fmt(cell.computed, format)}${cell.overridden ? " · şu an elle girilen geçerli" : ""}`
          : kind === "auto" && cell.computed !== null
            ? `Hesaplanan: ${fmt(cell.computed, format)}${cell.overridden ? " · şu an elle girilmiş tutar geçerli" : ""}`
            : days
              ? `${monthLabel(month)} ${target.dim} gün çeker`
              : field === "revenue"
                ? "KDV dahil POS cirosu (Satışlar'daki ay bilgisiyle aynı alan)"
                : "Elle girilen tutar (KDV hariç)"
      }
      footerStart={
        canClear && !phone ? (
          <Button variant="ghost" className="text-bad hover:bg-bad-soft hover:text-bad" disabled={busy} onClick={() => void run(clearPlan)}>
            {clearLabel}
          </Button>
        ) : null
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy} className={SHEET_BTN}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={busy} className={SHEET_BTN}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-4 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(plan);
        }}
      >
        <Field
          label={days ? "Açık gün" : field === "revenue" ? "Tutar (₺, KDV dahil)" : "Tutar (₺, KDV hariç)"}
          htmlFor={`${formId}-a`}
          error={error}
          hint={
            kind === "auto" && field === "pnl"
              ? "Boş bırakıp kaydederseniz hesaplanan değere döner."
              : fromKasa
                ? `${days ? `0 ile ${target.dim} arası tam sayı. ` : ""}Boş bırakıp kaydederseniz kasa raporlarındaki değere döner.`
                : days
                ? `0 ile ${target.dim} arası tam sayı`
                : "Boş bırakıp kaydederseniz hücre boşalır."
          }
        >
          <NumberInput
            id={`${formId}-a`}
            data-autofocus="always"
            inputMode={days ? "numeric" : "decimal"}
            enterKeyHint="done"
            value={amountText}
            onChange={(e) => {
              setError(null);
              setAmountText(days ? e.target.value.replace(/\D/g, "").slice(0, 2) : e.target.value);
            }}
            onFocus={(e) => e.currentTarget.select()}
            aria-invalid={error ? true : undefined}
            className={cn("h-14 text-xl font-semibold pointer-coarse:h-14 pointer-coarse:text-xl", !error && "cell-input")}
          />
        </Field>
        {canClear && phone ? (
          <div className="-mt-2 flex justify-end">
            <Button variant="ghost" size="sm" className="text-bad hover:bg-bad-soft hover:text-bad" disabled={busy} onClick={() => void run(clearPlan)}>
              <Eraser size={15} aria-hidden="true" /> {clearLabel}
            </Button>
          </div>
        ) : null}
        {cell.warn ? (
          <p className="flex items-start gap-1.5 text-xs leading-5 font-medium text-warn">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{cell.warn}</span>
          </p>
        ) : null}
        {target.hint || cell.info ? <p className="text-xs leading-5 text-ink-mute">{[cell.info, target.hint].filter(Boolean).join(" ")}</p> : null}
        {field === "pnl" ? (
          <Field label="Not" htmlFor={`${formId}-n`} hint={`${noteText.trim().length} / ${CELL_NOTE_MAX}`}>
            <Textarea
              id={`${formId}-n`}
              value={noteText}
              onChange={(e) => {
                setError(null);
                setNoteText(e.target.value);
              }}
              rows={2}
              maxLength={CELL_NOTE_MAX}
              placeholder="İsteğe bağlı, ör. Ekim kombi servisi"
              className="max-h-40 [field-sizing:content]"
            />
          </Field>
        ) : null}
        {freezeWarn ? (
          <p className="flex items-start gap-1.5 text-xs leading-5 font-medium text-warn" aria-live="polite">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>Not kaydedilince bu tutar elle girilmiş sayılır: hesaplanan değer sonradan değişse de {tl(amount, 2)} kalır.</span>
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
