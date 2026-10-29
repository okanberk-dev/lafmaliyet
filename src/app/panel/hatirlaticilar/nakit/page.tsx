import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { PageSkeleton } from "@/components/ui/misc";
import { planNotes } from "@/lib/cash-plan";
import { requireAdmin } from "@/server/auth/dal";
import { loadCashPlan } from "@/server/data/cash-plan";
import { loadModel } from "@/server/data/dataset";

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

/** Ödemeler'in alt ekranı: önümüzdeki 6 haftanın planı (src/lib/cash-plan.ts, docs/NAKIT-PLANI.md); yalnız yönetici */
async function CashPlanContent() {
  await requireAdmin();
  const model = await loadModel();
  const { plan, state, carry, invoiceTermDays } = await loadCashPlan(model);
  const notes = planNotes(plan, { komisyon: model.settings.komisyon, acikGun: model.settings.acikGun, invoiceTermDays });
  return <CashPlanClient title={TITLE} description={DESCRIPTION} plan={plan} state={state} carry={carry} notes={notes} />;
}
