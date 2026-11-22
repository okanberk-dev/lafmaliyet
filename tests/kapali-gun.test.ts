// Kapalı gün ve personelin özel günleri (saf; plan docs/planlar/personel-yetki.md §2.9; docs/KASA-RAPORU.md › Kafe
// kapalıydı, docs/OZEL-GUNLER.md): closedDaysIn, ay bilgisi ve komisyonda kapalı günler,
// Bugün'ün dünkü kasa ve kontrol satırlarının dört durumu, personelin özel gün sınırları, kanıtın kuralları (işlem
// geçmişinde sayılmayanlar, Z no boşluğu, açılış, kırmızı satırlar), modelde personelin "Bilmiyorum" günü ve kaynak
// denetimleri (eylemlerin rolleri, personel sayfasının prop'ları, sabit sütunlu okuyucular).
// Çalıştırma: npx tsx --test tests/kapali-gun.test.ts

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { dayTasks, type DayFacts, type DayTask } from "../src/app/panel/bugun/logic";
import { missingSentence, tillMonths } from "../src/lib/cash-month";
import { CLOSED_FOLLOW_UP_TEXT, closedFollowUp, staffResultBell } from "../src/lib/cash-requests";
import {
  closedBellTitle,
  closedDaysIn,
  closedEvidenceText,
  consecutiveRuns,
  EMPTY_EVIDENCE,
  EVIDENCE_IGNORED_ACTIONS,
  hasPanelEvidence,
  isEvidenceAction,
  mergeBranchContinuity,
  openingText,
  STAFF_SPECIAL_TEXT,
  staffSpecialCheck,
  staffSpecialLine,
  zGapOf,
} from "../src/lib/closed-days";
import type { ChecklistLite } from "../src/lib/checklists";
import { channelTill } from "../src/lib/commission/report";
import { assertNoCostKeys } from "./helpers/leak-scan";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const tr = (local: string) => new Date(`${local}:00+03:00`);
const sp = (v: string) => v.replace(/ /g, " ");

test("closedDaysIn: yalnız kapalı satırlar, aralıkla kırpılır, raporu olan gün kapalı sayılmaz", () => {
  const special = [
    { kind: "kapali", dateFrom: "2026-11-03", dateTo: "2026-11-05" },
    { kind: "derbi", dateFrom: "2026-11-04", dateTo: "2026-11-04" },
    { kind: "kapali", dateFrom: "2026-10-30", dateTo: "2026-11-01" },
  ];
  assert.deepEqual(closedDaysIn(special, "2026-11-01", "2026-11-30"), ["2026-11-01", "2026-11-03", "2026-11-04", "2026-11-05"]);
  assert.deepEqual(closedDaysIn(special, "2026-11-01", "2026-11-30", ["2026-11-04"]), ["2026-11-01", "2026-11-03", "2026-11-05"]);
  assert.deepEqual(closedDaysIn(special, "2026-11-10", "2026-11-01"), []);
  assert.deepEqual(consecutiveRuns(["2026-11-05", "2026-11-03", "2026-11-04", "2026-11-09"]), [
    { from: "2026-11-03", to: "2026-11-05", days: ["2026-11-03", "2026-11-04", "2026-11-05"] },
    { from: "2026-11-09", to: "2026-11-09", days: ["2026-11-09"] },
  ]);
});

test("ay bilgisi ve komisyon: kapalı günler eksik sayılmaz, ayrı cümleyle yazılır", () => {
  const row = (date: string) => ({ date, zTotal: 1000, card: 500, mealCard: 0, discounts: null, offRevenue: null });
  const rows = ["2026-11-01", "2026-11-02", "2026-11-06"].map(row);
  const [nov] = tillMonths(rows, "2026-11-06", null, [], ["2026-11-03", "2026-11-04"]);
  assert.deepEqual(nov.missing, ["2026-11-05"]);
  assert.deepEqual(nov.closed, ["2026-11-03", "2026-11-04"]);
  assert.equal(sp(missingSentence(nov)), "1 gün rapor yok: 5 Kasım. O günler açıksanız ciro ve açık gün eksik kalır. 2 gün kapalı işaretli: 3, 4 Kasım.");
  assert.equal(sp(missingSentence({ missing: [], closed: ["2026-11-03"] })), "1 gün kapalı işaretli: 3 Kasım.");
  // Yükleyici kapalı gün vermezse alan yok (eski davranış)
  assert.equal("closed" in tillMonths(rows, "2026-11-06")[0], false);
  const till = channelTill(
    rows.map((r) => ({ date: r.date, mealCard: 0, online: 0 })),
    "2026-11",
    "2026-11-06",
    null,
    ["2026-11-03", "2026-11-04"],
  );
  assert.deepEqual(till.missing, ["2026-11-05"]);
  assert.deepEqual(till.closed, ["2026-11-03", "2026-11-04"]);
  // Komisyonun alt satırı kapalı günleri sessizce düşürmez
  const texts = read("src/app/panel/komisyonlar/texts.ts");
  assert.match(texts, /`\$\{g\.closed\.length\} gün kapalı`/);
});

// ---------------------------------------------------------------- Bugün

const NOON = tr("2026-10-22T14:00");
const STOCK = { month: "2026-10", counted: 0, total: 40, prevMonth: "2026-09", prevHasData: true, prevCounted: 40, prevTotal: 40 };
const cash = { today: null, yesterday: null, firstDate: "2026-10-01" };
const staff = (o: Partial<DayFacts> = {}): DayFacts => ({ role: "staff", now: NOON, cash, waste: { count: 0, zayi: null, ikram: null }, stock: STOCK, ...o });
const admin = (o: Partial<DayFacts> = {}): DayFacts => ({ role: "admin", now: NOON, cash, stock: STOCK, system: [], payments: [], invoices: { review: 0 }, ...o });
const row = (tasks: DayTask[], key: string) => tasks.find((t) => t.key === key) ?? null;
const closed = (state: "approved" | "pending" | "rejected", note: string | null = null): DayFacts["closed"] => ({ yesterday: { state, by: "Ahmet", requestId: 7, note } });

test("Bugün › dünkü kasa raporu: bildirim yok, bekliyor, onaylandı, reddedildi (iki rol)", () => {
  // Yok: personele "kapalıysa … “Kafe kapalıydı” deyin"
  assert.match(row(dayTasks(staff()), "kasa-dun")!.detail, /kapalıysa raporun sayfasında “Kafe kapalıydı” deyin/);
  // Bekliyor
  const sp1 = row(dayTasks(staff({ closed: closed("pending") })), "kasa-dun")!;
  assert.equal(sp1.status, "todo");
  assert.equal(sp1.badge, "Onayda");
  assert.equal(sp1.detail, "Ahmet kapalıydı dedi (onay bekliyor). Kafe açıktıysa raporu bugün girin; yarından itibaren yöneticinin onayıyla girilir.");
  const ad1 = row(dayTasks(admin({ closed: closed("pending") })), "kasa-dun")!;
  assert.equal(ad1.badge, "Onay bekliyor");
  assert.equal(ad1.action, "Onaya bak");
  assert.equal(ad1.href, "/panel/onaylar#istek-7");
  // Onaylandı: iki rolde satır yok
  assert.equal(row(dayTasks(staff({ closed: closed("approved") })), "kasa-dun"), null);
  assert.equal(row(dayTasks(admin({ closed: closed("approved") })), "kasa-dun"), null);
  // Reddedildi: personele yöneticinin notu; yöneticide olağan "Girilmedi"
  const sp2 = row(dayTasks(staff({ closed: closed("rejected", "Z raporu çıkmış") })), "kasa-dun")!;
  assert.equal(sp2.detail, "Yönetici bildirimi reddetti: Z raporu çıkmış. Raporu bugün girin.");
  assert.equal(row(dayTasks(staff({ closed: closed("rejected") })), "kasa-dun")!.detail, "Yönetici bildirimi reddetti. Raporu bugün girin.");
  assert.equal(row(dayTasks(admin({ closed: closed("rejected") })), "kasa-dun")!.badge, "Girilmedi");
});

function list(name: string, run: boolean): ChecklistLite {
  return {
    templateId: name.length,
    name,
    opensAt: "08:00",
    dueAt: "11:00",
    required: 11,
    photos: 0,
    staffAllowed: true,
    run: run ? { required: 11, done: 3, complete: false, photosLeft: 0, photos: 0, missing: [], issues: [], contributors: ["Ayşe"], firstAt: NOON.toISOString(), lastAt: NOON.toISOString() } : null,
  } as ChecklistLite;
}

test("Bugün › dünkü kontrol listeleri (yönetici): onaylı kapalıda açılmamış liste satır değil; bekleyende 'Onaya bak'", () => {
  const yesterday = { day: "2026-10-21", lists: [list("Açılış", false), list("Kapanış", false)] };
  assert.ok(row(dayTasks(admin({ checklistsYesterday: yesterday })), "liste-dun"));
  assert.equal(row(dayTasks(admin({ checklistsYesterday: yesterday, closed: closed("approved") })), "liste-dun"), null);
  // Açılmış bir liste varsa kapalı olsa da görünür (kanıt)
  assert.ok(row(dayTasks(admin({ checklistsYesterday: { day: "2026-10-21", lists: [list("Açılış", true)] }, closed: closed("approved") })), "liste-dun"));
  const pend = row(dayTasks(admin({ checklistsYesterday: yesterday, closed: closed("pending") })), "liste-dun")!;
  assert.match(pend.detail, /· Personel kapalıydık dedi \(onay bekliyor\)$/);
  assert.equal(pend.action, "Onaya bak");
  assert.equal(pend.href, "/panel/onaylar#istek-7");
});

// ---------------------------------------------------------------- Personelin özel günleri

test("personelin özel günü: tür, etki, ad, sıra, yarından, 3 gün, 60 gün, çakışma, 14 gün, düzenleme kilidi, günlük 20", () => {
  const ok = { kind: "derbi", title: "Derbi", dateFrom: "2026-10-25", dateTo: "2026-10-25", effect: 0.15 };
  const ctx = { today: "2026-10-22", ownFutureDays: 0, overlapping: [] as string[], writesToday: 0 };
  const T = STAFF_SPECIAL_TEXT;
  assert.equal(staffSpecialCheck(ok, ctx), null);
  assert.equal(staffSpecialCheck({ ...ok, effect: 0 }, ctx), null);
  assert.equal(staffSpecialCheck({ ...ok, effect: -0.15 }, ctx), null);
  assert.equal(staffSpecialCheck({ ...ok, kind: "kapali" }, ctx), T.kind);
  assert.equal(staffSpecialCheck({ ...ok, effect: 0.3 }, ctx), T.effect);
  assert.equal(staffSpecialCheck({ ...ok, title: "  " }, ctx), "Ad gerekli");
  assert.equal(staffSpecialCheck({ ...ok, dateTo: "2026-10-24" }, ctx), "Bitiş başlangıçtan önce olamaz");
  // Takvimde olmayan gün (biçimi doğru olsa da) kaydedilmez
  assert.equal(staffSpecialCheck({ ...ok, dateFrom: "2026-10-32", dateTo: "2026-10-32" }, ctx), T.date);
  assert.equal(staffSpecialCheck({ ...ok, dateFrom: "2026-11-30", dateTo: "2026-11-31" }, { ...ctx, today: "2026-11-13" }), T.date);
  assert.equal(staffSpecialCheck({ ...ok, dateFrom: "2026-10-22", dateTo: "2026-10-22" }, ctx), T.tomorrow);
  assert.equal(staffSpecialCheck({ ...ok, dateFrom: "2026-10-23", dateTo: "2026-10-25" }, ctx), null);
  assert.equal(staffSpecialCheck({ ...ok, dateFrom: "2026-10-23", dateTo: "2026-10-26" }, ctx), "En çok 3 gün seçilebilir");
  assert.equal(staffSpecialCheck({ ...ok, dateFrom: "2026-12-21", dateTo: "2026-12-21" }, ctx), null);
  assert.equal(staffSpecialCheck({ ...ok, dateFrom: "2026-12-22", dateTo: "2026-12-22" }, ctx), "En çok 60 gün ileriye girilebilir");
  assert.equal(staffSpecialCheck(ok, { ...ctx, overlapping: ["Kampanya"] }), "Bu günlerde zaten bir özel gün var: Kampanya");
  assert.equal(staffSpecialCheck({ ...ok, dateTo: "2026-10-27" }, { ...ctx, ownFutureDays: 11 }), null);
  assert.equal(staffSpecialCheck({ ...ok, dateTo: "2026-10-27" }, { ...ctx, ownFutureDays: 12 }), "Gelecekte en çok 14 gün işaretleyebilirsiniz");
  for (const editing of [{ started: true, adminTouched: false, own: true }, { started: false, adminTouched: true, own: true }, { started: false, adminTouched: false, own: false }]) {
    assert.equal(staffSpecialCheck(ok, { ...ctx, editing }), "Başlamış ya da yöneticinin düzenlediği özel gün değiştirilemez");
  }
  assert.equal(staffSpecialCheck(ok, { ...ctx, editing: { started: false, adminTouched: false, own: true } }), null);
  assert.equal(staffSpecialCheck(ok, { ...ctx, writesToday: 20 }), T.daily);
  assert.equal(staffSpecialLine("25 Eki Cmt", "Derbi / maç · +%15", "Ahmet"), "25 Eki Cmt · Derbi / maç · +%15 · Ahmet ekledi");
  for (const t of Object.values(T)) assert.doesNotMatch(typeof t === "string" ? t : t("x"), /—/);
});


// ---------------------------------------------------------------- Kanıt

test("kanıt: işlem geçmişinde hesap ve hatırlatıcı sayılmaz; silme sayılır", () => {
  for (const a of ["Parola değiştirildi", "Hesap bilgileri değişti", "İki adımlı doğrulama açıldı", "Kurtarma kodları yenilendi", "Diğer cihazlardaki oturumlar kapatıldı", "Hatırlatıcı eklendi", "Özel gün", "Kapalı gün bildirildi", "Bildirim ayarları"]) {
    assert.equal(isEvidenceAction(a), false, a);
  }
  for (const a of ["Kasadan çıkan silindi", "Zayi kaydı silindi", "Kasa raporu", "Kontrol listesi", "Karaoke sayacı silindi"]) assert.equal(isEvidenceAction(a), true, a);
  assert.ok(EVIDENCE_IGNORED_ACTIONS.includes("Hatırlatıcı"));
});

test("kanıt: Z no boşluğu, açılış sürekliliği, kırmızı satırlar ve personelin isteğinin kapısı", () => {
  const prev = { date: "2026-10-21", zNo: "1305" };
  const next = { date: "2026-10-23", zNo: "1307" };
  assert.equal(zGapOf("2026-10-22", prev, next, 0)?.level, "red");
  assert.equal(zGapOf("2026-10-22", prev, next, 1)?.level, "warn");
  assert.equal(zGapOf("2026-10-22", prev, { ...next, zNo: "1306" }, 0), null);
  assert.equal(zGapOf("2026-10-22", prev, { ...next, zNo: "Z-1" }, 0), null);
  assert.equal(zGapOf("2026-10-22", null, next, 0), null);
  assert.equal(sp(openingText({ date: "2026-10-21", carry: 1100 }, { date: "2026-10-23", opening: 1100 })!.text), "23 Ekim açılışı 21 Ekim devriyle tutuyor");
  assert.equal(sp(openingText({ date: "2026-10-21", carry: 1100 }, { date: "2026-10-23", opening: 500 })!.text), "23 Ekim açılışı 21 Ekim devriyle tutmuyor: 600 ₺ az");
  assert.deepEqual(closedEvidenceText(EMPTY_EVIDENCE), { red: [], warn: [], info: [] });
  const e = { ...EMPTY_EVIDENCE, cashOuts: 2, karaoke: 1, staffWrites: 3, zGap: { level: "red" as const, text: "Z eksik" }, site: { cafe: 4, manual: 0, counter: 1, shop: 2 } };
  const lines = closedEvidenceText(e);
  assert.deepEqual(lines.red, ["2 kasadan çıkan satırı", "1 karaoke oturumu", "İşlem geçmişinde personelin 3 kaydı", "Z eksik", "Sitede 4 kafe siparişi", "Kasada ödenen 1 uygulama siparişi"]);
  assert.deepEqual(lines.info, ["Sitede 2 mağaza siparişi (kargo; kafe açıklığını göstermez)"]);
  // Açılış farkı yalnız uyarı
  assert.deepEqual(closedEvidenceText({ ...EMPTY_EVIDENCE, opening: { ok: false, text: "tutmuyor" } }), { red: [], warn: ["tutmuyor"], info: [] });
  // Personelin isteği: panelde iz yoksa açılır (site yöneticinin kartında)
  assert.equal(hasPanelEvidence(EMPTY_EVIDENCE), false);
  assert.equal(hasPanelEvidence({ ...EMPTY_EVIDENCE, waste: 1 }), true);
  assert.equal(hasPanelEvidence({ ...EMPTY_EVIDENCE, zGap: { level: "warn", text: "x" } }), false);
  assert.equal(hasPanelEvidence({ ...EMPTY_EVIDENCE, site: { cafe: 3, manual: 0, counter: 0, shop: 0 } }), false);
  // Kanıtta tutar yok
  for (const l of [...lines.red, ...lines.info]) assert.doesNotMatch(l, /₺/);
  assert.equal(closedBellTitle("23 Eki Per", "revoked"), "23 Eki Per: kapalı gün geri alındı");
});

test("kanıt şube başına (denetim 21 Kasım #1): Z no ve açılış aynı şubenin raporlarıyla, şubelerin sonucu birleşir", () => {
  // Tuzla 1240 → 1241 (arada yalnız bu gün: boşluk yok), Marina 30 → 31; şubeler arası karşılaştırma (30 → 1241) kırmızıydı
  const tuzla = {
    zGap: zGapOf("2026-11-18", { date: "2026-11-17", zNo: "1240" }, { date: "2026-11-19", zNo: "1241" }, 0),
    opening: openingText({ date: "2026-11-17", carry: 1100 }, { date: "2026-11-19", opening: 1100 }),
  };
  const marina = {
    zGap: zGapOf("2026-11-18", { date: "2026-11-17", zNo: "0030" }, { date: "2026-11-19", zNo: "0031" }, 0),
    opening: openingText({ date: "2026-11-17", carry: 400 }, { date: "2026-11-19", opening: 400 }),
  };
  assert.equal(zGapOf("2026-11-18", { date: "2026-11-17", zNo: "0030" }, { date: "2026-11-19", zNo: "1241" }, 0)?.level, "red", "eski hata: Marina'nın Z'si Tuzla'nınkiyle");
  const both = mergeBranchContinuity([marina, tuzla]);
  assert.equal(both.zGap, null);
  assert.equal(both.opening?.ok, true);
  assert.equal(hasPanelEvidence({ ...EMPTY_EVIDENCE, ...both }), false);
  // Bir şubede kırmızı: kırmızı (öteki şubenin uyarısı ya da boşluğu yokken de)
  const red = { zGap: { level: "red" as const, text: "Z no 1240 (17 Kas) ile 1242 (19 Kas) arasında 1 Z eksik" }, opening: null };
  const warn = { zGap: { level: "warn" as const, text: "uyarı" }, opening: { ok: false, text: "tutmuyor" } };
  assert.deepEqual(mergeBranchContinuity([marina, warn, red]).zGap, red.zGap);
  assert.deepEqual(mergeBranchContinuity([marina, warn]).zGap, warn.zGap);
  assert.equal(hasPanelEvidence({ ...EMPTY_EVIDENCE, ...mergeBranchContinuity([tuzla, red]) }), true);
  // Açılış: ilk tutmayan, yoksa ilk tutan
  assert.deepEqual(mergeBranchContinuity([tuzla, warn]).opening, warn.opening);
  assert.deepEqual(mergeBranchContinuity([tuzla, marina]).opening, tuzla.opening);
  // Komşu raporu olan şube yok
  assert.deepEqual(mergeBranchContinuity([]), { zGap: null, opening: null });
});

// ---------------------------------------------------------------- Kaynak

test("kaynak (denetim 21 Kasım #1): kapalı günün Z no ve açılış sürekliliği ile fotoğrafın Z sırası raporun kendi şubesinden", () => {
  const src = read("src/server/closed-days.ts");
  const next = src.slice(src.indexOf("export async function onNextReport"), src.indexOf("// ---------------------------------------------------------------- Okuyucular"));
  assert.match(next, /report: \{ date: string; branchId: string; zNo: string \| null; openingCash: number \}/);
  assert.match(next, /\.where\(and\(lt\(s\.cashReports\.date, day\), eq\(s\.cashReports\.branchId, report\.branchId\)\)\)/);
  const evidence = src.slice(src.indexOf("export async function closedDayEvidence"), src.indexOf("/** İşlem geçmişine"));
  // Önceki ve sonraki rapor şube başına (DISTINCT ON branch_id), şubeler mergeBranchContinuity ile birleşir
  assert.equal([...evidence.matchAll(/\.selectDistinctOn\(\[s\.cashReports\.branchId\]/g)].length, 2);
  assert.match(evidence, /\.orderBy\(asc\(s\.cashReports\.branchId\), desc\(s\.cashReports\.date\)\)/);
  assert.match(evidence, /\.orderBy\(asc\(s\.cashReports\.branchId\), asc\(s\.cashReports\.date\)\)/);
  assert.match(evidence, /mergeBranchContinuity\(/);
  // writeCashReport raporun kendisini (şubesiyle) verir
  assert.match(read("src/server/cash/report-store.ts"), /await onNextReport\(tx, row\);/);
  // Fotoğraftan okunan ModPOS Z'sinin "eski bir Z raporu" denetimi formun kasasının önceki raporuyla
  const photo = read("src/server/photo-read/read.ts");
  const prevZ = photo.slice(photo.indexOf("async function previousZNo"), photo.indexOf("async function okcTypical"));
  assert.match(prevZ, /eq\(s\.cashReports\.branchId, await currentTillBranch\(\)\)/);
});

test("kaynak: eylemler kendi oturumunu ve rolünü denetler; yardımcı dışa verilmez", () => {
  const closedActions = read("src/server/actions/closed-days.ts");
  assert.match(closedActions, /^"use server";/);
  assert.deepEqual([...closedActions.matchAll(/^export (?:async function|function|const) (\w+)/gm)].map((m) => m[1]).sort(), ["markClosedDay", "requestClosedDay", "reviewClosedDay"]);
  const body = (src: string, name: string) => src.slice(src.indexOf(`export async function ${name}`));
  assert.match(body(closedActions, "requestClosedDay"), /^export async function \w+\([^)]*\) \{\s*return attempt\(async \(\) => \{\s*const me = await requireUser\(\);\s*if \(me\.role === "admin"\) throw new UserError/);
  for (const n of ["reviewClosedDay", "markClosedDay"]) assert.match(body(closedActions, n), /^export async function \w+\([^)]*\) \{\s*return attempt\(async \(\) => \{\s*const me = await requireAdmin\(\);/);
  const special = read("src/server/actions/special-days-staff.ts");
  assert.match(special, /^"use server";/);
  assert.deepEqual([...special.matchAll(/^export (?:async function|function|const) (\w+)/gm)].map((m) => m[1]).sort(), ["deleteStaffSpecialDay", "saveStaffSpecialDay"]);
  for (const n of ["saveStaffSpecialDay", "deleteStaffSpecialDay"]) {
    assert.match(body(special, n), /^export async function \w+\([^)]*\) \{\s*return attempt\(async \(\) => \{\s*const me = await requireUser\(\);\s*if \(me\.role === "admin"\) throw new UserError/);
  }
  // Personelin özel gün dönüşü yalnız kimlik; tutar ve tahmin yok
  assert.match(body(special, "saveStaffSpecialDay"), /return \{ id: out\.id \};/);
  assertNoCostKeys(special, "special-days-staff.ts");
  // Dalga 9'un eylemleri personelinkiyle aynı danışma kilidini alır, yöneticinin düzenlemesi updated_by yazar
  const forecast = read("src/server/actions/special-days.ts");
  assert.equal([...forecast.matchAll(/await lockSpecialDays\(tx\);/g)].length, 2);
  assert.match(forecast, /updatedBy: me\.id, updatedByName: me\.name/);
  assert.match(read("src/server/closed-days.ts"), /pg_advisory_xact_lock\(hashtext\('ozel-gun'\)\)/);
});

test("kaynak: /panel/ozel-gunler prop'larında kindHistory, tutar ve gerçekleşen etki yok; okuyucu sabit sütunlu", () => {
  const page = read("src/app/panel/ozel-gunler/page.tsx");
  const client = read("src/app/panel/ozel-gunler/staff-special-days.tsx");
  for (const src of [page, client]) {
    assert.doesNotMatch(src, /kindHistory|amount|realised|realized|actual/);
    assertNoCostKeys(src, "ozel-gunler");
  }
  // Yönetici de aynı ekranda (satış tahmini kalkınca listesi buraya taşındı). Rol Suspense'in İÇİNDE okunur:
  // sayfanın gövdesinde okunursa ön üretim düşer (next build "uncached or runtime data during prerendering").
  assert.match(page, /user\.role === "admin" \? <AdminContent \/> : <StaffContent \/>/);
  assert.match(page, /export default function SpecialDaysPage\(\)/, "sayfa eşzamanlı olmalı: rolü Suspense içindeki bileşen okur");
  assert.match(page, /<StaffSpecialDays\s+rows=\{rows\}\s+closed=\{closed\}\s+today=\{today\}\s+minDate=\{[^}]+\}\s+maxDate=\{[^}]+\}\s+saveAction=\{saveStaffSpecialDay\}\s+deleteAction=\{deleteStaffSpecialDay\}\s+\/>/);
  const loader = read("src/server/staff-special.ts");
  const list = loader.slice(loader.indexOf("export async function staffSpecialList"));
  assert.doesNotMatch(list, /\.select\(\)/);
  // Başkasının notu gitmez
  assert.match(list, /note: own \? r\.note : null/);
  assert.match(read("src/app/panel/ozel-gunler/special-days.tsx"), /<Card id="ozel-gunler"/);
});

test("zil: reddedilen ya da geri alınan kapalı gün bildirimi; gün personelde, geç rapor penceresinde ya da yalnız yöneticide", () => {
  // 25 Ekim Cumartesi 10:00: dün 24'ü (personelde), 22'si geç rapor penceresinde (dünden eski, son 14 gün), 10'u dışında
  const now = tr("2026-10-25T10:00");
  assert.equal(closedFollowUp("2026-10-24", now, false), "staff");
  assert.equal(closedFollowUp("2026-10-22", now, false), "late");
  assert.equal(closedFollowUp("2026-10-11", now, false), "late");
  assert.equal(closedFollowUp("2026-10-10", now, false), "admin");
  // Gün raporlu (işaret rapor girildiği için kalktı): girilecek rapor yok, zil kendi metnini yazar
  assert.equal(closedFollowUp("2026-10-22", now, true), "staff");
  assert.equal(closedFollowUp("2026-10-10", now, true), "staff");
  assert.equal(CLOSED_FOLLOW_UP_TEXT.late, "Kafe açıktıysa raporu Z fotoğrafıyla geç rapor olarak girin; yönetici onaylar.");
  assert.equal(CLOSED_FOLLOW_UP_TEXT.admin, "Raporu yönetici girecek; Z raporunu yöneticiye iletin.");
  // Notsuz geri alma: gün personeldeyken metin "raporu yönetici girecek" demez
  assert.equal(staffResultBell({ kind: "kapali-gun", status: "revoked", day: "2026-10-24", note: null }).body, "Kapalı işareti kalktı; raporu girin");
  const bell = read("src/server/bell/kasa.ts");
  assert.match(bell, /const follow = r\.kind === "kapali-gun" && r\.status !== "approved" \? closedFollowUp\(r\.day!, now, reported\.has\(r\.day!\)\) : "staff";/);
  assert.match(bell, /body: follow === "staff" \? t\.body : CLOSED_FOLLOW_UP_TEXT\[follow\],/);
  assert.match(bell, /href: follow === "late" \|\| staffCanReport\(r\.day!, now\) \? `\/panel\/kasa\?gun=\$\{r\.day\}` : "\/panel\/kasa#isteklerim",/);
});

// Denetim 21 Kasım #23: satış tahmini (/panel/tahmin) 4 Kasım 2026'da kalktı; özel günler /panel/ozel-gunler'de
test("zil: personelin özel gün satırı Özel günler ekranına götürür (kaldırılan /panel/tahmin'e değil)", () => {
  const bell = read("src/server/bell/kasa.ts");
  assert.match(bell, /href: verb \? "\/panel\/ozel-gunler#ozel-gunler" : "\/panel\/kasa",/);
  assert.match(read("src/app/panel/ozel-gunler/special-days.tsx"), /<Card id="ozel-gunler"/);
  assert.ok(!existsSync(join(process.cwd(), "src/app/panel/tahmin")), "ekran kalktı");
  // Kapalı gün ve özel gün metinlerinde kaldırılan ekranın yolu ya da adı kalmadı
  assert.doesNotMatch(bell.replace(/^\s*\/\/.*$/gm, ""), /\/panel\/tahmin/);
  for (const f of ["src/server/closed-days.ts", "src/lib/closed-days.ts"]) assert.doesNotMatch(read(f), /\/panel\/tahmin|Satış tahmini ›/, f);
});
