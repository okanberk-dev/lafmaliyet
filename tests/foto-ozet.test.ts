// Gün sonu fotoğrafında okunanın dökümü ve fotoğraf e-postası (sahibin isteği, 25 Kasım 2026: "gün sonu alınca admine z
// raporu yükleyince mail gelmedi, rapor ve z raporları okunmuyor"): okunan rakamlar e-postada satır satır, fotoğraf ek
// olarak; uyumlu fotoğraf da bildirilir.
import assert from "node:assert/strict";
import { test } from "node:test";

import { lafposPhotoCheck, type LafposPhotoCheck } from "../src/lib/lafpos/foto";
import { deviceCompareReport, renderPhotoMail } from "../src/lib/lafpos/gun-sonu";
import { okcDocumentLabel, okcReadRows } from "../src/lib/photo-read/summary";
import type { AmountRaw, KasaOkc } from "../src/lib/photo-read/schemas";
import { emailPayload } from "../src/server/notify/resend-http";

const DAY = "2026-11-24";
const amt = (v: number | null, confidence: AmountRaw["confidence"] = "high"): AmountRaw => ({ text: v === null ? null : v.toLocaleString("tr-TR", { minimumFractionDigits: 2 }), value: v, confidence });
const NONE = { text: null, value: null, confidence: "low" as const };
const plain = (t: string) => t.replace(/ /g, " ");

const z = (o: Partial<KasaOkc> = {}): KasaOkc => ({
  documentType: "z_report",
  fiscalMarks: { mfLogo: true, ekuNo: true, cumulativeLines: true, vatBlock: true },
  readable: true,
  title: "Z RAPORU",
  date: DAY,
  time: "23:10",
  dateConfidence: "high",
  zNo: { text: "0128", value: 128, confidence: "high" },
  receiptCount: { text: "63", value: 63, confidence: "high" },
  dailyTotal: amt(1_190),
  dailyTotalLabel: "TOPLAM",
  kdvGroups: [{ rate: 10, total: amt(1_190), vat: amt(108.18), base: null }],
  totalVat: amt(108.18),
  payments: [
    { label: "NAKİT", count: null, amount: amt(390), kind: "cash" },
    { label: "KREDİ KARTI", count: null, amount: amt(800), kind: "card" },
  ],
  outside: [],
  voids: amt(null),
  discounts: amt(null),
  cumulativeTotal: amt(5_000_000),
  cumulativeVat: amt(450_000),
  batches: [{ bank: "Garanti BBVA", batchNo: "000279", date: DAY, salesTotal: amt(800), refundTotal: amt(null), netTotal: amt(800), transactionCount: null }],
  issues: [],
  ...o,
});

test("Okunanın dökümü: belge, tarih, Z no, fiş sayısı, toplam, ödemeler, KDV, batch; kümülatif yazılmaz", () => {
  const rows = okcReadRows(z());
  const t = plain(rows.map(([a, b]) => `${a}: ${b}`).join("\n"));
  assert.match(t, /^Belge: Z raporu ve banka gün sonu \(tek fişte\)/);
  assert.match(t, /Tarih: 24\.11\.2026 23:10/);
  assert.match(t, /Z no: 0128/);
  assert.match(t, /Fiş sayısı: 63/);
  assert.match(t, /Günün toplamı: 1\.190 ₺/);
  assert.match(t, /Nakit: 390 ₺/);
  assert.match(t, /Kart: 800 ₺/);
  assert.match(t, /KDV %10: toplam 1\.190 ₺ · KDV 108,18 ₺/);
  assert.match(t, /Toplam KDV: 108,18 ₺/);
  assert.match(t, /Batch 000279 · Garanti BBVA: 800 ₺/);
  assert.doesNotMatch(t, /5\.000\.000/, "kümülatif günün rakamı değildir");
});

test("Okunmayan rakam yazılmaz, güveni düşük rakam '(belirsiz)'; okunamayan belge söylenir", () => {
  const rows = okcReadRows(z({ dailyTotal: amt(1_190, "low"), zNo: NONE, receiptCount: NONE, payments: [{ label: "NAKİT", count: null, amount: NONE, kind: "cash" }] }));
  const t = plain(rows.map(([a, b]) => `${a}: ${b}`).join("\n"));
  assert.match(t, /Günün toplamı: 1\.190 ₺ \(belirsiz\)/);
  assert.doesNotMatch(t, /Z no|Fiş sayısı|Nakit/);
  const bad = okcReadRows(z({ readable: false, documentType: "other", batches: [] }));
  assert.deepEqual(bad.slice(0, 2), [
    ["Belge", "Tanınmayan belge"],
    ["Durum", "rakamlar seçilmedi (bulanık, kesik ya da soluk)"],
  ]);
});

test("LafPOS'un kendi kâğıdı: Z'si mali değildir, yalnız banka kısmı yazılır", () => {
  const paper = z({ title: "GÜN SONU · Z 31", dailyTotalLabel: "NET CİRO", fiscalMarks: { mfLogo: false, ekuNo: false, cumulativeLines: false, vatBlock: false } });
  assert.match(okcDocumentLabel(paper), /LafPOS'un gün sonu kâğıdı/);
  const t = plain(
    okcReadRows(paper)
      .map(([a, b]) => `${a}: ${b}`)
      .join("\n"),
  );
  assert.doesNotMatch(t, /Z no|Günün toplamı/);
  assert.match(t, /Batch 000279/);
});

test("Fotoğraf e-postası: uyumlu fotoğraf da gider; okunan bölümü, ekleyen ve ek satırı", () => {
  const report = deviceCompareReport({ bankPos: null, okc: { provider: "pavo", zReport: false, docs: 4, cash: 390, card: 800, mealCard: 0, other: 0, total: 1_190, vat: [{ rate: 10, total: 1_190, vat: 108.18 }] } as never, lafposZNo: null });
  const check: LafposPhotoCheck = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: z({ batches: [] }), error: null, source: "ai", model: "claude-haiku-5-5" }], bankPos: null, okc: null, report });
  const mail = renderPhotoMail({ branchName: "Marina", date: DAY, check, link: "https://x/panel/kasa", reads: [okcReadRows(z())], by: "Ayşe", attachments: 1 });
  const t = plain(mail.text);
  assert.match(t, /Ekleyen: Ayşe/);
  assert.match(t, /Fotoğraf ek olarak bu e-postada\./);
  assert.match(t, /Fotoğrafta okunan\nBelge: Z raporu/);
  assert.match(t, /Okuyan: Yapay zekâ \(Claude Haiku 5\.5\)/);
  assert.match(plain(mail.html), /Fotoğrafta okunan/);
  // İki fotoğrafta bölümler numaralı
  const two = plain(renderPhotoMail({ branchName: "Marina", date: DAY, check, link: "x", reads: [okcReadRows(z()), okcReadRows(z())] }).text);
  assert.match(two, /Fotoğrafta okunan \(1\. fotoğraf\)/);
  assert.match(two, /Fotoğrafta okunan \(2\. fotoğraf\)/);
});

test("E-posta eki Resend'e base64 gider; eksiz iletide alan yok", () => {
  const base = { from: "a@b.c", to: ["x@y.z"], subject: "s", html: "<p>h</p>", text: "t" };
  assert.equal("attachments" in emailPayload(base), false);
  const p = emailPayload({ ...base, attachments: [{ filename: "gun-sonu-2026-11-24.jpg", content: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" }] });
  assert.deepEqual(p.attachments, [{ filename: "gun-sonu-2026-11-24.jpg", content: "AQID", content_type: "image/jpeg" }]);
});
