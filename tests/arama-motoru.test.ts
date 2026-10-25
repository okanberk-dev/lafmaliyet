// Panel arama motorlarında görünmez (docs/DEPLOY.md): her yanıtta X-Robots-Tag noindex, kök düzende noindex etiketi,
// robots.txt taramayı engellemez (engelleseydi Google noindex'i göremezdi).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import robots from "../src/app/robots";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("robots.txt taramayı engellemez; noindex başlığı her yola, etiket kök düzende", () => {
  const r = robots();
  const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
  assert.ok(rules.every((x) => !x.disallow || (Array.isArray(x.disallow) ? x.disallow.length === 0 : x.disallow === "")), "Disallow yok");
  const config = read("next.config.ts");
  assert.match(config, /key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex"/);
  assert.match(config, /source: "\/:path\*"[\s\S]{0,200}SECURITY_HEADERS|SECURITY_HEADERS[\s\S]{0,400}source: "\/:path\*"/);
  assert.match(read("src/app/layout.tsx"), /robots: \{\s+index: false,\s+follow: false,/);
  assert.match(read("src/app/giris/page.tsx"), /robots: \{ index: false, follow: false \}/);
});
