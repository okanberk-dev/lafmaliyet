/**
 * Fotoğraftan ve faturadan okumanın, vardiya taslağının ve ürün önerisinin maliyeti (saf; tests/ai-istemci.test.ts).
 * Fiyatlar dolar / milyon token; yedek model çalıştıysa (server-side fallback) o denemenin kendi modelinin fiyatıyla.
 * `usage.iterations` her denemeyi ayrı verir (model null: istenen model); yoksa üst düzey kullanım. Anthropic dolar
 * üzerinden faturalar; tutarlar yaklaşıktır.
 */

export interface ModelPrice {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  /** İstemi (girdi + önbellek) bu kadar tokenı aşan istek ikinci fiyat kartıyla (Haiku 5.5: 100 bin token üstü) */
  long?: { above: number } & Omit<ModelPrice, "long">;
}

export const PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  // Ürün → hammadde önerisi (Paraşüt): 2 / 10 $; önbellek okuma 0,10 $ (girdinin 0,05'i), 5 dakikalık yazma 1,25×.
  // Reddedilen istek sunucu tarafında Claude Sonnet 5'e düşer (fallbacks "default"): onun önbellek okuması 0,20 $
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  // Fatura okuma: 100 bin tokena kadar 0,10 / 0,50 $, üstü 0,50 / 2,50 $; önbellek okuma 0,1×, 5 dakikalık yazma 1,25×
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01, long: { above: 100_000, input: 0.5, output: 2.5, cacheWrite: 0.625, cacheRead: 0.05 } },
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
    const card = price.long && it.input_tokens + read + write > price.long.above ? price.long : price;
    usd += (it.input_tokens * card.input + it.output_tokens * card.output + read * card.cacheRead + write * card.cacheWrite) / 1_000_000;
    totals.inputTokens += it.input_tokens;
    totals.outputTokens += it.output_tokens;
    totals.cacheReadTokens += read;
    totals.cacheWriteTokens += write;
  }
  return { usd: Math.round(usd * 1e6) / 1e6, ...totals, fallback: attempts.some((i) => i.type === "fallback_message"), priceKnown };
}
