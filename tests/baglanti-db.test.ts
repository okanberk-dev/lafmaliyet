// Eşzamanlı yazımlar, gerçek Postgres'te: bilinen cihazın giriş sayacı (10. hatada kilit, kilitliyken sayılmaz, aynı
// anda gelen denemeler sınırı aşamaz, geri verme ve silme), iki adımlı kodun ve kurtarma kodunun tek kullanımı (aynı
// anda iki gönderimden yalnız biri), karaoke uzatması (aynı anda iki +15 ikisi de sayılır, 12 saat sınırı, iptal),
// kasadan çıkanın geri alınması (satır eski numarasıyla döner; ikinci deneme birincil anahtara takılır).
// Kendi kullanıcısını, oturumunu ve satırını açar, sonunda siler.
//
// BAGLANTI_TEST_DATABASE_URL verilmezse atlanır (migration'ları uygulanmış bir yerel veritabanı).
// Çalıştırma: BAGLANTI_TEST_DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_baglanti npx tsx --test tests/baglanti-db.test.ts

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { and, eq } from "drizzle-orm";

import { clearDeviceAttempts, consumeRecoveryList, consumeTotpStep, DEVICE_MAX_FAILED, refundDeviceAttempt, reserveDeviceAttempt } from "../src/server/auth/login-locks";
import { createDb, type DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { addExtraMinutes, MAX_EXTRA_MINUTES } from "../src/server/karaoke/extend";

const URL = process.env.BAGLANTI_TEST_DATABASE_URL;

describe("Bağlantı ve giriş: veritabanında eşzamanlı yazımlar", { skip: !URL && "BAGLANTI_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  const tag = `${process.pid}-${randomBytes(3).toString("hex")}`;
  let userId = 0;
  const sessions: number[] = [];

  before(async () => {
    db = createDb(URL!, 8);
    const [u] = await db
      .insert(s.users)
      .values({ email: `baglanti-${tag}@ornek.com`, name: `Deneme ${tag}`, passwordHash: "x", role: "staff" })
      .returning({ id: s.users.id });
    userId = u.id;
  });

  after(async () => {
    if (!db) return;
    if (sessions.length) for (const id of sessions) await db.delete(s.karaokeSessions).where(eq(s.karaokeSessions.id, id));
    if (userId) await db.delete(s.users).where(eq(s.users.id, userId));
    await db.$client.end();
  });

  const row = async (did: string) =>
    (await db.select().from(s.loginDeviceLocks).where(and(eq(s.loginDeviceLocks.userId, userId), eq(s.loginDeviceLocks.deviceId, did))))[0];

  test("cihaz sayacı: 10. hatada 15 dakika kilit, kilitliyken sayılmaz; geri verme kilidi kaldırır; başarı siler", async () => {
    const did = `cihaz-a-${tag}`;
    for (let i = 1; i < DEVICE_MAX_FAILED; i++) {
      const r = await reserveDeviceAttempt(db, userId, did);
      assert.deepEqual(r, { ok: true, locked: null }, `deneme ${i}`);
    }
    const tenth = await reserveDeviceAttempt(db, userId, did);
    assert.ok(tenth.ok && tenth.locked, "10. deneme değerlendirilir ve kilidi başlatır");
    const minutes = ((tenth as { locked: Date }).locked.getTime() - Date.now()) / 60_000;
    assert.ok(minutes > 14 && minutes <= 15, `kilit ~15 dk (${minutes})`);
    assert.equal((await row(did)).failedLogins, 0, "kilitlenince sayaç sıfır");
    const refused = await reserveDeviceAttempt(db, userId, did);
    assert.equal(refused.ok, false);
    assert.equal((await row(did)).failedLogins, 0, "kilitliyken satır değişmez");
    // Parola doğruydu, kod adımına geçiliyor: bu denemenin başlattığı kilit kalkar, sayaç 9'da kalır
    await refundDeviceAttempt(db, userId, did);
    const after = await row(did);
    assert.deepEqual([after.failedLogins, after.lockedUntil], [DEVICE_MAX_FAILED - 1, null]);
    await clearDeviceAttempts(db, userId, did);
    assert.equal(await row(did), undefined);
  });

  test("cihaz sayacı: aynı anda gelen 25 deneme sınırı aşamaz; başka cihaz ve kişi etkilenmez", async () => {
    const did = `cihaz-b-${tag}`;
    const results = await Promise.all(Array.from({ length: 25 }, () => reserveDeviceAttempt(db, userId, did)));
    const accepted = results.filter((r) => r.ok);
    assert.equal(accepted.length, DEVICE_MAX_FAILED, "tam 10 deneme değerlendirilir");
    assert.equal(accepted.filter((r) => r.ok && r.locked).length, 1, "kilidi tek deneme başlatır");
    // Başka bir cihazın payı ayrı (ortak tablette biri kişinin öteki cihazlarını kilitleyemez)
    assert.deepEqual(await reserveDeviceAttempt(db, userId, `cihaz-c-${tag}`), { ok: true, locked: null });
    await clearDeviceAttempts(db, userId, did);
    await clearDeviceAttempts(db, userId, `cihaz-c-${tag}`);
  });

  test("iki adımlı kod: aynı adım aynı anda beş kez gönderilse de yalnız biri geçer; eski adım geçmez", async () => {
    await db.update(s.users).set({ totpLastStep: 100 }).where(eq(s.users.id, userId));
    const wins = await Promise.all(Array.from({ length: 5 }, () => consumeTotpStep(db, userId, 101)));
    assert.equal(wins.filter(Boolean).length, 1);
    assert.equal(await consumeTotpStep(db, userId, 101), false, "aynı kod ikinci kez");
    assert.equal(await consumeTotpStep(db, userId, 99), false, "eski kod");
    assert.equal(await consumeTotpStep(db, userId, 102), true);
    await db.update(s.users).set({ totpLastStep: null }).where(eq(s.users.id, userId));
    assert.equal(await consumeTotpStep(db, userId, 5), true, "ilk kod (kayıtlı adım yok)");
  });

  test("kurtarma kodu: aynı kod aynı anda iki kez harcanamaz; liste arada değiştiyse yazılmaz", async () => {
    await db.update(s.users).set({ recoveryCodes: ["v2$a", "v2$b", "v2$c"] }).where(eq(s.users.id, userId));
    const wins = await Promise.all(Array.from({ length: 3 }, () => consumeRecoveryList(db, userId, ["v2$a", "v2$b", "v2$c"], ["v2$b", "v2$c"])));
    assert.equal(wins.filter(Boolean).length, 1);
    const [u] = await db.select({ codes: s.users.recoveryCodes }).from(s.users).where(eq(s.users.id, userId));
    assert.deepEqual(u.codes, ["v2$b", "v2$c"]);
    // Kodlar yenilendiyse eski liste üzerinden harcama yazılmaz
    assert.equal(await consumeRecoveryList(db, userId, ["v2$a", "v2$b", "v2$c"], ["v2$a"]), false);
  });

  test("karaoke uzatması: aynı anda iki +15 ikisi de sayılır; 12 saati aşan ve iptal edilen uzatılmaz", async () => {
    const start = new Date(Date.now() - 30 * 60_000);
    const [k] = await db
      .insert(s.karaokeSessions)
      .values({ source: "panel", date: "2026-10-23", startsAt: start, endsAt: new Date(start.getTime() + 60 * 60_000), customerName: `Deneme ${tag}` })
      .returning({ id: s.karaokeSessions.id });
    sessions.push(k.id);
    await db.update(s.karaokeSessions).set({ endedAt: new Date(), endedBy: "Ayşe" }).where(eq(s.karaokeSessions.id, k.id));
    const both = await Promise.all([addExtraMinutes(db, k.id, 15), addExtraMinutes(db, k.id, 15)]);
    assert.deepEqual(both.map((r) => r?.extraMinutes).sort(), [15, 30], "okuyup yazınca biri kayboluyordu");
    const [cur] = await db.select().from(s.karaokeSessions).where(eq(s.karaokeSessions.id, k.id));
    assert.deepEqual([cur.extraMinutes, cur.endedAt, cur.endedBy], [30, null, null], "susturulmuş oturum yeniden açılır");

    await db.update(s.karaokeSessions).set({ extraMinutes: MAX_EXTRA_MINUTES - 10 }).where(eq(s.karaokeSessions.id, k.id));
    assert.equal(await addExtraMinutes(db, k.id, 15), null, "12 saat sınırı aynı yazımda");
    assert.deepEqual(await addExtraMinutes(db, k.id, 10), { extraMinutes: MAX_EXTRA_MINUTES });
    await db.update(s.karaokeSessions).set({ status: "cancelled", extraMinutes: 0 }).where(eq(s.karaokeSessions.id, k.id));
    assert.equal(await addExtraMinutes(db, k.id, 15), null, "iptal edilen uzatılmaz");
    assert.equal(await addExtraMinutes(db, 2_000_000_000, 15), null, "olmayan oturum");
  });

  test("kasadan çıkanı geri alma: satır eski numarasıyla döner; aynı anda iki deneme tek satır açar", async () => {
    const values = { date: "2026-10-23", kind: "teslim" as const, amount: 100, store: `Deneme ${tag}`, createdBy: userId, createdByName: `Deneme ${tag}` };
    const [row] = await db.insert(s.cashOuts).values(values).returning({ id: s.cashOuts.id });
    await db.delete(s.cashOuts).where(eq(s.cashOuts.id, row.id));
    // restoreCashOut'un yazımı: { ...values, id: restoreId }; ikincisi birincil anahtara takılır (eylem "zaten geri alındı" der)
    const tries = await Promise.allSettled([0, 1].map(() => db.insert(s.cashOuts).values({ ...values, id: row.id }).returning({ id: s.cashOuts.id })));
    try {
      assert.equal(tries.filter((t) => t.status === "fulfilled").length, 1, "tek satır");
      const lost = tries.find((t) => t.status === "rejected") as PromiseRejectedResult;
      const e = lost.reason as { constraint_name?: string; cause?: { constraint_name?: string } };
      assert.equal(e.constraint_name ?? e.cause?.constraint_name, "cash_outs_pkey", "eylemin baktığı kısıt adı");
      assert.equal((await db.select().from(s.cashOuts).where(eq(s.cashOuts.id, row.id))).length, 1);
    } finally {
      await db.delete(s.cashOuts).where(eq(s.cashOuts.id, row.id));
    }
  });
});
