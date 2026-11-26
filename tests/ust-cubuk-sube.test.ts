// Telefonda üst çubukta görülen şube (Dalga 2; docs/SUBE.md › Telefonda üst çubuk): birden çok şube açıkken sayfa
// başlığının altında seçili kapsamın adı ("Tümü", "Marina"); dokununca seçicinin durduğu çekmece açılır, şubesi kilitli
// personelde yalnız ad. Saf kural src/lib/branches.ts topBarBranchLabel, çizim src/components/panel/sidebar.tsx.
// Çalıştırma: npx tsx --test tests/ust-cubuk-sube.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ALL_BRANCHES, DEFAULT_BRANCHES, topBarBranchLabel, type BranchRow } from "../src/lib/branches";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const rows = (active: Record<string, boolean>): BranchRow[] => DEFAULT_BRANCHES.map((b) => ({ ...b, active: active[b.id] ?? false }) as BranchRow);

test("birden çok şube açıkken seçili kapsamın adı; tek şubede satır yok", () => {
  const all = rows({ tuzla: true, marina: true, online: true });
  assert.equal(topBarBranchLabel(ALL_BRANCHES, all), "Tümü");
  assert.equal(topBarBranchLabel("marina", all), "Marina");
  assert.equal(topBarBranchLabel("tuzla", all), "Tuzla");
  assert.equal(topBarBranchLabel("yok-boyle-sube", all), "Tümü", "tanınmayan seçim Tümü sayılır (parseBranchScope gibi)");
  const one = rows({ tuzla: true });
  assert.equal(topBarBranchLabel("tuzla", one), null, "tek şube: seçici de çizilmez, üst çubukta satır gürültü olurdu");
  assert.equal(topBarBranchLabel(ALL_BRANCHES, one), null);
});

test("üst çubuk: başlığın altında şube; dokununca çekmece (seçici orada), kilitli personelde yalnız ad", () => {
  const sidebar = read("src/components/panel/sidebar.tsx");
  assert.match(sidebar, /const barBranch = branch \? topBarBranchLabel\(branch\.scope, branch\.branches\) : null;/);
  const header = sidebar.slice(sidebar.indexOf("data-mobile-top>"), sidebar.indexOf("</header>", sidebar.indexOf("data-mobile-top>")));
  assert.ok(header.includes("{title}</p>"), "başlık yerinde");
  assert.match(header, /branch\?\.locked \? \(\s+<p[^>]*data-top-branch>/, "kilitli personel: düğme değil, yalnız ad");
  assert.match(header, /<button\s+type="button"\s+onClick=\{openDrawer\}\s+data-top-branch/, "şubeye dokununca seçicinin durduğu çekmece açılır");
  assert.match(header, /aria-label=\{`Şube: \$\{barBranch\}\. Değiştirmek için menüyü açın`\}/);
  // Başlık ve şube satırı 56 px'lik çubuğa sığar: başlık 20 px, şube 16 px
  assert.match(header, /text-\[15px\] leading-5/);
  assert.match(header, /text-xs leading-4/);
});
