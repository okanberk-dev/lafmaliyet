"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import { setStockReceipt } from "@/server/actions/stock-estimate";

/** Seçilmemiş faturanın değeri (Segmented boş metinle çalışır) */
const NONE = "";

/**
 * Faturanın malının geldiği şube (yönetici; Tahmini stok › Marina'ya gelen faturalar, docs/STOK-TAHMINI.md § 3).
 * Seçim hemen yazılır; olmazsa eski seçime döner. Yalnız tahmini stok okur: fatura, ödeme ve maliyet değişmez.
 */
export function ReceiptChoice({ invoiceId, label, value, branches }: { invoiceId: number; label: string; value: string | null; branches: { id: string; name: string }[] }) {
  const [choice, setChoice] = useState(value ?? NONE);
  const [pending, start] = useActionTransition();

  function choose(next: string) {
    if (next === choice || pending) return;
    const prev = choice;
    setChoice(next);
    start(async () => {
      try {
        const res = await setStockReceipt({ invoiceId, branchId: next === NONE ? null : next });
        if (!res.ok) {
          setChoice(prev);
          toast.error(res.error);
        }
      } catch (e) {
        setChoice(prev);
        throw e;
      }
    });
  }

  return (
    <div aria-busy={pending || undefined} className={cn("min-w-0", pending && "pointer-events-none opacity-60")}>
      <Segmented
        label={`${label}: malın geldiği şube`}
        value={choice}
        onChange={choose}
        options={[{ value: NONE, label: "Seçilmedi" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
      />
    </div>
  );
}
