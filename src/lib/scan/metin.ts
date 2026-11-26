/**
 * Belge tarayıcı: yazı çözümlemesinin ortak parçaları (çekim kalitesi, yön ve uzun fiş birleştirme kullanır). Mürekkep
 * haritası (kâğıdın yerel parlaklığına göre koyuluk; gölge ve sarı ışık etkilemez), harf boyu, satırların yönü (yatay /
 * dikey) ve satır ölçüleri. Hepsi saf; DOM'a dokunmaz. Belge: docs/FOTOGRAF.md › Belge tarama (kalite, yön, birleştirme).
 */

import type { GrayImage } from "./image";
import { boxMean, gaussianBlur, labelComponents, maxFilter, resizeGray, type Components } from "./image";

export interface InkMap {
  width: number;
  height: number;
  /** Kâğıdın yerel parlaklığına oranla koyuluk (0 = kâğıt, 1 = tam siyah) */
  dark: Float32Array;
  /** Kâğıdın yerel parlaklığı (0–255) */
  bg: Float32Array;
  /** Yazı pikselleri (1 = mürekkep) */
  mask: Uint8Array;
  /** Maskenin eşiği (koyuluk) */
  threshold: number;
  /** Mürekkebin tipik koyuluğu (koyuluğun %99,5'lik değeri); yazı yoksa gürültü düzeyi */
  inkLevel: number;
  /** Mürekkep piksellerinin sayısı */
  count: number;
}

/** Dizinin yüzdeliği (p: 0–1); örnekleyerek (en çok ~200 bin değer) */
export function percentile(data: ArrayLike<number>, p: number, lo = 0, hi = 1): number {
  const bins = 512;
  const hist = new Float64Array(bins);
  const step = Math.max(1, Math.floor(data.length / 200_000));
  const k = bins / (hi - lo);
  let n = 0;
  for (let i = 0; i < data.length; i += step) {
    let b = Math.floor((data[i] - lo) * k);
    if (b < 0) b = 0;
    else if (b >= bins) b = bins - 1;
    hist[b]++;
    n++;
  }
  const target = p * n;
  let acc = 0;
  for (let i = 0; i < bins; i++) {
    acc += hist[i];
    if (acc >= target) return lo + ((i + 0.5) * (hi - lo)) / bins;
  }
  return hi;
}

/**
 * Mürekkep haritası: kâğıdın yerel parlaklığı (en büyük süzgeç + kutu ortalaması; yazıyı siler, gölgeyi izler), ona
 * oranla koyuluk ve eşiklenmiş yazı maskesi. Eşik mürekkebin koyuluğuna göre seçilir (soluk termal baskıda düşer).
 */
export function inkMap(g: GrayImage): InkMap {
  const { width: w, height: h, data } = g;
  const r = Math.max(3, Math.round(Math.max(w, h) / 110));
  const bg = boxMean(maxFilter(g, r), 2 * r).data;
  const dark = new Float32Array(w * h);
  for (let i = 0; i < dark.length; i++) {
    const b = bg[i] > 16 ? bg[i] : 16;
    const d = (b - data[i]) / b;
    dark[i] = d > 0 ? (d < 1 ? d : 1) : 0;
  }
  const inkLevel = percentile(dark, 0.995);
  const threshold = Math.max(0.08, Math.min(0.35, 0.42 * inkLevel));
  const mask = new Uint8Array(w * h);
  let count = 0;
  for (let i = 0; i < dark.length; i++) {
    if (dark[i] > threshold) {
      mask[i] = 1;
      count++;
    }
  }
  return { width: w, height: h, dark, bg, mask, threshold, inkLevel, count };
}

/**
 * Harf boyu (piksel), yönden bağımsız: bağlı bileşenlerin kutusundan. Derli toplu bileşen tek harftir (uzun kenarı
 * harf boyu); uzamış bileşen birleşmiş sözcüktür (kısa kenarı harf boyu). Kutu alanıyla ağırlıklı ortanca; nokta,
 * virgül ve ince harfler az ağırlık alır. Yazı yoksa 0.
 */
export function glyphSize(c: Components, w: number, h: number): number {
  const vals: number[] = [];
  const wts: number[] = [];
  let total = 0;
  const maxSide = 0.5 * Math.max(w, h);
  for (let l = 1; l <= c.count; l++) {
    if (c.areas[l] < 4) continue;
    const bw = c.maxX[l] - c.minX[l] + 1;
    const bh = c.maxY[l] - c.minY[l] + 1;
    const lo = Math.min(bw, bh);
    const hi = Math.max(bw, bh);
    if (hi < 3 || lo > 0.2 * Math.min(w, h) || (hi > maxSide && lo < 3)) continue; // leke, çerçeve çizgisi, büyük koyu alan
    const v = hi <= 3 * lo ? hi : lo;
    const wt = Math.min(bw * bh, 16 * v * v);
    vals.push(v);
    wts.push(wt);
    total += wt;
  }
  if (vals.length < 8) return 0;
  const order = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
  let acc = 0;
  for (const i of order) {
    acc += wts[i];
    if (acc >= total / 2) return vals[i];
  }
  return vals[order[order.length - 1]];
}

export type TextAxis = "yatay" | "dikey";

export interface AxisEstimate {
  /** Yazı satırlarının yönü; yazı yoksa ya da belirsizse null */
  axis: TextAxis | null;
  /** −1 … 1: artı yatay satır, eksi dikey satır (yoğunluk haritasının dikey / yatay türev enerjisi farkı) */
  anisotropy: number;
  /** 0–1 */
  confidence: number;
}

/** Bu değerin altındaki yönlülük "belirsiz" sayılır */
export const AXIS_MIN_ANISOTROPY = 0.12;

/**
 * Satırların yönü: yazı maskesi harf boyunun ~üçte biri kadar bulanıklaştırılır (harfler satır içinde birleşir, satır
 * araları kalır); satır kenarları boydan boya uzandığı için satıra dik türevin enerjisi satır boyuncakinden büyüktür.
 * Üç ölçekte bakılır; işaretler uyuşmuyorsa belirsiz. Birkaç derecelik eğiklikten etkilenmez.
 */
export function textAxis(mask: Uint8Array, w: number, h: number, glyph: number): AxisEstimate {
  if (!(glyph > 0)) return { axis: null, anisotropy: 0, confidence: 0 };
  // harf boyu ~8 piksel olacak biçimde küçült (alan ortalaması: yoğunluk)
  const f = Math.max(1, glyph / 8);
  const sw = Math.max(8, Math.round(w / f));
  const sh = Math.max(8, Math.round(h / f));
  const src = new Float32Array(w * h);
  for (let i = 0; i < src.length; i++) src[i] = mask[i];
  const dens = resizeGray({ width: w, height: h, data: src }, sw, sh);
  const g8 = glyph / (w / sw);
  const values: number[] = [];
  for (const k of [0.25, 0.36, 0.5]) {
    const b = gaussianBlur(dens, Math.max(0.8, k * g8)).data;
    let ex = 0;
    let ey = 0;
    for (let y = 1; y < sh - 1; y++) {
      for (let x = 1; x < sw - 1; x++) {
        const i = y * sw + x;
        const dx = b[i + 1] - b[i - 1];
        const dy = b[i + sw] - b[i - sw];
        ex += dx * dx;
        ey += dy * dy;
      }
    }
    values.push(ex + ey > 1e-9 ? (ey - ex) / (ey + ex) : 0);
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const agree = values.every((v) => v * mean > 0);
  const weakest = Math.min(...values.map((v) => Math.abs(v)));
  if (!agree || Math.abs(mean) < AXIS_MIN_ANISOTROPY) return { axis: null, anisotropy: mean, confidence: 0 };
  const confidence = Math.max(0, Math.min(1, (0.5 * Math.abs(mean) + 0.5 * weakest - AXIS_MIN_ANISOTROPY / 2) / 0.3));
  return { axis: mean > 0 ? "yatay" : "dikey", anisotropy: mean, confidence };
}

export interface LineMetrics {
  /** Satırdaki harflerin boyu (piksel); bulunamadıysa 0 */
  glyphHeight: number;
  /** Ardışık satırların aralığı (piksel); bulunamadıysa 0 */
  linePitch: number;
  /** Bir şeritte sayılan en çok satır */
  lines: number;
}

/**
 * Satır ölçüleri: maske satır yönünde dar şeritlere bölünür (eğiklik şerit içinde satırı yaymasın), her şeridin satıra
 * dik izdüşümünde dolu aralıkların boyu harf boyunu, merkezlerinin aralığı satır aralığını verir.
 */
export function lineMetrics(mask: Uint8Array, w: number, h: number, axis: TextAxis, glyph: number): LineMetrics {
  if (!(glyph > 0)) return { glyphHeight: 0, linePitch: 0, lines: 0 };
  const along = axis === "yatay" ? w : h; // satır boyunca uzunluk
  const across = axis === "yatay" ? h : w;
  const stripW = Math.max(24, Math.min(along, Math.round(6 * glyph)));
  const strips = Math.max(1, Math.floor(along / stripW));
  const runs: number[] = [];
  const gaps: number[] = [];
  let lines = 0;
  const prof = new Float32Array(across);
  for (let s = 0; s < strips; s++) {
    const a0 = s * stripW;
    const a1 = s === strips - 1 ? along : a0 + stripW;
    prof.fill(0);
    if (axis === "yatay") {
      for (let y = 0; y < h; y++) {
        let n = 0;
        const row = y * w;
        for (let x = a0; x < a1; x++) n += mask[row + x];
        prof[y] = n;
      }
    } else {
      for (let y = a0; y < a1; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) prof[x] += mask[row + x];
      }
    }
    const top = percentile(prof, 0.95, 0, a1 - a0 + 1);
    if (top < 0.06 * (a1 - a0)) continue; // şeritte yazı yok
    const thr = Math.max(1, 0.12 * top);
    let start = -1;
    let lastCenter = -1;
    let count = 0;
    for (let i = 0; i <= across; i++) {
      const on = i < across && prof[i] >= thr;
      if (on && start < 0) start = i;
      else if (!on && start >= 0) {
        const len = i - start;
        if (len >= 0.4 * glyph && len <= 2.6 * glyph) {
          runs.push(len);
          const c = (start + i - 1) / 2;
          if (lastCenter >= 0 && c - lastCenter <= 4 * glyph) gaps.push(c - lastCenter);
          lastCenter = c;
          count++;
        } else lastCenter = -1;
        start = -1;
      }
    }
    if (count > lines) lines = count;
  }
  if (runs.length < 3) return { glyphHeight: 0, linePitch: 0, lines };
  runs.sort((a, b) => a - b);
  gaps.sort((a, b) => a - b);
  return {
    // eğiklik aralığı uzatır: ortanca yerine alt üçte birlik
    glyphHeight: runs[Math.floor(runs.length * 0.35)],
    linePitch: gaps.length ? gaps[Math.floor(gaps.length * 0.4)] : 0,
    lines,
  };
}

export interface TextLayout {
  ink: InkMap;
  components: Components;
  /** Yönden bağımsız kaba harf boyu (piksel); yazı yoksa 0 */
  glyph: number;
  axis: AxisEstimate;
  /** Satır ölçüleri (yön bulunduysa) */
  lines: LineMetrics;
}

/** Gri görüntünün yazı düzeni: mürekkep haritası, bileşenler, harf boyu, satır yönü ve ölçüleri */
export function analyzeText(g: GrayImage): TextLayout {
  const ink = inkMap(g);
  const components = labelComponents(ink.mask, g.width, g.height, true);
  const glyph = glyphSize(components, g.width, g.height);
  const axis = textAxis(ink.mask, g.width, g.height, glyph);
  const lines = axis.axis ? lineMetrics(ink.mask, g.width, g.height, axis.axis, glyph) : { glyphHeight: 0, linePitch: 0, lines: 0 };
  return { ink, components, glyph, axis, lines };
}
