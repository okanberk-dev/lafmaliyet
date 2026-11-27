// Şube görünümü (şube ayrımı D, 27 Kasım 2026; docs/SUBE.md › Şube ayrımı): kişinin ekran ekran "Yalnız şube | Firma
// geneli" tercihi. Saf kurallar (src/lib/branch-view.ts), Hesabım'daki kart, ekranın çipi, eylem ve migration'ı.
// Veritabanında yazma ve okuma: tests/sube-gorunumu-db.test.ts.
// Çalıştırma: npx tsx --test tests/sube-gorunumu.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  ALWAYS_COMPANY_WIDE,
  BRANCH_VIEW_DESCRIPTION,
  BRANCH_VIEW_HREF,
  BRANCH_VIEW_LOCKED,
  BRANCH_VIEW_TITLE,
  branchViewCardState,
  bulkViewPatch,
  defaultView,
  effectiveView,
  lockedViewLine,
  parseBranchView,
  showViewChip,
  VIEW_AREA_KEYS,
  VIEW_AREAS,
  viewAreasFor,
  viewChipText,
  viewScope,
} from "../src/lib/branch-view";
import { ALL_BRANCHES } from "../src/lib/branches";
import { accusativeTR } from "../src/lib/format";
import { canOpen } from "../src/lib/roles";
import { readJournal } from "../scripts/migration-check";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

test("Türkçe belirtme hâli: şube adlarının eki (çipin “Yalnız Marina'yı göster” düğmesi)", () => {
  assert.deepEqual(
    ["Marina", "Tuzla", "Kadıköy", "Moda Sahil", "laffogato.net", "Bostancı", "Göztepe", "Ataşehir", "Kuzguncuk", "Üsküdar", "Fenerbahçe"].map(accusativeTR),
    ["Marina'yı", "Tuzla'yı", "Kadıköy'ü", "Moda Sahil'i", "laffogato.net'i", "Bostancı'yı", "Göztepe'yi", "Ataşehir'i", "Kuzguncuk'u", "Üsküdar'ı", "Fenerbahçe'yi"],
  );
});

test("alanlar: dokuz alan (Vergi'nin alanı yok: vergi şubeye bölünmez), sırası ve iki alanın kendi seçenek adları", () => {
  assert.deepEqual([...VIEW_AREA_KEYS], ["odemeler", "nakit", "tutarlilik", "mutabakat", "tedarikciler", "stok_degeri", "komisyon", "karsilastirma", "ortak_gider"]);
  assert.deepEqual(
    VIEW_AREA_KEYS.map((a) => VIEW_AREAS[a].label),
    ["Ödemeler ve faturalar", "Nakit planı", "Tutarlılık", "Mutabakat", "Tedarikçi bakiyeleri", "Stok değeri (FIFO)", "Komisyon ve hakediş", "Şubeleri yan yana", "İşletme geneli giderler"],
  );
  // Sahibin kararı (27 Kasım 2026): Vergi şubeye bölünmez; hiçbir alanın ekranı Vergi değil
  assert.equal((VIEW_AREA_KEYS as readonly string[]).includes("vergi"), false);
  for (const a of VIEW_AREA_KEYS) for (const p of VIEW_AREAS[a].screens) assert.doesNotMatch(p, /^\/panel\/vergi/, `${a}: ${p}`);
  assert.deepEqual(VIEW_AREAS.nakit.modes, { sube: "Yalnız şube", firma: "Firma geneli" });
  assert.match(VIEW_AREAS.nakit.help, /Vergi ve SGK ödemeleri firma geneli: Tümü'de görünür\./);
  assert.match(VIEW_AREAS.nakit.firmOnly ?? "", /vergi ve SGK ödemeleri/);
  assert.deepEqual(VIEW_AREAS.karsilastirma.modes, { sube: "Yalnız seçili şube", firma: "Yan yana" });
  assert.deepEqual(VIEW_AREAS.ortak_gider.modes, { sube: "Yalnız not", firma: "Tutarla göster" });
  // Her alanın ekranı gerçekten var (çip ve kartın satırı oraya bağlı)
  for (const a of VIEW_AREA_KEYS) {
    assert.ok(VIEW_AREAS[a].screens.length, a);
    for (const p of VIEW_AREAS[a].screens) assert.doesNotThrow(() => read(`src/app${p}/page.tsx`), `${a}: ${p} sayfası yok`);
  }
});

test("varsayılanlar: yönetici her alanda yalnız şube; muhasebeci tasarımdaki gibi", () => {
  for (const a of VIEW_AREA_KEYS) assert.equal(defaultView(a, "admin"), "sube", a);
  assert.deepEqual(Object.fromEntries(VIEW_AREA_KEYS.map((a) => [a, defaultView(a, "accountant")])), {
    odemeler: "sube",
    nakit: "firma",
    tutarlilik: "firma",
    mutabakat: "firma",
    tedarikciler: "firma",
    stok_degeri: "firma",
    komisyon: "sube",
    karsilastirma: "sube",
    ortak_gider: "firma",
  });
});

test("geçerli kip: kilitli hesap hep şube; tercih varsayılanı ezer; şubesiz personelin tercihi okunmaz", () => {
  const firma = Object.fromEntries(VIEW_AREA_KEYS.map((a) => [a, "firma"]));
  for (const a of VIEW_AREA_KEYS) {
    // Müdür ve şubesi seçilmiş personel: tercih ne olursa olsun yalnız şubesi
    assert.equal(effectiveView(a, "manager", true, firma), "sube", `müdür ${a}`);
    assert.equal(effectiveView(a, "staff", true, firma), "sube", `kilitli personel ${a}`);
    assert.equal(effectiveView(a, "admin", true, firma), "sube", `kilitli ${a}`);
    // Yönetici ve muhasebeci tercihini görür
    assert.equal(effectiveView(a, "admin", false, firma), "firma", a);
    assert.equal(effectiveView(a, "accountant", false, { [a]: "sube" }), "sube", a);
    // Şubesiz personel bütün şubeleri görmez: tercih yazamaz, yazılmış olsa da okunmaz
    assert.equal(effectiveView(a, "staff", false, firma), "sube", `şubesiz personel ${a}`);
  }
  assert.equal(effectiveView("ortak_gider", "admin", false, {}), "sube");
  assert.equal(effectiveView("ortak_gider", "accountant", false, {}), "firma");
  assert.equal(effectiveView("ortak_gider", "accountant", false, { nakit: "sube" }), "firma", "başka alanın tercihi bu alanı değiştirmez");
});

test("okuma kapsamı: firma kipinde Tümü, şube kipinde seçim", () => {
  assert.equal(viewScope("marina", "firma"), ALL_BRANCHES);
  assert.equal(viewScope("marina", "sube"), "marina");
  assert.equal(viewScope(ALL_BRANCHES, "sube"), ALL_BRANCHES);
});

test("tercihin okunması: bilinmeyen anahtar ve değer düşer, nesne olmayan boş", () => {
  assert.deepEqual(parseBranchView({ nakit: "firma", ortak_gider: "sube" }), { nakit: "firma", ortak_gider: "sube" });
  // Eski sürümün yazdığı Vergi tercihi (alanı kalktı, 27 Kasım 2026) sessizce düşer
  assert.deepEqual(parseBranchView({ vergi: "firma", ortak_gider: "sube" }), { ortak_gider: "sube" });
  assert.deepEqual(parseBranchView({ vergi: "sube" }), {});
  assert.deepEqual(parseBranchView({ vergi: "FIRMA", nakit: 1, x: "firma", komisyon: null, ortak_gider: "bilgi" }), {});
  for (const bad of [null, undefined, "firma", 3, [], ["vergi"], true]) assert.deepEqual(parseBranchView(bad), {}, String(bad));
  // Kalıtılan anahtar sayılmaz
  assert.deepEqual(parseBranchView(Object.create({ vergi: "firma" })), {});
  assert.deepEqual(parseBranchView(JSON.parse('{"__proto__":{"vergi":"firma"},"nakit":"firma"}')), { nakit: "firma" });
});

test("kartın satırları: yönetici dokuz alan, muhasebeci açabildiği ekranların alanları (işletme geneli giderler; Vergi hep firma geneli)", () => {
  assert.deepEqual(viewAreasFor("admin"), [...VIEW_AREA_KEYS]);
  assert.deepEqual(viewAreasFor("accountant"), ["ortak_gider"]);
  for (const a of viewAreasFor("accountant")) assert.ok(VIEW_AREAS[a].screens.some((p) => canOpen("accountant", p)), a);
  assert.deepEqual(viewAreasFor("manager"), [], "müdür kilitli");
  assert.deepEqual(viewAreasFor("staff"), [], "personelin para ekranı yok");
});

test("kartın hâli: tek şubede yok, kilitli hesapta tek satır, şubesiz personelde yok", () => {
  assert.equal(branchViewCardState({ role: "admin", locked: false, activeBranches: 1 }), "yok", "seçici de çizilmez");
  assert.equal(branchViewCardState({ role: "admin", locked: false, activeBranches: 3 }), "kart");
  assert.equal(branchViewCardState({ role: "accountant", locked: false, activeBranches: 2 }), "kart");
  assert.equal(branchViewCardState({ role: "manager", locked: true, activeBranches: 2 }), "kilitli");
  assert.equal(branchViewCardState({ role: "staff", locked: true, activeBranches: 2 }), "kilitli");
  assert.equal(branchViewCardState({ role: "staff", locked: false, activeBranches: 2 }), "yok");
  assert.equal(branchViewCardState({ role: "manager", locked: true, activeBranches: 1 }), "yok");
  assert.equal(lockedViewLine("Marina"), "Hesabınız Marina şubesine bağlı: her ekran yalnız Marina'yı gösterir.");
  assert.equal(lockedViewLine("Kadıköy"), "Hesabınız Kadıköy şubesine bağlı: her ekran yalnız Kadıköy'ü gösterir.");
});

test("çip: yalnız tek şube seçiliyken, birden çok şube açıkken, bütün şubeleri gören ve kilitsiz hesapta", () => {
  const base = { scope: "marina", activeBranches: 3, role: "admin" as const, locked: false };
  assert.equal(showViewChip(base), true);
  assert.equal(showViewChip({ ...base, role: "accountant" }), true);
  assert.equal(showViewChip({ ...base, scope: ALL_BRANCHES }), false, "Tümü");
  assert.equal(showViewChip({ ...base, activeBranches: 1 }), false, "tek şube");
  assert.equal(showViewChip({ ...base, role: "manager", locked: true }), false, "müdür");
  assert.equal(showViewChip({ ...base, role: "staff" }), false, "şubesiz personel");
  assert.equal(showViewChip({ ...base, locked: true }), false, "kilitli");
});

test("çipin metni: şube kipinde firmanın kalanı, firma kipinde geri dönüş; iki alanın kendi dili", () => {
  assert.deepEqual(viewChipText("nakit", "sube", "Marina"), {
    title: "Marina görünümü",
    switchLabel: "Firma geneline geç",
    switchTo: "firma",
    firmOnly: "Açılış bakiyesi, vergi ve SGK ödemeleri her görünümde firmanın",
  });
  assert.deepEqual(viewChipText("nakit", "firma", "Marina"), { title: "Firma geneli · Marina seçili", switchLabel: "Yalnız Marina'yı göster", switchTo: "sube", firmOnly: null });
  assert.equal(viewChipText("tedarikciler", "firma", "Kadıköy").switchLabel, "Yalnız Kadıköy'ü göster");
  assert.equal(viewChipText("tedarikciler", "sube", "Marina").firmOnly, null);
  assert.deepEqual(viewChipText("karsilastirma", "sube", "Tuzla"), { title: "Tuzla görünümü", switchLabel: "Şubeleri yan yana göster", switchTo: "firma", firmOnly: null });
  assert.equal(viewChipText("karsilastirma", "firma", "Tuzla").switchLabel, "Yalnız Tuzla'yı göster");
  assert.equal(viewChipText("ortak_gider", "sube", "Marina").switchLabel, "Tutarla göster");
  assert.equal(viewChipText("ortak_gider", "firma", "Marina").switchLabel, "Yalnız not");
  // Bildirim başlığının kuralı: sonda nokta yok, kısa (docs/TASARIM.md)
  for (const a of VIEW_AREA_KEYS) {
    for (const m of ["sube", "firma"] as const) {
      const t = viewChipText(a, m, "Marina");
      assert.doesNotMatch(t.title, /\.$/, `${a}/${m}`);
      assert.ok(t.title.split(/\s+/).length <= 10, `${a}/${m}: ${t.title}`);
      assert.notEqual(t.switchTo, m);
    }
  }
});

test("toplu düğmeler: rolün kartındaki alanlar; Varsayılanlara dön tercihi boşaltır", () => {
  assert.deepEqual(bulkViewPatch("firma", "accountant"), { ortak_gider: "firma" });
  assert.deepEqual(Object.keys(bulkViewPatch("sube", "admin") ?? {}), [...VIEW_AREA_KEYS]);
  assert.equal(bulkViewPatch("varsayilan", "admin"), null);
  assert.deepEqual(bulkViewPatch("firma", "manager"), {});
});

test("Hesabım: kartın başlığı, açıklaması, çapası ve hep firma geneli listesi", () => {
  assert.equal(BRANCH_VIEW_TITLE, "Şube görünümü");
  assert.equal(
    BRANCH_VIEW_DESCRIPTION,
    "Soldan bir şube seçtiğinizde bu ekranlar yalnız o şubeyi mi, firmanın tamamını mı göstersin? Tercih yalnız sizin hesabınızda saklanır.",
  );
  assert.equal(BRANCH_VIEW_HREF, "/panel/hesap#sube-gorunumu");
  assert.ok(ALWAYS_COMPANY_WIDE.length >= 10);
  for (const a of ALWAYS_COMPANY_WIDE) assert.ok(a.title && a.reason.endsWith("."), a.title);
  assert.ok(ALWAYS_COMPANY_WIDE.some((a) => a.title === "Tam yedek"));
  // Vergi şubeye bölünmez (sahibin kararı 27 Kasım 2026): listede gerekçesiyle; Vergi bölümü aynı gün kaldırıldı, satır
  // Ödemeler'deki vergi hatırlatıcılarını ve SGK'yı söyler
  const tax = ALWAYS_COMPANY_WIDE.find((a) => a.title.startsWith("Vergi ve SGK"));
  assert.equal(tax?.reason, "Vergi beyanı firmanın tek vergi numarasıyla; şubeye bölünmez (vergiyi muhasebeci yürütür).");
  assert.match(tax?.title ?? "", /Ödemeler'deki vergi hatırlatıcıları ve SGK/);
  assert.doesNotMatch(tax?.title ?? "", /Vergi'nin bütün sekmeleri|Vergi sekmesi/);

  const page = read("src/app/panel/hesap/page.tsx");
  assert.match(page, /<Card id="sube-gorunumu"/);
  assert.match(page, /branchViewCardState\(\{ role: user\.role, locked, activeBranches: branches\.filter\(\(b\) => b\.active\)\.length \}\)/);
  assert.match(page, /const locked = lock !== null \|\| user\.role === "manager";/);
  assert.match(page, /<BranchViewCard rows=\{branchView\.rows\} prefs=\{branchView\.prefs\} always=\{ALWAYS_COMPANY_WIDE\} \/>/);
  const card = read("src/app/panel/hesap/branch-view-card.tsx");
  for (const label of ["Hepsi yalnız şube", "Hepsi firma geneli", "Varsayılanlara dön", "Her zaman firma geneli"]) assert.ok(card.includes(label), label);
  // Hata olursa seçim geri döner
  assert.match(card, /if \(!res\.ok\) \{\s*setSaved\(before\);\s*toast\.error\(res\.error\);/);
});

test("eylem: yalnız kendi satırı, anahtar anahtar birleşir; bütün şubeleri görmeyen hesap reddedilir", () => {
  const src = read("src/server/actions/branch-view.ts");
  assert.match(src, /^"use server";/);
  assert.match(src, /const me = await requireUser\(\);\s*if \(!can\(me\.role, "sube\.tumu"\)\) throw new UserError\(BRANCH_VIEW_LOCKED\);/);
  assert.equal(BRANCH_VIEW_LOCKED, "Hesabınız şubenize bağlı");
  // Her yazım kişinin kendi satırına, mevcut tercihle birleşerek
  const updates = src.match(/\.update\(s\.users\)/g) ?? [];
  const mine = src.match(/\.where\(eq\(s\.users\.id, me\.id\)\)/g) ?? [];
  assert.equal(updates.length, 2);
  assert.equal(mine.length, updates.length, "her güncelleme yalnız kişinin satırı");
  assert.match(src, /\$\{s\.users\.branchView\} \|\| jsonb_build_object\(\$\{data\.area\}::text, \$\{data\.mode\}::text\)/);
  assert.match(src, /if \(!viewAreasFor\(me\.role\)\.includes\(data\.area\)\) throw new UserError/);
  // Oturum sürümü değişmez (tercih oturumu bozmaz)
  assert.doesNotMatch(src, /sessionVersion/);
  assert.match(src, /refresh\(\);/);
});

test("çip: sunucu bileşeni kuralı showViewChip'ten okur, düğme eylemi çağırır", () => {
  const chip = read("src/components/panel/branch-view-chip.tsx");
  assert.match(chip, /showViewChip\(\{ scope, activeBranches, role: user\.role, locked: lock !== null \|\| user\.role === "manager" \}\)/);
  assert.match(chip, /const mode = await currentBranchView\(area\);/);
  const client = read("src/components/panel/branch-view-chip-client.tsx");
  assert.match(client, /saveBranchView\(\{ area, mode: text\.switchTo \}\)/);
  assert.match(client, /Bütün ekranlar için: <NoticeLink href=\{BRANCH_VIEW_HREF\}>Hesabım › Şube görünümü<\/NoticeLink>/);
});

test("migration 0101 (şube görünümü bölümü): kullanıcıya nesne olan tercih sütunu, oturum sürümüne dokunmaz", () => {
  const entry = readJournal().find((e) => e.tag === "0101_sube_ayrimi");
  assert.ok(entry, "0101_sube_ayrimi günlükte yok");
  // Göç iki bölüm: önce şube görünümü (yalnız ekleme), sonra dört tablonun şube sütunu (veri doldurur; ayrı test)
  const all = read("drizzle/0101_sube_ayrimi.sql");
  const cut = all.indexOf("-- Şube ayrımı parça 3");
  assert.ok(cut > 0, "şube sütunları bölümü bulunamadı");
  const sql = all.slice(0, cut);
  assert.match(sql, /ALTER TABLE "users" ADD COLUMN "branch_view" jsonb DEFAULT '\{\}'::jsonb NOT NULL;/);
  assert.match(sql, /ADD CONSTRAINT "users_branch_view_ck" CHECK \(jsonb_typeof\("users"\."branch_view"\) = 'object'\)/);
  assert.doesNotMatch(sql, /session_version|(^|--> statement-breakpoint\n?)\s*(UPDATE|INSERT INTO|DELETE FROM) /m);
  // Oturum değişmedi: tercih oturumla taşınmaz, ayrı ve önbellekli okunur
  const dal = read("src/server/auth/dal.ts");
  assert.doesNotMatch(dal, /branchView|branch_view/);
  assert.match(read("src/server/branch-scope.ts"), /export const userBranchView = cache\(async \(\): Promise<BranchViewPrefs> => \{/);
});
