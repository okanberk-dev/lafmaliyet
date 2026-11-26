// Belge tarayıcı: canlı vizörün saf parçaları (src/lib/scan/live.ts). Dörtgen yumuşatma (titreme bastırılır, gerçek
// hareket izlenir, tek karelik yanlış dörtgen atlanır, kaybolan kâğıt kısa süre tutulur), karenin netlik / ışık ölçüsü
// (sentetik fiş: net, bulanık, loş), otomatik çekim kararı (sabit + iyi kalite → geri sayım → bir kez çek; kıpırdama,
// kesik kenar, küçük kâğıt, karanlık, odak arama geri sayımı bozar) ve algılama ölçüsünün süreye göre ayarı.
// Çalıştırma: npx tsx --test tests/tarama-canli.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { detectDocument, thumbnail } from "../src/lib/scan";
import type { Quad } from "../src/lib/scan/image";
import { AutoCapture, frameMetrics, LIVE_EDGE, nextLiveEdge, QuadSmoother, quadShift, type LiveFrame } from "../src/lib/scan/live";
import { dikdortgen, dondur, fisSatirlari, sahne, yaziCiz } from "./helpers/tarama-yazi";

const W = 288;
const H = 384;
const BASE: Quad = [
  { x: 60, y: 50 },
  { x: 230, y: 56 },
  { x: 226, y: 330 },
  { x: 56, y: 324 },
];

/** Basit sözde rastgele (tekrarlanabilir) */
function rnd(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function jitter(q: Quad, amp: number, r: () => number): Quad {
  return q.map((p) => ({ x: p.x + (r() * 2 - 1) * amp, y: p.y + (r() * 2 - 1) * amp })) as Quad;
}

function move(q: Quad, dx: number, dy: number): Quad {
  return q.map((p) => ({ x: p.x + dx, y: p.y + dy })) as Quad;
}

test("yumuşatma: ±2 px titreme belirgin azalır", () => {
  const s = new QuadSmoother();
  const r = rnd(7);
  let rawSum = 0;
  let outSum = 0;
  let prevRaw: Quad | null = null;
  let prevOut: Quad | null = null;
  for (let i = 0; i < 60; i++) {
    const raw = jitter(BASE, 2, r);
    const out = s.push(raw, i * 100, W, H)!;
    if (prevRaw && prevOut && i > 5) {
      rawSum += quadShift(prevRaw, raw, W, H);
      outSum += quadShift(prevOut, out, W, H);
    }
    prevRaw = raw;
    prevOut = out;
  }
  assert.ok(outSum < 0.6 * rawSum, `kare kare kayma: ham ${rawSum.toFixed(3)}, yumuşak ${outSum.toFixed(3)}`);
  // ortalaması gerçek yerde
  assert.ok(quadShift(prevOut!, BASE, W, H) < 0.01);
});

test("yumuşatma: gerçek hareketi gecikmeden izler", () => {
  const s = new QuadSmoother();
  for (let i = 0; i < 5; i++) s.push(BASE, i * 100, W, H);
  // kâğıt 20 px (köşegenin ~%4'ü) kaydı: bir karede yeni yerinde
  const moved = move(BASE, 20, 0);
  const out = s.push(moved, 500, W, H)!;
  assert.ok(quadShift(out, moved, W, H) < 0.005, `kayma ${quadShift(out, moved, W, H)}`);
  // küçük (3 px) kayma iki üç karede yetişir
  const small = move(moved, 3, 0);
  let o = s.push(small, 600, W, H)!;
  assert.ok(quadShift(o, small, W, H) > 0.001, "küçük kayma bir karede tümüyle izlenmez (titreme bastırma)");
  for (let i = 0; i < 6; i++) o = s.push(small, 700 + i * 100, W, H)!;
  assert.ok(quadShift(o, small, W, H) < 0.002);
});

test("yumuşatma: tek karelik sıçrama atlanır, iki karelik kabul edilir", () => {
  const s = new QuadSmoother();
  for (let i = 0; i < 5; i++) s.push(BASE, i * 100, W, H);
  const other = move(BASE, -50, 40);
  let out = s.push(other, 500, W, H)!;
  assert.ok(quadShift(out, BASE, W, H) < 1e-9, "tek kare: eski yerinde");
  out = s.push(BASE, 600, W, H)!;
  assert.ok(quadShift(out, BASE, W, H) < 1e-9);
  s.push(other, 700, W, H);
  out = s.push(move(other, 1, 0), 800, W, H)!;
  assert.ok(quadShift(out, move(other, 1, 0), W, H) < 1e-9, "iki kare aynı yer: yeni yere geçti");
});

test("yumuşatma: kâğıt bir an kaybolursa kısa süre tutulur, sonra bırakılır", () => {
  const s = new QuadSmoother({ holdMs: 450 });
  for (let i = 0; i < 3; i++) s.push(BASE, i * 100, W, H);
  assert.ok(s.push(null, 400, W, H), "200 ms: tutuluyor");
  assert.ok(s.push(null, 600, W, H), "400 ms: tutuluyor");
  assert.equal(s.push(null, 800, W, H), null, "600 ms: bırakıldı");
  // geri gelince doğrudan yeni yerinde (eskiye yumuşatılmaz)
  const back = move(BASE, 30, 0);
  assert.ok(quadShift(s.push(back, 900, W, H)!, back, W, H) < 1e-9);
});

test("karenin ölçüsü: bulanık karede netlik düşer, loş karede parlaklık düşer", () => {
  const fis = yaziCiz(fisSatirlari(3), { width: 576, size: 22 });
  const q = dondur(dikdortgen(260, 160, fis.width * 0.9, fis.height * 0.9), 3);
  const net = thumbnail(sahne(fis, { width: 1100, height: 1500, noise: 2, blur: 0.5, seed: 11, corners: q }), LIVE_EDGE.start);
  const bulanik = thumbnail(sahne(fis, { width: 1100, height: 1500, noise: 2, blur: 8, seed: 11, corners: q }), LIVE_EDGE.start);
  const los = thumbnail(sahne(fis, { width: 1100, height: 1500, noise: 2, blur: 0.5, light: 0.3, seed: 11, corners: q }), LIVE_EDGE.start);
  const d = detectDocument(net, { maxEdge: LIVE_EDGE.start });
  assert.ok(d.corners && !d.fillsFrame, "küçük karede de kâğıt bulunur");
  const a = frameMetrics(net, d.corners);
  const b = frameMetrics(bulanik, d.corners);
  const c = frameMetrics(los, d.corners);
  assert.ok(b.sharpness < 0.6 * a.sharpness, `netlik: net ${a.sharpness.toFixed(3)}, bulanık ${b.sharpness.toFixed(3)}`);
  assert.ok(a.luma > 150, `kâğıt aydınlık (${a.luma.toFixed(0)})`);
  assert.ok(c.luma < 0.5 * a.luma, `loş ${c.luma.toFixed(0)}`);
  // kâğıt yoksa bütün kare
  const all = frameMetrics(net, null);
  assert.ok(all.luma > 0 && all.sharpness > 0);
});

/** Sabit, iyi bir kare */
function frame(t: number, quad: Quad | null = BASE, more: Partial<LiveFrame> = {}): LiveFrame {
  return { t, width: W, height: H, quad, confidence: 0.9, fillsFrame: false, luma: 190, sharpness: 1, ...more };
}

test("otomatik çekim: sabit ve iyi kâğıtta geri sayım, sonra bir kez çeker", () => {
  const ac = new AutoCapture({ stableMs: 500, countdownMs: 900 });
  const r = rnd(3);
  let firedAt = -1;
  let maxProgress = 0;
  for (let t = 0; t <= 3000; t += 100) {
    const s = ac.push(frame(t, jitter(BASE, 0.8, r)));
    maxProgress = Math.max(maxProgress, s.progress);
    if (s.fire) {
      assert.equal(firedAt, -1, "yalnız bir kez");
      firedAt = t;
    }
  }
  // 500 ms sabitlik (pencerenin %80'i) + 900 ms geri sayım
  assert.ok(firedAt >= 1200 && firedAt <= 1600, `çekim ${firedAt} ms'de`);
  assert.equal(maxProgress, 1);
  ac.reset();
  let again = false;
  for (let t = 0; t <= 2000; t += 100) again ||= ac.push(frame(t)).fire;
  assert.ok(again, "reset sonrası yeniden kurulur");
});

test("otomatik çekim: kıpırdayan kâğıtta geri sayım başlamaz, ortada kıpırdarsa baştan", () => {
  const ac = new AutoCapture();
  for (let t = 0; t <= 2000; t += 100) {
    const s = ac.push(frame(t, move(BASE, (t / 100) % 2 ? 10 : 0, 0)));
    assert.equal(s.fire, false);
    assert.equal(s.progress, 0);
  }
  ac.reset();
  let progress = 0;
  for (let t = 0; t <= 1000; t += 100) progress = ac.push(frame(t)).progress;
  assert.ok(progress > 0);
  const s = ac.push(frame(1100, move(BASE, 10, 0)));
  assert.equal(s.progress, 0);
  assert.equal(s.hint, "sabit-tut");
});

test("otomatik çekim: kesik, küçük, karanlık, bulanık, kareyi dolduran ve bulunamayan kâğıtta çekmez (ipucuyla)", () => {
  const cases: [string, (t: number) => LiveFrame, string][] = [
    ["kenara dayanan köşe", (t) => frame(t, [{ x: 0, y: 40 }, ...BASE.slice(1)] as Quad), "uzaklas"],
    ["küçük kâğıt", (t) => frame(t, [{ x: 100, y: 100 }, { x: 150, y: 100 }, { x: 150, y: 170 }, { x: 100, y: 170 }]), "yaklas"],
    ["karanlık", (t) => frame(t, BASE, { luma: 30 }), "karanlik"],
    ["kareyi dolduruyor", (t) => frame(t, BASE, { fillsFrame: true }), "kare-dolu"],
    ["kâğıt yok", (t) => frame(t, null, { confidence: 0 }), "ara"],
    ["güven düşük", (t) => frame(t, BASE, { confidence: 0.3 }), "ara"],
  ];
  for (const [name, f, hint] of cases) {
    const ac = new AutoCapture();
    let last = ac.push(f(0));
    for (let t = 100; t <= 3000; t += 100) {
      last = ac.push(f(t));
      assert.equal(last.fire, false, name);
    }
    assert.equal(last.hint, hint, name);
    assert.equal(last.ready, false, name);
  }
  // Odak arıyor: netlik son iki saniyenin en iyisinin altına düşünce geri sayım bozulur
  const ac = new AutoCapture();
  for (let t = 0; t <= 800; t += 100) ac.push(frame(t, BASE, { sharpness: 1 }));
  const s = ac.push(frame(900, BASE, { sharpness: 0.4 }));
  assert.equal(s.hint, "bulanik");
  assert.equal(s.progress, 0);
});

test("otomatik çekim kapalı: hazır der, çekmez", () => {
  const ac = new AutoCapture();
  let s = ac.push(frame(0), false);
  for (let t = 100; t <= 3000; t += 100) {
    s = ac.push(frame(t), false);
    assert.equal(s.fire, false);
  }
  assert.equal(s.hint, "hazir");
  assert.equal(s.ready, true);
});

test("algılama ölçüsü süreye göre: yavaşta küçülür, hızlıda büyür, sınırlarda kalır", () => {
  let e: number = LIVE_EDGE.start;
  for (let i = 0; i < 30; i++) e = nextLiveEdge(e, 200);
  assert.equal(e, LIVE_EDGE.min);
  for (let i = 0; i < 30; i++) e = nextLiveEdge(e, 20);
  assert.equal(e, LIVE_EDGE.max);
  assert.equal(nextLiveEdge(300, 70), 300);
});
