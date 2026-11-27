// Belgeler kodla aynı kalsın: README'nin uç tablosu src/app/api altındaki her ucu sayar; site satış sözleşmesinin
// belgesi (docs/SITE-SATIS.md) sözleşmeyi okuyan her yeri listeler. KALAN-ISLER
// git geçmişindeki her birleşmiş dalgayı anar, andığı dosyalar vardır ve 26 Ekim denetiminin partileriyle aynıdır.
// Çalıştırma: npx tsx --test tests/belgeler.test.ts

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

test("SITE-SATIS.md: sözleşmeyi okuyan yerler (Gelir-gider'in online geliri ve KDV'si; nakit planının KDV tahmini kalktı)", () => {
  const doc = read("docs/SITE-SATIS.md");
  assert.match(doc, /\*\*Kullananlar\*\*/);
  assert.match(doc, /`siteVat`/);
  assert.doesNotMatch(doc, /\*\*Nakit planı › KDV\s+tahmini\*\*/);
  // Belgenin söylediği yer gerçekten okuyor: KDV hariç online gelir sitenin KDV'sini düşer
  assert.match(read("src/lib/site-sales/calc.ts"), /vat: siteVat\(s, kdvRate, serviceRate\),/);
  assert.match(read("src/lib/calc/engine.ts"), /siteRevenue\(r, st\.kdv, st\.kdvHizmet\)/);
});

// ── docs/planlar: KALAN-ISLER (yeni oturumun başladığı yer) ve 26 Ekim denetimi ─────────────────────────────────────
// 26 Ekim denetimi E-54: KALAN-ISLER birleşmiş 10b'yi ve 13 PR-b'yi "PR bekliyor" sayıyor, AsilPOS'u, FIFO'yu ve
// Dalga 15'i anmıyordu. Bu testler belgeyi git geçmişine ve denetim raporuna bağlar.

const KALAN = "docs/planlar/KALAN-ISLER.md";
const DENETIM = "docs/planlar/denetim-2026-10-26.md";

/** Belgede anılan, henüz yazılmamış dosyalar (belge de "henüz yazılmadı" der). Yazılınca listeden çıkarın. */
const NOT_YET = new Set([
  "ekler/okc-z/eval.md", // Dalga 13 b2'nin sonucu
  "scripts/okc-eval", // Dalga 13 b2'nin değerlendirme betiği
]);

/** Ters tırnaklı `x.md`, `docs/…`, `src/…` yolları ve [..](x.md) bağlantıları. */
export function fileRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const m of text.matchAll(/`([A-Za-z0-9_./-]+\.md)`/g)) refs.add(m[1]);
  for (const m of text.matchAll(/\]\(([A-Za-z0-9_./-]+\.md)(?:#[^)]*)?\)/g)) refs.add(m[1]);
  for (const m of text.matchAll(/`((?:docs|src|scripts|tests|drizzle)\/[A-Za-z0-9_./[\]-]+)`/g)) refs.add(m[1]);
  return [...refs];
}

/** Plan klasörüne, depo köküne ya da docs/'a göre çözülür (belgeler üçünü de kullanır). */
function docExists(ref: string): boolean {
  return [join("docs/planlar", ref), ref, join("docs", ref)].some((p) => existsSync(join(root, p)));
}

export type MergedWave = { waves: string[]; letter: string; part: string; pr: string };

/**
 * Squash ile birleşmiş dalga başlıkları: "Dalga 13 PR-b: … (#35)", "Dalga 10b: … (#32)", "Dalga 7–8 düzeltmeleri: …
 * (#27)", "Kalan işler 5. dalga: … (#14)". "(#N)" ile bitmeyen başlık (dalda kalmış iş) sayılmaz.
 */
export function mergedWaves(subjects: string[]): MergedWave[] {
  const out: MergedWave[] = [];
  for (const s of subjects) {
    const pr = s.match(/\(#(\d+)\)\s*$/)?.[1];
    if (!pr) continue;
    const d = s.match(/^Dalga (\d+)([a-z])?(?:\s*[–-]\s*(\d+))?(?: (PR-[a-z]))?(?=[\s:])/i);
    if (d) {
      out.push({ waves: [d[1], ...(d[3] ? [d[3]] : [])], letter: d[2] ?? "", part: d[4] ?? "", pr });
      continue;
    }
    const k = s.match(/^Kalan işler (\d+)\. dalga\b/i);
    if (k) out.push({ waves: [k[1]], letter: "", part: "", pr });
  }
  return out;
}

/** Belgede eksik olanlar: dalga numarası, alt harfi (10b), parçası (PR-b) ve PR numarası. */
export function missingWaveMentions(doc: string, w: MergedWave): string[] {
  const miss: string[] = [];
  for (const n of w.waves) {
    if (!new RegExp(`(?:dalga\\s+${n}(?!\\d)|(?<!\\d)${n}\\.\\s*dalga)`, "i").test(doc)) miss.push(`Dalga ${n}`);
  }
  if (w.letter && !new RegExp(`(?<![\\w])${w.waves[0]}${w.letter}(?![\\w])`).test(doc)) miss.push(`${w.waves[0]}${w.letter}`);
  if (w.part && !doc.includes(w.part)) miss.push(w.part);
  if (!new RegExp(`#${w.pr}(?!\\d)`).test(doc)) miss.push(`#${w.pr}`);
  return miss;
}

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/** KALAN-ISLER başlığındaki `main` kaydı. */
function headerSha(): string {
  const head = read(KALAN).split("\n")[0];
  const sha = head.match(/`main` @ `([0-9a-f]{7,40})`/)?.[1];
  assert.ok(sha, `başlık main'in kaydını yazmıyor: ${head}`);
  return sha;
}

/**
 * Bu klonun geçmişi o kayda uzanıyor mu? Uzanmıyorsa (git yok, CI'daki `fetch-depth: 1`) git'e dayanan testler atlanır;
 * yerel çalışma kopyasında koşarlar.
 */
function historyReaches(sha: string): boolean {
  return git(["cat-file", "-e", `${sha}^{commit}`]) !== null;
}

/** "| B01 | … | E-01, E-02 | …" satırlarından parti → maddeler. */
function batchItems(text: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const line of text.split("\n")) {
    const m = line.match(/^\| (B\d\d) \| [^|]+ \| ([^|]+) \|/);
    if (m) map.set(m[1], m[2].match(/E-\d\d/g) ?? []);
  }
  return map;
}

/** Bir bölümün "1. **…**" diye başlayan numaralı maddeleri (devam satırlarıyla). */
function numberedItems(section: string): string[] {
  const items: string[] = [];
  for (const line of section.split("\n")) {
    if (/^\d+\. \*\*/.test(line)) items.push(line);
    else if (items.length && /^\s{2,}\S/.test(line)) items[items.length - 1] += ` ${line.trim()}`;
  }
  return items;
}

function between(text: string, start: string, end: RegExp): string {
  const i = text.indexOf(start);
  assert.ok(i >= 0, `bölüm yok: ${start}`);
  const rest = text.slice(i + start.length);
  const j = rest.search(end);
  return j < 0 ? rest : rest.slice(0, j);
}

test("mergedWaves: yalnız birleşmiş başlıklar, alt harf, PR parçası ve aralık", () => {
  const got = mergedWaves([
    "Dalga 15: kenar çubuğu ana başlıklar ve alt sekmeler (#39)",
    "Dalga 13 PR-b: Kasa raporunda yazarkasa (Banka POS) mali Z raporu (#35)",
    "Dalga 10b: Tükendi / Satışa aç (#32)",
    "Dalga 7–8 düzeltmeleri: ay sonu sayımı (#27)",
    "Kalan işler 5. dalga: fotoğraflı kontrol listeleri (#14)",
    "Dalga 16: dalda kalan iş, birleşmedi",
    "AsilPOS bağlantısı: günlük satış (#34)",
  ]);
  assert.deepEqual(got, [
    { waves: ["15"], letter: "", part: "", pr: "39" },
    { waves: ["13"], letter: "", part: "PR-b", pr: "35" },
    { waves: ["10"], letter: "b", part: "", pr: "32" },
    { waves: ["7", "8"], letter: "", part: "", pr: "27" },
    { waves: ["5"], letter: "", part: "", pr: "14" },
  ]);
  const doc = "Dalga 10a (#30) main'de. Dalga 13 PR-a (#33). 5. dalga #14";
  assert.deepEqual(missingWaveMentions(doc, got[2]), ["10b", "#32"]);
  assert.deepEqual(missingWaveMentions(doc, got[1]), ["PR-b", "#35"]);
  assert.deepEqual(missingWaveMentions(doc, got[4]), []);
  // "Dalga 1" "Dalga 15"in içinde sayılmaz; "#3" "#35"in içinde sayılmaz
  assert.deepEqual(missingWaveMentions("Dalga 15 (#35)", { waves: ["1"], letter: "", part: "", pr: "3" }), ["Dalga 1", "#3"]);
});

test("KALAN-ISLER: andığı plan dosyaları ve yollar var", () => {
  const refs = fileRefs(read(KALAN));
  assert.ok(refs.length >= 40, refs.join(", "));
  for (const p of ["personel-yetki.md", "okc-z.md", "stok-fifo.md", "denetim-2026-10-26.md", "docs/ASILPOS.md"]) {
    assert.ok(refs.includes(p), `KALAN-ISLER anmıyor: ${p}`);
  }
  const missing = refs.filter((r) => !NOT_YET.has(r) && !docExists(r));
  assert.deepEqual(missing, [], `KALAN-ISLER'in andığı ama depoda olmayan dosyalar: ${missing.join(", ")}`);
});

test("KALAN-ISLER: git geçmişindeki her birleşmiş dalga anılıyor (10b, 13 PR-b, 14, 15 dahil)", (t) => {
  if (!historyReaches(headerSha())) return t.skip("git geçmişi başlıktaki kayda uzanmıyor (sığ klon)");
  const subjects = (git(["log", "--format=%s", "HEAD"]) ?? "").split("\n");
  const waves = mergedWaves(subjects);
  const seen = new Set(waves.map((w) => `${w.waves.join("–")}${w.letter} ${w.part}`.trim()));
  for (const must of ["10b", "13 PR-b", "14", "15"]) assert.ok(seen.has(must), `git geçmişinde yok: Dalga ${must}`);
  const doc = read(KALAN);
  const gaps = waves.flatMap((w) => {
    const miss = missingWaveMentions(doc, w);
    const name = `Dalga ${w.waves.join("–")}${w.letter}${w.part ? ` ${w.part}` : ""} (#${w.pr})`;
    return miss.length ? [`${name}: ${miss.join(", ")} yok`] : [];
  });
  assert.deepEqual(gaps, [], `KALAN-ISLER'de anılmayan birleşmiş dalgalar: ${gaps.join(", ")}`);
});

test("KALAN-ISLER: başlıktaki main kaydı bu dalın geçmişinde", (t) => {
  const sha = headerSha();
  if (!historyReaches(sha)) return t.skip("git geçmişi başlıktaki kayda uzanmıyor (sığ klon)");
  assert.notEqual(git(["merge-base", "--is-ancestor", sha, "HEAD"]), null, `${sha} HEAD'in atası değil`);
});

test("KALAN-ISLER: AsilPOS sahip adımı, FIFO notu; kaldırılmış Preview sırları yeniden istenmez", () => {
  const doc = read(KALAN);
  const asilpos = between(doc, "### AsilPOS bağlantısı", /\n### /);
  for (const s of ["#34", "#36", "`ASILPOS_SYNC_SECRET`", "`LAFMALIYET_SYNC_SECRET`", "`LAFMALIYET_URL", "yalnız Production", "E-31"]) {
    assert.ok(asilpos.includes(s), `AsilPOS bölümünde yok: ${s}`);
  }
  // Dalga 7'nin değerleme kuralı Dalga 14'te değişti
  assert.match(doc, /Sayım ay sonundaki fiyatla değerlenir \(Dalga 14'ten beri[^)]*FIFO/);
  assert.match(doc, /### Dalga 14: stok değerleme FIFO \(#38\)/);
  assert.match(doc, /### Dalga 15: kenar çubuğu \(#39\)/);
  // Preview'da yalnız DATABASE_* ve ADMIN_EMAIL / ADMIN_NAME kaldı (26 Ekim, Vercel)
  assert.doesNotMatch(doc, /Preview ortamından gizli anahtarları/);
  assert.doesNotMatch(doc, /main'e PR bekliyor/);
});

test("denetim raporu: 70 madde, her madde tek partide, durum başlığı KALAN-ISLER'e gösterir", () => {
  const rep = read(DENETIM);
  const ids = [...rep.matchAll(/^\| (E-\d\d) \|/gm)].map((m) => m[1]);
  assert.deepEqual(ids.slice().sort(), Array.from({ length: 70 }, (_, i) => `E-${String(i + 1).padStart(2, "0")}`));
  const batches = batchItems(between(rep, "## Düzeltme partileri", /\n## /));
  assert.deepEqual([...batches.keys()], Array.from({ length: 20 }, (_, i) => `B${String(i + 1).padStart(2, "0")}`));
  const assigned = [...batches.values()].flat();
  assert.equal(assigned.length, 70, "bir madde iki partide");
  assert.deepEqual(assigned.slice().sort(), ids.slice().sort());
  const head = rep.slice(0, rep.indexOf("Taban:"));
  assert.match(head, /\*\*Durum\.\*\*/);
  assert.match(head, /parti parti/);
  assert.match(head, /\[KALAN-ISLER\.md\]\(KALAN-ISLER\.md\)/);
});

test("KALAN-ISLER: denetimin partileri raporla aynı, sahibe 11 soru ve varsayılanlar", () => {
  const doc = read(KALAN);
  const rep = read(DENETIM);
  const section = between(doc, "### Denetim (26 Ekim): düzeltme partileri", /\n### /);
  assert.ok(section.includes("[denetim-2026-10-26.md](denetim-2026-10-26.md)"));
  const mine = batchItems(section);
  const theirs = batchItems(between(rep, "## Düzeltme partileri", /\n## /));
  assert.deepEqual([...mine.entries()], [...theirs.entries()]);
  for (const id of ["NEW-01", "NEW-02", "NEW-03"]) assert.ok(section.includes(id), `eleştirmenin bulgusu yok: ${id}`);

  const qMine = numberedItems(between(section, "**Sahibe sorular (26 Ekim", /\n\n(?!\d|\s)/));
  const qTheirs = numberedItems(between(rep, "## Sahibe sorular", /\n## /));
  assert.equal(qTheirs.length, 11);
  assert.equal(qMine.length, qTheirs.length);
  qTheirs.forEach((q, i) => {
    for (const id of q.match(/[ED]-\d\d/g) ?? []) assert.ok(qMine[i].includes(id), `soru ${i + 1}: ${id} yok`);
  });
  // Yanıt gelene kadarki varsayılanlar (E-19, E-29)
  assert.ok(
    qMine[2].includes(
      "Geçen ayın sayımı ayın 10'undan sonra yalnız yönetici tarafından düzeltilebilir; yöneticiye haber verin.",
    ),
  );
  assert.match(qMine[3], /hiçbir reçete değişmez/);
});
