// Tedarikçiye kasadan ödemenin yeni Teslim satırı hangi şubenin kasasına yazılır (denetim 21 Kasım #31; docs/SUBE.md
// › Yazarken hangi şube, docs/TEDARIKCILER.md › Ödeme ekle): pencerede seçilen kasa; varsayılanı seçili fiziksel şube,
// "Tümü" ya da online kanalda birden çok kasa açıksa varsayılan yok ve seçimsiz kayıt reddedilir. Önceden satır
// sessizce Tuzla'nın kasasına iniyordu. Kurallar saf (src/lib/branches.ts defaultTill, chooseTill); eylem ve pencereler
// kaynaktan denetlenir. Gerçek veritabanında: tests/cari-db.test.ts ("Kasadan yeni satır").
// Çalıştırma: npx tsx --test tests/cari-kasa-sube.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ALL_BRANCHES, chooseTill, DEFAULT_BRANCH_ID, defaultTill, ONLINE_BRANCH_ID, TILL_REQUIRED, type BranchRow } from "../src/lib/branches";

const row = (p: Partial<BranchRow> & { id: string }): BranchRow => ({ name: p.id, kind: "fiziksel", posSource: "modpos", active: true, openedOn: null, sortOrder: 1, ...p });
const TUZLA = row({ id: DEFAULT_BRANCH_ID, name: "Tuzla", sortOrder: 1 });
const MARINA = row({ id: "marina", name: "Marina", sortOrder: 2 });
const ONLINE = row({ id: ONLINE_BRANCH_ID, name: "laffogato.net", kind: "online", posSource: "yok", sortOrder: 3 });
const IKI = [TUZLA, MARINA, ONLINE];
const TEK = [TUZLA, { ...MARINA, active: false }, ONLINE];

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

test("defaultTill: seçili fiziksel şube; 'Tümü' ya da online kanalda iki kasa açıksa varsayılan yok", () => {
  assert.equal(defaultTill("marina", IKI), "marina");
  assert.equal(defaultTill(DEFAULT_BRANCH_ID, IKI), DEFAULT_BRANCH_ID);
  assert.equal(defaultTill(ALL_BRANCHES, IKI), null, "Tümü: Tuzla'ya sessizce inmez");
  assert.equal(defaultTill(ONLINE_BRANCH_ID, IKI), null, "online kanalın kasası yok");
  // Tek kasa açıkken belirsizlik yok (Marina kapalı): Tuzla
  assert.equal(defaultTill(ALL_BRANCHES, TEK), DEFAULT_BRANCH_ID);
  assert.equal(defaultTill(ONLINE_BRANCH_ID, TEK), DEFAULT_BRANCH_ID);
});

test("chooseTill: seçilen kasa etkin fiziksel şube olmalı; seçimsiz kayıt belirsizse reddedilir", () => {
  assert.deepEqual(chooseTill("marina", ALL_BRANCHES, IKI), { id: "marina" });
  assert.deepEqual(chooseTill(DEFAULT_BRANCH_ID, "marina", IKI), { id: DEFAULT_BRANCH_ID }, "pencerenin seçimi soldaki seçimden önce gelir");
  assert.deepEqual(chooseTill(null, ALL_BRANCHES, IKI), { error: TILL_REQUIRED });
  assert.deepEqual(chooseTill(undefined, ONLINE_BRANCH_ID, IKI), { error: TILL_REQUIRED });
  assert.deepEqual(chooseTill("", ALL_BRANCHES, IKI), { error: TILL_REQUIRED });
  assert.deepEqual(chooseTill(null, "marina", IKI), { id: "marina" });
  assert.deepEqual(chooseTill(null, ALL_BRANCHES, TEK), { id: DEFAULT_BRANCH_ID });
  for (const bad of [ONLINE_BRANCH_ID, "yok-boyle", ALL_BRANCHES]) assert.ok("error" in chooseTill(bad, ALL_BRANCHES, IKI), bad);
  assert.ok("error" in chooseTill("marina", ALL_BRANCHES, TEK), "kapalı şubenin kasasına yazılmaz");
});

test("writePayment yeni Teslim satırını chooseTill'in kasasına yazar; currentTillBranch'a (Tümü → Tuzla) düşmez", () => {
  const src = read("src/server/cari/entries.ts");
  const fn = src.slice(src.indexOf("export async function writePayment("));
  assert.doesNotMatch(src, /currentTillBranch/);
  assert.match(fn, /const till = chooseTill\(choice\.branchId, await currentBranchScope\(\), await listBranches\(\)\);\n\s+if \("error" in till\) throw new UserError\(till\.error\);/);
  assert.match(fn, /\.insert\(s\.cashOuts\)\n\s+\.values\(\{ date: input\.date, kind: "teslim", [^\n]*branchId: till\.id,/);
  // Eylemin şeması seçimi taşır
  assert.match(read("src/server/actions/cari.ts"), /z\.object\(\{ mode: z\.literal\("new"\), branchId: z\.string\(\)\.trim\(\)\.max\(24\)\.nullish\(\) \}\)/);
});

test("pencereler kasayı sorar ve gönderir: Ödeme ekle ve Borç ekle › Ödendi › Kasadan", () => {
  const pay = read("src/app/panel/tedarikciler/cari-payment-dialog.tsx");
  assert.match(pay, /const \[till, setTill\] = useState<string \| null>\(tills\.defaultId\);/);
  assert.match(pay, /line === "new" && !till\) return void setError\(TILL_REQUIRED\);/);
  assert.match(pay, /line === "new" \? \{ mode: "new" as const, branchId: till \}/);
  // Birden çok kasa açıkken yeni satırın kasası seçilir ve var olan satırlar kasasının şubesini yazar
  assert.match(pay, /value === "new" && many \?/);
  assert.match(pay, /many \? `\$\{l\.branch\} kasası` : ""/);
  const debt = read("src/app/panel/tedarikciler/[cari]/debt-dialog.tsx");
  assert.match(debt, /const \[till, setTill\] = useState<string \| null>\(tills\.defaultId\);/);
  assert.match(debt, /line === "new" && !till\) return void setError\(TILL_REQUIRED\);/);
  assert.match(debt, /line === "new" \? \{ mode: "new", branchId: till \}/);
  for (const src of [pay, debt]) assert.match(src, /tills=\{tills\}\n\s+till=\{till\}\n\s+onTill=\{setTill\}/);
  // Sayfa seçeneklerini ve varsayılanı sunucuda kurar; Kasa satırları şubeleriyle okunur
  assert.match(read("src/app/panel/tedarikciler/[cari]/page.tsx"), /tills: \{ options: tillBranches\(branches\)\.map\(\(b\) => \(\{ id: b\.id, name: b\.name \}\)\), defaultId: defaultTill\(scope, branches\) \}/);
  const client = read("src/app/panel/tedarikciler/[cari]/supplier-client.tsx");
  assert.equal([...client.matchAll(/tills=\{cari\.tills\}/g)].length, 2);
  const options = read("src/server/actions/cari-options.ts");
  assert.match(options, /branchId: s\.cashOuts\.branchId,/);
  assert.match(options, /branch: branchName\.get\(branchId\) \?\? branchId,/);
});
