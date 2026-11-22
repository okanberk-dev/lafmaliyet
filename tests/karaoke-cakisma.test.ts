// Karaoke: rezervasyonsuz oturumun ya da uzatmanın sitedeki rezervasyonla çakışması (docs/KARAOKE.md "Çakışma uyarısı"):
// hangi rezervasyon odayı tutar, çakışma aralığı, personele sorulan metin, uzatmanın aralığı ve sunucu eyleminin sırası.
// Çalıştırma: npx tsx --test tests/karaoke-cakisma.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { extensionWindow, holdsRoom, overlapConflict, overlapMessage, overlapText, siteOverlaps, type OverlapSession } from "../src/lib/karaoke/overlap";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const at = (iso: string) => Date.parse(iso);

/** Sitedeki onaylı bir rezervasyon (saatler UTC; İstanbul = UTC+3) */
const booking = (over: Partial<OverlapSession> = {}): OverlapSession => ({
  id: 1,
  source: "site",
  customerName: "Deniz",
  startsAt: "2026-10-24T17:00:00.000Z", // 20:00
  endsAt: "2026-10-24T19:00:00.000Z", // 22:00
  extraMinutes: 0,
  status: "confirmed",
  paymentStatus: "paid",
  endedAt: null,
  ...over,
});

test("odayı tutan rezervasyon: onaylı ya da onay bekleyen / ödenmiş; iptal, tutma, düşen, iade ve bitmiş tutmaz", () => {
  assert.equal(holdsRoom(booking()), true);
  assert.equal(holdsRoom(booking({ status: "confirmed", paymentStatus: "none" })), true, "kasada ödenecek onaylı");
  assert.equal(holdsRoom(booking({ status: "requested", paymentStatus: "none" })), true, "onay bekleyen talep");
  assert.equal(holdsRoom(booking({ status: "requested", paymentStatus: "paid" })), true);
  assert.equal(holdsRoom(booking({ status: "requested", paymentStatus: "pending" })), false, "ödeme sayfası açık tutma");
  assert.equal(holdsRoom(booking({ status: "cancelled", paymentStatus: "refunding" })), false);
  assert.equal(holdsRoom(booking({ paymentStatus: "expired" })), false);
  assert.equal(holdsRoom(booking({ paymentStatus: "refunded" })), false);
  assert.equal(holdsRoom(booking({ endedAt: "2026-10-24T18:30:00.000Z" })), false, "panelde bitti denmiş");
  assert.equal(holdsRoom(booking({ source: "panel" })), false, "rezervasyonsuz sayaç sitedeki rezervasyon değildir");
});

test("çakışma: aralıklar kesişirse; uç uca saatler çakışmaz; uzatma dahil bitiş; kendisi sayılmaz; başlangıca göre sıralı", () => {
  const b = booking();
  const w = (from: string, to: string) => ({ start: at(from), end: at(to) });
  assert.deepEqual(siteOverlaps(w("2026-10-24T16:00:00Z", "2026-10-24T17:30:00Z"), [b]), [b], "19:00–20:30 sayaç 20:00 rezervasyonuna biner");
  assert.deepEqual(siteOverlaps(w("2026-10-24T16:00:00Z", "2026-10-24T17:00:00Z"), [b]), [], "20:00'de biten sayaç 20:00 rezervasyonuyla çakışmaz");
  assert.deepEqual(siteOverlaps(w("2026-10-24T19:00:00Z", "2026-10-24T20:00:00Z"), [b]), [], "22:00'de başlayan çakışmaz");
  assert.deepEqual(siteOverlaps(w("2026-10-24T18:00:00Z", "2026-10-24T18:30:00Z"), [b]), [b], "süren rezervasyonun içinde");
  const extended = booking({ extraMinutes: 30 });
  assert.deepEqual(siteOverlaps(w("2026-10-24T19:10:00Z", "2026-10-24T20:00:00Z"), [extended]), [extended], "uzatılmış rezervasyon 22:30'a kadar");
  assert.deepEqual(siteOverlaps(w("2026-10-24T16:00:00Z", "2026-10-24T18:00:00Z"), [b], b.id), [], "uzatılan oturumun kendisi");
  const later = booking({ id: 2, customerName: "Ali", startsAt: "2026-10-24T19:00:00.000Z", endsAt: "2026-10-24T20:00:00.000Z" });
  const cancelled = booking({ id: 3, status: "cancelled" });
  assert.deepEqual(
    siteOverlaps(w("2026-10-24T16:30:00Z", "2026-10-24T19:30:00Z"), [later, cancelled, b]).map((x) => x.id),
    [1, 2],
  );
  assert.deepEqual(siteOverlaps({ start: 10, end: 10 }, [b]), [], "boş aralık");
});

test("metin: tek rezervasyon adıyla ve saatiyle; adsız; birden çok; başka gün; uzatma", () => {
  const now = at("2026-10-24T15:00:00.000Z"); // 18:00 İstanbul
  assert.equal(overlapMessage([booking()], "start", now), "Bu saatte sitede Deniz adına 20:00–22:00 rezervasyon var. Yine de başlatılsın mı?");
  assert.equal(overlapMessage([booking({ customerName: null })], "start", now), "Bu saatte sitede 20:00–22:00 rezervasyon var. Yine de başlatılsın mı?");
  assert.equal(overlapMessage([booking()], "extend", now), "Bu saatte sitede Deniz adına 20:00–22:00 rezervasyon var. Yine de uzatılsın mı?");
  const ali = booking({ id: 2, customerName: "Ali", startsAt: "2026-10-24T21:30:00.000Z", endsAt: "2026-10-24T23:00:00.000Z" });
  assert.equal(
    overlapText([booking(), ali], now),
    "Bu saatte sitede 2 rezervasyon var: Deniz adına 20:00–22:00; Ali adına Yarın 00:30–02:00.",
    "İstanbul'da gece yarısını geçen rezervasyon ertesi gündür",
  );
  assert.equal(overlapText([booking({ extraMinutes: 15 })], now), "Bu saatte sitede Deniz adına 20:00–22:15 rezervasyon var.", "uzatma dahil bitiş");
  assert.equal(overlapMessage([], "start", now), null);
  const conflict = overlapConflict([booking({ extraMinutes: 15 })], "start", now);
  assert.deepEqual(conflict?.bookings, [{ id: 1, name: "Deniz", startsAt: "2026-10-24T17:00:00.000Z", endsAt: "2026-10-24T19:15:00.000Z" }]);
  assert.equal(overlapConflict([], "start", now), null);
});

test("uzatmanın aralığı: şimdiki bitişten (uzatmalar dahil) yeni bitişe", () => {
  const s = booking({ extraMinutes: 15 });
  assert.deepEqual(extensionWindow(s, 30), { start: at("2026-10-24T19:15:00.000Z"), end: at("2026-10-24T19:45:00.000Z") });
  const next = booking({ id: 2, customerName: "Ali", startsAt: "2026-10-24T19:30:00.000Z", endsAt: "2026-10-24T21:00:00.000Z" });
  assert.deepEqual(siteOverlaps(extensionWindow(s, 30), [s, next], s.id), [next], "+30 dk sonraki rezervasyona biner");
  assert.deepEqual(siteOverlaps(extensionWindow(s, 15), [s, next], s.id), [], "+15 dk tam başlangıca kadar: çakışmaz");
});

test("sunucu: çakışma kaydetmeden önce sorulur, `force` ile yine de kaydedilir; ekran onaylayıp yeniden gönderir", () => {
  const actions = read("src/server/actions/karaoke.ts");
  const start = actions.slice(actions.indexOf("export async function startKaraokeTimer"));
  assert.ok(start.indexOf("if (!data.force)") < start.indexOf(".insert(s.karaokeSessions)"), "sayaç açılmadan önce");
  assert.match(start, /if \(conflict\) return \{ conflict \}/);
  const extend = actions.slice(actions.indexOf("export async function extendKaraokeSession"));
  // Yazım tek adımda (src/server/karaoke/extend.ts addExtraMinutes); çakışma ondan önce sorulur
  assert.ok(extend.indexOf("if (!force)") > 0 && extend.indexOf("if (!force)") < extend.indexOf("await addExtraMinutes(db, sid, add)"), "uzatılmadan önce");
  assert.match(extend, /extensionWindow\(toSessionDTO\(row, \{ admin: false \}\), add\), "extend", row\.id\)/);
  // Yalnız sitedeki rezervasyonlar sorulur (sorgu sütun dışı ifadeye ISO metni verir, board.ts gibi)
  assert.match(actions, /eq\(s\.karaokeSessions\.source, "site"\)/);
  assert.match(actions, /make_interval\(mins => \$\{s\.karaokeSessions\.extraMinutes\}\)`, new Date\(window\.start\)\.toISOString\(\)\)/);
  // "use server": yardımcı dışa verilmez (her dışa verilen işlev herkese açık bir POST ucudur)
  assert.doesNotMatch(actions, /export async function siteConflict/);
  const board = read("src/app/panel/karaoke/karaoke-board.tsx");
  assert.match(board, /if \(res\.data\.conflict\) return void setAsk\(\{ title: res\.data\.conflict\.title, message: res\.data\.conflict\.message \}\)/);
  assert.match(board, /confirmLabel="Yine de başlat"/);
  assert.match(board, /confirmLabel="Yine de uzat"/);
  assert.match(read("src/components/panel/live/alert-center.tsx"), /confirmLabel="Yine de uzat"/);
});
