// Tahmini stok ve kritik stok uyarısı (docs/STOK-TAHMINI.md): saf hesap (src/lib/stock-estimate.ts) ve Tuzla'nın
// etkilenmemesi (kapı, okuyucunun şube süzgeci, Stok sayımı'nın düğmesi, kartların yüklenmesi).
// Çalıştırma: npx tsx --test tests/stok-tahmini.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { DEFAULT_SETTINGS } from "../src/lib/constants";
import { buildSiteLinkIndex } from "../src/lib/site-sales/calc";
import {
  daysLeftText,
  DEFAULT_LEAD_DAYS,
  estimateOnlineMonth,
  estimateStock,
  MIN_AVG_DAYS,
  onlineMonthsNeeded,
  onlineThrough,
  parseLeadDays,
  parseThresholdInput,
  suggestThreshold,
  receiptListNote,
  stockQty,
  recipePerUnit,
  showsStockEstimate,
  STOCK_ESTIMATE_BRANCH,
  stockAlertItems,
  thresholdInputValue,
  type StockEstimateInput,
} from "../src/lib/stock-estimate";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// Malzemeler: süt (ml, LT), çekirdek (gr, KG), bardak (adet, ADET; Ambalaj), şurup (hiç sayılmadı)
const SUT = 1;
const KAHVE = 2;
const BARDAK = 3;
const SURUP = 4;
// Ürünler: Latte (süt, çekirdek, bardak), Espresso (çekirdek), Cookie (reçetesi boş)
const LATTE = 10;
const ESPRESSO = 11;
const COOKIE = 12;

function base(over: Partial<StockEstimateInput> = {}): StockEstimateInput {
  return {
    today: "2026-12-10",
    asilposFrom: "2026-11-22",
    // 5 Aralık gün sonu gelmedi, 7 Aralık kapalı işaretli
    receivedDays: ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-06", "2026-12-08", "2026-12-09"],
    closedDays: ["2026-12-07"],
    ingredients: [
      { id: SUT, name: "Süt", unit: "ml", countUnit: "LT", category: "Süt ürünleri", sortOrder: 1 },
      { id: KAHVE, name: "Espresso çekirdeği", unit: "gr", countUnit: "KG", category: "Kahve", sortOrder: 2 },
      { id: BARDAK, name: "Bardak M", unit: "adet", countUnit: "ADET", category: "Ambalaj", sortOrder: 3 },
      { id: SURUP, name: "Karamel şurubu", unit: "ml", countUnit: "LT", category: "Şurup", sortOrder: 4 },
    ],
    counts: [
      // Eski sayım: daha yenisi var, kullanılmaz
      { month: "2026-10", ingredientId: SUT, qty: 99, factor: 1000 },
      { month: "2026-11", ingredientId: SUT, qty: 10, factor: 1000 },
      { month: "2026-11", ingredientId: KAHVE, qty: 2, factor: 1000 },
      // Eski satır: çarpan boş, bugünkü sayım biriminin (ADET) çarpanı
      { month: "2026-11", ingredientId: BARDAK, qty: 100, factor: null },
      // Süren ayın sayımı ay bitince girer
      { month: "2026-12", ingredientId: KAHVE, qty: 50, factor: 1000 },
    ],
    purchases: [
      { invoiceId: 501, ingredientId: SUT, date: "2026-12-03", qty: 12_000 },
      // Sayımdan önceki fatura: malı sayımın içinde
      { invoiceId: 502, ingredientId: KAHVE, date: "2026-11-29", qty: 1000 },
      // İade faturası
      { invoiceId: 503, ingredientId: SUT, date: "2026-12-04", qty: -1000 },
    ],
    sales: [
      { date: "2026-12-02", posName: "LATTE M", productId: LATTE, productName: "Latte M", isService: false, qty: 10 },
      { date: "2026-12-03", posName: "ESPRESSO", productId: ESPRESSO, productName: "Espresso", isService: false, qty: 20 },
      { date: "2026-12-03", posName: "COOKIE", productId: COOKIE, productName: "Cookie", isService: false, qty: 5 },
      { date: "2026-12-04", posName: "PUMPKIN LATTE", productId: null, isService: false, qty: 3 },
      { date: "2026-12-04", posName: "KARAOKE KİŞİ", productId: null, isService: true, qty: 2 },
      // Sayımdan önce: sayımın içinde
      { date: "2026-11-30", posName: "LATTE M", productId: LATTE, productName: "Latte M", isService: false, qty: 100 },
    ],
    panelWaste: [
      { date: "2026-12-02", kind: "zayi", productId: null, ingredientId: SUT, name: "Süt", qty: 1.5, factor: 1000 },
      // AsilPOS'un gün sonu gelen günde panele girilmiş ürün ikramı sayılmaz (AsilPOS'taki sayılır)
      { date: "2026-12-03", kind: "ikram", productId: LATTE, ingredientId: null, name: "Latte M", qty: 2, factor: 1 },
      // Gün sonu gelmeyen günde panelin ürün ikramı sayılır
      { date: "2026-12-05", kind: "ikram", productId: LATTE, ingredientId: null, name: "Latte M", qty: 1, factor: 1 },
      // Ürün zayisi her zaman sayılır
      { date: "2026-12-06", kind: "zayi", productId: LATTE, ingredientId: null, name: "Latte M", qty: 1, factor: 1 },
      { date: "2026-12-06", kind: "zayi", productId: COOKIE, ingredientId: null, name: "Cookie", qty: 1, factor: 1 },
      // Sayımdan önce
      { date: "2026-11-28", kind: "zayi", productId: null, ingredientId: SUT, name: "Süt", qty: 5, factor: 1000 },
    ],
    asilposWaste: [
      { date: "2026-12-08", kind: "ikram", posName: "LATTE M", productId: LATTE, productName: "Latte M", qty: 1 },
      { date: "2026-12-08", kind: "zayi", posName: "ESPRESSO", productId: ESPRESSO, productName: "Espresso", qty: 2 },
      { date: "2026-12-09", kind: "ikram", posName: "TADIM", productId: null, qty: 1 },
    ],
    recipe: [
      { productId: LATTE, ingredientId: SUT, qty: 200 },
      { productId: LATTE, ingredientId: KAHVE, qty: 18 },
      { productId: LATTE, ingredientId: BARDAK, qty: 1 },
      { productId: ESPRESSO, ingredientId: KAHVE, qty: 9 },
    ],
    fireRate: 0.05,
    thresholds: new Map([
      [KAHVE, 2000],
      [SUT, 5000],
      // Sayılmamış malzemenin eşiği uyarı vermez
      [SURUP, 1000],
    ]),
    ...over,
  };
}

const close = (a: number | null, b: number, msg?: string) => assert.ok(a !== null && Math.abs(a - b) < 1e-6, `${msg ?? ""}: ${a} ≠ ${b}`);
const line = (r: ReturnType<typeof estimateStock>, id: number) => r.lines.find((l) => l.ingredientId === id)!;

test("hesap: son sayım + gelen − satış × (1 + fire) − zayi ve ikram, malzemenin kendi biriminde", () => {
  const r = estimateStock(base());
  const sut = line(r, SUT);
  assert.equal(sut.status, "tahmin");
  assert.equal(sut.countMonth, "2026-11");
  assert.equal(sut.from, "2026-12-01");
  close(sut.counted, 10_000, "süt sayım (10 LT)");
  close(sut.purchased, 11_000, "süt alış (12 LT − 1 LT iade)");
  close(sut.sold, 2000 * 1.05, "süt satış (10 Latte × 200 ml × 1,05)");
  // 1,5 LT zayi + 5 Aralık panel ikramı + 6 Aralık ürün zayisi + 8 Aralık AsilPOS ikramı (3 Latte × 200 ml)
  close(sut.wasted, 1500 + 600, "süt zayi ve ikram");
  close(sut.estimate, 10_000 + 11_000 - 2100 - 2100, "süt tahmini");

  const kahve = line(r, KAHVE);
  close(kahve.counted, 2000, "çekirdek: Kasım sayımı (süren ayın sayımı girmez)");
  close(kahve.purchased, 0, "çekirdek: sayımdan önceki fatura girmez");
  close(kahve.sold, (10 * 18 + 20 * 9) * 1.05, "çekirdek satış");
  // 3 Latte (5, 6, 8 Aralık) × 18 gr + AsilPOS'ta zayi yazılan 2 Espresso × 9 gr
  close(kahve.wasted, 3 * 18 + 2 * 9, "çekirdek zayi ve ikram (fire eklenmez)");
  close(kahve.estimate, 2000 - 378 - 72, "çekirdek tahmini");

  const bardak = line(r, BARDAK);
  close(bardak.counted, 100, "bardak: çarpanı boş eski sayım ADET'le");
  close(bardak.estimate, 100 - 10 * 1.05 - 3, "bardak tahmini");

  assert.equal(r.from, "2026-12-01");
  assert.equal(r.lastDay, "2026-12-09");
  assert.deepEqual(r.counts, { tahmin: 3, "sayim-yok": 1, "asilpos-oncesi": 0 });
});

test("son sayım yoksa 'sayım yok': rakam yok, eşik olsa da uyarı yok", () => {
  const r = estimateStock(base());
  const surup = line(r, SURUP);
  assert.equal(surup.status, "sayim-yok");
  assert.equal(surup.estimate, null);
  assert.equal(surup.counted, null);
  assert.equal(surup.critical, false);
  assert.equal(surup.threshold, 1000);
  // Yalnız süren ayda sayılan malzeme de sayılmamış sayılır (ay bitince girer)
  const only = estimateStock(base({ counts: [{ month: "2026-12", ingredientId: SUT, qty: 10, factor: 1000 }] }));
  assert.equal(line(only, SUT).status, "sayim-yok");
  assert.equal(only.from, null);
  assert.equal(only.critical.length, 0);
});

test("sayım AsilPOS'tan önceyse tahmin yok: o günlerin satışı gün gün bilinmiyor", () => {
  // Dönem 1 Aralık'ta başlıyor, AsilPOS 2 Aralık'tan sayılıyor
  const late = estimateStock(base({ asilposFrom: "2026-12-02" }));
  for (const l of late.lines.filter((x) => x.countMonth)) {
    assert.equal(l.status, "asilpos-oncesi", l.name);
    assert.equal(l.estimate, null);
    assert.equal(l.critical, false);
  }
  assert.equal(late.from, null);
  assert.deepEqual(late.missingDays, []);
  assert.equal(late.unmatched.lines, 0);
  // Geçiş günü yok: AsilPOS hiç sayılmıyor
  const off = estimateStock(base({ asilposFrom: null }));
  assert.ok(off.lines.every((l) => l.estimate === null));
  assert.deepEqual(off.counts, { tahmin: 0, "sayim-yok": 1, "asilpos-oncesi": 3 });
});

test("reçetesiz ve ürüne bağlı olmayan satırlar atlanır ve sayılır; hizmet satırı sayılmaz", () => {
  const r = estimateStock(base());
  // Cookie: 5 satış + 1 panel zayisi
  assert.deepEqual(r.noRecipe, { lines: 2, qty: 6, names: 1, top: ["Cookie"] });
  // PUMPKIN LATTE satışı ve AsilPOS'un bağlanmamış ikramı; karaoke (hizmet) ve sayımdan önceki satır yok
  assert.deepEqual(r.unmatched, { lines: 2, qty: 4, names: 2, top: ["PUMPKIN LATTE", "TADIM"] });
  // Reçetesiz ürün hiçbir malzemeyi azaltmaz
  const without = estimateStock(base({ sales: base().sales.filter((s) => s.productId !== COOKIE) }));
  for (const id of [SUT, KAHVE, BARDAK]) close(line(without, id).estimate, line(r, id).estimate as number, String(id));
});

test("zayi ve ikram: her gün tek kaynak, ürün reçeteden, hammadde çarpanıyla, sayımdan öncekiler girmez", () => {
  const none = estimateStock(base({ panelWaste: [], asilposWaste: [] }));
  close(line(none, SUT).wasted, 0, "kayıt yok");
  // Yalnız hammadde zayisi: 1,5 LT = 1500 ml
  const raw = estimateStock(base({ panelWaste: [base().panelWaste[0]], asilposWaste: [] }));
  close(line(raw, SUT).wasted, 1500, "hammadde zayisi");
  // Gün sonu gelen günde panelin ürün ikramı sayılmaz; aynı gün zayisi sayılır
  const day = "2026-12-03";
  const ikram = estimateStock(base({ panelWaste: [{ date: day, kind: "ikram", productId: LATTE, ingredientId: null, name: "Latte M", qty: 4, factor: 1 }], asilposWaste: [] }));
  close(line(ikram, SUT).wasted, 0, "AsilPOS günündeki panel ürün ikramı");
  const zayi = estimateStock(base({ panelWaste: [{ date: day, kind: "zayi", productId: LATTE, ingredientId: null, name: "Latte M", qty: 4, factor: 1 }], asilposWaste: [] }));
  close(line(zayi, SUT).wasted, 800, "AsilPOS günündeki panel ürün zayisi");
  // Hammadde ikramı (personele süt) AsilPOS gününde de sayılır
  const staffMilk = estimateStock(base({ panelWaste: [{ date: day, kind: "ikram", productId: null, ingredientId: SUT, name: "Süt", qty: 0.5, factor: 1000 }], asilposWaste: [] }));
  close(line(staffMilk, SUT).wasted, 500, "hammadde ikramı");
});

test("alış: yalnız dönemin içindeki fatura, iade düşer", () => {
  const r = estimateStock(base({ purchases: [{ invoiceId: 1, ingredientId: SUT, date: "2026-12-01", qty: 3000 }, { invoiceId: 2, ingredientId: SUT, date: "2026-12-11", qty: 9000 }] }));
  // 11 Aralık bugünden sonra: girmez
  close(line(r, SUT).purchased, 3000, "dönemin ilk günü dahil, bugünden sonrası yok");
});

test("birim dönüşümü: sayım çarpanı, ekrandaki birim, eşik alanı", () => {
  // Sayıldığı çarpanla: eskiden gr ile sayılmış (çarpan 1) kalem bugün KG'de olsa da 500 gr
  const r = estimateStock(base({ counts: [{ month: "2026-11", ingredientId: KAHVE, qty: 500, factor: 1 }], sales: [], panelWaste: [], asilposWaste: [], purchases: [] }));
  close(line(r, KAHVE).counted, 500, "eski çarpan korunur");
  close(line(r, KAHVE).estimate, 500, "hareket yok");
  assert.equal(line(r, KAHVE).unit, "KG");
  assert.equal(line(r, KAHVE).factor, 1000);
  assert.equal(stockQty(16_800, { unit: "LT", factor: 1000 }), "16,8 LT");
  assert.equal(stockQty(1550, { unit: "KG", factor: 1000 }), "1,55 KG");
  assert.equal(stockQty(86.5, { unit: "ADET", factor: 1 }), "86,5 ADET");
  // Eşik sayım biriminde yazılır, kendi biriminde saklanır
  assert.deepEqual(parseThresholdInput("2,5", 1000), { value: 2500 });
  assert.deepEqual(parseThresholdInput(" 12 ", 1), { value: 12 });
  assert.deepEqual(parseThresholdInput("", 1000), { value: null });
  assert.ok("error" in parseThresholdInput("-1", 1000));
  assert.ok("error" in parseThresholdInput("iki", 1000));
  assert.equal(thresholdInputValue(2500, 1000), "2,5");
  assert.equal(thresholdInputValue(null, 1000), "");
  // Formüllü reçete satırı Ayarlar'daki değerle (motorla aynı); bozuk formülde yazılı miktar
  const [shot, broken] = recipePerUnit(
    [
      { productId: 1, ingredientId: KAHVE, qty: 0, qtyExpr: "2*ShotTek" },
      { productId: 1, ingredientId: SUT, qty: 150, qtyExpr: "2*Yok" },
    ],
    DEFAULT_SETTINGS,
  );
  assert.equal(shot.qty, 2 * DEFAULT_SETTINGS.shotTek);
  assert.equal(broken.qty, 150);
});

test("fire: satışa bir kez, ambalaja uygulanmaz ayarı açıksa Ambalaj'a eklenmez; zayiye hiç", () => {
  const noFire = estimateStock(base({ fireRate: 0 }));
  close(line(noFire, SUT).estimate, 10_000 + 11_000 - 2000 - 2100, "fire 0");
  const pack = estimateStock(base({ fireExcludesPackaging: true }));
  close(line(pack, BARDAK).estimate, 100 - 10 - 3, "ambalaja fire yok");
  close(line(pack, SUT).estimate, line(estimateStock(base()), SUT).estimate as number, "öteki malzemeler aynı");
});

test("kritik eşik: eşiğe eşit ya da altı kritik, eşik yoksa uyarı yok; kritikler listenin başında", () => {
  const r = estimateStock(base());
  assert.deepEqual(
    r.critical.map((l) => l.ingredientId),
    [KAHVE],
  );
  assert.equal(r.lines[0].ingredientId, KAHVE);
  assert.deepEqual(
    r.lines.slice(1).map((l) => l.ingredientId),
    [SUT, BARDAK, SURUP],
  );
  assert.equal(line(r, BARDAK).critical, false, "eşik yok");
  assert.equal(line(r, SUT).critical, false, "eşiğin üstünde");
  // Eşiğe eşit
  const equal = estimateStock(base({ thresholds: new Map([[KAHVE, 1550]]) }));
  assert.equal(line(equal, KAHVE).critical, true);
  const above = estimateStock(base({ thresholds: new Map([[KAHVE, 1549]]) }));
  assert.equal(line(above, KAHVE).critical, false);
  // Eksiye düşen tahmin olduğu gibi kalır ve eşik 0'da kritik
  const empty = estimateStock(base({ counts: [{ month: "2026-11", ingredientId: KAHVE, qty: 0.1, factor: 1000 }], thresholds: new Map([[KAHVE, 0]]) }));
  assert.ok((line(empty, KAHVE).estimate as number) < 0);
  assert.equal(line(empty, KAHVE).critical, true);
  // Kartın özeti
  // Son 14 günün ortalamasıyla kaç gün yeter: (378 gr satış + 54 gr zayi ve ikram) ÷ 8 gün = 54 gr/gün
  assert.deepEqual(stockAlertItems(r.critical), { items: [{ ingredientId: KAHVE, name: "Espresso çekirdeği", text: "≈ 1,55 KG · eşik 2 KG · ≈ 28 gün yeter" }], more: 0 });
  const many = stockAlertItems([...r.critical, ...r.critical, ...r.critical, ...r.critical, ...r.critical], 4);
  assert.equal(many.items.length, 4);
  assert.equal(many.more, 1);
});

test("gün sonu gelmeyen gün: dönemin içinde, kapalı işaretli gün ve bugün hariç", () => {
  const r = estimateStock(base());
  assert.deepEqual(r.missingDays, ["2026-12-05"]);
});

test("Tuzla etkilenmez: tahmin yalnız Marina'nın; Tuzla ve online kanal seçiliyken hiçbir şey okunmaz ve çizilmez", () => {
  assert.equal(STOCK_ESTIMATE_BRANCH, "marina");
  assert.equal(showsStockEstimate("marina"), true);
  assert.equal(showsStockEstimate("hepsi"), true);
  assert.equal(showsStockEstimate("tuzla"), false);
  assert.equal(showsStockEstimate("online"), false);

  // Okuyucu yalnız Marina'nın satırlarını okur ve kartı kapıdan geçirir; sayım, fatura ve FIFO tablolarına yazmaz
  const loader = read("src/server/data/stock-estimate.ts");
  for (const table of ["stockCounts", "posDailySales", "posDayReports", "wasteEntries", "stockThresholds"]) {
    assert.match(loader, new RegExp(`eq\\(s\\.${table}\\.branchId, STOCK_ESTIMATE_BRANCH\\)`), `${table} şubeyle süzülür`);
  }
  // Marina'ya gelen faturalar: faturanın kendi şubesi (tek kaynak; stock_receipts kalktı, docs/SUBE.md › Faturanın şubesi)
  assert.match(loader, /eq\(inv\.branchId, STOCK_ESTIMATE_BRANCH\)/);
  assert.doesNotMatch(loader, /stockReceipts/);
  assert.match(loader, /showsStockEstimate\(await currentBranchScope\(\)\)/);
  assert.doesNotMatch(loader, /\.(insert|update|delete)\(/, "okuyucu yazmaz");
  const actions = read("src/server/actions/stock-estimate.ts");
  for (const m of actions.matchAll(/\.(insert|update|delete)\(s\.(\w+)\)/g)) {
    assert.ok(["stockThresholds"].includes(m[2]), `eylem yalnız kendi tablosuna yazar: ${m[2]}`);
  }
  assert.match(actions, /requireAdmin\(\)/);

  // Stok sayımı: düğme yalnız gösterilen şube Marina'yken
  const sayim = read("src/app/panel/sayim/page.tsx");
  assert.match(sayim, /branch\.id === STOCK_ESTIMATE_BRANCH/);
  // Genel bakış ve Bugün kartı okuyucunun kapısından geçer (Tuzla'da null)
  assert.match(read("src/app/panel/page.tsx"), /loadStockAlert\(\)/);
  assert.match(read("src/app/panel/bugun/page.tsx"), /loadStockAlert\(\)/);
});

test("Marina'ya gelen faturalar: liste kesilince not, kesilmezse yok (bulgu 42)", () => {
  assert.equal(receiptListNote(12, 12, 3), null, "kesilmedi");
  assert.equal(receiptListNote(0, 0, 0), null);
  // 100 gösteriliyor, 130 var; 120 açık: listede 100 açık, gizlenen 30'un 20'si açık
  assert.equal(receiptListNote(100, 130, 120), "100 fatura gösteriliyor (şubesi seçilmeyenler önce), 30 fatura daha var: 20 tanesinin şubesi seçilmedi, seçtikçe listede yerini alır.");
  // Açıkların hepsi listede: gizlenenler seçilmiş
  assert.equal(receiptListNote(100, 1_250, 7), "100 fatura gösteriliyor (şubesi seçilmeyenler önce), 1.150 fatura daha var; hepsinin şubesi seçildi.");
});

// ---------------------------------------------------------------- Online sipariş, kaç gün yeter, eşik önerisi

/** Marina'nın online ay kayıtları: Aralık (süren ay, 9 Aralık'a kadar) ve Kasım (sayımın içinde; yalnız ortalamada) */
const ONLINE: NonNullable<StockEstimateInput["online"]> = {
  months: [
    {
      month: "2026-12",
      through: "2026-12-09",
      orders: 6,
      tillOrders: 2,
      lines: [
        { productId: LATTE, name: "Latte M", qty: 5 },
        { productId: null, name: "Pumpkin Latte L", qty: 2 },
        { productId: COOKIE, name: "Cookie", qty: 1 },
      ],
    },
    { month: "2026-11", through: "2026-11-30", orders: 30, tillOrders: 0, lines: [{ productId: LATTE, name: "Latte M", qty: 30 }] },
  ],
};

test("online: kasadan geçmeyen sipariş reçeteyle × (1 + fire) düşülür; dönemden önceki ay düşülmez; bağlanmayan satır sayılır", () => {
  const r = estimateStock(base({ online: ONLINE }));
  const sut = line(r, SUT);
  close(sut.online, 5 * 200 * 1.05, "süt online (5 Latte × 200 ml × 1,05)");
  close(sut.sold, 2000 * 1.05, "AsilPOS satışı değişmez");
  close(sut.estimate, 10_000 + 11_000 - 2100 - 1050 - 2100, "süt tahmini online düşülmüş");
  close(line(r, KAHVE).online, 5 * 18 * 1.05, "çekirdek online");
  close(line(r, BARDAK).online, 5 * 1.05, "bardak online");
  assert.equal(line(r, SURUP).online, null, "sayılmamış malzemede rakam yok");
  assert.ok(r.online, "site bağlıyken özet var");
  assert.equal(r.online.orders, 6, "yalnız dönemin ayının siparişi");
  assert.equal(r.online.tillOrders, 2);
  assert.equal(r.online.qty, 5, "tüketime giren adet: reçetesi olan, ürüne bağlı satır");
  assert.deepEqual(r.online.unmatched, { lines: 1, qty: 2, names: 1, top: ["Pumpkin Latte L"] }, "menüye bağlı olmayan online satır");
  assert.ok(r.noRecipe.top.includes("Cookie"), "reçetesi boş ürünün online satırı reçetesizlere");
  assert.deepEqual(r.online.missingMonths, [], "gereken aylar (Kasım: ortalama, Aralık: dönem) var");
  assert.equal(r.online.through, "2026-12-09");
  // Kapanmış Kasım'ın online siparişi sayımın içinde: tahmin yalnız Aralık'ı düşer
  const onlyNov = estimateStock(base({ online: { months: [ONLINE.months[1]] } }));
  close(line(onlyNov, SUT).online, 0, "dönemden önceki ay düşülmez");
  assert.deepEqual(onlyNov.online?.missingMonths, ["2026-12"], "dönemin ayının kaydı yok");
});

test("online: kasada ödenen ve elle girilen sipariş AsilPOS'la çift sayılmaz (yalnız bilgi); site bağlı değilse düşülmez ve uyarı yok", () => {
  const a = estimateStock(base({ online: ONLINE }));
  const b = estimateStock(base({ online: { months: ONLINE.months.map((m) => ({ ...m, tillOrders: m.tillOrders + 40 })) } }));
  close(line(b, SUT).estimate, line(a, SUT).estimate as number, "kasadan geçen sipariş tahmini değiştirmez");
  assert.equal(b.online?.tillOrders, 42);
  const off = estimateStock(base({ online: null }));
  assert.equal(off.online, null, "bağlantı yok: özet yok");
  close(line(off, SUT).online, 0);
  close(line(off, SUT).estimate, line(estimateStock(base()), SUT).estimate as number, "online verilmezse eski hesap");
  // Bağlı ama hiç kayıt yok: gereken aylar eksik
  assert.deepEqual(estimateStock(base({ online: { months: [] } })).online?.missingMonths, ["2026-11", "2026-12"]);
  // Tahmin yoksa ay da gerekmez
  assert.deepEqual(onlineMonthsNeeded(null, "2026-12-10"), []);
  assert.deepEqual(onlineMonthsNeeded("2026-12-01", "2026-12-20"), ["2026-12"], "pencere dönemin içinde");
  assert.deepEqual(onlineMonthsNeeded("2026-10-01", "2026-12-10"), ["2026-10", "2026-11", "2026-12"]);
});

test("online ay kaydı: sitenin satırları menü bağlantısıyla ürüne, seçenekler kendi ürününe; kayıt çekildiği günün öncesine kadar", () => {
  const totals = { orders: 4, grossMinor: 0, discountMinor: 0, deliveryMinor: 0, refundedMinor: 0, netMinor: 0, kdvMinor: 0, unknownKdvNetMinor: 0 };
  const products = [
    { id: LATTE, name: "Latte", active: true, siteMenuId: "mnu-0003", siteMenuSlot: "M" },
    { id: 20, name: "Extra Shot", active: true, siteMenuId: "mnu-0081", siteMenuSlot: "M" },
  ];
  const m = estimateOnlineMonth(
    {
      month: "2026-12",
      // 07:30 İstanbul: 10 Aralık bitmedi, kayıt 9 Aralık'a kadar
      pulledAt: "2026-12-10T04:30:00.000Z",
      cafe: {
        ...totals,
        lines: [
          { menuItemId: "mnu-0003", size: "M", name: "Latte", qty: 3, listMinor: 0, extraShots: 2, syrups: { karamel: 1 }, milks: { yulaf: 1, normal: 2 } },
          { menuItemId: "mnu-0003", size: "L", name: "Latte", qty: 1, listMinor: 0 },
          { menuItemId: "mnu-0099", size: "single", name: "Pumpkin", qty: 2, listMinor: 0 },
        ],
      },
      manual: { orders: 1, grossMinor: 0, netMinor: 0 },
      counter: { orders: 2, grossMinor: 0, netMinor: 0 },
    },
    buildSiteLinkIndex(products),
    products,
  );
  assert.equal(m.through, "2026-12-09");
  assert.equal(m.orders, 4);
  assert.equal(m.tillOrders, 3, "kasada ödenen 2 + elle girilen 1");
  assert.deepEqual(m.lines, [
    { productId: LATTE, name: "Latte M", qty: 3 },
    // L yuvasına bağlı ürün yok: başka boya düşülmez
    { productId: null, name: "Latte L", qty: 1 },
    { productId: null, name: "Pumpkin", qty: 2 },
    { productId: 20, name: "Ekstra shot", qty: 2 },
    { productId: null, name: "Şurup", qty: 1 },
    // Normal süt içeceğin reçetesinde: sayılmaz
    { productId: null, name: "Alternatif süt", qty: 1 },
  ]);
  assert.equal(onlineThrough("2026-11", "2026-12-10"), "2026-11-30", "biten ayın kaydı ayın sonuna kadar");
  assert.equal(onlineThrough("2026-12", "2026-12-01"), "2026-11-30", "ayın ilk günü çekilen kayıt tam gün kapsamaz");
});

test("kaç gün yeter ve eşik önerisi: son 14 günün gün sonu gelen ya da kapalı günlerine bölünür; online takvim günüyle", () => {
  const r = estimateStock(base());
  assert.equal(r.avgWindow, 14);
  // 26 Kasım – 9 Aralık: 7 gün sonu + 1 kapalı gün; 30 Kasım'ın (gün sonu yok) satışı ve 5 Aralık'ın ikramı girmez
  assert.equal(r.avgDays, 8);
  const sut = line(r, SUT);
  // (10 Latte × 200 × 1,05 + 1,5 LT zayi + 2 Latte zayi ve ikram × 200) ÷ 8
  close(sut.dailyUse, (2100 + 1500 + 400) / 8, "süt günlük kullanım");
  close(sut.daysLeft, 16_800 / 500, "süt kaç gün");
  assert.equal(daysLeftText(sut.daysLeft), "≈ 33 gün");
  // 500 ml × (3 gün tedarik + 1 gün emniyet), KG/LT 0,1'e yukarı
  assert.equal(sut.suggestedThreshold, 2000);
  assert.equal(r.leadDays, DEFAULT_LEAD_DAYS);
  assert.equal(line(estimateStock(base({ leadDays: 5 })), SUT).suggestedThreshold, 3000, "tedarik 5 gün");
  const bardak = line(r, BARDAK);
  close(bardak.dailyUse, (10 * 1.05 + 2) / 8, "bardak");
  assert.equal(bardak.suggestedThreshold, 7, "adet 1'e yukarı (6,25 → 7)");
  assert.equal(line(r, SURUP).dailyUse, null, "sayılmamış malzemede yok");

  // Online: Aralık 1000 ml ÷ 9 gün × 9 + Kasım 6000 ml ÷ 30 gün × 5 = 2000 ml ÷ 14 gün × 1,05
  const o = line(estimateStock(base({ online: ONLINE })), SUT);
  close(o.dailyUse, 500 + (2000 / 14) * 1.05, "süt günlük kullanım online dahil");
  close(o.daysLeft, (16_800 - 1050) / 650);
  assert.equal(o.suggestedThreshold, 2600);

  // Ortalama için en az 3 gün: azsa kaç gün ve öneri yok
  const few = estimateStock(base({ receivedDays: ["2026-12-09"], closedDays: [] }));
  assert.equal(few.avgDays, 1);
  assert.equal(line(few, SUT).dailyUse, null);
  assert.equal(line(few, SUT).daysLeft, null);
  assert.equal(line(few, SUT).suggestedThreshold, null);
  assert.ok(MIN_AVG_DAYS > 1, "en az gün birden çok");

  assert.equal(daysLeftText(null), "–");
  assert.equal(daysLeftText(0.4), "1 günden az");
  assert.equal(daysLeftText(4.9), "≈ 4 gün");
  assert.equal(daysLeftText(75), "60+ gün");
  assert.equal(suggestThreshold(null, 3, 1000), null);
  assert.equal(suggestThreshold(0, 3, 1000), null, "kullanım yoksa öneri yok");
  assert.equal(suggestThreshold(10, 2, 1), 30);
  assert.equal(parseLeadDays("5"), 5);
  assert.equal(parseLeadDays(["7"]), 7);
  assert.equal(parseLeadDays("4"), DEFAULT_LEAD_DAYS, "seçeneklerde yok");
  assert.equal(parseLeadDays(undefined), DEFAULT_LEAD_DAYS);
});

test("öneri yalnız önerir: eşik yalnız yöneticinin Kaydet'iyle yazılır; online kaydı kâr-zarara girmez", () => {
  // Ekran öneriyi alana yazar, Kaydet aynı eylemdir (saveStockThreshold); otomatik yazım yok
  const input = read("src/app/panel/sayim/tahmini/threshold-input.tsx");
  assert.match(input, /setValue\(suggestion\)/);
  assert.equal((input.match(/saveStockThreshold\(/g) ?? []).length, 1, "tek yazım: Kaydet");
  const actions = read("src/server/actions/stock-estimate.ts");
  assert.match(actions, /export async function refreshStockOnline[\s\S]*?requireAdmin\(\)/, "online yenileme yalnız yönetici");
  // Şubenin ay kaydı ayrı önekte: işletmenin kayıtlarını okuyan loadSiteSales (kâr-zarar, KDV, tüketim) onu görmez
  const sync = read("src/server/site-sales/sync.ts");
  assert.match(sync, /const MONTH_PREFIX = "site_sales:"/);
  assert.match(sync, /const BRANCH_PREFIX = "site_sales_sube:"/);
  assert.ok(!"site_sales_sube:marina:2026-12".startsWith("site_sales:"), "önek ayrı");
});
