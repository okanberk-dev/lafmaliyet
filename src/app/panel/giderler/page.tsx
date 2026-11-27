import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { PageSkeleton } from "@/components/ui/misc";
import { fixedMonthly, shiftMonth } from "@/lib/calc/engine";
import { breakEvenOf } from "@/lib/calc/insights";
import { FIXED_SECTIONS } from "@/lib/constants";
import { monthLabel } from "@/lib/format";
import { fixedExpenseDeleteBlockers } from "@/server/actions/costs";
import { requireAdmin } from "@/server/auth/dal";
import { listBranches } from "@/server/branches";
import { loadModel } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";

import { FixedExpensesClient, FixedSummary, InvestmentsClient, type FixedBranches, type FixedRow, type SectionTotal } from "./expenses-client";
import { choiceMonths, closedDataMonths } from "./history-text";

export const metadata: Metadata = { title: "Sabit giderler" };

const DESCRIPTION = "Her ay aynı olan giderler: kira, aidat, internet (KDV hariç).";
// Eski uzun açıklama: başlıktaki ⓘ "Nasıl çalışır?" (docs/planlar/ux-sade.md §8)
const MORE =
  "Satış adedinden bağımsız aylık giderler (KDV hariç). Günlük, haftalık ve yıllık tutarlar otomatik aylığa çevrilir. Gelir-gider tablosunda bu tutarlar ayın gün oranıyla bölünür (açık günü kasa raporlarından gelen ayda takvim günüyle: kapalı bir gün kirayı ve maaşı düşürmez). Tutar değişince 'hangi aydan itibaren' sorulur: önceki aylar eski tutarla kalır (her ay kendi tutarını taşır).";

function Header() {
  return (
    <PageHeader
      path="/panel/giderler"
      title="Sabit giderler"
      description={DESCRIPTION}
      more={MORE}
      tabs={<SectionTabs section="giderler" current="/panel/giderler" role="admin" />}
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
  const [model, investments, all] = await Promise.all([loadModel(), getDb().select().from(s.investments).orderBy(asc(s.investments.id)), listBranches()]);
  // Şube seçimi (docs/SUBE.md): şube seçiliyken o şubenin ve işletme genelinin kalemleri listelenir; yeni kalem seçili
  // şubeye, "Tümü"nde işletme geneline
  const open = all.filter((b) => b.active);
  const branches: FixedBranches = { options: open.map((b) => ({ id: b.id, name: b.name })), fallback: model.ds.branchView?.id ?? null };
  const nameOf = new Map(all.map((b) => [b.id, b.name]));
  const st = model.settings;
  const cur = model.currentMonth;
  // Bu ayın kalemleri ve tutarları (bitmiş / başlamamış kalemler toplama girmez). Şube seçiliyken işletme geneli kalemler
  // toplama ve başabaşa girmez (sahibin kararı 4; model.fixedOwnInMonth), özette bilgi olarak yazılır
  const own = model.fixedOwnInMonth(cur);
  const bySection: SectionTotal[] = FIXED_SECTIONS.map((sec) => ({
    key: sec.key,
    label: sec.label,
    total: own.filter((f) => f.section === sec.key).reduce((a, f) => a + fixedMonthly(f, st), 0) + (sec.key === "personel" ? model.personnel.total : 0),
  }));
  // Başabaş Genel bakış ve Analiz'le aynı kuraldan (breakEvenOf, denetim E-59): her ay girilen harcamalar dahil, son
  // kapanmış online ayın brüt kârı düşülmüş
  const be = breakEvenOf(model, cur);
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
    vatRate: f.vatRate ?? null,
    officialAmount: f.officialAmount ?? null,
    officialBasis: f.officialBasis ?? null,
    landlordType: f.landlordType ?? null,
    prorate: f.prorate !== false,
    monthly: f.monthly,
    startMonth: f.startMonth ?? null,
    endMonth: f.endMonth ?? null,
    status: f.status,
    inRangeNow: f.inRangeNow,
    valueMonth: f.valueMonth,
    history: f.history,
    deleteBlocker: blockers[f.id] ?? (blockersRes.ok ? null : "Silme kontrolü yapılamadı; sayfayı yenileyin"),
    branchId: f.branchId ?? null,
    branchName: open.length > 1 ? (f.branchId ? (nameOf.get(f.branchId) ?? f.branchId) : "İşletme geneli") : null,
  }));

  return (
    <>
      <Header />

      <FixedSummary
        total={total}
        month={monthLabel(cur)}
        acikGun={st.acikGun}
        sections={bySection}
        personnelCount={model.personnel.rows.length}
        breakEvenDaily={be.daily}
        breakEvenRef={be.refMonth ? monthLabel(be.refMonth) : null}
        breakEvenOnline={be.onlineCover ? { month: monthLabel(be.onlineCover.month), amount: be.onlineCover.grossProfit } : null}
        monthlyExpenses={be.expenses.map((x) => ({ name: x.cat.name, amount: x.amount, from: x.from }))}
        next={Math.abs(nextTotal - total) >= 1 ? { month: monthLabel(nextMonth), total: nextTotal } : null}
        shared={model.ds.branchView ? { branch: model.ds.branchView.name, amount: model.fixedStandardSharedFor(cur) } : null}
      />

      <FixedExpensesClient
        rows={rows}
        personnel={{ total: model.personnel.total, count: model.personnel.rows.length }}
        acikGun={st.acikGun}
        currentMonth={cur}
        closed={closedDataMonths(model.ds, cur)}
        months={choiceMonths(cur, model.firstDataMonth)}
        branches={branches}
      />
      <div className="mt-6">
        <InvestmentsClient
          rows={investments.map((i) => ({ id: i.id, name: i.name, amount: i.amount, date: i.date, note: i.note }))}
          total={totalInvestment}
          // Şube seçiliyken "Firma geneli" (yatırımın şube sütunu parça 3'te; şube ayrımı)
          companyWide={model.ds.branchView?.name ?? null}
        />
      </div>
    </>
  );
}
