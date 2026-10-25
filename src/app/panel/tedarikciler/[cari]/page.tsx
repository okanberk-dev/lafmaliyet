import { AlarmClock, ArrowLeft, CalendarRange, CircleCheck, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { ButtonLink } from "@/components/ui/button";
import { PageSkeleton, Stat } from "@/components/ui/misc";
import { StatBreakdown } from "@/components/ui/stat-breakdown";
import { compareOpenItems, debtLabel, debtRemaining, invoiceLabel, showsCredit } from "@/lib/cari/account";
import { defaultCostMode } from "@/lib/cari/match";
import { businessDate } from "@/lib/cash-report";
import { dateTR, num, tl } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { loadSupplierCari } from "@/server/data/cari";
import { loadSupplierLedger } from "@/server/data/suppliers";
import { listInvoiceDocuments, type DocumentMeta } from "@/server/documents";
import { isParasutConfigured } from "@/server/parasut/config";
import { sameSupplier } from "@/server/parasut/mapping";

import { accountBreakdowns } from "../breakdowns";
import { aliasCandidates, isHiddenSupplier, sharedTaxNotes, supplierHref, supplierSlug, taxNameIndex } from "../logic";
import { CountUp } from "../suppliers-client";
import { SupplierClient } from "./supplier-client";

export const metadata: Metadata = { title: "Tedarikçi" };
/** "Geçmiş faturaları al" Paraşüt'ü yarım dakikaya kadar okur (eşitlemeyle aynı süre) */
export const maxDuration = 60;

/** Dökümdeki faturaya dokununca: sayfa o faturanın sekmesini ve sayfasını açıp satırına kaydırır (SupplierClient) */
const rowHref = (id: number) => `?fatura=${id}`;
/** Dökümdeki faturasız alıma dokununca: Hesap hareketleri açılır */
const debtHref = () => "?sekme=hareketler";

export default function SupplierPage({ params }: PageProps<"/panel/tedarikciler/[cari]">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader
            eyebrow="Satış & gider"
            title="Tedarikçi"
            actions={
              <ButtonLink href="/panel/tedarikciler" variant="ghost" size="sm">
                <ArrowLeft size={16} /> Tedarikçiler
              </ButtonLink>
            }
          />
          <PageSkeleton rows={8} />
        </>
      }
    >
      <SupplierContent params={params} />
    </Suspense>
  );
}

/** Adresteki parça: tarayıcı Türkçe karakterli yazılmış parçayı kodlanmış gönderebilir */
function slugOf(raw: string): string {
  try {
    return decodeURIComponent(raw).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

async function SupplierContent({ params }: { params: PageProps<"/panel/tedarikciler/[cari]">["params"] }) {
  await requireAdmin();
  const { cari } = await params;
  const { today, termDays: defaultTermDays, groups } = await loadSupplierLedger();
  const slug = slugOf(cari);
  const g = groups.find((x) => x.slug === slug);
  if (!g) {
    // Eski adres: kartsız tedarikçinin adresi anahtarından (adlarının en küçüğünden) gelir; vergi noyla başka bir ad
    // katılınca ya da tedarikçi başka bir tedarikçide toplanınca değişir. Adlarından birinin adresiyse oraya gider
    const moved = groups.find((x) => x.keys.some((k) => supplierSlug(k) === slug));
    if (moved) redirect(supplierHref(moved.slug));
    notFound();
  }
  const [docs, data] = await Promise.all([listInvoiceDocuments(g.invoices.map((i) => i.id)), loadSupplierCari(g, { today, termDays: g.termDays })]);
  const documents: Record<number, DocumentMeta[]> = {};
  for (const d of docs) (documents[d.invoiceId] ??= []).push(d);
  const a = data.account;
  const hasCari = data.debts.length > 0 || data.payments.length > 0;
  const remaining = (id: number) => {
    const d = data.debts.find((x) => x.id === id);
    return d ? debtRemaining(d, data.allocations) : 0;
  };
  const breakdown = accountBreakdowns(g.invoices, { debts: data.debts, account: a, remaining }, { today, termDays: g.termDays, rowHref, debtHref });
  const year = today.slice(0, 4);
  const credit = showsCredit(a);
  const invoiceOpen = g.invoices.filter((i) => i.unpaid).length;
  const openSub = hasCari
    ? [invoiceOpen ? `${num(invoiceOpen)} fatura` : "", a.debtOpenCount ? `${num(a.debtOpenCount)} faturasız alım` : "", a.credit > 0.005 ? `hesapta ${tl(a.credit, 2)}` : ""].filter(Boolean).join(" · ") || "Borç yok"
    : a.openCount
      ? `${num(a.openCount)} fatura${a.requestedCount ? ` · ${num(a.requestedCount)} talep edildi` : ""}`
      : "Borç yok";

  const stats = (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatBreakdown
        title={credit ? "Alacak (fazla ödeme)" : "Kalan borç"}
        description="Ödenmemiş faturalar ve faturasız alımlar (KDV dahil; kısmen ödenmişte kalan); hesapta sayılmamış ödeme düşülür. Kaleme dokununca listede açılır."
        groups={breakdown.open}
        total={a.balance}
        totalLabel={credit ? "Alacak" : "Kalan borç"}
        exact
        empty="Ödenmemiş fatura yok."
      >
        <Stat
          icon={<Wallet />}
          label={credit ? "Alacak (fazla ödeme)" : "Kalan borç"}
          value={<CountUp value={credit ? -a.balance : a.balance} />}
          tone={credit || a.balance <= 0 ? "good" : "warn"}
          sub={credit ? `${tl(-a.balance, 2)} · hesapta sayılmamış ödeme` : openSub}
        />
      </StatBreakdown>
      <StatBreakdown
        title="Vadesi geçen"
        description="Vadesi geçmiş ödenmemiş faturalar ve faturasız alımlar; hesaptaki ödeme en eski vadeden düşülür. Vadesi yazılmamışta tahmini vade sayılır."
        groups={breakdown.overdue}
        total={a.overdue}
        exact
        empty="Vadesi geçmiş fatura yok."
      >
        <Stat
          icon={<AlarmClock />}
          label="Vadesi geçen"
          value={<CountUp value={a.overdue} />}
          tone={a.overdue > 0 ? "bad" : "good"}
          sub={a.overdueCount ? `${num(a.overdueCount)} ${hasCari ? "kalem" : "fatura"}` : a.nextDue ? `En yakın vade ${dateTR(a.nextDue.date)}` : "Geciken yok"}
        />
      </StatBreakdown>
      <StatBreakdown title={`${year} alımları`} description={`${year} faturaları ve faturasız alımları ay ay (KDV dahil; iade eksi; eski borç hariç).`} groups={breakdown.year} total={a.year} exact empty={`${year} yılında fatura yok.`}>
        <Stat
          icon={<CalendarRange />}
          label={`${year} alımları`}
          value={<CountUp value={a.year} />}
          sub={[a.lastInvoice ? `Son fatura ${dateTR(a.lastInvoice)}` : "Fatura yok", a.yearDebts > 0.005 ? `faturasız ${tl(a.yearDebts, 2)} dahil` : ""].filter(Boolean).join(" · ")}
        />
      </StatBreakdown>
      <StatBreakdown
        title="Ödemeler"
        description="Son 12 ödeme günü: ödeme kayıtları ve faturalardaki ödendi işaretleri (KDV dahil). Ödeme günü kaydedilmeden önce ödenmiş faturalar sayılmaz."
        groups={breakdown.paid}
        exact
        empty="Ödeme günü girilmiş fatura yok."
      >
        <Stat
          icon={<CircleCheck />}
          label="Son ödeme"
          value={a.lastPaid ? dateTR(a.lastPaid) : "–"}
          info="Ödeme kayıtları ve ödendi işaretleri; kısmi ödemeler ve hesaba ödemeler dahil."
          sub={a.lastPaid ? tl(a.lastPaidAmount, 2) : "Henüz kayıt yok"}
        />
      </StatBreakdown>
    </div>
  );

  // Şeritler ve pencerelerin verisi (yalnız istemcinin kullandığı alanlar)
  const invoiceById = new Map(g.invoices.map((i) => [i.id, i]));
  const debtById = new Map(data.debts.map((d) => [d.id, d]));
  const candidates = [...data.strong.map((c) => ({ ...c, strong: true })), ...data.weak.map((c) => ({ ...c, strong: false }))].flatMap((c) => {
    const inv = invoiceById.get(c.invoiceId);
    if (!inv) return [];
    const total = c.debtIds.reduce((x, id) => x + (debtById.get(id)?.amount ?? 0), 0);
    return [{ invoiceId: c.invoiceId, debtIds: c.debtIds, date: inv.date, label: invoiceLabel(inv), payable: inv.payable, debtTotal: Math.round(total * 100) / 100, strong: c.strong }];
  });
  const cariData = {
    target: g.card ? { cardId: g.card.id } : { key: g.key },
    cardId: g.card?.id ?? null,
    debts: data.debts,
    payments: data.payments,
    allocations: data.allocations,
    credit: a.credit,
    items: [...a.items, ...a.covered].sort(compareOpenItems).map((it) => ({ kind: it.kind, id: it.id, date: it.date, due: it.due, dueEstimated: it.dueEstimated, balance: it.balance, label: it.label, quiet: it.quiet })),
    candidates,
    late: data.late.flatMap((id) => {
      const d = debtById.get(id);
      // Faturası gelmeyen alımın tutarı (ödenmiş olsa da: gideri yazılmadı; §5.2)
      return d ? [{ id, date: d.date, label: debtLabel(d), amount: d.amount }] : [];
    }),
    kasa: data.kasa,
    foreign: data.foreign,
    foreignIn: data.foreignIn,
    drift: data.drift.length,
    expenses: data.expenses,
    categories: data.categories,
    countedCategories: data.countedCategories,
    defaultCategoryId: data.defaultCategoryId,
    defaultCostMode: defaultCostMode(g.invoices, today),
    businessDay: businessDate(),
  };

  return (
    <SupplierClient
      key={g.slug}
      today={today}
      supplier={{ key: g.key, slug: g.slug, name: g.name, names: g.names, termDays: g.termDays, taxNumber: g.taxNumber, taxNumbers: g.taxNumbers, viaTax: g.viaTax }}
      taxNotes={sharedTaxNotes({ hasCard: Boolean(g.card), count: g.invoices.length, names: g.names }, g.sharedTax)}
      taxIndex={taxNameIndex(groups)}
      card={g.card}
      invoices={g.invoices}
      documents={documents}
      defaultTermDays={defaultTermDays}
      suggestions={aliasCandidates(g, groups, sameSupplier)}
      canFill={isParasutConfigured() && g.invoices.some((i) => i.eInvoiceId || i.externalId)}
      canImport={isParasutConfigured()}
      hidden={isHiddenSupplier(g.card, g.summary, { ...g.account, lastEntry: g.lastEntry })}
      stats={stats}
      cari={cariData}
    />
  );
}
