"use client";

import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, NumberInput } from "@/components/ui/form";
import { parseNumberTR } from "@/lib/calc/expr";
import { money, num } from "@/lib/format";
import { dayMonthTR } from "@/lib/reminders";
import { saveCashBalance } from "@/server/actions/cash-plan";

/**
 * Elinizdeki para: bankadaki ve kasadaki paranın bugünkü toplamı; plan bu tutardan başlar. Eksi yazılabilir (kredili
 * hesap). Son kasa raporunun ertesi güne devrettiği nakit ipucu olarak yazılır.
 */
export function BalanceDialog({ balance, carry, onClose }: { balance: number | null; carry: { date: string; amount: number } | null; onClose: () => void }) {
  const formId = useId();
  const [text, setText] = useState(balance === null ? "" : num(balance, 2));
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const value = text.trim() ? parseNumberTR(text) : null;
  const error = tried && !text.trim() ? "Tutar girin" : text.trim() && value === null ? "Tutarı sayı olarak yazın, ör. 85.000" : null;

  async function save(amount: number | null) {
    setBusy(true);
    const r = await saveCashBalance(amount);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(amount === null ? "Bakiye kaldırıldı" : `Bakiye kaydedildi: ${money(amount)}`);
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Elinizdeki para"
      description="Bankadaki ve kasadaki paranın bugünkü toplamı. Plan bu tutardan başlar; birkaç günde bir güncelleyin."
      footerStart={
        balance !== null ? (
          <Button variant="ghost" disabled={busy} onClick={() => void save(null)}>
            Bakiyeyi kaldır
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
          if (value === null) return;
          void save(value);
        }}
      >
        <Field
          label="Tutar (₺)"
          htmlFor="nakit-bakiye"
          error={error}
          hint={carry ? `Son kasa raporu (${dayMonthTR(carry.date)}): ertesi güne ${money(carry.amount)} devretti.` : "Kredili hesapta eksi yazabilirsiniz."}
        >
          {/* Tam klavye: iPhone'un ondalık tuş takımında eksi yok, kredili hesapta eksi yazılır */}
          <NumberInput
            id="nakit-bakiye"
            inputMode="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="0"
            enterKeyHint="done"
            aria-invalid={error ? true : undefined}
            data-autofocus="always"
            className="pointer-coarse:h-12 pointer-coarse:text-lg"
          />
        </Field>
      </form>
    </Dialog>
  );
}
