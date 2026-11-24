/**
 * Panel asistanının araçları ile Claude arasındaki uyarlayıcı (saf; tests/panel-asistani.test.ts). Claude bağlantısının
 * (MCP) araçları olduğu gibi kullanılır: aynı zod girdi şeması, aynı `run(args, ctx)`, aynı çıktı boyu kuralı
 * (fitOutput); kopya yok. Burada yalnız:
 *
 * - zod şeması → araç tanımı (`input_schema`, `strict: true`; claudeToolSchema). Yapılandırılmış çıktının karmaşıklık
 *   sınırı istekteki strict şemaların toplamına uygulanır: sınıra sığan önek strict gider, kalanlar strict'siz (istek
 *   400 almasın), girdi her durumda zod'dan geçer.
 * - `tool_use` bloğu → `tool_result`: ad (büyük / küçük harf farkı tek bir araca çıkıyorsa kabul), girdi zod'dan geçer,
 *   araç süre sınırıyla çalışır. Girdi hatası, aracın kendi uyarısı (ToolInputError) ve beklenmeyen hata `is_error: true`
 *   ile döner; Claude hatayı görüp düzeltir ya da kullanıcıya söyler. Beklenmeyen hatanın ayrıntısı Claude'a gitmez.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

import { fitOutput, ToolInputError } from "@/lib/mcp/answers/common";
import { claudeToolSchema, fitsStructuredOutputs } from "@/lib/photo-read/claude-schema";
import type { ToolContext, ToolDef } from "@/server/mcp/tools";

export type { ToolContext };

/** Asistanın aracı: MCP aracının kendisi + ekrandaki durum satırı ("Tedarikçi özeti") */
export interface AssistantTool<S extends z.ZodType = z.ZodType> extends ToolDef<S> {
  label: string;
}

/** Bir araç yanıtı en çok bu kadar karakter (MCP'de 60.000; asistanda maliyet için daha kısa) */
export const TOOL_OUTPUT_MAX = 24_000;
/** Bir aracın en uzun süresi (ms); aşan araç "yanıt vermedi" hatasıyla döner */
export const TOOL_TIMEOUT_MS = 15_000;

export const TOOL_FAILED = "Panel verisi şu an okunamadı. Biraz sonra yeniden deneyin.";

/**
 * Claude'a giden araç tanımları (sıra sabit: önbellek araçların baytlarına bakar). Yapılandırılmış girdinin karmaşıklık
 * sınırı istekteki strict şemaların TOPLAMINA uygulanır: sınıra sığan en uzun önek strict gider, kalanlar strict'siz
 * (istek 400 almasın; girdileri yine zod'dan geçer). Okuma araçları listenin başında olduğu için strict kalır.
 */
export function toolParams(tools: readonly AssistantTool[]): Anthropic.Beta.BetaTool[] {
  const schemas = tools.map((t) => claudeToolSchema(t.inputSchema));
  let strict = 0;
  while (strict < schemas.length && fitsStructuredOutputs(schemas.slice(0, strict + 1))) strict++;
  return tools.map((t, i) => ({
    name: t.name,
    description: t.description,
    input_schema: schemas[i] as Anthropic.Beta.BetaTool.InputSchema,
    ...(i < strict ? { strict: true } : {}),
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

/** Aracı süre sınırı ve iptal sinyaliyle çalıştırır (aşınca sonucu beklenmez) */
function withLimit<T>(work: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ToolTimeout()), ms);
    const onAbort = () => reject(new ToolTimeout());
    signal?.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
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
    const out = await withLimit(tool.run(parsed.data, opts.ctx), opts.timeoutMs ?? TOOL_TIMEOUT_MS, opts.signal);
    return { type: "tool_result", tool_use_id: use.id, content: fitOutput(out, opts.maxChars ?? TOOL_OUTPUT_MAX) };
  } catch (e) {
    if (e instanceof ToolInputError) return fail(e.message);
    if (e instanceof ToolTimeout) return fail(`${tool.label} zamanında yanıt vermedi; daha dar bir aralık deneyin ya da kullanıcıya söyleyin.`);
    (opts.onError ?? ((name, err) => console.error("[asistan] araç", name, err)))(tool.name, e);
    return fail(TOOL_FAILED);
  }
}
