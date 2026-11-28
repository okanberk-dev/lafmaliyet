// Mutabakat bölümü kaldırıldı (sahibin isteği 28 Kasım 2026: "ladmin'deki Mutabakat kısmını kaldır"). Menüde (kenar
// çubuğu, sekmeler, komut paleti, alt menü, başlıklar), yetki tablosunda ve şube görünümünün alanlarında Mutabakat yok;
// eski adresler (/panel/mutabakat, alt adresleri, ?sekme=pos gibi sorgulular) 404 yerine Kâr & ödemeler'in ana ekranı
// Gelir-gider'e kısa notla yönlenir; ekran, eylemler, okuma yolu ve src/lib/mutabakat silindi. Tablolar ve ayar şemada
// kalır (göç yok, yedek taşır); KVKK saklama süresi (günlük işin ekstre silmesi) eskisi gibi işler. Nakit planı, Ödemeler
// ve Gelir-gider'in rakam testleri değişmedi (Mutabakat onlara hiçbir şey vermiyordu).
// Çalıştırma: npx tsx --test tests/mutabakat-kaldirildi.test.ts

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { NextRequest } from "next/server";

import { BOTTOM_NAV, bottomNavFor, mobileTitleFor, NAV_FOOTER, NAV_GROUPS, NAV_TREE, navTreeFor, SECTION_TABS } from "../src/components/panel/nav";
import { TABLE_RULES } from "../src/lib/backup/format";
import { ALWAYS_COMPANY_WIDE, COMPANY_WIDE_READS, parseBranchView, VIEW_AREA_KEYS, VIEW_AREAS } from "../src/lib/branch-view";
import { ROLE_ORDER, type Role } from "../src/lib/constants";
import { canOpen, REMOVED_PARAM, removedNotice, retiredRedirect, ROLE_PERMISSIONS } from "../src/lib/roles";
import { proxy } from "../src/proxy";
import { SESSION_COOKIE, signSession } from "../src/server/auth/session";
import * as schema from "../src/server/db/schema";

const root = process.cwd();
const read = (f: string) => readFileSync(join(root, f), "utf8");
const walk = (dir: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(tsx?|mjs|js)$/.test(e.name) ? [`${dir}/${e.name}`] : []));
/** Yorumları atar: kaldırılış notları kalabilir, kod ve metin kalamaz */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const TARGET = "/panel/gelir-gider?kaldirildi=mutabakat";
const HOST = "http://localhost:3000";

test("eski adresler: /panel/mutabakat ve alt adresleri Gelir-gider'e notla; yol parçası sınırında", () => {
  for (const p of ["/panel/mutabakat", "/panel/mutabakat/", "/panel/mutabakat/pos", "/panel/mutabakat/12/satir"]) assert.equal(retiredRedirect(p), TARGET, p);
  for (const p of ["/panel/mutabakatlar", "/panel", "/panel/gelir-gider", "/panel/hatirlaticilar/nakit", "/mutabakat"]) assert.equal(retiredRedirect(p), null, p);
  assert.equal(REMOVED_PARAM, "kaldirildi");
  // Kâr & ödemeler'in ana ekranı: grubun ilk ekranı Gelir-gider (yönetici ve muhasebeci açar)
  const finans = NAV_TREE.find((n) => n.id === "finans");
  assert.equal(finans?.children?.[0].href, "/panel/gelir-gider");
  for (const r of ["admin", "accountant"] as const) assert.equal(canOpen(r, "/panel/gelir-gider"), true, r);
});

test("proxy: oturumdan önce, her rolde ve oturumsuz; sorgulu eski adres de (eski sorgu düşer)", async () => {
  const req = async (role: Role | null, path: string) => {
    const cookie = role ? `${SESSION_COOKIE}=${await signSession({ sub: "11", name: "Deneme", role, sv: 1 })}` : "";
    return proxy(new NextRequest(`${HOST}${path}`, { headers: cookie ? { cookie } : {} }));
  };
  const where = (res: Response) => res.headers.get("location");
  for (const p of ["/panel/mutabakat", "/panel/mutabakat?sekme=pos", "/panel/mutabakat?durum=eslesmedi&ekstre=3", "/panel/mutabakat/x?sekme=pos#hesap"]) {
    for (const r of [...ROLE_ORDER, null]) assert.equal(where(await req(r, p)), `${HOST}${TARGET}`, `${r ?? "oturumsuz"} ${p}`);
  }
  // Gelir-gider'i açan rol notu orada görür; açamayan rolde not ana ekranına taşınır (Vergi'nin kalıbı)
  assert.equal(where(await req("admin", TARGET)), null);
  assert.equal(where(await req("accountant", TARGET)), null);
  assert.equal(where(await req("manager", TARGET)), `${HOST}/panel/bugun?kaldirildi=mutabakat`);
  assert.equal(where(await req("staff", TARGET)), `${HOST}/panel/bugun?kaldirildi=mutabakat`);
  // Oturumsuz: giriş, dönüş adresi notuyla
  const login = new URL(where(await req(null, TARGET))!);
  assert.equal(login.pathname, "/giris");
  assert.equal(login.searchParams.get("next"), TARGET);
});

test("not: Gelir-gider kısa notu çizer; metin sade, uzun tire yok; bilinmeyen değerde not yok", () => {
  const note = removedNotice("mutabakat")!;
  assert.equal(note.title, "Mutabakat bölümü kaldırıldı");
  assert.match(note.text, /Yüklenen ekstreler silinmedi/);
  assert.match(note.text, /Gelir-gider, Ödemeler ve Nakit planı aynı\.$/);
  assert.doesNotMatch(`${note.title} ${note.text}`, /[–—]/);
  assert.deepEqual(removedNotice(["mutabakat", "vergi"]), note);
  assert.equal(removedNotice("Mutabakat"), null);
  const page = read("src/app/panel/gelir-gider/page.tsx");
  assert.match(page, /const removed = removedNotice\(sp\.kaldirildi\);/);
  assert.match(page, /\{removed \? <Notice tone="neutral" size="sm" live="polite" className="mb-4" title=\{removed\.title\} text=\{removed\.text\} \/> : null\}/);
  // Genel bakış ve Muhasebe aynı yardımcıyla okur: rol ana ekranına taşınan not orada da çıkar
  assert.match(read("src/app/panel/page.tsx"), /removedNotice\(sp\.kaldirildi\)/);
});

test("menü: kenar çubuğu, sekmeler, komut paleti, alt menü ve başlıklar Mutabakat'ı göstermez (her rolde)", () => {
  const items = [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_FOOTER];
  const hrefs = [
    ...NAV_TREE.flatMap((n) => [n.href, ...(n.children ?? []).map((c) => c.href)]),
    ...items.map((i) => i.href),
    ...Object.values(SECTION_TABS).flatMap((tabs) => tabs.map((t) => t.href)),
    ...ROLE_ORDER.flatMap((r) => BOTTOM_NAV[r].map((i) => i.href)),
  ].filter((h): h is string => Boolean(h));
  for (const h of hrefs) {
    assert.doesNotMatch(h, /^\/panel\/mutabakat/, h);
    assert.equal(retiredRedirect(h.split(/[?#]/)[0]), null, h);
  }
  // ⌘K: ne etiket ne anahtar sözcük (banka ekstresi, POS hakediş, valör, bloke) Mutabakat'ı bulur
  for (const i of items) assert.doesNotMatch(`${i.label} ${i.keywords ?? ""}`, /mutabakat|banka ekstresi|pos hakediş|valör|bloke/i, i.href);
  for (const role of ROLE_ORDER) {
    assert.ok(!navTreeFor(role).some((n) => n.id === "mutabakat" || (n.children ?? []).some((c) => c.id === "mutabakat" || /mutabakat/i.test(c.label))), role);
    assert.ok(!bottomNavFor(role, { assistant: true }).some((i) => i.id === "mutabakat"), role);
  }
  assert.deepEqual(
    NAV_TREE.find((n) => n.id === "finans")?.children?.map((c) => c.href),
    ["/panel/gelir-gider", "/panel/hatirlaticilar", "/panel/hatirlaticilar/nakit"],
  );
  assert.deepEqual(
    SECTION_TABS.odeme.map((t) => t.href),
    ["/panel/hatirlaticilar", "/panel/hatirlaticilar/nakit"],
  );
  assert.equal(mobileTitleFor("/panel/mutabakat"), "L'Affogato");
});

test("yetki ve şube görünümü: tabloda satır yok; alanı yok, eski tercih okunmaz; her zaman firma geneli listesinde ekstre yok", () => {
  assert.ok(!ROLE_PERMISSIONS.some((p) => /mutabakat|ekstre|POS hakediş/i.test(p.label)));
  assert.ok(!ROLE_PERMISSIONS.some((p) => (p.paths ?? []).some((x) => x.startsWith("/panel/mutabakat"))));
  for (const role of ROLE_ORDER) if (role !== "admin") assert.equal(canOpen(role, "/panel/mutabakat"), false, role);
  assert.equal((VIEW_AREA_KEYS as readonly string[]).includes("mutabakat"), false);
  for (const a of VIEW_AREA_KEYS) for (const p of VIEW_AREAS[a].screens) assert.doesNotMatch(p, /^\/panel\/mutabakat/, `${a}: ${p}`);
  assert.deepEqual(parseBranchView({ mutabakat: "firma", nakit: "firma" }), { nakit: "firma" });
  assert.ok(!COMPANY_WIDE_READS.some((r) => /mutabakat/.test(`${r.id} ${r.where}`)));
  assert.ok(!ALWAYS_COMPANY_WIDE.some((r) => /ekstre/i.test(r.title)));
});

test("ekran ve modül silindi; kaynakta Mutabakat'a bağlantı, eylem ya da modül kalmadı", () => {
  for (const p of ["src/app/panel/mutabakat", "src/lib/mutabakat", "src/server/actions/mutabakat.ts", "src/server/mutabakat/load.ts", "src/server/mutabakat/file.ts", "tests/mutabakat.test.ts", "tests/mutabakat-db.test.ts"]) {
    assert.equal(existsSync(join(root, p)), false, `${p} hâlâ var`);
  }
  const bad: string[] = [];
  for (const f of [...walk("src"), ...walk("scripts")]) {
    // Yönlendirmenin kendisi (RETIRED_PATHS) ve üretilen bilgi tabanı ayrıca denetlenir
    if (f === "src/lib/roles.ts" || f === "src/lib/assistant/knowledge-data.ts") continue;
    const src = code(read(f));
    for (const re of [
      /\/panel\/mutabakat\b/,
      /lib\/mutabakat\b|server\/actions\/mutabakat\b|server\/mutabakat\/(load|file)\b/,
      /\b(loadRecon|loadPosView|loadSupplierOptions|loadLinePool|previewStatement|saveStatement|deleteStatement|decideLine|manualOptions|savePosBlockDays|insertStatement|writeDecision|readPosBlockDays|posReconciliation|matchLines|parseStatement)\b/,
      /areaScope\("mutabakat"\)|area="mutabakat"/,
    ]) {
      if (re.test(src)) bad.push(`${f}: ${re.source}`);
    }
  }
  assert.deepEqual(bad, []);
  // RETIRED_PATHS'ten başka yerde adres yok
  assert.equal(read("src/lib/roles.ts").match(/\/panel\/mutabakat/g)?.length, 1);
  // Yardım'ın Mutabakat sorusu ve asistanın bilgi tabanındaki ekranı kalktı
  assert.doesNotMatch(read("src/app/panel/yardim/page.tsx"), /id: "mutabakat"|\/panel\/mutabakat/);
  assert.doesNotMatch(read("src/lib/assistant/knowledge-data.ts"), /\/panel\/mutabakat/);
});

test("veriler silinmedi: tablolar ve ayar şemada, DROP'lu göç yok, yedek taşır; KVKK saklama süresi günlük işte", () => {
  assert.ok(schema.reconStatements && schema.reconLines, "tablolar şemada");
  for (const f of readdirSync(join(root, "drizzle")).filter((x) => x.endsWith(".sql"))) {
    assert.doesNotMatch(read(`drizzle/${f}`), /DROP TABLE[^;]*"recon_(statements|lines)"/i, f);
  }
  // Tam yedek bütün tabloları information_schema'dan bulur: ekstreler dosyaya girer ve geri yüklenir
  for (const t of ["recon_statements", "recon_lines", "settings"]) assert.ok(!TABLE_RULES[t]?.skip, t);
  // Saklama süresi (docs/arsiv/MUTABAKAT.md › KVKK ve saklama): yalnız silme kaldı, yazma yolu yok
  const store = read("src/server/mutabakat/store.ts");
  assert.match(store, /export async function purgeExpiredStatements\(db: DB, today: string\): Promise<number>/);
  assert.deepEqual([...store.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]), ["purgeExpiredStatements"]);
  const cron = read("src/app/api/cron/gunluk/route.ts");
  assert.match(cron, /import \{ purgeExpiredStatements \} from "@\/server\/mutabakat\/store";/);
  assert.match(cron, /purgeExpiredStatements\(getDb\(\), todayTR\(\)\)/);
});

test("belgeler: MUTABAKAT.md arşivde, başında not; öteki belgeler ekrana göndermiyor", () => {
  assert.equal(existsSync(join(root, "docs/MUTABAKAT.md")), false);
  const doc = read("docs/arsiv/MUTABAKAT.md");
  assert.match(doc, /^# Mutabakat \(banka ve tedarikçi ekstresi, POS hakedişi\)\n\n> \*\*Arşiv: Mutabakat bölümü 28 Kasım 2026'da kaldırıldı/);
  const live = readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md"));
  for (const f of [...live.map((x) => `docs/${x}`), "README.md"]) {
    assert.doesNotMatch(read(f), /\]\(MUTABAKAT\.md|\]\(docs\/MUTABAKAT\.md|`docs\/MUTABAKAT\.md`/, f);
  }
});
