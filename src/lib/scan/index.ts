/**
 * Belge tarayıcı çekirdeği (telefonda, tarayıcıda çalışır; sunucu görseli çözmez). Akış: kâğıt algılama (ya da
 * verilen köşeler) → perspektif düzeltme → kalan eğiklik → taranmış görünüm. Hepsi saf ve eşzamanlı; büyük fotoğrafta
 * arayüzü dondurmamak için bir Web Worker'da çağrılabilir. Belge: docs/FOTOGRAF.md › Belge tarama (çekirdek).
 */

import type { Point, Quad, RgbaImage } from "./image";
import { fitSize, resizeRgba, scaleQuad, toGray, unscaleQuad } from "./image";
import { interiorAngles, isConvex, orderCorners, polygonArea } from "./geom";
import { detectDocument, type DetectMethod, type DetectOptions } from "./detect";
import { refineCorners } from "./refine";
import { estimateSkew, enhance, type ScanMode } from "./enhance";
import { estimateSize, rotationAbout, verticalShear, warpQuad, type Affine } from "./warp";

export type { GrayImage, Point, Quad, RgbaImage } from "./image";
export { orderCorners } from "./geom";
export { detectDocument, type DetectMethod, type DetectOptions, type Detection } from "./detect";
export { refineCorners, type RefineOptions, type RefineResult } from "./refine";
export { enhance, estimateSkew, SCAN_MODES, type ScanMode, type SkewEstimate } from "./enhance";
export { applyHomography, estimateSize, homography, invert3, rotateQuarter, warpQuad, type Mat3, type OutputSize } from "./warp";

export interface ScanOptions {
  /** Verilirse algılama yapılmaz (kullanıcının köşeleri ya da ipucudan çevrilmiş köşeler; asıl pikselde) */
  corners?: Quad | null;
  /** Varsayılan "belge" */
  mode?: ScanMode;
  /** Çıktının uzun kenarı en çok (px); varsayılan 2000 */
  maxEdge?: number;
  /** Kalan küçük eğikliği (±8°) yazı satırlarına bakarak düzelt; varsayılan açık */
  deskew?: boolean;
  /** Verilen köşeleri önce gerçek kenarlara oturt (kaba köşe, yapay zekâ ipucu); varsayılan kapalı */
  refine?: boolean;
  detect?: DetectOptions;
}

export type ScanMethod = DetectMethod | "verilen" | "yok";

export interface ScanResult {
  /** Taranmış görüntü (RGBA) */
  image: RgbaImage;
  /** Kullanılan köşeler (asıl pikselde); belge bulunamadıysa ya da kareyi dolduruyorsa görüntünün köşeleri */
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

/**
 * Dörtgen kullanılabilir mi: sıralı, dışbükey, görüntünün içinde (en çok %2 taşabilir), alanı görüntünün en az %1'i,
 * iç açılar 25°–155°.
 */
export function quadIsValid(q: readonly Point[] | null | undefined, width: number, height: number): boolean {
  if (!q || q.length !== 4) return false;
  for (const p of q) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    if (p.x < -0.02 * width || p.y < -0.02 * height || p.x > 1.02 * width || p.y > 1.02 * height) return false;
  }
  const o = orderCorners(q);
  if (!isConvex(o)) return false;
  if (polygonArea(o) < 0.01 * width * height) return false;
  const a = interiorAngles(o);
  return Math.min(...a) >= 25 && Math.max(...a) <= 155;
}

/**
 * Yapay zekânın 0–1000 oranlı köşelerini (x, y) piksele çevirir ve sıralar. Dizi [[x, y], …] ya da {x, y} olabilir;
 * dört nokta değilse ya da sayı değilse null.
 */
export function cornersFromHint(hint: readonly (readonly [number, number] | Point)[] | null | undefined, width: number, height: number): Quad | null {
  if (!hint || hint.length !== 4) return null;
  const pts: Point[] = [];
  for (const h of hint) {
    const x = Array.isArray(h) ? h[0] : (h as Point).x;
    const y = Array.isArray(h) ? h[1] : (h as Point).y;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const cx = Math.max(0, Math.min(1000, x));
    const cy = Math.max(0, Math.min(1000, y));
    pts.push({ x: (cx / 1000) * (width - 1), y: (cy / 1000) * (height - 1) });
  }
  return orderCorners(pts);
}

/** Pikseldeki köşeleri 0–1000 orana çevirir (kaydetmek, yapay zekâya ipucu vermek için) */
export function cornersToHint(q: Quad, width: number, height: number): [number, number][] {
  return q.map((p) => [Math.round((p.x / Math.max(1, width - 1)) * 1000), Math.round((p.y / Math.max(1, height - 1)) * 1000)] as [number, number]);
}

/** Düzeltilmiş küçük kopyadan kâğıdın rengi (eğiklik düzeltmesinde kâğıt dışına düşen yer bununla dolar) */
function paperColor(img: RgbaImage): [number, number, number] {
  const g = toGray(img).data;
  const sorted = Float32Array.from(g).sort();
  const thr = sorted[Math.floor(sorted.length * 0.75)];
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
 * Fotoğrafı tarar: köşeler verilmediyse belge algılanır; bulunamazsa ya da kâğıt kareyi dolduruyorsa kırpılmaz (yalnız
 * görünüm işlenir). Döner: taranmış görüntü, kullanılan köşeler, güven, yöntem, uygulanan eğiklik düzeltmesi.
 */
export function scanDocument(img: RgbaImage, opts: ScanOptions = {}): ScanResult {
  const t0 = now();
  const mode = opts.mode ?? "belge";
  const maxEdge = opts.maxEdge ?? 2000;
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
    if (d.corners && !d.fillsFrame) {
      corners = fromWork(d.corners).map((p) => ({
        x: Math.max(0, Math.min(img.width - 1, p.x)),
        y: Math.max(0, Math.min(img.height - 1, p.y)),
      })) as Quad;
      method = d.method ?? "yok";
    } else {
      corners = fullFrame(img.width, img.height);
      method = d.method ?? "yok";
      fillsFrame = true;
    }
  }
  const t1 = now();
  // köşeler görüntünün köşeleriyse açma birebir olsun (piksel merkezi 0 … W−1; kâğıdın kenarı −0,5 … W−0,5)
  const frame = fullFrame(img.width, img.height);
  const isFrame = corners.every((p, i) => Math.abs(p.x - frame[i].x) <= 0.75 && Math.abs(p.y - frame[i].y) <= 0.75);
  const warpCorners: Quad = isFrame
    ? [
        { x: -0.5, y: -0.5 },
        { x: img.width - 0.5, y: -0.5 },
        { x: img.width - 0.5, y: img.height - 0.5 },
        { x: -0.5, y: img.height - 0.5 },
      ]
    : corners;
  const size = isFrame ? fitSize(img.width, img.height, maxEdge) : estimateSize(corners, img.width, img.height, maxEdge);
  let correction: Affine | undefined;
  let rotation = 0;
  let fill: [number, number, number] | undefined;
  if (opts.deskew !== false) {
    const pv = fitSize(size.width, size.height, 800);
    const preview = warpQuad(work, toWork(warpCorners), pv.width, pv.height);
    const sk = estimateSkew(preview);
    if (sk.confidence >= 0.3 && Math.abs(sk.angle) >= 0.3) {
      rotation = -sk.angle;
      const cx = (size.width - 1) / 2;
      const cy = (size.height - 1) / 2;
      // dar uzun fiş (boy ≥ 2 × en): uzun kenarlar yerinde kalsın diye yamultma; ötekiler merkez etrafında dönüş
      correction = size.height >= 2 * size.width ? verticalShear(rotation, cx) : rotationAbout(rotation, cx, cy);
      fill = paperColor(preview);
      reasons.push(`egiklik-${sk.angle.toFixed(1)}`);
    }
  }
  const warped = warpQuad(img, warpCorners, size.width, size.height, { correction, fill });
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
    reasons,
    timings: { detect: t1 - t0, warp: t2 - t1, enhance: t3 - t2, total: t3 - t0 },
  };
}

/** Önizleme için küçük kopya (alan ortalamalı): ör. köşe sürükleme ekranı */
export function thumbnail(img: RgbaImage, maxEdge: number): RgbaImage {
  const sz = fitSize(img.width, img.height, maxEdge);
  return sz.width === img.width && sz.height === img.height ? img : resizeRgba(img, sz.width, sz.height);
}
