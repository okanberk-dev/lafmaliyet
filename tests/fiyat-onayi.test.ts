// Paraşüt'ten gelen büyük fiyat sıçramasının onayı (src/lib/price-hold.ts): hangi fiyat yazılır, hangisi onaya düşer,
// çarpan ipucu, ardışık fatura sayısı, geçersiz kalan öneriler ve yeniden değerlendirilmeleri, daha yeni fatura (geri
// alma ve onay), önceki fatura, maliyet etkisi ve uyarı metni.
// Çalıştırma: npx tsx --test tests/fiyat-onayi.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import {
  appliedKeyOf,
  factorHint,
  holdAlert,
  holdImpact,
  holdLogText,
  holdsSummary,
  HOLDS_HREF,
  linkChange,
  livePct,
  newerInvoice,
  previousInvoicePrice,
  priceStep,
  reopenApplied,
  repeatCount,
  staleHolds,
  suggestedFactor,
} from "../src/lib/price-hold";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

test("priceStep: şimdiki fiyat yoksa yazılır, %0,5'ten küçük fark yazılmaz, %40'tan büyük fark onaya düşer", () => {
  assert.equal(priceStep({ before: 0, after: 10 }), "apply");
  assert.equal(priceStep({ before: -1, after: 10 }), "apply");
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

const data: ExcelData = JSON.parse(readFileSync(join(__dirname, "..", "src/server/db/seed/excel-data.json"), "utf8"));
const ds: Dataset = excelToDataset(data);
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
  // Şimdiki fiyatı sonradan 0 yapılmış hammadde: yüzde yazılmaz
  assert.equal(holdsSummary([{ name: "Kapak", pct: null }]), "Kapak");
  assert.equal(livePct(0.05, 0), null);
  assert.ok(Math.abs(livePct(0.0486, 0.032)! - 0.51875) < 1e-12);
  assert.equal(holdLogText({ name: "Süt", pct: 0.52, supplier: "Sütaş", date: "2026-10-21" }), `Süt +${WJ}%52 (Sütaş 21.10.2026)`);
});
