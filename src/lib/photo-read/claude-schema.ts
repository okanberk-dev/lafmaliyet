/**
 * zod → yapılandırılmış çıktı (structured outputs) JSON şeması. SDK'nın zodOutputFormat'ı enum'ları açıklama metnine
 * taşıyor (API belge türünü ve ödeme türünü artık kısıtlamaz); burada enum kalır, her nesne additionalProperties:false
 * olur, API'nin kabul etmediği sayı / uzunluk sınırları ve $schema çıkar. Sınırları yanıt gelince zod denetler.
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
