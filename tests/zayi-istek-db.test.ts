// Geç zayi / ikram ve silme isteği, gerçek Postgres'te (plan docs/planlar/personel-yetki.md §2.8; docs/ZAYI-IKRAM.md ›
// Geç kayıt ve silme isteği): istek kayıt yazmaz, onay tek kayıt yazar (isteyenin adıyla); aynı kimlikte sonradan
// değişen kayıt silinmez (istek "Kayıt zaten silinmişti" diye kapanır); kimse kendi isteğini onaylayamaz; doğrudan
// silme aynı kaydın bekleyen isteklerini kapatır; eşzamanlı iki onaydan tek sonuç; 10 gün bekleyen istek yine
// onaylanır; kapalı işaretli güne personel yazamaz; kipler (doğrudan / istek / kapalı) ve aynı isteğin tekrarı. Şube
// (denetim 21 Kasım #13, #28): günün kilidi kaydın şubesinin kasasından; Onaylar kartının bağlamı isteğin şubesinden.
// Müdüre (docs/ROLLER.md) yalnız şubesinin kartları gider, malzeme maliyeti olmadan (bulgu 4).
//
// Kendi kullanıcılarını, ürününü, raporlarını, kayıtlarını, özel gününü ve isteklerini açar, sonunda siler (Marina
// şubesi yoksa açar ve siler). Günler
// 2029'da: öteki veritabanı testlerinin raporları (2030 ve sonrası) bu günlere "sonraki rapor" sayılır; kilitli dün iki
// raporla kurulur, açık günler raporsuz.
//
// ZAYI_ISTEK_TEST_DATABASE_URL verilmezse atlanır (migration'ları uygulanmış bir yerel veritabanı).
// Çalıştırma: ZAYI_ISTEK_TEST_DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_yetki npx tsx --test tests/zayi-istek-db.test.ts

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { and, eq, inArray } from "drizzle-orm";

import type { CashReportFields } from "../src/lib/cash-report";
import { createModel } from "../src/lib/calc/engine";
import { CLOSED_TEXT } from "../src/lib/closed-days";
import { REQUEST_TEXT } from "../src/lib/staff-requests";
import { WASTE_REQUEST_TEXT } from "../src/lib/waste-requests";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { UserError } from "../src/server/user-error";

import { assertNoCostKeys } from "./helpers/leak-scan";
import { raceOnRequest } from "./helpers/lock-race";

const URL = process.env.ZAYI_ISTEK_TEST_DATABASE_URL;
/** Türkiye saatiyle an */
const tr = (local: string) => new Date(`${local}:00+03:00`);
const DAY_MS = 86_400_000;

describe("Geç zayi / ikram ve silme isteği: veritabanında istek, karar ve doğrudan yol", { skip: !URL && "ZAYI_ISTEK_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  let store: typeof import("../src/server/cash/report-store");
  let core: typeof import("../src/server/waste/core");
  let wasteRequests: typeof import("../src/server/data/waste-requests");
  let dataset: typeof import("../src/server/data/dataset");
  let withBranchScope: typeof import("../src/server/branch-scope").withBranchScope;
  /** Marina'yı bu test açtıysa sonunda siler */
  let marinaAdded = false;
  const tag =`${process.pid}-${randomBytes(3).toString("hex")}`;
  type Who = { id: number; name: string; role: "admin" | "staff" };
  const users: Record<"ali" | "veli" | "ayse" | "mehmet" | "donen" | "fatma", Who> = {
    ali: { id: 0, name: "Ali", role: "admin" },
    veli: { id: 0, name: "Veli", role: "admin" },
    ayse: { id: 0, name: "Ayşe", role: "staff" },
    mehmet: { id: 0, name: "Mehmet", role: "staff" },
    donen: { id: 0, name: "Dönen", role: "staff" },
    // Bulgu 4'ün istekleri: öteki testlerin bekleyen isteklerinden ayrı kişi
    fatma: { id: 0, name: "Fatma", role: "staff" },
  };
  let categoryId = 0;
  let latte = 0;
  let old = 0;
  const reportDates: string[] = [];
  const specialIds: number[] = [];

  // Kilitli dün: 9 Mart'ın ve 10 Mart'ın raporu var; eski gün 1 Mart; 14 günden eski 23 Şubat
  const NOW = tr("2029-03-10T12:00");
  const TODAY = "2029-03-10";
  const YESTERDAY = "2029-03-09";
  const OLD = "2029-03-01";
  const TOO_OLD = "2029-02-23";
  // Kapalı işaretli günler: 5 Mart (istek) ve 10 Haziran (doğrudan)
  const CLOSED = "2029-03-05";
  const CLOSED_NOW = tr("2029-06-10T12:00");
  const CLOSED_TODAY = "2029-06-10";

  const fields = (date: string): CashReportFields & { discounts: number | null } => ({
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
    handedOver: 3_000,
    bankPos: null,
    offRevenue: null,
    note: "deneme",
    discounts: null,
  });
  async function report(date: string) {
    reportDates.push(date);
    const r = await store.saveCashReport(db, users.ali, { ...fields(date), countedBy: null, revision: 0, photos: [] }, tr(`${date}T22:00`));
    assert.equal(r.kind, "saved");
  }
  const item = (o: Partial<{ date: string; kind: "zayi" | "ikram"; productId: number | null; qty: number; reason: string | null; note: string | null }> = {}) => ({
    date: OLD,
    kind: "zayi" as const,
    productId: latte,
    ingredientId: null,
    qty: 2,
    reason: "Döküldü / kırıldı",
    note: null,
    ...o,
  });
  const key = () => `k-${randomBytes(6).toString("hex")}`;
  const late = (who: Who, o: Parameters<typeof item>[0] = {}, now = NOW, clientKey = key()) =>
    core.proposeLateWaste(db, who, { ...item(o), message: "Akşam girmeyi unuttum", clientKey }, now);
  const askDelete = (who: Who, id: number, now = NOW) => core.proposeWasteDelete(db, who, { id, message: "Yanlış girildi", clientKey: key() }, now);
  const review = (who: Who, id: number, seenVersion: number, decision: "approve" | "reject", now = NOW) => core.reviewWasteRequestCore(db, who, { id, seenVersion, decision, note: null }, now);
  const entriesOn = (date: string) =>
    db
      .select()
      .from(s.wasteEntries)
      .where(and(eq(s.wasteEntries.date, date), eq(s.wasteEntries.productId, latte)));
  const requestOf = async (id: number) => (await db.select().from(s.staffRequests).where(eq(s.staffRequests.id, id)))[0];
  const refused = async (p: Promise<unknown>, text: string | RegExp) => {
    await assert.rejects(p, (e: unknown) => e instanceof UserError && (typeof text === "string" ? e.message === text : text.test(e.message)));
  };

  before(async () => {
    process.env.DATABASE_URL = URL;
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır: test aynı modülleri doğrudan çalıştırır
    const require = createRequire(import.meta.url);
    const marker = require.resolve("server-only");
    require.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as unknown as NodeJS.Module;
    const dbModule = await import("../src/server/db");
    db = dbModule.createDb(URL!, 4);
    store = await import("../src/server/cash/report-store");
    core = await import("../src/server/waste/core");
    wasteRequests = await import("../src/server/data/waste-requests");
    dataset = await import("../src/server/data/dataset");
    ({ withBranchScope } = await import("../src/server/branch-scope"));
    const added = await db
      .insert(s.branches)
      .values({ id: "marina", name: "Marina", kind: "fiziksel", posSource: "modpos", sortOrder: 2 })
      .onConflictDoNothing()
      .returning({ id: s.branches.id });
    marinaAdded = added.length > 0;
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db.insert(s.users).values({ email: `zayi-istek-${k}-${tag}@ornek.com`, name: users[k].name, passwordHash: "x", role: users[k].role }).returning({ id: s.users.id });
      users[k].id = u.id;
    }
    const [c] = await db.insert(s.categories).values({ name: `Zayi istek ${tag}`, sortOrder: 99 }).returning({ id: s.categories.id });
    categoryId = c.id;
    const [p] = await db.insert(s.products).values({ categoryId, name: `Latte ${tag}`, size: "M", price: 205 }).returning({ id: s.products.id });
    latte = p.id;
    const [q] = await db.insert(s.products).values({ categoryId, name: `Eski ${tag}`, size: "M", price: 150, active: false }).returning({ id: s.products.id });
    old = q.id;
    await report(YESTERDAY);
    await report(TODAY);
    for (const d of [CLOSED, CLOSED_TODAY]) {
      const [sd] = await db
        .insert(s.specialDays)
        .values({ dateFrom: d, dateTo: d, kind: "kapali", title: "Kafe kapalı", effect: -1, createdBy: users.ali.id, createdByName: "Ali" })
        .returning({ id: s.specialDays.id });
      specialIds.push(sd.id);
    }
  });

  after(async () => {
    if (!db) return;
    const uids = Object.values(users)
      .map((u) => u.id)
      .filter(Boolean);
    if (uids.length) await db.delete(s.staffRequests).where(inArray(s.staffRequests.requestedBy, uids));
    await db.delete(s.wasteEntries).where(inArray(s.wasteEntries.productId, [latte, old].filter(Boolean)));
    if (specialIds.length) await db.delete(s.specialDays).where(inArray(s.specialDays.id, specialIds));
    if (reportDates.length) await db.delete(s.cashReports).where(inArray(s.cashReports.date, reportDates));
    await db.delete(s.products).where(inArray(s.products.id, [latte, old].filter(Boolean)));
    if (categoryId) await db.delete(s.categories).where(eq(s.categories.id, categoryId));
    if (uids.length) await db.delete(s.users).where(inArray(s.users.id, uids));
    if (marinaAdded) await db.delete(s.branches).where(eq(s.branches.id, "marina"));
    await db.$client.end();
  });

  test("istek kayıt yazmaz; onay tek kayıt yazar, isteyenin adıyla; ikinci onay reddedilir", async () => {
    const out = await late(users.ayse, { qty: 3 });
    assert.equal(out.created, true);
    assert.equal(out.row.kind, "zayi-gec");
    assert.equal(out.row.day, OLD);
    assert.equal(out.row.status, "pending");
    assert.equal((await entriesOn(OLD)).length, 0, "istek kayıt yazmaz");
    const r = await review(users.ali, out.row.id, out.row.version, "approve");
    assert.equal(r.status, "approved");
    const rows = await entriesOn(OLD);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].qty, 3);
    assert.equal(rows[0].createdBy, users.ayse.id);
    assert.equal(rows[0].createdByName, "Ayşe");
    const req = await requestOf(out.row.id);
    assert.equal(req.status, "approved");
    assert.equal(req.resultId, rows[0].id);
    await refused(review(users.veli, out.row.id, out.row.version, "approve"), REQUEST_TEXT.decided);
    assert.equal((await entriesOn(OLD)).length, 1);
    // Ret kayıt yazmaz
    const other = await late(users.mehmet, { date: "2029-03-02" });
    assert.equal((await review(users.ali, other.row.id, other.row.version, "reject")).status, "rejected");
    assert.equal((await entriesOn("2029-03-02")).length, 0);
  });

  test("kipler: eski güne doğrudan yazılmaz, bugüne istek açılmaz, 14 günden eskisi kapalı; aynı istek tekrarı", async () => {
    await refused(core.addWaste(db, users.ayse, item({ date: OLD }), NOW), /kasa raporu girilene kadar/);
    await refused(core.addWaste(db, users.ayse, item({ date: YESTERDAY }), NOW), /kasa raporu girilene kadar/);
    await refused(late(users.ayse, { date: TODAY }), WASTE_REQUEST_TEXT.useDirect);
    await refused(late(users.ayse, { date: TOO_OLD }), WASTE_REQUEST_TEXT.windowOld);
    await refused(late(users.ali, { date: "2029-03-03" }), REQUEST_TEXT.adminDirect);
    // Pasif kalem istek anında reddedilir
    await refused(late(users.ayse, { date: "2029-03-03", productId: old }), /bulunamadı/);
    // Aynı gün, tür, kalem ve miktarda bekleyen istek: yeni istemci anahtarıyla reddedilir, aynı anahtarla aynı satır
    const k = key();
    const first = await late(users.ayse, { date: "2029-03-03", qty: 1 }, NOW, k);
    const again = await late(users.ayse, { date: "2029-03-03", qty: 1 }, NOW, k);
    assert.equal(again.row.id, first.row.id);
    assert.equal(again.created, false);
    await refused(late(users.ayse, { date: "2029-03-03", qty: 1 }), WASTE_REQUEST_TEXT.sameRequest);
    // Başka miktar ayrı istek
    assert.equal((await late(users.ayse, { date: "2029-03-03", qty: 2 })).created, true);
    // Yönetici her güne doğrudan yazar
    const admin = await core.addWaste(db, users.ali, item({ date: TOO_OLD }), NOW);
    assert.ok(admin.id > 0);
    // Bugüne personel doğrudan yazar; kilitli dünün kendi kaydı doğrudan silinmez, istenir
    const own = await core.addWaste(db, users.ayse, item({ date: TODAY }), NOW);
    const [y] = await db
      .insert(s.wasteEntries)
      .values({ date: YESTERDAY, kind: "zayi", productId: latte, name: `Latte ${tag} M`, qty: 1, unit: "adet", createdBy: users.ayse.id, createdByName: "Ayşe" })
      .returning({ id: s.wasteEntries.id });
    await refused(core.removeWaste(db, users.ayse, y.id, NOW), /silinmesini isteyin/);
    assert.equal((await askDelete(users.ayse, y.id)).row.kind, "zayi-sil");
    // Kendi bugünkü kaydını silmek için istek açılmaz (doğrudan siler)
    await refused(askDelete(users.ayse, own.id), WASTE_REQUEST_TEXT.deleteDirect);
    await core.removeWaste(db, users.ayse, own.id, NOW);
  });

  test("kendi isteğini onaylama reddedilir (sonradan yönetici olan hesap)", async () => {
    const out = await late(users.donen, { date: "2029-03-04" });
    await db.update(s.users).set({ role: "admin" }).where(eq(s.users.id, users.donen.id));
    await refused(review({ ...users.donen, role: "admin" }, out.row.id, out.row.version, "approve"), REQUEST_TEXT.self);
    assert.equal((await entriesOn("2029-03-04")).length, 0);
    await db.update(s.users).set({ role: "staff" }).where(eq(s.users.id, users.donen.id));
  });

  test("aynı kimlikte sonradan değişen kayıt silinmez: istek 'Kayıt zaten silinmişti' diye kapanır", async () => {
    const [e] = await db
      .insert(s.wasteEntries)
      .values({ date: "2029-03-06", kind: "zayi", productId: latte, name: `Latte ${tag} M`, qty: 1, unit: "adet", createdBy: users.mehmet.id, createdByName: "Mehmet" })
      .returning({ id: s.wasteEntries.id });
    const out = await askDelete(users.ayse, e.id);
    assert.equal(out.row.subject, `zayi:${e.id}`);
    // Kayıt arada değişti (başka bir kayıt gibi): miktar ve an
    await db.update(s.wasteEntries).set({ qty: 4, createdAt: new Date(NOW.getTime() - 3600_000) }).where(eq(s.wasteEntries.id, e.id));
    const r = await review(users.ali, out.row.id, out.row.version, "approve");
    assert.equal(r.status, "gone");
    const req = await requestOf(out.row.id);
    assert.equal(req.status, "superseded");
    assert.equal(req.reviewNote, WASTE_REQUEST_TEXT.gone);
    assert.equal((await db.select().from(s.wasteEntries).where(eq(s.wasteEntries.id, e.id))).length, 1, "kayıt yerinde");
  });

  test("onaylı silme kaydı siler, aynı kaydın öteki isteklerini kapatır; doğrudan silme de kapatır", async () => {
    const [e] = await db
      .insert(s.wasteEntries)
      .values({ date: "2029-03-07", kind: "ikram", productId: latte, name: `Latte ${tag} M`, qty: 1, unit: "adet", createdBy: users.mehmet.id, createdByName: "Mehmet" })
      .returning({ id: s.wasteEntries.id });
    const a = await askDelete(users.ayse, e.id);
    const b = await askDelete(users.donen, e.id);
    const r = await review(users.ali, a.row.id, a.row.version, "approve");
    assert.equal(r.status, "approved");
    assert.equal((await db.select().from(s.wasteEntries).where(eq(s.wasteEntries.id, e.id))).length, 0);
    const other = await requestOf(b.row.id);
    assert.equal(other.status, "superseded");
    assert.equal(other.reviewNote, WASTE_REQUEST_TEXT.deleted);
    // Doğrudan silme: bugünkü kaydını giren siler, başkasının silme isteği kapanır
    const own = await core.addWaste(db, users.ayse, item({ date: TODAY, kind: "ikram", qty: 1 }), NOW);
    const ask = await askDelete(users.mehmet, own.id);
    await core.removeWaste(db, users.ayse, own.id, NOW);
    const closed = await requestOf(ask.row.id);
    assert.equal(closed.status, "superseded");
    assert.equal(closed.reviewNote, WASTE_REQUEST_TEXT.deleted);
    // Yöneticinin doğrudan silmesi de kapatır
    const [f] = await db
      .insert(s.wasteEntries)
      .values({ date: "2029-03-07", kind: "zayi", productId: latte, name: `Latte ${tag} M`, qty: 2, unit: "adet", createdBy: users.mehmet.id, createdByName: "Mehmet" })
      .returning({ id: s.wasteEntries.id });
    const c = await askDelete(users.ayse, f.id);
    await core.removeWaste(db, users.ali, f.id, NOW);
    assert.equal((await requestOf(c.row.id)).status, "superseded");
  });

  test("eşzamanlı iki onaydan tek sonuç; 10 gün bekleyen istek yine onaylanır", async () => {
    const out = await late(users.mehmet, { date: "2029-03-08", qty: 5 });
    const results = await Promise.allSettled([review(users.ali, out.row.id, out.row.version, "approve"), review(users.veli, out.row.id, out.row.version, "approve")]);
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
    const rejected = results.find((x) => x.status === "rejected") as PromiseRejectedResult;
    assert.ok(rejected.reason instanceof UserError, String(rejected.reason));
    assert.equal((await entriesOn("2029-03-08")).length, 1);
    // On gün sonra (pencere kaymış olsa da) onay geçer
    const waited = await late(users.mehmet, { date: "2029-02-25", qty: 1 });
    const r = await review(users.ali, waited.row.id, waited.row.version, "approve", new Date(NOW.getTime() + 10 * DAY_MS));
    assert.equal(r.status, "approved");
    assert.equal((await entriesOn("2029-02-25")).length, 1);
  });

  test("kapalı işaretli güne personel yazamaz (istek ve doğrudan); yönetici yazar", async () => {
    await refused(late(users.ayse, { date: CLOSED }), CLOSED_TEXT.refusal);
    await refused(core.addWaste(db, users.ayse, item({ date: CLOSED_TODAY }), CLOSED_NOW), CLOSED_TEXT.refusal);
    const admin = await core.addWaste(db, users.ali, item({ date: CLOSED_TODAY }), CLOSED_NOW);
    assert.ok(admin.id > 0);
  });

  test("kilit sırası: silme isteğini güncelleyen personel ya da kaydı doğrudan silen yönetici, aynı anda verilen onayla kilitlenmez (kayıt, sonra istek)", async () => {
    const entry = async () =>
      (
        await db
          .insert(s.wasteEntries)
          .values({ date: "2029-03-06", kind: "zayi", productId: latte, name: `Latte ${tag} M`, qty: 1, unit: "adet", createdBy: users.mehmet.id, createdByName: "Mehmet" })
          .returning({ id: s.wasteEntries.id })
      )[0].id;
    const e1 = await entry();
    const a = await askDelete(users.ayse, e1);
    const [approve, edit] = await raceOnRequest(
      URL!,
      a.row.id,
      () => review(users.ali, a.row.id, a.row.version, "approve"),
      () => core.proposeWasteDelete(db, users.ayse, { id: e1, message: "Yine yanlış", clientKey: key() }, NOW),
    );
    assert.equal(approve.status, "fulfilled");
    // Kayıt onayla silindi: güncelleme temiz bir hatayla düşer
    assert.equal(edit.status, "rejected");
    assert.equal((await db.select().from(s.wasteEntries).where(eq(s.wasteEntries.id, e1))).length, 0);

    const e2 = await entry();
    const b = await askDelete(users.ayse, e2);
    const [approve2, removed] = await raceOnRequest(
      URL!,
      b.row.id,
      () => review(users.ali, b.row.id, b.row.version, "approve"),
      () => core.removeWaste(db, users.veli, e2, NOW),
    );
    assert.equal(approve2.status, "fulfilled");
    assert.equal(removed.status, "rejected", "kayıt onayla silinmişti");
    assert.equal((await requestOf(b.row.id)).status, "approved");
  });

  test("günün kilidi şube başına: iki şube dünü ve bugünü girince dün kapanır; öteki şubenin raporu unutulan dünü kapatmaz (denetim 21 Kasım #13)", async () => {
    const marina = <T>(fn: () => Promise<T>) => withBranchScope("marina", fn);
    // 1) Tuzla'nın 9 ve 10 Mart raporları before()'da; Marina da ikisini girer. Önceden şubesiz sorgu iki 9 Mart satırı
    // dönüyordu (sonraki rapor yok sayılıyordu): Marina personeli kilitli düne onaysız yazıyordu
    await marina(() => report(YESTERDAY));
    await marina(() => report(TODAY));
    await refused(
      marina(() => core.addWaste(db, users.ayse, item({ date: YESTERDAY }), NOW)),
      /kasa raporu girilene kadar/,
    );
    const asked = await marina(() => late(users.ayse, { date: YESTERDAY, qty: 7 }));
    assert.equal(asked.payload.branchId, "marina");
    const [own] = await db
      .insert(s.wasteEntries)
      .values({ date: YESTERDAY, kind: "zayi", productId: latte, name: `Latte ${tag} M`, qty: 1, unit: "adet", branchId: "marina", createdBy: users.ayse.id, createdByName: "Ayşe" })
      .returning({ id: s.wasteEntries.id });
    await refused(core.removeWaste(db, users.ayse, own.id, NOW), /silinmesini isteyin/);

    // 2) Yalnız Tuzla 10 ve 11 Nisan'ı girdi, Marina 10 Nisan'ı unuttu: Marina'nın dünü açık (önceden Tuzla'nın iki
    // raporu Marina'nın dününü kapatıyor, personel geç kayıt isteğine itiliyordu)
    const now = tr("2029-04-11T12:00");
    const y = "2029-04-10";
    await report(y);
    await report("2029-04-11");
    const added = await marina(() => core.addWaste(db, users.ayse, item({ date: y, qty: 1 }), now));
    assert.equal((await db.select().from(s.wasteEntries).where(eq(s.wasteEntries.id, added.id)))[0].branchId, "marina");
    await refused(
      marina(() => late(users.ayse, { date: y }, now)),
      WASTE_REQUEST_TEXT.useDirect,
    );
    // Silmede kilit kaydın kendi şubesinin: Marina'nın kaydı doğrudan silinir, aynı personelin Tuzla kaydı (Tuzla'nın
    // dünü kilitli) seçim Marina'dayken de istenir
    await marina(() => core.removeWaste(db, users.ayse, added.id, now));
    const [tuzlaRow] = await db
      .insert(s.wasteEntries)
      .values({ date: y, kind: "zayi", productId: latte, name: `Latte ${tag} M`, qty: 1, unit: "adet", branchId: "tuzla", createdBy: users.ayse.id, createdByName: "Ayşe" })
      .returning({ id: s.wasteEntries.id });
    await refused(
      marina(() => core.removeWaste(db, users.ayse, tuzlaRow.id, now)),
      /silinmesini isteyin/,
    );
    assert.equal((await core.proposeWasteDelete(db, users.ayse, { id: tuzlaRow.id, message: "Yanlış girildi", clientKey: key() }, now)).row.kind, "zayi-sil");
    // Tuzla'nın da kendi dünü: Tuzla kapsamında doğrudan yazılmaz
    await refused(core.addWaste(db, users.ayse, item({ date: y }), now), /kasa raporu girilene kadar/);
  });

  test("Onaylar › Zayi kartı bağlamı isteğin şubesinden: rapor, Z ödenmez, o günün kayıtları, bekleyen istekler, kayıtlı ikram (denetim 21 Kasım #28)", async () => {
    const D = "2029-02-26";
    // Tuzla'nın raporu var ve gönderildi (Z ödenmez 450); Marina'nın raporu yok
    await report(D);
    await db
      .update(s.cashReports)
      .set({ offRevenue: 450, emailedAt: new Date(Date.now() + 3600_000) })
      .where(and(eq(s.cashReports.date, D), eq(s.cashReports.branchId, "tuzla")));
    // Kayıtlı ürün ikramı: Tuzla 3, Marina 1 (menü fiyatı 205)
    const entry = (branchId: string, qty: number, by: Who) =>
      db
        .insert(s.wasteEntries)
        .values({ date: D, kind: "ikram", productId: latte, name: `Latte ${tag} M`, qty, unit: "adet", branchId, createdBy: by.id, createdByName: by.name })
        .returning({ id: s.wasteEntries.id })
        .then((r) => r[0].id);
    const tuzlaEntry = await entry("tuzla", 3, users.mehmet);
    const marinaEntry = await entry("marina", 1, users.mehmet);
    // Aynı gün ve kalem için iki şubeden geç ikram isteği, iki şubenin kaydına silme isteği
    const ikram = { date: D, kind: "ikram" as const, qty: 2, reason: "Müşteri" };
    const marinaLate = await withBranchScope("marina", () => late(users.ayse, ikram));
    const tuzlaLate = await late(users.mehmet, ikram);
    const marinaDel = await askDelete(users.ayse, marinaEntry);
    const tuzlaDel = await askDelete(users.ayse, tuzlaEntry);

    const scopes: string[] = [];
    const cards = await wasteRequests.loadWasteRequestQueue(async (b) => {
      scopes.push(b);
      return createModel(await dataset.loadDataset({ scope: b }));
    }, NOW);
    assert.deepEqual(scopes.sort(), ["marina", "tuzla"], "şube başına bir model");
    const card = (id: number) => cards.find((c) => c.id === id)!;
    const m = card(marinaLate.row.id);
    const t = card(tuzlaLate.row.id);
    assert.ok(m.kind === "zayi-gec" && t.kind === "zayi-gec");
    // Marina: rapor yok (önceden Tuzla'nın raporu, Z ödenmezi ve "gönderilmiş" yazıyordu), yalnız kendi kaydı ve ikramı
    assert.deepEqual(m.branch, { id: "marina", name: "Marina" });
    assert.deepEqual(m.report, { exists: false, emailed: false, offRevenue: null });
    assert.equal(m.sameDay.length, 1);
    assert.deepEqual(m.otherPending, [], "Tuzla'nın isteği Marina'nın kartında sayılmaz");
    assert.equal(m.ikramRecorded, 205);
    assert.equal(m.ikramFromLafpos, false);
    // Tuzla: kendi raporu, kendi kaydı ve ikramı
    assert.deepEqual(t.branch, { id: "tuzla", name: "Tuzla" });
    assert.deepEqual(t.report, { exists: true, emailed: true, offRevenue: 450 });
    assert.equal(t.sameDay.length, 1);
    assert.deepEqual(t.otherPending, []);
    assert.equal(t.ikramRecorded, 615);
    // Silme: kasa e-postası uyarısı kaydın şubesinin raporundan (Marina'nın raporu yok)
    const md = card(marinaDel.row.id);
    const td = card(tuzlaDel.row.id);
    assert.ok(md.kind === "zayi-sil" && td.kind === "zayi-sil");
    assert.equal(md.inReportMail, false);
    assert.deepEqual(md.branch, { id: "marina", name: "Marina" });
    assert.equal(td.inReportMail, true);
    assert.deepEqual(td.branch, { id: "tuzla", name: "Tuzla" });
  });

  test("müdür Onaylar › Zayi kartında malzeme maliyetini almaz; yalnız şubesinin kartları (bulgu 4)", async () => {
    // İki şubeden birer geç zayi isteği (ayrı gün: konu ve kart ayrı) ve kaydı sonradan giden bir silme isteği (şubesi
    // bilinmeyen kart)
    const tuzla = await late(users.fatma);
    const marina = await withBranchScope("marina", () => late(users.fatma, { date: "2029-03-02" }));
    const [goneRow] = await db
      .insert(s.wasteEntries)
      .values({ date: "2029-03-03", kind: "zayi", productId: latte, name: `Latte ${tag} M`, qty: 1, unit: "adet", branchId: "tuzla", createdBy: users.mehmet.id, createdByName: "Mehmet" })
      .returning({ id: s.wasteEntries.id });
    const gone = await askDelete(users.fatma, goneRow.id);
    await db.delete(s.wasteEntries).where(eq(s.wasteEntries.id, goneRow.id));
    const ids = [tuzla.row.id, marina.row.id, gone.row.id];

    const cards = await wasteRequests.loadWasteRequestQueue(async (b) => createModel(await dataset.loadDataset({ scope: b })), NOW);
    const mine = cards.filter((c) => ids.includes(c.id));
    assert.equal(mine.length, 3, "üç kart da kuyrukta");
    assert.equal(mine.find((c) => c.id === gone.row.id)?.branchId, null, "kaydı giden silme isteğinin şubesi bilinmiyor");

    // Müdür (Tuzla): yalnız şubesinin kartı; malzeme maliyeti anahtarı yok (RSC yüküne giden bu), bağlam ve menü değeri kalır
    const m = wasteRequests.wasteCardsFor({ role: "manager", branchId: "tuzla" }, mine);
    assert.deepEqual(
      m.map((c) => c.id),
      [tuzla.row.id],
      "öteki şubenin ve şubesi bilinmeyen kart müdüre gitmez",
    );
    for (const c of m) {
      assert.ok(c.kind === "zayi-gec", "geç kayıt kartı");
      assert.ok(!("cost" in c), "müdürün kartında malzeme maliyeti yok");
      assert.ok("menuValue" in c && "report" in c && "sameDay" in c, "menü değeri ve günün bağlamı kalır");
      assert.equal(c.branchId, "tuzla");
    }
    assertNoCostKeys(JSON.stringify(m), "müdürün zayi kartları");
    // Kuyruğun kendisi değişmez (süzme kopya üzerinde)
    const source = mine.find((c) => c.id === tuzla.row.id);
    assert.ok(source?.kind === "zayi-gec" && typeof source.cost === "number", "kaynak kart maliyetini korur");
    // Öteki şubenin müdürü yalnız kendi şubesininkini alır, o da maliyetsiz
    const mm = wasteRequests.wasteCardsFor({ role: "manager", branchId: "marina" }, mine);
    assert.deepEqual(
      mm.map((c) => c.id),
      [marina.row.id],
    );
    assertNoCostKeys(JSON.stringify(mm), "Marina müdürünün zayi kartları");

    // Yönetici: üç kart, geç kayıtta malzeme maliyetiyle (latte'nin reçetesi yok: değer 0, anahtar var)
    const a = wasteRequests.wasteCardsFor({ role: "admin", branchId: null }, mine);
    assert.deepEqual(
      a.map((c) => c.id).sort((x, y) => x - y),
      [...ids].sort((x, y) => x - y),
    );
    for (const c of a) if (c.kind === "zayi-gec") assert.equal(typeof c.cost, "number", "yöneticinin kartında malzeme maliyeti var");
  });
});
