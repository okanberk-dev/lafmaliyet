"use client";

import { ChevronDown, Undo2 } from "lucide-react";
import { useOptimistic, useState } from "react";
import { toast } from "sonner";

import { tryAction, useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { keepScroll } from "@/components/ui/filters";
import { Avatar } from "@/components/ui/icon-tile";
import { InfoTip } from "@/components/ui/misc";
import { dateTimeTR, dateTR, tl } from "@/lib/format";
import { unignoreParasutBill } from "@/server/actions/invoices";

import { splitSupplier, type IgnoredBill } from "./rules";

/**
 * Panelde silinen Paraşüt faturaları (parasut.ignore). Eşitleme bunları bir daha getirmez; yanlışlıkla silineni
 * "Geri al" listeye döndürür. Nadiren gerektiği için kapalı başlar.
 */
export function DeletedBills({ bills }: { bills: IgnoredBill[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useActionTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [list, hide] = useOptimistic(bills, (state: IgnoredBill[], id: string) => state.filter((b) => b.externalId !== id));

  function restore(b: IgnoredBill) {
    setBusyId(b.externalId);
    keepScroll();
    startTransition(async () => {
      hide(b.externalId);
      const res = await tryAction(() => unignoreParasutBill(b.externalId));
      setBusyId(null);
      if (!res) return;
      if (!res.ok) return void toast.error(res.error);
      toast.success("Paraşüt faturası geri alındı", { description: res.data.message });
    });
  }

  if (!list.length) return null;

  return (
    <Card className="mt-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="silinen-parasut"
        className="flex w-full cursor-pointer items-center gap-3 rounded-3xl px-5 py-4 text-left hover:bg-surface/40 pointer-coarse:min-h-12"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
            Silinen Paraşüt faturaları
            <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-mute tabular ring-1 ring-line ring-inset">{list.length}</span>
          </span>
          <span className="mt-0.5 block text-[13px] text-ink-mute">Panelde sildiğiniz Paraşüt faturaları eşitlemede geri gelmez. Yanlışlıkla sildiyseniz buradan geri alın.</span>
        </span>
        <ChevronDown size={18} className={`shrink-0 text-ink-mute transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open ? (
        <ul id="silinen-parasut" className="divide-y divide-line-strong/70 border-t border-line">
          {list.map((b) => {
            const name = b.supplier ? splitSupplier(b.supplier).base : `Paraşüt faturası #${b.externalId}`;
            return (
              <li key={b.externalId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Avatar name={name} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words text-ink">{name}</p>
                  <p className="text-[13px] text-ink-mute tabular">
                    {[b.date ? dateTR(b.date) : null, b.invoiceNo ? `No ${b.invoiceNo}` : null, b.payable !== null ? tl(b.payable, 2) : null].filter(Boolean).join(" · ") ||
                      "Ayrıntı saklanmamış"}
                  </p>
                  <p className="text-xs text-ink-quiet">
                    {b.deletedAt ? `Silindi ${dateTimeTR(b.deletedAt)}${b.deletedBy ? ` · ${b.deletedBy}` : ""}` : "Bu özellikten önce silinmiş"}
                  </p>
                </div>
                <span className="ml-auto flex items-center gap-1.5">
                  {b.restorable ? null : (
                    <InfoTip text="Kopyası saklanmamış: geri alınca yok sayma kalkar, fatura sonraki Paraşüt eşitlemesinde yeniden gelir. Eski bir faturaysa Paraşüt sayfasından o tarihten eşitleyin." />
                  )}
                  <Button variant="secondary" size="sm" onClick={() => restore(b)} disabled={pending && busyId === b.externalId}>
                    <Undo2 size={14} /> Geri al
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}
