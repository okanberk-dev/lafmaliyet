/**
 * Belge tarayıcı: çekim kalitesi. Fotoğraf çekilir çekilmez telefonda (saf TS, DOM yok) kâğıdın bölgesinde (dörtgen
 * verilirse onun içinde, açılmış hâlde) bakılır: bulanıklık, parlama, karanlık / düşük karşıtlık, kesik (yazılı bir
 * kenarın kadraj dışında kalması), çok küçük yazı ve birden çok belge. Her sorun sade Türkçe bir öneriyle döner; net
 * fotoğrafta hiç uyarı çıkmaz (eşikler yanlış alarmı düşük tutacak biçimde seçildi, tests/tarama-kalite.test.ts).
 * Belge: docs/FOTOGRAF.md › Belge tarama (kalite, yön, birleştirme).
 */

import type { GrayImage, Point, Quad, RgbaImage } from "./image";
import { boxMean, dilateMask, erodeMask, fitSize, labelComponents, maxFilter, minFilter, resizeRgba, scaleQuad, sobel, toGray } from "./image";
import { estimateSize, warpQuad } from "./warp";
import { sideOnFrame } from "./refine";
import { noiseSigma } from "./enhance";
import { analyzeText, inkMap, percentile, type TextLayout, type TextMask } from "./metin";
import { PHOTO_COMPRESS } from "../photo-compress";

export type QualityKind = "bulanik" | "parlama" | "karanlik" | "dusuk-karsitlik" | "kesik" | "kucuk-yazi" | "coklu-belge";

/** `ciddi`: yeniden çekmek gerekir (okuma büyük olasılıkla bozulur); `hafif`: yükleme sürer, öneri gösterilir */
export type QualitySeverity = "hafif" | "ciddi";

/** Belgenin kenarı (belgeye göre: `rotation` verildiyse çevrilmiş hâlin üstü / altı) */
export type DocSide = "ust" | "sag" | "alt" | "sol";

export interface QualityIssue {
  kind: QualityKind;
  severity: QualitySeverity;
  /** Kullanıcıya gösterilecek kısa öneri */
  text: string;
  /** `kesik` için hangi kenar */
  side?: DocSide;
}

/** Belgenin adı (uyarı metinlerinde: "Fişin altı kesilmiş", "Faturada parlama var") */
export type DocNoun = "fis" | "fatura" | "rapor" | "belge";

export interface QualityOptions {
  /** Kâğıdın köşeleri (asıl pikselde; sol üst, sağ üst, sağ alt, sol alt). Verilmezse bütün kare kâğıt sayılır. */
  corners?: Quad | null;
  /** Uyarı metinlerindeki ad; varsayılan "fis" */
  noun?: DocNoun;
  /**
   * Belgeyi dik yapmak için saat yönünde dönüş (orientation.ts › detectOrientation); kesik kenarın adı ("altı")
   * belgeye göre verilsin diye. Varsayılan 0.
   */
  rotation?: 0 | 90 | 180 | 270;
  /**
   * Okuyucunun göreceği görselin uzun kenarı (piksel); yazı boyu bu ölçekte de denetlenir. Varsayılan
   * PHOTO_COMPRESS.maxEdge (2576: yapay zekânın ayrıntı kaybetmeden okuduğu en büyük ölçü).
   */
  readEdge?: number;
  /** Çözümlemenin çalışma kopyası (kâğıdın uzun kenarı); varsayılan 1400 */
  workEdge?: number;
}

export interface QualityMetrics {
  /** Çalışma kopyasının ölçüsü ve asıl fotoğrafa oranı (çalışma pikseli / asıl piksel) */
  work: { width: number; height: number; scale: number };
  /** Kâğıdın parlaklığı (0–255, yerel zeminin ortancası) */
  paper: number;
  /** Yazı ile kâğıt arasındaki tipik fark (0–255) */
  contrast: number;
  /** Gürültü (σ, 0–255) */
  noise: number;
  /** Yazı satırları bulundu mu ve harf boyu (çalışma pikseli) */
  text: boolean;
  glyph: number;
  /** Kenar bulanıklığı (σ, çalışma pikseli): yatay ve dikey kenarlar ayrı (hareket bulanıklığı tek yönlüdür) */
  blurSigma: number;
  blurSigmaX: number;
  blurSigmaY: number;
  /** Bulanıklığın harf boyuna oranı (karar bununla) */
  blurRatio: number;
  /** Laplace varyansı (karşıtlığın karesine ve harf boyuna göre normalize; büyük = keskin) */
  laplace: number;
  /** Kenar ölçümünde kullanılan nokta sayısı */
  edgePoints: number;
  /** Harf boyu asıl fotoğrafta ve okuyucunun göreceği ölçekte (piksel) */
  glyphPhoto: number;
  glyphRead: number;
  /** Parlamanın kâğıda oranı ve yazının üstünde mi */
  glare: number;
  glareOnText: boolean;
  /** Yazının kenara dayandığı ve kadraj dışında kalan kenarlar (görüntüye göre: üst, sağ, alt, sol) */
  cutSides: DocSide[];
  /** Dörtgen dışında (ya da karede) bulunan öteki yazılı kâğıt sayısı */
  otherDocs: number;
}

export interface QualityReport {
  /** Ciddi sorun yoksa doğru (hafif uyarılar olabilir) */
  ok: boolean;
  issues: QualityIssue[];
  metrics: QualityMetrics;
  /** ms */
  timing: number;
}

// ---------------------------------------------------------------- eşikler (tests/tarama-kalite.test.ts ile seçildi)

/** Bulanıklık σ'sının harf boyuna oranı: üstü hafif / ciddi */
export const BLUR_WARN = 0.15;
export const BLUR_BAD = 0.21;
/** Kâğıdın parlaklığı (0–255): altı hafif / ciddi karanlık */
export const DARK_WARN = 95;
export const DARK_BAD = 65;
/** Yazının kâğıda karşıtlığı (0–255) ve gürültüye oranı: altı düşük karşıtlık */
export const CONTRAST_WARN = 28;
export const CONTRAST_BAD = 16;
export const SNR_WARN = 5;
export const SNR_BAD = 3;
/** Harf boyu (piksel; okuyucunun göreceği ölçekte): altı hafif / ciddi */
export const GLYPH_WARN = 10;
export const GLYPH_BAD = 7;
/** Parlamanın kâğıda oranı: yazının üstünde değilse bunun üstü hafif uyarı */
export const GLARE_AREA_WARN = 0.03;
/** Parlama: gürültüsü yumuşatılmış parlaklığın doyma düzeyi (0–255) */
export const GLARE_LEVEL = 249;
/** Kesik: kadraj dışındaki kenardan ilk satıra boşluk, satır aralığının bu katından azsa */
export const CUT_GAP = 0.35;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const NOUN: Record<DocNoun, { gen: string; loc: string; acc: string }> = {
  fis: { gen: "Fişin", loc: "Fişte", acc: "fişi" },
  fatura: { gen: "Faturanın", loc: "Faturada", acc: "faturayı" },
  rapor: { gen: "Raporun", loc: "Raporda", acc: "raporu" },
  belge: { gen: "Belgenin", loc: "Belgede", acc: "belgeyi" },
};

const SIDE_TEXT: Record<DocSide, string> = { ust: "üstü", sag: "sağı", alt: "altı", sol: "solu" };

/** Uyarı metni (sade Türkçe; arayüz olduğu gibi gösterir) */
export function issueText(kind: QualityKind, noun: DocNoun = "fis", side?: DocSide, severity: QualitySeverity = "ciddi"): string {
  const n = NOUN[noun];
  switch (kind) {
    case "bulanik":
      return "Fotoğraf bulanık; telefonu sabit tutup yeniden çekin.";
    case "parlama":
      return severity === "ciddi" ? `${n.loc} parlama var; ışığı yandan alın.` : `${n.loc} parlama var; yazı okunmuyorsa ışığı yandan alıp yeniden çekin.`;
    case "karanlik":
      return "Fotoğraf karanlık; ışıklı bir yerde çekin.";
    case "dusuk-karsitlik":
      return "Yazı soluk seçiliyor; ışıklı bir yerde, gölgesiz çekin.";
    case "kesik":
      return `${n.gen} ${SIDE_TEXT[side ?? "alt"]} kesilmiş; tamamını çekin.`;
    case "kucuk-yazi":
      return "Yazı çok küçük; yaklaşıp çekin.";
    case "coklu-belge":
      return `Fotoğrafta birden çok belge var; her ${n.acc} ayrı çekin.`;
  }
}

/** Uzun fişte yazı küçük kalıyorsa (yaklaşmak sığmaz): parça parça çekme önerisi */
export function longPaperText(noun: DocNoun = "fis"): string {
  return `Yazı çok küçük kalıyor; ${NOUN[noun].acc} üst ve alt yarı olarak iki parçada çekin.`;
}

// ---------------------------------------------------------------- yardımcılar

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Dikdörtgen bölge (RGBA) */
function cropRgba(img: RgbaImage, x0: number, y0: number, x1: number, y1: number): RgbaImage {
  const w = x1 - x0;
  const h = y1 - y0;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) out.set(img.data.subarray(((y + y0) * img.width + x0) * 4, ((y + y0) * img.width + x1) * 4), y * w * 4);
  return { width: w, height: h, data: out };
}

/** σ ≈ EDGE_K · yerel karşıtlık / türevin tepesi; EDGE_FLOOR: keskin kenarda ölçülen taban (piksel) */
const EDGE_K = 0.36;
const EDGE_FLOOR = 0.92;

export interface EdgeBlur {
  /** σ (piksel): ortanca, yatay türevli (x yönünde bulanıklık) ve dikey türevli kenarlarda */
  sigma: number;
  sigmaX: number;
  sigmaY: number;
  /** kullanılan kenar noktası */
  points: number;
  /** Kenar noktalarında Laplace'ın karesel ortalamasının kökü / yerel karşıtlık (büyük = keskin) */
  laplace: number;
}

/**
 * Yazı kenarlarının bulanıklığı. σ ile bulanık bir kenarda türevin tepesi yerel karşıtlığın 1/σ'sı kadardır: geniş
 * basamakta C / (σ√2π) ≈ 0,40·C/σ, σ'dan ince çizgide (harf sapı) 0,61·C/σ (C: bulanık çizginin gözlenen
 * karşıtlığı); çizgi kalınlığından bağımsız, ±%25. Karşıtlık her kenar noktasının çevresinde (harf boyunun ~0,6'sı
 * yarıçaplı pencerede en açık − en koyu) ölçülür: soluk baskı da ışık da etkilemez. Katsayı ve örneklemenin tabanı
 * (keskin kenar ~0,9 px) bilinen Gauss bulanıklığıyla ayarlandı. Yalnız yazının çevresindeki, türev yönünde yerel en
 * büyük olan kenar noktaları sayılır; yatay ve dikey türevli kenarlar ayrı ölçülür (hareket bulanıklığı tek yönlüdür).
 */
export function edgeBlur(g: GrayImage, near: Uint8Array, glyph: number, noise: number): EdgeBlur {
  const { width: w, height: h } = g;
  const s0 = sobel(g);
  const m0 = new Float32Array(w * h);
  for (let i = 0; i < m0.length; i++) m0[i] = Math.sqrt(s0.gx[i] * s0.gx[i] + s0.gy[i] * s0.gy[i]);
  const r = Math.max(2, Math.round(0.6 * glyph));
  const hi = maxFilter(g, r).data;
  const lo = minFilter(g, r).data;
  const sx: number[] = [];
  const sy: number[] = [];
  let lap2 = 0;
  let lapN = 0;
  let cSum = 0;
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (!near[i]) continue;
      const m = m0[i];
      const C = hi[i] - lo[i];
      // gürültüden ayrılan, yeterince karşıtlıklı kenar (türev gürültüsü ~0,43σ)
      if (C < Math.max(12, 6 * noise) || m < Math.max(1.5, 1.3 * noise, 0.03 * C)) continue;
      const ax = Math.abs(s0.gx[i]);
      const ay = Math.abs(s0.gy[i]);
      const horiz = ax >= ay;
      // türev yönünde yerel en büyük (çapraz kenarlar ölçümü bulandırır: baskın yön en az 2 kat)
      if (horiz ? ax < 2 * ay : ay < 2 * ax) continue;
      const d = horiz ? 1 : w;
      if (m < m0[i - d] || m < m0[i + d]) continue;
      const lp = g.data[i - 1] + g.data[i + 1] + g.data[i - w] + g.data[i + w] - 4 * g.data[i];
      lap2 += lp * lp;
      cSum += C * C;
      lapN++;
      (horiz ? sx : sy).push(Math.min(12, (EDGE_K * C) / m));
    }
  }
  // ortanca; örneklemenin tabanı (keskin kenarda ölçülen) karesel olarak düşülür
  const med = (a: number[]) => {
    if (a.length < 30) return NaN;
    a.sort((p, q) => p - q);
    const v = a[Math.floor(a.length * 0.5)];
    return Math.sqrt(Math.max(0, v * v - EDGE_FLOOR * EDGE_FLOOR));
  };
  const mx = med(sx);
  const my = med(sy);
  const all = sx.concat(sy);
  const sigma = med(all);
  return {
    sigma: Number.isFinite(sigma) ? sigma : 0,
    sigmaX: Number.isFinite(mx) ? mx : Number.isFinite(sigma) ? sigma : 0,
    sigmaY: Number.isFinite(my) ? my : Number.isFinite(sigma) ? sigma : 0,
    points: all.length,
    laplace: lapN && cSum > 0 ? Math.sqrt(lap2 / cSum) : 0,
  };
}

/** Görüntünün maskeli piksellerinde yüzdelik */
function maskedPercentile(data: Float32Array, mask: Uint8Array, p: number): number {
  const hist = new Float64Array(256);
  let n = 0;
  for (let i = 0; i < data.length; i++) {
    if (!mask[i]) continue;
    hist[clamp(Math.floor(data[i]), 0, 255)]++;
    n++;
  }
  let acc = 0;
  for (let b = 0; b < 256; b++) {
    acc += hist[b];
    if (acc >= p * n) return b + 0.5;
  }
  return 255;
}

/**
 * Kenar ile yazı arasındaki ilişki (0 üst, 1 sağ, 2 alt, 3 sol): kenara değen (kenarca kesilmiş) harf bileşeni sayısı
 * ve kenar boyunca kapladığı oran, kenardan ilk yazı satırına / sütununa boşluk (piksel) ve kenar şeridinin yazı
 * yoğunluğunun bütün yazıya oranı.
 */
interface SideText {
  touching: number;
  spread: number;
  gap: number;
  density: number;
}

function sideText(L: TextLayout, tm: TextMask, w: number, h: number, glyph: number, depth: number): SideText[] {
  const c = L.components;
  const rows = new Float32Array(h);
  const cols = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!tm.mask[y * w + x]) continue;
      rows[y]++;
      cols[x]++;
    }
  }
  const out: SideText[] = [];
  for (let s = 0; s < 4; s++) {
    const along = s % 2 === 0 ? w : h;
    const across = s % 2 === 0 ? h : w;
    const prof = s % 2 === 0 ? rows : cols;
    const fromEnd = s === 1 || s === 2;
    const at = (k: number) => prof[fromEnd ? across - 1 - k : k];
    const cover = new Uint8Array(along);
    let touching = 0;
    for (let l = 1; l <= c.count; l++) {
      const t = s === 0 ? c.minY[l] <= 1 : s === 1 ? c.maxX[l] >= w - 2 : s === 2 ? c.maxY[l] >= h - 2 : c.minX[l] <= 1;
      if (!t || c.areas[l] < 3) continue;
      // kenarca kesilmiş harf: kenar boyunca harf boyunda ya da sözcük uzunluğunda, kenara dik yönde harften kısa
      // (kesik harfin kalan dilimi ince olabilir; kâğıt kenarının gölgesi gibi uzun bileşenler sayılmaz)
      const bw = c.maxX[l] - c.minX[l] + 1;
      const bh = c.maxY[l] - c.minY[l] + 1;
      const alongExt = s % 2 === 0 ? bw : bh;
      const acrossExt = s % 2 === 0 ? bh : bw;
      if (alongExt < 0.3 * glyph || alongExt > 12 * glyph || acrossExt > 2.5 * glyph) continue;
      touching++;
      const a = s % 2 === 0 ? c.minX[l] : c.minY[l];
      const b = s % 2 === 0 ? c.maxX[l] : c.maxY[l];
      for (let k = a; k <= b; k++) cover[k] = 1;
    }
    let cov = 0;
    for (let k = 0; k < along; k++) cov += cover[k];
    // ilk yazı satırı: kenar boyunca en az %0,4'ü (en az 2 piksel) yazı
    const min = Math.max(2, 0.004 * along);
    let gap = across;
    for (let k = 0; k < across; k++) {
      if (at(k) >= min) {
        gap = k;
        break;
      }
    }
    // kenar şeridi (ilk yazıdan başlayarak `depth` kalınlıkta) bütün yazının yoğunluğuna oranla
    let n = 0;
    const d0 = Math.min(across, gap);
    const d1 = Math.min(across, gap + depth);
    for (let k = d0; k < d1; k++) n += at(k);
    const area = Math.max(1, (d1 - d0) * along);
    out.push({ touching, spread: cov / along, gap, density: tm.density > 0 ? n / area / tm.density : 0 });
  }
  return out;
}

/**
 * Öteki belgeler: küçük tam kare kopyada aydınlık, renksiz (kâğıt gibi) ve içinde harf boyunda yazı olan bölgeler.
 * Dörtgen verildiyse onun dışında kalanlar, verilmediyse en büyüğünden başkaları sayılır.
 */
function otherDocuments(img: RgbaImage, corners: Quad | null, glyphOrig: number): number {
  const sz = fitSize(img.width, img.height, 700);
  const small = sz.width === img.width && sz.height === img.height ? img : resizeRgba(img, sz.width, sz.height);
  const { width: w, height: h } = small;
  const k = w / img.width;
  const g = toGray(small);
  // kâğıt: parlak (görüntünün %90'lık parlaklığının %72'si üstü) ve az renkli
  const p90 = percentile(g.data, 0.9, 0, 256);
  const paper = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = small.data[i * 4];
    const gg = small.data[i * 4 + 1];
    const b = small.data[i * 4 + 2];
    const sat = Math.max(r, gg, b) - Math.min(r, gg, b);
    if (g.data[i] >= 0.72 * p90 && sat <= 0.25 * Math.max(r, gg, b) + 8) paper[i] = 1;
  }
  // yazıyı kâğıda kat (kapama), ince köprüleri kes (açma)
  const glyph = Math.max(1, glyphOrig * k);
  const rClose = Math.max(1, Math.round(1.2 * glyph));
  let m = erodeMask(dilateMask(paper, w, h, rClose), w, h, rClose);
  m = dilateMask(erodeMask(m, w, h, 2), w, h, 2);
  // verilen dörtgenin içi (biraz büyütülmüş) sayılmaz
  if (corners) {
    const q = scaleQuad(corners, img.width, img.height, w, h);
    const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
    const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
    const g2 = q.map((p) => ({ x: cx + (p.x - cx) * 1.06, y: cy + (p.y - cy) * 1.06 }));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let inside = true;
        for (let i = 0; i < 4 && inside; i++) {
          const a = g2[i];
          const b = g2[(i + 1) % 4];
          if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) inside = false;
        }
        if (inside) m[y * w + x] = 0;
      }
    }
  }
  const comps = labelComponents(m, w, h);
  const ink = inkMap(g);
  const minArea = 0.03 * w * h;
  const docs: number[] = [];
  for (let l = 1; l <= comps.count; l++) {
    if (comps.areas[l] < minArea) continue;
    // bölgedeki harf boyunda mürekkep bileşenleri
    const bx0 = comps.minX[l];
    const by0 = comps.minY[l];
    const bx1 = comps.maxX[l];
    const by1 = comps.maxY[l];
    const sub = new Uint8Array((bx1 - bx0 + 1) * (by1 - by0 + 1));
    const sw = bx1 - bx0 + 1;
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const i = y * w + x;
        if (comps.labels[i] === l || (ink.mask[i] && m[i])) sub[(y - by0) * sw + (x - bx0)] = ink.mask[i];
      }
    }
    const cc = labelComponents(sub, sw, by1 - by0 + 1, true);
    let glyphs = 0;
    for (let c = 1; c <= cc.count; c++) {
      const bw = cc.maxX[c] - cc.minX[c] + 1;
      const bh = cc.maxY[c] - cc.minY[c] + 1;
      if (Math.min(bw, bh) >= 1 && Math.max(bw, bh) <= 4 * glyph + 2 && Math.min(bw, bh) <= 2 * glyph + 1) glyphs++;
    }
    if (glyphs >= 25) docs.push(comps.areas[l]);
  }
  if (corners) return docs.length;
  return Math.max(0, docs.length - 1);
}

/** Görüntüye göre kenarı (0 üst, 1 sağ, 2 alt, 3 sol) belgeye göre adlandırır */
function docSide(imageSide: number, rotation: number): DocSide {
  const turns = Math.round(rotation / 90) & 3;
  const order: DocSide[] = ["ust", "sag", "alt", "sol"];
  // belge saat yönünde `turns` çevrilince görüntünün s kenarı belgenin (s + turns) kenarı olur
  return order[(imageSide + turns) & 3];
}

// ---------------------------------------------------------------- ana işlev

/**
 * Çekim kalitesi. `corners` verilirse kâğıt açılıp (perspektif düzeltilir) içine bakılır; verilmezse bütün kare.
 * Döner: `ok` (ciddi sorun yok), sorunlar (tür, ağırlık, sade Türkçe öneri) ve ölçümler. Saf ve eşzamanlı; büyük
 * fotoğrafta bile yalnız ~1400 px'lik kopyada çalışır.
 */
export function assessQuality(img: RgbaImage, opts: QualityOptions = {}): QualityReport {
  const t0 = now();
  const noun = opts.noun ?? "fis";
  const workEdge = opts.workEdge ?? 1400;
  const readEdge = opts.readEdge ?? PHOTO_COMPRESS.maxEdge;
  const corners = opts.corners ?? null;
  let work: RgbaImage;
  let scale: number;
  let paperLongOrig: number;
  let onFrame = [true, true, true, true];
  if (corners) {
    const sides = [dist(corners[0], corners[1]), dist(corners[1], corners[2]), dist(corners[3], corners[2]), dist(corners[0], corners[3])];
    paperLongOrig = Math.max(...sides);
    const paperShortOrig = Math.max(1, Math.min(Math.max(sides[0], sides[2]), Math.max(sides[1], sides[3])));
    // dar uzun fişte kısa kenar en az ~360 px kalsın (harf boyu ölçülebilsin), alan ~1,6 MP'yi aşmasın
    let edge = workEdge;
    if ((paperShortOrig * workEdge) / paperLongOrig < 360) {
      edge = Math.min((360 * paperLongOrig) / paperShortOrig, Math.sqrt((1.6e6 * paperLongOrig) / paperShortOrig));
    }
    const size = estimateSize(corners, img.width, img.height, Math.max(workEdge, edge));
    const warped = warpQuad(img, corners, size.width, size.height);
    scale = Math.max(size.width, size.height) / paperLongOrig;
    // dörtgenin kenarında kalabilecek ince zemin şeridi çözümlemeye girmesin (uzun ince bileşen harf sayılmaz zaten)
    const ix = Math.max(2, Math.round(size.width * 0.006));
    const iy = Math.max(2, Math.round(size.height * 0.006));
    work = cropRgba(warped, ix, iy, size.width - ix, size.height - iy);
    const tol = Math.max(2, 0.012 * Math.min(img.width, img.height));
    onFrame = [0, 1, 2, 3].map((i) => sideOnFrame(corners[i], corners[(i + 1) % 4], img.width, img.height, tol));
  } else {
    const short = Math.min(img.width, img.height);
    const long = Math.max(img.width, img.height);
    const edge = (short * workEdge) / long < 360 ? Math.min((360 * long) / short, Math.sqrt((1.6e6 * long) / short)) : workEdge;
    const sz = fitSize(img.width, img.height, Math.max(workEdge, edge));
    work = sz.width === img.width && sz.height === img.height ? img : resizeRgba(img, sz.width, sz.height);
    scale = work.width / img.width;
    paperLongOrig = Math.max(img.width, img.height);
  }
  const { width: w, height: h } = work;
  const g = toGray(work);
  const L = analyzeText(g);
  const ink = L.ink;
  const text = L.glyphHeight > 0;
  const glyph = L.glyphHeight;
  // harf boyu bulunamadıysa (çok bulanık yazı birbirine karışır) kâğıdın kısa kenarının 1/45'i varsayılır
  const glyphRef = text ? glyph : Math.max(8, Math.min(w, h) / 45);
  const tm = L.text;
  // kâğıdın parlaklığı yazının çevresinde (dörtgen yoksa zemin karışmasın); yazı yoksa parlak bölge
  const around = tm.count >= 50 ? dilateMask(tm.mask, w, h, Math.max(2, Math.round(glyphRef))) : null;
  const paper = around ? maskedPercentile(ink.bg, around, 0.5) : percentile(ink.bg, 0.9, 0, 256);
  const contrast = paper * ink.inkLevel;
  const noise = noiseSigma(g);
  const issues: QualityIssue[] = [];
  const add = (kind: QualityKind, severity: QualitySeverity, side?: DocSide, textOverride?: string) =>
    issues.push({ kind, severity, text: textOverride ?? issueText(kind, noun, side, severity), ...(side ? { side } : {}) });

  // karanlık / düşük karşıtlık
  if (paper < DARK_BAD) add("karanlik", "ciddi");
  else if (paper < DARK_WARN) add("karanlik", "hafif");
  const snr = noise > 0 ? contrast / noise : Infinity;
  if (text && paper >= DARK_BAD) {
    if (contrast < CONTRAST_BAD || snr < SNR_BAD) add("dusuk-karsitlik", "ciddi");
    else if (contrast < CONTRAST_WARN || snr < SNR_WARN) add("dusuk-karsitlik", "hafif");
  }

  // bulanıklık: yazının çevresindeki kenarlar (yazı yoksa koyu her şeyin çevresi)
  const near = dilateMask(tm.count >= 50 ? tm.mask : ink.mask, w, h, 2);
  const eb = edgeBlur(g, near, glyphRef, noise);
  const sig = Math.max(eb.sigmaX, eb.sigmaY);
  const blurRatio = eb.points >= 30 ? sig / glyphRef : 0;
  if (eb.points >= 30 && ink.inkLevel > 0.15) {
    if (blurRatio > BLUR_BAD) add("bulanik", "ciddi");
    else if (blurRatio > BLUR_WARN) add("bulanik", "hafif");
  }

  // yazı boyu: asıl fotoğrafta ve okuyucunun göreceği ölçekte
  const glyphPhoto = text ? glyph / scale : 0;
  const readScale = Math.min(1, readEdge / Math.max(1, paperLongOrig));
  const glyphRead = glyphPhoto * readScale;
  if (text && !issues.some((i) => i.kind === "bulanik" && i.severity === "ciddi")) {
    const sev: QualitySeverity | null = glyphRead < GLYPH_BAD ? "ciddi" : glyphRead < GLYPH_WARN ? "hafif" : null;
    if (sev) {
      // fotoğrafta yazı yeterince büyük ama okuyucunun ölçeğine sığmıyorsa (uzun fiş): yaklaşmak değil parça parça çekim
      const photoLimited = glyphPhoto < (sev === "ciddi" ? GLYPH_BAD : GLYPH_WARN);
      add("kucuk-yazi", sev, undefined, photoLimited ? undefined : longPaperText(noun));
    }
  }

  // parlama: kâğıtta doymuş (gürültüsü yumuşatılmış parlaklık ≥ 249), çevresindeki kâğıttan belirgin parlak leke. Kâğıt
  // zaten doymuşsa (aşırı pozlama) leke ayırt edilemez, bakılmaz.
  let glare = 0;
  let glareOnText = false;
  if (paper < GLARE_LEVEL - 3) {
    const sm = boxMean(g, 1).data;
    const m = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (sm[i] >= GLARE_LEVEL) m[i] = 1;
    const opened = dilateMask(erodeMask(m, w, h, 1), w, h, 1);
    const comps = labelComponents(opened, w, h);
    const minArea = Math.max(0.0015 * w * h, 4 * glyphRef * glyphRef);
    const pitch = L.lines.linePitch || 1.8 * glyphRef;
    const textDens = tm.density;
    for (let l = 1; l <= comps.count; l++) {
      if (comps.areas[l] < minArea) continue;
      // lekenin çevresindeki halka (satır aralığının ~1,2 katı): yazı yoğunluğu ve kâğıdın parlaklığı
      const r = Math.max(3, Math.round(1.2 * pitch));
      const bx0 = Math.max(0, comps.minX[l] - r);
      const by0 = Math.max(0, comps.minY[l] - r);
      const bx1 = Math.min(w - 1, comps.maxX[l] + r);
      const by1 = Math.min(h - 1, comps.maxY[l] + r);
      const bw = bx1 - bx0 + 1;
      const bh = by1 - by0 + 1;
      const blob = new Uint8Array(bw * bh);
      for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) if (comps.labels[y * w + x] === l) blob[(y - by0) * bw + (x - bx0)] = 1;
      const ring = dilateMask(blob, bw, bh, r);
      let inInk = 0;
      let inN = 0;
      let ringInk = 0;
      let ringN = 0;
      const ringHist = new Float64Array(256);
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const j = y * bw + x;
          const i = (y + by0) * w + x + bx0;
          const v = tm.mask[i];
          if (blob[j]) {
            inInk += v;
            inN++;
          } else if (ring[j]) {
            ringInk += v;
            ringN++;
            if (!v) ringHist[clamp(Math.floor(sm[i]), 0, 255)]++;
          }
        }
      }
      // halkadaki kâğıdın ortancası lekeden belirgin koyu değilse (kâğıdın kendisi parlak) parlama sayılmaz
      let acc = 0;
      let ringPaper = 255;
      const half = ringHist.reduce((a, b) => a + b, 0) / 2;
      for (let b = 0; b < 256; b++) {
        acc += ringHist[b];
        if (acc >= half) {
          ringPaper = b;
          break;
        }
      }
      if (ringPaper > GLARE_LEVEL - 6) continue;
      glare += comps.areas[l];
      // yazının üstünde mi: çevresindeki halkada yazı var, içinde yok
      const ringD = ringN ? ringInk / ringN : 0;
      const inD = inN ? inInk / inN : 0;
      if (text && ringD >= 0.5 * textDens && inD <= 0.35 * ringD) glareOnText = true;
    }
    glare /= w * h;
  }
  if (glareOnText) add("parlama", "ciddi");
  else if (glare >= GLARE_AREA_WARN) add("parlama", "hafif");

  // kesik: kâğıdın kadraj dışında kalan kenarı (dörtgen yoksa karenin kenarı) yazıyı kesiyor ya da satırlar kenara
  // dayanıyor. Satırlara koşut kenarda (fişin altı) ilk satıra boşluk satır aralığının ~üçte birinden azsa (kesik
  // satırların arasından geçmiş), satırların koştuğu kenarda (fişin yanı) harfler kenarca kesilmişse.
  const cutSides: DocSide[] = [];
  if (text && L.axis.axis) {
    const pitch = L.lines.linePitch || 2 * glyphRef;
    const st = sideText(L, tm, w, h, glyphRef, Math.round(pitch));
    for (let s = 0; s < 4; s++) {
      if (!onFrame[s]) continue;
      const v = st[s];
      const parallel = (L.axis.axis === "yatay") === (s % 2 === 0);
      const cutText = v.touching >= 3 && v.spread >= 0.12 && v.density >= 0.25;
      const nearLine = parallel && v.gap < CUT_GAP * pitch && v.density >= 0.3;
      if (cutText || nearLine) cutSides.push(docSide(s, opts.rotation ?? 0));
    }
    for (const side of cutSides) add("kesik", "ciddi", side);
  }

  // birden çok belge
  const otherDocs = text ? otherDocuments(img, corners, glyphPhoto) : 0;
  if (otherDocs > 0) add("coklu-belge", corners ? "hafif" : "ciddi");

  const order: QualityKind[] = ["kesik", "bulanik", "karanlik", "parlama", "dusuk-karsitlik", "kucuk-yazi", "coklu-belge"];
  issues.sort((a, b) => (a.severity === b.severity ? order.indexOf(a.kind) - order.indexOf(b.kind) : a.severity === "ciddi" ? -1 : 1));
  const r1 = (v: number) => Math.round(v * 100) / 100;
  return {
    ok: !issues.some((i) => i.severity === "ciddi"),
    issues,
    metrics: {
      work: { width: w, height: h, scale: Math.round(scale * 1e4) / 1e4 },
      paper: r1(paper),
      contrast: r1(contrast),
      noise: r1(noise),
      text,
      glyph,
      blurSigma: r1(eb.sigma),
      blurSigmaX: r1(eb.sigmaX),
      blurSigmaY: r1(eb.sigmaY),
      blurRatio: Math.round(blurRatio * 1000) / 1000,
      laplace: r1(eb.laplace * glyphRef),
      edgePoints: eb.points,
      glyphPhoto: r1(glyphPhoto),
      glyphRead: r1(glyphRead),
      glare: Math.round(glare * 1e4) / 1e4,
      glareOnText,
      cutSides,
      otherDocs,
    },
    timing: Math.round(now() - t0),
  };
}
