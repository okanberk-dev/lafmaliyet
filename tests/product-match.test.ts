import assert from "node:assert/strict";
import { test } from "node:test";

import { guessLinkFactor, nameCore, parsePack, suggestIngredient } from "../src/lib/product-match";

test("paket bilgisi: gerçek e-fatura kalem adlarından", () => {
  const cases: [string, PackLike][] = [
    ["SÜT %2,5 YAĞLI 1 L", { size: 1000, dim: "volume", count: null }],
    ["ESPRESSO BLEND 1 KG", { size: 1000, dim: "mass", count: null }],
    ["TÜRK KAHVESİ 500 GR", { size: 500, dim: "mass", count: null }],
    ["DAMLA PET330MLX24 THD SPN", { size: 330, dim: "volume", count: 24 }],
    ["COCA-COLA KUTU 330ML 1X24 DYS", { size: 330, dim: "volume", count: 24 }],
    ["COCA-COLA KUTU 330ML1X24 FIFA26", { size: 330, dim: "volume", count: 24 }],
    ["CALLEİ WAFFLE SOS SÜTLÜ 1000 GR * 8 AD", { size: 1000, dim: "mass", count: 8 }],
    ["Bio Fresh Panini Roasbeef Sandviç 140 Gr x18 Ad", { size: 140, dim: "mass", count: 18 }],
    ["Bio Fresh Tahıllı Ekşi Mayalı Salamlı 240Grx15Ad", { size: 240, dim: "mass", count: 15 }],
    ["Danone Laktozsuz Süt 1 Lt x 12 ad", { size: 1000, dim: "volume", count: 12 }],
    ["CDO.PANTHEON.VANILYA.5.5LT.", { size: 5500, dim: "volume", count: null }],
    ["PRE.KAY.SUYU 40CL PET 12TV", { size: 400, dim: "volume", count: 12 }],
    ["LUPİN TİRAMİSU BOMBA KUTU İÇİ 9 ADET", { size: null, dim: null, count: 9 }],
    ["TİRAMİSU PASTA 28 CM KUTU İÇİ 12 DİLİM", { size: null, dim: null, count: 12 }],
    ["Dvg Karamel Aromalı Sos (Caramel) 2 Lt", { size: 2000, dim: "volume", count: null }],
    ["MATCHA PREMIUM CEREMONY 6A", { size: null, dim: null, count: null }],
    ["KARTON BARDAK 4OZ LAF", { size: null, dim: null, count: null }],
  ];
  for (const [name, want] of cases) {
    const p = parsePack(name);
    assert.deepEqual({ size: p.size?.amount ?? null, dim: p.size?.dim ?? null, count: p.count }, want, name);
  }
});
type PackLike = { size: number | null; dim: "mass" | "volume" | null; count: number | null };

test("çarpan tahmini: faturadaki birim ve hammadde birimine göre", () => {
  // Ölçü birimiyle gelen kalem doğrudan çevrilir
  assert.equal(guessLinkFactor({ name: "MATCHA PREMIUM CEREMONY 6A", unit: "kg" }, "gr"), "1000");
  assert.equal(guessLinkFactor({ name: "Limon Özü", unit: "lt" }, "ml"), "1000");
  assert.equal(guessLinkFactor({ name: "Limon Özü", unit: "lt" }, "gr"), null);
  // Tek ürün: addaki boyut
  assert.equal(guessLinkFactor({ name: "SÜT %2,5 YAĞLI 1 L", unit: "Adet" }, "ml"), "1000");
  assert.equal(guessLinkFactor({ name: "ESPRESSO BLEND 1 KG", unit: "Adet" }, "gr"), "1000");
  assert.equal(guessLinkFactor({ name: "CDO.PANTHEON.VANILYA.5.5LT.", unit: "Adet" }, "ml"), "5500");
  // Tek üründe "* 8 AD" kolideki sayıdır, faturadaki birim tek kavanoz
  assert.equal(guessLinkFactor({ name: "CALLEİ WAFFLE SOS SÜTLÜ 1000 GR * 8 AD", unit: "Adet" }, "gr"), "1000");
  assert.equal(guessLinkFactor({ name: "Cupffee 220ML", unit: "Adet" }, "adet"), "1");
  // Paket: sayı × boyut; sayı yoksa tahmin yok
  assert.equal(guessLinkFactor({ name: "COCA-COLA KUTU 330ML 1X24 DYS", unit: "Kutu" }, "adet"), "24");
  assert.equal(guessLinkFactor({ name: "COCA-COLA KUTU 330ML 1X24 DYS", unit: "Kutu" }, "ml"), "7920");
  assert.equal(guessLinkFactor({ name: "PRE.KAY.SUYU 40CL PET 12TV", unit: "Koli" }, "ml"), "4800");
  assert.equal(guessLinkFactor({ name: "LUPİN TİRAMİSU BOMBA KUTU İÇİ 9 ADET", unit: "Kutu" }, "adet"), "9");
  assert.equal(guessLinkFactor({ name: "TİRAMİSU PASTA 28 CM KUTU İÇİ 12 DİLİM", unit: "Kutu" }, "dilim"), "12");
  assert.equal(guessLinkFactor({ name: "LUPİN TİRAMİSU BOMBA KUTU İÇİ 9 ADET", unit: "Kutu" }, "gr"), null);
  assert.equal(guessLinkFactor({ name: "MANGO MEYVELİM KUTU", unit: "Kutu" }, "adet"), null);
  // Ağırlık ile hacim birbirine çevrilmez
  assert.equal(guessLinkFactor({ name: "SÜT 1 L", unit: "Adet" }, "gr"), null);
});

test("hammadde önerisi: aynı adlı bağlı ürün, sonra ad eşleşmesi (ek almış sözcükler dahil)", () => {
  const ings = [
    { id: 1, name: "Süt", unit: "ml" },
    { id: 2, name: "Laktozsuz Süt", unit: "ml" },
    { id: 3, name: "Espresso Çekirdek", unit: "gr" },
    { id: 4, name: "Türk Kahvesi", unit: "gr" },
    { id: 5, name: "Su", unit: "ml" },
  ];
  assert.deepEqual(suggestIngredient("SÜT LAKTOZSUZ 1 L", ings), { ingredientId: 2, factor: null, reason: "name" });
  assert.deepEqual(suggestIngredient("SÜT %2,5 YAĞLI 1 L", ings), { ingredientId: 1, factor: null, reason: "name" });
  assert.deepEqual(suggestIngredient("ESPRESSO ÇEKİRDEĞİ 1 KG", ings), { ingredientId: 3, factor: null, reason: "name" });
  assert.deepEqual(suggestIngredient("TÜRK KAHVESİ 500 GR", ings), { ingredientId: 4, factor: null, reason: "name" });
  // İki harfli hammadde adı ("Su") her kaleme önerilmez
  assert.equal(suggestIngredient("PRE.KAY.SUYU 40CL PET 12TV", ings), null);
  // Aynı ürün başka faturadan (farklı boyut yazımıyla) gelmişse önceki bağlantı ve çarpanı önerilir
  const links = [{ productName: "ESPRESSO BLEND 1 KG", ingredientId: 3, factor: 1000 }];
  assert.deepEqual(suggestIngredient("Espresso Blend 1kg", ings, links), { ingredientId: 3, factor: 1000, reason: "link" });
  assert.equal(nameCore("ESPRESSO BLEND 1 KG"), nameCore("Espresso Blend 1kg"));
});
