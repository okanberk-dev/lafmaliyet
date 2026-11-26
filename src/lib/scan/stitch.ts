/**
 * Belge tarayıcı: uzun fiş birleştirme. Uzun Z rulosu (ya da sığmayan fatura) parça parça çekilir; her parça önce
 * taranır (açılmış, dik, üstü yukarıda), sonra ardışık parçalar örtüşen bölgeleri bulunarak tek görüntüde birleşir.
 * Saf TS (DOM yok), telefonda Web Worker'da çağrılabilir.
 *
 * Yöntem: parçalar aynı genişliğe getirilir (aynı kâğıdın eni), kâğıdın yerel parlaklığına oranla koyuluk haritası
 * çıkarılır (gölge ve pozlama farkı etkilemez). Önce satır profilinde (her satırın ortalama koyuluğu) üst parçanın
 * altı ile alt parçanın üstü, dikey ölçek farkıyla birlikte normalize çapraz ilintiyle aranır; en iyi adaylar iki
 * boyutta (sütun profiliyle yatay kayma ve ölçek, sonra koyuluk haritasının ilintisi) sınanır ve inceltilir. Karar
 * sütun şeritlerinin en zayıfına bakar: aynı şablonlu iki farklı rapor (etiketler aynı, tutarlar farklı) tutar
 * şeridinde tutmaz. Örtüşme yoksa, yazısızsa ya da başka bir yer de neredeyse aynı tutuyorsa (tekrarlayan satırlar)
 * emin olunmaz: null döner, çağıran parçaları ayrı fotoğraf olarak yükler.
 *
 * Dikiş, örtüşmenin ortasına yakın iki yazı satırı arasındaki boşluktan geçer (harf kesilmez); alt parçanın
 * parlaklığı üsttekine eşitlenir, dikişte birkaç satır yumuşak geçiş. Çıktının uzun kenarı en çok MAX_PHOTO_EDGE
 * (4096; aşarsa küçültülür). Belge: docs/FOTOGRAF.md › Belge tarama (kalite, yön, birleştirme), src/lib/scan/README.md.
 */

import type { GrayImage, RgbaImage } from "./image";
import { boxMean, fitSize, gaussianBlur, maxFilter, resizeGray, resizeRgba, toGray } from "./image";
import { MAX_PHOTO_EDGE } from "../photo-rules";

/**
 * Alt parçanın üst parçaya göre yeri (üst parçanın asıl pikselinde): alt parçanın (x, y) pikseli üst parçada
 * (offsetX + scaleX · x, offsetY + scaleY · y) noktasına düşer.
 */
export interface OverlapMatch {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  /** Örtüşen bölgenin boyu (üst parçanın pikseli) */
  overlap: number;
  /** Örtüşen bölgede koyuluk haritalarının normalize çapraz ilintisi (−1 … 1) */
  score: number;
  /** Yazılı sütun şeritlerinin en düşük ilintisi (karar bununla) */
  bandScore: number;
  /** En iyi ile başka bir yerdeki en iyi adayın farkı (tekrarlayan satırlarda küçük) */
  margin: number;
  /** Örtüşen bölgedeki yazı satırı sayısı */
  lines: number;
  /** İnce doğrulama: yazılı blok sayısı, tutmayan blokların oranı, blok ilintilerinin alt onda biri */
  blocks: number;
  badBlocks: number;
  blockLow: number;
  /** 0–1 */
  confidence: number;
  /** Dikiş: üst parçanın bu satırına kadar üst parça, sonrası alt parça */
  seam: number;
}

export interface StitchOptions {
  /** Bunun altındaki güvende birleştirilmez; varsayılan STITCH_MIN_CONFIDENCE */
  minConfidence?: number;
  /** Çıktının uzun kenarı en çok; varsayılan MAX_PHOTO_EDGE (4096) */
  maxEdge?: number;
  /**
   * Verilen sıra tutmazsa başka sıra da denensin mi (alt yarı önce çekilmişse); varsayılan açık, yalnız en çok 3
   * parçada (en çok 6 parça çifti sınanır)
   */
  anyOrder?: boolean;
}

export interface StitchResult {
  image: RgbaImage;
  /** Parçaların birleştirildiği sıra (verilen dizideki sıra numaraları) */
  order: number[];
  /** Ardışık parçaların eşleşmesi (`order` sırasıyla; her biri bir öncekinin asıl pikselinde) */
  matches: OverlapMatch[];
  /** Dikişlerin çıktıdaki satırları */
  seams: number[];
  /** Çıktının birleşmiş tam ölçüye oranı (uzun kenar sınırı aşılınca < 1) */
  scale: number;
  /** Eşleşmelerin en düşük güveni */
  confidence: number;
  /** ms */
  timing: number;
}

export interface OverlapProbe {
  /** Bulunan en iyi eşleşme (güveni düşük olabilir); örtüşme adayı hiç yoksa null */
  best: OverlapMatch | null;
  reasons: string[];
}

/** Varsayılan en düşük güven */
export const STITCH_MIN_CONFIDENCE = 0.5;

// ---------------------------------------------------------------- ayarlar (tests/tarama-birlestirme.test.ts ile seçildi)

/** Aramanın çalışma genişliği (piksel) */
const WORK_W = 320;
/** Dikey ölçek farkı (±) ve adımı */
const SY_RANGE = 0.1;
const SY_STEP = 0.01;
/** Yatay ölçek farkı (±) ve adımı */
const SX_RANGE = 0.06;
const SX_STEP = 0.02;
/** Yatay kayma: genişliğin bu oranına kadar */
const DX_RANGE = 0.08;
/** Örtüşme en az genişliğin bu oranı; en çok kısa parçanın bu oranı */
const MIN_OVERLAP = 0.04;
const MAX_OVERLAP = 0.92;
/** Alt parça üst parçanın altına en az genişliğin bu oranı kadar yeni yer eklemeli */
const MIN_NEW = 0.02;
/** Satır profilinden iki boyutlu sınamaya giden aday sayısı */
const CANDIDATES = 24;
/** İlinti şeritleri */
const BANDS = 4;
/** Karar: şerit ilintisinin bu aralıkta güveni 0 → 1, farkın bu değerde 1 */
const BAND_LO = 0.45;
const BAND_HI = 0.75;
const MARGIN_FULL = 0.2;
/** İnce doğrulamanın genişliği (piksel) */
const FINE_W = 560;
/** Blok doğrulaması: yerel kayma (±piksel), yazılı blok varyans tabanı, kötü blok sınırı ve kötü blokların en çok oranı */
const BLOCK_SHIFT = 2;
const BLOCK_VAR = 0.002;
const BLOCK_BAD = 0.5;
const BLOCK_BAD_OK = 0.05;
const BLOCK_BAD_MAX = 0.12;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------- çalışma kopyası

/** Parçanın küçük koyuluk haritası */
interface Work {
  w: number;
  h: number;
  /** Kâğıdın yerel parlaklığına oranla koyuluk (0–1), hafif bulanık */
  d: Float32Array;
  /** Satır profili: orta sütunlarda ortalama koyuluk */
  rows: Float64Array;
  /** Çalışma pikseli / asıl piksel (yatay, dikey) */
  kx: number;
  ky: number;
}

/**
 * Koyuluk haritası `W` genişlikte. `strokes`: harf boyunda yerel ortalama çıkarılır (yalnız çizgiler kalır; iki farklı
 * rakam aynı yerde dursa da birbirine benzemez), ince doğrulama için.
 */
function prepare(gray: GrayImage, W: number, strokes = false): Work {
  const H = Math.max(2, Math.round((gray.height * W) / gray.width));
  const g = resizeGray(gray, W, H);
  // kâğıdın yerel parlaklığı: harften geniş en büyük süzgeç + kutu ortalaması (yazıyı siler, gölgeyi izler)
  const r = Math.max(3, Math.round(W / 30));
  const bg = boxMean(maxFilter(g, r), r).data;
  let d0 = new Float32Array(W * H);
  for (let i = 0; i < d0.length; i++) {
    const b = bg[i] > 16 ? bg[i] : 16;
    const v = (b - g.data[i]) / b;
    d0[i] = v > 0 ? (v < 1 ? v : 1) : 0;
  }
  if (strokes) {
    const m = boxMean({ width: W, height: H, data: d0 }, Math.max(1, Math.round(W / 200))).data;
    const hp = new Float32Array(W * H);
    for (let i = 0; i < hp.length; i++) hp[i] = d0[i] - m[i];
    d0 = hp;
  }
  // hafif bulanıklık: kalan küçük eğiklik ve ölçek farkı ilintiyi düşürmesin
  const d = gaussianBlur({ width: W, height: H, data: d0 }, strokes ? 0.7 : 0.8).data;
  const rows = new Float64Array(H);
  const x0 = Math.round(0.04 * W);
  const x1 = W - x0;
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let x = x0, o = y * W + x0; x < x1; x++, o++) s += d[o];
    rows[y] = s / (x1 - x0);
  }
  return { w: W, h: H, d, rows, kx: W / gray.width, ky: H / gray.height };
}

/** Parça: asıl görüntü, gri hâli ve arama kopyası */
interface Part {
  img: RgbaImage;
  gray: GrayImage;
  work: Work;
}

function partOf(img: RgbaImage, W: number): Part {
  const gray = toGray(img);
  return { img, gray, work: prepare(gray, W) };
}

/** Gri görüntünün [y0, y1) satırları */
function cropRows(g: GrayImage, y0: number, y1: number): GrayImage {
  return { width: g.width, height: y1 - y0, data: g.data.slice(y0 * g.width, y1 * g.width) };
}

/** Çalışma kopyasında eşleşme: alt parçanın (x, y) noktası üst parçada (dx + sx · x, oy + sy · y) */
interface Params {
  oy: number;
  sy: number;
  dx: number;
  sx: number;
}

// ---------------------------------------------------------------- satır profili araması

interface RowCand {
  oy: number;
  sy: number;
  s1: number;
}

/**
 * Satır profillerinde örtüşme adayları: her dikey ölçekte alt parçanın profili yeniden örneklenir, örtüşme boyunun
 * her değerinde (üst parçanın altı ile alt parçanın üstü) normalize çapraz ilinti; yerel en büyükler.
 */
function rowSearch(A: Work, B: Work): RowCand[] {
  const hA = A.h;
  const pa = A.rows;
  const SA = new Float64Array(hA + 1);
  const SA2 = new Float64Array(hA + 1);
  for (let y = 0; y < hA; y++) {
    SA[y + 1] = SA[y] + pa[y];
    SA2[y + 1] = SA2[y] + pa[y] * pa[y];
  }
  const nMin = Math.max(8, Math.round(MIN_OVERLAP * A.w));
  const newMin = Math.max(4, Math.round(MIN_NEW * A.w));
  // profilin anlamlı değişimi (satır başına koyuluk farkı): boş kâğıt eşleşmez
  const varFloor = 1e-4;
  const all: RowCand[] = [];
  const steps = Math.round(SY_RANGE / SY_STEP);
  const score = new Float64Array(hA);
  for (let si = -steps; si <= steps; si++) {
    const sy = 1 + si * SY_STEP;
    const m = Math.floor(sy * (B.h - 1)) + 1;
    const q = new Float64Array(m);
    for (let j = 0; j < m; j++) {
      const t = j / sy;
      const j0 = Math.min(B.h - 1, Math.floor(t));
      const f = t - j0;
      q[j] = B.rows[j0] * (1 - f) + B.rows[Math.min(B.h - 1, j0 + 1)] * f;
    }
    const SQ = new Float64Array(m + 1);
    const SQ2 = new Float64Array(m + 1);
    for (let j = 0; j < m; j++) {
      SQ[j + 1] = SQ[j] + q[j];
      SQ2[j + 1] = SQ2[j] + q[j] * q[j];
    }
    score.fill(-2);
    const nMax = Math.floor(MAX_OVERLAP * Math.min(hA, m));
    for (let n = nMin; n <= nMax && m - n >= newMin; n++) {
      const oy = hA - n;
      const sa = SA[hA] - SA[oy];
      const va = SA2[hA] - SA2[oy] - (sa * sa) / n;
      const sq = SQ[n];
      const vq = SQ2[n] - (sq * sq) / n;
      if (va < varFloor * n || vq < varFloor * n) continue;
      let cross = 0;
      for (let j = 0; j < n; j++) cross += pa[oy + j] * q[j];
      score[oy] = (cross - (sa * sq) / n) / Math.sqrt(va * vq);
    }
    for (let oy = 0; oy < hA; oy++) {
      const s = score[oy];
      if (s < 0.2) continue;
      let peak = true;
      for (let k = -2; k <= 2 && peak; k++) if (k && oy + k >= 0 && oy + k < hA && score[oy + k] > s) peak = false;
      if (peak) all.push({ oy, sy, s1: s });
    }
  }
  all.sort((a, b) => b.s1 - a.s1);
  const out: RowCand[] = [];
  for (const c of all) {
    if (out.some((o) => Math.abs(o.oy - c.oy) <= 2 && Math.abs(o.sy - c.sy) <= 0.015)) continue;
    out.push(c);
    if (out.length >= CANDIDATES) break;
  }
  return out;
}

// ---------------------------------------------------------------- iki boyutlu sınama

/** Alt parçanın satırı (üst parçanın `ya` satırına düşen) */
function rowOf(p: Params, ya: number): number {
  return (ya - p.oy) / p.sy;
}

/**
 * Sütun profilleriyle yatay kayma ve ölçek: örtüşen satırlarda her sütunun koyuluk toplamı; alt parçanınki ölçek ve
 * kaymayla yeniden örneklenir. En iyi iki (sx, dx).
 */
function colSearch(A: Work, B: Work, oy: number, sy: number): { dx: number; sx: number; s: number }[] {
  const W = A.w;
  const ca = new Float64Array(W);
  const cb = new Float64Array(B.w);
  const y0 = Math.max(0, Math.ceil(oy));
  for (let ya = y0; ya < A.h; ya++) {
    const yb = Math.round(rowOf({ oy, sy, dx: 0, sx: 1 }, ya));
    if (yb < 0 || yb >= B.h) continue;
    const oa = ya * W;
    const ob = yb * B.w;
    for (let x = 0; x < W; x++) ca[x] += A.d[oa + x];
    for (let x = 0; x < B.w; x++) cb[x] += B.d[ob + x];
  }
  const x0 = Math.round(0.04 * W);
  const x1 = W - x0;
  const res: { dx: number; sx: number; s: number }[] = [];
  const dmax = Math.round(DX_RANGE * W);
  const steps = Math.round(SX_RANGE / SX_STEP);
  for (let si = -steps; si <= steps; si++) {
    const sx = 1 + si * SX_STEP;
    for (let dx = -dmax; dx <= dmax; dx++) {
      let n = 0;
      let sa = 0;
      let sb = 0;
      let sab = 0;
      let saa = 0;
      let sbb = 0;
      for (let x = x0; x < x1; x++) {
        const xb = (x - dx) / sx;
        if (xb < 0 || xb > B.w - 1) continue;
        const i0 = Math.floor(xb);
        const f = xb - i0;
        const b = cb[i0] * (1 - f) + cb[Math.min(B.w - 1, i0 + 1)] * f;
        const a = ca[x];
        n++;
        sa += a;
        sb += b;
        sab += a * b;
        saa += a * a;
        sbb += b * b;
      }
      if (n < 0.6 * (x1 - x0)) continue;
      const va = saa - (sa * sa) / n;
      const vb = sbb - (sb * sb) / n;
      if (va <= 1e-9 || vb <= 1e-9) continue;
      res.push({ dx, sx, s: (sab - (sa * sb) / n) / Math.sqrt(va * vb) });
    }
  }
  res.sort((a, b) => b.s - a.s);
  const top: { dx: number; sx: number; s: number }[] = [];
  for (const r of res) {
    if (top.some((t) => Math.abs(t.dx - r.dx) <= 2 && Math.abs(t.sx - r.sx) <= 0.015)) continue;
    top.push(r);
    if (top.length >= 2) break;
  }
  return top.length ? top : [{ dx: 0, sx: 1, s: 0 }];
}

interface Score2D {
  /** bütün örtüşmede ilinti */
  ncc: number;
  /** yazılı şeritlerin en düşük ilintisi (yazılı şerit ikiden azsa −1) */
  band: number;
  /** yazılı şerit sayısı */
  bands: number;
  /** örtüşen satır */
  n: number;
}

/**
 * Koyuluk haritalarının örtüşen bölgede ilintisi (alt parça çift doğrusal örneklenir). Uzun örtüşmede satırlar eşit
 * aralıkla seyreltilir: en çok `maxRows` satır.
 */
function score2d(A: Work, B: Work, p: Params, maxRows = Infinity): Score2D {
  const W = A.w;
  const x0 = Math.round(0.04 * W);
  const x1 = W - x0;
  const span = x1 - x0;
  // sütun eşlemesi satırdan bağımsız
  const xi = new Int32Array(span);
  const xf = new Float32Array(span);
  const ok = new Uint8Array(span);
  const band = new Uint8Array(span);
  for (let k = 0; k < span; k++) {
    const xb = (x0 + k - p.dx) / p.sx;
    if (xb < 0 || xb > B.w - 1) continue;
    ok[k] = 1;
    xi[k] = Math.min(B.w - 2, Math.floor(xb));
    xf[k] = xb - xi[k];
    band[k] = Math.min(BANDS - 1, Math.floor((k * BANDS) / span));
  }
  const S = new Float64Array(BANDS * 6);
  const y0 = Math.max(0, Math.ceil(p.oy));
  const rowStep = Math.max(1, Math.ceil((A.h - y0) / maxRows));
  let rowsUsed = 0;
  for (let ya = y0; ya < A.h; ya += rowStep) {
    const yb = rowOf(p, ya);
    if (yb < 0 || yb > B.h - 1) continue;
    const j0 = Math.min(B.h - 2, Math.floor(yb));
    const fy = yb - j0;
    const r0 = j0 * B.w;
    const r1 = r0 + B.w;
    const oa = ya * W + x0;
    rowsUsed++;
    for (let k = 0; k < span; k++) {
      if (!ok[k]) continue;
      const i = xi[k];
      const fx = xf[k];
      const top = B.d[r0 + i] + (B.d[r0 + i + 1] - B.d[r0 + i]) * fx;
      const bot = B.d[r1 + i] + (B.d[r1 + i + 1] - B.d[r1 + i]) * fx;
      const b = top + (bot - top) * fy;
      const a = A.d[oa + k];
      const o = band[k] * 6;
      S[o] += 1;
      S[o + 1] += a;
      S[o + 2] += b;
      S[o + 3] += a * b;
      S[o + 4] += a * a;
      S[o + 5] += b * b;
    }
  }
  let n = 0;
  let sa = 0;
  let sb = 0;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  let minBand = Infinity;
  let bands = 0;
  for (let k = 0; k < BANDS; k++) {
    const o = k * 6;
    const m = S[o];
    n += m;
    sa += S[o + 1];
    sb += S[o + 2];
    sab += S[o + 3];
    saa += S[o + 4];
    sbb += S[o + 5];
    if (m < 50) continue;
    const va = S[o + 4] - (S[o + 1] * S[o + 1]) / m;
    const vb = S[o + 5] - (S[o + 2] * S[o + 2]) / m;
    // yazısız şerit (kâğıt kenar boşluğu) karara girmez: piksel başına varyans ~0,05'lik koyuluk oynamasının altı
    if (va < 0.0025 * m || vb < 0.0025 * m) continue;
    bands++;
    minBand = Math.min(minBand, (S[o + 3] - (S[o + 1] * S[o + 2]) / m) / Math.sqrt(va * vb));
  }
  if (n < 50) return { ncc: -1, band: -1, bands: 0, n: rowsUsed };
  const va = saa - (sa * sa) / n;
  const vb = sbb - (sb * sb) / n;
  const ncc = va > 1e-9 && vb > 1e-9 ? (sab - (sa * sb) / n) / Math.sqrt(va * vb) : -1;
  return { ncc, band: bands >= 2 ? minBand : -1, bands, n: rowsUsed };
}

/** Bileşik puan: bütün ilinti ile en zayıf şeridin ortalaması */
function combined(s: Score2D): number {
  return s.band > -1 ? 0.5 * (s.ncc + s.band) : s.ncc - 0.5;
}

/** Tepe tırmanma: her parametrede ± adım, iyileşme kalmayınca adımlar yarıya; `minStep` piksele kadar */
function refine(A: Work, B: Work, start: Params, maxRows: number, minStep = 0.25): { p: Params; s: Score2D } {
  let p = { ...start };
  let s = score2d(A, B, p, maxRows);
  let best = combined(s);
  let step = 2;
  for (let guard = 0; guard < 40 && step >= minStep; guard++) {
    let improved = false;
    const scaleStep = (step / Math.max(A.h - p.oy, 40)) * 2;
    const tries: Params[] = [
      { ...p, oy: p.oy + step },
      { ...p, oy: p.oy - step },
      { ...p, dx: p.dx + step },
      { ...p, dx: p.dx - step },
      { ...p, sy: p.sy + scaleStep },
      { ...p, sy: p.sy - scaleStep },
      { ...p, sx: p.sx + step / A.w },
      { ...p, sx: p.sx - step / A.w },
    ];
    for (const t of tries) {
      if (t.oy < 0 || t.oy > A.h - 4 || Math.abs(t.sy - 1) > SY_RANGE + 0.02 || Math.abs(t.sx - 1) > SX_RANGE + 0.02) continue;
      const ts = score2d(A, B, t, maxRows);
      const c = combined(ts);
      if (c > best + 1e-6) {
        best = c;
        p = t;
        s = ts;
        improved = true;
      }
    }
    if (!improved) step /= 2;
  }
  return { p, s };
}

/** Örtüşen bölgede yazı satırı sayısı (üst parçanın satır profilinde koyu aralıklar) */
function countLines(A: Work, oy: number): number {
  const sorted = Array.from(A.rows).sort((a, b) => a - b);
  const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))];
  const thr = Math.max(0.01, 0.3 * p95);
  let lines = 0;
  let run = 0;
  for (let y = Math.max(0, Math.ceil(oy)); y <= A.h; y++) {
    if (y < A.h && A.rows[y] >= thr) run++;
    else {
      if (run >= 2) lines++;
      run = 0;
    }
  }
  return lines;
}

/**
 * Dikiş: örtüşmenin ortasına yakın, iki parçada da yazısız satır (iki satır arası boşluk). Çalışma kopyasında üst
 * parçanın satırı.
 */
function seamRow(A: Work, B: Work, p: Params): number {
  const top = Math.max(0, Math.ceil(p.oy));
  const n = A.h - top;
  const a = top + Math.round(0.2 * n);
  const b = A.h - 1 - Math.round(0.2 * n);
  const mid = (top + A.h - 1) / 2;
  let mean = 0;
  for (let y = top; y < A.h; y++) mean += A.rows[y];
  mean = Math.max(1e-3, mean / Math.max(1, n));
  let best = Math.round(mid);
  let bestC = Infinity;
  for (let y = a; y <= b; y++) {
    const yb = rowOf(p, y);
    const j = clamp(Math.round(yb), 0, B.h - 1);
    // iki parçada da satırın ve komşularının koyuluğu, ortadan uzaklık az cezalı
    let ink = 0;
    for (let k = -1; k <= 1; k++) ink += A.rows[clamp(y + k, 0, A.h - 1)] + B.rows[clamp(j + k, 0, B.h - 1)];
    const c = ink + (0.6 * mean * Math.abs(y - mid)) / Math.max(1, n);
    if (c < bestC) {
      bestC = c;
      best = y;
    }
  }
  return best;
}

/** Çalışma kopyasındaki eşleşmeyi asıl piksele çevirir (piksel merkezleri: x_w = (x + 0,5) · k − 0,5) */
function toOriginal(p: Params, A: Work, B: Work): Params {
  const conv = (o: number, s: number, kA: number, kB: number) => ({
    o: (o + s * (0.5 * kB - 0.5) + 0.5) / kA - 0.5,
    s: (s * kB) / kA,
  });
  const x = conv(p.dx, p.sx, A.kx, B.kx);
  const y = conv(p.oy, p.sy, A.ky, B.ky);
  return { dx: x.o, sx: x.s, oy: y.o, sy: y.s };
}

/** Asıl pikseldeki eşleşmeyi çalışma kopyasına çevirir (toOriginal'ın tersi) */
function fromOriginal(o: Params, A: Work, B: Work): Params {
  const conv = (off: number, s: number, kA: number, kB: number) => {
    const sw = (s * kA) / kB;
    return { o: (off + 0.5) * kA - 0.5 - sw * (0.5 * kB - 0.5), s: sw };
  };
  const x = conv(o.dx, o.sx, A.kx, B.kx);
  const y = conv(o.oy, o.sy, A.ky, B.ky);
  return { dx: x.o, sx: x.s, oy: y.o, sy: y.s };
}

interface BlockCheck {
  /** yazılı blok sayısı */
  blocks: number;
  /** ilintisi BLOCK_BAD'in altında kalan blokların oranı */
  bad: number;
  /** blok ilintilerinin alt onda biri */
  low: number;
}

/**
 * İnce doğrulama: örtüşen bölge satır aralığı boyunda, genişliğin sekizde biri eninde bloklara bölünür; her yazılı
 * blokta çizgi haritalarının ilintisi (±BLOCK_SHIFT piksel yerel kaymayla: kalan küçük bükülme cezalandırılmaz).
 * Aynı kâğıtta bütün bloklar tutar; aynı şablonlu başka raporda etiket blokları tutar, tutar blokları tutmaz.
 */
function blockCheck(A: Work, B: Work, p: Params): BlockCheck {
  const W = A.w;
  const y0 = Math.max(0, Math.ceil(p.oy));
  const y1 = Math.min(A.h, Math.floor(p.oy + p.sy * (B.h - 1)) + 1);
  const n = y1 - y0;
  const S = BLOCK_SHIFT;
  if (n < 2 * S + 6) return { blocks: 0, bad: 1, low: -1 };
  // alt parça üst parçanın çerçevesine örneklenir (dışarısı NaN)
  const bm = new Float32Array(n * W).fill(NaN);
  for (let r = 0; r < n; r++) {
    const yb = (y0 + r - p.oy) / p.sy;
    if (yb < 0 || yb > B.h - 1) continue;
    const j0 = Math.min(B.h - 2, Math.floor(yb));
    const fy = yb - j0;
    const r0 = j0 * B.w;
    const r1 = r0 + B.w;
    for (let x = 0; x < W; x++) {
      const xb = (x - p.dx) / p.sx;
      if (xb < 0 || xb > B.w - 1) continue;
      const i = Math.min(B.w - 2, Math.floor(xb));
      const fx = xb - i;
      const t = B.d[r0 + i] + (B.d[r0 + i + 1] - B.d[r0 + i]) * fx;
      const b = B.d[r1 + i] + (B.d[r1 + i + 1] - B.d[r1 + i]) * fx;
      bm[r * W + x] = t + (b - t) * fy;
    }
  }
  const bh = Math.max(8, Math.round(0.05 * W));
  const bw = Math.max(8, Math.round(W / 8));
  const x0 = Math.round(0.04 * W);
  const x1 = W - x0;
  const nccs: number[] = [];
  for (let ry = S; ry + Math.min(bh, 6) <= n - S; ry += bh) {
    const ry1 = Math.min(n - S, ry + bh);
    for (let cx = x0; cx < x1; cx += bw) {
      const cx1 = Math.min(x1, cx + bw);
      if (cx1 - cx < bw / 2) continue;
      let m = 0;
      let sa = 0;
      let saa = 0;
      for (let r = ry; r < ry1; r++) {
        for (let x = cx; x < cx1; x++) {
          const a = A.d[(y0 + r) * W + x];
          sa += a;
          saa += a * a;
          m++;
        }
      }
      const va = saa - (sa * sa) / m;
      if (va < BLOCK_VAR * m) continue;
      let best = -1;
      let bOk = false;
      for (let v = -S; v <= S; v++) {
        for (let u = -S; u <= S; u++) {
          let k = 0;
          let a1 = 0;
          let a2 = 0;
          let b1 = 0;
          let b2 = 0;
          let ab = 0;
          for (let r = ry; r < ry1; r++) {
            const ob = (r + v) * W;
            const oa = (y0 + r) * W;
            for (let x = cx; x < cx1; x++) {
              const xx = x + u;
              if (xx < 0 || xx >= W) continue;
              const b = bm[ob + xx];
              if (b !== b) continue; // NaN
              const a = A.d[oa + x];
              k++;
              a1 += a;
              a2 += a * a;
              b1 += b;
              b2 += b * b;
              ab += a * b;
            }
          }
          if (k < 0.8 * m) continue;
          const vA = a2 - (a1 * a1) / k;
          const vB = b2 - (b1 * b1) / k;
          if (vB < BLOCK_VAR * k) continue;
          bOk = true;
          const c = vA > 1e-12 ? (ab - (a1 * b1) / k) / Math.sqrt(vA * vB) : -1;
          if (c > best) best = c;
        }
      }
      // üstte yazı var, altta hiç yok: tutmuyor
      nccs.push(bOk ? best : 0);
    }
  }
  if (!nccs.length) return { blocks: 0, bad: 1, low: -1 };
  nccs.sort((a, b) => a - b);
  const bad = nccs.filter((c) => c < BLOCK_BAD).length / nccs.length;
  return { blocks: nccs.length, bad, low: nccs[Math.floor(0.1 * (nccs.length - 1))] };
}

/** İki parça arasında örtüşme (üst parça A, alt parça B): kaba arama, inceltme, ince doğrulama */
function probeParts(PA: Part, PB: Part): OverlapProbe {
  const A = PA.work;
  const B = PB.work;
  const reasons: string[] = [];
  const cands = rowSearch(A, B);
  if (!cands.length) {
    reasons.push("ortusme-adayi-yok");
    return { best: null, reasons };
  }
  // her aday: sütun profiliyle yatay kayma, sonra iki boyutlu ilinti (satır atlayarak hızlı)
  const scored: { p: Params; s: Score2D; c: number }[] = [];
  for (const rc of cands) {
    for (const cs of colSearch(A, B, rc.oy, rc.sy)) {
      const p: Params = { oy: rc.oy, sy: rc.sy, dx: cs.dx, sx: cs.sx };
      const s = score2d(A, B, p, 100);
      scored.push({ p, s, c: combined(s) });
    }
  }
  scored.sort((a, b) => b.c - a.c);
  // en iyi birkaç aday inceltilir; ayrı yerlerdeki en iyi ikisi karşılaştırılır
  const distinct = Math.max(4, 0.02 * A.w);
  const refined: { p: Params; s: Score2D; c: number }[] = [];
  for (const sc of scored) {
    if (refined.length >= 3) break;
    if (refined.some((r) => Math.abs(r.p.oy - sc.p.oy) < distinct && Math.abs(r.p.sy - sc.p.sy) < 0.03)) continue;
    const r = refine(A, B, sc.p, 120);
    refined.push({ p: r.p, s: r.s, c: combined(r.s) });
  }
  refined.sort((a, b) => b.c - a.c);
  const top = refined[0];
  const other = refined.find((r) => Math.abs(r.p.oy - top.p.oy) >= distinct);
  // inceltilmemiş adaylardan da (ayrı yerdeki) en iyisi: ikinci yer için alt sınır
  const otherRaw = scored.find((r) => Math.abs(r.p.oy - top.p.oy) >= distinct);
  const second = Math.max(other ? other.c : -1, otherRaw ? otherRaw.c : -1);
  const margin = top.c - second;
  const lines = countLines(A, top.p.oy);

  // ince doğrulama: daha büyük kopyada (yalnız örtüşen satırlar ve biraz payı) çizgi haritasıyla inceltme ve blok
  // blok ilinti. Üst parçanın kopyası a0 satırından başlar: orada ya' = ya − a0.
  const o0 = toOriginal(top.p, A, B);
  const FW = Math.min(FINE_W, PA.img.width, PB.img.width);
  const pad = Math.round(0.04 * PA.img.width) + 4;
  const a0 = clamp(Math.floor(o0.oy) - pad, 0, PA.img.height - 8);
  const b1 = clamp(Math.ceil((PA.img.height - o0.oy) / o0.sy) + pad, 8, PB.img.height);
  const Af = prepare(cropRows(PA.gray, a0, PA.img.height), FW, true);
  const Bf = prepare(cropRows(PB.gray, 0, b1), FW, true);
  const fine = refine(Af, Bf, fromOriginal({ ...o0, oy: o0.oy - a0 }, Af, Bf), 240, 0.5);
  const blocks = blockCheck(Af, Bf, fine.p);

  const cBand = clamp((top.s.band - BAND_LO) / (BAND_HI - BAND_LO), 0, 1);
  const cMargin = clamp(margin / MARGIN_FULL, 0, 1);
  const cLines = clamp((lines - 1) / 2, 0, 1);
  const cBlocks = blocks.blocks >= 4 ? clamp((BLOCK_BAD_MAX - blocks.bad) / (BLOCK_BAD_MAX - BLOCK_BAD_OK), 0, 1) : 0;
  const confidence = Math.round(cBand * Math.sqrt(cMargin) * cLines * cBlocks * 1000) / 1000;
  if (cBand === 0) reasons.push("icerik-tutmuyor");
  if (cMargin < 0.5) reasons.push("baska-yer-de-tutuyor");
  if (cLines < 1) reasons.push("ortusmede-yazi-az");
  if (cBlocks < 0.5) reasons.push("ayrintida-tutmuyor");
  const of = toOriginal(fine.p, Af, Bf);
  const o = { ...of, oy: of.oy + a0 };
  const seamW = seamRow(A, B, top.p);
  const seam = Math.round((seamW + 0.5) / A.ky - 0.5);
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return {
    best: {
      offsetX: Math.round(o.dx * 100) / 100,
      offsetY: Math.round(o.oy * 100) / 100,
      scaleX: Math.round(o.sx * 1e4) / 1e4,
      scaleY: Math.round(o.sy * 1e4) / 1e4,
      overlap: Math.round(PA.img.height - o.oy),
      score: r3(top.s.ncc),
      bandScore: r3(top.s.band),
      margin: r3(margin),
      lines,
      blocks: blocks.blocks,
      badBlocks: r3(blocks.bad),
      blockLow: r3(blocks.low),
      confidence,
      seam,
    },
    reasons,
  };
}

/** Parçaların ortak çalışma genişliği (en dar parçadan büyük olmaz) */
function workWidth(parts: readonly RgbaImage[]): number {
  return Math.max(32, Math.min(WORK_W, ...parts.map((p) => p.width)));
}

/**
 * Üst parça (`top`) ile alt parça (`bottom`) arasında örtüşme; emin olunmasa da en iyi aday ve nedenler döner
 * (tanı ve eşik ayarı için). Parçalar taranmış, dik ve aynı kâğıdın tam eniyle olmalı.
 */
export function probeOverlap(top: RgbaImage, bottom: RgbaImage): OverlapProbe {
  if (Math.min(top.width, bottom.width) < 64 || Math.min(top.height, bottom.height) < 32) return { best: null, reasons: ["parca-cok-kucuk"] };
  const W = workWidth([top, bottom]);
  return probeParts(partOf(top, W), partOf(bottom, W));
}

/** Üst ve alt parçanın örtüşmesi; yoksa ya da emin değilse null */
export function findOverlap(top: RgbaImage, bottom: RgbaImage, opts: Pick<StitchOptions, "minConfidence"> = {}): OverlapMatch | null {
  const r = probeOverlap(top, bottom);
  return r.best && r.best.confidence >= (opts.minConfidence ?? STITCH_MIN_CONFIDENCE) ? r.best : null;
}

// ---------------------------------------------------------------- birleştirme

/** Parçanın tuvale yerleşimi: parçanın (x, y) pikseli tuvalde (ox + sx · x, oy + sy · y) */
interface Place {
  ox: number;
  oy: number;
  sx: number;
  sy: number;
}

/** Renk kanallarının aydınlık yüzdeliği (kâğıdın rengi), parçanın [y0, y1) satırlarında, seyrek örnekle */
function paperLevels(img: RgbaImage, y0: number, y1: number): [number, number, number] {
  const out: [number, number, number] = [255, 255, 255];
  const a = clamp(Math.floor(y0), 0, img.height - 1);
  const b = clamp(Math.ceil(y1), a + 1, img.height);
  const step = Math.max(1, Math.floor(Math.sqrt(((b - a) * img.width) / 40_000)));
  for (let c = 0; c < 3; c++) {
    const hist = new Float64Array(256);
    let n = 0;
    for (let y = a; y < b; y += step) {
      for (let x = 0; x < img.width; x += step) {
        hist[img.data[(y * img.width + x) * 4 + c]]++;
        n++;
      }
    }
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= 0.9 * n) {
        out[c] = Math.max(1, v);
        break;
      }
    }
  }
  return out;
}

/** Parçayı tuvalin bir noktasında örnekler (çift doğrusal, kenara kenetlenir), kazançla */
function sampleInto(img: RgbaImage, pl: Place, gain: readonly number[], x: number, y: number, out: Float32Array): void {
  let u = (x - pl.ox) / pl.sx;
  let v = (y - pl.oy) / pl.sy;
  u = clamp(u, 0, img.width - 1);
  v = clamp(v, 0, img.height - 1);
  const x0 = Math.min(img.width - 2, Math.floor(u));
  const y0 = Math.min(img.height - 2, Math.floor(v));
  const fx = img.width > 1 ? u - x0 : 0;
  const fy = img.height > 1 ? v - y0 : 0;
  const x1 = Math.min(img.width - 1, x0 + 1);
  const y1 = Math.min(img.height - 1, y0 + 1);
  const d = img.data;
  const p00 = (y0 * img.width + Math.max(0, x0)) * 4;
  const p01 = (y0 * img.width + x1) * 4;
  const p10 = (y1 * img.width + Math.max(0, x0)) * 4;
  const p11 = (y1 * img.width + x1) * 4;
  for (let c = 0; c < 3; c++) {
    const t = d[p00 + c] + (d[p01 + c] - d[p00 + c]) * fx;
    const b = d[p10 + c] + (d[p11 + c] - d[p10 + c]) * fx;
    out[c] = (t + (b - t) * fy) * gain[c];
  }
}

/** Yerleşimleri bilinen parçaları tuvale çizer; dikişte ±`feather` satır yumuşak geçiş */
function compose(parts: readonly RgbaImage[], places: readonly Place[], gains: readonly number[][], seams: readonly number[], height: number, feather: number): RgbaImage {
  const W = parts[0].width;
  const out = new Uint8ClampedArray(W * height * 4);
  const ca = new Float32Array(3);
  const cb = new Float32Array(3);
  let owner = 0;
  for (let y = 0; y < height; y++) {
    while (owner < seams.length && y >= seams[owner]) owner++;
    // dikişe yakınsa (öncekinin ya da sonrakinin) iki parça karışır
    let blendWith = -1;
    let t = 0;
    if (owner > 0 && y < seams[owner - 1] + feather) {
      blendWith = owner - 1;
      t = 0.5 + (y - seams[owner - 1] + 0.5) / (2 * feather); // owner'ın ağırlığı
    } else if (owner < seams.length && y >= seams[owner] - feather) {
      blendWith = owner + 1;
      t = 0.5 + (seams[owner] - y - 0.5) / (2 * feather);
    }
    t = clamp(t, 0, 1);
    const img = parts[owner];
    const pl = places[owner];
    const direct = owner === 0 && blendWith < 0 && y < img.height;
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (direct) {
        const s = (y * img.width + x) * 4;
        out[o] = img.data[s] * gains[0][0];
        out[o + 1] = img.data[s + 1] * gains[0][1];
        out[o + 2] = img.data[s + 2] * gains[0][2];
      } else {
        sampleInto(img, pl, gains[owner], x, y, ca);
        if (blendWith >= 0) {
          sampleInto(parts[blendWith], places[blendWith], gains[blendWith], x, y, cb);
          for (let c = 0; c < 3; c++) ca[c] = ca[c] * t + cb[c] * (1 - t);
        }
        out[o] = ca[0];
        out[o + 1] = ca[1];
        out[o + 2] = ca[2];
      }
      out[o + 3] = 255;
    }
  }
  return { width: W, height, data: out };
}

/** Sıra numaralarının bütün dizilişleri (en çok 3 parça) */
function permutations(n: number): number[][] {
  if (n === 1) return [[0]];
  const out: number[][] = [];
  for (const rest of permutations(n - 1)) {
    for (let i = 0; i <= rest.length; i++) out.push([...rest.slice(0, i), n - 1, ...rest.slice(i)]);
  }
  return out;
}

/**
 * Uzun fişin parçalarını (yukarıdan aşağı sırayla; her biri taranmış ve dik) tek görüntüde birleştirir. Ardışık her
 * çiftin örtüşmesi bulunmalı; biri bile bulunamazsa ya da emin olunamazsa null (çağıran ayrı fotoğraf olarak yükler).
 * Verilen sıra tutmazsa (en çok 3 parçada) öteki sıralar denenir. Çıktının uzun kenarı en çok `maxEdge`.
 */
export function stitchParts(parts: readonly RgbaImage[], opts: StitchOptions = {}): StitchResult | null {
  const t0 = now();
  if (parts.length < 2) return null;
  if (parts.some((p) => p.width < 64 || p.height < 32)) return null;
  const minConf = opts.minConfidence ?? STITCH_MIN_CONFIDENCE;
  const maxEdge = opts.maxEdge ?? MAX_PHOTO_EDGE;
  const W = workWidth(parts);
  const ps = parts.map((p) => partOf(p, W));
  const cache = new Map<string, OverlapMatch | null>();
  const pair = (i: number, j: number): OverlapMatch | null => {
    const key = `${i}-${j}`;
    if (!cache.has(key)) {
      const r = probeParts(ps[i], ps[j]).best;
      cache.set(key, r && r.confidence >= minConf ? r : null);
    }
    return cache.get(key)!;
  };
  const chain = (order: number[]): OverlapMatch[] | null => {
    const ms: OverlapMatch[] = [];
    for (let k = 0; k + 1 < order.length; k++) {
      const m = pair(order[k], order[k + 1]);
      if (!m) return null;
      ms.push(m);
    }
    return ms;
  };
  const given = parts.map((_, i) => i);
  let order = given;
  let matches = chain(given);
  if (!matches && opts.anyOrder !== false && parts.length <= 3) {
    let bestSum = -1;
    for (const perm of permutations(parts.length)) {
      if (perm.every((v, i) => v === i)) continue;
      const ms = chain(perm);
      if (!ms) continue;
      const sum = ms.reduce((a, m) => a + m.confidence, 0);
      if (sum > bestSum) {
        bestSum = sum;
        order = perm;
        matches = ms;
      }
    }
  }
  if (!matches) return null;

  // yerleşimler: ilk parça tuvalin kendisi; her parça bir öncekine göre
  const ordered = order.map((i) => parts[i]);
  const places: Place[] = [{ ox: 0, oy: 0, sx: 1, sy: 1 }];
  const seams: number[] = [];
  const gains: number[][] = [[1, 1, 1]];
  for (let k = 0; k < matches.length; k++) {
    const m = matches[k];
    const prev = places[k];
    places.push({ ox: prev.ox + prev.sx * m.offsetX, oy: prev.oy + prev.sy * m.offsetY, sx: prev.sx * m.scaleX, sy: prev.sy * m.scaleY });
    seams.push(Math.round(prev.oy + prev.sy * m.seam));
    // alt parçanın kâğıt rengi üsttekine eşitlenir (örtüşen satırlarda)
    const lvA = paperLevels(ordered[k], m.offsetY, ordered[k].height);
    const lvB = paperLevels(ordered[k + 1], 0, m.overlap / m.scaleY);
    gains.push(gains[k].map((g, c) => g * clamp(lvA[c] / lvB[c], 0.75, 1.33)));
  }
  const last = places[places.length - 1];
  const height = Math.max(seams[seams.length - 1] + 1, Math.round(last.oy + last.sy * ordered[ordered.length - 1].height));
  const feather = Math.max(2, Math.round(0.006 * ordered[0].width));
  let image = compose(ordered, places, gains, seams, height, feather);
  let scale = 1;
  const fit = fitSize(image.width, image.height, maxEdge);
  if (fit.width !== image.width || fit.height !== image.height) {
    scale = fit.height / image.height;
    image = resizeRgba(image, fit.width, fit.height);
  }
  return {
    image,
    order,
    matches,
    seams: seams.map((s) => Math.round(s * scale)),
    scale: Math.round(scale * 1e4) / 1e4,
    confidence: Math.min(...matches.map((m) => m.confidence)),
    timing: Math.round(now() - t0),
  };
}
