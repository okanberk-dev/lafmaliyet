// LafPOS satışlarının aylık maliyet modeline girmesi (docs/LAFPOS.md › Günlük satış; denetim B08, E-08): her gün tek
// kaynak (geçiş ayında ModPOS listesi kendi son gününe kadar, LafPOS ondan sonra; sonraki aylarda yalnız LafPOS), geçiş
// günü yokken hiçbir şey değişmez, LafPOS ay toplamları modelde ModPOS satırları gibi sayılır (Tutarlılık, Ürünler,
// Analiz, Genel bakış, KDV tahmininin karaoke payı), Satışlar'ın bandı ve uyarıları, ModPOS listesi yükleme kuralı.
// Veritabanı tarafı (veri kümesi, sonradan eşleştirme, tahmin, silme engeli) tests/lafpos-satis-db.test.ts'te.
// Çalıştırma: npx tsx --test tests/lafpos-satis.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel } from "../src/lib/calc/engine";
import type { Dataset, SalesLine } from "../src/lib/calc/types";
import { posVat, vatMonthInputs } from "../src/lib/kdv";
import {
  dayRangeTR,
  lafposMonthNotes,
  lafposMonthStatus,
  lafposSalesCountFrom,
  mergeSalesSources,
  modposImportRule,
  modposOverZText,
  modposThroughOf,
  type LafposMonthLine,
} from "../src/lib/lafpos/sales";
import { branchSwitchDay, LAFPOS_BRANCH_ID, lafposCountFrom, lafposSalesFrom, modposListCounts, monthSource } from "../src/lib/lafpos/switch";
import { addDays, dayAblativeTR, monthEnd, shiftMonth } from "../src/lib/reminders";
import { readCoverage } from "../src/lib/sales-coverage";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
/** dayMonthTR'nin bölünmez boşluğu düz boşluğa, aralığın sözcük birleştiricisi atılır (metin karşılaştırması okunur kalsın) */
const plain = (s: string) => s.replace(/\u00a0/g, " ").replace(/\u2060/g, "");

/** ModPOS listesinin satırı; şubesi verilmezse LafPOS'un şubesinin (Marina) listesi (21 Kasım kararı) */
const line = (o: Partial<SalesLine> & Pick<SalesLine, "id" | "month" | "posName">): SalesLine => ({ qty: 1, revenue: 100, productId: null, isService: false, note: null, branchId: "marina", ...o });
const laf = (o: Partial<LafposMonthLine> & Pick<LafposMonthLine, "month" | "posName">): LafposMonthLine => ({ productId: null, isService: false, qty: 1, revenue: 100, days: 1, ...o });

test("geçiş günü: ayın LafPOS'u hangi günden sayılır, ModPOS listesi sayılır mı", () => {
  const S = "2026-11-10";
  assert.equal(lafposSalesFrom("2026-10", S, null), null, "geçişten önceki ay: LafPOS sayılmaz");
  assert.equal(lafposSalesFrom("2026-11", S, null), S, "geçiş ayı, liste yok: geçiş gününden");
  assert.equal(lafposSalesFrom("2026-11", S, "2026-11-09"), S, "liste geçiş gününden önceki güne kadar");
  assert.equal(lafposSalesFrom("2026-11", S, "2026-11-04"), S, "liste kısa: LafPOS yine geçiş gününden (aradaki günler eksik)");
  assert.equal(lafposSalesFrom("2026-11", S, "2026-11-20"), "2026-11-21", "liste geçiş gününü aşıyor: kapsadığı günler LafPOS'tan sayılmaz");
  assert.equal(lafposSalesFrom("2026-11", S, "2026-11-30"), null, "ayın tamamının listesi: LafPOS o ay sayılmaz");
  assert.equal(lafposSalesFrom("2026-12", S, "2026-12-31"), "2026-12-01", "sonraki ay: liste ne olursa olsun ayın 1'inden");
  assert.equal(lafposSalesFrom("2026-11", null, null), null, "geçiş günü yok");
  assert.equal(lafposSalesFrom("2026-12", "2026-12-01", "2026-12-15"), "2026-12-01", "ayın 1'i: ay bütünüyle LafPOS");
  assert.deepEqual(["2026-10", "2026-11", "2026-12"].map((m) => modposListCounts(m, S)), [true, true, false]);
  assert.deepEqual(["2026-11", "2026-12"].map((m) => modposListCounts(m, "2026-12-01")), [true, false]);
  assert.equal(modposListCounts("2027-05", null), true);
  // Bütün aylar için tek alt sınır
  assert.equal(lafposCountFrom(null, null), null);
  assert.equal(lafposCountFrom(S, null), S);
  assert.equal(lafposCountFrom(S, "2026-11-20"), "2026-11-21");
  assert.equal(lafposCountFrom(S, "2026-11-30"), "2026-12-01");
  assert.equal(lafposCountFrom("2026-12-01", "2026-12-31"), "2026-12-01");
  // Listenin son günü: kapsam kaydı, yoksa ayın sonu; tek sınır yalnız geçiş ayının listesine bakar
  assert.equal(modposThroughOf("2026-11", { "2026-11": "2026-11-09" }), "2026-11-09");
  assert.equal(modposThroughOf("2026-11", {}), "2026-11-30");
  const lines = [line({ id: 1, month: "2026-11", posName: "LATTE" })];
  assert.equal(lafposSalesCountFrom(S, lines, {}), "2026-12-01", "kayıtsız liste ayın tamamı");
  assert.equal(lafposSalesCountFrom(S, lines, { "2026-11": "2026-11-09" }), S);
  assert.equal(lafposSalesCountFrom(S, [], {}), S, "liste yok");
  assert.equal(lafposSalesCountFrom(null, lines, {}), null);
});

test("LafPOS'un sayıldığı ilk gün Marina'nın kendi kapsam kaydından: Tuzla'nın aynı aya 27 Kasım'a kadar yüklediği liste ve Aralık'ta yüklediği ayın tamamı kaydırmaz", () => {
  const G = "2026-11-22";
  const lines = [line({ id: 1, month: "2026-11", posName: "LATTE" }), line({ id: 2, month: "2026-11", posName: "TUZLA LATTE", branchId: "tuzla" })];
  // Ortak kayıt (sales.coverage) ayın tek, şubesiz kaydıdır: son yükleyenin günü. Onu okuyan sınır Tuzla'nın yüklemesiyle
  // kayardı: 27 Kasım'a kadar liste Marina'nın 22–27 Kasım LafPOS günlerini, Aralık'taki ayın tamamı bütün Kasım'ı düşürürdü
  assert.equal(lafposSalesCountFrom(G, lines, { "2026-11": "2026-11-27" }), "2026-11-28");
  assert.equal(lafposSalesCountFrom(G, lines, {}), "2026-12-01");
  const marina = (shared: unknown, perBranch: unknown) => readCoverage(shared, perBranch, LAFPOS_BRANCH_ID);
  const cases: [string, Record<string, string>][] = [
    ["Marina 21 Kasım'a kadar yükledi", marina({ "2026-11": "2026-11-21" }, { marina: { "2026-11": "2026-11-21" } })],
    ["Tuzla aynı aya 27 Kasım'a kadar yükledi", marina({ "2026-11": "2026-11-27" }, { marina: { "2026-11": "2026-11-21" }, tuzla: { "2026-11": "2026-11-27" } })],
    ["Tuzla Aralık'ta Kasım'ın tamamını yükledi", marina({}, { marina: { "2026-11": "2026-11-21" }, tuzla: { "2026-11": null } })],
    ["şube kaydından önce yüklenen liste: ortak kayıt", marina({ "2026-11": "2026-11-21" }, {})],
  ];
  for (const [name, coverage] of cases) {
    assert.equal(lafposSalesCountFrom(G, lines, coverage), G, name);
    // Satışlar'ın bandı: ModPOS 1–21 Kasım, LafPOS 22 Kasım'dan; çakışma yok, 22–27 Kasım sayılır
    const st = lafposMonthStatus({
      month: "2026-11",
      switchDay: G,
      today: "2026-11-28",
      modpos: { lines: 1, revenue: 100, through: modposThroughOf("2026-11", coverage) },
      lafpos: { days: 6, last: "2026-11-27" },
    });
    assert.deepEqual([st?.from, st?.modpos?.through, st?.overlap], [G, "2026-11-21", null], name);
  }
  // Marina'nın kendi kaydı ayın tamamıysa (null) ortak kayıt yok sayılır: liste ayın tamamı, LafPOS Aralık'tan
  assert.equal(lafposSalesCountFrom(G, lines, marina({ "2026-11": "2026-11-21" }, { marina: { "2026-11": null } })), "2026-12-01");
});

test("her gün tek kaynak: rastgele geçiş günü ve liste kapsamında hiçbir gün iki kaynaktan sayılmaz; tam listede her gün bir kaynakta", () => {
  // Basit, tekrarlanabilir sözde rastgele
  let seed = 20261027;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  for (let i = 0; i < 400; i++) {
    const S = addDays("2026-10-01", rnd(200));
    const sm = S.slice(0, 7);
    // Geçiş ayına liste: yok, geçiş gününden önceki güne kadar, daha kısa, geçiş gününü aşan ya da ayın tamamı (kayıtsız)
    const kind = rnd(5);
    const first = `${sm}-01`;
    const dim = Number(monthEnd(first).slice(8));
    const hasList = kind !== 0 && S !== first;
    const coverage: Record<string, string> = {};
    if (kind === 1) coverage[sm] = addDays(S, -1);
    if (kind === 2) coverage[sm] = addDays(first, rnd(Math.max(1, Number(S.slice(8)) - 1)));
    if (kind === 3) coverage[sm] = addDays(S, rnd(dim - Number(S.slice(8)) + 1));
    const lines = hasList ? [line({ id: 1, month: sm, posName: "X" })] : [];
    const countFrom = lafposSalesCountFrom(S, lines, coverage)!;
    for (let m = shiftMonth(sm, -1); m <= shiftMonth(sm, 2); m = shiftMonth(m, 1)) {
      const through = modposThroughOf(m, coverage);
      const listHere = m < sm || (m === sm && hasList);
      for (let d = `${m}-01`; d.startsWith(m); d = addDays(d, 1)) {
        const modpos = listHere && modposListCounts(m, S) && (m < sm || d <= through);
        const lafpos = d >= countFrom;
        // Ayın kendi kuralı tek sınırla aynı
        const from = lafposSalesFrom(m, S, m === sm && hasList ? through : null);
        assert.equal(lafpos, from !== null && d >= from, `${S} ${d}: ay kuralı ↔ tek sınır`);
        assert.ok(!(modpos && lafpos), `${S} ${JSON.stringify(coverage)} ${d}: iki kaynak`);
        // Liste geçiş gününden önceki güne kadarsa (içe aktarmanın yazdığı) her gün bir kaynakta
        if (kind === 1 || (kind === 0 && S === first)) assert.ok(modpos || lafpos || m < sm, `${S} ${d}: kaynaksız gün`);
        // Geçiş gününden önceki gün hiçbir zaman LafPOS'tan sayılmaz (deneme)
        if (d < S) assert.equal(lafpos, false);
      }
    }
  }
});

test("birleştirme: geçiş günü yoksa girdi aynen döner (aynı satırlar, aynı sıra, aynı kapsam)", () => {
  const lines = [line({ id: 7, month: "2026-11", posName: "LATTE" }), line({ id: 3, month: "2026-12", posName: "MOCHA" })];
  const coverage = { "2026-12": "2026-12-15" };
  const r = mergeSalesSources({ switchDay: null, salesLines: lines, coverage, lafposLines: [laf({ month: "2026-12", posName: "X" })], lafposDays: [{ month: "2026-12", days: 3, last: "2026-12-03" }] });
  assert.equal(r.salesLines, lines, "aynı dizi");
  assert.deepEqual(r.coverage, coverage);
  assert.notEqual(r.coverage, coverage, "kopya: çağıranın kaydı değişmez");
});

test("birleştirme: geçiş ayında liste + LafPOS, sonraki ayda yalnız LafPOS; LafPOS satırları eksi kimlikli, salt okunur işaretli, sıralı", () => {
  const S = "2026-11-10";
  const lines = [
    line({ id: 1, month: "2026-10", posName: "EKİM" }),
    line({ id: 2, month: "2026-11", posName: "KASIM MODPOS" }),
    line({ id: 3, month: "2026-12", posName: "ARALIK MODPOS (sayılmaz)" }),
  ];
  const r = mergeSalesSources({
    switchDay: S,
    salesLines: lines,
    coverage: { "2026-11": "2026-11-09", "2026-12": "2026-12-05" },
    lafposLines: [
      laf({ month: "2026-12", posName: "LATTE", revenue: 500, productId: 4, days: 3 }),
      laf({ month: "2026-11", posName: "MOCHA", revenue: 200, productId: 5 }),
      laf({ month: "2026-11", posName: "LATTE", revenue: 900, productId: 4, days: 12 }),
      laf({ month: "2026-11", posName: "KARAOKE", revenue: 900, isService: true }),
      laf({ month: "2026-10", posName: "DENEME (sayılmaz)" }),
    ],
    lafposDays: [
      { month: "2026-11", days: 21, last: "2026-11-30" },
      { month: "2026-12", days: 3, last: "2026-12-03" },
    ],
  });
  assert.deepEqual(
    r.salesLines.map((l) => [l.id, l.month, l.posName, l.lafpos?.days ?? null]),
    [
      [1, "2026-10", "EKİM", null],
      [2, "2026-11", "KASIM MODPOS", null],
      // Ay, ciro (çoktan aza), ad: eşit cirolu iki satır adına göre
      [-1, "2026-11", "KARAOKE", 1],
      [-2, "2026-11", "LATTE", 12],
      [-3, "2026-11", "MOCHA", 1],
      [-4, "2026-12", "LATTE", 3],
    ],
  );
  const karaoke = r.salesLines.find((l) => l.posName === "KARAOKE")!;
  assert.deepEqual([karaoke.isService, karaoke.productId, karaoke.note], [true, null, null]);
  // Kapsam: Kasım'da LafPOS ayın sonuna kadar geldi (kayıt yok: ayın tamamı); Aralık'ta son LafPOS günü, ModPOS'un
  // sayılmayan kaydı düşer
  assert.deepEqual(r.coverage, { "2026-12": "2026-12-03" });
  // Geçiş ayına henüz LafPOS günü gelmediyse listenin kaydı kalır
  const early = mergeSalesSources({ switchDay: S, salesLines: lines, coverage: { "2026-11": "2026-11-09" }, lafposLines: [], lafposDays: [] });
  assert.deepEqual(early.coverage, { "2026-11": "2026-11-09" });
  assert.deepEqual(early.salesLines.map((l) => l.id), [1, 2]);
});

test("birleştirme: geçiş günü yalnız Marina'nın listesini düşürür; Tuzla'nın ModPOS listesi her ay sayılır (21 Kasım kararı)", () => {
  const S = "2026-11-10";
  const lines = [
    line({ id: 1, month: "2026-12", posName: "ARALIK MARINA (sayılmaz)", branchId: "marina" }),
    line({ id: 2, month: "2026-12", posName: "ARALIK TUZLA", branchId: "tuzla" }),
    { ...line({ id: 3, month: "2026-12", posName: "ŞUBESİZ (Tuzla'nın)" }), branchId: undefined },
    line({ id: 4, month: "2026-11", posName: "KASIM TUZLA", branchId: "tuzla" }),
  ];
  const r = mergeSalesSources({
    switchDay: S,
    salesLines: lines,
    coverage: {},
    lafposLines: [laf({ month: "2026-12", posName: "LATTE", revenue: 500, productId: 4, days: 3 })],
    lafposDays: [{ month: "2026-12", days: 3, last: "2026-12-03" }],
  });
  assert.deepEqual(
    r.salesLines.map((l) => [l.id, l.posName]),
    [
      [2, "ARALIK TUZLA"],
      [3, "ŞUBESİZ (Tuzla'nın)"],
      [4, "KASIM TUZLA"],
      [-1, "LATTE"],
    ],
  );
  // LafPOS'un sayıldığı ilk gün yalnız Marina'nın geçiş ayı listesine bakar: Tuzla'nın (şubesiz de) Kasım listesi LafPOS'u kesmez
  assert.equal(lafposSalesCountFrom(S, [line({ id: 4, month: "2026-11", posName: "KASIM TUZLA", branchId: "tuzla" })], { "2026-11": "2026-11-30" }), S);
  assert.equal(lafposSalesCountFrom(S, [{ ...line({ id: 6, month: "2026-11", posName: "KASIM ŞUBESİZ" }), branchId: undefined }], { "2026-11": "2026-11-30" }), S);
  assert.equal(lafposSalesCountFrom(S, [line({ id: 5, month: "2026-11", posName: "KASIM MARINA", branchId: "marina" })], { "2026-11": "2026-11-12" }), "2026-11-13");
  // Tuzla'nın listesinin kuralı Tuzla'nın geçiş günüyle (yok): Aralık listesi yüklenir, Marina'nınki reddedilir
  assert.deepEqual(modposImportRule("2026-12", branchSwitchDay(S, "tuzla"), "2027-01-05"), { ok: true, through: null });
  assert.deepEqual(modposImportRule("2026-12", branchSwitchDay(S, null), "2027-01-05"), { ok: true, through: null });
  assert.equal(modposImportRule("2026-12", branchSwitchDay(S, "marina"), "2027-01-05").ok, false);
});

test("model: yalnız LafPOS olan ayda satır, reçeteye göre tüketim ve karaoke payı (KDV %20) ModPOS listesindekiyle aynı", () => {
  const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
  const base: Dataset = { ...excelToDataset(data), currentMonth: "2026-11" };
  const sept = base.salesLines.filter((l) => l.month === "2026-09");
  // Kasım LafPOS'tan: Eylül'ün satırları LafPOS ay toplamı olarak; aynı aya yüklenmiş eski bir ModPOS listesi sayılmaz
  const r = mergeSalesSources({
    switchDay: "2026-11-01",
    salesLines: [...base.salesLines, line({ id: 9999, month: "2026-11", posName: "ESKİ MODPOS", revenue: 1_000_000, productId: sept[0].productId })],
    coverage: {},
    lafposLines: sept.map((l) => laf({ month: "2026-11", posName: l.posName, productId: l.productId, isService: l.isService, qty: l.qty, revenue: l.revenue, days: 30 })),
    lafposDays: [{ month: "2026-11", days: 30, last: "2026-11-30" }],
  });
  const ds: Dataset = {
    ...base,
    salesLines: r.salesLines,
    months: [...base.months, { month: "2026-11", openDays: 30, posRevenue: 429_698, discounts: 0, offRevenue: 0, cardShare: null, note: null }],
  };
  const model = createModel(ds);
  const nov = model.monthSales("2026-11");
  const sep = model.monthSales("2026-09");
  assert.ok(nov.lines.length > 0 && nov.lines.every((l) => l.line.lafpos), "satırlar LafPOS'tan");
  assert.equal(nov.lines.length, sep.lines.length);
  assert.equal(Math.round(nov.revenue), Math.round(sep.revenue), "ModPOS listesi iki kez sayılmaz");
  assert.ok(model.salesMonths.includes("2026-11"));
  assert.deepEqual([...model.ingredientUsage("2026-11")].sort(), [...model.ingredientUsage("2026-09")].sort(), "reçeteye göre tüketim");
  assert.ok(model.ingredientUsage("2026-11").size > 0);
  assert.equal(nov.serviceRevenue, 2050, "karaoke satırları hizmet");
  // KDV tahmini: karaoke payı hizmet oranıyla (%20), kalanı satış KDV'siyle (%10)
  const inp = vatMonthInputs(model, "2026-11-20").months.find((m) => m.month === "2026-11");
  assert.equal(inp?.pos?.serviceRevenue, 2050);
  assert.equal(inp?.pos?.vat, posVat(429_698, 2050, 0.1, 0.2));
  assert.ok(posVat(429_698, 2050, 0.1, 0.2) > posVat(429_698, 0, 0.1, 0.2), "karaoke payı %20'yle");
});

test("Satışlar bandı: geçiş ayı, eksik günler, sayılmayan LafPOS günleri, sayılmayan liste, liste ↔ Z farkı", () => {
  const S = "2026-11-10";
  const st = (o: Partial<Parameters<typeof lafposMonthStatus>[0]> = {}) =>
    lafposMonthStatus({ month: "2026-11", switchDay: S, today: "2026-11-20", modpos: null, lafpos: { days: 10, last: "2026-11-19" }, modposZ: null, ...o })!;
  assert.equal(lafposMonthStatus({ month: "2026-10", switchDay: S, today: "2026-11-20", modpos: null, lafpos: null }), null, "geçişten önceki ay");
  // Liste geçiş gününden önceki güne kadar: yalnız bilgi
  const ok = st({ modpos: { lines: 80, revenue: 100_000, through: "2026-11-09" }, modposZ: 98_000 });
  assert.deepEqual([ok.source, ok.from, ok.gap, ok.overlap, ok.modpos?.counted], ["gecis", S, null, null, true]);
  const okNotes = lafposMonthNotes(ok, S);
  assert.equal(plain(okNotes.info), "Kasım geçiş ayı: ModPOS listesi 1–9 Kasım, LafPOS 10 Kasım'dan itibaren (10 gün geldi, son gün 19 Kasım).");
  assert.deepEqual(okNotes.warnings, []);
  // Liste kısa: aradaki günler hiçbir kaynakta yok
  const short = st({ modpos: { lines: 30, revenue: 40_000, through: "2026-11-04" } });
  assert.deepEqual(short.gap, { from: "2026-11-05", to: "2026-11-09" });
  assert.deepEqual(lafposMonthNotes(short, S).warnings.map(plain), [
    "5–9 Kasım satışı hiçbir kaynakta yok: ModPOS listesi 4 Kasım gününe kadar, LafPOS 10 Kasım'dan itibaren. 1–9 Kasım listesini yükleyin.",
  ]);
  // Liste yok: geçiş günü geldiyse 1-9 Kasım eksik; gelmediyse ayın ModPOS kısmı sürüyor, uyarı yok
  const none = st();
  assert.deepEqual(none.gap, { from: "2026-11-01", to: "2026-11-09" });
  assert.deepEqual(lafposMonthNotes(none, S).warnings.map(plain), ["1–9 Kasım ModPOS satışı yüklenmedi: LafPOS 10 Kasım'dan itibaren sayılıyor. 1–9 Kasım listesini yükleyin."]);
  assert.equal(st({ today: "2026-11-05", lafpos: null }).gap, null);
  // Liste geçiş gününü aşıyor (geçiş günü sonradan seçildi): LafPOS'un o günleri sayılmaz
  const over = st({ modpos: { lines: 90, revenue: 150_000, through: "2026-11-20" } });
  assert.deepEqual([over.from, over.overlap], ["2026-11-21", { from: S, to: "2026-11-20" }]);
  assert.deepEqual(lafposMonthNotes(over, S).warnings.map(plain), [
    "Kasım listesi 20 Kasım gününe kadar: LafPOS'un 10–20 Kasım günleri aynı satışları iki kez saymamak için sayılmıyor. LafPOS'u saymak için yalnız 1–9 Kasım listesini yükleyin.",
  ]);
  const whole = st({ modpos: { lines: 120, revenue: 300_000, through: "2026-11-30" } });
  assert.equal(whole.from, null, "ayın tamamının listesi: LafPOS o ay sayılmaz");
  assert.match(plain(lafposMonthNotes(whole, S).warnings[0]), /^Kasım listesi ayın tamamını kapsıyor: LafPOS'un 10–30 Kasım günleri/);
  // Liste toplamı listenin günlerinin Z toplamını %5'ten fazla aşıyor
  const big = st({ modpos: { lines: 80, revenue: 120_000, through: "2026-11-09" }, modposZ: 100_000 });
  assert.deepEqual(lafposMonthNotes(big, S).warnings.map(plain), [
    "ModPOS listesinin toplamı (120.000 ₺) 1–9 Kasım kasa raporlarının Z toplamından (100.000 ₺) %20 fazla: liste sonraki günlerin satışını da içeriyor olabilir, o günler LafPOS'tan da sayılır. Listeyi yalnız 1–9 Kasım için alıp yeniden yükleyin.",
  ]);
  assert.equal(modposOverZText(105_000, 100_000, "2026-11-01", "2026-11-09"), null, "%5'e kadar olağan (liste indirimden önce)");
  assert.equal(modposOverZText(105_001, null, "2026-11-01", "2026-11-09"), null, "Z yok");
  // LafPOS ayı: yüklü ModPOS listesi sayılmaz
  const dec = lafposMonthStatus({ month: "2026-12", switchDay: S, today: "2026-12-04", modpos: { lines: 84, revenue: 1, through: "2026-12-31" }, lafpos: { days: 3, last: "2026-12-03" } })!;
  assert.deepEqual([dec.source, dec.from, dec.modpos?.counted, dec.gap, dec.overlap], ["lafpos", "2026-12-01", false, null, null]);
  const decNotes = lafposMonthNotes(dec, S);
  assert.equal(plain(decNotes.info), "Aralık LafPOS'tan geliyor: satışlar her gün sonunda kendiliğinden gelir (3 gün geldi, son gün 3 Aralık). ModPOS listesi yüklenmez.");
  assert.deepEqual(decNotes.warnings, ['Bu aya yüklenmiş ModPOS listesi (84 satır) sayılmıyor: Aralık LafPOS\'tan geliyor. Silmek için "Ayı temizle".']);
  // Kasa raporunu bekleyen günler bilgi satırında (uyarı değil)
  const held = lafposMonthStatus({ month: "2026-12", switchDay: S, today: "2026-12-04", modpos: null, lafpos: { days: 4, last: "2026-12-04" }, held: { from: "2026-12-04", to: "2026-12-04" } })!;
  assert.deepEqual(held.held, { from: "2026-12-04", to: "2026-12-04" });
  assert.equal(
    plain(lafposMonthNotes(held, S).info),
    "Aralık LafPOS'tan geliyor: satışlar her gün sonunda kendiliğinden gelir (4 gün geldi, son gün 4 Aralık; 4 Aralık kasa raporu girilince sayılır). ModPOS listesi yüklenmez.",
  );
  assert.equal("held" in dec, false, "bekleyen gün yoksa alan yok");
  assert.equal(
    plain(lafposMonthNotes(lafposMonthStatus({ month: "2027-01", switchDay: S, today: "2026-12-04", modpos: null, lafpos: null })!, S).info),
    "Ocak LafPOS'tan geliyor: satışlar her gün sonunda kendiliğinden gelir. ModPOS listesi yüklenmez.",
  );
  assert.equal(plain(dayRangeTR("2026-11-09", "2026-11-09")), "9 Kasım");
  assert.equal(dayRangeTR("2026-11-01", "2026-11-19"), "1–\u206019\u00a0Kasım", "telefonda çizgiden sonra kırılmaz");
  assert.deepEqual(["2026-08-03", "2026-11-10", "2026-04-01"].map((d) => plain(dayAblativeTR(d))), ["3 Ağustos'tan", "10 Kasım'dan", "1 Nisan'dan"]);
});

test("içe aktarma kuralı: LafPOS ayında red; geçiş ayında liste en çok geçiş gününden önceki güne kadar; öteki aylar bugünkü gibi", () => {
  const S = "2026-11-10";
  const lafpos = modposImportRule("2026-12", S, "2026-12-05");
  assert.equal(lafpos.ok, false);
  assert.match(lafpos.ok ? "" : lafpos.error, /^Aralık 2026 LafPOS'tan geliyor; ModPOS listesi yüklenmez\./);
  // Geçiş ayı sürerken: verilen ya da dün, en çok geçiş gününden önceki gün
  assert.deepEqual(modposImportRule("2026-11", S, "2026-11-06"), { ok: true, through: "2026-11-05" }, "geçiş günü gelmedi: dün");
  assert.deepEqual(modposImportRule("2026-11", S, "2026-11-20"), { ok: true, through: "2026-11-09" }, "dün geçiş gününden sonra: kırpılır");
  assert.deepEqual(modposImportRule("2026-11", S, "2026-11-20", "2026-11-04"), { ok: true, through: "2026-11-04" }, "kısa liste");
  assert.deepEqual(modposImportRule("2026-11", S, "2026-11-20", "2026-11-15"), { ok: true, through: "2026-11-09" });
  // Geçiş ayı bittikten sonra: kayıt silinmez (ayın tamamı sayılsaydı LafPOS günleri sayılmazdı), verilen ya da 9 Kasım
  assert.deepEqual(modposImportRule("2026-11", S, "2026-12-02"), { ok: true, through: "2026-11-09" });
  assert.deepEqual(modposImportRule("2026-11", S, "2026-12-02", "2026-11-07"), { ok: true, through: "2026-11-07" });
  assert.deepEqual(modposImportRule("2026-11", S, "2026-12-02", "2026-12-01"), { ok: true, through: "2026-11-09" }, "başka ayın günü");
  // Geçiş gününden önceki ay ve geçiş günü yokken: bugünkü kural (biten ay ayın tamamı, süren ay dün)
  assert.deepEqual(modposImportRule("2026-10", S, "2026-11-20"), { ok: true, through: null });
  assert.deepEqual(modposImportRule("2026-11", null, "2026-11-20"), { ok: true, through: "2026-11-19" });
  assert.deepEqual(modposImportRule("2026-10", null, "2026-11-20"), { ok: true, through: null });
  // Ayın 1'i geçiş günü: o ay bütünüyle LafPOS
  assert.equal(modposImportRule("2026-12", "2026-12-01", "2026-12-10").ok, false);
  assert.equal(monthSource("2026-11", "2026-12-01"), "modpos");
});

test("kaynak: veri kümesi geçiş günü yokken LafPOS'u hiç okumaz; Satışlar ve eylemler kuralı tek yerden alır", () => {
  const merged = read("src/server/data/lafpos-sales.ts");
  // Geçiş günü yoksa okuma yapılmadan döner (LafPOS tablosu okunmaz; satırlar ve kapsam aynen)
  const fn = merged.slice(merged.indexOf("export async function mergeWithLafpos"));
  assert.ok(fn.indexOf("if (S === null || countFrom === null) return") < fn.indexOf("await loadLafposMonthSales("));
  const dataset = read("src/server/data/dataset.ts");
  assert.match(dataset, /switchDay: settings\.lafposGecisGunu/);
  assert.match(dataset, /\.\.\.\(sales\.lafposSales \? \{ lafposSales: sales\.lafposSales \} : \{\}\)/);
  const actions = read("src/server/actions/sales.ts");
  assert.match(actions, /const rule = modposImportRule\(month, switchDay, todayTR\(\)/);
  assert.match(actions, /if \(!rule\.ok\) throw new UserError\(rule\.error\);/);
  // Geçiş günü satırın şubesininki (denetim 21 Kasım #5): ModPOS'ta kalan şubenin (Marina) listesi her ay yüklenir
  assert.match(actions, /const switchDay = branchSwitchDay\(await loadLafposSwitchDay\(\), sube\);/);
  assert.match(actions, /const switchDay = branchSwitchDay\(await loadLafposSwitchDay\(\), lineBranch\);\n\s+if \(monthSource\(month, switchDay\) === "lafpos"\)/, "LafPOS ayına elle satır eklenmez");
  // Geçiş ayının ilk elle satırı listeyi içe aktarmanın kuralıyla başlatır (denetim B08 incelemesi)
  assert.match(actions, /if \(n === 0 && monthSource\(month, switchDay\) === "gecis"\) \{\n\s+const rule = modposImportRule\(month, switchDay, todayTR\(\), null\);\n\s+if \(rule\.ok\) await writeCoverage\(tx, sube, month, rule\.through\);/);
  // LafPOS'un sayıldığı ilk gün ve ayların ModPOS listesi Marina'nın kendi kapsam kaydından (readCoverage), görünümün
  // listelerinin son günü görünümün şubesinden ("Tümü"de ortak kayıt)
  assert.match(merged, /const countFrom = lafposSalesCountFrom\(S, input\.salesLines, input\.lafposCoverage\);/);
  assert.match(merged, /const through = modposThroughOf\(m, input\.lafposCoverage\);/);
  assert.doesNotMatch(merged, /lafposSalesCountFrom\(S, input\.salesLines, input\.coverage\)|modposThroughOf\(m, input\.coverage\)/);
  assert.match(dataset, /const coverage = coverageOf\(scope === ALL_BRANCHES \? null : scope\);/);
  assert.match(dataset, /const lafposCoverage = coverageOf\(LAFPOS_BRANCH_ID\);/);
  assert.match(dataset, /readCoverage\(storedCoverage\(SALES_COVERAGE_KEY\), storedCoverage\(SALES_COVERAGE_BRANCH_KEY\), branchId\)/);
  assert.match(read("src/server/data/stock-estimate.ts"), /readCoverage\(stored\(SALES_COVERAGE_KEY\), stored\(SALES_COVERAGE_BRANCH_KEY\), STOCK_ESTIMATE_BRANCH\)/);
  assert.doesNotMatch(dataset + read("src/server/data/stock-estimate.ts"), /parseCoverage\(/, "ortak kayıt yalnız readCoverage'dan");
  // İçe aktarma kartının "… tarihine kadar"ı yazılan şubenin (currentWriteBranch; "Tümü"de Tuzla) listesinden: "Tümü"de
  // Marina'nın listesinin günü (lafpos.modpos) ya da son yükleyenin ortak kaydı gösterilmez
  assert.match(dataset, /writeCoverage: coverageOf\(writeBranch\),/);
  const salesPage = read("src/app/panel/satislar/page.tsx");
  assert.match(salesPage, /const writeHasList = sales\.lines\.some\(\(l\) => !l\.line\.lafpos && \(l\.line\.branchId \?\? DEFAULT_BRANCH_ID\) === writeId\);/);
  assert.match(salesPage, /const coveredThrough = writeHasList\n\s+\? \(model\.ds\.writeCoverage\?\.\[month\] \?\? null\)/);
  assert.match(salesPage, /coveredThrough=\{coveredThrough\}/);
  // Süren ayın kasa raporundan sonraki LafPOS günleri bekler (kasa raporlarının son günü; LafPOS'un yedek ay satırları,
  // B09 G6, rapor sayılmaz)
  assert.match(dataset, /const reportRows = till\.filter\(isReportRow\);/);
  assert.match(dataset, /const reportRows = input\.till\.filter\(\(r\) => isReportRow\(r\) && isLafposBranch\(r\.branchId\)\);/);
  assert.match(dataset, /lastTillDay: reportRows\.at\(-1\)\?\.date \?\? null/);
  // Görünümün geçiş günü: ModPOS'ta kalan şube seçiliyken yok (denetim 21 Kasım #5)
  assert.match(dataset, /const settings = \{ \.\.\.storedSettings, lafposGecisGunu: scopeSwitchDay\(storedSettings\.lafposGecisGunu, scope\) \};/);
  // Tahmin: kullanılmayan günlük satır okunmaz, istek başına uyarı yazılmaz (denetim E-08 hız kısmı)
  for (const f of ["src/server/data/dataset.ts"]) {
    const src = read(f);
    assert.doesNotMatch(src, /loadDailyProductSales|console\.warn\("\[tahmin\]/, f);
  }
});
