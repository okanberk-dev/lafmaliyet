"use client";

import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { saveTaxAsset } from "@/server/actions/tax";

import type { AssetData } from "./asset-dialog";

/**
 * Faturası Paraşüt'te silinen varlığı aday faturaya bağlar (plan docs/planlar/vergi.md §3.3 "Bağla"); varlığın öteki
 * alanları aynı kalır, fatura künyesi sunucuda yeniden yazılır. Maliyet faturanın kalanını aşarsa sunucu reddeder.
 */
export function RelinkButton({ asset, invoice }: { asset: AssetData; invoice: { id: number; label: string } }) {
  const [pending, run] = useActionTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() =>
        run(async () => {
          const r = await saveTaxAsset({ ...asset, invoiceId: invoice.id });
          if (!r.ok) return void toast.error(r.error, { duration: 10_000 });
          toast.success(`${asset.name}: ${invoice.label} faturasına bağlandı`);
        })
      }
    >
      {pending ? "Bağlanıyor…" : "Bağla"}
    </Button>
  );
}
