// Cari hesabın kaynak taramaları (docs/planlar: cari §9): dağıtım ve saklanan toplam yalnız src/server/cari/settle.ts'te
// yazılır; "Ödenmedi" engeli dört yazıcıda; fatura silinmeden önce bağlar çözülür; cari eylemleri (varsa) yalnız
// yöneticiye açık ve dosyada yardımcı dışa aktarım yok.
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
    assert.doesNotMatch(f.text, /\btrackingBase\(/, `${f.path}: takip tabanını yalnız settle.ts yazar`);
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
  // Kullanıcının yazdığı ödeme alanları faturayı "defterin kapattığı" saymaz
  assert.match(body(inv, "async function applyPayment("), /paidByLedger: false/);
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
