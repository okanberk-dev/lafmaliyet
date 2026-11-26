/**
 * Tarayıcı ölçümünün ortakları (docs/FOTOGRAF.md › Tarayıcının ölçümü): yanıt dosyasının biçimi, köşe hatası,
 * okunabilirlik (karakter doğruluğu, tutar bulma), yüzdelik, JPEG çözme. scripts/tarama-veri.ts,
 * scripts/tarama-olc.ts ve tests/tarama-regresyon.test.ts kullanır; uygulama kodu kullanmaz.
 */

import type { Point, Quad, RgbaImage } from "../../src/lib/scan/image";
import type { NesneTuru, KagitTuru } from "./kagit";
import type { Durum, Zemin } from "./sahne";

export type Kategori = KagitTuru | "belge-degil";
/** kirp: kâğıt bulunup kırpılmalı; tam-kare: kâğıt kareyi dolduruyor, kırpılmamalı; belge-degil: kırpılmamalı */
export type Beklenen = "kirp" | "tam-kare" | "belge-degil";
/** Tarayıcının kararı: kırptı, kareyi dolduruyor dedi, belge bulamadı */
export type Karar = "kirp" | "tam-kare" | "yok";

/** yanit.json'daki bir görsel */
export interface GorselYaniti {
  ad: string;
  dosya: string;
  genislik: number;
  yukseklik: number;
  kategori: Kategori;
  nesne?: NesneTuru;
  zemin: Zemin;
  durum: Durum;
  beklenen: Beklenen;
  /** Doğru köşeler (kâğıdın sol üst, sağ üst, sağ alt, sol alt köşesi; piksel); belge değilse null */
  koseler: [number, number][] | null;
  senaryolar: string[];
  jpegKalite: number;
  tohum: number;
  /** Kâğıttaki yazı, satır satır (okunabilirlik ölçümü); nesnelerde boş */
  metin: string[];
}

export interface VeriYaniti {
  surum: 1;
  tohum: number;
  gorseller: GorselYaniti[];
}

/** Başarı eşiği: en kötü köşenin hatası köşegenin %2'sinden az */
export const BASARI_ESIGI = 0.02;

export function dortgen(k: readonly (readonly [number, number])[]): Quad {
  return k.map(([x, y]) => ({ x, y })) as Quad;
}

export function tamKare(w: number, h: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: w - 1, y: 0 },
    { x: w - 1, y: h - 1 },
    { x: 0, y: h - 1 },
  ];
}

/**
 * Köşe hatası (köşegenin oranı): en kötü köşe ve dört köşenin ortalaması. Köşe sırası kâğıdın kendi yönündedir
 * (yana dönük fişte sol üst köşe ekranda sağ üstte olabilir), bu yüzden dört döngüsel kayma ve iki yön denenir,
 * en iyisi alınır.
 */
export function koseHatasi(bulunan: readonly Point[], dogru: readonly Point[], w: number, h: number): { enKotu: number; ort: number } {
  const diag = Math.hypot(w, h);
  let best = { enKotu: Infinity, ort: Infinity };
  for (const yon of [1, -1]) {
    for (let k = 0; k < 4; k++) {
      let m = 0;
      let s = 0;
      for (let i = 0; i < 4; i++) {
        const a = bulunan[i];
        const b = dogru[(((k + yon * i) % 4) + 4) % 4];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        m = Math.max(m, d);
        s += d;
      }
      if (m < best.enKotu) best = { enKotu: m, ort: s / 4 };
    }
  }
  return { enKotu: best.enKotu / diag, ort: best.ort / diag };
}

/** Sonuç: doğru, kaçan (kırpılmalıydı, kırpılmadı), yanlış (yanlış dörtgen ya da kırpılmaması gerekirken kırpıldı) */
export function sonucu(beklenen: Beklenen, karar: Karar, hata: number | null): "dogru" | "kacan" | "yanlis" {
  if (beklenen === "kirp") {
    if (karar !== "kirp") return "kacan";
    return hata !== null && hata < BASARI_ESIGI ? "dogru" : "yanlis";
  }
  if (beklenen === "tam-kare") return karar !== "kirp" || (hata !== null && hata < BASARI_ESIGI) ? "dogru" : "yanlis";
  return karar === "kirp" ? "yanlis" : "dogru";
}

/* ------------------------------------------------------------------ okunabilirlik */

/** Karşılaştırma için: küçük harf (Türkçe), boşluklar tek */
export function metinNormal(s: string): string {
  return s.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
}

/** Düzenleme uzaklığı (Levenshtein), iki satırlık bellekle */
export function duzenlemeUzakligi(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let onceki = new Int32Array(b.length + 1);
  let simdi = new Int32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) onceki[j] = j;
  for (let i = 1; i <= a.length; i++) {
    simdi[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const sil = onceki[j] + 1;
      const ekle = simdi[j - 1] + 1;
      const deg = onceki[j - 1] + (ca === b.charCodeAt(j - 1) ? 0 : 1);
      simdi[j] = sil < ekle ? (sil < deg ? sil : deg) : ekle < deg ? ekle : deg;
    }
    [onceki, simdi] = [simdi, onceki];
  }
  return onceki[b.length];
}

/** Karakter doğruluğu: 1 − düzenleme uzaklığı / bilinen metnin uzunluğu (0–1; fazladan çöp yazı da düşürür) */
export function karakterDogrulugu(okunan: string, bilinen: string): number {
  const b = metinNormal(bilinen);
  if (!b.length) return 1;
  return Math.max(0, 1 - duzenlemeUzakligi(metinNormal(okunan), b) / b.length);
}

const TUTAR = /\d{1,3}(?:\.\d{3})*,\d{2}/g;

/** Bilinen metindeki tutarlar (1.234,56) */
export function tutarlar(s: string): string[] {
  return s.match(TUTAR) ?? [];
}

/** Bilinen tutarların okunan metinde aynen bulunma oranı (her tutar bir kez sayılır; boşluklar yok sayılır) */
export function tutarBulma(okunan: string, bilinen: string): number | null {
  const istenen = tutarlar(bilinen);
  if (!istenen.length) return null;
  const sayac = new Map<string, number>();
  for (const t of tutarlar(okunan.replace(/(\d)\s+([.,]\d)/g, "$1$2").replace(/([.,])\s+(\d)/g, "$1$2"))) sayac.set(t, (sayac.get(t) ?? 0) + 1);
  let bulunan = 0;
  for (const t of istenen) {
    const n = sayac.get(t) ?? 0;
    if (n > 0) {
      bulunan++;
      sayac.set(t, n - 1);
    }
  }
  return bulunan / istenen.length;
}

/* ------------------------------------------------------------------ sayılar */

export function yuzdelik(xs: readonly number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1));
  return s[i];
}

export function ortalama(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

/* ------------------------------------------------------------------ görsel */

type Sharp = typeof import("sharp");

let sharpYuku: Promise<Sharp> | null = null;
/** sharp (next'in isteğe bağlı bağımlılığı); yalnız betik ve testlerde, dinamik */
export function sharpAl(): Promise<Sharp> {
  sharpYuku ??= import("sharp").then((m) => (m as unknown as { default?: Sharp }).default ?? (m as unknown as Sharp));
  return sharpYuku;
}

/** JPEG / PNG dosyasını RGBA'ya çözer (EXIF yönü uygulanmaz: veri setinde yok) */
export async function gorselOku(yol: string): Promise<RgbaImage> {
  const sharp = await sharpAl();
  const { data, info } = await sharp(yol).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

/** RGBA'yı PNG'ye kodlar (OCR'a vermek için) */
export async function pngYap(img: RgbaImage): Promise<Buffer> {
  const sharp = await sharpAl();
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), { raw: { width: img.width, height: img.height, channels: 4 } })
    .png({ compressionLevel: 1 })
    .toBuffer();
}
