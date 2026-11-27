// Vergi bölümü kaldırıldı (sahibin kararı 27 Kasım 2026: vergiyi muhasebeci yürütüyor; "veriler silinmesin"). Menüde
// (kenar çubuğu, sekmeler, komut paleti, alt menü, başlıklar) Vergi yok; eski adresler (/panel/vergi ve alt sayfaları)
// 404 yerine Genel bakış'a kısa notla yönlenir, muhasebeci notu Muhasebe'de görür; ekranlar ve vergi modülü silindi;
// tablolar ve sütunlar şemada kalır (DROP yok). Bordro ve stopaj src/lib/bordro'da (tests/bordro.test.ts).
// Çalıştırma: npx tsx --test tests/vergi-kaldirildi.test.ts

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { BOTTOM_NAV, bottomNavFor, mobileTitleFor, NAV_FOOTER, NAV_GROUPS, NAV_TREE, navTreeFor, SECTION_TABS } from "../src/components/panel/nav";
import { ROLES as ROLE_NAMES, type Role } from "../src/lib/constants";
import {
  ACCOUNTANT_PATHS,
  ACCOUNTANT_ROLE_HINT,
  canOpen,
  homeFor,
  REMOVED_NOTICES,
  REMOVED_PARAM,
  removedNotice,
  retiredRedirect,
  ROLE_PERMISSIONS,
} from "../src/lib/roles";
import * as schema from "../src/server/db/schema";

const ROLES = Object.keys(ROLE_NAMES) as Role[];
const root = process.cwd();
const read = (f: string) => readFileSync(join(root, f), "utf8");
const walk = (dir: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(tsx?|mjs|js)$/.test(e.name) ? [`${dir}/${e.name}`] : []));
/** Yorumları atar: kaldırılış notları kalabilir, kod ve metin kalamaz */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("eski adresler: /panel/vergi ve alt sayfaları Genel bakış'a notla; yol parçası sınırında", () => {
  for (const p of ["/panel/vergi", "/panel/vergi/", "/panel/vergi/gelir-gider", "/panel/vergi/demirbas", "/panel/vergi/kurallar", "/panel/vergi/kurallar/eski"]) {
    assert.equal(retiredRedirect(p), "/panel?kaldirildi=vergi", p);
  }
  for (const p of ["/panel/vergiler", "/panel", "/panel/gelir-gider", "/vergi"]) assert.equal(retiredRedirect(p), null, p);
  assert.equal(REMOVED_PARAM, "kaldirildi");
  // Yönetici Genel bakış'ta görür; muhasebeci Genel bakış'ı açamaz: proxy notu ana ekranına (Muhasebe) taşır
  assert.equal(canOpen("admin", "/panel"), true);
  assert.equal(canOpen("accountant", "/panel"), false);
  assert.equal(homeFor("accountant"), "/panel/muhasebe");
  const proxy = read("src/proxy.ts");
  const body = proxy.slice(proxy.indexOf("export async function proxy"));
  assert.ok(body.indexOf("retiredRedirect(pathname)") < body.indexOf("verifySession("), "oturum okunmadan önce");
  assert.match(body, /if \(retired\) return NextResponse\.redirect\(new URL\(retired, request\.url\)\);/);
  assert.match(body, /const removed = request\.nextUrl\.searchParams\.get\(REMOVED_PARAM\);\s*if \(removed\) home\.searchParams\.set\(REMOVED_PARAM, removed\);\s*return NextResponse\.redirect\(home\);/);
  assert.doesNotMatch(proxy, /\b308\b|permanent/);
});

test("not: Genel bakış ve Muhasebe kısa notu çizer; bilinmeyen değerde not yok", () => {
  const note = removedNotice("vergi")!;
  assert.equal(note.title, "Vergi bölümü kaldırıldı");
  assert.match(note.text, /muhasebeciniz yürütüyor/);
  assert.match(note.text, /Kayıtlı veriler silinmedi/);
  assert.deepEqual(removedNotice(["vergi", "x"]), note);
  for (const v of [undefined, null, "", "yok", "toString", "__proto__"]) assert.equal(removedNotice(v), null, String(v));
  assert.deepEqual(Object.keys(REMOVED_NOTICES), ["vergi"]);
  const dash = read("src/app/panel/page.tsx");
  assert.match(dash, /const removed = removedNotice\(sp\.kaldirildi\);/);
  assert.match(dash, /\{removed \? <Notice tone="neutral" size="sm" live="polite" title=\{removed\.title\} text=\{removed\.text\} \/> : null\}/);
  const muhasebe = read("src/app/panel/muhasebe/page.tsx");
  assert.match(muhasebe, /const removed = removedNotice\(\(await searchParams\)\.kaldirildi\);/);
  assert.match(muhasebe, /\{removed \? <Notice tone="neutral" size="sm" live="polite" className="mb-4" title=\{removed\.title\} text=\{removed\.text\} \/> : null\}/);
});

test("menü: kenar çubuğu, sekmeler, komut paleti, alt menü ve başlıklar Vergi'yi göstermez (her rolde)", () => {
  const hrefs = [
    ...NAV_TREE.flatMap((n) => [n.href, ...(n.children ?? []).map((c) => c.href)]),
    ...NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)),
    ...NAV_FOOTER.map((i) => i.href),
    ...Object.values(SECTION_TABS).flatMap((tabs) => tabs.map((t) => t.href)),
    ...ROLES.flatMap((r) => BOTTOM_NAV[r].map((i) => i.href)),
  ].filter((h): h is string => Boolean(h));
  for (const h of hrefs) {
    assert.doesNotMatch(h, /^\/panel\/vergi/, h);
    assert.equal(retiredRedirect(h.split(/[?#]/)[0]), null, h);
  }
  for (const role of ROLES) {
    const tree = navTreeFor(role);
    assert.ok(!tree.some((n) => n.id === "vergi" || /vergi/i.test(n.label)), `${role}: ağaçta Vergi grubu`);
    assert.ok(!bottomNavFor(role, { assistant: true }).some((i) => i.id === "vergi"), `${role}: alt menüde Vergi`);
  }
  assert.ok(!("vergi" in SECTION_TABS));
  assert.ok(!NAV_GROUPS.some((g) => /vergi/i.test(g.title)));
  assert.equal(mobileTitleFor("/panel/vergi"), "L'Affogato");
  assert.equal(mobileTitleFor("/panel/vergi/kurallar"), "L'Affogato");
  // Muhasebecinin alt menüsü beş hücre: Vergi'nin yerinde Aylık harcamalar (rolün açabildiği ekran)
  assert.deepEqual(
    BOTTOM_NAV.accountant.map((i) => i.href),
    ["/panel/muhasebe", "/panel/faturalar", "/panel/gelir-gider", "/panel/harcamalar", "/panel/kasa"],
  );
  for (const i of BOTTOM_NAV.accountant) assert.ok(canOpen("accountant", i.href!), i.href);
});

test("roller: muhasebecinin ekranlarında Vergi yok; yetki tablosu ve rol açıklaması vergiyi anmaz", () => {
  assert.ok(!(ACCOUNTANT_PATHS as readonly string[]).includes("/panel/vergi"));
  for (const role of ROLES) if (role !== "admin") assert.equal(canOpen(role, "/panel/vergi"), false, role);
  assert.doesNotMatch(ACCOUNTANT_ROLE_HINT, /vergi/i);
  assert.ok(!ROLE_PERMISSIONS.some((p) => /^Vergi, KDV, SGK/.test(p.label)));
  const muhasebe = read("src/app/panel/muhasebe/page.tsx");
  assert.doesNotMatch(code(muhasebe), /\/panel\/vergi|Landmark/);
  assert.doesNotMatch(read("docs/ROLLER.md"), /\*\*Vergi\*\* \(alt sayfaları/);
});

test("ekranlar ve vergi modülü silindi; kodda Vergi'ye bağlantı, eylem ya da modül kalmadı", () => {
  for (const p of [
    "src/app/panel/vergi",
    "src/lib/tax",
    "src/lib/vat-paid.ts",
    "src/server/actions/tax.ts",
    "src/server/data/tax.ts",
    "src/server/data/vat-paid.ts",
    "src/app/panel/hatirlaticilar/nakit/vat-card.tsx",
    "src/app/panel/hatirlaticilar/nakit/vat-carry-dialog.tsx",
    "src/app/panel/gelir-gider/sgk-rate-notice.tsx",
    "src/components/panel/company-wide-notice.tsx",
  ]) {
    assert.equal(existsSync(join(root, p)), false, `${p} hâlâ var`);
  }
  const bad: string[] = [];
  for (const f of [...walk("src"), ...walk("scripts")]) {
    if (f === "src/lib/roles.ts" || f === "src/lib/assistant/knowledge-data.ts") continue;
    const src = code(read(f));
    for (const re of [
      /\/panel\/vergi\b/,
      /lib\/tax\/|server\/(data|actions)\/tax\b|vat-paid/,
      /\b(saveTaxSettings|saveTaxOverride|saveTaxCheck|saveTaxClassifications|saveTaxFiling|deleteTaxFiling|saveTaxAdjustment|deleteTaxAdjustment|saveTaxAsset|deleteTaxAsset|setEmployerSgkRate|saveVatCarry|forgetVatPayment)\b/,
      /\b(buildTaxView|loadTaxView|loadTaxInputs|loadTaxPlanFeed|vatEstimates|vatMonthInputs)\b/,
    ]) {
      if (re.test(src)) bad.push(`${f}: ${re.source}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("veriler silinmedi: vergi tabloları ve sütunları şemada (drizzle-kit DROP üretmez); DROP'lu migration yok", () => {
  assert.ok(schema.taxAssets && schema.taxFilings && schema.taxAdjustments, "tablolar şemada");
  assert.ok("taxNotAsset" in schema.invoices);
  assert.ok("taxDoc" in schema.fixedExpenses && "taxWithholding" in schema.fixedExpenses);
  assert.ok("taxDoc" in schema.expenseCategories);
  for (const f of readdirSync(join(root, "drizzle")).filter((x) => x.endsWith(".sql"))) {
    const sql = read(`drizzle/${f}`);
    assert.doesNotMatch(sql, /DROP TABLE[^;]*"tax_(assets|filings|adjustments)"/i, f);
    assert.doesNotMatch(sql, /DROP COLUMN[^;]*"(tax_not_asset|tax_doc|tax_withholding)"/i, f);
  }
  // Saklı ayarlar (integration_state) yerinde: bordro eski Vergi ayarını okur, yazan yok
  assert.match(read("src/lib/bordro/settings.ts"), /export const PAYROLL_SETTINGS_KEY = "tax\.settings";/);
  assert.doesNotMatch(code(read("src/server/actions/cash-plan.ts")), /vatCarry: /);
});
