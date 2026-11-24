// Kenar çubuğu ve mobil çekmece: tek tıklamada gezinme (vurgu tıklamayı yutmaz, kapanan katman dokunuş almaz),
// gezinince grupların açıklığı, çekmecenin kapanma anı (src/components/panel/nav.ts, sidebar-nav.tsx, sidebar.tsx,
// bottom-nav.tsx, command-palette.tsx, notifications.tsx).
// Çalıştırma: npx tsx --test tests/kenar-cubugu.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { score } from "../src/components/panel/command-palette";
import {
  activeChildOf,
  activeGroupOf,
  BOTTOM_NAV,
  contextLineOf,
  groupLabelOf,
  isSamePage,
  keepGroupOpen,
  NAV_FOOTER,
  NAV_GROUPS,
  NAV_TREE,
  navLit,
  navTreeFor,
  pathMatches,
  revealDelta,
  samePageHash,
  SECTION_TABS,
  sectionTabsFor,
  type NavNode,
} from "../src/components/panel/nav";
import { canOpen } from "../src/lib/roles";
import { wordHit } from "../src/lib/word-hit";

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

test("⌘K aynı sayfanın çapasında tarayıcının çapa gezinmesini kullanır: pushState hashchange göndermez, :target'ı güncellemez", () => {
  const at = (pathname: string, search = "") => ({ pathname, search });
  // Maaşlar'dayken "SGK oranı", Ayarlar'dayken "Yedek": bölüm açılsın diye kare tarayıcıya bırakılır
  assert.equal(samePageHash("/panel/personel#sgk-oranlari", at("/panel/personel")), "#sgk-oranlari");
  assert.equal(samePageHash("/panel/ayarlar#yedek", at("/panel/ayarlar/")), "#yedek");
  assert.equal(samePageHash("/panel/personel#sgk-oranlari", at("/panel/personel", "?ara=ay")), "#sgk-oranlari", "sorgusuz kayıt sayfanın süzgecini korur");
  assert.equal(samePageHash("/panel/komisyonlar?ay=2026-10#pluxee", at("/panel/komisyonlar", "?ay=2026-10")), "#pluxee");
  // Adres karenin dışında da değişecekse yönlendirici (başka dönem, başka sayfa, çapasız kayıt)
  assert.equal(samePageHash("/panel/komisyonlar?ay=2026-10#pluxee", at("/panel/komisyonlar", "?ay=2026-09")), null);
  assert.equal(samePageHash("/panel/personel#sgk-oranlari", at("/panel")), null);
  assert.equal(samePageHash("/panel/vergi#kdv", at("/panel/vergi/gelir-gider")), null);
  assert.equal(samePageHash("/panel/ayarlar", at("/panel/ayarlar")), null);
  assert.equal(samePageHash("/panel/ayarlar#", at("/panel/ayarlar")), null);
  // Paletin her kare adresli kaydı kendi sayfasında karesini verir
  for (const item of [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_FOOTER].filter((i) => i.href.includes("#"))) {
    const [path, hash] = item.href.split("#");
    assert.equal(samePageHash(item.href, at(path)), `#${hash}`, item.href);
  }
  const palette = src("command-palette.tsx");
  assert.match(palette, /const hash = samePageHash\(e\.href, window\.location\);\s*if \(hash === null\) router\.push\(e\.href\);/);
  // Zaten o çapadaysa adres değişmez, tarayıcı olay göndermez: elle gönderilir (bölüm yine açılır, satır yine iner)
  assert.match(palette, /else if \(window\.location\.hash === hash\) window\.dispatchEvent\(new HashChangeEvent\("hashchange"/);
  assert.match(palette, /else window\.location\.hash = hash;/);
});

test("etkin satır kenar çubuğunun kaydırma kutusunda görünür (Vergi grubu listenin sonunda)", () => {
  // 1440×900: kutu 176-794; Muhasebeci 802-838 (görünmüyordu), Demirbaş 764-800 (kırpıktı)
  const box = { top: 176, bottom: 794 };
  assert.equal(revealDelta(box, { top: 802, bottom: 838 }), 52);
  assert.equal(revealDelta(box, { top: 764, bottom: 800 }), 14);
  assert.equal(revealDelta(box, { top: 400, bottom: 436 }), 0, "görünen satırda kutu kımıldamaz");
  assert.equal(revealDelta(box, { top: 150, bottom: 186 }), -34, "üstte kalan satır");
  assert.equal(revealDelta({ top: 0, bottom: 30 }, { top: 100, bottom: 160 }), 92, "kutudan uzun satırda üst kenar");
  const nav = src("sidebar-nav.tsx");
  assert.match(nav, /<div ref=\{scrollBox\} className="sidebar-nav-scroll /);
  assert.match(nav, /useRevealActive\(scrollBox, pathname\);/);
  // Grup yaylı açılırken kaydırma payı büyür: içerik ve kutu boyu izlenir; yalnız kutu kaydırılır (sayfa değil)
  assert.match(nav, /observer\.observe\(el\);\s*observer\.observe\(list\);/);
  assert.match(nav, /if \(delta\) el\.scrollTop \+= delta;/);
  assert.doesNotMatch(nav, /\.scrollIntoView\(/);
  assert.match(nav, /a\[aria-current="page"\]/);
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
/**
 * Ağacın bu adresi açan satırı (alt ekran ve sekme de: /panel/kasa/fiyatlar → Kasa raporu). Adresin ?sorgu ve #çapa
 * kısmı atılır: paletin kare adresli kaydı (ör. KDV → /panel/vergi#kdv) ekranın satırından açılır
 */
const reaches = (tree: NavNode[], pathname: string) => {
  const path = pathname.replace(/[?#].*$/, "");
  return tree.some((n) => (n.children ? n.children.some((c) => pathMatches(path, c.href, c.match)) : pathMatches(path, n.href!)));
};

test("yönetici: en sık dört ekran üst düzeyde, gerisi konu başlıkları altında", () => {
  assert.deepEqual(outline(navTreeFor("admin")), [
    "Genel bakış (/panel)",
    "Bugün (/panel/bugun)",
    "Onaylar (/panel/onaylar)",
    "Kasa raporu (/panel/kasa)",
    // 22 Kas 2026 (docs/VARDIYA.md): vardiya planı iki rolde üst düzeyde; yöneticide adı "Vardiya ayarlama"
    "Vardiya ayarlama (/panel/vardiya)",
    // Siparişler (uygulama siparişleri ve masa çağrıları) 6 Kas 2026'da Karaoke'den kendi ekranına, Kafe'nin başına
    "Kafe › Siparişler, Karaoke, Kontrol listeleri, Özel günler, Hatırlatıcılarım",
    // 29 Eki 2026 (docs/planlar/ux-sade.md §3.1): Ürünler'in adı başlığıyla aynı; Fiyatlar kendi satırında
    "Menü › Ürünler & kârlılık, Fiyatlar, Hammaddeler, Reçete defteri",
    // Hızlı sayım ve Mal siparişi 26 Eki 2026'da kaldırıldı (sahibin isteği: "normal sayım olsun")
    "Stok › Stok sayımı, Zayi & ikram, Tutarlılık",
    "Satış › Satışlar, Komisyon & hakediş, Analiz & senaryo",
    "Alış & gider › Faturalar, Tedarikçiler, Giderler & maaşlar",
    // "Finans" → "Kâr & ödemeler"; Nakit planı kendi satırında
    "Kâr & ödemeler › Gelir-gider, Ödemeler, Nakit planı",
    // Vergi (dalga 12) kendi grubunda; adı KDV ve SGK'yı da söyler, kapalı kenar çubuğunda görünür
    "Vergi, KDV, SGK › Özet, Vergi kârı, Demirbaş, Muhasebeci",
    "Ayarlar › Genel ayarlar, Kullanıcılar & roller, Şubeler, Paraşüt entegrasyonu",
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

test("personelin ağacı değişmedi (içerik ve sıra; yalnız Hızlı sayım kalktı, Siparişler geldi); yöneticinin başlıkları personelde yok", () => {
  assert.deepEqual(outline(navTreeFor("staff")), [
    "Bugün (/panel/bugun)",
    // 6 Kas 2026: uygulama siparişleri ve masa çağrıları Karaoke'den kendi ekranına (satırda açık sayısı)
    "Siparişler (/panel/siparisler)",
    "Karaoke (/panel/karaoke)",
    "Kasa raporu (/panel/kasa)",
    // 22 Kas 2026: personel planı yalnız görür, adı "Vardiya" (aynı düğüm, role göre ad: labelFor)
    "Vardiya (/panel/vardiya)",
    "Kontrol listeleri (/panel/kontrol)",
    "Özel günler (/panel/ozel-gunler)",
    "Reçete defteri (/panel/receteler)",
    "Stok › Stok sayımı, Zayi & ikram",
    "Hatırlatıcılarım (/panel/hatirlaticilarim)",
    "Yardım (/panel/yardim/personel)",
  ]);
  const staffLabels = new Set(navTreeFor("staff").map((n) => n.label));
  // Yöneticinin grup başlıkları ağaçtan türer (yeni grup da denetlenir); Menü personelde Reçete defteri bağlantısına döner
  const adminHeads = NAV_TREE.filter((n) => n.children && !n.roles.includes("staff")).map((n) => n.label);
  assert.ok(adminHeads.includes("Vergi, KDV, SGK") && adminHeads.includes("Kâr & ödemeler"), adminHeads.join(", "));
  for (const head of [...adminHeads, "Genel bakış", "Onaylar", "Menü"]) assert.ok(!staffLabels.has(head), head);
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
  for (const id of ["kafe", "satis", "alis", "finans", "vergi", "ayarlar"]) assert.ok(!navTreeFor("staff").some((n) => n.id === id), id);
});

test("hiçbir ekran menüden düşmedi: adresler aynı, ağaç, komut paleti ve alt menü aynı adresleri tutar", () => {
  // Gruplamadan önceki (25 Eki 2026) yönetici ağacının bütün adresleri; yalnız yerleri değişti. Hızlı sayım ve Mal
  // siparişi 26 Eki 2026'da kaldırıldı (eski adresleri Stok sayımı'na yönlenir: tests/hizli-siparis-kaldirildi.test.ts);
  // Vergi dalga 12'de eklendi; 29 Eki 2026'da Fiyatlar, Nakit planı ve Vergi'nin dört ekranı kendi satırlarında;
  // Şubeler 4 Kas 2026'da Ayarlar altına (docs/SUBE.md); Siparişler 6 Kas 2026'da Kafe altına (docs/SITE-SIPARIS.md)
  // Vardiya 22 Kas 2026'da üst düzeye (docs/VARDIYA.md)
  const ADMIN_PAGES = [
    "/panel", "/panel/bugun", "/panel/onaylar", "/panel/kontrol", "/panel/hatirlaticilarim", "/panel/kasa", "/panel/siparisler", "/panel/karaoke", "/panel/ozel-gunler", "/panel/vardiya",
    "/panel/urunler", "/panel/hammaddeler", "/panel/receteler", "/panel/satislar", "/panel/komisyonlar", "/panel/analiz", "/panel/faturalar",
    "/panel/tedarikciler", "/panel/giderler", "/panel/gelir-gider", "/panel/vergi", "/panel/hatirlaticilar", "/panel/sayim",
    "/panel/zayi", "/panel/tutarlilik", "/panel/ayarlar", "/panel/kullanicilar", "/panel/subeler", "/panel/parasut", "/panel/yardim",
    "/panel/urunler/fiyatlar", "/panel/hatirlaticilar/nakit", "/panel/vergi/gelir-gider", "/panel/vergi/demirbas", "/panel/vergi/kurallar",
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
    "/panel/receteler", "/panel/sayim", "/panel/siparisler", "/panel/vardiya", "/panel/zayi",
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
  assert.equal(groupOf("/panel/hatirlaticilar/nakit"), "Kâr & ödemeler");
  // Vergi'nin dört ekranı (Özet, Vergi kârı, Demirbaş, Muhasebeci) kendi grubunu açar
  for (const p of ["/panel/vergi", "/panel/vergi/gelir-gider", "/panel/vergi/demirbas", "/panel/vergi/kurallar"]) assert.equal(groupOf(p), "Vergi, KDV, SGK", p);
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

// Denetim E-56 (27 Eki 2026): Stok sekmeleri kenar çubuğunun Stok grubuyla aynı; telefonda (kenar çubuğu gizli) sayfalar
// arasında hamburger menü açmadan geçilir
test("Stok sekmeleri: role göre süzülmüş kenar çubuğu Stok grubunun sayfaları, aynı sırada", () => {
  for (const role of ["admin", "staff"] as const) {
    const group = navTreeFor(role).find((n) => n.id === "stok");
    assert.ok(group?.children, role);
    assert.deepEqual(
      sectionTabsFor("stok", role).map((t) => t.href),
      group.children.map((c) => c.href),
      role,
    );
    // Her sekme o rolün açabildiği bir ekran
    for (const t of sectionTabsFor("stok", role)) assert.ok(canOpen(role, t.href), `${role} ${t.href}`);
  }
  assert.deepEqual(
    sectionTabsFor("stok", "admin").map((t) => t.label),
    ["Sayım", "Zayi & ikram", "Tutarlılık"],
  );
  // Personel Tutarlılık'ı görmez
  assert.deepEqual(
    sectionTabsFor("stok", "staff").map((t) => t.label),
    ["Sayım", "Zayi & ikram"],
  );
  // Ağaçtaki her Stok sayfası sekmede (menüye eklenen sayfa sekmeye de girer)
  const tree = NAV_TREE.find((n) => n.id === "stok")!.children!;
  assert.deepEqual(
    SECTION_TABS.stok.map((t) => [t.href, [...t.roles]]),
    tree.map((c) => [c.href, c.roles]),
  );
  // Giderler'in sekmeleri yalnız yöneticide; tek sekme kalan bölüm çizilmez
  assert.equal(sectionTabsFor("giderler", "admin").length, 3);
  assert.deepEqual(sectionTabsFor("giderler", "staff"), []);
});

test("Stok sekmeleri Sayım, Zayi & ikram ve Tutarlılık sayfalarında; rol sayfanın kullanıcısından", () => {
  const page = (p: string) => readFileSync(join(process.cwd(), "src/app/panel", p, "page.tsx"), "utf8");
  // Sayım ve Zayi iki rolde açılır: sekmeler kullanıcının rolüyle, yüklenirken iki rolün ortak sekmeleri
  assert.match(page("sayim"), /<SectionTabs section="stok" current="\/panel\/sayim" role=\{role\} \/>/);
  assert.match(page("sayim"), /<StockHeader\s+month=\{month\}\s+role=\{user\.role\}/);
  assert.match(page("sayim"), /<StockHeader month=\{null\} role="staff" \/>/);
  assert.match(page("zayi"), /<SectionTabs section="stok" current="\/panel\/zayi" role=\{role\} \/>/);
  // Birden çok kasa açıkken başlık formun şubesini yazar (24 Kasım şube kapsamı)
  assert.match(page("zayi"), /<WasteHeader role=\{user\.role\}( lafpos=\{[^}]+\})?( branch=\{[^}]+\})? \/>/);
  assert.match(page("zayi"), /<WasteHeader role="staff" \/>/);
  // Tutarlılık yalnız yönetici
  assert.match(page("tutarlilik"), /requireAdmin\(\)/);
  assert.match(page("tutarlilik"), /<SectionTabs section="stok" current="\/panel\/tutarlilik" role="admin" \/>/);
  // Ortak sekmeler (yükleniyor) yöneticiye özel ekran içermez
  assert.ok(sectionTabsFor("stok", "staff").every((t) => t.roles.includes("admin") && t.roles.includes("staff")));
});

// Denetim B04 incelemesi K1 (27 Eki 2026): Stok sayfalarının yükleme ekranındaki sekmeler yüklenen sayfadakiyle aynı
// yerde. Başlık açıklamasız ve ay seçicisiz çizilince sekme satırı içerik gelince telefonda ~138 px aşağı kayıyor,
// sekmeye dokunan açıklamaya basıyordu (Sayım; Tutarlılık'ta da aynısı)
test("Stok: yükleme başlığı yüklenen başlıkla aynı boyda (açıklama, ay seçicinin yeri), sekmeler kaymaz", () => {
  const page = (p: string) => readFileSync(join(process.cwd(), "src/app/panel", p, "page.tsx"), "utf8");
  const picker = src("month-picker.tsx");
  // Ay seçicinin yeri aynı yükseklikte (fare: h-9, dokunmatik: h-11)
  const box = /export function MonthPickerSkeleton\(\)[\s\S]*?className="([^"]+)"/.exec(picker)?.[1].split(" ") ?? [];
  const real = /"inline-flex h-9 [^"]*"/.exec(picker)?.[0].replaceAll('"', "").split(" ") ?? [];
  for (const h of ["h-9", "pointer-coarse:h-11"]) {
    assert.ok(box.includes(h), `iskelet ${h}`);
    assert.ok(real.includes(h), `MonthPicker ${h}`);
  }
  assert.match(picker, /MonthPickerSkeleton\(\) \{\s*return \(\s*<span\s+aria-hidden/);

  // Sayım: iki durum da aynı başlık bileşeni; açıklama hep var (ay adı yüklenince, öncesinde iskelet), metin aynı
  const sayim = page("sayim");
  const header = sayim.slice(sayim.indexOf("function StockHeader("), sayim.indexOf("export default function StockPage("));
  assert.ok(header.startsWith("function StockHeader("), "StockHeader");
  // Birden çok açık şube varken ay adının önünde sayılan şube (docs/SUBE.md)
  assert.match(header, /month \? \(\s*`\$\{branch \? `\$\{branch\} · ` : ""\}\$\{monthLabel\(month\)\} \$\{COUNT_RULE\}`/);
  assert.match(header, /aria-hidden[^>]*animate-pulse[^>]*\/> \{COUNT_RULE\}/);
  assert.match(header, /actions=\{picker \?\? <MonthPickerSkeleton \/>\}/);
  assert.match(header, /tabs=\{<SectionTabs section="stok" current="\/panel\/sayim" role=\{role\} \/>\}/);
  assert.match(sayim, /fallback=\{\s*<>[\s\S]*?<StockHeader month=\{null\} role="staff" \/>[\s\S]*?<\/>\s*\}/);

  // Tutarlılık: yükleme başlığı aynı açıklama ve ay seçicinin yeriyle
  const tut = page("tutarlilik");
  const fallback = /fallback=\{\s*<>([\s\S]*?)<\/>\s*\}/.exec(tut)?.[1] ?? "";
  assert.match(fallback, /description=\{DESCRIPTION\}/);
  assert.match(fallback, /actions=\{<MonthPickerSkeleton \/>\}/);
  assert.equal(tut.match(/description=\{DESCRIPTION\}/g)?.length, 2, "iki başlıkta aynı açıklama");
});

// ---------------------------------------------------------------- Anlaşılır menü (29 Eki 2026, docs/planlar/ux-sade.md §3)

test("grupta tek alt öğe yanar: adresle eşleşenlerden en uzun adres (Nakit planı'nda Ödemeler, Fiyatlar'da Ürünler yanmaz)", () => {
  const children = (id: string) => NAV_TREE.find((n) => n.id === id)!.children!;
  assert.equal(activeChildOf(children("finans"), "/panel/hatirlaticilar/nakit"), "nakit");
  assert.equal(activeChildOf(children("finans"), "/panel/hatirlaticilar"), "hatirlaticilar");
  assert.equal(activeChildOf(children("menu"), "/panel/urunler/fiyatlar"), "fiyatlar");
  assert.equal(activeChildOf(children("menu"), "/panel/urunler/12"), "urunler");
  assert.equal(activeChildOf(children("vergi"), "/panel/vergi/kurallar"), "muhasebeci");
  assert.equal(activeChildOf(children("vergi"), "/panel/vergi"), "vergi-ozet");
  // Sekmesi aynı satırda olan ekran (match) o satırı yakar
  assert.equal(activeChildOf(children("alis"), "/panel/personel"), "giderler");
  assert.equal(activeChildOf(children("alis"), "/panel/bugun"), undefined);
  // Kenar çubuğu alt öğenin etkinliğini bu işlevden alır
  assert.match(src("sidebar-nav.tsx"), /const active = child\.id === activeChild;/);
});

test("KDV adıyla bulunur: kapalı kenar çubuğunda grup adında, palette başlığıyla", () => {
  const closed = navTreeFor("admin").map((n) => n.label);
  assert.ok(closed.some((l) => /\bKDV\b/.test(l)), closed.join(" · "));
  const palette = [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_FOOTER].filter((i) => i.roles.includes("admin"));
  assert.ok(palette.some((i) => i.label.startsWith("KDV")), "palette KDV ile başlayan kayıt");
  // Kare adresli kayıtlar yalnız yöneticinin; personelin paleti aynı kalır
  for (const i of palette) if (i.href.includes("#")) assert.deepEqual(i.roles, ["admin"], i.href);
});

test("palet sıralaması: aksanlı arama aksanlı başlığı öne alır ('kâr' Kâr / zarar, 'kar' Karaoke); adıyla bulunanlar", () => {
  // Paletin ekran kayıtları, sırası ve eşleşmesi command-palette.tsx'teki gibi (buildEntries + wordHit + score)
  const fold = (s: string) => s.toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const pages = [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_FOOTER].filter((i) => i.roles.includes("admin"));
  const entries = pages.map((p) => ({
    label: p.label,
    t: fold(p.label),
    raw: p.label.toLocaleLowerCase("tr-TR"),
    hay: fold([p.label, p.excel, p.keywords].filter(Boolean).join(" ")),
  }));
  const first = (query: string) => {
    const raw = query.toLocaleLowerCase("tr-TR");
    const q = fold(query);
    const words = q.split(" ");
    return entries
      .filter((e) => words.every((w) => wordHit(e.hay, w)))
      .map((e) => ({ e, s: score(e, q, words, raw) }))
      .sort((a, b) => a.s - b.s)
      .map((x) => x.e.label);
  };
  assert.equal(first("kâr")[0], "Kâr / zarar");
  assert.ok(first("kâr").indexOf("Kâr / zarar") < first("kâr").indexOf("Karaoke"));
  assert.equal(first("kar")[0], "Karaoke");
  assert.equal(first("kdv")[0], "KDV");
  assert.match(first("sgk")[0], /^SGK /);
  assert.ok(first("sgk").slice(0, 2).includes("SGK oranı") && first("sgk").slice(0, 2).includes("SGK primi"), first("sgk").join(", "));
  assert.equal(first("maaş")[0], "Maaşlar");
  assert.equal(first("geçmiş")[0], "İşlem geçmişi");
  assert.equal(first("yedek")[0], "Yedek");
  assert.equal(first("muhtasar")[0], "Maaş vergileri (muhtasar)");
  assert.equal(first("tutarlılık")[0], "Tutarlılık");
  // Eski adlar alışkanlıkla yazılınca da bulunur
  assert.ok(first("vergiye göre").includes("Vergi kârı"));
  assert.ok(first("hatırlatıcılar").includes("Ödemeler"));
  assert.ok(first("personel").includes("Maaşlar"));
});

test("bağlam satırı ağaçtan: grubun adı; üst düzey ekranda ve personelin üst düzey ekranında yok", () => {
  assert.equal(groupLabelOf("/panel/karaoke", "admin"), "Kafe");
  assert.equal(groupLabelOf("/panel/karaoke", "staff"), undefined);
  assert.equal(groupLabelOf("/panel/zayi", "staff"), "Stok");
  assert.equal(groupLabelOf("/panel/kasa", "admin"), undefined);
  assert.equal(groupLabelOf("/panel/kasa", "staff"), undefined);
  assert.equal(groupLabelOf("/panel/vergi/demirbas", "admin"), "Vergi, KDV, SGK");
  assert.equal(groupLabelOf("/panel/hatirlaticilar/nakit", "admin"), "Kâr & ödemeler");
  assert.equal(groupLabelOf("/panel/personel", "admin"), "Alış & gider");
  // Menüde olmayan ekran (Hesabım) bağlam satırı almaz; yöneticinin grubu personele sızmaz
  assert.equal(groupLabelOf("/panel/hesap", "admin"), undefined);
  assert.equal(groupLabelOf("/panel/vergi", "staff"), undefined);
  // Grubun adını taşıyan giriş ekranında bağlam satırı başlığı tekrarlamaz
  assert.equal(contextLineOf("/panel/vergi", "admin", "Vergi, KDV, SGK"), undefined);
  assert.equal(contextLineOf("/panel/ayarlar", "admin", "Ayarlar"), undefined);
  assert.equal(contextLineOf("/panel/vergi/demirbas", "admin", "Demirbaş"), "Vergi, KDV, SGK");
  assert.equal(contextLineOf("/panel/personel", "admin", "Maaşlar"), "Alış & gider");
});

test("bölüm sekmeleri: Vergi grubundan türer; Ödemeler ↔ Nakit planı yalnız yöneticide", () => {
  assert.deepEqual(
    sectionTabsFor("vergi", "admin").map((t) => t.label),
    ["Özet", "Vergi kârı", "Demirbaş", "Muhasebeci"],
  );
  assert.deepEqual(
    SECTION_TABS.vergi.map((t) => t.href),
    NAV_TREE.find((n) => n.id === "vergi")!.children!.map((c) => c.href),
  );
  assert.deepEqual(
    sectionTabsFor("odeme", "admin").map((t) => t.label),
    ["Ödemeler", "Nakit planı"],
  );
  assert.deepEqual(sectionTabsFor("odeme", "staff"), []);
  assert.deepEqual(sectionTabsFor("vergi", "staff"), []);
  assert.deepEqual(
    sectionTabsFor("giderler", "admin").map((t) => t.label),
    ["Sabit giderler", "Aylık harcamalar", "Maaşlar"],
  );
});
