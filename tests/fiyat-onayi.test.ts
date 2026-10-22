// Paraşüt'ten gelen büyük fiyat sıçramasının onayı (src/lib/price-hold.ts): hangi fiyat yazılır, hangisi onaya düşer,
// çarpan ipucu, ardışık fatura sayısı, geçersiz kalan öneriler, önceki fatura, maliyet etkisi ve uyarı metni.
// Çalıştırma: npx tsx --test tests/fiyat-onayi.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import {
  factorHint,
  holdAlert,
  holdImpact,
  holdLogText,
  holdsSummary,
  HOLDS_HREF,
  linkChange,
  livePct,
  nextRepeats,
  previousInvoicePrice,
  priceStep,
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

test("nextRepeats: başka faturada ±%10 içinde aynı fiyat sayıyı artırır", () => {
  assert.equal(nextRepeats(null, { invoiceId: 1, unitPrice: 10 }), 1);
  // Aynı faturanın yeniden değerlendirilmesi sayıyı değiştirmez
  assert.equal(nextRepeats({ invoiceId: 1, unitPrice: 10, repeats: 2 }, { invoiceId: 1, unitPrice: 30 }), 2);
  assert.equal(nextRepeats({ invoiceId: 1, unitPrice: 10, repeats: 1 }, { invoiceId: 2, unitPrice: 10.9 }), 2);
  assert.equal(nextRepeats({ invoiceId: 1, unitPrice: 10, repeats: 2 }, { invoiceId: 3, unitPrice: 9.1 }), 3);
  assert.equal(nextRepeats({ invoiceId: 1, unitPrice: 10, repeats: 3 }, { invoiceId: 2, unitPrice: 11.2 }), 1);
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

test("holdAlert ve özet: boşta yok, tek, beş öneride 've 2 hammadde daha'", () => {
  assert.equal(holdAlert([]), null);
  const one = holdAlert([{ name: "Süt", pct: 0.52 }]);
  assert.deepEqual(one, {
    level: "warning",
    title: "Fiyat onayı: 1 hammadde",
    detail: "Faturadaki fiyat şimdikinden %40'tan fazla farklı: Süt +%52. Onaylanana kadar maliyetler şimdiki fiyatla hesaplanır.",
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
  assert.match(five?.detail ?? "", /: Süt \+%52, Kahve −%45, Kakao \+%1100 ve 2 hammadde daha\. /);
  // Şimdiki fiyatı sonradan 0 yapılmış hammadde: yüzde yazılmaz
  assert.equal(holdsSummary([{ name: "Kapak", pct: null }]), "Kapak");
  assert.equal(livePct(0.05, 0), null);
  assert.ok(Math.abs(livePct(0.0486, 0.032)! - 0.51875) < 1e-12);
  assert.equal(holdLogText({ name: "Süt", pct: 0.52, supplier: "Sütaş", date: "2026-10-21" }), "Süt +%52 (Sütaş 21.10.2026)");
});
