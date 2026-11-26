// Ürünler › Fiyatlar (docs/FIYATLAR.md): toplu değişikliğin kuralı, yuvarlaması (tamsayı kuruş), önizlemesi, engelleri,
// özeti ve metni; sitenin kapalı sayıldığı hatalar; kasanın (ModPOS) durumu ve kopyalanan metin; fiyat geçmişinin
// gruplanması, geri alma planı ve sitenin yazdığı fiyatın geçmişe girmesi; ekranın süzgeçleri. Sunucu kuralları kaynaktan:
// satış fiyatını yazan her yol geçmişe yazar.
// Çalıştırma: npx tsx --test tests/fiyatlar.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { bulkHref, filterBulkRows, parseCategoryParam, parseSizeParam, productSearchText, tabHref, tabOf } from "../src/app/panel/urunler/fiyatlar/logic";
import { createModel, priceProduct } from "../src/lib/calc/engine";
import { DEFAULT_SETTINGS } from "../src/lib/constants";
import { numPossessive } from "../src/lib/format";
import {
  blockReason,
  bulkSummary,
  defaultRounding,
  economicsAt,
  isSiteDown,
  parseRuleAmount,
  NOT_TRIED_DOWN,
  NOT_TRIED_LATE,
  previewRows,
  pushFailureOf,
  roundingById,
  ROUNDINGS,
  roundMinor,
  rulePrice,
  ruleSummary,
  ruleText,
  runSiteGroups,
  type BulkRow,
  type BulkRule,
  type Rounding,
  type SiteWriteOutcome,
} from "../src/lib/prices/bulk";
import { groupHistory, historyDayLabel, nothingToUndoText, PRICE_SOURCE_LABEL, sitePriceRecord, timeTR, undoPlan, type HistoryRow } from "../src/lib/prices/history";
import {
  batchPosNote,
  groupByCategory,
  posAfterPriceChange,
  posChangedText,
  posChecklistText,
  posMarkMax,
  POS_PRICE_REMINDER,
  POS_UNDO_TEXT,
  POS_UNDO_WINDOW_MS,
  posUndoRefusal,
  priceReminder,
  splitPosDone,
  type PosItem,
} from "../src/lib/prices/pos";
import { planMenuSync, type LinkedRow } from "../src/lib/site-menu/plan";
import { PRICE_PUSH_REMINDER } from "../src/lib/site-menu/push";
import type { SiteMenuItem } from "../src/lib/site-menu/schema";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";
import { assertNoCostKeys } from "./helpers/leak-scan";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const data: SeedData = JSON.parse(read("tests/fixtures/baslangic/veri.json"));
const model = createModel(datasetFromSeed(data));
const st = DEFAULT_SETTINGS;

const R = (id: Parameters<typeof roundingById>[0]): Rounding => roundingById(id);
const pctRule = (value: number, rounding: Rounding = R("5-up")): BulkRule => ({ kind: "percent", value, rounding });
const amountRule = (value: number, rounding: Rounding = R("none")): BulkRule => ({ kind: "amount", value, rounding });

// ---------------------------------------------------------------- Kural ve yuvarlama

test("kural: yüzde ve tutar tamsayı kuruşla; 200 +%5 5'e yukarı 210 (215 değil)", () => {
  assert.equal(rulePrice(195, 0, pctRule(10)), 215);
  assert.equal(rulePrice(200, 0, pctRule(5)), 210, "200 × 1,05 = 210,00000000000003 önce kuruşa yuvarlanır");
  assert.equal(rulePrice(60, 0, pctRule(10, R("5-nearest"))), 65);
  assert.equal(rulePrice(175, 0, pctRule(-5, R("5-down"))), 165);
  assert.equal(rulePrice(195, 0, amountRule(7)), 202);
  assert.equal(rulePrice(259.9, 0, pctRule(0, R("none"))), 259.9);
  assert.equal(rulePrice(259.9, 0, amountRule(0)), 259.9);
  assert.equal(rulePrice(185, 0, pctRule(10, R("10-up"))), 210);
  assert.equal(rulePrice(185.4, 0, pctRule(0, R("1-nearest"))), 185);
  assert.equal(rulePrice(195, 0, pctRule(7.5, R("none"))), 209.63, "kuruşa yuvarlı");
  assert.equal(rulePrice(100, 0, pctRule(-100, R("none"))), 0);
});

test("kural: önerilen fiyat yalnız yükseltir; reçetesiz (önerilen 0) değişmez", () => {
  assert.equal(rulePrice(190, 210, { kind: "suggested" }), 210);
  assert.equal(rulePrice(220, 210, { kind: "suggested" }), 220);
  assert.equal(rulePrice(150, 0, { kind: "suggested" }), 150);
});

test("yuvarlama: her seçenek, tam katlar olduğu gibi kalır", () => {
  const expect: Record<string, [number, number, number]> = {
    // [21250 kuruş, 21000 (tam kat), 21299]
    "5-up": [21500, 21000, 21500],
    "5-nearest": [21500, 21000, 21500],
    "5-down": [21000, 21000, 21000],
    "10-up": [22000, 21000, 22000],
    "1-nearest": [21300, 21000, 21300],
    none: [21250, 21000, 21299],
  };
  for (const r of ROUNDINGS) {
    const [a, b, c] = expect[r.id];
    assert.equal(roundMinor(21250, r.rounding), a, `${r.id} 212,50`);
    assert.equal(roundMinor(21000, r.rounding), b, `${r.id} 210 tam kat`);
    assert.equal(roundMinor(21299, r.rounding), c, `${r.id} 212,99`);
  }
  assert.equal(roundMinor(21249, R("5-nearest")), 21000);
  assert.equal(defaultRounding(10), "5-up");
  assert.equal(defaultRounding(-5), "5-down");
  assert.equal(defaultRounding(0), "5-up");
});

test("değişiklik alanı: %10, 10%, +10, -5, 7,5 okunur; harf ve tek % okunmaz; %100'den büyük indirim hata", () => {
  assert.deepEqual(parseRuleAmount("%10", "percent"), { value: 10, error: null });
  assert.deepEqual(parseRuleAmount("10%", "percent"), { value: 10, error: null });
  assert.deepEqual(parseRuleAmount("+10", "percent"), { value: 10, error: null });
  assert.deepEqual(parseRuleAmount("-5", "percent"), { value: -5, error: null });
  assert.deepEqual(parseRuleAmount("−5", "percent"), { value: -5, error: null }, "Unicode eksi");
  assert.deepEqual(parseRuleAmount("-%5", "percent"), { value: -5, error: null });
  assert.deepEqual(parseRuleAmount("7,5", "percent"), { value: 7.5, error: null });
  assert.deepEqual(parseRuleAmount(" 5 ₺ ", "amount"), { value: 5, error: null });
  assert.deepEqual(parseRuleAmount("", "percent"), { value: null, error: null }, "boş: önizleme bekler");
  assert.equal(parseRuleAmount("abc", "percent").value, null);
  assert.equal(parseRuleAmount("abc", "percent").error, "Sayı yazın (ör. 10 ya da -5)");
  assert.equal(parseRuleAmount("%", "percent").value, null);
  assert.deepEqual(parseRuleAmount("-120", "percent"), { value: null, error: "İndirim %100'den büyük olamaz" });
  assert.deepEqual(parseRuleAmount("-120", "amount"), { value: -120, error: null }, "tutarda sınır yok (0'ın altı satırda engellenir)");
});

// ---------------------------------------------------------------- Ekonomi

test("ekonomi: priceProduct'ın formülleri, Excel'in bütün ürünlerinde bugünkü fiyatla ve %10 zamla", () => {
  assert.ok(model.products.length >= 120);
  for (const p of model.products) {
    for (const price of [p.price, p.price * 1.1]) {
      const ref = priceProduct({ price, fireOverride: p.product.fireOverride }, p.lines, st);
      const got = economicsAt(price, p.cost, st);
      for (const k of ["net", "commission", "unitProfit", "margin", "costRatio"] as const) {
        assert.ok(Math.abs(got[k] - ref[k]) < 1e-9, `${p.key} ${price} ${k}: ${got[k]} ≠ ${ref[k]}`);
      }
      assert.equal(got.status, ref.status, `${p.key} ${price} durum`);
    }
  }
  // Fiyatı 0 reçeteli ürün zararına satılır ("Düşük kâr"), reçetesiz ürün "Reçete yok"
  assert.equal(economicsAt(0, 20, st).status, "Düşük kâr");
  assert.equal(economicsAt(150, 0, st).status, "Reçete yok");
});

// ---------------------------------------------------------------- Engeller

test("engel: 0'a inen, sitenin tavanı, kopuk ve sitede olmayan bağlantı, kurulmamış bağlantı; bağlı olmayan engellenmez", () => {
  const on = { siteConfigured: true };
  const off = { siteConfigured: false };
  assert.equal(blockReason({ newPrice: 0, site: null }, on), "Fiyat 0 ₺'ye ya da altına iner");
  assert.equal(blockReason({ newPrice: -5, site: "linked" }, on), "Fiyat 0 ₺'ye ya da altına iner");
  assert.equal(blockReason({ newPrice: 1_000_001, site: "linked" }, on), "Sitenin üst sınırını aşıyor");
  assert.equal(blockReason({ newPrice: 1_000_001, site: null }, on), null, "tavan yalnız sitede");
  assert.match(blockReason({ newPrice: 210, site: "broken" }, on) ?? "", /^Site bağlantısı kopuk/);
  assert.match(blockReason({ newPrice: 210, site: "missing" }, on) ?? "", /^Bağlı kalem sitede yok/);
  assert.match(blockReason({ newPrice: 210, site: "linked" }, off) ?? "", /^Site bağlantısı kurulmamış/);
  assert.match(blockReason({ newPrice: 210, site: "pending" }, off) ?? "", /kurulmamış/);
  assert.equal(blockReason({ newPrice: 210, site: null }, off), null, "bağlı olmayan ürün bağlantı kapalıyken de değişir");
  assert.equal(blockReason({ newPrice: 210, site: "linked" }, on), null);
  assert.equal(blockReason({ newPrice: 210, site: "pending" }, on), null, "liste henüz alınmadı: site yine sorulur");
});

// ---------------------------------------------------------------- Önizleme ve özet

const bulkRow = (over: Partial<BulkRow> & Pick<BulkRow, "id" | "price">): BulkRow => ({
  name: `Ürün ${over.id}`,
  size: "M",
  categoryId: 1,
  category: "Espresso Bazlı",
  active: true,
  cost: 40,
  suggestedPrice: 0,
  site: null,
  note: null,
  siteText: null,
  monthlyQty: 0,
  ...over,
});

test("önizleme: elle yazılan kuralı yener ve denetlenir; çıkarılan, aynı kalan ve engelli sayılmaz; aylık etki adetle", () => {
  const rows = [
    bulkRow({ id: 1, price: 195, monthlyQty: 100 }),
    bulkRow({ id: 2, price: 200, site: "linked", monthlyQty: 10 }),
    bulkRow({ id: 3, price: 210 }), // elle
    bulkRow({ id: 4, price: 150 }), // çıkarıldı
    bulkRow({ id: 5, price: 100, site: "broken" }),
    bulkRow({ id: 6, price: 50, cost: 0 }), // elle aynı fiyat
  ];
  const preview = previewRows(rows, pctRule(10), new Map([[3, 199], [6, 50]]), new Set([4]), st, { siteConfigured: true });
  const by = new Map(preview.map((p) => [p.id, p]));
  assert.equal(by.get(1)!.newPrice, 215);
  assert.equal(by.get(2)!.newPrice, 220);
  assert.equal(by.get(2)!.linked, true);
  assert.equal(by.get(3)!.newPrice, 199, "elle yazılan kuralı (235) yener");
  assert.equal(by.get(3)!.overridden, true);
  assert.equal(by.get(4)!.excluded, true);
  assert.equal(by.get(4)!.applicable, false);
  assert.match(by.get(5)!.blocked ?? "", /kopuk/);
  assert.equal(by.get(5)!.applicable, false);
  assert.equal(by.get(6)!.unchanged, true, "elle aynı fiyat: değişmez");
  assert.equal(by.get(6)!.applicable, false);
  // Aylık etki = birim kâr farkı × ayda satılan adet
  const d1 = (economicsAt(215, 40, st).unitProfit - economicsAt(195, 40, st).unitProfit) * 100;
  assert.ok(Math.abs(by.get(1)!.monthlyDelta - d1) < 1e-9);
  const sum = bulkSummary(preview);
  assert.equal(sum.count, 3, "1, 2, 3");
  assert.equal(sum.linked, 1);
  assert.equal(sum.decreases, 1, "3: 210 → 199");
  const expectPct = ((215 - 195) / 195 + (220 - 200) / 200 + (199 - 210) / 210) / 3;
  assert.ok(Math.abs((sum.avgPct ?? 0) - expectPct) < 1e-12);
  const d2 = (economicsAt(220, 40, st).unitProfit - economicsAt(200, 40, st).unitProfit) * 10;
  assert.ok(Math.abs(sum.monthlyDelta - (d1 + d2)) < 1e-9, "satılmayan ürünün etkisi 0");
  assert.ok(sum.ratioBefore !== null && sum.ratioAfter !== null && sum.ratioAfter < sum.ratioBefore);
  // Kural yokken yalnız elle yazılan değişir
  const idle = previewRows(rows, null, new Map([[3, 199]]), new Set(), st, { siteConfigured: true });
  assert.deepEqual(
    idle.filter((p) => p.applicable).map((p) => p.id),
    [3],
  );
  assert.equal(bulkSummary([]).avgPct, null);
});

test("özet: maliyet oranı ortalaması yalnız reçeteli satırlardan (menuAverages kuralı)", () => {
  const rows = [bulkRow({ id: 1, price: 100, cost: 30 }), bulkRow({ id: 2, price: 100, cost: 0 })];
  const sum = bulkSummary(previewRows(rows, amountRule(10), new Map(), new Set(), st, { siteConfigured: true }));
  assert.equal(sum.count, 2);
  assert.ok(Math.abs((sum.ratioBefore ?? 0) - economicsAt(100, 30, st).costRatio) < 1e-12);
  assert.ok(Math.abs((sum.ratioAfter ?? 0) - economicsAt(110, 30, st).costRatio) < 1e-12);
});

// ---------------------------------------------------------------- Metinler

test("kuralın metni: yüzde, tutar, önerilen; kategoriler ve boy; 200 karakter ve '… +3 kategori'", () => {
  assert.equal(ruleText(pctRule(10)), "+%10 · 5 ₺'ye yukarı");
  assert.equal(ruleText(pctRule(-7.5, R("5-down"))), "−%7,5 · 5 ₺'ye aşağı");
  assert.equal(ruleText(amountRule(5)), "+5 ₺ · yuvarlama yok");
  assert.equal(ruleText({ kind: "suggested" }), "Önerilen fiyata");
  assert.equal(ruleSummary(pctRule(10), { categories: ["Espresso Bazlı", "Buzlu Kahveler"], size: null }), "+%10 · 5 ₺'ye yukarı · Espresso Bazlı, Buzlu Kahveler");
  assert.equal(ruleSummary(amountRule(5), { categories: [], size: null }), "+5 ₺ · yuvarlama yok");
  assert.equal(ruleSummary({ kind: "suggested" }, { categories: [], size: "L" }, 2), "Önerilen fiyata · Large · 2 fiyat elle");
  const many = Array.from({ length: 20 }, (_, i) => `Uzun kategori adı ${i + 1}`);
  const long = ruleSummary(pctRule(10), { categories: many, size: "M" });
  assert.ok(long.length <= 200, `${long.length} karakter`);
  assert.match(long, /^\+%10 · 5 ₺'ye yukarı · Uzun kategori adı 1, /);
  assert.match(long, / … \+\d+ kategori · Medium$/);
  const shown = (long.match(/Uzun kategori adı/g) ?? []).length;
  assert.equal(Number(/\+(\d+) kategori/.exec(long)![1]) + shown, 20, "gösterilen + sayılan = hepsi");
});

test("iyelik eki: 12'si, 10'u, 3'ü, 6'sı, 40'ı, 100'ü, 1'i", () => {
  const cases: [number, string][] = [
    [1, "1'i"],
    [2, "2'si"],
    [3, "3'ü"],
    [4, "4'ü"],
    [5, "5'i"],
    [6, "6'sı"],
    [7, "7'si"],
    [8, "8'i"],
    [9, "9'u"],
    [10, "10'u"],
    [12, "12'si"],
    [20, "20'si"],
    [30, "30'u"],
    [40, "40'ı"],
    [50, "50'si"],
    [60, "60'ı"],
    [70, "70'i"],
    [80, "80'i"],
    [90, "90'ı"],
    [100, "100'ü"],
    [110, "110'u"],
    [0, "0'ı"],
  ];
  for (const [n, s] of cases) assert.equal(numPossessive(n), s);
});

test("site kapalı mı: ağ, zaman aşımı, kurulmamış, 401 ve 5xx evet; 400 ve 404 hayır (ürüne özgü)", () => {
  assert.equal(isSiteDown({ kind: "network" }), true);
  assert.equal(isSiteDown({ kind: "timeout" }), true);
  assert.equal(isSiteDown({ kind: "off" }), true);
  assert.equal(isSiteDown({ kind: "http", status: 401 }), true);
  assert.equal(isSiteDown({ kind: "http", status: 503 }), true);
  assert.equal(isSiteDown({ kind: "http", status: 500 }), true);
  assert.equal(isSiteDown({ kind: "http", status: 400, field: "priceMinor" }), false);
  assert.equal(isSiteDown({ kind: "http", status: 404 }), false);
});

test("sitenin hatasının nedeni UserError'ın cause'undan okunur; nedensiz hata null", () => {
  assert.deepEqual(pushFailureOf(new Error("x", { cause: { kind: "timeout" } })), { kind: "timeout" });
  assert.deepEqual(pushFailureOf(new Error("x", { cause: { kind: "http", status: 503 } })), { kind: "http", status: 503, field: null });
  assert.equal(pushFailureOf(new Error("Fiyat bu sırada değişti")), null);
  assert.equal(pushFailureOf(new Error("x", { cause: { code: "23505" } })), null);
  assert.equal(pushFailureOf("metin"), null);
});

// ---------------------------------------------------------------- Siteye yazım sırası (runSiteGroups, sahte yazımla)

const OK: SiteWriteOutcome = { ok: true };
const down503: SiteWriteOutcome = { ok: false, reason: "Site yanıt vermedi (503)", failure: { kind: "http", status: 503 } };
const tick = () => new Promise<void>((r) => setImmediate(r));

/** Sahte yazım: her satır `ticks` tur sürer; başlayan (+), biten (-) ve aynı anda yolda olan satırlar kaydedilir */
function fakeWriter(outcomes: Record<string, SiteWriteOutcome> = {}, ticks: number | ((id: string) => number) = 3) {
  const log: string[] = [];
  const inFlight = new Set<string>();
  let maxInFlight = 0;
  const write = async (id: string) => {
    log.push(`+${id}`);
    inFlight.add(id);
    maxInFlight = Math.max(maxInFlight, inFlight.size);
    const n = typeof ticks === "number" ? ticks : ticks(id);
    for (let i = 0; i < n; i++) await tick();
    inFlight.delete(id);
    log.push(`-${id}`);
    return outcomes[id] ?? OK;
  };
  return { write, log, max: () => maxInFlight };
}

const reasons = (failed: { item: string; reason: string }[]) => Object.fromEntries(failed.map((f) => [f.item, f.reason]));

test("site sırası: gruplar en çok dörder birlikte, grubun içi (aynı kalemin M ve L'si) sırayla, hiç üst üste binmez", async () => {
  const w = fakeWriter();
  const groups = Array.from({ length: 7 }, (_, g) => [`k${g}-M`, `k${g}-L`]);
  const r = await runSiteGroups(groups, w.write, { concurrency: 4, deadline: Infinity });
  assert.deepEqual(r, { failed: [], siteDown: false });
  assert.equal(w.max(), 4, "dört kalem birlikte, beşincisi beklemede");
  for (const [m, l] of groups) {
    assert.ok(w.log.indexOf(`-${m}`) < w.log.indexOf(`+${l}`), `${l}, ${m} bitmeden başladı`);
  }
  assert.equal(w.log.filter((x) => x.startsWith("+")).length, 14, "her satır bir kez");
  // Az grup: işçi sayısı grup sayısını geçmez, boş liste hemen döner
  assert.deepEqual(await runSiteGroups([], w.write, { concurrency: 4, deadline: Infinity }), { failed: [], siteDown: false });
});

test("devre kesici: 503 ve zaman aşımı sıradakileri göndermez (denenmedi), yoldakiler biter; 400, 404 ve değişmiş fiyat sürdürür", async () => {
  // a1 ve b1 birlikte başlar; a1 503 döner, o sırada yoldaki b1 biter (yazıldı); a2, b2 ve hiç başlamamış c1 gönderilmez
  const w = fakeWriter({ a1: down503 }, (id) => (id === "b1" ? 5 : 1));
  const r = await runSiteGroups([["a1", "a2"], ["b1", "b2"], ["c1"]], w.write, { concurrency: 2, deadline: Infinity });
  assert.equal(r.siteDown, true);
  assert.deepEqual(reasons(r.failed), { a1: "Site yanıt vermedi (503)", a2: NOT_TRIED_DOWN, c1: NOT_TRIED_DOWN, b2: NOT_TRIED_DOWN });
  assert.deepEqual(w.log, ["+a1", "+b1", "-a1", "-b1"], "b1 a1 düşerken yoldaydı ve bitti; kapalı siteye yeni istek gitmedi");

  for (const failure of [{ kind: "timeout" }, { kind: "network" }, { kind: "off" }, { kind: "http", status: 401 }] as const) {
    const t = fakeWriter({ x1: { ok: false, reason: "kapalı", failure } }, 0);
    const out = await runSiteGroups([["x1"], ["x2"]], t.write, { concurrency: 1, deadline: Infinity });
    assert.equal(out.siteDown, true, failure.kind);
    assert.deepEqual(reasons(out.failed), { x1: "kapalı", x2: NOT_TRIED_DOWN }, failure.kind);
  }

  // Ürüne özgü hatalar sırayı durdurmaz: aynı kalemin öteki boyu ve öteki kalemler yazılır
  const own = fakeWriter(
    {
      y1: { ok: false, reason: "Sitede bu kalem yok (404)", failure: { kind: "http", status: 404 } },
      z1: { ok: false, reason: "Geçersiz fiyat (400)", failure: { kind: "http", status: 400, field: "priceMinor" } },
      q1: { ok: false, reason: "Fiyat bu sırada değişti (şimdi 210 ₺); listeyi yenileyip tekrar dene", failure: null },
    },
    0,
  );
  const out = await runSiteGroups([["y1", "y2"], ["z1"], ["q1", "q2"]], own.write, { concurrency: 2, deadline: Infinity });
  assert.equal(out.siteDown, false);
  assert.deepEqual(Object.keys(reasons(out.failed)).sort(), ["q1", "y1", "z1"]);
  assert.ok(own.log.includes("-y2") && own.log.includes("-q2"), "devre kesici açılmadı, öteki satırlar yazıldı");
});

test("süre: sınırdan sonra yeni satır başlamaz (Süre doldu; denenmedi), sınırdan önce başlayan biter", async () => {
  let clock = 0;
  const started: string[] = [];
  const write = async (id: string) => {
    started.push(id);
    await tick();
    clock += 15_000; // her yazım 15 sn sürer
    return OK;
  };
  const r = await runSiteGroups([["d1"], ["d2"], ["d3", "d3-L"], ["d4"]], write, { concurrency: 1, deadline: 40_000, now: () => clock });
  // d1 0 sn, d2 15 sn, d3 30 sn'de başlar (45 sn'de biter); 45 sn'de sıradaki aynı kalemin L'si de dahil başlamaz
  assert.deepEqual(started, ["d1", "d2", "d3"]);
  assert.deepEqual(reasons(r.failed), { "d3-L": NOT_TRIED_LATE, d4: NOT_TRIED_LATE });
  assert.equal(r.siteDown, false);
});

// ---------------------------------------------------------------- Kasa (ModPOS)

test("kasa: güncel kasa eski fiyatı tutar; kasadaki fiyata dönen fiyat listeden düşer; ilk geri kalış korunur", () => {
  const t1 = new Date("2026-10-20T10:00:00Z");
  const t2 = new Date("2026-10-22T10:00:00Z");
  assert.deepEqual(posAfterPriceChange({ stalePrice: null, since: null }, 195, 205, t1), { stalePrice: 195, since: t1 });
  assert.deepEqual(posAfterPriceChange({ stalePrice: 195, since: t1 }, 205, 195, t2), { stalePrice: null, since: null }, "geri alındı");
  assert.deepEqual(posAfterPriceChange({ stalePrice: 195, since: t1 }, 205, 210, t2), { stalePrice: 195, since: t1 }, "kasa hâlâ 195, ilk an korunur");
  assert.deepEqual(posAfterPriceChange({ stalePrice: 195, since: t1 }, 205, 195.004, t2), { stalePrice: null, since: null }, "kuruşuyla eşit");
  assert.deepEqual(posAfterPriceChange({ stalePrice: null, since: null }, 195, 195.001, t1), { stalePrice: null, since: null });
});

test("bildirim metni: sitede de değiştiyse tarih ve kasa; yalnız panelde kasa; kasada bekleyen yoksa kasa yazılmaz", () => {
  assert.equal(
    priceReminder({ site: true, posPending: true }),
    "Fiyat sitede de değişti. Fiyat listesinin tarihini sitede (Ayarlar → Vergi) güncellemeyi unutma; kasadaki (ModPOS) fiyat Fiyatlar › Kasaya işle listesinde.",
  );
  assert.equal(priceReminder({ site: true, posPending: false }), "Fiyat sitede de değişti. Fiyat listesinin tarihini sitede (Ayarlar → Vergi) güncellemeyi unutma.");
  assert.equal(priceReminder({ site: true, posPending: true }), PRICE_PUSH_REMINDER, "site menüsünün hatırlatmasıyla tek metin");
  assert.equal(priceReminder({ site: false, posPending: true }), POS_PRICE_REMINDER);
  assert.equal(POS_PRICE_REMINDER, "Kasadaki (ModPOS) fiyatı da değiştir; Fiyatlar › Kasaya işle listesine eklendi.");
  assert.equal(priceReminder({ site: false, posPending: false }), null);
});

test("toplu değişikliğin kasa cümlesi: kasada değişecek varsa liste; geri almada kalmadıysa yalnız bu fiyatları anlatır", () => {
  const a = (posPending: boolean) => ({ posPending });
  assert.equal(batchPosNote("bulk", [a(true), a(false)]), "Kasadaki (ModPOS) fiyatlar Kasaya işle listesinde.");
  assert.equal(batchPosNote("bulk", [a(false)]), undefined);
  assert.equal(batchPosNote("undo", [a(false), a(true)]), "Kasadaki (ModPOS) fiyatlar Kasaya işle listesinde.", "kasadaki fiyat önceki değişiklikten de kalmış olabilir");
  assert.equal(
    batchPosNote("undo", [a(false), a(false)]),
    "Bu fiyatlar kasada (ModPOS) henüz değişmemişti; kasada bir şey yapmanız gerekmez.",
    "kasa henüz değişmemişti: geri alınan fiyatlar kasadakine döndü",
  );
  assert.equal(batchPosNote("undo", [a(false)]), "Bu fiyat kasada (ModPOS) henüz değişmemişti; kasada bir şey yapmanız gerekmez.");
  assert.equal(batchPosNote("undo", []), undefined);
  // Kasaya işle listesinde başka ürünler bekliyor olabilir: cümle bütün kasayı anlatmaz ("kalmadı" demez)
  assert.doesNotMatch(batchPosNote("undo", [a(false)])!, /kalmadı/);
});

test("kasada işaretleme: yalnız fiyatı hâlâ görülen fiyat olan işaretlenir; bu arada değişen bugünkü fiyatıyla kalır", () => {
  const rows = [
    { id: 1, price: 270 },
    { id: 2, price: 280 },
    { id: 3, price: 199.999 },
  ];
  // 1 listede 270 görüldü, hâlâ 270; 2 listede 270 görüldü ama bu arada 280 oldu (kasaya 270 yazıldı); 3 kuruşuyla eşit
  const seen = new Map([
    [1, 270],
    [2, 270],
    [3, 200],
    [4, 150],
  ]);
  const split = splitPosDone(rows, seen);
  assert.deepEqual(
    split.done.map((r) => r.id),
    [1, 3],
  );
  assert.deepEqual(
    split.changed.map((r) => r.id),
    [2],
  );
  assert.deepEqual(splitPosDone(rows, new Map()), { done: [], changed: [] }, "görülmeyen satır işaretlenmez");
  assert.deepEqual(posChangedText([{ label: "Lemon Tea M", price: 280 }]), {
    title: "Lemon Tea M işaretlenmedi: fiyatı bu sırada 280\u00a0₺ oldu",
    description: "Kasaya bu fiyatı yazıp yeniden işaretleyin.",
  });
  assert.equal(posChangedText([{ label: "A", price: 1 }, { label: "B", price: 2 }])?.title, "2 fiyat işaretlenmedi: bu sırada yeniden değişti");
  assert.equal(posChangedText([]), null);
});

test("kasaya işle işaretinin geri alınması (dalga 10 §2.2): personel yalnız kendi işaretini 30 dakika içinde; son işaret; listeye dönen ya da fiyatı kasadakine dönen ürün", () => {
  assert.equal(POS_UNDO_WINDOW_MS, 30 * 60_000);
  assert.equal(posMarkMax("staff"), 1);
  assert.equal(posMarkMax("admin"), 500);
  const at = new Date("2026-10-22T11:00:00Z");
  const mark = { id: 7, markedBy: 2, markedAt: at.toISOString(), undoneAt: null, price: 205, stalePrice: 195 };
  const product = { price: 205, posStalePrice: null };
  const staff = (min: number, meId = 2) => ({ role: "staff" as const, meId, now: new Date(at.getTime() + min * 60_000) });
  const admin = (min: number) => ({ role: "admin" as const, meId: 1, now: new Date(at.getTime() + min * 60_000) });
  // Kendi işareti, 29 dakika: geri alınır; 30 dakika ve sonrası yöneticiye
  assert.equal(posUndoRefusal(staff(29), mark, product, 7), null);
  assert.equal(posUndoRefusal(staff(30), mark, product, 7), POS_UNDO_TEXT.late);
  // Başkasının işareti
  assert.equal(posUndoRefusal(staff(1, 3), mark, product, 7), POS_UNDO_TEXT.notMine);
  // Yönetici: süre ve kişi sınırı yok
  assert.equal(posUndoRefusal(admin(60 * 24 * 10), mark, product, 7), null);
  // Zaten geri alınmış (önce bu söylenir)
  assert.equal(posUndoRefusal(staff(40, 3), { ...mark, undoneAt: at.toISOString() }, product, 7), POS_UNDO_TEXT.undone);
  assert.equal(posUndoRefusal(admin(1), { ...mark, undoneAt: at.toISOString() }, product, 7), POS_UNDO_TEXT.undone);
  // Ürün listeye yeniden girdi (yeni fiyat): geri alınmaz, yeni fiyat işaretlenir
  assert.equal(posUndoRefusal(admin(1), mark, { price: 215, posStalePrice: 205 }, 7), POS_UNDO_TEXT.relisted);
  // Fiyat kasadaki eski fiyata döndü
  assert.equal(posUndoRefusal(admin(1), mark, { price: 195, posStalePrice: null }, 7), POS_UNDO_TEXT.reverted);
  // Sonra yeniden işaretlendi (M1 → fiyat değişti → M2): M1 geri alınmaz; güncel fiyat işaretin fiyatı değilse de
  assert.equal(posUndoRefusal(admin(1), mark, product, 9), POS_UNDO_TEXT.notLatest);
  assert.equal(posUndoRefusal(admin(1), mark, { price: 210, posStalePrice: null }, 7), POS_UNDO_TEXT.notLatest);
  assert.equal(POS_UNDO_TEXT.notLatest, "Bu ürün sonra yeniden işaretlendi; son işareti geri alın");
  // Ürün silinmiş
  assert.equal(posUndoRefusal(admin(1), mark, null, null), POS_UNDO_TEXT.gone);
  // Metinlerde tutar yok
  for (const t of Object.values(POS_UNDO_TEXT)) assert.doesNotMatch(t, /₺/);
});

const posItem = (over: Partial<PosItem> & Pick<PosItem, "productId" | "name">): PosItem => ({
  size: "M",
  category: "Espresso Bazlı",
  categoryOrder: 1,
  sortOrder: over.productId,
  posNames: [],
  stalePrice: 195,
  price: 205,
  ...over,
});

test("kasa metni: başlıkta gün, kategori menü sırasıyla, kasadaki ad varsa o, yoksa panelin adı ve boyu", () => {
  const items = [
    posItem({ productId: 9, name: "Marlenka", size: "Tek", category: "Tatlılar", categoryOrder: 12, stalePrice: 270, price: 285 }),
    posItem({ productId: 2, name: "Latte", posNames: ["LATTE MEDİUM"] }),
    posItem({ productId: 1, name: "Americano", posNames: ["AMERICANO M", "AMERİKANO"], stalePrice: 259.9, price: 269.9 }),
  ];
  assert.equal(
    posChecklistText(items, "2026-10-22"),
    [
      "Kasada (ModPOS) değişecek fiyatlar · 22 Ekim 2026",
      "Espresso Bazlı",
      "- AMERICANO M / AMERİKANO: 259,90 → 269,90 ₺",
      "- LATTE MEDİUM: 195 → 205 ₺",
      "Tatlılar",
      "- Marlenka (Tek): 270 → 285 ₺",
    ].join("\n"),
  );
  assert.deepEqual(
    groupByCategory(items).map((g) => [g.category, g.items.map((i) => i.productId)]),
    [
      ["Espresso Bazlı", [1, 2]],
      ["Tatlılar", [9]],
    ],
  );
});

// ---------------------------------------------------------------- Geçmiş

const hist = (over: Partial<HistoryRow> & Pick<HistoryRow, "id" | "productId" | "changedAt">): HistoryRow => ({
  name: `Ürün ${over.productId}`,
  size: "M",
  priceBefore: 195,
  price: 205,
  source: "manual",
  onSite: false,
  batchId: null,
  note: null,
  changedBy: "Selin",
  ...over,
});

test("sitenin yazdığı değişiklik: yalnız fiyat değiştiyse ve satır yazıldıysa geçmişe girer; yalnız menü durumu girmez", () => {
  const before = { price: 195, active: true, showOnMenu: true };
  assert.deepEqual(sitePriceRecord({ productId: 7, set: { price: 205 }, before }, true, "laffogato.net"), {
    productId: 7,
    before: 195,
    after: 205,
    source: "site",
    changedBy: "laffogato.net",
  });
  assert.equal(sitePriceRecord({ productId: 7, set: { showOnMenu: false }, before }, true, "laffogato.net"), null, "Tükendi");
  assert.equal(sitePriceRecord({ productId: 7, set: { active: true, showOnMenu: true }, before }, true, "laffogato.net"), null, "Satışta");
  assert.equal(sitePriceRecord({ productId: 7, set: { price: 205 }, before }, false, "laffogato.net"), null, "arada bağlantısı değişen satıra yazılmadı");
  assert.deepEqual(sitePriceRecord({ productId: 7, set: { price: 205, showOnMenu: false }, before }, true, "laffogato.net")?.after, 205);
});

test("sitenin çekmesi (planMenuSync → applyPlan): yalnız menü durumu değişen kalem geçmişe girmez, fiyatı değişen girer", () => {
  const row = (over: Partial<LinkedRow> = {}): LinkedRow => ({
    id: 7,
    name: "Latte",
    size: "M",
    price: 195,
    active: true,
    showOnMenu: true,
    siteMenuId: "mnu-0007",
    siteMenuSlot: "M",
    ...over,
  });
  const item = (over: Partial<SiteMenuItem> = {}): SiteMenuItem => ({
    id: "mnu-0007",
    name: "Latte",
    categoryKey: "espresso",
    categoryLabel: "Espresso",
    priceMinor: 19500,
    priceMinorL: 21000,
    isActive: true,
    sortOrder: 3,
    updatedAt: "2026-10-20T08:00:00.000Z",
    ...over,
  });
  // applyPlan her değişiklikte sitePriceRecord'u sorar (satır yazıldıysa)
  const records = (items: SiteMenuItem[], rows: LinkedRow[]) => {
    const plan = planMenuSync(items, rows);
    return { changes: plan.changes.length, records: plan.changes.map((c) => sitePriceRecord(c, true, "laffogato.net")) };
  };
  // Tükendi: QR menüden kalkar (satır değişir), fiyat aynı: geçmişe bir şey yazılmaz
  const soldOut = records([item({ isActive: false })], [row()]);
  assert.equal(soldOut.changes, 1);
  assert.deepEqual(soldOut.records, [null]);
  // Satışta: active ve QR menü açılır; yine geçmiş yok
  const back = records([item()], [row({ active: false, showOnMenu: false })]);
  assert.equal(back.changes, 1);
  assert.deepEqual(back.records, [null]);
  // Fiyat değişti (Tükendi ile birlikte de): tek satır, kaynağı site
  assert.deepEqual(records([item({ priceMinor: 20500 })], [row()]).records, [{ productId: 7, before: 195, after: 205, source: "site", changedBy: "laffogato.net" }]);
  assert.equal(records([item({ priceMinor: 20500, isActive: false })], [row()]).records[0]?.after, 205);
  // Kuruşu aynı fiyat değişiklik sayılmaz
  assert.equal(records([item()], [row({ price: 195.004 })]).changes, 0);
});

test("geçmiş: toplu değişiklik tek kayıt, en yeni önce, gün Türkiye saatiyle (23:30 UTC ertesi gün)", () => {
  const rows = [
    hist({ id: 1, productId: 1, changedAt: "2026-10-21T09:00:00.000Z" }),
    hist({ id: 2, productId: 2, changedAt: "2026-10-21T23:30:00.000Z", source: "bulk", batchId: "b1", note: "+%10 · 5 ₺'ye yukarı", onSite: true }),
    hist({ id: 3, productId: 3, changedAt: "2026-10-21T23:30:01.000Z", source: "bulk", batchId: "b1", note: "+%10 · 5 ₺'ye yukarı" }),
    hist({ id: 4, productId: 4, changedAt: "2026-10-22T08:00:00.000Z", source: "site", changedBy: "laffogato.net" }),
  ];
  const g = groupHistory(rows);
  assert.deepEqual(
    g.map((e) => (e.kind === "batch" ? `batch:${e.batchId}:${e.rows.length}:${e.onSite}` : `single:${e.row.id}`)),
    ["single:4", "batch:b1:2:1", "single:1"],
  );
  assert.deepEqual(
    g.map((e) => e.day),
    ["2026-10-22", "2026-10-22", "2026-10-21"],
    "23:30 UTC = 02:30 Türkiye: ertesi gün",
  );
  const batch = g[1];
  assert.ok(batch.kind === "batch");
  assert.equal(batch.note, "+%10 · 5 ₺'ye yukarı");
  assert.equal(batch.changedAt, "2026-10-21T23:30:01.000Z");
  assert.equal(historyDayLabel("2026-10-22", "2026-10-22"), "Bugün");
  assert.equal(historyDayLabel("2026-10-21", "2026-10-22"), "Dün");
  assert.equal(historyDayLabel("2026-10-02", "2026-10-22"), "2 Eki 2026");
  assert.equal(timeTR("2026-10-21T23:30:00.000Z"), "02:30");
  assert.deepEqual(Object.keys(PRICE_SOURCE_LABEL).sort(), ["bulk", "create", "manual", "site", "suggestion", "undo"]);
});

test("geri alma: hâlâ toplu fiyatındaki ürün döner; sonradan değişen, geri alınmış ve silinmiş atlanır", () => {
  const row = (id: number, productId: number, priceBefore: number, price: number, at = "2026-10-21T10:00:00.000Z") => ({
    id,
    productId,
    label: `Ürün ${productId}`,
    priceBefore,
    price,
    changedAt: at,
  });
  const plan = undoPlan(
    [row(1, 1, 195, 215), row(2, 2, 200, 220), row(3, 3, 150, 165), row(4, 4, 100, 110), row(5, 5, 50, 55)],
    new Map([
      [1, 215],
      [2, 210],
      [3, 150],
      [5, 55.004],
    ]),
  );
  assert.deepEqual(plan.revert, [
    { productId: 1, label: "Ürün 1", from: 215, to: 195 },
    { productId: 5, label: "Ürün 5", from: 55.004, to: 50 },
  ]);
  assert.deepEqual(
    plan.skipped.map((s) => [s.productId, s.kind, s.reason]),
    [
      [2, "changed", "Sonradan değişti (şimdi 210\u00a0₺)"],
      [3, "reverted", "Zaten eski fiyatında"],
      [4, "deleted", "Ürün silinmiş"],
    ],
  );
  // Aynı üründe iki satır ("Tekrar dene"): son satırın fiyatı aranır, ilk satırın eski fiyatına dönülür
  const dup = undoPlan([row(1, 1, 195, 210, "2026-10-21T10:00:00.000Z"), row(9, 1, 210, 215, "2026-10-21T10:05:00.000Z")], new Map([[1, 215]]));
  assert.deepEqual(dup.revert, [{ productId: 1, label: "Ürün 1", from: 215, to: 195 }]);
  assert.equal(undoPlan([row(1, 1, 195, 210, "2026-10-21T10:00:00.000Z"), row(9, 1, 210, 215, "2026-10-21T10:05:00.000Z")], new Map([[1, 210]])).revert.length, 0);
  // Hiçbir şey dönmüyorsa nedeni
  assert.equal(nothingToUndoText(undoPlan([row(1, 1, 195, 215)], new Map([[1, 195]]))), "Bu değişiklik zaten geri alınmış");
  assert.match(nothingToUndoText(undoPlan([row(1, 1, 195, 215)], new Map([[1, 230]]))), /sonradan değişmiş/);
});

// ---------------------------------------------------------------- Ekranın süzgeçleri

test("süzgeçler: kategori listesi, boy, arama (boyun adı da), pasifler yalnız istenince; Toplu fiyat bağlantısı", () => {
  assert.deepEqual(parseCategoryParam("3,5,x,3,-1"), [3, 5]);
  assert.deepEqual(parseCategoryParam(null), []);
  assert.equal(parseSizeParam("L"), "L");
  assert.equal(parseSizeParam("XL"), null);
  const rows = [
    { name: "Latte", size: "M", category: "Espresso Bazlı", categoryId: 1, active: true, note: "8oz bardak", siteText: "Sitede" },
    { name: "Latte", size: "L", category: "Espresso Bazlı", categoryId: 1, active: true, note: null, siteText: "Bağlı değil" },
    { name: "Mocha", size: "L", category: "Espresso Bazlı", categoryId: 1, active: false, note: null, siteText: null },
    { name: "Marlenka", size: "Tek", category: "Tatlılar", categoryId: 12, active: true, note: null, siteText: "Bağlı değil" },
  ];
  const f = { categories: [] as number[], size: null, q: "", includeInactive: false };
  assert.equal(filterBulkRows(rows, f).length, 3, "pasif varsayılan dışarıda (D5)");
  assert.equal(filterBulkRows(rows, { ...f, includeInactive: true }).length, 4);
  assert.deepEqual(
    filterBulkRows(rows, { ...f, categories: [12] }).map((r) => r.name),
    ["Marlenka"],
  );
  assert.equal(filterBulkRows(rows, { ...f, size: "L", includeInactive: true }).length, 2);
  assert.equal(filterBulkRows(rows, { ...f, q: "latte large" }).length, 1, "boyun görünen adı");
  assert.equal(filterBulkRows(rows, { ...f, q: "tatli" }).length, 1, "kategori, aksansız");
  // Ürün listesiyle aynı arama metni (not ve site işareti de): "Toplu fiyat" listenin gösterdiği ürünlerle açılır
  assert.equal(filterBulkRows(rows, { ...f, q: "8oz" }).length, 1, "not");
  assert.equal(filterBulkRows(rows, { ...f, q: "bağlı değil" }).length, 2, "site işareti");
  const table = read("src/app/panel/urunler/products-table.tsx");
  assert.match(table, /const searchText = \(r: ProductRow\) => productSearchText\(\{ \.\.\.r, siteText: r\.site\?\.text \}\);/);
  // Arama yalnız pasiflerle eşleştiği için listenin gösterdiği pasifler de gider (includeInactive, showInactive değil)
  assert.match(table, /bulkHref\(\{ categoryId: category, size, q, includeInactive \}\)/);
  assert.equal(productSearchText({ name: "Latte", size: "L", category: "Espresso Bazlı" }), "Latte L Large Espresso Bazlı  ");
  assert.equal(bulkHref({}), "/panel/urunler/fiyatlar");
  assert.equal(bulkHref({ categoryId: 3, size: "L", q: " latte ", includeInactive: true }), "/panel/urunler/fiyatlar?kategori=3&boy=L&ara=latte&pasif=1");
  assert.equal(tabOf("kasa"), "kasa");
  assert.equal(tabOf(undefined), "toplu");
  assert.equal(tabHref("gecmis"), "/panel/urunler/fiyatlar?sekme=gecmis");
  assert.equal(tabHref("toplu", "kategori=3"), "/panel/urunler/fiyatlar?kategori=3");
});

// ---------------------------------------------------------------- Sunucu kuralları (kaynaktan)

test("satış fiyatını yazan her yol geçmişe ve kasanın durumuna yazar", () => {
  const products = read("src/server/actions/products.ts");
  const price = products.slice(products.indexOf("export async function updateProductPrice"), products.indexOf("async function updatePriceAck"));
  // Tek fiyat yazımı toplu değişikliğin tek ürün yoluyla aynı (writeSalePrice: geçmiş ve kasa aynı işlemde)
  assert.match(price, /writeSalePrice\(me, before, p, \{ source: from, consequence: "fiyat değişmedi", expectFrom: seen \}\)/);
  // Kaynak: zam önerisinin "Fiyatı X yap"ı iki dayanakta da (zammın payı ve hedef oran) "Zam önerisi", Geri al'ı elle
  assert.match(price, /const from = ack \? "suggestion" : z\.enum\(\["manual", "suggestion"\]\)\.parse\(source\);/);
  const impact = read("src/app/panel/urunler/price-impact-panel.tsx");
  assert.match(impact, /updateProductPrice\(i\.productId, i\.suggestedPrice, i\.basis === "keep", "suggestion", i\.price\)/);
  assert.match(impact, /updateProductPrice\(i\.productId, i\.price, false, "manual", r\.data\.price\)\s*\.then/, "önerinin Geri al'ı elle");
  assert.match(read("src/app/panel/urunler/products-table.tsx"), /updateProductPrice\(row\.id, v, false, "manual", last\)/, "fiyat hücresi elle");
  const write = read("src/server/prices/write.ts");
  assert.match(write, /recordPriceChange\(\s*tx,/);
  assert.ok(write.indexOf("getDb().transaction(") < write.indexOf(".update(s.products)"), "yerel yazım da işlemde");
  const save = products.slice(products.indexOf("export async function saveRecipe"), products.indexOf("export async function deleteProduct"));
  assert.match(save, /recordPriceChange\(\s*tx,/);
  const create = read("src/server/data/product-create.ts");
  assert.match(create, /recordPriceChange\(tx, \{ productId: created\.id, before: null, after: data\.price, source: "create", changedBy: opts\.changedBy \}, new Date\(\), \{ pos: false \}\)/);
  assert.match(create, /if \(data\.price > 0\)/);
  const sync = read("src/server/site-menu/sync.ts");
  const apply = sync.slice(sync.indexOf("export async function applyPlan"), sync.indexOf("export interface AppliedList"));
  assert.match(apply, /\.returning\(\{ id: s\.products\.id \}\)/);
  assert.match(apply, /sitePriceRecord\(c, updated\.length > 0, SITE_ACTOR\.name\)/);
  assert.match(apply, /if \(record\) await recordPriceChange\(tx, record, now\)/);
  assert.match(read("src/server/prices/write.ts"), /recordPriceChange\(\s*tx,/);
  assert.match(read("src/server/prices/batch.ts"), /await recordPriceChange\(\s*tx,/);
  // Ürün satırını güncelleyen her dosya ya geçmişe yazar ya da fiyata hiç dokunmaz: yeni bir yol geçmişi atlamasın
  const walk = (dir: string): string[] =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []));
  const updaters = walk("src").filter((f) => read(f).includes(".update(s.products)"));
  const noPrice = ["src/server/actions/recipe-requests.ts", "src/server/site-menu/link.ts", "src/server/actions/prices.ts", "src/server/site-menu/sold-out-core.ts"];
  for (const f of updaters) {
    if (noPrice.includes(f)) {
      for (const m of read(f).matchAll(/\.update\(s\.products\)\s*\.set\(\{([^}]*)\}/g)) assert.doesNotMatch(m[1], /\bprice\b|\.\.\./, `${f}: fiyat yazıyor`);
    } else assert.match(read(f), /recordPriceChange\(/, `${f}: ürün fiyatını yazıyor ama geçmişe yazmıyor`);
  }
  assert.ok(updaters.length >= 6, updaters.join(", "));
  // Kasanın durumu şube başına (pos_stale; şube kapsamı A3): yalnız fiyat yazımı (record.ts) ve işaretler (pos-marks.ts)
  // yazar; ürünün eski pos_stale_* sütunlarını hiçbir dosya okumaz ya da yazmaz
  const staleWriters = walk("src").filter((f) => /\.(insert|update|delete)\(s\.posStale\)|\.(insert|delete|update)\(ps\)/.test(read(f)));
  assert.deepEqual(staleWriters.sort(), ["src/server/prices/pos-marks.ts", "src/server/prices/record.ts"]);
  for (const f of walk("src").filter((x) => x !== "src/server/db/schema.ts")) assert.doesNotMatch(read(f), /products\.posStale(Price|Since)\b|pos_stale_(price|since)/, f);
});

test("panel → site yazımı: önce site, sonra tek işlemde yazım ve geçmiş; sitenin hatası nedeniyle", () => {
  const write = read("src/server/prices/write.ts");
  assert.ok(write.indexOf("pushSaleChange(") > 0 && write.indexOf("pushSaleChange(") < write.indexOf(".update(s.products)"), "önce site");
  assert.ok(write.indexOf("expectFrom") < write.indexOf("pushSaleChange("), "değişen fiyat siteye gitmeden durur");
  assert.match(write, /applyPushed\(tx, push, before, desired, now\)/);
  const push = read("src/server/site-menu/push.ts");
  assert.match(push, /\{ cause: \{ kind: "off" \} \}/);
  assert.match(push, /\{ cause: e\.failure \}/);
  assert.match(push, /const failure: PushFailure = \{ kind: "http", status: res\.status, field: errorField\(res\.json\), error: errorCode\(res\.json\) \};/);
  assert.match(push, /throw new UserError\(pushFailureMessage\(failure, consequence\), \{ cause: failure \}\);/);
  // Panelde yazım da koşullu: okumadan sonra fiyat değiştiyse ya da ürün siteye bağlandıysa yazılmaz (denetim E-11)
  const local = write.slice(write.indexOf("} else {"), write.indexOf("recordPriceChange("));
  assert.match(local, /abs\(\$\{s\.products\.price\} - \$\{before\.price\}\) < 0\.005/);
  assert.match(local, /before\.siteMenuId \? eq\(s\.products\.siteMenuId, before\.siteMenuId\) : isNull\(s\.products\.siteMenuId\)/);
  assert.match(local, /throw new PriceChangedError\(priceChangedText\(cur\.price\), cur\.price\);/);
});

test("toplu değişiklik: menü kilidi önce, iyimser denetim, kaleme göre sırayla, dörder, 40 sn, devre kesici", () => {
  const batch = read("src/server/prices/batch.ts");
  const local = batch.slice(batch.indexOf("if (local.length)"), batch.indexOf("// 2."));
  assert.ok(local.indexOf("await lockMenu(tx)") > 0 && local.indexOf("await lockMenu(tx)") < local.indexOf(".update(s.products)"), "önce menü kilidi");
  assert.match(local, /isNull\(s\.products\.siteMenuId\)/);
  assert.match(local, /abs\(\$\{s\.products\.price\} - \$\{item\.from\}\) < 0\.005/);
  assert.match(batch, /groups\.set\(row\.siteMenuId,/);
  assert.match(batch, /const SITE_CONCURRENCY = 4;/);
  assert.match(batch, /const DEADLINE_MS = 40_000;/);
  // Sıra, devre kesici ve süre runSiteGroups'ta (yukarıdaki testler sahte yazımla sınar); toplu yazım onu kaleme göre
  // gruplarla, dörder ve 40 sn'yle çağırır, sitenin hatasının nedenini devre kesiciye verir
  assert.match(batch, /runSiteGroups\(\[\.\.\.groups\.values\(\)\], write, \{ concurrency: SITE_CONCURRENCY, deadline: started \+ DEADLINE_MS \}\)/);
  assert.match(batch, /if \(e instanceof UserError\) return \{ ok: false, reason: e\.message, failure: pushFailureOf\(e\) \};/);
  assert.match(batch, /result\.siteDown = linked\.siteDown;/);
  assert.match(batch, /writeSalePrice\(user, row, item\.to, \{ [^}]*expectFrom: item\.from \}\)/);
  // Eylemler sayfanın süresini kullanır: Fiyatlar sayfası 60 sn
  assert.match(read("src/app/panel/urunler/fiyatlar/page.tsx"), /export const maxDuration = 60;/);
});

test("eylemler: toplu fiyat ve şube fiyatı yöneticinin; kasaya işle iki rolde (requireUser); zil iki rolde, personelinki kendi özetinden; yeni ürün kasaya girmez (D3)", () => {
  const actions = read("src/server/actions/prices.ts");
  const exported = [...actions.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(exported.sort(), ["applyBranchPrices", "applyBulkPrices", "cancelBranchPriceRow", "setBranchPrice", "undoPriceBatch"]);
  for (const name of exported) {
    const body = actions.slice(actions.indexOf(`export async function ${name}`));
    assert.match(body.slice(0, 300), /return attempt\(async \(\) => \{\s+const me = await requireAdmin\(\);/, name);
  }
  // Kasaya işle (dalga 10 §2.2): ayrı eylem dosyası, yalnız iki eylem, ikisi de oturumu kendisi denetler
  const marks = read("src/server/actions/pos-marks.ts");
  assert.ok(marks.startsWith('"use server";'));
  const markExports = [...marks.matchAll(/^export (async function|const|function|class|let|type|interface) (\w+)/gm)];
  assert.deepEqual(markExports.map((m) => `${m[1]} ${m[2]}`).sort(), ["async function markPosDone", "async function undoPosMarks"]);
  for (const [, , name] of markExports) {
    const body = marks.slice(marks.indexOf(`export async function ${name}`));
    assert.match(body.slice(0, 300), /return attempt\(async \(\) => \{\s+const me = await requireUser\(\);/, name);
  }
  // Geri alma istemciden fiyat almaz: yalnız işaretin kimliği
  const undoSchema = marks.slice(marks.indexOf("const zUndo"), marks.indexOf(";", marks.indexOf("const zUndo")));
  assert.doesNotMatch(undoSchema, /stalePrice|price|since/);
  assert.match(undoSchema, /z\.array\(zId\)/);
  // Eylemlerin dönüşünde maliyet yok (personel de çağırır)
  assertNoCostKeys(marks);
  // Zilin satırı operasyonun modülünde (src/server/bell/ops.ts; dalga 10 Adım 0): toplayıcı iki rolde çağırır
  const bell = read("src/server/actions/notifications.ts");
  assert.match(bell, /safe\("operasyon", opsBell\(user, onFailed\)\)/);
  const ops = read("src/server/bell/ops.ts");
  // Personel dalı kendi sabit sütunlu özetinden okur (yalnız etkin ürünler), yönetici posPendingSummary'den
  const pos = ops.slice(ops.indexOf("async function posNotifications"), ops.indexOf("export async function opsBell"));
  // Bugünün kasaları (geçiş gününden itibaren LafPOS; denetim E-39; şube başına, A3) iki özete ve metne aynı
  assert.match(pos, /const tills = await loadTillScopes\(undefined, now\);/);
  assert.match(pos, /for \(const scope of tills\)/);
  assert.match(pos, /user\.role === "admin" \? await posPendingSummary\(scope\) : await staffPosSummary\(scope\)/);
  assert.match(pos, /posBell\(user\.role, summary, now, scope\.kasa\)/);
  // Yönetici dizisinin sırası korunur, operasyonun öğeleri uyarıların başında (sayim-ekle testi sonu sabitler)
  assert.match(bell, /\.\.\.invoices, \.\.\.ops, \.\.\.costs\.priceNote, \.\.\.unpriced, \.\.\.costs\.warnings\]/);
});

test("kaynak: personelin kasaya işle yükleyicisi sabit sütunlu (beyaz liste), yalnız etkin ürünler; sayfa yönetici okuyucularına uzanmaz", () => {
  const src = read("src/server/data/pos-staff.ts");
  assert.match(src, /^import "server-only";/);
  // Seçilen sütunlar tam olarak beyaz liste
  const selects = [...src.matchAll(/\.select(?:DistinctOn\([^)]*\),\s*)?\(\{([^}]*)\}\)/g)].map((m) => m[1]);
  assert.ok(selects.length >= 3, `${selects.length} select`);
  const columns = new Set(selects.flatMap((body) => [...body.matchAll(/s\.(\w+)\.(\w+)/g)].map((m) => `${m[1]}.${m[2]}`)));
  const allowed = new Set([
    "products.id",
    "products.name",
    "products.size",
    "products.price",
    // Kasanın şube başına durumu (şube kapsamı A3): yalnız fiyat ve an (join şubeyi ve ürünü süzer)
    "posStale.stalePrice",
    "posStale.staleSince",
    "products.sortOrder",
    "products.active",
    "categories.name",
    "categories.sortOrder",
    "posMappings.posName",
    "posMappings.productId",
    // Kasadaki ad süzgeci (modposNameFilter): yalnız POS adları, tutar yok
    "salesLines.posName",
    "posDailySales.posName",
    "posMarks.id",
    "posMarks.productId",
    "posMarks.price",
    "posMarks.markedAt",
  ]);
  for (const c of columns) assert.ok(allowed.has(c), `beyaz listede yok: ${c}`);
  // Yalnız etkin ürünler
  assert.ok((src.match(/eq\(s\.products\.active, true\)/g) ?? []).length >= 3, "etkin süzgeci");
  // Fiyat geçmişi, kaynak, not, site, reçete ve maliyet yok
  assert.doesNotMatch(src, /productPrices|recipe|siteMenu|\.note\b|cost|unitCost|packagePrice/);
  assertNoCostKeys(src);
  const page = read("src/app/panel/kasa/fiyatlar/page.tsx");
  // Personel sayfası yönetici okuyucularından ve Ürünler'den değer almaz
  assert.doesNotMatch(page, /from "@\/server\/data\/prices"|from "@\/app\/panel\/urunler/);
  assert.match(page, /const me = await requireUser\(\);/);
  assert.match(page, /if \(me\.role === "admin"\) redirect\("\/panel\/urunler\/fiyatlar\?sekme=kasa"\);/);
  // Ortak bileşen yönetici yükleyicisinden yalnız tip alır
  const comp = read("src/components/panel/pos-checklist.tsx");
  assert.ok(comp.startsWith('"use client";'));
  assert.doesNotMatch(comp.replace(/^import type .*$/gm, ""), /@\/server\/data\/prices/);
  assert.match(comp, /^import type \{[^}]*\} from "@\/server\/data\/prices";$/m);
  assert.match(comp, /staff: true/);
});
