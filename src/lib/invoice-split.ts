/**
 * Karışık faturayı kalem kalem saymak (sahibin isteği, 25 Kasım 2026; docs/PARASUT.md › 5f. Kalem kalem sınıflandırma).
 * Avansas gibi hem gıda hem sarf satan tedarikçinin faturası bütünüyle ya mal alışı ya gider sayılıyordu. Artık:
 *
 * - hammaddeye bağlı kalem → **mal alışı** (mal maliyeti; fatura hangi kategoride olursa olsun);
 * - "hammadde değil" denmiş ve nedeni seçilmiş kalem → nedeninin yeri (`REASON_TARGET`: Sarf → Temizlik & Sarf, Demirbaş →
 *   Kuruluş & Demirbaş, Hizmet → Hizmet, Deneme → mal alışı);
 * - öbür kalemler (bekleyen, nedensiz "hammadde değil", bağlanmamış) → **faturanın kendi kategorisi** (bugünkü kural).
 *
 * Kafe dışı (karaoke box, Alp Koç) ve komisyon faturaları bölünmez. Faturanın KDV hariç, iskonto düşülmüş tutarı
 * (tutar − iskonto) kalemlere **kalemin net tutarıyla orantılı** dağıtılır: fatura altı iskonto da böylece kalemlere
 * oranla düşer; kuruş yuvarlaması en büyük kalan yöntemiyle toplamı tutturur. Kalem tutarları KDV hariçtir (Paraşüt
 * `net_total`); fatura tutarı da KDV hariç olduğundan iki taraf aynı tabanda. Saf; tests/fatura-kalem.test.ts.
 */

import { COMMISSION_CATEGORY, GOODS_CATEGORIES, SEPARATE_CATEGORIES } from "./constants";

/** Mal alışı payının anahtarı (kategori adlarıyla çakışmaz) */
export const GOODS_PART = "__mal";

/** "Temizlik & Sarf" fatura kategorisi: kuralsız ama sınıflanmış sarf ve temizlik malzemesi */
export const SUPPLIES_CATEGORY = "Temizlik & Sarf";

/** "Hammadde değil"in nedeni: kalemin nereye yazılacağını belirler */
export type NotIngredientReason = "sarf" | "demirbas" | "hizmet" | "deneme";
export const NOT_INGREDIENT_REASONS: readonly NotIngredientReason[] = ["sarf", "demirbas", "hizmet", "deneme"];
export const REASON_LABEL: Record<NotIngredientReason, string> = { sarf: "Sarf", demirbas: "Demirbaş", hizmet: "Hizmet", deneme: "Deneme" };
/** Neden → kalemin yazıldığı yer (fatura kategorisi ya da mal alışı) */
export const REASON_TARGET: Record<NotIngredientReason, string> = {
  sarf: SUPPLIES_CATEGORY,
  demirbas: "Kuruluş & Demirbaş",
  hizmet: "Hizmet",
  // Deneme / numune: hammadde listesinde yok ama tüketilen gıda; mal alışına
  deneme: GOODS_PART,
};
export const REASON_HINT: Record<NotIngredientReason, string> = {
  sarf: "Temizlik ve sarf malzemesi (çöp torbası, deterjan, eldiven): sarf giderine yazılır",
  demirbas: "Bir kez alınan, yıllarca kullanılan (ısıtıcı, makine): demirbaşa yazılır",
  hizmet: "Kargo, nakliye, servis bedeli: hizmet giderine yazılır",
  deneme: "Denemelik ya da numune ürün (listede yok): mal alışına yazılır",
};

export function parseReason(v: unknown): NotIngredientReason | null {
  return typeof v === "string" && (NOT_INGREDIENT_REASONS as readonly string[]).includes(v) ? (v as NotIngredientReason) : null;
}

/** Faturanın bölünüp bölünmediği: kafe dışı ve komisyon faturaları bütün kalır */
export function splittable(category: string): boolean {
  return !SEPARATE_CATEGORIES.includes(category) && category !== COMMISSION_CATEGORY;
}

/** Faturanın kendi payının anahtarı: mal kategorilerinde mal alışı, değilse kategorinin adı */
export const ownPart = (category: string) => (GOODS_CATEGORIES.includes(category) ? GOODS_PART : category);

/**
 * Kalemin hedefi: hammaddeye bağlıysa mal alışı; nedenli "hammadde değil" ise nedeninin yeri; değilse null (faturanın
 * kategorisi). `linked` ürün anahtarının bağlı olduğu, `reasonOf` ürünün (ya da tedarikçinin kuralının) nedeni
 */
export function lineTarget(o: { linked: boolean; reason: NotIngredientReason | null }): string | null {
  if (o.linked) return GOODS_PART;
  if (o.reason) return REASON_TARGET[o.reason];
  return null;
}

export interface SplitLine {
  /** Kalemin KDV hariç net tutarı (Paraşüt `net_total`) */
  net: number;
  /** null: faturanın kategorisi */
  to: string | null;
}

/**
 * Faturanın payları: anahtar → KDV hariç tutar (kuruşa yuvarlı, toplamı faturanın net tutarı). Kalem yoksa ya da fatura
 * bölünmüyorsa tek pay (faturanın kendi payı). Eksi (iade) faturada paylar da eksi.
 */
export function invoiceParts(inv: { category: string; amount: number; discount: number; lines?: readonly SplitLine[] | null }): Map<string, number> {
  const net = inv.amount - inv.discount;
  const own = ownPart(inv.category);
  const lines = inv.lines ?? [];
  if (!lines.length || !splittable(inv.category)) return new Map([[own, net]]);
  const weights = new Map<string, number>();
  for (const l of lines) {
    const k = l.to ?? own;
    weights.set(k, (weights.get(k) ?? 0) + Math.abs(l.net));
  }
  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  if (!(total > 0) || weights.size === 1) return new Map([[weights.size === 1 && total > 0 ? [...weights.keys()][0] : own, net]]);
  // Kuruşla en büyük kalan: payların toplamı faturanın tutarını kuruşu kuruşuna tutar
  const cents = Math.round(net * 100);
  const sign = cents < 0 ? -1 : 1;
  const abs = Math.abs(cents);
  const raw = [...weights].map(([k, w]) => ({ k, exact: (abs * w) / total }));
  const floor = raw.map((r) => ({ ...r, c: Math.floor(r.exact + 1e-9) }));
  let left = abs - floor.reduce((a, r) => a + r.c, 0);
  for (const r of [...floor].sort((a, b) => b.exact - b.c - (a.exact - a.c) || a.k.localeCompare(b.k))) {
    if (left <= 0) break;
    r.c++;
    left--;
  }
  return new Map(floor.map((r) => [r.k, (sign * r.c) / 100]));
}

/** Faturanın mal alışı payı */
export const goodsPart = (inv: Parameters<typeof invoiceParts>[0]) => invoiceParts(inv).get(GOODS_PART) ?? 0;

/** Faturanın bir kategoriye düşen payı (mal alışı hariç) */
export const categoryPart = (inv: Parameters<typeof invoiceParts>[0], category: string) => invoiceParts(inv).get(category) ?? 0;

/**
 * Yükleyicinin kalem hedefleri: yalnız payı faturanın kendi payından ayrılan kalem varsa faturaya kalem listesi eklenir
 * (çoğu faturada yok: bugünkü gibi bütün kalır, veri küçük kalır)
 */
export function splitLinesFor(category: string, lines: readonly SplitLine[]): SplitLine[] | null {
  if (!splittable(category) || !lines.length) return null;
  const own = ownPart(category);
  return lines.some((l) => l.to !== null && l.to !== own) ? lines.map((l) => ({ net: l.net, to: l.to })) : null;
}
