import "server-only";

import { createHash } from "node:crypto";

import { and, asc, count, desc, eq, gt, inArray, like, ne } from "drizzle-orm";

import { latestSalesMonth } from "@/lib/calc/insights";
import { priceLoss } from "@/lib/calc/price-loss";
import { upcomingWithCari } from "@/lib/cari/upcoming";
import { dateTR, tl } from "@/lib/format";
import { addDays, dueNotifications, todayTR, type UpcomingHint, type UpcomingItem } from "@/lib/reminders";
import { logActivity } from "@/server/actions/log";
import { loadModel } from "@/server/data/dataset";
import { loadPriceAlerts } from "@/server/data/price-alerts";
import { pendingHoldSummary } from "@/server/data/price-holds";
import { DEBT_INVOICE_WAIT_DAYS, loadCariIndex, type CariIndex } from "@/server/data/cari";
import { getDb, schema as s } from "@/server/db";
import { isProductionRuntime, loadEmailProblems } from "@/server/jobs/alerts";

import { loadDigestExtras } from "./digest-extras";
import { invoiceNewsOf, renderDigest, type DigestInvoices, type DigestPrices } from "./digest-template";
import { isEmailConfigured, resolveFrom, sendEmail, sendFailureText } from "./resend";
import { loadNotifySettings } from "./settings";

export { APP_URL, invoiceNewsOf, renderDigest } from "./digest-template";

/**
 * Etkin hatırlatıcılar, ödenmemiş faturalar ve tedarikçilerin faturasız borçlarından (cari) yaklaşan ödemeler.
 * Vadesiz faturanın tahmini vadesi tedarikçinin cari kartındaki vade gününden (Tedarikçiler; kart adla ve vergi noyla
 * bulunur), yoksa genel ayardan. Tedarikçinin hesabındaki sayılmamış ödeme okuma anında vade sırasıyla düşülür
 * (src/lib/cari/upcoming.ts; tamamen karşılananlar `covered`). Faturasız alımın faturası olabilecek fatura ve kasadan
 * ödenmiş olabilecek kalem sessizdir (ipucuyla; sabah e-postası hatırlatmaz). Zil her açılışta çağırır: faturalar tek
 * sorgu, cari hesap tek okuma (loadCariIndex; kayıt yokken kayıt sorguları boş döner).
 */
export async function loadUpcoming(today = todayTR()) {
  const db = getDb();
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
    db.select().from(s.reminders).orderBy(asc(s.reminders.dueDate)),
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
  const up = upcomingWithCari({ reminders, invoices, debts, credit: index.credit, hints, hrefOf: index.hrefOf }, today, opts);
  const items = up.items;
  // Takvim için: vadesi listenin ufkundan sonra olan faturalar ve faturasız borçlar (listede ve e-postada yer almaz)
  const laterInvoices: UpcomingItem[] = up.later;
  return { today, settings, reminders, items, laterInvoices, covered: up.covered, cari: cariSummary(index, today) };
}

/** Kalemlerin ipuçları: faturasız alımın faturası olabilir (güçlü aday, K17) ve kasadan ödenmiş olabilir (K16) */
function cariHints(
  index: CariIndex,
  invoices: readonly { id: number; date: string; invoiceNo: string | null; cardId: number | null }[],
  debts: readonly { id: number; date: string; cardId: number }[],
): Map<string, { quiet: "link" | "kasa"; hint: UpcomingHint }> {
  const out = new Map<string, { quiet: "link" | "kasa"; hint: UpcomingHint }>();
  if (!index.strong.length && !index.kasaPending.length) return out;
  for (const c of index.strong) {
    const href = index.hrefOf(c.cardId);
    if (!href || out.has(`invoice:${c.invoiceId}`)) continue;
    const what = c.debts.map((d) => `${dateTR(d.date).slice(0, 5)} · ${d.description?.trim() || "alım"}`);
    out.set(`invoice:${c.invoiceId}`, {
      quiet: "link",
      hint: { kind: "link", text: `Faturasız alımın faturası olabilir${what.length ? ` (${what.join(", ")})` : ""}`, href: `${href}?bagla=${c.invoiceId}`, invoiceId: c.invoiceId, debtIds: c.debtIds },
    });
  }
  if (!index.kasaPending.length) return out;
  const items = [
    ...invoices.flatMap((i) => (i.cardId !== null ? [{ ref: `invoice:${i.id}`, date: i.date, cardId: i.cardId }] : [])),
    ...debts.map((d) => ({ ref: `cari:${d.id}`, date: d.date, cardId: d.cardId })),
  ];
  for (const it of items) {
    if (out.has(it.ref)) continue;
    // Kalemin gününden (aynı gün dahil: teslimatta şoföre ödenen) sonraki, en eski işlenmemiş satır
    const line = index.kasaPending.find((l) => l.cardId === it.cardId && l.date >= it.date);
    const href = line ? index.hrefOf(it.cardId) : undefined;
    if (!line || !href) continue;
    out.set(it.ref, {
      quiet: "kasa",
      hint: {
        kind: "kasa",
        text: `Kasadan ödenmiş olabilir: ${dateTR(line.date).slice(0, 5)} ${line.kind === "teslim" ? "Teslim" : "Alışveriş"} · ${line.store ?? ""} ${tl(line.amount, 2)}`,
        href: `${href}?kasa=${line.id}`,
        cashOutId: line.id,
      },
    });
  }
  return out;
}

/** Ödemeler, zil ve Genel bakış için cari hesabın özeti: açık faturasız borçlar, hesaptaki para, işlenmemiş Kasa satırları, uyarılar */
function cariSummary(index: CariIndex, today: string) {
  const lateFrom = addDays(today, -DEBT_INVOICE_WAIT_DAYS);
  const cardName = (id: number) => index.cards.get(id)?.name ?? "";
  const late = index.openDebts
    .filter((d) => d.costMode === "fatura" && d.date <= lateFrom && (!d.remindAfter || d.remindAfter <= today))
    .map((d) => ({ id: d.id, cardId: d.supplierId, name: cardName(d.supplierId), date: d.date, description: d.description, amount: d.remaining, href: index.hrefOf(d.supplierId) ?? null }));
  const strong = index.strong.map((c) => ({ cardId: c.cardId, name: cardName(c.cardId), invoiceId: c.invoiceId, debtIds: c.debtIds, href: index.hrefOf(c.cardId) ?? null }));
  return {
    debts: index.openDebts.length,
    debtTotal: Math.round(index.openDebts.reduce((a, d) => a + d.remaining, 0) * 100) / 100,
    credit: Math.round([...index.credit.values()].reduce((a, v) => a + v, 0) * 100) / 100,
    kasaPending: { count: index.kasaPending.length, total: Math.round(index.kasaPending.reduce((a, l) => a + l.amount, 0) * 100) / 100 },
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
   */
  | { status: "skipped"; reason: string; off?: "disabled" | "nokey" | "norecipient" }
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
  const [rows, [{ n }], [lastRun], holds] = await Promise.all([
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
  return { invoices: { items: rows, reviewCount: n, syncError, priceHolds }, failedRunKey, sinceKey: lastSent?.at?.toISOString() ?? "" };
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
 */
export async function runReminderDigest(trigger: "cron" | "manual", ctx: { syncedToday?: boolean; sendDeadlineAt?: number } = {}): Promise<DigestResult> {
  const db = getDb();
  const { today, settings, items } = await loadUpcoming();
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
  if (!fresh.length && !invoiceNews && !prices && !system.length && !extras.news) {
    return {
      status: "skipped",
      reason: due.length ? "Bugünkü hatırlatmalar zaten gönderildi; yeni fatura ya da zam yok." : "Bugün haber verilecek bir ödeme, yeni fatura ya da zam yok.",
    };
  }

  const recipients = await db.select().from(s.notificationRecipients).where(eq(s.notificationRecipients.active, true));
  if (!recipients.length) return { status: "skipped", reason: "Etkin bildirim adresi yok.", off: "norecipient" };

  const { subject, html, text } = renderDigest(
    fresh,
    today,
    invoiceNews || invoices.reviewCount || invoices.priceHolds ? invoices : null,
    prices,
    system.length ? { items: system } : null,
    extras.extras,
  );
  const to = recipients.map((r) => r.email);
  // Tekil anahtar içerikten: yeniden deneme ve eşzamanlı gönderim tek e-posta olur. Fatura bölümü son gönderimin
  // anını da taşır; yoksa aynı gün aynı sayıda, aynı tarihli yeni fatura gelince anahtar tutar, Resend 409 döner
  const keySeed = [
    ...fresh.map((f) => f.key),
    `inv:${sinceKey}:${invoices.items.length}:${invoices.items[0]?.date ?? ""}${invoices.priceHolds?.fresh ? `:h${invoices.priceHolds.fresh}` : ""}`,
    failedRunKey ?? "",
    prices ? `zam:${prices.changes.map((c) => `${c.name}:${c.after}`).join(",")}` : "",
    system.length ? `sys:${system.map((p) => p.key).join(",")}` : "",
    // Ek kutuların anahtarları yalnız varsa (yoksa tohum eskisiyle aynı)
    ...(extras.logKeys.length ? [`ek:${extras.logKeys.join(",")}`] : []),
  ].join("|");
  const res = await sendEmail(
    { from: resolveFrom(settings.from), to, subject, html, text, idempotencyKey: `digest-${today}-${createHash("sha256").update(keySeed).digest("hex").slice(0, 40)}` },
    ctx.sendDeadlineAt === undefined ? undefined : { deadlineAt: ctx.sendDeadlineAt },
  );
  if (!res.ok) {
    // Belirsiz gönderimde (zaman aşımı, ör. sabah işinin 48. saniyesi; ağ hatası; 409) ileti gitmiş olabilir: Son
    // gönderimler, bildirim ve Günlük işler bunu Türkçe söyler; ham hata yalnız sunucu günlüğünde
    const error = sendFailureText(res);
    if (res.uncertain) console.error("Sabah e-postası gönderimi belirsiz:", res.error);
    await db
      .insert(s.notificationLog)
      .values({ key: `error:${today}:${Date.now()}`, subject, recipients: to.join(", "), ok: false, error })
      .onConflictDoNothing();
    return { status: "error", error };
  }
  const logRows = [
    ...fresh.map((f) => ({ key: f.key, subject, recipients: to.join(", "), ok: true })),
    ...(invoiceNews ? [{ key: `${INVOICE_LOG_PREFIX}${today}:${Date.now()}`, subject, recipients: to.join(", "), ok: true }] : []),
    ...(failedRunKey ? [{ key: failedRunKey, subject, recipients: to.join(", "), ok: true }] : []),
    ...(prices ? [{ key: `${PRICE_LOG_PREFIX}${today}:${Date.now()}`, subject, recipients: to.join(", "), ok: true }] : []),
    ...system.map((p) => ({ key: p.key, subject, recipients: to.join(", "), ok: true })),
    ...extras.logKeys.map((key) => ({ key, subject, recipients: to.join(", "), ok: true })),
  ];
  if (logRows.length) await db.insert(s.notificationLog).values(logRows).onConflictDoNothing();
  await logActivity(null, trigger === "cron" ? "Sabah e-postası (otomatik)" : "Sabah e-postası", `${subject} → ${to.length} adres`);
  return {
    status: "sent",
    count: fresh.length,
    recipients: to.length,
    invoices: invoices.items.length,
    prices: prices?.changes.length ?? 0,
    syncError: Boolean(invoices.syncError),
    system: system.length,
    holds: invoices.priceHolds?.fresh ?? 0,
    ...(extras.parts.length ? { boxes: extras.parts } : {}),
  };
}

/** Son gönderimler (ekrandaki günlük) */
export async function recentNotifications(limit = 12) {
  return getDb().select().from(s.notificationLog).orderBy(desc(s.notificationLog.sentAt)).limit(limit);
}

/** Deneme e-postası: kayıtlı gönderenle, etkin adreslere */
export async function sendTestEmail(): Promise<{ ok: true; recipients: number } | { ok: false; error: string }> {
  const db = getDb();
  const settings = await loadNotifySettings();
  const recipients = await db.select().from(s.notificationRecipients).where(and(eq(s.notificationRecipients.active, true)));
  if (!recipients.length) return { ok: false, error: "Önce bir bildirim adresi ekleyin." };
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
  const res = await sendEmail({ from: resolveFrom(settings.from), to: recipients.map((r) => r.email), subject: "L'Affogato · deneme bildirimi", html, text });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, recipients: recipients.length };
}
