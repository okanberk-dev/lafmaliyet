/**
 * Belge taramanın saf kuralları (sunucu ve istemci birlikte kullanır; tests/foto-tarama.test.ts sınar): hangi
 * fotoğraf taranır, taranmış ve asıl hâlin ölçüleri, sunucuya giden tarama bilgisinin denetimi, kod emin değilken
 * yapay zekâya sorma kararı. Tarayıcının kendisi src/lib/scan/ (telefonda, Web Worker'da); ekran
 * src/components/panel/scan-editor.tsx; ayrıntı docs/FOTOGRAF.md › Belge tarama.
 */

import { MAX_OKC_PHOTOS, MAX_PHOTO_EDGE, MIN_PHOTO_EDGE, type PhotoKind } from "./photo-rules";
import type { QuarterTurn, ScanMode } from "./scan";

/**
 * Taranan türler: ModPOS Z'si, yazarkasa (banka POS) Z'si ve banka gün sonu fişi, kasadan çıkan alışveriş fişi ve
 * fatura. Kontrol listesinin fotoğrafı (tezgâh, vitrin) belge değildir, taranmaz
 */
export const SCAN_KINDS: readonly PhotoKind[] = ["kasa-z", "kasa-pos", "kasa-okc", "fis"];

export function isScanKind(kind: unknown): kind is PhotoKind {
  return typeof kind === "string" && (SCAN_KINDS as readonly string[]).includes(kind);
}

/**
 * Uzun fiş parça parça çekilebilen türler ("Devamını çek"): rulo kâğıda basılan her şey (Z, yazarkasa Z, banka gün
 * sonu, alışveriş fişi). Parçalar kodla birleştirilir (src/lib/scan/stitch.ts); en çok `MAX_SCAN_PARTS` parça: yazarkasa
 * bölümünün sınırı, birleşmezse parçalar ayrı fotoğraf olarak oraya sığar
 */
export const MAX_SCAN_PARTS = MAX_OKC_PHOTOS;

export function scanPartsKind(kind: PhotoKind): boolean {
  return isScanKind(kind);
}

export const SCAN_MODE_LIST = ["belge", "gri", "renkli", "orijinal"] as const satisfies readonly ScanMode[];
export const SCAN_MODE_LABEL: Record<ScanMode, string> = { belge: "Belge", gri: "Gri", renkli: "Renkli", orijinal: "Orijinal" };

/**
 * Köşelerin nereden geldiği: kodun yöntemi ("kagit", "kenar", "yazi"; "tam-kare" ve "yok": kırpılmadı), yapay zekânın
 * ipucu (kodun gerçek kenara oturttuğu), kullanıcının sürüklediği ("elle") ya da "Tüm fotoğraf"
 */
export const SCAN_METHODS = ["kagit", "kenar", "yazi", "tam-kare", "yok", "yapay-zeka", "elle", "tum-fotograf"] as const;
export type ScanInfoMethod = (typeof SCAN_METHODS)[number];

/** Fotoğraf satırında saklanan tarama bilgisi (photos.scan) */
export interface ScanInfo {
  /** Kullanılan köşeler, asıl fotoğrafa oranla 0–1000 (sol üst, sağ üst, sağ alt, sol alt) */
  corners: [number, number][];
  mode: ScanMode;
  method: ScanInfoMethod;
  /** Kodun algılama güveni (0–1); köşeler elle ya da yapay zekâyla verildiyse de kodunki */
  confidence: number;
  /** Çıktıya uygulanan çeyrek dönüş (saat yönünde) */
  rotate: QuarterTurn;
  /** Yapay zekâya köşe soruldu mu (yanıt kullanılmasa da) */
  ai: boolean;
  /**
   * Uzun fiş birkaç parçada çekilip tek görüntüde birleştirildi: parça sayısı (2–`MAX_SCAN_PARTS`). Köşeler, yöntem ve
   * asıl fotoğraf ilk parçanın
   */
  parts?: number;
}

/** Tarama bilgisinin form alanı en çok bu kadar karakter (sunucu daha uzununu okumaz) */
export const SCAN_INFO_MAX_CHARS = 600;

const QUARTERS: readonly QuarterTurn[] = [0, 90, 180, 270];

/**
 * İstemcinin gönderdiği tarama bilgisi (`tarama` form alanı, JSON): yalnız tanınan alanlar, sınırlar içinde; biri bile
 * tutmazsa null (fotoğraf yine saklanır, bilgisi boş kalır). Köşeler tam sayıya yuvarlanır, güven iki basamağa.
 */
export function parseScanInfo(raw: unknown): ScanInfo | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length > SCAN_INFO_MAX_CHARS) return null;
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.corners) || o.corners.length !== 4) return null;
  const corners: [number, number][] = [];
  for (const p of o.corners) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const [x, y] = p as unknown[];
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < 0 || x > 1000 || y < 0 || y > 1000) return null;
    corners.push([Math.round(x), Math.round(y)]);
  }
  if (!(SCAN_MODE_LIST as readonly unknown[]).includes(o.mode)) return null;
  if (!(SCAN_METHODS as readonly unknown[]).includes(o.method)) return null;
  if (typeof o.confidence !== "number" || !(o.confidence >= 0 && o.confidence <= 1)) return null;
  if (!(QUARTERS as readonly unknown[]).includes(o.rotate)) return null;
  if (typeof o.ai !== "boolean") return null;
  if (o.parts !== undefined && !(Number.isInteger(o.parts) && (o.parts as number) >= 2 && (o.parts as number) <= MAX_SCAN_PARTS)) return null;
  return {
    corners,
    mode: o.mode as ScanMode,
    method: o.method as ScanInfoMethod,
    confidence: Math.round(o.confidence * 100) / 100,
    rotate: o.rotate as QuarterTurn,
    ai: o.ai,
    ...(o.parts !== undefined ? { parts: o.parts as number } : {}),
  };
}

/**
 * Telefonda çözülen fotoğrafın ölçüsü (tarayıcının girdisi): okumanın ölçüsüyle aynı (photo-compress PHOTO_COMPRESS,
 * en uzun kenar 2576 px, ~3,7 MP; ~1670×2220). Büyüğü telefonun belleğini zorlar (birkaç RGBA ve Float32 kopya)
 */
export const SCAN_INPUT = { maxEdge: 2576, maxPixels: 3_700_000 } as const;

/**
 * Taranmış görüntünün JPEG'i: okumanın kalitesi (0,7); siyah-beyaz belge çoğunlukla 150–500 KB. `maxBytes`'ı aşarsa
 * daha düşük kaliteyle yeniden kodlanır (sunucu 2 MB'ı keser)
 */
export const SCAN_OUTPUT = { quality: 0.7, maxBytes: 1_800_000, maxPixels: 3_700_000 } as const;

/**
 * Asıl fotoğrafın yedeği ("Orijinal" düğmesi; ileride yeniden taramaya yeter): 1800 px, %65, çoğu 150–400 KB
 * (src/lib/photo-compress.ts compressImage)
 */
export const ORIGINAL_COMPRESS = { maxEdge: 1800, quality: 0.65, maxBytes: 1_800_000 } as const;

/** Dar uzun fişin taranmış hâlinde kısa kenar en az bu kadar olsun (sunucunun alt sınırı 200 px; pay bırakılır) */
export const SCAN_MIN_SHORT = 260;

/**
 * Tarayıcıya verilecek çıktı ölçüsü (`scanDocument` maxEdge): `aspect` uzun kenar / kısa kenar (≥ 1). Olağan belgede
 * uzun kenar 2576 px'i ve alan ~3,7 MP'i aşmaz (A4 ~1620×2290); dar uzun fişte kısa kenar en az 260 px kalsın diye uzun
 * kenar 4096'ya kadar büyür (1:10 fiş 2600×260). Daha da darı (1:16'dan dar) kısa kenarı 260'ın altında kalır;
 * yüklemede kenarına beyaz pay eklenir (uploadCanvas).
 */
export function scanMaxEdge(aspect: number): number {
  const a = Number.isFinite(aspect) && aspect >= 1 ? aspect : 1;
  const byPixels = Math.floor(Math.sqrt(SCAN_OUTPUT.maxPixels * a));
  const normal = Math.min(SCAN_INPUT.maxEdge, byPixels);
  return Math.min(MAX_PHOTO_EDGE, Math.max(normal, Math.ceil(SCAN_MIN_SHORT * a)));
}

/**
 * Yüklenecek tuvalin ölçüsü: kısa kenarı sunucunun alt sınırının (200 px) altında kalan görüntü (çok dar fiş) iki
 * yanına beyaz pay eklenerek genişletilir; uzun kenarı 4096'yı aşan (olmamalı) aynı oranla küçültülür. `x`, `y`:
 * görüntünün tuvaldeki yeri, `width`/`height` çizileceği ölçü.
 */
export function uploadCanvas(width: number, height: number): { canvasWidth: number; canvasHeight: number; x: number; y: number; width: number; height: number } {
  let w = Math.max(1, Math.round(width));
  let h = Math.max(1, Math.round(height));
  const long = Math.max(w, h);
  if (long > MAX_PHOTO_EDGE) {
    const k = MAX_PHOTO_EDGE / long;
    w = Math.max(1, Math.round(w * k));
    h = Math.max(1, Math.round(h * k));
  }
  const cw = Math.max(w, MIN_PHOTO_EDGE);
  const ch = Math.max(h, MIN_PHOTO_EDGE);
  return { canvasWidth: cw, canvasHeight: ch, x: Math.floor((cw - w) / 2), y: Math.floor((ch - h) / 2), width: w, height: h };
}

/** Taranan belgenin asıl fotoğrafının adresi (aynı erişim kuralı; taranmadan yüklenende 404) */
export const originalPhotoUrl = (id: number) => `/api/foto/${id}?v=asil`;

/** Kodun algılamasından ekrana ve karara gerekenler (src/lib/scan Detection'ın bir kısmı) */
export interface DetectionLike {
  corners: unknown[] | null;
  confidence: number;
  method: string | null;
  fillsFrame: boolean;
  reasons?: readonly string[];
}

/** Bu güvenin altında kod "emin değil": okuma açıksa yapay zekâya köşe sorulur */
export const HINT_BELOW_CONFIDENCE = 0.6;

/**
 * Yapay zekâya köşe sorulsun mu: kâğıt bulunamadı ya da kareyi dolduruyor sanıldı (açık tezgâhta beyaz fiş çoğu kez
 * böyle kaçar), güven düşük, karede iki aday var ya da seçilen dörtgen kâğıda benzemiyor. Kod eminse sorulmaz (ücretsiz).
 */
export function needsAiHint(d: DetectionLike): boolean {
  if (!d.corners || d.fillsFrame || d.method === null || d.method === "tam-kare") return true;
  if (!(d.confidence >= HINT_BELOW_CONFIDENCE)) return true;
  return Boolean(d.reasons?.some((r) => r === "iki-aday" || r === "kagida-benzemiyor"));
}

/** Yapay zekâya gönderilen kopya: en uzun kenar 1024 px JPEG (köşe için yeter; ~1.000 girdi tokenı) */
export const HINT_IMAGE = { maxEdge: 1024, quality: 0.7 } as const;
/** POST /api/foto/kenar bundan büyük görseli okumaz */
export const HINT_MAX_BYTES = 600 * 1024;
/** Köşe ipucunun günlük sınırı (yapay zekâ çağrısı; fotoğraf okumalarının sınırına sayılmaz, src/server/ai/claude.ts) */
export const SCAN_HINT_DAILY_CAP = 150;

/** Ekranda gösterilen durum satırı (köşeler bulunamadıysa sürükleme çağrısı) */
export function scanStatusText(s: { method: ScanInfoMethod | null; confidence: number; aiPending?: boolean }): string {
  if (s.aiPending) return "Kenarlar aranıyor…";
  if (s.method === "yapay-zeka") return "Kenarlar bulundu; gerekirse köşeleri sürükleyin.";
  if (s.method === "elle") return "Köşeleri siz ayarladınız.";
  if (s.method === "tum-fotograf") return "Fotoğrafın tamamı kullanılacak.";
  if (s.method === null || s.method === "yok" || s.method === "tam-kare") return "Kenarlar bulunamadı; köşeleri sürükleyin.";
  if (s.confidence < HINT_BELOW_CONFIDENCE) return "Kenarlardan emin değilim; köşeleri kontrol edin.";
  return "Kenarlar bulundu; gerekirse köşeleri sürükleyin.";
}
