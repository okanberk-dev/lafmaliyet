// Cari hesabın kaynak taramaları (docs/planlar: cari §9): dağıtım ve saklanan toplam yalnız src/server/cari/settle.ts'te
// yazılır; "Ödenmedi" engeli dört yazıcıda; fatura silinmeden önce bağlar çözülür; kalan kuralının kopyası yok; kaydı
// olan kart silinmez; cari eylemleri (varsa) yalnız yöneticiye açık ve dosyada yardımcı dışa aktarım yok.
// Çalıştırma: npx tsx --test tests/cari-guvenlik.test.ts

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const SETTLE = "src/server/cari/settle.ts";

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, dir))) {
    const p = join(dir, name);
    if (statSync(join(root, p)).isDirectory()) out.push(...files(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const sources = [...files("src"), ...files("scripts")].map((p) => ({ path: relative(root, join(root, p)), text: read(p) }));

/** Bir fonksiyonun gövdesi (başlangıcından bir sonraki üst düzey tanıma kadar) */
function body(text: string, start: string): string {
  const i = text.indexOf(start);
  assert.ok(i >= 0, `${start} bulunamadı`);
  const rest = text.slice(i + start.length);
  const next = rest.search(/\n(export )?(async )?function |\nconst |\ntype |\nexport (type|const|interface) /);
  return start + (next < 0 ? rest : rest.slice(0, next));
}

test("dağıtım (supplier_allocations) ve saklanan toplam (invoices.allocated) yalnız settle.ts'te yazılır", () => {
  for (const f of sources) {
    if (f.path === SETTLE) continue;
    assert.doesNotMatch(f.text, /\.(insert|update|delete)\(s\.supplierAllocations\)/, `${f.path}: supplier_allocations'a yazıyor`);
    for (const m of f.text.matchAll(/\ballocated\s*:\s*([^,}\n]+)/g)) {
      assert.match(m[1].trim(), /^(s\.invoices\.allocated|i\.allocated|inv\.allocated|doublePrecision\("allocated"\)\.notNull\(\)\.default\(0\))$/, `${f.path}: allocated yazımı (${m[0]})`);
    }
    // Saf kural (src/lib/cari) yamayı üretir, yalnız settle.ts uygular
    if (f.path.startsWith("src/lib/cari/")) continue;
    assert.doesNotMatch(f.text, /paidByLedger:\s*true/, `${f.path}: defterin kapattığı işaretini yalnız settle.ts koyar`);
    assert.doesNotMatch(f.text, /\b(trackingBase|arrivalBase)\(/, `${f.path}: takip tabanını yalnız settle.ts yazar`);
  }
  const settle = read(SETTLE);
  assert.doesNotMatch(settle, /^"use server"/m, "settle.ts eylem dosyası değil (her export bir POST ucu olurdu)");
  assert.match(settle, /^import "server-only";/);
});

test("'Ödenmedi' engeli dört yazıcıda: applyPayment, saveInvoice, restoreInvoicePayment, undoRecentPaid", () => {
  const inv = read("src/server/actions/invoices.ts");
  assert.match(body(inv, "async function applyPayment("), /if \(!paid\) await assertNotCovered\(db, targets\.map/);
  assert.match(body(inv, "export async function saveInvoice("), /if \(!cur\.unpaid && data\.unpaid\) await assertNotCovered\(db, \[id\]\)/);
  const restore = body(inv, "export async function restoreInvoicePayment(");
  assert.ok(restore.indexOf("dropAllocations(") < restore.indexOf("assertNotCovered("), "önce ✓'nin dağıtımları silinir");
  assert.ok(restore.indexOf("assertNotCovered(") < restore.indexOf(".update(s.invoices)"), "sonra engel, sonra yazım");
  const rem = read("src/server/actions/reminders.ts");
  const undo = body(rem, "export async function undoRecentPaid(");
  assert.ok(undo.indexOf("dropAllocations(") >= 0 && undo.indexOf("dropAllocations(") < undo.indexOf("assertNotCovered(db, [rid])"));
  assert.ok(undo.indexOf("assertNotCovered(db, [rid])") < undo.indexOf(".update(s.invoices)"));
  // Kullanıcının yazdığı ödeme alanları faturayı "defterin kapattığı" saymaz; pencerenin her kayıtta gönderdiği aynı
  // ödeme günü işareti bozmaz. "Geri al" defterin kapattığı faturayı settle.ts'e yeniden kapattırır
  assert.match(body(inv, "async function applyPayment("), /paidByLedger: false/);
  assert.match(body(inv, "export async function saveInvoice("), /const userPaid = cur\.unpaid !== data\.unpaid \|\| \("paidAt" in written && written\.paidAt !== cur\.paidAt\);/);
  assert.ok(restore.indexOf(".update(s.invoices)") < restore.indexOf("await resettleInvoices(ledger)"));
});

test("fatura silinmeden önce cari bağları aynı işlemde çözülür: elle silme, Paraşüt iptali, e-fatura yolu", () => {
  const inv = body(read("src/server/actions/invoices.ts"), "export async function deleteInvoice(");
  assert.ok(inv.indexOf("releaseInvoiceLinks(tx") >= 0 && inv.indexOf("releaseInvoiceLinks(tx") < inv.indexOf("tx.delete(s.invoices)"));
  const sync = read("src/server/parasut/sync.ts");
  const helper = body(sync, "async function deleteWithLinks(");
  const deletes = [...sync.matchAll(/\.delete\(s\.invoices\)/g)];
  assert.equal(deletes.length, [...helper.matchAll(/\.delete\(s\.invoices\)/g)].length, "sync.ts faturayı yalnız deleteWithLinks'te siler");
  assert.ok(helper.indexOf("releaseInvoiceLinks(tx") < helper.indexOf("tx.delete(s.invoices)"));
  assert.equal([...sync.matchAll(/await deleteWithLinks\(match\)/g)].length, 2, "retire ve e-fatura yolu");
  // Eşitleme yeni satırın takip tabanını yazar, var olan satırın cari sütunlarına dokunmaz
  const common = sync.slice(sync.indexOf("const common = {"), sync.indexOf("let invoiceId: number;"));
  assert.doesNotMatch(common, /allocated|ledgerBase|paidByLedger/);
  assert.match(sync, /const cari = await cariFinalSteps\(ctx\);[\s\S]*cari,\n\s+partial \|\| \(eStats/);
});

test("kalan kuralı tek yerde (K3): src/lib/cari dışında Paraşüt'ün kalanıyla Ödenecek arasında seçen kopya yok", () => {
  for (const f of sources) {
    if (f.path.startsWith("src/lib/cari/")) continue;
    assert.doesNotMatch(f.text, /outstanding\s*>\s*0/, `${f.path}: kalan kuralının kopyası (openBalance kullanın)`);
  }
  // Ödemeler, zil, sabah e-postası, nakit planı ve haftalık özet faturanın kalanını aynı kalemden okur
  assert.match(read("src/lib/reminders.ts"), /amount: openBalance\(\{ \.\.\.inv, unpaid: true \}\)/);
  assert.match(read("src/server/weekly/collect.ts"), /loadUpcoming\(ctx\.today\)/);
  const digest = body(read("src/server/notify/digest.ts"), "export async function loadUpcoming(");
  assert.match(digest, /allocated: s\.invoices\.allocated,\s*ledgerBase: s\.invoices\.ledgerBase,/);
});

test("cari kaydı olan kart silinmez (K23): listeden kaldırma ve geri alma kartı yalnız kayıt yokken siler", () => {
  const sup = read("src/server/actions/suppliers.ts");
  assert.match(body(sup, "export async function removeSupplier("), /if \(!g\.invoices\.length && !hasEntries\) \{/);
  const unhide = body(sup, "export async function unhideSupplier(");
  assert.match(unhide, /\.from\(s\.supplierEntries\)\.where\(eq\(s\.supplierEntries\.supplierId, id\)\)/);
  assert.match(unhide, /const drop = !hasInfo\(row\) && !entry;/);
});

test("borcun gider kaydı Aylık harcamalar'da kilitli: tutar, gün ve kategori değişmez, kayıt silinmez", () => {
  const exp = read("src/server/actions/expenses.ts");
  const save = body(exp, "export async function saveExpenseEntry(");
  assert.match(save, /if \(prev\?\.supplierEntryId && \(Math\.abs\(prev\.amount - data\.amount\) >= 0\.005 \|\| prev\.date !== data\.date \|\| prev\.categoryId !== data\.categoryId\)\)/);
  assert.match(save, /faturasız alımından; tutarını, gününü ve kategorisini Tedarikçiler'de düzeltin/);
  const del = body(exp, "export async function deleteExpenseEntry(");
  assert.ok(del.indexOf("if (owned?.owner) throw new UserError(") < del.indexOf("tx.delete(s.expenseEntries)"), "önce engel");
  // Yarışta da silinmez: silme koşulu sahipsiz kayıt
  assert.match(del, /tx\.delete\(s\.expenseEntries\)\.where\(and\(eq\(s\.expenseEntries\.id, entryId\), isNull\(s\.expenseEntries\.supplierEntryId\)\)\)/);
});

test("cari eylemleri: her dışa aktarım ilk satırda requireAdmin, yardımcı dışa aktarım yok", () => {
  const path = "src/server/actions/cari.ts";
  if (!existsSync(join(root, path))) return; // eylemler sonraki adımda (tedarikçi sayfası)
  const text = read(path);
  assert.match(text, /^"use server";/);
  const exports = [...text.matchAll(/^export (.*)$/gm)].map((m) => m[1]);
  for (const e of exports) assert.match(e, /^async function \w+\(/, `yardımcı dışa aktarım: export ${e}`);
  const guarded = [...text.matchAll(/^export async function (\w+)\([^)]*\)[^{]*\{\n\s+return attempt\(async \(\) => \{\n\s+const me = await requireAdmin\(\);/gm)].length;
  assert.equal(guarded, exports.length, "her eylem yönetici denetimiyle başlar");
});

test("ödeme kaleminin kaynağı (K25): fatura ve cari dalları switch ile, sonu unreachable; karşılaştırmayla dallanan yer yok", () => {
  for (const f of sources) {
    assert.doesNotMatch(f.text, /\bsource\s*[!=]==\s*"(invoice|cari)"/, `${f.path}: kaynağa göre dallanma switch + unreachable ile yazılır`);
  }
  // Kaynak dallarının bulunduğu dosyalar (plan §7.5): hepsi tam switch'le kapanır
  for (const path of [
    "src/app/panel/hatirlaticilar/payment-ui.tsx",
    "src/app/panel/hatirlaticilar/reminders-client.tsx",
    "src/app/panel/hatirlaticilar/calendar-entries.ts",
    "src/app/panel/hatirlaticilar/recent-paid.tsx",
    "src/app/panel/dashboard-payments.tsx",
    "src/lib/cash-plan.ts",
    "src/server/data/cash-plan.ts",
    "src/lib/mcp/answers/payments.ts",
    "src/server/actions/reminders.ts",
    "src/lib/recent-paid.ts",
    "src/lib/cari/upcoming.ts",
  ]) {
    const text = read(path);
    assert.match(text, /switch \((item|i|it|e|k|hint)\.?(source|kind)?\)/, `${path}: switch yok`);
    if (path !== "src/lib/recent-paid.ts" && path !== "src/lib/cari/upcoming.ts") assert.match(text, /unreachable\(/, `${path}: tam switch unreachable ile kapanır`);
  }
  // Son ödenenler'in "Geri al"ı cari ödemeyi kilit altında, düzenlenmemişse siler
  const undo = body(read("src/server/actions/reminders.ts"), "export async function undoRecentPaid(");
  assert.match(undo, /z\.enum\(\["invoice", "reminder", "cari"\]\)/);
  assert.match(undo, /db\.transaction\(\(tx\) => deleteRecentPayment\(tx, rid, entry\)\)/);
  const del = body(read("src/server/cari/entries.ts"), "export async function deleteRecentPayment(");
  assert.ok(del.indexOf("lockCard(tx") > 0 && del.indexOf("lockCard(tx") < del.indexOf("paymentUnchanged(") && del.indexOf("paymentUnchanged(") < del.indexOf("deleteEntry(tx"));
  // Ödemeler listesi cari hesabı tek okumayla alır, mahsubu saf modül yapar
  const loader = body(read("src/server/notify/digest.ts"), "export async function loadUpcoming(");
  assert.match(loader, /loadCariIndex\(today/);
  assert.match(loader, /upcomingWithCari\(/);
});

test("Kasa (§8): personelin satır verisi beyaz listeyle kurulur; ödeme bağı ve tedarikçi kimliği gitmez", async () => {
  const { STAFF_CASH_OUT_FIELDS, staffCashOutRow, nameKey, supplierNameHint } = await import("../src/lib/cash-outs");
  assert.deepEqual(
    [...STAFF_CASH_OUT_FIELDS].sort(),
    ["amount", "categoryId", "categoryName", "createdAt", "createdByName", "date", "description", "docType", "expenseEntryId", "id", "kind", "photoId", "receiptDate", "receiptNo", "store", "vat"],
  );
  const full = Object.fromEntries([...STAFF_CASH_OUT_FIELDS, "createdBy", "updatedAt", "supplierId", "paymentId"].map((k) => [k, k])) as Record<string, string>;
  const row = staffCashOutRow(full as Record<(typeof STAFF_CASH_OUT_FIELDS)[number], unknown>, true);
  assert.deepEqual(Object.keys(row).sort(), [...STAFF_CASH_OUT_FIELDS, "locked"].sort());
  assert.equal(row.locked, true);
  // Sayfa personelde yalnız staffCashOutRow'dan geçen satırı verir; yöneticinin ipucu personele hiç okunmaz
  const page = read("src/app/panel/kasa/page.tsx");
  assert.match(page, /const dayOuts: CashOutView\[\] = admin\s+\? outs\s+: outs\.map\(\(o\) => staffCashOutRow\(/);
  assert.match(page, /admin \? loadKasaCariHints\(ids, today\) : Promise\.resolve\(\{\}\)/);
  // Ad ipucu faturalardaki eşleşme kuralıyla aynı anahtarı kullanır (pencere fatura kurallarını yüklemez)
  const { supplierMatchKey } = await import("../src/app/panel/faturalar/rules");
  for (const n of ["Sütaş", "  SÜTAŞ   SÜT ", "Pınar (şube)", "IŞIK GIDA", "Metro Market (Tuzla)", "", "  "]) assert.equal(nameKey(n), supplierMatchKey(n), n);
  assert.equal(supplierNameHint("sütaş", ["Pınar", "SÜTAŞ"]), "SÜTAŞ");
  assert.equal(supplierNameHint("Migros", ["Pınar", "Sütaş"]), null);
  assert.doesNotMatch(read("src/app/panel/kasa/cash-out-dialog.tsx"), /faturalar\/rules|calc\/engine/);
});

test("Kasa (§6.8, §8): bağlı satır personele kilitli, yöneticinin düzeltmesi ödemeye geçer, silme reddedilir", () => {
  const co = read("src/server/actions/cash-outs.ts");
  const persist = body(co, "async function persist(");
  // Önce kart (lockCashOutLink), sonra satır kilidi, sonra bağın yeniden denetimi ve ödemeye geçirme; yazımdan önce
  assert.ok(persist.indexOf("lockCashOutLink(tx, d.id, admin)") < persist.indexOf('.for("update")'));
  assert.ok(persist.indexOf('.for("update")') < persist.indexOf("syncLinkedCashOut(tx, prev.id, link,"));
  assert.ok(persist.indexOf("syncLinkedCashOut(") < persist.indexOf(".update(s.cashOuts)"));
  const del = body(co, "export async function deleteCashOut(");
  assert.ok(del.indexOf("assertCashOutDeletable(tx, cid,") < del.indexOf("tx.delete(s.cashOuts)"));
  // Personelin gördüğü mesaj sunucuyla aynı ve tutar içermez
  const server = read("src/server/cari/kasa.ts").match(/CARI_LOCKED_STAFF = "([^"]+)"/)?.[1];
  const client = read("src/app/panel/kasa/cash-outs.tsx").match(/LOCKED_TEXT = "([^"]+)"/)?.[1];
  assert.ok(server && server === client, "aynı sabit mesaj");
  assert.doesNotMatch(server!, /₺|\d/);
  // Etiketler ve ipucu
  const dialog = read("src/app/panel/kasa/cash-out-dialog.tsx");
  assert.match(dialog, /\{ value: "harcama", label: "Alışveriş" \},\s+\{ value: "teslim", label: "Teslim · ödeme" \}/);
  assert.match(dialog, /Tedarikçinin şoförüne verilen borç ödemesi Teslim · ödeme'dir; gidere yazılmaz\./);
  assert.match(dialog, /ör\. patrona, bankaya, tedarikçiye \(Sütaş\)/);
});
