// Nakit planının KDV tahmini (docs/NAKIT-PLANI.md › KDV tahmini): yuvarlama, dönem ve ödeme günü, kasa / laffogato.net /
// alış KDV'si, devreden zinciri (otomatik, muhasebeci kaydı, Ödemeler'deki tutar), süren ay ve yedek ay, metinler.
// Excel verisi, bugün 2026-10-22 (kalıp tests/price-impact.test.ts).
// Çalıştırma: npx tsx --test tests/kdv-tahmini.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import {
  posVat,
  purchaseVat,
  purchaseWithheld,
  round100,
  vat2DueDate,
  vat2LineDetail,
  vatDueDate,
  vatEstimates,
  vatLineDetail,
  vatMonthInputs,
  vatNote,
  vatPeriodOf,
  vatPeriodTitle,
  vatProgressText,
  vatSubText,
  type VatEstimate,
  type VatInput,
  type VatMonthInput,
} from "../src/lib/kdv";
import { siteRevenue, siteVat } from "../src/lib/site-sales/calc";
import type { SiteSalesMonth } from "../src/lib/site-sales/schema";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";
import type { Resource } from "../src/server/parasut/jsonapi";
import { billToDraft } from "../src/server/parasut/mapping";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
const ds: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
const model = createModel(ds);
const TODAY = "2026-10-22";
const inputs = vatMonthInputs(model, TODAY);
const close = (a: number | null | undefined, b: number, msg: string, eps = 0.01) => assert.ok(a != null && Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);

const estimate = (over: Partial<VatInput> = {}) =>
  vatEstimates({ today: TODAY, months: inputs.months, firstSalesMonth: inputs.firstSalesMonth, anchor: null, known: new Map(), periods: ["2026-09", "2026-10"], ...over });

function site(month: string, over: Partial<SiteSalesMonth> = {}): SiteSalesMonth {
  const t = (net: number, kdv: number, unknown = 0) => ({ orders: 1, grossMinor: net, discountMinor: 0, deliveryMinor: 0, refundedMinor: 0, netMinor: net, kdvMinor: kdv, unknownKdvNetMinor: unknown });
  return {
    month,
    pulledAt: "2026-10-22T05:00:00.000Z",
    now: "2026-10-22T05:00:00.000Z",
    from: `${month}-01`,
    to: `${month}-31`,
    closed: false,
    cafe: { ...t(1_100_000, 50_000, 550_000), lines: [] },
    shop: t(220_000, 20_000),
    karaoke: { bookings: 1, collectedMinor: 120_000, refundedMinor: 0, netMinor: 120_000, refundPendingMinor: 0, kdvMinor: 0, unknownKdvNetMinor: 120_000 },
    manual: { orders: 3, grossMinor: 500_000, netMinor: 500_000 },
    ...over,
  };
}

// ---------------------------------------------------------------- Yuvarlama, dönem, oran

test("100 ₺'ye yuvarlama: yarım yukarı, işaret korunur, −0 yok", () => {
  assert.equal(round100(149.99), 100);
  assert.equal(round100(150), 200);
  assert.equal(round100(-150), -200);
  assert.equal(round100(-149), -100);
  assert.ok(Object.is(round100(0), 0));
  assert.ok(Object.is(round100(-0), 0));
  assert.ok(Object.is(round100(-40), 0));
  assert.equal(round100(15_780.64), 15_800);
  assert.equal(round100(11_875.67), 11_900);
});

test("ödeme günü ve dönem: ayın 28'i; hatırlatıcının 1–7'si iki ay öncesinin KDV'si", () => {
  assert.equal(vatDueDate("2026-10"), "2026-11-28");
  assert.equal(vatDueDate("2026-12"), "2027-01-28");
  assert.equal(vatPeriodOf("2026-11-28"), "2026-10");
  assert.equal(vatPeriodOf("2026-11-26"), "2026-10");
  assert.equal(vatPeriodOf("2026-11-04"), "2026-09");
  assert.equal(vatPeriodOf("2027-01-05"), "2026-11");
  assert.equal(vatPeriodOf("2026-11-08"), "2026-10");
  assert.equal(vatPeriodTitle("2026-10"), "Ekim KDV'si");
});

test("kasa KDV'si gelir-giderdeki kuralla: ciro − KDV hariç ciro (karaoke %20)", () => {
  const sep = posVat(429_698, 2_050, 0.1, 0.2);
  close(sep, 39_218.76, "Eylül");
  const pnl = model.pnlMonth("2026-09");
  close(sep, pnl.revenue! - pnl.revenueNet!, "Gelir-gider farkı", 1e-6);
  close(posVat(1_100, 0, 0.1, 0.2), 100, "hizmetsiz", 1e-9);
  // Hizmet payı ciroyu aşamaz
  close(posVat(1_200, 5_000, 0.1, 0.2), 200, "hepsi hizmet", 1e-9);
});

test("alış KDV'si: KDV toplamı (tevkifat dahil), yoksa ödenecek − (tutar − iskonto); iade eksi; tevkifat ayrıca", () => {
  assert.equal(purchaseVat({ amount: 1_000, discount: 50, payable: 1_045 }), 95);
  assert.equal(purchaseWithheld({ amount: 1_000, discount: 50, payable: 1_045 }), 0);
  const bill: Resource = {
    id: "1",
    type: "purchase_bills",
    attributes: { item_type: "purchase_bill", issue_date: "2026-10-05", currency: "TRL", gross_total: "1000", total_discount: "0", total_vat: "200", total_vat_withholding: "100", net_total: "1100", remaining: "1100" },
    relationships: {},
  };
  const tevkifat = billToDraft(bill, []);
  // Beyannamede KDV'nin tamamı indirilir (yurtiçi alımlar 100 + sorumlu sıfatıyla 100); tevkifat 2 No.lu beyannameyle ödenir
  assert.equal(purchaseVat(tevkifat), 200);
  assert.equal(purchaseVat(tevkifat), tevkifat.vat);
  assert.equal(purchaseWithheld(tevkifat), 100);
  const refund = billToDraft({ ...bill, attributes: { ...bill.attributes, item_type: "refund", gross_total: "2000", total_discount: "100", total_vat: "190", total_vat_withholding: "0", net_total: "2090", remaining: "0" } }, []);
  assert.equal(purchaseVat(refund), -190);
  assert.equal(purchaseWithheld(refund), 0);
  // Excel'den gelen faturalarda vat sütunu yok (0); KDV ödenecek ile net farkından
  const excelInv = ds.invoices.find((i) => i.payable - (i.amount - i.discount) > 1)!;
  assert.ok(excelInv);
  assert.ok(purchaseVat(excelInv) > 0);
  assert.equal(purchaseWithheld(excelInv), 0);
});

// ---------------------------------------------------------------- Muhasebecinin beyannameleri (Temmuz–Eylül 2026)

// Eylül 2026'nın tevkifatlı faturası: reklam 30.000 + %20 KDV 6.000, 3/10 tevkifat 1.800, tedarikçiye 34.200.
// Excel'de vat sütunu yok (fark 4.200); Paraşüt'ten gelince vat 6.000 olur.
const withParasutVat = (): Dataset => ({
  ...ds,
  invoices: ds.invoices.map((i) => (i.date === "2026-09-17" && i.amount === 30_000 && i.payable === 34_200 ? { ...i, vat: 6_000 } : i)),
});

test("Eylül 2026 beyannamesi: tevkifatlı faturanın KDV'si tam indirilir (11.875,70 + 1.800), tevkifat 25 Ekim'de", () => {
  const sep = vatMonthInputs(createModel(withParasutVat()), TODAY).months.find((m) => m.month === "2026-09")!;
  // Beyanname: yurtiçi alımlara ilişkin KDV 11.875,70 + sorumlu sıfatıyla ödenen 1.800 = indirilecek 13.675,70
  close(sep.purchases.vat, 11_875.67 + 1_800, "indirilecek KDV");
  close(sep.purchases.withheld, 1_800, "tevkifat (KDV2 tahakkuku 1.800)");
  assert.equal(vat2DueDate("2026-09"), "2026-10-25");
  assert.equal(vat2DueDate("2026-12"), "2027-01-25");
  assert.equal(vat2LineDetail("2026-09"), "Eylül faturalarındaki KDV tevkifatı: 2 No.lu beyannameyle ayın 25'inde ödenir, 1 No.lu beyannamede indirilir. Tahmin; kesin tutar muhasebecinizin beyannamesindedir.");
  // Ağustos beyannamesindeki devreden 209.238,91, Eylül'ün hesaplanan KDV'si 101.709,92 (%10 ve %20; %20'si kafe dışı
  // satış, panelde yok): zincir beyannamedeki 121.204,69'a iner
  const months = vatMonthInputs(createModel(withParasutVat()), TODAY).months.map((m) => (m.month === "2026-09" ? { ...m, pos: { ...m.pos!, vat: 101_709.92 } } : m));
  const out = vatEstimates({ today: TODAY, months, firstSalesMonth: "2026-07", anchor: { month: "2026-08", amount: 209_238.91 }, known: new Map(), periods: ["2026-09"] }).get("2026-09")!;
  assert.equal(out.purchases, 13_700);
  assert.equal(out.withheld, 1_800);
  assert.deepEqual({ carryIn: out.carryIn, net: out.net, payable: out.payable, carryOut: out.carryOut }, { carryIn: 209_200, net: -121_200, payable: 0, carryOut: 121_200 });
  assert.equal(round100(121_204.69), out.carryOut);
  // Tevkifat düşülmüş KDV'yle (eski kural) 1.800 eksik indirilirdi
  const old = vatEstimates({ today: TODAY, months: months.map((m) => (m.month === "2026-09" ? { ...m, purchases: { ...m.purchases, vat: m.purchases.vat - 1_800 } } : m)), firstSalesMonth: "2026-07", anchor: { month: "2026-08", amount: 209_238.91 }, known: new Map(), periods: ["2026-09"] }).get("2026-09")!;
  assert.equal(old.carryOut, 119_400);
});

test("laffogato.net KDV'si: saklı KDV + oranı bilinmeyenin panel oranıyla KDV'si; karaoke hizmet oranıyla; elle girilen sayılmaz", () => {
  const rec = site("2026-10");
  const v = siteVat(rec, 0.1, 0.2);
  const net = (rec.cafe.netMinor + rec.shop.netMinor + rec.karaoke.netMinor) / 100;
  close(v, net - siteRevenue(rec, 0.1, 0.2).total, "net − KDV hariç", 1e-9);
  // Sözleşmenin formülü: kdvMinor + bilinmeyen × r ÷ (1 + r)
  close(v, (50_000 + (550_000 * 0.1) / 1.1 + 20_000 + (120_000 * 0.2) / 1.2) / 100, "formül", 1e-9);
  // Karaoke satış oranıyla değil hizmet oranıyla
  assert.ok(siteVat(rec, 0.1, 0.2) > siteVat(rec, 0.1));
  // Elle girilen (ModPOS'ta olan) siparişler sayılmaz
  close(siteVat({ ...rec, manual: { orders: 99, grossMinor: 9_999_999, netMinor: 9_999_999 } } as SiteSalesMonth, 0.1, 0.2), v, "manual", 1e-9);
});

// ---------------------------------------------------------------- Aylık girdiler (Excel)

test("aylık girdiler (Excel): ilk satış ayı Temmuz, aylar Temmuz–Ekim; Ekim kasa KDV'si 16 günün; site yok", () => {
  assert.equal(inputs.firstSalesMonth, "2026-07");
  assert.deepEqual(
    inputs.months.map((m) => m.month),
    ["2026-07", "2026-08", "2026-09", "2026-10"],
  );
  assert.equal(inputs.hasSite, false);
  const oct = inputs.months.find((m) => m.month === "2026-10")!;
  close(oct.pos!.vat, 26_719, "Ekim");
  assert.equal(oct.pos!.openDays, 16);
  const sep = inputs.months.find((m) => m.month === "2026-09")!;
  assert.equal(sep.pos!.serviceRevenue, 2_050);
  assert.equal(sep.purchases.count, 30);
  close(sep.purchases.vat, 11_875.67, "Eylül alışları");
  assert.ok(inputs.months.every((m) => m.online === null));
});

// ---------------------------------------------------------------- Zincir

const pick = (e: VatEstimate | undefined) => e && { carryIn: e.carryIn, net: e.net, payable: e.payable, carryOut: e.carryOut };

test("otomatik zincir (kayıt yok): Temmuz'un açılış alımları Ekim sonuna kadar devreder, iki dönem de ödeme beklenmez", () => {
  const out = estimate();
  const sep = out.get("2026-09")!;
  const oct = out.get("2026-10")!;
  assert.deepEqual(pick(sep), { carryIn: 167_500, net: -140_200, payable: 0, carryOut: 140_200 });
  assert.equal(sep.pos, 39_200);
  assert.equal(sep.purchases, 11_900);
  assert.equal(sep.projected, false);
  assert.equal(oct.pos, 51_800);
  assert.equal(oct.projected, true);
  close(oct.basis.posRevenue, 569_448.69, "Ekim cirosu aya tamamlandı");
  assert.equal(oct.purchases, 9_700);
  assert.deepEqual(pick(oct), { carryIn: 140_200, net: -98_100, payable: 0, carryOut: 98_100 });
  assert.equal(oct.basis.inProgress, true);
  assert.equal(oct.basis.online, "none");
});

test("muhasebeci kaydı ve Ödemeler'deki tutar zinciri düzeltir", () => {
  // Ağustos beyannamesinde devreden yok: Eylül ≈ 27.300, Ekim ≈ 42.100
  const zero = estimate({ anchor: { month: "2026-08", amount: 0 } });
  assert.equal(zero.get("2026-09")!.payable, 27_300);
  assert.equal(zero.get("2026-10")!.payable, 42_100);
  // Eylül beyannamesinde 140.000 devreden: Eylül ödemesi 0, Ekim o tutardan devam eder
  const sep = estimate({ anchor: { month: "2026-09", amount: 140_000 } });
  assert.equal(sep.get("2026-09")!.payable, 0);
  assert.equal(sep.get("2026-09")!.anchored, true);
  assert.equal(sep.get("2026-10")!.carryIn, 140_000);
  assert.equal(sep.get("2026-10")!.carryOut, 97_900);
  assert.equal(sep.get("2026-10")!.payable, 0);
  // Ödemeler'e Eylül için 27.200 yazıldı: kesin, devreden sıfırlanır
  const known = estimate({ known: new Map([["2026-09", 27_200]]) });
  assert.equal(known.get("2026-09")!.payable, 27_200);
  assert.equal(known.get("2026-09")!.known, 27_200);
  assert.equal(known.get("2026-09")!.carryOut, 0);
  assert.equal(known.get("2026-10")!.payable, 42_100);
  // Tutar 0: ödeme yok ama devreden sürer
  const nothing = estimate({ known: new Map([["2026-09", 0]]) });
  assert.equal(nothing.get("2026-09")!.payable, 0);
  assert.equal(nothing.get("2026-10")!.carryIn, 140_200);
});

test("yuvarlama: her dönemde satış − alış − devreden = net, tutarlar 100'ün katı", () => {
  for (const out of [estimate(), estimate({ anchor: { month: "2026-08", amount: 0 } }), estimate({ anchor: { month: "2026-09", amount: 140_049 } })]) {
    for (const e of out.values()) {
      assert.equal(e.sales - e.purchases - e.carryIn, e.net);
      for (const v of [e.pos, e.online, e.sales, e.purchases, e.carryIn, e.net, e.payable, e.carryOut]) assert.equal(Math.abs(v) % 100, 0, `${e.period}: ${v}`);
    }
  }
});

test("süren ay: açık gün yoksa geçen günle tamamlanır; açık site kaydı çekildiği günün dünüyle, kapanmışsa olduğu gibi", () => {
  const noDays: VatMonthInput[] = inputs.months.map((m) => (m.month === "2026-10" ? { ...m, pos: { ...m.pos!, openDays: null } } : m));
  const oct = estimate({ months: noDays }).get("2026-10")!;
  assert.equal(oct.pos, round100((26_719 * 31) / 21));
  assert.equal(vatProgressText(oct), "Ekim bitmedi: ay sonuna tamamlandı");
  const withSite = (closed: boolean): VatMonthInput[] => inputs.months.map((m) => (m.month === "2026-10" ? { ...m, online: { vat: 2_100, closed, pulledOn: "2026-10-22" } } : m));
  assert.equal(estimate({ months: withSite(false) }).get("2026-10")!.online, round100((2_100 * 31) / 21));
  assert.equal(estimate({ months: withSite(true) }).get("2026-10")!.online, 2_100);
  // Geçen ay çekilmiş açık kayıt büyütülmez
  const stale: VatMonthInput[] = inputs.months.map((m) => (m.month === "2026-10" ? { ...m, online: { vat: 2_100, closed: false, pulledOn: "2026-11-02" } } : m));
  assert.equal(estimate({ months: stale }).get("2026-10")!.online, 2_100);
});

test("yedek ay: cirosu girilmemiş ayda önceki ayın günlük ortalaması; açılıştan önceki ayın alışı devredene girer", () => {
  const nov = vatEstimates({ today: "2026-11-20", months: [...inputs.months], firstSalesMonth: "2026-07", anchor: null, known: new Map(), periods: ["2026-11"] }).get("2026-11")!;
  assert.equal(nov.status, "ok");
  assert.equal(nov.basis.posFrom, "2026-10");
  assert.equal(nov.pos, round100((26_719 / 16) * 30));
  assert.equal(nov.projected, true);
  assert.equal(vatProgressText(nov), "Kasım bitmedi: Ekim'in günlük ortalamasıyla tahmin");
  assert.match(vatLineDetail(nov), /Kasım cirosu yok: Ekim'in günlük ortalamasıyla\./);
  // Haziran'da (açılıştan önce) 10.000 ₺ KDV'li alış: satış 0, Temmuz'a devreder
  const june: VatMonthInput = { month: "2026-06", pos: null, online: null, purchases: { vat: 10_000, withheld: 0, count: 1, separateCount: 0 } };
  const out = vatEstimates({ today: TODAY, months: [june, ...inputs.months], firstSalesMonth: "2026-07", anchor: { month: "2026-05", amount: 0 }, known: new Map(), periods: ["2026-06", "2026-07"] });
  assert.equal(out.get("2026-06")!.status, "ok");
  assert.equal(out.get("2026-06")!.sales, 0);
  assert.equal(out.get("2026-06")!.carryOut, 10_000);
  assert.equal(out.get("2026-07")!.carryIn, 10_000);
});

test("veri yoksa her dönem hesaplanamaz; verisiz ay zinciri bozmaz", () => {
  const none = vatEstimates({ today: TODAY, months: [], firstSalesMonth: null, anchor: null, known: new Map(), periods: ["2026-09", "2026-10"] });
  assert.ok([...none.values()].every((e) => e.status === "noData" && e.payable === 0));
  assert.equal(vatSubText(none.get("2026-09")!, null), "Bu ayın satış verisi yok");
  // Ağustos'un girdisi yok, Temmuz'un da cirosu silinmiş (yedek yok): Ağustos hesaplanamaz, Temmuz'un devredeni Eylül'e geçer
  const gap = inputs.months.filter((m) => m.month !== "2026-08").map((m) => (m.month === "2026-07" ? { ...m, pos: null } : m));
  const out = vatEstimates({ today: TODAY, months: gap, firstSalesMonth: "2026-07", anchor: null, known: new Map(), periods: ["2026-08", "2026-09"] });
  assert.equal(out.get("2026-08")!.status, "noData");
  assert.equal(out.get("2026-09")!.carryIn, out.get("2026-08")!.carryIn);
});

test("kafe dışı fatura (Karaoke box) toplama girmez, sayılır", () => {
  const sepInvoice = ds.invoices.find((i) => i.date.startsWith("2026-09"))!;
  const withKaraoke = createModel({ ...ds, invoices: [...ds.invoices, { ...sepInvoice, id: 99_999, category: "Karaoke box", payable: 12_000, amount: 10_000, discount: 0 }] });
  const sep = vatMonthInputs(withKaraoke, TODAY).months.find((m) => m.month === "2026-09")!;
  assert.equal(sep.purchases.separateCount, 1);
  assert.equal(sep.purchases.count, 30);
  close(sep.purchases.vat, 11_875.67, "kafe dışı eklenmez");
});

// ---------------------------------------------------------------- Metinler

test("metinler: alt satır, haftalar satırının açıklaması, Nasıl hesaplandı notu", () => {
  const base = estimate({ anchor: { month: "2026-08", amount: 0 } });
  const oct = base.get("2026-10")!;
  assert.equal(vatSubText(oct, null), "Satışlar ≈ 51.800 ₺ − alışlar ≈ 9.700 ₺");
  assert.equal(vatProgressText(oct), "Ekim bitmedi: 16 günün satışıyla tahmin");
  assert.equal(vatLineDetail(oct), "Satışlar ≈ 51.800 ₺ − alışlar ≈ 9.700 ₺. Ekim bitmedi, ay sonuna tamamlandı. Tahmin; kesin tutar muhasebecinizin beyannamesindedir.");
  const sep = base.get("2026-09")!;
  assert.equal(vatProgressText(sep), null);
  assert.equal(vatLineDetail(sep), "Satışlar ≈ 39.200 ₺ − alışlar ≈ 11.900 ₺. Tahmin; kesin tutar muhasebecinizin beyannamesindedir.");
  // Devreden var ama ödeme çıkıyor
  const partial = estimate({ anchor: { month: "2026-08", amount: 5_000 } }).get("2026-09")!;
  assert.equal(vatSubText(partial, 5_000), "Satışlar ≈ 39.200 ₺ − alışlar ≈ 11.900 ₺ − devreden ≈ 5.000 ₺");
  // Ödeme beklenmez: devreden karşılıyor / alış fazla / denk
  const auto = estimate();
  assert.equal(vatSubText(auto.get("2026-10")!, null), "Devreden KDV karşılıyor · ≈ 98.100 ₺ sonraki aya geçer");
  const heavy = inputs.months.map((m) => (m.month === "2026-09" ? { ...m, purchases: { ...m.purchases, vat: 42_400 } } : m));
  const alis = estimate({ months: heavy, anchor: { month: "2026-08", amount: 0 } }).get("2026-09")!;
  assert.equal(vatSubText(alis, null), "Alışların KDV'si fazla · ≈ 3.200 ₺ sonraki aya geçer");
  const even = inputs.months.map((m) => (m.month === "2026-09" ? { ...m, purchases: { ...m.purchases, vat: 39_200 } } : m));
  assert.equal(vatSubText(estimate({ months: even, anchor: { month: "2026-08", amount: 0 } }).get("2026-09")!, null), "Satış ve alış KDV'si denk");
  // Muhasebeci kaydı ve Ödemeler'deki tutar
  assert.equal(vatSubText(estimate({ anchor: { month: "2026-09", amount: 140_000 } }).get("2026-09")!, 140_000), "Beyannamede devreden 140.000 ₺");
  assert.equal(vatSubText(estimate({ anchor: { month: "2026-08", amount: 0 }, known: new Map([["2026-09", 25_000]]) }).get("2026-09")!, null), "Ödemeler'deki tutar · tahmin ≈ 27.300 ₺");

  const rates = { kdv: 0.1, kdvHizmet: 0.2 };
  assert.equal(
    vatNote("default", true, rates, true),
    "Önceki ayın satış KDV'si (kafe %10, karaoke %20, laffogato.net) eksi alış faturalarının KDV'si, ayın 28'inde; eksi çıkarsa ödeme beklenmez, fark sonraki aya devreder. Tahmin; kesin tutar muhasebecinizin beyannamesindedir.",
  );
  assert.equal(
    vatNote("reminder", true, { kdv: 0.1, kdvHizmet: 0.1 }, false),
    "Önceki ayın satış KDV'si (kafe %10) eksi alış faturalarının KDV'si, KDV hatırlatıcısının gününde; hatırlatıcıya tutar yazarsanız o geçerli. Tahmin; kesin tutar muhasebecinizin beyannamesindedir.",
  );
  assert.equal(vatNote("excluded", true, rates, true), "KDV tahmini plana katılmıyor (Tahmine katılanlar'dan açın).");
  assert.equal(vatNote("default", false, rates, true), "Satış verisi olmadığı için KDV tahmin edilemedi.");
});
