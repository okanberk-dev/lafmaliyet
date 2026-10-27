/**
 * Fatura kalemini hammaddeye bağlarken öneriler (Paraşüt sayfası): hangi hammadde olabilir ve faturadaki 1 birim
 * kaç hammadde birimi eder. Öneri yalnız formu doldurur; kullanıcı onaylamadan bağlantı kurulmaz. Saf modül;
 * tests/product-match.test.ts.
 */

export type IngredientUnit = "gr" | "ml" | "adet" | "dilim" | string;

/** Küçük harf, Türkçe karakterler sadeleşmiş sözcükler ("ÇEKİRDEĞİ" → "cekirdegi") */
export function words(text: string): string[] {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

const STOP = new Set(["ve", "ile", "icin", "the", "and"]);

/** Ek almış sözcük de sayılır: "cekirdek" ~ "cekirdegi", "laktozsuz" ~ "laktozsuz" (en az 4 harf ortak kök) */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i >= Math.max(4, Math.min(a.length, b.length) - 2);
}

/** Boyut ve sayı sözcükleri (ürün adının çekirdeğine girmez) */
const MEASURE = new Set(["kg", "kilo", "gram", "gr", "g", "litre", "lt", "l", "ml", "cl", "oz", "cc", "adet", "ad", "li", "lu", "dilim", "x", "pcs", "pc", "tv"]);

/** Ürün adının boyut ve sayı içermeyen çekirdeği (aynı ürün başka tedarikçiden ya da başka faturadan gelince) */
export function nameCore(text: string): string {
  return words(text)
    .filter((w) => !/\d/.test(w) && w.length > 1 && !MEASURE.has(w))
    .join(" ");
}

/**
 * Bardak/kapak boyutu ("8oz", "14-16oz", "350cc"). Çekirdeği aynı iki üründe farklıysa ayrı üründür: "KARTON BARDAK 8OZ"
 * bağlıyken "KARTON BARDAK 14OZ" aynı hammaddeye önerilmez.
 */
export function cupSize(text: string): string | null {
  const cup = /(\d+(?:\s*-\s*\d+)?)\s*(oz|cc)(?![a-z])/.exec(text.toLocaleLowerCase("tr-TR").replace(/ı/g, "i"));
  return cup ? cup[1].replace(/\s+/g, "") + cup[2] : null;
}

/**
 * Paketin tamamı: tek ürünün boyutu (gr/ml'ye çevrilmiş) ve paketteki sayı. "SÜT 1 L" ile "Süt 1000 ml" aynı pakettir;
 * "SÜT 5 LT" ya da "330ML X24" ile "PET1LX12" aynı ürünün başka paketidir (hammadde aynı, çarpan farklı).
 */
export function packKey(text: string): string {
  const { size, count } = parsePack(text);
  return `${size ? `${size.amount}${size.dim}` : "-"}×${count ?? "-"}`;
}

export interface MatchIngredient {
  id: number;
  name: string;
  unit: IngredientUnit;
}

export interface MatchLink {
  productName: string;
  ingredientId: number;
  factor: number;
}

export type IngredientSuggestion = { ingredientId: number; factor: number | null; reason: "link" | "name" };

/**
 * Hammadde önerisi:
 * 1. Aynı adlı (boyut ve sayılar hariç) bir ürün zaten bağlıysa o hammadde. İkisinde de bardak boyutu yazıyorsa o da
 *    aynı olmalı (8oz bardak bağlıyken 14oz bardak ona önerilmez). Çarpan yalnız paket de aynıysa (boyut ve sayı)
 *    alınır; "SÜT 1 LT" bağlıyken "SÜT 5 LT" aynı hammaddeyi alır ama çarpanı null kalır, guessLinkFactor() addan bulur;
 * 2. hammadde adının anlamlı sözcüklerinin hepsi ürün adında geçiyorsa (ek almış hâlleri dahil) en çok sözcüğü
 *    tutan, eşitlikte adı uzun olan.
 */
export function suggestIngredient(productName: string, ingredients: MatchIngredient[], links: MatchLink[] = []): IngredientSuggestion | null {
  const core = nameCore(productName);
  if (core) {
    const cup = cupSize(productName);
    const sameCup = (name: string) => {
      const other = cupSize(name);
      return !cup || !other || other === cup;
    };
    const same = links.filter((l) => nameCore(l.productName) === core && sameCup(l.productName) && ingredients.some((i) => i.id === l.ingredientId));
    // Aynı paket bağlıysa o (çarpanıyla); yoksa ilk bağlantının hammaddesi, çarpansız (eski paketin çarpanı yanlış olur)
    const pack = packKey(productName);
    const exact = same.find((l) => packKey(l.productName) === pack);
    if (exact) return { ingredientId: exact.ingredientId, factor: exact.factor, reason: "link" };
    if (same.length) return { ingredientId: same[0].ingredientId, factor: null, reason: "link" };
  }
  const product = words(productName);
  let best: { ing: MatchIngredient; score: number } | null = null;
  for (const ing of ingredients) {
    const need = words(ing.name.replace(/\(.*?\)/g, " ")).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
    if (!need.length || !need.every((w) => product.some((p) => sameWord(w, p)))) continue;
    const score = need.length * 100 + ing.name.length;
    if (!best || score > best.score) best = { ing, score };
  }
  return best ? { ingredientId: best.ing.id, factor: null, reason: "name" } : null;
}

// ------------------------------------------------------------------ paket boyutu
const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const UNIT = String.raw`(kg|kilo|gram|gr|g|litre|lt|l|ml|cl)`;
const MASS: Record<string, number> = { kg: 1000, kilo: 1000, gram: 1, gr: 1, g: 1 };
const VOLUME: Record<string, number> = { litre: 1000, lt: 1000, l: 1000, ml: 1, cl: 10 };
const toNum = (s: string) => Number(s.replace(",", "."));
/** gr / ml'de noktadan sonra tam üç hane binlik ayraçtır ("1.000 GR" = 1000 gr); kg / lt'de ondalık ("1.500 KG" = 1,5 kg) */
const SMALL_UNITS = new Set(["gram", "gr", "g", "ml"]);
const amountOf = (n: string, unit: string) => (SMALL_UNITS.has(unit) && /^[1-9]\d{0,2}\.\d{3}$/.test(n) ? Number(n.replace(".", "")) : toNum(n));

export interface PackInfo {
  /** Tek ürünün miktarı: gr ya da ml */
  size: { amount: number; dim: "mass" | "volume" } | null;
  /** Pakette kaç tane ("x24", "9 ADET", "12 DİLİM") */
  count: number | null;
}

function sizeOf(n: string, unit: string): PackInfo["size"] {
  const v = amountOf(n, unit);
  if (!(v > 0)) return null;
  if (unit in MASS) return { amount: v * MASS[unit], dim: "mass" };
  if (unit in VOLUME) return { amount: v * VOLUME[unit], dim: "volume" };
  return null;
}

/** Ürün adından paket bilgisi: "PET330MLX24" → 330 ml × 24, "1000 GR * 8 AD" → 1000 gr × 8, "SÜT 1 L" → 1000 ml */
export function parsePack(name: string): PackInfo {
  // Sayılar ve birimler bitişik de yazılır ("330ML1X24"); ondalık virgül korunur
  const t = name.toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const after = String.raw`(?![a-z])`;
  let m = new RegExp(String.raw`(\d+)\s*[x×*]\s*${NUM}\s*${UNIT}${after}`).exec(t);
  if (m) return { size: sizeOf(m[2], m[3]), count: Number(m[1]) };
  m = new RegExp(String.raw`${NUM}\s*${UNIT}\s*(\d+)\s*[x×*]\s*(\d+)(?!\d)`).exec(t);
  if (m) return { size: sizeOf(m[1], m[2]), count: Number(m[3]) * Number(m[4]) };
  m = new RegExp(String.raw`${NUM}\s*${UNIT}\s*[x×*]\s*(\d+)(?!\d)`).exec(t);
  if (m) return { size: sizeOf(m[1], m[2]), count: Number(m[3]) };
  // Ondalığın kuyruğu ayrı sayı sayılmaz ("%2,5" içindeki 5); "VANILYA.5.5LT" → 5,5 lt
  const start = String.raw`(?<![\d,])(?<!\d\.)`;
  m = new RegExp(String.raw`${start}${NUM}\s*${UNIT}${after}`).exec(t);
  const size = m ? sizeOf(m[1], m[2]) : null;
  // İki sayılı paket ("50'Lİ X 20"): paketteki sayı ikisinin çarpımı; "50'Lİ X 10" başka pakettir (packKey)
  const pair = findPair(t);
  if (pair) return { size, count: pair.total };
  const c = new RegExp(String.raw`${start}(\d+)\s*['’]?\s*(?:adet|ad|li|lu|dilim|pcs|pc|tv)(?![a-z])`).exec(t);
  return { size, count: c ? Number(c[1]) : null };
}

/** Faturadaki birim tek ürün mü, paket mi (koli, kutu…) */
const PACKAGE_UNITS = new Set(["koli", "kutu", "paket", "kasa", "set", "torba", "duzine", "dzn", "kt", "bx", "cs", "ct", "pk", "pa", "npl"]);
/** Tek parça birimleri (UBL kodları dahil: C62 = Adet); boş birim de tek sayılır (Paraşüt'ün varsayılanı Adet) */
const SINGLE_UNITS = new Set(["adet", "ad", "adt", "tane", "c62", "niu", "h87", "ea", "pce", "pcs", "pc"]);
/** Faturadaki ölçü birimleri → gr / ml (UBL kodları dahil: KGM, GRM, LTR, MLT) */
const MASS_UNITS: Record<string, number> = { ...MASS, kilogram: 1000, kgm: 1000, grm: 1 };
const VOLUME_UNITS: Record<string, number> = { ...VOLUME, ltr: 1000, mlt: 1 };
const unitWord = (u: string | null) => words(u ?? "").join("");

const fmt = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");

/** Paket sayısı sayılabilecek aralık: "1 AD" paket değildir; dev sayı ürün kodudur */
const MIN_COUNT = 2;
const MAX_COUNT = 100_000;

// ------------------------------------------------------------------ iki sayılı paket ("50'Lİ X 20")
/** Paketteki tane sözcükleri ("50'Lİ", "100 AD.", "50 ADET", "150 PCS", "12 DİLİM") */
const PIECE = String.raw`(?:adet|ad|li|lu|pcs|pc|tane|dilim)`;
/** İç paket sözcükleri ("20 PK", "20 PAKET", "2 KOLİ") */
const PACK = String.raw`(?:pk|pkt|paket|koli|kutu|kasa|torba)`;
/** Tam sayı, binlik ayraçlı da ("1.000") */
const INT = String.raw`([1-9]\d{0,2}(?:\.\d{3})+|\d+)`;
/** Sayının başı: önünde harf (ürün kodu), rakam, yüzde ya da ondalık yok */
const PAIR_START = String.raw`(?<![a-z\d,%])(?<!\d\.)`;
/** "X 20"nin sonu: ardından ölçü (boy, çap, uzunluk, hacim) gelmiyor ("100 AD X 23 CM" pipetin boyudur) */
const NO_MEASURE = String.raw`(?![\d.,])(?!\s*(?:kg|kilo|gram|gr|g|litre|lt|l|ml|cl|oz|cc|cm|mm|mt|m)(?![a-z]))`;
const APOS = String.raw`['’]?`;
/** Kalıplar ve hangi sayının bir paketteki tane olduğu (öteki paket sayısı) */
const PAIR_PATTERNS: { re: RegExp; per: 1 | 2 }[] = [
  // "50'Lİ X 20", "100 AD X 10 PK", "50 Lİ X 20 PAKET"
  { re: new RegExp(String.raw`${PAIR_START}${INT}\s*${APOS}\s*${PIECE}\.?\s*[x×*]\s*${INT}${NO_MEASURE}(?:\s*${APOS}\s*${PACK}(?![a-z]))?`), per: 1 },
  // "50 Lİ 20 PAKET", "100 AD 10 PK"
  { re: new RegExp(String.raw`${PAIR_START}${INT}\s*${APOS}\s*${PIECE}\.?\s+${INT}\s*${APOS}\s*${PACK}(?![a-z])`), per: 1 },
  // "20 PK X 50 AD", "20 PAKET 50 ADET", "20PK*50AD"
  { re: new RegExp(String.raw`${PAIR_START}${INT}\s*${APOS}\s*${PACK}\.?\s*[x×*]?\s*${INT}\s*${APOS}\s*${PIECE}(?![a-z])`), per: 2 },
  // "20X50 AD", "20 X 50'Lİ"
  { re: new RegExp(String.raw`${PAIR_START}${INT}\s*[x×*]\s*${INT}\s*${APOS}\s*${PIECE}(?![a-z])`), per: 2 },
];

const intOf = (s: string) => Number(s.replace(/\./g, ""));

/**
 * Adda iki sayı: bir paketteki tane ve paket sayısı ("KARTON BARDAK 8 OZ 50'Lİ X 20" → 50 × 20 = 1000). Tek sayı
 * okumak (50) koliyi 20 kat ucuz gösterirdi. Sadeleşmiş (küçük harf, işaretsiz) metinde; yoksa null
 */
function findPair(t: string): (Hit & { per: number; packs: number; total: number }) | null {
  for (const p of PAIR_PATTERNS) {
    const m = p.re.exec(t);
    if (!m) continue;
    const a = intOf(m[1]);
    const b = intOf(m[2]);
    const total = a * b;
    // Biri 1 ise iki sayılı paket değil ("100'LÜ X 1", "1X24 ADET"): tek sayı ve boyut × sayı kuralları okur
    if (!(a >= 2 && b >= 2) || total < MIN_COUNT || total > MAX_COUNT) continue;
    return { start: m.index, end: m.index + m[0].length, per: p.per === 1 ? a : b, packs: p.per === 1 ? b : a, total };
  }
  return null;
}

/**
 * Faturadaki birim iç paketin adı olabilir: "50'Lİ X 20" 1 Paket ise 50 de olabilir 1000 de (tedarikçi koliyi de
 * paket yazar). Dış paket birimlerinde (koli, kutu, kasa) çarpım alınır
 */
const INNER_PACKAGE_UNITS = new Set(["paket", "pk", "pkt", "pa", "torba", "duzine", "dzn"]);

/**
 * Faturadaki paket boyunun kanıtı: faturadaki 1 birim kaç hammadde birimi ve bunu nereden bildiğimiz. `text` ekranda
 * tırnak içinde gösterilen parça, faturada yazıldığı gibi ("150 AD.", "330ML 1X24", "KG").
 */
export interface PackEvidence {
  factor: number;
  /** unit: faturadaki ölçü birimi (kg, lt) ya da düzine; name / description: kalemin adı ya da açıklaması */
  source: "unit" | "name" | "description";
  text: string;
}

/** Fatura kalemi: ad, açıklama, birim ve (biliniyorsa) miktar */
export interface PackLine {
  name: string;
  description?: string | null;
  unit: string | null;
  quantity?: number | null;
}

type Hit = { start: number; end: number };
interface Scan {
  /** Boyut × sayı birlikte yazılmış ("330ML 1X24", "1000 GR * 8 AD"): kolinin içeriği */
  mult: (Hit & { size: NonNullable<PackInfo["size"]>; count: number }) | null;
  size: (Hit & { size: NonNullable<PackInfo["size"]> }) | null;
  /** Tek başına paket sayısı ("150 AD.", "150'Lİ", "100 LÜ", "X150", "150 PCS") */
  count: (Hit & { count: number }) | null;
  /** İki sayı: paketteki tane × paket sayısı ("50'Lİ X 20", "20 PK X 50 AD"); varsa tek sayının yerine geçer */
  pair: (Hit & { per: number; packs: number; total: number }) | null;
}

/**
 * Metin parsePack'teki gibi sadeleşir; her karakterin özgün metindeki yeri de tutulur: kanıt parçası faturada yazıldığı
 * gibi gösterilsin ("150 AD.", "150 ad" değil)
 */
function folded(text: string): { t: string; at: number[] } {
  let t = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const n = text[i].toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFD").replace(/[̀-ͯ]/g, "");
    for (const ch of n) {
      t += ch;
      at.push(i);
    }
  }
  return { t, at };
}

// Ondalığın kuyruğu ve yüzde ayrı sayı sayılmaz ("%2,5" içindeki 5, "%35 YAĞLI"daki 35)
const START = String.raw`(?<![\d,%])(?<!\d\.)`;
const AFTER = String.raw`(?![a-z])`;
const MULT_PATTERNS: { re: RegExp; size: [number, number]; count: (m: RegExpExecArray) => number }[] = [
  { re: new RegExp(String.raw`(\d+)\s*[x×*]\s*${NUM}\s*${UNIT}${AFTER}`), size: [2, 3], count: (m) => Number(m[1]) },
  { re: new RegExp(String.raw`${NUM}\s*${UNIT}\s*(\d+)\s*[x×*]\s*(\d+)(?!\d)`), size: [1, 2], count: (m) => Number(m[3]) * Number(m[4]) },
  { re: new RegExp(String.raw`${NUM}\s*${UNIT}\s*[x×*]\s*(\d+)(?!\d)`), size: [1, 2], count: (m) => Number(m[3]) },
];
const SIZE_RE = new RegExp(String.raw`${START}${NUM}\s*${UNIT}${AFTER}`);
/** Sayıda binlik ayraç olabilir ("1.000 AD." = 1000) */
const COUNT_RE = new RegExp(String.raw`${START}([1-9]\d{0,2}(?:\.\d{3})+|\d+)\s*['’]?\s*(adet|ad|li|lu|dilim|pcs|pc|tv|tane)${AFTER}`);
/** "X150": önünde sayı ya da harf yok, ardından ölçü birimi gelmiyor ("30X150" ölçü, "X 1 LT" boyut) */
const X_COUNT_RE = /(?<![a-z\d])[x×]\s*(\d+)(?![\d.,])(?!\s*(?:kg|kilo|gram|gr|g|litre|lt|l|ml|cl|oz|cc|cm|mm|mt|m)(?![a-z]))/;

function scanPack(t: string): Scan {
  let mult: Scan["mult"] = null;
  for (const p of MULT_PATTERNS) {
    const m = p.re.exec(t);
    if (!m) continue;
    const size = sizeOf(m[p.size[0]], m[p.size[1]]);
    if (size) mult = { start: m.index, end: m.index + m[0].length, size, count: p.count(m) };
    break;
  }
  const s = SIZE_RE.exec(t);
  const sized = s ? sizeOf(s[1], s[2]) : null;
  const size = s && sized ? { start: s.index, end: s.index + s[0].length, size: sized } : null;
  let count: Scan["count"] = null;
  for (const re of [COUNT_RE, X_COUNT_RE]) {
    const c = re.exec(t);
    const n = c ? Number(c[1].replace(/\./g, "")) : 0;
    if (!c || n < MIN_COUNT || n > MAX_COUNT) continue;
    // "AD." kısaltmasının noktası parçaya dahil
    const dot = c[2] === "ad" && t[c.index + c[0].length] === "." ? 1 : 0;
    count = { start: c.index, end: c.index + c[0].length + dot, count: n };
    break;
  }
  return { mult, size, count, pair: findPair(t) };
}

/** Eşleşen parçalar özgün metinden; aradaki kısa ara da ("40CL PET 12TV"), uzunsa "…" ile */
function fragment(text: string, at: number[], hits: Hit[]): string {
  const sorted = [...hits].sort((a, b) => a.start - b.start);
  const from = at[sorted[0].start];
  const to = at[sorted[sorted.length - 1].end - 1] + 1;
  if (to - from <= 24) return text.slice(from, to).trim();
  return sorted.map((h) => text.slice(at[h.start], at[h.end - 1] + 1).trim()).join(" … ");
}

type UnitKind = "mass" | "volume" | "package" | "single" | "other";

/** Faturadaki birimin türü: ölçü (kg, lt), paket (koli, kutu), tek parça (adet; boş da) ya da başka (şişe, rulo) */
function unitKind(unit: string | null): UnitKind {
  const u = unitWord(unit);
  if (u in MASS_UNITS) return "mass";
  if (u in VOLUME_UNITS) return "volume";
  if (PACKAGE_UNITS.has(u)) return "package";
  if (!u || SINGLE_UNITS.has(u)) return "single";
  return "other";
}

/** Adın ya da açıklamanın kanıtı (ölçü birimi değilse); yoksa null */
function evidenceIn(text: string, source: "name" | "description", line: PackLine, kind: UnitKind, ingredientUnit: IngredientUnit): PackEvidence | null {
  const { t, at } = folded(text);
  const { mult, size, count, pair } = scanPack(t);
  const dim = ingredientUnit === "gr" ? "mass" : ingredientUnit === "ml" ? "volume" : null;
  const pieces = ingredientUnit === "adet" || ingredientUnit === "dilim";
  if (kind === "package" && pair) {
    // İki sayılı paket ("50'Lİ X 20", 1 Koli): dış pakette ikisinin çarpımı (1000), tek sayısı (50) değil. Faturadaki
    // birim iç paketin adıysa (Paket, Düzine) 50 de olabilir 1000 de: kanıt yok, okuma ya da sahibi karar verir
    if (INNER_PACKAGE_UNITS.has(unitWord(line.unit))) return null;
    if (pieces) return { factor: pair.total, source, text: fragment(text, at, [pair]) };
    const sz = mult?.size ?? size?.size ?? null;
    if (!dim || !sz || sz.dim !== dim) return null;
    return { factor: pair.total * sz.amount, source, text: fragment(text, at, [mult ?? size!, pair]) };
  }
  // Tek parçada (Adet) iki sayı: 1 adet tek tane de olabilir, paket de, koli de; kanıt yok
  if (pair) return null;
  if (kind === "package") {
    // Paket: içindeki sayı (adet / dilim) ya da sayı × boyut (gr / ml); düzinede sayı yazmasa da 12
    const dozen = ["duzine", "dzn"].includes(unitWord(line.unit));
    const n = mult?.count ?? count?.count ?? (dozen ? 12 : null);
    const countHit: Hit[] = mult ? [mult] : count ? [count] : [];
    if (!n) return null;
    if (pieces) return countHit.length ? { factor: n, source, text: fragment(text, at, countHit) } : { factor: n, source: "unit", text: (line.unit ?? "").trim() };
    const sz = mult?.size ?? size?.size ?? null;
    if (!dim || !sz || sz.dim !== dim) return null;
    return { factor: n * sz.amount, source, text: fragment(text, at, mult ? [mult] : [...(size ? [size] : []), ...countHit]) };
  }
  // Tek parça: "1000 GR * 8 AD" gibi boyut × sayı kolinin içeriğidir; faturadaki birim tek kavanoz da olabilir, koli de.
  // Bundan kanıt çıkmaz (guessLinkFactor eskisi gibi tek ürünün boyutunu önerir)
  if (mult) return null;
  // Tek başına sayı yalnız adet birimlerinde ve faturada o kadar ya da daha çok alınmadıysa paket boyudur: "PİPET 500 AD"
  // 2.000 adet alındıysa faturadaki birim tek pipet de olabilir (guessLinkFactor o zaman tahmin etmez)
  const q = line.quantity;
  const packCount = kind === "single" && count && !(q !== null && q !== undefined && Math.abs(q) >= count.count) ? count : null;
  if (!packCount) return null;
  if (pieces) return { factor: packCount.count, source, text: fragment(text, at, [packCount]) };
  // Yalnız boyut ("SÜT 1 L") kanıt değildir: tedarikçi 12 × 1 L koliyi de "1 Adet" yazar. Boyut formun tahmini olarak kalır
  if (!dim || !size || size.size.dim !== dim) return null;
  return { factor: packCount.count * size.size.amount, source, text: fragment(text, at, [size, packCount]) };
}

/**
 * Faturadaki 1 birimin kaç hammadde birimi ettiğinin kanıtı; kanıt yoksa null ("bilinmiyor", 1 değil):
 * - faturada ölçü birimi varsa (KG, LT, gr, ml; UBL KGM, LTR, GRM, MLT) çevrilir: 1 kg = 1000 gr (`unit`);
 * - paketse (Koli, Kutu, Paket…) addaki sayı × boyut: "330ML 1X24" → 24 adet ya da 7920 ml; düzine 12;
 * - tek parçaysa (Adet, C62, AD, Tane) adında ya da açıklamasında tek başına yazan paket sayısı ("150 AD.",
 *   "150'Lİ", "100 LÜ", "X150", "150 PCS"): adet / dilim hammaddede sayı, gr / ml'de boyutla birlikte sayı × boyut.
 *   Sayısız boyut kanıt değildir ("SÜT 1 L": tek şişe de olabilir koli de; formun tahmini 1000 ml, guessLinkFactor).
 * - iki sayılı paket ("50'Lİ X 20", "20X50 AD", "20 PK X 50 AD", "50 Lİ 20 PAKET", "100 AD X 10 PK"): dış paket
 *   biriminde (Koli, Kutu, Kasa) ikisinin çarpımı (1000); birim tek parça ya da iç paketin adıysa (Adet, Paket) yapı
 *   belli değil, kanıt yok (packPairChoices iki olasılığı verir).
 * Sayılmayanlar: bardak boyu (8OZ), çap ve uzunluk (90 MM, 23 CM), yüzde (%35), "2 KAT". Ad açıklamadan önce gelir.
 */
export function packEvidence(line: PackLine, ingredientUnit: IngredientUnit): PackEvidence | null {
  const kind = unitKind(line.unit);
  const u = unitWord(line.unit);
  if (kind === "mass") return ingredientUnit === "gr" ? { factor: MASS_UNITS[u], source: "unit", text: (line.unit ?? "").trim() } : null;
  if (kind === "volume") return ingredientUnit === "ml" ? { factor: VOLUME_UNITS[u], source: "unit", text: (line.unit ?? "").trim() } : null;
  const fromName = evidenceIn(line.name, "name", line, kind, ingredientUnit);
  if (fromName) return fromName;
  const desc = line.description?.trim();
  return desc && desc !== line.name.trim() ? evidenceIn(desc, "description", line, kind, ingredientUnit) : null;
}

/** İki çarpan aynı mı (kayan nokta payıyla) */
export function sameFactor(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * Faturadaki 1 birimin kaç hammadde birimi ettiği (formdaki "1 Koli = … ml"), bilinmiyorsa null. Önce kanıt
 * (packEvidence: "150 AD." → 150); kanıt yoksa eski tahmin: tek ürünse (Adet) adet / dilim hammaddede 1, gr / ml'de
 * addaki boyut ("SÜT 1 L" → 1000 ml; "1000 GR * 8 AD" → 1000 gr: koli sayısı sayılmaz); ölçü birimi başka boyuttaysa ya
 * da pakette sayı yoksa tahmin edilmez. Adında paket sayısı yazıyor ama faturada o kadar ya da daha çok alınmışsa
 * ("PEÇETE 100 LÜ" 120 paket mi, 120 peçete mi) de tahmin edilmez: "1" canlıdaki yanlış bağlantıyı (Yenilebilir bardak
 * 150 AD.) yeniden doğururdu; sahibi yazar ya da faturadan okur. İki sayılı adda kanıt yoksa ("50'Lİ X 20" 1 Adet) da.
 */
export function guessLinkFactor(product: PackLine, ingredientUnit: IngredientUnit): string | null {
  const ev = packEvidence(product, ingredientUnit);
  if (ev) return fmt(ev.factor);
  if (product.quantity != null && packEvidence({ ...product, quantity: null }, ingredientUnit)) return null;
  // Adında iki sayı var ama yapı belirsiz ("50'Lİ X 20", 1 Adet): "1" ya da tek sayı yanlış olabilir, tahmin edilmez
  if (packPair(product)) return null;
  const kind = unitKind(product.unit);
  if (kind !== "single" && kind !== "other") return null;
  if (ingredientUnit === "adet" || ingredientUnit === "dilim") return "1";
  const dim = ingredientUnit === "gr" ? "mass" : ingredientUnit === "ml" ? "volume" : null;
  const pack = parsePack(product.name);
  if (!dim || !pack.size || pack.size.dim !== dim) return null;
  return fmt(pack.size.amount);
}

/**
 * Adındaki (yoksa açıklamasındaki) iki sayılı paket: faturada yazıldığı gibi parça ("50'Lİ X 20"), bir paketteki tane
 * (50), paket sayısı (20) ve çarpımı (1000); yoksa null
 */
export function packPair(line: Pick<PackLine, "name" | "description">): { text: string; per: number; packs: number; total: number } | null {
  for (const text of [line.name, line.description?.trim() ?? ""]) {
    if (!text) continue;
    const { t, at } = folded(text);
    const p = findPair(t);
    if (p) return { text: fragment(text, at, [p]), per: p.per, packs: p.packs, total: p.total };
  }
  return null;
}

/**
 * Bağlama formunun ipucu: adında iki sayı var ama faturadaki birimden hangisi olduğu belli değil (packEvidence kanıt
 * vermedi). Olasılıklar hammaddenin biriminde: bir paket (50) ya da hepsi (1000); faturadaki birim tek parçaysa (Adet)
 * ve en az bir paket kadar alınmışsa tek tane de (1; "100 AD X 10 PK" 1.000 Adet × 1,10 ₺: tedarikçi taneyle yazmış,
 * packEvidence'in tek sayı kuralı gibi). gr / ml'de adda boyut da yazmalı. Kanıt varsa ya da iki sayı yoksa null
 */
export function packPairChoices(line: PackLine, ingredientUnit: IngredientUnit): { text: string; choices: number[] } | null {
  if (packEvidence(line, ingredientUnit)) return null;
  const p = packPair(line);
  if (!p) return null;
  const q = line.quantity;
  const piece = unitKind(line.unit) === "single" && (q === null || q === undefined || Math.abs(q) >= p.per);
  // Aynı değer iki kez önerilmez (düğmenin anahtarı değerdir)
  const unique = (xs: number[]) => [...new Set(xs)];
  if (ingredientUnit === "adet" || ingredientUnit === "dilim") return { text: p.text, choices: unique([...(piece ? [1] : []), p.per, p.total]) };
  const dim = ingredientUnit === "gr" ? "mass" : ingredientUnit === "ml" ? "volume" : null;
  const size = parsePack(line.name).size;
  if (!dim || !size || size.dim !== dim) return null;
  return { text: p.text, choices: unique([...(piece ? [size.amount] : []), p.per * size.amount, p.total * size.amount]) };
}
