"use client";

import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { monthLabel } from "@/lib/format";
import { refreshStockOnline } from "@/server/actions/stock-estimate";

/**
 * Tahmini stok › "Online siparişleri yenile" (yönetici; docs/STOK-TAHMINI.md § 2): Marina'nın verilen aylarının online
 * siparişlerini siteden çeker. Sonra sayfa sunucudan yenilenir (eylem refresh() çağırır). Kâr-zarar ve tüketim değişmez.
 */
export function OnlineRefresh({ months }: { months: string[] }) {
  const [pending, start] = useActionTransition();

  function run() {
    if (pending || !months.length) return;
    start(async () => {
      const res = await refreshStockOnline({ months });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const failed = res.data.failed.map((f) => `${monthLabel(f.month)}: ${f.error}`).join(" · ");
      if (failed) toast.warning(`${res.data.ok.join(", ")} alındı`, { description: failed });
      else toast.success(`Online siparişler alındı: ${res.data.ok.join(", ")}`);
    });
  }

  return (
    <Button type="button" variant="secondary" size="xs" onClick={run} disabled={pending} aria-busy={pending || undefined}>
      <RefreshCw aria-hidden="true" className={pending ? "size-3.5 motion-safe:animate-spin" : "size-3.5"} />
      {pending ? "Alınıyor…" : "Siteden al"}
    </Button>
  );
}
