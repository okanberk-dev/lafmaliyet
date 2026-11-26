/**
 * Tarayıcı ölçümünün sahnesi (docs/FOTOGRAF.md › Tarayıcının ölçümü): kâğıdın resmi (scripts/tarama/kagit.ts,
 * Playwright) bir zeminin üstüne telefonla çekilmiş gibi bindirilir. Kâğıt 3B bir ızgaradır: iğne deliği kamerayla
 * perspektif, döndürme, kıvrılma / bükülme (yana oluk, ucun kalkması, buruşukluk), kıvrık köşe. Zeminler: ahşap,
 * mermer, koyu ve beyaz tezgâh, gri masa, elde tutulmuş (bulanık oda, el ve başparmak). Işık ve kamera: kâğıdın
 * gölgesi, gölge degradesi, el gölgesi, renkli ışık, parlama, pozlama, kenar kararması, hareket ve odak bulanıklığı,
 * gürültü (JPEG çağıranda). Hepsi tohumlu: aynı tohum aynı görüntüyü verir.
 *
 * Doğru köşeler kâğıdın köşelerinin izdüşümüdür. Kıvrık köşede katlanmamış köşe (iki kenarın kesiştiği yer; tarayıcının
 * bulması gereken), kadraj dışında kalan köşe yerine kâğıdın yan kenarının karenin kenarını kestiği yer, kareyi
 * dolduran yakın çekimde görüntünün köşeleri. Uygulama kodu bu dosyaya bağlanmaz (yalnız betikler).
 */

import type { Point, Quad } from "../../src/lib/scan/image";

type Rnd = () => number;

export type Zemin = "ahsap" | "mermer" | "koyu-tezgah" | "beyaz-tezgah" | "gri-masa" | "elde";
export const ZEMINLER: readonly Zemin[] = ["ahsap", "mermer", "koyu-tezgah", "beyaz-tezgah", "gri-masa", "elde"];

/** normal: kâğıdın tamamı karede; yakin: kâğıt kareyi dolduruyor; kadraj-disi: bir kısa kenarı karenin dışında */
export type Durum = "normal" | "yakin" | "kadraj-disi";

/** RGBA doku (kâğıdın resmi; nesnelerde saydam zemin) */
export interface Doku {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Düzlemsel RGB tuval (0–255, ondalık) */
interface Tuval {
  w: number;
  h: number;
  c: [Float32Array, Float32Array, Float32Array];
}

const sec = <T>(rnd: Rnd, xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const ara = (rnd: Rnd, a: number, b: number) => a + rnd() * (b - a);
const sinirla = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const yumusak = (a: number, b: number, x: number) => {
  const t = sinirla((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function tuval(w: number, h: number): Tuval {
  return { w, h, c: [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)] };
}

/* ------------------------------------------------------------------ gürültü */

/** Değer gürültüsü: 256×256 kafeste rastgele değerler, arası yumuşak (smoothstep); 256 hücrede bir tekrarlar */
class Kafes {
  private v: Float32Array;
  constructor(rnd: Rnd) {
    this.v = new Float32Array(65536);
    for (let i = 0; i < 65536; i++) this.v[i] = rnd();
  }
  at(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let tx = x - xi;
    let ty = y - yi;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    const x0 = xi & 255;
    const x1 = (xi + 1) & 255;
    const y0 = (yi & 255) << 8;
    const y1 = ((yi + 1) & 255) << 8;
    const v = this.v;
    const a = v[y0 + x0];
    const b = v[y0 + x1];
    const c = v[y1 + x0];
    const d = v[y1 + x1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }
  /** Kesirli Brown hareketi (0–1 civarı) */
  fbm(x: number, y: number, oktav: number): number {
    let s = 0;
    let a = 1;
    let t = 0;
    for (let o = 0; o < oktav; o++) {
      s += a * this.at(x, y);
      t += a;
      x = x * 2.03 + 17.1;
      y = y * 2.03 + 3.7;
      a *= 0.5;
    }
    return s / t;
  }
}

/** Standart normal dağılımlı sayı (Box–Muller) */
function normal(rnd: Rnd): number {
  const u = Math.max(1e-12, rnd());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

/* ------------------------------------------------------------------ bulanıklık */

/** Tek kanal Gauss (σ ≤ 4 çekirdekle, büyüğünde üç geçişli kutu) */
function gauss1(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma < 0.2) return src;
  if (sigma > 4) {
    const n = Math.sqrt(4 * sigma * sigma + 1);
    const r = Math.max(1, Math.round((n - 1) / 2));
    let a = src;
    for (let k = 0; k < 3; k++) a = kutu(kutu(a, w, h, r, true), w, h, r, false);
    return a;
  }
  const r = Math.ceil(sigma * 3);
  const ker = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) s += ker[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < ker.length; i++) ker[i] /= s;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i;
        acc += src[o + xx] * ker[i + r];
      }
      tmp[o + x] = acc;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i;
        acc += tmp[yy * w + x] * ker[i + r];
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

/** Kutu süzgeci (yatay ya da dikey), kenarda uç değer tekrarlanır */
function kutu(src: Float32Array, w: number, h: number, r: number, yatay: boolean): Float32Array {
  const out = new Float32Array(w * h);
  const n = 2 * r + 1;
  const L = yatay ? w : h;
  const M = yatay ? h : w;
  const adim = yatay ? 1 : w;
  for (let m = 0; m < M; m++) {
    const o = yatay ? m * w : m;
    let s = 0;
    for (let i = -r; i <= r; i++) s += src[o + sinirla(i, 0, L - 1) * adim];
    for (let i = 0; i < L; i++) {
      out[o + i * adim] = s / n;
      s += src[o + Math.min(L - 1, i + r + 1) * adim] - src[o + Math.max(0, i - r) * adim];
    }
  }
  return out;
}

function tuvalGauss(t: Tuval, sigma: number): void {
  for (let k = 0; k < 3; k++) t.c[k] = gauss1(t.c[k], t.w, t.h, sigma);
}

/** Doğrusal hareket bulanıklığı: `uzunluk` px boyunca, `aci` yönünde ortalama */
function hareketBulanik(t: Tuval, uzunluk: number, aci: number): void {
  const K = Math.max(2, Math.ceil(uzunluk) + 1);
  const dx = Math.cos(aci);
  const dy = Math.sin(aci);
  const { w, h } = t;
  for (let k = 0; k < 3; k++) {
    const src = t.c[k];
    const out = new Float32Array(w * h);
    for (let j = 0; j < K; j++) {
      const s = (j / (K - 1) - 0.5) * uzunluk;
      const ox = s * dx;
      const oy = s * dy;
      const ix = Math.floor(ox);
      const iy = Math.floor(oy);
      const fx = ox - ix;
      const fy = oy - iy;
      for (let y = 0; y < h; y++) {
        const y0 = sinirla(y + iy, 0, h - 1) * w;
        const y1 = sinirla(y + iy + 1, 0, h - 1) * w;
        for (let x = 0; x < w; x++) {
          const x0 = sinirla(x + ix, 0, w - 1);
          const x1 = sinirla(x + ix + 1, 0, w - 1);
          const a = src[y0 + x0] + (src[y0 + x1] - src[y0 + x0]) * fx;
          const b = src[y1 + x0] + (src[y1 + x1] - src[y1 + x0]) * fx;
          out[y * w + x] += a + (b - a) * fy;
        }
      }
    }
    for (let i = 0; i < out.length; i++) out[i] /= K;
    t.c[k] = out;
  }
}

/* ------------------------------------------------------------------ zeminler */

function zeminUret(z: Zemin, w: number, h: number, rnd: Rnd): Tuval {
  const t = tuval(w, h);
  const [R, G, B] = t.c;
  const k1 = new Kafes(rnd);
  const k2 = new Kafes(rnd);
  const aci = rnd() * Math.PI;
  const ca = Math.cos(aci);
  const sa = Math.sin(aci);
  if (z === "ahsap") {
    const taban = sec(rnd, [
      [150, 104, 64],
      [178, 130, 84],
      [118, 80, 50],
      [196, 158, 116],
      [92, 62, 40],
    ]);
    const tahta = ara(rnd, 160, 420);
    const halka = ara(rnd, 20, 60);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x * ca + y * sa;
        const v = -x * sa + y * ca + 5000;
        const pi = Math.floor(v / tahta);
        const pv = v - pi * tahta;
        const ton = 0.86 + 0.28 * k2.at(pi * 3.7 + 0.5, 11.3);
        const kivrim = k1.fbm(u / 260 + pi * 9.1, v / 70, 3);
        const hk = 0.5 + 0.5 * Math.sin((v / halka + kivrim * 3.2) * 2 * Math.PI);
        const lif = k2.at(u / 90 + pi * 17, v / 2.2);
        let s = ton * (0.8 + 0.14 * hk + 0.12 * (lif - 0.5));
        if (pv < 2.2 || tahta - pv < 1.2) s *= 0.55;
        const i = y * w + x;
        R[i] = taban[0] * s;
        G[i] = taban[1] * s;
        B[i] = taban[2] * s;
      }
    }
  } else if (z === "mermer") {
    const koyu = rnd() < 0.3;
    const taban = koyu ? [38, 38, 42] : [232 + ara(rnd, -6, 4), 231 + ara(rnd, -6, 4), 227 + ara(rnd, -6, 4)];
    const per = ara(rnd, 160, 320);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x * ca + y * sa;
        const n = k1.fbm(x / 320, y / 320, 5);
        const tt = u / per + n * 4.5;
        const damar = Math.pow(1 - Math.abs(Math.sin(tt * Math.PI)), 10);
        const damar2 = Math.pow(1 - Math.abs(Math.sin((tt * 2.3 + k2.fbm(x / 200, y / 200, 3) * 3) * Math.PI)), 22) * 0.5;
        const bulut = k2.fbm(x / 500 + 40, y / 500, 3) - 0.5;
        const i = y * w + x;
        if (koyu) {
          const d = damar * 120 + damar2 * 60 + bulut * 10;
          R[i] = taban[0] + d;
          G[i] = taban[1] + d;
          B[i] = taban[2] + d * 1.02;
        } else {
          const d = damar * 62 + damar2 * 40 - bulut * 12;
          R[i] = taban[0] - d;
          G[i] = taban[1] - d * 0.97;
          B[i] = taban[2] - d * 0.92;
        }
      }
    }
  } else if (z === "koyu-tezgah") {
    const taban = sec(rnd, [
      [48, 47, 50],
      [60, 52, 46],
      [35, 38, 44],
      [70, 66, 62],
    ]);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const bulut = k1.fbm(x / 120, y / 120, 4) - 0.5;
        const tane = k2.at(x / 1.7, y / 1.7);
        const benek = tane > 0.84 ? (70 * (tane - 0.84)) / 0.16 : tane < 0.1 ? -18 : 0;
        const d = bulut * 24 + benek;
        const i = y * w + x;
        R[i] = taban[0] + d;
        G[i] = taban[1] + d;
        B[i] = taban[2] + d;
      }
    }
  } else if (z === "beyaz-tezgah") {
    const taban = [238 + ara(rnd, -8, 6), 238 + ara(rnd, -8, 6), 234 + ara(rnd, -8, 6)];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = (k1.fbm(x / 300, y / 300, 3) - 0.5) * 10 + (k2.at(x / 1.3, y / 1.3) - 0.5) * 6;
        const i = y * w + x;
        R[i] = taban[0] + d;
        G[i] = taban[1] + d;
        B[i] = taban[2] + d;
      }
    }
  } else if (z === "gri-masa") {
    const g = ara(rnd, 118, 172);
    const taban = [g + ara(rnd, -6, 6), g + ara(rnd, -4, 4), g + ara(rnd, -2, 10)];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x * ca + y * sa;
        const v = -x * sa + y * ca;
        const d = (k1.fbm(x / 260, y / 260, 3) - 0.5) * 14 + (k2.at(u / 60, v / 1.5) - 0.5) * 7;
        const i = y * w + x;
        R[i] = taban[0] + d;
        G[i] = taban[1] + d;
        B[i] = taban[2] + d;
      }
    }
  } else {
    // elde: kâğıdın arkasında bulanık bir oda (duvar, dolap, pencere)
    const sw = Math.max(8, Math.round(w / 8));
    const sh = Math.max(8, Math.round(h / 8));
    const k = tuval(sw, sh);
    const ust = sec(rnd, [
      [196, 186, 170],
      [150, 160, 170],
      [210, 200, 190],
      [120, 110, 100],
    ]);
    const alt = sec(rnd, [
      [90, 70, 55],
      [60, 60, 66],
      [140, 120, 100],
      [40, 36, 34],
    ]);
    for (let y = 0; y < sh; y++) {
      const tt = y / (sh - 1);
      for (let x = 0; x < sw; x++) for (let c = 0; c < 3; c++) k.c[c][y * sw + x] = ust[c] + (alt[c] - ust[c]) * tt;
    }
    const n = 5 + Math.floor(rnd() * 5);
    for (let j = 0; j < n; j++) {
      const x0 = Math.floor(rnd() * sw);
      const y0 = Math.floor(rnd() * sh);
      const x1 = Math.min(sw, x0 + 2 + Math.floor(rnd() * sw * 0.5));
      const y1 = Math.min(sh, y0 + 2 + Math.floor(rnd() * sh * 0.5));
      const renk = [ara(rnd, 20, 250), ara(rnd, 20, 240), ara(rnd, 20, 230)];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) k.c[c][y * sw + x] = renk[c];
    }
    tuvalGauss(k, 2.2);
    for (let y = 0; y < h; y++) {
      const fy = Math.min(sh - 1.001, ((y + 0.5) * sh) / h - 0.5);
      const y0 = Math.max(0, Math.floor(fy));
      const ty = Math.max(0, fy - y0);
      for (let x = 0; x < w; x++) {
        const fx = Math.min(sw - 1.001, ((x + 0.5) * sw) / w - 0.5);
        const x0 = Math.max(0, Math.floor(fx));
        const tx = Math.max(0, fx - x0);
        const i = y * w + x;
        for (let c = 0; c < 3; c++) {
          const s = k.c[c];
          const a = s[y0 * sw + x0] + (s[y0 * sw + x0 + 1] - s[y0 * sw + x0]) * tx;
          const b = s[(y0 + 1) * sw + x0] + (s[(y0 + 1) * sw + x0 + 1] - s[(y0 + 1) * sw + x0]) * tx;
          t.c[c][i] = a + (b - a) * ty;
        }
      }
    }
  }
  return t;
}

/* ------------------------------------------------------------------ kâğıt (3B ızgara) */

export interface Bukulme {
  /** Yana oluk: uzun kenarlar kameraya doğru kalkar (kâğıt eninin oranı) */
  capraz: number;
  /** Alt uç kalkar (kâğıt boyunun oranı; son %30'da) */
  ucAlt: number;
  /** Üst uç kalkar */
  ucUst: number;
  /** Boyuna eğrilik (A4 hafif bükülmüş) */
  boyuna: number;
  /** Buruşukluk dalgası (kâğıt eninin oranı) */
  dalga: number;
  dalgaSayi: number;
  dalgaFaz: number;
}

const DUZ: Bukulme = { capraz: 0, ucAlt: 0, ucUst: 0, boyuna: 0, dalga: 0, dalgaSayi: 1, dalgaFaz: 0 };

export interface Poz {
  /** Derece: x ekseni (üst-alt perspektif), y ekseni (sağ-sol), görüntü düzleminde dönüş */
  pitch: number;
  yaw: number;
  roll: number;
  tx: number;
  ty: number;
  D: number;
}

interface Kamera {
  f: number;
  cx: number;
  cy: number;
}

interface Izgara {
  gu: number;
  gv: number;
  /** ekran konumu */
  x: Float64Array;
  y: Float64Array;
  /** ışık çarpanı */
  s: Float64Array;
}

/** Kâğıdın yerel noktası → dünya → ekran */
function donusum(p: Poz) {
  const a = (p.pitch * Math.PI) / 180;
  const b = (p.yaw * Math.PI) / 180;
  const g = (p.roll * Math.PI) / 180;
  const [ca, sa, cb, sb, cg, sg] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(g), Math.sin(g)];
  // R = Rz(g) · Ry(b) · Rx(a)
  const Rx = [1, 0, 0, 0, ca, -sa, 0, sa, ca];
  const Ry = [cb, 0, sb, 0, 1, 0, -sb, 0, cb];
  const Rz = [cg, -sg, 0, sg, cg, 0, 0, 0, 1];
  const m = (A: number[], B: number[]) => {
    const o = new Array<number>(9).fill(0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
    return o;
  };
  const R = m(Rz, m(Ry, Rx));
  return (X: number, Y: number, Z: number): [number, number, number] => [
    R[0] * X + R[1] * Y + R[2] * Z + p.tx,
    R[3] * X + R[4] * Y + R[5] * Z + p.ty,
    R[6] * X + R[7] * Y + R[8] * Z + p.D,
  ];
}

/** Kâğıt yüzeyinin kameraya doğru kalkışı (u, v ∈ 0–1; birim: kâğıt pikseli) */
function kalkis(bk: Bukulme, Wp: number, Hp: number, u: number, v: number): number {
  const cu = 2 * u - 1;
  const cv = 2 * v - 1;
  let z = Wp * bk.capraz * cu * cu + Hp * bk.boyuna * cv * cv;
  if (v > 0.7) z += Hp * bk.ucAlt * ((v - 0.7) / 0.3) ** 2;
  if (v < 0.3) z += Hp * bk.ucUst * ((0.3 - v) / 0.3) ** 2;
  z += Wp * bk.dalga * Math.sin(2 * Math.PI * v * bk.dalgaSayi + bk.dalgaFaz) * (0.6 + 0.4 * Math.cos(Math.PI * cu));
  return z;
}

/** Işık yönü (kameradan kâğıda bakan yüzeye; normalleştirilmiş) */
interface Isik {
  L: [number, number, number];
  ortam: number;
}

function izgaraKur(
  poz: Poz,
  kam: Kamera,
  Wp: number,
  Hp: number,
  bk: Bukulme,
  isik: Isik,
  gu: number,
  gv: number,
  yerel?: (u: number, v: number) => [number, number, number],
): Izgara {
  const T = donusum(poz);
  const n = (gu + 1) * (gv + 1);
  const wx = new Float64Array(n);
  const wy = new Float64Array(n);
  const wz = new Float64Array(n);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const s = new Float64Array(n);
  for (let j = 0; j <= gv; j++) {
    for (let i = 0; i <= gu; i++) {
      const u = i / gu;
      const v = j / gv;
      const [X, Y, Z] = yerel ? yerel(u, v) : [(u - 0.5) * Wp, (v - 0.5) * Hp, -kalkis(bk, Wp, Hp, u, v)];
      const [a, b, c] = T(X, Y, Z);
      const k = j * (gu + 1) + i;
      wx[k] = a;
      wy[k] = b;
      wz[k] = c;
      x[k] = kam.cx + (kam.f * a) / c;
      y[k] = kam.cy + (kam.f * b) / c;
    }
  }
  // ışık: yüzey normali (komşu farkları), düz kâğıda göre oran
  const [n0x, n0y, n0z] = (() => {
    const [a0, b0, c0] = T(0, 0, 0);
    const [a1, b1, c1] = T(1, 0, 0);
    const [a2, b2, c2] = T(0, 1, 0);
    // kameraya bakan normal (kamera −Z yönünde)
    return norm(cross([a2 - a0, b2 - b0, c2 - c0], [a1 - a0, b1 - b0, c1 - c0]));
  })();
  const dz = (nx: number, ny: number, nz: number) => {
    // kameraya bakan yüz
    const sgn = nx * n0x + ny * n0y + nz * n0z < 0 ? -1 : 1;
    const d = sgn * (nx * isik.L[0] + ny * isik.L[1] + nz * isik.L[2]);
    return isik.ortam + (1 - isik.ortam) * Math.max(0, d);
  };
  const duz = Math.max(0.05, dz(n0x, n0y, n0z));
  for (let j = 0; j <= gv; j++) {
    for (let i = 0; i <= gu; i++) {
      const k = j * (gu + 1) + i;
      const kx1 = j * (gu + 1) + Math.min(gu, i + 1);
      const kx0 = j * (gu + 1) + Math.max(0, i - 1);
      const ky1 = Math.min(gv, j + 1) * (gu + 1) + i;
      const ky0 = Math.max(0, j - 1) * (gu + 1) + i;
      const [nx, ny, nz] = norm(cross([wx[kx1] - wx[kx0], wy[kx1] - wy[kx0], wz[kx1] - wz[kx0]], [wx[ky1] - wx[ky0], wy[ky1] - wy[ky0], wz[ky1] - wz[ky0]]));
      s[k] = sinirla(dz(nx, ny, nz) / duz, 0.55, 1.15);
    }
  }
  return { gu, gv, x, y, s };
}

function cross(a: number[], b: number[]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a: [number, number, number]): [number, number, number] {
  const L = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / L, a[1] / L, a[2] / L];
}

/** Izgaranın üçgenlerini tarar; her pikselde kâğıt koordinatı (u, v) ve ışık çarpanıyla çağırır */
function izgaraTara(
  g: Izgara,
  W: number,
  H: number,
  hucreSec: ((i: number, j: number) => boolean) | null,
  cb: (idx: number, u: number, v: number, s: number) => void,
): void {
  const { gu, gv, x, y, s } = g;
  for (let j = 0; j < gv; j++) {
    for (let i = 0; i < gu; i++) {
      if (hucreSec && !hucreSec(i, j)) continue;
      const a = j * (gu + 1) + i;
      const b = a + 1;
      const c = a + gu + 2;
      const d = a + gu + 1;
      const ua = i / gu;
      const ub = (i + 1) / gu;
      const va = j / gv;
      const vb = (j + 1) / gv;
      ucgen(W, H, x[a], y[a], ua, va, s[a], x[b], y[b], ub, va, s[b], x[c], y[c], ub, vb, s[c], cb);
      ucgen(W, H, x[a], y[a], ua, va, s[a], x[c], y[c], ub, vb, s[c], x[d], y[d], ua, vb, s[d], cb);
    }
  }
}

function ucgen(
  W: number,
  H: number,
  ax: number,
  ay: number,
  au: number,
  av: number,
  as: number,
  bx: number,
  by: number,
  bu: number,
  bv: number,
  bs: number,
  cx: number,
  cy: number,
  cu: number,
  cv: number,
  cs: number,
  cb: (idx: number, u: number, v: number, s: number) => void,
): void {
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1e-9) return;
  const inv = 1 / area;
  const x0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx)));
  const x1 = Math.min(W - 1, Math.floor(Math.max(ax, bx, cx)));
  const y0 = Math.max(0, Math.ceil(Math.min(ay, by, cy)));
  const y1 = Math.min(H - 1, Math.floor(Math.max(ay, by, cy)));
  const e = -1e-7;
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * inv;
      if (w0 < e) continue;
      const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * inv;
      if (w1 < e) continue;
      const w2 = 1 - w0 - w1;
      if (w2 < e) continue;
      cb(py * W + px, w0 * au + w1 * bu + w2 * cu, w0 * av + w1 * bv + w2 * cv, w0 * as + w1 * bs + w2 * cs);
    }
  }
}

/* ------------------------------------------------------------------ plan */

export interface SahneGirdisi {
  W: number;
  H: number;
  zemin: Zemin;
  durum: Durum;
  /** Kâğıdın eni / boyu (dokunun oranı) */
  oran: number;
  /** Termal rulo (kıvrılma, soluk baskı olasılığı) */
  termal: boolean;
  /** Belge olmayan nesne (saydam doku; kıvrık köşe, soluk baskı yok) */
  nesne: boolean;
  /** Dar uzun fiş için yatay kare ve yana dönük çekim olabilir */
  yanOlabilir?: boolean;
}

export interface KoseKatlama {
  /** 0 sol üst, 1 sağ üst, 2 sağ alt, 3 sol alt */
  kose: number;
  /** katlanan uzunluk (kısa kenarın oranı) */
  oran: number;
}

export interface Etkiler {
  golge: { k: number; sigma: number; dx: number; dy: number } | null;
  degrade: { aci: number; k: number; t0: number; t1: number } | null;
  elGolgesi: { cx: number; cy: number; rx: number; ry: number; aci: number; k: number } | null;
  renk: [number, number, number] | null;
  parlama: { cx: number; cy: number; sx: number; sy: number; aci: number; A: number } | null;
  pozlama: number;
  gama: number;
  vinyet: number;
  bulanik: { tur: "optik" | "odak"; sigma: number } | { tur: "hareket"; uzunluk: number; aci: number };
  gurultu: number;
  soluk: { lo: number; hi: number } | null;
  murekkep: number;
  el: { kenar: number; t: number; r: number; renk: [number, number, number] } | null;
}

export interface SahnePlani {
  girdi: SahneGirdisi;
  W: number;
  H: number;
  kam: Kamera;
  poz: Poz;
  bk: Bukulme;
  isik: Isik;
  kat: KoseKatlama | null;
  etki: Etkiler;
  /** Doğru köşeler (sıralı: sol üst, sağ üst, sağ alt, sol alt; kâğıdın kendi köşeleri); belge değilse null */
  koseler: Quad | null;
  /** Senaryo etiketleri (kırılım için) */
  etiketler: string[];
  /** Kâğıdın izdüşümündeki uzun kenar (px): dokunun küçültüleceği boy */
  dokuBoyu: number;
  tohum: number;
}

const Wp0 = (oran: number) => 1000 * oran;
const Hp0 = 1000;

function izgaraBoyu(oran: number): { gu: number; gv: number } {
  const gu = 24;
  return { gu, gv: Math.max(24, Math.min(170, Math.round(gu / oran))) };
}

/** Ekrandaki dört köşe (ızgaranın köşe noktaları) */
function koseNoktalari(g: Izgara): Quad {
  const k = (i: number, j: number) => {
    const n = j * (g.gu + 1) + i;
    return { x: g.x[n], y: g.y[n] };
  };
  return [k(0, 0), k(g.gu, 0), k(g.gu, g.gv), k(0, g.gv)];
}

function sinirKutusu(g: Izgara): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < g.x.length; i++) {
    x0 = Math.min(x0, g.x[i]);
    x1 = Math.max(x1, g.x[i]);
    y0 = Math.min(y0, g.y[i]);
    y1 = Math.max(y1, g.y[i]);
  }
  return [x0, y0, x1, y1];
}

function icinde(q: readonly Point[], p: Point): boolean {
  let sgn = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const s = c > 0 ? 1 : -1;
    if (!sgn) sgn = s;
    else if (s !== sgn) return false;
  }
  return true;
}

/** a→b doğrusunun y = yy (ya da x = xx) doğrusunu kestiği nokta */
function kesisim(a: Point, b: Point, eksen: "x" | "y", deger: number): Point {
  if (eksen === "y") {
    const t = (deger - a.y) / (b.y - a.y);
    return { x: a.x + (b.x - a.x) * t, y: deger };
  }
  const t = (deger - a.x) / (b.x - a.x);
  return { x: deger, y: a.y + (b.y - a.y) * t };
}

/**
 * Sahneyi planlar: kamera, kâğıdın duruşu, bükülme, etkiler, doğru köşeler. Doku gerekmez (yalnız oranı); çizim
 * `sahneCiz` ile. Yerleştirilemezse (çok nadir) yeni rastgele değerlerle yeniden dener.
 */
export function sahnePlanla(girdi: SahneGirdisi, rnd: Rnd, tohum: number): SahnePlani {
  for (let deneme = 0; deneme < 40; deneme++) {
    const p = planDene(girdi, rnd, tohum);
    if (p) return p;
  }
  throw new Error(`sahne yerleştirilemedi (tohum ${tohum})`);
}

function planDene(girdi: SahneGirdisi, rnd: Rnd, tohum: number): SahnePlani | null {
  const { W, H, durum, oran, termal, nesne } = girdi;
  const etiketler: string[] = [];
  const kam: Kamera = { f: ara(rnd, 0.78, 1.15) * Math.max(W, H), cx: (W - 1) / 2, cy: (H - 1) / 2 };
  const Wp = Wp0(oran);
  const Hp = Hp0;
  // duruş
  const guclu = durum === "normal" && rnd() < 0.3;
  const egim = durum === "yakin" ? 8 : guclu ? 34 : 18;
  let pitch = ara(rnd, -egim, egim);
  const yaw = ara(rnd, -egim * 0.7, egim * 0.7);
  if (guclu) {
    pitch = (rnd() < 0.5 ? -1 : 1) * ara(rnd, 22, 36);
    etiketler.push("perspektif-guclu");
  }
  let roll = sinirla(normal(rnd) * (durum === "yakin" ? 3 : 11), -32, 32);
  const yan = W > H;
  if (yan) {
    roll = (rnd() < 0.5 ? -90 : 90) + ara(rnd, -12, 12);
    etiketler.push("yan");
  }
  if (Math.abs(roll) > 18 && !yan) etiketler.push("donuk");
  // bükülme
  const bk: Bukulme = { ...DUZ, dalgaFaz: rnd() * 6.28, dalgaSayi: ara(rnd, 1.5, 5) };
  if (!nesne) {
    const kivir = durum === "kadraj-disi" ? 0.3 : termal ? 0.6 : 0.35;
    if (rnd() < kivir) {
      if (termal) {
        bk.capraz = ara(rnd, 0.02, durum === "normal" ? 0.09 : 0.03);
        if (durum === "normal" && rnd() < 0.6) bk.ucAlt = ara(rnd, 0.01, 0.06);
        if (durum === "normal" && rnd() < 0.3) bk.ucUst = ara(rnd, 0.01, 0.04);
        bk.dalga = rnd() < 0.5 ? ara(rnd, 0.004, 0.018) : 0;
      } else {
        bk.boyuna = ara(rnd, 0.008, 0.035);
        bk.capraz = rnd() < 0.4 ? ara(rnd, 0.005, 0.02) : 0;
        bk.dalga = rnd() < 0.3 ? ara(rnd, 0.002, 0.008) : 0;
      }
      etiketler.push("kivrilma");
    }
  }
  const isik: Isik = { L: norm([ara(rnd, -0.6, 0.6), ara(rnd, -0.8, 0.2), -1]), ortam: ara(rnd, 0.35, 0.6) };
  const { gu, gv } = izgaraBoyu(oran);
  const izg = (poz: Poz) => izgaraKur(poz, kam, Wp, Hp, bk, isik, gu, gv);
  // boyut: kâğıdın uzun kenarı karenin hangi boyutuna denk geliyor
  const uzunEkran = Math.abs(Math.cos((roll * Math.PI) / 180)) >= Math.abs(Math.sin((roll * Math.PI) / 180)) ? H : W;
  const kisaEkran = uzunEkran === H ? W : H;
  let s: number;
  if (durum === "yakin") s = 1;
  else if (durum === "kadraj-disi") s = ara(rnd, 0.85, 1.0);
  else if (nesne) s = ara(rnd, 0.45, 0.85);
  else s = termal ? ara(rnd, 0.6, 0.95) : ara(rnd, 0.5, 0.9);
  const poz: Poz = { pitch, yaw, roll, tx: 0, ty: 0, D: (kam.f * Hp) / (s * uzunEkran) };
  if (durum === "yakin") {
    // kâğıdın eni karenin kısa kenarından biraz geniş; boyu da kareyi aşıyor (yakın çekim)
    poz.D = (kam.f * Wp) / (kisaEkran * ara(rnd, 1.06, 1.25));
    if (oran > 0.5) poz.D = Math.min(poz.D, (kam.f * Hp) / (uzunEkran * ara(rnd, 1.06, 1.2)));
    const kayma = ara(rnd, -0.25, 0.25);
    poz.ty = (kayma * Hp * Math.cos((roll * Math.PI) / 180)) / 2;
    poz.tx = (-kayma * Hp * Math.sin((roll * Math.PI) / 180)) / 2;
    const kare: Quad = [
      { x: 0, y: 0 },
      { x: W - 1, y: 0 },
      { x: W - 1, y: H - 1 },
      { x: 0, y: H - 1 },
    ];
    for (let k = 0; k < 30; k++) {
      const g = izg(poz);
      const q = koseNoktalari(g);
      if (kare.every((p) => icinde(q, p))) {
        etiketler.push("yakin");
        return son(girdi, rnd, tohum, kam, poz, bk, isik, g, kare, etiketler);
      }
      poz.D *= 0.95;
      poz.tx *= 0.8;
      poz.ty *= 0.8;
    }
    return null;
  }
  // normal: kâğıdın tamamı karede, kenarlardan en az %2 içeride; önce sığdır, sonra ortala ve biraz kaydır
  const m = 0.02 * Math.min(W, H);
  const ox = ara(rnd, -0.35, 0.35);
  const oy = ara(rnd, -0.35, 0.35);
  let g = izg(poz);
  for (let k = 0; k < 40; k++) {
    g = izg(poz);
    const [x0, y0, x1, y1] = sinirKutusu(g);
    const bw = x1 - x0;
    const bh = y1 - y0;
    const aw = W - 1 - 2 * m;
    const ah = H - 1 - 2 * m;
    if (bw > aw || bh > ah) {
      poz.D *= Math.max(bw / aw, bh / ah) * 1.01;
      continue;
    }
    // boşluğun içinde rastgele konum
    const hedefX = m + (aw - bw) * (0.5 + ox) + bw / 2;
    const hedefY = m + (ah - bh) * (0.5 + oy) + bh / 2;
    const dx = hedefX - (x0 + x1) / 2;
    const dy = hedefY - (y0 + y1) / 2;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break;
    poz.tx += (dx * poz.D) / kam.f;
    poz.ty += (dy * poz.D) / kam.f;
  }
  g = izg(poz);
  const [bx0, by0, bx1, by1] = sinirKutusu(g);
  if (bx0 < m - 1 || by0 < m - 1 || bx1 > W - m || by1 > H - m) return null;
  let koseler = koseNoktalari(g);
  if (durum === "kadraj-disi") {
    // kâğıdın bir kısa kenarı (üst ya da alt) karenin dışına: kâğıdın boyu yönünde kaydır
    const ust = rnd() < 0.5;
    const [a, b, c, d] = koseler;
    const disaUc = ust ? [a, b] : [c, d];
    const ici = ust ? [d, c] : [b, a];
    // kâğıdın boyu yönü ekranda (içeriden dışarı)
    const yx = (disaUc[0].x + disaUc[1].x - ici[0].x - ici[1].x) / 2;
    const yy = (disaUc[0].y + disaUc[1].y - ici[0].y - ici[1].y) / 2;
    const dikey = Math.abs(yy) >= Math.abs(yx);
    const eksen: "x" | "y" = dikey ? "y" : "x";
    const yon = dikey ? Math.sign(yy) : Math.sign(yx);
    const sinir = dikey ? (yon < 0 ? 0 : H - 1) : yon < 0 ? 0 : W - 1;
    const boy = Math.hypot(yx, yy);
    const tasma = ara(rnd, 0.05, 0.18) * boy;
    // dışarıdaki iki köşeden sınıra en yakın olanı da sınırın `tasma` kadar ötesine geçsin
    for (let k = 0; k < 6; k++) {
      const q = koseNoktalari(izg(poz));
      const dis = ust ? [q[0], q[1]] : [q[2], q[3]];
      const deg = dis.map((p) => (eksen === "y" ? p.y : p.x));
      const enYakin = yon < 0 ? Math.max(...deg) : Math.min(...deg);
      const gerek = yon < 0 ? sinir - tasma - enYakin : sinir + tasma - enYakin;
      if (Math.abs(gerek) < 0.5) break;
      if (eksen === "y") poz.ty += (gerek * poz.D) / kam.f;
      else poz.tx += (gerek * poz.D) / kam.f;
    }
    g = izg(poz);
    const q = koseNoktalari(g);
    const dis = ust ? [0, 1] : [2, 3];
    const ic = ust ? [3, 2] : [1, 0];
    // içerideki iki köşe karede kalmalı (en az %2), yan kenarlar sınırı karenin içinde kesmeli
    for (const i of ic) if (q[i].x < m || q[i].y < m || q[i].x > W - 1 - m || q[i].y > H - 1 - m) return null;
    const yeni = [...q] as Quad;
    for (let k = 0; k < 2; k++) {
      const p = kesisim(q[ic[k]], q[dis[k]], eksen, sinir);
      const diger = eksen === "y" ? p.x : p.y;
      if (diger < 0 || diger > (eksen === "y" ? W - 1 : H - 1)) return null;
      yeni[dis[k]] = p;
    }
    koseler = yeni;
    etiketler.push("kadraj-disi");
  }
  return son(girdi, rnd, tohum, kam, poz, bk, isik, g, nesne ? null : koseler, etiketler);
}

function son(
  girdi: SahneGirdisi,
  rnd: Rnd,
  tohum: number,
  kam: Kamera,
  poz: Poz,
  bk: Bukulme,
  isik: Isik,
  g: Izgara,
  koseler: Quad | null,
  etiketler: string[],
): SahnePlani {
  const { W, H, zemin, termal, nesne, durum } = girdi;
  const q = koseNoktalari(g);
  const dokuBoyu = Math.ceil(Math.max(Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y), Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y)) * 1.2);
  const kat: KoseKatlama | null = !nesne && durum !== "yakin" && rnd() < 0.2 ? { kose: Math.floor(rnd() * 4), oran: ara(rnd, 0.12, 0.3) } : null;
  if (kat) etiketler.push("kivrik-kose");
  const mx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const my = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  const kisa = Math.min(W, H);
  const etki: Etkiler = {
    golge: zemin === "elde" ? null : { k: ara(rnd, 0.18, 0.5), sigma: ara(rnd, 3, 14), dx: ara(rnd, -10, 10), dy: ara(rnd, 2, 14) },
    degrade: rnd() < 0.35 ? { aci: rnd() * 6.28, k: ara(rnd, 0.22, 0.5), t0: ara(rnd, 0.1, 0.4), t1: ara(rnd, 0.6, 1) } : null,
    elGolgesi:
      rnd() < 0.2
        ? { cx: mx + ara(rnd, -0.3, 0.3) * W, cy: my + ara(rnd, -0.3, 0.3) * H, rx: ara(rnd, 0.22, 0.45) * W, ry: ara(rnd, 0.18, 0.35) * H, aci: rnd() * 3.14, k: ara(rnd, 0.3, 0.55) }
        : null,
    renk:
      rnd() < 0.35
        ? sec(rnd, [
            [1.0, 0.9, 0.72],
            [0.88, 0.96, 1.06],
            [0.92, 1.0, 0.86],
            [1.0, 0.95, 0.8],
            [1.04, 0.92, 0.9],
          ] as [number, number, number][])
        : null,
    parlama:
      rnd() < 0.2
        ? { cx: mx + ara(rnd, -0.15, 0.15) * W, cy: my + ara(rnd, -0.2, 0.2) * H, sx: ara(rnd, 0.05, 0.14) * kisa, sy: ara(rnd, 0.03, 0.09) * kisa, aci: rnd() * 3.14, A: ara(rnd, 0.6, 0.95) }
        : null,
    pozlama: 1,
    gama: 1,
    vinyet: ara(rnd, 0.04, 0.22),
    bulanik: { tur: "optik", sigma: ara(rnd, 0.5, 0.9) },
    gurultu: ara(rnd, 1.5, 5),
    soluk: termal && rnd() < 0.3 ? { lo: ara(rnd, 0.22, 0.45), hi: ara(rnd, 0.55, 0.9) } : null,
    murekkep: termal ? ara(rnd, 0.8, 1) : 1,
    el: null,
  };
  const b = rnd();
  if (b < 0.12) etki.bulanik = { tur: "hareket", uzunluk: ara(rnd, 5, 16) * (kisa / 1500), aci: rnd() * 3.14 };
  else if (b < 0.24) etki.bulanik = { tur: "odak", sigma: ara(rnd, 1.6, 3.4) * (kisa / 1500) };
  if (rnd() < 0.15) {
    etki.pozlama = ara(rnd, 0.5, 0.75);
    etki.gama = ara(rnd, 1.05, 1.3);
    etki.gurultu += ara(rnd, 2, 5);
    etiketler.push("karanlik");
  }
  if (rnd() < 0.22) etki.gurultu = ara(rnd, 6, 11);
  if (zemin === "elde") etki.el = { kenar: sec(rnd, [1, 2, 3]), t: ara(rnd, 0.3, 0.7), r: ara(rnd, 0.03, 0.048) * kisa, renk: [ara(rnd, 190, 228), ara(rnd, 140, 182), ara(rnd, 112, 150)] };
  if (etki.degrade) etiketler.push("golge-degrade");
  if (etki.elGolgesi) etiketler.push("el-golgesi");
  if (etki.renk) etiketler.push("renkli-isik");
  if (etki.parlama) etiketler.push("parlama");
  if (etki.bulanik.tur === "hareket") etiketler.push("hareket");
  if (etki.bulanik.tur === "odak") etiketler.push("odak");
  if (etki.gurultu > 6) etiketler.push("gurultu");
  if (etki.soluk) etiketler.push("soluk");
  return { girdi, W, H, kam, poz, bk, isik, kat, etki, koseler, etiketler, dokuBoyu, tohum };
}

/* ------------------------------------------------------------------ çizim */

/** Kapsül (yuvarlak uçlu kalın çizgi): ten rengi, ortası açık; kenar yumuşak */
function kapsul(t: Tuval, ax: number, ay: number, bx: number, by: number, r: number, renk: readonly number[]): void {
  const { w, h } = t;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 2));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r + 2));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 2));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r + 2));
  const vx = bx - ax;
  const vy = by - ay;
  const L2 = vx * vx + vy * vy || 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const tt = sinirla(((x - ax) * vx + (y - ay) * vy) / L2, 0, 1);
      const d = Math.hypot(x - ax - vx * tt, y - ay - vy * tt);
      const a = sinirla(r - d + 0.5, 0, 1);
      if (a <= 0) continue;
      const sh = 0.72 + 0.28 * Math.sqrt(Math.max(0, 1 - (d / r) ** 2));
      const i = y * w + x;
      for (let c = 0; c < 3; c++) t.c[c][i] = t.c[c][i] * (1 - a) + renk[c] * sh * a;
    }
  }
}

/**
 * Sahneyi çizer: zemin, (elde) avuç, kâğıdın gölgesi, kâğıt (dokudan, ızgarayla), kıvrık köşe, başparmak, ışık
 * etkileri, bulanıklık, gürültü. Döner: RGB (Uint8, satır satır).
 */
export function sahneCiz(p: SahnePlani, doku: Doku, rnd: Rnd): Uint8Array {
  const { W, H, kam, poz, bk, isik, kat, etki } = p;
  const { oran, zemin, nesne } = p.girdi;
  const t = zeminUret(zemin, W, H, rnd);
  const Wp = Wp0(oran);
  const Hp = Hp0;
  const { gu, gv } = izgaraBoyu(oran);
  const g = izgaraKur(poz, kam, Wp, Hp, bk, isik, gu, gv);
  const q = koseNoktalari(g);
  // el: avuç kâğıdın arkasında (kenarın dışına doğru), başparmak önünde
  let parmak: [number, number, number, number] | null = null;
  if (etki.el) {
    const k = etki.el.kenar;
    const a = q[k];
    const b = q[(k + 1) % 4];
    const px = a.x + (b.x - a.x) * etki.el.t;
    const py = a.y + (b.y - a.y) * etki.el.t;
    const mx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
    const my = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
    let nx = mx - px;
    let ny = my - py;
    const L = Math.hypot(nx, ny) || 1;
    nx /= L;
    ny /= L;
    const r = etki.el.r;
    kapsul(t, px - nx * r * 0.5, py - ny * r * 0.5, px - nx * W * 1.2, py - ny * W * 1.2, r * 2.6, etki.el.renk);
    parmak = [px - nx * r * 0.8, py - ny * r * 0.8, px + nx * r * 2.6, py + ny * r * 2.6];
  }
  // kâğıt katmanı (RGBA; üst üste çizimde son yazan geçerli)
  const kat4 = new Float32Array(W * H * 4);
  const tw = doku.width;
  const th = doku.height;
  const td = doku.data;
  const kf = new Kafes(rnd);
  const solukOran = oran;
  const koseIci = kat ? katlamaTesti(kat, Wp, Hp) : null;
  const ornek = (u: number, v: number, out: Float32Array) => {
    const fx = sinirla(u * (tw - 1), 0, tw - 1);
    const fy = sinirla(v * (th - 1), 0, th - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(tw - 1, x0 + 1);
    const y1 = Math.min(th - 1, y0 + 1);
    const ax = fx - x0;
    const ay = fy - y0;
    for (let c = 0; c < 4; c++) {
      const a = td[(y0 * tw + x0) * 4 + c] + (td[(y0 * tw + x1) * 4 + c] - td[(y0 * tw + x0) * 4 + c]) * ax;
      const b = td[(y1 * tw + x0) * 4 + c] + (td[(y1 * tw + x1) * 4 + c] - td[(y1 * tw + x0) * 4 + c]) * ax;
      out[c] = a + (b - a) * ay;
    }
  };
  const px4 = new Float32Array(4);
  izgaraTara(g, W, H, null, (idx, u, v, s) => {
    if (koseIci && koseIci(u, v)) return;
    ornek(u, v, px4);
    const a = px4[3] / 255;
    if (a <= 0.003) return;
    let solma = etki.murekkep;
    if (etki.soluk) solma *= etki.soluk.lo + (etki.soluk.hi - etki.soluk.lo) * kf.fbm(u * 5, (v * 5) / solukOran, 3);
    const o = idx * 4;
    for (let c = 0; c < 3; c++) {
      const v0 = nesne ? px4[c] : 255 - (255 - px4[c]) * solma;
      kat4[o + c] = v0 * s;
    }
    kat4[o + 3] = a;
  });
  if (kat && koseIci) {
    // kıvrık köşe: köşe üçgeni katlama çizgisine göre yansıtılır, kâğıdın arka yüzü (yazısız, biraz gölgeli) görünür
    const yans = yansitma(kat, Wp, Hp);
    const ust = 0.006 * Hp;
    const gk = izgaraKur(poz, kam, Wp, Hp, bk, isik, gu * 2, gv * 2, (u, v) => {
      const [X, Y] = yans((u - 0.5) * Wp, (v - 0.5) * Hp);
      const uu = sinirla(X / Wp + 0.5, 0, 1);
      const vv = sinirla(Y / Hp + 0.5, 0, 1);
      return [X, Y, -kalkis(bk, Wp, Hp, uu, vv) - ust];
    });
    const arka = p.girdi.termal ? [236, 234, 226] : [242, 242, 240];
    const ku = kat.kose === 1 || kat.kose === 2 ? 1 : 0;
    const kv = kat.kose >= 2 ? 1 : 0;
    const sinirUV = kat.oran * Math.min(Wp, Hp) * 1.2;
    izgaraTara(
      gk,
      W,
      H,
      (i, j) => Math.abs(i / (gu * 2) - ku) * Wp < sinirUV + Wp / gu && Math.abs(j / (gv * 2) - kv) * Hp < sinirUV + Hp / gv,
      (idx, u, v, s) => {
        if (!koseIci(u, v)) return;
        const o = idx * 4;
        for (let c = 0; c < 3; c++) kat4[o + c] = arka[c] * s * 0.9;
        kat4[o + 3] = 1;
      },
    );
  }
  // kâğıdın zemine düşen gölgesi
  if (etki.golge) {
    const maske = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) maske[i] = kat4[i * 4 + 3];
    const bul = gauss1(maske, W, H, etki.golge.sigma);
    const dx = Math.round(etki.golge.dx);
    const dy = Math.round(etki.golge.dy);
    for (let y = 0; y < H; y++) {
      const sy = y - dy;
      if (sy < 0 || sy >= H) continue;
      for (let x = 0; x < W; x++) {
        const sx = x - dx;
        if (sx < 0 || sx >= W) continue;
        const f = 1 - etki.golge.k * bul[sy * W + sx];
        const i = y * W + x;
        t.c[0][i] *= f;
        t.c[1][i] *= f;
        t.c[2][i] *= f;
      }
    }
  }
  for (let i = 0; i < W * H; i++) {
    const a = kat4[i * 4 + 3];
    if (a <= 0) continue;
    for (let c = 0; c < 3; c++) t.c[c][i] = t.c[c][i] * (1 - a) + kat4[i * 4 + c] * a;
  }
  if (parmak && etki.el) kapsul(t, parmak[0], parmak[1], parmak[2], parmak[3], etki.el.r, etki.el.renk);
  // ışık
  const [R, G, B] = t.c;
  const yogunluk = new Float32Array(W * H).fill(1);
  if (etki.degrade) {
    const { aci, k, t0, t1 } = etki.degrade;
    const ca = Math.cos(aci);
    const sa = Math.sin(aci);
    const ucl = [0, W - 1].flatMap((x) => [0, H - 1].map((y) => x * ca + y * sa));
    const lo = Math.min(...ucl);
    const hi = Math.max(...ucl);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) yogunluk[y * W + x] *= 1 - k * yumusak(t0, t1, (x * ca + y * sa - lo) / (hi - lo));
  }
  if (etki.elGolgesi) {
    const { cx, cy, rx, ry, aci, k } = etki.elGolgesi;
    const ca = Math.cos(aci);
    const sa = Math.sin(aci);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = ((x - cx) * ca + (y - cy) * sa) / rx;
        const v = (-(x - cx) * sa + (y - cy) * ca) / ry;
        const e = Math.sqrt(u * u + v * v);
        if (e < 1.05) yogunluk[y * W + x] *= 1 - k * yumusak(1.05, 0.7, e);
      }
    }
  }
  const renk = etki.renk ?? [1, 1, 1];
  const rmax = Math.hypot(W / 2, H / 2);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const vin = 1 - etki.vinyet * (Math.hypot(x - W / 2, y - H / 2) / rmax) ** 2;
      const f = yogunluk[i] * vin * etki.pozlama;
      R[i] *= f * renk[0];
      G[i] *= f * renk[1];
      B[i] *= f * renk[2];
    }
  }
  if (etki.parlama) {
    const { cx, cy, sx, sy, aci, A } = etki.parlama;
    const ca = Math.cos(aci);
    const sa = Math.sin(aci);
    const x0 = Math.max(0, Math.floor(cx - 4 * Math.max(sx, sy)));
    const x1 = Math.min(W - 1, Math.ceil(cx + 4 * Math.max(sx, sy)));
    const y0 = Math.max(0, Math.floor(cy - 4 * Math.max(sx, sy)));
    const y1 = Math.min(H - 1, Math.ceil(cy + 4 * Math.max(sx, sy)));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const u = ((x - cx) * ca + (y - cy) * sa) / sx;
        const v = (-(x - cx) * sa + (y - cy) * ca) / sy;
        const gg = A * Math.exp(-(u * u + v * v) / 2);
        const i = y * W + x;
        R[i] += (255 - R[i]) * gg;
        G[i] += (255 - G[i]) * gg;
        B[i] += (255 - B[i]) * gg;
      }
    }
  }
  if (etki.gama !== 1) {
    for (let k = 0; k < 3; k++) {
      const a = t.c[k];
      for (let i = 0; i < a.length; i++) a[i] = 255 * Math.pow(sinirla(a[i], 0, 255) / 255, etki.gama);
    }
  }
  // kamera: bulanıklık, gürültü
  if (etki.bulanik.tur === "hareket") {
    hareketBulanik(t, etki.bulanik.uzunluk, etki.bulanik.aci);
    tuvalGauss(t, 0.5);
  } else tuvalGauss(t, etki.bulanik.sigma);
  const out = new Uint8Array(W * H * 3);
  const sg = etki.gurultu;
  for (let i = 0; i < W * H; i++) {
    const lum = (t.c[0][i] + t.c[1][i] + t.c[2][i]) / 3;
    // karanlıkta gürültü göreli olarak büyük (foton gürültüsü + okuma gürültüsü)
    const n = normal(rnd) * sg * (0.6 + 0.4 * Math.sqrt(Math.max(0, 255 - lum) / 255));
    for (let c = 0; c < 3; c++) out[i * 3 + c] = sinirla(Math.round(t.c[c][i] + n + normal(rnd) * sg * 0.35), 0, 255);
  }
  return out;
}

/** Kâğıt koordinatı (u, v) katlanan köşe üçgeninde mi */
function katlamaTesti(kat: KoseKatlama, Wp: number, Hp: number): (u: number, v: number) => boolean {
  const d = kat.oran * Math.min(Wp, Hp);
  const ku = kat.kose === 1 || kat.kose === 2 ? 1 : 0;
  const kv = kat.kose >= 2 ? 1 : 0;
  return (u, v) => (Math.abs(u - ku) * Wp + Math.abs(v - kv) * Hp) / d < 1;
}

/** Katlama çizgisine göre yansıtma (kâğıdın yerel koordinatında, merkez 0) */
function yansitma(kat: KoseKatlama, Wp: number, Hp: number): (X: number, Y: number) => [number, number] {
  const d = kat.oran * Math.min(Wp, Hp);
  const ku = kat.kose === 1 || kat.kose === 2 ? 1 : 0;
  const kv = kat.kose >= 2 ? 1 : 0;
  const Xc = (ku - 0.5) * Wp;
  const Yc = (kv - 0.5) * Hp;
  const sx = ku ? -1 : 1;
  const sy = kv ? -1 : 1;
  // çizgi köşeden (sx·d, 0) ve (0, sy·d) uzaklıktaki iki noktadan geçer; normali (sx, sy)/√2
  const P1x = Xc + sx * d;
  const P1y = Yc;
  const nx = sx / Math.SQRT2;
  const ny = sy / Math.SQRT2;
  return (X, Y) => {
    const k = (X - P1x) * nx + (Y - P1y) * ny;
    return [X - 2 * k * nx, Y - 2 * k * ny];
  };
}
