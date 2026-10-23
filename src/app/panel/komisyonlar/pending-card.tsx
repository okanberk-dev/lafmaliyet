import { HandCoins } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { channelDef } from "@/lib/commission/channels";
import type { ChannelMonth } from "@/lib/commission/report";
import { monthLabel } from "@/lib/format";

import { PayoutButton } from "./channel-month-dialog";
import { dialogData, pendingBadge, pendingSub } from "./texts";

/**
 * Bekleyen hakedişler (seçilen aydan bağımsız, bütün aylar): gecikenler, eksik gelenler ve son günü bu hafta olanlar,
 * en acil önce. "Geldi" hakedişi işaretler; satır adı kanalın kartına götürür.
 */
export function PendingCard({ rows }: { rows: ChannelMonth[] }) {
  return (
    <Card>
      <CardHeader icon={<HandCoins />} title="Bekleyen hakedişler" description="Gelmesi gereken para. Geldiyse işaretleyin." />
      <ul className="mx-5 mb-5 divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
        {rows.map((r) => {
          const badge = pendingBadge(r);
          const eksik = r.payout.status === "eksik";
          return (
            <li key={`${r.channel}-${r.month}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              {/* Telefonda ad ve tutar tam satır; rozet ve düğme altında, düğme sağda */}
              <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                <Link
                  href={`/panel/komisyonlar?ay=${r.month}#${r.channel}`}
                  className="text-sm font-medium text-ink underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
                >
                  {r.label} · {monthLabel(r.month)}
                </Link>
                <p className="text-[13px] text-ink-mute tabular">{pendingSub(r)}</p>
              </div>
              <Badge tone={badge.tone} dot>
                {badge.text}
              </Badge>
              <PayoutButton
                data={dialogData(channelDef(r.channel), r.month, r)}
                mode={eksik ? "duzenle" : "geldi"}
                label={eksik ? "Düzenle" : "Geldi"}
                variant="secondary"
                className="ml-auto sm:ml-0"
              />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
