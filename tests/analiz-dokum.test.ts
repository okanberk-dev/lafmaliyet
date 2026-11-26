// Analiz & senaryo: senaryo kartlarının dökümü (karta dokununca açılan pencere). Döküm kartın o anki rakamını tutmalı;
// kaydırıcılar değişince de. Kartın rakamı dökümle aynı hesaptan gelir (eski satır içi formüllerle aynı sonuç).
// Çalıştırma: npx tsx --test tests/analiz-dokum.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  breakEvenGroups,
  breakEvenNeedGroups,
  breakEvenNeeds,
  profitGroups,
  scenarioBreakEvenItems,
  scenarioFixedItems,
  targetDaily,
  targetGroups,
} from "../src/app/panel/analiz/breakdowns";
import { prepareBreakdown, type BreakdownGroup } from "../src/lib/breakdown";
import { createModel } from "../src/lib/calc/engine";
import { applyScenario, scenarioBase, type ScenarioBase } from "../src/lib/calc/insights";
import type { Dataset } from "../src/lib/calc/types";
import { pct, tl } from "../src/lib/format";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const data: SeedData = JSON.parse(readFileSync(join(__dirname, "..", "tests/fixtures/baslangic/veri.json"), "utf8"));
const ds: Dataset = { ...datasetFromSeed(data), currentMonth: "2026-10" };
const model = createModel(ds);
const month = model.salesMonths.at(-1)!;
const acikGun = model.settings.acikGun;
const base = scenarioBase(model, month);
const fixedItems = scenarioFixedItems(model, month);
const breakEvenItems = scenarioBreakEvenItems(model, month);

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const groupsSum = (gs: BreakdownGroup[]) => sum(gs.flatMap((g) => g.rows.map((r) => r.amount)));
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const row = (gs: BreakdownGroup[], key: string) => {
  const r = gs.flatMap((g) => g.rows).find((x) => x.key === key);
  assert.ok(r, `${key} satırı yok`);
  return r;
};

/** Senaryo kartlarının girdisi; sayfadaki gibi */
function sides(input: { price?: number; cost?: number; volume?: number; extra?: number } = {}, from: ScenarioBase = base) {
  const extraFixed = input.extra ?? 0;
  const r = applyScenario(
    from,
    { priceChangePct: (input.price ?? 0) / 100, costChangePct: (input.cost ?? 0) / 100, volumeChangePct: (input.volume ?? 0) / 100, extraFixed },
    acikGun,
  );
  const dirty = !!(input.price || input.cost || input.volume || extraFixed);
  return { b: r.base, s: r.scenario, dirty, extraFixed };
}

test("Excel verisinde senaryonun çıkış noktası dolu", () => {
  assert.ok(base.net > 0 && base.fixed > 0, "satış ve sabit gider var");
  assert.ok(fixedItems.length > 1);
});

test("Sabit gider kalemleri senaryonun sabit giderini tutar; personel ve kalemler bağlantılı", () => {
  // Net kâr kartı: bu ayın tutarları (Genel bakış'taki net kârla aynı taban, E-12)
  close(sum(fixedItems.map((r) => r.amount)), base.fixed, 0.5);
  assert.equal(fixedItems[0].key, "personel");
  assert.equal(fixedItems[0].href, "/panel/personel");
  assert.ok(!fixedItems.some((r) => r.key === "fixed:other"), "Excel verisinde fark kalmaz");
  // Başabaş kartı: standart ay + her ay girilen harcamalar (breakEvenOf, E-59)
  close(sum(breakEvenItems.map((r) => r.amount)), base.breakEvenFixed, 0.5);
  close(base.breakEvenFixed, model.breakEvenFixedFor(month), 1e-6);
  assert.equal(breakEvenItems[0].key, "personel");
  close(breakEvenItems[0].amount, model.personnelFor(month).total);
  assert.ok(breakEvenItems.slice(1).every((r) => r.href === "/panel/giderler" || r.key === "fixed:other"));
  assert.ok(!breakEvenItems.some((r) => r.key === "fixed:other"), "Excel verisinde fark kalmaz");
});

test("Net kâr / zarar: döküm kartın rakamını tutar, şu an ve kaydırıcılarla", () => {
  for (const input of [{}, { price: 5, cost: 10, volume: 15 }, { price: -20, volume: -50, extra: -30_000 }, { extra: 25_000.5 }]) {
    const o = sides(input);
    const gs = profitGroups({ ...o, fixedItems, month });
    close(groupsSum(gs), o.s.profit, 1e-4);
    // Pencere: verilen sırayla, toplam satırı kartın rakamı
    const p = prepareBreakdown(gs, { total: o.s.profit, order: "given" });
    assert.deepEqual(p.groups.map((g) => g.key), o.s.discountsNet ? ["brut", "indirim", "sabit"] : ["brut", "sabit"]);
    close(p.groups[0].subtotal, o.s.gross, 1e-4);
    close(p.groups.at(-1)!.subtotal, -o.s.fixed, 1e-4);
    assert.equal(p.total, o.s.profit);
    // Senaryodaki sabit gider değişimi ayrı kalem; yoksa satırı da yok
    const extra = gs.flatMap((g) => g.rows).find((r) => r.key === "extra");
    if (o.extraFixed) assert.equal(extra?.amount, -o.extraFixed);
    else assert.equal(extra, undefined);
    // Değişiklik varsa kalemin altında şu anki değer
    const net = row(gs, "net");
    assert.equal(net.href, `/panel/satislar?ay=${month}`);
    assert.equal(net.sub?.includes(`şu an ${tl(o.b.net)}`), o.dirty);
  }
});

test("Net kâr / zarar: sabit gider kalemleri en büyükten, giderler eksi", () => {
  const gs = profitGroups({ ...sides(), fixedItems, month });
  const fixed = gs.find((g) => g.key === "sabit")!.rows;
  assert.ok(fixed.every((r) => r.amount <= 0));
  for (let i = 1; i < fixed.length; i++) assert.ok(fixed[i - 1].amount <= fixed[i].amount, "en büyük gider önce");
  assert.ok(row(gs, "material").amount < 0 && row(gs, "commission").amount < 0);
});

test("Net kâr / zarar: kalemler eksik gelirse fark 'Diğer' olur, döküm yine tutar", () => {
  const o = sides({ extra: 1_000 });
  const gs = profitGroups({ ...o, fixedItems: fixedItems.slice(0, 2), month });
  close(groupsSum(gs), o.s.profit, 1e-4);
  assert.ok(row(gs, "fixed:other").amount < 0);
});

test("Başabaş günlük ciro: girdiler ve ara sonuç kartın rakamını verir", () => {
  for (const input of [{}, { price: 10 }, { cost: 50, extra: 20_000 }]) {
    const o = sides(input);
    const gs = breakEvenGroups({ ...o, acikGun });
    assert.ok(o.s.breakEvenDaily !== null);
    assert.equal(row(gs, "fixed").display, tl(o.s.breakEvenFixed));
    assert.equal(row(gs, "ratio").display, pct(o.s.grossRatio, 1));
    const monthly = row(gs, "monthly");
    close(monthly.amount / acikGun, o.s.breakEvenDaily);
    assert.equal(monthly.display, tl(o.s.toCover / o.s.grossRatio));
    assert.equal(row(gs, "days").display, `${acikGun} gün`);
    // Bilgi satırları pencerede kalır (tutarı 0 olsa da), toplam satırı yazılı değerle
    assert.equal(prepareBreakdown(gs, { order: "given" }).groups[0].rows.length, 4);
    assert.equal(row(gs, "fixed").sub?.includes("senaryoda"), !!o.extraFixed);
  }
});

test("Başabaş: brüt kâr oranı eksiyse hesaplanamaz, oran kırmızı", () => {
  const o = sides({ price: -20, cost: 400 });
  assert.ok(o.s.grossRatio <= 0);
  const gs = breakEvenGroups({ ...o, acikGun });
  assert.equal(row(gs, "ratio").tone, "bad");
  assert.equal(row(gs, "monthly").display, "–");
});

test("Hedef kâr için günlük ciro: kartın eski formülüyle aynı; döküm girdileri", () => {
  for (const [input, target] of [
    [{}, 50_000],
    [{ price: 5, volume: 10 }, 120_000],
    [{ extra: -30_000 }, 0],
  ] as const) {
    const o = sides(input);
    const daily = targetDaily(o.s, target, acikGun);
    // Başabaşla aynı taban: (standart sabit gider + aylık harcamalar − online brüt kâr + hedef)
    const expected = o.s.grossRatio > 0 ? (o.s.toCover + target) / o.s.grossRatio / acikGun : null;
    assert.equal(daily, expected);
    if (target === 0) assert.equal(daily, o.s.breakEvenDaily);
    const gs = targetGroups({ ...o, acikGun, target, targetValid: true });
    close(row(gs, "need").amount, o.s.toCover + target);
    close(row(gs, "monthly").amount / acikGun, daily!);
    assert.equal(row(gs, "target").display, tl(target));
    assert.equal(row(gs, "target").tone, undefined);
  }
  const bad = targetGroups({ ...sides(), acikGun, target: 0, targetValid: false });
  assert.equal(row(bad, "target").tone, "warn");
});

test("Zarar etmemek için: kartın eski formülüyle aynı zam ve satış artışı; döküm girdileri", () => {
  const n = breakEvenNeeds(base);
  const oldPrice =
    base.net - base.commission - base.discountsNet > 0 ? (base.material + base.fixed) / (base.net - base.commission - base.discountsNet) - 1 : null;
  const unit = base.net - base.material - base.commission - base.discountsNet;
  const oldVolume = unit > 0 ? base.fixed / unit - 1 : null;
  assert.equal(n.price, oldPrice);
  assert.equal(n.volume, oldVolume);
  assert.ok(n.price !== null && n.volume !== null);

  const { b } = sides();
  const gs = breakEvenNeedGroups(b);
  assert.deepEqual(gs.map((g) => g.key), ["simdi", "zam", "satis"]);
  assert.equal(gs[1].display, pct(n.price, 1));
  assert.equal(gs[2].display, pct(n.volume, 0));
  // Zam: karşılanacak ÷ zamla büyüyen − 1; satış: sabit ÷ katkı − 1
  close(row(gs, "cover").amount / row(gs, "priceBase").amount - 1, n.price!);
  close(gs[2].rows[1].amount / row(gs, "contribution").amount - 1, n.volume!);
  close(row(gs, "profit").amount, b.profit);
  assert.equal(row(gs, "profit").tone, b.profit < 0 ? "bad" : "good");
  // Kaydırıcılardan bağımsız: senaryo ne olursa olsun şu anki ay
  assert.deepEqual(breakEvenNeedGroups(sides({ price: 30, extra: 5_000 }).b), gs);
});

test("Zarar etmemek için: gelir yoksa iki yol da hesaplanamaz", () => {
  const empty: ScenarioBase = {
    revenue: 0,
    net: 0,
    discountsNet: 0,
    material: 0,
    commission: 0,
    fixed: 10_000,
    online: 0,
    breakEvenFixed: 10_000,
    onlineCover: 0,
    listPeriod: null,
    fixedShare: 1,
    period: null,
  };
  const n = breakEvenNeeds(empty);
  assert.equal(n.price, null);
  assert.equal(n.volume, null);
  const gs = breakEvenNeedGroups(sides({}, empty).b);
  assert.equal(gs[1].display, "–");
  assert.equal(gs[2].display, "–");
  assert.match(gs[1].note ?? "", /kapatmaz/);
  assert.equal(row(gs, "profit").tone, "bad");
});
