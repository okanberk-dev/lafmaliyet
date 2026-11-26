"use server";

import { and, count, eq, gt } from "drizzle-orm";

import { failedBellRows, logBellFailed, type BellFailed, type BellPart } from "@/lib/bell-failed";
import { paymentBellRows } from "@/lib/bell-payments";
import { featureInScope } from "@/lib/branch-features";
import { alerts, latestSalesMonth } from "@/lib/calc/insights";
import { priceAlert } from "@/lib/calc/price-impact";
import { businessDate } from "@/lib/cash-report";
import { CASH_OUT_INVOICES_HREF, pendingCashOutSummary } from "@/lib/cash-outs";
import { checklistBell } from "@/lib/checklists";
import { closedDayBellLists } from "@/lib/closed-days";
import { SIZE_LABELS } from "@/lib/constants";
import { unpricedNotice } from "@/lib/count-item";
import { dateTR, dayTR, monthShort, num, tl } from "@/lib/format";
import { blockedBell } from "@/lib/notify-recipients";
import { holdReason, holdsSummary, HOLDS_HREF } from "@/lib/price-hold";
import { groupNewProposals, REQUEST_STATUS_LABEL } from "@/lib/recipe-change";
import { addDays, todayTR } from "@/lib/reminders";
import { docBellRows } from "@/lib/staff-docs";
import { dueGroup, whenLabel } from "@/lib/user-reminders";
import { getCurrentUser, type CurrentUser } from "@/server/auth/dal";
import { kasaBell } from "@/server/bell/kasa";
import { modposKeyBell } from "@/server/bell/modpos";
import { opsBell } from "@/server/bell/ops";
import { currentBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { closedMarksOn } from "@/server/closed-days";
import { loadChecklistDays } from "@/server/data/checklists";
import { loadCommissionAlerts } from "@/server/data/commission";
import { loadModel } from "@/server/data/dataset";
import { loadPriceAlerts } from "@/server/data/price-alerts";
import { pendingHoldSummary } from "@/server/data/price-holds";
import { countStockOnlyReview } from "@/server/data/stock-only-invoices";
import { loadCashOutInvoiceState, scopeCashOutInvoiceState } from "@/server/data/cash-out-invoices";
import { countPendingRequests, loadMyRequests, loadReviewQueue } from "@/server/data/recipe-requests";
import { loadUnpricedIngredients } from "@/server/data/unpriced";
import { loadDueReminders } from "@/server/data/user-reminders";
import { loadDocAlerts } from "@/server/staff-docs";
import { getDb, schema as s } from "@/server/db";
import { latestParasutRun } from "@/server/jobs/runs";
import { loadSystemAlerts } from "@/server/jobs/alerts";
import { loadUpcoming } from "@/server/notify/digest";
import { blockedRecipientsNow } from "@/server/notify/recipients";
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
  /** Özet satırı: okununca bu kimlikler de okundu sayılır (içine aldığı satırlar sonra tek tek çıkınca okunmuş kalır) */
  covers?: string[];
  /** Ödemelerin özet satırı: içine aldığı gecikmiş ödeme sayısı (alt menünün rozeti; src/lib/bell-payments.ts) */
  overdue?: number;
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
 * Bildirim alıcıları (E-52, E-53): kasa raporu alıcılarında ya da sabah e-postasının etkin bildirim adreslerinde duran
 * ama personel ya da pasif hesabın olduğu için gönderimde düşen adresler. Durumdan türer (ayar ve hesaplar; iki küçük
 * sorgu): adres listeden çıkınca ya da hesap yeniden yönetici olunca satır kalkar. Kimlik adreslerden: yeni bir adres
 * düşünce yeniden okunmamış olur.
 */
async function recipientNotifications(): Promise<PanelNotification[]> {
  const now = await blockedRecipientsNow();
  return (["cash", "digest"] as const).flatMap((list) => {
    if (!now[list].length) return [];
    const b = blockedBell(list, now[list]);
    return [{ id: b.id, kind: "warning" as const, title: b.title, body: b.body, timeLabel: "", unread: true, href: b.href, group: "sistem" as const }];
  });
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
  const [lists, marks] = await Promise.all([loadChecklistDays(admin ? [day, yesterday] : [day], user.role, now), admin ? closedMarksOn(yesterday) : null]);
  // Dün onaylı kapalıysa (dalga 10 §2.9) hiç açılmamış listeler eksik sayılmaz; şube şube: listenin şubesi kapalıysa
  // (bütün şubelerin listesinde işletme kapalıysa). Marina'nın kapalı günü Tuzla'nın eksik listesini susturmaz
  const yLists = marks ? closedDayBellLists(lists.get(yesterday) ?? [], marks) : [];
  return checklistBell({
    role: user.role,
    now,
    today: { day, lists: lists.get(day) ?? [] },
    yesterday: admin ? { day: yesterday, lists: yLists } : null,
  }).map((b) => ({ ...b, group: "kontrol" as const }));
}

/**
 * Kişinin gecikmiş ve bugünkü (saati gelmiş ya da gelecek) hatırlatıcıları; 8'den fazlaysa ilk 7'si ve kalanı tek bir
 * "N hatırlatıcı daha" satırında (okununca içindekiler de okunur; bulgu 96)
 */
async function reminderNotifications(user: CurrentUser): Promise<PanelNotification[]> {
  const now = new Date();
  const rows: PanelNotification[] = (await loadDueReminders(user.id))
    .map((r) => ({ r, group: dueGroup(r, now) }))
    .filter((x) => x.group === "overdue" || x.group === "today")
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
  if (rows.length <= 8) return rows;
  const hidden = rows.slice(7);
  return [
    ...rows.slice(0, 7),
    {
      id: `hatirlatici-diger-${hidden[hidden.length - 1].id}`,
      kind: hidden.some((r) => r.kind === "warning") ? "warning" : "info",
      title: `${num(hidden.length)} hatırlatıcı daha`,
      body: "Hepsi Hatırlatıcılarım'da.",
      timeLabel: "",
      unread: hidden.some((r) => r.unread),
      href: "/panel/hatirlaticilarim",
      group: "hatirlatici",
      covers: hidden.map((r) => r.id),
    },
  ];
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
        timeLabel: r.reviewedAt ? dateTR(dayTR(r.reviewedAt)) : "",
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
 * Yönetici: Paraşüt faturasında şimdikinden %40'tan fazla farklı gelen ya da fiyatı olmayan hammaddenin çarpanı kesin
 * olmayan ilk fiyatı, onay bekleyen (Hammaddeler › Onay bekleyen fiyatlar). Kimlik sayıdan ve en yeni öneriden: yeni
 * öneri gelince yeniden okunmamış olur.
 */
async function holdNotifications(): Promise<PanelNotification[]> {
  const h = await pendingHoldSummary();
  if (!h.count) return [];
  return [
    {
      id: `fiyat-onay-${h.count}-${h.latestId}`,
      kind: "warning",
      title: `${h.count} hammadde fiyatı onay bekliyor`,
      body: `${holdsSummary(h.items)}: ${holdReason(h.items)}`,
      timeLabel: "",
      unread: true,
      href: HOLDS_HREF,
      group: "onay",
    },
  ];
}

/** Faturalar: kontrol bekleyenler, son 24 saatte Paraşüt'ten gelenler, başarısız son eşitleme, bağlanmayı bekleyen ürünler */
async function invoiceNotifications(): Promise<PanelNotification[]> {
  const db = getDb();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [[review], [fresh], [lastRun], unlinked, stockOnly, cashState] = await Promise.all([
    db.select({ n: count() }).from(s.invoices).where(eq(s.invoices.needsReview, true)),
    db.select({ n: count() }).from(s.invoices).where(and(eq(s.invoices.origin, "parasut"), gt(s.invoices.createdAt, dayAgo))),
    // Tedarikçi geçmişi (tek tedarikçi, elle) günlük eşitlemenin sağlığına sayılmaz; hesap başına son çalışma, hatalı önce
    latestParasutRun(db).then((r) => (r ? [r] : [])),
    countUnlinkedProducts().catch(() => 0),
    // Kalemi hammaddeye bağlı ama mal alışı sayılmayan, kontrol bekleyen faturalar (E-07)
    countStockOnlyReview(db).catch(() => 0),
    // Kasadan faturalı alımlar: faturası Faturalar'da yok, Aylık harcamalar'a da yazılmadı (E-42); yazılmışken
    // faturası sonradan gelenler (iki kez sayılıyor). Seçili şubenin kasasından çıkanlar (docs/SUBE.md › Ödemeler); zilin
    // kimliği süzülmüş listeden üretilir, öbür şubenin yeni satırı bu şubenin zilini yeniden okunmamış yapmaz
    Promise.all([loadCashOutInvoiceState(db), currentBranchScope()])
      .then(([state, scope]) => scopeCashOutInvoiceState(state, scope))
      .catch(() => ({ pending: [], duplicates: [] })),
  ]);
  const cashOuts = cashState.pending;
  const twice = cashState.duplicates;
  const out: PanelNotification[] = [];
  if (lastRun?.status === "error" && Date.now() - lastRun.startedAt.getTime() < 48 * 60 * 60 * 1000) {
    out.push({
      id: `fatura-eşitleme-${lastRun.id}`,
      kind: "danger",
      title: "Paraşüt eşitlemesi başarısız",
      body: (lastRun.message ?? "Bilinmeyen hata").slice(0, 200),
      timeLabel: dateTR(dayTR(lastRun.startedAt)),
      unread: true,
      href: "/panel/parasut",
      group: "fatura",
    });
  }
  if (fresh.n) {
    out.push({
      id: `fatura-yeni-${todayTR()}-${fresh.n}`,
      kind: "info",
      title: `Paraşüt'ten ${fresh.n} yeni fatura`,
      body: "Son 24 saatte eşitlemeyle geldi",
      timeLabel: "bugün",
      unread: true,
      href: "/panel/faturalar?kaynak=parasut",
      group: "fatura",
    });
  }
  if (stockOnly) {
    out.push({
      id: `fatura-stok-${stockOnly}`,
      kind: "warning",
      title: `${stockOnly} fatura mal alışı sayılmıyor`,
      body: "Kalemi hammaddeye bağlı: stoğa giriyor, gelir-gidere girmiyor. Kategorisini mal alışı yapın",
      timeLabel: "",
      unread: true,
      href: "/panel/faturalar?durum=kontrol",
      group: "fatura",
    });
  }
  if (cashOuts.length) {
    out.push({
      // Yeni satır gelince (en büyük numara) ya da sayı değişince yeniden okunmamış olur
      id: `fatura-kasa-${cashOuts.length}-${Math.max(...cashOuts.map((c) => c.id))}`,
      kind: "warning",
      title: cashOuts.length === 1 ? "Kasadan faturalı alım bekliyor" : `${cashOuts.length} kasadan faturalı alım bekliyor`,
      body: `${pendingCashOutSummary(cashOuts)}: e-Arşiv / fatura, Faturalar'da yok, gelir-gidere girmedi. Faturalar'a ekleyin ya da Aylık harcamalar'a yazın`,
      timeLabel: dateTR(cashOuts[0].date),
      unread: true,
      href: CASH_OUT_INVOICES_HREF,
      group: "fatura",
    });
  }
  if (twice.length) {
    out.push({
      id: `fatura-kasa-iki-${twice.length}-${Math.max(...twice.map((c) => c.id))}`,
      kind: "danger",
      title: twice.length === 1 ? "Kasa alımı iki kez sayılıyor" : `${twice.length} kasa alımı iki kez sayılıyor`,
      body: `${pendingCashOutSummary(twice)}: Aylık harcamalar'a yazılmıştı, faturası sonra geldi. Aylık harcamalar'daki kaydı silin`,
      timeLabel: dateTR(twice[0].invoice.date),
      unread: true,
      href: CASH_OUT_INVOICES_HREF,
      group: "fatura",
    });
  }
  const guessed = review.n - stockOnly;
  if (guessed > 0) {
    out.push({
      id: `fatura-kontrol-${guessed}`,
      kind: "warning",
      title: `${guessed} fatura kontrol bekliyor`,
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
 * komisyon dışı ücret olabilecek kalem, en çok beş. Hafif okuma (ekranın 13 ayının Komisyon faturaları, hakediş
 * işaretleri ve Z toplamları; maliyet modeli yok). Kimlik uyarının anahtarından: yeni oran ya da yeni fatura yeniden
 * okunmamış olur.
 */
async function commissionNotifications(): Promise<PanelNotification[]> {
  // Yemek kartı seçili şubede kullanılmıyorsa komisyon satırı yok (şube özelliği; docs/SUBE.md › Şube özellikleri)
  if (!featureInScope("yemek_karti", await currentBranchScope(), await listBranches())) return [];
  const idOf = (key: string) => `komisyon-${key.replace(/:/g, "-")}`;
  return (await loadCommissionAlerts()).map((a) => ({
    id: idOf(a.key),
    kind: a.level,
    title: a.title,
    body: a.body,
    timeLabel: dateTR(a.date),
    unread: true,
    href: a.href,
    group: "fatura" as const,
    // "N hakediş daha gecikti" özeti: içindekiler okunmuş sayılır
    ...(a.covers ? { covers: a.covers.map(idOf) } : {}),
  }));
}

/** Maliyet modeli okunamadı (E-49): okunmamış sayılmaz (geçici; rozeti şişirmez), kimliği günden */
function modelFailed(e: unknown): { priceNote: PanelNotification[]; warnings: PanelNotification[] } {
  console.error("Zil: maliyet modeli okunamadı", e);
  return {
    priceNote: [
      {
        id: `uyari-model-${todayTR()}`,
        kind: "warning",
        title: "Maliyet uyarıları yüklenemedi",
        body: "Satış ayının uyarıları ve hammadde zammı şu an okunamadı; öbür bildirimler etkilenmedi. Zili birazdan yeniden açın.",
        timeLabel: "",
        unread: false,
        href: "/panel",
        group: "uyari",
      },
    ],
    warnings: [],
  };
}

/**
 * Zamanı gelen ödemeler okunamadı (E-49'un ödeme yanı: loadUpcoming da Neon uyanırken kendi paralel sorgularıyla
 * düşebilir). Ödemeler grubu sessizce boş görünmesin, menü "Dikkat isteyen bir şey yok" demesin: tek satır, okunmamış
 * sayılmaz (geçici; rozeti şişirmez), kimliği günden.
 */
function upcomingFailed(e: unknown): null {
  console.error("Zil: zamanı gelen ödemeler okunamadı", e);
  return null;
}

const paymentsFailedRow = (): PanelNotification => ({
  id: `odeme-okunamadi-${todayTR()}`,
  kind: "warning",
  title: "Ödemeler yüklenemedi",
  body: "Zamanı gelen ödemeler şu an okunamadı; zili birazdan yeniden açın.",
  timeLabel: "",
  unread: false,
  href: "/panel/hatirlaticilar",
  group: "odeme",
});

/**
 * Yönetici: maliyet modeline bağlı satırlar, son satış ayının uyarıları (Genel bakış'taki "Dikkat edilmesi gerekenler"
 * ile aynı kaynak) ve hammadde zammı. Model okunamazsa (Neon uyanırken modelin paralel sorgularından biri zaman aşımına
 * düşer; denetim E-49) zil boş kalmaz: ödemeler, onaylar, sistem ve öbür satırlar yine gelir, bunların yerine tek bir
 * "yüklenemedi" satırı durur (modelFailed).
 */
async function modelNotifications(): Promise<{ priceNote: PanelNotification[]; warnings: PanelNotification[] }> {
  const model = await loadModel();
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
  // Hammadde zammı: kimlik ürün sayısı ve son zam tarihinden (İstanbul günü, E-70); yeni zam ya da yeni ürün gelince
  // yeniden okunmamış olur
  const prices = await loadPriceAlerts(model).catch(() => null);
  const zam = prices ? priceAlert(prices.changes, prices.actionable, prices.loss.totalLoss) : null;
  const lastChange = prices?.changes.map((c) => dayTR(c.changedAt)).sort().at(-1) ?? "";
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
  return { priceNote, warnings };
}

/**
 * Personel belgeleri (yalnız yönetici; docs/PERSONEL-BELGE.md): süresi dolan belgeler tek satır, 30 gün içinde bitecekler
 * tek satır (Uyarılar). Seçili şubenin kişileri ("Tümü"de hepsi). Kimlik belgelerden ve bitişlerden türer: yeni bir belge
 * bitince ya da yaklaşınca satır yeniden okunmamış olur, gün geçti diye olmaz (src/lib/staff-docs.ts docBellRows).
 */
async function staffDocNotifications(): Promise<PanelNotification[]> {
  const today = todayTR();
  const alerts = await loadDocAlerts(getDb(), today, await currentBranchScope());
  return docBellRows(alerts, today).map((r) => ({ ...r, timeLabel: "", unread: true, group: "uyari" as const }));
}

/**
 * Kenar çubuğundaki zil: (yalnız yönetici) önce günlük işlerin sorunları, sonra kişinin hatırlatıcıları ve onaylar
 * (reçete önerileri ve personel istekleri), sonra (yalnız yönetici) zamanı gelen ödemeler (gecikmiş, bugün, yakında),
 * faturalar, operasyonun satırları (kasada (ModPOS) değişecek fiyatlar …), fiyatı girilmemiş hammaddeler ve son satış
 * ayının uyarıları (Genel bakış'taki "Dikkat edilmesi gerekenler" ile aynı kaynak). Kabuk açılınca bir kez istenir.
 * Kontrol listeleri kasanın hemen ardından, iki rolde. Alanların satırlarını kendi modülleri üretir ve iki rol dalında
 * da çağrılır: kasa (src/server/bell/kasa.ts) ve operasyon (src/server/bell/ops.ts). Personel kendi hatırlatıcılarını,
 * önerilerinin ve isteklerinin sonucunu ("İsteklerim"), akşam bekleyen kasa raporunu ve bekleyen kontrol listesini
 * görür; maliyet, ödeme, fatura ve sistem bilgisi ona gitmez. Okunamayan bölüm kendi grubunda "… yüklenemedi" satırı
 * bırakır (failedBellRows; bulgu 88).
 */
export async function loadPanelNotifications(): Promise<PanelNotification[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  // Bir bölüm okunamazsa (Neon uyanırken zaman aşımı) sessizce boş görünmez: günlüğe yazılır ve kendi grubunda
  // "{Grup} yüklenemedi" satırı olur (src/lib/bell-failed.ts; bulgu 88). Satır okunmamış sayılmaz
  const failed: BellPart[] = [];
  const onFailed: BellFailed = (part, e) => {
    logBellFailed(part, e);
    failed.push(part);
  };
  const safe = (part: BellPart, p: Promise<PanelNotification[]>) => p.catch((e: unknown) => (onFailed(part, e), [] as PanelNotification[]));
  const [mine, recipes, cash, kontrol, ops] = await Promise.all([
    safe("hatirlatici", reminderNotifications(user)),
    safe("recete", recipeNotifications(user)),
    safe("kasa", kasaBell(user, onFailed)),
    safe("kontrol", checklistNotifications(user)),
    safe("operasyon", opsBell(user, onFailed)),
  ]);
  if (user.role !== "admin") return [...failedBellRows(failed, user.role, todayTR()), ...cash, ...kontrol, ...mine, ...recipes, ...ops];
  // Maliyet modeli zilin en ağır okuması: düşerse (E-49) öbür maddeler yine gelir, modelNotifications kendi satırını
  // koyar. Ödemeler de öyle: okunamazsa "Ödemeler yüklenemedi" satırı (upcomingFailed). ModPOS kasa föyünün anahtarı
  // çalışmıyorsa Sistem başlığında (src/server/bell/modpos.ts)
  const [costs, upcoming, invoices, system, unpriced, holds, commission, recipients, modpos, staffDocs] = await Promise.all([
    modelNotifications().catch(modelFailed),
    // Şube seçiliyken o şubenin ve işletme genelinin ödemeleri (docs/SUBE.md › Ödemeler)
    currentBranchScope()
      .then((branch) => loadUpcoming(undefined, { branch }))
      .catch(upcomingFailed),
    safe("fatura", invoiceNotifications()),
    safe("sistem", systemNotifications()),
    safe("fiyatsiz", unpricedNotifications()),
    safe("bekletme", holdNotifications()),
    safe("komisyon", commissionNotifications()),
    safe("alici", recipientNotifications()),
    safe("modpos", modposKeyBell()),
    safe("belge", staffDocNotifications()),
  ]);
  const lost = failedBellRows(failed, user.role, todayTR());

  // En çok 8 satır; sığmayanlar "N ödeme daha" özetinde, gecikmiş sayısıyla (rozet; src/lib/bell-payments.ts, bulgu 96)
  const payments: PanelNotification[] = paymentBellRows(upcoming?.items ?? []);
  if (!upcoming) payments.push(paymentsFailedRow());
  // Personelin kasadan tedarikçiye verdiği, hesaba işlenmemiş paralar (Teslim · ödeme; yalnız yönetici). Kimlik sayı ve
  // toplamdan: yeni satır gelince yeniden okunmamış olur
  const kasa = upcoming?.cari.kasaPending;
  if (kasa?.count) {
    payments.push({
      id: `odeme-kasa-${kasa.count}-${kasa.total}`,
      kind: "info",
      title: `Kasadan tedarikçiye ${num(kasa.count)} ödeme hesaba işlenmedi (${tl(kasa.total, 2)})`,
      body: "Tedarikçinin hesabına ödeme olarak işleyin ya da ayrı tutun.",
      timeLabel: "",
      unread: true,
      href: "/panel/tedarikciler?kasa=1",
      group: "odeme",
    });
  }

  return [...lost, ...system, ...recipients, ...modpos, ...mine, ...recipes, ...holds, ...cash, ...kontrol, ...payments, ...commission, ...invoices, ...ops, ...costs.priceNote, ...unpriced, ...staffDocs, ...costs.warnings];
}
