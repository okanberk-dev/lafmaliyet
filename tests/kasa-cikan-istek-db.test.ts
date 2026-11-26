// Kasadan çıkan istekleri ve fotoğraf kaldırma, gerçek Postgres'te (plan docs/planlar/personel-yetki.md §2.7;
// docs/KASA-RAPORU.md › Kasadan çıkan: kapanmış gün, yöneticinin satırı): kilitli güne ekleme yalnız istek yazar ve fişi
// tutar; tutulan fiş ikinci istekte ve doğrudan kayıtta reddedilir; onay satırı isteyenin adıyla, gideri ve fişin bağını
// yazar; ret fişi 7 gün tutar; istekten sonra değişen satır yalnız "Yine de uygula" ile; fotoğrafsız satır fişli
// onaylanmaz; açık günde yöneticinin kategorisindeki satır istek olur; fotoğrafsız satıra fiş onaysız eklenir; 11. açık
// istek reddedilir; kimse kendi isteğini onaylayamaz; fotoğraf kaldırma raporu bırakır, okuma farkını döner, okuma farkı
// varken ve raporun tek Z fotoğrafında istek açılmaz.
//
// Kendi kullanıcılarını, kategorilerini, raporlarını, satırlarını, fotoğraflarını ve isteklerini açar, sonunda siler.
// Günler 2028'de: öteki veritabanı testlerinin raporları (2030 ve sonrası) bu günlere "sonraki rapor" sayılır, bu yüzden
// açık gün senaryoları raporsuz günlerde, kilitli gün senaryoları iki raporla kurulur.
//
// KASA_ISTEK_TEST_DATABASE_URL verilmezse atlanır (migration'ları uygulanmış bir yerel veritabanı).
// Çalıştırma: KASA_ISTEK_TEST_DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_yetki npx tsx --test tests/kasa-cikan-istek-db.test.ts

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { and, eq, inArray } from "drizzle-orm";

import type { CashReportFields } from "../src/lib/cash-report";
import { CASH_OUT_REQUEST_TEXT, type CashOutLineT } from "../src/lib/cash-out-requests";
import { REQUEST_TEXT } from "../src/lib/staff-requests";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { UserError } from "../src/server/user-error";

import { raceOnRequest } from "./helpers/lock-race";

const URL = process.env.KASA_ISTEK_TEST_DATABASE_URL;
/** Türkiye saatiyle an */
const tr = (local: string) => new Date(`${local}:00+03:00`);
const DAY_MS = 86_400_000;

describe("Kasadan çıkan istekleri: veritabanında istek, karar, fiş ve fotoğraf kaldırma", { skip: !URL && "KASA_ISTEK_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  let store: typeof import("../src/server/cash/report-store");
  let reqs: typeof import("../src/server/cash-outs/requests");
  let write: typeof import("../src/server/cash-outs/write");
  let guard: typeof import("../src/server/cash-outs/guard");
  const tag = `${process.pid}-${randomBytes(3).toString("hex")}`;
  type Who = { id: number; name: string; role: "admin" | "staff" };
  const users: Record<"ali" | "ayse" | "mehmet" | "donen" | "zeynep" | "fatma", Who> = {
    ali: { id: 0, name: "Ali", role: "admin" },
    ayse: { id: 0, name: "Ayşe", role: "staff" },
    mehmet: { id: 0, name: "Mehmet", role: "staff" },
    donen: { id: 0, name: "Dönen", role: "staff" },
    // Şube testinin personeli (öteki testlerin açık istek sınırına takılmasın)
    zeynep: { id: 0, name: "Zeynep", role: "staff" },
    // Müdür testinin personeli
    fatma: { id: 0, name: "Fatma", role: "staff" },
  };
  /** Müdür (docs/ROLLER.md): çekirdeğe "admin" düzeyinde girer, gerçek rolü `realRole` (src/lib/roles.ts › asActor) */
  const mudur = { id: 0, name: "Müdür", role: "admin" as const, realRole: "manager" as const };
  const cats = { staff: 0, admin: 0 };
  const dates: string[] = [];
  const photoIds: number[] = [];
  const outIds: number[] = [];
  /** Marina'yı bu test açtıysa sonunda siler (şube testi) */
  let marinaAdded = false;

  // Kilitli dün: 9 Mart'ın ve 10 Mart'ın raporu var (9 Mart kapandı); eski gün 5 Mart (raporsuz)
  const NOW = tr("2028-03-10T12:00");
  const TODAY = "2028-03-10";
  const YESTERDAY = "2028-03-09";
  const OLD = "2028-03-05";
  // Açık gün: 10 Haziran, hiç rapor yok
  const OPEN_NOW = tr("2028-06-10T12:00");
  const OPEN_DAY = "2028-06-10";

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
    note: "deneme",
    ...o,
    discounts: o.discounts ?? null,
  });
  async function report(date: string, o: Partial<CashReportFields> = {}) {
    if (!dates.includes(date)) dates.push(date);
    const r = await store.saveCashReport(db, users.ali, { ...fields(date, o), countedBy: null, revision: 0, photos: [] }, tr(`${date}T22:00`));
    assert.equal(r.kind, "saved");
    return r.kind === "saved" ? r.row : (null as never);
  }
  /** Bağlanmamış, süresi dolmamış fotoğraf (yeni yüklenmiş gibi) */
  async function photo(by: Who, kind: "kasa-z" | "kasa-pos" | "fis" = "fis") {
    const [p] = await db
      .insert(s.photos)
      .values({ kind, storageKey: `test/2028/${randomUUID()}.jpg`, contentType: "image/jpeg", sizeBytes: 100, createdBy: by.id, createdByName: by.name, expiresAt: new Date("2100-01-01T00:00:00Z") })
      .returning({ id: s.photos.id });
    photoIds.push(p.id);
    return p.id;
  }
  const photoOf = async (id: number) => (await db.select().from(s.photos).where(eq(s.photos.id, id)))[0];
  const outOf = async (id: number) => (await db.select().from(s.cashOuts).where(eq(s.cashOuts.id, id)))[0];
  const expenseOf = async (cashOutId: number) => (await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.cashOutId, cashOutId)))[0];
  const requestOf = async (id: number) => (await db.select().from(s.staffRequests).where(eq(s.staffRequests.id, id)))[0];
  const refused = async (p: Promise<unknown>, text: string | RegExp) => {
    await assert.rejects(p, (e: unknown) => e instanceof UserError && (typeof text === "string" ? e.message === text : text.test(e.message)));
  };
  const line = (o: Partial<CashOutLineT> = {}): CashOutLineT => ({
    kind: "harcama",
    amount: 412.5,
    store: "Migros",
    description: "süt",
    receiptDate: null,
    receiptNo: null,
    vat: null,
    docType: "yok",
    categoryId: cats.staff,
    photoId: null,
    ...o,
  });
  /** Yöneticinin doğrudan satırı (isteğe bağlı harcama kaydıyla) */
  async function adminRow(date: string, o: { amount?: number; categoryId?: number | null; photoId?: number | null } = {}) {
    const out = await db.transaction((tx) =>
      write.writeCashOut(tx, users.ali, {
        id: null,
        date,
        kind: "harcama",
        amount: o.amount ?? 400,
        store: "Bim",
        description: "buz",
        receiptDate: null,
        receiptNo: null,
        vat: null,
        docType: o.photoId ? "fis" : "yok",
        categoryId: o.categoryId === undefined ? cats.staff : o.categoryId,
        toExpenses: o.categoryId !== null,
        photoId: o.photoId ?? null,
      }),
    );
    outIds.push(out.id);
    return out.id;
  }
  const propose = (who: Who, input: Partial<Parameters<typeof reqs.proposeCashOutChange>[2]>, now = NOW) =>
    reqs.proposeCashOutChange(db, who, { op: "ekle", date: null, cashOutId: null, line: null, message: null, clientKey: null, ...input }, now);
  const review = (who: Who, id: number, seenVersion: number, decision: "approve" | "reject", o: { force?: boolean; categoryId?: number | null; toExpenses?: boolean | null } = {}, now = NOW) =>
    reqs.reviewCashOutRequestCore(db, who, { id, seenVersion, decision, note: null, ...o }, now);
  const key = () => `k-${randomBytes(6).toString("hex")}`;

  before(async () => {
    process.env.DATABASE_URL = URL;
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır: test aynı modülleri doğrudan çalıştırır
    const require = createRequire(import.meta.url);
    const marker = require.resolve("server-only");
    require.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as unknown as NodeJS.Module;
    const dbModule = await import("../src/server/db");
    db = dbModule.createDb(URL!, 4);
    store = await import("../src/server/cash/report-store");
    reqs = await import("../src/server/cash-outs/requests");
    write = await import("../src/server/cash-outs/write");
    guard = await import("../src/server/cash-outs/guard");
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db
        .insert(s.users)
        .values({ email: `kasa-cikan-${k}-${tag}@ornek.com`, name: users[k].name, passwordHash: "x", role: users[k].role })
        .returning({ id: s.users.id });
      users[k].id = u.id;
    }
    const [m] = await db
      .insert(s.users)
      .values({ email: `kasa-cikan-mudur-${tag}@ornek.com`, name: mudur.name, passwordHash: "x", role: "manager", branchId: "tuzla" })
      .returning({ id: s.users.id });
    mudur.id = m.id;
    const [a] = await db.insert(s.expenseCategories).values({ name: `Test market ${tag}`, section: "mal", panelGroup: "diger" }).returning({ id: s.expenseCategories.id });
    const [b] = await db.insert(s.expenseCategories).values({ name: `Test avans ${tag}`, section: "personel", panelGroup: "personel" }).returning({ id: s.expenseCategories.id });
    cats.staff = a.id;
    cats.admin = b.id;
    await report(YESTERDAY);
    await report(TODAY);
  });

  after(async () => {
    if (!db) return;
    const ids = [...Object.values(users).map((u) => u.id), mudur.id];
    await db.delete(s.staffRequests).where(inArray(s.staffRequests.requestedBy, ids));
    const outs = await db.select({ id: s.cashOuts.id }).from(s.cashOuts).where(inArray(s.cashOuts.date, [TODAY, YESTERDAY, OLD, OPEN_DAY]));
    const all = [...new Set([...outIds, ...outs.map((o) => o.id)])];
    if (all.length) {
      await db.delete(s.expenseEntries).where(inArray(s.expenseEntries.cashOutId, all));
      await db.delete(s.cashOuts).where(inArray(s.cashOuts.id, all));
    }
    if (dates.length) await db.delete(s.cashReports).where(inArray(s.cashReports.date, dates));
    if (photoIds.length) {
      await db.delete(s.aiCalls).where(inArray(s.aiCalls.photoId, photoIds));
      await db.delete(s.photos).where(inArray(s.photos.id, photoIds));
    }
    await db.delete(s.expenseCategories).where(inArray(s.expenseCategories.id, [cats.staff, cats.admin]));
    await db.delete(s.users).where(inArray(s.users.id, ids));
    if (marinaAdded) await db.delete(s.branches).where(eq(s.branches.id, "marina"));
    await db.$client.end();
    const { getDb } = await import("../src/server/db");
    await getDb().$client.end();
  });

  test("kilitli güne ekleme yalnız istek yazar, fişi tutar; tutulan fiş ikinci istekte ve doğrudan kayıtta reddedilir", async () => {
    const before = await db.select({ id: s.cashOuts.id }).from(s.cashOuts).where(eq(s.cashOuts.date, YESTERDAY));
    const p = await photo(users.ayse);
    const out = await propose(users.ayse, { date: YESTERDAY, line: line({ photoId: p, docType: "fis" }), message: "Akşam unutuldu", clientKey: key() });
    assert.equal(out.created, true);
    assert.equal(out.row.kind, "kasa-cikan");
    assert.equal(out.row.status, "pending");
    assert.deepEqual(out.row.photoIds, [p]);
    assert.equal(out.row.title.replace(/ /g, " "), "9 Mart kasadan çıkan ekleme");
    // 14 günlük ömür
    assert.equal(out.row.expiresAt?.getTime(), NOW.getTime() + 14 * DAY_MS);
    // Satır yazılmadı, fiş bağlanmadı ama süresi kalktı (istek beklerken silinmez)
    const after = await db.select({ id: s.cashOuts.id }).from(s.cashOuts).where(eq(s.cashOuts.date, YESTERDAY));
    assert.equal(after.length, before.length);
    const held = await photoOf(p);
    assert.equal(held.linkedAt, null);
    assert.equal(held.expiresAt, null);
    // Aynı fiş ikinci bir istekte ve doğrudan bir kayıtta kullanılamaz
    await refused(propose(users.ayse, { date: OLD, line: line({ photoId: p, docType: "fis" }), clientKey: key() }), REQUEST_TEXT.held);
    await refused(
      db.transaction((tx) =>
        write.writeCashOut(tx, users.ayse, { id: null, date: OPEN_DAY, kind: "harcama", amount: 50, store: null, description: "buz", receiptDate: null, receiptNo: null, vat: null, docType: "fis", categoryId: cats.staff, toExpenses: true, photoId: p }),
      ),
      REQUEST_TEXT.held,
    );
    // Açık günde ekleme istek olmaz (doğrudan yazılır); pencere dışı gün kapalı
    await refused(propose(users.ayse, { date: OPEN_DAY, line: line(), clientKey: key() }, OPEN_NOW), CASH_OUT_REQUEST_TEXT.direct);
    await refused(propose(users.ayse, { date: "2028-03-02", line: line(), clientKey: key() }), CASH_OUT_REQUEST_TEXT.window);
    // Personel kategorisi dışı öneri reddedilir
    await refused(propose(users.ayse, { date: OLD, line: line({ categoryId: cats.admin }), clientKey: key() }), CASH_OUT_REQUEST_TEXT.category);
  });

  test("onay satırı isteyenin adıyla, gideri yöneticinin seçtiği kategoriyle ve fişin bağını yazar; rapor değişmez", async () => {
    const p = await photo(users.ayse);
    const reportBefore = (await db.select().from(s.cashReports).where(eq(s.cashReports.date, YESTERDAY)))[0];
    const out = await propose(users.ayse, { date: YESTERDAY, line: line({ amount: 88.4, photoId: p, docType: "fis" }), clientKey: key() });
    const r = await review(users.ali, out.row.id, out.row.version, "approve", { toExpenses: true, categoryId: cats.admin });
    assert.equal(r.status, "approved");
    assert.ok(r.status === "approved" && r.op === "ekle");
    const row = await outOf(r.cashOutId);
    outIds.push(row.id);
    assert.equal(row.date, YESTERDAY);
    assert.equal(row.amount, 88.4);
    assert.equal(row.createdBy, users.ayse.id);
    assert.equal(row.createdByName, "Ayşe");
    assert.equal(row.photoId, p);
    const e = await expenseOf(row.id);
    assert.equal(e?.categoryId, cats.admin);
    assert.equal(e?.photoId, p);
    const linked = await photoOf(p);
    assert.notEqual(linked.linkedAt, null);
    const req = await requestOf(out.row.id);
    assert.equal(req.status, "approved");
    assert.equal(req.resultId, row.id);
    assert.equal(req.reviewedByName, "Ali");
    const reportAfter = (await db.select().from(s.cashReports).where(eq(s.cashReports.date, YESTERDAY)))[0];
    assert.equal(reportAfter.revision, reportBefore.revision);
    assert.equal(reportAfter.cashOut, reportBefore.cashOut);
  });

  test("ret fişi 7 gün tutar; aynı anahtarla tekrar reddedilir, fişi yeniden tutmaz; eski güne ekleme isteği de onaylanabilir", async () => {
    const p = await photo(users.ayse);
    const k = key();
    const out = await propose(users.ayse, { date: OLD, line: line({ photoId: p, docType: "fis" }), clientKey: k });
    // Çift dokunuş (istek beklerken): aynı satır döner
    const twice = await propose(users.ayse, { date: OLD, line: line({ photoId: p, docType: "fis" }), clientKey: k });
    assert.equal(twice.row.id, out.row.id);
    assert.equal(twice.created, false);
    const r = await review(users.ali, out.row.id, out.row.version, "reject");
    assert.equal(r.status, "rejected");
    const released = await photoOf(p);
    assert.equal(released.linkedAt, null);
    assert.equal(released.expiresAt?.getTime(), NOW.getTime() + 7 * DAY_MS);
    // Eski sayfadan aynı anahtarla tekrar: "Onaya gönderildi" denmez, fiş süresiz tutulmaz
    await refused(propose(users.ayse, { date: OLD, line: line({ photoId: p, docType: "fis" }), clientKey: k }), REQUEST_TEXT.keyClosed);
    assert.equal((await photoOf(p)).expiresAt?.getTime(), NOW.getTime() + 7 * DAY_MS);
    assert.equal((await requestOf(out.row.id)).status, "rejected");
    const out2 = await propose(users.ayse, { date: OLD, line: line({ amount: 30 }), clientKey: key() });
    const r2 = await review(users.ali, out2.row.id, out2.row.version, "approve");
    assert.ok(r2.status === "approved" && r2.op === "ekle");
    outIds.push(r2.cashOutId);
    // Önerilen kategori (personelin) varsayılan; fişsiz alışveriş kurala göre harcamaya yazılır
    assert.equal((await expenseOf(r2.cashOutId))?.categoryId, cats.staff);
  });

  test("istekten sonra değişen satır yalnız 'Yine de uygula' ile; fotoğrafsız satır fişli onaylanmaz", async () => {
    const id = await adminRow(YESTERDAY, { amount: 400 });
    const g = await db.transaction(async (tx) => guard.staffCashOutGate(tx, users.ayse, { op: "duzelt", row: (await write.lockCashOut(tx, id))! }, NOW));
    assert.equal(g, "request");
    const out = await propose(users.ayse, { op: "duzelt", cashOutId: id, line: line({ amount: 412.5, store: "Bim", description: "buz" }), clientKey: key() });
    assert.equal(out.payload.before?.amount, 400);
    // Değiştirmeyen öneri reddedilir; kategori değiştirme isteği açılmaz
    await refused(propose(users.ayse, { op: "duzelt", cashOutId: id, line: line({ amount: 400, store: "Bim", description: "buz" }), clientKey: key() }), CASH_OUT_REQUEST_TEXT.noChange);
    await refused(propose(users.ayse, { op: "duzelt", cashOutId: id, line: line({ amount: 401, store: "Bim", description: "buz", categoryId: cats.admin }), clientKey: key() }), CASH_OUT_REQUEST_TEXT.categoryChange);
    // Yönetici arada satırı düzeltir
    await db.transaction((tx) =>
      write.writeCashOut(tx, users.ali, { id, date: YESTERDAY, kind: "harcama", amount: 405, store: "Bim", description: "buz", receiptDate: null, receiptNo: null, vat: null, docType: "yok", categoryId: cats.staff, toExpenses: true, photoId: null }),
    );
    await refused(review(users.ali, out.row.id, out.row.version, "approve"), CASH_OUT_REQUEST_TEXT.changed);
    const r = await review(users.ali, out.row.id, out.row.version, "approve", { force: true });
    assert.ok(r.status === "approved" && r.op === "duzelt");
    assert.equal((await outOf(id)).amount, 412.5);
    assert.equal((await expenseOf(id))?.amount, 412.5);

    // Belgeyi "fiş"e çeviren düzeltme fotoğrafsız satırda onaylanmaz
    const out2 = await propose(users.ayse, { op: "duzelt", cashOutId: id, line: line({ amount: 412.5, store: "Bim", description: "buz", docType: "fis" }), clientKey: key() });
    await refused(review(users.ali, out2.row.id, out2.row.version, "approve"), CASH_OUT_REQUEST_TEXT.receiptMissing);
    await review(users.ali, out2.row.id, out2.row.version, "reject");
  });

  test("silme isteği onayda satırı ve gideri siler; satırın öteki bekleyen istekleri kapanır", async () => {
    const id = await adminRow(YESTERDAY, { amount: 75 });
    const del = await propose(users.ayse, { op: "sil", cashOutId: id, clientKey: key() });
    const fix = await propose(users.mehmet, { op: "duzelt", cashOutId: id, line: line({ amount: 80, store: "Bim", description: "buz" }), clientKey: key() });
    const r = await review(users.ali, del.row.id, del.row.version, "approve");
    assert.ok(r.status === "approved" && r.op === "sil");
    assert.equal(await outOf(id), undefined);
    assert.equal(await expenseOf(id), undefined);
    assert.equal((await requestOf(fix.row.id)).status, "superseded");
  });

  test("tedarikçi ödemesine bağlı satır: personel istek açamaz; istekten sonra bağlanan satırın isteği onaylanmaz", async () => {
    const { CARI_LOCKED_STAFF } = await import("../src/server/cari/kasa");
    const [sup] = await db.insert(s.suppliers).values({ name: `Test tedarikçi ${tag}`, key: `test-tedarikci-${tag}` }).returning({ id: s.suppliers.id });
    const link = (cashOutId: number, amount: number) =>
      db.insert(s.supplierEntries).values({ supplierId: sup.id, kind: "odeme", date: YESTERDAY, amount, method: "kasa", cashOutId, createdByName: "Ali" });
    try {
      // Bağlı satır: düzeltme ve silme isteği açılmaz (kapanmış günde de), mesaj tutar ve tedarikçi söylemez
      const linked = await adminRow(YESTERDAY, { amount: 300, categoryId: null });
      await link(linked, 300);
      await refused(propose(users.ayse, { op: "sil", cashOutId: linked, clientKey: key() }), CARI_LOCKED_STAFF);
      await refused(propose(users.ayse, { op: "duzelt", cashOutId: linked, line: line({ amount: 310, categoryId: null }), clientKey: key() }), CARI_LOCKED_STAFF);
      // İstek açıldıktan sonra bağlanan satır: onay satırı silmez, istek bekler (yönetici reddeder)
      const later = await adminRow(YESTERDAY, { amount: 320, categoryId: null });
      const del = await propose(users.ayse, { op: "sil", cashOutId: later, clientKey: key() });
      await link(later, 320);
      await refused(review(users.ali, del.row.id, del.row.version, "approve"), /tedarikçi ödemesine bağlandı/);
      assert.ok(await outOf(later));
      assert.equal((await requestOf(del.row.id)).status, "pending");
      const r = await review(users.ali, del.row.id, del.row.version, "reject");
      assert.equal(r.status, "rejected");
    } finally {
      await db.delete(s.supplierEntries).where(eq(s.supplierEntries.supplierId, sup.id));
      await db.delete(s.suppliers).where(eq(s.suppliers.id, sup.id));
    }
  });

  test("açık günde yöneticinin kategorisindeki satır: her değişiklik ve silme istek olur; fiş ekleme onaysız", async () => {
    const id = await adminRow(OPEN_DAY, { amount: 1_500, categoryId: cats.admin });
    const row = (await outOf(id))!;
    const gate = (op: "duzelt" | "sil" | "fis") => db.transaction((tx) => guard.staffCashOutGate(tx, users.ayse, { op, row }, OPEN_NOW));
    assert.equal(await gate("duzelt"), "request");
    assert.equal(await gate("sil"), "request");
    assert.equal(await gate("fis"), "direct");
    // Yöneticinin kategorisinde olmayan satır açık günde doğrudan
    const plain = await adminRow(OPEN_DAY, { amount: 20 });
    assert.equal(await db.transaction(async (tx) => guard.staffCashOutGate(tx, users.ayse, { op: "duzelt", row: (await outOf(plain))! }, OPEN_NOW)), "direct");
    const out = await propose(users.ayse, { op: "duzelt", cashOutId: id, line: line({ amount: 1_450, store: "Bim", description: "buz", categoryId: null }), clientKey: key() }, OPEN_NOW);
    assert.equal(out.created, true);
    // Personelin görünümünde kategori ve önceki hâl yok; çekirdeğin yükünde var (yalnız yöneticinin kartı okur)
    assert.equal(out.payload.before?.categoryId, cats.admin);
    assert.equal(out.payload.line?.categoryId, cats.admin);
    await review(users.ali, out.row.id, out.row.version, "reject", {}, OPEN_NOW);

    // Fiş ekleme: tutar, tür ve kategori değişmez; belge türü fiş olur, bağlı gider de fişi alır
    const p = await photo(users.ayse);
    await reqs.attachCashOutReceiptCore(db, users.ayse, { cashOutId: id, photoId: p }, OPEN_NOW);
    const after = await outOf(id);
    assert.equal(after.photoId, p);
    assert.equal(after.docType, "fis");
    assert.equal(after.amount, 1_500);
    const e = await expenseOf(id);
    assert.equal(e?.categoryId, cats.admin);
    assert.equal(e?.photoId, p);
    assert.notEqual((await photoOf(p)).linkedAt, null);
    // Fotoğraflı satıra ikinci fiş eklenmez; başkasının fotoğrafı bağlanmaz
    await refused(reqs.attachCashOutReceiptCore(db, users.ayse, { cashOutId: id, photoId: await photo(users.ayse) }, OPEN_NOW), CASH_OUT_REQUEST_TEXT.receiptOnly);
    await refused(reqs.attachCashOutReceiptCore(db, users.ayse, { cashOutId: plain, photoId: await photo(users.mehmet) }, OPEN_NOW), /Fotoğraf bulunamadı/);
    // Kilitli dünde de onaysız; eski günde kapalı
    const locked = await adminRow(YESTERDAY, { amount: 12 });
    const p2 = await photo(users.ayse);
    await reqs.attachCashOutReceiptCore(db, users.ayse, { cashOutId: locked, photoId: p2 }, NOW);
    assert.equal((await outOf(locked)).photoId, p2);
    const old = await adminRow(OLD, { amount: 13 });
    await refused(reqs.attachCashOutReceiptCore(db, users.ayse, { cashOutId: old, photoId: await photo(users.ayse) }, NOW), CASH_OUT_REQUEST_TEXT.receiptDay);
  });

  test("11. açık istek reddedilir; kimse kendi isteğini onaylayamaz (sonradan yönetici yapılan hesap da)", async () => {
    for (let i = 0; i < 10; i++) await propose(users.mehmet, { date: OLD, line: line({ amount: 10 + i }), clientKey: key() });
    await refused(propose(users.mehmet, { date: OLD, line: line({ amount: 99 }), clientKey: key() }), /Onay bekleyen 10 isteğiniz var/);
    // Aynı istemci anahtarı yeni satır açmaz
    const k = key();
    const a = await propose(users.donen, { date: OLD, line: line({ amount: 5 }), clientKey: k });
    const b = await propose(users.donen, { date: OLD, line: line({ amount: 5 }), clientKey: k });
    assert.equal(b.row.id, a.row.id);
    assert.equal(b.created, false);
    await db.update(s.users).set({ role: "admin" }).where(eq(s.users.id, users.donen.id));
    await refused(review({ ...users.donen, role: "admin" }, a.row.id, a.row.version, "approve"), REQUEST_TEXT.self);
    // Yönetici istek açamaz
    await refused(propose(users.ali, { date: OLD, line: line(), clientKey: key() }), CASH_OUT_REQUEST_TEXT.adminDirect);
  });

  test("fotoğraf kaldırma: rapor kalır, okuma farkı döner, fotoğraf 30 gün; okuma farkı ve tek Z'de istek açılmaz", async () => {
    const DAY = "2028-09-10";
    const AT = tr(`${DAY}T22:30`);
    const rep = await report(DAY, { zTotal: 10_000 });
    const [z1, z2, z3] = [await photo(users.ayse, "kasa-z"), await photo(users.ayse, "kasa-z"), await photo(users.ayse, "kasa-z")];
    for (const p of [z1, z2, z3]) {
      await db.insert(s.cashReportPhotos).values({ reportId: rep.id, photoId: p, kind: "kasa-z" });
      await db.update(s.photos).set({ linkedAt: AT, expiresAt: null }).where(eq(s.photos.id, p));
    }
    const zRead = (total: number, confidence: "high" | "medium") => ({
      documentType: "z_report",
      readable: true,
      date: DAY,
      time: null,
      zNo: null,
      receiptCount: null,
      total: { text: String(total), value: total, confidence },
      paymentLines: [],
      discounts: { text: null, value: null, confidence: "high" },
      comps: { text: null, value: null, confidence: "high" },
      refunds: { text: null, value: null, confidence: "high" },
      issues: [],
    });
    await db.insert(s.aiCalls).values([
      { feature: "kasa-z", model: "test", status: "ok", photoId: z2, result: zRead(9_000, "medium") },
      { feature: "kasa-z", model: "test", status: "ok", photoId: z3, result: zRead(9_000, "high") },
    ]);
    // Net okunmuş farklı alan: fotoğraf kanıttır
    await refused(reqs.proposePhotoRemoval(db, users.ayse, { photoId: z3, message: null, clientKey: null }, AT), CASH_OUT_REQUEST_TEXT.photoDiffs);
    // Yönetici istek açamaz; pencere dışı gün kapalı
    await refused(reqs.proposePhotoRemoval(db, users.ali, { photoId: z2, message: null, clientKey: null }, AT), CASH_OUT_REQUEST_TEXT.adminDirect);
    await refused(reqs.proposePhotoRemoval(db, users.ayse, { photoId: z2, message: null, clientKey: null }, new Date(AT.getTime() + 3 * DAY_MS)), CASH_OUT_REQUEST_TEXT.photoDay);
    const out = await reqs.proposePhotoRemoval(db, users.ayse, { photoId: z2, message: "Başka günün Z'si", clientKey: null }, AT);
    assert.equal(out.row.kind, "foto-kaldir");
    assert.equal(out.payload.reportId, rep.id);
    const r = await reqs.reviewPhotoRemovalCore(db, users.ali, { id: out.row.id, seenVersion: out.row.version, decision: "approve", note: null }, AT);
    assert.equal(r.status, "approved");
    assert.equal(r.diffs.length, 1);
    assert.match(r.diffs[0], /fotoğrafta/);
    const links = await db.select().from(s.cashReportPhotos).where(eq(s.cashReportPhotos.reportId, rep.id));
    assert.deepEqual(links.map((l) => l.photoId).sort((a, b) => a - b), [z1, z3].sort((a, b) => a - b));
    assert.ok((await db.select().from(s.cashReports).where(eq(s.cashReports.id, rep.id)))[0], "rapor yerinde");
    const kept = await photoOf(z2);
    assert.ok(kept.expiresAt && Math.abs(kept.expiresAt.getTime() - (Date.now() + 30 * DAY_MS)) < 5 * 60_000, "fotoğraf 30 gün saklanır");
    // Okuma kalır
    assert.equal((await db.select().from(s.aiCalls).where(and(eq(s.aiCalls.photoId, z2), eq(s.aiCalls.status, "ok")))).length, 1);

    // Raporun tek Z fotoğrafı kaldırılamaz
    const ONE = "2028-09-09";
    const rep2 = await report(ONE);
    const only = await photo(users.ayse, "kasa-z");
    await db.insert(s.cashReportPhotos).values({ reportId: rep2.id, photoId: only, kind: "kasa-z" });
    await refused(reqs.proposePhotoRemoval(db, users.ayse, { photoId: only, message: null, clientKey: null }, AT), CASH_OUT_REQUEST_TEXT.photoOnlyZ);
  });

  test("kilit sırası: düzeltmesini güncelleyen personel ya da satırı doğrudan silen yönetici, aynı anda verilen onayla kilitlenmez (satır, sonra istek)", async () => {
    // Personel bekleyen düzeltmesini güncellerken yönetici onaylıyor
    const id = await adminRow(YESTERDAY, { amount: 500 });
    const out = await propose(users.ayse, { op: "duzelt", cashOutId: id, line: line({ amount: 510, store: "Bim", description: "buz" }), clientKey: key() });
    const [approve, edit] = await raceOnRequest(
      URL!,
      out.row.id,
      () => review(users.ali, out.row.id, out.row.version, "approve"),
      () => propose(users.ayse, { op: "duzelt", cashOutId: id, line: line({ amount: 520, store: "Bim", description: "buz" }), clientKey: key() }),
    );
    assert.equal(approve.status, "fulfilled");
    assert.equal((await outOf(id)).amount, 510);
    // Güncelleme onaydan sonra sıraya girdi: satırın onaylanmış hâline yeni bir öneri olur
    assert.equal(edit.status, "fulfilled");
    const again = (edit as PromiseFulfilledResult<Awaited<ReturnType<typeof propose>>>).value;
    assert.notEqual(again.row.id, out.row.id);
    assert.equal(again.payload.before?.amount, 510);
    await review(users.ali, again.row.id, again.row.version, "reject");

    // Yönetici satırı doğrudan silerken (satır, sonra satırın istekleri kapanır) başka bir sekmede silme isteğini onaylıyor
    const id2 = await adminRow(YESTERDAY, { amount: 60 });
    const del = await propose(users.ayse, { op: "sil", cashOutId: id2, clientKey: key() });
    const [approve2, removed] = await raceOnRequest(
      URL!,
      del.row.id,
      () => review(users.ali, del.row.id, del.row.version, "approve"),
      () =>
        db.transaction(async (tx) => {
          const row = await write.lockCashOut(tx, id2);
          if (!row) throw new UserError("Satır bulunamadı");
          return write.removeCashOut(tx, row);
        }),
    );
    assert.equal(approve2.status, "fulfilled");
    assert.equal(removed.status, "rejected", "satır onayla silinmişti");
    assert.equal(await outOf(id2), undefined);
    assert.equal((await requestOf(del.row.id)).status, "approved");
  });

  test("kilit sırası: fotoğraf kaldırma isteğini güncelleyen personel, aynı anda verilen onayla kilitlenmez (rapor, sonra istek)", async () => {
    const DAY = "2028-09-20";
    const AT = tr(`${DAY}T22:30`);
    const rep = await report(DAY);
    // Üç Z fotoğrafı: onaydan sonra da iki tane kalır, ret "tek Z" kuralından değil bağın kilit altındaki denetiminden
    const zs = [await photo(users.ayse, "kasa-z"), await photo(users.ayse, "kasa-z"), await photo(users.ayse, "kasa-z")];
    for (const p of zs) {
      await db.insert(s.cashReportPhotos).values({ reportId: rep.id, photoId: p, kind: "kasa-z" });
      await db.update(s.photos).set({ linkedAt: AT, expiresAt: null }).where(eq(s.photos.id, p));
    }
    const out = await reqs.proposePhotoRemoval(db, users.ayse, { photoId: zs[1], message: "Başka günün Z'si", clientKey: null }, AT);
    const [approve, edit] = await raceOnRequest(
      URL!,
      out.row.id,
      () => reqs.reviewPhotoRemovalCore(db, users.ali, { id: out.row.id, seenVersion: out.row.version, decision: "approve", note: null }, AT),
      () => reqs.proposePhotoRemoval(db, users.ayse, { photoId: zs[1], message: "Yanlış fotoğraf", clientKey: null }, AT),
    );
    assert.equal(approve.status, "fulfilled");
    // Fotoğraf rapordan çıktı: güncelleme temiz bir hatayla düşer, rapora bağlı olmayan fotoğrafa yeni istek açılmaz
    assert.equal(edit.status, "rejected");
    assert.equal(((edit as PromiseRejectedResult).reason as Error).message, CASH_OUT_REQUEST_TEXT.photoNotLinked);
    const open = await db
      .select({ id: s.staffRequests.id })
      .from(s.staffRequests)
      .where(and(eq(s.staffRequests.subject, `foto:${zs[1]}`), eq(s.staffRequests.status, "pending")));
    assert.deepEqual(open, []);
    const links = await db.select().from(s.cashReportPhotos).where(eq(s.cashReportPhotos.reportId, rep.id));
    assert.deepEqual(links.map((l) => l.photoId).sort((a, b) => a - b), [zs[0], zs[2]].sort((a, b) => a - b));
  });

  test("Onaylar kartı isteğin kasasını taşır: kasadan çıkan ve fotoğraf kaldırma, birden çok kasa açıkken şubenin adı (denetim 21 Kasım #29)", async () => {
    marinaAdded =
      (await db.insert(s.branches).values({ id: "marina", name: "Marina", kind: "fiziksel", posSource: "modpos", sortOrder: 2 }).onConflictDoNothing().returning({ id: s.branches.id }))
        .length > 0;
    const { withBranchScope } = await import("../src/server/branch-scope");
    const { loadCashRequestQueue } = await import("../src/server/data/cash-requests");
    const marina = <T>(fn: () => Promise<T>) => withBranchScope("marina", fn);
    // Marina'nın eski gününe ekleme isteği (yöneticinin seçimi ne olursa olsun Marina'nın kasasına yazılacak)
    const out = await marina(() => propose(users.zeynep, { date: OLD, line: line({ amount: 77.7 }), message: "Akşam unutuldu", clientKey: key() }));
    assert.equal(out.payload.branchId, "marina");
    const tuzlaOut = await propose(users.zeynep, { date: OLD, line: line({ amount: 66.6 }), message: "Akşam unutuldu", clientKey: key() });
    // Marina'nın raporunun Z fotoğrafını kaldırma isteği
    const DAY = "2028-09-25";
    const AT = tr(`${DAY}T22:30`);
    const rep = await marina(() => report(DAY));
    assert.equal(rep.branchId, "marina");
    const zs = [await photo(users.zeynep, "kasa-z"), await photo(users.zeynep, "kasa-z")];
    for (const p of zs) {
      await db.insert(s.cashReportPhotos).values({ reportId: rep.id, photoId: p, kind: "kasa-z" });
      await db.update(s.photos).set({ linkedAt: AT, expiresAt: null }).where(eq(s.photos.id, p));
    }
    const removal = await reqs.proposePhotoRemoval(db, users.zeynep, { photoId: zs[1], message: "Başka günün Z'si", clientKey: null }, AT);

    const cards = await loadCashRequestQueue(NOW);
    const card = (id: number) => {
      const c = cards.find((x) => x.id === id);
      assert.ok(c && (c.kind === "kasa-cikan" || c.kind === "foto-kaldir"), `kart ${id}`);
      return c;
    };
    // Kart şubeyi taşır; "Günü aç" bundan `?sube=` kurar (önceden şubesizdi: yöneticinin seçili kasasını açıyordu)
    assert.equal(card(out.row.id).branchId, "marina");
    assert.deepEqual(card(out.row.id).branch, { id: "marina", name: "Marina" });
    assert.deepEqual(card(tuzlaOut.row.id).branch, { id: "tuzla", name: "Tuzla" });
    assert.equal(card(removal.row.id).kind, "foto-kaldir");
    assert.equal(card(removal.row.id).branchId, "marina");
    assert.deepEqual(card(removal.row.id).branch, { id: "marina", name: "Marina" });
  });

  test("müdür ('admin' düzeyinde) kategoride personelin kuralına bağlı: onayda ve doğrudan kayıtta yöneticinin kategorisine yazamaz, şimdikini korur", async () => {
    const ADMIN_CAT = "Bu kategoriye yalnız yönetici yazabilir";
    // Ekleme isteğinin onayı: yöneticinin kategorisi (maaş, avans) reddedilir, istek bekler; personelin kategorisiyle yazılır
    const add = await propose(users.fatma, { date: YESTERDAY, line: line({ amount: 61.5 }), clientKey: key() });
    await refused(review(mudur, add.row.id, add.row.version, "approve", { toExpenses: true, categoryId: cats.admin }), ADMIN_CAT);
    assert.equal((await requestOf(add.row.id)).status, "pending");
    const ok = await review(mudur, add.row.id, add.row.version, "approve", { toExpenses: true, categoryId: cats.staff });
    assert.ok(ok.status === "approved" && ok.op === "ekle");
    outIds.push(ok.cashOutId);
    assert.equal((await expenseOf(ok.cashOutId))?.categoryId, cats.staff);
    // Düzeltme onayı: satırı yöneticinin kategorisine taşıyamaz
    const plain = await adminRow(YESTERDAY, { amount: 30 });
    const fix = await propose(users.fatma, { op: "duzelt", cashOutId: plain, line: line({ amount: 31, store: "Bim", description: "buz" }), clientKey: key() });
    await refused(review(mudur, fix.row.id, fix.row.version, "approve", { toExpenses: true, categoryId: cats.admin }), ADMIN_CAT);
    assert.equal((await expenseOf(plain))?.categoryId, cats.staff);
    await review(mudur, fix.row.id, fix.row.version, "reject");
    // Yöneticinin kategorisindeki satırın tutarını düzeltir, kategorisi kalır (kartın "şimdiki" seçeneği: categoryId boş)
    const salary = await adminRow(YESTERDAY, { amount: 1_000, categoryId: cats.admin });
    const fix2 = await propose(users.fatma, { op: "duzelt", cashOutId: salary, line: line({ amount: 1_100, store: "Bim", description: "buz", categoryId: null }), clientKey: key() });
    const r2 = await review(mudur, fix2.row.id, fix2.row.version, "approve", { toExpenses: true, categoryId: null });
    assert.ok(r2.status === "approved" && r2.op === "duzelt");
    assert.equal((await expenseOf(salary))?.categoryId, cats.admin);
    assert.equal((await expenseOf(salary))?.amount, 1_100);
    // Doğrudan kayıt: yeni satır yöneticinin kategorisine yazılmaz; geri alma silinen kaydın kategorisini getirir
    const direct = (restore: boolean) =>
      db.transaction((tx) =>
        write.writeCashOut(
          tx,
          mudur,
          { id: null, date: OPEN_DAY, kind: "harcama", amount: 45, store: null, description: "avans", receiptDate: null, receiptNo: null, vat: null, docType: "yok", categoryId: cats.admin, toExpenses: true, photoId: null },
          { restore, branchId: "tuzla" },
        ),
      );
    await refused(direct(false), ADMIN_CAT);
    const back = await direct(true);
    outIds.push(back.id);
    assert.equal((await expenseOf(back.id))?.categoryId, cats.admin);
  });

  test("Onaylar kartı müdüre yöneticinin kategorisinin adını, öteki şubenin ve maaş kaydının olası tekrarını taşımaz (tarayıcıya giden kart)", async () => {
    marinaAdded =
      (await db.insert(s.branches).values({ id: "marina", name: "Marina", kind: "fiziksel", posSource: "modpos", sortOrder: 2 }).onConflictDoNothing().returning({ id: s.branches.id }))
        .length > 0 || marinaAdded;
    const { loadCashRequestQueue } = await import("../src/server/data/cash-requests");
    const ADMIN_NAME = `Test avans ${tag}`;
    // Bağlı gideri yöneticinin kategorisinde (maaş, avans) ve personelin kategorisinde iki satır: düzeltme ve silme isteği
    const salary = await adminRow(YESTERDAY, { amount: 2_222, categoryId: cats.admin });
    const plain = await adminRow(YESTERDAY, { amount: 33 });
    const fix = await propose(users.fatma, { op: "duzelt", cashOutId: salary, line: line({ amount: 2_300, store: "Bim", description: "buz", categoryId: null }), clientKey: key() });
    const del = await propose(users.fatma, { op: "sil", cashOutId: plain, clientKey: key() });
    // Ekleme isteğiyle aynı tutar: Tuzla'nın satırı, Marina'nın satırı, Tuzla'nın maaş kaydı ve personel kategorisindeki kaydı
    const SAME = 987.65;
    const tuzlaRow = await adminRow(YESTERDAY, { amount: SAME });
    const marinaRow = await db.transaction((tx) =>
      write.writeCashOut(
        tx,
        users.ali,
        { id: null, date: YESTERDAY, kind: "harcama", amount: SAME, store: `Marina dükkân ${tag}`, description: null, receiptDate: null, receiptNo: null, vat: null, docType: "yok", categoryId: cats.staff, toExpenses: true, photoId: null },
        { branchId: "marina" },
      ),
    );
    outIds.push(marinaRow.id);
    const entries = await db
      .insert(s.expenseEntries)
      .values([
        { branchId: "tuzla", date: YESTERDAY, categoryId: cats.admin, description: `Maaş avansı ${tag}`, amount: SAME },
        { branchId: "tuzla", date: YESTERDAY, categoryId: cats.staff, description: `Buz faturası ${tag}`, amount: SAME },
      ])
      .returning({ id: s.expenseEntries.id });
    const add = await propose(users.fatma, { date: YESTERDAY, line: line({ amount: SAME }), clientKey: key() });
    try {
      const cardIn = (cards: Awaited<ReturnType<typeof loadCashRequestQueue>>, id: number) => {
        const c = cards.find((x) => x.id === id);
        assert.ok(c && c.kind === "kasa-cikan", `kart ${id}`);
        return c;
      };
      // Müdür (Tuzla, kategori.tum yok): yöneticinin kategorisi adsız; personelinki adıyla
      const m = await loadCashRequestQueue(NOW, "tuzla", true, false);
      assert.deepEqual(cardIn(m, fix.row.id).expense, { categoryName: null, admin: true });
      assert.deepEqual(cardIn(m, del.row.id).expense, { categoryName: `Test market ${tag}`, admin: false });
      // Olası tekrar: yalnız Tuzla'nın satırı ve personel kategorisindeki kayıt
      const mDup = cardIn(m, add.row.id).context.duplicates;
      assert.equal(mDup.length, 2, mDup.join(" | "));
      assert.ok(mDup.some((d) => d.startsWith("Bim · buz · ") && d.endsWith("kasadan çıkan")), mDup.join(" | "));
      assert.ok(mDup.some((d) => d.startsWith(`Buz faturası ${tag}`)), mDup.join(" | "));
      // Tarayıcıya giden kartların hiçbirinde yöneticinin kategorisinin adı, maaş kaydı ve öteki şubenin satırı yok
      const sent = JSON.stringify(m);
      for (const secret of [ADMIN_NAME, `Maaş avansı ${tag}`, `Marina dükkân ${tag}`]) assert.ok(!sent.includes(secret), secret);
      // Yönetici: adı da, bütün şubelerin ve kategorilerin olası tekrarı da gelir
      const a = await loadCashRequestQueue(NOW);
      assert.deepEqual(cardIn(a, fix.row.id).expense, { categoryName: ADMIN_NAME, admin: true });
      const aDup = cardIn(a, add.row.id).context.duplicates;
      assert.equal(aDup.length, 4, aDup.join(" | "));
      for (const want of [`Marina dükkân ${tag}`, `Maaş avansı ${tag}`, `Buz faturası ${tag}`]) assert.ok(aDup.some((d) => d.startsWith(want)), want);
      assert.equal((await outOf(tuzlaRow)).branchId, "tuzla");
    } finally {
      for (const x of [fix, del, add]) await review(users.ali, x.row.id, x.row.version, "reject");
      await db.delete(s.expenseEntries).where(inArray(s.expenseEntries.id, entries.map((e) => e.id)));
    }
  });

  test("müdür ('admin' düzeyinde) başkasının bağsız fişini kendi satırına bağlayamaz (öteki şubenin fotoğrafı); onayladığı isteğin fişini bağlar", async () => {
    const gone = /Fotoğraf bulunamadı/;
    const foreign = await photo(users.fatma);
    // Doğrudan yeni satır
    await refused(
      db.transaction((tx) =>
        write.writeCashOut(
          tx,
          mudur,
          { id: null, date: OPEN_DAY, kind: "harcama", amount: 12, store: null, description: "buz", receiptDate: null, receiptNo: null, vat: null, docType: "fis", categoryId: cats.staff, toExpenses: true, photoId: foreign },
          { branchId: "tuzla" },
        ),
      ),
      gone,
    );
    // Fotoğrafsız satıra fiş: başkasınınki hayır, kendi yüklediği evet
    const bare = await adminRow(OPEN_DAY, { amount: 14 });
    await refused(reqs.attachCashOutReceiptCore(db, mudur, { cashOutId: bare, photoId: foreign }, OPEN_NOW), gone);
    assert.equal((await photoOf(foreign)).linkedAt, null, "fotoğraf bağlanmadı");
    const own = await photo(mudur);
    await reqs.attachCashOutReceiptCore(db, mudur, { cashOutId: bare, photoId: own }, OPEN_NOW);
    assert.equal((await outOf(bare)).photoId, own);
    // Onay: isteğin tuttuğu personel fişi bağlanır
    const held = await photo(users.fatma);
    const out = await propose(users.fatma, { date: YESTERDAY, line: line({ amount: 23, photoId: held, docType: "fis" }), clientKey: key() });
    const r = await review(mudur, out.row.id, out.row.version, "approve");
    assert.ok(r.status === "approved" && r.op === "ekle");
    outIds.push(r.cashOutId);
    assert.equal((await outOf(r.cashOutId)).photoId, held);
    assert.notEqual((await photoOf(held)).linkedAt, null);
  });
});
