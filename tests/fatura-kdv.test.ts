// Alış faturasının KDV'si (src/lib/kdv.ts: dışa aktarımın Faturalar sekmesi): KDV toplamı ya da ödenecek − net,
// tevkifat ayrıca; Paraşüt bağı çözülen kaydın eski KDV'si; laffogato.net satışının KDV'si (site-sales/calc.ts). Nakit
// planının KDV tahmini Vergi bölümüyle birlikte 27 Kasım 2026'da kaldırıldı; testleri de.
// Çalıştırma: npx tsx --test tests/fatura-kdv.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { amountsChanged, isParasutLinked } from "../src/app/panel/faturalar/rules";
import type { Dataset } from "../src/lib/calc/types";
import { purchaseVat, purchaseWithheld } from "../src/lib/kdv";
import { siteRevenue, siteVat } from "../src/lib/site-sales/calc";
import type { SiteSalesMonth } from "../src/lib/site-sales/schema";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";
import type { Resource } from "../src/server/parasut/jsonapi";
import { billToDraft } from "../src/server/parasut/mapping";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const data: SeedData = JSON.parse(read("tests/fixtures/baslangic/veri.json"));
const ds: Dataset = { ...datasetFromSeed(data), currentMonth: "2026-10" };
const close = (a: number | null | undefined, b: number, msg: string, eps = 0.01) => assert.ok(a != null && Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);

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
  // Paraşüt bağı kopup tutarları elle sıfırlanan kayıtta eski KDV (6.000) kalır: net tutar onu taşıyamaz (en çok
  // %20), indirilmez ve tevkifat sanılmaz
  assert.equal(purchaseVat({ amount: 0, discount: 0, payable: 0, vat: 6_000 }), 0);
  assert.equal(purchaseWithheld({ amount: 0, discount: 0, payable: 0, vat: 6_000 }), 0);
  assert.equal(purchaseVat({ amount: 15_000, discount: 0, payable: 17_100, vat: 6_000 }), 2_100);
  assert.equal(purchaseWithheld({ amount: 15_000, discount: 0, payable: 17_100, vat: 6_000 }), 0);
  // ÖİV'li fatura (ödenecek KDV'den fazlasını taşır): KDV toplamı yine geçerli
  assert.equal(purchaseVat({ amount: 1_000, discount: 0, payable: 1_275, vat: 200 }), 200);
  assert.equal(purchaseWithheld({ amount: 1_000, discount: 0, payable: 1_275, vat: 200 }), 0);
  // Excel'den gelen faturalarda vat sütunu yok (0); KDV ödenecek ile net farkından
  const excelInv = ds.invoices.find((i) => i.payable - (i.amount - i.discount) > 1)!;
  assert.ok(excelInv);
  assert.ok(purchaseVat(excelInv) > 0);
  assert.equal(purchaseWithheld(excelInv), 0);
});

test("Paraşüt bağı çözülen kayıt: tutar, iskonto ya da ödenecek değişince eski KDV silinir, olmayan KDV-2 çıkmaz", () => {
  // Excel kaydı Paraşüt'e bağlandı (eşitleme vat 2.000 yazdı), fatura Paraşüt'te iptal edildi: retire bağı çözdü, vat kaldı
  const retired = { date: "2026-10-10", invoiceNo: "ABC2026000000001", amount: 10_000, discount: 0, payable: 12_000, vat: 2_000, source: "excel", externalId: null };
  assert.equal(isParasutLinked(retired), false);
  // saveInvoice'un bağsız dalı: formdaki alanlar yazılır, tutarlar değiştiyse vat 0
  const edit = (input: Partial<typeof retired>) => {
    const data = { ...retired, ...input };
    return { ...data, vat: amountsChanged(retired, data) ? 0 : retired.vat };
  };
  // Yalnız ödenecek düzeltildi (12.000 → 11.800): KDV penceredeki gibi 1.800, tevkifat yok (eskiden 2.000 indirilir,
  // 25'inde 200 ₺ KDV-2 çıkardı)
  const payable = edit({ payable: 11_800 });
  assert.equal(payable.vat, 0);
  assert.equal(purchaseVat(payable), 1_800);
  assert.equal(purchaseWithheld(payable), 0);
  // Oran düzeltmesi (%20 → %10, Hesapla) ve tutar artışı: #15'in %20 sınırı bunları yakalamıyordu
  const rate = edit({ payable: 11_000 });
  assert.deepEqual([purchaseVat(rate), purchaseWithheld(rate)], [1_000, 0]);
  const up = edit({ amount: 12_000, payable: 13_200 });
  assert.deepEqual([purchaseVat(up), purchaseWithheld(up)], [1_200, 0]);
  const discount = edit({ discount: 500, payable: 11_400 });
  assert.deepEqual([purchaseVat(discount), purchaseWithheld(discount)], [1_900, 0]);
  // Tutarlara dokunmayan düzenleme (tarih, kategori, not, ödeme durumu) KDV'yi korur: tevkifatlı faturanın KDV-2'si
  // kalır (Eylül'ün reklam faturası: 30.000 + 6.000, 3/10 tevkifat)
  const ad = { ...retired, amount: 30_000, payable: 34_200, vat: 6_000 };
  assert.equal(amountsChanged(ad, { ...ad, date: "2026-09-30", invoiceNo: "X1" }), false);
  assert.equal(purchaseWithheld(ad), 1_800);
  // Pencere tutarları kuruşa yuvarlar: kuruş altı fark değişiklik sayılmaz
  assert.equal(amountsChanged({ ...ad, payable: 34_200.004 }, ad), false);
  // Eylem bu kuralı bağsız dalda kullanır (Paraşüt'e bağlı kayıtta tutarlar zaten yazılmaz)
  assert.match(read("src/server/actions/invoices.ts"), /\.\.\.\(amountsChanged\(cur, data\) \? \{ vat: 0 \} : \{\}\)/);
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
