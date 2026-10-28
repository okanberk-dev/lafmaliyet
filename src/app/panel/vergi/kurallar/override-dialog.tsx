"use client";

import { useId, useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, NumberInput } from "@/components/ui/form";
import { parseNumberTR, parsePercentInput } from "@/lib/calc/expr";
import { num } from "@/lib/format";
import { saveTaxOverride } from "@/server/actions/tax";

/** Elle değiştirilebilen kural (sunucuda kurulur) */
export interface OverrideRule {
  key: string;
  title: string;
  /** "oran" yüzde olarak yazılır (19,75), "tl" tutar */
  unit: "oran" | "tl";
  /** Geçerli değer (elle varsa elle) ve tablodaki değer */
  value: number;
  table: number;
  overridden: boolean;
  note: string | null;
  /** Üst sınır (oranda: indirimsiz yasal oran) */
  max: number | null;
}

const show = (r: Pick<OverrideRule, "unit">, v: number) => (r.unit === "oran" ? num(Math.round(v * 10_000) / 100, 2) : num(v, 2, 2));
const withUnit = (r: Pick<OverrideRule, "unit">, v: number) => (r.unit === "oran" ? `%${show(r, v)}` : `${show(r, v)} ₺`);

/**
 * Kurallar › "Değiştir" ve "Elle değer" penceresi (plan docs/planlar/vergi.md §4.5-d, K8): değer ve kaynak / not
 * (zorunlu). "Tablodaki değere dön" elle değeri kaldırır.
 */
export function OverrideButton({ rule }: { rule: OverrideRule }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="xs" onClick={() => setOpen(true)}>
        Değiştir
      </Button>
      {open ? <OverrideDialog rule={rule} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function OverrideDialog({ rule, onClose }: { rule: OverrideRule; onClose: () => void }) {
  const id = useId();
  const [text, setText] = useState(show(rule, rule.value));
  const [note, setNote] = useState(rule.note ?? "");
  const [tried, setTried] = useState(false);
  const [pending, run] = useActionTransition();
  const value = text.trim() ? (rule.unit === "oran" ? parsePercentInput(text) : parseNumberTR(text)) : null;
  const valueError =
    text.trim() && value === null
      ? "Sayı olarak yazın"
      : tried && value === null
        ? "Değer girin"
        : value !== null && value < 0
          ? "Değer sıfır ya da daha büyük olmalı"
          : value !== null && rule.max !== null && value > rule.max + 1e-9
            ? `Değer en çok ${withUnit(rule, rule.max)}`
            : null;
  const noteError = tried && note.trim().length < 3 ? "Kaynak / not yazın (en az 3 karakter)" : null;

  function save(next: number | null) {
    run(async () => {
      const r = await saveTaxOverride({ key: rule.key, value: next, note: note.trim() || null });
      if (!r.ok) return void toast.error(r.error, { duration: 10_000 });
      onClose();
      toast.success(next === null ? `${rule.title}: tablodaki değere dönüldü (${withUnit(rule, rule.table)})` : `${rule.title}: elle ${withUnit(rule, next)}`);
    });
  }

  return (
    <Dialog
      open
      onClose={() => !pending && onClose()}
      size="sm"
      title="Elle değer"
      description={`${rule.title}. Tablodaki değer ${withUnit(rule, rule.table)}. Elle değer bütün tahminlerde kullanılır; kaynağını yazın.`}
      footerStart={
        rule.overridden ? (
          <Button variant="ghost" disabled={pending} onClick={() => save(null)}>
            Tablodaki değere dön
          </Button>
        ) : null
      }
      footerStartOnPhone="body"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Vazgeç
          </Button>
          <Button type="submit" form={`${id}-form`} disabled={pending}>
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <form
        id={`${id}-form`}
        noValidate
        className="space-y-4 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (value === null || valueError || note.trim().length < 3) return;
          save(value);
        }}
      >
        <Field label={rule.unit === "oran" ? "Değer (%)" : "Değer (₺)"} htmlFor={`${id}-deger`} error={valueError} hint={rule.unit === "oran" ? "Yüzde olarak, ör. 19,75" : undefined}>
          <NumberInput
            id={`${id}-deger`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            enterKeyHint="done"
            aria-invalid={valueError ? true : undefined}
            disabled={pending}
            data-autofocus
            className="pointer-coarse:h-12 pointer-coarse:text-lg"
          />
        </Field>
        <Field label="Kaynak / not" htmlFor={`${id}-not`} error={noteError} hint="ör. 6111 teşviki, muhasebeci 24.11.2026">
          <Input
            id={`${id}-not`}
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={noteError ? true : undefined}
            disabled={pending}
            className="pointer-coarse:h-12"
          />
        </Field>
      </form>
    </Dialog>
  );
}
