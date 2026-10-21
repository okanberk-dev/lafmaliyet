// Telefon kabuğu: alt menü öğeleri, etkin öğe, gecikmiş ödeme rozeti ve üst çubuk başlığı
// (src/components/panel/nav.ts, bottom-nav.tsx, sidebar.tsx).
// Çalıştırma: npx tsx --test tests/mobile-nav.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { badgeText, BOTTOM_NAV, bottomNavActive, mobileTitleFor, NAV_TREE, overdueCount } from "../src/components/panel/nav";
import { canOpen, STAFF_PATHS } from "../src/lib/roles";

test("yönetici alt menüsü: Genel bakış, Satışlar, Faturalar, Ödemeler, Menü", () => {
  assert.deepEqual(
    BOTTOM_NAV.admin.map((i) => i.label),
    ["Genel bakış", "Satışlar", "Faturalar", "Ödemeler", "Menü"],
  );
  assert.deepEqual(
    BOTTOM_NAV.admin.map((i) => i.href ?? null),
    ["/panel", "/panel/satislar", "/panel/faturalar", "/panel/hatirlaticilar", null],
  );
  assert.equal(BOTTOM_NAV.admin.find((i) => i.id === "odemeler")?.badge, "overdue");
});

test("personel alt menüsü erişebildiği ekranların hepsi; Hesabım profil menüsünde (src/lib/roles.ts STAFF_PATHS)", () => {
  assert.deepEqual(
    BOTTOM_NAV.staff.map((i) => [i.label, i.href]),
    [
      ["Karaoke", "/panel/karaoke"],
      ["Kasa", "/panel/kasa"],
      ["Reçeteler", "/panel/receteler"],
      ["Sayım", "/panel/sayim"],
      ["Hatırlatıcı", "/panel/hatirlaticilarim"],
    ],
  );
  for (const item of BOTTOM_NAV.staff) assert.ok(canOpen("staff", item.href!), item.href);
  assert.deepEqual(
    [...BOTTOM_NAV.staff.map((i) => i.href)].sort(),
    STAFF_PATHS.filter((p) => p !== "/panel/hesap").sort(),
    "alt menüde personelin her ekranı var",
  );
});

test("her alt menü bağlantısı kenar çubuğunda da var (çekmecede kaybolan ekran yok)", () => {
  const hrefs = new Set(NAV_TREE.flatMap((n) => [n.href, ...(n.children ?? []).map((c) => c.href)]).filter(Boolean));
  hrefs.add("/panel/hesap"); // profil menüsünde
  for (const item of [...BOTTOM_NAV.admin, ...BOTTOM_NAV.staff]) {
    if (item.href) assert.ok(hrefs.has(item.href), item.href);
  }
});

test("etkin öğe: adres eşleşmesi, alt sayfalar, çekmecedeki ekranlar Menü'yü yakar", () => {
  const admin = BOTTOM_NAV.admin;
  assert.equal(bottomNavActive(admin, "/panel"), "genel");
  assert.equal(bottomNavActive(admin, "/panel/satislar"), "satislar");
  assert.equal(bottomNavActive(admin, "/panel/faturalar"), "faturalar");
  assert.equal(bottomNavActive(admin, "/panel/hatirlaticilar"), "odemeler");
  // "/panel" yalnızca tam eşleşir: başka her ekran Genel bakış'ı yakmaz
  assert.equal(bottomNavActive(admin, "/panel/urunler"), "menu");
  assert.equal(bottomNavActive(admin, "/panel/urunler/12"), "menu");
  assert.equal(bottomNavActive(admin, "/panel/ayarlar"), "menu");
  // Benzer önekler karışmaz
  assert.equal(bottomNavActive(admin, "/panel/satislar-arsiv"), "menu");
  // Çekmece açıkken Menü etkin
  assert.equal(bottomNavActive(admin, "/panel/satislar", true), "menu");
});

test("personelde Menü öğesi yok: eşleşmeyen adres hiçbir öğeyi yakmaz", () => {
  const staff = BOTTOM_NAV.staff;
  assert.equal(bottomNavActive(staff, "/panel/sayim"), "sayim");
  assert.equal(bottomNavActive(staff, "/panel/receteler"), "receteler");
  assert.equal(bottomNavActive(staff, "/panel/hesap"), null);
  assert.equal(bottomNavActive(staff, "/panel/kasa"), "kasa");
  assert.equal(bottomNavActive(staff, "/panel/karaoke"), "karaoke");
  assert.equal(bottomNavActive(staff, "/panel/hatirlaticilarim"), "hatirlaticilarim");
  assert.equal(bottomNavActive(staff, "/panel/tutarlilik"), null);
  assert.equal(bottomNavActive(staff, "/panel/sayim", true), "sayim");
});

test("gecikmiş ödeme sayısı yalnızca ödeme grubundaki 'danger' bildirimleri sayar", () => {
  assert.equal(overdueCount(null), 0);
  assert.equal(overdueCount([]), 0);
  assert.equal(
    overdueCount([
      { group: "odeme", kind: "danger" },
      { group: "odeme", kind: "warning" },
      { group: "odeme", kind: "info" },
      { group: "uyari", kind: "danger" },
      { group: "odeme", kind: "danger" },
      { kind: "danger" },
    ]),
    2,
  );
});

test("rozet metni: 0 ya da geçersizse yok, 9'dan fazlası 9+", () => {
  assert.equal(badgeText(0), null);
  assert.equal(badgeText(-1), null);
  assert.equal(badgeText(Number.NaN), null);
  assert.equal(badgeText(1), "1");
  assert.equal(badgeText(9), "9");
  assert.equal(badgeText(10), "9+");
  assert.equal(badgeText(120), "9+");
});

test("üst çubuk başlığı: kısa adlar, alt sayfalar, bilinmeyen ekran", () => {
  assert.equal(mobileTitleFor("/panel"), "Genel bakış");
  assert.equal(mobileTitleFor("/panel/"), "Genel bakış");
  assert.equal(mobileTitleFor("/panel/satislar"), "Satışlar");
  assert.equal(mobileTitleFor("/panel/faturalar"), "Faturalar");
  assert.equal(mobileTitleFor("/panel/hatirlaticilar"), "Ödemeler");
  assert.equal(mobileTitleFor("/panel/urunler"), "Ürünler");
  assert.equal(mobileTitleFor("/panel/urunler/42"), "Ürünler");
  assert.equal(mobileTitleFor("/panel/giderler"), "Sabit giderler");
  assert.equal(mobileTitleFor("/panel/gelir-gider"), "Gelir-gider");
  assert.equal(mobileTitleFor("/panel/personel"), "Personel");
  assert.equal(mobileTitleFor("/panel/sayim"), "Stok sayımı");
  assert.equal(mobileTitleFor("/panel/tutarlilik"), "Tutarlılık");
  assert.equal(mobileTitleFor("/panel/receteler"), "Reçete defteri");
  assert.equal(mobileTitleFor("/panel/hesap"), "Hesabım");
  assert.equal(mobileTitleFor("/panel/ayarlar"), "Ayarlar");
  assert.equal(mobileTitleFor("/panel/karaoke"), "Karaoke");
  assert.equal(mobileTitleFor("/panel/hatirlaticilarim"), "Hatırlatıcılarım");
  assert.equal(mobileTitleFor("/panel/onaylar"), "Reçete onayları");
  assert.equal(mobileTitleFor("/panel/bilinmeyen"), "L'Affogato");
});
