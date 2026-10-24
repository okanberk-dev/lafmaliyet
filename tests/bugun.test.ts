// Bugün ekranı: günün işleri rol rol (src/app/panel/bugun/logic.ts), satırların durumu, metni ve adresi, Şimdi / Sonra /
// Tamam bölümleri, başlık, "Bugün kafede", kendiliğinden yenileme ve kasa raporunun "akşam" kuralı (src/lib/cash-report.ts);
// kaynak denetimi: personel yönetici olgularını hiç yüklemez (src/server/data/today.ts).
// Saatler sabit: new Date("2026-10-22T11:00:00Z") Türkiye'de 14:00 (UTC+3).
// Çalıştırma: npx tsx --test tests/bugun.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  businessDayRange,
  cafeLines,
  CASH_FLAGS,
  cashFlags,
  clip,
  dayContext,
  daySummary,
  dayTasks,
  karaokeToday,
  nextRefreshAt,
  splitTasks,
  systemIssues,
  WASTE_SUMMARY_MAX,
  type CashFlagReport,
  type CashLite,
  type DayFacts,
  type DayTask,
} from "../src/app/panel/bugun/logic";
import { businessDate, isCashEvening, revisionDataOf, trHour, type CashRevisionRow } from "../src/lib/cash-report";
import { checklistBoundaries, type ChecklistLite, type IssueLite, type RunLite } from "../src/lib/checklists";
import { jobHealth, type JobKey, type JobRunLite, type RunStatus } from "../src/lib/job-health";
import type { KaraokeSessionDTO } from "../src/lib/karaoke/session";
import { HOLDS_HREF } from "../src/lib/price-hold";
import type { UpcomingItem, UpcomingStatus } from "../src/lib/reminders";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/** Türkiye saatiyle an: "2026-10-22T14:00" */
const tr = (local: string) => new Date(`${local}:00+03:00`);

const NOON = tr("2026-10-22T14:00");
const EVENING = tr("2026-10-22T21:00");

function report(date: string, o: Partial<CashLite> = {}): CashLite {
  return { date, cashDiff: 0, zTotal: 12400, cash: 3100, card: 9300, submittedByName: "Mehmet", revision: 1, note: null, ...o };
}

/** Sayım: bu ay sayılmadı, geçen ay sayıldı (sayım satırları çıkmasın) */
const STOCK = { month: "2026-10", counted: 0, total: 40, prevMonth: "2026-09", prevHasData: true, prevCounted: 40, prevTotal: 40 };

function staff(now: Date, o: Partial<DayFacts> = {}): DayFacts {
  return { role: "staff", now, cash: { today: null, yesterday: null, firstDate: null }, waste: { count: 0, zayi: null, ikram: null }, stock: STOCK, ...o };
}

/** Yönetici: ödeme ve kontrol bekleyen fatura yok, diğer kaynaklar boş */
function admin(now: Date, o: Partial<DayFacts> = {}): DayFacts {
  return { role: "admin", now, cash: { today: null, yesterday: null, firstDate: null }, stock: STOCK, system: [], payments: [], invoices: { review: 0 }, ...o };
}

const keys = (tasks: DayTask[]) => tasks.map((t) => t.key);
const byKey = (tasks: DayTask[]) => Object.fromEntries(tasks.map((t) => [t.key, t])) as Record<string, DayTask>;

function pay(title: string, status: UpcomingStatus, amount: number | null, daysLeft: number): UpcomingItem {
  return { ref: `reminder:${title}`, source: "reminder", sourceId: 1, kind: "odeme", title, detail: null, amount, dueDate: "2026-10-22", daysLeft, status, remindDaysBefore: 3, repeat: "none" };
}

// ---------------------------------------------------------------- Personel

test("1. personel gündüz, hiç rapor yok: zayi ve kasa 'sonra', sıradaki yok, başlık 'Şimdilik iş yok · 2 iş sonra'", () => {
  const tasks = dayTasks(staff(NOON));
  assert.deepEqual(keys(tasks), ["zayi", "kasa"]);
  assert.deepEqual(
    tasks.map((t) => [t.status, t.badge]),
    [
      ["later", "Gün içinde"],
      ["later", "Akşam"],
    ],
  );
  assert.equal(splitTasks(tasks).next, null);
  assert.equal(daySummary(tasks, 0).headline, "Şimdilik iş yok · 2 iş sonra");
  assert.equal(byKey(tasks).kasa.href, "/panel/kasa");
  assert.equal(byKey(tasks).zayi.href, "/panel/zayi");
});

test("2. dünün raporu yok: kasa kullanılmaya başladıysa 'Dünkü kasa raporu' yapılacak ve sıradaki; ilk rapor dünden sonraysa satır yok", () => {
  const tasks = dayTasks(staff(NOON, { cash: { today: null, yesterday: null, firstDate: "2026-10-01" } }));
  const t = byKey(tasks)["kasa-dun"];
  assert.equal(t.status, "todo");
  assert.equal(t.href, "/panel/kasa?gun=2026-10-21");
  assert.equal(t.action, "Dünü gir");
  assert.match(t.detail, /^21 Ekim Çarşamba raporu girilmedi\. Kafe açıktıysa bugün girin; yarın yalnız yönetici girebilir\.$/);
  assert.equal(splitTasks(tasks).next?.key, "kasa-dun");
  // İlk rapor bugün (ya da hiç yok): dün beklenmez
  for (const firstDate of ["2026-10-22", null]) {
    assert.ok(!keys(dayTasks(staff(NOON, { cash: { today: null, yesterday: null, firstDate } }))).includes("kasa-dun"), String(firstDate));
  }
  // Personel dünün gönderilmiş raporunu Bugün'de görmez (yöneticinin satırı)
  assert.ok(!keys(dayTasks(staff(NOON, { cash: { today: null, yesterday: report("2026-10-21"), firstDate: "2026-10-01" } }))).includes("kasa-dun"));
  // Yönetici: daha sonra yalnız yönetici girer
  const a = byKey(dayTasks(admin(NOON, { cash: { today: null, yesterday: null, firstDate: "2026-10-01" } })))["kasa-dun"];
  assert.equal(a.status, "todo");
  assert.equal(a.badge, "Girilmedi");
  assert.equal(a.action, "Raporu gir");
  assert.match(a.detail, /personel bugün de girebilir; daha sonra yalnız siz girersiniz/);
});

test("3. personel 21:00: zayi 'Rapordan önce' ve kasa yapılacak, sıradaki zayi; rapor gönderilince ikisi de tamam", () => {
  const tasks = dayTasks(staff(EVENING, { waste: { count: 2, zayi: "Süt 1 LT", ikram: "2× Latte M" } }));
  const t = byKey(tasks);
  assert.equal(t.zayi.status, "todo");
  assert.equal(t.zayi.badge, "Rapordan önce");
  assert.equal(t.zayi.detail, "2 kayıt · İkram: 2× Latte M · Zayi: Süt 1 LT. Eksik varsa kasa raporundan önce ekleyin.");
  assert.equal(t.kasa.status, "todo");
  assert.equal(t.kasa.detail, "Kapanışta ModPOS'tan Z raporunu alın, kasadaki nakdi sayıp girin.");
  assert.equal(splitTasks(tasks).next?.key, "zayi");
  // Kayıt yoksa
  assert.match(byKey(dayTasks(staff(EVENING))).zayi.detail, /^Bugün kayıt yok\. Atılan ya da ikram edilen olduysa kasa raporundan önce girin\.$/);

  const sent = byKey(dayTasks(staff(EVENING, { cash: { today: report("2026-10-22", { cashDiff: -120 }), yesterday: null, firstDate: "2026-10-01" } })));
  assert.equal(sent.zayi.status, "done");
  assert.equal(sent.zayi.detail, "Bugün kayıt yok.");
  assert.equal(sent.kasa.status, "done");
  assert.equal(sent.kasa.badge, "Gönderildi");
  assert.match(sent.kasa.detail, /^Mehmet gönderdi · 120\s₺ eksik$/);
  assert.equal(sent.kasa.href, "/panel/kasa?gun=2026-10-22");
});

test("4. 01:30 (iş günü dün): kasa satırı iş gününe gider, açıklama tarihle başlar, akşam sayılır", () => {
  const night = tr("2026-10-23T01:30");
  const c = dayContext(night);
  assert.equal(c.today, "2026-10-23");
  assert.equal(c.day, "2026-10-22");
  assert.equal(c.yesterday, "2026-10-21");
  assert.equal(c.evening, true);
  const t = byKey(dayTasks(staff(night)));
  assert.equal(t.kasa.status, "todo");
  assert.match(t.kasa.detail, /^22 Ekim Perşembe · Kapanışta ModPOS'tan/);
  assert.match(t.zayi.detail, /^22 Ekim Perşembe · Bugün kayıt yok/);
  const sent = byKey(dayTasks(staff(night, { cash: { today: report("2026-10-22"), yesterday: null, firstDate: "2026-10-01" } })));
  assert.equal(sent.kasa.href, "/panel/kasa?gun=2026-10-22");
  assert.match(sent.kasa.detail, /^22 Ekim Perşembe · Mehmet gönderdi · Kasa tutuyor$/);
  // Gündüz tarih yazılmaz
  assert.doesNotMatch(byKey(dayTasks(staff(EVENING))).kasa.detail, /Ekim/);
});

// ---------------------------------------------------------------- Yönetici: kasa

test("5. yönetici dünkü rapor: eksik sorun, fazla yapılacak, tutuyorsa tamam; güncellendi ve not açıklamada", () => {
  const row = (o: Partial<CashLite>) => byKey(dayTasks(admin(NOON, { cash: { today: null, yesterday: report("2026-10-21", o), firstDate: "2026-10-01" } })))["kasa-dun"];
  const short = row({ cashDiff: -120 });
  assert.equal(short.status, "warn");
  assert.match(short.badge!, /^120\s₺ eksik$/);
  assert.equal(short.href, "/panel/kasa?gun=2026-10-21");
  assert.equal(short.action, "Rapora bak");
  assert.match(short.detail, /^Mehmet · Z 12\.400\s₺ · nakit 3\.100\s₺ · kart 9\.300\s₺$/);
  const over = row({ cashDiff: 30 });
  assert.equal(over.status, "todo");
  assert.match(over.badge!, /^30\s₺ fazla$/);
  const even = row({ cashDiff: 0.5 });
  assert.equal(even.status, "done");
  assert.equal(even.badge, "Kasa tutuyor");
  const updated = row({ revision: 2, note: "Bozuk para eksik" });
  assert.match(updated.detail, / · güncellendi · Not: Bozuk para eksik$/);
});

test("kasa bütünlüğü (yönetici): açılış devirle tutmuyor ya da ertesi gün düzeltildi satırı 'sorun' yapar ve açıklamaya yazılır", () => {
  const facts = (o: Partial<CashLite>, today: CashLite | null = null) =>
    admin(EVENING, { cash: { today, yesterday: report("2026-10-21", o), firstDate: "2026-10-01" } });
  const carry = byKey(dayTasks(facts({ flags: [CASH_FLAGS.carry] })))["kasa-dun"];
  assert.equal(carry.status, "warn");
  // Kasa tutuyor ama açılış tutmuyor: rozet uyarıyı söyler, fark açıklamada
  assert.equal(carry.badge, "Açılış devirle tutmuyor");
  assert.match(carry.detail, / · Kasa tutuyor · Açılış devirle tutmuyor$/);
  // Ertesi gün düzeltilen rapor: "güncellendi" ayrıca yazılmaz
  const late = byKey(dayTasks(facts({ revision: 3, cashDiff: -50, flags: [CASH_FLAGS.late] })))["kasa-dun"];
  assert.equal(late.status, "warn");
  assert.match(late.badge!, /^50\s₺ eksik$/);
  assert.match(late.detail, / · Ertesi gün düzeltildi$/);
  assert.doesNotMatch(late.detail, /güncellendi/);
  // Bugünün raporu da aynı kuralla
  const today = byKey(dayTasks(facts({}, report("2026-10-22", { flags: [CASH_FLAGS.carry] })))).kasa;
  assert.equal(today.title, "Bugünkü kasa raporu");
  assert.equal(today.status, "warn");
  assert.match(today.detail, /^Mehmet · Z 12\.400\s₺ · Kasa tutuyor · Açılış devirle tutmuyor$/);
  // Uyarı yoksa eskisi gibi
  assert.equal(byKey(dayTasks(facts({})))["kasa-dun"].status, "done");
});

/** Bütünlük uyarıları için tam kasa raporu: açılış 500, sayılan 3.600, teslim 3.100 (ertesi güne devir 500), Mehmet (7) */
function fullReport(id: number, date: string, o: Partial<CashFlagReport> = {}): CashFlagReport {
  return {
    id,
    date,
    zNo: null,
    receipts: null,
    zTotal: 12400,
    cash: 3100,
    card: 9300,
    mealCard: 0,
    online: 0,
    other: 0,
    openingCash: 500,
    cashOut: 0,
    cashOutNote: null,
    countedCash: 3600,
    handedOver: 3100,
    bankPos: null,
    offRevenue: null,
    discounts: null,
    note: null,
    revision: 1,
    cashDiff: 0,
    countedByName: "Mehmet",
    submittedBy: 7,
    submittedByName: "Mehmet",
    createdAt: tr(`${date}T23:00`).toISOString(),
    updatedAt: tr(`${date}T23:00`).toISOString(),
    ...o,
  };
}

test("kasa bütünlüğü (cashFlags): açılış önceki raporun devriyle (dünün raporu yoksa ondan öncekiyle), ertesi gün düzeltmesi, sıra önemsiz", () => {
  const Y = "2026-10-21";
  const T = "2026-10-22";
  const before = { date: "2026-10-20", amount: 500 };
  type Revision = CashRevisionRow & { reportId: number };
  const flags = (reports: CashFlagReport[], b: { date: string; amount: number } | null = before, revisions: Revision[] = [], viewer = 1) =>
    Object.fromEntries(cashFlags(reports, b, revisions, viewer));
  // Dünün açılışı önceki günün devriyle
  assert.deepEqual(flags([fullReport(1, Y)]), { [Y]: [] });
  assert.deepEqual(flags([fullReport(1, Y)], { date: "2026-10-20", amount: 380 }), { [Y]: [CASH_FLAGS.carry] });
  // Önceki rapor hiç yoksa (ilk rapor) denetlenmez
  assert.deepEqual(flags([fullReport(1, Y, { openingCash: 0 })], null), { [Y]: [] });
  // Bugünün açılışı dünün devriyle (sayılan − teslim)
  assert.deepEqual(flags([fullReport(2, T), fullReport(1, Y)]), { [T]: [], [Y]: [] });
  assert.deepEqual(flags([fullReport(2, T, { openingCash: 450 }), fullReport(1, Y)]), { [T]: [CASH_FLAGS.carry], [Y]: [] });
  // Dünün sayılanı sonradan değişti: dün tutuyor, bugünün açılışı artık tutmuyor
  assert.deepEqual(flags([fullReport(2, T), fullReport(1, Y, { countedCash: 3700 })]), { [T]: [CASH_FLAGS.carry], [Y]: [] });
  // Dünün raporu yok: bugünün açılışı ondan önceki son raporun devriyle (yükleyici onu `before` olarak verir)
  assert.deepEqual(flags([fullReport(2, T, { openingCash: 450 })]), { [T]: [CASH_FLAGS.carry] });
  assert.deepEqual(flags([fullReport(2, T, { openingCash: 450 })], { date: "2026-10-20", amount: 450 }), { [T]: [] });

  // Ertesi gün düzeltmesi: dünün raporu bugün 10:00'da kasa alanı (nakit satış) değiştirilerek yeniden gönderildi
  const revisions: Revision[] = [
    { reportId: 1, revision: 1, data: revisionDataOf(fullReport(1, Y, { cash: 3000 })), submittedBy: 7, submittedByName: "Mehmet", submittedAt: tr(`${Y}T23:00`).toISOString() },
  ];
  const fixedBy = (submittedBy: number, updatedAt = tr("2026-10-22T10:00").toISOString()) =>
    fullReport(1, Y, { revision: 2, submittedBy, submittedByName: submittedBy === 7 ? "Mehmet" : "Yönetici", updatedAt });
  assert.deepEqual(flags([fixedBy(7)], before, revisions), { [Y]: [CASH_FLAGS.late] }, "personel düzeltti");
  assert.deepEqual(flags([fixedBy(1)], before, revisions, 1), { [Y]: [] }, "bakan yöneticinin kendi düzeltmesi");
  assert.deepEqual(flags([fixedBy(1)], before, revisions, 2), { [Y]: [CASH_FLAGS.late] }, "başka bir yöneticinin düzeltmesi");
  // İş günü kapanmadan (gece 01:30) düzeltilen rapor uyarı değil; başka raporun sürümleri bu rapora yazılmaz
  assert.deepEqual(flags([fixedBy(7, tr("2026-10-22T01:30").toISOString())], before, revisions), { [Y]: [] });
  assert.deepEqual(flags([fixedBy(7)], before, revisions.map((r) => ({ ...r, reportId: 9 }))), { [Y]: [] });
  // İki uyarı birden (önce açılış, sonra düzeltme) ve listenin sırası sonucu değiştirmez
  const reports = [fullReport(2, T, { openingCash: 450 }), fixedBy(7)];
  const expected = { [T]: [CASH_FLAGS.carry], [Y]: [CASH_FLAGS.carry, CASH_FLAGS.late] };
  const off = { date: "2026-10-20", amount: 380 };
  assert.deepEqual(flags(reports, off, revisions), expected);
  assert.deepEqual(flags([...reports].reverse(), off, revisions), expected);
});

test("yönetici bugünkü kasa: gündüz 'Akşam', 20:00'den sonra girilmedi; okunamazsa dün satırı söyler, bugünkü çıkmaz", () => {
  const day = byKey(dayTasks(admin(NOON))).kasa;
  assert.equal(day.status, "later");
  assert.equal(day.badge, "Akşam");
  assert.equal(day.detail, "Personel kapanışta girer.");
  const evening = byKey(dayTasks(admin(EVENING))).kasa;
  assert.equal(evening.status, "todo");
  assert.equal(evening.badge, "Girilmedi");
  assert.equal(evening.href, "/panel/kasa?gun=2026-10-22");
  const unread = dayTasks(admin(NOON, { cash: null }));
  assert.equal(byKey(unread)["kasa-dun"].status, "later");
  assert.equal(byKey(unread)["kasa-dun"].badge, "Okunamadı");
  assert.equal(byKey(unread)["kasa-dun"].detail, "Kasa raporları şu an okunamadı.");
  assert.ok(!keys(unread).includes("kasa"));
  // Personelde dün satırı "okunamadı" demez; bugünkü der
  const staffUnread = dayTasks(staff(NOON, { cash: null }));
  assert.deepEqual(keys(staffUnread), ["zayi", "kasa"]);
  assert.equal(byKey(staffUnread).kasa.badge, "Okunamadı");
});

// ---------------------------------------------------------------- Sayım

test("6. ay sonu sayımı: son gün başlamadıysa, yarıdaysa, bittiyse; ayın ilk 10 gününde geçen ay; gece yarısından sonra", () => {
  const lastDay = tr("2026-10-31T15:00");
  const end = (counted: number) => byKey(dayTasks(staff(lastDay, { stock: { ...STOCK, counted } })))["sayim-son"];
  assert.equal(end(0).status, "todo");
  assert.equal(end(0).action, "Sayıma başla");
  assert.equal(end(0).href, "/panel/sayim?ay=2026-10");
  assert.equal(end(12).badge, "12 / 40");
  assert.equal(end(12).detail, "12 / 40 kalem sayıldı; kalanları da girin.");
  assert.equal(end(40).status, "done");
  assert.equal(end(40).detail, "40 kalemin hepsi sayıldı.");
  // Ayın öteki günlerinde yok
  assert.ok(!keys(dayTasks(staff(NOON))).includes("sayim-son"));

  const nov = (local: string, prevHasData: boolean, role: "staff" | "admin" = "staff") => {
    const now = tr(local);
    const stock = { month: "2026-11", counted: 0, total: 40, prevMonth: "2026-10", prevHasData, prevCounted: prevHasData ? 40 : 0, prevTotal: 40 };
    return dayTasks(role === "staff" ? staff(now, { stock }) : admin(now, { stock }));
  };
  const prev = byKey(nov("2026-11-03T10:00", false))["sayim-gecen"];
  assert.equal(prev.status, "todo");
  assert.equal(prev.href, "/panel/sayim?ay=2026-10");
  assert.match(prev.detail, /^Ekim 2026 ay sonu sayımı girilmedi/);
  assert.match(byKey(nov("2026-11-03T10:00", false, "admin"))["sayim-gecen"].detail, /^Ekim 2026 sayımı yok: devreden stok 0 sayılır/);
  assert.ok(!keys(nov("2026-11-03T10:00", true)).includes("sayim-gecen"), "geçen ay sayıldı");
  assert.ok(!keys(nov("2026-11-11T10:00", false)).includes("sayim-gecen"), "11. gün");
  // 1 Kasım 00:30: takvim günü ayın son günü değil, geçen ay (Ekim) sayılmadıysa satırı var
  const midnight = keys(nov("2026-11-01T00:30", false));
  assert.ok(!midnight.includes("sayim-son"));
  assert.ok(midnight.includes("sayim-gecen"));
});

test("sayım gece yarısını geçerse: 31 Ekim 23:50'deki 12 / 40, 1 Kasım 00:30'da 'Geçen ayın stok sayımı' olur ve Ekim'e götürür", () => {
  // 23:50: ay sonu satırı Ekim'in ilerlemesini söyler
  const october = { month: "2026-10", counted: 12, total: 40, prevMonth: "2026-09", prevHasData: true, prevCounted: 40, prevTotal: 40 };
  const before = dayTasks(staff(tr("2026-10-31T23:50"), { stock: october }));
  assert.equal(byKey(before)["sayim-son"].badge, "12 / 40");
  assert.equal(byKey(before)["sayim-son"].href, "/panel/sayim?ay=2026-10");
  assert.ok(!keys(before).includes("sayim-gecen"));
  // 00:30: takvim ayı Kasım; Ekim'in sayımı yarım. Stok sayımı ekranı kendiliğinden Kasım'ı açar (Ekim'de sayım var):
  // satır kalan kalemleri Ekim'e götürür
  const november = { month: "2026-11", counted: 0, total: 40, prevMonth: "2026-10", prevHasData: true, prevCounted: 12, prevTotal: 40 };
  const after = dayTasks(staff(tr("2026-11-01T00:30"), { stock: november }));
  assert.ok(!keys(after).includes("sayim-son"));
  const row = byKey(after)["sayim-gecen"];
  assert.equal(row.status, "todo");
  assert.equal(row.badge, "12 / 40");
  assert.equal(row.href, "/panel/sayim?ay=2026-10");
  assert.equal(row.action, "Sayıma devam");
  assert.equal(row.detail, "Ekim 2026 ay sonu sayımı yarım kaldı: 12 / 40 kalem sayıldı; kalanları da girin.");
  assert.equal(splitTasks(after).next?.key, "sayim-gecen");
  // Yöneticiye eksik sayımın etkisi
  assert.equal(
    byKey(dayTasks(admin(tr("2026-11-01T09:00"), { stock: november })))["sayim-gecen"].detail,
    "Ekim 2026 sayımı yarım kaldı: 12 / 40 kalem sayıldı, kalanların stoğu 0 sayılır.",
  );
  // Ertesi sabah da sürer (sayım çoğu zaman ertesi sabah biter); 10. günden sonra yok
  assert.ok(keys(dayTasks(staff(tr("2026-11-10T18:00"), { stock: november }))).includes("sayim-gecen"));
  assert.ok(!keys(dayTasks(staff(tr("2026-11-11T09:00"), { stock: november }))).includes("sayim-gecen"));
  // Hepsi sayılınca satır kalkar; sayılacak kalem yoksa (yalnız ek kalem girilmiş) yarım sayılmaz
  assert.ok(!keys(dayTasks(staff(tr("2026-11-01T00:45"), { stock: { ...november, prevCounted: 40 } }))).includes("sayim-gecen"));
  assert.ok(!keys(dayTasks(staff(tr("2026-11-01T09:00"), { stock: { ...november, prevCounted: 0, prevTotal: 0 } }))).includes("sayim-gecen"));
});

// ---------------------------------------------------------------- Yönetici: öteki satırlar

test("7. ödemeler: geciken sorun (bugünkü de anılır), yalnız bugün yapılacak, hiçbiri yoksa tamam (yaklaşan bilgi), okunamadı", () => {
  const row = (payments: UpcomingItem[] | null) => byKey(dayTasks(admin(NOON, { payments }))).odeme;
  const late = row([pay("Kira", "overdue", 30000, -2), pay("SGK", "today", 12000.5, 0)]);
  assert.equal(late.status, "warn");
  assert.equal(late.badge, "1 gecikti");
  assert.match(late.detail, /^1 ödeme gecikti \(30\.000\s₺\)\. Ödendiyse işaretleyin\. Bugün: 1 ödeme \(12\.000,50\s₺\)\.$/);
  const today = row([pay("Elektrik", "today", 800, 0), pay("Su", "today", null, 0), pay("Doğalgaz", "today", 200, 0)]);
  assert.equal(today.status, "todo");
  assert.equal(today.badge, "Bugün");
  assert.match(today.detail, /^3 ödeme bugün \(1\.000\s₺\): Elektrik, Su…$/);
  const none = row([pay("Kira", "soon", 30000, 4), pay("Not", "later", 10, 40)]);
  assert.equal(none.status, "done");
  assert.match(none.detail, /^Bugün ödenecek yok\. Yaklaşan 1 ödeme \(30\.000\s₺\)\.$/);
  assert.equal(row([]).detail, "Bugün ödenecek yok.");
  const unread = row(null);
  assert.equal(unread.status, "later");
  assert.equal(unread.badge, "Okunamadı");
  for (const t of [late, today, none, unread]) assert.equal(t.href, "/panel/hatirlaticilar");
});

test("8. faturalar: kontrol bekleyen yapılacak, yoksa tamam; okunamazsa satır yok; eşitleme hatası bu satırda değil", () => {
  const review = byKey(dayTasks(admin(NOON, { invoices: { review: 3 } }))).fatura;
  assert.equal(review.status, "todo");
  assert.equal(review.badge, "3 kontrol");
  assert.equal(review.href, "/panel/faturalar?durum=kontrol");
  assert.match(review.detail, /^3 fatura kontrol bekliyor: kategorisi tahminle yazıldı/);
  const none = byKey(dayTasks(admin(NOON))).fatura;
  assert.equal(none.status, "done");
  assert.equal(none.detail, "Kontrol bekleyen fatura yok.");
  assert.ok(!keys(dayTasks(admin(NOON, { invoices: null }))).includes("fatura"));
  // Paraşüt'ün hatası "isler" satırında (ops'un sistem uyarıları); fatura satırı eşitlemeyi sormaz
  assert.doesNotMatch(read("src/app/panel/bugun/logic.ts"), /lastStatus|lastOkAt|Eşitleme hatası/);
});

test("komisyon: geciken hakediş varsa 'sorun var' (en eski son gün), yoksa satır yok; Komisyon & hakediş'e götürür", () => {
  const row = (overdue: { label: string; month: string; due: string }[]) => byKey(dayTasks(admin(NOON, { commission: { overdue } }))).komisyon;
  const one = row([{ label: "Pluxee", month: "2026-09", due: "2026-10-20" }]);
  assert.equal(one.status, "warn");
  assert.equal(one.title, "Hakedişler");
  assert.equal(one.badge, "1 gecikti");
  assert.equal(one.detail.replaceAll("\u00a0", " "), "Pluxee hakedişi (Eylül satışları): son gün 20 Ekim. Geldiyse işaretleyin.");
  assert.equal(one.href, "/panel/komisyonlar");
  assert.equal(one.action, "Hakedişlere bak");
  const two = row([
    { label: "Trendyol Go", month: "2026-09", due: "2026-10-14" },
    { label: "Pluxee", month: "2026-09", due: "2026-10-20" },
  ]);
  assert.equal(two.badge, "2 gecikti");
  assert.equal(two.detail.replaceAll("\u00a0", " "), "Trendyol Go hakedişi (Eylül satışları): son gün 14 Ekim. 1 hakediş daha gecikti. Geldiyse işaretleyin.");
  // Ay, hakedişin satış ayı (son gün değil): platformda son gün 90 güne kadar sonra
  const platform = row([{ label: "Yemeksepeti", month: "2026-07", due: "2026-10-21" }]);
  assert.equal(platform.detail.replaceAll("\u00a0", " "), "Yemeksepeti hakedişi (Temmuz satışları): son gün 21 Ekim. Geldiyse işaretleyin.");
  // Pencere 13 ay: geçen yılın aynı adlı ayı yılıyla yazılır
  const lastYear = row([{ label: "Pluxee", month: "2025-10", due: "2025-11-30" }]);
  assert.equal(lastYear.detail.replaceAll("\u00a0", " "), "Pluxee hakedişi (Ekim 2025 satışları): son gün 30 Kasım. Geldiyse işaretleyin.");
  const three = row([
    { label: "Trendyol Go", month: "2026-09", due: "2026-10-14" },
    { label: "Pluxee", month: "2026-09", due: "2026-10-20" },
    { label: "Multinet", month: "2026-09", due: "2026-10-21" },
  ]);
  assert.equal(three.badge, "3 gecikti");
  assert.equal(three.detail.replaceAll("\u00a0", " "), "Trendyol Go hakedişi (Eylül satışları): son gün 14 Ekim. 2 hakediş daha gecikti. Geldiyse işaretleyin.");
  // Geciken yok, okunamadı ya da olgu yok: satır çıkmaz
  for (const commission of [{ overdue: [] }, null, undefined]) assert.ok(!keys(dayTasks(admin(NOON, { commission }))).includes("komisyon"));
});

test("isler: günlük işlerin sorunları en üstte 'sorun var', Ayarlar › Günlük işler'e götürür; birden çoksa rozet sayar", () => {
  const one = dayTasks(admin(NOON, { system: [{ title: "Sabah işi çalışmadı", body: "22 Ekim Çarşamba 08:00–09:00 arasında çalışması gerekiyordu" }] }));
  assert.equal(one[0].key, "isler");
  assert.equal(one[0].status, "warn");
  assert.equal(one[0].href, "/panel/ayarlar#isler");
  assert.equal(one[0].badge, undefined);
  assert.equal(one[0].detail, "Sabah işi çalışmadı: 22 Ekim Çarşamba 08:00–09:00 arasında çalışması gerekiyordu.");
  assert.equal(splitTasks(one).next?.key, "isler");
  const two = byKey(
    dayTasks(
      admin(NOON, {
        system: [
          { title: "Sabah işi hata verdi", body: "Veritabanı yanıt vermedi" },
          { title: "Paraşüt işi hata verdi", body: "401" },
        ],
      }),
    ),
  ).isler;
  assert.equal(two.badge, "2 sorun");
  assert.equal(two.detail, "Sabah işi hata verdi: Veritabanı yanıt vermedi. Ayrıca: Paraşüt işi hata verdi.");
  for (const system of [[], null, undefined]) assert.ok(!keys(dayTasks(admin(NOON, { system }))).includes("isler"));
});

test("isler (systemIssues): Paraşüt işinin hatası sonradan başarılı bir eşitleme olana kadar (sabah işi ya da Şimdi eşitle); yalnız canlıda", () => {
  let id = 1;
  const jobRun = (job: JobKey, local: string, status: RunStatus, message: string | null = null): JobRunLite => ({
    id: id++,
    job,
    status,
    startedAt: tr(local).toISOString(),
    finishedAt: status === "running" ? null : new Date(tr(local).getTime() + 12_000).toISOString(),
    steps: null,
    message,
  });
  const watchSince = tr("2026-10-01T00:00").toISOString();
  const overview = (now: Date, runs: JobRunLite[]) => ({
    production: true,
    cronSecret: true,
    health: { parasut: jobHealth("parasut", runs, now, { watchSince }), gunluk: jobHealth("gunluk", runs, now, { watchSince }) },
  });
  const at = (local: string) => tr(local).toISOString();
  // 07:30 Paraşüt işi hata verdi; 08:15 sabah işi çalıştı (eşitlemeyi bir kez daha dener)
  const runs = [jobRun("parasut", "2026-10-22T07:30", "error", "Paraşüt 503 Service Unavailable"), jobRun("gunluk", "2026-10-22T08:15", "ok")];
  const now = tr("2026-10-22T10:00");
  // Eşitleme hâlâ hatalı (son başarılı eşitleme dün sabah ya da hiç yok): en üstte sorun var
  const failing = systemIssues(overview(now, runs), now, at("2026-10-21T07:30"));
  assert.deepEqual(failing, [{ title: "Paraşüt işi hata verdi", body: "Paraşüt 503 Service Unavailable" }]);
  assert.deepEqual(systemIssues(overview(now, runs), now, null), failing);
  const row = byKey(dayTasks(admin(now, { system: failing }))).isler;
  assert.equal(row.status, "warn");
  assert.equal(row.detail, "Paraşüt işi hata verdi: Paraşüt 503 Service Unavailable.");
  // Sabah işinin yeniden denemesi 08:15'te eşitledi: satır yok (zilin eşitleme satırı da kalktı)
  const healed = systemIssues(overview(now, runs), now, at("2026-10-22T08:15"));
  assert.deepEqual(healed, []);
  assert.ok(!keys(dayTasks(admin(now, { system: healed }))).includes("isler"));
  // Ya da yönetici öğleden sonra Paraşüt › Şimdi eşitle dedi
  const afternoon = tr("2026-10-22T14:30");
  assert.equal(systemIssues(overview(afternoon, runs), afternoon, at("2026-10-21T07:30")).length, 1);
  assert.deepEqual(systemIssues(overview(afternoon, runs), afternoon, at("2026-10-22T14:00")), []);
  // Gece 01:00'de Paraşüt işi hâlâ dün için değerlendirilir: dün telafi edildiyse yok, edilmediyse dünün hatası
  const night = tr("2026-10-23T01:00");
  assert.deepEqual(systemIssues(overview(night, runs), night, at("2026-10-22T08:15")), []);
  assert.deepEqual(systemIssues(overview(night, runs), night, at("2026-10-21T07:30")), failing);
  // Yarıda kesilen Paraşüt işi de aynı kurala bakar
  const stuck = [jobRun("parasut", "2026-10-22T07:30", "running"), jobRun("gunluk", "2026-10-22T08:15", "ok")];
  assert.deepEqual(systemIssues(overview(now, stuck), now, at("2026-10-21T07:30")).map((a) => a.title), ["Paraşüt işi yarıda kesildi"]);
  assert.deepEqual(systemIssues(overview(now, stuck), now, at("2026-10-22T08:15")), []);
  // Eşitlemenin telafisi sabah işinin kendi hatasını kapatmaz
  const both = [jobRun("parasut", "2026-10-22T07:30", "error", "Paraşüt 503"), jobRun("gunluk", "2026-10-22T08:15", "error", "Sabah e-postası: Resend 500")];
  assert.deepEqual(systemIssues(overview(now, both), now, at("2026-10-22T13:00")).map((a) => a.title), ["Sabah işi hata verdi"]);
  // Canlı değilse uyarı yok
  assert.deepEqual(systemIssues({ ...overview(now, runs), production: false }, now, null), []);
});

test("9. ürün bağlantısı, fiyatı girilmemiş hammadde, reçete onayı, fiyat onayı, zam ve kasa fiyatları yalnız sayı > 0 iken", () => {
  const empty = keys(dayTasks(admin(NOON, { unlinked: 0, unpriced: { count: 0, names: [] }, approvals: { changes: 0, newProducts: 0, names: [] }, holds: { count: 0, items: [] }, prices: null, pos: { count: 0, oldest: null } })));
  for (const k of ["urun", "fiyat-yok", "onay", "fiyat-onay", "zam", "modpos"] as const) assert.ok(!empty.includes(k), k);

  const t = byKey(
    dayTasks(
      admin(NOON, {
        unlinked: 4,
        unpriced: { count: 5, names: ["Çilek şurubu", "Böğürtlen püre", "Klips kapak"] },
        approvals: { changes: 2, newProducts: 1, names: ["Latte", "Mocha", "Çilekli Latte", "Americano"] },
        holds: { count: 2, items: [{ name: "Süt", pct: 0.52 }, { name: "Un", pct: null }] },
        prices: { detail: "Süt +%12. Latte M: maliyet oranı hedefin üstünde, önerilen fiyat hazır. Bu zamlar ayda ≈ 1.200 ₺ kâr götürüyor.", href: "/panel/urunler#zamlar", count: 3 },
        pos: { count: 3, oldest: "2026-10-19T09:00:00.000Z" },
      }),
    ),
  );
  assert.equal(t.urun.badge, "4 bekliyor");
  assert.equal(t.urun.href, "/panel/parasut?durum=bekleyen");
  assert.equal(t["fiyat-yok"].status, "todo");
  assert.equal(t["fiyat-yok"].badge, "5 hammadde");
  assert.equal(t["fiyat-yok"].detail, "Çilek şurubu, Böğürtlen püre, Klips kapak ve 2 hammadde daha · Hammaddeler'den paket fiyatını girin.");
  assert.equal(t["fiyat-yok"].href, "/panel/hammaddeler?durum=fiyatsiz");
  assert.equal(t.onay.badge, "3 bekliyor");
  assert.equal(t.onay.detail, "Personelin önerdiği 2 reçete değişikliği ve 1 yeni ürün önerisi onay bekliyor: Latte, Mocha, Çilekli Latte…");
  assert.equal(t.onay.href, "/panel/onaylar");
  // Fiyat onayı: Genel bakış'taki uyarıyla aynı metin
  assert.equal(t["fiyat-onay"].status, "todo");
  assert.equal(t["fiyat-onay"].href, HOLDS_HREF);
  assert.equal(HOLDS_HREF, "/panel/hammaddeler#fiyat-onayi");
  assert.match(t["fiyat-onay"].detail, /^Faturadaki fiyat şimdikinden %40'tan fazla farklı: Süt \+\u2060?%52, Un\. Onaylanana kadar/u);
  // Zam: priceAlert'in metni olduğu gibi (ayda TL etkisi dahil)
  assert.equal(t.zam.badge, "3 ürün");
  assert.match(t.zam.detail, /ayda ≈ 1\.200 ₺ kâr götürüyor\.$/);
  assert.equal(t.zam.href, "/panel/urunler#zamlar");
  // Kasada değişecek fiyatlar (ModPOS)
  assert.equal(t.modpos.status, "todo");
  assert.equal(t.modpos.badge, "3 fiyat");
  assert.equal(t.modpos.href, "/panel/urunler/fiyatlar?sekme=kasa");
  assert.equal(t.modpos.detail, "Kasada değişecek 3 fiyat: ModPOS'ta elle değiştirip Fiyatlar › Kasaya işle'de işaretleyin. En eskisi 3 gündür bekliyor.");
});

test("yönetici satır sırası: isler, kasa-dun, odeme, komisyon, fatura, urun, fiyat-yok, onay, fiyat-onay, zam, modpos, sayim-gecen, kasa", () => {
  const now = tr("2026-11-03T21:00");
  const tasks = dayTasks(
    admin(now, {
      system: [{ title: "Sabah işi çalışmadı", body: "…" }],
      cash: { today: null, yesterday: null, firstDate: "2026-10-01" },
      stock: { month: "2026-11", counted: 0, total: 40, prevMonth: "2026-10", prevHasData: false, prevCounted: 0, prevTotal: 40 },
      unlinked: 1,
      unpriced: { count: 1, names: ["Klips kapak"] },
      approvals: { changes: 1, newProducts: 0, names: ["Latte"] },
      holds: { count: 1, items: [{ name: "Süt", pct: 0.5 }] },
      prices: { detail: "…", href: "/panel/urunler#zamlar", count: 1 },
      pos: { count: 1, oldest: null },
      commission: { overdue: [{ label: "Pluxee", month: "2026-09", due: "2026-10-30" }] },
    }),
  );
  assert.deepEqual(keys(tasks), ["isler", "kasa-dun", "odeme", "komisyon", "fatura", "urun", "fiyat-yok", "onay", "fiyat-onay", "zam", "modpos", "sayim-gecen", "kasa"]);
  // Bölümler sırayı korur: tamamlanan ödeme ve fatura Şimdi'de değil
  const split = splitTasks(tasks);
  assert.deepEqual(keys(split.now), ["isler", "kasa-dun", "komisyon", "urun", "fiyat-yok", "onay", "fiyat-onay", "zam", "modpos", "sayim-gecen", "kasa"]);
  assert.deepEqual(keys(split.done), ["odeme", "fatura"]);
  // Personel sırası
  const staffTasks = dayTasks(
    staff(now, { cash: { today: null, yesterday: null, firstDate: "2026-10-01" }, stock: { month: "2026-11", counted: 0, total: 40, prevMonth: "2026-10", prevHasData: false, prevCounted: 0, prevTotal: 40 } }),
  );
  assert.deepEqual(keys(staffTasks), ["kasa-dun", "sayim-gecen", "zayi", "kasa"]);
});

test("personelin olgusuna yönetici bilgisi yanlışlıkla gelse de hiçbir yönetici satırı çıkmaz; tutar ve fiyat yazılmaz", () => {
  const facts = staff(EVENING, {
    system: [{ title: "Sabah işi çalışmadı", body: "…" }],
    payments: [pay("Kira", "overdue", 30000, -2)],
    invoices: { review: 3 },
    unlinked: 4,
    unpriced: { count: 2, names: ["Süt"] },
    approvals: { changes: 2, newProducts: 0, names: ["Latte"] },
    holds: { count: 1, items: [{ name: "Süt", pct: 0.5 }] },
    prices: { detail: "…", href: "/panel/urunler#zamlar", count: 3 },
    pos: { count: 2, oldest: null },
    commission: { overdue: [{ label: "Pluxee", month: "2026-09", due: "2026-10-20" }] },
    cash: { today: null, yesterday: report("2026-10-21", { flags: [CASH_FLAGS.carry] }), firstDate: "2026-10-01" },
  });
  const tasks = dayTasks(facts);
  assert.deepEqual(keys(tasks), ["zayi", "kasa"]);
  // Kasa bütünlüğü personelde satırı değiştirmez
  const sent = dayTasks({ ...facts, cash: { today: report("2026-10-22", { flags: [CASH_FLAGS.carry] }), yesterday: null, firstDate: "2026-10-01" } });
  assert.equal(byKey(sent).kasa.status, "done");
  assert.doesNotMatch(byKey(sent).kasa.detail, /devir/);
});

// ---------------------------------------------------------------- Kontrol listeleri (docs/KONTROL-LISTELERI.md)

/** Günün listesi: kayıt yoksa `run` null; varsayılan Açılış 11 zorunlu madde, 2'si fotoğraflı */
function checklist(templateId: number, name: string, opensAt: string, dueAt: string, run: Partial<RunLite> | null = null, o: Partial<ChecklistLite> = {}): ChecklistLite {
  return {
    templateId,
    name,
    opensAt,
    dueAt,
    required: run?.required ?? 11,
    photos: 2,
    staffAllowed: true,
    run: run
      ? {
          required: 11,
          done: 0,
          complete: false,
          photosLeft: 0,
          photos: 0,
          missing: [],
          issues: [],
          contributors: ["Ayşe"],
          firstAt: tr("2026-10-22T08:40").toISOString(),
          lastAt: tr("2026-10-22T08:50").toISOString(),
          completedAt: null,
          ...run,
        }
      : null,
    ...o,
  };
}

const ACILIS = checklist(1, "Açılış", "08:00", "11:00");
const KAPANIS = checklist(2, "Kapanış", "22:00", "02:00", null, { required: 15, photos: 3 });
const lists = (...l: ChecklistLite[]) => ({ day: "2026-10-22", lists: l });

const RANGE: IssueLite = {
  answerId: 41,
  itemId: 2,
  label: "Bar buzdolabı sıcaklığı",
  text: "Bar buzdolabı sıcaklığı: 6 °C (0–4 °C)",
  note: "kapı açık kalmış",
  by: "Ayşe",
  at: tr("2026-10-22T09:12").toISOString(),
  open: true,
  versions: 0,
  kind: "range",
};

test("kontrol 1. personel 09:00: Açılış yapılacak ve sıradaki, Kapanış sonra (saat aralığı rozette); 07:00'de ikisi de sonra", () => {
  const tasks = dayTasks(staff(tr("2026-10-22T09:00"), { checklists: lists(ACILIS, KAPANIS) }));
  assert.deepEqual(keys(tasks), ["liste-1", "liste-2", "zayi", "kasa"]);
  const t = byKey(tasks);
  assert.equal(t["liste-1"].status, "todo");
  assert.equal(t["liste-1"].badge, undefined);
  assert.equal(t["liste-1"].title, "Açılış listesi");
  assert.equal(t["liste-1"].detail, "11 madde, 2 fotoğraflı · son saat 11:00.");
  assert.equal(t["liste-1"].href, "/panel/kontrol/1");
  assert.equal(t["liste-1"].action, "Listeyi aç");
  assert.equal(splitTasks(tasks).next?.key, "liste-1");
  assert.equal(t["liste-2"].status, "later");
  assert.equal(t["liste-2"].badge, "22:00–02:00");
  assert.equal(t["liste-2"].detail, "15 madde, 3 fotoğraflı · 22:00 – 02:00 arası.");
  const early = dayTasks(staff(tr("2026-10-22T07:00"), { checklists: lists(ACILIS, KAPANIS) }));
  assert.deepEqual(
    early.filter((x) => x.key.startsWith("liste")).map((x) => [x.key, x.status, x.badge]),
    [
      ["liste-1", "later", "08:00–11:00"],
      ["liste-2", "later", "22:00–02:00"],
    ],
  );
});

test("kontrol 2. son saat geçti: gecikti (personele 'Gün 05:00'te kapanır'); başlamış listede ilerleme; yarım liste ilerleme ve kalan fotoğrafla", () => {
  const late = byKey(dayTasks(staff(tr("2026-10-22T12:00"), { checklists: lists(ACILIS) })))["liste-1"];
  assert.equal(late.status, "warn");
  assert.equal(late.badge, "Gecikti");
  assert.equal(late.detail, "Henüz başlanmadı · son saat 11:00 idi. Gün 05:00'te kapanır.");
  assert.equal(late.action, "Listeyi aç");
  const adminLate = byKey(dayTasks(admin(tr("2026-10-22T12:00"), { checklists: lists(checklist(1, "Açılış", "08:00", "11:00", { done: 3, required: 12 })) })))["liste-1"];
  assert.equal(adminLate.detail, "3 / 12 madde · son saat 11:00 idi.");
  assert.equal(adminLate.action, "Devam et");
  const half = byKey(dayTasks(staff(tr("2026-10-22T09:00"), { checklists: lists(checklist(1, "Açılış", "08:00", "11:00", { done: 3, required: 12, photosLeft: 1, contributors: ["Ayşe", "Mehmet"] })) })))["liste-1"];
  assert.equal(half.status, "todo");
  assert.equal(half.badge, "3 / 12");
  assert.equal(half.detail, "3 / 12 madde · Ayşe ve Mehmet · son saat 11:00. 1 fotoğraf kaldı.");
  assert.equal(half.action, "Devam et");
  // Aralıktan önce başlanan liste de yapılacak (Kapanış sabah doldurulursa)
  const early = byKey(dayTasks(staff(tr("2026-10-22T10:00"), { checklists: lists(checklist(2, "Kapanış", "22:00", "02:00", { done: 2, required: 15 })) })))["liste-2"];
  assert.equal(early.status, "todo");
});

test("kontrol 3. tamam: kim ve saat, geç ve fotoğraf sayısı; açık sorun yöneticide 'sorun var', personelde tamam ve 'sorun bildirildi'", () => {
  const done = { complete: true, done: 11, photos: 2, completedAt: tr("2026-10-22T09:42").toISOString(), contributors: ["Ayşe", "Mehmet"] };
  const ok = byKey(dayTasks(admin(tr("2026-10-22T12:00"), { checklists: lists(checklist(1, "Açılış", "08:00", "11:00", done)) })))["liste-1"];
  assert.equal(ok.status, "done");
  assert.equal(ok.badge, "Tamam");
  assert.equal(ok.detail, "Ayşe ve Mehmet · 09:42 · 2 fotoğraf");
  assert.equal(ok.action, "Listeye bak");
  const late = byKey(dayTasks(admin(tr("2026-10-22T12:00"), { checklists: lists(checklist(1, "Açılış", "08:00", "11:00", { ...done, photos: 0, completedAt: tr("2026-10-22T11:20").toISOString() })) })))["liste-1"];
  assert.equal(late.detail, "Ayşe ve Mehmet · 11:20 · geç");
  const problem = lists(checklist(1, "Açılış", "08:00", "11:00", { ...done, issues: [RANGE, { ...RANGE, answerId: 43, open: false, text: "Bar buzdolabı sıcaklığı: 6 °C → 3,5 °C" }] }));
  const a = byKey(dayTasks(admin(tr("2026-10-22T12:00"), { checklists: problem })))["liste-1"];
  assert.equal(a.status, "warn");
  assert.equal(a.badge, "1 sorun");
  assert.equal(a.detail, "Ayşe ve Mehmet · 09:42 · Bar buzdolabı sıcaklığı: 6 °C (0–4 °C)");
  const s = byKey(dayTasks(staff(tr("2026-10-22T12:00"), { checklists: problem })))["liste-1"];
  assert.equal(s.status, "done");
  assert.equal(s.badge, "Tamam");
  assert.equal(s.detail, "Ayşe ve Mehmet · 09:42 · 1 sorun bildirildi");
  // Sorun metni uzunsa 140 karakterde kısalır
  const long = lists(checklist(1, "Açılış", "08:00", "11:00", { ...done, issues: Array.from({ length: 6 }, (_, i) => ({ ...RANGE, answerId: i })) }));
  assert.ok(byKey(dayTasks(admin(tr("2026-10-22T12:00"), { checklists: long })))["liste-1"].detail.length <= 140);
});

test("kontrol 4. dünkü listeler yalnız yöneticide, yalnız eksik ya da sorun varken; dünün kasa raporu da yoksa kafe kapalı olabilir", () => {
  const yesterday = { day: "2026-10-21", lists: [checklist(1, "Açılış", "08:00", "11:00", { complete: true, done: 11 }), checklist(2, "Kapanış", "22:00", "02:00", { done: 13, required: 16 })] };
  const row = byKey(dayTasks(admin(NOON, { checklistsYesterday: yesterday, cash: { today: null, yesterday: report("2026-10-21"), firstDate: "2026-10-01" } })))["liste-dun"];
  assert.equal(row.status, "warn");
  assert.equal(row.title, "Dünkü kontrol listeleri");
  assert.equal(row.badge, "1 eksik");
  assert.equal(row.detail, "Kapanış: 3 madde yapılmadı");
  assert.equal(row.href, "/panel/kontrol/gecmis?gun=2026-10-21");
  assert.equal(row.action, "Geçmişe bak");
  // Hiç açılmadı + düzeltilmiş ölçüm; dünün kasası da yok (kasa kullanılıyor): not eklenir
  const fixed = { ...RANGE, open: false, text: "Bar buzdolabı sıcaklığı: 6 °C → 3,5 °C" };
  const closed = byKey(
    dayTasks(
      admin(NOON, {
        checklistsYesterday: { day: "2026-10-21", lists: [checklist(1, "Açılış", "08:00", "11:00", { complete: true, done: 11, issues: [fixed] }), checklist(2, "Kapanış", "22:00", "02:00")] },
        cash: { today: null, yesterday: null, firstDate: "2026-10-01" },
      }),
    ),
  )["liste-dun"];
  assert.equal(closed.detail, "Kapanış: hiç açılmadı · Bar buzdolabı sıcaklığı: 6 °C → 3,5 °C · Kasa raporu da yok; kafe kapalıysa önemsemeyin.");
  // Yalnız sorun: rozet sorun sayısı
  const onlyProblem = byKey(dayTasks(admin(NOON, { checklistsYesterday: { day: "2026-10-21", lists: [checklist(1, "Açılış", "08:00", "11:00", { complete: true, done: 11, issues: [RANGE] })] } })))["liste-dun"];
  assert.equal(onlyProblem.badge, "1 sorun");
  // Hepsi tamam ve sorunsuz: satır yok; kasa hiç kullanılmadıysa not yok
  assert.ok(!keys(dayTasks(admin(NOON, { checklistsYesterday: { day: "2026-10-21", lists: [checklist(1, "Açılış", "08:00", "11:00", { complete: true, done: 11 })] } }))).includes("liste-dun"));
  assert.doesNotMatch(byKey(dayTasks(admin(NOON, { checklistsYesterday: yesterday })))["liste-dun"].detail, /Kasa raporu/);
  // Personelde hiç yok
  assert.ok(!keys(dayTasks(staff(NOON, { checklistsYesterday: yesterday }))).includes("liste-dun"));
});

test("kontrol 5. okunamadı: tek gri satır; olgu yoksa (eski olgular) satır yok", () => {
  const t = byKey(dayTasks(staff(NOON, { checklists: null })))["liste"];
  assert.equal(t.status, "later");
  assert.equal(t.badge, "Okunamadı");
  assert.equal(t.detail, "Kontrol listeleri şu an okunamadı.");
  assert.equal(t.href, "/panel/kontrol");
  assert.ok(!keys(dayTasks(staff(NOON))).some((k) => k.startsWith("liste")));
});

test("kontrol 6. sıra: personelde 23:00'te Kapanış zayi ve kasadan önce, sıradaki; yöneticide dünkü listeler kasa-dun'dan sonra, günün listeleri sayımdan sonra", () => {
  const morningDone = checklist(1, "Açılış", "08:00", "11:00", { complete: true, done: 11 });
  const tasks = dayTasks(staff(tr("2026-10-22T23:00"), { checklists: lists(KAPANIS, morningDone), waste: { count: 0, zayi: null, ikram: null } }));
  assert.deepEqual(keys(tasks), ["liste-1", "liste-2", "zayi", "kasa"]);
  assert.equal(splitTasks(tasks).next?.key, "liste-2");
  const adminTasks = dayTasks(
    admin(tr("2026-11-03T21:00"), {
      cash: { today: null, yesterday: null, firstDate: "2026-10-01" },
      stock: { month: "2026-11", counted: 0, total: 40, prevMonth: "2026-10", prevHasData: false, prevCounted: 0, prevTotal: 40 },
      checklists: { day: "2026-11-03", lists: [KAPANIS, ACILIS] },
      checklistsYesterday: { day: "2026-11-02", lists: [checklist(2, "Kapanış", "22:00", "02:00")] },
    }),
  );
  assert.deepEqual(keys(adminTasks), ["kasa-dun", "liste-dun", "odeme", "fatura", "sayim-gecen", "liste-1", "liste-2", "kasa"]);
});

test("kontrol 7. kendiliğinden yenileme: listenin açılış ve son saatinde (10:00'da sıradaki an 11:00)", () => {
  const at10 = tr("2026-10-22T10:00");
  assert.equal(nextRefreshAt(at10, checklistBoundaries(lists(ACILIS, KAPANIS))), tr("2026-10-22T11:00").getTime());
  assert.equal(nextRefreshAt(tr("2026-10-22T07:30"), checklistBoundaries(lists(ACILIS))), tr("2026-10-22T08:00").getTime());
  // Kapanışın 02:00'si gece yarısından sonra: 00:30'da sıradaki an 02:00
  assert.equal(nextRefreshAt(tr("2026-10-23T00:30"), checklistBoundaries(lists(KAPANIS))), tr("2026-10-23T02:00").getTime());
});

// ---------------------------------------------------------------- Bölümler ve başlık

test("10. bölümler ve başlık: sorun sayısı, hatırlatıcı eki, hepsi tamam", () => {
  const t = (key: DayTask["key"], status: DayTask["status"]): DayTask => ({ key, status, title: key, detail: "", href: "/", action: "" });
  const tasks = [t("kasa-dun", "todo"), t("odeme", "warn"), t("fatura", "done"), t("zayi", "later"), t("kasa", "todo")];
  const s = splitTasks(tasks);
  assert.deepEqual(keys(s.now), ["kasa-dun", "odeme", "kasa"]);
  assert.deepEqual(keys(s.later), ["zayi"]);
  assert.deepEqual(keys(s.done), ["fatura"]);
  // Sıradaki: ilk sorunlu, yoksa ilk yapılacak (sıra değişmez)
  assert.equal(s.next?.key, "odeme");
  assert.equal(splitTasks([t("kasa-dun", "todo"), t("kasa", "todo")]).next?.key, "kasa-dun");
  const sum = daySummary(tasks, 2);
  assert.equal(sum.open, 3);
  assert.equal(sum.warn, 1);
  assert.equal(sum.done, 1);
  assert.equal(sum.total, 5);
  assert.equal(sum.headline, "3 iş bekliyor (1 sorun) · 2 hatırlatıcı");
  assert.equal(daySummary([t("kasa", "todo")], 0).headline, "1 iş bekliyor");
  assert.equal(daySummary([t("kasa", "done"), t("zayi", "done")], 0).headline, "Bugünün işleri tamam");
  assert.equal(daySummary([t("kasa", "done")], 1).headline, "Bugünün işleri tamam · 1 hatırlatıcı");
});

// ---------------------------------------------------------------- Bugün kafede

function session(id: number, local: string, hours: number, o: Partial<KaraokeSessionDTO> = {}): KaraokeSessionDTO {
  const start = tr(local).getTime();
  return {
    id,
    source: "site",
    externalId: `r-${id}`,
    date: local.slice(0, 10),
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + hours * 3_600_000).toISOString(),
    extraMinutes: 0,
    endedAt: null,
    endedBy: null,
    guests: 4,
    customerName: "Ayşe",
    note: null,
    status: "confirmed",
    paymentStatus: "paid",
    totalMinor: 150_000,
    lastEvent: null,
    lastEventAt: null,
    createdBy: null,
    ...o,
  };
}

test("11. karaoke: iş günü aralığı, tutma ve iptal sayılmaz, süren oturum, sıradaki, rezervasyonsuz ayrı", () => {
  const { from, to } = businessDayRange("2026-10-22");
  assert.equal(from.toISOString(), "2026-10-22T02:00:00.000Z");
  assert.equal(to.toISOString(), "2026-10-23T02:00:00.000Z");
  const now = tr("2026-10-22T20:30").getTime();
  const sessions = [
    session(1, "2026-10-22T04:30", 1), // dünkü iş günü
    session(2, "2026-10-22T05:30", 1, { customerName: "Erken" }), // bugünkü, bitti
    session(3, "2026-10-22T20:00", 2, { extraMinutes: 15 }), // süren: bitiş 22:15
    session(4, "2026-10-22T22:30", 1, { guests: 6, customerName: "Mert" }), // sıradaki
    session(5, "2026-10-22T23:30", 1, { status: "requested", paymentStatus: "pending" }), // ödenmemiş tutma
    session(6, "2026-10-22T18:00", 1, { status: "cancelled" }), // iptal
    session(7, "2026-10-22T16:00", 1, { source: "panel", externalId: null, customerName: null, endedAt: tr("2026-10-22T17:05").toISOString() }), // rezervasyonsuz, bitti
    session(8, "2026-10-23T06:00", 1), // yarının iş günü
  ];
  const k = karaokeToday(sessions, "2026-10-22", now);
  assert.equal(k.reservations, 3);
  assert.equal(k.walkIns, 1);
  assert.deepEqual(k.active, { until: "22:15", overtime: false });
  assert.deepEqual(k.next, { time: "22:30", guests: 6, name: "Mert" });
  // Sıradaki değişiklik: süren oturumun bitişi
  assert.equal(k.changeAt, tr("2026-10-22T22:15").getTime());
  // Süresi doldu
  const late = karaokeToday(sessions, "2026-10-22", tr("2026-10-22T22:20").getTime());
  assert.deepEqual(late.active, { until: "22:15", overtime: true });
  // Bitirilmemiş, süresi dolmuş oturum süren oturumdan önce söylenir (bar ekranında alarmı çalıyor)
  const forgotten = karaokeToday([...sessions, session(10, "2026-10-22T18:30", 1)], "2026-10-22", now);
  assert.deepEqual(forgotten.active, { until: "19:30", overtime: true });
  // 01:30'da iş günü hâlâ 22 Ekim: gece yarısından sonra başlayan oturum da o güne sayılır
  const night = karaokeToday([session(9, "2026-10-23T01:00", 1)], "2026-10-22", tr("2026-10-23T01:30").getTime());
  assert.equal(night.reservations, 1);
});

test("11b. kafe satırları: oda, günün sayısı, sıradaki, siparişler; eski sipariş listesi ve bağlantısız kurulum; tutar yok", () => {
  const now = tr("2026-10-22T20:30").getTime();
  const k = karaokeToday([session(3, "2026-10-22T20:00", 2, { extraMinutes: 15 }), session(4, "2026-10-22T22:30", 1, { guests: 6, customerName: "Mert" })], "2026-10-22", now);
  const fresh = { at: new Date(now - 5 * 60_000).toISOString(), open: 2, ready: 1 };
  const lines = cafeLines({ karaoke: k, orders: fresh, configured: true }, now);
  assert.deepEqual(
    lines.map((l) => l.text),
    ["Oda dolu · bitiş 22:15", "Bugün 2 rezervasyon", "Sıradaki 22:30 · 6 kişi · Mert", "2 açık uygulama siparişi · 1 teslime hazır"],
  );
  for (const l of lines) assert.doesNotMatch(l.text, /₺/);
  // 30 dakikadan eski liste: sipariş satırı yok
  const stale = cafeLines({ karaoke: k, orders: { ...fresh, at: new Date(now - 31 * 60_000).toISOString() }, configured: true }, now);
  assert.ok(!stale.some((l) => l.key === "siparis"));
  // Yalnız teslime hazır
  assert.equal(cafeLines({ karaoke: null, orders: { ...fresh, open: 0 }, configured: true }, now)[0].text, "1 uygulama siparişi teslime hazır");
  // Süresi doldu: uyarı tonu
  const over = cafeLines({ karaoke: { ...k, active: { until: "22:15", overtime: true } }, orders: null, configured: true }, now);
  assert.deepEqual(over[0], { key: "oda", text: "Süre doldu: odaya haber verin", tone: "warn" });
  // Bağlantı kurulu, bugün oturum yok
  const empty = karaokeToday([], "2026-10-22", now);
  assert.deepEqual(
    cafeLines({ karaoke: empty, orders: null, configured: true }, now).map((l) => l.text),
    ["Bugün karaoke rezervasyonu yok"],
  );
  // Bağlantı yok ve oturum yok: kart çizilmez
  assert.deepEqual(cafeLines({ karaoke: empty, orders: null, configured: false }, now), []);
  // Bağlantı yok ama bar ekranından açılmış oturum var
  const walkIn = karaokeToday([session(7, "2026-10-22T16:00", 1, { source: "panel", endedAt: tr("2026-10-22T17:00").toISOString() })], "2026-10-22", now);
  assert.deepEqual(
    cafeLines({ karaoke: walkIn, orders: null, configured: false }, now).map((l) => l.text),
    ["Bugün rezervasyon yok · 1 rezervasyonsuz"],
  );
});

test("11c. kafe satırları: personelde satış tahmininin yoğunluğu ve tatlı sayısı başta; tutar yok", () => {
  const now = tr("2026-10-29T10:00").getTime();
  const busy = { level: "yuksek" as const, reasons: ["Cumhuriyet Bayramı"], desserts: { today: 8, top: ["San Sebastian", "Marlenka"] }, closed: false };
  const lines = cafeLines({ karaoke: karaokeToday([], "2026-10-29", now), orders: null, configured: true }, now, busy);
  assert.deepEqual(
    lines.map((l) => [l.key, l.text, l.tone]),
    [
      ["yogunluk", "Bugün yoğunluk: Yüksek · Cumhuriyet Bayramı", "warn"],
      ["tatli", "Tatlı: bugün ≈ 8 satılır (en çok San Sebastian, Marlenka)", "info"],
      ["karaoke", "Bugün karaoke rezervasyonu yok", "info"],
    ],
  );
  for (const l of lines) assert.doesNotMatch(l.text, /₺|%/);
  // Karaoke bağlı değilken de kart tahmin satırlarıyla çizilir; kapalı gün tek satır
  assert.deepEqual(
    cafeLines({ karaoke: null, orders: null, configured: false }, now, { level: "normal", reasons: [], desserts: null, closed: false }).map((l) => l.text),
    ["Bugün yoğunluk: Normal"],
  );
  assert.deepEqual(
    cafeLines({ karaoke: null, orders: null, configured: false }, now, { level: "kapali", reasons: [], desserts: null, closed: true }).map((l) => l.text),
    ["Bugün kafe kapalı olarak işaretli."],
  );
  assert.deepEqual(cafeLines({ karaoke: null, orders: null, configured: false }, now, null), []);
});

// ---------------------------------------------------------------- Saatler

test("12. kendiliğinden yenileme: 14:00 → 20:00, 20:30 → 00:00, 00:30 → 05:00 (Türkiye); daha yakın ek an önce", () => {
  assert.equal(nextRefreshAt(tr("2026-10-22T14:00")), tr("2026-10-22T20:00").getTime());
  assert.equal(nextRefreshAt(tr("2026-10-22T20:30")), tr("2026-10-23T00:00").getTime());
  assert.equal(nextRefreshAt(tr("2026-10-23T00:30")), tr("2026-10-23T05:00").getTime());
  assert.equal(nextRefreshAt(tr("2026-10-22T04:59")), tr("2026-10-22T05:00").getTime());
  // Tam sınırda bir sonraki sınır
  assert.equal(nextRefreshAt(tr("2026-10-22T20:00")), tr("2026-10-23T00:00").getTime());
  const karaokeEnd = tr("2026-10-22T16:15").getTime();
  assert.equal(nextRefreshAt(tr("2026-10-22T14:00"), [karaokeEnd]), karaokeEnd);
  // Geçmiş ya da geçersiz ek an sayılmaz
  assert.equal(nextRefreshAt(tr("2026-10-22T14:00"), [tr("2026-10-22T13:00").getTime(), Number.NaN]), tr("2026-10-22T20:00").getTime());
});

test("13. kasa akşamı ve iş günü: 19:59 değil, 20:00 evet, 04:59 evet, 05:00 değil; businessDate aynı kalır", () => {
  assert.equal(trHour(tr("2026-10-22T19:59")), 19);
  assert.equal(isCashEvening(tr("2026-10-22T19:59")), false);
  assert.equal(isCashEvening(tr("2026-10-22T20:00")), true);
  assert.equal(isCashEvening(tr("2026-10-23T04:59")), true);
  assert.equal(isCashEvening(tr("2026-10-23T05:00")), false);
  assert.equal(businessDate(tr("2026-10-23T04:59")), "2026-10-22");
  assert.equal(businessDate(tr("2026-10-23T05:00")), "2026-10-23");
  assert.equal(businessDate(tr("2026-10-22T00:00")), "2026-10-21");
});

test("14. kısaltma: en çok 140 karakter, kısalınca '…'; zayi özeti de kısalır", () => {
  assert.equal(clip("kısa", 140), "kısa");
  const long = "a".repeat(200);
  assert.equal(clip(long, 140).length, 140);
  assert.ok(clip(long, 140).endsWith("…"));
  assert.equal(clip("x".repeat(140), 140), "x".repeat(140));
  const t = byKey(dayTasks(staff(NOON, { waste: { count: 30, zayi: "Süt 1 LT, ".repeat(30), ikram: null } }))).zayi;
  const summary = t.detail.replace(/^30 kayıt · /, "");
  assert.ok(summary.length <= WASTE_SUMMARY_MAX, String(summary.length));
  assert.ok(summary.endsWith("…"));
  // Kısalmış özetten sonra nokta eklenmez
  const evening = byKey(dayTasks(staff(EVENING, { waste: { count: 30, zayi: "Süt 1 LT, ".repeat(30), ikram: null } }))).zayi;
  assert.match(evening.detail, /… Eksik varsa kasa raporundan önce ekleyin\.$/);
});

// ---------------------------------------------------------------- Kaynak denetimi

/** Kaynakta bir fonksiyonun gövdesi (sonraki üst düzey tanıma kadar) */
function bodyOf(src: string, name: string): string {
  const start = src.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} yok`);
  const rest = src.slice(start + 1);
  const end = rest.search(/\n(export )?(async )?function |\n(export )?(const|interface|type) /);
  return end < 0 ? rest : rest.slice(0, end);
}

test("kaynak: sayfa iki role açık (requireUser); yönetici olguları yalnız adminFacts'te, zayi yalnız staffFacts'te", () => {
  const page = read("src/app/panel/bugun/page.tsx");
  assert.match(page, /await requireUser\(\)/);
  assert.doesNotMatch(page, /requireAdmin/);

  const src = read("src/server/data/today.ts");
  assert.match(src, /^import "server-only";/);
  const admin = bodyOf(src, "adminFacts");
  const staffBody = bodyOf(src, "staffFacts");
  const outside = src.replace(admin, "");
  const ADMIN_ONLY = [
    "loadUpcoming(",
    "loadModel(",
    "loadPriceAlerts(",
    "countUnlinkedProducts(",
    "countPendingRequests(",
    "loadReviewQueue(",
    "pendingHoldSummary(",
    "posPendingSummary(",
    "loadUnpricedIngredients(",
    "loadJobsOverview(",
    "lastParasutSyncOkAt(",
    "previousCarryOver(",
    "cashRevisionsFor(",
    "loadOverduePayouts(",
    "loadForecastCard(",
    "needsReview",
  ];
  for (const name of ADMIN_ONLY) {
    assert.ok(admin.includes(name), `${name} adminFacts'te değil`);
    assert.ok(!outside.replace(/^import .*$/gm, "").includes(name), `${name} adminFacts dışında`);
  }
  assert.ok(staffBody.includes("dayWaste("));
  // Satış tahmini: personel yalnız tutarsız görünümü yükler
  assert.ok(staffBody.includes("loadStaffForecast("));
  assert.ok(!src.replace(staffBody, "").replace(/^import .*$/gm, "").includes("loadStaffForecast("), "loadStaffForecast staffFacts dışında");
  assert.ok(!src.replace(staffBody, "").replace(/^import .*$/gm, "").includes("dayWaste("), "dayWaste staffFacts dışında");
  // Rol seçimi: personel yalnız staffFacts'i çağırır
  assert.match(src, /admin \? adminFacts\(now, user\.id, cashP\) : staffFacts\(c\)/);
  // Zam metni Genel bakış ve zil ile aynı (ayda TL etkisiyle)
  assert.match(admin, /priceAlert\(pa\.changes, pa\.actionable, pa\.loss\.totalLoss\)/);
  // Bugün parasut_sync_runs'ı kendisi sormaz (R4: günlük işlerin sağlığı ops'un modülünden)
  assert.doesNotMatch(src, /parasutSyncRuns/);
  // Paraşüt işinin hatası, sonraki başarılı eşitlemeyle düşer (systemIssues); kasanın bütünlüğü saf cashFlags'ten, zincir
  // listenin sırasına güvenmeden en eski günden
  assert.match(admin, /systemIssues\(o, now, okAt\)/);
  assert.match(admin, /const oldest = reports\.map\(\(r\) => r\.date\)\.sort\(\)\[0\];/);
  assert.match(admin, /previousCarryOver\(oldest\)/);
  assert.match(admin, /cashFlags\(reports, before, revisions, viewer\)/);
});

test("kaynak: kontrol listeleri iki rolde (personel yalnız kendininkiler), dünkü listeler yalnız yöneticide; ekran liste saatlerinde yenilenir", () => {
  const src = read("src/server/data/today.ts");
  const adminBody = bodyOf(src, "adminFacts");
  const load = bodyOf(src, "loadToday");
  assert.match(load, /safe\(loadChecklistDay\(c\.day, user\.role, now\)\)/);
  assert.match(load, /checklists: checklists \? \{ day: c\.day, lists: checklists \} : null,/);
  assert.match(adminBody, /safe\(loadChecklistDay\(yesterday, "admin", now\)\)/);
  assert.doesNotMatch(bodyOf(src, "staffFacts"), /loadChecklistDay/);
  assert.match(read("src/app/panel/bugun/page.tsx"), /checklistBoundaries\(data\.facts\.checklists\)/);
});

test("kaynak: her yükleyici safe() ile; bir kaynak düşerse sayfa açılır", () => {
  const src = read("src/server/data/today.ts");
  for (const call of [
    "cashReportsBetween(",
    "firstCashReportDate(",
    "stockProgress(",
    "loadDueReminders(",
    "loadSessions(",
    "dayWaste(",
    "loadUpcoming(",
    "countUnlinkedProducts(",
    "loadUnpricedIngredients(",
    "loadChecklistDay(",
    "loadOverduePayouts(",
    "loadForecastCard(",
    "loadStaffForecast(",
  ]) {
    assert.ok(src.includes(`safe(${call}`), `${call} safe() ile değil`);
  }
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const call of [
    "pendingHoldSummary(",
    "posPendingSummary(",
    "Promise.all([loadJobsOverview(now), lastParasutSyncOkAt()])",
    "cash.then(",
    "Promise.all([readOrdersSnapshot(), readOrdersState()])",
  ]) {
    assert.match(src, new RegExp(`safe\\(\\s*${escape(call)}`), call);
  }
});

test("kaynak: uygulama siparişlerinin tazeliği son başarılı çekmeden (kopya yalnız liste değişince yazılır)", () => {
  const src = read("src/server/data/today.ts");
  assert.match(src, /at: state\.lastOkAt \?\? snapshot\.at/);
  // Yalnız sayılar: ad ve tutar ekrana taşınmaz
  const lite = src.slice(src.indexOf("function ordersLite("), src.indexOf("const toLite"));
  assert.doesNotMatch(lite, /firstName|customer|total|amount/i);
});

test("kaynak: zil Bugün ile aynı akşam kuralına bakar; Bugün canlı veride ve çıkınca yenilenir", () => {
  // Kasa satırları kasa modülünde (src/server/bell/kasa.ts), toplayıcı iki rolde çağırır
  const bell = read("src/server/bell/kasa.ts");
  assert.match(read("src/server/actions/notifications.ts"), /kasaBell\(user\)\.catch\(\(\) => \[\]\)/);
  assert.match(bell, /if \(!isCashEvening\(now\) \|\| reports\.some\(\(r\) => r\.date === day\)\) return \[\];/);
  assert.doesNotMatch(bell, /hour < 20/);
  assert.match(read("src/components/panel/live/alert-center.tsx"), /p\.startsWith\("\/panel\/bugun"\)\) router\.refresh\(\)/);
  assert.match(read("src/components/panel/sidebar.tsx"), /prev\.startsWith\("\/panel\/bugun"\)/);
  // Ekran kendisi de yenilenir: saat sınırında, sekme uzun gizli kalınca ve geri tuşuyla dönülünce (Activity korunan
  // eski çizimi gösterir)
  const refresh = read("src/app/panel/bugun/today-refresh.tsx");
  for (const re of [/at - liveNow\(\)/, /visibilitychange/, /shownAgain/]) assert.match(refresh, re);
});
