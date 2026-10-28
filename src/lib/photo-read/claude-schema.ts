/**
 * zod → yapılandırılmış çıktı (structured outputs) JSON şeması. SDK'nın zodOutputFormat'ı enum'ları açıklama metnine
 * taşıyor (API belge türünü ve ödeme türünü artık kısıtlamaz); burada enum kalır, her nesne additionalProperties:false
 * olur, API'nin kabul etmediği sayı / uzunluk sınırları ve $schema çıkar. Sınırları yanıt gelince zod denetler.
 * Karmaşıklık sınırını aşan şema `format` ile gönderilmez (fitsStructuredOutputs; src/server/ai/run.ts buildRequest).
 */

import { z } from "zod";

const DROP = new Set(["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern", "maxItems", "uniqueItems"]);

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (DROP.has(k)) continue;
    if (k === "minItems" && typeof v === "number" && v > 1) continue;
    // Özellik ve tanım adları şema anahtar sözcüğü değildir ("pattern" adlı bir alan da kalır)
    out[k] = (k === "properties" || k === "$defs") && v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, clean(pv)])) : clean(v);
  }
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

export function claudeSchema(schema: z.ZodType): Record<string, unknown> {
  return clean(z.toJSONSchema(schema, { target: "draft-2020-12", io: "output" })) as Record<string, unknown>;
}

/**
 * Yapılandırılmış çıktının açık karmaşıklık sınırları (Claude belgeleri, structured outputs › "Schema complexity
 * limits"; istekteki bütün şemaların toplamı): birleşim türlü parametre (`anyOf` ya da tür dizisi, ör.
 * `["string","null"]`) en çok 16, isteğe bağlı (`required`'da olmayan) parametre en çok 24. Aşan şemayla istek 400 alır.
 * Canlıda kabul edilen şemalar: Z 14, banka gün sonu 11, fiş 14, fatura 8 birleşim türlü parametre; yazarkasa Z'si 42.
 */
export const STRUCTURED_OUTPUT_LIMITS = { unionParams: 16, optionalParams: 24 } as const;

/** Şemadaki birleşim türlü ve isteğe bağlı parametrelerin sayısı (iç içe nesneler ve dizi öğeleri dahil) */
export function schemaComplexity(schema: unknown): { unionParams: number; optionalParams: number } {
  const acc = { unionParams: 0, optionalParams: 0 };
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (Array.isArray(n.anyOf) || (Array.isArray(n.type) && n.type.length > 1)) acc.unionParams += 1;
    for (const [k, v] of Object.entries(n)) {
      if (k === "enum" || k === "const" || k === "required" || k === "default") continue;
      // Özellik ve tanım adları şema anahtar sözcüğü değildir: değerleri tek tek gezilir
      if ((k === "properties" || k === "$defs") && v && typeof v === "object") {
        // `required` yoksa nesnenin bütün alanları isteğe bağlıdır
        const required = k === "properties" ? (Array.isArray(n.required) ? (n.required as unknown[]) : []) : null;
        for (const [name, child] of Object.entries(v)) {
          if (required && !required.includes(name)) acc.optionalParams += 1;
          walk(child);
        }
      } else walk(v);
    }
  };
  walk(schema);
  return acc;
}

/** Şema yapılandırılmış çıktıyla (`output_config.format`) gönderilebilir mi */
export function fitsStructuredOutputs(schema: unknown): boolean {
  const c = schemaComplexity(schema);
  return c.unionParams <= STRUCTURED_OUTPUT_LIMITS.unionParams && c.optionalParams <= STRUCTURED_OUTPUT_LIMITS.optionalParams;
}
