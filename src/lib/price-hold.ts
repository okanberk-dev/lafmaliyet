/**
 * Paraşüt faturasından gelen büyük fiyat sıçramasının onayı (docs/PARASUT.md 5b). Saf kurallar;
 * tests/fiyat-onayi.test.ts.
 *
 * Bağlı ürünün en yeni faturasındaki birim fiyat hammaddenin şimdiki birim fiyatından %40'tan fazla farklıysa
 * kendiliğinden yazılmaz, onaya düşer: yanlış çarpan (koli ↔ adet, kg ↔ gr) ya da tek seferlik bir fatura bütün reçete
 * maliyetlerini sessizce değiştirmesin, sahte "Hammadde zammı" uyarısı ve fiyat önerisi çıkmasın. %40 içi eskisi gibi
 * sessizce uygulanır. Onay bekleyen fiyat ingredient_prices'a yazılmaz: onaylanana kadar zam da sayılmaz.
 */

import { ALL_BRANCHES, type BranchScope } from "./branches";
import { priceProduct, type Model } from "./calc/engine";
import { dateTR, num, tl2, tlUnit } from "./format";
import { sameFactor, type PackEvidence } from "./product-match";
import { addDays } from "./reminders";
import { bulkUnit } from "./supplier-prices";

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

/**
 * Önerinin seçimdeki yeri (şube ayrımı parça 5): öneri bir faturadan gelir, faturanın şubesi önerinin şubesidir. "Tümü"de
 * hepsi; şube seçiliyken o şubenin faturasından ve şubesi boş (işletme geneli ya da seçilmemiş) faturadan gelenler,
 * faturası okunamayan da. Öbür şubenin faturasından gelen öneri sayı olarak ("öbür şubelerde N öneri"). Onay ve red
 * hammaddenin ortak fiyatını değiştirir: eylem seçime bakmaz
 */
export function holdInScope(invoiceBranch: string | null | undefined, scope: BranchScope): boolean {
  return scope === ALL_BRANCHES || invoiceBranch === null || invoiceBranch === undefined || invoiceBranch === scope;
}

/** "Öbür şubelerde 2 öneri daha: Tümü'de görünür." (yoksa null) */
export function holdsElsewhereText(n: number): string | null {
  return n > 0 ? `Öbür şubelerde ${num(n)} öneri daha: Tümü'de görünür.` : null;
}

export type PriceStep = "same" | "apply" | "hold";

/**
 * Yeni birim fiyatın akıbeti. before: hammaddenin şimdiki birim fiyatı; exempt: su/buz (fiyatı su faturasından,
 * model paket fiyatına bakmaz). Tam ±%40 uygulanır; yalnız daha büyük fark onaya düşer.
 *
 * İlk fiyat (şimdiki fiyat yok, 0: personelin sayımdan fiyatsız eklediği kalem): karşılaştırılacak fiyat olmadığı için
 * %40 kuralı işlemez ama çarpan yanlışsa ilk fiyat da yanlış yazılırdı, onay kartı da çıkmazdı ("KARTON BARDAK 8 OZ
 * 50'Lİ X 20" 1 Koli = 50 adet: adet 8 ₺, doğrusu 0,40 ₺). Çarpan faturanın ölçü biriminden geliyorsa (`firstCertain`:
 * 1 kg = 1000 gr, düzine; firstPriceCertain) yazılır, addan, açıklamadan ya da elle gelen çarpanla onaya düşer.
 */
export function priceStep(i: { before: number; after: number; exempt?: boolean; threshold?: number; firstCertain?: boolean }): PriceStep {
  if (!(i.before > 0)) return i.exempt || i.firstCertain ? "apply" : "hold";
  const change = Math.abs(i.after / i.before - 1);
  if (change < SAME_PCT) return "same";
  if (!i.exempt && change > (i.threshold ?? PRICE_HOLD_PCT) + EPS) return "hold";
  return "apply";
}

/**
 * İlk fiyatın çarpanı kesin mi (priceStep `firstCertain`): faturadaki birim ölçü birimiyse (kg, lt, gr, ml) ya da düzineyse
 * çarpan birim çevirisidir ve bağlantınınkiyle aynı. Adın ya da açıklamanın paket boyu kesin değildir (iki sayılı ad,
 * koliyi "Adet" yazan tedarikçi)
 */
export function firstPriceCertain(evidence: PackEvidence | null, factor: number): boolean {
  return evidence?.source === "unit" && sameFactor(evidence.factor, factor);
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

/** Eşitlemenin "değerlendirildi" işaretinin anahtarı (`parasut.prices`): ürün ya da çarpan değişince fatura yeniden değerlendirilir */
export const appliedKeyOf = (ingredientId: number, productKey: string, factor: number) => `${ingredientId}|${productKey}|${factor}`;

/**
 * Eşitleme her anahtarın en yeni faturasını bir kez değerlendirir (`applied`: anahtar → o faturanın günü). staleHolds'un
 * geçersiz saydığı önerinin fiyatı hiç uygulanmadı: değişiklik geri dönünce ("Fiyatı güncelle" yeniden açılır, aynı
 * çarpanla yeniden bağlanır, fatura kafeye geri taşınır) aynı fatura yeniden değerlendirilsin diye işaret o faturanın bir
 * gün öncesine çekilir; daha eski faturalar yine atlanır. İşaret o arada başka faturaya geçtiyse dokunulmaz. `applied`
 * yerinde değişir; çekilen işaret sayısı döner.
 */
export function reopenApplied(applied: Record<string, string>, holds: { ingredientId: number; productKey: string; factor: number; invoiceDate: string }[]): number {
  let n = 0;
  for (const h of holds) {
    const key = appliedKeyOf(h.ingredientId, h.productKey, h.factor);
    if (applied[key] !== h.invoiceDate) continue;
    applied[key] = addDays(h.invoiceDate, -1);
    n++;
  }
  return n;
}

/** Eşitlemenin okuduğu fatura kalemi (hammaddeye bağlı ürünün; kafe dışı faturalar yükleyicide çıkar) */
interface BillLine {
  invoiceId: number;
  productKey: string;
  date: string;
  supplier: string;
  quantity: number;
  netTotal: number;
}

/**
 * Aynı hammaddenin, verilen faturadan önceki (aynı gün başka fatura dahil) ücretli faturaları, en yeni önce: hammaddeye
 * bağlı bütün ürünlerin kalemleri, her biri kendi çarpanıyla; aynı faturanın kalemleri birlikte (Σnet ÷ Σ miktar ×
 * çarpan). Bedava kalem ve iade sayılmaz.
 */
function invoicesBefore(
  lines: BillLine[],
  links: Map<string, { ingredientId: number; factor: number }>,
  ingredientId: number,
  current: { invoiceId: number; date: string },
): { invoiceId: number; date: string; supplier: string; unitPrice: number }[] {
  const byInvoice = new Map<number, { invoiceId: number; date: string; supplier: string; net: number; base: number }>();
  for (const l of lines) {
    const link = links.get(l.productKey);
    if (!link || link.ingredientId !== ingredientId || !(link.factor > 0)) continue;
    if (l.invoiceId === current.invoiceId || l.date > current.date) continue;
    if (!(l.quantity > 0) || !(l.netTotal > 0)) continue;
    const agg = byInvoice.get(l.invoiceId) ?? { invoiceId: l.invoiceId, date: l.date, supplier: l.supplier, net: 0, base: 0 };
    agg.net += l.netTotal;
    agg.base += l.quantity * link.factor;
    byInvoice.set(l.invoiceId, agg);
  }
  return [...byInvoice.values()]
    .sort((a, b) => (a.date === b.date ? b.invoiceId - a.invoiceId : a.date < b.date ? 1 : -1))
    .map((a) => ({ invoiceId: a.invoiceId, date: a.date, supplier: a.supplier, unitPrice: a.net / a.base }));
}

/** Aynı hammaddenin bir önceki ücretli faturasındaki birim fiyat: kartta "Önceki fatura" (başka tedarikçi de olabilir) */
export function previousInvoicePrice(
  lines: BillLine[],
  links: Map<string, { ingredientId: number; factor: number }>,
  ingredientId: number,
  current: { invoiceId: number; date: string },
): { unitPrice: number; date: string; supplier: string } | null {
  const p = invoicesBefore(lines, links, ingredientId, current)[0];
  return p ? { unitPrice: p.unitPrice, date: p.date, supplier: p.supplier } : null;
}

/**
 * "Son N faturada da bu fiyat": değerlendirilen fatura ve hemen önceki faturalardan arka arkaya kaçında birim fiyat
 * bununla ±%10 aynı (önceki faturalar "Önceki fatura"daki gibi). Arada başka fiyatlı fatura sayımı keser: yanlış
 * çarpanlı koli faturası doğru fiyatlı faturalarla sırayla gelince sayı büyüyüp "fiyat büyük olasılıkla gerçek"
 * demesin. Önerilere değil faturalara bakılır: ürün ilk kez bağlanınca eski faturaları da sayılır.
 */
export function repeatCount(
  lines: BillLine[],
  links: Map<string, { ingredientId: number; factor: number }>,
  ingredientId: number,
  current: { invoiceId: number; date: string; unitPrice: number },
): number {
  let n = 1;
  for (const p of invoicesBefore(lines, links, ingredientId, current)) {
    if (!(p.unitPrice > 0) || Math.abs(current.unitPrice / p.unitPrice - 1) > REPEAT_PCT + EPS) break;
    n++;
  }
  return n;
}

/**
 * Çarpan oranı ipucunun tek kanıtı: aynı ürünün (productKey) daha önceki ücretli bir faturası aynı çarpanla şimdiki
 * fiyatın ±%10'unda. Öyleyse ürün eskiden bu çarpanla doğru fiyat verdi, şimdiki fark tedarikçinin birim değiştirmesidir
 * (koli ↔ adet) ve "Çarpanı X yap" doğrudur. Yeni tedarikçi ya da ürün, tahmini fiyat ya da başka fiyatlı geçmiş kanıt
 * değildir: oran gerçek bir fiyat değişimini gizlerdi (Yenilebilir bardak 150 AD. "Çarpanı 72 yap", Klips kapak
 * "Çarpanı 10 yap"). Önceki faturalar "Önceki fatura"daki gibi: aynı gün başka fatura dahil, bedava kalem ve iade hariç.
 */
export function sameProductHistory(
  lines: BillLine[],
  hold: { ingredientId: number; invoiceId: number; invoiceDate: string; productKey: string; factor: number },
  currentUnit: number,
): boolean {
  if (!(currentUnit > 0) || !(hold.factor > 0)) return false;
  const own = lines.filter((l) => l.productKey === hold.productKey);
  const links = new Map([[hold.productKey, { ingredientId: hold.ingredientId, factor: hold.factor }]]);
  return invoicesBefore(own, links, hold.ingredientId, { invoiceId: hold.invoiceId, date: hold.invoiceDate }).some(
    (p) => Math.abs(p.unitPrice / currentUnit - 1) <= REPEAT_PCT + EPS,
  );
}

/** Kalemin birim fiyatı bu çarpanla: net ÷ (miktar × çarpan); bedava kalemde ya da iadede null */
export function unitPriceFor(line: { quantity: number; netTotal: number }, factor: number): number | null {
  const base = line.quantity * factor;
  return base > 0 && line.netTotal > 0 ? line.netTotal / base : null;
}

/** Okunan ya da kanıtlı çarpan önerisi için gereken okuma (src/lib/invoice-reading.ts) */
export interface ReadingFactor {
  factor: number | null;
  confidence: "high" | "medium" | "low";
}

export interface HoldSuggestion {
  /**
   * evidence: addaki ya da birimdeki paket boyu; reading: faturanın okunması (Claude); ratio: aynı ürünün geçmişiyle oran;
   * conflict: addaki paket boyu ile faturanın okuması çelişiyor (düğme yok, iki değer yazılır)
   */
  kind: "evidence" | "reading" | "ratio" | "conflict";
  /** Önerilen çarpan ("Çarpanı X yap"); null: yalnız uyarı (oran tam sayı çarpan vermiyor) */
  factor: number | null;
  /** Önerilen çarpanla birim fiyat ve şimdikine göre farkı: gerçek bir fiyat değişimi mi, görünsün */
  unitPrice: number | null;
  pct: number | null;
  evidence?: PackEvidence;
  hint?: FactorHint;
  /** conflict: okumanın çarpanı ve onunla birim fiyat (kanıtınki `factor` yerine `evidence`'ta) */
  reading?: { factor: number; unitPrice: number | null; pct: number | null };
}

/**
 * Onay bekleyen fiyat kartının tek önerisi; kanıt sırası, ilk tutan kazanır (en çok bir "Çarpanı X yap"):
 * 0. adındaki ya da açıklamasındaki paket boyu ile emin ya da büyük olasılıkla okunan fatura farklı çarpan diyorsa
 *    çelişki: iki değer yazılır, düğme konmaz (adın okuması yanlış olabilir: "50'Lİ X 20"de 50; faturayı açıp bakın).
 *    Faturadaki ölçü biriminin çevirisi (1 kg = 1000 gr) okumayla çelişse de kanıttır, okuma önerilmez;
 * 1. adındaki ya da birimindeki paket boyu (packEvidence), bağlantınınkinden farklıysa;
 * 2. faturanın okunması, emin (high) ya da büyük olasılıkla (medium) ve bağlantınınkinden farklıysa;
 * 3. çarpan oranı (factorHint), yalnız aynı ürünün geçmişi varsa (sameProductHistory);
 * yoksa öneri yok (kart okumayı ya da "Faturayı oku"yu gösterir). Yeni çarpanla birim fiyat bizim kalemimizden hesaplanır.
 */
export function holdSuggestion(i: {
  factor: number;
  quantity: number;
  netTotal: number;
  /** Hammaddenin şimdiki birim fiyatı */
  current: number;
  evidence: PackEvidence | null;
  reading: ReadingFactor | null;
  history: boolean;
}): HoldSuggestion | null {
  const at = (f: number) => {
    const unitPrice = unitPriceFor(i, f);
    return { unitPrice, pct: unitPrice === null ? null : livePct(unitPrice, i.current) };
  };
  const r = i.reading;
  const confident = r && r.factor !== null && r.factor > 0 && r.confidence !== "low" ? r.factor : null;
  const ev = i.evidence && i.evidence.factor > 0 ? i.evidence : null;
  if (ev && ev.source !== "unit" && confident !== null && !sameFactor(confident, ev.factor)) {
    return { kind: "conflict", factor: null, evidence: ev, ...at(ev.factor), reading: { factor: confident, ...at(confident) } };
  }
  if (ev && !sameFactor(ev.factor, i.factor)) return { kind: "evidence", factor: ev.factor, evidence: ev, ...at(ev.factor) };
  // Faturadaki ölçü biriminin çevirisi bağlantınınkiyle aynıysa (1 kg = 1000 gr) okuma onu değiştirmeye önerilmez
  if (confident !== null && ev?.source !== "unit" && !sameFactor(confident, i.factor)) return { kind: "reading", factor: confident, ...at(confident) };
  const proposed = unitPriceFor(i, i.factor);
  const hint = i.history && proposed !== null ? factorHint(i.current, proposed) : null;
  if (!hint) return null;
  const f = suggestedFactor(i.factor, hint);
  return { kind: "ratio", factor: f, hint, ...(f ? at(f) : { unitPrice: null, pct: null }) };
}

/** "adet başı 20,00 ₺" / "kg başı 950,00 ₺" / "L başı 31,00 ₺" */
export function perUnitText(unitPrice: number, unit: string): string {
  const b = bulkUnit(unit);
  const v = unitPrice * b.scale;
  return `${b.per} başı ${Math.abs(v) >= 1 ? tl2(v) : tlUnit(v)}`;
}

/** "şimdikinden %52 ucuz" / "şimdikinden %18 pahalı" / "şimdikiyle aynı"; şimdiki fiyat yoksa null */
export function vsCurrentText(unitPrice: number, currentUnit: number): string | null {
  const p = livePct(unitPrice, currentUnit);
  if (p === null) return null;
  const shown = num(Math.abs(p) * 100);
  if (Math.abs(p) < SAME_PCT || shown === "0") return "şimdikiyle aynı";
  return `şimdikinden %${shown} ${p < 0 ? "ucuz" : "pahalı"}`;
}

/** "adet başı 20,00 ₺ (şimdikinden %52 ucuz)" */
export function priceWithPct(unitPrice: number, unit: string, currentUnit: number): string {
  const vs = vsCurrentText(unitPrice, currentUnit);
  return `${perUnitText(unitPrice, unit)}${vs ? ` (${vs})` : ""}`;
}

/** "1 Adet = 150 adet" (faturadaki birim yoksa "1 birim") */
export const factorText = (lineUnit: string | null, factor: number, unit: string) => `1 ${lineUnit?.trim() || "birim"} = ${num(factor, 3)} ${unit}`;

/** Kanıtın başı: "Adında “150 AD.” yazıyor" / "Açıklamasında “…” yazıyor" / "Faturadaki birim “kg”" */
export function evidenceLead(ev: PackEvidence): string {
  if (ev.source === "unit") return `Faturadaki birim “${ev.text}”`;
  return `${ev.source === "name" ? "Adında" : "Açıklamasında"} “${ev.text}” yazıyor`;
}

/**
 * Kartta kanıtlı öneri: "Adında “150 AD.” yazıyor: 1 Adet = 150 adet olmalı. Öyle olursa adet başı 20,00 ₺ (şimdikinden
 * %52 ucuz)."
 */
export function evidenceSuggestionText(ev: PackEvidence, s: { lineUnit: string | null; unit: string; unitPrice: number | null; currentUnit: number }): string {
  const then = s.unitPrice !== null ? ` Öyle olursa ${priceWithPct(s.unitPrice, s.unit, s.currentUnit)}.` : "";
  return `${evidenceLead(ev)}: ${factorText(s.lineUnit, ev.factor, s.unit)} olmalı.${then}`;
}

/**
 * Kartta çelişki (holdSuggestion "conflict"): "Adında “50'Lİ” yazıyor: 1 Koli = 50 adet, adet başı 8,00 ₺ (…). Faturanın
 * okuması: 1 Koli = 1.000 adet, adet başı 0,40 ₺ (…). İkisi çelişiyor; faturayı açıp bakın, doğru çarpanı “Bağlantıyı
 * düzelt”ten yazın." Okumanın ayrı bilgi satırı çizilmez
 */
export function conflictSuggestionText(s: HoldSuggestion, c: { lineUnit: string | null; unit: string; currentUnit: number }): string {
  const priced = (factor: number, unitPrice: number | null) =>
    `${factorText(c.lineUnit, factor, c.unit)}${unitPrice !== null ? `, ${priceWithPct(unitPrice, c.unit, c.currentUnit)}` : ""}`;
  const ev = s.evidence!;
  const rd = s.reading!;
  return `${evidenceLead(ev)}: ${priced(ev.factor, s.unitPrice)}. Faturanın okuması: ${priced(rd.factor, rd.unitPrice)}. İkisi çelişiyor; faturayı açıp bakın, doğru çarpanı “Bağlantıyı düzelt”ten yazın.`;
}

/**
 * Kartta oran önerisi (yalnız aynı ürünün geçmişi varken): "Fiyat şimdikinin yaklaşık 12 katı: çarpan yanlış olabilir
 * (1 Koli = 12.000 ml mi?). Çarpan yanlışsa alınan miktar da yanlış sayılır. Öyle olursa L başı 31,00 ₺ (şimdikiyle aynı)."
 */
export function ratioSuggestionText(hint: FactorHint, s: { lineUnit: string | null; unit: string; factor: number | null; unitPrice: number | null; currentUnit: number }): string {
  const head = hint.direction === "up" ? `Fiyat şimdikinin yaklaşık ${num(hint.times)} katı` : `Fiyat şimdikinden yaklaşık ${num(hint.times)} kat düşük`;
  const ask = s.factor ? ` (${factorText(s.lineUnit, s.factor, s.unit)} mi?)` : "";
  const then = s.factor && s.unitPrice !== null ? ` Öyle olursa ${priceWithPct(s.unitPrice, s.unit, s.currentUnit)}.` : "";
  return `${head}: çarpan yanlış olabilir${ask}. Çarpan yanlışsa alınan miktar da yanlış sayılır.${then}`;
}

/** Hammaddenin şimdiki fiyatı tahminiyse (varsayım) kartın satırı ve yüzde rozetinin eki */
export const ESTIMATE_TEXT = "Şimdiki fiyat tahmini (varsayım), faturadan gelmedi. Faturadaki fiyat ilk gerçek fiyat olabilir.";
export const ESTIMATE_BADGE = "tahmini fiyata göre";
/** Hammaddenin fiyatı yokken onaya düşen ilk fiyatın kart satırı (priceStep) */
export const FIRST_PRICE_TEXT = "Hammaddenin fiyatı yoktu. Çarpan faturanın biriminden (kg, lt) gelmediği için ilk fiyat onay bekliyor: faturadaki ürün ve çarpan doğruysa onaylayın.";

/**
 * Önerinin faturasından sonra gelen, hammaddenin fiyatını belirleyen en yeni fatura: eşitlemenin "en yeni fatura"sı
 * gibi fiyatı güncellenen bağlı ürünlerin ücretli kalemleri. Önerinin kendi ürünü, reddederken fiyat güncellemesi
 * kapatılmış olsa da sayılır (geri alma onu yeniden açar). Varsa öneri eskimiştir: onaylanırsa ya da kararı geri
 * alınırsa eski faturanın fiyatı yenisinin üstüne yazılırdı (eşitleme o faturaya bir daha bakmaz). Yoksa null.
 */
export function newerInvoice(
  lines: BillLine[],
  links: Map<string, { ingredientId: number; updatePrice: boolean }>,
  hold: { ingredientId: number; invoiceId: number; invoiceDate: string; productKey: string },
): { invoiceId: number; date: string; supplier: string } | null {
  let best: { invoiceId: number; date: string; supplier: string } | null = null;
  for (const l of lines) {
    const link = links.get(l.productKey);
    if (!link || link.ingredientId !== hold.ingredientId || !(link.updatePrice || l.productKey === hold.productKey)) continue;
    // Faturanın kendisi tarihi sonradan değişse de "daha yeni" sayılmaz
    if (l.invoiceId === hold.invoiceId || !(l.date > hold.invoiceDate) || !(l.quantity > 0) || !(l.netTotal > 0)) continue;
    if (!best || l.date > best.date) best = { invoiceId: l.invoiceId, date: l.date, supplier: l.supplier };
  }
  return best;
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

/** "Süt +%52, Karton bardak (ilk fiyat) ve 2 hammadde daha" (en çok 3); şimdiki fiyatı olmayanınki ilk fiyattır */
export function holdsSummary(items: { name: string; pct: number | null }[], max = 3): string {
  const head = items.slice(0, max).map((i) => (i.pct === null ? `${i.name} (${FIRST_PRICE_LABEL})` : `${i.name} ${signedPct(i.pct)}`));
  return items.length > max ? `${head.join(", ")} ve ${items.length - max} hammadde daha` : head.join(", ");
}

/** Hammaddenin şimdiki fiyatı yokken faturadan gelen fiyat (priceStep: çarpanı kesin değilse onaya düşer) */
export const FIRST_PRICE_LABEL = "ilk fiyat";

/**
 * Onay bekleme nedeni (zil, e-posta, Genel bakış): "faturadaki fiyat şimdikinden %40'tan fazla farklı", yalnız ilk
 * fiyatlar varsa "faturadan gelen ilk fiyat, çarpanı kesin değil", ikisi birden varsa ikisi
 */
export function holdReason(items: { pct: number | null }[]): string {
  const first = items.some((i) => i.pct === null);
  const jump = items.some((i) => i.pct !== null);
  if (first && !jump) return "faturadan gelen ilk fiyat, çarpanı kesin değil";
  if (first) return "faturadaki fiyat şimdikinden %40'tan fazla farklı ya da ilk fiyat";
  return "faturadaki fiyat şimdikinden %40'tan fazla farklı";
}

/** holdReason cümle başında (Genel bakış, Bugün, e-posta): "Faturadaki fiyat şimdikinden %40'tan fazla farklı" */
export function holdReasonSentence(items: { pct: number | null }[]): string {
  const r = holdReason(items);
  return `${r.charAt(0).toLocaleUpperCase("tr-TR")}${r.slice(1)}`;
}

/** İşlem geçmişi için: "Süt +%52 (Sütaş 21.10.2026)" */
export function holdLogText(h: { name: string; pct: number | null; supplier: string; date: string }): string {
  return `${h.name}${h.pct === null ? "" : ` ${signedPct(h.pct)}`} (${h.supplier} ${dateTR(h.date)})`;
}

/**
 * Onay beklerken maliyete etkisi: şimdiki fiyatı olan hammadde onu kullanır; ilk fiyatı bekleyenin (şimdiki fiyatı yok)
 * maliyeti 0 ₺ sayılır ("şimdiki fiyatla" demek maliyetin doğru olduğunu sandırırdı)
 */
export function holdEffectSentence(items: { pct: number | null }[]): string {
  const first = items.some((i) => i.pct === null);
  const jump = items.some((i) => i.pct !== null);
  if (first && !jump) return "Onaylanana kadar maliyetlerde 0 ₺ sayılır.";
  if (first) return "Onaylanana kadar maliyetler şimdiki fiyatla hesaplanır; ilk fiyatı bekleyenler 0 ₺ sayılır.";
  return "Onaylanana kadar maliyetler şimdiki fiyatla hesaplanır.";
}

/** Genel bakış ve zil metni (insights.Alert biçimi); bekleyen yoksa null */
export function holdAlert(holds: { name: string; pct: number | null }[]): { level: "warning"; title: string; detail: string; href: string } | null {
  if (!holds.length) return null;
  return {
    level: "warning",
    title: `Fiyat onayı: ${holds.length} hammadde`,
    detail: `${holdReasonSentence(holds)}: ${holdsSummary(holds)}. ${holdEffectSentence(holds)}`,
    href: HOLDS_HREF,
  };
}
