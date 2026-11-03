// Personel sızıntı denetimi (plan docs/planlar/personel-yetki.md §6.2): personele giden kaynakta (yükleyici, istemci
// bileşeni, eylem yanıtı) ya da JSON'da (RSC yükü, eylem yanıtı) maliyet, alış fiyatı, fatura tutarı, maaş, kâr, marj,
// komisyon ya da karaoke parası anahtarı olmamalı. Her grubun personel yükleyicileri ve istemci bileşenleri bununla
// taranır (tests/personel-sizinti-*.test.ts); yardımcının kendisi tests/onay-kuyrugu.test.ts'te sınanır.

import assert from "node:assert/strict";

/**
 * Yasak anahtarlar: nesne anahtarı ya da JSON anahtarı olarak (`cost:`, `"cost":`). Anahtar adın başından eşleşir:
 * `unitCost` yasak, `isEstimate` (bayrak) değil; düz metindeki sözcük (yorum, Türkçe metin) anahtar sayılmaz.
 */
export const COST_KEYS = [
  "cost",
  "unitCost",
  "packagePrice",
  "packPrice",
  "expectedUnitPrice",
  "estimate",
  "payable",
  "priceMinor",
  "priceMinorL",
  "margin",
  "costRatio",
  "commission",
  "salary",
  "maas",
  "prepaid",
  "karaokeAmount",
  "invoiceAmount",
] as const;

/**
 * Yazarkasa Z'sinin yalnız yöneticiye giden anahtarları (docs/planlar/okc-z.md İlke 8, D17): kümülatif sayaç ve yazarkasa
 * dışı tahsilat. Maliyet değildir (COST_KEYS'te yok); kasa sayfasında personelin yüküne girmemeli
 */
export const OKC_ADMIN_KEYS = ["okcCumTotal", "okcCumVat", "okcOutside", "cumTotal", "cumVat", "cumulativeTotal", "cumulativeVat", "outside", "okcAdmin"] as const;

/**
 * ModPOS kasa föyünün yalnız yöneticiye giden anahtarları (docs/MODPOS-API.md › Nerede görünür): günden güne listesinin
 * föy prop'u ve föyün kendi alanları (KasaFoyu, ModposZ). Föy personele hiç gitmez (personelin formu, WhatsApp ve
 * e-posta onu bilmez); maliyet değildir (COST_KEYS'te yok). Genel adlar (`zTotal`, `diffs`, `modpos`) bilerek yok:
 * personelin yükünde başka anlamla geçer
 */
export const MODPOS_ADMIN_KEYS = [
  "modposDays",
  "modposDay",
  "modposSheet",
  "modposDiffs",
  "kasaFoyu",
  "foysuzGunler",
  "foysuzCiro",
  "nakitKasa",
  "cariTahsilatlar",
  "araKasalar",
  "kirilim",
  "defterGirildi",
  "paymentsGap",
] as const;

const KEY_RE = new RegExp(`(?:^|[^A-Za-z0-9_$])"?(${COST_KEYS.join("|")})"?\\s*:`, "gm");

/** Kaynak koddaki yorumlar (satır ve blok): yorumda geçen sözcük anahtar değildir */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Metinde (kaynak ya da JSON) geçen yasak anahtarlar, ilk görünme sırasıyla, tekrarsız */
export function costKeysIn(sourceOrJson: string): string[] {
  const text = stripComments(sourceOrJson);
  return [...new Set([...text.matchAll(KEY_RE)].map((m) => m[1]))];
}

/** Personele giden kaynakta ya da JSON'da yasak anahtar varsa test düşer; `label` hangi dosya ya da yanıt olduğu */
export function assertNoCostKeys(sourceOrJson: string, label = "kaynak"): void {
  const found = costKeysIn(sourceOrJson);
  assert.deepEqual(found, [], `${label}: personele maliyet / tutar anahtarı gidiyor (${found.join(", ")})`);
}

/** ₺ yasağı olan personel ekranları için (karaoke, zayi, kontrol geçmişi, stok sayımı, özel günler, yardım) */
export function assertNoLira(text: string, label = "metin"): void {
  assert.doesNotMatch(text, /₺/, `${label}: personel ekranında tutar (₺) var`);
}
