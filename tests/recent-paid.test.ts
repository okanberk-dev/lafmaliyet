import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addRecentPaid,
  dropChangedReminder,
  liveRecentPaid,
  parseRecentPaid,
  pruneRecentPaid,
  RECENT_PAID_DAYS,
  RECENT_PAID_MAX,
  recentPaidKey,
  reminderUnchanged,
  removeRecentPaid,
  type RecentPaid,
} from "../src/lib/recent-paid";

const NOW = "2026-10-20T09:00:00.000Z";
const daysAgo = (n: number, from = NOW) => new Date(new Date(from).getTime() - n * 86_400_000).toISOString();

const inv = (id: number, at = NOW): RecentPaid => ({ kind: "invoice", id, title: `Fatura ${id}`, amount: 100 * id, dueDate: "2026-10-15", at });

// Aylık kira 01.10 ödendi → sıradaki 01.11
const rent: RecentPaid = {
  kind: "reminder",
  id: 4,
  title: "Kira",
  amount: 25000,
  dueDate: "2026-10-01",
  at: NOW,
  prev: { dueDate: "2026-10-01", anchorDate: "2026-01-01", active: true, lastDoneAt: null },
  next: "2026-11-01",
};
// Tek seferlik ödeme kapanır (next: null)
const oneOff: RecentPaid = {
  kind: "reminder",
  id: 7,
  title: "Muhasebe",
  amount: 3000,
  dueDate: "2026-10-18",
  at: NOW,
  prev: { dueDate: "2026-10-18", anchorDate: "2026-10-18", active: true, lastDoneAt: null },
  next: null,
};

test("30 günden eskiler atılır, sınırdaki kalır", () => {
  const list = [inv(1, daysAgo(1)), inv(2, daysAgo(RECENT_PAID_DAYS)), inv(3, daysAgo(RECENT_PAID_DAYS + 0.01))];
  assert.deepEqual(
    pruneRecentPaid(list, NOW).map((e) => e.id),
    [1, 2],
  );
});

test("en çok 30 kayıt; en yeniler kalır ve en yeni önce sıralanır", () => {
  // Sırası bozuk liste (eşzamanlı yazım): 40 kayıt, i. kayıt i saat önce
  const list = Array.from({ length: 40 }, (_, i) => inv(i + 1, daysAgo(i / 24))).reverse();
  const out = pruneRecentPaid(list, NOW);
  assert.equal(out.length, RECENT_PAID_MAX);
  assert.deepEqual(
    out.map((e) => e.id),
    Array.from({ length: RECENT_PAID_MAX }, (_, i) => i + 1),
  );
});

test("tarihi bozuk kayıt atılır", () => {
  assert.deepEqual(pruneRecentPaid([inv(1), { ...inv(2), at: "dün" }], NOW).map(recentPaidKey), ["invoice:1"]);
});

test("ekleme: yeni kayıt başa, aynı kalemin eski kaydı düşer", () => {
  const list = [inv(1, daysAgo(2)), { ...rent, at: daysAgo(3) }, inv(2, daysAgo(5))];
  const again = { ...inv(2), amount: 999 };
  const out = addRecentPaid(list, [again], NOW);
  assert.deepEqual(out.map(recentPaidKey), ["invoice:2", "invoice:1", "reminder:4"]);
  assert.equal(out[0].amount, 999);
  // Aynı kimlik farklı türde ayrı kalemdir
  assert.deepEqual(addRecentPaid([{ ...rent, id: 2 }], [inv(2)], NOW).map(recentPaidKey), ["invoice:2", "reminder:2"]);
});

test("ekleme: eklenenler içindeki tekrar tek kayıt olur, eski kayıtlar 30 gün kuralına uyar", () => {
  const out = addRecentPaid([inv(9, daysAgo(40))], [inv(1), inv(1), inv(3)], NOW);
  assert.deepEqual(out.map(recentPaidKey), ["invoice:1", "invoice:3"]);
});

test("ekleme: liste doluyken en eski düşer", () => {
  const full = Array.from({ length: RECENT_PAID_MAX }, (_, i) => inv(i + 1, daysAgo((i + 1) / 24)));
  const out = addRecentPaid(full, [inv(100)], NOW);
  assert.equal(out.length, RECENT_PAID_MAX);
  assert.equal(out[0].id, 100);
  assert.ok(!out.some((e) => e.id === RECENT_PAID_MAX));
});

test("silme yalnız verilen türdeki kimlikleri düşürür", () => {
  const list = [inv(1), inv(2), { ...rent, id: 1 }];
  assert.deepEqual(removeRecentPaid(list, "invoice", [1, 5]).map(recentPaidKey), ["invoice:2", "reminder:1"]);
  assert.deepEqual(removeRecentPaid(list, "reminder", []).map(recentPaidKey), list.map(recentPaidKey));
});

test("tekrar eden hatırlatıcı: sıradaki tarihte ve açıksa geri alınabilir", () => {
  const cur = { dueDate: "2026-11-01", anchorDate: "2026-01-01", active: true };
  assert.equal(reminderUnchanged(rent, cur), true);
  // Yeniden ödendi (Aralık'a geçti), ertelendi ya da tarihi düzenlendi
  assert.equal(reminderUnchanged(rent, { ...cur, dueDate: "2026-12-01" }), false);
  // Kapatıldı
  assert.equal(reminderUnchanged(rent, { ...cur, active: false }), false);
  // Tekrarların günü değişti (ör. "ayın son günü" açıldı)
  assert.equal(reminderUnchanged(rent, { ...cur, anchorDate: "2026-01-31" }), false);
  // Ödemenin geri alınmasından sonraki hâl (önceki tarihe döndü)
  assert.equal(reminderUnchanged(rent, { ...cur, dueDate: "2026-10-01" }), false);
  // Önceki hâl yoksa geri alınamaz
  assert.equal(reminderUnchanged({ ...rent, prev: undefined }, cur), false);
});

test("tek seferlik hatırlatıcı: kapalı ve aynı tarihteyse geri alınabilir", () => {
  const cur = { dueDate: "2026-10-18", anchorDate: "2026-10-18", active: false };
  assert.equal(reminderUnchanged(oneOff, cur), true);
  // Yeniden açıldı
  assert.equal(reminderUnchanged(oneOff, { ...cur, active: true }), false);
  // Tarihi düzenlendi
  assert.equal(reminderUnchanged(oneOff, { ...cur, dueDate: "2026-10-25", anchorDate: "2026-10-25" }), false);
});

test("bildirimdeki Geri al: ödeme geri alınınca kayıt düşer, erteleme geri alınınca kalır", () => {
  const list = [rent, inv(4)];
  // Ödendi geri alındı: hatırlatıcı ödenmeden önceki hâline (01.10) döndü
  assert.deepEqual(dropChangedReminder(list, { id: 4, ...rent.prev!, active: true }).map(recentPaidKey), ["invoice:4"]);
  // Ödemeden sonra yapılan erteleme geri alındı: hatırlatıcı yine 01.11'de, ödeme kaydı geri alınabilir kalır
  assert.deepEqual(dropChangedReminder(list, { id: 4, dueDate: "2026-11-01", anchorDate: "2026-01-01", active: true }).map(recentPaidKey), ["reminder:4", "invoice:4"]);
  // Tek seferlik ödeme geri alındı (yeniden açık)
  assert.deepEqual(dropChangedReminder([oneOff], { id: 7, dueDate: "2026-10-18", anchorDate: "2026-10-18", active: true }), []);
});

test("ekranda yalnız geri alınabilenler gösterilir", () => {
  const list = [rent, oneOff, { ...rent, id: 99 }, inv(1), inv(2)];
  const reminders = [
    { id: 4, dueDate: "2026-11-01", anchorDate: "2026-01-01", active: true },
    // Tek seferlik ödendikten sonra yeniden açılmış
    { id: 7, dueDate: "2026-10-18", anchorDate: "2026-10-18", active: true },
  ];
  // 99 silinmiş; fatura 2 yeniden ödenmedi işaretlenmiş
  assert.deepEqual(liveRecentPaid(list, reminders, [2, 50]).map(recentPaidKey), ["reminder:4", "invoice:1"]);
});

test("integration_state değeri: biçimi bozuk satırlar atılır", () => {
  assert.deepEqual(parseRecentPaid(null), []);
  assert.deepEqual(parseRecentPaid({ kind: "invoice" }), []);
  const ok = inv(1);
  assert.deepEqual(parseRecentPaid([ok, null, "x", { ...ok, kind: "gider" }, { ...ok, id: "1" }, { ...ok, at: undefined }, rent]), [ok, rent]);
});
