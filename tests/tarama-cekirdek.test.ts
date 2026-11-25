// Belge tarayıcı çekirdeği: görüntü işlemleri (küçültme, bulanıklık, kutu filtresi, Sobel, en büyük / en küçük süzgeç,
// ikili morfoloji, bağlı bileşenler, dış hat, Otsu) ve geometri (köşe sıralama, zarf, zarftan dörtgen, RANSAC, ipucu
// köşeleri). src/lib/scan/image.ts, geom.ts, index.ts; docs/FOTOGRAF.md › Belge tarama (çekirdek).
// Çalıştırma: npx tsx --test tests/tarama-cekirdek.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  boxMean,
  closeMask,
  createGray,
  createRgba,
  gaussianBlur,
  histogram,
  labelComponents,
  maxFilter,
  minFilter,
  openMask,
  otsuIndex,
  resizeGray,
  resizeRgba,
  seededRandom,
  sobel,
  toGray,
  traceContour,
  type Point,
} from "../src/lib/scan/image";
import { convexHull, hullToQuad, interiorAngles, isConvex, minAreaRect, polygonArea, ransacLine, signedDist } from "../src/lib/scan/geom";
import { cornersFromHint, cornersToHint, fullFrame, orderCorners, quadIsValid } from "../src/lib/scan";

function randomGray(w: number, h: number, seed: number) {
  const g = createGray(w, h);
  const rnd = seededRandom(seed);
  for (let i = 0; i < g.data.length; i++) g.data[i] = rnd() * 255;
  return g;
}

test("alan ortalamalı küçültme ortalamayı korur, büyütme kenarı kaydırmaz", () => {
  const g = randomGray(97, 61, 1);
  const s = resizeGray(g, 31, 20);
  const mean = (a: Float32Array) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(Math.abs(mean(g.data) - mean(s.data)) < 0.5, `ortalama korunmalı: ${mean(g.data)} → ${mean(s.data)}`);
  // tam katlı küçültmede her çıktı pikseli 2×2 bloğun ortalamasıdır
  const sq = createGray(4, 4);
  sq.data.set([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150]);
  const half = resizeGray(sq, 2, 2);
  assert.deepEqual(Array.from(half.data), [25, 45, 105, 125]);
  const img = createRgba(6, 4);
  for (let i = 0; i < 24; i++) img.data.set([200, 100, 50, 255], i * 4);
  const r = resizeRgba(img, 3, 2);
  assert.deepEqual(Array.from(r.data.slice(0, 4)), [200, 100, 50, 255], "düz renk küçültmede değişmemeli");
});

test("Gauss bulanıklığı toplamı korur, kutu ortalaması kaba kuvvetle aynı", () => {
  const g = randomGray(40, 30, 2);
  const b = gaussianBlur(g, 1.5);
  const sum = (a: Float32Array) => a.reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(sum(g.data) - sum(b.data)) / sum(g.data) < 0.01, "bulanıklık toplamı ~korumalı");
  const m = boxMean(g, 2);
  for (const [x, y] of [
    [0, 0],
    [10, 10],
    [39, 29],
    [20, 1],
  ]) {
    let s = 0;
    let c = 0;
    for (let yy = Math.max(0, y - 2); yy <= Math.min(29, y + 2); yy++) {
      for (let xx = Math.max(0, x - 2); xx <= Math.min(39, x + 2); xx++) {
        s += g.data[yy * 40 + xx];
        c++;
      }
    }
    assert.ok(Math.abs(m.data[y * 40 + x] - s / c) < 1e-3, `kutu ortalaması (${x},${y})`);
  }
});

test("en büyük / en küçük süzgeç kaba kuvvetle aynı (kenarlar dahil)", () => {
  const g = randomGray(23, 17, 3);
  for (const r of [1, 2, 4]) {
    const mx = maxFilter(g, r);
    const mn = minFilter(g, r);
    for (let y = 0; y < 17; y++) {
      for (let x = 0; x < 23; x++) {
        let a = -Infinity;
        let b = Infinity;
        for (let yy = Math.max(0, y - r); yy <= Math.min(16, y + r); yy++) {
          for (let xx = Math.max(0, x - r); xx <= Math.min(22, x + r); xx++) {
            a = Math.max(a, g.data[yy * 23 + xx]);
            b = Math.min(b, g.data[yy * 23 + xx]);
          }
        }
        assert.equal(mx.data[y * 23 + x], Math.fround(a), `en büyük r=${r} (${x},${y})`);
        assert.equal(mn.data[y * 23 + x], Math.fround(b), `en küçük r=${r} (${x},${y})`);
      }
    }
  }
});

test("Sobel basamağın yönünü ve büyüklüğünü verir", () => {
  const g = createGray(20, 10);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 20; x++) g.data[y * 20 + x] = x < 10 ? 50 : 150;
  const { gx, gy } = sobel(g);
  assert.ok(gx[5 * 20 + 10] > 40, `basamakta gx büyük: ${gx[5 * 20 + 10]}`);
  assert.equal(gy[5 * 20 + 10], 0);
  assert.equal(gx[5 * 20 + 3], 0);
});

test("Otsu iki tepeli dağılımı ortadan böler", () => {
  const vals: number[] = [];
  const rnd = seededRandom(4);
  for (let i = 0; i < 2000; i++) vals.push(60 + rnd() * 20, 190 + rnd() * 20);
  const t = otsuIndex(histogram(vals));
  assert.ok(t >= 79 && t < 190, `eşik iki tepe arasında olmalı: ${t}`);
});

test("ikili kapama deliği kapatır, açma ince köprüyü keser; bileşenler ve dış hat", () => {
  const w = 40;
  const h = 30;
  const m = new Uint8Array(w * h);
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m[y * w + x] = 1;
  };
  rect(2, 2, 15, 20);
  rect(25, 5, 35, 25);
  rect(16, 10, 24, 10); // ince köprü
  m[8 * w + 8] = 0; // delik
  const closed = closeMask(m, w, h, 1);
  assert.equal(closed[8 * w + 8], 1, "kapama deliği kapatmalı");
  const opened = openMask(m, w, h, 1);
  const cc = labelComponents(opened, w, h);
  assert.equal(cc.count, 2, "açma köprüyü kesmeli: iki bileşen");
  const big = cc.areas[1] > cc.areas[2] ? 1 : 2;
  assert.equal(cc.maxX[big] - cc.minX[big] + 1, 14);
  // dış hat: dikdörtgenin çevresi kadar sınır pikseli
  const ccm = labelComponents(m, w, h);
  const l = ccm.labels[2 * w + 2];
  const contour = traceContour(ccm.labels, w, h, l, 2, 2);
  const xs = contour.map((p) => p.x);
  const ys = contour.map((p) => p.y);
  assert.equal(Math.min(...xs), 2);
  assert.equal(Math.max(...xs), 35, "köprüyle bağlı iki dikdörtgenin dış hattı");
  assert.equal(Math.min(...ys), 2);
  assert.equal(Math.max(...ys), 25);
  assert.ok(contour.every((p) => m[p.y * w + p.x] === 1), "dış hat noktaları bileşenin pikselleri");
});

test("toGray parlaklık ağırlıklarını kullanır", () => {
  const img = createRgba(1, 1);
  img.data.set([255, 0, 0, 255]);
  assert.ok(Math.abs(toGray(img).data[0] - 76.245) < 0.01);
});

test("köşe sıralama: 45° dönük kâğıtta da her köşe bir kez, sol üstten saat yönünde", () => {
  const q = orderCorners([
    { x: 50, y: 0 },
    { x: 0, y: 50 },
    { x: 100, y: 50 },
    { x: 50, y: 100 },
  ]);
  assert.equal(new Set(q.map((p) => `${p.x},${p.y}`)).size, 4, "dört farklı köşe");
  const o = orderCorners([
    { x: 90, y: 95 },
    { x: 10, y: 5 },
    { x: 12, y: 90 },
    { x: 95, y: 8 },
  ]);
  assert.deepEqual(o, [
    { x: 10, y: 5 },
    { x: 95, y: 8 },
    { x: 90, y: 95 },
    { x: 12, y: 90 },
  ]);
  assert.ok(isConvex(o), "sıralı dörtgen dışbükey");
  assert.ok(interiorAngles(o).every((a) => a > 80 && a < 100), "açılar dik açıya yakın");
});

test("zarftan dörtgen: kesik ve yuvarlak köşeler gerçek köşeye uzar", () => {
  const pts: Point[] = [];
  // 100×60 dikdörtgen, köşeleri 8 px kesik, kenarlarda gürültü
  const rnd = seededRandom(5);
  for (let x = 8; x <= 92; x += 2) pts.push({ x, y: 0 + rnd() * 0.4 }, { x, y: 60 - rnd() * 0.4 });
  for (let y = 8; y <= 52; y += 2) pts.push({ x: 0 + rnd() * 0.4, y }, { x: 100 - rnd() * 0.4, y });
  for (let k = 0; k <= 8; k++) {
    const a = (k / 8) * (Math.PI / 2);
    pts.push({ x: 8 - 8 * Math.cos(a), y: 8 - 8 * Math.sin(a) }, { x: 92 + 8 * Math.cos(a), y: 52 + 8 * Math.sin(a) });
    pts.push({ x: 92 + 8 * Math.sin(a), y: 8 - 8 * Math.cos(a) }, { x: 8 - 8 * Math.sin(a), y: 52 + 8 * Math.cos(a) });
  }
  const q = hullToQuad(convexHull(pts));
  assert.ok(q, "dörtgen bulunmalı");
  const want = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 60 },
    { x: 0, y: 60 },
  ];
  for (let i = 0; i < 4; i++) assert.ok(Math.hypot(q![i].x - want[i].x, q![i].y - want[i].y) < 2.5, `köşe ${i}: ${JSON.stringify(q![i])}`);
  const r = minAreaRect(convexHull(pts));
  assert.ok(r && Math.abs(polygonArea(r) - 6000) < 150, "en küçük dikdörtgen ~100×60");
});

test("RANSAC aykırı noktalara rağmen doğruyu bulur", () => {
  const rnd = seededRandom(6);
  const pts: Point[] = [];
  for (let i = 0; i < 40; i++) pts.push({ x: i * 5, y: 0.25 * i * 5 + 10 + (rnd() - 0.5) * 0.6 });
  for (let i = 0; i < 20; i++) pts.push({ x: rnd() * 200, y: rnd() * 200 });
  const r = ransacLine(pts, 1.5, seededRandom(7), 20);
  assert.ok(r, "doğru bulunmalı");
  assert.ok(Math.abs(r!.line.d.y / r!.line.d.x - 0.25) < 0.01, `eğim 0,25: ${r!.line.d.y / r!.line.d.x}`);
  assert.ok(Math.abs(signedDist(r!.line, { x: 0, y: 10 })) < 0.5, "doğru (0,10)'dan geçmeli");
  assert.ok(r!.inliers >= 38, `oturan nokta: ${r!.inliers}`);
});

test("dörtgen denetimi, ipucu köşeleri (0–1000) ve tam kare", () => {
  assert.ok(quadIsValid(fullFrame(800, 600), 800, 600), "tam kare geçerli");
  assert.ok(!quadIsValid(null, 800, 600), "boş geçersiz");
  assert.ok(
    !quadIsValid(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      800,
      600,
    ),
    "çok küçük dörtgen geçersiz",
  );
  assert.ok(
    !quadIsValid(
      [
        { x: 0, y: 0 },
        { x: 700, y: 500 },
        { x: 700, y: 0 },
        { x: 0, y: 500 },
      ].slice(0, 3),
      800,
      600,
    ),
    "üç köşe geçersiz",
  );
  assert.ok(
    !quadIsValid(
      [
        { x: 0, y: 0 },
        { x: 2000, y: 0 },
        { x: 2000, y: 500 },
        { x: 0, y: 500 },
      ],
      800,
      600,
    ),
    "kareden çok taşan geçersiz",
  );
  const q = cornersFromHint(
    [
      [900, 950],
      [100, 50],
      [920, 60],
      [80, 940],
    ],
    1001,
    2001,
  );
  assert.ok(q, "ipucu çevrilmeli");
  assert.deepEqual(q, [
    { x: 100, y: 100 },
    { x: 920, y: 120 },
    { x: 900, y: 1900 },
    { x: 80, y: 1880 },
  ]);
  assert.deepEqual(cornersToHint(q!, 1001, 2001), [
    [100, 50],
    [920, 60],
    [900, 950],
    [80, 940],
  ]);
  assert.equal(cornersFromHint([[1, 2]], 100, 100), null, "dört nokta değilse null");
  assert.equal(cornersFromHint([[1, 2], [3, Number.NaN], [5, 6], [7, 8]], 100, 100), null, "sayı değilse null");
  const clamped = cornersFromHint(
    [
      [-50, -50],
      [1200, 0],
      [1000, 1000],
      [0, 1000],
    ],
    101,
    101,
  );
  assert.ok(clamped!.every((p) => p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100), "aralık dışı ipucu kenetlenir");
});
