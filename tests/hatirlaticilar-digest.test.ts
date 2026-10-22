import assert from "node:assert/strict";
import { test } from "node:test";

import { SYSTEM_ALERT_HELP } from "../src/lib/job-health";
import type { UpcomingItem } from "../src/lib/reminders";
import { APP_URL, renderDigest, renderSystemAlert, type DigestInvoices, type DigestPrices } from "../src/server/notify/digest-template";

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

// ---------------------------------------------------------------- Sistem uyarıları (günlük işler)

const system = {
  items: [
    { title: "Dünkü sabah işi çalışmadı (21 Ekim)", body: "08:00–09:00 arasında çalışması gerekiyordu: sabah e-postası gitmedi." },
    { title: "Paraşüt işi bu sabah çalışmadı", body: "Eşitlemeyi sabah işi yaptı <tamam>." },
  ],
};
const invoices: DigestInvoices = {
  items: [
    { supplier: "Kaldi", date: "2026-10-21", payable: 1200, category: "Kahve", needsReview: false },
    { supplier: "Metro", date: "2026-10-21", payable: 800, category: "Market", needsReview: true },
  ],
  reviewCount: 1,
  syncError: null,
};
const prices: DigestPrices = { changes: [{ name: "Süt", unit: "ml", before: 0.04, after: 0.05, pct: 0.25 }], products: [], productCount: 0 };

test("e-posta: sistem uyarıları gövdenin en üstünde; ödeme varsa konuya ' · sistem uyarısı' eklenir", () => {
  const { subject, html, text } = renderDigest(rows, "2026-10-22", null, null, system);
  assert.equal(subject, "Ödeme hatırlatması: 1 gecikmiş, 1 bugün, 1 yaklaşan · sistem uyarısı");
  const sys = html.indexOf("Sistem uyarıları · 2");
  assert.ok(sys > 0 && sys < html.indexOf("Gecikenler · 1"), "sistem bölümü ödemelerden önce");
  assert.ok(html.includes("Eşitlemeyi sabah işi yaptı &lt;tamam&gt;."));
  assert.ok(html.includes(`href="${APP_URL}/panel/ayarlar#isler"`));
  assert.match(html, /<h1[^>]*>3 ödeme sizi bekliyor<\/h1>/);
  assert.ok(text.includes("Sistem uyarıları (2)\n- Dünkü sabah işi çalışmadı (21 Ekim): 08:00–09:00"));
  assert.ok(text.indexOf("Sistem uyarıları") < text.indexOf("Gecikenler"));
});

test("e-posta konusu: ödeme yoksa sistem uyarısı öne geçer, ötekiler eklenir", () => {
  const only = renderDigest([], "2026-10-22", null, null, system);
  assert.equal(only.subject, "Sistem uyarısı: Dünkü sabah işi çalışmadı (21 Ekim)");
  assert.match(only.html, /<h1[^>]*>Dünkü sabah işi çalışmadı \(21 Ekim\)<\/h1>/);
  assert.ok(only.html.includes(">Günlük işleri aç</a>"));
  assert.ok(only.text.endsWith(`Günlük işleri aç: ${APP_URL}/panel/ayarlar#isler`));
  const withNews = renderDigest([], "2026-10-22", invoices, prices, system);
  assert.equal(withNews.subject, "Sistem uyarısı: Dünkü sabah işi çalışmadı (21 Ekim) · 2 yeni fatura · 1 hammaddeye zam");
  assert.ok(withNews.html.includes(">Faturaları aç</a>"));
  // Eşitleme hatası (yeni fatura yok) sistem uyarısının arkasında kalır
  const syncFail = renderDigest([], "2026-10-22", { items: [], reviewCount: 0, syncError: "401" }, null, system);
  assert.equal(syncFail.subject, "Sistem uyarısı: Dünkü sabah işi çalışmadı (21 Ekim)");
  assert.ok(syncFail.html.includes("Paraşüt eşitlemesi başarısız."));
});

test("e-posta konusu: sistem uyarısı yoksa öncelik eskisi gibi", () => {
  for (const none of [undefined, null, { items: [] }]) {
    assert.equal(renderDigest([], "2026-10-22", invoices, prices, none).subject, "Sabah özeti: 2 yeni fatura · 1 hammaddeye zam");
    assert.equal(renderDigest([], "2026-10-22", { items: [], reviewCount: 0, syncError: "401" }, prices, none).subject, "Paraşüt eşitlemesi başarısız · 1 hammaddeye zam");
    assert.equal(renderDigest([], "2026-10-22", null, prices, none).subject, "Sabah özeti: 1 hammaddeye zam");
    assert.ok(!renderDigest(rows, "2026-10-22", null, null, none).html.includes("Sistem uyarıları"));
  }
});

test("bekçi e-postası: konu ilk sorun, ne yapılacağı ve panel bağlantısı", () => {
  const one = renderSystemAlert(system.items.slice(0, 1), "2026-10-22");
  assert.equal(one.subject, "L'Affogato · Dünkü sabah işi çalışmadı (21 Ekim)");
  assert.match(one.html, /<h1[^>]*>Dünkü sabah işi çalışmadı \(21 Ekim\)<\/h1>/);
  assert.ok(one.html.includes("22 Ekim Perşembe"));
  assert.ok(one.html.includes(`href="${APP_URL}/panel/ayarlar#isler"`));
  assert.ok(one.text.includes(SYSTEM_ALERT_HELP));
  assert.ok(one.text.startsWith("L'Affogato · 22.10.2026\nL'Affogato · Dünkü sabah işi"));
  const two = renderSystemAlert(system.items, "2026-10-22");
  assert.equal(two.subject, "L'Affogato · Dünkü sabah işi çalışmadı (21 Ekim) (+1)");
  assert.match(two.html, /<h1[^>]*>2 sistem uyarısı<\/h1>/);
  assert.ok(two.html.includes("Eşitlemeyi sabah işi yaptı &lt;tamam&gt;."));
  assert.ok(!two.html.includes("<tamam>"));
});
