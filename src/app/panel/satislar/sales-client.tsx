"use client";

import {
  CalendarDays,
  Check,
  ChevronDown,
  CircleCheck,
  CircleHelp,
  ClipboardPaste,
  Coffee,
  Eraser,
  FileUp,
  Info,
  ListChecks,
  LoaderCircle,
  Mic,
  Pencil,
  Plus,
  RotateCcw,
  Store,
  Trash2,
  TriangleAlert,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useMemo, useOptimistic, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { tryAction, useActionTransition } from "@/components/ui/action-error";
import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT, SPRING_PRESS, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { clearQuery, FilterBar, FilterChip, keepScroll, matches, SearchField, useQueryState, useQueryText, useSettleScroll } from "@/components/ui/filters";
import { Checkbox, Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { IconTile, toneFor } from "@/components/ui/icon-tile";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { ActiveFilters, BIG_FIELDS, ChoiceList, FilterButton, SHEET_BTN, type ActiveFilter } from "@/components/ui/mobile-filters";
import { Pagination, usePaged } from "@/components/ui/pagination";
import { Segmented } from "@/components/ui/segmented";
import { SortButton, Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import { daysInMonth } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import {
  createPosMappingIndex,
  describeSkipped,
  isSummaryRow,
  parsePastedSales,
  suspectTotalRows,
  type SalesParseResult,
} from "@/lib/calc/pos-paste";
import type { MonthField, TillMonth } from "@/lib/calc/types";
import { missingSentence, MONTH_FIELDS, partialSentence } from "@/lib/cash-month";
import { num, pct, tl } from "@/lib/format";
import { dayMonthTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import {
  applyLafposMatches,
  applyLineMatches,
  clearMonthSales,
  deleteLine,
  importSales,
  matchLafposName,
  parseSalesFile,
  saveLine,
  saveMonthInfo,
  setLineMatch,
} from "@/server/actions/sales";

import {
  cardShareProblem,
  collectSuggestions,
  effectiveValue,
  fieldPayload,
  fieldText,
  fieldValue,
  initialModes,
  inMarginScale,
  kasaHint,
  marginColor,
  marginLevelLabel,
  marginScale,
  monthPhase,
  monthSavedToast,
  openDaysHint,
  openDaysProblem,
  previewMatches,
  replaceConfirm,
  SALES_FILE_MAX_MB,
  salesFileProblem,
  suggestProduct,
  type FieldMode,
  type MappingLite,
  type MarginScale,
} from "./sales-logic";
import { ProductPicker, type ProductOption } from "./product-picker";

export type { ProductOption } from "./product-picker";

export interface SalesRow {
  id: number;
  /**
   * LafPOS'un ay toplamı satırıysa satırın geçtiği gün sayısı (docs/LAFPOS.md › Günlük satış): salt okunur, düzenlenmez ve
   * silinmez, eşleştirmesi POS adıyla (matchLafposName). ModPOS listesinin satırında null
   */
  lafposDays: number | null;
  posName: string;
  qty: number;
  revenue: number;
  productId: number | null;
  productLabel: string | null;
  isService: boolean;
  matched: boolean;
  /** Bağlı ürünün reçetesi boş: maliyet ortalama oranla tahmini (unitCost null), marj ölçeğine girmez */
  noRecipe: boolean;
  unitCost: number | null;
  net: number;
  cost: number;
  commission: number;
  grossProfit: number;
  margin: number;
  note: string | null;
  avgPrice: number;
  menuPrice: number | null;
}

// ---------------------------------------------------------------- Sayaçlar

/**
 * AkmanOS AnimatedNumber ile sayan rakam. Ekran okuyucu ara değerleri değil, son değeri okur;
 * hareket azaltıldığında AnimatedNumber doğrudan son değeri yazar.
 */
export function CountUp({ value, kind = "tl" }: { value: number; kind?: "tl" | "num" }) {
  const format = kind === "tl" ? (v: number) => tl(v) : (v: number) => num(v);
  return (
    <>
      <span aria-hidden="true">
        <AnimatedNumber value={value} format={format} />
      </span>
      <span className="sr-only">{format(value)}</span>
    </>
  );
}

const COVERAGE_SEGMENTS = 20;

/**
 * AkmanOS capacity-allocation çubuğu: cironun ne kadarının bir ürüne ya da HİZMET'e bağlandığı.
 * Dolu parçalar mürekkep, boşlar şerit; açılışta soldan sağa dolar.
 */
export function MatchCoverage({ share }: { share: number }) {
  const reduce = useCalmMotion();
  const clamped = Math.min(1, Math.max(0, share));
  const filled = Math.round(clamped * COVERAGE_SEGMENTS);
  return (
    <div>
      <div className="flex h-6 items-stretch gap-[2px] sm:gap-[3px]" role="img" aria-label={`Eşleştirilmiş ciro ${pct(clamped, 0)}`}>
        {Array.from({ length: COVERAGE_SEGMENTS }, (_, i) => (
          <motion.span
            key={i}
            aria-hidden="true"
            className={cn("min-w-0 flex-1 origin-bottom rounded-[3px]", i < filled ? "bg-ink" : "bg-panel-deep")}
            // initial sunucuda ve istemcide aynı (hidrasyon uyumu); hareket azaltıldığında süre 0
            initial={reduce ? false : { opacity: 0, scaleY: 0.4 }}
            animate={{ opacity: 1, scaleY: 1 }}
            transition={reduce ? { duration: 0 } : { ...SPRING_SWAP, delay: i * 0.012 }}
          />
        ))}
      </div>
      <p className="mt-1.5 flex items-center justify-between gap-2 text-xs text-ink-mute">
        <span>Eşleştirilmiş ciro</span>
        <span className="font-medium text-ink tabular">{pct(clamped, 0)}</span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- Ay bilgisi

/** Açık gün alanının "Tüm ay (30)" tek tık düzeltmesi */
function AllMonthButton({ dim, onPick }: { dim: number; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="cursor-pointer font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink pointer-coarse:min-h-11"
    >
      Tüm ay ({dim})
    </button>
  );
}

/** Ay bilgisi alanlarının sırası ve kimlikleri (Genel bakış ve Kasa bağlantıları #m-days, #m-pos) */
const INFO_IDS: Record<MonthField, string> = { posRevenue: "m-pos", openDays: "m-days", discounts: "m-disc", offRevenue: "m-off", cardShare: "m-card" };

/**
 * Ayın bilgileri: POS cirosu, açık gün, indirim, ödenmez ve kartlı satış oranı. Kasa raporu olan ayda boş bırakılan
 * alanlar kasa raporlarından dolar (src/lib/cash-month.ts): alan "Kasadan" rozetiyle salt okunur görünür, dokununca
 * "Elle" kipine geçer; "Kasadakini kullan" geri döndürür. Elle yazılan her zaman geçerlidir. Kaydederken kasa kipindeki
 * ve boş bırakılan alanlar boş (null) gider: değer bir sonraki raporla kendiliğinden değişir.
 */
export function MonthInfoForm({
  month,
  label,
  info,
  kasa = null,
  settingsCardShare,
  listTotal,
  listPeriod = null,
  currentMonth,
  recordedIkram,
  className,
}: {
  month: string;
  label: string;
  /** Elle yazılan değerler (kasadan gelenler burada boş) */
  info: Record<MonthField, number | null> & { note: string | null };
  /** Ayın kasa raporlarından değerleri (uygulanmayan null) ve kapsamı; raporu yoksa null */
  kasa?: { values: Record<MonthField, number | null>; till: TillMonth } | null;
  /** Ayarlar › kartlı satış oranı (bu ay için hiçbir oran yoksa geçer) */
  settingsCardShare: number;
  listTotal: number;
  /**
   * Süren ayda yüklenen liste kasa raporlarından kısa bir dönemi kapsıyorsa (engine listPeriod) dönemin adı ("1–15
   * Ekim"), o günlerin Z toplamı ve indirimi: liste ↔ POS kutusu onlarla karşılaştırır (açık gün ve ciro kasadan geldikçe)
   */
  listPeriod?: { label: string; posRevenue: number; discounts: number } | null;
  /** Türkiye saatine göre bu ay; açık gün açıklaması (devam eden ay / kapanmış ay) buna göre */
  currentMonth: string;
  /** Personelin bu ay panele girdiği ikram (Zayi & ikram): ödenmez tutarına öneri, ModPOS'un rakamı esas */
  /** Ayın kayıtlı ikramı (`lafpos`: geçiş gününden itibaren LafPOS'tan gelen satır sayısı, count'un içinde) */
  recordedIkram?: { count: number; menuValue: number; lafpos?: number };
  className?: string;
}) {
  const kasaValues = kasa?.values ?? null;
  const [modes, setModes] = useState<Record<MonthField, FieldMode>>(() => initialModes(info, kasaValues));
  const [texts, setTexts] = useState<Record<MonthField, string>>(() => ({
    openDays: fieldText("openDays", info.openDays),
    posRevenue: fieldText("posRevenue", info.posRevenue),
    discounts: fieldText("discounts", info.discounts),
    offRevenue: fieldText("offRevenue", info.offRevenue),
    cardShare: fieldText("cardShare", info.cardShare),
  }));
  const [note, setNote] = useState(info.note ?? "");
  const [busy, setBusy] = useState(false);
  const inputs = useRef<Partial<Record<MonthField, HTMLInputElement | null>>>({});

  const kasaOf = (f: MonthField) => kasaValues?.[f] ?? null;
  const payloadOf = (f: MonthField, m = modes, t = texts) => fieldPayload(f, { mode: m[f], text: t[f], kasa: kasaOf(f), manualBefore: info[f] !== null });
  const payloads = Object.fromEntries(MONTH_FIELDS.map((f) => [f, payloadOf(f)])) as Record<MonthField, number | null>;
  // Kaydedilmemiş değişiklik: gidecek değerler açılıştakinden farklı (dokunulup değiştirilmeyen kasa alanı sayılmaz)
  const snapshot = JSON.stringify([payloads, note.trim()]);
  const [saved, setSaved] = useState(snapshot);
  const dirty = snapshot !== saved;

  /** Alanın geçerli değeri (tutarlılık kutusu, "Bunu yaz"): yazılan ya da kasadaki */
  const effective = (f: MonthField) => effectiveValue(f, { mode: modes[f], text: texts[f], kasa: kasaOf(f), payload: payloads[f] });
  // Liste kasa raporlarından kısaysa listenin günleriyle (motorun kuralı: açık gün ve ciro kasadan gelirken)
  const byList = listPeriod && modes.posRevenue === "kasa" && modes.openDays === "kasa" ? listPeriod : null;
  const posNum = byList ? byList.posRevenue : effective("posRevenue");
  const discNum = (byList && modes.discounts === "kasa" ? byList.discounts : effective("discounts")) ?? 0;
  const diff = posNum !== null && listTotal ? listTotal - discNum - posNum : null;
  const consistent = diff !== null && Math.abs(diff) < 1000;
  const dim = daysInMonth(month);
  const phase = monthPhase(month, currentMonth);
  const elle = (f: MonthField) => modes[f] === "elle";
  const daysError = elle("openDays") ? openDaysProblem(texts.openDays, month) : null;
  const cardError = elle("cardShare") ? cardShareProblem(texts.cardShare) : null;
  /** Boş değil ama okunamayan tutar; ayın gün sayısından büyük açık gün; 0–100 dışında oran */
  const unreadable = (f: MonthField) => elle(f) && texts[f].trim() !== "" && fieldValue(f, texts[f]) === null;
  const bad = {
    pos: unreadable("posRevenue"),
    disc: unreadable("discounts"),
    off: unreadable("offRevenue"),
    days: daysError !== null,
    card: cardError !== null,
  };
  const invalid = bad.pos || bad.disc || bad.off || bad.days || bad.card;

  const setText = (f: MonthField, v: string) => setTexts((t) => ({ ...t, [f]: v }));
  /** Kasa kipindeki alana dokunuldu: elle kipine geçer, kasadaki değer dolu ve seçili (yazılan yerine geçer) */
  function takeOver(f: MonthField, typed?: string) {
    setModes((m) => ({ ...m, [f]: "elle" }));
    setText(f, typed ?? fieldText(f, kasaOf(f)));
    if (typed === undefined) requestAnimationFrame(() => inputs.current[f]?.select());
  }
  /** "Kasadakini kullan": alan kasa kipine döner */
  const backToKasa = (f: MonthField) => setModes((m) => ({ ...m, [f]: "kasa" }));
  /** Elle bir değer yazar (Tüm ay, Bunu yaz) */
  const write = (f: MonthField, text: string) => {
    setModes((m) => ({ ...m, [f]: "elle" }));
    setText(f, text);
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (invalid) return toast.error(daysError ?? cardError ?? "Tutarları kontrol edin (ör. 429.698 ya da 11.997,50)");
    setBusy(true);
    keepScroll();
    const res = await tryAction(() => saveMonthInfo({ month, ...payloads, note }));
    setBusy(false);
    // Atılan eylem (E-51): bildirim çıktı, yazılanlar yerinde
    if (!res) return;
    if (res.ok) {
      setSaved(snapshot);
      const msg = monthSavedToast(res.data, label);
      toast.success(msg.title, { description: msg.description });
    } else toast.error(res.error);
  }

  /** Kipin rozeti (etiket satırının sağında): kasa uygulanan alanda "Kasadan" / "Elle" */
  const chipOf = (f: MonthField) => (kasaOf(f) === null ? null : elle(f) ? <Badge tone="gray">Elle</Badge> : <Badge tone="blue">Kasadan</Badge>);
  /** Alanın altındaki satır: kasanın açıklaması (+ Kasadakini kullan), yoksa alanın kendi açıklaması */
  const hintOf = (f: MonthField, fallback?: ReactNode, extra?: ReactNode): ReactNode => {
    const k = kasaHint(f, kasa, modes[f], texts[f]);
    if (!k) return extra ? <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">{fallback ? <span>{fallback}</span> : null}{extra}</span> : fallback;
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className={elle(f) ? undefined : "text-info"}>{k}</span>
        {elle(f) ? (
          <button type="button" onClick={() => backToKasa(f)} className="cursor-pointer font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink pointer-coarse:min-h-11">
            Kasadakini kullan
          </button>
        ) : null}
        {extra}
      </span>
    );
  };
  /** Alanın kutusu: kasa kipinde salt okunur ve mavi; dokununca (tıklama, Enter, rakam) elle kipine geçer */
  const input = (f: MonthField, opts: { invalid: boolean; numeric?: boolean; placeholder?: string; filter?: (v: string) => string }) => {
    const kasaMode = !elle(f);
    return (
      <NumberInput
        id={INFO_IDS[f]}
        ref={(el) => {
          inputs.current[f] = el;
        }}
        value={kasaMode ? fieldText(f, kasaOf(f)) : texts[f]}
        readOnly={kasaMode}
        onClick={kasaMode ? () => takeOver(f) : undefined}
        onKeyDown={
          kasaMode
            ? (e) => {
                if (e.metaKey || e.ctrlKey || e.altKey) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  takeOver(f);
                } else if (e.key === "Backspace" || e.key === "Delete") {
                  e.preventDefault();
                  takeOver(f, "");
                } else if (/^[\d,.%]$/.test(e.key)) {
                  e.preventDefault();
                  takeOver(f, e.key);
                }
              }
            : undefined
        }
        onChange={kasaMode ? undefined : (e) => setText(f, opts.filter ? opts.filter(e.target.value) : e.target.value)}
        inputMode={opts.numeric ? "numeric" : "decimal"}
        placeholder={opts.placeholder}
        aria-invalid={opts.invalid || undefined}
        aria-description={kasaMode ? "Kasa raporlarından; değiştirmek için dokunun" : undefined}
        className={cn(opts.invalid ? undefined : "cell-input", kasaMode && "cursor-pointer bg-info-soft text-info ring-info/25")}
      />
    );
  };

  const t = kasa?.till ?? null;
  const strip = !t ? null : t.partialFrom ? (
    { tone: "warn" as const, text: partialSentence(t), link: false }
  ) : t.missing.length || t.closed?.length ? (
    { tone: t.missing.length ? ("warn" as const) : ("info" as const), text: missingSentence(t), link: true }
  ) : (
    {
      tone: "info" as const,
      text: `Kasa raporları: ${num(t.reported)} gün raporlu (son: ${dayMonthTR(t.lastDate)}). Boş bıraktığınız alanlar her raporla kendiliğinden dolar.`,
      link: false,
    }
  );
  const offValue = effective("offRevenue") ?? 0;

  return (
    <Card className={className}>
      <CardHeader
        icon={<CalendarDays />}
        title={`${label} bilgileri`}
        description="Patron > Raporlar > Ciro ekranından ya da kasa raporlarından. Gelir-gider tablosu bu ciroyu kullanır."
      />
      <CardContent className="flex flex-1 flex-col">
        {/* Telefonda tek sütun ve 48px alanlar */}
        <form onSubmit={save} className={cn("flex flex-1 flex-col gap-3", BIG_FIELDS)}>
          {strip ? (
            <div
              role="status"
              className={cn("flex items-start gap-2.5 rounded-2xl px-3 py-2.5 text-xs leading-5", strip.tone === "warn" ? "bg-warn-soft text-warn" : "bg-info-soft text-info")}
            >
              {strip.tone === "warn" ? <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> : <Info size={15} className="mt-0.5 shrink-0" aria-hidden="true" />}
              <p className="min-w-0">
                {strip.text}
                {strip.link ? (
                  <>
                    {" "}
                    <Link href={`/panel/kasa?ay=${month}`} className="font-semibold underline underline-offset-2 pointer-coarse:inline-block pointer-coarse:py-1">
                      Kasa raporuna git
                    </Link>
                  </>
                ) : null}
              </p>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="POS ciro, KDV dahil (₺)"
              aside={chipOf("posRevenue")}
              tip="İndirimler düşülmüş, ödenmezler hariç"
              htmlFor="m-pos"
              error={bad.pos ? "Sayı girin" : undefined}
              hint={hintOf("posRevenue")}
            >
              {input("posRevenue", { invalid: bad.pos, placeholder: "0" })}
            </Field>
            <Field
              label="Açık gün sayısı"
              aside={chipOf("openDays")}
              tip={
                <>
                  Sabit giderler açık gün ÷ ayın gün sayısı oranıyla bölünür (Excel Genel Maliyet, 2. satır). Devam eden ayda bu sayı
                  &quot;bugüne kadar geçen gün&quot; olarak da kullanılır: Genel bakış&apos;taki ay sonu tahmini POS cirosu ÷ açık gün × ayın
                  gün sayısıdır. Ay bitince gerçek açık gün sayısını yazın; kapanmış aylarda tahmin yapılmaz. Kasa raporu girilen aylarda boşsa
                  rapor girilen (satış olan) gün sayılır; o aylarda kira ve maaş gibi aylık giderler ayın geçen takvim günüyle bölünür,
                  kapalı bir gün onları düşürmez.
                </>
              }
              htmlFor="m-days"
              // Hata çıktığında da "Tüm ay" tek tık düzeltmesi görünür kalır (ör. Eylül'e 31 yazıldı)
              error={
                daysError ? (
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span>{daysError}</span>
                    {phase !== "running" ? <AllMonthButton dim={dim} onPick={() => write("openDays", String(dim))} /> : null}
                  </span>
                ) : undefined
              }
              hint={hintOf(
                "openDays",
                openDaysHint(texts.openDays, month, currentMonth),
                phase !== "running" && (elle("openDays") ? texts.openDays.trim() : fieldText("openDays", kasaOf("openDays"))) !== String(dim) ? (
                  <AllMonthButton dim={dim} onPick={() => write("openDays", String(dim))} />
                ) : null,
              )}
            >
              {input("openDays", {
                invalid: bad.days,
                numeric: true,
                placeholder: phase === "running" ? "bugüne kadar" : `ör. ${dim}`,
                filter: (v) => v.replace(/\D/g, "").slice(0, 2),
              })}
            </Field>
            <Field
              label="Yönetici indirimleri (₺)"
              aside={chipOf("discounts")}
              tip="KDV dahil (Patron > İndirim)"
              htmlFor="m-disc"
              error={bad.disc ? "Sayı girin" : undefined}
              hint={hintOf("discounts")}
            >
              {input("discounts", { invalid: bad.disc })}
            </Field>
            <Field
              label="Ödenmez / ikram (₺)"
              aside={chipOf("offRevenue")}
              tip="Ciro dışı: malzemesi harcanan, geliri olmayan satışlar"
              htmlFor="m-off"
              error={bad.off ? "Sayı girin" : undefined}
              hint={hintOf(
                "offRevenue",
                undefined,
                recordedIkram?.count ? (
                  <span>
                    {recordedIkram.lafpos ? "Kayıtlı ikram (LafPOS dahil)" : "Panelde kayıtlı ikram"}: {num(recordedIkram.count)} kayıt, menü fiyatıyla {tl(recordedIkram.menuValue)}.{" "}
                    {Math.abs(offValue - recordedIkram.menuValue) >= 1 ? (
                      <button
                        type="button"
                        className="cursor-pointer font-medium text-ink-soft underline underline-offset-2 hover:text-ink"
                        onClick={() => write("offRevenue", num(recordedIkram.menuValue, 2))}
                      >
                        Bunu yaz
                      </button>
                    ) : null}
                  </span>
                ) : null,
              )}
            >
              {input("offRevenue", { invalid: bad.off })}
            </Field>
            <Field
              label="Kartlı satış oranı (%)"
              aside={chipOf("cardShare")}
              tip="Kredi kartı + yemek kartı ÷ Z toplamı. POS komisyonu = ciro × komisyon × bu oran."
              htmlFor="m-card"
              error={cardError ?? undefined}
              hint={hintOf("cardShare", kasaOf("cardShare") === null && !texts.cardShare.trim() ? "Boşsa Ayarlar'daki oran kullanılır" : undefined)}
            >
              {input("cardShare", { invalid: bad.card, placeholder: `Ayarlar: ${num(settingsCardShare * 100, 1)}` })}
            </Field>
          </div>
          <Field label="Not" htmlFor="m-note">
            <Textarea id="m-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="max-h-48 min-h-16 [field-sizing:content]" />
          </Field>
          {diff !== null ? (
            <div
              className={cn(
                "flex items-start gap-2.5 rounded-2xl px-3 py-2.5 text-xs leading-5",
                consistent ? "bg-good-soft text-good" : "bg-warn-soft text-warn",
              )}
              role="status"
            >
              {consistent ? (
                <CircleCheck size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              ) : (
                <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              )}
              <p className="tabular">
                <span className="font-semibold">{consistent ? "Tutarlı" : "Kontrol edin"}:</span> ürün listesi{byList ? ` (${byList.label})` : ""} {tl(listTotal)} −
                indirim {tl(discNum)} = {tl(listTotal - discNum)} · {byList ? `${byList.label} POS cirosu` : "POS cirosu"} ile fark {tl(diff)}
              </p>
            </div>
          ) : null}
          <div className="mt-auto flex flex-wrap items-center justify-end gap-3 pt-1">
            {dirty ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-ink-mute">
                <span className="size-1.5 rounded-full bg-warn" aria-hidden="true" />
                Kaydedilmemiş değişiklik var
              </span>
            ) : null}
            <Button type="submit" variant={dirty ? "primary" : "secondary"} disabled={busy} className="max-sm:min-h-12 max-sm:w-full">
              {busy ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- Satış tablosu

type RowStatus = "service" | "matched" | "unmatched";

function rowStatus(r: SalesRow): RowStatus {
  return r.isService ? "service" : r.matched ? "matched" : "unmatched";
}

/** Adresteki ?durum= değerleri (bildirimdeki bağlantı ?durum=eslesmeyen kullanır) */
type StatusFilter = "tumu" | "eslesmeyen" | "eslesen" | "hizmet";
const FILTER_STATUS: Record<Exclude<StatusFilter, "tumu">, RowStatus> = { eslesmeyen: "unmatched", eslesen: "matched", hizmet: "service" };
const FILTER_LABEL: Record<Exclude<StatusFilter, "tumu">, string> = { eslesmeyen: "Eşleşmeyen", eslesen: "Eşleşen", hizmet: "Hizmet" };
/** "Temizle" düğmesinin sıfırladığı adres anahtarları (sıralama ve ay korunur) */
const FILTER_KEYS = ["ara", "durum"];

type SortKey = "ad" | "adet" | "ciro" | "maliyet" | "kom" | "kar" | "marj";
const COMPARE: Record<SortKey, (a: SalesRow, b: SalesRow) => number> = {
  ad: (a, b) => a.posName.localeCompare(b.posName, "tr"),
  adet: (a, b) => a.qty - b.qty,
  ciro: (a, b) => a.revenue - b.revenue,
  maliyet: (a, b) => a.cost - b.cost,
  kom: (a, b) => a.commission - b.commission,
  kar: (a, b) => a.grossProfit - b.grossProfit,
  marj: (a, b) => a.margin - b.margin,
};
/** Varsayılan: rapordaki sıra (içe aktarılan dosyadaki gibi) */
const REPORT_ORDER = "rapor";
const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: REPORT_ORDER, label: "Rapor sırası" },
  { value: "ciro-azalan", label: "Ciro: yüksekten düşüğe" },
  { value: "kar-azalan", label: "Brüt kâr: yüksekten düşüğe" },
  { value: "kar-artan", label: "Brüt kâr: düşükten yükseğe" },
  { value: "marj-artan", label: "Marj: düşükten yükseğe" },
  { value: "marj-azalan", label: "Marj: yüksekten düşüğe" },
  { value: "adet-azalan", label: "Adet: çoktan aza" },
  { value: "maliyet-azalan", label: "Maliyet: yüksekten düşüğe" },
  { value: "ad-artan", label: "Ad: A → Z" },
];

/** ?sirala=ciro-azalan -> { key: "ciro", dir: "desc" }; tanınmayan değer rapor sırası */
function parseSort(v: string): { key: SortKey; dir: "asc" | "desc" } | null {
  const [k, d] = v.split("-");
  if (!(k in COMPARE)) return null;
  return { key: k as SortKey, dir: d === "artan" ? "asc" : "desc" };
}

/**
 * Satır içi eşleşme düğmesi: masaüstünde 32px, dokunmatikte 40px. 160px'te kesilir (tablo 1280px ekranda
 * yatay kaymadan sığsın); uzun adda kesilen ürün adıdır, boy (· M / · L) her zaman görünür.
 */
const MATCH_BTN =
  "inline-flex h-8 max-w-40 cursor-pointer items-center gap-1.5 rounded-[10px] px-2.5 text-left text-[13px] font-medium transition-colors pointer-coarse:h-11 " +
  // Telefondaki kartta tam genişliğe kadar uzar, uzun ad alt satıra geçer (kesilmez)
  "max-md:h-auto max-md:min-h-11 max-md:max-w-full max-md:py-2";

const MATCH_TONE = {
  matched: "bg-surface text-ink ring-1 ring-inset ring-line-strong hover:ring-ink/25",
  unmatched: "bg-warn-soft text-warn ring-1 ring-inset ring-warn/25 hover:ring-warn/50",
  service: "bg-info-soft text-info ring-1 ring-inset ring-info/20 hover:ring-info/40",
} as const;

type Totals = { qty: number; revenue: number; net: number; cost: number; commission: number; grossProfit: number; margin: number };
type Optimistic =
  | { kind: "match"; id: number; productId: number | null; isService: boolean; label: string | null; noRecipe: boolean }
  | { kind: "delete"; id: number };

/** Tablo başlığı: kalın ad + altında küçük birim/açıklama satırı (sütunlar dar kalsın, birim görünsün) */
function HeadLabel({ children, sub, wrap }: { children: ReactNode; sub?: string; wrap?: boolean }) {
  return (
    <>
      {children}
      {sub ? <span className={cn("block text-xs font-normal text-ink-mute", wrap && "whitespace-normal")}>{sub}</span> : null}
    </>
  );
}

/** Ürün adı kesilebilir, boyu kesilmez ("Ice White Choc. Mo… · M"); telefondaki kartta ad alt satıra geçer */
function NameSize({ name, size }: { name: string; size?: string }) {
  return (
    <>
      <span className="truncate max-md:whitespace-normal max-md:break-words">{name}</span>
      {size ? <span className="-ml-1 shrink-0">· {size}</span> : null}
    </>
  );
}

/**
 * Kâr marjı (Excel Satış Raporu J sütunu, 0,0%) ve üç renkli ölçek: ayın en düşük marjı kırmızı, ortancası
 * sarı, en yükseği yeşil. Ölçeğe yalnızca reçeteli ürüne bağlı satırlar girer; HİZMET ve eşleşmeyen
 * (maliyeti tahmini) satırlar renksiz gösterilir.
 */
function MarginPill({ row, scale }: { row: SalesRow; scale: MarginScale | null }) {
  const colored = scale && inMarginScale(row);
  const level = colored ? marginLevelLabel(row.margin, scale) : null;
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-lg px-1.5 text-[13px] font-medium tabular",
        colored ? "text-ink" : "text-ink-mute",
        !colored && "ring-1 ring-inset ring-line-strong",
        row.grossProfit < 0 && "text-bad",
      )}
      style={colored ? { backgroundColor: marginColor(row.margin, scale) } : undefined}
      title={
        row.isService
          ? "HİZMET: maliyetsiz"
          : !row.matched
            ? "Maliyet tahmini (ortalama oran); ölçeğe girmez"
            : row.noRecipe
              ? "Ürünün reçetesi boş: maliyet tahmini (ortalama oran); ölçeğe girmez"
              : (level ?? undefined)
      }
    >
      {pct(row.margin, 1)}
      {level ? <span className="sr-only"> · {level}</span> : null}
    </span>
  );
}

export function SalesTable({
  rows: serverRows,
  products,
  mappings,
  month,
  lafposMonth = false,
  totals,
}: {
  rows: SalesRow[];
  products: ProductOption[];
  /** POS adı hafızası (Satır ekle penceresinde "otomatik bağlanacak" ipucu için) */
  mappings: MappingLite[];
  month: string;
  /** Ayın tamamı LafPOS'tan (geçiş gününden sonra): elle ModPOS satırı eklenmez */
  lafposMonth?: boolean;
  totals: Totals;
}) {
  const reduce = useCalmMotion();
  // Sayfadaki her eylem (eşleştirme, ay bilgisi, içe aktarma…) yenilemeyle yeni satır dizisi getirir
  useSettleScroll(serverRows);
  // Eşleştirme ve silme sunucu yanıtını beklemeden görünür; hata olursa satır eski haline döner
  // Eylem atarsa (ağ kesildi, panel güncellendi; E-51) iyimser satır geri döner ve bildirim çıkar
  const [, startTransition] = useActionTransition();
  const [rows, applyOptimistic] = useOptimistic(serverRows, (state: SalesRow[], a: Optimistic) =>
    a.kind === "delete"
      ? state.filter((r) => r.id !== a.id)
      : state.map((r) =>
          r.id === a.id
            ? { ...r, productId: a.productId, isService: a.isService, matched: !!a.productId && !a.isService, noRecipe: a.noRecipe, productLabel: a.label }
            : r,
        ),
  );
  const [rawFilter, setFilter] = useQueryState<string>("durum", "tumu");
  const [q, setQ] = useQueryText("ara");
  const [rawSort, setSort] = useQueryState<string>("sirala", REPORT_ORDER);
  const filter: StatusFilter = rawFilter in FILTER_STATUS ? (rawFilter as StatusFilter) : "tumu";
  const sort = parseSort(rawSort);
  const [picking, setPicking] = useState<SalesRow | null>(null);
  const [editing, setEditing] = useState<Partial<SalesRow> | null>(null);
  const [deleting, setDeleting] = useState<SalesRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const scale = useMemo(() => marginScale(serverRows.filter(inMarginScale).map((r) => r.margin)), [serverRows]);
  const suggestions = useMemo(() => collectSuggestions(rows, products), [rows, products]);
  /** Rapora yanlışlıkla girmiş toplam satırları ("TOPLAM 2.543 441.955"): ciroyu iki kez sayar (yalnız ModPOS listesi) */
  const summaryRows = rows.filter((r) => r.lafposDays === null && isSummaryRow(r.posName));
  const hasLafpos = rows.some((r) => r.lafposDays !== null);

  // Durum çiplerinin sayaçları aramaya göre (arama yazılıyken "kaç eşleşmeyen var" görünsün)
  const searched = rows.filter((r) => matches(`${r.posName} ${r.productLabel ?? ""} ${r.note ?? ""}`, q));
  const counts = {
    unmatched: searched.filter((r) => rowStatus(r) === "unmatched").length,
    matched: searched.filter((r) => rowStatus(r) === "matched").length,
    service: searched.filter((r) => rowStatus(r) === "service").length,
  };
  const totalUnmatched = rows.filter((r) => rowStatus(r) === "unmatched").length;
  const byStatus = filter === "tumu" ? searched : searched.filter((r) => rowStatus(r) === FILTER_STATUS[filter]);
  // Sıralama kararlı: eşit değerlerde rapor sırası korunur
  const visible = sort ? [...byStatus].sort((a, b) => (sort.dir === "asc" ? 1 : -1) * COMPARE[sort.key](a, b)) : byStatus;
  const paged = usePaged(visible, 25, `${month}|${filter}|${q}|${rawSort}`);
  const anyFilter = filter !== "tumu" || Boolean(q.trim());
  const sum = (f: (r: SalesRow) => number) => visible.reduce((a, r) => a + f(r), 0);
  // Süzgeç yokken sunucunun ay toplamı; varsa görünen satırların toplamı
  const shownTotals: Totals = anyFilter
    ? (() => {
        const net = sum((r) => r.net);
        const grossProfit = sum((r) => r.grossProfit);
        return {
          qty: sum((r) => r.qty),
          revenue: sum((r) => r.revenue),
          net,
          cost: sum((r) => r.cost),
          commission: sum((r) => r.commission),
          grossProfit,
          margin: net ? grossProfit / net : 0,
        };
      })()
    : totals;
  const totalsLabel = anyFilter ? `Süzülen ${num(visible.length)} satır` : "Ay toplamı";

  const toggleFilter = (f: StatusFilter) => setFilter(filter === f ? "tumu" : f);
  // Sayısal sütun: azalan → artan → rapor sırası; ad: A→Z → Z→A → rapor sırası
  const toggleSort = (key: SortKey) => {
    const first = key === "ad" ? "asc" : "desc";
    if (!sort || sort.key !== key) return setSort(`${key}-${first === "asc" ? "artan" : "azalan"}`);
    if (sort.dir === first) return setSort(`${key}-${first === "asc" ? "azalan" : "artan"}`);
    setSort(REPORT_ORDER);
  };
  const dirOf = (key: SortKey) => (sort?.key === key ? sort.dir : null);
  const sortValue = sort ? `${sort.key}-${sort.dir === "asc" ? "artan" : "azalan"}` : REPORT_ORDER;

  const clearFilters = () => {
    setQ("");
    clearQuery(FILTER_KEYS);
  };
  // Telefon: etkin süzgeçler çip olarak, seçimler alt sayfada
  const [sheetOpen, setSheetOpen] = useState(false);
  const chips: ActiveFilter[] = [];
  if (filter !== "tumu") chips.push({ key: "durum", label: FILTER_LABEL[filter], onRemove: () => setFilter("tumu") });
  if (sortValue !== REPORT_ORDER) {
    chips.push({ key: "sirala", label: SORT_OPTIONS.find((o) => o.value === sortValue)?.label ?? "Özel sıra", onRemove: () => setSort(REPORT_ORDER) });
  }

  /** Sayfa değişince listenin başına dön (alttaki sayfalamadan tıklanınca yeni sayfanın sonunda kalınmasın) */
  const toPage = (p: number) => {
    paged.setPage(p);
    const el = document.getElementById("satirlar");
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  };

  function pick(row: SalesRow, v: { productId: number | null; isService: boolean }) {
    setPicking(null);
    const p = v.productId ? productById.get(v.productId) : undefined;
    keepScroll();
    startTransition(async () => {
      // Reçetesi boş ürün (maliyeti 0): sunucu yanıtına kadar da tahmini maliyetli satır gibi görünsün
      applyOptimistic({ kind: "match", id: row.id, ...v, label: p ? `${p.name} · ${p.size}` : null, noRecipe: !!p && !v.isService && !(p.cost > 0) });
      if (row.lafposDays !== null) {
        // LafPOS satırı: bu ay toplamının satırları, o ayın aynı adlı ürünsüz satırları ve ad hafızası (başka aylardaki
        // ürünsüz satırlar da bağlanır; aynı adın başka ürüne bağlı satırı değişmez)
        const res = await matchLafposName({
          month,
          posName: row.posName,
          productId: v.productId,
          isService: v.isService,
          current: { productId: row.productId, isService: row.isService },
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(v.isService ? "HİZMET olarak işaretlendi" : v.productId ? "Eşleştirildi" : "Eşleşme kaldırıldı", {
          description:
            v.productId || v.isService
              ? `“${row.posName}” bu ayın LafPOS satırlarına uygulandı; sonraki gün sonlarında otomatik tanınacak.`
              : `“${row.posName}” bu ayın LafPOS satırlarında ürünsüz kaldı ve hafızadan silindi.`,
        });
        return;
      }
      const res = await setLineMatch(row.id, v.productId, v.isService);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const others = res.data.others ? ` Aynı adlı ${num(res.data.others)} satır daha bağlandı.` : "";
      toast.success(v.isService ? "HİZMET olarak işaretlendi" : v.productId ? "Eşleştirildi" : "Eşleşme kaldırıldı", {
        description:
          v.productId || v.isService
            ? `“${row.posName}” sonraki aylarda otomatik tanınacak.${others}`
            : `“${row.posName}” hafızadan da silindi; sonraki raporlarda eşleşmemiş gelir.`,
      });
    });
  }

  function remove() {
    const target = deleting;
    if (!target) return;
    setDeleting(null);
    keepScroll();
    startTransition(async () => {
      applyOptimistic({ kind: "delete", id: target.id });
      const res = await deleteLine(target.id);
      if (!res.ok) toast.error(res.error);
      else toast.success("Satır silindi", { description: `${target.posName} · ${num(target.qty)} adet` });
    });
  }

  async function applySuggestions() {
    setBulkBusy(true);
    keepScroll();
    // ModPOS satırları satır kimliğiyle, LafPOS'un ay toplamları POS adıyla (iki ayrı eylem)
    const modpos = suggestions.filter((x) => x.row.lafposDays === null);
    const laf = suggestions.filter((x) => x.row.lafposDays !== null);
    const results = await tryAction(async () =>
      [
        modpos.length ? await applyLineMatches(month, modpos.map((x) => ({ lineId: x.row.id, productId: x.product.id }))) : null,
        laf.length ? await applyLafposMatches(month, laf.map((x) => ({ posName: x.row.posName, productId: x.product.id }))) : null,
      ].filter((r) => r !== null),
    );
    setBulkBusy(false);
    // Atılan eylem: pencere açık kalır, yeniden denenir
    if (!results) return;
    setBulkOpen(false);
    const done = results.flatMap((r) => (r.ok ? [r.data] : []));
    const failed = results.find((r) => !r.ok);
    if (!done.length) return toast.error(failed && !failed.ok ? failed.error : "Öneriler uygulanamadı");
    const applied = done.reduce((a, d) => a + d.applied, 0);
    const skipped = done.reduce((a, d) => a + d.skipped, 0);
    toast.success(`${num(applied)} öneri uygulandı`, {
      description: skipped ? `${num(skipped)} satır bu arada değişmiş, atlandı.` : "Bu adlar sonraki aylarda otomatik tanınacak.",
    });
    if (failed && !failed.ok) toast.error(failed.error);
  }

  /** Eşleşme düğmesi + (varsa) tek tıkla uygulanan değnekli öneri */
  const matchCell = (r: SalesRow) => {
    const status = rowStatus(r);
    const suggestion = status === "unmatched" ? suggestProduct(r.posName, products) : null;
    const product = status === "matched" && r.productId ? productById.get(r.productId) : undefined;
    return (
      <>
        <button
          type="button"
          onClick={() => setPicking(r)}
          className={cn(MATCH_BTN, MATCH_TONE[status])}
          title={status === "matched" && r.productLabel ? `${r.productLabel} · değiştirmek için tıklayın` : "Ürünle eşleştir"}
        >
          {status === "service" ? (
            <span className="truncate">HİZMET</span>
          ) : product ? (
            <NameSize name={product.name} size={product.size} />
          ) : (
            <span className="truncate">{r.productLabel ?? "Eşleşmedi — seç"}</span>
          )}
          <ChevronDown size={14} className="shrink-0 opacity-60" aria-hidden="true" />
        </button>
        {suggestion ? (
          <button
            type="button"
            className={cn(MATCH_BTN, "bg-lime/25 text-good-ink hover:bg-lime/45")}
            onClick={() => pick(r, { productId: suggestion.id, isService: false })}
            title={`Önerilen eşleşmeyi uygula: ${suggestion.name} · ${suggestion.size}`}
          >
            <Wand2 size={13} className="shrink-0" aria-hidden="true" />
            <span className="sr-only">Önerilen eşleşmeyi uygula: </span>
            <NameSize name={suggestion.name} size={suggestion.size} />
          </button>
        ) : null}
      </>
    );
  };

  // LafPOS'un ay toplamı salt okunur: düzenleme ve silme yok (gün sonu LafPOS'ta düzeltilip yeniden gönderilir)
  const rowActions = (r: SalesRow, coarse?: boolean) =>
    r.lafposDays !== null ? null : (
      <>
        <IconButton label="Düzenle" onClick={() => setEditing(r)} className={coarse ? "pointer-coarse:size-11" : undefined}>
          <Pencil size={15} />
        </IconButton>
        <IconButton label="Sil" tone="danger" onClick={() => setDeleting(r)} className={coarse ? "pointer-coarse:size-11" : undefined}>
          <Trash2 size={15} />
        </IconButton>
      </>
    );
  /** LafPOS satırının kaynağı (adın altında) */
  const lafposNote = (r: SalesRow) =>
    r.lafposDays !== null ? (
      <p className="flex items-center gap-1 text-xs text-info" title="LafPOS'un gün sonlarından, ay toplamı; salt okunur">
        <Store size={12} className="shrink-0" aria-hidden="true" />
        LafPOS · {num(r.lafposDays)} gün
      </p>
    ) : null;

  return (
    // Telefonda üstteki sabit çubuğun (--mobile-top-h) altında kalmasın
    <Card id="satirlar" className="scroll-mt-[calc(var(--mobile-top-h)+1.5rem)]">
      <CardHeader
        icon={<ListChecks />}
        title="Satış satırları"
        description={
          hasLafpos
            ? "Eşleşmeyen satırlara menüden ürün seçin; seçim hatırlanır ve otomatik uygulanır. LafPOS satırları salt okunur."
            : "Eşleşmeyen satırlara menüden ürün seçin; seçim hatırlanır ve sonraki aylarda otomatik uygulanır."
        }
        meta={
          rows.length ? (
            totalUnmatched ? (
              <button
                type="button"
                onClick={() => toggleFilter("eslesmeyen")}
                className="inline-flex cursor-pointer items-center gap-1.5 underline-offset-2 hover:underline pointer-coarse:min-h-11"
                aria-live="polite"
              >
                <span>Eşleşmeyen</span>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-warn tabular">
                  <CountUp value={totalUnmatched} kind="num" />
                </span>
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-good" aria-live="polite">
                <CircleCheck size={14} aria-hidden="true" /> Tüm satırlar eşleşti
              </span>
            )
          ) : null
        }
        actions={
          <>
            {suggestions.length ? (
              <Button size="sm" variant="accent" onClick={() => setBulkOpen(true)} className="pointer-coarse:h-11">
                <Wand2 size={15} /> {num(suggestions.length)} öneriyi uygula
              </Button>
            ) : null}
            {/* Asıl yol içe aktarma; elle satır ikincil eylem (LafPOS ayında yok: satırlar gün sonlarından) */}
            {lafposMonth ? null : (
              <Button size="sm" variant="secondary" onClick={() => setEditing({ posName: "", qty: 1, revenue: 0 })} className="pointer-coarse:h-11">
                <Plus size={16} /> Satır ekle
              </Button>
            )}
          </>
        }
      />
      {summaryRows.length ? (
        <div className="mx-5 mb-3 flex items-start gap-2.5 rounded-2xl bg-bad-soft px-3 py-2.5 text-[13px] leading-5 text-bad" role="alert">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p>
              <span className="font-semibold">Listede toplam satırı var:</span> ürün gibi sayıldığı için ay cirosu ve kâr iki kat görünür. Silin.
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-2">
              {summaryRows.map((r) => (
                <li key={r.id}>
                  <Button size="sm" variant="secondary" onClick={() => setDeleting(r)} className="text-bad pointer-coarse:h-11">
                    <Trash2 size={14} /> {r.posName} · {tl(r.revenue)}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {rows.length ? (
        // Telefon: arama + "Süzgeç" düğmesi (durum ve sıralama alt sayfada)
        <div role="search" className="space-y-2.5 px-4 pb-3 md:hidden">
          <div className="flex items-center gap-2">
            <SearchField value={q} onChange={setQ} placeholder="Satır ara" label="Satırlarda ara: POS adı, ürün ya da not" shortcut={false} className="flex-1 [&_input]:h-11" />
            <FilterButton count={chips.length} onClick={() => setSheetOpen(true)} />
          </div>
          <ActiveFilters items={chips} />
          <p className="text-[13px] text-ink-mute tabular" aria-live="polite">
            {anyFilter ? (
              <>
                <span className="font-semibold text-ink">{num(visible.length)}</span> / {num(rows.length)} satır
              </>
            ) : (
              `${num(rows.length)} satır`
            )}
          </p>
        </div>
      ) : null}
      <Dialog
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Süzgeç ve sıralama"
        description={`${num(visible.length)} / ${num(rows.length)} satır gösteriliyor`}
        footer={
          <>
            <Button
              variant="ghost"
              className={SHEET_BTN}
              disabled={!chips.length && !q.trim()}
              onClick={() => {
                setQ("");
                clearQuery([...FILTER_KEYS, "sirala"]);
              }}
            >
              Temizle
            </Button>
            <Button className={SHEET_BTN} onClick={() => setSheetOpen(false)}>
              {visible.length ? `${num(visible.length)} satırı göster` : "Kapat"}
            </Button>
          </>
        }
      >
        <div className="space-y-4 pb-2 max-sm:[&_select]:h-12">
          <ChoiceList<StatusFilter>
            label="Eşleşme durumu"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "tumu", label: "Tümü", count: searched.length },
              { value: "eslesmeyen", label: "Eşleşmeyen", count: counts.unmatched },
              { value: "eslesen", label: "Eşleşen", count: counts.matched },
              { value: "hizmet", label: "Hizmet", count: counts.service },
            ]}
          />
          <Field label="Sıralama" htmlFor="s-m-sort">
            <Select id="s-m-sort" value={sortValue} onChange={(e) => setSort(e.target.value)}>
              {SORT_OPTIONS.some((o) => o.value === sortValue) ? null : <option value={sortValue}>Özel</option>}
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Dialog>
      {rows.length ? (
        <FilterBar active={anyFilter} onClear={clearFilters} shown={visible.length} total={rows.length} unit="satır" className="px-5 pb-3 max-md:hidden">
          <SearchField value={q} onChange={setQ} placeholder="POS adı, ürün ya da not ara" label="Satırlarda ara" className="w-full sm:w-72" />
          <FilterChip active={filter === "eslesmeyen"} onToggle={() => toggleFilter("eslesmeyen")} count={counts.unmatched}>
            Eşleşmeyen
          </FilterChip>
          <FilterChip active={filter === "eslesen"} onToggle={() => toggleFilter("eslesen")} count={counts.matched}>
            Eşleşen
          </FilterChip>
          <FilterChip active={filter === "hizmet"} onToggle={() => toggleFilter("hizmet")} count={counts.service}>
            Hizmet
          </FilterChip>
        </FilterBar>
      ) : null}

      {visible.length ? (
        <>
          {/* Telefon: kart listesi (geniş tablo 375px'te yalnız iki sütun gösterirdi) */}
          <ul className="divide-y divide-line-strong/70 border-t border-line md:hidden">
            {paged.slice.map((r) => {
              const status = rowStatus(r);
              const priceGap = r.menuPrice && r.avgPrice ? r.avgPrice / r.menuPrice - 1 : 0;
              return (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium break-words text-ink">{r.posName}</p>
                      {lafposNote(r)}
                      <p className="mt-0.5 text-[13px] text-ink-mute tabular">
                        {num(r.qty)} adet · {tl(r.revenue)}
                      </p>
                      {Math.abs(priceGap) > 0.03 ? (
                        <p className="text-xs text-warn tabular">
                          ort. {tl(r.avgPrice)} · menüden {priceGap > 0 ? "+" : ""}
                          {pct(priceGap, 0)}
                        </p>
                      ) : null}
                      {r.note ? <p className="text-xs break-words text-ink-mute">{r.note}</p> : null}
                    </div>
                    <div className="shrink-0 text-right tabular">
                      <p className={cn("font-semibold", r.grossProfit < 0 ? "text-bad" : "text-ink")}>{tl(r.grossProfit)}</p>
                      <p className="mt-0.5 flex items-center justify-end gap-1.5 text-xs text-ink-mute">
                        brüt kâr <MarginPill row={r} scale={scale} />
                      </p>
                      <p className={cn("text-xs", status === "unmatched" || r.noRecipe ? "text-warn" : "text-ink-mute")}>
                        maliyet {tl(r.cost)}
                        {status === "unmatched" ? " (tahmini)" : r.noRecipe ? " (tahmini, reçete boş)" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-start gap-2">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{matchCell(r)}</div>
                    <div className="flex shrink-0 gap-1.5">{rowActions(r, true)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line-strong px-5 py-3 text-sm font-semibold md:hidden">
            <span>
              {totalsLabel}
              <span className="block text-xs font-normal text-ink-mute tabular">
                {num(shownTotals.qty)} adet · {tl(shownTotals.revenue)}
              </span>
            </span>
            <span className="text-right tabular">
              <span className={cn(shownTotals.grossProfit < 0 && "text-bad")}>{tl(shownTotals.grossProfit)}</span>
              <span className="block text-xs font-normal text-ink-mute">brüt kâr · marj {pct(shownTotals.margin, 1)}</span>
            </span>
          </div>

          <TableWrap className="max-md:hidden">
            <Table>
              <THead>
                <tr>
                  <TH sticky>
                    <SortButton dir={dirOf("ad")} onClick={() => toggleSort("ad")}>
                      POS ürün adı
                    </SortButton>
                  </TH>
                  <TH>
                    <span className="inline-flex items-center gap-1.5">
                      Eşleşen ürün
                      <InfoTip text="Tıklayıp menüdeki ürünü seçin. HİZMET = karaoke gibi maliyetsiz satış. Değnekli öneri, adı birebir tutan ürünü tek tıkla uygular." />
                    </span>
                  </TH>
                  <TH numeric>
                    <SortButton numeric dir={dirOf("adet")} onClick={() => toggleSort("adet")}>
                      Adet
                    </SortButton>
                  </TH>
                  <TH numeric>
                    <HeadLabel sub="KDV dahil">
                      <span className="inline-flex items-center gap-1.5">
                        <InfoTip text="Altında KDV hariç net ciro. Ortalama satış fiyatı menü fiyatından %3'ten fazla saparsa uyarı görünür." />
                        <SortButton numeric dir={dirOf("ciro")} onClick={() => toggleSort("ciro")}>
                          Ciro
                        </SortButton>
                      </span>
                    </HeadLabel>
                  </TH>
                  <TH numeric>
                    <HeadLabel sub="malzeme + ambalaj" wrap>
                      <span className="inline-flex items-center gap-1.5">
                        <InfoTip text="Eşleşenlerde adet × birim maliyet; eşleşmeyenlerde ve reçetesi boş ürüne bağlı satırlarda net ciro × ortalama maliyet oranı (turuncu, tahmini). Birim maliyet bugünkü reçete ve hammadde fiyatlarıyla hesaplanır (Excel'deki gibi): geçmiş bir ayda da bugünün maliyetidir. Gelir-gider'in mal maliyeti faturalardan ve ay sonu sayımından gelir, sonraki zamla değişmez." />
                        <SortButton numeric dir={dirOf("maliyet")} onClick={() => toggleSort("maliyet")}>
                          Maliyet
                        </SortButton>
                      </span>
                    </HeadLabel>
                  </TH>
                  <TH numeric title="POS (kart) komisyonu">
                    <HeadLabel sub="POS kartı">
                      <SortButton numeric dir={dirOf("kom")} onClick={() => toggleSort("kom")}>
                        Kom.
                      </SortButton>
                    </HeadLabel>
                  </TH>
                  <TH numeric>
                    <SortButton numeric dir={dirOf("kar")} onClick={() => toggleSort("kar")}>
                      Brüt kâr
                    </SortButton>
                  </TH>
                  <TH numeric>
                    <HeadLabel sub="kâr ÷ net">
                      <span className="inline-flex items-center gap-1.5">
                        <InfoTip text="Excel'deki 'Kâr marjı %' sütunu ve renk ölçeği: bu ayın en düşük marjı kırmızı, ortancası sarı, en yükseği yeşil. Ölçeğe reçeteli ürünler girer; HİZMET, eşleşmeyen ve reçetesi boş ürüne bağlı (maliyeti tahmini) satırlar renksizdir." />
                        <SortButton numeric dir={dirOf("marj")} onClick={() => toggleSort("marj")}>
                          Marj
                        </SortButton>
                      </span>
                    </HeadLabel>
                  </TH>
                  <TH className="w-px px-2">
                    <span className="sr-only">İşlemler</span>
                  </TH>
                </tr>
              </THead>
              <motion.tbody
                key={`${filter}|${rawSort}|${paged.page}`}
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={reduce ? { duration: 0 } : { duration: 0.2, ease: EASE_OUT }}
              >
                {paged.slice.map((r) => {
                  const status = rowStatus(r);
                  const priceGap = r.menuPrice && r.avgPrice ? r.avgPrice / r.menuPrice - 1 : 0;
                  const product = r.productId ? productById.get(r.productId) : undefined;
                  return (
                    <TR key={r.id}>
                      <TD sticky className="max-w-64 min-w-36 sm:min-w-40">
                        <div className="flex items-center gap-3">
                          {/* Dar masaüstünde (1280–1536px) ad için yer açılsın: karo yalnız geniş ekranda */}
                          <IconTile
                            className="max-2xl:hidden"
                            tone={status === "matched" ? toneFor(product?.category ?? r.posName) : status === "service" ? 2 : 1}
                          >
                            {status === "matched" ? <Coffee /> : status === "service" ? <Mic /> : <CircleHelp />}
                          </IconTile>
                          <div className="min-w-0">
                            <p className="font-medium break-words">{r.posName}</p>
                            {lafposNote(r)}
                            {r.note ? (
                              <p className="truncate text-xs text-ink-mute" title={r.note}>
                                {r.note}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </TD>
                      <TD className="min-w-44">
                        <div className="flex flex-col items-start gap-1.5">{matchCell(r)}</div>
                      </TD>
                      <TD numeric>{num(r.qty)}</TD>
                      <TD numeric>
                        {tl(r.revenue)}
                        <span className="block text-xs text-ink-mute">net {tl(r.net)}</span>
                        {Math.abs(priceGap) > 0.03 ? (
                          <span className="block text-[11px] text-warn" title="Ortalama satış fiyatı menü fiyatından farklı">
                            ort. {tl(r.avgPrice)} ({priceGap > 0 ? "+" : ""}
                            {pct(priceGap, 0)})
                          </span>
                        ) : null}
                      </TD>
                      <TD numeric className={cn((status === "unmatched" || r.noRecipe) && "text-warn")}>
                        {tl(r.cost)}
                        {status === "unmatched" ? (
                          <span className="block text-xs">tahmini</span>
                        ) : r.noRecipe ? (
                          <span className="block text-xs" title="Ürünün reçetesi boş: maliyet net ciro × ortalama maliyet oranı">
                            tahmini · reçete boş
                          </span>
                        ) : (
                          <span className="block text-xs text-ink-mute">birim {r.unitCost !== null ? tl(r.unitCost, 2) : "–"}</span>
                        )}
                      </TD>
                      <TD numeric>{tl(r.commission)}</TD>
                      <TD numeric>
                        <span className={cn(r.grossProfit < 0 ? "text-bad" : "font-medium")}>{tl(r.grossProfit)}</span>
                      </TD>
                      <TD numeric>
                        <MarginPill row={r} scale={scale} />
                      </TD>
                      <TD className="px-2">
                        <div className="flex justify-end gap-1">{rowActions(r)}</div>
                      </TD>
                    </TR>
                  );
                })}
              </motion.tbody>
              <tfoot>
                <TFootRow>
                  <TD sticky>{totalsLabel}</TD>
                  <TD />
                  <TD numeric>{num(shownTotals.qty)}</TD>
                  <TD numeric>
                    {tl(shownTotals.revenue)}
                    <span className="block text-xs font-normal text-ink-mute">net {tl(shownTotals.net)}</span>
                  </TD>
                  <TD numeric>{tl(shownTotals.cost)}</TD>
                  <TD numeric>{tl(shownTotals.commission)}</TD>
                  <TD numeric>
                    <span className={cn(shownTotals.grossProfit < 0 && "text-bad")}>{tl(shownTotals.grossProfit)}</span>
                  </TD>
                  <TD numeric>{pct(shownTotals.margin, 1)}</TD>
                  <TD />
                </TFootRow>
              </tfoot>
            </Table>
          </TableWrap>
          <Pagination
            page={paged.page}
            pageCount={paged.pageCount}
            onChange={toPage}
            total={paged.total}
            unit="satır"
            // Telefonda 6 sayfa + oklar karta sığsın (sığmazsa alt satıra geçer, kartın dışına taşmaz)
            className="border-t border-line max-sm:px-3 [&>div]:flex-wrap max-sm:[&>div]:gap-1"
          />
        </>
      ) : rows.length ? (
        <div className="border-t border-line">
          <EmptyState
            icon={<ListChecks />}
            title={filter === "eslesmeyen" && !q.trim() ? "Eşleşmeyen satır kalmadı" : "Bu süzgece uyan satır yok"}
            description={
              q.trim()
                ? `“${q.trim()}” için sonuç bulunamadı. Aramayı kısaltın ya da süzgeci temizleyin.`
                : filter === "eslesmeyen"
                  ? "Bu aydaki bütün satırlar bir ürüne ya da HİZMET'e bağlı; maliyetler tahmin değil, reçeteden."
                  : "Seçili durumda satır yok."
            }
            action={
              <Button variant="secondary" onClick={clearFilters}>
                Süzgeci temizle
              </Button>
            }
          />
        </div>
      ) : lafposMonth ? (
        <EmptyState
          icon={<Store />}
          title="Bu ay LafPOS'tan satış gelmedi"
          description="Ürün satışları her gün sonunda LafPOS'tan kendiliğinden gelir. Gün sonu gelmediyse bağlantının durumuna Ayarlar › LafPOS (kasa) kartından bakın."
          action={
            <ButtonLink href="/panel/ayarlar#lafpos" variant="secondary">
              <Store size={16} /> LafPOS kartını aç
            </ButtonLink>
          }
        />
      ) : (
        <EmptyState
          icon={<Upload />}
          title="Bu ay için satış raporu yok"
          description="Patron > Raporlar > Satış ekranındaki ürün listesini yukarıdaki İçe aktar bölümüne dosya olarak bırakın ya da yapıştırın. Tek tek eklemek için “Satır ekle”."
          action={
            <Button variant="secondary" onClick={() => setEditing({ posName: "", qty: 1, revenue: 0 })}>
              <Plus size={16} /> Satır ekle
            </Button>
          }
        />
      )}

      {picking ? (
        <ProductPicker
          key={picking.id}
          onClose={() => setPicking(null)}
          products={products}
          title={`${picking.posName} (${num(picking.qty)} adet)`}
          currentId={picking.productId}
          isService={picking.isService}
          onPick={(v) => pick(picking, v)}
        />
      ) : null}
      {editing ? <LineDialog line={editing} month={month} mappings={mappings} products={products} onClose={() => setEditing(null)} /> : null}
      <Dialog
        open={bulkOpen}
        onClose={() => {
          if (!bulkBusy) setBulkOpen(false);
        }}
        title={`${num(suggestions.length)} öneri uygulansın mı?`}
        description="Adı menüdeki ürünle birebir tutan satırlar bağlanır ve hafızaya yazılır. Yanlış olanı sonra tıklayıp değiştirebilirsiniz."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBulkOpen(false)} disabled={bulkBusy} data-autofocus>
              Vazgeç
            </Button>
            <Button onClick={applySuggestions} disabled={bulkBusy || !suggestions.length}>
              {bulkBusy ? "Uygulanıyor…" : `${num(suggestions.length)} eşleşmeyi uygula`}
            </Button>
          </>
        }
      >
        <ul className="scroll-thin max-h-80 divide-y divide-line overflow-y-auto overscroll-contain rounded-2xl bg-surface text-sm ring-1 ring-line-strong">
          {suggestions.map(({ row, product }) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2">
              <span className="min-w-0 font-medium break-words text-ink">{row.posName}</span>
              <span className="text-ink-quiet" aria-hidden="true">
                →
              </span>
              <span className="sr-only">ile</span>
              <span className="text-ink-soft">
                {product.name} · {product.size}
              </span>
              <span className="ml-auto text-xs text-ink-mute tabular">
                {num(row.qty)} adet · {tl(row.revenue)}
              </span>
            </li>
          ))}
        </ul>
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Satır silinsin mi?"
        confirmLabel="Satırı sil"
        description={
          deleting ? (
            <>
              <span className="font-medium text-ink">{deleting.posName}</span> ({num(deleting.qty)} adet · {tl(deleting.revenue)}) bu aydan silinir.
              Eşleştirme hafızası silinmez; bu ad bir sonraki raporda yine tanınır.
            </>
          ) : null
        }
      />
    </Card>
  );
}

/** Boş değil ama sayı olarak okunamayan değer */
const badNumber = (t: string) => t.trim() !== "" && parseNumberTR(t) === null;

function LineDialog({
  line,
  month,
  mappings,
  products,
  onClose,
}: {
  line: Partial<SalesRow>;
  month: string;
  mappings: MappingLite[];
  products: ProductOption[];
  onClose: () => void;
}) {
  const [posName, setPosName] = useState(line.posName ?? "");
  const index = useMemo(() => createPosMappingIndex(mappings), [mappings]);
  const [qty, setQty] = useState(num(line.qty ?? 1, 2));
  const [revenue, setRevenue] = useState(line.revenue ? num(line.revenue, 2, 2) : "");
  const [note, setNote] = useState(line.note ?? "");
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const qtyNum = parseNumberTR(qty);
  const revNum = parseNumberTR(revenue) ?? 0;
  const bad = { qty: badNumber(qty) || (tried && !qty.trim()), revenue: badNumber(revenue) };
  const nameMissing = tried && !posName.trim();
  const isTotal = posName.trim() !== "" && isSummaryRow(posName);
  // Yeni satırda ya da eşleşmemiş satırın adı düzeltilirken hafızadaki eşleşme otomatik bağlanır
  const willLink = !line.matched && !line.isService && posName.trim() ? index.get(posName) : undefined;
  const linkProduct = willLink?.productId ? products.find((p) => p.id === willLink.productId) : undefined;
  const linkLabel = willLink?.isService ? "HİZMET" : linkProduct ? `${linkProduct.name} · ${linkProduct.size}` : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!posName.trim()) return toast.error("POS ürün adını girin");
    if (isTotal) return toast.error("Toplam satırı ürün satırı olarak eklenmez (ciro iki kez sayılır)");
    if (qtyNum === null || bad.revenue) return toast.error("Adet ve ciroyu kontrol edin");
    setBusy(true);
    keepScroll();
    const res = await tryAction(() => saveLine({ id: line.id ?? null, month, posName, qty: qtyNum, revenue: revNum, note }));
    setBusy(false);
    if (!res) return;
    if (!res.ok) return toast.error(res.error);
    toast.success(line.id ? "Satır güncellendi" : "Satır eklendi", {
      description: `${posName.trim()} · ${num(qtyNum)} adet · ${tl(revNum, 2)}${res.data.linked && linkLabel ? ` · ${linkLabel} ile eşleşti` : ""}`,
    });
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={line.id ? "Satırı düzenle" : "Satır ekle"}
      description={line.id ? undefined : "Rapora girmemiş bir satışı elle ekleyin. Ad daha önce eşleştirildiyse ürün otomatik bağlanır."}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className={SHEET_BTN}>
            Vazgeç
          </Button>
          <Button type="submit" form="sales-line-form" disabled={busy} className={SHEET_BTN}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      {/* Enter kaydeder, Esc kapatır; dokunmatikte alanlar 40px */}
      <form id="sales-line-form" onSubmit={submit} noValidate className={cn("space-y-4 pb-2", BIG_FIELDS)}>
        <Field
          label="POS ürün adı"
          htmlFor="l-name"
          hint={
            linkLabel ? (
              <span className="inline-flex items-center gap-1 text-good">
                <Check size={12} aria-hidden="true" /> Hafızada: {linkLabel} ile otomatik eşleşir
              </span>
            ) : (
              "Patron'daki adıyla, ör. ICED AMERICANO MEDİUM (büyük/küçük harf fark etmez)"
            )
          }
          error={nameMissing ? "Ad girin" : isTotal ? "Bu bir toplam satırı; ürün satırı olarak eklenmez" : undefined}
        >
          <Input
            data-autofocus="always"
            id="l-name"
            value={posName}
            onChange={(e) => setPosName(e.target.value)}
            aria-invalid={nameMissing || isTotal || undefined}
            autoComplete="off"
          />
        </Field>
        <div className="grid grid-cols-1 gap-x-3 gap-y-4 sm:grid-cols-2">
          <Field label="Adet" htmlFor="l-qty" error={bad.qty ? "Sayı girin" : undefined}>
            <NumberInput id="l-qty" value={qty} onChange={(e) => setQty(e.target.value)} onFocus={(e) => e.currentTarget.select()} aria-invalid={bad.qty || undefined} />
          </Field>
          <Field
            label="Ciro, KDV dahil (₺)"
            htmlFor="l-rev"
            error={bad.revenue ? "Sayı girin (ör. 1.250,50)" : undefined}
            hint={qtyNum && revNum ? `Ortalama ${tl(revNum / qtyNum, 2)} / adet` : undefined}
          >
            <NumberInput id="l-rev" value={revenue} onChange={(e) => setRevenue(e.target.value)} placeholder="0,00" aria-invalid={bad.revenue || undefined} />
          </Field>
        </div>
        <Field label="Not" htmlFor="l-note" hint="İsteğe bağlı, satırın altında görünür">
          <Input id="l-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- İçe aktarma

type ParsedLine = { posName: string; qty: number; revenue: number };
type Parsed = Pick<SalesParseResult, "skipped" | "skippedRows"> & { rows: ParsedLine[]; source: "file" | "paste" };

const SKIP_REASON: Record<SalesParseResult["skippedRows"][number]["reason"], string> = {
  summary: "toplam satırı",
  header: "başlık",
  invalid: "adet / ciro okunamadı",
};

/** AkmanOS yüzeyi gibi bırakma alanı: beyaz, kesik çizgili; dosya üstüne gelince yayla hafifçe büyür */
function DropZone({ busy, onFile }: { busy: boolean; onFile: (f: File) => void }) {
  const reduce = useCalmMotion();
  const [dragging, setDragging] = useState(false);

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && !busy) onFile(f);
  }

  return (
    <motion.div className="flex flex-1" animate={{ scale: dragging && !reduce ? 1.015 : 1 }} transition={SPRING_PRESS}>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
        aria-busy={busy || undefined}
        className={cn(
          "flex min-h-48 flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-surface px-6 py-8 text-center max-sm:min-h-40",
          "transition-[border-color,box-shadow] duration-200 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ink/30",
          dragging ? "border-ink/40 shadow-[0_12px_40px_rgba(0,0,0,0.10)]" : "border-line-strong hover:border-ink/20",
          busy && "pointer-events-none",
        )}
      >
        <input
          type="file"
          accept=".xlsx,.csv,.txt,.tsv"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
        <motion.span
          animate={{ y: dragging && !reduce ? -3 : 0 }}
          transition={SPRING_PRESS}
          className={cn(
            "flex size-12 items-center justify-center rounded-2xl border transition-colors duration-200 [&>svg]:size-5 [&>svg]:stroke-[1.75]",
            dragging ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06)]",
          )}
          aria-hidden="true"
        >
          {busy ? <LoaderCircle className="motion-safe:animate-spin" /> : <FileUp />}
        </motion.span>
        <span className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">
            {busy ? (
              "Okunuyor…"
            ) : dragging ? (
              "Bırakın, dosya okunsun"
            ) : (
              <>
                {/* Dokunmatikte sürükle-bırak yok: doğrudan "Dosya seçin" */}
                <span className="pointer-coarse:hidden">
                  Dosyayı buraya bırakın ya da <span className="underline decoration-ink/30 underline-offset-2">seçin</span>
                </span>
                <span className="pointer-fine:hidden">
                  Rapor dosyasını <span className="underline decoration-ink/30 underline-offset-2">seçin</span>
                </span>
              </>
            )}
          </span>
          <span className="text-xs text-ink-mute">Patron&apos;dan indirdiğiniz satış raporu</span>
        </span>
        <span className="flex flex-wrap items-center justify-center gap-1.5 text-xs text-ink-mute">
          <Badge tone="gray">.xlsx</Badge>
          <Badge tone="gray">.csv</Badge>
          <span>· en fazla {SALES_FILE_MAX_MB} MB</span>
        </span>
      </label>
    </motion.div>
  );
}

export function ImportCard({
  month,
  label,
  lineCount,
  lafposLines = 0,
  mappings,
  products,
  hasInfo,
  running,
  coveredThrough,
  listDays,
  lafpos = null,
  className,
}: {
  month: string;
  /** Hedef ayın adı, ör. "Eylül 2026" (önizleme açıkken ay değiştirilirse hedef görünür kalsın) */
  label: string;
  /** Ayın ModPOS (Satışlar'a yüklenen) satırları; yükleme ve "Ayı temizle" yalnız bunlara dokunur */
  lineCount: number;
  /** Tablodaki LafPOS satırları (geçiş ayı): metinler iki kaynağı ayrı söyler, yükleme ve temizleme onlara dokunmaz */
  lafposLines?: number;
  mappings: MappingLite[];
  products: ProductOption[];
  /** Ayda ciro / açık gün / not gibi bilgi var mı ("Ayı temizle" penceresinde seçenek olarak) */
  hasInfo: boolean;
  /**
   * Hedef ay süren aysa bugün ve listenin varsayılan son günü (dün; ayın 1'inde bugün): liste o güne kadardır
   * (src/lib/sales-coverage.ts). Biten ayda null: liste ayın tamamı
   */
  running?: { today: string; defaultThrough: string } | null;
  /** Yüklü listenin son günü (süren ayda yüklendiyse); yoksa null */
  coveredThrough?: string | null;
  /** Liste kasa raporlarından kısa bir dönemi kapsıyorsa dönemi ("1–15 Kasım"); yoksa null */
  listDays?: string | null;
  /**
   * LafPOS'a geçildiyse ayın kaynağı (docs/LAFPOS.md › Günlük satış): geçiş ayında liste en çok geçiş gününden önceki
   * güne kadardır (`running` o sınırla gelir, `throughHint` gün alanının açıklaması); LafPOS ayında liste yüklenmez,
   * kart gelen günleri söyler (`lineCount` sayılmayan eski listenin satırları). Geçiş günü yoksa null
   */
  lafpos?: { source: "gecis"; throughHint: string } | { source: "lafpos"; days: number; last: string | null } | null;
  className?: string;
}) {
  const reduce = useCalmMotion();
  const hasLines = lineCount > 0;
  const lafposOnly = lafpos?.source === "lafpos" ? lafpos : null;
  const [source, setSource] = useState<"file" | "paste">("file");
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [withInfo, setWithInfo] = useState(false);
  /** "Yenisiyle değiştir": ayın satırları silinmeden önce sorulur */
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  /**
   * Süren ayda listenin son günü (Patron'un raporu genelde dünün sonuna kadar). Kart ay değişince yeniden kurulmaz
   * (önizleme açık kalır): elle seçilen gün yalnız seçildiği ayda geçerlidir, başka ayda varsayılana döner
   */
  const [throughEdit, setThroughEdit] = useState<{ month: string; value: string } | null>(null);
  const through = throughEdit?.month === month ? throughEdit.value : (running?.defaultThrough ?? "");
  const throughBad = Boolean(running) && (!/^\d{4}-\d{2}-\d{2}$/.test(through) || through.slice(0, 7) !== month || through > (running?.today ?? ""));

  const rows = useMemo(() => parsed?.rows ?? [], [parsed]);
  const preview = useMemo(() => previewMatches(rows, mappings, products), [rows, mappings, products]);
  // Adı "TOPLAM" olmayan ama cirosu diğerlerinin toplamına eşit satır: otomatik atlanmaz, sorulur
  const suspects = useMemo(() => new Set(suspectTotalRows(rows)), [rows]);
  const totals = preview.reduce((a, r) => ({ qty: a.qty + r.qty, revenue: a.revenue + r.revenue }), { qty: 0, revenue: 0 });
  const skippedText = parsed ? describeSkipped(parsed.skipped) : null;
  const counts = {
    matched: preview.filter((p) => p.status === "matched").length,
    service: preview.filter((p) => p.status === "service").length,
    fresh: preview.filter((p) => p.status === "new").length,
  };
  // Sunucu HTML'i ve hidrasyon sırasında useCalmMotion true döner: kart ilk boyamada görünür gelir,
  // yalnızca sonradan değişen görünüm (dosya ↔ yapıştır ↔ önizleme) yumuşakça belirir
  const fade = {
    initial: reduce ? (false as const) : { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: reduce ? { duration: 0 } : { duration: 0.24, ease: EASE_OUT },
  };

  /** Okunan listeyi önizlemeye alır; atlanan satırları sessizce yutmaz, sayısını söyler */
  function accept(res: SalesParseResult, from: "file" | "paste") {
    setParsed({ rows: res.rows, skipped: res.skipped, skippedRows: res.skippedRows, source: from });
    const why = describeSkipped(res.skipped);
    toast.success(`${num(res.rows.length)} satır okundu`, {
      description: [why, res.suspectTotals.length ? "Toplam satırı olabilecek bir satır var; önizlemede kontrol edin." : null].filter(Boolean).join(" · ") || undefined,
    });
  }

  async function onFile(f: File) {
    // Sınırı aşan dosya gönderilmez: sunucu isteği okumadan reddeder, yanıt toast'a hiç ulaşmazdı
    const problem = salesFileProblem(f.size);
    if (problem) return toast.error(problem);
    const fd = new FormData();
    fd.set("file", f);
    setBusy(true);
    try {
      const res = await parseSalesFile(fd);
      if (!res.ok) return toast.error(res.error);
      accept(res.data, "file");
    } catch {
      // Bağlantı koptu ya da istek reddedildi: alan "Okunuyor…"da kalmasın, kişi nedenini görsün
      toast.error("Dosya gönderilemedi. Bağlantıyı kontrol edip yeniden deneyin.");
    } finally {
      setBusy(false);
    }
  }

  function readPasted() {
    const r = parsePastedSales(text);
    if (!r.rows.length) {
      const why = describeSkipped(r.skipped);
      return toast.error("Satır okunamadı. Her satırda ürün adı, adet ve ciro olmalı.", { description: why ?? undefined });
    }
    accept(r, "paste");
  }

  function dropRow(i: number) {
    setParsed((p) => (p ? { ...p, rows: p.rows.filter((_, j) => j !== i) } : p));
  }

  function restart() {
    setParsed(null);
  }

  const replaceAsk = hasLines ? replaceConfirm({ mode, lineCount, newCount: rows.length, label }) : null;

  async function submit() {
    setBusy(true);
    keepScroll();
    const res = await tryAction(() => importSales({ month, lines: rows, mode, through: running ? through : null }));
    setBusy(false);
    setConfirmingReplace(false);
    // Atılan eylem (E-51): düğme bırakılır, yapıştırılan liste yerinde kalır
    if (!res) return;
    if (!res.ok) return toast.error(res.error);
    const d = res.data;
    // Geçiş ayı: liste toplamı listenin günlerinin Z toplamını aşıyor (sonraki günleri de içeriyor olabilir)
    if (d.warning) toast.warning("Liste kasa raporlarından büyük", { description: d.warning, duration: 15_000 });
    const left = d.count - d.matched;
    toast.success(`${num(d.count)} satır ${label} ayına yüklendi`, {
      description: [
        `${num(d.matched)} tanesi hafızadan eşleşti${left ? `, ${num(left)} satırı aşağıdan eşleştirin` : ""}.`,
        d.replaced ? `Önceki ${num(d.replaced)} satır değiştirildi.` : null,
        skippedText,
        d.skippedSummary ? `${num(d.skippedSummary)} toplam satırı atlandı.` : null,
      ]
        .filter(Boolean)
        .join(" "),
    });
    setParsed(null);
    setText("");
  }

  async function clearMonth() {
    setClearing(true);
    keepScroll();
    const res = await tryAction(() => clearMonthSales(month, { withInfo }));
    setClearing(false);
    if (!res) return;
    setConfirmClear(false);
    setWithInfo(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`${num(res.data.deleted)} satır silindi`, {
      description: res.data.monthRemoved
        ? `${label} artık tamamen boş.`
        : withInfo
          ? "Ay bilgileri de silindi."
          : "Ay bilgileri (ciro, açık gün) duruyor.",
    });
  }

  return (
    <Card className={className}>
      {lafposOnly ? (
        // Ayın tamamı LafPOS'tan: liste yüklenmez; sayılmayan eski liste "Ayı temizle" ile silinir
        <motion.div key="lafpos" {...fade} className="flex flex-1 flex-col">
          <CardHeader icon={<Store />} title="LafPOS'tan geliyor" description={`${label.split(" ")[0]} satışları her gün sonunda LafPOS'tan kendiliğinden gelir; ModPOS listesi yüklenmez.`} />
          <CardContent className="flex flex-1 flex-col gap-3 text-sm text-ink-soft">
            <p className="rounded-2xl bg-info-soft px-4 py-3 text-info">
              {lafposOnly.days && lafposOnly.last
                ? `${num(lafposOnly.days)} gün sonu geldi, son gün ${dayMonthTR(lafposOnly.last)}. Satırlar aşağıda; eşleşmeyen adları ürüne bağlayın.`
                : "Bu ay için henüz gün sonu gelmedi; geldikçe satırlar aşağıda görünür."}
            </p>
            <p className="text-[13px] text-ink-mute">
              Gelen ve gelmeyen günler, retler:{" "}
              <Link href="/panel/ayarlar#lafpos" className="font-medium text-ink underline-offset-2 hover:underline">
                Ayarlar › LafPOS (kasa)
              </Link>
              .
            </p>
          </CardContent>
          {hasLines || hasInfo ? (
            <CardFooter className="mt-auto">
              <span>
                {hasLines
                  ? `Bu aya daha önce yüklenmiş ${num(lineCount)} satırlık ModPOS listesi sayılmıyor (ay LafPOS'tan); silebilirsiniz.`
                  : "Bu ayda elle yazılmış ay bilgileri var."}
              </span>
              <Button variant="ghost" size="sm" className="text-bad hover:bg-bad-soft hover:text-bad pointer-coarse:h-11" onClick={() => setConfirmClear(true)}>
                <Eraser size={15} /> Ayı temizle
              </Button>
            </CardFooter>
          ) : null}
        </motion.div>
      ) : !parsed ? (
        <motion.div key="pick" {...fade} className="flex flex-1 flex-col">
          <CardHeader
            icon={<Upload />}
            title="İçe aktar"
            description="Patron > Raporlar > Satış: ürün adı, adet ve ciro (KDV dahil) sütunları."
            actions={
              <Segmented
                label="Kaynak"
                value={source}
                onChange={setSource}
                options={[
                  { value: "file", label: "Dosya" },
                  { value: "paste", label: "Yapıştır" },
                ]}
              />
            }
          />
          <CardContent className="flex flex-1 flex-col">
            {source === "file" ? (
              <motion.div key="file" {...fade} className="flex flex-1 flex-col">
                <DropZone busy={busy} onFile={onFile} />
              </motion.div>
            ) : (
              <motion.div key="paste" {...fade} className="flex flex-1 flex-col gap-3">
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) {
                      e.preventDefault();
                      readPasted();
                    }
                  }}
                  rows={7}
                  autoFocus
                  aria-label="Satış listesini yapıştırın"
                  // Satırlar sarılmaz (bir rapor satırı ekranda tek satır, yana kayar); örnek 375px'e sığar
                  placeholder={"LATTE MEDIUM\t265\t79.500\nICED AMERICANO\t172\t29.770\n…"}
                  wrap="off"
                  className="min-h-44 flex-1 overflow-x-auto font-mono text-base whitespace-pre [tab-size:4] sm:text-xs"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-ink-mute">
                    Her satırda ürün adı, adet, ciro. Başlık ve TOPLAM satırları otomatik atlanır.{" "}
                    {/* Klavye kısayolu dokunmatikte anlamsız */}
                    <span className="pointer-coarse:hidden">
                      <kbd className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] text-ink-soft ring-1 ring-line-strong">Ctrl/⌘ + Enter</kbd> ile
                      okuyun.
                    </span>
                  </p>
                  <Button variant="primary" onClick={readPasted} disabled={!text.trim()} className="max-sm:min-h-12 max-sm:w-full">
                    <ClipboardPaste size={16} /> Yapıştırılanı oku
                  </Button>
                </div>
              </motion.div>
            )}
          </CardContent>
          {hasLines || hasInfo ? (
            <CardFooter className="mt-auto">
              <span>
                {hasLines
                  ? `Bu ayda ${num(lineCount)} ${lafposLines ? "ModPOS satırı" : "satır"} var${coveredThrough ? ` (${dayMonthTR(coveredThrough)} tarihine kadar)` : ""}${lafposLines ? `, ayrıca LafPOS'tan ${num(lafposLines)} satır` : ""}. Yeni rapor yüklerken değiştirmeyi ya da eklemeyi seçersiniz.`
                  : lafposLines
                    ? `Bu ayda ModPOS listesi yok; LafPOS'tan ${num(lafposLines)} satır var (yükleme ve "Ayı temizle" onlara dokunmaz).`
                    : "Bu ayda satış satırı yok; yalnızca ay bilgileri var."}
                {hasLines && listDays
                  ? ` Kasa raporları daha ileride: Genel bakış ve Tutarlılık listeye dayanan hesapları (günlük ortalama, POS cirosuyla karşılaştırma, sabit gider) ${listDays} günleriyle yapar.`
                  : null}
              </span>
              <Button variant="ghost" size="sm" className="text-bad hover:bg-bad-soft hover:text-bad pointer-coarse:h-11" onClick={() => setConfirmClear(true)}>
                <Eraser size={15} /> Ayı temizle
              </Button>
            </CardFooter>
          ) : null}
        </motion.div>
      ) : (
        <motion.div key="preview" {...fade} className="flex flex-1 flex-col">
          <CardHeader
            icon={<Upload />}
            title="İçe aktar · önizleme"
            description={`${num(rows.length)} satır ${parsed.source === "file" ? "dosyadan" : "yapıştırılandan"} okundu. Kontrol edip ${label} ayına yükleyin.`}
            actions={
              <Button variant="ghost" size="sm" onClick={restart} disabled={busy} className="pointer-coarse:h-11">
                <RotateCcw size={15} /> Baştan başla
              </Button>
            }
          />
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="green" dot>
                {counts.matched} eşleşti
              </Badge>
              {counts.service ? (
                <Badge tone="blue" dot>
                  {counts.service} hizmet
                </Badge>
              ) : null}
              <Badge tone="amber" dot>
                {counts.fresh} yeni ad
              </Badge>
              <span className="text-[13px] text-ink-mute tabular">
                Toplam {num(totals.qty)} adet · {tl(totals.revenue)}
              </span>
            </div>
            {skippedText ? (
              <div className="rounded-2xl bg-info-soft px-3 py-2.5 text-xs leading-5 text-info" role="status">
                <p className="flex items-start gap-2">
                  <CircleCheck size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    <span className="font-semibold">{skippedText}.</span> Bunlar ürün sayılmaz; ay cirosu iki kez sayılmasın diye yüklenmez.
                  </span>
                </p>
                {parsed.skippedRows.length ? (
                  <details className="mt-1.5 pl-6">
                    <summary className="cursor-pointer font-medium underline-offset-2 hover:underline pointer-coarse:min-h-11">Atlanan satırları göster</summary>
                    <ul className="mt-1 space-y-0.5 text-ink-soft">
                      {parsed.skippedRows.map((r) => (
                        <li key={r.line} className="break-words">
                          <span className="text-ink-mute tabular">{r.line}. satır</span> · {SKIP_REASON[r.reason]} ·{" "}
                          <span className="font-mono text-[11px]">{r.text}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ) : null}
            {[...suspects].map((i) => (
              <div key={`s${i}`} className="flex flex-wrap items-start gap-2.5 rounded-2xl bg-warn-soft px-3 py-2.5 text-xs leading-5 text-warn" role="alert">
                <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                <p className="min-w-0 flex-1">
                  <span className="font-semibold">“{rows[i].posName}” toplam satırı olabilir:</span> cirosu ({tl(rows[i].revenue)}) diğer satırların
                  toplamına eşit. Ürün değilse çıkarın, yoksa ay cirosu iki kat görünür.
                </p>
                <Button size="sm" variant="secondary" onClick={() => dropRow(i)} className="pointer-coarse:h-11">
                  <X size={14} /> Listeden çıkar
                </Button>
              </div>
            ))}
            {/* Telefon: liste (tablo 375px'te yana kayardı); sm'den itibaren tablo */}
            <ul className="scroll-thin max-h-80 divide-y divide-line overflow-y-auto overscroll-contain rounded-2xl bg-surface ring-1 ring-line-strong sm:hidden">
              {preview.map((r, i) => (
                <li key={`${i}|${r.posName}`} className={cn("flex items-start gap-2 py-2 pr-1.5 pl-3", suspects.has(i) && "bg-warn-soft/60")}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium break-words text-ink">{r.posName}</p>
                    <p className="text-[13px] text-ink-mute tabular">
                      {num(r.qty, 2)} adet · {tl(r.revenue, 2)}
                    </p>
                    {r.status === "new" ? (
                      <p className="text-xs text-warn">Yükledikten sonra eşleştirin</p>
                    ) : (
                      <p className={cn("flex items-center gap-1 text-xs break-words", r.status === "service" ? "text-info" : "text-good")}>
                        {r.status === "service" ? <Mic size={12} className="shrink-0" aria-hidden="true" /> : <Check size={12} className="shrink-0" aria-hidden="true" />}
                        {r.label}
                      </p>
                    )}
                  </div>
                  <IconButton label={`${r.posName} satırını listeden çıkar`} onClick={() => dropRow(i)} disabled={busy}>
                    <X size={15} />
                  </IconButton>
                </li>
              ))}
            </ul>
            <div className="scroll-thin max-h-72 overflow-auto rounded-2xl bg-surface px-1 ring-1 ring-line-strong max-sm:hidden">
              <Table>
                <THead className="sticky top-0 z-10 bg-surface [&_th]:pt-3">
                  <tr>
                    <TH>POS ürün adı</TH>
                    <TH numeric>Adet</TH>
                    <TH numeric>Ciro</TH>
                    <TH>Eşleşme</TH>
                    <TH className="w-px px-1">
                      <span className="sr-only">Çıkar</span>
                    </TH>
                  </tr>
                </THead>
                <tbody>
                  {preview.map((r, i) => (
                    <TR key={`${i}|${r.posName}`} className={cn("hover:bg-panel/60", suspects.has(i) && "bg-warn-soft/60")}>
                      <TD className="min-w-40">{r.posName}</TD>
                      <TD numeric>{num(r.qty, 2)}</TD>
                      <TD numeric>{tl(r.revenue, 2)}</TD>
                      <TD className="min-w-40">
                        {r.status === "new" ? (
                          <span className="text-xs text-warn">Yükledikten sonra eşleştirin</span>
                        ) : r.status === "service" ? (
                          <span className="inline-flex items-center gap-1 text-xs text-info">
                            <Mic size={12} aria-hidden="true" /> {r.label}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-good">
                            <Check size={12} aria-hidden="true" /> {r.label}
                          </span>
                        )}
                      </TD>
                      <TD className="px-1">
                        <IconButton label={`${r.posName} satırını listeden çıkar`} onClick={() => dropRow(i)} disabled={busy}>
                          <X size={14} />
                        </IconButton>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              {hasLines ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-ink-mute">
                    Bu aydaki {num(lineCount)} {lafposLines ? "ModPOS satırı (LafPOS'unkiler kalır)" : "satır"}:
                  </span>
                  <Segmented
                    label="Mevcut satırlar"
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: "replace", label: "Yenisiyle değiştir" },
                      { value: "append", label: "Koru, üstüne ekle" },
                    ]}
                  />
                </div>
              ) : (
                <span className="text-[13px] text-ink-mute">
                  {lafposLines
                    ? `Bu ayda ModPOS listesi yok; satırlar doğrudan yüklenir (LafPOS'un ${num(lafposLines)} satırına dokunulmaz).`
                    : "Bu ay boş; satırlar doğrudan yüklenir."}
                </span>
              )}
              {running ? (
                // Süren ay: liste o güne kadardır; kasa raporları ilerledikçe hesaplar listenin günleriyle yapılır
                <div className="flex flex-wrap items-center gap-2">
                  {/* Bilgi simgesi etiketle birlikte sarılır (telefonda tek başına alt satıra düşmez) */}
                  <span className="inline-flex items-center gap-1.5">
                    <label htmlFor="sales-through" className="text-[13px] text-ink-mute">
                      Liste hangi güne kadar?
                    </label>
                    <InfoTip
                      text={
                        lafpos?.source === "gecis"
                          ? lafpos.throughHint
                          : "Ay sürerken yüklenen satış listesi o güne kadardır; kasa raporları her akşam ilerler. Genel bakış günlük ortalamayı, POS cirosuyla karşılaştırmayı ve reçeteye göre kârın sabit giderini listenin günleriyle hesaplar. Ay bitince ayın tamamının listesini yükleyin."
                      }
                    />
                  </span>
                  <Input
                    id="sales-through"
                    type="date"
                    value={through}
                    min={`${month}-01`}
                    max={running.today}
                    onChange={(e) => setThroughEdit({ month, value: e.target.value })}
                    aria-invalid={throughBad || undefined}
                    className="w-auto"
                  />
                </div>
              ) : null}
              <Button
                onClick={() => (replaceAsk ? setConfirmingReplace(true) : void submit())}
                disabled={busy || !rows.length || throughBad}
                className="max-sm:min-h-12 max-sm:w-full"
              >
                {busy ? "Yükleniyor…" : `${num(rows.length)} satırı yükle`}
              </Button>
            </div>
          </CardContent>
        </motion.div>
      )}

      <ConfirmDialog
        open={confirmingReplace && replaceAsk !== null}
        onClose={() => {
          if (!busy) setConfirmingReplace(false);
        }}
        onConfirm={() => void submit()}
        pending={busy}
        title={replaceAsk?.title}
        description={replaceAsk?.description}
        confirmLabel={replaceAsk?.confirmLabel}
      />

      <Dialog
        open={confirmClear}
        onClose={() => {
          if (!clearing) setConfirmClear(false);
        }}
        title={`${label} temizlensin mi?`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)} disabled={clearing} data-autofocus>
              Vazgeç
            </Button>
            <Button variant="danger" onClick={clearMonth} disabled={clearing || (!hasLines && !withInfo)}>
              {clearing ? "Siliniyor…" : hasLines ? `${num(lineCount)} satırı${withInfo ? " ve bilgileri" : ""} sil` : "Ay bilgilerini sil"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 pb-2 text-sm text-ink-mute">
          <p>
            {hasLines ? (
              <>
                <span className="font-medium text-ink">
                  {num(lineCount)} {lafpos ? "ModPOS" : "satış"} satırı silinecek.
                </span>{" "}
                Eşleştirme hafızası ve Gelir-gider girişleri silinmez{lafpos ? "; LafPOS'tan gelen satırlar kalır" : ""}.
              </>
            ) : lafposLines ? (
              `Bu ayda ModPOS satırı yok; LafPOS'tan gelen ${num(lafposLines)} satır silinmez.`
            ) : (
              "Bu ayda satış satırı yok."
            )}
          </p>
          {hasInfo ? (
            <Checkbox
              label="Ay bilgilerini de sil (POS ciro, açık gün, indirim, ödenmez, not)"
              checked={withInfo}
              onChange={(e) => setWithInfo(e.target.checked)}
              disabled={clearing}
            />
          ) : null}
        </div>
      </Dialog>
    </Card>
  );
}
