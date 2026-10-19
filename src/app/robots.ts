import type { MetadataRoute } from "next";

/** Panel arama motorlarına kapalı: hiçbir sayfa taranmaz (ayrıca her yanıtta X-Robots-Tag: noindex) */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
