// İşçilik / ciro müdürde kişisel ücretsiz (docs/ROLLER.md › Kararlar; src/server/data/iscilik.ts loadLaborReport,
// src/lib/iscilik.ts withoutDayWages), gerçek Postgres'te. Müdür Vardiya'ya yazar ve haftalık İşçilik'i görür: haftanın
// işçiliği part-time'ın Vardiya'daki günlerinden gelseydi, dün için tek hücre yazıp sayfayı yenileyen müdür farkta o
// kişinin günlük ücretini (ve yemek kartını) okurdu; geçmiş gün olduğu için kişiye bildirim de gitmezdi. Müdürün raporunda
// tutar ve günlük satır yok, oranı Vardiya'dan bağımsız: hücreden önce ve sonra rapor birebir aynı. Yöneticinin raporu aynı
// hücreyi tam günlük ücret olarak gösterir (kanal gerçek, yalnız ücreti gören rolde açık).
//
// ISCILIK_TEST_DATABASE_URL verilmezse atlanır (npm run test:db onu TEST_DATABASE_URL'e bağlar). Test kendi geçici
// veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: ISCILIK_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/iscilik-mudur-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { DEFAULT_BRANCHES } from "../src/lib/branches";
import { businessDate } from "../src/lib/cash-report";
import { addDays } from "../src/lib/reminders";
import { nameRef, weekStart } from "../src/lib/vardiya";
import * as s from "../src/server/db/schema";
import { dalCapabilities } from "./helpers/dal-stub";

const SERVER_URL = process.env.ISCILIK_TEST_DATABASE_URL;
const DB_NAME = `laffogato_iscilik_${process.pid}`;
const E = ["", "", "", "", "", "", ""];
const WAGE = 1_000;

type Me = { id: number; name: string; email: string; role: "admin" | "manager"; branchId: string | null };

describe("İşçilik / ciro: müdürün raporu part-time'ın günlük ücretini vermez", { skip: !SERVER_URL && "ISCILIK_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let labor: typeof import("../src/server/data/iscilik");
  let vardiya: typeof import("../src/server/actions/vardiya");
  let yonetici: Me;
  let mudur: Me;
  let current: Me;
  // Dün (iş günü): geçmiş gün, Vardiya'daki değişikliği kimseye bildirilmez
  const yday = addDays(businessDate(), -1);
  const month = yday.slice(0, 7);

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "iscilik-testi-icin-en-az-otuz-iki-karakterlik-anahtar-x" });
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, cacheTag: () => {}, cacheLife: () => {} });
    // Vardiya bildirimleri yanıttan sonra (after) koşar: testte koşmaz
    stub("next/server", { ...require("next/server"), after: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await db
      .insert(s.branches)
      .values(DEFAULT_BRANCHES.map((b) => ({ ...b, active: true })))
      .onConflictDoUpdate({ target: s.branches.id, set: { active: true } });
    const [a] = await db.insert(s.users).values({ email: "yonetici@ornek.com", name: "Yönetici", passwordHash: "x", role: "admin" }).returning();
    const [m] = await db.insert(s.users).values({ email: "mudur@ornek.com", name: "Mehmet", passwordHash: "x", role: "manager", branchId: "tuzla" }).returning();
    yonetici = { id: a.id, name: a.name, email: a.email, role: "admin", branchId: null };
    mudur = { id: m.id, name: m.name, email: m.email, role: "manager", branchId: "tuzla" };
    current = yonetici;
    // Oturum taklidi: kapılar ve şube kilidi (getCurrentUser) o anki kişiyle
    const me = async () => current;
    const requireAdmin = async () => {
      if (current.role !== "admin") throw new Error("NEXT_REDIRECT yetkisiz (yönetici)");
      return current;
    };
    stub(require.resolve("../src/server/auth/dal"), { getCurrentUser: me, requireUser: me, requireAdmin, ...dalCapabilities(me) });

    // Tuzla: tam zamanlı Ali, Vardiya adıyla bağlı part-time Can (günlük 1.000 ₺); dünün kasa raporu (ciro biliniyor)
    await db.insert(s.staff).values([
      { name: "Ali", branchId: "tuzla", netSalary: 30_000, sortOrder: 1 },
      { name: "Can", branchId: "tuzla", kind: "part_time", dailyWage: WAGE, personRef: nameRef("Can"), sortOrder: 2 },
    ]);
    await db.insert(s.cashReports).values({
      date: yday,
      branchId: "tuzla",
      receipts: 100,
      zTotal: 10_000,
      cash: 4_000,
      card: 6_000,
      countedCash: 4_000,
      cashDiff: 0,
      discounts: 0,
      offRevenue: 0,
      submittedBy: a.id,
      submittedByName: "Yönetici",
      countedBy: a.id,
      countedByName: "Yönetici",
    });
    labor = await import("../src/server/data/iscilik");
    vardiya = await import("../src/server/actions/vardiya");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  /** Dünün haftasının satırı (Tuzla) */
  const weekOf = (r: Awaited<ReturnType<typeof labor.loadLaborReport>>) => {
    const row = r?.branches.find((b) => b.id === "tuzla")?.weeks.find((w) => w.from <= yday && yday <= w.to);
    assert.ok(row, "dünün haftası raporda");
    return row;
  };
  /** Can'ın dünkü hücresi (müdürün ekranından kayıt; `seen` ekranın gördüğü) */
  const saveCan = (text: string, seenText: string) => {
    const i = E.findIndex((_, k) => addDays(weekStart(yday), k) === yday);
    const cells = E.map((x, k) => (k === i ? text : x));
    const seen = E.map((x, k) => (k === i ? seenText : x));
    return vardiya.saveShiftWeekAction({ branchId: "tuzla", week: yday, rows: [{ ref: nameRef("Can"), name: "Can", cells, seen }] });
  };

  test("müdürün raporunda tutar ve günlük satır yok; kendi yazdığı geçmiş gün hücresi raporu değiştirmez", async () => {
    current = yonetici;
    const adminBefore = await labor.loadLaborReport(month);
    assert.equal(adminBefore?.wages, true, "yönetici kişisel ücretli görünümü alır");

    current = mudur;
    const before = await labor.loadLaborReport(month);
    assert.ok(before, "müdürün raporu var");
    assert.equal(before.wages, false, "müdür kişisel ücretsiz görünümü alır");
    assert.deepEqual(
      before.branches.map((b) => b.id),
      ["tuzla"],
      "yalnız şubesi",
    );
    assert.equal(before.total, null, "şubelerin toplamı yok");
    const [t] = before.branches;
    assert.equal(t.month.labor, null, "ayın işçilik tutarı gitmez");
    assert.equal(t.daysLabor, null, "günlerin işçilik toplamı gitmez");
    assert.deepEqual(t.days, [], "günlük satır gitmez");
    assert.ok(t.weeks.length > 0 && t.weeks.every((w) => w.labor === null), "haftaların işçilik tutarı gitmez");
    assert.ok(weekOf(before).ratio !== null, "dünün haftasının oranı var (ciro biliniyor)");
    assert.ok(t.month.ratio !== null, "ayın oranı var");

    // Müdür dün için Can'ı Vardiya'ya yazar (yetkisi var; geçmiş gün)
    const saved = await saveCan("09-17", "");
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const afterWrite = await labor.loadLaborReport(month);
    assert.deepEqual(afterWrite, before, "hücreden sonra müdürün raporu birebir aynı (fark Can'ın ücreti olurdu)");

    // Yöneticinin raporunda aynı hücre Can'ın tam günlük ücreti: müdüre gitseydi ücreti verirdi
    current = yonetici;
    const adminAfter = await labor.loadLaborReport(month);
    const delta = (weekOf(adminAfter).labor ?? NaN) - (weekOf(adminBefore).labor ?? NaN);
    assert.ok(Math.abs(delta - WAGE) < 0.01, `yöneticide hafta farkı Can'ın günlük ücreti: ${delta}`);

    // Müdür hücreyi siler: rapor yine aynı
    current = mudur;
    const removed = await saveCan("", "09-17");
    assert.equal(removed.ok, true, JSON.stringify(removed));
    assert.deepEqual(await labor.loadLaborReport(month), before, "hücre silinince de müdürün raporu aynı");
  });
});
