/**
 * Paraşüt faturasından gelen büyük fiyat sıçramasının onayı (docs/PARASUT.md 5b). Saf kurallar;
 * tests/fiyat-onayi.test.ts.
 *
 * Bağlı ürünün en yeni faturasındaki birim fiyat hammaddenin şimdiki birim fiyatından %40'tan fazla farklıysa
 * kendiliğinden yazılmaz, onaya düşer: yanlış çarpan (koli ↔ adet, kg ↔ gr) ya da tek seferlik bir fatura bütün reçete
 * maliyetlerini sessizce değiştirmesin, sahte "Hammadde zammı" uyarısı ve fiyat önerisi çıkmasın. %40 içi eskisi gibi
 * sessizce uygulanır. Onay bekleyen fiyat ingredient_prices'a yazılmaz: onaylanana kadar zam da sayılmaz.
 */

import { priceProduct, type Model } from "./calc/engine";
import { dateTR, num } from "./format";

/** ±%40: bundan büyük fark onaya düşer (metinler "%40'tan fazla" der; değişirse onlar da değişmeli) */
export const PRICE_HOLD_PCT = 0.4;
/** Eşitlemenin eski kuralı: %0,5'ten küçük fark yazılmaz */
export const SAME_PCT = 0.005;
/** Ardışık faturalarda "aynı fiyat" toleransı */
export const REPEAT_PCT = 0.1;
/** Kayan nokta payı: tam %40 (32 → 44,80) onaya düşmez */
const EPS = 1e-9;

/** Hammaddeler sayfasındaki "Onay bekleyen fiyatlar" kartının çapası; zil, Genel bakış ve e-posta buraya getirir */
export const HOLDS_ANCHOR = "fiyat-onayi";
export const HOLDS_HREF = `/panel/hammaddeler#${HOLDS_ANCHOR}`;

export type PriceStep = "same" | "apply" | "hold";

/**
 * Yeni birim fiyatın akıbeti. before: hammaddenin şimdiki birim fiyatı; exempt: su/buz (fiyatı su faturasından,
 * model paket fiyatına bakmaz). Şimdiki fiyat yoksa (0: personelin sayımdan eklediği kalem) korunacak bir şey yoktur,
 * ilk fiyat doğrudan yazılır. Tam ±%40 uygulanır; yalnız daha büyük fark onaya düşer.
 */
export function priceStep(i: { before: number; after: number; exempt?: boolean; threshold?: number }): PriceStep {
  if (!(i.before > 0)) return "apply";
  const change = Math.abs(i.after / i.before - 1);
  if (change < SAME_PCT) return "same";
  if (!i.exempt && change > (i.threshold ?? PRICE_HOLD_PCT) + EPS) return "hold";
  return "apply";
}

/**
 * Çarpan ipucunun aradığı katlar: 2–20 arası her tam sayı ve paket boyları (düzine, koli, 250 gr, 750 ml, kg ↔ gr).
 * En yakın tam sayı yetmez: 987 kat "çarpan 987 katı olsun" değil "kg ↔ gr karışmış (1000)" demektir.
 */
const HINT_TIMES = [
  ...Array.from({ length: 19 }, (_, i) => i + 2),
  24, 25, 30, 36, 40, 48, 50, 60, 72, 75, 80, 96, 100, 120, 125, 144, 150, 200, 240, 250, 300, 400, 500, 600, 750, 1000,
];
/** İpucunun payı: fiyat katın ±%5'i içindeyse */
const HINT_TOL = 0.05;

export interface FactorHint {
  /** Bağlantının çarpanı bununla çarpılırsa fiyat şimdikine yaklaşır */
  multiplier: number;
  /** Fiyat şimdikinin kaç katı (up) ya da kaçta biri (down) */
  times: number;
  direction: "up" | "down";
}

/** Fiyat şimdikinin yaklaşık tam katı ya da tam bölümüyse (2..1000, ±%5) çarpan ipucu; değilse null */
export function factorHint(before: number, after: number): FactorHint | null {
  if (!(before > 0) || !(after > 0)) return null;
  const up = after >= before;
  const ratio = up ? after / before : before / after;
  let best: number | null = null;
  for (const t of HINT_TIMES) {
    const off = Math.abs(ratio / t - 1);
    if (off <= HINT_TOL && (best === null || off < Math.abs(ratio / best - 1))) best = t;
  }
  if (best === null) return null;
  return { times: best, direction: up ? "up" : "down", multiplier: up ? best : 1 / best };
}

/** Önerilecek yeni çarpan: tam sayıysa (≥1) döner, değilse null (düğme gösterilmez, yalnız uyarı metni) */
export function suggestedFactor(factor: number, hint: { multiplier: number }): number | null {
  const next = factor * hint.multiplier;
  const whole = Math.round(next);
  return whole >= 1 && Math.abs(next - whole) < 1e-6 * whole ? whole : null;
}

/**
 * Ardışık benzer fiyat sayısı ("Son 2 faturada da bu fiyat"): önceki öneri başka faturadan ve birim fiyatı ±%10
 * içindeyse bir artar; aynı faturanın yeniden değerlendirilmesi sayıyı değiştirmez.
 */
export function nextRepeats(prev: { invoiceId: number; unitPrice: number; repeats: number } | null, cur: { invoiceId: number; unitPrice: number }): number {
  if (!prev) return 1;
  if (prev.invoiceId === cur.invoiceId) return prev.repeats;
  return prev.unitPrice > 0 && Math.abs(cur.unitPrice / prev.unitPrice - 1) <= REPEAT_PCT + EPS ? prev.repeats + 1 : 1;
}

/** Bağlantı öneri anından beri değiştiyse nedeni (öneri geçersiz olur); değişmediyse null */
export function linkChange(
  hold: { ingredientId: number; factor: number },
  link: { ingredientId: number; factor: number; updatePrice: boolean } | null | undefined,
): string | null {
  if (!link) return "Bağlantı kaldırıldı";
  if (link.ingredientId !== hold.ingredientId) return "Bağlantı başka hammaddeye geçti";
  if (link.factor !== hold.factor) return "Çarpan değişti";
  if (!link.updatePrice) return "Fiyat güncellemesi kapatıldı";
  return null;
}

/**
 * Geçersiz kalan bekleyen öneriler ve nedeni: bağlantı silindi, başka hammaddeye geçti, çarpanı değişti, fiyat
 * güncellemesi kapandı ya da faturanın kalemi fiyat kapsamından çıktı (fatura kafe dışına taşındı, Paraşüt'te iptal
 * edilen elle girilmiş kaydın kalemleri silindi). `lines`: fiyat kapsamındaki bağlı kalemler.
 */
export function staleHolds(
  pending: { id: number; ingredientId: number; productKey: string; factor: number; invoiceId: number }[],
  links: { productKey: string; ingredientId: number; factor: number; updatePrice: boolean }[],
  lines: { invoiceId: number; productKey: string }[],
): { id: number; reason: string }[] {
  const byKey = new Map(links.map((l) => [l.productKey, l]));
  const present = new Set(lines.map((l) => `${l.invoiceId}|${l.productKey}`));
  const out: { id: number; reason: string }[] = [];
  for (const h of pending) {
    const reason = linkChange(h, byKey.get(h.productKey)) ?? (present.has(`${h.invoiceId}|${h.productKey}`) ? null : "Faturadaki kalem artık yok");
    if (reason) out.push({ id: h.id, reason });
  }
  return out;
}

/**
 * Aynı hammaddenin, verilen faturadan önceki (aynı gün başka fatura dahil) en yeni ücretli faturasındaki birim fiyat:
 * hammaddeye bağlı bütün ürünlerin kalemleri, her biri kendi çarpanıyla; aynı faturanın kalemleri birlikte (Σnet ÷
 * Σ miktar × çarpan). Bedava kalem ve iade sayılmaz. Kartta "Önceki fatura" (başka tedarikçi de olabilir).
 */
export function previousInvoicePrice(
  lines: { invoiceId: number; productKey: string; date: string; supplier: string; quantity: number; netTotal: number }[],
  links: Map<string, { ingredientId: number; factor: number }>,
  ingredientId: number,
  current: { invoiceId: number; date: string },
): { unitPrice: number; date: string; supplier: string } | null {
  const byInvoice = new Map<number, { date: string; supplier: string; net: number; base: number }>();
  for (const l of lines) {
    const link = links.get(l.productKey);
    if (!link || link.ingredientId !== ingredientId || !(link.factor > 0)) continue;
    if (l.invoiceId === current.invoiceId || l.date > current.date) continue;
    if (!(l.quantity > 0) || !(l.netTotal > 0)) continue;
    const agg = byInvoice.get(l.invoiceId) ?? { date: l.date, supplier: l.supplier, net: 0, base: 0 };
    agg.net += l.netTotal;
    agg.base += l.quantity * link.factor;
    byInvoice.set(l.invoiceId, agg);
  }
  let best: { id: number; date: string; supplier: string; net: number; base: number } | null = null;
  for (const [id, a] of byInvoice) if (!best || a.date > best.date || (a.date === best.date && id > best.id)) best = { id, ...a };
  return best ? { unitPrice: best.net / best.base, date: best.date, supplier: best.supplier } : null;
}

export interface HoldImpact {
  /** Hammaddeyi kullanan, maliyeti olan etkin ürün sayısı */
  products: number;
  /** Maliyeti en çok değişen (en çok 3) ürün */
  top: { productId: number; name: string; size: string; costBefore: number; costAfter: number }[];
}

/**
 * Onaylanırsa ürün maliyetleri: hammaddenin birim fiyatı önerilen olsaydı (aynı reçete, Reçete Kartı formülü). Önerilen
 * fiyat modelde olmadığı için price-impact.ts'teki productImpacts kullanılamaz (o, modeldeki fiyatı "sonra" sayar).
 * Aylık etki bilerek yok: onay için yüzde, etkilenen ürünler ve en büyük maliyet değişimi yeter.
 */
export function holdImpact(model: Model, ingredientId: number, proposedUnit: number): HoldImpact {
  const all: HoldImpact["top"] = [];
  for (const p of model.activeProducts) {
    if (!(p.cost > 0) || !p.lines.some((l) => l.item.ingredientId === ingredientId)) continue;
    const after = priceProduct(
      p.product,
      p.lines.map((l) => ({ qty: l.qty, unitCost: l.item.ingredientId === ingredientId ? proposedUnit : l.unitCost, vatRate: l.vatRate, isPackaging: l.isPackaging })),
      model.settings,
    );
    all.push({ productId: p.product.id, name: p.product.name, size: p.product.size, costBefore: p.cost, costAfter: after.cost });
  }
  const top = [...all].sort((a, b) => Math.abs(b.costAfter - b.costBefore) - Math.abs(a.costAfter - a.costBefore)).slice(0, 3);
  return { products: all.length, top };
}

/** Önerilen fiyatın şimdikine göre farkı (0,52 = %52 pahalı); şimdiki fiyat yoksa null */
export function livePct(proposedUnit: number, currentUnit: number): number | null {
  return currentUnit > 0 ? proposedUnit / currentUnit - 1 : null;
}

/**
 * "+%52" / "−%45" / "+%1.103". İşaret ile yüzde arasında görünmez kelime birleştirici (U+2060): dar sütunda (zil)
 * "−" satır sonunda tek başına kalmasın
 */
export function signedPct(p: number): string {
  return `${p >= 0 ? "+" : "−"}\u2060%${num(Math.abs(p) * 100)}`;
}

/** "Süt +%52, Kahve −%45 ve 2 hammadde daha" (en çok 3) */
export function holdsSummary(items: { name: string; pct: number | null }[], max = 3): string {
  const head = items.slice(0, max).map((i) => (i.pct === null ? i.name : `${i.name} ${signedPct(i.pct)}`));
  return items.length > max ? `${head.join(", ")} ve ${items.length - max} hammadde daha` : head.join(", ");
}

/** İşlem geçmişi için: "Süt +%52 (Sütaş 21.10.2026)" */
export function holdLogText(h: { name: string; pct: number | null; supplier: string; date: string }): string {
  return `${h.name}${h.pct === null ? "" : ` ${signedPct(h.pct)}`} (${h.supplier} ${dateTR(h.date)})`;
}

/** Genel bakış ve zil metni (insights.Alert biçimi); bekleyen yoksa null */
export function holdAlert(holds: { name: string; pct: number | null }[]): { level: "warning"; title: string; detail: string; href: string } | null {
  if (!holds.length) return null;
  return {
    level: "warning",
    title: `Fiyat onayı: ${holds.length} hammadde`,
    detail: `Faturadaki fiyat şimdikinden %40'tan fazla farklı: ${holdsSummary(holds)}. Onaylanana kadar maliyetler şimdiki fiyatla hesaplanır.`,
    href: HOLDS_HREF,
  };
}
