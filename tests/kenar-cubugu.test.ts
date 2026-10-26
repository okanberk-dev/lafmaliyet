// Kenar çubuğu ve mobil çekmece: tek tıklamada gezinme (vurgu tıklamayı yutmaz, kapanan katman dokunuş almaz),
// gezinince grupların açıklığı, çekmecenin kapanma anı (src/components/panel/nav.ts, sidebar-nav.tsx, sidebar.tsx,
// bottom-nav.tsx, command-palette.tsx, notifications.tsx).
// Çalıştırma: npx tsx --test tests/kenar-cubugu.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { activeGroupOf, BOTTOM_NAV, isSamePage, keepGroupOpen, NAV_FOOTER, NAV_GROUPS, NAV_TREE, navLit, navTreeFor, pathMatches, type NavNode } from "../src/components/panel/nav";
import { canOpen } from "../src/lib/roles";

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
  // Menü grubu etkindi (açık), Finans'a gidildi: Menü açık kalır, alttaki satırlar kaymaz
  assert.deepEqual(keepGroupOpen({ finans: true }, "menu"), { finans: true, menu: true });
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

// ---------------------------------------------------------------- Başlıklar (26 Eki 2026)

const outline = (tree: NavNode[]) => tree.map((n) => (n.children ? `${n.label} › ${n.children.map((c) => c.label).join(", ")}` : `${n.label} (${n.href})`));
const hrefsOf = (tree: NavNode[]) => tree.flatMap((n) => (n.children ? n.children.map((c) => c.href) : [n.href!]));
/** Ağacın bu adresi açan satırı (alt ekran ve sekme de: /panel/kasa/fiyatlar → Kasa raporu) */
const reaches = (tree: NavNode[], pathname: string) =>
  tree.some((n) => (n.children ? n.children.some((c) => pathMatches(pathname, c.href, c.match)) : pathMatches(pathname, n.href!)));

test("yönetici: en sık dört ekran üst düzeyde, gerisi konu başlıkları altında", () => {
  assert.deepEqual(outline(navTreeFor("admin")), [
    "Genel bakış (/panel)",
    "Bugün (/panel/bugun)",
    "Onaylar (/panel/onaylar)",
    "Kasa raporu (/panel/kasa)",
    "Kafe › Karaoke, Kontrol listeleri, Satış tahmini, Hatırlatıcılarım",
    "Menü › Ürünler, Hammaddeler, Reçete defteri",
    // Hızlı sayım ve Mal siparişi 26 Eki 2026'da kaldırıldı (sahibin isteği: "normal sayım olsun")
    "Stok › Stok sayımı, Zayi & ikram, Tutarlılık",
    "Satış › Satışlar, Komisyon & hakediş, Analiz & senaryo",
    "Alış & gider › Faturalar, Tedarikçiler, Giderler & personel",
    "Finans › Gelir-gider, Ödemeler & hatırlatıcılar",
    "Ayarlar › Genel ayarlar, Kullanıcılar & roller, Paraşüt entegrasyonu",
    "Yardım (/panel/yardim)",
  ]);
  // Grup en az iki, en çok beş alt sayfa (tek alt sayfalı grup bağlantıya dönerdi; uzun grup yine aranır)
  for (const n of navTreeFor("admin")) if (n.children) assert.ok(n.children.length >= 2 && n.children.length <= 5, n.label);
});

test("tek tıkla: Bugün, Kasa raporu ve Onaylar hiçbir grubun içinde değil", () => {
  const topLevel = (role: "admin" | "staff") => navTreeFor(role).filter((n) => !n.children).map((n) => n.href);
  for (const href of ["/panel", "/panel/bugun", "/panel/onaylar", "/panel/kasa"]) assert.ok(topLevel("admin").includes(href), `yönetici: ${href}`);
  for (const href of ["/panel/bugun", "/panel/kasa"]) assert.ok(topLevel("staff").includes(href), `personel: ${href}`);
  // Yöneticinin ağacında ilk dört satır bunlar: başka bir grubu açmadan görünür
  assert.deepEqual(navTreeFor("admin").slice(0, 4).map((n) => n.id), ["genel", "bugun", "onaylar", "kasa"]);
});

test("personelin ağacı değişmedi (içerik ve sıra; yalnız Hızlı sayım kalktı); yöneticinin başlıkları personelde yok", () => {
  assert.deepEqual(outline(navTreeFor("staff")), [
    "Bugün (/panel/bugun)",
    "Karaoke (/panel/karaoke)",
    "Kasa raporu (/panel/kasa)",
    "Kontrol listeleri (/panel/kontrol)",
    "Özel günler (/panel/ozel-gunler)",
    "Reçete defteri (/panel/receteler)",
    "Stok › Stok sayımı, Zayi & ikram",
    "Hatırlatıcılarım (/panel/hatirlaticilarim)",
    "Yardım (/panel/yardim/personel)",
  ]);
  const staffLabels = new Set(navTreeFor("staff").map((n) => n.label));
  for (const head of ["Genel bakış", "Onaylar", "Kafe", "Menü", "Satış", "Alış & gider", "Finans", "Ayarlar"]) assert.ok(!staffLabels.has(head), head);
  // Personelin ağacındaki her ekranı personel açabilir (yönetici ekranı sızmaz)
  for (const href of hrefsOf(navTreeFor("staff"))) assert.ok(canOpen("staff", href), href);
});

test("tek alt sayfası kalan grup o sayfanın bağlantısına döner (personelde Menü → Reçete defteri)", () => {
  const staffMenu = navTreeFor("staff").find((n) => n.id === "menu")!;
  assert.equal(staffMenu.children, undefined);
  assert.equal(staffMenu.href, "/panel/receteler");
  assert.equal(staffMenu.label, "Reçete defteri");
  assert.equal(staffMenu.icon, NAV_TREE.find((n) => n.id === "menu")!.icon, "grubun ikonu kalır");
  // Yöneticinin bütün grupları en az iki alt sayfalı: hiçbiri bağlantıya dönmez
  for (const n of NAV_TREE.filter((x) => x.children && x.roles.includes("admin"))) assert.ok(navTreeFor("admin").find((x) => x.id === n.id)?.children, n.label);
  // Alt sayfası kalmayan grup hiç görünmez (personelde Kafe, Satış, Finans)
  for (const id of ["kafe", "satis", "alis", "finans", "ayarlar"]) assert.ok(!navTreeFor("staff").some((n) => n.id === id), id);
});

test("hiçbir ekran menüden düşmedi: adresler aynı, ağaç, komut paleti ve alt menü aynı adresleri tutar", () => {
  // Gruplamadan önceki (25 Eki 2026) yönetici ağacının bütün adresleri; yalnız yerleri değişti. Hızlı sayım ve Mal
  // siparişi 26 Eki 2026'da kaldırıldı (eski adresleri Stok sayımı'na yönlenir: tests/hizli-siparis-kaldirildi.test.ts)
  const ADMIN_PAGES = [
    "/panel", "/panel/bugun", "/panel/onaylar", "/panel/kontrol", "/panel/hatirlaticilarim", "/panel/kasa", "/panel/karaoke", "/panel/tahmin",
    "/panel/urunler", "/panel/hammaddeler", "/panel/receteler", "/panel/satislar", "/panel/komisyonlar", "/panel/analiz", "/panel/faturalar",
    "/panel/tedarikciler", "/panel/giderler", "/panel/gelir-gider", "/panel/hatirlaticilar", "/panel/sayim",
    "/panel/zayi", "/panel/tutarlilik", "/panel/ayarlar", "/panel/kullanicilar", "/panel/parasut", "/panel/yardim",
  ];
  assert.deepEqual([...hrefsOf(navTreeFor("admin"))].sort(), [...ADMIN_PAGES].sort());
  // Ağaçtaki her ekran komut paletinde de (Tutarlılık Stok sayımı'nın sekmesi olarak bulunur)
  const palette = [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_FOOTER];
  for (const role of ["admin", "staff"] as const) {
    const pages = palette.filter((i) => i.roles.includes(role));
    // Personelin Yardım'ı profil menüsünde de; palette hiç olmadı (bu değişiklik paleti personelde değiştirmez)
    for (const href of hrefsOf(navTreeFor(role)).filter((h) => h !== "/panel/yardim/personel")) assert.ok(pages.some((i) => pathMatches(href, i.href, i.match)), `${role}: ${href} palette yok`);
    // Alt menünün her bağlantısı rolün ağacında
    for (const b of BOTTOM_NAV[role]) if (b.href) assert.ok(hrefsOf(navTreeFor(role)).includes(b.href), `${role}: ${b.href}`);
  }
  // Ağaç düğüm kimlikleri benzersiz (açık grup durumu ve vurgu anahtarı kimlikten)
  const ids = NAV_TREE.flatMap((n) => [n.id, ...(n.children ?? []).map((c) => c.id)]);
  assert.equal(new Set(ids).size, ids.length);
});

test("komut paletinin her ekranı, rolünün kenar çubuğunda da bir satırdan açılır", () => {
  for (const item of NAV_GROUPS.flatMap((g) => g.items)) {
    for (const role of item.roles) assert.ok(reaches(navTreeFor(role), item.href), `${role}: ${item.href} (${item.label}) ağaçta yok`);
  }
  // Paletin rol kümeleri değişmedi (yalnız Hızlı sayım kalktı): personel aynı ekranları arar
  const staffPalette = NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.roles.includes("staff")).map((i) => i.href);
  assert.deepEqual([...staffPalette].sort(), [
    "/panel/bugun", "/panel/hatirlaticilarim", "/panel/karaoke", "/panel/kasa", "/panel/kontrol", "/panel/ozel-gunler",
    "/panel/receteler", "/panel/sayim", "/panel/zayi",
  ]);
  // Paletin başlıkları ağacın başlıklarıyla aynı sırada (Genel = üst düzeydeki dört ekran; Ayarlar alttaki NAV_FOOTER'da)
  const heads = NAV_TREE.filter((n) => n.children && n.roles.includes("admin")).map((n) => n.label);
  assert.deepEqual(NAV_GROUPS.map((g) => g.title), ["Genel", ...heads.filter((h) => h !== "Ayarlar")]);
});

test("src/app/panel altındaki her ekran menüden ya da bir menü öğesinin alt ekranı olarak açılır", () => {
  const routes: string[] = [];
  const walk = (dir: string, route: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name), `${route}/${e.name.replace(/^\[(.+)\]$/, "$1")}`);
      else if (e.name === "page.tsx") routes.push(route);
    }
  };
  walk(join(process.cwd(), "src/app/panel"), "/panel");
  assert.ok(routes.length > 40, `${routes.length} ekran`);
  for (const route of routes) {
    const ok = reaches(navTreeFor("admin"), route) || reaches(navTreeFor("staff"), route) || NAV_FOOTER.some((i) => pathMatches(route, i.href, i.match));
    assert.ok(ok, `${route} menüde yok`);
  }
});

test("etkin sayfanın grubu kendiliğinden açık: alt ekran ve sekme de kendi başlığını açar", () => {
  const admin = navTreeFor("admin");
  const groupOf = (pathname: string) => admin.find((n) => n.id === activeGroupOf(admin, pathname))?.label;
  assert.equal(groupOf("/panel/karaoke"), "Kafe");
  assert.equal(groupOf("/panel/karaoke/doluluk"), "Kafe");
  assert.equal(groupOf("/panel/kontrol/gecmis"), "Kafe");
  assert.equal(groupOf("/panel/hatirlaticilar/nakit"), "Finans");
  assert.equal(groupOf("/panel/harcamalar"), "Alış & gider");
  assert.equal(groupOf("/panel/personel"), "Alış & gider");
  assert.equal(groupOf("/panel/tedarikciler/12"), "Alış & gider");
  assert.equal(groupOf("/panel/urunler/site"), "Menü");
  assert.equal(groupOf("/panel/tutarlilik"), "Stok");
  // Üst düzeydeki ekran ve alt ekranı hiçbir grubu açmaz
  for (const p of ["/panel", "/panel/bugun", "/panel/onaylar", "/panel/kasa", "/panel/kasa/fiyatlar"]) assert.equal(activeGroupOf(admin, p), undefined, p);
  // Personelde Stok grubu
  assert.equal(activeGroupOf(navTreeFor("staff"), "/panel/zayi"), "stok");
  // Kenar çubuğu açıklığı bu işlevden alır
  assert.match(src("sidebar-nav.tsx"), /const activeParent = activeGroupOf\(items, pathname\);/);
  assert.match(src("sidebar-nav.tsx"), /toggled\[id\] \?\? id === activeParent/);
});
