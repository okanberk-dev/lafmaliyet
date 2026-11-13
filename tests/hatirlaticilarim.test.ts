// Kişisel hatırlatıcılar: tekrar, tamamlama, erteleme, saatli hatırlatmanın anı (Türkiye saati) ve listedeki grubu
// (src/lib/user-reminders.ts).
// Çalıştırma: npx tsx --test tests/hatirlaticilarim.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { alarmRinging, startAlarm, stopAlarm, stopAllAlarms } from "../src/components/panel/live/sounds";
import { afterComplete, dueGroup, dueInstant, isTime, nextUserOccurrence, postponeTarget, trParts, USER_SOUNDS, userRepeatLabel, whenLabel } from "../src/lib/user-reminders";

/** Türkiye saatiyle an: "2026-10-21 15:30" → Date */
const tr = (s: string) => new Date(`${s.replace(" ", "T")}:00+03:00`);

test("tekrar: günlük, haftalık (çapanın günü), aylık (ay sonu kırpılır)", () => {
  assert.equal(nextUserOccurrence("2026-10-21", "none", "2026-10-21"), null);
  assert.equal(nextUserOccurrence("2026-10-31", "daily", "2026-10-31"), "2026-11-01");
  // Çarşamba çapası: ertelenip perşembeye kaymış olsa da sıradaki çarşamba
  assert.equal(nextUserOccurrence("2026-10-21", "weekly", "2026-10-21"), "2026-10-28");
  assert.equal(nextUserOccurrence("2026-10-22", "weekly", "2026-10-21"), "2026-10-28");
  assert.equal(nextUserOccurrence("2026-01-31", "monthly", "2026-01-31"), "2026-02-28");
  assert.equal(nextUserOccurrence("2026-02-28", "monthly", "2026-01-31"), "2026-03-31");
  // Ertelenip 17'sine kaymış aylık (çapa 15): sonraki ay yine 15'i
  assert.equal(nextUserOccurrence("2026-10-17", "monthly", "2026-10-15"), "2026-11-15");
});

test("tamamlandı: tekrar eden bugünü geçene kadar ilerler, tek seferlik kapanır", () => {
  assert.equal(afterComplete({ dueDate: "2026-10-18", dueTime: "15:00", anchorDate: "2026-10-01", repeat: "daily" }, "2026-10-21"), "2026-10-22");
  assert.equal(afterComplete({ dueDate: "2026-10-21", dueTime: null, anchorDate: "2026-10-21", repeat: "daily" }, "2026-10-21"), "2026-10-22");
  assert.equal(afterComplete({ dueDate: "2026-10-07", dueTime: null, anchorDate: "2026-10-07", repeat: "weekly" }, "2026-10-21"), "2026-10-28");
  // Gelecekteki dönem erken tamamlanırsa bir sonrakine geçer
  assert.equal(afterComplete({ dueDate: "2026-10-25", dueTime: null, anchorDate: "2026-10-25", repeat: "weekly" }, "2026-10-21"), "2026-11-01");
  assert.equal(afterComplete({ dueDate: "2026-10-21", dueTime: null, anchorDate: "2026-10-21", repeat: "none" }, "2026-10-21"), null);
});

test("tamamlandı: ay sonunda ertesi aya ertelenen aylık hatırlatıcı bir ayı atlamaz (SB-01)", () => {
  // 30 Kas → "Yarın"a ertelendi (1 Ara) → 1 Ara'da tamamlandı: sıradaki 30 Ara, 30 Oca değil
  const ertelendi = postponeTarget({ dueDate: "2026-11-30", dueTime: null }, "day", tr("2026-11-30 10:00"));
  assert.equal(ertelendi.dueDate, "2026-12-01");
  assert.equal(afterComplete({ ...ertelendi, anchorDate: "2026-11-30", repeat: "monthly" }, "2026-12-01"), "2026-12-30");
  // 31'lik: 31 Ara → 1 Oca → 31 Oca; 31 Oca → 1 Şub → 28 Şub; kısa ayın sonundan (28 Şub → 1 Mar) → 31 Mar
  assert.equal(afterComplete({ dueDate: "2027-01-01", dueTime: null, anchorDate: "2026-12-31", repeat: "monthly" }, "2027-01-01"), "2027-01-31");
  assert.equal(afterComplete({ dueDate: "2027-02-01", dueTime: null, anchorDate: "2026-12-31", repeat: "monthly" }, "2027-02-01"), "2027-02-28");
  assert.equal(afterComplete({ dueDate: "2027-03-01", dueTime: null, anchorDate: "2026-12-31", repeat: "monthly" }, "2027-03-01"), "2027-03-31");
  // Gece yarısını aşan "1 saat" ertelemesi de aynı: 30 Kas 23:35 → 1 Ara 00:35
  const saat = postponeTarget({ dueDate: "2026-11-30", dueTime: "23:30" }, "hour", tr("2026-11-30 23:31"));
  assert.deepEqual(saat, { dueDate: "2026-12-01", dueTime: "00:35" });
  assert.equal(afterComplete({ ...saat, anchorDate: "2026-11-30", repeat: "monthly" }, "2026-12-01"), "2026-12-30");
  // Ay içi erteleme ve ertelenmemiş dönem eskisi gibi; erken tamamlanan ertelenmiş dönem de çapanın dönemine sayılır
  assert.equal(afterComplete({ dueDate: "2026-11-16", dueTime: null, anchorDate: "2026-11-15", repeat: "monthly" }, "2026-11-16"), "2026-12-15");
  assert.equal(afterComplete({ dueDate: "2026-11-30", dueTime: null, anchorDate: "2026-11-30", repeat: "monthly" }, "2026-11-30"), "2026-12-30");
  assert.equal(afterComplete({ dueDate: "2026-12-01", dueTime: null, anchorDate: "2026-11-30", repeat: "monthly" }, "2026-11-28"), "2026-12-30");
});

test("saatli hatırlatmanın anı Türkiye saatiyle (sunucu UTC'de)", () => {
  assert.equal(dueInstant({ dueDate: "2026-10-21", dueTime: "15:30" }), Date.parse("2026-10-21T12:30:00Z"));
  // Gece yarısından sonraki saat bir önceki UTC gününe düşer
  assert.equal(dueInstant({ dueDate: "2026-10-22", dueTime: "01:15" }), Date.parse("2026-10-21T22:15:00Z"));
  assert.equal(dueInstant({ dueDate: "2026-10-21", dueTime: null }), null);
  assert.equal(dueInstant({ dueDate: "2026-10-21", dueTime: "25:00" }), null);
  assert.deepEqual(trParts(Date.parse("2026-10-21T22:15:00Z")), { date: "2026-10-22", time: "01:15" });
  assert.equal(isTime("09:05"), true);
  assert.equal(isTime("9:05"), false);
});

test("ertele: bir saat (5 dakikaya yuvarlı, geçmişse şimdiden), ertesi gün aynı saat", () => {
  const now = tr("2026-10-21 15:42");
  assert.deepEqual(postponeTarget({ dueDate: "2026-10-21", dueTime: "15:30" }, "hour", now), { dueDate: "2026-10-21", dueTime: "16:45" });
  assert.deepEqual(postponeTarget({ dueDate: "2026-10-21", dueTime: "18:00" }, "hour", now), { dueDate: "2026-10-21", dueTime: "19:00" });
  // 23:30'dan bir saat sonrası ertesi gün
  assert.deepEqual(postponeTarget({ dueDate: "2026-10-21", dueTime: "23:30" }, "hour", tr("2026-10-21 23:31")), { dueDate: "2026-10-22", dueTime: "00:35" });
  assert.deepEqual(postponeTarget({ dueDate: "2026-10-18", dueTime: "09:00" }, "day", now), { dueDate: "2026-10-22", dueTime: "09:00" });
  assert.deepEqual(postponeTarget({ dueDate: "2026-10-25", dueTime: null }, "day", now), { dueDate: "2026-10-26", dueTime: null });
});

test("liste grubu ve etiketi: saati geçen bugünkü hatırlatma gecikmiş sayılır", () => {
  const now = tr("2026-10-21 15:42");
  assert.equal(dueGroup({ dueDate: "2026-10-20", dueTime: null }, now), "overdue");
  assert.equal(dueGroup({ dueDate: "2026-10-21", dueTime: "15:30" }, now), "overdue");
  assert.equal(dueGroup({ dueDate: "2026-10-21", dueTime: "18:00" }, now), "today");
  assert.equal(dueGroup({ dueDate: "2026-10-21", dueTime: null }, now), "today");
  assert.equal(dueGroup({ dueDate: "2026-10-22", dueTime: null }, now), "tomorrow");
  assert.equal(dueGroup({ dueDate: "2026-10-27", dueTime: null }, now), "week");
  assert.equal(dueGroup({ dueDate: "2026-11-20", dueTime: null }, now), "later");
  assert.equal(whenLabel({ dueDate: "2026-10-21", dueTime: "18:00" }, now), "Bugün 18:00");
  assert.equal(whenLabel({ dueDate: "2026-10-22", dueTime: null }, now), "Yarın");
  assert.equal(whenLabel({ dueDate: "2026-10-20", dueTime: null }, now), "Dün");
  assert.equal(whenLabel({ dueDate: "2026-10-24", dueTime: "09:30" }, now), "24 Eki Cumartesi 09:30");
  // Sunucu UTC'de çalışırken 00:00–03:00 arası "bugün" Türkiye günüdür
  assert.equal(dueGroup({ dueDate: "2026-10-22", dueTime: null }, tr("2026-10-22 01:00")), "today");
});

test("tekrar rozeti", () => {
  assert.equal(userRepeatLabel({ repeat: "none", anchorDate: "2026-10-21" }), null);
  assert.equal(userRepeatLabel({ repeat: "daily", anchorDate: "2026-10-21" }), "Her gün");
  assert.equal(userRepeatLabel({ repeat: "weekly", anchorDate: "2026-10-21" }), "Her hafta Çarşamba");
  assert.equal(userRepeatLabel({ repeat: "monthly", anchorDate: "2026-10-15" }), "Her ay 15'inde");
});

// ------------------------------------------------- ses ve atama (4 Kasım 2026)

test("ses seçenekleri: üçü de tanımlı, varsayılan bugünkü davranış", () => {
  assert.deepEqual(
    USER_SOUNDS.map((s) => s.value),
    ["tek", "surekli", "yok"],
  );
  for (const s of USER_SOUNDS) assert.ok(s.label && s.hint, s.value);
  // Şemanın varsayılanı "tek": eski kayıtlar ve yeni hatırlatıcılar bugünkü gibi bir kez çalar
  const sema = readFileSync(join(process.cwd(), "src/server/db/schema.ts"), "utf8");
  assert.match(sema, /sound: text\("sound", \{ enum: \["tek", "surekli", "yok"\] \}\)\.notNull\(\)\.default\("tek"\)/);
  const goc = readFileSync(join(process.cwd(), "drizzle/0055_hatirlatici_ses_atama.sql"), "utf8");
  assert.match(goc, /ADD COLUMN "sound" text DEFAULT 'tek' NOT NULL/);
});

test("atama kuralı eylemde: başkasına yalnız yönetici kurar, sahip sonradan devredilmez", () => {
  const src = readFileSync(join(process.cwd(), "src/server/actions/user-reminders.ts"), "utf8");
  // Personel başkasına kuramaz
  assert.match(src, /if \(me\.role !== "admin"\) throw new UserError\("Hatırlatıcıyı yalnız kendinize kurabilirsiniz"\)/);
  // Hedef etkin bir kullanıcı olmalı
  assert.match(src, /eq\(s\.users\.active, true\)/);
  // `forUserId` yalnız eklemede okunur: güncelleme hedefi sorguyla kendi kayıtlarına kısıtlı
  const guncelle = src.slice(src.indexOf("if (id) {"), src.indexOf("} else {"));
  assert.doesNotMatch(guncelle, /forUserId|userId:/);
  assert.match(guncelle, /\.where\(mine\(id, me\.id\)\)/);
  // Kendine kurduğunda "kim kurdu" yazılmaz
  assert.match(src, /createdBy: hedef === me\.id \? null : me\.id/);
});

test("sürekli ses uyarıyı kapatmaz: alarm durdurulana kadar çalar, bildirimde Durdur var", () => {
  const src = readFileSync(join(process.cwd(), "src/components/panel/live/alert-center.tsx"), "utf8");
  assert.match(src, /const surekli = r\.sound === "surekli"/);
  // Sessizde hiç çalmaz, tekte bir zil, süreklide alarm
  assert.match(src, /if \(prefs\.sound && r\.sound !== "yok"\)/);
  assert.match(src, /if \(surekli\) startAlarm\(owner\);\s*\n\s*else play\("reminder"\);/);
  // Sürekli uyarı kendiliğinden kapanmaz ve kapanınca yalnız kendi sesi durur
  assert.match(src, /duration: surekli \? Infinity : 30_000/);
  assert.match(src, /onDismiss: surekli \? \(\) => stopAlarm\(owner\) : undefined/);
  assert.match(src, /cancel: surekli \? \{ label: "Sesi kes", onClick: \(\) => stopAlarm\(owner\) \}/);
});

test("alarm sahipliği: hatırlatıcının 'Sesi kes'i karaoke alarmını susturmaz, tersi de (SB-02)", () => {
  // Sunucuda ses yok (play bir şey yapmaz); döngü ve sahiplik yine de işler
  assert.equal(alarmRinging(), false);
  startAlarm("karaoke");
  startAlarm("hatirlatici:7");
  stopAlarm("hatirlatici:7");
  assert.equal(alarmRinging(), true);
  assert.equal(alarmRinging("karaoke"), true);
  assert.equal(alarmRinging("hatirlatici:7"), false);
  // Tersi: "Haber verdim" süren hatırlatıcının sesini kesmez
  startAlarm("hatirlatici:7");
  stopAlarm("karaoke");
  assert.equal(alarmRinging("hatirlatici:7"), true);
  // Sahibi olmayanın susturması bir şey değiştirmez; son sahip gidince döngü durur
  stopAlarm("hatirlatici:8");
  assert.equal(alarmRinging(), true);
  stopAlarm("hatirlatici:7");
  assert.equal(alarmRinging(), false);
  // Cihazın sesi kapanınca hepsi susar
  startAlarm("karaoke");
  startAlarm("hatirlatici:7");
  stopAllAlarms();
  assert.equal(alarmRinging(), false);

  // Ekran: karaoke yalnız kendi sahipliğini bırakır
  const src = readFileSync(join(process.cwd(), "src/components/panel/live/alert-center.tsx"), "utf8");
  assert.match(src, /startAlarm\(KARAOKE_ALARM\);\s*\n\s*return \(\) => stopAlarm\(KARAOKE_ALARM\);/);
  assert.match(src, /if \(overtime\.length <= 1\) stopAlarm\(KARAOKE_ALARM\);/);
  assert.match(src, /const owner = reminderAlarm\(r\.id\);/);
  assert.doesNotMatch(src, /stopAlarm\(\)/);
});

test("ekran: sürekli ses ve kimin kurduğu listede rozetle görünür", () => {
  const src = readFileSync(join(process.cwd(), "src/app/panel/hatirlaticilarim/my-reminders.tsx"), "utf8");
  assert.match(src, /r\.sound === "surekli" \?/);
  assert.match(src, /Sürekli ses/);
  assert.match(src, /r\.createdByName \? <Badge tone="blue">\{r\.createdByName\} kurdu<\/Badge> : null/);
  // "Kime" yalnız eklemede ve yalnız kişi listesi doluyken (yönetici)
  assert.match(src, /\{!initial && people\.length \?/);
  // Sayfa listeyi yalnız yöneticide yükler
  const page = readFileSync(join(process.cwd(), "src/app/panel/hatirlaticilarim/page.tsx"), "utf8");
  assert.match(page, /user\.role === "admin" \? assignablePeople\(user\.id\) : Promise\.resolve\(\[\]\)/);
});
