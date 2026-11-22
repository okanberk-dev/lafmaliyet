// Uyarı sesleri sürekli çalmaz (en çok 3 çalış) ve yalnız 10:00–01:00 arasında çalar (İstanbul, UTC+3).
// Çalıştırma: npx tsx --test tests/uyari-sesi-saatleri.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mock, test } from "node:test";

import { ALERT_SOUND_FROM_MIN, ALERT_SOUND_UNTIL_MIN, alertHoursOpen } from "../src/lib/audio-output";
import { ALARM_RINGS, alarmRinging, startAlarm, stopAlarm } from "../src/components/panel/live/sounds";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const tr = (local: string) => Date.parse(`2026-11-18T${local}:00+03:00`);

test("ses saatleri: 10:00'dan önce ve 01:00'dan sonra yok", () => {
  assert.equal(ALERT_SOUND_FROM_MIN, 600);
  assert.equal(ALERT_SOUND_UNTIL_MIN, 60);
  for (const quiet of ["01:01", "02:00", "05:00", "08:00", "09:30", "09:59"]) assert.equal(alertHoursOpen(tr(quiet)), false, quiet);
  for (const loud of ["10:00", "10:01", "13:00", "22:00", "23:59", "00:00", "00:30", "01:00"]) assert.equal(alertHoursOpen(tr(loud)), true, loud);
  // Gün sınırı: UTC gece yarısı Türkiye 03:00'tür
  assert.equal(alertHoursOpen(Date.parse("2026-11-18T00:00:00Z")), false);
  assert.equal(alertHoursOpen(Date.parse("2026-11-18T07:00:00Z")), true);
});

test("service worker aynı saat kuralını taşır ve dışında bildirimi sessiz yapar", () => {
  const sw = read("public/sw.js");
  const fn = /function soundHours\(atMs\) \{([\s\S]*?)\n\}/.exec(sw);
  assert.ok(fn, "soundHours var");
  const soundHours = new Function("atMs", fn[1]) as (ms: number) => boolean;
  for (let m = 0; m < 24 * 60; m++) {
    const at = tr("00:00") + m * 60_000;
    assert.equal(soundHours(at), alertHoursOpen(at), `dakika ${m}`);
  }
  assert.match(sw, /const quiet = pageRings \|\| \(await quietDevice\(\)\) \|\| !soundHours\(Date\.now\(\)\);/);
});

test("alarm sürekli çalmaz: 3 çalıştan sonra kendiliğinden susar", () => {
  assert.equal(ALARM_RINGS, 3);
  mock.timers.enable({ apis: ["setInterval", "Date"], now: tr("12:00") });
  try {
    startAlarm("karaoke");
    assert.equal(alarmRinging(), true);
    // 1. çalış hemen, 2. ve 3. çalış 2,2 sn arayla; sonraki aralıkta alarm durur
    mock.timers.tick(2200);
    mock.timers.tick(2200);
    assert.equal(alarmRinging(), true);
    mock.timers.tick(2200);
    assert.equal(alarmRinging(), false);
    // Uzun süre geçse de yeniden başlamaz
    mock.timers.tick(30 * 60_000);
    assert.equal(alarmRinging(), false);
  } finally {
    stopAlarm();
    mock.timers.reset();
  }
});

test("kaynak: 30 dakikalık döngü, altı çalışlık patlama ve beş çanlı masa zili kalktı; deneme sesi saat kuralına bakmaz", () => {
  const src = read("src/components/panel/live/sounds.ts");
  assert.doesNotMatch(src, /30 \* 60_000/);
  assert.doesNotMatch(src, /i < 6/);
  assert.match(src, /table: \[0, 0\.75, 1\.5\]\.flatMap/);
  assert.match(src, /for \(let i = 0; i < ALARM_RINGS; i\+\+\) nodes\.push\(\.\.\.schedule\("alarm"/);
  assert.match(src, /if \(kind !== "test" && !alertHoursOpen\(wallMs\)\) return \[\];/);
});
