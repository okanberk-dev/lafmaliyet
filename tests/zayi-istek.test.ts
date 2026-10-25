// Geç zayi / ikram ve silme isteği (plan docs/planlar/personel-yetki.md §2.8; docs/ZAYI-IKRAM.md › Geç kayıt ve
// silme isteği): personelin doğrudan yolu bugün ve dün (dünün kasa raporu kilitlenene kadar, staffDayEditable), 14 güne
// kadar geriye istek, öncesi kapalı; silmenin kipi sunucuda hesaplanır; personel metinlerinde tutar yok. Kaynak
// denetimleri: eylemlerin rolleri, personel yükleyicisinde ham yük ve fiyat yok, istemcide kip hesabı yok.
// Saatler sabit: tr("2026-10-24T14:00") Türkiye'de 24 Ekim Cumartesi 14:00 (UTC+3).
// Çalıştırma: npx tsx --test tests/zayi-istek.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  LATE_WINDOW_DAYS,
  lateWasteDays,
  lateWasteTitle,
  staffDeleteMode,
  staffWasteMode,
  staffWasteResult,
  WASTE_REQUEST_TEXT,
  wasteDayLabel,
  wasteDeletedNotice,
  wasteDeleteTitle,
  wasteEntryMatches,
  wasteItemText,
} from "../src/lib/waste-requests";
import { assertNoCostKeys, assertNoLira, stripComments } from "./helpers/leak-scan";

const tr = (local: string) => new Date(`${local}:00+03:00`);
const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const NOW = tr("2026-10-24T14:00");
const OPEN = { hasReport: false, laterReport: false };
const LOCKED = { hasReport: true, laterReport: true };

test("doğrudan, istek ya da kapalı: bugün ve dün (kilitlenene kadar) doğrudan, 14 güne kadar istek", () => {
  assert.equal(LATE_WINDOW_DAYS, 14);
  assert.equal(staffWasteMode("2026-10-24", NOW, OPEN), "direct");
  // Bugünün raporu girilmiş olsa da bugün açık
  assert.equal(staffWasteMode("2026-10-24", NOW, { hasReport: true, laterReport: false }), "direct");
  // Dün: raporu var ama bugünün raporu yok → açık; ikisi de var → kilitli, istek
  assert.equal(staffWasteMode("2026-10-23", NOW, { hasReport: true, laterReport: false }), "direct");
  assert.equal(staffWasteMode("2026-10-23", NOW, LOCKED), "request");
  // Unutulan dün (raporu yok): bugünün raporu girilse de açık (kasanın kuralı)
  assert.equal(staffWasteMode("2026-10-23", NOW, { hasReport: false, laterReport: true }), "direct");
  // Önceki günler 14 güne kadar istek
  assert.equal(staffWasteMode("2026-10-22", NOW, OPEN), "request");
  assert.equal(staffWasteMode("2026-10-10", NOW, OPEN), "request");
  assert.equal(staffWasteMode("2026-10-09", NOW, OPEN), "closed");
  // İleri gün kapalı
  assert.equal(staffWasteMode("2026-10-25", NOW, OPEN), "closed");
  // Gece 05:00'ten önce iş günü dündür: 25 Ekim 03:00'te bugün 24, dün 23
  const night = tr("2026-10-25T03:00");
  assert.equal(staffWasteMode("2026-10-24", night, OPEN), "direct");
  assert.equal(staffWasteMode("2026-10-23", night, OPEN), "direct");
  assert.equal(staffWasteMode("2026-10-25", night, OPEN), "closed");
  assert.equal(staffWasteMode("2026-10-10", night, OPEN), "request");
  assert.equal(staffWasteMode("2026-10-09", tr("2026-10-24T05:00"), OPEN), "closed");
  // Ay sınırı: 1 Kasım'da 31 Ekim dün, 18 Ekim on dört gün önce
  const nov = tr("2026-11-01T10:00");
  assert.equal(staffWasteMode("2026-10-31", nov, OPEN), "direct");
  assert.equal(staffWasteMode("2026-10-31", nov, LOCKED), "request");
  assert.equal(staffWasteMode("2026-10-18", nov, OPEN), "request");
  assert.equal(staffWasteMode("2026-10-17", nov, OPEN), "closed");
});

test("silmenin kipi: kendi kaydı doğrudan yolda silinir; başkasının ya da kilitli günün kaydı istek; eskisi yok", () => {
  const me = { id: 2 };
  assert.equal(staffDeleteMode({ date: "2026-10-24", createdBy: 2 }, me, NOW, OPEN), "direct");
  assert.equal(staffDeleteMode({ date: "2026-10-24", createdBy: 3 }, me, NOW, OPEN), "request");
  assert.equal(staffDeleteMode({ date: "2026-10-24", createdBy: null }, me, NOW, OPEN), "request");
  assert.equal(staffDeleteMode({ date: "2026-10-23", createdBy: 2 }, me, NOW, { hasReport: true, laterReport: false }), "direct");
  assert.equal(staffDeleteMode({ date: "2026-10-23", createdBy: 2 }, me, NOW, LOCKED), "request");
  assert.equal(staffDeleteMode({ date: "2026-10-15", createdBy: 2 }, me, NOW, OPEN), "request");
  assert.equal(staffDeleteMode({ date: "2026-10-09", createdBy: 2 }, me, NOW, OPEN), "none");
});

test("önceki gün seçicisi: dünden önceki 13 gün, '22 Eki Per' … '10 Eki Cmt'", () => {
  const days = lateWasteDays(NOW);
  assert.equal(days.length, 13);
  assert.equal(days[0], "2026-10-22");
  assert.equal(days.at(-1), "2026-10-10");
  assert.equal(wasteDayLabel("2026-10-22"), "22 Eki Per");
  assert.equal(wasteDayLabel("2026-10-10"), "10 Eki Cmt");
  // Gece yarısından sonra iş günüyle
  assert.equal(lateWasteDays(tr("2026-10-25T03:00"))[0], "2026-10-22");
});

test("metinler: kalem, başlık, zil; hiçbirinde tutar yok", () => {
  assert.equal(wasteItemText({ name: "Latte M", qty: 2, unit: "adet" }), "2× Latte M");
  assert.equal(wasteItemText({ name: "Süt", qty: 1.5, unit: "LT" }), "Süt 1,5 LT");
  const late = { kind: "zayi" as const, name: "Latte M", qty: 2, unit: "adet", date: "2026-10-15" };
  assert.equal(lateWasteTitle(late), "Geç zayi: 2× Latte M · 15 Eki");
  assert.equal(lateWasteTitle({ ...late, kind: "ikram" }), "Geç ikram: 2× Latte M · 15 Eki");
  assert.equal(wasteDeleteTitle({ kind: "zayi", name: "Süt", qty: 1.5, unit: "LT", date: "2026-10-15" }), "Zayi silme: Süt 1,5 LT · 15 Eki");
  const item = { item: "2× Latte M", day: "2026-10-15" };
  assert.equal(staffWasteResult({ kind: "zayi-gec", status: "approved", ...item, note: null }).title, "Geç kayıt onaylandı: 2× Latte M (15 Eki)");
  assert.equal(staffWasteResult({ kind: "zayi-gec", status: "rejected", ...item, note: "O gün girilmiş" }).title, "Geç kayıt reddedildi: 2× Latte M (15 Eki)");
  assert.equal(staffWasteResult({ kind: "zayi-gec", status: "rejected", ...item, note: "O gün girilmiş" }).body, "Not: O gün girilmiş");
  assert.equal(staffWasteResult({ kind: "zayi-sil", status: "approved", item: "Süt 1,5 LT", day: "2026-10-15", note: null }).title, "Silme onaylandı: Süt 1,5 LT (15 Eki)");
  assert.equal(staffWasteResult({ kind: "zayi-sil", status: "rejected", item: "Süt 1,5 LT", day: "2026-10-15", note: null }).title, "Silme reddedildi: Süt 1,5 LT (15 Eki)");
  assert.equal(staffWasteResult({ kind: "zayi-sil", status: "superseded", item: "Süt 1,5 LT", day: "2026-10-15", note: WASTE_REQUEST_TEXT.deleted }).body, WASTE_REQUEST_TEXT.deleted);
  assert.equal(wasteDeletedNotice({ item: "Süt 1,5 LT", day: "2026-10-15", by: "Ayşe" }), "Kaydınız silindi: Süt 1,5 LT (15 Eki) · Ayşe istedi");
  const texts = [
    ...Object.values(WASTE_REQUEST_TEXT),
    lateWasteTitle(late),
    wasteDeletedNotice({ item: "Süt 1,5 LT", day: "2026-10-15", by: "Ayşe" }),
    ...(["approved", "rejected", "superseded"] as const).flatMap((status) =>
      (["zayi-gec", "zayi-sil"] as const).flatMap((kind) => Object.values(staffWasteResult({ kind, status, ...item, note: null }))),
    ),
  ];
  for (const t of texts) assertNoLira(t, t);
  assert.equal(WASTE_REQUEST_TEXT.windowOld, "Bu gün 14 günden eski; yalnız yönetici girer");
  assert.equal(WASTE_REQUEST_TEXT.sameRequest, "Aynı istek bekliyor; miktarı birleştirmek için geri çekip yeniden gönderin");
  assert.equal(WASTE_REQUEST_TEXT.gone, "Kayıt zaten silinmişti");
});

test("silme isteğinin kaydı: gün, tür, ad, miktar, birim, giren ve an tutmalı", () => {
  const entry = { date: "2026-10-15", kind: "zayi" as const, name: "Süt", qty: 1.5, unit: "LT", reason: null, note: null, createdBy: 3, createdByName: "Mehmet", createdAt: "2026-10-15T18:40:00.000Z" };
  const row = { ...entry, createdAt: new Date(entry.createdAt) };
  assert.ok(wasteEntryMatches(entry, row));
  // Neden ve not yönetici düzeltmiş olabilir: kimliği değiştirmez
  assert.ok(wasteEntryMatches(entry, { ...row, reason: "Diğer", note: "x" }));
  for (const change of [{ qty: 2 }, { name: "Süt (laktozsuz)" }, { unit: "ML" }, { createdBy: 4 }, { kind: "ikram" as const }, { date: "2026-10-16" }, { createdAt: new Date("2026-10-15T18:41:00.000Z") }]) {
    assert.equal(wasteEntryMatches(entry, { ...row, ...change }), false, JSON.stringify(change));
  }
});

test("kaynak: eylemlerin rolleri; kip sunucuda; personel yükleyicisi ham yük ve fiyat döndürmez", () => {
  const actions = read("src/server/actions/waste-requests.ts");
  assert.ok(actions.startsWith('"use server";'));
  const exported = [...actions.matchAll(/^export (async function|const|function|class|let|type|interface) (\w+)/gm)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(exported.sort(), ["async function requestLateWaste", "async function requestWasteDelete", "async function reviewWasteRequest"]);
  const body = (name: string) => actions.slice(actions.indexOf(`export async function ${name}`)).slice(0, 300);
  assert.match(body("requestLateWaste"), /return attempt\(async \(\) => \{\s+const me = await requireUser\(\);/);
  assert.match(body("requestWasteDelete"), /return attempt\(async \(\) => \{\s+const me = await requireUser\(\);/);
  assert.match(body("reviewWasteRequest"), /return attempt\(async \(\) => \{\s+const me = await requireAdmin\(\);/);
  // Personelin çağırdığı eylemlerin yanıtında yalnız isteğin kimliği ve sürümü
  const staffPart = actions.slice(actions.indexOf("export async function requestLateWaste"), actions.indexOf("export async function reviewWasteRequest"));
  assertNoCostKeys(staffPart, "istek eylemleri");
  for (const m of staffPart.matchAll(/return \{([^}]*)\};/g)) assert.match(m[1].trim(), /^id: [\w.]+, version: [\w.]+$/, m[1]);
  // Doğrudan yazım ve silme çekirdekte, kipin kurallarıyla; kapalı güne personel yazamaz
  const core = read("src/server/waste/core.ts");
  assert.match(core, /staffWasteMode\(/);
  assert.match(core, /staffDeleteMode\(/);
  assert.match(core, /closedDayRefusal\(/);
  const waste = read("src/server/actions/waste.ts");
  assert.match(waste, /addWaste\(getDb\(\), me,/);
  assert.match(waste, /removeWaste\(getDb\(\), me,/);
  // Personel yükleyicisi: yalnız zayi türleri, yükten beyaz listeyle (ad, birim, miktar, gün, tür, neden)
  const loader = read("src/server/data/waste-requests.ts");
  assert.match(loader, /^import "server-only";/);
  const mine = loader.slice(loader.indexOf("export async function myWasteRequests"), loader.indexOf("// ---------------------------------------------------------------- Yönetici"));
  assert.ok(mine.length > 200, "myWasteRequests ve personelin öteki okuyucuları yöneticininkilerden önce");
  assert.match(mine, /inArray\(s\.staffRequests\.kind, \["zayi-gec", "zayi-sil"\]\)/);
  assert.match(mine, /const lite = \(p: Record<string, unknown>\) => \(\{ name: p\.name, unit: p\.unit, qty: p\.qty, date: p\.date, kind: p\.kind, reason: p\.reason \}\)/);
  assert.doesNotMatch(mine.replace(/const lite = .*$/m, ""), /payload: /);
  assertNoCostKeys(mine, "personel yükleyicisi");
  assert.doesNotMatch(mine, /price|cost|loadModel/i);
  // İstemci kipi hesaplamaz: sunucudan gelen deleteModes
  const board = stripComments(read("src/app/panel/zayi/waste-board.tsx"));
  assert.doesNotMatch(board, /canDelete|staffDeleteMode\(|staffWasteMode\(/);
  assert.match(board, /deleteModes\[e\.id\]/);
  assertNoLira(board, "zayi formu");
  // Yöneticinin onay kartı maliyeti aynı fonksiyondan (engine wasteCost)
  assert.match(read("src/lib/calc/engine.ts"), /function wasteCost\(/);
  assert.match(read("src/app/panel/zayi/page.tsx"), /model\.wasteCost\(e\)/);
});
