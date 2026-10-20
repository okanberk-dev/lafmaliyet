import assert from "node:assert/strict";
import { test } from "node:test";

import { addIgnored, IGNORED_PRODUCTS_MAX, parseIgnored, removeIgnored, type IgnoredProduct } from "../src/lib/product-ignore";

const item = (productKey: string, at = "2026-10-20T10:00:00.000Z"): IgnoredProduct => ({ productKey, productName: productKey.toUpperCase(), at });

test("hammadde değil listesi: bozuk satırlar atılır", () => {
  assert.deepEqual(parseIgnored(null), []);
  assert.deepEqual(parseIgnored({ productKey: "a" }), []);
  assert.deepEqual(parseIgnored([item("d:klise"), { productKey: "", productName: "x", at: "t" }, { productKey: "p:1" }, "x", null]), [item("d:klise")]);
});

test("hammadde değil listesi: yeni kayıt başa, aynı ürün bir kez, üst sınır", () => {
  const list = addIgnored(addIgnored([], item("d:klise")), item("d:nakliye"));
  assert.deepEqual(
    list.map((e) => e.productKey),
    ["d:nakliye", "d:klise"],
  );
  // Aynı ürün yeniden işaretlenince eski kaydı düşer, en yeni olarak başa gelir
  const again = addIgnored(list, item("d:klise", "2026-10-21T10:00:00.000Z"));
  assert.deepEqual(
    again.map((e) => e.productKey),
    ["d:klise", "d:nakliye"],
  );
  assert.equal(again[0].at, "2026-10-21T10:00:00.000Z");
  let big: IgnoredProduct[] = [];
  for (let i = 0; i < IGNORED_PRODUCTS_MAX + 5; i++) big = addIgnored(big, item(`p:${i}`));
  assert.equal(big.length, IGNORED_PRODUCTS_MAX);
  assert.equal(big[0].productKey, `p:${IGNORED_PRODUCTS_MAX + 4}`);
});

test("hammadde değil listesi: geri alınan ürün çıkar, diğerleri kalır", () => {
  const list = [item("d:klise"), item("d:nakliye")];
  assert.deepEqual(removeIgnored(list, "d:klise"), [item("d:nakliye")]);
  assert.deepEqual(removeIgnored(list, "yok"), list);
});
