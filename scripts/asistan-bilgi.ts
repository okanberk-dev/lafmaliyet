// Panel asistanının bilgi tabanını yeniden yazar (docs/ASISTAN.md › Bilgi tabanı): docs/*.md belgelerini bölümlere
// ayırıp sadeleştirir (src/lib/assistant/knowledge-build.ts) ve src/lib/assistant/knowledge-data.ts'e gömer. Belge
// değişince çalıştırın; unutulursa tests/panel-asistani.test.ts "bilgi tabanı güncel" testi düşer.
//
// Kullanım: npm run asistan:bilgi

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { compileKnowledge, knowledgeModule } from "../src/lib/assistant/knowledge-build";

const root = process.cwd();
const docs = join(root, "docs");
const files = readdirSync(docs)
  .filter((f) => f.endsWith(".md"))
  .map((name) => ({ name, text: readFileSync(join(docs, name), "utf8") }));
const sections = compileKnowledge(files);
const out = join(root, "src", "lib", "assistant", "knowledge-data.ts");
const source = knowledgeModule(sections);
writeFileSync(out, source);
const docCount = new Set(sections.map((s) => s.doc)).size;
console.log(`Bilgi tabanı: ${docCount} belge, ${sections.length} bölüm, ${Math.round(source.length / 1024)} KB → src/lib/assistant/knowledge-data.ts`);
