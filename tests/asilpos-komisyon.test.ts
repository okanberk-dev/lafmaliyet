// AsilPOS'un ödeme kanalları komisyona (denetim B10, E-37; docs/KOMISYON.md §3, docs/ASILPOS.md › Komisyon): geçiş günü
// boşken rapor bugünküyle aynı; geçiş gününden itibaren kanalın satışı AsilPOS'un ödeme türlerinden kart kart gelir
// (elle > asilpos > tek), geçiş ayının önceki günleri kasa raporu kuralıyla; kanalsız ödeme ve gün sonu gelmemiş gün
// uyarılır, AsilPOS'ta ödemesi olan kanalın faturası gelmediyse kartı çıkar.
// Çalıştırma: npx tsx --test tests/asilpos-komisyon.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { sourceLabel, statusBadge, tillSub } from "../src/app/panel/komisyonlar/texts";
import { asilposChannel } from "../src/lib/commission/channels";
import {
  buildCommissionReport,
  commissionAlerts,
  groupOf,
  asilposMonth,
  rowOf,
  shownChannels,
  type ChannelMonth,
  type ChannelMonthIn,
  type CommissionInput,
  type CommissionInvoiceIn,
  type AsilposDayIn,
  type AsilposPaymentIn,
  type TillDayIn,
} from "../src/lib/commission/report";

const plain = (s: string | null | undefined) => (s ?? "").replace(/[\u00a0\u202f]/g, " ");

let nextId = 1;
function inv(supplier: string, date: string, amount: number): CommissionInvoiceIn {
  return {
    id: nextId++,
    date,
    supplier,
    names: [supplier],
    invoiceNo: `NO${nextId}`,
    amount,
    discount: 0,
    payable: Math.round(amount * 1.2 * 100) / 100,
    needsReview: false,
    lines: [{ name: "Komisyon", description: null, netTotal: amount }],
  };
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

const pay = (name: string, zField: AsilposPaymentIn["zField"], channel: string | null, amount: number): AsilposPaymentIn => ({
  name,
  zField,
  channel: asilposChannel(channel),
  rawChannel: channel,
  amount,
});

/** Her gün: Pluxee 50, Multinet 30 (yemek kartı), Yemeksepeti 40 (online), nakit ve kart (komisyona girmez) */
const dayPayments = (): AsilposPaymentIn[] => [
  pay("Nakit", "cash", null, 900),
  pay("Kredi kartı", "card", null, 1200),
  pay("Pluxee", "meal_card", "pluxee", 50),
  pay("Multinet", "meal_card", "multinet", 30),
  pay("Yemeksepeti", "online", "yemeksepeti", 40),
];

function lafDays(from: string, to: string, payments: () => AsilposPaymentIn[] = dayPayments, skip: string[] = []): AsilposDayIn[] {
  return eachDay(from, to)
    .filter((d) => !skip.includes(d))
    .map((date) => {
      const p = payments();
      const sum = (f: AsilposPaymentIn["zField"]) => p.filter((x) => x.zField === f).reduce((a, x) => a + x.amount, 0);
      return { date, mealCard: sum("meal_card"), online: sum("online"), payments: p };
    });
}

/** Kasa raporları; şubesi verilmezse AsilPOS'un şubesinin (Marina) kasası (21 Kasım kararı: önce Marina AsilPOS'a geçer) */
const till = (from: string, to: string, row: Omit<TillDayIn, "date"> = { mealCard: 500, online: 400 }): TillDayIn[] =>
  eachDay(from, to).map((date) => ({ date, branchId: "marina", ...row }));
const mark = (channel: ChannelMonthIn["channel"], month: string, o: Partial<ChannelMonthIn> = {}): ChannelMonthIn => ({ channel, month, sales: null, receivedOn: null, received: null, note: null, ...o });

/**
 * Fikstür: bugün 2 Aralık 2026, kasa raporları 1 Ekim'den beri (Ekim her gün yemek kartı 500, online 400). AsilPOS'a
 * geçiş günü 1 Kasım: Kasım'ın her günü AsilPOS'tan (Pluxee 1.500, Multinet 900, Yemeksepeti 1.200). Faturalar Kasım
 * sonunda: Pluxee 60 (%4), Multinet 60 (%6,7), Yemeksepeti 150.
 */
function fx(o: Partial<CommissionInput> = {}): CommissionInput {
  nextId = 1;
  return {
    today: "2026-12-02",
    through: "2026-12-01",
    since: "2026-10-01",
    fromMonth: "2026-01",
    firstReport: "2026-10-01",
    till: till("2026-10-01", "2026-10-31"),
    invoices: [inv("Pluxee", "2026-11-30", 60), inv("Multinet Up", "2026-11-30", 60), inv("Yemek Sepeti", "2026-11-28", 150)],
    marks: [],
    settings: {},
    asilpos: { switchDay: "2026-11-01", days: lafDays("2026-11-01", "2026-11-30") },
    ...o,
  };
}

const must = (r: ChannelMonth | null): ChannelMonth => {
  assert.ok(r, "kanal-ay yok");
  return r;
};

test("AsilPOS'taki kanal yazısı: anahtar, kanalın adı ya da öneki; boş ya da tanınmayan null", () => {
  assert.equal(asilposChannel("pluxee"), "pluxee");
  assert.equal(asilposChannel(" MULTINET "), "multinet");
  assert.equal(asilposChannel("Sodexo"), "pluxee");
  assert.equal(asilposChannel("Ticket Restaurant"), "edenred");
  assert.equal(asilposChannel("Trendyol Go"), "trendyol");
  assert.equal(asilposChannel("YEMEKSEPETİ"), "yemeksepeti");
  assert.equal(asilposChannel("Ticket"), null);
  assert.equal(asilposChannel(""), null);
  assert.equal(asilposChannel(null), null);
});

test("geçiş günü boşken (ya da henüz gelmediyse) rapor bugünküyle aynı: AsilPOS hiçbir aya girmez", () => {
  const base = fx({ asilpos: null });
  const plainReport = buildCommissionReport(base);
  assert.equal(plainReport.switchDay, null);
  assert.ok(plainReport.groups.every((g) => g.asilposFrom === null));
  // AsilPOS alanı hiç yokken de aynı
  const { asilpos: _unused, ...withoutField } = base;
  void _unused;
  assert.deepEqual(buildCommissionReport(withoutField), plainReport);
  // Geçiş günü ileride (Aralık 10): gün sonu yok, bu ay da geçen ay da bugünkü gibi
  const future = buildCommissionReport(fx({ asilpos: { switchDay: "2026-12-10", days: [] } }));
  assert.deepEqual({ ...future, switchDay: null }, plainReport);
  assert.equal(asilposMonth(fx({ asilpos: { switchDay: "2026-12-10", days: [] } }), "2026-12"), null);
  // Kasım faturaları: kasa raporu yok, satış bilinmez
  assert.equal(must(rowOf(plainReport, "pluxee", "2026-11")).sales, null);
});

test("AsilPOS ayı: her kartın ve platformun satışı kendi ödemelerinden; oran, %6 ve hakediş kart kart", () => {
  const r = buildCommissionReport(fx());
  const p = must(rowOf(r, "pluxee", "2026-11"));
  const m = must(rowOf(r, "multinet", "2026-11"));
  const y = must(rowOf(r, "yemeksepeti", "2026-11"));
  assert.deepEqual(p.sales, { amount: 1500, source: "asilpos" });
  assert.deepEqual(m.sales, { amount: 900, source: "asilpos" });
  assert.deepEqual(y.sales, { amount: 1200, source: "asilpos" });
  assert.equal(p.salesReason, null);
  assert.equal(p.rate, 0.04);
  assert.ok(Math.abs(m.rate! - 60 / 900) < 1e-9);
  // Multinet %6,7: kesin (gün sonları tam), kırmızı ve zilde
  const over = m.flags.find((f) => f.key === "oran-sinir");
  assert.equal(over?.level, "bad");
  assert.equal(plain(over?.text), "Toplam kesinti %6,7: yemek kartında yasal üst sınır %6.");
  assert.ok(commissionAlerts(r, "2026-12-02").some((a) => a.key === "oran:multinet:2026-11:67"));
  // Beklenen hakediş = satış − faturalar (KDV dahil)
  assert.equal(p.payout.expected, 1500 - 72);
  assert.deepEqual(p.autoSales, { amount: 1500, source: "asilpos" });
  assert.equal(sourceLabel(p.sales!, "meal"), "AsilPOS ödemelerinden");
  // Grup: Z'deki yemek kartı AsilPOS'un Z'sinden, ortalama oran, ay AsilPOS'tan
  const g = groupOf(r, "meal", "2026-11")!;
  assert.equal(g.zTotal, 2400);
  assert.equal(g.reportDays, 30);
  assert.equal(g.asilposFrom, "2026-11-01");
  assert.equal(g.rate, 120 / 2400);
  assert.equal(tillSub(g), "30 / 30 gün kayıtlı · AsilPOS'tan");
  assert.deepEqual(g.activeChannels, ["pluxee", "multinet"]);
  // Ekim (geçişten önce) bugünkü gibi: kasa raporları
  const oct = groupOf(r, "meal", "2026-10")!;
  assert.equal(oct.zTotal, 15500);
  assert.equal(oct.asilposFrom, null);
  assert.equal(tillSub(oct), "31 / 31 gün raporlu");
  assert.equal(r.switchDay, "2026-11-01");
});

test("elle > asilpos: yazılan ekstre kazanır, boş bırakılırsa AsilPOS'un ödemeleri", () => {
  const r = buildCommissionReport(fx({ marks: [mark("pluxee", "2026-11", { sales: 1600 })] }));
  const p = must(rowOf(r, "pluxee", "2026-11"));
  assert.deepEqual(p.sales, { amount: 1600, source: "elle" });
  assert.deepEqual(p.autoSales, { amount: 1500, source: "asilpos" });
  // Yazılan ekstrede eksik gün uyarısı yok
  const gap = buildCommissionReport(fx({ marks: [mark("pluxee", "2026-11", { sales: 1600 })], asilpos: { switchDay: "2026-11-01", days: lafDays("2026-11-01", "2026-11-30", dayPayments, ["2026-11-05"]) } }));
  assert.ok(!must(rowOf(gap, "pluxee", "2026-11")).flags.some((f) => f.key === "kasa-eksik"));
});

test("gün sonu gelmeyen gün: kart kart satış eksik kalabilir; %6 aşımı kesin değil", () => {
  const r = buildCommissionReport(fx({ asilpos: { switchDay: "2026-11-01", days: lafDays("2026-11-01", "2026-11-30", dayPayments, ["2026-11-05", "2026-11-06"]) } }));
  const m = must(rowOf(r, "multinet", "2026-11"));
  assert.deepEqual(m.sales, { amount: 840, source: "asilpos" });
  assert.deepEqual(
    m.flags.map((f) => [f.key, f.level, plain(f.text)]),
    [
      ["oran-sinir", "warn", "Toplam kesinti %7,1: yemek kartında yasal üst sınır %6. 2 gün AsilPOS gün sonu yok; kesin değil, kontrol edin."],
      ["kasa-eksik", "info", "2 gün AsilPOS gün sonu yok; satış eksik kaldıysa oran yüksek görünür."],
    ],
  );
  const g = groupOf(r, "meal", "2026-11")!;
  assert.deepEqual(g.missing, ["2026-11-05", "2026-11-06"]);
  assert.equal(tillSub(g), "2 gün kayıt yok · AsilPOS'tan");
  // Gün sonu gelmedi ama kasa raporu var: grubun toplamı rapordan, kart kart bilinmez (iki kart varken eksik sayılır)
  const fb = buildCommissionReport(
    fx({
      till: [...till("2026-10-01", "2026-10-31"), { date: "2026-11-05", mealCard: 80, online: 40, branchId: "marina" }],
      asilpos: { switchDay: "2026-11-01", days: lafDays("2026-11-01", "2026-11-30", dayPayments, ["2026-11-05"]) },
    }),
  );
  const fg = groupOf(fb, "meal", "2026-11")!;
  assert.equal(fg.zTotal, 2400);
  assert.deepEqual(fg.missing, []);
  assert.equal(must(rowOf(fb, "pluxee", "2026-11")).sales?.amount, 1450);
  assert.equal(must(rowOf(fb, "pluxee", "2026-11")).flags.find((f) => f.key === "kasa-eksik")?.text, "1 gün AsilPOS gün sonu yok; satış eksik kaldıysa oran yüksek görünür.");
  // Kapalı işaretli gün eksik sayılmaz
  const shut = buildCommissionReport(fx({ closed: ["2026-11-05"], asilpos: { switchDay: "2026-11-01", days: lafDays("2026-11-01", "2026-11-30", dayPayments, ["2026-11-05"]) } }));
  assert.ok(!must(rowOf(shut, "multinet", "2026-11")).flags.some((f) => f.key === "kasa-eksik"));
  assert.equal(tillSub(groupOf(shut, "meal", "2026-11")), "29 / 30 gün kayıtlı · 1 gün kapalı · AsilPOS'tan");
});

test("geçiş ayı: önceki günlerin Z'si markası belirsiz satırda; kanalın satışı AsilPOS'taki ödemeleri (tek kartta da Z'den yazılmaz)", () => {
  // Geçiş günü 10 Kasım; 1–9 Kasım kasa raporlarında yemek kartı 100, online 0
  const input = (o: Partial<CommissionInput> = {}) =>
    fx({ till: [...till("2026-10-01", "2026-10-31"), ...till("2026-11-01", "2026-11-09", { mealCard: 100, online: 0 })], asilpos: { switchDay: "2026-11-10", days: lafDays("2026-11-10", "2026-11-30") }, ...o });
  const r = buildCommissionReport(input());
  const p = must(rowOf(r, "pluxee", "2026-11"));
  // 23 Kasım 2026: 1–9 Kasım'ın Z'deki 900'ü hiçbir karta yazılmaz (grupta markası belirsiz); kartın satışı AsilPOS'taki
  // ödemeleri, eksik kalmış olabileceği söylenir
  assert.deepEqual(p.sales, { amount: 1050, source: "asilpos" });
  assert.equal(plain(p.flags.find((f) => f.key === "kasa-eksik")?.text), "Z'de markası belirsiz 900 ₺ var; satış eksik kaldıysa oran yüksek görünür.");
  assert.deepEqual(groupOf(r, "meal", "2026-11")!.unbranded, { amount: 900, pre: 900, modpos: 0, loose: 0, fallback: 0 });
  // Online (Yemeksepeti) önceki günlerde 0: satış AsilPOS'tan
  assert.deepEqual(must(rowOf(r, "yemeksepeti", "2026-11")).sales, { amount: 840, source: "asilpos" });
  const g = groupOf(r, "meal", "2026-11")!;
  assert.equal(g.zTotal, 900 + 21 * 80);
  assert.equal(g.reportDays, 30);
  assert.equal(plain(tillSub(g)), "30 / 30 gün kayıtlı · 10 Kasım'dan AsilPOS");

  // Tek kart (yalnız Pluxee): önceki günlerin Z toplamı ona da yazılmaz (eskiden 1.050 + 900 yazılırdı)
  const single = () => [pay("Pluxee", "meal_card", "pluxee", 50)];
  const one = buildCommissionReport(input({ invoices: [inv("Pluxee", "2026-11-30", 60)], asilpos: { switchDay: "2026-11-10", days: lafDays("2026-11-10", "2026-11-30", single) } }));
  const op = must(rowOf(one, "pluxee", "2026-11"));
  assert.deepEqual(op.sales, { amount: 1050, source: "asilpos" });
  assert.equal(sourceLabel(op.sales!, "meal"), "AsilPOS ödemelerinden");
  assert.deepEqual(op.autoSales, { amount: 1050, source: "asilpos" });
  assert.equal(groupOf(one, "meal", "2026-11")!.unbranded?.pre, 900);
  // Önceki günlerden biri raporsuz: eksik
  const gap = buildCommissionReport(
    input({
      invoices: [inv("Pluxee", "2026-11-30", 60)],
      till: [...till("2026-10-01", "2026-10-31"), ...till("2026-11-01", "2026-11-09", { mealCard: 100, online: 0 }).filter((t) => t.date !== "2026-11-03")],
      asilpos: { switchDay: "2026-11-10", days: lafDays("2026-11-10", "2026-11-30", single) },
    }),
  );
  assert.equal(plain(must(rowOf(gap, "pluxee", "2026-11")).flags.find((f) => f.key === "kasa-eksik")?.text), "1 gün kasa raporu yok ve Z'de markası belirsiz 800 ₺ var; satış eksik kaldıysa oran yüksek görünür.");
  // Geçiş gününden önce hiç kasa raporu yok: ay bilinmez
  const none = buildCommissionReport(input({ invoices: [inv("Pluxee", "2026-11-30", 60)], till: till("2026-10-01", "2026-10-31"), asilpos: { switchDay: "2026-11-10", days: lafDays("2026-11-10", "2026-11-30", single) } }));
  assert.equal(plain(must(rowOf(none, "pluxee", "2026-11")).salesReason), "Satış bilinmiyor: AsilPOS 10 Kasım'da başladı, öncesinin kasa raporu yok. Kanalın ekstresindeki satışı yazarsanız oran hesaplanır.");
  const ng = groupOf(none, "meal", "2026-11")!;
  assert.equal(ng.rate, null);
  assert.equal(plain(tillSub(ng)), "10 Kasım'dan AsilPOS · öncesinin kasa raporu yok");
});

test("ModPOS'ta kalan şube (Tuzla): raporları AsilPOS'un yerine geçmez, kasa raporu kuralıyla eklenir (21 Kasım kararı)", () => {
  // Marina Kasım'ın her günü AsilPOS'ta; Tuzla ModPOS'ta, her gün yemek kartı 200, online 100
  const tuzla = till("2026-11-01", "2026-11-30", { mealCard: 200, online: 100, branchId: "tuzla" });
  const input = fx({ till: [...till("2026-10-01", "2026-10-31"), ...tuzla] });
  const lm = asilposMonth(input, "2026-11")!;
  assert.deepEqual(lm.modpos, { meal: 6000, online: 3000 });
  assert.deepEqual([lm.fallback, lm.missing], [[], []], "Tuzla'nın raporu Marina'nın gün sonunun yedeği değil");
  const r = buildCommissionReport(input);
  // Grubun Z'si iki kasanın toplamı
  assert.equal(groupOf(r, "meal", "2026-11")!.zTotal, 2400 + 6000);
  // Tuzla'nın Z'sindeki yemek kartı kart kart bilinmez: hiçbir karta yazılmaz, grupta markası belirsiz (23 Kasım 2026);
  // kartın satışı Marina'nın AsilPOS ödemeleri, eksik kalmış olabileceği söylenir
  const p = must(rowOf(r, "pluxee", "2026-11"));
  assert.deepEqual(p.sales, { amount: 1500, source: "asilpos" });
  assert.equal(plain(p.flags.find((f) => f.key === "kasa-eksik")?.text), "Z'de markası belirsiz 6.000 ₺ var; satış eksik kaldıysa oran yüksek görünür.");
  assert.deepEqual(groupOf(r, "meal", "2026-11")!.unbranded, { amount: 6000, pre: 0, modpos: 6000, loose: 0, fallback: 0 });
  // Tek platform da olsa Tuzla'nın online toplamı kanala yazılmaz (eskiden 1.200 + 3.000 yazılırdı)
  assert.deepEqual(must(rowOf(r, "yemeksepeti", "2026-11")).sales, { amount: 1200, source: "asilpos" });
  assert.equal(groupOf(r, "platform", "2026-11")!.unbranded?.modpos, 3000);
  // Şubesiz rapor Tuzla'nın: ModPOS'unki gibi kasa raporu kuralıyla eklenir, Marina'nın gün sonunun yedeği değil
  const branchless = asilposMonth(fx({ till: [...till("2026-10-01", "2026-10-31"), ...tuzla.map((r) => ({ date: r.date, mealCard: r.mealCard, online: r.online }))] }), "2026-11")!;
  assert.deepEqual(branchless.modpos, { meal: 6000, online: 3000 });
  assert.deepEqual([branchless.fallback, branchless.missing], [[], []]);
  // Marina'nın raporu bugünkü gibi yalnız gün sonu gelmeyen günün yedeği
  const own = asilposMonth(
    fx({
      till: [...till("2026-10-01", "2026-10-31"), { date: "2026-11-05", mealCard: 80, online: 40, branchId: "marina" }],
      asilpos: { switchDay: "2026-11-01", days: lafDays("2026-11-01", "2026-11-30", dayPayments, ["2026-11-05"]) },
    }),
    "2026-11",
  )!;
  assert.equal(own.modpos, null);
  assert.deepEqual(own.fallback, ["2026-11-05"]);
});

test("kanalı seçilmemiş ya da tanınmayan ödeme türü: grupta uyarı; hiçbir karta yazılmaz (tek kartta da), markası belirsiz", () => {
  const loose = () => [...dayPayments(), pay("Yemek kartı", "meal_card", null, 10), pay("Ticket", "meal_card", "Ticket", 5)];
  const r = buildCommissionReport(fx({ asilpos: { switchDay: "2026-11-01", days: lafDays("2026-11-01", "2026-11-30", loose) } }));
  const g = groupOf(r, "meal", "2026-11")!;
  assert.equal(g.zTotal, 2850);
  assert.deepEqual(
    g.flags.map((f) => [f.key, f.level, plain(f.text)]),
    [
      [
        "asilpos-kanal",
        "info",
        "AsilPOS'ta kanalı seçilmemiş ya da tanınmayan ödeme türü: “Yemek kartı” 300 ₺, “Ticket” (kanal “Ticket”) 150 ₺. Bu tutar hiçbir karta yazılmaz, markası belirsiz satırda; AsilPOS'ta ödeme türünün kanalını seçin.",
      ],
    ],
  );
  const p = must(rowOf(r, "pluxee", "2026-11"));
  assert.deepEqual(p.sales, { amount: 1500, source: "asilpos" });
  assert.equal(plain(p.flags.find((f) => f.key === "kasa-eksik")?.text), "Kanalı seçilmemiş 450 ₺ ödeme var; satış eksik kaldıysa oran yüksek görünür.");
  // Tek kart: kanalsız ödeme ona da yazılmaz (23 Kasım 2026; eskiden 1.500 + 300), markası belirsiz satırda
  const single = () => [pay("Pluxee", "meal_card", "pluxee", 50), pay("Yemek kartı", "meal_card", null, 10)];
  const one = buildCommissionReport(fx({ invoices: [inv("Pluxee", "2026-11-30", 60)], asilpos: { switchDay: "2026-11-01", days: lafDays("2026-11-01", "2026-11-30", single) } }));
  assert.deepEqual(must(rowOf(one, "pluxee", "2026-11")).sales, { amount: 1500, source: "asilpos" });
  assert.deepEqual(groupOf(one, "meal", "2026-11")!.unbranded, { amount: 300, pre: 0, modpos: 0, loose: 300, fallback: 0 });
  assert.match(plain(groupOf(one, "meal", "2026-11")!.flags[0].text), /Bu tutar hiçbir karta yazılmaz, markası belirsiz satırda; AsilPOS'ta ödeme türünün kanalını seçin\.$/);
  // Platformda: uyarı Platformlar satırının altında (grup)
  const plat = buildCommissionReport(fx({ asilpos: { switchDay: "2026-11-01", days: lafDays("2026-11-01", "2026-11-30", () => [...dayPayments(), pay("Getir", "online", null, 20)]) } }));
  assert.equal(groupOf(plat, "platform", "2026-11")!.flags[0]?.key, "asilpos-kanal");
});

test("AsilPOS'ta ödemesi olan kanalın faturası gelmediyse kartı çıkar; ayın 15'inden sonra uyarır", () => {
  // Multinet'in faturası yok
  const input = (today: string) => fx({ today, through: today, invoices: [inv("Pluxee", "2026-11-30", 60)] });
  const r = buildCommissionReport(input("2026-12-02"));
  const m = must(rowOf(r, "multinet", "2026-11"));
  assert.deepEqual(m.sales, { amount: 900, source: "asilpos" });
  assert.equal(m.invoices.length, 0);
  assert.equal(m.payout.status, "faturasiz");
  assert.deepEqual(statusBadge(m), { text: "Fatura bekleniyor", tone: "gray" });
  assert.ok(shownChannels(r, "meal", "2026-11").includes("multinet"));
  assert.ok(!m.flags.some((f) => f.key === "fatura-yok"));
  // Oranı olmayan (faturasız) satırda eksik gün uyarısı yok
  assert.ok(!m.flags.some((f) => f.key === "kasa-eksik"));
  const late = must(rowOf(buildCommissionReport(input("2026-12-16")), "multinet", "2026-11"));
  assert.equal(plain(late.flags.find((f) => f.key === "fatura-yok")?.text), "Kasım ayında 900 ₺ satış var ama komisyon faturası gelmedi.");
  // Pluxee artık tek kart değil (Multinet AsilPOS'ta etkin): kanalsız ödeme Pluxee'ye yazılmaz
  assert.deepEqual(groupOf(r, "meal", "2026-11")!.activeChannels, ["pluxee", "multinet"]);
});

test("AsilPOS'ta satışı olan kartın faturası sonraki ayın 6–15'inde kesildiyse \"gelmedi\" denmez, bilgi çıkar", () => {
  // Pluxee Kasım faturasını 8 Aralık'ta kesti (yemek kartında 1–5'i önceki aya sayılır, 8'i sayılmaz): Aralık'ta duruyor
  const input = (invoiceDate: string) =>
    fx({ today: "2026-12-16", through: "2026-12-15", invoices: [inv("Pluxee", invoiceDate, 60)], asilpos: { switchDay: "2026-11-01", days: lafDays("2026-11-01", "2026-11-30", () => [pay("Pluxee", "meal_card", "pluxee", 50)]) } });
  const nov = must(rowOf(buildCommissionReport(input("2026-12-08")), "pluxee", "2026-11"));
  assert.equal(nov.invoices.length, 0);
  assert.ok(!nov.flags.some((f) => f.key === "fatura-yok"), "fatura geldi, gelmedi denmez");
  assert.deepEqual(
    nov.flags.filter((f) => f.key === "fatura-kayan").map((f) => [f.level, plain(f.text)]),
    [["info", "8 Aralık tarihli fatura Kasım satışlarını kapsıyor olabilir; Aralık ayında sayılıyor."]],
  );
  // Yazılan ekstrede (ModPOS'ta da olabilen) uyarı bugünkü gibi kalır
  const typed = must(rowOf(buildCommissionReport({ ...input("2026-12-08"), marks: [mark("pluxee", "2026-11", { sales: 1500 })] }), "pluxee", "2026-11"));
  assert.ok(typed.flags.some((f) => f.key === "fatura-yok"));
  // 16 Aralık ve sonrası kesilen fatura bu ayın satışları için sayılmaz: uyarı kalır
  const late = must(rowOf(buildCommissionReport({ ...input("2026-12-16"), today: "2026-12-20", through: "2026-12-19" }), "pluxee", "2026-11"));
  assert.equal(plain(late.flags.find((f) => f.key === "fatura-yok")?.text), "Kasım ayında 1.500 ₺ satış var ama komisyon faturası gelmedi.");
});

test("faturası olan ama AsilPOS'ta ödemesi olmayan kart: satış bilinmez, nedeni söylenir", () => {
  const r = buildCommissionReport(fx({ invoices: [inv("Pluxee", "2026-11-30", 60), inv("Edenred", "2026-11-30", 40)] }));
  const e = must(rowOf(r, "edenred", "2026-11"));
  assert.equal(e.sales, null);
  assert.equal(plain(e.salesReason), "Satış bilinmiyor: AsilPOS'ta bu ay Edenred ödemesi yok. Kanalın ekstresindeki satışı yazarsanız oran hesaplanır.");
});
