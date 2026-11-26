// Personel belgeleri ve avansları gerçek Postgres'te (docs/PERSONEL-BELGE.md). Kendi geçici veritabanını açar
// (migration'larla), sonunda siler; dosyalar bellek deposunda (src/server/storage/drivers.ts memoryDriver), oturum taklit.
//
// - Belge: dosyalı ekleme (tür içerikten; önce depo, sonra satır), dosyanın adı ve baytları, silince depodan da gider;
//   bozuk dosya ve depo yokken dosya reddedilir, dosyasız kayıt yine yapılır; kişi başına sınır.
// - Hatırlatma: biten ve 30 gün içinde biten, yenilenen hariç; seçili şubenin kişileri; sabah e-postasının kutusu her
//   aşamada bir kez (notification_log).
// - Avans: kesinti kalanı aşamaz; aynı anda iki kesinti kalanı birlikte aşamaz (kişinin satırı kilitli); kesintisi
//   yazılmış avans silinmez.
// - Maaşlar: avans hareketi olan kişi silinemez; silinen kişinin belge dosyaları depodan da gider.
//
// PERSONEL_TEST_DATABASE_URL (yoksa LAFPOS_TEST_DATABASE_URL) verilmezse atlanır: bir Postgres sunucusu.
// Çalıştırma: TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/lm_personel npm run test:db -- tests/personel-belge-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

import { seedBranches } from "./helpers/subeler";

const SERVER_URL = process.env.PERSONEL_TEST_DATABASE_URL ?? process.env.LAFPOS_TEST_DATABASE_URL;
const DB_NAME = `laffogato_personel_${process.pid}`;
const TODAY = "2026-11-26";
const ME = { id: 0, name: "Ali", email: "ali@laffogato.net", role: "admin" as const };

/** En küçük geçerli PDF başı ve JPEG başı (tür içerikten okunur) */
const PDF = new Uint8Array([...Buffer.from("%PDF-1.4\n% deneme belgesi\n")]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

describe("Personel belgeleri ve avanslar: veritabanında", { skip: !SERVER_URL && "PERSONEL_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let docs: typeof import("../src/server/staff-docs");
  let adv: typeof import("../src/server/staff-advances");
  let costs: typeof import("../src/server/actions/costs");
  let photos: typeof import("../src/server/storage/photos");
  let drivers: typeof import("../src/server/storage/drivers");
  let store: ReturnType<typeof import("../src/server/storage/drivers").memoryDriver>;

  const person = async (name: string, branchId = "tuzla", o: { endMonth?: string | null; active?: boolean } = {}) =>
    (await db.insert(s.staff).values({ name, branchId, netSalary: 30_000, endMonth: o.endMonth ?? null, active: o.active ?? true, startMonth: "2026-11" }).returning({ id: s.staff.id }))[0].id;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "personel-belge-testi-icin-en-az-otuz-iki-karakterlik" });
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {} });
    const session = async () => ({ ...ME });
    stub(require.resolve("../src/server/auth/dal"), { getCurrentUser: session, requireUser: session, requireAdmin: session });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await seedBranches(db);
    const [u] = await db.insert(s.users).values({ email: ME.email, name: ME.name, passwordHash: "x", role: "admin" }).returning({ id: s.users.id });
    ME.id = u.id;
    docs = await import("../src/server/staff-docs");
    adv = await import("../src/server/staff-advances");
    costs = await import("../src/server/actions/costs");
    photos = await import("../src/server/storage/photos");
    drivers = await import("../src/server/storage/drivers");
  });

  after(async () => {
    photos?.__setPhotoDriverForTests(undefined);
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE staff_documents, staff_advances, staff, notification_log, activity_log RESTART IDENTITY CASCADE`);
    store = drivers.memoryDriver();
    photos.__setPhotoDriverForTests(store);
  });

  test("dosyalı belge: önce depo, sonra satır; adı ve baytları yalnız panelin yolundan; silince depodan da gider", async () => {
    const ayse = await person("Ayşe Yılmaz");
    const saved = await docs.addStaffDoc(db, ME, { staffId: ayse, kind: "saglik", label: " portör ", issuedOn: "2026-01-10", validUntil: "2027-01-10", note: "yıllık" }, { bytes: PDF, name: "rapor‮.pdf" });
    assert.equal(saved.staffName, "Ayşe Yılmaz");
    const keys = store.keys();
    assert.equal(keys.length, 1);
    assert.match(keys[0], /^personel-belge\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);
    assert.match(keys[0], drivers.STORED_KEY_RE);
    const [row] = await db.select().from(s.staffDocuments).where(eq(s.staffDocuments.id, saved.id));
    assert.equal(row.label, "portör");
    assert.equal(row.fileName, "rapor.pdf", "yön değiştiren karakter atılır");
    assert.equal(row.contentType, "application/pdf");
    assert.equal(row.createdByName, "Ali");
    const file = await docs.readStaffDocFile(db, saved.id);
    assert.ok(file, "dosya okunmalı");
    assert.deepEqual(file.bytes, PDF);
    assert.equal(file.fileName, "Ayse-Yilmaz_Saglik-raporu-portor_2027-01-10.pdf");
    const list = await docs.listStaffDocs(db);
    assert.equal(list[0].hasFile, true);
    assert.ok(!("storageKey" in list[0]), "deponun yolu ekrana gitmez");
    await docs.deleteStaffDoc(db, saved.id);
    assert.deepEqual(store.keys(), []);
    assert.equal((await db.select().from(s.staffDocuments)).length, 0);
    assert.equal(await docs.readStaffDocFile(db, saved.id), null);
  });

  test("bozuk dosya ve depo yokken dosya reddedilir; dosyasız belge yine kaydedilir; kişi başına sınır", async () => {
    const ali = await person("Ali");
    await assert.rejects(docs.addStaffDoc(db, ME, { staffId: ali, kind: "hijyen" }, { bytes: new Uint8Array([1, 2, 3]), name: "x.exe" }), /Yalnız PDF, JPG, PNG ya da WebP/);
    await assert.rejects(docs.addStaffDoc(db, ME, { staffId: ali, kind: "diger", label: "" }, null), /Belgenin adını yazın/);
    await assert.rejects(docs.addStaffDoc(db, ME, { staffId: 999, kind: "hijyen" }, null), /Kişi bulunamadı/);
    photos.__setPhotoDriverForTests(null);
    await assert.rejects(docs.addStaffDoc(db, ME, { staffId: ali, kind: "hijyen" }, { bytes: JPEG, name: "a.jpg" }), /Belge deposu bu ortamda kurulu değil/);
    const plain = await docs.addStaffDoc(db, ME, { staffId: ali, kind: "hijyen", validUntil: null }, null);
    assert.ok(plain.id > 0, "dosyasız belge kaydedilir");
    photos.__setPhotoDriverForTests(store);
    await db.insert(s.staffDocuments).values(Array.from({ length: 39 }, () => ({ staffId: ali, kind: "diger", label: "eski" })));
    await assert.rejects(docs.addStaffDoc(db, ME, { staffId: ali, kind: "hijyen" }, null), /en çok 40 belge/);
    // Düzeltme: tarih ve tür değişir, dosya değişmez
    await docs.updateStaffDoc(db, plain.id, { kind: "saglik", validUntil: "2026-12-01", issuedOn: "2026-01-01", label: null, note: "yenilenecek" });
    const [row] = await db.select().from(s.staffDocuments).where(eq(s.staffDocuments.id, plain.id));
    assert.equal(row.kind, "saglik");
    assert.equal(row.validUntil, "2026-12-01");
    await assert.rejects(docs.updateStaffDoc(db, plain.id, { kind: "saglik", issuedOn: "2026-05-01", validUntil: "2026-04-01" }), /düzenlenme tarihinden önce/);
  });

  test("hatırlatma: biten ve yaklaşan, yenilenen ve ayrılan hariç, şubeye göre; e-posta kutusu her aşamada bir kez", async () => {
    const ayse = await person("Ayşe");
    const can = await person("Can", "marina");
    const eski = await person("Eski", "tuzla", { endMonth: "2026-09" });
    await db.insert(s.staffDocuments).values([
      { staffId: ayse, kind: "saglik", validUntil: "2026-11-20" },
      { staffId: ayse, kind: "hijyen", validUntil: "2026-10-01" },
      { staffId: ayse, kind: "hijyen", validUntil: null },
      { staffId: can, kind: "saglik", validUntil: "2026-12-10" },
      { staffId: eski, kind: "saglik", validUntil: "2026-11-01" },
    ]);
    const all = await docs.loadDocAlerts(db, TODAY);
    assert.deepEqual(
      all.map((a) => [a.staffName, a.title, a.stage]),
      [
        ["Ayşe", "Sağlık raporu", "expired"],
        ["Can", "Sağlık raporu", "soon"],
      ],
    );
    assert.deepEqual(
      (await docs.loadDocAlerts(db, TODAY, "marina")).map((a) => a.staffName),
      ["Can"],
    );
    const first = await docs.loadDocDigest(db, TODAY);
    assert.ok(first, "ilk sabah kutu olmalı");
    assert.equal(first.box.subjectPart, "1 personel belgesinin süresi doldu · 1 personel belgesi 30 gün içinde bitiyor");
    assert.equal(first.logKeys.length, 2);
    // Gönderildi: anahtarlar yazıldı; ertesi sabah yeni haber yok
    await db.insert(s.notificationLog).values(first.logKeys.map((key) => ({ key, ok: true })));
    assert.equal(await docs.loadDocDigest(db, "2026-11-27"), null);
    // Can'ın belgesi bitince yeni aşama: bir kez daha
    const later = await docs.loadDocDigest(db, "2026-12-11");
    assert.ok(later, "bitince yeniden haber");
    assert.equal(later.box.subjectPart, "1 personel belgesinin süresi doldu");
  });

  test("avans: kesinti kalanı aşamaz; aynı anda iki kesinti birlikte aşamaz; kesintisi yazılmış avans silinmez", async () => {
    const ali = await person("Ali");
    const a1 = await adv.addAdvance(db, ME, { staffId: ali, kind: "avans", amount: 1000, date: "2026-11-05", note: "kira" }, TODAY);
    assert.equal(a1.balance, 1000);
    await assert.rejects(adv.addAdvance(db, ME, { staffId: ali, kind: "kesinti", amount: 1000.5, date: TODAY }, TODAY), /Kesinti kalan avansı aşamaz/);
    await assert.rejects(adv.addAdvance(db, ME, { staffId: ali, kind: "avans", amount: 10, date: "2026-11-27" }, TODAY), /İleri tarihli/);
    const results = await Promise.allSettled([
      adv.addAdvance(db, ME, { staffId: ali, kind: "kesinti", amount: 700, date: TODAY }, TODAY),
      adv.addAdvance(db, ME, { staffId: ali, kind: "kesinti", amount: 700, date: TODAY }, TODAY),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"], "biri kalanı aşar");
    const rows = await adv.listAdvances(db);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].createdByName, "Ali");
    const cut = rows.find((r) => r.kind === "kesinti")!;
    await assert.rejects(adv.deleteAdvance(db, a1.id), /önce kesintiyi silin/);
    await adv.deleteAdvance(db, cut.id);
    const gone = await adv.deleteAdvance(db, a1.id);
    assert.deepEqual(gone, { staffName: "Ali", kind: "avans", amount: 1000, date: "2026-11-05" });
    assert.deepEqual(await adv.listAdvances(db), []);
    // Şubeye göre liste
    const can = await person("Can", "marina");
    await adv.addAdvance(db, ME, { staffId: can, kind: "avans", amount: 50, date: TODAY }, TODAY);
    assert.deepEqual(
      (await adv.listAdvances(db, "tuzla")).map((r) => r.staffName),
      [],
    );
  });

  test("Maaşlar: avans hareketi olan kişi silinemez; silinen kişinin belge dosyaları depodan da gider", async () => {
    const ali = await person("Ali");
    const veli = await person("Veli");
    await adv.addAdvance(db, ME, { staffId: ali, kind: "avans", amount: 100, date: TODAY }, TODAY);
    await docs.addStaffDoc(db, ME, { staffId: veli, kind: "saglik", validUntil: "2027-01-01" }, { bytes: JPEG, name: "v.jpg" });
    assert.equal(store.keys().length, 1);
    const blockers = await costs.staffDeleteBlockers([ali, veli]);
    assert.ok(blockers.ok, blockers.ok ? "" : blockers.error);
    assert.equal(blockers.data[ali], "avans hareketi var");
    assert.equal(blockers.data[veli], undefined);
    const refused = await costs.saveStaff([], [ali]);
    assert.equal(refused.ok, false);
    assert.match(refused.ok ? "" : refused.error, /Ali için avans hareketi var/);
    const done = await costs.saveStaff([], [veli]);
    assert.ok(done.ok, done.ok ? "" : done.error);
    assert.deepEqual(store.keys(), [], "dosya depodan silindi");
    assert.equal((await db.select().from(s.staffDocuments)).length, 0);
  });
});
