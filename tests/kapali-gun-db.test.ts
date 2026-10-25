// Kapalı gün ve personelin özel günleri, gerçek Postgres'te (plan docs/planlar/personel-yetki.md §2.9;
// docs/KASA-RAPORU.md › Kafe kapalıydı): her kanıt türü (silme kaydı ve karaoke `starts_at` dahil) bildirimi reddeder,
// hesap işlemi reddetmez; dün dışı gün ve çift bildirim reddedilir; onay kapalı satırını yöneticinin adıyla yazar; kanıt
// sonradan gelirse onay reddedilir; rapor gelince ve Z no boşluğunda işaret kalkar (istek "geri alındı"); personel
// kapalı güne kasadan çıkan yazamaz; yöneticinin doğrudan işareti bekleyen bildirimi onaylar; bildirim günde bir kez
// geri çekilir; personelin özel günü: yönetici düzenleyince kilitlenir, 3 gün ve 14 gün sınırları, kapalı satırı
// silinemez.
//
// Kendi kullanıcılarını, raporlarını, özel günlerini ve isteklerini açar, sonunda siler. Günler 2027'de: öteki
// veritabanı testlerinin günleriyle (2028 ve sonrası) karışmaz; kanıt testlerinde önceki raporu kendisi yazar (Z no boş).
//
// KAPALI_TEST_DATABASE_URL verilmezse atlanır (migration'ları uygulanmış bir yerel veritabanı).
// Çalıştırma: KAPALI_TEST_DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_yetki npx tsx --test tests/kapali-gun-db.test.ts

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { and, eq, gt, inArray, max } from "drizzle-orm";

import type { CashReportFields } from "../src/lib/cash-report";
import { CLOSED_TEXT, STAFF_SPECIAL_TEXT } from "../src/lib/closed-days";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { UserError } from "../src/server/user-error";

const URL = process.env.KAPALI_TEST_DATABASE_URL;
const tr = (local: string) => new Date(`${local}:00+03:00`);
/** D gününün ertesi sabahı (iş günü D+1): "dün" D */
const morningAfter = (d: string) => new Date(Date.parse(`${d}T12:00:00+03:00`) + 86_400_000);

describe("Kapalı gün ve personelin özel günleri: veritabanında", { skip: !URL && "KAPALI_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  let store: typeof import("../src/server/cash/report-store");
  let closed: typeof import("../src/server/closed-days");
  let reqs: typeof import("../src/server/closed-day-requests");
  let special: typeof import("../src/server/forecast/staff-special");
  let core: typeof import("../src/server/staff-requests/core");
  let guard: typeof import("../src/server/cash-outs/guard");
  const tag = `${process.pid}-${randomBytes(3).toString("hex")}`;
  type Who = { id: number; name: string; role: "admin" | "staff" };
  const users: Record<"ali" | "ayse" | "mehmet" | "zeynep", Who> = {
    ali: { id: 0, name: "Ali", role: "admin" },
    ayse: { id: 0, name: "Ayşe", role: "staff" },
    mehmet: { id: 0, name: "Mehmet", role: "staff" },
    zeynep: { id: 0, name: "Zeynep", role: "staff" },
  };
  const dates: string[] = [];
  let logFloor = 0;

  const fields = (date: string, o: Partial<CashReportFields> = {}): CashReportFields & { discounts: number | null } => ({
    date,
    zNo: null,
    receipts: null,
    zTotal: 10_000,
    cash: 3_000,
    card: 7_000,
    mealCard: 0,
    online: 0,
    other: 0,
    openingCash: 500,
    cashOut: 0,
    cashOutNote: null,
    countedCash: 3_500,
    handedOver: 2_400,
    bankPos: null,
    offRevenue: null,
    note: "deneme",
    ...o,
    discounts: o.discounts ?? null,
  });
  async function report(date: string, o: Partial<CashReportFields> = {}) {
    if (!dates.includes(date)) dates.push(date);
    const r = await store.saveCashReport(db, users.ali, { ...fields(date, o), countedBy: null, revision: 0, photos: [] }, tr(`${date}T22:00`));
    assert.equal(r.kind, "saved");
  }
  const refused = async (p: Promise<unknown>, text: string | RegExp) => {
    await assert.rejects(p, (e: unknown) => e instanceof UserError && (typeof text === "string" ? e.message === text : text.test(e.message)));
  };
  const ask = (who: Who, date: string, now = morningAfter(date)) => reqs.proposeClosedDay(db, who, { date, reason: "Tadilat", clientKey: null }, now);
  const review = (id: number, version: number, decision: "approve" | "reject", now: Date) => reqs.reviewClosedDayCore(db, users.ali, { id, seenVersion: version, decision, note: null }, now);
  const requestOf = async (id: number) => (await db.select().from(s.staffRequests).where(eq(s.staffRequests.id, id)))[0];
  const closedRows = (date: string) => db.select().from(s.specialDays).where(and(eq(s.specialDays.kind, "kapali"), eq(s.specialDays.dateFrom, date)));

  before(async () => {
    process.env.DATABASE_URL = URL;
    const require = createRequire(import.meta.url);
    const marker = require.resolve("server-only");
    require.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as unknown as NodeJS.Module;
    const dbModule = await import("../src/server/db");
    db = dbModule.createDb(URL!, 4);
    store = await import("../src/server/cash/report-store");
    closed = await import("../src/server/closed-days");
    reqs = await import("../src/server/closed-day-requests");
    special = await import("../src/server/forecast/staff-special");
    core = await import("../src/server/staff-requests/core");
    guard = await import("../src/server/cash-outs/guard");
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db
        .insert(s.users)
        .values({ email: `kapali-${k}-${tag}@ornek.com`, name: users[k].name, passwordHash: "x", role: users[k].role })
        .returning({ id: s.users.id });
      users[k].id = u.id;
    }
    const [top] = await db.select({ id: max(s.activityLog.id) }).from(s.activityLog);
    logFloor = top?.id ?? 0;
  });

  after(async () => {
    if (!db) return;
    const ids = Object.values(users).map((u) => u.id);
    await db.delete(s.staffRequests).where(inArray(s.staffRequests.requestedBy, ids));
    await db.delete(s.specialDays).where(inArray(s.specialDays.createdBy, ids));
    await db.delete(s.activityLog).where(and(gt(s.activityLog.id, logFloor), inArray(s.activityLog.action, [...closed.CLOSED_BELL_ACTIONS])));
    await db.delete(s.activityLog).where(inArray(s.activityLog.userId, ids));
    if (dates.length) {
      await db.delete(s.cashOuts).where(inArray(s.cashOuts.date, dates));
      await db.delete(s.wasteEntries).where(inArray(s.wasteEntries.date, dates));
      await db.delete(s.karaokeSessions).where(inArray(s.karaokeSessions.date, dates));
      await db.delete(s.checklistRuns).where(inArray(s.checklistRuns.date, dates));
      await db.delete(s.cashReports).where(inArray(s.cashReports.date, dates));
    }
    await db.delete(s.users).where(inArray(s.users.id, ids));
    await db.$client.end();
    const { getDb } = await import("../src/server/db");
    await getDb().$client.end();
  });

  test("her kanıt türü bildirimi reddeder (silme kaydı ve karaoke dahil); hesap işlemi reddetmez; dün dışı gün kapalı", async () => {
    const D = "2027-02-10";
    dates.push(D);
    await report("2027-02-09");
    const now = morningAfter(D);
    const w = closed.dayWindow(D);
    // Dün dışı gün
    await refused(ask(users.ayse, "2027-02-08", now), CLOSED_TEXT.onlyYesterday);
    await refused(ask(users.ayse, D, new Date(now.getTime() + 86_400_000)), CLOSED_TEXT.onlyYesterday);
    // Hesap işlemi kanıt değil
    const [acct] = await db.insert(s.activityLog).values({ at: new Date(w.from.getTime() + 3_600_000), userName: "Ayşe", userId: users.ayse.id, action: "Parola değiştirildi" }).returning({ id: s.activityLog.id });
    const kinds: { name: string; add: () => Promise<() => Promise<unknown>> }[] = [
      {
        name: "kasadan çıkan",
        add: async () => {
          const [r] = await db.insert(s.cashOuts).values({ date: D, kind: "harcama", amount: 50, createdByName: "Ali" }).returning({ id: s.cashOuts.id });
          return () => db.delete(s.cashOuts).where(eq(s.cashOuts.id, r.id));
        },
      },
      {
        name: "zayi",
        add: async () => {
          const [r] = await db.insert(s.wasteEntries).values({ date: D, kind: "zayi", name: "Tiramisu", qty: 1, unit: "adet", createdByName: "Ali" }).returning({ id: s.wasteEntries.id });
          return () => db.delete(s.wasteEntries).where(eq(s.wasteEntries.id, r.id));
        },
      },
      {
        name: "karaoke (gece 01:00, iş günü D)",
        add: async () => {
          const starts = new Date(w.to.getTime() - 4 * 3_600_000);
          const [r] = await db
            .insert(s.karaokeSessions)
            .values({ source: "panel", date: addDay(D), startsAt: starts, endsAt: new Date(starts.getTime() + 3_600_000), status: "confirmed" })
            .returning({ id: s.karaokeSessions.id });
          return () => db.delete(s.karaokeSessions).where(eq(s.karaokeSessions.id, r.id));
        },
      },
      {
        name: "personelin silme kaydı",
        add: async () => {
          const [r] = await db.insert(s.activityLog).values({ at: new Date(w.from.getTime() + 7_200_000), userName: "Mehmet", userId: users.mehmet.id, action: "Kasadan çıkan silindi", detail: "x" }).returning({ id: s.activityLog.id });
          return () => db.delete(s.activityLog).where(eq(s.activityLog.id, r.id));
        },
      },
      {
        name: "kasa raporu",
        add: async () => {
          await db.insert(s.cashReports).values({ ...fields(D), discounts: null, cashDiff: 0, submittedBy: users.ali.id, submittedByName: "Ali" });
          return () => db.delete(s.cashReports).where(eq(s.cashReports.date, D));
        },
      },
    ];
    const [tpl] = await db.select({ id: s.checklistTemplates.id }).from(s.checklistTemplates).limit(1);
    if (tpl) {
      kinds.push({
        name: "kontrol listesi",
        add: async () => {
          const [r] = await db.insert(s.checklistRuns).values({ templateId: tpl.id, date: D, seq: 99, name: "Açılış", items: [] }).returning({ id: s.checklistRuns.id });
          return () => db.delete(s.checklistRuns).where(eq(s.checklistRuns.id, r.id));
        },
      });
    }
    for (const k of kinds) {
      const undo = await k.add();
      await refused(ask(users.ayse, D, now), CLOSED_TEXT.evidence);
      await undo();
    }
    // Pencerenin dışındaki personel yazımı (D 04:00, iş günü D−1) kanıt değil
    const [early] = await db.insert(s.activityLog).values({ at: new Date(w.from.getTime() - 3_600_000), userName: "Mehmet", userId: users.mehmet.id, action: "Zayi kaydı" }).returning({ id: s.activityLog.id });
    const out = await ask(users.ayse, D, now);
    assert.equal(out.created, true);
    assert.equal(out.row.title.replace(/ /g, " "), "10 Şubat kapalı gün");
    await db.delete(s.activityLog).where(inArray(s.activityLog.id, [acct.id, early.id]));
    // Çift bildirim: başkası da aynı günü bildiremez
    await refused(ask(users.mehmet, D, now), CLOSED_TEXT.already);
    // Yönetici bildiremez
    await refused(ask(users.ali, D, now), CLOSED_TEXT.adminOnly);
  });

  test("Z no boşluğu bildirimi reddeder; onay kapalı satırını yöneticinin adıyla yazar; kanıt sonradan gelirse onay reddedilir", async () => {
    // Z boşluğu: önceki 100, sonraki 102, arada yalnız bu gün
    await report("2027-03-01", { zNo: "100" });
    await report("2027-03-03", { zNo: "102", note: "deneme" });
    await refused(ask(users.ayse, "2027-03-02", morningAfter("2027-03-02")), CLOSED_TEXT.evidence);

    const D = "2027-03-10";
    dates.push(D);
    await report("2027-03-09");
    const now = morningAfter(D);
    const out = await ask(users.ayse, D, now);
    const ok = await review(out.row.id, out.row.version, "approve", now);
    assert.equal(ok.status, "approved");
    const [row] = await closedRows(D);
    assert.equal(row.kind, "kapali");
    assert.equal(row.effect, -1);
    assert.equal(row.createdBy, users.ali.id);
    assert.equal(row.createdByName, "Ali");
    assert.equal((await requestOf(out.row.id)).resultId, row.id);
    assert.equal(await closed.isClosedDay(D), true);
    // Personel kapalı güne kasadan çıkan yazamaz (yönetici yazar)
    assert.equal(await closed.closedDayRefusal(D, "staff"), CLOSED_TEXT.refusal);
    assert.equal(await closed.closedDayRefusal(D, "admin"), null);
    await refused(db.transaction((tx) => guard.staffCashOutGate(tx, users.ayse, { op: "ekle", date: D }, now)), CLOSED_TEXT.refusal);

    // Kanıt sonradan geldi: onay reddedilir
    const E = "2027-03-20";
    dates.push(E);
    await report("2027-03-19");
    const out2 = await ask(users.mehmet, E, morningAfter(E));
    await db.insert(s.wasteEntries).values({ date: E, kind: "ikram", name: "Çay", qty: 1, unit: "adet", createdByName: "Ali" });
    await refused(review(out2.row.id, out2.row.version, "approve", morningAfter(E)), CLOSED_TEXT.red);
    // Kendi bildirimini onaylayamaz (yönetici yapılan hesap)
    await refused(reqs.reviewClosedDayCore(db, { ...users.mehmet, role: "admin" }, { id: out2.row.id, seenVersion: out2.row.version, decision: "reject", note: null }, morningAfter(E)), /Kendi isteğinizi/);
    const rej = await review(out2.row.id, out2.row.version, "reject", morningAfter(E));
    assert.equal(rej.status, "rejected");
    // Reddedilen gün yeniden bildirilemez
    await refused(ask(users.ayse, E, morningAfter(E)), CLOSED_TEXT.rejected);
  });

  test("rapor gelince işaret kalkar ve istek geri alınır; Z boşluğu işareti kaldırır; açılış farkı yalnız zil", async () => {
    const D = "2027-04-10";
    dates.push(D);
    await report("2027-04-09");
    const out = await ask(users.ayse, D);
    await review(out.row.id, out.row.version, "approve", morningAfter(D));
    assert.equal((await closedRows(D)).length, 1);
    await report(D);
    assert.equal((await closedRows(D)).length, 0);
    const r = await requestOf(out.row.id);
    assert.equal(r.status, "revoked");
    assert.match(r.reviewNote ?? "", /kasa raporu girildi/);
    const logs = await db.select().from(s.activityLog).where(and(gt(s.activityLog.id, logFloor), eq(s.activityLog.action, "Kapalı gün işareti kaldırıldı (kanıt geldi)")));
    assert.ok(logs.some((l) => (l.detail ?? "").includes("10 Nisan")));

    // Z boşluğu: önceki 200, yönetici günü kapalı işaretledi, ertesi günün raporu 202 → işaret kalkar
    await report("2027-05-01", { zNo: "200" });
    const Z = "2027-05-02";
    dates.push(Z);
    await reqs.markClosedDayCore(db, users.ali, { date: Z, note: "Tadilat" }, morningAfter(Z));
    assert.equal(await closed.isClosedDay(Z), true);
    await report("2027-05-03", { zNo: "202" });
    assert.equal(await closed.isClosedDay(Z), false);

    // Z tutuyor ama açılış devirle tutmuyor: işaret kalır, yalnız zil
    await report("2027-05-10", { zNo: "300" });
    const A = "2027-05-11";
    dates.push(A);
    await reqs.markClosedDayCore(db, users.ali, { date: A, note: null }, morningAfter(A));
    await report("2027-05-12", { zNo: "301", openingCash: 100, note: "açılış eksik" });
    assert.equal(await closed.isClosedDay(A), true);
    const warn = await db.select().from(s.activityLog).where(and(gt(s.activityLog.id, logFloor), eq(s.activityLog.action, "Kapalı gün: açılış devirle tutmuyor")));
    assert.ok(warn.some((l) => (l.detail ?? "").includes("11 Mayıs")));
  });

  test("yöneticinin doğrudan işareti bekleyen bildirimi onaylar; raporlu gün işaretlenemez; bildirim günde bir kez geri çekilir", async () => {
    const D = "2027-06-10";
    dates.push(D);
    await report("2027-06-09");
    const now = morningAfter(D);
    const out = await ask(users.zeynep, D, now);
    const mark = await reqs.markClosedDayCore(db, users.ali, { date: D, note: null }, now);
    assert.deepEqual(mark.approved, [out.row.id]);
    assert.equal((await requestOf(out.row.id)).status, "approved");
    await refused(reqs.markClosedDayCore(db, users.ali, { date: "2027-06-09", note: null }, now), CLOSED_TEXT.reportExists);
    await refused(reqs.markClosedDayCore(db, users.ali, { date: "2027-06-12", note: null }, now), CLOSED_TEXT.future);

    const W = "2027-06-20";
    dates.push(W);
    await report("2027-06-19");
    const wNow = morningAfter(W);
    const a = await ask(users.zeynep, W, wNow);
    await core.withdrawOwn(db, users.zeynep, a.row.id, wNow);
    const b = await ask(users.zeynep, W, wNow);
    assert.notEqual(b.row.id, a.row.id);
    await refused(core.withdrawOwn(db, users.zeynep, b.row.id, wNow), CLOSED_TEXT.withdrawOnce);
  });

  test("personelin özel günü: 3 gün, 14 gün, yönetici düzenleyince kilit, kapalı satırı silinemez, sahiplik", async () => {
    const now = tr("2027-08-01T12:00");
    const save = (who: Who, o: Partial<{ id: number; dateFrom: string; dateTo: string; title: string; effect: number; kind: string }>) =>
      special.saveStaffSpecialCore(db, who, { id: null, kind: "derbi", title: "Maç", dateFrom: "2027-08-05", dateTo: "2027-08-05", effect: 0.15, note: "not", ...o }, now);
    await refused(save(users.ayse, { dateFrom: "2027-08-05", dateTo: "2027-08-08" }), STAFF_SPECIAL_TEXT.span);
    // 4 × 3 gün = 12; üç gün daha 15 > 14
    for (let i = 0; i < 4; i++) {
      const from = `2027-08-${String(5 + i * 4).padStart(2, "0")}`;
      const to = `2027-08-${String(7 + i * 4).padStart(2, "0")}`;
      await save(users.ayse, { dateFrom: from, dateTo: to, title: `Maç ${i}` });
    }
    await refused(save(users.ayse, { dateFrom: "2027-08-25", dateTo: "2027-08-27", title: "Fazla" }), STAFF_SPECIAL_TEXT.future);
    const two = await save(users.ayse, { dateFrom: "2027-08-25", dateTo: "2027-08-26", title: "Son" });
    assert.equal(two.created, true);
    const [row] = await db.select().from(s.specialDays).where(eq(s.specialDays.id, two.id));
    assert.equal(row.byStaff, true);
    assert.equal(row.createdBy, users.ayse.id);
    // Çakışma
    await refused(save(users.mehmet, { dateFrom: "2027-08-26", dateTo: "2027-08-26", title: "Başka" }), /Bu günlerde zaten bir özel gün var: Son/);
    // Başkasının satırı ve yöneticinin dokunduğu satır değişmez
    await refused(save(users.mehmet, { id: two.id, dateFrom: "2027-08-25", dateTo: "2027-08-26", title: "Son 2" }), STAFF_SPECIAL_TEXT.locked);
    await db.update(s.specialDays).set({ updatedBy: users.ali.id, updatedByName: "Ali" }).where(eq(s.specialDays.id, two.id));
    await refused(save(users.ayse, { id: two.id, dateFrom: "2027-08-25", dateTo: "2027-08-26", title: "Son 2" }), STAFF_SPECIAL_TEXT.locked);
    await refused(special.deleteStaffSpecialCore(db, users.ayse, two.id, now), STAFF_SPECIAL_TEXT.locked);
    // Kapalı satırı (yöneticinin) personel silemez
    const K = "2027-08-30";
    const mark = await reqs.markClosedDayCore(db, users.ali, { date: K, note: null }, tr("2027-08-30T12:00"));
    await refused(special.deleteStaffSpecialCore(db, users.ayse, mark.id, now), STAFF_SPECIAL_TEXT.locked);
    // Kendi, başlamamış satırını siler
    const [first] = await db.select().from(s.specialDays).where(and(eq(s.specialDays.createdBy, users.ayse.id), eq(s.specialDays.title, "Maç 0")));
    const gone = await special.deleteStaffSpecialCore(db, users.ayse, first.id, now);
    assert.equal(gone.title, "Maç 0");
    // Personelin listesi: başkasının notu gitmez, düzenlenebilirlik doğru
    const list = await special.staffSpecialList(db, users.mehmet, now);
    const mine = list.find((r) => r.title === "Maç 1");
    assert.ok(mine);
    assert.equal(mine.note, null);
    assert.equal(mine.editable, false);
    assert.equal(mine.addedBy, "Ayşe");
    await db.delete(s.specialDays).where(eq(s.specialDays.id, mark.id));
  });
});

function addDay(d: string): string {
  return new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
