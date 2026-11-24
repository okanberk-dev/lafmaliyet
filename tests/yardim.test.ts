// Yardım: menü yolları ve Excel karşılıkları kenar çubuğu ağacından (src/app/panel/yardim/nav-paths.ts); sayfadaki
// her ekran yolu çözülür, her bağlantı var olan bir ekrana gider.
// Çalıştırma: npx tsx --test tests/yardim.test.ts

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { excelFor, pathOf, tabsOf } from "../src/app/panel/yardim/nav-paths";
import { NAV_TREE, SECTION_TABS } from "../src/components/panel/nav";

const PAGE = readFileSync(join(process.cwd(), "src/app/panel/yardim/page.tsx"), "utf8");

test("menü öğesi ve alt sayfa yolları kenar çubuğundaki adlarla", () => {
  assert.deepEqual(pathOf("/panel"), ["Genel bakış"]);
  assert.deepEqual(pathOf("/panel/satislar"), ["Satış", "Satışlar"]);
  assert.deepEqual(pathOf("/panel/giderler"), ["Alış & gider", "Giderler & maaşlar"]);
  assert.deepEqual(pathOf("/panel/hatirlaticilar"), ["Kâr & ödemeler", "Ödemeler"]);
  assert.deepEqual(pathOf("/panel/tutarlilik"), ["Stok", "Tutarlılık"]);
  assert.deepEqual(pathOf("/panel/parasut"), ["Ayarlar", "Paraşüt entegrasyonu"]);
  assert.deepEqual(pathOf("/panel/komisyonlar"), ["Satış", "Komisyon & hakediş"]);
  // Personelde üst düzeyde de duran ekranlar yöneticinin başlığıyla; en sık açılanlar iki rolde de üst düzeyde
  assert.deepEqual(pathOf("/panel/karaoke"), ["Kafe", "Karaoke"]);
  assert.deepEqual(pathOf("/panel/kontrol"), ["Kafe", "Kontrol listeleri"]);
  assert.deepEqual(pathOf("/panel/hatirlaticilarim"), ["Kafe", "Hatırlatıcılarım"]);
  assert.deepEqual(pathOf("/panel/kasa"), ["Kasa raporu"]);
  assert.deepEqual(pathOf("/panel/onaylar"), ["Onaylar"]);
  assert.deepEqual(pathOf("/panel/bugun"), ["Bugün"]);
  assert.deepEqual(pathOf("/panel/gelir-gider"), ["Kâr & ödemeler", "Gelir-gider"]);
  assert.deepEqual(pathOf("/panel/yok"), []);
});

test("menüde ayrı öğesi olmayan sekme, menü öğesinin altında (Aylık harcamalar boş çıkmaz)", () => {
  assert.deepEqual(pathOf("/panel/harcamalar"), ["Alış & gider", "Giderler & maaşlar", "Aylık harcamalar"]);
  assert.deepEqual(pathOf("/panel/personel"), ["Alış & gider", "Giderler & maaşlar", "Maaşlar"]);
  for (const tabs of Object.values(SECTION_TABS)) for (const t of tabs) assert.ok(pathOf(t.href).length >= 2, t.href);
});

test("Excel karşılığı sekme adından: sekme eklenince ötekiler kaymaz, yeni sekme 'yeni'", () => {
  assert.equal(excelFor("/panel/giderler"), "Sabit Giderler");
  assert.equal(excelFor("/panel/harcamalar"), undefined);
  // "Maaşlar" sekmesinin parçası yok: kaydın kendi Excel adına düşer
  assert.equal(excelFor("/panel/personel"), "Personel");
  assert.equal(excelFor("/panel/sayim"), "Sayım");
  assert.equal(excelFor("/panel/tutarlilik"), "Tutarlılık Kontrolü");
  assert.equal(excelFor("/panel"), "Panel");
  assert.equal(excelFor("/panel/faturalar"), "Faturalar");
  assert.equal(excelFor("/panel/hatirlaticilar"), undefined);
  assert.deepEqual(
    tabsOf("/panel/giderler")?.map((t) => t.label),
    ["Sabit giderler", "Aylık harcamalar", "Maaşlar"],
  );
  assert.equal(tabsOf("/panel/harcamalar"), undefined);
});

test("sayfadaki her <Path> kenar çubuğunda bulunan bir ekran", () => {
  const hrefs = [...PAGE.matchAll(/<Path href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length > 10);
  for (const h of new Set(hrefs)) assert.ok(pathOf(h).length, `${h} menüde yok`);
});

test("<Path>'ten önce satır sonu varsa boşluk yazılı (JSX satır sonunu siler, ad metne yapışmaz)", () => {
  const lines = PAGE.split("\n");
  lines.forEach((line, i) => {
    if (!/^\s*<Path /.test(line) || i === 0) return;
    const prev = lines[i - 1].trimEnd();
    // Önceki satır bir etiketle bitiyorsa (<>, </strong> …) ya da açık boşlukla bitiyorsa sorun yok
    assert.ok(prev.endsWith(">") || prev.endsWith('{" "}'), `satır ${i + 1}: önceki satır metinle bitiyor`);
  });
});

test("adımlardaki ve sık sorulanlardaki bağlantılar var olan ekranlara gider", () => {
  const hrefs = [...PAGE.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length > 10);
  for (const h of new Set(hrefs)) {
    const path = h.replace(/[?#].*$/, "");
    assert.ok(existsSync(join(process.cwd(), "src/app", path, "page.tsx")), `${h} ekranı yok`);
  }
  // Kenar çubuğu ağacındaki her ekran da var
  for (const n of NAV_TREE) for (const href of [n.href, ...(n.children ?? []).map((c) => c.href)].filter(Boolean) as string[]) {
    assert.ok(existsSync(join(process.cwd(), "src/app", href, "page.tsx")), href);
  }
});

test("yöneticinin yardımı: ModPOS Z ve banka POS Z (yazarkasa) karşılaştırmaları, kümülatif ve doldurma kapısı (docs/planlar/okc-z.md §14)", () => {
  const start = PAGE.indexOf('id: "yazarkasa-z"');
  assert.ok(start > 0, "yazarkasa-z sorusu yok");
  const item = PAGE.slice(start, PAGE.indexOf("icon: ScanText", start));
  for (const s of ["Z RAPORU ve KDV dökümü", "banka gün sonu fişi değil", "kart, nakit, toplam", "Kümülatifi temizle", "Yazarkasa tutmuyor", "Yazarkasa Z yok"]) {
    assert.ok(item.includes(s), s);
  }
  // Doldurma kapısı ayrı soruda: kapalıyken sahibe ne gerektiği yazılı; metin sabite bağlı
  const gateAt = PAGE.indexOf('id: "yazarkasa-oneri"');
  assert.ok(gateAt > start, "yazarkasa-oneri sorusu yok");
  const gate = PAGE.slice(gateAt, PAGE.indexOf("icon: Lightbulb", gateAt));
  assert.match(gate, /OKC_PREFILL_ENABLED \?/);
  assert.match(gate, /5–8 günün banka POS Z fotoğrafını/);
  assert.match(gate, /asıl çözünürlükte/);
  assert.match(PAGE, /import \{ OKC_PREFILL_ENABLED \} from "@\/lib\/okc-z"/);
});


test("yöneticinin yardımı: Vergi sorusu (dalga 12, docs/planlar/vergi.md §4.6): tahmin, beyanname değil; menü yolu ve Muhasebeciye sorulacaklar", () => {
  const start = PAGE.indexOf('id: "vergi"');
  assert.ok(start > PAGE.indexOf('id: "kdv-tahmini"'), "vergi sorusu KDV tahmininden sonra, Gider, ödeme ve ekip grubunda");
  const item = PAGE.slice(start, PAGE.indexOf("icon: Landmark", start));
  assert.match(item, /q: "Vergi sayfasındaki rakamlar beyanname mi\?"/);
  for (const s of ["Hayır, tahmindir.", "2026 kurallarıyla tahmin eder", "şirketin tamamının beyannamesidir", "muhasebecinizle bir kez gözden geçirin"]) assert.ok(item.includes(s), s);
  assert.match(item, /Hayır, tahmindir\.\{" "\}\n\s*<Path href="\/panel\/vergi" \/>/);
  assert.deepEqual(pathOf("/panel/vergi"), ["Vergi, KDV, SGK", "Özet"]);
  assert.deepEqual(pathOf("/panel/vergi/kurallar"), ["Vergi, KDV, SGK", "Muhasebeci"]);
  assert.match(PAGE, /\{ href: "\/panel\/vergi\/kurallar#sorular", label: "Muhasebeciye sorulacaklar" \}/);
});

// ---------------------------------------------------------------- Sade metinler (sahibin isteği 24.11.2026)
// "Yardım sayfasındaki gereksiz bilgileri temizle": UI'nin zaten söylediği, geliştirici notu, kalkmış ya da değişmiş
// özellik (Marina'nın ModPOS dönemi kapandı, CONTRACT §9), tek cümleye inebilen uzun paragraf. Kalır: yasal/vergi notları,
// Formüller, güvenlik uyarıları, kısa ipuçları.

/** Kaynaktaki JSX parçasının düz metni (etiket, yorum ve kaçışlar atılır; <Path> sayılmaz: ölçü alttan) */
const plain = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\{" "\}/g, " ")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const FAQ_IDS = [...PAGE.matchAll(/^\s+id: "([^"]+)",$/gm)].map((m) => m[1]);
function answer(id: string): string {
  const at = PAGE.indexOf(`id: "${id}"`);
  assert.ok(at > 0, `${id} sorusu yok`);
  return plain(PAGE.slice(PAGE.indexOf("a:", at) + 2, PAGE.indexOf("icon:", at)));
}
const ROUTINE_SRC = PAGE.slice(PAGE.indexOf("const ROUTINE"), PAGE.indexOf("const FAQ_GROUPS"));
const ROUTINE_BODIES = [...ROUTINE_SRC.matchAll(/title: "([^"]+)",\s*body: \(([\s\S]*?)\),\s*href/g)].map((m) => ({ title: m[1], text: plain(m[2]) }));

test("sade metin: her cevap en çok 800, her adım en çok 500 harf (hesap yöntemi anlatan stok değerleme hariç)", () => {
  assert.ok(FAQ_IDS.length > 40, `${FAQ_IDS.length} soru`);
  const KEEP = new Set(["stok-degerleme"]);
  for (const id of FAQ_IDS.filter((i) => !KEEP.has(i))) {
    const len = answer(id).length;
    assert.ok(len <= 800, `${id}: ${len} harf`);
  }
  assert.equal(ROUTINE_BODIES.length, 6);
  for (const r of ROUTINE_BODIES) assert.ok(r.text.length <= 500, `${r.title}: ${r.text.length} harf`);
});

test("sade metin: geliştirici notu ve kalkmış özellik anlatılmaz", () => {
  // Kodun yorumları ekranda görünmez
  const all = plain(PAGE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""));
  for (const s of [
    /docs\/[A-Z]/, // belge yolu sahibin işi değil
    /henüz ölçülmedi/,
    /ücretsiz planın/,
    /sitenin ucuna/,
    /"Pasif" yerine/, // eski düğme adı
    /bana söyleyin/, // Excel dönemi
    /otomatik testlerle/,
    /Claude anahtarıyla canlı/,
    /açılan ay adreste durur/,
    /Açmak için soruya dokunun/, // arama kutusu ve sorular zaten görünüyor
  ]) {
    assert.doesNotMatch(all, s, String(s));
  }
});

test("sade metin: Marina'nın ModPOS dönemi kapandı (CONTRACT §9); kasa şubeye göre anlatılır, Tuzla ModPOS'ta", () => {
  for (const s of ["Kasadaki (ModPOS)", "LafPOS&apos;a geçildiyse", "LafPOS&apos;a geçiş günü seçildiyse", "ModPOS raporuyla çalışan aylarda", "ModPOS fiyatları", "ModPOS için kayıt sürer"]) {
    assert.ok(!PAGE.includes(s), s);
  }
  const kasa = answer("kasa-fiyat");
  assert.match(kasa, /ModPOS'lu şubede/);
  assert.match(kasa, /LafPOS'lu şubede/);
  assert.match(PAGE, /q: "Kasadaki fiyatlar \(Kasaya işle\)"/);
  assert.match(answer("zam"), /Kasaya işle/);
  for (const id of ["fotograf", "komisyon", "ay-ortasi-liste"]) assert.match(answer(id), /LafPOS'lu şube/, id);
});

test("sade metin: ay sonu tahmini Formüller'le birleşti (formül iki yerde yazılmaz)", () => {
  const t = answer("tahmin");
  assert.match(t, /Formüller/);
  assert.doesNotMatch(t, /÷ açık gün/);
  assert.match(PAGE, /"Ay sonu tahmini \(yalnızca devam eden ay\)"/);
});

test("sade metin: LafPOS'lu şubenin gün sonu (#132): rapor LafPOS'tan, personel Pavo'nun fişini çeker, karşılaştırma batch batch", () => {
  const foto = answer("fotograf");
  assert.match(foto, /Pavo/);
  assert.match(foto, /Gün sonu fotoğrafı/);
  assert.doesNotMatch(foto, /yalnız banka POS Z'si çekilir/);
  const z = answer("yazarkasa-z");
  assert.match(z, /ModPOS'lu şubede banka POS Z'si isteğe bağlıdır/);
  assert.match(z, /LafPOS'lu şubede/);
  assert.match(z, /batch/);
});

test("Formüller: banka POS komisyonu şubenin POS oranıyla (LM-1, posCommission); eski formül yalnız kasa kartı olmayan ayda", () => {
  const f = PAGE.slice(PAGE.indexOf("const FORMULAS"), PAGE.indexOf("];", PAGE.indexOf("const FORMULAS")));
  assert.match(f, /şubenin POS oranı/);
  assert.match(f, /yemek kartı hariç/);
  assert.match(f, /kasa kartı olmayan ayda/i);
  assert.match(f, /\["Brüt kâr", "Net satış − malzeme\/ambalaj \(reçeteye göre\) − banka POS komisyonu/);
});
