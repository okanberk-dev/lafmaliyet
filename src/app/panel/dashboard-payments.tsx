import { BellRing, CalendarClock, FileText, Landmark, Receipt, Users, Wallet, type LucideIcon } from "lucide-react";

import { ActivityItem, ActivityList } from "@/components/ui/activity";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { PastelTone } from "@/components/ui/icon-tile";
import { dateTR, tl } from "@/lib/format";
import { daysLeftLabel, type ReminderKind, type UpcomingItem } from "@/lib/reminders";

const ICON: Record<ReminderKind, LucideIcon> = { odeme: Wallet, vergi: Landmark, kira: Receipt, maas: Users, fatura: FileText, diger: CalendarClock };

/**
 * Genel bakış: gecikmiş ve 7 gün içindeki ödemeler (Ödemeler & hatırlatıcılar'dan; liste sayfada bir kez
 * okunur, "Bu ayın işleri" de aynısını kullanır). Yoksa hiç görünmez; sayfa sakin kalsın.
 */
export function DashboardPayments({ items, className }: { items: UpcomingItem[]; className?: string }) {
  const near = items.filter((i) => i.status !== "later").slice(0, 4);
  if (!near.length) return null;
  const overdue = near.filter((i) => i.status === "overdue").length;
  return (
    <Card className={className}>
      <CardHeader
        icon={<BellRing />}
        title="Yaklaşan ödemeler"
        description={overdue ? `${overdue} ödeme gecikti` : "Önümüzdeki 7 gün"}
        actions={
          <ButtonLink href="/panel/hatirlaticilar" variant="secondary" size="sm">
            Tümü
          </ButtonLink>
        }
      />
      <CardContent>
        <ActivityList>
          {near.map((i) => {
            const Icon = ICON[i.kind];
            const tone: PastelTone = i.status === "overdue" ? 3 : i.status === "today" ? 1 : 2;
            return (
              <ActivityItem
                key={i.ref}
                href="/panel/hatirlaticilar"
                icon={<Icon />}
                tone={tone}
                title={i.title}
                description={`${dateTR(i.dueDate)} · ${daysLeftLabel(i.daysLeft)}${i.detail ? ` · ${i.detail}` : ""}`}
                aside={i.amount !== null ? tl(i.amount) : undefined}
                dot={i.status === "overdue" ? "danger" : i.status === "today" ? true : undefined}
              />
            );
          })}
        </ActivityList>
      </CardContent>
    </Card>
  );
}
