// Belge tarayıcı: sayfa yönü (0 / 90 / 180 / 270°), gerçek yazılı sentetik belgelerle (Inter yazı tipiyle market fişi,
// uzun Z raporu, büyük-küçük harfli A4). Düz taramada ve fotoğrafta (perspektif, eğiklik, bulanıklık, gölge, küçük
// yazı) her dönüş doğru bulunmalı; yazı yoksa, simetrikse ya da çok azsa "bilinmiyor". src/lib/scan/orientation.ts;
// docs/FOTOGRAF.md › Belge tarama (kalite, yön, birleştirme).
// Çalıştırma: npx tsx --test tests/tarama-yon.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { toGray, type Quad } from "../src/lib/scan/image";
import { orderCorners } from "../src/lib/scan/geom";
import { rotateQuarter } from "../src/lib/scan/warp";
import { detectOrientation, rotateMask, uprightScore } from "../src/lib/scan/orientation";
import { dikdortgen, dondur, fisSatirlari, kagitRgba, paragrafSatirlari, sahne, yaziCiz, zSatirlari, type Kagit } from "./helpers/tarama-yazi";

const FIS = yaziCiz(fisSatirlari(1), { width: 576, size: 22 });
const FIS2 = yaziCiz(fisSatirlari(7, 9), { width: 576, size: 20 });
const Z = yaziCiz(zSatirlari(2), { width: 576, size: 22 });
const A4 = yaziCiz(paragrafSatirlari(1000, 18, 7), { width: 1000, size: 18 });

/** Görüntü saat yönünde `t` çeyrek döndürülmüşse dik yapmak için gereken dönüş */
const fix = (t: number) => (((4 - t) % 4) * 90) as 0 | 90 | 180 | 270;

test("taranmış belge: her dört yön doğru ve emin", () => {
  for (const [name, k] of [
    ["fiş", FIS],
    ["fiş (az ürün)", FIS2],
    ["Z raporu", Z],
    ["A4", A4],
  ] as const) {
    const base = kagitRgba(k, { noise: 3, blur: 0.6, seed: 3 });
    for (const t of [0, 1, 2, 3]) {
      const r = detectOrientation(rotateQuarter(base, t));
      assert.equal(r.rotation, fix(t), `${name}, ${t * 90}° döndürülmüş: ${JSON.stringify(r)}`);
      assert.ok(r.confidence >= 0.7, `${name} ${t * 90}°: güven ${r.confidence}`);
      assert.equal(r.lineRotation, t % 2 ? 90 : 0);
    }
  }
  // gri görüntü de olur
  const g = toGray(rotateQuarter(kagitRgba(FIS, { noise: 2 }), 2));
  assert.equal(detectOrientation(g).rotation, 180);
});

test("fotoğraf: perspektif, eğiklik, bulanıklık, gölge; dörtgenle ya da bütün kareyle", () => {
  const cases: [string, Kagit, number, number, Partial<Parameters<typeof sahne>[1]>][] = [
    ["fiş yan (90°)", FIS, 90, 2.5, { blur: 0.9, noise: 3, shadow: 0.3 }],
    ["fiş ters", FIS, 180, -3, { blur: 0.8, noise: 3, warm: 0.15 }],
    ["Z yan (270°)", Z, 270, 2, { blur: 0.8, noise: 3 }],
    ["A4 ters", A4, 180, 1.5, { blur: 1, noise: 3, shadow: 0.25 }],
    ["A4 düz", A4, 0, -2, { blur: 1.1, noise: 3 }],
  ];
  for (const [name, k, deg, skew, s] of cases) {
    const scale = Math.min(1, 1150 / Math.max(k.width, k.height));
    const pw = k.width * scale;
    const ph = k.height * scale;
    const W = deg % 180 ? Math.round(ph + 260) : Math.round(pw + 260);
    const H = deg % 180 ? Math.round(pw + 260) : Math.round(ph + 260);
    const q: Quad = dondur(dikdortgen((W - pw) / 2, (H - ph) / 2, pw, ph), deg + skew);
    const img = sahne(k, { width: W, height: H, corners: q, seed: 9, ...s });
    // kâğıt sahnede saat yönünde `deg` çevrilmiş: dik yapmak için (360 − deg)
    const want = (360 - deg) % 360;
    const withQuad = detectOrientation(img, { corners: orderCorners(q) });
    assert.equal(withQuad.rotation, want, `${name}, dörtgenle: ${JSON.stringify(withQuad)}`);
    const whole = detectOrientation(img);
    assert.equal(whole.rotation, want, `${name}, bütün kare: ${JSON.stringify(whole)}`);
  }
  // küçük yazı (harf ~9 px)
  const q: Quad = dondur(dikdortgen(250, 200, 576 * 0.55, 865 * 0.55), 182);
  const small = sahne(FIS, { width: 820, height: 880, corners: q, blur: 0.6, noise: 2.5, seed: 10 });
  assert.equal(detectOrientation(small, { corners: orderCorners(q) }).rotation, 180);
});

test("emin olunamayınca bilinmiyor: yazısız kâğıt, simetrik bloklar, tek sözcük", () => {
  const blank: Kagit = { width: 600, height: 900, ink: new Float32Array(600 * 900) };
  const r0 = detectOrientation(kagitRgba(blank, { noise: 3 }));
  assert.equal(r0.rotation, "bilinmiyor");
  assert.equal(r0.lineRotation, null);
  assert.equal(r0.guess, null);
  // ortalı, işaretsiz dolu bloklar ("yazı" satırları ama ne nokta ne yaslama ne başlık)
  const bars: Kagit = { width: 600, height: 900, ink: new Float32Array(600 * 900) };
  for (let r = 0; r < 24; r++) {
    const y0 = 40 + r * 34;
    const len = 200 + ((r * 97) % 300);
    const x0 = Math.round((600 - len) / 2);
    for (let wd = x0; wd < x0 + len; wd += 46) {
      for (let y = y0; y < y0 + 16; y++) for (let x = wd; x < Math.min(x0 + len, wd + 38); x++) bars.ink[y * 600 + x] = 1;
    }
  }
  const r1 = detectOrientation(kagitRgba(bars, { noise: 2 }));
  assert.equal(r1.rotation, "bilinmiyor", JSON.stringify(r1));
  assert.equal(r1.lineRotation, 0, "satırlar yine de yatay bulunur");
  // iki kısa satır: ölçülecek az parça
  const few = yaziCiz([{ text: "NAKİT" }, { text: "Z NO" }], { width: 400, size: 22 });
  const r2 = detectOrientation(kagitRgba(few, { noise: 2 }));
  assert.equal(r2.rotation, "bilinmiyor", JSON.stringify(r2));
});

test("yardımcılar: maske çevirme ve puan", () => {
  const m = Uint8Array.from([1, 0, 0, 0, 0, 0]); // 3 × 2, sol üst dolu
  const r1 = rotateMask(m, 3, 2, 1);
  assert.deepEqual([r1.width, r1.height], [2, 3]);
  assert.equal(r1.mask[1], 1, "saat yönünde 90°: sol üst → sağ üst");
  const r2 = rotateMask(m, 3, 2, 2);
  assert.equal(r2.mask[5], 1, "180°: sol üst → sağ alt");
  assert.equal(uprightScore({ marks: 0, align: 0, header: 0, segments: 30, markCount: 0 }), 0);
  assert.ok(uprightScore({ marks: 0.6, align: 0.25, header: 0.7, segments: 30, markCount: 50 }) > 0.5);
});
