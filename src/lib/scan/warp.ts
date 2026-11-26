/**
 * Perspektif düzeltme: dört noktadan homografi (DLT, normalize edilmiş, kısmi pivotlu Gauss eliminasyonu), çıktı
 * boyutunun tahmini (karşılıklı kenarlar; mümkünse perspektiften gerçek en/boy oranı: Zhang ve He'nin beyaz tahta
 * yöntemi), ters eşlemeli çift doğrusal örnekleme. Küçültürken kaynak önce alan ortalamasıyla küçültülür (örtüşme
 * olmaz). Saf; testleri tests/tarama-donusum.test.ts.
 */

import type { Point, Quad, RgbaImage } from "./image";
import { createRgba, resizeRgba } from "./image";
import { dist } from "./geom";

/** 3 × 3 matris, satır sıralı */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Kısmi pivotlu Gauss eliminasyonu; tekil sistemde hata */
export function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) throw new Error("Tekil sistem (köşeler bir doğru üzerinde)");
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const o = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o as Mat3;
}

export function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) throw new Error("Tersi olmayan matris");
  const k = 1 / det;
  return [
    A * k,
    -(b * i - c * h) * k,
    (b * f - c * e) * k,
    B * k,
    (a * i - c * g) * k,
    -(a * f - c * d) * k,
    C * k,
    -(a * h - b * g) * k,
    (a * e - b * d) * k,
  ];
}

export function applyHomography(H: Mat3, p: Point): Point {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

/** Sayısal kararlılık için: ağırlık merkezi başlangıca, ortalama uzaklık √2'ye */
function normalizer(pts: readonly Point[]): Mat3 {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const md = pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length || 1;
  const s = Math.SQRT2 / md;
  return [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
}

/** Dört nokta eşinden homografi: src[i] → dst[i] */
export function homography(src: readonly Point[], dst: readonly Point[]): Mat3 {
  if (src.length !== 4 || dst.length !== 4) throw new Error("Dört nokta eşi gerekli");
  const Ts = normalizer(src);
  const Td = normalizer(dst);
  const s = src.map((p) => applyHomography(Ts, p));
  const d = dst.map((p) => applyHomography(Td, p));
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = s[i];
    const { x: X, y: Y } = d[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    b.push(Y);
  }
  const h = solveLinear(A, b);
  const Hn: Mat3 = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  const H = mul3(invert3(Td), mul3(Hn, Ts));
  const k = H[8];
  return H.map((v) => v / k) as Mat3;
}

/**
 * Perspektiften gerçek en/boy oranı (en / boy; Zhang ve He, 2007): odak uzaklığı dörtgenden kestirilir, ana nokta
 * görüntünün ortası. Dörtgen neredeyse afinse (perspektif yok) ya da kestirim anlamsızsa null.
 */
export function aspectFromPerspective(q: Quad, imgW: number, imgH: number): { aspect: number; focal: number } | null {
  const u0 = imgW / 2;
  const v0 = imgH / 2;
  const [tl, tr, br, bl] = q;
  const m1 = [tl.x, tl.y, 1];
  const m2 = [tr.x, tr.y, 1];
  const m3 = [bl.x, bl.y, 1];
  const m4 = [br.x, br.y, 1];
  const cr = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const d2 = dot(cr(m2, m4), m3);
  const d3 = dot(cr(m3, m4), m2);
  if (Math.abs(d2) < 1e-9 || Math.abs(d3) < 1e-9) return null;
  const k2 = dot(cr(m1, m4), m3) / d2;
  const k3 = dot(cr(m1, m4), m2) / d3;
  const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]];
  const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];
  const long = Math.max(imgW, imgH);
  // afin: n23 ya da n33 sıfıra yakın; odak kestirilemez
  if (Math.abs(n2[2]) < 1e-3 || Math.abs(n3[2]) < 1e-3) return null;
  const f2 =
    -(
      n2[0] * n3[0] -
      (n2[0] * n3[2] + n2[2] * n3[0]) * u0 +
      n2[2] * n3[2] * u0 * u0 +
      (n2[1] * n3[1] - (n2[1] * n3[2] + n2[2] * n3[1]) * v0 + n2[2] * n3[2] * v0 * v0)
    ) /
    (n2[2] * n3[2]);
  if (!(f2 > 0)) return null;
  const f = Math.sqrt(f2);
  // telefon kamerasında odak uzunluğu uzun kenarın ~0,6–1,5 katı; çok dışı kestirimin kararsız olduğunu gösterir
  if (f < 0.35 * long || f > 4 * long) return null;
  const norm = (n: number[]) => {
    const a = (n[0] - u0 * n[2]) / f;
    const b = (n[1] - v0 * n[2]) / f;
    return a * a + b * b + n[2] * n[2];
  };
  const aspect = Math.sqrt(norm(n2) / norm(n3));
  if (!Number.isFinite(aspect) || aspect <= 0) return null;
  return { aspect, focal: f };
}

export interface OutputSize {
  width: number;
  height: number;
  /** en / boy */
  aspect: number;
  /** oran nereden: perspektif kestirimi ya da karşılıklı kenarların uzunluğu */
  aspectSource: "perspektif" | "kenar";
}

/**
 * Çıktı boyutu: karşılıklı kenarların uzunluğundan; perspektif kestirimi kenar oranından çok sapmıyorsa (×0,6–1,67)
 * oran ondan alınır. Uzun boyut ölçülen uzunluk kadardır (büyütülmez), sonra `maxEdge`'e sığdırılır.
 */
export function estimateSize(q: Quad, imgW: number, imgH: number, maxEdge = 2000): OutputSize {
  const [tl, tr, br, bl] = q;
  const w = Math.max(dist(tl, tr), dist(bl, br));
  const h = Math.max(dist(tl, bl), dist(tr, br));
  const sideAspect = w / Math.max(1e-6, h);
  let aspect = sideAspect;
  let source: OutputSize["aspectSource"] = "kenar";
  const p = aspectFromPerspective(q, imgW, imgH);
  if (p && p.aspect / sideAspect > 0.6 && p.aspect / sideAspect < 1.67) {
    aspect = p.aspect;
    source = "perspektif";
  }
  let width: number;
  let height: number;
  if (w >= h) {
    width = w;
    height = w / aspect;
  } else {
    height = h;
    width = h * aspect;
  }
  const k = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(8, Math.round(width * k)),
    height: Math.max(8, Math.round(height * k)),
    aspect,
    aspectSource: source,
  };
}

/** Çıktı düzleminde küçük düzeltme (eğiklik): çıktı pikseli → düzeltilmemiş çıktı koordinatı, 2 × 3 afin */
export type Affine = [number, number, number, number, number, number];

/** Merkez etrafında dönüş: içerik saat yönünde `deg` derece döner (y aşağı) */
export function rotationAbout(deg: number, cx: number, cy: number): Affine {
  // çıktı (x, y) → kaynak (u, v) = merkez + R(-deg) (x - merkez)
  const a = (-deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, -s, cx - c * cx + s * cy, s, c, cy - s * cx - c * cy];
}

/** Dikey yamultma: x yerinde kalır, satırlar `deg` kadar düzelir (dar uzun fişte uzun kenarlar kaymaz) */
export function verticalShear(deg: number, cx: number): Affine {
  const t = Math.tan((-deg * Math.PI) / 180);
  // içerik saat yönünde deg dönsün: kaynak v = y - (x - cx) * tan(deg)
  return [1, 0, 0, t, 1, -t * cx];
}

export interface WarpOptions {
  /** Çıktı düzleminde eğiklik düzeltmesi (çıktı pikseli → düzeltilmemiş çıktı) */
  correction?: Affine;
  /**
   * Görüntünün dışına düşen yerin rengi: düzeltmeden sonra kâğıdın dışı ve kareden taşan köşenin çevresi (verilmezse
   * kenar pikseli uzatılır)
   */
  fill?: [number, number, number];
}

/** Kaynağın çıktı pikseli başına en küçük küçültme oranı (köşelerde ve ortada ölçülür) */
function minCompression(H: Mat3, width: number, height: number): number {
  let m = Infinity;
  const pts = [
    [0, 0],
    [width - 1, 0],
    [width - 1, height - 1],
    [0, height - 1],
    [(width - 1) / 2, (height - 1) / 2],
  ];
  for (const [u, v] of pts) {
    const p = applyHomography(H, { x: u, y: v });
    const px = applyHomography(H, { x: u + 1, y: v });
    const py = applyHomography(H, { x: u, y: v + 1 });
    m = Math.min(m, dist(p, px), dist(p, py));
  }
  return m;
}

/**
 * Dörtgeni `width × height` dikdörtgene açar (ters eşleme, çift doğrusal). Köşeler kâğıdın köşeleridir: çıktının
 * piksel kenarlarına (−0,5 ve boyut − 0,5) oturur. Kaynak çıktıdan belirgin büyükse önce alan ortalamasıyla küçültülür.
 */
export function warpQuad(img: RgbaImage, corners: Quad, width: number, height: number, opts: WarpOptions = {}): RgbaImage {
  const rect: Point[] = [
    { x: -0.5, y: -0.5 },
    { x: width - 0.5, y: -0.5 },
    { x: width - 0.5, y: height - 0.5 },
    { x: -0.5, y: height - 0.5 },
  ];
  let src = img;
  let q: Quad = corners;
  let H = homography(rect, q);
  const comp = minCompression(H, width, height);
  if (comp > 1.3) {
    const sw = Math.max(1, Math.round(img.width / comp));
    const sh = Math.max(1, Math.round(img.height / comp));
    src = resizeRgba(img, sw, sh);
    q = corners.map((p) => ({ x: ((p.x + 0.5) * sw) / img.width - 0.5, y: ((p.y + 0.5) * sh) / img.height - 0.5 })) as Quad;
    H = homography(rect, q);
  }
  const out = createRgba(width, height);
  const o = out.data;
  const s = src.data;
  const SW = src.width;
  const SH = src.height;
  const C = opts.correction;
  const fill = opts.fill;
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = H;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const oi = (y * width + x) * 4;
      let u = x;
      let v = y;
      if (C) {
        u = C[0] * x + C[1] * y + C[2];
        v = C[3] * x + C[4] * y + C[5];
        if (fill && (u < -0.5 || v < -0.5 || u > width - 0.5 || v > height - 0.5)) {
          o[oi] = fill[0];
          o[oi + 1] = fill[1];
          o[oi + 2] = fill[2];
          o[oi + 3] = 255;
          continue;
        }
      }
      const wd = h6 * u + h7 * v + h8;
      let sx = (h0 * u + h1 * v + h2) / wd;
      let sy = (h3 * u + h4 * v + h5) / wd;
      if (fill && (sx < -0.5 || sy < -0.5 || sx > SW - 0.5 || sy > SH - 0.5)) {
        o[oi] = fill[0];
        o[oi + 1] = fill[1];
        o[oi + 2] = fill[2];
        o[oi + 3] = 255;
        continue;
      }
      if (sx < 0) sx = 0;
      else if (sx > SW - 1) sx = SW - 1;
      if (sy < 0) sy = 0;
      else if (sy > SH - 1) sy = SH - 1;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = x0 + 1 < SW ? x0 + 1 : x0;
      const y1 = y0 + 1 < SH ? y0 + 1 : y0;
      const fx = sx - x0;
      const fy = sy - y0;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const i00 = (y0 * SW + x0) * 4;
      const i10 = (y0 * SW + x1) * 4;
      const i01 = (y1 * SW + x0) * 4;
      const i11 = (y1 * SW + x1) * 4;
      o[oi] = s[i00] * w00 + s[i10] * w10 + s[i01] * w01 + s[i11] * w11;
      o[oi + 1] = s[i00 + 1] * w00 + s[i10 + 1] * w10 + s[i01 + 1] * w01 + s[i11 + 1] * w11;
      o[oi + 2] = s[i00 + 2] * w00 + s[i10 + 2] * w10 + s[i01 + 2] * w01 + s[i11 + 2] * w11;
      o[oi + 3] = 255;
    }
  }
  return out;
}

/** Görüntüyü 90°'nin katları kadar saat yönünde çevirir (turns: 1 = 90°, 2 = 180°, 3 = 270°) */
export function rotateQuarter(img: RgbaImage, turns: number): RgbaImage {
  const t = ((Math.round(turns) % 4) + 4) % 4;
  if (t === 0) return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  const { width: W, height: H, data } = img;
  const ow = t % 2 ? H : W;
  const oh = t % 2 ? W : H;
  const out = createRgba(ow, oh);
  const o = out.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let nx: number;
      let ny: number;
      if (t === 1) {
        nx = H - 1 - y;
        ny = x;
      } else if (t === 2) {
        nx = W - 1 - x;
        ny = H - 1 - y;
      } else {
        nx = y;
        ny = W - 1 - x;
      }
      const si = (y * W + x) * 4;
      const di = (ny * ow + nx) * 4;
      o[di] = data[si];
      o[di + 1] = data[si + 1];
      o[di + 2] = data[si + 2];
      o[di + 3] = data[si + 3];
    }
  }
  return out;
}
