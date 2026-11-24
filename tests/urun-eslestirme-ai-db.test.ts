// Paraşüt › AI ile öneri gerçek Postgres'te (docs/PARASUT.md § 5e), kayıtlı yanıtlarla (AI_REPLAY; canlı istek yok),
// oturum ve next/cache taklit edilerek: "AI ile öner" yalnız sezgiselin "aynı ürün bağlı" diyemediği ürünleri sorar,
// doğrulanmış önerileri integration_state'e yazar ve bağlantı kurmaz; ai_calls'a yalnız maliyet satırı düşer (istem ve
// yanıt yok); ikinci basış yeniden sormaz (sayfa yenilenince API yemez); hammadde listesi değişince öneriler geçersiz
// olur, bağlanan ürünün önerisi düşer; okuma sınırına sayılmaz, kendi günlük sınırı ve aynı anda tek istek kuralı var.
//
// ESLESTIRME_TEST_DATABASE_URL (yoksa PARASUT_TEST_DATABASE_URL) verilmezse atlanır. Bir Postgres sunucusunun adresi
// (veritabanı oluşturabilen kullanıcı): test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: ESLESTIRME_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/urun-eslestirme-ai-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { asc, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.ESLESTIRME_TEST_DATABASE_URL ?? process.env.PARASUT_TEST_DATABASE_URL;
const DB_NAME = `laffogato_eslestirme_${process.pid}`;

describe("AI ile ürün → hammadde önerisi: veritabanında", { skip: !SERVER_URL && "ESLESTIRME_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let actions: typeof import("../src/server/actions/parasut");
  let aiMatch: typeof import("../src/server/parasut/ai-match");
  let sync: typeof import("../src/server/parasut/sync");
  let claude: typeof import("../src/server/ai/claude");
  let userId = 0;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    // Kayıtlı yanıtlar yalnız geliştirmede ve AI_REPLAY=1 iken (src/server/ai/replay.ts); anahtar yok, ağ yok
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "eslestirme-testi-icin-en-az-otuz-iki-karakterlik-anahtar", NODE_ENV: "development", AI_REPLAY: "1" });
    delete process.env.ANTHROPIC_API_KEY;
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    const [u] = await db.insert(s.users).values({ email: "ali@laffogato.net", name: "Ali", passwordHash: "x", role: "admin" }).returning();
    userId = u.id;
    stub(require.resolve("../src/server/auth/dal"), { requireAdmin: async () => ({ ...u, role: "admin" }), requireUser: async () => ({ ...u, role: "admin" }) });
    actions = await import("../src/server/actions/parasut");
    aiMatch = await import("../src/server/parasut/ai-match");
    sync = await import("../src/server/parasut/sync");
    claude = await import("../src/server/ai/claude");

    // Migration'ların eklediği sayım kalemleri listeyi kalabalıklaştırmasın: yalnız bu testin hammaddeleri (kimlik 1, 2, 3)
    await db.execute(sql`TRUNCATE ingredients, parasut_product_links, parasut_bill_lines, invoices, integration_state, ai_calls RESTART IDENTITY CASCADE`);
    const ing = async (name: string, unit: "gr" | "ml" | "adet", packagePrice: number, packageSize: number) =>
      (await db.insert(s.ingredients).values({ name, category: "Test", unit, packagePrice, packageSize }).returning({ id: s.ingredients.id }))[0].id;
    const milk = await ing("Süt", "ml", 45, 1000);
    await ing("Yenilebilir bardak", "adet", 3000, 150);
    await ing("Kakao", "gr", 900, 1000);
    // Sahibin daha önce yaptığı bağlantı: aynı ürün (başka anahtarla) yeniden gelince AI'ye sorulmaz
    await db.insert(s.parasutProductLinks).values({ productKey: "p:sut-eski", productName: "PINAR SÜT 1 LT", ingredientId: milk, factor: 1000 });
    for (const [key, name, unit, net] of [
      ["p:sut-eski", "PINAR SÜT 1 LT", "Adet", 52.3],
      ["p:sut-yeni", "Pınar Süt 1 Lt", "Adet", 54],
      ["p:bardak", "LİVİ YENİLEBİLİR BARDAK 150 AD.", "Adet", 3000],
      ["p:kargo", "KARGO BEDELİ", "Adet", 120],
      ["p:surup", "VANİLYA ŞURUBU", "Adet", 380],
      ["p:kakao", "KAKAO TOZU", "KG", 900],
    ] as const) {
      const [inv] = await db
        .insert(s.invoices)
        .values({ date: "2026-11-20", supplier: "Metro", category: "Hammadde & İçecek", amount: net, payable: net * 1.2, source: "parasut", origin: "parasut" })
        .returning();
      await db.insert(s.parasutBillLines).values({ invoiceId: inv.id, externalId: `l-${key}`, productKey: key, productName: name, unit, quantity: 1, unitPrice: net, netTotal: net });
    }
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  const store = async () => {
    const [row] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, aiMatch.AI_SUGGESTIONS_KEY));
    return row?.value as { hash: string; items: Record<string, { decision: string; ingredientId: number | null; factor: number | null; confidence: string }> } | undefined;
  };
  const calls = () => db.select().from(s.aiCalls).orderBy(asc(s.aiCalls.id));
  const links = () => db.select({ productKey: s.parasutProductLinks.productKey, productName: s.parasutProductLinks.productName, ingredientId: s.parasutProductLinks.ingredientId, factor: s.parasutProductLinks.factor }).from(s.parasutProductLinks);
  const page = async () => aiMatch.aiMatchPage((await sync.unlinkedProducts(40)).items, await links());

  test("sayfa açılınca istek gitmez: düğme açık, sorulacak 4 ürün (aynı ürün bağlı olan sorulmaz)", async () => {
    const p = await page();
    assert.equal(p.state, "on");
    assert.equal(p.askable, 4);
    assert.deepEqual(p.items, {});
    assert.equal((await calls()).length, 0);
  });

  test("AI ile öner: tek parti, öneriler saklanır, bağlantı kurulmaz, günlüğe yalnız maliyet satırı", async () => {
    const r = await actions.suggestProductLinksAi();
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.ok && { ...r.data, costUsd: r.data.costUsd > 0 }, { asked: 4, remaining: 0, link: 2, notIngredient: 1, unsure: 1, rejected: 0, costUsd: true });

    const st = await store();
    assert.ok(st, "öneriler integration_state'te");
    assert.deepEqual(Object.keys(st.items).sort(), ["p:bardak", "p:kakao", "p:kargo", "p:surup"]);
    assert.deepEqual([st.items["p:bardak"].decision, st.items["p:bardak"].factor, st.items["p:bardak"].confidence], ["bagla", 150, "yuksek"]);
    assert.deepEqual([st.items["p:kakao"].decision, st.items["p:kakao"].factor], ["bagla", 1000]);
    assert.equal(st.items["p:kargo"].decision, "hammadde_degil");
    assert.equal(st.items["p:surup"].decision, "emin_degil");
    assert.equal(st.items["p:sut-yeni"], undefined, "aynı ürün bağlı: sorulmadı");

    // Bağlantı ve "hammadde değil" işareti kullanıcı onaylamadan yazılmaz
    assert.deepEqual((await links()).map((l) => l.productKey), ["p:sut-eski"]);
    assert.deepEqual(await sync.ignoredProducts(), []);

    const [c] = await calls();
    assert.deepEqual([c.feature, c.model, c.status, c.userId, c.photoId, c.result], ["eslestirme", "claude-sonnet-5-5", "ok", userId, null, null]);
    assert.ok(c.costUsd > 0 && c.cacheReadTokens > 0, "tutar ve önbellek okuması yazılır");
    const [log] = await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Paraşüt ürünleri için AI önerisi"));
    assert.match(log?.detail ?? "", /^4 ürün soruldu: 2 bağlantı önerisi, 1 hammadde değil, 1 emin değil$/);
  });

  test("ikinci basış ve sayfa yenileme yeniden sormaz; okuma sınırına sayılmaz", async () => {
    const r = await actions.suggestProductLinksAi();
    assert.deepEqual(r.ok && [r.data.asked, r.data.remaining], [0, 0]);
    assert.equal((await calls()).length, 1, "yeni istek yok");
    const p = await page();
    assert.equal(p.askable, 0);
    assert.deepEqual(Object.keys(p.items).sort(), ["p:bardak", "p:kakao", "p:kargo", "p:surup"]);
    assert.deepEqual([p.usedToday, p.monthCalls], [1, 1]);
    assert.ok(p.monthUsd > 0);
    assert.equal((await claude.aiStatus()).usedToday, 0, "fotoğraf ve fatura okumasının sınırı etkilenmez");
  });

  test("hammadde listesi değişince öneriler geçersiz; bağlanan ürünün önerisi düşer", async () => {
    await db.insert(s.ingredients).values({ name: "Vanilya şurubu", category: "Şurup", unit: "ml", packagePrice: 400, packageSize: 700 });
    const p = await page();
    assert.deepEqual(p.items, {}, "eski liste için verilen öneriler gösterilmez");
    assert.equal(p.askable, 4);
    // Sahip bardağı kendisi bağlar (bağlantının tek yolu); sonra öneri yeniden istenir
    const saved = await actions.saveProductLink({ productKey: "p:bardak", productName: "LİVİ YENİLEBİLİR BARDAK 150 AD.", ingredientId: 2, factor: 150, updatePrice: true });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    // Okuma sınırı dolu olsa da (fotoğraf, fatura) ürün önerisi kendi sınırıyla çalışır
    await db.insert(s.aiCalls).values(Array.from({ length: 40 }, () => ({ feature: "fis", model: "claude-opus-5-5", status: "ok" as const })));
    const r = await actions.suggestProductLinksAi();
    assert.deepEqual(r.ok && [r.data.asked, r.data.remaining], [3, 0]);
    const st = await store();
    assert.deepEqual(Object.keys(st?.items ?? {}).sort(), ["p:kakao", "p:kargo", "p:surup"]);
    // Yeni hammadde listede: kayıtlı yanıt şurubu artık ona bağlar
    assert.equal(st?.items["p:surup"].decision, "bagla");
  });

  test("aynı anda tek istek; sınıra bir parti kala aynı anda iki basıştan yalnız biri gider; sınır dolunca istek gitmez, nedeni Türkçe", async () => {
    await db.insert(s.ingredients).values({ name: "Karamel şurubu", category: "Şurup", unit: "ml", packagePrice: 400, packageSize: 700 });
    const [running] = await db.insert(s.aiCalls).values({ feature: "eslestirme", model: "claude-sonnet-5-5", status: "running" }).returning();
    const rows = (await calls()).length;
    const busy = await actions.suggestProductLinksAi();
    assert.equal(!busy.ok && busy.error, "AI önerisi başka bir sekmede sürüyor; bitince sayfayı yenileyin.");
    assert.equal((await calls()).length, rows, "sürerken günlüğe satır yazılmaz");
    await db.update(s.aiCalls).set({ status: "error" }).where(eq(s.aiCalls.id, running.id));

    // İki sekme aynı anda: sınır denetimi ve "running" satırı tek işlemde, danışma kilidiyle (ikincisi ilkini görür)
    const matchCalls = async () => (await calls()).filter((c) => c.feature === "eslestirme").length;
    await db.insert(s.aiCalls).values(Array.from({ length: 19 - (await matchCalls()) }, () => ({ feature: "eslestirme", model: "claude-sonnet-5-5", status: "ok" as const })));
    const both = await Promise.all([actions.suggestProductLinksAi(), actions.suggestProductLinksAi()]);
    assert.equal(both.filter((r) => r.ok && r.data.asked > 0).length, 1, JSON.stringify(both));
    for (const r of both.filter((x) => !x.ok)) {
      assert.ok(
        ["AI önerisi başka bir sekmede sürüyor; bitince sayfayı yenileyin.", "AI önerisinin bugünkü sınırı doldu (20 parti); hammaddeyi elle seçin."].includes(!r.ok ? r.error : ""),
        JSON.stringify(r),
      );
    }
    assert.equal(await matchCalls(), 20, "sınır aşılmaz: yalnız bir parti daha soruldu");

    // Liste yine değişir (sorulacak ürün var), ama bugünkü sınır dolu
    await db.insert(s.ingredients).values({ name: "Fındık şurubu", category: "Şurup", unit: "ml", packagePrice: 400, packageSize: 700 });
    const before = (await calls()).length;
    assert.equal((await page()).state, "cap");
    const capped = await actions.suggestProductLinksAi();
    assert.equal(!capped.ok && capped.error, "AI önerisinin bugünkü sınırı doldu (20 parti); hammaddeyi elle seçin.");
    assert.equal((await calls()).length, before, "sınır dolunca günlüğe satır da yazılmaz");
  });
});
