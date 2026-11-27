import { History } from "lucide-react";

import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { dateTimeTR } from "@/lib/format";
import { KIND_LABEL, STATUS_LABEL, type StaffRequestStatus } from "@/lib/staff-requests";
import { ALL_BRANCHES } from "@/lib/branches";
import { requireAdmin } from "@/server/auth/dal";
import { currentBranchScope } from "@/server/branch-scope";
import { getDb } from "@/server/db";
import { requestsInScope } from "@/server/staff-requests/branch";
import { recentDecisions } from "@/server/staff-requests/core";

const TONE: Record<StaffRequestStatus, Tone> = {
  pending: "amber",
  approved: "green",
  done: "green",
  rejected: "red",
  withdrawn: "gray",
  superseded: "gray",
  expired: "gray",
  cancelled: "gray",
  revoked: "gray",
};

/**
 * Onaylar › Son kararlar (docs/ONAYLAR.md): personel isteklerinin son 30 günü (kasa, zayi ve ikram, karaoke): tür, başlık,
 * isteyen, karar veren, not ve durum. Satırlar sabit sütunlardan (recentDecisions; ham yük yok; kaldırılan mal siparişi
 * taslakları gelmez). Liste boşsa bölüm çizilmez; reçete önerilerinin kararları reçete bölümünde. Tek şube seçiliyken
 * yalnız o şubenin ve şubesi bilinmeyen istekler (şube ayrımı, 27 Kasım 2026; bekleyen kartlar gibi `requestsInScope`):
 * önceden Marina seçiliyken Tuzla'nın kararları da listedeydi. Süzgeçten sonra 40 satır kalsın diye fazlası okunur
 */
export async function RecentDecisions() {
  await requireAdmin();
  const db = getDb();
  const scope = await currentBranchScope();
  const read = await recentDecisions(db, 30, new Date(), scope === ALL_BRANCHES ? 40 : 200);
  const rows = (await requestsInScope(db, read, scope)).slice(0, 40);
  if (!rows.length) return null;
  return (
    <Card>
      <CardHeader icon={<History />} title="Son kararlar" description="Son 30 günde personel isteklerinin sonucu: kasa, zayi ve ikram, karaoke." />
      <ul className="divide-y divide-line border-t border-line">
        {rows.map((r) => (
          <li key={r.id} className="px-5 py-3">
            <p className="font-medium break-words text-ink">
              <span className="font-normal text-ink-mute">{KIND_LABEL[r.kind]}: </span>
              {r.title}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-mute">
              <Badge tone={TONE[r.status]} dot>
                {STATUS_LABEL[r.status]}
              </Badge>
              <span>{r.requestedByName} istedi</span>
              {r.reviewedByName ? <span>· {r.reviewedByName}</span> : null}
              <span className="tabular">· {dateTimeTR(r.reviewedAt ?? r.updatedAt)}</span>
            </p>
            {r.reviewNote ? <p className="mt-1 text-[13px] break-words text-ink-soft">Not: {r.reviewNote}</p> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
