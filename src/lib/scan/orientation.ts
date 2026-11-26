/**
 * Belge tarayıcı: sayfa yönü (90°, 180°, 270° döndürülmüş belge) yazıya bakılarak, saf TS (DOM yok). Önce satırların
 * yönü (yatay / dikey: harf maskesinin yönlülüğü, metin.ts › textAxis); sonra düz mü ters mi, üç ipucuyla:
 *
 * 1. Satırın biçimi: satırın gövdesinin (harflerin çoğunun kapladığı bant) üstünde kalan mürekkep altında kalandan
 *    çoktur. Küçük harfte b d f h k l t, büyük harf ve i noktası yukarı; g p y ç ş ve virgül aşağı taşar. Büyük harfli
 *    Türkçe fişte İ Ö Ü Ğ'nin noktaları yukarı, yalnız Ç Ş ve virgül aşağı taşar.
 * 2. Yaslama: soldan sağa yazıda kısa satırlar sola yaslıdır (paragraf sonu, "FİŞ NO: 0042"); ters çevrilince sağa.
 * 3. Başlık: fişin başlığı (işletme adı, adres) ortalı satırlarla başlar; ters çevrilince ortalı satırlar sona geçer.
 *
 * İpuçları ağırlıkla toplanır; toplam zayıfsa ya da ipuçları çelişiyorsa "bilinmiyor" (çağıran döndürmez, yapay zekâ
 * okurken yönü kendisi bulur). Belge: docs/FOTOGRAF.md › Belge tarama (kalite, yön, birleştirme).
 */

import type { GrayImage, Quad, RgbaImage } from "./image";
import { fitSize, labelComponents, resizeGray, toGray } from "./image";
import { estimateSize, warpQuad } from "./warp";
import { analyzeText } from "./metin";

export type QuarterTurn = 0 | 90 | 180 | 270;

export interface OrientationCues {
  /**
   * Küçük işaretler: (taban çizgisindeki nokta / virgül + gövdenin üstündeki harf noktaları − tersi) / işaret sayısı;
   * artı = düz
   */
  marks: number;
  /** Sayılan küçük işaret */
  markCount: number;
  /** Yaslama: (sola yaslı − sağa yaslı kısa satır) / sayı; artı = düz */
  align: number;
  /** Başlık: baştaki ortalı satırlar − sondakiler; artı = düz */
  header: number;
  /** Ölçülen satır parçası sayısı */
  segments: number;
}

export interface OrientationResult {
  /** Belgeyi dik yapmak için saat yönünde dönüş (warp.ts › rotateQuarter(img, rotation / 90)); emin değilse "bilinmiyor" */
  rotation: QuarterTurn | "bilinmiyor";
  /** Satırları yataya getiren dönüş (0 ya da 90; düz / ters bilinmese de); yazı yönü de bulunamadıysa null */
  lineRotation: 0 | 90 | null;
  /** Emin olunmasa da en olası dönüş (yazı yoksa null) */
  guess: QuarterTurn | null;
  /** 0–1: satır yönünün ve düz / ters kararının güveninin çarpımı */
  confidence: number;
  axisConfidence: number;
  flipConfidence: number;
  cues: OrientationCues;
  reasons: string[];
}

export interface OrientationOptions {
  /** Kâğıdın köşeleri (asıl pikselde); verilirse yalnız kâğıdın içine (açılmış) bakılır */
  corners?: Quad | null;
  /** Bunun altındaki güvende "bilinmiyor"; varsayılan 0,5 */
  minConfidence?: number;
  /** Çalışma kopyasının uzun kenarı; varsayılan 1400 */
  workEdge?: number;
}

/** İpuçlarının ağırlıkları ve ölçekleri (tests/tarama-yon.test.ts ile seçildi) */
const MARK_SCALE = 0.3;
const W_MARKS = 0.5;
const W_ALIGN = 0.3;
const W_HEADER = 0.2;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** İkili maskeyi saat yönünde çeyrek turlarla çevirir (warp.ts › rotateQuarter ile aynı kural) */
export function rotateMask(m: Uint8Array, w: number, h: number, turns: number): { mask: Uint8Array; width: number; height: number } {
  const t = ((Math.round(turns) % 4) + 4) % 4;
  if (t === 0) return { mask: m, width: w, height: h };
  const ow = t % 2 ? h : w;
  const oh = t % 2 ? w : h;
  const out = new Uint8Array(ow * oh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      let nx: number;
      let ny: number;
      if (t === 1) {
        nx = h - 1 - y;
        ny = x;
      } else if (t === 2) {
        nx = w - 1 - x;
        ny = h - 1 - y;
      } else {
        nx = y;
        ny = w - 1 - x;
      }
      out[ny * ow + nx] = 1;
    }
  }
  return { mask: out, width: ow, height: oh };
}

/** Dikdörtgen pencereyle ikili genişletme (yatay rx, dikey ry; ayrılabilir koşan toplam) */
function dilateRect(m: Uint8Array, w: number, h: number, rx: number, ry: number): Uint8Array {
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let count = 0;
    for (let x = 0; x < Math.min(w, rx); x++) count += m[row + x];
    for (let x = 0; x < w; x++) {
      if (x + rx < w) count += m[row + x + rx];
      if (x - rx - 1 >= 0) count -= m[row + x - rx - 1];
      tmp[row + x] = count > 0 ? 1 : 0;
    }
  }
  if (ry <= 0) return tmp;
  const out = new Uint8Array(w * h);
  const col = new Int32Array(w);
  for (let y = 0; y < Math.min(h, ry); y++) for (let x = 0; x < w; x++) col[x] += tmp[y * w + x];
  for (let y = 0; y < h; y++) {
    if (y + ry < h) for (let x = 0, o = (y + ry) * w; x < w; x++) col[x] += tmp[o + x];
    if (y - ry - 1 >= 0) for (let x = 0, o = (y - ry - 1) * w; x < w; x++) col[x] -= tmp[o + x];
    for (let x = 0, o = y * w; x < w; x++) out[o + x] = col[x] > 0 ? 1 : 0;
  }
  return out;
}

/**
 * Yatay satırlı maskenin eğikliği (tan; artı: satırlar sağa doğru iner), ±8°: mürekkep noktaları açılarla satırlara
 * izdüşürülür, profil en keskin (karelerin toplamı en büyük) olan açı. Önce 0,5°, sonra 0,1° adım. 0,4°'nin altı 0.
 */
export function maskSkew(m: Uint8Array, w: number, h: number): number {
  let count = 0;
  for (let i = 0; i < m.length; i++) count += m[i];
  if (count < 200) return 0;
  const stride = Math.max(1, Math.floor(count / 20_000));
  const xs: number[] = [];
  const ys: number[] = [];
  let seen = 0;
  const cx = (w - 1) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      if (seen++ % stride === 0) {
        xs.push(x - cx);
        ys.push(y);
      }
    }
  }
  const pad = Math.ceil(w * Math.tan((9 * Math.PI) / 180)) + 2;
  const bins = new Float64Array(h + 2 * pad + 2);
  const score = (deg: number) => {
    const t = Math.tan((deg * Math.PI) / 180);
    bins.fill(0);
    for (let j = 0; j < xs.length; j++) {
      const f = ys[j] - xs[j] * t + pad;
      const i0 = Math.floor(f);
      const fr = f - i0;
      bins[i0] += 1 - fr;
      bins[i0 + 1] += fr;
    }
    let s = 0;
    for (let i = 0; i < bins.length; i++) s += bins[i] * bins[i];
    return s;
  };
  let best = 0;
  let bestS = score(0);
  for (let d = -8; d <= 8; d += 0.5) {
    const s = score(d);
    if (s > bestS) {
      bestS = s;
      best = d;
    }
  }
  let fine = best;
  for (let d = best - 0.4; d <= best + 0.4 + 1e-9; d += 0.1) {
    const s = score(d);
    if (s > bestS) {
      bestS = s;
      fine = d;
    }
  }
  return Math.abs(fine) < 0.4 ? 0 : Math.tan((fine * Math.PI) / 180);
}

/**
 * Maskeyi merkezi etrafında döndürür: eğimi `t` (tan) olan satırlar yataylaşır (en yakın komşu). Çıktı, içerik
 * kesilmesin diye kenarlardan genişletilir. Yamultma yetmez: sol kenar boşluğu da eğik kalır, yaslama ölçülemez.
 */
export function straightenMask(m: Uint8Array, w: number, h: number, t: number): { mask: Uint8Array; width: number; height: number } {
  const a = Math.atan(t);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const px = Math.ceil(Math.abs(s) * h * 0.5) + 1;
  const py = Math.ceil(Math.abs(s) * w * 0.5) + 1;
  const ow = w + 2 * px;
  const oh = h + 2 * py;
  const out = new Uint8Array(ow * oh);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const ocx = (ow - 1) / 2;
  const ocy = (oh - 1) / 2;
  for (let y = 0; y < oh; y++) {
    const dy = y - ocy;
    for (let x = 0; x < ow; x++) {
      const dx = x - ocx;
      const sx = Math.round(cx + dx * c - dy * s);
      const sy = Math.round(cy + dx * s + dy * c);
      if (sx >= 0 && sy >= 0 && sx < w && sy < h && m[sy * w + sx]) out[y * ow + x] = 1;
    }
  }
  return { mask: out, width: ow, height: oh };
}

interface Segment {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** satırın gövdesi (harflerin çoğunun kapladığı bant; mutlak satır) */
  coreTop: number;
  coreBot: number;
}

/**
 * Satırları yatay maskede düz / ters ipuçları: `mask` harf maskesi, `marksMask` küçük işaretler için bütün mürekkep
 * (verilmezse `mask`), `glyph` harf boyu (piksel). Döner: ipuçları (artı = düz).
 */
export function uprightCues(mask: Uint8Array, w: number, h: number, glyph: number, marksMask?: Uint8Array): OrientationCues {
  const rx = Math.max(2, Math.round(1.0 * glyph));
  const ry = 1;
  // sözcükler satır parçalarına bağlanır; dikeyde yalnız 1 piksel (sık satırlar, ş ve ç'nin çengeli birbirine bağlanmasın)
  const dil = dilateRect(mask, w, h, rx, ry);
  const comps = labelComponents(dil, w, h);
  const n = comps.count;
  const segs: (Segment | null)[] = new Array(n + 1).fill(null);
  const prof: Float32Array[] = new Array(n + 1);
  for (let l = 1; l <= n; l++) {
    const y0 = comps.minY[l] + ry;
    const y1 = comps.maxY[l] - ry;
    const x0 = comps.minX[l] + rx;
    const x1 = comps.maxX[l] - rx;
    const hh = y1 - y0 + 1;
    // satır parçası: harf boyunun 0,6–3 katı yüksek, en az iki harf geniş
    if (hh < 0.6 * glyph || hh > 3 * glyph || x1 - x0 + 1 < 2 * glyph) continue;
    segs[l] = { x0, x1, y0, y1, coreTop: y0, coreBot: y1 };
    prof[l] = new Float32Array(hh);
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const s = segs[comps.labels[i]];
      if (!s) continue;
      const k = y - s.y0;
      if (k >= 0 && k < prof[comps.labels[i]].length) prof[comps.labels[i]][k]++;
    }
  }
  const list: Segment[] = [];
  for (let l = 1; l <= n; l++) {
    const s = segs[l];
    if (!s) continue;
    const p = prof[l];
    let max = 0;
    for (let k = 0; k < p.length; k++) if (p[k] > max) max = p[k];
    // gövde: en yoğun satırın yarısını geçen ilk ve son satır
    let a = 0;
    while (a < p.length && p[a] < 0.5 * max) a++;
    let b = p.length - 1;
    while (b >= 0 && p[b] < 0.5 * max) b--;
    if (max <= 0 || b - a < 0.35 * glyph) {
      segs[l] = null;
      continue;
    }
    s.coreTop = s.y0 + a;
    s.coreBot = s.y0 + b;
    list.push(s);
  }

  // küçük işaretler (bütün mürekkepte: harf maskesi noktaları ayıklar): gövdenin içinde alt kenara yapışık olanlar
  // (nokta, virgülün başı, ondalık ayırıcı) taban çizgisindedir; gövdenin dışında kalanlar (i, İ, ö, ü noktaları,
  // ğ'nin şapkası) üsttedir. Her işaret, gövdesinin üstünde / altında yarım gövde boyu uzanan bölgesine düştüğü
  // satır parçasına sayılır.
  const owner = new Int32Array(w * h).fill(-1);
  list.forEach((s, k) => {
    const pad = Math.round(0.6 * (s.coreBot - s.coreTop + 1));
    for (let y = Math.max(0, s.coreTop - pad); y <= Math.min(h - 1, s.coreBot + pad); y++) owner.fill(k, y * w + s.x0, y * w + s.x1 + 1);
  });
  const small = labelComponents(marksMask ?? mask, w, h, true);
  let base = 0;
  let cap = 0;
  let marks = 0;
  for (let c = 1; c <= small.count; c++) {
    const bw = small.maxX[c] - small.minX[c] + 1;
    const bh = small.maxY[c] - small.minY[c] + 1;
    if (small.areas[c] < 2 || bw > 0.45 * glyph || bh > 0.45 * glyph) continue;
    // nokta, virgül, harf noktası derli topludur; kırık harf parçaları (ince uzun ya da yay) sayılmaz
    if (small.areas[c] < 0.4 * bw * bh || Math.max(bw, bh) > 2.5 * Math.min(bw, bh)) continue;
    const k = owner[Math.round((small.minY[c] + small.maxY[c]) / 2) * w + Math.round((small.minX[c] + small.maxX[c]) / 2)];
    const s = k >= 0 ? list[k] : null;
    if (!s) continue;
    const core = s.coreBot - s.coreTop;
    const cy = (small.minY[c] + small.maxY[c]) / 2;
    const t = (cy - s.coreTop) / Math.max(1, core);
    marks++;
    // düz: gövdenin alt dörtte biri (nokta, virgül) ya da gövdenin üstü (harf noktası)
    if (t >= 0.7 && t <= 1.1) base++;
    else if (t < -0.1) cap++;
    // ters: gövdenin üst dörtte biri ya da gövdenin altı
    else if (t >= -0.1 && t <= 0.3) base--;
    else if (t > 1.1) cap--;
  }
  const markScore = marks >= 6 ? (base + cap) / marks : 0;

  // satırlar: dikeyde örtüşen parçalar birleşir (fişte ürün adı ile tutar aynı satırdır)
  list.sort((p, q) => p.y0 - q.y0 || p.x0 - q.x0);
  const lines: { x0: number; x1: number; y0: number; y1: number }[] = [];
  for (const s of list) {
    const last = lines[lines.length - 1];
    const ov = last ? Math.min(last.y1, s.y1) - Math.max(last.y0, s.y0) : -1;
    if (last && ov > 0.5 * Math.min(last.y1 - last.y0, s.y1 - s.y0)) {
      last.x0 = Math.min(last.x0, s.x0);
      last.x1 = Math.max(last.x1, s.x1);
      last.y0 = Math.min(last.y0, s.y0);
      last.y1 = Math.max(last.y1, s.y1);
    } else lines.push({ x0: s.x0, x1: s.x1, y0: s.y0, y1: s.y1 });
  }
  let align = 0;
  let header = 0;
  if (lines.length >= 3) {
    const starts = lines.map((l) => l.x0).sort((p, q) => p - q);
    const ends = lines.map((l) => l.x1).sort((p, q) => p - q);
    const left = starts[Math.floor(0.1 * (starts.length - 1))];
    const right = ends[Math.ceil(0.9 * (ends.length - 1))];
    const width = right - left;
    const tol = 0.8 * glyph;
    let nl = 0;
    let nr = 0;
    const centered: boolean[] = [];
    for (const l of lines) {
      const atLeft = l.x0 <= left + tol;
      const atRight = l.x1 >= right - tol;
      const short = l.x1 - l.x0 < width - 3 * glyph;
      if (atLeft && !atRight && short) nl++;
      if (atRight && !atLeft && short) nr++;
      // ortalı: iki yanda da boşluk, boşluklar birbirine yakın
      const gl = l.x0 - left;
      const gr = right - l.x1;
      centered.push(gl > 1.5 * glyph && gr > 1.5 * glyph && Math.abs(gl - gr) < Math.max(1.5 * glyph, 0.12 * width));
    }
    align = (nl - nr) / Math.max(4, nl + nr);
    const K = Math.max(2, Math.min(5, Math.round(lines.length * 0.15)));
    let top = 0;
    let bottom = 0;
    for (let i = 0; i < K; i++) {
      if (centered[i]) top++;
      if (centered[lines.length - 1 - i]) bottom++;
    }
    header = (top - bottom) / K;
  }
  return { marks: markScore, align, header, segments: list.length, markCount: marks };
}

/** İpuçlarının ağırlıklı toplamı (−1 … 1; artı = düz) */
export function uprightScore(c: OrientationCues): number {
  const m = clamp(c.marks / MARK_SCALE, -1, 1);
  const total = W_MARKS * m + W_ALIGN * clamp(c.align, -1, 1) + W_HEADER * clamp(c.header, -1, 1);
  return total / (W_MARKS + W_ALIGN + W_HEADER);
}

/**
 * Belgenin yönü: dik yapmak için saat yönünde dönüş (0, 90, 180, 270) ya da "bilinmiyor". Görüntü taranmış (kırpılmış)
 * belge ya da ham fotoğraf olabilir; `corners` verilirse yalnız kâğıda bakılır.
 */
export function detectOrientation(img: RgbaImage | GrayImage, opts: OrientationOptions = {}): OrientationResult {
  const minConf = opts.minConfidence ?? 0.5;
  const workEdge = opts.workEdge ?? 1400;
  const reasons: string[] = [];
  const isRgba = (img as RgbaImage).data instanceof Uint8ClampedArray;
  const corners = opts.corners && isRgba ? opts.corners : null;
  const full = corners ? null : isRgba ? toGray(img as RgbaImage) : (img as GrayImage);
  /** Çalışma kopyası; `k` > 1 küçük yazıyı büyütür (nokta ve virgül eşikte kaybolmasın) */
  const workCopy = (k: number): GrayImage => {
    if (corners) {
      const size = estimateSize(corners, img.width, img.height, workEdge);
      return toGray(warpQuad(img as RgbaImage, corners, Math.round(size.width * k), Math.round(size.height * k)));
    }
    const gray = full!;
    // dar uzun fişte kısa kenar en az ~360 px kalsın
    const short = Math.min(gray.width, gray.height);
    const long = Math.max(gray.width, gray.height);
    const edge = (short * workEdge) / long < 360 ? Math.min((360 * long) / short, Math.sqrt((1.6e6 * long) / short)) : workEdge;
    const sz = fitSize(gray.width, gray.height, Math.max(workEdge, edge));
    const W = Math.round(sz.width * k);
    const H = Math.round(sz.height * k);
    return W === gray.width && H === gray.height ? gray : resizeGray(gray, W, H);
  };
  let g = workCopy(1);
  let L = analyzeText(g);
  // harf 12 pikselden küçükse (uzaktan çekim) iki kata kadar büyütülüp yeniden bakılır (en çok ~5 MP)
  if (L.glyphHeight > 0 && L.glyphHeight < 12) {
    const k = Math.min(2, 12 / L.glyphHeight, Math.sqrt(5e6 / (g.width * g.height)));
    if (k > 1.15) {
      g = workCopy(k);
      L = analyzeText(g);
      reasons.push(`buyutme-${k.toFixed(2)}`);
    }
  }
  const none: OrientationCues = { marks: 0, align: 0, header: 0, segments: 0, markCount: 0 };
  if (!L.axis.axis || !(L.glyphHeight > 0)) {
    reasons.push(L.glyph > 0 ? "satir-yonu-belirsiz" : "yazi-yok");
    return { rotation: "bilinmiyor", lineRotation: null, guess: null, confidence: 0, axisConfidence: 0, flipConfidence: 0, cues: none, reasons };
  }
  const vertical = L.axis.axis === "dikey";
  const r = rotateMask(L.text.mask, g.width, g.height, vertical ? 1 : 0);
  const ink = rotateMask(L.ink.mask, g.width, g.height, vertical ? 1 : 0);
  // kalan eğiklik (fotoğrafta birkaç derece) satır gövdesini yayar, kenar boşluğunu eğer: maske döndürülür
  const skew = maskSkew(r.mask, r.width, r.height);
  const tm = skew ? straightenMask(r.mask, r.width, r.height, skew) : r;
  const im = skew ? straightenMask(ink.mask, ink.width, ink.height, skew) : ink;
  if (skew) reasons.push(`egiklik-${((Math.atan(skew) * 180) / Math.PI).toFixed(1)}`);
  const cues = uprightCues(tm.mask, tm.width, tm.height, L.glyphHeight, im.mask);
  const score = uprightScore(cues);
  // az satır parçası ölçüldüyse güven düşer (tek satırlık etiket, birkaç sözcük)
  const amount = clamp(cues.segments / 12, 0, 1);
  const flipConfidence = clamp(Math.abs(score) / 0.35, 0, 1) * amount;
  const axisConfidence = L.axis.confidence;
  const guess: QuarterTurn = vertical ? (score >= 0 ? 90 : 270) : score >= 0 ? 0 : 180;
  const confidence = Math.round(axisConfidence * flipConfidence * 1000) / 1000;
  reasons.push(`satir-${L.axis.axis}`, `puan-${score.toFixed(2)}`);
  // ipuçları birbirine açıkça karşıysa (biçim bir yana, yaslama öbür yana) emin olunmaz
  const conflict = Math.sign(cues.marks) !== Math.sign(cues.align) && Math.abs(cues.marks) > 0.15 && Math.abs(cues.align) > 0.4;
  if (conflict) reasons.push("ipuclari-celisiyor");
  const sure = confidence >= minConf && !conflict;
  return {
    rotation: sure ? guess : "bilinmiyor",
    lineRotation: vertical ? 90 : 0,
    guess,
    confidence,
    axisConfidence: Math.round(axisConfidence * 1000) / 1000,
    flipConfidence: Math.round(flipConfidence * 1000) / 1000,
    cues: {
      marks: Math.round(cues.marks * 1000) / 1000,
      align: Math.round(cues.align * 1000) / 1000,
      header: Math.round(cues.header * 1000) / 1000,
      segments: cues.segments,
      markCount: cues.markCount,
    },
    reasons,
  };
}
