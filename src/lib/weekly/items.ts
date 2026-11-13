/**
 * Haftalık özetin maddeleri (saf; tests/haftalik-ozet.test.ts). Her yapıcı dar, düz bir girdi alır: başka ekranların
 * nesnelerini src/server/weekly/collect.ts bunlara çevirir; o ekranlarda bir tür değişirse yalnız oradaki eşleme
 * değişir. Hiçbir girdi kişi adı taşımaz (kasa raporunu giren / sayan, kontrol listesini dolduran, notlar). Kurallar ve
 * metinler docs/planlar/haftalik.md §3.2–3.3; tutarlar tl() (tam lira, ₺'den önce bölünmez boşluk), "≈" tahmin demek.
 */

import type { Model } from "@/lib/calc/engine";
import type { WasteEntry } from "@/lib/calc/types";
import { CASH_TOLERANCE } from "@/lib/cash-report";
import { listTitle, lowerFirst, type ChecklistLite } from "@/lib/checklists";
import { MONTH_NAMES } from "@/lib/constants";
import { monthLabel, pct, tl } from "@/lib/format";
import { percentText, WEEKDAY_NAMES } from "@/lib/karaoke/occupancy-text";
import type { KasaName } from "@/lib/lafpos/kasa";
import { addDays, daysBetween, longDateTR } from "@/lib/reminders";

import { WEEKLY_BALANCE_MAX_AGE, WEEKLY_CASH_DAYS, WEEKLY_KARAOKE_EMPTY, WEEKLY_MIN_TL, WEEKLY_POS_MIN_DAYS, WEEKLY_SALES_FULL_DAYS, WEEKLY_STOCK_MIN_TL, WEEKLY_WASTE_FACTOR, type WeekInfo, type WeeklyItem } from "./core";
import { trendText } from "./text";

const monthName = (month: string) => MONTH_NAMES[Number(month.slice(5, 7)) - 1];
const upperFirst = (v: string) => `${v.charAt(0).toLocaleUpperCase("tr-TR")}${v.slice(1)}`;
const inLastWeek = (week: WeekInfo, day: string) => day >= week.lastFrom && day <= week.lastTo;
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
/** Gösterilen tam lira aynıysa iki tutar aynı sayılır (detayda yinelenmesin) */
const sameTl = (a: number, b: number) => Math.round(a) === Math.round(b);

// ---------------------------------------------------------------- Zam (insight: priceLoss, salesBasis)

export interface ZamIn {
  /** Ayda tutarların satış ayı (loss.basis.month); satış listesi yoksa null */
  basisMonth: string | null;
  /** Fiyatına bakılacak ürün sayısı (böyle kalsın denmemiş) */
  actionable: number;
  /** priceAlert().title: "Hammadde zammı: 3 ürünün fiyatına bakın" */
  title: string;
  /** Fiyatına bakılacak ürünler (yalnız ayda kaybı olanlar): boy boy, zammın ayda götürdüğü ve hammadde payları */
  products: { productId: number; name: string; monthly: number; drivers: { ingredientId: number; name: string; monthly: number }[] }[];
}

/**
 * En büyük (ürün adı, hammadde) çifti: boylar toplanır ("Latte: Süt %2,5 zammı ayda ≈ 4.800 ₺ kâr kaybı"). Satış ayı
 * yoksa lira değeri olmayan "Hammadde zammı: 3 ürünün fiyatına bakın".
 */
export function zamItem(i: ZamIn): WeeklyItem | null {
  const href = "/panel/urunler#zamlar";
  const action = "Fiyatlara bak";
  if (i.basisMonth === null) {
    if (i.actionable < 1) return null;
    return { key: "zam:fiyat", source: "zam", title: i.title, detail: "Ayda kaç lira tuttuğunu görmek için Satışlar'a ürün satış raporunu yükleyin.", tl: null, href, action };
  }
  const pairs = new Map<string, { name: string; ingredient: string; productId: number; ingredientId: number; monthly: number }>();
  for (const p of i.products) {
    for (const d of p.drivers) {
      const k = `${p.name}\u0000${d.ingredientId}`;
      const cur = pairs.get(k);
      if (cur) {
        cur.monthly += d.monthly;
        cur.productId = Math.min(cur.productId, p.productId);
      } else pairs.set(k, { name: p.name, ingredient: d.name, productId: p.productId, ingredientId: d.ingredientId, monthly: d.monthly });
    }
  }
  const top = [...pairs.values()].sort((a, b) => b.monthly - a.monthly)[0];
  if (!top || top.monthly < WEEKLY_MIN_TL) return null;
  const total = sum(i.products.map((p) => p.monthly));
  const parts = [
    sameTl(total, top.monthly) ? null : `Zamlar toplam ayda ≈ ${tl(total)}`,
    `${i.actionable} ürünün fiyatına bakın`,
    `${monthLabel(i.basisMonth)} satışlarıyla`,
  ].filter(Boolean);
  return {
    key: `zam:${top.productId}:${top.ingredientId}`,
    source: "zam",
    title: `${top.name}: ${top.ingredient} zammı ayda ≈ ${tl(top.monthly)} kâr kaybı`,
    detail: parts.join(" · "),
    tl: top.monthly,
    href,
    action,
  };
}

// ---------------------------------------------------------------- Nakit planı (insight; KDV satırları planın içinde)

export interface CashIn {
  today: string;
  /** Girilen bakiye ve kaç gün önce girildiği; yoksa null */
  opening: { staleDays: number } | null;
  /** İlk eksi gün, o günkü bakiye ve en büyük giderleri (etiket "Maaşlar (Ekim, tahmini)") */
  firstNegative: { date: string; balance: number; top: { title: string; amount: number }[] } | null;
}

/** "1 Kasım Pazar para yetmeyebilir: tahmini −12.400 ₺": bakiye son 7 günde girildiyse ve eksi gün 14 gün içindeyse */
export function cashItem(i: CashIn): WeeklyItem | null {
  const n = i.firstNegative;
  if (!i.opening || i.opening.staleDays > WEEKLY_BALANCE_MAX_AGE || !n) return null;
  if (n.date > addDays(i.today, WEEKLY_CASH_DAYS - 1) || !(n.balance < 0)) return null;
  const top = n.top.map((t) => `${t.title} ${tl(t.amount)}`).join(", ");
  const parts = [top ? `O gün: ${top}` : null, i.opening.staleDays > 3 ? `bakiye ${i.opening.staleDays} gün önce girildi` : null].filter((p): p is string => p !== null);
  return {
    key: `nakit:${n.date}`,
    source: "nakit",
    title: `${longDateTR(n.date)} para yetmeyebilir: tahmini −${tl(-n.balance)}`,
    detail: parts.length ? upperFirst(parts.join(" · ")) : null,
    tl: -n.balance,
    href: "/panel/hatirlaticilar/nakit",
    action: "Nakit planını aç",
  };
}

// ---------------------------------------------------------------- Kasa raporları (kasa, fotograf)

export interface KasaIn {
  week: WeekInfo;
  /**
   * Son beş haftanın raporları (geçen hafta ve önceki dört): Z toplamı, günün cirosu (ödenmez / ikram hariç;
   * src/lib/cash-revenue.ts dayRevenue, verilmezse Z toplamı) ve kasa farkı (eksi eksik)
   */
  reports: { date: string; zTotal: number; revenue?: number; cashDiff: number }[];
  /** Geçen hafta açılışı önceki devirle tutmayan gün; null = bilinmiyor (gösterilmez) */
  carryMismatch: number | null;
  /** Geçen hafta iş günü kapandıktan sonra kasa alanı düzeltilen rapor */
  lateEdits: number | null;
  /** Geçen hafta net okunmuş fotoğraftan farklı yazılan rapor */
  photoDiffs: number | null;
}

/** Bütünlük işaretleri (sıfır ve bilinmeyen yazılmaz) */
function kasaFlags(i: KasaIn): string[] {
  return [
    i.carryMismatch ? `${i.carryMismatch} gün açılış devirle tutmuyor` : null,
    i.lateEdits ? `${i.lateEdits} rapor ertesi gün düzeltildi` : null,
    i.photoDiffs ? `${i.photoDiffs} raporda tutar fotoğraftan farklı` : null,
  ].filter((f): f is string => f !== null);
}

/**
 * Geçen haftanın kasa eksikleri (CASH_TOLERANCE'tan büyük): toplam en az 100 ₺ ise lira değerli madde; değilse
 * bütünlük işareti varsa "Geçen hafta kasa: 2 gün açılış devirle tutmuyor". Bağlantı en çok eksik günün ayına.
 */
export function kasaItem(i: KasaIn): WeeklyItem | null {
  const last = i.reports.filter((r) => inLastWeek(i.week, r.date));
  const short = last.filter((r) => r.cashDiff <= -CASH_TOLERANCE).sort((a, b) => a.cashDiff - b.cashDiff || a.date.localeCompare(b.date));
  const over = last.filter((r) => r.cashDiff >= CASH_TOLERANCE);
  const total = sum(short.map((r) => -r.cashDiff));
  const flags = kasaFlags(i);
  const action = "Kasa raporlarına bak";
  if (short.length && total >= WEEKLY_MIN_TL) {
    const worst = short[0];
    const parts = [
      short.length >= 2 ? `en çok ${longDateTR(worst.date)}: ${tl(-worst.cashDiff)}` : null,
      over.length ? `${over.length} gün fazla: ${tl(sum(over.map((r) => r.cashDiff)))}` : null,
      ...flags,
    ].filter((p): p is string => p !== null);
    return {
      key: `kasa:eksik:${i.week.id}`,
      source: "kasa",
      title: short.length === 1 ? `${longDateTR(worst.date)} kasası ${tl(total)} eksik` : `Kasa geçen hafta ${short.length} gün eksik: toplam ${tl(total)}`,
      detail: parts.length ? upperFirst(parts.join(" · ")) : null,
      tl: total,
      href: `/panel/kasa?ay=${worst.date.slice(0, 7)}`,
      action,
    };
  }
  if (!flags.length) return null;
  return {
    key: `kasa:uyari:${i.week.id}`,
    source: "kasa",
    title: `Geçen hafta kasa: ${flags[0]}`,
    detail: flags.length > 1 ? upperFirst(flags.slice(1).join(" · ")) : null,
    tl: null,
    href: `/panel/kasa?ay=${i.week.lastTo.slice(0, 7)}`,
    action,
  };
}

/**
 * Bağlam satırı: geçen haftanın kasa cirosu (KDV dahil, ödenmez / ikram hariç: Genel bakış ve Bugün'ün cirosuyla aynı
 * kural, denetim HM-08; laffogato.net online kasadan geçmez). Geçen hafta ve önceki dört haftanın en az ikisi tam (6+
 * raporlu) ise onların ortalamasıyla karşılaştırılır; değilse raporlu gün sayısıyla; rapor yoksa satır yok.
 */
export function salesLine(i: Pick<KasaIn, "week" | "reports">): string | null {
  const weekOf = (k: number) => {
    const from = addDays(i.week.lastFrom, -7 * k);
    const to = addDays(i.week.lastTo, -7 * k);
    const rs = i.reports.filter((r) => r.date >= from && r.date <= to);
    // Raporlu gün günde bir kez: iki şubenin aynı günkü raporu bir gün (HM-07; tam hafta eşiği 6 gün)
    return { n: new Set(rs.map((r) => r.date)).size, total: sum(rs.map((r) => r.revenue ?? r.zTotal)) };
  };
  const last = weekOf(0);
  if (!last.n) return null;
  const full = [1, 2, 3, 4].map(weekOf).filter((w) => w.n >= WEEKLY_SALES_FULL_DAYS);
  if (last.n >= WEEKLY_SALES_FULL_DAYS && full.length >= 2) {
    const avg = sum(full.map((w) => w.total)) / full.length;
    return `Geçen hafta kasa cirosu ${tl(last.total)} · ${trendText(last.total, avg)}`;
  }
  return `Geçen hafta kasa cirosu ${tl(last.total)}${last.n < 7 ? ` (${last.n} gün raporlu)` : ""}`;
}

// ---------------------------------------------------------------- Komisyon ve hakediş (komisyon)

export interface KomisyonCand {
  /** commissionAlerts anahtarı: "gecikti:pluxee:2026-10", "oran:…", "yasak:…" */
  alertKey: string;
  kind: "gecikti" | "oran" | "yasak";
  /** Kanalın adı ("Pluxee"); yemek kartlarının toplamında "Yemek kartları" */
  label: string;
  /** Yemek kartlarının toplamı (kart kart oran bilinmiyor) */
  group?: boolean;
  /** Satış ayı (YYYY-MM) */
  month: string;
  /** Uyarının panel yolu (commissionAlerts href) */
  href: string;
  /**
   * Lira değeri: gecikmede beklenen − gelen, aşımda (kesinti − %6 × satış), komisyon dışı ücrette o kalemlerin toplamı
   * (KDV hariç); gecikmede beklenen bilinmiyorsa null
   */
  tl: number | null;
  /** Gecikmede son gün */
  due: string | null;
  /** Aşımda kesinti oranı */
  rate: number | null;
  /** Komisyon dışı ücrette kalemler: "“POS Cihaz Kira Bedeli” 150 ₺" */
  lineText: string | null;
}

/**
 * Komisyonun bütün adayları, lira değerine göre (en büyük önce; değersiz gecikme sonda). 100 ₺'nin altındaki ücret ve
 * gecikme düşer; beklenen tutarı bilinmeyen gecikme değersiz kalır. Detayın sonunda öteki adayların sayısı
 * (" · 2 konu daha"). Sabah e-postasının bugün ilk kez bildirdiği uyarı (`newsKeys`) seçimde düşer, sıradaki geçer.
 */
export function commissionItems(cands: readonly KomisyonCand[]): WeeklyItem[] {
  const ok = cands.filter((c) => (c.tl === null ? c.kind === "gecikti" : c.tl >= WEEKLY_MIN_TL));
  const sorted = [...ok].sort((a, b) => (b.tl ?? -Infinity) - (a.tl ?? -Infinity));
  const more = sorted.length - 1;
  return sorted.map((c) => {
    const mon = monthName(c.month);
    let title: string;
    let detail: string;
    if (c.kind === "gecikti") {
      title = `Hakediş gecikti: ${c.label} (${mon})${c.tl !== null ? ` · ≈ ${tl(c.tl)}` : ""}`;
      detail = `${c.due ? `Son gün ${longDateTR(c.due)} · g` : "G"}eldiyse Komisyon & hakediş'te işaretleyin`;
    } else if (c.kind === "oran") {
      title = `${c.label} ${mon}: ${c.group ? "ortalama kesinti" : "kesinti"} ${pct(c.rate)} · sınırın üstünde ${tl(c.tl)}`;
      detail = "Yemek kartında yasal üst sınır %6";
    } else {
      title = `${c.label} ${mon}: komisyon dışı ücret olabilir · ${tl(c.tl)}`;
      detail = c.lineText ?? "Faturada komisyon dışı kalem var";
    }
    return {
      key: `komisyon:${c.alertKey}`,
      source: "komisyon" as const,
      title,
      detail: more > 0 ? `${detail} · ${more} konu daha` : detail,
      tl: c.tl,
      href: c.href,
      action: "Komisyon & hakedişe bak",
      newsKeys: [`komisyon:${c.alertKey}`],
    };
  });
}

/** Komisyonun en büyük maddesi (yoksa null) */
export function commissionItem(cands: readonly KomisyonCand[]): WeeklyItem | null {
  return commissionItems(cands)[0] ?? null;
}

// ---------------------------------------------------------------- ModPOS'ta eski fiyat (menu, insight dayanağı)

export interface PosPriceIn {
  today: string;
  /** Menünün KDV oranı (Ayarlar › KDV, ör. 0,10) */
  kdv: number;
  /**
   * Kasaya işlenmeyi bekleyen ürünler: paneldeki ve kasadaki fiyat (KDV dahil), beklemeye başladığı gün ve ayda
   * ModPOS'ta satılan adet (salesBasis ölçeğiyle; online kafe siparişi sitenin fiyatını öder, sayılmaz); dayanak yoksa null
   */
  rows: { label: string; price: number; posPrice: number; since: string; perMonth: number | null }[];
  /** Bugünün kasası (src/lib/lafpos/kasa.ts; verilmezse ModPOS): LafPOS gününde satırlar yalnız siteye bağlı olmayanlar */
  kasa?: KasaName;
}

/**
 * Panelde zamlanıp kasada (ModPOS) eski fiyatla satılan ürünlerin ayda kaybı: (fiyat − kasadaki) ÷ (1 + KDV) × adet.
 * İndirim yalnız sayıya girer. 100 ₺'den azsa ya da dayanak yoksa, en eskisi 3 gündür bekliyorsa değersiz hatırlatma.
 */
export function posPriceItem(i: PosPriceIn): WeeklyItem | null {
  if (!i.rows.length) return null;
  const kasa = i.kasa ?? "ModPOS";
  const href = "/panel/urunler/fiyatlar?sekme=kasa";
  const action = "Kasadaki fiyatlara bak";
  const losses = i.rows
    .filter((r) => r.price > r.posPrice && r.perMonth !== null && r.perMonth > 0)
    .map((r) => ({ r, loss: ((r.price - r.posPrice) / (1 + i.kdv)) * r.perMonth! }))
    .sort((a, b) => b.loss - a.loss);
  const total = sum(losses.map((l) => l.loss));
  const n = i.rows.length;
  if (losses.length && total >= WEEKLY_MIN_TL) {
    const top = losses[0].r;
    const days = Math.max(0, daysBetween(top.since, i.today));
    return {
      key: "kasa-fiyat",
      source: "kasa-fiyat",
      title: `${kasa}'ta ${n} ürün eski fiyatla: ayda ≈ ${tl(total)} kâr kaybı`,
      detail: `En çok ${top.label}: kasada ${tl(top.posPrice)}, menüde ${tl(top.price)} · ${days ? `${days} gündür bekliyor` : "bugün değişti"}`,
      tl: total,
      href,
      action,
    };
  }
  const oldest = i.rows.map((r) => r.since).sort()[0];
  if (daysBetween(oldest, i.today) < WEEKLY_POS_MIN_DAYS) return null;
  return { key: "kasa-fiyat", source: "kasa-fiyat", title: `${kasa}'ta ${n} fiyat değişecek`, detail: "Kasada elle değiştirip Fiyatlar › Kasaya işle'de işaretleyin.", tl: null, href, action };
}

// ---------------------------------------------------------------- Zayi ve ikram (kayıtlar)

export interface WasteIn {
  week: WeekInfo;
  /** Son beş haftanın zayi ve ikram kayıtları: gün, ürün ya da hammaddenin adı, malzeme maliyeti (KDV hariç) */
  entries: { date: string; name: string; cost: number }[];
}

/**
 * Kaydın malzeme maliyeti, motorun wasteSummary kuralıyla (src/lib/calc/engine.ts): ürün → reçetenin malzeme toplamı
 * (fire payı olmadan) × adet; hammadde → birim maliyet × adet × çarpan.
 */
export function wasteCost(model: Pick<Model, "productById" | "computeProduct" | "unitCost">, e: Pick<WasteEntry, "productId" | "ingredientId" | "qty" | "factor">): number {
  const product = e.productId !== null ? model.productById.get(e.productId) : undefined;
  if (product) return model.computeProduct(product).ingredientTotal * e.qty;
  return e.ingredientId !== null ? (model.unitCost.get(e.ingredientId) ?? 0) * e.qty * e.factor : 0;
}

/** Geçen haftanın zayi ve ikramı en az 300 ₺ ve önceki dört haftanın ortalamasının 1,5 katı ise */
export function wasteItem(i: WasteIn): WeeklyItem | null {
  const week = (k: number) => {
    const from = addDays(i.week.lastFrom, -7 * k);
    const to = addDays(i.week.lastTo, -7 * k);
    return i.entries.filter((e) => e.date >= from && e.date <= to);
  };
  const lastEntries = week(0);
  const last = sum(lastEntries.map((e) => e.cost));
  const prev = [1, 2, 3, 4].map((k) => week(k));
  const avg = sum(prev.map((w) => sum(w.map((e) => e.cost)))) / 4;
  if (last < Math.max(3 * WEEKLY_MIN_TL, WEEKLY_WASTE_FACTOR * avg)) return null;
  const byName = new Map<string, number>();
  for (const e of lastEntries) byName.set(e.name, (byName.get(e.name) ?? 0) + e.cost);
  const top = [...byName].sort((a, b) => b[1] - a[1])[0];
  const history = prev.some((w) => w.length) ? `önceki 4 haftada ortalama ${tl(avg)}` : "önceki 4 haftada kayıt yok";
  return {
    key: `zayi:${i.week.id}`,
    source: "zayi",
    title: `Geçen hafta zayi ve ikram ${tl(last)}`,
    detail: `Malzeme maliyeti · ${history}${top ? ` · en çok ${top[0]}: ${tl(top[1])}` : ""}`,
    tl: last,
    href: `/panel/zayi?ay=${i.week.lastTo.slice(0, 7)}`,
    action: "Zayi kayıtlarına bak",
  };
}

// ---------------------------------------------------------------- Stok sayımı (tutarlılık)

export interface StockIn {
  /** Sayılan ay (geçen ay) */
  month: string;
  /** En az bir hammaddenin alımı girilmiş ve iki ayı sayılmış (hasStockComparison) */
  comparable: boolean;
  /** Kayıtlı zayi ve ikram düşüldükten sonra açıklanamayan fark (TL, KDV hariç) */
  unexplained: number;
  top: { name: string; amount: number } | null;
}

/** "Ekim sayımında 6.200 ₺ açıklanamayan stok farkı": en az 500 ₺, ay başına bir kez */
export function stockItem(i: StockIn): WeeklyItem | null {
  if (!i.comparable || !(i.unexplained >= WEEKLY_STOCK_MIN_TL)) return null;
  return {
    key: `stok:${i.month}`,
    source: "stok",
    title: `${monthName(i.month)} sayımında ${tl(i.unexplained)} açıklanamayan stok farkı`,
    detail: i.top && i.top.amount > 0 ? `En çok ${i.top.name}: ${tl(i.top.amount)} · kayıtlı zayi ve ikram düşüldü` : "Kayıtlı zayi ve ikram düşüldü",
    tl: i.unexplained,
    href: `/panel/tutarlilik?ay=${i.month}`,
    action: "Tutarlılığa bak",
    once: true,
  };
}

// ---------------------------------------------------------------- Karaoke doluluğu (doluluk)

export interface KaraokeIn {
  /** Öne çıkanlar hesaplanıyor (en az 14 gün ve 8 oturum; insightLines'ın nedeni yok) */
  ready: boolean;
  /** Son 4 haftanın genel doluluğu */
  overall: number | null;
  /** En boş blok: anahtar "1-3:14-17", metin "Salı–Perşembe 14–17" (doluluk ekranının metni) */
  block: { key: string; where: string; ratio: number } | null;
}

/** "Salı–Perşembe 14–17 karaoke %12 dolu": son 4 haftanın en boş bloğu %25'ten az doluysa */
export function karaokeItem(i: KaraokeIn): WeeklyItem | null {
  if (!i.ready || !i.block || !(i.block.ratio < WEEKLY_KARAOKE_EMPTY)) return null;
  return {
    key: `karaoke:bos:${i.block.key}`,
    source: "karaoke",
    title: `${i.block.where} karaoke ${percentText(i.block.ratio)} dolu`,
    detail: `Son 4 haftanın en boş saatleri${i.overall !== null ? ` · genel doluluk ${percentText(i.overall)}` : ""}`,
    tl: null,
    href: "/panel/karaoke/doluluk",
    action: "Doluluğa bak",
  };
}

// ---------------------------------------------------------------- Kontrol listeleri (kontrol)

export interface ChecklistIn {
  week: WeekInfo;
  /**
   * Geçen haftanın günleri: kafe açık mıydı (kasa raporu var ya da kasa raporu henüz kullanılmıyordu), tamamlanmayan
   * günlük listelerin adı ("Kapanış"), sorunlar ("Bar buzdolabı: 6 °C (0–4 °C)"; notsuz, kişisiz)
   */
  days: { day: string; open: boolean; missed: string[]; issues: { label: string; text: string }[] }[];
}

/**
 * Bir günün listelerinden yapıcının girdisi: tamamlanmayan listenin adı, sorunun maddesi ve değeri. Yanıt veren, not ve
 * "Sorun var"ın notu alınmaz (e-postaya kişi adı ve serbest metin gitmez): "Sorun var" yalnız "<madde>: sorun" yazar.
 */
export function checklistDayOf(day: string, open: boolean, lists: readonly Pick<ChecklistLite, "name" | "run">[]): ChecklistIn["days"][number] {
  return {
    day,
    open,
    missed: lists.filter((l) => !l.run?.complete).map((l) => l.name),
    issues: lists.flatMap((l) => l.run?.issues ?? []).map((x) => ({ label: x.label, text: x.kind === "range" ? x.text : `${x.label}: sorun` })),
  };
}

/**
 * Geçen haftanın kontrol listeleri: yapılmayan liste ya da sorun; kasa raporu olmayan gün sayılmaz (kafe kapalı
 * olabilir) ve detayda söylenir. `newsKeys`: katkı veren günlerin sabah e-postası anahtarları ("kontrol:<gün>").
 */
export function checklistItem(i: ChecklistIn): WeeklyItem | null {
  const counted = i.days.filter((d) => inLastWeek(i.week, d.day) && d.open && (d.missed.length || d.issues.length));
  const skipped = i.days.filter((d) => inLastWeek(i.week, d.day) && !d.open && (d.missed.length || d.issues.length)).length;
  if (!counted.length) return null;
  const missed = counted.flatMap((d) => d.missed);
  const issues = counted.flatMap((d) => d.issues);
  const example = issues[0]?.text ?? null;
  let title: string;
  let detail: string | null;
  if (missed.length) {
    const names = new Set(missed.map((m) => listTitle(m)));
    title = names.size === 1 ? `Geçen hafta ${missed.length} ${lowerFirst([...names][0])} yapılmadı` : `Geçen hafta ${missed.length} kontrol listesi yapılmadı`;
    detail = issues.length ? `Ayrıca ${issues.length} sorunlu kayıt (ör. ${example})` : null;
  } else {
    title = `Geçen hafta kontrol listelerinde ${issues.length} sorun`;
    detail = `ör. ${example}`;
  }
  if (skipped) detail = `${detail ? `${detail} · k` : "K"}asa raporu olmayan ${skipped} gün sayılmadı`;
  return {
    key: `kontrol:${i.week.id}`,
    source: "kontrol",
    title,
    detail,
    tl: null,
    href: "/panel/kontrol/gecmis",
    action: "Kontrol geçmişine bak",
    newsKeys: counted.map((d) => `kontrol:${d.day}`),
  };
}

// ---------------------------------------------------------------- Satış tahmini (tahmin)

/**
 * Bağlam satırı: önümüzdeki 7 günün beklenen satışı (kapalı günler hariç) ve en yoğun gün; tahminin kendi verisi varsa
 * (kalite tam, karma ya da ortalama). "Bu hafta" değil "önümüzdeki 7 gün": salı yeniden denemesinde de doğru.
 */
export function forecastLine(i: { quality: string; days: { date: string; amount: number; closed: boolean }[] }): string | null {
  if (!["tam", "karma", "ortalama"].includes(i.quality)) return null;
  const open = i.days.filter((d) => !d.closed && d.amount > 0);
  if (!open.length) return null;
  const total = Math.round(sum(open.map((d) => d.amount)) / 100) * 100;
  const busiest = [...open].sort((a, b) => b.amount - a.amount || a.date.localeCompare(b.date))[0];
  const weekday = WEEKDAY_NAMES[(new Date(`${busiest.date}T12:00:00Z`).getUTCDay() + 6) % 7];
  return `Önümüzdeki 7 gün beklenen satış ≈ ${tl(total)} · en yoğun gün ${weekday}`;
}
