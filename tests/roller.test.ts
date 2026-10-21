// Roller: personelin girebildiği ekranlar tek kaynakta (src/lib/roles.ts), menü ve proxy aynı kurala bakar; yol
// parçası sınırında eşleşir (/panel/sayimx açılmaz). Kullanıcı düzenlemede e-posta değişince bağlantılar iptal olur.
// Çalıştırma: npx tsx --test tests/roller.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { BOTTOM_NAV, NAV_FOOTER, NAV_GROUPS, NAV_TREE, navTreeFor } from "../src/components/panel/nav";
import { canOpen, homeFor, STAFF_HOME, STAFF_PATHS } from "../src/lib/roles";

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
