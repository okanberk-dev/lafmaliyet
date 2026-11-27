import "server-only";

import { and, asc, eq, gte, inArray, or } from "drizzle-orm";

import { channelNameResolver } from "@/app/panel/tedarikciler/logic";
import { CALENDAR_GROUP } from "@/lib/branch-settings/groups";
import { ALL_BRANCHES, branchPnlEntry, DEFAULT_BRANCH_ID, DEFAULT_POS_RATE, monthWriteLock, type BranchScope } from "@/lib/branches";
import { activeFromRange, createModel, currentMonthTR, type ModelOptions } from "@/lib/calc/engine";
import { defaultMonthOf } from "@/lib/calc/insights";
import type { Dataset, SalesLine, Settings } from "@/lib/calc/types";
import { isReportRow, resolveBranchMonths, resolveMonths, tillMonths, tillOpenedOn, type MonthEntry, type TillRow } from "@/lib/cash-month";
import { businessDate } from "@/lib/cash-report";
import { closedDaysIn, closedRowApplies } from "@/lib/closed-days";
import { countedRecords, redateLots } from "@/lib/closed-period";
import { channelOf } from "@/lib/commission/channels";
import { COMMISSION_CATEGORY, settingsFromRows } from "@/lib/constants";
import { settingsAt } from "@/lib/month-settings";
import { modposZBetween, otherBranchLists, type OtherBranchList } from "@/lib/asilpos/sales";
import type { AsilposWorked } from "@/lib/asilpos/personel";
import { countedTillIds, earliestSwitchDay, scopeSwitchDay, scopeSwitchDays, type SwitchDays } from "@/lib/pos/tills";
import { addDays } from "@/lib/reminders";
import { readCoverage, SALES_COVERAGE_BRANCH_KEY, SALES_COVERAGE_KEY } from "@/lib/sales-coverage";
import type { SiteSalesMonth } from "@/lib/site-sales/schema";
import { branchWhere, branchWhereWithShared, currentBranchScope, currentWriteBranch, withBranchScope } from "@/server/branch-scope";
import { invoiceAccountDates, loadClosedPeriods } from "@/server/closed-period";
import { invoiceScopeWhere } from "@/server/invoice-scope";
import { loadSplitLines } from "./invoice-split";
import { resolveBranchSetting } from "@/server/branch-settings";
import { listBranches } from "@/server/branches";
import { getDb, schema as s, type DB } from "@/server/db";
import { loadPosTills, loadSwitchDays } from "@/server/pos/tills";
import { loadSettingVersions } from "@/server/setting-versions";
import { loadSiteSales } from "@/server/site-sales/sync";

import { tillRows } from "./cash-reports";
import { loadAsilposIkram } from "./asilpos-ikram";
import { mergeWithAsilpos } from "./asilpos-sales";
import { loadHeldPurchases, loadPurchaseLots } from "./purchase-lots";

/**
 * Sürümsüz (taban) ayarlar. Kaydı olmayan ayar varsayılanı okur (settingsFromRows): yeni bir ayar için veri taşıması gerekmez. Şube başına
 * tutulan iki alan şube ayarından gelir (docs/SUBE.md › Şube başına ayarlar): AsilPOS'a geçiş günü kasaların en erkeni
 * (çok şube; grup SUBE_AYAR_GRUBU, her kasanın kendi günü: veri kümesi görünümün kasasınınkini koyar), ayda açık gün
 * varsayılan şubenin (grup isletme.takvim; veri kümesi seçili şubeninkini koyar)
 */
export async function loadBaseSettings(db: DB = getDb()): Promise<Settings> {
  const [rows, switchDays, calendar] = await Promise.all([db.select().from(s.settings), loadSwitchDays(db), resolveBranchSetting(CALENDAR_GROUP, DEFAULT_BRANCH_ID, db)]);
  return { ...settingsFromRows(rows), asilposGecisGunu: earliestSwitchDay(switchDays), acikGun: calendar.value.openDays };
}

/**
 * Bir ayın ayarları (verilmezse bu ay, Türkiye saati): ay bazlı anahtarlar (KDV, komisyon, SGK, yemek kartı …) o ayda
 * geçerli sürümden (docs/AYARLAR.md, src/lib/month-settings.ts), ötekiler tabandan (loadBaseSettings)
 */
export async function loadSettings(month?: string): Promise<Settings> {
  const db = getDb();
  const [base, versions] = await Promise.all([loadBaseSettings(db), loadSettingVersions(db)]);
  return settingsAt(base, versions, month ?? currentMonthTR());
}

/** Veri kümesinin şube kapsamı: verilmezse seçicinin seçimi (docs/SUBE.md › Seçici) */
export interface DatasetOptions {
  /**
   * "hepsi" seçiciden bağımsız işletme geneli okur (vergi, ödemeler ve nakit planı, tutarlılık: para ve beyan
   * işletmenindir); bir şube kimliği o şubeyi okur (stok sayımı yazdığı şubeyi gösterir)
   */
  scope?: BranchScope;
}

/**
 * Hesaplama motorunun ihtiyaç duyduğu bütün veriyi tek seferde, paralel okur. Şube seçiliyken (ya da `scope` bir
 * şubeyse) ciro, kasa, satış, personel, sayım, zayi o şubenin; gider ve sabit gider şubenin + işletme genelinin
 * (docs/SUBE.md › Neyi süzer); fatura şubenin + işletme genelinin (şubesi seçilmemiş fatura yalnız "Tümü"de; docs/SUBE.md ›
 * Faturanın şubesi). Menü, reçete ve hammadde ortak: hiç süzülmez.
 */
export async function loadDataset(opts: DatasetOptions = {}): Promise<Dataset> {
  return opts.scope === undefined ? readDataset() : withBranchScope(opts.scope, readDataset);
}

async function readDataset(): Promise<Dataset> {
  const db = getDb();
  // Satışlar'ın içe aktarmasının yazdığı şube (seçili şube, "Tümü"de Tuzla): kartın listesinin son günü (writeCoverage)
  const [scope, branches, writeBranch, posTills] = await Promise.all([currentBranchScope(), listBranches(), currentWriteBranch(), loadPosTills(db)]);
  const branch = scope === ALL_BRANCHES ? null : (branches.find((b) => b.id === scope) ?? null);
  const [
    storedSettings,
    settingVersions,
    ingredients,
    categories,
    products,
    recipeItems,
    months,
    salesLines,
    rawInvoices,
    supplierCards,
    staff,
    staffVersions,
    fixedExpenses,
    fixedExpenseVersions,
    pnlEntries,
    stockCounts,
    ingredientPrices,
    rawLots,
    heldPurchases,
    pendingPriceHolds,
    stockExtras,
    purchaseQuantities,
    expenseCategories,
    expenseEntries,
    wasteEntries,
    shiftDays,
    siteSales,
    coverageRows,
    till,
    lateWaiting,
    closedRows,
    calendar,
    periods,
  ] = await Promise.all([
    loadBaseSettings(db),
    // Ay bazlı ayarların sürümleri (docs/AYARLAR.md): motor her ayı kendi ayarıyla hesaplar
    loadSettingVersions(db),
    db.select().from(s.ingredients).orderBy(asc(s.ingredients.sortOrder), asc(s.ingredients.id)),
    db.select().from(s.categories).orderBy(asc(s.categories.sortOrder)),
    db.select().from(s.products).orderBy(asc(s.products.sortOrder), asc(s.products.id)),
    db.select().from(s.recipeItems).orderBy(asc(s.recipeItems.sortOrder), asc(s.recipeItems.id)),
    db.select().from(s.months).where(branchWhere(s.months.branchId, scope)).orderBy(asc(s.months.month)),
    db.select().from(s.salesLines).where(branchWhere(s.salesLines.branchId, scope)).orderBy(asc(s.salesLines.sortOrder), asc(s.salesLines.id)),
    // Faturanın şubesi (docs/SUBE.md › Faturanın şubesi): tek şube seçiliyken o şubenin ve bilinçli işletme geneli
    // faturalar; öbür şubenin ve şubesi seçilmemiş faturalar okunmaz. Vergi ve Nakit "Tümü"yle okur
    db.select().from(s.invoices).where(invoiceScopeWhere(scope)).orderBy(asc(s.invoices.date), asc(s.invoices.id)),
    // Tedarikçi kartlarının adları ve vergi no: komisyon faturasının kanalı Komisyon & hakediş'teki gibi bulunur
    db.select({ id: s.suppliers.id, name: s.suppliers.name, aliases: s.suppliers.aliases, taxNumber: s.suppliers.taxNumber }).from(s.suppliers),
    db.select().from(s.staff).where(branchWhere(s.staff.branchId, scope)).orderBy(asc(s.staff.sortOrder), asc(s.staff.id)),
    db.select().from(s.staffVersions).orderBy(asc(s.staffVersions.staffId), asc(s.staffVersions.fromMonth)),
    db.select().from(s.fixedExpenses).orderBy(asc(s.fixedExpenses.sortOrder), asc(s.fixedExpenses.id)),
    db.select().from(s.fixedExpenseVersions).orderBy(asc(s.fixedExpenseVersions.fixedExpenseId), asc(s.fixedExpenseVersions.fromMonth)),
    db.select().from(s.pnlEntries),
    db.select().from(s.stockCounts).where(branchWhere(s.stockCounts.branchId, scope)),
    // Sayımlar ay sonunda geçerli fiyatla değerlenir (engine.ts stockSheet)
    db
      .select({
        ingredientId: s.ingredientPrices.ingredientId,
        packagePrice: s.ingredientPrices.packagePrice,
        packageSize: s.ingredientPrices.packageSize,
        changedAt: s.ingredientPrices.changedAt,
      })
      .from(s.ingredientPrices)
      .orderBy(asc(s.ingredientPrices.changedAt), asc(s.ingredientPrices.id)),
    // Stok değerleme (FIFO) partileri: Paraşüt faturalarının hammaddeye bağlı kalemleri (purchase-lots.ts)
    loadPurchaseLots(),
    // Çarpanı onay bekleyen alışlar: alınan miktara girmedi, Tutarlılık işaretler (aynı yüklem)
    loadHeldPurchases(),
    // Fiyatı onay bekleyen hammaddeler: fiyatsızsa "paket fiyatını girin" değil, onaya götürülür (Genel bakış, zil)
    db.selectDistinct({ id: s.ingredientPriceHolds.ingredientId }).from(s.ingredientPriceHolds).where(eq(s.ingredientPriceHolds.status, "pending")),
    // "Listede olmayanlar" sayım gibi şube başına (21 Kasım denetimi #19/#24): "Tümü"de bütün şubelerinki toplanır
    db.select().from(s.stockExtras).where(branchWhere(s.stockExtras.branchId, scope)).orderBy(asc(s.stockExtras.id)),
    db.select().from(s.purchaseQuantities),
    db.select().from(s.expenseCategories).orderBy(asc(s.expenseCategories.sortOrder), asc(s.expenseCategories.id)),
    // Kasadan çıkan satırın belgesi (fiş / e-Arşiv / fatura / yok) vergide kaydın belgesidir (docs/VERGI.md)
    db
      .select({ entry: s.expenseEntries, docType: s.cashOuts.docType })
      .from(s.expenseEntries)
      .leftJoin(s.cashOuts, eq(s.cashOuts.id, s.expenseEntries.cashOutId))
      // Şubenin giderleri ve işletme geneli giderler (şubesi boş): kira, muhasebe, abonelik her şubede görünür
      .where(branchWhereWithShared(s.expenseEntries.branchId, scope))
      .orderBy(asc(s.expenseEntries.date), asc(s.expenseEntries.id)),
    db
      .select({
        date: s.wasteEntries.date,
        kind: s.wasteEntries.kind,
        productId: s.wasteEntries.productId,
        ingredientId: s.wasteEntries.ingredientId,
        qty: s.wasteEntries.qty,
        factor: s.wasteEntries.factor,
        // AsilPOS günü yalnız AsilPOS'un şubesinin panel ikramını düşürür (panelWasteCounts)
        branchId: s.wasteEntries.branchId,
      })
      .from(s.wasteEntries)
      .where(branchWhere(s.wasteEntries.branchId, scope)),
    // Vardiya'nın çalışma günleri (Faz 5): part-time kişinin çağrıldığı gün (şubenin; "Tümü"de bütün şubelerin)
    db
      .select({ branchId: s.shifts.branchId, personRef: s.shifts.personRef, date: s.shifts.date })
      .from(s.shifts)
      .where(and(eq(s.shifts.kind, "work"), branchWhere(s.shifts.branchId, scope))),
    // laffogato.net online satışları (ay başına kayıt; docs/SITE-SATIS.md): işletmenin cirosu, şubelerin değil. "Tümü"de
    // ve online kanal seçiliyken okunur; fiziksel şube seçiliyken yok
    scope === ALL_BRANCHES || branch?.kind === "online" ? loadSiteSales() : Promise.resolve([]),
    // Süren ayda yüklenen satış listesinin son günü (src/lib/sales-coverage.ts): ayın ortak kaydı ve şube şube kayıt
    db
      .select({ key: s.integrationState.key, value: s.integrationState.value })
      .from(s.integrationState)
      .where(inArray(s.integrationState.key, [SALES_COVERAGE_KEY, SALES_COVERAGE_BRANCH_KEY])),
    // Kasa raporlarının ay bilgisine giden sütunları (src/lib/cash-month.ts)
    tillRows(),
    // Personelin onay bekleyen geç kasa raporlarının günleri: ay bilgisinde eksik sayılmaya devam eder, "onay bekliyor"
    db
      .selectDistinct({ day: s.staffRequests.day })
      .from(s.staffRequests)
      .where(and(eq(s.staffRequests.kind, "kasa-gec"), eq(s.staffRequests.status, "pending"))),
    // Kapalı işaretli günler (özel günlerin `kapali` satırı): ay bilgisinde eksik sayılmaz, ayrı yazılır
    // Şubesiyle (boş = işletme geneli): şubenin ayında yalnız kendi kapalı günleri ve işletme geneli sayılır (KP-05)
    db
      .select({ kind: s.specialDays.kind, dateFrom: s.specialDays.dateFrom, dateTo: s.specialDays.dateTo, branchId: s.specialDays.branchId })
      .from(s.specialDays)
      .where(eq(s.specialDays.kind, "kapali")),
    // Çalışma takvimi seçili şubenin (şube ayarı isletme.takvim; "Tümü"de ve online kanalda varsayılan şubenin)
    resolveBranchSetting(CALENDAR_GROUP, scope, db),
    // Kapalı dönemler (docs/DONEM-KAPANISI.md): kapanıştan sonra kapalı aya düşen fatura ve harcama hiçbir hesaba girmez,
    // açık aya alınan kararın gününde sayılır; FIFO partileri de faturanın hesap gününe göre
    loadClosedPeriods(db).then(async (p) => ({ p, lotDates: await invoiceAccountDates(db, p) })),
  ]);
  const invoices = countedRecords(rawInvoices, periods.p);
  const purchaseLots = redateLots(rawLots, periods.lotDates);

  // AsilPOS'a geçiş günleri görünümün kasalarınınki (çok şube, 27 Kasım 2026; denetim 21 Kasım #5): kasası ModPOS olan
  // şube (Tuzla) ya da online kanal seçiliyken yok (AsilPOS hiç okunmaz, ekranlar ModPOS der); kasası AsilPOS olan şube
  // seçiliyken yalnız onunki; "Tümü"de her kasa kendi geçiş günüyle (para hesapları şube şube: R1, R2). Settings'in tek
  // geçiş günü metinler içindir: tek şubede o şubenin, "Tümü"de kasaların en erkeni. Veri kümesini okuyan her ekran
  // (Satışlar, Genel bakış, Gelir-gider, Ürünler, Analiz, Zayi) bunu görür
  const allSwitchDays = posTills.switchDays;
  const viewSwitchDays: SwitchDays = scopeSwitchDays(allSwitchDays, scope);
  // Ayda açık gün seçili şubenin (şube ayarı isletme.takvim; "Tümü"de ve online kanalda varsayılan şubenin). Taban
  // ayarlar sürümsüz; veri kümesinin `settings`'i bu ayınkiler (ay bazlı anahtarlar bu ayda geçerli sürümden,
  // src/lib/month-settings.ts), `settingsBase` bu
  const settings = { ...storedSettings, asilposGecisGunu: scopeSwitchDay(allSwitchDays, scope), acikGun: calendar.value.openDays };
  // Kalem kalem sınıflandırma (src/lib/invoice-split.ts): payı faturanın kategorisinden ayrılan kalemler
  const splitOf = await loadSplitLines(db, invoices);
  // Okumalardan sonra: "bu ay" Türkiye saatine göre (aktiflik ve listelerdeki güncel tutar buna bakar)
  const currentMonth = currentMonthTR();
  // Sabit giderler küçük tablo: hepsi okunur, şubeninkiler ve işletme genelinkiler burada ayrılır (silinmiş ya da
  // başka şubenin kaleminin elle girilmiş hücresi de buna göre ayıklanır: branchPnlEntry)
  const fixedInScope = fixedExpenses.filter((f) => branch === null || f.branchId === null || f.branchId === branch.id);
  const fixedIds = new Set(fixedInScope.map((f) => f.id));
  const allFixedIds = new Set(fixedExpenses.map((f) => f.id));
  const pnlInScope = branch === null ? pnlEntries : pnlEntries.filter((e) => branchPnlEntry(e.rowKey, fixedIds, allFixedIds));
  // Adı bir kanala bağlanmayan Komisyon faturası: kanal tedarikçi kartının adları ve diğer adlarıyla da aranır (ekranın
  // kuralı, vergi no öteki faturalar üzerinden de; Gelir-gider'in POS komisyonu uyarısı, denetim B16)
  const channelNamesOf = invoices.some((i) => i.category === COMMISSION_CATEGORY && !channelOf([i.supplier]))
    ? channelNameResolver(
        supplierCards.map((c) => ({ ...c, aliases: Array.isArray(c.aliases) ? c.aliases.filter((a): a is string => typeof a === "string") : [] })),
        invoices.map((i) => ({ supplier: i.supplier, supplierTaxNumber: i.supplierTaxNumber })),
      )
    : null;
  // Kasa raporlarının eksik günleri düne kadar aranır (bugünün raporu akşam girilir); saat de okumalardan sonra
  const today = businessDate();
  const through = addDays(today, -1);
  // Yalnız kasa raporları: yedek ay satırları (AsilPOS G6, ModPOS föyü) rapor değildir
  const reportRows = till.filter(isReportRow);
  // Listelerin son günü (src/lib/sales-coverage.ts readCoverage): şube seçiliyken şubenin kendi kaydı (Tuzla'nın listesi
  // Marina'nın son gününü kaydırmaz), "Tümü"de ayın ortak kaydı. AsilPOS'un sayıldığı ilk gün ve geçiş ayının çakışması her
  // görünümde kasanın şubesinin kendi kaydından (tillCoverage). Satışlar'ın içe aktarma kartının "… tarihine kadar"ı yazılan
  // şubenin kaydından (writeCoverage; "Tümü"de Tuzla'nın)
  const storedCoverage = (key: string) => coverageRows.find((r) => r.key === key)?.value;
  const coverageOf = (branchId: string | null) => readCoverage(storedCoverage(SALES_COVERAGE_KEY), storedCoverage(SALES_COVERAGE_BRANCH_KEY), branchId);
  const coverage = coverageOf(scope === ALL_BRANCHES ? null : scope);
  const tillCoverage = (branchId: string) => coverageOf(branchId);
  // SU GİDERİ girilmiş aylar: tek şube seçiliyken litre fiyatı bu ayların işletme geneli satışıyla (waterSales)
  const billMonths = new Set(pnlEntries.filter((e) => e.rowKey === "manual:su" && e.amount > 0).map((e) => e.month));
  // Satış satırları AsilPOS'la birleşir (mergeSales). AsilPOS'un ikramları geçiş gününden itibaren kayıtlı tüketime
  // (src/lib/asilpos/ikram.ts); geçiş günü yoksa okunmaz
  // "Tümü"de ayın dönemi şubelerin en kısa listesiyle (bulgu 62): ModPOS'ta kalan şubelerin (Tuzla) listesi ve kasa
  // raporu olan ayları, şubenin kendi kaydıyla. Şube seçiliyken yok (görünümün kendi kaydı)
  const others =
    scope === ALL_BRANCHES
      ? otherBranchLists({ switchDays: viewSwitchDays, salesLines, reportDays: reportRows, coverageOf: (b) => coverageOf(b) })
      : [];
  const [sales, asilposIkram, waterSales, asilposWorked] = await Promise.all([
    mergeSales(db, { switchDays: viewSwitchDays, salesLines: salesLines.map(salesLineOf), coverage, coverageOf: tillCoverage, today, till, others }),
    settings.asilposGecisGunu ? loadAsilposIkram(db, viewSwitchDays) : Promise.resolve(null),
    branch && billMonths.size
      ? // Su litresi "Tümü" kapsamında: bütün kasalar kendi geçiş günleriyle (her şubenin AsilPOS satışı da sayılsın)
        companyWaterSales(db, { switchDays: allSwitchDays, coverage: coverageOf(null), coverageOf: tillCoverage, today, months: billMonths, siteSales: branch.kind === "online" ? siteSales : null })
      : Promise.resolve(null),
    // Personel bağlantısı (LM-4b): görünümün kasalarının sayılan günlerinin çalışan kimlikleri (yemek kartının günü);
    // görünümde kasa yoksa okunmaz
    settings.asilposGecisGunu ? loadAsilposWorked(db, viewSwitchDays) : Promise.resolve(null),
  ]);
  // Satış listesinin son gününe kadarki kasa raporları (aynı ilk rapor günüyle: ay ortasında başlayan ilk ay aynı tanınır).
  // Eksik gün, ay bilgisindeki gibi ilk kasa raporundan (ya da AsilPOS gün sonundan) aranır: raporlar başlamadan önceki
  // ModPOS föy günleri eksik değildir (docs/MODPOS-API.md › Ay rakamına yedek); ModPOS satırı yokken ikisi aynı gün
  const firstEver = till.reduce<string | null>((a, r) => (a === null || r.date < a ? r.date : a), null);
  const firstReport = till.filter((r) => r.source !== "modpos").reduce<string | null>((a, r) => (a === null || r.date < a ? r.date : a), null);
  // Şube görünümünde şubenin açılışı: sonradan açılan şubenin ilk ayı "kasa raporları ay ortasında başladı" sayılmaz
  // (src/lib/cash-month.ts tillOpenedOn; Tuzla ve "Tümü" bugünkü kural)
  const opened = tillOpenedOn(branch);
  // AsilPOS satışlarının sayıldığı ilk gün: o günden itibaren AsilPOS'un şubesinin indirimi satırlarda zaten düşülmüş
  // (TillMonth.asilposDiscounts; satış listesi ↔ POS karşılaştırması, engine listDiscounts)
  const posFroms = { froms: sales.asilposSales?.froms ?? null, tills: posTills.ids };
  const salesCoverage = Object.entries(sales.coverage).map(([month, upto]) => ({
    month,
    through: upto,
    till: tillMonths(till.filter((r) => r.date.slice(0, 7) === month && r.date <= upto), upto, firstEver, undefined, undefined, firstReport, undefined, opened, posFroms)[0] ?? null,
  }));

  // Etkin ay bilgisi: elle yazılan, yoksa kasa raporlarından (hiçbir şey months'a kopyalanmaz); yalnız kasa raporu olan
  // ay da gelir. Kaynaklar (sources) ve kasanın değerleri (kasa) ekranlar için Month'ta taşınır. Eksik günler onay
  // bekleyen geç raporları ve kapalı işaretli günleri ayrı söyler
  const lateDays = lateWaiting.flatMap((r) => (r.day ? [r.day] : []));
  // Kapalı gün şubenin (docs/SUBE.md › Kapalı gün): şube görünümünde ve "Tümü"nün şube şube çözümünde yalnız o şubenin
  // ve işletme genelinin kapalı günleri (Tuzla'nın kapalı günü Marina'nın eksik gününü "kapalı" yapmaz); birleşik
  // satırlarda (bütün şubeler) herhangi bir şubenin işareti, raporlu gün hariç
  const scopeClosedRows = closedRows.filter((r) => closedRowApplies(r, branch?.id));
  const closedFor = (rows: typeof closedRows, reports: readonly TillRow[]) => closedDaysIn(rows, "2000-01-01", through, reports.filter(isReportRow).map((r) => r.date));
  const closedPast = closedFor(scopeClosedRows, reportRows);
  const monthsOf = (rows: TillRow[], openedOn: ReturnType<typeof tillOpenedOn>, closed: string[] = closedPast) =>
    tillMonths(rows, through, undefined, lateDays, closed, undefined, undefined, openedOn, posFroms);
  const entriesOf = (rows: typeof months): MonthEntry[] =>
    rows.map((m) => ({ month: m.month, openDays: m.openDays, posRevenue: m.posRevenue, discounts: m.discounts, offRevenue: m.offRevenue, cardShare: m.cardShare, note: m.note }));
  // "Tümü": her şube kendi elle yazılanı ve kasasıyla (açılış günüyle: tillOpenedOn) çözülür, sonra toplanır; bir şubenin
  // elle yazdığı öteki şubenin kasa cirosunu ezmez, açık gün günde bir kez (denetim 13 Kasım HM-01, HM-02). Bütün
  // satırların ayı kasa bilgisi olarak taşınır (açılış günü en eski satırın şubesinin; Tuzla ise bugünkü kural); açık
  // günü kasadan gelen şubelerin günleri yalnız o şubelerin satırlarıyla birleşir
  const openedOfFirst = (rows: readonly TillRow[]) => {
    const first = rows.reduce<TillRow | null>((a, r) => (a === null || r.date < a.date ? r : a), null);
    return first?.branchId ? tillOpenedOn(branches.find((b) => b.id === first.branchId)) : null;
  };
  /** "Tümü"nün ay bilgisi: şubeler kendi elle yazdığı ve kasasıyla çözülür, sonra toplanır (yukarıdaki kural) */
  const allBranchMonths = (ms: typeof months, rowsAll: TillRow[], closedAll: string[]) => {
    const rowsOf = (ids: readonly string[]) => rowsAll.filter((r) => r.branchId !== undefined && ids.includes(r.branchId));
    const branchIds = [...new Set([...ms.map((m) => m.branchId), ...rowsAll.flatMap((r) => (r.branchId ? [r.branchId] : []))])];
    return resolveBranchMonths(
      branchIds.map((id) => ({
        branchId: id,
        entries: entriesOf(ms.filter((m) => m.branchId === id)),
        tills: monthsOf(
          rowsOf([id]),
          tillOpenedOn(branches.find((b) => b.id === id)),
          closedFor(closedRows.filter((r) => closedRowApplies(r, id)), rowsOf([id])),
        ),
      })),
      monthsOf(rowsAll, openedOfFirst(rowsAll), closedAll),
      (ids) => {
        const rows = rowsOf(ids);
        return monthsOf(rows, openedOfFirst(rows), closedAll);
      },
    );
  };
  const monthInfo = branch !== null ? resolveMonths(entriesOf(months), monthsOf(till, opened)) : allBranchMonths(months, till, closedPast);
  // Şube seçiliyken "Tümü"nün ay bilgisi (Faz 5, sahibin kararı 4): işletme geneli giderler işletmenin günüyle
  // oranlanır, "İşletme geneli payı (bilgi)" satırı Tümü'nün saydığı tutarı gösterir (engine.ts companyDays)
  const companyMonths =
    branch === null
      ? null
      : await withBranchScope(ALL_BRANCHES, async () => {
          const [allMonths, allTill] = await Promise.all([db.select().from(s.months).orderBy(asc(s.months.month)), tillRows()]);
          return allBranchMonths(allMonths, allTill, closedFor(closedRows, allTill));
        });

  return {
    settings: settingsAt(settings, settingVersions, currentMonth),
    settingsBase: settings,
    settingVersions,
    posTills: posTills.ids,
    posSwitchDays: allSwitchDays,
    currentMonth,
    branchView: branch ? { id: branch.id, name: branch.name, kind: branch.kind } : null,
    // Ay hücreleri yazılmaz: "Tümü"de birden çok kasanın toplamı, online kanalda kasa satışı yok (monthWriteLock)
    monthTotalsLocked: monthWriteLock(scope, branches) !== null,
    monthLockText: monthWriteLock(scope, branches),
    ...(waterSales ? { waterSales } : {}),
    salesCoverage,
    ...(Object.keys(sales.short).length
      ? {
          commonLists: Object.entries(sales.short).map(([month, x]) => ({ month, branch: branches.find((b) => b.id === x.branchId)?.name ?? x.branchId, through: x.through })),
        }
      : {}),
    writeCoverage: coverageOf(writeBranch),
    ingredients: ingredients.map((i) => ({
      id: i.id,
      name: i.name,
      category: i.category,
      supplier: i.supplier,
      packageDesc: i.packageDesc,
      packagePrice: i.packagePrice,
      packageSize: i.packageSize,
      unit: i.unit,
      vatRate: i.vatRate,
      note: i.note,
      isEstimate: i.isEstimate,
      priceSource: i.priceSource,
      countUnit: i.countUnit,
      countGroup: i.countGroup,
      countFrom: i.countFrom,
      sortOrder: i.sortOrder,
      active: i.active,
    })),
    categories,
    products: products.map((p) => ({
      id: p.id,
      categoryId: p.categoryId,
      name: p.name,
      size: p.size,
      price: p.price,
      fireOverride: p.fireOverride,
      note: p.note,
      active: p.active,
      showOnMenu: p.showOnMenu,
      sortOrder: p.sortOrder,
      siteMenuId: p.siteMenuId,
      siteMenuSlot: p.siteMenuSlot,
    })),
    recipeItems,
    months: monthInfo,
    ...(companyMonths ? { companyMonths } : {}),
    salesLines: sales.salesLines,
    ...(sales.asilposSales ? { asilposSales: sales.asilposSales } : {}),
    ...(asilposIkram ? { asilposIkram } : {}),
    ...(asilposWorked ? { asilposWorked } : {}),
    // Kapalı işaretli bütün günler (ileri tarihliler dahil): süren ayın ay sonu öngörüsü bunları açık saymaz (E-41).
    // Raporlu gün ve satışlı yedek satır (AsilPOS gün sonu, ModPOS föyü) kapalı sayılmaz (tillMonths ile aynı kural)
    // Şubelerin banka POS oranı (Şubeler): banka POS komisyonu şube şube kart × oran (engine.ts posCommission)
    branchRates: branches.filter((b) => b.kind === "fiziksel").map((b) => ({ id: b.id, name: b.name, posRate: b.posRate ?? DEFAULT_POS_RATE })),
    closedDays: closedDaysIn(
      scopeClosedRows,
      "2000-01-01",
      "9999-12-31",
      till.filter((r) => isReportRow(r) || r.zTotal > 0 || (r.receipts ?? 0) > 0).map((r) => r.date),
    ),
    invoices: invoices.map((i) => ({
      id: i.id,
      date: i.date,
      supplier: i.supplier,
      description: i.description,
      invoiceNo: i.invoiceNo,
      category: i.category,
      amount: i.amount,
      discount: i.discount,
      payable: i.payable,
      vat: i.vat,
      unpaid: i.unpaid,
      note: i.note,
      source: i.source,
      externalId: i.externalId,
      dueDate: i.dueDate,
      outstanding: i.outstanding,
      allocated: i.allocated,
      ledgerBase: i.ledgerBase,
      paidByLedger: i.paidByLedger,
      eInvoiceId: i.eInvoiceId,
      needsReview: i.needsReview,
      paidAt: i.paidAt,
      paymentRequestedAt: i.paymentRequestedAt,
      taxNotAsset: i.taxNotAsset,
      supplierTaxNumber: i.supplierTaxNumber,
      eInvoiceUuid: i.eInvoiceUuid,
      branchId: i.branchId,
      companyWide: i.companyWide,
      ...(splitOf.has(i.id) ? { lines: splitOf.get(i.id) } : {}),
      ...(channelNamesOf && i.category === COMMISSION_CATEGORY && !channelOf([i.supplier]) ? { channelNames: channelNamesOf(i.supplier, i.supplierTaxNumber) } : {}),
    })),
    // netSalary / extras ve period / amount taban değerlerdir (ilk sürümden önceki aylar).
    // active sütuna değil aralığa göre hesaplanır: ay değişince kendiliğinden doğru olur.
    staff: staff.map((x) => ({
      id: x.id,
      name: x.name,
      netSalary: x.netSalary,
      extras: x.extras,
      mealCard: x.mealCard,
      kind: x.kind,
      dailyWage: x.dailyWage,
      userId: x.userId,
      personRef: x.personRef,
      active: activeFromRange(x.endMonth, currentMonth),
      startMonth: x.startMonth,
      endMonth: x.endMonth,
      branchId: x.branchId,
    })),
    shifts: shiftDays,
    staffVersions: staffVersions.map((v) => ({ id: v.id, staffId: v.staffId, fromMonth: v.fromMonth, netSalary: v.netSalary, extras: v.extras, mealCard: v.mealCard, dailyWage: v.dailyWage })),
    fixedExpenses: fixedInScope.map((f) => ({
      id: f.id,
      name: f.name,
      section: f.section,
      period: f.period,
      amount: f.amount,
      vatRate: f.vatRate,
      note: f.note,
      active: activeFromRange(f.endMonth, currentMonth),
      startMonth: f.startMonth,
      endMonth: f.endMonth,
      sortOrder: f.sortOrder,
      taxDoc: f.taxDoc,
      taxWithholding: f.taxWithholding,
      officialAmount: f.officialAmount,
      officialBasis: f.officialBasis,
      landlordType: f.landlordType,
      prorate: f.prorate,
      branchId: f.branchId,
    })),
    fixedExpenseVersions: fixedExpenseVersions.filter((v) => fixedIds.has(v.fixedExpenseId)).map((v) => ({
      id: v.id,
      fixedExpenseId: v.fixedExpenseId,
      fromMonth: v.fromMonth,
      period: v.period,
      amount: v.amount,
    })),
    pnlEntries: pnlInScope.map((e) => ({ month: e.month, rowKey: e.rowKey, amount: e.amount, note: e.note })),
    stockCounts: stockCounts.map((c) => ({ month: c.month, ingredientId: c.ingredientId, qty: c.qty, factor: c.factor, branchId: c.branchId })),
    ingredientPrices: ingredientPrices.map((r) => ({ ...r, changedAt: r.changedAt.toISOString() })),
    purchaseLots,
    heldPurchases,
    pendingPriceHolds: pendingPriceHolds.map((r) => r.id),
    stockExtras: stockExtras.map((e) => ({
      id: e.id,
      month: e.month,
      name: e.name,
      unit: e.unit,
      qty: e.qty,
      unitPrice: e.unitPrice,
    })),
    purchaseQuantities: purchaseQuantities.map((p) => ({
      month: p.month,
      ingredientId: p.ingredientId,
      qty: p.qty,
      note: p.note,
    })),
    expenseCategories: expenseCategories.map((c) => ({
      id: c.id,
      name: c.name,
      section: c.section,
      panelGroup: c.panelGroup,
      invoiceCategory: c.invoiceCategory,
      monthly: c.monthly,
      active: c.active,
      sortOrder: c.sortOrder,
      taxDoc: c.taxDoc,
    })),
    wasteEntries,
    siteSales,
    expenseEntries: countedRecords(
      expenseEntries.map(({ entry, docType }) => ({ ...entry, docType })),
      periods.p,
    ).map((e) => ({
      id: e.id,
      date: e.date,
      categoryId: e.categoryId,
      description: e.description,
      amount: e.amount,
      paymentMethod: e.paymentMethod,
      note: e.note,
      cashOutId: e.cashOutId,
      docType: e.docType,
      supplierEntryId: e.supplierEntryId,
      branchId: e.branchId,
    })),
  };
}

/** Veritabanının satış satırı → modelin satış satırı */
/**
 * Kasaların her birinin kendi geçiş gününden itibaren gelen gün sonları ve her günün çalışan kimlikleri (LM-4b; çok şube:
 * "Tümü"de kasa başına; pos_day_reports.worked_staff, gelmediyse null). Yemek kartının günü bundan
 * (src/lib/asilpos/personel.ts asilposWorkedDays). Yalnız gün ve kimlik okunur
 */
async function loadAsilposWorked(db: DB, switchDays: SwitchDays): Promise<AsilposWorked | null> {
  const tills = Object.entries(switchDays).filter((e): e is [string, string] => e[1] !== null);
  if (!tills.length) return null;
  const rows = await db
    .select({ date: s.posDayReports.date, branchId: s.posDayReports.branchId, refs: s.posDayReports.workedStaff })
    .from(s.posDayReports)
    .where(or(...tills.map(([id, sd]) => and(eq(s.posDayReports.branchId, id), gte(s.posDayReports.date, sd)))))
    .orderBy(asc(s.posDayReports.date), asc(s.posDayReports.branchId));
  return {
    switchDays: Object.fromEntries(tills),
    days: rows.map((r) => ({ branchId: r.branchId, date: r.date, refs: Array.isArray(r.refs) ? r.refs.filter((x): x is string => typeof x === "string") : null })),
  };
}

function salesLineOf(l: typeof s.salesLines.$inferSelect): SalesLine {
  return {
    id: l.id,
    month: l.month,
    posName: l.posName,
    qty: l.qty,
    revenue: l.revenue,
    productId: l.productId,
    isService: l.isService,
    note: l.note,
    // Geçiş günü yalnız AsilPOS'un şubesinin listesini düşürür (mergeSalesSources; denetim 21 Kasım #5)
    branchId: l.branchId,
  };
}

/**
 * Satış satırları: Satışlar'a yüklenen ModPOS listeleri; AsilPOS'a geçiş günü seçiliyse o günden itibaren AsilPOS'un
 * günlük satışları ay toplamı olarak (her gün tek kaynak; src/lib/asilpos/sales.ts). Geçiş günü yoksa AsilPOS okunmaz,
 * satırlar ve kapsam bugünkü gibi. AsilPOS gün sonları ve `till` (kasa raporları) o anki kapsamın şubesinden. `coverage`
 * görünümün listelerinin son günü (engine listPeriod), `coverageOf(kasa)` kasanın şubesininki (sayıldığı ilk gün).
 * `switchDays`: görünümün kasaları (çok şube)
 */
function mergeSales(
  db: DB,
  input: {
    switchDays: SwitchDays;
    salesLines: SalesLine[];
    coverage: Record<string, string>;
    coverageOf: (branchId: string) => Record<string, string>;
    today: string;
    till: readonly TillRow[];
    /** Yalnız "Tümü": ModPOS'ta kalan şubelerin listeleri (ortak dönem; bulgu 62) */
    others?: readonly OtherBranchList[];
  },
) {
  // Yalnız kasa raporları: AsilPOS'un yedek ay satırları (G6, source "asilpos") ve ModPOS föyü rapor değildir. AsilPOS'un
  // günleriyle yalnız sayılan AsilPOS kasalarının (geçiş günü olan) kasa raporları karşılaştırılır ("Tümü"de ModPOS'ta
  // kalan şubeninki ve geçiş günü olmayan kasanınki değil: onların listesi ModPOS listesidir; denetim 21 Kasım #5)
  const tills = new Set(countedTillIds(input.switchDays));
  const reportRows = input.till.filter((r) => isReportRow(r) && tills.has(r.branchId ?? DEFAULT_BRANCH_ID));
  // Kasa başına kasa raporlarının son günü: süren ayın sonraki AsilPOS günleri o kasanın raporu girilince sayılır (bir
  // kasanın raporu öbürünün gününü saydırmaz; "Tümü" şube görünümlerinin toplamı, inceleme 27 Kasım)
  const lastTillDays: Record<string, string> = {};
  for (const r of reportRows) {
    const b = r.branchId ?? DEFAULT_BRANCH_ID;
    if (!(b in lastTillDays) || r.date > lastTillDays[b]) lastTillDays[b] = r.date;
  }
  return mergeWithAsilpos(db, {
    switchDays: input.switchDays,
    salesLines: input.salesLines,
    coverage: input.coverage,
    coverageOf: input.coverageOf,
    today: input.today,
    lastTillDays,
    reportDays: reportRows.map((r) => r.date),
    // Z ve indirim: ModPOS listesi indirimden öncedir, liste − indirim Z ile karşılaştırılır ("%8 fazla", 23 Kasım 2026)
    zOf: (from, upto) => modposZBetween(reportRows, from, upto),
    others: input.others,
  });
}

/**
 * Su + buz litre fiyatının işletme geneli satışı (Dataset.waterSales; denetim 21 Kasım #4). Yalnız tek şube seçiliyken
 * okunur: SU GİDERİ işletmenin faturasıdır, bütün şubelerin ve laffogato.net'in litresine bölünür. "Tümü" kapsamında,
 * veri kümesinin yoluyla (satış satırları AsilPOS'la birleşir; kasa raporları yalnız geçiş günü varsa gerekir). Okunan
 * aylar faturalı aylar ve geçiş ayı (AsilPOS'un sayılmaya başladığı gün o ayın listesine bağlı); dönen yalnız faturalı
 * aylar. `siteSales`: online kanal seçiliyken zaten okunmuş online satışlar (yoksa okunur).
 */
async function companyWaterSales(
  db: DB,
  input: {
    switchDays: SwitchDays;
    coverage: Record<string, string>;
    coverageOf: (branchId: string) => Record<string, string>;
    today: string;
    months: ReadonlySet<string>;
    siteSales: SiteSalesMonth[] | null;
  },
): Promise<NonNullable<Dataset["waterSales"]>> {
  const switchMonths = Object.values(input.switchDays).flatMap((d) => (d ? [d.slice(0, 7)] : []));
  const read = [...new Set([...input.months, ...switchMonths])];
  return withBranchScope(ALL_BRANCHES, async () => {
    const [lines, till, site] = await Promise.all([
      db.select().from(s.salesLines).where(inArray(s.salesLines.month, read)).orderBy(asc(s.salesLines.sortOrder), asc(s.salesLines.id)),
      switchMonths.length ? tillRows() : Promise.resolve([]),
      input.siteSales ? Promise.resolve(input.siteSales) : loadSiteSales(),
    ]);
    const sales = await mergeSales(db, {
      switchDays: input.switchDays,
      salesLines: lines.map(salesLineOf),
      coverage: input.coverage,
      coverageOf: input.coverageOf,
      today: input.today,
      till,
    });
    return {
      salesLines: sales.salesLines.filter((l) => input.months.has(l.month)),
      siteSales: site.filter((r) => input.months.has(r.month)),
    };
  });
}

/**
 * Veri + hesaplama motoru. `personal` (ModelOptions) varsayılan kapalı: Gelir-gider'in personel hücreleri kişi kişi metin
 * taşımaz; yalnız maaşı gören rolün ekranı `personal: can(rol, "maas")` ile açar (docs/ROLLER.md › Muhasebeci)
 */
export async function loadModel(opts: DatasetOptions & ModelOptions = {}) {
  const { personal, ...dataset } = opts;
  return createModel(await loadDataset(dataset), { personal });
}

/** URL'deki ?ay= değeri geçerli bir aysa o (YYYY-MM), değilse null */
export function monthParam(param: string | string[] | undefined): string | null {
  const v = Array.isArray(param) ? param[0] : param;
  return v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null;
}

/**
 * URL'deki ?ay= değerini doğrular; yoksa satış verisi olan son ayı döner (bu aydan sonraki aylar, ör. ileri tarihli
 * deneme verisi, varsayılan olmaz). Kural: defaultMonthOf (src/lib/calc/insights.ts, tests/insights-month.test.ts).
 */
export function resolveMonth(param: string | string[] | undefined, model: ReturnType<typeof createModel>): string {
  return monthParam(param) ?? defaultMonthOf(model.salesMonths, [...model.monthInfo.keys()], model.ds.currentMonth ?? currentMonthTR());
}

/** Ay seçicide gösterilecek aylar (veri olan aylar + bir sonraki ay) */
export function availableMonths(model: ReturnType<typeof createModel>): string[] {
  const set = new Set<string>(model.monthInfo.keys());
  for (const m of model.salesMonths) set.add(m);
  for (const inv of model.ds.invoices) set.add(inv.date.slice(0, 7));
  for (const c of model.ds.stockCounts) set.add(c.month);
  const sorted = [...set].sort();
  if (sorted.length) {
    const last = sorted[sorted.length - 1];
    const [y, m] = last.split("-").map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    sorted.push(next);
  }
  return sorted;
}
