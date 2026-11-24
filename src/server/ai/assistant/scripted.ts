/**
 * Hazır bir yanıtı gerçek akış gibi olay olay veren akış (saf): geliştirmedeki kayıtlı yanıtlar
 * (src/server/ai/replay.ts replayAssistantClient) ve testlerin sahte istemcisi (tests/panel-asistani.test.ts) kullanır.
 * Olaylar Messages API'nin akışındakilerle aynı sırada: message_start → her blok için content_block_start / delta /
 * stop → message_delta (stop_reason, kullanım) → message_stop. İptal sinyali gelince SDK gibi APIUserAbortError atar.
 */

import Anthropic from "@anthropic-ai/sdk";

import type { AssistantStream } from "./loop";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type StreamEvent = Anthropic.Beta.Messages.BetaRawMessageStreamEvent;

export interface ScriptOptions {
  signal?: AbortSignal;
  /** Parçalar arası bekleme (ms; geliştirmede yazıyor gibi görünsün) */
  delayMs?: number;
  /** Metnin parça boyu (karakter) */
  chunk?: number;
  /** Bu kadar olaydan sonra akış bu hatayla kesilir (bağlantı kopması, sunucu hatası) */
  failAfter?: { events: number; error: Error };
  requestId?: string;
}

const ev = (e: Record<string, unknown>) => e as unknown as StreamEvent;

/** Yanıtın olayları */
export function scriptEvents(message: BetaMessage, chunk = 24): StreamEvent[] {
  const out: StreamEvent[] = [ev({ type: "message_start", message: { ...message, content: [], stop_reason: null, stop_details: null, usage: { ...message.usage, output_tokens: 1 } } })];
  message.content.forEach((block, index) => {
    if (block.type === "text") {
      out.push(ev({ type: "content_block_start", index, content_block: { type: "text", text: "", citations: null } }));
      for (let i = 0; i < block.text.length; i += chunk) out.push(ev({ type: "content_block_delta", index, delta: { type: "text_delta", text: block.text.slice(i, i + chunk) } }));
    } else if (block.type === "tool_use") {
      out.push(ev({ type: "content_block_start", index, content_block: { ...block, input: {} } }));
      out.push(ev({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } }));
    } else {
      out.push(ev({ type: "content_block_start", index, content_block: block }));
    }
    out.push(ev({ type: "content_block_stop", index }));
  });
  out.push(
    ev({
      type: "message_delta",
      delta: { stop_reason: message.stop_reason, stop_sequence: null, stop_details: message.stop_details ?? null, container: null },
      usage: { ...message.usage },
      context_management: null,
    }),
  );
  out.push(ev({ type: "message_stop" }));
  return out;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Anthropic.APIUserAbortError());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Anthropic.APIUserAbortError());
      },
      { once: true },
    );
  });
}

export function scriptedStream(message: BetaMessage, opts: ScriptOptions = {}): AssistantStream {
  const events = scriptEvents(message, opts.chunk);
  let done: Promise<BetaMessage> | null = null;
  let iterated = false;
  const run = async function* (): AsyncGenerator<StreamEvent> {
    let n = 0;
    for (const e of events) {
      if (opts.signal?.aborted) throw new Anthropic.APIUserAbortError();
      if (opts.failAfter && n >= opts.failAfter.events) throw opts.failAfter.error;
      if (opts.delayMs) await sleep(opts.delayMs, opts.signal);
      n++;
      yield e;
    }
  };
  let failure: unknown = null;
  return {
    request_id: opts.requestId ?? "req_kayitli",
    async *[Symbol.asyncIterator]() {
      iterated = true;
      try {
        yield* run();
      } catch (e) {
        failure = e;
        throw e;
      }
    },
    finalMessage() {
      done ??= (async () => {
        if (!iterated) for await (const _ of run()) void _;
        if (failure) throw failure;
        if (opts.signal?.aborted) throw new Anthropic.APIUserAbortError();
        return message;
      })();
      return done;
    },
  };
}

/** Testlerde ve kayıtlı yanıtlarda yanıt kurucusu: eksik alanlar doldurulur */
export function scriptedMessage(
  partial: Omit<Partial<BetaMessage>, "usage"> & Pick<BetaMessage, "content" | "stop_reason"> & { usage?: Partial<Anthropic.Beta.Messages.BetaUsage> },
): BetaMessage {
  const { usage, ...rest } = partial;
  return {
    id: "msg_kayitli",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    container: null,
    context_management: null,
    diagnostics: null,
    stop_details: null,
    stop_sequence: null,
    ...rest,
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: null, cache_read_input_tokens: null, ...usage },
  } as BetaMessage;
}
