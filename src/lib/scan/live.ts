/**
 * Canlı vizörün saf parçaları (docs/FOTOGRAF.md › Canlı vizör): kameranın küçültülmüş karelerinde bulunan dörtgenin
 * yumuşatılması (titremesin, gerçek hareketi geç izlemesin), karenin ışık / netlik ölçüsü, kâğıt sabit ve kalite iyi
 * olunca kısa geri sayımla otomatik çekim kararı ve algılama kopyasının ölçüsünü süreye göre ayarlama. DOM'a dokunmaz,
 * zaman dışarıdan verilir (ms): Node'da test edilir (tests/tarama-canli.test.ts).
 */

import { insideConvex, polygonArea, quadDistance } from "./geom";
import type { Point, Quad, RgbaImage } from "./image";

/** İki dörtgenin en uzak köşe çiftinin uzaklığı, karenin köşegenine oranla */
export function quadShift(a: Quad, b: Quad, width: number, height: number): number {
  return quadDistance(a, b) / (Math.hypot(width, height) || 1);
}

export interface SmootherOptions {
  /** Kâğıt bir an bulunamazsa son dörtgen bu kadar tutulur (ms); varsayılan 450 */
  holdMs?: number;
  /** Bu orandan (köşegen) büyük sıçrama tek karede kabul edilmez: ardışık iki kare aynı yeri gösterince; varsayılan 0,12 */
  jump?: number;
  /** Durgun köşenin yeni değere yaklaşma oranı (titreme bastırılır); varsayılan 0,3 */
  minAlpha?: number;
  /** Bu orandan (köşegen) çok kayan köşe doğrudan yeni yerine gider (gerçek hareket gecikmesin); varsayılan 0,04 */
  fastShift?: number;
}

/**
 * Dörtgen yumuşatma: her köşe kendi kaymasına göre üstel ortalama (az kayan köşe yavaş, çok kayan hızlı: titreme gider,
 * el hareketi gecikmez). Tek karelik yanlış dörtgen (başka bir nesne) atlanır; kâğıt bir an kaybolursa kısa süre tutulur.
 */
export class QuadSmoother {
  private cur: Quad | null = null;
  private pending: Quad | null = null;
  private seen = -Infinity;
  private readonly holdMs: number;
  private readonly jump: number;
  private readonly minAlpha: number;
  private readonly fastShift: number;

  constructor(opts: SmootherOptions = {}) {
    this.holdMs = opts.holdMs ?? 450;
    this.jump = opts.jump ?? 0.12;
    this.minAlpha = opts.minAlpha ?? 0.3;
    this.fastShift = opts.fastShift ?? 0.04;
  }

  /** Yeni karenin dörtgeni (bulunamadıysa null); döner: gösterilecek dörtgen (yoksa null) */
  push(q: Quad | null, t: number, width: number, height: number): Quad | null {
    if (!q) {
      this.pending = null;
      if (this.cur && t - this.seen > this.holdMs) this.cur = null;
      return this.cur;
    }
    if (!this.cur || t - this.seen > this.holdMs) {
      this.cur = copy(q);
      this.pending = null;
      this.seen = t;
      return this.cur;
    }
    if (quadShift(this.cur, q, width, height) > this.jump) {
      // Sıçrama: ikinci kare aynı yeri gösterirse kabul (telefon başka yere çevrildi), göstermezse yok sayılır
      if (this.pending && quadShift(this.pending, q, width, height) <= this.jump / 2) {
        this.cur = copy(q);
        this.pending = null;
        this.seen = t;
      } else this.pending = copy(q);
      return this.cur;
    }
    this.pending = null;
    this.seen = t;
    const diag = Math.hypot(width, height) || 1;
    this.cur = this.cur.map((p, i) => {
      const n = q[i];
      const d = Math.hypot(n.x - p.x, n.y - p.y) / diag;
      const a = this.minAlpha + (1 - this.minAlpha) * Math.min(1, d / this.fastShift);
      return { x: p.x + a * (n.x - p.x), y: p.y + a * (n.y - p.y) };
    }) as Quad;
    return this.cur;
  }

  get quad(): Quad | null {
    return this.cur;
  }

  reset() {
    this.cur = null;
    this.pending = null;
    this.seen = -Infinity;
  }
}

function copy(q: Quad): Quad {
  return q.map((p) => ({ x: p.x, y: p.y })) as Quad;
}

/** Karenin ölçüleri (kâğıdın içinde; kâğıt yoksa bütün kare) */
export interface FrameMetrics {
  /** Ortalama parlaklık (0–255) */
  luma: number;
  /** Netlik: gradyanların %90'lık değeri, karşıtlığa bölünmüş (yalnız aynı çekimin kareleri arasında karşılaştırılır) */
  sharpness: number;
}

/**
 * Küçük karede kâğıdın içinin parlaklığı ve netliği. Kenara yakın şerit (kâğıdın kendi kenarı her zaman keskin)
 * atlanır: dörtgen merkezine doğru %10 küçültülür. Örnek seyrek (en çok ~6000 nokta).
 */
export function frameMetrics(img: RgbaImage, q: Quad | null): FrameMetrics {
  const { width: w, height: h, data } = img;
  const lum = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
  let inner: Point[] | null = null;
  let x0 = 1;
  let y0 = 1;
  let x1 = w - 2;
  let y1 = h - 2;
  if (q) {
    const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
    const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
    inner = q.map((p) => ({ x: cx + 0.9 * (p.x - cx), y: cy + 0.9 * (p.y - cy) }));
    x0 = Math.max(1, Math.floor(Math.min(...inner.map((p) => p.x))));
    y0 = Math.max(1, Math.floor(Math.min(...inner.map((p) => p.y))));
    x1 = Math.min(w - 2, Math.ceil(Math.max(...inner.map((p) => p.x))));
    y1 = Math.min(h - 2, Math.ceil(Math.max(...inner.map((p) => p.y))));
  }
  if (x1 <= x0 || y1 <= y0) return { luma: 0, sharpness: 0 };
  const step = Math.max(1, Math.round(Math.sqrt(((x1 - x0) * (y1 - y0)) / 6000)));
  const lumHist = new Uint32Array(256);
  const grads: number[] = [];
  let sum = 0;
  let n = 0;
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      if (inner && !insideConvex(inner, { x, y })) continue;
      const v = lum(x, y);
      sum += v;
      n++;
      lumHist[Math.min(255, Math.round(v))]++;
      grads.push(Math.abs(lum(x + 1, y) - lum(x - 1, y)) + Math.abs(lum(x, y + 1) - lum(x, y - 1)));
    }
  }
  if (!n) return { luma: 0, sharpness: 0 };
  grads.sort((a, b) => a - b);
  const pct = (p: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += lumHist[v];
      if (acc >= p * n) return v;
    }
    return 255;
  };
  const contrast = pct(0.95) - pct(0.05);
  return { luma: sum / n, sharpness: grads[Math.floor(0.9 * (grads.length - 1))] / (contrast + 16) };
}

/** Vizörün kullanıcıya söylediği (tek satır) */
export type LiveHint = "ara" | "yaklas" | "uzaklas" | "kare-dolu" | "karanlik" | "bulanik" | "sabit-tut" | "cekiliyor" | "hazir";

export const LIVE_HINT_TEXT: Record<LiveHint, string> = {
  ara: "Kâğıdı çerçeveye alın",
  yaklas: "Biraz yaklaşın",
  uzaklas: "Kâğıdın tamamı görünsün; biraz uzaklaşın",
  "kare-dolu": "Kenarlar görünmüyor; biraz uzaklaşın ya da elle çekin",
  karanlik: "Işık az; ışıklı bir yere geçin",
  bulanik: "Netleşiyor; telefonu sabit tutun",
  "sabit-tut": "Sabit tutun…",
  cekiliyor: "Çekiliyor…",
  hazir: "Hazır; deklanşöre basın",
};

/** Bir karenin algılaması (küçük karenin pikselinde) */
export interface LiveFrame {
  t: number;
  width: number;
  height: number;
  /** Bulunan dörtgen (yumuşatılmamış); yoksa null */
  quad: Quad | null;
  confidence: number;
  fillsFrame: boolean;
  luma: number;
  sharpness: number;
}

export interface AutoCaptureOptions {
  /** Kâğıt bu kadar süre kıpırdamamalı (ms); varsayılan 500 */
  stableMs?: number;
  /** Sonra geri sayım (ms); varsayılan 900 */
  countdownMs?: number;
  /** Sabit sayılmak için köşelerin en çok kayması (köşegenin oranı); varsayılan 0,015 */
  moveTol?: number;
  /** Kâğıt karenin en az bu oranı olmalı; varsayılan 0,15 */
  minArea?: number;
  /** Köşe karenin kenarına bu orandan yakınsa (ya da dışındaysa) kâğıt kesiliyor sayılır; varsayılan 0,006 */
  edgeMargin?: number;
  /** Algılamanın en az güveni; varsayılan 0,55 */
  minConfidence?: number;
  /** En az parlaklık; varsayılan 55 */
  minLuma?: number;
  /** Netlik son 2 saniyenin en iyisinin en az bu oranı olmalı (odak arıyor, el titriyor); varsayılan 0,6 */
  sharpRatio?: number;
}

export interface AutoCaptureState {
  hint: LiveHint;
  /** Kâğıt sabit ve kalite iyi (elle çekmeye de hazır) */
  ready: boolean;
  /** Geri sayımın ilerleyişi (0–1); geri sayım yoksa 0 */
  progress: number;
  /** Bu karede çek (bir kez; `reset` ile yeniden kurulur) */
  fire: boolean;
}

/**
 * Otomatik çekim kararı: kâğıt bulundu, yeterince büyük, kareden taşmıyor, ışık ve netlik yeterli ve son `stableMs`
 * boyunca kıpırdamadıysa geri sayım başlar; geri sayım biterken hâlâ öyleyse çekilir. Arada bir koşul bozulursa
 * geri sayım baştan. `auto` kapalıyken yalnız ipucu ve `ready` (elle çekim) verilir.
 */
export class AutoCapture {
  private hist: { t: number; quad: Quad }[] = [];
  private sharp: { t: number; v: number }[] = [];
  private start: number | null = null;
  private fired = false;
  private readonly o: Required<AutoCaptureOptions>;

  constructor(opts: AutoCaptureOptions = {}) {
    this.o = {
      stableMs: opts.stableMs ?? 500,
      countdownMs: opts.countdownMs ?? 900,
      moveTol: opts.moveTol ?? 0.015,
      minArea: opts.minArea ?? 0.15,
      edgeMargin: opts.edgeMargin ?? 0.006,
      minConfidence: opts.minConfidence ?? 0.55,
      minLuma: opts.minLuma ?? 55,
      sharpRatio: opts.sharpRatio ?? 0.6,
    };
  }

  /** Karenin kalitesine göre ipucu (sabitlik hariç); iyi ise null */
  private advice(f: LiveFrame): LiveHint | null {
    const o = this.o;
    if (f.fillsFrame) return "kare-dolu";
    if (!f.quad || f.confidence < o.minConfidence) return "ara";
    const mx = o.edgeMargin * f.width;
    const my = o.edgeMargin * f.height;
    if (f.quad.some((p) => p.x < mx || p.y < my || p.x > f.width - 1 - mx || p.y > f.height - 1 - my)) return "uzaklas";
    if (polygonArea(f.quad) < o.minArea * f.width * f.height) return "yaklas";
    if (f.luma < o.minLuma) return "karanlik";
    const best = Math.max(0, ...this.sharp.map((s) => s.v));
    if (best > 0 && f.sharpness < o.sharpRatio * best) return "bulanik";
    return null;
  }

  push(f: LiveFrame, auto = true): AutoCaptureState {
    const o = this.o;
    // Netliğin son 2 saniyesi (kâğıt varken)
    if (f.quad && !f.fillsFrame) this.sharp.push({ t: f.t, v: f.sharpness });
    this.sharp = this.sharp.filter((s) => f.t - s.t <= 2000);
    if (f.quad) this.hist.push({ t: f.t, quad: f.quad });
    else this.hist = [];
    this.hist = this.hist.filter((h) => f.t - h.t <= o.stableMs + 400);
    const bad = this.advice(f);
    if (bad) {
      this.start = null;
      return { hint: bad, ready: false, progress: 0, fire: false };
    }
    // Sabitlik: son `stableMs` içindeki her karenin dörtgeni şimdikine yakın, ve geçmiş o kadar uzun
    const quad = f.quad!;
    const window = this.hist.filter((h) => f.t - h.t <= o.stableMs);
    const span = window.length ? f.t - window[0].t : 0;
    const moved = Math.max(0, ...window.map((h) => quadShift(h.quad, quad, f.width, f.height)));
    const stable = span >= o.stableMs * 0.8 && moved <= o.moveTol;
    if (!stable) {
      this.start = null;
      return { hint: "sabit-tut", ready: false, progress: 0, fire: false };
    }
    if (!auto || this.fired) {
      this.start = null;
      return { hint: this.fired ? "cekiliyor" : "hazir", ready: true, progress: 0, fire: false };
    }
    this.start ??= f.t;
    const progress = Math.min(1, (f.t - this.start) / o.countdownMs);
    if (progress >= 1) {
      this.fired = true;
      return { hint: "cekiliyor", ready: true, progress: 1, fire: true };
    }
    return { hint: "sabit-tut", ready: true, progress, fire: false };
  }

  reset() {
    this.hist = [];
    this.sharp = [];
    this.start = null;
    this.fired = false;
  }
}

/** Algılama kopyasının uzun kenarı: en az / başlangıç / en çok (px) */
export const LIVE_EDGE = { min: 192, start: 288, max: 384 } as const;

/**
 * Algılama süresine göre bir sonraki karenin ölçüsü: yavaş telefonda küçülür (~8–12 kare/sn kalsın), hızlıda büyür
 * (köşeler daha doğru). `ms`: son algılamanın süresi
 */
export function nextLiveEdge(edge: number, ms: number): number {
  if (ms > 100) return Math.max(LIVE_EDGE.min, Math.round(edge * 0.85));
  if (ms < 45) return Math.min(LIVE_EDGE.max, Math.round(edge * 1.1));
  return edge;
}

/** İki algılama arasında en az (ms): saniyede en çok ~12 kare */
export const LIVE_MIN_INTERVAL = 80;
