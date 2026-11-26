// Paraşüt'ten gelen büyük fiyat sıçramasının onayı (src/lib/price-hold.ts): hangi fiyat yazılır, hangisi onaya düşer,
// çarpan ipucu, ardışık fatura sayısı, geçersiz kalan öneriler ve yeniden değerlendirilmeleri, daha yeni fatura (geri
// alma ve onay), önceki fatura, maliyet etkisi ve uyarı metni; kartın önerisi (kanıt, okuma, yalnız geçmişle oran).
// Çalıştırma: npx tsx --test tests/fiyat-onayi.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import { packEvidence } from "../src/lib/product-match";
import {
  appliedKeyOf,
  ESTIMATE_BADGE,
  ESTIMATE_TEXT,
  conflictSuggestionText,
  evidenceSuggestionText,
  factorHint,
  firstPriceCertain,
  holdAlert,
  holdImpact,
  holdLogText,
  holdReason,
  holdsSummary,
  HOLDS_HREF,
  holdSuggestion,
  linkChange,
  livePct,
  newerInvoice,
  perUnitText,
  previousInvoicePrice,
  priceStep,
  priceWithPct,
  reopenApplied,
  repeatCount,
  sameProductHistory,
  staleHolds,
  suggestedFactor,
  unitPriceFor,
  vsCurrentText,
} from "../src/lib/price-hold";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

test("priceStep: ilk fiyat çarpanı kesinse yazılır, %0,5'ten küçük fark yazılmaz, %40'tan büyük fark onaya düşer", () => {
  // İlk fiyat (şimdiki fiyat yok): çarpan faturanın ölçü biriminden geliyorsa yazılır, addan ya da elle geldiyse onaya
  assert.equal(priceStep({ before: 0, after: 10 }), "hold");
  assert.equal(priceStep({ before: -1, after: 10 }), "hold");
  assert.equal(priceStep({ before: 0, after: 10, firstCertain: true }), "apply");
  assert.equal(priceStep({ before: 0, after: 10, exempt: true }), "apply");
  // Şimdiki fiyat varken firstCertain bir şey değiştirmez
  assert.equal(priceStep({ before: 10, after: 20, firstCertain: true }), "hold");
  assert.equal(priceStep({ before: 10, after: 10.04 }), "same");
  assert.equal(priceStep({ before: 10, after: 9.96 }), "same");
  assert.equal(priceStep({ before: 10, after: 10.06 }), "apply");
  // Tam ±%40 uygulanır (kayan nokta: 0,032 × 1,4 = 0,044800000000000006)
  assert.equal(priceStep({ before: 10, after: 14 }), "apply");
  assert.equal(priceStep({ before: 0.032, after: 0.032 * 1.4 }), "apply");
  assert.equal(priceStep({ before: 0.05185, after: 0.05185 * 1.4 }), "apply");
  assert.equal(priceStep({ before: 10, after: 14.001 }), "hold");
  assert.equal(priceStep({ before: 10, after: 6 }), "apply");
  assert.equal(priceStep({ before: 10, after: 5.99 }), "hold");
  // Su ve buz (fiyatı su faturasından) hiç onaya düşmez
  assert.equal(priceStep({ before: 10, after: 30, exempt: true }), "apply");
  assert.equal(priceStep({ before: 10, after: 10.01, exempt: true }), "same");
  // Eşik verilebilir
  assert.equal(priceStep({ before: 10, after: 12, threshold: 0.1 }), "hold");
});

test("factorHint: fiyat şimdikinin yaklaşık tam katı ya da tam bölümüyse çarpan ipucu", () => {
  assert.deepEqual(factorHint(1, 12.3), { times: 12, direction: "up", multiplier: 12 });
  assert.equal(factorHint(1, 1.6), null);
  assert.deepEqual(factorHint(1, 2.05), { times: 2, direction: "up", multiplier: 2 });
  // 7,5: 8'e de 7'ye de %5'ten uzak
  assert.equal(factorHint(1, 7.5), null);
  const down = factorHint(1, 1 / 1000);
  assert.equal(down?.direction, "down");
  assert.equal(down?.times, 1000);
  assert.equal(down?.multiplier, 1 / 1000);
  // Büyük katlarda paket boyu: 987 kat "kg ↔ gr" demektir, 987 değil
  assert.equal(factorHint(1, 987)?.times, 1000);
  assert.equal(factorHint(1, 23.7)?.times, 24);
  // %40 içi ve tanınmayan kat ipucu vermez
  assert.equal(factorHint(1, 1.3), null);
  assert.equal(factorHint(1, 13.3)?.times, 13);
  assert.equal(factorHint(1, 22), null);
  assert.equal(factorHint(0, 5), null);
});

test("suggestedFactor: yalnız tam sayı (≥1) önerilir", () => {
  assert.equal(suggestedFactor(1000, { multiplier: 1 / 12 }), null);
  assert.equal(suggestedFactor(1, { multiplier: 12 }), 12);
  assert.equal(suggestedFactor(1000, { multiplier: 12 }), 12000);
  assert.equal(suggestedFactor(12000, { multiplier: 1 / 12 }), 1000);
  assert.equal(suggestedFactor(1000, { multiplier: 1 / 1000 }), 1);
  assert.equal(suggestedFactor(1, { multiplier: 1 / 2 }), null);
});

test("repeatCount: kaç fatura arka arkaya ±%10 aynı fiyat; arada başka fiyatlı fatura sayımı keser", () => {
  const links = new Map([
    ["p", { ingredientId: 1, factor: 1 }],
    ["koli", { ingredientId: 1, factor: 1 }],
    ["baska", { ingredientId: 2, factor: 1 }],
  ]);
  const line = (invoiceId: number, date: string, unit: number, productKey = "p") => ({ invoiceId, productKey, date, supplier: "Sütaş", quantity: 2, netTotal: unit * 2 });
  const cur = (invoiceId: number, date: string, unitPrice: number) => ({ invoiceId, date, unitPrice });
  assert.equal(repeatCount([], links, 1, cur(9, "2026-10-21", 10)), 1);
  // ±%10 sınırı: 10 → 10,9 ve 9,1 sayılır, 11,2 sayılmaz
  assert.equal(repeatCount([line(1, "2026-10-01", 10)], links, 1, cur(9, "2026-10-21", 10.9)), 2);
  assert.equal(repeatCount([line(1, "2026-09-01", 10), line(2, "2026-10-01", 10)], links, 1, cur(9, "2026-10-21", 9.1)), 3);
  assert.equal(repeatCount([line(1, "2026-10-01", 10)], links, 1, cur(9, "2026-10-21", 11.2)), 1);
  // 27,50 (17.10) → şimdiki fiyatla aynı 49,52 (19.10) → 27,60 (21.10): arada başka fiyat var, "Son 2 faturada" denmez
  // ("Önceki fatura" da 49,52 der)
  const lak = [line(1, "2026-10-17", 27.5), line(2, "2026-10-19", 49.52), line(3, "2026-10-21", 27.6)];
  assert.equal(repeatCount(lak, links, 1, cur(3, "2026-10-21", 27.6)), 1);
  assert.equal(previousInvoicePrice(lak, links, 1, cur(3, "2026-10-21", 27.6))?.unitPrice, 49.52);
  assert.equal(repeatCount([lak[0], lak[2]], links, 1, cur(3, "2026-10-21", 27.6)), 2);
  // Yanlış çarpanlı koli doğru fiyatlı faturalarla sırayla gelince sayı büyümez
  const alternating = [line(1, "2026-09-01", 600, "koli"), line(2, "2026-09-10", 50), line(3, "2026-09-20", 600, "koli"), line(4, "2026-10-01", 50)];
  assert.equal(repeatCount(alternating, links, 1, cur(5, "2026-10-10", 600)), 1);
  // Önerilere değil faturalara bakılır (ilk kez bağlanan ürünün eski faturaları da sayılır); bedava kalem, iade ve
  // başka hammaddenin faturası sayılmaz, sayımı da kesmez
  const history = [
    line(1, "2026-06-01", 15),
    line(2, "2026-07-01", 15.2),
    line(3, "2026-08-01", 0),
    { invoiceId: 4, productKey: "p", date: "2026-08-10", supplier: "Sütaş", quantity: -1, netTotal: -40 },
    line(5, "2026-08-15", 40, "baska"),
    line(6, "2026-09-01", 15.1),
  ];
  assert.equal(repeatCount(history, links, 1, cur(7, "2026-10-01", 15)), 4);
  // Faturanın kendi öteki kalemi ve sonraki faturalar sayılmaz: aynı faturanın yeniden değerlendirilmesi sayıyı değiştirmez
  assert.equal(repeatCount([...history, line(7, "2026-10-01", 30), line(8, "2026-10-15", 30)], links, 1, cur(7, "2026-10-01", 15)), 4);
});

test("newerInvoice: öneriden sonra hammaddenin fiyatını belirleyen fatura (geri alma ve onay buna bakar)", () => {
  const links = new Map([
    ["espresso", { ingredientId: 1, updatePrice: true }],
    ["espresso-cfm", { ingredientId: 1, updatePrice: false }],
    ["sut", { ingredientId: 4, updatePrice: true }],
  ]);
  const line = (invoiceId: number, productKey: string, date: string, quantity: number, netTotal: number, supplier = "Kaldi") => ({ invoiceId, productKey, date, supplier, quantity, netTotal });
  const hold = { ingredientId: 1, invoiceId: 126, invoiceDate: "2026-10-18", productKey: "espresso" };
  // 18.10'daki 1.530 ₺/kg reddedildi, 21.10'daki 1.100 ₺/kg bant içinde uygulandı: red geri alınırsa eski fiyat bekler
  // ve onaylanınca yenisinin üstüne yazılırdı
  const lines = [line(121, "espresso", "2026-09-20", 4, 6080), line(126, "espresso", "2026-10-18", 5, 7650), line(127, "espresso", "2026-10-21", 5, 5500)];
  assert.deepEqual(newerInvoice(lines, links, hold), { invoiceId: 127, date: "2026-10-21", supplier: "Kaldi" });
  assert.equal(newerInvoice(lines.slice(0, 2), links, hold), null);
  // Fiyata girmeyen sayılmaz: bedava kalem, iade, fiyatı güncellenmeyen başka ürün, başka hammadde, aynı gün başka fatura
  const ignored = [
    line(130, "espresso", "2026-10-20", 1, 0),
    line(131, "espresso", "2026-10-20", -1, -1530),
    line(132, "espresso-cfm", "2026-10-22", 3, 3150, "Coffeemania"),
    line(133, "sut", "2026-10-22", 12, 600, "Sütaş"),
    line(134, "espresso", "2026-10-18", 1, 1100),
  ];
  assert.equal(newerInvoice([...lines.slice(0, 2), ...ignored], links, hold), null);
  // Önerinin kendi ürünü, reddederken fiyat güncellemesi kapatılmış olsa da sayılır (geri alma onu yeniden açar)
  const stopped = new Map(links).set("espresso", { ingredientId: 1, updatePrice: false });
  assert.equal(newerInvoice(lines, stopped, hold)?.invoiceId, 127);
  // Faturanın kendisi, tarihi sonradan değişse de daha yeni sayılmaz; birden çoksa en yenisi
  assert.equal(newerInvoice([line(126, "espresso", "2026-10-25", 5, 7650)], links, hold), null);
  assert.equal(newerInvoice([...lines, line(128, "espresso", "2026-10-24", 1, 1100)], links, hold)?.date, "2026-10-24");
});

test("reopenApplied: geçersiz kalan önerinin faturası, değişiklik geri dönünce yeniden değerlendirilir", () => {
  const applied: Record<string, string> = { "5|laktozsuz|1000": "2026-10-21", "1|espresso|1000": "2026-10-24", "4|sut|1000": "2026-11-01", "8|karamel|2000": "2026-10-15" };
  const hold = (ingredientId: number, productKey: string, factor: number, invoiceDate: string) => ({ ingredientId, productKey, factor, invoiceDate });
  const n = reopenApplied(applied, [
    hold(5, "laktozsuz", 1000, "2026-10-21"),
    // İşaret o arada daha yeni faturaya geçti: dokunulmaz
    hold(1, "espresso", 1000, "2026-10-18"),
    // Ay başından önceki gün
    hold(4, "sut", 1000, "2026-11-01"),
    // Hiç değerlendirilmemiş anahtar eklenmez
    hold(9, "yok", 1, "2026-10-10"),
  ]);
  assert.equal(n, 2);
  assert.deepEqual(applied, { "5|laktozsuz|1000": "2026-10-20", "1|espresso|1000": "2026-10-24", "4|sut|1000": "2026-10-31", "8|karamel|2000": "2026-10-15" });
  // Eşitlemenin kuralı (işaret ≥ fatura günü ise atlanır): aynı fatura yeniden değerlendirilir, daha eskisi yine atlanır
  const key = appliedKeyOf(5, "laktozsuz", 1000);
  assert.equal(key, "5|laktozsuz|1000");
  assert.ok(!(applied[key] >= "2026-10-21"));
  assert.ok(applied[key] >= "2026-10-19");
});

test("staleHolds: beş neden ve bozulmamış öneri", () => {
  const hold = (id: number, over: Partial<{ ingredientId: number; productKey: string; factor: number; invoiceId: number }> = {}) => ({
    id,
    ingredientId: 1,
    productKey: `p${id}`,
    factor: 1000,
    invoiceId: 10 + id,
    ...over,
  });
  const pending = [hold(1), hold(2), hold(3), hold(4), hold(5), hold(6)];
  const links = [
    // 1: bağlantı yok
    { productKey: "p2", ingredientId: 9, factor: 1000, updatePrice: true },
    { productKey: "p3", ingredientId: 1, factor: 12000, updatePrice: true },
    { productKey: "p4", ingredientId: 1, factor: 1000, updatePrice: false },
    { productKey: "p5", ingredientId: 1, factor: 1000, updatePrice: true },
    { productKey: "p6", ingredientId: 1, factor: 1000, updatePrice: true },
  ];
  // 5'in kalemi kapsamdan çıktı (fatura kafe dışına taşındı); 6 bozulmamış
  const lines = [2, 3, 4, 6].map((i) => ({ invoiceId: 10 + i, productKey: `p${i}` }));
  assert.deepEqual(staleHolds(pending, links, lines), [
    { id: 1, reason: "Bağlantı kaldırıldı" },
    { id: 2, reason: "Bağlantı başka hammaddeye geçti" },
    { id: 3, reason: "Çarpan değişti" },
    { id: 4, reason: "Fiyat güncellemesi kapatıldı" },
    { id: 5, reason: "Faturadaki kalem artık yok" },
  ]);
  assert.equal(linkChange({ ingredientId: 1, factor: 1000 }, links[3]), null);
  // Kalem başka faturada durması yetmez: faturanın kendi kalemi olmalı
  assert.deepEqual(staleHolds([hold(6)], links, [{ invoiceId: 99, productKey: "p6" }]), [{ id: 6, reason: "Faturadaki kalem artık yok" }]);
});

test("previousInvoicePrice: hammaddenin bütün bağlı ürünlerinde önceki en yeni ücretli fatura, kalemin kendi çarpanıyla", () => {
  const links = new Map([
    ["sut-1l", { ingredientId: 4, factor: 1000 }],
    ["sut-koli", { ingredientId: 4, factor: 12000 }],
    ["kahve", { ingredientId: 1, factor: 1000 }],
  ]);
  const line = (invoiceId: number, productKey: string, date: string, quantity: number, netTotal: number, supplier = "Sütaş") => ({ invoiceId, productKey, date, supplier, quantity, netTotal });
  const lines = [
    line(1, "sut-1l", "2026-09-01", 10, 300),
    line(2, "sut-koli", "2026-10-01", 2, 744, "Metro"),
    // Bedava kalem ve iade sayılmaz
    line(3, "sut-1l", "2026-10-10", 5, 0),
    line(4, "sut-1l", "2026-10-12", -2, -60),
    // Başka hammadde
    line(5, "kahve", "2026-10-15", 1, 1000, "Kaldi"),
    // Değerlendirilen fatura ve sonrası
    line(6, "sut-1l", "2026-10-20", 10, 486.4),
    line(7, "sut-1l", "2026-10-25", 10, 310),
  ];
  const prev = previousInvoicePrice(lines, links, 4, { invoiceId: 6, date: "2026-10-20" });
  assert.ok(prev);
  assert.equal(prev.date, "2026-10-01");
  assert.equal(prev.supplier, "Metro");
  assert.ok(Math.abs(prev.unitPrice - 744 / 24000) < 1e-12, "koli çarpanı 12000");
  // Aynı gün başka fatura da öncekidir; aynı faturanın kalemleri birlikte
  const sameDay = [...lines, line(8, "sut-1l", "2026-10-20", 2, 62), line(8, "sut-koli", "2026-10-20", 1, 372)];
  const p2 = previousInvoicePrice(sameDay, links, 4, { invoiceId: 6, date: "2026-10-20" });
  assert.ok(p2 && Math.abs(p2.unitPrice - 434 / 14000) < 1e-12);
  assert.equal(previousInvoicePrice(lines, links, 4, { invoiceId: 1, date: "2026-09-01" }), null);
  assert.equal(previousInvoicePrice(lines, links, 2, { invoiceId: 6, date: "2026-10-20" }), null);
});

const data: SeedData = JSON.parse(readFileSync(join(__dirname, "..", "tests/fixtures/baslangic/veri.json"), "utf8"));
const ds: Dataset = datasetFromSeed(data);
const milk = ds.ingredients.find((i) => i.name === "Süt %2,5")!;

test("holdImpact: sütü kullanan etkin ürünler, en çok değişen önce; düşüşte maliyet düşer", () => {
  const model = createModel(ds);
  const now = milk.packagePrice / milk.packageSize;
  const using = model.activeProducts.filter((p) => p.cost > 0 && p.lines.some((l) => l.item.ingredientId === milk.id));
  assert.ok(using.length > 10);
  const up = holdImpact(model, milk.id, now * 1.5);
  assert.equal(up.products, using.length);
  assert.equal(up.top.length, 3);
  for (const t of up.top) assert.ok(t.costAfter > t.costBefore, `${t.name} ${t.size}`);
  const deltas = up.top.map((t) => t.costAfter - t.costBefore);
  assert.deepEqual([...deltas].sort((a, b) => b - a), deltas);
  // En büyük fark, sütü kullanan bütün ürünlerin en büyüğü
  const milkQty = (p: (typeof using)[number]) => p.lines.filter((l) => l.item.ingredientId === milk.id).reduce((a, l) => a + l.qty, 0);
  const maxQty = Math.max(...using.map(milkQty));
  assert.equal(milkQty(using.find((p) => p.product.id === up.top[0].productId)!), maxQty);
  // Model değişmedi (önerilen fiyat yalnız hesapta)
  assert.equal(model.unitCost.get(milk.id), now);
  const down = holdImpact(model, milk.id, now * 0.5);
  assert.equal(down.products, using.length);
  for (const t of down.top) assert.ok(t.costAfter < t.costBefore);
  // Hiçbir reçetede olmayan hammadde
  const unused = ds.ingredients.find((i) => !model.usedIn.get(i.id)?.length)!;
  assert.deepEqual(holdImpact(model, unused.id, 1), { products: 0, top: [] });
});

/** İşaretle yüzde arasındaki kelime birleştirici (signedPct) */
const WJ = "\u2060";

test("holdAlert ve özet: boşta yok, tek, beş öneride 've 2 hammadde daha'", () => {
  assert.equal(holdAlert([]), null);
  const one = holdAlert([{ name: "Süt", pct: 0.52 }]);
  assert.deepEqual(one, {
    level: "warning",
    title: "Fiyat onayı: 1 hammadde",
    detail: `Faturadaki fiyat şimdikinden %40'tan fazla farklı: Süt +${WJ}%52. Onaylanana kadar maliyetler şimdiki fiyatla hesaplanır.`,
    href: "/panel/hammaddeler#fiyat-onayi",
  });
  assert.equal(HOLDS_HREF, "/panel/hammaddeler#fiyat-onayi");
  const five = holdAlert([
    { name: "Süt", pct: 0.52 },
    { name: "Kahve", pct: -0.45 },
    { name: "Kakao", pct: 11 },
    { name: "Bardak", pct: 0.6 },
    { name: "Kapak", pct: null },
  ]);
  assert.equal(five?.title, "Fiyat onayı: 5 hammadde");
  assert.ok(five?.detail.includes(`: Süt +${WJ}%52, Kahve −${WJ}%45, Kakao +${WJ}%1.100 ve 2 hammadde daha. `), five?.detail);
  // Şimdiki fiyatı olmayan (ya da sonradan 0 yapılmış) hammadde: yüzde yerine ilk fiyat
  assert.equal(holdsSummary([{ name: "Kapak", pct: null }]), "Kapak (ilk fiyat)");
  assert.equal(holdReason([{ pct: 0.52 }]), "faturadaki fiyat şimdikinden %40'tan fazla farklı");
  assert.equal(holdReason([{ pct: null }]), "faturadan gelen ilk fiyat, çarpanı kesin değil");
  assert.equal(holdReason([{ pct: 0.52 }, { pct: null }]), "faturadaki fiyat şimdikinden %40'tan fazla farklı ya da ilk fiyat");
  // İlk fiyatı bekleyenin şimdiki fiyatı yok: maliyette 0 ₺ (denetim B03 incelemesi)
  assert.deepEqual(holdAlert([{ name: "Karton bardak", pct: null }])?.detail, "Faturadan gelen ilk fiyat, çarpanı kesin değil: Karton bardak (ilk fiyat). Onaylanana kadar maliyetlerde 0 ₺ sayılır.");
  assert.ok(five?.detail.endsWith("Onaylanana kadar maliyetler şimdiki fiyatla hesaplanır; ilk fiyatı bekleyenler 0 ₺ sayılır."), five?.detail);
  assert.equal(livePct(0.05, 0), null);
  assert.ok(Math.abs(livePct(0.0486, 0.032)! - 0.51875) < 1e-12);
  assert.equal(holdLogText({ name: "Süt", pct: 0.52, supplier: "Sütaş", date: "2026-10-21" }), `Süt +${WJ}%52 (Sütaş 21.10.2026)`);
});

// ── Kartın önerisi: kanıt önce, oran yalnız aynı ürünün geçmişiyle (docs/planlar/fatura-okuma.md) ──

test("öneri: Yenilebilir bardak (1 Adet × 3.000 ₺, çarpan 1, şimdi 41,65 ₺/adet) → adındaki 150 AD., oran değil", () => {
  const current = 9996 / 240;
  const line = { name: "LİVİ YENİLEBİLİR BARDAK 150 AD.", unit: "Adet", quantity: 1 };
  const hold = { factor: 1, quantity: 1, netTotal: 3000, current, evidence: packEvidence(line, "adet"), reading: null, history: false };
  // Eski kart: fiyat şimdikinin ~72 katı, "Çarpanı 72 yap" (yazılsa 41,67 ₺: gerçek düşüş kaybolurdu)
  assert.equal(factorHint(current, 3000)?.times, 72);
  const s = holdSuggestion(hold);
  assert.equal(s?.kind, "evidence");
  assert.equal(s?.factor, 150);
  assert.equal(s?.unitPrice, 20);
  assert.ok(s?.pct !== null && Math.abs(s!.pct! - (20 / current - 1)) < 1e-12);
  assert.equal(
    evidenceSuggestionText(s!.evidence!, { lineUnit: "Adet", unit: "adet", unitPrice: s!.unitPrice, currentUnit: current }),
    "Adında “150 AD.” yazıyor: 1 Adet = 150 adet olmalı. Öyle olursa adet başı 20,00\u00a0₺ (şimdikinden %52 ucuz).",
  );
  // Okuma da 150 dese kanıt önce gelir (tek düğme); çarpan zaten 150 ise öneri yok
  assert.equal(holdSuggestion({ ...hold, reading: { factor: 150, confidence: "high" } })?.kind, "evidence");
  assert.equal(holdSuggestion({ ...hold, factor: 150 }), null);
});

test("öneri: Klips kapak (tahmini 1,165 ₺, faturada 12,02 ₺) → oran düğmesi yok; okuma aynı çarpanı derse de öneri yok", () => {
  const current = 1165 / 1000;
  const hold = { factor: 1, quantity: 1000, netTotal: 12020, current, evidence: packEvidence({ name: "PLASTİK KAPAK KLIPS", unit: "Adet", quantity: 1000 }, "adet"), reading: null, history: false };
  assert.equal(hold.evidence, null);
  assert.equal(factorHint(current, 12.02)?.times, 10);
  assert.equal(holdSuggestion(hold), null);
  assert.equal(holdSuggestion({ ...hold, reading: { factor: 1, confidence: "high" } }), null);
  // Okuma farklı çarpan bulursa (emin ya da büyük olasılıkla) önerir; az eminse önermez
  assert.deepEqual(holdSuggestion({ ...hold, reading: { factor: 10, confidence: "medium" } }), { kind: "reading", factor: 10, unitPrice: 1.202, pct: 1.202 / current - 1 });
  assert.equal(holdSuggestion({ ...hold, reading: { factor: 10, confidence: "low" } }), null);
  assert.equal(holdSuggestion({ ...hold, reading: { factor: null, confidence: "high" } }), null);
  assert.equal(ESTIMATE_TEXT, "Şimdiki fiyat tahmini (varsayım), faturadan gelmedi. Faturadaki fiyat ilk gerçek fiyat olabilir.");
  assert.equal(ESTIMATE_BADGE, "tahmini fiyata göre");
});

test("öneri: adında yalnız boyut ('SÜT 1 L', Adet) kanıt değil: doğru koli çarpanına (12.000) '1.000 ml olmalı' denmez", () => {
  // Tedarikçi 12 × 1 L koliyi "1 Adet" yazıyor, sahibi doğru bağlamış (12.000 ml); fiyat gerçekten %61 arttı
  const evidence = packEvidence({ name: "SÜT 1 L", unit: "Adet", quantity: 2 }, "ml");
  assert.equal(evidence, null);
  const hold = { factor: 12000, quantity: 2, netTotal: 1200, current: 0.031, evidence, reading: null, history: true };
  assert.equal(holdSuggestion(hold), null);
  // Okuma gizlenmez: emin okunan farklı çarpan önerilir, aynı çarpan öneri değil
  assert.equal(holdSuggestion({ ...hold, reading: { factor: 6000, confidence: "high" } })?.factor, 6000);
  assert.equal(holdSuggestion({ ...hold, reading: { factor: 12000, confidence: "high" } }), null);
});

test("öneri: aynı ürün koli ↔ adet değiştirdi (geçmişi aynı çarpanla şimdiki fiyatta) → oran düğmesi kalır", () => {
  // SÜT 1 L, çarpan 1000: 1 ve 2 Ekim'de adet başı 31 ₺ (0,031 ₺/ml); 20 Ekim'de aynı ürün Koli (12 × 1 L) 372 ₺
  const lines = [
    { invoiceId: 1, productKey: "sut", date: "2026-10-01", supplier: "Sütaş", quantity: 10, netTotal: 310 },
    { invoiceId: 2, productKey: "sut", date: "2026-10-02", supplier: "Sütaş", quantity: 4, netTotal: 124 },
    { invoiceId: 3, productKey: "sut", date: "2026-10-20", supplier: "Sütaş", quantity: 2, netTotal: 744 },
  ];
  const current = 0.031;
  const h = { ingredientId: 4, invoiceId: 3, invoiceDate: "2026-10-20", productKey: "sut", factor: 1000 };
  assert.equal(sameProductHistory(lines, h, current), true);
  const s = holdSuggestion({ factor: 1000, quantity: 2, netTotal: 744, current, evidence: null, reading: null, history: true });
  assert.equal(s?.kind, "ratio");
  assert.equal(s?.factor, 12000);
  assert.equal(s?.hint?.times, 12);
  assert.ok(Math.abs(s!.unitPrice! - 0.031) < 1e-12);
  assert.equal(vsCurrentText(s!.unitPrice!, current), "şimdikiyle aynı");
  // Geçmiş yoksa (yeni ürün) ya da başka fiyatlıysa oran önerilmez
  assert.equal(holdSuggestion({ factor: 1000, quantity: 2, netTotal: 744, current, evidence: null, reading: null, history: false }), null);
  assert.equal(sameProductHistory(lines.slice(2), h, current), false);
  assert.equal(sameProductHistory([{ ...lines[0], netTotal: 400 }, lines[2]], h, current), false);
  // Başka ürünün geçmişi sayılmaz; değerlendirilen faturanın kendisi ve sonrası sayılmaz; tahmini (0) fiyata karşı yok
  assert.equal(sameProductHistory(lines.map((l) => ({ ...l, productKey: l.invoiceId === 3 ? "sut" : "sut-koli" })), h, current), false);
  assert.equal(sameProductHistory([{ ...lines[0], date: "2026-10-25" }, lines[2]], h, current), false);
  assert.equal(sameProductHistory(lines, h, 0), false);
  // ±%10 sınırı
  assert.equal(sameProductHistory([{ ...lines[0], netTotal: 341 }, lines[2]], h, current), true);
  assert.equal(sameProductHistory([{ ...lines[0], netTotal: 342 }, lines[2]], h, current), false);
});

test("öneri metinleri: birim fiyat ve şimdikine göre fark", () => {
  assert.equal(unitPriceFor({ quantity: 1, netTotal: 3000 }, 150), 20);
  assert.equal(unitPriceFor({ quantity: 1, netTotal: 0 }, 150), null);
  assert.equal(unitPriceFor({ quantity: -1, netTotal: -3000 }, 150), null);
  assert.equal(perUnitText(20, "adet"), "adet başı 20,00\u00a0₺");
  assert.equal(perUnitText(0.95, "gr"), "kg başı 950,00\u00a0₺");
  assert.equal(perUnitText(0.031, "ml"), "L başı 31,00\u00a0₺");
  assert.equal(vsCurrentText(20, 41.65), "şimdikinden %52 ucuz");
  assert.equal(vsCurrentText(12.02, 1.165), "şimdikinden %932 pahalı");
  assert.equal(vsCurrentText(3000, 41.65), "şimdikinden %7.103 pahalı");
  assert.equal(vsCurrentText(10.03, 10), "şimdikiyle aynı");
  assert.equal(vsCurrentText(10, 0), null);
  assert.equal(priceWithPct(20, "adet", 0), "adet başı 20,00\u00a0₺");
  // Ölçü birimi ve açıklama kanıtının başı
  assert.equal(
    evidenceSuggestionText({ factor: 1000, source: "unit", text: "kg" }, { lineUnit: "kg", unit: "gr", unitPrice: 0.95, currentUnit: 0.92 }),
    "Faturadaki birim “kg”: 1 kg = 1.000 gr olmalı. Öyle olursa kg başı 950,00\u00a0₺ (şimdikinden %3 pahalı).",
  );
  assert.equal(
    evidenceSuggestionText({ factor: 150, source: "description", text: "150 ADET" }, { lineUnit: null, unit: "adet", unitPrice: null, currentUnit: 41.65 }),
    "Açıklamasında “150 ADET” yazıyor: 1 birim = 150 adet olmalı.",
  );
});

// ── Denetim E-06 (26 Eki): iki sayılı paket adı, okumayla çelişen ad kanıtı, ilk fiyat ──

test("öneri: ad kanıtı emin okumayla çelişirse iki değer yazılır, “Çarpanı X yap” yok (E-06)", () => {
  // Bağlantı 1000 (doğru), adın eski okuması 50, fatura emin okunmuş 1000: eskiden "Çarpanı 50 yap" (+%1900) derdi
  const wrongName = { factor: 50, source: "name" as const, text: "50'Lİ" };
  const hold = { factor: 1000, quantity: 1, netTotal: 400, current: 0.4, evidence: wrongName, reading: { factor: 1000, confidence: "high" as const }, history: false };
  const s = holdSuggestion(hold);
  assert.equal(s?.kind, "conflict");
  assert.equal(s?.factor, null, "düğme yok");
  assert.equal(s?.reading?.factor, 1000);
  assert.equal(s?.unitPrice, 8);
  assert.equal(s?.reading?.unitPrice, 0.4);
  assert.equal(
    conflictSuggestionText(s!, { lineUnit: "Koli", unit: "adet", currentUnit: 0.4 }),
    "Adında “50'Lİ” yazıyor: 1 Koli = 50 adet, adet başı 8,00\u00a0₺ (şimdikinden %1.900 pahalı). Faturanın okuması: 1 Koli = 1.000 adet, adet başı 0,40\u00a0₺ (şimdikiyle aynı). İkisi çelişiyor; faturayı açıp bakın, doğru çarpanı “Bağlantıyı düzelt”ten yazın.",
  );
  // Büyük olasılıkla okuma da çelişki sayılır; az emin okuma sayılmaz (kanıt önerilir), okuma aynı derse kanıt önerilir
  assert.equal(holdSuggestion({ ...hold, reading: { factor: 1000, confidence: "medium" } })?.kind, "conflict");
  assert.deepEqual(holdSuggestion({ ...hold, reading: { factor: 1000, confidence: "low" } })?.factor, 50);
  assert.equal(holdSuggestion({ ...hold, factor: 1, reading: { factor: 50, confidence: "high" } })?.kind, "evidence");
  // Bağlantı adın okumasıyla aynı (50) ama fatura 1000 diyor: yine çelişki, iki değer
  const same = holdSuggestion({ ...hold, factor: 50 });
  assert.deepEqual([same?.kind, same?.factor], ["conflict", null]);
  // Düzeltilmiş ad okuması (Koli → 1000) okumayla aynı: tek düğme, 1000
  const fixed = packEvidence({ name: "KARTON BARDAK 8 OZ 50'Lİ X 20", unit: "Koli", quantity: 1 }, "adet");
  assert.deepEqual(fixed, { factor: 1000, source: "name", text: "50'Lİ X 20" });
  const ok = holdSuggestion({ ...hold, factor: 50, evidence: fixed, reading: { factor: 1000, confidence: "high" } });
  assert.deepEqual([ok?.kind, ok?.factor], ["evidence", 1000]);
});

test("öneri: faturadaki ölçü biriminin çevirisi (1 kg = 1000 gr) okumayla çelişse de kanıttır", () => {
  const kg = packEvidence({ name: "KAKAO", unit: "KG", quantity: 2 }, "gr");
  assert.deepEqual(kg, { factor: 1000, source: "unit", text: "KG" });
  const hold = { factor: 1000, quantity: 2, netTotal: 1800, current: 0.5, evidence: kg, reading: { factor: 1, confidence: "high" as const }, history: false };
  // Bağlantı birimle aynı: okuma onu değiştirmeye önerilmez (bilgi satırında kalır)
  assert.equal(holdSuggestion(hold), null);
  // Bağlantı birimden farklı: birimin çevirisi önerilir, okuma çelişse de
  assert.deepEqual([holdSuggestion({ ...hold, factor: 1 })?.kind, holdSuggestion({ ...hold, factor: 1 })?.factor], ["evidence", 1000]);
});

test("ilk fiyat: çarpan faturanın ölçü biriminden geliyorsa kesin, addan ya da elle geldiyse değil (E-06)", () => {
  assert.equal(firstPriceCertain(packEvidence({ name: "MATCHA", unit: "KG" }, "gr"), 1000), true);
  assert.equal(firstPriceCertain(packEvidence({ name: "KAŞIK", unit: "Düzine" }, "adet"), 12), true);
  // Birim kg ama bağlantı başka çarpanla yazılmış
  assert.equal(firstPriceCertain(packEvidence({ name: "MATCHA", unit: "KG" }, "gr"), 1), false);
  // Ad kanıtı ("150 AD.", "50'Lİ X 20") kesin değil: ilk fiyat onaya düşer
  assert.equal(firstPriceCertain(packEvidence({ name: "LİVİ YENİLEBİLİR BARDAK 150 AD.", unit: "Adet", quantity: 1 }, "adet"), 150), false);
  assert.equal(firstPriceCertain(packEvidence({ name: "KARTON BARDAK 8 OZ 50'Lİ X 20", unit: "Koli", quantity: 1 }, "adet"), 1000), false);
  assert.equal(firstPriceCertain(null, 1), false);
  // Sıra: kanıt yoksa ilk fiyat onaya, varsa yazılır
  assert.equal(priceStep({ before: 0, after: 0.4, firstCertain: firstPriceCertain(null, 50) }), "hold");
});
