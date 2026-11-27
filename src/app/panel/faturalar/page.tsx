import { and, inArray, isNotNull, ne } from "drizzle-orm";
import { ChevronDown, CircleAlert, FileText, Table2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, InfoTip, PageSkeleton, Stat } from "@/components/ui/misc";
import { Notice, NoticeLink } from "@/components/ui/notice";
import { StatBreakdown } from "@/components/ui/stat-breakdown";
import { Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import { monthOfDate, normalizeSupplier } from "@/lib/calc/engine";
import { unpaidSummary } from "@/lib/calc/insights";
import { COMMISSION_CATEGORY, GOODS_CATEGORIES, INVOICE_CATEGORIES, SEPARATE_CATEGORIES } from "@/lib/constants";
import { monthLabel, monthShort, num, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { namedTill, tillBranches } from "@/lib/branches";
import { invoiceBranchLabel, invoiceBranchOptions, invoiceBranchValue } from "@/lib/invoice-branch";
import { DEFAULT_PARASUT_ACCOUNT } from "@/lib/parasut/accounts";
import { isReadOnly } from "@/lib/roles";
import { requireCan } from "@/server/auth/dal";
import { currentBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { loadInvoiceCariLinks } from "@/server/data/cari";
import { loadCashOutInvoiceState, scopeCashOutInvoiceState } from "@/server/data/cash-out-invoices";
import { cashOutCategories } from "@/server/data/cash-outs";
import { loadModel } from "@/server/data/dataset";
import { loadUnassignedBox, unassignedInvoiceCount } from "@/server/data/invoice-branch";
import { stockOnlyIds } from "@/server/data/stock-only-invoices";
import { loadSupplierCards } from "@/server/data/suppliers";
import { getDb, schema as s } from "@/server/db";
import { listInvoiceDocuments } from "@/server/documents";
import { loadParasutAccounts } from "@/server/parasut/accounts";
import { loadParasutSettings } from "@/server/parasut/config";
import { IGNORE_KEY } from "@/server/parasut/sync";

import { groupSuppliers, supplierPairKey } from "../tedarikciler/logic";
import { invoiceBreakdowns } from "./breakdowns";
import { DeletedBills } from "./deleted-bills";
import { groupDocuments } from "./document-rules";
import { CountUp, InvoicesClient } from "./invoices-client";
import { MonthStatCards } from "./month-stat-cards";
import { ReviewNotice } from "./review-notice";
import { UnassignedBox } from "./unassigned-box";
import { DELETED_BILLS_KEY, ignoredBills, UNPAID_VS_PAYMENTS, type InvoiceRow } from "./rules";

export const metadata: Metadata = { title: "Faturalar" };

const DESCRIPTION = "Alış faturaları Paraşüt'ten her sabah gelir; elle de ekleyebilirsiniz.";
/**
 * Salt okunur hesabın (muhasebeci; docs/ROLLER.md) ve yükleme iskeletinin açıklaması: fatura eklemeyi önermez. Rol
 * okunana kadar iki rolün ortak cümlesi çizilir (Kasa raporu'ndaki gibi en dar olan)
 */
const READ_ONLY_DESCRIPTION = "Alış faturaları Paraşüt'ten her sabah gelir.";
// Eski uzun açıklama: başlıktaki ⓘ "Nasıl çalışır?" (docs/planlar/ux-sade.md §8)
const MORE =
  "Paraşüt'e gelen e-faturalar her sabah kendiliğinden gelir, Paraşüt'te “içeri al” gerekmez; elle eklediğiniz faturalar da burada. Mal alımları (hammadde, tatlı, ambalaj) gelir-gider tablosuna tedarikçi bazında, komisyon faturaları komisyon giderlerine otomatik gider.";

/** Sabit kategori sütununun sağındaki ince çizgi (kayarken içerikten ayrılsın) */
const EDGE = "shadow-[inset_-1px_0_0_var(--color-line-strong)]";
/** Yıl toplamı sütunu: gelir-gider tablosundaki gibi hafif koyu şerit */
const TOTAL_COL = "bg-ink/[0.03] pr-5";

/** Aylık tablodan ve kart dökümlerinden listeye inen bağlantı (?kategori=…&ay=…&ara=…); liste süzgeçleri adresten okur */
function listHref(filters: { kategori?: string; ay?: string; durum?: string; ara?: string }) {
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
  if (SEPARATE_CATEGORIES.includes(category)) return "bg-bordo-600";
  return "bg-ink-quiet";
}

export default function InvoicesPage() {
  return (
    <Suspense
      fallback={
        <>
          {/* Rol okunana kadar en dar başlık (iki rolün açtığı ekran): ekleme önermeyen açıklama, muhasebecinin bağlam satırı */}
          <PageHeader path="/panel/faturalar" role="accountant" title="Faturalar" description={READ_ONLY_DESCRIPTION} />
          <PageSkeleton rows={10} />
        </>
      }
    >
      <InvoicesContent />
    </Suspense>
  );
}

async function InvoicesContent() {
  // Yönetici ve muhasebeci (docs/ROLLER.md). Muhasebeci salt okur: ekran ona yazma düğmesi ve açamayacağı ekrana bağlantı
  // çizmez (isReadOnly, openableHref); sunucu eylemleri ayrıca reddeder
  const viewer = await requireCan("muhasebe.oku");
  const readOnly = isReadOnly(viewer.role);
  const db = getDb();
  const [model, state, docs, cards, taxRows, cariLinks, stockOnly, cashOutState, cashOutCats, parasutCompanies, scope, branches, accountRows, unassigned] = await Promise.all([
    loadModel(),
    db
      .select()
      .from(s.integrationState)
      .where(inArray(s.integrationState.key, [IGNORE_KEY, DELETED_BILLS_KEY])),
    // Yalnız belge bilgileri (ad, tür, boyut); dosyanın kendisi açılınca /api/faturalar/{id}/belge'den gelir
    listInvoiceDocuments(),
    loadSupplierCards(),
    // Tedarikçinin vergi nosu çekirdek veride yok (hesaplar kullanmaz): pencere ve tedarikçi bağlantısı için ayrıca
    db.select({ id: s.invoices.id, supplierTaxNumber: s.invoices.supplierTaxNumber }).from(s.invoices).where(isNotNull(s.invoices.supplierTaxNumber)),
    // Faturaya sayılan cari ödemeler ve bağlı faturasız alımlar (pencere ve silme onayı); kayıt yokken boş
    loadInvoiceCariLinks(),
    // Kalemi hammaddeye bağlı ama mal alışı sayılmayan faturalar (E-07): rozet, uyarı ve pencere ipucu
    stockOnlyIds(db).then((ids) => new Set(ids)),
    // Kasadan faturalı alımlar, faturası yok (E-42) ve faturası sonradan gelip iki kez sayılanlar: Kontrol süzgecinin
    // kartı; okunamazsa kart çıkmaz, liste açılır
    loadCashOutInvoiceState(db).catch((e) => {
      console.error("Kasadan faturalı alımlar okunamadı", e);
      return { pending: [], duplicates: [] };
    }),
    cashOutCategories("admin"),
    // Paraşüt'teki faturanın bağlantısı için hesapların firma numaraları (panelde ya da varsayılan hesapta ortamda);
    // okunamazsa bağlantı çıkmaz
    loadParasutAccounts()
      .then((accounts) => Promise.all(accounts.map(async (a) => [a.id, (await loadParasutSettings(a.id)).resolved.companyId.value] as const)))
      .catch(() => [] as (readonly [string, string | null])[]),
    currentBranchScope(),
    listBranches(),
    // Varsayılan hesabın dışındaki Paraşüt hesabından gelen faturalar (şube başına Paraşüt hesabı; çoğu kurulumda yok)
    db
      .select({ id: s.invoices.id, parasutAccount: s.invoices.parasutAccount })
      .from(s.invoices)
      .where(and(isNotNull(s.invoices.parasutAccount), ne(s.invoices.parasutAccount, DEFAULT_PARASUT_ACCOUNT))),
    unassignedInvoiceCount(db),
  ]);
  // Faturanın şubesi (birden çok kasa açıkken): rozet, pencere ve toplu seçim; "Tümü"de şubesi seçilmemişlerin kutusu
  const manyTills = tillBranches(branches).length > 1;
  const branchOptions = manyTills ? invoiceBranchOptions(branches) : [];
  const scopeName = manyTills ? (branches.find((b) => b.id === scope)?.name ?? null) : null;
  const box = manyTills && !scopeName && unassigned.count ? await loadUnassignedBox({ branches }, db) : null;
  // Kasadan faturalı alımlar seçili şubenin kasasından (docs/SUBE.md › Ödemeler; faturalar işletme geneli kalır); birden çok
  // kasa açıkken satır hangi kasadan çıktığını söyler ("Kasa 24 Kas · Marina")
  const tillName = (id: string) => namedTill(branches, id)?.name ?? null;
  const scopedCashOuts = scopeCashOutInvoiceState(cashOutState, scope);
  const cashOuts = {
    pending: scopedCashOuts.pending.map((r) => ({ ...r, tillName: tillName(r.branchId) })),
    duplicates: scopedCashOuts.duplicates.map((r) => ({ ...r, tillName: tillName(r.branchId) })),
  };
  const taxOf = new Map(taxRows.map((r) => [r.id, r.supplierTaxNumber]));
  // Faturanın Paraşüt hesabı (varsayılan hesap dışındaysa)
  const accountOf = new Map(accountRows.map((r) => [r.id, r]));
  const companies = Object.fromEntries(parasutCompanies.flatMap(([id, c]) => (c ? [[id, c]] : [])));
  // Kalan borç (kısmen ödenmiş Paraşüt faturası) çekirdek veriyle gelir: Invoice.outstanding
  const invoices: InvoiceRow[] = model.ds.invoices
    .map((i) => {
      const acc = accountOf.get(i.id);
      return {
        ...i,
        outstanding: i.outstanding ?? null,
        supplierTaxNumber: taxOf.get(i.id) ?? null,
        stockOnly: stockOnly.has(i.id),
        ...(acc?.parasutAccount && acc.parasutAccount !== DEFAULT_PARASUT_ACCOUNT ? { parasutAccount: acc.parasutAccount } : {}),
        ...(manyTills ? { branchName: invoiceBranchLabel(invoiceBranchValue(i), branches) } : {}),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const ignored = ignoredBills(state.find((r) => r.key === IGNORE_KEY)?.value, state.find((r) => r.key === DELETED_BILLS_KEY)?.value);
  const months = [...new Set(invoices.map((i) => monthOfDate(i.date)))].sort();
  const net = (i: { amount: number; discount: number }) => i.amount - i.discount;
  const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  const allSummary = INVOICE_CATEGORIES.map((c) => ({
    category: c,
    byMonth: months.map((m) => invoices.filter((i) => i.category === c && monthOfDate(i.date) === m).reduce((a, i) => a + net(i), 0)),
  })).filter((r) => r.byMonth.some((v) => v));
  // Kafe dışı (karaoke box, Alp Koç) faturalar toplama girmez, tablonun altında ayrı satırda
  const summary = allSummary.filter((r) => !SEPARATE_CATEGORIES.includes(r.category));
  const separate = allSummary.filter((r) => SEPARATE_CATEGORIES.includes(r.category));
  const totalByMonth = months.map((_, idx) => summary.reduce((a, r) => a + r.byMonth[idx], 0));
  const goodsByMonth = months.map((m) => model.goodsPurchases(m));
  const commissionByMonth = summary.find((r) => r.category === COMMISSION_CATEGORY)?.byMonth ?? months.map(() => 0);
  const unpaid = unpaidSummary(invoices);
  const supplierCount = new Set(invoices.map((i) => normalizeSupplier(i.supplier))).size;
  // Eşitlemenin kategorisini tahminle yazdığı, onay bekleyen faturalar; stoğa girip gelir-gidere girmeyenler de (E-07)
  const reviewCount = invoices.filter((i) => i.needsReview).length;
  const stockOnlyCount = invoices.filter((i) => i.needsReview && i.stockOnly).length;
  // Kartların dökümü (karta dokununca): kategori kategori, kategoride tedarikçi tedarikçi; ay kartları ay ay
  const breakdown = invoiceBreakdowns(invoices, months, listHref);
  // Fatura kategorisi → bağlı Aylık harcamalar kategorisi (pencere bu faturanın gelir-giderde nerede sayıldığını söyler)
  const expenseLinks = Object.fromEntries((model.ds.expenseCategories ?? []).filter((c) => c.invoiceCategory).map((c) => [c.invoiceCategory!, c.name]));
  // (Ad, vergi no) çifti → Tedarikçiler'deki sayfası (pencerede "Tedarikçinin sayfası" bağlantısı): aynı adın
  // faturaları vergi nolarına göre farklı tedarikçide olabilir; tarih ve tutar gerekmez
  const supplierSlugs = Object.fromEntries(
    groupSuppliers(invoices, cards, { today: "", termDays: 0 }).flatMap((g) => g.invoices.map((i) => [supplierPairKey(i.supplier, i.supplierTaxNumber), g.slug] as const)),
  );

  return (
    <>
      <PageHeader path="/panel/faturalar" role={viewer.role} title="Faturalar" description={readOnly ? READ_ONLY_DESCRIPTION : DESCRIPTION} more={readOnly ? undefined : MORE} />
      {/* Faturanın şubesi (docs/SUBE.md › Faturanın şubesi): tek şube seçiliyken o şubenin ve işletme genelinin faturaları;
          şubesi seçilmemişler "Tümü"deki kutuda */}
      {scopeName ? (
        <Notice
          tone={unassigned.count ? "warn" : "neutral"}
          className="mb-4"
          title={`${scopeName} seçili: ${scopeName} şubesinin ve işletme genelinin faturaları`}
          text={
            unassigned.count
              ? `${num(unassigned.count)} faturanın şubesi seçilmemiş (${tl(unassigned.total)}); burada görünmezler. ${readOnly ? "Tümü'de “Şubesi seçilmemiş” süzgecinde görünürler." : "Tümü'de “Şubesi seçilmemiş” kutusundan şubelerini seçin."}`
              : "Öbür şubelerin faturaları burada görünmez; Tümü'de hepsi."
          }
          action={
            unassigned.count ? <NoticeLink href={readOnly ? "/panel/faturalar?sube=hepsi&durum=subesiz#fatura-listesi" : "/panel/faturalar?sube=hepsi#subesiz"}>Şubesi seçilmemişler</NoticeLink> : undefined
          }
        />
      ) : box && !readOnly ? (
        // Şube atama kutusu yazar: salt okunur hesapta yok (şubesi seçilmemişler listenin süzgecinde durur)
        <UnassignedBox box={box} options={branchOptions} />
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatBreakdown
          title="Bütün faturalar"
          description={`${num(invoices.length)} fatura, kategori kategori (KDV hariç, iskonto düşülmüş). Kafe dışı faturalar toplama girmez. Kategoriye dokununca liste süzülür.`}
          groups={breakdown.all}
          empty="Henüz fatura yok."
        >
          <Stat
            icon={<FileText />}
            label="Toplam fatura"
            value={<CountUp value={invoices.length} />}
            sub={`${supplierCount} tedarikçi`}
            info="Tedarikçi adının sonundaki parantezli not ayrı tedarikçi sayılmaz: “Kaldi (ödenmedi)” ile “Kaldi” aynı tedarikçidir."
          />
        </StatBreakdown>
        <MonthStatCards
          months={months}
          goodsByMonth={goodsByMonth}
          commissionByMonth={commissionByMonth}
          goodsInfo={`KDV hariç, iskonto düşülmüş. Mal maliyeti = ${GOODS_CATEGORIES.join(" + ")}; karışık faturada kalem kalem (hammaddeye bağlı kalem mal alışı).`}
          goods={breakdown.goods}
          commission={breakdown.commission}
        />
        <StatBreakdown
          title="Ödenmemiş faturalar"
          description="Kalan borç (KDV dahil), kategori kategori, tedarikçi tedarikçi. Tedarikçiye dokununca ödenmemiş faturaları listede açılır."
          groups={breakdown.unpaid}
          total={unpaid.total}
          totalLabel="Kalan borç"
          empty="Ödenmemiş fatura yok."
        >
          <Stat
            icon={<CircleAlert />}
            label="Ödenmemiş"
            value={<CountUp value={unpaid.count} />}
            tone={unpaid.count ? "warn" : "good"}
            info={
              `${
                unpaid.partialCount
                  ? `Kalan borç, KDV dahil. ${unpaid.partialCount} fatura kısmen ödendi: onlarda Paraşüt'ün bildirdiği kalan tutar sayılır (faturaların tamamı ${tl(unpaid.payableTotal)}).`
                  : "Kalan borç, KDV dahil. Kısmen ödenmiş Paraşüt faturasında kalan tutar sayılır."
              } ${UNPAID_VS_PAYMENTS}`
            }
            sub={
              unpaid.count ? (
                <>
                  {tl(unpaid.total)} kalan borç
                  {/* Kartın döküm düğmesinin üstünde kalır (konumlu): dokununca doğrudan listeye iner */}
                  <Link
                    href={listHref({ durum: "odenmedi" })}
                    className="relative flex w-fit items-center font-medium text-warn underline-offset-2 hover:underline pointer-coarse:min-h-11"
                  >
                    Listede göster →
                  </Link>
                </>
              ) : (
                "Hepsi ödendi"
              )
            }
          />
        </StatBreakdown>
      </div>

      <ReviewNotice count={reviewCount} stockOnly={stockOnlyCount} cashOuts={cashOuts.pending.length} cashOutDuplicates={cashOuts.duplicates.length} readOnly={readOnly} />

      {/* Süzgeçler (?ara, ?durum=odenmedi|kontrol, ?kategori, ?ay, ?sirala) adreste; istemci okur, sunucuya istek gitmez */}
      <InvoicesClient
        invoices={invoices}
        documents={groupDocuments(docs)}
        months={months}
        suppliers={[...new Set(invoices.map((i) => i.supplier))].sort((a, b) => a.localeCompare(b, "tr"))}
        parasutCompanyId={companies[DEFAULT_PARASUT_ACCOUNT] ?? null}
        parasutCompanies={companies}
        ignoredCount={ignored.length}
        expenseLinks={expenseLinks}
        supplierSlugs={supplierSlugs}
        cariLinks={cariLinks}
        cashOuts={cashOuts.pending}
        cashOutDuplicates={cashOuts.duplicates}
        cashOutCategories={cashOutCats.map(({ id, name }) => ({ id, name }))}
        branchOptions={branchOptions}
        defaultBranch={scopeName ? scope : ""}
        role={viewer.role}
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
                <span className="sm:hidden">Aya dokunun; kategoriye dokununca faturalar listede açılır</span>
                <span className="max-sm:hidden">Tutara tıklayınca faturalar listede açılır</span>
              </>
            ) : null
          }
        />
        {months.length ? (
          // Telefon: ay ay liste (tablo yana kayardı); en yeni ay açık. sm'den itibaren tablo.
          <div className="space-y-2 px-4 pb-4 sm:hidden">
            {[...months.keys()].reverse().map((idx, n) => {
              const m = months[idx];
              const rows = summary.filter((r) => r.byMonth[idx]);
              return (
                <details key={m} open={n === 0} className="group rounded-2xl bg-surface ring-1 ring-line">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium text-ink">{monthLabel(m)}</span>
                      <span className="block text-xs text-ink-mute tabular">Mal maliyeti {tl(goodsByMonth[idx])}</span>
                    </span>
                    <span className="text-[15px] font-semibold text-ink tabular">{tl(totalByMonth[idx])}</span>
                    <ChevronDown size={16} className="shrink-0 text-ink-mute transition-transform group-open:rotate-180" aria-hidden="true" />
                  </summary>
                  <ul className="divide-y divide-line border-t border-line">
                    {rows.map((r) => (
                      <li key={r.category}>
                        <Link
                          href={listHref({ kategori: r.category, ay: m })}
                          className="flex min-h-11 items-center gap-2.5 px-4 py-2 text-sm"
                          title={`${r.category} · ${monthLabel(m)} faturalarını listede göster`}
                        >
                          <span className={cn("size-2 shrink-0 rounded-full", categoryDot(r.category))} aria-hidden="true" />
                          <span className={cn("min-w-0 flex-1 break-words", GOODS_CATEGORIES.includes(r.category) ? "font-medium text-ink" : "text-ink-soft")}>
                            {r.category}
                          </span>
                          <span className="text-ink tabular">{tl(r.byMonth[idx])}</span>
                        </Link>
                      </li>
                    ))}
                    {separate
                      .filter((r) => r.byMonth[idx])
                      .map((r) => (
                        <li key={r.category}>
                          <Link href={listHref({ kategori: r.category, ay: m })} className="flex min-h-11 items-center gap-2.5 px-4 py-2 text-sm">
                            <span className={cn("size-2 shrink-0 rounded-full", categoryDot(r.category))} aria-hidden="true" />
                            <span className="min-w-0 flex-1 break-words text-ink-soft">
                              {r.category} <span className="text-xs text-ink-mute">· kafe dışı, toplama girmez</span>
                            </span>
                            <span className="text-ink-soft tabular">{tl(r.byMonth[idx])}</span>
                          </Link>
                        </li>
                      ))}
                    <li>
                      <Link href={listHref({ ay: m })} className="flex min-h-11 items-center justify-between gap-2 px-4 py-2 text-[13px] font-medium text-info">
                        {monthLabel(m)} faturalarını listede göster <span aria-hidden="true">→</span>
                      </Link>
                    </li>
                  </ul>
                </details>
              );
            })}
            <p className="flex items-center justify-between gap-2 px-1 pt-1 text-[13px] text-ink-mute tabular">
              <span>{months.length} ay toplamı</span>
              <span className="font-semibold text-ink">{tl(total(totalByMonth))}</span>
            </p>
          </div>
        ) : null}
        {months.length ? (
          <TableWrap className="px-0 max-sm:hidden">
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
                      <InfoTip text={`Gelir-gider tablosuna giden mal alışı: ${GOODS_CATEGORIES.join(" + ")}; karışık faturada kalem kalem (öbür kategorideki faturanın hammaddeye bağlı kalemi de, mal faturasının Sarf / Demirbaş / Hizmet denmiş kalemi hariç). Kategori satırları faturanın kategorisiyle.`} />
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
                {separate.map((r) => (
                  <TFootRow key={r.category} className="border-line">
                    <TD sticky className={cn(EDGE, "pl-5 font-normal text-ink-soft")}>
                      <Link href={listHref({ kategori: r.category })} className={cn(CELL_LINK, "inline-flex items-center gap-2")}>
                        <span className={cn("size-2 shrink-0 rounded-full", categoryDot(r.category))} aria-hidden="true" />
                        {r.category}
                        <InfoTip text={`Kafe dışı (${r.category === "Karaoke box" ? "karaoke box, ayrı AVM" : `${r.category} hesabına`}): Toplam'a, gelir-gidere ve mal maliyetine girmez.`} />
                      </Link>
                    </TD>
                    {r.byMonth.map((v, i) => (
                      <TD key={i} numeric className={cn("font-normal", v ? "text-ink-soft" : "text-ink-quiet")}>
                        {v ? tl(v) : "–"}
                      </TD>
                    ))}
                    <TD numeric className={cn(TOTAL_COL, "font-normal text-ink-soft")}>
                      {tl(total(r.byMonth))}
                    </TD>
                  </TFootRow>
                ))}
              </tfoot>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState title="Henüz fatura yok" description={readOnly ? "Faturalar geldikçe aylık özet burada oluşur." : "Fatura ekledikçe aylık özet burada oluşur."} />
        )}
      </Card>

      {/* Silinen Paraşüt faturalarını geri almak yazar: salt okunur hesapta kart yok */}
      {ignored.length && !readOnly ? <DeletedBills bills={ignored} /> : null}
      {/* Telefon: sayfanın sonu yüzen "Fatura ekle" düğmesinin altında kalmasın (tablette düğme başlıkta) */}
      {readOnly ? null : <div aria-hidden="true" className="h-16 sm:hidden" />}
    </>
  );
}
