import type { Metadata } from "next";
import { Suspense } from "react";

import { BranchViewChip } from "@/components/panel/branch-view-chip";
import { MonthPicker } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { PageSkeleton } from "@/components/ui/misc";
import { fixedMonthly, monthOfDate, shiftMonth } from "@/lib/calc/engine";
import { panelGroupOf } from "@/lib/calc/insights";
import { COMMISSION_CATEGORY, GOODS_CATEGORIES, INVOICE_CATEGORIES, SEPARATE_CATEGORIES, type Role } from "@/lib/constants";
import { EXPENSE_SHARED, sortBranches, tillBranches } from "@/lib/branches";
import { requireCan } from "@/server/auth/dal";
import { currentBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { availableMonths, loadModel } from "@/server/data/dataset";
import { expenseExtras } from "@/server/data/expense-extras";
import { supplierSlugOf } from "@/server/data/suppliers";

import { expenseSplit } from "./summary";

import { MonthlyExpenses, type CategoryRow, type EntryRow, type FixedCandidate, type InvoiceItem } from "./monthly-expenses";

export const metadata: Metadata = { title: "Aylık harcamalar" };

const DESCRIPTION = "Her ay değişen ve faturasız giderler: reklam, influencer, nakit alım, bakım.";
// Eski uzun açıklama: başlıktaki ⓘ "Nasıl çalışır?" (docs/planlar/ux-sade.md §8)
const MORE =
  "Her ay farklı olan (reklam, influencer) ve fatura dışı (nakit alım, bakım) giderler. Girdiğiniz tutar o ayın gelir-giderine ve Genel bakış'taki “Para nereye gitti”ye kendiliğinden yansır.";

function Header({ actions, role = "admin" }: { actions?: React.ReactNode; role?: Role }) {
  return (
    <PageHeader
      path="/panel/harcamalar"
      title="Aylık harcamalar"
      description={DESCRIPTION}
      more={MORE}
      role={role}
      // Muhasebecide sekme yok: Giderler & maaşlar'ın öteki sekmeleri (sabit giderler, maaşlar) ona kapalı
      tabs={<SectionTabs section="giderler" current="/panel/harcamalar" role={role} />}
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
  // Yönetici ve muhasebeci (salt okunur; docs/ROLLER.md): muhasebecinin yazma denemesini eylemler reddeder
  const viewer = await requireCan("muhasebe.oku");
  const sp = await searchParams;
  const model = await loadModel();
  const raw = Array.isArray(sp.ay) ? sp.ay[0] : sp.ay;
  // Varsayılan: bu ay (harcamalar genelde süren ay için girilir)
  const month = raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : model.currentMonth;
  const prev = shiftMonth(month, -1);
  const months = [...new Set([...availableMonths(model), model.currentMonth, month])].sort();

  const amounts = model.expenseAmounts(month);
  const allEntries = model.ds.expenseEntries ?? [];
  // Şube seçiliyken toplam şubenin kendi kayıtlarıdır; şubesi boş kayıtlar ve bağlı faturalar işletme geneli, ayrı
  // gösterilir (şube kapsamı C P1-4; Gelir-gider'in harcama hücresiyle aynı kural, expenseSplit)
  const branchView = model.ds.branchView?.id ?? null;
  // İşletme geneli giderler alanı "Yalnız not" kipinde (şube ayrımı parça 6): işletme geneli kayıtlar ve faturalar listede
  // ve tutarda yok, yalnız not
  const sharedHidden = Boolean(branchView && model.ds.sharedCostsHidden);
  const split = expenseSplit(allEntries.filter((e) => monthOfDate(e.date) === month), branchView);
  const prevSplit = expenseSplit(allEntries.filter((e) => monthOfDate(e.date) === prev), branchView);
  const prevAmounts = new Map(model.expenseAmounts(prev).map((x) => [x.cat.id, branchView ? (prevSplit.get(x.cat.id)?.own ?? 0) : x.total]));
  const usage = new Map<number, number>();
  for (const e of allEntries) usage.set(e.categoryId, (usage.get(e.categoryId) ?? 0) + 1);

  const categories: CategoryRow[] = amounts.map(({ cat, entries, invoices, invoicesOwn, invoicesShared, total }) => ({
    id: cat.id,
    name: cat.name,
    section: cat.section,
    panelGroup: cat.panelGroup,
    invoiceCategory: cat.invoiceCategory,
    monthly: cat.monthly,
    active: cat.active,
    expected: model.expenseExpected(cat, month),
    entryCount: usage.get(cat.id) ?? 0,
    monthEntries: branchView ? (split.get(cat.id)?.own ?? 0) : entries,
    monthInvoices: sharedHidden ? invoicesOwn : invoices,
    monthTotal: branchView ? (split.get(cat.id)?.own ?? 0) : total,
    prevTotal: prevAmounts.get(cat.id) ?? 0,
    sharedTotal: branchView && !sharedHidden ? (split.get(cat.id)?.shared ?? 0) + invoices : 0,
    ...(sharedHidden && (split.get(cat.id)?.shared ?? 0) + invoicesShared > 0 ? { sharedNote: true } : {}),
  }));

  // Kasadan çıkan fişten yazılan kayıtların fotoğrafı ve kasa günü (veri kümesi dosyalarına dokunmadan)
  const extras = await expenseExtras(month);
  // Cari borcun gideri: "Cari · Sütaş" rozeti tedarikçinin sayfasına götürür (tutar, gün ve kategori orada düzeltilir)
  const cariCards = [...new Set([...extras.values()].flatMap((x) => (x.cariCardId !== null ? [x.cariCardId] : [])))];
  const cariHref = new Map(await Promise.all(cariCards.map(async (id) => [id, await supplierSlugOf(id)] as const)));
  const entries: EntryRow[] = allEntries
    .filter((e) => monthOfDate(e.date) === month && !(sharedHidden && (e.branchId ?? null) === null))
    .map((e) => {
      const x = extras.get(e.id);
      return {
        id: e.id,
        date: e.date,
        categoryId: e.categoryId,
        description: e.description,
        amount: e.amount,
        paymentMethod: e.paymentMethod,
        note: e.note,
        photoId: x?.photoId ?? null,
        vat: x?.vat ?? null,
        cashOutId: x?.cashOutId ?? null,
        cashOutDate: x?.cashOutDate ?? null,
        cari: x?.cariCardId ? { name: x.cariName ?? "", href: cariHref.get(x.cariCardId) ? `/panel/tedarikciler/${cariHref.get(x.cariCardId)}?sekme=hareketler` : null } : null,
        branchId: e.branchId ?? null,
        shared: Boolean(branchView) && (e.branchId ?? null) === null,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

  const mapped = new Map(categories.filter((c) => c.invoiceCategory).map((c) => [c.invoiceCategory!, c.id]));
  const invoices: InvoiceItem[] = model.ds.invoices
    .filter((i) => monthOfDate(i.date) === month && mapped.has(i.category) && !(sharedHidden && i.branchId !== branchView))
    .map((i) => ({ id: i.id, date: i.date, supplier: i.supplier, net: i.amount - i.discount, categoryId: mapped.get(i.category)!, invoiceCategory: i.category }))
    .sort((a, b) => b.date.localeCompare(a.date));

  // Bu ay her ay aynı tutarla sayılan sabit giderler: reklam grubu önce (aylık girişe çevrilebilir)
  const fixed: FixedCandidate[] = model
    .fixedInMonth(month)
    .map((fe) => ({ id: fe.id, name: fe.name, section: fe.section, group: panelGroupOf(fe), amount: fixedMonthly(fe, model.settings) }))
    .filter((f) => f.amount > 0)
    .sort((a, b) => Number(b.group === "reklam") - Number(a.group === "reklam") || b.amount - a.amount);

  // Harcamanın şubesi (docs/SUBE.md › Yazarken hangi şube): form seçer, gönderim anındaki seçim değil. Varsayılan seçili
  // şube; "Tümü"de görünür biçimde işletme geneli. Tek şube açıkken seçim çizilmez
  const [scope, branchRows] = await Promise.all([currentBranchScope(), listBranches()]);
  const open = sortBranches(branchRows.filter((b) => b.active));
  const branches = {
    options: open.map((b) => ({ id: b.id, name: b.name })),
    defaultId: open.some((b) => b.id === scope) ? scope : EXPENSE_SHARED,
    ask: tillBranches(branchRows).length > 1,
  };

  return (
    <>
      <Header actions={<MonthPicker months={months} value={month} />} role={viewer.role} />
      {/* İşletme geneli giderler alanının çipi (şube ayrımı parça 6) */}
      <BranchViewChip area="ortak_gider" className="mb-4" />
      {/* Ay değişince form baştan kurulur: tarih yeni ayın tarihi olur (yalnız ?ay= değişince istemci durumu korunurdu) */}
      <MonthlyExpenses
        key={month}
        month={month}
        isCurrent={month === model.currentMonth}
        categories={categories}
        entries={entries}
        invoices={invoices}
        fixed={fixed}
        invoiceCategories={MAPPABLE}
        branches={branches}
        branchName={model.ds.branchView?.name ?? null}
        sharedHidden={sharedHidden}
      />
    </>
  );
}
