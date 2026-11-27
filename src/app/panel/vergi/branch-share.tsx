import { Store } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { KeyValue } from "@/components/ui/misc";
import { money, num } from "@/lib/format";
import { genitive } from "@/lib/recipe-change";
import { quarterLabel } from "@/lib/tax/calendar";
import { BRANCH_SHARE_NOTE, BRANCH_SHARE_TITLE, type BranchContribution, type BranchTaxShare } from "@/lib/tax/branch-share";

/*
 * Vergi alanının şube kipi (şube ayrımı parça 5; src/lib/tax/branch-share.ts): şube seçili ve Vergi "Yalnız şube"
 * kipindeyken firmanın beyan hesabının üstünde şubenin payı. Bilgi: beyana girmez, takvimi değiştirmez.
 */

/** Özet: yılın bugüne kadarki satış ve alış KDV'si, şube personelinin SGK'sı ve stopajı, şubenin amortismanı */
export function BranchShareCard({ name, share }: { name: string; share: BranchTaxShare }) {
  return (
    <Card id="sube-payi" className="scroll-mt-20">
      <CardHeader
        icon={<Store />}
        title={`${name} · ${BRANCH_SHARE_TITLE}`}
        description={`${share.year} başından bugüne, yalnız ${genitive(name)} kayıtlarıyla.`}
        actions={<Badge tone="blue">Bilgi</Badge>}
      />
      <CardContent className="space-y-1">
        <div className="divide-y divide-line">
          <KeyValue label="Satış KDV'si (kasa)" value={money(share.salesVat)} />
          <KeyValue label={`Şubeye seçilmiş faturaların KDV'si (${num(share.invoices)} fatura)`} value={money(-share.purchaseVat)} />
          <KeyValue label="KDV farkı (bilgi)" value={money(share.vatDiff)} strong />
          <KeyValue label={`Personelin SGK'sı${share.people ? ` (${num(share.people)} kişi)` : ""}`} value={money(share.sgk)} />
          <KeyValue label="Maaş vergileri (gelir ve damga vergisi stopajı)" value={money(share.stopaj)} />
          <KeyValue label={`Amortisman (${num(share.assets)} demirbaş)`} value={money(share.depreciation)} />
        </div>
        <p className="pt-2 text-xs leading-5 text-ink-mute">{BRANCH_SHARE_NOTE}</p>
      </CardContent>
    </Card>
  );
}

/** Vergi kârı: çeyreğin matraha katkısı (bilgi) */
export function BranchContributionCard({ name, c }: { name: string; c: BranchContribution }) {
  return (
    <Card id="matraha-katki" className="scroll-mt-20">
      <CardHeader
        icon={<Store />}
        title={`${name} · matraha katkı (bilgi)`}
        description={`${quarterLabel(c.quarter)}: ${genitive(name)} geliri ve gideri, vergi esasında (KDV hariç).`}
        actions={<Badge tone="blue">Bilgi</Badge>}
      />
      <CardContent className="space-y-1">
        <div className="divide-y divide-line">
          <KeyValue label="Gelir" value={money(c.income)} />
          <KeyValue label="Gider" value={money(-c.expense)} />
          <KeyValue label="Amortisman" value={money(-c.depreciation)} />
          <KeyValue label="Matraha katkı (bilgi)" value={money(c.result)} strong />
        </div>
        <p className="pt-2 text-xs leading-5 text-ink-mute">{BRANCH_SHARE_NOTE}</p>
      </CardContent>
    </Card>
  );
}
