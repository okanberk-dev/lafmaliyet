// Gün sonu e-postasında fotoğraf ↔ AsilPOS farkı satır satır (sahibin isteği, 24 Kasım 2026: "mail olarak vs. bilgilerde
// de farklı olunca belirsin"; docs/ASILPOS.md › Gün sonu otomasyonu). Yalnız yöneticinin e-postası; okuyanın kaynağı
// ("Yapay zekâ" / "Kodla okundu") yazılır. Fotoğraf sonradan eklenince giden kısa fotoğraf e-postası ve veritabanıyla uçtan
// uca tests/gun-sonu-foto.test.ts ve tests/gun-sonu-foto-db.test.ts'te.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { BankPos, PosDayZ, PosOkc } from "../src/lib/asilpos/day";
import { asilposPhotoCheck, type AsilposPhotoCheck } from "../src/lib/asilpos/foto";
import { renderDayEnd, type DayEndMail } from "../src/lib/asilpos/gun-sonu";
import { TEL_KART_ALANI } from "../src/lib/asilpos/eski-adlar";
import type { KasaOkc } from "../src/lib/photo-read/schemas";

const PHOTO_STRONG_MODEL = "claude-opus-5-5";
const plain = (v: string) => v.replace(/[\u00a0\u202f]/g, " ");
const DAY = "2026-11-24";
const NOW = new Date("2026-11-25T00:30:00+03:00");

const amt = (v: number | null, confidence: "high" | "medium" | "low" = "high") => ({ text: v === null ? null : String(v), value: v, confidence });
const NONE = { text: null, value: null, confidence: "high" as const };

/** Pavo'nun detaylı Z'si: banka gün sonu (000278 = 240, 000279 = 755) ve Z rakamları aynı fişte */
const detailedZ = (o: { card?: number; cash?: number; total?: number; zNo?: string | null; batches?: KasaOkc["batches"] } = {}): KasaOkc => ({
  documentType: "z_report",
  fiscalMarks: { mfLogo: false, ekuNo: false, cumulativeLines: false, vatBlock: false },
  readable: true,
  title: "Z RAPORU",
  date: DAY,
  time: "23:10",
  dateConfidence: "high",
  zNo: o.zNo === null ? NONE : { text: o.zNo ?? "0007", value: Number(o.zNo ?? 7), confidence: "high" },
  receiptCount: NONE,
  dailyTotal: amt(o.total ?? 1_190),
  dailyTotalLabel: "TOPLAM",
  kdvGroups: [{ rate: 10, total: amt(1_190), vat: amt(108.18), base: null }],
  totalVat: amt(108.18),
  payments: [
    { label: "NAKİT", count: null, amount: amt(o.cash ?? 390), kind: "cash" },
    { label: "KREDİ KARTI", count: null, amount: amt(o.card ?? 800), kind: "card" },
  ],
  outside: [],
  voids: amt(null),
  discounts: amt(null),
  cumulativeTotal: amt(null),
  cumulativeVat: amt(null),
  batches: o.batches ?? [
    { bank: "Garanti BBVA", batchNo: "000278", date: DAY, salesTotal: amt(240), refundTotal: amt(null), netTotal: amt(240), transactionCount: null },
    { bank: "Garanti BBVA", batchNo: "000279", date: DAY, salesTotal: amt(755), refundTotal: amt(null), netTotal: amt(755), transactionCount: null },
  ],
  issues: [],
});

const batch = (batchNo: string, total: number) => ({ batchNo, at: "2026-11-24T22:00:00.000Z", total, trigger: "elle" as const, dayClosed: true });
const BANK: BankPos = {
  status: "ok",
  batchNo: "000279",
  at: "2026-11-24T22:10:00.000Z",
  pavoCard: 755,
  [TEL_KART_ALANI]: 755,
  diff: 0,
  acquirers: [{ name: "Garanti BBVA", count: 3, total: 755 }],
  message: null,
  errorCode: null,
  batches: [{ ...batch("000278", 240), dayClosed: false }, batch("000279", 755)],
  dayCard: 995,
};
const OKC: PosOkc = {
  provider: "pavo",
  zReport: false,
  docs: 4,
  cash: 390,
  card: 800,
  mealCard: 0,
  other: 0,
  total: 1_190,
  voided: { count: 0, cash: 0, card: 0 },
  vat: [{ rate: 10, total: 1_190, vat: 108.18 }],
};
const REPORT = { bankPos: 995, okcZNo: "7", okcTotal: 1_190, okcCash: 390, okcCard: 800, okcMealCard: 0, okcOther: 0, okcVat: [{ rate: 10, total: 1_190, vat: 108.18 }], asilposZNo: "7" };
const check = (reads: Parameters<typeof asilposPhotoCheck>[0]["reads"]) => asilposPhotoCheck({ day: DAY, reads, bankPos: BANK, okc: OKC, report: REPORT }, NOW);

const Z: PosDayZ = {
  zNo: 3,
  receipts: 11,
  zTotal: 3_098,
  cash: 1_315,
  card: 1_088,
  mealCard: 195,
  online: 0,
  other: 500,
  offRevenue: 530,
  discounts: 32,
  openingCash: 1_120,
  cashOut: 800,
  countedCash: 1_535,
  handedOver: 500,
  cashDiff: -5,
  cashIn: 405,
  expectedCash: 1_540,
  cardTips: 20,
  cardCollections: 195,
  okcZNo: null,
};

const farkCheck = (): AsilposPhotoCheck => ({ ...check([{ photoId: 1, raw: detailedZ({ card: 850, cash: 340 }), error: null, source: "ai", model: PHOTO_STRONG_MODEL }]) });

test("Gün sonu e-postası: fotoğraf ↔ AsilPOS farkı satır satır ve okuyanın kaynağıyla; konuda 'Fotoğraf FARKLI'", () => {
  const c = farkCheck();
  assert.equal(c.state, "fark");
  const m: DayEndMail = {
    branchName: "Marina",
    date: DAY,
    z: Z,
    payments: [],
    ikram: [],
    values: null,
    missing: [],
    report: "auto",
    corrected: false,
    yesterday: { date: "2026-11-23", zTotal: null },
    lastWeek: { date: "2026-11-17", zTotal: null },
    online: null,
    link: "https://ladmin.test/panel/kasa?gun=2026-11-24",
    bankPos: BANK,
    okc: OKC,
    photo: { need: { slip: true, z: false, count: 1 }, attached: 1, check: c },
  };
  const out = renderDayEnd(m);
  const t = plain(out.text);
  assert.match(out.subject, /Fotoğraf FARKLI/);
  assert.match(t, /\nFotoğraf ↔ AsilPOS\n/);
  assert.match(t, /Okuyan: Yapay zekâ \(Claude Opus 5\.5\)/);
  assert.match(t, /Yazarkasa kartı: fotoğrafta 850 ₺ · AsilPOS'ta 800 ₺ · FARK/);
  assert.match(t, /Yazarkasa nakdi: fotoğrafta 340 ₺ · AsilPOS'ta 390 ₺ · FARK/);
  assert.match(t, /Banka POS toplamı: fotoğrafta 995 ₺ · AsilPOS'ta 995 ₺ · aynı/);
  assert.match(plain(out.html), /Fotoğraf ↔ AsilPOS/);
  // Uyumlu fotoğrafta da satırlar (kısa), konu değişmez
  const ok = renderDayEnd({ ...m, photo: { ...m.photo!, check: check([{ photoId: 1, raw: detailedZ(), error: null, source: "kod", model: "kod-ocr" }]) } });
  assert.doesNotMatch(ok.subject, /FARKLI/);
  assert.match(plain(ok.text), /Okuyan: Kodla okundu/);
});

