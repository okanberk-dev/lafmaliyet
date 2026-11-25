// Stok sayımında telefonda gecikmesiz yazım (denetim 27 Eki 2026 B04, E-21): satır memo'lu, sayaçlar / toplamlar /
// FIFO payı ertelenmiş değerlerle, döküm yalnız pencere açılınca; formdaki miktarın kuralı tek yerde (formQty).
// Ölçüm (üretim derlemesi, 390 px, 4× yavaş işlemci, Playwright Event Timing) PR gövdesinde.
// Çalıştırma: npx tsx --test tests/sayim-hiz.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  countedLineIds,
  formProgress,
  formQty,
  groupProgress,
  invalidCount,
  parseCount,
  withoutId,
  type FormQtyLine,
} from "../src/app/panel/sayim/logic";
import { parseNumberTR } from "../src/lib/calc/expr";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const line = (id: number, over: Partial<FormQtyLine> = {}): FormQtyLine => ({ id, archived: false, qty: null, unitNow: "KG", countUnit: "KG", ...over });

test("formQty: arşiv satırı kayıtlı miktar, boş kutu sayılmadı, KG'de nokta ondalık, ADET'te binlik", () => {
  assert.equal(formQty(line(1, { archived: true, qty: 4 }), "99"), 4, "arşiv satırı yazıyı okumaz");
  assert.equal(formQty(line(1), undefined), null);
  assert.equal(formQty(line(1), "   "), null);
  assert.equal(formQty(line(1), "1.500"), 1.5);
  assert.equal(formQty(line(1, { unitNow: "ADET", countUnit: "ADET" }), "1.500"), 1500);
  assert.equal(formQty(line(1), "2,5"), 2.5);
  assert.equal(formQty(line(1), "abc"), null);
  // Sayım birimi kalktı (Sayılmaz) ama satır arşive düşmedi: kayıtlı birimle okunur
  assert.equal(formQty(line(1, { unitNow: null, countUnit: "LT" }), "0.75"), 0.75);
  // Eski formun kuralıyla aynı (parseCount + bugünkü birim)
  for (const raw of ["3", "0", "1.250", "12,5", "1.234,5", "-2", "x"]) {
    for (const unit of ["KG", "LT", "ADET", "DİLİM"]) {
      assert.equal(formQty(line(7, { unitNow: unit, countUnit: unit }), raw), parseCount(raw, unit, parseNumberTR), `${raw} ${unit}`);
    }
  }
});

test("invalidCount: yazı var ama sayı değil ya da eksi; boş ve arşiv satırı geçersiz değil", () => {
  assert.equal(invalidCount(line(1), "abc"), true);
  assert.equal(invalidCount(line(1), "-1"), true);
  assert.equal(invalidCount(line(1), "0"), false);
  assert.equal(invalidCount(line(1), ""), false);
  assert.equal(invalidCount(line(1), undefined), false);
  assert.equal(invalidCount(line(1, { archived: true, qty: 2 }), "abc"), false);
});

test("withoutId: kimlik kümede yoksa aynı küme (durum değişmez), varsa yeni küme; eskisi değişmez", () => {
  const s = new Set([1, 2, 3]);
  assert.equal(withoutId(s, 9), s, "aynı başvuru: React yeniden çizmez");
  const t = withoutId(s, 2);
  assert.notEqual(t, s);
  assert.deepEqual([...t], [1, 3]);
  assert.deepEqual([...s], [1, 2, 3], "eski küme dokunulmadı");
});

test("formProgress: sayılan kalem eski kuralla aynı (doldurulmuş ve arşiv satırı sayılmaz), grup grup", () => {
  const groups = [
    { name: "Süt", lines: [line(1), line(2), line(3, { archived: true, qty: 5 }), line(4)] },
    { name: "Kahve", lines: [line(5), line(6)] },
    { name: "Boş grup", lines: [line(7, { archived: true, qty: 1 })] },
  ];
  const values: Record<number, string> = { 1: "2", 2: "", 3: "9", 4: "1,5", 5: "abc", 6: "0" };
  const prefilled = new Set([4]);
  const ids = countedLineIds(
    groups.flatMap((g) => g.lines),
    values,
    prefilled,
  );
  // 1 sayıldı, 2 boş, 3 arşiv, 4 doldurulmuş (dokunulmadı), 5 okunamadı, 6 sıfır = sayıldı
  assert.deepEqual(ids, [1, 6]);
  const p = formProgress(groups, new Set(ids));
  assert.deepEqual(
    p.groups.map((g) => [g.name, g.counted, g.total, g.done]),
    [
      ["Süt", 1, 3, false],
      ["Kahve", 1, 2, false],
      ["Boş grup", 0, 0, false],
    ],
  );
  assert.equal(p.counted, 2);
  assert.equal(p.total, 5);
  assert.equal(p.remaining, 3);
  assert.equal(p.share, 2 / 5);
  assert.equal(p.complete, false);
  // Eski formun hesabı: sayılabilir satırlardan miktarı olan ve doldurulmamış olanlar; grup çipleri groupProgress
  const countable = groups.flatMap((g) => g.lines).filter((l) => !l.archived);
  const old = countable.filter((l) => formQty(l, values[l.id]) !== null && !prefilled.has(l.id)).length;
  assert.equal(p.counted, old);
  assert.deepEqual(
    p.groups,
    groupProgress(groups, (l) => formQty(l, values[l.id]) !== null && !prefilled.has(l.id)),
  );
  // Hepsi sayılınca tamam; liste boşsa tamam değil
  const all = formProgress(groups, new Set([1, 2, 4, 5, 6]));
  assert.equal(all.complete, true);
  assert.equal(all.share, 1);
  assert.equal(formProgress([], new Set()).complete, false);
  assert.equal(formProgress([], new Set()).share, 0);
});

test("sayılmış satırı düzeltmek ilerlemenin anahtarını değiştirmez (sayaçlar ve araç çubuğu yeniden çizilmez)", () => {
  const lines = [line(1), line(2), line(3)];
  const key = (values: Record<number, string>) => countedLineIds(lines, values, new Set()).join(",");
  assert.equal(key({ 1: "1" }), key({ 1: "12,5" }));
  assert.notEqual(key({ 1: "1" }), key({ 1: "1", 2: "3" }));
  assert.notEqual(key({ 1: "1" }), key({ 1: "" }));
});

test("form: satır memo'lu ve yalnız kendi değerini alır; işleyiciler sabit; sayaçlar ve toplamlar ertelenmiş", () => {
  const form = read("src/app/panel/sayim/stock-form.tsx");
  assert.match(form, /const CountRow = memo\(function CountRow\(/);
  // Satıra formun bütün değerleri değil, yalnız kendi yazısı ve işaretleri gider
  assert.match(
    form,
    /<CountRow\s+key=\{l\.id\}\s+line=\{l\}\s+raw=\{values\[l\.id\] \?\? ""\}\s+isPrefilled=\{prefilled\.has\(l\.id\)\}\s+conflict=\{conflicts\.has\(l\.id\)\}\s+isAdmin=\{isAdmin\}\s+monthLabel=\{monthLabel\}\s+last=\{l\.id === lastInputId\}\s+onChange=\{setLine\}\s+onConfirm=\{confirmPrefill\}\s+\/>/,
  );
  // setLine sabit (boş bağımlılık), işlevsel güncelleme; işaret yoksa küme aynı kalır
  assert.match(
    form,
    /const setLine = useCallback\(\(id: number, value: string\) => \{\s+setValues\(\(x\) => \(x\[id\] === value \? x : \{ \.\.\.x, \[id\]: value \}\)\);\s+setPrefilled\(\(x\) => withoutId\(x, id\)\);\s+setConflicts\(\(x\) => withoutId\(x, id\)\);\s+\}, \[\]\);/,
  );
  // Ertelenmiş değerler: ilerleme, toplamlar, FIFO payı ve döküm yalnız deferred'dan
  assert.match(form, /const deferred = useDeferredValue\(typed\);/);
  assert.match(form, /countedLineIds\(countable, deferred\.values, deferred\.prefilled\)/);
  // Listede olmayan kalemlerin KDV'si Ayarlar'dan (gıdanın alış KDV'si)
  assert.match(form, /liveTotals\(groups, \(l\) => formQty\(byId\.get\(l\.id\)!, deferred\.values\[l\.id\]\), deferredExtras, extrasVatRate\)/);
  assert.match(form, /lineLayers\(l, formQty\(l, deferred\.values\[l\.id\]\)\)/);
  assert.match(form, /const breakdown = useCallback\(\(\) => stockBreakdown\(groups, \(l\) => formQty\(l, deferred\.values\[l\.id\]\), deferredExtras\)/);
  // Döküm her çizimde kurulmaz: karta işlev olarak gider
  assert.equal([...form.matchAll(/stockBreakdown\(/g)].length, 1);
  assert.match(form, /groups=\{breakdown\}/);
  assert.doesNotMatch(form, /liveTotals\([^)]*\bvalues\[/, "toplam güncel değerlerle kurulmaz");
  // İlerleme, stok kartı ve araç çubuğu memo'lu
  assert.match(form, /const ProgressCard = memo\(function ProgressCard\(/);
  assert.match(form, /const StockTotalCard = memo\(function StockTotalCard\(/);
  assert.match(form, /const CountToolbar = memo\(function CountToolbar\(/);
  // Kaydetme güncel değerlerle (ertelenmiş sayaç bir tuş geride olabilir)
  assert.match(form, /ingredientId: l\.id, qty: qtyOf\(l\), base: l\.qty/);
  assert.match(form, /const qtyOf = \(l: FormLine\) => formQty\(l, values\[l\.id\]\);/);
  assert.match(form, /const savedCount = countable\.filter\(\(l\) => qtyOf\(l\) !== null && !prefilled\.has\(l\.id\)\)\.length;/);
  // "Kalan" süzgeci sayaçla aynı satırları gösterir: boş ya da geçen aydan doldurulup kontrol edilmemiş
  assert.match(form, /setEmptyIds\(new Set\(countable\.filter\(\(l\) => qtyOf\(l\) === null \|\| prefilled\.has\(l\.id\)\)\.map\(\(l\) => l\.id\)\)\)/);
  // Telefonda gizli kaydetme kapsülü kurulmaz (ilk tuşta sayfanın alt boşluğu değişmesin)
  assert.match(form, /<FloatingBar open=\{dirty && wide\}/);
  assert.match(form, /const wide = useMediaQuery\("\(width >= 64rem\)"\);/);
});

test("döküm penceresi: işlev olarak verilen döküm yalnız pencere açıkken kurulur", () => {
  const src = read("src/components/ui/stat-breakdown.tsx");
  assert.match(src, /groups: BreakdownGroup\[\] \| \(\(\) => BreakdownGroup\[\]\);/);
  assert.match(src, /const prepared = open \? prepareBreakdown\(typeof groups === "function" \? groups\(\) : groups, \{ total, order \}\) : null;/);
});
