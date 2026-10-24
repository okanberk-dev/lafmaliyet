// Kasadan çıkan istekleri ve fotoğraf kaldırma (saf; plan docs/planlar/personel-yetki.md §2.7; docs/KASA-RAPORU.md ›
// Kasadan çıkan: kapanmış gün, yöneticinin satırı): kapı kuralı (doğrudan / istek / kapalı), istek penceresi (bugün ile
// D−7), yükün çözülmesi ve personele giden görünümü (yönetici kategorisi, önceki hâl ve gider kaydı gitmez), değişiklik
// satırları, yöneticinin kırmızı işaretleri ve metinler. Kaynak denetimleri: eylemlerin rolleri, tek kapı işlevi.
// Çalıştırma: npx tsx --test tests/kasa-istek.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  CASH_OUT_REQUEST_TEXT,
  cashOutCardTitle,
  cashOutChanged,
  cashOutFlags,
  CashOutRequestPayload,
  cashOutNeedsApproval,
  cashOutRequestTitle,
  lineChanges,
  oldRequestDays,
  photoCardTitle,
  PhotoRemovalPayload,
  photoRemovalTitle,
  REQUEST_DAYS,
  requestDayAllowed,
  staffCashOutView,
  type CashOutGateFacts,
} from "../src/lib/cash-out-requests";
import { assertNoCostKeys } from "./helpers/leak-scan";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
/** Türkiye saatiyle an */
const tr = (local: string) => new Date(`${local}:00+03:00`);
/** Bölünmez boşluklar (tutar ve gün adı) düz boşluğa: karşılaştırma okunur kalsın */
const sp = <T,>(v: T): T => (typeof v === "string" ? (v.replace(/\u00a0/g, " ") as T) : Array.isArray(v) ? (v.map(sp) as T) : v);

const facts = (o: Partial<CashOutGateFacts>): CashOutGateFacts => ({
  admin: false,
  op: "ekle",
  dayOpen: true,
  canReport: true,
  inWindow: true,
  adminCategory: false,
  rowLocked: false,
  ...o,
});

test("kapı: yönetici her zaman doğrudan; açık günde ekleme ve personelin satırı doğrudan", () => {
  for (const op of ["ekle", "duzelt", "sil", "fis"] as const) {
    assert.equal(cashOutNeedsApproval(facts({ admin: true, op, dayOpen: false, canReport: false, inWindow: false, adminCategory: true })), "direct");
  }
  assert.equal(cashOutNeedsApproval(facts({ op: "ekle" })), "direct");
  assert.equal(cashOutNeedsApproval(facts({ op: "duzelt" })), "direct");
  assert.equal(cashOutNeedsApproval(facts({ op: "sil" })), "direct");
});

test("kapı: açık günde yöneticinin kategorisindeki satırın her değişikliği ve silinmesi onaya", () => {
  assert.equal(cashOutNeedsApproval(facts({ op: "duzelt", adminCategory: true })), "request");
  assert.equal(cashOutNeedsApproval(facts({ op: "sil", adminCategory: true })), "request");
  // Ekleme satırın kategorisine bakmaz (yeni satır); fiş eklemek onaysız
  assert.equal(cashOutNeedsApproval(facts({ op: "ekle", adminCategory: true })), "direct");
  assert.equal(cashOutNeedsApproval(facts({ op: "fis", adminCategory: true })), "direct");
});

test("kapı: kilitli dün ekleme, düzeltme ve silme onaya; fiş eklemek onaysız", () => {
  const locked = { dayOpen: false, canReport: true, inWindow: true };
  assert.equal(cashOutNeedsApproval(facts({ ...locked, op: "ekle" })), "request");
  assert.equal(cashOutNeedsApproval(facts({ ...locked, op: "duzelt" })), "request");
  assert.equal(cashOutNeedsApproval(facts({ ...locked, op: "sil" })), "request");
  assert.equal(cashOutNeedsApproval(facts({ ...locked, op: "fis" })), "direct");
});

test("kapı: eski günlerde (D−2 … D−7) yalnız ekleme isteği; pencere dışı her şey kapalı", () => {
  const old = { dayOpen: false, canReport: false, inWindow: true };
  assert.equal(cashOutNeedsApproval(facts({ ...old, op: "ekle" })), "request");
  assert.equal(cashOutNeedsApproval(facts({ ...old, op: "duzelt" })), "closed");
  assert.equal(cashOutNeedsApproval(facts({ ...old, op: "sil" })), "closed");
  assert.equal(cashOutNeedsApproval(facts({ ...old, op: "fis" })), "closed");
  const out = { dayOpen: false, canReport: false, inWindow: false };
  for (const op of ["ekle", "duzelt", "sil", "fis"] as const) assert.equal(cashOutNeedsApproval(facts({ ...out, op })), "closed");
});

test("kapı: kilitli satır (ör. yöneticinin bir ödemeye bağladığı) personele kapalı: ne doğrudan ne istekle", () => {
  for (const op of ["duzelt", "sil", "fis"] as const) {
    assert.equal(cashOutNeedsApproval(facts({ op, rowLocked: true })), "closed");
    assert.equal(cashOutNeedsApproval(facts({ op, rowLocked: true, dayOpen: false })), "closed");
    assert.equal(cashOutNeedsApproval(facts({ op, rowLocked: true, admin: true })), "direct");
  }
});

test("istek penceresi: bugün ile 7 gün öncesi (iş günüyle, 05:00 dönüşü); ileri gün yok", () => {
  assert.equal(REQUEST_DAYS, 7);
  const now = tr("2026-10-24T10:00");
  assert.equal(requestDayAllowed("2026-10-24", now), true);
  assert.equal(requestDayAllowed("2026-10-17", now), true);
  assert.equal(requestDayAllowed("2026-10-16", now), false);
  assert.equal(requestDayAllowed("2026-10-25", now), false);
  // 04:59'da iş günü hâlâ dün (23 Ekim): pencere 16 Ekim'e kadar
  const early = tr("2026-10-24T04:59");
  assert.equal(requestDayAllowed("2026-10-16", early), true);
  assert.equal(requestDayAllowed("2026-10-24", early), false);
  assert.deepEqual(oldRequestDays(now), ["2026-10-22", "2026-10-21", "2026-10-20", "2026-10-19", "2026-10-18", "2026-10-17"]);
});

const line = {
  kind: "harcama" as const,
  amount: 412.5,
  store: "Migros",
  description: "süt",
  receiptDate: "2026-10-21",
  receiptNo: "0042",
  vat: 30.5,
  docType: "fis" as const,
  categoryId: 3,
  photoId: 77,
};
const before = { ...line, amount: 400, updatedAt: "2026-10-21T19:00:00.000Z", createdByName: "Ayşe", expense: { id: 9, categoryId: 12, updatedAt: "2026-10-21T19:00:00.000Z" } };

test("yük: ekleme satır ister, düzeltme satır ve önceki hâl, silme yalnız önceki hâl; bilinmeyen anahtar düşer", () => {
  const add = CashOutRequestPayload.parse({ op: "ekle", day: "2026-10-21", cashOutId: null, line, before: null, karaoke: 1 });
  assert.equal("karaoke" in add, false);
  assert.equal(CashOutRequestPayload.safeParse({ op: "ekle", day: "2026-10-21", cashOutId: null, line: null, before: null }).success, false);
  assert.equal(CashOutRequestPayload.safeParse({ op: "duzelt", day: "2026-10-21", cashOutId: 5, line, before: null }).success, false);
  assert.equal(CashOutRequestPayload.safeParse({ op: "duzelt", day: "2026-10-21", cashOutId: 5, line, before }).success, true);
  assert.equal(CashOutRequestPayload.safeParse({ op: "sil", day: "2026-10-21", cashOutId: 5, line: null, before }).success, true);
  assert.equal(CashOutRequestPayload.safeParse({ op: "sil", day: "2026-10-21", cashOutId: null, line: null, before }).success, false);
  assert.equal(PhotoRemovalPayload.safeParse({ photoId: 3, photoKind: "kasa-z", reportId: 4, day: "2026-10-21" }).success, true);
  assert.equal(PhotoRemovalPayload.safeParse({ photoId: 3, photoKind: "fis", reportId: 4, day: "2026-10-21" }).success, false);
});

test("personelin görünümü yalnız satırdan: kategori, önceki hâl, gider kaydı ve fotoğrafın kimliği gitmez", () => {
  const p = CashOutRequestPayload.parse({ op: "duzelt", day: "2026-10-21", cashOutId: 5, line, before });
  const view = staffCashOutView(p);
  assert.deepEqual(Object.keys(view).sort(), ["day", "line", "op"]);
  assert.deepEqual(Object.keys(view.line!).sort(), ["amount", "description", "docType", "kind", "photo", "store"]);
  assert.equal(view.line!.photo, true);
  const json = JSON.stringify(view);
  assert.doesNotMatch(json, /categoryId|before|expense|hadExpense|photoId/);
  assertNoCostKeys(json, "staffCashOutView");
  // Silme isteğinde personelin görünümü satırı önceki hâlden kurmaz (yalnız işlem ve gün)
  assert.equal(staffCashOutView(CashOutRequestPayload.parse({ op: "sil", day: "2026-10-21", cashOutId: 5, line: null, before })).line, null);
});

test("değişiklik satırları ve istekten sonra değişme", () => {
  assert.deepEqual(sp(lineChanges(before, line)), ["Tutar: 400 ₺ → 412,50 ₺"]);
  assert.deepEqual(sp(lineChanges(before, { ...before })), []);
  assert.deepEqual(sp(lineChanges(before, { ...before, store: "A101", description: null, kind: "teslim" })), ["Ne için: alışveriş → teslim", "Kime: Migros → A101", "Açıklama: süt → —"]);
  const now = { row: { ...before }, expense: before.expense };
  assert.equal(cashOutChanged(before, now), false);
  assert.equal(cashOutChanged(before, { ...now, row: { ...before, amount: 401 } }), true);
  assert.equal(cashOutChanged(before, { ...now, row: { ...before, updatedAt: "2026-10-22T08:00:00.000Z" } }), true);
  assert.equal(cashOutChanged(before, { ...now, row: { ...before, photoId: null } }), true);
  assert.equal(cashOutChanged(before, { ...now, expense: { ...before.expense, categoryId: 13 } }), true);
  assert.equal(cashOutChanged(before, { ...now, expense: { ...before.expense, updatedAt: "2026-10-22T08:00:00.000Z" } }), true);
  assert.equal(cashOutChanged(before, { ...now, expense: null }), true);
  assert.equal(cashOutChanged(before, null), true);
});

test("kırmızı işaretler: tutar günün açığına eşit, kapanmış güne teslim ya da fişsiz çıkış", () => {
  assert.deepEqual(sp(cashOutFlags({ op: "ekle", line, dayClosed: false, reportDiff: null })), []);
  assert.deepEqual(sp(cashOutFlags({ op: "ekle", line, dayClosed: false, reportDiff: -412 })), ["Tutar günün kasa açığıyla aynı (412 ₺ eksik)"]);
  assert.deepEqual(sp(cashOutFlags({ op: "ekle", line, dayClosed: false, reportDiff: -300 })), []);
  // Fazla kasa açığı örtmez
  assert.deepEqual(sp(cashOutFlags({ op: "ekle", line, dayClosed: false, reportDiff: 412 })), []);
  assert.deepEqual(sp(cashOutFlags({ op: "ekle", line: { ...line, kind: "teslim", photoId: null }, dayClosed: true, reportDiff: null })), ["Kapanmış güne teslim ekleniyor"]);
  assert.deepEqual(sp(cashOutFlags({ op: "ekle", line: { ...line, photoId: null }, dayClosed: true, reportDiff: null })), ["Kapanmış güne fişsiz çıkış ekleniyor"]);
  assert.deepEqual(sp(cashOutFlags({ op: "ekle", line: { ...line, photoId: null }, dayClosed: false, reportDiff: null })), []);
  assert.deepEqual(sp(cashOutFlags({ op: "sil", line: null, dayClosed: true, reportDiff: -400 })), []);
});

test("metinler: başlıklar tutarsız; yöneticinin kart başlıkları", () => {
  assert.equal(sp(cashOutRequestTitle("ekle", "2026-10-21")), "21 Ekim kasadan çıkan ekleme");
  assert.equal(sp(cashOutRequestTitle("duzelt", "2026-10-21")), "21 Ekim kasadan çıkan düzeltme");
  assert.equal(sp(cashOutRequestTitle("sil", "2026-10-21")), "21 Ekim kasadan çıkan silme");
  assert.equal(sp(photoRemovalTitle("kasa-z", "2026-10-21")), "21 Ekim Z raporu fotoğrafı kaldırma");
  assert.equal(sp(photoRemovalTitle("kasa-pos", "2026-10-21")), "21 Ekim Banka POS fotoğrafı kaldırma");
  assert.equal(sp(cashOutCardTitle("ekle", "2026-10-21")), "Kasadan çıkan ekleme · 21 Ekim Çarşamba");
  assert.equal(sp(photoCardTitle("kasa-z", "2026-10-21")), "Fotoğraf kaldırma · Z raporu · 21 Ekim Çarşamba");
  for (const t of [cashOutRequestTitle("ekle", "2026-10-21"), photoRemovalTitle("kasa-z", "2026-10-21")]) assert.doesNotMatch(t, /₺|\d+,\d\d/);
  // Personelin metinleri yöneticinin kategorisinin adını taşımaz; uzun tire yok
  for (const t of Object.values(CASH_OUT_REQUEST_TEXT)) {
    assert.doesNotMatch(t, /maaş|avans|kira|—/i);
  }
});

test("kaynak: eylemler kendi oturumunu ve rolünü denetler; istek eylemleri yöneticiyi reddeder; yardımcı dışa verilmez", () => {
  const src = read("src/server/actions/cash-out-requests.ts");
  assert.match(src, /^"use server";/);
  const exported = [...src.matchAll(/^export (?:async function|function|const|let|class) (\w+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(exported, ["attachCashOutReceipt", "requestCashOutChange", "requestPhotoRemoval", "reviewCashOutRequest", "reviewPhotoRemoval"]);
  for (const name of ["requestCashOutChange", "attachCashOutReceipt", "requestPhotoRemoval"]) {
    const body = src.slice(src.indexOf(`export async function ${name}`));
    assert.match(body, /^export async function \w+\([^)]*\) \{\s*return attempt\(async \(\) => \{\s*const me = await requireUser\(\);/);
  }
  for (const name of ["requestCashOutChange", "requestPhotoRemoval"]) {
    const body = src.slice(src.indexOf(`export async function ${name}`));
    assert.match(body.slice(0, 400), /if \(me\.role === "admin"\) throw new UserError/);
  }
  for (const name of ["reviewCashOutRequest", "reviewPhotoRemoval"]) {
    const body = src.slice(src.indexOf(`export async function ${name}`));
    assert.match(body, /^export async function \w+\([^)]*\) \{\s*return attempt\(async \(\) => \{\s*const me = await requireAdmin\(\);/);
  }
});

test("kaynak: doğrudan yol ve istek yolu aynı kapıdan geçer (personel); kasadan çıkanın yazımı sunucu eylemi değil", () => {
  const guard = read("src/server/cash-outs/guard.ts");
  assert.match(guard, /^import "server-only";/);
  assert.match(guard, /export async function staffCashOutGate\(/);
  assert.match(guard, /cashOutNeedsApproval\(/);
  const direct = read("src/server/actions/cash-outs.ts");
  // saveCashOut ve deleteCashOut personelde kapıya sorar
  assert.equal([...direct.matchAll(/staffCashOutGate\(/g)].length >= 2, true);
  const core = read("src/server/cash-outs/requests.ts");
  assert.equal([...core.matchAll(/staffCashOutGate\(/g)].length >= 3, true);
  const write = read("src/server/cash-outs/write.ts");
  assert.match(write, /^import "server-only";/);
  assert.doesNotMatch(write, /"use server"/);
  assert.match(write, /export async function writeCashOut\(/);
  assert.match(write, /export async function removeCashOut\(/);
  assert.match(write, /assertNotHeld\(tx, d\.photoId, o\.heldBy\)/);
});

test("kaynak: personelin fiş okumasında harcama kayıtları okunmaz, tekrar uyarısı genel", () => {
  const src = read("src/server/photo-read/read.ts");
  const recent = src.slice(src.indexOf("async function recentReceipts"), src.indexOf("export async function readPhotoFor"));
  assert.match(recent, /if \(staff\) return outs;/);
  const receipt = read("src/lib/photo-read/receipt.ts");
  assert.match(receipt, /Bu fiş zaten eklenmiş olabilir; yönetici bakacak\./);
});
