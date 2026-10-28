"use client";

import { History, Store } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { money } from "@/lib/format";
import type { KasaName } from "@/lib/lafpos/kasa";
import { historyWhen, PRICE_SOURCE_LABEL, type HistoryRow } from "@/lib/prices/history";
import { posChangedText, staleForText } from "@/lib/prices/pos";
import { todayTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { markPosDone, undoPosMarks } from "@/server/actions/pos-marks";

/** Ürün kartının fiyat geçmişi ve kasanın (ModPOS) durumu (loadProductPriceHistory) */
export interface ProductPriceHistoryInfo {
  rows: HistoryRow[];
  /** Panelin bugünkü fiyatı (sayfa açılırken); "Kasada değiştirdim" kasaya bunun yazıldığını söyler */
  price: number | null;
  posStalePrice: number | null;
  posStaleSince: string | null;
  /** Bugünün kasası (LafPOS gününde siteye bağlı üründe uyarı hiç gelmez: LafPOS fiyatı siteden alır) */
  kasa?: KasaName;
}

/**
 * Ürün kartındaki "Fiyat geçmişi": son 20 satış fiyatı değişikliği ve kasada hâlâ eski fiyat duruyorsa uyarı
 * ("Kasada değiştirdim" ürünü Kasaya işle listesinden düşürür, bildirimdeki Geri al geri getirir). Sunucudan gelen
 * veriyle çizilir: kayıttan sonra sayfa yenilenince güncellenir (docs/FIYATLAR.md).
 */
export function PriceHistoryCard({ product, history }: { product: { id: number; name: string; size: string }; history: ProductPriceHistoryInfo }) {
  const [pending, start] = useActionTransition();
  // İşaretlenince uyarı hemen kalkar; aynı ürün sonra yeniden kasada geri kalırsa (başka an) yine görünür
  const [doneSince, setDoneSince] = useState<string | null>(null);
  const stale = history.price !== null && history.posStalePrice !== null && history.posStaleSince !== null && history.posStaleSince !== doneSince;
  const today = todayTR();

  function markDone() {
    const since = history.posStaleSince;
    setDoneSince(since);
    start(async () => {
      // Görülen fiyatla: sayfa açıldıktan sonra fiyat yeniden değiştiyse işaretlenmez, uyarı bugünkü fiyatla kalır
      const r = await markPosDone([{ productId: product.id, price: history.price! }]);
      if (!r.ok) {
        setDoneSince(null);
        return void toast.error(r.error);
      }
      const changed = posChangedText(r.data.changed);
      if (changed) {
        setDoneSince(null);
        return void toast.warning(changed.title, { description: changed.description, duration: 12_000 });
      }
      const d = r.data.done[0];
      if (!d) return;
      toast.success(`${d.label} kasada ${money(d.price)} olarak işaretlendi`, {
        action: {
          label: "Geri al",
          onClick: () => {
            setDoneSince(null);
            start(async () => {
              const u = await undoPosMarks([d.markId]);
              if (!u.ok) return void toast.error(u.error);
              if (u.data.refused.length) toast.warning(u.data.refused[0].reason);
            });
          },
        },
      });
    });
  }

  return (
    <Card>
      <CardHeader
        icon={<History />}
        title="Fiyat geçmişi"
        actions={
          <Link
            href={`/panel/urunler/fiyatlar?sekme=gecmis&ara=${encodeURIComponent(product.name)}`}
            className="inline-flex min-h-8 items-center text-[13px] font-medium text-ink-soft hover:text-ink hover:underline pointer-coarse:min-h-11"
          >
            Tümü →
          </Link>
        }
      />
      <CardContent className="space-y-3">
        {stale ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn" role="status">
            <p className="flex min-w-0 items-start gap-2">
              <Store size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                Kasada ({history.kasa ?? "ModPOS"}) hâlâ <span className="font-semibold tabular">{money(history.posStalePrice!)}</span>, panelde{" "}
                <span className="tabular">{money(history.price!)}</span> · {staleForText(history.posStaleSince!)}
              </span>
            </p>
            <Button size="sm" variant="secondary" onClick={markDone} disabled={pending}>
              Kasada değiştirdim
            </Button>
          </div>
        ) : null}
        {history.rows.length ? (
          <ul className="divide-y divide-line-strong/70 rounded-2xl bg-surface px-4">
            {history.rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 text-sm">
                <span className="whitespace-nowrap tabular">
                  {r.priceBefore !== null ? (
                    <>
                      <span className="text-ink-mute">{money(r.priceBefore)}</span> →{" "}
                    </>
                  ) : null}
                  <span className="font-semibold text-ink">{money(r.price)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-mute">
                  <span className="tabular">{historyWhen(r.changedAt, today)}</span>
                  <Badge tone={r.source === "site" ? "blue" : r.source === "bulk" || r.source === "undo" ? "coffee" : "gray"}>{PRICE_SOURCE_LABEL[r.source]}</Badge>
                  {r.changedBy && r.source !== "site" ? <span>{r.changedBy}</span> : null}
                  {r.onSite ? <span className={cn("text-info")}>sitede de</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-ink-mute">Fiyat değişikliği kaydı yok. Bundan sonraki değişiklikler burada görünür.</p>
        )}
      </CardContent>
    </Card>
  );
}
