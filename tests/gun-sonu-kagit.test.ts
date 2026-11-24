// Gün sonu kâğıdının türü (24 Kasım 2026, Marina: Ladmin'de Z fotoğrafı "Z raporu" olarak tanınmadı; docs/FOTOGRAF.md ›
// LafPOS gününün fotoğrafı). Beş kâğıt: LafPOS'un kör kasada bastığı kâğıt (yalnız "BANKA GÜN SONU · PAVO"), rakamı
// gören basınca LafPOS'un kâğıdı ("GÜN SONU · Z n" + NET CİRO + "mali Z değildir" + banka kısmı), ModPOS'un Z'si
// (Tuzla; kendi Z no'sunu basar), yazarkasanın mali Z'si (MF, EKÜ, KÜM.) ve Pavo'nun banka gün sonu fişi / detaylı Z'si.
// Her biri için: sınıflama (okcPaperView), forma yazılan (normalizeOkc ve LafPOS gününün metni), LafPOS'la karşılaştırma
// (lafposPhotoCheck, zNoFromPhoto) ve güçlü modelin gerekip gerekmediği (cheapReadingProblems). Model yanıtları sabit;
// canlı yapay zekâ yok. Veritabanıyla tests/lafpos-gun-sonu-tam-db.test.ts ve tests/gun-sonu-foto-db.test.ts.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { BankPos, PosOkc } from "../src/lib/lafpos/day";
import { lafposPhotoCheck, staffPhotoLine } from "../src/lib/lafpos/foto";
import { photoCheckHash, renderPhotoMail } from "../src/lib/lafpos/gun-sonu";
import { cheapReadingProblems, runLafposRead } from "../src/lib/photo-read/lafpos-read";
import { OCR_MODEL, PHOTO_CHEAP_MODEL, PHOTO_STRONG_MODEL } from "../src/lib/photo-read/models";
import {
  isLafposPaper,
  normalizeOkc,
  OKC_BATCH_SLIP_LAFPOS_TEXT,
  OKC_BATCH_SLIP_TEXT,
  OKC_LAFPOS_BANK_UNREAD_TEXT,
  OKC_SOFTWARE_Z_LAFPOS_TEXT,
  OKC_SOFTWARE_Z_PAVO_TEXT,
  okcPaperView,
  okcReadingOnLafposDay,
  slipWithZTraces,
} from "../src/lib/photo-read/okc";
import { parsePavoOcr, type OcrLine } from "../src/lib/photo-read/pavo-ocr";
import { OKC_SHORT_TASK, OKC_TASK, POS_TASK, Z_TASK } from "../src/lib/photo-read/prompts";
import type { KasaOkc } from "../src/lib/photo-read/schemas";

const DAY = "2026-11-24";
const NOW = new Date("2026-11-24T22:30:00+03:00");
const PAVO = { provider: "pavo", zReport: false } as const;
const TOKENX = { provider: "tokenx", zReport: true } as const;

const amt = (v: number | null) => ({ text: v === null ? null : String(v).replace(".", ","), value: v, confidence: "high" as const });
const NONE = { text: null, value: null, confidence: "low" as const };
const bank = (bankName: string | null, no: string, net: number) => ({ bank: bankName, batchNo: no, date: DAY, salesTotal: NONE, refundTotal: NONE, netTotal: amt(net), transactionCount: null });

/** Boş okunuş; her kâğıt bunun üstüne kurulur */
const base = (o: Partial<KasaOkc> = {}): KasaOkc => ({
  documentType: "batch_slip",
  fiscalMarks: { mfLogo: false, ekuNo: false, cumulativeLines: false, vatBlock: false },
  readable: true,
  title: null,
  date: DAY,
  time: "22:03",
  dateConfidence: "high",
  zNo: NONE,
  receiptCount: NONE,
  dailyTotal: NONE,
  dailyTotalLabel: null,
  kdvGroups: [],
  totalVat: NONE,
  payments: [],
  outside: [],
  voids: NONE,
  discounts: NONE,
  cumulativeTotal: NONE,
  cumulativeVat: NONE,
  batches: [],
  issues: [],
  ...o,
});

/** LafPOS'un kör kasa kâğıdı: yalnız "BANKA GÜN SONU · PAVO"; Bankalar altında iki satır (aynı batch) */
const korKagit = (o: Partial<KasaOkc> = {}) => base({ title: "BANKA GÜN SONU · PAVO", batches: [bank("Garanti BBVA", "000279", 500), bank("Akbank", "000279", 255)], ...o });

/** Rakamı gören basınca LafPOS'un kâğıdı; ucuz model yanlışlıkla Z sanmış (Z no LafPOS'un sayacı, NET CİRO LafPOS'un) */
const rakamliKagit = (o: Partial<KasaOkc> = {}) =>
  base({
    documentType: "z_report",
    title: "GÜN SONU · Z 31",
    zNo: { text: "31", value: 31, confidence: "high" },
    dailyTotal: amt(1_190),
    dailyTotalLabel: "NET CİRO",
    kdvGroups: [{ rate: 10, total: amt(1_190), vat: amt(108.18), base: null }],
    totalVat: amt(108.18),
    payments: [
      { label: "Nakit", count: 12, amount: amt(390), kind: "cash" },
      { label: "Kart", count: 5, amount: amt(800), kind: "card" },
    ],
    batches: [bank("Garanti BBVA", "000279", 500), bank("Akbank", "000279", 255)],
    ...o,
  });

/** ModPOS'un Z'si (Tuzla): kendi Z no'sunu basar, yazarkasada basılınca VKN ve MF logosu ama BİLGİ FİŞİ */
const modposZ = () =>
  base({
    documentType: "software_z",
    fiscalMarks: { mfLogo: true, ekuNo: false, cumulativeLines: false, vatBlock: true },
    title: "Z RAPORU",
    zNo: { text: "0187", value: 187, confidence: "high" },
    dailyTotal: amt(12_975.5),
    dailyTotalLabel: "TOPLAM SATIŞ",
  });

/** Yazarkasanın mali Z'si (TokenX gibi ayrı mali Z basan cihaz) */
const maliZ = () =>
  base({
    documentType: "z_report",
    fiscalMarks: { mfLogo: true, ekuNo: true, cumulativeLines: true, vatBlock: true },
    title: "Z RAPORU",
    zNo: { text: "0188", value: 188, confidence: "high" },
    dailyTotal: amt(1_190),
    dailyTotalLabel: "NET SATIŞ",
    kdvGroups: [{ rate: 10, total: amt(1_190), vat: amt(108.18), base: null }],
    totalVat: amt(108.18),
    payments: [
      { label: "NAKİT", count: null, amount: amt(390), kind: "cash" },
      { label: "K.KARTI", count: null, amount: amt(800), kind: "card" },
    ],
  });

/** Pavo cihazının kendi banka gün sonu fişi (Z yok) */
const pavoFisi = (o: Partial<KasaOkc> = {}) => base({ title: "GÜN SONU RAPORU", batches: [bank("Garanti BBVA", "000279", 500), bank("Akbank", "000279", 255)], ...o });

const BANK: BankPos = {
  status: "ok",
  batchNo: "000279",
  at: "2026-11-24T19:03:00.000Z",
  pavoCard: 755,
  lafposCard: 755,
  diff: 0,
  acquirers: [
    { name: "Garanti BBVA", count: 3, total: 500 },
    { name: "Akbank", count: 2, total: 255 },
  ],
  message: null,
  errorCode: null,
  batches: [{ batchNo: "000279", at: "2026-11-24T19:03:00.000Z", total: 755, trigger: "otomatik", dayClosed: true }],
  dayCard: 755,
};
const OKC: PosOkc = { provider: "pavo", zReport: false, docs: 4, cash: 390, card: 800, mealCard: 0, other: 0, total: 1_190, voided: { count: 0, cash: 0, card: 0 }, vat: [{ rate: 10, total: 1_190, vat: 108.18 }] };
/** Pavo günü: LafPOS yazarkasa Z no göndermez (okcZNo hep null); fotoğraftaki gerçek Z no yazılabilir */
const REPORT = { bankPos: 755, okcZNo: null, okcTotal: 1_190, okcCash: 390, okcCard: 800, okcMealCard: 0, okcOther: 0, okcVat: [{ rate: 10, total: 1_190, vat: 108.18 }], lafposZNo: null };
const check = (raw: KasaOkc, o: { okc?: PosOkc; source?: "ai" | "kod" } = {}) => lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw, error: null, source: o.source ?? "ai" }], bankPos: BANK, okc: o.okc ?? OKC, report: REPORT }, NOW);
const read = (raw: KasaOkc) => normalizeOkc(raw, { day: DAY, prev: { z: null } });
const texts = (r: ReturnType<typeof read>) => r.checks.map((c) => c.text);
const NEED = { slip: true, z: false, count: 1 };

// ——— 1. LafPOS'un kör kasa kâğıdı ———

test("LafPOS kör kâğıdı (yalnız BANKA GÜN SONU · PAVO): banka gün sonu fişi; forma yalnız Banka gün sonu, 'Z'yi de çekin' Pavo gününde çıkmaz", () => {
  const raw = korKagit();
  assert.equal(isLafposPaper(raw), true);
  assert.equal(okcPaperView(raw).documentType, "batch_slip");
  const r = read(raw);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.values), ["bankPos"]);
  assert.equal(r.values.bankPos?.value, 755);
  assert.ok(texts(r).includes(OKC_BATCH_SLIP_TEXT), "ModPOS / ayrı Z'li günde eski yönerge");
  // LafPOS gününde Pavo: yazarkasa rakamları LafPOS'tan gelir; "Z değil, Z'yi de çekin" hiçbir satırda yok
  const pavo = okcReadingOnLafposDay(r, PAVO);
  assert.ok(texts(pavo).includes(OKC_BATCH_SLIP_LAFPOS_TEXT));
  assert.ok(!texts(pavo).some((t) => /Z raporunu|Z değil/.test(t)), JSON.stringify(texts(pavo)));
  assert.equal(okcReadingOnLafposDay(r, null), r, "cihaz bilinmiyorsa eski metin");
  assert.equal(okcReadingOnLafposDay(r, TOKENX), r, "ayrı mali Z basan cihazda Z istenir");
  // Karşılaştırma: uyumlu, Z yok bilgi satırı (fark değil), Z no yazılmaz; personele "alındı"; güçlü model gerekmez
  const c = check(raw);
  assert.equal(c.state, "uyumlu", JSON.stringify(c.rows));
  assert.equal(c.zNoFromPhoto, null);
  const info = c.rows.find((x) => x.label === "Pavo detaylı Z");
  assert.deepEqual(info, { label: "Pavo detaylı Z", photo: "yok", lafpos: "Z rakamları geldi", ok: true, info: true });
  assert.ok(c.rows.some((x) => x.label === "Banka dökümü" && x.ok), "iki banka satırı Pavo'nun dökümünü tutar");
  assert.equal(staffPhotoLine(NEED, 1, c), "Fotoğraf alındı");
  assert.deepEqual(cheapReadingProblems(raw, { expectBatches: true }), [], "kör kâğıt için Opus çağrılmaz");
  assert.equal(slipWithZTraces(raw), false);
});

test("Bilgi satırı: e-postada 'bilgi' yazar ve karşılaştırmanın özetini değiştirmez (gönderilmiş fark e-postası yeniden gitmez)", () => {
  const c = check(korKagit({ batches: [bank("Garanti BBVA", "000279", 400), bank("Akbank", "000279", 255)] }));
  assert.equal(c.state, "fark");
  const mail = renderPhotoMail({ branchName: "Marina", date: DAY, check: c, link: "https://x" });
  assert.match(mail.text, /Pavo detaylı Z: fotoğrafta yok · LafPOS'ta Z rakamları geldi · bilgi/);
  assert.equal(photoCheckHash(c), photoCheckHash({ ...c, rows: c.rows.filter((r) => !r.info) }));
});

// ——— 2. Rakamı gören basınca LafPOS'un kâğıdı ———

test("LafPOS rakamlı kâğıdı (GÜN SONU · Z n + NET CİRO + banka kısmı): model z_report dese de Z sayılmaz; Z no'su ve NET CİRO forma ve okcZNo'ya gitmez", () => {
  for (const raw of [rakamliKagit(), rakamliKagit({ documentType: "software_z" }), rakamliKagit({ documentType: "batch_slip" })]) {
    assert.equal(isLafposPaper(raw), true);
    const view = okcPaperView(raw);
    assert.equal(view.documentType, "batch_slip", raw.documentType);
    assert.deepEqual([view.zNo.text, view.dailyTotal.value, view.payments.length, view.kdvGroups.length], [null, null, 0, 0]);
    const r = read(raw);
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(r.values), ["bankPos"], "okcZNo / okcTotal / ödeme yok");
    assert.equal(r.okcAdmin, undefined, "sunucu sütunlarına (Z zinciri, kümülatif) girmez");
    const c = check(raw);
    assert.equal(c.state, "uyumlu", JSON.stringify(c.rows));
    assert.equal(c.zNoFromPhoto, null, "LafPOS'un Z no'su (31) yazarkasa Z no'su olmaz");
    assert.ok(!c.rows.some((x) => x.label.startsWith("Yazarkasa")), JSON.stringify(c.rows));
    assert.deepEqual(cheapReadingProblems(raw, { expectBatches: true }), [], "'Z no yok' / 'ödemeler toplamı' aranmaz: güçlü model çağrılmaz");
  }
  // Başlık iş yerinin adı okunduysa NET CİRO etiketi tanır (mali işaret yokken); mali Z'de tanımaz
  const byLabel = rakamliKagit({ title: "L'AFFOGATO MARİNA" });
  assert.equal(isLafposPaper(byLabel), true);
  assert.equal(check(byLabel).zNoFromPhoto, null);
  assert.equal(isLafposPaper({ ...byLabel, fiscalMarks: { mfLogo: true, ekuNo: true, cumulativeLines: true, vatBlock: true } }), false);
  // Başlığın yazımı: ayraç ve harf büyüklüğü
  // NET CİRO etiketi noktalama ya da ekle yazılsa da ("NET CİRO:", "NET CİRO (KDV DAHİL)")
  for (const dailyTotalLabel of ["NET CİRO:", "NET CİRO (KDV DAHİL)", "Net Ciro", "NET CIRO"]) {
    const raw = rakamliKagit({ title: "L'AFFOGATO", dailyTotalLabel });
    assert.equal(isLafposPaper(raw), true, dailyTotalLabel);
    assert.equal(okcPaperView(raw).zNo.text, null, dailyTotalLabel);
  }
  assert.equal(isLafposPaper(base({ dailyTotalLabel: "NET SATIŞ" })), false);
  // Başlığın yazımı: ayraç (hiç yoksa da) ve harf büyüklüğü; ara rapor da LafPOS'un
  for (const title of ["GÜN SONU · Z 31", "Gün sonu - Z 31", "GUN SONU • Z31", "GÜN SONU Z 14", "GÜN SONU — Z 14", "GÜN SONU | Z 14", "Banka gün sonu · Pavo", "BANKA GÜN SONU PAVO", "BANKA GÜN SONU — PAVO", "ARA RAPOR (X)", "Ara rapor X"])
    assert.equal(isLafposPaper(base({ title })), true, title);
  for (const title of ["Z RAPORU", "GÜN SONU RAPORU", "BANKA GÜN SONU", "DETAYLI Z", "GÜN SONU Z NO: 7", "GÜN SONU (DETAYLI Z)", "X RAPORU", null]) assert.equal(isLafposPaper(base({ title })), false, String(title));
  // Mali işareti olan kâğıt başlığı ne olursa olsun LafPOS'un değildir: Z no'su ve rakamları kalır
  for (const title of ["GÜN SONU - Z 0007", "GÜN SONU: Z 7"]) {
    const fiscal = maliZ();
    for (const marks of [{ mfLogo: true }, { ekuNo: true }, { cumulativeLines: true }]) {
      const raw = { ...fiscal, title, fiscalMarks: { mfLogo: false, ekuNo: false, cumulativeLines: false, vatBlock: true, ...marks } };
      assert.equal(isLafposPaper(raw), false, `${title} ${JSON.stringify(marks)}`);
      assert.equal(okcPaperView(raw).zNo.text, "0188");
    }
  }
});

test("LafPOS kâğıdının yalnız TOPLAM'ı okunduysa (banka adı yok) Pavo'nun iki bankalı dökümüyle fark çıkmaz; toplamı karşılaştırılır", () => {
  const c = check(korKagit({ batches: [bank(null, "000279", 755)] }));
  assert.equal(c.state, "uyumlu", JSON.stringify(c.rows));
  assert.ok(!c.rows.some((x) => x.label === "Banka dökümü"));
  assert.ok(c.rows.some((x) => x.label === "Banka POS toplamı" && x.ok));
  const wrong = check(korKagit({ batches: [bank(null, "000279", 700)] }));
  assert.equal(wrong.state, "fark", "toplam tutmuyorsa yine fark");
});

test("Yalnız LafPOS'un yönetim raporu (banka kısmı yok): yanlış belge; Pavo gününde Pavo'nun fişi istenir, personel yeniden çeker", () => {
  const raw = rakamliKagit({ batches: [] });
  assert.equal(okcPaperView(raw).documentType, "software_z");
  const r = read(raw);
  assert.equal(r.ok, false);
  assert.equal(r.switchTo, "kasa-z", "ModPOS gününde ModPOS bölümüne okut önerisi (eski kural)");
  const pavo = okcReadingOnLafposDay(r, PAVO);
  assert.deepEqual([pavo.error, pavo.switchTo], [OKC_SOFTWARE_Z_PAVO_TEXT, null]);
  assert.equal(okcReadingOnLafposDay(r, TOKENX).error, OKC_SOFTWARE_Z_LAFPOS_TEXT);
  const c = check(raw);
  assert.equal(c.state, "okunamadi");
  assert.equal(staffPhotoLine(NEED, 1, c), "Fotoğraf okunamadı / yanlış belge, yeniden çekin");
  assert.ok(cheapReadingProblems(raw, { expectBatches: true }).includes("belge türü"));
});

test("LafPOS'un banka kısmı okundu ama banka satırı yok (kadraj dışı ya da 'İşlem yok'): okunamadı, yeniden çekin; 'Z'yi çekin' denmez", () => {
  for (const raw of [korKagit({ batches: [] }), korKagit({ batches: [], title: "L'AFFOGATO", dailyTotalLabel: "NET CİRO" })]) {
    const view = okcPaperView(raw);
    assert.deepEqual([view.documentType, view.readable], ["batch_slip", false], raw.title ?? "");
    const r = read(raw);
    assert.deepEqual([r.ok, r.switchTo, r.error], [false, null, OKC_LAFPOS_BANK_UNREAD_TEXT]);
    assert.deepEqual(okcReadingOnLafposDay(r, PAVO), r, "Pavo gününde de aynı metin");
    assert.ok(!/Z rapor|detaylı Z/i.test(r.error ?? ""));
    assert.equal(check(raw).state, "okunamadi");
    assert.ok(cheapReadingProblems(raw, { expectBatches: true }).includes("okunamadı"), "güçlü model bir kez bakar");
  }
});

test("LafPOS'un ara raporu (ARA RAPOR (X)): model x_report dese de yazılım Z'si; Pavo gününde LafPOS'un raporu denir, Z no ve NET CİRO forma gitmez", () => {
  const raw = rakamliKagit({ documentType: "x_report", title: "ARA RAPOR (X)", zNo: NONE, batches: [] });
  assert.equal(isLafposPaper(raw), true);
  assert.equal(okcPaperView(raw).documentType, "software_z");
  const pavo = okcReadingOnLafposDay(read(raw), PAVO);
  assert.deepEqual([pavo.ok, pavo.error, pavo.switchTo], [false, OKC_SOFTWARE_Z_PAVO_TEXT, null]);
  assert.doesNotMatch(pavo.error ?? "", /yazarkasadan Z raporunu/);
  assert.equal(check(raw).state, "okunamadi");
});

test("Pavo'nun detaylı Z'si ucuz okumada software_z sanıldıysa (banka satırlarıyla): Z kaybolmaz; güçlü model çağrılır, 'uyumlu' denmez", () => {
  const detayli = base({
    ...maliZ(),
    documentType: "software_z",
    title: "GÜN SONU (DETAYLI Z)",
    zNo: { text: "0007", value: 7, confidence: "high" },
    batches: [bank("Garanti BBVA", "000278", 240), bank("Garanti BBVA", "000279", 755)],
  });
  assert.equal(isLafposPaper(detayli), false);
  assert.equal(okcPaperView(detayli), detayli, "LafPOS'un kâğıdı değilse dönüşmez");
  assert.ok(cheapReadingProblems(detayli, { expectBatches: true }).includes("belge türü"), "güçlü model okur");
  const r = okcReadingOnLafposDay(read(detayli), PAVO);
  assert.equal(r.ok, false);
  assert.ok(!texts(r).includes(OKC_BATCH_SLIP_LAFPOS_TEXT), "Banka gün sonu okundu denmez");
  const c = check(detayli);
  assert.notEqual(c.state, "uyumlu");
  assert.ok(!c.rows.some((x) => x.info), JSON.stringify(c.rows));
});

// ——— 3. ModPOS'un Z'si ———

test("ModPOS Z'si (kendi Z no'su, MF logosu, BİLGİ FİŞİ): yazarkasa bölümünde yanlış belge, ModPOS bölümüne okut; istemlerde Z NO tek başına mali işaret değil", () => {
  const raw = modposZ();
  assert.equal(isLafposPaper(raw), false);
  assert.equal(okcPaperView(raw), raw);
  const r = read(raw);
  assert.deepEqual([r.ok, r.switchTo, r.error], [false, "kasa-z", "Bu ModPOS'un Z raporu gibi görünüyor."]);
  // Aynı şeritte banka satırı da okunduysa da (Tuzla: ModPOS Z'sinin altında banka fişi) yanlış belge kalır: ModPOS
  // bölümüne okut önerisi gider, Banka POS dolmaz (dönüşüm yalnız LafPOS'un kâğıdında)
  const withSlip = { ...raw, batches: [bank("Garanti BBVA", "0234", 8_915)] };
  assert.equal(okcPaperView(withSlip), withSlip);
  assert.deepEqual([read(withSlip).ok, read(withSlip).switchTo], [false, "kasa-z"]);
  assert.deepEqual(Object.keys(read(withSlip).values), []);
  assert.ok(cheapReadingProblems(withSlip, { expectBatches: true }).includes("belge türü"));
  // İstemler: ModPOS Z bölümü ve kart bölümü Z NO'yu mali işaret saymaz; yazarkasa bölümü yazılımın Z no'sunu bilir
  assert.doesNotMatch(Z_TASK(DAY), /KÜMÜLATİF lines, Z NO \/ Z SAYAÇ\)/);
  assert.match(Z_TASK(DAY), /MF logo with a registry number together with EKÜ NO or KÜM\. \/ KÜMÜLATİF lines/);
  assert.match(Z_TASK(DAY), /A ModPOS report prints its own Z NO too/);
  assert.match(POS_TASK(DAY), /a Z NO alone is not enough/);
  assert.match(OKC_TASK(DAY), /- software_z: the restaurant software's \(ModPOS, LafPOS\) end-of-day report[^\n]*It may print its own Z number/);
  assert.doesNotMatch(OKC_TASK(DAY), /no Z NO \/ Z SAYAÇ/);
});

// ——— 4. Yazarkasanın mali Z'si ———

test("Yazarkasa mali Z'si: Z sayılır, Z no ve rakamlar forma; LafPOS kâğıdı sayılmaz", () => {
  const raw = maliZ();
  assert.equal(isLafposPaper(raw), false);
  assert.equal(okcPaperView(raw), raw);
  const r = read(raw);
  assert.equal(r.ok, true);
  assert.equal(r.values.okcZNo?.value, "0188");
  assert.equal(r.values.okcTotal?.value, 1_190);
  // Ayrı mali Z (TokenX) gününde karşılaştırılır, Z no LafPOS göndermediyse fotoğraftan
  const c = check({ ...raw, batches: [bank("Garanti BBVA", "000279", 500), bank("Akbank", "000279", 255)] }, { okc: { ...OKC, provider: "tokenx", zReport: true } });
  assert.equal(c.state, "uyumlu", JSON.stringify(c.rows));
  assert.equal(c.zNoFromPhoto, "0188");
  assert.ok(!c.rows.some((x) => x.info), "Z okunduysa bilgi satırı yok");
});

// ——— 5. Pavo'nun banka gün sonu fişi ve detaylı Z'si ———

test("Pavo'nun banka gün sonu fişi: banka gün sonu; Pavo gününde 'Z'yi de çekin' yok; Z'nin izi yoksa güçlü model çağrılmaz", () => {
  const raw = pavoFisi();
  assert.equal(isLafposPaper(raw), false);
  assert.equal(slipWithZTraces(raw), false, "GÜN SONU RAPORU başlığı Z izi değil");
  const r = okcReadingOnLafposDay(read(raw), PAVO);
  assert.equal(r.values.bankPos?.value, 755);
  assert.ok(texts(r).includes(OKC_BATCH_SLIP_LAFPOS_TEXT));
  const c = check(raw);
  assert.equal(c.state, "uyumlu");
  assert.ok(c.rows.some((x) => x.info));
  assert.deepEqual(cheapReadingProblems(raw, { expectBatches: true }), []);
});

test("Pavo'nun detaylı Z'si ucuz okumada banka fişi sanıldıysa (Z no, KDV, ödeme ya da başlıkta Z): 'Z izi', güçlü model bir kez okur", async () => {
  const traces: Partial<KasaOkc>[] = [
    { zNo: { text: "0007", value: 7, confidence: "high" } },
    { dailyTotal: amt(1_190) },
    { kdvGroups: [{ rate: 10, total: amt(1_190), vat: amt(108.18), base: null }] },
    { payments: [{ label: "NAKİT", count: null, amount: amt(390), kind: "cash" }] },
    { title: "DETAYLI Z" },
    { title: "Z RAPORU" },
  ];
  for (const t of traces) {
    const raw = pavoFisi(t);
    assert.equal(slipWithZTraces(raw), true, JSON.stringify(t));
    assert.ok(cheapReadingProblems(raw, { expectBatches: true }).includes("Z izi"), JSON.stringify(t));
  }
  // Banka alt satırı (bank_subline) Z izi değil; LafPOS'un kâğıdı hiç değil
  assert.equal(slipWithZTraces(pavoFisi({ payments: [{ label: "GARANTİ BBVA", count: null, amount: amt(500), kind: "bank_subline" }] })), false);
  assert.equal(slipWithZTraces(korKagit({ zNo: { text: "31", value: 31, confidence: "high" } })), false);
  // Okuma sırası: ucuz batch_slip + Z izi → güçlü model okur, onun Z'si kalır
  const strongZ = { ...maliZ(), fiscalMarks: { mfLogo: false, ekuNo: false, cumulativeLines: false, vatBlock: true }, title: "DETAYLI Z", batches: pavoFisi().batches };
  const calls = { cheap: 0, strong: 0, ocr: 0 };
  const res = await runLafposRead({
    previous: { reading: null, model: null, strongTried: false, ocr: null },
    strongModel: PHOTO_STRONG_MODEL,
    cheap: async () => (calls.cheap++, { ok: true, data: pavoFisi({ title: "DETAYLI Z" }), model: PHOTO_CHEAP_MODEL }),
    strong: async () => (calls.strong++, { ok: true, data: strongZ, model: PHOTO_STRONG_MODEL }),
    ocr: async () => (calls.ocr++, { ok: true, data: strongZ, model: OCR_MODEL }),
    needsSecond: (raw) => cheapReadingProblems(raw, { expectBatches: true }).length > 0,
  });
  assert.deepEqual(calls, { cheap: 1, strong: 1, ocr: 0 });
  assert.equal(res.raw?.documentType, "z_report");
  assert.equal(check(res.raw!).zNoFromPhoto, "0188");
  // Kör kâğıt: ucuz okuma yeter
  const kor = { cheap: 0, strong: 0 };
  await runLafposRead({
    previous: { reading: null, model: null, strongTried: false, ocr: null },
    strongModel: PHOTO_STRONG_MODEL,
    cheap: async () => (kor.cheap++, { ok: true, data: korKagit(), model: PHOTO_CHEAP_MODEL }),
    strong: async () => (kor.strong++, { ok: true, data: korKagit(), model: PHOTO_STRONG_MODEL }),
    ocr: async () => ({ ok: false, code: "ocr", message: "x" }),
    needsSecond: (raw) => cheapReadingProblems(raw, { expectBatches: true }).length > 0,
  });
  assert.deepEqual(kor, { cheap: 1, strong: 0 });
});

// ——— İstemler ———

test("İstemler LafPOS'un kâğıdını tanıtır: başlık aynen, Z no ve NET CİRO okunmaz, banka kısmı batch; kısa istem hâlâ kısa", () => {
  for (const task of [OKC_TASK(DAY), OKC_SHORT_TASK(DAY)]) {
    assert.match(task, /GÜN SONU · Z/);
    assert.match(task, /BANKA GÜN SONU · PAVO/);
    assert.match(task, /mali Z değildir/);
    assert.match(task, /PAVO - LAFPOS KARŞILAŞTIRMA/);
    assert.match(task, /software_z/);
  }
  assert.match(OKC_SHORT_TASK(DAY), /also when the bank end-of-day is on the same paper/);
  assert.ok(OKC_SHORT_TASK(DAY).length * 2 < OKC_TASK(DAY).length);
});

// ——— Kodla okuma (OCR) ———

/** OCR satırı (sözcük güveni hep 95; "(3)" gibi adet sözcükleri olduğu gibi) */
const ln = (text: string, conf = 95): OcrLine => {
  const words = text.split(/\s+/).map((w) => ({ text: w, confidence: conf }));
  return { text, confidence: conf, words };
};
const KOR_LINES = ["L'AFFOGATO", "Marina", "BANKA GÜN SONU · PAVO", "Batch 000279", "Cihaz saati 24.11.2026 22:03", "Alınış Gün kapanınca", "Bankalar", "Garanti BBVA (3) 500,00", "Akbank (2) 255,00", "TOPLAM 755,00 TL", "PAVO - LAFPOS KARŞILAŞTIRMA", "Pavo kart toplamı 755,00", "LafPOS kart toplamı 755,00", "FARK 0,00", "UYUMLU OK", "Pavo cihazının banka gün sonu özetidir"];
const Z_LINES = ["L'AFFOGATO", "GÜN SONU · Z 31", "İş günü 2026-11-24", "Kapanış 24.11.2026 22:03", "Brüt satış 1.190,00", "NET CİRO 1.190,00 TL", "Nakit (12) 390,00", "Kart (5) 800,00", "%10 / 1.081,82 108,18", "LafPOS yönetim raporudur, mali Z değildir"];

test("Kodla okuma: LafPOS'un kâğıdı Z sayılmaz; Bankalar satırları batch, karşılaştırma satırları atılır", () => {
  const kor = parsePavoOcr(KOR_LINES.map((l) => ln(l))).raw;
  assert.equal(kor.documentType, "batch_slip");
  assert.equal(kor.title, "BANKA GÜN SONU · PAVO");
  assert.deepEqual([kor.date, kor.time], [DAY, "22:03"]);
  assert.deepEqual(
    kor.batches.map((b) => [b.bank, b.batchNo, b.netTotal.value, b.netTotal.confidence]),
    [
      ["Garanti BBVA", "000279", 500, "high"],
      ["Akbank", "000279", 255, "high"],
    ],
  );
  assert.deepEqual([kor.zNo.text, kor.dailyTotal.value, kor.payments.length], [null, null, 0]);
  const c = check(kor, { source: "kod" });
  assert.equal(c.state, "uyumlu", JSON.stringify(c.rows));
  // Rakamlı kâğıt: Z kısmının Z no'su, NET CİRO'su ve ödemeleri okunmaz
  const both = parsePavoOcr([...Z_LINES, ...KOR_LINES].map((l) => ln(l))).raw;
  assert.equal(both.documentType, "batch_slip");
  assert.equal(both.title, "GÜN SONU · Z 31");
  assert.deepEqual([both.zNo.text, both.dailyTotal.value, both.payments.length, both.kdvGroups.length, both.batches.length], [null, null, 0, 0, 2]);
  assert.equal(check(both, { source: "kod" }).zNoFromPhoto, null);
  // Yalnız Z kısmı: yazılım Z'si
  assert.equal(parsePavoOcr(Z_LINES.map((l) => ln(l))).raw.documentType, "software_z");
  // Bankaların toplamı TOPLAM'ı tutmuyorsa hepsi şüpheli (yönetici baksın)
  const bad = parsePavoOcr(KOR_LINES.map((l) => ln(l === "Akbank (2) 255,00" ? "Akbank (2) 225,00" : l))).raw;
  assert.ok(bad.batches.every((b) => b.netTotal.confidence === "low"));
  assert.equal(check(bad, { source: "kod" }).state, "belirsiz");
  // Banka satırı okunmadıysa TOPLAM tek satır
  const totalOnly = parsePavoOcr(KOR_LINES.filter((l) => !/^(Garanti|Akbank)/.test(l)).map((l) => ln(l))).raw;
  assert.deepEqual(totalOnly.batches.map((b) => [b.bank, b.netTotal.value]), [[null, 755]]);
  // Kartla satış yok ("İşlem yok", "TOPLAM -"): okunamamış banka fişi, yazılım Z'si değil
  const empty = parsePavoOcr(["L'AFFOGATO", "BANKA GÜN SONU · PAVO", "Batch 000280", "Bankalar", "İşlem yok", "TOPLAM -", "PAVO - LAFPOS KARŞILAŞTIRMA"].map((l) => ln(l))).raw;
  assert.deepEqual([empty.documentType, empty.readable, empty.batches.length], ["batch_slip", false, 0]);
  assert.equal(read(empty).error, OKC_LAFPOS_BANK_UNREAD_TEXT);
  // Ara rapor: LafPOS'un kâğıdı, yazılım Z'si; NET CİRO'su okunmaz
  const x = parsePavoOcr(Z_LINES.map((l) => ln(l === "GÜN SONU · Z 31" ? "ARA RAPOR (X)" : l))).raw;
  assert.deepEqual([x.documentType, x.title, x.dailyTotal.value, x.zNo.text], ["software_z", "ARA RAPOR (X)", null, null]);
});
