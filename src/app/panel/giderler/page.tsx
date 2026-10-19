import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { InfoTip, PageSkeleton } from "@/components/ui/misc";
import { fixedMonthly } from "@/lib/calc/engine";
import { referenceSalesMonth } from "@/lib/calc/insights";
import { FIXED_SECTIONS } from "@/lib/constants";
import { monthLabel } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";

import { FixedExpensesClient, FixedSummary, InvestmentsClient, type SectionTotal } from "./expenses-client";

export const metadata: Metadata = { title: "Sabit giderler" };

function Header({ description }: { description?: ReactNode }) {
  return (
    <PageHeader
      eyebrow="Para"
      title="Sabit giderler"
      excel="Sabit Giderler"
      description={description}
      tabs={<SectionTabs section="giderler" current="/panel/giderler" />}
    />
  );
}

export default function ExpensesPage() {
  return (
    <Suspense
      fallback={
        <>
          <Header />
          <PageSkeleton rows={10} />
        </>
      }
    >
      <ExpensesContent />
    </Suspense>
  );
}

async function ExpensesContent() {
  await requireAdmin();
  const [model, investments] = await Promise.all([loadModel(), getDb().select().from(s.investments).orderBy(asc(s.investments.id))]);
  const st = model.settings;
  const bySection: SectionTotal[] = FIXED_SECTIONS.map((sec) => ({
    key: sec.key,
    label: sec.label,
    total: model.activeFixed.filter((f) => f.section === sec.key).reduce((a, f) => a + fixedMonthly(f, st), 0) + (sec.key === "personel" ? model.personnel.total : 0),
  }));
  const ref = referenceSalesMonth(model, model.salesMonths[model.salesMonths.length - 1] ?? "");
  const refSales = ref ? model.monthSales(ref) : null;
  const grossRatio = refSales && refSales.revenue ? refSales.grossProfit / refSales.revenue : 0;
  const breakEvenDaily = grossRatio > 0 ? model.fixedStandardTotal / grossRatio / st.acikGun : null;
  const totalInvestment = investments.reduce((a, i) => a + i.amount, 0);
  const total = model.fixedStandardTotal;

  return (
    <>
      <Header
        description={
          <>
            Satış adedinden bağımsız aylık giderler (KDV hariç). Günlük, haftalık ve yıllık tutarlar otomatik aylığa çevrilir.{" "}
            <InfoTip text="Gelir-gider tablosunda bu tutarlar ayın açık gün oranıyla bölünür." />
          </>
        }
      />

      <FixedSummary
        total={total}
        acikGun={st.acikGun}
        sections={bySection}
        personnelCount={model.personnel.rows.length}
        breakEvenDaily={breakEvenDaily}
        breakEvenRef={ref ? monthLabel(ref) : null}
      />

      <FixedExpensesClient
        rows={model.ds.fixedExpenses.map((f) => ({ ...f, monthly: fixedMonthly(f, st) }))}
        personnel={{ total: model.personnel.total, count: model.personnel.rows.length }}
        total={total}
        acikGun={st.acikGun}
        sections={bySection}
      />
      <div className="mt-6">
        <InvestmentsClient rows={investments.map((i) => ({ id: i.id, name: i.name, amount: i.amount, date: i.date, note: i.note }))} total={totalInvestment} />
      </div>
    </>
  );
}
