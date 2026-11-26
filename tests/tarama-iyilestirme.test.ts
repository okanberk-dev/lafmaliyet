// Belge tarayıcı: taranmış görünüm ve eğiklik. "belge" modunda gölgeli kâğıt bembeyaz, mürekkep koyu, soluk termal
// baskı yine koyu, mavi tükenmez ve kırmızı kaşe koyu; tek başına benekler silinir, yazının yanındaki nokta kalır.
// "gri", "renkli" (sarı ışık gider), "orijinal". Kalan eğiklik yazı satırlarından bulunur ve düzeltilir (dar fişte
// yamultma). src/lib/scan/enhance.ts, index.ts; docs/FOTOGRAF.md › Belge tarama (çekirdek).
// Çalıştırma: npx tsx --test tests/tarama-iyilestirme.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { createRgba, type Point, type RgbaImage } from "../src/lib/scan/image";
import { despeckle, enhance, enhanceDocument, estimateSkew } from "../src/lib/scan/enhance";
import { fullFrame, rotationForTop, scanDocument } from "../src/lib/scan";
import { estimateSize } from "../src/lib/scan/warp";
import { regionMean, renderScene } from "./helpers/tarama-sentetik";

type Rgb = [number, number, number];

/**
 * Düzleştirilmiş sayfa: kâğıt rengi × aydınlatma (sol üstten sağ alta gölge, isteğe bağlı sarı ışık); `strokes`
 * bölgelerinde 3 px kalınlığında yatay çizgiler (satır aralığı 14 px) verilen mürekkeple.
 */
function page(o: {
  width: number;
  height: number;
  shadow?: number;
  warm?: number;
  strokes: { x0: number; y0: number; x1: number; y1: number; ink: Rgb }[];
  dots?: { x: number; y: number; r: number }[];
}): RgbaImage {
  const img = createRgba(o.width, o.height);
  const paper: Rgb = [236, 234, 228];
  for (let y = 0; y < o.height; y++) {
    for (let x = 0; x < o.width; x++) {
      const t = (x / o.width + y / o.height) / 2;
      const light = 1 - (o.shadow ?? 0) * (1 / (1 + Math.exp((t - 0.5) * 10)));
      let c: Rgb = paper;
      for (const s of o.strokes) {
        if (x >= s.x0 && x < s.x1 && y >= s.y0 && y < s.y1 && (y - s.y0) % 14 < 3) c = s.ink;
      }
      for (const d of o.dots ?? []) if (Math.abs(x - d.x) <= d.r && Math.abs(y - d.y) <= d.r) c = [30, 30, 30];
      const p = (y * o.width + x) * 4;
      img.data[p] = c[0] * light;
      img.data[p + 1] = c[1] * light;
      img.data[p + 2] = c[2] * light * (1 - (o.warm ?? 0));
      img.data[p + 3] = 255;
    }
  }
  return img;
}

/** Çizgilerin orta satırlarının (her satırın 2. pikseli) ortalaması */
function strokeMean(img: RgbaImage, x0: number, y0: number, x1: number, y1: number): number {
  let s = 0;
  let n = 0;
  for (let y = y0 + 1; y < y1; y += 14) {
    for (let x = x0 + 4; x < x1 - 4; x++) {
      s += img.data[(y * img.width + x) * 4];
      n++;
    }
  }
  return s / n;
}

const DARK: Rgb = [38, 36, 40];
const FAINT: Rgb = [168, 166, 162];
const BLUE: Rgb = [45, 70, 170];
const RED: Rgb = [190, 45, 45];

test("belge: gölgeli kâğıt bembeyaz, mürekkep koyu, soluk baskı yine koyu, mavi ve kırmızı koyu", () => {
  const W = 800;
  const H = 1000;
  const img = page({
    width: W,
    height: H,
    shadow: 0.55,
    warm: 0.12,
    strokes: [
      { x0: 60, y0: 80, x1: 380, y1: 400, ink: DARK },
      { x0: 440, y0: 80, x1: 740, y1: 400, ink: BLUE },
      { x0: 60, y0: 480, x1: 380, y1: 760, ink: RED },
      { x0: 440, y0: 560, x1: 740, y1: 940, ink: FAINT },
    ],
  });
  const { image: out, levels } = enhanceDocument(img);
  // kâğıt: gölgeli (sol üst) ve aydınlık (sağ alt) boş yerler
  const shaded = regionMean(out, 10, 10, 50, 60);
  const lit = regionMean(out, 750, 950, 790, 990);
  const gap = regionMean(out, 400, 420, 430, 540);
  assert.ok(regionMean(img, 10, 10, 50, 60) < 130, "giriş gerçekten gölgeli olmalı");
  for (const [name, v] of [
    ["gölgeli kâğıt", shaded],
    ["aydınlık kâğıt", lit],
    ["ara boşluk", gap],
  ] as const) {
    assert.ok(v >= 250, `${name} bembeyaz olmalı: ${v.toFixed(1)}`);
  }
  const dark = strokeMean(out, 60, 80, 380, 400);
  const blue = strokeMean(out, 440, 80, 740, 400);
  const red = strokeMean(out, 60, 480, 380, 760);
  const faint = strokeMean(out, 440, 560, 740, 940);
  assert.ok(dark <= 30, `koyu mürekkep ~siyah: ${dark.toFixed(1)}`);
  assert.ok(blue <= 60, `mavi tükenmez koyu: ${blue.toFixed(1)}`);
  assert.ok(red <= 90, `kırmızı kaşe koyu: ${red.toFixed(1)}`);
  assert.ok(faint <= 90, `soluk baskı yine koyu: ${faint.toFixed(1)} (girişte ${strokeMean(img, 440, 560, 740, 940).toFixed(0)})`);
  assert.ok(levels.t0 >= 0.035 && levels.t1 > levels.t0, `eşikler sıralı: ${JSON.stringify(levels)}`);
});

test("belge: yalnız soluk termal baskı olan sayfada siyah eşiği iner", () => {
  const W = 500;
  const H = 700;
  const faintOnly = enhanceDocument(page({ width: W, height: H, strokes: [{ x0: 40, y0: 40, x1: 460, y1: 660, ink: FAINT }] }));
  const darkOnly = enhanceDocument(page({ width: W, height: H, strokes: [{ x0: 40, y0: 40, x1: 460, y1: 660, ink: DARK }] }));
  assert.ok(faintOnly.levels.t1 < darkOnly.levels.t1 - 0.2, `soluk sayfada eşik düşük: ${faintOnly.levels.t1} / ${darkOnly.levels.t1}`);
  assert.ok(strokeMean(faintOnly.image, 40, 40, 460, 660) <= 40, "soluk yazı siyaha yakın");
  assert.ok(regionMean(faintOnly.image, 5, 5, 35, 35) >= 250, "kâğıt beyaz");
});

test("belge: tek başına benekler silinir, yazının yanındaki nokta kalır", () => {
  const W = 600;
  const H = 600;
  const img = page({
    width: W,
    height: H,
    strokes: [{ x0: 100, y0: 100, x1: 500, y1: 200, ink: DARK }],
    dots: [
      { x: 300, y: 400, r: 0 },
      { x: 450, y: 480, r: 0 },
      { x: 503, y: 101, r: 0 }, // satırın hemen yanında (i noktası gibi)
    ],
  });
  const { image: out, levels } = enhanceDocument(img);
  assert.ok(levels.specks > 0, "benek silinmeli");
  assert.ok(out.data[(400 * W + 300) * 4] >= 250, "tek başına benek beyaz");
  assert.ok(out.data[(480 * W + 450) * 4] >= 250, "tek başına benek beyaz");
  assert.ok(out.data[(101 * W + 503) * 4] < 128, "yazının yanındaki nokta kalır");
  // despeckle doğrudan: yalnız pencere sayımı
  const v = new Float32Array(100 * 100);
  v[50 * 100 + 50] = 1;
  for (let x = 10; x < 60; x++) v[20 * 100 + x] = 1;
  v[22 * 100 + 30] = 1;
  assert.equal(despeckle(v, 100, 100), 1, "yalnız uzak benek silinir");
  assert.equal(v[22 * 100 + 30], 1, "çizginin yanındaki nokta kalır");
});

test("gri, renkli ve orijinal modlar", () => {
  const W = 400;
  const H = 500;
  const img = page({
    width: W,
    height: H,
    shadow: 0.4,
    warm: 0.18,
    strokes: [
      { x0: 30, y0: 30, x1: 370, y1: 230, ink: DARK },
      { x0: 30, y0: 260, x1: 370, y1: 470, ink: RED },
    ],
  });
  const gray = enhance(img, "gri");
  assert.ok(regionMean(gray, 2, 2, 25, 25) >= 235, "gri: gölgeli kâğıt açık");
  assert.ok(strokeMean(gray, 30, 30, 370, 230) <= 80, "gri: mürekkep koyu");
  // eşiksiz: girişteki ince ton rampası (yazı kalınlığında) çıktıda da tekdüze artan ve çok tonlu
  const ramp = page({ width: W, height: H, strokes: [] });
  for (let y = 227; y < 233; y++) {
    for (let x = 40; x < 360; x++) {
      const v = 40 + ((x - 40) / 320) * 180;
      ramp.data.set([v, v, v * 0.97], (y * W + x) * 4);
    }
  }
  const gr = enhance(ramp, "gri");
  const row = Array.from({ length: 320 }, (_, i) => gr.data[(230 * W + 40 + i) * 4]);
  assert.ok(new Set(row).size > 60, `gri: ara tonlar var (${new Set(row).size})`);
  assert.ok(row.every((v, i) => i === 0 || v >= row[i - 1] - 1), "gri: ton sırası korunur");
  const color = enhance(img, "renkli");
  const p = (2 * W + 390) * 4; // sağ üst köşe: kâğıt
  assert.ok(Math.abs(color.data[p] - color.data[p + 2]) < 10, `renkli: sarı ışık gider (R ${color.data[p]}, B ${color.data[p + 2]})`);
  assert.ok(color.data[p + 1] >= 235, "renkli: kâğıt beyaz");
  const q = (275 * W + 100) * 4; // kırmızı çizgi
  assert.ok(color.data[q] > color.data[q + 1] + 60, `renkli: kırmızı kalır (${color.data[q]}, ${color.data[q + 1]})`);
  const orig = enhance(img, "orijinal");
  assert.deepEqual(orig.data, img.data, "orijinal: dokunulmaz");
});

test("eğiklik: yazı satırlarından bulunur (±0,3°), düz sayfada düzeltme yapılmaz", () => {
  for (const skew of [3, -2.5, 6]) {
    const img = renderScene({
      width: 700,
      height: 900,
      corners: [
        { x: -5, y: -5 },
        { x: 705, y: -5 },
        { x: 705, y: 905 },
        { x: -5, y: 905 },
      ],
      background: "gri",
      text: { rows: 30, skewDeg: skew, margin: 0.12 },
      noise: 2,
      seed: 40,
    });
    const s = estimateSkew(img);
    assert.ok(Math.abs(s.angle - skew) < 0.3, `eğiklik ${skew}° → ${s.angle}°`);
    assert.ok(s.confidence >= 0.5, `güven ${s.confidence}`);
    const r = scanDocument(img, { corners: fullFrame(700, 900), mode: "gri" });
    assert.ok(Math.abs(r.rotation + skew) < 0.3, `düzeltme ${r.rotation}° (beklenen ${-skew}°)`);
    assert.deepEqual([r.image.width, r.image.height], [700, 900], "sayfa sağa sola kaymaz, boyut aynı");
    const after = estimateSkew(r.image);
    assert.ok(Math.abs(after.angle) < 0.35, `düzeltmeden sonra satırlar düz: ${after.angle}°`);
  }
  const flat = renderScene({
    width: 700,
    height: 900,
    corners: fullFrame(700, 900),
    background: "gri",
    text: { rows: 30, margin: 0.12 },
    noise: 2,
    seed: 41,
  });
  const r = scanDocument(flat, { corners: fullFrame(700, 900) });
  assert.equal(r.rotation, 0, "düz sayfa döndürülmez");
});

test("eğiklik: dar uzun fişte yamultma (uzun kenarlar yerinde, satırlar düz)", () => {
  const W = 300;
  const H = 1500;
  const img = renderScene({
    width: W,
    height: H,
    corners: [
      { x: -3, y: -3 },
      { x: W + 3, y: -3 },
      { x: W + 3, y: H + 3 },
      { x: -3, y: H + 3 },
    ],
    background: "gri",
    text: { rows: 80, skewDeg: 2.5, margin: 0.1 },
    noise: 2,
    seed: 42,
  });
  const r = scanDocument(img, { corners: fullFrame(W, H), mode: "belge" });
  assert.ok(Math.abs(r.rotation + 2.5) < 0.4, `fişte düzeltme ${r.rotation}°`);
  assert.deepEqual([r.image.width, r.image.height], [W, H], "boyut değişmez");
  const sz = estimateSize(
    [
      { x: 10, y: 10 },
      { x: 110, y: 10 },
      { x: 110, y: 510 },
      { x: 10, y: 510 },
    ],
    W,
    H,
    2000,
  );
  assert.ok(sz.height >= 2 * sz.width, "bu oranda yamultma seçilir");
  // yamultmada sol ve sağ kenar yerinde: kenar sütunlarında koyu üçgen yok (kâğıt rengiyle dolar)
  assert.ok(regionMean(r.image, 0, 0, 4, H) > 240, "sol kenar şeridi beyaz");
  assert.ok(regionMean(r.image, W - 4, 0, W, H) > 240, "sağ kenar şeridi beyaz");
  assert.ok(Math.abs(estimateSkew(r.image).angle) < 0.5, "satırlar düz");
});

test("tarama: çeyrek çevirme (yapay zekânın üst kenar ipucu) açmayla birlikte", () => {
  // 400×300 gri zemin, kâğıt (50–350 × 40–260), kâğıdın sol üstünde koyu kare
  const img = createRgba(400, 300);
  for (let y = 0; y < 300; y++) {
    for (let x = 0; x < 400; x++) {
      let v = 90;
      if (x >= 50 && x < 350 && y >= 40 && y < 260) v = x >= 60 && x < 100 && y >= 50 && y < 90 ? 20 : 235;
      img.data.set([v, v, v, 255], (y * 400 + x) * 4);
    }
  }
  const corners: [Point, Point, Point, Point] = [
    { x: 49.5, y: 39.5 },
    { x: 349.5, y: 39.5 },
    { x: 349.5, y: 259.5 },
    { x: 49.5, y: 259.5 },
  ];
  const at = (r: ReturnType<typeof scanDocument>, fx: number, fy: number) =>
    regionMean(r.image, fx * r.image.width - 8, fy * r.image.height - 8, fx * r.image.width + 8, fy * r.image.height + 8);
  const r0 = scanDocument(img, { corners, mode: "orijinal", deskew: false });
  assert.deepEqual([r0.image.width, r0.image.height], [300, 220]);
  assert.ok(at(r0, 0.08, 0.13) < 60, "çevirmeden: koyu kare sol üstte");
  const r90 = scanDocument(img, { corners, mode: "orijinal", deskew: false, rotate: 90 });
  assert.deepEqual([r90.image.width, r90.image.height], [220, 300], "90°: en ve boy yer değiştirir");
  assert.equal(r90.rotate, 90);
  assert.ok(at(r90, 0.87, 0.08) < 60, `90°: koyu kare sağ üstte (${at(r90, 0.87, 0.08).toFixed(0)})`);
  assert.ok(at(r90, 0.13, 0.08) > 200, "90°: sol üst kâğıt");
  assert.deepEqual(r90.corners, corners, "köşeler görüntüye göre kalır");
  const r180 = scanDocument(img, { corners, mode: "orijinal", deskew: false, rotate: 180 });
  assert.ok(at(r180, 0.92, 0.87) < 60, "180°: koyu kare sağ altta");
  const r270 = scanDocument(img, { corners, mode: "orijinal", deskew: false, rotate: 270 });
  assert.ok(at(r270, 0.13, 0.92) < 60, "270°: koyu kare sol altta");
  // kareyi dolduran (kırpılmayan) görüntüde de
  const full = scanDocument(img, { corners: fullFrame(400, 300), mode: "orijinal", deskew: false, rotate: 90 });
  assert.deepEqual([full.image.width, full.image.height], [300, 400]);
  assert.deepEqual(Array.from(full.image.data.slice(0, 4)), Array.from(img.data.slice((299 * 400) * 4, (299 * 400) * 4 + 4)), "sol alt piksel sol üste");
  // yapay zekânın "top" ipucu: üst kenar sağdaysa sola (270°) çevrilir
  assert.deepEqual((["up", "right", "down", "left", null] as const).map((t) => rotationForTop(t)), [0, 270, 180, 90, 0]);
});

test("tarama: mod, çıktı ölçüsü ve geçersiz köşe", () => {
  const img = renderScene({
    width: 600,
    height: 800,
    corners: [
      { x: 100, y: 120 },
      { x: 480, y: 110 },
      { x: 500, y: 700 },
      { x: 90, y: 690 },
    ],
    background: "koyu",
    text: { rows: 25 },
    noise: 2,
    seed: 43,
  });
  const r = scanDocument(img, {
    corners: [
      { x: 100, y: 120 },
      { x: 480, y: 110 },
      { x: 500, y: 700 },
      { x: 90, y: 690 },
    ],
    maxEdge: 300,
    deskew: false,
  });
  assert.equal(r.method, "verilen");
  assert.equal(r.confidence, 1);
  assert.equal(Math.max(r.image.width, r.image.height), 300, "uzun kenar maxEdge");
  assert.ok(regionMean(r.image, 0, 0, r.image.width, 6) > 235, "kırpılmış sayfanın kenarında zemin kalmaz");
  const bad = scanDocument(img, {
    corners: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    maxEdge: 300,
  });
  assert.ok(bad.reasons.includes("verilen-kose-gecersiz"), "geçersiz köşe söylenir, algılamaya dönülür");
  assert.notEqual(bad.method, "verilen");
});
