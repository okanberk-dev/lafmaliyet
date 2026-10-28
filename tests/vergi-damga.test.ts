// Beyanname damgaları (plan docs/planlar/vergi.md §3.9, §11-H): aylık KDV, KDV-2 ve muhtasar damgası, geçici vergi ve
// kurumlar vergisi beyannamesinin damgası; açıklanmamış yılın tutarı en son bilinen yıldan, tahmini.
// Çalıştırma: npx tsx --test tests/vergi-damga.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { geciciStamp, kvStamps, muhtasarStamp, returnStamps } from "../src/lib/tax/stamp";

test("H: aylık beyanname damgası: tevkifatlı ayda 2.521,70, tevkifatsız ayda 1.730,70", () => {
  const withKdv2 = returnStamps("2026-09", { kdv2: true, personnel: true, withholding: false });
  assert.deepEqual([withKdv2.kdv, withKdv2.kdv2, withKdv2.muhtasar, withKdv2.total], [791, 791, 939.7, 2521.7]);
  assert.equal(withKdv2.muhtasarKind, "mphb");
  assert.equal(withKdv2.estimated, false);
  assert.equal(returnStamps("2026-10", { kdv2: false, personnel: true, withholding: false }).total, 1730.7);
  // Personel yoksa ve stopaj varsa yalnız muhtasar (791,00); ikisi de yoksa muhtasar beyannamesi yok
  assert.deepEqual(muhtasarStamp("2026-09", false, true), { amount: 791, kind: "muhtasar", estimated: false, year: 2026 });
  assert.deepEqual(muhtasarStamp("2026-09", false, false), { amount: 0, kind: null, estimated: false, year: 2026 });
  // Aralık beyannamesi Ocak 2027'de verilir: 2027 tutarı açıklanmadı, 2026'nınki tahmini
  const dec = returnStamps("2026-12", { kdv2: false, personnel: true, withholding: false });
  assert.equal(dec.year, 2027);
  assert.equal(dec.estimated, true);
  assert.equal(dec.total, 1730.7);
});

test("H: kurumlar vergisi damgası 2.516,30 (izleyen yılın tutarı; 2027 açıklanmadı)", () => {
  const k = kvStamps(2026);
  assert.deepEqual([k.beyanname, k.bilanco, k.gelirTablosu, k.total], [1605.8, 616.3, 294.2, 2516.3]);
  assert.equal(k.year, 2027);
  assert.equal(k.estimated, true);
  assert.equal(k.note, "2027 tutarları açıklanmadı");
  const k27 = kvStamps(2027);
  assert.equal(k27.estimated, true);
  assert.equal(k27.total, 2516.3);
  // Tahmini yılın tutarı elle girilebilir
  assert.equal(kvStamps(2026, { "damga.beyanname.kv": 1700 }).total, 2610.5);
});

test("H: geçici vergi damgası her dönem 791,00; elle değer uygulanır", () => {
  assert.deepEqual(geciciStamp("2026-Q3"), { amount: 791, year: 2026, estimated: false });
  assert.deepEqual(geciciStamp("2026-Q4"), { amount: 791, year: 2027, estimated: true });
  assert.equal(geciciStamp("2026-Q3", { "damga.gecici": 820 }).amount, 820);
});
