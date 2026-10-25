// Kasadaki fiyatlar, Bugün ve zil (dalga 10 §2.2; src/app/panel/bugun/rows-ops.ts posRow, src/lib/prices/pos.ts
// posBell ve posMarksText): personelin satırı Kasadaki fiyatlar listesine götürür ve hızlı sayımdan sonra gelir;
// yöneticinin satırı son 48 saatin personel işaretlerini söyler, bekleyen fiyat yoksa Tamamlananlar'a düşer; zilin
// kimliği iki rolde en yeni geri kalıştan: işaret zili yeniden okunmamış yapmaz, yeni bir fiyat yapar.
// Saatler sabit: tr("2026-10-22T14:00") Türkiye'de 22 Ekim Perşembe 14:00 (UTC+3).
// Çalıştırma: npx tsx --test tests/kasaya-isle.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { dayTasks, splitTasks, type DayFacts, type DayTask } from "../src/app/panel/bugun/logic";
import { posBell, posMarksText } from "../src/lib/prices/pos";

const tr = (local: string) => new Date(`${local}:00+03:00`);
const NOON = tr("2026-10-22T14:00");
const STOCK = { month: "2026-10", counted: 0, total: 40, prevMonth: "2026-09", prevHasData: true, prevCounted: 40, prevTotal: 40 };

function staff(now: Date, o: Partial<DayFacts> = {}): DayFacts {
  return { role: "staff", now, cash: { today: null, yesterday: null, firstDate: null }, waste: { count: 0, zayi: null, ikram: null }, stock: STOCK, ...o };
}
function admin(now: Date, o: Partial<DayFacts> = {}): DayFacts {
  return { role: "admin", now, cash: { today: null, yesterday: null, firstDate: null }, stock: STOCK, system: [], payments: [], invoices: { review: 0 }, ...o };
}
const row = (tasks: DayTask[]) => tasks.find((t) => t.key === "modpos");
const POS = { count: 3, oldest: tr("2026-10-20T10:00").toISOString() };

test("1. personel: Kasadaki fiyatlar satırı; Listeyi aç; hızlı sayımdan sonra", () => {
  // 22 Ekim Perşembe hızlı sayım günü: hızlı sayım satırı da çıkar
  const tasks = dayTasks(staff(NOON, { pos: POS, reorder: { total: 12, countedToday: 0, lastCountDay: "2026-10-15", countWeekdays: [4] } }));
  const r = row(tasks);
  assert.ok(r);
  assert.equal(r.title, "Kasadaki fiyatlar");
  assert.equal(r.status, "todo");
  assert.equal(r.badge, "3 fiyat");
  assert.equal(r.detail, "ModPOS'ta değişecek 3 fiyat; değiştirdikçe işaretleyin. En eskisi 2 gündür bekliyor.");
  assert.equal(r.href, "/panel/kasa/fiyatlar");
  assert.equal(r.action, "Listeyi aç");
  const keys = tasks.map((t) => t.key);
  assert.ok(keys.includes("hizli-sayim"), keys.join());
  assert.equal(keys.indexOf("modpos"), keys.indexOf("hizli-sayim") + 1, keys.join());
  // Bekleyen yoksa satır yok
  assert.equal(row(dayTasks(staff(NOON, { pos: { count: 0, oldest: null } }))), undefined);
  assert.equal(row(dayTasks(staff(NOON))), undefined);
  // Bugünden beri
  assert.match(row(dayTasks(staff(NOON, { pos: { count: 1, oldest: tr("2026-10-22T09:00").toISOString() } })))!.detail, /En eskisi bugünden beri bekliyor\.$/);
});

test("2. yönetici: bekleyen fiyat + son 48 saatte personel işareti; bekleyen yoksa Tamamlananlar", () => {
  const marks = [{ by: "Ayşe", count: 3, at: tr("2026-10-21T22:10").toISOString() }];
  const withPending = row(dayTasks(admin(NOON, { pos: POS, ops: { posMarks: marks } })));
  assert.ok(withPending);
  assert.equal(withPending.status, "todo");
  assert.equal(withPending.href, "/panel/urunler/fiyatlar?sekme=kasa");
  assert.equal(withPending.action, "Kasaya işle");
  assert.match(withPending.detail, /^Kasada değişecek 3 fiyat: ModPOS'ta elle değiştirip Fiyatlar › Kasaya işle'de işaretleyin\. En eskisi 2 gündür bekliyor\. Ayşe dün 3 fiyatı kasada işaretledi\.$/);
  const done = row(dayTasks(admin(NOON, { pos: { count: 0, oldest: null }, ops: { posMarks: marks } })));
  assert.ok(done);
  assert.equal(done.status, "done");
  assert.equal(done.title, "Kasadaki fiyatlar");
  assert.equal(done.detail, "Ayşe dün 3 fiyatı kasada işaretledi.");
  assert.equal(done.href, "/panel/urunler/fiyatlar?sekme=kasa#son-isaretlenenler");
  assert.equal(done.action, "Son işaretlenenler");
  assert.equal(splitTasks([done]).done.length, 1);
  // İşaret de bekleyen de yoksa satır yok
  assert.equal(row(dayTasks(admin(NOON, { pos: { count: 0, oldest: null }, ops: { posMarks: [] } }))), undefined);
  // Personelin olgusunda işaret satırı yok (işaretler yalnız yöneticiye)
  assert.doesNotMatch(row(dayTasks(staff(NOON, { pos: POS, ops: { posMarks: marks } })))!.detail, /Ayşe/);
});

test("3. işaret metni: kişi başına gün ve sayı; birden çok kişi", () => {
  assert.equal(posMarksText([{ by: "Ayşe", count: 3, at: tr("2026-10-21T22:10").toISOString() }], NOON), "Ayşe dün 3 fiyatı kasada işaretledi.");
  assert.equal(
    posMarksText(
      [
        { by: "Mehmet", count: 1, at: tr("2026-10-22T09:00").toISOString() },
        { by: "Ayşe", count: 34, at: tr("2026-10-21T22:10").toISOString() },
      ],
      NOON,
    ),
    "Mehmet bugün 1 fiyatı, Ayşe dün 34 fiyatı kasada işaretledi.",
  );
  assert.equal(posMarksText([], NOON), null);
});

test("4. zil: kimlik iki rolde en yeni geri kalıştan (işaret yeniden okunmamış yapmaz); personel Kasadaki fiyatlar'a, yönetici Kasaya işle'ye", () => {
  const newest = tr("2026-10-22T10:00");
  const summary = { count: 3, oldest: tr("2026-10-20T10:00"), newest };
  const s = posBell("staff", summary, NOON);
  assert.deepEqual(s, {
    id: `kasa-fiyat-${newest.getTime()}`,
    kind: "info",
    title: "Kasada değişecek 3 fiyat",
    body: "ModPOS'ta değiştirip Kasadaki fiyatlar'da işaretleyin",
    timeLabel: "2 gün önce",
    unread: true,
    href: "/panel/kasa/fiyatlar",
    group: "kasa",
  });
  const a = posBell("admin", summary, NOON);
  assert.equal(a?.id, `kasa-fiyat-${newest.getTime()}`);
  assert.equal(a?.href, "/panel/urunler/fiyatlar?sekme=kasa");
  assert.equal(a?.group, "uyari");
  assert.equal(a?.body, "ModPOS'ta elle değiştirip Fiyatlar › Kasaya işle'de işaretleyin");
  // Bir fiyat işaretlendi (sayı düştü, en yeni aynı): kimlik aynı, zil yeniden yanmaz
  assert.equal(posBell("admin", { ...summary, count: 2 }, NOON)?.id, a?.id);
  // Yeni bir fiyat girdi: kimlik değişir
  assert.notEqual(posBell("admin", { ...summary, count: 4, newest: tr("2026-10-22T13:00") }, NOON)?.id, a?.id);
  assert.equal(posBell("staff", { count: 0, oldest: null, newest: null }, NOON), null);
});
