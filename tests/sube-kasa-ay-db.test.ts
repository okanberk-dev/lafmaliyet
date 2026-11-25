// İki şubeli ay, gerçek Postgres'te (denetim 13 Kasım 2026, P02; src/server/data/cash-reports.ts tillRows,
// src/server/data/dataset.ts, src/lib/cash-month.ts): "Tümü" şubelerin toplamıdır. İki şube aynı gün rapor girince açık
// gün günde bir kez sayılır, personel ve sabit gider bir kez oranlanır (oran 1; HM-01, KP-03, KP-X1); bir şubenin elle
// yazdığı öteki şubenin kasasını ezmez (HM-02); bir şubenin raporu öteki şubenin föyünü düşürmez (HM-03); ay ortasında
// açılan şubenin ilk ayı açılış gününden sayılır (HM-04); Bugün'ün şube kartı föyden sayılan günü çizer (HM-09).
// İncelemeden sonra: açılış günü boş şubenin ilk ayı Tümü'den düşmez, Tümü'de ciro ve açık gün yazılmaz (Satışlar'ın
// formu Tuzla'ya yazar), şubeye bağlı personel ve sabit gider Tümü'de de şubenin günüyle oranlanır. Kasa'nın ay satırı
// ve "Ayı temizle" main'de 21 Kasım denetimiyle düzeldi (tests/kasa-ay-bilgisi.test.ts, tests/sube-rapor.test.ts).
//
// SUBE_TEST_DATABASE_URL (yoksa SAYIM_TEST_DATABASE_URL ya da EKLE_TEST_DATABASE_URL) verilmezse atlanır. Test kendi
// geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: SUBE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/sube-kasa-ay-db.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { ALL_BRANCHES, DEFAULT_BRANCHES, MONTH_TOTALS_LOCKED_TEXT } from "../src/lib/branches";
import { dashboard } from "../src/lib/calc/insights";
import { manualOf } from "../src/lib/cash-month";
import { parseKasaFoyu } from "../src/lib/modpos/foy";
import { MODPOS_FALLBACK_KEY } from "../src/lib/modpos/status";
import { addDays } from "../src/lib/reminders";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.SUBE_TEST_DATABASE_URL ?? process.env.SAYIM_TEST_DATABASE_URL ?? process.env.EKLE_TEST_DATABASE_URL;
const DB_NAME = `laffogato_sube_kasa_ay_${process.pid}`;

const parsed = parseKasaFoyu(readFileSync(join(__dirname, "fixtures/modpos/belge-ornegi.xml"), "utf8"));
assert.ok(parsed.ok, "kitapçığın örneği okunur");
/** Kitapçığın örneği: bütün kasaları kapanmış gün, ciro 28.450,50 (kafenin verisi değil) */
const FOY = parsed.foy;

/** [from, to] günleri, ikisi de dahil */
const span = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

describe("iki şubeli ay: veritabanında", { skip: !SERVER_URL && "SUBE_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let dataset: typeof import("../src/server/data/dataset");
  let withBranchScope: typeof import("../src/server/branch-scope").withBranchScope;
  let store: typeof import("../src/server/modpos/store");
  let branchDay: typeof import("../src/server/data/branch-day");
  let pnl: typeof import("../src/server/actions/pnl");
  let sales: typeof import("../src/server/actions/sales");

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "sube-kasa-ay-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır; oturum ve sayfa yenileme taklit edilir
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, cacheTag: () => {}, cacheLife: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    // Tuzla ve Marina etkin (iki kasa: "Tümü" şubelerin toplamı)
    await db
      .insert(s.branches)
      .values(DEFAULT_BRANCHES.map((b) => ({ ...b, active: true })))
      .onConflictDoUpdate({ target: s.branches.id, set: { active: true } });
    const [a] = await db.insert(s.users).values({ email: "yonetici@laffogato.net", name: "Yönetici", passwordHash: "x", role: "admin" }).returning();
    const me = async () => ({ ...a, role: "admin" as const });
    stub(require.resolve("../src/server/auth/dal"), { getCurrentUser: me, requireUser: me, requireAdmin: me });
    dataset = await import("../src/server/data/dataset");
    withBranchScope = (await import("../src/server/branch-scope")).withBranchScope;
    store = await import("../src/server/modpos/store");
    branchDay = await import("../src/server/data/branch-day");
    pnl = await import("../src/server/actions/pnl");
    sales = await import("../src/server/actions/sales");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE cash_reports, modpos_cash_sheets, months, sales_lines, staff, staff_versions, fixed_expenses, pnl_entries, activity_log RESTART IDENTITY CASCADE`);
    await db.delete(s.settings).where(eq(s.settings.key, MODPOS_FALLBACK_KEY));
    await db.update(s.branches).set({ openedOn: null }).where(eq(s.branches.id, "marina"));
  });

  /** Günlerin raporları: Tuzla 20.000 (kart 12.000), Marina 6.000 (kart 3.000); ödenmez yok */
  const reports = (branchId: "tuzla" | "marina", days: string[]) =>
    db.insert(s.cashReports).values(
      days.map((date) =>
        branchId === "tuzla"
          ? { date, branchId, zTotal: 20_000, card: 12_000, cash: 8_000, mealCard: 0, discounts: 0, offRevenue: 0, submittedByName: "Ayşe" }
          : { date, branchId, zTotal: 6_000, card: 3_000, cash: 3_000, mealCard: 0, discounts: 0, offRevenue: 0, submittedByName: "Deniz" },
      ),
    );
  const model = (scope: string) => dataset.loadModel({ scope });

  test("Tümü şubelerin toplamı: açık gün günde bir kez, personel ve sabit gider bir kez (oran 1; HM-01, KP-03, KP-X1)", async () => {
    await reports("tuzla", span("2026-10-01", "2026-10-31"));
    await reports("marina", span("2026-10-01", "2026-10-31"));
    await db.insert(s.staff).values([
      { name: "Barista T", branchId: "tuzla", netSalary: 30_000, extras: 0, sortOrder: 1 },
      { name: "Barista M", branchId: "marina", netSalary: 30_000, extras: 0, sortOrder: 2 },
    ]);
    // İşletme geneli, açık güne göre oranlanan kalemler
    await db.insert(s.fixedExpenses).values([
      { name: "Muhasebe", section: "genel", period: "aylik", amount: 10_000, prorate: true, sortOrder: 1 },
      { name: "Elektrik", section: "faturalar", period: "aylik", amount: 6_000, prorate: true, sortOrder: 2 },
    ]);
    const [all, tuzla, marina] = await Promise.all([model(ALL_BRANCHES), model("tuzla"), model("marina")]);
    const info = all.monthInfo.get("2026-10")!;
    assert.deepEqual([info.openDays, info.posRevenue, info.sources?.openDays], [31, 806_000, "kasa"]);
    assert.deepEqual([tuzla.monthInfo.get("2026-10")!.posRevenue, marina.monthInfo.get("2026-10")!.posRevenue], [620_000, 186_000]);
    const p = all.pnlMonth("2026-10");
    assert.deepEqual([p.openDays, p.prorationDays, p.ratio], [31, 31, 1]);
    assert.equal(p.sections.genel, 10_000, "işletme geneli kalem iki kez sayılmaz");
    assert.equal(p.sections.faturalar, 6_000);
    const pt = tuzla.pnlMonth("2026-10");
    const pm = marina.pnlMonth("2026-10");
    assert.equal(pt.ratio, 1);
    assert.ok(Math.abs(p.sections.personel - (pt.sections.personel + pm.sections.personel)) < 0.01, "Tümü'nün personeli şubelerin toplamı");
    // Günlük ortalama günde iki şubenin toplamı (26.000), şube ortalaması değil
    assert.equal(dashboard(all, "2026-10").dailyAvg, 26_000);
  });

  test("süren ayın ay sonu öngörüsü farklı günle: 12 günde 312.000 → ay sonu 780.000 (HM-01)", async () => {
    await reports("tuzla", span("2026-09-01", "2026-09-12"));
    await reports("marina", span("2026-09-01", "2026-09-12"));
    const all = await model(ALL_BRANCHES);
    const d = dashboard(all, "2026-09", { currentMonth: "2026-09" });
    assert.equal(all.monthInfo.get("2026-09")!.openDays, 12);
    assert.equal(d.dailyAvg, 26_000);
    assert.equal(d.forecast?.daysElapsed, 12);
    assert.equal(d.forecast?.projectedRevenue, (312_000 / 12) * 30);
  });

  test("bir şubenin elle yazdığı ay bilgisi öteki şubenin kasa cirosunu ezmez (HM-02); ay yazımı seçili şubeye", async () => {
    await reports("tuzla", span("2026-09-01", "2026-09-12"));
    await reports("marina", span("2026-09-01", "2026-09-12"));
    await db.insert(s.months).values({ month: "2026-09", branchId: "marina", openDays: 12, posRevenue: 80_000 });
    const [all, tuzla, marina] = await Promise.all([model(ALL_BRANCHES), model("tuzla"), model("marina")]);
    const info = all.monthInfo.get("2026-09")!;
    assert.equal(info.posRevenue, 240_000 + 80_000, "Tuzla'nın kasası + Marina'nın elle yazdığı");
    assert.equal(info.openDays, 12);
    assert.equal(tuzla.monthInfo.get("2026-09")!.posRevenue, 240_000);
    assert.equal(marina.monthInfo.get("2026-09")!.posRevenue, 80_000);
    // "Tümü"de Satışlar'ın ay formu yazdığı şubenin (Tuzla) elle yazılanını gösterir
    assert.equal(manualOf(info.byBranch?.tuzla, "posRevenue"), null);
    assert.equal(manualOf(info.byBranch?.marina, "posRevenue"), 80_000);
    // Gelir-gider'den yazılan ciro seçili şubenin ay satırına iner (şubesiz yazılsaydı Tuzla'nınkine inerdi)
    const res = await withBranchScope("marina", () => pnl.setMonthField("2026-09", "posRevenue", 90_000));
    assert.equal(res.ok, true, JSON.stringify(res));
    const rows = await db.select({ branchId: s.months.branchId, pos: s.months.posRevenue }).from(s.months).where(eq(s.months.month, "2026-09"));
    assert.deepEqual(rows, [{ branchId: "marina", pos: 90_000 }]);
    const note = await withBranchScope("marina", () => pnl.setMonthNote("2026-09", "Marina'nın notu"));
    assert.equal(note.ok, true, JSON.stringify(note));
    const [noted] = await db.select({ note: s.months.note }).from(s.months).where(and(eq(s.months.month, "2026-09"), eq(s.months.branchId, "marina")));
    assert.equal(noted.note, "Marina'nın notu");
  });

  test("Tuzla'nın raporu Marina'nın aynı günkü föyünü düşürmez (HM-03); Bugün'ün şube kartı föyü çizer (HM-09)", async () => {
    await reports("tuzla", span("2026-09-01", "2026-09-12"));
    await reports("marina", span("2026-09-01", "2026-09-11"));
    // 12 Eylül: Marina'nın raporu yok, ModPOS föyü kapanmış; ay rakamına yedek açık
    await store.storeFoy(db, { ...structuredClone(FOY), kasaGunu: "2026-09-12" }, new Date("2026-09-13T09:00:00+03:00"), null, "marina");
    await db.insert(s.settings).values({ key: MODPOS_FALLBACK_KEY, value: true });
    const [all, tuzla, marina] = await Promise.all([model(ALL_BRANCHES), model("tuzla"), model("marina")]);
    const pos = (m: Awaited<ReturnType<typeof model>>) => m.monthInfo.get("2026-09")!.posRevenue;
    assert.equal(pos(marina), 66_000 + 28_450.5);
    assert.equal(pos(tuzla), 240_000);
    assert.equal(pos(all), (pos(tuzla) ?? 0) + (pos(marina) ?? 0), "Tümü şubelerin toplamı");
    assert.equal(all.monthInfo.get("2026-09")!.openDays, 12);
    // Kart: 12 Eylül'de iki şubenin günü de var; Marina'nınki föyden, ay rakamıyla aynı tutar
    const day = await branchDay.loadBranchDay(new Date("2026-09-13T12:00:00+03:00"));
    assert.ok(day);
    assert.equal(day.day, "2026-09-12");
    assert.deepEqual(
      day.rows.map((r) => [r.id, r.source, r.revenue]),
      [
        ["tuzla", "rapor", 20_000],
        ["marina", "modpos", 28_450.5],
      ],
    );
    assert.deepEqual(day.trend.at(-1), { day: "2026-09-12", revenue: 20_000 + 28_450.5, missing: 0 });
    // Anahtar kapalıyken föy okunmaz: gün eksik
    await db.delete(s.settings).where(eq(s.settings.key, MODPOS_FALLBACK_KEY));
    const off = await branchDay.loadBranchDay(new Date("2026-09-13T12:00:00+03:00"));
    assert.deepEqual(off?.trend.at(-1), { day: "2026-09-12", revenue: 20_000, missing: 1 });
  });

  test("ay ortasında açılan şubenin ilk ayı açılış gününden: ciro ve açık gün kasadan, elle girmek gerekmez (HM-04)", async () => {
    await db.update(s.branches).set({ openedOn: "2026-08-05" }).where(eq(s.branches.id, "marina"));
    await reports("tuzla", span("2026-08-01", "2026-08-31"));
    await reports("marina", span("2026-08-05", "2026-08-31"));
    const [all, marina] = await Promise.all([model(ALL_BRANCHES), model("marina")]);
    const m = marina.monthInfo.get("2026-08")!;
    assert.equal(m.kasa?.till.partialFrom, null);
    assert.deepEqual([m.openDays, m.posRevenue, m.sources?.posRevenue], [27, 27 * 6_000, "kasa"]);
    const pm = marina.pnlMonth("2026-08");
    assert.notEqual(pm.revenue, null, "ay kâra girer");
    assert.equal(pm.prorationDays, 27, "açılış gününden ayın sonuna");
    const a = all.monthInfo.get("2026-08")!;
    assert.deepEqual([a.openDays, a.posRevenue], [31, 31 * 20_000 + 27 * 6_000]);
    assert.equal(all.pnlMonth("2026-08").ratio, 1);
  });

  test("açılış günü boş şubenin ilk ayı: Tümü'nün cirosuna girer, şube görünümünde de kasadan (Tuzla dışındaki şube ilk raporunda açılmış sayılır)", async () => {
    // İncelemedeki durum: Marina'nın açılış günü boş (tohumun varsayılanı), raporları 5 Ağustos'tan
    await reports("tuzla", span("2026-08-01", "2026-08-31"));
    await reports("marina", span("2026-08-05", "2026-08-31"));
    const [all, tuzla, marina] = await Promise.all([model(ALL_BRANCHES), model("tuzla"), model("marina")]);
    const m = marina.monthInfo.get("2026-08")!;
    assert.equal(m.kasa?.till.partialFrom, null);
    assert.deepEqual([m.openDays, m.posRevenue, m.sources?.posRevenue], [27, 27 * 6_000, "kasa"]);
    const a = all.monthInfo.get("2026-08")!;
    assert.equal(a.posRevenue, 31 * 20_000 + 27 * 6_000, "Marina'nın cirosu Tümü'den düşmez");
    assert.equal(a.posRevenue, (tuzla.monthInfo.get("2026-08")!.posRevenue ?? 0) + (m.posRevenue ?? 0), "Tümü şubelerin toplamı");
    assert.equal(a.kasa?.values.posRevenue, a.posRevenue, "kasa bilgisi (grafik, Kasa satırı) ile ciro aynı");
    assert.equal(all.pnlMonth("2026-08").revenue, a.posRevenue);
    // Tuzla'nın kendi eski verisi için kural değişmez: ay ortasında başlayan ilk ay yarım
    await db.delete(s.cashReports).where(and(eq(s.cashReports.branchId, "tuzla"), sql`${s.cashReports.date} < '2026-08-10'`));
    const t = (await model("tuzla")).monthInfo.get("2026-08")!;
    assert.equal(t.kasa?.till.partialFrom, "2026-08-10");
    assert.equal(t.posRevenue, null);
  });

  test("şubenin açılış ayında Tümü'nün personeli ve şubeye bağlı sabit gideri şubelerin toplamı (şube kendi günüyle)", async () => {
    await db.update(s.branches).set({ openedOn: "2026-08-05" }).where(eq(s.branches.id, "marina"));
    await reports("tuzla", span("2026-08-01", "2026-08-31"));
    await reports("marina", span("2026-08-05", "2026-08-31"));
    await db.insert(s.staff).values([
      { name: "Barista T", branchId: "tuzla", netSalary: 30_000, extras: 0, sortOrder: 1 },
      { name: "Barista M", branchId: "marina", netSalary: 30_000, extras: 0, sortOrder: 2 },
    ]);
    await db.insert(s.fixedExpenses).values([
      { name: "Marina kira", section: "kira", period: "aylik", amount: 31_000, prorate: true, branchId: "marina", sortOrder: 1 },
      { name: "Muhasebe", section: "genel", period: "aylik", amount: 3_100, prorate: true, sortOrder: 2 },
    ]);
    const [all, tuzla, marina] = await Promise.all([model(ALL_BRANCHES), model("tuzla"), model("marina")]);
    const [p, pt, pm] = [all, tuzla, marina].map((x) => x.pnlMonth("2026-08"));
    assert.equal(pm.prorationDays, 27);
    assert.ok(Math.abs(p.sections.personel - (pt.sections.personel + pm.sections.personel)) < 0.01, "Tümü'nün personeli şubelerin toplamı");
    assert.ok(Math.abs(all.pnlValue(p, "fixed:1").value! - 27_000) < 0.01, "Marina'nın kirası 27/31 gün, şube görünümündeki gibi");
    assert.ok(Math.abs(marina.pnlValue(pm, "fixed:1").value! - 27_000) < 0.01);
    assert.ok(Math.abs(all.pnlValue(p, "fixed:2").value! - 3_100) < 0.01, "işletme geneli kalem işletmenin günüyle (31)");
    assert.match(all.pnlValue(p, "personnel:employer").info ?? "", /kendi şubesinin günüyle/);
  });

  test("Tümü'de Gelir-gider'in ciro ve açık gün hücresi yazılmaz; Satışlar'ın formu Tuzla'nın satırına yazar", async () => {
    await reports("tuzla", span("2026-09-01", "2026-09-12"));
    await reports("marina", span("2026-09-01", "2026-09-12"));
    const before = (await model(ALL_BRANCHES)).monthInfo.get("2026-09")!.posRevenue;
    assert.equal(before, 240_000 + 72_000);
    // İncelemedeki tuzak: Tümü'de işletmenin toplamı yazılınca Tuzla'nın ayına inerdi, Marina iki kez sayılırdı
    for (const [field, value] of [
      ["posRevenue", 315_000],
      ["posRevenue", null],
      ["openDays", 12],
    ] as const) {
      const res = await withBranchScope(ALL_BRANCHES, () => pnl.setMonthField("2026-09", field, value));
      assert.deepEqual(res, { ok: false, error: MONTH_TOTALS_LOCKED_TEXT }, `${field} ${value}`);
    }
    assert.equal((await db.select().from(s.months)).length, 0, "ay satırı yazılmadı");
    // Ekran da kilitler: Tümü'de ciro satırı girilemez, şubede girilir
    const [all, marina] = await Promise.all([model(ALL_BRANCHES), model("marina")]);
    assert.equal(all.ds.monthTotalsLocked, true);
    const revenueDef = (x: Awaited<ReturnType<typeof model>>) => x.pnlRowDefs(["2026-09"]).find((d) => d.key === "revenue")!;
    assert.equal(revenueDef(all).editable, false);
    assert.equal(revenueDef(marina).editable, true);
    // Satışlar'ın ay formu Tümü'de Tuzla'nın satırını gösterir ve şubeyi gönderir: Tümü = Tuzla'nın elle yazdığı + Marina'nın
    // kasası. Şubeyi göndermeyen eski sekme Tümü'de reddedilir (sessizce Tuzla'ya inmez; tests/form-sube.test.ts)
    const info = { month: "2026-09", openDays: null, posRevenue: 250_000, discounts: null, offRevenue: null, cardShare: null, note: null };
    assert.deepEqual(await withBranchScope(ALL_BRANCHES, () => sales.saveMonthInfo(info)), { ok: false, error: "Hangi şubeye yazılsın? Şubeyi seçin" });
    const saved = await withBranchScope(ALL_BRANCHES, () => sales.saveMonthInfo({ ...info, branchId: "tuzla" }));
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const rows = await db.select({ branchId: s.months.branchId, pos: s.months.posRevenue }).from(s.months);
    assert.deepEqual(rows, [{ branchId: "tuzla", pos: 250_000 }]);
    const after = (await model(ALL_BRANCHES)).monthInfo.get("2026-09")!;
    assert.equal(after.posRevenue, 250_000 + 72_000, "Marina bir kez sayılır");
    assert.equal(manualOf(after.byBranch?.tuzla, "posRevenue"), 250_000);
  });
});
