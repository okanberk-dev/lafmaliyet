// Şube 3: stok ve zayi, saf kurallar ve kaynak denetimi (denetim 13 Kasım 2026, P04; veritabanı testi
// tests/sube-stok-zayi-db.test.ts). LafPOS gün sonunun anahtarı şubeyi taşır, ürün ikramı reddi yalnız kasası LafPOS
// olan şubede (ST-X1); sayım hatırlatması o ayda açık şubeye (ST-04); fiyatsız ek kalem uyarısı şubesini yazar (ST-01);
// zayi okumaları ve kasa raporunun zayisi şubeye göre (ST-02); stok ekranının ortak fatura notu (ST-06).
// Çalıştırma: npx tsx --test tests/sube-stok-zayi.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { unpricedExtrasNotice } from "../src/app/panel/sayim/logic";
import { branchOpenIn } from "../src/lib/branches";
import { createModel } from "../src/lib/calc/engine";
import type { Dataset, WasteEntry } from "../src/lib/calc/types";
import { branchSwitchDay, lafposDayKey, panelWasteCounts, productIkramClosed, productIkramRefusal } from "../src/lib/lafpos/ikram";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const S = "2026-11-10";

test("ST-X1: gün sonu yalnız kendi şubesinin panel kaydını düşürür; şubesiz kayıt günle eşleşir", () => {
  const tuzlaDay = new Set([lafposDayKey("2026-11-12", "tuzla")]);
  const ikram = { date: "2026-11-12", kind: "ikram" as const, productId: 5 };
  assert.equal(panelWasteCounts({ ...ikram, branchId: "tuzla" }, tuzlaDay), false, "Tuzla'nın ürün ikramı LafPOS'tan");
  assert.equal(panelWasteCounts({ ...ikram, branchId: "marina" }, tuzlaDay), true, "Marina'nınki sayılır");
  assert.equal(panelWasteCounts({ ...ikram, branchId: "tuzla", productId: null }, tuzlaDay), true, "hammadde ikramı");
  // Şubelerden önceki saf veri: anahtar yalnız gün
  assert.equal(lafposDayKey("2026-11-12"), "2026-11-12");
  assert.equal(panelWasteCounts(ikram, new Set(["2026-11-12"])), false);
});

test("ST-X1: ürün ikramı yalnız kasası LafPOS olan şubede panelden kapanır", () => {
  assert.equal(branchSwitchDay(S, "lafpos"), S);
  assert.equal(branchSwitchDay(S, "modpos"), null);
  assert.equal(branchSwitchDay(null, "lafpos"), null);
  assert.equal(branchSwitchDay(S, undefined), null, "şube bulunamadı");
  const today = { received: false, today: "2026-11-12" };
  const w = { date: "2026-11-12", kind: "ikram" as const, productId: 5 };
  assert.ok(productIkramRefusal(w, branchSwitchDay(S, "lafpos"), today), "Tuzla: bugün LafPOS'ta işaretlenir");
  assert.equal(productIkramRefusal(w, branchSwitchDay(S, "modpos"), today), null, "Marina: panele girer");
  assert.equal(productIkramClosed("2026-11-12", branchSwitchDay(S, "modpos"), today), false);
});

test("ST-X1: motor \"Tümü\"de Marina'nın ürün ikramını Tuzla'nın LafPOS gününde de sayar", () => {
  const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
  const ds: Dataset = { ...excelToDataset(data), currentMonth: "2026-11" };
  const product = ds.products.find((p) => p.active && ds.recipeItems.some((r) => r.productId === p.id))!;
  const panel: WasteEntry[] = [
    { date: "2026-11-12", branchId: "tuzla", kind: "ikram", productId: product.id, ingredientId: null, qty: 3, factor: 1 },
    { date: "2026-11-12", branchId: "marina", kind: "ikram", productId: product.id, ingredientId: null, qty: 2, factor: 1 },
  ];
  const model = createModel({
    ...ds,
    wasteEntries: panel,
    lafposIkram: {
      switchDay: S,
      days: [lafposDayKey("2026-11-12", "tuzla")],
      lines: [{ date: "2026-11-12", branchId: "tuzla", kind: "ikram", posName: "LATTE", productId: product.id, qty: 1, menuValue: 170, reason: null }],
    },
  });
  const sum = model.wasteSummary("2026-11");
  // Marina'nın 2'si ve LafPOS'un 1'i sayılır; Tuzla'nın panel ikramı sayılmaz
  assert.deepEqual([sum.ikram.count, sum.ikram.lafpos, sum.notCounted], [2, 1, 1]);
  assert.deepEqual(
    model.countedWaste.map((w) => [w.branchId, w.qty, w.source ?? "panel"]),
    [
      ["marina", 2, "panel"],
      ["tuzla", 1, "lafpos"],
    ],
  );
});

test("ST-04: sayım hatırlatması o ayda açık şubeye: açılış günü boşsa açık, yazılıysa o aydan", () => {
  assert.equal(branchOpenIn({ openedOn: null }, "2026-09"), true, "Tuzla ve açılış günü boş Marina");
  assert.equal(branchOpenIn({ openedOn: "2026-10-15" }, "2026-10"), true, "ay ortasında açılan şubenin ilk ayı");
  assert.equal(branchOpenIn({ openedOn: "2026-11-04" }, "2026-10"), false, "henüz açılmamış");
  assert.equal(branchOpenIn({ openedOn: "2026-11-04" }, "2026-12"), true);
});

test("ST-01: fiyatsız ek kalem uyarısı birden çok şubede şubesini yazar ve o şubenin sayımına götürür", () => {
  const u = { month: "2026-10", count: 2, names: ["Peçete", "Klips"], newestId: 7 };
  assert.deepEqual(unpricedExtrasNotice({ ...u, branch: { id: "marina", label: "Marina" } }), {
    id: "sayim-ek-fiyatsiz-2026-10-marina-2-7",
    title: "Marina · Ekim 2026: 2 ek kalemin fiyatı yok",
    body: "Peçete, Klips · Birim fiyatı girilmezse kapanış stoğuna 0 ₺ girer, ayın mal maliyeti o kadar yüksek çıkar.",
    href: "/panel/sayim?ay=2026-10&sube=marina#listede-olmayanlar",
  });
  // Tek şubede ve şubesiz eskisi gibi; Tuzla'nın kimliği değişmez
  const plain = unpricedExtrasNotice(u)!;
  assert.deepEqual(unpricedExtrasNotice({ ...u, branch: { id: "tuzla", label: null } }), plain);
  assert.equal(unpricedExtrasNotice({ ...u, branch: { id: "tuzla", label: "Tuzla" } })!.id, plain.id);
  assert.equal(plain.href, "/panel/sayim?ay=2026-10#listede-olmayanlar");
});

test("ST-01: ek kalemin bütün okuma ve yazmaları şubeli; migration eski satırları Tuzla'ya yazar", () => {
  const sql = read("drizzle/0060_ek_kalem_subesi.sql");
  assert.match(sql, /ALTER TABLE "stock_extras" ADD COLUMN "branch_id" text DEFAULT 'tuzla' NOT NULL/);
  assert.match(sql, /REFERENCES "public"\."branches"\("id"\)/);
  assert.match(sql, /UPDATE "stock_extras" SET "branch_id" = 'tuzla'/);
  assert.match(read("src/server/db/schema.ts"), /export const stockExtras = pgTable\("stock_extras", \{\s+id: serial\("id"\)\.primaryKey\(\),\s+month: text\("month"\)\.notNull\(\),\s+branchId: branchId\(\),/);
  assert.match(read("src/server/data/dataset.ts"), /db\.select\(\)\.from\(s\.stockExtras\)\.where\(branchWhere\(s\.stockExtras\.branchId, scope\)\)/);
  assert.match(read("src/server/branches.ts"), /s\.stockCounts,\s+s\.stockExtras,/);
  // Bütün sorgular (personelin fiyat geçmişi hariç: kalemin fiyatı işletmenin) ay ile birlikte şubeyi de koşar
  for (const file of ["src/server/actions/stock.ts", "src/app/panel/sayim/actions.ts", "src/server/data/count-item.ts", "src/server/data/today.ts"]) {
    const src = read(file);
    const plainMonth = [...src.matchAll(/where\(eq\(s\.stockExtras\.month, \w+\)\)/g)];
    assert.equal(plainMonth.length, 0, `${file}: şubesiz ek kalem sorgusu`);
  }
  assert.match(read("src/app/panel/sayim/actions.ts"), /await tx\.insert\(s\.months\)\.values\(\{ month: m, branchId: sube \}\)\.onConflictDoNothing\(\);/);
});

test("ST-02, ST-06: zayi okumaları şubeli, kasa raporunun zayisi raporun şubesinden; stok ekranında ortak fatura notu", () => {
  assert.match(read("src/server/data/waste.ts"), /lte\(s\.wasteEntries\.date, to\), await currentBranchWhere\(s\.wasteEntries\.branchId\)/);
  assert.match(read("src/server/actions/cash-report.ts"), /withBranchScope\(r\.branchId, \(\) => dayWaste\(d\)\)/);
  assert.match(read("src/server/cash/report-email.ts"), /withBranchScope\(row\.branchId, \(\) => dayWaste\(row\.date\)\)/);
  const page = read("src/app/panel/zayi/page.tsx");
  assert.match(page, /inBranch\(\(\) => wasteEntriesBetween\(date, date\)\)/);
  assert.match(page, /inBranch\(\(\) => loadDayLafposIkram\(date\)\)/);
  assert.match(page, /await wasteLock\(getDb\(\), date, branch\.id\)/);
  assert.match(read("src/server/data/today.ts"), /withBranchScope\(sube, \(\) => safe\(dayWaste\(c\.day\)\)\)/);
  assert.match(read("src/app/panel/sayim/stock-form.tsx"), /Faturalar şubelere bölünmez: şube tutarları aynı faturaları paylaşır, toplamları Tümü&apos;yle tutmaz\./);
  assert.match(read("src/app/panel/sayim/page.tsx"), /shared: branchLabel !== null/);
});
