// Genel bakış · "Bu ayın işleri" listesinin saf mantığı (sunucuda, tarayıcıda ve testlerde çalışır; React gerekmez).
// Seçili ay için her ay yapılan işlerin (Yardım › Her ay ne yapmalı?) durumu, bir satırlık açıklaması ve
// ilgili ekranın tam adresi. dashboard-checklist.tsx yalnızca bunları çizer.

import type { Model, WaterCost } from "@/lib/calc/engine";
import type { MonthState } from "@/lib/calc/insights";
import { isSummaryRow } from "@/lib/calc/pos-paste";
import type { FieldSource } from "@/lib/calc/types";
import { missingText } from "@/lib/cash-month";
import { SEPARATE_CATEGORIES } from "@/lib/constants";
import { dateTimeTR, money, monthLabel, num, tl } from "@/lib/format";
import { lafposMonthNotes } from "@/lib/lafpos/sales";
import type { UpcomingItem } from "@/lib/reminders";
import { unreachable } from "@/lib/unreachable";

import { countStatus } from "./sayim/logic";

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
  /**
   * Tedarikçilere açık faturasız borçlar (cari; debtFacts: mahsuptan sonraki net tutar) ve bunlardan gecikmiş ya da
   * yaklaşan listede zaten sayılanlar; yoksa alan yok
   */
  debts?: { count: number; total: number; overdue: number; soon: number };
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
  /**
   * `lafpos`: geçiş gününden itibaren ayın kaynağı (src/lib/lafpos/sales.ts lafposMonthStatus): ay LafPOS'tan mı geliyor,
   * gelen gün sayısı ve Satışlar bandının ilk uyarısı (eksik gün, sayılmayan gün, liste ↔ Z); geçiş günü yoksa yok
   */
  sales: {
    lines: number;
    unmatched: number;
    /**
     * Ayın satılan (satış listesi ya da laffogato.net online) ama reçetesi boş ürünleri, satış adedine göre: maliyetleri
     * ortalama oranla tahmin edilir (denetim E-47); yoksa alan yok
     */
    noRecipe?: { count: number; names: string[]; unpriced: number };
    summaryRows: number;
    refMonth: string | null;
    lafpos?: { source: "gecis" | "lafpos"; days: number; warning: string | null };
  };
  /**
   * Ayın etkin açık günü ve cirosu. `source`: elle mi kasa raporlarından mı (yoksa elle sayılır); `till`: ayın kasa
   * raporlarında eksik günler ve ay ortasında başlayıp başlamadığı (raporu olmayan ayda null)
   */
  info: {
    openDays: number | null;
    posRevenue: number | null;
    source?: { openDays: FieldSource; posRevenue: FieldSource };
    till?: { missing: string[]; partialFrom: string | null; pending?: string[] } | null;
  };
  /**
   * count: kafenin faturaları (kafe dışı hariç). review: kontrol bekleyen, henüz onaylanmamış faturalar (Paraşüt
   * eşitlemesi: kategori tahmini, tevkifat, e-faturaya göre değişen tutar); kafe dışı dahil, count'un alt kümesi değil
   */
  invoices: { count: number; goods: number; review?: number };
  water: { bill: number | null; usedInRecipes: boolean; perLiter: number; costMonth: string | null; reason: WaterCost["reason"] };
  /**
   * lines: kayıtlı sayım satırı + ek kalem; total: ay sonu stoğu (KDV hariç); counted / listed: sayılan ve sayılacak
   * liste kalemi (sayim/logic.ts countStatus: Stok sayımı ekranı ve Bugün ile aynı kural)
   */
  stock: { lines: number; total: number; counted: number; listed: number };
  /** null: ödeme listesi okunamadı */
  payments: PaymentFacts | null;
  /** null: Paraşüt bağlı değil */
  parasut: ParasutFacts | null;
  /** Aylık harcamalar: her ay girilmesi gereken ama girilmemiş kategoriler; girilen kategori sayısı ve toplam */
  expenses?: { missing: string[]; entered: number; total: number };
}

/** Ödemeler kalemi faturasız borç mu (cari kayıt) */
function isDebt(i: UpcomingItem): boolean {
  switch (i.source) {
    case "cari":
      return true;
    case "invoice":
    case "reminder":
      return false;
    default:
      return unreachable(i.source);
  }
}

/**
 * Faturasız borçların sayısı ve toplamı, Ödemeler listesinin kalemlerinden (loadUpcoming: items + laterInvoices):
 * hesaptaki parayla mahsuptan sonraki net tutar; tamamen karşılananlar listede olmadığı için sayılmaz
 */
export function debtFacts(items: readonly UpcomingItem[]): { count: number; total: number } {
  const cari = items.filter((i) => isDebt(i) && (i.amount ?? 0) > 0.005);
  return { count: cari.length, total: Math.round(cari.reduce((s, i) => s + (i.amount ?? 0), 0) * 100) / 100 };
}

/** Ödemeler & hatırlatıcılar listesinden (loadUpcoming), ödenmemiş faturalardan ve faturasız borçlardan özet */
export function paymentFacts(items: UpcomingItem[], unpaid: { count: number; total: number }, debts: { count: number; total: number } = { count: 0, total: 0 }): PaymentFacts {
  const overdue = items.filter((i) => i.status === "overdue");
  const soon = items.filter((i) => i.status === "today" || i.status === "soon");
  const total = (xs: UpcomingItem[]) => xs.reduce((s, i) => s + (i.amount ?? 0), 0);
  const cari = (xs: UpcomingItem[]) => xs.filter(isDebt).length;
  return {
    overdue: overdue.length,
    overdueTotal: total(overdue),
    soon: soon.length,
    soonTotal: total(soon),
    unpaidInvoices: unpaid.count,
    unpaidTotal: unpaid.total,
    ...(debts.count ? { debts: { ...debts, overdue: cari(overdue), soon: cari(soon) } } : {}),
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
  // Satılan reçetesiz ürünler (satış listesi + online), en çok satılan önce
  const noRecipeQty = new Map<number, number>();
  for (const l of sales.noRecipe) if (l.product) noRecipeQty.set(l.product.product.id, (noRecipeQty.get(l.product.product.id) ?? 0) + l.line.qty);
  for (const x of model.onlineMonth(month)?.noRecipe ?? []) noRecipeQty.set(x.productId, (noRecipeQty.get(x.productId) ?? 0) + x.qty);
  const noRecipeProducts = [...noRecipeQty]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => model.products.find((p) => p.product.id === id))
    .filter((p) => !!p);
  const noRecipeNames = noRecipeProducts.map((p) => `${p.product.name} ${p.product.size}`);
  // Satırı olan ama maliyeti 0 çıkan ürün: reçetesi boş değil, malzemeleri fiyatsız (durumu yine "Reçete yok")
  const unpricedRecipes = noRecipeProducts.filter((p) => p.lines.length > 0).length;
  const pm = model.pnlMonth(month);
  const sheet = model.stockSheet(month);
  // Kafe dışı (karaoke box, Alp Koç) faturalar kafenin sayısına girmez; kontrol bekleyenler hepsinden
  const monthInvoices = model.ds.invoices.filter((i) => i.date.startsWith(month));
  const invoices = monthInvoices.filter((i) => !SEPARATE_CATEGORIES.includes(i.category));
  const bill = pm.cells.get("manual:su")?.value ?? null;
  const usedInRecipes = model.ds.ingredients.some((i) => i.priceSource === "water" && model.usedIn.has(i.id));
  // LafPOS'a geçildiyse ayın kaynağı: Satışlar'ın bandındaki uyarı burada da (yalnız Satışlar'da kalırsa liste yeşil görünürdü)
  const lp = model.ds.lafposSales;
  const st = lp?.months.find((x) => x.month === month) ?? null;
  return {
    month,
    state,
    dim: pm.dim,
    sales: {
      lines: sales.lines.length,
      unmatched: sales.unmatched.filter((l) => !isSummaryRow(l.line.posName)).length,
      ...(noRecipeNames.length ? { noRecipe: { count: noRecipeNames.length, names: noRecipeNames, unpriced: unpricedRecipes } } : {}),
      summaryRows: sales.lines.filter((l) => isSummaryRow(l.line.posName)).length,
      refMonth,
      ...(lp && st ? { lafpos: { source: st.source, days: st.lafpos?.days ?? 0, warning: lafposMonthNotes(st, lp.switchDay).warnings[0] ?? null } } : {}),
    },
    info: {
      openDays: info?.openDays ?? null,
      posRevenue: info?.posRevenue ?? null,
      source: info?.sources ? { openDays: info.sources.openDays, posRevenue: info.sources.posRevenue } : undefined,
      till: info?.kasa ? { missing: info.kasa.till.missing, partialFrom: info.kasa.till.partialFrom, pending: info.kasa.till.pending ?? [] } : null,
    },
    invoices: { count: invoices.length, goods: model.goodsPurchases(month), review: monthInvoices.filter((i) => i.needsReview).length },
    water: { bill, usedInRecipes, perLiter: model.water.perLiter, costMonth: model.water.month, reason: model.water.reason },
    stock: (() => {
      const st = countStatus(sheet);
      return {
        lines: sheet.groups.reduce((n, g) => n + g.lines.filter((l) => l.qty !== null).length, 0) + sheet.extras.length,
        total: sheet.total,
        counted: st.counted,
        listed: st.total,
      };
    })(),
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

/**
 * "2 satılan ürünün reçetesi boş (Pumpkin Latte M, Pumpkin Latte L)": en çok satılan üç ürünün adı ve boyuyla. Biri
 * reçeteli ama malzemeleri fiyatsızsa (maliyeti yine 0) "reçetesi boş ya da malzemesi fiyatsız"
 */
function noRecipeText(n: { count: number; names: string[]; unpriced: number }): string {
  const shown = n.names.slice(0, 3).join(", ");
  const more = n.names.length > 3 ? ` ve ${num(n.names.length - 3)} ürün daha` : "";
  return `${num(n.count)} satılan ürünün ${n.unpriced ? "reçetesi boş ya da malzemesi fiyatsız" : "reçetesi boş"} (${shown}${more})`;
}

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
    } else if (s.lafpos?.warning && !notStarted) {
      // LafPOS'a geçilen ayda eksik ya da sayılmayan gün, liste ↔ Z farkı: satırlar olsa da ay tamam değil
      out.push({ key: "satis", title: "Satış raporu", status: "warn", detail: s.lafpos.warning, href, action: "Satışlara bak" });
    } else if (s.lines && s.unmatched) {
      const noRecipe = s.noRecipe ? ` Ayrıca ${noRecipeText(s.noRecipe)}.` : "";
      out.push({
        key: "satis",
        title: "Satış raporu",
        status: "todo",
        detail: `${s.lafpos ? `${num(s.lines)} satır` : `${num(s.lines)} satır yüklendi`}; ${num(s.unmatched)} POS ürünü reçeteyle eşleşmedi, bunlara ortalama maliyet oranı uygulanıyor.${noRecipe}`,
        href: `${href}&durum=eslesmeyen#satirlar`,
        action: "Eşleştir",
      });
    } else if (s.lines && s.noRecipe) {
      // Satırlar ürüne bağlı ama ürünün reçetesi boş: maliyeti 0 değil, ortalama oranla tahmini (denetim E-47)
      out.push({
        key: "satis",
        title: "Satış raporu",
        status: "todo",
        detail: `${num(s.lines)} satır ürünlere bağlı ama ${noRecipeText(s.noRecipe)}: maliyetleri ortalama maliyet oranıyla tahmin ediliyor. ${s.noRecipe.unpriced ? "Reçetelerini ve malzeme fiyatlarını girin." : "Reçetelerini girin."}`,
        href: `/panel/urunler?${new URLSearchParams({ durum: "Reçete yok", ay: m })}`,
        action: "Reçete gir",
      });
    } else if (s.lines) {
      const detail =
        s.lafpos?.source === "lafpos"
          ? `LafPOS'tan ${num(s.lafpos.days)} gün geldi (${num(s.lines)} satır), hepsi reçeteyle eşleşti.`
          : s.lafpos
            ? `ModPOS listesi ve LafPOS'tan ${num(s.lafpos.days)} gün (${num(s.lines)} satır), hepsi reçeteyle eşleşti.`
            : `${num(s.lines)} satır yüklendi, hepsi reçeteyle eşleşti.`;
      out.push({ key: "satis", title: "Satış raporu", status: "done", detail, href, action: "Satışları aç" });
    } else if (s.lafpos?.source === "lafpos") {
      // Ayın tamamı LafPOS'tan: liste yüklenmez, satırlar gün sonunda gelir
      out.push({
        key: "satis",
        title: "Satış raporu",
        status: notStarted || f.state === "running" ? "later" : "todo",
        detail: notStarted
          ? "Ay başlamadı."
          : f.state === "running"
            ? "Satışlar her gün sonunda LafPOS'tan gelir; bu ay henüz sayılan gün sonu yok."
            : "Bu aya LafPOS gün sonu gelmedi: reçeteye göre kâr hesaplanamıyor. Ayarlar › LafPOS kartına bakın.",
        href: notStarted || f.state === "running" ? href : "/panel/ayarlar#lafpos",
        action: notStarted || f.state === "running" ? "Satışları aç" : "LafPOS'a bak",
      });
    } else {
      const ratio = ref ? ` Kâr oranı şimdilik ${ref} satışlarından alınıyor.` : "";
      out.push({
        key: "satis",
        title: "Satış raporu",
        status: later(f.state) ? "later" : "todo",
        detail: notStarted
          ? "Ay başlamadı."
          : f.state === "running"
            ? s.lafpos
              ? `Geçiş ayı: Patron'dan geçiş gününden önceki günlerin ürün satış raporunu yükleyin; sonrası LafPOS'tan gelir.${ratio}`
              : `Ay bitince Patron'dan ürün satış raporunu yükleyin.${ratio}`
            : `Yüklenmedi: reçeteye göre kâr hesaplanamıyor.${ratio}`,
        href,
        action: "Satış raporu yükle",
      });
    }
  }

  // 2. Açık gün ve POS cirosu (Satışlar › ay bilgileri; boşsa kasa raporlarından)
  {
    const href = `/panel/satislar?ay=${m}#m-days`;
    const od = f.info.openDays ?? 0;
    const pos = f.info.posRevenue ?? 0;
    const title = "Açık gün ve POS cirosu";
    const fromKasa = f.info.source?.openDays === "kasa" || f.info.source?.posRevenue === "kasa";
    const missing = f.info.till?.missing ?? [];
    if (od > f.dim) {
      out.push({ key: "gun", title, status: "warn", detail: `Açık gün (${od}) ayın gün sayısından (${f.dim}) fazla; sabit giderler fazla çıkar.`, href, action: "Düzelt" });
    } else if (fromKasa && od > 0 && f.state === "closed" && missing.length) {
      // Kapanmış ayda raporu girilmemiş gün: kasadan gelen açık gün ve ciro eksik kalır (sessizce düzeltilmez)
      out.push({
        key: "gun",
        title,
        status: "warn",
        detail: `${missing.length} günün kasa raporu yok (${missingText(missing, 5, f.info.till?.pending ?? [])}); açık gün ve ciro eksik olabilir.`,
        href: `/panel/kasa?ay=${m}`,
        action: "Kasaya bak",
      });
    } else if (fromKasa && od > 0 && pos > 0) {
      out.push({
        key: "gun",
        title,
        status: "done",
        detail:
          f.state === "running"
            ? `Kasa raporlarından: bugüne kadar ${od} gün · POS ${tl(pos)}. Her akşamki raporla güncellenir.`
            : `Kasa raporlarından: ${od} / ${f.dim} gün açık · POS ${tl(pos)}.`,
        href,
        action: "Ay bilgileri",
      });
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
    // Tamam = listedeki her kalem sayıldı (countStatus); tek satır kaydedilmiş ay "Tamam" değil
    const complete = f.stock.listed > 0 && f.stock.counted >= f.stock.listed;
    if (complete) {
      out.push({ key: "sayim", title, status: "done", detail: `${num(f.stock.lines)} kalem sayıldı · devreden stok ${tl(f.stock.total)} (KDV hariç).`, href, action: "Sayımı aç" });
    } else if (f.stock.lines) {
      out.push({
        key: "sayim",
        title,
        status: "todo",
        detail: `Yarım: ${num(f.stock.counted)} / ${num(f.stock.listed)} kalem sayıldı. Kalanların stoğu 0 sayılır; mal maliyeti yüksek çıkar.`,
        href,
        action: "Sayımı tamamla",
      });
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
    // Faturasız borçlar (cari): gecikmiş ve yaklaşan listede zaten sayılanlar "dahil" diye söylenir (iki kez sayılmaz);
    // geciken ya da yaklaşan yoksa ek olarak "· 2 faturasız borç"
    const debtCount = p?.debts?.count ? `${num(p.debts.count)} faturasız borç (${money(p.debts.total)})` : "";
    const inside = (n: number | undefined) => (n ? `, ${num(n)} faturasız borç dahil` : "");
    if (!p) {
      out.push({ key: "odeme", title, status: "later", detail: "Ödeme listesi şu an okunamadı.", href, action: "Ödemeler" });
    } else if (p.overdue) {
      out.push({
        key: "odeme",
        title,
        status: "warn",
        detail: `${num(p.overdue)} ödeme gecikti (${money(p.overdueTotal)}${inside(p.debts?.overdue)}). Ödendiyse işaretleyin.${p.soon ? ` Yaklaşan: ${num(p.soon)}.` : ""}`,
        href,
        action: "Ödemelere bak",
      });
    } else if (p.soon) {
      out.push({ key: "odeme", title, status: "todo", detail: `Yaklaşan ${num(p.soon)} ödeme (${money(p.soonTotal)}${inside(p.debts?.soon)}); geciken yok.`, href, action: "Ödemelere bak" });
    } else {
      out.push({
        key: "odeme",
        title,
        status: "done",
        detail: p.unpaidInvoices
          ? `Geciken ya da yaklaşan ödeme yok · ${num(p.unpaidInvoices)} fatura ödenmemiş, kalan ${money(p.unpaidTotal)}${debtCount ? ` · ${debtCount}` : ""}.`
          : `Geciken ya da yaklaşan ödeme yok${debtCount ? ` · ${debtCount}` : ""}.`,
        href: p.unpaidInvoices ? "/panel/faturalar?durum=odenmedi" : p.debts?.count ? "/panel/hatirlaticilar?kaynak=cari" : href,
        action: p.unpaidInvoices ? "Ödenmemiş faturalar" : p.debts?.count ? "Faturasız borçlar" : "Ödemeler",
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
