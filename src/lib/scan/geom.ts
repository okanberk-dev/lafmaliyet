/**
 * Belge tarayıcı çekirdeği: düzlem geometrisi (köşe sıralama, dörtgen denetimi, doğru oturtma, RANSAC, dışbükey zarf,
 * zarftan dörtgen, en küçük alanlı dikdörtgen). Saf; testleri tests/tarama-*.test.ts.
 */

import type { Point, Quad } from "./image";

/** Doğru: üzerinde bir nokta ve birim yön */
export interface Line {
  p: Point;
  d: Point;
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Dört noktayı sol üst, sağ üst, sağ alt, sol alt sırasına dizer: merkez etrafında açıya göre (y aşağı: saat yönü),
 * x + y'si en küçük olan başa. 45° dönük kâğıtta da aynı köşe iki kez seçilmez.
 */
export function orderCorners(points: readonly Point[]): Quad {
  if (points.length !== 4) throw new Error("Dört köşe gerekli");
  const cx = (points[0].x + points[1].x + points[2].x + points[3].x) / 4;
  const cy = (points[0].y + points[1].y + points[2].y + points[3].y) / 4;
  const pts = points
    .map((p) => ({ x: p.x, y: p.y, a: Math.atan2(p.y - cy, p.x - cx) }))
    .sort((a, b) => a.a - b.a);
  let start = 0;
  for (let i = 1; i < 4; i++) if (pts[i].x + pts[i].y < pts[start].x + pts[start].y) start = i;
  const out: Point[] = [];
  for (let i = 0; i < 4; i++) {
    const p = pts[(start + i) % 4];
    out.push({ x: p.x, y: p.y });
  }
  return out as Quad;
}

/** İşaretli alan (y aşağı: saat yönü artı) */
export function signedArea(poly: readonly Point[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function polygonArea(poly: readonly Point[]): number {
  return Math.abs(signedArea(poly));
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Dörtgen dışbükey mi (kenarlar kesişmiyor, köşeler tek yönde dönüyor) */
export function isConvex(q: readonly Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const c = cross(q[i], q[(i + 1) % q.length], q[(i + 2) % q.length]);
    if (Math.abs(c) < 1e-9) return false;
    const s = c > 0 ? 1 : -1;
    if (!sign) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** İç açılar (derece), köşe sırasıyla */
export function interiorAngles(q: readonly Point[]): number[] {
  const out: number[] = [];
  const n = q.length;
  for (let i = 0; i < n; i++) {
    const a = q[(i + n - 1) % n];
    const b = q[i];
    const c = q[(i + 1) % n];
    const v1x = a.x - b.x;
    const v1y = a.y - b.y;
    const v2x = c.x - b.x;
    const v2y = c.y - b.y;
    const cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) + 1e-12);
    out.push((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI);
  }
  return out;
}

export function lineThrough(a: Point, b: Point): Line {
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { p: { x: a.x, y: a.y }, d: { x: (b.x - a.x) / L, y: (b.y - a.y) / L } };
}

/** İki doğrunun kesişimi (paralelse null) */
export function intersect(l1: Line, l2: Line): Point | null {
  const den = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((l2.p.x - l1.p.x) * l2.d.y - (l2.p.y - l1.p.y) * l2.d.x) / den;
  return { x: l1.p.x + l1.d.x * t, y: l1.p.y + l1.d.y * t };
}

/** Noktanın doğruya işaretli uzaklığı (normal: yönün saat yönünde 90° dönmüşü, y aşağı) */
export function signedDist(l: Line, p: Point): number {
  return (p.x - l.p.x) * -l.d.y + (p.y - l.p.y) * l.d.x;
}

/** Ağırlıklı toplam en küçük kareler doğrusu (asal bileşen); en az iki nokta */
export function fitLine(pts: readonly Point[], weights?: readonly number[]): Line | null {
  let sw = 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < pts.length; i++) {
    const w = weights ? weights[i] : 1;
    sw += w;
    mx += pts[i].x * w;
    my += pts[i].y * w;
  }
  if (sw <= 0 || pts.length < 2) return null;
  mx /= sw;
  my /= sw;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < pts.length; i++) {
    const w = weights ? weights[i] : 1;
    const dx = pts[i].x - mx;
    const dy = pts[i].y - my;
    sxx += w * dx * dx;
    syy += w * dy * dy;
    sxy += w * dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { p: { x: mx, y: my }, d: { x: Math.cos(theta), y: Math.sin(theta) } };
}

/**
 * RANSAC ile doğru: rastgele iki nokta, `tol` içindeki noktalar; en kalabalık küme en küçük karelerle yeniden
 * oturtulur (Tukey benzeri iki tur). `minInliers`'tan az nokta oturursa null.
 */
export function ransacLine(pts: readonly Point[], tol: number, rnd: () => number, minInliers: number, iters = 80): { line: Line; inliers: number } | null {
  const n = pts.length;
  if (n < 2 || n < minInliers) return null;
  let bestCount = 0;
  let bestLine: Line | null = null;
  for (let it = 0; it < iters; it++) {
    const i = Math.floor(rnd() * n);
    let j = Math.floor(rnd() * (n - 1));
    if (j >= i) j++;
    const l = lineThrough(pts[i], pts[j]);
    if (dist(pts[i], pts[j]) < 1e-3) continue;
    let c = 0;
    for (let k = 0; k < n; k++) if (Math.abs(signedDist(l, pts[k])) < tol) c++;
    if (c > bestCount) {
      bestCount = c;
      bestLine = l;
    }
  }
  if (!bestLine || bestCount < minInliers) return null;
  let line: Line = bestLine;
  for (let round = 0; round < 2; round++) {
    const sel: Point[] = [];
    for (const p of pts) if (Math.abs(signedDist(line, p)) < tol * (round ? 1 : 1.5)) sel.push(p);
    const f = fitLine(sel);
    if (!f) break;
    line = f;
  }
  let inliers = 0;
  for (const p of pts) if (Math.abs(signedDist(line, p)) < tol) inliers++;
  if (inliers < minInliers) return null;
  return { line, inliers };
}

/** Dışbükey zarf (Andrew'un tekdüze zinciri); y aşağı görüntüde saat yönünde, tekrarsız */
export function convexHull(points: readonly Point[]): Point[] {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Douglas–Peucker ile kapalı çokgeni sadeleştirir (`eps` piksel) */
export function simplifyClosed(poly: readonly Point[], eps: number): Point[] {
  if (poly.length <= 4) return poly.slice();
  // en uzak iki noktadan böl
  let a = 0;
  let b = 0;
  let best = -1;
  for (let i = 0; i < poly.length; i++) {
    const d = dist(poly[0], poly[i]);
    if (d > best) {
      best = d;
      b = i;
    }
  }
  best = -1;
  for (let i = 0; i < poly.length; i++) {
    const d = dist(poly[b], poly[i]);
    if (d > best) {
      best = d;
      a = i;
    }
  }
  if (a > b) [a, b] = [b, a];
  const first = poly.slice(a, b + 1);
  const second = poly.slice(b).concat(poly.slice(0, a + 1));
  const s1 = dpOpen(first, eps);
  const s2 = dpOpen(second, eps);
  return s1.slice(0, -1).concat(s2.slice(0, -1));
}

function dpOpen(pts: readonly Point[], eps: number): Point[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const l = lineThrough(pts[s], pts[e]);
    let md = -1;
    let mi = -1;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs(signedDist(l, pts[i]));
      if (d > md) {
        md = d;
        mi = i;
      }
    }
    if (md > eps && mi > 0) {
      keep[mi] = 1;
      stack.push([s, mi], [mi, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * Dışbükey çokgeni dörtgene indirir: her adımda bir kenar silinir, iki komşu kenar uzatılıp kesiştirilir; alan artışı
 * en küçük olan kenar seçilir (kâğıdın yuvarlak ya da kıvrık köşesi gerçek köşeye uzar). Hiçbir kenar silinemiyorsa
 * alan kaybı en küçük köşe atılır. Döner: sıralı dörtgen ya da null.
 */
export function hullToQuad(hull: readonly Point[]): Quad | null {
  const poly = hull.slice();
  if (poly.length < 4) return null;
  // saat yönüne çevir (y aşağı)
  if (signedArea(poly) < 0) poly.reverse();
  while (poly.length > 4) {
    const n = poly.length;
    let bestCost = Infinity;
    let bestI = -1;
    let bestX: Point | null = null;
    for (let i = 0; i < n; i++) {
      const p0 = poly[(i + n - 1) % n];
      const p1 = poly[i];
      const p2 = poly[(i + 1) % n];
      const p3 = poly[(i + 2) % n];
      const X = intersect(lineThrough(p0, p1), lineThrough(p3, p2));
      if (!X) continue;
      // kesişim p1'in ötesinde (p0 → p1 yönünde) ve p2'nin ötesinde (p3 → p2 yönünde) olmalı
      const t1 = (X.x - p1.x) * (p1.x - p0.x) + (X.y - p1.y) * (p1.y - p0.y);
      const t2 = (X.x - p2.x) * (p2.x - p3.x) + (X.y - p2.y) * (p2.y - p3.y);
      if (t1 < -1e-9 || t2 < -1e-9) continue;
      const cost = Math.abs(cross(p1, X, p2)) / 2;
      if (cost < bestCost) {
        bestCost = cost;
        bestI = i;
        bestX = X;
      }
    }
    if (bestI < 0 || !bestX) {
      // kenar silinemiyor: alan kaybı en küçük köşe
      let mi = 0;
      let mc = Infinity;
      for (let i = 0; i < n; i++) {
        const c = Math.abs(cross(poly[(i + n - 1) % n], poly[i], poly[(i + 1) % n]));
        if (c < mc) {
          mc = c;
          mi = i;
        }
      }
      poly.splice(mi, 1);
      continue;
    }
    const i2 = (bestI + 1) % n;
    poly[bestI] = bestX;
    poly.splice(i2, 1);
  }
  if (!isConvex(poly)) return null;
  return orderCorners(poly);
}

/** En küçük alanlı dikdörtgen (dönen kumpas; zarf kenarlarının yönleri denenir) */
export function minAreaRect(hull: readonly Point[]): Quad | null {
  if (hull.length < 3) return null;
  let best = Infinity;
  let out: Quad | null = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 1e-9) continue;
    const ux = (b.x - a.x) / L;
    const uy = (b.y - a.y) / L;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * ux + p.y * uy;
      const v = -p.x * uy + p.y * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best) {
      best = area;
      const P = (u: number, v: number): Point => ({ x: u * ux - v * uy, y: u * uy + v * ux });
      out = orderCorners([P(minU, minV), P(maxU, minV), P(maxU, maxV), P(minU, maxV)]);
    }
  }
  return out;
}

/** Nokta dışbükey dörtgenin içinde mi */
export function insideConvex(q: readonly Point[], p: Point): boolean {
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const c = cross(q[i], q[(i + 1) % q.length], p);
    if (c === 0) continue;
    const s = c > 0 ? 1 : -1;
    if (!sign) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** İki dörtgenin köşeleri arasındaki en büyük uzaklık (sıralı köşeler) */
export function quadDistance(a: Quad, b: Quad): number {
  let m = 0;
  for (let i = 0; i < 4; i++) m = Math.max(m, dist(a[i], b[i]));
  return m;
}

/** Dörtgeni merkezinden `k` kat büyütür */
export function growQuad(q: Quad, k: number): Quad {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  return q.map((p) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k })) as Quad;
}
