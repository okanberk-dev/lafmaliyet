import { inArray } from "drizzle-orm";
import { CircleAlert, FileText, Table2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, InfoTip, PageSkeleton, Stat } from "@/components/ui/misc";
import { Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import { monthOfDate, normalizeSupplier } from "@/lib/calc/engine";
import { unpaidSummary } from "@/lib/calc/insights";
import { COMMISSION_CATEGORY, GOODS_CATEGORIES, INVOICE_CATEGORIES } from "@/lib/constants";
import { monthLabel, monthShort, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";
import { IGNORE_KEY } from "@/server/parasut/sync";

import { DeletedBills } from "./deleted-bills";
import { CountUp, InvoicesClient } from "./invoices-client";
import { MonthStats } from "./month-stats";
import { DELETED_BILLS_KEY, ignoredBills, type InvoiceRow } from "./rules";

export const metadata: Metadata = { title: "Faturalar" };

const DESCRIPTION =
  "Paraşüt'teki alış faturaları. Mal alımları (hammadde, tatlı, ambalaj) gelir-gider tablosuna tedarikçi bazında, komisyon faturaları komisyon giderlerine otomatik gider.";

/** Sabit kategori sütununun sağındaki ince çizgi (kayarken içerikten ayrılsın) */
const EDGE = "shadow-[inset_-1px_0_0_var(--color-line-strong)]";
/** Yıl toplamı sütunu: gelir-gider tablosundaki gibi hafif koyu şerit */
const TOTAL_COL = "bg-ink/[0.03] pr-5";

/** Aylık tablodan listeye inen bağlantı (?kategori=…&ay=…); liste süzgeçleri adresten okur */
function listHref(filters: { kategori?: string; ay?: string; durum?: string }) {
  const q = new URLSearchParams(Object.entries(filters).filter((e): e is [string, string] => Boolean(e[1])));
  return `/panel/faturalar?${q}#fatura-listesi`;
}
/** Tablo hücresindeki bağlantı: düz rakam gibi görünür, üzerine gelince altı çizilir; dokunmatikte hücre yüksekliğince */
const CELL_LINK =
  "inline-block rounded-sm underline-offset-2 decoration-ink/30 hover:underline focus-visible:underline pointer-coarse:-my-3 pointer-coarse:py-3";

/** Listedeki kategori rozetleriyle aynı anlam: yeşil mal maliyeti, mavi komisyon, gri diğer */
function categoryDot(category: string) {
  if (GOODS_CATEGORIES.includes(category)) return "bg-good";
  if (category === COMMISSION_CATEGORY) return "bg-info";
  return "bg-ink-quiet";
}

export default function InvoicesPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader eyebrow="Para" title="Faturalar" excel="Faturalar" description={DESCRIPTION} />
          <PageSkeleton rows={10} />
        </>
      }
    >
      <InvoicesContent />
    </Suspense>
  );
}

async function InvoicesContent() {
  await requireAdmin();
  const db = getDb();
  const [model, state] = await Promise.all([
    loadModel(),
    db
      .select()
      .from(s.integrationState)
      .where(inArray(s.integrationState.key, [IGNORE_KEY, DELETED_BILLS_KEY])),
  ]);
  // Kalan borç (kısmen ödenmiş Paraşüt faturası) çekirdek veriyle gelir: Invoice.outstanding
  const invoices: InvoiceRow[] = model.ds.invoices
    .map((i) => ({ ...i, outstanding: i.outstanding ?? null }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const ignored = ignoredBills(state.find((r) => r.key === IGNORE_KEY)?.value, state.find((r) => r.key === DELETED_BILLS_KEY)?.value);
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
  const unpaid = unpaidSummary(invoices);
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
        <MonthStats
          months={months}
          goodsByMonth={goodsByMonth}
          commissionByMonth={commissionByMonth}
          goodsInfo={`KDV hariç, iskonto düşülmüş. Mal maliyeti = ${GOODS_CATEGORIES.join(" + ")}.`}
        />
        <Stat
          icon={<CircleAlert />}
          label="Ödenmemiş"
          value={<CountUp value={unpaid.count} />}
          tone={unpaid.count ? "warn" : "good"}
          info={
            unpaid.partialCount
              ? `Kalan borç, KDV dahil. ${unpaid.partialCount} fatura kısmen ödendi: onlarda Paraşüt'ün bildirdiği kalan tutar sayılır (faturaların tamamı ${tl(unpaid.payableTotal)}). Hatırlatıcılar da aynı tutarı kullanır.`
              : "Kalan borç, KDV dahil. Kısmen ödenmiş Paraşüt faturasında kalan tutar sayılır; Hatırlatıcılar da aynı tutarı kullanır."
          }
          sub={
            unpaid.count ? (
              <>
                {tl(unpaid.total)} kalan borç
                <Link
                  href={listHref({ durum: "odenmedi" })}
                  className="flex w-fit items-center font-medium text-warn underline-offset-2 hover:underline pointer-coarse:min-h-10"
                >
                  Listede göster →
                </Link>
              </>
            ) : (
              "Hepsi ödendi"
            )
          }
        />
      </div>

      {/* Süzgeçler (?ara, ?durum=odenmedi, ?kategori, ?ay, ?sirala) adreste; istemci okur, sunucuya istek gitmez */}
      <InvoicesClient
        invoices={invoices}
        months={months}
        suppliers={[...new Set(invoices.map((i) => i.supplier))].sort((a, b) => a.localeCompare(b, "tr"))}
        parasutCompanyId={process.env.PARASUT_COMPANY_ID?.trim() || null}
        ignoredCount={ignored.length}
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
                <span aria-hidden="true">·</span>
                <span>Tutara tıklayınca faturalar listede açılır</span>
                {months.length > 1 ? <span className="sm:hidden">(tabloyu yana kaydırın)</span> : null}
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
                      <Link href={listHref({ ay: m })} className={CELL_LINK} title={`${monthLabel(m)} faturalarını listede göster`}>
                        {monthShort(m)} {m.slice(2, 4)}
                      </Link>
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
                      <TD sticky className={cn(EDGE, "pl-5 max-sm:min-w-36 sm:whitespace-nowrap", goods ? "font-medium" : "text-ink-soft")}>
                        <Link href={listHref({ kategori: r.category })} className={cn(CELL_LINK, "inline-flex items-center gap-2")}>
                          <span className={cn("size-2 shrink-0 rounded-full", categoryDot(r.category))} aria-hidden="true" />
                          {r.category}
                        </Link>
                      </TD>
                      {r.byMonth.map((v, i) => (
                        <TD key={i} numeric className={cn(!v && "text-ink-quiet")}>
                          {v ? (
                            <Link
                              href={listHref({ kategori: r.category, ay: months[i] })}
                              className={CELL_LINK}
                              title={`${r.category} · ${monthLabel(months[i])} faturalarını listede göster`}
                            >
                              {tl(v)}
                            </Link>
                          ) : (
                            "–"
                          )}
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

      {ignored.length ? <DeletedBills bills={ignored} /> : null}
    </>
  );
}
