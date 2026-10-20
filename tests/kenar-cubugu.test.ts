// Kenar çubuğu ve mobil çekmece: tek tıklamada gezinme (vurgu tıklamayı yutmaz, kapanan katman dokunuş almaz),
// gezinince grupların açıklığı, çekmecenin kapanma anı (src/components/panel/nav.ts, sidebar-nav.tsx, sidebar.tsx,
// bottom-nav.tsx, command-palette.tsx, notifications.tsx).
// Çalıştırma: npx tsx --test tests/kenar-cubugu.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { isSamePage, keepGroupOpen, navLit, navTreeFor } from "../src/components/panel/nav";

const src = (path: string) => readFileSync(join(process.cwd(), "src/components/panel", path), "utf8");

test("vurgu: fare ya da klavye bir öğedeyse orada, değilse etkin sayfada", () => {
  // Kimse bir öğenin üstünde değil: yalnız etkin sayfa yanar
  assert.equal(navLit("c-faturalar", true, null), true);
  assert.equal(navLit("c-satislar", false, null), false);
  // Fare başka öğede: etkin sayfa söner, o öğe yanar (tek vurgu)
  assert.equal(navLit("c-faturalar", true, "c-satislar"), false);
  assert.equal(navLit("c-satislar", false, "c-satislar"), true);
});

test("gezinince önceki grup kendiliğinden kapanmaz; kullanıcının seçimi korunur", () => {
  // Menü grubu etkindi (açık), Satış & gider'e gidildi: Menü açık kalır, alttaki satırlar kaymaz
  assert.deepEqual(keepGroupOpen({ para: true }, "menu"), { para: true, menu: true });
  // Kullanıcı etkin grubu kapatmıştı: kapalı kalır
  const closed = { menu: false };
  assert.equal(keepGroupOpen(closed, "menu"), closed);
  // Kullanıcının açtığı grup zaten kayıtlı: aynı nesne (gereksiz çizim yok)
  const open = { menu: true };
  assert.equal(keepGroupOpen(open, "menu"), open);
  // Önceki sayfa bir grupta değildi (Genel bakış): değişiklik yok
  const none = {};
  assert.equal(keepGroupOpen(none, undefined), none);
  assert.equal(keepGroupOpen(none, null), none);
});

test("çekmece: bulunulan ekranın bağlantısı hemen kapatır, başka ekran geçiş bitince", () => {
  assert.equal(isSamePage("/panel/faturalar", "/panel/faturalar"), true);
  assert.equal(isSamePage("/panel/faturalar/", "/panel/faturalar"), true);
  assert.equal(isSamePage("/panel/faturalar?ay=2026-10", "/panel/faturalar"), true, "aynı ekranın süzgeci: adres yolu değişmez");
  assert.equal(isSamePage("#icerik", "/panel/faturalar"), true);
  assert.equal(isSamePage("/panel", "/panel/faturalar"), false);
  assert.equal(isSamePage("/panel/faturalar", "/panel"), false);
  assert.equal(isSamePage("/panel/satislar", "/panel/satislar-arsiv"), false);
  assert.equal(isSamePage(null, "/panel"), false);
});

test("menü ağacında her adres bir kez (iki satır aynı ekranı açmaz)", () => {
  for (const role of ["admin", "staff"] as const) {
    const tree = navTreeFor(role);
    const hrefs = tree.flatMap((n) => (n.children ? n.children.map((c) => c.href) : [n.href!]));
    assert.equal(new Set(hrefs).size, hrefs.length, `${role}: aynı adres iki kez yok`);
  }
});

test("vurgu tıklama almaz, yalnız fareyle ve klavye odağıyla taşınır", () => {
  const nav = src("sidebar-nav.tsx");
  // Vurgu (layoutId) tıklamanın hedefi olamaz: basma ile bırakma arasında silinip kurulsa da click bağlantıda kalır
  const highlight = nav.slice(nav.indexOf('layoutId="panel-nav-highlight"'), nav.indexOf("/>", nav.indexOf('layoutId="panel-nav-highlight"')));
  assert.match(highlight, /pointer-events-none/);
  // Dokunmatik üstüne gelme vurguyu oynatmaz (iOS ilk dokunuşu yutmasın)
  assert.match(nav, /e\.pointerType === "mouse"\) setHovered/);
  // Fareyle tıklamanın odağı/blur'u fare vurgusunu silmez (eskiden onBlur: setHovered(null))
  assert.doesNotMatch(nav, /onBlur: \(\) => setHovered\(null\)/);
  assert.match(nav, /:focus-visible/);
  // Bekleme işareti: useLinkStatus
  assert.match(nav, /useLinkStatus\(\)/);
  // Masaüstü ve çekmecedeki iki örnek ayrı vurgu grubunda
  assert.match(nav, /LayoutGroup id=\{`panel-nav\$\{groupId\}`\}/);
  // Kenar çubuğu bağlantılarında önceden yükleme kapatılmamış
  assert.doesNotMatch(nav, /prefetch=\{false\}/);
});

test("kapanan katmanlar (çekmece, perde, arama, bildirimler) kapanırken dokunuş almaz", () => {
  const sidebar = src("sidebar.tsx");
  assert.equal((sidebar.match(/exit=\{reduce \? undefined : \{[^}]*pointerEvents: "none" \}\}/g) ?? []).length, 2, "perde ve çekmece");
  // Kapanırken yeniden açılırsa dokunuşlar geri gelir
  assert.equal((sidebar.match(/animate=\{\{[^}]*pointerEvents: "auto" \}\}/g) ?? []).length, 2);
  // Başka ekranın bağlantısı çekmeceyi hemen kapatmaz (geçiş bitince adres değişir, kendiliğinden kapanır)
  assert.match(sidebar, /isSamePage\(link\.getAttribute\("href"\), pathname\)\) setOpenFor\(null\)/);

  const palette = src("command-palette.tsx");
  assert.equal((palette.match(/pointerEvents: "none"/g) ?? []).length, 2, "arama perdesi ve penceresi");
  const bell = src("notifications.tsx");
  assert.match(bell, /exit=\{reduce \? undefined : \{[^}]*pointerEvents: "none" \}\}/);
  assert.match(bell, /animate=\{\{[^}]*pointerEvents: "auto" \}\}/);

  const bottom = src("bottom-nav.tsx");
  const pill = bottom.slice(bottom.indexOf('layoutId="mobile-nav-pill"'), bottom.indexOf("/>", bottom.indexOf('layoutId="mobile-nav-pill"')));
  assert.match(pill, /pointer-events-none/, "kayan hap komşu öğeye dokunuşu yutmaz");
  assert.match(bottom, /useLinkStatus\(\)/);
});
