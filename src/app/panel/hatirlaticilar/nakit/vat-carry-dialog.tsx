"use client";

import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, NumberInput, Select } from "@/components/ui/form";
import { shiftMonth } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import type { CashPlanState } from "@/lib/cash-plan";
import { money, monthLabel, num } from "@/lib/format";
import { saveVatCarry } from "@/server/actions/cash-plan";

/**
 * Devreden KDV: muhasebecinin son beyannamesindeki "sonraki döneme devreden KDV". Tahmin zinciri bu aydan devam eder
 * (src/lib/kdv.ts). Ay seçenekleri son üç bitmiş ay (kayıtlı ay dışındaysa o da); varsayılan kayıtlı ay, yoksa ayın
 * 20'sinden sonra geçen ay (beyanname verilmiştir), önce bir önceki ay.
 */
export function VatCarryDialog({ carry, today, onClose }: { carry: CashPlanState["vatCarry"]; today: string; onClose: () => void }) {
  const formId = useId();
  const cur = today.slice(0, 7);
  const recent = [1, 2, 3].map((k) => shiftMonth(cur, -k));
  const options = carry && !recent.includes(carry.month) ? [...recent, carry.month].sort().reverse() : recent;
  const [month, setMonth] = useState(carry?.month ?? (Number(today.slice(8, 10)) >= 20 ? recent[0] : recent[1]));
  const [text, setText] = useState(carry ? num(carry.amount, 2) : "");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const value = text.trim() ? parseNumberTR(text) : null;
  const error = !text.trim()
    ? tried
      ? "Tutar girin (0 olabilir)"
      : null
    : value === null
      ? "Tutarı sayı olarak yazın, ör. 140.000"
      : value < 0
        ? "Tutar eksi olamaz"
        : null;

  async function save(input: { month: string; amount: number } | null) {
    setBusy(true);
    const r = await saveVatCarry(input);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(input ? `Devreden KDV kaydedildi: ${money(input.amount)} (${monthLabel(input.month)})` : "Devreden KDV kaldırıldı; panelin hesabı kullanılıyor");
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Devreden KDV"
      description="Muhasebecinizin son KDV beyannamesinde “sonraki döneme devreden KDV” yazan tutar. Tahmin bu tutardan devam eder."
      footerStart={
        carry ? (
          <Button variant="ghost" disabled={busy} onClick={() => void save(null)}>
            Kaldır
          </Button>
        ) : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-3 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (value === null || value < 0) return;
          void save({ month, amount: value });
        }}
      >
        <Field label="Hangi ayın beyannamesi?" htmlFor="kdv-ay">
          <Select id="kdv-ay" value={month} onChange={(e) => setMonth(e.target.value)}>
            {options.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Devreden tutar (₺)" htmlFor="kdv-devreden" error={error} hint="Devreden yoksa 0 yazın">
          <NumberInput
            id="kdv-devreden"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="0"
            enterKeyHint="done"
            aria-invalid={error ? true : undefined}
            className="pointer-coarse:h-12 pointer-coarse:text-lg"
          />
        </Field>
      </form>
    </Dialog>
  );
}
