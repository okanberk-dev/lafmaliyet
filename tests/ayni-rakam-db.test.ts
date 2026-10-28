// Aynı rakam her yerde (denetim 26 Eki 2026, B15) gerçek Postgres'te, oturum ve next/cache taklit edilerek:
// - E-62: "Sabit giderlerden ekle" adayları bitiş ayına göre (saklı `active` bayat olsa da); aylık girişe çevirme
//   `active`'i de yazar; çevirmenin tahmini kaydı tutarı düzeltilene kadar ödenmiş sayılmaz (E-13);
// - E-46: sabit giderde zam girilince "Sabit giderlerden ekle" ile açılmış hatırlatıcının otomatik tutarı uyar (ileride
//   değişiyorsa boşalır), elle yazılmış tutara dokunulmaz ama sonuç mesajı uyarır;
// - E-41: kapalı işaretli günler (ileri tarihli dahil) modele gelir; raporlu gün kapalı sayılmaz.
//
// AYNI_TEST_DATABASE_URL (yoksa FIFO_TEST_DATABASE_URL) verilmezse atlanır. Bir Postgres sunucusunun adresi (veritabanı
// oluşturabilen kullanıcı): test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: AYNI_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/ayni-rakam-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { currentMonthTR, shiftMonth } from "../src/lib/calc/engine";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.AYNI_TEST_DATABASE_URL ?? process.env.FIFO_TEST_DATABASE_URL;
const DB_NAME = `laffogato_ayni_rakam_${process.pid}`;
const CUR = currentMonthTR();
const PREV = shiftMonth(CUR, -1);
const NEXT = shiftMonth(CUR, 1);

describe("aynı rakam: veritabanında", { skip: !SERVER_URL && "AYNI_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let costs: typeof import("../src/server/actions/costs");
  let reminders: typeof import("../src/server/actions/reminders");
  let expenses: typeof import("../src/server/actions/expenses");
  let loadModel: typeof import("../src/server/data/dataset").loadModel;
  let loadFixedForReminders: typeof import("../src/server/data/fixed-reminders").loadFixedForReminders;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "ayni-rakam-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
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
    const [a] = await db.insert(s.users).values({ email: "yonetici@laffogato.net", name: "Yönetici", passwordHash: "x", role: "admin" }).returning();
    const me = async () => ({ ...a, role: "admin" as const });
    stub(require.resolve("../src/server/auth/dal"), { requireUser: me, requireAdmin: me });
    costs = await import("../src/server/actions/costs");
    reminders = await import("../src/server/actions/reminders");
    expenses = await import("../src/server/actions/expenses");
    loadModel = (await import("../src/server/data/dataset")).loadModel;
    loadFixedForReminders = (await import("../src/server/data/fixed-reminders")).loadFixedForReminders;
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  const fixed = async (name: string, amount: number, over: Partial<typeof s.fixedExpenses.$inferInsert> = {}) =>
    (await db.insert(s.fixedExpenses).values({ name, section: "genel", period: "aylik", amount, active: true, sortOrder: 1, ...over }).returning())[0];

  test("E-62: bitmiş kalem (saklı active bayat olsa da) aday değil; aylık girişe çevirme active'i de yazar", async () => {
    const live = await fixed("Instagram reklamı", 30_000);
    // Eylül'de "Aralık'ta bitecek" diye girilmiş, ay geçti: saklı sütun hâlâ true
    await fixed("Eski kampanya", 5_000, { endMonth: PREV, active: true });
    await fixed("Bu ay biten", 2_000, { endMonth: CUR });
    await fixed("Gelecek ay başlayan", 1_000, { startMonth: NEXT });
    const names = async () => (await loadFixedForReminders(db, CUR)).candidates.map((f) => f.name);
    assert.deepEqual(await names(), ["Instagram reklamı", "Bu ay biten", "Gelecek ay başlayan"]);

    const r = await expenses.convertFixedToMonthly(live.id, CUR);
    assert.equal(r.ok, true, JSON.stringify(r));
    const [after] = await db.select().from(s.fixedExpenses).where(eq(s.fixedExpenses.id, live.id));
    assert.equal(after.endMonth, PREV);
    assert.equal(after.active, false, "saklı sütun da bitiş ayıyla");
    assert.deepEqual(await names(), ["Bu ay biten", "Gelecek ay başlayan"]);
    // Tahmini kayıt KDV hariç olduğunu söyler (E-60); başabaş onu saymaya devam eder (E-13)
    const [entry] = await db.select().from(s.expenseEntries);
    assert.equal(entry.amount, 30_000);
    assert.match(entry.description ?? "", /KDV hariç tutar \(tahmini\): ödediğiniz tutarı yazın/);
    const model = await loadModel();
    assert.deepEqual(
      model.monthlyExpensePlan(CUR).map((x) => [x.cat.name, x.amount, x.source]),
      [["Instagram reklamı", 30_000, "entered"]],
    );
    assert.deepEqual(
      model.monthlyExpensePlan(NEXT).map((x) => [x.cat.name, x.amount, x.source]),
      [["Instagram reklamı", 30_000, "carried"]],
    );
    // Tahmini kayıt ödeme değildir: nakit planı onu ödemeye devam eder (E-13)
    const { planInputFromModel } = await import("../src/lib/cash-plan");
    const planned = async () => planInputFromModel(await loadModel(), `${CUR}-15`).months[CUR].expenses?.map((x) => [x.amount, x.paid]);
    assert.deepEqual(await planned(), [[30_000, 0]]);
    // Açıklamasına dokunmadan tutarı düzeltilince ödenen tutar olur
    const edit = await expenses.saveExpenseEntry({ id: entry.id, date: entry.date, categoryId: entry.categoryId, description: entry.description, amount: 36_000, paymentMethod: null, note: null });
    assert.equal(edit.ok, true, JSON.stringify(edit));
    const [paid] = await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.id, entry.id));
    assert.equal(paid.description, null);
    assert.deepEqual(await planned(), [[36_000, 36_000]]);
  });

  test("E-46: zam girilince otomatik tutarlı hatırlatıcı uyar; ileride değişiyorsa boşalır; elle yazılmışa dokunulmaz", async () => {
    // Geçen aydan beri sayılan kalem: sonraki ayların değişikliği sürüm olur (önceki aylar eski tutarla kalır)
    const kira = await fixed("Kira", 160_000, { section: "kira", startMonth: PREV });
    const due = `${NEXT}-01`;
    const added = await reminders.addFixedExpenseReminder(kira.id, due);
    assert.equal(added.ok, true, JSON.stringify(added));
    const rem = async (title: string) => (await db.select().from(s.reminders).where(eq(s.reminders.title, title)))[0];
    assert.equal((await rem("Kira")).amount, 192_000, "KDV dahil");

    const save = (id: number, name: string, amount: number, effectiveFrom: string, section: "kira" | "genel" = "kira") =>
      costs.saveFixedExpense({ id, name, section, period: "aylik", amount, note: null, effectiveFrom });
    // Hatırlatıcının ayından itibaren zam: tutar yeni sürüme uyar
    const a = await save(kira.id, "Kira", 170_000, NEXT);
    assert.equal(a.ok, true, JSON.stringify(a));
    assert.equal((await rem("Kira")).amount, 204_000);
    assert.match((a.ok && a.data.message) || "", /“Kira” hatırlatıcısı da güncellendi/);
    // Sonraki bir aydan zam (Ocak'tan): tek tutar iki dönemi taşıyamaz, boşalır (nakit planı her ay Giderler'i izler)
    const b = await save(kira.id, "Kira", 200_000, shiftMonth(CUR, 3));
    assert.equal(b.ok, true, JSON.stringify(b));
    assert.equal((await rem("Kira")).amount, null);
    assert.match((b.ok && b.data.message) || "", /tutarı kaldırıldı/);

    // Elle yazılmış tutar: dokunulmaz, uyarılır
    const aidat = await fixed("Aidat", 10_000, { startMonth: PREV });
    assert.equal((await reminders.addFixedExpenseReminder(aidat.id, due)).ok, true);
    await db.update(s.reminders).set({ amount: 12_500 }).where(eq(s.reminders.title, "Aidat"));
    const c = await save(aidat.id, "Aidat", 11_000, CUR, "genel");
    assert.equal(c.ok, true, JSON.stringify(c));
    assert.equal((await rem("Aidat")).amount, 12_500);
    assert.match((c.ok && c.data.message) || "", /“Aidat” hatırlatıcısında 12\.500\s₺ yazılı, sabit giderde 13\.200\s₺ \(KDV dahil\): kontrol edin/);
    // Elle açılmış (notsuz) aynı adlı hatırlatıcı izlenmez
    await db.insert(s.reminders).values({ title: "Su", kind: "odeme", amount: 600, dueDate: due, anchorDate: due, repeat: "monthly", remindDaysBefore: 3 });
    const su = await fixed("Su", 500, { startMonth: PREV });
    const d = await save(su.id, "Su", 700, CUR, "genel");
    assert.equal(d.ok, true);
    assert.equal((await rem("Su")).amount, 600);
  });

  test("E-41: kapalı işaretli günler (ileri tarihli dahil) modele gelir; raporlu gün kapalı sayılmaz", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const ahead = `${NEXT}-03`;
    const reported = `${PREV}-10`;
    await db.insert(s.specialDays).values([
      { dateFrom: ahead, dateTo: `${NEXT}-04`, kind: "kapali", title: "Bakım", createdByName: "Yönetici" },
      { dateFrom: reported, dateTo: reported, kind: "kapali", title: "Yanlış işaret", createdByName: "Yönetici" },
      { dateFrom: ahead, dateTo: ahead, kind: "derbi", title: "Maç", createdByName: "Yönetici" },
    ]);
    await db.insert(s.cashReports).values({ date: reported, zTotal: 12_000, card: 8_000, mealCard: 0, submittedByName: "Ayşe" });
    const model = await loadModel();
    assert.deepEqual(model.ds.closedDays, [ahead, `${NEXT}-04`]);
    assert.deepEqual(model.closedDaysOf(NEXT), [ahead, `${NEXT}-04`]);
    assert.deepEqual(model.closedDaysOf(PREV), []);
    assert.ok(today.length === 10);
  });
});
