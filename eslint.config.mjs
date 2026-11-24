import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // AkmanOS kütüphanesinden olduğu gibi alınan kaynak (src/components/akmanos/README.md)
    "src/components/akmanos/**",
    // Arc UI'nin ücretsiz kayıtlarından elle kurulan kaynak (src/components/arc/README.md)
    "src/components/arc/**",
    // Design Lab beceri şablonları (.claude/skills/design-lab): kullanılırken src/app/design-lab/ altına kopyalanır
    ".claude/**",
    // Panel asistanının bilgi tabanı: docs/*.md'den üretilir (npm run asistan:bilgi)
    "src/lib/assistant/knowledge-data.ts",
  ]),
]);

export default eslintConfig;
