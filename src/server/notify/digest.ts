import "server-only";

import { createHash } from "node:crypto";

import { and, asc, count, desc, eq, gt, inArray, isNull, like, ne, or } from "drizzle-orm";

import { ALL_BRANCHES, type BranchScope, tillBranches } from "@/lib/branches";
import { latestSalesMonth } from "@/lib/calc/insights";
import { priceLoss } from "@/lib/calc/price-loss";
import { cariHints, upcomingWithCari } from "@/lib/cari/upcoming";
import { pendingCashOutSummary } from "@/lib/cash-outs";
import { allDroppedSentence, digestGroups, digestItemInGroup, droppedListText, droppedLogSuffix, type DroppedRecipient } from "@/lib/notify-recipients";
import { dueNotifications, todayTR, type UpcomingItem } from "@/lib/reminders";
import { logActivity } from "@/server/actions/log";
import { loadModel } from "@/server/data/dataset";
import { loadPriceAlerts } from "@/server/data/price-alerts";
import { pendingHoldSummary } from "@/server/data/price-holds";
import { countStockOnlyReview } from "@/server/data/stock-only-invoices";
import { loadCashOutInvoiceState } from "@/server/data/cash-out-invoices";
import { loadCariIndex, type CariIndex } from "@/server/data/cari";
import { withBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";
import { isProductionRuntime, loadEmailProblems } from "@/server/jobs/alerts";

import { loadDigestExtras } from "./digest-extras";
import { invoiceNewsOf, renderDigest, type DigestInvoices, type DigestPrices } from "./digest-template";
import { activeDigestEmails, activeDigestRecipients, sendableRecipients } from "./recipients";
import { isEmailConfigured, resolveFrom, sendEmail, sendFailureText } from "./resend";
import { loadNotifySettings } from "./settings";

export { APP_URL, invoiceNewsOf, renderDigest } from "./digest-template";

/**
 * Etkin hatırlatıcılar, ödenmemiş faturalar ve tedarikçilerin faturasız borçlarından (cari) yaklaşan ödemeler.
 * Vadesiz faturanın tahmini vadesi tedarikçinin cari kartındaki vade gününden (Tedarikçiler; kart adla ve vergi noyla
 * bulunur), yoksa genel ayardan. Tedarikçinin hesabındaki sayılmamış ödeme okuma anında vade sırasıyla düşülür
 * (src/lib/cari/upcoming.ts; tamamen karşılananlar `covered`). Faturasız alımın faturası olabilecek fatura ve kalanı bir
 * Kasa satırını tutan kalem (satır başına bir kalem) sessizdir (ipucuyla; sabah e-postası hatırlatmaz; cariHints). Zil
 * her açılışta çağırır: faturalar tek sorgu, cari hesap tek okuma (loadCariIndex; kayıt yokken kayıt sorguları boş döner).
 */
/**
 * Yaklaşan ödemeler: hatırlatıcılar, ödenmemiş faturalar ve faturasız borçlar. `opts.branch` tek şube verilirse
 * hatırlatıcılar o şubenin ve işletme genelinin olanlarıyla gelir (docs/SUBE.md › Ödemeler); faturalar ve cari
 * işletme genelidir, süzülmez. Verilmezse (sabah e-postası, nakit planı, vergi, haftalık özet) bütün ödemeler — para
 * işletmenindir. "Tümü"nde şubeye ait hatırlatıcının başlığına şubesi eklenir ("Kira · Marina").
 */
export async function loadUpcoming(today = todayTR(), scope: { branch?: BranchScope } = {}) {
  const db = getDb();
  const single = scope.branch && scope.branch !== ALL_BRANCHES ? scope.branch : null;
  // Bir kez çalışan söz (sorgu kurucusu her `then`de yeniden çalışırdı): liste ve cari okuması paylaşır
  const rowsP = Promise.resolve(
    db
      .select({
        id: s.invoices.id,
        supplier: s.invoices.supplier,
        invoiceNo: s.invoices.invoiceNo,
        date: s.invoices.date,
        dueDate: s.invoices.dueDate,
        payable: s.invoices.payable,
        outstanding: s.invoices.outstanding,
        allocated: s.invoices.allocated,
        ledgerBase: s.invoices.ledgerBase,
        supplierTaxNumber: s.invoices.supplierTaxNumber,
      })
      .from(s.invoices)
      .where(eq(s.invoices.unpaid, true)),
  );
  const [settings, reminders, rows, index] = await Promise.all([
    loadNotifySettings(),
    db
      .select()
      .from(s.reminders)
      .where(single ? or(eq(s.reminders.branchId, single), isNull(s.reminders.branchId)) : undefined)
      .orderBy(asc(s.reminders.dueDate)),
    rowsP,
    loadCariIndex(today, { unpaid: rowsP.then((r) => r.map((i) => ({ date: i.date, supplier: i.supplier, tax: i.supplierTaxNumber }))) }),
  ]);
  const invoices = rows.map(({ supplierTaxNumber, ...i }) => ({
    ...i,
    termDays: i.dueDate ? null : index.termDays(i.supplier, supplierTaxNumber),
    cardId: index.resolveCard(i.supplier, supplierTaxNumber),
  }));
  const opts = { invoiceDaysBefore: settings.invoiceDaysBefore, invoiceTermDays: settings.invoiceTermDays };
  const debts = index.openDebts.flatMap((d) => {
    const card = index.cards.get(d.supplierId);
    return card ? [{ ...d, supplier: card.name, remaining: d.remaining, cardId: card.id, termDays: card.paymentTermDays }] : [];
  });
  const hints = cariHints(index, invoices, debts);
  // Bütün şubeler birlikteyken şubeye ait ödeme hangi şubenin, listede ve e-postada görünsün
  const branchNames = !single && reminders.some((r) => r.branchId) ? new Map((await listBranches(db)).map((b) => [b.id, b.name])) : null;
  const labelled = branchNames ? reminders.map((r) => (r.branchId ? { ...r, title: `${r.title} · ${branchNames.get(r.branchId) ?? r.branchId}` } : r)) : reminders;
  const up = upcomingWithCari({ reminders: labelled, invoices, debts, credit: index.credit, hints, hrefOf: index.hrefOf }, today, opts);
  const items = up.items;
  // Takvim için: vadesi listenin ufkundan sonra olan faturalar ve faturasız borçlar (listede ve e-postada yer almaz)
  const laterInvoices: UpcomingItem[] = up.later;
  return { today, settings, reminders, items, laterInvoices, covered: up.covered, cari: cariSummary(index, single) };
}

/**
 * Ödemeler, zil ve Genel bakış için cari hesabın özeti: açık faturasız borçlar, hesaptaki para, işlenmemiş Kasa satırları,
 * uyarılar. Cari işletme genelidir; kasa satırı şubenindir (docs/SUBE.md › Ödemeler): tek şube (`single`) verilirse işlenmemiş
 * Kasa satırlarının sayısı yalnız o şubenin kasasını sayar. Liste (`index.kasaPending`) süzülmez: `cariHints` işletme
 * geneli faturaları onunla sessize alır, Tuzla'nın kasasından ödenmiş fatura Marina'da da ödenmiş görünür.
 */
function cariSummary(index: CariIndex, single: string | null = null) {
  const kasaLines = single ? index.kasaPending.filter((l) => l.branchId === single) : index.kasaPending;
  const cardName = (id: number) => index.cards.get(id)?.name ?? "";
  // Faturası gelmeyen alım: tutarı alımın kendisi (ödenmiş olsa da gideri yazılmadı)
  const late = index.lateDebts.map((d) => ({ id: d.id, cardId: d.supplierId, name: cardName(d.supplierId), date: d.date, description: d.description, amount: d.amount, href: index.hrefOf(d.supplierId) ?? null }));
  const strong = index.strong.map((c) => ({ cardId: c.cardId, name: cardName(c.cardId), invoiceId: c.invoiceId, debtIds: c.debtIds, href: index.hrefOf(c.cardId) ?? null }));
  return {
    debts: index.openDebts.length,
    debtTotal: Math.round(index.openDebts.reduce((a, d) => a + d.remaining, 0) * 100) / 100,
    credit: Math.round([...index.credit.values()].reduce((a, v) => a + v, 0) * 100) / 100,
    kasaPending: { count: kasaLines.length, total: Math.round(kasaLines.reduce((a, l) => a + l.amount, 0) * 100) / 100 },
    late,
    strong,
  };
}

export type CariUpcomingSummary = ReturnType<typeof cariSummary>;

export type DigestResult =
  /** `boxes`: haber olan ek kutuların konu parçaları, parçası olmayanın adı (yalnız varsa; digest-extras.ts) */
  | { status: "sent"; count: number; recipients: number; invoices?: number; prices?: number; syncError?: boolean; system?: number; holds?: number; boxes?: string[] }
  /**
   * `off`: neden gitmedi. "disabled" e-posta kapalı, "nokey" Resend kurulmamış (gönderilecek bir şey olsa da gitmezdi);
   * "norecipient" gönderilecek bir şey vardı ama etkin bildirim adresi yok. Yoksa gönderilecek yeni bir şey yoktu.
   * `blocked`: etkin adresler vardı ama hepsi personel ya da pasif hesabın (droppedListText; Günlük işler nedeni yazar)
   */
  | { status: "skipped"; reason: string; off?: "disabled" | "nokey" | "norecipient"; blocked?: string }
  | { status: "error"; error: string };

/** Paraşüt bölümünün anahtarı: her gönderimde yeni satır; "son gönderimden bu yana" buna göre bulunur */
const INVOICE_LOG_PREFIX = "invoices:";
/** İlk kez (hiç gönderim yokken) geriye bakılan süre */
const FIRST_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * Sabah e-postasının Paraşüt bölümü: son Paraşüt bölümlü e-postadan bu yana eşitlemenin açtığı faturalar,
 * kontrol bekleyenlerin sayısı, (henüz bildirilmediyse) başarısız son eşitleme ve onay bekleyen hammadde fiyatları
 * (`fresh`: aynı andan bu yana onaya düşenler). `sinceKey` son Paraşüt bölümlü gönderimin anıdır (hiç yoksa ""):
 * aynı gün ikinci gönderimin Resend tekil anahtarı buna göre değişir.
 */
export async function loadDigestInvoices(): Promise<{ invoices: DigestInvoices; failedRunKey: string | null; sinceKey: string }> {
  const db = getDb();
  const [lastSent] = await db
    .select({ at: s.notificationLog.sentAt })
    .from(s.notificationLog)
    .where(and(like(s.notificationLog.key, `${INVOICE_LOG_PREFIX}%`), eq(s.notificationLog.ok, true)))
    .orderBy(desc(s.notificationLog.sentAt))
    .limit(1);
  const since = lastSent?.at ?? new Date(Date.now() - FIRST_LOOKBACK_MS);
  const [rows, [{ n }], [lastRun], holds, stockOnly, cashOuts] = await Promise.all([
    db
      .select({
        supplier: s.invoices.supplier,
        date: s.invoices.date,
        payable: s.invoices.payable,
        category: s.invoices.category,
        needsReview: s.invoices.needsReview,
        unpaid: s.invoices.unpaid,
        dueDate: s.invoices.dueDate,
      })
      .from(s.invoices)
      .where(and(eq(s.invoices.origin, "parasut"), gt(s.invoices.createdAt, since)))
      .orderBy(desc(s.invoices.date), desc(s.invoices.id)),
    db.select({ n: count() }).from(s.invoices).where(eq(s.invoices.needsReview, true)),
    // Tedarikçi geçmişi (tek tedarikçi, elle) günlük eşitlemenin sağlığına sayılmaz
    db.select().from(s.parasutSyncRuns).where(ne(s.parasutSyncRuns.trigger, "history")).orderBy(desc(s.parasutSyncRuns.startedAt)).limit(1),
    pendingHoldSummary().catch((e) => {
      console.error("Sabah e-postası fiyat onayları", e);
      return null;
    }),
    // Kontrol bekleyenlerin kategorisi tahmin olmayanı: kalemi hammaddeye bağlı, mal alışı sayılmıyor (E-07)
    countStockOnlyReview(db).catch((e) => {
      console.error("Sabah e-postası mal alışı sayılmayan faturalar", e);
      return 0;
    }),
    // Kasadan faturalı alımlar, faturası yok (E-42) ve faturası sonradan gelip iki kez sayılanlar
    loadCashOutInvoiceState(db).catch((e) => {
      console.error("Sabah e-postası kasadan faturalı alımlar", e);
      return { pending: [], duplicates: [] };
    }),
  ]);
  const sinceIso = since.toISOString();
  const priceHolds = holds?.count
    ? { count: holds.count, fresh: holds.items.filter((i) => i.createdAt > sinceIso).length, items: holds.items.map(({ name, pct }) => ({ name, pct })) }
    : null;
  let syncError: string | null = null;
  let failedRunKey: string | null = null;
  if (lastRun?.status === "error" && Date.now() - lastRun.startedAt.getTime() < 36 * 60 * 60 * 1000) {
    const key = `syncfail:${lastRun.id}`;
    const [already] = await db.select({ key: s.notificationLog.key }).from(s.notificationLog).where(eq(s.notificationLog.key, key)).limit(1);
    if (!already) {
      syncError = (lastRun.message ?? "bilinmeyen hata").slice(0, 300);
      failedRunKey = key;
    }
  }
  // Hesaplanan `since` değil kayıt anı: ilk gönderimde "şimdi − 24 saat" her çağrıda değişir, eşzamanlı iki gönderim
  // (sabah işi + elle) aynı anahtarı paylaşmazdı
  const { pending: waiting, duplicates } = cashOuts;
  const cashOutPart =
    waiting.length || duplicates.length
      ? { count: waiting.length, summary: pendingCashOutSummary(waiting), ...(duplicates.length ? { duplicates: duplicates.length } : {}) }
      : null;
  return {
    invoices: { items: rows, reviewCount: n, stockOnlyCount: Math.min(stockOnly, n), cashOuts: cashOutPart, syncError, priceHolds },
    failedRunKey,
    sinceKey: lastSent?.at?.toISOString() ?? "",
  };
}

/** Zam bölümünün anahtarı: her gönderimde yeni satır; yalnız son zam e-postasından sonraki zamlar yeni sayılır */
const PRICE_LOG_PREFIX = "prices:";

/**
 * Sabah e-postasının zam bölümü: son zam bölümlü e-postadan (yoksa son 24 saatten) bu yana fiyatı artan
 * hammaddeler, bu yeni zamların ayda kaç lira kâr götürdüğü (son satış ayıyla; price-loss.ts) ve fiyatı hedefin
 * altında kalan ürünler. Yeni zam yoksa null (her sabah aynı zam yinelenmez).
 */
export async function loadDigestPrices(): Promise<DigestPrices | null> {
  const db = getDb();
  const [lastSent] = await db
    .select({ at: s.notificationLog.sentAt })
    .from(s.notificationLog)
    .where(and(like(s.notificationLog.key, `${PRICE_LOG_PREFIX}%`), eq(s.notificationLog.ok, true)))
    .orderBy(desc(s.notificationLog.sentAt))
    .limit(1);
  const since = (lastSent?.at ?? new Date(Date.now() - FIRST_LOOKBACK_MS)).toISOString();
  const model = await loadModel();
  const pa = await loadPriceAlerts(model);
  const fresh = pa.changes.filter((c) => c.pct > 0 && c.changedAt > since);
  if (!fresh.length) return null;
  // Yalnız yeni zamların etkisi (pencerenin bütün zamları Ürünler'de)
  const loss = priceLoss(model, fresh, latestSalesMonth(model));
  const monthlyOf = new Map(loss.ingredients.map((i) => [i.ingredientId, i.monthly]));
  return {
    changes: fresh.map((c) => ({ name: c.name, unit: c.unit, before: c.before, after: c.after, pct: c.pct, monthly: loss.basis ? (monthlyOf.get(c.ingredientId) ?? 0) : null })),
    products: pa.actionable.map((p) => ({ name: p.name, size: p.size, price: p.price, suggestedPrice: p.suggestedPrice, basis: p.basis, ratioBefore: p.ratioBefore, ratioAfter: p.ratioAfter })),
    productCount: pa.actionable.length,
    monthlyTotal: loss.basis ? loss.totalLoss : null,
    basisMonth: loss.basis?.month ?? null,
  };
}

/**
 * Günlük sabah e-postası: bugün haber verilmesi gereken ve daha önce gitmemiş ödemeler, Paraşüt'ten gelen yeni
 * faturalar, kontrol bekleyenler, eşitleme hatası, yeni hammadde zamları, ek kutular (digest-extras.ts) ve (canlıda)
 * günlük işlerin sorunları (dünkü sabah işi, bu sabahki Paraşüt işi) tek iletide. Hiçbiri yoksa e-posta gitmez.
 * `syncedToday`: sabah işi bugün Paraşüt eşitlemesinin yapıldığını biliyorsa (verilmezse sorulur). `sendDeadlineAt`:
 * sabah işinin gönderim sınırı (jobStart + 48 sn, src/server/jobs/capped.ts); elle gönderimde yok (bugünkü gibi).
 *
 * E-posta işletmenin tamamı içindir (docs/SUBE.md › Neyi süzer): bütün okumalar seçiciden bağımsız "Tümü"yle
 * (`withBranchScope`). Sabah işinde şube seçimi yoktur; "Bugünküleri şimdi gönder" ise yöneticinin seçimiyle okuyordu:
 * Marina seçiliyken zammın "ayda ≈ X ₺"ı Marina'nın satışından hesaplanıp gidiyor, `prices:` kaydı da sabah işinin
 * işletme geneli rakamı göndermesini engelliyordu (denetim 21 Kasım #18).
 */
export async function runReminderDigest(trigger: "cron" | "manual", ctx: { syncedToday?: boolean; sendDeadlineAt?: number } = {}): Promise<DigestResult> {
  return withBranchScope(ALL_BRANCHES, () => sendReminderDigest(trigger, ctx));
}

async function sendReminderDigest(trigger: "cron" | "manual", ctx: { syncedToday?: boolean; sendDeadlineAt?: number }): Promise<DigestResult> {
  const db = getDb();
  const { today, settings, items, reminders } = await loadUpcoming();
  if (!settings.emailEnabled) return { status: "skipped", reason: "Hatırlatma e-postaları kapalı.", off: "disabled" };
  if (!isEmailConfigured()) return { status: "skipped", reason: "RESEND_API_KEY tanımlı değil.", off: "nokey" };

  // Ek kutular ötekilerle aynı anda yüklenir (her biri en çok 4 sn; hata fırlatmaz)
  const extrasP = loadDigestExtras(today);
  const due = dueNotifications(items);
  const sent = due.length ? await db.select({ key: s.notificationLog.key }).from(s.notificationLog).where(inArray(s.notificationLog.key, due.map((d) => d.key))) : [];
  const sentKeys = new Set(sent.map((r) => r.key));
  const fresh = due.filter((d) => !sentKeys.has(d.key));
  const { invoices, failedRunKey, sinceKey } = await loadDigestInvoices();
  const prices = await loadDigestPrices().catch((e) => {
    console.error("Sabah e-postası zam bölümü", e);
    return null;
  });
  // Günlük işlerin henüz e-postayla bildirilmemiş sorunları (yalnız canlıda; işler yalnız orada çalışır)
  const system = isProductionRuntime()
    ? await loadEmailProblems("digest", { syncedToday: ctx.syncedToday }).catch((e) => {
        console.error("Sabah e-postası sistem bölümü", e);
        return [];
      })
    : [];
  const extras = await extrasP;
  // Kontrol bekleyen ve eski onay bekleyen sayısı tek başına her gün e-posta göndermez; yeni fatura, hata ya da yeni
  // onaya düşen fiyat varsa bölümde yer alır. Ek kutulardan yalnız haber olanlar (tahmin değil) e-postayı gönderir
  const invoiceNews = invoiceNewsOf(invoices);

  // Alıcı grupları (şube kapsamı C P1-11): şubesi seçilmemiş adresler bugünkü tek e-postayı alır; şubeye bağlı adresler o
  // şubenin başlığıyla ayrı e-posta (şubenin ve işletme genelinin ödemeleri, şubenin kontrol listeleri ve onay bekleyen
  // istekleri). Bütün grupların içeriği gönderimden ÖNCE kurulur: bir grubun günlüğe yazdığı anahtar ("kontrol:<gün>")
  // öbür grubun kutusunu düşürmesin. Şube grubunun kutuları yalnız okunur (önizleme gibi)
  const [recipientRows, branchRows] = await Promise.all([activeDigestRecipients(db), listBranches(db)]);
  const tills = tillBranches(branchRows);
  const reminderBranch = new Map(reminders.map((r) => [r.id, r.branchId ?? null]));
  const itemBranch = (item: UpcomingItem) => (item.source === "reminder" ? (reminderBranch.get(item.sourceId) ?? null) : null);
  const groups = await Promise.all(
    digestGroups(recipientRows, tills).map(async (g) => {
      const branch = g.branchIds.length ? g.branchIds.map((id) => tills.find((b) => b.id === id)?.name ?? id).join(", ") : null;
      const groupExtras = g.branchIds.length === 1 ? await loadDigestExtras(today, { preview: true, scope: g.branchIds[0] }) : extras;
      const groupFresh = g.branchIds.length ? fresh.filter((f) => digestItemInGroup(itemBranch(f.item), g.branchIds)) : fresh;
      const news = groupFresh.length > 0 || invoiceNews || !!prices || system.length > 0 || groupExtras.news;
      return { ...g, branch, extras: groupExtras, fresh: groupFresh, news };
    }),
  );
  // Adres yokken de "gönderilecek bir şey var mı" bütün şubelerin içeriğiyle (bugünkü sıra: önce içerik, sonra adres)
  const anyNews = groups.length ? groups.some((g) => g.news) : fresh.length > 0 || invoiceNews || !!prices || system.length > 0 || extras.news;
  if (!anyNews) {
    return {
      status: "skipped",
      reason: due.length ? "Bugünkü hatırlatmalar zaten gönderildi; yeni fatura ya da zam yok." : "Bugün haber verilecek bir ödeme, yeni fatura ya da zam yok.",
    };
  }

  // Personel hesabının ya da pasif hesabın adresi düşer (E-53): özette ödemeler, fatura tutarları, zam ve kâr rakamları
  // var. Düşen adres yöneticinin zilinde ve Bildirim adresleri listesinde görünür
  const allDropped: DroppedRecipient[] = [];
  let recipients = 0;
  let error: string | null = null;
  const sentFresh = new Set<string>();
  const boxes = new Set<string>();
  for (const g of groups) {
    if (!g.news) continue;
    const { to, dropped } = await sendableRecipients(db, g.emails);
    allDropped.push(...dropped);
    if (!to.length) continue;
    const { subject, html, text } = renderDigest(
      g.fresh,
      today,
      invoiceNews || invoices.reviewCount || invoices.priceHolds || invoices.cashOuts ? invoices : null,
      prices,
      system.length ? { items: system } : null,
      g.extras.extras,
      g.branch,
    );
    // Tekil anahtar içerikten: yeniden deneme ve eşzamanlı gönderim tek e-posta olur. Fatura bölümü son gönderimin
    // anını da taşır; yoksa aynı gün aynı sayıda, aynı tarihli yeni fatura gelince anahtar tutar, Resend 409 döner
    const keySeed = [
      ...g.fresh.map((f) => f.key),
      `inv:${sinceKey}:${invoices.items.length}:${invoices.items[0]?.date ?? ""}${invoices.priceHolds?.fresh ? `:h${invoices.priceHolds.fresh}` : ""}`,
      failedRunKey ?? "",
      prices ? `zam:${prices.changes.map((c) => `${c.name}:${c.after}`).join(",")}` : "",
      system.length ? `sys:${system.map((p) => p.key).join(",")}` : "",
      // Ek kutuların anahtarları yalnız varsa (yoksa tohum eskisiyle aynı)
      ...(g.extras.logKeys.length ? [`ek:${g.extras.logKeys.join(",")}`] : []),
      // Şubeye bağlı grubun e-postası ayrı ileti (bütün şubelerinkinin tohumu eskisiyle aynı)
      ...(g.branchIds.length ? [`sube:${g.branchIds.join(",")}`] : []),
    ].join("|");
    const res = await sendEmail(
      { from: resolveFrom(settings.from), to, subject, html, text, idempotencyKey: `digest-${today}-${createHash("sha256").update(keySeed).digest("hex").slice(0, 40)}` },
      ctx.sendDeadlineAt === undefined ? undefined : { deadlineAt: ctx.sendDeadlineAt },
    );
    if (!res.ok) {
      // Belirsiz gönderimde (zaman aşımı, ör. sabah işinin 48. saniyesi; ağ hatası; 409) ileti gitmiş olabilir: Son
      // gönderimler, bildirim ve Günlük işler bunu Türkçe söyler; ham hata yalnız sunucu günlüğünde
      error = sendFailureText(res);
      if (res.uncertain) console.error("Sabah e-postası gönderimi belirsiz:", res.error);
      await db
        .insert(s.notificationLog)
        .values({ key: `error:${today}:${Date.now()}`, subject, recipients: to.join(", "), ok: false, error })
        .onConflictDoNothing();
      continue;
    }
    const logRows = [
      ...g.fresh.map((f) => ({ key: f.key, subject, recipients: to.join(", "), ok: true })),
      ...(invoiceNews ? [{ key: `${INVOICE_LOG_PREFIX}${today}:${Date.now()}`, subject, recipients: to.join(", "), ok: true }] : []),
      ...(failedRunKey ? [{ key: failedRunKey, subject, recipients: to.join(", "), ok: true }] : []),
      ...(prices ? [{ key: `${PRICE_LOG_PREFIX}${today}:${Date.now()}`, subject, recipients: to.join(", "), ok: true }] : []),
      ...system.map((p) => ({ key: p.key, subject, recipients: to.join(", "), ok: true })),
      ...g.extras.logKeys.map((key) => ({ key, subject, recipients: to.join(", "), ok: true })),
    ];
    if (logRows.length) await db.insert(s.notificationLog).values(logRows).onConflictDoNothing();
    await logActivity(null, trigger === "cron" ? "Sabah e-postası (otomatik)" : "Sabah e-postası", `${subject} → ${to.length} adres${droppedLogSuffix(dropped)}`);
    recipients += to.length;
    for (const f of g.fresh) sentFresh.add(f.key);
    for (const b of g.extras.parts) boxes.add(b);
  }
  if (!recipients) {
    if (error) return { status: "error", error };
    if (!allDropped.length) return { status: "skipped", reason: "Etkin bildirim adresi yok.", off: "norecipient" };
    return { status: "skipped", reason: allDroppedSentence("Etkin bildirim adreslerinin", allDropped), off: "norecipient", blocked: droppedListText(allDropped) };
  }
  return {
    status: "sent",
    count: sentFresh.size,
    recipients,
    invoices: invoices.items.length,
    prices: prices?.changes.length ?? 0,
    syncError: Boolean(invoices.syncError),
    system: system.length,
    holds: invoices.priceHolds?.fresh ?? 0,
    ...(boxes.size ? { boxes: [...boxes] } : {}),
  };
}

/** Son gönderimler (ekrandaki günlük) */
export async function recentNotifications(limit = 12) {
  return getDb().select().from(s.notificationLog).orderBy(desc(s.notificationLog.sentAt)).limit(limit);
}

/** Deneme e-postası: kayıtlı gönderenle, etkin adreslere (personel ya da pasif hesabın adresi düşer; `skipped` onlar) */
export async function sendTestEmail(): Promise<{ ok: true; recipients: number; skipped: string | null } | { ok: false; error: string }> {
  const db = getDb();
  const settings = await loadNotifySettings();
  const { to, dropped } = await sendableRecipients(db, await activeDigestEmails(db));
  if (!to.length) return { ok: false, error: dropped.length ? allDroppedSentence("Etkin bildirim adreslerinin", dropped) : "Önce bir bildirim adresi ekleyin." };
  const today = todayTR();
  const sample: UpcomingItem = {
    ref: "test:0",
    source: "reminder",
    sourceId: 0,
    kind: "odeme",
    title: "Deneme hatırlatması",
    detail: "Bu ileti bildirim ayarlarını sınamak için gönderildi",
    amount: 1234,
    dueDate: today,
    daysLeft: 0,
    status: "today",
    remindDaysBefore: 0,
    repeat: "none",
  };
  const { html, text } = renderDigest([{ item: sample, stage: "due" }], today);
  const res = await sendEmail({ from: resolveFrom(settings.from), to, subject: "L'Affogato · deneme bildirimi", html, text });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, recipients: to.length, skipped: dropped.length ? droppedListText(dropped) : null };
}
