// Personelin mal siparişi taslağı (plan docs/planlar/personel-yetki.md §2.4; src/server/order-drafts/core.ts) gerçek
// Postgres'te: gönder → miktar değiştirerek onayla → gönder; aynı istemci anahtarı ikinci taslak açmaz; `taslak:<id>`
// ikinci sipariş açmaz; tedarikçi başına ikinci canlı taslak reddedilir; geri çekme ile onay yarışında tek sonuç;
// süresi geçmiş taslak gönderilmez; yöneticinin doğrudan gönderimi taslağı kapatır; geri alma (gelmiş ya da faturalı
// siparişte, başkasında ve 10 dakikadan sonra ret); bayat sürüm ve kendi taslağını onaylama reddedilir. Güncellenen
// taslağın işaretleri son gönderime göre; sipariş birimi değişen kalem onaylanmaz ve gönderilmez; süresi dolmuş canlı
// taslak günlük işi beklemeden yerini yenisine bırakır; zil geri alanı yazar.
//
// Tedarikçinin planı (öneri, sayım, kart, numara) sahte `deps` ile gelir: maliyet modeli kurulmaz. Kendi kullanıcılarını
// açar; her test kendi tedarikçi anahtarıyla çalışır (konu başına günlük sınır), sonunda bütün satırlarını siler.
//
// TASLAK_TEST_DATABASE_URL verilmezse atlanır (migration'ları uygulanmış bir yerel veritabanı).
// Çalıştırma: TASLAK_TEST_DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_yetki npx tsx --test tests/mal-siparisi-taslak-db.test.ts

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { and, eq, inArray, like } from "drizzle-orm";

import { businessDate } from "../src/lib/cash-report";
import { draftClean, draftDeadline, DRAFT_TEXT, draftSubject, draftSubmittedAt, parseDraftResult, undoneBellBody } from "../src/lib/reorder/draft";
import type { ReorderLine } from "../src/lib/reorder/types";
import { REQUEST_TEXT } from "../src/lib/staff-requests";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { UserError } from "../src/server/user-error";

import { raceOnRequest } from "./helpers/lock-race";

const URL_ = process.env.TASLAK_TEST_DATABASE_URL;

describe("Mal siparişi taslağı: gerçek veritabanıyla", { skip: !URL_ && "TASLAK_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  let core: typeof import("../src/server/order-drafts/core");
  let queue: typeof import("../src/server/staff-requests/core");
  let data: typeof import("../src/server/data/order-drafts");
  let closeShared: () => Promise<void> = async () => {};
  const tag = `${process.pid}-${randomBytes(3).toString("hex")}`;
  type Who = { id: number; name: string; role: "admin" | "staff" };
  const users: Record<"ali" | "ayse" | "mehmet", Who> = {
    ali: { id: 0, name: "Ali", role: "admin" },
    ayse: { id: 0, name: "Ayşe", role: "staff" },
    mehmet: { id: 0, name: "Mehmet", role: "staff" },
  };
  const SUPPLIER = `Kaldi ${tag}`;
  let n = 0;
  /** Her test kendi tedarikçisiyle (konu başına günlük sınır ve tek canlı taslak birbirini etkilemesin) */
  const newKey = () => `taslak-${tag}-${++n}`;

  // ------------------------------------------------ Sahte plan
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  const state = {
    cardId: 7 as number | null,
    phone: "0532 123 45 67" as string | null,
    lastSentAt: null as string | null,
    countAt: hourAgo,
    countDay: businessDate(now),
    /** Planda olmayan kalemler (listeden çıkarıldı) */
    missing: new Set<number>(),
    /** Kaleme göre son sayımın anı (yeniden sayılan satır) */
    countAtFor: new Map<number, string>(),
    /** Kaleme göre sipariş adı, birimi ve içeriği (Kalemler'de değişti) */
    unitFor: new Map<number, { orderName?: string; unit?: string; unitSize?: number }>(),
  };
  const ING = { sut: 910_001, kahve: 910_002, bardak: 910_003 };
  const planLines = () =>
    [
      { ingredientId: ING.sut, name: "Süt", orderName: "SÜT 1 L", unit: "koli", unitSize: 12_000, countUnit: "LT", countFactor: 1000, suggested: 2, onHand: { base: 3000, at: state.countAt, day: state.countDay }, prevCount: { base: 12_000, day: "2026-10-01" }, perDay: 2000 },
      { ingredientId: ING.kahve, name: "Kahve", orderName: "ESPRESSO 1 KG", unit: "paket", unitSize: 1000, countUnit: "KG", countFactor: 1000, suggested: 1, onHand: { base: 500, at: state.countAt, day: state.countDay }, prevCount: null, perDay: null },
      { ingredientId: ING.bardak, name: "Bardak", orderName: "BARDAK 12 OZ", unit: "koli", unitSize: 1000, countUnit: "ADET", countFactor: 1, suggested: 0, onHand: { base: 900, at: state.countAt, day: state.countDay }, prevCount: null, perDay: null },
    ]
      .filter((l) => !state.missing.has(l.ingredientId))
      .map((l) => ({ ...l, ...state.unitFor.get(l.ingredientId), onHand: { ...l.onHand, at: state.countAtFor.get(l.ingredientId) ?? l.onHand.at } }));
  const deps = {
    plan: async (key: string) => ({
      supplier: { key, name: SUPPLIER, cardId: state.cardId, phone: state.phone },
      signature: "L'Affogato",
      lines: planLines(),
      lastSentAt: state.lastSentAt,
    }),
    snapshot: async (_key: string, wanted: { ingredientId: number; qty: number }[]) => {
      const lines: ReorderLine[] = [];
      for (const w of wanted) {
        const p = planLines().find((l) => l.ingredientId === w.ingredientId);
        if (!p) return { error: "Kalem listede değil" };
        lines.push({ ingredientId: p.ingredientId, name: p.name, orderName: p.orderName, qty: w.qty, unit: p.unit, unitSize: p.unitSize, baseUnit: "ml", countUnit: p.countUnit, leadDays: 2, suggested: p.suggested, onHand: p.onHand.base, par: null, expectedUnitPrice: 40, priceEstimated: false });
      }
      return { supplier: { name: SUPPLIER }, lines, maxLead: 2 };
    },
  };
  const reset = () => {
    state.cardId = 7;
    state.phone = "0532 123 45 67";
    state.lastSentAt = null;
    state.countAt = hourAgo;
    state.countDay = businessDate(now);
    state.missing.clear();
    state.countAtFor.clear();
    state.unitFor.clear();
  };

  const refused = (p: Promise<unknown>, text: string | RegExp) =>
    assert.rejects(p, (e: unknown) => e instanceof UserError && (typeof text === "string" ? e.message === text : text.test(e.message)));
  const submit = (who: Who, key: string, o: { clientKey?: string | null; lines?: { ingredientId: number; qty: number }[]; note?: string | null } = {}) =>
    core.submitDraftCore(
      db,
      who,
      {
        clientKey: o.clientKey ?? null,
        supplierKey: key,
        lines: o.lines ?? [
          { ingredientId: ING.sut, qty: 2 },
          { ingredientId: ING.kahve, qty: 1 },
          { ingredientId: ING.bardak, qty: 0 },
        ],
        supplierNote: o.note ?? null,
      },
      deps,
      now,
    );
  const approve = (who: Who, id: number, version: number, lines: { ingredientId: number; qty: number }[], supplierNote: string | null = null) =>
    core.reviewDraftCore(db, who, { id, seenVersion: version, decision: "approve", lines, supplierNote, note: null }, deps, now);
  const reqRow = async (id: number) => (await db.select().from(s.staffRequests).where(eq(s.staffRequests.id, id)))[0];
  const ordersOf = async (id: number) => db.select().from(s.supplierOrders).where(eq(s.supplierOrders.requestId, `taslak:${id}`));

  before(async () => {
    process.env.DATABASE_URL = URL_;
    const require = createRequire(import.meta.url);
    const marker = require.resolve("server-only");
    require.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as unknown as NodeJS.Module;
    const dbModule = await import("../src/server/db");
    db = dbModule.createDb(URL_!, 4);
    core = await import("../src/server/order-drafts/core");
    queue = await import("../src/server/staff-requests/core");
    // Zilin okuyucusu paylaşılan bağlantıyla (getDb, DATABASE_URL)
    data = await import("../src/server/data/order-drafts");
    closeShared = () => dbModule.getDb().$client.end();
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db.insert(s.users).values({ email: `taslak-${k}-${tag}@ornek.com`, name: users[k].name, passwordHash: "x", role: users[k].role }).returning({ id: s.users.id });
      users[k].id = u.id;
    }
  });

  after(async () => {
    if (!db) return;
    await db.delete(s.supplierOrders).where(eq(s.supplierOrders.supplier, SUPPLIER));
    await db.delete(s.staffRequests).where(like(s.staffRequests.subject, `tedarikci:taslak-${tag}-%`));
    const uids = Object.values(users).map((u) => u.id).filter(Boolean);
    if (uids.length) {
      await db.delete(s.activityLog).where(inArray(s.activityLog.userId, uids));
      await db.delete(s.users).where(inArray(s.users.id, uids));
    }
    await db.$client.end();
    await closeShared();
  });

  test("gönder → miktar değiştirerek onayla → gönder: önce kayıt, mesajda onay numarası, onaylanan miktarlar", async () => {
    reset();
    const key = newKey();
    const sub = await submit(users.ayse, key, { note: "Perşembe sabah" });
    assert.equal(sub.created, true);
    assert.equal(sub.row.status, "pending");
    assert.equal(sub.row.subject, draftSubject(key));
    assert.equal(sub.row.title, `${SUPPLIER} · 2 kalem`);
    // Önerisi 0 olan ve 0 bırakılan satır taslağa girmez; fiyat yükte yok
    assert.deepEqual(sub.payload.lines.map((l) => l.ingredientId).sort(), [ING.sut, ING.kahve].sort());
    assert.doesNotMatch(JSON.stringify(sub.row.payload), /price|cost|estimate|payable/i);
    assert.ok(sub.row.expiresAt && sub.row.expiresAt.getTime() > now.getTime());

    const ok = await approve(users.ali, sub.row.id, sub.row.version, [
      { ingredientId: ING.sut, qty: 3 },
      { ingredientId: ING.kahve, qty: 0 },
    ], "Perşembe sabah 10'dan önce");
    assert.equal(ok.status, "approved");
    const res = parseDraftResult(ok.row.result)!;
    assert.equal(res.edited, true);
    assert.match(res.message, /• SÜT 1 L: 3 koli/);
    assert.doesNotMatch(res.message, /ESPRESSO/);
    assert.match(res.message, new RegExp(`Onay no: #${sub.row.id}`));
    assert.match(res.message, /Not: Perşembe sabah 10'dan önce/);

    const sent = await core.sendDraftCore(db, users.mehmet, { id: sub.row.id }, deps, now);
    assert.equal(sent.again, false);
    assert.match(sent.href, /^https:\/\/wa\.me\/905321234567\?text=/);
    const [order] = await ordersOf(sub.row.id);
    assert.ok(order);
    assert.equal(order.id, sent.orderId);
    assert.equal(order.sentByName, "Mehmet");
    assert.equal(order.message, res.message);
    assert.deepEqual(
      order.lines.map((l) => [l.ingredientId, l.qty]),
      [[ING.sut, 3]],
    );
    const done = await reqRow(sub.row.id);
    assert.equal(done.status, "done");
    assert.equal(done.resultId, order.id);
  });

  test("aynı istemci anahtarı ikinci taslak açmaz; kendi bekleyeni güncellenir (sürüm artar)", async () => {
    reset();
    const key = newKey();
    const ck = `ck-${tag}-${key}`;
    const a = await submit(users.ayse, key, { clientKey: ck });
    const b = await submit(users.ayse, key, { clientKey: ck });
    assert.equal(b.created, false);
    assert.equal(b.row.id, a.row.id);
    assert.equal(b.row.version, a.row.version);
    assert.equal(b.pushDue, false);
    const c = await submit(users.ayse, key, { clientKey: `${ck}-2`, lines: [{ ingredientId: ING.sut, qty: 4 }] });
    assert.equal(c.row.id, a.row.id);
    assert.equal(c.row.version, a.row.version + 1);
    // Güncelleme 15 dakika içinde: push yeniden gitmez
    assert.equal(c.pushDue, false);
    const rows = await db.select().from(s.staffRequests).where(eq(s.staffRequests.subject, draftSubject(key)));
    assert.equal(rows.length, 1);
  });

  test("`taslak:<id>` ikinci sipariş açmaz: gönderen 10 dakika içinde aynı siparişi yeniden açar, başkası açamaz", async () => {
    reset();
    const key = newKey();
    const sub = await submit(users.ayse, key);
    await approve(users.ali, sub.row.id, sub.row.version, [{ ingredientId: ING.sut, qty: 2 }]);
    const first = await core.sendDraftCore(db, users.ayse, { id: sub.row.id }, deps, now);
    const again = await core.sendDraftCore(db, users.ayse, { id: sub.row.id }, deps, new Date(now.getTime() + 60_000));
    assert.equal(again.again, true);
    assert.equal(again.orderId, first.orderId);
    await refused(core.sendDraftCore(db, users.mehmet, { id: sub.row.id }, deps, now), "Bu taslak zaten gönderildi");
    await refused(core.sendDraftCore(db, users.ayse, { id: sub.row.id }, deps, new Date(now.getTime() + 11 * 60_000)), "Bu taslak zaten gönderildi");
    // Aynı anda iki gönderim: tek sipariş
    const key2 = newKey();
    const sub2 = await submit(users.ayse, key2);
    await approve(users.ali, sub2.row.id, sub2.row.version, [{ ingredientId: ING.sut, qty: 2 }]);
    await Promise.allSettled([core.sendDraftCore(db, users.ayse, { id: sub2.row.id }, deps, now), core.sendDraftCore(db, users.mehmet, { id: sub2.row.id }, deps, now)]);
    assert.equal((await ordersOf(sub2.row.id)).length, 1);
    assert.equal((await ordersOf(sub.row.id)).length, 1);
  });

  test("tedarikçi başına tek canlı taslak: başkasınınki beklerken ya da onaylıyken ikincisi reddedilir", async () => {
    reset();
    const key = newKey();
    const a = await submit(users.ayse, key);
    await refused(submit(users.mehmet, key), /onay bekliyor \(Ayşe\)/);
    await approve(users.ali, a.row.id, a.row.version, [{ ingredientId: ING.sut, qty: 2 }]);
    await refused(submit(users.mehmet, key), /onaylandı \(Ayşe\)/);
    await refused(submit(users.ayse, key), DRAFT_TEXT.ownApproved);
  });

  test("geri çekme ile onay yarışında tek sonuç kalır", async () => {
    reset();
    const key = newKey();
    const a = await submit(users.ayse, key);
    const [w, r] = await Promise.allSettled([queue.withdrawOwn(db, users.ayse, a.row.id, now), approve(users.ali, a.row.id, a.row.version, [{ ingredientId: ING.sut, qty: 2 }])]);
    assert.equal([w, r].filter((x) => x.status === "fulfilled").length, 1);
    const row = await reqRow(a.row.id);
    assert.equal(row.status, w.status === "fulfilled" ? "withdrawn" : "approved");
  });

  test("kilit sırası: taslağını güncelleyen personel, aynı anda verilen onayla kilitlenmez (tedarikçinin kilidi, sonra istek)", async () => {
    reset();
    const key = newKey();
    const a = await submit(users.ayse, key);
    const [r, edit] = await raceOnRequest(
      URL_!,
      a.row.id,
      () => approve(users.ali, a.row.id, a.row.version, [{ ingredientId: ING.sut, qty: 2 }]),
      () => submit(users.ayse, key, { clientKey: `ck-${tag}-${key}-yarış`, lines: [{ ingredientId: ING.sut, qty: 5 }] }),
    );
    assert.equal(r.status, "fulfilled");
    // Onaylanmış taslak güncellenmez: temiz bir hatayla düşer
    assert.equal(edit.status, "rejected");
    assert.equal(((edit as PromiseRejectedResult).reason as Error).message, DRAFT_TEXT.ownApproved);
    assert.equal((await reqRow(a.row.id)).status, "approved");
  });

  test("süresi geçmiş taslak gönderilmez; tedarikçi kartı değiştiyse taslak düşer; bu arada sipariş gittiyse kapanır", async () => {
    reset();
    const key = newKey();
    const a = await submit(users.ayse, key);
    await approve(users.ali, a.row.id, a.row.version, [{ ingredientId: ING.sut, qty: 2 }]);
    await refused(core.sendDraftCore(db, users.ayse, { id: a.row.id }, deps, new Date(now.getTime() + 3 * 86_400_000)), DRAFT_TEXT.expired);
    // Günlük iş onaylı ama gönderilmemiş taslağı da kapatır
    await queue.expireStaffRequests(db, new Date(now.getTime() + 3 * 86_400_000));
    assert.equal((await reqRow(a.row.id)).status, "expired");
    assert.equal((await ordersOf(a.row.id)).length, 0);

    const key2 = newKey();
    const b = await submit(users.ayse, key2);
    await approve(users.ali, b.row.id, b.row.version, [{ ingredientId: ING.sut, qty: 2 }]);
    state.cardId = 8;
    await refused(core.sendDraftCore(db, users.ayse, { id: b.row.id }, deps, now), DRAFT_TEXT.supplierChanged);
    const gone = await reqRow(b.row.id);
    assert.equal(gone.status, "expired");
    assert.equal(gone.reviewNote, DRAFT_TEXT.supplierChanged);

    reset();
    const key3 = newKey();
    const c = await submit(users.ayse, key3);
    await approve(users.ali, c.row.id, c.row.version, [{ ingredientId: ING.sut, qty: 2 }]);
    state.lastSentAt = new Date(now.getTime() + 1000).toISOString();
    await refused(core.sendDraftCore(db, users.ayse, { id: c.row.id }, deps, now), DRAFT_TEXT.sentMeanwhile);
    assert.equal((await reqRow(c.row.id)).status, "superseded");
  });

  test("yöneticinin doğrudan gönderimi (recordOrderSent'in yolu) canlı taslağı kapatır", async () => {
    reset();
    const key = newKey();
    const a = await submit(users.ayse, key);
    const closed = await db.transaction(async (tx) => {
      await core.lockSupplier(tx, key);
      return core.supersedeLiveDraft(tx, key, users.ali, now);
    });
    assert.deepEqual(closed, [a.row.id]);
    const row = await reqRow(a.row.id);
    assert.equal(row.status, "superseded");
    assert.equal(row.reviewedByName, "Ali");
    assert.equal(row.reviewNote, DRAFT_TEXT.superseded);
    await refused(core.sendDraftCore(db, users.ayse, { id: a.row.id }, deps, now), DRAFT_TEXT.superseded);
  });

  test("geri alma: yalnız gönderen, 10 dakika içinde; gelmiş ya da faturalı siparişte ret; geri alınan taslak son durumdur", async () => {
    reset();
    const sendOne = async () => {
      const key = newKey();
      const a = await submit(users.ayse, key);
      await approve(users.ali, a.row.id, a.row.version, [{ ingredientId: ING.sut, qty: 2 }]);
      const sent = await core.sendDraftCore(db, users.ayse, { id: a.row.id }, deps, now);
      return { id: a.row.id, orderId: sent.orderId, key };
    };
    const x = await sendOne();
    await refused(core.undoDraftSendCore(db, users.mehmet, { id: x.id }, now), DRAFT_TEXT.undoNotYours);
    await refused(core.undoDraftSendCore(db, users.ayse, { id: x.id }, new Date(now.getTime() + 11 * 60_000)), DRAFT_TEXT.undoGone);
    await db.update(s.supplierOrders).set({ receivedAt: now, receivedByName: "Ayşe" }).where(eq(s.supplierOrders.id, x.orderId));
    await refused(core.undoDraftSendCore(db, users.ayse, { id: x.id }, now), DRAFT_TEXT.undoGone);

    const [inv] = await db.select({ id: s.invoices.id }).from(s.invoices).limit(50);
    if (inv) {
      const taken = await db.select({ id: s.supplierOrders.id }).from(s.supplierOrders).where(eq(s.supplierOrders.invoiceId, inv.id));
      if (!taken.length) {
        const y = await sendOne();
        await db.update(s.supplierOrders).set({ invoiceId: inv.id }).where(eq(s.supplierOrders.id, y.orderId));
        await refused(core.undoDraftSendCore(db, users.ayse, { id: y.id }, now), DRAFT_TEXT.undoGone);
        await db.update(s.supplierOrders).set({ invoiceId: null }).where(eq(s.supplierOrders.id, y.orderId));
      }
    }

    const z = await sendOne();
    const out = await core.undoDraftSendCore(db, users.ayse, { id: z.id }, now);
    assert.equal(out.orderId, z.orderId);
    const [order] = await db.select().from(s.supplierOrders).where(eq(s.supplierOrders.id, z.orderId));
    assert.equal(order.status, "cancelled");
    assert.equal((await reqRow(z.id)).status, "cancelled");
    // Yeniden göndermek ve aynı siparişi açmak yok; yeni taslak açılabilir
    await refused(core.sendDraftCore(db, users.ayse, { id: z.id }, deps, now), DRAFT_TEXT.notApproved);
    const fresh = await submit(users.ayse, z.key);
    assert.notEqual(fresh.row.id, z.id);
    assert.equal(fresh.row.status, "pending");
  });

  test("bayat sürüm, kendi taslağını onaylama, notsuz ret ve taslakta olmayan kalem reddedilir", async () => {
    reset();
    const key = newKey();
    const a = await submit(users.ayse, key);
    const b = await submit(users.ayse, key, { lines: [{ ingredientId: ING.sut, qty: 5 }] });
    assert.equal(b.row.version, a.row.version + 1);
    await refused(approve(users.ali, a.row.id, a.row.version, [{ ingredientId: ING.sut, qty: 2 }]), REQUEST_TEXT.changed);
    await refused(approve({ ...users.ayse, role: "admin" }, a.row.id, b.row.version, [{ ingredientId: ING.sut, qty: 2 }]), REQUEST_TEXT.self);
    await refused(core.reviewDraftCore(db, users.ali, { id: a.row.id, seenVersion: b.row.version, decision: "reject", lines: null, supplierNote: null, note: null }, deps, now), DRAFT_TEXT.rejectNote);
    await refused(approve(users.ali, a.row.id, b.row.version, [{ ingredientId: 999_999, qty: 1 }]), /Taslakta olmayan/);
    // Listeden çıkan kalem onaylanamaz
    state.missing.add(ING.sut);
    await refused(approve(users.ali, a.row.id, b.row.version, [{ ingredientId: ING.sut, qty: 2 }]), /artık bu tedarikçinin listesinde değil/);
    state.missing.clear();
    const r = await core.reviewDraftCore(db, users.ali, { id: a.row.id, seenVersion: b.row.version, decision: "reject", lines: null, supplierNote: null, note: "Bu hafta süt gerekmiyor" }, deps, now);
    assert.equal(r.status, "rejected");
    assert.equal((await reqRow(a.row.id)).reviewNote, "Bu hafta süt gerekmiyor");
  });

  test("güncellenen taslağın işaretleri son gönderime göre: taslaktan sonra yeniden sayılan satır işaretlenir, İşaretsizleri onayla almaz", async () => {
    reset();
    const key = newKey();
    const lines = [
      { ingredientId: ING.sut, qty: 2 },
      { ingredientId: ING.kahve, qty: 1 },
    ];
    const at = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000);
    state.countAt = at(60).toISOString();
    const a = await core.submitDraftCore(db, users.mehmet, { clientKey: null, supplierKey: key, lines, supplierNote: null }, deps, at(50));
    // Süt 55 dakika sonra yeniden sayıldı (daha az), taslak 3 dakika sonra başka bir sekmeden yeniden gönderildi
    state.countAtFor.set(ING.sut, at(5).toISOString());
    const b = await core.submitDraftCore(db, users.mehmet, { clientKey: `ck-${tag}-${key}-2`, supplierKey: key, lines, supplierNote: null }, deps, at(2));
    assert.equal(b.row.id, a.row.id);
    assert.equal(b.row.createdAt.getTime(), at(50).getTime(), "satırın açıldığı an değişmez");
    assert.equal(b.payload.submittedAt, at(2).toISOString());
    assert.equal(draftSubmittedAt(b.row, b.payload).getTime(), at(2).getTime());
    // Açıldığı ana göre temiz görünürdü; son gönderime göre "Sayım taslaktan 3 dk önce değişti"
    assert.equal(draftClean(b.payload, b.row.createdAt), true);
    assert.equal(draftClean(b.payload, draftSubmittedAt(b.row, b.payload)), false);
    const out = await core.approveCleanCore(db, users.ali, [{ id: a.row.id, seenVersion: b.row.version }], deps, now);
    assert.deepEqual(out.approved, []);
    assert.deepEqual(out.skipped, [{ id: a.row.id, reason: "İşaretli ya da öneriden farklı" }]);
    assert.equal((await reqRow(a.row.id)).status, "pending");
    await queue.withdrawOwn(db, users.mehmet, a.row.id, now);
  });

  test("kalemin sipariş birimi ya da adı taslaktan sonra değiştiyse: onaylanmaz, onaylıysa gönderilmez ve taslak kapanır", async () => {
    reset();
    const key = newKey();
    const a = await submit(users.mehmet, key);
    await approve(users.ali, a.row.id, a.row.version, [{ ingredientId: ING.sut, qty: 2 }]);
    // Yönetici Kalemler'de Süt'ün sipariş birimini koliden LT'ye çevirdi: mesaj "2 koli", kayıt 2 LT derdi
    state.unitFor.set(ING.sut, { unit: "LT", unitSize: 1000 });
    await refused(core.sendDraftCore(db, users.mehmet, { id: a.row.id }, deps, now), DRAFT_TEXT.linesChanged);
    const row = await reqRow(a.row.id);
    assert.equal(row.status, "expired");
    assert.equal(row.reviewNote, DRAFT_TEXT.linesChanged);
    assert.equal((await ordersOf(a.row.id)).length, 0);
    // Yalnız içerik (koli 12 LT → 6 LT) de değişiklik sayılır
    reset();
    const b = await submit(users.mehmet, newKey());
    await approve(users.ali, b.row.id, b.row.version, [{ ingredientId: ING.sut, qty: 2 }]);
    state.unitFor.set(ING.sut, { unitSize: 6000 });
    await refused(core.sendDraftCore(db, users.mehmet, { id: b.row.id }, deps, now), DRAFT_TEXT.linesChanged);
    // Onayda: adı değişen kalem onaylanmaz, değişmeyen onaylanır
    reset();
    const c = await submit(users.mehmet, newKey());
    state.unitFor.set(ING.sut, { orderName: "SÜT 1 L TAM YAĞLI" });
    await refused(approve(users.ali, c.row.id, c.row.version, [{ ingredientId: ING.sut, qty: 2 }]), `Süt: ${DRAFT_TEXT.unitChanged}`);
    const ok = await approve(users.ali, c.row.id, c.row.version, [
      { ingredientId: ING.sut, qty: 0 },
      { ingredientId: ING.kahve, qty: 1 },
    ]);
    assert.equal(ok.status, "approved");
    const sent = await core.sendDraftCore(db, users.mehmet, { id: c.row.id }, deps, now);
    assert.equal(sent.lineCount, 1);
  });

  test("süresi dolmuş canlı taslak günlük işi beklemez: gönderim denemesi kapatır, hazırlayan da başkası da yeni taslak açar", async () => {
    reset();
    const later = new Date(draftDeadline(now).getTime() + 60_000);
    // Onaylı taslağın son anı geçti; günlük iş (expireStaffRequests) henüz çalışmadı
    const key = newKey();
    const a = await submit(users.ayse, key);
    await approve(users.ali, a.row.id, a.row.version, [{ ingredientId: ING.sut, qty: 2 }]);
    await refused(core.sendDraftCore(db, users.ayse, { id: a.row.id }, deps, later), DRAFT_TEXT.expired);
    assert.equal((await reqRow(a.row.id)).status, "expired");
    // O günün sayımı
    state.countDay = businessDate(later);
    state.countAt = new Date(later.getTime() - 60_000).toISOString();
    const again = await core.submitDraftCore(db, users.ayse, { clientKey: null, supplierKey: key, lines: [{ ingredientId: ING.sut, qty: 2 }], supplierNote: null }, deps, later);
    assert.equal(again.created, true);
    await queue.withdrawOwn(db, users.ayse, again.row.id, later);
    // Başkasının süresi dolmuş, onaylı ve gönderilmemiş taslağı (kimse göndermeyi denemedi)
    reset();
    const key2 = newKey();
    const b = await submit(users.ayse, key2);
    await approve(users.ali, b.row.id, b.row.version, [{ ingredientId: ING.sut, qty: 2 }]);
    state.countDay = businessDate(later);
    state.countAt = new Date(later.getTime() - 60_000).toISOString();
    const other = await core.submitDraftCore(db, users.mehmet, { clientKey: null, supplierKey: key2, lines: [{ ingredientId: ING.sut, qty: 2 }], supplierNote: null }, deps, later);
    assert.equal(other.created, true);
    assert.equal((await reqRow(b.row.id)).status, "expired");
    // Süresi dolmamış taslak yine yerini korur
    reset();
    const key3 = newKey();
    await submit(users.ayse, key3);
    await refused(submit(users.mehmet, key3), /onay bekliyor \(Ayşe\)/);
    await queue.withdrawOwn(db, users.mehmet, other.row.id, later);
  });

  test("zil (yönetici): geri alınan gönderimde geri alan yazılır, hazırlayan değil", async () => {
    reset();
    const key = newKey();
    const a = await submit(users.ayse, key);
    await approve(users.ali, a.row.id, a.row.version, [{ ingredientId: ING.sut, qty: 2 }]);
    // Bugün satırından Mehmet gönderdi ve geri aldı
    await core.sendDraftCore(db, users.mehmet, { id: a.row.id }, deps, now);
    await core.undoDraftSendCore(db, users.mehmet, { id: a.row.id }, now);
    const rows = await data.draftBellRows({ since: new Date(now.getTime() - 86_400_000) });
    const row = rows.find((r) => r.id === a.row.id);
    assert.ok(row);
    assert.equal(row.status, "cancelled");
    assert.equal(row.undoneByName, "Mehmet");
    assert.equal(undoneBellBody(row), "Mehmet gönderimi geri aldı (Ayşe hazırlamıştı); tedarikçiye iptal yazılmalı.");
  });

  test("personelin taslağı: yönetici açamaz; cep numarası, taze sayım ve son sayımdan sonra sipariş yok koşulları", async () => {
    reset();
    await refused(submit(users.ali, newKey()), DRAFT_TEXT.admin);
    state.phone = "0216 123 45 67";
    await refused(submit(users.ayse, newKey()), DRAFT_TEXT.noPhone);
    reset();
    state.countDay = "2026-01-01";
    await refused(submit(users.ayse, newKey()), /^Önce hızlı sayım yapın: Süt dünden önce sayıldı/);
    reset();
    state.lastSentAt = new Date(Date.parse(state.countAt) + 60_000).toISOString();
    await refused(submit(users.ayse, newKey()), /sipariş gönderildi$/);
    reset();
    await refused(submit(users.ayse, newKey(), { lines: [{ ingredientId: ING.sut, qty: 0 }] }), DRAFT_TEXT.noLines);
    // Kayıtlar: hiçbiri açılmadı
    const rows = await db
      .select({ id: s.staffRequests.id })
      .from(s.staffRequests)
      .where(and(like(s.staffRequests.subject, `tedarikci:taslak-${tag}-%`), eq(s.staffRequests.requestedBy, users.ali.id)));
    assert.equal(rows.length, 0);
  });
});
