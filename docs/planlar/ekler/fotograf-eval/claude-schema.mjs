// Taslak: src/lib/photo-read/claude-schema.ts. zod → JSON Schema (structured outputs alt kümesi): enum kalır,
// her nesne additionalProperties:false, sayı/uzunluk sınırları ve $schema çıkar (sınırlar zod ile sunucuda denetlenir).
const ENV = process.env.SDK_NODE_MODULES ?? "node_modules"; // @anthropic-ai/sdk kurulu bir node_modules
const { z } = await import(`${ENV}/zod/v4/index.js`);
const DROP = new Set(["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern", "maxItems", "uniqueItems"]);
function clean(node) {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (DROP.has(k)) continue;
    if (k === "minItems" && v > 1) continue;
    out[k] = k === "properties" || k === "$defs" ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, clean(pv)])) : clean(v);
  }
  if (out.type === "object") out.additionalProperties = false;
  return out;
}
export function claudeSchema(schema) {
  return clean(z.toJSONSchema(schema, { target: "draft-2020-12", io: "output" }));
}
