// Kontrol listeleri (src/lib/checklists.ts, src/lib/checklist-seed.ts): iş günü ve saat aralığı (05:00'te döner,
// 22:00–02:00 geçerli), listenin durumu, hangi gün beklendiği, ölçümün aralığı ve yazımı, kaydın özeti (eksik, kalan
// fotoğraf, sorunlar, yanıt verenler), sürümler, kim doldurur ve fotoğrafı kim görür, zil, sabah e-postasının kutusu,
// Bugün'ün yenileme anları, hazır listeler ve kaynak denetimleri (yetki, fotoğraf yolu, para yok).
// Saatler sabit: tr("2026-10-22T14:00") Türkiye'de 22 Ekim Perşembe 14:00 (UTC+3).
// Çalıştırma: npx tsx --test tests/kontrol-listeleri.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { DEFAULT_CHECKLISTS } from "../src/lib/checklist-seed";
import { businessDate } from "../src/lib/cash-report";
import {
  absentReason,
  activityChange,
  appliesOn,
  businessMinuteOfClock,
  canAnswerDay,
  checklistBell,
  checklistBoundaries,
  checklistDay,
  clockInstant,
  earlyStart,
  groupBySection,
  historyRange,
  inRange,
  isStarted,
  kontrolDigestBox,
  lateFinish,
  listState,
  listTitle,
  lowerFirst,
  MAX_HISTORY,
  MAX_ITEMS,
  MAX_PHOTO_ITEMS,
  nextVersions,
  nowBusinessMinute,
  openedBetween,
  parseClock,
  parseReading,
  photoAccess,
  photoVersionText,
  PHOTO_PRIVACY_HINT,
  rangeText,
  runSummary,
  signMode,
  snapshotItems,
  STAFF_HISTORY_DAYS,
  staffHistoryFloor,
  staffSeesRun,
  staffSinceChange,
  timeTR,
  valueText,
  weekdayOf,
  weekdaysText,
  whoText,
  windowError,
  type AnswerLite,
  type ChecklistItemSnap,
  type ChecklistLite,
  type RunLite,
} from "../src/lib/checklists";
import { renderDigest } from "../src/server/notify/digest-template";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** Türkiye saatiyle an: "2026-10-22T14:00" */
const tr = (local: string) => new Date(`${local}:00+03:00`);
const iso = (local: string) => tr(local).toISOString();
const bm = (local: string) => nowBusinessMinute(tr(local));

function item(id: number, o: Partial<ChecklistItemSnap> = {}): ChecklistItemSnap {
  return { id, label: `Madde ${id}`, type: "check", section: null, hint: null, required: true, unit: null, min: null, max: null, ...o };
}

function answer(itemId: number, o: Partial<AnswerLite> = {}): AnswerLite {
  return { id: itemId * 10, itemId, status: "ok", value: null, textValue: null, note: null, photoId: null, photoAt: null, by: "Ayşe", at: iso("2026-10-22T09:00"), history: [], ...o };
}

const FRIDGE = item(2, { label: "Bar buzdolabı sıcaklığı", type: "number", unit: "°C", min: 0, max: 4 });

/** Bir günün listesi: kayıt yoksa `run` null */
function list(templateId: number, name: string, opensAt: string, dueAt: string, run: Partial<RunLite> | null = null, o: Partial<ChecklistLite> = {}): ChecklistLite {
  return {
    templateId,
    name,
    opensAt,
    dueAt,
    required: run?.required ?? 11,
    photos: 2,
    staffAllowed: true,
    run: run
      ? {
          required: 11,
          done: 0,
          complete: false,
          photosLeft: 0,
          photos: 0,
          missing: [],
          issues: [],
          contributors: ["Ayşe"],
          firstAt: iso("2026-10-22T08:40"),
          lastAt: iso("2026-10-22T08:50"),
          completedAt: null,
          ...run,
        }
      : null,
    ...o,
  };
}

// ---------------------------------------------------------------- Saat ve gün

test("1. saat: iş dakikası 05:00'ten (05:00 → 0, 04:59 → 1439, 22:00 → 1020, 02:00 → 1260); gün kasa raporununkiyle aynı", () => {
  assert.equal(parseClock("08:00"), 480);
  assert.equal(parseClock("23:59"), 1439);
  for (const bad of ["8:00", "24:00", "08:60", "", "08.00", null]) assert.equal(parseClock(bad), null, String(bad));
  assert.equal(businessMinuteOfClock(parseClock("05:00")!), 0);
  assert.equal(businessMinuteOfClock(parseClock("04:59")!), 1439);
  assert.equal(businessMinuteOfClock(parseClock("22:00")!), 1020);
  assert.equal(businessMinuteOfClock(parseClock("02:00")!), 1260);
  assert.equal(bm("2026-10-22T05:00"), 0);
  assert.equal(bm("2026-10-23T04:59"), 1439);
  assert.equal(bm("2026-10-22T14:00"), 540);
  for (const at of ["2026-10-23T04:59", "2026-10-23T05:00", "2026-10-22T12:00", "2026-10-22T23:59", "2026-10-22T00:30"]) {
    assert.equal(checklistDay(tr(at)), businessDate(tr(at)), at);
  }
  assert.equal(checklistDay(tr("2026-10-23T01:30")), "2026-10-22");
  // Kapanışın 02:00'si ertesi takvim günü; son saat 05:00 günün sonu
  assert.equal(clockInstant("2026-10-22", "02:00", true).toISOString(), iso("2026-10-23T02:00"));
  assert.equal(clockInstant("2026-10-22", "08:00").toISOString(), iso("2026-10-22T08:00"));
  assert.equal(clockInstant("2026-10-22", "05:00", true).toISOString(), iso("2026-10-23T05:00"));
  assert.equal(timeTR(iso("2026-10-23T01:07")), "01:07");
});

test("2. saat aralığı: gece yarısını geçebilir, 05:00'i geçemez; en az 15 dakika", () => {
  assert.equal(windowError("08:00", "11:00"), null);
  assert.equal(windowError("22:00", "02:00"), null);
  assert.equal(windowError("22:00", "05:00"), null);
  for (const [o, d] of [
    ["11:00", "08:00"],
    ["04:00", "06:00"],
    ["08:00", "08:00"],
  ]) {
    assert.equal(windowError(o, d), "Son saat başlangıçtan sonra olmalı (gün 05:00'te döner)", `${o}–${d}`);
  }
  assert.equal(windowError("08:00", "08:10"), "Aralık en az 15 dakika olmalı");
  assert.equal(windowError("08:00", "08:15"), null);
  assert.equal(windowError("8", "11:00"), "Saati 08:00 biçiminde yazın");
});

test("3. durum: Açılış (07:00 sonra, 09:00 açık, 12:00 gecikti, tamam) ve Kapanış (21:00 sonra, 23:30 ve 01:00 açık, 03:00 gecikti, ertesi gün yapılmadı)", () => {
  const acilis = list(1, "Açılış", "08:00", "11:00");
  assert.equal(listState(acilis, bm("2026-10-22T07:00"), false), "before");
  assert.equal(listState(acilis, bm("2026-10-22T09:00"), false), "open");
  assert.equal(listState(acilis, bm("2026-10-22T10:59"), false), "open");
  assert.equal(listState(acilis, bm("2026-10-22T11:00"), false), "overdue");
  assert.equal(listState(acilis, bm("2026-10-22T12:00"), false), "overdue");
  assert.equal(listState(list(1, "Açılış", "08:00", "11:00", { complete: true, done: 11 }), bm("2026-10-22T12:00"), false), "done");
  const kapanis = list(2, "Kapanış", "22:00", "02:00");
  assert.equal(listState(kapanis, bm("2026-10-22T21:00"), false), "before");
  assert.equal(listState(kapanis, bm("2026-10-22T23:30"), false), "open");
  assert.equal(listState(kapanis, bm("2026-10-23T01:00"), false), "open");
  assert.equal(listState(kapanis, bm("2026-10-23T03:00"), false), "overdue");
  assert.equal(listState(kapanis, 0, true), "missed");
  // Aralıktan önce başlanan liste "sonra" değil, açık (erken doldurma kilitli değil)
  const early = list(2, "Kapanış", "22:00", "02:00", { done: 2 });
  assert.equal(listState(early, bm("2026-10-22T10:00"), false), "open");
  assert.equal(isStarted(early), true);
  // Kaydı açılıp bütün yanıtları geri alınan liste başlamamış sayılır
  assert.equal(listState(list(2, "Kapanış", "22:00", "02:00", { lastAt: null, firstAt: null }), bm("2026-10-22T10:00"), false), "before");
});

test("4. hangi gün beklenir: haftanın günü iş gününden; gün içinde eklenen liste aralığı geçtiyse o gün beklenmez; pasife alınan beklenmez", () => {
  // 24 Ekim Cumartesi 01:30: iş günü hâlâ Cuma; Kapanış Cuma'nınki
  assert.equal(checklistDay(tr("2026-10-24T01:30")), "2026-10-23");
  assert.equal(weekdayOf("2026-10-23"), 5);
  assert.equal(weekdayOf("2026-10-25"), 7);
  const friday = { weekdays: [5], opensAt: "22:00", activeFrom: iso("2026-10-01T09:00"), inactiveFrom: null };
  assert.equal(appliesOn(friday, "2026-10-23"), true);
  assert.equal(appliesOn(friday, "2026-10-24"), false);
  // 22 Ekim 14:00'te eklendi: Açılış (08:00) yarından, Kapanış (22:00) bugünden
  const added = { weekdays: [1, 2, 3, 4, 5, 6, 7], activeFrom: iso("2026-10-22T14:00"), inactiveFrom: null };
  assert.equal(appliesOn({ ...added, opensAt: "08:00" }, "2026-10-22"), false);
  assert.equal(appliesOn({ ...added, opensAt: "08:00" }, "2026-10-23"), true);
  assert.equal(appliesOn({ ...added, opensAt: "22:00" }, "2026-10-22"), true);
  assert.equal(absentReason({ ...added, opensAt: "08:00", active: true }, "2026-10-22"), "yarından");
  // Dün pasife alındı: bugün beklenmez; pasife alınmadan önceki günler beklenir
  const off = { weekdays: [1, 2, 3, 4, 5, 6, 7], opensAt: "08:00", activeFrom: iso("2026-10-01T09:00"), inactiveFrom: iso("2026-10-21T15:00") };
  assert.equal(appliesOn(off, "2026-10-22"), false);
  assert.equal(appliesOn(off, "2026-10-21"), true);
  assert.equal(absentReason({ ...off, active: false }, "2026-10-22"), "pasif");
  assert.equal(absentReason({ ...friday, active: true }, "2026-10-22"), "Cum");
  assert.equal(weekdaysText([1, 2, 3, 4, 5, 6, 7]), "Her gün");
  assert.equal(weekdaysText([5, 1, 2, 3, 4]), "Hafta içi");
  assert.equal(weekdaysText([6, 7]), "Hafta sonu");
  assert.equal(weekdaysText([1, 3, 5]), "Pzt, Çar, Cum");
});

test("5. ölçüm: aralık sınırlar dahil; dondurucu eksi aralığı; tek sınırlı ve sınırsız madde; yazım (virgül, eksi, sabit eksi öneki)", () => {
  assert.equal(inRange(FRIDGE, 4), true);
  assert.equal(inRange(FRIDGE, 0), true);
  assert.equal(inRange(FRIDGE, 4.1), false);
  assert.equal(inRange(FRIDGE, -0.5), false);
  assert.equal(rangeText(FRIDGE), "0–4 °C");
  const freezer = { min: -30, max: -18, unit: "°C" };
  assert.equal(rangeText(freezer), "-30 – -18 °C");
  assert.equal(inRange(freezer, -18), true);
  assert.equal(inRange(freezer, -17.5), false);
  assert.equal(rangeText({ min: 0, max: null, unit: "°C" }), "en az 0 °C");
  assert.equal(rangeText({ min: null, max: 4, unit: "°C" }), "en çok 4 °C");
  assert.equal(rangeText({ min: null, max: null, unit: "°C" }), "");
  assert.equal(inRange({ min: null, max: null }, -999), true);
  assert.equal(valueText(FRIDGE, 3.5), "3,5 °C");
  assert.equal(valueText({ unit: null }, 6), "6");
  assert.equal(parseReading("18", true), -18);
  assert.equal(parseReading("−18"), -18);
  assert.equal(parseReading("-18,5"), -18.5);
  assert.equal(parseReading("3.5"), 3.5);
  assert.equal(parseReading(" 4 "), 4);
  for (const bad of ["", "abc", "4%", "1.000,5", "--3"]) assert.equal(parseReading(bad), null, bad);
  // Eksi değer nasıl yazılır: dondurucu sabit "−", eksiye inebilen aralık "±", gerisi yok
  assert.equal(signMode(freezer), "negative");
  assert.equal(signMode({ min: -5, max: 5 }), "toggle");
  assert.equal(signMode(FRIDGE), "none");
});

test("6. özet: isteğe bağlı madde bekletmez; eksikler sırasıyla; kalan fotoğraf; yanıt verenler ilk yanıt sırasıyla; açık ve düzeltilmiş sorun", () => {
  const items = [
    item(1, { label: "Espresso" }),
    FRIDGE,
    item(3, { label: "Dondurucu", type: "number", unit: "°C", min: -30, max: -18, required: false }),
    item(4, { label: "Buz makinesi" }),
    item(5, { label: "Bar tezgâhı hazır", type: "photo" }),
    item(6, { label: "Salon hazır", type: "photo" }),
    item(7, { label: "Not", type: "text", required: false }),
  ];
  const answers = [
    answer(4, { status: "issue", note: "su kaçırıyor", by: "Mehmet", at: iso("2026-10-22T08:55") }),
    answer(1, { by: "Ayşe", at: iso("2026-10-22T08:51") }),
    answer(2, {
      value: 3.5,
      at: iso("2026-10-22T09:40"),
      by: "Ayşe",
      note: null,
      history: [{ status: "issue", value: 6, textValue: null, note: "kapı açık kalmış", photo: false, by: "Can", at: iso("2026-10-22T08:45") }],
    }),
    answer(5, { photoId: 7, photoAt: iso("2026-10-22T09:00") }),
    // Anlık görüntüde olmayan maddenin yanıtı sayılmaz
    answer(99, { by: "Zeynep", at: iso("2026-10-22T08:00") }),
  ];
  const s = runSummary(items, answers);
  assert.equal(s.required, 5);
  assert.equal(s.done, 4);
  assert.equal(s.complete, false);
  assert.deepEqual(s.missing, ["Salon hazır"]);
  assert.equal(s.photosLeft, 1);
  assert.equal(s.photos, 1);
  assert.deepEqual(s.contributors, ["Can", "Ayşe", "Mehmet"]);
  assert.equal(s.firstAt, iso("2026-10-22T08:45"));
  assert.equal(s.lastAt, iso("2026-10-22T09:40"));
  assert.deepEqual(
    s.issues.map((x) => [x.text, x.open, x.kind, x.by]),
    [
      ["Bar buzdolabı sıcaklığı: 6 °C → 3,5 °C", false, "range", "Can"],
      ["Buz makinesi: su kaçırıyor", true, "issue", "Mehmet"],
    ],
  );
  // Fotoğraf çekilince tamam; isteğe bağlılar boş kalabilir
  const all = runSummary(items, [...answers, answer(6, { photoId: 8, photoAt: iso("2026-10-22T09:50") })]);
  assert.equal(all.complete, true);
  // Açık aralık dışı ölçüm
  const open = runSummary([FRIDGE], [answer(2, { status: "issue", value: 6, note: "kapı açık" })]);
  assert.equal(open.issues[0].text, "Bar buzdolabı sıcaklığı: 6 °C (0–4 °C)");
  assert.equal(open.issues[0].open, true);
  // Yanıtsız kayıt tamam sayılmaz (yalnız isteğe bağlı maddeli liste de)
  assert.equal(runSummary([item(1, { required: false })], []).complete, false);
  assert.equal(runSummary([item(1, { required: false })], [answer(1)]).complete, true);
});

test("7. sürümler: aynı yanıt sürüm eklemez; değişen yanıtın önceki hâli eklenir; en çok 10", () => {
  const prev = answer(2, { value: 6, status: "issue", note: "kapı", by: "Can", at: iso("2026-10-22T08:45") });
  assert.deepEqual(nextVersions(null, { status: "ok", value: 3, textValue: null, note: null, photoId: null }), []);
  assert.deepEqual(nextVersions(prev, { status: "issue", value: 6, textValue: null, note: "kapı", photoId: null }), []);
  const v = nextVersions(prev, { status: "ok", value: 3.5, textValue: null, note: null, photoId: null });
  assert.deepEqual(v, [{ status: "issue", value: 6, textValue: null, note: "kapı", photo: false, by: "Can", at: iso("2026-10-22T08:45") }]);
  const full = { ...prev, history: Array.from({ length: MAX_HISTORY }, (_, i) => ({ status: "ok" as const, value: i, textValue: null, note: null, photo: false, by: "A", at: iso("2026-10-22T08:00") })) };
  const capped = nextVersions(full, { status: "ok", value: 99, textValue: null, note: null, photoId: null });
  assert.equal(capped.length, MAX_HISTORY);
  assert.equal(capped[0].value, 1);
  assert.equal(capped.at(-1)!.value, 6);
  // Yeniden çekilen fotoğraf da sürüm olur
  const photo = answer(5, { photoId: 1, photoAt: iso("2026-10-22T09:00") });
  assert.equal(nextVersions(photo, { status: "ok", value: null, textValue: null, note: null, photoId: 2 })[0].photo, true);
});

test("8. hangi gün doldurulur: bugün; açılmış dünkü kayıt 05:30'a kadar; geçmiş ve ileri gün hayır", () => {
  assert.equal(canAnswerDay("2026-10-22", tr("2026-10-22T14:00"), false), true);
  assert.equal(canAnswerDay("2026-10-22", tr("2026-10-23T04:59"), false), true);
  assert.equal(canAnswerDay("2026-10-22", tr("2026-10-23T05:20"), true), true);
  assert.equal(canAnswerDay("2026-10-22", tr("2026-10-23T05:20"), false), false);
  assert.equal(canAnswerDay("2026-10-22", tr("2026-10-23T05:40"), true), false);
  assert.equal(canAnswerDay("2026-10-21", tr("2026-10-23T05:20"), true), false);
  assert.equal(canAnswerDay("2026-10-23", tr("2026-10-22T14:00"), false), false);
});

test("9. fotoğrafı kim görür: yönetici hepsini; personel son 7 günün kaydını (listenin personele açıldığı günden), yönetici listesini değil; bağlanmamışı yalnız yükleyen", () => {
  const now = tr("2026-10-22T14:00");
  const run = (date: string, staffAllowed = true, staffSince: string | null = null) => ({ date, staffAllowed, staffSince });
  assert.equal(photoAccess({ role: "admin", userId: 1, createdBy: 9, run: run("2026-01-01"), now }), true);
  assert.equal(photoAccess({ role: "staff", userId: 2, createdBy: 9, run: run("2026-10-22"), now }), true);
  assert.equal(photoAccess({ role: "staff", userId: 2, createdBy: 9, run: run("2026-10-21"), now }), true);
  // Son 7 gün (bugün dahil): 16 Ekim izinli, 15 Ekim yasak
  assert.equal(photoAccess({ role: "staff", userId: 2, createdBy: 9, run: run("2026-10-16"), now }), true);
  assert.equal(photoAccess({ role: "staff", userId: 2, createdBy: 9, run: run("2026-10-15"), now }), false);
  assert.equal(photoAccess({ role: "staff", userId: 2, createdBy: 9, run: run("2026-10-22", false), now }), false);
  assert.equal(photoAccess({ role: "staff", userId: 2, createdBy: 2, run: null, now }), true);
  assert.equal(photoAccess({ role: "staff", userId: 2, createdBy: 3, run: null, now }), false);
  assert.equal(photoAccess({ role: "staff", userId: 2, createdBy: null, run: null, now }), false);
  // Gün 05:00'te döner: 23 Ekim 04:59'da iş günü hâlâ 22 Ekim (16 Ekim izinli), 05:00'te 23 Ekim (16 Ekim yasak)
  assert.equal(photoAccess({ role: "staff", userId: 2, createdBy: 9, run: run("2026-10-16"), now: tr("2026-10-23T04:59") }), true);
  assert.equal(photoAccess({ role: "staff", userId: 2, createdBy: 9, run: run("2026-10-16"), now: tr("2026-10-23T05:00") }), false);
  // Liste personele 20 Ekim 14:00'te açıldı: o günden eskisi personele görünmez (o günün kaydı görünür)
  const since = iso("2026-10-20T14:00");
  assert.equal(photoAccess({ role: "staff", userId: 2, createdBy: 9, run: run("2026-10-20", true, since), now }), true);
  assert.equal(photoAccess({ role: "staff", userId: 2, createdBy: 9, run: run("2026-10-19", true, since), now }), false);
  // Gece 02:00'de açıldıysa iş günü önceki gün: o günün (19 Ekim) kaydı görünür
  assert.equal(photoAccess({ role: "staff", userId: 2, createdBy: 9, run: run("2026-10-19", true, iso("2026-10-20T02:00")), now }), true);
  // Yönetici için staffSince önemsiz
  assert.equal(photoAccess({ role: "admin", userId: 1, createdBy: 9, run: run("2026-10-01", false, since), now }), true);
});

test("10. metinler: listenin adı, Türkçe küçük harf, kimler", () => {
  assert.equal(listTitle("Açılış"), "Açılış listesi");
  assert.equal(listTitle("Haftalık liste"), "Haftalık liste");
  assert.equal(listTitle("LİSTE B"), "LİSTE B");
  assert.equal(lowerFirst("İçecek listesi"), "içecek listesi");
  assert.equal(lowerFirst("Kapanış listesi"), "kapanış listesi");
  assert.equal(whoText([]), "");
  assert.equal(whoText(["Ayşe"]), "Ayşe");
  assert.equal(whoText(["Ayşe", "Mehmet"]), "Ayşe ve Mehmet");
  assert.equal(whoText(["Ayşe", "Mehmet", "Can"]), "Ayşe, Mehmet ve Can");
  assert.equal(whoText(["Ayşe", "Mehmet", "Can", "Zeynep", "Ali"]), "Ayşe, Mehmet ve 3 kişi");
  assert.deepEqual(
    groupBySection([item(1, { section: "Bar" }), item(2), item(3, { section: "Salon" }), item(4, { section: "Bar" })]).map((g) => [g.section, g.items.map((i) => i.id)]),
    [
      [null, [2]],
      ["Bar", [1, 4]],
      ["Salon", [3]],
    ],
  );
  // Anlık görüntü: etkin maddeler sırasıyla; depo yoksa fotoğraflı madde çıkar
  const items = [
    { ...item(1, { type: "photo" }), active: true, sortOrder: 2 },
    { ...item(2), active: true, sortOrder: 1 },
    { ...item(3), active: false, sortOrder: 0 },
  ];
  assert.deepEqual(snapshotItems(items, { photos: true }).map((i) => i.id), [2, 1]);
  assert.deepEqual(snapshotItems(items, { photos: false }).map((i) => i.id), [2]);
  assert.equal("active" in snapshotItems(items, { photos: true })[0], false);
});

test("11. erken / geç: aralıktan bir saatten çok önce başlayan erken, son saatten sonra biten geç", () => {
  assert.equal(earlyStart({ date: "2026-10-22", opensAt: "22:00", firstAt: iso("2026-10-22T10:12") }), true);
  assert.equal(earlyStart({ date: "2026-10-22", opensAt: "22:00", firstAt: iso("2026-10-22T21:30") }), false);
  assert.equal(earlyStart({ date: "2026-10-22", opensAt: "22:00", firstAt: null }), false);
  assert.equal(lateFinish({ date: "2026-10-22", dueAt: "02:00", completedAt: iso("2026-10-23T03:10") }), true);
  assert.equal(lateFinish({ date: "2026-10-22", dueAt: "02:00", completedAt: iso("2026-10-23T01:50") }), false);
  assert.equal(lateFinish({ date: "2026-10-22", dueAt: "02:00", completedAt: null }), false);
});

test("12. zil: personele yalnız bugün, aralığı açılan, doldurabildiği liste (açıkken bilgi, gecikince okunmamış); yöneticiye gecikti, dünkü eksik, sorun", () => {
  const today = {
    day: "2026-10-22",
    lists: [
      list(1, "Açılış", "08:00", "11:00", { done: 3, required: 11 }),
      list(2, "Kapanış", "22:00", "02:00"),
      list(3, "Kasa sayımı", "08:00", "20:00", null, { staffAllowed: false }),
    ],
  };
  const at9 = checklistBell({ role: "staff", now: tr("2026-10-22T09:00"), today });
  assert.deepEqual(
    at9.map((b) => [b.id, b.kind, b.title, b.body, b.unread, b.href]),
    [["kontrol-bekliyor-1-2026-10-22", "info", "Açılış listesi bekliyor", "Son saat 11:00 · 3 / 11 madde", false, "/panel/kontrol/1"]],
  );
  const at12 = checklistBell({ role: "staff", now: tr("2026-10-22T12:00"), today });
  assert.deepEqual(
    at12.map((b) => [b.id, b.kind, b.title, b.unread]),
    [["kontrol-gecikti-1-2026-10-22", "warning", "Açılış listesi gecikti", true]],
  );
  // Tamamlanan ve aralığı açılmayan liste personelin zilinde yok
  const done = { day: "2026-10-22", lists: [list(1, "Açılış", "08:00", "11:00", { complete: true, done: 11 })] };
  assert.deepEqual(checklistBell({ role: "staff", now: tr("2026-10-22T12:00"), today: done }), []);
  assert.deepEqual(checklistBell({ role: "staff", now: tr("2026-10-22T07:00"), today: { day: "2026-10-22", lists: [list(1, "Açılış", "08:00", "11:00")] } }), []);
  // Personele dün hiç gitmez
  assert.deepEqual(checklistBell({ role: "staff", now: tr("2026-10-22T07:00"), today: null, yesterday: { day: "2026-10-21", lists: [list(1, "Açılış", "08:00", "11:00")] } }), []);

  const range = { answerId: 41, itemId: 2, label: "Bar buzdolabı sıcaklığı", text: "Bar buzdolabı sıcaklığı: 6 °C (0–4 °C)", note: "kapı açık kalmış", by: "Ayşe", at: iso("2026-10-22T09:12"), open: true, versions: 0, kind: "range" as const };
  const ice = { ...range, answerId: 42, itemId: 4, label: "Buz makinesi", text: "Buz makinesi: su kaçırıyor", note: "su kaçırıyor", at: iso("2026-10-21T23:00"), kind: "issue" as const };
  const fixed = { ...range, answerId: 43, open: false, text: "Bar buzdolabı sıcaklığı: 6 °C → 3,5 °C" };
  const admin = checklistBell({
    role: "admin",
    now: tr("2026-10-22T12:00"),
    today: { day: "2026-10-22", lists: [list(1, "Açılış", "08:00", "11:00", { done: 3, issues: [range, fixed] }), list(2, "Kapanış", "22:00", "02:00")] },
    yesterday: { day: "2026-10-21", lists: [list(2, "Kapanış", "22:00", "02:00", { done: 10, required: 16, issues: [ice] }), list(1, "Açılış", "08:00", "11:00"), list(4, "Tamam", "08:00", "11:00", { complete: true })] },
  });
  assert.deepEqual(
    admin.map((b) => [b.id, b.kind, b.title, b.body, b.timeLabel, b.href]),
    [
      ["kontrol-gecikti-1-2026-10-22", "warning", "Açılış listesi gecikti", "Son saat 11:00 · 3 / 11 madde", "Bugün", "/panel/kontrol/1"],
      ["kontrol-eksik-2-2026-10-21", "warning", "Dünkü kapanış listesi eksik", "21 Ekim Çarşamba · 10 / 16 madde", "Dün", "/panel/kontrol/gecmis?gun=2026-10-21"],
      ["kontrol-eksik-1-2026-10-21", "warning", "Dünkü açılış listesi eksik", "21 Ekim Çarşamba · hiç açılmadı", "Dün", "/panel/kontrol/gecmis?gun=2026-10-21"],
      ["kontrol-sorun-41-v0", "danger", "Bar buzdolabı sıcaklığı: 6 °C (0–4 °C)", "Açılış listesi · Ayşe 09:12 · Not: kapı açık kalmış", "Bugün", "/panel/kontrol/gecmis?gun=2026-10-22"],
      ["kontrol-sorun-42-v0", "warning", "Buz makinesi: sorun", "Kapanış listesi · Ayşe 23:00 · Not: su kaçırıyor", "Dün", "/panel/kontrol/gecmis?gun=2026-10-21"],
    ],
  );
  assert.ok(admin.every((b) => b.unread));
  // Yeni ölçüm (sürüm) bildirimi yeniden açar; en çok 5 sorun, en yenileri
  const again = checklistBell({ role: "admin", now: tr("2026-10-22T09:30"), today: { day: "2026-10-22", lists: [list(1, "Açılış", "08:00", "11:00", { done: 3, issues: [{ ...range, versions: 2 }] })] } });
  assert.equal(again.find((b) => b.id.startsWith("kontrol-sorun"))?.id, "kontrol-sorun-41-v2");
  const many = Array.from({ length: 7 }, (_, i) => ({ ...range, answerId: 100 + i, at: iso(`2026-10-22T09:0${i}`) }));
  const capped = checklistBell({ role: "admin", now: tr("2026-10-22T09:30"), today: { day: "2026-10-22", lists: [list(1, "Açılış", "08:00", "11:00", { done: 3, issues: many })] } });
  assert.deepEqual(
    capped.map((b) => b.id),
    ["kontrol-sorun-106-v0", "kontrol-sorun-105-v0", "kontrol-sorun-104-v0", "kontrol-sorun-103-v0", "kontrol-sorun-102-v0"],
  );
  // Tutar, fotoğraf ya da depo adresi yok
  for (const b of [...admin, ...at9, ...at12]) assert.doesNotMatch(`${b.title} ${b.body} ${b.href}`, /₺|\/api\/foto|blob/i);
});

test("13. sabah e-postası: tam gün kutu yok; tek eksik liste, iki eksik liste, yalnız aralık dışı, yalnız sorun; en çok 5 sorun; kasa da yoksa not", () => {
  const day = "2026-10-21";
  const complete = list(1, "Açılış", "08:00", "11:00", { complete: true, done: 11 });
  assert.equal(kontrolDigestBox(day, [], false), null);
  assert.equal(kontrolDigestBox(day, [complete], true), null);

  const kapanis = list(2, "Kapanış", "22:00", "02:00", { done: 12, required: 16, missing: ["Mikrofonlar silindi", "Koltuklar silindi", "Ses sistemi kapatıldı", "Salon kapanış hâli"] });
  const one = kontrolDigestBox(day, [complete, kapanis], false)!;
  assert.equal(one.title, "Kontrol listeleri · 21 Ekim Çarşamba");
  assert.equal(one.subjectPart, "dünkü kapanış listesi eksik");
  assert.equal(one.headline, "Dünkü kontrol listelerinde eksik var");
  assert.equal(one.href, "/panel/kontrol/gecmis?gun=2026-10-21");
  assert.equal(one.link, "Kontrol geçmişi");
  assert.deepEqual(one.lines, [{ strong: "Kapanış listesi", text: "12 / 16 madde; yapılmayan: Mikrofonlar silindi, Koltuklar silindi, Ses sistemi kapatıldı ve 1 madde daha" }]);

  const two = kontrolDigestBox(day, [list(1, "Açılış", "08:00", "11:00"), kapanis], true)!;
  assert.equal(two.subjectPart, "dünkü 2 kontrol listesi eksik");
  assert.deepEqual(two.lines[0], { strong: "Açılış listesi", text: "hiç açılmadı" });
  assert.deepEqual(two.lines.at(-1), { text: "Dün kasa raporu da girilmedi; kafe kapalıysa bu bölümü önemsemeyin.", tone: "muted" });

  const range = { answerId: 41, itemId: 2, label: "Bar buzdolabı sıcaklığı", text: "Bar buzdolabı sıcaklığı: 6 °C (0–4 °C)", note: "<b>kapı</b>", by: "Ayşe", at: iso("2026-10-21T09:12"), open: true, versions: 0, kind: "range" as const };
  const fixed = { ...range, answerId: 43, open: false, text: "Bar buzdolabı sıcaklığı: 6 °C → 3,5 °C" };
  const ice = { ...range, answerId: 44, kind: "issue" as const, label: "Buz makinesi", text: "Buz makinesi: su kaçırıyor", note: "su kaçırıyor" };
  const problems = kontrolDigestBox(day, [list(1, "Açılış", "08:00", "11:00", { complete: true, done: 11, issues: [range, fixed] })], false)!;
  assert.equal(problems.subjectPart, "kontrol listesinde aralık dışı değer");
  assert.equal(problems.headline, "Dünkü kontrol listelerinde sorun var");
  assert.deepEqual(problems.lines, [
    { text: "Bar buzdolabı sıcaklığı: 6 °C (0–4 °C) · Ayşe: <b>kapı</b>", tone: "bad" },
    { text: "Bar buzdolabı sıcaklığı: 6 °C → 3,5 °C (düzeltildi)", tone: "warn" },
  ]);
  const onlyIssue = kontrolDigestBox(day, [list(1, "Açılış", "08:00", "11:00", { complete: true, done: 11, issues: [ice] })], false)!;
  assert.equal(onlyIssue.subjectPart, "kontrol listesinde sorun");
  assert.deepEqual(onlyIssue.lines, [{ text: "Buz makinesi: sorun · Ayşe: su kaçırıyor", tone: "bad" }]);
  const many = kontrolDigestBox(day, [list(1, "Açılış", "08:00", "11:00", { complete: true, done: 11, issues: Array.from({ length: 8 }, (_, i) => ({ ...ice, answerId: i })) })], false)!;
  assert.equal(many.lines.length, 6);
  assert.deepEqual(many.lines.at(-1), { text: "ve 3 kayıt daha", tone: "muted" });

  // E-postada: konu, başlık, bağlantı; kullanıcı metni kaçışlı; fotoğraf adresi yok
  const mail = renderDigest([], "2026-10-22", null, null, null, { kontrol: kontrolDigestBox(day, [complete, kapanis], false) });
  assert.equal(mail.subject, "Sabah özeti: dünkü kapanış listesi eksik");
  const withProblems = renderDigest([], "2026-10-22", null, null, null, { kontrol: problems });
  assert.ok(withProblems.html.includes("Kontrol listeleri · 21 Ekim Çarşamba"));
  assert.ok(withProblems.html.includes("/panel/kontrol/gecmis?gun=2026-10-21"));
  assert.ok(withProblems.html.includes("&lt;b&gt;kapı&lt;/b&gt;"));
  assert.ok(!withProblems.html.includes("<b>kapı</b>"));
  assert.doesNotMatch(withProblems.html + withProblems.text, /\/api\/foto|blob\.vercel/);
});

test("14. Bugün'ün yenileme anları: listelerin açılış ve son saatleri, tekrarsız", () => {
  const c = { day: "2026-10-22", lists: [list(1, "Açılış", "08:00", "11:00"), list(2, "Kapanış", "22:00", "02:00"), list(3, "Ara", "08:00", "11:00")] };
  assert.deepEqual(checklistBoundaries(c), [tr("2026-10-22T08:00").getTime(), tr("2026-10-22T11:00").getTime(), tr("2026-10-22T22:00").getTime(), tr("2026-10-23T02:00").getTime()]);
  assert.deepEqual(checklistBoundaries(null), []);
});

test("15. hazır listeler: Açılış 08:00–11:00 ve Kapanış 22:00–02:00, ikisi de etkin; adlar ve maddeler tekil, sınırlar içinde; fotoğraf ipucu; mikrofon kapanışta", () => {
  assert.deepEqual(
    DEFAULT_CHECKLISTS.map((t) => [t.name, t.opensAt, t.dueAt]),
    [
      ["Açılış", "08:00", "11:00"],
      ["Kapanış", "22:00", "02:00"],
    ],
  );
  assert.equal(new Set(DEFAULT_CHECKLISTS.map((t) => t.name)).size, DEFAULT_CHECKLISTS.length);
  for (const t of DEFAULT_CHECKLISTS) {
    assert.equal(windowError(t.opensAt, t.dueAt), null, t.name);
    assert.ok(t.name.length <= 60 && t.description.length <= 300);
    const labels = t.items.map((i) => i.label);
    assert.equal(new Set(labels).size, labels.length, `${t.name}: madde adları tekil`);
    assert.ok(t.items.length <= MAX_ITEMS);
    for (const i of t.items) {
      assert.ok(i.label.length <= 120, i.label);
      assert.ok((i.section ?? "").length <= 40 && (i.hint ?? "").length <= 200, i.label);
      if (i.type === "number") {
        assert.ok(i.unit, `${i.label}: birim`);
        assert.ok(i.min === undefined || i.max === undefined || i.min <= i.max, i.label);
      }
      if (i.type === "photo") assert.ok(i.hint?.includes(PHOTO_PRIVACY_HINT), `${i.label}: fotoğrafta insan olmasın`);
    }
    const photos = t.items.filter((i) => i.type === "photo").length;
    assert.ok(photos >= 1 && photos <= MAX_PHOTO_ITEMS, t.name);
  }
  const [acilis, kapanis] = DEFAULT_CHECKLISTS;
  assert.equal(acilis.items.length, 13);
  assert.equal(kapanis.items.length, 16);
  assert.ok(kapanis.items.some((i) => /mikrofon/i.test(i.label)));
  // "Her seferinde" listeleri (Oda sıfırlama, Mal kabul) bu turda yok
  assert.ok(!DEFAULT_CHECKLISTS.some((t) => /Oda sıfırlama|Mal kabul/.test(t.name)));
});

test("16. zil: aralıktan önce başlanan liste personelin zilinde aralık açılınca çıkar (önce bekliyor, son saatten sonra gecikti)", () => {
  // Kapanış 13:00'te erkenden 4 maddeyle başlandı
  const early = { day: "2026-10-22", lists: [list(2, "Kapanış", "22:00", "02:00", { done: 4, required: 15, firstAt: iso("2026-10-22T12:50"), lastAt: iso("2026-10-22T12:55") })] };
  assert.equal(listState(early.lists[0], bm("2026-10-22T13:00"), false), "open");
  assert.deepEqual(checklistBell({ role: "staff", now: tr("2026-10-22T13:00"), today: early }), []);
  assert.deepEqual(checklistBell({ role: "staff", now: tr("2026-10-22T21:59"), today: early }), []);
  assert.deepEqual(
    checklistBell({ role: "staff", now: tr("2026-10-22T22:30"), today: early }).map((b) => [b.id, b.kind, b.title, b.body, b.unread]),
    [["kontrol-bekliyor-2-2026-10-22", "info", "Kapanış listesi bekliyor", "Son saat 02:00 · 4 / 15 madde", false]],
  );
  assert.deepEqual(
    checklistBell({ role: "staff", now: tr("2026-10-23T02:30"), today: early }).map((b) => [b.id, b.unread]),
    [["kontrol-gecikti-2-2026-10-22", true]],
  );
  // Yöneticinin zili zaten yalnız gecikeni söyler
  assert.deepEqual(checklistBell({ role: "admin", now: tr("2026-10-22T13:00"), today: early }), []);
});

test("17. yeniden açma: aralığı açılmadan kapatılıp geri açılan liste hiç kapanmamış sayılır (bugünkü liste ve geçmişteki yapılmadılar kalır); arada aralık açıldıysa o andan beklenir", () => {
  const every = { weekdays: [1, 2, 3, 4, 5, 6, 7], opensAt: "09:00" };
  // 22 Ekim 13:00'te Listeler'deki anahtar kapatıldı, 13:01'de geri açıldı (aralık 09:00'da açılmıştı)
  assert.deepEqual(activityChange({ active: true, inactiveFrom: null }, { ...every, active: false }, tr("2026-10-22T13:00")), { active: false, inactiveFrom: tr("2026-10-22T13:00") });
  assert.deepEqual(activityChange({ active: false, inactiveFrom: tr("2026-10-22T13:00") }, { ...every, active: true }, tr("2026-10-22T13:01")), { active: true, inactiveFrom: null });
  // Başlangıç anı yerinde kaldı: bugün ve önceki günler (geçmişteki "yapılmadı"lar) yine beklenir
  const kept = { ...every, activeFrom: iso("2026-10-01T10:00"), inactiveFrom: null };
  for (const day of ["2026-10-22", "2026-10-21", "2026-10-02"]) assert.equal(appliesOn(kept, day), true, day);
  // Gece 23:00'te kapatıldı, ertesi sabah aralık (09:00) açıldıktan sonra açıldı: o gün beklenmez, yarından
  const later = activityChange({ active: false, inactiveFrom: tr("2026-10-22T23:00") }, { ...every, active: true }, tr("2026-10-23T10:00"));
  assert.deepEqual(later, { active: true, activeFrom: tr("2026-10-23T10:00"), inactiveFrom: null });
  assert.equal(appliesOn({ ...every, activeFrom: iso("2026-10-23T10:00"), inactiveFrom: null }, "2026-10-23"), false);
  assert.equal(appliesOn({ ...every, activeFrom: iso("2026-10-23T10:00"), inactiveFrom: null }, "2026-10-24"), true);
  // Aynı gece açılış saatinden önce (08:30) açılsaydı kapanış hiç olmamış sayılırdı
  assert.deepEqual(activityChange({ active: false, inactiveFrom: tr("2026-10-22T23:00") }, { ...every, active: true }, tr("2026-10-23T08:30")), { active: true, inactiveFrom: null });
  // Gece yarısını geçen Kapanış: 23:00'te kapatılıp 23:05'te açıldı (22:00 açılışı kapatılmadan önceydi)
  assert.deepEqual(activityChange({ active: false, inactiveFrom: tr("2026-10-22T23:00") }, { ...every, opensAt: "22:00", active: true }, tr("2026-10-22T23:05")), { active: true, inactiveFrom: null });
  // Saat aynı kayıtta değişebilir: yeni saate bakılır (14:00 açılışı henüz gelmedi)
  assert.deepEqual(activityChange({ active: false, inactiveFrom: tr("2026-10-22T07:00") }, { ...every, opensAt: "14:00", active: true }, tr("2026-10-22T13:00")), { active: true, inactiveFrom: null });
  // Seçili olmayan günün açılışı sayılmaz: yalnız Pazartesi listesi Cuma kapatılıp Pazar açıldı
  assert.equal(openedBetween({ weekdays: [1], opensAt: "09:00" }, tr("2026-10-23T13:00"), tr("2026-10-25T20:00")), false);
  assert.equal(openedBetween({ weekdays: [1], opensAt: "09:00" }, tr("2026-10-23T13:00"), tr("2026-10-26T09:00")), true);
  // Tam açılışta kapatılan liste o gün beklenmez (appliesOn ile aynı sınır); bir haftadan uzun kapalı kalınca açılış geçmiştir
  assert.equal(openedBetween(every, tr("2026-10-22T09:00"), tr("2026-10-22T09:00")), true);
  assert.equal(appliesOn({ ...every, activeFrom: iso("2026-10-01T10:00"), inactiveFrom: iso("2026-10-22T09:00") }, "2026-10-22"), false);
  assert.equal(openedBetween({ weekdays: [3], opensAt: "09:00" }, tr("2026-10-01T10:00"), tr("2026-10-09T10:00")), true);
  assert.equal(openedBetween({ weekdays: [], opensAt: "09:00" }, tr("2026-10-01T10:00"), tr("2026-10-20T10:00")), false);
  // Değişmeyen etkinlik yazılmaz; kapanış anı olmayan pasif liste o andan başlar
  assert.deepEqual(activityChange({ active: true, inactiveFrom: null }, { ...every, active: true }, tr("2026-10-22T13:00")), {});
  assert.deepEqual(activityChange({ active: false, inactiveFrom: null }, { ...every, active: true }, tr("2026-10-22T13:00")), { active: true, activeFrom: tr("2026-10-22T13:00"), inactiveFrom: null });
  // İki yol da (listenin sayfası ve Listeler'deki anahtar) aynı kuralı kullanır
  const actions = read("src/server/actions/checklists.ts");
  assert.match(actions, /\.\.\.activityChange\(prev, data, now\)/);
  assert.match(actions, /\.\.\.activityChange\(prev, \{ active: on, weekdays: prev\.weekdays, opensAt: prev\.opensAt \?\? "08:00" \}, now\)/);
});

test("18. fotoğrafın önceki hâli: yeniden çekme ile not değişikliği ayrılır", () => {
  const content = { status: "ok" as const, value: null, textValue: null };
  // 10:29 çekildi, 10:30 yeniden çekildi (not aynı kalır), 10:31 not eklendi (fotoğraf aynı kalır)
  const first = answer(5, { photoId: 1, photoAt: iso("2026-10-22T10:29"), at: iso("2026-10-22T10:29") });
  const retaken = { ...first, photoId: 2, photoAt: iso("2026-10-22T10:30"), at: iso("2026-10-22T10:30"), history: nextVersions(first, { ...content, note: null, photoId: 2 }) };
  const noted = { ...retaken, note: "sağ köşe ıslak", at: iso("2026-10-22T10:31"), history: nextVersions(retaken, { ...content, note: "sağ köşe ıslak", photoId: 2 }) };
  assert.deepEqual(
    noted.history.map((v, i) => photoVersionText(v, noted.history[i + 1] ?? noted)),
    ["Başka bir fotoğraf", "Aynı fotoğraf, notsuz"],
  );
  assert.equal(photoVersionText({ photo: true, note: "kapı açık" }, { note: "kapı kapandı" }), "Aynı fotoğraf");
  assert.equal(photoVersionText({ photo: true, note: "kapı açık" }, { note: "kapı açık" }), "Başka bir fotoğraf");
  assert.equal(photoVersionText({ photo: false, note: null }, { note: null }), "Fotoğrafsız");
  assert.match(read("src/app/panel/kontrol/run-view.tsx"), /versionText\(item, v, a\.history\[i \+ 1\] \?\? a\)/);
});

// ---------------------------------------------------------------- Kaynak denetimi

function filesUnder(dir: string): string[] {
  return readdirSync(join(process.cwd(), dir)).flatMap((f) => {
    const p = `${dir}/${f}`;
    return statSync(join(process.cwd(), p)).isDirectory() ? filesUnder(p) : [p];
  });
}

test("19. personelin geçmişi: son 7 gün (bugün dahil); listenin personele açıldığı günden; ?gun= pencere dışıysa ve ?bitis= yok sayılır", () => {
  assert.equal(STAFF_HISTORY_DAYS, 7);
  assert.equal(staffHistoryFloor("2026-10-22"), "2026-10-16");
  // Ay sınırı
  assert.equal(staffHistoryFloor("2026-11-03"), "2026-10-28");
  // staffSeesRun: personel doldurabilir olmalı; açıldığı iş gününden itibaren
  assert.equal(staffSeesRun({ staffAllowed: false, staffSince: null }, "2026-10-22"), false);
  assert.equal(staffSeesRun({ staffAllowed: true, staffSince: null }, "2026-01-01"), true);
  assert.equal(staffSeesRun({ staffAllowed: true, staffSince: iso("2026-10-20T14:00") }, "2026-10-20"), true);
  assert.equal(staffSeesRun({ staffAllowed: true, staffSince: iso("2026-10-20T14:00") }, "2026-10-19"), false);
  assert.equal(staffSeesRun({ staffAllowed: true, staffSince: iso("2026-10-20T02:00") }, "2026-10-19"), true);

  // Liste personele açılınca an yazılır (öncesi personele görünmez); kapatma ya da değişmeyen anahtar yazmaz
  const at = tr("2026-10-22T14:00");
  assert.deepEqual(staffSinceChange(false, true, at), { staffSince: at });
  assert.deepEqual(staffSinceChange(true, true, at), {});
  assert.deepEqual(staffSinceChange(true, false, at), {});
  assert.deepEqual(staffSinceChange(false, false, at), {});

  const base = { today: "2026-10-22", first: "2026-09-01" };
  // Personel: 7 günlük liste; daha eski günler düğmesi yok; bitis yok sayılır
  assert.deepEqual(historyRange({ ...base, role: "staff" }), { kind: "days", from: "2026-10-16", to: "2026-10-22", older: null });
  assert.deepEqual(historyRange({ ...base, role: "staff", bitis: "2026-10-01" }), { kind: "days", from: "2026-10-16", to: "2026-10-22", older: null });
  assert.deepEqual(historyRange({ ...base, role: "staff", bitis: "2026-10-20" }), { kind: "days", from: "2026-10-16", to: "2026-10-22", older: null });
  // Personel ayrıntısı: penceredeki gün; önceki gün pencerenin içindeyse
  assert.deepEqual(historyRange({ ...base, role: "staff", gun: "2026-10-16" }), { kind: "day", day: "2026-10-16", prev: null, next: "2026-10-17" });
  assert.deepEqual(historyRange({ ...base, role: "staff", gun: "2026-10-22" }), { kind: "day", day: "2026-10-22", prev: "2026-10-21", next: null });
  // 7 günden eski, ileri ya da bozuk gün: 7 günlük liste
  for (const gun of ["2026-10-15", "2026-09-01", "2026-10-23", "2026-13-01", "dün"]) {
    assert.deepEqual(historyRange({ ...base, role: "staff", gun }), { kind: "days", from: "2026-10-16", to: "2026-10-22", older: null }, gun);
  }
  // İlk kayıt pencereden yeniyse liste ilk günden başlar
  assert.deepEqual(historyRange({ today: "2026-10-22", first: "2026-10-20", role: "staff" }), { kind: "days", from: "2026-10-20", to: "2026-10-22", older: null });
  assert.deepEqual(historyRange({ today: "2026-10-22", first: "2026-10-20", role: "staff", gun: "2026-10-20" }), { kind: "day", day: "2026-10-20", prev: null, next: "2026-10-21" });
  assert.deepEqual(historyRange({ today: "2026-10-22", first: "2026-10-20", role: "staff", gun: "2026-10-18" }), { kind: "days", from: "2026-10-20", to: "2026-10-22", older: null });

  // Yönetici: 14 günlük sayfa, daha eski günler; bitis ile geriye; ayrıntı ilk güne kadar
  assert.deepEqual(historyRange({ ...base, role: "admin" }), { kind: "days", from: "2026-10-09", to: "2026-10-22", older: "2026-10-08" });
  assert.deepEqual(historyRange({ ...base, role: "admin", bitis: "2026-10-08" }), { kind: "days", from: "2026-09-25", to: "2026-10-08", older: "2026-09-24" });
  assert.deepEqual(historyRange({ ...base, role: "admin", bitis: "2026-09-10" }), { kind: "days", from: "2026-09-01", to: "2026-09-10", older: null });
  assert.deepEqual(historyRange({ ...base, role: "admin", bitis: "2026-10-30" }), { kind: "days", from: "2026-10-09", to: "2026-10-22", older: "2026-10-08" });
  assert.deepEqual(historyRange({ ...base, role: "admin", gun: "2026-09-02" }), { kind: "day", day: "2026-09-02", prev: "2026-09-01", next: "2026-09-03" });
  assert.deepEqual(historyRange({ ...base, role: "admin", gun: "2026-09-01" }), { kind: "day", day: "2026-09-01", prev: null, next: "2026-09-02" });
  assert.deepEqual(historyRange({ ...base, role: "admin", gun: "2026-10-23" }), { kind: "days", from: "2026-10-09", to: "2026-10-22", older: "2026-10-08" });
});

test("kaynak: fotoğraf yolu köken, giriş, depo ve yanıt aynı istekte; değişen fotoğraf yanıttan sonra silinir", () => {
  const route = read("src/app/api/kontrol/foto/route.ts");
  for (const s of ["sameOrigin(request)", "getCurrentUser()", "savePhoto(", "checkPhotoTarget(", "writeChecklistAnswer(", "recentUploads(me.id)", "after(() => deletePhoto(old)"]) {
    assert.ok(route.includes(s), s);
  }
  assert.match(route, /import \{ sameOrigin \} from "@\/server\/same-origin";/);
  // Boyut, tür ve ölçü yalnız savePhoto'da (yol koklamaz)
  assert.doesNotMatch(route, /sniffMime|imageSize/);
  // Yanıt yazılamazsa yeni fotoğraf hemen silinir
  assert.match(route, /await deletePhoto\(photoId\)\.catch/);
  // Fotoğraf yanıta aynı işlemde 60 gün için bağlanır (bağlanmamış fotoğraf 2 günde silinir)
  const store = read("src/server/checklists/store.ts");
  assert.match(store, /await deps\.linkPhoto\(photo\.id, keepUntil\("kontrol", input\.date\), tx\);/);
  assert.match(read("src/server/data/checklists.ts"), /linkPhoto: \(id, until, tx\) => keepPhoto\(id, until, tx\)/);
  // Fotoğrafı kim görür: kayıt defterinde kontrolün kuralı
  assert.match(read("src/server/storage/photo-access.ts"), /kontrol: kontrolPhotoRules,/);
  // Kontrol fotoğrafı ortak yükleme yolundan gelmez
  assert.match(read("src/server/photo-read/rules.ts"), /if \(kind === "kontrol"\) return false;/);
});

test("kaynak: doldurma ekranı eylem atılırsa (ağ kesik, panel güncellendi) hata ekranına düşmez: işaret geri döner, bildirim çıkar", () => {
  const src = read("src/app/panel/kontrol/[id]/run-form.tsx");
  const submit = src.slice(src.indexOf("const submit: Submit"), src.indexOf("const onUploaded"));
  assert.match(submit, /try \{\s*res = await answerChecklistItem\(/);
  assert.match(submit, /catch \(e\) \{\s*unreachable\(e\);\s*resolve\(false\);\s*return;/);
  // Eski sürümün eylemi (panel güncellendi) "Yenile" önerir, gerisi bağlantı hatası
  assert.match(src, /if \(unstable_isUnrecognizedActionError\(e\)\) \{/);
  assert.match(src, /action: \{ label: "Yenile", onClick: \(\) => window\.location\.reload\(\) \}/);
  // Bütün işaretler (Tamam, Sorun var, ölçüm, kısa not, fotoğrafın notu) bu tek yoldan gider
  assert.equal(src.match(/answerChecklistItem\(/g)?.length, 1);
  assert.match(read("src/app/panel/kontrol/[id]/photo-item.tsx"), /await submit\(item, \{ op: "note"/);
});

test("kaynak: yönetici sayfaları ve eylemleri requireAdmin; işaretleme requireUser; 'use server' dosyası yalnız eylem dışa açar", () => {
  // Geçmiş iki rolde açık (dalga 10 §2.5): personel son 7 günü görür, pencere sunucuda (historyRange)
  const history = read("src/app/panel/kontrol/gecmis/page.tsx");
  assert.match(history, /const user = await requireUser\(\);/);
  assert.doesNotMatch(history, /requireAdmin/);
  assert.match(history, /historyRange\(\{ role: user\.role,/);
  assert.match(history, /<KontrolTabs current="\/panel\/kontrol\/gecmis" role=\{user\.role\} \/>/);
  // Personelde "Erken dolduruldu" rozeti yok
  assert.match(history, /audit=\{admin\}/);
  assert.match(read("src/app/panel/kontrol/duzenle/page.tsx"), /await requireAdmin\(\)/);
  assert.match(read("src/app/panel/kontrol/duzenle/[id]/page.tsx"), /await requireAdmin\(\)/);
  assert.match(read("src/app/panel/kontrol/page.tsx"), /await requireUser\(\)/);
  assert.match(read("src/app/panel/kontrol/[id]/page.tsx"), /await requireUser\(\)/);
  const src = read("src/server/actions/checklists.ts");
  assert.ok(src.startsWith('"use server";'));
  const exported = [...src.matchAll(/^export (async function|const|function|class|let|type|interface) (\w+)/gm)];
  assert.ok(exported.length >= 8);
  for (const [, kind, name] of exported) {
    assert.equal(kind, "async function", `${name} dışa açık bir POST ucu olur: yalnız eylem`);
    const body = src.slice(src.indexOf(`export async function ${name}(`)).split(/\nexport async function /)[0];
    if (name === "answerChecklistItem") {
      assert.match(body, /await requireUser\(\)/);
      assert.doesNotMatch(body, /requireAdmin/);
    } else {
      assert.match(body, /await requireAdmin\(\)/, `${name} requireAdmin`);
    }
  }
  // Personele açılış anı iki yazım yolunda da (yeni liste, düzenleme)
  const actions = read("src/server/actions/checklists.ts");
  assert.match(actions, /\.\.\.staffSinceChange\(false, data\.staffAllowed, now\)/);
  assert.match(actions, /\.\.\.staffSinceChange\(prev\.staffAllowed, data\.staffAllowed, now\)/);
  // Sekmeler: personelde Listeler yok
  const tabs = read("src/app/panel/kontrol/tabs.tsx");
  assert.match(tabs, /role === "admin" \? KONTROL_TABS : KONTROL_TABS\.filter\(\(t\) => t\.href !== "\/panel\/kontrol\/duzenle"\)/);
  assert.match(read("src/app/panel/kontrol/page.tsx"), /tabs=\{<KontrolTabs current="\/panel\/kontrol" role=\{user\.role\} \/>\}/);
  // RunView: audit kapalıyken erken rozeti hiç kurulmaz
  const runView = read("src/app/panel/kontrol/run-view.tsx");
  assert.match(runView, /audit\?: boolean;/);
  assert.match(runView, /p\.audit !== false && started && earlyStart\(/);
  // Geçmiş SQL'de süzülür: personelde yönetici listelerinin kaydı ve personele açılmadan önceki kayıt okunmaz
  const store = read("src/server/checklists/store.ts");
  assert.match(store, /export async function loadHistory\(db: Db, from: string, to: string, role: "admin" \| "staff", ctx: DayCtx\)/);
  assert.match(store, /const visible = templates\.filter\(\(t\) => role === "admin" \|\| t\.staffAllowed\);/);
  assert.match(store, /inArray\(r\.templateId, visible\.map\(\(t\) => t\.id\)\)/);
  // Personel: yalnız "Personel doldurabilir" listeler, yönetici sayfaları geri gönderir
  assert.match(read("src/server/checklists/store.ts"), /if \(me\.role !== "admin" && !tpl\.staffAllowed\) throw new ChecklistError\("Bu listeyi yalnız yönetici doldurur\.", 403\);/);
  assert.match(read("src/app/panel/kontrol/[id]/page.tsx"), /if \(!admin && !view\.template\.staffAllowed\) redirect\("\/panel\/kontrol"\);/);
});

test("kaynak: kontrol listelerinde para ve maliyet modeli yok; istemci bileşenleri sunucu katmanına uzanmaz", () => {
  const files = [...filesUnder("src/app/panel/kontrol"), "src/lib/checklists.ts", "src/server/checklists/store.ts", "src/server/data/checklists.ts", "src/server/actions/checklists.ts"];
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /loadModel|@\/lib\/calc|\btl\(|\bmoney\(|\btl2\(/, f);
    if (src.startsWith('"use client";')) assert.doesNotMatch(src.replace(/^import type .*$/gm, ""), /from "@\/server\/(?!actions\/)/, `${f}: istemci yalnız sunucu eylemi çağırır`);
  }
  // Sabah e-postasının kutusu kayıt defterinden, günde bir kez
  const extras = read("src/server/notify/digest-extras.ts");
  assert.match(extras, /\{ key: "kontrol", news: true, load: \(\) => loadKontrolDigest\(\) \}/);
  const data = read("src/server/data/checklists.ts");
  assert.match(data, /const key = `kontrol:\$\{day\}`;/);
  assert.match(data, /return box \? \{ box, logKeys: \[key\] \} : null;/);
});

test("kaynak: zil kontrol grubu kasadan sonra, iki rolde; personel dalı ilk Promise.all'da", () => {
  const src = read("src/server/actions/notifications.ts");
  assert.match(src, /group\?: "sistem" \| "hatirlatici" \| "onay" \| "kasa" \| "kontrol" \| "odeme" \| "fatura" \| "uyari";/);
  assert.match(
    src,
    /checklistNotifications\(user\)\.catch\(\(\) => \[\]\),\n {4}opsBell\(user\)\.catch\(\(\) => \[\]\),\n {2}\]\);\n {2}if \(user\.role !== "admin"\) return \[\.\.\.cash, \.\.\.kontrol, \.\.\.mine, \.\.\.recipes, \.\.\.ops\];/,
  );
  assert.match(src, /\.\.\.cash, \.\.\.kontrol, \.\.\.payments,/);
  assert.doesNotMatch(src, /export async function checklistNotifications/);
  const ui = read("src/components/panel/notifications.tsx");
  assert.ok(ui.indexOf('{ id: "kontrol", label: "Kontrol listeleri"') > ui.indexOf('{ id: "kasa", label: "Kasa"'));
  assert.match(ui, /n\.group === "kontrol" && n\.kind !== "danger"\s*\? ListChecks/);
});
