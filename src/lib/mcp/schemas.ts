/*
 * Claude bağlantısının araç girdileri (zod; MCP tools/list bunlardan JSON şeması üretir). Açıklamalar Claude'a
 * gider: kısa, Türkçe, biçimiyle. Saf modül; araçların kendisi src/server/mcp/tools.ts'te.
 */

import { z } from "zod";

/** Ay, YYYY-MM */
export const zAy = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Ay YYYY-MM biçiminde olmalı")
  .describe("Ay, YYYY-MM (ör. 2026-10)");

/** Gün, YYYY-MM-DD (takvimde var olan bir gün) */
export const zGun = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD biçiminde olmalı")
  .refine((d) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
  }, "Geçersiz tarih")
  .describe("Tarih, YYYY-MM-DD (ör. 2026-10-01)");

/** Aranan ad (ürün, kategori, tedarikçi) */
export const zAd = z.string().trim().min(2, "En az 2 harf").max(60, "En çok 60 harf");

/**
 * Şube (şube kapsamı C P2-13): kimliği ya da adı ya da "hepsi". Verilmezse panelin seçimi (Claude bağlantısında bütün
 * şubeler, panel asistanında yöneticinin seçimi). Satış, kasa, gider ve ödemeler bu şubenin; çıktı `kapsam` yazar
 */
export const zSube = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .optional()
  .describe("Şube: adı ya da kimliği (ör. Marina, tuzla) ya da 'hepsi' (bütün şubeler); verilmezse panelde seçili kapsam");

/**
 * Şube görünümü (şube ayrımı D parça 4; docs/SUBE.md › Şube ayrımı): şube seçiliyken alanın kipi. "sube" yalnız o
 * şubenin (ve işletme genelinin) kayıtları, "firma" firmanın tamamı; verilmezse hesabın Hesabım › Şube görünümü tercihi.
 * "Tümü"de anlamsız
 */
export const zGorunum = z
  .enum(["sube", "firma"])
  .optional()
  .describe("Şube seçiliyken görünüm: 'sube' (yalnız o şube ve işletme geneli) ya da 'firma' (firmanın tamamı); verilmezse hesabın Şube görünümü tercihi");

export const zLimit = (def: number, max: number) => z.number().int().min(1).max(max).default(def).describe(`En çok kaç satır (varsayılan ${def}, en çok ${max})`);

export const ayOzetiInput = z
  .object({
    ay: zAy.optional().describe("Ay, YYYY-MM; verilmezse bu ay"),
    yil: z.number().int().min(2020).max(2100).optional().describe("Yıl (ör. 2026): verilirse yılın ayları tek tek; ay ile birlikte verilmez"),
    sube: zSube,
  })
  .strict();

export const SIRALAMALAR = ["toplam_kar", "birim_kar", "marj", "adet", "zarar"] as const;

export const urunKarliligiInput = z
  .object({
    ay: zAy.optional().describe("Satış adetlerinin ayı, YYYY-MM; verilmezse bu ay (satış listesi yoksa önceki son ay kullanılır)"),
    siralama: z
      .enum(SIRALAMALAR)
      .default("toplam_kar")
      .describe("toplam_kar (en çok kazandıran önce), birim_kar, marj, adet, zarar (en az kâr bırakan ya da zararına satılan önce)"),
    kategori: zAd.optional().describe("Kategori adı (ör. Soğuk kahveler)"),
    urun: zAd.optional().describe("Ürün adı ya da bir parçası (ör. latte)"),
    limit: zLimit(10, 50),
    sube: zSube,
  })
  .strict();

export const zamEtkisiInput = z
  .object({
    baslangic: zGun.optional().describe("Bu tarihten bu yana olan zamlar, YYYY-MM-DD; verilmezse son 30 gün (en çok 366 gün geriye)"),
    limit: zLimit(10, 30),
    sube: zSube,
  })
  .strict();

export const tedarikciOzetiInput = z
  .object({
    tedarikci: zAd.optional().describe("Tedarikçi adı ya da bir parçası (ör. Kaldi); verilmezse bütün tedarikçiler"),
    baslangic: zGun.optional().describe("Fatura tarihi başlangıcı, YYYY-MM-DD; verilmezse bu yılın başı"),
    bitis: zGun.optional().describe("Fatura tarihi sonu, YYYY-MM-DD; verilmezse bugün"),
    siralama: z
      .enum(["fatura", "borc"])
      .default("fatura")
      .describe("Bütün tedarikçiler listesinin sırası: fatura (dönemdeki fatura toplamı büyükten küçüğe) ya da borc (kalan borç büyükten küçüğe)"),
    limit: zLimit(20, 100),
    sube: zSube,
    gorunum: zGorunum,
  })
  .strict();

export const ODEME_ARALIKLARI = ["gecikmis", "hafta", "ay", "45gun"] as const;

export const odemelerInput = z
  .object({
    aralik: z.enum(ODEME_ARALIKLARI).default("45gun").describe("gecikmis (vadesi geçmiş), hafta (bu hafta), ay (bu ay), 45gun (gecikenler hariç 45 gün)"),
    kaynak: z.enum(["hepsi", "fatura", "hatirlatici", "cari"]).default("hepsi").describe("hepsi, fatura, hatirlatici ya da cari (tedarikçiye faturasız borç)"),
    nakitPlani: z.boolean().default(false).describe("true: 6 haftalık nakit planının haftalık özeti de"),
    sube: zSube,
    gorunum: zGorunum,
  })
  .strict();

export const kasaRaporlariInput = z
  .object({
    baslangic: zGun.describe("İlk gün, YYYY-MM-DD"),
    bitis: zGun.describe("Son gün, YYYY-MM-DD (en çok 92 gün; bugünden sonra olamaz)"),
    sube: zSube,
  })
  .strict();

export const araInput = z
  .object({
    metin: zAd.describe("Aranan ad: ürün, hammadde ya da tedarikçi (ör. süt)"),
  })
  .strict();

export type AyOzetiInput = z.output<typeof ayOzetiInput>;
export type UrunKarliligiInput = z.output<typeof urunKarliligiInput>;
export type ZamEtkisiInput = z.output<typeof zamEtkisiInput>;
export type TedarikciOzetiInput = z.output<typeof tedarikciOzetiInput>;
export type OdemelerInput = z.output<typeof odemelerInput>;
export type KasaRaporlariInput = z.output<typeof kasaRaporlariInput>;
export type AraInput = z.output<typeof araInput>;
