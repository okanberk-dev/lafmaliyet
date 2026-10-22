import "server-only";

import { createHash } from "node:crypto";

import { and, asc, count, desc, eq, gt, inArray, like, ne } from "drizzle-orm";

import { dueNotifications, laterInvoiceItems, todayTR, upcomingItems, type UpcomingItem } from "@/lib/reminders";
import { logActivity } from "@/server/actions/log";
import { loadModel } from "@/server/data/dataset";
import { loadPriceAlerts } from "@/server/data/price-alerts";
import { loadTermDays } from "@/server/data/suppliers";
import { getDb, schema as s } from "@/server/db";
import { isProductionRuntime, loadEmailProblems } from "@/server/jobs/alerts";

import { renderDigest, type DigestInvoices, type DigestPrices } from "./digest-template";
import { isEmailConfigured, resolveFrom, sendEmail } from "./resend";
import { loadNotifySettings } from "./settings";

export { APP_URL, renderDigest } from "./digest-template";

/**
 * Etkin hatırlatıcılar + ödenmemiş faturalardan yaklaşan ödemeler. Vadesiz faturanın tahmini vadesi tedarikçinin
 * cari kartındaki vade gününden (Tedarikçiler), yoksa genel ayardan.
 */
export async function loadUpcoming(today = todayTR()) {
  const db = getDb();
  const [settings, reminders, rows, termDays] = await Promise.all([
    loadNotifySettings(),
    db.select().from(s.reminders).orderBy(asc(s.reminders.dueDate)),
    db
      .select({
        id: s.invoices.id,
        supplier: s.invoices.supplier,
        invoiceNo: s.invoices.invoiceNo,
        date: s.invoices.date,
        dueDate: s.invoices.dueDate,
        payable: s.invoices.payable,
        outstanding: s.invoices.outstanding,
      })
      .from(s.invoices)
      .where(eq(s.invoices.unpaid, true)),
    loadTermDays(),
  ]);
  const invoices = rows.map((i) => ({ ...i, termDays: i.dueDate ? null : termDays(i.supplier) }));
  const opts = { invoiceDaysBefore: settings.invoiceDaysBefore, invoiceTermDays: settings.invoiceTermDays };
  const items = upcomingItems(reminders, invoices, today, opts);
  // Takvim için: vadesi listenin ufkundan sonra olan faturalar (listede ve e-postada yer almaz)
  const laterInvoices: UpcomingItem[] = laterInvoiceItems(invoices, today, opts);
  return { today, settings, reminders, items, laterInvoices };
}

export type DigestResult =
  | { status: "sent"; count: number; recipients: number; invoices?: number; prices?: number; syncError?: boolean; system?: number }
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
 * kontrol bekleyenlerin sayısı ve (henüz bildirilmediyse) başarısız son eşitleme. `sinceKey` son Paraşüt bölümlü
 * gönderimin anıdır (hiç yoksa ""): aynı gün ikinci gönderimin Resend tekil anahtarı buna göre değişir.
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
  const [rows, [{ n }], [lastRun]] = await Promise.all([
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
  ]);
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
  return { invoices: { items: rows, reviewCount: n, syncError }, failedRunKey, sinceKey: lastSent?.at?.toISOString() ?? "" };
}

/** Zam bölümünün anahtarı: her gönderimde yeni satır; yalnız son zam e-postasından sonraki zamlar yeni sayılır */
const PRICE_LOG_PREFIX = "prices:";

/**
 * Sabah e-postasının zam bölümü: son zam bölümlü e-postadan (yoksa son 24 saatten) bu yana fiyatı artan
 * hammaddeler ve fiyatı hedefin altında kalan ürünler. Yeni zam yoksa null (her sabah aynı zam yinelenmez).
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
  const pa = await loadPriceAlerts(await loadModel());
  const fresh = pa.changes.filter((c) => c.pct > 0 && c.changedAt > since);
  if (!fresh.length) return null;
  return {
    changes: fresh.map((c) => ({ name: c.name, unit: c.unit, before: c.before, after: c.after, pct: c.pct })),
    products: pa.actionable.map((p) => ({ name: p.name, size: p.size, price: p.price, suggestedPrice: p.suggestedPrice, basis: p.basis, ratioBefore: p.ratioBefore, ratioAfter: p.ratioAfter })),
    productCount: pa.actionable.length,
  };
}

/**
 * Günlük sabah e-postası: bugün haber verilmesi gereken ve daha önce gitmemiş ödemeler, Paraşüt'ten gelen yeni
 * faturalar, kontrol bekleyenler, eşitleme hatası, yeni hammadde zamları ve (canlıda) günlük işlerin sorunları
 * (dünkü sabah işi, bu sabahki Paraşüt işi) tek iletide. Hiçbiri yoksa e-posta gitmez. `syncedToday`: sabah işi
 * bugün Paraşüt eşitlemesinin yapıldığını biliyorsa (verilmezse sorulur).
 */
export async function runReminderDigest(trigger: "cron" | "manual", ctx: { syncedToday?: boolean } = {}): Promise<DigestResult> {
  const db = getDb();
  const { today, settings, items } = await loadUpcoming();
  if (!settings.emailEnabled) return { status: "skipped", reason: "Hatırlatma e-postaları kapalı.", off: "disabled" };
  if (!isEmailConfigured()) return { status: "skipped", reason: "RESEND_API_KEY tanımlı değil.", off: "nokey" };

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
  // Kontrol bekleyen sayısı tek başına her gün e-posta göndermez; yeni fatura ya da hata varsa bölümde yer alır
  const invoiceNews = invoices.items.length > 0 || Boolean(invoices.syncError);
  if (!fresh.length && !invoiceNews && !prices && !system.length) {
    return {
      status: "skipped",
      reason: due.length ? "Bugünkü hatırlatmalar zaten gönderildi; yeni fatura ya da zam yok." : "Bugün haber verilecek bir ödeme, yeni fatura ya da zam yok.",
    };
  }

  const recipients = await db.select().from(s.notificationRecipients).where(eq(s.notificationRecipients.active, true));
  if (!recipients.length) return { status: "skipped", reason: "Etkin bildirim adresi yok.", off: "norecipient" };

  const { subject, html, text } = renderDigest(fresh, today, invoiceNews || invoices.reviewCount ? invoices : null, prices, system.length ? { items: system } : null);
  const to = recipients.map((r) => r.email);
  // Tekil anahtar içerikten: yeniden deneme ve eşzamanlı gönderim tek e-posta olur. Fatura bölümü son gönderimin
  // anını da taşır; yoksa aynı gün aynı sayıda, aynı tarihli yeni fatura gelince anahtar tutar, Resend 409 döner
  const keySeed = [
    ...fresh.map((f) => f.key),
    `inv:${sinceKey}:${invoices.items.length}:${invoices.items[0]?.date ?? ""}`,
    failedRunKey ?? "",
    prices ? `zam:${prices.changes.map((c) => `${c.name}:${c.after}`).join(",")}` : "",
    system.length ? `sys:${system.map((p) => p.key).join(",")}` : "",
  ].join("|");
  const res = await sendEmail({ from: resolveFrom(settings.from), to, subject, html, text, idempotencyKey: `digest-${today}-${createHash("sha256").update(keySeed).digest("hex").slice(0, 40)}` });
  if (!res.ok) {
    await db
      .insert(s.notificationLog)
      .values({ key: `error:${today}:${Date.now()}`, subject, recipients: to.join(", "), ok: false, error: res.error })
      .onConflictDoNothing();
    return { status: "error", error: res.error };
  }
  const logRows = [
    ...fresh.map((f) => ({ key: f.key, subject, recipients: to.join(", "), ok: true })),
    ...(invoiceNews ? [{ key: `${INVOICE_LOG_PREFIX}${today}:${Date.now()}`, subject, recipients: to.join(", "), ok: true }] : []),
    ...(failedRunKey ? [{ key: failedRunKey, subject, recipients: to.join(", "), ok: true }] : []),
    ...(prices ? [{ key: `${PRICE_LOG_PREFIX}${today}:${Date.now()}`, subject, recipients: to.join(", "), ok: true }] : []),
    ...system.map((p) => ({ key: p.key, subject, recipients: to.join(", "), ok: true })),
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
