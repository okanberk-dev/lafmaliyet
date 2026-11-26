// Gelir-gider satırlarının kaynak bağlantıları ve Stok sayımı kartının açılışı (denetim B16, E-30): her satır tutarın
// geldiği ekrana o ayla gider (faturalar, harcamalar, stok sayımı, komisyon, personel, sabit giderler, satışlar), o ayda
// faturası olmayan tedarikçi satırı bağlantısızdır; Sayım kartının açılışı kâr-zararınkiyle aynıdır, elle girildiyse söyler.
// Çalıştırma: npx tsx --test tests/gelir-gider-baglanti.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { UNPAID_VS_PAYMENTS } from "../src/app/panel/faturalar/rules";
import { rowLink } from "../src/app/panel/gelir-gider/row-links";
import { countOpening, countOpeningNote } from "../src/app/panel/sayim/logic";
import { createModel } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const data: SeedData = JSON.parse(read("tests/fixtures/baslangic/veri.json"));
const base: Dataset = { ...datasetFromSeed(data), currentMonth: "2026-10" };
/** ₺ ile tutar arasındaki bölünmez boşluk düz boşluk olur */
const plain = (s: string | null) => s?.replace(/ /g, " ") ?? null;

// ---------------------------------------------------------------- rowLink

test("rowLink: her satır tutarın geldiği ekrana, o ayla", () => {
  const m = "2026-10";
  assert.deepEqual(rowLink("purchase:Mipak", m, { value: 1_200 }), { href: "/panel/faturalar?ay=2026-10&ara=Mipak#fatura-listesi", label: "Faturalar · Ekim 2026", scope: "month" });
  // Adında boşluk ve Türkçe harf olan tedarikçi adresle kodlanır
  assert.equal(rowLink("purchase:Erbak Uludağ", m, { value: 10 })!.href, "/panel/faturalar?ay=2026-10&ara=Erbak+Uluda%C4%9F#fatura-listesi");
  assert.equal(rowLink("expense:4", m)!.href, "/panel/harcamalar?ay=2026-10");
  assert.equal(rowLink("stock:closing", m, { current: m })!.href, "/panel/sayim?ay=2026-10");
  assert.equal(rowLink("stock:closing", m, { current: m })!.label, "Stok sayımı · Ekim 2026");
  // Açılış önceki ayın sayımıdır
  assert.equal(rowLink("stock:opening", m, { current: m })!.href, "/panel/sayim?ay=2026-09");
  assert.equal(rowLink("stock:opening", "2026-01")!.href, "/panel/sayim?ay=2025-12", "yıl sınırı");
  // Komisyon faturası: o ayın tarihli Komisyon faturaları (Gelir-gider'in saydığı faturalar; Komisyon & hakediş 1-5'inde
  // kesileni önceki aya koyar ve yalnız son 13 ayı açar)
  assert.deepEqual(rowLink("commission:Pluxee Türkiye", m, { value: 30 }), {
    href: "/panel/faturalar?kategori=Komisyon&ay=2026-10&ara=Pluxee+T%C3%BCrkiye#fatura-listesi",
    label: "Faturalar · Ekim 2026",
    scope: "month",
  });
  assert.equal(rowLink("commission:Pluxee", "2024-07", { value: 30 })!.href, "/panel/faturalar?kategori=Komisyon&ay=2024-07&ara=Pluxee#fatura-listesi", "pencere yok");
  // POS komisyonunun kartlı satış oranı Satışlar'da; ad sayfanın adı
  assert.deepEqual(rowLink("commission:pos", m), { href: "/panel/satislar?ay=2026-10#m-card", label: "Satışlar · Ekim 2026", scope: "month" });
  assert.equal(rowLink("revenue", m)!.href, "/panel/satislar?ay=2026-10#m-pos");
  assert.deepEqual(rowLink("personnel:net", m), { href: "/panel/personel", label: "Maaşlar", scope: "row" });
  assert.deepEqual(rowLink("personnel:employer", m)?.scope, "row");
  assert.deepEqual(rowLink("fixed:12", m), { href: "/panel/giderler", label: "Sabit giderler", scope: "row" });
});

test("rowLink: o ayda faturası olmayan tedarikçi ve komisyon satırı bağlantısız (boş aramaya gitmez)", () => {
  // Tablo, yılın başka ayında faturası olan tedarikçinin satırını bu ayda "–" ile gösterir
  assert.equal(rowLink("purchase:Mipak", "2026-10", { value: null }), null);
  assert.equal(rowLink("commission:Pluxee", "2026-10", { value: null }), null);
  // 0 tutar (iade ile sıfırlanan ay) bir faturadır: bağlantı kalır
  assert.ok(rowLink("purchase:Mipak", "2026-10", { value: 0 }));
  // Değeri bilinmiyorsa (Genel bakış'ın dökümü yalnız o ayın satırlarını verir) bağlantı var
  assert.ok(rowLink("purchase:Mipak", "2026-10"));
});

test("rowLink: stok sayımı bağlantısı bu aydan sonraki aya gitmez; toplamlar ve elle satırlar bağlantısız", () => {
  assert.equal(rowLink("stock:closing", "2026-11", { current: "2026-10" }), null, "Kasım henüz sayılmaz");
  // Kasım'ın açılışı Ekim'in sayımı: bu ay, bağlantı var
  assert.equal(rowLink("stock:opening", "2026-11", { current: "2026-10" })!.href, "/panel/sayim?ay=2026-10");
  assert.equal(rowLink("stock:opening", "2026-12", { current: "2026-10" }), null);
  for (const k of ["total:mal", "total:cogs", "profit", "ratio:profit", "revenueNet", "manual:diger_mal", "stock:purchased", "site:cafe", "revenue:total"]) {
    assert.equal(rowLink(k, "2026-10"), null, k);
  }
});

test("rowLink tek kaynak: tablo, telefon görünümü ve Genel bakış aynı yardımcıyı kullanır", () => {
  const grid = read("src/app/panel/gelir-gider/pnl-grid.tsx");
  const phone = read("src/app/panel/gelir-gider/month-view.tsx");
  const dash = read("src/app/panel/dashboard-breakdowns.ts");
  for (const [name, src] of [
    ["pnl-grid", grid],
    ["month-view", phone],
    ["dashboard-breakdowns", dash],
  ] as const) {
    assert.match(src, /rowLink\(/, `${name} rowLink kullanır`);
    assert.doesNotMatch(src, /\/panel\/faturalar\?ara=/, `${name} fatura adresini kendisi kurmaz`);
  }
  // Izgarada girilebilen hücrede (stok, ciro, POS komisyonu) bağlantı simgesi, girilemeyende tutarın kendisi bağlantı;
  // her ikisi de değeri ve bu ayı verir (faturasız ay, gelecek ayın sayımı bağlantısız)
  assert.match(grid, /rowLink\(def\.key, m, \{ value: c\.value, current \}\)/);
  assert.match(grid, /<SourceLink link=\{monthLink\}/);
  // Girilebilen hücrenin bağlantısı yalnız gösterimde: düzenlerken kutu hücrenin bütün genişliğini alır (dokunmatikte
  // rakamın başı kesilmesin)
  assert.match(grid, /source=\{monthLink \? <SourceLink link=\{monthLink\}/);
  const editing = grid.slice(grid.indexOf("if (editing) {"), grid.indexOf("const help = muted"));
  assert.ok(editing.length > 100 && !editing.includes("{source}"), "düzenleme kutusunun yanında bağlantı yok");
  // Uyarı ve ayın açıklaması dokunmatikte de okunur: dokununca açılan ipucu (yalnız title değil)
  assert.match(grid, /const tip = \[warn \? `Dikkat: \$\{warn\}` : null, info \?\? null\]/);
  assert.match(grid, /<InfoTip text=\{tip\} tone=\{warn \? "warn" : undefined\}/);
  // Yardım ve tablonun altı Satışlar hedeflerini ve telefondaki dokunuşu da söyler
  assert.match(grid, /satışları \(ciro, kartlı satış oranı\)/);
  const help = read("src/app/panel/yardim/page.tsx").replace(/\s+/g, " ");
  assert.match(help, /satışları: ciro ve kartlı satış oranı/);
  assert.match(help, /Telefonda satıra ya da düzenleme penceresindeki bağlantıya dokunun/);
  // Telefonda bağlantılı satır açıklamasını (i) korur
  assert.match(phone, /<Link\s+href=\{source\.href\}\s+className="absolute inset-0[^"]*"[\s\S]{0,200}\/>\s*\{label\}\s*\{def\.hint \? <InfoTip/);
  assert.match(grid, /rowSource\?\.scope === "row" \? <SourceLink/);
  assert.match(phone, /rowLink\(def\.key, month, \{ value: c\.value, current: currentMonth \}\)/);
  // Telefonda girilebilen satırın sayfasında kaynağa bağlantı
  assert.match(phone, /target\.source \?/);
});

// ---------------------------------------------------------------- Sayım kartının açılışı

test("Sayım açılışı K/Z'ninki: bu ayın 'Önceki aydan devir'i elle girildiyse o tutar ve 'elle girildi' ipucu", () => {
  const plainModel = createModel(base);
  const pm0 = plainModel.pnlMonth("2026-10");
  const o0 = countOpening(pm0.cells.get("stock:opening")!, plainModel.closingStock("2026-09"));
  assert.equal(o0.source, "sayim");
  assert.equal(o0.value, pm0.opening);
  assert.equal(countOpeningNote(o0, "2026-10"), null, "sayımdan geliyorsa ipucu yok");

  // Ekim'in açılışı Gelir-giderde elle 12.345 ₺ yazıldı: K/Z bunu kullanır, Sayım kartı da
  const model = createModel({ ...base, pnlEntries: [...base.pnlEntries, { month: "2026-10", rowKey: "stock:opening", amount: 12_345, note: null }] });
  const pm = model.pnlMonth("2026-10");
  const o = countOpening(pm.cells.get("stock:opening")!, model.closingStock("2026-09"));
  assert.equal(pm.opening, 12_345);
  assert.deepEqual(o, { value: 12_345, source: "acilis", counted: model.closingStock("2026-09").computed });
  assert.notEqual(o.value, model.closingStock("2026-09").value, "eski kural (geçen ayın kapanışı) farklı rakam gösterirdi");
  assert.equal(
    plain(countOpeningNote(o, "2026-10")),
    `Gelir-giderde Ekim 2026 için "Önceki aydan devir" elle 12.345 ₺ girildi; kâr-zarar bu tutarı kullanır. Eylül 2026 sayımı: ${plain(
      new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(o.counted),
    )} ₺.`,
  );
});

test("Sayım açılışı: geçen ay hiç sayılmadıysa ipucu '0 ₺' değil 'sayımı yok' der", () => {
  const model = createModel({ ...base, pnlEntries: [...base.pnlEntries, { month: "2026-10", rowKey: "stock:opening", amount: 12_345, note: null }] });
  const o = countOpening(model.pnlMonth("2026-10").cells.get("stock:opening")!, model.closingStock("2026-09"), false);
  assert.deepEqual(o, { value: 12_345, source: "acilis", counted: null });
  assert.equal(plain(countOpeningNote(o, "2026-10")), `Gelir-giderde Ekim 2026 için "Önceki aydan devir" elle 12.345 ₺ girildi; kâr-zarar bu tutarı kullanır. Eylül 2026 sayımı yok.`);
  const d = countOpening({ value: 8_000, overridden: false }, { value: 8_000, computed: 0, overridden: true }, false);
  assert.equal(plain(countOpeningNote(d, "2026-10")), "Eylül 2026 stoğu Gelir-giderde elle 8.000 ₺ girildi; açılış o tutardır. Eylül 2026 sayımı yok.");
  // Sayfa önceki ayın sayılıp sayılmadığını verir
  assert.match(read("src/app/panel/sayim/page.tsx"), /model\.closingStock\(prevMonth\)\.computed, prev\.hasData\)/);
});

test("Sayım açılışı: geçen ayın devreden malı elle girildiyse o tutar ve ipucu", () => {
  const model = createModel({ ...base, pnlEntries: [...base.pnlEntries, { month: "2026-09", rowKey: "stock:closing", amount: 8_000, note: null }] });
  const pm = model.pnlMonth("2026-10");
  const o = countOpening(pm.cells.get("stock:opening")!, model.closingStock("2026-09"));
  assert.equal(o.source, "devreden");
  assert.equal(o.value, 8_000);
  assert.equal(o.value, pm.opening, "K/Z ile aynı");
  assert.match(plain(countOpeningNote(o, "2026-10"))!, /^Eylül 2026 stoğu Gelir-giderde elle 8\.000 ₺ girildi; açılış o tutardır\./);
});

test("Sayım sayfası açılışı K/Z'nin elle yazılan devirleriyle (işletme geneli) ve yalnız yöneticiye hesaplar", () => {
  // Sayfa şubenin modeliyle açılır; o model stock:* hücrelerini görmez, devirler ayrıca okunur (21 Kasım denetimi #20;
  // eşdeğerlik tests/sayim-sube.test.ts)
  const page = read("src/app/panel/sayim/page.tsx");
  assert.match(page, /const overrides = stockOverrides\(stockEntries, month\);/);
  assert.match(page, /const opening = isAdmin \? countOpeningOf\(overrides, /);
  assert.doesNotMatch(page, /const opening = model\.closingStock\(prevMonth\)/);
  assert.doesNotMatch(page, /model\.pnlMonth\(month\)\.cells\.get\("stock:opening"\)/, "şube modelinde bu hücre hep boş");
});

// ---------------------------------------------------------------- Metinler (E-61, E-63)

test("E-61: Faturalar'ın 'Ödenmemiş' ipucu Ödemeler'le aynı rakam demez; avans ve faturasız borç farkını söyler", () => {
  const page = read("src/app/panel/faturalar/page.tsx");
  assert.doesNotMatch(page, /Hatırlatıcılar da aynı tutarı kullanır/);
  assert.match(page, /\$\{UNPAID_VS_PAYMENTS\}/);
  assert.match(UNPAID_VS_PAYMENTS, /Ödemeler aynı kalan tutardan başlar/);
  assert.match(UNPAID_VS_PAYMENTS, /avans/);
  assert.match(UNPAID_VS_PAYMENTS, /faturasız borçları ekler/);
});

test("E-63: 'Faturası beklenen alımlar' notu KDV dahil olduğunu söyler (tablo KDV hariç)", () => {
  assert.match(read("src/app/panel/gelir-gider/pnl-grid.tsx"), /Faturası beklenen alımlar \(KDV dahil; bu ayların giderinde yok\)/);
  assert.match(read("src/app/panel/gelir-gider/month-view.tsx"), /Faturası beklenen alımlar \(KDV dahil\): /);
});
