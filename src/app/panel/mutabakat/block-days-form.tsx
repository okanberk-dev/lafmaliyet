"use client";

import { useId, useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { BLOCK_DAYS_MAX, blockDaysError } from "@/lib/mutabakat/pos";
import { savePosBlockDays } from "@/server/actions/mutabakat";

/** POS bloke günü: satıştan kaç gün sonra hesaba geçer (0 = aynı gün) */
export function BlockDaysForm({ value }: { value: number }) {
  const id = useId();
  const [text, setText] = useState(String(value));
  const [pending, start] = useActionTransition();
  const n = Number(text.trim());
  const error = text.trim() === "" ? "Bloke gününü yazın" : blockDaysError(n);
  const changed = !error && n !== value;
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!changed) return;
        start(async () => {
          const r = await savePosBlockDays(n);
          if (!r.ok) return void toast.error(r.error);
          toast.success(`Bloke günü ${n} gün olarak kaydedildi`);
        });
      }}
    >
      <Field label="Bloke günü" htmlFor={id} error={text.trim() && error ? error : undefined} hint={`0 ile ${BLOCK_DAYS_MAX} arası; ertesi gün ödeme: 1`} className="w-44">
        <Input id={id} inputMode="numeric" value={text} onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))} aria-invalid={Boolean(text.trim() && error)} />
      </Field>
      <Button type="submit" variant="secondary" disabled={!changed || pending}>
        {pending ? "Kaydediliyor…" : "Kaydet"}
      </Button>
    </form>
  );
}
