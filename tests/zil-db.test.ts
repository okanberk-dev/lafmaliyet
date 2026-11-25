// Zil, maliyet modeli okunamayınca (denetim E-49): gerçek Postgres'te. Neon uyanırken modelin paralel sorgularından biri
// zaman aşımına düşer; yöneticinin zili boş gelip "Dikkat isteyen bir şey yok" dememeli: ödemeler ve kişinin
// hatırlatıcıları yine gelir, modele bağlı satırların yerine tek bir "yüklenemedi" satırı durur (okunmamış sayılmaz).
// Zamanı gelen ödemeler (loadUpcoming) okunamazsa da Ödemeler grubu sessizce boşalmaz: "Ödemeler yüklenemedi".
// Kasa ve kontrol listeleri de öyle: "Kasa yüklenemedi", "Kontrol listeleri yüklenemedi" (bulgu 88).
// Kendi geçici veritabanını açar (migration'larla), sonunda siler; oturum ve maliyet modeli taklit edilir
// (src/server/auth/dal, src/server/data/dataset loadModel'i istenince atar).
//
// ZIL_TEST_DATABASE_URL (yoksa LAFPOS_TEST_DATABASE_URL) verilmezse atlanır: bir Postgres sunucusu (geçici veritabanı
// onun üstünde açılır).
// Çalıştırma: ZIL_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/zil-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { addDays, todayTR } from "../src/lib/reminders";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.ZIL_TEST_DATABASE_URL ?? process.env.LAFPOS_TEST_DATABASE_URL;
const DB_NAME = `laffogato_zil_${process.pid}`;

type Who = { id: number; name: string; email: string; role: "admin" | "staff" };

describe("Zil: maliyet modeli okunamayınca öbür maddeler", { skip: !SERVER_URL && "ZIL_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let bell: typeof import("../src/server/actions/notifications");
  const users: Record<"ali" | "ayse", Who> = {
    ali: { id: 0, name: "Ali", email: "ali@laffogato.net", role: "admin" },
    ayse: { id: 0, name: "Ayşe", email: "ayse@laffogato.net", role: "staff" },
  };
  let me: Who = users.ali;
  /** true iken loadModel 08P01 benzeri bir hatayla düşer */
  let modelDown = false;
  /** true iken loadUpcoming (zamanı gelen ödemeler) aynı hatayla düşer */
  let upcomingDown = false;
  /** true iken zilin kasa bölümü ve kontrol listeleri okuması aynı hatayla düşer (bulgu 88) */
  let kasaDown = false;
  let checklistDown = false;
  const realError = console.error;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "zil-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    delete process.env.KARAOKE_SYNC_SECRET;
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {} });
    const session = async () => ({ id: me.id, name: me.name, email: me.email, role: me.role });
    stub(require.resolve("../src/server/auth/dal"), {
      getCurrentUser: session,
      requireUser: session,
      requireAdmin: async () => {
        if (me.role !== "admin") throw new Error("yönetici değil");
        return session();
      },
    });
    const dataset = require("../src/server/data/dataset") as typeof import("../src/server/data/dataset");
    stub(require.resolve("../src/server/data/dataset"), {
      ...dataset,
      loadModel: async (...args: Parameters<typeof dataset.loadModel>) => {
        if (modelDown) throw Object.assign(new Error("Authentication timed out"), { code: "08P01" });
        return dataset.loadModel(...args);
      },
    });
    const digest = require("../src/server/notify/digest") as typeof import("../src/server/notify/digest");
    stub(require.resolve("../src/server/notify/digest"), {
      ...digest,
      loadUpcoming: async (...args: Parameters<typeof digest.loadUpcoming>) => {
        if (upcomingDown) throw Object.assign(new Error("Authentication timed out"), { code: "08P01" });
        return digest.loadUpcoming(...args);
      },
    });
    const kasa = require("../src/server/bell/kasa") as typeof import("../src/server/bell/kasa");
    stub(require.resolve("../src/server/bell/kasa"), {
      ...kasa,
      kasaBell: async (...args: Parameters<typeof kasa.kasaBell>) => {
        if (kasaDown) throw Object.assign(new Error("Authentication timed out"), { code: "08P01" });
        return kasa.kasaBell(...args);
      },
    });
    const checklists = require("../src/server/data/checklists") as typeof import("../src/server/data/checklists");
    stub(require.resolve("../src/server/data/checklists"), {
      ...checklists,
      loadChecklistDays: async (...args: Parameters<typeof checklists.loadChecklistDays>) => {
        if (checklistDown) throw Object.assign(new Error("Authentication timed out"), { code: "08P01" });
        return checklists.loadChecklistDays(...args);
      },
    });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    for (const u of Object.values(users)) {
      const [row] = await db.insert(s.users).values({ email: u.email, name: u.name, passwordHash: "x", role: u.role }).returning({ id: s.users.id });
      u.id = row.id;
    }
    const today = todayTR();
    // Gecikmiş bir ödeme hatırlatıcısı ve yöneticinin bugünkü kişisel hatırlatıcısı
    await db.insert(s.reminders).values({ title: "Kira", kind: "kira", amount: 25_000, dueDate: addDays(today, -2), anchorDate: addDays(today, -2) });
    await db.insert(s.userReminders).values({ userId: users.ali.id, title: "Tedarikçiyi ara", dueDate: addDays(today, -1), anchorDate: addDays(today, -1) });
    bell = await import("../src/server/actions/notifications");
  });

  after(async () => {
    console.error = realError;
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  test("model yüklenince 'yüklenemedi' satırı yok; ödeme ve hatırlatıcı var", async () => {
    me = users.ali;
    modelDown = false;
    const items = await bell.loadPanelNotifications();
    assert.ok(items.some((i) => i.group === "odeme" && i.title.startsWith("Kira")), JSON.stringify(items.map((i) => i.id)));
    assert.ok(items.some((i) => i.group === "hatirlatici" && i.title === "Tedarikçiyi ara"));
    assert.equal(items.filter((i) => i.id.startsWith("uyari-model-")).length, 0);
  });

  test("model düşünce ödemeler, hatırlatıcılar yine gelir; tek 'yüklenemedi' satırı, okunmamış sayılmaz", async () => {
    me = users.ali;
    modelDown = true;
    const logged: unknown[] = [];
    console.error = (...a: unknown[]) => void logged.push(a);
    try {
      const items = await bell.loadPanelNotifications();
      const pay = items.find((i) => i.group === "odeme" && i.title.startsWith("Kira"));
      assert.ok(pay, JSON.stringify(items.map((i) => i.id)));
      assert.equal(pay.kind, "danger");
      assert.ok(items.some((i) => i.group === "hatirlatici" && i.title === "Tedarikçiyi ara"));
      const failed = items.filter((i) => i.id.startsWith("uyari-model-"));
      assert.deepEqual(
        failed.map((i) => [i.id, i.title, i.kind, i.unread, i.group, i.href]),
        [[`uyari-model-${todayTR()}`, "Maliyet uyarıları yüklenemedi", "warning", false, "uyari", "/panel"]],
      );
      // Modele bağlı satırlar (son satış ayının uyarıları, hammadde zammı) bu okumada yok
      assert.equal(items.filter((i) => /^uyari-(?!model-|fiyatsiz-)/.test(i.id)).length, 0);
      assert.equal(logged.length, 1);
    } finally {
      console.error = realError;
      modelDown = false;
    }
  });

  test("ödemeler okunamayınca grup sessizce boşalmaz: tek 'Ödemeler yüklenemedi' satırı, okunmamış sayılmaz", async () => {
    me = users.ali;
    upcomingDown = true;
    const logged: unknown[] = [];
    console.error = (...a: unknown[]) => void logged.push(a);
    try {
      const items = await bell.loadPanelNotifications();
      const pay = items.filter((i) => i.group === "odeme");
      assert.deepEqual(
        pay.map((i) => [i.id, i.title, i.kind, i.unread, i.href, i.timeLabel]),
        [[`odeme-okunamadi-${todayTR()}`, "Ödemeler yüklenemedi", "warning", false, "/panel/hatirlaticilar", ""]],
      );
      assert.match(pay[0].body, /zili birazdan yeniden açın/);
      // Öbür maddeler yine gelir
      assert.ok(items.some((i) => i.group === "hatirlatici" && i.title === "Tedarikçiyi ara"));
      assert.equal(items.filter((i) => i.id.startsWith("uyari-model-")).length, 0);
      assert.equal(logged.length, 1);
    } finally {
      console.error = realError;
      upcomingDown = false;
    }
    // Okunabilince satır yok, ödeme yerinde
    const back = await bell.loadPanelNotifications();
    assert.equal(back.filter((i) => i.id.startsWith("odeme-okunamadi-")).length, 0);
    assert.ok(back.some((i) => i.group === "odeme" && i.title.startsWith("Kira")));
  });

  test("kasa ve kontrol listeleri okunamayınca sessizce boşalmaz: grubunda 'yüklenemedi' satırı (bulgu 88)", async () => {
    const logged: unknown[] = [];
    console.error = (...a: unknown[]) => void logged.push(a);
    kasaDown = true;
    checklistDown = true;
    try {
      for (const who of [users.ali, users.ayse]) {
        me = who;
        logged.length = 0;
        const items = await bell.loadPanelNotifications();
        const lost = items.filter((i) => i.id.startsWith("okunamadi-"));
        assert.deepEqual(
          lost.map((i) => [i.id, i.title, i.kind, i.unread, i.group, i.href]).sort(),
          [
            [`okunamadi-kasa-${todayTR()}`, "Kasa yüklenemedi", "warning", false, "kasa", "/panel/kasa"],
            [`okunamadi-kontrol-${todayTR()}`, "Kontrol listeleri yüklenemedi", "warning", false, "kontrol", "/panel/kontrol"],
          ],
          `${who.role}: ${JSON.stringify(items.map((i) => i.id))}`,
        );
        assert.match(lost[0].body, /zili birazdan yeniden açın/);
        // Hata günlüğe yazılır (iki bölüm)
        assert.equal(logged.length, 2, `${who.role}: ${JSON.stringify(logged.map((l) => String((l as unknown[])[0])))}`);
        // Öbür bölümler yine gelir
        if (who.role === "admin") assert.ok(items.some((i) => i.group === "odeme" && i.title.startsWith("Kira")), "ödeme satırı");
      }
    } finally {
      console.error = realError;
      kasaDown = false;
      checklistDown = false;
      me = users.ali;
    }
    // Okunabilince satır yok
    const back = await bell.loadPanelNotifications();
    assert.equal(back.filter((i) => i.id.startsWith("okunamadi-")).length, 0);
  });

  test("personelin zili modele hiç dokunmaz: model düşse de aynı", async () => {
    me = users.ayse;
    modelDown = true;
    try {
      const items = await bell.loadPanelNotifications();
      assert.equal(items.filter((i) => i.id.startsWith("uyari-")).length, 0);
      assert.equal(items.filter((i) => i.group === "odeme").length, 0);
    } finally {
      modelDown = false;
      me = users.ali;
    }
  });
});
