// Geç kasa raporu, gerçek Postgres'te (plan docs/planlar/personel-yetki.md §2.6; docs/KASA-RAPORU.md › Geç rapor):
// isteği yalnız istek satırı yazar (rapor ve ay bilgisi değişmez, fotoğraflar tutulur); pencere, Z fotoğrafı, Z no,
// başkasının ya da başka bir istekte tutulan fotoğraf, raporlu gün, ilk rapordan önceki gün ve bayat sürüm reddedilir;
// zincir bekleyen geç raporu halka sayar; daha yeni gün eskisinden önce onaylanmaz; onay raporu isteyenin adıyla
// yazar ve fotoğrafları bağlar; "Düzeltip onayla" 1. ve 2. sürümü yazar; ikinci onay reddedilir; yöneticinin doğrudan
// girişi isteği kapatır; ret fotoğrafları 30 gün tutar; personel karar veremez; tutulan fotoğraf başka bir kayda
// bağlanmaz. Kendi kullanıcılarını, raporlarını, fotoğraflarını ve isteklerini açar, sonunda siler (günler 2030:
// yerel verinin raporlarından sonra, tests/kasa-istek-db.test.ts'in 2031–2037 günlerinden önce; o testin "sonraki rapor"
// kilidine girmez).
//
// KASA_GEC_TEST_DATABASE_URL verilmezse atlanır (migration'ları uygulanmış bir yerel veritabanı).
// Çalıştırma: KASA_GEC_TEST_DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_yetki npx tsx --test tests/kasa-gec-rapor-db.test.ts

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import { and, eq, gte, inArray, lte } from "drizzle-orm";

import type { CashReportFields } from "../src/lib/cash-report";
import { CASH_REQUEST_TEXT, olderFirstText } from "../src/lib/cash-requests";
import { REQUEST_TEXT } from "../src/lib/staff-requests";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { UserError } from "../src/server/user-error";

import { raceOnRequest } from "./helpers/lock-race";

const URL = process.env.KASA_GEC_TEST_DATABASE_URL;
/** Türkiye saatiyle an */
const tr = (local: string) => new Date(`${local}:00+03:00`);
const DAY_MS = 86_400_000;

describe("Geç kasa raporu: veritabanında istek, zincir ve karar", { skip: !URL && "KASA_GEC_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  let store: typeof import("../src/server/cash/report-store");
  let late: typeof import("../src/server/cash/late");
  let requests: typeof import("../src/server/cash/requests");
  let chain: typeof import("../src/server/cash/late-chain");
  let cards: typeof import("../src/server/data/cash-late");
  let core: typeof import("../src/server/staff-requests/core");
  const tag = `${process.pid}-${randomBytes(3).toString("hex")}`;
  type Who = { id: number; name: string; role: "admin" | "staff" };
  const users: Record<"ali" | "veli" | "ayse" | "mehmet", Who> = {
    ali: { id: 0, name: "Ali", role: "admin" },
    veli: { id: 0, name: "Veli", role: "admin" },
    ayse: { id: 0, name: "Ayşe", role: "staff" },
    mehmet: { id: 0, name: "Mehmet", role: "staff" },
  };
  /** Müdür (docs/ROLLER.md): çekirdeğe "admin" düzeyinde girer, gerçek rolü `realRole` (src/lib/roles.ts › asActor) */
  const mudur = { id: 0, name: "Müdür", role: "admin" as const, realRole: "manager" as const };
  const dates: string[] = [];
  const photoIds: number[] = [];
  // Taban rapor 1 Mart; "bugün" 15 Mart (pencere 1–13 Mart); D−5 = 10 Mart, D−4 = 11 Mart
  const D0 = "2030-03-01";
  const D5 = "2030-03-10";
  const D4 = "2030-03-11";
  const D3 = "2030-03-12";
  const D2 = "2030-03-13";
  const NOW = tr("2030-03-15T10:00");

  const fields = (date: string, o: Partial<CashReportFields> = {}): CashReportFields & { discounts: number | null } => ({
    date,
    zNo: "1204",
    receipts: null,
    zTotal: 10_000,
    cash: 3_000,
    card: 7_000,
    mealCard: 0,
    online: 0,
    other: 0,
    // Açılış önceki günün devriyle (3.500 − 2.400) tutar: not gerekmez
    openingCash: 1_100,
    cashIn: 0,
    cashOut: 0,
    cashOutNote: null,
    countedCash: 3_500,
    handedOver: 2_400,
    bankPos: null,
    offRevenue: null,
    note: null,
    ...o,
    discounts: o.discounts ?? null,
  });
  /** Bağlanmamış, süresi dolmamış fotoğraf (yeni yüklenmiş gibi) */
  async function photo(by: Who, kind: "kasa-z" | "kasa-pos" | "fis" = "kasa-z") {
    const [p] = await db
      .insert(s.photos)
      .values({ kind, storageKey: `kasa/2030/03/${randomUUID()}.jpg`, contentType: "image/jpeg", sizeBytes: 100, createdBy: by.id, createdByName: by.name, expiresAt: new Date("2100-01-01T00:00:00Z") })
      .returning({ id: s.photos.id });
    photoIds.push(p.id);
    return p.id;
  }
  const photoOf = async (id: number) => (await db.select().from(s.photos).where(eq(s.photos.id, id)))[0];
  const reportOf = async (date: string) => (await db.select().from(s.cashReports).where(eq(s.cashReports.date, date)))[0];
  const requestOf = async (id: number) => (await db.select().from(s.staffRequests).where(eq(s.staffRequests.id, id)))[0];
  const refused = async (p: Promise<unknown>, text: string | RegExp) => {
    await assert.rejects(p, (e: unknown) => e instanceof UserError && (typeof text === "string" ? e.message === text : text.test(e.message)));
  };
  /** Yöneticinin doğrudan raporu */
  async function report(date: string, o: Partial<CashReportFields> = {}, now = tr(`${date}T22:00`)) {
    if (!dates.includes(date)) dates.push(date);
    const r = await store.saveCashReport(db, users.ali, { ...fields(date, { note: "deneme", ...o }), countedBy: null, revision: 0, photos: [] }, now);
    assert.equal(r.kind, "saved");
    return r;
  }
  function propose(
    who: Who,
    date: string,
    o: { fields?: Partial<CashReportFields>; photoIds: number[]; version?: number; handedTo?: { kind: "user"; id: number } | { kind: "banka" } | null; now?: Date; clientKey?: string },
  ) {
    if (!dates.includes(date)) dates.push(date);
    const f = fields(date, o.fields);
    return late.proposeLateReport(
      db,
      who,
      { fields: f, reason: "Akşam sistem kapalıydı", requestVersion: o.version ?? 0, photoIds: o.photoIds, handedTo: o.handedTo === undefined ? (f.handedOver > 0 ? { kind: "banka" } : null) : o.handedTo, clientKey: o.clientKey ?? null },
      o.now ?? NOW,
    );
  }
  const review = (
    who: Who,
    id: number,
    seenVersion: number,
    decision: "approve" | "reject",
    o: { fields?: Omit<CashReportFields, "date">; handoverSeen?: boolean; now?: Date } = {},
  ) => requests.reviewCashRequestCore(db, who, { id, seenVersion, seenRevision: null, decision, note: null, fields: o.fields ?? null, handoverSeen: o.handoverSeen ?? true }, o.now ?? NOW);

  before(async () => {
    process.env.DATABASE_URL = URL;
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır: test aynı modülleri doğrudan çalıştırır
    const require = createRequire(import.meta.url);
    const marker = require.resolve("server-only");
    require.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as unknown as NodeJS.Module;
    const dbModule = await import("../src/server/db");
    db = dbModule.createDb(URL!, 4);
    store = await import("../src/server/cash/report-store");
    late = await import("../src/server/cash/late");
    requests = await import("../src/server/cash/requests");
    chain = await import("../src/server/cash/late-chain");
    cards = await import("../src/server/data/cash-late");
    core = await import("../src/server/staff-requests/core");
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db
        .insert(s.users)
        .values({ email: `kasa-gec-${k}-${tag}@ornek.com`, name: users[k].name, passwordHash: "x", role: users[k].role })
        .returning({ id: s.users.id });
      users[k].id = u.id;
    }
    const [m] = await db
      .insert(s.users)
      .values({ email: `kasa-gec-mudur-${tag}@ornek.com`, name: mudur.name, passwordHash: "x", role: "manager", branchId: "tuzla" })
      .returning({ id: s.users.id });
    mudur.id = m.id;
    await report(D0, { openingCash: 0 });
  });

  after(async () => {
    if (!db) return;
    const ids = [...Object.values(users).map((u) => u.id), mudur.id];
    await db.delete(s.staffRequests).where(inArray(s.staffRequests.requestedBy, ids));
    if (dates.length) await db.delete(s.cashReports).where(inArray(s.cashReports.date, dates));
    if (photoIds.length) await db.delete(s.photos).where(inArray(s.photos.id, photoIds));
    await db.delete(s.users).where(inArray(s.users.id, ids));
    await db.$client.end();
    const { getDb } = await import("../src/server/db");
    await getDb().$client.end();
  });

  test("D−5 isteği yalnız istek satırı yazar; rapor ve ay bilgisi değişmez, fotoğraf tutulur", async () => {
    // Yalnız bu testin yılı (öteki veritabanı testleri aynı anda kendi günlerine rapor yazar)
    const ours = () => db.select({ id: s.cashReports.id }).from(s.cashReports).where(and(gte(s.cashReports.date, "2030-01-01"), lte(s.cashReports.date, "2030-12-31")));
    const reportsBefore = await ours();
    const z = await photo(users.ayse);
    const out = await propose(users.ayse, D5, { photoIds: [z] });
    assert.equal(out.created, true);
    assert.equal(out.row.kind, "kasa-gec");
    assert.equal(out.row.status, "pending");
    assert.equal(out.row.subject, `gun:${D5}`);
    assert.deepEqual(out.row.photoIds, [z]);
    // Sayılan 3.500 − (açılış 1.100 + nakit 3.000) = 600 eksik
    assert.equal(out.cashDiff, -600);
    assert.equal(await reportOf(D5), undefined, "rapor onaya kadar yazılmaz");
    assert.equal((await ours()).length, reportsBefore.length);
    const held = await photoOf(z);
    assert.equal(held.expiresAt, null, "istek beklerken fotoğraf silinmez");
    assert.equal(held.linkedAt, null);
    // Personel yükünde yalnız raporun alanları, teslim alan, fotoğraflar ve kasa farkı
    assert.deepEqual(
      Object.keys(out.row.payload).sort(),
      ["bankPos", "branchId", "card", "cash", "cashDiff", "cashIn", "cashOut", "cashOutNote", "countedCash", "date", "discounts", "handedOver", "handedTo", "mealCard", "note", "offRevenue", "online", "openingCash", "other", "photos", "receipts", "zNo", "zTotal"].sort(),
    );
  });

  test("reddedilenler: Z fotoğrafı yok, Z no yok, başkasının fotoğrafı, D−15, raporlu gün, ilk rapordan önceki gün, bayat sürüm, teslim alan", async () => {
    const pos = await photo(users.ayse, "kasa-pos");
    await refused(propose(users.ayse, D3, { photoIds: [pos] }), CASH_REQUEST_TEXT.lateZPhoto);
    const z = await photo(users.ayse);
    await refused(propose(users.ayse, D3, { photoIds: [z], fields: { zNo: null } }), "Z no gerekli");
    const foreign = await photo(users.mehmet);
    await refused(propose(users.ayse, D3, { photoIds: [foreign] }), CASH_REQUEST_TEXT.latePhoto);
    const receipt = await photo(users.ayse, "fis");
    await refused(propose(users.ayse, D3, { photoIds: [z, receipt] }), CASH_REQUEST_TEXT.latePhoto);
    await refused(propose(users.ayse, "2030-02-28", { photoIds: [z] }), CASH_REQUEST_TEXT.lateWindow);
    await refused(propose(users.ayse, "2030-03-14", { photoIds: [z] }), CASH_REQUEST_TEXT.lateWindow);
    await refused(propose(users.ayse, D0, { photoIds: [z] }), CASH_REQUEST_TEXT.lateReported);
    // Kasa raporları 2030'dan çok önce başladı ama 2000 yılı ilk rapordan önce
    await refused(propose(users.ayse, "2000-01-15", { photoIds: [z], now: tr("2000-01-20T10:00") }), CASH_REQUEST_TEXT.lateBeforeFirst);
    await refused(propose(users.ayse, D3, { photoIds: [z], handedTo: null }), CASH_REQUEST_TEXT.lateHandedTo);
    // Bekleyen isteğin sürümü ekranda görülenden farklı: üzerine yazılmaz
    await refused(propose(users.ayse, D5, { photoIds: [z], version: 0 }), CASH_REQUEST_TEXT.lateStale);
    // Yönetici istek açmaz
    await refused(propose(users.ali, D3, { photoIds: [z] }), CASH_REQUEST_TEXT.adminDirect);
  });

  test("zincir bekleyen geç raporu halka sayar; açılış ona göre denetlenir; başka bir istekte tutulan fotoğraf alınmaz", async () => {
    const d5 = (await db.select().from(s.staffRequests).where(and(eq(s.staffRequests.subject, `gun:${D5}`), eq(s.staffRequests.requestedBy, users.ayse.id))))[0];
    const n = await chain.chainNeighbours(db, D4);
    assert.equal(n.prev?.kind, "bekleyen");
    assert.equal(n.prev?.date, D5);
    assert.equal(n.prev?.carry, 1_100);
    assert.equal(n.prev?.requestedByName, "Ayşe");
    const z = await photo(users.ayse);
    // Açılış bekleyen halkanın devriyle tutmuyor ve not yok: ret
    await refused(propose(users.ayse, D4, { photoIds: [z], fields: { openingCash: 900 } }), /^Açılış önceki günün devrinden farklı \(200\s₺ az\): nedenini nota yazın$/);
    // D−5'in tuttuğu fotoğraf D−4'ün isteğine alınamaz (önceki isteğin fotoğrafı değil)
    await refused(propose(users.ayse, D4, { photoIds: [z, d5.photoIds[0]] }), REQUEST_TEXT.held);
    const out = await propose(users.ayse, D4, { photoIds: [z] });
    assert.equal(out.row.status, "pending");
    // Güncelleme: önceki isteğin fotoğrafı tutulabilir, düşürülen bırakılır, sürüm artar
    const z2 = await photo(users.ayse);
    const upd = await propose(users.ayse, D4, { photoIds: [z2], version: 1, fields: { zTotal: 10_200, cash: 3_000, card: 7_200 } });
    assert.equal(upd.row.id, out.row.id);
    assert.equal(upd.row.version, 2);
    assert.deepEqual(upd.row.photoIds, [z2]);
    assert.notEqual((await photoOf(z)).expiresAt, null, "düşürülen fotoğrafın süresi başlar");
    assert.equal((await photoOf(z2)).expiresAt, null);
  });

  test("daha yeni gün eskisinden önce onaylanmaz; onay raporu isteyenin adıyla yazar, fotoğrafı bağlar; ikinci onay reddedilir", async () => {
    const d4 = (await db.select().from(s.staffRequests).where(eq(s.staffRequests.subject, `gun:${D4}`)))[0];
    const d5 = (await db.select().from(s.staffRequests).where(eq(s.staffRequests.subject, `gun:${D5}`)))[0];
    await refused(review(users.ali, d4.id, d4.version, "approve"), olderFirstText(D5));
    // Personel karar veremez; kimse kendi isteğini onaylayamaz (yönetici yapılan hesap)
    await refused(review(users.mehmet, d5.id, d5.version, "approve"), REQUEST_TEXT.adminOnly);
    // Teslim var: yönetici işaretlemeden onay olmaz
    await refused(review(users.ali, d5.id, d5.version, "approve", { handoverSeen: false }), CASH_REQUEST_TEXT.lateHandover);
    const out = await review(users.ali, d5.id, d5.version, "approve");
    assert.equal(out.status, "approved");
    const r = await reportOf(D5);
    assert.equal(r.revision, 1);
    assert.equal(r.submittedBy, users.ayse.id);
    assert.equal(r.submittedByName, "Ayşe");
    assert.equal(r.countedByName, "Ayşe", "sayan isteyendir");
    assert.equal(r.zNo, "1204");
    assert.equal(r.handedOver, 2_400);
    const req = await requestOf(d5.id);
    assert.equal(req.status, "approved");
    assert.equal(req.resultId, r.id);
    assert.equal(req.reviewedByName, "Ali");
    const links = await db.select().from(s.cashReportPhotos).where(eq(s.cashReportPhotos.reportId, r.id));
    assert.deepEqual(
      links.map((l) => l.photoId),
      d5.photoIds,
    );
    assert.notEqual((await photoOf(d5.photoIds[0])).linkedAt, null);
    await refused(review(users.veli, d5.id, d5.version, "approve"), REQUEST_TEXT.decided);
  });

  test("Düzeltip onayla: isteyenin hâli 1. sürüm, yöneticinin değerleri 2. sürüm", async () => {
    const d4 = (await db.select().from(s.staffRequests).where(eq(s.staffRequests.subject, `gun:${D4}`)))[0];
    const { date: _d, ...rest } = fields(D4, { zTotal: 10_300, cash: 3_000, card: 7_300, note: "Z düzeltildi" });
    void _d;
    const out = await review(users.ali, d4.id, d4.version, "approve", { fields: rest });
    assert.equal(out.status, "approved");
    assert.equal(out.kind === "kasa-gec" && out.status === "approved" && out.corrected, true);
    const r = await reportOf(D4);
    assert.equal(r.revision, 2);
    assert.equal(r.zTotal, 10_300);
    assert.equal(r.submittedByName, "Ali");
    assert.equal(r.countedByName, "Ayşe");
    const [r1] = await db.select().from(s.cashReportRevisions).where(eq(s.cashReportRevisions.reportId, r.id));
    assert.equal(r1.revision, 1);
    assert.equal(r1.submittedByName, "Ayşe");
    assert.equal((r1.data as { zTotal: number }).zTotal, 10_200, "isteyenin son değeri");
  });

  test("yöneticinin doğrudan girişi isteği kapatır (fotoğraf 30 gün); ret fotoğrafları 30 gün tutar", async () => {
    const z3 = await photo(users.mehmet);
    const d3 = await propose(users.mehmet, D3, { photoIds: [z3] });
    await report(D3, {}, NOW);
    const closed = await requestOf(d3.row.id);
    assert.equal(closed.status, "superseded");
    assert.equal(closed.reviewNote, "Yönetici günü kendisi girdi");
    const kept = await photoOf(z3);
    assert.equal(kept.linkedAt, null);
    assert.ok(Math.abs(kept.expiresAt!.getTime() - (NOW.getTime() + 30 * DAY_MS)) < 5_000, "30 gün");
    const z2 = await photo(users.mehmet);
    const k2 = randomUUID();
    const d2 = await propose(users.mehmet, D2, { photoIds: [z2], clientKey: k2 });
    const out = await review(users.ali, d2.row.id, d2.row.version, "reject");
    assert.equal(out.status, "rejected");
    assert.equal((await requestOf(d2.row.id)).status, "rejected");
    const released = await photoOf(z2);
    assert.ok(Math.abs(released.expiresAt!.getTime() - (NOW.getTime() + 30 * DAY_MS)) < 5_000, "ret: 30 gün");
    assert.equal(await reportOf(D2), undefined);
    // Eski sayfadan aynı anahtarla tekrar: reddedilen istek "gönderildi" diye dönmez
    await refused(propose(users.mehmet, D2, { photoIds: [z2], clientKey: k2 }), REQUEST_TEXT.keyClosed);
    assert.equal((await photoOf(z2)).expiresAt?.getTime(), released.expiresAt?.getTime());
  });

  test("tutulan fotoğraf kasa raporuna ve kasadan çıkan satırına bağlanmaz", async () => {
    const z = await photo(users.ayse);
    const pending = await propose(users.ayse, D2, { photoIds: [z] });
    assert.equal(pending.row.status, "pending");
    // Yöneticinin başka bir güne girdiği rapor bu fotoğrafı bağlayamaz
    await refused(
      store.saveCashReport(db, users.ali, { ...fields("2030-03-14", { note: "deneme" }), countedBy: null, revision: 0, photos: [z] }, NOW),
      REQUEST_TEXT.held,
    );
    if (!dates.includes("2030-03-14")) dates.push("2030-03-14");
    // Kasadan çıkan ve harcama yolları da aynı kontrolü yapar
    await refused(core.assertNotHeld(db, z), REQUEST_TEXT.held);
    const outs = readFileSync(join(process.cwd(), "src/server/cash-outs/write.ts"), "utf8");
    assert.match(outs, /p\.kind !== "fis"[\s\S]*?await assertNotHeld\(tx, d\.photoId, o\.heldBy\);/);
    assert.match(readFileSync(join(process.cwd(), "src/server/actions/expenses.ts"), "utf8"), /await assertNotHeld\(tx, p\.id\);/);
    // Geri çekilince bırakılır ve bağlanabilir
    await core.withdrawOwn(db, users.ayse, pending.row.id, NOW);
    await core.assertNotHeld(db, z);
  });

  test("kart 'önce … karara bağlayın' der: önceki halka bekleyen geç rapor olsa da sınır önceki kayıtlı rapor (onaydaki gibi)", async () => {
    // Haziran: 3'ü bekliyor, 5'i raporlu, 7'si ve 8'i bekliyor; "bugün" 15 Haziran. 8'inin kartı 7'sini adlandırır, 3'ünü değil
    const now = tr("2030-06-15T10:00");
    const [a, r, b, c] = ["2030-06-03", "2030-06-05", "2030-06-07", "2030-06-08"];
    const note = { note: "zincir dışı açılış" };
    const pa = await propose(users.ayse, a, { photoIds: [await photo(users.ayse)], fields: note, now });
    await report(r, {}, tr(`${r}T22:00`));
    const pb = await propose(users.mehmet, b, { photoIds: [await photo(users.mehmet)], fields: note, now });
    const pc = await propose(users.ayse, c, { photoIds: [await photo(users.ayse)], fields: note, now });
    const n = await chain.chainNeighbours(db, c, { exceptRequestId: pc.row.id });
    assert.equal(n.prev?.kind, "bekleyen");
    assert.equal(n.prev?.date, b);
    assert.equal(n.prevReportDate, r);
    const all = await cards.lateCards(now);
    const card = (id: number) => all.find((x) => x.id === id);
    assert.equal(card(pc.row.id)?.olderPending, b, "aralıktaki daha eski bekleyen gün");
    assert.equal(card(pb.row.id)?.olderPending, null, "rapordan önceki bekleyen gün aralığın dışında");
    // Onay da aynı günü adlandırır
    await refused(review(users.ali, pc.row.id, pc.row.version, "approve", { now }), olderFirstText(b));
    for (const [who, p] of [
      [users.ayse, pa],
      [users.mehmet, pb],
      [users.ayse, pc],
    ] as const)
      await core.withdrawOwn(db, who, p.row.id, now);
  });

  test("kilit sırası: geç raporunu güncelleyen personel ya da günü doğrudan giren yönetici, aynı anda verilen onayla kilitlenmez (günün kilidi, sonra istek)", async () => {
    // Kendi aralığı: 1 Mayıs raporu, 10 Mayıs geç rapor ("bugün" 15 Mayıs); arada bekleyen geç rapor yok
    const BASE = "2030-05-01";
    const DAY = "2030-05-10";
    const AT = tr("2030-05-15T10:00");
    await report(BASE);
    const z = await photo(users.ayse);
    const out = await propose(users.ayse, DAY, { photoIds: [z], now: AT });
    const [approve, edit] = await raceOnRequest(
      URL!,
      out.row.id,
      () => review(users.ali, out.row.id, out.row.version, "approve", { now: AT }),
      () => propose(users.ayse, DAY, { photoIds: [z], version: out.row.version, fields: { handedOver: 2_000 }, now: AT }),
    );
    assert.equal(approve.status, "fulfilled");
    assert.equal((await reportOf(DAY)).handedOver, 2_400);
    // Gün artık raporlu: güncelleme temiz bir hatayla düşer
    assert.equal(edit.status, "rejected");
    assert.equal(((edit as PromiseRejectedResult).reason as Error).message, CASH_REQUEST_TEXT.lateReported);

    // Yönetici aynı günü doğrudan girerken (günün kilidi, rapor, sonra günün geç raporları kapanır) başka bir sekmede geç
    // raporu onaylıyor: raporu henüz olmayan günde satır kilidi yok, ikisi günün kilidinde sıraya girer
    const DAY2 = "2030-05-12";
    const z2 = await photo(users.ayse);
    const out2 = await propose(users.ayse, DAY2, { photoIds: [z2], now: AT });
    const [approve2, direct] = await raceOnRequest(
      URL!,
      out2.row.id,
      () => review(users.ali, out2.row.id, out2.row.version, "approve", { now: AT }),
      () => store.saveCashReport(db, users.veli, { ...fields(DAY2, { note: "deneme" }), countedBy: null, revision: 0, photos: [] }, AT),
    );
    assert.equal(approve2.status, "fulfilled");
    assert.equal(direct.status, "rejected", "gün onayla raporlanmıştı");
    assert.equal((await reportOf(DAY2)).submittedByName, "Ayşe");
  });

  test("müdür ('admin' düzeyinde) kendi raporuna başkasının bağsız fotoğrafını bağlayamaz (öteki şubenin Z'si); onayladığı geç raporun fotoğraflarını bağlar", async () => {
    const BASE = "2030-09-01";
    const DAY = "2030-09-10";
    const OWN = "2030-09-14";
    const AT = tr("2030-09-15T10:00");
    await report(BASE, {}, tr(`${BASE}T22:00`));
    // Onay: isteğin tuttuğu personel fotoğrafları bağlanır
    const held = await photo(users.ayse);
    const out = await propose(users.ayse, DAY, { photoIds: [held], now: AT });
    const r = await review(mudur, out.row.id, out.row.version, "approve", { now: AT });
    assert.equal(r.status, "approved");
    const links = await db.select().from(s.cashReportPhotos).where(eq(s.cashReportPhotos.reportId, (await reportOf(DAY)).id));
    assert.deepEqual(
      links.map((l) => l.photoId),
      [held],
    );
    // Doğrudan rapor: Ayşe'nin bağsız Z fotoğrafı (fotoğrafta şube yok) müdürün raporuna bağlanmaz, rapor da yazılmaz
    const foreign = await photo(users.ayse);
    if (!dates.includes(OWN)) dates.push(OWN);
    await refused(store.saveCashReport(db, mudur, { ...fields(OWN, { note: "deneme" }), countedBy: null, revision: 0, photos: [foreign] }, AT), /Fotoğraf bulunamadı/);
    assert.equal((await photoOf(foreign)).linkedAt, null, "fotoğraf bağlanmadı");
    assert.equal(await reportOf(OWN), undefined);
    // Kendi yüklediği bağlanır
    const own = await photo(mudur);
    const saved = await store.saveCashReport(db, mudur, { ...fields(OWN, { note: "deneme" }), countedBy: null, revision: 0, photos: [own] }, AT);
    assert.equal(saved.kind, "saved");
    assert.notEqual((await photoOf(own)).linkedAt, null);
  });
});
