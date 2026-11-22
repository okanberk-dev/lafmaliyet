"use client";

import { ChevronDown, RotateCcw } from "lucide-react";
import { useOptimistic, useState } from "react";
import { toast } from "sonner";

import { EntryConfirm } from "@/app/panel/tedarikciler/[cari]/entry-confirm";
import { AnchorNote } from "@/components/panel/anchor-note";
import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { METHOD_LABEL } from "@/lib/cari/balance";
import type { MonthEffect } from "@/lib/cari/months";
import { dateTimeTR, dateTR, money, num, tl } from "@/lib/format";
import { recentPaidKey, RECENT_PAID_DAYS, type RecentPaid } from "@/lib/recent-paid";
import { unreachable } from "@/lib/unreachable";
import { undoRecentPaid } from "@/server/actions/reminders";

/** Geri alınınca bildirim: başlık ve açıklama */
function undoneText(e: RecentPaid): { title: string; description: string } {
  switch (e.kind) {
    case "invoice":
      return { title: `${e.title} faturası ödenmemişe döndü`, description: "Ödendi işareti geri alındı." };
    case "reminder":
      return { title: `${e.title} geri alındı`, description: "Hatırlatıcı ödenmeden önceki tarihine döndü." };
    case "cari":
      return e.converted
        ? { title: `${e.title} ödemesi silindi`, description: "Kasa satırı eski türüne, gider kaydı yerine döndü; kapattığı kalemler yeniden açık." }
        : { title: `${e.title} ödemesi silindi`, description: "Ödeme sayıldığı kalemlerden çıktı; kapattığı kalemler yeniden açık." };
    default:
      return unreachable(e.kind);
  }
}

/** Satırın türü: "Fatura", "Hatırlatıcı", "Hesaba ödeme" */
function kindText(e: RecentPaid): string {
  switch (e.kind) {
    case "invoice":
      return "Fatura";
    case "reminder":
      return "Hatırlatıcı";
    case "cari":
      return "Hesaba ödeme";
    default:
      return unreachable(e.kind);
  }
}

/**
 * Son ödenenler: "Ödendi" bildirimindeki 8 saniyelik "Geri al" kaçırıldıysa, yanlışlıkla ödendi denen fatura ya da
 * hatırlatıcı 30 gün boyunca buradan geri alınır (fatura ödenmemişe, hatırlatıcı önceki tarihine döner); tedarikçiye
 * girilen ödeme silinir.
 */
export function RecentPaidList({ items }: { items: RecentPaid[] }) {
  const [pending, start] = useActionTransition();
  const [shown, hide] = useOptimistic(items, (state, key: string) => state.filter((e) => recentPaidKey(e) !== key));
  // Ödemeye çevir'in geri alınması gider kaydını geçmiş aya yazacaksa ay adıyla sorulur (K18)
  const [asking, setAsking] = useState<{ entry: RecentPaid; effects: MonthEffect[] } | null>(null);

  const undone = (e: RecentPaid) => {
    const t = undoneText(e);
    toast.success(t.title, { description: t.description });
  };
  const undo = (e: RecentPaid) =>
    start(async () => {
      hide(recentPaidKey(e));
      const r = await undoRecentPaid(e.kind, e.id);
      if (!r.ok) return void toast.error(r.error);
      if (r.data.needs === "past") return void setAsking({ entry: e, effects: r.data.effects });
      undone(e);
    });

  const confirm = asking ? (
    <EntryConfirm
      title="Ödemeye çevirmeyi geri al"
      description={`${asking.entry.title}${asking.entry.amount ? ` · ${tl(asking.entry.amount, 2)}` : ""}: ödeme silinir, Kasa satırı alışverişe, gider kaydı yerine döner.`}
      confirmLabel="Geri al"
      tone="primary"
      initialPast={asking.effects}
      run={(months) => undoRecentPaid(asking.entry.kind, asking.entry.id, months)}
      onDone={() => undone(asking.entry)}
      onClose={() => setAsking(null)}
    />
  ) : null;
  // Liste boşken de çapa (#son-odenenler; Yardım'daki bağlantı) kısa satıra iner (UI-08)
  if (!shown.length)
    return (
      <>
        <AnchorNote id="son-odenenler" className="mt-4 px-1 text-xs leading-5">
          Son ödenenler: son {RECENT_PAID_DAYS} günde “Ödendi” denen kayıt şu an yok.
        </AnchorNote>
        {confirm}
      </>
    );

  return (
    <>
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
                  {kindText(e)}
                  {e.dueDate ? ` · ${dateTR(e.dueDate)}` : ""}
                  {e.amount ? <span className="tabular"> · {money(e.amount)}</span> : null}
                  {e.kind === "cari" && e.method ? ` · ${METHOD_LABEL[e.method]}` : ""}
                  {e.kind === "cari" && e.items ? ` · ${num(e.items)} kalem` : ""} · {e.kind === "cari" ? "girildi" : "ödendi"} {dateTimeTR(e.at)}
                </p>
              </div>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => undo(e)} aria-label={`${e.title}: ${e.kind === "cari" ? "ödemeyi geri al" : "ödendi işaretini geri al"}`} className="shrink-0">
                <RotateCcw size={14} aria-hidden="true" /> Geri al
              </Button>
            </li>
          ))}
        </ul>
      </details>
      {confirm}
    </>
  );
}
