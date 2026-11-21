// Zayi kilidi ve Onaylar kartları şube başına (21 Kasım 2026 denetimi; docs/SUBE.md › Kasa raporu "Tümü"de):
//
// #13 Zayi gün kilidi (wasteLock) kaydın şubesinin kasasına bakar: başka şubenin raporu günü açmaz ya da kapatmaz. Yeni
//     kayıtta ve geç kayıt isteğinde kaydın ineceği fiziksel şube, silmede kaydın kendi şubesi; zayi sayfasının kipleri de.
// #28 Onaylar › Zayi kartının bağlamı (Z ödenmez, rapor gönderildi mi, o günün kayıtları, kayıtlı ikram) isteğin
//     şubesinden; maliyet modeli şube başına.
// #29 Kasadan çıkan ve fotoğraf kaldırma kartları şubeyi taşır ve gösterir; "Günü aç" `?sube=` ile o şubenin gününü açar.
//
// Davranış veritabanı testlerinde (tests/zayi-istek-db.test.ts, tests/kasa-cikan-istek-db.test.ts); burada bağlantının
// kuralı ve kaynaktaki bağlantılar.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { branchDayHref, kasaDayHref } from "../src/app/panel/onaylar/branch-badge";
import { staffWasteMode } from "../src/lib/waste-requests";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

test("#29 günün bağlantısı: birden çok kasa açıkken isteğin şubesinde, tek kasada bugünkü gibi", () => {
  assert.equal(kasaDayHref({ date: "2026-11-21", branch: { id: "marina" } }), "/panel/kasa?gun=2026-11-21&sube=marina");
  assert.equal(kasaDayHref({ date: "2026-11-21", branch: null }), "/panel/kasa?gun=2026-11-21");
  assert.equal(kasaDayHref({ date: "2026-11-21" }), "/panel/kasa?gun=2026-11-21");
  assert.equal(branchDayHref("/panel/zayi", { date: "2026-11-18", branch: { id: "marina" } }), "/panel/zayi?gun=2026-11-18&sube=marina");
  assert.equal(branchDayHref("/panel/zayi", { date: "2026-11-18", branch: null }), "/panel/zayi?gun=2026-11-18");
});

test("#13 kilit kuralı şubenin raporlarıyla: Marina'nın raporları dünü kapatır, Tuzla'nınkiler Marina'nın unutulan dününü kapatmaz", () => {
  const now = new Date("2026-11-21T12:00:00+03:00");
  // İki şube 20 ve 21 Kasım'ı girdi: Marina'nın kilidi kendi iki raporu, dün kapalı (geç kayıt isteği)
  assert.equal(staffWasteMode("2026-11-20", now, { hasReport: true, laterReport: true }), "request");
  // Marina 20 Kasım'ı unuttu, Tuzla ikisini girdi: Marina'nın kilidinde rapor yok, dün açık
  assert.equal(staffWasteMode("2026-11-20", now, { hasReport: false, laterReport: false }), "direct");
});

test("#13 kaynak: wasteLock şubeyle süzer; çağıranlar kaydın şubesini verir, zayi sayfası da", () => {
  const core = read("src/server/waste/core.ts");
  assert.match(core, /export async function wasteLock\(db: Tx, date: string, branchId: string\): Promise<WasteLock>/);
  assert.match(core, /\.where\(and\(gte\(s\.cashReports\.date, date\), eq\(s\.cashReports\.branchId, branchId\)\)\)/);
  // Yeni kayıt: kilit yazılacak şubeyle, şube kipten önce
  const add = core.slice(core.indexOf("export async function addWaste"), core.indexOf("async function closeDeleteRequests"));
  assert.ok(add.indexOf("const branchId = (await currentPhysicalBranch()).id;") < add.indexOf("wasteLock(tx, data.date, branchId)"));
  // Geç kayıt isteği: kilit ve yükteki şube aynı
  const late = core.slice(core.indexOf("export async function proposeLateWaste"), core.indexOf("export async function proposeWasteDelete"));
  assert.ok(late.indexOf("const branchId = (await currentPhysicalBranch()).id;") < late.indexOf("wasteLock(tx, input.date, branchId)"));
  assert.match(late, /\n\s+branchId,\n\s+\}\);/);
  // Silme ve silme isteği: kaydın kendi şubesi
  assert.match(core, /staffDeleteMode\(row, me, now, await wasteLock\(tx, row\.date, row\.branchId\)\) !== "direct"/);
  assert.match(core, /const mode = staffDeleteMode\(row, me, now, await wasteLock\(tx, row\.date, row\.branchId\)\);/);
  assert.doesNotMatch(core, /wasteLock\(tx, [\w.]+\)/, "şubesiz çağrı kalmadı");
  // Zayi sayfası: formun kipi yazılacak şubenin, satırın silme kipi kaydın şubesinin kilidiyle
  const page = read("src/app/panel/zayi/page.tsx");
  assert.match(page, /const branchId = admin \? null : \(await currentPhysicalBranch\(\)\)\.id;/);
  assert.match(page, /const lock = branchId \? await wasteLock\(getDb\(\), date, branchId\) : null;/);
  assert.match(page, /locks\.set\(b, await wasteLock\(getDb\(\), date, b\)\)/);
  assert.match(page, /staffDeleteMode\(e, user, now, locks\.get\(e\.branchId\) \?\? lock\)/);
});

test("#28 kaynak: zayi kartının bağlamı isteğin şubesinden, model şube başına", () => {
  const loader = read("src/server/data/waste-requests.ts");
  const queue = loader.slice(loader.indexOf("export async function loadWasteRequestQueue"));
  assert.match(queue, /^export async function loadWasteRequestQueue\(modelOf: \(branchId: string\) => Promise<Model>, now: Date = new Date\(\)\)/);
  // Rapor şubenin günüyle; geç kayıtta isteğin şubesi, silmede kaydın şubesi
  assert.match(queue, /branchId: s\.cashReports\.branchId/);
  assert.match(queue, /const reportOf = new Map\(reports\.map\(\(r\) => \[`\$\{r\.date\}\|\$\{r\.branchId\}`, r\]\)\);/);
  assert.match(queue, /const lateBranch = \(p: LateWastePayloadT\) => p\.branchId \?\? DEFAULT_BRANCH_ID;/);
  assert.match(queue, /const report = reportOf\.get\(`\$\{p\.date\}\|\$\{sube\}`\);/);
  assert.match(queue, /const report = current \? reportOf\.get\(`\$\{current\.date\}\|\$\{current\.branchId\}`\) : undefined;/);
  assert.doesNotMatch(queue, /reportOf\.get\(r\.day\)/);
  // O günün kayıtları ve bekleyen öteki istekler aynı şubenin; kayıtlı ikram ve LafPOS günleri şubenin modelinden
  assert.match(queue, /entries\.filter\(\(e\) => e\.date === p\.date && e\.branchId === sube\)/);
  assert.match(queue, /same\(op\.data\) && lateBranch\(op\.data\) === sube/);
  assert.match(queue, /const model = models\.get\(sube\)!;/);
  assert.match(queue, /ikramValueOf\(model, p\.date\)/);
  assert.match(queue, /const lafposDays = new Set\(model\.ds\.lafposIkram\?\.days \?\? \[\]\);/);
  // Onaylar: yöneticinin seçimiyle kurulan model değil, şubenin modeli (istek başına şube başına bir kez)
  assert.match(read("src/server/data/model-once.ts"), /export const loadBranchModelOnce = cache\(\(branchId: string\) => loadModel\(\{ scope: branchId \}\)\);/);
  const section = read("src/app/panel/onaylar/ops-section.tsx");
  assert.match(section, /loadWasteRequestQueue\(loadBranchModelOnce, now\)/);
  assert.doesNotMatch(section, /loadModelOnce/);
  // Kart şubeyi adıyla yazar, "Günü aç" o şubenin zayi gününü açar
  const cards = read("src/app/panel/onaylar/ops-cards.tsx");
  assert.equal(cards.match(/<BranchBadge branch=\{card\.branch\} \/>/g)?.length, 2);
  assert.match(cards, /href=\{branchDayHref\("\/panel\/zayi", card\)\}/);
  assert.doesNotMatch(cards, /\/panel\/zayi\?gun=\$\{card\.date\}/);
});

test("#29 kaynak: kasadan çıkan ve fotoğraf kaldırma kartları şubeyi taşır; kart adı gösterir, bağlantı ?sube= ile", () => {
  const loader = read("src/server/data/cash-out-requests.ts");
  assert.match(loader, /\n\s+branchId: string \| null;\n/);
  assert.match(loader.slice(loader.indexOf("async function cashOutCard(")), /\n\s+branchId: sube,\n/);
  assert.match(loader.slice(loader.indexOf("async function photoCard("), loader.indexOf("async function cashOutCard(")), /\n\s+branchId: report\?\.branchId \?\? null,\n/);
  const queue = read("src/server/data/cash-requests.ts");
  assert.match(queue, /\[\.\.\.day\.map\(named\), \.\.\.late\.map\(named\), \.\.\.outs\.map\(named\), \.\.\.closed\]/);
  const ui = read("src/app/panel/onaylar/kasa-out-cards.tsx");
  assert.match(ui, /import \{ BranchBadge, kasaDayHref \} from "\.\/branch-badge";/);
  assert.equal(ui.match(/<BranchBadge branch=\{card\.branch\} \/>/g)?.length, 2);
  assert.equal(ui.match(/href=\{kasaDayHref\(card\)\}/g)?.length, 2);
  assert.doesNotMatch(ui, /\/panel\/kasa\?gun=\$\{card\.date\}/);
  // Düzeltme, silme ve geç rapor kartları aynı ortak yardımcıları kullanır (kasa-cards kasa-out-cards'ı içe aktarır: döngü yok)
  const kasa = read("src/app/panel/onaylar/kasa-cards.tsx");
  assert.match(kasa, /import \{ BranchBadge, kasaDayHref \} from "\.\/branch-badge";/);
  assert.doesNotMatch(kasa, /function BranchBadge|const kasaDayHref/);
  assert.doesNotMatch(read("src/app/panel/onaylar/branch-badge.tsx"), /from "\.\/kasa-/);
});
