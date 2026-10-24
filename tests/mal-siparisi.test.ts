// Mal siparişi (docs/MAL-SIPARISI.md): sayım günleri ve aralığı, hedef / en az, sipariş birimine yuvarlama, eldeki ve
// siparişteki, öneri satırı ve tedarikçi grupları, takibe önerilenler, beklenen fiyat (0 ve tahmini fiyat), WhatsApp
// mesajı ve bağlantısı, aylık kullanım (Excel verisi), Bugün satırları, sabah işinin adımı, menü / roller / Yardım ve
// kaynak denetimleri (personelin hızlı sayımında fiyat yok, eylemlerin yetkisi, eşitlemedeki kanca).
// Saatler sabit: new Date("2026-10-26T07:30:00Z") Türkiye'de Pazartesi 10:30.
// Çalıştırma: npx tsx --test tests/mal-siparisi.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { dayTasks, type DayFacts } from "../src/app/panel/bugun/logic";
import { pathOf } from "../src/app/panel/yardim/nav-paths";
import { BOTTOM_NAV, bottomNavActive, mobileTitleFor, NAV_TREE, SECTION_TABS } from "../src/components/panel/nav";
import { createModel } from "../src/lib/calc/engine";
import { latestSalesMonth } from "../src/lib/calc/insights";
import { salesBasis } from "../src/lib/calc/price-loss";
import type { Dataset } from "../src/lib/calc/types";
import { businessDate } from "../src/lib/cash-report";
import { countStep, dailyOutcome } from "../src/lib/job-health";
import {
  countOverdue,
  countPushDue,
  countQty,
  coverDays,
  defaultOrderUnit,
  IN_TRANSIT_GRACE_DAYS,
  inheritLeadDays,
  isCountDay,
  latestOnHand,
  monthEndCountAt,
  nextCountDay,
  onOrderFor,
  packsFor,
  planGroups,
  planLine,
  quickCountConflicts,
  readySuppliers,
  receivedAtFor,
  referencePrice,
  roundCount,
  shownCount,
  suggestedLevels,
  suggestTracked,
  trWeekday,
  type PlanItem,
} from "../src/lib/reorder/levels";
import { LATE_GRACE_DAYS } from "../src/lib/reorder/delivery";
import { countAmount, dayName, mobileE164, orderLink, orderMessage, qtyLabel, restLabel } from "../src/lib/reorder/message";
import { DEFAULT_REORDER, parseReorderSettings, type OrderLite, type ReorderDayFacts, type ReorderLine } from "../src/lib/reorder/types";
import { DAYS_PER_MONTH, monthlyUsage } from "../src/lib/reorder/usage";
import { canOpen, ROLE_PERMISSIONS, STAFF_PATHS } from "../src/lib/roles";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
const base: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
const ingByName = (ds: Dataset, name: string) => {
  const i = ds.ingredients.find((x) => x.name === name);
  assert.ok(i, `hammadde yok: ${name}`);
  return i;
};
const MILK = ingByName(base, "Süt %2,5");
const COFFEE = ingByName(base, "Espresso çekirdeği");

/** Pazartesi 26 Ekim 2026, 10:30 (Türkiye) */
const MONDAY = new Date("2026-10-26T07:30:00Z");
const S = { ...DEFAULT_REORDER };

// ---------------------------------------------------------------- Sayım günleri

test("sayım günleri: hafta günü (1 = Pazartesi), sayım aralığı, sıradaki gün; ayın son günü sayım günü değil", () => {
  assert.equal(trWeekday("2026-10-22"), 4);
  assert.equal(trWeekday("2026-10-26"), 1);
  assert.equal(trWeekday("2026-10-25"), 7);
  assert.equal(coverDays([1]), 7);
  assert.equal(coverDays([1, 4]), 4);
  assert.equal(coverDays([1, 3, 5]), 3);
  assert.equal(coverDays([]), 7);
  assert.equal(coverDays([1, 1, 4, 4]), 4, "tekrar sayılmaz");
  assert.equal(nextCountDay("2026-10-22", { countWeekdays: [1] }), "2026-10-26");
  assert.equal(nextCountDay("2026-10-26", { countWeekdays: [1] }), "2026-11-02", "bugün dahil değil");
  assert.equal(isCountDay("2026-10-26", S), true);
  assert.equal(isCountDay("2026-10-27", S), false);
  // 31 Ağustos 2026 Pazartesi ama ayın son günü: ay sonu Stok sayımı yerine geçer
  assert.equal(trWeekday("2026-08-31"), 1);
  assert.equal(isCountDay("2026-08-31", S), false);
  // Sıradaki sayım günü ayın son gününe denk gelirse bir sonraki hafta
  assert.equal(nextCountDay("2026-08-25", S), "2026-09-07");
});

test("sayım gecikmesi: son sayım aralık + 1 günden eskiyse kaç gün; hiç sayılmadıysa gecikme yok", () => {
  assert.equal(countOverdue("2026-10-12", "2026-10-22", S), 10);
  assert.equal(countOverdue("2026-10-19", "2026-10-22", S), null);
  assert.equal(countOverdue("2026-10-14", "2026-10-22", S), null, "8 gün: sınırda");
  assert.equal(countOverdue("2026-10-13", "2026-10-22", S), 9);
  assert.equal(countOverdue(null, "2026-10-22", S), null);
  assert.equal(countOverdue("2026-10-19", "2026-10-25", { countWeekdays: [1, 4] }), 6, "Pzt + Per: aralık 4");
});

test("sayım günü bildirimi: sayım günü, takipte kalem var ve hepsi sayılmadı", () => {
  assert.equal(countPushDue("2026-10-26", S, 14, 0), true);
  assert.equal(countPushDue("2026-10-26", S, 14, 14), false);
  assert.equal(countPushDue("2026-10-26", S, 0, 0), false);
  assert.equal(countPushDue("2026-10-27", S, 14, 0), false);
  assert.equal(countPushDue("2026-08-31", S, 14, 0), false, "ayın son günü");
});

// ---------------------------------------------------------------- Hedef, en az, yuvarlama, birim

test("hedef ve en az (D3): Süt 26 LT / 3,2 L, Espresso 6 KG / 1,3 KG; kullanım yoksa null", () => {
  const milk = suggestedLevels({ perDay: 2689.33, leadDays: 1, coverDays: 7, marginPct: 0.2, countUnit: "LT", countFactor: 1000 });
  assert.equal(milk?.par, 26000);
  assert.ok(Math.abs((milk?.min ?? 0) - 3227.2) < 0.1);
  const coffee = suggestedLevels({ perDay: 543.3, leadDays: 2, coverDays: 7, marginPct: 0.2, countUnit: "KG", countFactor: 1000 });
  assert.equal(coffee?.par, 6000);
  assert.ok(Math.abs((coffee?.min ?? 0) - 1303.92) < 0.1);
  assert.equal(suggestedLevels({ perDay: 0, leadDays: 1, coverDays: 7, marginPct: 0.2, countUnit: "LT", countFactor: 1000 }), null);
  assert.equal(suggestedLevels({ perDay: null, leadDays: 1, coverDays: 7, marginPct: 0.2, countUnit: "LT", countFactor: 1000 }), null);
});

test("sayım biriminde yukarı yuvarlama: KG / LT 0,5'e, ADET / DİLİM tama; kendi biriminde döner", () => {
  assert.equal(roundCount(25820, 1000, "LT"), 26000);
  assert.equal(roundCount(25200, 1000, "LT"), 25500);
  assert.equal(roundCount(26000, 1000, "LT"), 26000, "tam değer kalır");
  assert.equal(roundCount(201.7, 1, "ADET"), 202);
  assert.equal(roundCount(5870, 1000, "KG"), 6000);
  assert.equal(roundCount(3.2, 1, "DİLİM"), 4);
  assert.equal(roundCount(0, 1000, "KG"), 0);
});

test("önerilen birim: küsur dörtte birse bir birim daha; az kaldıysa en az bir; gereken yoksa 0", () => {
  assert.equal(packsFor(20000, 12000, false), 2);
  assert.equal(packsFor(13000, 12000, false), 1);
  assert.equal(packsFor(2000, 12000, false), 0);
  assert.equal(packsFor(2000, 12000, true), 1);
  assert.equal(packsFor(-5, 1000, true), 0);
  assert.equal(packsFor(3500, 1000, false), 4);
  assert.equal(packsFor(3000, 1000, false), 3);
  assert.equal(packsFor(3000, 0, false), 0, "birimi bilinmeyen");
});

test("eldeki: hangisi yeniyse (hızlı ya da ay sonu), miktar × çarpan; ikisi de yoksa null", () => {
  const quick = { qty: 6, factor: 1000, countedAt: "2026-10-26T07:30:00.000Z", day: "2026-10-26", by: "Ayşe" };
  const monthEnd = { qty: 9, factor: 1000, at: "2026-10-01T06:00:00.000Z", day: "2026-10-01", by: "Mehmet" };
  assert.deepEqual(latestOnHand(quick, monthEnd), { base: 6000, at: quick.countedAt, day: "2026-10-26", source: "hizli", by: "Ayşe" });
  const newer = { ...monthEnd, at: "2026-10-27T06:00:00.000Z", day: "2026-10-27" };
  assert.equal(latestOnHand(quick, newer)?.source, "ay-sonu");
  assert.equal(latestOnHand(quick, newer)?.base, 9000);
  assert.equal(latestOnHand(null, null), null);
  assert.equal(latestOnHand(null, monthEnd)?.base, 9000);
  // Eylül sayımı 27 Ekim'de düzeltildi: anı 30 Eylül'ün sonu, 26 Ekim'in hızlı sayımı daha yeni
  const sepAt = monthEndCountAt("2026-09", new Date("2026-10-27T06:00:00Z"));
  assert.equal(latestOnHand(quick, { ...monthEnd, at: sepAt.toISOString(), day: businessDate(sepAt) })?.source, "hizli");
});

test("ay sonu sayımının anı: kayıt anı, en geç ayın son iş gününün sonu; sonradan girilen ya da düzeltilen ayın son günüdür", () => {
  const at = (month: string, iso: string) => monthEndCountAt(month, new Date(iso)).toISOString();
  // Ekim sayımı 3 Kasım'da girildi: 31 Ekim'in iş gününün sonu (1 Kasım 05:00'ten 1 ms önce, Türkiye)
  assert.equal(at("2026-10", "2026-11-03T08:00:00Z"), "2026-11-01T01:59:59.999Z");
  assert.equal(businessDate(new Date("2026-11-01T01:59:59.999Z")), "2026-10-31");
  // Aynı gece (02:30, iş günü hâlâ 31 Ekim) girilen: kayıt anı
  assert.equal(at("2026-10", "2026-10-31T23:30:00Z"), "2026-10-31T23:30:00.000Z");
  assert.equal(at("2026-10", "2026-11-01T02:00:00Z"), "2026-11-01T01:59:59.999Z", "05:00'te iş günü döner");
  // Bu ayın sayımı (ay bitmedi): kayıt anı
  assert.equal(at("2026-11", "2026-11-03T08:00:00Z"), "2026-11-03T08:00:00.000Z");
  // Yıl dönümü ve artık yıl
  assert.equal(at("2026-12", "2027-01-05T09:00:00Z"), "2027-01-01T01:59:59.999Z");
  const feb = monthEndCountAt("2028-02", new Date("2028-03-02T09:00:00Z"));
  assert.equal(feb.toISOString(), "2028-03-01T01:59:59.999Z");
  assert.equal(businessDate(feb), "2028-02-29");
  // Sınır iş gününün dönüşüyle aynı (DAY_TURN_HOUR): 1 ms sonrası ertesi ayın 1'i
  const end = monthEndCountAt("2026-10", new Date("2027-01-01T00:00:00Z"));
  assert.equal(businessDate(end), "2026-10-31");
  assert.equal(businessDate(new Date(end.getTime() + 1)), "2026-11-01");
});

/** Sipariş satırı (Süt, 1 koli = 12 LT) */
function line(o: Partial<ReorderLine> = {}): ReorderLine {
  return {
    ingredientId: MILK.id,
    name: "Süt %2,5",
    orderName: "SÜT %2,5 YAĞLI 1 L",
    qty: 2,
    unit: "koli",
    unitSize: 12000,
    baseUnit: "ml",
    countUnit: "LT",
    leadDays: 1,
    suggested: 2,
    onHand: 6000,
    par: 26000,
    expectedUnitPrice: 0.05185,
    priceEstimated: false,
    ...o,
  };
}

function order(o: Partial<OrderLite> = {}): OrderLite {
  return {
    id: 1,
    supplier: "Sütaş",
    supplierKey: "sütaş",
    sentAt: "2026-10-23T08:00:00.000Z",
    sentDay: "2026-10-23",
    expectedOn: "2026-10-24",
    status: "open",
    receivedAt: null,
    receivedByName: null,
    invoiceId: null,
    manualMatch: false,
    lines: [line()],
    check: null,
    closedAt: null,
    closedByName: null,
    closeNote: null,
    phone: null,
    channel: "whatsapp",
    message: "…",
    note: null,
    sentByName: "Yönetici",
    ...o,
  };
}

test("siparişte (D3): iptal olmayan, son 14 gün ya da beklenen günü geçmemiş, sayımda olmayan (gelmedi ya da sayımdan sonra geldi)", () => {
  const countAt = "2026-10-26T07:30:00.000Z";
  const today = "2026-10-26";
  assert.equal(onOrderFor([order()], MILK.id, countAt, today).base, 24000, "gelmedi: sayılır");
  assert.equal(onOrderFor([order({ receivedAt: "2026-10-24T09:00:00.000Z" })], MILK.id, countAt, today).base, 0, "sayımdan önce geldi");
  assert.equal(onOrderFor([order({ receivedAt: "2026-10-26T09:00:00.000Z" })], MILK.id, countAt, today).base, 24000, "sayımdan sonra geldi");
  assert.equal(onOrderFor([order({ status: "cancelled" })], MILK.id, countAt, today).base, 0);
  assert.equal(onOrderFor([order({ sentDay: "2026-10-11" })], MILK.id, countAt, today).base, 0, "15 gün önce");
  assert.equal(onOrderFor([order({ sentDay: "2026-10-12" })], MILK.id, countAt, today).base, 24000, "14 gün önce");
  // Teslim süresi uzun sipariş 14 günden eski olsa da beklenen günün ertesine kadar siparişte (zil ondan sonra sorar)
  const long = order({ sentAt: "2026-10-05T08:00:00.000Z", sentDay: "2026-10-05", expectedOn: "2026-10-26" });
  assert.equal(onOrderFor([long], MILK.id, countAt, today).base, 24000, "21 günlük teslim: beklenen gün gelmedi");
  assert.equal(onOrderFor([{ ...long, expectedOn: "2026-10-25" }], MILK.id, countAt, today).base, 24000, "beklenen gün dün");
  assert.equal(onOrderFor([{ ...long, expectedOn: "2026-10-24" }], MILK.id, countAt, today).base, 0, "beklenen günden 2 gün sonra");
  assert.equal(IN_TRANSIT_GRACE_DAYS, LATE_GRACE_DAYS, "zilin 'gelmedi mi' sorusuyla aynı gün");
  // Faturayla eşleşen, faturanın günü (öğlen) sayımdan önce: sayımda
  assert.equal(onOrderFor([order({ invoiceId: 9, receivedAt: "2026-10-24T09:00:00.000Z", status: "closed" })], MILK.id, countAt, today).base, 0);
  assert.equal(onOrderFor([order()], COFFEE.id, countAt, today).base, 0, "başka kalem");
  assert.deepEqual(onOrderFor([order({ id: 4 }), order({ id: 5, lines: [line({ qty: 1 })] })], MILK.id, countAt, today), { base: 36000, orderIds: [4, 5] });
});

test("siparişte: kapatılan ama Geldi denmemiş sipariş kapandığı anda gelmiş sayılır (14 gün beklemez)", () => {
  const countAt = "2026-10-26T07:30:00.000Z";
  const today = "2026-10-26";
  assert.equal(onOrderFor([order({ status: "closed", closedAt: "2026-10-25T09:00:00.000Z" })], MILK.id, countAt, today).base, 0, "sayımdan önce kapandı");
  assert.equal(onOrderFor([order({ status: "closed", closedAt: "2026-10-26T09:00:00.000Z" })], MILK.id, countAt, today).base, 24000, "sayımdan sonra kapandı");
  // Geldi denmişse onun anı (kapanış değil)
  assert.equal(onOrderFor([order({ status: "closed", receivedAt: "2026-10-24T09:00:00.000Z", closedAt: "2026-10-26T09:00:00.000Z" })], MILK.id, countAt, today).base, 0);
  // Yeniden açılan (açık, kapanış anı dolu) gelmemiş sipariş siparişte
  assert.equal(onOrderFor([order({ closedAt: "2026-10-25T09:00:00.000Z" })], MILK.id, countAt, today).base, 24000);
});

test("Geldi'nin anı: sayımın gününe kadar beklenen sipariş sayımdan sonra işaretlenince sayımın öncesi; liste ikinci kez saymaz", () => {
  // Ispaş: 19.10 gönderildi, 21.10 bekleniyordu; hızlı sayım 24.10 00:54 (iş günü 23.10), Geldi 12 dakika sonra
  const ispas = { sentAt: "2026-10-18T21:59:15.146Z", expectedOn: "2026-10-21" };
  const count = { at: "2026-10-23T21:54:58.950Z", day: "2026-10-23" };
  const tap = new Date("2026-10-23T22:06:01.593Z");
  const at = receivedAtFor(ispas, count, tap);
  assert.equal(at.toISOString(), "2026-10-23T21:54:57.950Z", "sayımdan bir saniye önce");
  // Vanilya dondurma (1 paket = 5,5 L): eldeki 2 LT, hedef 4,5 LT
  const sent = order({ id: 4, supplier: "Ispaş", supplierKey: "ispaş", sentAt: ispas.sentAt, sentDay: "2026-10-19", expectedOn: ispas.expectedOn, lines: [line({ qty: 1, unit: "paket", unitSize: 5500 })] });
  const today = "2026-10-24";
  const plan = (receivedAt: string) => {
    const onOrder = onOrderFor([{ ...sent, receivedAt }], MILK.id, count.at, today).base;
    const onHand = { base: 2000, at: count.at, day: count.day, source: "hizli" as const, by: "Ayşe" };
    return planLine(item({ supplierKey: "ispaş", supplierName: "Ispaş", parBase: 4500, perDay: null, onHand, onOrder, orderUnit: "paket", orderUnitSize: 5500 }), S, tap);
  };
  // Dokunuş anı yazılsaydı: "Yeterli · siparişte 5,5 LT", öneri yok
  assert.equal(plan(tap.toISOString()).onOrder, 5500);
  assert.equal(plan(tap.toISOString()).packs, 0);
  // Sayımın öncesi: gereken 2,5 LT → 1 paket
  assert.equal(plan(at.toISOString()).onOrder, 0);
  assert.equal(plan(at.toISOString()).packs, 1);
  // Sayımın günü beklenen de sayılmış sayılır
  assert.equal(receivedAtFor({ ...ispas, expectedOn: "2026-10-23" }, count, tap).toISOString(), "2026-10-23T21:54:57.950Z");
  // Sayımdan sonra gelmesi beklenen: dokunuş anı (sayımdan sonra geldi, siparişte sayılır)
  assert.equal(receivedAtFor({ ...ispas, expectedOn: "2026-10-24" }, count, tap), tap);
  // Sayımdan sonra gönderilen: dokunuş anı
  assert.equal(receivedAtFor({ sentAt: "2026-10-23T22:00:00.000Z", expectedOn: "2026-10-23" }, count, tap), tap);
  // Hiç sayılmamış, saat kayması (sayım gelecekte)
  assert.equal(receivedAtFor(ispas, null, tap), tap);
  assert.equal(receivedAtFor(ispas, { at: "2026-10-23T22:10:00.000Z", day: "2026-10-23" }, tap), tap);
  // Gönderimden hemen sonraki sayım: gönderimden önceye yazılmaz
  assert.equal(receivedAtFor({ sentAt: "2026-10-23T21:54:58.500Z", expectedOn: "2026-10-23" }, count, tap).toISOString(), "2026-10-23T21:54:58.500Z");
});

test("Ekim sayımı 3 Kasım'da girilince: arada gelen süt siparişte kalır, arada yapılan hızlı sayım geçer", () => {
  // 26.10 hızlı sayım 9 LT; 30.10 gönderilen 2 koli süt 02.11 geldi (Geldi 09:05); Ekim'in ay sonu sayımı (31.10
  // kapanıştan sonra 6 LT) 03.11 11:00'de girildi
  const quick = { qty: 9, factor: 1000, countedAt: "2026-10-26T07:30:00.000Z", day: "2026-10-26", by: "Ayşe" };
  const octAt = monthEndCountAt("2026-10", new Date("2026-11-03T08:00:00Z"));
  const oct = { qty: 6, factor: 1000, at: octAt.toISOString(), day: businessDate(octAt), by: "Sahip" };
  const sent = { sentAt: "2026-10-30T15:00:00.000Z", expectedOn: "2026-11-02" };
  const receivedAt = receivedAtFor(sent, { at: quick.countedAt, day: quick.day }, new Date("2026-11-02T06:05:00Z")).toISOString();
  const o = order({ ...sent, sentDay: "2026-10-30", receivedAt });
  const onHand = latestOnHand(quick, oct)!;
  assert.deepEqual([onHand.source, onHand.day, onHand.base], ["ay-sonu", "2026-10-31", 6000]);
  // Kayıt anı (03.11) yazılsaydı süt sayımda sayılır, 2 koli yeniden önerilirdi
  assert.equal(onOrderFor([o], MILK.id, onHand.at, "2026-11-03").base, 24000);
  const l = planLine(item({ onHand, onOrder: onOrderFor([o], MILK.id, onHand.at, "2026-11-03").base }), S, new Date("2026-11-03T08:30:00Z"));
  assert.equal(l.packs, 0);
  assert.equal(l.status, "yeterli");
  assert.deepEqual(readySuppliers(planGroups([l]), [o], onHand.at), [], "Bugün'de 'Sipariş hazır' yok");
  // Geldi 04.11'de geç dokunulursa: sipariş ayın son gününden sonra bekleniyordu, dokunuş anı kalır
  assert.equal(receivedAtFor(sent, { at: onHand.at, day: onHand.day }, new Date("2026-11-04T06:00:00Z")).toISOString(), "2026-11-04T06:00:00.000Z");
  // 02.11'in hızlı sayımı (28 LT) Ekim'in sonradan girilen sayımını geçer
  assert.equal(latestOnHand({ ...quick, qty: 28, countedAt: "2026-11-02T07:30:00.000Z", day: "2026-11-02" }, oct)?.source, "hizli");
  // Ekim sayımı 20.11'de düzeltildi: 16.11'in hızlı sayımı yine daha yeni
  const fixed = monthEndCountAt("2026-10", new Date("2026-11-20T12:00:00Z"));
  assert.equal(latestOnHand({ ...quick, qty: 20, countedAt: "2026-11-16T07:30:00.000Z", day: "2026-11-16" }, { ...oct, at: fixed.toISOString(), day: businessDate(fixed) })?.source, "hizli");
});

test("erken gelen mal: sayımdan önce Geldi denirse siparişte sayılmaz; denmezse ya da sayımdan sonra denirse sayılır", () => {
  // Cumartesi gönderilen, Salı beklenen süt Pazartesi sabah erken geldi; sayım 10:15
  const early = order({ sentAt: "2026-10-24T10:00:00.000Z", sentDay: "2026-10-24", expectedOn: "2026-10-27" });
  const countAt = "2026-10-26T07:15:00.000Z";
  const today = "2026-10-26";
  assert.equal(onOrderFor([early], MILK.id, countAt, today).base, 24000, "işaretlenmedi: siparişte");
  // Sayımdan önce Geldi (son sayım geçen haftanın): dokunuş anı, mal sayımda
  const before = receivedAtFor(early, { at: "2026-10-19T07:30:00.000Z", day: "2026-10-19" }, new Date("2026-10-26T06:50:00Z"));
  assert.equal(before.toISOString(), "2026-10-26T06:50:00.000Z");
  assert.equal(onOrderFor([{ ...early, receivedAt: before.toISOString() }], MILK.id, countAt, today).base, 0);
  // Sayımdan sonra Geldi: beklenen gün sayımdan sonra, dokunuş anı kalır, mal sayımdan sonra geldi
  const after = receivedAtFor(early, { at: countAt, day: today }, new Date("2026-10-26T08:00:00Z"));
  assert.equal(after.toISOString(), "2026-10-26T08:00:00.000Z");
  assert.equal(onOrderFor([{ ...early, receivedAt: after.toISOString() }], MILK.id, countAt, today).base, 24000);
});

test("hızlı sayım çakışması: kayıt formdaki biçimle karşılaştırılır (1,2345 ya da aynı gün değişen sayım birimi çakışma değil)", () => {
  // 1: Su (ADET), 1,2345 kaydedilmiş; 2: önce KG sayılmış, sonra sayım birimi ADET yapılmış; 3: Süt (LT)
  const factorOf = (id: number) => (id === 3 ? 1000 : 1);
  const current = new Map([
    [1, { qty: 1.2345, factor: 1 }],
    [2, { qty: 2, factor: 1000 }],
    [3, { qty: 3, factor: 1000 }],
  ]);
  const shown = (id: number) => shownCount(current.get(id) ?? null, factorOf(id));
  assert.equal(shownCount({ qty: 2, factor: 1000 }, 1), 2000);
  assert.equal(shownCount(null, 1000), null);
  // Formda görülen değerle yeniden kaydetme ya da silme: çakışma yok
  assert.deepEqual(quickCountConflicts([{ ingredientId: 1, qty: 2, base: shown(1) }], current, factorOf), []);
  assert.deepEqual(quickCountConflicts([{ ingredientId: 1, qty: null, base: shown(1) }], current, factorOf), []);
  assert.deepEqual(quickCountConflicts([{ ingredientId: 2, qty: 2500, base: 2000 }], current, factorOf), []);
  // Başkası 3 LT kaydetmiş, kişi 2'yi görmüştü
  assert.deepEqual(quickCountConflicts([{ ingredientId: 3, qty: 4, base: 2 }], current, factorOf), [3]);
  // Yanıtı kaybolan kendi kaydı (3 zaten yazılı): yenilemek çakışma değil
  assert.deepEqual(quickCountConflicts([{ ingredientId: 3, qty: 3, base: 2 }], current, factorOf), []);
  // Kişi boş görmüştü, başkası yazdı
  assert.deepEqual(quickCountConflicts([{ ingredientId: 3, qty: 5, base: null }], current, factorOf), [3]);
  // Başkası sildi
  assert.deepEqual(quickCountConflicts([{ ingredientId: 4, qty: 4, base: 2 }], current, factorOf), [4]);
  assert.deepEqual(quickCountConflicts([{ ingredientId: 4, qty: null, base: 2 }], current, factorOf), []);
  assert.deepEqual(quickCountConflicts([{ ingredientId: 4, qty: 4, base: null }], current, factorOf), []);
  // base gönderilmeyen satır denetlenmez
  assert.deepEqual(quickCountConflicts([{ ingredientId: 3, qty: 9 }], current, factorOf), []);
  // Kayıt 3 basamakla yazılır (countQty): 1,2345 yazılıp kaydedildiyse aynı isteğin yenilenmesi çakışma değil
  assert.equal(countQty(2.5), 2.5);
  assert.equal(countQty(0.0004), 0);
  assert.equal(countQty(null), null);
  assert.ok([1.234, 1.235].includes(countQty(1.2345)!), "en çok 3 basamak");
  const saved = new Map([[5, { qty: countQty(1.2345)!, factor: 1 }]]);
  assert.deepEqual(quickCountConflicts([{ ingredientId: 5, qty: 1.2345, base: null }], saved, () => 1), []);
  assert.deepEqual(quickCountConflicts([{ ingredientId: 5, qty: 2, base: shownCount(saved.get(5)!, 1) }], saved, () => 1), []);
});

test("varsayılan sipariş birimi (son fatura kalemi ya da paket) ve teslim süresi (tedarikçinin en çok yazılanı)", () => {
  assert.deepEqual(defaultOrderUnit({ unit: "Koli", factor: 12000 }, { packageSize: 1000 }), { unit: "koli", size: 12000 });
  assert.deepEqual(defaultOrderUnit({ unit: null, factor: 1000 }, { packageSize: 1000 }), { unit: "paket", size: 1000 });
  assert.deepEqual(defaultOrderUnit(null, { packageSize: 1000 }), { unit: "paket", size: 1000 });
  assert.deepEqual(defaultOrderUnit({ unit: "KG", factor: 0 }, { packageSize: 500 }), { unit: "paket", size: 500 });
  const tracked = [
    { supplierKey: "sütaş", leadDays: 1 },
    { supplierKey: "sütaş", leadDays: 1 },
    { supplierKey: "sütaş", leadDays: 3 },
    { supplierKey: "kaldi", leadDays: 2 },
    { supplierKey: "sütaş", leadDays: null },
  ];
  assert.equal(inheritLeadDays("sütaş", tracked, 2), 1);
  assert.equal(inheritLeadDays("kaldi", tracked, 5), 2);
  assert.equal(inheritLeadDays("ispaş", tracked, 2), 2, "genel ayar");
  assert.equal(inheritLeadDays(null, tracked, 2), 2);
  assert.equal(inheritLeadDays("x", [{ supplierKey: "x", leadDays: 1 }, { supplierKey: "x", leadDays: 3 }], 2), 3, "eşitlikte uzun olan");
});

test("beklenen fiyat: tedarikçinin son faturası, yoksa hammaddenin fiyatı; 0 fiyat bilinmiyor, Tahmini yalnız tahmin", () => {
  assert.deepEqual(referencePrice({ supplierLast: 0.055, unitCost: 0.05185, isEstimate: false }), { unitPrice: 0.055, estimated: false });
  assert.deepEqual(referencePrice({ supplierLast: null, unitCost: 0.05185, isEstimate: false }), { unitPrice: 0.05185, estimated: false });
  // Sayımda personelin fiyatsız eklediği kalem: paket fiyatı 0 → fiyat karşılaştırması ve tutar tahmini yok
  assert.equal(referencePrice({ supplierLast: null, unitCost: 0, isEstimate: true }), null);
  assert.equal(referencePrice({ supplierLast: 0, unitCost: 0, isEstimate: false }), null);
  // Personelin yazdığı ya da ilk yüklemenin tahmini fiyatı: tutar tahmini var, fiyat farkı uyarısı yok
  assert.deepEqual(referencePrice({ supplierLast: null, unitCost: 0.45, isEstimate: true }), { unitPrice: 0.45, estimated: true });
});

// ---------------------------------------------------------------- Öneri satırı ve gruplar

function item(o: Partial<PlanItem> = {}): PlanItem {
  return {
    ingredientId: MILK.id,
    name: "Süt %2,5",
    baseUnit: "ml",
    countUnit: "LT",
    countFactor: 1000,
    supplierKey: "sütaş",
    supplierName: "Sütaş",
    leadDays: 1,
    orderName: "SÜT %2,5 YAĞLI 1 L",
    orderUnit: "koli",
    orderUnitSize: 12000,
    parBase: null,
    perDay: 2689.33,
    onHand: { base: 6000, at: MONDAY.toISOString(), day: "2026-10-26", source: "hizli", by: "Ayşe" },
    onOrder: 0,
    expectedUnitPrice: 0.05185,
    priceEstimated: false,
    ...o,
  };
}

test("öneri satırı: 6 LT eldeki, 26 LT hedef → 2 koli; tutar fiyat × birim × içerik", () => {
  const l = planLine(item(), S, MONDAY);
  assert.equal(l.par, 26000);
  assert.equal(l.parSource, "oneri");
  assert.equal(l.need, 20000);
  assert.equal(l.packs, 2);
  assert.equal(l.status, "siparis");
  assert.equal(l.critical, false);
  assert.equal(l.stale, false);
  assert.ok(Math.abs((l.estimate ?? 0) - 0.05185 * 2 * 12000) < 1e-9);
  // 1 L'lik adetle: 20 adet
  assert.equal(planLine(item({ orderUnit: "adet", orderUnitSize: 1000 }), S, MONDAY).packs, 20);
});

test("öneri satırı: sayılmadı, hedef yok, elle hedef önce, siparişte düşer, az kalan bir birim, sayım eski", () => {
  assert.equal(planLine(item({ onHand: null }), S, MONDAY).status, "sayilmadi");
  assert.equal(planLine(item({ perDay: 0 }), S, MONDAY).status, "hedef-yok");
  assert.equal(planLine(item({ perDay: null }), S, MONDAY).status, "hedef-yok");
  const manual = planLine(item({ parBase: 40000 }), S, MONDAY);
  assert.equal(manual.parSource, "elle");
  assert.equal(manual.par, 40000);
  assert.equal(manual.packs, 3);
  assert.equal(planLine(item({ perDay: null, parBase: 12000 }), S, MONDAY).packs, 1, "kullanım yoksa elle hedef yeter");
  assert.equal(planLine(item({ onOrder: 24000 }), S, MONDAY).packs, 0, "yoldaki sipariş");
  assert.equal(planLine(item({ onOrder: 24000 }), S, MONDAY).status, "yeterli");
  // Az kaldı: eldeki 2 L < en az 3,2 L, gereken 1 L: küsur dörtte birin altında ama yine bir koli
  const low = planLine(item({ onHand: { base: 2000, at: MONDAY.toISOString(), day: "2026-10-26", source: "hizli", by: null }, parBase: 3000 }), S, MONDAY);
  assert.equal(low.critical, true);
  assert.equal(low.packs, 1);
  const old = planLine(item({ onHand: { base: 6000, at: "2026-10-21T07:00:00.000Z", day: "2026-10-21", source: "hizli", by: null } }), S, MONDAY);
  assert.equal(old.stale, true, "5 gün");
  assert.equal(planLine(item({ onHand: { base: 6000, at: "2026-10-22T08:00:00.000Z", day: "2026-10-22", source: "hizli", by: null } }), S, MONDAY).stale, false);
  assert.equal(planLine(item({ expectedUnitPrice: null }), S, MONDAY).estimate, null);
});

test("tedarikçi grupları: önerisi olanlar önce (ada göre), sonra ötekiler, en sonda tedarikçisi seçilmemiş; hazır olanlar", () => {
  const lines = [
    planLine(item({ ingredientId: 1, name: "Süt", supplierKey: "sütaş", supplierName: "Sütaş" }), S, MONDAY),
    planLine(item({ ingredientId: 2, name: "Espresso", supplierKey: "kaldi", supplierName: "Kaldi", onOrder: 30000 }), S, MONDAY),
    planLine(item({ ingredientId: 3, name: "Çay", supplierKey: null, supplierName: null }), S, MONDAY),
    planLine(item({ ingredientId: 4, name: "Dondurma", supplierKey: "ispaş", supplierName: "Ispaş" }), S, MONDAY),
    planLine(item({ ingredientId: 5, name: "Laktozsuz", supplierKey: "sütaş", supplierName: "Sütaş", parBase: 3000, onHand: { base: 1000, at: MONDAY.toISOString(), day: "2026-10-26", source: "hizli", by: null } }), S, MONDAY),
  ];
  const groups = planGroups(lines);
  assert.deepEqual(
    groups.map((g) => g.supplierKey),
    ["ispaş", "sütaş", "kaldi", null],
  );
  // Az kalan önce
  assert.deepEqual(
    groups[1].lines.map((l) => l.name),
    ["Laktozsuz", "Süt"],
  );
  assert.equal(groups[2].packs, 0);
  // Sayımdan sonra siparişi gönderilen tedarikçi hazır değil
  const ready = readySuppliers(groups, [order({ supplierKey: "ispaş", sentAt: "2026-10-26T08:00:00.000Z" })], MONDAY.toISOString());
  assert.deepEqual(
    ready.map((g) => g.supplierKey),
    ["sütaş"],
  );
  // Sayımdan önce gönderilen ya da iptal edilen saymaz
  assert.equal(readySuppliers(groups, [order({ supplierKey: "sütaş", sentAt: "2026-10-25T08:00:00.000Z" })], MONDAY.toISOString()).length, 2);
  assert.equal(readySuppliers(groups, [order({ supplierKey: "sütaş", status: "cancelled", sentAt: "2026-10-26T09:00:00.000Z" })], MONDAY.toISOString()).length, 2);
  assert.deepEqual(readySuppliers(groups, [], null), [], "sayım yok");
});

test("takibe önerilenler (Excel, Eylül): aylık tutara göre ilk 15; Espresso ve Süt var, su / buz ve takipteki yok", () => {
  const model = createModel(base);
  const usage = monthlyUsage(model, latestSalesMonth(model));
  assert.ok(usage);
  const water = base.ingredients.filter((i) => i.priceSource === "water").map((i) => i.id);
  const pick = (tracked: number[]) =>
    suggestTracked(
      base.ingredients.map((i) => ({
        id: i.id,
        countable: i.active && i.countUnit !== null && i.priceSource !== "water",
        tracked: tracked.includes(i.id),
        perDay: usage.byIngredient.get(i.id)?.perDay ?? 0,
        unitCost: model.unitCost.get(i.id) ?? 0,
      })),
    );
  const ids = pick([]);
  assert.equal(ids.length, 15);
  assert.ok(ids.includes(COFFEE.id), "Espresso çekirdeği");
  assert.ok(ids.includes(MILK.id), "Süt %2,5");
  for (const w of water) assert.ok(!ids.includes(w), "su ve buz sayım birimsiz");
  assert.ok(!pick([MILK.id]).includes(MILK.id), "takipteki önerilmez");
  // Kullanımı olmayan önerilmez
  assert.deepEqual(suggestTracked([{ id: 1, countable: true, tracked: false, perDay: 0, unitCost: 5 }]), []);
});

// ---------------------------------------------------------------- Mesaj ve bağlantı

test("WhatsApp mesajı: kalın imza, maddeler, not, Teşekkürler; 0'lık kalem düşer; fiyat yok", () => {
  const text = orderMessage({
    signature: "L'Affogato",
    lines: [
      { orderName: "SÜT %2,5 YAĞLI 1 L", qty: 2, unit: "koli" },
      { orderName: "SÜT LAKTOZSUZ 1 L", qty: 1, unit: "Koli" },
      { orderName: "SIFIR", qty: 0, unit: "koli" },
    ],
    note: "Perşembe sabah 10'dan önce",
  });
  assert.equal(text, "Merhaba, *L'Affogato* siparişimiz:\n\n• SÜT %2,5 YAĞLI 1 L: 2 koli\n• SÜT LAKTOZSUZ 1 L: 1 koli\n\nNot: Perşembe sabah 10'dan önce\nTeşekkürler.");
  assert.doesNotMatch(text, /₺/);
  assert.equal(orderMessage({ signature: "L'Affogato", lines: [{ orderName: "Espresso Çekirdeği 1 KG", qty: 5, unit: "adet" }] }), "Merhaba, *L'Affogato* siparişimiz:\n\n• Espresso Çekirdeği 1 KG: 5 adet\n\nTeşekkürler.");
  // İmzadaki biçim işaretleri kalınlığı bozmaz; boşsa varsayılan
  assert.match(orderMessage({ signature: "*Laf*", lines: [] }), /^Merhaba, \*Laf\* siparişimiz:/);
  assert.match(orderMessage({ signature: "  ", lines: [] }), /\*L'Affogato\*/);
  assert.equal(qtyLabel(2.5, "KG"), "2,5 kg");
  assert.equal(qtyLabel(2, "Koli"), "2 koli");
  assert.equal(qtyLabel(1.25, "kg"), "1,25 kg");
  assert.equal(countAmount(3227.2, 1000, "LT"), "3,2 LT");
  assert.equal(countAmount(26000, 1000, "LT"), "26 LT");
  assert.equal(dayName("2026-10-22"), "Perşembe");
});

test("WhatsApp bağlantısı: cep numarası doğrudan; numara yoksa ya da sabit hatsa kişi seçilir", () => {
  const a = orderLink("0532 123 45 67", "Merhaba");
  assert.equal(a.href, "https://wa.me/905321234567?text=Merhaba");
  assert.equal(a.target, "numara");
  assert.equal(a.reason, null);
  assert.deepEqual(orderLink(null, "Merhaba"), { href: "https://wa.me/?text=Merhaba", target: "sec", reason: "yok" });
  assert.deepEqual(orderLink("0212 123 45 67", "Merhaba"), { href: "https://wa.me/?text=Merhaba", target: "sec", reason: "sabit" });
  assert.equal(mobileE164("0532 123 45 67"), "+905321234567");
  assert.equal(mobileE164("0212 123 45 67"), null);
});

test("önerisi olmayan kalemlerin başlığı: sayılmayan ve hedefi olmayan 'yeterli' diye sayılmaz", () => {
  assert.equal(restLabel(["yeterli", "yeterli"]), "Yeterli olanlar (2)");
  // Tek kalemi sayılmamış tedarikçi: "Yeterli olanlar (1)" değil
  assert.equal(restLabel(["sayilmadi"]), "Sayılmayanlar (1)");
  assert.equal(restLabel(["hedef-yok", "yeterli", "sayilmadi", "yeterli"]), "Yeterli olanlar (2) · Sayılmayanlar (1) · Hedefi olmayanlar (1)");
  assert.equal(restLabel([]), "");
});

// ---------------------------------------------------------------- Aylık kullanım (Excel verisi)

test("aylık kullanım (Eylül): Süt 80,68 L / 30 gün; açık gün 15 ise iki katı; kayıtlı zayi eklenir; satışsız ay null", () => {
  const model = createModel(base);
  const month = latestSalesMonth(model);
  assert.equal(month, "2026-09");
  const u = monthlyUsage(model, month);
  assert.ok(u);
  assert.equal(u.basis.label, "Eylül 2026 satışları");
  assert.ok(Math.abs(u.byIngredient.get(MILK.id)!.perDay - 80680 / DAYS_PER_MONTH) < 1e-6);
  assert.ok(Math.abs(u.byIngredient.get(COFFEE.id)!.perDay - 16299 / DAYS_PER_MONTH) < 1e-6);
  // Ayın açık günü 15 (ayarda 30): adetler standart aya ölçeklenir
  const half = createModel({ ...base, months: base.months.map((m) => (m.month === "2026-09" ? { ...m, openDays: 15 } : m)) });
  assert.ok(Math.abs(monthlyUsage(half, "2026-09")!.byIngredient.get(MILK.id)!.perDay - (2 * 80680) / DAYS_PER_MONTH) < 1e-6);
  // 2 L süt zayi
  const wasted = createModel({ ...base, wasteEntries: [{ date: "2026-09-10", kind: "zayi", productId: null, ingredientId: MILK.id, qty: 2, factor: 1000 }] });
  const w = monthlyUsage(wasted, "2026-09")!.byIngredient.get(MILK.id)!;
  assert.equal(w.waste, 2000);
  assert.ok(Math.abs(w.perDay - (80680 + 2000) / DAYS_PER_MONTH) < 1e-6);
  assert.equal(monthlyUsage(model, "2026-08"), null);
  assert.equal(monthlyUsage(model, null), null);
});

test("aylık kullanım: online kafe siparişleri dahil; salesBasis'in ürün başına aylık adediyle aynı", () => {
  const latte = base.products.find((p) => p.name.toLocaleLowerCase("tr-TR").includes("latte") && p.active)!;
  assert.ok(latte, "latte yok");
  const withSite: Dataset = {
    ...base,
    products: base.products.map((p) => (p.id === latte.id ? { ...p, siteMenuId: "mnu-test", siteMenuSlot: p.size === "L" ? "L" : "M" } : p)),
    siteSales: [
      {
        month: "2026-09",
        pulledAt: "2026-10-01T05:00:00.000Z",
        closed: true,
        cafe: { lines: [{ menuItemId: "mnu-test", slot: latte.size === "L" ? "L" : "M", name: latte.name, qty: 30, grossMinor: 300000, options: {} }] },
      } as unknown as NonNullable<Dataset["siteSales"]>[number],
    ],
  };
  const model = createModel(withSite);
  const u = monthlyUsage(model, "2026-09")!;
  const plain = monthlyUsage(createModel(base), "2026-09")!;
  const milk = u.byIngredient.get(MILK.id)!;
  assert.ok(milk.online > 0, "online süt");
  assert.ok(milk.perDay > plain.byIngredient.get(MILK.id)!.perDay);
  // salesBasis'in aylık adetleri reçeteyle çarpılınca aynı kullanım
  const sb = salesBasis(model, "2026-09")!;
  const fromBasis = new Map<number, number>();
  for (const [pid, qty] of sb.perMonth) for (const it of model.itemsByProduct.get(pid) ?? []) fromBasis.set(it.ingredientId, (fromBasis.get(it.ingredientId) ?? 0) + model.evalQty(it).qty * qty);
  for (const [id, x] of u.byIngredient) assert.ok(Math.abs(x.sales + x.online - (fromBasis.get(id) ?? 0)) < 1e-6, String(id));
});

// ---------------------------------------------------------------- Ayarlar ve sabah işi

test("ayarlar: eksik ya da bozuk alan varsayılanı alır; sayım günleri tekrarsız ve sıralı", () => {
  assert.deepEqual(parseReorderSettings(null), DEFAULT_REORDER);
  assert.deepEqual(parseReorderSettings({ countWeekdays: [4, 1, 4, 9], marginPct: 0.3, defaultLeadDays: 1, signature: " Laf " }), {
    countWeekdays: [1, 4],
    marginPct: 0.3,
    defaultLeadDays: 1,
    signature: "Laf",
  });
  assert.deepEqual(parseReorderSettings({ countWeekdays: [], marginPct: 5, defaultLeadDays: -1, signature: "" }), DEFAULT_REORDER);
});

test("sabah işi: hızlı sayım bildirimi yalnız gönderilince adım; hiçbir cihaza gitmediyse hata; isteğe bağlı adım", () => {
  assert.deepEqual(countStep({ status: "sent", sent: 2, failed: 0 }), { code: "sent" });
  assert.equal(countStep({ status: "skip", sent: 0, failed: 0 }), undefined);
  assert.equal(countStep({ status: "sent", sent: 0, failed: 0 }), undefined, "bildirimi açık cihaz yok");
  assert.deepEqual(countStep({ status: "sent", sent: 0, failed: 2 }), { code: "error", error: "2 cihaza gönderilemedi" });
  assert.deepEqual(countStep({ error: "süre doldu" }), { code: "error", error: "süre doldu" });
  const core = { sync: { code: "ok" }, digest: { code: "sent" }, reminders: { code: "none" }, karaoke: { code: "ok" }, menu: { code: "ok" }, sales: { code: "ok" } };
  assert.deepEqual(dailyOutcome({ ...core, count: { code: "sent" } }).steps.count, "sent");
  assert.equal(dailyOutcome({ ...core, count: { code: "error", error: "x" } }).status, "partial");
  assert.equal(dailyOutcome(core).steps.count, undefined);
  const route = read("src/app/api/cron/gunluk/route.ts");
  // En çok 8 sn (R15) ve kuyruğun 55 sn'sini aşmadan; adım yalnız gönderilince yazılır
  assert.match(route, /capped\(\s*pushCountDay\(\)\.catch\(\(e: Error\) => \(\{ error: e\.message \}\)\),\s*Math\.min\(8_000, tailStepDeadline\(jobStart\) - Date\.now\(\)\),/);
  assert.match(route, /\.\.\.\(countResult \? \{ count: countResult \} : \{\}\)/);
  const push = read("src/server/notify/reorder-push.ts");
  assert.match(push, /sendPush\(\s*"reminders",/);
  assert.match(push, /loadReorderDay\("staff", now\)/);
  assert.doesNotMatch(read("src/server/push/send.ts"), /hizli-sayim/);
});

// ---------------------------------------------------------------- Bugün

const tr = (local: string) => new Date(`${local}:00+03:00`);
const STOCK = { month: "2026-10", counted: 0, total: 40, prevMonth: "2026-09", prevHasData: true, prevCounted: 40, prevTotal: 40 };
const facts = (role: "admin" | "staff", now: Date, reorder: ReorderDayFacts | null, o: Partial<DayFacts> = {}): DayFacts =>
  role === "admin"
    ? { role, now, cash: { today: null, yesterday: null, firstDate: null }, stock: STOCK, system: [], payments: [], invoices: { review: 0 }, reorder, ...o }
    : { role, now, cash: { today: null, yesterday: null, firstDate: null }, waste: { count: 0, zayi: null, ikram: null }, stock: STOCK, reorder, ...o };
const rf = (o: Partial<ReorderDayFacts> = {}): ReorderDayFacts => ({ total: 14, countedToday: 0, lastCountDay: "2026-10-19", countWeekdays: [1], ...o });
const row = (tasks: ReturnType<typeof dayTasks>, key: string) => tasks.find((t) => t.key === key);

test("Bugün › hızlı sayım: sayım günü 0 / 5 / 14 kalem; yöneticide bitince sipariş listesine götürür", () => {
  const mon = tr("2026-10-26T10:30");
  const none = row(dayTasks(facts("staff", mon, rf())), "hizli-sayim")!;
  assert.equal(none.status, "todo");
  assert.equal(none.badge, "Bugün");
  assert.equal(none.detail, "Bugün hızlı sayım günü: 14 kritik kalemi sayın; sipariş listesi sayıma göre hazırlanır.");
  assert.equal(none.href, "/panel/hizli-sayim");
  assert.equal(none.action, "Sayıma başla");
  const half = row(dayTasks(facts("staff", mon, rf({ countedToday: 5 }))), "hizli-sayim")!;
  assert.equal(half.badge, "5 / 14");
  assert.equal(half.detail, "5 / 14 kalem sayıldı; kalanları da girin.");
  assert.equal(half.action, "Sayıma devam");
  const doneStaff = row(dayTasks(facts("staff", mon, rf({ countedToday: 14 }))), "hizli-sayim")!;
  assert.equal(doneStaff.status, "done");
  assert.equal(doneStaff.detail, "14 kalemin hepsi sayıldı.");
  assert.equal(doneStaff.href, "/panel/hizli-sayim");
  const doneAdmin = row(dayTasks(facts("admin", mon, rf({ countedToday: 14 }))), "hizli-sayim")!;
  assert.equal(doneAdmin.detail, "14 kalemin hepsi sayıldı. Sipariş listesi hazır.");
  assert.equal(doneAdmin.href, "/panel/mal-siparisi");
  assert.equal(doneAdmin.action, "Sipariş listesi");
});

test("Bugün › hızlı sayım: gecikince her gün; taze sayımda sayım günü değilse ve ayın son günü satır yok", () => {
  const late = row(dayTasks(facts("staff", tr("2026-10-27T10:00"), rf({ lastCountDay: "2026-10-15" }))), "hizli-sayim")!;
  assert.equal(late.status, "todo");
  assert.equal(late.badge, "Gecikti");
  assert.equal(late.detail, "Son hızlı sayım 15 Ekim Perşembe (12 gün önce). Sipariş önerisi eski stoka göre.");
  assert.equal(row(dayTasks(facts("staff", tr("2026-10-27T10:00"), rf())), "hizli-sayim"), undefined);
  assert.equal(row(dayTasks(facts("staff", tr("2026-08-31T10:00"), rf({ lastCountDay: "2026-08-01" }))), "hizli-sayim"), undefined, "ay sonu");
  assert.equal(row(dayTasks(facts("staff", tr("2026-10-26T10:00"), rf({ total: 0 }))), "hizli-sayim"), undefined, "takip yok");
  assert.equal(row(dayTasks(facts("staff", tr("2026-10-26T10:00"), null)), "hizli-sayim"), undefined);
  // Gece 01:00: iş günü dün (Pazar); Pazartesi'nin satırı sabah 05:00'te çıkar
  assert.equal(row(dayTasks(facts("staff", tr("2026-10-26T01:00"), rf())), "hizli-sayim"), undefined);
});

test("Bugün › mal siparişi (yönetici): fark önce sorun, sonra hazır liste, sonra gelmeyen; personelde hiç yok", () => {
  const mon = tr("2026-10-26T11:00");
  const issues = { issues: [{ supplier: "Kaldi", summary: "1 eksik, 1 fiyat farkı" }, { supplier: "Sütaş", summary: "1 fazla" }, { supplier: "Ispaş", summary: "1 gelmedi" }], late: 1 };
  const warn = row(dayTasks(facts("admin", mon, rf({ delivery: issues, ready: { suppliers: ["Sütaş"], lines: 2 } }))), "mal-siparisi")!;
  assert.equal(warn.status, "warn");
  assert.equal(warn.title, "Teslim kontrolü");
  assert.equal(warn.badge, "3 sipariş");
  assert.equal(warn.detail, "Kaldi: 1 eksik, 1 fiyat farkı; Sütaş: 1 fazla…");
  assert.equal(warn.href, "/panel/mal-siparisi/gonderilen?durum=fark");
  const ready = row(dayTasks(facts("admin", mon, rf({ delivery: { issues: [], late: 1 }, ready: { suppliers: ["Kaldi", "Sütaş", "Ispaş", "Gıdaser"], lines: 6 } }))), "mal-siparisi")!;
  assert.equal(ready.status, "todo");
  assert.equal(ready.badge, "4 tedarikçi");
  assert.equal(ready.detail, "Kaldi, Sütaş, Ispaş ve 1 tedarikçi daha için 6 kalem sipariş öneriliyor. WhatsApp'tan tek dokunuşla gönderin.");
  const two = row(dayTasks(facts("admin", mon, rf({ delivery: null, ready: { suppliers: ["Kaldi", "Sütaş"], lines: 3 } }))), "mal-siparisi")!;
  assert.equal(two.detail, "Kaldi ve Sütaş için 3 kalem sipariş öneriliyor. WhatsApp'tan tek dokunuşla gönderin.");
  const one = row(dayTasks(facts("admin", mon, rf({ delivery: null, ready: { suppliers: ["Kaldi"], lines: 1 } }))), "mal-siparisi")!;
  assert.equal(one.detail, "Kaldi için 1 kalem sipariş öneriliyor. WhatsApp'tan tek dokunuşla gönderin.");
  assert.equal(ready.href, "/panel/mal-siparisi");
  const late = row(dayTasks(facts("admin", mon, rf({ delivery: { issues: [], late: 2 }, ready: null }))), "mal-siparisi")!;
  assert.equal(late.title, "Gelmeyen mal siparişi");
  assert.equal(late.badge, "2");
  assert.equal(late.detail, "2 mal siparişi beklenen günde gelmedi; geldiyse işaretleyin.");
  assert.equal(row(dayTasks(facts("admin", mon, rf({ delivery: { issues: [], late: 0 }, ready: null }))), "mal-siparisi"), undefined);
  // Personelin olgusuna yönetici bilgisi gelse de satır yok
  assert.equal(row(dayTasks(facts("staff", mon, rf({ delivery: issues, ready: { suppliers: ["Sütaş"], lines: 2 } }))), "mal-siparisi"), undefined);
});

test("Bugün › sıra: yöneticide hizli-sayim ve mal-siparisi kontrol listelerinden sonra, kasadan önce; personelde zayiden önce", () => {
  const evening = tr("2026-10-26T21:00");
  const adminKeys = dayTasks(facts("admin", evening, rf({ delivery: { issues: [], late: 1 } }))).map((t) => t.key);
  assert.deepEqual(adminKeys.slice(-3), ["hizli-sayim", "mal-siparisi", "kasa"]);
  const staffKeys = dayTasks(facts("staff", evening, rf())).map((t) => t.key);
  assert.deepEqual(staffKeys, ["hizli-sayim", "zayi", "kasa"]);
});

test("Bugün kaynağı: personel hızlı sayım olgusunu modelsiz alır, yönetici modeli paylaşır; ikisi safe() ile", () => {
  const src = read("src/server/data/today.ts");
  const staffBody = src.slice(src.indexOf("async function staffFacts"), src.indexOf("async function adminFacts"));
  assert.match(staffBody, /safe\(loadReorderDay\("staff", new Date\(\)\)\)/);
  assert.doesNotMatch(staffBody, /loadModel|model\)/);
  const adminBody = src.slice(src.indexOf("async function adminFacts"), src.indexOf("export async function loadToday"));
  assert.match(adminBody, /safe\(modelP\.then\(\(model\) => loadReorderDay\("admin", now, model\)\)\)/);
  assert.match(adminBody, /loadPriceAlerts\(await modelP\)/);
});

// ---------------------------------------------------------------- Menü, roller, Yardım

test("menü: Stok › Hızlı sayım (iki rol) ve Mal siparişi (yönetici); sekmeler, başlıklar, alt menü", () => {
  const stok = NAV_TREE.find((n) => n.id === "stok")!;
  assert.deepEqual(
    stok.children!.map((c) => c.id),
    ["sayim", "hizli-sayim", "mal-siparisi", "zayi", "tutarlilik"],
  );
  assert.deepEqual(stok.children!.find((c) => c.id === "hizli-sayim")!.roles, ["admin", "staff"]);
  assert.deepEqual(stok.children!.find((c) => c.id === "mal-siparisi")!.roles, ["admin"]);
  assert.deepEqual(
    SECTION_TABS.malSiparisi.map((t) => t.href),
    ["/panel/mal-siparisi", "/panel/hizli-sayim", "/panel/mal-siparisi/gonderilen", "/panel/mal-siparisi/kalemler"],
  );
  assert.equal(mobileTitleFor("/panel/hizli-sayim"), "Hızlı sayım");
  assert.equal(mobileTitleFor("/panel/mal-siparisi"), "Mal siparişi");
  assert.equal(mobileTitleFor("/panel/mal-siparisi/gonderilen"), "Gönderilenler");
  assert.equal(mobileTitleFor("/panel/mal-siparisi/kalemler"), "Sipariş kalemleri");
  assert.equal(bottomNavActive(BOTTOM_NAV.admin, "/panel/mal-siparisi"), "menu");
  assert.equal(bottomNavActive(BOTTOM_NAV.staff, "/panel/hizli-sayim"), null);
  // "Sipariş" uygulama siparişidir: rotalar "mal-siparisi", eski plan adı (/panel/siparis) yok
  assert.ok(!NAV_TREE.some((n) => [n.href, ...(n.children ?? []).map((c) => c.href)].some((h) => h === "/panel/siparis" || h?.startsWith("/panel/siparis/"))));
  assert.match(read("src/components/panel/nav.ts"), /href: "\/panel\/hizli-sayim",\s+label: "Hızlı sayım",\s+icon: ClipboardPen,/);
});

test("roller: personel hızlı sayımı açar, mal siparişinin ekranlarını açmaz; yetki tablosunda iki satır", () => {
  assert.ok(STAFF_PATHS.includes("/panel/hizli-sayim"));
  assert.equal(canOpen("staff", "/panel/hizli-sayim"), true);
  for (const p of ["/panel/mal-siparisi", "/panel/mal-siparisi/kalemler", "/panel/mal-siparisi/gonderilen"]) assert.equal(canOpen("staff", p), false, p);
  assert.ok(ROLE_PERMISSIONS.some((p) => p.staff && p.paths?.includes("/panel/hizli-sayim")));
  assert.ok(ROLE_PERMISSIONS.some((p) => !p.staff && /Mal siparişi/.test(p.label)));
});

test("Yardım: yollar kenar çubuğundan; iki soru (mal siparişi, teslim)", () => {
  assert.deepEqual(pathOf("/panel/mal-siparisi"), ["Stok", "Mal siparişi"]);
  assert.deepEqual(pathOf("/panel/mal-siparisi/kalemler"), ["Stok", "Mal siparişi", "Kalemler"]);
  assert.deepEqual(pathOf("/panel/mal-siparisi/gonderilen"), ["Stok", "Mal siparişi", "Gönderilenler"]);
  assert.deepEqual(pathOf("/panel/hizli-sayim"), ["Stok", "Hızlı sayım"]);
  const page = read("src/app/panel/yardim/page.tsx");
  assert.match(page, /id: "mal-siparisi",\s+q: "Mal siparişi nasıl verilir\?"/);
  assert.match(page, /id: "teslim",\s+q: "Gelen mal siparişle tutmuyor"/);
});

// ---------------------------------------------------------------- Kaynak denetimleri

/** Bir fonksiyonun gövdesi (sonraki üst düzey tanıma kadar) */
function bodyOf(src: string, name: string): string {
  const start = src.search(new RegExp(`(export )?(async )?function ${name}\\b`));
  assert.ok(start >= 0, `${name} yok`);
  const rest = src.slice(start + 1);
  const end = rest.search(/\n(export )?(async )?function |\n(export )?(const|interface|type) /);
  return end < 0 ? rest : rest.slice(0, end);
}

test("kaynak: hızlı sayım iki role açık ve fiyatsız (sayfa, istemci, yükleyici); mal siparişinin sayfaları yöneticinin", () => {
  const page = read("src/app/panel/hizli-sayim/page.tsx");
  assert.match(page, /await requireUser\(\)/);
  assert.doesNotMatch(page, /requireAdmin/);
  const PRICE = /unitCost|packagePrice|expectedUnitPrice|payable|loadModel|tl\(/;
  assert.doesNotMatch(page, PRICE);
  assert.doesNotMatch(read("src/app/panel/hizli-sayim/quick-count-form.tsx"), PRICE);
  assert.doesNotMatch(bodyOf(read("src/server/data/reorder.ts"), "loadQuickCountSheet"), PRICE);
  assert.doesNotMatch(bodyOf(read("src/server/data/reorder.ts"), "countFacts"), PRICE);
  for (const p of ["src/app/panel/mal-siparisi/page.tsx", "src/app/panel/mal-siparisi/gonderilen/page.tsx", "src/app/panel/mal-siparisi/kalemler/page.tsx"]) {
    assert.match(read(p), /await requireAdmin\(\)/, p);
  }
});

test("kaynak: ay sonu sayımının anı monthEndCountAt'ten (kayıt anı değil)", () => {
  const src = read("src/server/data/reorder.ts");
  for (const name of ["loadOnHand", "latestCountOf", "countFacts", "loadQuickCountSheet"]) assert.match(bodyOf(src, name), /monthEndCountAt\(/, name);
  assert.doesNotMatch(bodyOf(src, "loadOnHand"), /businessDate\(mr\.updatedAt\)/);
  assert.doesNotMatch(bodyOf(src, "latestCountOf"), /orderBy\(desc\(s\.stockCounts\.updatedAt\)\)/);
  assert.doesNotMatch(bodyOf(src, "countFacts"), /gte\(s\.stockCounts\.updatedAt/);
  // Sayım eski uyarısı son sayımın iş gününden (sınırlanmış an 1'i gösterirdi)
  assert.match(bodyOf(src, "loadOrderPlan"), /staleDays: d\.lastCountDay \?/);
});

test("kaynak: Gelen mal var mı? erken gelen siparişi de gösterir (beklenen gün süzgeci yok)", () => {
  const body = bodyOf(read("src/server/data/reorder.ts"), "loadQuickCountSheet");
  assert.doesNotMatch(body, /expectedOn\}\s*<=/);
  assert.match(body, /sql`\$\{o\.receivedAt\} is null`, sql`\$\{o\.invoiceId\} is null`/);
  assert.match(body, /expectedOn: x\.expectedOn/);
  const form = read("src/app/panel/hizli-sayim/quick-count-form.tsx");
  assert.match(form, /o\.expectedOn > sheet\.day/);
  assert.match(form, /bekleniyor/);
});

test("kaynak: eylemlerin yetkisi (hızlı sayım ve Geldi iki rolde, ötekiler yönetici)", () => {
  const src = read("src/server/actions/reorder.ts");
  assert.match(src, /^"use server";/);
  const exported = [...src.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(exported.sort(), [
    "cancelOrder",
    "closeOrder",
    "markOrderReceived",
    "recordOrderSent",
    "reopenOrder",
    "restoreReorderItem",
    "saveQuickCounts",
    "saveReorderItem",
    "saveReorderSettings",
    "setLeadDays",
    "setOrderInvoice",
    "trackIngredients",
    "untrackIngredient",
  ]);
  // "use server" dosyasında yalnız eylemler dışa açık (yardımcı fonksiyon dışarıdan çağrılabilir olurdu)
  assert.doesNotMatch(src, /^export (const|function|let) /m);
  for (const name of exported) {
    const body = bodyOf(src, name).slice(0, 220);
    if (name === "saveQuickCounts" || name === "markOrderReceived") assert.match(body, /const me = await requireUser\(\);/, name);
    else assert.match(body, /const me = await requireAdmin\(\);/, name);
  }
  // Gün sunucunun saatinden (personel geçmiş bir güne yazamaz); satırlar sunucuda kurulur
  assert.match(bodyOf(src, "saveQuickCounts"), /const day = businessDate\(now\);/);
  assert.match(bodyOf(src, "recordOrderSent"), /orderSnapshot\(/);
  assert.match(bodyOf(src, "recordOrderSent"), /onConflictDoNothing\(\{ target: o\.requestId \}\)/);
});

test("kaynak: teslim kontrolü eşitlemenin içinde try ile, sürenin içinde; ürün bağlantısı değişince yenilenir; zil modelsiz", () => {
  const sync = read("src/server/parasut/sync.ts");
  const calls = [...sync.matchAll(/matchSupplierOrders\(/g)].map((m) => m.index!);
  assert.equal(calls.length, 2, "günlük eşitleme ve tedarikçi geçmişi");
  for (const at of calls) {
    const before = sync.slice(Math.max(0, at - 160), at);
    assert.match(before, /try \{\s+reorder = await $/, "try içinde");
    assert.match(sync.slice(Math.max(0, at - 300), at), /if \(Date\.now\(\) - started < deadline - 3_000\)/);
  }
  assert.match(sync, /matchSupplierOrders\(\{ until: started \+ deadline - 1_000 \}\)/);
  const actions = read("src/server/actions/parasut.ts");
  for (const name of ["saveProductLink", "saveProductLinks", "deleteProductLink", "readParasutLines"]) assert.match(bodyOf(actions, name), /recheckOrders\(\)/, name);
  const bell = read("src/server/actions/notifications.ts");
  assert.match(bell, /reorderNotifications\(\)\.catch\(\(\) => \[\]\)/);
  assert.ok(bell.indexOf("reorderNotifications()") > bell.indexOf('if (user.role !== "admin") return'), "personel dalında yok");
  assert.doesNotMatch(bodyOf(read("src/server/data/reorder.ts"), "reorderNotifications"), /loadModel|loadReorderData/);
});

test("yedek ve şema: istek kimliği gizli ad taşımaz (request_id); üç tablo ingredients / invoices'a bağlı (db:reset boşaltır)", () => {
  const schema = read("src/server/db/schema.ts");
  assert.match(schema, /requestId: text\("request_id"\)\.notNull\(\)/);
  assert.doesNotMatch(schema, /text\("token"\)/);
  assert.match(schema, /uniqueIndex\("supplier_orders_invoice_uq"\)\.on\(t\.invoiceId\)\.where\(sql`invoice_id is not null`\)/);
  // Numara birleştirmede yeniden üretilir (R2): dosya adının sonundan bulunur
  const sqlFile = read(`drizzle/${readdirSync(join(process.cwd(), "drizzle")).find((f) => f.endsWith("_mal_siparisi.sql"))}`);
  for (const t of ["reorder_items", "quick_counts", "supplier_orders"]) assert.match(sqlFile, new RegExp(`CREATE TABLE "${t}"`));
  assert.doesNotMatch(sqlFile, /ALTER TABLE "(?!quick_counts|reorder_items|supplier_orders)/, "var olan tablolara dokunulmaz");
});
