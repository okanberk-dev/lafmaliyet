import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton, Stat } from "@/components/ui/misc";
import { fixedMonthly } from "@/lib/calc/engine";
import { referenceSalesMonth } from "@/lib/calc/insights";
import { FIXED_SECTIONS } from "@/lib/constants";
import { tl } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";

import { FixedExpensesClient, InvestmentsClient } from "./expenses-client";

export const metadata: Metadata = { title: "Sabit giderler" };

export default function ExpensesPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Sabit giderler" excel="Sabit Giderler" />
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
  const bySection = FIXED_SECTIONS.map((sec) => ({
    ...sec,
    total: model.activeFixed.filter((f) => f.section === sec.key).reduce((a, f) => a + fixedMonthly(f, st), 0) + (sec.key === "personel" ? model.personnel.total : 0),
  }));
  const ref = referenceSalesMonth(model, model.salesMonths[model.salesMonths.length - 1] ?? "");
  const refSales = ref ? model.monthSales(ref) : null;
  const grossRatio = refSales && refSales.revenue ? refSales.grossProfit / refSales.revenue : 0;
  const breakEvenDaily = grossRatio > 0 ? model.fixedStandardTotal / grossRatio / st.acikGun : null;
  const totalInvestment = investments.reduce((a, i) => a + i.amount, 0);

  return (
    <>
      <PageHeader
        title="Sabit giderler"
        excel="Sabit Giderler"
        description="Satış adedinden bağımsız aylık giderler (KDV hariç). Günlük, haftalık ve yıllık tutarlar otomatik aylığa çevrilir; Gelir-gider tablosunda açık gün oranıyla bölünür."
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Aylık sabit gider" value={tl(model.fixedStandardTotal)} sub={`${st.acikGun} açık gün varsayımıyla`} />
        {bySection.map((b) => (
          <Stat key={b.key} label={b.label} value={tl(b.total)} sub={model.fixedStandardTotal ? `%${Math.round((b.total / model.fixedStandardTotal) * 100)}` : null} />
        ))}
      </div>
      <FixedExpensesClient
        rows={model.ds.fixedExpenses.map((f) => ({ ...f, monthly: fixedMonthly(f, st) }))}
        personnel={{ total: model.personnel.total, count: model.personnel.rows.length }}
        total={model.fixedStandardTotal}
        acikGun={st.acikGun}
        breakEvenDaily={breakEvenDaily}
      />
      <div className="mt-6">
        <InvestmentsClient rows={investments.map((i) => ({ id: i.id, name: i.name, amount: i.amount, date: i.date, note: i.note }))} total={totalInvestment} />
      </div>
    </>
  );
}
