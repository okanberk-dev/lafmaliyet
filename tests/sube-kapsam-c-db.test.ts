// Şube kapsamı C (P1; 24 Kasım 2026, docs/SUBE.md), gerçek Postgres'te:
// - bekleyen isteğin şubesi konudan, yükten ya da kaydından; Marina seçiliyken Tuzla'nın isteği zilde ve Onaylar'da
//   sayılmaz, "öbür şubelerde N istek" sayılır; karaoke ve mal taslağı;
// - sayım uyarıları şubenin sayımıyla (fiyatsız ek kalem, personelin geç kaydı işlem kaydının şubesiyle);
// - "Sabit giderlerden ekle" adayları şubenin ve işletme genelinin; özel günler şube başına, personelinki kilitli şubesine;
// - bildirim adresinin şubesi: bütün kasalar seçilince boş (bütün şubeler), kapalı şube reddedilir.
//
// SUBE_C_TEST_DATABASE_URL verilmezse atlanır (ör. postgres://postgres:postgres@localhost:5432/postgres). Test o sunucuda
// kendi geçici veritabanını (lm_sube_c_<pid>) açar, sonunda siler.
// Çalıştırma: SUBE_C_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/sube-kapsam-c-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { countLogDetail } from "../src/app/panel/sayim/logic";
import { ALL_BRANCHES, DEFAULT_BRANCHES } from "../src/lib/branches";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.SUBE_C_TEST_DATABASE_URL;
const DB_NAME = `lm_sube_c_${process.pid}`;
const TUZLA = "tuzla";
const MARINA = "marina";

type Who = { id: number; name: string; role: "admin" | "staff"; branchId: string | null };

describe("şube kapsamı C: veritabanında", { skip: !SERVER_URL && "SUBE_C_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  const users: Record<"ali" | "ayse" | "deniz", Who> = {
    ali: { id: 0, name: "Ali", role: "admin", branchId: null },
    ayse: { id: 0, name: "Ayşe", role: "staff", branchId: MARINA },
    deniz: { id: 0, name: "Deniz", role: "staff", branchId: null },
  };
  /** Oturumdaki kişi (eylemin requireUser'ı ve şube kilidi bunu okur) */
  let me: Who = users.ali;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "sube-kapsami-c-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
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
    await db.insert(s.branches).values({ id: "eski", name: "Eski", kind: "fiziksel", posSource: "modpos", active: false, sortOrder: 9 });
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

  test("isteğin şubesi: konudan, yükten, kaydından; Marina'da Tuzla'nın isteği sayılmaz", async () => {
    const { requestBranches, pendingOutOfScope } = await import("../src/server/staff-requests/branch");
    const { cashOutBellRow } = await import("../src/server/data/cash-out-requests");
    const { pendingClosedRows } = await import("../src/server/closed-days");
    const { pendingWasteSummary } = await import("../src/server/data/waste-requests");
    const [entry] = await db
      .insert(s.wasteEntries)
      .values({ date: "2026-11-20", branchId: MARINA, kind: "zayi", name: "Latte", qty: 1, unit: "adet", createdByName: "Ayşe" })
      .returning({ id: s.wasteEntries.id });
    const req = (kind: (typeof s.staffRequests.$inferInsert)["kind"], subject: string, payload: Record<string, unknown>, day: string | null = "2026-11-20") => ({
      kind,
      subject,
      day,
      title: kind,
      payload,
      requestedBy: users.deniz.id,
      requestedByName: "Deniz",
    });
    const rows = await db
      .insert(s.staffRequests)
      .values([
        req("kasa-duzeltme", "gun:2026-11-20", {}),
        req("kasa-silme", "gun:2026-11-21:marina", {}),
        req("kasa-gec", "gun:2026-11-19:marina", { branchId: MARINA }),
        req("kasa-cikan", "cikan-yeni:a", { branchId: TUZLA }),
        req("kasa-cikan", "cikan-yeni:b", { branchId: MARINA }),
        req("kapali-gun", "gun:2026-11-18:marina", { branchId: MARINA }),
        req("kapali-gun", "gun:2026-11-17", {}),
        req("zayi-gec", "zayi-yeni:a", { branchId: TUZLA }),
        req("zayi-gec", "zayi-yeni:b", {}),
        req("zayi-sil", `zayi:${entry.id}`, { entryId: entry.id }),
        req("zayi-sil", "zayi:999999", { entryId: 999999 }),
        req("karaoke-sil", "karaoke:1", { sessionId: 1 }, null),
      ])
      .returning({ id: s.staffRequests.id, kind: s.staffRequests.kind, subject: s.staffRequests.subject, payload: s.staffRequests.payload });
    const branchOf = await requestBranches(db, rows);
    assert.deepEqual(
      rows.map((r) => branchOf.get(r.id)),
      [TUZLA, MARINA, MARINA, TUZLA, MARINA, MARINA, TUZLA, TUZLA, TUZLA, MARINA, null, TUZLA],
      "konu, yük, kayıt; şubesiz eski konu Tuzla, kaydı gitmiş silme isteği bilinmez",
    );

    // Zil: kasadan çıkan tek satır, kapalı gün ve zayi şubenin
    assert.equal((await cashOutBellRow(new Date(), ALL_BRANCHES))?.count, 2);
    assert.equal((await cashOutBellRow(new Date(), MARINA))?.count, 1);
    assert.deepEqual((await pendingClosedRows(MARINA)).map((r) => r.day), ["2026-11-20"]);
    assert.equal((await pendingClosedRows(ALL_BRANCHES)).length, 2);
    // Zayi: Marina'da yalnız kendi kaydının silme isteği ve kaydı gitmiş (bilinmeyen) istek; Tuzla'da iki geç kayıt + bilinmeyen
    assert.equal((await pendingWasteSummary({ scope: MARINA })).count, 2);
    assert.equal((await pendingWasteSummary({ scope: TUZLA })).count, 3);
    assert.equal((await pendingWasteSummary({})).count, 4);
    assert.equal((await pendingWasteSummary({ day: "2026-11-20", scope: MARINA })).count, 2);
    // Onaylar'ın notu: Marina seçiliyken öbür şubelerde bekleyenler (karaoke Tuzla'nın)
    assert.equal(await pendingOutOfScope(db, MARINA), 6);
    assert.equal(await pendingOutOfScope(db, ALL_BRANCHES), 0);
    await db.delete(s.staffRequests);
  });

  test("sayım uyarıları: fiyatsız ek kalem ve personelin geç kaydı şubenin sayımıyla", async () => {
    const { loadUnpricedExtras, loadStaffLateEdits } = await import("../src/server/data/count-alerts");
    await db.insert(s.months).values([
      { month: "2026-10", branchId: TUZLA },
      { month: "2026-10", branchId: MARINA },
    ]);
    await db.insert(s.stockExtras).values([
      { month: "2026-10", branchId: TUZLA, name: "Peçete", unit: "ADET", qty: 3, unitPrice: 0 },
      { month: "2026-10", branchId: MARINA, name: "Bardak", unit: "ADET", qty: 2, unitPrice: 0 },
    ]);
    assert.deepEqual((await loadUnpricedExtras(["2026-10"], MARINA)).map((u) => u.names), [["Bardak"]]);
    assert.equal((await loadUnpricedExtras(["2026-10"], ALL_BRANCHES)).length, 2);
    // Ay bittikten sonra personelin kayıtları: Marina'nın, Tuzla'nın ve şubesiz eski kayıt
    const at = new Date("2026-11-03T10:00:00+03:00");
    await db.insert(s.activityLog).values([
      { at, userName: "Ayşe", userId: users.ayse.id, action: "Stok sayımı", detail: countLogDetail("2026-10", "3 kalem", "Marina") },
      { at, userName: "Deniz", userId: users.deniz.id, action: "Stok sayımı", detail: countLogDetail("2026-10", "2 kalem", "Tuzla") },
      { at, userName: "Deniz", userId: users.deniz.id, action: "Sayım ek kalemleri", detail: "Ekim 2026: 1 kalem" },
    ]);
    const marina = await loadStaffLateEdits("2026-10", MARINA);
    assert.deepEqual(
      marina.map((e) => [e.name, e.saves, e.items]).sort(),
      [
        ["Ayşe", 1, 3],
        ["Deniz", 1, 1],
      ],
      "Tuzla'nın kaydı Marina'da sayılmaz; şubesiz eski kayıt sayılır",
    );
    const all = await loadStaffLateEdits("2026-10", ALL_BRANCHES);
    assert.equal(all.reduce((a, e) => a + e.items, 0), 6);
  });

  test("Sabit giderlerden ekle: adaylar şubenin ve işletme genelinin; tutar karşılaştırması bütün kalemlerle", async () => {
    const { loadFixedForReminders } = await import("../src/server/data/fixed-reminders");
    await db.insert(s.fixedExpenses).values([
      { name: "Tuzla kira", section: "kira", amount: 50_000, branchId: TUZLA },
      { name: "Marina kira", section: "kira", amount: 40_000, branchId: MARINA },
      { name: "Muhasebe", section: "genel", amount: 5_000, branchId: null },
    ]);
    const marina = await loadFixedForReminders(db, "2026-11", MARINA);
    assert.deepEqual(marina.candidates.map((c) => c.name).sort(), ["Marina kira", "Muhasebe"]);
    assert.equal(marina.all.length, 3);
    assert.equal((await loadFixedForReminders(db, "2026-11")).candidates.length, 3);
  });

  test("özel günler: her tür şubeli; tek şubede o şubenin ve işletme genelinin; personelin günü kilitli şubesinde", async () => {
    const { loadSpecialDays } = await import("../src/server/special-days");
    const { saveSpecialDay } = await import("../src/server/actions/special-days");
    const { saveStaffSpecialCore, staffSpecialList } = await import("../src/server/staff-special");
    const now = new Date("2026-11-24T09:00:00+03:00");
    const today = "2026-11-24";
    me = users.ali;
    const tuzlaDerbi = await saveSpecialDay({ kind: "derbi", title: "Derbi", dateFrom: "2026-11-26", effect: 0.3, branchId: TUZLA });
    assert.ok(tuzlaDerbi.ok, tuzlaDerbi.ok ? "" : tuzlaDerbi.error);
    // Aynı ad başka şubede ikiz değil
    const marinaDerbi = await saveSpecialDay({ kind: "derbi", title: "Derbi", dateFrom: "2026-11-26", effect: 0.15, branchId: MARINA });
    assert.ok(marinaDerbi.ok, marinaDerbi.ok ? "" : marinaDerbi.error);
    const shared = await saveSpecialDay({ kind: "kampanya", title: "Black Friday", dateFrom: "2026-11-27", effect: 0.15, branchId: null });
    assert.ok(shared.ok);
    const closed = await saveSpecialDay({ kind: "derbi", title: "Kapanmış", dateFrom: "2026-11-28", effect: 0.15, branchId: "eski" });
    assert.ok(!closed.ok, "kapalı şube reddedilir");
    const titles = async (scope: string) => (await loadSpecialDays(today, scope)).map((d) => `${d.title}:${d.branchId ?? "-"}`).sort();
    assert.deepEqual(await titles(MARINA), ["Black Friday:-", "Derbi:marina"]);
    assert.deepEqual(await titles(ALL_BRANCHES), ["Black Friday:-", "Derbi:marina", "Derbi:tuzla"]);
    // Personel (Marina'ya kilitli): yeni gün kendi şubesine; Tuzla'nın günü listesinde yok
    const out = await saveStaffSpecialCore(db, { ...users.ayse, email: "ayse@test.local", active: true } as never, { kind: "avm", title: "AVM konseri", dateFrom: "2026-11-30", dateTo: "2026-11-30", effect: 0.15, note: null }, now, MARINA, MARINA);
    const [row] = await db.select({ branchId: s.specialDays.branchId }).from(s.specialDays).where(eq(s.specialDays.id, out.id));
    assert.equal(row.branchId, MARINA);
    const list = await staffSpecialList(db, users.ayse, now, MARINA);
    assert.deepEqual(list.map((r) => `${r.title}:${r.branchId ?? "-"}`).sort(), ["AVM konseri:marina", "Black Friday:-", "Derbi:marina"]);
  });

  test("kasayı sayan, silme engeli ve vardiya önerisi: şubenin kişileri; geçmiş bütün şubelerden", async () => {
    const { cashCounters } = await import("../src/server/data/cash-reports");
    const { ingredientHistoryCounts } = await import("../src/server/data/product-history");
    const { loadShiftWeek } = await import("../src/server/vardiya/store");
    const [tuzlaStaff] = await db
      .insert(s.users)
      .values({ email: "tuzla-personel@test.local", name: "Tuncay", passwordHash: "x", role: "staff", branchId: TUZLA })
      .returning({ id: s.users.id });
    const names = async (b?: string) => (await cashCounters(b)).map((u) => u.name).sort();
    // Marina'nın kasası: yönetici, şubesiz ve Marina'nın personeli; Tuzla'ya kilitli Tuncay yok
    assert.deepEqual(await names(MARINA), ["Ali", "Ayşe", "Deniz"]);
    assert.deepEqual(await names(TUZLA), ["Ali", "Deniz", "Tuncay"]);
    assert.deepEqual(await names(), ["Ali", "Ayşe", "Deniz", "Tuncay"], "Onaylar: herkes");
    // Hammaddenin geçmişi bütün şubelerden (Marina seçiliyken Tuzla'nın sayımı da silmeyi engeller)
    const [ing] = await db.insert(s.ingredients).values({ name: "Süt", category: "Süt", unit: "ml", packagePrice: 40, packageSize: 1000 }).returning({ id: s.ingredients.id });
    await db.insert(s.stockCounts).values({ month: "2026-10", branchId: TUZLA, ingredientId: ing.id, qty: 3, factor: 1 });
    await db.insert(s.wasteEntries).values({ date: "2026-11-20", branchId: MARINA, kind: "zayi", ingredientId: ing.id, name: "Süt", qty: 1, unit: "ml", createdByName: "Ayşe" });
    assert.deepEqual((await ingredientHistoryCounts(db)).get(ing.id), { counts: 1, purchases: 0, waste: 1 });
    // Vardiya "Kişi ekle": Marina'nın ızgarasına Tuzla'ya kilitli Tuncay önerilmez
    const week = await loadShiftWeek(db, { id: MARINA, name: "Marina" }, "2026-11-23", { roster: true });
    const offered = [...week.rows.map((r) => r.name), ...week.others.map((o) => o.name)];
    assert.ok(!offered.includes("Tuncay"), offered.join(", "));
    assert.ok(offered.includes("Ali") && offered.includes("Deniz") && offered.includes("Ayşe"), offered.join(", "));
    await db.delete(s.users).where(eq(s.users.id, tuzlaStaff.id));
  });

  test("bildirim adresinin şubesi: bütün kasalar boş yazılır, kapalı şube reddedilir; sabah e-postasının grupları", async () => {
    const { setRecipientBranches } = await import("../src/server/actions/reminders");
    const { activeDigestRecipients } = await import("../src/server/notify/recipients");
    const { digestGroups } = await import("../src/lib/notify-recipients");
    me = users.ali;
    const [a, b] = await db
      .insert(s.notificationRecipients)
      .values([{ email: "patron@test.local" }, { email: "marina-mudur@test.local" }])
      .returning({ id: s.notificationRecipients.id });
    assert.ok((await setRecipientBranches(b.id, [MARINA])).ok);
    const both = await setRecipientBranches(a.id, [TUZLA, MARINA]);
    assert.ok(both.ok);
    const bad = await setRecipientBranches(a.id, ["eski"]);
    assert.ok(!bad.ok, "kapalı şube");
    me = users.deniz;
    const staff = await setRecipientBranches(a.id, [TUZLA]).catch((e: Error) => ({ ok: false as const, error: e.message }));
    assert.ok(!staff.ok, "yalnız yönetici");
    me = users.ali;
    // Aynı anda eklendiler (eklenme sırası eşit): adrese göre
    const rows = (await activeDigestRecipients(db)).sort((x, y) => x.email.localeCompare(y.email));
    assert.deepEqual(rows, [
      { email: "marina-mudur@test.local", branchIds: [MARINA] },
      { email: "patron@test.local", branchIds: [] },
    ]);
    assert.deepEqual(digestGroups(rows, [{ id: TUZLA }, { id: MARINA }]), [
      { branchIds: [], emails: ["patron@test.local"] },
      { branchIds: [MARINA], emails: ["marina-mudur@test.local"] },
    ]);
  });

  test("sabah e-postası şube grupları: Marina'ya bağlı adrese Tuzla'nın kasadan çıkan alımı gitmez; bir grup düşerse ortak anahtar yazılmaz", async () => {
    const { runReminderDigest } = await import("../src/server/notify/digest");
    const { digestStep } = await import("../src/lib/job-health");
    const { todayTR } = await import("../src/lib/reminders");
    const today = todayTR();
    await db.delete(s.notificationRecipients);
    await db.delete(s.notificationLog);
    await db.insert(s.notificationRecipients).values([
      { email: "patron@test.local", branchIds: [] },
      { email: "marina-mudur@test.local", branchIds: [MARINA] },
    ]);
    // İşletme geneli ödeme (iki grubun e-postasında) ve Tuzla kasasından faturalı alım (yalnız bütün şubelerinkinde)
    await db.insert(s.reminders).values({ title: "Muhasebe ücreti", kind: "kira", amount: 1000, dueDate: today, anchorDate: today, repeat: "none", remindDaysBefore: 0 });
    await db.insert(s.cashOuts).values({ branchId: TUZLA, date: today, kind: "harcama", amount: 250, store: "Tuzla Toptan", docType: "e_arsiv", createdByName: "Deniz" });
    const sent: { to: string[]; subject: string; text: string }[] = [];
    let failTo: string | null = "patron@test.local";
    const realFetch = globalThis.fetch;
    process.env.RESEND_API_KEY = "re_test_sube_c";
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).startsWith("https://api.resend.com/")) throw new TypeError("testte ağ yok");
      const body = JSON.parse(String(init?.body)) as { to: string[]; subject: string; text: string };
      if (failTo && body.to.includes(failTo)) return new Response(JSON.stringify({ message: "olmadı" }), { status: 422, headers: { "Content-Type": "application/json" } });
      sent.push({ to: body.to, subject: body.subject, text: body.text });
      return new Response(JSON.stringify({ id: `em_${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
      // Bütün şubelerin grubu düşer, Marina'nınki gider: sonuç "gitti" ama hata taşır; ortak ödemenin anahtarı yazılmaz
      const first = await runReminderDigest("manual");
      assert.equal(first.status, "sent", JSON.stringify(first));
      assert.ok(first.status === "sent" && first.partialError, "düşen grup söylenir");
      assert.equal(digestStep(first).code, "error", "Günlük işler hatayı görür");
      assert.deepEqual(sent.map((m) => m.to), [["marina-mudur@test.local"]]);
      assert.match(sent[0].subject, /^Marina: /);
      assert.match(sent[0].text, /Muhasebe ücreti/);
      assert.doesNotMatch(sent[0].text, /Tuzla Toptan/, "Tuzla kasasından çıkan alım Marina'nın e-postasına girmez");
      const logged = await db.select({ key: s.notificationLog.key, ok: s.notificationLog.ok }).from(s.notificationLog);
      assert.ok(!logged.some((l) => l.ok), `ortak anahtar yazılmadı: ${JSON.stringify(logged)}`);
      // Sonraki gönderim: düşen gruba gider (gidene aynı içerik aynı tekil anahtarla; Resend ikinci kez göndermez)
      failTo = null;
      sent.length = 0;
      const second = await runReminderDigest("manual");
      assert.equal(second.status, "sent", JSON.stringify(second));
      assert.ok(second.status === "sent" && !second.partialError);
      const patron = sent.find((m) => m.to.includes("patron@test.local"));
      assert.ok(patron, "bütün şubelerin e-postası gitti");
      assert.match(patron.text, /Muhasebe ücreti/);
      assert.match(patron.text, /Tuzla Toptan/);
      // Artık hepsi gitti: anahtar yazıldı, üçüncü gönderim yok
      sent.length = 0;
      const third = await runReminderDigest("manual");
      assert.equal(third.status, "skipped", JSON.stringify(third));
      assert.equal(sent.length, 0);
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.RESEND_API_KEY;
      await db.delete(s.cashOuts);
      await db.delete(s.reminders);
      await db.delete(s.notificationRecipients);
    }
  });
});
