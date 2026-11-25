import { and, asc, count, desc, eq, isNotNull, isNull, lt, max, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";

import { HashScroll } from "@/components/panel/hash-scroll";
import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { Notice, NoticeLink } from "@/components/ui/notice";
import { ALL_BRANCHES, BRANCH_PARAM, tillBranches } from "@/lib/branches";
import { INVOICE_CATEGORIES } from "@/lib/constants";
import { parasutKey, type ParasutAccountInfo } from "@/lib/parasut/accounts";
import { missingSettings, settingsView } from "@/lib/parasut/settings";
import { packEvidence, sameFactor } from "@/lib/product-match";
import { requireAdmin } from "@/server/auth/dal";
import { currentBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";
import { unassignedInvoiceCount } from "@/server/data/invoice-branch";
import { invoiceReadingState } from "@/server/invoice-reading/read";
import { invoiceScopeWhere } from "@/server/invoice-scope";
import { aiMatchPage } from "@/server/parasut/ai-match";
import { invoiceAccountWhere, loadParasutAccounts, parasutAccountForScope } from "@/server/parasut/accounts";
import { parasutConnection } from "@/server/parasut/client";
import { configFrom, hasParasutInvoices, loadInvoiceScope, loadParasutSettings, parasutRedirectUri } from "@/server/parasut/config";
import { CURSOR_KEY, PENDING_KEY } from "@/server/parasut/keys";
import { parseReturnLog, RETURNS_KEY, supplierReturnEntered } from "@/server/parasut/returns";
import { ignoredProducts, ignoredSuppliers, unlinkedProducts } from "@/server/parasut/sync";

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

/**
 * Hangi Paraşüt hesabının gösterildiği (şube başına Paraşüt hesabı; docs/PARASUT.md): birden çok kasa açıkken çizilir.
 * Ekran seçili şubenin hesabını gösterir; "Tümü"de varsayılan şubeninkini ve öbür hesapları söyler. Kurallar ve ürün
 * bağlantıları bütün hesaplarda ortaktır
 */
function AccountNotice({
  account,
  accounts,
  all,
  scopeName,
}: {
  account: ParasutAccountInfo & { usersNames: string[] };
  accounts: ParasutAccountInfo[];
  all: boolean;
  scopeName: string | null;
}) {
  const others = accounts.filter((a) => a.id !== account.id && a.users.length);
  const shared = account.users.length > 1;
  const userNames = account.usersNames.join(" ve ");
  const title = all && others.length
    ? `Tümü seçili: ${account.name} şubesinin Paraşüt hesabı gösteriliyor`
    : shared
      ? `Paraşüt hesabı ortak: ${userNames}`
      : `${account.name} şubesinin kendi Paraşüt hesabı`;
  const text = all && others.length
    ? `${others.map((o) => o.name).join(", ")} ayrı Paraşüt hesabı kullanıyor; onun bağlantısı ve eşitlemesi için şube seçiciden şubeyi seçin. Kategori kuralları ve ürün bağlantıları bütün hesaplarda ortak.`
    : shared
      ? "Tek bağlantı, tek eşitleme; gelen fatura tedarikçinin varsayılan şubesini alır (yoksa “Şubesi seçilmemiş”). Şubeyi ayrı bir Paraşüt firmasına bağlamak için Şube ayarları'nda “aynı” seçimini kapatın."
      : `Bağlantı ve eşitleme yalnız ${account.name} için${scopeName && scopeName !== account.name ? ` (${scopeName} bu hesabı kullanıyor)` : ""}. Kategori kuralları ve ürün bağlantıları bütün hesaplarda ortak.`;
  // Bağlantı metnin sonunda: başlık, açıklama, eylem sırası telefonda da bozulmaz (düğme başlıkla metnin arasına düşüyordu)
  return (
    <Notice
      tone="neutral"
      size="sm"
      className="mb-4"
      title={title}
      text={
        <>
          {text} <NoticeLink href={`/panel/subeler/${encodeURIComponent(account.id)}#parasut`}>Şube ayarları</NoticeLink>
        </>
      }
    />
  );
}

async function ParasutContent() {
  await requireAdmin();
  const db = getDb();
  // Şube başına Paraşüt hesabı: seçili şubenin hesabı ("Tümü": varsayılan şubeninki); bağlantı, eşitleme geçmişi,
  // imleçler ve Paraşüt'ten gelen faturaların sayıları bu hesabın
  const [account, accounts, scope, branches] = await Promise.all([parasutAccountForScope(), loadParasutAccounts(), currentBranchScope(), listBranches()]);
  const mine = invoiceAccountWhere(account);
  const [runs, rules, links, ingredients, unlinked, invoiceRows, cursorRow, pendingRow, [lineReads], ignored, newestLines, readState, returnsRow, negatives, settings, invoicesExist, unassigned, supplierRules] = await Promise.all([
    db.select().from(s.parasutSyncRuns).where(eq(s.parasutSyncRuns.account, account)).orderBy(desc(s.parasutSyncRuns.startedAt)).limit(8),
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
    // Bekleyen ürünler: tek şube seçiliyken o şubenin ve işletme genelinin faturalarından (docs/SUBE.md › Faturanın şubesi)
    unlinkedProducts(40, scope),
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
      .where(and(eq(s.invoices.source, "parasut"), mine, invoiceScopeWhere(scope)))
      .groupBy(invoiceMonth, s.invoices.origin, hasBill, hasEInvoice),
    db.select().from(s.integrationState).where(eq(s.integrationState.key, parasutKey(CURSOR_KEY, account))).limit(1),
    db.select().from(s.integrationState).where(eq(s.integrationState.key, parasutKey(PENDING_KEY, account))).limit(1),
    // E-faturaya bağlı, gider faturası olmayan kayıtlar: kalemleri UBL belgesinden okunur
    db
      .select({
        read: sql<number>`count(*) filter (where ${s.invoices.ublReadAt} is not null)`.mapWith(Number),
        pending: sql<number>`count(*) filter (where ${s.invoices.ublReadAt} is null)`.mapWith(Number),
      })
      .from(s.invoices)
      .where(and(isNotNull(s.invoices.eInvoiceId), isNull(s.invoices.externalId), mine)),
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
    db.select().from(s.integrationState).where(eq(s.integrationState.key, parasutKey(RETURNS_KEY, account))).limit(1),
    db
      .select({ date: s.invoices.date, supplier: s.invoices.supplier, payable: s.invoices.payable, supplierTaxNumber: s.invoices.supplierTaxNumber })
      .from(s.invoices)
      .where(lt(s.invoices.payable, 0)),
    // Bağlantı ayarları: alan alan panel, yoksa (varsayılan hesapta) ortam değişkeni (client_secret'ın değeri ekrana gitmez)
    loadParasutSettings(account),
    // Paraşüt'ten fatura geldiyse firma numarası panelden değiştirilemez
    hasParasutInvoices(account),
    // Şubesi seçilmemiş faturalar (tek şubede görünmez; uyarı)
    unassignedInvoiceCount(db),
    // "Hep hammadde değil" kuralı açık tedarikçiler
    ignoredSuppliers(),
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
  const [connection, aiMatch, invoiceScope] = await Promise.all([
    // Paraşüt hesabı tarayıcıdan yetkilendirildi mi (belirteçlerin kendisi panele hiç gelmez)
    parasutConnection(undefined, configured ? configFrom(settings.resolved, account) : null, account),
    // "AI ile öner": düğmenin durumu ve saklı öneriler (sayfa açılınca servise istek gitmez; docs/PARASUT.md § 5e)
    aiMatchPage(unlinked.items, links),
    loadInvoiceScope(account),
  ]);
  // Birden çok kasa açıkken hangi hesabın gösterildiği ve faturaların şubesi seçimi (tek kasada ikisi de çizilmez)
  const many = tillBranches(branches).length > 1;
  const info = accounts.find((a) => a.id === account) ?? { id: account, name: account, users: [] };
  const nameOf = (id: string) => branches.find((b) => b.id === id)?.name ?? id;
  const accountView = many ? { ...info, usersNames: info.users.map(nameOf) } : null;
  const scopeName = scope === ALL_BRANCHES ? null : nameOf(scope);
  // Ayrı hesabın (yalnız sahibi şube kullanıyor) faturalarının şubesi: Bağlantı kartındaki seçim
  const ownAccount = many && info.users.length === 1 && info.users[0] === info.id;
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
        // Birden çok kasa açıkken: gösterilen Paraşüt hesabı (şube başına hesap)
        scopeNotice={
          accountView ? (
            <>
              <AccountNotice account={accountView} accounts={accounts} all={scope === ALL_BRANCHES} scopeName={scopeName} />
              {unassigned.count ? (
                <Notice
                  tone="warn"
                  size="sm"
                  className="mb-4"
                  title={`${unassigned.count} faturanın şubesi seçilmemiş`}
                  text={
                    <>
                      {scopeName
                        ? `${scopeName} seçiliyken sayılara ve bekleyen ürünlere girmezler. `
                        : "Tek şube seçiliyken görünmezler. "}
                      <NoticeLink href={`/panel/faturalar?${BRANCH_PARAM}=${ALL_BRANCHES}#subesiz`}>Şubelerini seçin</NoticeLink>
                    </>
                  }
                />
              ) : null}
            </>
          ) : null
        }
        account={account}
        accountName={many ? info.name : null}
        // Seçili şube hesabı başka şubeden kullanıyor ("Tuzla ile aynı"): bağlantı kartı salt okunur, düzenleme sahibinde
        linkedFrom={
          many && scope !== ALL_BRANCHES && scope !== account
            ? { branchName: nameOf(scope), ownerName: info.name, href: `/panel/parasut?${BRANCH_PARAM}=${encodeURIComponent(account)}` }
            : null
        }
        invoiceScope={ownAccount ? { value: invoiceScope, branchName: info.name } : null}
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
        aiMatch={aiMatch}
        ignored={ignored}
        supplierRules={supplierRules}
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
