"use server";

import { and, count, desc, eq, gt, ne } from "drizzle-orm";

import { alerts, latestSalesMonth } from "@/lib/calc/insights";
import { priceAlert } from "@/lib/calc/price-impact";
import { businessDate, diffKind, diffText } from "@/lib/cash-report";
import { SIZE_LABELS } from "@/lib/constants";
import { unpricedNotice } from "@/lib/count-item";
import { dateTR, monthShort, tl } from "@/lib/format";
import { groupNewProposals, REQUEST_STATUS_LABEL } from "@/lib/recipe-change";
import { addDays, daysLeftLabel, longDateTR, todayTR } from "@/lib/reminders";
import { dueGroup, whenLabel } from "@/lib/user-reminders";
import { getCurrentUser, type CurrentUser } from "@/server/auth/dal";
import { cashReportsBetween } from "@/server/data/cash-reports";
import { loadModel } from "@/server/data/dataset";
import { loadPriceAlerts } from "@/server/data/price-alerts";
import { countPendingRequests, loadMyRequests, loadReviewQueue } from "@/server/data/recipe-requests";
import { loadUnpricedIngredients } from "@/server/data/unpriced";
import { loadDueReminders } from "@/server/data/user-reminders";
import { getDb, schema as s } from "@/server/db";
import { loadSystemAlerts } from "@/server/jobs/alerts";
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
  group?: "sistem" | "hatirlatici" | "onay" | "kasa" | "odeme" | "fatura" | "uyari";
}

/**
 * Günlük işlerin sorunları (yalnız canlıda; src/lib/job-health.ts): sabah işi ya da Paraşüt işi çalışmadı, hata
 * verdi, yarıda kesildi; CRON_SECRET yok. Kimlik çalışmadan (ya da günden) türer: sorun düzelip yeniden çıkarsa yeni
 * bildirim sayılır. Son yedek 30 günden eskiyse yedek hatırlatması da burada (bilgi; kimliği son yedeğin gününden).
 */
async function systemNotifications(): Promise<PanelNotification[]> {
  const today = todayTR();
  return (await loadSystemAlerts()).map((a) => ({
    id: a.id,
    kind: a.level,
    title: a.title,
    body: a.body,
    timeLabel: !a.day ? "" : a.day === today ? "Bugün" : a.day === addDays(today, -1) ? "Dün" : dateTR(a.day),
    unread: true,
    href: a.href,
    group: "sistem" as const,
  }));
}

/**
 * Gün sonu kasa raporu: personele akşam (20:00'den sonra) bugünün raporu girilmediyse hatırlatma; yöneticiye dünün
 * raporu girilmediyse ve son raporda kasa farkı varsa (eksik kırmızı, fazla turuncu).
 */
async function cashNotifications(user: CurrentUser): Promise<PanelNotification[]> {
  const now = new Date();
  const day = businessDate(now);
  const reports = await cashReportsBetween(addDays(day, -6), day);
  if (user.role !== "admin") {
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", hourCycle: "h23" }).format(now));
    if ((hour >= 5 && hour < 20) || reports.some((r) => r.date === day)) return [];
    return [
      {
        id: `kasa-bekliyor-${day}`,
        kind: "warning",
        title: "Bugünün kasa raporu bekliyor",
        body: "Kapanışta ModPOS'un Z raporunu ve kasayı girin",
        timeLabel: "Bugün",
        unread: true,
        href: "/panel/kasa",
        group: "kasa",
      },
    ];
  }
  const out: PanelNotification[] = [];
  const yesterday = addDays(day, -1);
  if (!reports.some((r) => r.date === yesterday)) {
    out.push({
      id: `kasa-yok-${yesterday}`,
      kind: "warning",
      title: "Dünkü kasa raporu girilmedi",
      body: longDateTR(yesterday),
      timeLabel: "Dün",
      unread: true,
      href: `/panel/kasa?gun=${yesterday}`,
      group: "kasa",
    });
  }
  const last = reports[0];
  if (last && diffKind(last.cashDiff) !== "even") {
    out.push({
      // Rapor güncellenince yeniden okunmamış olur
      id: `kasa-fark-${last.date}-r${last.revision}`,
      kind: last.cashDiff < 0 ? "danger" : "warning",
      title: `Kasa: ${diffText(last.cashDiff)}`,
      body: [longDateTR(last.date), last.submittedByName, last.note].filter(Boolean).join(" · "),
      timeLabel: dateTR(last.date),
      unread: true,
      href: `/panel/kasa?gun=${last.date}`,
      group: "kasa",
    });
  }
  return out;
}

/** Kişinin gecikmiş ve bugünkü (saati gelmiş ya da gelecek) hatırlatıcıları */
async function reminderNotifications(user: CurrentUser): Promise<PanelNotification[]> {
  const now = new Date();
  return (await loadDueReminders(user.id))
    .map((r) => ({ r, group: dueGroup(r, now) }))
    .filter((x) => x.group === "overdue" || x.group === "today")
    .slice(0, 8)
    .map(({ r, group }) => ({
      // Tarih / saat değişince (tamamlandı, ertelendi) yeniden okunmamış olur
      id: `hatirlatici-${r.id}-${r.dueDate}-${r.dueTime ?? ""}`,
      kind: group === "overdue" ? "warning" : "info",
      title: r.title,
      body: r.note ?? (group === "overdue" ? "Zamanı geçti" : "Bugün"),
      timeLabel: whenLabel(r, now),
      unread: group === "overdue",
      href: "/panel/hatirlaticilarim",
      group: "hatirlatici" as const,
    }));
}

/**
 * Yönetici: onay bekleyen reçete değişiklikleri (tek satır) ve yeni ürün önerileri (ad ve öneren başına bir satır);
 * personel: son bir haftada sonuçlanan önerileri
 */
async function recipeNotifications(user: CurrentUser): Promise<PanelNotification[]> {
  if (user.role === "admin") {
    const n = await countPendingRequests();
    if (!n) return [];
    const { pending } = await loadReviewQueue(0);
    const changes = pending.filter((r) => r.kind === "change");
    const out: PanelNotification[] = [];
    if (changes.length) {
      const names = [...new Set(changes.map((r) => r.productName))].slice(0, 3).join(", ");
      out.push({
        id: `onay-${changes.length}-${changes.at(-1)?.updatedAt.toISOString() ?? ""}`,
        kind: "warning",
        title: `${changes.length} reçete değişikliği onay bekliyor`,
        body: `Personel önerdi: ${names}${changes.length > 3 ? "…" : ""}`,
        timeLabel: "",
        unread: true,
        href: "/panel/onaylar",
        group: "onay",
      });
    }
    const proposals = groupNewProposals(
      pending.filter((r) => r.kind === "new").map((r) => ({ id: r.id, name: r.productName, size: r.size, by: r.requestedByName, message: r.message })),
    );
    for (const g of proposals) {
      out.push({
        id: `onay-yeni-${g.ids.join("-")}`,
        kind: "warning",
        title: g.title,
        body: g.message ? `Not: ${g.message}` : "Satış fiyatını yazıp onaylayın",
        timeLabel: "",
        unread: true,
        href: `/panel/onaylar#oneri-${g.ids[0]}`,
        group: "onay",
      });
    }
    return out;
  }
  return (await loadMyRequests(user.id, 7))
    .filter((r) => r.status === "approved" || r.status === "rejected")
    .slice(0, 5)
    .map((r): PanelNotification => {
      const label = `${r.productName} · ${SIZE_LABELS[r.size]}`;
      const common = {
        id: `oneri-${r.id}-${r.status}`,
        kind: r.status === "approved" ? ("info" as const) : ("warning" as const),
        timeLabel: r.reviewedAt ? dateTR(r.reviewedAt.toISOString().slice(0, 10)) : "",
        unread: true,
        group: "onay" as const,
      };
      if (r.kind === "new")
        return {
          ...common,
          title: r.status === "approved" ? `${label} eklendi` : `${label} önerisi reddedildi`,
          body: r.reviewNote ? `Yönetici: ${r.reviewNote}` : r.status === "approved" ? "Reçete defterinde" : "Ürün eklenmedi",
          href: r.status === "approved" ? `/panel/receteler?ara=${encodeURIComponent(r.productName)}` : "/panel/receteler#onerilerim",
        };
      return {
        ...common,
        title: `${label}: ${REQUEST_STATUS_LABEL[r.status].toLocaleLowerCase("tr-TR")}`,
        body: r.reviewNote ? `Yönetici: ${r.reviewNote}` : r.status === "approved" ? "Reçete kartı güncellendi" : "Reçete değişmedi",
        href: "/panel/receteler#onerilerim",
      };
    });
}

/**
 * Fiyatı girilmemiş hammaddeler (çoğu sayımda "Listeye ekle" ile eklenen kalem; paket fiyatı 0): yönetici
 * Hammaddeler'in "Fiyat yok" süzgecinde fiyatını girer. Kimlik sayı ve en yeni kalemden: yeni kalem gelince yeniden
 * okunmamış olur.
 */
async function unpricedNotifications(): Promise<PanelNotification[]> {
  const u = await loadUnpricedIngredients();
  if (!u.count) return [];
  const text = unpricedNotice(u.count, u.names);
  return [
    {
      id: `uyari-fiyatsiz-${u.count}-${u.newestId}`,
      kind: "warning",
      title: text.title,
      body: text.body,
      timeLabel: "",
      unread: true,
      href: "/panel/hammaddeler?durum=fiyatsiz",
      group: "uyari",
    },
  ];
}

/** Faturalar: kontrol bekleyenler, son 24 saatte Paraşüt'ten gelenler, başarısız son eşitleme, bağlanmayı bekleyen ürünler */
async function invoiceNotifications(): Promise<PanelNotification[]> {
  const db = getDb();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [[review], [fresh], [lastRun], unlinked] = await Promise.all([
    db.select({ n: count() }).from(s.invoices).where(eq(s.invoices.needsReview, true)),
    db.select({ n: count() }).from(s.invoices).where(and(eq(s.invoices.origin, "parasut"), gt(s.invoices.createdAt, dayAgo))),
    // Tedarikçi geçmişi (tek tedarikçi, elle) günlük eşitlemenin sağlığına sayılmaz
    db.select().from(s.parasutSyncRuns).where(ne(s.parasutSyncRuns.trigger, "history")).orderBy(desc(s.parasutSyncRuns.startedAt)).limit(1),
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
 * Kenar çubuğundaki zil: (yalnız yönetici) önce günlük işlerin sorunları, sonra kişinin hatırlatıcıları ve reçete
 * onayları, sonra (yalnız yönetici) zamanı gelen ödemeler (gecikmiş, bugün, yakında), faturalar, fiyatı girilmemiş
 * hammaddeler ve son satış ayının uyarıları (Genel bakış'taki "Dikkat edilmesi gerekenler" ile aynı kaynak). Kabuk
 * açılınca bir kez istenir. Personel yalnız kendi hatırlatıcılarını ve önerilerinin sonucunu görür; maliyet, ödeme,
 * fatura ve sistem bilgisi ona gitmez.
 */
export async function loadPanelNotifications(): Promise<PanelNotification[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const [mine, recipes, cash] = await Promise.all([
    reminderNotifications(user).catch(() => []),
    recipeNotifications(user).catch(() => []),
    cashNotifications(user).catch(() => []),
  ]);
  if (user.role !== "admin") return [...cash, ...mine, ...recipes];
  const [model, upcoming, invoices, system, unpriced] = await Promise.all([
    loadModel(),
    loadUpcoming().catch(() => null),
    invoiceNotifications().catch(() => []),
    systemNotifications().catch(() => []),
    unpricedNotifications().catch(() => []),
  ]);

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
  return [...system, ...mine, ...recipes, ...cash, ...payments, ...invoices, ...priceNote, ...unpriced, ...warnings];
}
