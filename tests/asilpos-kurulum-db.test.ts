// Hesabım › AsilPOS kurulumu kartı gerçek Postgres'te (docs/ASILPOS.md › Şube kurulumu; src/server/asilpos/kurulum.ts ›
// installForAccount): şubenin son kurulum bağlantısı yalnız şubenin kendi hesabına (bağlantının gittiği adres, şubeye
// kilitli personel) gider. Şubenin öbür personeli (ortak tablette sırayla giren baristalar), müdürü, muhasebeci ve
// yönetici bağlantıyı almaz: içindeki kod tek kullanımlıktır ve kasanın eşitleme anahtarını verir
// (POST /api/asilpos/kurulum › redeemInstallCode). Kasa kodu verince kart "Kasa kuruldu" der, bağlantı kalkar; bağlantı
// yeni bir adrese gönderilince kart eski hesaptan kalkar, yeni adresin hesabına geçer.
//
// Kendi geçici şubesini (Marina'nın gerçek bağlantıları iptal olmasın) ve kullanıcılarını açar, sonunda siler.
// ASILPOS_KURULUM_TEST_DATABASE_URL verilmezse atlanır (migration'ları uygulanmış yerel veritabanı).
// Çalıştırma: TEST_DATABASE_URL=postgres://localhost/laffogato_test npm run test:db -- tests/asilpos-kurulum-db.test.ts

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { eq, inArray } from "drizzle-orm";

import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const URL = process.env.ASILPOS_KURULUM_TEST_DATABASE_URL;

describe("Hesabım'daki AsilPOS kurulumu kartı: veritabanında", { skip: !URL && "ASILPOS_KURULUM_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  let kurulum: typeof import("../src/server/asilpos/kurulum");
  const tag = `${process.pid}-${randomBytes(3).toString("hex")}`;
  const branchId = `kurulum-${tag}`;
  type Who = { id: number; name: string; email: string; role: "admin" | "manager" | "staff" | "accountant"; branchId: string | null };
  const users: Record<"sube" | "barista" | "mudur" | "muhasebeci" | "yonetici" | "yeni", Who> = {
    sube: { id: 0, name: "Kurulum şubesi", email: `kurulum-sube-${tag}@ornek.com`, role: "staff", branchId },
    barista: { id: 0, name: "Barista", email: `kurulum-barista-${tag}@ornek.com`, role: "staff", branchId },
    mudur: { id: 0, name: "Müdür", email: `kurulum-mudur-${tag}@ornek.com`, role: "manager", branchId },
    muhasebeci: { id: 0, name: "Muhasebeci", email: `kurulum-muhasebeci-${tag}@ornek.com`, role: "accountant", branchId: null },
    yonetici: { id: 0, name: "Yönetici", email: `kurulum-yonetici-${tag}@ornek.com`, role: "admin", branchId: null },
    yeni: { id: 0, name: "Yeni şube hesabı", email: `kurulum-yeni-${tag}@ornek.com`, role: "staff", branchId },
  };
  const others = ["barista", "mudur", "muhasebeci", "yonetici"] as const;

  before(async () => {
    process.env.DATABASE_URL = URL;
    // Kurulum kodu mühürlü durur (secret-box KURULUM_SIFRE_AMACI, eski adla): anahtar AUTH_SECRET'tan
    if (!process.env.AUTH_SECRET) process.env.AUTH_SECRET = "asilpos-kurulum-testi-icin-en-az-otuz-iki-karakterlik-anahtar";
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır
    const require = createRequire(import.meta.url);
    const p = require.resolve("server-only");
    require.cache[p] = { id: p, filename: p, loaded: true, exports: {} } as unknown as NodeJS.Module;
    const dbModule = await import("../src/server/db");
    db = dbModule.createDb(URL!, 2);
    kurulum = await import("../src/server/asilpos/kurulum");
    await db.insert(s.branches).values({ id: branchId, name: `Kurulum ${tag}`, kind: "fiziksel", posSource: "modpos", active: true, sortOrder: 999 });
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const u = users[k];
      const [row] = await db.insert(s.users).values({ email: u.email, name: u.name, passwordHash: "x", role: u.role, branchId: u.branchId }).returning({ id: s.users.id });
      u.id = row.id;
    }
  });

  after(async () => {
    if (!db) return;
    await db.delete(s.users).where(inArray(s.users.id, Object.values(users).map((u) => u.id)));
    // Kurulum bağlantıları şubeyle birlikte silinir (cascade)
    await db.delete(s.branches).where(eq(s.branches.id, branchId));
    await db.$client.end();
    const { getDb } = await import("../src/server/db");
    await getDb().$client.end();
  });

  test("bekleyen bağlantı yalnız şubenin kendi hesabına; öbür personel, müdür, muhasebeci ve yönetici almaz", async () => {
    assert.equal(await kurulum.installForAccount(db, users.sube), null, "bağlantı yokken kart yok");
    const { raw } = await kurulum.issueInstallCode(db, { branchId, email: users.sube.email, by: null });
    const view = await kurulum.installForAccount(db, users.sube);
    assert.ok(view, "şubenin hesabı kartı görür");
    assert.equal(view.durum, "bekliyor");
    assert.ok(view.link?.endsWith(`/asilpos/indir/${raw}`), `bağlantı kodu taşır: ${view.link}`);
    // Adres büyük harfle yazılmış olsa da aynı hesap
    assert.ok(await kurulum.installForAccount(db, { ...users.sube, email: users.sube.email.toUpperCase() }), "harf büyüklüğü fark etmez");
    for (const k of others) assert.equal(await kurulum.installForAccount(db, users[k]), null, `${k} bağlantıyı almaz`);
    // Aynı adres şubesiz ya da öteki şubeye kilitli hesapta da kart vermez
    assert.equal(await kurulum.installForAccount(db, { ...users.sube, branchId: null }), null, "şubesiz aynı adres");
    assert.equal(await kurulum.installForAccount(db, { ...users.sube, branchId: "tuzla" }), null, "öteki şubedeki aynı adres");
  });

  test("kasa kodu verince kart 'kuruldu' der, bağlantı kalkar; öbür personel yine görmez", async () => {
    const pending = await kurulum.installForAccount(db, users.sube);
    assert.ok(pending?.link, "bekleyen bağlantı var");
    const raw = decodeURIComponent(pending.link.split("/asilpos/indir/")[1]);
    const r = await kurulum.redeemInstallCode(raw, db);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.status === 200 && r.body.sube.id, branchId, "kod şubeyi verir");
    const view = await kurulum.installForAccount(db, users.sube);
    assert.ok(view, "kart duruyor");
    assert.equal(view.durum, "kuruldu");
    assert.equal(view.link, null, "kullanılmış bağlantı gösterilmez");
    assert.equal(await kurulum.installForAccount(db, users.barista), null, "barista kartı görmez");
  });

  test("bağlantı yeni adrese gönderilince kart eski hesaptan kalkar, yeni adresin hesabına geçer", async () => {
    const { raw } = await kurulum.issueInstallCode(db, { branchId, email: users.yeni.email, by: null });
    assert.equal(await kurulum.installForAccount(db, users.sube), null, "eski şube hesabı artık görmez");
    const view = await kurulum.installForAccount(db, users.yeni);
    assert.ok(view, "yeni adresin hesabı görür");
    assert.equal(view.durum, "bekliyor");
    assert.ok(view.link?.endsWith(`/asilpos/indir/${raw}`), `yeni bağlantı: ${view.link}`);
    for (const k of others) assert.equal(await kurulum.installForAccount(db, users[k]), null, `${k} yeni bağlantıyı da almaz`);
  });
});
