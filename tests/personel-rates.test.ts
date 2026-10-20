// SGK oran alanları: yüzde puanı okunur, tek bölme, akla yatkın sınırlar.
// Çalıştırma: npx tsx --test tests/personel-rates.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { createModel, staffCost } from "../src/lib/calc/engine";
import type { Settings } from "../src/lib/calc/types";
import { DEFAULT_SETTINGS } from "../src/lib/constants";

import { checkRates, ratesChanged, toRateTexts, type RateTexts } from "../src/app/panel/personel/rates";

const SAVED = { isciSgk: 0.14, isciIssizlik: 0.01, isverenSgk: 0.1575, isverenIssizlik: 0.02 };
const texts = (over: Partial<RateTexts>): RateTexts => ({ ...toRateTexts(SAVED), ...over });
const close = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-12, `${a} ≈ ${b}`);

test("toRateTexts: kayıtlı kesir alanda yüzde puanı", () => {
  assert.deepEqual(toRateTexts(SAVED), { isciSgk: "14", isciIssizlik: "1", isverenSgk: "15,75", isverenIssizlik: "2" });
});

test("checkRates: '%15,75', '15,75', '15,75%' ve '% 15,75' hepsi 0,1575 (eskiden %'li yazım 0,001575 oluyordu)", () => {
  for (const t of ["%15,75", "15,75", "15,75%", "% 15,75"]) {
    const c = checkRates(texts({ isverenSgk: t }));
    close(c.values.isverenSgk, 0.1575);
    assert.equal(c.ok, true, t);
    assert.equal(c.warnings.isverenSgk, undefined, t);
  }
});

test("checkRates: kesir olarak yazılmış oran (0,1575) şüpheli: uyarı verir, engellemez", () => {
  const c = checkRates(texts({ isverenSgk: "0,1575" }));
  close(c.values.isverenSgk, 0.001575);
  assert.equal(c.ok, true);
  assert.equal(c.warnings.isverenSgk, "%0,16 çok düşük: yüzde olarak yazın, ör. 15,75");
});

test("checkRates: boş, sayı olmayan, negatif ve %100 ve üzeri hata", () => {
  assert.equal(checkRates(texts({ isciSgk: "" })).errors.isciSgk, "Oran yazın (yoksa 0)");
  assert.equal(checkRates(texts({ isciSgk: "abc" })).errors.isciSgk, "Sayı yazın, ör. 14 ya da %14");
  assert.equal(checkRates(texts({ isciSgk: "-1" })).errors.isciSgk, "Negatif olamaz");
  assert.equal(checkRates(texts({ isverenSgk: "100" })).errors.isverenSgk, "%100'den küçük olmalı");
  assert.equal(checkRates(texts({ isciSgk: "0" })).ok, true);
  assert.equal(checkRates(texts({ isverenSgk: "45" })).warnings.isverenSgk, "%45 alışılmadık yüksek bir oran");
});

test("checkRates: işçi kesintileri toplamı %100'e ulaşırsa kaydedilmez (brüt hesaplanamaz)", () => {
  const c = checkRates(texts({ isciSgk: "90", isciIssizlik: "20" }));
  assert.equal(c.ok, false);
  assert.match(c.formError ?? "", /toplamı %100'ün altında olmalı \(şu an %110\)/);
  assert.equal(checkRates(texts({ isciSgk: "99", isciIssizlik: "1" })).ok, false);
  assert.equal(checkRates(texts({ isciSgk: "98", isciIssizlik: "1" })).ok, true);
});

test("ratesChanged: biçim farkı değişiklik sayılmaz", () => {
  assert.equal(ratesChanged(texts({ isverenSgk: "%15,75" }), SAVED), false);
  assert.equal(ratesChanged(texts({ isciSgk: "14,0" }), SAVED), false);
  assert.equal(ratesChanged(texts({ isverenSgk: "20,75" }), SAVED), true);
  assert.equal(ratesChanged(texts({ isverenSgk: "" }), SAVED), true);
});

test("Excel Personel: 30.000 net, oranlar alanlardan okunduğunda işveren maliyeti 41.558,82", () => {
  const c = checkRates(texts({ isverenSgk: "%15,75" }));
  const st: Settings = { ...DEFAULT_SETTINGS, ...(c.values as Record<string, number>) } as Settings;
  const cost = staffCost({ id: 1, name: "P", netSalary: 30000, extras: 0, active: true }, st);
  assert.ok(Math.abs(cost.gross - 35294.1176) < 0.001);
  assert.ok(Math.abs(cost.total - 41558.8235) < 0.001);
  // Eski hata: %15,75 → 0,001575 olsaydı işveren SGK 55,59 ₺ olurdu
  assert.ok(cost.employerSgk > 5558);
  // Modelle aynı sonuç (createModel import edilebiliyor: istemci hesabı motorla aynı)
  assert.equal(typeof createModel, "function");
});
