// Faturalar ekranının kuralları (src/app/panel/faturalar/rules.ts): Paraşüt kilidi, not / tahmin işareti,
// tedarikçi varsayılanları, silinen Paraşüt faturaları listesi. Excel'deki Faturalar sayfasıyla karşılaştırmalar
// seed verisinden (excel-data.json) yapılır.
// Çalıştırma: npx tsx --test tests/invoices.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  alsoIgnoredOf,
  guessVat,
  ignoredBills,
  isEstimate,
  isParasutLinked,
  joinTR,
  lockedChanges,
  notePreview,
  PARASUT_LOCKED_FIELDS,
  parasutKeysOf,
  sameSupplierOthers,
  splitSupplier,
  supplierDefaults,
  supplierMatchKey,
  visibleNote,
} from "../src/app/panel/faturalar/rules";
import { unpaidSummary } from "../src/lib/calc/insights";
import { eInvoiceDeleted } from "../src/server/parasut/mapping";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const ds = excelToDataset(data);

const base = { date: "2026-10-14", invoiceNo: "SUT2026000123", amount: 7968, discount: 557.76, payable: 7484.34 };

test("Paraşüt kilidi: eşitlemenin yeniden yazdığı alanlar (sync.ts applyDraft common) kilitli", () => {
  assert.deepEqual([...PARASUT_LOCKED_FIELDS], ["date", "invoiceNo", "amount", "discount", "payable"]);
  assert.equal(isParasutLinked({ source: "parasut", externalId: "9001" }), true);
  // Elle/Excel'le girilmiş ama Paraşüt'e bağlanmış satır da kilitli (eşitleme kimlikle günceller)
  assert.equal(isParasutLinked({ source: "excel", externalId: "9001" }), true);
  assert.equal(isParasutLinked({ source: "manual", externalId: null }), false);
  assert.equal(isParasutLinked({ source: "excel" }), false);
});

test("lockedChanges: yalnızca gerçekten değişen kilitli alanlar (kuruş altı fark ve boş/null fatura no sayılmaz)", () => {
  assert.deepEqual(lockedChanges(base, { ...base }), []);
  assert.deepEqual(lockedChanges(base, { ...base, discount: 600 }), ["discount"]);
  assert.deepEqual(lockedChanges(base, { ...base, payable: 7484.344 }), []);
  assert.deepEqual(lockedChanges(base, { ...base, date: "2026-10-15", amount: 8000 }), ["date", "amount"]);
  assert.deepEqual(lockedChanges({ ...base, invoiceNo: null }, { ...base, invoiceNo: "" }), []);
  assert.deepEqual(lockedChanges({ ...base, invoiceNo: null }, { ...base, invoiceNo: " X1 " }), ["invoiceNo"]);
  assert.equal(joinTR(["tarih"]), "tarih");
  assert.equal(joinTR(["tarih", "iskonto"]), "tarih ve iskonto");
  assert.equal(joinTR(["tarih", "tutar", "iskonto"]), "tarih, tutar ve iskonto");
});

test("visibleNote: Paraşüt'ün otomatik notu gizlenir, sonradan eklenen uyarı ve Excel notu görünür", () => {
  assert.equal(visibleNote(null), null);
  assert.equal(visibleNote("Paraşüt'ten alındı · kategori: tedarikçinin önceki faturaları"), null);
  assert.equal(visibleNote("Paraşüt'ten alındı · kategori: kural: tedarikçi “Süt · Peynir”"), null);
  assert.equal(visibleNote("Paraşüt'ten alındı · kategori: eşleşme yok · Paraşüt'te iptal — kontrol edin"), "Paraşüt'te iptal — kontrol edin");
  assert.equal(visibleNote("  Elle not  "), "Elle not");
  const long = "a ".repeat(100).trim();
  const p = notePreview(long);
  assert.ok(p.length <= 141 && p.endsWith("…"), p);
  assert.equal(notePreview("kısa not"), "kısa not");
});

test("Excel parity: hücre notlu 4 fatura (B12–B14 XND, B27 Kaldi) listede notlu, yalnızca sarı satır 27 (Kaldi 14.08) tahmini", () => {
  const noted = ds.invoices.filter((i) => visibleNote(i.note));
  assert.deepEqual(
    noted.map((i) => `${i.date} ${i.supplier}`),
    ["2026-07-13 XND Teknoloji", "2026-07-14 XND Teknoloji", "2026-07-15 XND Teknoloji", "2026-08-14 Kaldi"],
  );
  const estimated = ds.invoices.filter(isEstimate);
  assert.deepEqual(
    estimated.map((i) => `${i.date} ${i.supplier}`),
    ["2026-08-14 Kaldi"],
  );
  assert.equal(isEstimate({ supplier: "Mipak (tahmini)", note: null }), true);
  assert.equal(isEstimate({ supplier: "Mipak", note: "Paraşüt'ten alındı · kategori: eşleşme yok" }), false);
});

test("Excel parity: ödenmemiş toplam I27 = 11.516,77 ₺ (kalan borç; kısmi ödemede Paraşüt'ün kalanı)", () => {
  const s = unpaidSummary(ds.invoices);
  assert.equal(s.count, 1);
  assert.ok(Math.abs(s.total - 11516.77) < 0.005, String(s.total));
  // Kısmen ödenmiş Paraşüt faturası: 10.000 ₺'nin 6.000 ₺'si kaldı → kalan borç 6.000, Ödenecek toplamı 10.000
  const partial = unpaidSummary([{ payable: 10000, unpaid: true, outstanding: 6000 }, { payable: 500, unpaid: false, outstanding: null }]);
  assert.deepEqual(partial, { count: 1, total: 6000, payableTotal: 10000, partialCount: 1 });
});

test("guessVat: Excel'deki oranlar (%0 Opera AVM, %1 Sütaş, %10 Sinan Siner, %20 Opera kira)", () => {
  assert.equal(guessVat({ amount: 793.8, discount: 0, payable: 793.8 }), "0");
  assert.equal(guessVat({ amount: 7968, discount: 557.76, payable: 7484.34 }), "1");
  assert.equal(guessVat({ amount: 10000, discount: 0, payable: 11000 }), "10");
  assert.equal(guessVat({ amount: 35000, discount: 0, payable: 42000 }), "20");
  assert.equal(guessVat(null), "1");
});

test("supplierDefaults: tedarikçinin en son faturası; parantezli not ve büyük/küçük harf aynı tedarikçi", () => {
  const map = supplierDefaults(ds.invoices);
  const sutas = map.get(supplierMatchKey("sütaş"))!;
  assert.equal(sutas.category, "Hammadde & İçecek");
  assert.equal(sutas.vatRate, "1");
  assert.equal(sutas.date, "2026-10-14");
  assert.equal(sutas.count, ds.invoices.filter((i) => i.supplier === "Sütaş").length);
  assert.equal(supplierMatchKey("Kaldi (ödenmedi)"), supplierMatchKey("KALDI"));
  const opera = map.get(supplierMatchKey("Opera AVM"))!;
  assert.equal(opera.category, "Kira & AVM");
  assert.deepEqual(splitSupplier("Kaldi (ödenmedi)"), { base: "Kaldi", note: "ödenmedi" });
});

test("sameSupplierOthers: aynı tedarikçinin farklı kategorideki diğer faturaları", () => {
  const rows = [
    { id: 1, supplier: "Kaldi", category: "Hammadde & İçecek" },
    { id: 2, supplier: "Kaldi (ödenmedi)", category: "Hammadde & İçecek" },
    { id: 3, supplier: "kaldi", category: "Ambalaj" },
    { id: 4, supplier: "Sütaş", category: "Hammadde & İçecek" },
  ];
  assert.deepEqual(sameSupplierOthers(rows, rows[0], "Ambalaj"), [2]);
  assert.deepEqual(sameSupplierOthers(rows, rows[3], "Ambalaj"), []);
});

test("ignoredBills: yok sayılan kimlikler kopyalarıyla birleşir, yeniden eskiye; bozuk değer listeyi düşürmez", () => {
  const list = ignoredBills(
    ["old-1", "b-2", "c-3"],
    [
      { externalId: "b-2", deletedAt: "2026-10-18T10:00:00.000Z", deletedBy: "Okan", row: { supplier: "Sütaş", date: "2026-10-14", invoiceNo: "S1", payable: 100 } },
      { externalId: "c-3", deletedAt: "2026-10-19T10:00:00.000Z", deletedBy: "Okan", row: { supplier: "Kaldi", date: "2026-10-12", invoiceNo: null, payable: 50 } },
      { externalId: "gone", deletedAt: "2026-10-20T10:00:00.000Z", row: { supplier: "X" } },
      null,
    ],
  );
  assert.deepEqual(
    list.map((b) => [b.externalId, b.restorable]),
    [
      ["c-3", true],
      ["b-2", true],
      ["old-1", false],
    ],
  );
  assert.equal(list[1].supplier, "Sütaş");
  assert.equal(list[2].supplier, null);
  assert.deepEqual(ignoredBills(null, "bozuk"), []);
  assert.deepEqual(ignoredBills(["x", 3], undefined).map((b) => b.externalId), ["x"]);
});

test("parasutKeysOf (denetim 21 Kasım #3): gider faturasına bağlı e-faturalı kayıt silinince e-fatura anahtarı da yok sayılır", () => {
  assert.deepEqual(parasutKeysOf({ externalId: "150", eInvoiceId: null }), ["150"]);
  assert.deepEqual(parasutKeysOf({ externalId: null, eInvoiceId: "E150" }), ["ei:E150"]);
  assert.deepEqual(parasutKeysOf({ externalId: "150", eInvoiceId: "E150" }), ["150", "ei:E150"], "ilk anahtar listenin ve Geri al'ın");
  assert.deepEqual(parasutKeysOf({ externalId: null }), []);
  // Eşitlemenin iki yolu da bu anahtarlarla durur: applyEInvoice `ei:<kimlik>`'e, yeniden içeri alınan gider faturası
  // (başka kimlik, aynı e-belge) eInvoiceDeleted'e bakar
  const ignored = new Set(parasutKeysOf({ externalId: "150", eInvoiceId: "E150" }));
  assert.equal(ignored.has("ei:E150"), true);
  assert.equal(eInvoiceDeleted({ eDocument: { type: "e_invoices", id: "E150" } }, ignored), true);
});

test("ignoredBills: silinen faturanın ikinci anahtarı (alsoIgnored) ayrı satır olmaz; ana anahtar düşmüşse görünür", () => {
  const entry = { externalId: "150", alsoIgnored: ["ei:E150"], deletedAt: "2026-11-20T10:00:00.000Z", row: { supplier: "Sütaş", date: "2026-11-18", invoiceNo: "SUT150", payable: 1250 } };
  assert.deepEqual(
    ignoredBills(["old-1", "150", "ei:E150"], [entry]).map((b) => [b.externalId, b.restorable]),
    [
      ["150", true],
      ["old-1", false],
    ],
  );
  // Ana anahtar 2000'lik listeden düşmüşse ikinci anahtar kendi satırıyla kalır (geri alınabilir)
  assert.deepEqual(ignoredBills(["ei:E150"], [entry]).map((b) => b.externalId), ["ei:E150"]);
  // Başka bir faturanın anahtarı gizlenmez
  assert.deepEqual(ignoredBills(["ei:E9"], [entry]).map((b) => b.externalId), ["ei:E9"]);
  assert.deepEqual(alsoIgnoredOf(entry), ["ei:E150"]);
  assert.deepEqual(alsoIgnoredOf({ alsoIgnored: "bozuk" }), []);
  assert.deepEqual(alsoIgnoredOf({ alsoIgnored: ["ei:1", 3, ""] }), ["ei:1"]);
  assert.deepEqual(alsoIgnoredOf(null), []);
});

test("deleteInvoice / unignoreParasutBill kaydın bütün anahtarlarını yazar ve birlikte çıkarır (kaynak)", () => {
  const src = readFileSync(join(root, "src/server/actions/invoices.ts"), "utf8");
  const del = src.slice(src.indexOf("export async function deleteInvoice("), src.indexOf("export async function restoreInvoice("));
  assert.match(del, /const \[key, \.\.\.also\] = parasutKeysOf\(d\);/);
  assert.match(del, /const add = \[key, \.\.\.also\]\.filter\(\(k\) => !ignore\.includes\(k\)\);/);
  assert.match(del, /\.\.\.\(also\.length \? \{ alsoIgnored: also \} : \{\}\)/);
  const un = src.slice(src.indexOf("export async function unignoreParasutBill("));
  assert.match(un, /const keys = new Set\(\[ext, \.\.\.alsoIgnoredOf\(entry\)\]\);/);
  assert.match(un, /ignore\.filter\(\(x\) => !keys\.has\(x\)\)/);
  // Aynı e-fatura başka kayıtta duruyorsa kopya yazılmaz (benzersiz e-fatura kimliği)
  assert.match(un, /eq\(s\.invoices\.eInvoiceId, eInvoiceId\)/);
});
