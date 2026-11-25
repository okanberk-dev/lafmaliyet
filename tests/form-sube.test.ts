// Formun şubesi (24 Kasım 2026 şube kapsamı taraması, plan › 0. Ortak yapı taşı; docs/SUBE.md › Yazarken hangi şube):
//
// form-sube   Yazım formun gösterdiği şubeye iner, gönderim anındaki seçime değil (çerez sekmeler arasında ortak). Kasa,
//             sayım, zayi, satış ve gider aynı kapıdan geçer (`formBranch`, src/server/branch-scope.ts); kuralı saf
//             `pickFormBranch` (src/lib/branches.ts). "Tümü"de şubeye özgü yazım şubeyi sorar, sessizce Tuzla'ya inmez;
//             online kanal seçiliyken satış yazılmaz; gider "İşletme geneli"ni açıkça seçebilir.
// kapsam      Kapsamla silen yazım formun gösterdiği kapsamı gönderir; seçim başka sekmede değiştiyse red.
// karaoke     Karaokenin şubesi şube özelliğinden (`karaokeBranchOf`, src/lib/branch-features.ts; sahibin varsayılanı Tuzla);
//             kitlesi yönetici, şubesiz personel ve o şubenin personeli.
//
// Çalıştırma: npx tsx --test tests/form-sube.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  ALL_BRANCHES,
  BRANCH_REQUIRED,
  DEFAULT_BRANCH_ID,
  DEFAULT_BRANCHES,
  EXPENSE_SHARED,
  formBranchError,
  pickFormBranch,
  SCOPE_CHANGED,
  shownScopeError,
  zFormBranch,
  type BranchRow,
  type FormBranchKind,
} from "../src/lib/branches";
import { karaokeBranchOf } from "../src/lib/branch-features";
import { karaokeAudience, staffMailRecipients } from "../src/lib/karaoke/staff-mail";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const BRANCHES: BranchRow[] = DEFAULT_BRANCHES.map((b) => ({ ...b, active: true }));
const ONLY_TUZLA: BranchRow[] = BRANCHES.map((b) => (b.id === "marina" ? { ...b, active: false } : b));
const GONE = "Formun şubesi bulunamadı ya da kapalı; sayfayı yenileyin";

const pick = (o: { raw?: string | null; kind: FormBranchKind; scope?: string; known?: BranchRow[]; lock?: string | null; requireExplicit?: boolean }) =>
  pickFormBranch({ raw: o.raw ?? null, kind: o.kind, scope: o.scope ?? ALL_BRANCHES, known: o.known ?? BRANCHES, lock: o.lock ?? null, requireExplicit: o.requireExplicit });

test("form-sube formBranchError: türün şubesi; kilitli personel yalnız kendi şubesine", () => {
  // Kasa ve sayım metinleri değişmedi (formTillError / formCountError)
  assert.equal(formBranchError("online", "till", BRANCHES, null), "laffogato.net kanalının kasası olmaz; sayfayı yenileyin");
  assert.equal(formBranchError("marina", "count", BRANCHES, "tuzla"), "Hesabınız Tuzla şubesinde; Marina sayımına yazamazsınız");
  // Zayi
  assert.equal(formBranchError("marina", "waste", BRANCHES, null), null);
  assert.equal(formBranchError("online", "waste", BRANCHES, null), "laffogato.net kanalının zayisi olmaz; sayfayı yenileyin");
  assert.equal(formBranchError("marina", "waste", BRANCHES, "tuzla"), "Hesabınız Tuzla şubesinde; Marina zayisine yazamazsınız");
  // Satış: kanalın kasa satışı yok
  assert.equal(formBranchError("marina", "sales", BRANCHES, null), null);
  assert.equal(formBranchError("online", "sales", BRANCHES, null), "laffogato.net kanalının kasa satışı yok; şube seçiciden şubeyi seçin");
  assert.equal(formBranchError("marina", "sales", ONLY_TUZLA, null), GONE);
  // Gider: kanal da bir şubedir; işletme geneli açık seçim, kilitli personele kapalı
  assert.equal(formBranchError("online", "expense", BRANCHES, null), null);
  assert.equal(formBranchError(EXPENSE_SHARED, "expense", BRANCHES, null), null);
  assert.equal(formBranchError(EXPENSE_SHARED, "expense", BRANCHES, "marina"), "Hesabınız Marina şubesinde; işletme geneline yazamazsınız");
  assert.equal(formBranchError("tuzla", "expense", BRANCHES, "marina"), "Hesabınız Marina şubesinde; Tuzla giderine yazamazsınız");
  assert.equal(formBranchError("yok", "expense", BRANCHES, null), GONE);
  // "isletme" yalnız giderde anlamlıdır
  assert.equal(formBranchError(EXPENSE_SHARED, "sales", BRANCHES, null), GONE);
});

test("form-sube pickFormBranch: form şubeyi gönderdiyse seçim ne olursa olsun o şube", () => {
  assert.deepEqual(pick({ raw: "tuzla", kind: "sales", scope: "marina" }), { id: "tuzla" });
  assert.deepEqual(pick({ raw: "tuzla", kind: "waste", scope: "online" }), { id: "tuzla" });
  assert.deepEqual(pick({ raw: "marina", kind: "till", scope: ALL_BRANCHES, requireExplicit: true }), { id: "marina" });
  assert.deepEqual(pick({ raw: EXPENSE_SHARED, kind: "expense", scope: "marina" }), { id: null });
  assert.deepEqual(pick({ raw: "marina", kind: "expense", scope: ALL_BRANCHES }), { id: "marina" });
  assert.deepEqual(pick({ raw: "online", kind: "sales", scope: "online" }), { error: "laffogato.net kanalının kasa satışı yok; şube seçiciden şubeyi seçin" });
  assert.deepEqual(pick({ raw: "marina", kind: "waste", lock: "tuzla" }), { error: "Hesabınız Tuzla şubesinde; Marina zayisine yazamazsınız" });
});

test("form-sube pickFormBranch: şubeyi göndermeyen eski sekme bugünkü kuralla; requireExplicit Tümü'de sorar", () => {
  // Kasa / sayım / zayi: seçili fiziksel şube, "Tümü" ve kanalda Tuzla
  for (const kind of ["till", "count", "waste"] as const) {
    assert.deepEqual(pick({ kind, scope: "marina" }), { id: "marina" }, kind);
    assert.deepEqual(pick({ kind, scope: ALL_BRANCHES }), { id: DEFAULT_BRANCH_ID }, kind);
    assert.deepEqual(pick({ kind, scope: "online" }), { id: DEFAULT_BRANCH_ID }, kind);
    assert.deepEqual(pick({ kind, scope: ALL_BRANCHES, requireExplicit: true }), { error: BRANCH_REQUIRED }, kind);
    assert.deepEqual(pick({ kind, scope: "online", requireExplicit: true }), { error: BRANCH_REQUIRED }, kind);
    // Tek kasa açıkken "Tümü" o kasadır
    assert.deepEqual(pick({ kind, scope: ALL_BRANCHES, known: ONLY_TUZLA, requireExplicit: true }), { id: DEFAULT_BRANCH_ID }, kind);
    assert.deepEqual(pick({ kind, scope: "marina", requireExplicit: true }), { id: "marina" }, kind);
  }
  // Satış: seçili şube; kanal seçiliyken red (ay "online" şubesine inmez)
  assert.deepEqual(pick({ kind: "sales", scope: "marina" }), { id: "marina" });
  assert.deepEqual(pick({ kind: "sales", scope: ALL_BRANCHES }), { id: DEFAULT_BRANCH_ID });
  assert.deepEqual(pick({ kind: "sales", scope: "online" }), { error: "laffogato.net kanalının kasa satışı yok; şube seçiciden şubeyi seçin" });
  assert.deepEqual(pick({ kind: "sales", scope: ALL_BRANCHES, requireExplicit: true }), { error: BRANCH_REQUIRED });
  assert.deepEqual(pick({ kind: "sales", scope: ALL_BRANCHES, known: ONLY_TUZLA, requireExplicit: true }), { id: DEFAULT_BRANCH_ID });
  // Gider: seçili şube, "Tümü"de işletme geneli (requireExplicit gideri etkilemez)
  assert.deepEqual(pick({ kind: "expense", scope: "marina" }), { id: "marina" });
  assert.deepEqual(pick({ kind: "expense", scope: "online" }), { id: "online" });
  assert.deepEqual(pick({ kind: "expense", scope: ALL_BRANCHES, requireExplicit: true }), { id: null });
});

test("kapsam shownScopeError: formun kapsamı seçimle tutmalı", () => {
  assert.equal(shownScopeError("marina", "marina"), null);
  assert.equal(shownScopeError(ALL_BRANCHES, ALL_BRANCHES), null);
  assert.equal(shownScopeError("marina", ALL_BRANCHES), SCOPE_CHANGED);
  assert.equal(shownScopeError(undefined, ALL_BRANCHES), SCOPE_CHANGED, "kapsamı göndermeyen eski sekme silemez");
  assert.equal(SCOPE_CHANGED, "Şube seçimi başka sekmede değişti; sayfayı yenileyin");
  assert.equal(zFormBranch.parse(undefined), undefined);
  assert.throws(() => zFormBranch.parse("x".repeat(25)));
});

test("form-sube ortak kapı: kasa ve sayım formBranch'ten geçer; zFormBranch tek yerde", () => {
  const scope = read("src/server/branch-scope.ts");
  assert.match(scope, /export async function formTillBranch\(raw: string \| null \| undefined\): Promise<string> \{\n\s*return formBranch\(raw, "till"\);/);
  assert.match(scope, /export async function formCountBranch\(raw: string \| null \| undefined\): Promise<string> \{\n\s*return formBranch\(raw, "count"\);/);
  assert.match(scope, /const picked = pickFormBranch\(\{ raw, kind, scope, known, lock, requireExplicit: opts\?\.requireExplicit \}\);/);
  for (const f of ["src/server/actions/stock.ts", "src/app/panel/sayim/actions.ts"]) {
    assert.match(read(f), /import \{ zFormBranch \} from "@\/lib\/branches";/, f);
    assert.doesNotMatch(read(f), /const zFormBranch =/, f);
  }
});

test("karaoke kitlesi: yönetici, şubesiz personel ve karaoke şubesinin personeli; e-posta planı yoksa yalnız personel", () => {
  assert.equal(karaokeBranchOf(BRANCHES), DEFAULT_BRANCH_ID, "sahibin varsayılanı: karaoke Tuzla'da");
  const users = [
    { id: 1, email: "y@x", role: "admin" as const, branchId: null },
    { id: 2, email: "a@x", role: "staff" as const, branchId: null },
    { id: 3, email: "t@x", role: "staff" as const, branchId: "tuzla" },
    { id: 4, email: "m@x", role: "staff" as const, branchId: "marina" },
    { id: 5, email: "ym@x", role: "admin" as const, branchId: "marina" },
  ];
  assert.deepEqual(karaokeAudience(users, "tuzla").map((u) => u.id), [1, 2, 3, 5]);
  assert.deepEqual(karaokeAudience(users, "marina").map((u) => u.id), [1, 2, 4, 5]);
  assert.deepEqual(karaokeAudience(users, null), [], "karaoke hiçbir şubede açık değil: kimse");
  assert.deepEqual(staffMailRecipients(users, [], "tuzla").map((u) => u.id), [2, 3], "karaoke şubesi");
  const mail = read("src/server/karaoke/staff-mail.ts");
  assert.doesNotMatch(mail, /DEFAULT_BRANCH_ID|KARAOKE_BRANCH_ID/);
  assert.match(mail, /const karaokeAt = await karaokeBranchId\(\);\n\s+if \(karaokeAt === null\) return none\(/);
  assert.match(mail, /eq\(s\.shifts\.branchId, branchId\)/);
  assert.match(mail, /staffMailRecipients\(users, onShift, karaokeAt\)/);
});
