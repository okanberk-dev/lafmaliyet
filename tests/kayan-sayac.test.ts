import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { format, isNegative, measure, toCells } from "../src/components/ui/animated-counter-core";
import { num } from "../src/lib/format";

/** Sayacın ekrana yazdığı metin (eksi işareti dahil, ₺ hariç) */
const shown = (v: number, decimals = 0) => {
  const shape = measure(v, decimals, 1, 0.6);
  return `${isNegative(shape) ? "-" : ""}${format(shape)}`;
};

test("kayan sayaç Türkçe yazar: binlik nokta, ondalık virgül", () => {
  assert.equal(shown(12500), "12.500");
  assert.equal(shown(1234567.891, 2), "1.234.567,89");
  assert.equal(shown(0), "0");
  assert.equal(shown(999), "999");
  assert.equal(shown(-57065), "-57.065");
  assert.equal(shown(12500.5, 2), "12.500,50");
});

test("kayan sayaç num() / tl() ile aynı rakamı yazar (yuvarlama dahil)", () => {
  const values = [0, 0.4, 0.5, 1.5, 2.5, 12.345, 495.49, 1279.5, 24774.25, 33633.75, 351760, 1e9 + 0.5, -0.4, -1.5, -295.5];
  for (const v of values) {
    for (const d of [0, 2]) {
      assert.equal(shown(v, d), num(v, d, d), `değer ${v}, ${d} ondalık`);
    }
  }
});

test("sıfıra yuvarlanan eksi değer işaretsiz, geçersiz değer 0", () => {
  assert.equal(shown(-0.4), "0");
  assert.equal(shown(Number.NaN), "0");
  assert.equal(shown(Number.POSITIVE_INFINITY), "0");
});

test("basamak anahtarı sağdan konumdur: sayı büyüyünce eski sütunlar yerinde kalır", () => {
  const keys = (v: number) => {
    const shape = measure(v, 0, 1, 0.6);
    return toCells(format(shape), shape.width)
      .filter((c) => c.kind === "digit")
      .map((c) => c.key);
  };
  // 999 → 1.000: birler, onlar, yüzler aynı anahtarla kalır, binler yeni gelir
  assert.deepEqual(keys(999), [3, 2, 1]);
  assert.deepEqual(keys(1000), [4, 3, 2, 1]);
  const marks = (() => {
    const shape = measure(1234567, 0, 1, 0.6);
    return toCells(format(shape), shape.width).filter((c) => c.kind === "mark");
  })();
  assert.equal(marks.length, 2);
  assert.equal(new Set(marks.map((m) => m.key)).size, 2, "nokta anahtarları tekil");
});

test("panel kartlarının sayaçları kayan sayacı kullanır, ekran okuyucuya son değer gider", () => {
  const root = path.join(__dirname, "..");
  const read = (p: string) => readFileSync(path.join(root, p), "utf8");
  for (const p of [
    "src/app/panel/dashboard-number.tsx",
    "src/app/panel/satislar/sales-client.tsx",
    "src/app/panel/tedarikciler/suppliers-client.tsx",
  ]) {
    assert.match(read(p), /<TlCounter /, p);
  }
  const counter = read("src/components/ui/animated-counter.tsx");
  assert.match(counter, /className="sr-only"/);
  assert.match(counter, /aria-hidden className="inline-flex select-none/);
  // sunucu HTML'i ve hidrasyon hareketsiz: panelin ortak hareket kancası
  assert.match(counter, /useCalmMotion\(\)/);
});
