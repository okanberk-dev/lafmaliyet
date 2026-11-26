// Hazır vardiya saatleri şube ayarı (docs/VARDIYA.md › Hazır vardiyalar; docs/SUBE.md › Şube başına ayarlar), gerçek
// Postgres'te:
// - ayarı olmayan şube bugünkü sabit saatleri okur (Tuzla, Marina; öbür şubede yok), okuma satır yazmaz;
// - Şube ayarları › Hazır vardiyalar kaydı (saveShiftPresets) yalnız o şubenin satırını yazar; işlem geçmişine eski → yeni;
//   değişiklik yoksa yazılmaz; ikisi kapatılınca şubede hazır vardiya yok (varsayılana dönmez);
// - okunamayan saat, aynı saatli iki vardiya, online kanal, "Diğer şubeyle aynı" ve personel reddedilir.
//
// VARDIYA_SUBE_TEST_DATABASE_URL verilmezse atlanır (ör. postgres://postgres:postgres@localhost:5432/postgres). Test o
// sunucuda kendi geçici veritabanını (lm_vardiya_sube_<pid>) açar, sonunda siler.
// Çalıştırma: VARDIYA_SUBE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/vardiya-sube-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { SHIFT_PRESET_GROUP } from "../src/lib/branch-settings/groups";
import { DEFAULT_BRANCHES } from "../src/lib/branches";
import { presetText, type ShiftPreset } from "../src/lib/vardiya";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.VARDIYA_SUBE_TEST_DATABASE_URL;
const DB_NAME = `lm_vardiya_sube_${process.pid}`;

type Who = { id: number; name: string; role: "admin" | "staff"; branchId: string | null };

const text = (list: readonly ShiftPreset[]) => list.map((p) => `${p.label} ${presetText(p)}`);

describe("hazır vardiya saatleri şube ayarı: veritabanında", { skip: !SERVER_URL && "VARDIYA_SUBE_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  const users: Record<"ali" | "ayse", Who> = {
    ali: { id: 0, name: "Ali", role: "admin", branchId: null },
    ayse: { id: 0, name: "Ayşe", role: "staff", branchId: null },
  };
  let me: Who = users.ali;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "vardiya-sube-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {} });
    stub(require.resolve("../src/server/auth/dal"), {
      requireAdmin: async () => {
        if (me.role !== "admin") throw new Error("NEXT_REDIRECT yönetici değil");
        return { ...me, email: `${me.name}@test.local`, active: true };
      },
      requireUser: async () => ({ ...me, email: `${me.name}@test.local`, active: true }),
      getCurrentUser: async () => ({ ...me, email: `${me.name}@test.local`, active: true }),
    });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await db.insert(s.branches).values(DEFAULT_BRANCHES.map((b) => ({ ...b }))).onConflictDoNothing();
    await db.insert(s.branches).values({ id: "bodrum", name: "Bodrum", kind: "fiziksel", posSource: "modpos", active: true, sortOrder: 4 });
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db
        .insert(s.users)
        .values({ email: `${k}@test.local`, name: users[k].name, passwordHash: "x", role: users[k].role, branchId: users[k].branchId })
        .returning({ id: s.users.id });
      users[k].id = u.id;
    }
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  const rowOf = async (branchId: string) =>
    (await db.select().from(s.branchSettings).where(and(eq(s.branchSettings.grp, SHIFT_PRESET_GROUP.id), eq(s.branchSettings.branchId, branchId))))[0] ?? null;
  const logs = async () => (await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Şube ayarı"))).map((l) => l.detail ?? "");
  const presetsOf = async (branchId: string) => (await import("../src/server/vardiya/presets")).loadShiftPresets(branchId, db);

  test("geçiş: ayarı olmayan şube bugünkü sabit saatleri okur; okuma satır yazmaz", async () => {
    assert.deepEqual(text(await presetsOf("tuzla")), ["Sabahçı 09:00–18:00", "Akşamcı 16:00–01:00"]);
    assert.deepEqual(text(await presetsOf("marina")), ["Sabahçı 09:30–18:30", "Akşamcı 13:00–22:00"]);
    assert.deepEqual(await presetsOf("bodrum"), [], "yeni şubede hazır vardiya yok");
    assert.equal((await db.select().from(s.branchSettings)).length, 0, "okuma satır yazmaz");
  });

  test("kayıt yalnız o şubenin satırı; işlem geçmişine eski → yeni; değişiklik yoksa yazılmaz", async () => {
    const actions = await import("../src/server/actions/branch-settings");
    const r = await actions.saveShiftPresets({ branchId: "marina", morning: { start: "08:30", end: "17:30" }, evening: null });
    assert.ok(r.ok && r.data.changed, r.ok ? "değişmedi" : r.error);
    assert.deepEqual(text(await presetsOf("marina")), ["Sabahçı 08:30–17:30"]);
    assert.deepEqual(text(await presetsOf("tuzla")), ["Sabahçı 09:00–18:00", "Akşamcı 16:00–01:00"], "Tuzla değişmez");
    assert.deepEqual((await rowOf("marina"))?.value, { presets: [{ key: "morning", startMin: 510, endMin: 1050 }] });
    assert.equal((await rowOf("marina"))?.sameAs, null);
    assert.equal(await rowOf("tuzla"), null, "Tuzla'nın satırı yazılmaz");
    assert.ok(
      (await logs()).includes("Marina · Hazır vardiyalar: Sabahçı 09:30–18:30 · Akşamcı 13:00–22:00 → Sabahçı 08:30–17:30"),
      (await logs()).join(" | "),
    );
    const same = await actions.saveShiftPresets({ branchId: "marina", morning: { start: "08:30", end: "17:30" }, evening: null });
    assert.ok(same.ok && !same.data.changed, "değişiklik yoksa yazılmaz");
    assert.equal((await logs()).length, 1);
    // Gece yarısını geçen akşamcı; yeni şubede ilk ayar
    const bodrum = await actions.saveShiftPresets({ branchId: "bodrum", morning: { start: "10:00", end: "19:00" }, evening: { start: "17:00", end: "02:00" } });
    assert.ok(bodrum.ok, bodrum.ok ? "" : bodrum.error);
    assert.deepEqual(text(await presetsOf("bodrum")), ["Sabahçı 10:00–19:00", "Akşamcı 17:00–02:00"]);
    assert.ok((await logs()).includes("Bodrum · Hazır vardiyalar: hazır vardiya yok → Sabahçı 10:00–19:00 · Akşamcı 17:00–02:00"));
  });

  test("ikisi kapatılınca şubede hazır vardiya yok (sabit saatlere dönmez)", async () => {
    const actions = await import("../src/server/actions/branch-settings");
    const r = await actions.saveShiftPresets({ branchId: "tuzla", morning: null, evening: null });
    assert.ok(r.ok && r.data.changed, r.ok ? "" : r.error);
    assert.deepEqual(await presetsOf("tuzla"), []);
    assert.deepEqual((await rowOf("tuzla"))?.value, { presets: [] });
    assert.ok((await logs()).includes("Tuzla · Hazır vardiyalar: Sabahçı 09:00–18:00 · Akşamcı 16:00–01:00 → hazır vardiya yok"));
    // Bugünkü saatlerle yeniden açılır
    const back = await actions.saveShiftPresets({ branchId: "tuzla", morning: { start: "09:00", end: "18:00" }, evening: { start: "16:00", end: "01:00" } });
    assert.ok(back.ok && back.data.changed, back.ok ? "" : back.error);
    assert.deepEqual(text(await presetsOf("tuzla")), ["Sabahçı 09:00–18:00", "Akşamcı 16:00–01:00"]);
  });

  test("ret: okunamayan saat, aynı saatli iki vardiya, online kanal, 'aynı', personel; hiçbir şey yazılmaz", async () => {
    const actions = await import("../src/server/actions/branch-settings");
    const before = await db.select().from(s.branchSettings);
    const bad = async (input: Parameters<typeof actions.saveShiftPresets>[0], re: RegExp) => {
      const r = await actions.saveShiftPresets(input);
      assert.ok(!r.ok && re.test(r.error), r.ok ? `kabul edildi: ${JSON.stringify(input)}` : r.error);
    };
    await bad({ branchId: "marina", morning: { start: "09:00", end: "09:00" }, evening: null }, /^Sabahçı: Bitiş başlangıçla aynı olamaz/);
    await bad({ branchId: "marina", morning: null, evening: { start: "12:00", end: "07:00" } }, /^Akşamcı: Vardiya en geç ertesi gün 06:00'da biter/);
    await bad({ branchId: "marina", morning: { start: "06:00", end: "23:00" }, evening: null }, /16 saatten uzun/);
    await bad({ branchId: "marina", morning: { start: "", end: "18:00" }, evening: null }, /saatini seçin/);
    await bad({ branchId: "marina", morning: { start: "10:00", end: "18:00" }, evening: { start: "10:00", end: "18:00" } }, /aynı saatlerde olamaz/);
    await bad({ branchId: "online", morning: { start: "10:00", end: "18:00" }, evening: null }, /yalnız fiziksel şubede/);
    await bad({ branchId: "yok", morning: { start: "10:00", end: "18:00" }, evening: null }, /Şube bulunamadı/);
    const linked = await actions.setBranchSettingLink({ branchId: "marina", group: SHIFT_PRESET_GROUP.id, sameAs: "tuzla" });
    assert.ok(!linked.ok && /şube başına tutulur/.test(linked.error), linked.ok ? "aynı kabul edildi" : linked.error);
    me = users.ayse;
    try {
      assert.equal((await actions.saveShiftPresets({ branchId: "marina", morning: { start: "10:00", end: "18:00" }, evening: null })).ok, false, "personel değiştiremez");
    } finally {
      me = users.ali;
    }
    assert.deepEqual(await db.select().from(s.branchSettings), before, "hiçbir satır değişmedi");
  });
});
