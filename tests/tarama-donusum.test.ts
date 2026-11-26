// Belge tarayıcı: perspektif düzeltme. Homografi gidiş-dönüş, ters eşlemeli açma (bilinen desen), çıktı boyutu ve
// perspektiften gerçek en/boy oranı, küçültürken örtüşme olmaması, 90° çevirme, eğiklik düzeltmesinin dönüş /
// yamultma eşlemesi. src/lib/scan/warp.ts; docs/FOTOGRAF.md › Belge tarama (çekirdek).
// Çalıştırma: npx tsx --test tests/tarama-donusum.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { createRgba, type Point, type Quad, type RgbaImage } from "../src/lib/scan/image";
import {
  aspectFromPerspective,
  applyHomography,
  estimateSize,
  homography,
  invert3,
  rotateQuarter,
  rotationAbout,
  solveLinear,
  verticalShear,
  warpQuad,
} from "../src/lib/scan/warp";
import { projectRect } from "./helpers/tarama-sentetik";

test("doğrusal sistem çözümü (kısmi pivot) ve tekil sistem hatası", () => {
  const x = solveLinear(
    [
      [0, 2, 1],
      [1, 1, 1],
      [2, 1, 3],
    ],
    [7, 6, 13],
  );
  assert.deepEqual(
    x.map((v) => Math.round(v * 1e9) / 1e9),
    [1, 2, 3],
  );
  assert.throws(
    () =>
      solveLinear(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    /Tekil/,
  );
});

test("homografi dört noktayı tam eşler; tersi geri götürür", () => {
  const src: Point[] = [
    { x: 123.4, y: 88.1 },
    { x: 1502.7, y: 140.9 },
    { x: 1611.2, y: 2050.5 },
    { x: 40.3, y: 1890 },
  ];
  const dst: Point[] = [
    { x: 0, y: 0 },
    { x: 999, y: 0 },
    { x: 999, y: 1413 },
    { x: 0, y: 1413 },
  ];
  const H = homography(src, dst);
  for (let i = 0; i < 4; i++) {
    const p = applyHomography(H, src[i]);
    assert.ok(Math.hypot(p.x - dst[i].x, p.y - dst[i].y) < 1e-6, `köşe ${i} eşlenmeli: ${JSON.stringify(p)}`);
  }
  const Hi = invert3(H);
  for (const p of [
    { x: 500, y: 700 },
    { x: 12, y: 1300 },
    { x: 990, y: 3 },
  ]) {
    const back = applyHomography(Hi, applyHomography(H, applyHomography(Hi, p)));
    const once = applyHomography(Hi, p);
    assert.ok(Math.hypot(back.x - once.x, back.y - once.y) < 1e-6, "gidiş-dönüş aynı noktaya");
  }
  // perspektifte doğrular doğru kalır: kaynak kenarın ortası hedef kenarın üzerinde
  const mid = { x: (src[0].x + src[1].x) / 2, y: (src[0].y + src[1].y) / 2 };
  assert.ok(Math.abs(applyHomography(H, mid).y) < 1e-6, "kenar üzerindeki nokta kenarda kalmalı");
});

/** Dama deseni: hücre 10 px; (x, y) → siyah ya da beyaz */
function checker(x: number, y: number): number {
  return (Math.floor(x / 10) + Math.floor(y / 10)) % 2 ? 230 : 20;
}

test("dörtgen açma: perspektifle çizilmiş dama tahtası geri açılınca hücreler yerinde", () => {
  // 200×100 düz desen, perspektifli dörtgene çizilir (ters eşleme), sonra warpQuad ile açılır
  const W = 400;
  const H = 300;
  const quad: Quad = [
    { x: 60.3, y: 40.2 },
    { x: 350.8, y: 70.5 },
    { x: 330.1, y: 250.7 },
    { x: 40.6, y: 220.4 },
  ];
  const rect: Point[] = [
    { x: -0.5, y: -0.5 },
    { x: 199.5, y: -0.5 },
    { x: 199.5, y: 99.5 },
    { x: -0.5, y: 99.5 },
  ];
  const toRect = homography(quad, rect);
  const img: RgbaImage = createRgba(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = applyHomography(toRect, { x, y });
      const v = p.x >= -0.5 && p.y >= -0.5 && p.x <= 199.5 && p.y <= 99.5 ? checker(p.x + 0.5, p.y + 0.5) : 128;
      img.data.set([v, v, v, 255], (y * W + x) * 4);
    }
  }
  const out = warpQuad(img, quad, 200, 100);
  let wrong = 0;
  let checked = 0;
  for (let y = 2; y < 98; y++) {
    for (let x = 2; x < 198; x++) {
      // hücre sınırına 2 px'ten yakın pikseller (yumuşak geçiş) sayılmaz
      if (x % 10 < 2 || x % 10 > 7 || y % 10 < 2 || y % 10 > 7) continue;
      checked++;
      const v = out.data[(y * 200 + x) * 4];
      if (Math.abs(v - checker(x + 0.5, y + 0.5)) > 40) wrong++;
    }
  }
  assert.ok(checked > 5000, "yeterli piksel denetlenmeli");
  assert.equal(wrong, 0, `yanlış hücre pikseli: ${wrong}/${checked}`);
});

test("çıktı boyutu: perspektiften gerçek en/boy (A4, 35° eğik çekim)", () => {
  const W = 1600;
  const H = 2100;
  for (const [aspect, tiltX, tiltY, rot, size] of [
    [1 / Math.SQRT2, 35, 5, 6, 0.55],
    [1 / Math.SQRT2, 20, -15, -10, 0.55],
    [1 / 5, 30, 0, 3, 0.15],
  ]) {
    const q = projectRect({ width: W, height: H, aspect, size, rotDeg: rot, tiltX, tiltY });
    const sz = estimateSize(q, W, H, 4000);
    const err = Math.abs(sz.width / sz.height - aspect) / aspect;
    assert.equal(sz.aspectSource, "perspektif", `perspektif kestirimi kullanılmalı (${aspect.toFixed(2)}, ${tiltX}°)`);
    assert.ok(err < 0.03, `en/boy hatası %3'ün altında: ${(err * 100).toFixed(1)}% (${aspect.toFixed(2)}, ${tiltX}°)`);
    // kenar oranı perspektifte belirgin yanılır (ölçümün anlamı)
    const p = aspectFromPerspective(q, W, H);
    assert.ok(p && Math.abs(p.focal - 0.8 * Math.max(W, H)) / (0.8 * Math.max(W, H)) < 0.05, `odak uzaklığı kestirilmeli: ${p?.focal}`);
  }
  // perspektifsiz (afin) dörtgende kenar oranı
  const flat: Quad = [
    { x: 100, y: 100 },
    { x: 600, y: 100 },
    { x: 600, y: 800 },
    { x: 100, y: 800 },
  ];
  const s2 = estimateSize(flat, 1000, 1000, 2000);
  assert.equal(s2.aspectSource, "kenar");
  assert.deepEqual([s2.width, s2.height], [500, 700]);
  // uzun kenar maxEdge'e sığar, büyütülmez
  const s3 = estimateSize(flat, 1000, 1000, 350);
  assert.equal(Math.max(s3.width, s3.height), 350);
});

test("küçültürken örtüşme yok: ince çizgili desen düzgün griye ortalanır", () => {
  const W = 1200;
  const H = 1200;
  const img = createRgba(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = x % 2 ? 255 : 0;
      img.data.set([v, v, v, 255], (y * W + x) * 4);
    }
  }
  const q: Quad = [
    { x: 0, y: 0 },
    { x: W - 1, y: 0 },
    { x: W - 1, y: H - 1 },
    { x: 0, y: H - 1 },
  ];
  const out = warpQuad(img, q, 157, 157);
  let min = 255;
  let max = 0;
  for (let i = 0; i < 157 * 157; i++) {
    min = Math.min(min, out.data[i * 4]);
    max = Math.max(max, out.data[i * 4]);
  }
  assert.ok(max - min < 30, `örtüşme olmamalı (gri düzgün): ${min}–${max}`);
});

test("90° çevirme ve eğiklik düzeltmesi eşlemeleri", () => {
  const img = createRgba(3, 2);
  for (let i = 0; i < 6; i++) img.data.set([i * 10, 0, 0, 255], i * 4);
  const r = rotateQuarter(img, 1);
  assert.deepEqual([r.width, r.height], [2, 3]);
  // saat yönünde 90°: sol alt (3) sol üste gelir
  assert.deepEqual(
    Array.from({ length: 6 }, (_, i) => r.data[i * 4]),
    [30, 0, 40, 10, 50, 20],
  );
  assert.deepEqual(Array.from(rotateQuarter(rotateQuarter(img, 2), 2).data), Array.from(img.data), "iki kez 180° = kendisi");
  // dönüş: merkez yerinde kalır; içerik saat yönünde döner (çıktının sağı kaynağın aşağısından gelir)
  const A = rotationAbout(10, 50, 50);
  const c = { x: A[0] * 50 + A[1] * 50 + A[2], y: A[3] * 50 + A[4] * 50 + A[5] };
  assert.ok(Math.hypot(c.x - 50, c.y - 50) < 1e-9, "merkez sabit");
  const right = { x: A[0] * 100 + A[1] * 50 + A[2], y: A[3] * 100 + A[4] * 50 + A[5] };
  assert.ok(right.y < 50, "saat yönünde dönüşte çıktının sağı kaynağın yukarısından örneklenir");
  // yamultma: x yerinde, merkez sütunu kaymaz
  const S = verticalShear(2, 100);
  assert.equal(S[0] * 37 + S[1] * 80 + S[2], 37, "yamultmada x değişmez");
  assert.ok(Math.abs(S[3] * 100 + S[4] * 80 + S[5] - 80) < 1e-9, "merkez sütunu kaymaz");
});
