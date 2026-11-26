// Belge tarayıcı: çekim kalitesi, gerçek yazılı sentetik fotoğraflarla (Inter yazı tipiyle fiş, uzun Z raporu, A4).
// Net çekimlerde (eğik, gölgeli, sarı ışıkta, soluk termal baskı, loş ama okunur, kareyi dolduran, açık zeminde)
// hiç uyarı çıkmamalı; bulanık, hareketli, parlamalı, karanlık, kesik, uzaktan ve iki belgeli çekimde doğru uyarı
// ve doğru ağırlık. src/lib/scan/quality.ts, metin.ts; docs/FOTOGRAF.md › Belge tarama (kalite, yön, birleştirme).
// Çalıştırma: npx tsx --test tests/tarama-kalite.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Quad, RgbaImage } from "../src/lib/scan/image";
import { assessQuality, issueText, type QualityOptions, type QualityReport } from "../src/lib/scan/quality";
import { dikdortgen, dondur, fisSatirlari, paragrafSatirlari, sahne, yaziCiz, zSatirlari, type Kagit, type SahneAyari } from "./helpers/tarama-yazi";

const FIS = yaziCiz(fisSatirlari(1), { width: 576, size: 22 });
const Z = yaziCiz(zSatirlari(2), { width: 576, size: 22 });
const A4 = yaziCiz(paragrafSatirlari(1000, 18, 7), { width: 1000, size: 18 });

/** Kâğıdı `k` ölçeğinde, (x, y)'ye, `rot` derece döndürerek koyar */
function yerlestir(p: Kagit, x: number, y: number, k = 1, rot = 0): Quad {
  return dondur(dikdortgen(x, y, p.width * k, p.height * k), rot);
}

function cek(p: Kagit, s: SahneAyari, q: Quad, opts: QualityOptions = {}): { img: RgbaImage; r: QualityReport } {
  const img = sahne(p, { ...s, corners: q });
  return { img, r: assessQuality(img, { corners: q, ...opts }) };
}

function ozet(r: QualityReport): string {
  const m = r.metrics;
  return `${r.issues.map((i) => `${i.kind}:${i.severity}`).join(",") || "sorun yok"} | σ/harf ${m.blurRatio} harf ${m.glyph} (foto ${m.glyphPhoto}, okuma ${m.glyphRead}) kâğıt ${m.paper} karşıtlık ${m.contrast} gürültü ${m.noise} parlama ${m.glare} kesik ${m.cutSides.join("/")} öteki ${m.otherDocs}`;
}

function kinds(r: QualityReport): string[] {
  return r.issues.map((i) => i.kind);
}

test("net çekimlerde uyarı yok (yanlış alarm)", () => {
  const cases: [string, Kagit, SahneAyari, Quad, QualityOptions?][] = [
    ["fiş, eğik, koyu masa", FIS, { width: 900, height: 1150, noise: 3, blur: 0.6, seed: 1 }, yerlestir(FIS, 160, 140, 1, 4)],
    ["fiş, gölge ve sarı ışık", FIS, { width: 900, height: 1150, noise: 3, blur: 0.5, shadow: 0.35, warm: 0.15, seed: 2 }, yerlestir(FIS, 170, 150, 1, -3)],
    ["fiş, soluk termal baskı", FIS, { width: 900, height: 1150, noise: 2.5, blur: 0.6, inkStrength: 0.45, seed: 3 }, yerlestir(FIS, 160, 140, 1, 2)],
    ["fiş, loş ama okunur", FIS, { width: 900, height: 1150, noise: 3, blur: 0.5, light: 0.6, seed: 4 }, yerlestir(FIS, 160, 140, 1, 1)],
    ["fiş, açık renk masa", FIS, { width: 900, height: 1150, noise: 2, blur: 0.6, bg: [205, 200, 192], seed: 5 }, yerlestir(FIS, 160, 140, 1, -2)],
    ["Z raporu, dar uzun", Z, { width: 800, height: 1600, noise: 3, blur: 0.6, seed: 6 }, yerlestir(Z, 170, 60, 0.82, 1.5)],
    [
      "A4, perspektif",
      A4,
      { width: 1400, height: 1450, noise: 3, blur: 0.7, seed: 7 },
      [
        { x: 130, y: 150 },
        { x: 1290, y: 110 },
        { x: 1330, y: 1330 },
        { x: 95, y: 1360 },
      ],
      { noun: "fatura" },
    ],
  ];
  for (const [name, p, s, q, o] of cases) {
    const { r } = cek(p, s, q, o);
    assert.equal(r.issues.length, 0, `${name}: ${ozet(r)}`);
    assert.ok(r.ok);
    assert.ok(r.metrics.text, `${name}: yazı bulunmalı`);
  }
  // kareyi dolduran fiş (dörtgen yok; yazı kesilmemiş, kâğıdın kenar boşluğu kadrajda)
  const img = sahne(FIS, { width: 560, height: 830, corners: yerlestir(FIS, -8, -18), noise: 3, blur: 0.6, seed: 8 });
  const r = assessQuality(img);
  assert.equal(r.issues.length, 0, `kareyi dolduran: ${ozet(r)}`);
});

test("bulanık ve hareketli çekim: bulanıklık uyarısı, ağırlığı bulanıklıkla artar", () => {
  const q = yerlestir(FIS, 160, 140, 1, 3);
  const base = { width: 900, height: 1150, noise: 3, seed: 11 };
  const soft = cek(FIS, { ...base, blur: 2 }, q).r;
  assert.ok(!kinds(soft).includes("bulanik"), `σ = 2 px (harf 16 px) okunur, uyarı yok: ${ozet(soft)}`);
  const mid = cek(FIS, { ...base, blur: 3 }, q).r;
  assert.deepEqual(
    mid.issues.filter((i) => i.kind === "bulanik").map((i) => i.severity),
    ["hafif"],
    `σ = 3 px: hafif: ${ozet(mid)}`,
  );
  const bad = cek(FIS, { ...base, blur: 4.5 }, q).r;
  const b = bad.issues.find((i) => i.kind === "bulanik");
  assert.equal(b?.severity, "ciddi", `σ = 4,5 px: ciddi: ${ozet(bad)}`);
  assert.equal(b?.text, "Fotoğraf bulanık; telefonu sabit tutup yeniden çekin.");
  assert.equal(bad.ok, false);
  // hareket bulanıklığı tek yönlü: yatay kenarlar keskin kalsa da yakalanır
  const motion = cek(FIS, { ...base, blur: 0.5, motion: 13 }, q).r;
  assert.ok(kinds(motion).includes("bulanik"), `hareket: ${ozet(motion)}`);
  assert.ok(motion.metrics.blurSigmaX > 2 * motion.metrics.blurSigmaY, `hareket yönü: ${ozet(motion)}`);
  // ölçek bağımsız: aynı bulanıklık küçük yazıda daha ağır
  const small = cek(FIS, { width: 700, height: 900, noise: 3, blur: 2, seed: 12 }, yerlestir(FIS, 170, 160, 0.62, 2)).r;
  assert.ok(kinds(small).includes("bulanik"), `küçük yazıda σ = 2 px: ${ozet(small)}`);
});

test("parlama: yazının üstündeyse ciddi, kâğıt dışındaysa uyarı yok", () => {
  const q = yerlestir(FIS, 160, 140, 1, 2);
  const s = { width: 900, height: 1150, noise: 3, blur: 0.6, seed: 21 };
  const on = cek(FIS, { ...s, glare: [{ x: 430, y: 560, r: 70 }] }, q).r;
  const g = on.issues.find((i) => i.kind === "parlama");
  assert.equal(g?.severity, "ciddi", ozet(on));
  assert.equal(g?.text, "Fişte parlama var; ışığı yandan alın.");
  assert.ok(on.metrics.glareOnText);
  const off = cek(FIS, { ...s, glare: [{ x: 70, y: 1060, r: 60 }] }, q).r;
  assert.ok(!kinds(off).includes("parlama"), `kâğıt dışında: ${ozet(off)}`);
});

test("karanlık fotoğraf: kâğıdın parlaklığına göre", () => {
  const q = yerlestir(FIS, 160, 140, 1, 2);
  const dim = cek(FIS, { width: 900, height: 1150, noise: 3, blur: 0.6, light: 0.36, seed: 31 }, q).r;
  assert.deepEqual(dim.issues.filter((i) => i.kind === "karanlik").map((i) => i.severity), ["hafif"], ozet(dim));
  const dark = cek(FIS, { width: 900, height: 1150, noise: 4, blur: 0.6, light: 0.22, seed: 32 }, q).r;
  const d = dark.issues.find((i) => i.kind === "karanlik");
  assert.equal(d?.severity, "ciddi", ozet(dark));
  assert.equal(d?.text, "Fotoğraf karanlık; ışıklı bir yerde çekin.");
  // çok soluk baskı (yazı kâğıttan ~20 düzey koyu): düşük karşıtlık, hafif (yeniden çekmek pek düzeltmez)
  const faint = cek(FIS, { width: 900, height: 1150, noise: 3, blur: 0.6, inkStrength: 0.1, seed: 71 }, q).r;
  const f = faint.issues.find((i) => i.kind === "dusuk-karsitlik");
  assert.equal(f?.severity, "hafif", ozet(faint));
  assert.equal(f?.text, "Yazı soluk seçiliyor; ışıklı bir yerde, gölgesiz çekin.");
  // koyu masada parlak fiş, dörtgen yok: zemin karanlık sayılmaz (kâğıt yazının çevresinde ölçülür)
  const img = sahne(FIS, { width: 900, height: 1150, corners: yerlestir(FIS, 160, 140, 1, 2), noise: 3, blur: 0.6, seed: 33 });
  const r = assessQuality(img);
  assert.ok(!kinds(r).includes("karanlik"), `dörtgensiz: ${ozet(r)}`);
});

test("kesik: yazılı kenar kadraj dışında; boş kenar boşluğu kesilince uyarı yok", () => {
  // fişin altı kadrajın dışında: algılanan dörtgenin alt kenarı karenin kenarında. Kesik bir satırın ortasından
  // (harfler kesilmiş) ya da iki satırın arasından geçebilir.
  const top = 90;
  const visible = (H: number): Quad => [
    { x: 160, y: top },
    { x: 736, y: top },
    { x: 736, y: H - 1 },
    { x: 160, y: H - 1 },
  ];
  let img: RgbaImage | null = null;
  for (const H of [682, 700]) {
    img = sahne(FIS, { width: 900, height: H, corners: yerlestir(FIS, 160, top), noise: 3, blur: 0.6, seed: 41 });
    const r = assessQuality(img, { corners: visible(H) });
    const k = r.issues.find((i) => i.kind === "kesik");
    assert.equal(k?.side, "alt", `${H}: ${ozet(r)}`);
    assert.equal(k?.severity, "ciddi");
    assert.equal(k?.text, "Fişin altı kesilmiş; tamamını çekin.");
    assert.equal(r.ok, false);
    assert.equal(r.issues.filter((i) => i.kind === "kesik").length, 1, `yalnız alt: ${ozet(r)}`);
  }
  // belge ters tutulmuşsa (dik yapmak için 180°) görüntünün altı belgenin üstüdür
  const ters = assessQuality(img!, { corners: visible(700), rotation: 180, noun: "rapor" });
  assert.equal(ters.issues.find((i) => i.kind === "kesik")?.text, "Raporun üstü kesilmiş; tamamını çekin.");
  // yalnız alttaki boş kenar boşluğu kesik (son satır kadrajda): uyarı yok
  const H2 = 140 + FIS.height - 12;
  const img2 = sahne(FIS, { width: 900, height: H2, corners: yerlestir(FIS, 160, 140), noise: 3, blur: 0.6, seed: 42 });
  const r2 = assessQuality(img2, {
    corners: [
      { x: 160, y: 140 },
      { x: 736, y: 140 },
      { x: 736, y: H2 - 1 },
      { x: 160, y: H2 - 1 },
    ],
  });
  assert.ok(!kinds(r2).includes("kesik"), `boş kenar: ${ozet(r2)}`);
  // dörtgensiz yakın çekim: A4'ün sağı ve altı kadraj dışında
  const img3 = sahne(A4, { width: 760, height: 700, corners: yerlestir(A4, -8, -10), noise: 3, blur: 0.6, seed: 43 });
  const r3 = assessQuality(img3, { noun: "belge" });
  const sides = r3.issues.filter((i) => i.kind === "kesik").map((i) => i.side).sort();
  assert.deepEqual(sides, ["alt", "sag"], ozet(r3));
});

test("kesik: eğik fişin altı kadraj dışında (algılama alt kenarı karşı kenara paralel yaptı, köşe karenin biraz içinde)", () => {
  // detect.ts squareFrameSides: kareye dayanan alt kenar üst kenara paralel; bir köşe karede, öteki ~20 px içeride
  const W = 900;
  const H = 1150;
  const k = (H * 0.82) / FIS.height;
  const truth = dondur(dikdortgen(W / 2 - (FIS.width * k) / 2, H * 0.62 - (FIS.height * k) / 2, FIS.width * k, FIS.height * k), -3.4);
  const img = sahne(FIS, { width: W, height: H, corners: truth, noise: 3, blur: 0.7, seed: 44 });
  const [tl, tr] = truth;
  // sağ ve sol kenarlar boyunca; alt kenar üstünkine paralel, sol alt köşe karenin alt kenarında
  const along = (a: { x: number; y: number }, b: { x: number; y: number }, y: number) => ({ x: a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y), y });
  const bl = along(tl, truth[3], H - 1);
  const slope = (tr.y - tl.y) / (tr.x - tl.x);
  const brY = bl.y + slope * (along(tr, truth[2], H - 1).x - bl.x);
  const q: Quad = [tl, tr, along(tr, truth[2], brY), bl];
  assert.ok(H - 1 - brY > 12, `sağ alt köşe karenin içinde: ${(H - 1 - brY).toFixed(1)}`);
  const r = assessQuality(img, { corners: q });
  assert.equal(r.issues.find((i) => i.kind === "kesik")?.side, "alt", ozet(r));
});

test("çok küçük yazı: uzaktan çekim; uzun fişte parça parça çekim önerisi", () => {
  const far = cek(FIS, { width: 900, height: 1150, noise: 2.5, blur: 0.5, seed: 51 }, yerlestir(FIS, 330, 380, 0.36, 2)).r;
  const k = far.issues.find((i) => i.kind === "kucuk-yazi");
  assert.equal(k?.severity, "ciddi", ozet(far));
  assert.equal(k?.text, "Yazı çok küçük; yaklaşıp çekin.");
  const mid = cek(FIS, { width: 900, height: 1150, noise: 2.5, blur: 0.5, seed: 52 }, yerlestir(FIS, 250, 300, 0.55, 2)).r;
  assert.deepEqual(mid.issues.filter((i) => i.kind === "kucuk-yazi").map((i) => i.severity), ["hafif"], ozet(mid));
  // fotoğrafta harf yeterli ama okuyucunun ölçeğine (burada 1000 px) uzun fiş sığmıyor
  const long = cek(Z, { width: 800, height: 1600, noise: 3, blur: 0.6, seed: 53 }, yerlestir(Z, 170, 60, 0.82, 1.5), { readEdge: 1000 }).r;
  const l = long.issues.find((i) => i.kind === "kucuk-yazi");
  assert.ok(l, ozet(long));
  assert.match(l.text, /iki parçada çekin/);
});

test("birden çok belge: dörtgen dışında yazılı başka kâğıt", () => {
  const s = { width: 1450, height: 1100, noise: 3, blur: 0.6, seed: 61 };
  const q1 = yerlestir(FIS, 90, 110, 1, 2);
  const q2 = yerlestir(FIS, 780, 140, 1, -3);
  const img = sahne([FIS, FIS], s, [q1, q2]);
  const withQuad = assessQuality(img, { corners: q1 });
  assert.deepEqual(withQuad.issues.filter((i) => i.kind === "coklu-belge").map((i) => i.severity), ["hafif"], ozet(withQuad));
  assert.equal(withQuad.issues.find((i) => i.kind === "coklu-belge")?.text, "Fotoğrafta birden çok belge var; her fişi ayrı çekin.");
  const noQuad = assessQuality(img);
  assert.deepEqual(noQuad.issues.filter((i) => i.kind === "coklu-belge").map((i) => i.severity), ["ciddi"], ozet(noQuad));
  // tek fiş ve yanında yazısız açık renk nesne: uyarı yok
  const one = sahne([FIS, { width: 400, height: 500, ink: new Float32Array(400 * 500) }], s, [q1, yerlestir({ width: 400, height: 500, ink: new Float32Array(0) }, 850, 200)]);
  const r = assessQuality(one, { corners: q1 });
  assert.ok(!kinds(r).includes("coklu-belge"), ozet(r));
});

test("uyarı metinleri sade Türkçe ve belgenin adına göre", () => {
  assert.equal(issueText("kesik", "fis", "alt"), "Fişin altı kesilmiş; tamamını çekin.");
  assert.equal(issueText("kesik", "fatura", "sag"), "Faturanın sağı kesilmiş; tamamını çekin.");
  assert.equal(issueText("parlama", "rapor"), "Raporda parlama var; ışığı yandan alın.");
  assert.equal(issueText("kucuk-yazi"), "Yazı çok küçük; yaklaşıp çekin.");
  assert.equal(issueText("bulanik"), "Fotoğraf bulanık; telefonu sabit tutup yeniden çekin.");
});
