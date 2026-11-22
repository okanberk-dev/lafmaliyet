import { money } from "@/lib/format";

import type { SalesLineSize, SiteSales, SiteSalesLine } from "./schema";

/**
 * Online satışların panel hesapları (saf; hesap motoru, sunucu ve testler paylaşır). Ayrıntı: docs/SITE-SATIS.md.
 *
 * - **KDV hariç gelir** (sözleşmedeki formül): `netMinor − kdvMinor − unknownKdvNetMinor × r / (100 + r)`; `r` panelin
 *   kendi varsayılan KDV oranı (Ayarlar › Oranlar: kafe ve mağaza `settings.kdv`, karaoke `settings.kdvHizmet`; %10 →
 *   0,1). Site kuruş gönderir, panel TL gösterir.
 *   Ödül kuponuyla bedava verilen içeceğin faturası tam fiyattan KDV doğurur: KDV hariç gelir eksi çıkabilir, doğrudur.
 * - **Ürün eşlemesi** menü bağlantısıyla (docs/SITE-MENU.md): satırın kalemi `products.site_menu_id`, boyu yuvası
 *   (`L` → L yuvası, `M` ve `single` → M yuvası). Bağlı ürünü olmayan satır eşlenmez ve listelenir; başka boya düşülmez
 *   (yanlış boyun reçetesi tüketimi yanlış gösterirdi).
 */

/** KDV hariç tutar (kuruş, yuvarlanmadan): net − KDV − oranı bilinmeyenin panel oranıyla KDV'si */
export function exVatMinor(t: { netMinor: number; kdvMinor: number; unknownKdvNetMinor: number }, kdvRate: number): number {
  const r = Number.isFinite(kdvRate) && kdvRate >= 0 ? kdvRate : 0;
  return t.netMinor - t.kdvMinor - (t.unknownKdvNetMinor * r) / (1 + r);
}

/** Bir ayın online geliri, KDV hariç, TL */
export interface SiteRevenue {
  /** Kafe: uygulama ve web siparişleri (masa, gel-al, kurye) */
  cafe: number;
  /** Mağaza kolileri */
  shop: number;
  /** Ön ödemeli karaoke (köşkte kalan) */
  karaoke: number;
  total: number;
}

/** `serviceRate`: oranı saklı olmayan karaoke rezervasyonlarının oranı (hizmet KDV'si); verilmezse `kdvRate` */
export function siteRevenue(s: Pick<SiteSales, "cafe" | "shop" | "karaoke">, kdvRate: number, serviceRate = kdvRate): SiteRevenue {
  const cafe = exVatMinor(s.cafe, kdvRate) / 100;
  const shop = exVatMinor(s.shop, kdvRate) / 100;
  const karaoke = exVatMinor(s.karaoke, serviceRate) / 100;
  return { cafe, shop, karaoke, total: cafe + shop + karaoke };
}

/**
 * Ayın online satışındaki KDV (TL), sözleşmenin formülüyle: `kdvMinor + unknownKdvNetMinor × r / (1 + r)` (= net − KDV
 * hariç); kafe ve mağaza satış oranıyla, karaoke hizmet oranıyla. Panelden elle girilen siparişler (`manual`) kasada
 * olduğu için girmez. Nakit planının KDV tahmini kullanır (src/lib/kdv.ts).
 */
export function siteVat(s: Pick<SiteSales, "cafe" | "shop" | "karaoke">, kdvRate: number, serviceRate = kdvRate): number {
  const vat = (t: { netMinor: number; kdvMinor: number; unknownKdvNetMinor: number }, r: number) => t.netMinor - exVatMinor(t, r);
  return (vat(s.cafe, kdvRate) + vat(s.shop, kdvRate) + vat(s.karaoke, serviceRate)) / 100;
}

/** Bir ayın online satışının KDV **dahil** dökümü (TL): sitenin gönderdiği ham rakamlar */
export interface SiteGross {
  /** Kafe + mağaza + karaoke, iade düşülmeden (karaokede tahsil edilen) */
  gross: number;
  /** İade edilen (karaokede iptal edilip geri ödenen) */
  refunded: number;
  /** Köşkte kalan: gross − refunded */
  net: number;
  /** Netin içindeki KDV (kafe ve mağaza satış oranıyla, karaoke hizmet oranıyla; siteVat ile aynı) */
  vat: number;
  /** Sitenin uyguladığı indirim (karaokede yok) */
  discount: number;
  /** Kargo ücreti (mağazada netin içinde) */
  delivery: number;
}

/**
 * Ayın KDV dahil dökümü. Yalnız ciroya giren üç blok (kafe, mağaza, karaoke) toplanır: kasada ödenen (`counter`) ve
 * panelden elle girilen (`manual`) siparişler ModPOS'ta çalındığı için dışarıdadır (docs/SITE-SATIS.md).
 */
export function siteGross(s: Pick<SiteSales, "cafe" | "shop" | "karaoke">, kdvRate: number, serviceRate = kdvRate): SiteGross {
  const gross = s.cafe.grossMinor + s.shop.grossMinor + s.karaoke.collectedMinor;
  const refunded = s.cafe.refundedMinor + s.shop.refundedMinor + s.karaoke.refundedMinor;
  return {
    gross: gross / 100,
    refunded: refunded / 100,
    net: (s.cafe.netMinor + s.shop.netMinor + s.karaoke.netMinor) / 100,
    vat: siteVat(s, kdvRate, serviceRate),
    discount: (s.cafe.discountMinor + s.shop.discountMinor) / 100,
    delivery: (s.cafe.deliveryMinor + s.shop.deliveryMinor) / 100,
  };
}

/** Çekilen geçmiş ay sayısı: içinde bulunulan ayla birlikte üç ay */
export const SALES_PULL_BACK = 2;

/**
 * Günlük işin (ve Gelir-gider'deki "Siteden yenile"nin) çekeceği aylar: içinde bulunulan ay ve önceki iki ay, yeniden
 * eskiye. Site iadeyi siparişin verildiği aya, karaokeyi parasının alındığı aya yazar: cayma hakkıyla (14 gün) dönen
 * koli ya da 60 gün sonrasına alınıp iptal edilen karaoke kapanmış bir ayı haftalar sonra düşürür; üç ay her gün
 * yeniden sorulur (üç küçük imzalı istek, aynı anda)
 */
export function salesMonthsToPull(today: string): string[] {
  const out = [today.slice(0, 7)];
  for (let i = 0; i < SALES_PULL_BACK; i++) {
    const [y, m] = out[out.length - 1].split("-").map(Number);
    out.push(m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`);
  }
  return out;
}

/** Satırın bağlanacağı yuva: L → L, M ve tek boy → M (sitenin `siteMenuSlot` kuralı) */
export const lineSlot = (size: SalesLineSize): "M" | "L" => (size === "L" ? "L" : "M");

const linkKey = (menuItemId: string, slot: "M" | "L") => `${menuItemId}|${slot}`;

/** Bağlı ürünlerin dizini: "mnu-0003|M" → ürün kimliği */
export function buildSiteLinkIndex(products: readonly { id: number; siteMenuId?: string | null; siteMenuSlot?: string | null }[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const p of products) {
    if (!p.siteMenuId || (p.siteMenuSlot !== "M" && p.siteMenuSlot !== "L")) continue;
    index.set(linkKey(p.siteMenuId, p.siteMenuSlot), p.id);
  }
  return index;
}

/** Satırın panel ürünü (kimlik) ya da bağlı ürün yoksa null */
export function productForLine(line: Pick<SiteSalesLine, "menuItemId" | "size">, index: ReadonlyMap<string, number>): number | null {
  if (!line.menuItemId) return null;
  return index.get(linkKey(line.menuItemId, lineSlot(line.size))) ?? null;
}

export interface MappedLines<L extends Pick<SiteSalesLine, "menuItemId" | "size">> {
  mapped: { line: L; productId: number }[];
  /** Panel ürününe bağlı olmayan satırlar (kalemsiz ya da kalemin o yuvasına bağlı ürün yok) */
  unmapped: L[];
}

export function mapSiteLines<L extends Pick<SiteSalesLine, "menuItemId" | "size">>(lines: readonly L[], index: ReadonlyMap<string, number>): MappedLines<L> {
  const out: MappedLines<L> = { mapped: [], unmapped: [] };
  for (const line of lines) {
    const productId = productForLine(line, index);
    if (productId === null) out.unmapped.push(line);
    else out.mapped.push({ line, productId });
  }
  return out;
}

// ---------------------------------------------------------------- Seçenekler (ekstra shot, şurup, süt)

/**
 * Online kafe satırının seçeneklerinin panel ürünü: sitenin menü kalemine bağlı ürün (Ürünler › Site menüsü; kasada
 * ayrı satır olarak çalınan "Extra Shot", "Syrup") ya da adı tutan ürün (ModPOS'taki ekstra satırı). Ürünün reçetesi
 * tüketime, maliyeti reçeteye göre kâra girer; ürün yoksa seçenek Tutarlılık'ta eşlenmeyen olarak listelenir.
 */
export const OPTION_PRODUCTS = {
  extraShots: { label: "Ekstra shot", menuItemId: "mnu-0081", names: ["extra shot", "ekstra shot"] },
  syrups: { label: "Şurup", menuItemId: "mnu-0080", names: ["syrup", "surup"] },
  milks: { label: "Alternatif süt", menuItemId: null, names: ["alternatif sut"] },
} as const satisfies Record<string, { label: string; menuItemId: string | null; names: readonly string[] }>;

export type OptionKind = keyof typeof OPTION_PRODUCTS;
export const OPTION_KINDS = Object.keys(OPTION_PRODUCTS) as OptionKind[];

/** Sayılmayan süt seçimi: normal (inek) süt içeceğin kendi reçetesindedir */
export const NORMAL_MILK = "normal";

/** Adın karşılaştırma anahtarı: "Alternatif Süt" → "alternatif sut" (Türkçe duyarlı, aksansız) */
export const optionNameKey = (name: string) =>
  name
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Satırların seçenek adetleri: ekstra shot, şurup, normal dışı süt (alanları olmayan eski satır 0) */
export function optionTotals(lines: readonly Pick<SiteSalesLine, "extraShots" | "syrups" | "milks">[]): Record<OptionKind, number> {
  const out: Record<OptionKind, number> = { extraShots: 0, syrups: 0, milks: 0 };
  for (const l of lines) {
    out.extraShots += l.extraShots ?? 0;
    for (const n of Object.values(l.syrups ?? {})) out.syrups += n;
    for (const [id, n] of Object.entries(l.milks ?? {})) if (id !== NORMAL_MILK) out.milks += n;
  }
  return out;
}

/**
 * Seçeneğin panel ürünü (kimlik) ya da null: önce sitenin menü kalemine bağlı ürün (M, yoksa L yuvası), sonra adı
 * tutan ürün (etkin olan önce, sonra en eski)
 */
export function optionProductId(
  kind: OptionKind,
  index: ReadonlyMap<string, number>,
  products: readonly { id: number; name: string; active: boolean }[],
): number | null {
  const def = OPTION_PRODUCTS[kind];
  if (def.menuItemId) {
    const linked = index.get(linkKey(def.menuItemId, "M")) ?? index.get(linkKey(def.menuItemId, "L"));
    if (linked !== undefined) return linked;
  }
  const names: readonly string[] = def.names;
  const byName = products.filter((p) => names.includes(optionNameKey(p.name))).sort((a, b) => Number(b.active) - Number(a.active) || a.id - b.id);
  return byName[0]?.id ?? null;
}

/** Ekranda boy: "M", "L", tek boyda "" */
export const sizeLabel = (size: SalesLineSize): string => (size === "single" ? "" : size);

/** Kasa raporunun bilgi satırı: o günün online toplamı (kafe + mağaza) ve karaoke ön ödemesi, KDV dahil, TL */
export interface TillOnlineRow {
  day: string;
  /** Uygulama ve web siparişleri (kafe + mağaza kolisi), iadeler düşülmüş */
  online: number;
  /** Ön ödemeli karaoke (köşkte kalan) */
  karaoke: number;
  /** "Online (site + uygulama): 1.240 ₺ · Karaoke ön ödeme: 500 ₺ — kasadan geçmez" */
  text: string;
}

export const TILL_ROW_NOTE = "kasadan geçmez";

/**
 * Sitenin şubeleri (laffogato #279, sitenin docs/PANEL-SALES.md › Şube kırılımı): kasa raporunun satırı kasanın şubesini
 * `&branch=` ile ister. Şube verilmezse Tuzla (eski davranış: şubesiz kasa Tuzla'nındı); sitede karşılığı olmayan kanal
 * (laffogato.net online kanalı) null: satır yok
 */
export const SITE_BRANCHES = ["tuzla", "marina"] as const;
export type SiteBranch = (typeof SITE_BRANCHES)[number];

export function siteBranchOf(branchId: string | null | undefined): SiteBranch | null {
  if (!branchId) return "tuzla";
  return (SITE_BRANCHES as readonly string[]).includes(branchId) ? (branchId as SiteBranch) : null;
}

/**
 * Yanıt istenen şubenin mi: site `branch`'i söyler. Şubesiz eski site alanı yazmaz ve bütün siparişleri verir (hepsi
 * Tuzla'nındı): Tuzla için kabul, Marina için değil (Tuzla'nın rakamı Marina'nın satırına yazılmasın)
 */
export function siteBranchMatches(requested: SiteBranch, got: unknown): boolean {
  if (got === requested) return true;
  return requested === "tuzla" && got === undefined;
}

export function tillOnlineRow(day: string, s: Pick<SiteSales, "cafe" | "shop" | "karaoke">): TillOnlineRow {
  const online = (s.cafe.netMinor + s.shop.netMinor) / 100;
  const karaoke = s.karaoke.netMinor / 100;
  return { day, online, karaoke, text: `Online (site + uygulama): ${money(online)} · Karaoke ön ödeme: ${money(karaoke)} — ${TILL_ROW_NOTE}` };
}

/** Kasa raporu satırı en çok bu kadar beklenir (siteye istek zaten 8 saniyede kesilir; gövde okuması dahil sınır) */
export const TILL_ROW_TIMEOUT_MS = 8_500;

/**
 * Kasa raporunun satırı ya da null: site ulaşılamazsa, yanıtı bozuksa ya da `timeoutMs` içinde gelmezse satır yoktur.
 * Hiçbir zaman hata fırlatmaz ve süreden uzun beklemez: kasa raporu (sayfa, gönderim, e-posta) siteye bağlı değildir.
 */
export async function tillRowOrNull(day: string, load: () => Promise<Pick<SiteSales, "cafe" | "shop" | "karaoke">>, timeoutMs = TILL_ROW_TIMEOUT_MS): Promise<TillOnlineRow | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const sales = await Promise.race([load(), timeout]);
    return sales ? tillOnlineRow(day, sales) : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
