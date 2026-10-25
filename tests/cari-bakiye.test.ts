// Faturanın kalanı (src/lib/cari/balance.ts): takipsiz faturada bugünkü kural harfi harfine (insights.test.ts ve
// tedarikciler.test.ts örnekleri + 500 rastgele fatura), takipli kural, iade, kapanış toleransı, kısmi ödeme, tamamen
// karşılanma, takip tabanı ve ödeme şeklinin eşlemesi.
// Çalıştırma: npx tsx --test tests/cari-bakiye.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { openBalance as insightsOpenBalance } from "../src/lib/calc/insights";
import { arrivalBase, coveredByAllocations, EPS, isPartiallyPaid, methodFromCard, openBalance, paidViaOf, trackingBase, CARI_METHODS } from "../src/lib/cari/balance";

/** Planın tabanındaki (main @ 48a984c) kural, harfi harfine: karşılaştırma için */
type Old = { payable: number; unpaid: boolean; outstanding?: number | null };
function oldOpenBalance(inv: Old): number {
  if (!inv.unpaid) return 0;
  return inv.outstanding !== null && inv.outstanding !== undefined && inv.outstanding > 0 ? inv.outstanding : inv.payable;
}
function oldIsPartiallyPaid(inv: Old): boolean {
  return inv.unpaid && inv.outstanding !== null && inv.outstanding !== undefined && inv.outstanding > 0 && inv.outstanding < inv.payable - 0.005;
}

/** Tohumlu rastgele sayı (mulberry32): her koşuda aynı örnekler */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SAMPLES: Old[] = [
  // insights.test.ts
  { payable: 10000, unpaid: true, outstanding: 6000 },
  { payable: 11516.77, unpaid: true, outstanding: null },
  { payable: 500, unpaid: true, outstanding: 0 },
  { payable: 2000, unpaid: false, outstanding: 2000 },
  // tedarikciler.test.ts
  { payable: 2000, unpaid: true, outstanding: 500 },
  { payable: 300, unpaid: true },
  { payable: -200, unpaid: true, outstanding: null },
  { payable: -200, unpaid: false, outstanding: 0 },
  { payable: 0, unpaid: true, outstanding: null },
  { payable: 1200, unpaid: true, outstanding: 1200 },
  { payable: 1200, unpaid: true, outstanding: 1199.996 },
];

test("takipsiz fatura: kalan ve kısmi ödeme bugünkü kuralla birebir aynı (örnekler + 500 rastgele)", () => {
  const r = rng(20261024);
  const random: Old[] = Array.from({ length: 500 }, () => {
    const payable = Math.round((r() * 40000 - 4000) * 100) / 100;
    const kind = r();
    const outstanding = kind < 0.3 ? null : kind < 0.4 ? undefined : kind < 0.5 ? 0 : Math.round(r() * Math.abs(payable) * 1.2 * 100) / 100;
    return { payable, unpaid: r() < 0.6, outstanding };
  });
  for (const inv of [...SAMPLES, ...random]) {
    for (const extra of [{}, { allocated: 0, ledgerBase: null }, { allocated: 0 }]) {
      const x = { ...inv, ...extra };
      assert.equal(openBalance(x), oldOpenBalance(inv), JSON.stringify(x));
      assert.equal(insightsOpenBalance(x), oldOpenBalance(inv), "insights yeniden dışa aktarır");
      assert.equal(isPartiallyPaid(x), oldIsPartiallyPaid(inv), JSON.stringify(x));
    }
  }
});

test("takipli fatura: kalan = Ödenecek − taban − panelde sayılan; Paraşüt'ün kalanı okunmaz", () => {
  // Sütaş F3: 3.000, Paraşüt'te 1.200 ödenmiş (kalan 1.800), panelde 1.549,50 sayıldı
  const f3 = { payable: 3000, unpaid: true, outstanding: 1800, ledgerBase: 1200, allocated: 1549.5 };
  assert.equal(openBalance(f3), 250.5);
  assert.equal(isPartiallyPaid(f3), true);
  // Muhasebeci aynı ödemeyi Paraşüt'te işler: kalan 250,50 yazılır, panel aynı kalır
  assert.equal(openBalance({ ...f3, outstanding: 250.5 }), 250.5);
  assert.equal(openBalance({ ...f3, outstanding: 0 }), 250.5, "Paraşüt kapatsa da panel takipte");
  // Hiç sayılmamış takipli fatura: Ödenecek − taban
  assert.equal(openBalance({ payable: 1250, unpaid: true, outstanding: null, ledgerBase: 0, allocated: 0 }), 1250);
  assert.equal(isPartiallyPaid({ payable: 1250, unpaid: true, ledgerBase: 0, allocated: 0 }), false);
  // Fazla sayılmış olsa da eksi olmaz
  assert.equal(openBalance({ payable: 100, unpaid: true, ledgerBase: 0, allocated: 150 }), 0);
  // Ödenmiş fatura 0
  assert.equal(openBalance({ ...f3, unpaid: false }), 0);
});

test("takipli iade: dağıtım almaz, düşülecek alacak olarak kalır", () => {
  assert.equal(openBalance({ payable: -200, unpaid: true, ledgerBase: 0, allocated: 0 }), -200);
  assert.equal(coveredByAllocations({ payable: -200, unpaid: true, ledgerBase: 0, allocated: 0 }), false);
  assert.equal(isPartiallyPaid({ payable: -200, unpaid: true, ledgerBase: 0, allocated: 0 }), false);
});

test("tamamen karşılanma: takipli, Ödenecek > 0, kalan 0,005 ₺'den az", () => {
  assert.equal(EPS, 0.005);
  assert.equal(coveredByAllocations({ payable: 8450.5, unpaid: true, ledgerBase: 0, allocated: 8450.5 }), true);
  assert.equal(coveredByAllocations({ payable: 8450.5, unpaid: true, ledgerBase: 0, allocated: 8450.496 }), true, "tolerans içinde");
  assert.equal(coveredByAllocations({ payable: 8450.5, unpaid: true, ledgerBase: 0, allocated: 8450.49 }), false);
  assert.equal(coveredByAllocations({ payable: 3000, unpaid: true, ledgerBase: 1200, allocated: 1800 }), true, "taban da sayılır");
  assert.equal(coveredByAllocations({ payable: 3000, unpaid: true, ledgerBase: null, allocated: 3000 }), false, "takipsiz fatura dağıtımla kapanmaz");
  assert.equal(coveredByAllocations({ payable: 3000, unpaid: false, ledgerBase: 0, allocated: 3000 }), true, "ödendi işaretine bakmaz");
});

test("takip tabanı: ödenmemiş ve Paraşüt'te kısmen ödenmişte Ödenecek − kalan, ötekilerde 0", () => {
  assert.equal(trackingBase({ payable: 3000, unpaid: true, outstanding: 1800 }), 1200);
  assert.equal(trackingBase({ payable: 3000, unpaid: true, outstanding: 0 }), 0);
  assert.equal(trackingBase({ payable: 3000, unpaid: true, outstanding: null }), 0);
  assert.equal(trackingBase({ payable: 3000, unpaid: false, outstanding: 1800 }), 0, "ödenmiş fatura");
  assert.equal(trackingBase({ payable: 3000, unpaid: true, outstanding: 3500 }), 0, "eksi olmaz");
  // Takip başlarken kalan değişmez
  for (const f of [
    { payable: 3000, unpaid: true, outstanding: 1800 },
    { payable: 8450.5, unpaid: true, outstanding: null },
    { payable: 500, unpaid: true, outstanding: 0 },
    { payable: -200, unpaid: true, outstanding: null },
  ]) {
    assert.equal(openBalance({ ...f, ledgerBase: trackingBase(f), allocated: 0 }), openBalance(f), JSON.stringify(f));
  }
});

test("takipli karta sonradan gelen faturanın tabanı: takip gününden önceki tarihlide takip tabanı, o gün ve sonrasında 0", () => {
  const f = { payable: 1100, unpaid: true, outstanding: 600 };
  assert.equal(arrivalBase({ ...f, date: "2026-05-18" }, "2026-10-22"), 500, "takip öncesi: Paraşüt'te ödenen kısım");
  assert.equal(arrivalBase({ ...f, date: "2026-10-21" }, "2026-10-22"), 500);
  assert.equal(arrivalBase({ ...f, date: "2026-10-22" }, "2026-10-22"), 0, "takip günü: yalnız panel sayar");
  assert.equal(arrivalBase({ ...f, date: "2026-10-28" }, "2026-10-22"), 0);
  assert.equal(arrivalBase({ payable: 1100, unpaid: true, outstanding: null, date: "2026-05-18" }, "2026-10-22"), 0, "ödeme bilgisi yok (e-fatura)");
  assert.equal(arrivalBase({ payable: 1100, unpaid: false, outstanding: 0, date: "2026-05-18" }, "2026-10-22"), 0, "ödenmiş gelir");
  // Takip öncesi faturanın kalanı Paraşüt'ünkiyle aynı (takip başlarken panelde olsaydı olacağı gibi)
  const old = { ...f, date: "2026-05-18" };
  assert.equal(openBalance({ ...old, ledgerBase: arrivalBase(old, "2026-10-22"), allocated: 0 }), openBalance(f));
});

test("ödeme şekli: kasa ve elden nakittir; kartın şeklinden varsayılan", () => {
  assert.deepEqual(
    CARI_METHODS.map((m) => paidViaOf(m)),
    ["nakit", "nakit", "havale", "kart", "cek", "diger"],
  );
  assert.equal(methodFromCard("nakit"), "elden");
  assert.equal(methodFromCard("havale"), "havale");
  assert.equal(methodFromCard("kart"), "kart");
  assert.equal(methodFromCard(null), "havale");
  assert.equal(methodFromCard(undefined), "havale");
});
