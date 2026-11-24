// Panel asistanının veritabanı yüzü (docs/ASISTAN.md), gerçek Postgres'te: günlük sınır yönetici başına ve yalnız
// asistanın satırlarını sayar (vardiya taslağı, okuma ve başka yöneticinin sorusu sayılmaz), asistanın soruları da
// okuma sınırına girmez; Ayarlar › Fotoğraftan okuma kapalıysa "off"; soru satırı "running" açılır, maliyet, token ve
// sayılarla kapanır (metin yok); parasut_bekleyenler aracı Paraşüt sayfasının listesini okur. Claude'a istek gitmez
// (anahtar sahte, istemci çağrılmaz). Kendi kullanıcılarını, satırlarını ve faturasını açar, sonunda siler.
//
// ASISTAN_TEST_DATABASE_URL verilmezse atlanır (migration'ları uygulanmış bir yerel veritabanı).
// Çalıştırma: ASISTAN_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/lm_asistan npx tsx --test tests/panel-asistani-db.test.ts

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { and, eq, inArray } from "drizzle-orm";

import { ASSISTANT_DAILY_CAP } from "../src/lib/assistant/protocol";
import type { AssistantOutcome } from "../src/server/ai/assistant/loop";
import * as s from "../src/server/db/schema";

const URL = process.env.ASISTAN_TEST_DATABASE_URL;

describe("Panel asistanı: veritabanında sınır ve kayıt", { skip: !URL && "ASISTAN_TEST_DATABASE_URL yok" }, () => {
  const tag = `${process.pid}-${randomBytes(3).toString("hex")}`;
  let db: import("../src/server/db").DB;
  let claude: typeof import("../src/server/ai/claude");
  let tools: typeof import("../src/server/ai/assistant/tools");
  let adapter: typeof import("../src/server/ai/assistant/tool-adapter");
  const ids = { admin: 0, other: 0, invoice: 0 };
  let settingsBefore: unknown;

  before(async () => {
    Object.assign(process.env, { DATABASE_URL: URL, ANTHROPIC_API_KEY: "sahte-anahtar-istek-gitmez", AUTH_SECRET: "panel-asistani-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır
    const require = createRequire(import.meta.url);
    const p = require.resolve("server-only");
    require.cache[p] = { id: p, filename: p, loaded: true, exports: {} } as unknown as NodeJS.Module;
    db = (await import("../src/server/db")).getDb();
    claude = await import("../src/server/ai/claude");
    tools = await import("../src/server/ai/assistant/tools");
    adapter = await import("../src/server/ai/assistant/tool-adapter");
    const [a] = await db.insert(s.users).values({ email: `asistan-${tag}@test.local`, name: "Asistan Yönetici", passwordHash: "x", role: "admin" }).returning();
    const [b] = await db.insert(s.users).values({ email: `asistan-diger-${tag}@test.local`, name: "Öteki Yönetici", passwordHash: "x", role: "admin" }).returning();
    ids.admin = a.id;
    ids.other = b.id;
    [settingsBefore] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, "ai.settings"));
    await claude.saveAiSettings({ enabled: true, dailyCap: 40 });
  });

  after(async () => {
    if (!db) return;
    await db.delete(s.aiCalls).where(inArray(s.aiCalls.userId, [ids.admin, ids.other]));
    if (ids.invoice) await db.delete(s.invoices).where(eq(s.invoices.id, ids.invoice));
    await db.delete(s.users).where(inArray(s.users.id, [ids.admin, ids.other]));
    // Paylaşılan veritabanında ayar eski hâline
    if (settingsBefore) await db.update(s.integrationState).set({ value: (settingsBefore as { value: unknown }).value }).where(eq(s.integrationState.key, "ai.settings"));
    else await db.delete(s.integrationState).where(eq(s.integrationState.key, "ai.settings"));
    await db.$client.end();
  });

  const rows = (userId: number | null, feature: string, n: number) =>
    db.insert(s.aiCalls).values(Array.from({ length: n }, () => ({ feature, model: "claude-sonnet-5-5", status: "ok" as const, userId })));

  test("günlük sınır yönetici başına, yalnız asistanın satırları; asistan okuma sınırına girmez", async () => {
    const readingsBefore = (await claude.aiStatus()).usedToday;
    assert.deepEqual(await claude.assistantStatus(ids.admin), { state: "on", usedToday: 0, cap: ASSISTANT_DAILY_CAP });
    await rows(ids.admin, "asistan", ASSISTANT_DAILY_CAP - 1);
    await rows(ids.admin, "vardiya", 3);
    await rows(ids.other, "asistan", 5);
    assert.deepEqual(await claude.assistantStatus(ids.admin), { state: "on", usedToday: ASSISTANT_DAILY_CAP - 1, cap: ASSISTANT_DAILY_CAP });
    assert.equal((await claude.assistantStatus(ids.other)).usedToday, 5);
    // Asistanın soruları kasadaki fotoğraf okumasının günlük sınırını tüketmez
    assert.equal((await claude.aiStatus()).usedToday, readingsBefore);
    await rows(ids.admin, "asistan", 1);
    assert.equal((await claude.assistantStatus(ids.admin)).state, "cap");
    // Dünün satırı bugünü saymaz
    await db
      .update(s.aiCalls)
      .set({ at: new Date(Date.now() - 2 * 86_400_000) })
      .where(and(eq(s.aiCalls.userId, ids.admin), eq(s.aiCalls.feature, "asistan")));
    assert.equal((await claude.assistantStatus(ids.admin)).usedToday, 0);
    // Ayarlar › Fotoğraftan okuma kapalıyken asistan da kapalı
    await claude.saveAiSettings({ enabled: false, dailyCap: 40 });
    assert.equal((await claude.assistantStatus(ids.admin)).state, "off");
    await claude.saveAiSettings({ enabled: true, dailyCap: 40 });
  });

  test("soru satırı: önce running, sonra maliyet, token ve sayılarla kapanır; metin yazılmaz", async () => {
    const id = await claude.startAssistantCall(ids.admin);
    const [open] = await db.select().from(s.aiCalls).where(eq(s.aiCalls.id, id));
    assert.equal(open.status, "running");
    assert.equal(open.feature, "asistan");
    assert.equal(open.model, "claude-sonnet-5-5");
    assert.equal(open.effort, "medium");
    assert.equal(open.userId, ids.admin);
    const outcome: AssistantOutcome = {
      done: "end",
      error: null,
      cost: { costUsd: 0.0123, inputTokens: 3400, outputTokens: 320, cacheReadTokens: 2900, cacheWriteTokens: 2900, fallback: false, priceKnown: true },
      servedModel: "claude-sonnet-5-5",
      stopReason: "end_turn",
      requestId: "req_test",
      apiCalls: 2,
      toolCalls: 2,
    };
    await claude.finishAssistantCall(id, outcome, 4200);
    const [row] = await db.select().from(s.aiCalls).where(eq(s.aiCalls.id, id));
    assert.equal(row.status, "ok");
    assert.equal(row.costUsd, 0.0123);
    assert.deepEqual([row.inputTokens, row.outputTokens, row.cacheReadTokens, row.cacheWriteTokens, row.ms], [3400, 320, 2900, 2900, 4200]);
    assert.equal(row.stopReason, "end_turn");
    assert.equal(row.requestId, "req_test");
    assert.deepEqual(row.result, { apiCalls: 2, toolCalls: 2 });
    assert.equal(row.error, null);

    const refused = await claude.startAssistantCall(ids.admin);
    await claude.finishAssistantCall(refused, { ...outcome, done: null, error: { code: "refusal", detail: "refusal (cyber)", status: null } }, 900);
    const [r] = await db.select().from(s.aiCalls).where(eq(s.aiCalls.id, refused));
    assert.deepEqual([r.status, r.errorCode, r.error], ["refusal", "refusal", "refusal (cyber)"]);
    const stopped = await claude.startAssistantCall(ids.admin);
    await claude.finishAssistantCall(stopped, { ...outcome, done: "aborted" }, 300);
    const [st] = await db.select().from(s.aiCalls).where(eq(s.aiCalls.id, stopped));
    assert.deepEqual([st.status, st.stopReason], ["incomplete", "aborted"]);
  });

  test("parasut_bekleyenler: Paraşüt sayfasının listesini okur (bağlanmamış ürün, ekran bağlantısı)", async () => {
    const [inv] = await db.insert(s.invoices).values({ date: "2026-11-20", supplier: `Test Tedarikçi ${tag}`, category: "Diğer", amount: 100, source: "parasut" }).returning();
    ids.invoice = inv.id;
    await db.insert(s.parasutBillLines).values({ invoiceId: inv.id, externalId: `x-${tag}`, productKey: `urun-${tag}`, productName: `TEST ÜRÜN ${tag}`, quantity: 4, netTotal: 100 });
    const out = await adapter.runToolUse(tools.ASSISTANT_TOOLS, { id: "t1", name: "parasut_bekleyenler", input: { limit: 40 } }, { ctx: { base: "", now: new Date() } });
    assert.equal(out.is_error, undefined, String(out.content));
    const v = JSON.parse(String(out.content)) as { toplam: number; urunler: { urun: string; faturaSayisi: number; sonBirimFiyatKdvHaric: number }[]; panelAdresi: string };
    assert.ok(v.toplam >= 1);
    const mine = v.urunler.find((u) => u.urun === `TEST ÜRÜN ${tag}`);
    assert.ok(mine, "eklenen ürün listede");
    assert.equal(mine.faturaSayisi, 1);
    assert.equal(mine.sonBirimFiyatKdvHaric, 25);
    assert.equal(v.panelAdresi, "/panel/parasut#urun-baglantilari");
  });
});
