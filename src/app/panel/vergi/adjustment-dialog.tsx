"use client";

import { Pencil } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, NumberInput, Select } from "@/components/ui/form";
import { parseNumberTR } from "@/lib/calc/expr";
import { num } from "@/lib/format";
import { ADJUSTMENT_LABELS, type AdjustmentKind, BEYANNAME_ADJ_WARNING, QUARTER_SPAN_KINDS } from "@/lib/tax/pnl";
import { deleteTaxAdjustment, saveTaxAdjustment } from "@/server/actions/tax";

export interface AdjustmentRow {
  id: number;
  month: string;
  span: "ay" | "ceyrek";
  kind: AdjustmentKind;
  amount: number;
  label: string;
  note: string | null;
}

/** Pencerenin seçenekleri (sunucuda kurulur) */
export interface AdjustmentChoices {
  /** Hesap dönemindeki aylar, bu aya kadar, yeni önce */
  months: { value: string; label: string }[];
  /** Bitmiş (son ayı bu ay ya da önce) çeyrekler: değer çeyreğin son ayı */
  quarters: { value: string; label: string; key: string }[];
  /** Muhasebeci kaydı girilmiş geçici vergi dönemleri ("2026-Q3") */
  filedQuarters: string[];
  /** KDV beyannamesi satışları girilmiş aylar */
  matrahMonths: string[];
}

const KINDS = Object.keys(ADJUSTMENT_LABELS) as AdjustmentKind[];
const quarterOf = (month: string) => `${month.slice(0, 4)}-Q${Math.ceil(Number(month.slice(5, 7)) / 3)}`;
const amountText = (v: number) => (Number.isInteger(Math.round(v * 100) / 100) ? num(v, 0) : num(v, 2, 2));

/** "Düzeltme ekle" ya da satırın düzenle düğmesi ve "Düzeltme" penceresi (plan docs/planlar/vergi.md §4.5-b) */
export function AdjustmentButton({ choices, row, variant = "secondary" }: { choices: AdjustmentChoices; row?: AdjustmentRow; variant?: "primary" | "secondary" }) {
  const [open, setOpen] = useState(false);
  if (!choices.months.length) return null;
  return (
    <>
      {row ? (
        <IconButton label={`${row.label}: düzenle`} onClick={() => setOpen(true)}>
          <Pencil size={15} />
        </IconButton>
      ) : (
        <Button variant={variant} size="sm" onClick={() => setOpen(true)}>
          Düzeltme ekle
        </Button>
      )}
      {open ? <AdjustmentDialog choices={choices} row={row} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function AdjustmentDialog({ choices, row, onClose }: { choices: AdjustmentChoices; row?: AdjustmentRow; onClose: () => void }) {
  const formId = useId();
  const [kind, setKind] = useState<AdjustmentKind>(row?.kind ?? "gelir_kafe_disi");
  const [span, setSpan] = useState<"ay" | "ceyrek">(row?.span ?? "ay");
  const [month, setMonth] = useState(row && row.span === "ay" ? row.month : (choices.months[0]?.value ?? ""));
  const [quarterMonth, setQuarterMonth] = useState(row && row.span === "ceyrek" ? row.month : (choices.quarters[0]?.value ?? ""));
  const [amountTextValue, setAmount] = useState(row ? amountText(row.amount) : "");
  const [label, setLabel] = useState(row?.label ?? "");
  const [note, setNote] = useState(row?.note ?? "");
  const [tried, setTried] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, run] = useActionTransition();

  const quarterAllowed = QUARTER_SPAN_KINDS.includes(kind) && choices.quarters.length > 0;
  const effSpan = quarterAllowed ? span : "ay";
  const target = effSpan === "ceyrek" ? quarterMonth : month;
  const amount = amountTextValue.trim() ? parseNumberTR(amountTextValue) : null;
  const amountError = amountTextValue.trim() && amount === null ? "Sayı olarak yazın, ör. 12.400" : tried && (amount === null || amount <= 0) ? "Tutar sıfırdan büyük olmalı" : null;
  const labelError = tried && !label.trim() ? "Açıklama gerekli" : null;
  const warnings = [
    target && choices.filedQuarters.includes(quarterOf(target)) ? "Bu dönemin beyannamesi girildi; düzeltme yalnız sonraki tahmini etkiler." : null,
    kind === "gelir_kafe_disi" && effSpan === "ay" && choices.matrahMonths.includes(target) ? BEYANNAME_ADJ_WARNING : null,
  ].filter((w): w is string => w !== null);

  function submit() {
    setTried(true);
    if (!target || amount === null || amount <= 0 || !label.trim()) return;
    const input = { id: row?.id ?? null, month: target, span: effSpan, kind, amount, label: label.trim(), note: note.trim() || null };
    run(
      async () => {
        const r = await saveTaxAdjustment(input);
        if (!r.ok) return void toast.error(r.error, { duration: 10_000 });
        onClose();
        toast.success(row ? "Düzeltme kaydedildi" : "Düzeltme eklendi");
        for (const w of r.data.warnings) toast.warning(w, { duration: 10_000 });
      },
      { maybeSaved: !row },
    );
  }

  function remove() {
    if (!row) return;
    run(async () => {
      const r = await deleteTaxAdjustment(row.id);
      if (!r.ok) return void toast.error(r.error, { duration: 10_000 });
      setConfirmDelete(false);
      onClose();
      toast.success("Düzeltme kaldırıldı");
    });
  }

  const big = "pointer-coarse:h-12 pointer-coarse:text-lg";
  return (
    <Dialog
      open
      onClose={() => !pending && onClose()}
      size="md"
      title={row ? "Düzeltme" : "Düzeltme ekle"}
      description="Panelin görmediği gelir ve gider (KDV hariç): şirketin kafe dışı işleri, faiz, belgeli ama panelde olmayan giderler, indirilemeyen giderler ve muhasebecinin söylediği indirimler."
      footerStart={
        row ? (
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
        <Field label="Tür" htmlFor={`${formId}-tur`}>
          <Select id={`${formId}-tur`} value={kind} onChange={(e) => setKind(e.target.value as AdjustmentKind)} disabled={pending} className="pointer-coarse:h-12">
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {ADJUSTMENT_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dönem" htmlFor={`${formId}-donem`} hint={quarterAllowed ? undefined : "Çeyrek yalnız kafe dışı gelir ve giderde"}>
            <Select
              id={`${formId}-donem`}
              value={effSpan}
              onChange={(e) => setSpan(e.target.value as "ay" | "ceyrek")}
              disabled={pending || !quarterAllowed}
              className="pointer-coarse:h-12"
            >
              <option value="ay">Ay</option>
              <option value="ceyrek">Çeyrek</option>
            </Select>
          </Field>
          {effSpan === "ceyrek" ? (
            <Field label="Çeyrek" htmlFor={`${formId}-ceyrek`} hint="Tutar çeyreğin son ayına yazılır">
              <Select id={`${formId}-ceyrek`} value={quarterMonth} onChange={(e) => setQuarterMonth(e.target.value)} disabled={pending} className="pointer-coarse:h-12">
                {choices.quarters.map((q) => (
                  <option key={q.value} value={q.value}>
                    {q.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Ay" htmlFor={`${formId}-ay`}>
              <Select id={`${formId}-ay`} value={month} onChange={(e) => setMonth(e.target.value)} disabled={pending} className="pointer-coarse:h-12">
                {choices.months.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <Field label="Tutar (₺, KDV hariç)" htmlFor={`${formId}-tutar`} error={amountError}>
          <NumberInput
            id={`${formId}-tutar`}
            value={amountTextValue}
            onChange={(e) => setAmount(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="0"
            enterKeyHint="done"
            aria-invalid={amountError ? true : undefined}
            disabled={pending}
            className={big}
          />
        </Field>
        <Field label="Açıklama" htmlFor={`${formId}-aciklama`} error={labelError}>
          <Input
            id={`${formId}-aciklama`}
            value={label}
            maxLength={120}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="ör. Karaoke box Eylül satışları"
            aria-invalid={labelError ? true : undefined}
            disabled={pending}
            className={big}
          />
        </Field>
        <Field label="Not" htmlFor={`${formId}-not`}>
          <Input id={`${formId}-not`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="İsteğe bağlı" disabled={pending} className={big} />
        </Field>
        {warnings.length ? (
          <ul className="space-y-1 rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13px] leading-5 text-warn">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
      </form>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        pending={pending}
        title="Düzeltme kaldırılsın mı?"
        description={row ? `${row.label} (${ADJUSTMENT_LABELS[row.kind]}) vergi hesabından çıkar.` : undefined}
        confirmLabel="Kaldır"
      />
    </Dialog>
  );
}
