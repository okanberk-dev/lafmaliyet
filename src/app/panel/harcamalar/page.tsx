import type { Metadata } from "next";
import { Suspense } from "react";

import { MonthPicker } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { PageSkeleton } from "@/components/ui/misc";
import { fixedMonthly, monthOfDate, shiftMonth } from "@/lib/calc/engine";
import { panelGroupOf } from "@/lib/calc/insights";
import { COMMISSION_CATEGORY, GOODS_CATEGORIES, INVOICE_CATEGORIES, SEPARATE_CATEGORIES } from "@/lib/constants";
import { requireAdmin } from "@/server/auth/dal";
import { availableMonths, loadModel } from "@/server/data/dataset";

import { MonthlyExpenses, type CategoryRow, type EntryRow, type FixedCandidate, type InvoiceItem } from "./monthly-expenses";

export const metadata: Metadata = { title: "Aylık harcamalar" };

const DESCRIPTION =
  "Her ay farklı olan (reklam, influencer) ve fatura dışı (nakit alım, bakım) giderler. Girdiğiniz tutar o ayın gelir-giderine ve Genel bakış'taki “Para nereye gitti”ye kendiliğinden yansır.";

function Header({ actions }: { actions?: React.ReactNode }) {
  return (
    <PageHeader
      eyebrow="Para"
      title="Aylık harcamalar"
      description={DESCRIPTION}
      tabs={<SectionTabs section="giderler" current="/panel/harcamalar" />}
      actions={actions}
    />
  );
}

export default function ExpensesMonthPage({ searchParams }: PageProps<"/panel/harcamalar">) {
  return (
    <Suspense
      fallback={
        <>
          <Header />
          <PageSkeleton rows={8} />
        </>
      }
    >
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

/** Harcamaya bağlanabilecek fatura kategorileri (mal, komisyon ve kafe dışı faturalar zaten ayrı sayılır) */
const MAPPABLE = INVOICE_CATEGORIES.filter((c) => !GOODS_CATEGORIES.includes(c) && c !== COMMISSION_CATEGORY && !SEPARATE_CATEGORIES.includes(c));

async function Content({ searchParams }: { searchParams: PageProps<"/panel/harcamalar">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const model = await loadModel();
  const raw = Array.isArray(sp.ay) ? sp.ay[0] : sp.ay;
  // Varsayılan: bu ay (harcamalar genelde süren ay için girilir)
  const month = raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : model.currentMonth;
  const prev = shiftMonth(month, -1);
  const months = [...new Set([...availableMonths(model), model.currentMonth, month])].sort();

  const amounts = model.expenseAmounts(month);
  const prevAmounts = new Map(model.expenseAmounts(prev).map((x) => [x.cat.id, x.total]));
  const allEntries = model.ds.expenseEntries ?? [];
  const usage = new Map<number, number>();
  for (const e of allEntries) usage.set(e.categoryId, (usage.get(e.categoryId) ?? 0) + 1);

  const categories: CategoryRow[] = amounts.map(({ cat, entries, invoices, total }) => ({
    id: cat.id,
    name: cat.name,
    section: cat.section,
    panelGroup: cat.panelGroup,
    invoiceCategory: cat.invoiceCategory,
    monthly: cat.monthly,
    active: cat.active,
    expected: model.expenseExpected(cat, month),
    entryCount: usage.get(cat.id) ?? 0,
    monthEntries: entries,
    monthInvoices: invoices,
    monthTotal: total,
    prevTotal: prevAmounts.get(cat.id) ?? 0,
  }));

  const entries: EntryRow[] = allEntries
    .filter((e) => monthOfDate(e.date) === month)
    .map((e) => ({ id: e.id, date: e.date, categoryId: e.categoryId, description: e.description, amount: e.amount, paymentMethod: e.paymentMethod, note: e.note }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

  const mapped = new Map(categories.filter((c) => c.invoiceCategory).map((c) => [c.invoiceCategory!, c.id]));
  const invoices: InvoiceItem[] = model.ds.invoices
    .filter((i) => monthOfDate(i.date) === month && mapped.has(i.category))
    .map((i) => ({ id: i.id, date: i.date, supplier: i.supplier, net: i.amount - i.discount, categoryId: mapped.get(i.category)!, invoiceCategory: i.category }))
    .sort((a, b) => b.date.localeCompare(a.date));

  // Bu ay her ay aynı tutarla sayılan sabit giderler: reklam grubu önce (aylık girişe çevrilebilir)
  const fixed: FixedCandidate[] = model
    .fixedInMonth(month)
    .map((fe) => ({ id: fe.id, name: fe.name, section: fe.section, group: panelGroupOf(fe), amount: fixedMonthly(fe, model.settings) }))
    .filter((f) => f.amount > 0)
    .sort((a, b) => Number(b.group === "reklam") - Number(a.group === "reklam") || b.amount - a.amount);

  return (
    <>
      <Header actions={<MonthPicker months={months} value={month} />} />
      <MonthlyExpenses
        month={month}
        isCurrent={month === model.currentMonth}
        categories={categories}
        entries={entries}
        invoices={invoices}
        fixed={fixed}
        invoiceCategories={MAPPABLE}
      />
    </>
  );
}
