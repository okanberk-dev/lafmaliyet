import { and, asc, count, desc, eq, isNotNull, isNull, lt, max, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";

import { HashScroll } from "@/components/panel/hash-scroll";
import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { INVOICE_CATEGORIES } from "@/lib/constants";
import { missingSettings, settingsView } from "@/lib/parasut/settings";
import { packEvidence, sameFactor } from "@/lib/product-match";
import { requireAdmin } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";
import { invoiceReadingState } from "@/server/invoice-reading/read";
import { parasutConnection } from "@/server/parasut/client";
import { configFrom, hasParasutInvoices, loadParasutSettings, parasutRedirectUri } from "@/server/parasut/config";
import { parseReturnLog, RETURNS_KEY, supplierReturnEntered } from "@/server/parasut/returns";
import { ignoredProducts, unlinkedProducts } from "@/server/parasut/sync";

import { invoiceBreakdown, invoiceStats, type InvoiceMix } from "./breakdowns";
import { ParasutClient as ParasutScreen, type LinkCheck } from "./parasut-client";

export const metadata: Metadata = { title: "Paraşüt entegrasyonu" };
// Elle eşitleme bu sayfanın sunucu eylemiyle çalışır
export const maxDuration = 60;

/** Faturanın ayı (tarih YYYY-MM-DD metin) ve Paraşüt'teki karşılığı: gider faturası, gelen e-fatura (0/1) */
const invoiceMonth = sql<string>`substr(${s.invoices.date}, 1, 7)`;
const hasBill = sql<number>`(${s.invoices.externalId} is not null)::int`.mapWith(Number);
const hasEInvoice = sql<number>`(${s.invoices.eInvoiceId} is not null)::int`.mapWith(Number);

export default function ParasutPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader path="/panel/parasut" title="Paraşüt entegrasyonu" description="Paraşüt'teki faturalar her sabah gelir; fatura kalemlerini hammaddeye bağlayın." />
          <PageSkeleton rows={8} />
        </>
      }
    >
      <ParasutContent />
    </Suspense>
  );
}

async function ParasutContent() {
  await requireAdmin();
  const db = getDb();
  const [runs, rules, links, ingredients, unlinked, invoiceRows, cursorRow, pendingRow, [lineReads], ignored, newestLines, readState, returnsRow, negatives, settings, invoicesExist] = await Promise.all([
    db.select().from(s.parasutSyncRuns).orderBy(desc(s.parasutSyncRuns.startedAt)).limit(8),
    db.select().from(s.parasutCategoryRules).orderBy(asc(s.parasutCategoryRules.priority), asc(s.parasutCategoryRules.id)),
    db
      .select({
        id: s.parasutProductLinks.id,
        productKey: s.parasutProductLinks.productKey,
        productName: s.parasutProductLinks.productName,
        ingredientId: s.parasutProductLinks.ingredientId,
        ingredientName: s.ingredients.name,
        unit: s.ingredients.unit,
        factor: s.parasutProductLinks.factor,
        updatePrice: s.parasutProductLinks.updatePrice,
      })
      .from(s.parasutProductLinks)
      .innerJoin(s.ingredients, eq(s.ingredients.id, s.parasutProductLinks.ingredientId))
      .orderBy(asc(s.parasutProductLinks.productName)),
    db
      .select({
        id: s.ingredients.id,
        name: s.ingredients.name,
        unit: s.ingredients.unit,
        category: s.ingredients.category,
        packageDesc: s.ingredients.packageDesc,
        packagePrice: s.ingredients.packagePrice,
        packageSize: s.ingredients.packageSize,
      })
      .from(s.ingredients)
      .orderBy(asc(s.ingredients.name)),
    unlinkedProducts(40),
    // Paraşüt'e bağlı faturalar ay ve tür kırılımıyla: kartın sayısı da dökümü de bu satırlardan (breakdowns.ts)
    db
      .select({
        month: invoiceMonth,
        origin: s.invoices.origin,
        bill: hasBill,
        eInvoice: hasEInvoice,
        n: count(),
        last: max(s.invoices.syncedAt),
        review: sql<number>`count(*) filter (where ${s.invoices.needsReview})`.mapWith(Number),
      })
      .from(s.invoices)
      .where(eq(s.invoices.source, "parasut"))
      .groupBy(invoiceMonth, s.invoices.origin, hasBill, hasEInvoice),
    db.select().from(s.integrationState).where(eq(s.integrationState.key, "parasut.cursor")).limit(1),
    db.select().from(s.integrationState).where(eq(s.integrationState.key, "parasut.pendingEInvoices")).limit(1),
    // E-faturaya bağlı, gider faturası olmayan kayıtlar: kalemleri UBL belgesinden okunur
    db
      .select({
        read: sql<number>`count(*) filter (where ${s.invoices.ublReadAt} is not null)`.mapWith(Number),
        pending: sql<number>`count(*) filter (where ${s.invoices.ublReadAt} is null)`.mapWith(Number),
      })
      .from(s.invoices)
      .where(and(isNotNull(s.invoices.eInvoiceId), isNull(s.invoices.externalId))),
    ignoredProducts(),
    // Bağlı her ürünün en yeni kalemi: adındaki paket boyu bağlantının çarpanıyla tutuyor mu (Kontrol edilecek bağlantılar)
    db
      .selectDistinctOn([s.parasutBillLines.productKey], {
        productKey: s.parasutBillLines.productKey,
        name: s.parasutBillLines.productName,
        description: s.parasutBillLines.description,
        unit: s.parasutBillLines.unit,
        quantity: s.parasutBillLines.quantity,
      })
      .from(s.parasutBillLines)
      .innerJoin(s.invoices, eq(s.invoices.id, s.parasutBillLines.invoiceId))
      .innerJoin(s.parasutProductLinks, eq(s.parasutProductLinks.productKey, s.parasutBillLines.productKey))
      .orderBy(s.parasutBillLines.productKey, desc(s.invoices.date), desc(s.parasutBillLines.id)),
    invoiceReadingState(),
    // Panele girmeyen iadeler (docs/PARASUT.md §2a) ve elle girilmiş eksi faturalar (tedarikçiye iade girildi mi)
    db.select().from(s.integrationState).where(eq(s.integrationState.key, RETURNS_KEY)).limit(1),
    db
      .select({ date: s.invoices.date, supplier: s.invoices.supplier, payable: s.invoices.payable, supplierTaxNumber: s.invoices.supplierTaxNumber })
      .from(s.invoices)
      .where(lt(s.invoices.payable, 0)),
    // Bağlantı ayarları: alan alan panel, yoksa ortam değişkeni (client_secret'ın değeri ekrana gitmez)
    loadParasutSettings(),
    // Paraşüt'ten fatura geldiyse firma numarası panelden değiştirilemez
    hasParasutInvoices(),
  ]);
  const lineOf = new Map(newestLines.map((l) => [l.productKey, l]));
  // Adındaki ya da birimindeki paket boyu bağlantının çarpanından farklı olanlar: yalnız gösterilir, hiçbir şey değişmez
  const checks: LinkCheck[] = links.flatMap((l) => {
    const line = lineOf.get(l.productKey);
    const ev = line ? packEvidence(line, l.unit) : null;
    return line && ev && !sameFactor(ev.factor, l.factor) ? [{ linkId: l.id, lineUnit: line.unit, evidence: ev }] : [];
  });
  const returnLog = parseReturnLog(returnsRow[0]?.value);
  const invoiceMix: InvoiceMix[] = invoiceRows.map((r) => ({
    month: r.month,
    origin: r.origin,
    bill: Boolean(r.bill),
    eInvoice: Boolean(r.eInvoice),
    n: r.n,
    review: r.review,
    last: r.last ? new Date(r.last).toISOString() : null,
  }));
  const pending = pendingRow[0]?.value as { count: number; total?: number; ingested?: boolean; sample?: { from: string | null; date: string | null }[]; at: string } | undefined;
  const configured = missingSettings(settings.resolved).length === 0;
  // Paraşüt hesabı tarayıcıdan yetkilendirildi mi (belirteçlerin kendisi panele hiç gelmez)
  const connection = await parasutConnection(undefined, configured ? configFrom(settings.resolved) : null);
  // DevHub'a kaydedilecek dönüş adresi; PARASUT_REDIRECT_URI yanlış yazıldıysa ekran yine açılır
  let redirectUri: string | null = null;
  try {
    redirectUri = parasutRedirectUri();
  } catch {
    redirectUri = null;
  }

  return (
    <>
      {/* ⌘K "Fatura kalemini hammaddeye bağla" ve Hammaddeler'in bağlantıları (#urun-baglantilari) içerik akınca iner */}
      <HashScroll />
      <ParasutScreen
        configured={configured}
        connection={connection}
        redirectUri={redirectUri}
        settings={settingsView(settings.resolved, { secretUnreadable: settings.secretUnreadable, hasParasutInvoices: invoicesExist })}
        cronSet={Boolean(process.env.CRON_SECRET)}
        cursor={(cursorRow[0]?.value as { lastIssueDate?: string } | undefined)?.lastIssueDate ?? null}
        pendingEInvoices={pending ?? null}
        stats={invoiceStats(invoiceMix)}
        invoiceGroups={invoiceBreakdown(invoiceMix)}
        runs={runs.map((r) => ({ ...r, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null }))}
        rules={rules.map((r) => ({ id: r.id, matchType: r.matchType, pattern: r.pattern, category: r.category, priority: r.priority }))}
        links={links.map((l) => ({ ...l, line: lineOf.get(l.productKey) ?? null }))}
        checks={checks}
        readState={readState}
        ingredients={ingredients.map(({ packagePrice, packageSize, ...i }) => ({ ...i, unitCost: packageSize ? packagePrice / packageSize : 0 }))}
        unlinked={unlinked.items}
        unlinkedTotal={unlinked.total}
        ignored={ignored}
        lineReads={{ read: lineReads?.read ?? 0, pending: lineReads?.pending ?? 0 }}
        categories={INVOICE_CATEGORIES}
        returns={{
          sales: { count: returnLog.sales.length, total: returnLog.sales.reduce((a, e) => a + e.amount, 0) },
          // Faturalar'a eksi tutarla girilmiş tedarikçi iadesi listede kalmaz
          supplier: returnLog.supplier
            .filter((e) => !supplierReturnEntered(e, negatives))
            .map((e) => ({ id: e.id, date: e.date, amount: e.amount, invoiceNo: e.invoiceNo, supplier: e.supplier ?? "Tedarikçi" })),
        }}
      />
    </>
  );
}
