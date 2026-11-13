// Personel sızıntı denetimi, kasa grubu (plan docs/planlar/personel-yetki.md §6.2): personele giden kasa
// yükleyicilerinde, istemci bileşenlerinde, eylem yanıtlarında ve zil satırlarında maliyet, alış fiyatı, fatura tutarı,
// maaş, kâr, marj, komisyon ya da karaoke parası anahtarı yok; başkasının isteğinden yalnız tür, ad ve an gider.
// Kasa sayfasında ₺ serbesttir (personelin kendi yazdığı sayılar).
// Çalıştırma: npx tsx --test tests/personel-sizinti-kasa.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { cashReportText, revisionChanges, whatsappText } from "../src/lib/cash-report";
import { okcReconcile } from "../src/lib/okc-z";
import { normalizeOkc, toStaffReading } from "../src/lib/photo-read/okc";
import { KasaOkcRaw } from "../src/lib/photo-read/schemas";

import { assertNoCostKeys, MODPOS_ADMIN_KEYS, OKC_ADMIN_KEYS, stripComments } from "./helpers/leak-scan";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

/** Personele giden kasa kaynakları: yükleyiciler, eylemler, zil ve kasa sayfasının istemci bileşenleri */
const STAFF_SOURCES = [
  "src/server/data/cash-requests.ts",
  "src/server/actions/cash-requests.ts",
  "src/server/actions/staff-requests.ts",
  "src/server/bell/kasa.ts",
  "src/lib/cash-requests.ts",
  "src/app/panel/kasa/page.tsx",
  "src/app/panel/kasa/cash-form.tsx",
  "src/app/panel/kasa/cash-requests.tsx",
  "src/app/panel/kasa/cash-revisions.tsx",
  "src/app/panel/kasa/late-report.tsx",
  "src/server/data/cash-late.ts",
  "src/server/cash/late.ts",
  "src/server/data/cash-out-requests.ts",
  "src/server/actions/cash-out-requests.ts",
  "src/server/cash-outs/requests.ts",
  "src/lib/cash-out-requests.ts",
  "src/app/panel/kasa/cash-outs.tsx",
  "src/app/panel/kasa/cash-out-dialog.tsx",
  "src/app/panel/kasa/cash-photos.tsx",
  "src/app/panel/kasa/okc-card.tsx",
  "src/app/panel/kasa/okc-form.ts",
  "src/app/panel/kasa/cash-summary.tsx",
  "src/server/closed-days.ts",
  "src/server/closed-day-requests.ts",
  "src/server/actions/closed-days.ts",
  "src/server/actions/special-days-staff.ts",
  "src/server/staff-special.ts",
  "src/lib/closed-days.ts",
  "src/app/panel/kasa/closed-day.tsx",
  "src/app/panel/ozel-gunler/page.tsx",
  "src/app/panel/ozel-gunler/staff-special-days.tsx",
  // LafPOS'tan doldur (docs/LAFPOS.md): okuyucu ve formun alanlarına eşleme
  "src/server/data/lafpos-day.ts",
  "src/lib/lafpos/prefill.ts",
];

test("kasa: personele giden kaynaklarda maliyet / tutar anahtarı yok", () => {
  for (const f of STAFF_SOURCES) assertNoCostKeys(read(f), f);
});

test("kasa: personelin istek okuyucuları sabit sütunla; başkasının isteğinden yalnız tür, ad ve an; İsteklerim'de yük yok", () => {
  const loader = read("src/server/data/cash-requests.ts");
  const own = loader.slice(loader.indexOf("export async function pendingCashForDay"), loader.indexOf("export async function pendingCashForDayAdmin"));
  // Sabit sütunlar (select({ ... })): satırın tamamı okunmaz
  assert.match(own, /\.select\(\{[\s\S]*?id: s\.staffRequests\.id,[\s\S]*?requestedByName: s\.staffRequests\.requestedByName,\s*\}\)/);
  assert.doesNotMatch(own, /\.select\(\)/);
  assert.match(own, /const mine = \(r: \(typeof rows\)\[number\]\) => r\.requestedBy === me\.id;/);
  const mine = loader.slice(loader.indexOf("export async function myCashRequests"), loader.indexOf("export async function proposedByForReports"));
  assert.doesNotMatch(mine, /payload/);
  // İsteklerim kartı ve zil yükü okumaz (ownRequests sabit sütunlu)
  const core = read("src/server/staff-requests/core.ts");
  const ownRequests = core.slice(core.indexOf("export async function ownRequests"));
  assert.doesNotMatch(ownRequests, /payload/);
  // Personelin zil dalı yalnız kendi isteklerinin sonucunu yazar
  const bell = read("src/server/bell/kasa.ts");
  const staffBranch = bell.slice(bell.indexOf("const today = todayTR(now);"), bell.indexOf("/** Zilin kasa satırları, iki rolde"));
  assert.match(staffBranch, /myCashRequests\(user\.id\)/);
  assert.doesNotMatch(staffBranch, /pendingCashBellRows|loadCashRequestQueue/);
});

test("kasa: yöneticinin kartları yalnız Onaylar'da; personel sayfası yönetici okuyucusunu çağırmaz", () => {
  const page = read("src/app/panel/kasa/page.tsx");
  assert.doesNotMatch(page, /loadCashRequestQueue|pendingCashBellRows/);
  assert.match(page, /admin && showForm \? pendingCashForDayAdmin\(date\)/);
  assert.match(page, /!admin && report \? pendingCashForDay\(date, user\)/);
  const section = read("src/app/panel/onaylar/kasa-section.tsx");
  assert.match(section, /export async function KasaRequests\(\) \{\s*await requireAdmin\(\);/);
});

test("geç rapor: personelin okuyucuları sabit sütunla; başkasının isteğinden yalnız ad ve an; yönetici kartı personel sayfasında yok", () => {
  const loader = read("src/server/data/cash-late.ts");
  assert.match(loader, /^import "server-only";/);
  const own = loader.slice(loader.indexOf("export async function lateRequestFor"), loader.indexOf("export async function lateRequestsByReport"));
  assert.doesNotMatch(own, /\.select\(\)/);
  // Konu gün ve şube (personelin yazdığı şube; KP-X2)
  assert.match(own, /\.where\(and\(eq\(r\.kind, "kasa-gec"\), eq\(r\.subject, cashDaySubject\(date, await currentWriteBranch\(\)\)\)\)\)/);
  // Kişinin kendi isteği (requestedBy === me.id) yükten kurulur; başkalarınınki yalnız ad ve an
  assert.match(own, /const mine = rows\.filter\(\(x\) => x\.requestedBy === me\.id\);/);
  assert.match(own, /others: rows\.filter\(\(x\) => x\.requestedBy !== me\.id && x\.status === "pending"\)\.map\(\(x\) => \(\{ requestedByName: x\.requestedByName, createdAt: x\.createdAt\.toISOString\(\) \}\)\)/);
  const days = loader.slice(loader.indexOf("export async function staffLateDays"), loader.indexOf("export interface OwnLate"));
  assert.doesNotMatch(days, /payload|\.select\(\)/);
  const page = read("src/app/panel/kasa/page.tsx");
  assert.doesNotMatch(page, /lateCards|lateBellRows/);
  const section = read("src/app/panel/onaylar/kasa-section.tsx");
  assert.match(section, /export async function KasaRequests\(\) \{\s*await requireAdmin\(\);/);
});

test("kasadan çıkan istekleri: personelin okuyucuları sabit sütunla; kendi isteğinden yalnız satır, başkasınınkinden yalnız satırın kimliği ve ad", () => {
  const loader = read("src/server/data/cash-out-requests.ts");
  assert.match(loader, /^import "server-only";/);
  const own = loader.slice(loader.indexOf("export async function staffCashOutRequests"), loader.indexOf("export async function photoRemovalStates"));
  assert.doesNotMatch(own, /\.select\(\)/);
  assert.match(own, /\.select\(\{\s*id: r\.id,\s*version: r\.version,\s*createdAt: r\.createdAt,\s*message: r\.message,\s*payload: r\.payload,\s*requestedBy: r\.requestedBy,\s*requestedByName: r\.requestedByName,\s*\}\)/);
  // Kişinin kendi isteği staffCashOutView'dan (kategori, önceki hâl, gider kaydı yok); başkasınınki yalnız kimlik ve ad
  assert.match(own, /view: staffCashOutView\(p\.data\)/);
  assert.match(own, /others\.push\(\{ cashOutId: p\.data\.cashOutId, requestedByName: x\.requestedByName \}\)/);
  assert.doesNotMatch(own, /before|categoryId|expense/);
  // Fotoğraf kaldırma durumları: yalnız bekleyen isteğin konusu okunur
  const removal = loader.slice(loader.indexOf("export async function photoRemovalStates"), loader.indexOf("export async function staffOldCashOutDays"));
  assert.match(removal, /\.select\(\{ subject: r\.subject \}\)/);
  // Yöneticinin kartları ve zil satırı personel sayfasında çağrılmaz
  const page = read("src/app/panel/kasa/page.tsx");
  assert.doesNotMatch(page, /cashOutCards|cashOutBellRow/);
  assert.match(page, /admin \? Promise\.resolve\(null\) : staffCashOutRequests\(date, user\)/);
  // Eylemlerin personele dönüşü yalnız kimlik ve sürüm (fiş eklemede hiçbir şey)
  const actions = read("src/server/actions/cash-out-requests.ts");
  for (const name of ["requestCashOutChange", "requestPhotoRemoval"]) {
    const body = actions.slice(actions.indexOf(`export async function ${name}`));
    assert.match(body.slice(0, 1200), /return \{ id: out\.row\.id, version: out\.row\.version \};/);
  }
  const attach = actions.slice(actions.indexOf("export async function attachCashOutReceipt"), actions.indexOf("const removalSchema"));
  assert.match(attach, /return null;/);
});

test("kapalı gün ve özel günler: personelin okuyucuları sabit sütunla, yalnız special_days ve staff_requests", () => {
  const src = read("src/server/closed-days.ts");
  const state = src.slice(src.indexOf("export async function staffClosedState"), src.indexOf("export async function ownClosedRequests"));
  assert.doesNotMatch(state, /\.select\(\)/);
  // Şube konudan (gün ve şube; KP-05): yük okunmaz
  assert.match(state, /\.select\(\{ id: s\.staffRequests\.id, subject: s\.staffRequests\.subject, status: s\.staffRequests\.status, requestedBy: s\.staffRequests\.requestedBy, requestedByName: s\.staffRequests\.requestedByName, reviewNote: s\.staffRequests\.reviewNote \}\)/);
  assert.doesNotMatch(state, /payload/);
  const own = src.slice(src.indexOf("export async function ownClosedRequests"), src.indexOf("export interface ClosedDayCard"));
  assert.match(own, /\.select\(\{ id: s\.staffRequests\.id, day: s\.staffRequests\.day, status: s\.staffRequests\.status, reviewNote: s\.staffRequests\.reviewNote, createdAt: s\.staffRequests\.createdAt \}\)/);
  assert.match(own, /eq\(s\.staffRequests\.requestedBy, me\.id\)/);
  const list = read("src/server/staff-special.ts");
  const loader = list.slice(list.indexOf("export async function staffSpecialList"));
  for (const t of loader.matchAll(/\.from\(s\.(\w+)\)/g)) assert.equal(t[1], "specialDays");
  // Yöneticinin kartları (kanıt) personel sayfasında çağrılmaz
  for (const f of ["src/app/panel/kasa/page.tsx", "src/app/panel/ozel-gunler/page.tsx"]) assert.doesNotMatch(read(f), /closedDayCards|pendingClosedRows|closedInfoRows/);
  // Kasa sayfasında kanıt yalnız yönetici dalında okunur
  const page = read("src/app/panel/kasa/page.tsx");
  const bar = page.slice(page.indexOf("async function closedBarFor"));
  assert.match(bar, /if \(admin\) \{\s*const evidence = marked \? null : await closedDayEvidence\(getDb\(\), date, branchId\);/);
});

/**
 * Yazarkasanın (banka POS) mali Z'si (docs/planlar/okc-z.md İlke 8, D13, D17, §11): kümülatif sayaç, yazarkasa dışı
 * tahsilat ve yöneticinin karşılaştırma satırları (toplam, nakit, yemek kartı, banka) personele gitmez. COST_KEYS
 * bunları kapsamaz; liste helpers/leak-scan.ts'te (OKC_ADMIN_KEYS). Çalışan sunucunun RSC yükünü scripts/personel-sizinti.ts
 * aynı listeyle tarar
 */
const OKC_ADMIN_LINES = ["okc-total", "okc-cash", "okc-meal", "okc-bank"] as const;
const keyRe = (k: string) => new RegExp(`(?:^|[^A-Za-z0-9_$])"?${k}"?\\s*:`, "m");

test("yazarkasa Z'si: personelin kartında kümülatif, toplam dışı tahsilat ve yöneticinin karşılaştırma satırı yok", () => {
  const card = stripComments(read("src/app/panel/kasa/okc-card.tsx"));
  for (const k of OKC_ADMIN_KEYS) assert.doesNotMatch(card, keyRe(k), `okc-card.tsx: ${k}`);
  for (const k of OKC_ADMIN_LINES) assert.ok(!card.includes(k), `okc-card.tsx: ${k}`);
  // Karşılaştırma satırları kime göre: kart personelde "staff" ile çağırır (yönetici formu düzenlerken "admin")
  assert.match(card, /okcReconcile\(\{[^\n]*\}, audience, kasa\)/);
  const form = read("src/app/panel/kasa/cash-form.tsx");
  assert.match(form, /audience=\{photoUi\.admin \? "admin" : "staff"\}/);
  // Kayıtlı raporun kümülatif satırı yalnız yönetici dalında
  const summary = read("src/app/panel/kasa/cash-summary.tsx");
  assert.match(summary, /\{audience === "admin" && okcAdmin \? <OkcCumulative view=\{okcAdmin\} \/> : null\}/);
});

test("yazarkasa Z'si: kasa sayfası personele önceki Z'den yalnız gün ve numarayı, DTO'yu kime göre verir", () => {
  const page = read("src/app/panel/kasa/page.tsx");
  // Önceki yazarkasa Z'si forma yalnız `.z` ({ date, zNo }) olarak; kümülatif (`.cum`) yalnız yöneticinin satırında
  assert.match(page, /prevOkcZ=\{prevOkc\.z\}/g);
  assert.equal([...page.matchAll(/prevOkcZ=\{([^}]*)\}/g)].filter((m) => m[1] !== "prevOkc.z").length, 0);
  assert.match(page, /\{\.\.\.\(admin && report \? \{ okcAdmin: okcAdminView\(/);
  assert.match(page, /getCashReport\(date, user\.role\)/);
  // DTO: sunucu sütunları yalnız "admin" ile
  const dto = read("src/server/data/cash-reports.ts");
  assert.match(dto, /if \(audience === "admin"\) return \{ \.\.\.dto, okcCumTotal: r\.okcCumTotal, okcCumVat: r\.okcCumVat, okcOutside: r\.okcOutside \};/);
  // Personele toplam dışı tahsilatın yalnız var olduğu (tutarsız işaret; okc-z.ts K4 fazlayı tutmadı saymaz)
  assert.match(dto, /return r\.okcOutside !== null && r\.okcOutside > 1 \? \{ \.\.\.dto, okcExtraTakings: true \} : dto;/);
});

test("yazarkasa Z'si: personelin okuma yanıtında kümülatif ve yöneticinin satırları yok; karşılaştırmada yalnız kart ve kendi içinde", () => {
  const rec = JSON.parse(read("tests/fixtures/foto/okc.json")) as { json: unknown };
  const reading = normalizeOkc(KasaOkcRaw.parse(rec.json), { day: "2026-10-21", prev: { z: { date: "2026-10-20", zNo: "0187" }, cum: { date: "2026-10-20", zNo: "0187", cumTotal: 1247050, cumVat: 117731.82 } } });
  assert.ok(reading.okcAdmin?.cumTotal, "yöneticinin okumasında kümülatif var");
  const staff = JSON.stringify(toStaffReading(reading));
  for (const k of OKC_ADMIN_KEYS) assert.doesNotMatch(staff, new RegExp(`"${k}":`), `okuma: ${k}`);
  assert.ok(!staff.includes("1.259.350") && !staff.includes("1259350"), "kümülatif rakamı metinde de yok");
  const fields = { zTotal: 12975.5, cash: 3420.5, card: 8915, mealCard: 640, online: 500, other: 0, bankPos: 8900, okcZNo: "0188", okcTotal: 12300, okcCash: 3180, okcCard: 8480, okcMealCard: 640, okcOther: 0 };
  assert.deepEqual(
    okcReconcile(fields, "staff").map((l) => l.key),
    ["okc-card"],
  );
  assert.deepEqual(
    okcReconcile({ ...fields, okcCash: 3000 }, "staff").map((l) => l.key),
    ["okc-card", "okc-self"],
  );
  assert.ok(okcReconcile(fields, "admin").some((l) => (OKC_ADMIN_LINES as readonly string[]).includes(l.key)));
});

test("yazarkasa Z'si: WhatsApp metni (personel de gönderir) yöneticinin satırlarını taşımaz; e-postanın yönetici metni yalnız şablonda", () => {
  const f = {
    date: "2026-10-21",
    zNo: "1235",
    receipts: 151,
    zTotal: 13095.5,
    cash: 2745,
    card: 8915,
    mealCard: 0,
    online: 1435.5,
    other: 0,
    openingCash: 500,
    cashIn: 0,
    cashOut: 0,
    cashOutNote: null,
    countedCash: 3245,
    handedOver: 0,
    bankPos: 8900,
    offRevenue: null,
    note: null,
    okcZNo: "0188",
    okcReceipts: 143,
    okcTotal: 11540,
    okcVatTotal: 1049.09,
    okcVat: [{ rate: 10, total: 11540, vat: 1049.09 }],
    okcCash: 2000,
    okcCard: 8915,
    okcMealCard: 0,
    okcOther: 0,
  };
  const t = whatsappText(f, { by: "Ayşe" });
  const admin = okcReconcile(f, "admin").filter((l) => l.key !== "okc-card");
  assert.ok(admin.length >= 3, "yöneticinin satırları var (nakit, toplam, banka, kendi içinde)");
  for (const l of admin) assert.ok(!t.includes(l.text), `WhatsApp: ${l.key}`);
  // Yazarkasanın günlük toplamı ve KDV'si WhatsApp'ta yok (ModPOS toplamıyla farkı çıkarılamasın)
  assert.ok(!/11\.540|1\.049|Günlük toplam|KDV/.test(t.replace(/ /g, " ")));
  // Yöneticinin metni (cashReportText "admin") yalnız e-posta şablonunda; personelin yolları whatsappText'i çağırır
  for (const file of ["src/server/actions/cash-report.ts", "src/app/panel/kasa/page.tsx", "src/app/panel/kasa/cash-history.tsx"]) {
    assert.doesNotMatch(read(file), /cashReportText/, file);
  }
  assert.match(read("src/server/notify/cash-report-template.ts"), /cashReportText\(f, meta, "admin"\)/);
  assert.match(read("src/lib/cash-report.ts"), /return cashReportText\(f, meta, "staff"\);/);

  // Düzeltilen rapor (sürüm 2): "Değişen" satırında yazarkasanın toplamı, KDV'si, fiş sayısı, yemek kartı ve diğeri
  // yalnız adıyla; Z no, nakit ve kart bloktaki gibi değeriyle. "Fotoğraftan farklı"da fiş sayısı da yalnız adıyla
  const after = { ...f, okcTotal: 11_640.5, okcVatTotal: 1058.23, okcReceipts: 147, okcMealCard: 100, okcOther: 0.5, okcCard: 8915.5, okcVat: [{ rate: 10, total: 11_640.5, vat: 1058.23 }] };
  const changes = revisionChanges({ ...f, cashDiff: 0, countedByName: null }, { ...after, cashDiff: 0, countedByName: null });
  assert.ok(["okcTotal", "okcVatTotal", "okcReceipts", "okcMealCard", "okcOther", "okcVat", "okcCard"].every((k) => changes.some((c) => c.key === k)));
  const photoDiffs = [{ field: "okcReceipts" as const, label: "Yazarkasa fiş sayısı", photo: 149, saved: 147, confidence: "high" as const, excused: false }];
  const t2 = whatsappText(after, { by: "Ayşe", revision: 2, changes, photoDiffs }).replace(/\u00a0/g, " ");
  for (const v of ["11.540", "11.640,50", "1.049,09", "1.058,23", "143", "147", "149", "100 ₺", "0,50 ₺"]) assert.ok(!t2.includes(v), `WhatsApp (sürüm 2): ${v}\n${t2}`);
  for (const l of ["Yazarkasa toplam değişti", "Yazarkasa KDV değişti", "Yazarkasa fiş sayısı değişti", "Yazarkasa yemek kartı değişti", "Yazarkasa diğer değişti", "KDV dökümü değişti"]) assert.ok(t2.includes(l), l);
  assert.ok(t2.includes("Yazarkasa kart 8.915 ₺ → 8.915,50 ₺"), t2);
  assert.match(t2, /Fotoğraftan farklı yazılan: Yazarkasa fiş sayısı(;|\n|$)/);
  // Yöneticinin metninde (e-posta) değerleriyle
  const a2 = cashReportText(after, { by: "Ayşe", revision: 2, changes, photoDiffs }, "admin").replace(/\u00a0/g, " ");
  assert.ok(a2.includes("Yazarkasa toplam 11.540 ₺ → 11.640,50 ₺") && a2.includes("Yazarkasa fiş sayısı (fotoğrafta 149)"), a2);
});

test("LafPOS'tan doldur: personelin okuyucusu yalnız Z ve geliş anı (sabit sütun); ödeme kanalları ve ikram okunmaz", () => {
  const loader = stripComments(read("src/server/data/lafpos-day.ts"));
  assert.match(loader, /^import "server-only";/);
  assert.match(loader, /\.select\(\{ z: s\.posDayReports\.z, receivedAt: s\.posDayReports\.receivedAt \}\)/);
  assert.doesNotMatch(loader, /\.select\(\)|payments|ikram|posDailySales/);
  // Forma giden yalnız formun alanları: kasa farkı (LafPOS'un hesabı) da gitmez, form kendisi hesaplar
  const prefill = read("src/lib/lafpos/prefill.ts");
  const map = prefill.slice(prefill.indexOf("export function lafposPrefill"), prefill.indexOf("export function lafposSummary"));
  const keys = [...map.matchAll(/put\("(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, ["zNo", "receipts", "zTotal", "cash", "card", "mealCard", "online", "other", "offRevenue", "discounts", "openingCash", "cashIn", "cashOut", "countedCash", "handedOver"]);
});

/**
 * ModPOS kasa föyü (docs/MODPOS-API.md › Nerede görünür) yalnız yöneticinin Kasa ekranında: personele giden kaynaklarda
 * föyün anahtarları yok. Kasa sayfası (yönetici dalı) ve zil (yönetici dalı) iki role çizer: sayfanın dalları
 * tests/modpos-kasa.test.ts'te, çalışan sunucunun yükü scripts/personel-sizinti.ts'te aynı listeyle taranır
 */
test("ModPOS API: personele giden kasa kaynaklarında föyün anahtarları yok", () => {
  const twoRoles = new Set(["src/app/panel/kasa/page.tsx", "src/server/bell/kasa.ts"]);
  for (const f of STAFF_SOURCES) {
    if (twoRoles.has(f)) continue;
    const src = stripComments(read(f));
    for (const k of MODPOS_ADMIN_KEYS) assert.doesNotMatch(src, keyRe(k), `${f}: ${k}`);
    assert.doesNotMatch(src, /modpos-sheet|modpos-diffs|modpos-day|cash-modpos/, f);
  }
  // Sayfanın personel dalı föyün okuyucusunu ve kartını bilmez
  const page = read("src/app/panel/kasa/page.tsx");
  const staff = page.slice(page.indexOf("  if (!admin) {\n    return ("), page.indexOf("  const ay = pick(sp.ay);"));
  assert.ok(staff.length > 100);
  assert.doesNotMatch(staff, /loadKasaModpos|ModposSections|ModposSheetCard|LadminReportCard|modposDays/);
});
