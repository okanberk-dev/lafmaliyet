import { CircleAlert, FileText, Percent, ShoppingBasket, Table2 } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, InfoTip, PageSkeleton, Stat } from "@/components/ui/misc";
import { Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import { monthOfDate, normalizeSupplier } from "@/lib/calc/engine";
import { COMMISSION_CATEGORY, GOODS_CATEGORIES, INVOICE_CATEGORIES } from "@/lib/constants";
import { monthLabel, monthShort, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";

import { CountUp, InvoicesClient } from "./invoices-client";

export const metadata: Metadata = { title: "Faturalar" };

const DESCRIPTION =
  "Paraşüt'teki alış faturaları. Mal alımları (hammadde, tatlı, ambalaj) gelir-gider tablosuna tedarikçi bazında, komisyon faturaları komisyon giderlerine otomatik gider.";

/** Sabit kategori sütununun sağındaki ince çizgi (kayarken içerikten ayrılsın) */
const EDGE = "shadow-[inset_-1px_0_0_var(--color-line-strong)]";
/** Yıl toplamı sütunu: gelir-gider tablosundaki gibi hafif koyu şerit */
const TOTAL_COL = "bg-ink/[0.03] pr-5";

/** Listedeki kategori rozetleriyle aynı anlam: yeşil mal maliyeti, mavi komisyon, gri diğer */
function categoryDot(category: string) {
  if (GOODS_CATEGORIES.includes(category)) return "bg-good";
  if (category === COMMISSION_CATEGORY) return "bg-info";
  return "bg-ink-quiet";
}

export default function InvoicesPage({ searchParams }: PageProps<"/panel/faturalar">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader eyebrow="Para" title="Faturalar" excel="Faturalar" description={DESCRIPTION} />
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
  const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  const summary = INVOICE_CATEGORIES.map((c) => ({
    category: c,
    byMonth: months.map((m) => invoices.filter((i) => i.category === c && monthOfDate(i.date) === m).reduce((a, i) => a + net(i), 0)),
  })).filter((r) => r.byMonth.some((v) => v));
  const totalByMonth = months.map((_, idx) => summary.reduce((a, r) => a + r.byMonth[idx], 0));
  const goodsByMonth = months.map((m) => model.goodsPurchases(m));
  const commissionByMonth = summary.find((r) => r.category === COMMISSION_CATEGORY)?.byMonth ?? months.map(() => 0);
  const unpaid = invoices.filter((i) => i.unpaid);
  const lastMonth = months[months.length - 1];
  const durum = Array.isArray(sp.durum) ? sp.durum[0] : sp.durum;
  const supplierCount = new Set(invoices.map((i) => normalizeSupplier(i.supplier))).size;

  return (
    <>
      <PageHeader eyebrow="Para" title="Faturalar" excel="Faturalar" description={DESCRIPTION} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={<FileText />}
          label="Toplam fatura"
          value={<CountUp value={invoices.length} />}
          sub={`${supplierCount} tedarikçi`}
          info="Tedarikçi adının sonundaki parantezli not ayrı tedarikçi sayılmaz: “Kaldi (ödenmedi)” ile “Kaldi” aynı tedarikçidir."
        />
        <Stat
          icon={<ShoppingBasket />}
          label={lastMonth ? `${monthLabel(lastMonth)} mal alımı` : "Mal alımı"}
          value={<CountUp value={lastMonth ? model.goodsPurchases(lastMonth) : 0} format="tl" />}
          sub={`Toplam ${tl(total(goodsByMonth))} · ${months.length} ay`}
          info={`KDV hariç, iskonto düşülmüş. Mal maliyeti = ${GOODS_CATEGORIES.join(" + ")}.`}
        />
        <Stat
          icon={<Percent />}
          label={lastMonth ? `${monthLabel(lastMonth)} komisyon` : "Komisyon"}
          value={<CountUp value={commissionByMonth[commissionByMonth.length - 1] ?? 0} format="tl" />}
          sub={`Toplam ${tl(total(commissionByMonth))} · ${months.length} ay`}
          info="Komisyon kategorisindeki faturalar (KDV hariç). Gelir-gider tablosunda komisyon giderlerine eklenir."
        />
        <Stat
          icon={<CircleAlert />}
          label="Ödenmemiş"
          value={<CountUp value={unpaid.length} />}
          tone={unpaid.length ? "warn" : "good"}
          sub={unpaid.length ? tl(unpaid.reduce((a, i) => a + i.payable, 0)) + " KDV dahil" : "Hepsi ödendi"}
        />
      </div>

      {/* ?durum= değişince (ör. bildirimdeki "ödenmemiş faturalar" bağlantısı bu sayfadayken) filtreler baştan kurulur */}
      <InvoicesClient
        key={durum === "odenmedi" ? "odenmedi" : "tumu"}
        invoices={invoices}
        months={months}
        suppliers={[...new Set(invoices.map((i) => i.supplier))].sort((a, b) => a.localeCompare(b, "tr"))}
        initialUnpaid={durum === "odenmedi"}
        parasutCompanyId={process.env.PARASUT_COMPANY_ID?.trim() || null}
      />

      <Card className="mt-6">
        <CardHeader
          icon={<Table2 />}
          title="Aylara göre net alımlar"
          description={`KDV hariç, iskonto düşülmüş · Mal maliyeti = ${GOODS_CATEGORIES.join(" + ")}`}
          meta={
            months.length ? (
              <>
                <span>{summary.length} kategori</span>
                <span aria-hidden="true">·</span>
                <span>{months.length} ay</span>
              </>
            ) : null
          }
        />
        {months.length ? (
          <TableWrap className="px-0">
            <Table>
              <THead>
                <tr>
                  <TH sticky className={cn(EDGE, "pl-5")}>
                    Kategori
                  </TH>
                  {months.map((m) => (
                    <TH key={m} numeric>
                      {monthShort(m)} {m.slice(2, 4)}
                    </TH>
                  ))}
                  <TH numeric className={TOTAL_COL}>
                    Toplam
                  </TH>
                </tr>
              </THead>
              <tbody>
                {summary.map((r) => {
                  const goods = GOODS_CATEGORIES.includes(r.category);
                  return (
                    <TR key={r.category}>
                      <TD sticky className={cn(EDGE, "pl-5 whitespace-nowrap", goods ? "font-medium" : "text-ink-soft")}>
                        <span className="inline-flex items-center gap-2">
                          <span className={cn("size-2 shrink-0 rounded-full", categoryDot(r.category))} aria-hidden="true" />
                          {r.category}
                        </span>
                      </TD>
                      {r.byMonth.map((v, i) => (
                        <TD key={i} numeric className={cn(!v && "text-ink-quiet")}>
                          {v ? tl(v) : "–"}
                        </TD>
                      ))}
                      <TD numeric className={cn(TOTAL_COL, "font-medium")}>
                        {tl(total(r.byMonth))}
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
              <tfoot>
                <TFootRow>
                  <TD sticky className={cn(EDGE, "pl-5")}>
                    Toplam
                  </TD>
                  {totalByMonth.map((v, i) => (
                    <TD key={i} numeric>
                      {tl(v)}
                    </TD>
                  ))}
                  <TD numeric className={TOTAL_COL}>
                    {tl(total(totalByMonth))}
                  </TD>
                </TFootRow>
                <TFootRow className="border-line">
                  <TD sticky className={cn(EDGE, "pl-5")}>
                    <span className="inline-flex items-center gap-2">
                      <span className="size-2 shrink-0 rounded-full bg-good" aria-hidden="true" />
                      Mal maliyeti
                      <InfoTip text={`Gelir-gider tablosuna giden mal alışı: ${GOODS_CATEGORIES.join(" + ")}.`} />
                    </span>
                  </TD>
                  {goodsByMonth.map((v, i) => (
                    <TD key={i} numeric>
                      {tl(v)}
                    </TD>
                  ))}
                  <TD numeric className={TOTAL_COL}>
                    {tl(total(goodsByMonth))}
                  </TD>
                </TFootRow>
              </tfoot>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState title="Henüz fatura yok" description="Fatura ekledikçe aylık özet burada oluşur." />
        )}
      </Card>
    </>
  );
}
