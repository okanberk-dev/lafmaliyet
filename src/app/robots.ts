import type { MetadataRoute } from "next";

/**
 * Panel arama motorlarında görünmez. Tarama bilerek açık: robots.txt "Disallow: /" deseydi Google sayfayı hiç açamaz,
 * her yanıttaki `X-Robots-Tag: noindex` başlığını (next.config.ts) ve sayfaların noindex etiketini göremezdi; başka
 * bir yerden bağlantı alan adres aramada "açıklama yok" diye yine çıkabilirdi. Dizinden çıkaran noindex'tir.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/" }] };
}
