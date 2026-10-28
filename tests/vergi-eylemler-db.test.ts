// Vergi eylemleri gerçek Postgres'te (plan docs/planlar/vergi.md §7.2, §8.1, K2; docs/VERGI.md), oturum ve next/cache
// taklit edilerek:
// - personel hiçbir vergi eylemini çağıramaz: requireAdmin gerçekteki gibi Bugün'e yönlendirir (NEXT_REDIRECT), hiçbir
//   şey yazılmaz, işlem geçmişine düşmez;
// - yönetici: ayarlar (satır kilidiyle, kısmi), elle değer, muhasebeciyle konuşuldu işareti, muhasebeci kaydı (dönem
//   başına tek kayıt; Ödemeler'deki tek karşılığa ödenecek + damga yazılır, birden çoksa yazılmaz), düzeltme ve
//   uyarıları, demirbaş (faturanın kalanı, künye), sınıflandırma (tek işlem: bir kalem reddedilirse hiçbiri yazılmaz;
//   stopaj ve "KDV yok" sabit gideri izleyen hatırlatıcının tutarını nete çeker; ad işlem geçmişine yazılmaz), Ayarlar'ın
//   işveren SGK oranı (yalnız o anahtar);
// - loadTaxInputs yazılanları okur; loadCashPlan vergi girdisiyle beslemeyi alır, tablo yoksa vergisiz çalışır.
//
// VERGI_TEST_DATABASE_URL verilmezse atlanır. Migration'ları uygulanmış ya da boş bir veritabanının adresi (veritabanı
// oluşturabilen kullanıcı): test aynı sunucuda kendi geçici veritabanını açar, migration'ları uygular, sonunda siler;
// verilen veritabanına dokunmaz.
// Çalıştırma: VERGI_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/laffogato_vergi npx tsx --test tests/vergi-eylemler-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { shiftMonth } from "../src/lib/calc/engine";
import { FIXED_REMINDER_NOTE, todayTR } from "../src/lib/reminders";
import { nominalDue, quarterLabel, quarterOfMonth } from "../src/lib/tax/calendar";
import { parseTaxSettings, TAX_SETTINGS_KEY } from "../src/lib/tax/settings";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.VERGI_TEST_DATABASE_URL;
const DB_NAME = `laffogato_vergi_eylem_${process.pid}`;
const TODAY = todayTR();
const CUR = TODAY.slice(0, 7);
const YEAR = Number(TODAY.slice(0, 4));
/** Hesap dönemi geçen yılın başından: önceki çeyrek ve geçen yılın kurumlar vergisi dönem içinde */
const PERIOD_START = `${YEAR - 1}-01-01`;
const Q = quarterOfMonth(shiftMonth(CUR, -3));
const MPHB = shiftMonth(CUR, -1);
const nb = (x: string | null | undefined) => (x ?? "").replace(/ /g, " ");

describe("vergi eylemleri: veritabanında", { skip: !SERVER_URL && "VERGI_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let tax: typeof import("../src/server/actions/tax");
  let data: typeof import("../src/server/data/tax");
  let loadCashPlan: typeof import("../src/server/data/cash-plan").loadCashPlan;
  let loadModel: typeof import("../src/server/data/dataset").loadModel;
  let adminUser: typeof s.users.$inferSelect;
  let staffUser: typeof s.users.$inferSelect;
  let current: { id: number; name: string; email: string; role: "admin" | "staff" };

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "vergi-eylemleri-testi-icin-en-az-otuz-iki-karakter" });
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
    [adminUser] = await db.insert(s.users).values({ email: "yonetici@laffogato.net", name: "Mehmet", passwordHash: "x", role: "admin" }).returning();
    [staffUser] = await db.insert(s.users).values({ email: "ayse@laffogato.net", name: "Ayşe", passwordHash: "x", role: "staff" }).returning();
    current = { ...adminUser, role: "admin" };
    // Gerçekteki gibi: personel yönetici eyleminde Bugün'e yönlendirilir (redirect hatası, attempt yakalamaz)
    const { redirect } = await import("next/navigation");
    stub(require.resolve("../src/server/auth/dal"), {
      requireUser: async () => current,
      requireAdmin: async () => {
        if (current.role !== "admin") redirect("/panel/bugun");
        return current;
      },
    });
    tax = await import("../src/server/actions/tax");
    data = await import("../src/server/data/tax");
    loadCashPlan = (await import("../src/server/data/cash-plan")).loadCashPlan;
    loadModel = (await import("../src/server/data/dataset")).loadModel;
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    current = { ...adminUser, role: "admin" };
    await db.execute(
      sql`TRUNCATE tax_assets, tax_filings, tax_adjustments, reminders, fixed_expense_versions, fixed_expenses, expense_categories, invoices, activity_log, integration_state, settings RESTART IDENTITY CASCADE`,
    );
    await db.insert(s.integrationState).values({ key: TAX_SETTINGS_KEY, value: { periodStart: PERIOD_START } });
  });

  // ---------------------------------------------------------------- yardımcılar

  const ok = <T>(r: { ok: true; data: T } | { ok: false; error: string }): T => {
    if (!r.ok) assert.fail(r.error);
    return r.data;
  };
  const refused = (r: { ok: boolean; error?: string }, pattern: RegExp) => {
    assert.equal(r.ok, false, "reddedilmedi");
    assert.match(nb(r.error), pattern);
  };
  const settings = async () => parseTaxSettings((await db.select().from(s.integrationState).where(eq(s.integrationState.key, TAX_SETTINGS_KEY)))[0]?.value);
  const logs = async () => (await db.select().from(s.activityLog).orderBy(s.activityLog.id)).map((l) => `${l.action} · ${nb(l.detail)}`);
  const reminder = async (over: Partial<typeof s.reminders.$inferInsert>) =>
    (
      await db
        .insert(s.reminders)
        .values({ title: "Geçici vergi beyanı ve ödemesi", kind: "vergi", dueDate: nominalDue("gecici", Q), anchorDate: nominalDue("gecici", Q), repeat: "quarterly", remindDaysBefore: 7, ...over })
        .returning()
    )[0];
  const invoice = async (over: Partial<typeof s.invoices.$inferInsert> & { amount: number }) =>
    (await db.insert(s.invoices).values({ date: `${MPHB}-10`, supplier: "XND Teknoloji", category: "Kuruluş & Demirbaş", payable: over.amount * 1.2, ...over }).returning())[0];

  // ---------------------------------------------------------------- rol

  test("personel hiçbir vergi eylemini çağıramaz: Bugün'e yönlenir, hiçbir şey yazılmaz", async () => {
    const [f] = await db.insert(s.fixedExpenses).values({ name: "Kira", section: "kira", amount: 160_000, vatRate: 0.2 }).returning();
    const inv = await invoice({ amount: 50_000 });
    const [asset] = await db.insert(s.taxAssets).values({ name: "Espresso makinesi", acquiredOn: `${MPHB}-10`, cost: 20_000 }).returning();
    const [filing] = await db.insert(s.taxFilings).values({ kind: "gecici", period: Q, payable: 1_000, stamp: 791 }).returning();
    const [adj] = await db.insert(s.taxAdjustments).values({ month: MPHB, kind: "kkeg", amount: 500, label: "Gecikme zammı" }).returning();
    const before = await settings();
    current = { ...staffUser, role: "staff" };
    const calls: [string, () => Promise<unknown>][] = [
      ["saveTaxSettings", () => tax.saveTaxSettings({ firstActivity: "ilk" })],
      ["saveTaxOverride", () => tax.saveTaxOverride({ key: "damga.gecici", value: 820, note: "deneme notu" })],
      ["saveTaxCheck", () => tax.saveTaxCheck({ key: "sirket", checked: true, note: null })],
      ["saveTaxClassifications", () => tax.saveTaxClassifications({ items: [{ source: "fixed", id: f.id, doc: "belgeli" }] })],
      ["saveTaxFiling", () => tax.saveTaxFiling({ kind: "gecici", period: Q, payable: 2_000, stamp: 791, values: {}, note: null, alsoReminder: true })],
      ["deleteTaxFiling", () => tax.deleteTaxFiling(filing.id)],
      ["saveTaxAdjustment", () => tax.saveTaxAdjustment({ month: MPHB, span: "ay", kind: "gider_belgeli", amount: 100, label: "Noter", note: null })],
      ["deleteTaxAdjustment", () => tax.deleteTaxAdjustment(adj.id)],
      ["saveTaxAsset", () => tax.saveTaxAsset({ name: "Tabela", invoiceId: inv.id, acquiredOn: `${MPHB}-10`, cost: 10_000, kind: "demirbas", method: "amortisman", lifeYears: 5, note: null })],
      ["deleteTaxAsset", () => tax.deleteTaxAsset(asset.id)],
      ["setEmployerSgkRate", () => tax.setEmployerSgkRate(0.1975)],
    ];
    assert.equal(calls.length, Object.keys(tax).length, "her eylem denendi");
    for (const [name, call] of calls) {
      await assert.rejects(call(), (e: unknown) => String((e as { digest?: string }).digest ?? "").startsWith("NEXT_REDIRECT") && String((e as { digest?: string }).digest).includes("/panel/bugun"), name);
    }
    current = { ...adminUser, role: "admin" };
    assert.deepEqual(await settings(), before);
    assert.deepEqual(await logs(), []);
    assert.equal((await db.select().from(s.taxFilings))[0].payable, 1_000);
    assert.equal((await db.select().from(s.taxAdjustments)).length, 1);
    assert.equal((await db.select().from(s.taxAssets)).length, 1);
    assert.equal((await db.select().from(s.fixedExpenses))[0].taxDoc, null);
    assert.equal((await db.select().from(s.settings)).length, 0);
  });

  // ---------------------------------------------------------------- ayarlar, elle değer, işaret

  test("ayarlar: verilen alanlar değişir, öbürleri kalır; işlem geçmişinde yalnız değişenler; gelecekteki dönem başı reddedilir", async () => {
    const r = ok(await tax.saveTaxSettings({ firstActivity: "ilk", muhtasarQuarterly: true, carriedLoss: { amount: 12_000, note: "2025 beyannamesi" } }));
    assert.deepEqual(r.changed.map(nb), ["kuruluş: ilk defa faaliyete başladı", "muhtasar 3 aylık: açık", "devreden zarar 12.000 ₺"]);
    ok(await tax.saveTaxSettings({ includeSeparate: true }));
    const st = await settings();
    assert.equal(st.periodStart, PERIOD_START);
    assert.equal(st.firstActivity, "ilk");
    assert.equal(st.muhtasarQuarterly, true);
    assert.equal(st.includeSeparate, true);
    assert.deepEqual(st.carriedLoss, { amount: 12_000, note: "2025 beyannamesi", by: "Mehmet", date: TODAY });
    // Değişmeyen kayıt işlem geçmişine düşmez
    assert.deepEqual(ok(await tax.saveTaxSettings({ includeSeparate: true })).changed, []);
    refused(await tax.saveTaxSettings({ periodStart: "2999-01-01" }), /Hesap dönemi bugünden sonra başlayamaz/);
    refused(await tax.saveTaxSettings({ carriedLoss: { amount: 5, note: "x" } }), /Not en az 3 karakter/);
    ok(await tax.saveTaxSettings({ carriedLoss: null }));
    assert.equal((await settings()).carriedLoss, null);
    assert.deepEqual(await logs(), [
      "Vergi: ayarlar · kuruluş: ilk defa faaliyete başladı · muhtasar 3 aylık: açık · devreden zarar 12.000 ₺",
      "Vergi: ayarlar · kafe dışı faturalar: hesaba katılıyor",
      "Vergi: ayarlar · devreden zarar kaldırıldı",
    ]);
  });

  test("elle değer: kaynak notu zorunlu, sınır içinde; tablodaki değere dönülür; muhasebeci işareti konur ve kaldırılır", async () => {
    refused(await tax.saveTaxOverride({ key: "sgk.isverenOran", value: 0.25, note: "teşvik yok" }), /Değer en çok 0.2175/);
    refused(await tax.saveTaxOverride({ key: "kv.oran", value: 0.2, note: "deneme" }), /elle değiştirilemez/);
    refused(await tax.saveTaxOverride({ key: "damga.gecici", value: 820, note: "" }), /Kaynak \/ not yazın/);
    ok(await tax.saveTaxOverride({ key: "sgk.isverenOran", value: 0.1475, note: "6111 teşviki, muhasebeci" }));
    assert.deepEqual((await settings()).overrides["sgk.isverenOran"], { value: 0.1475, note: "6111 teşviki, muhasebeci", by: "Mehmet", date: TODAY });
    ok(await tax.saveTaxOverride({ key: "sgk.isverenOran", value: null, note: null }));
    assert.equal((await settings()).overrides["sgk.isverenOran"], undefined);
    ok(await tax.saveTaxCheck({ key: "sgk_oran", checked: true, note: "%19,75 doğru" }));
    assert.deepEqual((await settings()).checks.sgk_oran, { by: "Mehmet", date: TODAY, note: "%19,75 doğru" });
    ok(await tax.saveTaxCheck({ key: "sgk_oran", checked: false, note: null }));
    assert.equal((await settings()).checks.sgk_oran, undefined);
    // Başka anahtarlar kilitli oku-değiştir-yaz'da kaybolmaz
    assert.equal((await settings()).periodStart, PERIOD_START);
    const l = await logs();
    assert.equal(l[0], "Vergi: elle değer · sgk.isverenOran 0,1975 → 0,1475 (6111 teşviki, muhasebeci)");
    assert.equal(l[1], "Vergi: elle değer · sgk.isverenOran 0,1475 → tablodaki değer");
    assert.match(l[2], /^Vergi: muhasebeciyle konuşuldu · /);
    assert.match(l[3], / · işaret kaldırıldı$/);
  });

  // ---------------------------------------------------------------- muhasebeci kaydı

  test("muhasebeci kaydı: Ödemeler'deki tek karşılığa ödenecek + damga yazılır; ikinci kayıt aynı satırı günceller; kaldırma", async () => {
    const g = await reminder({});
    const r1 = ok(await tax.saveTaxFiling({ kind: "gecici", period: Q, payable: 41_200, stamp: 791, values: { matrah: 500_000 }, note: "tahakkuk fişi", alsoReminder: true }));
    assert.equal(r1.reminder, "yazildi");
    assert.equal(r1.message, `Muhasebecinin rakamı kaydedildi: Geçici vergi ${quarterLabel(Q)} · Ödemeler'e de yazıldı`);
    assert.equal((await db.select().from(s.reminders).where(eq(s.reminders.id, g.id)))[0].amount, 41_991);
    const r2 = ok(await tax.saveTaxFiling({ kind: "gecici", period: Q, payable: 40_000, stamp: 791, values: {}, note: null, alsoReminder: false }));
    assert.equal(r2.id, r1.id);
    assert.equal(r2.reminder, null);
    const rows = await db.select().from(s.taxFilings);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payable, 40_000);
    assert.deepEqual(rows[0].values, {});
    assert.equal(rows[0].enteredByName, "Mehmet");
    // Hatırlatıcıya yazılmadı: önceki tutar kalır
    assert.equal((await db.select().from(s.reminders).where(eq(s.reminders.id, g.id)))[0].amount, 41_991);
    // KDV beyannamesi satışlarında ödenecek ve damga 0; karşılık aranmaz
    const k = ok(await tax.saveTaxFiling({ kind: "kdv_matrah", period: MPHB, payable: 99, stamp: 791, values: { m10: 300_000, m20: 0 }, note: null, alsoReminder: true }));
    assert.equal(k.reminder, null);
    const kr = (await db.select().from(s.taxFilings).where(eq(s.taxFilings.kind, "kdv_matrah")))[0];
    assert.deepEqual([kr.payable, kr.stamp, kr.values], [0, 0, { m10: 300_000, m20: 0 }]);
    refused(await tax.saveTaxFiling({ kind: "kdv_matrah", period: MPHB, payable: 0, stamp: 0, values: { m10: 1 }, note: null, alsoReminder: false }), /%20 matrah: Tutar girin \(0 olabilir\)/);
    refused(await tax.saveTaxFiling({ kind: "gecici", period: `${YEAR + 1}-Q1`, payable: 0, stamp: 0, values: {}, note: null, alsoReminder: false }), /henüz başlamadı/);
    refused(await tax.saveTaxFiling({ kind: "mphb", period: shiftMonth(CUR, 1), payable: 0, stamp: 0, values: {}, note: null, alsoReminder: false }), /son 24 aydan/);
    refused(await tax.saveTaxFiling({ kind: "gecici", period: Q, payable: -1, stamp: 791, values: {}, note: null, alsoReminder: false }), /Tutar eksi olamaz/);
    // Kaldırma: hatırlatıcıdaki 41.991 bu kaydın (40.791) kopyası değil, kalır ve takvim onu kullanır
    const del = ok(await tax.deleteTaxFiling(r1.id));
    assert.equal(del.message, "Kaldırıldı; Ödemeler'deki tutar kullanılıyor");
    assert.equal((await db.select().from(s.taxFilings).where(eq(s.taxFilings.kind, "gecici"))).length, 0);
    assert.equal((await db.select().from(s.reminders).where(eq(s.reminders.id, g.id)))[0].amount, 41_991);
    // Kaydın yazdığı kopya kayıtla birlikte silinir (§17-5: takvim yine "Tutarı bilinmiyor" der)
    const r3 = ok(await tax.saveTaxFiling({ kind: "gecici", period: Q, payable: 41_200, stamp: 791, values: {}, note: null, alsoReminder: true }));
    assert.equal(r3.reminder, "yazildi");
    const del2 = ok(await tax.deleteTaxFiling(r3.id));
    assert.equal(del2.message, "Kaldırıldı; tahmin kullanılıyor · Ödemeler'deki tutar da silindi");
    assert.equal((await db.select().from(s.reminders).where(eq(s.reminders.id, g.id)))[0].amount, null);
    refused(await tax.deleteTaxFiling(r3.id), /Kayıt bulunamadı/);
    const l = await logs();
    assert.equal(l[0], `Vergi: muhasebeci kaydı · Geçici vergi ${quarterLabel(Q)} · ödenecek 41.200 ₺ · Ödemeler'e de yazıldı`);
    assert.equal(l.at(-3), `Vergi: muhasebeci kaydı · Geçici vergi ${quarterLabel(Q)} kaldırıldı`);
    assert.equal(l.at(-1), `Vergi: muhasebeci kaydı · Geçici vergi ${quarterLabel(Q)} kaldırıldı · Ödemeler'deki tutar da silindi`);
  });

  test("muhasebeci kaydı: birden çok karşılık varsa ya da hiç yoksa hatırlatıcıya yazılmaz; kira stopajı muhtasar karşılığı değil", async () => {
    const due = `${CUR}-26`;
    const m1 = await reminder({ title: "Muhtasar ve prim hizmet beyannamesi", dueDate: due, anchorDate: due, repeat: "monthly" });
    const stopaj = await reminder({ title: "Kira stopajı", kind: "kira", dueDate: due, anchorDate: due, repeat: "monthly", amount: 8_000 });
    const one = ok(await tax.saveTaxFiling({ kind: "mphb", period: MPHB, payable: 1_200, stamp: 939.7, values: { ucretDv: 34.68 }, note: null, alsoReminder: true }));
    assert.equal(one.reminder, "yazildi");
    assert.equal((await db.select().from(s.reminders).where(eq(s.reminders.id, m1.id)))[0].amount, 2_139.7);
    assert.equal((await db.select().from(s.reminders).where(eq(s.reminders.id, stopaj.id)))[0].amount, 8_000);
    const m2 = await reminder({ title: "Muhtasar (gelir vergisi)", dueDate: due, anchorDate: due, repeat: "monthly" });
    const two = ok(await tax.saveTaxFiling({ kind: "mphb", period: MPHB, payable: 1_500, stamp: 939.7, values: {}, note: null, alsoReminder: true }));
    assert.equal(two.reminder, "birden_cok");
    assert.match(two.message, /birden çok karşılığı var/);
    assert.equal((await db.select().from(s.reminders).where(eq(s.reminders.id, m1.id)))[0].amount, 2_139.7);
    assert.equal((await db.select().from(s.reminders).where(eq(s.reminders.id, m2.id)))[0].amount, null);
    const kv = ok(await tax.saveTaxFiling({ kind: "kv", period: String(YEAR - 1), payable: 0, stamp: 2_516.3, values: { matrah: -10_000 }, note: null, alsoReminder: true }));
    assert.equal(kv.reminder, "yok");
    assert.equal(kv.message, `Muhasebecinin rakamı kaydedildi: Kurumlar vergisi ${YEAR - 1} · Ödemeler'de karşılığı yok`);
  });

  // ---------------------------------------------------------------- düzeltme ve demirbaş

  test("düzeltme: kaydedilir, düzenlenir, kaldırılır; geçici vergi kaydı olan çeyrekte ve beyannameli ayda uyarı", async () => {
    const r = ok(await tax.saveTaxAdjustment({ month: MPHB, span: "ay", kind: "gider_belgeli", amount: 1_250.5, label: "Noter ücreti", note: null }));
    assert.deepEqual(r.warnings, []);
    ok(await tax.saveTaxAdjustment({ id: r.id, month: MPHB, span: "ay", kind: "kkeg", amount: 300, label: "Gecikme zammı", note: "SGK" }));
    const [row] = await db.select().from(s.taxAdjustments);
    assert.deepEqual([row.kind, row.amount, row.label, row.note, row.createdByName], ["kkeg", 300, "Gecikme zammı", "SGK", "Mehmet"]);
    await db.insert(s.taxFilings).values({ kind: "gecici", period: quarterOfMonth(MPHB), payable: 0, stamp: 791 });
    await db.insert(s.taxFilings).values({ kind: "kdv_matrah", period: MPHB, payable: 0, stamp: 0, values: { m10: 1, m20: 0 } });
    const w = ok(await tax.saveTaxAdjustment({ month: MPHB, span: "ay", kind: "gelir_kafe_disi", amount: 5_000, label: "Yazılım işi", note: null }));
    assert.deepEqual(w.warnings, ["Bu dönemin beyannamesi girildi; düzeltme yalnız sonraki tahmini etkiler.", "Bu ayın geliri beyannameden geliyor; kafe dışı satış zaten içinde."]);
    refused(await tax.saveTaxAdjustment({ month: MPHB, span: "ceyrek", kind: "gider_belgeli", amount: 100, label: "x", note: null }), /Çeyrek yalnız kafe dışı/);
    refused(await tax.saveTaxAdjustment({ month: MPHB, span: "ay", kind: "kkeg", amount: 0, label: "x", note: null }), /Tutar sıfırdan büyük olmalı/);
    refused(await tax.saveTaxAdjustment({ month: shiftMonth(CUR, 1), span: "ay", kind: "kkeg", amount: 10, label: "x", note: null }), /Gelecek ay/);
    refused(await tax.saveTaxAdjustment({ id: 9_999, month: MPHB, span: "ay", kind: "kkeg", amount: 10, label: "x", note: null }), /Düzeltme bulunamadı/);
    ok(await tax.deleteTaxAdjustment(r.id));
    assert.equal((await db.select().from(s.taxAdjustments)).length, 1);
    const l = await logs();
    assert.match(l[0], /^Vergi: düzeltme · Belgeli gider \(panelde yok\) · .+ · 1\.250,50 ₺$/);
    assert.match(l.at(-1)!, /^Vergi: düzeltme · İndirilemeyen gider .+ · kaldırıldı$/);
  });

  test("demirbaş: faturaya bağlanır (künye sunucuda), faturanın kalanını aşamaz; doğrudan gider sınırı; ömür 1–50; kafe dışı fatura reddedilir", async () => {
    const inv = await invoice({ amount: 50_000, discount: 0 });
    const a = ok(await tax.saveTaxAsset({ name: "Espresso makinesi", invoiceId: inv.id, acquiredOn: `${MPHB}-10`, cost: 30_000, kind: "demirbas", method: "amortisman", lifeYears: null, note: null }));
    const [row] = await db.select().from(s.taxAssets).where(eq(s.taxAssets.id, a.id));
    assert.equal(nb(row.invoiceLabel), `XND Teknoloji · 10.${MPHB.slice(5)}.${MPHB.slice(0, 4)} · 50.000,00`);
    assert.equal(row.lifeYears, null);
    assert.equal(row.createdByName, "Mehmet");
    refused(
      await tax.saveTaxAsset({ name: "Değirmen", invoiceId: inv.id, acquiredOn: `${MPHB}-10`, cost: 20_000.5, kind: "demirbas", method: "amortisman", lifeYears: 5, note: null }),
      /Maliyet faturanın kalan tutarını aşıyor \(en çok 20\.000,00 ₺\)/,
    );
    ok(await tax.saveTaxAsset({ name: "Değirmen", invoiceId: inv.id, acquiredOn: `${MPHB}-10`, cost: 20_000, kind: "demirbas", method: "amortisman", lifeYears: 5, note: null }));
    // Kendini düzenlerken kendi maliyeti kalandan düşülmez
    ok(await tax.saveTaxAsset({ id: a.id, name: "Espresso makinesi", invoiceId: inv.id, acquiredOn: `${MPHB}-10`, cost: 30_000, kind: "demirbas", method: "amortisman", lifeYears: 5, note: null }));
    refused(await tax.saveTaxAsset({ name: "Raf", invoiceId: null, acquiredOn: `${MPHB}-10`, cost: 12_500, kind: "demirbas", method: "dogrudan_gider", lifeYears: null, note: null }), /Doğrudan gider yalnız 12\.000 ₺'ye kadar/);
    refused(await tax.saveTaxAsset({ name: "Raf", invoiceId: null, acquiredOn: `${MPHB}-10`, cost: 9_000, kind: "demirbas", method: "amortisman", lifeYears: 60, note: null }), /Ömür 1–50 yıl olmalı/);
    const sep = await invoice({ amount: 5_000, category: "Alp Koç", supplier: "Pruva" });
    refused(await tax.saveTaxAsset({ name: "Kola dolabı", invoiceId: sep.id, acquiredOn: `${MPHB}-10`, cost: 1_000, kind: "diger", method: "amortisman", lifeYears: 5, note: null }), /Kafe dışı fatura/);
    // Doğrudan gider: ömür yazılmaz
    const d = ok(await tax.saveTaxAsset({ name: "Raf", invoiceId: null, acquiredOn: `${MPHB}-10`, cost: 9_000, kind: "demirbas", method: "dogrudan_gider", lifeYears: 5, note: null }));
    assert.equal((await db.select().from(s.taxAssets).where(eq(s.taxAssets.id, d.id)))[0].lifeYears, null);
    ok(await tax.deleteTaxAsset(d.id));
    assert.equal((await db.select().from(s.taxAssets)).length, 2);
  });

  // ---------------------------------------------------------------- sınıflandırma

  test("sınıflandırma: tek işlem; stopaj ve 'KDV yok' sabit gideri izleyen hatırlatıcıyı nete çeker; ad işlem geçmişine yazılmaz", async () => {
    const [kira] = await db.insert(s.fixedExpenses).values({ name: "Kira", section: "kira", amount: 160_000, vatRate: 0.2 }).returning();
    const [muhasebeci] = await db.insert(s.fixedExpenses).values({ name: "Muhasebeci", section: "personel", amount: 10_000, vatRate: 0.2 }).returning();
    const [cat] = await db.insert(s.expenseCategories).values({ name: "Market", section: "mal", panelGroup: "diger" }).returning();
    const candidate = await invoice({ amount: 30_000, category: "Diğer", supplier: "Beyza Karaman" });
    const rent = await invoice({ amount: 30_000, category: "Kira & AVM", supplier: "AVM" });
    const next = `${shiftMonth(CUR, 1)}-01`;
    const follow = await reminder({ title: "Kira", kind: "kira", amount: 192_000, dueDate: next, anchorDate: next, repeat: "monthly", note: FIXED_REMINDER_NOTE });

    // Bir kalem reddedilirse hiçbiri yazılmaz
    refused(
      await tax.saveTaxClassifications({
        items: [
          { source: "category", id: cat.id, doc: "belgeli" },
          { source: "fixed", id: muhasebeci.id, doc: "bordro", withholding: "serbest_meslek" },
        ],
      }),
      /Muhasebeci: Stopaj yalnız kira, genel giderler ve dışarıdan hizmette seçilebilir/,
    );
    assert.equal((await db.select().from(s.expenseCategories))[0].taxDoc, null);
    refused(await tax.saveTaxClassifications({ items: [{ source: "fixed", id: kira.id, doc: "bordro" }] }), /Kira: Bordro yalnız personel giderinde/);
    refused(await tax.saveTaxClassifications({ items: [{ source: "invoice", id: rent.id, notAsset: true }] }), /AVM: fatura demirbaş adayı değil/);
    refused(
      await tax.saveTaxClassifications({
        items: [
          { source: "category", id: cat.id, doc: "yok" },
          { source: "category", id: cat.id, doc: "belgeli" },
        ],
      }),
      /Aynı kalem iki kez/,
    );

    const r = ok(
      await tax.saveTaxClassifications({
        items: [
          { source: "fixed", id: kira.id, doc: "belgeli", withholding: "kira", vatToZero: true },
          { source: "fixed", id: muhasebeci.id, doc: "belgeli", withholding: "serbest_meslek" },
          { source: "category", id: cat.id, doc: "yok" },
          { source: "manual", key: "manual:su", doc: "fatura" },
          { source: "invoice", id: candidate.id, notAsset: true },
        ],
      }),
    );
    assert.equal(r.count, 5);
    const fx = await db.select().from(s.fixedExpenses).orderBy(s.fixedExpenses.id);
    assert.deepEqual(
      fx.map((f) => [f.name, f.taxDoc, f.taxWithholding, f.vatRate]),
      [
        ["Kira", "belgeli", "kira", 0],
        ["Muhasebeci", "belgeli", "serbest_meslek", 0.2],
      ],
    );
    assert.equal((await db.select().from(s.expenseCategories))[0].taxDoc, "yok");
    assert.deepEqual((await settings()).manualRows, { "manual:su": "fatura" });
    assert.equal((await db.select().from(s.invoices).where(eq(s.invoices.id, candidate.id)))[0].taxNotAsset, true);
    // Şahsa kira 160.000 brüt, KDV yok: bankadan 128.000 çıkar (stopaj muhtasarda); hatırlatıcı ona uyar
    assert.equal((await db.select().from(s.reminders).where(eq(s.reminders.id, follow.id)))[0].amount, 128_000);
    assert.match(nb(r.message), /“Kira” hatırlatıcısı da güncellendi: 192\.000 ₺ → 128\.000 ₺/);

    // Belge bordroya dönünce verilmeyen stopaj kalkar; karar geri alınır (aday yeniden listede)
    ok(
      await tax.saveTaxClassifications({
        items: [
          { source: "fixed", id: muhasebeci.id, doc: "bordro" },
          { source: "invoice", id: candidate.id, notAsset: false },
          { source: "manual", key: "manual:su", doc: null },
        ],
      }),
    );
    const m = (await db.select().from(s.fixedExpenses).where(eq(s.fixedExpenses.id, muhasebeci.id)))[0];
    assert.deepEqual([m.taxDoc, m.taxWithholding], ["bordro", null]);
    assert.equal((await db.select().from(s.invoices).where(eq(s.invoices.id, candidate.id)))[0].taxNotAsset, false);
    assert.deepEqual((await settings()).manualRows, {});
    // İşlem geçmişinde yalnız sayı
    const l = (await logs()).filter((x) => x.startsWith("Vergi: sınıflandırma"));
    assert.deepEqual(l, ["Vergi: sınıflandırma · 5 kalem", "Vergi: sınıflandırma · 3 kalem"]);
  });

  // ---------------------------------------------------------------- Ayarlar'ın işveren oranı

  test("Ayarlar'ın işveren SGK oranı: yalnız isverenSgk yazılır, öbür oranlar kalır; en çok %21,75", async () => {
    await db.insert(s.settings).values([
      { key: "isciSgk", value: 0.14 },
      { key: "isverenIssizlik", value: 0.02 },
    ]);
    ok(await tax.setEmployerSgkRate(0.1975));
    const rows = Object.fromEntries((await db.select().from(s.settings)).map((r) => [r.key, r.value]));
    assert.deepEqual(rows, { isciSgk: 0.14, isverenIssizlik: 0.02, isverenSgk: 0.1975 });
    refused(await tax.setEmployerSgkRate(0.25), /en çok %21,75/);
    ok(await tax.setEmployerSgkRate(0.2175));
    assert.deepEqual(await logs(), ["SGK oranları · isverenSgk %15,75 → %19,75 (Vergi)", "SGK oranları · isverenSgk %19,75 → %21,75 (Vergi)"]);
  });

  // ---------------------------------------------------------------- yükleyiciler

  test("loadTaxInputs yazılanları okur; nakit planı vergi girdisiyle beslemeyi alır, girdi verilmezse kendisi okur", async () => {
    ok(await tax.saveTaxSettings({ firstActivity: "devir" }));
    ok(await tax.saveTaxFiling({ kind: "mphb", period: MPHB, payable: 1_200, stamp: 939.7, values: {}, note: null, alsoReminder: false }));
    ok(await tax.saveTaxAdjustment({ month: MPHB, span: "ay", kind: "kkeg", amount: 300, label: "Gecikme zammı", note: null }));
    ok(await tax.saveTaxAsset({ name: "Tabela", invoiceId: null, acquiredOn: `${MPHB}-10`, cost: 15_000, kind: "demirbas", method: "amortisman", lifeYears: 5, note: null }));
    const inputs = await data.loadTaxInputs();
    assert.equal(inputs.settings.firstActivity, "devir");
    assert.equal(inputs.settings.periodStart, PERIOD_START);
    assert.deepEqual(
      inputs.filings.map((f) => [f.kind, f.period, f.payable, f.stamp, f.enteredByName]),
      [["mphb", MPHB, 1_200, 939.7, "Mehmet"]],
    );
    assert.deepEqual(
      inputs.adjustments.map((a) => [a.month, a.kind, a.amount]),
      [[MPHB, "kkeg", 300]],
    );
    assert.deepEqual(
      inputs.assets.map((a) => [a.name, a.cost, a.lifeYears, a.invoiceId]),
      [["Tabela", 15_000, 5, null]],
    );
    assert.equal(inputs.invoicedCashOuts.size, 0);
    assert.deepEqual(inputs.vatPaid, []);

    const model = await loadModel();
    const plan = await loadCashPlan(model, undefined, { taxInputs: inputs });
    assert.equal(plan.plan.basis.tax, true);
    assert.ok(plan.plan.estimates.some((e) => e.key === "vergi"), "vergi satırı Tahmine katılanlar'da");
    // Girdi verilmezse kendisi okur (aynı sonuç)
    const own = await loadCashPlan(model);
    assert.equal(own.plan.basis.tax, true);
    assert.deepEqual(
      own.plan.estimates.find((e) => e.key === "vergi"),
      plan.plan.estimates.find((e) => e.key === "vergi"),
    );
    // Özet: görünüm vergi girdisiyle nakit planını okur; Vergiye göre nakit planını okumaz
    const v = await data.loadTaxView(model, { taxInputs: inputs });
    assert.ok(v.cashPlan);
    assert.equal(v.view.vat, v.cashPlan.plan.vat);
    const g = await data.loadTaxView(model, { taxInputs: inputs, cashPlan: null });
    assert.equal(g.cashPlan, null);
    assert.equal(g.view.vat, null);
  });

  test("vergi tabloları okunamazsa nakit planı vergisiz çalışır (bugünkü gibi)", async () => {
    const model = await loadModel();
    await db.execute(sql`ALTER TABLE tax_filings RENAME TO tax_filings_gizli`);
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void errors.push(a);
    try {
      const plan = await loadCashPlan(model);
      assert.equal(plan.plan.basis.tax, false);
      assert.ok(!plan.plan.estimates.some((e) => e.key === "vergi"));
    } finally {
      console.error = orig;
      await db.execute(sql`ALTER TABLE tax_filings_gizli RENAME TO tax_filings`);
    }
    assert.ok(errors.some((e) => String((e as unknown[])[0]).includes("[vergi] nakit planı: vergi girdileri okunamadı")));
  });
});
