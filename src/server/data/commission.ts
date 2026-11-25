import "server-only";

import { and, asc, eq, gte, inArray, min } from "drizzle-orm";

import { channelNameResolver, type SupplierRef } from "@/app/panel/tedarikciler/logic";
import { COMMISSION_GROUP } from "@/lib/branch-settings/groups";
import { featureBranches } from "@/lib/branch-features";
import { ALL_BRANCHES, DEFAULT_BRANCH_ID } from "@/lib/branches";
import { tillOpenedOn } from "@/lib/cash-month";
import { businessDate } from "@/lib/cash-report";
import { closedDaysIn, closedRowApplies } from "@/lib/closed-days";
import { channelOf, isChannelKey, lafposChannel, type ChannelKey } from "@/lib/commission/channels";
import {
  buildCommissionReport,
  commissionAlerts,
  commissionScopeDays,
  commissionDigestBox,
  commissionLogKey,
  freshAlerts,
  businessPayDays,
  groupInvoiceRows,
  overduePayouts,
  reportWindow,
  type ChannelMonthIn,
  type ChannelSettings,
  type CommissionAlert,
  type CommissionInput,
  type CommissionReport,
  type LafposDayIn,
  type ModposBrandDay,
} from "@/lib/commission/report";
import { COMMISSION_CATEGORY } from "@/lib/constants";
import { posDaySchema, posZSchema } from "@/lib/lafpos/day";
import { modposChannels } from "@/lib/modpos/z";
import { addDays, todayTR } from "@/lib/reminders";
import { andWhere, branchWhere, currentBranchScope, withBranchScope } from "@/server/branch-scope";
import { resolveBranchSetting, resolveForTills } from "@/server/branch-settings";
import { listBranches } from "@/server/branches";
import { loadSupplierRefs } from "@/server/data/suppliers";
import { getDb, schema as s } from "@/server/db";
import { lafposBranchId, lafposSwitchDay } from "@/server/lafpos/branch";
import { loadModposSheets } from "@/server/modpos/store";
import type { DigestExtraCtx, DigestExtraLoad } from "@/server/notify/digest-template";

/**
 * Komisyon ve hakediş verisi (src/lib/commission/report.ts; docs/KOMISYON.md). İki yol, aynı 13 ay (`reportWindow`:
 * geciken hakediş işaretlenene kadar zilde, Bugün'de kalır, ay dönünce düşmez):
 * - ekran (`loadCommissionReport`): faturanın kanalı tedarikçi kartının adı ve diğer adlarıyla da aranır (vergi noyla
 *   eşleşme, Tedarikçiler'in kuralı; loadSupplierRefs bütün faturaları okur, yalnız burada);
 * - hafif yol (zil, Bugün, sabah e-postası): faturadaki adın öneki; dört küçük sorgu aynı anda. Adı bir kanala
 *   bağlanmayan fatura varsa (ör. "Diğer adlar"a eklenen unvan) bir küçük sorgu daha: tedarikçi kartlarının adları ve
 *   kartta yazılı vergi no; öteki faturalar üzerinden vergi no eşleşmesi yalnız ekranda.
 * Okuyan yollar hiçbir şey yazmaz; takibin başladığı gün (`komisyon.since`) yalnız yazma yollarında kaydedilir.
 * LafPOS'a geçiş günü seçiliyse o günden itibaren LafPOS'un gün sonları (Z'deki yemek kartı ve online, ödeme türleri)
 * da okunur (denetim E-37); geçiş günü boşken LafPOS tablosuna hiç bakılmaz, rapor bugünküyle aynıdır.
 *
 * Şube (23 Kasım 2026; docs/SUBE.md): satış seçili şubenin kasa raporlarından ve LafPOS'undan (ilk rapor, açılış günü ve
 * kapalı günler de şubenin), faturalar ve hakediş işletme geneli. ModPOS'ta kalan şube (Tuzla) seçiliyken LafPOS okunmaz
 * ama geçiş ayından itibaren Z'si "Tümü"deki gibi tek kanala yığılmaz (modposScope; föyde markası olan kanalına). Ekran
 * şube seçiliyken işletmenin raporunu da okur (oran işletmenin; şubenin payı = şube satışı × oran). Zil, Bugün, sabah
 * e-postası ve haftalık özet her zaman işletme geneli ("Tümü"; seçiciden bağımsız).
 */

/**
 * Kanal ayarlarının eski genel kaydı (ödeme süresi): { channels: { pluxee: { payDays: 30 }, … } }. 25 Kasım 2026'dan
 * beri şube başına (şube ayarı `komisyon`, COMMISSION_GROUP; docs/SUBE.md › Şube başına ayarlar): bu kayıt Tuzla'nın
 * satırı yokken okunur, öbür şubeler "aynı" başlar
 */
export const COMMISSION_SETTINGS_KEY = "komisyon.ayar";
/** Hakediş takibinin başladığı gün (YYYY-MM-DD): öncesinde son günü geçen hakediş gecikme sayılmaz */
export const COMMISSION_SINCE_KEY = "komisyon.since";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Raporun girdisi, pencere `reportWindow` (bu ay dahil 13 ay; iki yolda aynı). `resolveNames` (ekran): kanal baştan
 * tedarikçi kartının adlarıyla da aranır, vergi no öteki faturalar üzerinden de bağlanır; hafif yolda kartlara yalnız
 * adı bir kanala bağlanmayan fatura varsa bakılır. `today` verilmezse Türkiye'de bugün (çağıran oturumu ya da isteği
 * okuduktan sonra).
 */
export async function loadCommissionInput(opts: { resolveNames: boolean; today?: string }): Promise<CommissionInput> {
  const db = getDb();
  const today = opts.today ?? todayTR();
  const { fromMonth, fromDay } = reportWindow(today);
  // Seçili şube: satış (kasa raporları, LafPOS) onun; "Tümü"de koşul yok
  const scope = await currentBranchScope();
  const branchOnly = scope === ALL_BRANCHES ? null : scope;
  const [invoiceRows, marks, state, till, firstRow, pageNames, closedRows, switchRow, branchRow, channelSettings] = await Promise.all([
    // Komisyon faturaları ve kalemleri tek sorguda (kalemsiz fatura bir satır)
    db
      .select({
        id: s.invoices.id,
        date: s.invoices.date,
        supplier: s.invoices.supplier,
        supplierTaxNumber: s.invoices.supplierTaxNumber,
        invoiceNo: s.invoices.invoiceNo,
        amount: s.invoices.amount,
        discount: s.invoices.discount,
        payable: s.invoices.payable,
        needsReview: s.invoices.needsReview,
        lineName: s.parasutBillLines.productName,
        lineDescription: s.parasutBillLines.description,
        lineNet: s.parasutBillLines.netTotal,
      })
      .from(s.invoices)
      .leftJoin(s.parasutBillLines, eq(s.parasutBillLines.invoiceId, s.invoices.id))
      .where(and(eq(s.invoices.category, COMMISSION_CATEGORY), gte(s.invoices.date, fromDay)))
      .orderBy(asc(s.invoices.date), asc(s.invoices.id), asc(s.parasutBillLines.id)),
    db
      .select({
        channel: s.commissionMonths.channel,
        month: s.commissionMonths.month,
        sales: s.commissionMonths.sales,
        receivedOn: s.commissionMonths.receivedOn,
        received: s.commissionMonths.received,
        note: s.commissionMonths.note,
      })
      .from(s.commissionMonths)
      .where(gte(s.commissionMonths.month, fromMonth)),
    db
      .select({ key: s.integrationState.key, value: s.integrationState.value })
      .from(s.integrationState)
      .where(inArray(s.integrationState.key, [COMMISSION_SINCE_KEY])),
    // Z'deki yemek kartı ve online, seçili şubenin
    db
      .select({
        date: s.cashReports.date,
        mealCard: s.cashReports.mealCard,
        online: s.cashReports.online,
        // LafPOS'un girdiği ayda ModPOS'ta kalan şubenin raporu ayrıca sayılır (lafposMonth `modpos`)
        branchId: s.cashReports.branchId,
      })
      .from(s.cashReports)
      .where(andWhere(gte(s.cashReports.date, fromDay), branchWhere(s.cashReports.branchId, scope)))
      .orderBy(asc(s.cashReports.date)),
    // İlk raporun günü (ay ortasında başlayan ilk ay), seçili şubenin
    db.select({ first: min(s.cashReports.date) }).from(s.cashReports).where(branchWhere(s.cashReports.branchId, scope)),
    opts.resolveNames ? supplierNames(true) : Promise.resolve(null),
    // Kapalı işaretli günler (eksik rapor sayılmaz; dalga 10 §2.9): şube seçiliyken yalnız onun ve işletme genelinin
    db
      .select({ kind: s.specialDays.kind, dateFrom: s.specialDays.dateFrom, dateTo: s.specialDays.dateTo, branchId: s.specialDays.branchId })
      .from(s.specialDays)
      .where(and(eq(s.specialDays.kind, "kapali"), gte(s.specialDays.dateTo, fromDay))),
    // LafPOS'a geçiş günü (yoksa LafPOS okunmaz)
    lafposSwitchDay(db),
    // Seçili şubenin açılışı: sonradan açılan şubenin açılış ayı "kasa raporları ay ortasında başladı" sayılmaz
    branchOnly
      ? db.select({ id: s.branches.id, openedOn: s.branches.openedOn }).from(s.branches).where(eq(s.branches.id, branchOnly)).limit(1)
      : Promise.resolve([]),
    // Kanalların ödeme süresi: hakediş işletmenin, seçiciden bağımsız (şubelerin en kısa süresi; businessPayDays)
    loadBusinessPayDays(db),
  ]);
  // Geçiş günü seçili şubenin kasasınınki: ModPOS'ta kalan şube (Tuzla) seçiliyken LafPOS hiç okunmaz, Z'si geçiş ayından
  // itibaren föyün markasıyla (modposScope)
  const lafposBranch = await lafposBranchId(db);
  const { lafpos: switchDay, modpos: modposFrom } = commissionScopeDays(switchRow, scope, lafposBranch);
  const lafposFrom = switchDay ? (switchDay > fromDay ? switchDay : fromDay) : null;
  // Föyün markası geçiş ayının başından (geçiş gününden önceki günler de kasa raporu kuralıyla sayılır)
  const brandsFrom = switchDay ?? modposFrom;
  const brandsStart = brandsFrom ? (`${brandsFrom.slice(0, 7)}-01` > fromDay ? `${brandsFrom.slice(0, 7)}-01` : fromDay) : null;
  const [lafposDays, modposBrands] = await Promise.all([
    lafposFrom ? loadLafposPaymentDays(lafposFrom, scope) : Promise.resolve([]),
    brandsStart ? loadModposBrands(brandsStart, today) : Promise.resolve([]),
  ]);
  // Hafif yol: faturadaki adı bir kanala bağlanmayan fatura varsa kartların adları da aranır (Kanalı bulunamayan
  // faturalar kartının "Diğer adlar" önerisi zilde, Bugün'de ve e-postada da geçerli olsun)
  const names = pageNames ?? (invoiceRows.some((r) => !channelOf([r.supplier])) ? await supplierNames(false) : null);

  const stored = new Map(state.map((x) => [x.key, x.value]));
  const since = stored.get(COMMISSION_SINCE_KEY);
  return {
    today,
    through: addDays(businessDate(), -1),
    // Takip başlamadıysa (kayıt yoksa) bugün: okuyan yol yazmaz, geçmiş son günler "takip öncesi" kalır
    since: typeof since === "string" && DAY.test(since) ? since : today,
    fromMonth,
    invoices: groupInvoiceRows(invoiceRows, names),
    till: till.map(({ date, mealCard, online, branchId }) => ({ date, mealCard, online, branchId })),
    firstReport: firstRow[0]?.first ?? null,
    closed: closedDaysIn(
      closedRows.filter((r) => closedRowApplies(r, branchOnly)),
      fromDay,
      addDays(businessDate(), -1),
      till.map((r) => r.date),
    ),
    marks: marks.filter((m): m is ChannelMonthIn => isChannelKey(m.channel)),
    settings: channelSettings,
    lafpos: switchDay ? { switchDay, days: lafposDays } : null,
    ...(modposBrands.length ? { modposBrands } : {}),
    ...(branchOnly ? { openedOn: tillOpenedOn(branchRow[0] ?? null) } : {}),
    ...(modposFrom ? { modposScope: { switchDay: modposFrom } } : {}),
    lafposBranch,
  };
}

/**
 * ModPOS föylerinin markalı ödemeleri (`from`'dan bugüne, seçili şubenin; `from` geçiş ayının başı): kasa raporu kuralıyla
 * sayılan günün (geçiş gününden önce ya da ModPOS'ta kalan şubede) Z'sindeki yemek kartı ve online kanal kanal bölünür
 * (modposChannels; markası olmayan ödeme sayılmaz). LafPOS'un şubesinin geçiş gününden sonraki föyü eşleşmez (o günlerin
 * kasa raporu Z kuralıyla sayılmaz; Marina'da ModPOS bir daha kullanılmaz). Föy yoksa boş: markası belirsiz kalır
 */
async function loadModposBrands(from: string, to: string): Promise<ModposBrandDay[]> {
  // Açık (sürmekte olan) kasa günü hesaba girmez
  const sheets = (await loadModposSheets(from, to)).filter((sh) => sh.state !== "ACIK");
  return sheets.flatMap((sh) => {
    const byChannel: ModposBrandDay["byChannel"] = {};
    for (const k of sh.foy.kasalar) {
      for (const o of k.odemeler) {
        for (const p of modposChannels(o)) if (p.channel && p.amount > 0) byChannel[p.channel] = Math.round(((byChannel[p.channel] ?? 0) + p.amount) * 100) / 100;
      }
    }
    return Object.keys(byChannel).length ? [{ date: sh.day, branchId: sh.branchId, byChannel }] : [];
  });
}

const paymentsSchema = posDaySchema.shape.payments;

/**
 * LafPOS'un `from` gününden itibaren gelen gün sonları: Z'deki yemek kartı ve online, ödeme türleri (kanalı
 * lafposChannel ile tanınır, tanınmayan null). Özeti okunamayan gün atlanır (gelmemiş sayılır); ödemeleri okunamayan
 * günün Z'si sayılır, ödemeleri boş. Yalnız yönetici okur (zil ve ekran); ikram ve satır okunmaz.
 */
async function loadLafposPaymentDays(from: string, scope: string): Promise<LafposDayIn[]> {
  const rows = await getDb()
    .select({ date: s.posDayReports.date, z: s.posDayReports.z, payments: s.posDayReports.payments })
    .from(s.posDayReports)
    .where(andWhere(gte(s.posDayReports.date, from), branchWhere(s.posDayReports.branchId, scope)))
    .orderBy(asc(s.posDayReports.date));
  const out: LafposDayIn[] = [];
  for (const r of rows) {
    const z = posZSchema.safeParse(r.z);
    if (!z.success) continue;
    const payments = paymentsSchema.safeParse(r.payments);
    out.push({
      date: r.date,
      mealCard: z.data.mealCard,
      online: z.data.online,
      payments: payments.success ? payments.data.map((p) => ({ name: p.name, zField: p.zField, channel: lafposChannel(p.channel), rawChannel: p.channel, amount: p.amount })) : [],
    });
  }
  return out;
}

/**
 * Faturadaki ad (ve vergi no) → kanalın aranacağı adlar: faturadaki ad, sonra tedarikçi kartının adı ve diğer adları
 * (Tedarikçiler'in eşleşmesi: ad önce, sonra vergi no). "Diğer adlar"a eklenen ad faturayı kanala bağlar. `withRefs`
 * (yalnız ekran): vergi no öteki faturalar üzerinden de bağlanır (loadSupplierRefs bütün faturaları okur); yoksa
 * yalnız kartta yazılı vergi no.
 */
async function supplierNames(withRefs: boolean): Promise<(supplier: string, taxNumber: string | null) => string[]> {
  const [cards, refs] = await Promise.all([
    getDb().select({ id: s.suppliers.id, name: s.suppliers.name, aliases: s.suppliers.aliases, taxNumber: s.suppliers.taxNumber }).from(s.suppliers),
    withRefs ? loadSupplierRefs() : Promise.resolve<SupplierRef[]>([]),
  ]);
  return channelNameResolver(
    cards.map((c) => ({ ...c, aliases: Array.isArray(c.aliases) ? c.aliases.filter((a): a is string => typeof a === "string") : [] })),
    refs,
  );
}

/**
 * İşletmenin hakedişinin ödeme süreleri (businessPayDays): yemek kartı açık kasaların şube ayarı `komisyon`, kanal kanal
 * en kısası. Ekran, zil, Bugün, sabah e-postası ve haftalık özet aynı süreyi okur; seçici değiştirmez. Yemek kartı
 * hiçbir kasada açık değilse varsayılan şubeninki (eski kayıt komisyon.ayar ona aittir)
 */
async function loadBusinessPayDays(db: ReturnType<typeof getDb>): Promise<Record<ChannelKey, ChannelSettings>> {
  const [tills, branches] = await Promise.all([resolveForTills(COMMISSION_GROUP, db), listBranches(db)]);
  const meal = new Set(featureBranches(branches, "yemek_karti").map((b) => b.id));
  const list = [...tills].filter(([id]) => meal.has(id)).map(([, r]) => r.value.channels);
  return businessPayDays(list.length ? list : [(await resolveBranchSetting(COMMISSION_GROUP, DEFAULT_BRANCH_ID, db)).value.channels]);
}

/** Ekranın raporu: kanal tedarikçi kartının adlarıyla da aranır */
export async function loadCommissionReport(): Promise<CommissionReport> {
  return buildCommissionReport(await loadCommissionInput({ resolveNames: true }));
}

/**
 * Hafif rapor (zil, Bugün, sabah e-postası): ekranın ayları, faturadaki adın öneki (bağlanmazsa kartın adları). Her zaman
 * işletme geneli: seçicide şube seçili olsa da uyarı ve hakediş işletmenindir (docs/SUBE.md)
 */
async function loadLightReport(today?: string): Promise<CommissionReport> {
  return withBranchScope(ALL_BRANCHES, async () => buildCommissionReport(await loadCommissionInput({ resolveNames: false, today })));
}

/**
 * Ekranın raporları: seçili kapsamın raporu ve (şube seçiliyken) işletmenin raporu. Faturalar, oran ve hakediş
 * işletmenindir (`all`); şubenin satışı `branch`'ten (branchCommissionShare). "Tümü"de ikisi aynı rapor, `branch` null
 */
export async function loadCommissionReports(): Promise<{ all: CommissionReport; branch: CommissionReport | null; scope: string }> {
  const scope = await currentBranchScope();
  if (scope === ALL_BRANCHES) return { all: await loadCommissionReport(), branch: null, scope };
  // Ödeme süreleri her iki raporda işletmenin (businessPayDays): son gün ve gecikme seçiciye göre değişmez, zille aynı
  const [all, branch] = await Promise.all([withBranchScope(ALL_BRANCHES, () => loadCommissionReport()), withBranchScope(scope, () => loadCommissionReport())]);
  return { all, branch, scope };
}

/** Zilin uyarıları (Faturalar başlığı, yalnız yönetici): geciken hakediş, %6 aşımı, komisyon dışı ücret; en çok beş */
export async function loadCommissionAlerts(): Promise<CommissionAlert[]> {
  const report = await loadLightReport();
  return commissionAlerts(report, report.today);
}

/** Bugün'ün "Hakedişler" satırı: geciken hakedişler, en eski son gün önce */
export async function loadOverduePayouts(): Promise<{ label: string; month: string; due: string }[]> {
  return overduePayouts(await loadLightReport()).map((r) => ({ label: r.label, month: r.month, due: r.payout.due! }));
}

/** Takibin başladığı gün: yoksa bugün yazılır (yalnız yazma yollarında: sabah e-postası, hakediş ve kanal kaydı) */
export async function ensureCommissionSince(): Promise<string> {
  const db = getDb();
  await db.insert(s.integrationState).values({ key: COMMISSION_SINCE_KEY, value: todayTR() }).onConflictDoNothing();
  const [row] = await db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, COMMISSION_SINCE_KEY)).limit(1);
  return typeof row?.value === "string" ? row.value : todayTR();
}

/**
 * Sabah e-postasının "Komisyon ve hakediş" kutusu (src/server/notify/digest-extras.ts): daha önce e-postayla
 * bildirilmemiş uyarılar (anahtarı notification_log'da olmayan), en çok beş. Gönderimde takibin başladığı gün yazılır
 * (sabah işinin ilk çalışması); önizleme hiçbir şey yazmaz. Anahtarlar gönderimden sonra günlüğe yazılır.
 */
export async function loadCommissionDigest(today: string, ctx: DigestExtraCtx): Promise<DigestExtraLoad | null> {
  if (!ctx.preview) await ensureCommissionSince();
  const report = await loadLightReport(today);
  const alerts = commissionAlerts(report, today, Infinity);
  if (!alerts.length) return null;
  const keys = alerts.map(commissionLogKey);
  const sent = new Set((await getDb().select({ key: s.notificationLog.key }).from(s.notificationLog).where(inArray(s.notificationLog.key, keys))).map((r) => r.key));
  const fresh = freshAlerts(alerts, sent);
  const box = commissionDigestBox(fresh);
  return box ? { box, logKeys: fresh.map(commissionLogKey) } : null;
}
