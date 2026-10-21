// Kişisel hatırlatıcılar: tekrar, tamamlama, erteleme, saatli hatırlatmanın anı (Türkiye saati) ve listedeki grubu
// (src/lib/user-reminders.ts).
// Çalıştırma: npx tsx --test tests/hatirlaticilarim.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { afterComplete, dueGroup, dueInstant, isTime, nextUserOccurrence, postponeTarget, trParts, userRepeatLabel, whenLabel } from "../src/lib/user-reminders";

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
