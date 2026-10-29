// Vergi takvimi (plan docs/planlar/vergi.md §3.1, §3.12, §4.1, §8.1, §11-G): VUK 18 kaydırması (hafta sonu, resmî
// tatil ve bayram; arife kaydırmaz; tablo 2028'de biter), nominal günler, hesap dönemi ve çeyrekler, hatırlatıcı
// gününden dönem, varsayılan yıl ve çeyrek; Excel verisinde 24.10.2026'nın takvimi, üç rakam, Başlarken, geçici ve
// kurumlar vergisi kartları ve nakit planının vergi beslemesi (view.ts).
// Çalıştırma: npx tsx --test tests/vergi-takvim.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { buildCashPlan, planInputFromModel } from "../src/lib/cash-plan";
import { createModel, shiftMonth } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import type { ReminderRow } from "../src/lib/reminders";
import type { TaxFiling } from "../src/lib/tax/corporate";
import { type MuhtasarItem, muhtasarItemsFromModel } from "../src/lib/tax/muhtasar";
import { taxPnlInputFromModel } from "../src/lib/tax/pnl";
import type { TaxSettings } from "../src/lib/tax/settings";
import { buildTaxView, type TaxView } from "../src/lib/tax/view";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

import {
  defaultQuarter,
  defaultYear,
  legalDayText,
  legalDueDate,
  mphbPeriodOf,
  nominalDue,
  periodOf,
  periodQuarters,
  quarterLabel,
  quarterOfDue,
  quarterRange,
  shiftText,
  yearOptions,
} from "../src/lib/tax/calendar";
import { DEFAULT_TAX_SETTINGS } from "../src/lib/tax/settings";

const S = DEFAULT_TAX_SETTINGS;
const plain = (s: string | null) => s?.replace(/ /g, " ") ?? null;

test("G: legalDueDate (VUK 18)", () => {
  const cases: [string, string][] = [
    ["2026-10-25", "2026-10-26"], // Pazar
    ["2026-11-28", "2026-11-30"], // Cumartesi
    ["2026-10-31", "2026-11-02"], // Cumartesi
    ["2026-10-29", "2026-10-30"], // Cumhuriyet Bayramı, Perşembe
    ["2026-10-28", "2026-10-28"], // arife kaydırmaz
    ["2026-05-17", "2026-05-18"], // Pazar
    ["2027-03-10", "2027-03-12"], // Ramazan Bayramı
    ["2026-12-26", "2026-12-28"], // Cumartesi
    ["2027-01-31", "2027-02-01"], // Pazar
    ["2029-01-06", "2029-01-08"], // tablo dışı Cumartesi
    ["2028-12-31", "2029-01-02"], // Pazar; 1 Ocak 2029 Yılbaşı (her yıl aynı gün, tablo dışında da)
    ["2026-11-17", "2026-11-17"], // Salı
    ["2026-05-26", "2026-05-26"], // Kurban arifesi
    ["2026-05-27", "2026-06-01"], // Kurban Bayramı 27–30 Mayıs, 31 Mayıs Pazar
  ];
  for (const [input, out] of cases) assert.equal(legalDueDate(input).date, out, input);
  assert.deepEqual(legalDueDate("2026-10-25"), { date: "2026-10-26", nominal: "2026-10-25", shifted: true, reason: "25 Ekim Pazar" });
  assert.equal(legalDueDate("2026-10-29").reason, "29 Ekim Cumhuriyet Bayramı");
  assert.equal(legalDueDate("2026-10-28").shifted, false);
  assert.equal(legalDueDate("2026-10-28").reason, null);
  assert.equal(legalDueDate("2029-01-06").reason, "tatil listesi 2028'de bitiyor");
  assert.equal(legalDueDate("2029-01-03").reason, "tatil listesi 2028'de bitiyor");
  // Kasım 2028 SGK'sı (31.12.2028 Pazar): tablonun içindeki gün 2029'a kayar, kapsam notu düşer
  assert.deepEqual(legalDueDate("2028-12-31"), { date: "2029-01-02", nominal: "2028-12-31", shifted: true, reason: "tatil listesi 2028'de bitiyor" });
  assert.equal(plain(shiftText(legalDueDate("2028-12-31"))), "Son gün 31 Aralık Pazar → 2 Ocak (tatil listesi 2028'de bitiyor)");
  assert.equal(legalDueDate("2029-04-23").date, "2029-04-24", "23 Nisan 2029 Pazartesi, tablo dışında da tatil");
  assert.equal(plain(shiftText(legalDueDate("2026-10-25"))), "Son gün 25 Ekim Pazar → 26 Ekim");
  assert.equal(shiftText(legalDueDate("2026-11-17")), null);
  assert.equal(legalDayText(legalDueDate("2026-10-31")), "son gün 2 Kasım Pazartesi (31 Ekim Cumartesi)");
  assert.equal(legalDayText(legalDueDate("2026-11-26")), "son gün 26 Kasım Perşembe");
});

test("G: nominal günler", () => {
  assert.equal(nominalDue("kdv1", "2026-09"), "2026-10-28");
  assert.equal(nominalDue("kdv2", "2026-09"), "2026-10-25");
  assert.equal(nominalDue("mphb", "2026-09"), "2026-10-26");
  assert.equal(nominalDue("sgk", "2026-09"), "2026-10-31");
  assert.equal(nominalDue("sgk", "2026-12"), "2027-01-31");
  assert.equal(nominalDue("sgk", "2027-01"), "2027-02-28");
  assert.equal(nominalDue("gecici", "2026-Q1"), "2026-05-17");
  assert.equal(nominalDue("gecici", "2026-Q2"), "2026-08-17");
  assert.equal(nominalDue("gecici", "2026-Q3"), "2026-11-17");
  assert.equal(nominalDue("gecici", "2026-Q4"), "2027-02-17");
  assert.equal(nominalDue("kv", "2026"), "2027-04-30");
  assert.equal(nominalDue("ctv", "2026-1"), "2026-05-31");
  assert.equal(nominalDue("ctv", "2026-2"), "2026-11-30");
  assert.equal(legalDueDate(nominalDue("kv", "2026")).date, "2027-04-30");
});

test("G: hatırlatıcı gününden dönem", () => {
  assert.equal(quarterOfDue("2027-02-17"), "2026-Q4");
  assert.equal(quarterOfDue("2026-11-17"), "2026-Q3");
  assert.equal(quarterOfDue("2026-08-17"), "2026-Q2");
  assert.equal(quarterOfDue("2026-05-17"), "2026-Q1");
  // Ertelenmiş kopya (asıl günü ayrıca okunur) ve tatil kayması
  assert.equal(quarterOfDue("2026-11-24"), "2026-Q3");
  assert.equal(quarterOfDue("2026-12-01"), "2026-Q3");
  assert.equal(quarterOfDue("2027-03-01"), "2026-Q4");
  assert.equal(quarterLabel("2026-Q3"), "2026/3");
  assert.equal(mphbPeriodOf("2026-10-26"), "2026-09");
  assert.equal(mphbPeriodOf("2026-11-02"), "2026-09");
  assert.equal(mphbPeriodOf("2026-11-26"), "2026-10");
});

test("G: hesap dönemi 25.06–31.12.2026; Q1 dönem dışı, Q2 25.06–30.06", () => {
  assert.deepEqual(periodOf(2026, S), { from: "2026-06-25", to: "2026-12-31" });
  assert.deepEqual(periodOf(2027, S), { from: "2027-01-01", to: "2027-12-31" });
  assert.equal(periodOf(2025, S), null);
  assert.equal(quarterRange("2026-Q1", S), null);
  assert.deepEqual(quarterRange("2026-Q2", S), { from: "2026-06-25", to: "2026-06-30" });
  assert.deepEqual(quarterRange("2026-Q3", S), { from: "2026-07-01", to: "2026-09-30" });
  assert.deepEqual(
    periodQuarters(2026, S).map((q) => q.key),
    ["2026-Q2", "2026-Q3", "2026-Q4"],
  );
  assert.equal(periodQuarters(2027, S).length, 4);
});

test("G: varsayılan yıl ve çeyrek; yıl seçicisi 2026 boyunca yok", () => {
  assert.equal(defaultYear("2027-03-01", [], S), 2026);
  assert.equal(defaultYear("2027-03-01", [{ period: "2026" }], S), 2027);
  assert.equal(defaultYear("2027-04-30", [], S), 2026);
  assert.equal(defaultYear("2027-05-01", [], S), 2027);
  assert.equal(defaultYear("2026-10-24", [], S), 2026);
  assert.deepEqual(yearOptions("2026-10-24", S), [2026]);
  assert.deepEqual(yearOptions("2027-03-01", S), [2026, 2027]);
  assert.equal(defaultQuarter("2026-10-24", 2026, S), "2026-Q3");
  assert.equal(defaultQuarter("2026-11-17", 2026, S), "2026-Q3");
  assert.equal(defaultQuarter("2026-11-18", 2026, S), "2026-Q4");
  assert.equal(defaultQuarter("2026-07-01", 2026, S), "2026-Q2");
  // Önceki yıl seçildi: o yılın son çeyreği
  assert.equal(defaultQuarter("2027-03-01", 2026, S), "2026-Q4");
  assert.equal(defaultQuarter("2027-03-01", 2027, S), "2027-Q1");
  assert.equal(defaultQuarter("2026-10-24", 2025, S), null);
});

// ---------------------------------------------------------------- Excel verisinde takvim (24.10.2026)

const data: ExcelData = JSON.parse(readFileSync(join(__dirname, "..", "src/server/db/seed/excel-data.json"), "utf8"));
const excel = excelToDataset(data);
// Excel faturalarının KDV'si boş; Eylül KDV-2'si (1.800) yalnız Paraşüt'ün KDV toplamıyla çıkar: Beyza Karaman faturasına
// (30.000 + 4.200 ödenecek) KDV 6.000 yazılır, tevkifat 1.800 (denetim notu, drift §3)
const base: Dataset = { ...excel, currentMonth: "2026-10", invoices: excel.invoices.map((i) => (i.supplier === "Beyza Karaman" ? { ...i, vat: 6000 } : i)) };
const TODAY = "2026-10-24";

type Paid = { id: number; dueDate: string | null; next?: string | null; amount?: number | null };
function view(
  over: { settings?: Partial<TaxSettings>; filings?: TaxFiling[]; reminders?: ReminderRow[]; today?: string; paidQuarters?: { period: string; amount: number | null }[]; paidReminders?: Paid[] } = {},
): TaxView {
  const today = over.today ?? TODAY;
  const settings = { ...DEFAULT_TAX_SETTINGS, ...over.settings };
  const model = createModel(base);
  const plan = buildCashPlan({
    ...planInputFromModel(model, today),
    today,
    opening: null,
    excluded: [],
    invoiceTermDays: 30,
    cashReports: [],
    invoices: [],
    reminders: [],
    goods: [],
    goodsSpanDays: 0,
    vatAnchor: { month: "2026-09", amount: 121204.69 },
  });
  const filings = over.filings ?? [];
  const pnl = taxPnlInputFromModel(model, { settings, today, adjustments: [], assets: [], filings });
  const items = new Map<string, MuhtasarItem[]>();
  for (let m = "2026-06"; m <= "2027-05"; m = shiftMonth(m, 1)) items.set(m, muhtasarItemsFromModel(model, m));
  return buildTaxView({
    today,
    settings,
    pnl,
    muhtasarItems: items,
    filings,
    reminders: over.reminders ?? [],
    vat: plan.vat,
    settingsEmployerRate: model.settings.isverenSgk,
    paidQuarters: over.paidQuarters,
    paidReminders: over.paidReminders,
  });
}
const V = view();
const nb = (s: string | null | undefined) => (s ?? "").replace(/ /g, " ");
const reminder = (over: Partial<ReminderRow>): ReminderRow => ({
  id: 1,
  title: "Muhtasar ve prim hizmet beyannamesi",
  kind: "vergi",
  amount: null,
  dueDate: "2026-10-26",
  anchorDate: "2026-10-26",
  repeat: "monthly",
  remindDaysBefore: 5,
  note: null,
  active: true,
  ...over,
});

test("G, §3.12: Excel verisinde 24.10.2026'nın takvimi sırasıyla", () => {
  const rows = V.calendar.map((r) => [r.due, r.kind, r.title, r.amount, r.source, nb(r.amountText)]);
  assert.deepEqual(rows, [
    ["2026-10-26", "kdv2", "KDV-2 (Eylül)", 2591, "nakit planı", "≈ 2.600 ₺"],
    ["2026-10-26", "mphb", "Muhtasar ve prim hizmet (Eylül)", 974.38, "tahmin", "en az ≈ 974 ₺"],
    ["2026-10-28", "kdv1", "KDV (Eylül)", 791, "sabit tutar", "791 ₺"],
    ["2026-11-02", "sgk", "SGK (Eylül)", 25956.18, "tahmin", "≈ 26.000 ₺"],
    ["2026-11-17", "gecici", "Geçici vergi 2026/3", null, null, "Tutarı bilinmiyor · şirketin beyannamesi; muhasebecinizden isteyin"],
    ["2026-11-26", "mphb", "Muhtasar ve prim hizmet (Ekim)", 974.38, "tahmin", "en az ≈ 974 ₺"],
    ["2026-11-30", "kdv1", "KDV (Ekim)", 791, "sabit tutar", "791 ₺"],
    ["2026-11-30", "sgk", "SGK (Ekim)", 25956.18, "tahmin", "≈ 26.000 ₺"],
    ["2026-11-30", "ctv", "ÇTV 2026 2. taksit", null, null, "tutar belediyeden"],
    ["2026-12-28", "mphb", "Muhtasar ve prim hizmet (Kasım)", 974.38, "tahmin", "en az ≈ 974 ₺"],
    ["2026-12-28", "kdv1", "KDV (Kasım)", null, null, "Tutar yaklaşınca nakit planında"],
    ["2026-12-31", "sgk", "SGK (Kasım)", 25956.18, "tahmin", "≈ 26.000 ₺"],
    ["2027-01-26", "mphb", "Muhtasar ve prim hizmet (Aralık)", 974.38, "tahmin", "en az ≈ 974 ₺"],
    ["2027-01-28", "kdv1", "KDV (Aralık)", null, null, "Tutar yaklaşınca nakit planında"],
    ["2027-02-01", "sgk", "SGK (Aralık)", 25956.18, "tahmin", "≈ 26.000 ₺"],
  ]);
  const by = (k: string) => V.calendar.find((r) => r.key === k)!;
  assert.equal(nb(by("kdv2:2026-09").shift), "Son gün 25 Ekim Pazar → 26 Ekim");
  assert.ok(by("kdv2:2026-09").notes.some((n) => nb(n) === "Nakit planında 25 Ekim'de."));
  assert.equal(by("mphb:2026-09").ask, "tahakkuk");
  assert.equal(by("mphb:2026-09").note, "Tahakkuk fişindeki tutarı girin");
  assert.equal(by("mphb:2026-09").atLeast, true);
  assert.ok(by("mphb:2026-09").notes.includes("4 kalemin stopajı bilinmiyor: Kira, Instagram reklamı, Influencer, Muhasebeci."));
  assert.equal(by("mphb:2026-10").ask, undefined);
  assert.ok(by("kdv1:2026-09").notes.includes("Ödeme beklenmez (devreden); yalnız damga."));
  assert.equal(by("sgk:2026-09").ask, "tahakkuk");
  assert.equal(nb(by("sgk:2026-09").shift), "Son gün 31 Ekim Cumartesi → 2 Kasım");
  assert.ok(by("sgk:2026-09").notes.some((n) => nb(n) === "Nakit planında 31 Ekim'de."));
  assert.ok(by("sgk:2026-09").notes.includes("Gelir-gider Ayarlar'daki %15,75'i kullanıyor; vergi ve nakit planı yasal oranı."));
  // Nakit planının SGK satırı da aynı yasal günü yazar (K24)
  assert.equal(legalDayText(legalDueDate(by("sgk:2026-09").nominal)), "son gün 2 Kasım Pazartesi (31 Ekim Cumartesi)");
  assert.equal(by("gecici:2026-Q3").state, "taslak");
  assert.equal(by("gecici:2026-Q3").badge, "Taslak");
  assert.equal(nb(by("gecici:2026-Q3").detail[0].value), "en çok ≈ 68.900 ₺ + damga 791,00 ₺");
  assert.equal(by("ctv:2026-2").addHref, "/panel/hatirlaticilar?yeni=ctv2");
  assert.equal(by("mphb:2026-12").badge, "2026 kuralları");
  assert.ok(by("sgk:2026-12").notes.includes("Aralık bordrosu 2026 kurallarıyla."));
  assert.ok(!V.calendar.some((r) => r.key === "kdv2:2026-10"), "Ekim'de tevkifat ve yurt dışı hizmet yok");
  assert.deepEqual(
    V.later.map((l) => [l.kind, l.due, l.text]),
    [
      ["gecici", "2027-02-17", "Geçici vergi 2026/4 · 17.02.2027 Çar"],
      ["kv", "2027-04-30", "Kurumlar vergisi 2026 · 30.04.2027 Cum"],
    ],
  );
});

test("§4.1: üç rakam, Başlarken, kartlar", () => {
  assert.deepEqual(
    [V.stats.next, V.stats.next30, V.stats.readiness].map((s) => [s.label, nb(s.value), nb(s.sub)]),
    [
      ["Sıradaki ödeme", "en az ≈ 3.600 ₺", "KDV-2 ve muhtasar · 26 Ekim"],
      ["Önümüzdeki 30 gün", "en az ≈ 30.300 ₺", "tutarı bilinmeyen 1 ödeme (geçici vergi)"],
      ["Hazırlık", "0 / 4", ""],
    ],
  );
  assert.deepEqual(
    V.gettingStarted.steps.map((s) => [s.title, s.detail, s.done]),
    [
      ["Şirket nasıl kuruldu?", null, false],
      ["Giderleri sınıflandırın", "26 kalem kaldı", false],
      ["Demirbaşlar", "4 fatura varlık listesinde değil", false],
      ["Muhasebecinin rakamları", "Temmuz–Eylül KDV beyannamesi satışları, 2026/2 geçici vergi", false],
    ],
  );
  // U6: önce KDV beyannamesi satışları (o çeyreğin Vergiye göre'si), sonra eksik geçici vergi çeyreğinin sayfası
  const mstep = V.gettingStarted.steps.find((s) => s.key === "muhasebeci")!;
  assert.equal(mstep.href, "/panel/vergi/gelir-gider?ceyrek=2026-Q3#kdv-beyannamesi");
  const months = ["2026-07", "2026-08", "2026-09"].map((m, i): TaxFiling => ({ id: 10 + i, kind: "kdv_matrah", period: m, payable: 0, stamp: 0, values: { m10: 1, m20: 0 } }));
  assert.equal(view({ filings: months }).gettingStarted.steps.find((s) => s.key === "muhasebeci")!.href, "/panel/vergi/gelir-gider?ceyrek=2026-Q2");
  const g = V.geciciCard!;
  assert.equal(g.title, "Kafenin geçici vergi matrahına katkısı (yalnız kafe)");
  assert.equal(g.periodLine, "2026/3 · 25 Haziran–30 Eylül · son gün 17 Kasım Salı");
  assert.equal(g.badge, "Taslak");
  assert.equal(nb(g.headline), "Giderler sınıflandırılınca netleşir · şimdilik en çok ≈ 68.900 ₺");
  // Çeyreğin tutarı çeyreğin kalem sayısıyla (U7): 2026/3'te tutarı olan 15 sınıflandırılmamış kalem; Başlarken yılın
  // bütün kalemlerini sayar (24 + 2 demirbaş adayı)
  assert.equal(nb(g.subline), "808.610 ₺ gider henüz hesaba girmedi (15 kalem) · 69.780 ₺ demirbaş olabilir (2 fatura)");
  assert.deepEqual(
    g.rows.map((r) => r.label),
    ["Kümülatif kurum kazancı", "× %25", "Asgari kurumlar vergisi (%10)", "Önceki dönemler", "Kafenin katkısı", "Beyanname damgası"],
  );
  assert.equal(nb(g.rows.at(-1)!.value), "791,00 ₺");
  assert.equal(g.footer, "Şirketin geçici vergisi muhasebecinizin beyannamesindedir; 2026/3 rakamını Kasım'ın ilk haftası isteyin.");
  assert.ok(g.notes.includes("2026/2 (son gün 17.08.2026) için muhasebecinin rakamı girilmedi."));
  assert.ok(g.notes.includes("Amortisman: kalan çeyreklere eşit"));
  // Alt sınır kartta ve takvimde yazmaz ("≈ 0 ₺" yok)
  const shown = nb(JSON.stringify([g.headline, g.subline, g.rows, g.notes, V.calendar.map((r) => [r.amountText, r.detail, r.notes])]));
  assert.ok(!/≈ 0 ₺|alt sınır/i.test(shown));
  const k = V.kvCard;
  assert.equal(k.title, "Kurumlar vergisi (2026) · kafenin katkısı");
  assert.equal(k.subtitle, "Bugüne kadarki kârla");
  assert.equal(
    k.footer,
    "Beyanname 1–30 Nisan 2027 · ödeme 30 Nisan 2027 Cuma · damga 2.516,30 ₺ (beyanname 1.605,80, bilanço 616,30, gelir tablosu 294,20; 2027 tutarları açıklanmadı)",
  );
  assert.ok(k.notes.includes("2026/3 ödendi olarak işaretlenmedi: ödenmezse yıllık beyannamede mahsup edilemez."));
  assert.equal(nb(V.classify.header), "Bu çeyrekte 808.610 ₺ gider sayılmadı (15 kalem) · 69.780 ₺ demirbaş olabilir (2 fatura)");
  assert.equal(V.scope.text, "Kapsam: yalnız kafe");
  assert.equal(V.checks.chip, "Muhasebeciye sorulacaklar: 0 / 8");
  assert.equal(V.rulesInfo.compiled, "Kurallar 24.10.2026'da derlendi; resmî metinlerle henüz karşılaştırılmadı · Türkiye 2026");
  assert.deepEqual(V.rulesInfo.stale, []);
  assert.equal(V.hasData, true);
  assert.deepEqual(V.yearOptions, [2026]);
  assert.equal(V.quarter?.key, "2026-Q3");
});

test("§8.1: nakit planı beslemesi: muhtasar tahmini, taslak çeyreğin geçici vergisi tutarsız, damgalar", () => {
  const sep = V.planFeed.items.find((i) => i.kind === "muhtasar" && i.period === "2026-09")!;
  assert.equal(sep.amount, 974.38);
  assert.equal(sep.atLeast, true);
  assert.equal(sep.source, "estimate");
  assert.equal(sep.nominal, "2026-10-26");
  assert.equal(nb(sep.detail), "Ücret GV 0 + DV 34,68 + damga 939,70; en az (4 kalemin stopajı bilinmiyor). Tahmin; kesin tutar tahakkuk fişindedir. Son gün 26 Ekim Pazartesi.");
  assert.ok(!V.planFeed.items.some((i) => i.kind === "gecici"));
  const q3 = V.planFeed.pending.find((p) => p.period === "2026-Q3")!;
  assert.equal(q3.note, "Geçici vergi 2026/3: şirketin beyannamesi; tutarı muhasebecinizden isteyin (son gün 17.11)");
  assert.deepEqual(V.planFeed.stamps, { kdv: 791, kdv2: 791 });
});

test("K4: muhasebecinin kaydı ve Ödemeler'deki tutar; ÇTV hatırlatıcısı varsa kendiliğinden satır yok", () => {
  const filings: TaxFiling[] = [{ id: 1, kind: "gecici", period: "2026-Q3", payable: 41200, stamp: 791, values: {} }];
  const v = view({ filings, reminders: [reminder({ amount: 1200 }), reminder({ id: 2, title: "Çevre temizlik vergisi (2. taksit)", repeat: "yearly", dueDate: "2026-11-30", anchorDate: "2026-11-30", amount: 2400 })] });
  const g = v.calendar.find((r) => r.key === "gecici:2026-Q3")!;
  assert.equal(g.amount, 41991);
  assert.equal(g.source, "Muhasebeci");
  assert.equal(g.badge, "Muhasebeci");
  assert.equal(nb(g.amountText), "41.991 ₺");
  const m = v.calendar.find((r) => r.key === "mphb:2026-09")!;
  assert.equal(m.amount, 1200);
  assert.equal(m.source, "Ödemeler'de");
  assert.equal(m.ask, undefined);
  assert.equal(m.addHref, null);
  // Tutar yalnız hatırlatıcının sıradaki dönemine aittir: Ekim yine tahmin
  assert.equal(v.calendar.find((r) => r.key === "mphb:2026-10")!.source, "tahmin");
  assert.ok(!v.calendar.some((r) => r.key === "ctv:2026-2"));
  const ctv = v.calendar.find((r) => r.kind === "ctv")!;
  assert.equal(ctv.amount, 2400);
  assert.equal(ctv.source, "Ödemeler'de");
  const feed = v.planFeed.items.find((i) => i.kind === "gecici" && i.period === "2026-Q3")!;
  assert.equal(feed.amount, 41991);
  assert.equal(feed.source, "filing");
  // Kayıt ile Ödemeler farklıysa uyarı
  const diff = view({ filings, reminders: [reminder({ id: 3, title: "Geçici vergi beyanı ve ödemesi", repeat: "quarterly", dueDate: "2026-11-17", anchorDate: "2026-11-17", amount: 40000 })] });
  assert.ok(diff.warnings.some((w) => w.startsWith("Geçici vergi 2026/3: Ödemeler'deki tutar (40.000")));
  // Matrahı girilmemiş kayıt çapa değil: kart söyler (§3.7, §11-C)
  const card = v.geciciCard!;
  assert.equal(card.key, "2026-Q3");
  assert.equal(card.badge, "Muhasebeci");
  assert.equal(nb(card.headline), "Şirketin beyannamesi 41.200 ₺");
  assert.ok(card.notes.includes("Sonraki tahmin panelin verisiyle (matrah girilmedi)"));
  // Matrahı girilmiş kayıt çapadır: not yok
  assert.ok(!view({ filings: [{ ...filings[0], values: { matrah: 300000, hesaplanan: 75000 } }] }).geciciCard!.notes.includes("Sonraki tahmin panelin verisiyle (matrah girilmedi)"));
});

test("§3.7: gelir beyannameden gelince kart ve kapsam uyarır (gider yalnız kafe)", () => {
  const bey: TaxFiling[] = [
    { id: 1, kind: "kdv_matrah", period: "2026-07", payable: 0, stamp: 0, values: { m10: 128700.46, m20: 12569.37 } },
    { id: 2, kind: "kdv_matrah", period: "2026-08", payable: 0, stamp: 0, values: { m10: 369994.62, m20: 0 } },
    { id: 3, kind: "kdv_matrah", period: "2026-09", payable: 0, stamp: 0, values: { m10: 347099.03, m20: 335000 } },
  ];
  const v = view({ filings: bey });
  const warning = "Gelir şirketin tamamı (beyanname), gider yalnız kafe: kafe dışı giderleri girmezseniz rakam yüksek çıkar";
  assert.equal(v.geciciCard!.notes[0], warning);
  assert.equal(v.scope.warning, warning);
  assert.equal(v.scope.text, "Gelir: şirketin tamamı (beyanname) · gider: kafe");
  assert.ok(!V.geciciCard!.notes.includes(warning));
  assert.equal(V.scope.warning, null);
});

test("§4.1: hesap için veri yoksa; kural tablosu bayatlayınca bant", () => {
  const empty = createModel({ ...base, months: [], invoices: [], staff: [], fixedExpenses: [] });
  const pnl = taxPnlInputFromModel(empty, { settings: DEFAULT_TAX_SETTINGS, today: TODAY, adjustments: [], assets: [], filings: [] });
  const v = buildTaxView({ today: TODAY, settings: DEFAULT_TAX_SETTINGS, pnl, muhtasarItems: new Map(), filings: [], reminders: [], vat: null });
  assert.equal(v.hasData, false);
  const late = view({ today: "2027-01-23" });
  assert.deepEqual(late.rulesInfo.stale, ["Kural tablosu 90 günden eski; yeni tutarlar açıklanmış olabilir."]);
  assert.deepEqual(late.yearOptions, [2026, 2027]);
  assert.equal(late.year, 2026);
});

// ---------------------------------------------------------------- İnceleme düzeltmeleri (rakam R1–R10)

const row = (v: TaxView, key: string) => v.calendar.find((r) => r.key === key);

test("R1: ödeme günü gelmiş, yasal günü gelmemiş KDV ve KDV-2 tutarıyla kalır (nakit planının onDue'su)", () => {
  // 25 Ekim Pazar ve 26 Ekim: Eylül KDV-2'si (nominal 25.10) tutarıyla; sıradaki ödeme KDV-2 ve muhtasar
  for (const today of ["2026-10-25", "2026-10-26"]) {
    const v = view({ today });
    const k2 = row(v, "kdv2:2026-09")!;
    assert.equal(k2.amount, 2591, today);
    assert.equal(k2.cashPlanDate, null, "nakit planında yok");
    assert.ok(k2.notes.some((n) => nb(n) === "Ödeme günü (25 Ekim) geldiği için nakit planında yok; eldeki paradan ödenir."), today);
    assert.deepEqual([nb(v.stats.next.value), nb(v.stats.next.sub)], ["en az ≈ 3.600 ₺", "KDV-2 ve muhtasar · 26 Ekim"], today);
  }
  // 28 Ekim (KDV günü): satır damgasıyla, "tutar yaklaşınca" değil; tutar kesin (R8: ≈ yok)
  const d28 = view({ today: "2026-10-28" });
  const kdv = row(d28, "kdv1:2026-09")!;
  assert.deepEqual([kdv.amount, kdv.source, nb(kdv.amountText), kdv.note], [791, "sabit tutar", "791 ₺", null]);
  assert.deepEqual([nb(d28.stats.next.value), nb(d28.stats.next.sub)], ["791 ₺", "KDV · 28 Ekim"]);
  // 28 Kasım Cumartesi → 30 Kasım: 29 ve 30 Kasım'da Ekim KDV'si yine tutarıyla
  for (const today of ["2026-11-29", "2026-11-30"]) {
    const k = row(view({ today }), "kdv1:2026-10")!;
    assert.deepEqual([k.due, k.amount, k.source, k.note], ["2026-11-30", 791, "sabit tutar", null], today);
  }
  // Nakit planı ödeme gününü planlamaz (bugünkü ödeme eldeki paradan), Vergi için onDue'da tutar
  const model = createModel(base);
  const plan = buildCashPlan({
    ...planInputFromModel(model, "2026-10-25"),
    today: "2026-10-25",
    opening: null,
    excluded: [],
    invoiceTermDays: 30,
    cashReports: [],
    invoices: [],
    reminders: [],
    goods: [],
    goodsSpanDays: 0,
    vatAnchor: { month: "2026-09", amount: 121204.69 },
  });
  assert.ok(!plan.vat!.vat2.some((r) => r.period === "2026-09"));
  assert.deepEqual(plan.vat!.onDue.vat2.map((r) => [r.period, r.date, r.amount]), [["2026-09", "2026-10-25", 1800]]);
  assert.ok(!plan.weeks.flatMap((w) => w.lines).some((l) => l.key === "kdv2@2026-10-25"));
});

test("R2: 1 Ocak–17 Şubat arasında geçici vergi kartı geçen yılın 4. çeyreği (beyannamesi sıradaki)", () => {
  const v = view({ today: "2027-01-15" });
  assert.equal(v.geciciCard!.key, "2026-Q4");
  assert.equal(nb(v.geciciCard!.periodLine), "2026/4 · 25 Haziran–31 Aralık · son gün 17 Şubat Çarşamba");
  assert.ok(v.calendar.some((r) => r.key === "gecici:2026-Q4"));
  assert.equal(view({ today: "2027-02-18" }).geciciCard!.key, "2027-Q1");
});

test("R3: sabit tutarlı SGK ve 'Kira stopajı' hatırlatıcısının tutarı her döneminde (nakit planı gibi)", () => {
  const sgk = reminder({ id: 5, title: "SGK prim ödemesi", kind: "odeme", amount: 27000, dueDate: "2026-11-30", anchorDate: "2026-11-30" });
  const stopaj = reminder({ id: 6, title: "Kira stopajı", kind: "vergi", amount: 8000, dueDate: "2026-11-26", anchorDate: "2026-11-26" });
  const v = view({ today: "2026-11-20", reminders: [sgk, stopaj] });
  for (const key of ["sgk:2026-10", "sgk:2026-11"]) assert.deepEqual([row(v, key)!.amount, row(v, key)!.source], [27000, "Ödemeler'de"], key);
  for (const key of ["mphb:2026-10", "mphb:2026-11"]) assert.deepEqual([row(v, key)!.amount, row(v, key)!.source], [8000, "Ödemeler'de"], key);
  // Tutarı tek döneme ait muhtasar hatırlatıcısı: yalnız sıradaki döneminde (K26)
  const m = view({ today: "2026-11-20", reminders: [reminder({ amount: 1200, dueDate: "2026-11-26", anchorDate: "2026-11-26" })] });
  assert.deepEqual([row(m, "mphb:2026-10")!.amount, row(m, "mphb:2026-11")!.source], [1200, "tahmin"]);
});

test("R4: Ödendi denen geçici vergi, muhtasar ve SGK dönemi takvimde ve rakamlarda yok", () => {
  const g = reminder({ id: 7, title: "Geçici vergi beyanı ve ödemesi", repeat: "quarterly", dueDate: "2027-02-17", anchorDate: "2026-11-17" });
  const m = reminder({ id: 8, dueDate: "2026-12-26", anchorDate: "2026-10-26" });
  const s = reminder({ id: 9, title: "SGK prim ödemesi", kind: "odeme", dueDate: "2026-12-31", anchorDate: "2026-10-31" });
  const paidReminders: Paid[] = [
    { id: 8, dueDate: "2026-11-26", next: "2026-12-26", amount: 974 },
    { id: 9, dueDate: "2026-11-30", next: "2026-12-31", amount: 26000 },
  ];
  const open = view({ today: "2026-11-10", reminders: [g, m, s] });
  for (const key of ["gecici:2026-Q3", "mphb:2026-10", "sgk:2026-10"]) assert.ok(row(open, key), key);
  const paid = view({ today: "2026-11-10", reminders: [g, m, s], paidQuarters: [{ period: "2026-Q3", amount: 41991 }], paidReminders });
  for (const key of ["gecici:2026-Q3", "mphb:2026-10", "sgk:2026-10"]) assert.equal(row(paid, key), undefined, key);
  assert.ok(row(paid, "mphb:2026-11"), "sonraki dönem kalır");
  assert.notEqual(nb(paid.stats.next.sub), "Geçici vergi · 17 Kasım");
  // KV kartı aynı çeyreği mahsup eder (tutarlılık)
  assert.ok(paid.kvCard.calc.paidQuarters.some((p) => p.period === "2026-Q3"));
});

test("R5, R8, R10: kartta Ödemeler'deki tutar (K4); kesin tutar ≈ almaz; kayan muhtasar günü notta", () => {
  const rem = reminder({ id: 3, title: "Geçici vergi beyanı ve ödemesi", repeat: "quarterly", dueDate: "2026-11-17", anchorDate: "2026-11-17", amount: 50000 });
  const v = view({ reminders: [rem] });
  const g = v.geciciCard!;
  assert.deepEqual([g.badge, nb(g.headline)], ["Ödemeler'de", "Ödemeler'deki tutar 50.000 ₺"]);
  assert.equal(nb(g.subline), "Kafenin katkısı en çok ≈ 68.900 ₺ · Ödemeler'deki tutar 50.000 ₺ (damga dahil)");
  // Kurumlar vergisi kartı: kayıt yoksa Ödemeler'deki tutar
  const kvRem = reminder({ id: 4, title: "Kurumlar vergisi beyannamesi", repeat: "yearly", dueDate: "2027-04-30", anchorDate: "2027-04-30", amount: 90000 });
  const kv = view({ reminders: [kvRem] }).kvCard;
  assert.equal(kv.badge, "Ödemeler'de");
  assert.ok(kv.rows.some((r) => r.label === "Ödenecek (Ödemeler'deki tutar, damga dahil)" && nb(r.value) === "90.000 ₺"));
  // Muhasebecinin kaydı: sıradaki ödeme kesin tutarıyla (≈ yok)
  const filed = view({ today: "2026-11-10", filings: [{ id: 1, kind: "gecici", period: "2026-Q3", payable: 41200, stamp: 791, values: {} }] });
  assert.deepEqual([nb(filed.stats.next.value), nb(filed.stats.next.sub)], ["41.991 ₺", "Geçici vergi · 17 Kasım"]);
  // Muhtasar (Kasım) son günü 26 Aralık Cumartesi → 28 Aralık; nakit planı 26'sında
  assert.ok(row(V, "mphb:2026-11")!.notes.some((n) => nb(n) === "Nakit planında 26 Aralık'ta."));
  // Uyarılar Özet'te: kayıt ile Ödemeler farklı (satırın adıyla)
  const diff = view({ filings: [{ id: 1, kind: "kv", period: "2026", payable: 80000, stamp: 2516.3, values: {} }], reminders: [kvRem], today: "2027-03-01" });
  assert.ok(diff.warnings.some((w) => w.startsWith("Kurumlar vergisi 2026: Ödemeler'deki tutar (90.000")), diff.warnings.join(" | "));
});
