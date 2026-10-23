const ENV = process.env.SDK_NODE_MODULES ?? "node_modules"; // @anthropic-ai/sdk kurulu bir node_modules
const { zodOutputFormat } = await import(`${ENV}/@anthropic-ai/sdk/helpers/zod.mjs`);
const S = await import("./schemas.mjs");
for (const k of ["KasaZ", "KasaPos", "Fis"]) {
  const f = zodOutputFormat(S[k]);
  const json = JSON.stringify(f.schema ?? f);
  console.log(k, Object.keys(f), json.length);
  if (k === "KasaZ") console.log(JSON.stringify(f.schema, null, 1).slice(0, 1800));
}
