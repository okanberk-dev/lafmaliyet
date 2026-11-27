import type { Metadata } from "next";
import { Suspense } from "react";

import { BranchViewChip } from "@/components/panel/branch-view-chip";
import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { PageSkeleton } from "@/components/ui/misc";
import { planNotes } from "@/lib/cash-plan";
import { branchFlowNote } from "@/lib/cash-plan-branch";
import { requireAdmin } from "@/server/auth/dal";
import { areaScope } from "@/server/branch-scope";
import { loadAreaCashPlan } from "@/server/data/cash-plan";

import { CashPlanClient } from "./cash-plan-client";

export const metadata: Metadata = { title: "Nakit planı" };

const TITLE = "Nakit planı";
const DESCRIPTION = "Önümüzdeki 6 hafta: gelecek para, ödenecekler ve elinizde kalacak tahmini para.";

export default function CashPlanPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader path="/panel/hatirlaticilar/nakit" title={TITLE} description={DESCRIPTION} tabs={<SectionTabs section="odeme" current="/panel/hatirlaticilar/nakit" role="admin" />} />
          <PageSkeleton rows={6} />
        </>
      }
    >
      <CashPlanContent />
    </Suspense>
  );
}

/**
 * Ödemeler'in alt ekranı: önümüzdeki 6 haftanın planı (src/lib/cash-plan.ts, docs/NAKIT-PLANI.md); yalnız yönetici.
 * Şube seçiliyken kişinin şube görünümüne göre (şube ayrımı parça 4): "Yalnız şube" kipinde şubenin nakit akışı ve
 * hafta hafta İşletme geneli satırı (src/lib/cash-plan-branch.ts), "Firma geneli" kipinde firmanın planı
 */
async function CashPlanContent() {
  await requireAdmin();
  // şube-ayrımı: alan.nakit
  const area = await areaScope("nakit");
  const { model, view, flow } = await loadAreaCashPlan(area);
  const { plan, state, carry, invoiceTermDays } = view;
  const notes = planNotes(plan, { komisyon: model.settings.komisyon, acikGun: model.settings.acikGun, invoiceTermDays });
  return (
    <CashPlanClient
      title={TITLE}
      description={DESCRIPTION}
      plan={plan}
      state={state}
      carry={carry}
      notes={notes}
      flow={flow}
      scopeChip={<BranchViewChip area="nakit" className="mb-4" />}
      scopeNote={flow ? branchFlowNote(flow.name) : null}
    />
  );
}
