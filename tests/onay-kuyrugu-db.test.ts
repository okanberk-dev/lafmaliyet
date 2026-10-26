// Ortak onay kuyruğunun çekirdeği (src/server/staff-requests/core.ts), gerçek Postgres'te: kişi başına konu başına tek
// bekleyen istek (yenisi onu günceller, sürüm artar), aynı istemci anahtarı ikinci istek açmaz, yönetici yalnız gördüğü
// sürümü onaylar, kimse kendi isteğini onaylayamaz, koşullu geri çekme ile onay yarışında tek sonuç kalır, sınırlar
// (11. açık istek, 31. günlük istek, konu başına 4. istek), supersede, tutulan fotoğraf başka isteğe giremez, süresi
// dolanlar kapanır ve fotoğrafları bırakılır; kaldırılan tür (eski mal siparişi taslağı, 26 Eki 2026) açılamaz,
// kuyruklara girmez ve sabah işi canlı kalanlarını kapatır. Kendi kullanıcılarını, isteklerini ve fotoğraflarını açar,
// sonunda siler.
//
// ONAY_TEST_DATABASE_URL verilmezse atlanır (migration'ları uygulanmış bir yerel veritabanı).
// Çalıştırma: ONAY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_yetki npx tsx --test tests/onay-kuyrugu-db.test.ts

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { eq, inArray } from "drizzle-orm";

import { REQUEST_TEXT, type StaffRequestKind } from "../src/lib/staff-requests";
import { createDb, type DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import {
  assertNotHeld,
  countPendingByKind,
  createOrUpdateRequest,
  decide,
  expireStaffRequests,
  lockForReview,
  ownRequests,
  pendingRequests,
  recentDecisions,
  supersede,
  withdrawOwn,
  type RequestInput,
} from "../src/server/staff-requests/core";
import { UserError } from "../src/server/user-error";

const URL = process.env.ONAY_TEST_DATABASE_URL;
/** Türkiye saatiyle an */
const tr = (local: string) => new Date(`${local}:00+03:00`);

describe("Onay kuyruğu: veritabanında istek, karar ve sınırlar", { skip: !URL && "ONAY_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  const tag = `${process.pid}-${randomBytes(3).toString("hex")}`;
  type Who = { id: number; name: string; role: "admin" | "staff" };
  const users: Record<"admin" | "ayse" | "mehmet" | "selin" | "open" | "daily" | "subject" | "race", Who> = {
    admin: { id: 0, name: "Ali", role: "admin" },
    ayse: { id: 0, name: "Ayşe", role: "staff" },
    mehmet: { id: 0, name: "Mehmet", role: "staff" },
    selin: { id: 0, name: "Selin", role: "staff" },
    open: { id: 0, name: "Açık", role: "staff" },
    daily: { id: 0, name: "Günlük", role: "staff" },
    subject: { id: 0, name: "Konu", role: "staff" },
    race: { id: 0, name: "Yarış", role: "staff" },
  };
  const photoIds: number[] = [];
  /** Testin konuları birbirinden ve başka çalıştırmalardan ayrılsın */
  const subj = (x: string) => `${x}:${tag}`;

  const input = (o: Partial<RequestInput> = {}): RequestInput => ({
    kind: "kasa-duzeltme",
    subject: subj("gun:2026-10-22"),
    day: "2026-10-22",
    title: "22 Ekim kasa düzeltmesi",
    payload: { a: 1 },
    message: "Teslim yanlış yazıldı",
    ...o,
  });
  const create = (who: Who, o: Partial<RequestInput> = {}, now = new Date()) => db.transaction((tx) => createOrUpdateRequest(tx, who, input(o), now));
  const refused = async (p: Promise<unknown>, text: string | RegExp) => {
    await assert.rejects(p, (e: unknown) => e instanceof UserError && (typeof text === "string" ? e.message === text : text.test(e.message)));
  };
  /** Kaldırılan türün eski satırı (özellik 26 Eki 2026'da kalktı; satır geçmişten kalmış gibi doğrudan yazılır) */
  const oldDraft = async (status: "pending" | "approved" | "done", expiresAt: Date | null = null) => {
    const [row] = await db
      .insert(s.staffRequests)
      .values({
        kind: "mal-taslak",
        subject: subj(`tedarikci:eski-${status}`),
        title: "Kaldi · 3 kalem",
        payload: {},
        status,
        requestedBy: users.selin.id,
        requestedByName: "Selin",
        expiresAt,
      })
      .returning({ id: s.staffRequests.id });
    return row.id;
  };
  const statusOf = async (id: number) => (await db.select({ status: s.staffRequests.status }).from(s.staffRequests).where(eq(s.staffRequests.id, id)))[0]?.status;
  async function photo(by: number): Promise<number> {
    const [row] = await db
      .insert(s.photos)
      .values({ kind: "kasa-z", storageKey: `kasa/2026/10/${randomUUID()}.jpg`, contentType: "image/jpeg", sizeBytes: 100, createdBy: by, expiresAt: null })
      .returning({ id: s.photos.id });
    photoIds.push(row.id);
    return row.id;
  }

  before(async () => {
    db = createDb(URL!, 4);
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db
        .insert(s.users)
        .values({ email: `onay-${k}-${tag}@ornek.com`, name: users[k].name, passwordHash: "x", role: users[k].role })
        .returning({ id: s.users.id });
      users[k].id = u.id;
    }
  });

  after(async () => {
    if (!db) return;
    const ids = Object.values(users).map((u) => u.id);
    await db.delete(s.staffRequests).where(inArray(s.staffRequests.requestedBy, ids));
    if (photoIds.length) await db.delete(s.photos).where(inArray(s.photos.id, photoIds));
    await db.delete(s.users).where(inArray(s.users.id, ids));
    await db.$client.end();
  });

  test("kişi başına konu başına tek bekleyen istek: aynı kişi yenisini gönderince güncellenir, sürüm artar; başkası engellenmez", async () => {
    const first = await create(users.ayse);
    assert.equal(first.created, true);
    assert.equal(first.row.version, 1);
    assert.equal(first.row.status, "pending");
    assert.equal(first.row.requestedByName, "Ayşe");
    const again = await create(users.ayse, { payload: { a: 2 }, message: "Teslim 2.040" });
    assert.equal(again.created, false);
    assert.equal(again.row.id, first.row.id);
    assert.equal(again.row.version, 2);
    assert.deepEqual(again.row.payload, { a: 2 });
    assert.equal(again.row.message, "Teslim 2.040");
    // Başka bir personelin aynı konudaki isteği ayrı satır
    const other = await create(users.mehmet);
    assert.notEqual(other.row.id, first.row.id);
    assert.equal(other.created, true);
    // Yönetici istek açmaz
    await refused(create(users.admin), REQUEST_TEXT.adminDirect);
  });

  test("aynı istemci anahtarı ikinci istek açmaz, var olanı olduğu gibi döner", async () => {
    const key = randomUUID();
    const a = await create(users.selin, { subject: subj("zayi-yeni:k1"), kind: "zayi-gec", clientKey: key });
    const b = await create(users.selin, { subject: subj("zayi-yeni:k1"), kind: "zayi-gec", clientKey: key, payload: { a: 99 } });
    assert.equal(b.row.id, a.row.id);
    assert.equal(b.created, false);
    assert.equal(b.row.version, 1, "tekrar sürümü artırmaz");
    assert.deepEqual(b.row.payload, { a: 1 });
    // Başkası aynı anahtarla istek açamaz
    await refused(create(users.ayse, { subject: subj("zayi-yeni:k2"), kind: "zayi-gec", clientKey: key }), REQUEST_TEXT.keyTaken);
  });

  test("zil kimliği 10 dakikadan sık yenilenmez", async () => {
    const t0 = tr("2026-10-24T10:00");
    const a = await create(users.selin, { subject: subj("gun:bump") }, t0);
    const b = await create(users.selin, { subject: subj("gun:bump"), payload: { a: 2 } }, tr("2026-10-24T10:05"));
    assert.equal(b.row.bumpedAt.getTime(), a.row.bumpedAt.getTime());
    const c = await create(users.selin, { subject: subj("gun:bump"), payload: { a: 3 } }, tr("2026-10-24T10:11"));
    assert.equal(c.row.bumpedAt.getTime(), tr("2026-10-24T10:11").getTime());
    assert.equal(c.row.version, 3);
  });

  test("yönetici yalnız gördüğü sürümü onaylar; kimse kendi isteğini onaylayamaz; karara bağlanan ikinci kez bağlanmaz", async () => {
    const { row } = await create(users.mehmet, { subject: subj("gun:surum") });
    await create(users.mehmet, { subject: subj("gun:surum"), payload: { a: 5 } });
    await refused(
      db.transaction((tx) => lockForReview(tx, users.admin, { id: row.id, seenVersion: 1 })),
      "İstek siz bakarken değişti; yeniden bakın",
    );
    const decided = await db.transaction(async (tx) => {
      const locked = await lockForReview(tx, users.admin, { id: row.id, seenVersion: 2 });
      return decide(tx, locked, users.admin, "approved", { note: "Tamam", resultId: 42, result: { ok: true } });
    });
    assert.equal(decided.status, "approved");
    assert.equal(decided.reviewedByName, "Ali");
    assert.equal(decided.reviewNote, "Tamam");
    assert.equal(decided.resultId, 42);
    await refused(
      db.transaction((tx) => lockForReview(tx, users.admin, { id: row.id, seenVersion: 2 })),
      REQUEST_TEXT.decided,
    );
    // Personel sonradan yönetici yapıldı: kendi bekleyen isteğini onaylayamaz
    const own = await create(users.race, { subject: subj("gun:kendi") });
    await db.update(s.users).set({ role: "admin" }).where(eq(s.users.id, users.race.id));
    try {
      await refused(
        db.transaction((tx) => lockForReview(tx, { ...users.race, role: "admin" }, { id: own.row.id, seenVersion: 1 })),
        "Kendi isteğinizi onaylayamazsınız",
      );
      // Personel karar veremez
      await refused(
        db.transaction((tx) => lockForReview(tx, users.ayse, { id: own.row.id, seenVersion: 1 })),
        REQUEST_TEXT.adminOnly,
      );
    } finally {
      await db.update(s.users).set({ role: "staff" }).where(eq(s.users.id, users.race.id));
      await db.update(s.staffRequests).set({ status: "withdrawn" }).where(eq(s.staffRequests.id, own.row.id));
    }
  });

  test("koşullu geri çekme ile onay yarışında tek sonuç kalır; başkasının isteği geri çekilemez", async () => {
    for (let i = 0; i < 4; i++) {
      const { row } = await create(users.ayse, { subject: subj(`gun:yaris-${i}`) });
      const results = await Promise.allSettled([
        withdrawOwn(db, users.ayse, row.id),
        db.transaction(async (tx) => {
          const locked = await lockForReview(tx, users.admin, { id: row.id, seenVersion: 1 });
          return decide(tx, locked, users.admin, "approved");
        }),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, `tur ${i}`);
      const status = await statusOf(row.id);
      assert.ok(status === "withdrawn" || status === "approved", `tur ${i}: ${status}`);
    }
    const { row } = await create(users.ayse, { subject: subj("gun:baskasi") });
    await refused(withdrawOwn(db, users.mehmet, row.id), REQUEST_TEXT.notPending);
    assert.equal((await withdrawOwn(db, users.ayse, row.id)).status, "withdrawn");
    await refused(withdrawOwn(db, users.ayse, row.id), REQUEST_TEXT.notPending);
  });

  test("sınırlar: 11. açık istek, iş gününün 31. isteği ve konu başına günün 4. isteği reddedilir", async () => {
    // Kasa grubunda 10 açık istek; 11. reddedilir, öteki gruba (zayi) yine açılır
    for (let i = 0; i < 10; i++) await create(users.open, { subject: subj(`cikan:${i}`), kind: "kasa-cikan" });
    await refused(create(users.open, { subject: subj("cikan:10"), kind: "kasa-cikan" }), /^Onay bekleyen 10 isteğiniz var/);
    await create(users.open, { subject: subj("zayi:1"), kind: "zayi-sil" });
    // Var olan bekleyen isteği güncellemek sınıra takılmaz
    assert.equal((await create(users.open, { subject: subj("cikan:3"), kind: "kasa-cikan", payload: { b: 1 } })).row.version, 2);

    // Günde 30: 10 kasa + 20 zayi açık; 31. (geç kasa raporu, kendi grubunda açığı yok) günlük sınıra takılır
    for (let i = 0; i < 10; i++) await create(users.daily, { subject: subj(`d-cikan:${i}`), kind: "kasa-cikan" });
    for (let i = 0; i < 20; i++) await create(users.daily, { subject: subj(`d-zayi:${i}`), kind: "zayi-gec" });
    await refused(create(users.daily, { subject: subj("gun:gec-x"), kind: "kasa-gec" }), "Bugün en çok 30 istek açılabilir; yarın yeniden deneyin");

    // Konu başına günde 3 (geri çekilenler de sayılır)
    for (let i = 0; i < 3; i++) {
      const { row } = await create(users.subject, { subject: subj("gun:konu") });
      await withdrawOwn(db, users.subject, row.id);
    }
    await refused(create(users.subject, { subject: subj("gun:konu") }), "Bu konuda bugün en çok 3 istek açılabilir; yöneticiye yazın");
    // Başka konu serbest
    await create(users.subject, { subject: subj("gun:baska") });
  });

  test("supersede: konunun öteki bekleyenleri kapanır, notla; istisna ve başka konu dokunulmaz", async () => {
    const a = await create(users.ayse, { subject: subj("gun:sup") });
    const b = await create(users.mehmet, { subject: subj("gun:sup") });
    const c = await create(users.mehmet, { subject: subj("gun:sup-baska") });
    const ids = await db.transaction((tx) => supersede(tx, { kinds: ["kasa-duzeltme"], subject: subj("gun:sup"), exceptId: a.row.id }, "Rapor başka bir istekle düzeltildi"));
    assert.deepEqual(ids, [b.row.id]);
    assert.equal(await statusOf(a.row.id), "pending");
    assert.equal(await statusOf(b.row.id), "superseded");
    assert.equal(await statusOf(c.row.id), "pending");
    const [row] = await db.select().from(s.staffRequests).where(eq(s.staffRequests.id, b.row.id));
    assert.equal(row.reviewNote, "Rapor başka bir istekle düzeltildi");
  });

  test("tutulan fotoğraf başka bir isteğe ve bağlama yoluna giremez; geri çekilince bırakılır", async () => {
    const p = await photo(users.selin.id);
    const { row } = await create(users.selin, { kind: "kasa-gec", subject: subj("gun:foto"), photoIds: [p] });
    await refused(db.transaction((tx) => assertNotHeld(tx, p)), "Bu fotoğraf onay bekleyen bir istekte");
    // Aynı isteğin güncellemesi kendi fotoğrafını tutabilir
    await db.transaction((tx) => assertNotHeld(tx, p, row.id));
    await create(users.selin, { kind: "kasa-gec", subject: subj("gun:foto"), photoIds: [p], payload: { a: 2 } });
    // Başka bir istek aynı fotoğrafı alamaz
    await refused(create(users.ayse, { kind: "kasa-gec", subject: subj("gun:foto-2"), photoIds: [p] }), "Bu fotoğraf onay bekleyen bir istekte");
    await withdrawOwn(db, users.selin, row.id);
    await db.transaction((tx) => assertNotHeld(tx, p));
    const [ph] = await db.select({ expiresAt: s.photos.expiresAt, linkedAt: s.photos.linkedAt }).from(s.photos).where(eq(s.photos.id, p));
    assert.equal(ph.linkedAt, null);
    assert.ok(ph.expiresAt && ph.expiresAt.getTime() > Date.now() + 6 * 86_400_000, "7 gün sonra silinir");
  });

  test("süresi dolan bekleyen istek kapanır, fotoğrafı bırakılır; onaylanmış istek, süresi gelmemiş ve süresiz dokunulmaz", async () => {
    const now = new Date();
    const p = await photo(users.mehmet.id);
    const past = new Date(now.getTime() - 60_000);
    const future = new Date(now.getTime() + 3_600_000);
    const expiring = await create(users.mehmet, { kind: "kasa-cikan", subject: subj("cikan-yeni:sure"), expiresAt: past, photoIds: [p] });
    // Onaylanmış kasadan çıkan isteği kayda geçmiştir: 14 günlük süresi dolsa da onaylı kalır (zil "süresi doldu" demez)
    const approved = await create(users.mehmet, { kind: "kasa-cikan", subject: subj("cikan-yeni:onayli"), expiresAt: future });
    const decided = await db.transaction(async (tx) => decide(tx, await lockForReview(tx, users.admin, { id: approved.row.id, seenVersion: 1 }, now), users.admin, "approved", {}, now));
    assert.equal(decided.status, "approved");
    await db.update(s.staffRequests).set({ expiresAt: past }).where(eq(s.staffRequests.id, approved.row.id));
    const fresh = await create(users.mehmet, { kind: "kasa-cikan", subject: subj("cikan-yeni:taze"), expiresAt: future });
    const forever = await create(users.mehmet, { kind: "kasa-silme", subject: subj("gun:suresiz") });
    const r = await expireStaffRequests(db, now);
    assert.ok(r.expired >= 1);
    assert.equal(await statusOf(expiring.row.id), "expired");
    assert.equal(await statusOf(approved.row.id), "approved");
    assert.equal(await statusOf(fresh.row.id), "pending");
    assert.equal(await statusOf(forever.row.id), "pending");
    const [ph] = await db.select({ expiresAt: s.photos.expiresAt }).from(s.photos).where(eq(s.photos.id, p));
    assert.ok(ph.expiresAt, "bırakılan fotoğrafın silinme günü var");
    // Süresi dolmuş istek karara bağlanamaz (iş daha çalışmadan)
    const late = await create(users.mehmet, { kind: "kasa-cikan", subject: subj("cikan-yeni:gec"), expiresAt: future });
    await refused(
      db.transaction((tx) => lockForReview(tx, users.admin, { id: late.row.id, seenVersion: 1 }, new Date(future.getTime() + 1))),
      "Süresi doldu",
    );
  });

  test("kaldırılan tür (eski mal siparişi taslağı): açılamaz, kuyruklarda yok, sabah işi canlı kalanları kapatır", async () => {
    // Yeni istek açılamaz (çağıran kalmadı; çekirdek de reddeder)
    await assert.rejects(create(users.selin, { kind: "mal-taslak", subject: subj("tedarikci:yeni") }), /Kaldırılan istek türü: mal-taslak/);
    const future = new Date(Date.now() + 86_400_000);
    const pending = await oldDraft("pending", future);
    const approved = await oldDraft("approved", future);
    const done = await oldDraft("done");
    // Onaylar, Bugün, zil ve sabah e-postası okumaz; Son kararlar da göstermez
    assert.ok(!(await countPendingByKind(db)).some((c) => c.kind === "mal-taslak"), "Bugün / zil sayısı");
    assert.ok(!(await pendingRequests(db)).some((r) => r.kind === "mal-taslak"), "sabah e-postası listesi");
    assert.ok(!(await recentDecisions(db, 30)).some((r) => r.kind === "mal-taslak"), "Son kararlar");
    // Sabah işi: bekleyen ve onaylanmış (gönderilmemiş) eski taslak süresine bakılmadan kapanır; tamamlanmışa dokunulmaz
    const r = await expireStaffRequests(db, new Date());
    assert.ok(r.expired >= 2);
    assert.equal(await statusOf(pending), "expired");
    assert.equal(await statusOf(approved), "expired");
    assert.equal(await statusOf(done), "done");
    assert.ok(!(await recentDecisions(db, 30)).some((x) => x.kind === "mal-taslak"), "kapanan eski taslak Son kararlar'a düşmez");
    // İkinci çalıştırma kapatacak bir şey bulmaz (bu testin satırları için)
    await expireStaffRequests(db, new Date());
    assert.equal(await statusOf(done), "done");
  });

  test("sayılar ve listeler: türe göre bekleyenler, son kararlar (yük yok), kişinin kendi istekleri", async () => {
    const counts = await countPendingByKind(db);
    const kasa = counts.find((c) => c.kind === "kasa-duzeltme");
    assert.ok(kasa && kasa.count >= 1 && kasa.oldestAt instanceof Date);
    const recent = await recentDecisions(db, 30);
    assert.ok(recent.length >= 1);
    assert.ok(!("payload" in recent[0]), "son kararlarda yük yok");
    assert.ok(recent.every((r) => r.status !== "pending"));
    const mine = await ownRequests(db, users.ayse.id, ["kasa-duzeltme", "kasa-silme"] satisfies StaffRequestKind[], 7);
    assert.ok(mine.length >= 1);
    assert.ok(mine.every((r) => r.kind === "kasa-duzeltme" || r.kind === "kasa-silme"));
    assert.ok(!("payload" in mine[0]), "kişinin listesinde ham yük yok");
  });
});
