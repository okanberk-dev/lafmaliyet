/**
 * Tahmini stok ve kritik stok uyarısı (docs/STOK-TAHMINI.md). Saf: veritabanı yok; okuyucu
 * src/server/data/stock-estimate.ts, ekran src/app/panel/sayim/tahmini/, testler tests/stok-tahmini.test.ts.
 *
 * Yalnız LafPOS'un şubesi (Marina) için: satış gün gün yalnız LafPOS'tan gelir; ModPOS'un listesi aylıktır, gün gün
 * bölünemez. Her malzeme için, malzemenin kendi biriminde (gr, ml, adet, dilim):
 *
 *   tahmini = son sayım + şubeye gelen faturalı alış − satışın reçeteye göre tüketimi × (1 + genel fire) − zayi ve ikram
 *
 * Stok sayımına, FIFO değerlemeye, mal maliyetine ve Tutarlılık'a dokunmaz: yalnız okuduklarıyla hesaplar.
 */

import { ALL_BRANCHES, type BranchScope } from "./branches";
import { countFactor } from "./calc/engine";
import { evaluateExpression, parseNumberTR } from "./calc/expr";
import type { CountUnit, RecipeItem, Settings, Unit } from "./calc/types";
import { PACKAGING_CATEGORY } from "./constants";
import { num } from "./format";
import { panelWasteCounts } from "./lafpos/ikram";
import { missingLafposDays } from "./lafpos/status";
import { LAFPOS_BRANCH_ID } from "./lafpos/switch";
import { shiftMonth } from "./reminders";

/** Tahmini stoğun şubesi: LafPOS'un kurulu olduğu şube (Marina). Tuzla'nın kasası ModPOS: tahmin yok */
export const STOCK_ESTIMATE_BRANCH = LAFPOS_BRANCH_ID;

/** Ekranın adresi (Stok sayımı'nın alt ekranı: personel de açar, src/lib/roles.ts) */
export const STOCK_ESTIMATE_PATH = "/panel/sayim/tahmini";

/**
 * Kart ve okuma kapısı: tahmin yalnız Marina'nındır. Marina ya da "Tümü" seçiliyken görünür; Tuzla ve online kanal
 * seçiliyken (şubesine kilitli personelde seçim zaten kendi şubesidir) hiçbir şey okunmaz ve çizilmez: Tuzla'nın
 * ekranı ve davranışı değişmez.
 */
export function showsStockEstimate(scope: BranchScope): boolean {
  return scope === ALL_BRANCHES || scope === STOCK_ESTIMATE_BRANCH;
}

// ---------------------------------------------------------------- Girdi

/** Listedeki malzeme (sayım listesindekiler: sayım birimi olan aktif ya da aktif reçetede geçen) */
export interface EstimateIngredient {
  id: number;
  name: string;
  /** Kendi birimi: reçete, zayi ve alış bu birimde */
  unit: Unit;
  /** Sayım birimi (KG, LT, ADET, DİLİM): ekran ve eşik bu birimde */
  countUnit: CountUnit | null;
  category: string;
  sortOrder: number;
}

/** Şubenin bir ayın sonundaki sayımı (stock_counts) */
export interface EstimateCount {
  month: string;
  ingredientId: number;
  qty: number;
  /** Sayıldığı birimin çarpanı (KG/LT 1000); eski satırda boş: bugünkü sayım biriminin çarpanı */
  factor: number | null;
}

/** Şubeye geldiği işaretli faturanın bir hammaddeye düşen miktarı (kendi biriminde; iade faturasında eksi) */
export interface EstimatePurchase {
  invoiceId: number;
  ingredientId: number;
  /** Fatura tarihi (YYYY-MM-DD) */
  date: string;
  qty: number;
}

/** LafPOS'un bir gün sonu satırı (pos_daily_sales, şubenin) */
export interface EstimateSale {
  date: string;
  posName: string;
  productId: number | null;
  /** Paneldeki adı ("Latte M"); atlanan satırın adında kullanılır, yoksa POS adı */
  productName?: string | null;
  isService: boolean;
  qty: number;
}

/** Panele girilmiş zayi ya da ikram (şubenin) */
export interface EstimatePanelWaste {
  date: string;
  kind: "zayi" | "ikram";
  productId: number | null;
  ingredientId: number | null;
  /** Kayıttaki ad (atlanan satırın adı) */
  name: string;
  qty: number;
  /** qty × factor = hammaddenin kendi birimi; ürün kaydında 1 */
  factor: number;
}

/** LafPOS'un gün sonuyla gelen ikram ya da zayi satırı (şubenin) */
export interface EstimateLafposWaste {
  date: string;
  kind: "zayi" | "ikram";
  posName: string;
  productId: number | null;
  productName?: string | null;
  isService?: boolean;
  qty: number;
}

/** Ürünün bir adedinin harcadığı malzeme (kendi biriminde, fire hariç; formül hesaplanmış) */
export interface EstimateRecipeItem {
  productId: number;
  ingredientId: number;
  qty: number;
}

export interface StockEstimateInput {
  /** İş günü (YYYY-MM-DD, 05:00 kuralı) */
  today: string;
  /** LafPOS satışlarının sayıldığı ilk gün (lafposSalesCountFrom); null: geçiş günü yok, tahmin yok */
  lafposFrom: string | null;
  /** Şubenin gelen LafPOS gün sonları */
  receivedDays: readonly string[];
  /** Şubenin kapalı işaretli günleri (gün sonu gelmeyen gün sayılırken düşülür) */
  closedDays?: readonly string[];
  ingredients: readonly EstimateIngredient[];
  counts: readonly EstimateCount[];
  purchases: readonly EstimatePurchase[];
  sales: readonly EstimateSale[];
  panelWaste: readonly EstimatePanelWaste[];
  lafposWaste: readonly EstimateLafposWaste[];
  recipe: readonly EstimateRecipeItem[];
  /** Genel fire (Ayarlar, 0,05): satış tüketimine bir kez eklenir */
  fireRate: number;
  /** Ayarlar: fire ambalaja uygulanmaz (Ambalaj kategorisi) */
  fireExcludesPackaging?: boolean;
  /** Kritik eşikler, malzemenin kendi biriminde */
  thresholds: ReadonlyMap<number, number>;
}

// ---------------------------------------------------------------- Çıktı

/**
 * Malzemenin durumu: `tahmin` hesaplandı; `sayim-yok` şubede bitmiş bir ayda hiç sayılmadı; `lafpos-oncesi` son
 * sayımdan sonraki dönem LafPOS'un sayıldığı ilk günden önce başlıyor (o günlerin satışı gün gün bilinmiyor)
 */
export type EstimateStatus = "tahmin" | "sayim-yok" | "lafpos-oncesi";

export interface StockEstimateLine {
  ingredientId: number;
  name: string;
  /** Ekrandaki birim (sayım birimi; yoksa kendi birimi) ve çarpanı */
  unit: string;
  factor: number;
  status: EstimateStatus;
  /** Son sayımın ayı */
  countMonth: string | null;
  /** Dönemin ilk günü (sayımın ertesi ayının 1'i) */
  from: string | null;
  /** Kendi biriminde: sayım, alış, satış tüketimi (fire dahil), zayi ve ikram; tahmin yoksa null */
  counted: number | null;
  purchased: number | null;
  sold: number | null;
  wasted: number | null;
  estimate: number | null;
  /** Kritik eşik (kendi biriminde); yoksa null */
  threshold: number | null;
  /** Tahmin var, eşik var ve tahmin eşiğe eşit ya da altında */
  critical: boolean;
}

/** Tüketime giremeyen satırlar: ürüne bağlı olmayan ya da reçetesi boş ürün */
export interface SkippedRows {
  /** Satır sayısı (gün sonu satırı ya da zayi / ikram kaydı) */
  lines: number;
  /** Toplam adet */
  qty: number;
  /** Ayrı ad sayısı */
  names: number;
  /** En çok adetli ilk beş ad */
  top: string[];
}

export interface StockEstimate {
  /** Kritikler önce (eşiğe oranla en düşük), sonra sayım listesinin sırası */
  lines: StockEstimateLine[];
  critical: StockEstimateLine[];
  /** Tahmini olan malzemelerin en erken dönem başı; tahmin yoksa null */
  from: string | null;
  /** Hesaba giren son gün sonu; yoksa null */
  lastDay: string | null;
  /** Dönemde gün sonu gelmeyen (kapalı işaretli olmayan) günler, bugün hariç */
  missingDays: string[];
  /** Ürüne bağlı olmayan satış, ikram ve zayi satırları (atlandı) */
  unmatched: SkippedRows;
  /** Reçetesi boş ürünün satış, ikram ve zayi satırları (atlandı) */
  noRecipe: SkippedRows;
  /** Durum sayıları */
  counts: Record<EstimateStatus, number>;
}

// ---------------------------------------------------------------- Yardımcılar

const EPS = 1e-9;

/** Ekrandaki birim ve çarpanı: sayım birimi (KG, LT, ADET, DİLİM), yoksa kendi birimi */
export function displayUnit(ing: { unit: Unit; countUnit: CountUnit | null }): { unit: string; factor: number } {
  return ing.countUnit ? { unit: ing.countUnit, factor: countFactor(ing.countUnit) } : { unit: ing.unit, factor: 1 };
}

/** Sayılan miktar kendi biriminde: sayıldığı çarpanla (motorla aynı kural, engine.ts stockSheet) */
export function countedQty(c: Pick<EstimateCount, "qty" | "factor">, countUnit: CountUnit | null): number {
  return c.qty * (c.factor ?? countFactor(countUnit));
}

/** Reçete satırının bir adetteki miktarı: formül Ayarlar'daki değerlerle, hatalıysa yazılı miktar (engine.ts evalQty) */
export function recipeQty(it: Pick<RecipeItem, "qty" | "qtyExpr">, st: Settings): number {
  if (!it.qtyExpr) return it.qty ?? 0;
  try {
    return evaluateExpression(it.qtyExpr, st);
  } catch {
    return it.qty ?? 0;
  }
}

/** Reçete satırları → ürünün bir adedinin malzemesi */
export function recipePerUnit(items: readonly Pick<RecipeItem, "productId" | "ingredientId" | "qty" | "qtyExpr">[], st: Settings): EstimateRecipeItem[] {
  return items.map((it) => ({ productId: it.productId, ingredientId: it.ingredientId, qty: recipeQty(it, st) }));
}

/** Miktar ekrandaki birimde: "1,81 KG", "12 ADET" (KG ve LT iki, öteki birimler bir ondalık) */
export function stockQty(own: number, d: { unit: string; factor: number }): string {
  return `${num(own / d.factor, d.factor >= 1000 ? 2 : 1)} ${d.unit}`;
}

/** Eşik alanının değeri (sayım biriminde, binlik ayraçsız): 2500 gr → "2,5" */
export function thresholdInputValue(own: number | null, factor: number): string {
  if (own === null) return "";
  return String(Math.round((own / factor) * 1000) / 1000).replace(".", ",");
}

/**
 * Yazılan eşik (sayım biriminde) → kendi biriminde: "2,5" KG → 2500. Boş: eşik yok (silinir). Okunamayan, eksi ya da
 * dev değer hata metni döner (eylem de aynı kuralla reddeder).
 */
export function parseThresholdInput(raw: string, factor: number): { value: number | null } | { error: string } {
  const text = raw.trim();
  if (!text) return { value: null };
  const v = parseNumberTR(text);
  if (v === null) return { error: "Eşiği sayıyla yazın (ör. 2,5)" };
  if (v < 0) return { error: "Eşik eksi olamaz" };
  if (v > 100_000) return { error: "Eşik çok büyük" };
  return { value: v * factor };
}

/** Sayımın ertesi ayının 1'i: ay sonu sayımından sonraki dönemin ilk günü */
export function periodStart(countMonth: string): string {
  return `${shiftMonth(countMonth, 1)}-01`;
}

/** Atlanan satırların sayacı */
function skipCounter() {
  const byName = new Map<string, number>();
  let lines = 0;
  let qty = 0;
  return {
    add(name: string, q: number) {
      lines++;
      qty += q;
      const key = name.replace(/\s+/g, " ").trim();
      byName.set(key, (byName.get(key) ?? 0) + q);
    },
    done(): SkippedRows {
      const top = [...byName.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "tr")).slice(0, 5).map(([n]) => n);
      return { lines, qty, names: byName.size, top };
    },
  };
}

const add = (m: Map<number, number>, id: number, v: number) => m.set(id, (m.get(id) ?? 0) + v);

// ---------------------------------------------------------------- Hesap

/**
 * Şubenin tahmini stoğu. Her malzeme kendi son sayımından başlar: şubenin o malzemeyi saydığı en son bitmiş ay (süren
 * ayın sayımı ay bitince girer). Dönem sayımın ertesi ayının 1'inden bugüne; dönem LafPOS'un sayıldığı ilk günden önce
 * başlıyorsa tahmin yok (`lafpos-oncesi`). Satış reçeteye göre × (1 + genel fire); zayi ve ikram reçeteden ya da
 * hammadde olarak, fire eklenmeden. Panele girilmiş ürün ikramı LafPOS'un gün sonu gelen gününde sayılmaz (her gün tek
 * kaynak, panelWasteCounts). Ürüne bağlı olmayan ve reçetesi boş ürünün satırları atlanır ve sayılır; hizmet satırı
 * (karaoke) sayılmaz.
 */
export function estimateStock(input: StockEstimateInput): StockEstimate {
  const { today, lafposFrom } = input;
  const running = today.slice(0, 7);
  const received = new Set(input.receivedDays);

  // Son sayım: bitmiş ayların en yenisi (malzeme başına)
  const lastCount = new Map<number, EstimateCount>();
  for (const c of input.counts) {
    if (c.month >= running) continue;
    const cur = lastCount.get(c.ingredientId);
    if (!cur || c.month > cur.month) lastCount.set(c.ingredientId, c);
  }

  // Dönem ve durum
  const period = new Map<number, { status: EstimateStatus; from: string | null; count: EstimateCount | null }>();
  for (const ing of input.ingredients) {
    const c = lastCount.get(ing.id) ?? null;
    if (!c) {
      period.set(ing.id, { status: "sayim-yok", from: null, count: null });
      continue;
    }
    const from = periodStart(c.month);
    const status: EstimateStatus = lafposFrom !== null && from >= lafposFrom ? "tahmin" : "lafpos-oncesi";
    period.set(ing.id, { status, from, count: c });
  }
  const starts = [...period.values()].filter((p) => p.status === "tahmin").map((p) => p.from as string);
  const windowFrom = starts.length ? starts.reduce((a, b) => (b < a ? b : a)) : null;
  const inWindow = (date: string) => windowFrom !== null && date >= windowFrom && date <= today;
  const inPeriod = (ingredientId: number, date: string) => {
    const p = period.get(ingredientId);
    return p?.status === "tahmin" && date >= (p.from as string) && date <= today;
  };

  const recipeOf = new Map<number, EstimateRecipeItem[]>();
  for (const r of input.recipe) {
    const list = recipeOf.get(r.productId);
    if (list) list.push(r);
    else recipeOf.set(r.productId, [r]);
  }

  const sold = new Map<number, number>();
  const wasted = new Map<number, number>();
  const bought = new Map<number, number>();
  const unmatched = skipCounter();
  const noRecipe = skipCounter();
  /** Ürünün reçetesini `into`'ya ekler; reçete boşsa false */
  const consume = (productId: number, qty: number, date: string, into: Map<number, number>): boolean => {
    const items = recipeOf.get(productId);
    if (!items?.length) return false;
    for (const it of items) if (inPeriod(it.ingredientId, date)) add(into, it.ingredientId, it.qty * qty);
    return true;
  };

  // Satış: LafPOS'un gün sonu satırları
  for (const s of input.sales) {
    if (s.isService || !inWindow(s.date)) continue;
    if (s.productId === null) unmatched.add(s.posName, s.qty);
    else if (!consume(s.productId, s.qty, s.date, sold)) noRecipe.add(s.productName ?? s.posName, s.qty);
  }

  // Zayi ve ikram: panel (her gün tek kaynak) ve LafPOS'un gün sonu
  for (const w of input.panelWaste) {
    if (!inWindow(w.date) || !panelWasteCounts({ ...w, branchId: STOCK_ESTIMATE_BRANCH }, received)) continue;
    if (w.productId !== null) {
      if (!consume(w.productId, w.qty, w.date, wasted)) noRecipe.add(w.name, w.qty);
    } else if (w.ingredientId !== null && inPeriod(w.ingredientId, w.date)) {
      add(wasted, w.ingredientId, w.qty * w.factor);
    }
  }
  for (const l of input.lafposWaste) {
    if (l.isService || !inWindow(l.date)) continue;
    if (l.productId === null) unmatched.add(l.posName, l.qty);
    else if (!consume(l.productId, l.qty, l.date, wasted)) noRecipe.add(l.productName ?? l.posName, l.qty);
  }

  // Alış: şubeye geldiği işaretli faturalar (iade eksi)
  for (const p of input.purchases) if (inPeriod(p.ingredientId, p.date)) add(bought, p.ingredientId, p.qty);

  const lines: StockEstimateLine[] = input.ingredients.map((ing) => {
    const p = period.get(ing.id)!;
    const d = displayUnit(ing);
    const threshold = input.thresholds.get(ing.id) ?? null;
    const base = { ingredientId: ing.id, name: ing.name, unit: d.unit, factor: d.factor, status: p.status, countMonth: p.count?.month ?? null, from: p.from, threshold };
    if (p.status !== "tahmin" || !p.count) {
      return { ...base, counted: null, purchased: null, sold: null, wasted: null, estimate: null, critical: false };
    }
    const fire = input.fireExcludesPackaging && ing.category === PACKAGING_CATEGORY ? 0 : input.fireRate;
    const counted = countedQty(p.count, ing.countUnit);
    const purchased = bought.get(ing.id) ?? 0;
    const soldQty = (sold.get(ing.id) ?? 0) * (1 + fire);
    const wastedQty = wasted.get(ing.id) ?? 0;
    const estimate = counted + purchased - soldQty - wastedQty;
    return { ...base, counted, purchased, sold: soldQty, wasted: wastedQty, estimate, critical: threshold !== null && estimate <= threshold + EPS };
  });

  const order = new Map(input.ingredients.map((ing, i) => [ing.id, i]));
  // Eşiğe oranla: en çok azalan önce (eşik 0'da tahmin ≤ 0 en önde)
  const ratio = (l: StockEstimateLine) => ((l.threshold ?? 0) > 0 ? (l.estimate as number) / (l.threshold as number) : -1);
  const critical = lines.filter((l) => l.critical).sort((a, b) => ratio(a) - ratio(b) || a.name.localeCompare(b.name, "tr"));
  const rest = lines.filter((l) => !l.critical).sort((a, b) => (order.get(a.ingredientId) ?? 0) - (order.get(b.ingredientId) ?? 0));

  const days = input.receivedDays.filter(inWindow);
  const counts: Record<EstimateStatus, number> = { tahmin: 0, "sayim-yok": 0, "lafpos-oncesi": 0 };
  for (const l of lines) counts[l.status]++;
  return {
    lines: [...critical, ...rest],
    critical,
    from: windowFrom,
    lastDay: days.length ? days.reduce((a, b) => (b > a ? b : a)) : null,
    missingDays: missingLafposDays(windowFrom, today, received, input.closedDays ?? [], 62),
    unmatched: unmatched.done(),
    noRecipe: noRecipe.done(),
    counts,
  };
}

// ---------------------------------------------------------------- Kart

export interface StockAlertItem {
  ingredientId: number;
  name: string;
  /** "≈ 1,81 KG · eşik 2 KG" */
  text: string;
}

/** Genel bakış ve Bugün'ün kartı: en çok `max` kritik kalem ve kalanların sayısı */
export function stockAlertItems(critical: readonly StockEstimateLine[], max = 4): { items: StockAlertItem[]; more: number } {
  const items = critical.slice(0, max).map((l) => ({
    ingredientId: l.ingredientId,
    name: l.name,
    text: `≈ ${stockQty(l.estimate ?? 0, l)} · eşik ${stockQty(l.threshold ?? 0, l)}`,
  }));
  return { items, more: Math.max(0, critical.length - items.length) };
}
