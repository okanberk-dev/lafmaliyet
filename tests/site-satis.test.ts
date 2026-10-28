// laffogato.net online satışları (docs/SITE-SATIS.md): sitenin satış yanıtının doğrulanması, KDV hariç gelir (oranı
// bilinmeyen kısım dahil), kâr-zarardaki ayrı gelir satırları ve kâr, menü bağlantısıyla satır → ürün eşlemesi ve
// tüketim, kasa raporunun bilgi satırı (site düşükse satır yok), günlük işin ayları ve sunucu kodunun kuralları.
// Çalıştırma: npx tsx --test tests/site-satis.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { computeCash, type CashReportFields } from "../src/lib/cash-report";
import { createModel } from "../src/lib/calc/engine";
import { alerts, consistency, dashboard, yearTrend } from "../src/lib/calc/insights";
import type { Dataset } from "../src/lib/calc/types";
import {
  buildSiteLinkIndex,
  exVatMinor,
  lineSlot,
  mapSiteLines,
  optionProductId,
  optionTotals,
  productForLine,
  salesMonthsToPull,
  siteRevenue,
  tillOnlineRow,
  tillRowOrNull,
} from "../src/lib/site-sales/calc";
import { monthRange, parseSiteSales, readSalesRecord, SiteSalesFormatError, type SiteSales, type SiteSalesMonth } from "../src/lib/site-sales/schema";
import { renderCashReport } from "../src/server/notify/cash-report-template";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
const base: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };

const close = (a: number | null | undefined, b: number, msg?: string, eps = 1e-6) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < eps, `${msg ?? ""}: ${a} ≠ ${b}`);

/** Sitenin docs/PANEL-SALES.md'sindeki örnek (Ekim 2026) */
const contract = (over: Record<string, unknown> = {}) => ({
  now: "2026-11-02T09:00:00.000Z",
  version: 1,
  from: "2026-10-01",
  to: "2026-10-31",
  closed: true,
  cafe: {
    orders: 412,
    grossMinor: 6230000,
    discountMinor: 81000,
    deliveryMinor: 95000,
    refundedMinor: 24000,
    netMinor: 6206000,
    kdvMinor: 571200,
    unknownKdvNetMinor: 0,
    lines: [{ menuItemId: "mnu-0003", size: "M", name: "Latte", qty: 230, listMinor: 2760000 }],
  },
  shop: { orders: 9, grossMinor: 449100, discountMinor: 0, deliveryMinor: 44100, refundedMinor: 0, netMinor: 449100, kdvMinor: 44172, unknownKdvNetMinor: 0 },
  karaoke: { bookings: 21, collectedMinor: 2150000, refundedMinor: 100000, netMinor: 2050000, refundPendingMinor: 0, kdvMinor: 341667, unknownKdvNetMinor: 0 },
  manual: { orders: 3, grossMinor: 96000, netMinor: 96000 },
  ...over,
});
const OCT = { from: "2026-10-01", to: "2026-10-31" };

// ---------------------------------------------------------------- Sitenin yanıtı

test("yanıt: sözleşmedeki örnek okunur; bilinmeyen alan atılır, ad kısaltılır", () => {
  const s = parseSiteSales({ ...contract(), extra: 1, cafe: { ...contract().cafe, newTotal: 5 } }, OCT);
  assert.equal(s.closed, true);
  assert.equal(s.cafe.netMinor, 6206000);
  assert.deepEqual(s.cafe.lines, [{ menuItemId: "mnu-0003", size: "M", name: "Latte", qty: 230, listMinor: 2760000 }]);
  assert.equal(s.manual.orders, 3);
  assert.ok(!("extra" in s) && !("newTotal" in s.cafe));
  const long = parseSiteSales(contract({ cafe: { ...contract().cafe, lines: [{ menuItemId: "", size: "single", name: "  " + "x".repeat(300), qty: 1, listMinor: 0 }] } }), OCT);
  assert.equal(long.cafe.lines[0].name.length, 120);
});

test("yanıt: tanınmayan sürüm, başka dönem, eksi / kesirli tutar ve bilinmeyen boy bütün yanıtı reddeder", () => {
  assert.throws(() => parseSiteSales(contract({ version: 2 }), OCT), /tanınmayan sürümde \(2\)/);
  assert.throws(() => parseSiteSales({ ...contract(), version: undefined }, OCT), /sürüm yok/);
  assert.throws(() => parseSiteSales(contract(), { from: "2026-09-01", to: "2026-09-30" }), /başka bir dönemin satışını gönderdi/);
  assert.throws(() => parseSiteSales(contract({ shop: { ...contract().shop, netMinor: -1 } }), OCT), /shop\.netMinor/);
  assert.throws(() => parseSiteSales(contract({ karaoke: { ...contract().karaoke, kdvMinor: 1.5 } }), OCT), /karaoke\.kdvMinor/);
  assert.throws(() => parseSiteSales(contract({ cafe: { ...contract().cafe, lines: [{ menuItemId: "mnu-0003", size: "XL", name: "Latte", qty: 1, listMinor: 0 }] } }), OCT), /cafe\.lines\.0\.size/);
  assert.throws(() => parseSiteSales(contract({ closed: "evet" }), OCT), SiteSalesFormatError);
  assert.throws(() => parseSiteSales(contract({ manual: undefined }), OCT), /manual/);
});

test("saklanan kayıt: aynı kurallardan geçer; bozuk kayıt hesaba girmez", () => {
  const rec: SiteSalesMonth = { ...parseSiteSales(contract(), OCT), month: "2026-10", pulledAt: "2026-11-02T09:00:05.000Z" };
  assert.deepEqual(readSalesRecord(JSON.parse(JSON.stringify(rec))), rec);
  assert.equal(readSalesRecord({ ...rec, month: "2026-11" }), null, "ay ile dönem tutmuyor");
  assert.equal(readSalesRecord({ ...rec, cafe: { ...rec.cafe, netMinor: "çok" } }), null);
  assert.equal(readSalesRecord(null), null);
  assert.deepEqual(monthRange("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(monthRange("2028-02"), { from: "2028-02-01", to: "2028-02-29" });
});

// ---------------------------------------------------------------- KDV hariç

test("KDV hariç: net − KDV − oranı bilinmeyenin panel oranıyla KDV'si (kuruş → TL)", () => {
  const s = parseSiteSales(contract(), OCT);
  const r = siteRevenue(s, 0.1);
  close(r.cafe, 56348, "kafe");
  close(r.shop, 4049.28, "mağaza");
  close(r.karaoke, 17083.33, "karaoke");
  close(r.total, 56348 + 4049.28 + 17083.33, "toplam");
  // Oranı saklı olmayan 1.100 ₺: %10 ile 100 ₺ KDV, 1.000 ₺ KDV hariç
  close(exVatMinor({ netMinor: 110000, kdvMinor: 0, unknownKdvNetMinor: 110000 }, 0.1), 100000);
  close(exVatMinor({ netMinor: 110000, kdvMinor: 0, unknownKdvNetMinor: 110000 }, 0.2), 110000 - 110000 * (0.2 / 1.2));
  // Karışık: oranı bilinen kısım sitenin KDV'si, bilinmeyen kısım panel oranı
  close(exVatMinor({ netMinor: 330000, kdvMinor: 20000, unknownKdvNetMinor: 110000 }, 0.1), 330000 - 20000 - 10000);
  // Ödül kuponu: bedava içeceğin faturası tam fiyattan KDV doğurur, KDV hariç gelir eksi çıkabilir (doğru)
  close(exVatMinor({ netMinor: 0, kdvMinor: 1800, unknownKdvNetMinor: 0 }, 0.1), -1800);
  close(exVatMinor({ netMinor: 1000, kdvMinor: 0, unknownKdvNetMinor: 1000 }, Number.NaN), 1000, "bozuk oran: KDV ayrılmaz");
});

// ---------------------------------------------------------------- Kâr-zarar

/** Latte M ve L, Matcha Latte (tek boy) siteye bağlı; Ekim'in online satışı çekilmiş */
function linked(overSales: Record<string, unknown> = {}): { ds: Dataset; latteM: number; latteL: number; matcha: number } {
  const products = base.products.map((p) =>
    p.name === "Latte" && p.size === "M"
      ? { ...p, siteMenuId: "mnu-0003", siteMenuSlot: "M" as const }
      : p.name === "Latte" && p.size === "L"
        ? { ...p, siteMenuId: "mnu-0003", siteMenuSlot: "L" as const }
        : p.name === "Matcha Latte"
          ? { ...p, siteMenuId: "mnu-0050", siteMenuSlot: "M" as const }
          : p,
  );
  const lines = [
    { menuItemId: "mnu-0003", size: "M", name: "Latte", qty: 230, listMinor: 4485000 },
    { menuItemId: "mnu-0003", size: "L", name: "Latte", qty: 40, listMinor: 840000 },
    { menuItemId: "mnu-0050", size: "single", name: "Matcha Latte", qty: 10, listMinor: 215000 },
    { menuItemId: "mnu-0099", size: "M", name: "Yeni İçecek", qty: 5, listMinor: 100000 },
    { menuItemId: "mnu-0050", size: "L", name: "Matcha Latte", qty: 2, listMinor: 50000 },
    { menuItemId: "", size: "single", name: "Kalemsiz ürün", qty: 1, listMinor: 5000 },
  ];
  const sales = parseSiteSales(contract({ cafe: { ...contract().cafe, lines }, ...overSales }), OCT);
  const id = (name: string, size: string) => base.products.find((p) => p.name === name && p.size === size)!.id;
  return {
    ds: { ...base, products, siteSales: [{ ...sales, month: "2026-10", pulledAt: "2026-11-02T09:00:05.000Z" }] },
    latteM: id("Latte", "M"),
    latteL: id("Latte", "L"),
    matcha: id("Matcha Latte", "Tek"),
  };
}

test("kâr-zarar: online satış ayrı gelir satırları (KDV hariç); ModPOS cirosu ve komisyonu değişmez, kâr ikisinin toplamından", () => {
  const plain = createModel(base);
  const { ds } = linked();
  const model = createModel(ds);
  const before = plain.pnlMonth("2026-10");
  const pm = model.pnlMonth("2026-10");
  const r = siteRevenue(ds.siteSales![0], base.settings.kdv);
  assert.equal(pm.revenue, before.revenue, "ModPOS cirosu");
  assert.equal(pm.revenueNet, before.revenueNet);
  close(pm.cells.get("commission:pos")!.value!, before.cells.get("commission:pos")!.value!, "POS komisyonu");
  close(pm.expenses, before.expenses, "giderler");
  close(pm.site!.cafe, r.cafe, "kafe");
  close(pm.site!.shop, r.shop, "mağaza");
  close(pm.site!.karaoke, r.karaoke, "karaoke");
  close(pm.revenueTotalNet!, before.revenueNet! + r.total, "toplam ciro");
  close(pm.profit, before.profit + r.total, "kâr online kadar artar");
  for (const k of ["cafe", "shop", "karaoke"] as const) close(model.pnlValue(pm, `site:${k}`).value, r[k], k);
  close(model.pnlValue(pm, "revenue:total").value, pm.revenueTotalNet!, "toplam satırı");
  close(model.pnlValue(pm, "revenueNet").value, before.revenueNet!, "AYLIK CİRO (KDV hariç) yalnız ModPOS");
  close(model.pnlValue(pm, "ratio:profit").value, pm.profit / pm.revenueTotalNet!, "oran bütün ciroyla");
  // Çekilmemiş ay: satır boş (0 değil), kâr ModPOS'la aynı
  const sep = model.pnlMonth("2026-09");
  assert.equal(sep.site, null);
  assert.equal(model.pnlValue(sep, "site:cafe").value, null);
  close(sep.profit, plain.pnlMonth("2026-09").profit, "Eylül");
  // Genel bakış ve yıl grafiği de aynı kârı gösterir
  close(dashboard(model, "2026-10").actual.profit, pm.profit, "Genel bakış");
  close(yearTrend(model, 2026).find((x) => x.month === "2026-10")!.revenueNet, pm.revenueTotalNet!, "yıl grafiğinin cirosu");
});

test("kâr-zarar satırları: yalnız çekilmiş bir ay varsa, AYLIK CİRO'dan sonra; Excel'deki gibi Türkçe büyük harf", () => {
  const model = createModel(linked().ds);
  const defs = model.pnlRowDefs(["2026-09", "2026-10"]);
  const keys = defs.filter((d) => d.section === "sonuc").map((d) => d.key);
  assert.deepEqual(keys, ["revenue", "revenueNet", "site:cafe", "site:shop", "site:karaoke", "revenue:total", "total:expenses", "profit", "ratio:expenses"]);
  const label = (k: string) => defs.find((d) => d.key === k)!.label;
  assert.equal(label("site:cafe"), "KAFE ONLİNE (SİTE + UYGULAMA)");
  assert.equal(label("site:shop"), "MAĞAZA (ONLİNE)");
  assert.equal(label("site:karaoke"), "KARAOKE (ÖN ÖDEMELİ)");
  assert.equal("KAFE ONLİNE (SİTE + UYGULAMA)".toLocaleLowerCase("tr-TR"), "kafe online (site + uygulama)", "ekrandaki cümle düzeni doğru çıkar");
  assert.match(defs.find((d) => d.key === "site:cafe")!.hint!, /%10 KDV'si/);
  assert.ok(defs.filter((d) => d.key.startsWith("site:")).every((d) => !d.editable && d.sub === "laffogato.net · KDV hariç"));
  // Online satışı çekilmemiş yıl: satır yok (tablo eskisi gibi)
  assert.ok(!model.pnlRowDefs(["2026-07", "2026-08"]).some((d) => d.key.startsWith("site:") || d.key === "revenue:total"));
  assert.ok(!createModel(base).pnlRowDefs(["2026-10"]).some((d) => d.key.startsWith("site:")));
});

// ---------------------------------------------------------------- Satır → ürün, tüketim

test("eşleme: kalem + yuva (L → L, M ve tek boy → M); bağlı ürün yoksa eşlenmez, başka boya düşülmez", () => {
  const index = buildSiteLinkIndex([
    { id: 6, siteMenuId: "mnu-0003", siteMenuSlot: "M" },
    { id: 7, siteMenuId: "mnu-0003", siteMenuSlot: "L" },
    { id: 62, siteMenuId: "mnu-0050", siteMenuSlot: "M" },
    { id: 99, siteMenuId: null, siteMenuSlot: null },
    { id: 100, siteMenuId: "mnu-0060", siteMenuSlot: "X" },
  ]);
  assert.equal(lineSlot("L"), "L");
  assert.equal(lineSlot("M"), "M");
  assert.equal(lineSlot("single"), "M");
  assert.equal(productForLine({ menuItemId: "mnu-0003", size: "M" }, index), 6);
  assert.equal(productForLine({ menuItemId: "mnu-0003", size: "L" }, index), 7);
  assert.equal(productForLine({ menuItemId: "mnu-0050", size: "single" }, index), 62);
  assert.equal(productForLine({ menuItemId: "mnu-0050", size: "L" }, index), null, "L yuvası bağlı değil");
  assert.equal(productForLine({ menuItemId: "", size: "M" }, index), null, "kalemsiz satır");
  assert.equal(productForLine({ menuItemId: "mnu-0060", size: "M" }, index), null, "bozuk yuva dizine girmez");
  const lines = [
    { menuItemId: "mnu-0003", size: "M" as const },
    { menuItemId: "mnu-0099", size: "M" as const },
  ];
  const m = mapSiteLines(lines, index);
  assert.deepEqual(m.mapped, [{ line: lines[0], productId: 6 }]);
  assert.deepEqual(m.unmapped, [lines[1]]);
});

test("tüketim: eşlenen satırlar reçeteyle ayrı kaynak; tutarlılıkta beklenen tüketime eklenir ve ayrıca görünür", () => {
  const { ds, latteM, latteL, matcha } = linked();
  const model = createModel(ds);
  const online = model.onlineUsage("2026-10");
  const expect = new Map<number, number>();
  for (const [pid, qty] of [
    [latteM, 230],
    [latteL, 40],
    [matcha, 10],
  ] as const) {
    for (const it of model.itemsByProduct.get(pid) ?? []) expect.set(it.ingredientId, (expect.get(it.ingredientId) ?? 0) + model.evalQty(it).qty * qty);
  }
  assert.deepEqual([...online.entries()].sort(), [...expect.entries()].sort());
  // ModPOS satışlarının tüketimi (sales_lines) değişmez
  assert.deepEqual(model.ingredientUsage("2026-10"), createModel(base).ingredientUsage("2026-10"));
  // Tutarlılık: beklenen = ModPOS + online; "online" ayrı alan
  const c = consistency(model, "2026-10");
  const plainRows = new Map(consistency(createModel(base), "2026-10").rows.map((r) => [r.ingredient.id, r]));
  for (const r of c.rows) {
    close(r.usage, r.posUsage + r.onlineUsage, r.ingredient.name);
    close(r.posUsage, plainRows.get(r.ingredient.id)?.usage ?? 0, `${r.ingredient.name} ModPOS`);
    close(r.onlineUsage, online.get(r.ingredient.id) ?? 0, `${r.ingredient.name} online`);
  }
  assert.ok(c.rows.some((r) => r.onlineUsage > 0));
  // Eşlenmeyen satırlar listelenir ve uyarı çıkar
  assert.deepEqual(
    c.online!.unmapped.map((l) => `${l.menuItemId}|${l.size}`),
    ["mnu-0099|M", "mnu-0050|L", "|single"],
  );
  assert.equal(c.online!.mappedQty, 280);
  assert.equal(c.online!.unmappedQty, 8);
  const alert = alerts(model, "2026-10").find((a) => a.href === "/panel/urunler/site");
  assert.match(alert!.title, /^3 online satış satırı panel ürününe bağlı değil$/);
  assert.match(alert!.detail, /Yeni İçecek M, Matcha Latte L, Kalemsiz ürün/);
  // Çekilmemiş ay: online yok
  assert.equal(consistency(model, "2026-09").online, null);
  assert.equal(model.onlineUsage("2026-09").size, 0);
});

// ---------------------------------------------------------------- Kasa raporu

test("kasa raporu satırı: o günün online toplamı (kafe + mağaza) ve karaoke, KDV dahil; site düşükse satır yok", async () => {
  const s = parseSiteSales(contract({ from: "2026-10-22", to: "2026-10-22" }), { from: "2026-10-22", to: "2026-10-22" });
  const row = tillOnlineRow("2026-10-22", s);
  close(row.online, (6206000 + 449100) / 100);
  close(row.karaoke, 20500);
  // Tutar ile ₺ arasında bölünmez boşluk (format.ts)
  assert.equal(row.text.replace(/\u00a0/g, " "), "Online (site + uygulama): 66.551 ₺ · Karaoke ön ödeme: 20.500 ₺ — kasadan geçmez");
  assert.deepEqual(await tillRowOrNull("2026-10-22", async () => s), row);
  assert.equal(await tillRowOrNull("2026-10-22", async () => Promise.reject(new Error("Site 8 saniyede yanıt vermedi"))), null, "site düşük");
  const started = Date.now();
  assert.equal(await tillRowOrNull("2026-10-22", () => new Promise<SiteSales>(() => {}), 50), null, "yanıt gelmezse");
  assert.ok(Date.now() - started < 1000, "beklemez");
});

test("kasa e-postası: online satır bilgi bölümü; kasa farkı ve Z rakamları değişmez; satır yoksa bölüm yok", () => {
  const f: CashReportFields = {
    date: "2026-10-22",
    zNo: "0042",
    receipts: 40,
    zTotal: 10000,
    cash: 2500,
    card: 7500,
    mealCard: 0,
    online: 0,
    other: 0,
    openingCash: 500,
    cashIn: 0,
    cashOut: 0,
    cashOutNote: null,
    countedCash: 2900,
    handedOver: 0,
    bankPos: null,
    offRevenue: null,
    note: null,
  };
  const online = { day: "2026-10-22", online: 1240, karaoke: 500, text: "Online (site + uygulama): 1.240 ₺ · Karaoke ön ödeme: 500 ₺ — kasadan geçmez" };
  const meta = { by: "Selin", revision: 1, submittedAt: new Date("2026-10-22T20:00:00Z") };
  const withRow = renderCashReport(f, { ...meta, online });
  const without = renderCashReport(f, { ...meta, online: null });
  assert.match(withRow.html, /laffogato\.net \(kasadan geçmez\)/);
  assert.match(withRow.html, /Online \(site \+ uygulama\)/);
  assert.match(withRow.text, /Online \(site \+ uygulama\): 1\.240\s₺ · Karaoke ön ödeme: 500\s₺ — kasadan geçmez/);
  assert.doesNotMatch(without.html, /kasadan geçmez/);
  assert.equal(withRow.subject, without.subject, "konu (kasa farkı) aynı");
  assert.equal(computeCash(f).cashDiff, -100);
  assert.match(withRow.html, /100\s₺ eksik/);
});

// ---------------------------------------------------------------- Günlük iş ve sunucu

test("günlük iş: içinde bulunulan ay ve önceki iki ay, her gün (geç gelen iade kapanmış ayı düşürür; yıl başında Kasım ve Aralık)", () => {
  // Eskiden 8'inden sonra yalnız bu ay çekiliyordu: 15 Kasım'da iade edilen 28 Ekim kolisi Ekim'den hiç düşmüyordu
  assert.deepEqual(salesMonthsToPull("2026-10-22"), ["2026-10", "2026-09", "2026-08"]);
  assert.deepEqual(salesMonthsToPull("2026-11-07"), ["2026-11", "2026-10", "2026-09"]);
  assert.deepEqual(salesMonthsToPull("2026-11-15"), ["2026-11", "2026-10", "2026-09"]);
  assert.deepEqual(salesMonthsToPull("2026-11-30"), ["2026-11", "2026-10", "2026-09"]);
  assert.deepEqual(salesMonthsToPull("2027-01-01"), ["2027-01", "2026-12", "2026-11"]);
  assert.deepEqual(salesMonthsToPull("2027-02-28"), ["2027-02", "2027-01", "2026-12"]);
  // "Siteden yenile" aynı ayları çeker (en çok 3 ay: sunucu eyleminin sınırı)
  assert.match(read("src/app/panel/gelir-gider/page.tsx"), /refreshMonths: salesMonthsToPull\(/);
  assert.match(read("src/server/actions/site-sales.ts"), /\.max\(3\)/);
  const cron = read("src/app/api/cron/gunluk/route.ts");
  assert.match(cron, /syncSiteSales\(\)\.catch\(/, "adım kendi hatasını yakalar, öteki işleri durdurmaz");
  assert.deepEqual(JSON.parse(read("vercel.json")).crons.length, 2, "yeni zamanlanmış iş yok");
});

test("sunucu: ay başına tek kayıt (üzerine yazılır, eski yanıt yazılmaz); kasa satırı saklanmaz; ekranlar ve yetki", () => {
  const sync = read("src/server/site-sales/sync.ts");
  assert.match(sync, /const MONTH_PREFIX = "site_sales:"/);
  assert.match(sync, /\(integration_state\.value->>'now'\)::timestamptz <= \(excluded\.value->>'now'\)::timestamptz/);
  assert.match(sync, /url\.searchParams\.set\(k, v\)/);
  assert.match(sync, /return tillRowOrNull\(day, \(\) =>/);
  assert.match(read("src/server/data/dataset.ts"), /loadSiteSales\(\)/);
  assert.match(read("src/app/api/export/workbook.ts"), /c\.revenueTotalNet \?\? 0/);
  // Kasa sayfası: satır ayrı Suspense'te (sayfa beklemez); personele karaoke tutarı yok
  const kasa = read("src/app/panel/kasa/page.tsx");
  assert.match(kasa, /<Suspense fallback=\{null\}>\s*<SiteDayRow date=\{date\} admin=\{admin\} kasa=\{lafposState\.lafpos \? "LafPOS" : "ModPOS"\} \/>/);
  assert.match(kasa, /\{admin \? <> · Karaoke ön ödeme/);
  // Gönderim: site isteği kayıtla aynı anda başlar, e-posta en çok 8 saniye bekler
  const actions = read("src/server/actions/cash-report.ts");
  assert.ok(actions.indexOf("const site = fetchTillOnlineRow(data.date)") < actions.indexOf("await saveCashReport("));
  assert.match(actions, /await emailReport\(saved\.id, \{ site \}\)/);
  // "Siteden yenile" yalnız yöneticinin
  const act = read("src/server/actions/site-sales.ts");
  assert.match(act, /const me = await requireAdmin\(\)/);
  assert.doesNotMatch(read("src/server/actions/site-sales.ts"), /^export (async )?function (?!refreshSiteSales)/m, "use server dosyasında yardımcı dışa verilmez");
});

// ---------------------------------------------------------------- Kasada ödenen siparişler, iadesi bekleyen, seçenekler

test("yanıt: kasada ödenen uygulama siparişleri (counter) isteğe bağlı; eski site göndermezse sıfır, gönderdiyse katı ve ciroya girmez", () => {
  const old = parseSiteSales(contract(), OCT);
  assert.deepEqual(old.counter, { orders: 0, grossMinor: 0, netMinor: 0 });
  const s = parseSiteSales(contract({ counter: { orders: 2, grossMinor: 48_000, netMinor: 48_000 } }), OCT);
  assert.deepEqual(s.counter, { orders: 2, grossMinor: 48_000, netMinor: 48_000 });
  assert.throws(() => parseSiteSales(contract({ counter: { orders: 2, grossMinor: -1, netMinor: 0 } }), OCT), /counter\.grossMinor/);
  // Ciroya girmez (site kafe toplamından ayırır): KDV hariç gelir aynı
  close(siteRevenue(s, 0.1).total, siteRevenue(old, 0.1).total, "ciro aynı");
  // Eski kayıt (counter yok) okunur
  const rec: SiteSalesMonth = { ...old, month: "2026-10", pulledAt: "2026-11-02T09:00:05.000Z" };
  const { counter: _drop, ...legacy } = rec;
  void _drop;
  assert.deepEqual(readSalesRecord(JSON.parse(JSON.stringify(legacy)))!.counter, { orders: 0, grossMinor: 0, netMinor: 0 });
  // Gelir-gider kartı: elle girilen gibi bilgi satırı; karaokede iadesi bekleyen tutar da
  const card = read("src/app/panel/gelir-gider/site-sales-card.tsx");
  assert.match(card, /kasada ödenen \$\{num\(m\.counterOrders\)\} uygulama siparişi/);
  assert.match(card, /karaokede iadesi bekleyen \$\{money\(m\.refundPending\)\}/);
  const page = read("src/app/panel/gelir-gider/page.tsx");
  assert.match(page, /counterOrders: rec!\.counter\?\.orders \?\? 0/);
  assert.match(page, /refundPending: rec!\.karaoke\.refundPendingMinor \/ 100/);
});

test("yanıt: satırın seçenekleri (ekstra shot, şurup, süt) isteğe bağlı; gönderildiyse katı; toplamda normal süt sayılmaz", () => {
  const line = { menuItemId: "mnu-0003", size: "M", name: "Latte", qty: 3, listMinor: 60000 };
  const parse = (extra: Record<string, unknown>) => parseSiteSales(contract({ cafe: { ...contract().cafe, lines: [{ ...line, ...extra }] } }), OCT).cafe.lines[0];
  assert.deepEqual(parse({}), line, "eski satır aynen");
  const l = parse({ extraShots: 2, syrups: { vanilla: 1, caramel: 1 }, milks: { normal: 1, oat: 2 } });
  assert.equal(l.extraShots, 2);
  assert.deepEqual(optionTotals([l, parse({})]), { extraShots: 2, syrups: 2, milks: 2 }, "alanı olmayan satır 0");
  assert.throws(() => parse({ extraShots: 1.5 }), /cafe\.lines\.0\.extraShots/);
  assert.throws(() => parse({ milks: { oat: -1 } }), /cafe\.lines\.0\.milks/);
  assert.throws(() => parse({ syrups: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`s${i}`, 1])) }), /cafe\.lines\.0\.syrups/);
  // Seçeneğin ürünü: önce sitenin menü kalemine bağlı ürün, sonra adı tutan (etkin olan önce)
  const products = [
    { id: 1, name: "Extra Shot", active: false },
    { id: 2, name: "EXTRA SHOT", active: true },
    { id: 3, name: "Şurup", active: true },
    { id: 4, name: "Alternatif Süt", active: true },
  ];
  assert.equal(optionProductId("extraShots", new Map(), products), 2, "ad, etkin olan");
  assert.equal(optionProductId("extraShots", buildSiteLinkIndex([{ id: 9, siteMenuId: "mnu-0081", siteMenuSlot: "M" }]), products), 9, "menü bağlantısı önce");
  assert.equal(optionProductId("syrups", new Map(), products), 3);
  assert.equal(optionProductId("milks", new Map(), products), 4);
  assert.equal(optionProductId("milks", new Map(), products.slice(0, 3)), null);
});
