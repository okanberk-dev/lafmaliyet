"use client";

import { History } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { money } from "@/lib/format";
import type { KasaName } from "@/lib/asilpos/kasa";
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
  /**
   * Ürünün eski fiyatı duran kasaları (şube kapsamı A3): seçili şubenin kasası, "Tümü"de birden çok kasa açıkken her
   * biri (`name` şubenin adı). AsilPOS gününde siteye bağlı üründe uyarı hiç gelmez: AsilPOS fiyatı siteden alır
   */
  pos: { branchId: string; name: string | null; kasa: KasaName; stalePrice: number; since: string }[];
}

/**
 * Ürün kartındaki "Fiyat geçmişi": son 20 satış fiyatı değişikliği ve kasada hâlâ eski fiyat duruyorsa uyarı, kasa
 * başına ("Kasada değiştirdim" ürünü o kasanın Kasaya işle listesinden düşürür, bildirimdeki Geri al geri getirir).
 * Sunucudan gelen veriyle çizilir: kayıttan sonra sayfa yenilenince güncellenir (docs/FIYATLAR.md).
 */
export function PriceHistoryCard({ product, history }: { product: { id: number; name: string; size: string }; history: ProductPriceHistoryInfo }) {
  const [pending, start] = useActionTransition();
  // İşaretlenince uyarı hemen kalkar (kasa başına, geri kalış anıyla); aynı ürün sonra yeniden kasada geri kalırsa (başka
  // an) yine görünür
  const [doneSince, setDoneSince] = useState<ReadonlyMap<string, string>>(() => new Map());
  const setDone = (branchId: string, since: string | null) =>
    setDoneSince((m) => {
      const next = new Map(m);
      if (since === null) next.delete(branchId);
      else next.set(branchId, since);
      return next;
    });
  const stale = history.price === null ? [] : history.pos.filter((t) => doneSince.get(t.branchId) !== t.since);
  const today = todayTR();

  function markDone(till: ProductPriceHistoryInfo["pos"][number]) {
    setDone(till.branchId, till.since);
    start(async () => {
      // Görülen fiyatla: sayfa açıldıktan sonra fiyat yeniden değiştiyse işaretlenmez, uyarı bugünkü fiyatla kalır
      const r = await markPosDone([{ productId: product.id, price: history.price! }], till.branchId);
      if (!r.ok) {
        setDone(till.branchId, null);
        return void toast.error(r.error);
      }
      const changed = posChangedText(r.data.changed);
      if (changed) {
        setDone(till.branchId, null);
        return void toast.warning(changed.title, { description: changed.description, duration: 12_000 });
      }
      const d = r.data.done[0];
      if (!d) return;
      toast.success(`${d.label} ${till.name ? `${till.name} kasasında` : "kasada"} ${money(d.price)} olarak işaretlendi`, {
        action: {
          label: "Geri al",
          onClick: () => {
            setDone(till.branchId, null);
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
        {stale.map((t) => (
          <Notice
            key={t.branchId}
            tone="warn"
            live="polite"
            title={`${t.name ? `${t.name} kasasında` : "Kasada"} (${t.kasa}) hâlâ ${money(t.stalePrice)}, panelde ${money(history.price!)}`}
            text={upperFirst(staleForText(t.since))}
            action={
              <Button size="sm" variant="secondary" onClick={() => markDone(t)} disabled={pending}>
                Kasada değiştirdim
              </Button>
            }
          />
        ))}
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

/** "bugünden beri" → "Bugünden beri" (uyarının ikinci satırı cümle başı) */
const upperFirst = (t: string) => t.charAt(0).toLocaleUpperCase("tr-TR") + t.slice(1);
