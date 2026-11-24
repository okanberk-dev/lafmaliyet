/**
 * Panel asistanının konuşma döngüsü (saf: veritabanı ve "server-only" yok; istemci dışarıdan verilir,
 * tests/panel-asistani.test.ts sahte istemciyle sınar, geliştirmede kayıtlı yanıtlar: src/server/ai/replay.ts).
 * Kapılar, günlük sınır ve ai_calls kaydı src/server/ai/claude.ts'te; uç src/app/api/asistan/route.ts.
 *
 * İstek (docs/ASISTAN.md): Messages API, akışlı (`client.beta.messages.stream`), claude-sonnet-5-5, efor "medium" (çok
 * adımlı araç kullanımı için önerilen başlangıç; yanıtlar istemde kısa tutulur), reddedilirse sunucu tarafında yedek
 * model (beta server-side-fallback-2026-07-01, `fallbacks: "default"`). Gönderilmeyenler: `thinking` (Sonnet 5.5'te
 * düşünme uyarlamalı ve varsayılan; `{type: "disabled"}` 400), temperature / top_p / top_k (400), asistan ön
 * doldurması (400), zorunlu araç (`tool_choice` "any" / "tool" 400; araç turu bitince yalnız "none").
 *
 * Önbellek: araçlar → sabit sistem istemi (cache_control) → değişken bağlam (tarih, şube; işaretsiz) → mesajlar
 * (üst düzey otomatik önbellek: araç turlarında konuşmanın öncesi önbellekten okunur).
 *
 * Döngü elle yazıldı (SDK'nın toolRunner'ı yerine): araç turu sınırı, süre sınırı, araç başına durum olayı, her turun
 * maliyeti ve sahte istemciyle sınama bu sürümde elle daha açık. Bir istekte en çok ASSISTANT_TIMING.maxToolRounds araç
 * turu; sınır dolunca ya da süre (softMs) geçince son çağrı `tool_choice: none` ile yapılır, Claude eldeki bilgiyle
 * yanıtlar. Kesin süre (hardMs) dolarsa akış kesilir, o ana kadar gelen yanıt kalır.
 *
 * Geçmiş ve düşünme blokları (shared/model-migration.md › Migrating to Claude Sonnet 5.5 › Breaking change 3 ve
 * Migrating to Claude Fable 5.1 from Claude Fable 5 › Breaking change 3): Sonnet 5.5 düşünme bloğunun imzasına onu
 * üreten konuşmanın önünü (system, tools, önceki mesajlar) bağlar; sonradan değişen önü taşıyan blok 400 alır. Önceki
 * turlar tarayıcıdan yalnız görünen metin olarak gelir: hiçbirinde düşünme bloğu yoktur ("hepsini çıkarmak" belgeye
 * göre geçerli), denetlenecek blok kalmaz. Tek istek içindeki araç döngüsünde ise asistanın içeriği (düşünme blokları
 * dahil) DEĞİŞTİRİLMEDEN geri gönderilir, mesajlar yalnız sona eklenir; bütün araç sonuçları tek kullanıcı mesajında.
 * Tek istisna yedek modelin sınırıdır (echoContent).
 */

import Anthropic from "@anthropic-ai/sdk";

import { ASSISTANT_DEEP_WEIGHT, type AssistantDone, type AssistantEvent, type AssistantTurn } from "@/lib/assistant/protocol";

import { costUsd, type UsageLike } from "../pricing";
import { AI_FALLBACK_BETA, aiErrorText, mapAiError, type AiErrorCode } from "../run";
import { runToolUse, toolParams, type AssistantTool, type ToolContext } from "./tool-adapter";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaContentBlock = Anthropic.Beta.Messages.BetaContentBlock;
/** İsteğin gövdesi (akış: `stream()` bunu `stream: true` ile gönderir) */
export type AssistantParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

export const ASSISTANT_MODEL = "claude-sonnet-5-5";
/** Çok adımlı araç kullanımı için önerilen başlangıç (Sonnet 5.5'te varsayılan "high"; kısa sohbet yanıtı için yeter) */
export const ASSISTANT_EFFORT = "medium" as const;
/** Düşünme + yanıt (düşünme de bu sınıra sayılır); yanıtlar istemde kısa tutulur */
export const ASSISTANT_MAX_TOKENS = 8000;

/**
 * "Derin analiz" (docs/ASISTAN.md › Derin analiz; varsayılan kapalı, yönetici sorunun yanındaki anahtarla açar): efor
 * "high", araç turu sınırı 8 yerine 12, çıktı sınırı (düşünme dahil) 16.000. Süre sınırları aynı (rotanın 60 sn'si).
 *
 * Maliyet notu: high eforda model daha uzun düşünür ve daha çok araç turu açar; çıktı tokeni (10 $ / M) birkaç katına
 * çıkabilir. Üst düzey `effort` değişimi mesajların önbelleğini (bu modelde araç + sistem önekini de) geçersiz kılar:
 * derin soru öneki bir kez yeniden önbelleğe yazar (≈0,035–0,04 $), sonraki olağan soru medium önbelleğini (5 dk içinde
 * yazılmışsa) okur. Tahmini derin soru ≈ 0,06–0,15 $ (olağan ≈ 0,01–0,05 $). Bu yüzden günlük sınıra 2 soru sayılır
 * (`weight`; src/server/ai/claude.ts satırın eforundan sayar). Mesaj içi efor (beta mid-conversation-output-config)
 * önbelleği korurdu; anahtarsız ortamda denenemediği için kullanılmadı (docs/ASISTAN.md › Açık kalanlar).
 */
export const ASSISTANT_DEEP = { effort: "high" as const, maxToolRounds: 12, maxTokens: 16_000, weight: ASSISTANT_DEEP_WEIGHT };

export interface AssistantTiming {
  /** Bir istekte en çok araç turu */
  maxToolRounds: number;
  /** Bu süreden sonra yeni araç turu açılmaz: son çağrı araçsız, eldeki bilgiyle (ms) */
  softMs: number;
  /** Kesin sınır: akış kesilir (ms; rotanın maxDuration'ı 60 sn, kayıt için pay kalır) */
  hardMs: number;
  /** Tek çağrının denemesi (ms) ve yeniden deneme (bağlantı, 429, 5xx) */
  attemptMs: number;
  maxRetries: number;
}

export const ASSISTANT_TIMING: AssistantTiming = { maxToolRounds: 8, softMs: 35_000, hardMs: 50_000, attemptMs: 30_000, maxRetries: 1 };

/** Akışın kullandığımız yüzü (SDK'nın BetaMessageStream'i buna uyar) */
export interface AssistantStream extends AsyncIterable<Anthropic.Beta.Messages.BetaRawMessageStreamEvent> {
  finalMessage(): Promise<BetaMessage>;
  readonly request_id?: string | null;
}

export interface AssistantStreamOptions {
  signal: AbortSignal;
  timeout: number;
  maxRetries: number;
}

/** Asistanın istemcisi: gerçek SDK, testte sahte, geliştirmede kayıtlı yanıtlar */
export interface AssistantClient {
  beta: { messages: { stream(params: AssistantParams, options: AssistantStreamOptions): AssistantStream } };
}

/**
 * İsteğin kendisi (testte biçimi sınanır). `final`: araç turu bitti, yalnız yanıt (`tool_choice: none`). `deep`: derin
 * analiz (efor high, çıktı sınırı yüksek; ASSISTANT_DEEP)
 */
export function assistantParams(opts: { system: string; context: string; tools: Anthropic.Beta.Messages.BetaTool[]; messages: BetaMessageParam[]; final?: boolean; deep?: boolean }): AssistantParams {
  return {
    model: ASSISTANT_MODEL,
    max_tokens: opts.deep ? ASSISTANT_DEEP.maxTokens : ASSISTANT_MAX_TOKENS,
    betas: [AI_FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: opts.deep ? ASSISTANT_DEEP.effort : ASSISTANT_EFFORT },
    // Konuşmanın büyüyen kuyruğu (araç turları): otomatik önbellek işareti son bloğa
    cache_control: { type: "ephemeral" },
    tools: opts.tools,
    ...(opts.final ? { tool_choice: { type: "none" as const } } : {}),
    system: [
      { type: "text", text: opts.system, cache_control: { type: "ephemeral" } },
      { type: "text", text: opts.context },
    ],
    // Kopya: döngü sonraki turu bu diziye ekler (istek o zamana gönderilmiş olur; testte yakalanan istek de değişmesin)
    messages: [...opts.messages],
  };
}

/**
 * Önceki turlar (yalnız görünen metin) + yeni soru. Sonnet 5.5'in korunan düşünme kuralına uygun: geçmişte hiç düşünme
 * bloğu yoktur (tarayıcı yalnız metni tutar), API'nin "önceki mesajlar değişmedi mi" denetimi bağlanacak blok bulmaz;
 * düşünme blokları yalnız bu isteğin araç döngüsünde, değiştirilmeden geri gider (yukarıdaki dosya açıklaması).
 */
export function assistantMessages(history: readonly AssistantTurn[], message: string): BetaMessageParam[] {
  return [...history.map((t) => ({ role: t.role, content: t.text })), { role: "user" as const, content: message }];
}

/**
 * Geri gönderilecek asistan içeriği. Yedek model yanıtın ortasında devraldıysa (içerikte `fallback` bloğu): son
 * `fallback` bloğundan önceki düşünme, araç çağrısı ve tanınmayan bloklar atılır, metin ve `fallback` bloğu yerinde
 * kalır (shared/model-migration.md › refusal › Echoing fallback turns back). Yedek yoksa içerik olduğu gibi.
 */
export function echoContent(content: readonly BetaContentBlock[]): BetaContentBlock[] {
  const last = content.map((b) => b.type).lastIndexOf("fallback");
  if (last < 0) return [...content];
  return content.filter((b, i) => i >= last || b.type === "text");
}

const ZERO_COST = { costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, fallback: false, priceKnown: true };
export type AssistantCost = typeof ZERO_COST;

export interface AssistantOutcome {
  /** Bitiş nedeni; hata ya da retle bittiyse null */
  done: AssistantDone | null;
  error: { code: AiErrorCode; detail: string; status: number | null } | null;
  /** Bütün çağrıların toplamı (yedek modelin denemeleri kendi fiyatıyla) */
  cost: AssistantCost;
  servedModel: string | null;
  stopReason: string | null;
  requestId: string | null;
  apiCalls: number;
  toolCalls: number;
}

export interface AssistantRun {
  system: string;
  context: string;
  tools: readonly AssistantTool[];
  toolCtx: ToolContext;
  history: readonly AssistantTurn[];
  message: string;
  /** Derin analiz (ASSISTANT_DEEP): efor high, araç turu sınırı 12 */
  deep?: boolean;
  emit: (e: AssistantEvent) => void;
  /** Kullanıcı durdurdu (tarayıcı isteği kesti) */
  signal?: AbortSignal;
  timing?: Partial<AssistantTiming>;
  onToolError?: (tool: string, e: unknown) => void;
  /** Saat (testte) */
  clock?: () => number;
}

/** Kullanımı birleştirir: akış kesilirse o ana kadarki (message_start + message_delta) kullanım sayılır */
function mergeUsage(prev: UsageLike | null, next: Partial<Record<keyof UsageLike, unknown>>): UsageLike {
  const out: UsageLike = { ...(prev ?? { input_tokens: 0, output_tokens: 0 }) };
  for (const [k, v] of Object.entries(next)) if (v !== null && v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
  return out;
}

export async function runAssistant(client: AssistantClient, run: AssistantRun): Promise<AssistantOutcome> {
  const timing = { ...ASSISTANT_TIMING, ...(run.deep ? { maxToolRounds: ASSISTANT_DEEP.maxToolRounds } : {}), ...run.timing };
  const clock = run.clock ?? Date.now;
  const t0 = clock();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timing.hardMs);
  const signal = run.signal ? AbortSignal.any([run.signal, deadline.signal]) : deadline.signal;
  const tools = toolParams(run.tools);
  const labels = new Map(run.tools.map((t) => [t.name, t.label]));
  const messages = assistantMessages(run.history, run.message);
  const out: AssistantOutcome = { done: null, error: null, cost: { ...ZERO_COST }, servedModel: null, stopReason: null, requestId: null, apiCalls: 0, toolCalls: 0 };

  // Yanıt metni: bloklar ve turlar arasına paragraf boşluğu (yedek modelin devraldığı blok kaldığı yerden sürer)
  let tail = "";
  let gap = false;
  const emitText = (text: string) => {
    if (!text) return;
    if (gap && tail && !tail.endsWith("\n")) text = `\n\n${text}`;
    gap = false;
    tail = (tail + text).slice(-2);
    run.emit({ type: "text", text });
  };

  const addCost = (usage: UsageLike | null, model: string | null) => {
    if (!usage) return;
    const c = costUsd(usage, model ?? ASSISTANT_MODEL);
    const s = out.cost;
    out.cost = {
      costUsd: Math.round((s.costUsd + c.usd) * 1e6) / 1e6,
      inputTokens: s.inputTokens + c.inputTokens,
      outputTokens: s.outputTokens + c.outputTokens,
      cacheReadTokens: s.cacheReadTokens + c.cacheReadTokens,
      cacheWriteTokens: s.cacheWriteTokens + c.cacheWriteTokens,
      fallback: s.fallback || c.fallback,
      priceKnown: s.priceKnown && c.priceKnown,
    };
  };

  const finish = (done: AssistantDone | null, error: AssistantOutcome["error"] = null) => {
    out.done = done;
    out.error = error;
    clearTimeout(timer);
    return out;
  };

  try {
    let rounds = 0;
    for (;;) {
      const final = rounds >= timing.maxToolRounds || clock() - t0 > timing.softMs;
      const params = assistantParams({ system: run.system, context: run.context, tools, messages, final, deep: run.deep });
      out.apiCalls++;
      let usage: UsageLike | null = null;
      let model: string | null = null;
      let prevBlock: string | null = null;
      let message: BetaMessage;
      const stream = client.beta.messages.stream(params, { signal, timeout: timing.attemptMs, maxRetries: timing.maxRetries });
      try {
        for await (const ev of stream) {
          if (ev.type === "message_start") {
            usage = mergeUsage(null, ev.message.usage as unknown as Record<string, unknown>);
            model = ev.message.model;
          } else if (ev.type === "message_delta") {
            usage = mergeUsage(usage, ev.usage as unknown as Record<string, unknown>);
          } else if (ev.type === "content_block_start") {
            const type = ev.content_block.type;
            if (type === "text") gap = prevBlock !== "fallback";
            else if (type === "tool_use") run.emit({ type: "tool", name: ev.content_block.name, label: labels.get(ev.content_block.name) ?? ev.content_block.name });
            prevBlock = type;
          } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            emitText(ev.delta.text);
          }
        }
        message = await stream.finalMessage();
      } catch (e) {
        addCost(usage, model);
        out.servedModel = model ?? out.servedModel;
        out.requestId = stream.request_id ?? out.requestId;
        if (run.signal?.aborted) return finish("aborted");
        if (deadline.signal.aborted) return finish("deadline");
        throw e;
      }
      addCost(message.usage, message.model);
      out.servedModel = message.model;
      out.stopReason = message.stop_reason;
      out.requestId = stream.request_id ?? out.requestId;

      // Ret: içerik okunmaz, araç çalışmaz (yarım kalan araç çağrısı da)
      if (message.stop_reason === "refusal") {
        const category = message.stop_details?.category;
        return finish(null, { code: "refusal", detail: `refusal${category ? ` (${category})` : ""}`, status: null });
      }
      const uses = message.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
      if (message.stop_reason === "max_tokens") return finish("max_tokens");
      // Son çağrı araçsızdı (tur ya da süre sınırı): eldeki bilgiyle yanıtladı
      if (final) return finish("limit");
      if (message.stop_reason !== "tool_use" || !uses.length) return finish("end");

      messages.push({ role: "assistant", content: echoContent(message.content) });
      const results = await Promise.all(uses.map((u) => runToolUse(run.tools, u, { ctx: run.toolCtx, signal, onError: run.onToolError })));
      out.toolCalls += uses.length;
      if (run.signal?.aborted) return finish("aborted");
      if (deadline.signal.aborted) return finish("deadline");
      messages.push({ role: "user", content: results });
      rounds++;
    }
  } catch (e) {
    const m = mapAiError(e);
    out.requestId = m.requestId ?? out.requestId;
    return finish(null, { code: m.code, detail: m.detail, status: m.status });
  }
}

/** Hatanın yöneticiye gösterilen metni */
export const assistantErrorText = (code: AiErrorCode, cap?: number) => aiErrorText(code, cap, "asistan");
