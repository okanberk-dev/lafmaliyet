// Sayım formu ve şube (21 Kasım 2026 denetiminin "Sonraki işler"i; docs/SUBE.md › Yazarken hangi şube, Seçici):
//
// sayim-sube    Stok sayımı, "Listede olmayanlar" ve "Listeye ekle" formun gösterdiği şubeyi gönderir; sunucu onu
//               doğrular (etkin fiziksel şube; şubesine kilitli personelde kendi şubesi) ve yazımı o şubenin kapsamında
//               çalıştırır. Gönderim anındaki çerez (başka sekmede değişmiş olabilir) yazımın şubesini seçmez; şubeyi
//               göndermeyen eski sekme bugünkü gibi seçili fiziksel şubeye yazar. Kasa formlarının (#12) karşılığı.
// secici-uyari  Kaydedilmemiş sayım varken kenar çubuğunun şube seçicisi önce sorar (ortak çıkış koruması); "Kaydetmeden
//               geç" `?sube=` bağlantısıyla geçer, seçici onu çereze benimsetir.
// z-boyut       Yazarkasa Z'sinin büyüklük denetimi (son 28 günün ortancası) kasanın şubesinin toplamlarıyla.
//
// Veritabanı tarafı: tests/sayim-db.test.ts › "sayım formun gösterdiği şubeye yazılır…".
// Çalıştırma: npx tsx --test tests/sayim-sube-form.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { branchLinkStep, DEFAULT_BRANCHES, formCountError, formTillError, type BranchRow } from "../src/lib/branches";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** Kaynaktaki işlevin gövdesi (bir sonraki dışa açık işleve kadar) */
const fnBody = (src: string, name: string) => {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, name);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
};

const BRANCHES: BranchRow[] = DEFAULT_BRANCHES.map((b) => ({ ...b, active: true }));
const ONLY_TUZLA: BranchRow[] = BRANCHES.map((b) => (b.id === "marina" ? { ...b, active: false } : b));

test("sayim-sube formCountError: sayım etkin fiziksel şubeye; kilitli personel yalnız kendi şubesine", () => {
  assert.equal(formCountError("tuzla", BRANCHES, null), null);
  assert.equal(formCountError("marina", BRANCHES, null), null);
  assert.equal(formCountError("marina", BRANCHES, "marina"), null);
  assert.equal(formCountError("online", BRANCHES, null), "laffogato.net kanalının stoğu olmaz; sayfayı yenileyin");
  assert.equal(formCountError("yok", BRANCHES, null), "Formun şubesi bulunamadı ya da kapalı; sayfayı yenileyin");
  assert.equal(formCountError("marina", ONLY_TUZLA, null), "Formun şubesi bulunamadı ya da kapalı; sayfayı yenileyin");
  assert.equal(formCountError("marina", BRANCHES, "tuzla"), "Hesabınız Tuzla şubesinde; Marina sayımına yazamazsınız");
  // Kasa formlarının metni değişmedi (ortak kural)
  assert.equal(formTillError("online", BRANCHES, null), "laffogato.net kanalının kasası olmaz; sayfayı yenileyin");
  assert.equal(formTillError("marina", BRANCHES, "tuzla"), "Hesabınız Tuzla şubesinde; Marina kasasına yazamazsınız");
});

test("sayim-sube formCountBranch: kimlik yoksa seçili fiziksel şube, varsa doğrulanır (kilit dahil)", () => {
  const fn = fnBody(read("src/server/branch-scope.ts"), "formCountBranch");
  // Ortak kapı (formBranch; kural tablosu tests/form-sube.test.ts): kimlik yoksa seçili fiziksel şube, kilit dahil
  assert.match(fn, /return formBranch\(raw, "count"\);/);
});

test("sayim-sube kayıtlar formun şubesinin kapsamında: sayım, ek kalemler (yönetici, personel), Listeye ekle", () => {
  const stock = read("src/server/actions/stock.ts");
  for (const name of ["saveStockCounts", "saveStockExtras"]) {
    const fn = fnBody(stock, name);
    assert.match(fn, /branchId\?: string \| null,?\s*\) \{/, `${name}: şube son parametre (eski sekme göndermez)`);
    assert.match(fn, /const sube = await formCountBranch\(zFormBranch\.parse\(branchId\)\);\n\s*return withBranchScope\(sube, async \(\) => \{/, name);
  }
  assert.doesNotMatch(stock, /currentPhysicalBranch/, "yazım çerezin şubesini okumaz");
  const actions = read("src/app/panel/sayim/actions.ts");
  const staff = fnBody(actions, "saveStaffStockExtras");
  assert.match(staff, /base\?: string, branchId\?: string \| null\)/);
  assert.match(staff, /const sube = await formCountBranch\(zFormBranch\.parse\(branchId\)\);\n\s*return withBranchScope\(sube, async \(\) => \{/);
  const add = fnBody(actions, "addCountItem");
  assert.match(add, /const \{ branchId, \.\.\.data \} = addSchema\.parse\(input\);/);
  assert.match(add, /withBranchScope\(sube, \(\) => createCountItem\(me, data, "sayim"\)\)/);
  assert.doesNotMatch(actions, /currentPhysicalBranch/);
});

test("sayim-sube form gösterdiği şubeyi gönderir; sayfa şubeyi forma koyar, form anahtarı şubeyi taşır", () => {
  const page = read("src/app/panel/sayim/page.tsx");
  assert.match(page, /key=\{`\$\{branch\.id\}:\$\{month\}`\}\s+branchId=\{branch\.id\}/);
  const form = read("src/app/panel/sayim/stock-form.tsx");
  assert.match(form, /saveStockCounts\(\s*month,\s*changedLines\.map\([^\n]*\),\s*branchId,\s*\)/);
  assert.match(form, /saveStockExtras\(\s*month,\s*clean\.map\([^\n]*\),\s*base,\s*branchId,\s*\)/);
  assert.match(form, /saveStaffStockExtras\(month, clean, base, branchId\)/);
  assert.match(form, /<AddCountItemDialog\s+isAdmin=\{isAdmin\}\s+branchId=\{branchId\}/);
  assert.match(read("src/app/panel/sayim/add-item.tsx"), /addCountItem\(\{ month, branchId, \.\.\.values \}\)/);
});

test("secici-uyari şube seçici kaydedilmemiş sayımda önce sorar; 'Kaydetmeden geç' ?sube= ile geçer", () => {
  const picker = read("src/components/panel/branch-picker.tsx");
  const onChange = picker.slice(picker.indexOf("onChange={(e) => {"));
  // Olay iptal edilirse seçim yapılmaz, seçici yerinde kalır; edilmezse bugünkü gibi
  assert.match(
    onChange,
    /q\.set\(BRANCH_PARAM, secim\);\s*if \(!window\.dispatchEvent\(new CustomEvent\(BRANCH_LEAVE, \{ cancelable: true, detail: `\$\{pathname\}\?\$\{q\}` \}\)\)\) \{\s*e\.target\.value = scope;\s*return;\s*\}\s*run\(\(\) => chooseBranchScope\(\{ scope: secim \}\), \{ maybeSaved: true \}\);/,
  );
  // Form olayı ortak kancaya verir; kanca verilen her olayı dinler
  assert.match(read("src/app/panel/sayim/stock-form.tsx"), /useLeaveGuard\(dirty, MONTH_LEAVE, BRANCH_LEAVE\)/);
  const guard = read("src/components/ui/leave-guard.ts");
  assert.match(guard, /export const BRANCH_LEAVE = "panel:sube";/);
  assert.match(guard, /for \(const name of names\) window\.addEventListener\(name, onEvent\);/);
  assert.match(guard, /for \(const name of names\) window\.removeEventListener\(name, onEvent\);/);
  // Şube değişince baştan kurulmayan form (vergi sınıflandırması) seçiciyi durdurmaz
  assert.match(read("src/app/panel/vergi/gelir-gider/classify-list.tsx"), /useLeaveGuard\(dirty\.length > 0\);/);
  // Onay penceresinin adresi seçimi yapar: seçici ?sube='yi çereze benimsetir ve adresten düşürür (ay kalır)
  const step = branchLinkStep({ pathname: "/panel/sayim", search: "ay=2026-11&sube=marina", scope: "tuzla", branches: BRANCHES, locked: false, adopted: null });
  assert.deepEqual(step.adopt, { scope: "marina", href: "/panel/sayim?ay=2026-11" });
  const all = branchLinkStep({ pathname: "/panel/sayim", search: "ay=2026-11&sube=hepsi", scope: "marina", branches: BRANCHES, locked: false, adopted: null });
  assert.deepEqual(all.adopt, { scope: "hepsi", href: "/panel/sayim?ay=2026-11" });
});

test("z-boyut yazarkasa Z'sinin büyüklük denetimi kasanın şubesinin 28 gününe bakar (previousZNo gibi)", () => {
  const photo = read("src/server/photo-read/read.ts");
  const typical = photo.slice(photo.indexOf("async function okcTypical"), photo.indexOf("async function recentReceipts"));
  assert.match(typical, /\.where\(and\(gte\(s\.cashReports\.date, addDays\(day, -28\)\), lt\(s\.cashReports\.date, day\), eq\(s\.cashReports\.branchId, await currentTillBranch\(\)\)\)\);/);
});
