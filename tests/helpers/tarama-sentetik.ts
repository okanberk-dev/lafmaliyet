// Belge tarayıcının testleri için sentetik fotoğraf (dış kitaplık yok): koyu / dokulu / degrade / açık zemin, üzerine
// perspektifli ve döndürülmüş kâğıt dörtgeni, içinde yazı benzeri koyu çizgiler; gölge degradesi, gürültü, bulanıklık,
// kıvrık kenar. Kâğıt kenarı 3 × 3 alt örneklemeyle yumuşatılır (köşe hatası alt piksel ölçülebilsin). Gerçek köşeler
// bilindiği için algılamanın hatası köşegene oranla ölçülür (src/lib/scan, docs/FOTOGRAF.md › Belge tarama).

import type { Point, Quad, RgbaImage } from "../../src/lib/scan/image";
import { gaussianBlur, seededRandom } from "../../src/lib/scan/image";
import { orderCorners } from "../../src/lib/scan/geom";
import { applyHomography, homography } from "../../src/lib/scan/warp";

export type Zemin = "koyu" | "doku" | "degrade" | "acik" | "gri" | "beyaz" | "tahta";

export interface YaziAyari {
  /** satır sayısı */
  rows: number;
  /** yazının kâğıda göre eğikliği (derece; artı: satırlar sağa doğru iner) */
  skewDeg?: number;
  /** mürekkebin koyuluğu (0–1; 1 = tam mürekkep rengi, 0,3 = soluk termal baskı) */
  strength?: number;
  /** satırın doluluğu (0–1) */
  fill?: number;
  /** kâğıt kenarından boşluk (kâğıdın kısa kenarına oran) */
  margin?: number;
}

export interface Sahne {
  width: number;
  height: number;
  /** kâğıdın köşeleri, kâğıdın kendi sırasıyla (sol üst, sağ üst, sağ alt, sol alt); null: kâğıt yok */
  corners: Quad | null;
  /** kâğıdın gerçek en / boy oranı (yazı yerleşimi için); verilmezse köşelerden */
  paperAspect?: number;
  background: Zemin;
  bgColor?: [number, number, number];
  paper?: [number, number, number];
  ink?: [number, number, number];
  text?: YaziAyari | false;
  /** gölge: sol üstten sağ alta yumuşak kararma (0–1) */
  shadow?: number;
  /** sarı ışık: mavi kanal bu oranda azalır */
  warmLight?: number;
  /** Gauss gürültüsü (σ, 0–255) */
  noise?: number;
  /** bulanıklık (σ, px) */
  blur?: number;
  /** uzun kenarların ortadaki şişkinliği (px) */
  curl?: number;
  seed?: number;
}

/** Değer gürültüsü (kaba ızgara, çift doğrusal), 0–1 */
function valueNoise(w: number, h: number, cell: number, rnd: () => number): Float32Array {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = y / cell;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < w; x++) {
      const fx = x / cell;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const a = grid[y0 * gw + x0];
      const b = grid[y0 * gw + x0 + 1];
      const c = grid[(y0 + 1) * gw + x0];
      const d = grid[(y0 + 1) * gw + x0 + 1];
      out[y * w + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    }
  }
  return out;
}

function background(s: Sahne, rnd: () => number): Float32Array {
  const { width: w, height: h } = s;
  const out = new Float32Array(w * h * 3);
  const n1 = valueNoise(w, h, Math.max(8, Math.round(Math.min(w, h) / 12)), rnd);
  const n2 = valueNoise(w, h, 4, rnd);
  const base: Record<Zemin, [number, number, number]> = {
    koyu: [62, 48, 38],
    doku: [120, 105, 90],
    degrade: [90, 92, 100],
    acik: [204, 199, 190],
    gri: [178, 178, 176],
    beyaz: [236, 236, 233],
    tahta: [150, 110, 72],
  };
  const c = s.bgColor ?? base[s.background];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let k = 0;
      switch (s.background) {
        case "koyu":
          k = 18 * (n1[i] - 0.5) + 10 * (n2[i] - 0.5);
          break;
        case "doku":
          k = 70 * (n2[i] - 0.5) + 30 * (n1[i] - 0.5);
          break;
        case "degrade":
          k = 70 * ((x / w + y / h) / 2) + 8 * (n1[i] - 0.5);
          break;
        case "acik":
          k = 8 * (n1[i] - 0.5) + 5 * (n2[i] - 0.5);
          break;
        case "gri":
          k = 10 * (n1[i] - 0.5);
          break;
        case "beyaz":
          k = 4 * (n1[i] - 0.5);
          break;
        case "tahta":
          k = 25 * Math.sin(x * 0.045 + 6 * n1[i]) + 10 * (n2[i] - 0.5);
          break;
      }
      out[i * 3] = c[0] + k;
      out[i * 3 + 1] = c[1] + k;
      out[i * 3 + 2] = c[2] + k * 0.9;
    }
  }
  return out;
}

function hash(a: number, b: number, seed: number): number {
  let x = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(seed, 2246822519)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Kâğıt düzleminde (0–Pw × 0–Ph) yazının koyuluğu (0–1) */
function inkAt(U: number, V: number, Pw: number, Ph: number, t: YaziAyari, seed: number): number {
  const margin = (t.margin ?? 0.08) * Math.min(Pw, Ph);
  if (t.skewDeg) {
    const a = (-t.skewDeg * Math.PI) / 180;
    const cx = Pw / 2;
    const cy = Ph / 2;
    const dx = U - cx;
    const dy = V - cy;
    U = cx + dx * Math.cos(a) - dy * Math.sin(a);
    V = cy + dx * Math.sin(a) + dy * Math.cos(a);
  }
  if (U < margin || U > Pw - margin || V < margin || V > Ph - margin) return 0;
  const pitch = (Ph - 2 * margin) / t.rows;
  const r = Math.floor((V - margin) / pitch);
  const dy = V - margin - r * pitch;
  const xh = pitch * 0.55;
  if (dy > xh) return 0;
  const cw = Math.max(2, xh * 0.62);
  const u = U - margin;
  const ci = Math.floor(u / cw);
  const lx = (u - ci * cw) / cw;
  // satır uzunluğu ve kelime boşlukları
  const lineLen = (Pw - 2 * margin) * (0.45 + 0.55 * hash(r, 999, seed)) * (t.fill ?? 1);
  if (u > lineLen) return 0;
  const word = Math.floor(ci / 6);
  const inWord = ci % 6;
  if (inWord === 5 || hash(r, word, seed) < 0.12) return 0;
  const hv = hash(r * 131 + ci, 7, seed);
  const ly = dy / xh;
  let ink = 0;
  if (lx > 0.12 && lx < 0.3) ink = 1;
  if (hv > 0.35 && lx > 0.55 && lx < 0.73) ink = 1;
  if (hv > 0.6 && ly < 0.16 && lx > 0.12 && lx < 0.73) ink = 1;
  if (hv < 0.5 && ly > 0.84 && lx > 0.12 && lx < 0.73) ink = 1;
  if (hv > 0.8 && ly > 0.42 && ly < 0.58 && lx > 0.12 && lx < 0.73) ink = 1;
  if (lx >= 0.85) ink = 0;
  return ink * (t.strength ?? 1);
}

/** Sahneyi çizer (RGBA) */
export function renderScene(s: Sahne): RgbaImage {
  const { width: w, height: h } = s;
  const seed = s.seed ?? 1;
  const rnd = seededRandom(seed);
  const bg = background(s, rnd);
  const paper = s.paper ?? [242, 240, 234];
  const ink = s.ink ?? [28, 28, 34];
  const out = new Float32Array(w * h * 3);
  const unit: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const q = s.corners;
  const H = q ? homography(q, unit) : null;
  const wPx = q ? (Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) + Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y)) / 2 : 1;
  const hPx = q ? (Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y) + Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y)) / 2 : 1;
  const aspect = s.paperAspect ?? wPx / hPx;
  const Ph = 1000;
  const Pw = Ph * aspect;
  const curl = s.curl ? s.curl / wPx : 0;
  const paperNoise = valueNoise(w, h, 3, rnd);
  const SS = 3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS - 0.5;
          const py = y + (sy + 0.5) / SS - 0.5;
          let inPaper = false;
          let a = 0;
          if (H) {
            const uv = applyHomography(H, { x: px, y: py });
            let u = uv.x;
            const v = uv.y;
            if (curl) u = 0.5 + (u - 0.5) / (1 + curl * Math.sin(Math.PI * Math.max(0, Math.min(1, v))));
            if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
              inPaper = true;
              if (s.text) a = inkAt(u * Pw, v * Ph, Pw, Ph, s.text, seed);
            }
          }
          if (inPaper) {
            const pn = 4 * (paperNoise[i] - 0.5);
            r += paper[0] + pn + (ink[0] - paper[0]) * a;
            g += paper[1] + pn + (ink[1] - paper[1]) * a;
            b += paper[2] + pn + (ink[2] - paper[2]) * a;
          } else {
            r += bg[i * 3];
            g += bg[i * 3 + 1];
            b += bg[i * 3 + 2];
          }
        }
      }
      const k = SS * SS;
      out[i * 3] = r / k;
      out[i * 3 + 1] = g / k;
      out[i * 3 + 2] = b / k;
    }
  }
  // gölge (sol üstten sağ alta yumuşak) ve sarı ışık
  if (s.shadow || s.warmLight) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const t = (x / w + y / h) / 2;
        const sh = s.shadow ? 1 - s.shadow * (1 / (1 + Math.exp((t - 0.45) * 12))) : 1;
        out[i * 3] *= sh;
        out[i * 3 + 1] *= sh;
        out[i * 3 + 2] *= sh * (1 - (s.warmLight ?? 0));
      }
    }
  }
  if (s.blur) {
    for (let ch = 0; ch < 3; ch++) {
      const c = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) c[i] = out[i * 3 + ch];
      const bl = gaussianBlur({ width: w, height: h, data: c }, s.blur).data;
      for (let i = 0; i < w * h; i++) out[i * 3 + ch] = bl[i];
    }
  }
  const img: RgbaImage = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  const nrnd = seededRandom(seed + 17);
  const gauss = () => {
    const u = Math.max(1e-9, nrnd());
    const v = nrnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const sigma = s.noise ?? 0;
  for (let i = 0; i < w * h; i++) {
    for (let ch = 0; ch < 3; ch++) img.data[i * 4 + ch] = out[i * 3 + ch] + (sigma ? sigma * gauss() : 0);
    img.data[i * 4 + 3] = 255;
  }
  return img;
}

/**
 * Gerçek bir kamerayla çekilmiş dikdörtgen: `aspect` (en / boy) kâğıt düzlemde döndürülür (rotDeg), öne / yana yatırılır
 * (tiltX / tiltY, derece) ve odak uzaklığı f (varsayılan uzun kenarın 0,8'i) olan iğne deliği kamerayla görüntüye
 * düşürülür. `size`: kâğıdın kısa kenarının görüntünün kısa kenarına oranı yaklaşık. Döner: kâğıdın sırasıyla köşeler.
 */
export function projectRect(o: {
  width: number;
  height: number;
  aspect: number;
  size: number;
  rotDeg?: number;
  tiltX?: number;
  tiltY?: number;
  cx?: number;
  cy?: number;
  f?: number;
}): Quad {
  const f = o.f ?? 0.8 * Math.max(o.width, o.height);
  const a = o.aspect;
  const half = [
    [-a / 2, -0.5],
    [a / 2, -0.5],
    [a / 2, 0.5],
    [-a / 2, 0.5],
  ];
  const rz = ((o.rotDeg ?? 0) * Math.PI) / 180;
  const rx = ((o.tiltX ?? 0) * Math.PI) / 180;
  const ry = ((o.tiltY ?? 0) * Math.PI) / 180;
  const shortSide = Math.min(a, 1);
  const D = (f * shortSide) / (o.size * Math.min(o.width, o.height));
  const cx = o.cx ?? o.width / 2;
  const cy = o.cy ?? o.height / 2;
  const pts = half.map(([X0, Y0]) => {
    let X = X0 * Math.cos(rz) - Y0 * Math.sin(rz);
    let Y = X0 * Math.sin(rz) + Y0 * Math.cos(rz);
    let Z = 0;
    // x ekseni etrafında
    const Y1 = Y * Math.cos(rx) - Z * Math.sin(rx);
    const Z1 = Y * Math.sin(rx) + Z * Math.cos(rx);
    Y = Y1;
    Z = Z1;
    // y ekseni etrafında
    const X2 = X * Math.cos(ry) + Z * Math.sin(ry);
    const Z2 = -X * Math.sin(ry) + Z * Math.cos(ry);
    X = X2;
    Z = Z2 + D;
    return { x: (f * X) / Z + cx - 0.5, y: (f * Y) / Z + cy - 0.5 };
  });
  return pts as Quad;
}

/** İki dörtgenin en büyük köşe farkı, görüntü köşegenine oranla (sıralı karşılaştırılır) */
export function cornerError(a: Quad, b: Quad, width: number, height: number): number {
  const A = orderCorners(a);
  const B = orderCorners(b);
  let m = 0;
  for (let i = 0; i < 4; i++) m = Math.max(m, Math.hypot(A[i].x - B[i].x, A[i].y - B[i].y));
  return m / Math.hypot(width, height);
}

/** Görüntünün bir dikdörtgen bölgesinin gri ortalaması */
export function regionMean(img: RgbaImage, x0: number, y0: number, x1: number, y1: number): number {
  let s = 0;
  let n = 0;
  for (let y = Math.max(0, Math.round(y0)); y < Math.min(img.height, Math.round(y1)); y++) {
    for (let x = Math.max(0, Math.round(x0)); x < Math.min(img.width, Math.round(x1)); x++) {
      const p = (y * img.width + x) * 4;
      s += 0.299 * img.data[p] + 0.587 * img.data[p + 1] + 0.114 * img.data[p + 2];
      n++;
    }
  }
  return n ? s / n : 0;
}
