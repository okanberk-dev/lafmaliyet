"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/form";
import { NOT_INGREDIENT_REASONS, REASON_HINT, REASON_LABEL, type NotIngredientReason } from "@/lib/invoice-split";
import { cn } from "@/lib/utils";

/**
 * "Hammadde değil" denince kategori sorulur (sahibin isteği, 25 Kasım 2026; src/lib/invoice-split.ts): Sarf, Demirbaş,
 * Hizmet ya da Deneme. Neden kalemin gelir-giderde nereye yazılacağını belirler (Sarf → Temizlik & Sarf gideri,
 * Demirbaş → Kuruluş & Demirbaş ve Vergi › Demirbaş'ta öneri, Hizmet → Hizmet, Deneme → mal alışı). "Bu tedarikçinin
 * hep" işaretlenirse tedarikçi kuralı da açılır: tedarikçinin bağlanmamış kalemleri bekleyenlere düşmez.
 */
export function NotIngredientDialog({
  productName,
  supplier,
  initial = null,
  pending,
  onClose,
  onConfirm,
}: {
  productName: string;
  supplier: string;
  /** AI'nin ya da önceki seçimin önerdiği neden */
  initial?: NotIngredientReason | null;
  pending?: boolean;
  onClose: () => void;
  onConfirm: (reason: NotIngredientReason, supplierRule: boolean) => void;
}) {
  const [reason, setReason] = useState<NotIngredientReason | null>(initial);
  const [rule, setRule] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Hammadde değil: nereye yazılsın?"
      description={productName}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button disabled={!reason || pending} onClick={() => reason && onConfirm(reason, rule)}>
            Kaydet
          </Button>
        </>
      }
    >
      <fieldset className="grid gap-2">
        <legend className="sr-only">Neden</legend>
        {NOT_INGREDIENT_REASONS.map((r) => (
          <label
            key={r}
            className={cn(
              "flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl px-3.5 py-2.5 ring-1 ring-line transition-colors",
              reason === r ? "bg-surface ring-ink/40" : "hover:bg-surface/60",
            )}
          >
            <input type="radio" name="neden" value={r} checked={reason === r} onChange={() => setReason(r)} className="mt-1 size-4 accent-ink pointer-coarse:size-5" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{REASON_LABEL[r]}</span>
              <span className="block text-xs leading-5 text-ink-mute">{REASON_HINT[r]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Checkbox
        className="mt-3"
        checked={rule}
        onChange={(e) => setRule(e.target.checked)}
        label={`${supplier}: hep hammadde değil (bağlanmamış bütün kalemleri, hammaddeye bağlı olanlar hariç)`}
      />
    </Dialog>
  );
}
