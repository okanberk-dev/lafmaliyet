// Şube başına Paraşüt hesabı (docs/PARASUT.md › Şube başına Paraşüt hesabı): saf kurallar (src/lib/parasut/accounts.ts)
// ve kaynak denetimleri. Veritabanı tarafı tests/parasut-hesap-db.test.ts'te.
//
// - Hesap = kendi Paraşüt ayarı olan şube; "aynı" bağlı şube bağlandığının hesabını kullanır (satırı yoksa varsayılana
//   örtük bağlı): tek bağlantı, tek eşitleme.
// - Varsayılan hesap eski adları korur (parasut.token, p:<kimlik>), öbürleri hesap adıyla.
// - Ayrı hesabın faturaları o şubenin; ortak hesabınki işletme geneli.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { PARASUT_GROUP } from "../src/lib/branch-settings/groups";
import {
  accountNs,
  accountOfBranch,
  companyClash,
  DEFAULT_PARASUT_ACCOUNT,
  invoiceBranchOf,
  parasutAccounts,
  parasutKey,
  parseBillKey,
  parseInvoiceScope,
  qualifyBillKey,
} from "../src/lib/parasut/accounts";
import { billToDraft, productKeyFor } from "../src/server/parasut/mapping";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const TUZLA = { id: "tuzla", name: "Tuzla", kind: "fiziksel" as const, active: true, sortOrder: 1 };
const MARINA = { id: "marina", name: "Marina", kind: "fiziksel" as const, active: true, sortOrder: 2 };
const ONLINE = { id: "online", name: "Online", kind: "online" as const, active: true, sortOrder: 3 };
const BRANCHES = [TUZLA, MARINA, ONLINE];

test("anahtarlar: varsayılan hesap eski adları korur, öbürleri hesap adıyla", () => {
  assert.equal(DEFAULT_PARASUT_ACCOUNT, "tuzla");
  assert.equal(parasutKey("parasut.token", "tuzla"), "parasut.token");
  assert.equal(parasutKey("parasut.token", "marina"), "parasut.token:marina");
  assert.equal(accountNs("tuzla"), "");
  assert.equal(accountNs("marina"), "marina:");
  // Yok sayılan faturaların tek listesi: hesap önekli, eski kayıt varsayılan hesabın
  assert.equal(qualifyBillKey("tuzla", "123"), "123");
  assert.equal(qualifyBillKey("marina", "ei:9"), "marina/ei:9");
  assert.deepEqual(parseBillKey("marina/ei:9"), { account: "marina", key: "ei:9" });
  assert.deepEqual(parseBillKey("ei:9"), { account: "tuzla", key: "ei:9" });
  assert.deepEqual(parseBillKey("123"), { account: "tuzla", key: "123" });
});

test("şubenin hesabı: satırı yoksa varsayılana örtük bağlı; kendi ayarıysa kendisi; online kanal varsayılan", () => {
  assert.equal(accountOfBranch("marina", [], BRANCHES), "tuzla", "geçiş: Marina Tuzla'nın hesabını kullanır");
  assert.equal(accountOfBranch("tuzla", [], BRANCHES), "tuzla");
  assert.equal(accountOfBranch("online", [], BRANCHES), "tuzla");
  assert.equal(accountOfBranch(null, [], BRANCHES), "tuzla");
  const own = [{ branchId: "marina", sameAs: null }];
  assert.equal(accountOfBranch("marina", own, BRANCHES), "marina");
  assert.equal(accountOfBranch("marina", [{ branchId: "marina", sameAs: "tuzla" }], BRANCHES), "tuzla");
  // Bağlı olduğu şube kapandıysa değer varsayılandan okunur (zincir ya da döngü aranmaz)
  assert.equal(accountOfBranch("marina", [{ branchId: "marina", sameAs: "eski" }], [...BRANCHES, { id: "eski", name: "Eski", kind: "fiziksel" as const, active: false, sortOrder: 9 }]), "tuzla");
  assert.equal(PARASUT_GROUP.linkable, true);
  assert.deepEqual(PARASUT_GROUP.secretFields, [], "sır branch_settings'te değil, hesabın kaydında (şifreli)");
});

test("hesaplar: 'aynı' bağlı şubeler tek hesap (tek eşitleme), ayrı hesap ayrı eşitlenir", () => {
  assert.deepEqual(parasutAccounts([], BRANCHES), [{ id: "tuzla", name: "Tuzla", users: ["tuzla", "marina"] }]);
  assert.deepEqual(parasutAccounts([{ branchId: "marina", sameAs: null }], BRANCHES), [
    { id: "tuzla", name: "Tuzla", users: ["tuzla"] },
    { id: "marina", name: "Marina", users: ["marina"] },
  ]);
  // Varsayılan şube kapalı olsa da hesabı listede kalır (ortamla kurulmuş eşitleme durmaz)
  assert.deepEqual(parasutAccounts([], [{ ...TUZLA, active: false }, MARINA]), [{ id: "tuzla", name: "Tuzla", users: ["marina"] }]);
});

test("faturanın şubesi: ortak hesapta işletme geneli, ayrı hesapta o şube; 'shared' seçimiyle hep işletme geneli", () => {
  assert.equal(invoiceBranchOf({ id: "tuzla", users: ["tuzla", "marina"] }, "branch"), null, "bugünkü kural: ortak hesap");
  assert.equal(invoiceBranchOf({ id: "marina", users: ["marina"] }, "branch"), "marina");
  assert.equal(invoiceBranchOf({ id: "tuzla", users: ["tuzla"] }, "branch"), "tuzla", "iki şube ayrılınca Tuzla'nınki de Tuzla'nın");
  assert.equal(invoiceBranchOf({ id: "marina", users: ["marina"] }, "shared"), null);
  // Hesabı sahibi kullanmıyorsa (şube kapalı) şubeye yazılmaz
  assert.equal(invoiceBranchOf({ id: "tuzla", users: ["marina"] }, "branch"), null);
  assert.equal(parseInvoiceScope("shared"), "shared");
  assert.equal(parseInvoiceScope(undefined), "branch");
  assert.equal(parseInvoiceScope("x"), "branch");
});

test("aynı firma iki hesaba girilemez (faturalar çiftlenirdi)", () => {
  const others = [
    { id: "tuzla", name: "Tuzla", companyId: "424242" },
    { id: "marina", name: "Marina", companyId: null },
  ];
  assert.match(companyClash("marina", "424242", others) ?? "", /Tuzla şubesinin Paraşüt hesabında zaten bağlı/);
  assert.equal(companyClash("marina", "535353", others), null);
  assert.equal(companyClash("tuzla", "424242", others), null, "kendi firması");
  assert.equal(companyClash("marina", null, others), null);
});

test("kalem kimliği ve ürün anahtarı: varsayılan hesapta eski biçim, öbüründe hesap önekli", () => {
  assert.equal(productKeyFor("55", "Süt"), "p:55");
  assert.equal(productKeyFor("55", "Süt", "marina:"), "p:marina:55");
  assert.equal(productKeyFor(null, "Süt 1 L", "marina:"), productKeyFor(null, "Süt 1 L"), "ada dayalı anahtar firmadan bağımsız");
  const bill = {
    id: "7",
    type: "purchase_bills",
    attributes: { item_type: "purchase_bill", issue_date: "2026-11-01", gross_total: "100", net_total: "110", total_vat: "10", remaining: "0" },
    relationships: { details: { data: [{ id: "d1", type: "purchase_bill_details" }] } },
  };
  const included = [{ id: "d1", type: "purchase_bill_details", attributes: { quantity: "1", unit_price: "100" }, relationships: { product: { data: { id: "55", type: "products" } } } }, { id: "55", type: "products", attributes: { name: "Süt" } }];
  const tuzla = billToDraft(bill, included);
  const marina = billToDraft(bill, included, "marina:");
  assert.equal(tuzla.externalId, "7", "faturanın Paraşüt kimliği öneksiz (API'ye bununla gidilir)");
  assert.equal(marina.externalId, "7");
  assert.deepEqual([tuzla.lines[0].externalId, tuzla.lines[0].productKey], ["d1", "p:55"]);
  assert.deepEqual([marina.lines[0].externalId, marina.lines[0].productKey], ["marina:d1", "p:marina:55"]);
});

test("kaynak: eşitleme durumu hesap adıyla; sync.ts'te düz 'parasut.' anahtarı kalmaz", () => {
  const sync = read("src/server/parasut/sync.ts");
  assert.doesNotMatch(sync, /["'`]parasut\./, "anahtarlar keys.ts'te; sync.ts yalnız adlarını kullanır");
  // getState/setState: hesap başına anahtar ak(hesap, …) ile; hesapsız yalnız işletme geneli listeler
  const shared = new Set(["PRICE_KEY", "IGNORE_KEY", "PRODUCT_IGNORE_KEY"]);
  let checked = 0;
  for (const m of sync.matchAll(/(?:await getState(?:<[^>]*>)?|getState<[^>]*>|setState)\(([^,)]+)/g)) {
    const arg = m[1].trim();
    if (/^key\b/.test(arg)) continue;
    if (arg.startsWith("ak(")) {
      checked++;
      continue;
    }
    assert.ok(shared.has(arg), `hesapsız durum anahtarı: ${m[0]}`);
    checked++;
  }
  assert.ok(checked > 20, "tarama durum okumalarını buldu");
  // Bir hesabın eşitlemesi yalnız kendi faturalarını görür (kaldırır), yeni faturaya hesabı ve şubesi yazılır
  assert.match(sync, /\.where\(invoiceAccountWhere\(account\)\)/);
  assert.match(sync, /parasutAccount: ctx\.account,/);
  assert.equal(sync.match(/branchId: ctx\.invoiceBranch,/g)?.length, 2, "gider faturası ve e-fatura");
  assert.match(sync, /insert\(s\.parasutSyncRuns\)\.values\(\{ trigger, account \}\)/);
  // Kalemleri okuma ve vergi no tamamlama da istemcinin hesabıyla
  assert.match(read("src/server/parasut/lines.ts"), /pendingWhere\(client\.account\)/);
  assert.match(read("src/server/parasut/tax-backfill.ts"), /invoiceAccountWhere\(account\)/);
  // Cron işleri her farklı hesabı bir kez eşitler
  for (const f of ["src/app/api/cron/parasut/route.ts", "src/app/api/cron/gunluk/route.ts"]) {
    const route = read(f);
    assert.match(route, /syncParasutAccounts\("cron", \{ accounts,/, f);
    assert.doesNotMatch(route, /syncParasut\(/, f);
  }
});

test("kaynak: bağlanma isteği hesabı mühürlü taşır, dönüşte belirteç o hesaba yazılır", () => {
  const connect = read("src/server/parasut/connect.ts");
  assert.match(connect, /await writePending\(\{ state, verifier, redirectUri: cfg\.redirectUri, at: Date\.now\(\), by, account \}\);/);
  // Önce bekleyen istek (tek kullanımlık) ve state, sonra o hesabın ayarları
  const finish = connect.slice(connect.indexOf("export async function finishParasutConnect"));
  assert.ok(finish.indexOf("takePending()") < finish.indexOf("readParasutConfig(account)"), "hesap bekleyen istekten");
  assert.ok(finish.indexOf("sameToken(input.state, pending.state)") < finish.indexOf("readParasutConfig(account)"));
  assert.match(finish, /await isAccount\(account\)/, "hesap bu arada geçersizleştiyse reddedilir");
  const start = read("src/app/panel/parasut/baglan/route.ts");
  assert.match(start, /searchParams\.get\("hesap"\)/);
  assert.match(start, /isParasutAccount\(account\)/, "adresteki hesap sunucuda doğrulanır");
  assert.match(read("src/app/panel/parasut/baglan/geri/route.ts"), /finishParasutConnect\([\s\S]{0,120}isParasutAccount\(a\)/);
  // Oturum hesap adıyla; kilit hesap başına
  const client = read("src/server/parasut/client.ts");
  assert.match(client, /parasutKey\(TOKEN_KEY, account\)/);
  assert.match(client, /tx\.execute\(tokenLock\(this\.cfg\.account\)\)/);
  // Ortam değişkenleri yalnız varsayılan hesabın yedeği
  assert.match(read("src/server/parasut/config.ts"), /envOf = \(account: string\)[^\n]*account === DEFAULT_PARASUT_ACCOUNT \? process\.env : \{\}/);
});

test("kaynak: eylemler hesabı sunucuda doğrular; 'aynı' açılmadan önce hesap temizlenir", () => {
  const actions = read("src/server/actions/parasut.ts");
  for (const fn of ["testParasutConnection", "runParasutSync", "readParasutLines", "disconnectParasut", "saveParasutSettings", "setParasutInvoiceScope"]) {
    const body = actions.slice(actions.indexOf(`export async function ${fn}(`));
    assert.match(body.slice(0, 800), /parasutAccountInput\(accountRaw\)/, fn);
  }
  assert.match(actions, /companyClash\(account, plan\.after\.companyId\.value, others\)/);
  const link = read("src/server/actions/branch-settings.ts");
  assert.match(link, /if \(group\.id === PARASUT_GROUP\.id\) await beforeParasutLink\(tx, d\.branchId\);\s*await linkBranchSetting/);
});
