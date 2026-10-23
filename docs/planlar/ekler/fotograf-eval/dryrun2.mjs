import { claudeSchema } from "./claude-schema.mjs";
const S = await import("./schemas.mjs");
for (const k of ["KasaZ", "KasaPos", "Fis"]) {
  const j = claudeSchema(S[k]);
  console.log(k, JSON.stringify(j).length);
}
console.log(JSON.stringify(claudeSchema(S.KasaZ)).slice(0, 2500));
