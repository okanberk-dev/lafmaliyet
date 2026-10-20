// Genel bakış · "Bu ayın işleri" listesinin saf mantığı (sunucuda, tarayıcıda ve testlerde çalışır; React gerekmez).
// Seçili ay için her ay yapılan işlerin (Yardım › Her ay ne yapmalı?) durumu, bir satırlık açıklaması ve
// ilgili ekranın tam adresi. dashboard-checklist.tsx yalnızca bunları çizer.

import type { Model, WaterCost } from "@/lib/calc/engine";
import type { MonthState } from "@/lib/calc/insights";
import { isSummaryRow } from "@/lib/calc/pos-paste";
import { SEPARATE_CATEGORIES } from "@/lib/constants";
import { dateTimeTR, money, monthLabel, num, tl } from "@/lib/format";
import type { UpcomingItem } from "@/lib/reminders";

/**
 * - done: yapıldı
 * - todo: yapılmalı (eksik veri, eşleşmeyen satır, yaklaşan ödeme)
 * - warn: sorun var, rakamları bozuyor (toplam satırı, geciken ödeme, Paraşüt hatası, fazla açık gün)
 * - later: henüz zamanı değil (devam eden ya da başlamamış ay)
 */
export type TaskStatus = "done" | "todo" | "warn" | "later";
export type TaskKey = "satis" | "gun" | "fatura" | "harcama" | "su" | "sayim" | "odeme";

export interface MonthTask {
  key: TaskKey;
  title: string;
  status: TaskStatus;
  /** Tek satırlık açıklama: ne durumda, neden önemli */
  detail: string;
  /** İlgili ekranın tam adresi (ay, süzgeç, bölüm) */
  href: string;
  /** Bağlantının kısa adı, ör. "Eşleştir", "Sayım gir" */
  action: string;
}

export interface PaymentFacts {
  overdue: number;
  overdueTotal: number;
  /** Bugün ve yakında (hatırlatma süresi içinde) ödenecekler */
  soon: number;
  soonTotal: number;
  unpaidInvoices: number;
  unpaidTotal: number;
}

export interface ParasutFacts {
  lastStatus: "ok" | "error" | "running" | null;
  lastRunAt: string | null;
  lastOkAt: string | null;
  message: string | null;
}

export interface MonthTaskFacts {
  month: string;
  state: MonthState;
  dim: number;
  sales: { lines: number; unmatched: number; summaryRows: number; refMonth: string | null };
  info: { openDays: number | null; posRevenue: number | null };
  /**
   * count: kafenin faturaları (kafe dışı hariç). review: kontrol bekleyen, henüz onaylanmamış faturalar (Paraşüt
   * eşitlemesi: kategori tahmini, tevkifat, e-faturaya göre değişen tutar); kafe dışı dahil, count'un alt kümesi değil
   */
  invoices: { count: number; goods: number; review?: number };
  water: { bill: number | null; usedInRecipes: boolean; perLiter: number; costMonth: string | null; reason: WaterCost["reason"] };
  stock: { lines: number; total: number };
  /** null: ödeme listesi okunamadı */
  payments: PaymentFacts | null;
  /** null: Paraşüt bağlı değil */
  parasut: ParasutFacts | null;
  /** Aylık harcamalar: her ay girilmesi gereken ama girilmemiş kategoriler; girilen kategori sayısı ve toplam */
  expenses?: { missing: string[]; entered: number; total: number };
}

/** Ödemeler & hatırlatıcılar listesinden (loadUpcoming) ve ödenmemiş faturalardan özet */
export function paymentFacts(items: UpcomingItem[], unpaid: { count: number; total: number }): PaymentFacts {
  const overdue = items.filter((i) => i.status === "overdue");
  const soon = items.filter((i) => i.status === "today" || i.status === "soon");
  const total = (xs: UpcomingItem[]) => xs.reduce((s, i) => s + (i.amount ?? 0), 0);
  return {
    overdue: overdue.length,
    overdueTotal: total(overdue),
    soon: soon.length,
    soonTotal: total(soon),
    unpaidInvoices: unpaid.count,
    unpaidTotal: unpaid.total,
  };
}

/** Modelden seçili ayın gerçekleri; ödemeler ve Paraşüt sunucuda ayrıca okunur */
export function monthTaskFacts(
  model: Model,
  month: string,
  state: MonthState,
  refMonth: string | null,
  extra: { payments: PaymentFacts | null; parasut: ParasutFacts | null },
): MonthTaskFacts {
  const sales = model.monthSales(month);
  const info = model.monthInfo.get(month);
  const pm = model.pnlMonth(month);
  const sheet = model.stockSheet(month);
  // Kafe dışı (karaoke box, Alp Koç) faturalar kafenin sayısına girmez; kontrol bekleyenler hepsinden
  const monthInvoices = model.ds.invoices.filter((i) => i.date.startsWith(month));
  const invoices = monthInvoices.filter((i) => !SEPARATE_CATEGORIES.includes(i.category));
  const bill = pm.cells.get("manual:su")?.value ?? null;
  const usedInRecipes = model.ds.ingredients.some((i) => i.priceSource === "water" && model.usedIn.has(i.id));
  return {
    month,
    state,
    dim: pm.dim,
    sales: {
      lines: sales.lines.length,
      unmatched: sales.unmatched.filter((l) => !isSummaryRow(l.line.posName)).length,
      summaryRows: sales.lines.filter((l) => isSummaryRow(l.line.posName)).length,
      refMonth,
    },
    info: { openDays: info?.openDays ?? null, posRevenue: info?.posRevenue ?? null },
    invoices: { count: invoices.length, goods: model.goodsPurchases(month), review: monthInvoices.filter((i) => i.needsReview).length },
    water: { bill, usedInRecipes, perLiter: model.water.perLiter, costMonth: model.water.month, reason: model.water.reason },
    stock: {
      lines: sheet.groups.reduce((n, g) => n + g.lines.filter((l) => l.qty !== null).length, 0) + sheet.extras.length,
      total: sheet.total,
    },
    expenses: (() => {
      const xs = model.expenseAmounts(month);
      return {
        // Bağlı fatura kategorisinden faturası gelen ay girilmiş sayılır (Aylık harcamalar uyarısıyla aynı kural)
        missing: xs.filter((x) => model.expenseExpected(x.cat, month) && !x.entries && !x.invoices).map((x) => x.cat.name),
        entered: xs.filter((x) => x.total).length,
        total: xs.reduce((a, x) => a + x.total, 0),
      };
    })(),
    ...extra,
  };
}

const later = (state: MonthState) => state !== "closed";

/** Seçili ayın işleri, Satışlar → Ödemeler sırasıyla */
export function monthTasks(f: MonthTaskFacts): MonthTask[] {
  const m = f.month;
  const label = monthLabel(m);
  const ref = f.sales.refMonth && f.sales.refMonth !== m ? monthLabel(f.sales.refMonth) : null;
  const notStarted = f.state === "future";
  const out: MonthTask[] = [];

  // 1. Satış raporu
  {
    const href = `/panel/satislar?ay=${m}`;
    const s = f.sales;
    if (s.lines && s.summaryRows) {
      out.push({
        key: "satis",
        title: "Satış raporu",
        status: "warn",
        detail: `Listede ${s.summaryRows} toplam satırı ürün gibi sayılıyor; ciro ve kâr şişiyor. Satırı silin.`,
        href: `${href}#satirlar`,
        action: "Satırı sil",
      });
    } else if (s.lines && s.unmatched) {
      out.push({
        key: "satis",
        title: "Satış raporu",
        status: "todo",
        detail: `${num(s.lines)} satır yüklendi; ${num(s.unmatched)} POS ürünü reçeteyle eşleşmedi, bunlara ortalama maliyet oranı uygulanıyor.`,
        href: `${href}&durum=eslesmeyen#satirlar`,
        action: "Eşleştir",
      });
    } else if (s.lines) {
      out.push({ key: "satis", title: "Satış raporu", status: "done", detail: `${num(s.lines)} satır yüklendi, hepsi reçeteyle eşleşti.`, href, action: "Satışları aç" });
    } else {
      const ratio = ref ? ` Kâr oranı şimdilik ${ref} satışlarından alınıyor.` : "";
      out.push({
        key: "satis",
        title: "Satış raporu",
        status: later(f.state) ? "later" : "todo",
        detail: notStarted
          ? "Ay başlamadı."
          : f.state === "running"
            ? `Ay bitince Patron'dan ürün satış raporunu yükleyin.${ratio}`
            : `Yüklenmedi: reçeteye göre kâr hesaplanamıyor.${ratio}`,
        href,
        action: "Satış raporu yükle",
      });
    }
  }

  // 2. Açık gün ve POS cirosu (Satışlar › ay bilgileri)
  {
    const href = `/panel/satislar?ay=${m}#m-days`;
    const od = f.info.openDays ?? 0;
    const pos = f.info.posRevenue ?? 0;
    const title = "Açık gün ve POS cirosu";
    if (od > f.dim) {
      out.push({ key: "gun", title, status: "warn", detail: `Açık gün (${od}) ayın gün sayısından (${f.dim}) fazla; sabit giderler fazla çıkar.`, href, action: "Düzelt" });
    } else if (od > 0 && pos > 0) {
      out.push({
        key: "gun",
        title,
        status: "done",
        detail:
          f.state === "running"
            ? `Bugüne kadar ${od} gün açık · POS ${tl(pos)}. Ay sonu tahmini bu tempoyla yapılıyor; ay bitince gerçek sayıyı yazın.`
            : `${od} / ${f.dim} gün açık · POS ${tl(pos)}.`,
        href,
        action: "Ay bilgileri",
      });
    } else if (od > 0) {
      out.push({ key: "gun", title, status: "todo", detail: `${od} gün açık girildi; POS cirosu yok, günlük ortalama ve tahmin çıkmaz.`, href: `/panel/satislar?ay=${m}#m-pos`, action: "POS cirosunu gir" });
    } else {
      out.push({
        key: "gun",
        title,
        status: notStarted ? "later" : "todo",
        detail: notStarted
          ? "Ay başlamadı."
          : f.state === "running"
            ? "Bugüne kadarki açık gün sayısını ve POS cirosunu girin; ay sonu tahmini bunlarla yapılır."
            : "Girilmedi: sabit giderler tam ay sayılır, günlük ortalama ve başabaş karşılaştırması çıkmaz.",
        href,
        action: "Ay bilgilerini gir",
      });
    }
  }

  // 3. Faturalar (+ Paraşüt)
  {
    const href = `/panel/faturalar?ay=${m}`;
    const p = f.parasut;
    const sync = p ? (p.lastOkAt ? ` Paraşüt son eşitleme ${dateTimeTR(p.lastOkAt)}.` : " Paraşüt henüz eşitlenmedi.") : "";
    if (p?.lastStatus === "error") {
      out.push({
        key: "fatura",
        title: "Faturalar",
        status: "warn",
        detail: `Son Paraşüt eşitlemesi hata verdi${p.lastRunAt ? ` (${dateTimeTR(p.lastRunAt)})` : ""}; yeni faturalar gelmemiş olabilir.${f.invoices.count ? ` Bu ay ${num(f.invoices.count)} fatura var.` : ""}`,
        href: "/panel/parasut",
        action: "Paraşüt'e bak",
      });
    } else if (f.invoices.review) {
      out.push({
        key: "fatura",
        title: "Faturalar",
        status: "todo",
        // İki sayı ayrı kümelerden (kafe dışı faturalar da kontrol bekleyebilir): "N fatura · M tanesinin" denmez
        detail: `${num(f.invoices.review)} fatura kontrol bekliyor; doğruysa tek dokunuşla onaylayın.${f.invoices.count ? ` Bu ay ${num(f.invoices.count)} kafe faturası var.` : ""}${sync}`,
        href: `/panel/faturalar?ay=${m}&durum=kontrol`,
        action: "Kontrol et",
      });
    } else if (f.invoices.count) {
      out.push({
        key: "fatura",
        title: "Faturalar",
        status: "done",
        detail: `${num(f.invoices.count)} fatura · mal alımı ${tl(f.invoices.goods)} (KDV hariç).${sync}`,
        href,
        action: "Faturaları aç",
      });
    } else {
      out.push({
        key: "fatura",
        title: "Faturalar",
        status: later(f.state) ? "later" : "todo",
        detail: notStarted
          ? `Ay başlamadı.${sync}`
          : f.state === "running"
            ? `Bu ay henüz fatura yok; geldikçe ekleyin.${sync}`
            : `${label} için fatura yok: faturaya göre maliyet ve kâr eksik çıkar.${sync}`,
        href,
        action: "Fatura ekle",
      });
    }
  }

  // 3b. Aylık harcamalar (reklam, influencer, fatura dışı): yalnız kategori tanımlıysa
  if (f.expenses && (f.expenses.missing.length || f.expenses.entered) && !notStarted) {
    const e = f.expenses;
    const href = `/panel/harcamalar?ay=${m}`;
    if (e.missing.length) {
      out.push({
        key: "harcama",
        title: "Aylık harcamalar",
        status: later(f.state) ? "later" : "todo",
        detail: `${e.missing.join(", ")} ${label} için girilmedi${e.entered ? ` · girilen ${tl(e.total)}` : ""}. Girilmezse o ayın gideri eksik görünür.`,
        href,
        action: "Harcama gir",
      });
    } else {
      out.push({ key: "harcama", title: "Aylık harcamalar", status: "done", detail: `${num(e.entered)} kategori · ${tl(e.total)}.`, href, action: "Harcamaları aç" });
    }
  }

  // 4. Su faturası (Gelir-gider › SU GİDERİ)
  {
    const href = `/panel/gelir-gider?yil=${m.slice(0, 4)}&ara=su+gideri`;
    const w = f.water;
    const title = "Su faturası";
    if (w.bill !== null && w.bill > 0) {
      const detail =
        w.reason === "override"
          ? `${tl(w.bill)} girildi. Su + buz litre maliyeti Ayarlar'da elle girilmiş (${tl(w.perLiter, 2)}/L); fatura sabit giderde ikinci kez sayılmaz.`
          : w.reason === "ok" && w.costMonth === m
            ? `${tl(w.bill)} · su + buz ${tl(w.perLiter, 2)}/L olarak reçetelere dağıtıldı; sabit giderde ikinci kez sayılmaz.`
            : w.reason === "ok" && w.costMonth
              ? f.sales.lines
                ? // Bu ayın da satış listesi var; birim maliyet her zaman en son uygun aydan (Ayarlar › su + buz)
                  `${tl(w.bill)} girildi. Su + buz litre maliyeti en son faturalı ve satış listeli ay olan ${monthLabel(w.costMonth)} faturasından (${tl(w.perLiter, 2)}/L); fatura sabit giderde ikinci kez sayılmaz.`
                : `${tl(w.bill)} girildi. ${label} satış listesi olmadığı için litre maliyeti ${monthLabel(w.costMonth)} faturasından.`
              : `${tl(w.bill)} girildi ama ${label} satış listesi yok; litre hesaplanamadı, fatura sabit gider sayılıyor.`;
      out.push({ key: "su", title, status: "done", detail, href, action: "Gelir-gider" });
    } else {
      out.push({
        key: "su",
        title,
        status: later(f.state) ? "later" : "todo",
        detail: later(f.state)
          ? "Fatura gelince Gelir-gider'deki SU GİDERİ satırına KDV hariç yazın."
          : `Girilmedi${w.usedInRecipes && w.perLiter === 0 ? ": su ve buz reçetelerde maliyetsiz sayılıyor" : ""}. Gelir-gider'deki SU GİDERİ satırına KDV hariç yazın.`,
        href,
        action: "Su faturasını gir",
      });
    }
  }

  // 5. Ay sonu stok sayımı
  {
    const href = `/panel/sayim?ay=${m}`;
    const title = "Ay sonu stok sayımı";
    if (f.stock.lines) {
      out.push({ key: "sayim", title, status: "done", detail: `${num(f.stock.lines)} kalem sayıldı · devreden stok ${tl(f.stock.total)} (KDV hariç).`, href, action: "Sayımı aç" });
    } else {
      out.push({
        key: "sayim",
        title,
        status: later(f.state) ? "later" : "todo",
        detail: later(f.state)
          ? "Ayın son günü kapanıştan sonra sayın; personel hesabıyla telefondan da girilir."
          : "Sayım yok: sonraki aya devreden mal 0 kabul edilir, alınan malın tamamı maliyet sayılır.",
        href,
        action: "Sayım gir",
      });
    }
  }

  // 6. Ödemeler (bugüne göre, aydan bağımsız)
  {
    const href = "/panel/hatirlaticilar";
    const title = "Ödemeler · bugün";
    const p = f.payments;
    if (!p) {
      out.push({ key: "odeme", title, status: "later", detail: "Ödeme listesi şu an okunamadı.", href, action: "Ödemeler" });
    } else if (p.overdue) {
      out.push({
        key: "odeme",
        title,
        status: "warn",
        detail: `${num(p.overdue)} ödeme gecikti (${money(p.overdueTotal)}). Ödendiyse işaretleyin.${p.soon ? ` Yaklaşan: ${num(p.soon)}.` : ""}`,
        href,
        action: "Ödemelere bak",
      });
    } else if (p.soon) {
      out.push({ key: "odeme", title, status: "todo", detail: `Yaklaşan ${num(p.soon)} ödeme (${money(p.soonTotal)}); geciken yok.`, href, action: "Ödemelere bak" });
    } else {
      out.push({
        key: "odeme",
        title,
        status: "done",
        detail: p.unpaidInvoices
          ? `Geciken ya da yaklaşan ödeme yok · ${num(p.unpaidInvoices)} fatura ödenmemiş, kalan ${money(p.unpaidTotal)}.`
          : "Geciken ya da yaklaşan ödeme yok.",
        href: p.unpaidInvoices ? "/panel/faturalar?durum=odenmedi" : href,
        action: p.unpaidInvoices ? "Ödenmemiş faturalar" : "Ödemeler",
      });
    }
  }

  return out;
}

/**
 * Özet: kaç iş bitti, kaçı açık; sıradaki iş (önce sorunlar, sonra eksikler).
 * `monthOpen`: ayın rakamlarını etkileyen açık işler. Ödemeler bugüne bağlıdır, ayın kâr/zararını değiştirmez:
 * yalnızca ödeme işi açıksa ay "eksiksiz" sayılır (kart kapanır, özet ödemeyi ayrıca söyler).
 */
export function taskSummary(tasks: MonthTask[]) {
  const count = (s: TaskStatus) => tasks.filter((t) => t.status === s).length;
  const next = tasks.find((t) => t.status === "warn") ?? tasks.find((t) => t.status === "todo") ?? null;
  const open = count("todo") + count("warn");
  const monthOpen = tasks.filter((t) => t.key !== "odeme" && (t.status === "todo" || t.status === "warn")).length;
  return {
    done: count("done"),
    todo: count("todo"),
    warn: count("warn"),
    later: count("later"),
    open,
    monthOpen,
    paymentsOpen: open - monthOpen,
    total: tasks.length,
    allDone: open === 0,
    next,
  };
}

/** Satırın hangi görünümde çizildiği: yalnızca telefonda, yalnızca geniş ekranda ya da ikisinde */
export type ChecklistView = "phone" | "wide" | "all";

export type ChecklistRow = { task: MonthTask; next: boolean; compact: boolean; view: ChecklistView };

/**
 * Telefonda "Bu ayın işleri" kısa görünür: sıradaki iş (tek birincil eylem) tam kart olarak en üstte, diğer işler
 * tek satır (ad + durum rozeti); açıklamaları "Ayrıntıları göster" ile açılır. Geniş ekranda bütün kartlar
 * açıklamalarıyla, listedeki sırasıyla görünür.
 * Sıradaki iş listenin başında değilse iki kez yer alır: başta yalnızca telefonda ("phone"), kendi yerinde yalnızca
 * geniş ekranda ("wide"). Böylece DOM sırası (ekran okuyucu, klavye odağı) her iki görünümde de görünen sırayla
 * aynıdır; CSS ile yeniden sıralama yapılmaz. Gizli kopya display: none olduğu için okunmaz, odak almaz.
 * `waiting`: tek satıra inen açık (yapılacak / sorunlu) iş sayısı, düğmede söylenir.
 */
export function phoneChecklist(tasks: MonthTask[]) {
  const { next } = taskSummary(tasks);
  // Sıradaki iş zaten ilkse kopya gerekmez
  const lead = next !== null && tasks[0]?.key !== next.key;
  const rows: ChecklistRow[] = tasks.map((task) => {
    const isNext = task.key === next?.key;
    return { task, next: isNext, compact: !isNext, view: isNext && lead ? "wide" : "all" };
  });
  if (lead && next) rows.unshift({ task: next, next: true, compact: false, view: "phone" });
  const compact = rows.filter((r) => r.compact);
  return {
    rows,
    /** Telefonda tek satıra inen iş var mı (ayrıntı düğmesi yalnızca o zaman gösterilir) */
    toggle: compact.length > 0,
    waiting: compact.filter((r) => r.task.status === "todo" || r.task.status === "warn").length,
  };
}
