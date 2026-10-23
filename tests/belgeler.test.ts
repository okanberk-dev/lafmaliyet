// Belgeler kodla aynı kalsın: README'nin uç tablosu src/app/api altındaki her ucu sayar; site satış sözleşmesinin
// belgesi (docs/SITE-SATIS.md) sözleşmeyi okuyan her yeri, Nakit planının KDV tahmini dahil, listeler.
// Çalıştırma: npx tsx --test tests/belgeler.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const read = (f: string) => readFileSync(join(root, f), "utf8");

function routes(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? routes(`${dir}/${e.name}`) : e.name === "route.ts" ? [`/${relative("src/app", dir)}`] : [],
  );
}

test("README: src/app/api altındaki her uç tabloda yazılı", () => {
  const readme = read("README.md");
  const list = routes("src/app/api");
  assert.ok(list.length >= 15, list.join(", "));
  for (const r of list) assert.ok(readme.includes(`\`${r}\``), `README'de yok: ${r}`);
});

test("SITE-SATIS.md: sözleşmeyi okuyan yerler, Nakit planının KDV tahmini dahil", () => {
  const doc = read("docs/SITE-SATIS.md");
  assert.match(doc, /\*\*Kullananlar\*\*/);
  assert.match(doc, /Nakit planı › KDV\s+tahmini/);
  assert.match(doc, /`siteVat`/);
  // Belgenin söylediği yer gerçekten okuyor
  assert.match(read("src/lib/kdv.ts"), /siteVat\(rec, st\.kdv, st\.kdvHizmet\)/);
});
