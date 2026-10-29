// Roller: personelin girebildiği ekranlar tek kaynakta (src/lib/roles.ts), menü ve proxy aynı kurala bakar; yol
// parçası sınırında eşleşir (/panel/sayimx açılmaz). Kullanıcı düzenlemede e-posta değişince bağlantılar iptal olur.
// Çalıştırma: npx tsx --test tests/roller.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { BOTTOM_NAV, NAV_FOOTER, NAV_GROUPS, NAV_TREE, navTreeFor } from "../src/components/panel/nav";
import { ADMIN_ONLY_PATHS, canOpen, homeFor, STAFF_HOME, STAFF_PATHS } from "../src/lib/roles";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("personel yalnız kendi ekranlarını açar; yol parçası sınırında eşleşir", () => {
  for (const p of STAFF_PATHS) {
    assert.ok(canOpen("staff", p), p);
    assert.ok(canOpen("staff", `${p}/alt`), `${p}/alt`);
  }
  for (const p of ["/panel", "/panel/urunler", "/panel/urunler/12", "/panel/onaylar", "/panel/hatirlaticilar", "/panel/kullanicilar", "/panel/tutarlilik", "/panel/ayarlar"]) {
    assert.equal(canOpen("staff", p), false, p);
  }
  // Önek benzerliği kapı açmaz (eski proxy startsWith ile açıyordu)
  assert.equal(canOpen("staff", "/panel/sayimlar"), false);
  assert.equal(canOpen("staff", "/panel/receteler-arsiv"), false);
  // Ödemeler (işletme) ile kişisel hatırlatıcılar karışmaz
  assert.equal(canOpen("staff", "/panel/hatirlaticilar"), false);
  assert.equal(canOpen("staff", "/panel/hatirlaticilarim"), true);
  // Yönetici her yere, panel dışı adresler kuralın dışında
  assert.ok(canOpen("admin", "/panel/kullanicilar"));
  assert.ok(canOpen("staff", "/menu"));
  assert.equal(homeFor("admin"), "/panel");
  assert.equal(homeFor("staff"), STAFF_HOME);
  assert.ok(canOpen("staff", STAFF_HOME));
  // Personel girişte Bugün'de açılır (günün işleri; ay sonu sayımı orada satır olarak çıkar)
  assert.equal(STAFF_HOME, "/panel/bugun");
  assert.ok(canOpen("staff", "/panel/bugun"));
  assert.equal(canOpen("staff", "/panel/bugunler"), false);
  // Kontrol listeleri: personel bugünün listelerini açar ve doldurur, son 7 günü Geçmiş'ten görür; listeleri
  // düzenlemek yöneticinin (proxy personeli sokmaz, sayfa da requireAdmin)
  assert.ok(canOpen("staff", "/panel/kontrol"));
  assert.ok(canOpen("staff", "/panel/kontrol/3"));
  assert.ok(canOpen("staff", "/panel/kontrol/gecmis"));
  assert.equal(canOpen("staff", "/panel/kontrol/duzenle"), false);
  assert.equal(canOpen("staff", "/panel/kontrol/duzenle/2"), false);
  assert.equal(canOpen("staff", "/panel/kontroller"), false);
  for (const p of ["src/app/panel/kontrol/duzenle/page.tsx", "src/app/panel/kontrol/duzenle/[id]/page.tsx"]) {
    assert.match(read(p), /await requireAdmin\(\)/, p);
  }
  // Kasadaki fiyatlar (dalga 10 §2.2): personel kasanın altında işaretler; Ürünler › Fiyatlar kapalı
  assert.ok(canOpen("staff", "/panel/kasa/fiyatlar"));
  assert.equal(canOpen("staff", "/panel/urunler/fiyatlar"), false);
  // Özel günler ve personelin Yardım'ı; yöneticinin Yardım'ı ve Onaylar kapalı
  assert.ok(canOpen("staff", "/panel/ozel-gunler"));
  assert.ok(canOpen("staff", "/panel/yardim/personel"));
  assert.equal(canOpen("staff", "/panel/yardim"), false);
  assert.equal(canOpen("staff", "/panel/yardim/personelx"), false);
  assert.equal(canOpen("staff", "/panel/onaylar"), false);
  assert.ok(canOpen("admin", "/panel/yardim/personel"));
  // Vergi (dalga 12) ve üç alt sayfası yalnız yöneticinin; personelin ağacında Vergi yok (proxy Bugün'e gönderir)
  for (const p of ["/panel/vergi", "/panel/vergi/gelir-gider", "/panel/vergi/demirbas", "/panel/vergi/kurallar"]) {
    assert.equal(canOpen("staff", p), false, p);
    assert.ok(canOpen("admin", p), p);
  }
  const staffIds = navTreeFor("staff").flatMap((n) => [n.id, ...(n.children ?? []).map((c) => c.id)]);
  assert.ok(!staffIds.includes("vergi") && !staffIds.includes("finans"));
  assert.ok(navTreeFor("admin").find((n) => n.id === "finans")?.children?.some((c) => c.id === "vergi" && c.href === "/panel/vergi"));
});

test("personel yolunun altındaki yönetici ekranları (Karaoke › Doluluk, Kontrol › Listeler) personele kapalı", () => {
  assert.deepEqual([...ADMIN_ONLY_PATHS], ["/panel/karaoke/doluluk", "/panel/kontrol/duzenle"]);
  assert.equal(canOpen("staff", "/panel/karaoke/doluluk"), false);
  assert.equal(canOpen("staff", "/panel/karaoke/doluluk/x"), false);
  assert.equal(canOpen("staff", "/panel/karaoke"), true);
  assert.equal(canOpen("staff", "/panel/karaoke/dolulukx"), true, "yol parçası sınırında");
  assert.equal(canOpen("admin", "/panel/karaoke/doluluk"), true);
  // Her yönetici ekranı gerçekten bir personel yolunun altında (yoksa liste gereksiz)
  for (const p of ADMIN_ONLY_PATHS) assert.ok(STAFF_PATHS.some((s) => p.startsWith(`${s}/`)), p);
});

test("menüdeki her öğenin rolü erişim kuralıyla aynı (personel menüde gördüğü her ekrana girebilir, başkasını görmez)", () => {
  const items = [
    ...NAV_GROUPS.flatMap((g) => g.items),
    ...NAV_FOOTER,
    ...NAV_TREE.flatMap((n) => [...(n.href ? [{ href: n.href, roles: n.roles }] : []), ...(n.children ?? [])]),
  ];
  for (const item of items) {
    assert.equal(item.roles.includes("staff"), canOpen("staff", item.href), `${item.href}: menü rolü ile erişim kuralı aynı olmalı`);
  }
  const staffTree = navTreeFor("staff").flatMap((n) => (n.children ? n.children.map((c) => c.href) : [n.href!]));
  for (const href of staffTree) assert.ok(canOpen("staff", href), href);
  // Personel menüsünde her ekran (Hesabım profil menüsünde)
  for (const p of STAFF_PATHS.filter((x) => x !== "/panel/hesap")) assert.ok(staffTree.includes(p), `${p} personel menüsünde yok`);
  for (const item of BOTTOM_NAV.staff) assert.ok(canOpen("staff", item.href!), item.href);
});

test("proxy, giriş ve requireAdmin aynı kaynağa bakar", () => {
  const proxy = read("src/proxy.ts");
  assert.match(proxy, /canOpen\(session\.role, pathname\)/);
  assert.doesNotMatch(proxy, /STAFF_ALLOWED/);
  assert.match(read("src/server/actions/auth.ts"), /canOpen\(role, next\.split/);
  assert.match(read("src/server/auth/dal.ts"), /redirect\(STAFF_HOME\)/);
});

test("kullanıcı düzenleme: e-posta değişince ya da pasif yapılınca bekleyen bağlantılar iptal olur", () => {
  const src = read("src/server/actions/settings.ts");
  assert.match(src, /data\.password \|\| before\.email !== data\.email \|\| \(before\.active && !data\.active\)\) await expireUserTokens\(data\.id\)/);
});

test("personelin her sunucu eylemi kendi kaydına dokunur: hatırlatıcı sorguları kullanıcıya göre süzülür", () => {
  const src = read("src/server/actions/user-reminders.ts");
  // Her güncelleme / silme mine(id, me.id) ile; başka sorgu yolu yok
  const writes = src.match(/\.(update|delete)\(s\.userReminders\)/g) ?? [];
  const scoped = src.match(/\.where\(mine\([^)]*me\.id\)\)/g) ?? [];
  assert.ok(writes.length > 0);
  assert.ok(scoped.length >= writes.length, "her yazım mine(…, me.id) ile süzülmeli");
  assert.doesNotMatch(src, /requireAdmin/);
});
