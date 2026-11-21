// Stok sayımı şube başına (docs/SUBE.md › Yazarken hangi şube; 21 Kasım denetimi #8, #19/#24, #20):
// - kaydedilmemiş sayımın taslağı şubesiyle saklanır, bir şubenin taslağı öbür şubenin formunda önerilmez (#8);
// - "Listede olmayanlar" (stock_extras) şubenin: okuma, kilit, eşleme, silme ve kayıt o şubenin listesiyle (#19/#24);
// - sayfa şubenin modeliyle açılsa da Gelir-giderde elle yazılan (işletme geneli) devirlerin ipucu ve uyarısı çıkar (#20).
// Gerçek veritabanında: tests/sayim-db.test.ts ("ek kalemler şube başına").
// Çalıştırma: npx tsx --test tests/sayim-sube.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  closingOverrideText,
  countDraftJson,
  countDraftKey,
  countOpening,
  countOpeningNote,
  countOpeningOf,
  parseCountDraft,
  stockOverrides,
  unpricedExtrasNotice,
} from "../src/app/panel/sayim/logic";
import { branchPnlEntry } from "../src/lib/branches";
import { createModel, shiftMonth } from "../src/lib/calc/engine";
import type { Dataset, PnlEntry } from "../src/lib/calc/types";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** ₺ ile tutar arasındaki bölünmez boşluk düz boşluk olur */
const plain = (s: string | null) => s?.replace(/\u00a0/g, " ") ?? null;

// ---------------------------------------------------------------- #8: taslak şube başına

test("#8 taslak anahtarı şubeyi içerir: Tuzla'nın ve Marina'nın aynı ayki taslağı ayrı", () => {
  assert.equal(countDraftKey("tuzla", "2026-11"), "laf:sayim-taslak:tuzla:2026-11");
  assert.notEqual(countDraftKey("tuzla", "2026-11"), countDraftKey("marina", "2026-11"));
  // Şubesiz eski anahtar artık okunmaz (hangi şubenin olduğu bilinmiyor)
  assert.notEqual(countDraftKey("tuzla", "2026-11"), "laf:sayim-taslak:2026-11");
});

test("#8 taslak şubesini yazar; başka şubenin formu okumaz", () => {
  const json = countDraftJson({ values: { "12": "3,5" }, prefilled: [], extras: [{ name: "Peçete", unit: "PAKET", qty: "5", unitPrice: "" }], by: "Ayşe", branch: "tuzla" });
  const own = parseCountDraft(json, "tuzla");
  assert.deepEqual(own.values, { "12": "3,5" });
  assert.equal(own.branch, "tuzla");
  assert.equal(own.by, "Ayşe");
  const other = parseCountDraft(json, "marina");
  assert.deepEqual(other, { values: {}, prefilled: null, extras: null, by: null }, "Marina'nın formunda Tuzla'nın taslağı yok");
  // Şube verilmeden okuyan (eski çağrı) taslağı olduğu gibi görür; şubesi yazılmamış taslak her şubede okunur
  assert.deepEqual(parseCountDraft(json).values, { "12": "3,5" });
  const noBranch = countDraftJson({ values: { "12": "1" }, prefilled: [], extras: null, by: null });
  assert.deepEqual(parseCountDraft(noBranch, "marina").values, { "12": "1" });
  assert.equal(parseCountDraft(noBranch, "marina").branch, null);
});

test("#8 form taslağı şubesiyle yazar ve okur; sayfa şubeyi verir", () => {
  const form = read("src/app/panel/sayim/stock-form.tsx");
  assert.match(form, /const draftKey = countDraftKey\(branchId, month\);/);
  assert.doesNotMatch(form, /laf:sayim-taslak:\$\{month\}/, "şubesiz anahtar kalmadı");
  assert.match(form, /extrasBase: extrasDirty \? savedExtras\.map\(\(e\) => draftRow\(e, isAdmin\)\) : null,\s+branch: branchId,/);
  assert.match(form, /parseCountDraft\(storedDraft && !dirty && !draftGone \? storedDraft : null, branchId\)/);
  // Bant birden çok şube açıkken şubeyi söyler
  assert.match(form, /text=\{`\$\{branchLabel \? `\$\{branchLabel\} · ` : ""\}\$\{monthLabel\} sayımı; sayfa kapanmış ya da bağlantı gitmiş olabilir\.`\}/);
  const page = read("src/app/panel/sayim/page.tsx");
  assert.match(page, /key=\{`\$\{branch\.id\}:\$\{month\}`\}\s+branchId=\{branch\.id\}\s+branchLabel=\{branchLabel\}/);
});

// ---------------------------------------------------------------- #19/#24: "Listede olmayanlar" şube başına

test("#19/#24 şema ve migration: stock_extras.branch_id, eski satırlar Tuzla'nın, şube kütüğüne bağlı", () => {
  const schema = read("src/server/db/schema.ts");
  const table = schema.slice(schema.indexOf('export const stockExtras = pgTable("stock_extras"'));
  assert.match(table.slice(0, 400), /month: text\("month"\)\.notNull\(\),\s+branchId: branchId\(\),/);
  const sql = read("drizzle/0059_stok_ek_kalem_subesi.sql");
  assert.match(sql, /ALTER TABLE "stock_extras" ADD COLUMN "branch_id" text DEFAULT 'tuzla' NOT NULL;/);
  assert.match(sql, /UPDATE "stock_extras" SET "branch_id" = 'tuzla' WHERE "branch_id" IS NULL;/);
  assert.match(sql, /FOREIGN KEY \("branch_id"\) REFERENCES "public"\."branches"\("id"\)/);
  // Verisi olan şube silinmez: ek kalemler de sayılır (tests/subeler.test.ts bütün şube sütunlu tabloları denetler)
  assert.match(read("src/server/branches.ts"), /s\.stockCounts,\s+s\.stockExtras,/);
});

test("#19/#24 okuma şubeye göre: veri kümesi, Bugün'ün geçen ay satırı, Listeye ekle'nin ikizi", () => {
  assert.match(read("src/server/data/dataset.ts"), /db\.select\(\)\.from\(s\.stockExtras\)\.where\(branchWhere\(s\.stockExtras\.branchId, scope\)\)/);
  const today = read("src/server/data/today.ts");
  assert.match(today, /\.from\(s\.stockExtras\)\s+\.where\(and\(eq\(s\.stockExtras\.month, prevMonth\), eq\(s\.stockExtras\.branchId, sube\)\)\)/);
  const item = read("src/server/data/count-item.ts");
  assert.match(item, /const sube = \(await currentPhysicalBranch\(\)\)\.id;/);
  assert.match(item, /\.where\(and\(eq\(s\.stockExtras\.month, m\), eq\(s\.stockExtras\.branchId, sube\)\)\);/);
  // Ek kalem okuyan her sorgu şubeye bakar; işletme geneli kalanlar bilinçli: fiyat geçmişi ve fiyatsız kalem uyarısı
  const unscoped = (src: string) => [...src.matchAll(/\.from\(s\.stockExtras\)[^;]*;/g)].map((m) => m[0]).filter((q) => !/stockExtras\.branchId|buSube/.test(q));
  assert.deepEqual(unscoped(read("src/app/panel/sayim/actions.ts")), [".from(s.stockExtras).where(lt(s.stockExtras.month, m));"], "yalnız fiyat geçmişi");
  for (const f of ["src/server/actions/stock.ts", "src/server/data/stock-extras.ts", "src/server/data/today.ts", "src/server/data/count-item.ts"]) {
    assert.deepEqual(unscoped(read(f)), [], f);
  }
});

test("#19/#24 kayıt şubeye göre: kilit, eşleme, güncelleme, silme ve ekleme o şubenin listesiyle", () => {
  const core = read("src/server/data/stock-extras.ts");
  assert.match(core, /export async function lockExtras\(tx: Tx, month: string, branch: string, base: string \| undefined\)/);
  assert.match(core, /hashtext\(\$\{`sayim-ek-\$\{month\}-\$\{branch\}`\}\)/);
  assert.match(core, /\.where\(and\(eq\(s\.stockExtras\.month, month\), eq\(s\.stockExtras\.branchId, branch\)\)\)/);
  for (const f of ["src/app/panel/sayim/actions.ts", "src/server/actions/stock.ts"]) {
    const src = read(f);
    // Şube formun gösterdiği şube (formCountBranch; tests/sayim-sube-form.test.ts), yazım onun kapsamında
    assert.match(
      src,
      /const sube = await formCountBranch\(zFormBranch\.parse\(branchId\)\);\s+return withBranchScope\(sube, async \(\) => \{\s+const db = getDb\(\);\s+const buSube = and\(eq\(s\.stockExtras\.month, m\), eq\(s\.stockExtras\.branchId, sube\)\);/,
      f,
    );
    assert.match(src, /const existing = await lockExtras\(tx, m, sube, b\);/, f);
    assert.match(src, /\.where\(and\(eq\(s\.stockExtras\.id, u\.id\), buSube\)\)/, `${f}: güncelleme`);
    assert.match(src, /tx\.delete\(s\.stockExtras\)\.where\(and\(buSube, inArray\(s\.stockExtras\.id, deletes\)\)\)/, `${f}: silme`);
    assert.match(src, /month: m, branchId: sube \}\)\)\)/, `${f}: ekleme`);
    assert.match(src, /tx\.insert\(s\.months\)\.values\(\{ month: m, branchId: sube \}\)/, `${f}: ay satırı şubenin`);
  }
  // Boş ay satırı düşürülürken o şubenin ek kalemleri sayılır
  assert.match(read("src/server/actions/stock.ts"), /\.from\(s\.stockExtras\)\.where\(and\(eq\(s\.stockExtras\.month, month\), eq\(s\.stockExtras\.branchId, sube\)\)\)/);
});

test("#19/#24 fiyatsız ek kalem uyarısı şube başına: birden çok şube açıkken adı ve o şubenin sayımı", () => {
  const u = { month: "2026-11", count: 1, names: ["Peçete"], newestId: 7 };
  // Tek şube: metin ve adres bugünkü gibi
  assert.deepEqual(unpricedExtrasNotice({ ...u, branch: null }), unpricedExtrasNotice(u));
  assert.equal(unpricedExtrasNotice(u)!.title, "Kasım 2026: 1 ek kalemin fiyatı yok");
  assert.equal(unpricedExtrasNotice(u)!.href, "/panel/sayim?ay=2026-11#listede-olmayanlar");
  const marina = unpricedExtrasNotice({ ...u, branch: { id: "marina", name: "Marina" } })!;
  assert.equal(marina.title, "Kasım 2026 (Marina): 1 ek kalemin fiyatı yok");
  assert.equal(marina.href, "/panel/sayim?ay=2026-11&sube=marina#listede-olmayanlar");
  assert.equal(marina.id, unpricedExtrasNotice(u)!.id, "kimlik en yeni kalemden (şubeler arasında tek)");
  const alerts = read("src/server/data/count-alerts.ts");
  assert.match(alerts, /\.groupBy\(s\.stockExtras\.month, s\.stockExtras\.branchId\)/);
  assert.match(alerts, /branch: namedTill\(branches, t\.branchId\),/);
});

// ---------------------------------------------------------------- #20: elle yazılan devirler şube sayfasında

const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
const base: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
const M = "2026-10";
const P = shiftMonth(M, -1);
const withEntries = (extra: PnlEntry[]): Dataset => ({ ...base, pnlEntries: [...base.pnlEntries, ...extra] });
/** Sayım sayfasının şube modeli: dataset.ts'teki gibi stock:* hücreleri düşer (branchPnlEntry) */
const branchOf = (ds: Dataset): Dataset => ({
  ...ds,
  branchView: { id: "tuzla", name: "Tuzla", kind: "fiziksel" },
  pnlEntries: ds.pnlEntries.filter((e) => branchPnlEntry(e.rowKey, new Set(ds.fixedExpenses.map((f) => f.id)), new Set(ds.fixedExpenses.map((f) => f.id)))),
});

const scenarios: [string, PnlEntry[]][] = [
  ["elle yazılmamış", []],
  ["bu ayın açılışı elle", [{ month: M, rowKey: "stock:opening", amount: 12_345, note: null }]],
  ["geçen ayın devreden malı elle", [{ month: P, rowKey: "stock:closing", amount: 8_000, note: null }]],
  ["bu ayın stoğu elle", [{ month: M, rowKey: "stock:closing", amount: 85_000, note: null }]],
];

test("#20 şubesiz modelde eşdeğer: açılış ve kapanış uyarısı pnlMonth / closingStock ile aynı", () => {
  for (const [name, extra] of scenarios) {
    for (const prevCounted of [true, false]) {
      const ds = withEntries(extra);
      const model = createModel(ds);
      const ov = stockOverrides(ds.pnlEntries, M);
      assert.deepEqual(
        countOpeningOf(ov, model.closingStock(P).computed, prevCounted),
        countOpening(model.pnlMonth(M).cells.get("stock:opening")!, model.closingStock(P), prevCounted),
        `${name}: açılış`,
      );
      const cl = model.closingStock(M);
      assert.equal(ov.closing, cl.overridden ? cl.value : null, `${name}: kapanış`);
    }
  }
});

test("#20 şube modeli elle yazılan devri görmez; sayfanın okuduğu devirler ipucu ve uyarıyı geri getirir", () => {
  const ds = withEntries([
    { month: M, rowKey: "stock:opening", amount: 12_345, note: null },
    { month: M, rowKey: "stock:closing", amount: 85_000, note: null },
  ]);
  const branch = createModel(branchOf(ds));
  // Açığın kendisi: şube modelinde açılış hücresi boş, kapanış elle değil (eski sayfa ikisini de buradan okuyordu)
  assert.equal(branch.pnlMonth(M).cells.get("stock:opening")?.overridden, false);
  assert.equal(branch.closingStock(M).overridden, false);
  // Sayfa pnl_entries'ten okur: açılış K/Z'nin tutarı, ipucunda şubenin sayımı; kapanış uyarısı
  const ov = stockOverrides(ds.pnlEntries, M);
  const prevCount = branch.closingStock(P).computed;
  const o = countOpeningOf(ov, prevCount, true);
  assert.deepEqual(o, { value: 12_345, source: "acilis", counted: prevCount });
  assert.equal(ov.closing, 85_000);
  const tl = (v: number) => `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(v)} ₺`;
  assert.equal(
    plain(countOpeningNote(o, M, "Tuzla")),
    plain(`Gelir-giderde Ekim 2026 için "Önceki aydan devir" (işletme geneli) elle 12.345 ₺ girildi; işletmenin kâr-zararı bu tutarı kullanır. Eylül 2026 sayımı (Tuzla): ${tl(prevCount)}.`),
  );
  // Tek şube açıkken metin bugünkü gibi
  assert.equal(
    plain(countOpeningNote(o, M)),
    plain(`Gelir-giderde Ekim 2026 için "Önceki aydan devir" elle 12.345 ₺ girildi; kâr-zarar bu tutarı kullanır. Eylül 2026 sayımı: ${tl(prevCount)}.`),
  );
  const d = countOpeningOf({ closing: null, prevClosing: 8_000, opening: null }, 0, false);
  assert.deepEqual(d, { value: 8_000, source: "devreden", counted: null });
  assert.equal(plain(countOpeningNote(d, M, "Marina")), "Eylül 2026 stoğu (işletme geneli) Gelir-giderde elle 8.000 ₺ girildi; işletmenin açılışı o tutardır. Eylül 2026 sayımı (Marina) yok.");
  // Elle yazılmamışsa açılış şubenin kendi sayımı, ipucu yok
  const own = countOpeningOf({ closing: null, prevClosing: null, opening: null }, 5_000, true);
  assert.deepEqual(own, { value: 5_000, source: "sayim", counted: 5_000 });
  assert.equal(countOpeningNote(own, M, "Tuzla"), null);
});

test("#20 kapanış uyarısı: tek şubede bugünkü metin, birden çok şubede işletme geneli ve şubenin sayımı", () => {
  const one = closingOverrideText(M, 85_000, 92_000);
  assert.equal(plain(one.title), "Gelir-giderde Ekim 2026 stoğu elle 85.000 ₺: kâr-zarar bu sayımı kullanmaz");
  assert.equal(plain(one.text), "Bu sayım 92.000 ₺; kâr-zarar elle girilen tutarı kullanır.");
  assert.equal(plain(one.sentence), "Gelir-giderde bu ayın stoğu elle 85.000 ₺ girildi; kâr-zarar o tutarı kullanır.");
  const two = closingOverrideText(M, 85_000, 50_000, "Tuzla");
  assert.equal(plain(two.title), "Gelir-giderde Ekim 2026 stoğu (işletme geneli) elle 85.000 ₺: kâr-zarar bu sayımı kullanmaz");
  assert.equal(plain(two.text), "Bu sayım (Tuzla) 50.000 ₺; işletmenin kâr-zararı elle girilen tutarı kullanır.");
});

test("#20 sayfa devirleri işletme genelinden okur (yalnız yönetici), şubenin sayımıyla birleştirir", () => {
  const page = read("src/app/panel/sayim/page.tsx");
  assert.match(page, /loadModel\(\{ scope: branch\.id \}\)/, "sayım listesi ve tutarlar şubenin");
  assert.match(page, /isAdmin\s+\? db\s+\.select\(\{ month: s\.pnlEntries\.month, rowKey: s\.pnlEntries\.rowKey, amount: s\.pnlEntries\.amount \}\)/);
  assert.match(page, /inArray\(s\.pnlEntries\.rowKey, \["stock:closing", "stock:opening"\]\)/);
  assert.match(page, /const opening = isAdmin \? countOpeningOf\(overrides, model\.closingStock\(prevMonth\)\.computed, prev\.hasData\) : null;/);
  assert.match(page, /closingOverride=\{isAdmin \? overrides\.closing : null\}/);
  assert.match(page, /countOpeningNote\(opening, month, branchLabel\)/);
  const form = read("src/app/panel/sayim/stock-form.tsx");
  assert.match(form, /closingOverrideText\(month, closingOverride, live\.total, branchLabel\)/);
  assert.match(form, /title=\{override\.title\}\s+text=\{override\.text\}/);
  // Gelir-gider'in sözü yine doğru
  assert.match(read("src/lib/calc/engine.ts"), /Elle yazılırsa Stok sayımı kartındaki açılış da bu tutarı gösterir\./);
});
