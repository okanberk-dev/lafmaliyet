"use client";

import { toast } from "sonner";

import { tryAction, useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/format";
import { saveTaxAsset, saveTaxClassifications } from "@/server/actions/tax";

/*
 * Demirbaş listelerinin tek dokunuşluk düğmeleri (plan docs/planlar/vergi.md §4.3): "Doğrudan gider" (VUK 313 sınırına
 * kadar, faturanın kalanı edinilen ayın gideri olur) ve "Gider (demirbaş değil)" (aday fatura; bildirimde "Geri al").
 */

/** Kuruluş & Demirbaş faturasının kalanını doğrudan gider yazar (varlık listesine "doğrudan gider" yöntemiyle girer) */
export function DirectExpenseButton({ invoice }: { invoice: { id: number; supplier: string; date: string; remaining: number } }) {
  const [pending, run] = useActionTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() =>
        run(
          async () => {
            const r = await saveTaxAsset({
              name: invoice.supplier,
              invoiceId: invoice.id,
              acquiredOn: invoice.date,
              cost: invoice.remaining,
              kind: "demirbas",
              method: "dogrudan_gider",
              lifeYears: null,
              note: null,
            });
            if (!r.ok) return void toast.error(r.error, { duration: 10_000 });
            toast.success(`Bu yıl gider yazıldı: ${invoice.supplier} · ${money(invoice.remaining)} (Demirbaş listesinde)`);
          },
          { maybeSaved: true },
        )
      }
    >
      {pending ? "Kaydediliyor…" : "Bu yıl gider yaz"}
    </Button>
  );
}

/** Demirbaş adayını "Gider (demirbaş değil)" sayar; bildirimdeki "Geri al" kararı kaldırır */
export function NotAssetButton({ invoice }: { invoice: { id: number; supplier: string } }) {
  const [pending, run] = useActionTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() =>
        run(async () => {
          const r = await saveTaxClassifications({ items: [{ source: "invoice", id: invoice.id, notAsset: true }] });
          if (!r.ok) return void toast.error(r.error, { duration: 10_000 });
          toast.success(`${invoice.supplier}: gider sayıldı (demirbaş değil)`, {
            duration: 10_000,
            action: {
              label: "Geri al",
              onClick: () =>
                void tryAction(() => saveTaxClassifications({ items: [{ source: "invoice", id: invoice.id, notAsset: false }] })).then(
                  (x) => x && (x.ok ? toast.success(`${invoice.supplier}: yeniden demirbaş olabilir`) : toast.error(x.error)),
                ),
            },
          });
        })
      }
    >
      {pending ? "Kaydediliyor…" : "Gider (demirbaş değil)"}
    </Button>
  );
}
