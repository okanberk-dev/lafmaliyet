/**
 * Kâğıt algılama (çok yöntemli, puanlı). Küçültülmüş kopyada (uzun kenar ~640 px) üç yöntem aday dörtgen üretir:
 *
 * a) Kâğıt bölütleme ("kagit"): kâğıtlık haritası (aydınlık − doygunluk; ayrıca büyük ölçekli ışık farkı çıkarılmış
 *    yerel hâli), Otsu eşikleri, morfolojik kapama / açma, bağlı bileşenler, dış hat (Moore izleme), dışbükey zarf,
 *    zarftan dörtgen (alan artışı en küçük kenar silinerek) ve dış hat noktalarına RANSAC ile kenar oturtma.
 * b) Kenar ("kenar"): Canny (eşikler görüntüden), gradyan yönlü Hough doğruları, iki yatayımsı + iki dikeyimsi
 *    doğrudan dörtgenler (perspektif payıyla); görüntünün kenarları da doğru sayılır (kareden taşan uzun fiş).
 * c) Yazıdan başlama ("yazi"; ilk ikisi zayıfsa): yoğun yazı bölgesi bulunur, çevresindeki dikdörtgen her yönde dışarı
 *    doğru en yakın kâğıt kenarına büyütülür (açık renk tezgâhta beyaz fiş).
 *
 * Adaylar tek puanla karşılaştırılır: her kenarın gradyan desteği ve içi / dışı parlaklık basamağı (işaret tutarlı),
 * alan oranı, açılar, kâğıtlık karşıtlığı, yazı kesiyor mu, içerisi kâğıda benziyor mu (koyu ya da çok renkli,
 * yazısız dikdörtgen: telefon, POS cihazı, kutu). Puanı düşük kalan en iyi adaylar kenarlara oturtulup yeniden
 * puanlanır. Emin değilse (zayıf kenar, birbirine yakın puanlı iki farklı aday, kâğıda benzemiyor) güven düşer. Kâğıt
 * kareyi dolduruyorsa `fillsFrame` ve kırpma önerilmez.
 */

import type { GrayImage, Point, Quad, RgbaImage } from "./image";
import {
  closeMask,
  dilateMask,
  erodeMask,
  fitSize,
  gaussianBlur,
  histogram,
  histPercentile,
  labelComponents,
  maxFilter,
  median,
  minFilter,
  otsuIndex,
  resizeGray,
  resizeRgba,
  scaleQuad,
  seededRandom,
  sobel,
  traceContour,
  unscaleQuad,
} from "./image";
import {
  convexHull,
  growQuad,
  fitLine,
  hullToQuad,
  insideConvex,
  interiorAngles,
  intersect,
  isConvex,
  lineThrough,
  minAreaRect,
  orderCorners,
  polygonArea,
  quadDistance,
  ransacLine,
  signedDist,
  simplifyClosed,
  type Line,
} from "./geom";
import { polishCorners, sideOnFrame, snapQuad, workGray } from "./refine";

export type DetectMethod = "kagit" | "kenar" | "yazi" | "tam-kare";

export interface DetectOptions {
  /** Algılama kopyasının uzun kenarı (px); varsayılan 640 */
  maxEdge?: number;
}

export interface Detection {
  /**
   * Sol üst, sağ üst, sağ alt, sol alt; asıl görüntünün pikselinde. Kâğıdın köşesi kareden çıkmışsa o köşe görüntünün
   * en çok `MAX_OUTSIDE` oranında dışında olabilir (neden: "kose-kare-disinda"). Bulunamazsa null.
   */
  corners: Quad | null;
  /** 0–1 */
  confidence: number;
  method: DetectMethod | null;
  /** Kâğıt kareyi dolduruyor: köşeler görüntünün köşeleri, kırpma önerilmez */
  fillsFrame: boolean;
  /** Kısa nedenler (tanı için): ör. "kenar-zayif", "iki-aday", "kareyi-dolduruyor" */
  reasons: string[];
}

interface Ctx {
  w: number;
  h: number;
  n: number;
  diag: number;
  rgba: Uint8ClampedArray;
  lum: Float32Array;
  chroma: Float32Array;
  /** σ=1 bulanık gri */
  gray: GrayImage;
  /** kâğıtlık (σ=1,5 bulanık) */
  paper: Float32Array;
  gx: Float32Array;
  gy: Float32Array;
  /** kenar desteği eşiği (gradyan) */
  gradThr: number;
  /** parlaklık basamağı eşiği */
  stepThr: number;
  /** ince koyu çizgiler (yazı) */
  text: Uint8Array;
  textTotal: number;
  /** yazı piksellerinden seyrek örnek (en çok ~3000; dörtgenin içindeki yazı oranı için) */
  textPts: Point[];
  /** görüntünün aydınlık düzeyi (parlaklığın %95'liği): kâğıt genelde en aydınlık şeydir */
  lumHigh: number;
}

interface SideStat {
  frame: boolean;
  quality: number;
  /** içerisi aydınlık mı (basamağın işareti) */
  brightInside: boolean;
}

interface Scored {
  q: Quad;
  how: DetectMethod;
  score: number;
  sides: SideStat[];
  realSides: number;
  minSide: number;
  area: number;
  /** kâğıda benzemezlik (0–1) */
  notPaper: number;
  /** puanın bileşenleri (tanı için) */
  parts?: Record<string, number>;
}

const DEFAULT_EDGE = 640;
/**
 * Köşe kareden en çok bu oranda (genişliğin / yüksekliğin) taşabilir: kâğıdın köşesi kareden çıkmış ama iki kenarı da
 * görünüyorsa köşe kenarların kesişimidir (kareye kenetlenen köşe açılan görüntüyü yamultur). Daha çok taşan kâğıtta
 * o taraf kareye dayanan kenar sayılır.
 */
export const MAX_OUTSIDE = 0.08;
/** son ince ayarın çözünürlüğü (uzun kenar) */
const REFINE_EDGE = 1000;
const STEP_OFFSETS = [2, 4, 6, 8, 10, 12, 14];
const bufIn = new Float32Array(STEP_OFFSETS.length);
const bufOut = new Float32Array(STEP_OFFSETS.length);

/** İlk `n` öğenin ortancası (küçük dizi, yerinde sıralar) */
function median7(a: Float32Array, n: number): number {
  for (let i = 1; i < n; i++) {
    const v = a[i];
    let j = i - 1;
    while (j >= 0 && a[j] > v) {
      a[j + 1] = a[j];
      j--;
    }
    a[j + 1] = v;
  }
  return n % 2 ? a[n >> 1] : (a[(n >> 1) - 1] + a[n >> 1]) / 2;
}

// ---------------------------------------------------------------- hazırlık

function buildCtx(img: RgbaImage, maxEdge: number): Ctx {
  const sz = fitSize(img.width, img.height, maxEdge);
  const small = sz.width === img.width && sz.height === img.height ? img : resizeRgba(img, sz.width, sz.height);
  const { width: w, height: h, data } = small;
  const n = w * h;
  const lum = new Float32Array(n);
  const chroma = new Float32Array(n);
  const paperRaw = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
    const mn = r < g ? (r < b ? r : b) : g < b ? g : b;
    lum[i] = L;
    chroma[i] = mx - mn;
    paperRaw[i] = L - 0.8 * (mx - mn);
  }
  const gray = gaussianBlur({ width: w, height: h, data: lum }, 1);
  const paper = gaussianBlur({ width: w, height: h, data: paperRaw }, 1.5).data;
  const { gx, gy } = sobel(gray);
  // gürültü: gradyan büyüklüğünün ortancası (düz alanlar çoğunlukta)
  const mags = new Float32Array(n);
  for (let i = 0; i < n; i++) mags[i] = Math.hypot(gx[i], gy[i]);
  const medMag = histPercentile(histogram(mags, 400, 0, 100, 2), 0.5, 0, 100);
  const gradThr = Math.max(2.5, 3 * medMag);
  const stepThr = Math.max(5, 6 * medMag);
  // yazı: ince koyu çizgiler (kapama − görüntü; geniş koyu zemin ve düz kâğıt kenarı vermez)
  const closed = minFilter(maxFilter(gray, 3), 3);
  const text = new Uint8Array(n);
  let textTotal = 0;
  const tThr = Math.max(12, 4 * medMag);
  for (let i = 0; i < n; i++) {
    const c = closed.data[i];
    if (c > 90 && c - gray.data[i] > Math.max(tThr, 0.1 * c)) {
      text[i] = 1;
      textTotal++;
    }
  }
  const textPts: Point[] = [];
  const every = Math.max(1, Math.floor(textTotal / 3000));
  for (let i = 0, k = 0; i < n; i++) {
    if (!text[i]) continue;
    if (k++ % every === 0) textPts.push({ x: i % w, y: Math.floor(i / w) });
  }
  const lumHigh = Math.max(40, histPercentile(histogram(lum, 256, 0, 256, 3), 0.95));
  return { w, h, n, diag: Math.hypot(w, h), rgba: data, lum, chroma, gray, paper, gx, gy, gradThr, stepThr, text, textTotal, textPts, lumHigh };
}

// ---------------------------------------------------------------- puan

function nearest(a: Float32Array, w: number, h: number, x: number, y: number): number {
  let xi = Math.round(x);
  let yi = Math.round(y);
  if (xi < 0) xi = 0;
  else if (xi >= w) xi = w - 1;
  if (yi < 0) yi = 0;
  else if (yi >= h) yi = h - 1;
  return a[yi * w + xi];
}

function sideStats(ctx: Ctx, a: Point, b: Point, cx: number, cy: number): SideStat {
  const { w, h } = ctx;
  const frameTol = Math.max(2, Math.min(w, h) * 0.012);
  if (sideOnFrame(a, b, w, h, frameTol)) return { frame: true, quality: 0, brightInside: true };
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  const dx = (b.x - a.x) / L;
  const dy = (b.y - a.y) / L;
  let nx = dy;
  let ny = -dx;
  if (((a.x + b.x) / 2 - cx) * nx + ((a.y + b.y) / 2 - cy) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const m = Math.max(12, Math.min(48, Math.round(L / 4)));
  let pos = 0;
  let neg = 0;
  let sPos = 0;
  let sNeg = 0;
  let valid = 0;
  let textIn = 0;
  const g = ctx.gray.data;
  for (let k = 0; k < m; k++) {
    const t = 0.06 + (0.88 * k) / (m - 1);
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    const ox = px + nx * 7;
    const oy = py + ny * 7;
    if (ox < 0 || oy < 0 || ox > w - 1 || oy > h - 1) continue;
    const ix = px - nx * 7;
    const iy = py - ny * 7;
    if (ix < 0 || iy < 0 || ix > w - 1 || iy > h - 1) continue;
    valid++;
    let gp = 0;
    let gm = 0;
    for (let o = -2; o <= 2; o++) {
      const sx = px + nx * o;
      const sy = py + ny * o;
      const proj = nearest(ctx.gx, w, h, sx, sy) * nx + nearest(ctx.gy, w, h, sx, sy) * ny;
      if (-proj > gp) gp = -proj;
      if (proj > gm) gm = proj;
    }
    if (gp > ctx.gradThr) pos++;
    if (gm > ctx.gradThr) neg++;
    // geniş basamak: içeride ve dışarıda 2–14 px'lik şeritlerin ortancası (ince yazı çizgileri ortancayı değiştirmez:
    // yazı bloğunun kenarı basamak vermez; gerçek kâğıt kenarında dışarısı zemindir)
    let no = 0;
    let textHit = false;
    for (const o of STEP_OFFSETS) {
      const ox2 = px + nx * o;
      const oy2 = py + ny * o;
      if (ox2 < 0 || oy2 < 0 || ox2 > w - 1 || oy2 > h - 1) continue;
      const ix2 = px - nx * o;
      const iy2 = py - ny * o;
      bufIn[no] = nearest(g, w, h, ix2, iy2);
      bufOut[no] = nearest(g, w, h, ox2, oy2);
      if (ix2 >= 0 && iy2 >= 0 && ix2 <= w - 1 && iy2 <= h - 1 && ctx.text[Math.round(iy2) * w + Math.round(ix2)]) textHit = true;
      no++;
    }
    if (textHit) textIn++;
    const diff = median7(bufIn, no) - median7(bufOut, no);
    if (diff > ctx.stepThr) sPos++;
    else if (diff < -ctx.stepThr) sNeg++;
  }
  if (valid < m * 0.4) return { frame: true, quality: 0, brightInside: true };
  // işaret tutarlı destek: doku (iki işaret de sık) cezalanır
  const qPos = (pos - 0.5 * neg + sPos - 0.5 * sNeg) / (2 * valid);
  let qNeg = (neg - 0.5 * pos + sNeg - 0.5 * sPos) / (2 * valid);
  // içerisi koyu kenar (gri kâğıt, beyaz tezgâh) ancak içerisi düz ise: içi yazıyla doluysa yazı bloğunun kenarıdır
  qNeg *= 1 - Math.min(1, (textIn / valid) * 1.2);
  return { frame: false, quality: Math.max(0, Math.max(qPos, qNeg)), brightInside: qPos >= qNeg };
}

/**
 * Dörtgenin içinden ve hemen dışından örnek: kâğıtlık ortalamaları (içerisi kâğıda daha çok benziyorsa `inside`
 * büyük); içerinin parlaklık ve doygunluk ortancası (kâğıt kanıtı)
 */
function paperLevels(ctx: Ctx, q: Quad): { inside: number; outside: number | null; lum: number; chroma: number } {
  const { w, h } = ctx;
  let sin = 0;
  let nin = 0;
  const lums: number[] = [];
  const chromas: number[] = [];
  for (let i = 1; i < 8; i++) {
    for (let j = 1; j < 8; j++) {
      const u = i / 8;
      const v = j / 8;
      const x = (1 - u) * (1 - v) * q[0].x + u * (1 - v) * q[1].x + u * v * q[2].x + (1 - u) * v * q[3].x;
      const y = (1 - u) * (1 - v) * q[0].y + u * (1 - v) * q[1].y + u * v * q[2].y + (1 - u) * v * q[3].y;
      sin += nearest(ctx.paper, w, h, x, y);
      lums.push(nearest(ctx.lum, w, h, x, y));
      chromas.push(nearest(ctx.chroma, w, h, x, y));
      nin++;
    }
  }
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  let sout = 0;
  let nout = 0;
  const off = Math.max(4, ctx.diag * 0.015);
  for (let s = 0; s < 4; s++) {
    const a = q[s];
    const b = q[(s + 1) % 4];
    for (let k = 1; k < 10; k++) {
      const t = k / 10;
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      const vx = px - cx;
      const vy = py - cy;
      const L = Math.hypot(vx, vy) || 1;
      const x = px + (vx / L) * off;
      const y = py + (vy / L) * off;
      if (x < 0 || y < 0 || x > w - 1 || y > h - 1) continue;
      sout += nearest(ctx.paper, w, h, x, y);
      nout++;
    }
  }
  return { inside: sin / nin, outside: nout ? sout / nout : null, lum: median(lums), chroma: median(chromas) };
}

/**
 * Kâğıda benzemezlik (0–1): içerisi görüntünün aydınlığına göre koyu (telefon, POS cihazı, cüzdan) ya da çok renkli
 * (kutu, ambalaj). İçinde yazı varsa (renkli nüsha, etiket) ceza azalır.
 */
function notPaper(ctx: Ctx, lum: number, chroma: number, textIn: number | null): number {
  const rel = lum / ctx.lumHigh;
  const dark = Math.max(0, Math.min(1, (0.55 - rel) / 0.25));
  const colored = Math.max(0, Math.min(1, (chroma - 70) / 60));
  return Math.max(dark, colored) * (1 - 0.7 * Math.min(1, (textIn ?? 0) / 0.6));
}

/**
 * Kareye dayanan kenar gerçekten kâğıt mı: kâğıt o yönde kareden taşıyorsa karenin hemen içindeki şerit de kâğıttır.
 * Şerit zemine benziyorsa (örneklerin kâğıtlığı içeriden çok dışarıya yakın) dörtgen kâğıdı karenin kenarına kadar
 * boşuna uzatmıştır (dokulu zeminde iki gerçek kenar + iki kare kenarı, dört gerçek kenarlı adayı geçmesin). Döner:
 * zemine benzeyen örneklerin oranı (0–1).
 */
function frameSideBackground(ctx: Ctx, a: Point, b: Point, cx: number, cy: number, inside: number, outside: number): number {
  const { w, h } = ctx;
  const inset = Math.max(4, ctx.diag * 0.012);
  const mid = (inside + outside) / 2;
  let bg = 0;
  let tot = 0;
  for (let k = 0; k < 24; k++) {
    const t = 0.08 + (0.84 * k) / 23;
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    const vx = cx - px;
    const vy = cy - py;
    const L = Math.hypot(vx, vy) || 1;
    const v = nearest(ctx.paper, w, h, px + (vx / L) * inset, py + (vy / L) * inset);
    tot++;
    if (inside > outside ? v < mid : v > mid) bg++;
  }
  return bg / tot;
}

/** Kenarın hemen dışında yazı var mı (kenar yazıyı kesiyor): kenar boyunca örneklerin oranı */
function textOutside(ctx: Ctx, a: Point, b: Point, cx: number, cy: number): number {
  if (ctx.textTotal < ctx.n * 0.001) return 0;
  const { w, h } = ctx;
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  let nx = (b.y - a.y) / L;
  let ny = -(b.x - a.x) / L;
  if (((a.x + b.x) / 2 - cx) * nx + ((a.y + b.y) / 2 - cy) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const reach = Math.max(6, ctx.diag * 0.025);
  // kenar boyunca bir çizgi varsa ötesine daha uzun bakılır (aşağıda)
  const reach2 = Math.max(reach, ctx.diag * 0.06);
  const K = 24;
  // örnek başına dışarıdaki "yazı" piksellerinin uzaklıkları (kenardan dışa)
  const offs: number[][] = [];
  for (let k = 0; k < K; k++) {
    const t = 0.1 + (0.8 * k) / (K - 1);
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    const hits: number[] = [];
    let any = false;
    for (let o = 3; o <= reach2; o += 1.5) {
      const x = Math.round(px + nx * o);
      const y = Math.round(py + ny * o);
      if (x < 0 || y < 0 || x >= w || y >= h) break;
      any = true;
      if (ctx.text[y * w + x]) hits.push(o);
    }
    if (any) offs.push(hits);
  }
  if (!offs.length) return 0;
  // kenar boyunca hep aynı uzaklıkta duran ince koyu çizgi yazı değildir: kâğıdın gölgesi (açık zeminde kenarın hemen
  // dışında koyu şerit), tezgâhın ya da cihazın kenarı. Örneklerin çoğunda aynı ±2,5 px'te çıkan şerit sayılmaz.
  const firsts = offs.filter((hs) => hs.length).map((hs) => hs[0]);
  let band: [number, number] | null = null;
  if (firsts.length >= offs.length * 0.4) {
    let best = 0;
    for (const c of firsts) {
      const n = firsts.filter((f) => Math.abs(f - c) <= 2.5).length;
      if (n > best) {
        best = n;
        band = [c - 2.5, c + 2.5 + 3];
      }
    }
    if (best < offs.length * 0.4) band = null;
  }
  // Çizginin ötesinde yazı varsa (kâğıdın içindeki tablo ya da kesik çizgisi, ötesi yine yazılı kâğıt) kesiyor sayılır;
  // gölgenin ötesi zemindir, yazı çıkmaz
  let hit = 0;
  for (const hs of offs) {
    const near = hs.some((o) => o <= reach && (!band || o < band[0] || o > band[1]));
    const beyond = !!band && hs.some((o) => o > band![1] + 1.5);
    if (near || beyond) hit++;
  }
  return hit / offs.length;
}

/** Yazının yüzde kaçı dörtgenin içinde (yazı azsa null) */
function textInside(ctx: Ctx, q: Quad): number | null {
  if (ctx.textTotal < ctx.n * 0.002 || !ctx.textPts.length) return null;
  let inside = 0;
  for (const p of ctx.textPts) if (insideConvex(q, p)) inside++;
  return inside / ctx.textPts.length;
}

function evaluate(ctx: Ctx, q: Quad, how: DetectMethod): Scored | null {
  const { w, h } = ctx;
  const ow = MAX_OUTSIDE * w;
  const oh = MAX_OUTSIDE * h;
  for (const p of q) if (p.x < -ow || p.y < -oh || p.x > w - 1 + ow || p.y > h - 1 + oh) return null;
  if (!isConvex(q)) return null;
  const area = polygonArea(q) / ctx.n;
  if (area < 0.01 || area > 0.995) return null;
  const angles = interiorAngles(q);
  if (Math.min(...angles) < 35 || Math.max(...angles) > 145) return null;
  // çok ince şerit (en < kısa kenarın %3'ü) kâğıt değildir
  const e1 = Math.min(Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y), Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y));
  const e2 = Math.min(Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y), Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y));
  if (Math.min(e1, e2) < Math.min(w, h) * 0.03) return null;
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  const sides = [0, 1, 2, 3].map((i) => sideStats(ctx, q[i], q[(i + 1) % 4], cx, cy));
  const real = sides.filter((s) => !s.frame);
  if (real.length < 2) return null;
  const minSide = Math.min(...real.map((s) => s.quality));
  const meanSide = real.reduce((s, x) => s + x.quality, 0) / real.length;
  let cut = 0;
  for (let i = 0; i < 4; i++) if (!sides[i].frame) cut = Math.max(cut, textOutside(ctx, q[i], q[(i + 1) % 4], cx, cy));
  const tin = textInside(ctx, q);
  const areaTerm = Math.min(1, Math.sqrt(area / 0.3));
  const rect = 1 - Math.min(1, angles.reduce((s, a) => s + Math.abs(a - 90), 0) / 160);
  const lv = paperLevels(ctx, q);
  const pc = lv.outside === null ? 0.5 : Math.max(0, Math.min(1, (lv.inside - lv.outside) / 40));
  let score =
    0.45 * minSide + 0.25 * meanSide + 0.12 * areaTerm + 0.08 * rect + 0.05 * pc + 0.05 * (tin ?? 0.5) - 0.6 * Math.max(0, cut - 0.15);
  const np = notPaper(ctx, lv.lum, lv.chroma, tin);
  score -= 0.45 * np;
  // kareye dayanan aday yazının epey bir kısmını dışarıda bırakıyorsa kareyi dolduran sayfanın bir bölümüdür (tablo
  // çizgisi, sütun): yakın çekimde sayfanın içinden dörtgen seçilmesin
  if (real.length < 4 && tin !== null) score -= 0.4 * Math.max(0, 0.8 - tin);
  if (real.length === 2) score -= 0.06;
  else if (real.length === 3) score -= 0.02;
  // kareye dayanan kenarın içi zeminse kâğıt orada bitmiyordur
  if (real.length < 4 && lv.outside !== null && Math.abs(lv.inside - lv.outside) >= 12) {
    let bg = 0;
    for (let i = 0; i < 4; i++) {
      if (sides[i].frame) bg = Math.max(bg, frameSideBackground(ctx, q[i], q[(i + 1) % 4], cx, cy, lv.inside, lv.outside));
    }
    score -= 0.5 * Math.max(0, bg - 0.4);
  }
  return { q, how, score, sides, realSides: real.length, minSide, area, notPaper: np, parts: { minSide, meanSide, areaTerm, rect, pc, tin: tin ?? -1, cut } };
}

// ---------------------------------------------------------------- a) kâğıt bölütleme

/** Bileşenin dış hat noktalarına kenar oturtma: köşe yuvarlak ya da kıvrıksa da kenar düz kısmından geçer */
function fitSidesToContour(q: Quad, contour: Point[], diag: number): Quad {
  const rnd = seededRandom(3);
  const lines: Line[] = [];
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const base = lineThrough(a, b);
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const sel: Point[] = [];
    for (const p of contour) {
      const t = ((p.x - a.x) * base.d.x + (p.y - a.y) * base.d.y) / L;
      if (t < 0.1 || t > 0.9) continue;
      if (Math.abs(signedDist(base, p)) < Math.max(2, diag * 0.015)) sel.push(p);
    }
    const fit = sel.length >= 8 ? ransacLine(sel, 1.5, rnd, Math.round(sel.length * 0.4), 50) : null;
    lines.push(fit ? fit.line : base);
  }
  const out: Point[] = [];
  for (let i = 0; i < 4; i++) {
    const c = intersect(lines[(i + 3) % 4], lines[i]);
    if (!c || Math.hypot(c.x - q[i].x, c.y - q[i].y) > diag * 0.05) return q;
    out.push(c);
  }
  return orderCorners(out);
}

function maskCandidates(ctx: Ctx, mask: Uint8Array, out: Quad[]): void {
  const { w, h, n } = ctx;
  const r = Math.max(2, Math.round(Math.min(w, h) / 90));
  // kapama + açma = genişlet(r) → aşındır(2r) → genişlet(r) (iki aşındırma tek geçişte)
  const m = dilateMask(erodeMask(dilateMask(mask, w, h, r), w, h, 2 * r), w, h, r);
  const cc = labelComponents(m, w, h);
  const order: number[] = [];
  for (let l = 1; l <= cc.count; l++) if (cc.areas[l] >= n * 0.012) order.push(l);
  order.sort((a, b) => cc.areas[b] - cc.areas[a]);
  for (const l of order.slice(0, 3)) {
    // dış hattın başlangıcı: satır taramasında ilk piksel
    const y = cc.minY[l];
    let x = cc.minX[l];
    while (x <= cc.maxX[l] && cc.labels[y * w + x] !== l) x++;
    const contour = traceContour(cc.labels, w, h, l, x, y);
    if (contour.length < 16) continue;
    const hull = simplifyClosed(convexHull(contour), 1);
    const q = hullToQuad(hull);
    if (!q) continue;
    out.push(fitSidesToContour(q, contour, ctx.diag));
  }
}

function segmentCandidates(ctx: Ctx): Quad[] {
  const { w, h, n, paper } = ctx;
  const out: Quad[] = [];
  const hist = histogram(paper);
  const t = otsuIndex(hist);
  const tUp = otsuIndex(hist, t + 1, 256);
  const masks: Uint8Array[] = [];
  const mk = (src: Float32Array, thr: number) => {
    const m = new Uint8Array(n);
    for (let i = 0; i < n; i++) m[i] = src[i] > thr ? 1 : 0;
    return m;
  };
  masks.push(mk(paper, t + 0.5));
  if (tUp > t + 8) masks.push(mk(paper, tUp + 0.5));
  // yerel: büyük ölçekli ışık farkı (gölge, köşeye doğru kararma) çıkarılır
  const lw = Math.max(8, Math.round(w / 8));
  const lh = Math.max(8, Math.round(h / 8));
  const low = resizeGray(gaussianBlur(resizeGray({ width: w, height: h, data: paper }, lw, lh), Math.min(lw, lh) / 5), w, h).data;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += paper[i];
  mean /= n;
  const local = new Float32Array(n);
  for (let i = 0; i < n; i++) local[i] = paper[i] - low[i] + mean;
  const tl = otsuIndex(histogram(local));
  masks.push(mk(local, tl + 0.5));
  for (const m of masks) maskCandidates(ctx, m, out);
  return out;
}

// ---------------------------------------------------------------- b) kenar: Canny + Hough

interface HLine extends Line {
  votes: number;
  frame: boolean;
}

/** `factor`: yüksek eşiğin çarpanı (düşük karşıtlıklı kâğıt kenarı için ikinci geçişte < 1) */
function canny(ctx: Ctx, factor = 1): { xs: Int32Array; ys: Int32Array; ang: Float32Array; count: number } {
  const { w, h, n, gx, gy } = ctx;
  const mag = new Float32Array(n);
  for (let i = 0; i < n; i++) mag[i] = Math.hypot(gx[i], gy[i]);
  const nms = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      if (m < 1) continue;
      const ax = Math.abs(gx[i]);
      const ay = Math.abs(gy[i]);
      let a: number;
      let b: number;
      if (ay <= ax * 0.4142) {
        a = mag[i - 1];
        b = mag[i + 1];
      } else if (ax <= ay * 0.4142) {
        a = mag[i - w];
        b = mag[i + w];
      } else if (gx[i] * gy[i] > 0) {
        a = mag[i - w - 1];
        b = mag[i + w + 1];
      } else {
        a = mag[i - w + 1];
        b = mag[i + w - 1];
      }
      if (m >= a && m > b) nms[i] = m;
    }
  }
  const hist = histogram(nms.filter((v) => v > 0), 400, 0, 200);
  const high = Math.max(4, factor * Math.max(5, Math.min(40, histPercentile(hist, 0.8, 0, 200))));
  const low = high * 0.4;
  const edge = new Uint8Array(n);
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (nms[i] >= high && !edge[i]) {
      edge[i] = 1;
      stack.push(i);
      while (stack.length) {
        const j = stack.pop()!;
        const jx = j % w;
        const jy = (j - jx) / w;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = jx + dx;
            const yy = jy + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const k = yy * w + xx;
            if (!edge[k] && nms[k] >= low) {
              edge[k] = 1;
              stack.push(k);
            }
          }
        }
      }
    }
  }
  let count = 0;
  for (let i = 0; i < n; i++) count += edge[i];
  const xs = new Int32Array(count);
  const ys = new Int32Array(count);
  const ang = new Float32Array(count);
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (!edge[i]) continue;
    const x = i % w;
    xs[k] = x;
    ys[k] = (i - x) / w;
    let a = Math.atan2(gy[i], gx[i]);
    if (a < 0) a += Math.PI;
    if (a >= Math.PI) a -= Math.PI;
    ang[k] = a;
    k++;
  }
  return { xs, ys, ang, count };
}

function houghLines(ctx: Ctx, e: ReturnType<typeof canny>, maxLines = 28): HLine[] {
  const { w, h } = ctx;
  const NT = 180;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const R = Math.ceil(Math.hypot(w, h) / 2) + 2;
  const NR = 2 * R + 1;
  const cos = new Float32Array(NT);
  const sin = new Float32Array(NT);
  for (let k = 0; k < NT; k++) {
    cos[k] = Math.cos((k * Math.PI) / NT);
    sin[k] = Math.sin((k * Math.PI) / NT);
  }
  const acc = new Int32Array(NT * NR);
  for (let i = 0; i < e.count; i++) {
    const x = e.xs[i] - cx;
    const y = e.ys[i] - cy;
    const k0 = Math.round((e.ang[i] * NT) / Math.PI);
    for (let dk = -3; dk <= 3; dk++) {
      const k = (k0 + dk + NT) % NT;
      const r = Math.round(x * cos[k] + y * sin[k]) + R;
      acc[k * NR + r]++;
    }
  }
  const minVotes = Math.max(15, Math.round(Math.min(w, h) * 0.05));
  const peaks: { k: number; r: number; v: number }[] = [];
  for (let k = 0; k < NT; k++) {
    for (let r = 1; r < NR - 1; r++) {
      const v = acc[k * NR + r];
      if (v < minVotes) continue;
      let isMax = true;
      for (let dk = -2; dk <= 2 && isMax; dk++) {
        const kk = (k + dk + NT) % NT;
        for (let dr = -3; dr <= 3; dr++) {
          if (!dk && !dr) continue;
          const rr = r + dr;
          if (rr < 0 || rr >= NR) continue;
          const u = acc[kk * NR + rr];
          if (u > v || (u === v && (dk < 0 || (dk === 0 && dr < 0)))) {
            isMax = false;
            break;
          }
        }
      }
      if (isMax) peaks.push({ k, r, v });
    }
  }
  peaks.sort((a, b) => b.v - a.v);
  const lines: HLine[] = [];
  const tolAng = (12 * Math.PI) / 180;
  for (const pk of peaks.slice(0, 60)) {
    const th = (pk.k * Math.PI) / NT;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const rho = pk.r - R;
    // çizgiye yakın ve yönü uyan kenar pikselleriyle en küçük kareler
    const pts: Point[] = [];
    for (let i = 0; i < e.count; i++) {
      const x = e.xs[i] - cx;
      const y = e.ys[i] - cy;
      if (Math.abs(x * c + y * s - rho) > 1.5) continue;
      let da = Math.abs(e.ang[i] - th);
      if (da > Math.PI / 2) da = Math.PI - da;
      if (da > tolAng) continue;
      pts.push({ x: e.xs[i], y: e.ys[i] });
    }
    if (pts.length < minVotes * 0.6) continue;
    const f = fitLine(pts);
    if (!f) continue;
    // aynı doğru zaten varsa atla
    const dup = lines.some((l) => {
      const dd = Math.abs(l.d.x * f.d.y - l.d.y * f.d.x);
      return dd < Math.sin((2 * Math.PI) / 180) && Math.abs(signedDist(l, f.p)) < ctx.diag * 0.008;
    });
    if (dup) continue;
    lines.push({ ...f, votes: pts.length, frame: false });
    if (lines.length >= maxLines) break;
  }
  return lines;
}

function edgeCandidates(ctx: Ctx): Quad[] {
  const { w, h } = ctx;
  const e = canny(ctx);
  if (e.count < 50) return [];
  // Yazının güçlü kenarları eşiği yükseltir: açık zeminde soluk kâğıt kenarı ilk geçişte kaçar. Düşük eşikli ikinci
  // geçişin doğruları eklenir (yinelenenler atlanır)
  const lines = houghLines(ctx, e);
  const low = canny(ctx, 0.35);
  for (const l of houghLines(ctx, low, 16)) {
    if (lines.length >= 36) break;
    const dup = lines.some((m) => Math.abs(m.d.x * l.d.y - m.d.y * l.d.x) < Math.sin((2 * Math.PI) / 180) && Math.abs(signedDist(m, l.p)) < ctx.diag * 0.008);
    if (!dup) lines.push(l);
  }
  const frame: HLine[] = [
    { p: { x: 0, y: 0 }, d: { x: 1, y: 0 }, votes: 0, frame: true },
    { p: { x: 0, y: h - 1 }, d: { x: 1, y: 0 }, votes: 0, frame: true },
    { p: { x: 0, y: 0 }, d: { x: 0, y: 1 }, votes: 0, frame: true },
    { p: { x: w - 1, y: 0 }, d: { x: 0, y: 1 }, votes: 0, frame: true },
  ];
  const all = lines.concat(frame);
  const angOf = (l: Line) => {
    let a = Math.atan2(l.d.y, l.d.x);
    if (a < 0) a += Math.PI;
    if (a >= Math.PI) a -= Math.PI;
    return a;
  };
  const angs = all.map(angOf);
  const angDiff = (a: number, b: number) => {
    const d = Math.abs(a - b);
    return Math.min(d, Math.PI - d);
  };
  const minSep = Math.min(w, h) * 0.04;
  const pairs: { i: number; j: number; ang: number }[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (all[i].frame && all[j].frame && angDiff(angs[i], angs[j]) > 0.1) continue;
      if (angDiff(angs[i], angs[j]) > (30 * Math.PI) / 180) continue;
      // ayrım: j'nin görüntü ortasına en yakın noktasının i'ye uzaklığı
      const mid = { x: (w - 1) / 2, y: (h - 1) / 2 };
      const tj = (mid.x - all[j].p.x) * all[j].d.x + (mid.y - all[j].p.y) * all[j].d.y;
      const pj = { x: all[j].p.x + all[j].d.x * tj, y: all[j].p.y + all[j].d.y * tj };
      if (Math.abs(signedDist(all[i], pj)) < minSep) continue;
      pairs.push({ i, j, ang: angs[i] });
    }
  }
  const quick: { q: Quad; s: number; v: number }[] = [];
  const margin = 0.02;
  for (let a = 0; a < pairs.length; a++) {
    for (let b = a + 1; b < pairs.length; b++) {
      const A = pairs[a];
      const B = pairs[b];
      if (A.i === B.i || A.i === B.j || A.j === B.i || A.j === B.j) continue;
      if (angDiff(A.ang, B.ang) < (50 * Math.PI) / 180) continue;
      const nFrame = +all[A.i].frame + +all[A.j].frame + +all[B.i].frame + +all[B.j].frame;
      if (nFrame > 2) continue;
      const c1 = intersect(all[A.i], all[B.i]);
      const c2 = intersect(all[B.i], all[A.j]);
      const c3 = intersect(all[A.j], all[B.j]);
      const c4 = intersect(all[B.j], all[A.i]);
      if (!c1 || !c2 || !c3 || !c4) continue;
      let ok = true;
      for (const c of [c1, c2, c3, c4]) {
        if (c.x < -margin * w || c.y < -margin * h || c.x > (1 + margin) * w || c.y > (1 + margin) * h) ok = false;
      }
      if (!ok) continue;
      const q = orderCorners([c1, c2, c3, c4].map((c) => ({ x: Math.max(0, Math.min(w - 1, c.x)), y: Math.max(0, Math.min(h - 1, c.y)) })));
      if (!isConvex(q)) continue;
      const area = polygonArea(q) / ctx.n;
      if (area < 0.01 || area > 0.99) continue;
      const an = interiorAngles(q);
      if (Math.min(...an) < 35 || Math.max(...an) > 145) continue;
      // hızlı ön puan: kenar desteği (oy) toplamı
      const votes = all[A.i].votes + all[A.j].votes + all[B.i].votes + all[B.j].votes;
      quick.push({ q, s: votes / Math.sqrt(area), v: nFrame ? 0 : votes });
    }
  }
  quick.sort((x, y) => y.s - x.s);
  // pahalı puana yalnız en iyi ~40 aday; büyük alanlılar da kaçmasın diye alanla sıralı ilk 20 de
  const byArea = quick.slice().sort((x, y) => polygonArea(y.q) - polygonArea(x.q));
  // ve dört kenarı da gerçek doğru olanlardan oyu en çok 30 (orta büyüklükte kâğıt iki sıralamanın arasında kalmasın)
  const byVotes = quick.filter((x) => x.v > 0).sort((x, y) => y.v - x.v);
  const picked = new Set<{ q: Quad; s: number; v: number }>([...quick.slice(0, 40), ...byArea.slice(0, 20), ...byVotes.slice(0, 30)]);
  return [...picked].map((x) => x.q);
}

// ---------------------------------------------------------------- c) yazıdan başlama

function textCandidate(ctx: Ctx): Quad | null {
  const { w, h, n } = ctx;
  if (ctx.textTotal < n * 0.002) return null;
  const r = Math.max(3, Math.round(Math.min(w, h) * 0.03));
  const m = closeMask(ctx.text, w, h, r);
  const cc = labelComponents(m, w, h);
  if (!cc.count) return null;
  const count = new Int32Array(cc.count + 1);
  for (let i = 0; i < n; i++) if (ctx.text[i] && cc.labels[i]) count[cc.labels[i]]++;
  let best = 1;
  for (let l = 2; l <= cc.count; l++) if (count[l] > count[best]) best = l;
  if (count[best] < n * 0.001) return null;
  // bileşenin satır uçları → zarf → en küçük dikdörtgen
  const pts: Point[] = [];
  for (let y = cc.minY[best]; y <= cc.maxY[best]; y++) {
    let lo = -1;
    let hi = -1;
    for (let x = cc.minX[best]; x <= cc.maxX[best]; x++) {
      if (cc.labels[y * w + x] === best) {
        if (lo < 0) lo = x;
        hi = x;
      }
    }
    if (lo >= 0) pts.push({ x: lo, y }, { x: hi, y });
  }
  const rect = minAreaRect(convexHull(pts));
  if (!rect) return null;
  // biraz büyüt (kenar boşluğu) ve görüntüye sığdır
  const cx = (rect[0].x + rect[1].x + rect[2].x + rect[3].x) / 4;
  const cy = (rect[0].y + rect[1].y + rect[2].y + rect[3].y) / 4;
  const mrg = ctx.diag * 0.02;
  const seed = rect.map((p) => {
    const vx = p.x - cx;
    const vy = p.y - cy;
    const L = Math.hypot(vx, vy) || 1;
    return { x: Math.max(0, Math.min(w - 1, p.x + (vx / L) * mrg * Math.SQRT2)), y: Math.max(0, Math.min(h - 1, p.y + (vy / L) * mrg * Math.SQRT2)) };
  }) as Quad;
  const snapped = snapQuad(ctx.gray, orderCorners(seed), { passes: "iki", band: 0.03, outward: 0.3 });
  const frameTol = Math.max(2, Math.min(w, h) * 0.012);
  let need = 0;
  let got = 0;
  for (let i = 0; i < 4; i++) {
    if (sideOnFrame(snapped.q[i], snapped.q[(i + 1) % 4], w, h, frameTol)) continue;
    need++;
    if (snapped.sides[i]) got++;
  }
  if (need < 2 || got < need) return null;
  return snapped.q;
}

// ---------------------------------------------------------------- kareden taşan kâğıt

/**
 * Kısa kenarların kaçış noktası: uzun kenarların kaçış noktasına (kamera düzleminde) dik ve görünen kısa kenarın
 * doğrusu üzerinde. Odak uzaklığı telefon kamerasının tipiği (uzun kenarın 0,75'i), ana nokta görüntünün ortası.
 * Uzun kenarlar paralelse ya da nokta çok uzaksa null (o zaman görünen kısa kenara paralel alınır).
 */
function shortVanishing(a: Line, b: Line, opposite: Line, w: number, h: number): Point | null {
  const den = a.d.x * b.d.y - a.d.y * b.d.x;
  if (Math.abs(den) < 1e-4) return null;
  const vv = intersect(a, b);
  if (!vv) return null;
  const f = 0.75 * Math.max(w, h);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const a0 = (vv.x - cx) / f;
  const a1 = (vv.y - cy) / f;
  const a2 = 1;
  const p = opposite.p;
  const d = opposite.d;
  const k = (a0 * d.x + a1 * d.y) / f;
  if (Math.abs(k) < 1e-12) return null;
  const t = -((a0 * (p.x - cx)) / f + (a1 * (p.y - cy)) / f + a2) / k;
  const vh = { x: p.x + t * d.x, y: p.y + t * d.y };
  if (!Number.isFinite(vh.x) || !Number.isFinite(vh.y) || Math.hypot(vh.x - cx, vh.y - cy) > 200 * Math.max(w, h)) return null;
  return vh;
}

/**
 * Kareye dayanan kenar gerçek kâğıt kenarı değildir: görüntünün kenarı kâğıda göre eğik olabilir ve açılan görüntüde
 * satırları yamultur (kareden taşan uzun fiş). Böyle bir kenar karşısındaki gerçek kenara paralel (karşısı da kareye
 * dayanıyorsa uzun kenarlara dik) bir doğruyla değiştirilir; doğru, iki köşesi de görüntüde kalacak kadar dışarıda.
 */
export function squareFrameSides(q: Quad, w: number, h: number): Quad {
  const frameTol = Math.max(2, Math.min(w, h) * 0.012);
  const onFrame = [0, 1, 2, 3].map((i) => sideOnFrame(q[i], q[(i + 1) % 4], w, h, frameTol));
  if (!onFrame.some(Boolean) || onFrame.every(Boolean)) return q;
  const lines: Line[] = [0, 1, 2, 3].map((i) => lineThrough(q[i], q[(i + 1) % 4]));
  const inside = (p: Point | null) => !!p && p.x >= -0.5 && p.y >= -0.5 && p.x <= w - 0.5 && p.y <= h - 0.5;
  const out = lines.slice();
  for (let i = 0; i < 4; i++) {
    if (!onFrame[i]) continue;
    const prev = lines[(i + 3) % 4];
    const next = lines[(i + 1) % 4];
    if (onFrame[(i + 3) % 4] || onFrame[(i + 1) % 4]) continue; // komşu kenar da karede: köşe kesilmiş, dokunma
    let d: Point;
    if (!onFrame[(i + 2) % 4]) {
      d = lines[(i + 2) % 4].d;
      const vh = shortVanishing(prev, next, lines[(i + 2) % 4], w, h);
      if (vh) {
        // gerçek kısa kenar da aynı kaçış noktasından geçer: köşeden kaçış noktasına yön
        const mid = { x: (q[i].x + q[(i + 1) % 4].x) / 2, y: (q[i].y + q[(i + 1) % 4].y) / 2 };
        const L = Math.hypot(vh.x - mid.x, vh.y - mid.y);
        if (L > 1e-6) d = { x: (vh.x - mid.x) / L, y: (vh.y - mid.y) / L };
      }
    } else {
      // iki uç da karede: komşu (uzun) kenarların ortalama yönüne dik
      let ax = prev.d.x;
      let ay = prev.d.y;
      if (ax * next.d.x + ay * next.d.y < 0) {
        ax = -ax;
        ay = -ay;
      }
      const mx = ax + next.d.x;
      const my = ay + next.d.y;
      const L = Math.hypot(mx, my) || 1;
      d = { x: -my / L, y: mx / L };
    }
    // iki aday: eski köşelerden birinden geçen paralel; ikisi de görüntüde kalan, daha dışarıdaki seçilir
    const c0 = q[i];
    const c1 = q[(i + 1) % 4];
    let pick: Line | null = null;
    let bestOut = -Infinity;
    const ctr = { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 };
    for (const p of [c0, c1]) {
      const cand: Line = { p, d };
      const a = intersect(prev, cand);
      const b = intersect(cand, next);
      if (!inside(a) || !inside(b)) continue;
      const outward = Math.abs(signedDist(cand, ctr));
      if (outward > bestOut) {
        bestOut = outward;
        pick = cand;
      }
    }
    if (pick) out[i] = pick;
  }
  const corners: Point[] = [];
  for (let i = 0; i < 4; i++) {
    const c = intersect(out[(i + 3) % 4], out[i]);
    if (!c) return q;
    corners.push(c);
  }
  const r = orderCorners(corners);
  return isConvex(r) ? r : q;
}

// ---------------------------------------------------------------- akış

/** Köşeleri görüntünün en çok `out` oranında dışına kenetler */
export function clampQuad(q: Quad, w: number, h: number, out = 0): Quad {
  const ox = out * w;
  const oy = out * h;
  return q.map((p) => ({ x: Math.max(-ox, Math.min(w - 1 + ox, p.x)), y: Math.max(-oy, Math.min(h - 1 + oy, p.y)) })) as Quad;
}

function frameQuad(w: number, h: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: w - 1, y: 0 },
    { x: w - 1, y: h - 1 },
    { x: 0, y: h - 1 },
  ];
}

/** Görüntünün geneli kâğıda benziyor mu (kâğıt kareyi dolduruyor, kenarı görünmüyor) */
function looksLikePaper(ctx: Ctx): boolean {
  const L = histPercentile(histogram(ctx.lum, 256, 0, 256, 3), 0.5);
  const C = histPercentile(histogram(ctx.chroma, 256, 0, 256, 3), 0.5);
  return L > 140 && C < 35 && ctx.textTotal > ctx.n * 0.004;
}

function confidenceOf(s: Scored): number {
  return Math.max(0, Math.min(1, (s.score - 0.35) / 0.4));
}

/**
 * En iyi birkaç farklı aday (geniş + dar şeritle) kenarlara oturtulur; puanı artan aday listeye eklenir. Düşük
 * karşıtlıkta (açık tezgâhta beyaz fiş) bölütleme ve yazıdan büyütme kâğıdı kaba bulur; asıl kenarlar oradan
 * birkaç on piksel uzaktadır. Liste puana göre yeniden sıralanır.
 */
function refineTop(ctx: Ctx, scored: Scored[], k = 4): void {
  const tried: Quad[] = [];
  const better: Scored[] = [];
  for (const s of scored) {
    if (tried.length >= k) break;
    if (tried.some((q) => quadDistance(q, s.q) < ctx.diag * 0.01)) continue;
    tried.push(s.q);
    const sn = snapQuad(ctx.gray, s.q, { passes: "iki" });
    if (!sn.sides.some(Boolean)) continue;
    const re = evaluate(ctx, sn.q, s.how);
    if (re && re.score > s.score + 0.01) better.push(re);
  }
  if (!better.length) return;
  scored.push(...better);
  scored.sort((a, b) => b.score - a.score);
}

/**
 * Fotoğraftaki belgeyi bulur. Köşeler asıl görüntünün pikselinde döner. Kâğıt kareyi dolduruyorsa köşeler görüntünün
 * köşeleridir ve `fillsFrame` doğrudur; bulunamazsa köşeler null, güven 0.
 */
export function detectDocument(img: RgbaImage, opts: DetectOptions = {}): Detection {
  const ctx = buildCtx(img, opts.maxEdge ?? DEFAULT_EDGE);
  const { w, h } = ctx;
  const reasons: string[] = [];
  const scored: Scored[] = [];
  const add = (q: Quad, how: DetectMethod) => {
    const s = evaluate(ctx, q, how);
    if (s) scored.push(s);
  };
  for (const q of segmentCandidates(ctx)) add(q, "kagit");
  for (const q of edgeCandidates(ctx)) add(q, "kenar");
  scored.sort((a, b) => b.score - a.score);
  if (!scored.length || scored[0].score < 0.62) {
    const tq = textCandidate(ctx);
    if (tq) {
      add(tq, "yazi");
      scored.sort((a, b) => b.score - a.score);
    }
  }
  if (!scored.length || scored[0].score < 0.75) refineTop(ctx, scored);
  let best = scored[0];
  // Seçilen dörtgen kâğıdın yalnız bir bölümüyse (başlık, kesik çizgiyle ayrılan blok; kenarı gölgeli fişte) onu içeren,
  // yazının çok daha fazlasını kapsayan dört kenarlı aday biraz düşük puanlı da olsa yeğlenir
  if (best) {
    const tinOf = (s: Scored) => s.parts?.tin ?? -1;
    const grown = (s: Scored) => growQuad(s.q, 1.02);
    const whole = scored.slice(0, 20).find((s) => s !== best && s.realSides === 4 && s.score >= best.score - 0.16 && tinOf(best) >= 0 && tinOf(s) - tinOf(best) >= 0.12 && tinOf(s) >= 1.6 * tinOf(best) && best.q.every((p) => insideConvex(grown(s), p)));
    if (whole) {
      best = whole;
      reasons.push("butunu-secildi");
    }
  }
  if (best) {
    // ince ayar (dar şerit): köşeler gerçek kenara oturur; puan düşmüyorsa kabul
    const snapped = snapQuad(ctx.gray, best.q, { passes: "ince" });
    const re = evaluate(ctx, snapped.q, best.how);
    if (re && re.score >= best.score - 0.02) best = re;
  }
  if (!best || best.minSide < 0.3 || confidenceOf(best) < 0.25) {
    if (looksLikePaper(ctx)) {
      reasons.push("kenar-yok", "kareyi-dolduruyor");
      return { corners: frameQuad(img.width, img.height), confidence: 0.45, method: "tam-kare", fillsFrame: true, reasons };
    }
    reasons.push(best ? "kenar-zayif" : "aday-yok");
    return { corners: null, confidence: best ? Math.min(0.2, confidenceOf(best)) : 0, method: null, fillsFrame: false, reasons };
  }
  let confidence = confidenceOf(best);
  // birbirinden farklı iki aday yakın puanlıysa emin değiliz
  const rival = scored.find((s) => s !== best && quadDistance(s.q, best.q) > ctx.diag * 0.04);
  if (rival && rival.score > best.score - 0.04) {
    confidence *= 0.75;
    reasons.push("iki-aday");
  }
  if (best.notPaper >= 0.5) {
    confidence = Math.min(confidence, 0.3);
    reasons.push("kagida-benzemiyor");
  }
  if (best.realSides < 4) reasons.push(`kareye-dayaniyor-${4 - best.realSides}`);
  if (best.minSide < 0.5) reasons.push("kenar-zayif");
  // kâğıt kareyi dolduruyor: köşelerden en az üçü kenarda ve alan büyük
  const near = best.q.filter((p) => p.x < w * 0.03 || p.y < h * 0.03 || p.x > w * 0.97 || p.y > h * 0.97).length;
  if (best.area > 0.8 && near >= 3) {
    reasons.push("kareyi-dolduruyor");
    return { corners: frameQuad(img.width, img.height), confidence, method: "tam-kare", fillsFrame: true, reasons };
  }
  let corners = unscaleQuad(squareFrameSides(best.q, w, h), img.width, img.height, w, h);
  // son ince ayar daha yüksek çözünürlükte (en çok 1000 px): köşe ~1 px'e oturur; kareye dayanan kenar sabit
  const fixed = best.sides.map((s, i) => (s.frame ? i : -1)).filter((i) => i >= 0);
  const g = workGray(img, REFINE_EDGE);
  if (g.width > w) {
    const fine = snapQuad(g, scaleQuad(corners, img.width, img.height, g.width, g.height), { passes: "ince", fixed });
    const fq = unscaleQuad(fine.q, img.width, img.height, g.width, g.height);
    const diagOrig = Math.hypot(img.width, img.height);
    if (quadDistance(fq, corners) < diagOrig * 0.012) corners = fq;
    // kıvrık kenarda köşe: komşu kenarların köşeye yakın parçasının teğetleri (köşe başına en çok %3)
    const pol = polishCorners(g, scaleQuad(corners, img.width, img.height, g.width, g.height), { fixed });
    if (pol.moved) {
      corners = unscaleQuad(pol.q, img.width, img.height, g.width, g.height);
      reasons.push(`kose-ince-${pol.moved}`);
    }
  }
  corners = clampQuad(corners, img.width, img.height, MAX_OUTSIDE);
  if (corners.some((p) => p.x < -0.5 || p.y < -0.5 || p.x > img.width - 0.5 || p.y > img.height - 0.5)) reasons.push("kose-kare-disinda");
  return { corners, confidence: Math.round(confidence * 1000) / 1000, method: best.how, fillsFrame: false, reasons };
}

/** Tanı için: algılama kopyasındaki bütün adaylar puanlarıyla (betik ve testler) */
export function detectCandidates(img: RgbaImage, opts: DetectOptions = {}): { how: DetectMethod; score: number; corners: Quad }[] {
  const ctx = buildCtx(img, opts.maxEdge ?? DEFAULT_EDGE);
  const out: { how: DetectMethod; score: number; corners: Quad }[] = [];
  const push = (q: Quad, how: DetectMethod) => {
    const s = evaluate(ctx, q, how);
    if (s) out.push({ how, score: s.score, corners: unscaleQuad(q, img.width, img.height, ctx.w, ctx.h) });
  };
  for (const q of segmentCandidates(ctx)) push(q, "kagit");
  for (const q of edgeCandidates(ctx)) push(q, "kenar");
  const tq = textCandidate(ctx);
  if (tq) push(tq, "yazi");
  return out.sort((a, b) => b.score - a.score);
}

/** Tanı için: verilen dörtgenin (asıl pikselde) algılama puanı ve bileşenleri (betik ve testler) */
export function scoreQuad(
  img: RgbaImage,
  q: Quad,
  opts: DetectOptions = {},
): { score: number; sides: number[]; realSides: number; minSide: number; area: number; notPaper: number; parts?: Record<string, number> } | null {
  const ctx = buildCtx(img, opts.maxEdge ?? DEFAULT_EDGE);
  const s = evaluate(ctx, scaleQuad(q, img.width, img.height, ctx.w, ctx.h), "kagit");
  if (!s) return null;
  return {
    score: s.score,
    sides: s.sides.map((x) => (x.frame ? -1 : Math.round(x.quality * 1000) / 1000)),
    realSides: s.realSides,
    minSide: s.minSide,
    area: s.area,
    notPaper: s.notPaper,
    parts: s.parts,
  };
}

