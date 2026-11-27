// Satış listesinin özet satırı deseni ve yanındaki ad temizliği doğrusal zamanda çalışır (denetim: ReDoS).
// Çalıştırma: npx tsx --test tests/satis-ozet-redos.test.ts
//
// Eski desen `(\s*(…|[\d.,]+|₺))*` iç içe iki yineleme taşıyordu: "toplam 1111…1x" girdisinde rakamların her bölünüşü
// ayrı ayrı deneniyor, süre her rakamda ikiye katlanıyordu (26 rakam ≈ 2 sn, 40 rakam saatler). Desen sunucuda da
// çalışır (Satışlar › İçe aktar, dosya yükleme, Genel bakış), yani tek satır bir isteği kilitleyebiliyordu.
//
// Ölçümler `vm` zaman sınırıyla sarılı: desen yeniden üstel olursa test asılı kalmaz, sınırda kesilip kırmızıya döner.

import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

import { extractSalesRows, isHeaderName, isSummaryRow, parsePastedSales } from "../src/lib/calc/pos-paste";
import { SALES_SUMMARY_PATTERNS } from "../src/lib/constants";

/** `fn`'i en çok `limitMs` çalıştırır (aşarsa fırlatır); geçen süreyi ve sonucu döner */
function timed<T>(fn: () => T, limitMs = 3000): { ms: number; value: T } {
  const t = performance.now();
  const value = vm.runInNewContext("fn()", { fn }, { timeout: limitMs }) as T;
  return { ms: performance.now() - t, value };
}

/** Üç koşunun en hızlısı (çöp toplama ve ilk derleme ölçümü bozmasın) */
function fastest<T>(fn: () => T): { ms: number; value: T } {
  let best = timed(fn);
  for (let i = 0; i < 2; i++) {
    const next = timed(fn);
    if (next.ms < best.ms) best = next;
  }
  return best;
}

/** "Birkaç milisaniye": doğrusal desen bu girdilerde 1 ms'nin altında; pay yavaş CI makinesi için */
const FAST_MS = 50;

// Denetimin girdisi ve aynı kalıbın öbür biçimleri. Özet DEĞİLLER (sonda desene uymayan harf var): eşleşme
// bulunamayınca geri dönüş başlar, üstel süre burada çıkar.
const ADVERSARIAL: [string, string][] = [
  ["denetimin girdisi: 40 rakam", "toplam " + "1".repeat(40) + "x"],
  ["160 karakterlik ad (ürün adı sınırı)", "toplam " + "1".repeat(152) + "x"],
  ["5.000 rakam", "toplam " + "1".repeat(5000) + "x"],
  ["nokta ve virgüllü rakamlar", "toplam " + "1.234,50".repeat(1000) + "x"],
  ["boşlukla ayrılmış rakamlar", "toplam" + " 1".repeat(5000) + " x"],
  ["bitişik sözcükler", "toplam " + "kdvdahil".repeat(2000) + "x"],
  ["öneki ortak sözcükler", "toplam " + "tutari".repeat(2000) + "i"],
  ["satis / satislar", "toplam " + "satislar".repeat(2000) + "lar"],
  ["para simgeleri", "toplam " + "₺".repeat(5000) + "x"],
  ["genel toplama bitişik uzun kuyruk", "genel toplam" + "1".repeat(5000) + "x"],
  ["grand total", "grand " + " ".repeat(5000) + "totalsx"],
];

test("Özet satırı deseni: üstel girdiler birkaç milisaniyede biter", () => {
  for (const [label, input] of ADVERSARIAL) {
    for (const [i, re] of SALES_SUMMARY_PATTERNS.entries()) {
      const r = fastest(() => re.test(input));
      assert.equal(r.value, false, `${label}: desen ${i} özet saymamalı`);
      assert.ok(r.ms < FAST_MS, `${label}: desen ${i} ${r.ms.toFixed(1)} ms sürdü (sınır ${FAST_MS} ms)`);
    }
    const r = fastest(() => isSummaryRow(input));
    assert.equal(r.value, false, `${label}: isSummaryRow`);
    assert.ok(r.ms < FAST_MS, `${label}: isSummaryRow ${r.ms.toFixed(1)} ms sürdü (sınır ${FAST_MS} ms)`);
  }
});

test("Özet satırı deseni: süre girdiyle doğru orantılı büyür (ham desen, boşluk dizisi dahil)", () => {
  // Desen dışa verilir; ad temizliğinden geçmemiş metinde de (arka arkaya boşluk) doğrusal kalmalı
  const shapes: ((n: number) => string)[] = [
    (n) => "toplam " + "1".repeat(n) + "x",
    (n) => "toplam" + " ".repeat(n) + "x",
    (n) => "toplam" + " ".repeat(n) + ":" + " ".repeat(n) + "x",
    (n) => "toplam :" + " 1".repeat(n) + " ".repeat(n) + "x",
    (n) => "ara" + " ".repeat(n) + "toplam" + " ".repeat(n),
  ];
  for (const shape of shapes) {
    for (const re of SALES_SUMMARY_PATTERNS) {
      const big = fastest(() => re.test(shape(200_000)));
      assert.ok(big.ms < 200, `${String(re).slice(0, 30)}… 200.000 karakterde ${big.ms.toFixed(1)} ms (sınır 200 ms)`);
    }
  }
});

// ---------------------------------------------------------------- Davranış aynı

test("Özet satırı: sayılması ve sayılmaması gereken adlar", () => {
  const summary = [
    "Toplam",
    "TOPLAM",
    "Toplam:",
    "Toplam =",
    "Toplamlar:",
    "TOPLAMI",
    "Toplam KDV dahil",
    "Toplam (KDV dahil)",
    "Toplam KDV hariç",
    "Toplam tutar 1.234,50 ₺",
    "Toplam tutarı",
    "Toplam: 437",
    "Toplam 1.234,50",
    "Toplam ₺",
    "TOPLAM CİRO",
    "Toplam satış",
    "Toplam Satışlar",
    "Toplam adet",
    "Toplam net",
    "Toplam brüt TL",
    "Toplam genel",
    "Toplam TRY",
    "Genel Toplam",
    "Genel Toplam (KDV dahil)",
    "GENEL TOPLAM:",
    "Ara toplam",
    "Alt Toplam",
    "Alt toplamı",
    "Genel Toplam Satış",
    "Grand Total",
    "Subtotal",
    "Sub total",
    "Totals",
  ];
  const product = [
    "Toplam Kahve Paketi",
    "Toplama Kahve",
    "Toplam Latte",
    "Toplam 3 Kahve",
    "Toplam KDV dahil menü",
    "Toplamda İndirim",
    "Latte",
    "Total Black",
    "Affogato",
    "Kahve Toplam",
    "Genel Kahve",
    "Aratoplama",
    "",
    "   ",
  ];
  for (const n of summary) assert.equal(isSummaryRow(n), true, `özet sayılmalı: "${n}"`);
  for (const n of product) assert.equal(isSummaryRow(n), false, `özet sayılmamalı: "${n}"`);
});

/** Düzeltmeden önceki desen: yalnız kısa girdide çalıştırılır (karşılaştırmanın dayanağı) */
const OLD_TOTAL = /^toplam(lar|i)?\s*[:=]?(\s*(kdv|dahil|haric|tutar|tutari|ciro|cirosu|satis|satislar|adet|tl|try|net|brut|genel|[\d.,]+|₺))*$/;

test("Özet satırı deseni: eski desenle aynı kararı verir (üretilmiş 150.000'den çok ad)", () => {
  const re = SALES_SUMMARY_PATTERNS[1];
  const heads = ["toplam", "toplamlar", "toplami", "toplama", "toplamla", "toplamlari"];
  const marks = ["", ":", "=", " :", ": ", " = ", "::", "  "];
  const words = ["kdv", "dahil", "haric", "tutar", "tutari", "ciro", "cirosu", "satis", "satislar", "adet", "tl", "try", "net", "brut", "genel"];
  const others = ["1", "12", "1.234,50", ".", ",", "₺", "i", "lar", "su", "x", "kahve", "tu", "tr", ":", "="];
  const parts = [...words, ...others];
  const gaps = ["", " ", "  "];
  let checked = 0;
  const same = (s: string) => {
    checked++;
    assert.equal(re.test(s), OLD_TOTAL.test(s), `"${s}"`);
  };
  for (const head of heads) {
    for (const mark of marks) {
      same(head + mark);
      for (const g1 of gaps) {
        for (const a of parts) {
          same(head + mark + g1 + a);
          same(head + mark + g1 + a + " ");
          for (const g2 of gaps) for (const b of parts) same(head + mark + g1 + a + g2 + b);
        }
      }
    }
  }
  // Üç ve daha çok parça: sabit tohumlu rastgele örnekler
  let seed = 20261128;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  for (let i = 0; i < 20_000; i++) {
    let s = heads[rnd(heads.length)] + marks[rnd(marks.length)];
    const count = 3 + rnd(4);
    for (let k = 0; k < count; k++) s += gaps[rnd(gaps.length)] + parts[rnd(parts.length)];
    same(s);
  }
  assert.ok(checked > 150_000, `karşılaştırılan ad sayısı: ${checked}`);
});

// ---------------------------------------------------------------- Ad temizliği ve satır okuma

/** Düzeltmeden önceki ad temizliği ve özet kararı (kısa girdide; karşılaştırmanın dayanağı) */
function oldIsSummaryRow(name: string): boolean {
  const s = name
    .normalize("NFC")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[:=*.\-–]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const patterns = [/^(genel|ara|alt)\s*toplam(lar|i)?(\s.*)?$/, OLD_TOTAL, /^(grand\s+|sub\s*)?totals?$/];
  return !!s && patterns.some((re) => re.test(s));
}

test("Ad temizliği: parantez ve sondaki işaretler eskisi gibi atılır", () => {
  const pieces = ["Toplam", "TOPLAM", "Genel Toplam", "Ara toplam", "Latte", "Subtotal", "kdv", "dahil", "437", "(KDV dahil)", "(", ")", "((", "))", "()", ":", "=", "*", ".", "-", "–", " ", "  ", "₺"];
  let seed = 7;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  let summaries = 0;
  for (let i = 0; i < 40_000; i++) {
    let s = "";
    const count = 1 + rnd(6);
    for (let k = 0; k < count; k++) s += pieces[rnd(pieces.length)] + (rnd(3) === 0 ? " " : "");
    const want = oldIsSummaryRow(s);
    if (want) summaries++;
    assert.equal(isSummaryRow(s), want, `"${s}"`);
  }
  // Örneklem iki sonucu da içeriyor (hep "değil" diyen bir karşılaştırma boşa geçmesin)
  assert.ok(summaries > 2_000 && summaries < 38_000, `özet sayılan örnek: ${summaries}`);
});

test("Ad temizliği ve satır okuma: çok uzun hücrede de hızlı", () => {
  const n = 200_000;
  const cells: [string, string][] = [
    ["açılan parantezler", "(".repeat(n)],
    ["sondaki iki nokta", "Toplam" + ":".repeat(n) + "x"],
    ["sondaki tireler", "-".repeat(n) + "1"],
    ["ortadaki tırnaklar", "x" + "'".repeat(n) + "x"],
    ["ortadaki çift tırnaklar", "x" + '"'.repeat(n) + "x"],
    ["boşluklar", "a" + " ".repeat(n) + "x"],
  ];
  for (const [label, cell] of cells) {
    const calls: [string, () => unknown][] = [
      ["isSummaryRow", () => isSummaryRow(cell)],
      ["isHeaderName", () => isHeaderName(cell)],
      ["extractSalesRows", () => extractSalesRows([["Ürün", "Adet", "Tutar"], [cell, 1, 2], [cell, cell, cell]]).rows.length],
    ];
    for (const [name, fn] of calls) {
      const r = fastest(fn);
      assert.ok(r.ms < 300, `${label}: ${name} ${r.ms.toFixed(1)} ms sürdü (sınır 300 ms)`);
    }
  }
});

test("Yapıştır: ayraçsız uzun satır tarayıcıyı kilitlemez, olağan satır eskisi gibi okunur", () => {
  const n = 20_000;
  const lines = [
    "a" + ",".repeat(n) + "1" + ",".repeat(n) + "1" + ",".repeat(n) + "x",
    "a" + ", ".repeat(n) + "1" + ", ".repeat(n) + "1" + ", ".repeat(n) + "x",
    "a " + "1.".repeat(n) + " 1" + ".1".repeat(n) + "x",
  ];
  for (const line of lines) {
    const r = fastest(() => parsePastedSales(line).rows.length);
    assert.ok(r.ms < 300, `${line.slice(0, 12)}… ${r.ms.toFixed(1)} ms sürdü (sınır 300 ms)`);
  }
  // Ayraçsız olağan satırlar (tek boşluk ve virgül) değişmedi
  assert.deepEqual(parsePastedSales("Latte Medium 12 2.400\nEspresso, 5, 1.250,50 ₺\nAmericano 3 adet 540 TL").rows, [
    { posName: "Latte Medium", qty: 12, revenue: 2400 },
    { posName: "Espresso", qty: 5, revenue: 1250.5 },
    { posName: "Americano", qty: 3, revenue: 540 },
  ]);
});
