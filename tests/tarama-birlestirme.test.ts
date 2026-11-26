// Belge tarayıcı: uzun fiş birleştirme, gerçek yazılı sentetik Z raporuyla (Inter yazı tipi). Rapor parçalara bölünür,
// her parça başka ışıkta, gölgeyle, bulanıklıkla, gürültüyle, ölçek ve yatay kayma farkıyla "taranır"; birleşen görüntü
// raporun kendisine benzemeli, dikiş satır arasından geçmeli. Aynı şablonlu başka rapor, başka fiş, örtüşmeyen ya da
// yazısız örtüşen parçalar, tekrarlayan satırlar birleşmez (null: ayrı fotoğraf olarak yüklenir).
// src/lib/scan/stitch.ts; docs/FOTOGRAF.md › Belge tarama (kalite, yön, birleştirme).
// Çalıştırma: npx tsx --test tests/tarama-birlestirme.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { resizeRgba, toGray, type RgbaImage } from "../src/lib/scan/image";
import { inkMap } from "../src/lib/scan/metin";
import { findOverlap, probeOverlap, stitchParts, STITCH_MIN_CONFIDENCE } from "../src/lib/scan/stitch";
import { MAX_PHOTO_EDGE } from "../src/lib/photo-rules";
import { dilim, fisSatirlari, kagitRgba, yaziCiz, zSatirlari, type Kagit, type SahneAyari } from "./helpers/tarama-yazi";

const Z = yaziCiz(zSatirlari(2, 20), { width: 576, size: 22 });
/** Aynı şablon, başka tutarlar (başka günün Z'si) */
const Z_BASKA = yaziCiz(zSatirlari(3, 20), { width: 576, size: 22 });

/** Kâğıdı yatayda kaydırır (parça kadrajda biraz sağda / solda çekilmiş) */
function kaydir(k: Kagit, dx: number): Kagit {
  const ink = new Float32Array(k.width * k.height);
  for (let y = 0; y < k.height; y++) {
    for (let x = 0; x < k.width; x++) {
      const sx = x - dx;
      if (sx >= 0 && sx < k.width) ink[y * k.width + x] = k.ink[y * k.width + sx];
    }
  }
  return { width: k.width, height: k.height, ink };
}

/** Parçanın taranmış hâli: ışık / bulanıklık ayarı, yatay kayma, sonra (taramanın çıktı ölçüsü) ölçek */
function parca(k: Kagit, y0: number, y1: number, o: Omit<SahneAyari, "width" | "height" | "corners"> = {}, sx = 1, sy = 1, dx = 0): RgbaImage {
  const img = kagitRgba(kaydir(dilim(k, y0, y1), dx), o);
  return sx === 1 && sy === 1 ? img : resizeRgba(img, Math.round(img.width * sx), Math.round(img.height * sy));
}

/**
 * İki görüntünün koyuluk ilintisi (kâğıdın yerel parlaklığına oranla: gölge ve ışık rengi karışmaz; aynı genişlikte).
 * `y0`, `y1` verilirse yalnız o satırlarda ve ikincisi ±3 satır kaydırılarak en iyisi (yerel denetim).
 */
function ilinti(a: RgbaImage, b: RgbaImage, y0?: number, y1?: number): number {
  const ga = inkMap(toGray(a)).dark;
  const gb = inkMap(toGray(b)).dark;
  const W = a.width;
  const one = (r0: number, r1: number, d: number) => {
    let n = 0;
    let sa = 0;
    let sb = 0;
    let sab = 0;
    let saa = 0;
    let sbb = 0;
    for (let y = r0; y < r1; y++) {
      if (y + d < 0 || y + d >= b.height || y >= a.height) continue;
      for (let x = 0; x < W; x++) {
        const va = ga[y * W + x];
        const vb = gb[(y + d) * W + x];
        n++;
        sa += va;
        sb += vb;
        sab += va * vb;
        saa += va * va;
        sbb += vb * vb;
      }
    }
    return (sab - (sa * sb) / n) / Math.sqrt((saa - (sa * sa) / n) * (sbb - (sb * sb) / n));
  };
  if (y0 === undefined || y1 === undefined) return one(0, Math.min(a.height, b.height), 0);
  let best = -1;
  for (let d = -3; d <= 3; d++) best = Math.max(best, one(Math.max(0, y0), Math.min(a.height, y1), d));
  return best;
}

/** Satırın koyuluğu (0–1; kâğıt ~0) */
function satirKoyulugu(img: RgbaImage, y: number): number {
  let s = 0;
  for (let x = 0; x < img.width; x++) {
    const p = (y * img.width + x) * 4;
    s += 1 - (0.299 * img.data[p] + 0.587 * img.data[p + 1] + 0.114 * img.data[p + 2]) / 240;
  }
  return Math.max(0, s / img.width);
}

const GERCEK = kagitRgba(Z, { blur: 0.7 });

test("iki parça: gölge, ışık, kayma ve ölçek farkıyla birleşir; dikiş satır arasından geçer", () => {
  const ust = parca(Z, 0, 1150, { noise: 3, blur: 0.7, shadow: 0.25, seed: 1 });
  // alt parça: sarı ve loş ışık, daha bulanık, 14 px sağda, %7 dar ve %5 kısa (başka uzaklıktan çekilmiş)
  const alt = parca(Z, 850, Z.height, { noise: 4, blur: 1, warm: 0.1, light: 0.88, seed: 2 }, 0.93, 0.95, 14);
  const r = stitchParts([ust, alt]);
  assert.ok(r, "birleşmeli");
  assert.deepEqual(r.order, [0, 1]);
  const m = r.matches[0];
  assert.ok(Math.abs(m.offsetY - 850) <= 1.5, `dikey yer ${m.offsetY}`);
  assert.ok(Math.abs(m.scaleY - 1 / 0.95) <= 0.006, `dikey ölçek ${m.scaleY}`);
  assert.ok(Math.abs(m.scaleX - 1 / 0.93) <= 0.008, `yatay ölçek ${m.scaleX}`);
  // alt parçanın ortadaki sütunu üst parçada aynı yere düşer (±1,5 px)
  const xMid = (288 + 14) * 0.93;
  assert.ok(Math.abs(m.offsetX + m.scaleX * xMid - 288) <= 1.5, `yatay yer ${m.offsetX + m.scaleX * xMid}`);
  assert.ok(m.confidence >= 0.8, `güven ${m.confidence}`);
  assert.ok(m.overlap >= 295 && m.overlap <= 305, `örtüşme ${m.overlap}`);
  assert.equal(r.image.width, 576);
  assert.ok(Math.abs(r.image.height - Z.height) <= 3, `boy ${r.image.height} / ${Z.height}`);
  assert.equal(r.scale, 1);
  // birleşen görüntü raporun kendisine benzer; dikiş yazısız satırdan geçer
  const c = ilinti(r.image, GERCEK);
  assert.ok(c >= 0.9, `rapora benzerlik ${c.toFixed(3)}`);
  const seam = r.seams[0];
  assert.ok(seam > 850 && seam < 1150, `dikiş örtüşmede: ${seam}`);
  assert.ok(satirKoyulugu(GERCEK, seam) < 0.01, `dikiş satırı yazısız: ${satirKoyulugu(GERCEK, seam).toFixed(3)}`);
  assert.ok(r.timing >= 0);
});

test("üç parça karışık sırayla verilse de doğru sırada birleşir; kısa örtüşme de olur", () => {
  const p0 = parca(Z, 0, 760, { noise: 3, blur: 0.8, seed: 3 });
  const p1 = parca(Z, 640, 1380, { noise: 3, blur: 0.6, shadow: 0.3, seed: 4 }, 1.04, 1.06, -10);
  const p2 = parca(Z, 1270, Z.height, { noise: 5, blur: 1.1, light: 0.8, seed: 5 }, 0.97, 0.97, 6);
  const r = stitchParts([p1, p0, p2]);
  assert.ok(r, "birleşmeli");
  assert.deepEqual(r.order, [1, 0, 2]);
  assert.equal(r.matches.length, 2);
  assert.equal(r.seams.length, 2);
  // kısa örtüşmede (4 satır) dikey ölçek ~%1 kesinlikte bulunur: boy %1,5 içinde
  assert.ok(Math.abs(r.image.height - Z.height) <= 0.015 * Z.height, `boy ${r.image.height} / ${Z.height}`);
  // dikişlerin çevresi raporla örtüşür (alt parçanın ölçeği ~%1 şaşabildiği için bütün görüntü değil)
  for (const s of r.seams) {
    assert.ok(satirKoyulugu(GERCEK, s) < 0.01, `dikiş ${s} yazısız`);
    const c = ilinti(r.image, GERCEK, s - 80, s + 80);
    assert.ok(c >= 0.85, `dikiş ${s} çevresinde rapora benzerlik ${c.toFixed(3)}`);
  }
  // sıra denemesi kapalıysa verilen sıra tutmaz
  assert.equal(stitchParts([p1, p0, p2], { anyOrder: false }), null);
});

test("birleşmemesi gerekenler: başka günün Z'si, başka fiş, örtüşmeyen ve yazısız örtüşen parçalar", () => {
  const ust = parca(Z, 0, 1150, { noise: 3, blur: 0.7, seed: 6 });
  // aynı şablon (etiketler aynı), başka tutarlar; tam da örtüşmesi beklenen yerden kesilmiş
  for (const y0 of [850, 700]) {
    const baska = parca(Z_BASKA, y0, Z_BASKA.height, { noise: 3, blur: 0.8, seed: 7 });
    const p = probeOverlap(ust, baska);
    assert.ok(p.best && p.best.confidence < STITCH_MIN_CONFIDENCE, `başka Z (${y0}): ${JSON.stringify(p)}`);
    assert.ok(p.reasons.includes("ayrintida-tutmuyor"), p.reasons.join(","));
    assert.equal(stitchParts([ust, baska]), null);
  }
  // market fişi
  const fis = kagitRgba(yaziCiz(fisSatirlari(4, 20), { width: 576, size: 22 }), { noise: 3, blur: 0.7, seed: 8 });
  assert.equal(stitchParts([ust, fis]), null);
  // arada boşluk: alt parça üst parçanın bittiği yerden 80 px sonra başlıyor
  const kopuk = parca(Z, 1230, Z.height, { noise: 3, blur: 0.8, seed: 9 });
  assert.equal(findOverlap(ust, kopuk), null);
  assert.equal(stitchParts([ust, kopuk]), null);
  // örtüşen bölge yazısız (raporun sonundaki boş kâğıt): emin olunamaz
  const bos: Kagit = { width: 576, height: Z.height + 400, ink: new Float32Array(576 * (Z.height + 400)) };
  bos.ink.set(Z.ink);
  const a = parca(bos, 900, Z.height + 250, { noise: 3, blur: 0.7, seed: 10 });
  const b = parca(bos, Z.height + 30, Z.height + 400, { noise: 3, blur: 0.7, seed: 11 });
  assert.equal(stitchParts([a, b]), null);
});

test("tekrarlayan satırlar: örtüşme birden çok yerde tutuyorsa emin olunmaz", () => {
  const satir = { text: "KISIM 01  %10|*1.250,00" };
  const tekrar = yaziCiz([{ text: "Z RAPORU", align: "orta" as const }, ...Array.from({ length: 40 }, () => satir)], { width: 576, size: 22 });
  const ust = parca(tekrar, 0, 800, { noise: 3, blur: 0.7, seed: 12 });
  const alt = parca(tekrar, 560, tekrar.height, { noise: 3, blur: 0.9, seed: 13 });
  const p = probeOverlap(ust, alt);
  assert.ok(!p.best || p.best.confidence < STITCH_MIN_CONFIDENCE, JSON.stringify(p));
  assert.equal(stitchParts([ust, alt]), null);
});

test("uzun kenar sınırı: aşan birleşme küçültülür (varsayılan MAX_PHOTO_EDGE)", () => {
  assert.equal(MAX_PHOTO_EDGE, 4096);
  const ust = parca(Z, 0, 1150, { noise: 3, blur: 0.7, seed: 14 });
  const alt = parca(Z, 850, Z.height, { noise: 3, blur: 0.8, seed: 15 });
  const r = stitchParts([ust, alt], { maxEdge: 1500 });
  assert.ok(r);
  assert.ok(Math.max(r.image.width, r.image.height) <= 1500, `${r.image.width}×${r.image.height}`);
  assert.ok(Math.abs(r.scale - 1500 / Z.height) < 0.01, `ölçek ${r.scale}`);
  assert.ok(Math.abs(r.seams[0] - r.matches[0].seam * r.scale) <= 2, "dikiş küçültülmüş ölçüde");
  // tek parça ya da çok küçük parça: birleştirilecek bir şey yok
  assert.equal(stitchParts([ust]), null);
  assert.equal(stitchParts([ust, { width: 40, height: 40, data: new Uint8ClampedArray(40 * 40 * 4) }]), null);
});
