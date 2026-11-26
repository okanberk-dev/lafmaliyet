// Var olan kasalara giden bağlantılar (GET /api/panel/pos/baglanti; docs/LAFPOS.md › Şube kurulumu › Anahtar
// değişimi). Saf (tests/lafpos-kurulum.test.ts); node:crypto kullandığı için yalnız sunucuda (kurulum.ts tarayıcıda da).

import { createHash } from "node:crypto";

import { kurulumBaglantilari } from "./kurulum";

/**
 * Kurulumdakinin aynısı, lafmaliyet'inki hariç (kasa zaten onunla soruyor). `surum`: değerlerin kısa özeti; kasa yalnız
 * değişince saklar, uyguladığını sorguda söyler. Hiçbiri tanımlı değilse boş
 */
export function dagitilanBaglantilar(env: Record<string, string | undefined> = process.env): { surum: string; baglanti: Record<string, string> } {
  const all = kurulumBaglantilari({ panelUrl: "https://ladmin.invalid", syncSecret: null, env });
  delete all.LAFMALIYET_URL;
  const baglanti = Object.fromEntries(Object.entries(all).sort(([a], [b]) => a.localeCompare(b)));
  const surum = Object.keys(baglanti).length ? createHash("sha256").update(JSON.stringify(baglanti)).digest("hex").slice(0, 16) : "";
  return { surum, baglanti };
}
