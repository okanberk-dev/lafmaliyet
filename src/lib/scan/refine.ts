/**
 * Köşeleri gerçek kâğıt kenarlarına oturtma. Her kenar boyunca örnek noktalarda kenara dik bir şeritte kâğıt kenarı
 * aranır (önce içerisi aydınlık → dışarısı koyu geçiş; tutmazsa tersi: gri kâğıt, beyaz tezgâh), noktalara RANSAC ve
 * en küçük kareler ile doğru oturtulur, köşeler komşu doğruların kesişimidir. İki geçiş: geniş şerit (kaba köşe,
 * yapay zekânın ipucu), sonra bulunan çizgi çevresinde dar şerit.
 *
 * Korumalar: destek zayıfsa (yeterli nokta doğruya oturmuyorsa) o kenar değişmez; görüntünün kenarına dayanan kenar
 * oturtulmaz; içeri kayılan şerit kâğıda benziyorsa (yazı satırı, tablo çizgisi) ya da çizginin dışı içiyle aynıysa
 * (ince çizgi, kâğıt devam ediyor) o kenar değişmez.
 */

import type { GrayImage, Point, Quad, RgbaImage } from "./image";
import { fitSize, gaussianBlur, resizeRgba, sampleBilinear, scaleQuad, seededRandom, toGray, unscaleQuad } from "./image";
import { intersect, isConvex, lineThrough, orderCorners, ransacLine, signedDist, type Line } from "./geom";

export interface RefineOptions {
  /** "iki": geniş + dar şerit (kaba köşe, ipucu); "ince": yalnız dar şerit. Varsayılan "iki" */
  passes?: "iki" | "ince";
  /** Çalışma kopyasının uzun kenarı (px); varsayılan 1000 */
  workEdge?: number;
  /** Geniş şeridin yarı genişliği (köşegene oran); varsayılan 0,075 (ipucu köşegenin %5'ine kadar yanılabilir) */
  band?: number;
  /** Yalnız dışarı doğru daha uzun arama (köşegene oran; yazıdan büyütmede yazı ile kenar arası boş kâğıttır) */
  outward?: number;
  /** Oturtulmayacak kenarlar (0: üst, 1: sağ, 2: alt, 3: sol) */
  fixed?: readonly number[];
}

export interface RefineResult {
  /** Asıl görüntünün piksel koordinatlarında, sıralı */
  corners: Quad;
  /** Kenar kenar oturdu mu (0: üst, 1: sağ, 2: alt, 3: sol) */
  sides: [boolean, boolean, boolean, boolean];
  /** Oturan kenar sayısı */
  snapped: number;
}

/** Tek geçişin ayarı (çalışma görüntüsünün pikselinde) */
export interface SnapPass {
  /** içeri ve dışarı arama (px) */
  band: number;
  /** yalnız dışarı arama sınırı (px); band'dan büyükse ikinci aramada kullanılır */
  outBand?: number;
  /** oturan nokta oranı alt sınırı (örnek sayısına göre) */
  minFrac: number;
  /** oturan doğrunun başlangıç kenarıyla en büyük açı farkı (derece) */
  maxDeg: number;
}

const SAMPLES = 56;

/** Kenar görüntünün kenarına dayanıyor mu (iki ucu aynı kenarda ya da dışarıda) */
export function sideOnFrame(a: Point, b: Point, w: number, h: number, tol: number): boolean {
  const near = (p: Point) => ({
    l: p.x <= tol,
    r: p.x >= w - 1 - tol,
    t: p.y <= tol,
    b: p.y >= h - 1 - tol,
  });
  const na = near(a);
  const nb = near(b);
  return (na.l && nb.l) || (na.r && nb.r) || (na.t && nb.t) || (na.b && nb.b);
}

/** Bölgenin ortancası (0–255 histogramı ile) */
function regionMedian(prof: Float32Array, valid: Uint8Array, rows: number, cols: number, c0: number, c1: number): number | null {
  const hist = new Uint32Array(256);
  let n = 0;
  const a = Math.max(0, Math.ceil(c0));
  const b = Math.min(cols - 1, Math.floor(c1));
  if (b < a) return null;
  for (let r = 0; r < rows; r++) {
    for (let c = a; c <= b; c++) {
      const i = r * cols + c;
      if (!valid[i]) continue;
      let v = Math.round(prof[i]);
      if (v < 0) v = 0;
      else if (v > 255) v = 255;
      hist[v]++;
      n++;
    }
  }
  if (n < 4) return null;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc * 2 >= n) return v;
  }
  return 255;
}

/**
 * Tek geçiş (gri, hafif bulanık çalışma görüntüsünde). Döner: yeni köşeler ve kenar kenar oturma; köşelerden biri
 * makul olmayan kadar kaydıysa null (başlangıç dörtgeni korunur).
 */
export function snapPass(g: GrayImage, q: Quad, pass: SnapPass, fixed: readonly number[] = [], seed = 7): { q: Quad; sides: boolean[] } | null {
  const { width: W, height: H } = g;
  const diag = Math.hypot(W, H);
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  const tol = Math.max(1.5, diag * 0.0025);
  const band = Math.max(4, Math.round(pass.band));
  const outBand = Math.max(band, Math.round(pass.outBand ?? band));
  const o0 = -band;
  const cols = outBand - o0 + 1;
  const prof = new Float32Array(SAMPLES * cols);
  const valid = new Uint8Array(SAMPLES * cols);
  const der = new Float32Array(SAMPLES * cols);
  const rnd = seededRandom(seed);
  const frameTol = Math.max(2, Math.min(W, H) * 0.012);
  const lines: Line[] = [];
  const sides: boolean[] = [false, false, false, false];
  const minIn = Math.max(8, Math.round(pass.minFrac * SAMPLES));
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const base = lineThrough(a, b);
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (fixed.includes(i) || L < 8 || sideOnFrame(a, b, W, H, frameTol)) {
      lines.push(base);
      continue;
    }
    const d = base.d;
    let n = { x: d.y, y: -d.x };
    if (((a.x + b.x) / 2 - cx) * n.x + ((a.y + b.y) / 2 - cy) * n.y < 0) n = { x: -n.x, y: -n.y }; // dışa doğru
    // içeri arama karşı kenarın yarısına varmasın: dar fişte geniş şerit öbür kenarı ya da yazı sütununu bulur
    const ext = Math.abs(signedDist(lineThrough(q[(i + 2) % 4], q[(i + 3) % 4]), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }));
    const inBand = Math.max(4, Math.min(band, 0.4 * ext));
    // profiller: satır = kenar boyunca örnek, sütun = kenara dik uzaklık (eksi içeri, artı dışarı)
    for (let k = 0; k < SAMPLES; k++) {
      const t = 0.08 + (0.84 * k) / (SAMPLES - 1);
      const px = a.x + d.x * t * L;
      const py = a.y + d.y * t * L;
      for (let c = 0; c < cols; c++) {
        const o = o0 + c;
        const x = px + n.x * o;
        const y = py + n.y * o;
        const idx = k * cols + c;
        const ok = x >= 0 && y >= 0 && x <= W - 1 && y <= H - 1;
        valid[idx] = ok ? 1 : 0;
        prof[idx] = sampleBilinear(g, x, y);
      }
    }
    // türev: içerisi (küçük o) eksi dışarısı (büyük o), 4 px aralıkla; artı = içerisi aydınlık
    der.fill(0);
    for (let k = 0; k < SAMPLES; k++) {
      for (let c = 2; c < cols - 2; c++) {
        const i0 = k * cols + c - 2;
        const i1 = k * cols + c + 2;
        der[k * cols + c] = valid[i0] && valid[i1] ? prof[i0] - prof[i1] : 0;
      }
    }
    const pointAt = (k: number, c: number): Point => {
      const t = 0.08 + (0.84 * k) / (SAMPLES - 1);
      const o = o0 + c;
      return { x: a.x + d.x * t * L + n.x * o, y: a.y + d.y * t * L + n.y * o };
    };
    const checked = (pts: Point[]): Line | null => {
      if (pts.length < minIn) return null;
      const fit = ransacLine(pts, 2, rnd, minIn, 60);
      if (!fit) return null;
      const dl = fit.line.d;
      // kısa kenarda (dar fişin üstü) köşenin şerit kadar kayması açıyı çok değiştirir: izin kenar boyuyla büyür
      const allow = Math.min(40, Math.max(pass.maxDeg, (Math.atan2(1.6 * band, L) * 180) / Math.PI));
      if (Math.abs(dl.x * d.x + dl.y * d.y) < Math.cos((allow * Math.PI) / 180)) return null;
      // çizginin kenar ortasındaki uzaklığı (dışa doğru artı)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const nl = { x: -dl.y, y: dl.x };
      const den = n.x * nl.x + n.y * nl.y;
      if (Math.abs(den) < 1e-6) return null;
      const oMid = ((fit.line.p.x - mid.x) * nl.x + (fit.line.p.y - mid.y) * nl.y) / den;
      const cMid = oMid - o0;
      const pi = regionMedian(prof, valid, SAMPLES, cols, cMid - Math.max(6, inBand * 0.6), cMid - 3);
      const same = (c0: number, c1: number) => {
        if (pi === null) return false;
        const m = regionMedian(prof, valid, SAMPLES, cols, c0, c1);
        return m !== null && Math.abs(m - pi) < Math.max(7, 0.035 * pi);
      };
      // içeri kayma: aradaki şerit kâğıda benziyorsa (yazı satırı, tablo çizgisi) kâğıt kenarı değil
      if (oMid < -tol && same(cMid + 2, -1 - o0)) return null;
      // kâğıt kenarının dışı kâğıt değildir: çizginin hemen dışı içiyle aynıysa (ince çizgi) kenar değil
      if (same(cMid + 3, cMid + band * 0.5)) return null;
      return fit.line;
    };
    // 1) şeritte (±band) en güçlü geçiş; yakın olan biraz öne çıkar
    const strength: number[] = [];
    const best: number[] = [];
    for (let k = 0; k < SAMPLES; k++) {
      let bv = -Infinity;
      let bc = -1;
      for (let c = 2; c < cols - 2; c++) {
        const o = o0 + c;
        if (o < -inBand) continue;
        if (o > band) break;
        const w = 1 - (0.4 * Math.min(Math.abs(o), band)) / band;
        const v = der[k * cols + c] * w;
        if (v > bv) {
          bv = v;
          bc = c;
        }
      }
      best.push(bc);
      strength.push(bc >= 0 ? der[k * cols + bc] : 0);
    }
    const sorted = strength.slice().sort((x, y) => x - y);
    const p75 = sorted[Math.floor(sorted.length * 0.75)] ?? 0;
    const thr = Math.max(6, p75 * 0.35);
    let pts: Point[] = [];
    for (let k = 0; k < SAMPLES; k++) if (best[k] >= 0 && strength[k] > thr) pts.push(pointAt(k, best[k]));
    let line = checked(pts);
    // 2) tutmazsa: dışarı doğru en yakın belirgin geçiş (satırdaki en güçlünün %40'ı); önce içerisi aydınlık, sonra koyu
    for (const sign of [1, -1]) {
      if (line) break;
      pts = [];
      for (let k = 0; k < SAMPLES; k++) {
        let mx = -Infinity;
        for (let c = 2; c < cols - 2; c++) {
          if (o0 + c < -tol) continue;
          const v = der[k * cols + c] * sign;
          if (v > mx) mx = v;
        }
        const t2 = Math.max(6, mx * 0.4);
        for (let c = 2; c < cols - 2; c++) {
          if (o0 + c < -tol) continue;
          if (der[k * cols + c] * sign >= t2) {
            // yerel tepeye kadar ilerle (geçişin ortası)
            let cc = c;
            while (cc + 1 < cols - 2 && der[k * cols + cc + 1] * sign > der[k * cols + cc] * sign) cc++;
            pts.push(pointAt(k, cc));
            break;
          }
        }
      }
      line = checked(pts);
    }
    if (line) {
      lines.push(line);
      sides[i] = true;
    } else lines.push(base);
  }
  const out: Point[] = [];
  const maxMove = Math.max(band, outBand) * 1.6 + 2;
  for (let i = 0; i < 4; i++) {
    const c = intersect(lines[(i + 3) % 4], lines[i]);
    if (!c) return null;
    if (Math.hypot(c.x - q[i].x, c.y - q[i].y) > maxMove) return null;
    out.push(c);
  }
  return { q: orderCorners(out), sides };
}

/** Çalışma görüntüsünde iki (ya da bir) geçiş */
export function snapQuad(g: GrayImage, q: Quad, opts: { passes?: "iki" | "ince"; band?: number; outward?: number; fixed?: readonly number[] } = {}): { q: Quad; sides: boolean[] } {
  const diag = Math.hypot(g.width, g.height);
  const fixed = opts.fixed ?? [];
  let cur = q;
  let sides = [false, false, false, false];
  if ((opts.passes ?? "iki") === "iki") {
    const r1 = snapPass(g, q, { band: diag * (opts.band ?? 0.075), outBand: opts.outward ? diag * opts.outward : undefined, minFrac: 0.3, maxDeg: 15 }, fixed);
    if (!r1 || !r1.sides.some(Boolean)) return { q, sides };
    cur = r1.q;
    sides = r1.sides;
  }
  const r2 = snapPass(g, cur, { band: Math.max(5, diag * 0.02), minFrac: 0.4, maxDeg: 6 }, fixed, 11);
  if (r2) {
    const n1 = sides.filter(Boolean).length;
    const n2 = r2.sides.filter(Boolean).length;
    if (n2 >= n1 || (opts.passes ?? "iki") === "ince") {
      // ince geçişte oturmayan kenar geniş geçişteki yerinde kalır (doğru zaten oradan geçiyor)
      return { q: r2.q, sides: r2.sides.map((s, i) => s || sides[i]) };
    }
  }
  return { q: cur, sides };
}

/** Kenarın köşeye yakın parçasında örnek sayısı */
const POLISH_SAMPLES = 28;

/**
 * Bir kenarın köşe tarafındaki teğeti: köşeden kenar boyunun ~%35'ine kadar örneklerde kenara dik dar şeritte en güçlü
 * geçiş (alt piksel: türevin tepesine parabol), noktalara ikinci derece eğri (kenar kıvrıksa) ya da doğru; köşedeki
 * yeri ve yönü döner. Destek azsa ya da eğri şeride sığmıyorsa null.
 */
function cornerTangent(g: GrayImage, corner: Point, other: Point, n: Point, band: number, sign: number): { p: Point; d: Point; support: number } | null {
  const L = Math.hypot(other.x - corner.x, other.y - corner.y);
  if (L < 24) return null;
  const d = { x: (other.x - corner.x) / L, y: (other.y - corner.y) / L };
  const { width: W, height: H } = g;
  const span = Math.min(0.35 * L, Math.max(40, 0.2 * L));
  const us: number[] = [];
  const os: number[] = [];
  const ss: number[] = [];
  const B = Math.ceil(band);
  const prof = new Float32Array(2 * B + 7);
  for (let k = 0; k < POLISH_SAMPLES; k++) {
    const u = Math.max(4, 0.04 * L) + ((span - Math.max(4, 0.04 * L)) * k) / (POLISH_SAMPLES - 1);
    const px = corner.x + d.x * u;
    const py = corner.y + d.y * u;
    // kare dışına düşen örnek NaN (köşe kareye yakınsa şeridin yalnız içi)
    let valid = 0;
    for (let c = 0; c < prof.length; c++) {
      const o = c - B - 3;
      const x = px + n.x * o;
      const y = py + n.y * o;
      const inside = x >= 0 && y >= 0 && x <= W - 1 && y <= H - 1;
      prof[c] = inside ? sampleBilinear(g, x, y) : NaN;
      if (inside) valid++;
    }
    if (valid < prof.length * 0.5) continue;
    // türev (içerisi eksi dışarısı, 2 px aralık) işaretiyle; en güçlü tepe ve parabolle alt piksel yeri
    let bv = 0;
    let bc = -1;
    const der = (c: number) => {
      const v = sign * (prof[c - 2] - prof[c + 2]);
      return Number.isNaN(v) ? 0 : v;
    };
    for (let c = 3; c < prof.length - 3; c++) {
      const v = der(c);
      if (v > bv) {
        bv = v;
        bc = c;
      }
    }
    if (bc < 0) continue;
    let off = 0;
    if (bc > 3 && bc < prof.length - 4) {
      const a0 = der(bc - 1);
      const a2 = der(bc + 1);
      const den = a0 - 2 * bv + a2;
      if (den < 0) off = Math.max(-0.5, Math.min(0.5, (0.5 * (a0 - a2)) / den));
    }
    us.push(u);
    os.push(bc - B - 3 + off);
    ss.push(bv);
  }
  if (us.length < POLISH_SAMPLES * 0.6) return null;
  const sorted = ss.slice().sort((a, b) => a - b);
  const thr = Math.max(8, sorted[Math.floor(sorted.length * 0.75)] * 0.4);
  let idx = us.map((_, i) => i).filter((i) => ss[i] >= thr);
  if (idx.length < POLISH_SAMPLES * 0.5) return null;
  // ikinci derece en küçük kareler (u köşeden uzaklık): o(u) = c0 + c1 u + c2 u²; aykırılar bir kez atılır
  const fit = (sel: number[], deg: 1 | 2): number[] | null => {
    const m = deg + 1;
    const A = Array.from({ length: m }, () => new Float64Array(m + 1));
    for (const i of sel) {
      const u = us[i] / span;
      const pw = [1, u, u * u];
      for (let r = 0; r < m; r++) {
        for (let c = 0; c < m; c++) A[r][c] += pw[r] * pw[c];
        A[r][m] += pw[r] * os[i];
      }
    }
    for (let c = 0; c < m; c++) {
      let piv = c;
      for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      if (Math.abs(A[piv][c]) < 1e-9) return null;
      [A[c], A[piv]] = [A[piv], A[c]];
      for (let r = 0; r < m; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        for (let k = c; k <= m; k++) A[r][k] -= f * A[c][k];
      }
    }
    return A.map((row, r) => row[m] / row[r]);
  };
  const resid = (cf: number[], i: number) => {
    const u = us[i] / span;
    return os[i] - (cf[0] + cf[1] * u + (cf[2] ?? 0) * u * u);
  };
  let cf = fit(idx, 2);
  if (!cf) return null;
  idx = idx.filter((i) => Math.abs(resid(cf!, i)) < 1.5);
  if (idx.length < POLISH_SAMPLES * 0.5) return null;
  cf = fit(idx, 2);
  if (!cf) return null;
  // eğrilik gürültüden büyük değilse doğru (uzatmada ikinci derece terim yanıltmasın)
  const lin = fit(idx, 1);
  let rq = 0;
  let rl = 0;
  for (const i of idx) {
    rq += resid(cf, i) ** 2;
    if (lin) rl += resid(lin, i) ** 2;
  }
  // eğri iyi oturmuyorsa kenar köşede kırılıyor (katlanmış köşe): asıl köşe kenarların uzantısındadır, dokunma
  if (Math.sqrt(rq / idx.length) > 0.35) return null;
  if (lin && rl <= rq * 1.3 + idx.length * 0.05) cf = [lin[0], lin[1], 0];
  if (Math.abs(cf[0]) > band) return null;
  const slope = cf[1] / span;
  const p = { x: corner.x + n.x * cf[0], y: corner.y + n.y * cf[0] };
  const dd = { x: d.x + n.x * slope, y: d.y + n.y * slope };
  const dl = Math.hypot(dd.x, dd.y);
  return { p, d: { x: dd.x / dl, y: dd.y / dl }, support: idx.length / POLISH_SAMPLES };
}

/**
 * Köşe ince ayarı (kıvrık ya da bükük kâğıt): kenar doğruları kenarın ortasından geçer; kâğıt kıvrıksa ya da ucu
 * kalkıksa asıl köşe bu doğruların kesişiminden birkaç piksel uzaktadır. Her köşede iki komşu kenarın yalnız köşeye
 * yakın parçasına (alt piksel) eğri oturtulur, köşe iki teğetin kesişimi olur. Kareye dayanan ya da sabit kenarın
 * köşesine dokunulmaz; destek zayıfsa ya da köşe şeritten çok kayarsa o köşe yerinde kalır.
 */
export function polishCorners(g: GrayImage, q: Quad, opts: { fixed?: readonly number[] } = {}): { q: Quad; moved: number } {
  const { width: W, height: H } = g;
  const diag = Math.hypot(W, H);
  const fixed = opts.fixed ?? [];
  const frameTol = Math.max(2, Math.min(W, H) * 0.012);
  const skip = [0, 1, 2, 3].map((i) => fixed.includes(i) || sideOnFrame(q[i], q[(i + 1) % 4], W, H, frameTol));
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  const band = Math.max(5, diag * 0.03);
  // kâğıt içerisi aydınlık mı (kenar boyunca orta noktalarda içi − dışı)
  const outward = (a: Point, b: Point): Point => {
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let n = { x: (b.y - a.y) / L, y: -(b.x - a.x) / L };
    if (((a.x + b.x) / 2 - cx) * n.x + ((a.y + b.y) / 2 - cy) * n.y < 0) n = { x: -n.x, y: -n.y };
    return n;
  };
  const signOf = (a: Point, b: Point, n: Point): number => {
    let s = 0;
    for (let k = 1; k < 10; k++) {
      const t = k / 10;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      s += sampleBilinear(g, Math.max(0, Math.min(W - 1, x - n.x * 6)), Math.max(0, Math.min(H - 1, y - n.y * 6)));
      s -= sampleBilinear(g, Math.max(0, Math.min(W - 1, x + n.x * 6)), Math.max(0, Math.min(H - 1, y + n.y * 6)));
    }
    return s >= 0 ? 1 : -1;
  };
  const normals = [0, 1, 2, 3].map((i) => outward(q[i], q[(i + 1) % 4]));
  const signs = [0, 1, 2, 3].map((i) => signOf(q[i], q[(i + 1) % 4], normals[i]));
  const out = q.slice() as Quad;
  let moved = 0;
  for (let i = 0; i < 4; i++) {
    const prev = (i + 3) % 4;
    if (skip[prev] || skip[i]) continue;
    const t1 = cornerTangent(g, q[i], q[prev], normals[prev], band, signs[prev]);
    const t2 = cornerTangent(g, q[i], q[(i + 1) % 4], normals[i], band, signs[i]);
    if (!t1 || !t2) continue;
    const c = intersect({ p: t1.p, d: t1.d }, { p: t2.p, d: t2.d });
    if (!c || Math.hypot(c.x - q[i].x, c.y - q[i].y) > band * 1.2) continue;
    out[i] = c;
    moved++;
  }
  if (!moved) return { q, moved: 0 };
  const r = orderCorners(out);
  if (!isConvex(r)) return { q, moved: 0 };
  return { q: r, moved };
}

/** Çalışma kopyası: gri, hafif bulanık (gürültü ve JPEG blokları türevi bozmasın) */
export function workGray(img: RgbaImage, workEdge: number): GrayImage {
  const sz = fitSize(img.width, img.height, workEdge);
  const small = sz.width === img.width && sz.height === img.height ? img : resizeRgba(img, sz.width, sz.height);
  return gaussianBlur(toGray(small), 1);
}

/**
 * Kaba köşeleri (kullanıcının sürüklediği, algılamanın ya da yapay zekânın 0–1000 oranlı ipucundan çevrilen) gerçek
 * kâğıt kenarlarına oturtur. Köşeler asıl görüntünün pikselinde; dönen de öyle.
 */
export function refineCorners(img: RgbaImage, corners: Quad, opts: RefineOptions = {}): RefineResult {
  const g = workGray(img, opts.workEdge ?? 1000);
  const q = scaleQuad(orderCorners(corners), img.width, img.height, g.width, g.height);
  const r = snapQuad(g, q, { passes: opts.passes, band: opts.band, outward: opts.outward, fixed: opts.fixed });
  // oturan kenarların köşeleri kıvrık kâğıtta ayrıca köşeye yakın teğetlerle (oturmayan kenara dokunulmaz)
  const pol = r.sides.some(Boolean) ? polishCorners(g, r.q, { fixed: [0, 1, 2, 3].filter((i) => !r.sides[i]) }).q : r.q;
  const out = unscaleQuad(pol, img.width, img.height, g.width, g.height);
  const sides = r.sides.slice(0, 4) as [boolean, boolean, boolean, boolean];
  return { corners: out, sides, snapped: sides.filter(Boolean).length };
}
