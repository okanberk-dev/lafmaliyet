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
  assert.deepEqual(pathOf("/panel/giderler"), ["Alış & gider", "Giderler & personel"]);
  assert.deepEqual(pathOf("/panel/hatirlaticilar"), ["Finans", "Ödemeler & hatırlatıcılar"]);
  assert.deepEqual(pathOf("/panel/tutarlilik"), ["Stok", "Tutarlılık"]);
  assert.deepEqual(pathOf("/panel/parasut"), ["Ayarlar", "Paraşüt entegrasyonu"]);
  assert.deepEqual(pathOf("/panel/komisyonlar"), ["Satış", "Komisyon & hakediş"]);
  // Personelde üst düzeyde de duran ekranlar yöneticinin başlığıyla; en sık açılanlar iki rolde de üst düzeyde
  assert.deepEqual(pathOf("/panel/karaoke"), ["Kafe", "Karaoke"]);
  assert.deepEqual(pathOf("/panel/kontrol"), ["Kafe", "Kontrol listeleri"]);
  assert.deepEqual(pathOf("/panel/hatirlaticilarim"), ["Kafe", "Hatırlatıcılarım"]);
  assert.deepEqual(pathOf("/panel/tahmin"), ["Kafe", "Satış tahmini"]);
  assert.deepEqual(pathOf("/panel/kasa"), ["Kasa raporu"]);
  assert.deepEqual(pathOf("/panel/onaylar"), ["Onaylar"]);
  assert.deepEqual(pathOf("/panel/bugun"), ["Bugün"]);
  assert.deepEqual(pathOf("/panel/gelir-gider"), ["Finans", "Gelir-gider"]);
  assert.deepEqual(pathOf("/panel/yok"), []);
});

test("menüde ayrı öğesi olmayan sekme, menü öğesinin altında (Aylık harcamalar boş çıkmaz)", () => {
  assert.deepEqual(pathOf("/panel/harcamalar"), ["Alış & gider", "Giderler & personel", "Aylık harcamalar"]);
  assert.deepEqual(pathOf("/panel/personel"), ["Alış & gider", "Giderler & personel", "Personel"]);
  for (const tabs of Object.values(SECTION_TABS)) for (const t of tabs) assert.ok(pathOf(t.href).length >= 2, t.href);
});

test("Excel karşılığı sekme adından: sekme eklenince ötekiler kaymaz, yeni sekme 'yeni'", () => {
  assert.equal(excelFor("/panel/giderler"), "Sabit Giderler");
  assert.equal(excelFor("/panel/harcamalar"), undefined);
  assert.equal(excelFor("/panel/personel"), "Personel");
  assert.equal(excelFor("/panel/sayim"), "Sayım");
  assert.equal(excelFor("/panel/tutarlilik"), "Tutarlılık Kontrolü");
  assert.equal(excelFor("/panel"), "Panel");
  assert.equal(excelFor("/panel/faturalar"), "Faturalar");
  assert.equal(excelFor("/panel/hatirlaticilar"), undefined);
  assert.deepEqual(
    tabsOf("/panel/giderler")?.map((t) => t.label),
    ["Sabit giderler", "Aylık harcamalar", "Personel"],
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

