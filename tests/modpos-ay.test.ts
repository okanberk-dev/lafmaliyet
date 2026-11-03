// ModPOS kasa föyü ay rakamına yedek (docs/MODPOS-API.md › Ay rakamına yedek; src/lib/cash-month.ts): ayar açıkken kasa
// raporu (ve LafPOS gün sonu) olmayan günün kapanmış föyü ayın açık gün, ciro, ödenmez ve kart payına girer; gün yine
// "rapor yok" sayılır, rapor ve LafPOS kazanır, indirim bilinmez, raporlar başlamadan önceki föy günleri eksik aranmaz.
// ModPOS satırı yokken (ayar kapalı) çıktı bugünküyle birebir aynıdır: altın dosya
// (tests/fixtures/ay-bilgisi-modpossuz.golden.json) değişiklikten önceki kodun aynı senaryolardaki çıktısıdır.
//
// Çalıştırma: npx tsx --test tests/modpos-ay.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { kasaHint } from "../src/app/panel/satislar/sales-logic";
import { createModel } from "../src/lib/calc/engine";
import type { Dataset, MonthField, TillMonth } from "../src/lib/calc/types";
import * as lib from "../src/lib/cash-month";
import { isReportRow, kasaMonthLine, kasaValues, missingSentence, modposRunStart, partialSentence, resolveMonth, tillMonths, type MonthEntry, type TillRow } from "../src/lib/cash-month";
import { addDays } from "../src/lib/reminders";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** Bölünmez boşluk (₺ ve gün-ay arası) düz boşluğa */
const plain = (s: string | null) => (s ?? "").replace(/ /g, " ");

const row = (date: string, o: Partial<TillRow> = {}): TillRow => ({ date, zTotal: 10_000, card: 7_000, mealCard: 1_000, discounts: null, offRevenue: null, ...o });
/** Föyün yedek satırı (cash-reports.ts modposTillRow'un biçimi): indirim yok */
const foy = (date: string, o: Partial<TillRow> = {}): TillRow => row(date, { zTotal: 8_000, card: 5_000, mealCard: 1_000, offRevenue: 50, receipts: 40, ...o, discounts: null, source: "modpos" });
const range = (from: string, to: string, make: (d: string) => TillRow, skip: string[] = []) => {
  const out: TillRow[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (!skip.includes(d)) out.push(make(d));
  return out;
};
const entry = (month: string, o: Partial<MonthEntry> = {}): MonthEntry => ({ month, openDays: null, posRevenue: null, discounts: null, offRevenue: null, cardShare: null, note: null, ...o });

// ---------------------------------------------------------------- Ayar kapalı: bugünküyle birebir aynı

type Hint = (f: MonthField, kasa: { values: Record<MonthField, number | null>; till: TillMonth } | null, mode: "kasa" | "elle", typed: string) => string | null;
type Lib = Pick<typeof lib, "tillMonths" | "missingSentence" | "partialSentence" | "kasaMonthLine" | "resolveMonth" | "kasaValues" | "resolveMonths">;

/**
 * ModPOS satırı olmayan senaryolar (rapor, LafPOS yedek satırı, onay bekleyen, kapalı işaretli, ilk ay, tek satır…) ve
 * her ayın bütün metinleri. Altın dosya bu işlevin değişiklikten önceki kodla (8aef74b) çıktısıdır
 */
function scenarios(l: Lib, hint: Hint): Record<string, string> {
  type Row = TillRow;
  const add = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const r = (date: string, o: Partial<Row> = {}): Row => ({ date, zTotal: 10_000, card: 7_000, mealCard: 1_000, discounts: null, offRevenue: null, ...o });
  const span = (from: string, to: string, o: (d: string) => Partial<Row> = () => ({}), skip: string[] = []) => {
    const out: Row[] = [];
    for (let d = from; d <= to; d = add(d, 1)) if (!skip.includes(d)) out.push(r(d, o(d)));
    return out;
  };
  const e = (month: string, o: Partial<MonthEntry> = {}): MonthEntry => ({ month, openDays: null, posRevenue: null, discounts: null, offRevenue: null, cardShare: null, note: null, ...o });
  const disc = (d: string) => ({ discounts: d <= "2026-11-12" ? 100 : null, offRevenue: d <= "2026-11-15" ? 50 : null });
  const cases: Record<string, Parameters<Lib["tillMonths"]>> = {
    tamAy: [span("2026-11-01", "2026-11-30", disc, ["2026-11-05", "2026-11-12", "2026-11-20"]), "2026-12-10"],
    kasaSayfasi: [span("2026-11-01", "2026-11-30", disc, ["2026-11-05"]), "2026-12-10", "2026-10-20"],
    ilkAy: [[...span("2026-10-20", "2026-10-31"), ...span("2026-11-01", "2026-11-17", disc)], "2026-11-17"],
    lafpos: [
      [r("2026-11-01"), r("2026-11-02"), r("2026-11-02", { zTotal: 99_999, source: "lafpos" }), r("2026-11-03", { zTotal: 6_000, card: 3_000, discounts: 120, source: "lafpos" })],
      "2026-11-05",
      "2026-11-01",
    ],
    bekleyenKapali: [
      [r("2026-11-01"), r("2026-11-02"), r("2026-11-03", { zTotal: 0, card: 0, mealCard: 0, receipts: 0, source: "lafpos" }), r("2026-11-05"), r("2026-11-06", { zTotal: 500, card: 0, receipts: 3, source: "lafpos" })],
      "2026-11-08",
      null,
      ["2026-11-04"],
      ["2026-11-03", "2026-11-06"],
    ],
    yalnizLafpos: [[r("2026-11-10", { source: "lafpos", receipts: 20 }), r("2026-11-12", { source: "lafpos", receipts: 5 })], "2026-11-13"],
    tekSatir: [[r("2026-11-07", { zTotal: 0, card: 0, mealCard: 0 })], "2026-11-07", null],
    ayniGunIkiRapor: [[r("2026-11-01"), r("2026-11-01", { zTotal: 5_000 }), r("2026-11-02")], "2026-11-02"],
    lafposRapordanOnce: [[r("2026-10-30", { source: "lafpos" }), r("2026-10-31", { source: "lafpos", zTotal: 0, receipts: 0 }), ...span("2026-11-01", "2026-11-03")], "2026-11-03", undefined, [], ["2026-10-31"]],
    bos: [[], "2026-11-30"],
  };
  const out: Record<string, string> = {};
  for (const [name, args] of Object.entries(cases)) {
    const tills = l.tillMonths(...args);
    const texts = tills.map((t) => {
      const m = t.month;
      const infos = [undefined, e(m, { openDays: 25, posRevenue: 310_000 }), e(m, { posRevenue: 310_000 }), e(m, { openDays: 20 })].map((x) => l.resolveMonth(m, x, t));
      return {
        missing: l.missingSentence(t),
        partial: t.partialFrom ? l.partialSentence(t) : null,
        lines: infos.map((i) => l.kasaMonthLine(i)),
        values: l.kasaValues(t),
        hints: (["openDays", "posRevenue", "discounts", "offRevenue", "cardShare"] as const).flatMap((f) => [hint(f, infos[0].kasa ?? null, "kasa", ""), hint(f, infos[1].kasa ?? null, "elle", "5")]),
      };
    });
    out[name] = JSON.stringify({ tills, texts, months: l.resolveMonths([e("2026-11", { note: "not" })], tills) });
  }
  return out;
}

test("ayar kapalı (ModPOS satırı yok): ay bilgisi, metinler ve ipuçları değişiklikten öncekiyle birebir aynı (altın dosya)", () => {
  const golden = JSON.parse(read("tests/fixtures/ay-bilgisi-modpossuz.golden.json")) as Record<string, string>;
  const now = scenarios(lib, kasaHint);
  assert.deepEqual(Object.keys(now), Object.keys(golden));
  for (const k of Object.keys(golden)) assert.equal(now[k], golden[k], k);
  // Yeni parametre (ilk kasa raporu) ModPOS yokken ilk satırla aynı günü verince de aynı
  const rows = range("2026-11-01", "2026-11-30", (d) => row(d), ["2026-11-05"]);
  assert.deepEqual(tillMonths(rows, "2026-12-01", "2026-10-20", undefined, undefined, "2026-10-20"), tillMonths(rows, "2026-12-01", "2026-10-20"));
  assert.deepEqual(tillMonths(rows, "2026-12-01", undefined, undefined, undefined, "2026-11-01"), tillMonths(rows, "2026-12-01"));
  // Alan yalnız föy günü varken
  assert.equal("modpos" in tillMonths(rows, "2026-12-01")[0], false);
});

test("isReportRow: kaynağı olmayan satır kasa raporu; LafPOS ve ModPOS yedek satırları değil", () => {
  assert.equal(isReportRow(row("2026-11-01")), true);
  assert.equal(isReportRow(row("2026-11-01", { source: "lafpos" })), false);
  assert.equal(isReportRow(foy("2026-11-01")), false);
});

// ---------------------------------------------------------------- Föy günü aya girer, gün "rapor yok" kalır

test("föy günü ciroya, açık güne, kart payına ve ödenmeze girer; gün yine eksik, 'ModPOS föyünden sayıldı'", () => {
  const rows = [row("2026-11-01", { discounts: 100, offRevenue: 20 }), foy("2026-11-02"), row("2026-11-03", { discounts: 100, offRevenue: 30 })];
  const [m] = tillMonths(rows, "2026-11-03", "2026-10-16");
  assert.equal(m.reported, 2, "yalnız kasa raporları");
  assert.equal(m.posRevenue, 28_000);
  assert.equal(m.openDays, 3);
  assert.equal(m.cardShare, Math.round(((8_000 + 8_000 + 6_000) / 28_000) * 10_000) / 10_000);
  assert.equal(m.bankShare, Math.round(((7_000 + 7_000 + 5_000) / 28_000) * 10_000) / 10_000, "banka payı föyün KREDI_KARTI'sıyla");
  assert.equal(m.offRevenue, 100);
  assert.equal(m.offDays, 3);
  // Föyde indirim yok: o günün indirimi bilinmez, ay yalnız girilen günlerden
  assert.equal(m.discounts, 200);
  assert.equal(m.discountDays, 2);
  assert.deepEqual(m.missing, ["2026-11-02"]);
  assert.deepEqual(m.modpos, ["2026-11-02"]);
  assert.equal("lafpos" in m, false);
  assert.equal(m.lastDate, "2026-11-03");
  assert.equal(plain(missingSentence(m)), "1 gün rapor yok: 2 Kasım. Ciro ve açık gün bu günlerde ModPOS föyünden sayıldı.");
  // Bir kısmı föyden
  const [some] = tillMonths([row("2026-11-01"), foy("2026-11-02")], "2026-11-04", "2026-10-16");
  assert.equal(plain(missingSentence(some)), "3 gün rapor yok: 2, 3, 4 Kasım. 1 günün cirosu ModPOS föyünden sayıldı; ötekiler açıksanız ciro ve açık gün eksik kalır.");
  // Satışlar'ın ipucu: payda raporlu gün + föy günü
  const info = resolveMonth("2026-11", undefined, m);
  assert.equal(kasaHint("posRevenue", info.kasa!, "kasa", ""), "Kasa raporlarından (2 gün + ModPOS föyünden 1 gün). Değiştirmek için dokunun.");
  assert.equal(kasaHint("discounts", info.kasa!, "kasa", ""), "Kasa raporlarından (2 / 3 günde girildi). Değiştirmek için dokunun.");
  assert.equal(kasaHint("offRevenue", info.kasa!, "kasa", ""), "Kasa raporlarından (3 / 3 günde girildi). Değiştirmek için dokunun.");
});

test("aynı gün: rapor föyü, LafPOS gün sonu föyü yener (rapor > LafPOS > ModPOS)", () => {
  const [byReport] = tillMonths([row("2026-11-01"), foy("2026-11-01", { zTotal: 99_999 })], "2026-11-01", "2026-11-01");
  assert.equal(byReport.posRevenue, 10_000);
  assert.equal(byReport.reported, 1);
  assert.deepEqual(byReport.missing, []);
  assert.equal("modpos" in byReport, false);
  const [byLafpos] = tillMonths([row("2026-11-01"), row("2026-11-02", { zTotal: 6_000, source: "lafpos" }), foy("2026-11-02", { zTotal: 99_999 })], "2026-11-02", "2026-11-01");
  assert.equal(byLafpos.posRevenue, 16_000);
  assert.deepEqual(byLafpos.lafpos, ["2026-11-02"]);
  assert.equal("modpos" in byLafpos, false);
  assert.equal(plain(missingSentence(byLafpos)), "1 gün rapor yok: 2 Kasım. Ciro ve açık gün bu günlerde LafPOS'un gün sonundan sayıldı.");
  // Geçiş ayı: geçiş gününden önce föy, sonra LafPOS
  const [both] = tillMonths([row("2026-11-01"), foy("2026-11-02"), row("2026-11-03", { source: "lafpos" })], "2026-11-04", "2026-10-16");
  assert.deepEqual([both.lafpos, both.modpos], [["2026-11-03"], ["2026-11-02"]]);
  assert.equal(
    plain(missingSentence(both)),
    "3 gün rapor yok: 2, 3, 4 Kasım. 1 günün cirosu LafPOS'un gün sonundan, 1 günün cirosu ModPOS föyünden sayıldı; ötekiler açıksanız ciro ve açık gün eksik kalır.",
  );
  const [all] = tillMonths([row("2026-11-01"), foy("2026-11-02"), row("2026-11-03", { source: "lafpos" })], "2026-11-03", "2026-10-16");
  assert.equal(plain(missingSentence(all)), "2 gün rapor yok: 2, 3 Kasım. Ciro ve açık gün bu günlerde LafPOS'un gün sonundan ve ModPOS föyünden sayıldı.");
});

// ---------------------------------------------------------------- Raporlardan önceki föy günleri

/** Föyler 1 Temmuz'dan (5 Ekim'in föyü yok), kasa raporları 16 Ekim'den (20 Ekim'in raporu yok); 1 Kasım raporsuz, föylü */
function history(): TillRow[] {
  return [
    ...range("2026-07-01", "2026-10-15", (d) => foy(d)),
    ...range("2026-10-16", "2026-10-31", (d) => row(d), ["2026-10-20"]),
    foy("2026-11-01"),
    row("2026-11-02"),
  ];
}

test("raporlar başlamadan önceki föy günleri eksik aranmaz; ilk ay (partialFrom) ilk satırdan; sonrası yine eksik", () => {
  // Veri kümesinin çağrısı (bütün satırlar, ilk gün satırlardan)
  const months = tillMonths(history(), "2026-11-02");
  assert.deepEqual(
    months.map((m) => m.month),
    ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11"],
  );
  const [jul, , sep, oct, nov] = months;
  assert.equal(jul.partialFrom, null, "föyler ayın 1'inden: Temmuz tam");
  assert.deepEqual(jul.missing, [], "raporlar başlamadan: eksik aranmaz");
  assert.equal(jul.reported, 0);
  assert.equal(jul.modpos?.length, 31);
  assert.equal(jul.openDays, 31);
  assert.equal(jul.posRevenue, 248_000);
  assert.deepEqual(sep.missing, []);
  // Ekim: 1–15 föy, 16'dan raporlar; eksik yalnız 16 Ekim'den
  assert.equal(oct.partialFrom, null);
  assert.equal(oct.from, "2026-10-01");
  assert.deepEqual(oct.missing, ["2026-10-20"]);
  assert.equal(oct.reported, 15);
  assert.equal(oct.modpos?.length, 15);
  assert.equal(oct.posRevenue, 15 * 10_000 + 15 * 8_000);
  assert.equal(plain(missingSentence(oct)), "1 gün rapor yok: 20 Ekim. O günler açıksanız ciro ve açık gün eksik kalır.");
  // Toplamlar uygulanır (ay tam), Satışlar'daki satır kaç günün föyden geldiğini söyler
  assert.equal(kasaValues(oct).posRevenue, oct.posRevenue);
  assert.equal(kasaMonthLine(resolveMonth("2026-10", undefined, oct)), "Bu ayın açık gün ve cirosu kasa raporlarından (15 gün ModPOS föyünden sayıldı)");
  assert.equal(kasaMonthLine(resolveMonth("2026-07", undefined, jul)), "Bu ayın açık gün ve cirosu ModPOS föyünden");
  assert.equal(plain(kasaMonthLine(resolveMonth("2026-07", entry("2026-07", { openDays: 30, posRevenue: 250_000 }), jul))), "Bu ayın açık gün ve cirosu elle girildi (ModPOS föyünde 31 gün, 248.000 ₺)");
  assert.equal(
    plain(kasaMonthLine(resolveMonth("2026-10", entry("2026-10", { openDays: 30, posRevenue: 250_000 }), oct))),
    "Bu ayın açık gün ve cirosu elle girildi (kasa raporlarında 30 gün, 270.000 ₺; 15 günü ModPOS föyünden)",
  );
  assert.equal(kasaMonthLine(resolveMonth("2026-10", entry("2026-10", { posRevenue: 250_000 }), oct)), "Bu ayın açık günü kasa raporlarından (15 gün ModPOS föyünden sayıldı), cirosu elle girildi");
  // İlk rapordan sonraki raporsuz föy günü eksiktir
  assert.deepEqual(nov.missing, ["2026-11-01"]);
  assert.equal(plain(missingSentence(nov)), "1 gün rapor yok: 1 Kasım. Ciro ve açık gün bu günlerde ModPOS föyünden sayıldı.");

  // Kasa sayfasının çağrısı (yalnız ayın satırları; ilk satır ve ilk kasa raporu ayrı) aynı sonucu verir
  for (const month of ["2026-07", "2026-10", "2026-11"]) {
    const own = history().filter((r) => r.date.slice(0, 7) === month);
    const [kasa] = tillMonths(own, "2026-11-02", "2026-07-01", undefined, undefined, "2026-10-16");
    const full = months.find((m) => m.month === month)!;
    assert.deepEqual(kasa, full, month);
    assert.equal(kasaMonthLine(resolveMonth(month, undefined, kasa)), kasaMonthLine(resolveMonth(month, undefined, full)), month);
  }
});

test("raporlar başlamadan önceki föylerde boşluk: öncesi sayılmaz, ilk ay boşluktan sonra yarım; tek tek elle çekilmiş eski gün ayı tam yapmaz", () => {
  // 5 Ekim'in föyü yok (alınamadı): Temmuz–4 Ekim sayılmaz, Ekim 6'dan yarım (toplamı uygulanmaz)
  const gap = [...range("2026-07-01", "2026-10-15", (d) => foy(d), ["2026-10-05"]), ...range("2026-10-16", "2026-10-31", (d) => row(d))];
  const months = tillMonths(gap, "2026-10-31");
  assert.deepEqual(months.map((m) => m.month), ["2026-10"]);
  assert.equal(months[0].partialFrom, "2026-10-06");
  assert.equal(kasaValues(months[0]).posRevenue, null);
  assert.equal(plain(partialSentence(months[0])), "ModPOS föyleri 6 Ekim'den itibaren var; bu ayın ciro, açık gün, indirim ve ödenmezi elle girilir. Kartlı oran kasadan.");
  // Boşluk satışsız kapalı günse (sıfır satır) kesinti yok
  const closedGap = gap.concat(foy("2026-10-05", { zTotal: 0, card: 0, mealCard: 0, offRevenue: 0, receipts: 0 }));
  const all = tillMonths(closedGap, "2026-10-31");
  assert.deepEqual(all.map((m) => m.month), ["2026-07", "2026-08", "2026-09", "2026-10"]);
  assert.equal(all[3].partialFrom, null);
  assert.equal(all[3].openDays, 14 + 16);
  // Elle çekilmiş tek eski gün (1 Haziran) + 20 Ekim'den raporlar: Haziran sayılmaz, Ekim bugünkü gibi yarım
  const odd = [foy("2026-06-01"), ...range("2026-10-20", "2026-10-31", (d) => row(d))];
  const [oct] = tillMonths(odd, "2026-10-31");
  assert.equal(oct.month, "2026-10");
  assert.equal(oct.partialFrom, "2026-10-20");
  assert.equal(kasaValues(oct).posRevenue, null);
  // Yalnız bir ayın satırlarını veren çağıran (Kasa) başını verir: aynı sonuç
  assert.equal(modposRunStart(odd.filter((r) => r.source === "modpos").map((r) => r.date), "2026-10-20"), "2026-10-20");
  assert.deepEqual(tillMonths(odd.filter((r) => r.date.startsWith("2026-06")), "2026-10-31", "2026-10-20", undefined, undefined, "2026-10-20", "2026-10-20"), []);
});

test("föyler geriye doğru tamamlanırken ilk ay yarım: 'ModPOS föyleri … itibaren var'; yalnız föy varken eksik aranmaz", () => {
  const rows = [...range("2026-09-12", "2026-09-30", (d) => foy(d)), ...range("2026-10-01", "2026-10-03", (d) => row(d))];
  const [sep, oct] = tillMonths(rows, "2026-10-03");
  assert.equal(sep.partialFrom, "2026-09-12");
  assert.equal(kasaValues(sep).posRevenue, null, "toplam ayın yalnız bir kısmı: uygulanmaz");
  assert.equal(plain(partialSentence(sep)), "ModPOS föyleri 12 Eylül'den itibaren var; bu ayın ciro, açık gün, indirim ve ödenmezi elle girilir. Kartlı oran kasadan.");
  assert.equal(plain(kasaMonthLine(resolveMonth("2026-09", undefined, sep))), "ModPOS föyleri 12 Eylül'den itibaren var; bu ayın açık gün ve cirosu elle girilir");
  assert.equal(oct.partialFrom, null);
  // Kasa raporlarıyla başlayan ilk ayın metni değişmez
  const [first] = tillMonths(range("2026-10-20", "2026-10-31", (d) => row(d)), "2026-10-31");
  assert.equal(plain(partialSentence(first)), "Kasa raporları 20 Ekim'de başladı; bu ayın ciro, açık gün, indirim ve ödenmezi elle girilir. Kartlı oran kasadan.");
  // Hiç kasa raporu (ve LafPOS) yokken eksik gün aranmaz
  // Yalnız föy varken de kesintisiz kısım: 2 Eylül'ün föyü yok, 1 Eylül sayılmaz
  const [only] = tillMonths([foy("2026-09-01"), foy("2026-09-03")], "2026-09-30");
  assert.deepEqual(only.missing, []);
  assert.deepEqual(only.modpos, ["2026-09-03"]);
  assert.equal(only.partialFrom, "2026-09-03");
  assert.deepEqual(tillMonths([foy("2026-09-01")], "2026-09-30", undefined, undefined, undefined, null)[0].missing, []);
});

test("kapalı işaretli gün yalnız satışlı föyle 'rapor yok' olur; satışsız föy kapalı kalır", () => {
  const idle = foy("2026-11-02", { zTotal: 0, card: 0, mealCard: 0, offRevenue: 0, receipts: 0 });
  const [shut] = tillMonths([row("2026-11-01"), idle, row("2026-11-03")], "2026-11-03", "2026-11-01", [], ["2026-11-02"]);
  assert.deepEqual(shut.missing, []);
  assert.deepEqual(shut.closed, ["2026-11-02"]);
  assert.equal(shut.openDays, 2, "satışsız föy açık gün değil");
  assert.equal(plain(missingSentence(shut)), "1 gün kapalı işaretli: 2 Kasım.");
  for (const sold of [{ zTotal: 4_000, receipts: 12 }, { zTotal: 0, receipts: 3 }]) {
    const [m] = tillMonths([row("2026-11-01"), foy("2026-11-02", sold), row("2026-11-03")], "2026-11-03", "2026-11-01", [], ["2026-11-02"]);
    assert.deepEqual(m.missing, ["2026-11-02"]);
    assert.deepEqual(m.closed, []);
  }
});

test("föy günlerinin indirimi bilinmez: yalnız föylü ayda indirim boş, varsayılan 0 ve kaynağı 'none'", () => {
  const [jul] = tillMonths(range("2026-07-01", "2026-07-31", (d) => foy(d)), "2026-08-01");
  assert.equal(jul.discounts, null);
  assert.equal(jul.discountDays, 0);
  assert.equal(jul.offRevenue, 31 * 50);
  const info = resolveMonth("2026-07", undefined, jul);
  assert.deepEqual([info.discounts, info.sources?.discounts], [0, "none"]);
  assert.deepEqual([info.posRevenue, info.sources?.posRevenue, info.openDays, info.offRevenue], [248_000, "kasa", 31, 1_550]);
  assert.equal(kasaHint("posRevenue", info.kasa!, "kasa", ""), "ModPOS föyünden (31 gün). Değiştirmek için dokunun.");
  assert.equal(kasaHint("offRevenue", info.kasa!, "kasa", ""), "ModPOS föyünden (31 / 31 günde girildi). Değiştirmek için dokunun.");
  assert.equal(kasaHint("discounts", info.kasa!, "kasa", ""), null, "indirim kasadan gelmez");
  // Motor: Gelir-gider'in POS komisyonu föyün banka kartı payıyla (kart ÷ ciro; yemek kartı hariç, E-43)
  const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
  const ds: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
  const [nov] = tillMonths(range("2026-11-01", "2026-11-30", (d) => foy(d)), "2026-12-01");
  const model = createModel({ ...ds, months: [...ds.months, resolveMonth("2026-11", undefined, nov)] });
  assert.deepEqual(model.cardShareOf("2026-11"), { rate: 0.75, source: "kasa" });
  assert.equal(model.bankShareOf("2026-11").rate, 0.625);
});

// ---------------------------------------------------------------- Kaynak: yükleyici ve çağıranlar

test("kaynak: yedek kapalıyken föy tablosu okunmaz; yükleyici rapor > LafPOS > ModPOS; rapor sınaması tek yerden", () => {
  const loader = read("src/server/data/cash-reports.ts");
  const fn = loader.slice(loader.indexOf("export async function modposTillRows("));
  assert.ok(fn.indexOf("if (end === null) return [];") > 0);
  assert.ok(fn.indexOf("if (end === null) return [];") < fn.indexOf("await loadModposSheets("), "ayar okunmadan föy okunmaz");
  const first = loader.slice(loader.indexOf("export async function firstModposTillDay("));
  assert.ok(first.indexOf("if (end === null) return null;") > 0);
  assert.ok(first.indexOf("if (end === null) return null;") < first.indexOf("modposTillRows(db)"), "ayar okunmadan föy okunmaz");
  const scope = loader.slice(loader.indexOf("async function modposFallbackEnd("));
  assert.match(scope, /if \(!readModposFallback\(value\(MODPOS_FALLBACK_KEY\)\)\) return null;/);
  assert.match(scope, /return switchDay === null \? MODPOS_LAST_DAY : addDays\(switchDay, -1\);/, "geçiş gününden önce");
  assert.match(loader, /if \(sheet\.state === "ACIK"\) return null;/);
  assert.match(loader, /sheet\.state === "BOS" && !\(z && z\.foysuz && z\.zTotal > 0\)/);
  // Kesinleşmiş satışsız gün sıfır satır (kesintisiz sayımda kapalı gün boşluk değil)
  assert.match(loader, /return sheet\.final \? \{ date: sheet\.day, zTotal: 0, card: 0, mealCard: 0, discounts: null, offRevenue: 0, receipts: 0, source: "modpos" \} : null;/);
  // tillRows raporlardan önceki föyleri kesintisiz kısma indirir
  assert.match(loader, /const runFrom = modposRunStart\(modpos\.map\(\(r\) => r\.date\), firstReport\) \?\? "";/);
  assert.match(loader, /discounts: null, offRevenue: z\.offRevenue, receipts: z\.receipts, source: "modpos"/);
  assert.match(loader, /lafposTillRows\(db\),\n\s+modposTillRows\(db\),\n\s+\]\);/);
  // Rapor sınaması: `source !== "lafpos"` kalmadı (ModPOS satırını rapor sanardı)
  for (const f of ["src/lib/cash-month.ts", "src/server/data/dataset.ts", "src/server/data/cash-reports.ts"]) assert.doesNotMatch(read(f), /r\.source !== "lafpos"/, f);
  const dataset = read("src/server/data/dataset.ts");
  assert.match(dataset, /till\.filter\(\(r\) => isReportRow\(r\) \|\| r\.zTotal > 0 \|\| \(r\.receipts \?\? 0\) > 0\)/, "kapalı gün: satışlı yedek de açar");
  assert.match(dataset, /upto, firstEver, undefined, undefined, firstReport\)\[0\] \?\? null/, "satış dönemi de ilk rapordan arar");
  // Kasa'nın ay satırı Gelir-gider'le aynı satırlar ve ilk günle
  const page = read("src/app/panel/kasa/page.tsx");
  assert.match(page, /modposTillRows\(getDb\(\), `\$\{month\}-01`, monthEnd\), firstModposTillDay\(getDb\(\)\)/);
  assert.match(page, /tillMonths\(\[\.\.\.monthReports, \.\.\.monthLafpos, \.\.\.monthModpos\], addDays\(today, -1\), firstRow, undefined, undefined, firstEver \?\? undefined, firstModpos\)/);
});
