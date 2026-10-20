// Telefonda stok sayımı: süzgeç değişince (grup, "Kalan", arama) listenin başına dönülür.
// Çalıştırma: npx tsx --test tests/mobil-gider-stok-sayim.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { listTopScroll } from "../src/app/panel/sayim/logic";

// Telefonda araç çubuğu üst çubuğun (56px) altına yapışır; sayfa başından 1.300px aşağıda başlıyor
const NATURAL = 1300;
const STICKY = 56;

test("aşağıdayken süzgeç değişince araç çubuğu yapıştığı yere, liste başı hemen altına gelir", () => {
  // QA: KAHVE & ÇAY seçilince sayfa kısaldı, tarayıcı 1360'a sıkıştırdı (liste ekranın üstünde kaldı)
  assert.equal(listTopScroll(NATURAL, STICKY, 1360), NATURAL - STICKY);
  assert.equal(listTopScroll(NATURAL, STICKY, 4742), NATURAL - STICKY);
});

test("araç çubuğu henüz yapışmadıysa (liste ekranda) kaydırılmaz", () => {
  assert.equal(listTopScroll(NATURAL, STICKY, 0), null);
  assert.equal(listTopScroll(NATURAL, STICKY, 900), null);
  // Tam yerinde (ya da 1px yuvarlama farkıyla) zaten doğru yerde
  assert.equal(listTopScroll(NATURAL, STICKY, NATURAL - STICKY), null);
  assert.equal(listTopScroll(NATURAL, STICKY, NATURAL - STICKY + 1), null);
});

test("masaüstünde üst çubuk yok (0px); hedef negatif olmaz", () => {
  assert.equal(listTopScroll(800, 0, 2000), 800);
  assert.equal(listTopScroll(20, 56, 500), 0);
  assert.equal(listTopScroll(1300.4, 56, 3000), 1244);
});
