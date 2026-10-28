// Claude ile okuma, sahte istemciyle: isteğin biçimi (canlıda denenmiş hâli), yanıtın denetimi (ret, yarım, bozuk
// JSON, şema), yedek modelin bloğu, SDK hatalarının Türkçe karşılığı ve maliyet (src/server/ai/run.ts, pricing.ts);
// fatura okumasının Haiku 5.5 + PDF isteği (yedek model yok); yazarkasa Z isteği (efor, 8000 token, tek 50 sn) ve
// AI_REPLAY yanıtlarıyla sunucu yolu (personelin yanıtı, eski kasa-pos sayfası, doldurma kapısı). Anahtar gerekmez; ağ yok.
// Çalıştırma: npx tsx --test tests/ai-istemci.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { InvoiceReadingRaw } from "../src/lib/invoice-reading";
import { claudeSchema, fitsStructuredOutputs, schemaComplexity, STRUCTURED_OUTPUT_LIMITS } from "../src/lib/photo-read/claude-schema";
import { OKC_TASK, POS_TASK, RECEIPT_TASK, SYSTEM, Z_TASK } from "../src/lib/photo-read/prompts";
import { KasaOkcRaw, KasaPosRaw, KasaZRaw, ReceiptRaw } from "../src/lib/photo-read/schemas";
import { OKC_PREFILL_ENABLED, OKC_SUGGEST_TEXT } from "../src/lib/okc-z";
import { FISCAL_Z_CARD_TEXT, prefillPlan, type ReadField } from "../src/lib/photo-read/kasa";
import { normalizeOkc, okcToLegacyPos, toStaffReading } from "../src/lib/photo-read/okc";
import { costUsd, priceOf } from "../src/server/ai/pricing";
import { replayAnswer, replayClient, replayEnabled } from "../src/server/ai/replay";
import {
  AI_FALLBACK_BETA,
  AI_INVOICE_MODEL,
  AI_MODEL,
  aiAlertLog,
  aiErrorText,
  buildRequest,
  JSON_REPLY,
  mapAiError,
  OKC_EFFORT,
  OKC_MAX_TOKENS,
  OKC_TIMEOUTS,
  RETRYABLE,
  runExtraction,
  type AiClient,
  type AiErrorCode,
  type AiMessage,
  type CreateOptions,
  type CreateParams,
} from "../src/server/ai/run";

const FIXTURES = join(__dirname, "fixtures", "foto");
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as { json: unknown; usage: AiMessage["usage"]; model: string; requestId: string };

const IMAGE = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), mediaType: "image/jpeg" as const };

/** Sahte istemci: isteği saklar, verilen yanıtı (ya da hatayı) döndürür */
function fake(answer: Partial<AiMessage> | Error) {
  const calls: { params: CreateParams; options: CreateOptions }[] = [];
  const client: AiClient = {
    beta: {
      messages: {
        async create(params, options) {
          calls.push({ params, options });
          if (answer instanceof Error) throw answer;
          return { model: AI_MODEL, stop_reason: "end_turn", stop_details: null, content: [], usage: { input_tokens: 10, output_tokens: 5 }, _request_id: "req_test", ...answer };
        },
      },
    },
  };
  return { client, calls };
}

const text = (t: string) => ({ type: "text", text: t });
const Small = z.object({ total: z.number(), kind: z.enum(["a", "b"]) });
const req = <T>(schema: z.ZodType<T>) => ({ image: IMAGE, system: "SİSTEM", task: "GÖREV", schema });

test("istek: Opus 5.5, düşük efor, JSON şeması, base64 görsel, sunucu tarafı yedek model; düşünme / sıcaklık yok", async () => {
  const { client, calls } = fake({ content: [text(JSON.stringify({ total: 1, kind: "a" }))] });
  await runExtraction(client, req(Small));
  const [{ params, options }] = calls;
  assert.equal(params.model, "claude-opus-5-5");
  assert.equal(params.max_tokens, 6000);
  assert.deepEqual(params.betas, [AI_FALLBACK_BETA]);
  assert.equal(AI_FALLBACK_BETA, "server-side-fallback-2026-07-01");
  assert.equal((params as unknown as Record<string, unknown>).fallbacks, "default");
  assert.equal(params.output_config?.effort, "low");
  assert.equal(params.output_config?.format?.type, "json_schema");
  const schema = (params.output_config?.format as { schema: Record<string, unknown> }).schema;
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual((schema.properties as Record<string, { enum?: string[] }>).kind.enum, ["a", "b"]);
  for (const key of ["temperature", "top_p", "top_k", "thinking", "stream", "tools"]) assert.equal(key in params, false, key);
  assert.equal(params.system, "SİSTEM");
  assert.equal(params.messages.length, 1);
  const [msg] = params.messages;
  assert.equal(msg.role, "user");
  assert.ok(Array.isArray(msg.content));
  const [image, task] = msg.content as { type: string; source?: { type: string; media_type: string; data: string }; text?: string }[];
  assert.deepEqual(image, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: Buffer.from(IMAGE.bytes).toString("base64") } });
  assert.deepEqual(task, { type: "text", text: "GÖREV" });
  assert.equal(options.timeout, 20_000);
  assert.equal(options.maxRetries, 1);
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.signal.aborted, false);

  assert.equal(buildRequest({ ...req(Small), maxTokens: 900 }).params.max_tokens, 900);
  const webp = buildRequest({ ...req(Small), image: { ...IMAGE, mediaType: "image/webp" } }).params.messages[0].content as { source?: { media_type: string } }[];
  assert.equal(webp[0].source?.media_type, "image/webp");
});

test("yanıt: geçerli JSON şemadan geçer; yedek modelin bloğu baştaysa da metin türüne göre okunur", async () => {
  const ok = await runExtraction(fake({ content: [text('{"total": 12.5, '), text('"kind": "b"}')] }).client, req(Small));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.ok && ok.data, { total: 12.5, kind: "b" });
  assert.equal(ok.servedModel, AI_MODEL);
  assert.equal(ok.stopReason, "end_turn");
  assert.equal(ok.requestId, "req_test");
  assert.deepEqual(ok.usage, { input_tokens: 10, output_tokens: 5 });

  const fb = await runExtraction(fake({ model: "claude-opus-5", content: [{ type: "fallback" }, text('{"total": 3, "kind": "a"}')] }).client, req(Small));
  assert.equal(fb.ok, true);
  assert.equal(fb.servedModel, "claude-opus-5");
});

test("yanıt: ret içerik okunmadan; yarım kalan; bozuk JSON; şemaya uymayan", async () => {
  const valid = text(JSON.stringify({ total: 1, kind: "a" }));
  const refusal = await runExtraction(fake({ stop_reason: "refusal", stop_details: { category: "cyber" }, content: [valid] }).client, req(Small));
  assert.equal(refusal.ok, false);
  assert.equal(!refusal.ok && refusal.code, "refusal");
  assert.equal(!refusal.ok && refusal.message, "Bu fotoğraf okunamadı. Rakamları elle yazın.");
  assert.match(!refusal.ok ? refusal.detail : "", /cyber/);
  assert.equal(refusal.requestId, "req_test");

  const cut = await runExtraction(fake({ stop_reason: "max_tokens", content: [text('{"total": 1')] }).client, req(Small));
  assert.equal(!cut.ok && cut.code, "incomplete");
  assert.equal(!cut.ok && cut.message, "Okuma yarım kaldı. Yeniden deneyin.");

  const bad = await runExtraction(fake({ content: [text("Toplam 12,50 TL")] }).client, req(Small));
  assert.equal(!bad.ok && bad.code, "invalid");
  assert.match(!bad.ok ? bad.detail : "", /JSON okunamadı/);

  const none = await runExtraction(fake({ content: [] }).client, req(Small));
  assert.equal(!none.ok && none.code, "invalid");

  const wrong = await runExtraction(fake({ content: [text(JSON.stringify({ total: "12,50", kind: "a" }))] }).client, req(Small));
  assert.equal(!wrong.ok && wrong.code, "invalid");
  assert.equal(!wrong.ok && wrong.message, "Fotoğraftaki rakamlar güvenilir okunamadı. Elle yazın.");
  assert.match(!wrong.ok ? wrong.detail : "", /Şema tutmadı: total/);
});

test("kayıtlı beş yanıt kendi şemasından geçer (canlıdaki istekle aynı biçim)", async () => {
  const cases: [string, z.ZodType][] = [
    ["z", KasaZRaw],
    ["yanlis-belge", KasaZRaw],
    ["pos", KasaPosRaw],
    ["fis-soluk", ReceiptRaw],
    ["fis-talimat", ReceiptRaw],
  ];
  for (const [name, schema] of cases) {
    const rec = fixture(name);
    const res = await runExtraction(fake({ model: rec.model, content: [text(JSON.stringify(rec.json))], usage: rec.usage, _request_id: rec.requestId }).client, req(schema));
    assert.equal(res.ok, true, name);
    assert.deepEqual(res.ok && res.data, rec.json, name);
  }
});

test("SDK hataları: istemci atınca kod, metin ve istek kimliği döner", async () => {
  const err = Anthropic.APIError.generate(429, { error: { type: "rate_limit_error", message: "slow down" } }, "slow down", new Headers({ "request-id": "req_429" }));
  const res = await runExtraction(fake(err).client, req(Small));
  assert.equal(res.ok, false);
  assert.equal(!res.ok && res.code, "rate");
  assert.equal(!res.ok && res.status, 429);
  assert.equal(res.requestId, "req_429");
  assert.equal(res.usage, null);
  assert.equal(!res.ok && res.message, "Okuma servisi şu an yoğun. Biraz sonra yeniden deneyin.");
});

test("mapAiError: tablonun her satırı (en özelden genele)", () => {
  const h = new Headers({ "request-id": "req_x" });
  const gen = (status: number) => Anthropic.APIError.generate(status, { error: { type: "x", message: "m" } }, "m", h);
  const rows: [unknown, AiErrorCode, number | null][] = [
    [new Anthropic.APIConnectionTimeoutError(), "timeout", null],
    [new Anthropic.APIUserAbortError(), "timeout", null],
    [Object.assign(new Error("This operation was aborted"), { name: "AbortError" }), "timeout", null],
    [Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }), "timeout", null],
    [new Anthropic.APIConnectionError({ message: "ECONNRESET" }), "connection", null],
    [Anthropic.APIError.generate(undefined, new Error("fetch failed"), "fetch failed", undefined), "connection", null],
    [gen(429), "rate", 429],
    [gen(500), "overloaded", 500],
    [gen(529), "overloaded", 529],
    [gen(401), "auth", 401],
    [gen(403), "auth", 403],
    [gen(402), "billing", 402],
    [gen(413), "toolarge", 413],
    [gen(400), "badrequest", 400],
    [gen(404), "badrequest", 404],
    [gen(422), "badrequest", 422],
    [gen(409), "badrequest", 409],
    [new TypeError("fetch failed"), "connection", null],
    ["metin", "connection", null],
  ];
  for (const [e, code, status] of rows) {
    const m = mapAiError(e);
    assert.equal(m.code, code, `${e instanceof Error ? e.constructor.name : e} → ${code}`);
    assert.equal(m.status, status);
    assert.ok(m.detail.length <= 300);
  }
  assert.equal(gen(401) instanceof Anthropic.AuthenticationError, true);
  assert.equal(mapAiError(gen(500)).requestId, "req_x");
  assert.match(mapAiError(gen(400)).detail, /BadRequestError 400/);
  assert.equal(mapAiError(Object.assign(new Error("x".repeat(1000)), { name: "Error" })).detail.length, 300);
});

test("hata metinleri: her kodun Türkçe metni; yeniden denenebilenler", () => {
  const codes: AiErrorCode[] = ["nokey", "off", "cap", "photo-limit", "timeout", "connection", "rate", "overloaded", "auth", "billing", "toolarge", "badrequest", "refusal", "incomplete", "invalid"];
  for (const c of codes) assert.ok(aiErrorText(c).length > 10, c);
  assert.equal(aiErrorText("cap", 40), "Bugünkü okuma sınırı doldu (40). Fotoğraf eklendi; rakamları elle yazın.");
  assert.equal(aiErrorText("timeout"), "Okuma çok uzun sürdü. Yeniden deneyin ya da elle yazın.");
  assert.deepEqual([...RETRYABLE].sort(), ["connection", "incomplete", "overloaded", "rate", "timeout"]);
  for (const c of ["auth", "billing", "refusal", "invalid", "nokey"] as const) assert.equal(RETRYABLE.includes(c), false, c);
});

test("costUsd: kayıtlı Z okuması 0,029788 $; yedek denemesi kendi fiyatıyla; denemeler yoksa üst düzey kullanım", () => {
  const z1 = costUsd(fixture("z").usage, AI_MODEL);
  assert.equal(z1.usd, 0.029788);
  assert.equal(z1.inputTokens, 5257);
  assert.equal(z1.outputTokens, 438);
  assert.equal(z1.fallback, false);
  assert.equal(z1.priceKnown, true);

  const withFallback = costUsd(
    {
      input_tokens: 5000,
      output_tokens: 300,
      iterations: [
        { type: "message", model: null, input_tokens: 5000, output_tokens: 100 },
        { type: "fallback_message", model: "claude-opus-5", input_tokens: 5000, output_tokens: 300 },
      ],
    },
    AI_MODEL,
  );
  assert.equal(withFallback.usd, 0.0545); // 5000×4 + 100×20 (Opus 5.5) + 5000×5 + 300×25 (Opus 5)
  assert.equal(withFallback.fallback, true);
  assert.equal(withFallback.inputTokens, 10_000);
  assert.equal(withFallback.outputTokens, 400);

  const top = costUsd({ input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 2000, cache_creation_input_tokens: 1000 }, AI_MODEL);
  assert.equal(top.usd, 0.0114);
  assert.equal(top.cacheReadTokens, 2000);
  assert.equal(top.cacheWriteTokens, 1000);
  assert.equal(costUsd({ input_tokens: 1000, output_tokens: 100, iterations: [] }, AI_MODEL).usd, 0.006);

  const unknown = costUsd({ input_tokens: 1000, output_tokens: 100 }, "claude-yeni-7");
  assert.equal(unknown.priceKnown, false);
  assert.equal(unknown.usd, 0.006);
  // Tarihli sürüm en uzun eşleşen ön ekle: opus-5-5 ile opus-5 karışmaz
  assert.deepEqual(priceOf("claude-opus-5-5-20261001"), priceOf("claude-opus-5-5"));
  assert.deepEqual(priceOf("claude-opus-5-20260301"), priceOf("claude-opus-5"));
  assert.notDeepEqual(priceOf("claude-opus-5-5"), priceOf("claude-opus-5"));
  assert.equal(priceOf("claude-opus-55"), null);
});

const PDF = { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]), mediaType: "application/pdf" as const };

test("fatura isteği: Haiku 5.5, PDF belge metinden önce, efor medium, JSON şeması; yedek model ve düşünme yok", async () => {
  const { client, calls } = fake({ model: AI_INVOICE_MODEL, content: [text(JSON.stringify({ total: 1, kind: "a" }))] });
  const res = await runExtraction(client, { document: PDF, model: AI_INVOICE_MODEL, system: "SİSTEM", task: "GÖREV", schema: Small, totalMs: 30_000 });
  assert.equal(res.ok, true);
  const [{ params, options }] = calls;
  assert.equal(AI_INVOICE_MODEL, "claude-haiku-5-5");
  assert.equal(params.model, "claude-haiku-5-5");
  assert.equal(params.max_tokens, 6000);
  // Haiku 5.5'te sunucu tarafı yedek model yok: beta başlığı ve fallbacks gönderilmez
  for (const key of ["betas", "fallbacks", "temperature", "top_p", "top_k", "thinking", "stream", "tools"]) assert.equal(key in params, false, key);
  assert.equal(params.output_config?.effort, "medium");
  assert.equal(params.output_config?.format?.type, "json_schema");
  assert.deepEqual(Object.keys(params), ["model", "max_tokens", "output_config", "system", "messages"]);
  const [doc, task] = params.messages[0].content as { type: string; source?: unknown; text?: string }[];
  assert.deepEqual(doc, { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(PDF.bytes).toString("base64") } });
  assert.deepEqual(task, { type: "text", text: "GÖREV" });
  assert.equal(options.timeout, 20_000);
  assert.equal(options.maxRetries, 1);
  // Faturanın görseli (Paraşüt fotoğrafı) görsel bloğuyla
  const img = buildRequest({ image: IMAGE, model: AI_INVOICE_MODEL, system: "S", task: "T", schema: Small }).params;
  assert.equal((img.messages[0].content as { type: string }[])[0].type, "image");
  assert.equal("betas" in img, false);
});

test("fotoğraf isteği değişmedi: alanlar ve sırası canlıda denenen hâliyle", () => {
  const { params } = buildRequest(req(Small));
  assert.deepEqual(Object.keys(params), ["model", "max_tokens", "betas", "fallbacks", "output_config", "system", "messages"]);
  assert.deepEqual(params.output_config, { effort: "low", format: params.output_config!.format });
  assert.equal(buildRequest({ ...req(Small), model: AI_MODEL }).params.model, "claude-opus-5-5");
});

test("kasa istekleri (yazarkasa Z kapısı, dalga 13 PR-a): biçim aynı; yalnız istem metni ve belge türü listesi değişti", () => {
  const z = buildRequest({ image: IMAGE, system: SYSTEM, task: Z_TASK("2026-10-21"), schema: KasaZRaw });
  const pos = buildRequest({ image: IMAGE, system: SYSTEM, task: POS_TASK("2026-10-21"), schema: KasaPosRaw });
  for (const { params, options } of [z, pos]) {
    assert.deepEqual(Object.keys(params), ["model", "max_tokens", "betas", "fallbacks", "output_config", "system", "messages"]);
    assert.equal(params.model, "claude-opus-5-5");
    assert.equal(params.max_tokens, 6000);
    assert.deepEqual(params.output_config, { effort: "low", format: params.output_config!.format });
    assert.equal(params.system, SYSTEM);
    assert.deepEqual([options.timeout, options.maxRetries], [20_000, 1]);
    const content = params.messages[0].content as { type: string }[];
    assert.deepEqual(content.map((b) => b.type), ["image", "text"]);
  }
  const taskOf = (r: typeof z) => (r.params.messages[0].content as { type: string; text?: string }[])[1].text!;
  // ModPOS bölümü: yazarkasanın Z'si fiscal_z_report; BİLGİ FİŞİ / MALİ DEĞERİ YOKTUR basan ModPOS raporu mali değildir
  assert.match(taskOf(z), /^This should be the café's ModPOS end-of-day Z report/);
  assert.match(taskOf(z), /- If the paper is the cash register's fiscal Z \(MF logo with a registry number, EKÜ NO, KÜM\. \/ KÜMÜLATİF lines, Z NO \/ Z SAYAÇ\), set documentType fiscal_z_report\./);
  assert.match(taskOf(z), /BİLGİ FİŞİ or MALİ DEĞERİ YOKTUR; neither makes it fiscal\.$/);
  // Kart bölümü: yazarkasanın Z'si fiscal_z_report, fişin alanları boş
  assert.match(taskOf(pos), /^This should be the end-of-day slip/);
  assert.match(taskOf(pos), /set documentType fiscal_z_report and leave the slip fields null\.$/);
  const docTypes = (r: typeof z) => {
    const schema = (r.params.output_config?.format as { schema: Record<string, unknown> }).schema;
    return (schema.properties as Record<string, { enum: string[] }>).documentType.enum;
  };
  assert.ok(docTypes(z).includes("fiscal_z_report") && docTypes(z).includes("z_report"));
  assert.ok(docTypes(pos).includes("fiscal_z_report") && docTypes(pos).includes("bank_pos_end_of_day"));
});

test("fatura hata metinleri: fotoğrafa özgü olanlar faturaya göre, ortak olanlar aynı", () => {
  assert.equal(aiErrorText("nokey", undefined, "fatura"), "Faturadan okuma bu ortamda kurulu değil; faturayı açıp bakın.");
  assert.equal(aiErrorText("off", undefined, "fatura"), "Okuma kapalı (Ayarlar › Fotoğraftan okuma); faturayı açıp bakın.");
  assert.equal(aiErrorText("cap", 40, "fatura"), "Bugünkü okuma sınırı doldu (40); faturayı açıp bakın.");
  assert.equal(aiErrorText("invalid", undefined, "fatura"), "Faturadaki bilgi güvenilir okunamadı; faturayı açıp bakın.");
  assert.equal(aiErrorText("rate", undefined, "fatura"), aiErrorText("rate"));
  for (const c of ["nokey", "off", "cap", "timeout", "toolarge", "badrequest", "refusal", "invalid"] as const) {
    assert.doesNotMatch(aiErrorText(c, 40, "fatura"), /Fotoğraf (eklendi|çok|okunamadı)|yeniden çekin|rakamları elle/, c);
  }
  // Fotoğraf metinleri olduğu gibi
  assert.equal(aiErrorText("nokey"), "Fotoğraftan okuma bu ortamda kurulu değil; rakamları elle yazın.");
});

test("costUsd: Haiku 5.5 (0,10 / 0,50 $; 100 bin token üstü istem 0,50 / 2,50 $)", () => {
  const rec = JSON.parse(readFileSync(join(__dirname, "fixtures", "fatura", "bardak.json"), "utf8")) as { usage: AiMessage["usage"] };
  const c = costUsd(rec.usage, AI_INVOICE_MODEL);
  assert.equal(c.priceKnown, true);
  assert.equal(c.usd, 0.000505); // 2950 × 0,10 + 420 × 0,50
  assert.equal(costUsd({ input_tokens: 100_000, output_tokens: 1000 }, AI_INVOICE_MODEL).usd, 0.0105);
  assert.equal(costUsd({ input_tokens: 200_000, output_tokens: 1000 }, AI_INVOICE_MODEL).usd, 0.1025);
  // Önbellekten okunan da istemin parçası
  assert.equal(costUsd({ input_tokens: 1000, output_tokens: 0, cache_read_input_tokens: 100_000 }, AI_INVOICE_MODEL).usd, 0.0055);
  assert.deepEqual(priceOf("claude-haiku-5-5")?.input, 0.1);
  // Opus 5.5 tek fiyat kartı (uzun istemde değişmez)
  assert.equal(costUsd({ input_tokens: 200_000, output_tokens: 0 }, AI_MODEL).usd, 0.8);
});

test("yazarkasa Z isteği (dalga 13 PR-b): efor low, 8000 token, tek 50 sn'lik deneme; biçim öteki okumalarla aynı", async () => {
  assert.equal(OKC_EFFORT, "low");
  assert.equal(OKC_MAX_TOKENS, 8000);
  assert.deepEqual(OKC_TIMEOUTS, { timeout: 50_000, maxRetries: 1, totalMs: 50_000 });
  const okcReq = { image: IMAGE, system: SYSTEM, task: OKC_TASK("2026-10-24"), schema: KasaOkcRaw, effort: OKC_EFFORT, maxTokens: OKC_MAX_TOKENS, timeouts: OKC_TIMEOUTS };
  const { params, options } = buildRequest(okcReq);
  assert.deepEqual(Object.keys(params), ["model", "max_tokens", "betas", "fallbacks", "output_config", "system", "messages"]);
  assert.equal(params.model, "claude-opus-5-5");
  assert.equal(params.max_tokens, 8000);
  assert.deepEqual(params.betas, [AI_FALLBACK_BETA]);
  // KasaOkcRaw yapılandırılmış çıktının sınırını aşar (42 birleşim türlü parametre > 16): format yok, şema metinde
  assert.deepEqual(params.output_config, { effort: "low" });
  for (const key of ["temperature", "top_p", "top_k", "thinking"]) assert.equal(key in params, false, key);
  assert.deepEqual([options.timeout, options.maxRetries], [50_000, 1]);
  const okcText = (params.messages[0].content as { type: string; text?: string }[])[1].text!;
  assert.match(okcText, /^This should be the fiscal Z report/);
  assert.ok(okcText.startsWith(`${OKC_TASK("2026-10-24")}\n\n`));
  assert.ok(okcText.endsWith(JSON_REPLY(claudeSchema(KasaOkcRaw))));
  const docTypes = (JSON.parse(okcText.slice(okcText.lastIndexOf("\n") + 1)) as { properties: Record<string, { enum: string[] }> }).properties.documentType.enum;
  assert.deepEqual(docTypes, ["z_report", "x_report", "period_report", "batch_slip", "software_z", "other"]);

  // "medium" yalnız değerlendirmenin kararıyla; istek onu aynen taşır
  assert.equal(buildRequest({ ...okcReq, effort: "medium" }).params.output_config?.effort, "medium");
  // İstemciye giden seçenekler (runExtraction aynı isteği kurar)
  const { calls, client } = fake({ content: [text("{}")] });
  await runExtraction(client, okcReq);
  assert.equal(calls[0].options.timeout, 50_000);
  assert.equal(calls[0].params.max_tokens, 8000);

  // Öteki okumalar değişmedi: efor ve süre verilmezse modelin varsayılanı
  const plain = buildRequest({ image: IMAGE, system: SYSTEM, task: Z_TASK("2026-10-24"), schema: KasaZRaw });
  assert.equal(plain.params.output_config?.effort, "low");
  assert.equal(plain.params.max_tokens, 6000);
  assert.deepEqual([plain.options.timeout, plain.options.maxRetries], [20_000, 1]);
  const invoice = buildRequest({ model: AI_INVOICE_MODEL, image: IMAGE, system: "S", task: "T", schema: Small });
  assert.equal(invoice.params.output_config?.effort, "medium");
});

// ---------------------------------------------------------------- yazarkasa Z: kayıtlı yanıtlar ve sunucu yolu (b3)

/** Ölçüsü verilen PNG başlığı (imageSize yalnız başlığa bakar): kayıtlı yanıt görselin ölçüsüne göre seçilir */
function pngOf(width: number, height: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

test("kayıtlı yazarkasa yanıtları (sentetik) KasaOkcRaw'dan geçer", async () => {
  for (const name of ["okc", "okc-batch", "okc-yanlis-toplam", "okc-tek-oran"]) {
    const rec = fixture(name);
    const res = await runExtraction(fake({ content: [text(JSON.stringify(rec.json))], usage: rec.usage }).client, req(KasaOkcRaw));
    assert.equal(res.ok, true, name);
  }
});

test("AI_REPLAY: kasa-okc görsele göre yanıt seçer; yalnız next dev'de açılır", async () => {
  assert.equal(replayEnabled({ NODE_ENV: "development", AI_REPLAY: "1" }), true);
  assert.equal(replayEnabled({ NODE_ENV: "production", AI_REPLAY: "1" }), false);
  const doc = (size: { width: number; height: number } | null) => (replayAnswer("kasa-okc", size).json as { documentType: string }).documentType;
  assert.equal(doc({ width: 731, height: 1600 }), "z_report"); // yazarkasa-z.jpg
  assert.equal(doc({ width: 768, height: 965 }), "batch_slip"); // banka gün sonu fişi: yedek alan
  assert.equal(doc({ width: 864, height: 1390 }), "software_z"); // ModPOS Z'si: ModPOS bölümüne okut
  assert.equal(doc({ width: 864, height: 1069 }), "other");
  assert.equal(doc(null), "z_report");
  // İstemcinin kendisi: görselin ölçüsü istekteki base64'ten okunur, yanıt şemadan geçer
  const res = await runExtraction(replayClient("kasa-okc"), { image: { bytes: pngOf(768, 965), mediaType: "image/png" }, system: SYSTEM, task: OKC_TASK("2026-10-21"), schema: KasaOkcRaw, effort: OKC_EFFORT, maxTokens: OKC_MAX_TOKENS, timeouts: OKC_TIMEOUTS });
  assert.equal(res.ok, true);
  assert.equal(res.ok && res.data.documentType, "batch_slip");
  assert.equal(res.requestId, "kayitli-yanit");
});

test("sunucu yolu (AI_REPLAY yanıtlarıyla): yazarkasa okuması, personelin yanıtı, eski kasa-pos sayfasının yanıtı", () => {
  const DAY = "2026-10-21";
  const ctx = { day: DAY, prev: { z: null, cum: null } };
  const read = (name: string) => normalizeOkc(KasaOkcRaw.parse(fixture(name).json), ctx);
  const empty = Object.fromEntries((["okcZNo", "okcReceipts", "okcTotal", "okcVatTotal", "okcCash", "okcCard", "okcMealCard", "okcOther", "okcT1", "okcV1", "okcT10", "okcV10", "okcT20", "okcV20", "bankPos"] as ReadField[]).map((f) => [f, ""]));

  // Örnek Z: iki oran ve üç ödeme türü toplamı doğrular; kümülatif ve fiş iptali yalnız yöneticide
  const full = read("okc");
  assert.equal(full.kind, "kasa-okc");
  assert.equal(full.values.okcTotal?.value, 12300);
  assert.equal(full.values.okcTotal?.status, "confirmed");
  assert.equal(full.values.okcCard?.value, 8480);
  assert.equal(full.okcAdmin?.cumTotal, 1_259_350);
  assert.ok(full.checks.some((c) => c.admin));
  const staff = toStaffReading(full);
  assert.equal("okcAdmin" in staff, false);
  assert.equal(staff.checks.some((c) => c.admin), false);
  assert.doesNotMatch(JSON.stringify(staff), /1259350|1\.259\.350|kümülatif/i);

  // Doldurma kapalı (sahibin kararı bekleniyor): hiçbir alan dolmaz, hepsi öneri
  assert.equal(OKC_PREFILL_ENABLED, false);
  const off = prefillPlan(staff, empty);
  assert.deepEqual(off.fill, []);
  assert.ok(off.unsure.some((u) => u.field === "okcTotal" && u.reason === OKC_SUGGEST_TEXT));
  assert.equal(off.unsure.length, Object.keys(staff.values).length);
  // Açılınca doğrulanan alan mavi dolar
  assert.ok(prefillPlan(staff, empty, { okcPrefill: true }).fill.some((f) => f.field === "okcTotal" && f.warn === null));

  // Yanlış okunmuş toplam tutmaz; tek oranlı günde toplam "doğrulandı" olmaz (aynı rakamın kopyaları)
  assert.equal(read("okc-yanlis-toplam").values.okcTotal?.status, "failed");
  assert.notEqual(read("okc-tek-oran").values.okcTotal?.status, "confirmed");

  // Eski sayfa (kasa-pos): yazarkasa Z'sinin toplamı ya da kartı asla; banka gün sonu yoksa PR-a'nın yönergesi
  const legacyZ = okcToLegacyPos(staff);
  assert.equal(legacyZ.kind, "kasa-pos");
  assert.equal(legacyZ.advice, true);
  assert.equal(legacyZ.error, FISCAL_Z_CARD_TEXT);
  assert.deepEqual(legacyZ.values, {});
  // Banka gün sonu fişi: yalnız bankPos, doldurma kapalıyken öneri (eski sayfanın prefillPlan'ı düşük güveni yazmaz)
  const legacyBatch = okcToLegacyPos(toStaffReading(read("okc-batch")));
  assert.equal(legacyBatch.kind, "kasa-pos");
  assert.deepEqual(Object.keys(legacyBatch.values), ["bankPos"]);
  assert.equal(legacyBatch.values.bankPos?.value, 8915);
  assert.equal(legacyBatch.values.bankPos?.confidence, "low");
  assert.deepEqual(prefillPlan(legacyBatch, { bankPos: "" }).fill, []);
  assert.equal(prefillPlan(legacyBatch, { bankPos: "" }).unsure[0]?.reason, OKC_SUGGEST_TEXT);
  assert.equal(legacyBatch.checks.every((c) => c.fields.length > 0 && c.fields.every((f) => f === "bankPos")), true);
  const on = okcToLegacyPos(toStaffReading(read("okc-batch")), { okcPrefill: true });
  assert.deepEqual(on.values.bankPos, { value: 8915, confidence: "high" });
  assert.deepEqual(prefillPlan(on, { bankPos: "" }).fill, [{ field: "bankPos", text: "8915", warn: null }]);
  // ModPOS Z'si yazarkasa bölümüne: eski sayfada da ModPOS bölümüne okutulur
  const soft = okcToLegacyPos(normalizeOkc(KasaOkcRaw.parse(replayAnswer("kasa-okc", { width: 864, height: 1390 }).json), ctx));
  assert.deepEqual([soft.kind, soft.ok, soft.switchTo], ["kasa-pos", false, "kasa-z"]);
});

// ---------------------------------------------------------------- yapılandırılmış çıktının sınırı ve 400'ün günlüğü

test("yapılandırılmış çıktı sınırı (en çok 16 birleşim türlü, 24 isteğe bağlı parametre): yalnız yazarkasa Z'si aşar", () => {
  assert.deepEqual(STRUCTURED_OUTPUT_LIMITS, { unionParams: 16, optionalParams: 24 });
  // Canlıda kabul edilen şemalar sınırın içinde ve format ile gider; isteklerin biçimi değişmez
  const sent: [string, z.ZodType, number][] = [
    ["Z", KasaZRaw, 14],
    ["banka gün sonu", KasaPosRaw, 11],
    ["fiş", ReceiptRaw, 14],
    ["fatura", InvoiceReadingRaw, 8],
  ];
  for (const [name, schema, unions] of sent) {
    const json = claudeSchema(schema);
    assert.deepEqual(schemaComplexity(json), { unionParams: unions, optionalParams: 0 }, name);
    assert.equal(fitsStructuredOutputs(json), true, name);
    const { params } = buildRequest({ image: IMAGE, system: SYSTEM, task: "GÖREV", schema });
    assert.equal(params.output_config?.format?.type, "json_schema", name);
    assert.deepEqual((params.messages[0].content as { text?: string }[])[1], { type: "text", text: "GÖREV" }, name);
  }
  const receipt = buildRequest({ image: IMAGE, system: SYSTEM, task: RECEIPT_TASK("2026-10-24", []), schema: ReceiptRaw }).params;
  assert.equal(receipt.output_config?.format?.type, "json_schema");
  // Yazarkasa Z'si: her Amount'un text ve value'su null alabilir; 42 birleşim türlü parametre
  assert.deepEqual(schemaComplexity(claudeSchema(KasaOkcRaw)), { unionParams: 42, optionalParams: 0 });
  assert.equal(fitsStructuredOutputs(claudeSchema(KasaOkcRaw)), false);

  // Sayım: tür dizisi ve anyOf birer parametre; required dışı alan isteğe bağlı; "anyOf" adlı alan anahtar sözcük değil
  const nullable = (n: number) => z.object(Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, z.string().nullable()])));
  assert.equal(fitsStructuredOutputs(claudeSchema(nullable(16))), true);
  assert.equal(fitsStructuredOutputs(claudeSchema(nullable(17))), false);
  const optional = (n: number) => z.object(Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, z.string().optional()])));
  assert.deepEqual(schemaComplexity(claudeSchema(optional(24))), { unionParams: 0, optionalParams: 24 });
  assert.equal(fitsStructuredOutputs(claudeSchema(optional(25))), false);
  assert.deepEqual(schemaComplexity(claudeSchema(z.object({ anyOf: z.string(), type: z.number().int().nullable() }))), { unionParams: 1, optionalParams: 0 });
  // Sınırı aşan her şema format olmadan gider (yazarkasa Z'sine özgü değil)
  assert.deepEqual(buildRequest({ image: IMAGE, system: "S", task: "T", schema: nullable(17) }).params.output_config, { effort: "low" });
});

test("format olmadan okunan yanıt: çitli ya da cümleli JSON da okunur, şemadan geçer; format'lı istekte eskisi gibi", async () => {
  const rec = fixture("okc");
  const okcReq = { image: IMAGE, system: SYSTEM, task: OKC_TASK("2026-10-24"), schema: KasaOkcRaw, effort: OKC_EFFORT, maxTokens: OKC_MAX_TOKENS, timeouts: OKC_TIMEOUTS };
  const body = JSON.stringify(rec.json);
  for (const answer of [body, `\`\`\`json\n${body}\n\`\`\``, `Here is the JSON:\n${body}\n`]) {
    const res = await runExtraction(fake({ content: [text(answer)], usage: rec.usage }).client, okcReq);
    assert.equal(res.ok, true, answer.slice(0, 20));
    assert.deepEqual(res.ok && res.data, KasaOkcRaw.parse(rec.json));
  }
  const prose = await runExtraction(fake({ content: [text("Toplam okunamadı.")] }).client, okcReq);
  assert.equal(!prose.ok && prose.code, "invalid");
  const partial = await runExtraction(fake({ content: [text('{"documentType": "z_report"}')] }).client, okcReq);
  assert.equal(!partial.ok && partial.code, "invalid");
  // Yapılandırılmış çıktılı istekte yanıt saf JSON'dur; çitli metin eskisi gibi okunmaz
  const fenced = await runExtraction(fake({ content: [text('```json\n{"total": 1, "kind": "a"}\n```')] }).client, req(Small));
  assert.equal(!fenced.ok && fenced.code, "invalid");
});

test("400 / 401 / 402 günlük satırı: API'nin hata metni var; görsel, istem, görev ve yanıt gövdesinin JSON'u yok", async () => {
  // SDK'nın canlıdaki hâli: gövde JSON, mesaj yok (APIError.message = "400 " + gövdenin JSON'u)
  const apiMessage = "output_config.format.schema: example reason from the API";
  const body = { type: "error", error: { type: "invalid_request_error", message: apiMessage }, request_id: "req_test400" };
  const err = Anthropic.APIError.generate(400, body, undefined, new Headers({ "request-id": "req_test400" }));
  assert.ok(err instanceof Anthropic.BadRequestError);
  assert.match(err.message, /^400 \{"type":"error"/);
  // Ayırt edilebilir görsel: base64'ü günlükte aranır
  const bytes = new Uint8Array(3000).map((_, i) => (i * 37 + 11) % 256);
  const image = { bytes, mediaType: "image/jpeg" as const };
  const base64 = Buffer.from(bytes).toString("base64");
  const task = OKC_TASK("2026-10-24");
  const res = await runExtraction(fake(err).client, { image, system: SYSTEM, task, schema: KasaOkcRaw, effort: OKC_EFFORT, maxTokens: OKC_MAX_TOKENS, timeouts: OKC_TIMEOUTS });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.code, "badrequest");
  assert.equal(res.detail, `BadRequestError 400: invalid_request_error: ${apiMessage}`);

  const line = aiAlertLog("kasa-okc", res);
  assert.equal(line, `kasa-okc badrequest 400 req_test400 · BadRequestError 400: invalid_request_error: ${apiMessage}`);
  for (const leak of [base64, base64.slice(0, 40), SYSTEM.slice(0, 60), task.slice(0, 60), '"type":"error"', "Reply with one JSON object"]) {
    assert.ok(!line!.includes(leak), `günlükte: ${leak.slice(0, 30)}`);
  }

  // Anahtar ve kredi de günlüğe; uzun API metni 300 karakterde kesilir; JSON olmayan gövde olduğu gibi (yanıtın metni)
  const auth = mapAiError(Anthropic.APIError.generate(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, undefined, new Headers({ "request-id": "req_401" })));
  assert.equal(aiAlertLog("fis", { ...auth, code: "auth" }), "fis auth 401 req_401 · AuthenticationError 401: authentication_error: invalid x-api-key");
  const billing = mapAiError(Anthropic.APIError.generate(402, { type: "error", error: { type: "billing_error", message: "credit balance too low" } }, undefined, new Headers()));
  assert.equal(aiAlertLog("fatura", billing), "fatura billing 402 - · APIError 402: billing_error: credit balance too low");
  const long = mapAiError(Anthropic.APIError.generate(400, { type: "error", error: { type: "invalid_request_error", message: "x".repeat(1000) } }, undefined, new Headers()));
  assert.equal(long.detail.length, 300);
  const html = mapAiError(Anthropic.APIError.generate(400, undefined, "<html>Bad Request</html>", new Headers()));
  assert.equal(html.detail, "BadRequestError 400: 400 <html>Bad Request</html>");

  // Öteki kodlar günlüğe bu satırla düşmez
  for (const code of ["rate", "overloaded", "timeout", "connection", "toolarge", "refusal", "invalid", "incomplete"] as const) {
    assert.equal(aiAlertLog("kasa-z", { code, status: null, requestId: null, detail: "x" }), null, code);
  }
  // claude.ts günlüğe bu satırı yazar (eskiden yalnız kod, durum ve istek kimliği)
  const src = readFileSync(join(__dirname, "..", "src", "server", "ai", "claude.ts"), "utf8");
  assert.match(src, /const alert = aiAlertLog\(req\.feature, res\);\n\s*if \(alert\) console\.error\(tag, alert\);/);
  assert.doesNotMatch(src, /console\.error\(tag, res\.code/);
});
