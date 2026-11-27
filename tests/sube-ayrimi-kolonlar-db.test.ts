// Şube ayrımı parça 3, gerçek Postgres'te (docs/SUBE.md › Şube ayrımı › Şube sütunu gelen tablolar): migration 0101'in
// dört sütunu. Kontrol listesinin günlük kaydı şube başına (bütün şubelerin listesinin her şubede kendi kaydı), işlem
// geçmişi, gönderim günlüğü ve yatırımlar şubeyi taşır; şube seçiliyken başka şubenin kaydı okunmaz. Tuzla'nın kayıtları
// "IZ-TUZLA" işaretini taşır: Marina seçiliyken hiçbir çıktıda görünmemeli, "Tümü"de görünmeli. Oturum gerçek
// src/server/auth/dal.ts'le, çerezler taklit edilerek (tests/sube-ayrimi-sizinti-db.test.ts gibi).
//
// SUBE_KOLON_TEST_DATABASE_URL verilmezse atlanır (npm run test:db onu TEST_DATABASE_URL'e bağlar). Bir Postgres
// sunucusunun adresi: test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: SUBE_KOLON_TEST_DATABASE_URL=postgres://localhost/postgres npx tsx --test tests/sube-ayrimi-kolonlar-db.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { ALL_BRANCHES, BRANCH_COOKIE, BRANCH_REQUIRED, DEFAULT_BRANCHES } from "../src/lib/branches";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.SUBE_KOLON_TEST_DATABASE_URL;
const DB_NAME = `laffogato_sube_kolon_${process.pid}`;
const SECRET = "sube-kolon-testi-icin-en-az-otuz-iki-karakterlik-anahtar";
const MARK = "IZ-TUZLA";
const tr = (local: string) => new Date(`${local}:00+03:00`);
const DAY = "2026-11-26";
const NOW = tr("2026-11-26T09:30");

class Jar {
  values = new Map<string, string>();
  get(name: string) {
    const value = this.values.get(name);
    return value === undefined ? undefined : { name, value };
  }
  set(name: string, value: string, opts: { maxAge?: number } = {}) {
    if (opts.maxAge === 0 || value === "") this.values.delete(name);
    else this.values.set(name, value);
  }
}

describe("şube ayrımı parça 3: şube sütunu gelen tablolar veritabanında", { skip: !SERVER_URL && "SUBE_KOLON_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let dal: typeof import("../src/server/auth/dal");
  let scope: typeof import("../src/server/branch-scope");
  let store: typeof import("../src/server/checklists/store");
  let jar = new Jar();
  const ids = { ali: 0, ayse: 0, tuzlaci: 0, shared: 0, marinaList: 0, item: 0 };
  const deps = { photos: false, linkPhoto: async () => {} };

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: SECRET, ADMIN_2FA_OPTIONAL: "1" });
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/headers", { cookies: async () => jar, headers: async () => new Headers() });
    stub("next/navigation", {
      redirect: (to: string) => {
        throw Object.assign(new Error("NEXT_REDIRECT"), { to });
      },
      notFound: () => {
        throw new Error("NEXT_NOT_FOUND");
      },
      unstable_rethrow: (e: unknown) => {
        if ((e as Error)?.message === "NEXT_REDIRECT" || (e as Error)?.message === "NEXT_NOT_FOUND") throw e;
      },
    });
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, updateTag: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    for (const b of DEFAULT_BRANCHES) await db.insert(s.branches).values({ ...b, active: true }).onConflictDoUpdate({ target: s.branches.id, set: { active: true } });
    const user = async (name: string, email: string, role: "admin" | "staff", branchId: string | null) =>
      (await db.insert(s.users).values({ name, email, role, branchId, passwordHash: "x" }).returning({ id: s.users.id }))[0].id;
    ids.ali = await user("Ali", "ali@ornek.com", "admin", null);
    ids.ayse = await user("Ayşe Marina", "ayse@ornek.com", "staff", "marina");
    ids.tuzlaci = await user(`${MARK} Kişi`, "tuzla@ornek.com", "staff", "tuzla");

    // Kontrol listeleri: bütün şubelerin listesi ve Marina'nın listesi (Tuzla'nın satırı işaretli yanıtla dolacak)
    const template = async (name: string, branchId: string | null) => {
      const [t] = await db
        .insert(s.checklistTemplates)
        .values({ name, opensAt: "08:00", dueAt: "11:00", activeFrom: tr("2026-11-01T00:00"), branchId })
        .returning({ id: s.checklistTemplates.id });
      const [i] = await db.insert(s.checklistItems).values({ templateId: t.id, label: "Not", type: "text", required: true }).returning({ id: s.checklistItems.id });
      return { id: t.id, item: i.id };
    };
    const shared = await template("Kapanış", null);
    ids.shared = shared.id;
    ids.item = shared.item;
    ids.marinaList = (await template("Marina açılış", "marina")).id;

    dal = await import("../src/server/auth/dal");
    scope = await import("../src/server/branch-scope");
    store = await import("../src/server/checklists/store");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  /** Oturum; seçicide `secim` */
  const signIn = async (who: number, secim: string) => {
    jar = new Jar();
    const [u] = await db.select().from(s.users).where(eq(s.users.id, who));
    await dal.startSession(u);
    jar.set(BRANCH_COOKIE, secim);
  };
  const leaks = (v: unknown) => JSON.stringify(v).includes(MARK);
  const me = (id: number, name: string, role: "admin" | "staff", runBranch: { id: string } | { error: string } | null, lock: string | null = null) => ({ id, name, role, lock, runBranch });

  test("kontrol listesi: bütün şubelerin listesinin her şubede kendi kaydı; şube seçiliyken öbür şubenin kaydı yok", async () => {
    const answer = (who: ReturnType<typeof me>, text: string) =>
      store.writeAnswer(db, who, { templateId: ids.shared, date: DAY, itemId: ids.item, op: "text", text }, NOW, deps);
    const t = await answer(me(ids.tuzlaci, MARK, "staff", { id: "tuzla" }, "tuzla"), `${MARK} notu`);
    const m = await answer(me(ids.ayse, "Ayşe", "staff", { id: "marina" }, "marina"), "Marina notu");
    assert.notEqual(t.run.id, m.run.id, "iki şubenin kaydı ayrı");
    assert.deepEqual([t.run.branchId, m.run.branchId, t.completedNow, m.completedNow], ["tuzla", "marina", true, true]);
    // Şube gelmeyen yazım bütün şubelerin listesine yazılmaz (Tümü'de sessizce Tuzla'ya inmez)
    await assert.rejects(answer(me(ids.ali, "Ali", "admin", { error: BRANCH_REQUIRED }), "?"), (e: unknown) => e instanceof store.ChecklistError && e.message === BRANCH_REQUIRED);
    await assert.rejects(answer(me(ids.ali, "Ali", "admin", null), "?"), (e: unknown) => e instanceof store.ChecklistError && e.message === BRANCH_REQUIRED);
    // Şubeli listede yazımın şubesi yok sayılır: kayıt listenin şubesinde
    const [mi] = await db.select({ id: s.checklistItems.id }).from(s.checklistItems).where(eq(s.checklistItems.templateId, ids.marinaList));
    const own = await store.writeAnswer(db, me(ids.ali, "Ali", "admin", { error: BRANCH_REQUIRED }), { templateId: ids.marinaList, date: DAY, itemId: mi.id, op: "text", text: "Marina açılış" }, NOW, deps);
    assert.equal(own.run.branchId, "marina");

    const ctx = { today: DAY, photos: false };
    const marina = await store.loadChecklistDay(db, DAY, "admin", { ...ctx, branch: "marina" });
    assert.deepEqual(
      marina.map((l) => [l.name, l.branchId, l.shared ?? false, l.run?.complete]),
      [
        ["Kapanış", "marina", true, true],
        ["Marina açılış", "marina", false, true],
      ],
    );
    assert.equal(leaks(marina), false, "Marina seçiliyken Tuzla'nın kaydı yok");
    const view = await store.loadRunView(db, ids.shared, DAY, ctx, "marina");
    assert.deepEqual(view?.answers.map((a) => a.textValue), ["Marina notu"]);
    assert.equal((await store.loadRunView(db, ids.shared, DAY, ctx, null))?.branchId, null, "şube verilmeden kayıt okunmaz (ekran sorar)");
    // Tümü: iki şubenin satırı yan yana, adları şubeyle
    const all = await store.loadChecklistDay(db, DAY, "admin", { ...ctx, branch: ALL_BRANCHES });
    assert.deepEqual(all.filter((l) => l.templateId === ids.shared).map((l) => [l.name, l.branchId]), [
      ["Tuzla · Kapanış", "tuzla"],
      ["Marina · Kapanış", "marina"],
    ]);
    assert.equal(leaks(all), true, "Tümü'de Tuzla'nın satırı (dolduranın adı)");
    const history = await store.loadHistory(db, DAY, DAY, "admin", { ...ctx, branch: ALL_BRANCHES });
    assert.equal(leaks(history), true, "Tümü'nün geçmişinde Tuzla'nın yanıtı");
    assert.equal(leaks(await store.loadHistory(db, DAY, DAY, "admin", { ...ctx, branch: "marina" })), false);
    // Online kanal: kanalın listesi yok
    assert.deepEqual(await store.loadChecklistDay(db, DAY, "admin", { ...ctx, branch: "online" }), []);
    // Geçmişin ilk günü şubenin kaydından (listeler bugün eklendi: ilk kayıt daha eski)
    await db.insert(s.checklistRuns).values({ templateId: ids.shared, date: "2026-11-02", branchId: "tuzla", name: "Kapanış", items: [] });
    assert.equal(await store.firstChecklistDay(db, "tuzla"), "2026-11-02");
    assert.equal(await store.firstChecklistDay(db, "marina"), DAY, "Tuzla'nın eski kaydı Marina'nın geçmişini uzatmaz");
    assert.equal(await store.firstChecklistDay(db, ALL_BRANCHES), "2026-11-02");
  });

  test("kontrol listesi: kapalı gün kanıtı kaydın şubesinden; tetikleyici sütunu bilmeyen yazımı doğru şubeye indirir", async () => {
    const closed = await import("../src/server/closed-days");
    // Bütün şubelerin listesinin Marina'daki kaydı Marina'nın kanıtı (kırmızı), Tuzla'nınki Tuzla'nın
    const marina = await closed.closedDayEvidence(db, DAY, "marina");
    assert.deepEqual([marina.checklists, marina.sharedTraces], [2, 0], "Kapanış ve Marina açılış");
    const tuzla = await closed.closedDayEvidence(db, DAY, "tuzla");
    assert.deepEqual([tuzla.checklists, tuzla.sharedTraces], [1, 0]);
    // Eski sürüm (göç sırasında) şube yazmadan kayıt açarsa: şubeli listede listenin şubesi, bütün şubelerinkinde Tuzla;
    // şubeli listeye yanlış şube yazılamaz
    await db.execute(sql`insert into checklist_runs (template_id, date, seq, name, items) values (${ids.marinaList}, '2026-11-20', 1, 'eski', '[]'::jsonb)`);
    await db.execute(sql`insert into checklist_runs (template_id, date, seq, name, items) values (${ids.shared}, '2026-11-20', 1, 'eski', '[]'::jsonb)`);
    await db.execute(sql`insert into checklist_runs (template_id, date, branch_id, seq, name, items) values (${ids.marinaList}, '2026-11-21', 'tuzla', 1, 'eski', '[]'::jsonb)`);
    const rows = await db.select({ t: s.checklistRuns.templateId, d: s.checklistRuns.date, b: s.checklistRuns.branchId }).from(s.checklistRuns).where(eq(s.checklistRuns.name, "eski"));
    assert.deepEqual(
      rows.map((r) => [r.t === ids.marinaList ? "marina-listesi" : "ortak", r.d, r.b]).sort(),
      [
        ["marina-listesi", "2026-11-20", "marina"],
        ["marina-listesi", "2026-11-21", "marina"],
        ["ortak", "2026-11-20", "tuzla"],
      ],
    );
  });

  test("sunucu kapısı: Tümü'de bütün şubelerin listesi şubeyi ister; kilitli personel kendi şubesine yazar", async () => {
    const data = await import("../src/server/data/checklists");
    const input = { templateId: ids.shared, date: "2026-11-27", itemId: ids.item, op: "text" as const, text: "kapı" };
    const at = tr("2026-11-27T09:00");
    await signIn(ids.ali, ALL_BRANCHES);
    const ali = (await dal.getCurrentUser())!;
    await assert.rejects(data.writeChecklistAnswer(ali, input, at), (e: unknown) => e instanceof Error && e.message === BRANCH_REQUIRED);
    assert.equal(await data.checklistRunBranch(null), null, "ekran şubeyi sorar");
    assert.equal(await data.checklistRunBranch("marina"), "marina", "Bugün'ün şube satırından");
    assert.equal((await data.writeChecklistAnswer(ali, { ...input, branch: "marina" }, at)).run.branchId, "marina");
    await signIn(ids.ali, "tuzla");
    assert.equal((await data.writeChecklistAnswer(ali, input, at)).run.branchId, "tuzla", "seçili şube");
    // Tuzla'ya kilitli personel Marina'nın satırına yazamaz (formun şubesi kilide uymalı)
    await signIn(ids.tuzlaci, "marina");
    const tuzlaci = (await dal.getCurrentUser())!;
    assert.equal(await data.checklistRunBranch("marina"), "tuzla", "kilit adresin şubesinden önce gelir");
    await assert.rejects(data.writeChecklistAnswer(tuzlaci, { ...input, branch: "marina" }, at), /Marina kontrol listesine yazamazsınız/);
  });

  test("işlem geçmişi: kaydın şubesi yazımın şubesi; zilin bilgi satırları şubenin ve şubesizlerin", async () => {
    const { logActivity } = await import("../src/server/actions/log");
    await signIn(ids.ali, "marina");
    await logActivity({ id: ids.ali, name: "Ali" }, "Özel gün", "Marina'da seçiliyken");
    await scope.withBranchScope("tuzla", () => logActivity({ id: ids.ali, name: "Ali" }, "Özel gün", `${MARK} formun şubesi`));
    await logActivity({ id: ids.ali, name: "Ali" }, "Özel gün", "işletme geneli", { branchId: null });
    await signIn(ids.ali, ALL_BRANCHES);
    await logActivity(null, "Kapalı gün işareti kaldırıldı (kanıt geldi)", "Tümü'de");
    const rows = await db.select({ detail: s.activityLog.detail, branchId: s.activityLog.branchId }).from(s.activityLog);
    const branchOf = (detail: string) => rows.find((r) => r.detail === detail)?.branchId;
    assert.deepEqual(
      ["Marina'da seçiliyken", `${MARK} formun şubesi`, "işletme geneli", "Tümü'de"].map(branchOf),
      ["marina", "tuzla", null, null],
    );
    // Personelin özel günü ve kapalı gün olayları zilde: Marina seçiliyken Tuzla'nın kaydı yok
    await db.update(s.activityLog).set({ userId: ids.tuzlaci }).where(eq(s.activityLog.detail, `${MARK} formun şubesi`));
    await db.update(s.activityLog).set({ userId: ids.ayse }).where(sql`${s.activityLog.detail} in ('Marina''da seçiliyken', 'işletme geneli')`);
    const closed = await import("../src/server/closed-days");
    const since = new Date(Date.now() - 60_000);
    const marina = await closed.closedInfoRows(since, "marina");
    assert.deepEqual(marina.map((r) => r.detail).sort(), ["Marina'da seçiliyken", "Tümü'de", "işletme geneli"]);
    assert.equal(leaks(marina), false);
    assert.equal(leaks(await closed.closedInfoRows(since, ALL_BRANCHES)), true);
  });

  test("migration 0101'in geri doldurması: listenin şubesi, tamamlayanın ya da ilk yanıtlayanın şubesi, yoksa Tuzla", async () => {
    const file = readFileSync("drizzle/0101_sube_ayrimi_kolonlar.sql", "utf8");
    const fill = file.slice(file.indexOf('UPDATE "checklist_runs"'), file.indexOf("--> statement-breakpoint", file.indexOf('UPDATE "checklist_runs"')));
    const ROLLBACK = new Error("geri al");
    let after: { t: number; d: string; b: string | null }[] = [];
    await assert.rejects(
      db.transaction(async (tx) => {
        // 0101'den önceki gibi: gün başına tek kayıt (sonraki denemenin iki şubeli günü çıkar), şube boş
        await tx.delete(s.checklistRuns).where(eq(s.checklistRuns.date, "2026-11-27"));
        await tx.execute(sql.raw('ALTER TABLE "checklist_runs" ALTER COLUMN "branch_id" DROP NOT NULL'));
        await tx.execute(sql.raw('UPDATE "checklist_runs" SET "branch_id" = NULL'));
        await tx.execute(sql.raw(fill));
        after = await tx.select({ t: s.checklistRuns.templateId, d: s.checklistRuns.date, b: s.checklistRuns.branchId }).from(s.checklistRuns);
        throw ROLLBACK;
      }),
      (e: unknown) => e === ROLLBACK,
    );
    const name = (t: number) => (t === ids.marinaList ? "marina-listesi" : "ortak");
    assert.deepEqual(
      after.map((r) => [name(r.t), r.d, r.b]).sort(),
      [
        ["marina-listesi", "2026-11-20", "marina"],
        ["marina-listesi", "2026-11-21", "marina"],
        // Listenin şubesi, yanıtı yöneticinin olsa da
        ["marina-listesi", DAY, "marina"],
        // Kimse doldurmamış: Tuzla
        ["ortak", "2026-11-02", "tuzla"],
        ["ortak", "2026-11-20", "tuzla"],
        // Tamamlayanın şubesi: Ayşe Marina'nın, işaretli kişi Tuzla'nın
        ["ortak", DAY, "marina"],
        ["ortak", DAY, "tuzla"],
      ],
    );
  });

  test("gönderim günlüğü: Son gönderimler şubenin ve işletme genelinin", async () => {
    const { recentNotifications } = await import("../src/server/notify/digest");
    await db.insert(s.notificationLog).values([
      { key: "kasa:tuzla:2026-11-26", subject: `${MARK} gün sonu`, recipients: "a@ornek.com", branchId: "tuzla" },
      { key: "kasa:marina:2026-11-26", subject: "Marina gün sonu", recipients: "a@ornek.com", branchId: "marina" },
      { key: "digest:2026-11-26", subject: "Sabah e-postası", recipients: "a@ornek.com" },
    ]);
    const marina = await recentNotifications(10, "marina");
    assert.deepEqual(marina.map((r) => r.subject).sort(), ["Marina gün sonu", "Sabah e-postası"]);
    assert.equal(leaks(marina), false);
    assert.equal((await recentNotifications(10, ALL_BRANCHES)).length, 3);
  });

  test("yatırımlar: şube seçiliyken şubenin ve işletme genelinin; eylem şubeyi doğrular; şube silinmez", async () => {
    const { loadInvestments } = await import("../src/server/data/investments");
    const { investmentTotals } = await import("../src/lib/investments");
    const { saveInvestment } = await import("../src/server/actions/costs");
    await signIn(ids.ali, "marina");
    const saved = await saveInvestment({ id: null, name: "Marina kahve makinesi", amount: 1000, date: "2026-11", note: null, branchId: "marina" });
    assert.ok(saved.ok, JSON.stringify(saved));
    assert.ok((await saveInvestment({ id: null, name: `${MARK} tabela`, amount: 77777.77, date: "2026-11", note: null, branchId: "tuzla" })).ok);
    assert.ok((await saveInvestment({ id: null, name: "Ortak yazılım", amount: 250, date: null, note: null, branchId: null })).ok);
    const bad = await saveInvestment({ id: null, name: "Yok", amount: 1, date: null, note: null, branchId: "yok" });
    assert.equal(bad.ok, false);
    // Şube verilmeyen düzenleme kayıtlı şubeyi korur
    if (saved.ok) assert.ok((await saveInvestment({ id: saved.data.id, name: "Marina kahve makinesi", amount: 1200, date: "2026-11", note: null })).ok);
    const marina = await loadInvestments("marina");
    assert.deepEqual(marina.map((i) => [i.name, i.branchId]), [
      ["Marina kahve makinesi", "marina"],
      ["Ortak yazılım", null],
    ]);
    assert.equal(leaks(marina), false);
    assert.deepEqual(investmentTotals(marina, "marina"), { total: 1200, shared: 250, sharedCount: 1 });
    const all = await loadInvestments(ALL_BRANCHES);
    assert.equal(leaks(all), true);
    assert.equal(investmentTotals(all, ALL_BRANCHES).total, 79227.77);
    // İşlem geçmişinde yatırımın şubesi
    const [log] = await db.select({ branchId: s.activityLog.branchId }).from(s.activityLog).where(sql`${s.activityLog.detail} like ${`${MARK} tabela%`}`);
    assert.equal(log?.branchId, "tuzla");
    // Kontrol listesinin kaydı ve yatırım şubeyi silmeye engel (branchUsageCount); günlükler değil
    const { branchUsageCount } = await import("../src/server/branches");
    await db.insert(s.branches).values({ id: "deneme", name: "Deneme", kind: "fiziksel", posSource: "modpos", sortOrder: 9 });
    await db.insert(s.activityLog).values({ userName: "Ali", action: "Deneme", branchId: "deneme" });
    await db.insert(s.notificationLog).values({ key: "deneme:1", branchId: "deneme" });
    assert.equal(await branchUsageCount(db, "deneme"), 0, "günlükler sayılmaz");
    await db.delete(s.branches).where(eq(s.branches.id, "deneme"));
    const [orphan] = await db.select({ branchId: s.activityLog.branchId }).from(s.activityLog).where(eq(s.activityLog.action, "Deneme"));
    assert.equal(orphan?.branchId, null, "şube silinince işlem geçmişinin şubesi boşalır");
    assert.ok((await branchUsageCount(db, "marina")) > 0);
  });
});
