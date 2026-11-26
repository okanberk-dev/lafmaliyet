// Belge tarayıcının kalite, yön ve birleştirme testleri için gerçek yazılı sentetik belge (dış kitaplık yok): satırlar
// Inter yazı tipiyle (vardiya PDF'inin gömülü alt kümesi, Türkçe harfler dahil) kâğıt düzleminde mürekkep kaplamasına
// (0–1) çizilir; sonra kâğıt bir sahneye konur (perspektif, gölge, parlama, karanlık, bulanıklık, gürültü). Fiş (termal
// rulo, 576 nokta = 72 mm), uzun Z raporu ve A4 belge örnekleri. src/lib/scan/quality.ts, orientation.ts, stitch.ts;
// docs/FOTOGRAF.md › Belge tarama (kalite, yön, birleştirme).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as fontkit from "@pdf-lib/fontkit";

import type { Point, Quad, RgbaImage } from "../../src/lib/scan/image";
import { gaussianBlur, seededRandom } from "../../src/lib/scan/image";
import { applyHomography, homography } from "../../src/lib/scan/warp";

const FONTS = join(process.cwd(), "src/server/vardiya/fonts");
let regular: fontkit.Font | null = null;
let bold: fontkit.Font | null = null;
function font(b: boolean): fontkit.Font {
  if (b) return (bold ??= fontkit.create(readFileSync(join(FONTS, "Inter-SemiBold.subset.ttf"))));
  return (regular ??= fontkit.create(readFileSync(join(FONTS, "Inter-Regular.subset.ttf"))));
}

/** Alt örnekleme: her piksel SS × SS örnek */
const SS = 3;

type Pt = [number, number];

/** Glif yolunu düz çokgenlere çevirir (eğriler 6 parçaya bölünür) */
function outline(path: fontkit.Path): Pt[][] {
  const polys: Pt[][] = [];
  let cur: Pt[] = [];
  let at: Pt = [0, 0];
  const N = 6;
  const ctx = {
    moveTo(x: number, y: number) {
      if (cur.length) polys.push(cur);
      cur = [[x, y]];
      at = [x, y];
    },
    lineTo(x: number, y: number) {
      cur.push([x, y]);
      at = [x, y];
    },
    quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
      const [x0, y0] = at;
      for (let i = 1; i <= N; i++) {
        const t = i / N;
        const u = 1 - t;
        cur.push([u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y]);
      }
      at = [x, y];
    },
    bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
      const [x0, y0] = at;
      for (let i = 1; i <= N; i++) {
        const t = i / N;
        const u = 1 - t;
        cur.push([
          u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x,
          u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y,
        ]);
      }
      at = [x, y];
    },
    closePath() {
      if (cur.length) polys.push(cur);
      cur = [];
    },
  };
  (path.toFunction() as unknown as (c: typeof ctx) => void)(ctx);
  if (cur.length) polys.push(cur);
  return polys;
}

/** Sıfır olmayan sarım kuralıyla doldurur (yalnız çokgenlerin kutusundaki satırlar) */
function fill(mask: Uint8Array, w: number, h: number, polys: Pt[][]): void {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of polys) {
    for (const [, y] of p) {
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  const from = Math.max(0, Math.floor(y0));
  const to = Math.min(h - 1, Math.ceil(y1));
  const xs: { x: number; d: number }[] = [];
  for (let y = from; y <= to; y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (const p of polys) {
      for (let i = 0; i < p.length; i++) {
        const [ax, ay] = p[i];
        const [bx, by] = p[(i + 1) % p.length];
        if (ay === by || sy < Math.min(ay, by) || sy >= Math.max(ay, by)) continue;
        xs.push({ x: ax + ((sy - ay) * (bx - ax)) / (by - ay), d: by > ay ? 1 : -1 });
      }
    }
    xs.sort((a, b) => a.x - b.x);
    let wind = 0;
    for (let k = 0; k < xs.length - 1; k++) {
      wind += xs[k].d;
      if (wind === 0) continue;
      const a = Math.max(0, Math.ceil(xs[k].x - 0.5));
      const b = Math.min(w - 1, Math.floor(xs[k + 1].x - 0.5));
      for (let x = a; x <= b; x++) mask[y * w + x] = 1;
    }
  }
}

/** Kâğıt: mürekkep kaplaması (0 = kâğıt, 1 = tam mürekkep), kâğıdın kendi pikselinde */
export interface Kagit {
  width: number;
  height: number;
  ink: Float32Array;
}

export interface Satir {
  text: string;
  /** "SOL|SAĞ" biçiminde sağ yanı sağa yaslanır; `orta` ortalar */
  align?: "sol" | "orta";
  bold?: boolean;
  /** yazı boyunun katı (fişteki çift yükseklikli TOPLAM gibi) */
  scale?: number;
}

/**
 * Satırları kâğıda çizer. `size` yazı tipinin boyu (em, piksel); satır aralığı `lineH` (varsayılan 1,45 × size);
 * `top` / `bottom` üst ve alt boşluk, `margin` yan boşluk (piksel).
 */
export function yaziCiz(
  lines: readonly (string | Satir)[],
  o: { width: number; size: number; lineH?: number; margin?: number; top?: number; bottom?: number },
): Kagit {
  const size = o.size;
  const lineH = o.lineH ?? Math.round(size * 1.45);
  const margin = o.margin ?? Math.round(size * 0.9);
  const top = o.top ?? Math.round(size * 1.2);
  const bottom = o.bottom ?? Math.round(size * 1.2);
  const rows = lines.map((l) => (typeof l === "string" ? { text: l } : l));
  const heights = rows.map((r) => Math.round(lineH * (r.scale ?? 1)));
  const height = top + bottom + heights.reduce((a, b) => a + b, 0);
  const width = o.width;
  const W = width * SS;
  const H = height * SS;
  const mask = new Uint8Array(W * H);
  const draw = (text: string, f: fontkit.Font, sz: number, x0: number, base: number, anchor: "sol" | "sag" | "orta") => {
    const scale = (sz * SS) / f.unitsPerEm;
    const run = f.layout(text);
    const total = run.positions.reduce((a, p) => a + p.xAdvance, 0) * scale;
    let x = anchor === "sag" ? x0 - total : anchor === "orta" ? x0 - total / 2 : x0;
    run.glyphs.forEach((g, i) => {
      const polys = outline(g.path).map((p) => p.map(([gx, gy]) => [x + gx * scale, base - gy * scale] as Pt));
      if (polys.length) fill(mask, W, H, polys);
      x += run.positions[i].xAdvance * scale;
    });
  };
  let y = top;
  rows.forEach((r, i) => {
    const sz = size * (r.scale ?? 1);
    const base = (y + heights[i] * 0.78) * SS;
    const f = font(!!r.bold);
    if (r.align === "orta") draw(r.text, f, sz, (width / 2) * SS, base, "orta");
    else {
      const [left, right] = r.text.split("|");
      if (left) draw(left, f, sz, margin * SS, base, "sol");
      if (right) draw(right, f, sz, (width - margin) * SS, base, "sag");
    }
    y += heights[i];
  });
  const ink = new Float32Array(width * height);
  for (let yy = 0; yy < height; yy++) {
    for (let x = 0; x < width; x++) {
      let n = 0;
      for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) n += mask[(yy * SS + dy) * W + x * SS + dx];
      ink[yy * width + x] = n / (SS * SS);
    }
  }
  return { width, height, ink };
}

// ---------------------------------------------------------------- örnek belgeler

const URUNLER = [
  "EKMEK",
  "SÜT 1 LT",
  "YUMURTA 10'LU",
  "BEYAZ PEYNİR KG",
  "DOMATES KG",
  "SALATALIK KG",
  "ZEYTİNYAĞI 1 LT",
  "ÇAY 1000 GR",
  "ŞEKER 5 KG",
  "UN 2 KG",
  "MAKARNA 500 GR",
  "PİRİNÇ 1 KG",
  "TEREYAĞI 250 GR",
  "KAŞAR PEYNİRİ",
  "SUCUK 250 GR",
  "DETERJAN 4 KG",
  "KAĞIT HAVLU",
  "PEÇETE 100'LÜ",
  "SOĞAN KG",
  "PATATES KG",
];

function tutar(rnd: () => number, max = 400): string {
  const v = Math.round((5 + rnd() * max) * 100) / 100;
  const [a, b] = v.toFixed(2).split(".");
  return `*${a.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${b}`;
}

/** Market fişi satırları (başlık ortada, ürünler solda, tutarlar sağda, toplam, alt bilgi) */
export function fisSatirlari(seed = 1, urun = 14): Satir[] {
  const rnd = seededRandom(seed);
  const out: Satir[] = [
    { text: "LAF GIDA SAN. VE TİC. LTD. ŞTİ.", align: "orta", bold: true },
    { text: "CUMHURİYET MAH. ATATÜRK CAD. NO:12", align: "orta" },
    { text: "KADIKÖY / İSTANBUL", align: "orta" },
    { text: "V.D. KADIKÖY V.NO: 1234567890", align: "orta" },
    { text: "TARİH: 26.11.2026|SAAT: 14:32" },
    { text: "FİŞ NO: 0042" },
  ];
  for (let i = 0; i < urun; i++) {
    const n = URUNLER[Math.floor(rnd() * URUNLER.length)];
    out.push({ text: `${n} %${rnd() < 0.5 ? 1 : 10}|${tutar(rnd)}` });
  }
  out.push({ text: "TOPKDV|" + tutar(rnd, 90) });
  out.push({ text: "TOPLAM|" + tutar(rnd, 2500), bold: true, scale: 1.4 });
  out.push({ text: "NAKİT|" + tutar(rnd, 2500) });
  out.push({ text: "KASİYER: AYŞE Y.|Z NO: 0318" });
  out.push({ text: "EKÜ NO: 0001  MF YAB 18000123", align: "orta" });
  return out;
}

/** Uzun Z raporu satırları (kısım, KDV, saatlik satış; birbirine benzeyen çok satır) */
export function zSatirlari(seed = 2, saat = 14): Satir[] {
  const rnd = seededRandom(seed);
  const out: Satir[] = [
    { text: "LAF GIDA SAN. VE TİC. LTD. ŞTİ.", align: "orta", bold: true },
    { text: "KADIKÖY / İSTANBUL", align: "orta" },
    { text: "Z RAPORU", align: "orta", bold: true, scale: 1.4 },
    { text: "TARİH: 26.11.2026|SAAT: 23:58" },
    { text: "Z NO: 0318|EKÜ NO: 0001" },
    { text: "KISIM SATIŞLARI", align: "orta", bold: true },
  ];
  for (let k = 1; k <= 8; k++) {
    out.push({ text: `KISIM ${String(k).padStart(2, "0")}  %${k % 2 ? 10 : 1}|${tutar(rnd, 3000)}` });
    out.push({ text: `  ADET ${Math.floor(rnd() * 90 + 3)}|${tutar(rnd, 300)}` });
  }
  out.push({ text: "KDV DÖKÜMÜ", align: "orta", bold: true });
  for (const o of [1, 10, 20]) {
    out.push({ text: `KDV %${o} MATRAH|${tutar(rnd, 9000)}` });
    out.push({ text: `KDV %${o} TUTAR|${tutar(rnd, 900)}` });
  }
  out.push({ text: "SAATLİK SATIŞLAR", align: "orta", bold: true });
  for (let s = 0; s < saat; s++) {
    const h = 9 + s;
    out.push({ text: `${String(h).padStart(2, "0")}:00-${String(h + 1).padStart(2, "0")}:00  FİŞ ${Math.floor(rnd() * 40 + 1)}|${tutar(rnd, 2000)}` });
  }
  out.push({ text: "ÖDEME TİPLERİ", align: "orta", bold: true });
  out.push({ text: "NAKİT|" + tutar(rnd, 9000) });
  out.push({ text: "KREDİ KARTI|" + tutar(rnd, 20000) });
  out.push({ text: "YEMEK KARTI|" + tutar(rnd, 3000) });
  out.push({ text: "GÜNLÜK TOPLAM|" + tutar(rnd, 30000), bold: true, scale: 1.4 });
  out.push({ text: "TOPLAM KDV|" + tutar(rnd, 3000) });
  out.push({ text: "FİŞ SAYISI|412" });
  out.push({ text: "İPTAL FİŞ|3" });
  out.push({ text: "MALİ BELLEK DOLULUK %12", align: "orta" });
  out.push({ text: "MF YAB 18000123", align: "orta" });
  return out;
}

const PARAGRAF =
  "Sayın müşterimiz, bu belge aşağıda dökümü yapılan mal ve hizmetlerin bedelini göstermektedir. Ödeme vadesi " +
  "fatura tarihinden itibaren otuz gündür; geciken ödemelere yasal faiz uygulanır. İtirazlarınızı sekiz gün içinde " +
  "yazılı olarak bildirmeniz gerekir. Teslim alınan ürünlerin miktar ve fiyatları sipariş formuyla karşılaştırılmış, " +
  "eksik ya da hatalı kalem bulunmadığı tarafımızca onaylanmıştır. Şirketimiz kişisel verilerinizi yalnızca yasal " +
  "yükümlülükler için işler; ayrıntılı bilgi internet sitemizde yer almaktadır. Bizi tercih ettiğiniz için teşekkür " +
  "ederiz, iyi günler dileriz.";

/** Sola yaslı, sağı düzensiz paragraf satırları (büyük-küçük harf karışık) */
export function paragrafSatirlari(width: number, size: number, tekrar = 2): Satir[] {
  const f = font(false);
  const scale = size / f.unitsPerEm;
  const max = width - 2 * Math.round(size * 0.9);
  const words = Array.from({ length: tekrar }, () => PARAGRAF).join(" ").split(" ");
  const out: Satir[] = [{ text: "FATURA", bold: true, scale: 1.6 }, { text: "Fatura No: LAF2026000123      Tarih: 26.11.2026" }, { text: "" }];
  let cur = "";
  const widthOf = (s: string) => f.layout(s).positions.reduce((a, p) => a + p.xAdvance, 0) * scale;
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (widthOf(next) > max && cur) {
      out.push({ text: cur });
      cur = w;
    } else cur = next;
  }
  if (cur) out.push({ text: cur });
  return out;
}

// ---------------------------------------------------------------- sahne

export interface SahneAyari {
  width: number;
  height: number;
  /** kâğıdın köşelerinin sahnedeki yeri (sol üst, sağ üst, sağ alt, sol alt); verilmezse kâğıt kareyi doldurur */
  corners?: Quad;
  bg?: [number, number, number];
  paper?: [number, number, number];
  inkColor?: [number, number, number];
  /** mürekkebin koyuluğu (0–1; soluk termal baskı ~0,4) */
  inkStrength?: number;
  /** genel ışık çarpanı (karanlık fotoğraf: 0,3) */
  light?: number;
  /** soldan sağa yumuşak gölge (0–1) */
  shadow?: number;
  /** sarı ışık: mavi kanal bu oranda azalır */
  warm?: number;
  /** parlama: sahnede merkez ve yarıçap (piksel); merkezde doymuş beyaz, kenara doğru söner */
  glare?: { x: number; y: number; r: number; strength?: number }[];
  /** Gauss bulanıklığı (σ, piksel) */
  blur?: number;
  /** tek yönlü (hareket) bulanıklık uzunluğu (piksel, yatay) */
  motion?: number;
  /** Gauss gürültüsü (σ, 0–255) */
  noise?: number;
  seed?: number;
}

/** Kâğıdı sahneye koyar (perspektif, gölge, parlama, ışık, bulanıklık, gürültü). 2 × 2 alt örnekleme. */
export function sahne(k: Kagit | Kagit[], s: SahneAyari, cornersList?: Quad[]): RgbaImage {
  const papers = Array.isArray(k) ? k : [k];
  const quads: Quad[] =
    cornersList ??
    [
      s.corners ?? [
        { x: -0.5, y: -0.5 },
        { x: s.width - 0.5, y: -0.5 },
        { x: s.width - 0.5, y: s.height - 0.5 },
        { x: -0.5, y: s.height - 0.5 },
      ],
    ];
  const { width: w, height: h } = s;
  const rnd = seededRandom(s.seed ?? 1);
  const bg = s.bg ?? [96, 84, 72];
  const paper = s.paper ?? [240, 238, 232];
  const inkC = s.inkColor ?? [30, 30, 36];
  const strength = s.inkStrength ?? 1;
  const maps = papers.map((p, i) => {
    const q = quads[i];
    const corners: Point[] = [
      { x: -0.5, y: -0.5 },
      { x: p.width - 0.5, y: -0.5 },
      { x: p.width - 0.5, y: p.height - 0.5 },
      { x: -0.5, y: p.height - 0.5 },
    ];
    return { p, H: homography(q, corners) };
  });
  const out = new Float32Array(w * h * 3);
  const tex = new Float32Array(w * h);
  for (let i = 0; i < tex.length; i++) tex[i] = rnd() - 0.5;
  const SUB = 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const px = x + (sx + 0.5) / SUB - 0.5;
          const py = y + (sy + 0.5) / SUB - 0.5;
          let hit = false;
          for (let m = maps.length - 1; m >= 0 && !hit; m--) {
            const { p, H } = maps[m];
            const uv = applyHomography(H, { x: px, y: py });
            if (uv.x < -0.5 || uv.y < -0.5 || uv.x > p.width - 0.5 || uv.y > p.height - 0.5) continue;
            hit = true;
            const ux = Math.max(0, Math.min(p.width - 1, uv.x));
            const vy = Math.max(0, Math.min(p.height - 1, uv.y));
            const x0 = Math.floor(ux);
            const y0 = Math.floor(vy);
            const x1 = Math.min(p.width - 1, x0 + 1);
            const y1 = Math.min(p.height - 1, y0 + 1);
            const fx = ux - x0;
            const fy = vy - y0;
            const a =
              (p.ink[y0 * p.width + x0] * (1 - fx) + p.ink[y0 * p.width + x1] * fx) * (1 - fy) +
              (p.ink[y1 * p.width + x0] * (1 - fx) + p.ink[y1 * p.width + x1] * fx) * fy;
            const t = a * strength;
            r += paper[0] + (inkC[0] - paper[0]) * t;
            g += paper[1] + (inkC[1] - paper[1]) * t;
            b += paper[2] + (inkC[2] - paper[2]) * t;
          }
          if (!hit) {
            const n = 14 * tex[y * w + x];
            r += bg[0] + n;
            g += bg[1] + n;
            b += bg[2] + n;
          }
        }
      }
      const i = y * w + x;
      const k4 = SUB * SUB;
      out[i * 3] = r / k4;
      out[i * 3 + 1] = g / k4;
      out[i * 3 + 2] = b / k4;
    }
  }
  const light = s.light ?? 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let f = light;
      if (s.shadow) f *= 1 - s.shadow / (1 + Math.exp(((x / w) - 0.4) * 14));
      out[i * 3] *= f;
      out[i * 3 + 1] *= f;
      out[i * 3 + 2] *= f * (1 - (s.warm ?? 0));
      for (const gl of s.glare ?? []) {
        const d = Math.hypot(x - gl.x, y - gl.y) / gl.r;
        // düz tepeli leke: merkezde doymuş, kenarda söner
        const a = (gl.strength ?? 1) * Math.min(1, 1.6 * Math.exp(-d * d * 1.2));
        for (let c = 0; c < 3; c++) out[i * 3 + c] = out[i * 3 + c] + (275 - out[i * 3 + c]) * a;
      }
    }
  }
  if (s.blur || s.motion) {
    for (let c = 0; c < 3; c++) {
      let ch: Float32Array = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) ch[i] = out[i * 3 + c];
      if (s.blur) ch = gaussianBlur({ width: w, height: h, data: ch }, s.blur).data;
      if (s.motion) {
        const L = Math.max(1, Math.round(s.motion));
        const m = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            let acc = 0;
            for (let d = 0; d < L; d++) acc += ch[y * w + Math.min(w - 1, Math.max(0, x + d - (L >> 1)))];
            m[y * w + x] = acc / L;
          }
        }
        ch = m;
      }
      for (let i = 0; i < w * h; i++) out[i * 3 + c] = ch[i];
    }
  }
  const img: RgbaImage = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  const nr = seededRandom((s.seed ?? 1) + 101);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, nr()))) * Math.cos(2 * Math.PI * nr());
  const sigma = s.noise ?? 0;
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) img.data[i * 4 + c] = out[i * 3 + c] + (sigma ? sigma * gauss() : 0);
    img.data[i * 4 + 3] = 255;
  }
  return img;
}

/** Kâğıdı olduğu gibi (kırpılmış, düz) RGBA'ya çevirir */
export function kagitRgba(k: Kagit, o: Omit<SahneAyari, "width" | "height" | "corners"> = {}): RgbaImage {
  return sahne(k, { ...o, width: k.width, height: k.height });
}

/** Kâğıdın bir dilimi (y0 … y1 satırları) */
export function dilim(k: Kagit, y0: number, y1: number): Kagit {
  const a = Math.max(0, Math.round(y0));
  const b = Math.min(k.height, Math.round(y1));
  return { width: k.width, height: b - a, ink: k.ink.slice(a * k.width, b * k.width) };
}

/** Eksene hizalı dikdörtgen köşeleri (sahnede) */
export function dikdortgen(x: number, y: number, w: number, h: number): Quad {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

/** Dikdörtgeni merkezi etrafında döndürür (derece, saat yönünde) */
export function dondur(q: Quad, deg: number): Quad {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return q.map((p) => ({ x: cx + (p.x - cx) * c - (p.y - cy) * s, y: cy + (p.x - cx) * s + (p.y - cy) * c })) as Quad;
}
