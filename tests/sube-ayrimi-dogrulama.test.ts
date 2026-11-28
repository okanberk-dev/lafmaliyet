// Şube ayrımının doğrulama düzeltmeleri (27 Kasım 2026; docs/SUBE.md › Şube ayrımı › Doğrulama düzeltmeleri): bağımsız
// doğrulamanın (tests/sube-ayrimi-db.test.ts) bulduğu sekiz sızıntı. Saf kurallar (sabah e-postasının şube grubu, öbür
// şubenin yeni ürün önerisi) ve kaynağın biçimi (ekranlar seçimle okur). Mutabakat'ın iki düzeltmesi (POS'un şube
// karoları, ekstre yükleme penceresi) bölümle kalktı (28 Kasım 2026). Gerçek Postgres'teki sınama doğrulamanın kendisi.
// Çalıştırma: npx tsx --test tests/sube-ayrimi-dogrulama.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { pendingProposalIssue } from "../src/lib/recipe-change";
import { groupInvoiceSection, type DigestInvoiceRefs, type DigestInvoices } from "../src/server/notify/digest-template";

const root = join(__dirname, "..");
const read = (f: string) => readFileSync(join(root, f), "utf8");

// ---------------------------------------------------------------- Sabah e-postası: şube grubunun fatura bölümü

const item = (supplier: string) => ({ supplier, date: "2026-11-26", payable: 100, category: "Gıda", needsReview: false });
const SECTION: DigestInvoices = {
  items: [item("Marina Kahve"), item("TZMARK Gıda"), item("Ortak Muhasebe"), item("Şubesiz Fatura")],
  reviewCount: 4,
  stockOnlyCount: 2,
  syncError: "hesabın hatası",
  priceHolds: { count: 3, fresh: 2, items: [] },
};
const REFS: DigestInvoiceRefs = {
  items: [
    { branchId: "marina", companyWide: false },
    { branchId: "tuzla", companyWide: false },
    { branchId: null, companyWide: true },
    { branchId: null, companyWide: false },
  ],
  review: [
    { branchId: "marina", companyWide: false, stockOnly: true },
    { branchId: "tuzla", companyWide: false, stockOnly: true },
    { branchId: "tuzla", companyWide: false, stockOnly: false },
    { branchId: null, companyWide: true, stockOnly: false },
  ],
  holds: [
    { name: "Süt", pct: 0.5, branch: "marina", fresh: true },
    { name: "TZMARK Un", pct: 0.6, branch: "tuzla", fresh: true },
    { name: "Şeker", pct: null, branch: null, fresh: false },
  ],
};

test("sabah e-postası: şube grubu yalnız kendi ve işletme genelinin faturalarını, önerilerini ve sayılarını alır", () => {
  const g = groupInvoiceSection(SECTION, REFS, ["marina"]);
  assert.deepEqual(
    g.items.map((i) => i.supplier),
    ["Marina Kahve", "Ortak Muhasebe", "Şubesiz Fatura"],
    "öbür şubenin faturası yok; işletme geneli ve şubesi seçilmemiş her gruba (ödemelerin kuralı)",
  );
  assert.equal(g.reviewCount, 2, "kontrol bekleyen: şubenin ve işletme genelinin");
  assert.equal(g.stockOnlyCount, 1);
  assert.deepEqual(g.priceHolds, { count: 2, fresh: 1, items: [{ name: "Süt", pct: 0.5 }, { name: "Şeker", pct: null }] }, "öbür şubenin faturasından gelen öneri yok");
  assert.equal(g.syncError, "hesabın hatası", "eşitleme hatası hesabın: her grupta");
  assert.equal(JSON.stringify(g).includes("TZMARK"), false);
});

test("sabah e-postası: bütün şubelerin grubu (boş) ve birden çok şubeli grup", () => {
  assert.equal(groupInvoiceSection(SECTION, REFS, []), SECTION, "firmaya giden e-posta olduğu gibi");
  const both = groupInvoiceSection(SECTION, REFS, ["marina", "tuzla"]);
  assert.equal(both.items.length, 4);
  assert.equal(both.reviewCount, 4);
  assert.equal(both.priceHolds?.count, 3);
  const none = groupInvoiceSection({ ...SECTION, priceHolds: null }, { ...REFS, holds: [] }, ["kadikoy"]);
  assert.equal(none.priceHolds, null, "önerisi olmayan grubun satırı yok");
  assert.equal(none.reviewCount, 1, "yalnız işletme geneli");
});

test("kaynak: gönderim ve önizleme grubun bölümünü kurar, grubun fatura haberi kendi bölümünden", () => {
  const digest = read("src/server/notify/digest.ts");
  assert.match(digest, /const groupInvoices = groupDigestInvoices\(invoiceLoad, g\.branchIds\);/);
  assert.match(digest, /\.\.\.groupInvoiceSection\(invoices, refs, branchIds\),/);
  assert.match(digest, /\.\.\.\(g\.invoiceNews \? \[\["inv", /);
  // Sabah e-postası firmanın okumasıyla kalır: öneriler kapsamsız okunur, grup süzer
  assert.match(digest, /pendingHoldSummary\(\)/);
  assert.match(read("src/server/actions/reminders.ts"), /loadDigestInvoices\(\)\.then\(\(r\) => \(\{ invoices: groupDigestInvoices\(r, group \? \[group\.id\] : \[\]\) \}\)\),/);
});

// ---------------------------------------------------------------- Yeni ürün önerileri

test("yeni ürün önerisi: öbür şubenin önerisi denetimde engeller, önereni yazılmaz", () => {
  const pending = [
    { name: "Çilekli Latte", size: "M" as const, by: "Ayşe" },
    { name: "Fıstıklı Latte", size: "M" as const, by: null },
  ];
  assert.match(pendingProposalIssue("çilekli latte", ["M"], pending, "önce karar verin") ?? "", /Ayşe'nin bekleyen yeni ürün önerisi var: önce karar verin$/);
  const other = pendingProposalIssue("Fıstıklı Latte", ["M"], pending, "önce karar verin");
  assert.equal(other, "“Fıstıklı Latte · Medium” için öbür şubede bekleyen yeni ürün önerisi var (Tümü'de görünür): önce karar verin");
  assert.equal(pendingProposalIssue("Fıstıklı Latte", ["L"], pending, "x"), null);
});

test("kaynak: ekranlar önerileri önerenin şubesiyle, eylemler bütün şubelerle (adsız) okur", () => {
  assert.match(read("src/app/panel/receteler/page.tsx"), /isAdmin \? Promise\.resolve\(\[\]\) : currentBranchScope\(\)\.then\(\(scope\) => pendingNewProposals\(scope\)\),/);
  assert.match(read("src/app/panel/urunler/site/page.tsx"), /currentBranchScope\(\)\.then\(\(scope\) => pendingNewProposalRows\(getDb\(\), scope\)\),/);
  assert.match(read("src/server/actions/products.ts"), /await pendingNewProposalRows\(tx, scope, "adsiz"\)/);
  assert.match(read("src/server/site-menu/link.ts"), /await pendingNewProposalRows\(tx, scope, "adsiz"\)/);
  const data = read("src/server/data/recipe-requests.ts");
  assert.match(data, /\.leftJoin\(s\.users, eq\(s\.users\.id, s\.recipeChangeRequests\.requestedBy\)\)/);
  assert.match(data, /const mine = \(r: \(typeof rows\)\[number\]\) => scope === ALL_BRANCHES \|\| r\.requestedBy === null \|\| !r\.branchId \|\| r\.branchId === scope;/);
});

// ---------------------------------------------------------------- Faturalar, Maaşlar, Kullanıcılar

test("kaynak: Faturalar'ın cari bağları, Maaşlar'ın seçicisi ve Kullanıcılar seçimle (Mutabakat'ın yükleme penceresi bölümle kalktı)", () => {
  const cari = read("src/server/data/cari.ts");
  const links = cari.slice(cari.indexOf("export async function loadInvoiceCariLinks"), cari.indexOf("/** Kasa'da yöneticinin satır ipucu"));
  assert.match(links, /const shown = invoiceScopeWhere\(scope \?\? \(await currentBranchScope\(\)\)\);/);
  assert.equal(links.match(/\.innerJoin\(s\.invoices, /g)?.length, 2, "iki okuma da faturanın şubesiyle");

  const staff = read("src/server/data/staff-links.ts");
  assert.match(staff, /\.where\(sc === ALL_BRANCHES \? undefined : or\(isNull\(s\.users\.branchId\), eq\(s\.users\.branchId, sc\)\)\)/);
  assert.match(staff, /\.where\(and\(like\(s\.shifts\.personRef, "n:%"\), branchWhere\(s\.shifts\.branchId, sc\)\)\)/);

  const users = read("src/app/panel/kullanicilar/page.tsx");
  assert.match(users, /loadUserRows\(scope\),/);
  assert.doesNotMatch(users, /\.from\(s\.users\)/, "hesap listesi sayfada değil, yükleyicide (doğrulama okuyabilsin)");
  assert.match(read("src/server/data/users.ts"), /\.where\(scope === ALL_BRANCHES \? undefined : or\(isNull\(u\.branchId\), eq\(u\.branchId, scope\)\)\)/);

});
