import { Wallet } from "lucide-react";

import { Card, CardHeader } from "@/components/ui/card";
import type { ChannelMonth, GroupMonth } from "@/lib/commission/report";
import { money, monthLabel, num, pct } from "@/lib/format";
import { dayLocativeTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";

import { ANCHOR, FlagList } from "./channel-card";
import { overMealLimit, tillSub } from "./texts";

/** Ortalama oranın alt satırı: nasıl hesaplandı ya da neden yok */
function rateSub(g: GroupMonth): string {
  if (g.rate !== null) return "kesilen ÷ Z'deki yemek kartı";
  if (!g.invoiceCount) return "bu ay yemek kartı faturası yok";
  if (g.zTotal === null) return "kasa raporu yok";
  if (g.partialFrom) return "Z toplamı ayın yalnız bir kısmı";
  return "Z'de yemek kartı yok";
}

/**
 * Yemek kartları (toplam): Z'deki yemek kartı satışı, bütün yemek kartı faturaları, ortalama oran ve beklenen hakediş.
 * Kart kart oran satış yazılmadan çıkmasa da bu hep hesaplanır: ortalama %6'yı aşıyorsa en az bir kart aşıyordur.
 */
export function MealTotalCard({ group, rows, className }: { group: GroupMonth; rows: ChannelMonth[]; className?: string }) {
  const companies = new Set(rows.filter((r) => r.invoices.length).map((r) => r.channel)).size;
  // Birden çok kart varken satışı bilinmeyen kart varsa: kart kart oran ancak ekstredeki satışla (LafPOS'un ödemeleri
  // kartın satışını kendisi verir). Ayın tamamı LafPOS'tansa Z tek toplam değil: satışı bilinmeyen kartın LafPOS'ta
  // ödemesi yok (ödeme türünün kanalı seçilmemiş olabilir); geçiş ayında öncesinin Z'si tek toplam
  const unknown = rows.filter((r) => r.invoices.length && !r.sales);
  const fullLafpos = group.lafposFrom !== null && group.lafposFrom <= `${group.month}-01`;
  const untyped = unknown.length > 0 && (fullLafpos || group.activeChannels.length >= 2);
  const names = unknown.map((r) => r.label);
  const nameList = names.length > 1 ? `${names.slice(0, -1).join(", ")} ve ${names[names.length - 1]}` : (names[0] ?? "");
  const cells = [
    { label: "Z'de yemek kartı", value: group.zTotal !== null ? money(group.zTotal) : "–", sub: tillSub(group) },
    { label: "Kesilen", value: `${money(group.feesTotal)} + KDV`, sub: `${num(group.invoiceCount)} fatura · ${num(companies)} şirket` },
    { label: "Ortalama oran", value: group.rate !== null ? pct(group.rate) : "–", sub: rateSub(group), bad: overMealLimit(group.rate) },
    { label: "Beklenen hakediş", value: group.expected !== null ? `~${money(group.expected)}` : "–", sub: `gelen ${money(group.received)}` },
  ];
  return (
    <Card id="yemek-kartlari" className={cn(ANCHOR, className)}>
      <CardHeader icon={<Wallet />} title="Yemek kartları (toplam)" description={`${monthLabel(group.month)} · Z raporundaki yemek kartı ve bütün yemek kartı faturaları`} />
      <div className="space-y-3 px-5 pb-5">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line ring-1 ring-line lg:grid-cols-4">
          {cells.map((c) => (
            <div key={c.label} className="min-w-0 bg-surface px-4 py-3">
              <dt className="text-[13px] text-ink-mute">{c.label}</dt>
              <dd className={cn("mt-0.5 text-lg font-semibold tracking-tight tabular", c.bad ? "text-bad" : "text-ink")}>{c.value}</dd>
              <dd className="text-xs text-ink-mute">{c.sub}</dd>
            </div>
          ))}
        </dl>
        <FlagList flags={group.flags} />
        {untyped ? (
          <p className="text-[13px] leading-5 text-ink-mute">
            {fullLafpos
              ? `${nameList} için LafPOS'ta ödeme yok: ödeme türünün kanalını LafPOS'ta seçin ya da kartın aylık ekstresindeki satışı kartın altındaki Satışı yaz ile girin.`
              : group.lafposFrom
                ? `LafPOS ${dayLocativeTR(group.lafposFrom)} başladı; öncesinde Z raporunda yemek kartları tek toplam. Kart kart oran için her kartın aylık ekstresindeki satışı kartın altındaki Satışı yaz ile girin.`
                : "Z raporunda yemek kartları tek toplam. Kart kart oran için her kartın aylık ekstresindeki satışı kartın altındaki Satışı yaz ile girin."}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
