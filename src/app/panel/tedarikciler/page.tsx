import { AlarmClock, CalendarClock, CircleCheck, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton, Stat } from "@/components/ui/misc";
import { StatBreakdown } from "@/components/ui/stat-breakdown";
import { dateTR, monthLabel, num, tl } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { loadSupplierLedger } from "@/server/data/suppliers";

import { listBreakdowns, paidInMonth, SOON_TEXT } from "./breakdowns";
import { missingInfo, paidInParasut, type SupplierListRow } from "./logic";
import { CountUp, SuppliersClient } from "./suppliers-client";

export const metadata: Metadata = { title: "Tedarikçiler" };

const DESCRIPTION =
  "Cari bilgileri (unvan, vergi no, IBAN, iletişim) ve tedarikçi tedarikçi ödeme takibi. Faturalar Paraşüt'ten her sabah kendiliğinden gelir; ödendi, ödenmedi ya da ödemesi talep edildi işaretini siz koyarsınız.";

export default function SuppliersPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader eyebrow="Satış & gider" title="Tedarikçiler" description={DESCRIPTION} />
          <PageSkeleton rows={8} />
        </>
      }
    >
      <SuppliersContent />
    </Suspense>
  );
}

async function SuppliersContent() {
  await requireAdmin();
  const { today, termDays, groups } = await loadSupplierLedger();
  const month = today.slice(0, 7);
  const rows: SupplierListRow[] = groups.map((g) => ({
    key: g.key,
    slug: g.slug,
    name: g.name,
    names: g.names,
    hasCard: Boolean(g.card),
    legalName: g.card?.legalName ?? null,
    taxNumber: g.card?.taxNumber ?? null,
    iban: g.card?.iban ?? null,
    phone: g.card?.phone ?? null,
    email: g.card?.email ?? null,
    contactName: g.card?.contactName ?? null,
    paidOnDelivery: g.card?.paidOnDelivery ?? false,
    missing: missingInfo(g.card),
    parasutPaid: g.invoices.filter(paidInParasut).length,
    summary: g.summary,
  }));
  const paid = groups.map((g) => ({ slug: g.slug, name: g.name, summary: g.summary, ...paidInMonth(g.invoices, month) }));
  const breakdown = listBreakdowns(paid.map((p) => ({ ...p, paidThisMonth: p.amount, paidThisMonthCount: p.count })));
  const sum = (f: (r: SupplierListRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const open = sum((r) => r.summary.open);
  const openCount = sum((r) => r.summary.openCount);
  const owed = rows.filter((r) => r.summary.openCount > 0).length;
  const overdue = sum((r) => r.summary.overdue);
  const overdueCount = sum((r) => r.summary.overdueCount);
  const soon = sum((r) => r.summary.soon);
  const soonCount = sum((r) => r.summary.soonCount);
  const requested = sum((r) => r.summary.requested);
  const paidTotal = paid.reduce((a, p) => a + p.amount, 0);
  const paidCount = paid.reduce((a, p) => a + p.count, 0);
  // "7 gün içinde" kartında en yakın vadeli tedarikçi (gecikmişler hariç)
  const nextSoon = rows
    .filter((r) => r.summary.soonCount && r.summary.nextDue && r.summary.nextDue.date >= today)
    .sort((a, b) => a.summary.nextDue!.date.localeCompare(b.summary.nextDue!.date))[0];

  return (
    <>
      <PageHeader eyebrow="Satış & gider" title="Tedarikçiler" description={DESCRIPTION} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatBreakdown title="Kalan borç" description="Ödenmemiş faturaların kalan tutarı (KDV dahil), tedarikçi tedarikçi. Tedarikçiye dokununca sayfası açılır." groups={breakdown.open} total={open} totalLabel="Kalan borç" exact empty="Ödenmemiş fatura yok.">
          <Stat
            icon={<Wallet />}
            label="Kalan borç"
            value={<CountUp value={open} />}
            tone={open > 0 ? "warn" : "good"}
            info="KDV dahil. Kısmen ödenmiş Paraşüt faturasında kalan tutar sayılır."
            sub={openCount ? `${num(openCount)} fatura · ${num(owed)} tedarikçi${requested ? ` · ${tl(requested)} talep edildi` : ""}` : "Ödenmemiş fatura yok"}
          />
        </StatBreakdown>
        <StatBreakdown title="Vadesi geçen" description="Vadesi geçmiş ödenmemiş faturalar, tedarikçi tedarikçi. Vadesi yazılmamış faturada tahmini vade sayılır." groups={breakdown.overdue} total={overdue} exact empty="Vadesi geçmiş ödeme yok.">
          <Stat icon={<AlarmClock />} label="Vadesi geçen" value={<CountUp value={overdue} />} tone={overdue > 0 ? "bad" : "good"} sub={overdueCount ? `${num(overdueCount)} fatura` : "Geciken yok"} />
        </StatBreakdown>
        <StatBreakdown title="7 gün içinde" description={`${SOON_TEXT}, tedarikçi tedarikçi.`} groups={breakdown.soon} total={soon} exact empty="Önümüzdeki 7 günde vadesi gelen yok.">
          <Stat
            icon={<CalendarClock />}
            label="7 gün içinde"
            value={<CountUp value={soon} />}
            info={SOON_TEXT}
            sub={soonCount ? `${num(soonCount)} fatura${nextSoon?.summary.nextDue ? ` · ilki ${nextSoon.name} ${dateTR(nextSoon.summary.nextDue.date)}` : ""}` : "Yakın vade yok"}
          />
        </StatBreakdown>
        <StatBreakdown
          title={`${monthLabel(month)} ödenen`}
          description="Bu ay ödendi işaretlenen faturalar (ödeme gününe göre, KDV dahil), tedarikçi tedarikçi."
          groups={breakdown.paid}
          total={paidTotal}
          exact
          empty="Bu ay ödendi işaretlenen fatura yok."
        >
          <Stat
            icon={<CircleCheck />}
            label="Bu ay ödenen"
            value={<CountUp value={paidTotal} />}
            info="Ödeme günü bu ayda olan faturalar. Ödeme günü, ödendi işaretlenirken girilir (varsayılan o gün)."
            sub={paidCount ? `${num(paidCount)} fatura` : "Henüz yok"}
          />
        </StatBreakdown>
      </div>

      <SuppliersClient rows={rows} today={today} defaultTermDays={termDays} />
    </>
  );
}
