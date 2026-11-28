// Hızlı sayım ve mal siparişi kaldırıldı (26 Eki 2026, parti B21; sahibin isteği: "Hızlı sayım ile mal siparişi
// kısmını kaldır, gereksiz çünkü normal sayım olsun"). Ekranlar, eylemler, iş adımları, Bugün satırları, zil, bildirim,
// menü ve Yardım satırları gitti; eski adresler Stok sayımı'na yönlenir; veritabanı tabloları geçmiş için şemada kalır
// (migration yok). Aylık Stok sayımı ve ay sonu sayım bildirimi aynen sürer.
// Çalıştırma: npx tsx --test tests/hizli-siparis-kaldirildi.test.ts

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { BOTTOM_NAV, mobileTitleFor, NAV_FOOTER, NAV_GROUPS, NAV_TREE, navTreeFor, SECTION_TABS } from "../src/components/panel/nav";
import { countStep, STEP_LABELS, stepTexts } from "../src/lib/job-health";
import { refreshesScreen } from "../src/lib/live-poll";
import { canOpen, RETIRED_PATHS, retiredRedirect, ROLE_PERMISSIONS, STAFF_PATHS, STAFF_ROLE_HINT } from "../src/lib/roles";
import { RETIRED_REQUEST_KINDS, STAFF_APPROVAL_KINDS, STAFF_REQUEST_KINDS } from "../src/lib/staff-requests";
import * as schema from "../src/server/db/schema";

const root = process.cwd();
const read = (f: string) => readFileSync(join(root, f), "utf8");
const walk = (dir: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(tsx?|mjs|js)$/.test(e.name) ? [`${dir}/${e.name}`] : []));
/** Yorumları atar: kaldırılış notları kalabilir, kod ve metin kalamaz */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("eski adresler 404 yerine Stok sayımı'na: alt sayfalar dahil, yol parçası sınırında", () => {
  // Yönlendirme listesinin ilk iki satırı (Vergi 27 Kasım 2026'da eklendi: tests/vergi-kaldirildi.test.ts)
  assert.deepEqual(
    RETIRED_PATHS.filter((r) => r.target === "/panel/sayim").map((r) => r.path),
    ["/panel/hizli-sayim", "/panel/mal-siparisi"],
  );
  const RETIRED_TARGET = "/panel/sayim";
  for (const p of [
    "/panel/hizli-sayim",
    "/panel/hizli-sayim/",
    "/panel/hizli-sayim/siparis",
    "/panel/mal-siparisi",
    "/panel/mal-siparisi/gonderilen",
    "/panel/mal-siparisi/kalemler",
  ]) {
    assert.equal(retiredRedirect(p), "/panel/sayim", p);
  }
  for (const p of ["/panel/sayim", "/panel/hizli-sayimlar", "/panel/mal-siparisi-eski", "/panel/bugun", "/hizli-sayim", "/panel"]) assert.equal(retiredRedirect(p), null, p);
  // Hedef iki rolde de açılır (personel de yer iminden gelince sayıma düşer)
  assert.ok(canOpen("staff", RETIRED_TARGET) && canOpen("admin", RETIRED_TARGET));
});

test("proxy eski adresi oturumdan önce, sorgusuz ve geçici olarak yönlendirir; eşleştirici /panel'i kapsar", () => {
  const proxy = read("src/proxy.ts");
  assert.match(proxy, /import \{ canOpen, homeFor, REMOVED_PARAM, retiredRedirect \} from "@\/lib\/roles";/);
  const body = proxy.slice(proxy.indexOf("export async function proxy"));
  const at = body.indexOf("retiredRedirect(pathname)");
  assert.ok(at > 0 && at < body.indexOf("verifySession("), "oturum okunmadan önce");
  // new URL(hedef, request.url): sorgu ve çapa düşer (eski ?durum=fark sayımın süzgecine karışmaz); NextResponse.redirect varsayılanı 307
  assert.match(body, /if \(retired\) return NextResponse\.redirect\(new URL\(retired, request\.url\)\);/);
  assert.match(proxy, /matcher: \[\s*"\/panel\/:path\*",/);
  // Kalıcı yönlendirme (308) yok: tarayıcı önbelleğe almasın, adres ileride yeniden kullanılabilsin
  assert.doesNotMatch(proxy, /\b308\b|permanent/);
  assert.doesNotMatch(read("next.config.ts"), /hizli-sayim|mal-siparisi/);
});

test("ekranlar ve modüller silindi; yerlerinde yalnız yönlendirme var", () => {
  for (const p of [
    "src/app/panel/hizli-sayim",
    "src/app/panel/mal-siparisi",
    "src/app/panel/onaylar/draft-cards.tsx",
    "src/lib/reorder",
    "src/server/reorder",
    "src/server/order-drafts",
    "src/server/actions/reorder.ts",
    "src/server/actions/order-drafts.ts",
    "src/server/data/reorder.ts",
    "src/server/data/order-drafts.ts",
    "src/server/notify/reorder-push.ts",
  ]) {
    assert.equal(existsSync(join(root, p)), false, `${p} hâlâ var`);
  }
});

test("kodda kaldırılan ekranlara bağlantı, eylem ya da modül kalmadı (yönlendirme listesi hariç)", () => {
  const files = [...walk("src"), ...walk("scripts")].filter((f) => f !== "src/lib/roles.ts");
  const bad: string[] = [];
  for (const f of files) {
    const src = code(read(f));
    for (const re of [
      /\/panel\/hizli-sayim/,
      /\/panel\/mal-siparisi/,
      /@\/lib\/reorder|@\/server\/(reorder|order-drafts)|server\/data\/(reorder|order-drafts)|notify\/reorder-push|actions\/(reorder|order-drafts)/,
      /\b(quickCounts|reorderItems|supplierOrders)\b/,
      /Hızlı sayım|Mal siparişi|Sipariş taslağı/,
    ]) {
      // İstisnalar: şemadaki tablo tanımları (geçmiş için) ve eski isteklerin tür etiketleri ("Mal siparişi taslağı")
      const kept = (f === "src/server/db/schema.ts" && re.source.includes("quickCounts")) || (f === "src/lib/staff-requests.ts" && re.source.startsWith("Hızlı"));
      if (re.test(src) && !kept) bad.push(`${f}: ${re.source}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("menü: kenar çubuğu, sekmeler, komut paleti, alt menü ve başlıklar kaldırılan ekranı göstermez", () => {
  const hrefs = [
    ...NAV_TREE.flatMap((n) => [n.href, ...(n.children ?? []).map((c) => c.href)]),
    ...NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)),
    ...NAV_FOOTER.map((i) => i.href),
    ...Object.values(SECTION_TABS).flatMap((tabs) => tabs.map((t) => t.href)),
    ...BOTTOM_NAV.admin.map((i) => i.href),
    ...BOTTOM_NAV.staff.map((i) => i.href),
  ].filter((h): h is string => Boolean(h));
  for (const h of hrefs) assert.equal(retiredRedirect(h), null, h);
  assert.ok(!("malSiparisi" in SECTION_TABS));
  // Stok grubu: yöneticide Stok sayımı, Zayi & ikram, Tutarlılık; personelde Stok sayımı, Zayi & ikram
  const stok = (role: "admin" | "staff") => navTreeFor(role).find((n) => n.id === "stok")?.children?.map((c) => c.label);
  assert.deepEqual(stok("admin"), ["Stok sayımı", "Zayi & ikram", "Tutarlılık"]);
  assert.deepEqual(stok("staff"), ["Stok sayımı", "Zayi & ikram"]);
  // Telefonun üst çubuğu: eski adresin özel başlığı yok (yönlendirme zaten Stok sayımı'nı açar)
  assert.equal(mobileTitleFor("/panel/mal-siparisi/gonderilen"), "L'Affogato");
  const palette = NAV_GROUPS.flatMap((g) => g.items.map((i) => `${i.label} ${i.keywords ?? ""}`)).join(" ");
  assert.doesNotMatch(palette, /hızlı sayım|mal siparişi|teslim kontrolü/i);
});

test("roller: personelin ekranları ve yetki tablosu hızlı sayımı ve mal siparişini anmaz", () => {
  assert.ok(!(STAFF_PATHS as readonly string[]).some((p) => retiredRedirect(p)));
  for (const p of ROLE_PERMISSIONS) for (const path of p.paths ?? []) assert.equal(retiredRedirect(path), null, path);
  assert.doesNotMatch(`${ROLE_PERMISSIONS.map((p) => p.label).join(" ")} ${STAFF_ROLE_HINT}`, /hızlı sayım|mal siparişi|sipariş taslağı|gelen mal/i);
});

test("personel istekleri: mal siparişi taslağı kaldırılan tür; Yardım'da yok, enumda (eski satırlar için) var", () => {
  assert.deepEqual([...RETIRED_REQUEST_KINDS], ["mal-taslak"]);
  assert.ok((STAFF_REQUEST_KINDS as readonly string[]).includes("mal-taslak"), "eski satırlar okunabilsin");
  assert.ok(schema.staffRequests.kind.enumValues.includes("mal-taslak"));
  assert.ok(!STAFF_APPROVAL_KINDS.some((a) => a.kind === "mal-taslak"));
  // Kuyruk okuyucuları kaldırılan türü süzer, çekirdek yeni istek açmaz, sabah işi canlı kalanları kapatır (DB testi:
  // tests/onay-kuyrugu-db.test.ts)
  const core = read("src/server/staff-requests/core.ts");
  assert.match(core, /const live = \(\) => notInArray\(s\.staffRequests\.kind, \[\.\.\.RETIRED_REQUEST_KINDS\]\);/);
  for (const fn of ["countPendingByKind", "pendingRequests", "recentDecisions"]) {
    const start = core.indexOf(`export async function ${fn}`);
    const body = core.slice(start, core.indexOf("\n}\n", start));
    assert.match(body, /live\(\)/, fn);
  }
  assert.match(core, /Kaldırılan istek türü: \$\{input\.kind\}/);
  assert.match(core, /and\(inArray\(r\.kind, \[\.\.\.RETIRED_REQUEST_KINDS\]\), inArray\(r\.status, \["pending", "approved"\]\)\)/);
  // Onaylar: zayi bölümü kalır, taslak kartları yok
  const ops = read("src/app/panel/onaylar/ops-section.tsx");
  assert.doesNotMatch(code(ops), /Draft|order-drafts/);
  assert.match(ops, /export async function OpsRequests\(\) \{\s+(?:\/\/[^\n]*\n\s+)?const me = await requireCan\("onay"\);/);
});

test("veritabanı: üç tablo şemada geçmiş için kalır, migration yok; jsonb biçimleri yalnız tip", () => {
  assert.equal(schema.quickCounts && typeof schema.quickCounts, "object");
  assert.equal(schema.reorderItems && typeof schema.reorderItems, "object");
  assert.equal(schema.supplierOrders && typeof schema.supplierOrders, "object");
  const src = read("src/server/db/schema.ts");
  assert.match(src, /Hızlı sayım ve mal siparişi 26 Eki 2026'da panelden kaldırıldı/);
  assert.match(src, /Üç tablo geçmiş için duruyor: migration yok, veri silinmez/);
  // Bu partide migration eklenmedi (son migration 0042 idi); sonrakiler de üç tabloya dokunmaz ve hiçbir migration
  // tabloları silmez
  const journal = JSON.parse(read("drizzle/meta/_journal.json")) as { entries: { tag: string }[] };
  const tags = journal.entries.map((e) => e.tag);
  assert.ok(tags.includes("0042_okc_z"));
  for (const tag of tags.slice(tags.indexOf("0042_okc_z") + 1)) {
    assert.doesNotMatch(read(`drizzle/${tag}.sql`), /"(quick_counts|reorder_items|supplier_orders)"/, tag);
  }
  for (const f of readdirSync(join(root, "drizzle")).filter((x) => x.endsWith(".sql"))) {
    assert.doesNotMatch(read(`drizzle/${f}`), /DROP TABLE[^;]*"(quick_counts|reorder_items|supplier_orders)"/i, f);
  }
});

test("günlük iş: hızlı sayım bildirimi yerine ay sonu sayım bildirimi; adımın anahtarı ve sözcükleri", () => {
  const cron = read("src/app/api/cron/gunluk/route.ts");
  assert.match(cron, /import \{ pushMonthEndCount \} from "@\/server\/notify\/count-push";/);
  assert.match(cron, /pushMonthEndCount\(\)\.catch\(\(e: Error\) => \(\{ error: e\.message \}\)\)/);
  assert.match(cron, /const countResult = countStep\(count\);/);
  const push = read("src/server/notify/count-push.ts");
  assert.match(push, /export async function pushMonthEndCount\(now = new Date\(\)\)/);
  assert.match(push, /sendPush\("reminders", \{ kind: "reminders", \.\.\.push \}/);
  assert.doesNotMatch(code(push), /hizli|reorder|countPushDue/);
  // Adımın anahtarı eski kayıtlar için aynı; sözcük genel
  assert.deepEqual(STEP_LABELS.count, { sent: "Sayım bildirimi gitti", error: "Sayım bildirimi hata" });
  assert.deepEqual(stepTexts({ count: "sent" }), ["Sayım bildirimi gitti"]);
  assert.equal(countStep({ status: "skip", sent: 0, failed: 0 }), undefined);
  assert.deepEqual(countStep({ status: "sent", sent: 2, failed: 0 }), { code: "sent" });
  assert.deepEqual(countStep({ status: "sent", sent: 0, failed: 3 }), { code: "error", error: "3 cihaza gönderilemedi" });
  assert.deepEqual(countStep({ error: "süre doldu" }), { code: "error", error: "süre doldu" });
});

test("bildirim: onay anahtarı taslakla gitti, yeni gönderenle (personelin yeni isteği, 25 Kasım) yalnız yöneticide döndü; canlı yenileme yalnız Onaylar'ı; zil ve Paraşüt teslim kontrolü yapmaz", () => {
  const device = read("src/components/panel/live/device-alerts.tsx");
  // Taslak gönderen yok; tek gönderen onay isteğinin bildirimi (src/server/staff-requests/push.ts, tests/onay-bildirimi.test.ts)
  assert.match(read("src/server/staff-requests/push.ts"), /sendPush\("approvals"/);
  assert.match(device, /\{role === "admin" \? \(\s+<ToggleRow\s+title="Onay bildirimleri"/);
  assert.equal(refreshesScreen("/panel/onaylar", "approvals"), true);
  assert.equal(refreshesScreen("/panel/hizli-sayim/siparis", "approvals"), false);
  assert.doesNotMatch(code(read("src/server/bell/ops.ts")), /draft|Draft|taslak/);
  assert.doesNotMatch(code(read("src/server/actions/notifications.ts")), /reorder/);
  for (const f of ["src/server/parasut/sync.ts", "src/server/actions/parasut.ts"]) assert.doesNotMatch(code(read(f)), /matchSupplierOrders|matchSummary|recheckOrders/, f);
});

test("Bugün: hızlı sayım, mal siparişi ve onaylı taslak satırı yok; olgular yüklenmez", () => {
  const logic = code(read("src/app/panel/bugun/logic.ts"));
  assert.doesNotMatch(logic, /"hizli-sayim"|"mal-siparisi"|"mal-taslak"|quickCountRow|reorderRow|draftRow|reorder\?:/);
  const today = code(read("src/server/data/today.ts"));
  assert.doesNotMatch(today, /loadReorderDay|reorder/);
  assert.doesNotMatch(code(read("src/server/data/today-ops.ts")), /staffApprovedDrafts|drafts/);
});

test("Yardım: iki rolde de kaldırılan ekranlar anlatılmaz; personelin rutini ay sonu sayımını söyler", async () => {
  const admin = code(read("src/app/panel/yardim/page.tsx"));
  assert.doesNotMatch(admin, /hızlı sayım|mal siparişi|teslim kontrolü|"mal-siparisi"|"teslim"/i);
  const staff = code(read("src/app/panel/yardim/personel/content.tsx"));
  assert.doesNotMatch(staff, /hızlı sayım|sipariş taslağı|"hizli-sayim"|"siparis-taslagi"/i);
  assert.doesNotMatch(staff, /<B>Geldi<\/B>|gelen mal/);
  const { STAFF_ROUTINE, STAFF_FAQ_GROUPS } = await import("../src/app/panel/yardim/personel/content");
  const month = STAFF_ROUTINE.find((r) => r.title === "Ayın son günü");
  assert.ok(month, "ay sonu adımı");
  assert.equal(month.href, "/panel/sayim");
  assert.ok(STAFF_FAQ_GROUPS.some((g) => g.title === "Stok sayımı" && g.items.some((i) => i.id === "sayim")));
});

test("belgeler: MAL-SIPARISI.md kaldırıldı notu; KALAN-ISLER B21'i anar", () => {
  const doc = read("docs/MAL-SIPARISI.md");
  assert.match(doc, /^# Mal siparişi ve hızlı sayım \(kaldırıldı\)/);
  assert.match(doc, /26 Ekim 2026/);
  const kalan = read("docs/planlar/KALAN-ISLER.md");
  assert.match(kalan, /B21/);
  assert.match(kalan, /Hızlı sayım ve mal siparişi kaldırıldı/);
  const readme = read("README.md");
  assert.doesNotMatch(readme, /\/panel\/hizli-sayim|\/panel\/mal-siparisi/);
});
