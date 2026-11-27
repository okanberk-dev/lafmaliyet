// Şube ayrımı parça 3 (docs/SUBE.md › Şube ayrımı › Şube sütunu gelen tablolar): şube sütunu olmayan dört tablo şube
// aldı (migration 0101): kontrol listesinin günlük kaydı, işlem geçmişi, gönderim günlüğü, yatırımlar. Saf kurallar ve
// kaynağın biçimi; veritabanındaki davranış tests/sube-ayrimi-kolonlar-db.test.ts'te.
// Çalıştırma: npx tsx --test tests/sube-ayrimi-kolonlar.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ALL_BRANCHES, BRANCH_REQUIRED, DEFAULT_BRANCHES, pickFormBranch, type BranchRow } from "../src/lib/branches";
import { checklistAlerts, type AlertList } from "../src/lib/checklist-alerts";
import { checklistBell, checklistHref, checklistKey, sharedListName, sharedRunBranches, type ChecklistLite } from "../src/lib/checklists";
import { closedDayBellLists, type ClosedMarks } from "../src/lib/closed-days";
import { investmentBranchLabel, investmentTotals } from "../src/lib/investments";

const ROOT = process.cwd();
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((n) => {
    const p = `${dir}/${n}`;
    return statSync(join(ROOT, p)).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

const BRANCHES: BranchRow[] = DEFAULT_BRANCHES.map((b) => ({ ...b, active: true }));

// ---------------------------------------------------------------- Kontrol listesinin kaydı şube başına

test("bütün şubelerin listesi: Tümü'de her fiziksel şubenin satırı, tek şubede o şube, online kanalda hiç", () => {
  assert.deepEqual(sharedRunBranches(ALL_BRANCHES, ["tuzla", "marina"]), ["tuzla", "marina"]);
  assert.deepEqual(sharedRunBranches("marina", ["tuzla", "marina"]), ["marina"]);
  assert.deepEqual(sharedRunBranches("online", ["tuzla", "marina"]), [], "kanalın dükkânı yok");
  assert.deepEqual(sharedRunBranches(ALL_BRANCHES, ["tuzla"]), ["tuzla"]);
  // Satırın adı yalnız yan yana gösterilirken şubeyle başlar
  assert.equal(sharedListName("Kapanış", "Marina"), "Marina · Kapanış");
  assert.equal(sharedListName("Kapanış", null), "Kapanış");
});

test("satırın anahtarı ve bağlantısı: bütün şubelerin listesinde şube de; şubeli liste eskisi gibi", () => {
  const own = { templateId: 7, branchId: "tuzla" };
  const shared = { templateId: 9, branchId: "marina", shared: true };
  assert.equal(checklistKey(own), "7");
  assert.equal(checklistHref(own), "/panel/kontrol/7");
  assert.equal(checklistKey(shared), "9-marina");
  assert.equal(checklistHref(shared), "/panel/kontrol/9?sube=marina");
  assert.notEqual(checklistKey(shared), checklistKey({ ...shared, branchId: "tuzla" }), "iki şubenin satırı ayrı");
});

test("zil: bütün şubelerin listesinin iki şubedeki satırı ayrı kimlikle, kendi şubesinin kaydına götürür", () => {
  const lite = (branchId: string): ChecklistLite => ({
    templateId: 9,
    name: sharedListName("Kapanış", branchId === "tuzla" ? "Tuzla" : "Marina"),
    opensAt: "08:00",
    dueAt: "09:00",
    required: 2,
    photos: 0,
    staffAllowed: true,
    run: null,
    branchId,
    shared: true,
  });
  const now = new Date("2026-11-27T12:00:00+03:00");
  const bell = checklistBell({ role: "admin", now, today: { day: "2026-11-27", lists: [lite("tuzla"), lite("marina")] }, yesterday: null });
  assert.deepEqual(
    bell.map((b) => [b.id, b.href, b.title]),
    [
      ["kontrol-gecikti-9-tuzla-2026-11-27", "/panel/kontrol/9?sube=tuzla", "Tuzla · Kapanış listesi gecikti"],
      ["kontrol-gecikti-9-marina-2026-11-27", "/panel/kontrol/9?sube=marina", "Marina · Kapanış listesi gecikti"],
    ],
  );
  // Dünün listeleri: Marina kapalıyken Marina'nın satırı düşer, Tuzla'nınki kalır (kapalı gün şubenin)
  const marks: ClosedMarks = { all: false, branches: new Set(["marina"]), open: ["tuzla", "marina"] };
  assert.deepEqual(
    closedDayBellLists([lite("tuzla"), lite("marina")], marks).map((l) => l.branchId),
    ["tuzla"],
  );
});

test("personel e-postası: bütün şubelerin listesinin uyarısı şube başına (anahtar şubeyi taşır, alıcı o şubenin)", () => {
  const list = (branchId: string): AlertList => ({
    templateId: 9,
    name: "Kapanış",
    branchId,
    shared: true,
    opensAt: "10:00",
    dueAt: "11:00",
    items: [{ id: 1, label: "Tezgâh", type: "check", section: null, hint: null, required: true, unit: null, min: null, max: null }],
    answers: [],
    hasRun: false,
  });
  const alerts = checklistAlerts("2026-11-27", new Date("2026-11-27T10:30:00+03:00"), [list("tuzla"), list("marina")]);
  assert.deepEqual(
    alerts.map((a) => [a.key, a.branchId, a.shared]),
    [
      ["kontrol-eposta:9@tuzla:2026-11-27:liste:due", "tuzla", true],
      ["kontrol-eposta:9@marina:2026-11-27:liste:due", "marina", true],
    ],
  );
  // Şubeli listenin anahtarı değişmedi (gönderilmiş uyarı yeniden gitmez)
  const own = checklistAlerts("2026-11-27", new Date("2026-11-27T10:30:00+03:00"), [{ ...list("tuzla"), shared: undefined }]);
  assert.equal(own[0].key, "kontrol-eposta:9:2026-11-27:liste:due");
  assert.match(read("src/server/notify/checklist-alert-template.ts"), /export const alertLink = \(a: Pick<ChecklistAlert, "templateId" \| "branchId" \| "shared">\) => `\$\{APP_URL\}\$\{checklistHref\(a\)\}`;/);
});

test("bütün şubelerin listesine yazımın şubesi: etkin fiziksel şube, kilitli personelde kendi şubesi; Tümü'de sorulur", () => {
  const pick = (o: Partial<Parameters<typeof pickFormBranch>[0]>) =>
    pickFormBranch({ raw: null, kind: "checklist", scope: ALL_BRANCHES, known: BRANCHES, lock: null, requireExplicit: true, ...o });
  assert.deepEqual(pick({ raw: "marina" }), { id: "marina" });
  assert.deepEqual(pick({ scope: "tuzla" }), { id: "tuzla" });
  assert.deepEqual(pick({}), { error: BRANCH_REQUIRED }, "Tümü'de iki kasa açıkken sessizce Tuzla'ya inmez");
  assert.deepEqual(pick({ raw: "online" }), { error: "laffogato.net kanalının kontrol listesi olmaz; sayfayı yenileyin" });
  assert.deepEqual(pick({ raw: "marina", lock: "tuzla" }), { error: "Hesabınız Tuzla şubesinde; Marina kontrol listesine yazamazsınız" });
  assert.deepEqual(pick({ raw: "yok" }), { error: "Formun şubesi bulunamadı ya da kapalı; sayfayı yenileyin" });
});

test("kaynak: doldurma ekranı ve yazım kaydın şubesini taşır; eski kayıt şube başına okunmaz", () => {
  const store = read("src/server/checklists/store.ts");
  assert.match(store, /function runWhere\(templateId: number, date: string, branchId: string\)/);
  assert.match(store, /\.values\(\{ templateId: tpl\.id, date: input\.date, branchId, seq: 1,/);
  // Tek şube seçiliyken öbür şubenin kaydı okunmaz
  assert.equal((store.match(/scope === ALL_BRANCHES \? undefined : eq\(r\.branchId, scope\)/g) ?? []).length, 2, "günün listeleri ve geçmiş");
  const page = read("src/app/panel/kontrol/[id]/page.tsx");
  assert.match(page, /RUN_BRANCH_QUESTION/);
  assert.match(page, /branch=\{shared \? chosen : null\}/);
  assert.match(read("src/app/panel/kontrol/[id]/run-form.tsx"), /answerChecklistItem\(\{ templateId, date: day, itemId: item\.id, branch, \.\.\.op \}\)/);
  assert.match(read("src/app/panel/kontrol/[id]/photo-item.tsx"), /if \(branch\) form\.append\("branch", branch\);/);
  assert.match(read("src/app/api/kontrol/foto/route.ts"), /branch: zFormBranch,/);
  assert.match(read("src/app/panel/bugun/logic.ts"), /key: `liste-\$\{checklistKey\(l\)\}` as DayTaskKey, title: listTitle\(l\.name\), href: checklistHref\(l\)/);
  assert.match(read("src/app/panel/kontrol/page.tsx"), /<ListCard key=\{checklistKey\(l\)\}/);
  // Kapalı gün kanıtı kaydın şubesinden (şablonun değil)
  assert.match(read("src/server/closed-days.ts"), /db\.select\(\{ branchId: s\.checklistRuns\.branchId \}\)\.from\(s\.checklistRuns\)/);
});

// ---------------------------------------------------------------- İşlem geçmişi ve gönderim günlüğü

test("kaynak: işlem geçmişine her yazım şubeyi yazar; okuyanlar şubenin ve şubesiz kayıtları okur", () => {
  const missing: string[] = [];
  for (const file of walk("src")) {
    const src = read(file);
    let at = src.indexOf("insert(s.activityLog)");
    while (at >= 0) {
      // Yazımın değerleri: `.values(` ile kapanışı arası (en çok 600 karakter)
      const body = src.slice(at, at + 600);
      const values = body.slice(0, body.indexOf("});") + 3 || 600);
      if (!/\bbranchId\b/.test(values)) missing.push(`${file}:${src.slice(0, at).split("\n").length}`);
      at = src.indexOf("insert(s.activityLog)", at + 1);
    }
  }
  assert.deepEqual(missing, [], "işlem geçmişinin şubesi yazılmalı (boşsa işletme geneli; logActivity seçimden alır)");
  const log = read("src/server/actions/log.ts");
  assert.match(log, /export async function activityBranch\(given\?: string \| null\): Promise<string \| null>/);
  assert.match(log, /return scope === ALL_BRANCHES \? null : scope;/);
  // Okuyanlar: İşlem geçmişi, zilin bilgi satırları, sayım uyarıları
  assert.match(read("src/app/panel/ayarlar/page.tsx"), /\.from\(s\.activityLog\)\.where\(branchWhereWithShared\(s\.activityLog\.branchId, scope\)\)/);
  assert.match(read("src/server/closed-days.ts"), /scope === ALL_BRANCHES \? undefined : or\(eq\(s\.activityLog\.branchId, scope\), isNull\(s\.activityLog\.branchId\)\)/);
  assert.match(read("src/server/bell/kasa.ts"), /closedInfoRows\(new Date\(now\.getTime\(\) - 3 \* 86_400_000\), scope\)/);
  assert.match(read("src/server/data/count-alerts.ts"), /branchWhereWithShared\(s\.activityLog\.branchId, sc\)/);
});

test("kaynak: şubenin gönderimleri günlüğe şubesiyle yazılır; Son gönderimler seçimle okur", () => {
  assert.match(read("src/server/cash/report-email.ts"), /error: res\.ok \? null : res\.error, branchId: row\.branchId \}\)/);
  const asilpos = read("src/server/asilpos/gun-sonu.ts");
  assert.equal((asilpos.match(/\.insert\(s\.notificationLog\)[\s\S]{0,260}?branchId \}\)/g) ?? []).length, 4, "çalışan, gün sonu, Pavo ve fotoğraf e-postası");
  assert.match(asilpos, /error: PHOTO_SENDING, sentAt: now, branchId \}\)/);
  assert.match(read("src/server/vardiya/notify.ts"), /recipients: "\(yöneticiler\)", ok: true, branchId: b\.id \}/);
  assert.match(read("src/server/notify/digest.ts"), /export async function recentNotifications\(limit = 12, scope: BranchScope = ALL_BRANCHES\)/);
  // Şube ayrımı parça 4: Son gönderimler Ödemeler ve faturalar alanının kapsamıyla (şube kipinde şubenin)
  assert.match(read("src/app/panel/hatirlaticilar/page.tsx"), /recentNotifications\(10, area\)/);
});

// ---------------------------------------------------------------- Yatırımlar

test("yatırımlar: şube seçiliyken toplam şubenin, işletme geneli bilgi; Tümü'de hepsi", () => {
  const rows = [
    { amount: 1000, branchId: "marina" },
    { amount: 250.5, branchId: null },
    { amount: 99, branchId: null },
  ];
  assert.deepEqual(investmentTotals(rows, "marina"), { total: 1000, shared: 349.5, sharedCount: 2 });
  assert.deepEqual(investmentTotals([...rows, { amount: 77777.77, branchId: "tuzla" }], ALL_BRANCHES), { total: 79127.27, shared: 0, sharedCount: 0 });
  const names = new Map([["marina", "Marina"]]);
  assert.equal(investmentBranchLabel("marina", ALL_BRANCHES, names, true), "Marina");
  assert.equal(investmentBranchLabel(null, ALL_BRANCHES, names, true), "İşletme geneli");
  assert.equal(investmentBranchLabel("marina", "marina", names, true), null, "şubenin kendi satırı etiketsiz");
  assert.equal(investmentBranchLabel(null, "marina", names, true), "İşletme geneli");
  assert.equal(investmentBranchLabel(null, ALL_BRANCHES, names, false), null, "tek şube açıkken etiket yok");
  // Ekran ve dosya kapsamla okur; form şubeyi sorar, eylem doğrular
  assert.match(read("src/server/data/investments.ts"), /where\(branchWhereWithShared\(s\.investments\.branchId, scope\)\)/);
  assert.match(read("src/app/api/export/route.ts"), /loadInvestments\(scope\),/);
  assert.match(read("src/server/actions/costs.ts"), /const branchId = await checkedBranch\(branchInput, false\);\s+const branchSet = branchId !== undefined \? \{ branchId \} : \{\};/);
  assert.match(read("src/app/panel/giderler/expenses-client.tsx"), /<Select id="iv-b" value=\{branch\}/);
  assert.match(read("src/server/branches.ts"), /s\.checklistRuns,\s+s\.investments,/);
});

// ---------------------------------------------------------------- Migration

test("migration 0101: kayıtlar geri doldurulur, eski sürümün yazımı tetikleyiciyle doğru şubeye iner", () => {
  const sql = read("drizzle/0101_sube_ayrimi.sql");
  // Sıra: listenin şubesi, tamamlayanın, ilk yanıtlayanın (fiziksel) şubesi, Tuzla
  const fill = sql.slice(sql.indexOf('UPDATE "checklist_runs"'), sql.indexOf('ALTER TABLE "checklist_runs" ALTER COLUMN'));
  const order = ['FROM "checklist_templates" t', 'WHERE u."id" = r."completed_by"', 'FROM "checklist_answers" a', "'tuzla'"].map((p) => fill.indexOf(p));
  assert.ok(order.every((i) => i > 0) && order.every((i, n) => n === 0 || i > order[n - 1]), `geri doldurma sırası: ${order}`);
  assert.match(sql, /ALTER TABLE "checklist_runs" ALTER COLUMN "branch_id" SET NOT NULL;/);
  assert.match(sql, /CREATE TRIGGER "checklist_runs_branch_fill_tg" BEFORE INSERT ON "checklist_runs"/);
  assert.match(sql, /CREATE UNIQUE INDEX "checklist_runs_template_day_uq" ON "checklist_runs" USING btree \("template_id","date","branch_id","seq"\);/);
  // Günlükler şubeyi silmeye engel değil; yatırım engeldir (branchUsageCount)
  assert.match(sql, /"activity_log_branch_id_branches_id_fk"[^;]*ON DELETE set null/);
  assert.match(sql, /"notification_log_branch_id_branches_id_fk"[^;]*ON DELETE set null/);
  assert.match(sql, /"investments_branch_id_branches_id_fk"[^;]*ON DELETE no action/);
  const journal = JSON.parse(read("drizzle/meta/_journal.json")) as { entries: { idx: number; tag: string }[] };
  assert.deepEqual(journal.entries.at(-1), { ...journal.entries.at(-1), idx: 101, tag: "0101_sube_ayrimi" });
});
