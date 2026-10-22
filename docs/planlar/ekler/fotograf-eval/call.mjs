// Tek gerçek API çağrısı: node call.mjs <feature: z|pos|fis> <image> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
const ENV = process.env.SDK_NODE_MODULES ?? "node_modules"; // @anthropic-ai/sdk kurulu bir node_modules
const { default: Anthropic } = await import(`${ENV}/@anthropic-ai/sdk/index.mjs`);
const S = await import("./schemas.mjs");
const P = await import("./prompts.mjs");
const { claudeSchema } = await import("./claude-schema.mjs");
const [feature, imagePath, outPath] = process.argv.slice(2);
const key = (process.env.ANTHROPIC_API_KEY ?? "").trim(); // anahtar depoda tutulmaz
const client = new Anthropic({ apiKey: key, timeout: 45_000, maxRetries: 0 });
const day = "2026-10-21";
const CATS = [
  { id: 1, name: "Nakit malzeme alımı", section: "mal" },
  { id: 2, name: "Bakım & onarım", section: "genel" },
  { id: 3, name: "Diğer fatura dışı", section: "genel" },
  { id: 4, name: "Temizlik malzemesi", section: "genel" },
];
const spec = { z: [S.KasaZ, P.Z_TASK(day)], pos: [S.KasaPos, P.POS_TASK(day)], fis: [S.Fis, P.FIS_TASK(day, CATS)] }[feature];
const schema = claudeSchema(spec[0]);
const data = readFileSync(imagePath).toString("base64");
const t0 = Date.now();
let res, err;
try {
  res = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 6000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system: P.SYSTEM,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data } },
      { type: "text", text: spec[1] },
    ] }],
  });
} catch (e) {
  err = { name: e?.constructor?.name, status: e?.status, message: String(e?.message).slice(0, 2000) };
}
const ms = Date.now() - t0;
const out = { feature, imagePath, ms, err };
if (res) {
  out.model = res.model; out.stop_reason = res.stop_reason; out.stop_details = res.stop_details ?? null;
  out.usage = res.usage; out.blocks = res.content.map((b) => b.type);
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try { out.json = JSON.parse(text); } catch (e) { out.rawText = text.slice(0, 4000); out.parseError = String(e); }
  if (out.json) { const v = spec[0].safeParse(out.json); out.zodOk = v.success; if (!v.success) out.zodIssues = v.error.issues.slice(0, 5); }
  out.requestId = res._request_id ?? null;
}
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ms, err, stop: out.stop_reason, model: out.model, usage: out.usage, zodOk: out.zodOk, blocks: out.blocks }, null, 1));
