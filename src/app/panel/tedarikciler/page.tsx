import { AlarmClock, CalendarClock, CircleCheck, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton, Stat } from "@/components/ui/misc";
import { StatBreakdown } from "@/components/ui/stat-breakdown";
import { dateTR, monthLabel, num, tl } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { paidInMonthOf, type CariAccount } from "@/lib/cari/account";
import { loadCariIndex } from "@/server/data/cari";
import { loadSupplierLedger } from "@/server/data/suppliers";

import { listBreakdowns, SOON_TEXT } from "./breakdowns";
import { isHiddenSupplier, matchesSupplierFilter, missingInfo, paidInParasut, sameTaxNames, taxNameIndex, type HiddenSupplierRow, type SupplierListRow, type SupplierSummary } from "./logic";
import { CountUp, SuppliersClient } from "./suppliers-client";

export const metadata: Metadata = { title: "Tedarikçiler" };

const DESCRIPTION =
  "Tedarikçilerin bilgileri (unvan, vergi no, IBAN, iletişim) ve tedarikçi tedarikçi ödeme takibi. Faturalar Paraşüt'ten her sabah kendiliğinden gelir; ödendi, ödenmedi ya da ödemesi talep edildi işaretini siz koyarsınız.";

/**
 * Listenin satır özeti: hesap özetinin alanları (dökümler istemciye gitmez); cari kaydı olan tedarikçide Kalan borç
 * bakiyedir (açık − hesaptaki para). Kayıt yokken bakiye açığın kendisidir.
 */
function listSummary(a: CariAccount): SupplierSummary {
  return {
    count: a.count,
    invoiced: a.invoiced,
    year: a.year,
    openCount: a.openCount,
    open: a.balance,
    requestedCount: a.requestedCount,
    requested: a.requested,
    overdueCount: a.overdueCount,
    overdue: a.overdue,
    soonCount: a.soonCount,
    soon: a.soon,
    nextDue: a.nextDue,
    nextSoonDue: a.nextSoonDue,
    lastInvoice: a.lastInvoice,
    lastPaid: a.lastPaid,
  };
}

export default function SuppliersPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader eyebrow="Alış & gider" title="Tedarikçiler" description={DESCRIPTION} />
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
  const index = await loadCariIndex(today);
  const month = today.slice(0, 7);
  const isHidden = (g: (typeof groups)[number]) => isHiddenSupplier(g.card, g.summary, { ...g.account, lastEntry: g.lastEntry });
  // Listeden kaldırılanlar listede görünmez (borçları yok; isHiddenSupplier); ödemeleri "Bu ay ödenen"de sayılır
  const shown = groups.filter((g) => !isHidden(g));
  const hidden: HiddenSupplierRow[] = groups.flatMap((g) =>
    g.card?.hiddenOn && isHidden(g) ? [{ cardId: g.card.id, slug: g.slug, name: g.name, hiddenOn: g.card.hiddenOn, count: g.summary.count }] : [],
  );
  // Cari hesap (docs/TEDARIKCILER.md "Hesap hareketleri"): satırın Kalan borcu bakiyedir (açık − hesaptaki para)
  const kasaBy = new Map<number, number>();
  for (const l of index.kasaPending) kasaBy.set(l.cardId, (kasaBy.get(l.cardId) ?? 0) + 1);
  const bySlug = new Map(groups.map((g) => [g.card?.id ?? -1, g]));
  const rows: SupplierListRow[] = shown.map((g) => ({
    key: g.key,
    slug: g.slug,
    name: g.name,
    names: g.names,
    sameTaxNames: sameTaxNames(g),
    hasCard: Boolean(g.card),
    legalName: g.card?.legalName ?? null,
    // Kartta yazılı, yoksa faturalardaki tek vergi no; aramada faturalardaki bütün numaralar
    taxNumber: g.taxNumber,
    taxNumbers: g.taxNumbers.map((t) => t.taxNumber),
    iban: g.card?.iban ?? null,
    phone: g.card?.phone ?? null,
    email: g.card?.email ?? null,
    contactName: g.card?.contactName ?? null,
    paidOnDelivery: g.card?.paidOnDelivery ?? false,
    missing: missingInfo(g.card, g.taxNumber),
    parasutPaid: g.invoices.filter(paidInParasut).length,
    summary: listSummary(g.account),
    credit: g.account.credit,
    debtOpenCount: g.account.debtOpenCount,
    kasaPending: g.card ? (kasaBy.get(g.card.id) ?? 0) : 0,
  }));
  // Bu ay ödenen: ödeme kayıtları ve faturalardaki ödendi işaretleri (paymentEvents; kayıt yokken bugünkü kural)
  const owing = (a: CariAccount) => (a.credit > 0.005 ? Math.max(0, a.balance) : a.balance);
  const paid = groups.map((g) => ({ slug: g.slug, name: g.name, summary: { ...listSummary(g.account), open: owing(g.account) }, ...paidInMonthOf(g.account.events, month) }));
  const breakdown = listBreakdowns(paid.map((p) => ({ ...p, paidThisMonth: p.amount, paidThisMonthCount: p.count })));
  const sum = (f: (r: SupplierListRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  // Üstteki Kalan borç: hesabında para olan tedarikçinin fazla ödemesi (alacak) öteki borçlardan düşülmez
  const open = sum((r) => ((r.credit ?? 0) > 0.005 ? Math.max(0, r.summary.open) : r.summary.open));
  const openCount = sum((r) => r.summary.openCount);
  const owed = rows.filter((r) => matchesSupplierFilter(r, "borclu")).length;
  const creditRows = rows.filter((r) => (r.credit ?? 0) > 0.005);
  const creditTotal = creditRows.reduce((a, r) => a + (r.credit ?? 0), 0);
  const debtCount = sum((r) => r.debtOpenCount ?? 0);
  const kasa = index.kasaPending.flatMap((l) => {
    const g = bySlug.get(l.cardId);
    return g ? [{ id: l.id, date: l.date, kind: l.kind, amount: l.amount, store: l.store, slug: g.slug, name: g.name }] : [];
  });
  const overdue = sum((r) => r.summary.overdue);
  const overdueCount = sum((r) => r.summary.overdueCount);
  const soon = sum((r) => r.summary.soon);
  const soonCount = sum((r) => r.summary.soonCount);
  const requested = sum((r) => r.summary.requested);
  const paidTotal = paid.reduce((a, p) => a + p.amount, 0);
  const paidCount = paid.reduce((a, p) => a + p.count, 0);
  // Ödeme kaydı varsa sayılan "ödeme"dir (kayıtlar ve faturalardaki işaretler), yoksa bugünkü gibi "fatura"
  const paidHasEntries = groups.some((g) => g.account.events.some((e) => e.kind === "payment" && e.date.startsWith(month)));
  // "7 gün içinde" kartında pencerede vadesi ilk gelen tedarikçi (gecikmişler hariç)
  const nextSoon = rows.filter((r) => r.summary.nextSoonDue).sort((a, b) => a.summary.nextSoonDue!.localeCompare(b.summary.nextSoonDue!))[0];

  return (
    <>
      <PageHeader eyebrow="Alış & gider" title="Tedarikçiler" description={DESCRIPTION} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatBreakdown title="Kalan borç" description="Ödenmemiş faturaların kalan tutarı (KDV dahil), tedarikçi tedarikçi. Tedarikçiye dokununca sayfası açılır." groups={breakdown.open} total={open} totalLabel="Kalan borç" exact empty="Ödenmemiş fatura yok.">
          <Stat
            icon={<Wallet />}
            label="Kalan borç"
            value={<CountUp value={open} />}
            tone={open > 0 ? "warn" : "good"}
            info="KDV dahil. Kısmen ödenmiş Paraşüt faturasında kalan tutar sayılır."
            sub={
              openCount
                ? `${num(openCount)} ${debtCount ? "kalem" : "fatura"} · ${num(owed)} tedarikçi${requested ? ` · ${tl(requested)} talep edildi` : ""}${
                    creditTotal > 0.005 ? ` · hesapta ${tl(creditTotal, 2)} sayılmamış ödeme (${num(creditRows.length)} tedarikçi)` : ""
                  }`
                : "Ödenmemiş fatura yok"
            }
          />
        </StatBreakdown>
        <StatBreakdown
          title="Vadesi geçen"
          description={`Vadesi geçmiş ödenmemiş ${debtCount ? "faturalar ve faturasız borçlar" : "faturalar"}, tedarikçi tedarikçi. Vadesi yazılmamış kalemde tahmini vade sayılır.`}
          groups={breakdown.overdue}
          total={overdue}
          exact
          empty="Vadesi geçmiş ödeme yok."
        >
          <Stat icon={<AlarmClock />} label="Vadesi geçen" value={<CountUp value={overdue} />} tone={overdue > 0 ? "bad" : "good"} sub={overdueCount ? `${num(overdueCount)} ${debtCount ? "kalem" : "fatura"}` : "Geciken yok"} />
        </StatBreakdown>
        <StatBreakdown title="7 gün içinde" description={`${SOON_TEXT}, tedarikçi tedarikçi.`} groups={breakdown.soon} total={soon} exact empty="Önümüzdeki 7 günde vadesi gelen yok.">
          <Stat
            icon={<CalendarClock />}
            label="7 gün içinde"
            value={<CountUp value={soon} />}
            info={SOON_TEXT}
            sub={soonCount ? `${num(soonCount)} ${debtCount ? "kalem" : "fatura"}${nextSoon?.summary.nextSoonDue ? ` · ilki ${nextSoon.name} ${dateTR(nextSoon.summary.nextSoonDue)}` : ""}` : "Yakın vade yok"}
          />
        </StatBreakdown>
        <StatBreakdown
          title={`${monthLabel(month)} ödenen`}
          description="Bu ay girilen ödemeler ve ödendi işaretlenen faturalar (ödeme gününe göre, KDV dahil), tedarikçi tedarikçi."
          groups={breakdown.paid}
          total={paidTotal}
          exact
          empty="Bu ay ödendi işaretlenen fatura yok."
        >
          <Stat
            icon={<CircleCheck />}
            label="Bu ay ödenen"
            value={<CountUp value={paidTotal} />}
            info="Ödeme günü bu ayda olan ödemeler ve faturalar; kısmi ödemeler ve hesaba ödemeler dahil. Ödeme günü, ödendi işaretlenirken girilir (varsayılan o gün)."
            sub={paidCount ? `${num(paidCount)} ${paidHasEntries ? "ödeme" : "fatura"}` : "Henüz yok"}
          />
        </StatBreakdown>
      </div>

      <SuppliersClient rows={rows} hidden={hidden} today={today} defaultTermDays={termDays} taxIndex={taxNameIndex(groups)} kasa={kasa} />
    </>
  );
}
