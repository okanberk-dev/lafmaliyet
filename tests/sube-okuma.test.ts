// Okuma sızıntıları (24 Kasım 2026 şube kapsamı taraması, plan › A2; docs/SUBE.md):
//
// kasa-fatura  Kasadan faturalı alım satırı kasasının şubesini taşır; zil, Bugün, Genel bakış ve Faturalar seçili şubeyle
//              süzer, eşleştirme havuzu işletme geneli kalır (vergi ve e-posta özeti süzmez).
// cari         Cari işletme genelidir, kasa satırı şubenindir: liste süzülmez (`cariHints`), zil sayısı ve ekranlar şubeyi sayar.
// kapali-gun   Birden çok kasa açıkken kanıt şube şube: şubenin listesi ve personeli kırmızı, şubesi belli olmayan iz uyarı.
// karaoke      Karaoke yalnız karaokenin şubesinde: kilitli personel eylemleri, canlı uç, Bugün ve bildirim.
//
// Veritabanıyla: tests/sube-kapali-gun-db.test.ts, tests/kasa-faturali-db.test.ts, tests/cari-eylemler-db.test.ts,
// tests/kapali-gun-db.test.ts, tests/karaoke-sube-db.test.ts, tests/karaoke-bildirim-db.test.ts.
// Çalıştırma: npx tsx --test tests/sube-okuma.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ALL_BRANCHES, DEFAULT_BRANCHES, KARAOKE_BRANCH_ID, tillRowsInScope, type BranchRow } from "../src/lib/branches";
import { branchChecklistRuns, branchStaffWrites, closedEvidenceText, EMPTY_EVIDENCE, hasPanelEvidence, isBranchCountedAction } from "../src/lib/closed-days";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const BRANCHES: BranchRow[] = DEFAULT_BRANCHES.map((b) => ({ ...b, active: true }));

test("kapalı gün: şubenin işlem geçmişi kırmızı, şubesiz personel uyarı, öbür şube yok; kendi tablosunda sayılan işlem ikinci kez sayılmaz", () => {
  assert.equal(isBranchCountedAction("Kasa raporu"), true);
  assert.equal(isBranchCountedAction("Kasa raporu güncellendi"), true);
  assert.equal(isBranchCountedAction("Kasadan çıkan düzeltildi"), true);
  assert.equal(isBranchCountedAction("Zayi kaydı"), true);
  assert.equal(isBranchCountedAction("İkram kaydı"), true);
  // Silme kaydının satırı tabloda yok: işlem geçmişinden sayılır
  assert.equal(isBranchCountedAction("Kasadan çıkan silindi"), false);
  assert.equal(isBranchCountedAction("Zayi kaydı silindi"), false);
  assert.equal(isBranchCountedAction("Sayım kaydı"), false);
  const logs = [
    { action: "Sayım kaydı", userBranchId: "tuzla" },
    { action: "Kasa raporu", userBranchId: "tuzla" },
    { action: "Kasadan çıkan silindi", userBranchId: "tuzla" },
    { action: "Sayım kaydı", userBranchId: null },
    { action: "Kasa raporu", userBranchId: null },
    { action: "Parola değiştirildi", userBranchId: null },
    { action: "Sayım kaydı", userBranchId: "marina" },
  ];
  assert.deepEqual(branchStaffWrites(logs, "tuzla"), { own: 2, shared: 1 });
  assert.deepEqual(branchStaffWrites(logs, "marina"), { own: 1, shared: 1 });
  assert.deepEqual(branchChecklistRuns([{ templateBranchId: "tuzla" }, { templateBranchId: null }, { templateBranchId: null }], "marina"), { own: 0, shared: 2 });
  assert.deepEqual(branchChecklistRuns([{ templateBranchId: "tuzla" }, { templateBranchId: null }], "tuzla"), { own: 1, shared: 1 });
});

test("kapalı gün: şubesi belli olmayan iz uyarıdır, onayı ve personelin bildirimini kapatmaz", () => {
  const e = { ...EMPTY_EVIDENCE, sharedTraces: 3 };
  const lines = closedEvidenceText(e);
  assert.deepEqual(lines.red, []);
  assert.deepEqual(lines.warn, ["Şubesi belli olmayan 3 iz (bütün şubelerin kontrol listesi ya da şubesiz personel)"]);
  assert.equal(hasPanelEvidence(e), false);
  // Şube verilmeyen (eski) kanıtta alan yok: satır çıkmaz
  assert.deepEqual(closedEvidenceText(EMPTY_EVIDENCE).warn, []);
  // Kanıt şube şube yalnız birden çok kasa açıkken; tek kasada liste ve personel o kasanın kanıtı (kaynak)
  const src = read("src/server/closed-days.ts");
  assert.match(src, /const split = branchId \? await manyTills\(db\) : false;/);
  assert.match(src, /const karaokeHere = !split \|\| branchId === KARAOKE_BRANCH_ID;/);
  assert.match(src, /innerJoin\(s\.checklistTemplates, eq\(s\.checklistTemplates\.id, s\.checklistRuns\.templateId\)\)/);
  assert.match(src, /select\(\{ action: s\.activityLog\.action, userBranchId: s\.users\.branchId \}\)/);
});

test("kapalı gün: site sayıları bildirilen şubenin (&branch=); Onaylar kartı ve onay eylemi şubeyi verir", () => {
  assert.match(read("src/server/site-sales/sync.ts"), /export async function fetchSiteDayCounts\(day: string, branchId\?: string \| null\)[\s\S]{0,200}const branch = siteBranchOf\(branchId\);/);
  assert.match(read("src/server/actions/closed-days.ts"), /fetchSiteDayCounts\(row\.day, closedRequestBranch\(row\)\)/);
  assert.match(read("src/app/panel/onaylar/kasa-section.tsx"), /<ClosedDaySite day=\{c\.date\} branchId=\{c\.branchId\} \/>/);
});

test("kasa satırları işletme geneli ekranda: kasanın adı (birden çok kasada) ve kapsam", () => {
  const rows = [
    { id: 1, branchId: "tuzla" },
    { id: 2, branchId: "marina" },
  ];
  assert.deepEqual(tillRowsInScope(rows, "marina", BRANCHES), [
    { id: 1, branchId: "tuzla", tillName: "Tuzla", inScope: false },
    { id: 2, branchId: "marina", tillName: "Marina", inScope: true },
  ]);
  assert.deepEqual(
    tillRowsInScope(rows, ALL_BRANCHES, BRANCHES).map((r) => r.inScope),
    [true, true],
  );
  // Tek kasada ad yazılmaz
  const single = BRANCHES.map((b) => (b.id === "marina" ? { ...b, active: false } : b));
  assert.deepEqual(
    tillRowsInScope(rows, ALL_BRANCHES, single).map((r) => r.tillName),
    [null, null],
  );
});

test("kasadan faturalı alımlar: ekranlar seçili şubeyle süzer, vergi ve e-posta özeti süzmez", () => {
  for (const f of ["src/server/actions/notifications.ts", "src/server/data/today.ts", "src/app/panel/page.tsx", "src/app/panel/faturalar/page.tsx"]) {
    assert.match(read(f), /scopeCashOutInvoiceState\(/, `${f} süzmüyor`);
  }
  for (const f of ["src/server/notify/digest.ts", "src/server/data/tax.ts"]) assert.doesNotMatch(read(f), /scopeCashOutInvoiceState/, `${f} işletme geneli kalmalı`);
  // Yükleyici süzmez: eşleştirme havuzu işletme geneli
  const loader = read("src/server/data/cash-out-invoices.ts");
  const body = loader.slice(loader.indexOf("export async function loadCashOutInvoiceState"));
  assert.doesNotMatch(body, /currentBranchScope|branchWhere/);
  assert.match(body, /branchId: co\.branchId,/);
});

test("cari: zil sayısı şubeyi sayar, liste süzülmez", () => {
  const digest = read("src/server/notify/digest.ts");
  assert.match(digest, /cari: cariSummary\(index, single\)/);
  assert.match(digest, /const kasaLines = single \? index\.kasaPending\.filter\(\(l\) => l\.branchId === single\) : index\.kasaPending;/);
  assert.match(digest, /const hints = cariHints\(index, invoices, debts\);/);
  assert.match(read("src/app/panel/tedarikciler/page.tsx"), /tillRowsInScope\(index\.kasaPending, scope, branches\)/);
  assert.match(read("src/app/panel/tedarikciler/[cari]/page.tsx"), /kasa: tillRowsInScope\(data\.kasa, scope, branches\)/);
});

test("karaoke: kilitli personelin eylemleri, canlı uç, Bugün ve bildirim karaokenin şubesine bağlı", () => {
  assert.equal(KARAOKE_BRANCH_ID, "tuzla");
  const actions = read("src/server/actions/karaoke.ts");
  // requireUser çağıran her uç hemen ardından karaokenin şubesini sorar
  const users = actions.match(/const me = await requireUser\(\);\n\s+await assertKaraokeBranch\(me\);/g) ?? [];
  const all = actions.match(/const me = await requireUser\(\);/g) ?? [];
  assert.equal(users.length, all.length);
  assert.equal(all.length, 9);
  assert.match(actions, /if \(await staffBranchRefusal\(me, KARAOKE_BRANCH_ID\)\) throw new UserError\(KARAOKE_ELSEWHERE\);/);
  const live = read("src/app/api/canli/route.ts");
  assert.match(live, /const karaokeHere = !\(await staffBranchRefusal\(me, KARAOKE_BRANCH_ID\)\);/);
  assert.match(live, /karaokeHere \? loadSessions\(from, to, \{ admin: me\.role === "admin" \}\) : Promise\.resolve\(\[\]\)/);
  assert.match(live, /const deleteAsks = karaokeHere \? asks : \[\];/);
  assert.match(live, /\.k\$\{karaokeHere \? 1 : 0\}\./, "kilit ETag'te");
  assert.match(read("src/server/data/today.ts"), /karaokeHere \? safe\(loadSessions\(range\.from, range\.to, \{ admin \}\)\) : Promise\.resolve\(null\)/);
  assert.match(read("src/app/panel/karaoke/page.tsx"), /if \(await staffBranchRefusal\(user, KARAOKE_BRANCH_ID\)\) \{/);
  const sync = read("src/server/karaoke/sync.ts");
  assert.match(sync, /const userIds = karaokeAudience\(users\)\.map\(\(u\) => u\.id\);/);
  assert.match(sync, /\{ userIds \}\);/);
});

test("personelin özel günleri: liste ve çakışma kişinin şubesinin günleriyle (her tür; şube kapsamı C P1-10)", () => {
  const src = read("src/server/staff-special.ts");
  assert.match(src, /or\(isNull\(s\.specialDays\.branchId\), eq\(s\.specialDays\.branchId, scope\)\)/);
  assert.equal((src.match(/specialScopeWhere\(scope\)/g) ?? []).length, 2, "liste ve çakışma");
  assert.match(read("src/server/actions/special-days-staff.ts"), /await currentBranchScope\(\),/);
  assert.match(read("src/app/panel/ozel-gunler/page.tsx"), /staffSpecialList\(getDb\(\), user, undefined, scope\)/);
});
