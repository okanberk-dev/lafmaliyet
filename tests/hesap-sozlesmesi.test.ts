// Hesap sözleşmesi (docs/hesap-sozlesmesi.md): LafPOS ile ladmin'in ortak hesap belgesi iki depoda bayt bayt aynıdır.
// Bu test belgenin SHA-256 özetini sabitler; LafPOS'taki tests/hesap-sozlesmesi.test.ts aynı sabiti taşır. Belge
// değişince iki kopya ve iki test aynı PR serisinde güncellenir.
// Çalıştırma: npx tsx --test tests/hesap-sozlesmesi.test.ts

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/** docs/hesap-sozlesmesi.md'nin SHA-256 özeti (LafPOS ile aynı) */
const HESAP_SOZLESMESI_SHA256 = "d0f28629536fdb7e77a42ce37f30e45989f849071dd926d41e64a48525ed41d1";

const root = join(__dirname, "..");

test("hesap sözleşmesi: belge LafPOS'taki kopyayla bayt bayt aynı (SHA-256 sabit)", () => {
  const doc = readFileSync(join(root, "docs/hesap-sozlesmesi.md"));
  assert.equal(createHash("sha256").update(doc).digest("hex"), HESAP_SOZLESMESI_SHA256);
});

test("hesap sözleşmesi: LafPOS belgesinden bağlantılı", () => {
  assert.match(readFileSync(join(root, "docs/LAFPOS.md"), "utf8"), /\]\((\.\/)?hesap-sozlesmesi\.md\)/);
});
