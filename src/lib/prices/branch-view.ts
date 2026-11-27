/**
 * Ürünler ve ürün kartının şube görünümü (şube ayrımı parça 5, 27 Kasım 2026; docs/SUBE.md › Şube ayrımı, docs/FIYATLAR.md
 * › Şube fiyatı): şube seçiliyken siteye bağlı ürünün o şubede geçerli fiyatı (şubenin kendi satırı) varsa birim kâr,
 * maliyet oranı ve durum o fiyatla hesaplanır; panelin fiyatı (sitenin kalemi) **taban fiyat** adıyla düzenlenmeye devam
 * eder. Menü, reçete ve taban fiyat ortak veridir: şubeye göre değişmez.
 *
 * Saf modül; testleri tests/sube-ayrimi-alanlar-5.test.ts.
 */

import { type ProductEconomics, statusFor } from "../calc/engine";
import type { Settings } from "../calc/types";
import type { SiteMenuSlot } from "../site-menu/slot";

/** Taban fiyatın ekrandaki adı (şubenin kendi fiyatı varken) */
export const BASE_PRICE_LABEL = "Taban fiyat";

/** Şubenin fiyat kalemi (src/server/data/branch-prices.ts › loadBranchPrices'ın satırı) */
export interface BranchPriceRef {
  id: string;
  base: { M: number; L: number };
  /** Şubede şu an geçerli; `from` şubenin kendi satırının anı (taban geçerliyse null) */
  current: { M: number; L: number; from: string | null };
}

/**
 * Ürünün şubedeki fiyatı: siteye bağlıysa ve şubenin kendi satırı geçerliyse (taban değil) o fiyat; yoksa null (taban
 * fiyat geçerli). Fiyat 0 ya da tabanla aynıysa da null (ayrı göstermeye değmez)
 */
export function productBranchPrice(link: { siteMenuId: string; slot: SiteMenuSlot } | null | undefined, items: readonly BranchPriceRef[], base: number): number | null {
  if (!link) return null;
  const item = items.find((i) => i.id === link.siteMenuId);
  if (!item || item.current.from === null) return null;
  const price = item.current[link.slot];
  if (!(price > 0) || Math.abs(price - base) < 0.005) return null;
  return price;
}

/**
 * Aynı ürünün başka bir satış fiyatıyla ekonomisi (engine.ts priceProduct'ın fiyata bağlı kısmı): maliyet ve önerilen
 * fiyat aynı, net, komisyon, birim kâr, marj, maliyet oranı ve durum yeni fiyatla
 */
export function economicsAtPrice<T extends Pick<ProductEconomics, "cost">>(
  e: T,
  price: number,
  st: Pick<Settings, "kdv" | "komisyon" | "kartOrani" | "hedefMaliyet">,
): T & Pick<ProductEconomics, "price" | "net" | "commission" | "totalCost" | "unitProfit" | "margin" | "costRatio" | "status"> {
  const net = price / (1 + st.kdv);
  const commission = price * st.komisyon * st.kartOrani;
  const unitProfit = net - e.cost - commission;
  const costRatio = net ? e.cost / net : 0;
  return {
    ...e,
    price,
    net,
    commission,
    totalCost: e.cost + commission,
    unitProfit,
    margin: net ? unitProfit / net : 0,
    costRatio,
    status: e.cost > 0 && !(net > 0) ? "Düşük kâr" : statusFor(e.cost, costRatio, st.hedefMaliyet),
  };
}
