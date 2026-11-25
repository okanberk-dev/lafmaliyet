// Karaoke şube şube, gerçek Postgres'te (24 Kasım şube kapsamı; docs/SUBE.md › Karaoke): karaoke odası tek şubede
// (şube özelliği, sahibin varsayılanı Tuzla). Başka şubeye kilitli personel karaoke eylemlerini (sayaç, uzatma, bitirme, köşk, eşitleme)
// çağıramaz: sayfa "Bu şubede kullanılmıyor" der, eylem kimliği istemci paketinde olduğu için uç da reddeder. Yönetici,
// şubesiz personel ve karaokenin şubesinin personeli serbest; kişinin şubesi pasife alınınca kilit kalkar.
//
// SUBE_TEST_DATABASE_URL verilmezse atlanır. Test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: SUBE_TEST_DATABASE_URL=postgres://localhost:5432/postgres npx tsx --test tests/karaoke-sube-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { DEFAULT_BRANCHES, KARAOKE_ELSEWHERE } from "../src/lib/branches";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.SUBE_TEST_DATABASE_URL;
const DB_NAME = `laffogato_karaoke_sube_${process.pid}`;

describe("Karaoke şube şube", { skip: !SERVER_URL && "SUBE_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let actions: typeof import("../src/server/actions/karaoke");
  type Who = { id: number; name: string; email: string; role: "admin" | "staff"; branchId: string | null };
  const users: Record<"ali" | "serbest" | "tuzla" | "marina", Who> = {
    ali: { id: 0, name: "Ali", email: "ali@laffogato.net", role: "admin", branchId: null },
    serbest: { id: 0, name: "Selin", email: "selin@laffogato.net", role: "staff", branchId: null },
    tuzla: { id: 0, name: "Tuna", email: "tuna@laffogato.net", role: "staff", branchId: "tuzla" },
    marina: { id: 0, name: "Mert", email: "mert@laffogato.net", role: "staff", branchId: "marina" },
  };
  /** Oturumdaki kullanıcı (src/server/auth/dal taklidi) */
  let me: Who = users.ali;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "karaoke-sube-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    delete process.env.KARAOKE_SYNC_SECRET;
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, cacheTag: () => {}, cacheLife: () => {} });
    const session = async () => ({ ...me });
    stub(require.resolve("../src/server/auth/dal"), {
      getCurrentUser: session,
      requireUser: session,
      requireAdmin: async () => {
        if (me.role !== "admin") throw new Error("yönetici değil");
        return session();
      },
    });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await db
      .insert(s.branches)
      .values(DEFAULT_BRANCHES.map((b) => ({ ...b, active: true })))
      .onConflictDoUpdate({ target: s.branches.id, set: { active: true } });
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const u = users[k];
      const [row] = await db.insert(s.users).values({ email: u.email, name: u.name, passwordHash: "x", role: u.role, branchId: u.branchId }).returning({ id: s.users.id });
      u.id = row.id;
    }
    actions = await import("../src/server/actions/karaoke");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  const start = async (who: Who) => {
    me = who;
    return actions.startKaraokeTimer({ minutes: 60, label: null, guests: 2, force: true });
  };

  test("Marina'ya kilitli personel karaoke eylemlerini çağıramaz; yönetici, şubesiz ve Tuzla'nın personeli çağırır", async () => {
    const opened = await start(users.tuzla);
    assert.ok(opened.ok && opened.data.id, opened.ok ? "sayaç açıldı" : opened.error);
    const id = opened.ok ? opened.data.id! : 0;
    for (const who of [users.ali, users.serbest]) {
      const r = await start(who);
      assert.ok(r.ok, r.ok ? "" : r.error);
    }
    me = users.marina;
    const refused = [
      await start(users.marina),
      await actions.extendKaraokeSession(id, 30),
      await actions.endKaraokeSession(id),
      await actions.reopenKaraokeSession(id),
      await actions.deleteKaraokeTimer(id),
      await actions.syncKaraokeNow(),
      await actions.removeDeskKaraoke(id),
      await actions.requestKaraokeTimerDelete({ id, message: "yanlış açıldı", clientKey: "k-marina-0001" }),
    ];
    for (const r of refused) assert.deepEqual(r.ok ? "geçti" : r.error, KARAOKE_ELSEWHERE);
    const [row] = await db.select({ status: s.karaokeSessions.status, endedAt: s.karaokeSessions.endedAt }).from(s.karaokeSessions).where(eq(s.karaokeSessions.id, id));
    assert.equal(row.endedAt, null, "Marina'nın personeli Tuzla'nın sayacını bitiremedi");
    // Tuzla'nın personeli bitirir
    me = users.tuzla;
    const ended = await actions.endKaraokeSession(id);
    assert.ok(ended.ok, ended.ok ? "" : ended.error);
  });

  test("kişinin şubesi pasife alınınca kilit kalkar (serbest personel gibi)", async () => {
    await db.update(s.branches).set({ active: false }).where(eq(s.branches.id, "marina"));
    try {
      const r = await start(users.marina);
      assert.ok(r.ok, r.ok ? "" : r.error);
    } finally {
      await db.update(s.branches).set({ active: true }).where(eq(s.branches.id, "marina"));
    }
  });
});
