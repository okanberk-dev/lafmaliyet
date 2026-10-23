/**
 * Fotoğraftan okumanın maliyeti (saf; tests/ai-istemci.test.ts). Fiyatlar dolar / milyon token; yedek model çalıştıysa
 * (server-side fallback) o denemenin kendi modelinin fiyatıyla. `usage.iterations` her denemeyi ayrı verir (model null:
 * istenen model); yoksa üst düzey kullanım. Anthropic dolar üzerinden faturalar; tutarlar yaklaşıktır.
 */

export interface ModelPrice {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export const PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
};

export interface IterationLike {
  type: string;
  model?: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  iterations?: IterationLike[] | null;
}

export interface CostResult {
  usd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Yedek model çalıştı */
  fallback: boolean;
  /** Bilinmeyen model: Opus 5.5 fiyatıyla sayıldı */
  priceKnown: boolean;
}

/** Modelin fiyatı: tam ad, yoksa tarihli sürümün ön eki (en uzun eşleşen); bilinmiyorsa null */
export function priceOf(model: string): ModelPrice | null {
  if (PRICES[model]) return PRICES[model];
  const key = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => model.startsWith(`${k}-`));
  return key ? PRICES[key] : null;
}

export function costUsd(usage: UsageLike, requestedModel: string): CostResult {
  const attempts: IterationLike[] = usage.iterations?.length ? usage.iterations : [{ type: "message", model: null, ...usage }];
  let usd = 0;
  let priceKnown = true;
  const totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  for (const it of attempts) {
    const model = it.model ?? requestedModel;
    let price = priceOf(model);
    if (!price) {
      priceKnown = false;
      price = PRICES["claude-opus-5-5"];
    }
    const read = it.cache_read_input_tokens ?? 0;
    const write = it.cache_creation_input_tokens ?? 0;
    usd += (it.input_tokens * price.input + it.output_tokens * price.output + read * price.cacheRead + write * price.cacheWrite) / 1_000_000;
    totals.inputTokens += it.input_tokens;
    totals.outputTokens += it.output_tokens;
    totals.cacheReadTokens += read;
    totals.cacheWriteTokens += write;
  }
  return { usd: Math.round(usd * 1e6) / 1e6, ...totals, fallback: attempts.some((i) => i.type === "fallback_message"), priceKnown };
}
