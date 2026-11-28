// Banka POS (kart) komisyonu: "Tümü" şube görünümlerinin toplamıdır (denetim, 28 Kasım 2026; docs/SUBE.md, docs/KOMISYON.md).
// Her şubenin kendi POS oranı var (Şubeler › POS oranı). Kusur: bir ayda hiçbir şubenin kasa kartı yokken (ciro elle
// yazılmış) "Tümü" tek kartlı satış oranını ve tek komisyon oranını şubelerin TOPLAM cirosuna uyguluyordu; şubelerden
// birinin kasa kartı olup öbürününki yokken de kartsız şubeyi kendi görünümündekinden başka oranla sayıyordu. İki
// durumda da Tümü, şubelerin kendi görünümlerinde okunan komisyonların toplamı değildi.
//
// Kural (src/lib/calc/engine.ts › posCommission, pnlMonth): komisyon şube şube hesaplanır ve toplanır; her şube
// "Tümü"de kendi görünümündeki tutarla sayılır.
//   - Kasa kartı olan şube-ayı: banka kartı × şubenin oranı, KURUŞA yuvarlanır (yarım kuruş yukarı).
//   - Kasa kartı olmayan şube-ayı: eski formül, ciro × Ayarlar'daki komisyon oranı × şubenin banka kartı payı;
//     yuvarlanmaz (Excel'le uyum; tek şube görünümünde de böyle).
//   - Tümü = kuruşa yuvarlanmış kart tutarlarının toplamı + yuvarlanmamış eski formül tutarlarının toplamı.
// Yuvarlama tek şube yolundakiyle aynıdır: bu yüzden Tümü ile Σ şube arasında kuruş farkı da oluşmaz.
// Çalıştırma: npx tsx --test tests/kart-komisyonu-tumu.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel } from "../src/lib/calc/engine";
import type { Dataset, Month, TillMonth } from "../src/lib/calc/types";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const seed: SeedData = JSON.parse(readFileSync(join(__dirname, "..", "tests/fixtures/baslangic/veri.json"), "utf8"));
const base: Dataset = { ...datasetFromSeed(seed), currentMonth: "2027-02" };
const M = "2027-01";

/** Şubelerin POS oranları BİLEREK farklı; Ayarlar'daki eski genel oran (başlangıç verisi: %2,5) ikisinden de farklı */
const RATES: NonNullable<Dataset["branchRates"]> = [
  { id: "tuzla", name: "Tuzla", posRate: 0.0185 },
  { id: "marina", name: "Marina", posRate: 0.0229 },
];

/** Kasa raporlarından gelen ay: ciro, banka kartı ve yemek kartı kasadan (kartlı oran elle yazılmamış) */
function kasaMonth(posRevenue: number, card: number, mealCard: number): Month {
  const share = (v: number) => Math.round((v / posRevenue) * 10_000) / 10_000;
  const till = { month: M, from: `${M}-01`, to: `${M}-31`, reported: 31, openDays: 31, posRevenue, discounts: 0, discountDays: 0, offRevenue: 0, offDays: 0, cardShare: share(card + mealCard), bankShare: share(card), card, mealCard, missing: [], partialFrom: null } as unknown as TillMonth;
  return {
    month: M,
    openDays: 31,
    posRevenue,
    discounts: 0,
    offRevenue: 0,
    note: null,
    cardShare: till.cardShare,
    sources: { openDays: "kasa", posRevenue: "kasa", discounts: "kasa", offRevenue: "kasa", cardShare: "kasa" },
    kasa: { values: { openDays: 31, posRevenue, discounts: 0, offRevenue: 0, cardShare: till.cardShare }, till },
  };
}

/** Cirosu elle yazılmış ay (kasa raporu yok); kartlı oran elle yazıldıysa o, yoksa Ayarlar'daki */
function manualMonth(posRevenue: number, cardShare: number | null): Month {
  return {
    month: M,
    openDays: 31,
    posRevenue,
    discounts: 0,
    offRevenue: 0,
    note: null,
    cardShare,
    sources: { openDays: "manual", posRevenue: "manual", discounts: "none", offRevenue: "none", cardShare: cardShare === null ? "none" : "manual" },
    kasa: null,
  };
}

/** "Tümü"nün ay bilgisi, panelin kendi kuralıyla (src/lib/cash-month.ts › combineMonths): ciro toplam, kartlı oran ciro ağırlıklı */
function allMonth(parts: Record<string, Month>): Month {
  const ms = Object.values(parts);
  const posRevenue = ms.reduce((a, m) => a + (m.posRevenue ?? 0), 0);
  const weighted = ms.filter((m) => m.cardShare != null && (m.posRevenue ?? 0) > 0);
  const weight = weighted.reduce((a, m) => a + m.posRevenue!, 0);
  const cardShare = weighted.length > 1 ? Math.round((weighted.reduce((a, m) => a + m.cardShare! * m.posRevenue!, 0) / weight) * 10_000) / 10_000 : (weighted[0]?.cardShare ?? null);
  const src = (f: "openDays" | "posRevenue" | "discounts" | "offRevenue" | "cardShare") => {
    const of = ms.map((m) => m.sources?.[f] ?? "none");
    return of.includes("manual") ? "manual" : of.includes("kasa") ? "kasa" : "none";
  };
  return {
    month: M,
    openDays: 31,
    posRevenue,
    discounts: 0,
    offRevenue: 0,
    note: null,
    cardShare,
    sources: { openDays: src("openDays"), posRevenue: src("posRevenue"), discounts: src("discounts"), offRevenue: src("offRevenue"), cardShare: src("cardShare") },
    kasa: null,
    byBranch: parts,
  };
}

const posOf = (ds: Dataset): number => createModel(ds).pnlMonth(M).cells.get("commission:pos")?.value ?? Number.NaN;
const months = (m: Month) => [...base.months.filter((x) => x.month !== M), m];

/** Tümü'nün ve her şubenin kendi görünümünün banka POS komisyonu */
function views(parts: Record<string, Month>) {
  const all = posOf({ ...base, branchRates: RATES, months: months(allMonth(parts)) });
  const branch = Object.fromEntries(
    Object.entries(parts).map(([id, m]) => [id, posOf({ ...base, branchRates: RATES, branchView: { id, name: RATES.find((r) => r.id === id)!.name, kind: "fiziksel" }, months: months(m) })]),
  );
  return { all, branch, sum: Object.values(branch).reduce((a, v) => a + v, 0) };
}

/** Kuruşa yuvarlama, tek şube yolundaki kuralla (yarım kuruş yukarı) */
const kurus = (v: number) => Math.round(v * 100 + 1e-7) / 100;

test("Tümü = şubelerin toplamı: iki şubenin de kasa kartı var, oranları farklı (her şube kendi oranıyla, kuruşa yuvarlanır)", () => {
  // Kuruş kesirleri bilerek yarım kuruşun iki yanında: 248.317,35 × %1,85 = 4.593,870975; 131.905,65 × %2,29 = 3.020,639385
  const v = views({ tuzla: kasaMonth(410_000, 248_317.35, 31_250), marina: kasaMonth(190_500, 131_905.65, 12_400) });
  assert.equal(v.branch.tuzla, 4_593.87, "Tuzla: kart × %1,85, kuruşa");
  assert.equal(v.branch.marina, 3_020.64, "Marina: kart × %2,29, kuruşa");
  assert.equal(v.all, 7_614.51, "Tümü: iki şubenin kuruşa yuvarlanmış tutarlarının toplamı");
  assert.equal(v.all, kurus(v.sum));
  // Toplam karta tek oran uygulanmış olsaydı (hangi oranla olursa olsun) bu tutar çıkmazdı
  const pooledCard = 248_317.35 + 131_905.65;
  for (const rate of [0.0185, 0.0229, base.settings.komisyon]) assert.notEqual(v.all, kurus(pooledCard * rate), `tek oran ${rate}`);
});

test("Tümü = şubelerin toplamı: hiçbir şubenin kasa kartı yok (ciro elle), kartlı oranları farklı", () => {
  // Tuzla kartlı oranını elle yazmış (%90); Marina yazmamış (Ayarlar'daki oran geçer). Eski hâl: (ciro toplamı) × oran ×
  // Tuzla'nın %90'ı, yani Marina'nın cirosuna da %90 uygulanıyordu
  const parts = { tuzla: manualMonth(300_000, 0.9), marina: manualMonth(200_000, null) };
  const v = views(parts);
  const k = base.settings.komisyon;
  assert.ok(Math.abs(v.branch.tuzla - 300_000 * k * 0.9) < 1e-9, "Tuzla: kendi cirosu × Ayarlar oranı × kendi kartlı oranı");
  assert.ok(Math.abs(v.branch.marina - 200_000 * k * base.settings.kartOrani) < 1e-9, "Marina: kendi cirosu × Ayarlar oranı × Ayarlar'daki kartlı oran");
  assert.ok(Math.abs(v.all - v.sum) < 1e-9, `Tümü ${v.all} ≠ şubelerin toplamı ${v.sum}`);
  assert.equal(kurus(v.all), kurus(v.sum), "kuruşu kuruşuna");
  assert.ok(Math.abs(v.all - 500_000 * k * 0.9) > 100, "toplam ciroya tek kartlı oran uygulanmıyor");
});

test("Tümü = şubelerin toplamı: bir şubenin kasa kartı var, öbürünün cirosu elle (kartsız şube kendi görünümündeki tutarla)", () => {
  const parts = { marina: kasaMonth(190_500, 131_905.65, 12_400), tuzla: manualMonth(287_433.4, 0.8137) };
  const v = views(parts);
  assert.equal(v.branch.marina, 3_020.64, "Marina: kart × kendi oranı, kuruşa");
  // Tuzla'nın kasa kartı yok: eski formül (Ayarlar'daki oran × elle yazılan kartlı oran), yuvarlanmaz
  assert.ok(Math.abs(v.branch.tuzla - 287_433.4 * base.settings.komisyon * 0.8137) < 1e-9);
  assert.ok(Math.abs(v.all - v.sum) < 1e-9, `Tümü ${v.all} ≠ şubelerin toplamı ${v.sum}`);
  assert.equal(kurus(v.all), kurus(v.sum), "kuruşu kuruşuna");
  // Satışlar da aynı tutarı dağıtır (iki sayfa aynı rakam)
  const model = createModel({ ...base, branchRates: RATES, months: months(allMonth(parts)) });
  assert.ok(Math.abs((model.posCommission(M)?.amount ?? Number.NaN) - v.all) < 1e-9);
});

test("Tümü = şubelerin toplamı: cirosu olmayan şube 0 sayılır; tek şubeli Tümü o şubenin görünümüyle aynı", () => {
  const some = views({ tuzla: kasaMonth(410_000, 248_317.35, 31_250), marina: manualMonth(0, null) });
  assert.equal(some.branch.marina, 0);
  assert.equal(some.all, some.branch.tuzla);
  const legacy = views({ tuzla: manualMonth(300_000, null) });
  assert.equal(legacy.all, legacy.branch.tuzla, "tek şubeli eski ay: Tümü ile şube görünümü birebir aynı sayı");
  // Şube kırılımı olmayan eski veri (ilk aktarım, testler) eskisi gibi: ciro × Ayarlar oranı × kartlı oran
  const plain = posOf({ ...base, branchRates: RATES, months: months(manualMonth(300_000, null)) });
  assert.equal(plain, 300_000 * base.settings.komisyon * base.settings.kartOrani);
  assert.equal(legacy.all, plain);
});
