import { AlarmClock, ArrowLeft, CalendarRange, CircleCheck, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { ButtonLink } from "@/components/ui/button";
import { PageSkeleton, Stat } from "@/components/ui/misc";
import { StatBreakdown } from "@/components/ui/stat-breakdown";
import { dateTR, num, tl } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { loadSupplierLedger } from "@/server/data/suppliers";
import { listInvoiceDocuments, type DocumentMeta } from "@/server/documents";
import { isParasutConfigured } from "@/server/parasut/config";
import { sameSupplier } from "@/server/parasut/mapping";

import { supplierBreakdowns } from "../breakdowns";
import { aliasCandidates } from "../logic";
import { CountUp } from "../suppliers-client";
import { SupplierClient } from "./supplier-client";

export const metadata: Metadata = { title: "Tedarikçi" };

/** Fatura satırının adresi (dökümdeki kalem oraya iner) */
const rowHref = (id: number) => `#fatura-${id}`;

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
  const g = groups.find((x) => x.slug === slugOf(cari));
  if (!g) notFound();
  const docs = await listInvoiceDocuments(g.invoices.map((i) => i.id));
  const documents: Record<number, DocumentMeta[]> = {};
  for (const d of docs) (documents[d.invoiceId] ??= []).push(d);
  const s = g.summary;
  const breakdown = supplierBreakdowns(g.invoices, { today, termDays: g.termDays, rowHref });
  const year = today.slice(0, 4);
  const lastPaidAmount = s.lastPaid ? g.invoices.filter((i) => !i.unpaid && i.paidAt === s.lastPaid).reduce((a, i) => a + i.payable, 0) : 0;

  const stats = (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatBreakdown title="Kalan borç" description="Ödenmemiş faturalar (KDV dahil; kısmen ödenmişte kalan). Faturaya dokununca listede açılır." groups={breakdown.open} total={s.open} totalLabel="Kalan borç" exact empty="Ödenmemiş fatura yok.">
        <Stat
          icon={<Wallet />}
          label="Kalan borç"
          value={<CountUp value={s.open} />}
          tone={s.open > 0 ? "warn" : "good"}
          sub={s.openCount ? `${num(s.openCount)} fatura${s.requestedCount ? ` · ${num(s.requestedCount)} talep edildi` : ""}` : "Borç yok"}
        />
      </StatBreakdown>
      <StatBreakdown title="Vadesi geçen" description="Vadesi geçmiş ödenmemiş faturalar. Vadesi yazılmamış faturada tahmini vade sayılır." groups={breakdown.overdue} total={s.overdue} exact empty="Vadesi geçmiş fatura yok.">
        <Stat
          icon={<AlarmClock />}
          label="Vadesi geçen"
          value={<CountUp value={s.overdue} />}
          tone={s.overdue > 0 ? "bad" : "good"}
          sub={s.overdueCount ? `${num(s.overdueCount)} fatura` : s.nextDue ? `En yakın vade ${dateTR(s.nextDue.date)}` : "Geciken yok"}
        />
      </StatBreakdown>
      <StatBreakdown title={`${year} alımları`} description={`${year} faturaları ay ay (KDV dahil; iade eksi).`} groups={breakdown.year} total={s.year} exact empty={`${year} yılında fatura yok.`}>
        <Stat icon={<CalendarRange />} label={`${year} alımları`} value={<CountUp value={s.year} />} sub={s.lastInvoice ? `Son fatura ${dateTR(s.lastInvoice)}` : "Fatura yok"} />
      </StatBreakdown>
      <StatBreakdown title="Ödemeler" description="Son 12 ödeme günü: o gün ödendi işaretlenen faturalar (KDV dahil). Ödeme günü kaydedilmeden önce ödenmiş faturalar sayılmaz." groups={breakdown.paid} exact empty="Ödeme günü girilmiş fatura yok.">
        <Stat
          icon={<CircleCheck />}
          label="Son ödeme"
          value={s.lastPaid ? dateTR(s.lastPaid) : "–"}
          info="Ödendi işaretlenirken girilen gün. Bu özellikten önce ödenmiş faturaların günü kayıtlı değildir."
          sub={s.lastPaid ? tl(lastPaidAmount, 2) : "Henüz kayıt yok"}
        />
      </StatBreakdown>
    </div>
  );

  return (
    <SupplierClient
      key={g.slug}
      today={today}
      supplier={{ key: g.key, slug: g.slug, name: g.name, names: g.names, termDays: g.termDays }}
      card={g.card}
      invoices={g.invoices}
      documents={documents}
      defaultTermDays={defaultTermDays}
      suggestions={aliasCandidates(g, groups, sameSupplier)}
      canFill={isParasutConfigured() && g.invoices.some((i) => i.eInvoiceId || i.externalId)}
      stats={stats}
    />
  );
}
