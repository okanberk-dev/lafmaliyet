import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { PageSkeleton, Stat } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { monthOfDate, normalizeSupplier } from "@/lib/calc/engine";
import { GOODS_CATEGORIES, INVOICE_CATEGORIES } from "@/lib/constants";
import { monthLabel, monthShort, num, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";

import { InvoicesClient } from "./invoices-client";

export const metadata: Metadata = { title: "Faturalar" };

export default function InvoicesPage({ searchParams }: PageProps<"/panel/faturalar">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Faturalar" excel="Faturalar" />
          <PageSkeleton rows={10} />
        </>
      }
    >
      <InvoicesContent searchParams={searchParams} />
    </Suspense>
  );
}

async function InvoicesContent({ searchParams }: { searchParams: PageProps<"/panel/faturalar">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const model = await loadModel();
  const invoices = [...model.ds.invoices].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const months = [...new Set(invoices.map((i) => monthOfDate(i.date)))].sort();
  const net = (i: { amount: number; discount: number }) => i.amount - i.discount;

  const summary = INVOICE_CATEGORIES.map((c) => ({
    category: c,
    byMonth: months.map((m) => invoices.filter((i) => i.category === c && monthOfDate(i.date) === m).reduce((a, i) => a + net(i), 0)),
  })).filter((r) => r.byMonth.some((v) => v));
  const totalByMonth = months.map((_, idx) => summary.reduce((a, r) => a + r.byMonth[idx], 0));
  const goodsByMonth = months.map((m) => model.goodsPurchases(m));
  const unpaid = invoices.filter((i) => i.unpaid);
  const lastMonth = months[months.length - 1];
  const durum = Array.isArray(sp.durum) ? sp.durum[0] : sp.durum;

  return (
    <>
      <PageHeader
        title="Faturalar"
        excel="Faturalar"
        description="Paraşüt'teki alış faturaları. Mal alımları (hammadde, tatlı, ambalaj) Gelir-gider tablosuna tedarikçi bazında, komisyon faturaları komisyon giderlerine otomatik gider."
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Toplam fatura" value={num(invoices.length)} sub={`${new Set(invoices.map((i) => normalizeSupplier(i.supplier))).size} tedarikçi`} />
        <Stat label={lastMonth ? `${monthLabel(lastMonth)} mal alımı` : "Mal alımı"} value={tl(lastMonth ? model.goodsPurchases(lastMonth) : 0)} sub="KDV hariç, iskonto düşülmüş" />
        <Stat label="Toplam mal alımı" value={tl(goodsByMonth.reduce((a, b) => a + b, 0))} sub={`${months.length} ay`} />
        <Stat label="Ödenmemiş" value={num(unpaid.length)} tone={unpaid.length ? "warn" : "good"} sub={unpaid.length ? tl(unpaid.reduce((a, i) => a + i.payable, 0)) + " KDV dahil" : "Hepsi ödendi"} />
      </div>

      <InvoicesClient
        invoices={invoices}
        months={months}
        suppliers={[...new Set(invoices.map((i) => i.supplier))].sort((a, b) => a.localeCompare(b, "tr"))}
        initialUnpaid={durum === "odenmedi"}
      />

      <Card className="mt-6">
        <CardHeader title="Aylara göre net alımlar (KDV hariç)" description={`Mal maliyeti = ${GOODS_CATEGORIES.join(" + ")}`} />
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>Kategori</TH>
                {months.map((m) => (
                  <TH key={m} numeric>
                    {monthShort(m)} {m.slice(2, 4)}
                  </TH>
                ))}
                <TH numeric>Toplam</TH>
              </tr>
            </THead>
            <tbody>
              {summary.map((r) => (
                <TR key={r.category}>
                  <TD className={cn(GOODS_CATEGORIES.includes(r.category) && "font-medium")}>{r.category}</TD>
                  {r.byMonth.map((v, i) => (
                    <TD key={i} numeric className={cn(!v && "text-coffee-300")}>
                      {v ? tl(v) : "–"}
                    </TD>
                  ))}
                  <TD numeric className="font-medium">
                    {tl(r.byMonth.reduce((a, b) => a + b, 0))}
                  </TD>
                </TR>
              ))}
              <TR className="bg-coffee-50/60 font-semibold">
                <TD>TOPLAM</TD>
                {totalByMonth.map((v, i) => (
                  <TD key={i} numeric>
                    {tl(v)}
                  </TD>
                ))}
                <TD numeric>{tl(totalByMonth.reduce((a, b) => a + b, 0))}</TD>
              </TR>
              <TR className="bg-amber-50/50 font-semibold">
                <TD>Mal maliyeti</TD>
                {goodsByMonth.map((v, i) => (
                  <TD key={i} numeric>
                    {tl(v)}
                  </TD>
                ))}
                <TD numeric>{tl(goodsByMonth.reduce((a, b) => a + b, 0))}</TD>
              </TR>
            </tbody>
          </Table>
        </TableWrap>
      </Card>
    </>
  );
}
