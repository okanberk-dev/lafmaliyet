import type { LucideIcon } from "lucide-react";
import {
  MessageSquare,
  Package,
  ShoppingBag,
  User,
} from "lucide-react";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { MetricIconBox } from "@/components/akmanos/icons/metric-icon-box";
import { STAT_CARDS, type StatCardKey } from "./constants";
import { GrowthBadge } from "./growth-badge";

const CARD_ICONS: Record<StatCardKey, LucideIcon> = {
  customers: User,
  unitsSold: Package,
  orders: ShoppingBag,
  supportTickets: MessageSquare,
};

export function StatisticCards() {
  return (
    <div className="w-full" data-component="statistic-cards">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STAT_CARDS.map((card) => (
          <div
            key={card.key}
            className="flex flex-col gap-3 rounded-2xl bg-chart-card-bg px-3 py-3"
          >
            <MetricIconBox icon={CARD_ICONS[card.key]} />
            <div className="flex flex-col gap-1">
              <span className="text-sm text-chart-muted">{card.label}</span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">
                  <AnimatedNumber value={card.value} />
                </span>
                <GrowthBadge value={card.growth} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
