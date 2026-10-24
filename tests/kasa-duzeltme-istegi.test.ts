// Kasa raporunu sonradan düzeltme ve silme isteği (plan docs/planlar/personel-yetki.md §2.3; docs/KASA-RAPORU.md ›
// Sonradan düzeltme ve silme isteği): personelin kapısı (doğrudan / istek / kapalı), önerinin rapora birleştirilmesi
// (arada yöneticinin yaptığı düzeltme ve sayan korunur), değişiklik listesi, zil, işlem geçmişi ve e-posta metinleri,
// "Değişiklikler" geçmişinde önerenin adı, isteğin yükünde karaoke, site ya da maliyet anahtarı olmaması; kaynak
// denetimleri (eylemlerin rolleri, yazım yolunun sunucu eylemi olmaması, gönderimin onaya dönmesi).
// Çalıştırma: npx tsx --test tests/kasa-duzeltme-istegi.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  historyOf,
  lateCorrections,
  revisionChanges,
  revisionDataOf,
  SENSITIVE,
  staffCashGate,
  type CashReportFields,
  type CashRevisionData,
  type CashRevisionRow,
} from "../src/lib/cash-report";
import {
  approvalLine,
  correctionBell,
  correctionLog,
  CorrectionPayload,
  correctionTitle,
  DeletePayload,
  deleteBell,
  deleteTitle,
  mergeProposal,
  shortDayTR,
  proposalChanges,
  proposalSummary,
  staffResultBell,
  type ProposedFields,
} from "../src/lib/cash-requests";
import { assertNoCostKeys } from "./helpers/leak-scan";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
/** Türkiye saatiyle an */
const tr = (local: string) => new Date(`${local}:00+03:00`);
/** Bölünmez boşluklar düz boşluğa (tarih ve tutar biçimi NBSP yazar) */
const n = (v: string | null | undefined) => (v ?? "").replace(/\u00a0/g, " ");

const fields: CashReportFields = {
  date: "2026-10-22",
  zNo: "1204",
  receipts: 80,
  zTotal: 12_450,
  cash: 3_000,
  card: 9_000,
  mealCard: 450,
  online: 0,
  other: 0,
  openingCash: 500,
  cashOut: 0,
  cashOutNote: null,
  countedCash: 3_380,
  handedOver: 2_400,
  bankPos: 9_000,
  offRevenue: null,
  discounts: null,
  note: null,
};
const base: CashRevisionData = { ...fields, cashDiff: -120, countedByName: "Ayşe" };
const proposedOf = (o: Partial<ProposedFields> = {}): ProposedFields => {
  const { date: _date, ...rest } = fields;
  void _date;
  return { ...rest, countedBy: 2, countedByName: "Ayşe", ...o };
};

// ---------------------------------------------------------------- Kapı

test("kapı: bugün doğrudan; ertesi gün kasa alanı ya da sayan istek, metin doğrudan; kilitli günde her değişiklik istek; pencere dışı kapalı", () => {
  const changes = (after: Partial<CashRevisionData>) => revisionChanges(base, { ...base, ...after });
  const text = changes({ note: "Z yanlış yazıldı" });
  const cash = changes({ handedOver: 2_040 });
  const counter = changes({ countedByName: "Mehmet" });
  assert.equal(text[0].sensitive, false);
  assert.equal(cash[0].sensitive, true);
  assert.equal(counter[0].sensitive, true, "Sayan da kasa alanı sayılır");
  const gate = (now: Date, o: { hasReport?: boolean; laterReport?: boolean; changes: typeof text }) =>
    staffCashGate({ date: "2026-10-22", now, hasReport: o.hasReport ?? true, laterReport: o.laterReport ?? false, changes: o.changes });

  // Bugünün raporu: her değişiklik doğrudan
  for (const c of [text, cash, counter]) assert.equal(staffCashGate({ date: "2026-10-22", now: tr("2026-10-22T23:30"), hasReport: true, laterReport: false, changes: c }), "direct");
  // Aynı gece (iş günü kapanmadan, 05:00'ten önce): her şey doğrudan
  const night = tr("2026-10-23T04:59");
  for (const c of [text, cash, counter]) assert.equal(gate(night, { changes: c }), "direct");
  // Ertesi gün (05:00 ve sonrası, gün hâlâ personelde): kasa alanı ve sayan istek, metin doğrudan
  for (const now of [tr("2026-10-23T05:00"), tr("2026-10-24T04:59")]) {
    assert.equal(gate(now, { changes: text }), "direct");
    assert.equal(gate(now, { changes: cash }), "request");
    assert.equal(gate(now, { changes: counter }), "request");
  }
  // Kilitli gün (ertesi günün raporu girildi): her değişiklik istek; değişiklik yoksa doğrudan (yeniden gönderim)
  const morning = tr("2026-10-23T10:00");
  assert.equal(gate(morning, { laterReport: true, changes: text }), "request");
  assert.equal(gate(morning, { laterReport: true, changes: cash }), "request");
  assert.equal(gate(morning, { laterReport: true, changes: [] }), "direct");
  // Rapor yok: unutulan dünü girmek doğrudan (kilit yok)
  assert.equal(gate(morning, { hasReport: false, laterReport: true, changes: [] }), "direct");
  // Personelin penceresi kapandı (ertesi günün 05:00'i): kapalı
  assert.equal(gate(tr("2026-10-24T05:00"), { changes: text }), "closed");
  assert.equal(gate(tr("2026-10-24T05:00"), { hasReport: false, changes: [] }), "closed");
  assert.ok(SENSITIVE.includes("countedByName"));
});

// ---------------------------------------------------------------- Birleştirme

test("öneri raporun şimdiki hâline yalnız önerinin değiştirdiği alanlarla uygulanır: arada yöneticinin düzeltmesi ve sayanı korunur", () => {
  // Öneri: teslim 2.400 → 2.040. Arada yönetici notu ve Z'yi düzeltti, sayanı Ali yaptı
  const current = { data: { ...base, zTotal: 12_500, note: "Z düzeltildi", countedByName: "Ali" }, countedBy: 1 };
  const merged = mergeProposal(current, { data: base, countedBy: 2 }, proposedOf({ handedOver: 2_040 }));
  assert.equal(merged.fields.handedOver, 2_040, "önerinin alanı");
  assert.equal(merged.fields.zTotal, 12_500, "yöneticinin düzeltmesi korunur");
  assert.equal(merged.fields.note, "Z düzeltildi");
  assert.equal(merged.countedBy, 1, "öneri sayanı değiştirmediyse şimdiki sayan kalır");
  assert.equal(merged.countedByName, "Ali");
  assert.equal(merged.fields.date, "2026-10-22");
  // Öneri sayanı değiştirdiyse önerininki
  const counter = mergeProposal(current, { data: base, countedBy: 2 }, proposedOf({ countedBy: 3, countedByName: "Mehmet" }));
  assert.equal(counter.countedBy, 3);
  assert.equal(counter.countedByName, "Mehmet");
  assert.equal(counter.fields.zTotal, 12_500);
  // Önerinin sayanı tabanla aynıysa olduğu gibi alınmaz (eski formun sayanı arada yapılan değişikliği ezmez)
  assert.equal(mergeProposal(current, { data: base, countedBy: 2 }, proposedOf()).countedBy, 1);
  // Kuruş altı fark değişiklik sayılmaz; boş ↔ boş aynı
  assert.equal(mergeProposal(current, { data: base, countedBy: 2 }, proposedOf({ handedOver: 2_400.001 })).fields.handedOver, 2_400);
});

test("önerinin değişiklikleri: tabana göre; değişiklik yoksa boş (eylem reddeder)", () => {
  assert.deepEqual(proposalChanges(base, proposedOf()), []);
  const c = proposalChanges(base, proposedOf({ handedOver: 2_040, note: "teslim yanlış" }));
  assert.deepEqual(
    c.map((x) => [x.key, x.sensitive]),
    [
      ["handedOver", true],
      ["note", false],
    ],
  );
  // Sonuç satırları: kasa farkı ve ertesi güne devir
  const s = proposalSummary(base, proposedOf({ countedCash: 3_500 }));
  assert.deepEqual(s.lines.map(n), ["Sayılan nakit: 3.380 ₺ → 3.500 ₺"]);
  assert.equal(n(s.result), "Kasa farkı: 120 ₺ eksik → Kasa tutuyor");
  assert.equal(n(s.carry), "Ertesi güne devir: 980 ₺ → 1.100 ₺");
  assert.equal(proposalSummary(base, proposedOf({ note: "x" })).result, null, "fark değişmiyorsa sonuç satırı yok");
});

// ---------------------------------------------------------------- Metinler

test("başlıklar, zil ve işlem geçmişi metinleri: tutar yalnız kasa alanında, neden kısaltılır", () => {
  assert.equal(n(correctionTitle("2026-10-22")), "22 Ekim kasa düzeltmesi");
  assert.equal(n(deleteTitle("2026-10-22")), "22 Ekim kasa raporu silme");
  const changes = proposalChanges(base, proposedOf({ handedOver: 2_040 }));
  const bell = correctionBell({ date: "2026-10-22", by: "Mehmet", changes, before: -120, after: -120 + 0 });
  assert.equal(n(bell.title), "22 Ekim kasa raporu: düzeltme önerisi");
  assert.equal(n(bell.body), "Mehmet · Teslim edilen 2.400 ₺ → 2.040 ₺");
  const bell2 = correctionBell({ date: "2026-10-22", by: "Mehmet", changes: proposalChanges(base, proposedOf({ countedCash: 3_500 })), before: -120, after: 0 });
  assert.equal(n(bell2.body), "Mehmet · Sayılan nakit 3.380 ₺ → 3.500 ₺ · kasa farkı 120 ₺ eksik → tutuyor");
  const del = deleteBell({ date: "2026-10-22", by: "Mehmet", reason: "İki kez girildi; ".repeat(10) });
  assert.equal(n(del.title), "22 Ekim kasa raporunun silinmesi istendi");
  assert.ok(del.body.startsWith("Mehmet: İki kez girildi"));
  assert.ok(del.body.length <= "Mehmet: ".length + 81, "neden 80 karakterde kesilir");
  // Personelin sonucu
  const ok = staffResultBell({ kind: "kasa-duzeltme", status: "approved", day: "2026-10-22", note: null });
  assert.deepEqual([n(ok.title), ok.body], ["22 Ekim kasa düzeltmeniz onaylandı", "Rapor güncellendi"]);
  const no = staffResultBell({ kind: "kasa-duzeltme", status: "rejected", day: "2026-10-22", note: "Teslim doğru" });
  assert.deepEqual([n(no.title), no.body], ["22 Ekim kasa düzeltmeniz reddedildi", "Yönetici: Teslim doğru"]);
  assert.equal(staffResultBell({ kind: "kasa-duzeltme", status: "rejected", day: "2026-10-22", note: null }).body, "Rapor değişmedi");
  assert.equal(n(staffResultBell({ kind: "kasa-silme", status: "approved", day: "2026-10-22", note: null }).title), "22 Ekim kasa raporunun silinmesi onaylandı");
  // İşlem geçmişi: değişiklikler kesilmez, neden ilk 200 karakter
  const log = correctionLog({ date: "2026-10-22", changes, reason: "a".repeat(300) });
  assert.match(n(log), /^22 Ekim Perşembe: Teslim edilen 2\.400 ₺ → 2\.040 ₺ · a{200}$/);
  assert.equal(approvalLine("Mehmet", "Ayşe"), "Yönetici onayıyla düzeltildi: Mehmet önerdi, Ayşe onayladı.");
});

// ---------------------------------------------------------------- Geçmiş

test("Değişiklikler geçmişi: onaylanan sürüm önerenin adını taşır; ertesi gün zili 'Mehmet önerdi · Ayşe onayladı' der", () => {
  const report = {
    ...fields,
    handedOver: 2_040,
    revision: 2,
    cashDiff: -120,
    countedByName: "Ayşe",
    submittedBy: 1,
    submittedByName: "Ali",
    createdAt: "2026-10-22T18:00:00.000Z",
    updatedAt: "2026-10-23T07:05:00.000Z",
  };
  const revisions: CashRevisionRow[] = [{ revision: 1, data: base, submittedBy: 2, submittedByName: "Ayşe", submittedAt: "2026-10-22T18:00:00.000Z" }];
  const proposedBy = new Map([[2, "Mehmet"]]);
  const h = historyOf(report, revisions, proposedBy);
  assert.equal(h.entries[0].proposedBy, "Mehmet");
  assert.equal(historyOf(report, revisions).entries[0].proposedBy, null, "harita yoksa önerici yok");
  const late = lateCorrections(report, revisions, 99, proposedBy);
  assert.deepEqual(late?.by, ["Mehmet önerdi · Ali onayladı"]);
  assert.deepEqual(lateCorrections(report, revisions, 99)?.by, ["Ali"]);
});

// ---------------------------------------------------------------- Yük

test("isteğin yükü: yalnız raporun alanları; karaoke, site satırı, maliyet anahtarları çözümde düşer", () => {
  const raw = {
    date: "2026-10-22",
    reportId: 5,
    baseRevision: 1,
    base: { ...base, karaoke: 900, online: 0 },
    baseCountedBy: 2,
    proposed: { ...proposedOf({ handedOver: 2_040 }), karaokeAmount: 900, cost: 12, site: { online: 3 } },
    gate: "gec",
    cost: 5,
  };
  const p = CorrectionPayload.parse(raw);
  const json = JSON.stringify(p);
  assertNoCostKeys(json, "kasa-duzeltme yükü");
  assert.doesNotMatch(json, /karaoke|"site"/);
  assert.equal(p.proposed.handedOver, 2_040);
  const d = DeletePayload.parse({ date: "2026-10-22", reportId: 5, baseRevision: 2, snapshot: { ...base, karaoke: 1 }, photos: 2, prepaid: 3 });
  assertNoCostKeys(JSON.stringify(d), "kasa-silme yükü");
  assert.doesNotMatch(JSON.stringify(d), /karaoke/);
  assert.throws(() => CorrectionPayload.parse({ ...raw, gate: "baska" }));
  assert.deepEqual(revisionDataOf({ ...fields, cashDiff: 0, countedByName: null, submittedByName: "Ayşe" }).countedByName, "Ayşe");
});

// ---------------------------------------------------------------- Kaynak denetimleri

/** `export async function name` gövdesi (bir sonraki export'a kadar) */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, name);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

test("eylemler: istekler requireUser ile başlar ve yöneticiyi reddeder, karar requireAdmin; dosyada yardımcı yok", () => {
  const src = read("src/server/actions/cash-requests.ts");
  assert.match(src, /^"use server";/);
  const exported = [...src.matchAll(/^export (?:async )?(?:function|const|let|class) (\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(exported.sort(), ["requestCashCorrection", "requestCashDelete", "requestLateCashReport", "reviewCashRequest"].sort());
  for (const fn of ["requestCashCorrection", "requestCashDelete", "requestLateCashReport"]) {
    const body = fnBody(src, fn);
    assert.match(body, /return attempt\(async \(\) => \{\s*const me = await requireUser\(\);\s*if \(me\.role === "admin"\) throw new UserError\(/, fn);
  }
  assert.match(fnBody(src, "reviewCashRequest"), /return attempt\(async \(\) => \{\s*const me = await requireAdmin\(\);/);
  // Yanıtlarda maliyet anahtarı yok
  assertNoCostKeys(src, "cash-requests eylemleri");
});

test("yazım yolu sunucu eylemi değil; gönderim kapıdan 'request' dönerse hiçbir şey yazmadan onaya döner", () => {
  const store = read("src/server/cash/report-store.ts");
  assert.match(store, /^import "server-only";/);
  assert.doesNotMatch(store, /"use server"/);
  const save = store.slice(store.indexOf("export async function saveCashReport"), store.indexOf("export async function removeCashReport"));
  assert.match(save, /staffCashGate\(/);
  assert.match(save, /return \{ kind: "needsApproval" as const, request: "kasa-duzeltme" as const, gate: /);
  assert.ok(save.indexOf("staffCashGate(") < save.indexOf("writeCashReport("), "kapı yazımdan önce");
  // Kendi silme isteği bekleyen rapor düzenlenmez
  assert.match(save, /if \(await ownDeletePending\(tx, me\.id, data\.date\)\) throw new UserError\(CASH_REQUEST_TEXT\.deletePending\)/);
  const action = read("src/server/actions/cash-report.ts");
  assert.match(action, /if \(out\.kind === "needsApproval"\) return \{ needsApproval: true as const, request: out\.request, gate: out\.gate \};/);
  // Silme, aynı günün öteki bekleyen isteklerini kapatır (reddedilmez)
  const remove = store.slice(store.indexOf("export async function removeCashReport"));
  assert.match(remove, /supersede\(tx, \{ kinds: \[[^\]]*"kasa-duzeltme"[^\]]*"kasa-silme"[^\]]*\], day: row\.date, exceptId: o\.exceptRequestId \}, "Rapor silindi"\)/);
});

test("kasa e-postasına personel adresi yazılamaz; personel yükleyicisi başkasının isteğinin yalnız türünü, adını ve anını verir", () => {
  const settings = fnBody(read("src/server/actions/cash-report.ts"), "updateCashSettings");
  assert.match(settings, /await staffEmailsIn\(getDb\(\), valid\)/);
  assert.match(settings, /Bu adres bir personel hesabının; kasa e-postasında karaoke ön ödemesi var\./);
  const loader = read("src/server/data/cash-requests.ts");
  assert.match(loader, /^import "server-only";/);
  const others = loader.slice(loader.indexOf("export async function pendingCashForDay"));
  assert.match(others, /others: rows\.filter\([^)]*\)\.map\(\(r\) => \(\{ kind: r\.kind, requestedByName: r\.requestedByName, createdAt: r\.createdAt\.toISOString\(\) \}\)\)/);
});

test("gün çipi: kısa gün adları karışmaz (Paz / Pzt, Cum / Cmt)", () => {
  assert.deepEqual(
    ["2026-10-18", "2026-10-19", "2026-10-14", "2026-10-16", "2026-10-17"].map(shortDayTR),
    ["18 Eki Paz", "19 Eki Pzt", "14 Eki Çar", "16 Eki Cum", "17 Eki Cmt"],
  );
});
