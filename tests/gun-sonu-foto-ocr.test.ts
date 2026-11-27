// Kodla okuma gerçek OCR'la (docs/FOTOGRAF.md › Kodla okuma): yapay zekâ yokken (anahtar, kredi, sınır, hata) gün sonu
// fotoğrafı tesseract.js ile, paketle gelen Türkçe dil verisiyle (@tesseract.js-data/tur, ağ yok) okunur, Pavo fişinin
// kural tabanlı ayrıştırıcısı rakamları çıkarır. Görsel testte çizilir (tests/helpers/fis-gorsel.ts): Pavo'nun detaylı
// Z'si gibi satırlar. Ağ isteği yapılırsa test düşer.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { asilposPhotoCheck } from "../src/lib/asilpos/foto";
import type { BankPos, PosOkc } from "../src/lib/asilpos/day";
import { ESKI_KAGIT_ADI, TEL_KART_ALANI } from "../src/lib/asilpos/eski-adlar";
import { parsePavoOcr } from "../src/lib/photo-read/pavo-ocr";
import { OCR_LANG_DIR, ocrImage } from "../src/server/photo-read/ocr";

import { slipPng } from "./helpers/fis-gorsel";

const DAY = "2026-11-22";
const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    throw new Error(`Kodla okuma ağa çıkmamalı: ${String(input instanceof Request ? input.url : input)}`);
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
});

/** Kabul gününün (22.11) Pavo detaylı Z'si: yazarkasa 5.215 (nakit 1.055, kart 4.160), KDV %10 474,09; batch 0001 = 4.160 */
const SLIP = [
  "PAVO",
  "L'AFFOGATO MARİNA",
  "TARİH: 22.11.2026|SAAT: 23:58",
  "Z RAPORU",
  "Z NO: 0011",
  "FİŞ SAYISI|19",
  "NAKİT|*1.055,00",
  "KREDİ KARTI|*4.160,00",
  "YEMEK KARTI|*0,00",
  "TOPLAM|*5.215,00",
  "%10 TOPLAM|*5.215,00",
  "%10 KDV|*474,09",
  "TOPKDV|*474,09",
  "KÜM. TOPLAM|*1.259.350,00",
  "BANKA GÜN SONU",
  "GARANTİ BBVA",
  "BATCH NO: 0001",
  "SATIŞ TOPLAMI|4.160,00",
  "İADE TOPLAMI|0,00",
  "NET TOPLAM|4.160,00",
];

test("Dil verisi pakette (ağsız): Türkçe LSTM verisi node_modules'ta", () => {
  assert.ok(existsSync(join(OCR_LANG_DIR, "tur.traineddata.gz")), OCR_LANG_DIR);
});

const BANK: BankPos = {
  status: "ok",
  batchNo: "0001",
  at: "2026-11-22T21:26:00.000Z",
  pavoCard: 4_160,
  [TEL_KART_ALANI]: 4_160,
  diff: 0,
  acquirers: [],
  message: null,
  errorCode: null,
  batches: [{ batchNo: "0001", at: "2026-11-22T21:26:00.000Z", total: 4_160, trigger: "otomatik", dayClosed: true }],
  dayCard: 4_160,
};
const OKC: PosOkc = { provider: "pavo", zReport: false, docs: 19, cash: 1_055, card: 4_160, mealCard: 0, other: 0, total: 5_215, voided: { count: 0, cash: 0, card: 0 }, vat: [{ rate: 10, total: 5_215, vat: 474.09 }] };
const REPORT = { bankPos: 4_160, okcZNo: "11", okcTotal: 5_215, okcCash: 1_055, okcCard: 4_160, okcMealCard: 0, okcOther: 0, okcVat: OKC.vat, asilposZNo: "11" };
/** Telefonda küçültülen fotoğrafta (uzun kenar 2576 px) termal fişin satırı ~36 px */
const image = () => slipPng(SLIP, { size: 36, width: 980 });

test("Sentetik Pavo fişi kodla okunur: Z no, tarih, toplam, nakit, kart, batch; AsilPOS'u tutuyor (uyumlu)", { timeout: 60_000 }, async () => {
  const lines = await ocrImage(image(), { timeoutMs: 45_000 });
  const { raw } = parsePavoOcr(lines);
  const seen = lines.map((l) => l.text).join("\n");
  assert.equal(raw.documentType, "z_report", seen);
  assert.deepEqual([raw.zNo.text, raw.zNo.confidence], ["0011", "high"], seen);
  assert.deepEqual([raw.date, raw.time], [DAY, "23:58"]);
  assert.deepEqual([raw.dailyTotal.value, raw.dailyTotal.confidence], [5_215, "high"]);
  const pay = Object.fromEntries(raw.payments.map((p) => [p.kind, p.amount.value]));
  assert.deepEqual([pay.cash, pay.card], [1_055, 4_160]);
  assert.equal(raw.cumulativeTotal.value, null, "KÜM. satırı alınmaz");
  assert.deepEqual(
    raw.batches.map((b) => [b.batchNo, b.netTotal.value]),
    [["0001", 4_160]],
  );
  // KDV dökümü karşılaştırılmayan raporda (yazarkasa KDV'si boş) bütün satırlar yüksek güvenle okundu: uyumlu
  const c = asilposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw, error: null, source: "kod" }], bankPos: BANK, okc: OKC, report: { ...REPORT, okcVat: null } });
  assert.equal(c.state, "uyumlu", JSON.stringify(c.rows));
  assert.equal(c.source, "kod");
});

test("Gerçek OCR'ın şüphelendiği satır (ör. '%10' işareti) 'fark' üretmez: okunamadı — yönetici baksın", { timeout: 60_000 }, async () => {
  const { raw } = parsePavoOcr(await ocrImage(image(), { timeoutMs: 45_000 }));
  const c = asilposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw, error: null, source: "kod" }], bankPos: BANK, okc: OKC, report: REPORT });
  assert.notEqual(c.state, "fark", JSON.stringify(c.rows));
  // OCR % işaretini güvenle okuduysa uyumlu; okuyamadıysa yalnız KDV satırı okunmamış ve sonuç "yönetici baksın"
  if (c.state !== "uyumlu") {
    assert.equal(c.state, "belirsiz");
    assert.deepEqual(
      c.rows.filter((r) => !r.ok).map((r) => [r.label, r.unread]),
      [["Yazarkasa KDV", true]],
    );
  }
});

/** AsilPOS'un kör kasada bastığı kâğıt (24 Kasım, Marina): yalnız "BANKA GÜN SONU · PAVO"; Garanti 3.000 + Akbank 1.160 */
const ASILPOS_KOR = [
  "L'AFFOGATO",
  "BANKA GÜN SONU · PAVO",
  "Batch|0001",
  "Cihaz saati|22.11.2026 23:58",
  "Bankalar",
  "Garanti BBVA (3)|3.000,00",
  "Akbank (2)|1.160,00",
  "TOPLAM|4.160,00 TL",
  `PAVO - ${ESKI_KAGIT_ADI} KARŞILAŞTIRMA`,
  "Pavo kart toplamı|4.160,00",
  "AsilPOS kart toplamı|4.160,00",
  "FARK|0,00",
  "Pavo cihazının banka gün sonu özetidir",
];

test("Sentetik AsilPOS kör kâğıdı kodla okunur: banka gün sonu fişi, iki banka satırı; Z yok, karşılaştırma satırları batch değil", { timeout: 60_000 }, async () => {
  const lines = await ocrImage(slipPng(ASILPOS_KOR, { size: 36, width: 980 }), { timeoutMs: 45_000 });
  const { raw } = parsePavoOcr(lines);
  const seen = lines.map((l) => l.text).join("\n");
  assert.equal(raw.documentType, "batch_slip", seen);
  assert.deepEqual([raw.zNo.text, raw.dailyTotal.value, raw.payments.length], [null, null, 0], seen);
  assert.deepEqual(
    raw.batches.map((b) => [b.batchNo, b.netTotal.value]),
    [
      ["0001", 3_000],
      ["0001", 1_160],
    ],
    seen,
  );
  const bank = { ...BANK, acquirers: [{ name: "Garanti BBVA", count: 3, total: 3_000 }, { name: "Akbank", count: 2, total: 1_160 }] };
  const c = asilposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw, error: null, source: "kod" }], bankPos: bank, okc: OKC, report: { ...REPORT, asilposZNo: null, okcZNo: null } });
  assert.equal(c.state, "uyumlu", JSON.stringify(c.rows));
  assert.equal(c.zNoFromPhoto, null);
});

test("OCR süresi sınırlı: süre dolunca hata (yarım okunuş yok)", { timeout: 30_000 }, async () => {
  await assert.rejects(ocrImage(slipPng(SLIP), { timeoutMs: 1 }), /süre/);
});
