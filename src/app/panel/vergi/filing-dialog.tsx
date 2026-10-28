"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, NumberInput, Select } from "@/components/ui/form";
import { parseNumberTR } from "@/lib/calc/expr";
import { num } from "@/lib/format";
import { FILING_KIND_LABELS, type TaxFilingKind } from "@/lib/tax/corporate";
import { AMOUNT_NEGATIVE, AMOUNT_REQUIRED, FILING_VALUE_FIELDS } from "@/lib/tax/edit";
import { cn } from "@/lib/utils";
import { deleteTaxFiling, saveTaxFiling } from "@/server/actions/tax";

/** Bir dönemin seçeneği: kayıtlı değerler, damganın dolu gelen tutarı, Ödemeler'deki karşılık (sunucuda kurulur) */
export interface FilingOption {
  period: string;
  label: string;
  filing: { id: number; payable: number; stamp: number; values: Record<string, number>; note: string | null; by: string | null } | null;
  defaultStamp: number;
  /** null: karşılığı yok (KDV beyannamesi satışları) */
  reminder: { state: "tek" | "birden_cok" | "yok"; text: string } | null;
  addHref: string | null;
}

export interface FilingKindData {
  kind: TaxFilingKind;
  options: FilingOption[];
}

/** Katlanmış isteğe bağlı alanların başlığı (§4.5-a) */
const OPTIONAL_TITLE: Record<TaxFilingKind, string> = {
  gecici: "Matrah ve hesaplanan vergi · beyannamede yazar; biliyorsanız",
  kv: "Matrah ve hesaplanan vergi · beyannamede yazar; biliyorsanız",
  mphb: "Döküm · tahakkuk fişinde yazar; biliyorsanız",
  kdv_matrah: "Diğer matrahlar ve kafe dışı kısmı · beyannamede yazar; biliyorsanız",
};

const PAYABLE_LABEL: Record<TaxFilingKind, string> = {
  gecici: "Ödenecek",
  kv: "Ödenecek",
  mphb: "Ödenecek (tahakkuk fişindeki vergi toplamı)",
  kdv_matrah: "",
};

/** Alanın ilk metni: küsuratlıysa iki ondalık, değilse tam */
const amountText = (v: number | null | undefined) => (v === null || v === undefined ? "" : Number.isInteger(Math.round(v * 100) / 100) ? num(v, 0) : num(v, 2, 2));

/**
 * "Muhasebecinin rakamını gir" düğmesi ve penceresi (§4.5-a): geçici vergi, kurumlar vergisi, muhtasar ya da KDV
 * beyannamesi satışları. Kaydedince bildirim sunucunun metniyle ("Muhasebecinin rakamı kaydedildi: …"); kayıt varsa
 * "Kaldır" tahmine döner.
 */
export function FilingButton({
  data,
  period,
  label = "Muhasebecinin rakamını gir",
  variant = "secondary",
  size = "sm",
  className,
}: {
  data: FilingKindData;
  /** Açılınca seçili dönem (yoksa ilk seçenek) */
  period?: string;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!data.options.length) return null;
  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open ? <FilingDialog data={data} initialPeriod={period} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

type Fields = { payable: string; stamp: string; values: Record<string, string>; note: string; showOptional: boolean };

/** Dönemin alanları: kayıtlı değerler ya da boş (damga dolu gelir) */
function fieldsOf(kind: TaxFilingKind, option: FilingOption): Fields {
  const f = option.filing;
  const all = FILING_VALUE_FIELDS[kind];
  return {
    payable: amountText(f?.payable),
    stamp: amountText(f ? f.stamp : option.defaultStamp),
    values: Object.fromEntries(all.map((x) => [x.key, amountText(f?.values[x.key])])),
    note: f?.note ?? "",
    showOptional: all.some((x) => !x.required && f?.values[x.key] !== undefined),
  };
}

function FilingDialog({ data, initialPeriod, onClose }: { data: FilingKindData; initialPeriod?: string; onClose: () => void }) {
  const formId = useId();
  const kind = data.kind;
  const [period, setPeriod] = useState(() => (initialPeriod && data.options.some((o) => o.period === initialPeriod) ? initialPeriod : data.options[0].period));
  const option = data.options.find((o) => o.period === period) ?? data.options[0];
  const [form, setForm] = useState<Fields>(() => fieldsOf(kind, option));
  const [alsoReminder, setAlsoReminder] = useState(true);
  const [tried, setTried] = useState(false);
  const [pending, run] = useActionTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const f = option.filing;
  const fields = FILING_VALUE_FIELDS[kind];
  const required = fields.filter((x) => x.required);
  const optional = fields.filter((x) => !x.required);
  const set = (patch: Partial<Fields>) => setForm((x) => ({ ...x, ...patch }));

  // Dönem değişince alanlar o dönemin kaydıyla (ya da boş) yeniden dolar
  function choose(p: string) {
    const next = data.options.find((o) => o.period === p);
    if (!next) return;
    setPeriod(p);
    setForm(fieldsOf(kind, next));
    setTried(false);
  }

  const parse = (s: string) => (s.trim() ? parseNumberTR(s) : null);
  const errorOf = (text: string, signed = false): string | null => {
    const v = parse(text);
    if (!text.trim()) return null;
    if (v === null) return "Sayı olarak yazın, ör. 41.200";
    return v < 0 && !signed ? AMOUNT_NEGATIVE : null;
  };
  const requiredError = (text: string) => (tried && !text.trim() ? AMOUNT_REQUIRED : errorOf(text));
  const withPayable = kind !== "kdv_matrah";
  const payableError = withPayable ? requiredError(form.payable) : null;
  const stampError = withPayable ? requiredError(form.stamp) : null;
  const valueErrors: Record<string, string | null> = Object.fromEntries(fields.map((x) => [x.key, x.required ? requiredError(form.values[x.key]) : errorOf(form.values[x.key], x.signed)]));
  const hasError = Boolean(payableError || stampError || Object.values(valueErrors).some(Boolean));

  function submit() {
    setTried(true);
    const missing = (withPayable && (!form.payable.trim() || !form.stamp.trim())) || required.some((x) => !form.values[x.key].trim());
    if (missing || hasError) {
      if (optional.some((x) => valueErrors[x.key])) set({ showOptional: true });
      return;
    }
    const input = {
      kind,
      period: option.period,
      payable: withPayable ? parse(form.payable) : null,
      stamp: withPayable ? parse(form.stamp) : null,
      values: Object.fromEntries(fields.map((x) => [x.key, parse(form.values[x.key])])),
      note: form.note.trim() || null,
      alsoReminder: option.reminder?.state === "tek" ? alsoReminder : false,
    };
    run(async () => {
      const r = await saveTaxFiling(input);
      if (!r.ok) return void toast.error(r.error, { duration: 10_000 });
      onClose();
      if (r.data.reminder === "birden_cok") toast.warning(r.data.message, { duration: 10_000 });
      else toast.success(r.data.message);
    });
  }

  function remove() {
    const id = f?.id;
    if (!id) return;
    run(async () => {
      const r = await deleteTaxFiling(id);
      if (!r.ok) return void toast.error(r.error, { duration: 10_000 });
      setConfirmDelete(false);
      onClose();
      toast.success(r.data.message);
    });
  }

  const big = "pointer-coarse:h-12 pointer-coarse:text-lg";
  const valueField = (x: (typeof fields)[number]) => (
    <Field key={x.key} label={x.label} htmlFor={`${formId}-${x.key}`} error={valueErrors[x.key]}>
      <NumberInput
        id={`${formId}-${x.key}`}
        value={form.values[x.key]}
        onChange={(e) => {
          const v = e.target.value;
          setForm((s) => ({ ...s, values: { ...s.values, [x.key]: v } }));
        }}
        onFocus={(e) => e.currentTarget.select()}
        // Eksi girilebilen alanda (zararda matrah) iOS'un ondalık klavyesinde eksi yok
        inputMode={x.signed ? "text" : "decimal"}
        placeholder={x.required ? "0" : "İsteğe bağlı"}
        enterKeyHint="done"
        aria-invalid={valueErrors[x.key] ? true : undefined}
        disabled={pending}
        className={big}
      />
    </Field>
  );

  return (
    <Dialog
      open
      onClose={() => !pending && onClose()}
      size="md"
      title="Muhasebecinin rakamı"
      description={`${FILING_KIND_LABELS[kind]}: muhasebecinizin beyannamesindeki ya da tahakkuk fişindeki rakam. Girdiğinizde tahminin yerine geçer.`}
      footerStart={
        f ? (
          <Button variant="ghost" className="text-bad" disabled={pending} onClick={() => setConfirmDelete(true)}>
            Kaldır
          </Button>
        ) : null
      }
      footerStartOnPhone="body"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? "Kaydediliyor…" : "Kaydet"}
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
          submit();
        }}
      >
        <Field label="Dönem" htmlFor={`${formId}-donem`}>
          <Select id={`${formId}-donem`} value={period} onChange={(e) => choose(e.target.value)} disabled={pending} className="pointer-coarse:h-12">
            {data.options.map((o) => (
              <option key={o.period} value={o.period}>
                {o.label}
                {o.filing ? " · girildi" : ""}
              </option>
            ))}
          </Select>
        </Field>
        {f ? (
          <p className="rounded-xl bg-panel px-3 py-2 text-[13px] leading-5 text-ink-mute">
            Bu dönem için kayıt var{f.by ? ` (${f.by})` : ""}; kaydedince üstüne yazılır.
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          {withPayable ? (
            <>
              <Field label={PAYABLE_LABEL[kind]} htmlFor={`${formId}-odenecek`} error={payableError}>
                <NumberInput
                  id={`${formId}-odenecek`}
                  value={form.payable}
                  onChange={(e) => set({ payable: e.target.value })}
                  onFocus={(e) => e.currentTarget.select()}
                  placeholder="0"
                  enterKeyHint="done"
                  aria-invalid={payableError ? true : undefined}
                  disabled={pending}
                  data-autofocus
                  className={big}
                />
              </Field>
              <Field label="Damga vergisi" htmlFor={`${formId}-damga`} error={stampError}>
                <NumberInput
                  id={`${formId}-damga`}
                  value={form.stamp}
                  onChange={(e) => set({ stamp: e.target.value })}
                  onFocus={(e) => e.currentTarget.select()}
                  placeholder="0"
                  enterKeyHint="done"
                  aria-invalid={stampError ? true : undefined}
                  disabled={pending}
                  className={big}
                />
              </Field>
            </>
          ) : (
            required.map(valueField)
          )}
        </div>

        {optional.length ? (
          <div className="rounded-2xl bg-panel">
            <button
              type="button"
              aria-expanded={form.showOptional}
              onClick={() => set({ showOptional: !form.showOptional })}
              className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-2xl px-3.5 py-2 text-left text-[13px] font-medium text-ink-soft outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30"
            >
              <span className="min-w-0">{OPTIONAL_TITLE[kind]}</span>
              <ChevronDown size={16} aria-hidden="true" className={cn("shrink-0 text-ink-quiet transition-transform", form.showOptional && "rotate-180")} />
            </button>
            {form.showOptional ? <div className="grid gap-4 px-3.5 pb-3.5 sm:grid-cols-2">{optional.map(valueField)}</div> : null}
          </div>
        ) : null}
        {kind === "gecici" ? <p className="-mt-2 text-xs text-ink-mute">Matrah girilmezse kayıt kesin tutardır ama sonraki dönemin tahmini panelin verisiyle yapılır.</p> : null}

        <Field label="Not" htmlFor={`${formId}-not`}>
          <Input id={`${formId}-not`} value={form.note} maxLength={300} onChange={(e) => set({ note: e.target.value })} placeholder="İsteğe bağlı" disabled={pending} className={big} />
        </Field>

        {option.reminder ? (
          <div className="space-y-1 rounded-2xl bg-panel px-3.5 py-3 text-[13px] leading-5">
            <p className="text-ink-soft">
              {option.reminder.text}
              {option.reminder.state === "yok" && option.addHref ? (
                <>
                  {" · "}
                  <Link href={option.addHref} className="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink">
                    Ödemeler&apos;e ekle
                  </Link>
                </>
              ) : null}
            </p>
            {option.reminder.state === "tek" ? (
              <Checkbox label="Ödemeler'deki hatırlatıcıya da yaz" checked={alsoReminder} onChange={(e) => setAlsoReminder(e.target.checked)} disabled={pending} />
            ) : null}
          </div>
        ) : null}
      </form>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        pending={pending}
        title="Muhasebecinin rakamı kaldırılsın mı?"
        description={`${FILING_KIND_LABELS[kind]} ${option.label} için girilen rakam silinir; tahmin kullanılır. Ödemeler'deki tutara dokunulmaz.`}
        confirmLabel="Kaldır"
      />
    </Dialog>
  );
}
