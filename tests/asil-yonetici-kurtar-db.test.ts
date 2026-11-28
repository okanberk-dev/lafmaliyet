// Asıl yönetici kurtarma betiği, gerçek Postgres'te (scripts/asil-yonetici-kurtar.ts; docs/DEPLOY.md › Asıl yönetici
// kilitlenirse):
// - kuru çalışma (varsayılan) hiçbir şey yazmaz, ne yapılacağını söyler;
// - --uygula iki adımlıyı sıfırlar (anahtar, son adım, kurtarma kodları), hesap ve cihaz kilitlerini açar, oturum
//   sürümünü artırır, işlem geçmişine yazar; parolaya, adrese, role ve erişime dokunmaz; öteki hesaplar değişmez;
// - hesap yoksa ya da yönetici değilse durur, hiçbir şey yazmaz; bilinmeyen seçenekte durur;
// - ekrana sır yazılmaz (parola özeti, iki adımlı anahtarı, kurtarma kodu özeti).
//
// ASIL_KURTAR_TEST_DATABASE_URL verilmezse atlanır. Bir Postgres sunucusunun adresi (veritabanı oluşturabilen kullanıcı):
// test kendi geçici veritabanını açar, göçleri uygular, sonunda siler.
// Çalıştırma: TEST_DATABASE_URL=postgres://localhost/<boş db> npm run test:db -- tests/asil-yonetici-kurtar-db.test.ts

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { desc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { asilYoneticiyiKurtar, KURTARMA_KAYDI, KURTARMA_YAPAN, KurtarmaHatasi, parseKurtarArgs } from "../scripts/asil-yonetici-kurtar";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.ASIL_KURTAR_TEST_DATABASE_URL;
const DB_NAME = `laffogato_asil_kurtar_${process.pid}`;
const ASIL = "asil@ornek.com";
const ENV = { LADMIN_ANA_ADMIN: ASIL };
const HASH = "scrypt$test$parola-ozeti-degismemeli";
const TOTP = "sealed-totp-anahtari-yazdirilmamali";
const CODES = ["kod-ozeti-1-yazdirilmamali", "kod-ozeti-2", "kod-ozeti-3"];

describe("Asıl yönetici kurtarma betiği: veritabanında", { skip: !SERVER_URL && "ASIL_KURTAR_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  const ids = { ana: 0, ali: 0 };

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    const { createDb } = await import("../src/server/db");
    db = createDb(url.href, 1);
    await migrate(db, { migrationsFolder: "drizzle" });
    const locked = new Date(Date.now() + 10 * 60_000);
    const [a] = await db
      .insert(s.users)
      .values({
        name: "Asıl",
        email: ASIL,
        role: "admin",
        passwordHash: HASH,
        totpEnabled: true,
        totpSecret: TOTP,
        totpLastStep: 12345,
        recoveryCodes: CODES,
        failedLogins: 5,
        lockedUntil: locked,
        sessionVersion: 7,
      })
      .returning({ id: s.users.id });
    // Öteki yönetici: kilitli ve iki adımlı; betik ona dokunmamalı
    const [b] = await db
      .insert(s.users)
      .values({ name: "Ali", email: "ali@ornek.com", role: "admin", passwordHash: HASH, totpEnabled: true, totpSecret: TOTP, failedLogins: 5, lockedUntil: locked, sessionVersion: 3 })
      .returning({ id: s.users.id });
    ids.ana = a.id;
    ids.ali = b.id;
    await db.insert(s.loginDeviceLocks).values([
      { userId: a.id, deviceId: "cihaz-1", failedLogins: 10, lockedUntil: locked },
      { userId: a.id, deviceId: "cihaz-2", failedLogins: 3, lockedUntil: null },
      { userId: b.id, deviceId: "cihaz-3", failedLogins: 10, lockedUntil: locked },
    ]);
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  const user = async (id: number) => (await db.select().from(s.users).where(eq(s.users.id, id)))[0];
  const deviceLocks = async (id: number) => db.$count(s.loginDeviceLocks, eq(s.loginDeviceLocks.userId, id));
  const logRows = async () => db.select().from(s.activityLog).orderBy(desc(s.activityLog.id));
  /** Bütün tabloların izi: kuru çalışma ve durdurulan çalışma bunu değiştirmemeli */
  const fingerprint = async () => JSON.stringify([await db.select().from(s.users).orderBy(s.users.id), await db.select().from(s.loginDeviceLocks), await logRows()]);

  test("seçenekler: yalnız --uygula; başka her şeyde durur", () => {
    assert.deepEqual(parseKurtarArgs([]), { uygula: false });
    assert.deepEqual(parseKurtarArgs(["--uygula"]), { uygula: true });
    assert.throws(() => parseKurtarArgs(["--sil"]), KurtarmaHatasi);
    assert.throws(() => parseKurtarArgs(["baska@ornek.com"]), KurtarmaHatasi);
  });

  test("kuru çalışma hiçbir şey yazmaz; ne yapılacağını söyler; sır yazmaz", async () => {
    const before = await fingerprint();
    const lines: string[] = [];
    const r = await asilYoneticiyiKurtar(db, { uygula: false, env: ENV, log: (l) => lines.push(l) });
    assert.deepEqual(r, { yazildi: false, email: ASIL, userId: ids.ana });
    assert.equal(await fingerprint(), before, "veritabanı değişmedi");
    const out = lines.join("\n");
    assert.match(out, /İki adımlı doğrulama kapatılır; 3 kurtarma kodu silinir/);
    assert.match(out, /Hesap kilidi açılır/);
    assert.match(out, /2 cihaz kilidi silinir/);
    assert.match(out, /Oturum sürümü 7 → 8/);
    assert.match(out, /Parolaya dokunulmaz/);
    assert.match(out, /Kuru çalışma: hiçbir şey yazılmadı/);
    for (const secret of [HASH, TOTP, ...CODES]) assert.ok(!out.includes(secret), "sır yazılmadı");
  });

  test("yanlış hesap: adres yoksa ya da yönetici değilse durur, hiçbir şey yazmaz (--uygula ile de)", async () => {
    const before = await fingerprint();
    await assert.rejects(asilYoneticiyiKurtar(db, { uygula: true, env: { LADMIN_ANA_ADMIN: "yok@ornek.com" } }), (e: Error) => e instanceof KurtarmaHatasi && /yok@ornek\.com adresinde hesap yok\. Hiçbir şey yazılmadı/.test(e.message));
    // Varsayılan adres (info@nextgenlab.com.tr) bu veritabanında yok
    await assert.rejects(asilYoneticiyiKurtar(db, { uygula: true, env: {} }), (e: Error) => e instanceof KurtarmaHatasi && /info@nextgenlab\.com\.tr adresinde hesap yok/.test(e.message));
    // Adres bir personelin
    await db.insert(s.users).values({ name: "Ayşe", email: "ayse@ornek.com", role: "staff", passwordHash: HASH, totpEnabled: true, totpSecret: TOTP, sessionVersion: 2 });
    const withStaff = await fingerprint();
    await assert.rejects(asilYoneticiyiKurtar(db, { uygula: true, env: { LADMIN_ANA_ADMIN: "ayse@ornek.com" } }), (e: Error) => e instanceof KurtarmaHatasi && /yönetici değil \(rol: staff\)\. Hiçbir şey yazılmadı/.test(e.message));
    assert.equal(await fingerprint(), withStaff, "personele dokunulmadı");
    await db.delete(s.users).where(eq(s.users.email, "ayse@ornek.com"));
    assert.equal(await fingerprint(), before);
  });

  test("--uygula: iki adımlı sıfır, kilitler açık, oturumlar kapalı, işlem geçmişinde; parola, adres, rol, erişim ve öteki hesap aynı", async () => {
    const ali = await user(ids.ali);
    const lines: string[] = [];
    const r = await asilYoneticiyiKurtar(db, { uygula: true, env: ENV, log: (l) => lines.push(l) });
    assert.deepEqual(r, { yazildi: true, email: ASIL, userId: ids.ana });
    const a = await user(ids.ana);
    assert.deepEqual(
      [a.totpEnabled, a.totpSecret, a.totpLastStep, a.recoveryCodes, a.failedLogins, a.lockedUntil, a.sessionVersion],
      [false, null, null, null, 0, null, 8],
    );
    assert.deepEqual([a.passwordHash, a.email, a.role, a.active, a.name], [HASH, ASIL, "admin", true, "Asıl"], "parola ve hesap aynı");
    assert.equal(await deviceLocks(ids.ana), 0, "cihaz kilitleri silindi");
    // Öteki yönetici hiç değişmedi
    assert.deepEqual(await user(ids.ali), ali);
    assert.equal(await deviceLocks(ids.ali), 1);
    const [log] = await logRows();
    assert.deepEqual([log.action, log.detail, log.userName, log.userId, log.branchId], [KURTARMA_KAYDI, ASIL, KURTARMA_YAPAN, null, null]);
    assert.equal(KURTARMA_KAYDI, "Asıl yönetici hesabı kurtarıldı (komut satırı)");
    const out = lines.join("\n");
    assert.match(out, /✓ Uygulandı/);
    for (const secret of [HASH, TOTP, ...CODES]) assert.ok(!out.includes(secret), "sır yazılmadı");

    // Yeniden çalıştırmak güvenli: oturum sürümü bir daha artar, kayıt bir daha düşer
    await asilYoneticiyiKurtar(db, { uygula: true, env: { LADMIN_ANA_ADMIN: " ASIL@ornek.com " } });
    assert.equal((await user(ids.ana)).sessionVersion, 9, "adresin harf büyüklüğü ve boşluğu fark etmez");
    assert.equal((await logRows()).filter((x) => x.action === KURTARMA_KAYDI).length, 2);
  });
});
