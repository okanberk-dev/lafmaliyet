/**
 * Taranmış görünüm (CamScanner tarzı) ve eğiklik ölçümü. Modlar:
 * - "belge": aydınlatma haritası düşük çözünürlükte kestirilir (kapama: yazı silinir, gölge kenarı yerinde kalır), her
 *   renk kanalı ona bölünür (gölge, sarı ışık, renkli kâğıt gider). Gri ton = parlaklık + en koyu kanal (mavi tükenmez,
 *   kırmızı kaşe koyu çıkar). Mürekkep koyuluğu her görüntüde ölçülen iki eşik arasında yumuşakça açılır: kâğıt
 *   gürültüsünün altı bembeyaz, belgenin tipik mürekkebi koyu. Siyah eşiği bölge bölge de ölçülür: soluk termal baskı
 *   olan yerde eşik iner, yazı yine koyu çıkar. Tek başına benekler silinir, hafif keskinlik verilir.
 * - "gri": aynı aydınlatma düzeltmesi, eşiksiz normalize gri.
 * - "renkli": aydınlatma düzeltmesi (kâğıt nötr beyaz olur: beyaz dengesi) ve karşıtlık.
 * - "orijinal": dokunulmaz (yalnız perspektif düzeltmesi).
 *
 * Tam çözünürlükte az geçiş: histogramlar görüntüyle aynı geçişte toplanır, eşikler düşük çözünürlüklü haritadan
 * satır satır çift doğrusal okunur. Saf; testleri tests/tarama-iyilestirme.test.ts.
 */

import type { GrayImage, RgbaImage } from "./image";
import { boxMean, createRgba, fitSize, gaussianBlur, histogram, histPercentile, maxFilter, minFilter, resizeRgba, toGray } from "./image";

export type ScanMode = "belge" | "gri" | "renkli" | "orijinal";

export const SCAN_MODES: readonly ScanMode[] = ["belge", "gri", "renkli", "orijinal"];

/** Aydınlatma haritası: kanal kanal kâğıdın yerel parlaklığı (düşük çözünürlükte) */
export interface Illumination {
  width: number;
  height: number;
  /** r, g, b (her biri width × height) */
  bg: [Float32Array, Float32Array, Float32Array];
  /** kâğıdın parlaklığı (kanal kanal, haritanın %95'liği) */
  paper: [number, number, number];
}

const MAP_EDGE = 400;
/** normalize gri histogramı: [0, 1,3) aralığında 260 kutu */
const GB = 260;
const GMAX = 1.3;

/** Kâğıdın yerel parlaklığı: kapama (en büyük → en küçük) ile yazı silinir, sonra yumuşatılır; kazanç ~2,6 katla sınırlı */
export function estimateIllumination(img: RgbaImage): Illumination {
  const sz = fitSize(img.width, img.height, MAP_EDGE);
  const small = resizeRgba(img, sz.width, sz.height);
  const n = sz.width * sz.height;
  const r = Math.max(2, Math.round(Math.sqrt(n) / 48));
  const bg: Float32Array[] = [];
  const paper: number[] = [];
  for (let ch = 0; ch < 3; ch++) {
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) c[i] = small.data[i * 4 + ch];
    const g: GrayImage = { width: sz.width, height: sz.height, data: c };
    const closed = minFilter(maxFilter(g, r), r);
    const smooth = gaussianBlur(closed, 1.5).data;
    const p = Math.max(16, histPercentile(histogram(smooth), 0.95));
    const floor = p * 0.38;
    for (let i = 0; i < n; i++) if (smooth[i] < floor) smooth[i] = floor;
    bg.push(smooth);
    paper.push(p);
  }
  return { width: sz.width, height: sz.height, bg: bg as Illumination["bg"], paper: paper as Illumination["paper"] };
}

/** Haritayı tam çözünürlüğe çift doğrusal taşımak için eksen ağırlıkları */
function upTaps(src: number, dst: number): { i0: Int32Array; i1: Int32Array; f: Float32Array } {
  const i0 = new Int32Array(dst);
  const i1 = new Int32Array(dst);
  const f = new Float32Array(dst);
  const r = src / dst;
  for (let i = 0; i < dst; i++) {
    const x = Math.max(0, Math.min(src - 1, (i + 0.5) * r - 0.5));
    const j = Math.floor(x);
    i0[i] = j;
    i1[i] = Math.min(src - 1, j + 1);
    f[i] = x - j;
  }
  return { i0, i1, f };
}

/** Haritanın bir satırını (dikey çift doğrusal) hazırlar: out[mx] */
function mapRow(map: Float32Array, mw: number, ty: { i0: Int32Array; i1: Int32Array; f: Float32Array }, y: number, out: Float32Array): void {
  const r0 = ty.i0[y] * mw;
  const r1 = ty.i1[y] * mw;
  const fy = ty.f[y];
  for (let x = 0; x < mw; x++) out[x] = map[r0 + x] + (map[r1 + x] - map[r0 + x]) * fy;
}

/** Haritayı (sw × sh) tam boyuta (W × H) çift doğrusal büyütür */
export function upsample(map: Float32Array, sw: number, sh: number, W: number, H: number): Float32Array {
  const tx = upTaps(sw, W);
  const ty = upTaps(sh, H);
  const row = new Float32Array(sw);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    mapRow(map, sw, ty, y, row);
    const o = y * W;
    for (let x = 0; x < W; x++) out[o + x] = row[tx.i0[x]] + (row[tx.i1[x]] - row[tx.i0[x]]) * tx.f[x];
  }
  return out;
}

/** Gürültü düzeyi (Immerkær, 1996), görüntünün ölçeğinde; büyük görüntüde satırlar seyreltilir */
export function noiseSigma(g: GrayImage, scale = 1): number {
  const { width: w, height: h, data } = g;
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let n = 0;
  const step = Math.max(1, Math.floor((w * h) / 300_000));
  for (let y = 1; y < h - 1; y += step) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v =
        data[i - w - 1] - 2 * data[i - w] + data[i - w + 1] - 2 * data[i - 1] + 4 * data[i] - 2 * data[i + 1] + data[i + w - 1] - 2 * data[i + w] + data[i + w + 1];
      sum += Math.abs(v);
      n++;
    }
  }
  return ((Math.sqrt(Math.PI / 2) * (sum / Math.max(1, n))) / 6) * scale;
}

/**
 * Aydınlatmaya bölünmüş gri ton (parlaklık %70 + en koyu kanal %30; kâğıt ≈ 1). `rgb` verilirse kanallar da yazılır
 * (renkli mod). Harita satır satır çift doğrusal okunur; tam boyutlu ara harita yok.
 */
function normalizedGray(img: RgbaImage, ill: Illumination, rgb?: Float32Array): Float32Array {
  const { width: W, height: H, data } = img;
  const mw = ill.width;
  const tx = upTaps(mw, W);
  const ty = upTaps(ill.height, H);
  // bölme yerine çarpma: haritanın tersi (yumuşak harita; tersin aradeğeri tersine çok yakın)
  const inv = ill.bg.map((m) => {
    const o = new Float32Array(m.length);
    for (let i = 0; i < m.length; i++) o[i] = 1 / (m[i] > 16 ? m[i] : 16);
    return o;
  });
  const rr = new Float32Array(mw);
  const rg = new Float32Array(mw);
  const rb = new Float32Array(mw);
  const gray = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    mapRow(inv[0], mw, ty, y, rr);
    mapRow(inv[1], mw, ty, y, rg);
    mapRow(inv[2], mw, ty, y, rb);
    for (let x = 0; x < W; x++) {
      const a = tx.i0[x];
      const b = tx.i1[x];
      const f = tx.f[x];
      const i = y * W + x;
      const p = i * 4;
      const nr = data[p] * (rr[a] + (rr[b] - rr[a]) * f);
      const ng = data[p + 1] * (rg[a] + (rg[b] - rg[a]) * f);
      const nb = data[p + 2] * (rb[a] + (rb[b] - rb[a]) * f);
      const mn = nr < ng ? (nr < nb ? nr : nb) : ng < nb ? ng : nb;
      gray[i] = 0.7 * (0.299 * nr + 0.587 * ng + 0.114 * nb) + 0.3 * mn;
      if (rgb) {
        rgb[i * 3] = nr;
        rgb[i * 3 + 1] = ng;
        rgb[i * 3 + 2] = nb;
      }
    }
  }
  return gray;
}

/** 3 × 3 binom yumuşatma (σ ≈ 0,7), yerinde değil */
function binomial3(a: Float32Array, w: number, h: number): Float32Array {
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      const l = a[o + (x > 0 ? x - 1 : 0)];
      const r = a[o + (x < w - 1 ? x + 1 : x)];
      tmp[o + x] = (l + 2 * a[o + x] + r) * 0.25;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    const u = (y > 0 ? y - 1 : 0) * w;
    const d = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) out[o + x] = (tmp[u + x] + 2 * tmp[o + x] + tmp[d + x]) * 0.25;
  }
  return out;
}

/** Kâğıdın düzeyi (en sık değer) ve üstündeki yayılım (yalnız gürültü), histogramdan */
function paperLevel(hist: Float64Array): { mode: number; spread: number } {
  const bw = GMAX / GB;
  let mi = 0;
  let mv = -1;
  for (let i = 0; i < GB; i++) {
    let s = 0;
    for (let k = -4; k <= 4; k++) s += hist[Math.max(0, Math.min(GB - 1, i + k))];
    if (s > mv) {
      mv = s;
      mi = i;
    }
  }
  const mode = Math.max(0.3, (mi + 0.5) * bw);
  let s2 = 0;
  let c = 0;
  for (let i = 0; i < GB; i++) {
    const v = (i + 0.5) * bw;
    if (v > mode && v < mode + 0.3) {
      s2 += hist[i] * (v - mode) * (v - mode);
      c += hist[i];
    }
  }
  return { mode, spread: c > 500 ? Math.sqrt(s2 / c) : 0 };
}

/** Mürekkep referansı: koyuluğu `lo`'dan büyük piksellerin %90'lığı (koyuluk = (mode − g) / mode), histogramdan */
function inkRef(hist: Float64Array | Uint32Array, off: number, mode: number, lo: number): { ref: number; count: number } {
  const bw = GMAX / GB;
  const gLimit = mode * (1 - lo);
  const top = Math.min(GB, Math.floor(gLimit / bw));
  let count = 0;
  for (let i = 0; i < top; i++) count += hist[off + i];
  if (!count) return { ref: 0, count: 0 };
  // koyuluğun %90'lığı = gri tonun %10'luğu
  const target = count * 0.1;
  let acc = 0;
  for (let i = 0; i < top; i++) {
    acc += hist[off + i];
    if (acc >= target) return { ref: Math.max(0, Math.min(1, (mode - (i + 0.5) * bw) / mode)), count };
  }
  return { ref: lo, count };
}

/** Siyah-beyaz eşikleri (her görüntüde ölçülür) */
export interface InkLevels {
  /** kâğıdın düzeyi (normalize gri) */
  mode: number;
  /** beyaz eşiği: bunun altındaki koyuluk tam beyaz */
  t0: number;
  /** siyah eşiği (görüntünün geneli): bunun üstü tam siyah */
  t1: number;
  /** gürültü (0–255) */
  noise: number;
  /** silinen benek pikseli */
  specks: number;
}

/**
 * Kâğıttaki tek başına benekleri siler: koyu bir pikselin çevresindeki pencerede (yarıçap ~uzun kenar / 90) toplam
 * mürekkep `tiny`'den azsa yanında yazı yoktur (i noktası, virgül, ondalık nokta yazının yanında olduğu için kalır).
 * Bağlı bileşen yerine pencere sayımı: tam çözünürlükte iki geçiş. Silinen piksel sayısını döner.
 */
export function despeckle(v: Float32Array, w: number, h: number): number {
  const tiny = Math.max(3, Math.round(w * h * 4e-6));
  const r = Math.max(3, Math.round(Math.max(w, h) / 90));
  const m = new Uint8Array(w * h);
  let any = 0;
  for (let i = 0; i < m.length; i++) {
    if (v[i] > 0.25) {
      m[i] = 1;
      any++;
    }
  }
  if (!any) return 0;
  // yatay pencere toplamı
  const hs = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let c = 0;
    for (let x = 0; x < Math.min(w, r); x++) c += m[o + x];
    for (let x = 0; x < w; x++) {
      if (x + r < w) c += m[o + x + r];
      if (x - r - 1 >= 0) c -= m[o + x - r - 1];
      hs[o + x] = c;
    }
  }
  // dikey pencere toplamı satır satır; yalnız koyu pikselde karar
  const col = new Int32Array(w);
  for (let y = 0; y < Math.min(h, r); y++) for (let x = 0; x < w; x++) col[x] += hs[y * w + x];
  let dropped = 0;
  for (let y = 0; y < h; y++) {
    if (y + r < h) for (let x = 0, o = (y + r) * w; x < w; x++) col[x] += hs[o + x];
    if (y - r - 1 >= 0) for (let x = 0, o = (y - r - 1) * w; x < w; x++) col[x] -= hs[o + x];
    const o = y * w;
    for (let x = 0; x < w; x++) {
      if (v[o + x] > 0 && col[x] <= tiny) {
        v[o + x] = 0;
        dropped++;
      }
    }
  }
  return dropped;
}

/** "belge": CamScanner tarzı siyah-beyaz */
function documentMode(img: RgbaImage, ill: Illumination): { out: RgbaImage; levels: InkLevels } {
  const { width: W, height: H } = img;
  const n = W * H;
  let g = normalizedGray(img, ill);
  const noise = noiseSigma({ width: W, height: H, data: g }, 215);
  if (noise > 3) g = binomial3(g, W, H);
  if (noise > 6) g = binomial3(g, W, H);
  // bölgeler (soluk baskının olduğu yerde siyah eşiği iner): uzun kenar boyunca en çok 8
  const tiles = Math.max(2, Math.min(8, Math.round(Math.max(W, H) / 250)));
  const tx = W >= H ? tiles : Math.max(1, Math.round((tiles * W) / H));
  const ty = H > W ? tiles : Math.max(1, Math.round((tiles * H) / W));
  const hist = new Float64Array(GB);
  const tileHist = new Uint32Array(tx * ty * GB);
  const tileOf = new Int32Array(W);
  for (let x = 0; x < W; x++) tileOf[x] = Math.min(tx - 1, Math.floor((x * tx) / W));
  const k = GB / GMAX;
  for (let y = 0; y < H; y++) {
    const trow = Math.min(ty - 1, Math.floor((y * ty) / H)) * tx;
    const o = y * W;
    for (let x = 0; x < W; x++) {
      let b = Math.floor(g[o + x] * k);
      if (b < 0) b = 0;
      else if (b >= GB) b = GB - 1;
      hist[b]++;
      tileHist[(trow + tileOf[x]) * GB + b]++;
    }
  }
  const { mode, spread } = paperLevel(hist);
  const t0 = Math.max(0.035, Math.min(0.2, (2.5 * spread) / mode));
  const glob = inkRef(hist, 0, mode, t0 + 0.06);
  const ref = glob.count > n * 0.002 ? glob.ref : 0.7;
  const t1 = Math.max(t0 + 0.14, Math.min(0.75, ref * 0.85));
  // bölge bölge siyah eşiği: o bölgedeki mürekkep soluksa iner (genelden yükselmez)
  const tileT1 = new Float32Array(tx * ty).fill(t1);
  const tilePix = n / (tx * ty);
  for (let t = 0; t < tx * ty; t++) {
    const r = inkRef(tileHist, t * GB, mode, t0 + 0.06);
    if (r.count >= Math.max(30, tilePix * 0.01)) tileT1[t] = Math.max(t0 + 0.14, Math.min(t1, r.ref * 0.85));
  }
  // komşularla yumuşat (dikiş görünmesin)
  const sm = new Float32Array(tx * ty);
  for (let j = 0; j < ty; j++) {
    for (let i = 0; i < tx; i++) {
      let s = 0;
      let c = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const jj = j + dj;
          const ii = i + di;
          if (jj < 0 || ii < 0 || jj >= ty || ii >= tx) continue;
          const wgt = di === 0 && dj === 0 ? 2 : 1;
          s += tileT1[jj * tx + ii] * wgt;
          c += wgt;
        }
      }
      sm[j * tx + i] = Math.min(tileT1[j * tx + i] + 0.05, s / c);
    }
  }
  // eşik haritaları aydınlatma haritasının çözünürlüğünde: gölgede aydınlatılan yerde gürültü de büyür, beyaz eşiği
  // kazançla birlikte (ölçülü) yükselir
  const mw = ill.width;
  const mh = ill.height;
  const pl = 0.299 * ill.paper[0] + 0.587 * ill.paper[1] + 0.114 * ill.paper[2];
  const t1Small = upsample(sm, tx, ty, mw, mh);
  // tam çözünürlükte bölme olmasın: alt eşik ve aralığın tersi haritada
  const T0 = new Float32Array(mw * mh);
  const T1 = new Float32Array(mw * mh);
  for (let i = 0; i < mw * mh; i++) {
    const bgl = 0.299 * ill.bg[0][i] + 0.587 * ill.bg[1][i] + 0.114 * ill.bg[2][i];
    const gain = Math.max(1, pl / Math.max(8, bgl));
    const a = Math.min(t0 * Math.sqrt(gain), t0 + 0.06);
    T0[i] = a;
    T1[i] = 1 / (Math.max(t1Small[i], a + 0.14) - a);
  }
  const txs = upTaps(mw, W);
  const tys = upTaps(mh, H);
  const r0 = new Float32Array(mw);
  const r1 = new Float32Array(mw);
  const v = g; // yerinde: koyuluk açılımı
  const invMode = 1 / mode;
  for (let y = 0; y < H; y++) {
    mapRow(T0, mw, tys, y, r0);
    mapRow(T1, mw, tys, y, r1);
    const o = y * W;
    for (let x = 0; x < W; x++) {
      const a = txs.i0[x];
      const b = txs.i1[x];
      const f = txs.f[x];
      const lo = r0[a] + (r0[b] - r0[a]) * f;
      const span = r1[a] + (r1[b] - r1[a]) * f;
      let d = 1 - g[o + x] * invMode;
      d = d < 0 ? 0 : d > 1 ? 1 : d;
      let t = (d - lo) * span;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      v[o + x] = t < 0.1 ? 0 : t;
    }
  }
  const specks = despeckle(v, W, H);
  // keskinlik: kâğıt tam beyaz olduğu için harf çevresinde hale görünmez, yalnız kenarlar netleşir
  const o255 = new Float32Array(n);
  for (let i = 0; i < n; i++) o255[i] = (1 - v[i]) * 255;
  const bl = binomial3(o255, W, H);
  const out = createRgba(W, H);
  const od = out.data;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const val = o255[i] + 0.6 * (o255[i] - bl[i]);
    od[p] = val;
    od[p + 1] = val;
    od[p + 2] = val;
    od[p + 3] = 255;
  }
  return { out, levels: { mode, t0, t1, noise, specks } };
}

/** "gri": aydınlatması düzeltilmiş, eşiksiz gri */
function grayMode(img: RgbaImage, ill: Illumination): RgbaImage {
  const { width: W, height: H } = img;
  const n = W * H;
  const gray = normalizedGray(img, ill);
  const hist = histogram(gray, GB, 0, GMAX, 2);
  const { mode } = paperLevel(hist);
  const lo = Math.min(mode * 0.6, histPercentile(hist, 0.003, 0, GMAX));
  const hi = mode * 0.97;
  const lut = new Uint8ClampedArray(1024);
  for (let i = 0; i < 1024; i++) {
    const x = Math.max(0, Math.min(1, ((i / 1023) * GMAX - lo) / (hi - lo)));
    lut[i] = 255 * Math.pow(x, 1.15);
  }
  const out = createRgba(W, H);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const val = lut[Math.max(0, Math.min(1023, Math.round((gray[i] / GMAX) * 1023)))];
    out.data[p] = val;
    out.data[p + 1] = val;
    out.data[p + 2] = val;
    out.data[p + 3] = 255;
  }
  return out;
}

/** "renkli": aydınlatma düzeltmesi (kâğıt nötr beyaz), karşıtlık ve hafif doygunluk */
function colorMode(img: RgbaImage, ill: Illumination): RgbaImage {
  const { width: W, height: H } = img;
  const n = W * H;
  const rgb = new Float32Array(n * 3);
  const gray = normalizedGray(img, ill, rgb);
  const hist = histogram(gray, GB, 0, GMAX, 2);
  const { mode } = paperLevel(hist);
  const lo = Math.min(mode * 0.5, histPercentile(hist, 0.003, 0, GMAX));
  const hi = mode * 0.97;
  const k = 1 / (hi - lo);
  const out = createRgba(W, H);
  const curve = (x: number) => 255 * Math.pow(x < 0 ? 0 : x > 1 ? 1 : x, 1.1);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    let rr = (rgb[i * 3] - lo) * k;
    let gg = (rgb[i * 3 + 1] - lo) * k;
    let bb = (rgb[i * 3 + 2] - lo) * k;
    const l = 0.299 * rr + 0.587 * gg + 0.114 * bb;
    rr = l + (rr - l) * 1.15;
    gg = l + (gg - l) * 1.15;
    bb = l + (bb - l) * 1.15;
    out.data[p] = curve(rr);
    out.data[p + 1] = curve(gg);
    out.data[p + 2] = curve(bb);
    out.data[p + 3] = 255;
  }
  return out;
}

/** Görüntüyü seçilen moda göre işler (perspektifi düzeltilmiş görüntü beklenir) */
export function enhance(img: RgbaImage, mode: ScanMode): RgbaImage {
  if (mode === "orijinal") return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  const ill = estimateIllumination(img);
  if (mode === "gri") return grayMode(img, ill);
  if (mode === "renkli") return colorMode(img, ill);
  return documentMode(img, ill).out;
}

/** "belge" modunun ölçtüğü eşiklerle birlikte (tanı ve testler için) */
export function enhanceDocument(img: RgbaImage): { image: RgbaImage; levels: InkLevels } {
  const r = documentMode(img, estimateIllumination(img));
  return { image: r.out, levels: r.levels };
}

export interface SkewEstimate {
  /** Yazı satırlarının eğimi (derece; artı: satırlar sağa doğru iniyor) */
  angle: number;
  /** 0–1: izdüşüm profilinin tepe keskinliği ve yazı miktarı */
  confidence: number;
}

/**
 * Kalan eğiklik (±8°): yazı noktaları farklı açılarla satırlara izdüşürülür; satırlar hizalanınca profil en keskin olur
 * (karelerin toplamı en büyük). Önce 0,5°, sonra 0,1° ve 0,02° adım. Yazı azsa ya da tepe belirsizse güven düşük.
 */
export function estimateSkew(img: RgbaImage, maxDeg = 8): SkewEstimate {
  const sz = fitSize(img.width, img.height, 800);
  const small = sz.width === img.width && sz.height === img.height ? img : resizeRgba(img, sz.width, sz.height);
  const g = toGray(small);
  const { width: w, height: h } = g;
  const bg = boxMean(g, Math.max(5, Math.round(Math.min(w, h) / 30)));
  let count = 0;
  for (let i = 0; i < w * h; i++) if (bg.data[i] - g.data[i] > Math.max(10, 0.12 * bg.data[i])) count++;
  if (count < 300) return { angle: 0, confidence: 0 };
  const stride = Math.max(1, Math.floor(count / 25_000));
  const m = Math.ceil(count / stride);
  const xs = new Float32Array(m);
  const ys = new Float32Array(m);
  const ws = new Float32Array(m);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  let k = 0;
  let seen = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dk = bg.data[i] - g.data[i];
      if (dk > Math.max(10, 0.12 * bg.data[i])) {
        if (seen++ % stride === 0 && k < m) {
          xs[k] = x - cx;
          ys[k] = y - cy;
          ws[k] = Math.min(dk, 80);
          k++;
        }
      }
    }
  }
  const R = Math.ceil(Math.hypot(w, h) / 2) + 2;
  const bins = new Float64Array(2 * R + 2);
  const score = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    bins.fill(0);
    for (let j = 0; j < k; j++) {
      const f = ys[j] * c - xs[j] * s + R;
      const i0 = Math.floor(f);
      const t = f - i0;
      bins[i0] += ws[j] * (1 - t);
      bins[i0 + 1] += ws[j] * t;
    }
    let sum = 0;
    for (let i = 0; i < bins.length; i++) sum += bins[i] * bins[i];
    return sum;
  };
  const coarse: { deg: number; s: number }[] = [];
  for (let deg = -maxDeg; deg <= maxDeg + 1e-9; deg += 0.5) coarse.push({ deg, s: score(deg) });
  let best = coarse[0];
  for (const c of coarse) if (c.s > best.s) best = c;
  let fine = best;
  for (let deg = best.deg - 0.5; deg <= best.deg + 0.5 + 1e-9; deg += 0.1) {
    const s = score(deg);
    if (s > fine.s) fine = { deg, s };
  }
  // tepeye parabol: adımın altında hassasiyet
  const sl = score(fine.deg - 0.1);
  const sr = score(fine.deg + 0.1);
  const den = sl - 2 * fine.s + sr;
  const angle = den < 0 ? fine.deg + (0.1 * (sl - sr)) / (2 * den) : fine.deg;
  const sorted = coarse.map((c) => c.s).sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] || 1;
  // tepe belirgin mi (satır yapısı var mı) ve düzeltme profili 0°'ye göre gerçekten keskinleştiriyor mu (dar fişte tepe
  // geniştir; küçük açı farkı ölçülemez, düzeltilmez)
  const peak = Math.max(0, Math.min(1, (fine.s / med - 1) / 0.6));
  const s0 = score(0);
  const vsZero = Math.max(0, Math.min(1, (fine.s / Math.max(1e-9, s0) - 1) / 0.06));
  let confidence = Math.min(peak, Math.abs(angle) < 0.15 ? peak : vsZero);
  if (Math.abs(best.deg) >= maxDeg - 0.5) confidence = 0; // sınırda: gerçek eğiklik aralık dışında ya da yazı yok
  confidence *= Math.min(1, count / 2000);
  return { angle: Math.round(angle * 100) / 100, confidence };
}
