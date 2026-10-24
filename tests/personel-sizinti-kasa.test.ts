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
