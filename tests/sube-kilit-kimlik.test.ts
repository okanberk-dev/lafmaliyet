// Şubesine kilitli personel ve kimliğiyle açılan kayıt (21 Kasım 2026 denetimi #14; docs/SUBE.md › Personel hesabının
// şubesi): kilit yalnız seçimi ve yeni kaydın şubesini belirliyordu. Kasadan çıkan satırı, zayi kaydı, kasa raporu ve
// kasa / fiş fotoğrafı kimliğiyle açılınca satırın şubesi kişinin şubesiyle karşılaştırılmıyordu: Tuzla'ya kilitli
// personel Marina'nın açık günündeki satırı elle gönderdiği kimlikle düzeltip silebiliyor, Z fotoğrafını görebiliyordu.
// Kural saf (src/lib/branches.ts otherBranchError), sunucudaki tek kapı src/server/branch-scope.ts staffBranchRefusal;
// burada kuralın kendisi ve her yolun kapıya sorduğu. Veritabanında: tests/sube-kilit-db.test.ts.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { DEFAULT_BRANCHES, otherBranchError, type BranchRow } from "../src/lib/branches";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** Dosyada `head` ile başlayan işlevin gövdesi (bir sonraki üst düzey tanıma kadar) */
const body = (src: string, head: string) => {
  const start = src.indexOf(head);
  assert.ok(start >= 0, head);
  const rest = src.slice(start + head.length);
  const end = rest.search(/\n(export |async function |function |const |\/\*\*)/);
  return end < 0 ? rest : rest.slice(0, end);
};

const BRANCHES: BranchRow[] = DEFAULT_BRANCHES.map((b) => ({ ...b, active: true }));

test("#14 otherBranchError: kilitli personel yalnız kendi şubesinin kaydına; kilitsiz ya da şubesiz kayıtta serbest", () => {
  assert.equal(otherBranchError("tuzla", BRANCHES, "tuzla"), null, "kendi şubesi");
  assert.equal(otherBranchError("marina", BRANCHES, "tuzla"), "Bu kayıt Marina şubesinin; hesabınız Tuzla şubesinde");
  assert.equal(otherBranchError("tuzla", BRANCHES, "marina"), "Bu kayıt Tuzla şubesinin; hesabınız Marina şubesinde");
  // Kilit yok: yönetici, şubesiz personel, şubesi pasife alınmış personel (lockedBranch null döner)
  assert.equal(otherBranchError("marina", BRANCHES, null), null);
  // Kaydın şubesi yok (işletme geneli): kimsenin başka şubesi değil
  assert.equal(otherBranchError(null, BRANCHES, "tuzla"), null);
  assert.equal(otherBranchError(undefined, BRANCHES, "tuzla"), null);
  // Kütükte olmayan (silinmiş) şube: kimliğiyle yazılır, yine reddedilir
  assert.equal(otherBranchError("eski", BRANCHES, "tuzla"), "Bu kayıt eski şubesinin; hesabınız Tuzla şubesinde");
});

test("#14 staffBranchRefusal: yönetici sorgusuz serbest; kilit isteğin kullanıcısından (lockedBranch), kural saf dosyada", () => {
  const fn = body(read("src/server/branch-scope.ts"), "export async function staffBranchRefusal(");
  assert.match(fn, /if \(me\.role === "admin"\) return null;/);
  assert.match(fn, /return otherBranchError\(branchId, branches, await lockedBranch\(branches\)\);/);
});

test("#14 kasadan çıkan: kapı var olan satırın her işleminde (düzeltme, silme, istek, fiş) şubeye sorar, günden önce", () => {
  const gate = body(read("src/server/cash-outs/guard.ts"), "export async function staffCashOutGate(");
  const check = gate.indexOf('const refusal = target.op === "ekle" ? null : await staffBranchRefusal(me, target.row.branchId);');
  assert.ok(check > 0, "satırın şubesi kapıda");
  assert.ok(check > gate.indexOf('if (me.role === "admin") return "direct";'), "yönetici kapıdan önce çıkar");
  assert.ok(check < gate.indexOf("staffDayOpen("), "başka şubenin açık günü satırı açmaz");
  assert.match(gate, /if \(refusal\) throw new UserError\(refusal\);/);
  // Personelin var olan satıra dokunan bütün yolları bu kapıdan geçer
  const outs = read("src/server/actions/cash-outs.ts");
  assert.match(outs, /staffCashOutGate\(tx, me, prev \? \{ op: "duzelt", row: prev \}/);
  assert.match(outs, /staffCashOutGate\(tx, me, \{ op: "sil", row \}\)/);
  const reqs = read("src/server/cash-outs/requests.ts");
  assert.match(reqs, /staffCashOutGate\(tx, me, \{ op: input\.op, row \}, now\)/);
  assert.match(reqs, /staffCashOutGate\(tx, me, \{ op: "fis", row \}, now\)/);
});

test("#14 fotoğraf kaldırma isteği: rapordaki fotoğrafın şubesi kişinin şubesi olmalı", () => {
  const reqs = read("src/server/cash-outs/requests.ts");
  assert.match(body(reqs, "async function linkOf("), /branchId: s\.cashReports\.branchId/);
  const propose = body(reqs, "export async function proposePhotoRemoval(");
  assert.match(propose, /const otherBranch = await staffBranchRefusal\(me, link\.branchId\);\n\s*if \(otherBranch\) throw new UserError\(otherBranch\);/);
  assert.ok(propose.indexOf("staffBranchRefusal") < propose.indexOf("removalCheck("), "okuma farkı ve tek Z denetiminden önce");
});

test("#14 kasa ve fiş fotoğrafı: başka şubenin fotoğrafı kilitli personele 403 (günün açıklığına bakılmadan)", () => {
  const rules = read("src/server/photo-read/rules.ts");
  for (const name of ["cashPhotoRules", "receiptPhotoRules"]) {
    const fn = body(rules, `export const ${name}: PhotoKindRules = {`);
    assert.match(fn, /select\(\{ date: s\.\w+\.date, branchId: s\.\w+\.branchId \}\)/, name);
    assert.match(fn, /return Boolean\(row && !\(await staffBranchRefusal\(me, row\.branchId\)\) && \(await staffDayOpen\(row\.date, undefined, undefined, row\.branchId\)\)\);/, name);
  }
  // Yazarkasa Z'si kasanın kuralını paylaşır
  assert.match(rules, /export const okcPhotoRules: PhotoKindRules = \{ \.\.\.cashPhotoRules, keepDays: KEEP_DAYS\["kasa-okc"\] \}/);
});

test("#14 zayi: doğrudan silme ve silme isteği kaydın şubesine sorar; yeni kayıt zaten seçili (kilitli) şubeye", () => {
  const core = read("src/server/waste/core.ts");
  assert.match(body(core, "async function refuseOtherBranch("), /const refusal = await staffBranchRefusal\(me, row\.branchId\);\n\s*if \(refusal\) throw new UserError\(refusal\);/);
  for (const head of ["export async function removeWaste(", "export async function proposeWasteDelete("]) {
    const fn = body(core, head);
    const at = fn.indexOf("await refuseOtherBranch(me, row);");
    assert.ok(at > 0, head);
    assert.ok(at > fn.indexOf('if (!row) throw new UserError("Kayıt bulunamadı");') && at < fn.indexOf("staffDeleteMode("), head);
  }
  assert.match(body(core, "export async function addWaste("), /const branchId = \(await currentPhysicalBranch\(\)\)\.id;/);
});

test("#14 kasa raporu e-postasını yeniden gönderme: personel yalnız kendi şubesinin raporunu", () => {
  const fn = body(read("src/server/actions/cash-report.ts"), "export async function resendCashReportEmail(");
  assert.match(fn, /const otherBranch = await staffBranchRefusal\(me, row\.branchId\);\n\s*if \(otherBranch\) throw new UserError\(otherBranch\);/);
  assert.ok(fn.indexOf("staffBranchRefusal") < fn.indexOf("emailReport("));
});

test("#14 belge: SUBE.md kimliğiyle açılan kaydı ve yardımcıyı yazar; FOTOGRAF.md kim görür kuralı", () => {
  const sube = read("docs/SUBE.md");
  assert.match(sube, /Kilit kimliğiyle açılan kayda da bakar \(21 Kasım denetimi #14; `src\/server\/branch-scope\.ts` › `staffBranchRefusal`/);
  assert.match(read("docs/FOTOGRAF.md"), /şubesine kilitli personel yalnız kendi şubesininkileri\n\s*\(`staffBranchRefusal`/);
});
