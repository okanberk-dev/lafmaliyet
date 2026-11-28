// Şube özellikleri (şube kapsamı B6 ve C P1-8, 25 Kasım 2026; docs/SUBE.md › Şube özellikleri):
//
// kural      Karaoke, uygulama siparişi, garson çağır ve yemek kartı şube başına açık / kapalı (`branches.features`).
//            Sahibin varsayılanı: karaoke Tuzla'da, öbürleri her şubede; okunmamış satır bugünkü davranışı alır. Karaoke
//            tek şubede; online kanalın özelliği yok. Kitle: yönetici, şubesiz personel ve özelliği açık şubenin personeli.
// menü       Kapalı özelliğin ekranı kenar çubuğunda, çekmecede ve paletde yok; personelin alt menüsü beş hücre kalır.
// eylem      Sipariş aşaması ve masa çağrısında "Gördüm": özelliği kapalı şubeye kilitli personel reddedilir.
// kaynak     KARAOKE_BRANCH_ID sabiti kalktı: karaokenin şubesi her yerde özellikten; canlı uç, push ve Bugün özelliğe göre.
//
// Çalıştırma: npx tsx --test tests/sube-ozellik.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  BRANCH_FEATURES,
  branchFeatures,
  DEFAULT_BRANCH_FEATURES,
  featureAudience,
  featureBranches,
  featureChangeError,
  featureInScope,
  karaokeBranchOf,
  NEW_BRANCH_FEATURES,
  offFeatureLabels,
  parseFeatures,
  staffFeatureError,
  withFeature,
} from "../src/lib/branch-features";
import { ALL_BRANCHES, DEFAULT_BRANCHES, type BranchRow } from "../src/lib/branches";
import { bottomNavFor, navTreeFor, screenFeatureOn } from "../src/components/panel/nav";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const BRANCHES: BranchRow[] = DEFAULT_BRANCHES.map((b) => ({ ...b, active: true }));
const withRow = (id: string, patch: Partial<BranchRow>): BranchRow[] => BRANCHES.map((b) => (b.id === id ? { ...b, ...patch } : b));

test("varsayılanlar: karaoke Tuzla'da, sipariş, garson ve yemek kartı her şubede; online kanalın özelliği yok", () => {
  assert.deepEqual(branchFeatures(BRANCHES[0]), ["karaoke", "siparis", "garson", "yemek_karti"]);
  assert.deepEqual(branchFeatures(BRANCHES[1]), ["siparis", "garson", "yemek_karti"]);
  assert.deepEqual(branchFeatures(BRANCHES[2]), []);
  assert.equal(karaokeBranchOf(BRANCHES), "tuzla");
  // Özelliği okunmamış satır (eski okuyucu, test verisi) bugünkü davranış
  const bare = BRANCHES.map((b) => ({ ...b, features: undefined }));
  assert.deepEqual(branchFeatures(bare[0]), [...DEFAULT_BRANCH_FEATURES]);
  assert.deepEqual(branchFeatures(bare[1]), [...NEW_BRANCH_FEATURES]);
  assert.equal(karaokeBranchOf(bare), "tuzla");
  // Tanınmayan değer atılır, sıra ekranın sırası
  assert.deepEqual(parseFeatures(["garson", "uydurma", "karaoke", "garson"]), ["karaoke", "garson"]);
  assert.deepEqual(parseFeatures(null), []);
  assert.deepEqual(
    BRANCH_FEATURES.map((f) => f.id),
    ["karaoke", "siparis", "garson", "yemek_karti"],
  );
});

test("kapsam: tek şubede o şubenin özelliği, Tümü'de herhangi bir etkin şubede; online kanalda yalnız sipariş ve masa çağrısı; kapalı şube hiçbiri", () => {
  assert.equal(featureInScope("karaoke", "tuzla", BRANCHES), true);
  assert.equal(featureInScope("karaoke", "marina", BRANCHES), false);
  assert.equal(featureInScope("karaoke", ALL_BRANCHES, BRANCHES), true);
  // Online kanal: siparişler ve masa çağrıları siteden gelir, "Tümü" gibi (kanal görünümünde zil ve alarm susmaz);
  // karaoke ve yemek kartı kanalda yok
  assert.equal(featureInScope("siparis", "online", BRANCHES), featureInScope("siparis", ALL_BRANCHES, BRANCHES));
  assert.equal(featureInScope("garson", "online", BRANCHES), featureInScope("garson", ALL_BRANCHES, BRANCHES));
  assert.equal(featureInScope("karaoke", "online", BRANCHES), false);
  assert.equal(featureInScope("yemek_karti", "online", BRANCHES), false);
  const noOrders = BRANCHES.map((b) => ({ ...b, features: [] as string[] }));
  assert.equal(featureInScope("siparis", "online", BRANCHES), true);
  assert.equal(featureInScope("siparis", "online", noOrders), false, "hiçbir şubede açık değilse kanalda da yok");
  const noKaraoke = withRow("tuzla", { features: ["siparis"] });
  assert.equal(featureInScope("karaoke", ALL_BRANCHES, noKaraoke), false, "hiçbir şubede yok");
  assert.equal(karaokeBranchOf(noKaraoke), null);
  // Kapalı şubenin özelliği sayılmaz
  const closed = withRow("tuzla", { active: false });
  assert.equal(karaokeBranchOf(closed), null);
  assert.equal(featureInScope("karaoke", "tuzla", closed), false);
  // Karaoke Marina'ya taşınınca
  const moved = withRow("marina", { features: ["karaoke", "siparis"] }).map((b) => (b.id === "tuzla" ? { ...b, features: ["siparis", "garson"] } : b));
  assert.equal(karaokeBranchOf(moved), "marina");
  assert.deepEqual(featureBranches(moved, "garson").map((b) => b.id), ["tuzla"]);
});

test("kitle: yönetici, şubesiz personel ve özelliği açık şubenin personeli; pasif şubeli personel şubesiz sayılır", () => {
  const users = [
    { id: 1, role: "admin" as const, branchId: null },
    { id: 2, role: "staff" as const, branchId: null },
    { id: 3, role: "staff" as const, branchId: "tuzla" },
    { id: 4, role: "staff" as const, branchId: "marina" },
    { id: 5, role: "admin" as const, branchId: "marina" },
    { id: 6, role: "staff" as const, branchId: "eski" },
  ];
  const ids = (rows: { id: number }[]) => rows.map((u) => u.id);
  assert.deepEqual(ids(featureAudience(users, BRANCHES, "karaoke")), [1, 2, 3, 5, 6]);
  assert.deepEqual(ids(featureAudience(users, BRANCHES, "siparis")), [1, 2, 3, 4, 5, 6]);
  const marinaNoOrders = withRow("marina", { features: ["garson"] });
  assert.deepEqual(ids(featureAudience(users, marinaNoOrders, "siparis")), [1, 2, 3, 5, 6], "Marina'nın personeli sipariş zilini almaz");
  assert.deepEqual(featureAudience(users, withRow("tuzla", { features: [] }), "karaoke"), [], "hiçbir şubede yok: kimse");
});

test("değiştirme kuralı: karaoke tek şubede, online kanala özellik yok; dizi ekranın sırasıyla", () => {
  const marina = BRANCHES[1];
  assert.match(featureChangeError(marina, "karaoke", true, BRANCHES) ?? "", /Karaoke Tuzla şubesinde açık; önce oradan kapatın/);
  assert.equal(featureChangeError(marina, "karaoke", false, BRANCHES), null);
  assert.equal(featureChangeError(BRANCHES[0], "karaoke", true, BRANCHES), null, "zaten açık olan şubede sorun yok");
  assert.equal(featureChangeError(marina, "karaoke", true, withRow("tuzla", { features: ["siparis"] })), null);
  assert.equal(featureChangeError(marina, "karaoke", true, withRow("tuzla", { active: false })), null, "kapalı şubenin karaokesi engellemez");
  assert.equal(featureChangeError(marina, "garson", true, BRANCHES), null, "garson çok şubede olabilir");
  assert.match(featureChangeError(BRANCHES[2], "siparis", true, BRANCHES) ?? "", /Online kanalın/);
  assert.deepEqual(withFeature(["garson"], "karaoke", true), ["karaoke", "garson"]);
  assert.deepEqual(withFeature(["karaoke", "garson"], "karaoke", false), ["garson"]);
});

test("menü: kapalı özelliğin ekranı ağaçta, paletde ve alt menüde yok; personelin alt menüsü beş hücre kalır", () => {
  assert.equal(screenFeatureOn("/panel/karaoke/doluluk", ["siparis"]), false);
  assert.equal(screenFeatureOn("/panel/siparisler", ["garson"]), true, "garson açıkken Siparişler kalır");
  assert.equal(screenFeatureOn("/panel/siparisler#tukenenler", []), false);
  assert.equal(screenFeatureOn("/panel/kasa", []), true);
  assert.equal(screenFeatureOn("/panel/karaoke", undefined), true, "özellik verilmezse süzme yok");
  const hrefs = (role: "admin" | "staff", f?: Parameters<typeof navTreeFor>[1]) =>
    navTreeFor(role, f).flatMap((n) => (n.children ? n.children.map((c) => c.href) : [n.href]));
  assert.deepEqual(hrefs("staff"), hrefs("staff", ["karaoke", "siparis", "garson", "yemek_karti"]), "hepsi açıkken ağaç aynı");
  const marina = hrefs("staff", ["siparis", "garson", "yemek_karti"]);
  assert.ok(!marina.includes("/panel/karaoke") && marina.includes("/panel/siparisler"), "Marina'da karaoke yok");
  const admin = hrefs("admin", ["karaoke"]);
  assert.ok(!admin.includes("/panel/komisyonlar") && !admin.includes("/panel/siparisler") && admin.includes("/panel/karaoke"));
  // Alt menü: personel beş hücre; boşalan hücreye Zayi, sonra Kontrol
  const full = bottomNavFor("staff").map((i) => i.id);
  assert.deepEqual(full, ["bugun", "siparisler", "karaoke", "kasa", "receteler"]);
  assert.deepEqual(bottomNavFor("staff", { features: ["siparis"] }).map((i) => i.id), ["bugun", "siparisler", "zayi", "kasa", "receteler"]);
  assert.deepEqual(bottomNavFor("staff", { features: [] }).map((i) => i.id), ["bugun", "zayi", "kontrol", "kasa", "receteler"]);
  assert.deepEqual(bottomNavFor("admin", { features: [] }).map((i) => i.id), bottomNavFor("admin").map((i) => i.id), "yöneticinin alt menüsünde özellikli ekran yok");
});

test("eylem: özelliği kapalı şubeye kilitli personel reddedilir; yönetici serbest; hiçbir şubede yoksa bütün personel", () => {
  const staff = { role: "staff" };
  const noCalls = withRow("marina", { features: ["siparis", "yemek_karti"] });
  assert.equal(staffFeatureError({ role: "admin" }, "marina", noCalls, "garson"), null);
  assert.equal(staffFeatureError(staff, "marina", noCalls, "garson"), "Garson çağır bu şubede kullanılmıyor");
  assert.equal(staffFeatureError(staff, "tuzla", noCalls, "garson"), null);
  assert.equal(staffFeatureError(staff, null, noCalls, "garson"), null, "şubesiz personel özellik bir şubede açıkken serbest");
  assert.equal(staffFeatureError(staff, "marina", noCalls, "siparis"), null);
  const nowhere = BRANCHES.map((b) => ({ ...b, features: b.features?.filter((f) => f !== "siparis") }));
  assert.equal(staffFeatureError(staff, null, nowhere, "siparis"), "Uygulama siparişleri bu şubede kullanılmıyor");
  assert.equal(staffFeatureError({ role: "admin" }, null, nowhere, "siparis"), null);
  // Uçlar sorar (eylem kimliği istemci paketinde)
  assert.match(read("src/server/actions/site-orders.ts"), /const me = (?:adminActor\()?await requireCan\("kayit\.yaz"\)\)?;\n.*\n\s+await assertStaffFeature\(me, "siparis"\);/);
  assert.match(read("src/server/actions/table-calls.ts"), /const me = (?:adminActor\()?await requireCan\("kayit\.yaz"\)\)?;\n.*\n\s+await assertStaffFeature\(me, "garson"\);/);
});

test("çip: kapalı özelliklerin adları; karaoke ve online kanal sayılmaz", () => {
  assert.deepEqual(offFeatureLabels(BRANCHES[1]), []);
  assert.deepEqual(offFeatureLabels({ ...BRANCHES[1], features: ["siparis"] }), ["Garson çağır", "Yemek kartı ve platformlar"]);
  assert.deepEqual(offFeatureLabels(BRANCHES[2]), []);
  const card = read("src/app/panel/ayarlar/branch-settings-card.tsx");
  assert.match(card, /offFeatureLabels\(b\)/);
  assert.match(card, /hasFeature\(b, "karaoke"\) \? "karaoke" : null/);
});

/** src altındaki bütün .ts / .tsx dosyaları */
function sources(dir = join(root, "src")): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

test("kaynak: KARAOKE_BRANCH_ID sabiti kalktı; canlı uç, push, Bugün ve sayfalar özelliğe göre", () => {
  for (const f of sources()) assert.doesNotMatch(readFileSync(f, "utf8"), /KARAOKE_BRANCH_ID/, f);
  const live = read("src/app/api/canli/route.ts");
  assert.match(live, /const ordersHere = canOpen\(me\.role, "\/panel\/siparisler"\) && featureInScope\("siparis", scope, branchRows\);/);
  assert.match(live, /const callsHere = canOpen\(me\.role, "\/panel\/siparisler"\) && featureInScope\("garson", scope, branchRows\);/);
  assert.match(live, /list: linked && ordersHere \? snapshot\.orders : \[\],/);
  assert.match(live, /calls: linked && callsHere \? snapshot\.calls : \[\],/);
  const orders = read("src/server/site-orders/sync.ts");
  assert.match(orders, /\{ userIds: await featureAudienceIds\("siparis"\) \}/);
  assert.match(orders, /\{ userIds: await featureAudienceIds\("garson"\) \}/);
  const today = read("src/server/data/today.ts");
  assert.match(today, /const karaokeHere = karaokeAt !== null && requestInScope\(karaokeAt, karaokeScope\);/);
  assert.match(today, /configured && ordersHere \? safe\(/);
  assert.match(today, /\.then\(\(\[scope, branches\]\) => featureInScope\("yemek_karti", scope, branches\)\)/);
  assert.match(today, /commissionHere\.then\(\(on\) => \(on \? safe\(loadOverduePayouts\(\)\) : null\)\),/);
  assert.match(read("src/server/actions/notifications.ts"), /if \(!featureInScope\("yemek_karti", await currentBranchScope\(\), await listBranches\(\)\)\) return \[\];/);
  assert.match(read("src/app/panel/siparisler/page.tsx"), /ordersHere \|\| callsHere \?/);
  assert.match(read("src/app/panel/komisyonlar/page.tsx"), /if \(!featureInScope\("yemek_karti", view\.scope, view\.branches\)\) \{/);
  // Kenar çubuğu ve alt menü seçili kapsamın özellikleriyle
  const sidebar = read("src/components/panel/sidebar.tsx");
  assert.match(sidebar, /const tree = navTreeFor\(user\.role, features(, anaAdmin)?\);/);
  assert.match(sidebar, /features=\{features\}/);
  // Şube seçimi değişince canlı veri yeniden istenir
  assert.match(read("src/components/panel/live/alert-center.tsx"), /shownScope\.current = branchScope;\n\s+void refreshLive\(\);/);
  // Şube ayarları ekranında Özellikler kartı
  assert.match(read("src/app/panel/subeler/[id]/page.tsx"), /<BranchFeaturesCard branchId=\{branch\.id\}/);
});

test("göç: sütun db:generate ile, veri adımı Tuzla'ya karaoke ekler ve online kanalı boşaltır", () => {
  assert.match(read("drizzle/0084_sube_ozellik.sql"), /ALTER TABLE "branches" ADD COLUMN "features" text\[\] DEFAULT '\{siparis,garson,yemek_karti\}'::text\[\] NOT NULL;/);
  const data = read("drizzle/0085_sube_ozellik_veri.sql");
  assert.match(data, /SET "features" = array_append\("features", 'karaoke'\)\nWHERE "id" = 'tuzla'/);
  assert.match(data, /AND NOT EXISTS \(SELECT 1 FROM "branches" b WHERE b\."id" <> 'tuzla' AND 'karaoke' = ANY \(b\."features"\)\)/);
  assert.match(data, /UPDATE "branches" SET "features" = '\{\}'::text\[\] WHERE "kind" = 'online'/);
});
