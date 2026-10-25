// Personel sızıntı denetimi, operasyon grubu (plan docs/planlar/personel-yetki.md §6.2): personele giden operasyon
// yükleyicilerinde, istemci bileşenlerinde, eylem yanıtlarında ve zil satırlarında maliyet, alış fiyatı, fatura tutarı,
// maaş, kâr, marj, komisyon ya da karaoke parası anahtarı yok. Kasadaki fiyatlar'da ₺ serbesttir (herkese açık satış
// fiyatı); kontrol geçmişi ve zayi ekranlarında ₺ yoktur.
// Çalıştırma: npx tsx --test tests/personel-sizinti-ops.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { assertNoCostKeys, assertNoLira, stripComments } from "./helpers/leak-scan";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

/** Personele giden operasyon kaynakları: yükleyiciler, eylemler, zil ve istemci bileşenleri */
const STAFF_SOURCES = [
  // Kasadaki fiyatlar (§2.2)
  "src/server/data/pos-staff.ts",
  "src/server/actions/pos-marks.ts",
  "src/server/prices/pos-marks.ts",
  "src/components/panel/pos-checklist.tsx",
  "src/app/panel/kasa/fiyatlar/page.tsx",
  "src/server/bell/ops.ts",
  "src/server/data/today-ops.ts",
  "src/app/panel/bugun/rows-ops.ts",
  // Kontrol geçmişi (§2.5)
  "src/app/panel/kontrol/gecmis/page.tsx",
  "src/app/panel/kontrol/run-view.tsx",
  // Geç zayi / ikram ve silme isteği (§2.8)
  "src/lib/waste-requests.ts",
  "src/server/waste/core.ts",
  "src/server/actions/waste.ts",
  "src/app/panel/zayi/waste-board.tsx",
  "src/app/panel/zayi/day-picker.tsx",
];

test("operasyon: personele giden kaynaklarda maliyet / tutar anahtarı yok", () => {
  for (const f of STAFF_SOURCES) assertNoCostKeys(read(f), f);
});

test("kasadaki fiyatlar: personel sayfası yalnız personelin yükleyicisinden; eylem yanıtında yalnız ad, satış fiyatı ve kimlik", () => {
  const page = read("src/app/panel/kasa/fiyatlar/page.tsx");
  assert.match(page, /from "@\/server\/data\/pos-staff"/);
  assert.doesNotMatch(page, /@\/server\/data\/prices|@\/server\/data\/dataset|loadModel/);
  // Eylemlerin dönüşü: işaretin kimliği, ürün, ad ve satış fiyatı; geri almada sayı ve nedenler
  const actions = read("src/server/actions/pos-marks.ts");
  const mark = actions.slice(actions.indexOf("export async function markPosDone"), actions.indexOf("export async function undoPosMarks"));
  assert.match(mark, /done: r\.done\.map\(\(d\) => \(\{ markId: d\.markId, productId: d\.productId, label: d\.label, price: d\.price \}\)\)/);
  const undo = actions.slice(actions.indexOf("export async function undoPosMarks"));
  assert.match(undo, /return \{ undone: r\.undone\.length, refused: r\.refused\.map\(\(x\) => \(\{ label: x\.label, reason: x\.reason \}\)\) \};/);
  // Bileşen: personel yüzünde kaynak, kişi ve not yok (StaffPosItem); yönetici tipi yalnız tip olarak
  const comp = stripComments(read("src/components/panel/pos-checklist.tsx"));
  assert.doesNotMatch(comp.replace(/^import type .*$/gm, ""), /@\/server\/data\/prices/);
});

test("kontrol geçmişi: personel sayfasında tutar yok", () => {
  assertNoLira(stripComments(read("src/app/panel/kontrol/gecmis/page.tsx")), "kontrol geçmişi");
  assertNoLira(stripComments(read("src/app/panel/kontrol/run-view.tsx")), "kontrol geçmişi satırı");
});

test("zayi: personelin okuyucuları, eylem yanıtları ve sayfasının personel dalı tutarsız; ekranda ₺ yok", () => {
  const loader = read("src/server/data/waste-requests.ts");
  const staffPart = loader.slice(0, loader.indexOf("// ---------------------------------------------------------------- Yönetici"));
  assert.ok(staffPart.includes("export async function myWasteRequests") && staffPart.includes("export async function wasteDayMarks"));
  assertNoCostKeys(staffPart, "zayi isteklerinin personel okuyucuları");
  const actions = read("src/server/actions/waste-requests.ts");
  assertNoCostKeys(actions.slice(0, actions.indexOf("export async function reviewWasteRequest")), "zayi istek eylemleri");
  // Sayfa: personel dalı yönetici özetinden (WasteMonth, maliyet) önce döner; formda ve günde ₺ yok
  const page = read("src/app/panel/zayi/page.tsx");
  const content = page.slice(page.indexOf("async function WasteContent"), page.indexOf("/** Yöneticinin ay özeti"));
  assertNoCostKeys(content, "zayi sayfası");
  assertNoLira(stripComments(content), "zayi sayfası");
  for (const f of ["src/app/panel/zayi/waste-board.tsx", "src/app/panel/zayi/day-picker.tsx", "src/lib/waste-requests.ts"]) assertNoLira(stripComments(read(f)), f);
});
