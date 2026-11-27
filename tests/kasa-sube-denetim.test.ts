// Kasa raporu ve şube (21 Kasım 2026 denetimi; docs/SUBE.md › Kasa raporu "Tümü"de, Yazarken hangi şube):
//
// #2  Kasa e-postası ve WhatsApp metni birden çok kasa açıkken raporun şubesini yazar; e-postanın "Panelde aç"ı o şubeyi
//     açar (`&sube=`, zilin bağlantısı gibi); işlem geçmişinin anahtarı şubenin günüdür (iki şube birbirini ezmez).
// #12 Kasa raporu, geç rapor, düzeltme / silme isteği ve kasadan çıkan formun gösterdiği kasaya yazılır: form kasanın
//     kimliğini gönderir, sunucu onu doğrular (etkin fiziksel şube; kilitli personelde kendi şubesi) ve yazımı o kasanın
//     kapsamında çalıştırır. Gönderim anındaki çerez (başka sekmede değişmiş olabilir) yazımın şubesini seçmez.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { DEFAULT_BRANCHES, formTillError, namedTill, type BranchRow } from "../src/lib/branches";
import { branchPart, cashLogKey, reportSubject, whatsappText, type CashReportFields } from "../src/lib/cash-report";
import { longDateTR } from "../src/lib/reminders";
import { renderCashReport } from "../src/server/notify/cash-report-template";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const plain = (s: string) => s.replace(/ /g, " ");

const BRANCHES: BranchRow[] = DEFAULT_BRANCHES.map((b) => ({ ...b, active: true }));
const ONLY_TUZLA: BranchRow[] = BRANCHES.map((b) => (b.id === "marina" ? { ...b, active: false } : b));

const day: CashReportFields = {
  date: "2026-11-20",
  zNo: "0312",
  receipts: 214,
  zTotal: 10_000,
  cash: 2_500,
  card: 7_000,
  mealCard: 500,
  online: 0,
  other: 0,
  openingCash: 500,
  cashIn: 0,
  cashOut: 0,
  cashOutNote: null,
  countedCash: 2_880,
  handedOver: 0,
  bankPos: 7_000,
  offRevenue: null,
  note: null,
};
const meta = { by: "Ayşe", revision: 1, submittedAt: new Date("2026-11-20T20:15:00Z") };

test("#2 namedTill: birden çok kasa açıkken şube, tek kasada null (online kanal kasa sayılmaz)", () => {
  assert.deepEqual(namedTill(BRANCHES, "marina"), { id: "marina", name: "Marina" });
  assert.deepEqual(namedTill(BRANCHES, "tuzla"), { id: "tuzla", name: "Tuzla" });
  assert.equal(namedTill(ONLY_TUZLA, "tuzla"), null, "Marina kapalıyken metin bugünkü gibi");
  assert.equal(branchPart("Marina"), " · Marina");
  assert.equal(branchPart(null), "");
});

test("#2 e-posta konusu ve WhatsApp başlığı numaranın yanında şubeyi yazar; tek kasada bugünkü gibi", () => {
  const date = longDateTR(day.date);
  assert.equal(plain(reportSubject(day, 1, "Marina")), `Kasa raporu KR-20261120 · Marina · ${date} · 120 ₺ eksik`);
  assert.equal(plain(reportSubject(day, 2, "Marina")), `Kasa raporu KR-20261120 · Marina · ${date} · 120 ₺ eksik (güncellendi)`);
  assert.equal(plain(reportSubject(day)), `Kasa raporu KR-20261120 · ${date} · 120 ₺ eksik`);
  assert.match(whatsappText(day, { by: "Ayşe", branchName: "Marina" }), /^\*L'Affogato · Gün sonu kasa raporu KR-20261120 · Marina\*\n/);
  assert.match(whatsappText(day, { by: "Ayşe", revision: 2, branchName: "Marina" }), /^\*L'Affogato · Gün sonu kasa raporu KR-20261120 · Marina\* \(güncellendi\)\n/);
  assert.match(whatsappText(day, { by: "Ayşe" }), /^\*L'Affogato · Gün sonu kasa raporu KR-20261120\*\n/);
  // İki şubenin aynı günkü metni artık ayırt edilir
  assert.notEqual(whatsappText(day, { by: "Ayşe", branchName: "Tuzla" }), whatsappText(day, { by: "Ayşe", branchName: "Marina" }));
});

test("#2 kasa e-postası: konu, başlık ve metin şubeyi yazar; 'Panelde aç' o şubenin raporunu açar (&sube=)", () => {
  const m = renderCashReport(day, { ...meta, branch: { id: "marina", name: "Marina" } });
  assert.match(plain(m.subject), /^Kasa raporu KR-20261120 · Marina · /);
  assert.match(plain(m.html), /Gün sonu kasa raporu · KR-20261120 · Marina</);
  assert.match(m.html, /href="[^"]*\/panel\/kasa\?gun=2026-11-20&amp;sube=marina"/);
  assert.match(plain(m.text), /^L'Affogato · Gün sonu kasa raporu KR-20261120 · Marina\n/);
  assert.match(m.text, /Panelde aç: \S*\/panel\/kasa\?gun=2026-11-20&sube=marina$/);
  // Tek kasada (branch yok) bağlantı ve metin bugünkü gibi
  const one = renderCashReport(day, meta);
  assert.match(one.html, /href="[^"]*\/panel\/kasa\?gun=2026-11-20"/);
  assert.match(one.text, /Panelde aç: \S*\/panel\/kasa\?gun=2026-11-20$/);
  assert.doesNotMatch(one.subject, /Marina|Tuzla/);
});

test("#2 işlem geçmişinin anahtarı şubenin günü: Tuzla'nınki bugünkü gibi, Marina'nınki ayrı", () => {
  assert.equal(cashLogKey({ date: "2026-11-20", revision: 1, branchId: "tuzla" }), "cash:2026-11-20:r1");
  assert.equal(cashLogKey({ date: "2026-11-20", revision: 1, branchId: "marina" }), "cash:2026-11-20:r1:marina");
  assert.notEqual(cashLogKey({ date: "2026-11-20", revision: 2, branchId: "tuzla" }), cashLogKey({ date: "2026-11-20", revision: 2, branchId: "marina" }));
});

test("#2 e-postayı, WhatsApp metnini ve denemeyi kuran yollar raporun şubesini geçer", () => {
  const email = read("src/server/cash/report-email.ts");
  assert.match(email, /branch: namedTill\(branches, row\.branchId\)/);
  assert.match(email, /key: cashLogKey\(row\)/);
  const actions = read("src/server/actions/cash-report.ts");
  assert.equal(actions.match(/whatsappText\([^)]*branchName/g)?.length, 3, "gönderim ve cashReportWhatsapp (kör kasanın sayımsız metni ve öteki günler)");
  assert.match(actions, /renderCashReport\(sample, \{[^}]*branch \}\)/);
  assert.match(read("src/app/panel/kasa/page.tsx"), /branchName: view\.branch\?\.name \?\? null/);
  assert.match(read("src/app/panel/kasa/cash-history.tsx"), /branchName: branch\?\.name \?\? null/);
  // Zil aynı kuralla: birden çok kasa açıkken &sube=
  assert.match(read("src/server/bell/kasa.ts"), /&sube=\$\{encodeURIComponent\(t\.id\)\}/);
});

test("#12 formTillError: formun kasası etkin fiziksel şube; kilitli personel yalnız kendi şubesine", () => {
  assert.equal(formTillError("tuzla", BRANCHES, null), null);
  assert.equal(formTillError("marina", BRANCHES, null), null);
  assert.equal(formTillError("marina", BRANCHES, "marina"), null);
  assert.match(formTillError("online", BRANCHES, null)!, /kasası olmaz/);
  assert.match(formTillError("yok", BRANCHES, null)!, /bulunamadı/);
  assert.match(formTillError("marina", ONLY_TUZLA, null)!, /kapalı/);
  assert.match(formTillError("marina", BRANCHES, "tuzla")!, /Hesabınız Tuzla şubesinde; Marina kasasına yazamazsınız/);
});

test("#12 formTillBranch: kimlik yoksa seçili kasa, varsa doğrulanır (kilit dahil)", () => {
  const scope = read("src/server/branch-scope.ts");
  const fn = scope.slice(scope.indexOf("export async function formTillBranch"));
  // Ortak kapı (formBranch; kural tablosu tests/form-sube.test.ts): kimlik yoksa seçili fiziksel şube
  assert.match(fn, /return formBranch\(raw, "till"\);/);
  const gate = scope.slice(scope.indexOf("export async function formBranch(raw: string | null | undefined, kind: FormBranchKind"));
  assert.match(gate, /staffBranchLock\(\)/);
  assert.match(gate, /pickFormBranch\(\{ raw, kind, scope, known, lock/);
  assert.match(gate, /throw new UserError\(picked\.error\)/);
});

test("#12 yazımlar formun kasasının kapsamında: rapor, istekler, geç rapor ve kasadan çıkan", () => {
  const report = read("src/server/actions/cash-report.ts");
  assert.match(report, /const till = await formTillBranch\(branchId\);/);
  assert.match(report, /withBranchScope\(till, \(\) => saveCashReport\(getDb\(\), asActor\(me, opsLevel\(me\.role\)\), data\)\)/);
  const requests = read("src/server/actions/cash-requests.ts");
  assert.match(requests, /withBranchScope\(await formTillBranch\(raw\), fn\)/);
  assert.match(requests, /inFormTill\(parsed\.branchId, \(\) => proposeCashCorrection\(/);
  assert.match(requests, /inFormTill\(data\.branchId, \(\) => proposeCashDelete\(/);
  assert.match(requests, /inFormTill\(branchId, \(\) => proposeLateReport\(/);
  const outs = read("src/server/actions/cash-outs.ts");
  assert.match(outs, /const till = await formTillBranch\(branchId\);\n\s*return withBranchScope\(till, \(\) => persist\(asActor\(me, opsLevel\(me\.role\)\), d\)\);/);
  assert.match(read("src/server/actions/cash-out-requests.ts"), /withBranchScope\(await formTillBranch\(data\.branchId\), \(\) => proposeCashOutChange\(/);
});

test("#12 sayfa formlara kasayı koyar, formlar gönderir; form anahtarı kasayı da taşır", () => {
  const page = read("src/app/panel/kasa/page.tsx");
  assert.match(page, /key=\{`\$\{view\.till\}:\$\{date\}:\$\{report\?\.revision \?\? 0\}`\}/);
  assert.equal(page.match(/branchId=\{view\.till\}/g)?.length, 5, "CashForm, CashOutsCard, LateReport, gün sonu fotoğrafı (gün ve eski AsilPOS günü)");
  assert.match(page, /chainNeighbours\(getDb\(\), date, \{ prefer: user\.id, branchId: view\.till \}\)/);
  const form = read("src/app/panel/kasa/cash-form.tsx");
  assert.match(form, /submitCashReport\(\{\n\s+\.\.\.fields,\n(?:\s+[^\n]*\n){0,4}?\s+branchId,\n/);
  assert.match(form, /requestCashCorrection\(\{[^}]*branchId,/);
  assert.match(form, /requestLateCashReport\(\{[\s\S]*?branchId,\n\s*clientKey,/);
  assert.match(form, /<DeleteRequestButton [^>]*branchId=\{branchId\}/);
  assert.match(read("src/app/panel/kasa/cash-requests.tsx"), /requestCashDelete\(\{[^}]*branchId,/);
  assert.match(read("src/app/panel/kasa/late-report.tsx"), /branchId=\{branchId\}/);
  assert.match(read("src/app/panel/kasa/cash-outs.tsx"), /branchId=\{branchId\}/);
  const dialog = read("src/app/panel/kasa/cash-out-dialog.tsx");
  assert.match(dialog, /saveCashOut\(\{[\s\S]*?photoId,\n\s*branchId,\n\s*\}\)/);
  assert.match(dialog, /requestCashOutChange\(\{ op: line \? "duzelt" : "ekle"[^}]*branchId,/);
});

test("WhatsApp metni formun kasasının raporundan (24 Kasım şube kapsamı, plan A1.5): gönderim anındaki seçim değil", () => {
  const src = read("src/server/actions/cash-report.ts");
  const fn = src.slice(src.indexOf("export async function cashReportWhatsapp("));
  assert.match(fn, /export async function cashReportWhatsapp\(date: string, branchId\?: string \| null\)/);
  // Arada yalnız kör kasanın kararı (bulgu 0; 28 Kasım 2026'dan beri red değil, sayımsız metin: tests/whatsapp-kor.test.ts)
  assert.match(fn, /const till = await formTillBranch\(zFormBranch\.parse\(branchId\)\);\s*(?:\/\/[^\n]*\n\s*)*const blind = cashAudience\(me\.role\) !== "admin" && \(await isAsilposTillDay\(getDb\(\), d, till\)\);\s*const r = await getCashReport\(d, "staff", till\);/);
  assert.doesNotMatch(fn.slice(0, fn.indexOf("\n}\n")), /getCashReport\(d\)/, "şubesiz okuma kalmadı");
});
