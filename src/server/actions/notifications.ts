"use server";

import { and, count, desc, eq, gt } from "drizzle-orm";

import { alerts, latestSalesMonth } from "@/lib/calc/insights";
import { priceAlert } from "@/lib/calc/price-impact";
import { dateTR, monthShort, tl } from "@/lib/format";
import { daysLeftLabel } from "@/lib/reminders";
import { getCurrentUser } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { loadPriceAlerts } from "@/server/data/price-alerts";
import { getDb, schema as s } from "@/server/db";
import { loadUpcoming } from "@/server/notify/digest";
import { countUnlinkedProducts } from "@/server/parasut/sync";

export interface PanelNotification {
  id: string;
  kind: "danger" | "warning" | "info";
  title: string;
  body: string;
  timeLabel: string;
  unread: boolean;
  href: string;
  /** Zilde hangi başlığın altında durur */
  group?: "odeme" | "fatura" | "uyari";
}

/** Faturalar: kontrol bekleyenler, son 24 saatte Paraşüt'ten gelenler, başarısız son eşitleme, bağlanmayı bekleyen ürünler */
async function invoiceNotifications(): Promise<PanelNotification[]> {
  const db = getDb();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [[review], [fresh], [lastRun], unlinked] = await Promise.all([
    db.select({ n: count() }).from(s.invoices).where(eq(s.invoices.needsReview, true)),
    db.select({ n: count() }).from(s.invoices).where(and(eq(s.invoices.origin, "parasut"), gt(s.invoices.createdAt, dayAgo))),
    db.select().from(s.parasutSyncRuns).orderBy(desc(s.parasutSyncRuns.startedAt)).limit(1),
    countUnlinkedProducts().catch(() => 0),
  ]);
  const out: PanelNotification[] = [];
  if (lastRun?.status === "error" && Date.now() - lastRun.startedAt.getTime() < 48 * 60 * 60 * 1000) {
    out.push({
      id: `fatura-eşitleme-${lastRun.id}`,
      kind: "danger",
      title: "Paraşüt eşitlemesi başarısız",
      body: (lastRun.message ?? "Bilinmeyen hata").slice(0, 200),
      timeLabel: dateTR(lastRun.startedAt.toISOString().slice(0, 10)),
      unread: true,
      href: "/panel/parasut",
      group: "fatura",
    });
  }
  if (fresh.n) {
    out.push({
      id: `fatura-yeni-${new Date().toISOString().slice(0, 10)}-${fresh.n}`,
      kind: "info",
      title: `Paraşüt'ten ${fresh.n} yeni fatura`,
      body: "Son 24 saatte eşitlemeyle geldi",
      timeLabel: "bugün",
      unread: true,
      href: "/panel/faturalar?kaynak=parasut",
      group: "fatura",
    });
  }
  if (review.n) {
    out.push({
      id: `fatura-kontrol-${review.n}`,
      kind: "warning",
      title: `${review.n} fatura kontrol bekliyor`,
      body: "Kategorisi tahminle yazıldı; doğruysa tek dokunuşla onaylayın",
      timeLabel: "",
      unread: true,
      href: "/panel/faturalar?durum=kontrol",
      group: "fatura",
    });
  }
  if (unlinked) {
    out.push({
      // Sayı değişince (yeni ürün geldi ya da bağlandı) yeniden okunmamış görünür
      id: `fatura-urun-${unlinked}`,
      kind: "info",
      title: `${unlinked} ürün hammaddeye bağlanmayı bekliyor`,
      body: "Faturalardaki ürünü bir kez bağlayın; alınan miktar ve fiyat sonraki faturalardan kendiliğinden gelir",
      timeLabel: "",
      unread: true,
      href: "/panel/parasut?durum=bekleyen",
      group: "fatura",
    });
  }
  return out;
}

/**
 * Kenar çubuğundaki zil: önce zamanı gelen ödemeler (gecikmiş, bugün, yakında), sonra son satış ayının
 * uyarıları (Genel bakış'taki "Dikkat edilmesi gerekenler" ile aynı kaynak). Kabuk açılınca bir kez istenir;
 * personel için boş döner.
 */
export async function loadPanelNotifications(): Promise<PanelNotification[]> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return [];
  const [model, upcoming, invoices] = await Promise.all([loadModel(), loadUpcoming().catch(() => null), invoiceNotifications().catch(() => [])]);

  const payments: PanelNotification[] = (upcoming?.items ?? [])
    .filter((i) => i.status !== "later")
    .slice(0, 8)
    .map((i) => ({
      id: `odeme-${i.ref}-${i.dueDate}`,
      kind: i.status === "overdue" ? "danger" : i.status === "today" ? "warning" : "info",
      title: `${i.title}${i.amount !== null ? ` · ${tl(i.amount)}` : ""}`,
      body: [`Son ödeme ${dateTR(i.dueDate)}`, i.detail].filter(Boolean).join(" · "),
      timeLabel: daysLeftLabel(i.daysLeft),
      unread: i.status !== "soon",
      href: "/panel/hatirlaticilar",
      group: "odeme" as const,
    }));

  const month = latestSalesMonth(model);
  const warnings: PanelNotification[] = month
    ? alerts(model, month).map((a) => ({
        // Kimlik metinden türer: aynı uyarı okundu kalır, sayısı değişen uyarı yeniden okunmamış olur
        id: `uyari-${month}-${a.title}`,
        kind: a.level,
        title: a.title,
        body: a.detail,
        timeLabel: monthShort(month),
        unread: a.level !== "info",
        href: a.href ?? "/panel",
        group: "uyari" as const,
      }))
    : [];
  // Hammadde zammı: kimlik ürün sayısı ve son zam tarihinden; yeni zam ya da yeni ürün gelince yeniden okunmamış olur
  const prices = await loadPriceAlerts(model).catch(() => null);
  const zam = prices ? priceAlert(prices.changes, prices.actionable) : null;
  const lastChange = prices?.changes.map((c) => c.changedAt.slice(0, 10)).sort().at(-1) ?? "";
  const priceNote: PanelNotification[] =
    zam && prices
      ? [
          {
            id: `uyari-zam-${prices.actionable.length}-${lastChange}`,
            kind: "warning",
            title: zam.title,
            body: zam.detail,
            timeLabel: lastChange ? dateTR(lastChange) : "",
            unread: true,
            href: zam.href,
            group: "uyari",
          },
        ]
      : [];
  return [...payments, ...invoices, ...priceNote, ...warnings];
}
