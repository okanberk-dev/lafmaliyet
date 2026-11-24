/**
 * Panel asistanının araçları ile Claude arasındaki uyarlayıcı (saf; tests/panel-asistani.test.ts). Claude bağlantısının
 * (MCP) araçları olduğu gibi kullanılır: aynı zod girdi şeması, aynı `run(args, ctx)`, aynı çıktı boyu kuralı
 * (fitOutput); kopya yok. Burada yalnız:
 *
 * - zod şeması → araç tanımı (`input_schema`, `strict: true`; claudeToolSchema). Yapılandırılmış çıktının karmaşıklık
 *   sınırı istekteki strict şemaların toplamına uygulanır: önce işlem araçları (onay kartı; girdisi en önemli olanlar),
 *   sonra okuma araçları sınıra sığdıkça strict gider, kalanlar strict'siz (istek 400 almasın); girdi her durumda
 *   zod'dan geçer.
 * - `tool_use` bloğu → `tool_result`: ad (büyük / küçük harf farkı tek bir araca çıkıyorsa kabul), girdi zod'dan geçer,
 *   araç süre sınırıyla çalışır; süre dolunca (ya da yanıt durdurulunca) aracın bağlamındaki `signal` kesilir: uzun
 *   süren işlem aracı geç gelen sonucu yazmaz ve kartı ekrana koymaz (op-tools.ts). Girdi hatası, aracın kendi uyarısı (ToolInputError) ve beklenmeyen hata `is_error: true`
 *   ile döner; Claude hatayı görüp düzeltir ya da kullanıcıya söyler. Beklenmeyen hatanın ayrıntısı Claude'a gitmez.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

import { errorTag } from "@/lib/assistant/error-tag";
import { fitOutput, ToolInputError } from "@/lib/mcp/answers/common";
import { claudeToolSchema, fitsStructuredOutputs, schemaComplexity } from "@/lib/photo-read/claude-schema";
import type { ToolContext as McpToolContext, ToolDef } from "@/server/mcp/tools";

/** Aracın bağlamı: MCP'ninki + bu çağrının iptal sinyali (süre sınırı ya da Durdur) */
export interface ToolContext extends McpToolContext {
  signal?: AbortSignal;
}

/** Asistanın aracı: MCP aracının kendisi + ekrandaki durum satırı ("Tedarikçi özeti") */
export interface AssistantTool<S extends z.ZodType = z.ZodType> extends ToolDef<S> {
  label: string;
  /** Strict önceliği: işlem araçları (onay kartı) sınırın içinde okuma araçlarından önce strict olur */
  strictFirst?: boolean;
}

/** Bir araç yanıtı en çok bu kadar karakter (MCP'de 60.000; asistanda maliyet için daha kısa) */
export const TOOL_OUTPUT_MAX = 24_000;
/** Bir aracın en uzun süresi (ms); aşan araç "yanıt vermedi" hatasıyla döner */
export const TOOL_TIMEOUT_MS = 15_000;

export const TOOL_FAILED = "Panel verisi şu an okunamadı. Biraz sonra yeniden deneyin.";

/**
 * Claude'a giden araç tanımları (sıra ve strict kümesi sabit: önbellek araçların baytlarına bakar). Yapılandırılmış
 * girdinin karmaşıklık sınırı istekteki strict şemaların TOPLAMINA uygulanır. Strict kümesi sırayla değil önceliğe göre
 * seçilir: önce işlem araçları (`strictFirst`; bozuk girdi fazladan bir API turu demek), her grupta az karmaşık olan
 * önce (sınıra en çok araç sığsın); sığmayan atlanır, sonrakiler denenir. Kalanlar strict'siz gider (istek 400 almasın;
 * girdileri yine zod'dan geçer). Parametresiz ve zorunlu parametreli araçlar sınırı tüketmez, hep strict'tir.
 */
export function toolParams(tools: readonly AssistantTool[]): Anthropic.Beta.BetaTool[] {
  const schemas = tools.map((t) => claudeToolSchema(t.inputSchema));
  const cost = schemas.map((sc) => {
    const c = schemaComplexity(sc);
    return c.unionParams + c.optionalParams;
  });
  const order = tools.map((_, i) => i).sort((a, b) => Number(!!tools[b].strictFirst) - Number(!!tools[a].strictFirst) || cost[a] - cost[b] || a - b);
  const strict = new Set<number>();
  for (const i of order) {
    if (fitsStructuredOutputs([...[...strict].map((j) => schemas[j]), schemas[i]])) strict.add(i);
  }
  return tools.map((t, i) => ({
    name: t.name,
    description: t.description,
    input_schema: schemas[i] as Anthropic.Beta.BetaTool.InputSchema,
    ...(strict.has(i) ? { strict: true } : {}),
  }));
}

/** Adıyla araç; tam ad yoksa büyük / küçük harf farkıyla tek bir araç (Claude bazen "Ay_ozeti" yazar) */
export function findTool(tools: readonly AssistantTool[], name: string): AssistantTool | null {
  const exact = tools.find((t) => t.name === name);
  if (exact) return exact;
  const loose = tools.filter((t) => t.name.toLowerCase() === name.toLowerCase());
  return loose.length === 1 ? loose[0] : null;
}

/** İlk birkaç zod sorunu: "limit: Too big…" */
function issuesText(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "girdi"}: ${i.message}`)
    .join("; ");
}

class ToolTimeout extends Error {}

/**
 * Aracı süre sınırı ve iptal sinyaliyle çalıştırır (aşınca sonucu beklenmez). Araca bu çağrının sinyali verilir: süre
 * dolunca ya da dış sinyal kesilince o da kesilir (işlem aracı geç sonucu yazmasın, kartı ekrana koymasın)
 */
function withLimit<T>(work: (signal: AbortSignal) => Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  const limit = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const stop = () => {
      limit.abort();
      reject(new ToolTimeout());
    };
    const timer = setTimeout(stop, ms);
    if (signal?.aborted) stop();
    signal?.addEventListener("abort", stop, { once: true });
    work(limit.signal)
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
      });
  });
}

export interface ToolUseLike {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolRunOptions {
  ctx: ToolContext;
  maxChars?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Beklenmeyen hata (varsayılan: sunucu günlüğü; testte susturulur) */
  onError?: (tool: string, e: unknown) => void;
}

/** Tek `tool_use` bloğunun sonucu: her durumda bir `tool_result` (hata da) */
export async function runToolUse(tools: readonly AssistantTool[], use: ToolUseLike, opts: ToolRunOptions): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const fail = (content: string): Anthropic.Beta.BetaToolResultBlockParam => ({ type: "tool_result", tool_use_id: use.id, is_error: true, content });
  const tool = findTool(tools, use.name);
  if (!tool) return fail(`Böyle bir araç yok: ${use.name}. Kullanılabilen araçlar: ${tools.map((t) => t.name).join(", ")}.`);
  const parsed = tool.inputSchema.safeParse(use.input ?? {});
  if (!parsed.success) return fail(`Girdi geçersiz (${tool.name}): ${issuesText(parsed.error)}`);
  try {
    const out = await withLimit((signal) => tool.run(parsed.data, { ...opts.ctx, signal } as ToolContext), opts.timeoutMs ?? TOOL_TIMEOUT_MS, opts.signal);
    return { type: "tool_result", tool_use_id: use.id, content: fitOutput(out, opts.maxChars ?? TOOL_OUTPUT_MAX) };
  } catch (e) {
    if (e instanceof ToolInputError) return fail(e.message);
    if (e instanceof ToolTimeout) return fail(`${tool.label} zamanında yanıt vermedi; daha dar bir aralık deneyin ya da kullanıcıya söyleyin.`);
    (opts.onError ?? ((name, err) => console.error("[asistan] araç", name, errorTag(err))))(tool.name, e);
    return fail(TOOL_FAILED);
  }
}
