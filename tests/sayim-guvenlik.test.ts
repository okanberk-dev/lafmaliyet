// Stok sayımında personelin hatası ve iki kişinin aynı anda sayması: noktalı yazım (1.500 KG = 1,5), geçen aya göre
// olağan dışı miktar, başkasının kaydıyla birleştirme, personelin sayabildiği aylar (src/app/panel/sayim/logic.ts) ve
// sunucunun çakışmada üzerine yazmaması.
// Çalıştırma: npx tsx --test tests/sayim-guvenlik.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { countText, mergeCounts, parseCount, staffCountIssue, staffCountMonths, unusualCount } from "../src/app/panel/sayim/logic";
import { parseNumberTR } from "../src/lib/calc/expr";

const p = (raw: string, unit: string) => parseCount(raw, unit, parseNumberTR);

test("sayım kutusu: KG/LT'de nokta ondalık, ADET'te Türkçe binlik; kayıtlı değer aynı okunur", () => {
  assert.equal(p("1.500", "KG"), 1.5);
  assert.equal(p("2.5", "LT"), 2.5);
  assert.equal(p("1,5", "KG"), 1.5);
  assert.equal(p("1.500", "ADET"), 1500);
  assert.equal(p("12", "DİLİM"), 12);
  assert.equal(p(" ", "KG"), null);
  assert.equal(p("abc", "KG"), null);
  // Kutuya yazılan kayıtlı değer binlik ayırıcısız: KG'de 1500 yeniden 1500 okunur (1,5 değil)
  for (const [qty, unit] of [
    [1500, "KG"],
    [1.5, "KG"],
    [0.125, "LT"],
    [1500, "ADET"],
    [3, "DİLİM"],
  ] as const) {
    assert.equal(p(countText(qty), unit), qty, `${qty} ${unit}`);
  }
  assert.equal(countText(null), "");
  assert.equal(countText(1.23456), "1,235");
});

test("olağan dışı miktar: beş katı ya da beşte biri; sıfır ve küçük değişim uyarılmaz", () => {
  assert.equal(unusualCount(15, 2), "high");
  assert.equal(unusualCount(1500, 1.2), "high");
  assert.equal(unusualCount(2.5, 0.5), null, "küçük miktarda 2 birimden az artış");
  assert.equal(unusualCount(0.3, 2), "low");
  assert.equal(unusualCount(0, 2), null, "bitti olabilir");
  assert.equal(unusualCount(3, 2), null);
  assert.equal(unusualCount(5, null), null);
  assert.equal(unusualCount(0.1, 0.4), null, "geçen ay 1'den azsa düşüş uyarılmaz");
});

test("birleştirme: dokunulmayan satır başkasının kaydını alır, ikisi de değiştirdiyse çakışma", () => {
  const read = (_: number, raw: string) => p(raw, "KG");
  const before = new Map<number, number | null>([
    [1, 2],
    [2, 3],
    [3, null],
    [4, 5],
  ]);
  const after = new Map<number, number | null>([
    [1, 4], // başkası 4 yazdı; ben dokunmadım
    [2, 3.5], // başkası 3,5; ben 3,2 yazdım → çakışma
    [3, 1], // başkası 1; ben de 1 yazdım → çakışma değil
    [4, 5], // değişmedi
  ]);
  const r = mergeCounts({ 1: "2", 2: "3,2", 3: "1", 4: "6" }, before, after, read);
  assert.deepEqual(r.values, { 1: "4", 2: "3,2", 3: "1", 4: "6" });
  assert.deepEqual(r.conflicts, [2]);
  // Sayımı silinen satır
  const gone = mergeCounts({ 1: "2" }, new Map([[1, 2]]), new Map([[1, null]]), read);
  assert.deepEqual(gone, { values: { 1: "" }, conflicts: [] });
});

test("personel bu ayı, geçen ayı yalnız ilk 10 günde sayar; sunucu çakışmada üzerine yazmaz", () => {
  assert.deepEqual(staffCountMonths(new Date("2026-11-01T06:00:00Z")), ["2026-11", "2026-10"]);
  // Ayın ilk saatleri Türkiye'de yeni ay (iş günü hâlâ 31 Ekim: Ekim de açık)
  assert.deepEqual(staffCountMonths(new Date("2026-10-31T22:30:00Z")), ["2026-11", "2026-10"]);
  assert.deepEqual(staffCountMonths(new Date("2026-11-03T09:00:00Z")), ["2026-11", "2026-10"]);
  assert.deepEqual(staffCountMonths(new Date("2026-11-10T20:00:00Z")), ["2026-11", "2026-10"], "10. gün dahil");
  assert.deepEqual(staffCountMonths(new Date("2026-11-25T09:00:00Z")), ["2026-11"]);
  // 11 Kasım 03:00 TR: iş günü 10 Kasım, geçen ay hâlâ açık
  assert.deepEqual(staffCountMonths(new Date("2026-11-11T00:00:00Z")), ["2026-11", "2026-10"]);
  assert.deepEqual(staffCountMonths(new Date("2026-11-11T06:00:00Z")), ["2026-11"]);
  // Ret metni: geçen ay pencere dışında yöneticiye yönlendirir; yönetici her ayı yazar
  const late = new Date("2026-11-25T09:00:00Z");
  assert.equal(staffCountIssue("staff", "2026-10", late), "Geçen ayın sayımı ayın 10'undan sonra yalnız yönetici tarafından düzeltilebilir; yöneticine haber ver.");
  assert.equal(staffCountIssue("staff", "2026-11", late), null);
  assert.match(staffCountIssue("staff", "2026-07", late) ?? "", /yöneticiye yazın/);
  assert.equal(staffCountIssue("admin", "2026-10", late), null);
  assert.equal(staffCountIssue("admin", "2025-01", late), null);
  const stock = readFileSync(join(process.cwd(), "src/server/actions/stock.ts"), "utf8");
  assert.match(stock, /const monthIssue = staffCountIssue\(me\.role, m\);\s+if \(monthIssue\) throw new UserError\(monthIssue\);/);
  assert.match(stock, /return now !== e\.base && now !== e\.qty;/);
  const extras = readFileSync(join(process.cwd(), "src/app/panel/sayim/actions.ts"), "utf8");
  assert.match(extras, /const monthIssue = staffCountIssue\(me\.role, m\);\s+if \(monthIssue\) throw new UserError\(monthIssue\);/);
  // Form taban değeri gönderir; ağ hatasında düğmeler kilitli kalmaz
  const form = readFileSync(join(process.cwd(), "src/app/panel/sayim/stock-form.tsx"), "utf8");
  assert.match(form, /ingredientId: l\.id, qty: qtyOf\(l\), base: l\.qty/);
  assert.match(form, /\} finally \{\s*setBusy\(false\);/);
});
