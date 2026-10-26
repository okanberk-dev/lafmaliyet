// Kasa istekleri, gerçek Postgres'te (plan docs/planlar/personel-yetki.md §2.3; docs/KASA-RAPORU.md › Sonradan düzeltme
// ve silme isteği): kilitli günde istek bekler ve rapor değişmez; dünün geç kasa alanı değişikliği onaya döner, aynı
// gece doğrudan kaydedilir; iki personelin isteği birbirini engellemez, biri onaylanınca öteki kapanır; bayat sürüm ve
// bayat rapor reddedilir; kimse kendi isteğini onaylayamaz; silme onayında kendi istek onaylanır, ötekiler kapanır;
// yöneticinin doğrudan silmesi bekleyenleri kapatır (reddetmez); eşzamanlı iki onaydan biri kazanır; kasa e-postasına
// personel adresi yazılamaz. Kendi kullanıcılarını, raporlarını ve isteklerini açar, sonunda siler (günler 2031 ve
// sonrası: yerel verinin raporlarıyla çakışmaz).
//
// KASA_ISTEK_TEST_DATABASE_URL verilmezse atlanır (migration'ları uygulanmış bir yerel veritabanı).
// Çalıştırma: KASA_ISTEK_TEST_DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_yetki npx tsx --test tests/kasa-istek-db.test.ts

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { eq, inArray, sql } from "drizzle-orm";

import { historyOf, type CashReportFields } from "../src/lib/cash-report";
import { CASH_REQUEST_TEXT } from "../src/lib/cash-requests";
import { REQUEST_TEXT } from "../src/lib/staff-requests";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { UserError } from "../src/server/user-error";

import { raceOnRequest } from "./helpers/lock-race";

const URL = process.env.KASA_ISTEK_TEST_DATABASE_URL;
/** Türkiye saatiyle an */
const tr = (local: string) => new Date(`${local}:00+03:00`);

describe("Kasa istekleri: veritabanında düzeltme ve silme isteği, karar", { skip: !URL && "KASA_ISTEK_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  let store: typeof import("../src/server/cash/report-store");
  let requests: typeof import("../src/server/cash/requests");
  let loaders: typeof import("../src/server/data/cash-requests");
  let reports: typeof import("../src/server/data/cash-reports");
  const tag = `${process.pid}-${randomBytes(3).toString("hex")}`;
  type Who = { id: number; name: string; role: "admin" | "staff" };
  const users: Record<"ali" | "veli" | "ayse" | "mehmet" | "donen", Who> = {
    ali: { id: 0, name: "Ali", role: "admin" },
    veli: { id: 0, name: "Veli", role: "admin" },
    ayse: { id: 0, name: "Ayşe", role: "staff" },
    mehmet: { id: 0, name: "Mehmet", role: "staff" },
    donen: { id: 0, name: "Dönen", role: "staff" },
  };
  const dates: string[] = [];

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
    cashIn: 0,
    cashOut: 0,
    cashOutNote: null,
    countedCash: 3_500,
    handedOver: 2_400,
    bankPos: null,
    offRevenue: null,
    // Not dolu: açılış önceki testin devriyle tutmasa da yeni rapor not ister (openingNeedsNote)
    note: "deneme",
    ...o,
    discounts: o.discounts ?? null,
  });
  /** Raporu yazar (yönetici, doğrudan); yeni raporun sürümü 0'dan */
  async function report(date: string, o: Partial<CashReportFields> = {}, now = tr(`${date}T22:00`), by: Who = users.ali) {
    if (!dates.includes(date)) dates.push(date);
    const r = await store.saveCashReport(db, by, { ...fields(date, o), countedBy: null, revision: 0, photos: [] }, now);
    assert.equal(r.kind, "saved");
    return r.kind === "saved" ? r.row : (null as never);
  }
  const reportOf = async (date: string) => (await db.select().from(s.cashReports).where(eq(s.cashReports.date, date)))[0];
  const requestOf = async (id: number) => (await db.select().from(s.staffRequests).where(eq(s.staffRequests.id, id)))[0];
  const refused = async (p: Promise<unknown>, text: string | RegExp) => {
    await assert.rejects(p, (e: unknown) => e instanceof UserError && (typeof text === "string" ? e.message === text : text.test(e.message)));
  };
  /** Personelin düzeltme önerisi (raporun alanları üstüne değişiklik) */
  function propose(who: Who, date: string, revision: number, o: Partial<CashReportFields>, now: Date, message = "Teslim yanlış yazıldı") {
    const { date: _d, ...rest } = fields(date, o);
    void _d;
    return requests.proposeCashCorrection(db, who, { date, baseRevision: revision, fields: rest, countedBy: null, message, clientKey: null }, now);
  }
  const review = (who: Who, id: number, seenVersion: number, seenRevision: number | null, decision: "approve" | "reject" | "close", now: Date, note: string | null = null) =>
    requests.reviewCashRequestCore(db, who, { id, seenVersion, seenRevision, decision, note }, now);

  before(async () => {
    process.env.DATABASE_URL = URL;
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır: test aynı modülleri doğrudan çalıştırır
    const require = createRequire(import.meta.url);
    const marker = require.resolve("server-only");
    require.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as unknown as NodeJS.Module;
    const dbModule = await import("../src/server/db");
    db = dbModule.createDb(URL!, 4);
    store = await import("../src/server/cash/report-store");
    requests = await import("../src/server/cash/requests");
    loaders = await import("../src/server/data/cash-requests");
    reports = await import("../src/server/data/cash-reports");
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db
        .insert(s.users)
        .values({ email: `kasa-istek-${k}-${tag}@ornek.com`, name: users[k].name, passwordHash: "x", role: users[k].role })
        .returning({ id: s.users.id });
      users[k].id = u.id;
    }
  });

  after(async () => {
    if (!db) return;
    const ids = Object.values(users).map((u) => u.id);
    await db.delete(s.staffRequests).where(inArray(s.staffRequests.requestedBy, ids));
    if (dates.length) await db.delete(s.cashReports).where(inArray(s.cashReports.date, dates));
    await db.delete(s.users).where(inArray(s.users.id, ids));
    await db.$client.end();
    const { getDb } = await import("../src/server/db");
    await getDb().$client.end();
  });

  test("kilitli gün: personelin değişikliği istek olur, rapor değişmez; onaylanınca yöneticinin sürümü olur", async () => {
    const day = "2031-01-10";
    await report(day);
    await report("2031-01-11", { openingCash: 1_100 });
    const now = tr("2031-01-11T10:00");
    // Doğrudan kaydetme onaya döner, hiçbir şey yazılmaz
    const before = await reportOf(day);
    const direct = await store.saveCashReport(db, users.ayse, { ...fields(day, { handedOver: 2_040 }), countedBy: null, revision: 1, photos: [] }, now);
    assert.deepEqual(direct, { kind: "needsApproval", request: "kasa-duzeltme", gate: "kilitli" });
    // Not değişikliği de kilitli günde istek
    const textOnly = await store.saveCashReport(db, users.ayse, { ...fields(day, { note: "yazım" }), countedBy: null, revision: 1, photos: [] }, now);
    assert.equal(textOnly.kind, "needsApproval");
    const { row, changes } = await propose(users.ayse, day, 1, { handedOver: 2_040 }, now);
    assert.equal(row.status, "pending");
    assert.equal(row.kind, "kasa-duzeltme");
    assert.deepEqual(changes.map((c) => c.key), ["handedOver"]);
    assert.equal((row.payload as { gate: string }).gate, "kilitli");
    const after = await reportOf(day);
    assert.equal(after.revision, before.revision);
    assert.equal(after.handedOver, 2_400, "rapor onaya kadar değişmez");
    // Değişiklik yoksa öneri reddedilir; yönetici istek açmaz
    await refused(propose(users.mehmet, day, 1, {}, now), CASH_REQUEST_TEXT.noChange);
    await refused(propose(users.ali, day, 1, { handedOver: 2_000 }, now), CASH_REQUEST_TEXT.adminDirect);
    // Onay: yeni sürüm, gönderen yönetici; istek onaylandı ve sürümü sonuçta
    const out = await review(users.ali, row.id, row.version, 1, "approve", tr("2031-01-11T11:00"));
    assert.equal(out.status, "approved");
    const approved = await reportOf(day);
    assert.equal(approved.revision, 2);
    assert.equal(approved.handedOver, 2_040);
    assert.equal(approved.submittedByName, "Ali");
    const req = await requestOf(row.id);
    assert.equal(req.status, "approved");
    assert.equal(req.resultId, approved.id);
    assert.deepEqual(req.result, { revision: 2 });
    const proposed = await loaders.proposedByForReports([approved.id]);
    assert.equal(proposed.get(approved.id)?.get(2), "Ayşe");
  });

  test("dünün raporu: ertesi gün kasa alanı ya da sayan onaya döner, metin doğrudan; aynı gece her şey doğrudan", async () => {
    const day = "2032-01-10";
    await report(day);
    // Aynı gece (05:00'ten önce): teslim değişikliği doğrudan
    const night = await store.saveCashReport(db, users.ayse, { ...fields(day, { handedOver: 2_300 }), countedBy: null, revision: 1, photos: [] }, tr("2032-01-11T04:30"));
    assert.equal(night.kind, "saved");
    assert.equal((await reportOf(day)).handedOver, 2_300);
    // Ertesi gün: teslim değişikliği onaya döner, hiçbir şey yazılmaz
    const morning = tr("2032-01-11T10:00");
    const late = await store.saveCashReport(db, users.ayse, { ...fields(day, { handedOver: 2_040 }), countedBy: null, revision: 2, photos: [] }, morning);
    assert.deepEqual(late, { kind: "needsApproval", request: "kasa-duzeltme", gate: "gec" });
    assert.equal((await reportOf(day)).revision, 2);
    // Sayan değişikliği de onaya döner
    const counter = await store.saveCashReport(db, users.ayse, { ...fields(day, { handedOver: 2_300 }), countedBy: users.mehmet.id, revision: 2, photos: [] }, morning);
    assert.equal(counter.kind, "needsApproval");
    // Yalnız not: doğrudan
    const text = await store.saveCashReport(db, users.ayse, { ...fields(day, { handedOver: 2_300, note: "Z no eksikti" }), countedBy: null, revision: 2, photos: [] }, morning);
    assert.equal(text.kind, "saved");
    assert.equal((await reportOf(day)).note, "Z no eksikti");
    // Doğrudan kaydedilebilen değişiklik istek olmaz
    await refused(propose(users.ayse, day, 3, { handedOver: 2_300, note: "başka not" }, morning), CASH_REQUEST_TEXT.direct);
    // Personelin penceresi kapandı: öneri de yok
    await refused(propose(users.ayse, day, 3, { handedOver: 2_000 }, tr("2032-01-12T05:00")), CASH_REQUEST_TEXT.closed);
  });

  test("iki personelin isteği birbirini engellemez; biri onaylanınca öteki kapanır; bayat sürüm ve bayat rapor reddedilir", async () => {
    const day = "2033-01-10";
    await report(day);
    const now = tr("2033-01-11T10:00");
    const a = await propose(users.ayse, day, 1, { handedOver: 2_040 }, now);
    const m = await propose(users.mehmet, day, 1, { countedCash: 3_600 }, now, "Sayım yanlış");
    assert.notEqual(a.row.id, m.row.id);
    // Ayşe önerisini günceller: sürüm artar; yönetici eski sürümü onaylayamaz
    const a2 = await propose(users.ayse, day, 1, { handedOver: 2_000 }, now);
    assert.equal(a2.row.id, a.row.id);
    assert.equal(a2.row.version, 2);
    await refused(review(users.ali, a.row.id, 1, 1, "approve", now), REQUEST_TEXT.changed);
    // Personelin görünümü: kendi isteği tam, başkasınınki yalnız tür, ad ve an
    const view = await loaders.pendingCashForDay(day, users.ayse);
    assert.equal(view.own.length, 1);
    assert.deepEqual(Object.keys(view.others[0]).sort(), ["createdAt", "kind", "requestedByName"]);
    assert.equal(view.others[0].requestedByName, "Mehmet");
    // Mehmet'inki onaylanır: rapor r2, Ayşe'ninki kapanır ("Rapor başka bir istekle düzeltildi")
    const out = await review(users.ali, m.row.id, m.row.version, 1, "approve", now);
    assert.equal(out.status, "approved");
    const ayse = await requestOf(a.row.id);
    assert.equal(ayse.status, "superseded");
    assert.equal(ayse.reviewNote, "Rapor başka bir istekle düzeltildi");
    // Rapor arada değişti: kartta görülen eski sürümle onay reddedilir
    const b = await propose(users.ayse, day, 2, { countedCash: 3_600, handedOver: 2_100 }, now);
    await refused(review(users.ali, b.row.id, b.row.version, 1, "approve", now), CASH_REQUEST_TEXT.reviewStale);
    // Ret yalnız durum ve not yazar
    await review(users.ali, b.row.id, b.row.version, 2, "reject", now, "Teslim doğru");
    const rejected = await requestOf(b.row.id);
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.reviewNote, "Teslim doğru");
    assert.equal((await reportOf(day)).revision, 2);
  });

  test("öneri arada yapılan yönetici düzeltmesini ezmez; öneri artık bir şey değiştirmiyorsa yalnız kapatılır", async () => {
    const day = "2034-01-10";
    await report(day);
    const now = tr("2034-01-11T10:00");
    const a = await propose(users.ayse, day, 1, { handedOver: 2_040 }, now);
    // Yönetici arada Z'yi ve teslimi düzeltir (teslim önerininkiyle aynı)
    const admin = await store.saveCashReport(db, users.ali, { ...fields(day, { zTotal: 10_500, handedOver: 2_040 }), countedBy: null, revision: 1, photos: [] }, now);
    assert.equal(admin.kind, "saved");
    await refused(review(users.ali, a.row.id, a.row.version, 2, "approve", now), CASH_REQUEST_TEXT.nothingToApply);
    await review(users.ali, a.row.id, a.row.version, 2, "close", now);
    assert.equal((await requestOf(a.row.id)).status, "superseded");
    // Yeni öneri: Z ve sayılan. Yönetici bu arada notu düzeltir: onayda önerinin alanları uygulanır, not korunur
    const b = await propose(users.ayse, day, 2, { zTotal: 10_000, handedOver: 2_040, countedCash: 3_600 }, now);
    assert.deepEqual(b.changes.map((c) => c.key).sort(), ["countedCash", "zTotal"].sort());
    const note = await store.saveCashReport(db, users.ali, { ...fields(day, { zTotal: 10_500, handedOver: 2_040, note: "Z düzeltildi" }), countedBy: null, revision: 2, photos: [] }, now);
    assert.equal(note.kind, "saved");
    // "Öneriyi düzenle": form önerinin alanlarını raporun şimdiki hâline uygulanmış olarak açar (yöneticinin notu geri alınmaz)
    const view = await loaders.pendingCashForDay(day, users.ayse);
    const own = view.own.find((o) => o.kind === "kasa-duzeltme");
    assert.ok(own && own.kind === "kasa-duzeltme");
    assert.equal(own.proposed.note, "Z düzeltildi");
    assert.equal(own.proposed.countedCash, 3_600);
    assert.equal(own.proposed.zTotal, 10_000);
    await refused(review(users.ali, b.row.id, b.row.version, 2, "approve", now), CASH_REQUEST_TEXT.reviewStale);
    await review(users.ali, b.row.id, b.row.version, 3, "approve", now);
    const r = await reportOf(day);
    assert.equal(r.countedCash, 3_600);
    assert.equal(r.zTotal, 10_000);
    assert.equal(r.note, "Z düzeltildi", "arada yapılan yönetici düzeltmesi korunur");
    assert.equal(r.revision, 4);
  });

  test("kimse kendi isteğini onaylayamaz (sonradan yönetici yapılan hesap da); eşzamanlı iki onaydan biri kazanır", async () => {
    const day = "2035-01-10";
    await report(day);
    const now = tr("2035-01-11T10:00");
    const own = await propose(users.donen, day, 1, { handedOver: 2_040 }, now);
    await db.update(s.users).set({ role: "admin" }).where(eq(s.users.id, users.donen.id));
    await refused(review({ ...users.donen, role: "admin" }, own.row.id, own.row.version, 1, "approve", now), REQUEST_TEXT.self);
    await db.update(s.users).set({ role: "staff" }).where(eq(s.users.id, users.donen.id));
    // Personel karar veremez
    await refused(review(users.ayse, own.row.id, own.row.version, 1, "approve", now), REQUEST_TEXT.adminOnly);
    const results = await Promise.allSettled([review(users.ali, own.row.id, own.row.version, 1, "approve", now), review(users.veli, own.row.id, own.row.version, 1, "approve", now)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "tek onay kazanır");
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.ok(lost.reason instanceof UserError);
    assert.equal((await reportOf(day)).revision, 2, "rapor bir kez düzeltildi");
  });

  test("silme isteği: onayda rapor silinir, kendi istek onaylanır, aynı günün öteki istekleri kapanır; düzenleme bekler", async () => {
    const day = "2036-01-10";
    await report(day);
    const now = tr("2036-01-11T10:00");
    const del = await requests.proposeCashDelete(db, users.ayse, { date: day, baseRevision: 1, message: "İki kez girildi", clientKey: null }, now);
    const fix = await propose(users.mehmet, day, 1, { handedOver: 2_040 }, now);
    const otherDel = await requests.proposeCashDelete(db, users.mehmet, { date: day, baseRevision: 1, message: "Yanlış gün", clientKey: null }, now);
    assert.equal((del.row.payload as { photos: number }).photos, 0);
    // Kendi silme isteği bekleyen rapor düzenlenmez, düzeltme önerilmez
    await refused(store.saveCashReport(db, users.ayse, { ...fields(day, { note: "x" }), countedBy: null, revision: 1, photos: [] }, now), CASH_REQUEST_TEXT.deletePending);
    await refused(propose(users.ayse, day, 1, { handedOver: 2_000 }, now), CASH_REQUEST_TEXT.deletePending);
    const out = await review(users.ali, del.row.id, del.row.version, 1, "approve", now);
    assert.equal(out.status, "approved");
    assert.equal(await reportOf(day), undefined, "rapor silindi");
    assert.equal((await requestOf(del.row.id)).status, "approved");
    for (const id of [fix.row.id, otherDel.row.id]) {
      const r = await requestOf(id);
      assert.equal(r.status, "superseded");
      assert.equal(r.reviewNote, "Rapor silindi");
    }
  });

  test("yöneticinin doğrudan silmesi bekleyen istekleri kapatır (reddetmez)", async () => {
    const day = "2037-01-10";
    const row = await report(day);
    const now = tr("2037-01-11T10:00");
    const fix = await propose(users.ayse, day, 1, { handedOver: 2_040 }, now);
    await db.transaction((tx) => store.removeCashReport(tx, row.id));
    const r = await requestOf(fix.row.id);
    assert.equal(r.status, "superseded");
    assert.equal(r.reviewNote, "Rapor silindi");
  });

  test("kasa e-postasına personel adresi yazılamaz ve gönderimde düşer (büyük-küçük harf fark etmez); yöneticinin adresi yazılır", async () => {
    const staff = `kasa-istek-ayse-${tag}@ornek.com`;
    const admin = `kasa-istek-ali-${tag}@ornek.com`;
    assert.deepEqual(await store.staffEmailsIn(db, [staff.toUpperCase(), admin, "dis@ornek.com"]), [staff]);
    assert.deepEqual(await store.staffEmailsIn(db, [admin]), []);
    assert.deepEqual(await store.staffEmailsIn(db, []), []);
    // Gönderim anında: ayar kaydedildikten sonra personel olan adres düşer, ötekiler sırasıyla kalır
    assert.deepEqual(await store.cashEmailRecipients(db, [staff.toUpperCase(), admin, "dis@ornek.com"]), [admin, "dis@ornek.com"]);
    assert.deepEqual(await store.cashEmailRecipients(db, [staff]), []);
  });

  test("kilit sırası: önerisini ya da silme isteğini güncelleyen personel, aynı anda verilen onayla kilitlenmez (rapor, sonra istek)", async () => {
    const day = "2038-01-10";
    await report(day);
    const now = tr("2038-01-11T10:00");
    const out = await propose(users.ayse, day, 1, { handedOver: 2_040 }, now);
    const [approve, edit] = await raceOnRequest(
      URL!,
      out.row.id,
      () => review(users.ali, out.row.id, out.row.version, 1, "approve", now),
      () => propose(users.ayse, day, 1, { handedOver: 2_000 }, now, "Teslim yine yanlış"),
    );
    assert.equal(approve.status, "fulfilled");
    assert.equal((await reportOf(day)).handedOver, 2_040);
    // Güncelleme onaylanan sürümün üstüne yazılmaz: ekrandaki sürüm bayat
    assert.equal(edit.status, "rejected");
    assert.equal(((edit as PromiseRejectedResult).reason as Error).message, CASH_REQUEST_TEXT.stale);

    const day2 = "2038-02-10";
    await report(day2);
    const now2 = tr("2038-02-11T10:00");
    const del = await requests.proposeCashDelete(db, users.ayse, { date: day2, baseRevision: 1, message: "İki kez girildi", clientKey: null }, now2);
    const [approve2, edit2] = await raceOnRequest(
      URL!,
      del.row.id,
      () => review(users.ali, del.row.id, del.row.version, 1, "approve", now2),
      () => requests.proposeCashDelete(db, users.ayse, { date: day2, baseRevision: 1, message: "Yanlış gün", clientKey: null }, now2),
    );
    assert.equal(approve2.status, "fulfilled");
    assert.equal(await reportOf(day2), undefined, "rapor silindi");
    assert.equal(edit2.status, "rejected");
    assert.equal(((edit2 as PromiseRejectedResult).reason as Error).message, CASH_REQUEST_TEXT.noReport);
  });

  // Son test: günü (2039) öteki testlerin günlerinden sonra; önceki testlerin "sonraki rapor" denetimini değiştirmez
  test("gün içinde giren: saklanır ve farka girer, sürüm kopyasında; ertesi gün değişirse onaya döner, onayla rapora geçer", async () => {
    const day = "2039-01-10";
    // Yönetici: giren yok, 500 + 3.000 = 3.500 sayıldı
    const first = await report(day, { countedCash: 3_500 });
    assert.deepEqual([first.cashIn, first.cashDiff], [0, 0]);
    // Aynı gece personel 300 ₺ bozuk parayı yazar, sayılan 3.800: 500 + 3.000 + 300 = 3.800, kasa tutuyor (doğrudan)
    const night = await store.saveCashReport(db, users.ayse, { ...fields(day, { cashIn: 300, countedCash: 3_800 }), countedBy: users.ali.id, revision: 1, photos: [] }, tr(`${day}T23:30`));
    assert.equal(night.kind, "saved");
    if (night.kind !== "saved") return;
    assert.deepEqual([night.row.cashIn, night.row.cashDiff, night.row.revision], [300, 0, 2]);
    assert.deepEqual(night.changes.map((c) => [c.key, c.sensitive]), [["cashIn", true], ["countedCash", true]]);
    const [snap] = await db.select().from(s.cashReportRevisions).where(eq(s.cashReportRevisions.reportId, first.id));
    assert.equal(snap.data.cashIn, 0, "önceki sürümün kopyası gireni taşır");
    // Alan gelmeden önceki kopya (gireni yok) 0 sayılır: geçmişte "— → 300 ₺" değil "0 ₺ → 300 ₺"
    await db.execute(sql`update cash_report_revisions set data = data - 'cashIn' where report_id = ${first.id}`);
    const revs = await reports.cashRevisionsFor([first.id]);
    assert.ok(!("cashIn" in revs[0].data));
    const entry = historyOf(reports.toCashDTO(night.row), revs).entries[0];
    assert.deepEqual(entry.changes.map((c) => [c.key, c.from.replace(/\u00a0/g, " ")]), [["cashIn", "0 ₺"], ["countedCash", "3.500 ₺"]]);
    // Ertesi gün gireni değiştirmek kasa alanı değişikliği: hiçbir şey yazılmaz, onaya döner
    const now = tr("2039-01-11T10:00");
    const direct = await store.saveCashReport(db, users.ayse, { ...fields(day, { cashIn: 0, countedCash: 3_800 }), countedBy: users.ali.id, revision: 2, photos: [] }, now);
    assert.deepEqual(direct, { kind: "needsApproval", request: "kasa-duzeltme", gate: "gec" });
    assert.equal((await reportOf(day)).cashIn, 300);
    // Öneri: giren yanlış yazılmış (300 → 0); yükte giren, onaylanınca rapora geçer ve fark onunla
    const { row, changes } = await propose(users.ayse, day, 2, { cashIn: 0, countedCash: 3_800 }, now, "Bozuk para kasaya konmamış");
    assert.deepEqual(changes.map((c) => c.key), ["cashIn"]);
    assert.equal((row.payload as { proposed: { cashIn: number } }).proposed.cashIn, 0);
    const out = await review(users.veli, row.id, row.version, 2, "approve", now);
    assert.equal(out.status, "approved");
    const after = await reportOf(day);
    assert.deepEqual([after.cashIn, after.cashDiff, after.revision], [0, 300, 3], "500 + 3.000 − 0 = 3.500 beklenir, 3.800 sayıldı: 300 fazla");
  });
});
