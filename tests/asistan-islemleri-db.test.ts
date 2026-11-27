// Panel asistanının işlemleri gerçek Postgres'te (docs/ASISTAN-ISLEMLER.md): plan → onay → tek kullanım (ikinci onay
// hiçbir şey yazmaz), süre dolması, başka kullanıcının planı, bayat değer, model girdisinin ve planın yeniden
// ayrıştırılması, personel reddi, vazgeç, geri al, işlem geçmişinde "asistan aracılığıyla" (via = 'asistan') ve her
// uyarlayıcının gerçek eylemle uçtan uca çalışması (Tükendi / satışa aç sitenin sahte ucuyla). Claude'a istek gitmez;
// oturum ve next/cache taklit edilir.
//
// ASISTAN_TEST_DATABASE_URL verilmezse atlanır (ör. postgres://postgres:postgres@localhost:5432/lm_asistan). Test o
// sunucuda kendi geçici veritabanını (lm_asistan_islem_<pid>) açar, migration'ları uygular, sonunda siler.
// Çalıştırma: ASISTAN_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/lm_asistan npx tsx --test tests/asistan-islemleri-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { and, eq, isNull, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import type { OpCard } from "../src/lib/assistant/ops";
import type { OpName } from "../src/lib/assistant/op-specs";
import { ALL_BRANCHES, DEFAULT_BRANCHES } from "../src/lib/branches";
import { businessDate } from "../src/lib/cash-report";
import { GOODS_CATEGORIES } from "../src/lib/constants";
import { ToolInputError } from "../src/lib/mcp/answers/common";
import { addDays, todayTR } from "../src/lib/reminders";
import type { SiteMenuItem } from "../src/lib/site-menu/schema";
import { weekStart } from "../src/lib/vardiya";
import * as s from "../src/server/db/schema";
import { dalCapabilities } from "./helpers/dal-stub";

const SERVER_URL = process.env.ASISTAN_TEST_DATABASE_URL;
const DB_NAME = `lm_asistan_islem_${process.pid}`;
const SITE = "http://site.test";

type Who = { id: number; name: string; role: "admin" | "staff" };

describe("asistanın işlemleri: veritabanında", { skip: !SERVER_URL && "ASISTAN_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let plan: typeof import("../src/server/assistant-ops/plan");
  let confirm: typeof import("../src/server/assistant-ops/confirm");
  const users: Record<"ali" | "veli" | "ayse", Who> = {
    ali: { id: 0, name: "Ali Yönetici", role: "admin" },
    veli: { id: 0, name: "Veli Yönetici", role: "admin" },
    ayse: { id: 0, name: "Ayşe", role: "staff" },
  };
  /** Oturumdaki kişi (eylemlerin requireAdmin'i bunu döner) */
  let me: Who = users.ali;
  const realFetch = globalThis.fetch;

  // ------------------------------------------------ Sitenin sahte ucu (Tükendi / satışa aç)
  const site = new Map<string, SiteMenuItem>();
  let posts = 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  async function fakeSite(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== SITE) return realFetch(input, init);
    if (url.pathname !== "/api/panel/menu") return json(404, { error: "not_found" });
    if ((init?.method ?? "GET") === "GET") return json(200, { version: 1, now: new Date().toISOString(), items: [...site.values()] });
    posts++;
    const req = JSON.parse(String(init?.body)) as { id: string; isActive?: boolean };
    const cur = site.get(req.id);
    if (!cur) return json(404, { error: "not_found" });
    if (req.isActive === undefined || req.isActive === cur.isActive) return json(200, { item: cur });
    const item = { ...cur, isActive: req.isActive, updatedAt: new Date(Date.now() + posts).toISOString() };
    site.set(req.id, item);
    return json(200, { item });
  }

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, {
      DATABASE_URL: url.href,
      AUTH_SECRET: "asistan-islemleri-testi-icin-en-az-otuz-iki-karakterlik-anahtar",
      KARAOKE_SYNC_SECRET: "asistan-islem-testi-site-anahtari-0123456789",
      LAFFOGATO_URL: SITE,
    });
    globalThis.fetch = fakeSite as typeof fetch;
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
        return { ...me, branchId: null };
      },
      requireUser: async () => ({ ...me, branchId: null }),
      ...dalCapabilities(async () => ({ ...me, branchId: null })),
      getCurrentUser: async () => ({ ...me, branchId: null }),
    });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await db.insert(s.branches).values(DEFAULT_BRANCHES.map((b) => ({ ...b }))).onConflictDoNothing();
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db
        .insert(s.users)
        .values({ email: `${k}@test.local`, name: users[k].name, passwordHash: "x", role: users[k].role, branchId: k === "ayse" ? "tuzla" : null })
        .returning({ id: s.users.id });
      users[k].id = u.id;
    }
    plan = await import("../src/server/assistant-ops/plan");
    confirm = await import("../src/server/assistant-ops/confirm");
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(() => {
    me = users.ali;
  });

  // ------------------------------------------------ yardımcılar

  const open = (name: OpName, input: unknown, opts: { who?: Who; scope?: string; now?: Date } = {}): Promise<OpCard> =>
    plan.planOp(opts.who ?? users.ali, name, input, { scope: opts.scope ?? "tuzla", now: opts.now });
  const ok = async (name: OpName, input: unknown, opts: { scope?: string } = {}) => {
    const card = await open(name, input, opts);
    const out = await confirm.confirmOp(users.ali, card.id);
    assert.equal(out.status, "done", out.message);
    return { card, out };
  };
  const opRow = async (id: string) => (await db.select().from(s.assistantOps).where(eq(s.assistantOps.id, id)))[0];
  const logs = () => db.select().from(s.activityLog).orderBy(s.activityLog.id);
  let ingredientSeq = 0;
  async function ingredient(name: string, packagePrice = 100, extra: Partial<typeof s.ingredients.$inferInsert> = {}) {
    const [r] = await db
      .insert(s.ingredients)
      .values({ name: `${name}`, category: "Süt", packageDesc: "1 L", packagePrice, packageSize: 1000, unit: "ml", sortOrder: ++ingredientSeq, ...extra })
      .returning();
    return r;
  }
  async function product(name: string, size: "M" | "L" | "Tek", price: number, extra: Partial<typeof s.products.$inferInsert> = {}) {
    const [c] = await db.insert(s.categories).values({ name: "Kahveler" }).onConflictDoNothing().returning();
    const cat = c ?? (await db.select().from(s.categories).where(eq(s.categories.name, "Kahveler")))[0];
    const [p] = await db.insert(s.products).values({ categoryId: cat.id, name, size, price, ...extra }).returning();
    return p;
  }
  async function expenseCategory(name = "Temizlik") {
    const [c] = await db.insert(s.expenseCategories).values({ name, section: "genel" }).onConflictDoNothing().returning();
    return c ?? (await db.select().from(s.expenseCategories).where(eq(s.expenseCategories.name, name)))[0];
  }

  // ------------------------------------------------ Onayın kuralları

  test("plan kartı yazmaz; onay bir kez yazar (ikinci onay hiçbir şey yazmaz); işlem geçmişi 'asistan aracılığıyla'; geri al bir kez", async () => {
    const ing = await ingredient("Süt Tam Yağlı", 40);
    const card = await open("hammadde_fiyati_degistir", { hammadde: "süt tam yağlı", paketFiyati: 48, not: "Faturadaki yeni fiyat" });
    assert.equal(card.subject, "Süt Tam Yağlı");
    assert.deepEqual(card.lines[0], { label: "Paket fiyatı", from: "40,00 ₺", to: "48,00 ₺" });
    assert.equal(card.note, "Faturadaki yeni fiyat");
    assert.equal(card.undoable, true);
    assert.ok(Date.parse(card.expiresAt) - Date.now() > 9 * 60_000);
    // Kart açıldı: hiçbir şey değişmedi, işlem geçmişi boş
    assert.equal((await db.select().from(s.ingredients).where(eq(s.ingredients.id, ing.id)))[0].packagePrice, 40);
    assert.equal((await logs()).length, 0);
    assert.equal((await opRow(card.id)).status, "pending");

    const first = await confirm.confirmOp(users.ali, card.id);
    assert.equal(first.status, "done", first.message);
    assert.ok(first.undoUntil);
    assert.equal((await db.select().from(s.ingredients).where(eq(s.ingredients.id, ing.id)))[0].packagePrice, 48);
    const afterFirst = await logs();
    assert.equal(afterFirst.length, 1);
    assert.equal(afterFirst[0].via, "asistan");
    assert.equal(afterFirst[0].userId, users.ali.id);
    assert.match(afterFirst[0].action, /Hammadde fiyatı/);
    const history = await db.select().from(s.ingredientPrices).where(eq(s.ingredientPrices.ingredientId, ing.id));

    // İkinci dokunuş: hiçbir şey yazılmaz
    const second = await confirm.confirmOp(users.ali, card.id);
    assert.equal(second.status, "refused");
    assert.match(second.message, /zaten yapıldı/);
    assert.equal((await logs()).length, 1);
    assert.equal((await db.select().from(s.ingredientPrices).where(eq(s.ingredientPrices.ingredientId, ing.id))).length, history.length);
    // Aynı anda iki onay: biri yazar
    const ing2 = await ingredient("Krema", 70);
    const c2 = await open("hammadde_fiyati_degistir", { hammadde: "Krema", paketFiyati: 75 });
    const both = await Promise.all([confirm.confirmOp(users.ali, c2.id), confirm.confirmOp(users.ali, c2.id)]);
    assert.deepEqual(both.map((b) => b.status).sort(), ["done", "refused"]);
    assert.equal((await db.select().from(s.ingredientPrices).where(eq(s.ingredientPrices.ingredientId, ing2.id))).length, 1);

    // Geri al: eski fiyat, bir kez
    const undo = await confirm.undoOp(users.ali, card.id);
    assert.equal(undo.status, "undone", undo.message);
    assert.equal((await db.select().from(s.ingredients).where(eq(s.ingredients.id, ing.id)))[0].packagePrice, 40);
    assert.equal((await confirm.undoOp(users.ali, card.id)).status, "refused");
    assert.equal((await opRow(card.id)).status, "undone");
    // Bütün kayıtlar asistan aracılığıyla ve onaylayan yöneticinin adına
    for (const l of await logs()) {
      assert.equal(l.via, "asistan", l.action);
      assert.equal(l.userName, users.ali.name);
    }
  });

  test("süresi dolan kart hiçbir şey yazmaz; başka kullanıcının kartı onaylanamaz; personel reddedilir; vazgeç", async () => {
    const ing = await ingredient("Kakao", 300);
    const old = await open("hammadde_fiyati_degistir", { hammadde: "Kakao", paketFiyati: 320 }, { now: new Date(Date.now() - 11 * 60_000) });
    const expired = await confirm.confirmOp(users.ali, old.id);
    assert.equal(expired.status, "expired");
    assert.equal((await opRow(old.id)).status, "expired");
    assert.equal((await db.select().from(s.ingredients).where(eq(s.ingredients.id, ing.id)))[0].packagePrice, 300);

    const card = await open("hammadde_fiyati_degistir", { hammadde: "Kakao", paketFiyati: 330 });
    // Başka yönetici: kart yokmuş gibi, plan beklemede kalır
    me = users.veli;
    const other = await confirm.confirmOp(users.veli, card.id);
    assert.equal(other.status, "refused");
    assert.match(other.message, /bulunamadı/);
    assert.equal((await opRow(card.id)).status, "pending");
    // Personel: ne kart açar ne onaylar
    me = users.ayse;
    const staff = await confirm.confirmOp(users.ayse, card.id);
    assert.equal(staff.status, "refused");
    assert.match(staff.message, /yalnız yönetici/);
    await assert.rejects(open("hammadde_fiyati_degistir", { hammadde: "Kakao", paketFiyati: 1 }, { who: users.ayse }), ToolInputError);
    assert.equal((await opRow(card.id)).status, "pending");
    assert.equal((await confirm.cancelOp(users.veli, card.id)).status, "refused");
    // Sahibi vazgeçer: kapanır, onaylanamaz
    me = users.ali;
    assert.equal((await confirm.cancelOp(users.ali, card.id)).status, "cancelled");
    assert.equal((await confirm.confirmOp(users.ali, card.id)).status, "refused");
    assert.equal((await db.select().from(s.ingredients).where(eq(s.ingredients.id, ing.id)))[0].packagePrice, 300);
    // Bozuk kimlik sorguya gitmez
    assert.equal((await confirm.confirmOp(users.ali, "'; drop table users; --")).status, "refused");
  });

  test("bayat değer: önizlemeden sonra değişen değerle hiçbir şey yazılmaz", async () => {
    const ing = await ingredient("Şeker", 50);
    const card = await open("hammadde_fiyati_degistir", { hammadde: "Şeker", paketFiyati: 55 });
    await db.update(s.ingredients).set({ packagePrice: 52 }).where(eq(s.ingredients.id, ing.id));
    const out = await confirm.confirmOp(users.ali, card.id);
    assert.equal(out.status, "failed");
    assert.match(out.message, /Değer değişti, yeniden bakın/);
    assert.equal((await db.select().from(s.ingredients).where(eq(s.ingredients.id, ing.id)))[0].packagePrice, 52);
    assert.equal((await opRow(card.id)).status, "failed");
  });

  test("model girdisi ve plan onayda zod ile yeniden ayrıştırılır: veritabanında bozulan plan eyleme gitmez", async () => {
    const ing = await ingredient("Vanilya Şurubu", 200);
    const a = await open("hammadde_fiyati_degistir", { hammadde: "Vanilya Şurubu", paketFiyati: 210 });
    await db.update(s.assistantOps).set({ input: { hammadde: "Vanilya Şurubu", paketFiyati: -5, silinsin: true } }).where(eq(s.assistantOps.id, a.id));
    const outA = await confirm.confirmOp(users.ali, a.id);
    assert.equal(outA.status, "failed");
    assert.match(outA.message, /verisi geçersiz/);
    const b = await open("hammadde_fiyati_degistir", { hammadde: "Vanilya Şurubu", paketFiyati: 210 });
    const row = await opRow(b.id);
    const preview = row.preview as { args: Record<string, unknown> };
    await db
      .update(s.assistantOps)
      .set({ preview: { ...preview, args: { ...preview.args, ingredientId: "1 or 1=1" } } })
      .where(eq(s.assistantOps.id, b.id));
    assert.equal((await confirm.confirmOp(users.ali, b.id)).status, "failed");
    // Modelin uydurduğu alan ham hâliyle de kart açmaz
    await assert.rejects(open("hammadde_fiyati_degistir", { hammadde: "Vanilya Şurubu", paketFiyati: 210, ingredientId: 1 }), /Girdi geçersiz/);
    assert.equal((await db.select().from(s.ingredients).where(eq(s.ingredients.id, ing.id)))[0].packagePrice, 200);
  });

  // ------------------------------------------------ Uyarlayıcılar

  test("Tükendi / satışa aç: sitenin sahte ucuyla; kart M ve L'yi gösterir; geri al", async () => {
    site.set("ice-latte", { id: "ice-latte", name: "Ice Latte", categoryKey: "soguk", categoryLabel: "Soğuk", priceMinor: 18_000, priceMinorL: 21_000, isActive: true, sortOrder: 0, updatedAt: new Date(Date.now() - 3_600_000).toISOString() });
    await product("Ice Latte", "M", 180, { siteMenuId: "ice-latte", siteMenuSlot: "M" });
    await product("Ice Latte", "L", 210, { siteMenuId: "ice-latte", siteMenuSlot: "L" });
    await product("Filtre Kahve", "M", 120);
    const value = { now: new Date().toISOString(), at: new Date().toISOString(), items: [...site.values()] };
    await db.insert(s.integrationState).values({ key: "menu_site_items", value }).onConflictDoUpdate({ target: s.integrationState.key, set: { value } });
    // Siteye bağlı olmayan ürün: kart açılmaz, yol gösterilir
    await assert.rejects(open("urun_tukendi_yap", { urun: "Filtre Kahve" }), /Site menüsü/);
    await assert.rejects(open("urun_satisa_ac", { urun: "Ice Latte" }), /zaten satışta/);
    const { card } = await ok("urun_tukendi_yap", { urun: "ice latte" });
    assert.deepEqual(card.effects, ["site", "asilpos"]);
    assert.ok(card.lines.some((l) => l.label === "Boylar" && l.to === "M, L"));
    assert.equal(site.get("ice-latte")!.isActive, false);
    const undo = await confirm.undoOp(users.ali, card.id);
    assert.equal(undo.status, "undone", undo.message);
    assert.equal(site.get("ice-latte")!.isActive, true);
    const [l] = (await logs()).filter((x) => /Tükendi|satışa/i.test(x.action));
    assert.ok(l, "işlem geçmişinde Tükendi satırı");
    assert.equal(l.via, "asistan");
  });

  test("Paraşüt ürünü → hammadde: yeni bağlantı (geri alma rehber), var olanı değiştirme ve geri al", async () => {
    const ing = await ingredient("Süt Laktozsuz", 45);
    const [inv] = await db.insert(s.invoices).values({ date: "2026-11-10", supplier: "Sütaş", category: GOODS_CATEGORIES[0], amount: 450, payable: 450, unpaid: false }).returning();
    await db.insert(s.parasutBillLines).values({ invoiceId: inv.id, externalId: "bl-1", productKey: "sutas|laktozsuz sut 1 lt", productName: "LAKTOZSUZ SÜT 1 LT", quantity: 10, unit: "Adet", unitPrice: 45, netTotal: 450 });
    const { card } = await ok("parasut_urun_bagla", { urun: "Laktozsuz Süt 1 LT", hammadde: "Süt Laktozsuz", carpan: 1000, fiyatGuncellensin: false });
    assert.equal(card.undoable, false);
    assert.match(card.undo, /silmedir/);
    const [link] = await db.select().from(s.parasutProductLinks).where(eq(s.parasutProductLinks.productKey, "sutas|laktozsuz sut 1 lt"));
    assert.equal(link.ingredientId, ing.id);
    assert.equal(link.factor, 1000);
    await assert.rejects(open("parasut_urun_bagla", { urun: "LAKTOZSUZ SÜT 1 LT", hammadde: "Süt Laktozsuz", carpan: 1000, fiyatGuncellensin: false }), /değişiklik yok/);
    const change = await ok("parasut_urun_bagla", { urun: "LAKTOZSUZ SÜT 1 LT", hammadde: "Süt Laktozsuz", carpan: 500, fiyatGuncellensin: false });
    assert.equal(change.card.undoable, true);
    assert.equal((await db.select().from(s.parasutProductLinks))[0].factor, 500);
    assert.equal((await confirm.undoOp(users.ali, change.card.id)).status, "undone");
    assert.equal((await db.select().from(s.parasutProductLinks))[0].factor, 1000);
  });

  test("hatırlatıcı ekle (şube açık), geri al kapatır (silmez) ve kendi işlem geçmişi satırını yazar", async () => {
    const due = addDays(todayTR(), 10);
    const { card } = await ok("hatirlatici_ekle", { baslik: "Kira Tuzla", tur: "kira", tutar: 25000, ilkTarih: due, tekrar: "monthly", sube: "Tuzla" });
    assert.equal(card.branch, "Tuzla");
    const [r] = await db.select().from(s.reminders).where(eq(s.reminders.title, "Kira Tuzla"));
    assert.equal(r.branchId, "tuzla");
    assert.equal(r.amount, 25000);
    assert.equal(r.active, true);
    assert.equal((await confirm.undoOp(users.ali, card.id)).status, "undone");
    const [after_] = await db.select().from(s.reminders).where(eq(s.reminders.id, r.id));
    assert.equal(after_.active, false);
    const own = (await logs()).find((l) => l.action === "Asistan: hatırlatıcı kapatıldı");
    assert.ok(own, "geri almanın işlem geçmişi satırı");
    assert.equal(own.via, "asistan");
    // İşletme geneli
    const g = await ok("hatirlatici_ekle", { baslik: "Muhasebe", tur: "odeme", ilkTarih: due, tekrar: "none", sube: "işletme geneli" });
    assert.equal(g.card.branch, "İşletme geneli");
    assert.equal((await db.select().from(s.reminders).where(eq(s.reminders.title, "Muhasebe")))[0].branchId, null);
  });

  test("hatırlatıcı ödendi: tek dönem ilerler; geri al eski hâline döndürür; tek seferlik kapanır", async () => {
    const due = addDays(todayTR(), 3);
    await db.insert(s.reminders).values([
      { title: "Elektrik Faturası", kind: "fatura", amount: 1800, dueDate: due, anchorDate: due, repeat: "monthly" },
      { title: "Tabela Taksiti", kind: "odeme", amount: 5000, dueDate: due, anchorDate: due, repeat: "none" },
    ]);
    const { card } = await ok("hatirlatici_odendi", { hatirlatici: "elektrik faturası" });
    assert.ok(card.lines.some((l) => l.label === "Kapanan dönem"));
    const [r] = await db.select().from(s.reminders).where(eq(s.reminders.title, "Elektrik Faturası"));
    assert.ok(r.dueDate > due, "sıradaki döneme geçti");
    assert.ok(r.lastDoneAt);
    const undo = await confirm.undoOp(users.ali, card.id);
    assert.equal(undo.status, "undone", undo.message);
    const [back] = await db.select().from(s.reminders).where(eq(s.reminders.title, "Elektrik Faturası"));
    assert.equal(back.dueDate, due);
    assert.equal(back.lastDoneAt, null);
    await ok("hatirlatici_odendi", { hatirlatici: "Tabela Taksiti" });
    assert.equal((await db.select().from(s.reminders).where(eq(s.reminders.title, "Tabela Taksiti")))[0].active, false);
    // Kapalı hatırlatıcı aday değildir
    await assert.rejects(open("hatirlatici_odendi", { hatirlatici: "Tabela Taksiti" }), /bulunamadı/);
  });

  test("fatura ödendi: birden çok aday sorulur; tek fatura ödendi, geri al eski durumu yazar", async () => {
    const mk = (no: string, payable: number) =>
      db.insert(s.invoices).values({ date: "2026-11-05", supplier: "Kahveci Ltd", invoiceNo: no, category: GOODS_CATEGORIES[0], amount: payable, payable, unpaid: true }).returning();
    const [a] = await mk("KAH2026001", 1200);
    await mk("KAH2026002", 800);
    await assert.rejects(open("fatura_odendi", { tedarikci: "kahveci ltd", durum: "odendi" }), /2 ödenmemiş faturası var/);
    const { card } = await ok("fatura_odendi", { tedarikci: "Kahveci Ltd", faturaNo: "KAH2026001", durum: "odendi", odemeSekli: "havale" });
    assert.ok(card.lines.some((l) => l.label === "Durum" && l.from === "Ödenmedi" && l.to === "Ödendi"));
    const [paid] = await db.select().from(s.invoices).where(eq(s.invoices.id, a.id));
    assert.equal(paid.unpaid, false);
    assert.equal(paid.paidAt, businessDate()); // asistanın "bugün"ü iş günü (05:00 kuralı): gece yarısından sonra takvim günü değil
    assert.equal(paid.paidVia, "havale");
    assert.equal((await confirm.undoOp(users.ali, card.id)).status, "undone");
    assert.equal((await db.select().from(s.invoices).where(eq(s.invoices.id, a.id)))[0].unpaid, true);
    // İleri tarih reddedilir
    await assert.rejects(open("fatura_odendi", { tedarikci: "Kahveci Ltd", faturaNo: "KAH2026002", durum: "odendi", odemeGunu: addDays(todayTR(), 3) }), /ileri/);
  });

  test("fatura ödendi: hesaptaki para faturayı kapatınca kart ödemenin gününü ve şeklini gösterir; geri al çalışır", async () => {
    const { saveSupplierPayment } = await import("../src/server/actions/cari");
    const [sutcu] = await db.insert(s.suppliers).values({ name: "Sütçü", key: "sutcu" }).returning();
    const payDay = addDays(todayTR(), -5);
    const pay = await saveSupplierPayment({ target: { cardId: sutcu.id }, id: null, date: payDay, amount: 1000, method: "elden", cashOut: null, allocation: { mode: "none", lines: [] }, note: null, photoId: null });
    assert.equal(pay.ok, true, JSON.stringify(pay));
    // Hazırlığın ödemesi ekrandan girilmiş gibi: işlem geçmişi testi yalnız asistanın satırlarına bakar
    await db.delete(s.activityLog).where(and(eq(s.activityLog.action, "Cari ödeme eklendi"), isNull(s.activityLog.via)));
    const [inv] = await db.insert(s.invoices).values({ date: addDays(todayTR(), -2), supplier: "Sütçü", invoiceNo: "SUT1", category: GOODS_CATEGORIES[0], amount: 400, payable: 400, unpaid: true }).returning();
    const card = await open("fatura_odendi", { tedarikci: "Sütçü", durum: "odendi", odemeSekli: "havale" });
    // Kart: hesaptan sayılan tutar, gün ve şekil ödemenin kendisinden; kartın bugünü ve havale gösterilmez
    assert.ok(card.lines.some((l) => l.label === "Hesaptan sayılacak" && /^400,00\s₺ \(faturanın tamamı\)$/.test(l.to)), JSON.stringify(card.lines));
    assert.ok(card.lines.some((l) => l.label === "Ödeme günü ve şekli" && l.to.includes("Nakit")), JSON.stringify(card.lines));
    assert.equal(card.lines.some((l) => l.label === "Ödeme günü" || l.label === "Ödeme şekli"), false);
    const out = await confirm.confirmOp(users.ali, card.id);
    assert.equal(out.status, "done", out.message);
    assert.match(out.message, /hesaptaki ödemeyle kapandı/);
    assert.ok(out.undoUntil);
    const [paid] = await db.select().from(s.invoices).where(eq(s.invoices.id, inv.id));
    assert.equal(paid.unpaid, false);
    assert.equal(paid.paidAt, payDay);
    assert.equal(paid.paidByLedger, true);
    // Geri al: dağıtım silinir, para hesaba döner, fatura yeniden ödenmemiş
    const undo = await confirm.undoOp(users.ali, card.id);
    assert.equal(undo.status, "undone", undo.message);
    const [back] = await db.select().from(s.invoices).where(eq(s.invoices.id, inv.id));
    assert.equal(back.unpaid, true);
    assert.equal(back.allocated, 0);
    // Kısmen: hesapta 1000 ₺ var, 1500 ₺'lik faturada 1000 ₺ sayılır, kalanı kartın günü ve şekliyle
    await db.insert(s.invoices).values({ date: addDays(todayTR(), -1), supplier: "Sütçü", invoiceNo: "SUT2", category: GOODS_CATEGORIES[0], amount: 1500, payable: 1500, unpaid: true });
    const part = await open("fatura_odendi", { tedarikci: "Sütçü", faturaNo: "SUT2", durum: "odendi", odemeSekli: "havale" });
    assert.ok(part.lines.some((l) => l.label === "Hesaptan sayılacak" && /^1\.000,00\s₺ \(kalan 500,00\s₺/.test(l.to)), JSON.stringify(part.lines));
    assert.ok(part.lines.some((l) => l.label === "Ödeme şekli" && l.to === "Havale / EFT"));
    await confirm.cancelOp(users.ali, part.id);
    // "Ayrıca ödendi": hesaptaki para sayılmaz, kartın günü ve şekli yazılır
    const sep = await open("fatura_odendi", { tedarikci: "Sütçü", faturaNo: "SUT1", durum: "odendi", odemeSekli: "kart", ayricaOdendi: true });
    assert.equal(sep.lines.some((l) => l.label === "Hesaptan sayılacak"), false);
    await confirm.cancelOp(users.ali, sep.id);
  });

  test("tedarikçiye ödeme: kartı olan tedarikçiye, otomatik dağıtımla; kartı olmayana rehber", async () => {
    const [card0] = await db.insert(s.suppliers).values({ name: "Ambalajcı", key: "ambalajci" }).returning();
    await db.insert(s.invoices).values({ date: "2026-11-01", supplier: "Ambalajcı", invoiceNo: "AMB1", category: GOODS_CATEGORIES[2], amount: 500, payable: 500, unpaid: true });
    await assert.rejects(open("tedarikci_odemesi_ekle", { tedarikci: "Kartsız Firma", tutar: 100, tarih: todayTR(), odemeSekli: "havale", dagitim: "otomatik" }), /tedarikçi kartı yok/);
    const { card, out } = await ok("tedarikci_odemesi_ekle", { tedarikci: "ambalajcı", tutar: 300, tarih: todayTR(), odemeSekli: "havale", dagitim: "otomatik", aciklama: "Dekont 42" });
    assert.equal(card.undoable, false);
    assert.match(out.message, /Ödeme kaydedildi/);
    const entries = await db.select().from(s.supplierEntries).where(and(eq(s.supplierEntries.supplierId, card0.id), eq(s.supplierEntries.kind, "odeme")));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].amount, 300);
    // Aynı gün aynı tutar: kartta uyarı
    const again = await open("tedarikci_odemesi_ekle", { tedarikci: "Ambalajcı", tutar: 300, tarih: todayTR(), odemeSekli: "havale", dagitim: "hesapta_beklesin" });
    assert.match(again.warnings.join(" "), /aynı tutarda/);
  });

  test("ürün fiyatı: siteye bağlı değil → ModPOS rozeti; boy sorulur; geri al eski fiyatı yazar", async () => {
    const m = await product("Mocha", "M", 110);
    await product("Mocha", "L", 130);
    await assert.rejects(open("urun_fiyati_degistir", { urun: "Mocha", yeniFiyat: 120 }), /hangi boy/);
    const { card } = await ok("urun_fiyati_degistir", { urun: "mocha", boy: "M", yeniFiyat: 120 });
    assert.deepEqual(card.effects, ["modpos"]);
    assert.equal((await db.select().from(s.products).where(eq(s.products.id, m.id)))[0].price, 120);
    const undo = await confirm.undoOp(users.ali, card.id);
    assert.equal(undo.status, "undone", undo.message);
    assert.equal((await db.select().from(s.products).where(eq(s.products.id, m.id)))[0].price, 110);
  });

  test("ürün fiyatı: kart şube fiyatını bilir; açık ekranın şubesi kendi fiyatlıysa en başta uyarır, planlı satırı söyler", async () => {
    const item: SiteMenuItem = { id: "sube-latte", name: "Şube Latte", categoryKey: "sicak", categoryLabel: "Sıcak", priceMinor: 19_000, priceMinorL: 22_000, isActive: true, sortOrder: 0, updatedAt: new Date(Date.now() - 3_600_000).toISOString() };
    await product("Şube Latte", "M", 190, { siteMenuId: item.id, siteMenuSlot: "M" });
    await product("Şube Latte", "L", 220, { siteMenuId: item.id, siteMenuSlot: "L" });
    const items = { now: new Date().toISOString(), at: new Date().toISOString(), items: [item] };
    await db.insert(s.integrationState).values({ key: "menu_site_items", value: items }).onConflictDoUpdate({ target: s.integrationState.key, set: { value: items } });
    // Marina'nın kendi fiyatı: M 205 ₺ (dünden beri), L tabanı izler; yarın 05:00'ten M 210 ₺ planlı
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const rows = [
      { id: item.id, branch: "marina", priceMinor: 20_500, priceMinorL: 0, effectiveFrom: past, createdAt: past },
      { id: item.id, branch: "marina", priceMinor: 21_000, priceMinorL: 0, effectiveFrom: future, createdAt: past },
    ];
    const prices = { now: new Date().toISOString(), at: new Date().toISOString(), rows };
    await db.insert(s.integrationState).values({ key: "menu_site_branch_prices", value: prices }).onConflictDoUpdate({ target: s.integrationState.key, set: { value: prices } });
    try {
      // Açık ekran Marina: kart tabanı değiştirir, Marina'nın fiyatı değişmez (en başta söylenir)
      const m = await open("urun_fiyati_degistir", { urun: "Şube Latte", boy: "M", yeniFiyat: 195 }, { scope: "marina" });
      assert.match(m.warnings[0], /Açık ekranda Marina seçili ve Marina'nın kendi fiyatı var \(205,00\s₺\): bu kart Marina'da fiyatı değiştirmez/);
      assert.match(m.branch ?? "", /Taban fiyat \(Marina hariç/);
      assert.ok(m.lines.some((l) => l.label === "Marina'da" && /^205,00\s₺$/.test(l.from ?? "") && /değişmez/.test(l.to)), JSON.stringify(m.lines));
      assert.match(m.warnings.join(" "), /Marina'da .*210,00\s₺ planlı \(şube fiyatı\)/);
      // Açık ekran Tuzla: uyarı sonda, yine söylenir
      const t = await open("urun_fiyati_degistir", { urun: "Şube Latte", boy: "M", yeniFiyat: 195 }, { scope: "tuzla" });
      assert.doesNotMatch(t.warnings[0], /Açık ekranda/);
      assert.match(t.warnings.join(" "), /Marina kendi fiyatıyla kalır/);
      // L tabanı izliyor: Marina'da da değişir, şube satırı yok
      const l = await open("urun_fiyati_degistir", { urun: "Şube Latte", boy: "L", yeniFiyat: 230 }, { scope: "marina" });
      assert.equal(l.branch, "Bütün şubeler (menü ortak)");
      assert.ok(!l.lines.some((x) => x.label === "Marina'da"));
      assert.doesNotMatch(l.warnings.join(" "), /Açık ekranda/);
    } finally {
      await db.delete(s.integrationState).where(eq(s.integrationState.key, "menu_site_branch_prices"));
    }
  });

  test("kasadan çıkan: 'Tümü'de şube sorulur; bugünün kasasına yazılır; raporu girilmiş güne rehber", async () => {
    const cat = await expenseCategory("Market");
    await assert.rejects(open("kasadan_cikan_ekle", { tur: "harcama", tutar: 85, belge: "fis", harcamalaraYaz: false }, { scope: ALL_BRANCHES }), /hangi şube/);
    const { card } = await ok("kasadan_cikan_ekle", { sube: "Tuzla", tur: "harcama", tutar: 85.5, yer: "Migros", aciklama: "süt", belge: "fis", kategori: "Market", harcamalaraYaz: true }, { scope: ALL_BRANCHES });
    assert.equal(card.branch, "Tuzla");
    const rows = await db.select().from(s.cashOuts);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].branchId, "tuzla");
    assert.equal(rows[0].date, businessDate());
    assert.equal(rows[0].amount, 85.5);
    assert.equal((await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.categoryId, cat.id))).length, 1);
    // Marina'nın raporu girilmiş: kart açılmaz, ekran gösterilir
    await db.insert(s.cashReports).values({ date: businessDate(), branchId: "marina", zTotal: 1000, cash: 500, card: 500, submittedByName: "Ayşe" });
    await assert.rejects(open("kasadan_cikan_ekle", { sube: "Marina", tur: "teslim", tutar: 100, belge: "yok", harcamalaraYaz: false }), /raporu girilmiş/);
  });

  test("harcama: işletme geneli ve şube; tarih ileri olamaz", async () => {
    await expenseCategory("Kırtasiye");
    const a = await ok("harcama_ekle", { kategori: "kırtasiye", tutar: 240, tarih: todayTR(), odemeSekli: "kart", sube: "işletme geneli" });
    assert.equal(a.card.branch, "İşletme geneli");
    const b = await ok("harcama_ekle", { kategori: "Kırtasiye", tutar: 60, tarih: todayTR(), sube: "Marina" });
    assert.equal(b.card.branch, "Marina");
    const rows = await db.select().from(s.expenseEntries).orderBy(s.expenseEntries.id);
    const mine = rows.filter((r) => r.amount === 240 || r.amount === 60);
    assert.deepEqual(
      mine.map((r) => [r.amount, r.branchId]),
      [
        [240, null],
        [60, "marina"],
      ],
    );
    await assert.rejects(open("harcama_ekle", { kategori: "Kırtasiye", tutar: 10, tarih: addDays(todayTR(), 2) }), /ileri/);
  });

  test("fiş fotoğrafı: okunan fişten kasadan çıkan ve harcama; fotoğraf onayda bağlanır, başkasınınki ve bağlı olan eklenemez", async () => {
    const photos = await import("../src/server/storage/photos");
    const drivers = await import("../src/server/storage/drivers");
    const receipt = await import("../src/server/assistant-ops/receipt");
    const { slipPng } = await import("./helpers/fis-gorsel");
    photos.__setPhotoDriverForTests(drivers.memoryDriver());
    try {
      const market = await expenseCategory("Market");
      const day = businessDate();
      const amount = (value: number | null, text: string | null = value === null ? null : String(value)) => ({ text, value, confidence: "high" as const });
      /** Kasanın fiş okumasının kaydı (sohbetteki /api/foto yüklemesinin yazdığı gibi): fotoğraf ve başarılı okuma */
      const upload = async (who: Who, total: number, o: { paymentMethod?: "cash" | "card"; documentType?: "purchase_receipt" | "invoice" } = {}) => {
        const { id } = await photos.savePhoto({ kind: "fis", bytes: slipPng(["MIGROS", "SUT", "BUZ", `TOPLAM ${total}`]), contentType: "image/png", userId: who.id });
        const raw = {
          documentType: o.documentType ?? "purchase_receipt",
          readable: true,
          store: "MİGROS TİC. A.Ş.",
          storeTaxNo: "1234567890",
          date: day,
          time: "10:12",
          receiptNo: "0042",
          total: amount(total),
          vatTotal: amount(22.32),
          vatLines: [],
          paymentMethod: o.paymentMethod ?? "cash",
          items: [],
          itemSummary: "süt, buz",
          categoryId: market.id,
          issues: [],
        };
        await db.insert(s.aiCalls).values({ feature: "fis", model: "haiku", status: "ok", userId: who.id, photoId: id, result: raw });
        return id;
      };

      // Sohbet ucunun veri bloğu: okunanlar ve önerilen kategori; başkasının fotoğrafı eklenemez
      const p1 = await upload(users.ali, 245.5);
      const block = await receipt.chatReceiptBlock(users.ali.id, p1);
      assert.ok(block.ok, block.ok ? "" : block.error);
      assert.match(block.text, new RegExp(`<fis_fotografi fisFotografi=${p1}>`));
      assert.match(block.text, /Toplam: 245,50 ₺/);
      assert.match(block.text, /Önerilen kategori: Market/);
      assert.doesNotMatch(block.text, /1234567890/, "satıcının vergi numarası gitmez");
      const foreign = await receipt.chatReceiptBlock(users.veli.id, p1);
      assert.deepEqual(foreign, { ok: false, error: "Bu fotoğrafı siz eklemediniz; fişi sohbete kendiniz ekleyin." });
      await assert.rejects(open("kasadan_cikan_ekle", { sube: "Tuzla", tur: "harcama", tutar: 245.5, belge: "fis", kategori: "Market", harcamalaraYaz: true, fisFotografi: p1 }, { who: users.veli }), /siz eklemediniz/);

      // Kasadan çıkan: belgesiz dense de fişli yazılır; tutar farkı kartta uyarı; onayda fotoğraf bağlanır
      const card = await open("kasadan_cikan_ekle", { sube: "Tuzla", tur: "harcama", tutar: 254.5, yer: "Migros", aciklama: "süt, buz", belge: "yok", kategori: "Market", harcamalaraYaz: true, fisFotografi: p1 });
      assert.equal(card.photoId, p1);
      assert.ok(card.lines.some((l) => l.label === "Belge" && l.to === "Fiş"), "belge fiş");
      assert.ok(card.lines.some((l) => l.label === "Fiş fotoğrafı"), "fotoğraf satırı");
      assert.ok(card.warnings.some((w) => w.startsWith("Fişte okunan toplam 245,50")), card.warnings.join(" | "));
      assert.equal((await photos.getPhoto(p1))!.linkedAt, null, "önizleme fotoğrafı bağlamaz");
      const out = await confirm.confirmOp(users.ali, card.id);
      assert.equal(out.status, "done", out.message);
      const [row] = await db.select().from(s.cashOuts).where(eq(s.cashOuts.photoId, p1));
      assert.ok(row, "kasadan çıkan fotoğrafıyla yazıldı");
      assert.equal(row.docType, "fis");
      assert.equal(row.receiptNo, "0042");
      assert.equal(row.receiptDate, day);
      assert.equal(row.vat, 22.32);
      assert.ok((await photos.getPhoto(p1))!.linkedAt, "onayda bağlandı");
      // Bağlanan fiş ikinci kez eklenemez
      assert.deepEqual(await receipt.chatReceiptBlock(users.ali.id, p1), { ok: false, error: "Bu fiş zaten bir kayda bağlı; ikinci kez eklenmez." });

      // Harcama (kartla ödenmiş fiş): gider fotoğrafı ve KDV'siyle; kart yazılmadan önce fiş başka kayda bağlanırsa bayat
      const p2 = await upload(users.ali, 120, { paymentMethod: "card" });
      const exp = await open("harcama_ekle", { kategori: "Market", tutar: 120, tarih: todayTR(), odemeSekli: "kart", sube: "Tuzla", fisFotografi: p2 });
      assert.equal(exp.photoId, p2);
      assert.ok(exp.lines.some((l) => l.label === "KDV (fişten)"), "KDV satırı");
      assert.ok(exp.warnings.some((w) => /kartla ödenmiş/.test(w)), "okumanın uyarısı kartta");
      const done = await confirm.confirmOp(users.ali, exp.id);
      assert.equal(done.status, "done", done.message);
      const [entry] = await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.photoId, p2));
      assert.ok(entry, "harcama fotoğrafıyla yazıldı");
      assert.equal(entry.vat, 22.32);
      assert.equal(entry.amount, 120);
      assert.ok((await photos.getPhoto(p2))!.linkedAt, "harcamaya bağlandı");

      const p3 = await upload(users.ali, 50);
      const stale = await open("harcama_ekle", { kategori: "Market", tutar: 50, tarih: todayTR(), fisFotografi: p3 });
      await photos.keepPhoto(p3, null);
      const refused = await confirm.confirmOp(users.ali, stale.id);
      assert.notEqual(refused.status, "done");
      assert.match(refused.message, /Fiş fotoğrafı: Bu fiş zaten bir kayda bağlı/);
      assert.equal((await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.amount, 50))).length, 0, "hiçbir şey yazılmadı");

      // Teslime fiş eklenmez; okunmamış fotoğraf da eklenir (okunamadı, kart uyarır)
      await assert.rejects(open("kasadan_cikan_ekle", { sube: "Tuzla", tur: "teslim", tutar: 10, belge: "yok", harcamalaraYaz: false, fisFotografi: p3 }), /teslimde fiş olmaz/);
      const { id: bare } = await photos.savePhoto({ kind: "fis", bytes: slipPng(["FIS", "1", "2", "3"]), contentType: "image/png", userId: users.ali.id });
      const unread = await receipt.chatReceiptBlock(users.ali.id, bare);
      assert.ok(unread.ok && /Fiş okunamadı/.test(unread.text), "okunamadı bloğu");
      const blind = await open("harcama_ekle", { kategori: "Market", tutar: 30, tarih: todayTR(), fisFotografi: bare });
      assert.ok(blind.warnings.includes("Fişin toplamı okunamadı; tutarı fişle karşılaştırın."), blind.warnings.join(" | "));
    } finally {
      photos.__setPhotoDriverForTests(undefined);
    }
  });

  test("zayi / ikram: şubesine, istemci anahtarı planın kimliği", async () => {
    await product("Cheesecake", "Tek", 150);
    await assert.rejects(open("zayi_ikram_ekle", { tur: "zayi", urun: "Cheesecake", miktar: 1 }, { scope: ALL_BRANCHES }), /hangi şube/);
    const { card } = await ok("zayi_ikram_ekle", { sube: "Marina", tur: "zayi", urun: "cheesecake", miktar: 2, neden: "Döküldü / kırıldı" }, { scope: ALL_BRANCHES });
    const [w] = await db.select().from(s.wasteEntries);
    assert.equal(w.branchId, "marina");
    assert.equal(w.qty, 2);
    assert.equal(w.clientKey, card.id);
    assert.equal(w.createdBy, users.ali.id);
  });

  test("vardiya: tek kişinin istenen günleri yazılır, başka hücreye dokunulmaz; boşaltma kırmızı; geri al", async () => {
    const monday = weekStart(addDays(todayTR(), 7));
    const day = (i: number) => addDays(monday, i);
    // Ayşe'nin Pazartesi'si zaten yazılı; başka bir çalışanın Salı'sı da
    await db.insert(s.shifts).values([
      { branchId: "tuzla", date: day(0), personRef: `u:${users.ayse.id}`, userId: users.ayse.id, personName: users.ayse.name, kind: "work", startMin: 540, endMin: 1080, updatedByName: "Ali" },
      { branchId: "tuzla", date: day(1), personRef: "n:mehmet", userId: null, personName: "Mehmet", kind: "work", startMin: 600, endMin: 1080, updatedByName: "Ali" },
    ]);
    await assert.rejects(open("vardiya_hucre_yaz", { kisi: "Ayşe", gunler: [{ gun: day(4), metin: "10-18" }] }, { scope: ALL_BRANCHES }), /hangi şube/);
    await assert.rejects(open("vardiya_hucre_yaz", { sube: "Tuzla", kisi: "Ayşe", gunler: [{ gun: day(4), metin: "25-30" }] }), /Saat|saat/);
    const { card } = await ok("vardiya_hucre_yaz", { sube: "Tuzla", kisi: "ayşe", gunler: [{ gun: day(4), metin: "10-18 kasa" }, { gun: day(6), metin: "izin" }, { gun: day(0), metin: "" }] });
    const zero = card.lines.find((l) => l.danger);
    assert.ok(zero, "boşaltılan gün kırmızı");
    const rows = await db.select().from(s.shifts).where(eq(s.shifts.branchId, "tuzla")).orderBy(s.shifts.date);
    const ayse = rows.filter((r) => r.personRef === `u:${users.ayse.id}`);
    assert.deepEqual(
      ayse.map((r) => [r.date, r.kind, r.startMin, r.note]),
      [
        [day(4), "work", 600, "kasa"],
        [day(6), "off", null, null],
      ],
    );
    assert.equal(rows.filter((r) => r.personRef === "n:mehmet").length, 1, "başkasının hücresi yerinde");
    const undo = await confirm.undoOp(users.ali, card.id);
    assert.equal(undo.status, "undone", undo.message);
    const back = await db.select().from(s.shifts).where(and(eq(s.shifts.branchId, "tuzla"), eq(s.shifts.personRef, `u:${users.ayse.id}`)));
    assert.deepEqual(
      back.map((r) => [r.date, r.startMin]),
      [[day(0), 540]],
    );
    // "s" kısaltması şubenin hazır vardiya ayarına açılır (Şube ayarları › Hazır vardiyalar; ayarsızken 09:00–18:00)
    await db.insert(s.branchSettings).values({ branchId: "tuzla", grp: "vardiya.hazir", value: { presets: [{ key: "morning", startMin: 510, endMin: 1050 }] }, updatedBy: "Ali" });
    try {
      const preview = await open("vardiya_hucre_yaz", { sube: "Tuzla", kisi: "ayşe", gunler: [{ gun: day(2), metin: "s kasa" }] });
      assert.equal(preview.lines[0]?.to, "08:30–17:30 · kasa");
    } finally {
      await db.delete(s.branchSettings).where(and(eq(s.branchSettings.branchId, "tuzla"), eq(s.branchSettings.grp, "vardiya.hazir")));
    }
  });

  test("işlem geçmişi: onaydan gelen her satır asistan aracılığıyla; ekrandan yapılan iş öyle işaretlenmez", async () => {
    const all = await logs();
    assert.ok(all.length >= 10, String(all.length));
    const notVia = all.filter((l) => l.via !== "asistan");
    assert.deepEqual(
      notVia.map((l) => l.action),
      [],
    );
    // Asistan bağlamı dışında aynı yazıcı işaret koymaz
    const { logActivity } = await import("../src/server/actions/log");
    await logActivity(users.ali, "Elle yapılan iş", "ekrandan");
    const [last] = await db.select().from(s.activityLog).orderBy(sql`${s.activityLog.id} desc`).limit(1);
    assert.equal(last.via, null);
    // Plan tablosu da denetim kaydıdır: kim, hangi araç, ne zaman
    const ops = await db.select().from(s.assistantOps);
    assert.ok(ops.every((o) => o.userId === users.ali.id || o.userId === users.ayse.id));
    assert.ok(ops.some((o) => o.status === "done" && o.doneAt));
  });
});
