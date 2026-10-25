// Personel sızıntı denetimi, kasa grubu (plan docs/planlar/personel-yetki.md §6.2): personele giden kasa
// yükleyicilerinde, istemci bileşenlerinde, eylem yanıtlarında ve zil satırlarında maliyet, alış fiyatı, fatura tutarı,
// maaş, kâr, marj, komisyon ya da karaoke parası anahtarı yok; başkasının isteğinden yalnız tür, ad ve an gider.
// Kasa sayfasında ₺ serbesttir (personelin kendi yazdığı sayılar).
// Çalıştırma: npx tsx --test tests/personel-sizinti-kasa.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { assertNoCostKeys } from "./helpers/leak-scan";

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
  "src/server/closed-days.ts",
  "src/server/closed-day-requests.ts",
  "src/server/actions/closed-days.ts",
  "src/server/actions/special-days-staff.ts",
  "src/server/forecast/staff-special.ts",
  "src/lib/closed-days.ts",
  "src/app/panel/kasa/closed-day.tsx",
  "src/app/panel/ozel-gunler/page.tsx",
  "src/app/panel/ozel-gunler/staff-special-days.tsx",
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
  assert.match(own, /\.where\(and\(eq\(r\.kind, "kasa-gec"\), eq\(r\.subject, `gun:\$\{date\}`\)\)\)/);
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
  assert.match(state, /\.select\(\{ id: s\.staffRequests\.id, status: s\.staffRequests\.status, requestedBy: s\.staffRequests\.requestedBy, requestedByName: s\.staffRequests\.requestedByName, reviewNote: s\.staffRequests\.reviewNote \}\)/);
  const own = src.slice(src.indexOf("export async function ownClosedRequests"), src.indexOf("export interface ClosedDayCard"));
  assert.match(own, /\.select\(\{ id: s\.staffRequests\.id, day: s\.staffRequests\.day, status: s\.staffRequests\.status, reviewNote: s\.staffRequests\.reviewNote, createdAt: s\.staffRequests\.createdAt \}\)/);
  assert.match(own, /eq\(s\.staffRequests\.requestedBy, me\.id\)/);
  const list = read("src/server/forecast/staff-special.ts");
  const loader = list.slice(list.indexOf("export async function staffSpecialList"));
  for (const t of loader.matchAll(/\.from\(s\.(\w+)\)/g)) assert.equal(t[1], "specialDays");
  // Yöneticinin kartları (kanıt) personel sayfasında çağrılmaz
  for (const f of ["src/app/panel/kasa/page.tsx", "src/app/panel/ozel-gunler/page.tsx"]) assert.doesNotMatch(read(f), /closedDayCards|pendingClosedRows|closedInfoRows/);
  // Kasa sayfasında kanıt yalnız yönetici dalında okunur
  const page = read("src/app/panel/kasa/page.tsx");
  const bar = page.slice(page.indexOf("async function closedBarFor"));
  assert.match(bar, /if \(admin\) \{\s*const evidence = marked \? null : await closedDayEvidence\(getDb\(\), date\);/);
});
