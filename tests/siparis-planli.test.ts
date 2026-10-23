// Bar ekranında planlı sipariş (gel-al "Yarın 09:00"): kartın bekleme satırı ödemeden değil vaktinden sayılır (vakti
// gelmeden sakin "kaldı", geçince "gecikti"); vaktine 15 dakika kala bir kez hazırlanma zili (ekran sonradan açılsa da),
// az önce gelen siparişte iki kez çalmaz, çok gecikmişte çalmaz.
// Çalıştırma: npx tsx --test tests/siparis-planli.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { DUE_SOON_MS, dueRingMessage, dueSoonToRing, waitInfo } from "../src/lib/site-orders/feed";
import type { SiteOrder } from "../src/lib/site-orders/schema";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
/** Türkiye saatiyle an */
const tr = (local: string) => Date.parse(`${local}:00+03:00`);

const order = (over: Partial<SiteOrder> = {}): SiteOrder => ({
  id: "ord-0001",
  orderNo: 10001,
  stage: "new",
  fulfillment: "pickup",
  label: "Gel-al",
  firstName: "Can",
  scheduledFor: "",
  paidAt: new Date(tr("2026-10-22T22:10")).toISOString(),
  lines: [
    { menuItemId: "mnu-0003", name: "Latte", size: "M", detail: "M", qty: 2 },
    { menuItemId: "mnu-0009", name: "Su", size: "single", detail: "", qty: 1 },
  ],
  path: "/admin/siparisler/ord-0001",
  ...over,
});

const tomorrow9 = new Date(tr("2026-10-23T09:00")).toISOString();

test("bekleme satırı: planlı sipariş vaktine göre (önce sakin 'kaldı', sonra 'gecikti'); planlı değilse ödemeden", () => {
  const pre = order({ scheduledFor: tomorrow9 });
  // Akşam ödenen yarın sabahki sipariş, bar 08:00'de açılınca gecikmiş görünmez
  assert.deepEqual(waitInfo(pre, tr("2026-10-23T08:00")), { text: "1 sa kaldı", late: false });
  assert.deepEqual(waitInfo(pre, tr("2026-10-23T08:15")), { text: "45 dk kaldı", late: false });
  assert.deepEqual(waitInfo(pre, tr("2026-10-22T22:10")), { text: "10 sa 50 dk kaldı", late: false });
  assert.deepEqual(waitInfo(pre, tr("2026-10-23T09:00")), { text: "Vakti geldi", late: false });
  assert.deepEqual(waitInfo(pre, tr("2026-10-23T09:07")), { text: "7 dk gecikti", late: true });
  assert.deepEqual(waitInfo({ ...pre, stage: "preparing" }, tr("2026-10-23T09:07")), { text: "7 dk gecikti", late: false }, "hazırlanıyorsa vurgusuz");
  // Planlı değil: eskisi gibi ödemeden bu yana, yeni sipariş 10 dakikayı geçince vurgulu
  const now = order({ paidAt: new Date(tr("2026-10-23T10:00")).toISOString() });
  assert.deepEqual(waitInfo(now, tr("2026-10-23T10:00")), { text: "Ödendi · az önce", late: false });
  assert.deepEqual(waitInfo(now, tr("2026-10-23T10:09")), { text: "Ödendi · 9 dk önce", late: false });
  assert.deepEqual(waitInfo(now, tr("2026-10-23T10:12")), { text: "Ödendi · 12 dk önce", late: true });
  assert.deepEqual(waitInfo({ ...now, stage: "ready" }, tr("2026-10-23T10:30")), { text: "Ödendi · 30 dk önce", late: false });
});

test("hazırlanma zili: vaktine 15 dakika kala bir kez; ondan önce zamanlayıcının anı; çalan ve sessiz geçilen işaretlenir", () => {
  const pre = order({ scheduledFor: tomorrow9 });
  const before = dueSoonToRing([pre], new Set(), tr("2026-10-23T08:00"));
  assert.deepEqual(before, { ring: [], markRung: [], nextAt: tr("2026-10-23T08:45") });
  assert.equal(DUE_SOON_MS, 15 * 60_000);
  const at = dueSoonToRing([pre], new Set(), tr("2026-10-23T08:45"));
  assert.deepEqual([at.ring.map((o) => o.id), at.markRung, at.nextAt], [["ord-0001"], ["ord-0001"], null]);
  // Bu cihazda çaldıysa yeniden çalmaz
  assert.deepEqual(dueSoonToRing([pre], new Set(["ord-0001"]), tr("2026-10-23T08:50")), { ring: [], markRung: [], nextAt: null });
  // Ekran sonradan açılırsa (bar 08:50'de açıldı) yine çalar; vakti 15 dakikadan çok geçmişse sessizce işaretlenir
  assert.equal(dueSoonToRing([pre], new Set(), tr("2026-10-23T09:10")).ring.length, 1);
  const late = dueSoonToRing([pre], new Set(), tr("2026-10-23T09:30"));
  assert.deepEqual([late.ring.length, late.markRung], [0, ["ord-0001"]]);
});

test("hazırlanma zili: yalnız yeni ve planlı sipariş; az önce gelen siparişte geliş zili yeter (iki kez çalmaz)", () => {
  const now = tr("2026-10-23T08:50");
  assert.deepEqual(dueSoonToRing([order({ scheduledFor: tomorrow9, stage: "preparing" })], new Set(), now).markRung, []);
  assert.deepEqual(dueSoonToRing([order()], new Set(), now), { ring: [], markRung: [], nextAt: null }, "planlı değil");
  const justPaid = order({ scheduledFor: tomorrow9, paidAt: new Date(tr("2026-10-23T08:49")).toISOString() });
  const r = dueSoonToRing([justPaid], new Set(), now);
  assert.deepEqual([r.ring.length, r.markRung], [0, ["ord-0001"]]);
  // Sıra ekranın sırası; sıradaki zil en yakın planlının
  const a = order({ id: "a", orderNo: 2, scheduledFor: new Date(tr("2026-10-23T09:00")).toISOString() });
  const b = order({ id: "b", orderNo: 1, fulfillment: "table", label: "Masa 4", scheduledFor: new Date(tr("2026-10-23T09:05")).toISOString() });
  const c = order({ id: "c", orderNo: 3, scheduledFor: new Date(tr("2026-10-23T11:00")).toISOString() });
  const both = dueSoonToRing([a, b, c], new Set(), tr("2026-10-23T08:52"));
  assert.deepEqual([both.ring.map((o) => o.id), both.nextAt], [["b", "a"], tr("2026-10-23T10:45")]);
});

test("zil metni: tek siparişte nereye, saat ve satırlar; birden çokta sayı ve yerler (müşterinin adı geçmez)", () => {
  const now = tr("2026-10-23T08:45");
  assert.deepEqual(dueRingMessage([order({ scheduledFor: tomorrow9 })], now), { title: "Planlı sipariş · Gel-al", body: "09:00 için · 2× Latte, 1× Su" });
  assert.deepEqual(dueRingMessage([order({ scheduledFor: tomorrow9 }), order({ id: "x", label: "Masa 4", scheduledFor: tomorrow9 })], now), {
    title: "2 planlı siparişin vakti yaklaştı",
    body: "Gel-al (09:00 için) · Masa 4 (09:00 için)",
  });
  assert.deepEqual(dueRingMessage([], now), { title: "", body: "" });
  assert.doesNotMatch(JSON.stringify(dueRingMessage([order({ scheduledFor: tomorrow9 })], now)), /Can/);
});

test("ekran: kart bekleme satırını kuraldan alır; uyarı motoru planlıya zamanlayıcı kurar ve cihaz başına bir kez çalar", () => {
  const board = read("src/app/panel/karaoke/orders-board.tsx");
  assert.match(board, /const wait = waitInfo\(o, now\);/);
  assert.match(board, /wait\.late \? "font-semibold text-warn" : "text-ink-mute"/);
  const alerts = read("src/components/panel/live/alert-center.tsx");
  assert.match(alerts, /const DUE_RUNG_KEY = "laf:planli-siparis-zili";/);
  assert.match(alerts, /dueSoonToRing\(data\.orders\.list, dueRung\.current, liveNow\(\)\)/);
  assert.match(alerts, /if \(ring\.length && prefs\.orderAlerts\) \{/);
  assert.match(alerts, /setTimeout\(\(\) => setDueTick\(\(n\) => n \+ 1\)/);
});
