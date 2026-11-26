// Belge tarayıcı: kâğıt algılama ve köşe oturtma, sentetik fotoğraflarla (gerçek köşeler bilinir). Eğik A4, açık
// tezgâhta dar uzun termal fiş (düşük karşıtlık, kıvrık kenar), gölgeli gri zeminde fiş, kareden taşan fiş, kareyi
// dolduran kâğıt, belgesiz doku; kaba ipucu köşelerinin (köşegenin ±%5'i) kenarlara oturması. Köşe hatası köşegenin
// %1,5'inden az olmalı. src/lib/scan/detect.ts, refine.ts; docs/FOTOGRAF.md › Belge tarama (çekirdek).
// Çalıştırma: npx tsx --test tests/tarama-algilama.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Quad } from "../src/lib/scan/image";
import { seededRandom } from "../src/lib/scan/image";
import { lineThrough, signedDist } from "../src/lib/scan/geom";
import { detectDocument, refineCorners, scanDocument } from "../src/lib/scan";
import { cornerError, projectRect, regionMean, renderScene, type Sahne } from "./helpers/tarama-sentetik";

const W = 720;
const H = 960;
const DIAG = Math.hypot(W, H);

const A4 = 1 / Math.SQRT2;

const scenes = {
  a4Egik: {
    width: W,
    height: H,
    corners: projectRect({ width: W, height: H, aspect: A4, size: 0.62, rotDeg: 9, tiltX: 25, tiltY: 8 }),
    paperAspect: A4,
    background: "tahta",
    text: { rows: 30 },
    noise: 3,
    blur: 0.8,
    seed: 2,
  },
  a4Koyu: {
    width: W,
    height: H,
    corners: projectRect({ width: W, height: H, aspect: A4, size: 0.7, rotDeg: -14, tiltX: 12 }),
    paperAspect: A4,
    background: "koyu",
    text: { rows: 25 },
    noise: 2,
    seed: 9,
  },
  fisAcikTezgah: {
    width: W,
    height: H,
    corners: projectRect({ width: W, height: H, aspect: 1 / 6, size: 0.17, rotDeg: -4, tiltX: 15 }),
    paperAspect: 1 / 6,
    background: "acik",
    text: { rows: 60, strength: 0.8 },
    noise: 2.5,
    blur: 0.7,
    curl: 3,
    seed: 3,
  },
  fisUzun: {
    width: W,
    height: H,
    corners: projectRect({ width: W, height: H, aspect: 1 / 9, size: 0.1, rotDeg: 3, tiltX: 10 }),
    paperAspect: 1 / 9,
    background: "acik",
    bgColor: [214, 210, 202],
    paper: [244, 244, 242],
    text: { rows: 90, strength: 0.7 },
    noise: 2,
    blur: 0.7,
    seed: 13,
  },
  fisGolge: {
    width: W,
    height: H,
    corners: projectRect({ width: W, height: H, aspect: 1 / 4, size: 0.25, rotDeg: 6, tiltX: 20 }),
    paperAspect: 1 / 4,
    background: "gri",
    text: { rows: 45, strength: 0.7 },
    shadow: 0.45,
    noise: 3,
    blur: 0.8,
    seed: 4,
  },
  // beyaza yakın tezgâhta termal fiş: kâğıtla zemin arası ~22 gri düzeyi
  fisBeyazTezgah: {
    width: W,
    height: H,
    corners: projectRect({ width: W, height: H, aspect: 1 / 5, size: 0.18, rotDeg: 5, tiltX: 18 }),
    paperAspect: 1 / 5,
    background: "beyaz",
    bgColor: [220, 219, 214],
    paper: [244, 244, 242],
    text: { rows: 50, strength: 0.75 },
    noise: 2.5,
    blur: 0.8,
    seed: 302,
  },
} satisfies Record<string, Sahne>;

for (const [name, s] of Object.entries(scenes)) {
  test(`algılama: ${name} — köşe hatası köşegenin %1,5'inden az, güven yüksek`, () => {
    const img = renderScene(s);
    const d = detectDocument(img);
    assert.ok(d.corners, `köşeler bulunmalı (${d.reasons.join(",")})`);
    assert.equal(d.fillsFrame, false, "kâğıt kareyi doldurmuyor");
    const err = cornerError(d.corners!, s.corners, W, H);
    assert.ok(err < 0.015, `köşe hatası %${(err * 100).toFixed(2)} (${d.method})`);
    assert.ok(d.confidence >= 0.6, `güven ${d.confidence} (${d.reasons.join(",")})`);
  });
}

test("algılama: kâğıt kareyi dolduruyor → fillsFrame, köşeler görüntünün köşeleri", () => {
  for (const [corners, seed] of [
    [
      [
        { x: -20, y: -15 },
        { x: W + 18, y: -20 },
        { x: W + 25, y: H + 20 },
        { x: -18, y: H + 16 },
      ],
      5,
    ],
    [
      [
        { x: 6, y: 8 },
        { x: W - 9, y: 5 },
        { x: W - 4, y: H - 7 },
        { x: 3, y: H - 6 },
      ],
      15,
    ],
  ] as [Quad, number][]) {
    const img = renderScene({ width: W, height: H, corners, background: "koyu", text: { rows: 35 }, noise: 3, seed });
    const d = detectDocument(img);
    assert.equal(d.fillsFrame, true, `kareyi dolduran kâğıt (${d.method}, ${d.reasons.join(",")})`);
    assert.deepEqual(d.corners, [
      { x: 0, y: 0 },
      { x: W - 1, y: 0 },
      { x: W - 1, y: H - 1 },
      { x: 0, y: H - 1 },
    ]);
    const r = scanDocument(img, { maxEdge: 600 });
    assert.equal(r.fillsFrame, true, "taramada kırpılmaz");
    assert.equal(Math.max(r.image.width, r.image.height), 600, "bütün kare taranır");
  }
});

test("algılama: belge yok (doku, tahta) → köşe yok ya da güven düşük", () => {
  for (const bg of ["doku", "tahta", "degrade"] as const) {
    const img = renderScene({ width: W, height: H, corners: null, background: bg, noise: 4, seed: 6 });
    const d = detectDocument(img);
    assert.ok(!d.corners || d.confidence < 0.4, `${bg}: ${d.method} güven ${d.confidence}`);
    assert.equal(d.fillsFrame, false, `${bg}: kâğıt sanılmamalı`);
  }
});

test("algılama: kareden taşan uzun fiş — uzun kenarlar oturur, kısa kenarlar görüntüde ve uzun kenarlara uygun", () => {
  const truth: Quad = [
    { x: 300, y: -30 },
    { x: 430, y: -24 },
    { x: 446, y: H + 30 },
    { x: 312, y: H + 24 },
  ];
  const img = renderScene({ width: W, height: H, corners: truth, background: "koyu", text: { rows: 70 }, noise: 3, seed: 8 });
  const d = detectDocument(img);
  assert.ok(d.corners, "fiş bulunmalı");
  assert.equal(d.fillsFrame, false);
  assert.ok(d.reasons.some((r) => r.startsWith("kareye-dayaniyor")), `kareye dayandığı söylenmeli: ${d.reasons}`);
  const q = d.corners!;
  const left = lineThrough(truth[3], truth[0]);
  const right = lineThrough(truth[1], truth[2]);
  for (const p of [q[0], q[3]]) assert.ok(Math.abs(signedDist(left, p)) < DIAG * 0.006, `sol köşe sol kenarda: ${JSON.stringify(p)}`);
  for (const p of [q[1], q[2]]) assert.ok(Math.abs(signedDist(right, p)) < DIAG * 0.006, `sağ köşe sağ kenarda: ${JSON.stringify(p)}`);
  for (const p of q) assert.ok(p.x >= 0 && p.y >= 0 && p.x <= W - 1 && p.y <= H - 1, "köşeler görüntüde");
  // kısa kenarlar uzun kenarlara aşağı yukarı dik (görüntünün kenarı boyunca değil)
  const top = Math.atan2(q[1].y - q[0].y, q[1].x - q[0].x);
  const longDir = Math.atan2(truth[3].y - truth[0].y, truth[3].x - truth[0].x);
  const diff = Math.abs(((top - longDir) * 180) / Math.PI);
  assert.ok(Math.abs(diff - 90) < 1.5, `üst kenar uzun kenara dik olmalı: ${diff.toFixed(2)}°`);
});

test("algılama: kâğıdın iki köşesi kareden çıkmış — köşeler kenarların kesişimi, taramada dışarısı kâğıt rengi", () => {
  const truth: Quad = [
    { x: 147, y: -27 },
    { x: 746, y: 155 },
    { x: 496, y: 804 },
    { x: 43, y: 745 },
  ].map((p) => ({ x: (p.x * W) / 720, y: (p.y * H) / 960 })) as Quad;
  // sağ üst köşe sağ kenarın dışında, sol üst köşe üst kenarın dışında
  assert.ok(truth[1].x > W && truth[0].y < 0, "köşeler gerçekten kare dışında");
  const img = renderScene({ width: W, height: H, corners: truth, paperAspect: A4, background: "gri", text: { rows: 30 }, noise: 3, blur: 0.8, seed: 125 });
  const d = detectDocument(img);
  assert.ok(d.corners && !d.fillsFrame, `kâğıt bulunmalı (${d.reasons.join(",")})`);
  const err = cornerError(d.corners!, truth, W, H);
  assert.ok(err < 0.015, `köşe hatası %${(err * 100).toFixed(2)}: ${JSON.stringify(d.corners)}`);
  assert.ok(d.reasons.includes("kose-kare-disinda"), `kare dışı köşe söylenmeli: ${d.reasons}`);
  const r = scanDocument(img, { deskew: false, mode: "orijinal", maxEdge: 800 });
  // açılan sayfanın sağ üst köşesi fotoğrafta yok: kenar pikseli uzatılmaz, kâğıt rengiyle dolar
  assert.ok(regionMean(r.image, r.image.width - 12, 0, r.image.width, 12) > 225, "kare dışı köşe kâğıt rengi");
});

test("köşe oturtma: kaba ipucu köşeleri (köşegenin ±%5'i) gerçek kenarlara oturur", () => {
  let worst = 0;
  for (const name of ["a4Egik", "fisGolge", "a4Koyu"] as const) {
    const s = scenes[name];
    const img = renderScene(s);
    const rnd = seededRandom(31);
    for (let k = 0; k < 5; k++) {
      const hint = s.corners.map((p) => {
        const a = rnd() * Math.PI * 2;
        const r = DIAG * 0.05 * (0.6 + 0.4 * rnd());
        return { x: Math.max(0, Math.min(W - 1, p.x + Math.cos(a) * r)), y: Math.max(0, Math.min(H - 1, p.y + Math.sin(a) * r)) };
      }) as Quad;
      const before = cornerError(hint, s.corners, W, H);
      const r = refineCorners(img, hint);
      const err = cornerError(r.corners, s.corners, W, H);
      worst = Math.max(worst, err);
      assert.ok(before > 0.025, "ipucu gerçekten kaba olmalı");
      assert.ok(err < 0.015, `${name} #${k}: %${(before * 100).toFixed(1)} → %${(err * 100).toFixed(2)} (oturan kenar ${r.snapped})`);
    }
  }
  assert.ok(worst < 0.015, `en kötü köşe hatası %${(worst * 100).toFixed(2)}`);
});

test("köşe oturtma: karenin kenarına dayanan kenar oturtulmaz, zayıf destekte köşe değişmez", () => {
  const s = scenes.a4Koyu;
  const img = renderScene(s);
  // kenarı karenin kenarında olan dörtgen: o kenar oturtulmaz
  const q: Quad = [
    { x: 0, y: 0 },
    { x: W - 1, y: 0 },
    { x: W - 1, y: 500 },
    { x: 0, y: 500 },
  ];
  const r = refineCorners(img, q);
  assert.equal(r.sides[0], false, "üst kenar karede: oturtulmaz");
  // düz zeminde (kâğıt yok) köşeler yerinde kalır
  const flat = renderScene({ width: W, height: H, corners: null, background: "gri", noise: 2, seed: 3 });
  const box: Quad = [
    { x: 200, y: 200 },
    { x: 500, y: 210 },
    { x: 490, y: 700 },
    { x: 210, y: 690 },
  ];
  const r2 = refineCorners(flat, box);
  assert.equal(r2.snapped, 0, "destek yok: kenar oturmaz");
  assert.ok(cornerError(r2.corners, box, W, H) < 0.002, "köşeler değişmemeli");
});

test("tarama: verilen köşelerle ve algılamayla aynı dörtgen; süre ölçülür (gevşek sınır)", (t) => {
  const PW = 1670;
  const PH = 2220;
  const truth = projectRect({ width: PW, height: PH, aspect: A4, size: 0.72, rotDeg: 5, tiltX: 18, tiltY: 5 });
  const img = renderScene({ width: PW, height: PH, corners: truth, paperAspect: A4, background: "tahta", text: { rows: 40 }, noise: 3, blur: 1, seed: 21 });
  const t0 = performance.now();
  const d = detectDocument(img);
  const td = performance.now() - t0;
  assert.ok(d.corners && cornerError(d.corners, truth, PW, PH) < 0.015, "telefon çözünürlüğünde de köşe hatası %1,5'in altında");
  const r = scanDocument(img);
  t.diagnostic(`algılama ${td.toFixed(0)} ms; tarama: algılama ${r.timings.detect.toFixed(0)} + açma ${r.timings.warp.toFixed(0)} + görünüm ${r.timings.enhance.toFixed(0)} = ${r.timings.total.toFixed(0)} ms (${r.image.width}×${r.image.height})`);
  assert.equal(r.method, d.method);
  assert.ok(Math.abs(r.image.width / r.image.height - A4) < 0.02, `en/boy A4: ${(r.image.width / r.image.height).toFixed(3)}`);
  // gevşek sınır: yük altındaki test makinesinde de geçsin (telefonda hedef < 1,5 sn)
  assert.ok(r.timings.total < 6000, `tarama çok yavaş: ${r.timings.total.toFixed(0)} ms`);
});
