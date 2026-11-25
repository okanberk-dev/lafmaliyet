// Zilin Ödemeler grubu ve alt menünün rozeti (denetim bulgu 96): zil en çok 8 ödeme gösteriyordu ve kalanını
// söylemiyordu; rozet zilin listesinden saydığı için 8'de takılıyor, "9+" hiç çıkmıyordu. Artık sığmayanlar tek bir
// "N ödeme daha" satırında, içindeki gecikmiş sayısıyla; rozet gerçek gecikmiş sayısını gösterir.
import assert from "node:assert/strict";
import { test } from "node:test";

import { badgeText, overdueCount } from "../src/components/panel/nav";
import { BELL_PAYMENT_LIMIT, paymentBellRows } from "../src/lib/bell-payments";
import type { UpcomingStatus } from "../src/lib/reminders";

const item = (n: number, status: UpcomingStatus, daysLeft = status === "overdue" ? -n : status === "today" ? 0 : 3) => ({
  ref: `reminder:${n}`,
  title: `Ödeme ${n}`,
  amount: 1000 * n,
  dueDate: `2026-11-${String(10 + n).padStart(2, "0")}`,
  detail: null,
  daysLeft,
  status,
});

test("sığan liste olduğu gibi; 'sonra' olanlar zile girmez", () => {
  const rows = paymentBellRows([item(1, "overdue"), item(2, "today"), item(3, "soon"), item(4, "later")]);
  assert.deepEqual(
    rows.map((r) => [r.id, r.kind, r.unread]),
    [
      ["odeme-reminder:1-2026-11-11", "danger", true],
      ["odeme-reminder:2-2026-11-12", "warning", true],
      ["odeme-reminder:3-2026-11-13", "info", false],
    ],
  );
  assert.equal(overdueCount(rows), 1);
  assert.equal(BELL_PAYMENT_LIMIT, 8);
  // Tam 8 satır sığar, özet yok
  assert.equal(paymentBellRows(Array.from({ length: 8 }, (_, i) => item(i + 1, "overdue"))).length, 8);
});

test("12 gecikmiş ödeme: 7 satır + '5 ödeme daha' özeti; rozet 12 → '9+'", () => {
  const items = Array.from({ length: 12 }, (_, i) => item(i + 1, "overdue"));
  const rows = paymentBellRows(items);
  assert.equal(rows.length, 8);
  const sum = rows.at(-1)!;
  assert.equal(sum.title, "5 ödeme daha");
  assert.equal(sum.kind, "danger");
  assert.equal(sum.overdue, 5);
  assert.equal(sum.unread, true);
  assert.equal(sum.href, "/panel/hatirlaticilar");
  assert.equal(sum.body, "5 gecikmiş: Ödeme 8, Ödeme 9, Ödeme 10 ve 2 ödeme daha. Hepsi Ödemeler'de.");
  // Okununca içindekiler de okunmuş sayılır; kimlik gizlenenlerin en geç vadelisinden
  assert.deepEqual(sum.covers, items.slice(7).map((i) => `odeme-${i.ref}-${i.dueDate}`));
  assert.equal(sum.id, "odeme-diger-reminder:12-2026-11-22");
  assert.equal(overdueCount(rows), 12);
  assert.equal(badgeText(overdueCount(rows)), "9+");
});

test("özetin içinde gecikmiş yoksa rozete bir şey eklemez; sayılar türüne göre", () => {
  const items = [
    ...Array.from({ length: 7 }, (_, i) => item(i + 1, "overdue")),
    item(8, "today"),
    item(9, "soon"),
    item(10, "soon"),
  ];
  const rows = paymentBellRows(items);
  const sum = rows.at(-1)!;
  assert.equal(sum.title, "3 ödeme daha");
  assert.equal(sum.kind, "warning");
  assert.equal(sum.overdue, undefined);
  assert.equal(sum.body, "1 bugün, 2 yakında: Ödeme 8, Ödeme 9, Ödeme 10. Hepsi Ödemeler'de.");
  assert.equal(overdueCount(rows), 7);
});

test("rozet: özet satırının taşıdığı gecikmiş sayısı, başka gruptaki 'danger' sayılmaz", () => {
  assert.equal(
    overdueCount([
      { group: "odeme", kind: "danger" },
      { group: "odeme", kind: "danger", overdue: 4 },
      { group: "uyari", kind: "danger", overdue: 9 },
      { group: "odeme", kind: "warning" },
    ]),
    5,
  );
});

test("kaynak: şube değişince zil (ve alt menünün rozeti) yeniden okunur; eski okumanın yanıtı yenisini ezmez (bulgu 89)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/components/panel/sidebar.tsx", "utf8");
  assert.match(src, /const branchScope = branch\?\.scope;/);
  assert.match(src, /if \(prevScope\.current === branchScope\) return;\s+prevScope\.current = branchScope;\s+refreshAlerts\(\);\s+\}, \[branchScope, refreshAlerts\]\);/);
  assert.match(src, /const seq = \+\+alertsSeq\.current;/);
  assert.match(src, /if \(seq !== alertsSeq\.current\) return;\s+setAlerts\(n\);/);
});
