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

export interface PackInfo {
  /** Tek ürünün miktarı: gr ya da ml */
  size: { amount: number; dim: "mass" | "volume" } | null;
  /** Pakette kaç tane ("x24", "9 ADET", "12 DİLİM") */
  count: number | null;
}

function sizeOf(n: string, unit: string): PackInfo["size"] {
  const v = toNum(n);
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
  const c = new RegExp(String.raw`${start}(\d+)\s*'?\s*(?:adet|ad|li|lu|dilim|pcs|pc|tv)(?![a-z])`).exec(t);
  return { size, count: c ? Number(c[1]) : null };
}

/** Faturadaki birim tek ürün mü, paket mi (koli, kutu…) */
const PACKAGE_UNITS = new Set(["koli", "kutu", "paket", "kasa", "set", "torba", "duzine", "kt", "bx", "cs", "ct", "pk", "pa", "npl"]);
const unitWord = (u: string | null) => words(u ?? "").join("");

const fmt = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");

/**
 * Faturadaki 1 birimin kaç hammadde birimi ettiği (formdaki "1 Koli = … ml"), bilinmiyorsa null:
 * - faturada ölçü birimi varsa (kg, lt) doğrudan çevrilir: 1 kg = 1000 gr;
 * - tek ürünse (Adet) addaki boyut: "SÜT 1 L" → 1000 ml, adet/dilim hammaddede 1;
 * - paketse (Koli, Kutu) paketteki sayı × boyut: "330ML 1X24" → 24 adet ya da 7920 ml; sayı yoksa tahmin edilmez.
 */
export function guessLinkFactor(product: { name: string; unit: string | null }, ingredientUnit: IngredientUnit): string | null {
  const u = unitWord(product.unit);
  if (u in MASS || u === "kilogram") return ingredientUnit === "gr" ? fmt(MASS[u] ?? 1000) : null;
  if (u in VOLUME || u === "litre") return ingredientUnit === "ml" ? fmt(VOLUME[u] ?? 1000) : null;
  const pack = parsePack(product.name);
  const isPackage = PACKAGE_UNITS.has(u);
  const count = isPackage ? (pack.count ?? (u === "duzine" ? 12 : null)) : 1;
  if (ingredientUnit === "adet" || ingredientUnit === "dilim") {
    if (!isPackage) return "1";
    return count ? fmt(count) : null;
  }
  const dim = ingredientUnit === "gr" ? "mass" : ingredientUnit === "ml" ? "volume" : null;
  if (!dim || !pack.size || pack.size.dim !== dim || !count) return null;
  return fmt(count * pack.size.amount);
}
