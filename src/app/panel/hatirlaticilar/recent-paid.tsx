"use client";

import { ChevronDown, RotateCcw } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { dateTimeTR, dateTR, money, num } from "@/lib/format";
import { recentPaidKey, RECENT_PAID_DAYS, type RecentPaid } from "@/lib/recent-paid";
import { undoRecentPaid } from "@/server/actions/reminders";

/**
 * Son ödenenler: "Ödendi" bildirimindeki 8 saniyelik "Geri al" kaçırıldıysa, yanlışlıkla ödendi denen fatura ya da
 * hatırlatıcı 30 gün boyunca buradan geri alınır (fatura ödenmemişe, hatırlatıcı önceki tarihine döner).
 */
export function RecentPaidList({ items }: { items: RecentPaid[] }) {
  const [pending, start] = useTransition();
  const [shown, hide] = useOptimistic(items, (state, key: string) => state.filter((e) => recentPaidKey(e) !== key));
  if (!shown.length) return null;

  const undo = (e: RecentPaid) =>
    start(async () => {
      hide(recentPaidKey(e));
      const r = await undoRecentPaid(e.kind, e.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success(e.kind === "invoice" ? `${e.title} yeniden ödenmedi` : `${e.title} geri alındı`, {
        description: e.kind === "invoice" ? "Fatura ödenmemişler listesine döndü." : "Hatırlatıcı ödenmeden önceki tarihine döndü.",
      });
    });

  return (
    <details id="son-odenenler" className="group/r mt-4 scroll-mt-20 rounded-2xl bg-surface ring-1 ring-line">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ink/30 [&::-webkit-details-marker]:hidden">
        <RotateCcw size={16} className="shrink-0 text-ink-mute" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink">Son ödenenler · {num(shown.length)}</span>
          <span className="block text-xs text-ink-mute">Son {RECENT_PAID_DAYS} günde “Ödendi” denenler; yanlışlıkla işaretlediyseniz geri alın.</span>
        </span>
        <ChevronDown size={16} className="shrink-0 text-ink-quiet transition-transform group-open/r:rotate-180" aria-hidden="true" />
      </summary>
      <ul className="divide-y divide-ink/[0.06] px-4 pb-1.5">
        {shown.map((e) => (
          <li key={recentPaidKey(e)} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium break-words text-ink">{e.title}</p>
              <p className="mt-0.5 text-xs break-words text-ink-mute">
                {e.kind === "invoice" ? "Fatura" : "Hatırlatıcı"}
                {e.dueDate ? ` · ${dateTR(e.dueDate)}` : ""}
                {e.amount ? <span className="tabular"> · {money(e.amount)}</span> : null} · ödendi {dateTimeTR(e.at)}
              </p>
            </div>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => undo(e)} aria-label={`${e.title}: ödendi işaretini geri al`} className="shrink-0">
              <RotateCcw size={14} aria-hidden="true" /> Geri al
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}
