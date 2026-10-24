"use server";

import { and, count, desc, eq, gt, ne } from "drizzle-orm";

import { alerts, latestSalesMonth } from "@/lib/calc/insights";
import { priceAlert } from "@/lib/calc/price-impact";
import { businessDate, carryChecks, carryDiffText, changesText, diffKind, diffText, isCashEvening, lateCorrections } from "@/lib/cash-report";
import { checklistBell } from "@/lib/checklists";
import { SIZE_LABELS } from "@/lib/constants";
import { unpricedNotice } from "@/lib/count-item";
import { dateTR, money, monthShort, tl } from "@/lib/format";
import { holdsSummary, HOLDS_HREF } from "@/lib/price-hold";
import { agoLabel } from "@/lib/prices/pos";
import { groupNewProposals, REQUEST_STATUS_LABEL } from "@/lib/recipe-change";
import { addDays, daysLeftLabel, longDateTR, todayTR } from "@/lib/reminders";
import { dueGroup, whenLabel } from "@/lib/user-reminders";
import { getCurrentUser, type CurrentUser } from "@/server/auth/dal";
import { cashReportsBetween, cashRevisionsFor, previousCarryOver } from "@/server/data/cash-reports";
import { loadChecklistDays } from "@/server/data/checklists";
import { loadCommissionAlerts } from "@/server/data/commission";
import { loadModel } from "@/server/data/dataset";
import { loadPriceAlerts } from "@/server/data/price-alerts";
import { pendingHoldSummary } from "@/server/data/price-holds";
import { posPendingSummary } from "@/server/data/prices";
import { countPendingRequests, loadMyRequests, loadReviewQueue } from "@/server/data/recipe-requests";
import { reorderNotifications } from "@/server/data/reorder";
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
  group?: "sistem" | "hatirlatici" | "onay" | "kasa" | "kontrol" | "odeme" | "fatura" | "uyari";
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
 * raporu girilmediyse, son raporda kasa farkı varsa (eksik kırmızı, fazla turuncu), açılış devirle tutmuyorsa ve rapor
 * ertesi gün kasa alanı değiştirilerek düzeltildiyse.
 */
async function cashNotifications(user: CurrentUser): Promise<PanelNotification[]> {
  const now = new Date();
  const day = businessDate(now);
  const reports = await cashReportsBetween(addDays(day, -6), day);
  if (user.role !== "admin") {
    if (!isCashEvening(now) || reports.some((r) => r.date === day)) return [];
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
  // Bütünlük uyarıları ayrı: okunamazsa yukarıdaki kasa bildirimleri yine görünür
  out.push(...(await cashIntegrityNotifications(reports, day, user.id).catch(() => [])));
  return out;
}

/**
 * Yönetici: kasanın bütünlüğü (docs/KASA-RAPORU.md › Açılış ve devir, Düzeltmeler). Bugünün ve dünün raporunda açılış
 * önceki devirle tutmuyorsa (kimlik raporun sürümünden: yeniden gönderilince yeniden okunmamış olur); son 7 günün bir
 * raporu iş günü kapandıktan sonra kasa alanı değiştirilerek düzeltildiyse (src/lib/cash-report.ts lateCorrections:
 * bütün geç düzeltmeler, bakan yöneticinin kendileri hariç; kimlik en yeni geç düzeltmeden). İki küçük sorgu.
 */
async function cashIntegrityNotifications(reports: Awaited<ReturnType<typeof cashReportsBetween>>, day: string, viewer: number): Promise<PanelNotification[]> {
  if (!reports.length) return [];
  const oldest = reports[reports.length - 1];
  const [before, revisions] = await Promise.all([previousCarryOver(oldest.date), cashRevisionsFor(reports.filter((r) => r.revision > 1).map((r) => r.id))]);
  const checks = carryChecks(reports, before);
  const yesterday = addDays(day, -1);
  const timeLabel = (date: string) => (date === day ? "Bugün" : date === yesterday ? "Dün" : dateTR(date));
  const out: PanelNotification[] = [];
  for (const r of reports) {
    const c = checks.get(r.date);
    if (!c || (r.date !== day && r.date !== yesterday)) continue;
    out.push({
      id: `kasa-acilis-${r.date}-r${r.revision}`,
      kind: "warning",
      title: "Kasa açılışı devirle tutmuyor",
      body: [`${longDateTR(r.date)} · açılış ${money(c.opening)}, önceki devir ${money(c.carry)} (${carryDiffText(c)})`, r.note].filter(Boolean).join(" · "),
      timeLabel: timeLabel(r.date),
      unread: true,
      href: `/panel/kasa?gun=${r.date}`,
      group: "kasa",
    });
  }
  for (const r of reports) {
    const late = r.revision > 1 ? lateCorrections(r, revisions.filter((x) => x.reportId === r.id), viewer) : null;
    if (!late) continue;
    out.push({
      id: `kasa-duzeltme-${r.date}-r${late.revision}`,
      kind: "warning",
      title: "Kasa raporu ertesi gün değişti",
      body: [longDateTR(r.date), late.by.join(", "), changesText(late.changes)].join(" · "),
      timeLabel: timeLabel(r.date),
      unread: true,
      href: `/panel/kasa?gun=${r.date}`,
      group: "kasa",
    });
  }
  return out;
}

/**
 * Kontrol listeleri (docs/KONTROL-LISTELERI.md): yöneticiye bugün son saati geçen liste, dün tamamlanmayan liste ve
 * bugünün ve dünün açık sorunları (aralık dışı ölçüm, "Sorun var"); personele yalnız bugün, aralığı açılan ve kendi
 * doldurabildiği liste ("bekliyor", son saat geçince "gecikti"). Metinler src/lib/checklists.ts checklistBell'de; iki
 * gün birlikte okunur (şablon, madde, kayıt, yanıt: dört küçük sorgu), maliyet modeli yok.
 */
async function checklistNotifications(user: CurrentUser): Promise<PanelNotification[]> {
  const now = new Date();
  const day = businessDate(now);
  const yesterday = addDays(day, -1);
  const admin = user.role === "admin";
  const lists = await loadChecklistDays(admin ? [day, yesterday] : [day], user.role, now);
  return checklistBell({
    role: user.role,
    now,
    today: { day, lists: lists.get(day) ?? [] },
    yesterday: admin ? { day: yesterday, lists: lists.get(yesterday) ?? [] } : null,
  }).map((b) => ({ ...b, group: "kontrol" as const }));
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
    // Gövde: personelin önerdiği fiyat ve notu ("Önerilen fiyat: Medium 165 ₺ · Not: …"), ikisi de yoksa ne yapılacağı
    const proposals = groupNewProposals(
      pending
        .filter((r) => r.kind === "new")
        .map((r) => ({ id: r.id, name: r.productName, size: r.size, by: r.requestedByName, message: r.message, price: r.proposedPrice })),
    );
    for (const g of proposals) {
      out.push({
        id: `onay-yeni-${g.ids.join("-")}`,
        kind: "warning",
        title: g.title,
        body: g.body,
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

/**
 * Yönetici: Paraşüt faturasında şimdikinden %40'tan fazla farklı gelen, onay bekleyen hammadde fiyatları (Hammaddeler ›
 * Onay bekleyen fiyatlar). Kimlik sayıdan ve en yeni öneriden: yeni öneri gelince yeniden okunmamış olur.
 */
async function holdNotifications(): Promise<PanelNotification[]> {
  const h = await pendingHoldSummary();
  if (!h.count) return [];
  return [
    {
      id: `fiyat-onay-${h.count}-${h.latestId}`,
      kind: "warning",
      title: `${h.count} hammadde fiyatı onay bekliyor`,
      body: `${holdsSummary(h.items)}: faturadaki fiyat %40'tan fazla farklı`,
      timeLabel: "",
      unread: true,
      href: HOLDS_HREF,
      group: "onay",
    },
  ];
}

/**
 * Yönetici: kasada (ModPOS) elle değiştirilecek fiyatlar (Ürünler › Fiyatlar › Kasaya işle; docs/FIYATLAR.md). Kimlik
 * sayıdan ve en yeni değişiklikten: yeni bir fiyat listeye girince yeniden okunmamış olur. Zaman en eskisinden.
 */
async function posNotifications(): Promise<PanelNotification[]> {
  const p = await posPendingSummary();
  if (!p.count) return [];
  return [
    {
      id: `kasa-fiyat-${p.count}-${p.newest?.getTime() ?? 0}`,
      kind: "info",
      title: `Kasada değişecek ${p.count} fiyat`,
      body: "ModPOS'ta elle değiştirip Fiyatlar › Kasaya işle'de işaretleyin",
      timeLabel: p.oldest ? agoLabel(p.oldest) : "",
      unread: true,
      href: "/panel/urunler/fiyatlar?sekme=kasa",
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
 * Yönetici: komisyon ve hakediş (Faturalar başlığı; docs/KOMISYON.md): geciken hakediş, yemek kartında %6 aşımı ve
 * komisyon dışı ücret olabilecek kalem, en çok beş. Hafif okuma (son 4 ayın Komisyon faturaları, hakediş işaretleri ve
 * Z toplamları; maliyet modeli yok). Kimlik uyarının anahtarından: yeni oran ya da yeni fatura yeniden okunmamış olur.
 */
async function commissionNotifications(): Promise<PanelNotification[]> {
  return (await loadCommissionAlerts()).map((a) => ({
    id: `komisyon-${a.key.replace(/:/g, "-")}`,
    kind: a.level,
    title: a.title,
    body: a.body,
    timeLabel: dateTR(a.date),
    unread: true,
    href: a.href,
    group: "fatura" as const,
  }));
}

/**
 * Kenar çubuğundaki zil: (yalnız yönetici) önce günlük işlerin sorunları, sonra kişinin hatırlatıcıları ve reçete
 * onayları, sonra (yalnız yönetici) zamanı gelen ödemeler (gecikmiş, bugün, yakında), faturalar, fiyatı girilmemiş
 * hammaddeler, kasada (ModPOS) değişecek fiyatlar ve son satış ayının uyarıları (Genel bakış'taki "Dikkat edilmesi
 * gerekenler" ile aynı kaynak). Kabuk açılınca bir kez istenir. Kontrol listeleri kasanın hemen ardından, iki rolde.
 * Personel kendi hatırlatıcılarını, önerilerinin sonucunu, akşam bekleyen kasa raporunu ve bekleyen kontrol listesini
 * görür; maliyet, ödeme, fatura ve sistem bilgisi ona gitmez.
 */
export async function loadPanelNotifications(): Promise<PanelNotification[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const [mine, recipes, cash, kontrol] = await Promise.all([
    reminderNotifications(user).catch(() => []),
    recipeNotifications(user).catch(() => []),
    cashNotifications(user).catch(() => []),
    checklistNotifications(user).catch(() => []),
  ]);
  if (user.role !== "admin") return [...cash, ...kontrol, ...mine, ...recipes];
  const [model, upcoming, invoiceItems, system, unpriced, holds, pos, commission, reorder] = await Promise.all([
    loadModel(),
    loadUpcoming().catch(() => null),
    invoiceNotifications().catch(() => []),
    systemNotifications().catch(() => []),
    unpricedNotifications().catch(() => []),
    holdNotifications().catch(() => []),
    posNotifications().catch(() => []),
    commissionNotifications().catch(() => []),
    // Mal siparişinin teslim kontrolü: fark ve gelmeyen sipariş (Faturalar grubu, en çok 5; tek sorgu, model yok)
    reorderNotifications().catch(() => []),
  ]);
  // Faturalar grubu: faturaların ardından mal siparişinin teslim kontrolü
  const invoices = [...invoiceItems, ...reorder];

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
  const zam = prices ? priceAlert(prices.changes, prices.actionable, prices.loss.totalLoss) : null;
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
  return [...system, ...mine, ...recipes, ...holds, ...cash, ...kontrol, ...payments, ...commission, ...invoices, ...pos, ...priceNote, ...unpriced, ...warnings];
}
