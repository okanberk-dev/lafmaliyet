/**
 * Belge tarayıcı çekirdeği (telefonda, tarayıcıda çalışır; sunucu görseli çözmez). Akış: kâğıt algılama (ya da
 * verilen köşeler) → perspektif düzeltme → kalan eğiklik → taranmış görünüm. Hepsi saf ve eşzamanlı; büyük fotoğrafta
 * arayüzü dondurmamak için bir Web Worker'da çağrılabilir. Belge: docs/FOTOGRAF.md › Belge tarama (çekirdek).
 */

import type { Point, Quad, RgbaImage } from "./image";
import { fitSize, histogram, histPercentile, resizeRgba, scaleQuad, toGray, unscaleQuad } from "./image";
import { interiorAngles, isConvex, orderCorners, polygonArea } from "./geom";
import { clampQuad, detectDocument, MAX_OUTSIDE, type DetectMethod, type DetectOptions } from "./detect";
import { refineCorners } from "./refine";
import { estimateSkew, enhance, type ScanMode } from "./enhance";
import { applyHomography, estimateSize, homography, rotationAbout, verticalShear, warpQuad, type Affine } from "./warp";

export type { GrayImage, Point, Quad, RgbaImage } from "./image";
/** Köşeleri önizleme kopyası ile asıl fotoğraf arasında taşımak için (piksel merkezleri hizalı) */
export { scaleQuad, unscaleQuad } from "./image";
export { orderCorners } from "./geom";
export { detectDocument, MAX_OUTSIDE, type DetectMethod, type DetectOptions, type Detection } from "./detect";
export { refineCorners, type RefineOptions, type RefineResult } from "./refine";
export { enhance, estimateSkew, SCAN_MODES, type ScanMode, type SkewEstimate } from "./enhance";
export {
  applyHomography,
  estimateSize,
  homography,
  invert3,
  rotateQuarter,
  warpQuad,
  type Affine,
  type Mat3,
  type OutputSize,
  type WarpOptions,
} from "./warp";

/** Saat yönünde çeyrek dönüş (derece) */
export type QuarterTurn = 0 | 90 | 180 | 270;

/** Belgenin üst kenarı görüntünün hangi tarafında (yapay zekâ ipucu): up düz, right sağda, down ters, left solda */
export type DocumentTop = "up" | "right" | "down" | "left";

export interface ScanOptions {
  /**
   * Verilirse algılama yapılmaz (kullanıcının köşeleri ya da ipucudan çevrilmiş köşeler; asıl pikselde; sırası
   * önemsiz). Köşe görüntünün en çok %10 dışında olabilir.
   */
  corners?: Quad | null;
  /** Varsayılan "belge" */
  mode?: ScanMode;
  /** Çıktının uzun kenarı en çok (px); varsayılan 2000 */
  maxEdge?: number;
  /** Kalan küçük eğikliği (±8°) yazı satırlarına bakarak düzelt; varsayılan açık */
  deskew?: boolean;
  /** Verilen köşeleri önce gerçek kenarlara oturt (kaba köşe, yapay zekâ ipucu); varsayılan kapalı */
  refine?: boolean;
  /**
   * Çıktıyı saat yönünde çevir (yan ya da ters çekilmiş belge; yapay zekânın "top" ipucundan `rotationForTop`).
   * Çevirme açmayla birlikte yapılır (ek geçiş yok); eğiklik çevrilmiş sayfada ölçülür. Varsayılan 0.
   */
  rotate?: QuarterTurn;
  detect?: DetectOptions;
}

export type ScanMethod = DetectMethod | "verilen" | "yok";

export interface ScanResult {
  /** Taranmış görüntü (RGBA) */
  image: RgbaImage;
  /**
   * Kullanılan köşeler (asıl pikselde, görüntüye göre sıralı: sol üst, sağ üst, sağ alt, sol alt); belge bulunamadıysa
   * ya da kareyi dolduruyorsa görüntünün köşeleri. Kâğıdın köşesi kareden çıkmışsa o köşe görüntünün biraz dışında
   * olabilir (en çok `MAX_OUTSIDE`); dışarıda kalan yer kâğıt rengiyle dolar.
   */
  corners: Quad;
  /** 0–1; köşeler verildiyse 1 */
  confidence: number;
  method: ScanMethod;
  /** Kâğıt kareyi dolduruyor ya da bulunamadı: kırpılmadı */
  fillsFrame: boolean;
  /**
   * Uygulanan eğiklik düzeltmesi (derece, artı: içerik saat yönünde çevrildi). Dar uzun fişte dönüş yerine yamultma
   * uygulanır (uzun kenarlar yerinde kalır, satırlar düzelir).
   */
  rotation: number;
  /** Uygulanan çeyrek dönüş (seçenekteki `rotate`) */
  rotate: QuarterTurn;
  reasons: string[];
  /** Ölçülen süreler (ms) */
  timings: { detect: number; warp: number; enhance: number; total: number };
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Algılama, köşe oturtma ve eğiklik önizlemesinin çalışma kopyası (uzun kenar) */
const WORK_EDGE = 1000;

/** Görüntünün köşeleri (kırpmasız) */
export function fullFrame(width: number, height: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: width - 1, y: height - 1 },
    { x: 0, y: height - 1 },
  ];
}

/** Verilen köşe görüntünün en çok bu oranında dışında olabilir (algılamanın sınırından biraz geniş) */
const GIVEN_OUTSIDE = 0.1;

/**
 * Dörtgen kullanılabilir mi: dört sayı noktası, sıralanınca dışbükey, görüntünün içinde (en çok %10 taşabilir: kareden
 * çıkmış köşe), alanı görüntünün en az %1'i, iç açılar 25°–155°.
 */
export function quadIsValid(q: readonly Point[] | null | undefined, width: number, height: number): boolean {
  if (!q || q.length !== 4) return false;
  for (const p of q) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    const ox = GIVEN_OUTSIDE * width;
    const oy = GIVEN_OUTSIDE * height;
    if (p.x < -ox || p.y < -oy || p.x > width - 1 + ox || p.y > height - 1 + oy) return false;
  }
  const o = orderCorners(q);
  if (!isConvex(o)) return false;
  if (polygonArea(o) < 0.01 * width * height) return false;
  const a = interiorAngles(o);
  return Math.min(...a) >= 25 && Math.max(...a) <= 155;
}

/**
 * Yapay zekânın 0–1000 oranlı köşelerini (x, y) piksele çevirir ve sıralar. Dizi [[x, y], …] ya da {x, y} olabilir;
 * dört nokta değilse ya da sayı değilse null. Ucuz model bazen oran yerine yapay zekâya gönderilen görüntünün
 * pikselini verir (1000'i aşan değer): `sent` (o görüntünün ölçüsü) verilmişse değerler ona bölünür.
 */
export function cornersFromHint(
  hint: readonly (readonly [number, number] | Point)[] | null | undefined,
  width: number,
  height: number,
  sent?: { width: number; height: number },
): Quad | null {
  if (!hint || hint.length !== 4) return null;
  const raw: [number, number][] = [];
  for (const h of hint) {
    if (!h || typeof h !== "object") return null;
    const x = Array.isArray(h) ? h[0] : (h as Point).x;
    const y = Array.isArray(h) ? h[1] : (h as Point).y;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    raw.push([x, y]);
  }
  const pixels = !!sent && sent.width > 0 && sent.height > 0 && raw.some(([x, y]) => x > 1000 || y > 1000);
  const pts = raw.map(([x, y]) => {
    const fx = Math.max(0, Math.min(1, pixels ? x / (sent!.width - 1) : x / 1000));
    const fy = Math.max(0, Math.min(1, pixels ? y / (sent!.height - 1) : y / 1000));
    return { x: fx * (width - 1), y: fy * (height - 1) };
  });
  return orderCorners(pts);
}

/** Pikseldeki köşeleri 0–1000 orana çevirir (kaydetmek, yapay zekâya ipucu vermek için; kare dışı köşe kenetlenir) */
export function cornersToHint(q: Quad, width: number, height: number): [number, number][] {
  const r = (v: number, size: number) => Math.max(0, Math.min(1000, Math.round((v / Math.max(1, size - 1)) * 1000)));
  return q.map((p) => [r(p.x, width), r(p.y, height)] as [number, number]);
}

/** Yapay zekânın "top" ipucundan çıktının çevrilmesi gereken açı (saat yönünde): üst sağdaysa sola çevrilir (270°) */
export function rotationForTop(top: DocumentTop | null | undefined): QuarterTurn {
  return top === "right" ? 270 : top === "down" ? 180 : top === "left" ? 90 : 0;
}

/** Köşeleri, açılan görüntü saat yönünde `rotate` derece çevrilmiş çıksın diye kaydırır (sol üst yeni sol üst olur) */
function turnCorners(q: Quad, rotate: QuarterTurn): Quad {
  const k = rotate / 90;
  return [0, 1, 2, 3].map((i) => q[(i - k + 4) % 4]) as Quad;
}

/** Düzeltilmiş küçük kopyadan kâğıdın rengi: en aydınlık çeyreğin ortalaması (kâğıt dışına düşen yer bununla dolar) */
function paperColor(img: RgbaImage): [number, number, number] {
  const g = toGray(img).data;
  const thr = histPercentile(histogram(g), 0.75);
  let r = 0;
  let gg = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < g.length; i++) {
    if (g[i] < thr) continue;
    r += img.data[i * 4];
    gg += img.data[i * 4 + 1];
    b += img.data[i * 4 + 2];
    n++;
  }
  if (!n) return [255, 255, 255];
  return [Math.round(r / n), Math.round(gg / n), Math.round(b / n)];
}

/**
 * Kâğıdın kenarı fotoğrafta birkaç piksellik yumuşak geçiştir: köşeler tam kenarda olunca açılan sayfanın en dış
 * satırı yarı zemin olur, taranmış görünümde ince koyu çerçeve çıkar. Sayfa, çıktının kısa kenarının %0,4'ü (1–6 px)
 * içeriden açılır; kâğıdın boş kenar payından gider.
 */
function insetPage(q: Quad, width: number, height: number): Quad {
  const d = Math.max(1, Math.min(6, 0.004 * Math.min(width, height)));
  const rect = (k: number): Point[] => [
    { x: -0.5 + k, y: -0.5 + k },
    { x: width - 0.5 - k, y: -0.5 + k },
    { x: width - 0.5 - k, y: height - 0.5 - k },
    { x: -0.5 + k, y: height - 0.5 - k },
  ];
  const H = homography(rect(0), q);
  return rect(d).map((p) => applyHomography(H, p)) as Quad;
}

/**
 * Fotoğrafı tarar: köşeler verilmediyse belge algılanır; bulunamazsa ya da kâğıt kareyi dolduruyorsa kırpılmaz (yalnız
 * görünüm işlenir). Döner: taranmış görüntü, kullanılan köşeler, güven, yöntem, uygulanan eğiklik düzeltmesi.
 */
export function scanDocument(img: RgbaImage, opts: ScanOptions = {}): ScanResult {
  const t0 = now();
  const mode = opts.mode ?? "belge";
  const maxEdge = opts.maxEdge ?? 2000;
  const rotate: QuarterTurn = opts.rotate === 90 || opts.rotate === 180 || opts.rotate === 270 ? opts.rotate : 0;
  let corners: Quad;
  let confidence = 1;
  let method: ScanMethod = "verilen";
  let fillsFrame = false;
  const reasons: string[] = [];
  // algılama, köşe oturtma ve eğiklik önizlemesi tek bir küçük kopyada; tam çözünürlükte yalnız açma ve görünüm
  const work = thumbnail(img, WORK_EDGE);
  const toWork = (q: Quad) => scaleQuad(q, img.width, img.height, work.width, work.height);
  const fromWork = (q: Quad) => unscaleQuad(q, img.width, img.height, work.width, work.height);
  if (opts.corners && quadIsValid(opts.corners, img.width, img.height)) {
    corners = orderCorners(opts.corners);
    if (opts.refine) {
      const r = refineCorners(work, toWork(corners), { workEdge: WORK_EDGE });
      corners = fromWork(r.corners);
      reasons.push(`oturan-kenar-${r.snapped}`);
    }
  } else {
    if (opts.corners) reasons.push("verilen-kose-gecersiz");
    const d = detectDocument(work, opts.detect);
    confidence = d.confidence;
    reasons.push(...d.reasons);
    method = d.method ?? "yok";
    if (d.corners && !d.fillsFrame) corners = clampQuad(fromWork(d.corners), img.width, img.height, MAX_OUTSIDE);
    else {
      corners = fullFrame(img.width, img.height);
      fillsFrame = true;
    }
  }
  const t1 = now();
  // köşeler görüntünün köşeleriyse açma birebir olsun (piksel merkezi 0 … W−1; kâğıdın kenarı −0,5 … W−0,5)
  const frame = fullFrame(img.width, img.height);
  const isFrame = corners.every((p, i) => Math.abs(p.x - frame[i].x) <= 0.75 && Math.abs(p.y - frame[i].y) <= 0.75);
  let pageCorners = turnCorners(
    isFrame
      ? [
          { x: -0.5, y: -0.5 },
          { x: img.width - 0.5, y: -0.5 },
          { x: img.width - 0.5, y: img.height - 0.5 },
          { x: -0.5, y: img.height - 0.5 },
        ]
      : corners,
    rotate,
  );
  let size: { width: number; height: number };
  if (isFrame) {
    const f = fitSize(img.width, img.height, maxEdge);
    size = rotate % 180 ? { width: f.height, height: f.width } : f;
  } else {
    size = estimateSize(pageCorners, img.width, img.height, maxEdge);
    pageCorners = insetPage(pageCorners, size.width, size.height);
  }
  const outside = corners.some((p) => p.x < -0.5 || p.y < -0.5 || p.x > img.width - 0.5 || p.y > img.height - 0.5);
  let correction: Affine | undefined;
  let rotation = 0;
  let fill: [number, number, number] | undefined;
  if (opts.deskew !== false || outside) {
    const pv = fitSize(size.width, size.height, 800);
    const preview = warpQuad(work, toWork(pageCorners), pv.width, pv.height);
    if (outside) fill = paperColor(preview);
    const sk = opts.deskew !== false ? estimateSkew(preview) : null;
    if (sk && sk.confidence >= 0.3 && Math.abs(sk.angle) >= 0.3) {
      rotation = -sk.angle;
      const cx = (size.width - 1) / 2;
      const cy = (size.height - 1) / 2;
      // dar uzun fiş (boy ≥ 2 × en): uzun kenarlar yerinde kalsın diye yamultma; ötekiler merkez etrafında dönüş
      correction = size.height >= 2 * size.width ? verticalShear(rotation, cx) : rotationAbout(rotation, cx, cy);
      fill ??= paperColor(preview);
      reasons.push(`egiklik-${sk.angle.toFixed(1)}`);
    }
  }
  const warped = warpQuad(img, pageCorners, size.width, size.height, { correction, fill });
  const t2 = now();
  const image = enhance(warped, mode);
  const t3 = now();
  return {
    image,
    corners,
    confidence,
    method,
    fillsFrame,
    rotation,
    rotate,
    reasons,
    timings: { detect: t1 - t0, warp: t2 - t1, enhance: t3 - t2, total: t3 - t0 },
  };
}

/** Önizleme için küçük kopya (alan ortalamalı): ör. köşe sürükleme ekranı */
export function thumbnail(img: RgbaImage, maxEdge: number): RgbaImage {
  const sz = fitSize(img.width, img.height, maxEdge);
  return sz.width === img.width && sz.height === img.height ? img : resizeRgba(img, sz.width, sz.height);
}
