// Claude ile okuma, sahte istemciyle: isteğin biçimi (canlıda denenmiş hâli), yanıtın denetimi (ret, yarım, bozuk
// JSON, şema), yedek modelin bloğu, SDK hatalarının Türkçe karşılığı ve maliyet (src/server/ai/run.ts, pricing.ts);
// fatura okumasının Haiku 5.5 + PDF isteği (yedek model yok). Anahtar gerekmez; ağ yok.
// Çalıştırma: npx tsx --test tests/ai-istemci.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { OKC_TASK, POS_TASK, SYSTEM, Z_TASK } from "../src/lib/photo-read/prompts";
import { KasaOkcRaw, KasaPosRaw, KasaZRaw, ReceiptRaw } from "../src/lib/photo-read/schemas";
import { costUsd, priceOf } from "../src/server/ai/pricing";
import {
  AI_FALLBACK_BETA,
  AI_INVOICE_MODEL,
  AI_MODEL,
  aiErrorText,
  buildRequest,
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
  assert.deepEqual(params.output_config, { effort: "low", format: params.output_config!.format });
  for (const key of ["temperature", "top_p", "top_k", "thinking"]) assert.equal(key in params, false, key);
  assert.deepEqual([options.timeout, options.maxRetries], [50_000, 1]);
  assert.match((params.messages[0].content as { type: string; text?: string }[])[1].text!, /^This should be the fiscal Z report/);
  const docTypes = ((params.output_config?.format as { schema: Record<string, unknown> }).schema.properties as Record<string, { enum: string[] }>).documentType.enum;
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
