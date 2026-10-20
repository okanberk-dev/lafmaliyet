import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { InfoTip, PageSkeleton } from "@/components/ui/misc";
import { fixedMonthly, shiftMonth } from "@/lib/calc/engine";
import { latestSalesMonth } from "@/lib/calc/insights";
import { FIXED_SECTIONS } from "@/lib/constants";
import { monthLabel } from "@/lib/format";
import { fixedExpenseDeleteBlockers } from "@/server/actions/costs";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";

import { FixedExpensesClient, FixedSummary, InvestmentsClient, type FixedRow, type SectionTotal } from "./expenses-client";
import { choiceMonths, closedDataMonths } from "./history-text";

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
  const cur = model.currentMonth;
  // Bu ayın kalemleri ve tutarları (bitmiş / başlamamış kalemler toplama girmez)
  const bySection: SectionTotal[] = FIXED_SECTIONS.map((sec) => ({
    key: sec.key,
    label: sec.label,
    total: model.activeFixed.filter((f) => f.section === sec.key).reduce((a, f) => a + fixedMonthly(f, st), 0) + (sec.key === "personel" ? model.personnel.total : 0),
  }));
  const ref = latestSalesMonth(model);
  const refSales = ref ? model.monthSales(ref) : null;
  const grossRatio = refSales && refSales.revenue ? refSales.grossProfit / refSales.revenue : 0;
  const breakEvenDaily = grossRatio > 0 ? model.fixedStandardTotal / grossRatio / st.acikGun : null;
  const totalInvestment = investments.reduce((a, i) => a + i.amount, 0);
  const total = model.fixedStandardTotal;
  const nextMonth = shiftMonth(cur, 1);
  const nextTotal = model.fixedStandardTotalFor(nextMonth);

  // Silinemeyecek kalemler ve nedeni (sunucudaki kural): pencere açılmadan "Sil" yerine "Durdur" önerilir
  const blockersRes = await fixedExpenseDeleteBlockers(model.fixedList.map((f) => f.id));
  const blockers: Record<number, string> = blockersRes.ok ? blockersRes.data : {};

  const rows: FixedRow[] = model.fixedList.map((f) => ({
    id: f.id,
    name: f.name,
    section: f.section,
    note: f.note,
    period: f.period,
    amount: f.amount,
    monthly: f.monthly,
    startMonth: f.startMonth ?? null,
    endMonth: f.endMonth ?? null,
    status: f.status,
    inRangeNow: f.inRangeNow,
    valueMonth: f.valueMonth,
    history: f.history,
    deleteBlocker: blockers[f.id] ?? (blockersRes.ok ? null : "Silme kontrolü yapılamadı; sayfayı yenileyin"),
  }));

  return (
    <>
      <Header
        description={
          <>
            Satış adedinden bağımsız aylık giderler (KDV hariç). Günlük, haftalık ve yıllık tutarlar otomatik aylığa çevrilir.{" "}
            <InfoTip text="Gelir-gider tablosunda bu tutarlar ayın açık gün oranıyla bölünür. Tutar değişince 'hangi aydan itibaren' sorulur: önceki aylar eski tutarla kalır (Excel'de her ay sütunu kendi tutarını taşıdığı gibi)." />
          </>
        }
      />

      <FixedSummary
        total={total}
        month={monthLabel(cur)}
        acikGun={st.acikGun}
        sections={bySection}
        personnelCount={model.personnel.rows.length}
        breakEvenDaily={breakEvenDaily}
        breakEvenRef={ref ? monthLabel(ref) : null}
        next={Math.abs(nextTotal - total) >= 1 ? { month: monthLabel(nextMonth), total: nextTotal } : null}
      />

      <FixedExpensesClient
        rows={rows}
        personnel={{ total: model.personnel.total, count: model.personnel.rows.length }}
        acikGun={st.acikGun}
        currentMonth={cur}
        closed={closedDataMonths(model.ds, cur)}
        months={choiceMonths(cur, model.firstDataMonth)}
      />
      <div className="mt-6">
        <InvestmentsClient rows={investments.map((i) => ({ id: i.id, name: i.name, amount: i.amount, date: i.date, note: i.note }))} total={totalInvestment} />
      </div>
    </>
  );
}
