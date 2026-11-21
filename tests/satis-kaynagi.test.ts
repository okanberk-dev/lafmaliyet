// Satış kaynağı tek yerden (docs/planlar/ux-sade.md §10, K20): ModPOS raporu, LafPOS, geçiş ayı ve ileride ModPOS
// bağlantısı. Ekranların hiçbiri "satış = ay sonunda elle yüklenen ModPOS raporu" varsaymaz; başlığın altındaki satır,
// "yükleyin" metinleri ve Genel bakış'ın Satış raporu işi `salesSourceOf`'tan okur. Personel dosyaları içe aktarmaz.
// Çalıştırma: npx tsx --test tests/satis-kaynagi.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import type { LafposSalesMonth } from "../src/lib/calc/types";
import { periodSalesSource, salesSourceOf } from "../src/lib/sales-source";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const nb = (s: string) => s.replace(/\u2060/g, "").replace(/\u00a0/g, " ");

function walk(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((n) => {
    const p = `${dir}/${n}`;
    return statSync(join(root, p)).isDirectory() ? walk(p) : [p];
  });
}

const gecis: LafposSalesMonth = {
  month: "2026-11",
  source: "gecis",
  from: "2026-11-10",
  lafpos: { days: 5, last: "2026-11-14" },
  modpos: { lines: 40, revenue: 120_000, through: "2026-11-09", counted: true },
  modposZ: null,
  gap: null,
  overlap: null,
};

test("dört kaynak: kısa ad, başlığın altındaki satır, veri yokken ne yapılır, elle mi", () => {
  const rapor = salesSourceOf("2026-10", null, undefined);
  assert.deepEqual(rapor, {
    kind: "modpos-rapor",
    label: "ModPOS raporu",
    line: "Satışlar: ModPOS raporu (ay sonunda elle yüklenir)",
    missing: "Satışlar'a ürün satış raporunu yükleyin",
    manual: true,
  });
  const laf = salesSourceOf("2026-12", "2026-11-10", { months: [] });
  assert.deepEqual(laf, { kind: "lafpos", label: "LafPOS", line: "Satışlar: LafPOS (her gece kendiliğinden)", missing: "LafPOS gün sonları her gece gelir", manual: false });
  const g = salesSourceOf("2026-11", "2026-11-10", { months: [gecis] });
  assert.equal(g.kind, "gecis");
  assert.equal(g.label, "ModPOS raporu + LafPOS");
  assert.equal(nb(g.line), "Satışlar: Kasa (ModPOS 1–9 Kasım · LafPOS 10–14 Kasım)");
  assert.equal(g.manual, true);
  assert.match(g.missing, /ModPOS raporunu yükleyin; LafPOS gün sonları her gece gelir$/);
  const bag = salesSourceOf("2026-10", null, undefined, new Set(["2026-10"]));
  assert.deepEqual(bag, {
    kind: "modpos-baglanti",
    label: "ModPOS bağlantısı",
    line: "Satışlar: ModPOS bağlantısı (kendiliğinden)",
    missing: "ModPOS bağlantısı bu ayı henüz getirmedi",
    manual: false,
  });
});

test("geçiş günü yokken her ay ModPOS raporu; geçişten önceki ay da; bağlantı gelince o ay bağlantıdan (öncelik)", () => {
  for (const m of ["2025-12", "2026-01", "2026-10", "2027-03"]) assert.equal(salesSourceOf(m, null, undefined).kind, "modpos-rapor", m);
  assert.equal(salesSourceOf("2026-10", "2026-11-10", { months: [gecis] }).kind, "modpos-rapor");
  // Bağlantının getirdiği ay LafPOS ve geçiş ayından da önce gelir; getirmediği ay eski kuralla
  const connected = new Set(["2026-11", "2026-12"]);
  assert.equal(salesSourceOf("2026-11", "2026-11-10", { months: [gecis] }, connected).kind, "modpos-baglanti");
  assert.equal(salesSourceOf("2026-12", "2026-11-10", { months: [] }, connected).kind, "modpos-baglanti");
  assert.equal(salesSourceOf("2027-01", "2026-11-10", { months: [] }, connected).kind, "lafpos");
  // Geçiş ayının listesi ayın tamamını kapsıyorsa (LafPOS sayılmıyor) ay ModPOS'tur: monthKasa ile aynı kural
  assert.equal(salesSourceOf("2026-11", "2026-11-10", { months: [{ ...gecis, from: null }] }).kind, "modpos-rapor");
});

test("birden çok ay (Gelir-gider'in yılı): hepsi aynı türdense sonuncusu, karışıksa \"Satışlar: ModPOS / LafPOS\"", () => {
  const year = (y: number) => Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`);
  // Geçiş günü yok: bütün ay ModPOS raporu
  assert.equal(periodSalesSource(year(2026), null, undefined).line, "Satışlar: ModPOS raporu (ay sonunda elle yüklenir)");
  // Geçiş 10 Kasım 2026: 2026 yılı Ocak–Ekim ModPOS, Kasım geçiş, Aralık LafPOS → karışık. Eski satır yalnız Aralık'ın
  // ("LafPOS") ya da bu ayın kaynağını yazıyordu
  const mixed = periodSalesSource(year(2026), "2026-11-10", { months: [gecis] });
  assert.equal(mixed.line, "Satışlar: ModPOS / LafPOS");
  assert.equal(salesSourceOf("2026-12", "2026-11-10", { months: [gecis] }).line, "Satışlar: LafPOS (her gece kendiliğinden)");
  // Bu aya kadarki aylar (Ekim 2026): hepsi ModPOS
  assert.equal(periodSalesSource(year(2026).slice(0, 10), "2026-11-10", { months: [gecis] }).kind, "modpos-rapor");
  // Ocak–Kasım: ModPOS + geçiş ayı → karışık
  assert.equal(periodSalesSource(year(2026).slice(0, 11), "2026-11-10", { months: [gecis] }).line, "Satışlar: ModPOS / LafPOS");
  // Bütün yıl LafPOS
  assert.equal(periodSalesSource(year(2027), "2026-11-10", { months: [] }).line, "Satışlar: LafPOS (her gece kendiliğinden)");
  assert.throws(() => periodSalesSource([], null, undefined));
});

test("bağlananlar: altı yönetici ekranının başlığında satır; yükleyin metinleri ve Satış raporu işi kaynağa bağlı", () => {
  const META = ["src/app/panel/page.tsx", "src/app/panel/satislar/page.tsx", "src/app/panel/gelir-gider/page.tsx", "src/app/panel/urunler/page.tsx", "src/app/panel/tutarlilik/page.tsx", "src/app/panel/analiz/page.tsx"];
  for (const f of META) {
    const src = read(f);
    assert.match(src, /meta=\{<SalesSourceLine source=\{/, f);
    assert.match(src, /salesSourceOf\(|periodSalesSource\(/, f);
  }
  // Gelir-gider bir yılın tablosu: satır yılın bu aya kadarki aylarından (yalnız bir ayın kaynağı değil)
  assert.match(read("src/app/panel/gelir-gider/page.tsx"), /periodSalesSource\(sourceMonths, model\.settings\.lafposGecisGunu, model\.ds\.lafposSales\)/);
  // Kaynağı sormayan metinler "yükle" demez: satış verisi gelince (Genel bakış, Hammaddeler ve Ayarlar'ın su metni, Tutarlılık)
  for (const f of ["src/app/panel/page.tsx", "src/app/panel/hammaddeler/breakdowns.ts", "src/app/panel/ayarlar/water-text.ts", "src/app/panel/tutarlilik/page.tsx"]) {
    assert.doesNotMatch(read(f), /[sS]atış raporu yüklenince|[sS]atış listesini yükleyin|Bu ay(?: için)? satış raporu yok/, f);
  }
  // "Satış verisi yok, yükleyin" diyen metinler `missing`'i kullanır; düğme yalnız elle yüklenen ayda "yükle"
  for (const f of ["src/app/panel/analiz/page.tsx", "src/app/panel/urunler/fiyatlar/bulk-editor.tsx", "src/app/panel/urunler/price-impact-panel.tsx", "src/app/panel/tutarlilik/page.tsx", "src/app/panel/tutarlilik/consistency-client.tsx"]) {
    const src = read(f);
    assert.match(src, /[sS]alesMissing|source\.missing|salesSource\.missing/, f);
    assert.doesNotMatch(src, /Satışlar(&apos;|')a ürün satış raporunu yükleyin|Satışlar sayfasından ürün satış raporunu yükleyin|POS ürün listesi yüklenince/, f);
  }
  assert.match(read("src/app/panel/tutarlilik/consistency-client.tsx"), /salesSource\.manual \? "Satış raporu yükle" : "Satışlar'a git"/);
  const tasks = read("src/app/panel/dashboard-tasks.tsx");
  assert.match(tasks, /salesSourceOf\(month, lp\?\.switchDay \?\? model\.settings\.lafposGecisGunu, lp\)/);
  assert.match(tasks, /s\.source \? !s\.source\.manual : s\.lafpos\?\.source === "lafpos"/);
  // Satışlar'ın açıklaması kaynağa göre; eski uzun metinler ⓘ'de, "Patron (ModPOS)" yerine "ModPOS"
  const sales = read("src/app/panel/satislar/page.tsx");
  assert.match(sales, /description=\{DESCRIPTION\[source\.kind\]\}/);
  assert.doesNotMatch(sales, /Patron \(ModPOS\)/);
});

test("personel dosyaları satış kaynağını, vergi sözlüğünü ve gecikmiş vergi satırını içe aktarmaz", () => {
  const STAFF_DIRS = ["bugun", "kasa", "siparisler", "karaoke", "kontrol", "zayi", "receteler", "sayim", "hatirlaticilarim", "ozel-gunler"].map((d) => `src/app/panel/${d}`);
  const files = STAFF_DIRS.flatMap(walk).filter((f) => /\.tsx?$/.test(f));
  assert.ok(files.length > 50, String(files.length));
  for (const f of files) assert.doesNotMatch(read(f), /from "@\/lib\/sales-source"|from "@\/lib\/tax\/glossary"|from "@\/lib\/tax\/overdue"|sales-source-line"/, f);
});
