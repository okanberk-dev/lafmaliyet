// Kişisel hatırlatıcılar: tekrar, tamamlama, erteleme, saatli hatırlatmanın anı (Türkiye saati) ve listedeki grubu
// (src/lib/user-reminders.ts).
// Çalıştırma: npx tsx --test tests/hatirlaticilarim.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { alarmRinging, startAlarm, stopAlarm } from "../src/components/panel/live/sounds";
import {
  afterComplete,
  anchorTimeOnEdit,
  completeTarget,
  dueGroup,
  dueInstant,
  isTime,
  nextUserOccurrence,
  pendingReminders,
  planReminderAlerts,
  postponeTarget,
  REMINDER_ALERT,
  reminderAlarm,
  reminderAlertKey,
  ringingReminders,
  sinceLabel,
  trParts,
  USER_SOUNDS,
  userRepeatLabel,
  whenLabel,
} from "../src/lib/user-reminders";

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

// Denetim 21 Kasım #15: "1 saat sonra hatırlat" yalnız o dönemi kaydırır; seri kendi saatine döner
test("ertelenen tekrar eden hatırlatma: Yaptım sıradaki döneme serinin saatiyle geçer", () => {
  const seri = { dueDate: "2026-11-21", dueTime: "09:00", anchorDate: "2026-11-21", anchorTime: "09:00", repeat: "daily" as const };
  // 09:02'de bir saat ertelenir: yalnız bugünkü dönemin saati
  const ertelendi = { ...seri, ...postponeTarget(seri, "hour", tr("2026-11-21 09:02")) };
  assert.deepEqual({ dueDate: ertelendi.dueDate, dueTime: ertelendi.dueTime }, { dueDate: "2026-11-21", dueTime: "10:05" });
  // 10:06'da Yaptım: yarın yine 09:00 (önceden 10:05'te kalıyordu)
  assert.deepEqual(completeTarget(ertelendi, "2026-11-21"), { dueDate: "2026-11-22", dueTime: "09:00" });
  // Gece yarısını geçen erteleme (23:30 → 00:35) de seriyi kaydırmaz
  const gece = { ...seri, dueTime: "23:30", anchorTime: "23:30" };
  const gecti = { ...gece, ...postponeTarget(gece, "hour", tr("2026-11-21 23:31")) };
  assert.deepEqual({ dueDate: gecti.dueDate, dueTime: gecti.dueTime }, { dueDate: "2026-11-22", dueTime: "00:35" });
  assert.deepEqual(completeTarget(gecti, "2026-11-22"), { dueDate: "2026-11-23", dueTime: "23:30" });
  // Haftalık: çapanın günü ve saati
  const hafta = { dueDate: "2026-11-21", dueTime: "11:20", anchorDate: "2026-11-14", anchorTime: "10:00", repeat: "weekly" as const };
  assert.deepEqual(completeTarget(hafta, "2026-11-21"), { dueDate: "2026-11-28", dueTime: "10:00" });
  // Tek seferlik kapanır; saatsiz seri saatsiz kalır; saat çapası boş eski satırda bugünkü saat
  assert.equal(completeTarget({ ...seri, repeat: "none" }, "2026-11-21"), null);
  assert.deepEqual(completeTarget({ ...seri, dueTime: null, anchorTime: null }, "2026-11-21"), { dueDate: "2026-11-22", dueTime: null });
  assert.deepEqual(completeTarget({ ...seri, dueTime: "10:05", anchorTime: null }, "2026-11-21"), { dueDate: "2026-11-22", dueTime: "10:05" });
});

test("düzenlemede serinin saati: elle değişen saat yeni saat, değişmeyen (ertelenmiş dönemin) saat çapayı ezmez", () => {
  assert.equal(anchorTimeOnEdit({ dueTime: "10:05", anchorTime: "09:00" }, "10:05"), "09:00", "yalnız başlık düzeltildi");
  assert.equal(anchorTimeOnEdit({ dueTime: "10:05", anchorTime: "09:00" }, "11:00"), "11:00", "saat elle değişti");
  assert.equal(anchorTimeOnEdit({ dueTime: "09:00", anchorTime: "09:00" }, null), null, "saat kaldırıldı");
  assert.equal(anchorTimeOnEdit({ dueTime: null, anchorTime: null }, "08:30"), "08:30", "saat eklendi");
  assert.equal(anchorTimeOnEdit({ dueTime: "09:00", anchorTime: null }, "09:00"), "09:00", "çapasız eski satır");

  const src = readFileSync(join(process.cwd(), "src/server/actions/user-reminders.ts"), "utf8");
  // Ekleme ve düzenleme çapayı yazar
  assert.match(src, /anchorDate: data\.dueDate,\s+anchorTime: data\.dueTime,/);
  assert.match(src, /const anchorTime = anchorTimeOnEdit\(prev, data\.dueTime\);/);
  assert.match(src, /\.set\(\{ \.\.\.data, anchorDate, anchorTime, active: true, updatedAt: new Date\(\) \}\)/);
  // Yaptım serinin saatiyle ilerler
  const tamam = src.slice(src.indexOf("export async function completeUserReminder"), src.indexOf("const snapshotSchema"));
  assert.match(tamam, /completeTarget\(\{ dueDate: r\.dueDate, dueTime: r\.dueTime, anchorDate: r\.anchorDate, anchorTime: r\.anchorTime, repeat: r\.repeat as UserRepeat \}, todayTR\(\)\)/);
  assert.match(tamam, /\.set\(target \? \{ \.\.\.target, doneAt: new Date\(\), updatedAt: new Date\(\) \}/);
  // Erteleme ve geri al çapalara dokunmaz
  for (const name of ["postponeUserReminder", "restoreUserReminder"]) {
    const start = src.indexOf(`export async function ${name}`);
    const next = src.indexOf("\nexport ", start + 1);
    assert.doesNotMatch(src.slice(start, next < 0 ? undefined : next), /anchor/, name);
  }
  // Şema ve göç: eski satırların saati bugünkü saatleri
  const sema = readFileSync(join(process.cwd(), "src/server/db/schema.ts"), "utf8");
  assert.match(sema, /anchorTime: text\("anchor_time"\),/);
  const goc = readFileSync(join(process.cwd(), "drizzle/0060_hatirlatici_saat_capasi.sql"), "utf8");
  assert.match(goc, /ALTER TABLE "user_reminders" ADD COLUMN "anchor_time" text;/);
  assert.match(goc, /UPDATE "user_reminders" SET "anchor_time" = "due_time" WHERE "anchor_time" IS NULL;/);
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

test("sürekli ses uyarıyı kapatmaz: alarm Yaptım ya da Sesi kes'e kadar çalar; pencerede ve köşe kartında Sesi kes var", () => {
  const src = readFileSync(join(process.cwd(), "src/components/panel/live/alert-center.tsx"), "utf8");
  assert.match(src, /const surekli = r\.sound === "surekli"/);
  // Sessizde hiç çalmaz, tekte bir zil, süreklide alarm (hatırlatmanın kendi sahibiyle: karaoke alarmından ayrı susar)
  assert.match(src, /if \(prefs\.sound && r\.sound !== "yok"\)/);
  assert.match(src, /if \(surekli\) startAlarm\(reminderAlarm\(r\.id\)\);\s*\n\s*else play\("reminder"\);/);
  // Saatinde toast değil, ekranın ortasında pencere
  assert.match(src, /showReminder\(r\);\s*\n\s*void notify\(`Hatırlatma: \$\{r\.title\}`/);
  assert.doesNotMatch(src, /toast\(r\.title/);
  // Karaoke alarmının etkisi yalnız kendi alarmını keser (ses açılınca hatırlatmanın alarmı susmaz)
  assert.match(src, /startAlarm\("karaoke"\);\s*\n\s*return \(\) => stopAlarm\("karaoke"\);/);
  assert.doesNotMatch(src, /stopAlarm\(\)/);
  const ui = readFileSync(join(process.cwd(), "src/components/panel/live/reminder-alerts.tsx"), "utf8");
  // Pencereyi kapatmak sesi kesmez (yalnız sıradan çıkarır); Yaptım, erteleme ve Sesi kes keser
  const onClose = ui.slice(ui.indexOf("onClose={() => {"), ui.indexOf("size=\"sm\""));
  assert.match(onClose, /dropPopup\(popup\.id\)/);
  assert.doesNotMatch(onClose, /stopAlarm|silence/);
  assert.match(ui, /async function done\(r: LiveReminder\) \{\s*\n\s*setBusy\(r\.id\);\s*\n\s*stopAlarm\(reminderAlarm\(r\.id\)\);/);
  assert.match(ui, /async function snooze\(r: LiveReminder\) \{\s*\n\s*setBusy\(r\.id\);\s*\n\s*stopAlarm\(reminderAlarm\(r\.id\)\);/);
  assert.equal(ui.match(/> Sesi kes\n/g)?.length, 2, "pencerede ve köşe kartında");
});

// ------------------------------------------------- açılır pencere ve köşe kartı (16 Kasım 2026)

const r = (id: number, dueDate: string, dueTime: string | null, active = true) => ({ id, dueDate, dueTime, active });

test("köşe kartı: saati gelmiş, açık, saatli hatırlatmalar; en son gelen önce", () => {
  const now = tr("2026-11-16 15:42").getTime();
  const list = [
    r(1, "2026-11-16", "15:30"),
    r(2, "2026-11-16", "16:00"), // henüz gelmedi
    r(3, "2026-11-16", null), // saatsiz: gün boyu listede, köşeye girmez
    r(4, "2026-11-14", "09:00"), // iki gün önce, hâlâ yapılmadı
    r(5, "2026-11-16", "15:40", false), // tamamlandı (tek seferlik kapandı)
    r(6, "2026-11-16", "15:42"), // tam şimdi
    r(7, "2026-11-16", "15:30"), // aynı anda: büyük kimlik (sonra kurulan) önce
  ];
  assert.deepEqual(
    pendingReminders(list, now).map((x) => x.id),
    [6, 7, 1, 4],
  );
  assert.deepEqual(pendingReminders([], now), []);
  // Tamamlanan tekrar eden sıradaki güne ilerler: köşeden kalkar
  const next = afterComplete({ dueDate: "2026-11-16", dueTime: "15:30", anchorDate: "2026-11-16", repeat: "daily" }, "2026-11-16");
  assert.deepEqual(pendingReminders([r(1, next!, "15:30")], now), []);
  // Bir saat ertelenen de kalkar, saati gelince yeniden çıkar
  const later = postponeTarget({ dueDate: "2026-11-16", dueTime: "15:30" }, "hour", new Date(now));
  assert.deepEqual(pendingReminders([r(1, later.dueDate, later.dueTime)], now), []);
  assert.deepEqual(pendingReminders([r(1, later.dueDate, later.dueTime)], tr(`${later.dueDate} ${later.dueTime}`).getTime()).length, 1);
});

test("uyarı planı: vaktinde (5 dk geç dahil) sesle, 12 saate kadar kaçan sessiz pencereyle, eskisi yalnız köşede", () => {
  const now = tr("2026-11-16 15:42").getTime();
  const list = [
    r(1, "2026-11-16", "16:00"), // ileride: zamanlayıcı
    r(2, "2026-11-16", "15:40"), // 2 dk geç: yine sesle
    r(3, "2026-11-16", "15:30"), // 12 dk geç: sessiz pencere
    r(4, "2026-11-16", "03:00"), // 12 saatten eski: yalnız köşede
    r(5, "2026-11-18", "09:00"), // bir günden ileride: sonra kurulur
    r(6, "2026-11-16", null), // saatsiz
    r(7, "2026-11-16", "15:35", false), // kapanmış
    r(8, "2026-11-16", "15:20"), // bu cihazda zaten açıldı
  ];
  const fired = new Set([reminderAlertKey(r(8, "2026-11-16", "15:20"))]);
  const plan = planReminderAlerts(list, fired, now);
  assert.deepEqual(
    plan.timers.map((x) => x.r.id),
    [1, 2],
  );
  assert.equal(plan.timers[0].at, tr("2026-11-16 16:00").getTime());
  assert.deepEqual(
    plan.late.map((x) => x.r.id),
    [3],
  );
  // Sınırlar
  assert.equal(planReminderAlerts([r(1, "2026-11-16", "15:37")], new Set(), now).timers.length, 1, "tam 5 dk");
  assert.equal(planReminderAlerts([r(1, "2026-11-16", "15:36")], new Set(), now).late.length, 1);
  assert.equal(planReminderAlerts([r(1, "2026-11-16", "03:42")], new Set(), now).late.length, 1, "tam 12 saat");
  assert.equal(planReminderAlerts([r(1, "2026-11-17", "15:42")], new Set(), now).timers.length, 1, "tam 24 saat");
  assert.equal(REMINDER_ALERT.ringLateMs, 5 * 60_000);
  // Anahtar eski biçimde (yayından önce çalmış uyarı yeniden çalmaz); ertelenen dönem yeni anahtar alır
  assert.equal(reminderAlertKey(r(8, "2026-11-16", "15:20")), "hatirlatici:8:2026-11-16:15:20");
  assert.equal(reminderAlertKey(r(8, "2026-11-16", null)), "hatirlatici:8:2026-11-16:null");
  assert.equal(planReminderAlerts([r(8, "2026-11-16", "16:25")], fired, now).timers.length, 1, "ertelenen yeniden çalar");
});

test("geçen süre etiketi", () => {
  const at = tr("2026-11-16 15:00").getTime();
  assert.equal(sinceLabel(at, at + 30_000), "az önce");
  assert.equal(sinceLabel(at, at + 12 * 60_000), "12 dk önce");
  assert.equal(sinceLabel(at, at + 59 * 60_000 + 59_000), "59 dk önce");
  assert.equal(sinceLabel(at, at + 2 * 3_600_000 + 5 * 60_000), "2 saat önce");
  assert.equal(sinceLabel(at, at + 3 * 86_400_000), "3 gün önce");
});

test("alarm sahipleri: her uyarı yalnız kendini susturur, son sahip susunca alarm durur", () => {
  startAlarm("karaoke");
  startAlarm("hatirlatici:12");
  assert.equal(alarmRinging(), true);
  stopAlarm("hatirlatici:12");
  assert.equal(alarmRinging(), true, "hatırlatmada Yaptım karaoke alarmını kesmez");
  stopAlarm("karaoke");
  assert.equal(alarmRinging(), false);
  startAlarm("karaoke");
  startAlarm("hatirlatici:3");
  stopAlarm();
  assert.equal(alarmRinging(), false, "30 dakika dolunca hepsi");
  assert.deepEqual(ringingReminders("hatirlatici:12,hatirlatici:3,karaoke"), [12, 3]);
  assert.deepEqual(ringingReminders(""), []);
  assert.equal(reminderAlarm(12), "hatirlatici:12");
});

test("köşe kartı ve pencere: kabukta, her ekranda; kapatılamaz, hareket azaltılınca durur, ekran okuyucuya duyurulur", () => {
  const ui = readFileSync(join(process.cwd(), "src/components/panel/live/reminder-alerts.tsx"), "utf8");
  // Liste sunucunun verisinden (canlı uç) türer: sayfa yenilense de yerinde
  assert.match(ui, /const pending = enabled && at \? pendingReminders\(list, at\) : NO_REMINDERS;/);
  // Kartta kapatma düğmesi yok: yalnız Yaptım (ve başlıktan ayrıntı / erteleme)
  const dock = ui.slice(ui.indexOf("function ReminderDock("), ui.indexOf("function BellTile("));
  assert.doesNotMatch(dock, /aria-label="Kapat"|<X\b/);
  assert.match(dock, /aria-label=\{`Yaptım: \$\{r\.title\}`\}/);
  assert.match(dock, /data-reminder-dock/);
  assert.match(dock, /bottom-\[calc\(var\(--mobile-nav-space,0px\)\+0\.75rem\)\]/);
  assert.match(ui, /motion-safe:animate-ping/);
  assert.match(ui, /<p role="status" className="sr-only">/);
  // Pencerede odak düğmede başlamaz (yazarken Enter yanlışlıkla "Yaptım" demesin)
  assert.match(ui, /<div data-autofocus tabIndex=\{-1\}/);
  assert.match(ui, /1 saat sonra hatırlat/);
  assert.match(ui, /postponeUserReminder\(r\.id, "hour"\)/);
  assert.match(ui, /completeUserReminder\(r\.id\)/);
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  assert.match(css, /\[data-component="app-shell"\]:has\(\[data-reminder-dock\]\) \{\s*--mobile-nav-h: calc\(var\(--mobile-nav-space\) \+ var\(--reminder-dock-h, 0px\)\);/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\s*\.reminder-nudge \{/);
  // Uyarı motoru kabukta bir kez (sidebar.tsx) ve kartı çizer
  const center = readFileSync(join(process.cwd(), "src/components/panel/live/alert-center.tsx"), "utf8");
  // Kart kabuğun kullanıcısının hatırlatıcılarını çizer (ortak cihaz, denetim KA-01; tests/paylasilan-cihaz.test.ts)
  assert.match(center, /<ReminderAlerts userId=\{userId\} enabled=\{prefs\.reminderAlerts\} now=\{now\}/);
  assert.match(readFileSync(join(process.cwd(), "src/components/panel/sidebar.tsx"), "utf8"), /<AlertCenter role=\{user\.role\} userId=\{user\.id\} \/>/);
});

test("Kime: yönetici için formun başında, saat verilmeden başkasına kurulunca uyarır", () => {
  const src = readFileSync(join(process.cwd(), "src/app/panel/hatirlaticilarim/my-reminders.tsx"), "utf8");
  const form = src.slice(src.indexOf('<form id="hatirlatici-form"'));
  assert.ok(form.indexOf('htmlFor="ht-kime"') < form.indexOf('htmlFor="ht-tarih"'), "Kime tarihin ve saatin üstünde");
  assert.match(form, /forUserId && !withTime\s*\?\s*"Saat verin:/);
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
