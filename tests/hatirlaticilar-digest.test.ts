import assert from "node:assert/strict";
import { test } from "node:test";

import type { UpcomingItem } from "../src/lib/reminders";
import { APP_URL, renderDigest } from "../src/server/notify/digest-template";

const NBSP = " ";

const item = (over: Partial<UpcomingItem>): UpcomingItem => ({
  ref: "reminder:1",
  source: "reminder",
  sourceId: 1,
  kind: "kira",
  title: "Kira",
  detail: null,
  amount: 25000,
  dueDate: "2026-10-20",
  daysLeft: 0,
  status: "today",
  remindDaysBefore: 3,
  repeat: "monthly",
  ...over,
});

const rows = [
  { item: item({ title: "Muhasebe <ödeme>", amount: 1000, dueDate: "2026-10-25", daysLeft: 5, status: "soon" }), stage: "before" as const },
  { item: item({ title: "Kira" }), stage: "due" as const },
  {
    item: item({ ref: "invoice:23", source: "invoice", sourceId: 23, kind: "fatura", title: "Kaldi", detail: "Fatura KLA1 · vade tahmini (30 gün)", amount: 12500.5, dueDate: "2026-10-13", daysLeft: -7, status: "overdue", repeat: "none" }),
    stage: "overdue" as const,
  },
];

test("e-posta: konu aşamaları sayar, gruplar gecikmiş → bugün → yaklaşan sırasında", () => {
  const { subject, html, text } = renderDigest(rows, "2026-10-20");
  assert.equal(subject, "Ödeme hatırlatması: 1 gecikmiş, 1 bugün, 1 yaklaşan");
  const order = ["Gecikenler · 1", "Son günü bugün · 1", "Yaklaşanlar · 1"].map((t) => html.indexOf(t));
  assert.ok(order.every((i) => i > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(html, /<h1[^>]*>3 ödeme sizi bekliyor<\/h1>/);
  assert.ok(html.includes("20 Ekim Salı"));
  assert.ok(text.startsWith("L'Affogato · 20.10.2026\nÖdeme hatırlatması"));
});

test("e-posta: kuruşlu tutar ve toplam iki ondalıkla (yuvarlanmaz)", () => {
  const { html, text } = renderDigest(rows, "2026-10-20");
  assert.ok(html.includes(`12.500,50${NBSP}₺`), "satır tutarı");
  // Toplam 1.000 + 25.000 + 12.500,50
  assert.ok(html.includes(`38.500,50${NBSP}₺`), "toplam");
  assert.ok(!html.includes(`12.501${NBSP}₺`));
  assert.ok(text.includes(`Toplam 38.500,50${NBSP}₺`));
  // Kuruşsuz toplam tam yazılır
  const whole = renderDigest([rows[1]], "2026-10-20");
  assert.ok(whole.html.includes(`25.000${NBSP}₺`));
  assert.ok(!whole.html.includes(`25.000,00`));
});

test("e-posta: başlık ve ayrıntı HTML'e kaçışlı yazılır, bağlantı panele gider", () => {
  const { html, text } = renderDigest(rows, "2026-10-20");
  assert.ok(html.includes("Muhasebe &lt;ödeme&gt;"));
  assert.ok(!html.includes("Muhasebe <ödeme>"));
  assert.ok(html.includes("Fatura KLA1 · vade tahmini (30 gün)"));
  assert.ok(html.includes("7 gün gecikti"));
  assert.ok(html.includes(`href="${APP_URL}/panel/hatirlaticilar"`));
  assert.ok(text.includes(`Panelde aç: ${APP_URL}/panel/hatirlaticilar`));
  // Düz metinde başlık olduğu gibi
  assert.ok(text.includes("- Muhasebe <ödeme> · 25.10.2026 (5 gün kaldı)"));
});

test("e-posta: tutarsız satır tire ile, tek ödemede tekil başlık", () => {
  const { subject, html } = renderDigest([{ item: item({ amount: null }), stage: "due" }], "2026-10-20");
  assert.equal(subject, "Ödeme hatırlatması: 1 bugün");
  assert.ok(html.includes("1 ödeme sizi bekliyor"));
  assert.ok(html.includes('<span style="color:#a1a1aa">–</span>'));
});
