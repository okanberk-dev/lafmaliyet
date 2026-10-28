// Ürün listesi ve reçete kartının saf (sunucuya gitmeyen) hesapları: miktar ve fire alanının okunması,
// kaydedilmemiş değişiklik denetimi, listenin sıralaması ve alt satırdaki ortalamalar.
// Hepsi tests/urunler.test.ts ile sınanır.

import type { ProductStatus } from "@/lib/calc/engine";
import { evaluateExpression, formatPercentInput, parseNumberTR, parsePercentInput } from "@/lib/calc/expr";
import type { Settings } from "@/lib/calc/types";
import { num } from "@/lib/format";

// ---------------------------------------------------------------- Miktar alanı

export interface QtyResult {
  /** Hesaba giren miktar (malzemenin birimiyle) */
  qty: number;
  /** Formülse kaydedilecek metin ("=" olmadan), sayıysa null */
  expr: string | null;
  error: string | null;
  /**
   * Noktalı yazılan düz sayının nasıl okunduğu ("0.125" → "0,125", "1.250" → "1250"). Nokta hem ondalık hem bin
   * ayıracı olabildiği için alanın altında gösterilir; virgüllü ya da tam sayıda null.
   */
  echo: string | null;
}

const PLAIN_NUMBER = /^-?[\d.,\s]+$/;
const NEGATIVE = "Miktar negatif olamaz";

/** Gruplamasız, en fazla 4 ondalık: "1250", "0,125" */
const plain = (v: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 4, useGrouping: false }).format(v);

/**
 * Reçete satırındaki miktar metnini çözer. Düz sayı (virgüllü ya da noktalı), "=" ile ya da "=" olmadan formül
 * (2*ShotCift, DondurmaTop+5) kabul edilir.
 *
 * "0.125" gibi 0 ile başlayan noktalı sayı her zaman ondalıktır (bin grubu 0 ile başlamaz): parseNumberTR'nin
 * "1.022 = bin yirmi iki" kuralı yalnızca 1–999 ile başlayan gruplara uygulanır.
 */
export function resolveQty(input: string, settings: Settings): QtyResult {
  const raw = input.trim();
  if (!raw) return { qty: 0, expr: null, error: null, echo: null };
  const body = raw.replace(/^=/, "").trim();
  if (!body) return { qty: 0, expr: null, error: "Formül eksik", echo: null };
  if (PLAIN_NUMBER.test(body)) {
    const compact = body.replace(/\s/g, "");
    const n = parseNumberTR(compact);
    if (n === null) return { qty: 0, expr: null, error: `Sayı anlaşılamadı: ${body}`, echo: null };
    if (n < 0) return { qty: n, expr: null, error: NEGATIVE, echo: null };
    return { qty: n, expr: null, error: null, echo: compact.includes(".") ? plain(n) : null };
  }
  try {
    const qty = evaluateExpression(body, settings);
    return { qty, expr: body, error: qty < 0 ? NEGATIVE : null, echo: null };
  } catch (e) {
    return { qty: 0, expr: body, error: e instanceof Error ? e.message : "Geçersiz formül", echo: null };
  }
}

/** Kayıtlı miktarın alandaki metni: formülse formül, değilse virgüllü sayı (en fazla 4 ondalık) */
export function qtyText(qty: number, expr: string | null): string {
  return expr ?? num(qty, 4);
}

// ---------------------------------------------------------------- Zayi / fire alanı

export interface FireResult {
  /** Bu ürüne özel oran (0–1); boşsa null (genel oran kullanılır) */
  rate: number | null;
  /** Kaydı engelleyen hata */
  error: string | null;
  /** Kaydı engellemeyen uyarı ("%0,08. 8 mi demek istediniz?") */
  warning: string | null;
  /** Uyarıdaki önerinin alana yazılacak metni ("8") */
  suggestion: string | null;
}

/**
 * Ürüne özel fire alanı. Yazılan değer yüzde puanıdır (parsePercentInput): "8", "%8", "8%" ve "% 8" hepsi %8.
 * Okunamayan metin artık sessizce %0 sayılmaz: hata döner ve kayıt engellenir. %1'in altı ya da %50'nin üstü
 * kaydedilebilir ama uyarı verir (Excel'deki "0,08" alışkanlığı %0,08 olur; öneri tek tıkla %8 yapar).
 */
export function parseFireInput(text: string): FireResult {
  const raw = text.trim();
  if (!raw) return { rate: null, error: null, warning: null, suggestion: null };
  // "0.075" ondalıktır (%0,075): parseNumberTR 0 ile başlayan noktalı sayıyı bin grubu saymaz
  const rate = parsePercentInput(raw);
  if (rate === null) return { rate: null, error: "Sayı yazın (ör. 8 ya da 7,5); boş bırakırsanız genel oran kullanılır", warning: null, suggestion: null };
  if (rate < 0) return { rate, error: "Fire negatif olamaz", warning: null, suggestion: null };
  if (rate > 1) return { rate, error: "Fire en fazla %100 olabilir", warning: null, suggestion: null };
  if (rate > 0 && rate < 0.01) {
    const points = formatPercentInput(rate * 100);
    return { rate, error: null, warning: `= ${firePct(rate)}. %${points} mi demek istediniz?`, suggestion: points };
  }
  if (rate > 0.5) return { rate, error: null, warning: `= ${firePct(rate)}; bu çok yüksek bir fire, doğru mu?`, suggestion: null };
  return { rate, error: null, warning: null, suggestion: null };
}

/** Fire oranının okunuşu: "%8", "%7,5", "%0,075" (gereksiz ",0" olmadan; küçük oran yuvarlanıp başka sayı gibi görünmesin) */
export const firePct = (rate: number) => `%${formatPercentInput(rate, 3)}`;

/** Kayıtlı fire oranının alandaki metni ("8", "7,5"); özel oran yoksa boş */
export const fireText = (rate: number | null) => (rate === null ? "" : formatPercentInput(rate));

/** İki oran aynı mı (kayan nokta payıyla; ikisi de null ise aynı) */
export function sameRate(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 1e-9;
}

/**
 * Kopyalanmadan açılan yeni ürünün zayi oranı: aynı kategorideki ürünlerde en sık kullanılan oran. Boş oran
 * (Ayarlar'daki genel oran) da bir seçenek sayılır; eşitlikte en son eklenen ürünün oranı kazanır. Kategoride ürün
 * yoksa boş döner (genel oran). Ayrı bir kategori ayarı yok: oran ürün kartından değişir.
 */
export function categoryFireDefault(peers: { id: number; fireOverride?: number | null }[]): number | null {
  const groups = new Map<string, { rate: number | null; count: number; newest: number }>();
  for (const p of peers) {
    const rate = p.fireOverride ?? null;
    const key = rate === null ? "genel" : rate.toFixed(6);
    const g = groups.get(key);
    if (!g) groups.set(key, { rate, count: 1, newest: p.id });
    else {
      g.count++;
      if (p.id > g.newest) Object.assign(g, { rate, newest: p.id });
    }
  }
  let best: { rate: number | null; count: number; newest: number } | null = null;
  for (const g of groups.values()) if (!best || g.count > best.count || (g.count === best.count && g.newest > best.newest)) best = g;
  return best?.rate ?? null;
}

/** Yeni ürün penceresinde kategorinin altında: kopyasız açılan ürünün alacağı zayi oranı */
export function newProductFireHint(rate: number | null): string {
  return rate === null
    ? "Zayi oranı Ayarlar'daki genel oran olur; ürün kartından değiştirebilirsiniz."
    : `Zayi oranı ${firePct(rate)} olur (bu kategorideki ürünlerin çoğunda böyle); ürün kartından değiştirebilirsiniz.`;
}

// ---------------------------------------------------------------- Kaydedilmemiş değişiklik

export interface RecipeLineState {
  ingredientId: number | null;
  qty: number;
  expr: string | null;
  note: string | null;
}

/**
 * Reçete satırlarının karşılaştırma imzası: yazılan metin değil, kaydedilecek değer. Böylece "=ShotCift" ile
 * kayıtlı "ShotCift", "0.5" ile "0,5" ve sonda boşluklu not, kayıttan sonra "kaydedilmemiş" görünmez.
 * Formülde metin karşılaştırılır (ayar değişince miktar kendiliğinden değişir), düz sayıda değer.
 */
export function recipeSignature(lines: RecipeLineState[]): string {
  return JSON.stringify(
    lines.map((l) => [l.ingredientId, l.expr ? `=${l.expr}` : Math.round(l.qty * 1e6) / 1e6, (l.note ?? "").trim()]),
  );
}

// ---------------------------------------------------------------- Liste: sıralama ve ortalamalar

export interface SortableRow {
  name: string;
  size: string;
  category: string;
  status: ProductStatus;
  costRatio: number;
  fireRate: number;
}

/** Durum sırası: büyükten küçüğe sıralayınca önce reçetesizler ve düşük kârlılar gelir */
export const STATUS_RANK: Record<ProductStatus, number> = { İyi: 0, Dikkat: 1, "Düşük kâr": 2, "Reçete yok": 3 };

const byName = (a: SortableRow, b: SortableRow) => a.name.localeCompare(b.name, "tr") || a.size.localeCompare(b.size, "tr");

/**
 * Sayısal olmayan sütunların karşılaştırması (artan yönde). Eşitlikte bir sonraki anlamlı sütuna bakılır:
 * durumda maliyet oranı, kategoride ve firede menü sırası korunur (sıralama kararlıdır).
 */
export function compareBy(key: "name" | "status" | "category" | "fireRate", a: SortableRow, b: SortableRow): number {
  switch (key) {
    case "name":
      return byName(a, b);
    case "status":
      return STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.costRatio - b.costRatio;
    case "category":
      return a.category.localeCompare(b.category, "tr");
    case "fireRate":
      return a.fireRate - b.fireRate;
  }
}

export interface AverageRow {
  status: ProductStatus;
  costRatio: number;
  margin: number;
}

/**
 * Excel Ürün Kârlılık satır 134 "TOPLAM / ORTALAMA": K134 =AVERAGE(kâr marjı), L134 =AVERAGE(maliyet oranı).
 * Basit ortalama (her ürün bir oy). Reçetesi olmayan ürün katılmaz: maliyet oranı 0 sayılıp ortalamayı
 * olduğundan iyi göstermesin (Excel'de böyle ürün yok, sonuç aynı).
 */
export function menuAverages(rows: AverageRow[]): { count: number; costRatio: number | null; margin: number | null } {
  const list = rows.filter((r) => r.status !== "Reçete yok");
  if (!list.length) return { count: 0, costRatio: null, margin: null };
  return {
    count: list.length,
    costRatio: list.reduce((a, r) => a + r.costRatio, 0) / list.length,
    margin: list.reduce((a, r) => a + r.margin, 0) / list.length,
  };
}

/** Ayın kâr dökümüne giren ürün satırı (Ürünler sayfasındaki `ProductRow`'un alanları) */
export interface SoldProfitRow {
  status: ProductStatus;
  soldQty: number;
  monthProfit: number;
  monthNet: number;
}

/**
 * Ayın brüt kârı ve net satışı, satılan reçeteli ürünlerden (Ürünler'in brüt kâr kartı, dökümü ve tablonun alt satırı).
 * Reçetesi boş ürün katılmaz: maliyeti 0 sayılınca birim kârı ~fiyatı kadar görünür ve kartı şişirirdi (Genel bakış'ın
 * kâr sıralaması ve Analiz'deki gruplarla aynı kural, denetim E-47); satılan reçetesizler `noRecipe`'te ayrı döner.
 */
export function soldProfit<T extends SoldProfitRow>(rows: readonly T[]): { profit: number; net: number; counted: T[]; noRecipe: T[] } {
  const sold = rows.filter((r) => r.soldQty > 0);
  const counted = sold.filter((r) => r.status !== "Reçete yok");
  return {
    profit: counted.reduce((a, r) => a + r.monthProfit, 0),
    net: counted.reduce((a, r) => a + r.monthNet, 0),
    counted,
    noRecipe: sold.filter((r) => r.status === "Reçete yok"),
  };
}

/**
 * Kârı ve oranı anlamsız ürün (reçete yok): birim kâr, aylık kâr, marj ve maliyet oranı sıralamasında sona kalır
 * (yön ne olursa olsun); tabloda bu sütunlarda tire görünür
 */
export const NO_RECIPE_LAST_KEYS = ["unitProfit", "monthProfit", "margin", "costRatio"] as const;

// ---------------------------------------------------------------- Durum süzgeci

/** Durum çiplerinin sırası (en iyiden en kötüye, sonda reçetesiz) */
export const STATUS_CHIPS: ProductStatus[] = ["İyi", "Dikkat", "Düşük kâr", "Reçete yok"];

/**
 * Gösterilen durum çipleri. "Reçete yok" yalnızca menüde reçetesi olmayan bir ürün varken (ya da seçiliyken)
 * görünür. Süzgeçlere (boy, kategori, arama) bakılmaz, sayısı 0 olsa da durur: telefondaki süzgeç penceresinde
 * "Large"a dokununca çip kaybolup satırlar kaymasın, sonraki dokunuş hedeflenen yere gelsin.
 */
export function statusChips(rows: { status: ProductStatus }[], selected: readonly ProductStatus[]): ProductStatus[] {
  const noRecipe = selected.includes("Reçete yok") || rows.some((r) => r.status === "Reçete yok");
  return STATUS_CHIPS.filter((s) => s !== "Reçete yok" || noRecipe);
}

// ---------------------------------------------------------------- Ay bağlantısı

/** Ürün listesinin son adres sorgusu (oturum boyunca, yalnızca bu tarayıcıda): karttaki "← Ürünler" süzgeçlere döner */
export const LIST_QUERY_KEY = "laffogato:urunler-liste";

/** Ürün kartı adresi; listede seçili ay karta taşınır (kartın "Eylül satılan adet" satırı listeyle aynı ay) */
export const productHref = (id: number, month?: string | null) => `/panel/urunler/${id}${month ? `?ay=${month}` : ""}`;

/** Listeye dönüş adresi: listenin son süzgeçleri (?durum, ?kategori…) korunur, ay kartta seçilen ay olur */
export function listHref(savedQuery: string | null, month?: string | null): string {
  const sp = new URLSearchParams(savedQuery ?? "");
  if (month) sp.set("ay", month);
  const qs = sp.toString();
  return `/panel/urunler${qs ? `?${qs}` : ""}`;
}

// ---------------------------------------------------------------- Kopyalama metinleri

/** "a", "a ve b", "a, b ve c" */
function joinTR(parts: string[]): string {
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} ve ${parts[parts.length - 1]}` : (parts[0] ?? "");
}

const capitalize = (t: string) => (t ? `${t[0].toLocaleUpperCase("tr-TR")}${t.slice(1)}` : t);

/** Kopyala penceresinin açıklaması: reçeteyle birlikte neyin taşınacağı önceden söylenir */
export function copyDescription(src: { fireOverride: number | null; note: string | null }): string {
  const extra = [src.fireOverride !== null ? `özel fire oranı (${firePct(src.fireOverride)})` : null, src.note ? "ürün notu" : null].filter(
    (x): x is string => x !== null,
  );
  return `Reçetesiyle birlikte yeni bir ürün ya da boy oluşturur.${extra.length ? ` ${capitalize(joinTR(extra))} da kopyalanır.` : ""}`;
}

/** Kopyalamadan sonra bildirim: "4 malzeme, özel fire %8 ve not kopyalandı." */
export function copiedSummary(r: { lines: number; fireOverride: number | null; noteCopied: boolean }): string {
  const parts = [r.lines ? `${num(r.lines)} malzeme` : "boş reçete", r.fireOverride !== null ? `özel fire ${firePct(r.fireOverride)}` : null, r.noteCopied ? "not" : null].filter(
    (x): x is string => x !== null,
  );
  return `${capitalize(joinTR(parts))} kopyalandı.`;
}
