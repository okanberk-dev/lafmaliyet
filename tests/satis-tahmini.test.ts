// Satış tahmini (src/lib/forecast/*): Türkiye takvimi (bayram, resmî tatil, arife, Ramazan, okul tatili; öncelikler ve
// hafta içi kuralı), veri katmanları (ay / ortalama / karma / tam), dayanıklı ortalama, dışlananlar (özel gün, kapalı,
// 0 TL), mevsim arındırması, eğilim, aralık, yoğunluk, MET Norway yanıtının ayrıştırılması ve isteğin kuralları, kişi ve
// tatlı önerisi, tutturma, Türkçe metinler, personelin tutarsız görünümü ve kaynak denetimleri (yetki, önizleme, sabah
// işi, Bugün).
// Saatler sabit; günler Türkiye iş günü. Çalıştırma: npx tsx --test tests/satis-tahmini.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { mobileTitleFor, NAV_GROUPS, NAV_TREE } from "../src/components/panel/nav";
import { businessDate } from "../src/lib/cash-report";
import { accuracy, isSameMorning, pairFor, pastRatios, type SnapshotLite } from "../src/lib/forecast/accuracy";
import { calendarDay, coverageNote, rangeTR, shortDateTR, TR_CALENDAR, upcomingCalendar, weekdayOf } from "../src/lib/forecast/calendar";
import { buildMix, dessertPlan, effectiveDessertCategories, foldTR, isDessertCategory, prepLabel } from "../src/lib/forecast/desserts";
import { buildForecast, quantile, robustMean, snapshotDetail, type DayTotal, type ForecastInput, type SpecialDay } from "../src/lib/forecast/model";
import { DEFAULT_FORECAST_SETTINGS, parseForecastSettings, staffFor } from "../src/lib/forecast/staffing";
import {
  cardFooter,
  dayTitle,
  digestForecastBox,
  explainLines,
  factorTable,
  qualityBanner,
  reasonChips,
  reasonNames,
  signedPct,
  specialRow,
  specialSummary,
  staffForecastLines,
  staffView,
} from "../src/lib/forecast/text";
import { metUrl, parseMetCompact, parseWeatherState, refetchGate, TUZLA, userAgent, weatherKind, weatherText, type WeatherDay } from "../src/lib/forecast/weather";
import { canOpen } from "../src/lib/roles";
import { addDays } from "../src/lib/reminders";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/** `from`'dan `to`'ya her gün, değer gününe göre */
function days(from: string, to: string, value: (date: string, weekday: number) => number | null): DayTotal[] {
  const out: DayTotal[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const v = value(d, weekdayOf(d));
    if (v !== null) out.push({ date: d, total: v });
  }
  return out;
}

const input = (o: Partial<ForecastInput> & { today: string }): ForecastInput => ({ history: [], months: [], special: [], weather: null, pastRatios: [], ...o });
const OCT_2026 = { month: "2026-10", openDays: 16, posRevenue: 293_909 };
const byDate = (f: ReturnType<typeof buildForecast>, date: string) => {
  const d = f.days.find((x) => x.date === date);
  assert.ok(d, date);
  return d;
};

// ---------------------------------------------------------------- 1. Takvim

test("takvim: kayıtlar geçerli, aynı türde çakışmıyor, 2028 sonuna kadar; hafta günleri sabit", () => {
  for (const e of TR_CALENDAR) {
    assert.match(e.from, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(addDays(e.from, 0), e.from);
    assert.equal(addDays(e.to, 0), e.to);
    assert.ok(e.from <= e.to, `${e.name} ${e.from}`);
  }
  const kinds = new Set(TR_CALENDAR.map((e) => e.kind));
  for (const k of kinds) {
    const list = TR_CALENDAR.filter((e) => e.kind === k).sort((a, b) => a.from.localeCompare(b.from));
    for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].to < list[i].from, `${k}: ${list[i - 1].name} ↔ ${list[i].name}`);
  }
  assert.ok(TR_CALENDAR.some((e) => e.from === "2028-12-31" || e.to >= "2028-10-29"));
  assert.ok(TR_CALENDAR.filter((e) => e.kind === "resmi" && e.from.startsWith("2028")).length === 7);
  // Hafta günleri (Date.UTC, saat diliminden bağımsız)
  assert.equal(weekdayOf("2026-10-29"), 4); // Perşembe
  assert.equal(weekdayOf("2027-03-09"), 2); // Salı
  assert.equal(weekdayOf("2028-02-26"), 6); // Cumartesi
  assert.equal(weekdayOf("2028-05-05"), 5); // Cuma
  assert.equal(weekdayOf("2028-01-28"), 5); // 2028 ilk oruç Cuma
});

test("takvim: olayın önceliği bayram > resmî tatil > arife; mevsimler", () => {
  assert.equal(calendarDay("2026-10-28").event?.kind, "arife");
  assert.equal(calendarDay("2026-10-28").event?.name, "Cumhuriyet Bayramı arifesi");
  assert.equal(calendarDay("2026-10-29").event?.kind, "resmi");
  const may19 = calendarDay("2027-05-19");
  assert.equal(may19.event?.kind, "kurban-bayrami");
  assert.equal(may19.event?.day, 4);
  assert.equal(may19.event?.name, "Kurban Bayramı 4. gün · 19 Mayıs");
  const mar8 = calendarDay("2027-03-08");
  assert.equal(mar8.event?.kind, "arife");
  assert.deepEqual(mar8.seasons.map((s) => s.kind).sort(), ["okul-tatili", "ramazan"]);
  assert.deepEqual(calendarDay("2026-11-18").seasons.map((s) => s.kind), ["okul-tatili"]);
  assert.deepEqual(calendarDay("2027-02-15").seasons.map((s) => s.kind), ["ramazan"]);
  const plain = calendarDay("2026-12-15");
  assert.equal(plain.event, null);
  assert.deepEqual(plain.seasons, []);
  // Bayramın kaçıncı günü
  assert.equal(calendarDay("2026-03-21").event?.name, "Ramazan Bayramı 2. gün");
  assert.equal(calendarDay("2028-02-26").event?.kind, "ramazan-bayrami");
  assert.equal(calendarDay("2028-05-04").event?.name, "Kurban Bayramı arifesi");
});

test("takvim: kapsam notu 2027 Ağustos'tan, önümüzdeki günler tek satır", () => {
  assert.equal(coverageNote("2026-10-24"), null);
  assert.equal(coverageNote("2027-07-31"), null);
  assert.match(coverageNote("2027-08-01")!, /^Okul takvimi 2027–2028 için henüz eklenmedi/);
  assert.match(coverageNote("2028-11-01")!, /2029 eklenmeli\.$/);
  const next = upcomingCalendar("2026-10-24", 60).map((u) => `${rangeTR(u.from, u.to)} · ${u.name}`);
  assert.deepEqual(next, ["28 Ekim Çarşamba · Cumhuriyet Bayramı arifesi", "29 Ekim Perşembe · Cumhuriyet Bayramı", "16–20 Kasım · 1. dönem ara tatili"]);
  assert.equal(shortDateTR("2026-10-22"), "22 Eki Per");
});

// ---------------------------------------------------------------- 2–3. Hafta içi kuralı ve veri katmanları

test("hafta içi kuralı: hafta sonuna düşen resmî tatil, arife ve okul tatili etkisiz; hafta içinde varsayılan", () => {
  const f = buildForecast(input({ today: "2026-08-28", months: [{ month: "2026-08", openDays: 31, posRevenue: 500_000 }] }));
  // 30 Ağustos 2026 Pazar (resmî tatil) ve yaz tatili: çarpan yok
  const sun = byDate(f, "2026-08-30");
  assert.deepEqual(sun.factors, []);
  assert.deepEqual(reasonChips(sun), ["Zafer Bayramı"]);
  // 28 Ağustos Cuma: okul tatili (hafta içi) +%10
  assert.deepEqual(byDate(f, "2026-08-28").factors.map((x) => [x.key, x.value]), [["okul-tatili", 1.1]]);
  // 15 Mayıs 2027 Cumartesi Kurban arifesi: etkisiz
  const g = buildForecast(input({ today: "2027-05-13", months: [{ month: "2027-05", openDays: 10, posRevenue: 200_000 }] }));
  assert.deepEqual(byDate(g, "2027-05-15").factors, []);
  // 2028'de 28–29 Ekim Cumartesi / Pazar
  const h = buildForecast(input({ today: "2028-10-27", months: [{ month: "2028-10", openDays: 20, posRevenue: 400_000 }] }));
  assert.deepEqual(byDate(h, "2028-10-28").factors, []);
  assert.deepEqual(byDate(h, "2028-10-29").factors, []);
});

test("veri katmanları: hiçbir şey yoksa tahmin yok; yalnız ay bilgisiyle kaba tahmin (Ekim 2026: 293.909 ₺ / 16 gün)", () => {
  const none = buildForecast(input({ today: "2026-10-22" }));
  assert.equal(none.quality, "yok");
  assert.equal(none.days.length, 0);
  // Ay bilgisi yokken 2 normal gün yetmez, 3 gün son 42 günün ortalamasıyla kaba tahmin
  assert.equal(buildForecast(input({ today: "2026-10-22", history: days("2026-10-19", "2026-10-20", () => 10_000) })).quality, "yok");
  const three = buildForecast(input({ today: "2026-10-22", history: days("2026-10-19", "2026-10-21", () => 10_000) }));
  assert.equal(three.quality, "ortalama");
  assert.equal(three.level?.windowDays, 42);

  // 8 gün: 29 Ekim de görünsün (ufuk 7 gün)
  const f = buildForecast(input({ today: "2026-10-22", months: [OCT_2026, { month: "2026-11", openDays: 5, posRevenue: 1 }], days: 8 }));
  assert.equal(f.quality, "ay");
  assert.equal(f.level?.month, "2026-10");
  assert.equal(buildForecast(input({ today: "2026-10-22", months: [OCT_2026] })).days.length, 7);
  const thu = byDate(f, "2026-10-22");
  assert.equal(thu.amount, 17_500);
  assert.deepEqual([thu.low, thu.high], [13_000, 22_000]);
  assert.equal(thu.level, "normal");
  const sat = byDate(f, "2026-10-24");
  assert.equal(sat.amount, 23_000);
  assert.deepEqual([sat.low, sat.high], [17_000, 29_000]);
  assert.equal(sat.level, "yuksek");
  assert.equal(byDate(f, "2026-10-26").level, "dusuk"); // Pazartesi %85
  // Arife (hafta içi yarım gün) ve Cumhuriyet Bayramı: aralık 5 puan geniş
  const wed = byDate(f, "2026-10-28");
  assert.equal(wed.amount, 18_200);
  assert.deepEqual([wed.low, wed.high], [12_500, 24_000]);
  const holiday = byDate(f, "2026-10-29");
  assert.equal(holiday.amount, 20_900);
  assert.deepEqual([holiday.low, holiday.high], [14_500, 27_500]);
  assert.equal(holiday.level, "yuksek");
  assert.equal(holiday.spreadPct, 0.3);
});

test("veri katmanları: 8 normal gün ortalama, her hafta gününden 3 gün tam (ortanca), eksik gün karma", () => {
  const share = [1.15, 0.85, 0.85, 0.9, 0.95, 1.05, 1.25];
  const avg = buildForecast(input({ today: "2026-12-14", history: days("2026-12-06", "2026-12-13", (_, w) => 10_000 * share[w]) }));
  assert.equal(avg.quality, "ortalama");
  assert.equal(Math.round(avg.level!.value), 10_000);
  assert.equal(avg.level?.windowDays, 28);
  assert.equal(byDate(avg, "2026-12-14").amount, 8_500);

  // 5–25 Ekim 2026: her hafta günü 10.000, 9.000, 11.000 (sırayla haftalar): ortanca 10.000, eğilim yok
  const week = (d: string) => (d < "2026-10-12" ? 10_000 : d < "2026-10-19" ? 9_000 : 11_000);
  const full = buildForecast(input({ today: "2026-10-26", history: days("2026-10-05", "2026-10-25", (d) => week(d)) }));
  assert.equal(full.quality, "tam");
  assert.equal(full.trend, null);
  assert.ok(full.bases.every((b) => b?.source === "hafta-gunu" && b.n === 3 && b.amount === 10_000));
  assert.equal(byDate(full, "2026-10-26").amount, 10_000);
  // Kendi verisiyle aralık ±%15, takvim olayında ±%20
  assert.deepEqual([byDate(full, "2026-10-26").low, byDate(full, "2026-10-26").high], [8_500, 11_500]);
  assert.equal(byDate(full, "2026-10-29").spreadPct, 0.2);
  assert.equal(qualityBanner(full), null);

  const noTue = buildForecast(input({ today: "2026-10-26", history: days("2026-10-05", "2026-10-25", (d, w) => (w === 2 ? null : week(d))) }));
  assert.equal(noTue.quality, "karma");
  assert.deepEqual(noTue.missingWeekdays, [2]);
  assert.equal(noTue.bases[2]?.source, "ortalama");
  assert.equal(qualityBanner(noTue), "Salı için henüz 3 rapor yok; o günler ortalama güne göre hesaplandı.");
});

test("dayanıklı ortalama ve yüzdelik", () => {
  assert.equal(robustMean([9, 10, 11, 12, 50]), 11);
  assert.equal(robustMean([3, 100, 5]), 5);
  assert.equal(robustMean([1, 2, 10, 20]), 6);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(quantile([1, 2, 3, 4], 0.2), 1.6);
  assert.ok(Number.isNaN(robustMean([])));
});

// ---------------------------------------------------------------- 5. Dışlananlar ve özel günler

const OCT_BASE = days("2026-10-05", "2026-10-25", () => 10_000);
const derbi = (o: Partial<SpecialDay> & { id: number; dateFrom: string }): SpecialDay => ({ dateTo: o.dateFrom, kind: "derbi", title: "Fenerbahçe – Galatasaray maçı", effect: 0.15, ...o });

test("dışlananlar: özel günün 3 katı satışı tabanı oynatmaz, 0 TL'lik gün kapalı sayılır", () => {
  const base = buildForecast(input({ today: "2026-10-26", history: OCT_BASE }));
  const withDerbi = buildForecast(
    input({ today: "2026-10-26", history: [...OCT_BASE, { date: "2026-09-26", total: 30_000 }], special: [derbi({ id: 1, dateFrom: "2026-09-26", dateTo: "2026-09-26" })] }),
  );
  assert.deepEqual(
    withDerbi.days.map((d) => d.amount),
    base.days.map((d) => d.amount),
  );
  const withZero = buildForecast(input({ today: "2026-10-26", history: [...OCT_BASE, { date: "2026-09-27", total: 0 }] }));
  assert.deepEqual(
    withZero.days.map((d) => d.amount),
    base.days.map((d) => d.amount),
  );
  assert.equal(withZero.reports.total, base.reports.total + 1);
});

test("özel günler: kapalı gün 0 (kişi ve tatlı yok), üst üste gelenler çarpılır, etkisi bilinmeyen yalnız etiket", () => {
  const f = buildForecast(
    input({
      today: "2026-10-26",
      history: OCT_BASE,
      special: [
        { id: 1, dateFrom: "2026-10-27", dateTo: "2026-10-27", kind: "kapali", title: "Tadilat", effect: -1 },
        derbi({ id: 2, dateFrom: "2026-10-31" }),
        { id: 3, dateFrom: "2026-10-30", dateTo: "2026-11-01", kind: "avm", title: "AVM cadılar bayramı", effect: 0.3 },
        { id: 4, dateFrom: "2026-11-01", dateTo: "2026-11-01", kind: "diger", title: "Not", effect: 0 },
      ],
    }),
  );
  const closed = byDate(f, "2026-10-27");
  assert.deepEqual([closed.amount, closed.low, closed.high, closed.level], [0, 0, 0, "kapali"]);
  assert.deepEqual(staffFor(closed, DEFAULT_FORECAST_SETTINGS), { count: 0, ifBusy: null });
  assert.equal(explainLines(closed, { forecast: f, settings: DEFAULT_FORECAST_SETTINGS, roster: null, mix: null, desserts: null, snapshot: null }).length, 1);
  const sat = byDate(f, "2026-10-31");
  assert.ok(Math.abs(sat.factor - 1.15 * 1.3) < 1e-9);
  assert.equal(sat.amount, 15_000); // 10.000 × 1,495 → 100'e
  assert.deepEqual(reasonChips(sat), ["Fenerbahçe – Galatasaray maçı +%15", "AVM cadılar bayramı +%30"]);
  assert.deepEqual(reasonChips(byDate(f, "2026-11-01")), ["AVM cadılar bayramı +%30", "Not"]);
  const plan = dessertPlan(f.days, MIX);
  assert.equal(plan.perDay[1], 0);
});

test("takvim çarpanı: tam veride 29 Ekim 2026 Perşembe tabanı × 1,20; arife × 1,10", () => {
  const f = buildForecast(input({ today: "2026-10-26", history: OCT_BASE }));
  assert.equal(byDate(f, "2026-10-29").amount, 12_000);
  assert.equal(byDate(f, "2026-10-28").amount, 11_000);
  assert.equal(byDate(f, "2026-10-29").factors[0].source, "varsayilan");
});

// ---------------------------------------------------------------- 7. Mevsim arındırması

test("mevsim: okul tatili ve Ramazan tabanı şişirmez, mevsim içindeki güne geri gelir", () => {
  // Yaz tatili: hafta içi 11.000, hafta sonu 10.000 → taban 10.000; tatil bitince (14 Eylül) 10.000
  const summer = (d: string, w: number) => (d === "2026-08-30" ? null : w === 0 || w === 6 ? 10_000 : 11_000);
  const after = buildForecast(input({ today: "2026-09-14", history: days("2026-08-17", "2026-09-13", summer) }));
  assert.equal(after.quality, "tam");
  assert.equal(byDate(after, "2026-09-14").amount, 10_000);
  const inside = buildForecast(input({ today: "2026-09-07", history: days("2026-08-09", "2026-09-06", summer) }));
  assert.equal(byDate(inside, "2026-09-07").amount, 11_000);
  // Ramazan 2027: her gün 9.200 → taban 10.000; Ramazan içinde 9.200, bittikten sonra (13 Mart Cumartesi) 10.000
  const ramazan = buildForecast(input({ today: "2027-03-01", history: days("2027-02-08", "2027-02-28", () => 9_200), days: 13 }));
  assert.equal(ramazan.quality, "tam");
  assert.equal(byDate(ramazan, "2027-03-01").amount, 9_200);
  assert.equal(byDate(ramazan, "2027-03-13").amount, 10_000);
});

// ---------------------------------------------------------------- 8. Hava durumu

const FIXTURE = JSON.parse(read("tests/fixtures/tahmin/met-compact.json"));

test("MET yanıtı: Türkiye gününe bölünür (21:00Z ertesi gün), saatlik yağış 09–23, yoksa 6 saatlik, simge eksiz", () => {
  const w = parseMetCompact(FIXTURE);
  assert.deepEqual(
    w.map((d) => d.date),
    ["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26"],
  );
  const [d22, d23, d24, d25, d26] = w;
  assert.deepEqual(d22, { date: "2026-10-22", tMax: 24, tMin: 16, precipMm: 0, symbol: "clearsky", hours: 16 });
  // 2026-10-22T21:00:00Z Türkiye'de 23 Ekim 00:00: 23'ünün 24 saatlik adımı
  assert.equal(d23.hours, 24);
  assert.deepEqual([d23.tMax, d23.tMin, d23.precipMm, d23.symbol], [19, 12, 6, "rain"]);
  assert.equal(weatherKind(d23), "yagmur");
  assert.equal(weatherText(d23), "Yağmurlu · 6 mm · 19°/12°");
  // 24'ü: saatlik adım 6 (< 10): 09:00 ve 15:00'in 6 saatlik toplamları
  assert.deepEqual([d24.precipMm, d24.symbol], [0.2, "partlycloudy"]);
  assert.deepEqual([d25.precipMm, d25.symbol, weatherKind(d25)], [6, "rain", "yagmur"]);
  assert.deepEqual([d26.precipMm, d26.symbol], [0, "partlycloudy"]);
  assert.equal(weatherText(d22), "Güneşli · 24°/16°");
  for (const bad of [{}, null, undefined, "x", { properties: { timeseries: "x" } }, { properties: { timeseries: [null, { time: "yok" }] } }]) {
    assert.deepEqual(parseMetCompact(bad), []);
  }
});

test("hava: eşikler, çarpan, kapalı ayar; istek adresi 4 ondalık, kimlik ve Expires", () => {
  assert.equal(weatherKind({ precipMm: 4.9, tMax: 30 }), "normal");
  assert.equal(weatherKind({ precipMm: 5, tMax: 30 }), "yagmur");
  assert.equal(weatherKind({ precipMm: 0, tMax: 35 }), "sicak");
  assert.equal(weatherKind({ precipMm: null, tMax: null }), null);
  assert.equal(weatherText(null), "Hava bilgisi yok");

  const rain: WeatherDay = { date: "2026-10-27", tMax: 18, tMin: 12, precipMm: 8, symbol: "rain", hours: 24 };
  const on = buildForecast(input({ today: "2026-10-26", history: OCT_BASE, weather: [rain] }));
  assert.equal(byDate(on, "2026-10-27").amount, 10_500);
  assert.deepEqual(reasonNames(byDate(on, "2026-10-27")), ["yağmur"]);
  const ctx = { forecast: on, settings: DEFAULT_FORECAST_SETTINGS, roster: null, mix: null, desserts: null, snapshot: null };
  assert.ok(explainLines(byDate(on, "2026-10-27"), ctx).includes("Hava (MET Norway): Yağmurlu · gün içi 8 mm · en yüksek 18 °C."));
  const dry = buildForecast(input({ today: "2026-10-26", history: OCT_BASE, weather: [{ ...rain, precipMm: 0, symbol: "clearsky" }] }));
  assert.ok(explainLines(byDate(dry, "2026-10-27"), { ...ctx, forecast: dry }).includes("Hava (MET Norway): Güneşli · en yüksek 18 °C."));
  const off = buildForecast(input({ today: "2026-10-26", history: OCT_BASE, weather: null }));
  assert.equal(byDate(off, "2026-10-27").amount, 10_000);
  assert.equal(byDate(off, "2026-10-27").weather, null);

  assert.deepEqual(TUZLA, { lat: 40.816, lon: 29.301 });
  assert.equal(metUrl(), "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=40.8160&lon=29.3010");
  assert.match(metUrl({ lat: 40.81604999, lon: 29.30123456 }), /lat=40\.8160&lon=29\.3012$/);
  const ua = userAgent("https://ladmin.laffogato.net");
  assert.match(ua, /^LAffogatoPanel\//);
  assert.ok(ua.includes("https://ladmin.laffogato.net"));
  assert.ok(!ua.includes("@"));
  assert.equal(userAgent("https://x.test", "ops@x.test\r\nX-Bad: 1"), "LAffogatoPanel/1.0 (+https://x.test; ops@x.testX-Bad: 1)");

  const now = new Date("2026-10-22T05:30:00Z");
  assert.equal(refetchGate(null, now), "ok");
  const fresh = { fetchedAt: "2026-10-22T05:00:00Z", expires: "2026-10-22T05:45:00Z", lastModified: "Thu, 22 Oct 2026 04:41:19 GMT", error: null, errorAt: null };
  assert.equal(refetchGate(fresh, now), "fresh");
  assert.equal(refetchGate({ ...fresh, expires: "2026-10-22T05:29:00Z" }, now), "ok");
  assert.equal(refetchGate({ ...fresh, expires: null, error: "HTTP 403", errorAt: "2026-10-22T05:20:00Z" }, now), "error-wait");
  assert.equal(refetchGate({ ...fresh, expires: null, error: "HTTP 403", errorAt: "2026-10-22T05:00:00Z" }, now), "ok");
  assert.equal(parseWeatherState("x"), null);
  assert.deepEqual(parseWeatherState({ fetchedAt: 5, error: "HTTP 500" }), { fetchedAt: null, expires: null, lastModified: null, error: "HTTP 500", errorAt: null });
});

// ---------------------------------------------------------------- 9–12. Aralık, iş günü, sızıntı, yaz saati, eğilim

test("aralık: 14 geçmiş oranla %20–%80 (en az ±%5), yuvarlamalar 100 ve 500 ₺", () => {
  const few = buildForecast(input({ today: "2026-10-26", history: OCT_BASE, pastRatios: Array(13).fill(1) }));
  assert.equal(few.spread.kind, "varsayilan");
  const flat = buildForecast(input({ today: "2026-10-26", history: OCT_BASE, pastRatios: Array(14).fill(1) }));
  assert.equal(flat.spread.kind, "gecmis");
  const mon = byDate(flat, "2026-10-26");
  assert.deepEqual([mon.low, mon.amount, mon.high, mon.spreadPct], [9_500, 10_000, 10_500, null]);
  const wide = buildForecast(input({ today: "2026-10-26", history: OCT_BASE, pastRatios: [0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1, 1, 1.05, 1.1, 1.15, 1.2, 1.3, 1.4] }));
  const w = byDate(wide, "2026-10-26");
  assert.equal(w.low, Math.floor((10_000 * quantile([0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1, 1, 1.05, 1.1, 1.15, 1.2, 1.3, 1.4], 0.2)) / 500) * 500);
  for (const d of [...few.days, ...flat.days, ...wide.days]) {
    assert.ok(d.low <= d.amount && d.amount <= d.high, d.date);
    assert.equal(d.amount % 100, 0);
    assert.equal(d.low % 500, 0);
    assert.equal(d.high % 500, 0);
  }
});

test("iş günü 05:00'te döner; bugünün ve sonrasının Z'si tahmine girmez", () => {
  assert.equal(businessDate(new Date("2026-10-23T01:59:00Z")), "2026-10-22");
  assert.equal(businessDate(new Date("2026-10-23T02:00:00Z")), "2026-10-23");
  const base = buildForecast(input({ today: "2026-10-26", history: OCT_BASE }));
  const leak = buildForecast(input({ today: "2026-10-26", history: [...OCT_BASE, { date: "2026-10-26", total: 900_000 }, { date: "2026-10-27", total: 900_000 }] }));
  assert.deepEqual(
    leak.days.map((d) => [d.amount, d.low, d.high]),
    base.days.map((d) => [d.amount, d.low, d.high]),
  );
});

test("yaz saati yok: Avrupa'nın saat değiştirdiği haftalarda 7 ardışık gün, doğru hafta günü", () => {
  for (const today of ["2027-03-25", "2027-10-29"]) {
    const f = buildForecast(input({ today, months: [{ month: today.slice(0, 7), openDays: 20, posRevenue: 300_000 }] }));
    assert.equal(f.days.length, 7);
    f.days.forEach((d, i) => {
      assert.equal(d.date, addDays(today, i));
      assert.equal(d.weekday, (weekdayOf(today) + i) % 7);
    });
  }
});

test("eğilim: son 2 hafta tabandan %10'dan çok saparsa çarpan (×0,8–1,25); azsa ya da 5 günden azsa yok", () => {
  // 14 Eylül – 25 Ekim 2026: 6 tam hafta, olay ve mevsim yok
  const run = (recent: number | null, gap = false) =>
    buildForecast(input({ today: "2026-10-26", history: days("2026-09-14", "2026-10-25", (d) => (d >= "2026-10-12" ? (gap && d < "2026-10-22" ? null : recent) : 10_000)) }));
  const up = run(12_000);
  assert.ok(Math.abs(up.trend! - 12_000 / 10_500) < 1e-9);
  const mon = byDate(up, "2026-10-26");
  assert.equal(mon.factors.at(-1)?.label, "Son 2 hafta eğilimi");
  assert.equal(mon.amount, Math.round((10_500 * (12_000 / 10_500)) / 100) * 100);
  assert.ok(explainLines(mon, { forecast: up, settings: DEFAULT_FORECAST_SETTINGS, roster: null, mix: null, desserts: null, snapshot: null }).includes("Son 2 hafta tabanın %14 üstünde: ×1,14."));
  assert.equal(run(10_500).trend, null);
  assert.equal(run(20_000).trend, 1.25);
  assert.equal(run(5_000).trend, 0.8);
  // Son 14 günde 4 normal gün (22–25 Ekim): eğilim yok
  assert.equal(run(20_000, true).trend, null);
  assert.equal(snapshotDetail(up, mon).factors.at(-1)?.key, "egilim");
});

// ---------------------------------------------------------------- 13. Kişi

test("kişi önerisi: tahmin ÷ kişi başı, en az / en çok, yoğunsa; ayarlar bozuksa varsayılan", () => {
  const s = DEFAULT_FORECAST_SETTINGS;
  assert.deepEqual(staffFor({ amount: 17_500, high: 22_000, closed: null }, s), { count: 2, ifBusy: 3 });
  assert.deepEqual(staffFor({ amount: 23_000, high: 29_000, closed: null }, s), { count: 3, ifBusy: null });
  assert.deepEqual(staffFor({ amount: 20_000, high: 20_000, closed: null }, s), { count: 2, ifBusy: null });
  assert.deepEqual(staffFor({ amount: 5_000, high: 6_000, closed: null }, s), { count: 2, ifBusy: null });
  assert.deepEqual(staffFor({ amount: 90_000, high: 120_000, closed: null }, s), { count: 6, ifBusy: null });
  assert.deepEqual(staffFor({ amount: 9_000, high: 9_000, closed: { title: "x" } }, s), { count: 0, ifBusy: null });
  assert.deepEqual(parseForecastSettings("bozuk"), DEFAULT_FORECAST_SETTINGS);
  assert.deepEqual(parseForecastSettings({ perPerson: 50, minStaff: 1.5, maxStaff: "x", weather: "evet", dessertCategories: [1, " Tatlılar ", "Tatlılar"] }), {
    ...DEFAULT_FORECAST_SETTINGS,
    dessertCategories: ["Tatlılar"],
  });
  assert.deepEqual(parseForecastSettings({ minStaff: 4, maxStaff: 3 }), { ...DEFAULT_FORECAST_SETTINGS, minStaff: 4, maxStaff: 4 });
});

// ---------------------------------------------------------------- 14. Tatlı

const PRODUCTS = [
  { id: 1, name: "San Sebastian", categoryName: "Tatlılar" },
  { id: 2, name: "Çilekli Magnolia", categoryName: "Tatlılar" },
  { id: 3, name: "Fıstıklı Magnolia", categoryName: "Tatlılar" },
  { id: 4, name: "Lotuslu Magnolia", categoryName: "Tatlılar" },
  { id: 5, name: "Cookie Aşkı", categoryName: "Tatlılar" },
  { id: 6, name: "Pasta dilimi", categoryName: "Tatlılar" },
  { id: 7, name: "Latte", categoryName: "Espresso Bazlı" },
];
const INGREDIENTS = [
  { id: 10, name: "San Sebastian dilim", unit: "dilim", category: "Tatlı", packageSize: 12 },
  { id: 11, name: "Magnolia (adet)", unit: "adet", category: "Tatlı", packageSize: 1 },
  { id: 12, name: "Peçete", unit: "adet", category: "Ambalaj", packageSize: 2500 },
  { id: 13, name: "Vanilya dondurma", unit: "ml", category: "Dondurma", packageSize: 5500 },
  { id: 14, name: "Cookie (adet)", unit: "adet", category: "Tatlı", packageSize: 1 },
];
const RECIPES = [
  { productId: 1, ingredientId: 10, qty: 1 },
  { productId: 1, ingredientId: 12, qty: 1 },
  { productId: 2, ingredientId: 11, qty: 1 },
  { productId: 3, ingredientId: 11, qty: 1 },
  { productId: 4, ingredientId: 11, qty: 1 },
  { productId: 5, ingredientId: 14, qty: 1 },
  { productId: 5, ingredientId: 13, qty: 70 },
  { productId: 6, ingredientId: 12, qty: 1 },
];
// Eylül 2026 benzeri: 183 tatlı / 429.698 ₺
const LINES = [
  { productId: 1, qty: 60 },
  { productId: 2, qty: 40 },
  { productId: 3, qty: 30 },
  { productId: 4, qty: 13 },
  { productId: 5, qty: 20 },
  { productId: 6, qty: 20 },
  { productId: 7, qty: 900 },
  { productId: null, qty: 50 },
];
const MIX = buildMix({ months: [{ month: "2026-09", revenue: 429_698 }], lines: LINES, products: PRODUCTS, recipes: RECIPES, ingredients: INGREDIENTS, chosen: null })!;

test("tatlı payı: 183 tatlı / 429.698 ₺ ≈ 10.000 ₺'de 4,3; ambalaj ve ml sayılmaz, ortak malzeme toplanır", () => {
  assert.ok(MIX);
  assert.ok(Math.abs(MIX.dessertsPerTL * 10_000 - 4.2588) < 1e-3);
  assert.deepEqual(
    MIX.items.map((i) => [i.key, i.label, i.unit, i.perWhole]),
    [
      ["i:10", "San Sebastian", "dilim", 12],
      ["i:11", "Magnolia", "adet", null],
      ["i:14", "Cookie", "adet", null],
      ["p:6", "Pasta dilimi", "adet", null],
    ],
  );
  assert.ok(Math.abs(MIX.perTL["i:11"] * 429_698 - 83) < 1e-9);
  const plan = dessertPlan([{ amount: 23_000, closed: null }], MIX);
  assert.equal(plan.perDay[0], 10);
  assert.equal(plan.per10k, 4.3);
  const week = dessertPlan(Array.from({ length: 7 }, () => ({ amount: 20_000, closed: null })), MIX);
  const ss = week.items.find((x) => x.item.key === "i:10")!;
  assert.equal(ss.total, Math.round(7 * 20_000 * (60 / 429_698)));
  assert.equal(ss.wholes, Math.round((ss.total / 12) * 10) / 10);
  assert.equal(week.items[0].item.key, "i:11"); // en çok çıkan önce
  // Tatlı satışı ya da ciro yoksa öneri yok
  assert.equal(buildMix({ months: [{ month: "2026-09", revenue: 0 }], lines: LINES, products: PRODUCTS, recipes: RECIPES, ingredients: INGREDIENTS, chosen: null }), null);
  assert.equal(buildMix({ months: [{ month: "2026-09", revenue: 1000 }], lines: [{ productId: 7, qty: 5 }], products: PRODUCTS, recipes: RECIPES, ingredients: INGREDIENTS, chosen: null }), null);
});

test("tatlı kategorisi: Türkçe katlama, seçilen adlar kuralı geçer, silinen ad yok sayılır", () => {
  assert.equal(foldTR("TATLILAR"), "tatlilar");
  assert.ok(isDessertCategory("TATLILAR", null));
  assert.ok(isDessertCategory("Tatlı & Pasta", null));
  assert.ok(!isDessertCategory("Atıştırmalıklar", null));
  assert.ok(isDessertCategory("Atıştırmalıklar", ["atıştırmalıklar"]));
  assert.ok(!isDessertCategory("Tatlılar", ["Atıştırmalıklar"]));
  assert.deepEqual(effectiveDessertCategories(["Eski ad", "Tatlılar"], ["Tatlılar", "Frappe"]), ["Tatlılar"]);
  assert.equal(effectiveDessertCategories(["Eski ad"], ["Tatlılar"]), null);
  assert.equal(effectiveDessertCategories([], ["Tatlılar"]), null);
  assert.equal(prepLabel("San Sebastian dilim"), "San Sebastian");
  assert.equal(prepLabel("Magnolia (adet)"), "Magnolia");
  assert.equal(prepLabel("Frambuazlı cheesecake"), "Frambuazlı cheesecake");
});

// ---------------------------------------------------------------- 15. Personel

test("personelin görünümü: yalnız yoğunluk, nedenler ve tatlı; tutar, ₺, % ve kişi yok", () => {
  const f = buildForecast(input({ today: "2026-10-29", months: [OCT_2026], weather: [{ date: "2026-10-29", tMax: 17, tMin: 11, precipMm: 9, symbol: "rain", hours: 24 }] }));
  const v = staffView(f, MIX)!;
  assert.deepEqual(Object.keys(v).sort(), ["closed", "desserts", "level", "reasons"]);
  assert.deepEqual(v.reasons, ["Cumhuriyet Bayramı", "yağmur"]);
  const json = JSON.stringify(v);
  assert.ok(!json.includes("₺"));
  assert.ok(!json.includes("%"));
  assert.ok(!json.includes(String(f.days[0].amount)));
  assert.ok(!json.includes(String(f.days[0].high)));
  assert.equal(v.level, "yuksek");
  assert.deepEqual(staffForecastLines(v), [
    { key: "yogunluk", text: "Bugün yoğunluk: Yüksek · Cumhuriyet Bayramı, yağmur", tone: "warn" },
    { key: "tatli", text: `Tatlı: bugün ≈ ${v.desserts!.today} satılır (en çok Magnolia, San Sebastian)`, tone: "info" },
  ]);
  const closed = buildForecast(input({ today: "2026-10-29", months: [OCT_2026], special: [{ id: 1, dateFrom: "2026-10-29", dateTo: "2026-10-29", kind: "kapali", title: "Tadilat", effect: -1 }] }));
  assert.deepEqual(staffView(closed, MIX), { level: "kapali", reasons: [], desserts: null, closed: true });
  assert.deepEqual(staffForecastLines(staffView(closed, MIX)!), [{ key: "yogunluk", text: "Bugün kafe kapalı olarak işaretli.", tone: "info" }]);
  assert.equal(staffView(buildForecast(input({ today: "2026-10-29" })), MIX), null);
});

// ---------------------------------------------------------------- 16. Tutturma

const snap = (date: string, amount: number, at: string, o: Partial<SnapshotLite> = {}): SnapshotLite => ({ date, madeOn: date, amount, low: amount * 0.8, high: amount * 1.2, closed: false, createdAt: at, ...o });

test("tutturma: aynı sabah 12:00'den önce, ağırlıklı sapma, aralık, yön; durumlar", () => {
  const today = "2026-11-20";
  const snaps: SnapshotLite[] = [];
  const actuals = new Map<string, number>();
  for (let i = 1; i <= 8; i++) {
    const d = addDays(today, -i);
    snaps.push(snap(d, 10_000, `${d}T05:10:00Z`));
    actuals.set(d, i <= 4 ? 11_000 : 9_000);
  }
  // 13:00'te (Türkiye) yazılan aynı gün tahmini ve gece yarısından sonra yazılan sayılmaz
  const late = addDays(today, -9);
  snaps.push(snap(late, 1_000, `${late}T10:00:00Z`));
  actuals.set(late, 20_000);
  const night = addDays(today, -10);
  snaps.push(snap(night, 1_000, `${addDays(night, 1)}T01:00:00Z`));
  actuals.set(night, 20_000);
  assert.equal(isSameMorning(snaps.at(-2)!), false);
  assert.equal(isSameMorning(snaps.at(-1)!), false);
  // Kapalı gün ve raporu olmayan gün
  const closed = addDays(today, -11);
  snaps.push(snap(closed, 0, `${closed}T05:00:00Z`, { closed: true }));
  const noReport = addDays(today, -12);
  snaps.push(snap(noReport, 10_000, `${noReport}T05:00:00Z`));
  // Bir hafta önceki tahmin (madeOn ≠ date) sayılmaz
  snaps.push({ ...snap(addDays(today, -1), 50_000, `${addDays(today, -7)}T05:00:00Z`), madeOn: addDays(today, -7) });

  const acc = accuracy(snaps, actuals, today);
  assert.equal(acc.days, 8);
  assert.equal(acc.miss, 8_000 / 80_000);
  assert.equal(acc.bias, 0);
  assert.equal(acc.inRange, 8);
  const status = Object.fromEntries(acc.list.map((r) => [r.date, r.status]));
  assert.equal(status[late], "kayit-yok");
  assert.equal(status[night], "kayit-yok");
  assert.equal(status[closed], "kapali");
  assert.equal(status[noReport], "rapor-yok");
  assert.equal(acc.list[0].date, addDays(today, -1));
  assert.equal(acc.list[0].deviation, 0.1);
  // Bugünün raporu girildiyse listede (ölçüde değil)
  const withToday = accuracy(snaps, new Map([...actuals, [today, 5_000]]), today);
  assert.equal(withToday.list[0].date, today);
  assert.equal(withToday.days, 8);
  // Yön: tahmin düşük kalıyorsa artı
  const low = accuracy(
    snaps.slice(0, 8),
    new Map([...actuals].map(([d]) => [d, 12_000])),
    today,
  );
  assert.ok(Math.abs(low.bias! - 0.2) < 1e-9);
  // 7 günden azsa sapma yok
  const few = accuracy(snaps.slice(0, 6), actuals, today);
  assert.equal(few.days, 6);
  assert.equal(few.miss, null);
  // Geçmiş oranlar aynı kuralla
  const ratios = pastRatios(snaps, actuals, today).sort();
  assert.deepEqual(ratios, [0.9, 0.9, 0.9, 0.9, 1.1, 1.1, 1.1, 1.1]);
  assert.deepEqual(pairFor(snaps, actuals, addDays(today, -1)), { forecast: 10_000, actual: 11_000, deviation: 0.1 });
  assert.equal(pairFor(snaps, actuals, closed), null);
});

// ---------------------------------------------------------------- 17. Metinler

test("metinler: yüzde, gün başlığı, açıklama satırları, veri uyarısı, takvim tablosu", () => {
  assert.equal(signedPct(0.2), "+%20");
  assert.equal(signedPct(-0.08), "−%8");
  assert.equal(signedPct(0.001), "%0");
  assert.equal(dayTitle("2026-10-22", 0), "Bugün · 22 Ekim Perşembe");
  assert.equal(dayTitle("2026-10-23", 1), "Yarın · 23 Ekim Cuma");
  assert.equal(dayTitle("2026-10-24", 2), "24 Ekim Cumartesi");

  const ay = buildForecast(input({ today: "2026-10-22", months: [OCT_2026], days: 8 }));
  const ctx = { forecast: ay, settings: DEFAULT_FORECAST_SETTINGS, roster: 1, mix: MIX, desserts: 7, snapshot: null };
  const lines = explainLines(byDate(ay, "2026-10-29"), ctx);
  assert.equal(lines[0], "Taban: Ekim 2026 ortalaması günde 18.369 ₺ (16 açık gün) × Perşembe payı %95 (varsayılan) = 17.451 ₺.");
  assert.equal(lines[1], "Cumhuriyet Bayramı (hafta içi resmî tatil): +%20 (varsayılan).");
  assert.equal(lines[2], "Tahmin ≈ 20.900 ₺; çoğu gün 14.500–27.500 ₺ arasında kalır (veri az: ±%30).");
  assert.equal(lines[3], "Personel: 20.900 ÷ 10.000 ₺ kişi başı → 3 kişi. Kadroda 1 kişi var.");
  assert.equal(lines[4], "Tatlı: ≈ 7 (Eylül 2026 satışlarına göre her 10.000 ₺'de 4,3 tatlı).");
  assert.ok(explainLines(byDate(ay, "2026-10-28"), ctx).includes("Cumhuriyet Bayramı arifesi (yarım gün tatil): +%10 (varsayılan)."));
  // Bu sabahki kayıt canlıdan %2'den çok farklıysa
  const withSnap = explainLines(byDate(ay, "2026-10-22"), { ...ctx, snapshot: snap("2026-10-22", 16_000, "2026-10-22T05:00:00Z") });
  assert.equal(withSnap.at(-1), "Bu sabah kaydedilen tahmin: 16.000 ₺; tutturma bununla ölçülür.");
  assert.match(qualityBanner(ay)!, /^Henüz kasa raporu yok\. Tahmin şimdilik Ekim 2026 ortalamasına \(günde 18\.369 ₺, 16 açık gün\)/);

  const tam = buildForecast(input({ today: "2026-10-26", history: days("2026-10-05", "2026-10-25", (d) => (d < "2026-10-12" ? 10_000 : d < "2026-10-19" ? 9_000 : 11_000)) }));
  assert.equal(explainLines(byDate(tam, "2026-10-26"), { ...ctx, forecast: tam })[0], "Taban: son 3 Pazartesi gününün ortalaması 10.000 ₺ (ortanca).");
  const ort = buildForecast(input({ today: "2026-12-14", history: days("2026-12-06", "2026-12-13", () => 10_000) }));
  assert.match(explainLines(byDate(ort, "2026-12-14"), { ...ctx, forecast: ort })[0], /^Taban: son 28 günün 8 kasa raporuna göre ortalama gün .+ × Pazartesi payı %85 \(varsayılan\) = /);
  assert.equal(qualityBanner(ort), "Son 28 günde 8 günlük kasa raporu var. Hafta günü farkları şimdilik varsayılan; her gün için 3 rapor birikince kendi verinizden hesaplanır.");

  const table = factorTable(ay);
  assert.deepEqual(table[0], { label: "Hafta içi resmî tatil", effect: "+%20", basis: "varsayılan" });
  assert.equal(table.find((r) => r.label === "Hafta günü payları")?.effect, "Pzt %85 · Sal %85 · Çar %90 · Per %95 · Cum %105 · Cmt %125 · Paz %115");
  assert.equal(table.find((r) => r.label === "Ramazan ayı")?.effect, "−%8");

  assert.equal(specialRow({ dateFrom: "2026-10-31", dateTo: "2026-10-31", kind: "derbi", title: "Fenerbahçe – Galatasaray maçı", effect: 0.15 }), "31 Eki Cmt · Fenerbahçe – Galatasaray maçı · Derbi / maç · +%15");
  assert.equal(specialRow({ dateFrom: "2026-11-16", dateTo: "2026-11-20", kind: "avm", title: "AVM yılbaşı", effect: 0.15 }), "16–20 Kas · AVM yılbaşı · AVM etkinliği · +%15");
  assert.equal(specialRow({ dateFrom: "2026-11-03", dateTo: "2026-11-03", kind: "kapali", title: "Tadilat", effect: -1 }), "3 Kas Sal · Tadilat · Kafe kapalı");
  assert.equal(specialSummary({ dateFrom: "2026-10-31", dateTo: "2026-10-31", kind: "derbi", title: "Maç", effect: 0.15 }), "31 Ekim Cumartesi · Maç (Derbi / maç, +%15)");
});

test("sabah e-postasının kutusu ve Bugün kartının alt satırı: bugün, dün, haftanın en yoğun günü; kapalı gün", () => {
  const today = "2026-10-28";
  const f = buildForecast(input({ today, months: [OCT_2026], weather: [{ date: today, tMax: 18, tMin: 12, precipMm: 7, symbol: "rain", hours: 24 }] }));
  const snaps = [snap("2026-10-27", 17_000, "2026-10-27T05:05:00Z")];
  const actuals = new Map([["2026-10-27", 18_950]]);
  const acc = accuracy(snaps, actuals, today);
  const box = digestForecastBox({ forecast: f, settings: DEFAULT_FORECAST_SETTINGS, plan: dessertPlan(f.days, MIX), snapshots: snaps, actuals, accuracy: acc, yesterday: "2026-10-27", weatherUsed: true })!;
  assert.equal(box.title, "Satış tahmini");
  assert.equal(box.subjectPart, null);
  assert.equal(box.headline, null);
  assert.equal(box.href, "/panel/tahmin");
  const d = f.days[0];
  assert.equal(box.lines[0].text, `Bugün ≈ ${(19_100).toLocaleString("tr-TR")} ₺ (${d.low.toLocaleString("tr-TR")}–${d.high.toLocaleString("tr-TR")}) · yoğunluk normal · 2 kişi (yoğunsa 3) · Cumhuriyet Bayramı arifesi, yağmur`);
  assert.equal(box.lines[1].text, "Dün: tahmin 17.000 ₺, gerçekleşen 18.950 ₺ (+%11)");
  assert.match(box.lines[2].text, /^Haftanın en yoğun günü: Cumartesi ≈ 23\.000 ₺ · 7 günde ≈ \d+ tatlı$/);
  assert.deepEqual(box.lines[3], { text: "Hava durumu: MET Norway verisi (CC BY 4.0)", tone: "muted" });
  assert.equal(cardFooter(f, snaps, actuals, acc, "2026-10-27"), "Dün: tahmin 17.000 ₺, gerçekleşen 18.950 ₺ (+%11)");
  assert.equal(cardFooter(f, snaps, new Map([...actuals, [today, 20_055]]), acc, "2026-10-27"), "Bugün gerçekleşen 20.055 ₺ (+%5)");
  assert.equal(cardFooter(f, [], new Map(), accuracy([], new Map(), today), "2026-10-27"), null);
  // Dünün çifti yoksa satırı yok; hava kapalıysa kaynak satırı yok
  const noY = digestForecastBox({ forecast: f, settings: DEFAULT_FORECAST_SETTINGS, plan: null, snapshots: [], actuals: new Map(), accuracy: acc, yesterday: "2026-10-27", weatherUsed: false })!;
  assert.equal(noY.lines.length, 2);
  assert.match(noY.lines[1].text, /^Haftanın en yoğun günü: Cumartesi ≈ 23\.000 ₺$/);
  const closed = buildForecast(input({ today, months: [OCT_2026], special: [{ id: 1, dateFrom: today, dateTo: today, kind: "kapali", title: "Tadilat", effect: -1 }] }));
  const cbox = digestForecastBox({ forecast: closed, settings: DEFAULT_FORECAST_SETTINGS, plan: null, snapshots: [], actuals: new Map(), accuracy: acc, yesterday: "2026-10-27", weatherUsed: false })!;
  assert.equal(cbox.lines[0].text, "Bugün kafe kapalı olarak işaretli (Tadilat).");
  assert.equal(digestForecastBox({ forecast: buildForecast(input({ today })), settings: DEFAULT_FORECAST_SETTINGS, plan: null, snapshots: [], actuals: new Map(), accuracy: acc, yesterday: "2026-10-27", weatherUsed: false }), null);
});

// ---------------------------------------------------------------- 18. Kaynak ve yetki

function bodyOf(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} yok`);
  const rest = src.slice(start + 1);
  const end = rest.search(/\n(export )?(async )?function |\n(export )?(const|interface|type) /);
  return end < 0 ? rest : rest.slice(0, end);
}

test("kaynak: sayfa ve her eylem yalnız yönetici; menüde Satış & gider altında, personele kapalı", () => {
  const page = read("src/app/panel/tahmin/page.tsx");
  assert.match(page, /await requireAdmin\(\);\s+const data = await loadForecastPage\(\);/);
  const actions = read("src/server/actions/forecast.ts");
  assert.match(actions, /^"use server";/);
  const exported = [...actions.matchAll(/^export async function (\w+)\(/gm)].map((m) => m[1]);
  assert.deepEqual(exported.sort(), ["deleteSpecialDay", "refreshForecastNow", "saveForecastSettings", "saveSpecialDay"]);
  for (const name of exported) assert.match(bodyOf(actions, name), /await requireAdmin\(\)/, name);
  // Eylem dosyasında dışa açık yardımcı yok (her export bir uç)
  assert.doesNotMatch(actions, /^export (const|function|let) /m);
  assert.equal(canOpen("staff", "/panel/tahmin"), false);
  assert.equal(canOpen("admin", "/panel/tahmin"), true);
  assert.equal(mobileTitleFor("/panel/tahmin"), "Satış tahmini");
  const para = NAV_TREE.find((n) => n.id === "para")!.children!.map((c) => c.id);
  assert.equal(para[para.indexOf("kasa-raporlari") + 1], "tahmin");
  const item = NAV_GROUPS.find((g) => g.title === "Günlük")!.items.find((i) => i.href === "/panel/tahmin")!;
  assert.deepEqual(item.roles, ["admin"]);
});

test("kaynak: MET isteği önbelleksiz, kimlikli, 6 sn; önizleme yazmaz; sabah işi tahmini Paraşüt'le aynı anda başlatır", () => {
  const weather = read("src/server/forecast/weather.ts");
  assert.match(weather, /cache: "no-store"/);
  assert.match(weather, /"User-Agent": userAgent\(APP_URL, process\.env\.WEATHER_CONTACT\)/);
  assert.match(weather, /AbortSignal\.timeout\(WEATHER_TIMEOUT_MS\)/);
  assert.match(weather, /WEATHER_TIMEOUT_MS = 6_000/);
  assert.match(weather, /If-Modified-Since/);
  assert.match(weather, /refetchGate\(state, now\)/);
  const job = read("src/server/forecast/job.ts");
  assert.match(job, /process\.env\.VERCEL_ENV !== "preview"/);
  assert.match(bodyOf(job, "runForecastJob"), /if \(!canWriteSnapshots\(\)\) return/);
  assert.match(bodyOf(job, "snapshotForecast"), /if \(!canWriteSnapshots\(\)\) return 0;/);
  assert.match(job, /onConflictDoNothing\(\{ target: \[s\.forecastSnapshots\.date, s\.forecastSnapshots\.madeOn\] \}\)/);
  const route = read("src/app/api/cron/gunluk/route.ts");
  const start = route.indexOf("const forecastP = capped<ForecastJobResult>(");
  assert.ok(start > route.indexOf('startJobRun("gunluk")') && start < route.indexOf("syncParasut("), "tahmin Paraşüt'ün yeniden denemesinden önce başlar");
  assert.ok(route.indexOf("const forecast = await forecastP;") < route.indexOf("runReminderDigest("), "e-postadan önce beklenir");
  assert.equal([...route.matchAll(/\.\.\.fcStep \}\)/g)].length, 2);
  // Sabah e-postasının kutusu haber değil
  assert.match(read("src/server/notify/digest-extras.ts"), /\{ key: "forecast", news: false, load: \(\) => loadForecastDigest\(\) \}/);
  // Saat ilk okumadan sonra (Cache Components)
  const load = read("src/server/forecast/load.ts");
  const core = bodyOf(load, "loadForecastCore");
  assert.ok(core.indexOf("await Promise.all([loadForecastSettings(), loadWeatherState()])") < core.indexOf("const at = now ?? new Date();"));
});

test("kaynak: Bugün'de tahmin kartı yalnız yöneticide, personel satırı yalnız personelde; personele tutar gitmez", () => {
  const src = read("src/server/data/today.ts");
  const admin = bodyOf(src, "adminFacts");
  const staffBody = bodyOf(src, "staffFacts");
  assert.match(admin, /safe\(loadForecastCard\(now\)\)/);
  assert.match(staffBody, /safe\(loadStaffForecast\(\)\)/);
  const noImports = (s: string) => s.replace(/^import .*$/gm, "");
  assert.ok(!noImports(src.replace(admin, "")).includes("loadForecastCard("), "loadForecastCard adminFacts dışında");
  assert.ok(!noImports(src.replace(staffBody, "")).includes("loadStaffForecast("), "loadStaffForecast staffFacts dışında");
  const load = read("src/server/forecast/load.ts");
  const staff = bodyOf(load, "loadStaffForecast");
  assert.match(staff, /return staffView\(core\.forecast, mix\);/);
  assert.match(staff, /if \(!settings\.staffSeesLevel\) return null;/);
  const page = read("src/app/panel/bugun/page.tsx");
  assert.match(page, /\{data\.payments \? <DashboardPayments items=\{data\.payments\} \/> : null\}\s+\{data\.forecast\.admin \? <TodayForecast data=\{data\.forecast\.admin\} \/> : null\}\s+\{cafe\.length \? <TodayCafe lines=\{cafe\} \/> : null\}/);
  assert.match(page, /cafeLines\(data\.cafe, now\.getTime\(\), data\.forecast\.staff\)/);
});
