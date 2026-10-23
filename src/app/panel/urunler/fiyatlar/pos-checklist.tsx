"use client";

import { CheckCheck, Copy, Store } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/misc";
import type { Size } from "@/lib/calc/types";
import { SIZE_LABELS } from "@/lib/constants";
import { money, num } from "@/lib/format";
import { PRICE_SOURCE_LABEL } from "@/lib/prices/history";
import { agoLabel, groupByCategory, posChangedText, posChecklistText } from "@/lib/prices/pos";
import { todayTR } from "@/lib/reminders";
import type { PosChecklistItem } from "@/server/data/prices";
import { markPosDone, restorePosPending } from "@/server/actions/prices";

const sizeLabel = (s: string) => SIZE_LABELS[s as Size] ?? s;

/**
 * Ürünler › Fiyatlar › Kasaya işle: kasada (ModPOS) eski fiyatı duran ürünler, kategori kategori. Kasada değiştirdikçe
 * işaretlenir; işaretlenen listeden hemen düşer, bildirimdeki "Geri al" geri getirir. Liste düz metin olarak kopyalanıp
 * WhatsApp'a yapıştırılabilir (posChecklistText).
 */
export function PosChecklist({ items }: { items: PosChecklistItem[] }) {
  // İşaretlenenler hemen gizlenir (sunucu yanıtını beklemeden); kasanın geri kalış anıyla tutulur: aynı ürün sonra
  // yeniden listeye girerse (yeni bir fiyat) yine görünür
  const [done, setDone] = useState<ReadonlyMap<number, string>>(() => new Map());
  const [confirmAll, setConfirmAll] = useState(false);
  const [pending, start] = useActionTransition();
  const visible = useMemo(() => items.filter((i) => done.get(i.productId) !== i.since), [items, done]);
  const groups = groupByCategory(visible);

  const forget = (ids: number[]) =>
    setDone((m) => {
      const next = new Map(m);
      for (const id of ids) next.delete(id);
      return next;
    });

  function mark(list: PosChecklistItem[]) {
    if (!list.length) return;
    const ids = list.map((i) => i.productId);
    setDone((m) => new Map([...m, ...list.map((i) => [i.productId, i.since] as const)]));
    start(async () => {
      // Görülen fiyatla: bu arada fiyatı yeniden değişen işaretlenmez, listeye bugünkü fiyatıyla döner
      const r = await markPosDone(list.map((i) => ({ productId: i.productId, price: i.price })));
      if (!r.ok) {
        forget(ids);
        return void toast.error(r.error);
      }
      const changed = posChangedText(r.data.changed);
      if (changed) {
        forget(r.data.changed.map((x) => x.productId));
        toast.warning(changed.title, { description: changed.description, duration: 12_000 });
      }
      const d = r.data.done;
      if (!d.length) return;
      const restore = () => {
        forget(d.map((x) => x.productId));
        void restorePosPending(d.map((x) => ({ productId: x.productId, stalePrice: x.stalePrice, since: x.since }))).then((u) => {
          if (!u.ok) toast.error(u.error);
        });
      };
      toast.success(d.length === 1 ? `${d[0].label} kasada ${money(d[0].price)} olarak işaretlendi` : `${num(d.length)} fiyat kasada işaretlendi`, {
        action: { label: "Geri al", onClick: restore },
      });
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(posChecklistText(visible, todayTR()));
      toast.success("Liste kopyalandı; WhatsApp'a yapıştırabilirsiniz");
    } catch {
      toast.error("Kopyalanamadı: tarayıcı panoya yazmaya izin vermedi");
    }
  }

  const oldest = visible.reduce<string | null>((a, i) => (a === null || i.since < a ? i.since : a), null);

  return (
    <Card>
      <CardHeader
        icon={<Store />}
        title="Kasaya işle"
        description="Panelde ya da sitede değişen fiyatlar ModPOS'a kendiliğinden geçmez. Kasada değiştirdikçe işaretleyin; işaretlenen listeden düşer."
        meta={
          visible.length ? (
            <span className="tabular">
              {num(visible.length)} fiyat{oldest ? ` · en eskisi ${agoLabel(oldest).toLocaleLowerCase("tr-TR")}` : ""}
            </span>
          ) : null
        }
        actions={
          visible.length ? (
            <>
              <Button variant="secondary" onClick={copy}>
                <Copy size={16} aria-hidden="true" /> Metni kopyala
              </Button>
              <Button variant="secondary" onClick={() => setConfirmAll(true)} disabled={pending}>
                <CheckCheck size={16} aria-hidden="true" /> Hepsini işaretle
              </Button>
            </>
          ) : null
        }
      />
      {visible.length ? (
        <CardContent className="space-y-5">
          {groups.map((g) => (
            <section key={g.category} aria-label={g.category}>
              <h3 className="mb-2 flex items-baseline gap-2 text-[13px] font-semibold text-ink-soft">
                {g.category} <span className="font-normal text-ink-quiet tabular">{num(g.items.length)}</span>
              </h3>
              <ul className="divide-y divide-line-strong/70 rounded-2xl bg-surface">
                {g.items.map((i) => (
                  <li key={i.productId}>
                    <label className="flex min-h-14 cursor-pointer items-start gap-3 px-4 py-3 hover:bg-panel/40">
                      <input
                        type="checkbox"
                        checked={false}
                        onChange={() => mark([i])}
                        className="mt-0.5 size-5 shrink-0 cursor-pointer rounded accent-ink"
                        aria-label={`${i.name} ${i.size}: kasada ${money(i.price)} yapıldı`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                          <span className="min-w-0 font-medium break-words text-ink">
                            {i.name} · {sizeLabel(i.size)}
                          </span>
                          <span className="shrink-0 whitespace-nowrap tabular">
                            <s className="text-ink-mute">{money(i.stalePrice)}</s> → <span className="font-semibold text-ink">{money(i.price)}</span>
                          </span>
                        </span>
                        <span className="mt-0.5 block font-mono text-xs leading-5 break-words text-ink-mute">
                          {i.posNames.length ? `Kasada: ${i.posNames.join(" · ")}` : "Kasada adı bilinmiyor (satış raporunda eşleşmemiş)"}
                          {i.changedAt ? ` · ${agoLabel(i.changedAt).toLocaleLowerCase("tr-TR")}` : ""}
                          {i.source ? ` · ${PRICE_SOURCE_LABEL[i.source]}` : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </CardContent>
      ) : (
        <EmptyState
          icon={<CheckCheck />}
          title="Kasa güncel"
          description="Panelde ya da sitede değişen bütün fiyatlar kasada da değiştirildi. Yeni bir fiyat değişince burada listelenir."
        />
      )}
      <ConfirmDialog
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        onConfirm={() => {
          setConfirmAll(false);
          mark(visible);
        }}
        tone="primary"
        confirmLabel="İşaretle"
        title={`${num(visible.length)} fiyatın hepsi kasada değişti mi?`}
        description="İşaretlenen fiyatlar listeden düşer; bildirimdeki Geri al ile geri getirebilirsiniz."
      />
    </Card>
  );
}
