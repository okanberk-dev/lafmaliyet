// Haftalık yönetici özeti (pazartesi e-postası; docs/HAFTALIK-OZET.md): hafta hesabı, maddelerin seçimi, gönderim
// kaydının durumu, sabah işinin kararı ve adımı, maddelerin yapıcıları, e-posta ve Ödemeler'deki durum satırı. Saatler
// sabit, veritabanı yok.
// Çalıştırma: npx tsx --test tests/haftalik-ozet.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { buildCashPlan, lineLabel, type CashPlan, type CashPlanInput } from "../src/lib/cash-plan";
import { createModel } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import { businessDate } from "../src/lib/cash-report";
import type { ChecklistLite, IssueLite, RunLite } from "../src/lib/checklists";
import { dailyOutcome, stepTexts } from "../src/lib/job-health";
import {
  claimStateOf,
  isoWeekId,
  nextWeeklyTry,
  parseWeeklyHistory,
  parseWeeklySettings,
  pruneHistory,
  selectItems,
  stepReason,
  weekdayName,
  weekInfo,
  weeklyDecision,
  weeklyRetryText,
  weeklyStep,
  WEEKLY_DEADLINE_MS,
  type WeeklyItem,
  type WeeklySource,
  type WeeklySummary,
} from "../src/lib/weekly/core";
import {
  cashItem,
  checklistDayOf,
  checklistItem,
  commissionItem,
  commissionItems,
  forecastLine,
  karaokeItem,
  kasaItem,
  posPriceItem,
  salesLine,
  stockItem,
  wasteCost,
  wasteItem,
  zamItem,
  type KomisyonCand,
} from "../src/lib/weekly/items";
import { failedText, headlineOf, recipientsText, subjectOf, trendText, weeklyLogText, weeklyStatusText, weekRangeText } from "../src/lib/weekly/text";
import { APP_URL } from "../src/server/notify/digest-template";
import { renderWeekly, WEEKLY_FOOTER } from "../src/server/notify/weekly-template";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";
import type { TaxPlanFeed } from "../src/lib/tax/view";

const NB = " ";
const W44 = weekInfo("2026-10-26");

// ---------------------------------------------------------------- Hafta

test("hafta: ISO hafta, geçen haftanın aralığı, yıl sınırı; gece 04:30 hâlâ pazar", () => {
  assert.deepEqual(W44, { day: "2026-10-26", weekday: 1, id: "2026-W44", prevId: "2026-W43", monday: "2026-10-26", lastFrom: "2026-10-19", lastTo: "2026-10-25" });
  assert.equal(weekInfo("2026-10-28").weekday, 3);
  assert.equal(weekInfo("2026-10-28").monday, "2026-10-26");
  assert.equal(weekInfo("2026-11-01").weekday, 7);
  assert.equal(weekInfo("2026-12-28").id, "2026-W53");
  const jan = weekInfo("2027-01-04");
  assert.equal(jan.id, "2027-W01");
  assert.equal(jan.prevId, "2026-W53");
  assert.deepEqual([jan.lastFrom, jan.lastTo], ["2026-12-28", "2027-01-03"]);
  assert.equal(isoWeekId("2026-01-05"), "2026-W02");
  assert.equal(isoWeekId("2025-12-29"), "2026-W01");
  // İstanbul 04:30 (UTC 01:30): iş günü dün, pazar → W43
  const night = weekInfo(businessDate(new Date("2026-10-26T01:30:00Z")));
  assert.equal(night.day, "2026-10-25");
  assert.equal(night.id, "2026-W43");
  assert.equal(weekInfo(businessDate(new Date("2026-10-26T05:04:00Z"))).id, "2026-W44");
});

test("hafta aralığı metni ve ciro eğilimi", () => {
  assert.equal(weekRangeText("2026-10-19", "2026-10-25"), "19–25 Ekim");
  assert.equal(weekRangeText("2026-10-26", "2026-11-01"), "26 Ekim – 1 Kasım");
  assert.equal(weekRangeText("2026-12-28", "2027-01-03"), "28 Aralık 2026 – 3 Ocak 2027");
  assert.equal(trendText(68_900, 78_300), "önceki 4 haftaya göre %12 az");
  assert.equal(trendText(84_600, 78_300), "önceki 4 haftaya göre %8 fazla");
  assert.equal(trendText(79_000, 78_300), "önceki 4 haftayla aynı");
});

// ---------------------------------------------------------------- Seçim

const item = (source: WeeklySource, tl: number | null, over: Partial<WeeklyItem> = {}): WeeklyItem => ({
  key: `${source}:${tl ?? "x"}`,
  source,
  title: `${source} ${tl ?? ""}`.trim(),
  detail: null,
  tl,
  href: "/panel",
  action: "Bak",
  ...over,
});
const none = { sentToday: new Set<string>(), seenBefore: new Set<string>(), lastWeek: new Set<string>() };
const shape = (xs: WeeklyItem[]) => [xs.filter((x) => x.tl !== null).length, xs.filter((x) => x.tl === null).length];

test("seçim: en çok 5; değersizler sonda en çok 2, varsa biri için yer kalır; doldurma yok", () => {
  const valued7 = (["nakit", "zam", "kasa", "komisyon", "kasa-fiyat", "stok", "zayi"] as const).map((s, i) => item(s, 1000 * (i + 1)));
  const plain3 = [item("karaoke", null), item("kontrol", null), item("zam", null, { key: "zam:fiyat" })];
  assert.deepEqual(shape(selectItems([...valued7, ...plain3], none)), [4, 1]);
  assert.deepEqual(shape(selectItems([item("nakit", 500), item("kasa", 300), item("zayi", 400), item("karaoke", null), item("kontrol", null), item("kasa-fiyat", null)], none)), [3, 2]);
  assert.deepEqual(shape(selectItems([item("karaoke", null), item("kontrol", null), item("kasa", null), item("komisyon", null)], none)), [0, 2]);
  assert.deepEqual(shape(selectItems(valued7.slice(0, 5), none)), [5, 0]);
  assert.deepEqual(shape(selectItems([item("zam", 900), item("karaoke", null)], none)), [1, 1]);
  assert.deepEqual(selectItems([], none), []);
  // Büyükten küçüğe; eşitlikte VALUED_ORDER (nakit, zam, kasa, …); değersizler PLAIN_ORDER (kasa, karaoke, kontrol, …)
  const picked = selectItems([item("zayi", 700), item("kasa", 700), item("nakit", 700), item("zam", 2000), item("kontrol", null), item("karaoke", null)], none);
  assert.deepEqual(
    picked.map((p) => p.source),
    ["zam", "nakit", "kasa", "zayi", "karaoke"],
  );
});

test("seçim: kaynak başına en büyüğü, taban altı düşer, sabah e-postasının bugünkü haberi ve tekrar kuralları", () => {
  const one = selectItems([item("komisyon", 300, { key: "k1" }), item("komisyon", 900, { key: "k2" }), item("komisyon", null, { key: "k3" })], none);
  assert.deepEqual(
    one.map((x) => x.key),
    ["k2"],
  );
  assert.equal(selectItems([item("zam", 99)], none).length, 0);
  assert.equal(selectItems([item("stok", 499)], none).length, 0);
  assert.equal(selectItems([item("stok", 500)], none).length, 1);
  // newsKeys hepsi bugün gittiyse düşer, sıradaki aday geçer; biri gitmediyse kalır
  const k = [item("komisyon", 900, { key: "a", newsKeys: ["komisyon:a"] }), item("komisyon", 400, { key: "b", newsKeys: ["komisyon:b"] })];
  assert.deepEqual(
    selectItems(k, { ...none, sentToday: new Set(["komisyon:a"]) }).map((x) => x.key),
    ["b"],
  );
  const kon = item("kontrol", null, { newsKeys: ["kontrol:2026-10-24", "kontrol:2026-10-25"] });
  assert.equal(selectItems([kon], { ...none, sentToday: new Set(["kontrol:2026-10-25"]) }).length, 1);
  assert.equal(selectItems([kon], { ...none, sentToday: new Set(["kontrol:2026-10-24", "kontrol:2026-10-25"]) }).length, 0);
  // Bir kez gösterilen daha önce gittiyse düşer
  const stock = item("stok", 6200, { key: "stok:2026-09", once: true });
  assert.equal(selectItems([stock], { ...none, seenBefore: new Set(["stok:2026-09"]) }).length, 0);
  // Değersiz madde geçen hafta gittiyse düşer, iki hafta önce gittiyse kalır; değerli madde her hafta yinelenir
  const kar = item("karaoke", null, { key: "karaoke:bos:1-3:14-17" });
  assert.equal(selectItems([kar], { ...none, lastWeek: new Set([kar.key]) }).length, 0);
  assert.equal(selectItems([kar], { ...none, seenBefore: new Set([kar.key]) }).length, 1);
  const zam = item("zam", 4800, { key: "zam:5:4" });
  assert.equal(selectItems([zam], { ...none, lastWeek: new Set([zam.key]), seenBefore: new Set([zam.key]) }).length, 1);
});

// ---------------------------------------------------------------- Kayıt, karar, adım

test("gönderim kaydının durumu", () => {
  const now = Date.parse("2026-10-26T05:10:00Z");
  const at = (min: number) => new Date(now - min * 60_000).toISOString();
  assert.equal(claimStateOf(null, now), "free");
  assert.equal(claimStateOf({ ok: true, error: null, sentAt: at(1) }, now), "sent");
  assert.equal(claimStateOf({ ok: false, error: "Yeniden denenecek: Alıcı adresi geçerli biçimde değil.", sentAt: at(1440) }, now), "retry");
  assert.equal(claimStateOf({ ok: false, error: "Gönderiliyor", sentAt: at(2) }, now), "busy");
  assert.equal(claimStateOf({ ok: false, error: "Gönderiliyor", sentAt: at(10) }, now), "unknown");
  assert.equal(claimStateOf({ ok: false, error: "Gönderim belirsiz: Resend yanıt vermedi", sentAt: at(1) }, now), "unknown");
});

test("karar: canlı, pazartesi–çarşamba, gitmemiş hafta, açık, Resend ve süre", () => {
  const base = { now: 10_000, deadlineAt: 10_000 + 40_000, production: true, week: W44, enabled: true, emailConfigured: true, weekSent: false };
  const st = (o: Partial<typeof base>) => {
    const d = weeklyDecision({ ...base, ...o });
    return d.run ? "run" : d.result.status;
  };
  assert.equal(st({ production: false }), "skip");
  assert.equal(st({ week: weekInfo("2026-10-29") }), "skip");
  assert.equal(st({ enabled: false }), "off");
  assert.equal(st({ emailConfigured: false }), "nokey");
  assert.equal(st({ weekSent: true }), "skip");
  assert.equal(st({ weekSent: true, enabled: false }), "skip");
  assert.equal(st({ now: base.deadlineAt - 8_000 }), "late");
  assert.equal(st({ now: base.deadlineAt - 9_000 }), "run");
  assert.equal(st({ week: weekInfo("2026-10-28") }), "run");
  assert.equal(WEEKLY_DEADLINE_MS, 52_000);
});

test("adım: yalnız çalıştığı gün; kapalı ve Resend yok yalnız pazartesi; geç kalış çarşamba hata; sözcükler", () => {
  assert.deepEqual(weeklyStep({ status: "sent", weekday: 1, items: 4 }), { code: "sent" });
  assert.deepEqual(weeklyStep({ status: "off", weekday: 1 }), { code: "off" });
  assert.equal(weeklyStep({ status: "off", weekday: 2 }), undefined);
  assert.deepEqual(weeklyStep({ status: "nokey", weekday: 1 }), { code: "nokey" });
  assert.equal(weeklyStep({ status: "nokey", weekday: 3 }), undefined);
  assert.equal(weeklyStep({ status: "skip", weekday: 1 }), undefined);
  assert.deepEqual(weeklyStep({ status: "late", weekday: 1 }), { code: "late" });
  assert.deepEqual(weeklyStep({ status: "late", weekday: 3 }), { code: "error", error: "süre yetmedi; bu haftanın özeti gönderilemedi" });
  // Resend'in gerçek iletileri (resendErrorText, sendFailureText): sondaki nokta ve "…yeniden deneyin" öğüdü düşer, sıradaki
  // deneme günün adıyla (ileti ertesi sabahın e-postasında da okunur, "yarın" kayardı)
  assert.deepEqual(weeklyStep({ status: "retry", weekday: 1, error: "Resend şu an yanıt vermiyor; biraz sonra yeniden deneyin." }), {
    code: "error",
    error: "Resend şu an yanıt vermiyor; salı sabahı yeniden denenecek",
  });
  assert.deepEqual(weeklyStep({ status: "retry", weekday: 2, error: "Alıcı adresi geçerli biçimde değil." }), { code: "error", error: "Alıcı adresi geçerli biçimde değil; çarşamba sabahı yeniden denenecek" });
  assert.deepEqual(weeklyStep({ status: "retry", weekday: 3, error: "Resend gönderim kotası doldu; kota yenilenince yeniden deneyin." }), {
    code: "error",
    error: "Resend gönderim kotası doldu; bu hafta gönderilemedi",
  });
  assert.deepEqual(weeklyStep({ status: "uncertain", weekday: 1, error: "Resend yanıt vermedi; e-posta yine de gitmiş olabilir." }), {
    code: "error",
    error: "gönderim belirsiz, e-posta gitmiş olabilir; gelmediyse Ödemeler'den örneği alın",
  });
  assert.equal(stepReason("ornek.com alan adı Resend'de doğrulanmamış; bu adresten e-posta çıkmaz. Doğrulanmış bir gönderen adresi yazın."), "ornek.com alan adı Resend'de doğrulanmamış; bu adresten e-posta çıkmaz. Doğrulanmış bir gönderen adresi yazın");
  assert.deepEqual([1, 2, 3, 0].map(weeklyRetryText), ["salı sabahı yeniden denenecek", "çarşamba sabahı yeniden denenecek", "bu hafta gönderilemedi", "bu hafta gönderilemedi"]);
  assert.deepEqual(weeklyStep({ status: "norecipient", weekday: 1 }), { code: "error", error: "etkin yönetici e-postası yok" });
  // Sabah işinin sonucu: geç kalış iş "Tamam", hata "Kısmen" ve iletisi adımın adıyla
  const core = { sync: { code: "today" }, digest: { code: "sent" }, reminders: { code: "none" }, karaoke: { code: "ok" }, menu: { code: "ok" }, sales: { code: "ok" } };
  assert.equal(dailyOutcome({ ...core, weekly: weeklyStep({ status: "late", weekday: 1 }) }).status, "ok");
  const bad = dailyOutcome({ ...core, weekly: weeklyStep({ status: "norecipient", weekday: 1 }) });
  assert.equal(bad.status, "partial");
  assert.equal(bad.message, "Haftalık özet: etkin yönetici e-postası yok");
  assert.deepEqual(Object.keys(dailyOutcome({ ...core, weekly: weeklyStep({ status: "skip", weekday: 4 }) }).steps), ["digest", "sync", "reminders", "karaoke", "menu", "sales"]);
  assert.deepEqual(stepTexts({ weekly: "sent" }), ["Haftalık özet gönderildi"]);
});

test("ayar ve geçmiş: bozuk değer varsayılana düşer, geçmiş 8 haftayla sınırlı", () => {
  assert.deepEqual(parseWeeklySettings(null), { enabled: true });
  assert.deepEqual(parseWeeklySettings({ enabled: "evet" }), { enabled: true });
  assert.deepEqual(parseWeeklySettings({ enabled: false, by: "Okan", at: "2026-10-24T10:00:00Z" }), { enabled: false, by: "Okan", at: "2026-10-24T10:00:00Z" });
  assert.deepEqual(parseWeeklyHistory("bozuk"), { weeks: {} });
  const h = parseWeeklyHistory({ weeks: { "2026-W44": { at: "2026-10-26T05:04:00Z", subject: "S", keys: ["zam:5:4", 3] }, yanlis: { at: "x" }, "2026-W43": { subject: "eksik an" } } });
  assert.deepEqual(h, { weeks: { "2026-W44": { at: "2026-10-26T05:04:00Z", subject: "S", keys: ["zam:5:4"] } } });
  const many = { weeks: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`2026-W${String(30 + i).padStart(2, "0")}`, { at: "a", subject: "", keys: [] }])) };
  assert.deepEqual(Object.keys(pruneHistory(many, "2026-W34").weeks), ["2026-W34", "2026-W35", "2026-W36", "2026-W37", "2026-W38", "2026-W39", "2026-W40", "2026-W41"]);
  assert.equal(Object.keys(pruneHistory(many, "2026-W00").weeks).length, 8);
});

// ---------------------------------------------------------------- Maddeler

test("zam: boylar toplanır, en büyük (ürün, hammadde) çifti; satış ayı yoksa değersiz", () => {
  const input = {
    basisMonth: "2026-09",
    actionable: 6,
    title: "Hammadde zammı: 6 ürünün fiyatına bakın",
    products: [
      { productId: 5, name: "Latte", monthly: 3000, drivers: [{ ingredientId: 4, name: "Süt %2,5", monthly: 2600 }, { ingredientId: 9, name: "Espresso çekirdeği", monthly: 400 }] },
      { productId: 6, name: "Latte", monthly: 2600, drivers: [{ ingredientId: 4, name: "Süt %2,5", monthly: 2200 }, { ingredientId: 9, name: "Espresso çekirdeği", monthly: 400 }] },
      { productId: 8, name: "Americano", monthly: 2250, drivers: [{ ingredientId: 9, name: "Espresso çekirdeği", monthly: 2250 }] },
    ],
  };
  const z = zamItem(input)!;
  assert.equal(z.title, `Latte: Süt %2,5 zammı ayda ≈ 4.800${NB}₺ kâr kaybı`);
  assert.equal(z.detail, `Zamlar toplam ayda ≈ 7.850${NB}₺ · 6 ürünün fiyatına bakın · Eylül 2026 satışlarıyla`);
  assert.equal(z.key, "zam:5:4");
  assert.equal(z.tl, 4800);
  assert.equal(z.href, "/panel/urunler#zamlar");
  // Toplam çiftle aynıysa yinelenmez
  assert.equal(zamItem({ ...input, actionable: 1, products: [input.products[2]] })!.detail, "1 ürünün fiyatına bakın · Eylül 2026 satışlarıyla");
  assert.equal(zamItem({ ...input, products: [{ productId: 5, name: "Latte", monthly: 80, drivers: [{ ingredientId: 4, name: "Süt %2,5", monthly: 80 }] }] }), null);
  const plain = zamItem({ basisMonth: null, actionable: 3, title: "Hammadde zammı: 3 ürünün fiyatına bakın", products: [] })!;
  assert.equal(plain.title, "Hammadde zammı: 3 ürünün fiyatına bakın");
  assert.equal(plain.tl, null);
  assert.equal(plain.key, "zam:fiyat");
  assert.equal(zamItem({ basisMonth: null, actionable: 0, title: "", products: [] }), null);
});

test("nakit: bakiye son 7 günde, eksi gün 14 gün içinde; en büyük iki gider; bakiye yaşı", () => {
  const neg = (date: string) => ({ date, balance: -12_400, top: [{ title: "Kira", amount: 160_000 }, { title: "Maaşlar (Ekim, tahmini)", amount: 60_000 }] });
  const base = { today: "2026-10-26", opening: { staleDays: 2 }, firstNegative: neg("2026-11-01") };
  assert.equal(cashItem({ ...base, opening: null }), null);
  assert.equal(cashItem({ ...base, opening: { staleDays: 9 } }), null);
  assert.equal(cashItem({ ...base, firstNegative: neg("2026-11-09") }), null);
  assert.ok(cashItem({ ...base, firstNegative: neg("2026-11-08") }));
  const c = cashItem(base)!;
  assert.equal(c.title, `1 Kasım Pazar para yetmeyebilir: tahmini −12.400${NB}₺`);
  assert.equal(c.detail, `O gün: Kira 160.000${NB}₺, Maaşlar (Ekim, tahmini) 60.000${NB}₺`);
  assert.equal(c.tl, 12_400);
  assert.equal(c.key, "nakit:2026-11-01");
  assert.equal(c.href, "/panel/hatirlaticilar/nakit");
  assert.equal(cashItem({ ...base, opening: { staleDays: 5 } })!.detail, `O gün: Kira 160.000${NB}₺, Maaşlar (Ekim, tahmini) 60.000${NB}₺ · bakiye 5 gün önce girildi`);
});

const rep = (date: string, cashDiff: number, zTotal = 10_000) => ({ date, zTotal, cashDiff });

test("kasa: geçen haftanın eksikleri, fazla gün ve bütünlük işaretleri; bağlantı en çok eksik günün ayına", () => {
  const reports = [rep("2026-10-19", -300), rep("2026-10-23", -340), rep("2026-10-24", 50), rep("2026-10-25", -0.5), rep("2026-10-12", -900)];
  const k = kasaItem({ week: W44, reports, carryMismatch: null, lateEdits: null, photoDiffs: null })!;
  assert.equal(k.title, `Kasa geçen hafta 2 gün eksik: toplam 640${NB}₺`);
  assert.equal(k.detail, `En çok 23 Ekim Cuma: 340${NB}₺ · 1 gün fazla: 50${NB}₺`);
  assert.equal(k.tl, 640);
  assert.equal(k.href, "/panel/kasa?ay=2026-10");
  const flagged = kasaItem({ week: W44, reports, carryMismatch: 1, lateEdits: 1, photoDiffs: 0 })!;
  assert.equal(flagged.detail, `En çok 23 Ekim Cuma: 340${NB}₺ · 1 gün fazla: 50${NB}₺ · 1 gün açılış devirle tutmuyor · 1 rapor ertesi gün düzeltildi`);
  assert.equal(kasaItem({ week: W44, reports: [rep("2026-10-20", -640)], carryMismatch: 0, lateEdits: 0, photoDiffs: 0 })!.title, `20 Ekim Salı kasası 640${NB}₺ eksik`);
  const flags = kasaItem({ week: W44, reports: [rep("2026-10-20", -40)], carryMismatch: 2, lateEdits: null, photoDiffs: 1 })!;
  assert.equal(flags.title, "Geçen hafta kasa: 2 gün açılış devirle tutmuyor");
  assert.equal(flags.detail, "1 raporda tutar fotoğraftan farklı");
  assert.equal(flags.tl, null);
  assert.equal(kasaItem({ week: W44, reports: [rep("2026-10-20", -40)], carryMismatch: null, lateEdits: null, photoDiffs: null }), null);
  // Ay sınırında: en çok eksik günün ayı
  const wk = weekInfo("2026-11-02");
  assert.equal(kasaItem({ week: wk, reports: [rep("2026-10-30", -500), rep("2026-11-01", -100)], carryMismatch: 0, lateEdits: 0, photoDiffs: 0 })!.href, "/panel/kasa?ay=2026-10");
});

/** `from`'dan başlayan `n` günün raporları, toplamı `total` */
const weekReports = (from: string, n: number, total: number) => Array.from({ length: n }, (_, i) => rep(new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), 0, total / n));

test("kasa cirosu satırı: tam haftalar karşılaştırılır; eksik hafta gün sayısıyla; rapor yoksa satır yok", () => {
  const prev = ["2026-10-12", "2026-10-05", "2026-09-28", "2026-09-21"].flatMap((d) => weekReports(d, 7, 78_300));
  assert.equal(salesLine({ week: W44, reports: [...weekReports("2026-10-19", 7, 68_900), ...prev] }), `Geçen hafta kasa cirosu 68.900${NB}₺ · önceki 4 haftaya göre %12 az`);
  assert.equal(salesLine({ week: W44, reports: [...weekReports("2026-10-19", 5, 54_200), ...prev] }), `Geçen hafta kasa cirosu 54.200${NB}₺ (5 gün raporlu)`);
  assert.equal(salesLine({ week: W44, reports: [...weekReports("2026-10-19", 7, 68_900), ...weekReports("2026-10-12", 7, 70_000)] }), `Geçen hafta kasa cirosu 68.900${NB}₺`);
  assert.equal(salesLine({ week: W44, reports: [...weekReports("2026-10-19", 7, 79_000), ...prev] }), `Geçen hafta kasa cirosu 79.000${NB}₺ · önceki 4 haftayla aynı`);
  assert.equal(salesLine({ week: W44, reports: prev }), null);
});

test("kasa cirosu satırı ödenmezi saymaz: Genel bakış ve Bugün'ün cirosuyla aynı kural (HM-08)", () => {
  // Z 10.000; 500 ₺ ödenmez Z'nin içinde (nakit 3.500 + kart 6.000): günün cirosu 9.500
  assert.equal(salesLine({ week: W44, reports: [{ date: "2026-10-20", zTotal: 10_000, revenue: 9_500, cashDiff: 0 }] }), `Geçen hafta kasa cirosu 9.500${NB}₺ (1 gün raporlu)`);
  // Toplayıcı satıra dayRevenue'nun cirosunu verir
  const collect = readFileSync(join(process.cwd(), "src/server/weekly/collect.ts"), "utf8");
  assert.match(collect, /revenue: dayRevenue\(\{ zTotal: r\.zTotal, offRevenue: r\.offRevenue, payments: Math\.round\(\(r\.cash \+ r\.card \+ r\.mealCard \+ r\.online \+ r\.other\) \* 100\) \/ 100 \}\)\.revenue,/);
});

const cand = (o: Partial<KomisyonCand>): KomisyonCand => ({
  alertKey: "gecikti:pluxee:2026-10",
  kind: "gecikti",
  label: "Pluxee",
  month: "2026-10",
  href: "/panel/komisyonlar?ay=2026-10#pluxee",
  tl: 8605.2,
  due: "2026-11-30",
  rate: null,
  lineText: null,
  ...o,
});

test("komisyon: geciken hakediş, %6 aşımı, komisyon dışı ücret; en büyüğü ve öteki konular", () => {
  const late = commissionItem([cand({})])!;
  assert.equal(late.title, `Hakediş gecikti: Pluxee (Ekim) · ≈ 8.605${NB}₺`);
  assert.equal(late.detail, "Son gün 30 Kasım Pazartesi · geldiyse Komisyon & hakediş'te işaretleyin");
  assert.equal(late.href, "/panel/komisyonlar?ay=2026-10#pluxee");
  assert.deepEqual(late.newsKeys, ["komisyon:gecikti:pluxee:2026-10"]);
  assert.equal(late.key, "komisyon:gecikti:pluxee:2026-10");
  assert.equal(commissionItem([cand({ alertKey: "oran:pluxee:2026-10:64", kind: "oran", tl: 26, rate: 0.064 })]), null);
  const unknown = commissionItem([cand({ tl: null })])!;
  assert.equal(unknown.tl, null);
  assert.equal(unknown.title, "Hakediş gecikti: Pluxee (Ekim)");
  const three = [
    cand({ alertKey: "oran:setcard:2026-09:64", kind: "oran", label: "Set Kart", month: "2026-09", tl: 240, rate: 0.064 }),
    cand({}),
    cand({ alertKey: "yasak:multinet:2026-10:12", kind: "yasak", label: "Multinet", tl: 150, lineText: `“POS Cihaz Kira Bedeli” 150${NB}₺` }),
  ];
  const all = commissionItems(three);
  assert.deepEqual(
    all.map((i) => i.key),
    ["komisyon:gecikti:pluxee:2026-10", "komisyon:oran:setcard:2026-09:64", "komisyon:yasak:multinet:2026-10:12"],
  );
  assert.ok(all[0].detail!.endsWith(" · 2 konu daha"));
  assert.equal(all[1].title, `Set Kart Eylül: kesinti %6,4 · sınırın üstünde 240${NB}₺`);
  assert.equal(all[1].detail, "Yemek kartında yasal üst sınır %6 · 2 konu daha");
  assert.equal(all[2].title, `Multinet Ekim: komisyon dışı ücret olabilir · 150${NB}₺`);
  assert.equal(all[2].detail, `“POS Cihaz Kira Bedeli” 150${NB}₺ · 2 konu daha`);
  assert.equal(commissionItems([three[2], { ...three[2], alertKey: "yasak:multinet:2026-09:3", month: "2026-09", lineText: null }])[1].detail, "Faturada komisyon dışı kalem var · 1 konu daha");
  const group = commissionItem([cand({ alertKey: "oran:yemek-kartlari:2026-10:65", kind: "oran", label: "Yemek kartları", group: true, tl: 300, rate: 0.065 })])!;
  assert.equal(group.title, `Yemek kartları Ekim: ortalama kesinti %6,5 · sınırın üstünde 300${NB}₺`);
});

test("ModPOS'ta eski fiyat: KDV hariç fark × ayda adet; indirim yalnız sayıda; değersiz hatırlatma 3 günden", () => {
  const latte = { label: "Latte M", price: 195, posPrice: 185, since: "2026-10-20", perMonth: 310 };
  const cookie = { label: "Cookie", price: 50, posPrice: 55, since: "2026-10-22", perMonth: 120 };
  const p = posPriceItem({ today: "2026-10-26", kdv: 0.1, rows: [latte, cookie] })!;
  assert.equal(p.title, `ModPOS'ta 2 ürün eski fiyatla: ayda ≈ 2.818${NB}₺ kâr kaybı`);
  assert.equal(p.detail, `En çok Latte M: kasada 185${NB}₺, menüde 195${NB}₺ · 6 gündür bekliyor`);
  assert.equal(Math.round(p.tl!), 2818);
  assert.equal(p.href, "/panel/urunler/fiyatlar?sekme=kasa");
  const plain = posPriceItem({ today: "2026-10-26", kdv: 0.1, rows: [{ ...latte, perMonth: null, since: "2026-10-22" }, { ...cookie, perMonth: null }] })!;
  assert.equal(plain.title, "ModPOS'ta 2 fiyat değişecek");
  assert.equal(plain.tl, null);
  assert.equal(posPriceItem({ today: "2026-10-26", kdv: 0.1, rows: [{ ...latte, perMonth: null, since: "2026-10-24" }] }), null);
  assert.equal(posPriceItem({ today: "2026-10-26", kdv: 0.1, rows: [] }), null);
});

const waste = (date: string, name: string, cost: number) => ({ date, name, cost });
const lastWeekWaste = [
  waste("2026-10-19", "Latte M", 180),
  waste("2026-10-20", "Cookie", 170),
  waste("2026-10-21", "Brownie", 160),
  waste("2026-10-22", "Süt %2,5", 150),
  waste("2026-10-23", "Cheesecake", 130),
  waste("2026-10-25", "Limonata", 110),
];

test("zayi ve ikram: önceki dört haftanın ortalamasının 1,5 katı ve en az 300 ₺", () => {
  const prev = [waste("2026-10-14", "Latte M", 400), waste("2026-10-07", "Cookie", 400), waste("2026-09-30", "Brownie", 400), waste("2026-09-23", "Su", 400), waste("2026-09-15", "Eski", 9_999)];
  const w = wasteItem({ week: W44, entries: [...lastWeekWaste, ...prev] })!;
  assert.equal(w.title, `Geçen hafta zayi ve ikram 900${NB}₺`);
  assert.equal(w.detail, `Malzeme maliyeti · önceki 4 haftada ortalama 400${NB}₺ · en çok Latte M: 180${NB}₺`);
  assert.equal(w.href, "/panel/zayi?ay=2026-10");
  assert.equal(wasteItem({ week: W44, entries: [waste("2026-10-20", "Latte M", 500), ...prev] }), null);
  assert.equal(wasteItem({ week: W44, entries: [waste("2026-10-20", "Latte M", 250)] }), null);
  assert.equal(wasteItem({ week: W44, entries: lastWeekWaste })!.detail, `Malzeme maliyeti · önceki 4 haftada kayıt yok · en çok Latte M: 180${NB}₺`);
});

test("zayi maliyeti motorun kuralıyla: bir ayın kayıtlarının toplamı wasteSummary'ninkiyle aynı (Excel verisi)", () => {
  const data: ExcelData = JSON.parse(readFileSync(join(__dirname, "..", "src/server/db/seed/excel-data.json"), "utf8"));
  const base = excelToDataset(data);
  const product = base.products.find((p) => p.name === "Latte")!;
  const milk = base.ingredients.find((i) => i.name === "Süt %2,5")!;
  const entries: Dataset["wasteEntries"] = [
    { date: "2026-09-03", kind: "zayi", productId: product.id, ingredientId: null, qty: 2, factor: 1 },
    { date: "2026-09-10", kind: "ikram", productId: product.id, ingredientId: null, qty: 1, factor: 1 },
    { date: "2026-09-12", kind: "zayi", productId: null, ingredientId: milk.id, qty: 1.5, factor: 1000 },
    { date: "2026-10-01", kind: "zayi", productId: null, ingredientId: milk.id, qty: 1, factor: 1000 },
  ];
  const model = createModel({ ...base, wasteEntries: entries });
  const ws = model.wasteSummary("2026-09");
  const sum = entries!.filter((e) => e.date.startsWith("2026-09")).reduce((a, e) => a + wasteCost(model, e), 0);
  assert.ok(ws.zayi.cost + ws.ikram.cost > 0);
  assert.ok(Math.abs(sum - (ws.zayi.cost + ws.ikram.cost)) < 1e-6);
});

test("stok farkı: en az 500 ₺, bir kez; karşılaştırılamayan ay yok", () => {
  const s = stockItem({ month: "2026-10", comparable: true, unexplained: 6200, top: { name: "Süt %2,5", amount: 1900 } })!;
  assert.equal(s.title, `Ekim sayımında 6.200${NB}₺ açıklanamayan stok farkı`);
  assert.equal(s.detail, `En çok Süt %2,5: 1.900${NB}₺ · kayıtlı zayi ve ikram düşüldü`);
  assert.equal(s.once, true);
  assert.equal(s.key, "stok:2026-10");
  assert.equal(s.href, "/panel/tutarlilik?ay=2026-10");
  assert.equal(stockItem({ month: "2026-10", comparable: true, unexplained: 400, top: null }), null);
  assert.equal(stockItem({ month: "2026-10", comparable: false, unexplained: 6200, top: null }), null);
});

test("karaoke: son 4 haftanın en boş bloğu %25'ten azsa", () => {
  const block = { key: "1-3:14-17", where: "Salı–Perşembe 14–17", ratio: 0.12 };
  const k = karaokeItem({ ready: true, overall: 0.38, block })!;
  assert.equal(k.title, "Salı–Perşembe 14–17 karaoke %12 dolu");
  assert.equal(k.detail, "Son 4 haftanın en boş saatleri · genel doluluk %38");
  assert.equal(k.key, "karaoke:bos:1-3:14-17");
  assert.equal(k.tl, null);
  assert.equal(karaokeItem({ ready: true, overall: 0.38, block: { ...block, ratio: 0.3 } }), null);
  assert.equal(karaokeItem({ ready: false, overall: 0.38, block }), null);
});

const issue = (o: Partial<IssueLite>): IssueLite => ({
  answerId: 1,
  itemId: 1,
  label: "Bar buzdolabı",
  text: "Bar buzdolabı: 6 °C (0–4 °C)",
  note: "Ayşe söyledi, kapı açık kalmış",
  by: "Ayşe Yılmaz",
  at: "2026-10-21T20:00:00Z",
  open: true,
  versions: 0,
  kind: "range",
  ...o,
});
const run = (complete: boolean, issues: IssueLite[] = []): RunLite => ({
  required: 10,
  done: complete ? 10 : 6,
  complete,
  photosLeft: 0,
  photos: 0,
  missing: complete ? [] : ["Kahve makinesi temizliği"],
  issues,
  contributors: ["Ayşe Yılmaz", "Mehmet Demir"],
  firstAt: null,
  lastAt: null,
  completedAt: null,
});
const list = (name: string, r: RunLite | null): ChecklistLite => ({ templateId: 1, name, opensAt: "22:00", dueAt: "02:00", required: 10, photos: 0, staffAllowed: true, run: r });

test("kontrol listeleri: yapılmayan liste ve sorunlar; kasa raporu olmayan gün sayılmaz; kişi adı ve not gitmez", () => {
  const two = checklistItem({
    week: W44,
    days: [checklistDayOf("2026-10-19", true, [list("Kapanış", null), list("Açılış", run(true))]), checklistDayOf("2026-10-20", true, [list("Kapanış", run(false))])],
  })!;
  assert.equal(two.title, "Geçen hafta 2 kapanış listesi yapılmadı");
  assert.equal(two.detail, null);
  assert.deepEqual(two.newsKeys, ["kontrol:2026-10-19", "kontrol:2026-10-20"]);
  assert.equal(two.href, "/panel/kontrol/gecmis");
  const mixed = checklistItem({
    week: W44,
    days: [
      checklistDayOf("2026-10-19", true, [list("Kapanış", null)]),
      checklistDayOf("2026-10-21", true, [list("Açılış", null), list("Kapanış", run(true, [issue({})]))]),
      checklistDayOf("2026-10-22", true, [list("Kapanış listesi", null)]),
    ],
  })!;
  assert.equal(mixed.title, "Geçen hafta 3 kontrol listesi yapılmadı");
  assert.equal(mixed.detail, "Ayrıca 1 sorunlu kayıt (ör. Bar buzdolabı: 6 °C (0–4 °C))");
  const issues = checklistItem({
    week: W44,
    days: [
      checklistDayOf("2026-10-23", true, [list("Kapanış", run(true, [issue({}), issue({ kind: "issue", label: "Buz makinesi", text: "Buz makinesi: Ayşe su kaçırıyor dedi" })]))]),
      checklistDayOf("2026-10-24", false, [list("Kapanış", null)]),
    ],
  })!;
  assert.equal(issues.title, "Geçen hafta kontrol listelerinde 2 sorun");
  assert.equal(issues.detail, "ör. Bar buzdolabı: 6 °C (0–4 °C) · kasa raporu olmayan 1 gün sayılmadı");
  assert.deepEqual(issues.newsKeys, ["kontrol:2026-10-23"]);
  // "Sorun var"ın notu (serbest metin) yazılmaz; yanıt verenler ve notlar hiçbir yerde yok
  const day = checklistDayOf("2026-10-23", true, [list("Kapanış", run(false, [issue({ kind: "issue", label: "Buz makinesi", text: "Buz makinesi: Ayşe su kaçırıyor dedi" })]))]);
  assert.deepEqual(day.issues, [{ label: "Buz makinesi", text: "Buz makinesi: sorun" }]);
  for (const x of [two, mixed, issues, day]) assert.doesNotMatch(JSON.stringify(x), /Ayşe|Mehmet|Yılmaz|Demir/);
  // Yalnız kasa raporu olmayan günler: madde yok
  assert.equal(checklistItem({ week: W44, days: [checklistDayOf("2026-10-24", false, [list("Kapanış", null)])] }), null);
  assert.equal(checklistItem({ week: W44, days: [checklistDayOf("2026-10-24", true, [list("Kapanış", run(true))])] }), null);
});

test("satış tahmini satırı: kendi verisi varsa; kapalı gün toplamaz", () => {
  const amounts = [8_000, 8_500, 9_000, 10_000, 12_000, 14_500, 10_000];
  const dates = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];
  const days = amounts.map((amount, i) => ({ date: dates[i], amount, closed: false }));
  assert.equal(forecastLine({ quality: "tam", days }), `Önümüzdeki 7 gün beklenen satış ≈ 72.000${NB}₺ · en yoğun gün Cumartesi`);
  assert.equal(forecastLine({ quality: "karma", days: days.map((d, i) => (i === 5 ? { ...d, closed: true } : d)) }), `Önümüzdeki 7 gün beklenen satış ≈ 57.500${NB}₺ · en yoğun gün Cuma`);
  assert.equal(forecastLine({ quality: "ay", days }), null);
  assert.equal(forecastLine({ quality: "yok", days }), null);
});

// ---------------------------------------------------------------- E-posta ve metinler

const summary = (items: WeeklyItem[], over: Partial<WeeklySummary> = {}): WeeklySummary => ({ week: W44, items, lines: [], failed: [], ...over });
const five = [
  item("nakit", 12_400, { title: `1 Kasım Pazar para yetmeyebilir: tahmini −12.400${NB}₺`, href: "/panel/hatirlaticilar/nakit", action: "Nakit planını aç", detail: "O gün: Kira" }),
  item("zam", 4800, { title: `Latte: Süt %2,5 zammı ayda ≈ 4.800${NB}₺ kâr kaybı`, href: "/panel/urunler#zamlar", action: "Fiyatlara bak" }),
  item("komisyon", 3200, { title: "Hakediş gecikti: Trendyol Go (Eylül)", href: "/panel/komisyonlar?ay=2026-09#trendyol", action: "Komisyon & hakedişe bak" }),
  item("kasa", 640, { title: "Kasa <script>alert(1)</script>", href: "/panel/kasa?ay=2026-10", action: "Kasa raporlarına bak" }),
  item("karaoke", null, { title: "Salı–Perşembe 14–17 karaoke %12 dolu", href: "/panel/karaoke/doluluk", action: "Doluluğa bak" }),
];

test("e-posta: konu, başlık, bağlantılar, kaçış, alt not, düz metin, okunamayanlar, sakin hafta", () => {
  const r = renderWeekly(summary(five, { lines: ["Geçen hafta kasa cirosu 68.900 ₺ · önceki 4 haftaya göre %12 az"] }), { today: "2026-10-26" });
  assert.equal(r.subject, `Haftalık özet: 1 Kasım Pazar para yetmeyebilir: tahmini −12.400${NB}₺ · +4 madde`);
  for (const i of five) assert.equal(r.html.split(`href="${APP_URL}${i.href}"`).length - 1, 2, i.href);
  assert.ok(r.html.includes("Kasa &lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(!r.html.includes("<script>"));
  assert.ok(r.html.includes(">Bu hafta bakmanız gereken 5 konu</h1>"));
  assert.ok(r.html.includes("Haftalık özet · 19–25 Ekim"));
  assert.ok(r.html.includes(WEEKLY_FOOTER.replace("&", "&amp;")));
  assert.ok(!r.html.includes("bildirim adreslerine gönderildi"));
  assert.ok(r.html.includes("Maddeler kasanıza etkisine göre sıralandı; ≈ işaretli tutarlar tahmindir."));
  assert.ok(r.html.includes(`href="${APP_URL}/panel"`));
  assert.ok(r.text.startsWith("L'Affogato · Haftalık özet · 19–25 Ekim\n"));
  assert.ok(r.text.includes(`\n2. Latte: Süt %2,5 zammı ayda ≈ 4.800${NB}₺ kâr kaybı\n   Fiyatlara bak: ${APP_URL}/panel/urunler#zamlar\n`));
  assert.ok(r.text.includes(`\n1. 1 Kasım Pazar para yetmeyebilir: tahmini −12.400${NB}₺\n   O gün: Kira\n   Nakit planını aç: ${APP_URL}/panel/hatirlaticilar/nakit\n`));
  assert.ok(r.text.endsWith(`Paneli aç: ${APP_URL}/panel`));
  // Panel dışı yol panelin girişine
  const odd = renderWeekly(summary([item("zam", 900, { href: "https://kotu.example/x" })]), { today: "2026-10-26" });
  assert.ok(!odd.html.includes("kotu.example"));
  // Tek madde: ek yok; örnek: başta "Örnek · " ve uyarı satırı
  assert.equal(subjectOf(summary(five.slice(1, 2))), `Haftalık özet: Latte: Süt %2,5 zammı ayda ≈ 4.800${NB}₺ kâr kaybı`);
  const sample = renderWeekly(summary(five.slice(0, 2)), { today: "2026-10-27", sample: true });
  assert.ok(sample.subject.startsWith("Örnek · Haftalık özet: "));
  assert.ok(sample.html.includes("Örnek · Haftalık özet · 19–25 Ekim"));
  assert.ok(sample.html.includes("Bu bir örnektir; asıl özet pazartesi sabahı gider."));
  // Sakin hafta ve okunamayanlar
  const quiet = renderWeekly(summary([], { failed: ["nakit", "karaoke"] }), { today: "2026-10-26" });
  assert.equal(quiet.subject, "Haftalık özet: bu hafta dikkat isteyen bir şey yok");
  assert.ok(quiet.html.includes("Paneldeki kontrollerde bu hafta öne çıkan bir şey yok."));
  assert.ok(quiet.html.includes(">Bu hafta dikkat isteyen bir şey yok</h1>"));
  assert.ok(quiet.html.includes("Bu hafta okunamadı: nakit planı, karaoke doluluğu."));
  assert.ok(!quiet.html.includes("Maddeler kasanıza"));
  assert.equal(failedText([]), null);
  assert.equal(headlineOf(summary(five.slice(0, 1))), "Bu hafta bakmanız gereken 1 konu");
  // Uzun başlık kısalır, madde sayısı kalır
  const long = subjectOf(summary([item("zam", 900, { title: "x".repeat(300) }), item("nakit", 800)]));
  assert.equal(long.length, 150);
  assert.ok(long.endsWith("… · +1 madde"));
});

test("Ödemeler'deki durum satırı ve alıcılar", () => {
  // Salı 12:00 (İstanbul): salının sabah işi geçti
  const now = Date.parse("2026-10-27T09:00:00Z");
  const base = { enabled: true, week: weekInfo("2026-10-27"), row: null, lastSentAt: null, now, hourTR: 12 };
  assert.equal(weeklyStatusText({ ...base, enabled: false }), "Kapalı: pazartesi e-postası gitmez.");
  assert.equal(weeklyStatusText({ ...base, row: { ok: true, error: null, sentAt: "2026-10-26T05:04:00Z" } }), "Bu hafta gönderildi · 26.10.2026 08:04");
  assert.equal(weeklyStatusText({ ...base, weekSentAt: "2026-10-26T05:04:00Z" }), "Bu hafta gönderildi · 26.10.2026 08:04");
  const retry = { ok: false, error: "Yeniden denenecek: Alıcı adresi geçerli biçimde değil.", sentAt: "2026-10-26T05:04:00Z" };
  // Pazartesi reddedildi, salının işi kayda dokunmadı (süre yetmedi): sıradaki çarşamba
  assert.equal(weeklyStatusText({ ...base, row: retry, rowDay: "2026-10-26" }), "Pazartesi gönderilemedi; çarşamba sabahı yeniden denenecek.");
  // Pazartesi öğleden sonra: salı; salı 06:00 (iş günü salı, işten önce): bu sabah; salı 02:00 (iş günü hâlâ pazartesi): salı
  const mon = { ...base, week: weekInfo("2026-10-26"), row: retry, rowDay: "2026-10-26" };
  assert.equal(weeklyStatusText({ ...mon, hourTR: 14 }), "Pazartesi gönderilemedi; salı sabahı yeniden denenecek.");
  assert.equal(weeklyStatusText({ ...base, row: retry, rowDay: "2026-10-26", hourTR: 6 }), "Pazartesi gönderilemedi; bu sabah yeniden denenecek.");
  assert.equal(weeklyStatusText({ ...mon, hourTR: 2 }), "Pazartesi gönderilemedi; salı sabahı yeniden denenecek.");
  // Çarşamba işten önce bir deneme daha var; çarşamba reddedildiyse (ya da 09:00 geçtiyse) bu hafta bitti
  const wed = { ...base, week: weekInfo("2026-10-28"), row: { ...retry, sentAt: "2026-10-27T05:04:00Z" }, rowDay: "2026-10-27" };
  assert.equal(weeklyStatusText({ ...wed, hourTR: 7 }), "Salı gönderilemedi; bu sabah yeniden denenecek.");
  assert.equal(weeklyStatusText({ ...wed, hourTR: 10 }), "Bu hafta gönderilemedi.");
  assert.equal(weeklyStatusText({ ...wed, rowDay: "2026-10-28", hourTR: 8 }), "Bu hafta gönderilemedi.");
  // Perşembe: aynı haftanın kaydı, deneme kalmadı
  assert.equal(weeklyStatusText({ ...wed, week: weekInfo("2026-10-29"), rowDay: "2026-10-28", hourTR: 7 }), "Bu hafta gönderilemedi.");
  // Kayıt yazmadan biten gün (sabah işinin adımı): nedeniyle
  assert.equal(weeklyStatusText({ ...base, lastStep: { day: "2026-10-26", code: "late" } }), "Pazartesi gönderilemedi (süre yetmedi); çarşamba sabahı yeniden denenecek.");
  assert.equal(weeklyStatusText({ ...base, lastStep: { day: "2026-10-26", code: "late" }, hourTR: 6 }), "Pazartesi gönderilemedi (süre yetmedi); bu sabah yeniden denenecek.");
  assert.equal(weeklyStatusText({ ...base, lastStep: { day: "2026-10-27", code: "error" } }), "Salı gönderilemedi; çarşamba sabahı yeniden denenecek.");
  assert.equal(weeklyStatusText({ ...mon, row: null, rowDay: null, lastStep: { day: "2026-10-26", code: "nokey" } }), "Pazartesi gönderilemedi (Resend kurulmadı); salı sabahı yeniden denenecek.");
  assert.equal(weeklyStatusText({ ...wed, row: null, rowDay: null, lastStep: { day: "2026-10-28", code: "error" }, hourTR: 10 }), "Bu hafta gönderilemedi.");
  // Pazartesi reddedildi, salının işi kayıt yazmadan bitti: salı 08:30'da "bu sabah" değil, salının nedeni ve çarşamba
  assert.equal(
    weeklyStatusText({ ...base, row: retry, rowDay: "2026-10-26", lastStep: { day: "2026-10-27", code: "late" }, hourTR: 8 }),
    "Salı gönderilemedi (süre yetmedi); çarşamba sabahı yeniden denenecek.",
  );
  assert.equal(
    weeklyStatusText({ ...base, row: retry, rowDay: "2026-10-26", lastStep: { day: "2026-10-27", code: "nokey" }, hourTR: 12 }),
    "Salı gönderilemedi (Resend kurulmadı); çarşamba sabahı yeniden denenecek.",
  );
  assert.equal(weeklyStatusText({ ...wed, row: retry, rowDay: "2026-10-26", lastStep: { day: "2026-10-28", code: "error" }, hourTR: 8 }), "Bu hafta gönderilemedi.");
  // Reddin kendi adımı (aynı gün) kaydın gününü değiştirmez
  assert.equal(weeklyStatusText({ ...wed, lastStep: { day: "2026-10-27", code: "error" }, hourTR: 7 }), "Salı gönderilemedi; bu sabah yeniden denenecek.");
  // Pazar (ve pazartesi 05:00'ten önce, iş günü hâlâ pazar): sıradaki pazartesi öbür haftanın
  const sun = { ...wed, week: weekInfo("2026-11-01"), rowDay: "2026-10-28" };
  assert.equal(weeklyStatusText({ ...sun, hourTR: 14 }), "Bu hafta gönderilemedi.");
  assert.equal(weeklyStatusText({ ...sun, hourTR: 2 }), "Bu hafta gönderilemedi.");
  // Gönderim ya da kapalı adım satırı değiştirmez; kaydın durumu adımdan önce gelir
  assert.equal(weeklyStatusText({ ...base, lastStep: { day: "2026-10-26", code: "toString" } }), "Henüz gönderilmedi · ilk özet çarşamba sabahı gider");
  assert.equal(
    weeklyStatusText({ ...base, row: { ok: false, error: "Gönderim belirsiz: Resend yanıt vermedi", sentAt: "2026-10-26T05:04:00Z" }, lastStep: { day: "2026-10-26", code: "error" } }),
    "Bu haftaki gönderim yarıda kaldı; e-posta gelmediyse “Örneği bana gönder” ile alabilirsiniz.",
  );
  assert.equal(weeklyStatusText({ ...base, row: { ok: false, error: "Gönderiliyor", sentAt: "2026-10-26T05:04:00Z" } }), "Bu haftaki gönderim yarıda kaldı; e-posta gelmediyse “Örneği bana gönder” ile alabilirsiniz.");
  assert.equal(weeklyStatusText({ ...base, row: { ok: false, error: "Gönderiliyor", sentAt: new Date(now - 60_000).toISOString() } }), "Bu haftaki özet şu an gönderiliyor.");
  // Bu hafta henüz yok: sıradaki sabah bu haftanın özeti gider (hafta içinde açıldı ya da o gün denenmedi)
  const sent = "2026-10-19T05:03:00Z";
  assert.equal(weeklyStatusText({ ...base, lastSentAt: sent }), "Son gönderim 19.10.2026 08:03 · bu haftanın özeti çarşamba sabahı gider");
  assert.equal(weeklyStatusText(base), "Henüz gönderilmedi · ilk özet çarşamba sabahı gider");
  // Pazartesinin işi kapalı buldu ("off"), sonra açıldı: pazartesi 14:00 salı, salı 14:00 çarşamba, çarşamba 14:00 gelecek pazartesi
  const off = { ...base, lastStep: { day: "2026-10-26", code: "off" }, lastSentAt: sent, hourTR: 14 };
  assert.equal(weeklyStatusText({ ...off, week: weekInfo("2026-10-26") }), "Son gönderim 19.10.2026 08:03 · bu haftanın özeti salı sabahı gider");
  assert.equal(weeklyStatusText({ ...off, week: weekInfo("2026-10-27") }), "Son gönderim 19.10.2026 08:03 · bu haftanın özeti çarşamba sabahı gider");
  assert.equal(weeklyStatusText({ ...off, week: weekInfo("2026-10-28") }), "Son gönderim 19.10.2026 08:03 · sıradaki pazartesi sabahı");
  assert.equal(weeklyStatusText({ ...off, week: weekInfo("2026-10-26"), lastSentAt: null }), "Henüz gönderilmedi · ilk özet salı sabahı gider");
  assert.equal(weeklyStatusText({ ...off, week: weekInfo("2026-10-28"), lastSentAt: null }), "Henüz gönderilmedi · ilk özet pazartesi sabahı gider");
  // Sabah penceresinde: bugünün işi kapalı bulduysa yarın, bugün henüz denenmediyse bu sabah
  assert.equal(weeklyStatusText({ ...off, week: weekInfo("2026-10-26"), hourTR: 8 }), "Son gönderim 19.10.2026 08:03 · bu haftanın özeti salı sabahı gider");
  assert.equal(weeklyStatusText({ ...off, week: weekInfo("2026-10-27"), hourTR: 7 }), "Son gönderim 19.10.2026 08:03 · bu haftanın özeti bu sabah gider");
  assert.equal(weeklyStatusText({ ...base, week: weekInfo("2026-10-26"), lastSentAt: sent, hourTR: 6 }), "Son gönderim 19.10.2026 08:03 · bu haftanın özeti bu sabah gider");
  // Salı ya da çarşamba 08:00'den sonra açıldı: o sabahın işi özeti kapalı bulmuş ve adım yazmamıştır (kapalı adımı
  // yalnız pazartesi yazılır); son iş günü bugün olduğundan sıradaki deneme yarın
  assert.equal(weeklyStatusText({ ...off, week: weekInfo("2026-10-27"), hourTR: 8, lastRunDay: "2026-10-27" }), "Son gönderim 19.10.2026 08:03 · bu haftanın özeti çarşamba sabahı gider");
  assert.equal(weeklyStatusText({ ...off, week: weekInfo("2026-10-28"), hourTR: 8, lastRunDay: "2026-10-28" }), "Son gönderim 19.10.2026 08:03 · sıradaki pazartesi sabahı");
  // Bugünün işi henüz yokken (07:00, son iş dün) yine bu sabah
  assert.equal(weeklyStatusText({ ...off, week: weekInfo("2026-10-27"), hourTR: 7, lastRunDay: "2026-10-26" }), "Son gönderim 19.10.2026 08:03 · bu haftanın özeti bu sabah gider");
  // Pazartesi reddedildi, salı işi özeti kapalı buldu, 08:30'da yeniden açıldı: yeniden deneme çarşamba
  assert.equal(
    weeklyStatusText({ ...base, week: weekInfo("2026-10-27"), row: retry, rowDay: "2026-10-26", hourTR: 8, lastRunDay: "2026-10-27" }),
    "Pazartesi gönderilemedi; çarşamba sabahı yeniden denenecek.",
  );
  // Perşembe ve pazar: bu hafta deneme yok
  assert.equal(weeklyStatusText({ ...off, week: weekInfo("2026-10-29") }), "Son gönderim 19.10.2026 08:03 · sıradaki pazartesi sabahı");
  assert.equal(weeklyStatusText({ ...base, week: weekInfo("2026-11-01"), lastSentAt: sent, hourTR: 2 }), "Son gönderim 19.10.2026 08:03 · sıradaki pazartesi sabahı");
  // Sıradaki deneme ve günün adı
  assert.equal(nextWeeklyTry(weekInfo("2026-10-27"), "2026-10-26", 5), "2026-10-27");
  assert.equal(nextWeeklyTry(weekInfo("2026-10-27"), "2026-10-26", 9), "2026-10-28");
  assert.equal(nextWeeklyTry(weekInfo("2026-10-27"), "2026-10-27", 6), "2026-10-28");
  assert.equal(nextWeeklyTry(weekInfo("2026-10-28"), "2026-10-28", 6), null);
  assert.equal(nextWeeklyTry(weekInfo("2026-11-01"), "2026-10-28", 14), null);
  assert.deepEqual(["2026-10-26", "2026-10-28", "2026-11-01"].map(weekdayName), ["pazartesi", "çarşamba", "pazar"]);
  assert.equal(recipientsText(["Okan", "Ayşe"]), "Yöneticilere gider: Okan, Ayşe.");
  assert.equal(recipientsText([]), "Etkin yönetici yok.");
});

test("Son gönderimler: haftalık özetin gidemeyen kaydı adıyla, iç işaretsiz", () => {
  const row = (key: string, error: string | null, ok = false) => weeklyLogText({ key, ok, error });
  assert.deepEqual(row("haftalik:2026-W45", "Yeniden denenecek: Resend şu an yanıt vermiyor; biraz sonra yeniden deneyin."), {
    title: "Haftalık özet gönderilemedi",
    error: "Resend şu an yanıt vermiyor; biraz sonra yeniden deneyin.",
  });
  assert.deepEqual(row("haftalik:2026-W45", "Gönderim belirsiz: Resend yanıt vermedi; e-posta yine de gitmiş olabilir."), {
    title: "Haftalık özet: gönderim belirsiz",
    error: "Resend yanıt vermedi; e-posta yine de gitmiş olabilir.",
  });
  assert.deepEqual(row("haftalik:2026-W45", "Gönderiliyor"), { title: "Haftalık özet gönderiliyor ya da yarıda kaldı", error: null });
  assert.deepEqual(row("haftalik-ornek:1761462000000", "Resend API anahtarı geçersiz ya da yetkisiz (RESEND_API_KEY)."), {
    title: "Haftalık özet örneği gönderilemedi",
    error: "Resend API anahtarı geçersiz ya da yetkisiz (RESEND_API_KEY).",
  });
  assert.equal(row("haftalik:2026-W45", null, true), null);
  assert.equal(row("digest:2026-10-26", "Alıcı adresi geçerli biçimde değil."), null);
  // Liste onu kullanır
  assert.match(readFileSync(join(process.cwd(), "src/app/panel/hatirlaticilar/notifications-section.tsx"), "utf8"), /const weekly = weeklyLogText\(l\);[\s\S]*?weekly\?\.title \?\? "Gönderilemedi"/);
});

// ---------------------------------------------------------------- Kaynak denetimleri



test("nakit: ilk eksi gün vergi satırlarını sayar (muhtasar, yasal oranlı SGK); tutarı bilinmeyen geçici vergiyi saymaz (docs/VERGI.md)", () => {
  const today = "2026-10-22";
  const feed: TaxPlanFeed = {
    items: [{ kind: "muhtasar", period: "2026-09", nominal: "2026-10-26", legalDue: "2026-10-26", amount: 974.38, atLeast: true, source: "estimate", detail: "Ücret GV 0 + DV 34,68 + damga 939,70" }],
    pending: [{ kind: "gecici", period: "2026-Q3", nominal: "2026-11-17", legalDue: "2026-11-17", note: "Geçici vergi 2026/3: şirketin beyannamesi; tutarı muhasebecinizden isteyin (son gün 17.11)" }],
    stamps: { kdv: 791, kdv2: 791 },
  };
  // Eylül'ün SGK'sı Vergi'nin bordrosuyla (25.956,18); öteki ayların bordrosu yok
  const months: CashPlanInput["months"] = Object.fromEntries(
    ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"].map((m) => [m, { payroll: { net: 0, sgk: m === "2026-09" ? 25_956.18 : 0, people: 2 }, fixed: [] }]),
  );
  const plan = (amount: number): CashPlan =>
    buildCashPlan({
      today,
      opening: { amount, date: today },
      excluded: [],
      settings: { komisyon: 0.025, kartOrani: 0.8, acikGun: 30, kdv: 0.1, kdvHizmet: 0.2 },
      invoiceTermDays: 30,
      cashReports: [],
      posMonth: null,
      online: null,
      invoices: [],
      reminders: [],
      goods: [],
      goodsSpanDays: 0,
      months,
      fixedNames: [],
      vat: { months: [], firstSalesMonth: null, hasSite: false },
      vatAnchor: null,
      tax: feed,
    });
  // collect.ts'in eşlemesi: satırın etiketi ve tutarı
  const item = (p: CashPlan) => {
    const n = p.firstNegative;
    return cashItem({ today, opening: { staleDays: 0 }, firstNegative: n ? { date: n.date, balance: n.balance, top: n.top.map((l) => ({ title: lineLabel(l), amount: l.amount })) } : null });
  };
  // 26.000 ₺: muhtasar (974,38) olmasa 31 Ekim'de 43,82 ₺ artıda kalırdı
  const c = item(plan(26_000))!;
  assert.equal(c.key, "nakit:2026-10-31");
  assert.equal(c.title, `31 Ekim Cumartesi para yetmeyebilir: tahmini −931${NB}₺`);
  assert.equal(c.detail, `O gün: SGK primi (Eylül, tahmini) 25.956${NB}₺`);
  const early = item(plan(500))!;
  assert.equal(early.key, "nakit:2026-10-26");
  assert.equal(early.detail, `O gün: Muhtasar (Eylül, tahmini) 974${NB}₺`);
  // Geçici vergi tutarı bilinmiyor: plana girmez, 27.000 ₺ ufuk boyunca yeter
  const enough = plan(27_000);
  assert.equal(enough.firstNegative, null);
  assert.equal(item(enough), null);
  assert.ok(enough.unknownAmounts.some((u) => u.key === "vergi:gecici:2026-Q3"));
});

