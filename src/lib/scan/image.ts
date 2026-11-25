/**
 * Belge tarayıcı çekirdeği: görüntü tipleri ve temel işlemler. Gri ton, alan ortalamalı küçültme, ayrılabilir Gauss
 * bulanıklığı, integral görüntüyle kutu filtresi, Sobel, en büyük / en küçük süzgeç, ikili morfoloji, bağlı bileşenler,
 * histogram ve Otsu. Hepsi saf: DOM'a dokunmaz, telefonda (tarayıcıda) ve testte (Node'da) aynı çalışır.
 *
 * Koordinat kuralı: (x, y) pikselinin merkezi tam sayı koordinattadır; küçültmede piksel merkezleri ölçeklenir
 * (`toScaled` / `fromScaled`), böylece köşeler ölçek değişince kaymaz.
 */

/** RGBA görüntü (canvas ImageData ile aynı yerleşim) */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Tek kanallı görüntü (0–255 aralığında ondalık) */
export interface GrayImage {
  width: number;
  height: number;
  data: Float32Array;
}

export interface Point {
  x: number;
  y: number;
}

/** Dört köşe: sol üst, sağ üst, sağ alt, sol alt */
export type Quad = [Point, Point, Point, Point];

export function createRgba(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function createGray(width: number, height: number): GrayImage {
  return { width, height, data: new Float32Array(width * height) };
}

/** En uzun kenarı `maxEdge`'i aşmayan ölçü (büyütmez) */
export function fitSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const k = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Asıl görüntüdeki noktayı `fw × fh` boyutundaki kopyaya taşır (piksel merkezleri hizalı) */
export function toScaled(p: Point, srcW: number, srcH: number, dstW: number, dstH: number): Point {
  return { x: ((p.x + 0.5) * dstW) / srcW - 0.5, y: ((p.y + 0.5) * dstH) / srcH - 0.5 };
}

/** Kopyadaki noktayı asıl görüntüye geri taşır */
export function fromScaled(p: Point, srcW: number, srcH: number, dstW: number, dstH: number): Point {
  return { x: ((p.x + 0.5) * srcW) / dstW - 0.5, y: ((p.y + 0.5) * srcH) / dstH - 0.5 };
}

export function scaleQuad(q: Quad, srcW: number, srcH: number, dstW: number, dstH: number): Quad {
  return q.map((p) => toScaled(p, srcW, srcH, dstW, dstH)) as Quad;
}

export function unscaleQuad(q: Quad, srcW: number, srcH: number, dstW: number, dstH: number): Quad {
  return q.map((p) => fromScaled(p, srcW, srcH, dstW, dstH)) as Quad;
}

// ---------------------------------------------------------------- yeniden örnekleme

interface Taps {
  start: Int32Array;
  len: Int32Array;
  idx: Int32Array;
  wt: Float32Array;
}

/** Bir eksende örnekleme ağırlıkları: küçültmede alan ortalaması (örtüşme yok), büyütmede doğrusal */
function taps(src: number, dst: number): Taps {
  const start = new Int32Array(dst);
  const len = new Int32Array(dst);
  const idx: number[] = [];
  const wt: number[] = [];
  const r = src / dst;
  for (let i = 0; i < dst; i++) {
    start[i] = idx.length;
    if (r >= 1) {
      const a = i * r;
      const b = (i + 1) * r;
      const j0 = Math.floor(a);
      const j1 = Math.min(src, Math.ceil(b));
      let sum = 0;
      for (let j = j0; j < j1; j++) {
        const w = Math.min(b, j + 1) - Math.max(a, j);
        if (w <= 1e-9) continue;
        idx.push(j);
        wt.push(w);
        sum += w;
      }
      for (let k = start[i]; k < idx.length; k++) wt[k] /= sum;
    } else {
      const x = (i + 0.5) * r - 0.5;
      const j = Math.floor(x);
      const f = x - j;
      const j0 = Math.max(0, Math.min(src - 1, j));
      const j1 = Math.max(0, Math.min(src - 1, j + 1));
      idx.push(j0, j1);
      wt.push(1 - f, f);
    }
    len[i] = idx.length - start[i];
  }
  return { start, len, idx: Int32Array.from(idx), wt: Float32Array.from(wt) };
}

/** RGBA görüntüyü yeniden boyutlar (küçültmede alan ortalaması) */
export function resizeRgba(img: RgbaImage, width: number, height: number): RgbaImage {
  const { width: W, height: H, data } = img;
  if (W === width && H === height) return { width, height, data: new Uint8ClampedArray(data) };
  const tx = taps(W, width);
  const ty = taps(H, height);
  const tmp = new Float32Array(width * H * 4);
  for (let y = 0; y < H; y++) {
    const row = y * W * 4;
    const orow = y * width * 4;
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      const s = tx.start[x];
      const e = s + tx.len[x];
      for (let k = s; k < e; k++) {
        const p = row + tx.idx[k] * 4;
        const w = tx.wt[k];
        r += data[p] * w;
        g += data[p + 1] * w;
        b += data[p + 2] * w;
        a += data[p + 3] * w;
      }
      const o = orow + x * 4;
      tmp[o] = r;
      tmp[o + 1] = g;
      tmp[o + 2] = b;
      tmp[o + 3] = a;
    }
  }
  const out = new Uint8ClampedArray(width * height * 4);
  const stride = width * 4;
  // Uint8ClampedArray'e doğrudan toplamak yuvarlama hatası biriktirir: satır ondalık toplanır, sonra yazılır
  const acc = new Float32Array(stride);
  for (let y = 0; y < height; y++) {
    acc.fill(0);
    const s = ty.start[y];
    const e = s + ty.len[y];
    for (let k = s; k < e; k++) {
      const w = ty.wt[k];
      const irow = ty.idx[k] * stride;
      for (let x = 0; x < stride; x++) acc[x] += tmp[irow + x] * w;
    }
    out.set(acc, y * stride);
  }
  return { width, height, data: out };
}

/** Gri görüntüyü yeniden boyutlar (küçültmede alan ortalaması) */
export function resizeGray(img: GrayImage, width: number, height: number): GrayImage {
  const { width: W, height: H, data } = img;
  if (W === width && H === height) return { width, height, data: new Float32Array(data) };
  const tx = taps(W, width);
  const ty = taps(H, height);
  const tmp = new Float32Array(width * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    const orow = y * width;
    for (let x = 0; x < width; x++) {
      let v = 0;
      const s = tx.start[x];
      const e = s + tx.len[x];
      for (let k = s; k < e; k++) v += data[row + tx.idx[k]] * tx.wt[k];
      tmp[orow + x] = v;
    }
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const s = ty.start[y];
    const e = s + ty.len[y];
    const orow = y * width;
    for (let k = s; k < e; k++) {
      const w = ty.wt[k];
      const irow = ty.idx[k] * width;
      for (let x = 0; x < width; x++) out[orow + x] += tmp[irow + x] * w;
    }
  }
  return { width, height, data: out };
}

/** Parlaklık (Rec. 601) */
export function toGray(img: RgbaImage): GrayImage {
  const { width, height, data } = img;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  return { width, height, data: out };
}

/** Çift doğrusal örnek (görüntü dışı kenara kenetlenir) */
export function sampleBilinear(g: GrayImage, x: number, y: number): number {
  const { width: w, height: h, data } = g;
  if (x < 0) x = 0;
  else if (x > w - 1) x = w - 1;
  if (y < 0) y = 0;
  else if (y > h - 1) y = h - 1;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1 < w ? x0 + 1 : x0;
  const y1 = y0 + 1 < h ? y0 + 1 : y0;
  const fx = x - x0;
  const fy = y - y0;
  const a = data[y0 * w + x0];
  const b = data[y0 * w + x1];
  const c = data[y1 * w + x0];
  const d = data[y1 * w + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// ---------------------------------------------------------------- süzgeçler

function gaussKernel(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

/** Bir kanalda ayrılabilir evrişim (kenarlar kenetlenir) */
function convolveSeparable(src: Float32Array, w: number, h: number, kern: Float32Array): Float32Array {
  const r = (kern.length - 1) >> 1;
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = 0;
      if (x >= r && x < w - r) {
        const base = row + x - r;
        for (let k = 0; k < kern.length; k++) v += src[base + k] * kern[k];
      } else {
        for (let k = -r; k <= r; k++) {
          let xx = x + k;
          if (xx < 0) xx = 0;
          else if (xx >= w) xx = w - 1;
          v += src[row + xx] * kern[k + r];
        }
      }
      tmp[row + x] = v;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    if (y >= r && y < h - r) {
      for (let k = 0; k < kern.length; k++) {
        const kv = kern[k];
        const irow = (y - r + k) * w;
        for (let x = 0; x < w; x++) out[row + x] += tmp[irow + x] * kv;
      }
    } else {
      for (let k = -r; k <= r; k++) {
        let yy = y + k;
        if (yy < 0) yy = 0;
        else if (yy >= h) yy = h - 1;
        const kv = kern[k + r];
        const irow = yy * w;
        for (let x = 0; x < w; x++) out[row + x] += tmp[irow + x] * kv;
      }
    }
  }
  return out;
}

/** Ayrılabilir Gauss bulanıklığı */
export function gaussianBlur(g: GrayImage, sigma: number): GrayImage {
  if (!(sigma > 0)) return { width: g.width, height: g.height, data: new Float32Array(g.data) };
  return { width: g.width, height: g.height, data: convolveSeparable(g.data, g.width, g.height, gaussKernel(sigma)) };
}

/** Integral görüntü ((w+1) × (h+1)) */
export function integralImage(data: ArrayLike<number>, w: number, h: number): Float64Array {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    const src = y * w;
    const dst = (y + 1) * (w + 1);
    const prev = y * (w + 1);
    for (let x = 0; x < w; x++) {
      rowSum += data[src + x];
      I[dst + x + 1] = I[prev + x + 1] + rowSum;
    }
  }
  return I;
}

/** Integral görüntüde [x0, x1) × [y0, y1) toplamı */
export function rectSum(I: Float64Array, w: number, x0: number, y0: number, x1: number, y1: number): number {
  const W = w + 1;
  return I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0];
}

/** Kutu ortalaması ((2r+1)² pencere, kenarda pencere kırpılır); integral görüntüyle O(1) */
export function boxMean(g: GrayImage, r: number): GrayImage {
  const { width: w, height: h } = g;
  const I = integralImage(g.data, w, h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      out[y * w + x] = rectSum(I, w, x0, y0, x1, y1) / ((x1 - x0) * (y1 - y0));
    }
  }
  return { width: w, height: h, data: out };
}

/** Sobel türevleri (/8: birim piksel başına parlaklık farkı) */
export function sobel(g: GrayImage): { gx: Float32Array; gy: Float32Array } {
  const { width: w, height: h, data: d } = g;
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ym = (y > 0 ? y - 1 : 0) * w;
    const y0 = y * w;
    const yp = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < w - 1 ? x + 1 : x;
      const a = d[ym + xm];
      const b = d[ym + x];
      const c = d[ym + xp];
      const e = d[y0 + xm];
      const f = d[y0 + xp];
      const g2 = d[yp + xm];
      const hh = d[yp + x];
      const i = d[yp + xp];
      gx[y0 + x] = (c + 2 * f + i - a - 2 * e - g2) / 8;
      gy[y0 + x] = (g2 + 2 * hh + i - a - 2 * b - c) / 8;
    }
  }
  return { gx, gy };
}

/** Kayan pencerede en büyük, yatay (van Herk–Gil-Werman: blok önek / sonek, pencere başına sabit iş) */
function maxRows(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const k = 2 * r + 1;
  const G = new Float32Array(w);
  const S = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let i = 0; i < w; i++) {
      const v = src[o + i];
      G[i] = i % k === 0 || G[i - 1] < v ? v : G[i - 1];
    }
    for (let i = w - 1; i >= 0; i--) {
      const v = src[o + i];
      S[i] = i === w - 1 || (i + 1) % k === 0 || S[i + 1] < v ? v : S[i + 1];
    }
    for (let i = 0; i < w; i++) {
      const b = i + r < w ? i + r : w - 1;
      if (i < r) dst[o + i] = G[b];
      else if (Math.floor((i - r) / k) === Math.floor(b / k)) dst[o + i] = S[i - r]; // kenarda kırpılmış pencere tek blokta
      else {
        const a = S[i - r];
        const c = G[b];
        dst[o + i] = a > c ? a : c;
      }
    }
  }
}

/** Kayan pencerede en büyük, dikey (satırlar bütün hâlinde işlenir; bellekte bitişik) */
function maxCols(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const k = 2 * r + 1;
  const G = new Float32Array(w * h);
  const S = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    if (y % k === 0) for (let x = 0; x < w; x++) G[o + x] = src[o + x];
    else
      for (let x = 0; x < w; x++) {
        const v = src[o + x];
        const p = G[o - w + x];
        G[o + x] = p < v ? v : p;
      }
  }
  for (let y = h - 1; y >= 0; y--) {
    const o = y * w;
    if (y === h - 1 || (y + 1) % k === 0) for (let x = 0; x < w; x++) S[o + x] = src[o + x];
    else
      for (let x = 0; x < w; x++) {
        const v = src[o + x];
        const p = S[o + w + x];
        S[o + x] = p < v ? v : p;
      }
  }
  for (let y = 0; y < h; y++) {
    const o = y * w;
    const by = y + r < h ? y + r : h - 1;
    const b = by * w;
    if (y < r) for (let x = 0; x < w; x++) dst[o + x] = G[b + x];
    else if (Math.floor((y - r) / k) === Math.floor(by / k)) for (let x = 0; x < w; x++) dst[o + x] = S[(y - r) * w + x];
    else {
      const a = (y - r) * w;
      for (let x = 0; x < w; x++) {
        const u = S[a + x];
        const c = G[b + x];
        dst[o + x] = u > c ? u : c;
      }
    }
  }
}

function extremeFilter(g: GrayImage, r: number, isMax: boolean): GrayImage {
  const { width: w, height: h } = g;
  const n = w * h;
  let src = g.data;
  if (!isMax) {
    src = new Float32Array(n);
    for (let i = 0; i < n; i++) src[i] = -g.data[i];
  }
  const tmp = new Float32Array(n);
  const out = new Float32Array(n);
  maxRows(src, tmp, w, h, r);
  maxCols(tmp, out, w, h, r);
  if (!isMax) for (let i = 0; i < n; i++) out[i] = -out[i];
  return { width: w, height: h, data: out };
}

/** Kare pencerede en büyük (gri genişletme) */
export function maxFilter(g: GrayImage, r: number): GrayImage {
  return extremeFilter(g, r, true);
}

/** Kare pencerede en küçük (gri aşındırma) */
export function minFilter(g: GrayImage, r: number): GrayImage {
  return extremeFilter(g, r, false);
}

// ---------------------------------------------------------------- ikili morfoloji ve bağlı bileşenler

function runningMask(m: Uint8Array, w: number, h: number, r: number, erode: boolean): Uint8Array {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let count = 0;
    for (let x = 0; x < Math.min(w, r); x++) count += m[row + x];
    for (let x = 0; x < w; x++) {
      const add = x + r;
      if (add < w) count += m[row + add];
      const rem = x - r - 1;
      if (rem >= 0) count -= m[row + rem];
      const span = Math.min(w - 1, x + r) - Math.max(0, x - r) + 1;
      tmp[row + x] = erode ? (count === span ? 1 : 0) : count > 0 ? 1 : 0;
    }
  }
  // dikey: sütun sayaçları satır satır güncellenir (bellekte bitişik)
  const count = new Int32Array(w);
  for (let y = 0; y < Math.min(h, r); y++) for (let x = 0; x < w; x++) count[x] += tmp[y * w + x];
  for (let y = 0; y < h; y++) {
    const add = y + r;
    if (add < h) for (let x = 0, o = add * w; x < w; x++) count[x] += tmp[o + x];
    const rem = y - r - 1;
    if (rem >= 0) for (let x = 0, o = rem * w; x < w; x++) count[x] -= tmp[o + x];
    const span = Math.min(h - 1, y + r) - Math.max(0, y - r) + 1;
    const row = y * w;
    if (erode) for (let x = 0; x < w; x++) out[row + x] = count[x] === span ? 1 : 0;
    else for (let x = 0; x < w; x++) out[row + x] = count[x] > 0 ? 1 : 0;
  }
  return out;
}

/** İkili genişletme (kare pencere) */
export function dilateMask(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return r <= 0 ? new Uint8Array(m) : runningMask(m, w, h, r, false);
}

/** İkili aşındırma (kare pencere; görüntü dışı dolu sayılır, kareye dayanan bölge yenmez) */
export function erodeMask(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return r <= 0 ? new Uint8Array(m) : runningMask(m, w, h, r, true);
}

export function closeMask(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return erodeMask(dilateMask(m, w, h, r), w, h, r);
}

export function openMask(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return dilateMask(erodeMask(m, w, h, r), w, h, r);
}

export interface Components {
  /** 0 = zemin, 1…count */
  labels: Int32Array;
  count: number;
  /** labels ile aynı sırada (0. öğe kullanılmaz) */
  areas: Int32Array;
  minX: Int32Array;
  minY: Int32Array;
  maxX: Int32Array;
  maxY: Int32Array;
}

/** Bağlı bileşenler (iki geçiş, birleşim-bul); `eight` = 8 komşuluk */
export function labelComponents(m: Uint8Array, w: number, h: number, eight = false): Components {
  const n = w * h;
  const labels = new Int32Array(n);
  let parent = new Int32Array(1024);
  let next = 1;
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const union = (a: number, b: number): number => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return ra;
    if (ra < rb) {
      parent[rb] = ra;
      return ra;
    }
    parent[ra] = rb;
    return rb;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!m[i]) continue;
      let l = 0;
      if (x > 0 && labels[i - 1]) l = labels[i - 1];
      if (y > 0 && labels[i - w]) l = l ? union(l, labels[i - w]) : labels[i - w];
      if (eight && y > 0) {
        if (x > 0 && labels[i - w - 1]) l = l ? union(l, labels[i - w - 1]) : labels[i - w - 1];
        if (x < w - 1 && labels[i - w + 1]) l = l ? union(l, labels[i - w + 1]) : labels[i - w + 1];
      }
      if (!l) {
        if (next >= parent.length) {
          const p2 = new Int32Array(parent.length * 2);
          p2.set(parent);
          parent = p2;
        }
        parent[next] = next;
        l = next++;
      }
      labels[i] = l;
    }
  }
  const remap = new Int32Array(next);
  let count = 0;
  for (let l = 1; l < next; l++) {
    const r = find(l);
    if (r === l) remap[l] = ++count;
  }
  for (let l = 1; l < next; l++) remap[l] = remap[find(l)];
  const areas = new Int32Array(count + 1);
  const minX = new Int32Array(count + 1).fill(w);
  const minY = new Int32Array(count + 1).fill(h);
  const maxX = new Int32Array(count + 1).fill(-1);
  const maxY = new Int32Array(count + 1).fill(-1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!labels[i]) continue;
      const l = remap[labels[i]];
      labels[i] = l;
      areas[l]++;
      if (x < minX[l]) minX[l] = x;
      if (x > maxX[l]) maxX[l] = x;
      if (y < minY[l]) minY[l] = y;
      if (y > maxY[l]) maxY[l] = y;
    }
  }
  return { labels, count, areas, minX, minY, maxX, maxY };
}

/**
 * Bileşenin dış hattı (Moore komşu izleme, Jacob durdurma ölçütü): saat yönünde sınır pikselleri. Bileşen 4 ya da 8
 * bağlı olabilir; hat 8 komşulukla yürür.
 */
export function traceContour(labels: Int32Array, w: number, h: number, label: number, startX: number, startY: number): Point[] {
  // komşular saat yönünde (y aşağı): B, KB, K, KD, D, GD, G, GB
  const DX = [-1, -1, 0, 1, 1, 1, 0, -1];
  const DY = [0, -1, -1, -1, 0, 1, 1, 1];
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === label;
  const dirOf = (dx: number, dy: number) => {
    for (let k = 0; k < 8; k++) if (DX[k] === dx && DY[k] === dy) return k;
    return 0;
  };
  const out: Point[] = [{ x: startX, y: startY }];
  let cx = startX;
  let cy = startY;
  let back = 0; // başlangıcın batısı dışarıda (satır taramasında ilk piksel)
  const startBack = back;
  const limit = 4 * w * h + 16;
  for (let step = 0; step < limit; step++) {
    let found = -1;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      if (inside(cx + DX[d], cy + DY[d])) {
        found = d;
        break;
      }
    }
    if (found < 0) break; // tek piksel
    const prev = (found + 7) % 8;
    const bx = cx + DX[prev];
    const by = cy + DY[prev];
    cx += DX[found];
    cy += DY[found];
    back = dirOf(bx - cx, by - cy);
    if (cx === startX && cy === startY && back === startBack) break;
    out.push({ x: cx, y: cy });
  }
  return out;
}

// ---------------------------------------------------------------- histogram

/** `bins` kutulu histogram ([lo, hi) aralığı; dışı uç kutulara) */
export function histogram(data: ArrayLike<number>, bins = 256, lo = 0, hi = 256, step = 1): Float64Array {
  const hist = new Float64Array(bins);
  const k = bins / (hi - lo);
  for (let i = 0; i < data.length; i += step) {
    let b = Math.floor((data[i] - lo) * k);
    if (b < 0) b = 0;
    else if (b >= bins) b = bins - 1;
    hist[b]++;
  }
  return hist;
}

/** Otsu eşiği: dönen kutu indeksinden büyükler ön plan */
export function otsuIndex(hist: ArrayLike<number>, from = 0, to = hist.length): number {
  let total = 0;
  let sumAll = 0;
  for (let i = from; i < to; i++) {
    total += hist[i];
    sumAll += i * hist[i];
  }
  if (total <= 0) return Math.floor((from + to) / 2);
  let w0 = 0;
  let sum0 = 0;
  let best = -1;
  let bestT = from;
  for (let t = from; t < to - 1; t++) {
    w0 += hist[t];
    sum0 += t * hist[t];
    const w1 = total - w0;
    if (w0 <= 0 || w1 <= 0) continue;
    const m0 = sum0 / w0;
    const m1 = (sumAll - sum0) / w1;
    const v = w0 * w1 * (m0 - m1) * (m0 - m1);
    if (v > best) {
      best = v;
      bestT = t;
    }
  }
  return bestT;
}

/** Histogramdan yüzdelik (p: 0–1); dönen değer kutu ortası, [lo, hi) aralığında */
export function histPercentile(hist: ArrayLike<number>, p: number, lo = 0, hi = 256): number {
  let total = 0;
  for (let i = 0; i < hist.length; i++) total += hist[i];
  if (total <= 0) return lo;
  const target = p * total;
  let acc = 0;
  const bw = (hi - lo) / hist.length;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i];
    if (acc >= target) return lo + (i + 0.5) * bw;
  }
  return hi - bw / 2;
}

/** Küçük dizilerde ortanca (diziyi sıralar) */
export function median(values: number[]): number {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  const m = values.length >> 1;
  return values.length % 2 ? values[m] : (values[m - 1] + values[m]) / 2;
}

/** Tekrarlanabilir sözde rastgele sayı (mulberry32) */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
