// Geçiş gününden sonra ModPOS işleri ve metinleri (denetim B11: E-39; AsilPOS planı §5.2 "Kasadaki fiyatlar, posBell,
// Bugün satırı" ve "Metinler"), saf kurallar: günün ve ayın kasası (src/lib/asilpos/kasa.ts), kasadaki fiyatların
// metinleri (src/lib/prices/pos.ts), Bugün'ün kasa ve fiyat satırları, kasa raporunun karşılaştırmaları, e-posta ve
// WhatsApp, yazarkasa okumasının ModPOS önerisi, haftalık özetin kasa fiyatı maddesi. Geçiş günü boşken (ve öncesinde)
// her metin bugünkünün aynısı: sahibin 26 Ekim kararı. Veritabanında: tests/asilpos-metin-db.test.ts.
// Çalıştırma: npx tsx --test tests/asilpos-metin.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { dayTasks, eveningCashText, type DayFacts, type DayTask } from "../src/app/panel/bugun/logic";
import type { AsilposSalesMonth } from "../src/lib/calc/types";
import { cashReportText, whatsappText, type CashReportFields } from "../src/lib/cash-report";
import { monthKasa, periodKasa, salesMonthKasa, tillPriceManual, tillScope } from "../src/lib/asilpos/kasa";
import { kasaName } from "../src/lib/asilpos/switch";
import { okcReconcile } from "../src/lib/okc-z";
import { failed } from "../src/lib/photo-read/kasa";
import { OKC_SOFTWARE_Z_ASILPOS_TEXT, OKC_SOFTWARE_Z_PAVO_TEXT, okcReadingOnAsilposDay } from "../src/lib/photo-read/okc";
import { batchPosNote, POS_PRICE_REMINDER, POS_PRICE_REMINDER_ASILPOS, posBell, posChecklistText, priceReminder, type PosItem } from "../src/lib/prices/pos";
import { PRICE_PUSH_REMINDER } from "../src/lib/site-menu/push";
import { posPriceItem } from "../src/lib/weekly/items";
import { renderCashReport } from "../src/server/notify/cash-report-template";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
/** Bölünmez boşluk düz boşluğa, sözcük birleştirici (aralık tiresinde) silinir */
const plain = (s: string) => s.replace(/ /g, " ").replace(/⁠/g, "");
/** E-postanın HTML'i düz metin karşılaştırması için (kesme işareti kaçırılmış) */
const html = (s: string) => plain(s).replace(/&#39;/g, "'");
/** Türkiye saatiyle an */
const tr = (local: string) => new Date(`${local}:00+03:00`);

const S = "2026-11-10";

// ---------------------------------------------------------------- Günün ve ayın kasası

test("günün kasası: geçiş günü boşken ve öncesinde ModPOS, geçiş gününden itibaren AsilPOS", () => {
  assert.deepEqual(tillScope("2026-11-20", null), { kasa: "ModPOS", asilpos: false, switchDay: null });
  assert.deepEqual(tillScope("2026-11-09", S), { kasa: "ModPOS", asilpos: false, switchDay: null }, "geçiş günü yalnız AsilPOS gününde taşınır");
  assert.deepEqual(tillScope(S, S), { kasa: "AsilPOS", asilpos: true, switchDay: S });
  assert.deepEqual(tillScope("2026-12-01", S), { kasa: "AsilPOS", asilpos: true, switchDay: S });
  assert.equal(kasaName("2026-11-09", S), "ModPOS");
  assert.equal(kasaName(S, S), "AsilPOS");
});

test("kasada elle değişen fiyat: AsilPOS gününde yalnız siteye bağlı olmayan ürününki (AsilPOS siteden alır)", () => {
  const modpos = tillScope("2026-11-09", S);
  const asilpos = tillScope(S, S);
  assert.equal(tillPriceManual(modpos, true), true, "ModPOS gününde bağlı ürün de kasada elle");
  assert.equal(tillPriceManual(modpos, false), true);
  assert.equal(tillPriceManual(asilpos, true), false, "AsilPOS fiyatı siteden alır");
  assert.equal(tillPriceManual(asilpos, false), true, "AsilPOS'ta yerel ürün elle");
  assert.equal(tillPriceManual(tillScope("2026-12-01", null), true), true, "geçiş günü boş");
});

test("ayın kasası: önce ModPOS (Patron), sonra AsilPOS; geçiş ayında iki kasa günleriyle", () => {
  const modpos = { source: "modpos", short: "ModPOS", both: "ModPOS", long: "ModPOS", report: "Patron (ModPOS)" };
  assert.deepEqual(monthKasa("2026-11", null), modpos, "geçiş günü boş: bugünkü metinler");
  assert.deepEqual(monthKasa("2026-10", S), modpos);
  assert.deepEqual(monthKasa("2026-12", S), { source: "asilpos", short: "AsilPOS", both: "AsilPOS", long: "AsilPOS", report: "AsilPOS" });
  const gecis = monthKasa("2026-11", S);
  assert.equal(gecis.source, "gecis");
  assert.equal(gecis.short, "Kasa");
  assert.equal(gecis.both, "ModPOS / AsilPOS");
  assert.equal(plain(gecis.long), "Kasa (ModPOS 1–9 Kasım · AsilPOS 10–30 Kasım)");
  assert.equal(gecis.report, gecis.long);
  // Ayın 1'i: ay bütünüyle AsilPOS; 2'si: ModPOS'un tek günü
  assert.equal(monthKasa("2026-11", "2026-11-01").source, "asilpos");
  assert.equal(plain(monthKasa("2026-11", "2026-11-02").long), "Kasa (ModPOS 1 Kasım · AsilPOS 2–30 Kasım)");
  // Ürün satışlarının etiketi: modelin saydığı bölünme (asilposSalesFrom), geçiş günü değil (denetim B11 incelemesi D3)
  const month = (over: Partial<AsilposSalesMonth>): AsilposSalesMonth => ({
    month: "2026-11",
    source: "gecis",
    from: S,
    asilpos: { days: 21, last: "2026-11-30" },
    modpos: { lines: 40, revenue: 90_000, through: "2026-11-09", counted: true },
    modposZ: null,
    gap: null,
    overlap: null,
    ...over,
  });
  assert.equal(plain(monthKasa("2026-11", S, month({})).long), "Kasa (ModPOS 1–9 Kasım · AsilPOS 10–30 Kasım)", "liste geçiş gününe kadar");
  // Liste 12 Kasım'a kadar (overlap): AsilPOS 13'ünden sayılır
  const overlap = monthKasa("2026-11", S, month({ from: "2026-11-13", modpos: { lines: 40, revenue: 99_000, through: "2026-11-12", counted: true }, overlap: { from: S, to: "2026-11-12" } }));
  assert.equal(plain(overlap.long), "Kasa (ModPOS 1–12 Kasım · AsilPOS 13–30 Kasım)");
  assert.equal(overlap.report, overlap.long);
  assert.equal(overlap.short, "Kasa");
  // Liste yok (gap): ModPOS günleri sayılmıyor
  assert.equal(plain(monthKasa("2026-11", S, month({ modpos: null, gap: { from: "2026-11-01", to: "2026-11-09" } })).long), "Kasa (ModPOS listesi yok · AsilPOS 10–30 Kasım)");
  // Süren ay: AsilPOS'un sayılan son günü; kasa raporunu bekleyen günler sayılmaz
  assert.equal(plain(monthKasa("2026-11", S, month({ asilpos: { days: 5, last: "2026-11-14" }, held: { from: "2026-11-14", to: "2026-11-14" } })).long), "Kasa (ModPOS 1–9 Kasım · AsilPOS 10–13 Kasım)");
  // Geçiş günü henüz gelmedi (5 Kasım): AsilPOS'tan sayılan gün yok
  assert.equal(plain(monthKasa("2026-11", S, month({ asilpos: null, modpos: null })).long), "Kasa (ModPOS listesi yok · AsilPOS 10 Kasım'dan itibaren)");
  // Liste ayın tamamı (AsilPOS sayılmıyor): ay ModPOS
  assert.deepEqual(monthKasa("2026-11", S, month({ from: null, modpos: { lines: 40, revenue: 120_000, through: "2026-11-30", counted: true } })), modpos);
  // Ayın özeti yoksa geçiş günündeki bölünme; geçiş ayı dışında `sales` hiçbir şey değiştirmez
  assert.equal(plain(monthKasa("2026-11", S, null).long), "Kasa (ModPOS 1–9 Kasım · AsilPOS 10–30 Kasım)");
  assert.deepEqual(monthKasa("2026-12", S, month({ month: "2026-12", source: "asilpos" })).source, "asilpos");
  assert.deepEqual(salesMonthKasa("2026-11", S, { months: [month({ modpos: null })] }), monthKasa("2026-11", S, month({ modpos: null })));
  assert.deepEqual(salesMonthKasa("2026-11", null, undefined), modpos, "geçiş günü boş: bugünkü metinler");
  // Birden çok ay (Gelir-gider'in yılı, Claude'un yıl özeti)
  assert.deepEqual(periodKasa(["2026-09", "2026-10"], S), { short: "ModPOS", both: "ModPOS" });
  assert.deepEqual(periodKasa(["2026-12"], S), { short: "AsilPOS", both: "AsilPOS" });
  assert.deepEqual(periodKasa(["2026-10", "2026-12"], S), { short: "Kasa", both: "ModPOS / AsilPOS" });
  assert.deepEqual(periodKasa([], S), { short: "ModPOS", both: "ModPOS" });
  assert.deepEqual(periodKasa(["2027-01"], null), { short: "ModPOS", both: "ModPOS" });
});

// ---------------------------------------------------------------- Kasadaki fiyatlar

const ITEM: PosItem = { productId: 1, name: "Latte", size: "M", category: "Espresso Bazlı", categoryOrder: 1, sortOrder: 1, posNames: [], stalePrice: 195, price: 205 };

test("fiyat metinleri: kasa verilmezse (ya da ModPOS) bugünkü metnin aynısı", () => {
  assert.equal(priceReminder({ site: false, posPending: true }), POS_PRICE_REMINDER);
  assert.equal(priceReminder({ site: false, posPending: true, kasa: "ModPOS" }), "Kasadaki (ModPOS) fiyatı da değiştir; Fiyatlar › Kasaya işle listesine eklendi.");
  assert.equal(priceReminder({ site: true, posPending: true, kasa: "ModPOS" }), PRICE_PUSH_REMINDER);
  assert.equal(priceReminder({ site: true, posPending: false }), "Fiyat sitede de değişti. Fiyat listesinin tarihini sitede (Ayarlar → Vergi) güncellemeyi unutma.");
  assert.equal(priceReminder({ site: false, posPending: false, kasa: "ModPOS" }), null);
  assert.equal(batchPosNote("bulk", [{ posPending: true, site: true }]), "Kasadaki (ModPOS) fiyatlar Kasaya işle listesinde.");
  assert.equal(batchPosNote("bulk", [{ posPending: false, site: true }]), undefined);
  assert.equal(batchPosNote("undo", [{ posPending: false }]), "Bu fiyat kasada (ModPOS) henüz değişmemişti; kasada bir şey yapmanız gerekmez.");
  assert.match(posChecklistText([ITEM], "2026-10-22"), /^Kasada \(ModPOS\) değişecek fiyatlar · 22 Ekim 2026\n/);
  const now = tr("2026-10-22T14:00");
  const p = { count: 3, oldest: tr("2026-10-19T10:00"), newest: tr("2026-10-22T10:00") };
  assert.equal(posBell("admin", p, now)?.body, "ModPOS'ta elle değiştirip Fiyatlar › Kasaya işle'de işaretleyin");
  assert.equal(posBell("staff", p, now)?.body, "ModPOS'ta değiştirip Kasadaki fiyatlar'da işaretleyin");
  assert.deepEqual(posBell("staff", p, now, "ModPOS"), posBell("staff", p, now));
});

test("fiyat metinleri AsilPOS gününde: siteye bağlı ürünü AsilPOS siteden alır, bağlı olmayan AsilPOS'ta elle", () => {
  // Siteye bağlı ürün kasa listesine girmez (posPending false): bildirim kasada bir şey istemez
  assert.equal(priceReminder({ site: true, posPending: false, kasa: "AsilPOS" }), "Fiyat sitede de değişti; AsilPOS yeni fiyatı siteden alır. Fiyat listesinin tarihini sitede (Ayarlar → Vergi) güncellemeyi unutma.");
  assert.equal(priceReminder({ site: false, posPending: true, kasa: "AsilPOS" }), POS_PRICE_REMINDER_ASILPOS);
  assert.doesNotMatch(POS_PRICE_REMINDER_ASILPOS, /ModPOS/);
  assert.equal(priceReminder({ site: false, posPending: false, kasa: "AsilPOS" }), null);
  assert.equal(batchPosNote("bulk", [{ posPending: false, site: true }], "AsilPOS"), "AsilPOS yeni fiyatları siteden alır; kasada bir şey yapmanız gerekmez.");
  assert.match(batchPosNote("bulk", [{ posPending: true, site: false }], "AsilPOS")!, /^Siteye bağlı olmayanlar Kasaya işle listesinde: AsilPOS ürünü siteden alıyorsa Ürünler › Site menüsü'nde bağlayın/);
  assert.match(POS_PRICE_REMINDER_ASILPOS, /Site menüsü'nde bağlayın ya da fiyatı sitede değiştirin; AsilPOS'ta yerel ürünse orada elle değiştirin/);
  assert.equal(batchPosNote("undo", [{ posPending: false, site: false }], "AsilPOS"), "Bu fiyat kasada (AsilPOS) henüz değişmemişti; kasada bir şey yapmanız gerekmez.");
  assert.equal(batchPosNote("bulk", [{ posPending: false, site: false }], "AsilPOS"), undefined);
  assert.match(posChecklistText([ITEM], "2026-11-12", "AsilPOS"), /^Kasada \(AsilPOS\) değişecek fiyatlar · 12 Kasım 2026\n/);
  const now = tr("2026-11-12T14:00");
  const p = { count: 1, oldest: tr("2026-11-12T10:00"), newest: tr("2026-11-12T10:00") };
  const admin = posBell("admin", p, now, "AsilPOS")!;
  assert.equal(
    admin.body,
    "Siteye bağlı olmayan ürün: AsilPOS'ta yerelse orada elle değiştirip Fiyatlar › Kasaya işle'de işaretleyin; AsilPOS ürünü siteden alıyorsa Ürünler › Site menüsü'nde bağlayın",
  );
  assert.doesNotMatch(`${admin.title} ${admin.body}`, /ModPOS/);
  // Personele görev yok: AsilPOS'ta ürün fiyatını kasiyer değiştiremez (menüyü yöneten değiştirir; B11 incelemesi K1)
  assert.equal(posBell("staff", p, now, "AsilPOS"), null);
  // Bekleyen yoksa satır yok (AsilPOS gününde siteye bağlı ürünler sayılmaz: çoğu gün hiç çıkmaz)
  assert.equal(posBell("admin", { count: 0, oldest: null, newest: null }, now, "AsilPOS"), null);
});

test("haftalık özetin kasa fiyatı maddesi günün kasasıyla", () => {
  const rows = [{ label: "Latte M", price: 205, posPrice: 195, since: "2026-11-01", perMonth: 300 }];
  const modpos = posPriceItem({ today: "2026-11-12", kdv: 0.1, rows })!;
  assert.match(modpos.title, /^ModPOS'ta 1 ürün eski fiyatla: ayda ≈ /);
  const asilpos = posPriceItem({ today: "2026-11-12", kdv: 0.1, rows, kasa: "AsilPOS" })!;
  assert.match(asilpos.title, /^AsilPOS'ta 1 ürün eski fiyatla/);
  const plainRows = [{ label: "Su (PET)", price: 25, posPrice: 20, since: "2026-11-01", perMonth: null }];
  assert.equal(posPriceItem({ today: "2026-11-12", kdv: 0.1, rows: plainRows })?.title, "ModPOS'ta 1 fiyat değişecek");
  assert.equal(posPriceItem({ today: "2026-11-12", kdv: 0.1, rows: plainRows, kasa: "AsilPOS" })?.title, "AsilPOS'ta 1 fiyat değişecek");
});

// ---------------------------------------------------------------- Bugün

const STOCK = { month: "2026-11", counted: 0, total: 40, prevMonth: "2026-10", prevHasData: true, prevCounted: 40, prevTotal: 40 };
const byKey = (tasks: DayTask[]) => Object.fromEntries(tasks.map((t) => [t.key, t])) as Record<string, DayTask>;
function staffFacts(now: Date, o: Partial<DayFacts> = {}): DayFacts {
  return { role: "staff", now, cash: { today: null, yesterday: null, firstDate: null }, waste: { count: 0, zayi: null, ikram: null }, stock: STOCK, ...o };
}
function adminFacts(now: Date, o: Partial<DayFacts> = {}): DayFacts {
  return { role: "admin", now, cash: { today: null, yesterday: null, firstDate: null }, stock: STOCK, system: [], payments: [], invoices: { review: 0 }, ...o };
}

test("Bugün: personelin akşam kasa satırı günün kasasıyla (geçiş günü boşken bugünkü metin)", () => {
  const evening = tr("2026-11-12T21:00");
  assert.equal(byKey(dayTasks(staffFacts(evening))).kasa.detail, "Kapanışta ModPOS'tan Z raporunu alın, kasadaki nakdi sayıp girin.");
  assert.equal(byKey(dayTasks(staffFacts(evening, { asilposSwitch: "2026-11-13" }))).kasa.detail, eveningCashText("ModPOS"), "geçiş günü yarın");
  const laf = byKey(dayTasks(staffFacts(evening, { asilposSwitch: S }))).kasa.detail;
  // AsilPOS gününde rapor AsilPOS'tan gelir; personel rakam girmez (son denetim, 24 Kasım 2026; tests/son-kontrol.test.ts)
  assert.equal(laf, "Kapanışta AsilPOS'ta Günü kapat'a basın; rapor AsilPOS'tan gelir, sonra Pavo'nun gün sonu fişinin (detaylı Z) fotoğrafını eklersiniz.");
  assert.equal(eveningCashText("AsilPOS"), laf);
});

test("Bugün: yöneticinin kapalı gün satırı dünün kasasını söyler", () => {
  const noon = tr("2026-11-12T14:00");
  const facts = (asilposSwitch: string | null) =>
    adminFacts(noon, { cash: { today: null, yesterday: null, firstDate: "2026-10-01" }, closed: { yesterday: { state: "pending", by: "Ayşe", requestId: 4 } }, asilposSwitch });
  assert.match(byKey(dayTasks(facts(null)))["kasa-dun"].detail, /Onaylamadan önce o günün ModPOS \/ banka POS'una bakın\.$/);
  assert.match(byKey(dayTasks(facts(S)))["kasa-dun"].detail, /Onaylamadan önce o günün AsilPOS \/ banka POS'una bakın\.$/);
  assert.match(byKey(dayTasks(facts("2026-11-12")))["kasa-dun"].detail, /o günün ModPOS \//, "dün geçiş gününden önce");
});

test("Bugün: kasadaki fiyatlar satırı AsilPOS gününde yalnız yöneticide (yalnız siteye bağlı olmayanlar)", () => {
  const noon = tr("2026-11-12T14:00");
  const pos = (kasa?: "ModPOS" | "AsilPOS") => ({ count: 2, oldest: tr("2026-11-10T10:00").toISOString(), ...(kasa ? { kasa } : {}) });
  const modpos = byKey(dayTasks(staffFacts(noon, { pos: pos() }))).modpos;
  assert.equal(modpos.detail, "ModPOS'ta değişecek 2 fiyat; değiştirdikçe işaretleyin. En eskisi 2 gündür bekliyor.");
  assert.equal(modpos.href, "/panel/kasa/fiyatlar");
  // Personele görev yok: AsilPOS'ta ürün fiyatını kasiyer değiştiremez (B11 incelemesi K1)
  assert.equal(byKey(dayTasks(staffFacts(noon, { pos: pos("AsilPOS") }))).modpos, undefined);
  const admin = byKey(dayTasks(adminFacts(noon, { pos: pos("AsilPOS") }))).modpos;
  assert.equal(
    admin.detail,
    "Kasada değişecek 2 fiyat (siteye bağlı olmayan ürünler): AsilPOS'ta yerel ürünse orada elle değiştirip Fiyatlar › Kasaya işle'de işaretleyin; AsilPOS ürünü siteden alıyorsa Ürünler › Site menüsü'nde bağlayın. En eskisi 2 gündür bekliyor.",
  );
  assert.equal(
    byKey(dayTasks(adminFacts(noon, { pos: pos("ModPOS") }))).modpos.detail,
    "Kasada değişecek 2 fiyat: ModPOS'ta elle değiştirip Fiyatlar › Kasaya işle'de işaretleyin. En eskisi 2 gündür bekliyor.",
  );
  // Bekleyen yoksa satır yok (AsilPOS'ta siteye bağlı ürün sayılmaz)
  assert.equal(byKey(dayTasks(staffFacts(noon, { pos: { count: 0, oldest: null, kasa: "AsilPOS" } }))).modpos, undefined);
});

// ---------------------------------------------------------------- Kasa raporu, e-posta, WhatsApp

const report = (o: Partial<CashReportFields> = {}): CashReportFields => ({
  date: "2026-11-11",
  zNo: "14",
  receipts: 63,
  zTotal: 20_000,
  cash: 12_000,
  card: 8_000,
  mealCard: 0,
  online: 0,
  other: 0,
  openingCash: 1_500,
  cashIn: 0,
  cashOut: 450,
  cashOutNote: null,
  countedCash: 13_050,
  handedOver: 0,
  bankPos: null,
  offRevenue: 0,
  discounts: 0,
  note: null,
  ...o,
});
const OKC = { okcZNo: "88", okcTotal: 19_500, okcCash: 11_900, okcCard: 7_900, okcMealCard: 0, okcOther: 0, okcReceipts: 60 };

test("yazarkasa karşılaştırmaları: ModPOS gününde bugünkü metin, AsilPOS gününde AsilPOS'un adıyla", () => {
  const f = { ...report({ bankPos: 7_900 }), ...OKC };
  const modpos = okcReconcile(f, "admin");
  assert.deepEqual(okcReconcile(f, "admin", "ModPOS"), modpos);
  assert.ok(modpos.some((l) => /ModPOS'taki karttan/.test(l.text)));
  assert.ok(modpos.some((l) => /ModPOS toplamı/.test(l.text)));
  const asilpos = okcReconcile(f, "admin", "AsilPOS");
  assert.equal(asilpos.length, modpos.length);
  for (const l of asilpos) assert.doesNotMatch(l.text, /ModPOS/, l.text);
  assert.ok(asilpos.some((l) => /AsilPOS'taki karttan/.test(l.text)));
  assert.ok(asilpos.some((l) => /AsilPOS toplamı yazarkasadan/.test(l.text)));
  assert.ok(asilpos.some((l) => /AsilPOS'taki nakitten/.test(l.text)));
});

test("WhatsApp ve e-posta: AsilPOS gününde ModPOS hiç geçmez; günün kasası verilmezse bugünkü metin", () => {
  const f = { ...report({ bankPos: 8_100 }) };
  const modposWa = whatsappText(f, { by: "Ayşe" });
  assert.match(modposWa, /\*ModPOS Z raporu\*/);
  assert.match(plain(modposWa), /Banka POS: 8\.100 ₺ ⚠️ ModPOS'tan 100 ₺ fazla/);
  const wa = plain(whatsappText(f, { by: "Ayşe", kasa: "AsilPOS" }));
  assert.doesNotMatch(wa, /ModPOS/);
  assert.match(wa, /\*AsilPOS gün sonu \(Z\)\*/);
  assert.match(wa, /Banka POS: 8\.100 ₺ ⚠️ AsilPOS'tan 100 ₺ fazla/);
  // Yazarkasa bölümüyle (yöneticinin metni karşılaştırmaların hepsini taşır)
  const okc = { ...report({ bankPos: 7_900 }), ...OKC };
  assert.doesNotMatch(cashReportText(okc, { by: "Ayşe", kasa: "AsilPOS" }, "admin"), /ModPOS/);
  assert.match(cashReportText(okc, { by: "Ayşe" }, "admin"), /Kart ModPOS ile aynı|ModPOS'tan/);
  // E-posta: Kart bölümünün satırı, uyarısı ve ikram denetimi
  const at = new Date("2026-11-11T20:00:00Z");
  const modposMail = renderCashReport({ ...f, offRevenue: 300 }, { by: "Ayşe", revision: 1, submittedAt: at, ikramValue: 100 });
  assert.match(html(modposMail.html), /ModPOS kart/);
  assert.match(html(modposMail.html), /Banka POS ModPOS'taki karttan 100 ₺ fazla/);
  assert.match(html(modposMail.html), /ModPOS'un ödenmez tutarı panelde kayıtlı ikramdan 200 ₺ fazla/);
  const mail = renderCashReport({ ...f, offRevenue: 300 }, { by: "Ayşe", revision: 1, submittedAt: at, ikramValue: 100, kasa: "AsilPOS" });
  for (const part of [mail.html, mail.text]) assert.doesNotMatch(part, /ModPOS/);
  assert.match(html(mail.html), /AsilPOS kart/);
  assert.match(html(mail.html), /Banka POS AsilPOS'taki karttan 100 ₺ fazla/);
  assert.match(html(mail.html), /AsilPOS'un ödenmez tutarı panelde kayıtlı ikramdan 200 ₺ fazla/);
  const okcMail = renderCashReport(okc, { by: "Ayşe", revision: 1, submittedAt: at, kasa: "AsilPOS" });
  assert.doesNotMatch(okcMail.html, /ModPOS/);
});

test("yazarkasa bölümüne çekilen kasa çıktısı: AsilPOS gününde ModPOS bölümüne okutma önerilmez", () => {
  const wrong = failed("kasa-okc", "Bu ModPOS'un Z raporu gibi görünüyor.", "kasa-z");
  const laf = okcReadingOnAsilposDay(wrong);
  assert.equal(laf.switchTo, null);
  assert.equal(laf.error, OKC_SOFTWARE_Z_ASILPOS_TEXT);
  assert.doesNotMatch(OKC_SOFTWARE_Z_ASILPOS_TEXT, /ModPOS/);
  // Öteki hatalar ve başarılı okuma olduğu gibi
  const x = failed("kasa-okc", "Bu bir X raporu (gün içi) gibi görünüyor; yazarkasadan Z raporunu alıp çekin.");
  assert.equal(okcReadingOnAsilposDay(x), x);
  const z = failed("kasa-z", "…", "kasa-pos");
  assert.equal(okcReadingOnAsilposDay(z), z);
  // Pavo gününde (ayrı mali Z yok) yazarkasanın Z'si istenmez, Pavo'nun gün sonu fişi istenir
  const pavo = okcReadingOnAsilposDay(wrong, { provider: "pavo", zReport: false });
  assert.equal(pavo.error, OKC_SOFTWARE_Z_PAVO_TEXT);
  assert.doesNotMatch(OKC_SOFTWARE_Z_PAVO_TEXT, /ModPOS|yazarkasa/i);
  assert.equal(okcReadingOnAsilposDay(wrong, { provider: "tokenx", zReport: true }).error, OKC_SOFTWARE_Z_ASILPOS_TEXT);
  // Okuyucu yalnız AsilPOS gününde uygular (cihazla)
  const src = read("src/server/photo-read/read.ts");
  assert.match(src, /const full = isAsilposDay\(input\.day, asilposDay\.switchDay\) \? okcReadingOnAsilposDay\(normalized, asilposDay\.device\) : normalized;/);
  assert.match(src, /okcReadingOnAsilposDay\(normalizeOkc\(asilpos\.raw, \{ day: input\.day, prev, recentTotals \}\), asilpos\.device\)/);
});

// ---------------------------------------------------------------- Kaynak: okuyucular geçiş gününe bakar

test("kaynak: kasadaki fiyatların okuyucuları ve yazımı bugünün kasasına bakar; hiçbir işaret silinmez", () => {
  const record = read("src/server/prices/record.ts");
  // Kasanın durumu geçiş gününden bağımsız yazılır (B11 incelemesi D1), her etkin fiziksel şubeye (şube kapsamı A3);
  // geçiş günü yalnız bildirimin `posPending`'i için ve yalnız siteye bağlı üründe okunur
  assert.match(record, /for \(const till of tills\) \{\n      const cur = [^\n]*\n      const next = posAfterPriceChange/);
  assert.match(record, /if \(next\.stalePrice !== null && \(row\.siteMenuId === null \|\| tillPriceManual\(branchTill\(switchDay, till\.id, at, \[\], asilposBranch\), true\)\)\) posPending = true;/);
  const scope = read("src/server/data/till-scope.ts");
  assert.match(scope, /return and\(isNull\(s\.products\.siteMenuId\), changedSinceStart\);/);
  const prices = read("src/server/data/prices.ts");
  const staff = read("src/server/data/pos-staff.ts");
  for (const [name, src] of [
    ["posPendingSummary", prices],
    ["loadPosChecklist", prices],
    ["loadStaffPosList", staff],
    ["staffPosSummary", staff],
  ] as const) {
    const start = src.indexOf(`export async function ${name}`);
    const end = src.indexOf("\nexport ", start + 1);
    const body = src.slice(start, end < 0 ? undefined : end);
    assert.match(body, /tillProductFilter\(sc, db\)/, name);
    assert.match(body, /tillSince\(sc, /, name);
  }
  // AsilPOS gününde personele fiyat görevi yok (B11 incelemesi K1): zil sorgusu hiç yapılmaz, işaret eylemi reddeder,
  // Kasadaki fiyatlar listesi okunmaz (kendi işaretini geri alması sürer)
  const bell = read("src/server/bell/ops.ts");
  assert.match(bell, /if \(user\.role !== "admin" && scope\.asilpos\) continue;/);
  const action = read("src/server/actions/pos-marks.ts");
  const mark = action.slice(action.indexOf("export async function markPosDone"), action.indexOf("export async function undoPosMarks"));
  assert.match(mark, /if \(me\.role !== "admin" && \(await loadTillScope\(undefined, undefined, till\)\)\.asilpos\) throw new UserError\(/);
  assert.doesNotMatch(action.slice(action.indexOf("export async function undoPosMarks")), /loadTillScope/);
  const page = read("src/app/panel/kasa/fiyatlar/page.tsx");
  assert.match(page, /scope\.asilpos \? \[\] : loadStaffPosList\(scope\)/);
  // Geçiş günü değişince hiçbir kasa işareti yazılmaz ya da silinmez (yalnız okuyucular değişir)
  for (const f of ["src/server/data/till-scope.ts", "src/server/asilpos/admin.ts", "src/server/actions/asilpos.ts"]) {
    assert.doesNotMatch(read(f), /posStalePrice|pos_stale_price|\.(insert|update|delete)\(s\.posStale\)/, f);
  }
});
