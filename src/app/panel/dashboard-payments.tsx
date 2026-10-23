"use client";

import { BellRing } from "lucide-react";
import Link from "next/link";
import { useOptimistic } from "react";

import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DotList } from "@/components/ui/misc";
import { money } from "@/lib/format";
import { CATEGORY_LABEL, daysLeftLabel, type UpcomingItem } from "@/lib/reminders";
import { cn } from "@/lib/utils";

import { CategoryWell, categoryOf, DateTile, itemKey, PaidButton, URGENCY, urgencyOf, usePaymentActions } from "./hatirlaticilar/payment-ui";

/**
 * Genel bakış: gecikmiş ve 7 gün içindeki ödemeler (Ödemeler & hatırlatıcılar'dan; liste sayfada bir kez
 * okunur, "Bu ayın işleri" de aynısını kullanır). Takvim yaprağı, aciliyet rengi ve tek dokunuşla "Ödendi"
 * (8 saniye geri alınabilir). Yoksa hiç görünmez; sayfa sakin kalsın.
 */
export function DashboardPayments({ items, className }: { items: UpcomingItem[]; className?: string }) {
  const [visible, hide] = useOptimistic(items, (state, key: string) => state.filter((i) => itemKey(i) !== key));
  const { busy, pay } = usePaymentActions(hide);
  const nearAll = visible.filter((i) => i.status !== "later");
  const near = nearAll.slice(0, 4);
  if (!near.length) return null;
  const overdue = nearAll.filter((i) => i.status === "overdue");
  const sum = (list: UpcomingItem[]) => list.reduce((a, i) => a + (i.amount ?? 0), 0);
  const total = sum(nearAll);
  // Gecikenlerin toplamı ayrı yazılır: "Bu ayın işleri"ndeki gecikme tutarıyla aynı olsun, vadesi gelmemiş öğe karışmasın
  const overdueTotal = sum(overdue);
  const soonTotal = total - overdueTotal;

  return (
    <Card className={className}>
      <CardHeader
        icon={<BellRing />}
        title="Yaklaşan ödemeler"
        description={
          overdue.length
            ? `${overdue.length} ödeme gecikti · ${money(overdueTotal)}${soonTotal > 0 ? ` · 7 gün içinde ${money(soonTotal)}` : ""}`
            : `Önümüzdeki 7 gün · ${money(total)}`
        }
        actions={
          <ButtonLink href="/panel/hatirlaticilar" variant="secondary" size="sm" className="pointer-coarse:h-11">
            Tümü{nearAll.length > near.length ? ` (${nearAll.length})` : ""}
          </ButtonLink>
        }
      />
      <CardContent className="px-3 sm:px-5">
        <ul className="space-y-2">
          {near.map((i) => {
            const u = URGENCY[urgencyOf(i.daysLeft)];
            const category = categoryOf(i);
            const amount = i.amount !== null ? money(i.amount) : null;
            const paid = <PaidButton compact onClick={() => pay(i)} disabled={busy(itemKey(i))} label={`${i.title} ödendi`} />;
            return (
              // Telefonda başlık tüm genişliği kullanır; tutar ve "Ödendi" alt satırda (başparmak hizasında)
              <li key={itemKey(i)} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 rounded-2xl bg-surface p-3 ring-1 ring-line sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                <DateTile date={i.dueDate} daysLeft={i.daysLeft} />
                <Link href="/panel/hatirlaticilar" className="min-w-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ink/30">
                  <span className="block text-[15px] leading-5 font-semibold tracking-[-0.01em] text-pretty break-words text-ink">{i.title}</span>
                  <DotList className="mt-1 text-[13px] leading-5">
                    <span className={cn("inline-flex items-center gap-1.5 font-medium", u.text)}>
                      <span className={cn("size-1.5 rounded-full", u.dot)} aria-hidden="true" />
                      {daysLeftLabel(i.daysLeft)}
                    </span>
                    <span className="inline-flex items-center gap-1 text-ink-mute">
                      <CategoryWell category={category} size="xs" />
                      {i.source === "invoice" ? "Fatura" : CATEGORY_LABEL[category]}
                    </span>
                  </DotList>
                </Link>
                <div className="hidden flex-col items-end gap-2 sm:flex">
                  <span className="text-[15px] leading-5 font-semibold whitespace-nowrap text-ink tabular">{amount ?? <span className="text-ink-quiet">–</span>}</span>
                  {paid}
                </div>
                <div className="col-span-2 flex items-center gap-2 sm:hidden">
                  {amount ? <span className="shrink-0 pr-1 text-base leading-5 font-semibold whitespace-nowrap text-ink tabular">{amount}</span> : null}
                  <PaidButton onClick={() => pay(i)} disabled={busy(itemKey(i))} label={`${i.title} ödendi`} className="min-w-0 flex-1" />
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
