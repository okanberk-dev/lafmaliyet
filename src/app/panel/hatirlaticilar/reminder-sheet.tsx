"use client";

import { BellRing, Check, ChevronRight, Minus, Plus, Repeat, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { createContext, useContext, useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fold, matches, SearchField } from "@/components/ui/filters";
import { Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { parseNumberTR } from "@/lib/calc/expr";
import type { FixedPeriod, FixedSection } from "@/lib/calc/types";
import { dateTR, monthLabel, num } from "@/lib/format";
import {
  addDays,
  fixedReminderText,
  isLastDayOfMonth,
  longDateTR,
  presetAnchor,
  presetDraft,
  presetFirstDate,
  REMINDER_KINDS,
  REMINDER_PRESETS,
  REMINDER_REPEATS,
  reminderCategory,
  repeatLabel,
  type ReminderCategory,
  type ReminderKind,
  type ReminderRepeat,
} from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { addFixedExpenseReminder, saveReminder, setInvoiceDueDate } from "@/server/actions/reminders";

import { CategoryWell, money } from "./payment-ui";
import { Sheet, SHEET_BTN } from "./sheet";

export interface Reminder {
  id: number;
  title: string;
  kind: ReminderKind;
  amount: number | null;
  dueDate: string;
  anchorDate: string;
  repeat: ReminderRepeat;
  remindDaysBefore: number;
  note: string | null;
  active: boolean;
  lastDoneAt: string | null;
  /** Ödemenin şubesi; boş: işletme geneli */
  branchId: string | null;
}

/**
 * Ödemelerin şubeleri (docs/SUBE.md › Ödemeler): seçenekler (etkin fiziksel şubeler) ve yeni ödemenin varsayılanı
 * (seçili şube; "Tümü"nde işletme geneli, ""). Tek şube varken şube alanı gösterilmez.
 */
export interface PaymentBranches {
  options: readonly { id: string; name: string }[];
  defaultId: string;
}

export const PaymentBranchesContext = createContext<PaymentBranches>({ options: [], defaultId: "" });

export interface FixedRow {
  id: number;
  name: string;
  /** Kalemin taban tutarı ve dönemi (KDV hariç; sürümler bunların üstüne) */
  amount: number;
  basePeriod: FixedPeriod;
  /** Gelecek ayın (varsayılan ilk ödeme) dönemi: listede günlükler bununla ayrılır */
  period: FixedPeriod;
  section: FixedSection;
  /** Kalemin kendi KDV oranı; boşsa bölümün varsayılanı */
  vatRate: number | null;
  /** Ödemeden kesilen stopaj oranı (Vergi › sınıflandırma; 0 = yok): tutar bankadan çıkan net (docs/VERGI.md) */
  withholdingRate: number;
  versions: { fromMonth: string; period: FixedPeriod; amount: number }[];
  /** Bitiş ayı (bu ay ya da sonrası; bitmişler listelenmez): ilk ödeme en geç bu ayda (E-62) */
  endMonth: string | null;
}

/**
 * Telefonda alanlar: dokunmatikte form bileşeninin 44px'i (pointer-coarse:h-11) geçerli, fareli dar ekranda 48px.
 * Yazı 16px olduğu için iOS yakınlaştırmaz.
 */
const BIG = "max-sm:h-12";

const PRESET_CARDS: { key: string; label: string; category: ReminderCategory }[] = [
  { key: "kdv", label: "KDV", category: "vergi" },
  { key: "muhtasar", label: "Muhtasar", category: "vergi" },
  { key: "sgk", label: "SGK", category: "sgk" },
  { key: "gecici", label: "Geçici vergi", category: "vergi" },
  { key: "maas", label: "Maaş", category: "maas" },
  { key: "kira", label: "Kira", category: "kira" },
  { key: "abonelik", label: "Abonelik", category: "abonelik" },
  { key: "kv", label: "Kurumlar vergisi", category: "vergi" },
  { key: "ctv1", label: "ÇTV 1. taksit", category: "vergi" },
  { key: "ctv2", label: "ÇTV 2. taksit", category: "vergi" },
  { key: "ilan", label: "İlan-reklam", category: "vergi" },
];

/** Başlıktan tür tahmini (yeni hatırlatıcıda tür elle seçilmediyse) */
function guessKind(title: string): ReminderKind | null {
  const t = fold(title);
  if (/(kdv|vergi|sgk|muhtasar|stopaj|beyan|bagkur|damga)/.test(t)) return "vergi";
  if (/(kira|aidat)/.test(t)) return "kira";
  if (/(maas|ucret|avans|bordro)/.test(t)) return "maas";
  if (/(fatura|elektrik|dogalgaz|internet|telefon|abonelik)|(^|\s)su(\s|$)/.test(t)) return "fatura";
  return null;
}

interface Draft {
  title: string;
  kind: ReminderKind;
  amount: string;
  dueDate: string;
  repeat: ReminderRepeat;
  before: string;
  note: string;
  endOfMonth: boolean;
  /** Şablondan geldiyse adı (başlıkta gösterilir) */
  preset?: string;
}

function draftOf(r: Reminder): Draft {
  return {
    title: r.title,
    kind: r.kind,
    amount: r.amount !== null ? num(r.amount, 2, Number.isInteger(r.amount) ? 0 : 2) : "",
    dueDate: r.dueDate,
    repeat: r.repeat,
    before: String(r.remindDaysBefore),
    note: r.note ?? "",
    endOfMonth: Number(r.anchorDate.slice(8, 10)) >= 31,
  };
}

/** Şablonun taslağı (kart ya da `?yeni=<şablon>`); "ozel" boş başlıkla */
function presetDraftOf(key: string, today: string, initialDate?: string): Draft {
  if (key === "ozel") return { title: "", kind: "odeme", amount: "", dueDate: initialDate ?? today, repeat: "monthly", before: "3", note: "", endOfMonth: false, preset: "Özel" };
  const p = REMINDER_PRESETS.find((x) => x.key === key)!;
  const d = presetDraft(p, initialDate && initialDate > today ? initialDate : today);
  return { ...d, amount: "", before: String(d.remindDaysBefore), preset: PRESET_CARDS.find((c) => c.key === key)?.label };
}

/** Şablon anahtarı mı (`?yeni=` adresten gelir; bilinmeyen değer yok sayılır) */
export function isPresetKey(key: string | null | undefined): key is string {
  return Boolean(key) && REMINDER_PRESETS.some((p) => p.key === key);
}

/**
 * Yeni hatırlatıcı ve düzenleme. Yenide önce şablon kartları (KDV, Muhtasar, SGK, Geçici vergi, Maaş, Kira,
 * Abonelik, kurumlar vergisi, ÇTV, ilan-reklam, Özel) ve "Sabit giderlerden ekle"; şablon başlık, gün, tekrar ve haber
 * gününü doldurur. `initialPreset` (Vergi › takvimin "Ödemeler'e ekle"si, `?yeni=<şablon>`) formu o şablonla açar.
 */
export function ReminderSheet({
  reminder,
  today,
  initialDate,
  initialPreset,
  existing,
  fixedExpenses,
  onClose,
  onDelete,
}: {
  reminder: Reminder | null;
  today: string;
  /** Takvimde bir güne dokunup "Bu güne ekle" denince: Özel şablonun tarihi */
  initialDate?: string;
  /** Şablonla dolu açılış (`REMINDER_PRESETS` anahtarı); geri düğmesi şablon kartlarına döner */
  initialPreset?: string | null;
  existing: Set<string>;
  fixedExpenses: FixedRow[];
  onClose: () => void;
  onDelete: (r: Reminder) => void;
}) {
  const preset = !reminder && isPresetKey(initialPreset) ? initialPreset : null;
  const [step, setStep] = useState<"pick" | "form" | "fixed">(reminder || preset ? "form" : "pick");
  const [draft, setDraft] = useState<Draft | null>(reminder ? draftOf(reminder) : preset ? presetDraftOf(preset, today, initialDate) : null);

  const choose = (key: string) => {
    setDraft(presetDraftOf(key, today, initialDate));
    setStep("form");
  };

  if (step === "fixed") return <FixedSheet rows={fixedExpenses} today={today} existing={existing} onBack={() => setStep("pick")} onClose={onClose} />;

  if (step === "form" && draft)
    return (
      <FormSheet
        key={draft.preset ?? "edit"}
        reminder={reminder}
        initial={draft}
        today={today}
        onBack={reminder ? undefined : () => setStep("pick")}
        onClose={onClose}
        onDelete={onDelete}
      />
    );

  const usableFixed = fixedExpenses.filter((f) => f.period !== "gunluk").length;
  return (
    <Sheet
      open
      onClose={onClose}
      title={initialDate ? `Yeni hatırlatıcı · ${dateTR(initialDate)}` : "Yeni hatırlatıcı"}
      description={initialDate ? "Özel'i seçerseniz bu tarih dolar; şablonlar kendi gününü bulur." : "Bir şablon seçin; başlık, gün ve tekrar dolar. Tutarı ve tarihi sonra değiştirebilirsiniz."}
      size="lg"
    >
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PRESET_CARDS.map((c) => {
          const p = REMINDER_PRESETS.find((x) => x.key === c.key)!;
          const first = presetFirstDate(p, today);
          const exists = existing.has(fold(p.title));
          return (
            <li key={c.key}>
              <button
                type="button"
                onClick={() => choose(c.key)}
                className="relative flex h-full min-h-[7.5rem] w-full cursor-pointer flex-col items-start gap-2 rounded-2xl bg-panel p-3 text-left ring-1 ring-transparent transition-[box-shadow,transform] ring-inset hover:ring-ink/15 focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none active:scale-[0.98]"
              >
                <CategoryWell category={c.category} size="md" />
                <span className="min-w-0">
                  <span className="block text-[15px] leading-5 font-semibold text-ink">{c.label}</span>
                  <span className="mt-0.5 block text-xs leading-4 text-ink-mute">{repeatLabel(p.repeat, first, presetAnchor(p, first))}</span>
                  <span className="mt-0.5 block text-xs leading-4 text-ink-mute tabular">İlk: {dateTR(first)}</span>
                </span>
                {exists ? (
                  <Badge tone="gray" className="absolute top-2.5 right-2.5">
                    Var
                  </Badge>
                ) : null}
              </button>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => choose("ozel")}
            className="flex h-full min-h-[7.5rem] w-full cursor-pointer flex-col items-start gap-2 rounded-2xl bg-surface p-3 text-left ring-1 ring-line-strong ring-inset transition-[box-shadow,transform] hover:ring-ink/25 focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none active:scale-[0.98]"
          >
            <span className="flex size-9 items-center justify-center rounded-[10px] bg-ink text-on-solid" aria-hidden="true">
              <Sparkles size={17} />
            </span>
            <span>
              <span className="block text-[15px] leading-5 font-semibold text-ink">Özel</span>
              <span className="mt-0.5 block text-xs leading-4 text-ink-mute">Başlığı, günü ve tekrarı siz seçin</span>
            </span>
          </button>
        </li>
      </ul>

      <button
        type="button"
        onClick={() => setStep("fixed")}
        className="mt-3 flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-2xl bg-surface p-3 text-left ring-1 ring-line-strong ring-inset hover:ring-ink/25 focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-panel text-ink" aria-hidden="true">
          <Repeat size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-ink">Sabit giderlerden ekle</span>
          <span className="block text-xs text-ink-mute">{usableFixed ? `Kira, aidat, internet… ${usableFixed} sabit gider` : "Giderler & maaşlar › Sabit giderler sayfasındaki giderler"}</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-ink-quiet" aria-hidden="true" />
      </button>
      <p className="mt-3 text-xs leading-5 text-ink-mute">
        Vergi tarihleri genel takvimdir (takip eden ayın günü). İşletmenize uyan tarihleri muhasebecinizle kontrol edin.
      </p>
    </Sheet>
  );
}

function FormSheet({
  reminder,
  initial,
  today,
  onBack,
  onClose,
  onDelete,
}: {
  reminder: Reminder | null;
  initial: Draft;
  today: string;
  onBack?: () => void;
  onClose: () => void;
  onDelete: (r: Reminder) => void;
}) {
  const formId = useId();
  const [pending, start] = useActionTransition();
  const [title, setTitle] = useState(initial.title);
  const [kind, setKind] = useState<ReminderKind>(initial.kind);
  const [kindTouched, setKindTouched] = useState(Boolean(reminder || initial.preset !== "Özel"));
  const [amount, setAmount] = useState(initial.amount);
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const [repeat, setRepeat] = useState<ReminderRepeat>(initial.repeat);
  const [before, setBefore] = useState(initial.before);
  const [note, setNote] = useState(initial.note);
  const [endOfMonth, setEndOfMonth] = useState(initial.endOfMonth);
  const branches = useContext(PaymentBranchesContext);
  const [branchId, setBranchId] = useState(reminder ? (reminder.branchId ?? "") : branches.defaultId);
  const showBranch = branches.options.length > 1 || Boolean(branchId);

  const amt = amount.trim() ? parseNumberTR(amount) : null;
  const amountError = amount.trim() && (amt === null || amt < 0) ? "Sayı girin, ör. 12.500 ya da 12500,50" : null;
  const beforeN = parseNumberTR(before);
  const beforeError = beforeN === null || !Number.isInteger(beforeN) || beforeN < 0 || beforeN > 60 ? "0 ile 60 arasında tam gün" : null;
  const invalid = !title.trim() || !dueDate || Boolean(amountError || beforeError);
  const monthly = repeat === "monthly" || repeat === "quarterly";
  const lastDay = Boolean(dueDate) && isLastDayOfMonth(dueDate);
  const eom = monthly && lastDay && (endOfMonth || dueDate.endsWith("-31"));
  const step = (d: number) => setBefore(String(Math.max(0, Math.min(60, Math.round((beforeN ?? 0) + d)))));

  // E-postanın ne zaman gideceği (dueNotifications: önceden · son gün · gecikince)
  const notice = (() => {
    if (!dueDate || beforeError) return null;
    if (dueDate < today) return "Bu tarih geçmişte; ödeme gecikmiş görünür ve bir kez daha hatırlatılır.";
    if (dueDate === today) return "Son gün bugün; bir sonraki sabah gönderiminde listede olur.";
    if (!beforeN) return `E-posta son gün (${dateTR(dueDate)}) sabahı gider.`;
    const first = addDays(dueDate, -beforeN);
    return first > today
      ? `İlk e-posta ${dateTR(first)} sabahı, ikincisi son gün (${dateTR(dueDate)}) gider.`
      : `Hatırlatma aralığı başladı; ilk e-posta bir sonraki sabah gönderiminde gider, son gün ${dateTR(dueDate)}.`;
  })();
  const repeatText = repeat === "none" ? null : repeatLabel(repeat, dueDate || today, eom ? `${(dueDate || today).slice(0, 8)}31` : dueDate);

  const submit = () => {
    if (invalid) return;
    start(async () => {
      const r = await saveReminder({
        id: reminder?.id ?? null,
        title,
        kind,
        amount: amt,
        dueDate,
        repeat,
        remindDaysBefore: Math.round(beforeN ?? 3),
        note: note || null,
        active: reminder?.active ?? true,
        endOfMonth: monthly && lastDay ? eom : false,
        branchId: branchId || null,
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(reminder ? `“${title.trim()}” güncellendi` : `“${title.trim()}” eklendi`, { description: `Son ödeme ${longDateTR(dueDate)}${amt ? ` · ${money(amt)}` : ""}` });
      onClose();
    });
  };

  return (
    <Sheet
      open
      onClose={onClose}
      onBack={onBack}
      size="lg"
      title={reminder ? "Hatırlatıcıyı düzenle" : initial.preset && initial.preset !== "Özel" ? `Yeni hatırlatıcı · ${initial.preset}` : "Yeni hatırlatıcı"}
      description={reminder ? "Tarih sıradaki ödeme günüdür; tekrar edenler ödendi işaretlenince ilerler." : "Tutarı girin, gerekirse günü değiştirin."}
      footerStart={
        reminder ? (
          <Button variant="ghost" className="text-bad hover:bg-bad-soft hover:text-bad max-sm:h-12" onClick={() => onDelete(reminder)} disabled={pending}>
            <Trash2 size={15} /> Sil
          </Button>
        ) : null
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className={cn(SHEET_BTN, reminder && "max-sm:flex-none")}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={pending || invalid} className={SHEET_BTN}>
            {pending ? "Kaydediliyor…" : reminder ? "Kaydet" : "Ekle"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Başlık" className="sm:col-span-2" htmlFor={`${formId}-title`}>
          <Input
            id={`${formId}-title`}
            data-autofocus
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (!kindTouched) setKind(guessKind(e.target.value) ?? "odeme");
            }}
            placeholder="Ör. Kira, KDV, internet"
            maxLength={120}
            required
            enterKeyHint="next"
            className={BIG}
          />
        </Field>
        <Field label="Tutar" hint={amountError ? undefined : "Boş bırakılabilir · 12.500 ya da 12500,50"} error={amountError} htmlFor={`${formId}-amount`}>
          <div className="relative">
            <NumberInput
              id={`${formId}-amount`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
              enterKeyHint="done"
              aria-invalid={Boolean(amountError) || undefined}
              className={cn("pr-9", BIG)}
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-ink-mute">₺</span>
          </div>
        </Field>
        <Field label="Son ödeme günü" htmlFor={`${formId}-due`} hint={dueDate ? longDateTR(dueDate) : undefined}>
          <Input id={`${formId}-due`} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required className={BIG} />
        </Field>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-[13px] font-medium text-ink-soft" id={`${formId}-repeat`}>
            Tekrar
          </span>
          <div role="radiogroup" aria-labelledby={`${formId}-repeat`} className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
            {REMINDER_REPEATS.map((r) => {
              const on = repeat === r.value;
              return (
                <button
                  key={r.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setRepeat(r.value)}
                  className={cn(
                    "h-11 cursor-pointer rounded-xl px-2 text-[13px] font-medium ring-1 transition-colors ring-inset focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:outline-none sm:pointer-fine:h-10",
                    on ? "bg-ink text-on-solid ring-ink" : "bg-surface text-ink-mute ring-line-strong hover:text-ink",
                  )}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
          {repeatText ? <p className="text-xs text-ink-mute">{repeatText}; ödendi işaretlenince sıradaki tarihe geçer.</p> : <p className="text-xs text-ink-mute">Ödendi işaretlenince kapanır.</p>}
          {monthly && lastDay && !dueDate.endsWith("-31") ? (
            <div className="mt-1 flex items-center justify-between gap-3 rounded-xl bg-panel px-3 py-1.5">
              <span className="text-[13px] text-ink-soft">Her ayın son günü (30, 31, 28 Şubat)</span>
              <Switch checked={endOfMonth} onChange={setEndOfMonth} label="Her ayın son günü" />
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-[13px] font-medium text-ink-soft" id={`${formId}-kind`}>
            Tür
          </span>
          <div role="radiogroup" aria-labelledby={`${formId}-kind`} className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {REMINDER_KINDS.map((k) => {
              const on = kind === k.value;
              return (
                <button
                  key={k.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setKind(k.value);
                    setKindTouched(true);
                  }}
                  className={cn(
                    "flex min-h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-xs font-medium ring-1 transition-colors ring-inset focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:outline-none",
                    on ? "bg-panel text-ink ring-ink" : "bg-surface text-ink-mute ring-line-strong hover:text-ink",
                  )}
                >
                  <CategoryWell category={reminderCategory(k.value, k.value === kind ? title : "")} size="sm" />
                  <span className="text-center leading-4">{k.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <Field label="Kaç gün önce haber verilsin" tip="O gün e-posta gider; son gün ve gecikince bir kez daha hatırlatılır." error={beforeError} htmlFor={`${formId}-before`}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Bir gün azalt"
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-surface text-ink-mute ring-1 ring-line-strong ring-inset hover:text-ink sm:pointer-fine:size-9"
            >
              <Minus size={16} />
            </button>
            <div className="relative flex-1">
              <NumberInput
                id={`${formId}-before`}
                inputMode="numeric"
                value={before}
                onChange={(e) => setBefore(e.target.value)}
                aria-invalid={Boolean(beforeError) || undefined}
                className={cn("pr-10 text-center", BIG)}
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink-mute">gün</span>
            </div>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Bir gün artır"
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-surface text-ink-mute ring-1 ring-line-strong ring-inset hover:text-ink sm:pointer-fine:size-9"
            >
              <Plus size={16} />
            </button>
          </div>
        </Field>
        {showBranch ? (
          <Field label="Şube" hint="Şubenin Ödemeler'inde görünür. İşletme geneli (vergi, muhasebe) her şubede görünür." htmlFor={`${formId}-branch`}>
            <Select id={`${formId}-branch`} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">İşletme geneli</option>
              {branches.options.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Not" hint="İsteğe bağlı; e-postada başlığın altında görünür." htmlFor={`${formId}-note`}>
          <Textarea id={`${formId}-note`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className="min-h-12" />
        </Field>
        {notice ? (
          <p className="flex items-start gap-2 rounded-xl bg-panel px-3 py-2.5 text-[13px] leading-5 text-ink-soft sm:col-span-2" aria-live="polite">
            <BellRing size={15} className="mt-0.5 shrink-0 text-ink-mute" aria-hidden="true" />
            <span>{notice}</span>
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}



function FixedSheet({ rows, today, existing, onBack, onClose }: { rows: FixedRow[]; today: string; existing: Set<string>; onBack: () => void; onClose: () => void }) {
  const [pending, start] = useActionTransition();
  const [days, setDays] = useState<Record<number, string>>({});
  const [added, setAdded] = useState<Record<number, string>>({});
  const [q, setQ] = useState("");
  const usable = useMemo(() => rows.filter((r) => r.period !== "gunluk"), [rows]);
  const shown = usable.filter((f) => matches(`${f.name} ${f.section}`, q));
  // Varsayılan: gelecek ayın 1'i
  const defaultFirst = useMemo(() => {
    const [y, m] = today.split("-").map(Number);
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  }, [today]);
  // Bu ay biten giderin ilk ödemesi gelecek aya düşmez (sunucu reddeder): bugün
  const firstFor = (f: FixedRow) => (f.endMonth && f.endMonth < defaultFirst.slice(0, 7) ? today : defaultFirst);
  const add = (f: FixedRow) =>
    start(async () => {
      const r = await addFixedExpenseReminder(f.id, days[f.id] ?? firstFor(f));
      if (!r.ok) return void toast.error(r.error);
      setAdded((a) => ({ ...a, [f.id]: r.data.dueDate }));
      const what =
        r.data.amount === null && r.data.changesFrom
          ? ` · tutar yazılmadı (${monthLabel(r.data.changesFrom)} itibarıyla dönemi değişiyor; nakit planı Giderler'deki tutarı izler)`
          : r.data.amount
            ? ` · ${money(r.data.amount)}${r.data.changesFrom ? `; ${monthLabel(r.data.changesFrom)} itibarıyla Giderler'deki yeni tutarı izler` : ""}`
            : "";
      const ends = r.data.endMonth ? ` · gider ${monthLabel(r.data.endMonth)} ayında bitiyor: sonra hatırlatıcıyı kapatın` : "";
      toast.success(`${f.name} eklendi`, { description: `İlk tarih ${dateTR(r.data.dueDate)}${what}${ends}` });
    });

  return (
    <Sheet
      open
      onClose={onClose}
      onBack={onBack}
      size="lg"
      title="Sabit giderlerden ekle"
      description="İlk ödeme tarihini seçin; gider döneminde (her hafta / ay / yıl) o günden tekrar eder. Günlük giderler listelenmez."
      footer={
        <Button variant="secondary" onClick={onClose} className={SHEET_BTN}>
          Tamam
        </Button>
      }
    >
      {usable.length === 0 ? (
        <EmptyState
          title="Sabit gider yok"
          description="Önce Giderler & maaşlar › Sabit giderler sayfasında kira, aidat, internet gibi sabit giderleri girin."
          action={
            <Link href="/panel/giderler" className="inline-flex h-11 items-center text-sm font-medium text-ink underline">
              Sabit giderlere git
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {usable.length > 6 ? (
            <div className="flex items-center gap-3">
              <SearchField value={q} onChange={setQ} placeholder="Sabit gider ara" shortcut={false} className="flex-1 sm:max-w-72" />
              <span className="text-[13px] whitespace-nowrap text-ink-mute tabular" aria-live="polite">
                {shown.length === usable.length ? `${usable.length} gider` : `${shown.length} / ${usable.length}`}
              </span>
            </div>
          ) : null}
          {shown.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-panel px-4 py-3 text-[13px] text-ink-mute">
              <span className="min-w-0 break-words">“{q.trim()}” için sabit gider yok.</span>
              <Button variant="secondary" size="sm" onClick={() => setQ("")}>
                Aramayı temizle
              </Button>
            </div>
          ) : (
            <ul className="space-y-2">
              {shown.map((f) => {
                const exists = existing.has(fold(f.name));
                const category = reminderCategory(f.section === "kira" ? "kira" : f.section === "personel" ? "maas" : "odeme", f.name);
                return (
                  <li key={f.id} className="flex flex-col gap-3 rounded-2xl bg-panel p-3 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <CategoryWell category={category} size="md" />
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[15px] font-semibold text-ink">
                          <span className="min-w-0 break-words">{f.name}</span>
                          {exists && !added[f.id] ? <Badge tone="gray">Listede var</Badge> : null}
                        </p>
                        <p className="text-[13px] text-ink-mute tabular">
                          {fixedReminderText({ amount: f.amount, period: f.basePeriod, section: f.section, vatRate: f.vatRate, withholdingRate: f.withholdingRate }, f.versions, (days[f.id] ?? firstFor(f)).slice(0, 7))}
                          {f.endMonth ? ` · ${monthLabel(f.endMonth)} ayında bitiyor` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-end gap-2 sm:shrink-0 sm:items-center">
                      <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-ink-mute sm:flex-none sm:flex-row sm:items-center sm:gap-2">
                        <span className="shrink-0">İlk ödeme</span>
                        <Input
                          type="date"
                          className="min-w-0 max-sm:h-11 sm:w-40"
                          value={days[f.id] ?? firstFor(f)}
                          disabled={Boolean(added[f.id])}
                          onChange={(e) => setDays((d) => ({ ...d, [f.id]: e.target.value }))}
                          aria-label={`${f.name} ilk ödeme tarihi`}
                        />
                      </label>
                      {added[f.id] ? (
                        <span className="inline-flex h-11 min-w-[5.5rem] items-center gap-1 text-[13px] font-medium text-good sm:h-9">
                          <Check size={14} aria-hidden="true" /> Eklendi
                        </span>
                      ) : (
                        <Button
                          variant={exists ? "secondary" : "primary"}
                          disabled={pending || !(days[f.id] ?? firstFor(f))}
                          onClick={() => add(f)}
                          className="max-sm:h-11"
                        >
                          <Plus size={14} /> {exists ? "Yine ekle" : "Ekle"}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Sheet>
  );
}

/** Ödenmemiş faturanın vadesi */
export function DueDateSheet({ item, onClose }: { item: { sourceId: number; title: string; amount: number | null; dueDate: string }; onClose: () => void }) {
  const formId = useId();
  const [pending, start] = useActionTransition();
  const [date, setDate] = useState(item.dueDate);
  return (
    <Sheet
      open
      onClose={onClose}
      size="sm"
      title="Fatura vadesi"
      description={`${item.title}${item.amount !== null ? ` · ${money(item.amount)}` : ""}`}
      footerStart={
        <Button
          variant="ghost"
          disabled={pending}
          className="max-sm:h-12"
          onClick={() =>
            start(async () => {
              const r = await setInvoiceDueDate(item.sourceId, null);
              if (!r.ok) return void toast.error(r.error);
              toast.success("Vade kaldırıldı; tahmini vade kullanılacak");
              onClose();
            })
          }
        >
          Vadeyi kaldır
        </Button>
      }
      footer={
        <Button type="submit" form={formId} disabled={pending || !date} className={SHEET_BTN}>
          Kaydet
        </Button>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          if (!date) return;
          start(async () => {
            const r = await setInvoiceDueDate(item.sourceId, date);
            if (!r.ok) return void toast.error(r.error);
            toast.success(`Vade ${dateTR(date)} olarak kaydedildi`);
            onClose();
          });
        }}
      >
        <Field label="Son ödeme günü" htmlFor={`${formId}-date`} hint="Vadesi olmayan faturalarda vade, fatura tarihinden ayarlardaki gün kadar sonra sayılır.">
          <Input id={`${formId}-date`} data-autofocus type="date" value={date} onChange={(e) => setDate(e.target.value)} className={BIG} />
        </Field>
      </form>
    </Sheet>
  );
}
