import { money } from "@/lib/format";

import type { SalesLineSize, SiteSales, SiteSalesLine } from "./schema";

/**
 * Online satışların panel hesapları (saf; hesap motoru, sunucu ve testler paylaşır). Ayrıntı: docs/SITE-SATIS.md.
 *
 * - **KDV hariç gelir** (sözleşmedeki formül): `netMinor − kdvMinor − unknownKdvNetMinor × r / (100 + r)`; `r` panelin
 *   kendi varsayılan KDV oranı (Ayarlar › Oranlar, `settings.kdv`; %10 → 0,1). Site kuruş gönderir, panel TL gösterir.
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

export function siteRevenue(s: Pick<SiteSales, "cafe" | "shop" | "karaoke">, kdvRate: number): SiteRevenue {
  const cafe = exVatMinor(s.cafe, kdvRate) / 100;
  const shop = exVatMinor(s.shop, kdvRate) / 100;
  const karaoke = exVatMinor(s.karaoke, kdvRate) / 100;
  return { cafe, shop, karaoke, total: cafe + shop + karaoke };
}

/** Günlük işin çekeceği aylar: içinde bulunulan ay; ayın ilk 7 gününde bir önceki ay da (geç gelen iadeler) */
export function salesMonthsToPull(today: string): string[] {
  const month = today.slice(0, 7);
  const dayOfMonth = Number(today.slice(8, 10));
  if (dayOfMonth > 7) return [month];
  const [y, m] = month.split("-").map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  return [month, prev];
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
