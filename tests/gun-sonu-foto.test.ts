// Gün sonu fotoğrafının ekonomik okunuşu ve yöneticinin e-postası (sahibin isteği, 24 Kasım 2026: "mail olarak vs.
// bilgilerde de farklı olunca belirsin ve bunu AI kullanarak okursa çok iyi olur ama fazla token harcamayan ve sonuç
// verecek şekilde olsun; eğer AI token biterse de kod ile bir şey yaz"; docs/FOTOGRAF.md › LafPOS gününün fotoğrafı).
// Saf kurallar: önce ucuz model, eksik / kendi içinde tutarsız ya da LafPOS'tan farklı okunuşta bir kez güçlü model;
// yapay zekâ yoksa kodla okuma (OCR + Pavo fişinin kural tabanlı ayrıştırıcısı); kodla okunan her karşılaştırılan satır
// yüksek güvenle okunmadıysa "okunamadı — yönetici baksın"; fark e-postada satır satır, yalnız yöneticiye. Canlı yapay
// zekâ yok: okunuşlar sabit. Gerçek OCR sentetik görselle tests/gun-sonu-foto-ocr.test.ts'te, veritabanıyla uçtan uca
// tests/gun-sonu-foto-db.test.ts'te.

import assert from "node:assert/strict";
import { test } from "node:test";

import { lafposPhotoCheck, lafposPhotoDone, photoSourceText, photoUnsureText, staffPhotoLine, type LafposPhotoCheck } from "../src/lib/lafpos/foto";
import { photoCheckHash, photoMailNeeded, renderPhotoMail } from "../src/lib/lafpos/gun-sonu";
import type { BankPos, PosOkc } from "../src/lib/lafpos/day";
import { cheapReadingProblems, formFailureOf, runLafposRead, type ReadStep } from "../src/lib/photo-read/lafpos-read";
import { OCR_MODEL, PHOTO_CHEAP_MODEL, PHOTO_STRONG_MODEL, photoModelsOf, readingSourceOf } from "../src/lib/photo-read/models";
import { parseAmountTR, parsePavoOcr, type OcrLine } from "../src/lib/photo-read/pavo-ocr";
import { OKC_SHORT_TASK, OKC_TASK } from "../src/lib/photo-read/prompts";
import type { KasaOkc } from "../src/lib/photo-read/schemas";

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
  lafposCard: 755,
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
const REPORT = { bankPos: 995, okcZNo: "7", okcTotal: 1_190, okcCash: 390, okcCard: 800, okcMealCard: 0, okcOther: 0, okcVat: [{ rate: 10, total: 1_190, vat: 108.18 }], lafposZNo: "7" };
const check = (reads: Parameters<typeof lafposPhotoCheck>[0]["reads"]) => lafposPhotoCheck({ day: DAY, reads, bankPos: BANK, okc: OKC, report: REPORT }, NOW);

// ——— Modeller: ayardan, sabitler varsayılan ———

test("Okuma modelleri: ucuz Claude Haiku 5.5, güçlü Claude Opus 5.5; ayar yalnız bilinen modeli kabul eder", () => {
  assert.equal(PHOTO_CHEAP_MODEL, "claude-haiku-5-5");
  assert.equal(PHOTO_STRONG_MODEL, "claude-opus-5-5");
  assert.deepEqual(photoModelsOf(undefined), { cheap: "claude-haiku-5-5", strong: "claude-opus-5-5" });
  assert.deepEqual(photoModelsOf({ photoModels: { cheap: "claude-opus-5-5" } }), { cheap: "claude-opus-5-5", strong: "claude-opus-5-5" });
  assert.deepEqual(photoModelsOf({ photoModels: { cheap: "gpt-9", strong: 42 } }), { cheap: "claude-haiku-5-5", strong: "claude-opus-5-5" }, "bilinmeyen model varsayılana döner");
  assert.equal(readingSourceOf("claude-haiku-5-5"), "ai");
  assert.equal(readingSourceOf(OCR_MODEL), "kod");
});

test("Ucuz okumanın istemi kısa: güçlü modelinkinin yarısından az", () => {
  assert.ok(OKC_SHORT_TASK(DAY).length * 2 < OKC_TASK(DAY).length, `${OKC_SHORT_TASK(DAY).length} / ${OKC_TASK(DAY).length}`);
  assert.match(OKC_SHORT_TASK(DAY), /2026-11-24/);
});

// ——— Ucuz okumanın denetimi ———

test("Ucuz okuma: eksik ya da kendi içinde tutarsız okunuş ikinci okumaya gider", () => {
  assert.deepEqual(cheapReadingProblems(detailedZ(), { expectBatches: true }), []);
  assert.ok(cheapReadingProblems(detailedZ({ card: 700 }), { expectBatches: true }).includes("ödemeler toplamı tutmuyor"));
  assert.ok(cheapReadingProblems({ ...detailedZ(), dailyTotal: amt(null) }, { expectBatches: true }).includes("toplam yok"));
  assert.ok(cheapReadingProblems(detailedZ({ zNo: null }), { expectBatches: true }).includes("Z no yok"));
  assert.ok(cheapReadingProblems(detailedZ({ batches: [] }), { expectBatches: true }).includes("batch yok"));
  assert.deepEqual(cheapReadingProblems(detailedZ({ batches: [] }), { expectBatches: false }), [], "Pavo'nun sonucu gelmediyse batch beklenmez");
  const badBatch = detailedZ({ batches: [{ bank: "Garanti BBVA", batchNo: "000279", date: DAY, salesTotal: amt(800), refundTotal: amt(20), netTotal: amt(755), transactionCount: null }] });
  assert.ok(cheapReadingProblems(badBatch, { expectBatches: true }).includes("batch tutmuyor"));
  const unsure = { ...detailedZ(), dailyTotal: amt(1_190, "low") };
  assert.ok(cheapReadingProblems(unsure, { expectBatches: true }).includes("düşük güven"));
  assert.ok(cheapReadingProblems({ ...detailedZ(), documentType: "other" }, { expectBatches: true }).includes("belge türü"));
});

// ——— Okuma sırası: ucuz → (bir kez) güçlü → kod ———

type Calls = { cheap: number; strong: number; ocr: number };
const fakeDeps = (o: {
  cheap?: ReadStep;
  strong?: ReadStep;
  ocr?: ReadStep;
  previous?: Parameters<typeof runLafposRead>[0]["previous"];
  differs?: (raw: KasaOkc) => boolean;
}) => {
  const calls: Calls = { cheap: 0, strong: 0, ocr: 0 };
  const deps: Parameters<typeof runLafposRead>[0] = {
    previous: o.previous ?? { reading: null, model: null, strongTried: false, ocr: null },
    strongModel: PHOTO_STRONG_MODEL,
    cheap: async () => (calls.cheap++, o.cheap ?? { ok: true, data: detailedZ(), model: PHOTO_CHEAP_MODEL }),
    strong: async () => (calls.strong++, o.strong ?? { ok: true, data: detailedZ(), model: PHOTO_STRONG_MODEL }),
    ocr: async () => (calls.ocr++, o.ocr ?? { ok: true, data: detailedZ(), model: OCR_MODEL }),
    needsSecond: (raw) => cheapReadingProblems(raw, { expectBatches: true }).length > 0 || (o.differs?.(raw) ?? false),
  };
  return { deps, calls };
};

test("Okuma sırası: ucuz okuma tam ve LafPOS'u tutuyorsa güçlü model çağrılmaz", async () => {
  const { deps, calls } = fakeDeps({});
  const r = await runLafposRead(deps);
  assert.deepEqual(calls, { cheap: 1, strong: 0, ocr: 0 });
  assert.deepEqual([r.source, r.model], ["ai", PHOTO_CHEAP_MODEL]);
});

test("Okuma sırası: tutarsız ucuz okuma bir kez güçlü modele; güçlünün okunuşu geçer", async () => {
  const strong = detailedZ({ card: 800, total: 1_190 });
  const { deps, calls } = fakeDeps({ cheap: { ok: true, data: detailedZ({ card: 700 }), model: PHOTO_CHEAP_MODEL }, strong: { ok: true, data: strong, model: PHOTO_STRONG_MODEL } });
  const r = await runLafposRead(deps);
  assert.deepEqual(calls, { cheap: 1, strong: 1, ocr: 0 });
  assert.equal(r.model, PHOTO_STRONG_MODEL);
  assert.equal(r.raw, strong);
});

test("Okuma sırası: LafPOS'tan farklı okunan ucuz okuma yöneticiye gitmeden güçlü modelle yeniden okunur (yanlış 'fark' olmasın)", async () => {
  const { deps, calls } = fakeDeps({ cheap: { ok: true, data: detailedZ({ card: 850, cash: 340 }), model: PHOTO_CHEAP_MODEL }, differs: (raw) => check([{ photoId: 1, raw, error: null }]).state === "fark" });
  const r = await runLafposRead(deps);
  assert.deepEqual(calls, { cheap: 1, strong: 1, ocr: 0 });
  assert.equal(check([{ photoId: 1, raw: r.raw, error: null }]).state, "uyumlu");
});

test("Okuma sırası: güçlü okuma düşerse ucuz okunuş kalır; kodla okumaya gidilmez", async () => {
  const cheap = detailedZ({ card: 700 });
  const { deps, calls } = fakeDeps({ cheap: { ok: true, data: cheap, model: PHOTO_CHEAP_MODEL }, strong: { ok: false, code: "timeout", message: "x" } });
  const r = await runLafposRead(deps);
  assert.deepEqual(calls, { cheap: 1, strong: 1, ocr: 0 });
  assert.deepEqual([r.raw, r.model], [cheap, PHOTO_CHEAP_MODEL]);
});

test("Okuma sırası: aynı fotoğraf aynı iş için iki kez okunmaz (kayıtlı okunuş kullanılır)", async () => {
  const saved = detailedZ();
  const { deps, calls } = fakeDeps({ previous: { reading: saved, model: PHOTO_CHEAP_MODEL, strongTried: false, ocr: null } });
  const r = await runLafposRead(deps);
  assert.deepEqual(calls, { cheap: 0, strong: 0, ocr: 0 });
  assert.equal(r.raw, saved);
  // Güçlü okunuş kayıtlıysa o; ucuz okunuş tutarsız ve güçlü model denendiyse yeniden denenmez
  const tried = fakeDeps({ previous: { reading: detailedZ({ card: 700 }), model: PHOTO_CHEAP_MODEL, strongTried: true, ocr: null } });
  await runLafposRead(tried.deps);
  assert.deepEqual(tried.calls, { cheap: 0, strong: 0, ocr: 0 });
  // Tutarsız ucuz okunuş, güçlü model hiç denenmediyse bir kez
  const once = fakeDeps({ previous: { reading: detailedZ({ card: 700 }), model: PHOTO_CHEAP_MODEL, strongTried: false, ocr: null } });
  await runLafposRead(once.deps);
  assert.deepEqual(once.calls, { cheap: 0, strong: 1, ocr: 0 });
  // Kodla okunmuşsa ve yapay zekâ yine yoksa kod okunuşu kullanılır (OCR yeniden koşmaz)
  const ocr = fakeDeps({ previous: { reading: null, model: null, strongTried: false, ocr: saved }, cheap: { ok: false, code: "nokey", message: "x" } });
  const o = await runLafposRead(ocr.deps);
  assert.deepEqual(ocr.calls, { cheap: 1, strong: 0, ocr: 0 });
  assert.deepEqual([o.raw, o.source], [saved, "kod"]);
});

test("Kodla okumaya düşme: yapay zekâ olmayınca her hata türünde (anahtar, kapalı, sınır, kredi, yoğunluk, zaman aşımı, bağlantı…) OCR", async () => {
  for (const code of ["nokey", "off", "cap", "photo-limit", "billing", "auth", "rate", "overloaded", "timeout", "connection", "badrequest", "toolarge"] as const) {
    const { deps, calls } = fakeDeps({ cheap: { ok: false, code, message: "x" } });
    const r = await runLafposRead(deps);
    assert.deepEqual(calls, { cheap: 1, strong: 0, ocr: 1 }, code);
    assert.deepEqual([r.source, r.model], ["kod", OCR_MODEL], code);
  }
  // Ucuz model yanıt verdi ama okunuş yok (ret, yarım, şema dışı): önce bir kez güçlü model, o da olmazsa OCR
  for (const code of ["refusal", "incomplete", "invalid"] as const) {
    const ok = fakeDeps({ cheap: { ok: false, code, message: "x" } });
    assert.equal((await runLafposRead(ok.deps)).model, PHOTO_STRONG_MODEL, code);
    assert.deepEqual(ok.calls, { cheap: 1, strong: 1, ocr: 0 }, code);
    const both = fakeDeps({ cheap: { ok: false, code, message: "x" }, strong: { ok: false, code: "billing", message: "x" } });
    assert.equal((await runLafposRead(both.deps)).source, "kod", code);
    assert.deepEqual(both.calls, { cheap: 1, strong: 1, ocr: 1 }, code);
  }
  // OCR da olmazsa okunuş yok, yapay zekânın hatası kalır (uydurma yok)
  const none = fakeDeps({ cheap: { ok: false, code: "nokey", message: "anahtar yok" }, ocr: { ok: false, code: "ocr", message: "OCR çalışmadı" } });
  const r = await runLafposRead(none.deps);
  assert.deepEqual([r.raw, r.source, r.error?.code], [null, null, "nokey"]);
});

test("Kasa formu (elle girilen raporun yazarkasa bölümü): yalnız yapay zekâ okunuşu alanları doldurur; kodla okunduysa ya da okunamadıysa yapay zekânın hatası eskisi gibi görünür", async () => {
  // Yapay zekâ okudu: form doldurulur
  const ok = await runLafposRead(fakeDeps({}).deps);
  assert.equal(formFailureOf(ok), null);
  // Yapay zekâ yok, kodla okundu: rakamlar forma yazılmaz (kaynağı görünmeyen OCR rakamı yok); yapay zekânın metni ve kodu
  const kod = await runLafposRead(fakeDeps({ cheap: { ok: false, code: "billing", message: "Yapay zekâ kredisi bitti; rakamları elle yazın." } }).deps);
  assert.equal(kod.source, "kod");
  assert.deepEqual(formFailureOf(kod), { code: "billing", message: "Yapay zekâ kredisi bitti; rakamları elle yazın." });
  // Kayıtlı kod okunuşu yeniden kullanıldıysa da aynı
  const reuse = await runLafposRead(fakeDeps({ previous: { reading: null, model: null, strongTried: false, ocr: detailedZ() }, cheap: { ok: false, code: "timeout", message: "Zaman aşımı" } }).deps);
  assert.deepEqual(formFailureOf(reuse), { code: "timeout", message: "Zaman aşımı" });
  // Hiç okunuş yok (OCR da düştü): yapay zekânın hatası, sessiz boşluk değil
  const none = await runLafposRead(fakeDeps({ cheap: { ok: false, code: "nokey", message: "Fotoğraftan okuma kapalı; rakamları elle yazın." }, ocr: { ok: false, code: "ocr", message: "OCR süresi doldu" } }).deps);
  assert.deepEqual(formFailureOf(none), { code: "nokey", message: "Fotoğraftan okuma kapalı; rakamları elle yazın." });
});

// ——— Pavo fişinin kural tabanlı ayrıştırıcısı (OCR satırlarından) ———

test("Türkçe tutar: 1.234,56 ve *4160,00 okunur; şüpheli biçim okunmaz", () => {
  assert.equal(parseAmountTR("*1.055,00"), 1_055);
  assert.equal(parseAmountTR("4160,00"), 4_160);
  assert.equal(parseAmountTR("1.259.350,00"), 1_259_350);
  assert.equal(parseAmountTR("474,09TL"), 474.09);
  assert.equal(parseAmountTR("12.34"), null, "ondalık ayracı nokta: şüpheli");
  assert.equal(parseAmountTR("4.16,00"), null);
  assert.equal(parseAmountTR("abc"), null);
});

/** OCR satırı: sözcükler ve güvenleri (tesseract'ın verdiği biçim) */
const line = (spec: string, conf = 95): OcrLine => {
  const words = spec.split(/\s+/).map((w) => {
    const m = /^(.*)\((\d+)\)$/.exec(w);
    return m ? { text: m[1], confidence: Number(m[2]) } : { text: w, confidence: conf };
  });
  return { text: words.map((w) => w.text).join(" "), confidence: Math.min(...words.map((w) => w.confidence)), words };
};
const PAVO_LINES = [
  "PAVO",
  "L'AFFOGATO MARİNA",
  "TARİH: 24.11.2026 SAAT: 23:10",
  "Z RAPORU",
  "Z NO: 0007",
  "FİŞ SAYISI 19",
  "NAKİT *390,00",
  "KREDİ KARTI *800,00",
  "YEMEK KARTI *0,00",
  "TOPLAM *1.190,00",
  "%10 TOPLAM *1.190,00",
  "%10 KDV *108,18",
  "TOPKDV *108,18",
  "KÜM. TOPLAM *1.259.350,00",
  "BANKA GÜN SONU",
  "GARANTİ BBVA",
  "BATCH NO: 000278",
  "SATIŞ TOPLAMI 240,00",
  "İADE TOPLAMI 0,00",
  "NET TOPLAM 240,00",
  "GARANTİ BBVA",
  "BATCH NO: 000279",
  "SATIŞ TOPLAMI 755,00",
  "NET TOPLAM 755,00",
].map((l) => line(l));

test("Pavo detaylı Z (OCR satırları): Z no, tarih, toplam, nakit, kart, yemek kartı, KDV, batch'ler; KÜM. satırı alınmaz", () => {
  const { raw } = parsePavoOcr(PAVO_LINES);
  assert.equal(raw.documentType, "z_report");
  assert.equal(raw.readable, true);
  assert.deepEqual([raw.date, raw.time, raw.zNo.text, raw.zNo.confidence], [DAY, "23:10", "0007", "high"]);
  assert.deepEqual([raw.dailyTotal.value, raw.dailyTotal.confidence], [1_190, "high"]);
  const pay = Object.fromEntries(raw.payments.map((p) => [p.kind, p.amount.value]));
  assert.deepEqual(pay, { cash: 390, card: 800, meal_card: 0 });
  assert.deepEqual(
    raw.kdvGroups.map((g) => [g.rate, g.total.value, g.vat.value]),
    [[10, 1_190, 108.18]],
  );
  assert.equal(raw.totalVat.value, 108.18);
  assert.equal(raw.cumulativeTotal.value, null, "kümülatif bugünün toplamı değil, alınmaz");
  assert.deepEqual(
    raw.batches.map((b) => [b.batchNo, b.netTotal.value, b.salesTotal.value]),
    [
      ["000278", 240, 240],
      ["000279", 755, 755],
    ],
  );
  // Kodla okunan fiş LafPOS'u tutuyor: uyumlu, kaynağı "Kodla okundu"
  const c = check([{ photoId: 1, raw, error: null, source: "kod" }]);
  assert.equal(c.state, "uyumlu", JSON.stringify(c.rows));
  assert.equal(c.source, "kod");
  assert.equal(photoSourceText(c), "Kodla okundu");
});

test("Kodla okuma: güveni düşük rakam okunmuş sayılmaz (uydurulmaz); karşılaştırılan satır okunmadıysa 'okunamadı — yönetici baksın'", () => {
  const lines = PAVO_LINES.map((l) => (l.text === "KREDİ KARTI *800,00" ? line("KREDİ KARTI *800,00(41)") : l));
  const { raw } = parsePavoOcr(lines);
  const card = raw.payments.find((p) => p.kind === "card")!;
  assert.equal(card.amount.confidence, "low");
  const c = check([{ photoId: 1, raw, error: null, source: "kod" }]);
  assert.equal(c.state, "belirsiz", JSON.stringify(c.rows));
  assert.equal(c.readBankPos, null);
  assert.equal(c.zNoFromPhoto, null);
  // Personel için iş bitti (fotoğraf alındı); yönetici bakar
  assert.equal(staffPhotoLine({ slip: true, z: false, count: 1 }, 1, c), "Fotoğraf alındı");
  assert.equal(lafposPhotoDone({ slip: true, z: false, count: 1 }, 1, c), true);
  // Aynı okunuş yapay zekâdan gelse "fark" olurdu (kod okunuşunun güveni ayrıdır)
  assert.equal(check([{ photoId: 1, raw: { ...raw, payments: raw.payments.map((p) => (p.kind === "card" ? { ...p, amount: amt(850) } : p)) }, error: null, source: "ai" }]).state, "fark");
});

test("Kodla okuma: tutarsız satırlar (ödemeler toplamı tutmuyor) yüksek güven sayılmaz; tam ve tutarlı okunan fark 'fark'tır", () => {
  const lines = PAVO_LINES.map((l) => (l.text === "NAKİT *390,00" ? line("NAKİT *340,00") : l));
  const { raw } = parsePavoOcr(lines);
  assert.equal(raw.dailyTotal.confidence, "low", "nakit + kart toplamı tutmuyor: toplam ve ödemeler şüpheli");
  assert.equal(check([{ photoId: 1, raw, error: null, source: "kod" }]).state, "belirsiz");
  // Fişin kendisi tutarlı ama LafPOS'tan farklı: kodla da "fark"
  const other = PAVO_LINES.map((l) => (l.text === "NAKİT *390,00" ? line("NAKİT *340,00") : l.text === "TOPLAM *1.190,00" ? line("TOPLAM *1.140,00") : l.text === "%10 TOPLAM *1.190,00" ? line("%10 TOPLAM *1.140,00") : l.text === "%10 KDV *108,18" ? line("%10 KDV *103,64") : l.text === "TOPKDV *108,18" ? line("TOPKDV *103,64") : l));
  const r2 = parsePavoOcr(other).raw;
  const c = check([{ photoId: 1, raw: r2, error: null, source: "kod" }]);
  assert.equal(c.state, "fark", JSON.stringify(c.rows));
  assert.ok(c.issues.some((i) => i.startsWith("Yazarkasa toplamı")));
});

test("Kodla okuma: fişte hiçbir şey seçilmediyse personelden yeniden çekmesi istenmez, yönetici bakar; yanlış yüzde okunan KDV satırı uydurulmaz", () => {
  const { raw } = parsePavoOcr([line("~~~(20) ...(10)")]);
  assert.equal(raw.readable, false);
  assert.equal(check([{ photoId: 1, raw, error: null, source: "kod" }]).state, "belirsiz");
  const lines = PAVO_LINES.map((l) => (l.text === "%10 TOPLAM *1.190,00" ? line("9.10(55) TOPLAM *1.190,00") : l));
  const k = parsePavoOcr(lines).raw;
  assert.ok(
    k.kdvGroups.every((g) => g.total.confidence !== "high" || g.vat.confidence !== "high"),
    JSON.stringify(k.kdvGroups),
  );
  assert.equal(check([{ photoId: 1, raw: k, error: null, source: "kod" }]).state, "belirsiz");
});

test("Kodla okuma: basılmış ama güvenle okunmamış İADE ya da NET batch tutarı uydurulmaz (satış − 0 sayılmaz); 'fark' değil 'yönetici baksın'", () => {
  const bank: BankPos = { ...BANK, batchNo: "000279", batches: [batch("000279", 755)], dayCard: 755, acquirers: [{ name: "Garanti BBVA", count: 3, total: 755 }] };
  const slip = (refund: string, net: string) =>
    parsePavoOcr(["PAVO", "TARİH: 24.11.2026 SAAT: 23:10", "BANKA GÜN SONU", "GARANTİ BBVA", "BATCH NO: 000279", "SATIŞ TOPLAMI 800,00", refund, net].map((l) => line(l))).raw;
  const run = (raw: KasaOkc, bankPos: number | null) => lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw, error: null, source: "kod" }], bankPos: bank, okc: OKC, report: { ...REPORT, bankPos } }, NOW);
  // İADE ve NET basılmış, ikisi de düşük güvenle okunmuş
  const both = run(slip("İADE TOPLAMI 45,00(50)", "NET TOPLAM 755,00(50)"), 755);
  assert.equal(both.state, "belirsiz", JSON.stringify(both.rows));
  assert.ok(!both.rows.some((r) => r.photo.includes("800")), "satış tutarı batch neti sayılmaz");
  assert.ok(both.rows.some((r) => r.label === "Banka POS toplamı" && r.unread && r.photo === "okunamadı"), JSON.stringify(both.rows));
  // Yalnız NET düşük güvenli (İADE yüksek): satış − iade hesaplanmaz, NET basılmış
  const net = run(slip("İADE TOPLAMI 45,00", "NET TOPLAM 755,00(50)"), 755);
  assert.equal(net.state, "belirsiz", JSON.stringify(net.rows));
  // Yalnız İADE düşük güvenli, NET basılmamış: satış − 0 değil
  const refund = run(slip("İADE TOPLAMI 45,00(50)", "PAVO"), 755);
  assert.equal(refund.state, "belirsiz", JSON.stringify(refund.rows));
  // Banka POS boşken uydurma tutar "Banka POS'a yaz" diye önerilmez
  assert.equal(run(slip("İADE TOPLAMI 45,00(50)", "NET TOPLAM 755,00(50)"), null).readBankPos, null);
  // NET basılmamış, İADE basılmamış: satış neti (cihaz iadesiz günde NET'i basmayabilir) güvenle hesaplanır
  const plainSlip = run(slip("PAVO", "PAVO"), 755);
  assert.ok(plainSlip.rows.some((r) => r.label === "Banka POS toplamı" && plain(r.photo) === "800 ₺" && !r.unread), JSON.stringify(plainSlip.rows));
});

test("Kodla okuma: ödeme satırı OCR'da tanınmadıysa '0 ₺' uydurulmaz, okunamadı sayılır; LafPOS'ta 0 olan basılmamış satır tutar", () => {
  const lines = PAVO_LINES.map((l) => (l.text === "KREDİ KARTI *800,00" ? line("KREDl KARTl *800,00") : l));
  const c = check([{ photoId: 1, raw: parsePavoOcr(lines).raw, error: null, source: "kod" }]);
  assert.equal(c.state, "belirsiz", JSON.stringify(c.rows));
  const card = c.rows.find((r) => r.label === "Yazarkasa kartı");
  assert.ok(card, JSON.stringify(c.rows));
  assert.deepEqual([card.photo, card.unread], ["okunamadı", true]);
  assert.ok(!c.rows.some((r) => plain(r.photo) === "0 ₺" && !r.ok), JSON.stringify(c.rows));
  // Cihaz sıfır satırını basmaz: YEMEK satırı yok, LafPOS'ta yemek kartı 0 → tutar (uyumlu kalır)
  const noMeal = check([{ photoId: 1, raw: parsePavoOcr(PAVO_LINES.filter((l) => !l.text.startsWith("YEMEK"))).raw, error: null, source: "kod" }]);
  assert.equal(noMeal.state, "uyumlu", JSON.stringify(noMeal.rows));
  // Yapay zekâ okunuşunda basılmayan satır 0 sayılmaya devam eder (cihaz sıfırı basmaz)
  const ai = detailedZ();
  assert.equal(check([{ photoId: 1, raw: ai, error: null, source: "ai" }]).state, "uyumlu");
});

test("'Yönetici baksın' metni doğru: satır okunup güvenle seçilmediyse ayrı, kodla hiçbir şey okunamadıysa ya da OCR düştüyse ayrı", () => {
  const rows = check([{ photoId: 1, raw: parsePavoOcr(PAVO_LINES.map((l) => (l.text === "KREDİ KARTI *800,00" ? line("KREDİ KARTI *800,00(41)") : l))).raw, error: null, source: "kod" }]);
  assert.equal(rows.state, "belirsiz");
  assert.match(photoUnsureText(rows), /kodla okundu ama bir satır güvenle seçilmedi/);
  // OCR hata verdi (okunuş yok) ya da fişte hiçbir şey seçilmedi: "kodla okundu" denmez
  const failed = check([{ photoId: 1, raw: null, error: "OCR süresi doldu", source: "kod", model: OCR_MODEL }]);
  assert.equal(failed.state, "belirsiz");
  assert.doesNotMatch(photoUnsureText(failed), /kodla okundu/);
  assert.match(photoUnsureText(failed), /kodla da okunamadı/);
  const nothing = check([{ photoId: 1, raw: parsePavoOcr([line("~~~(20)")]).raw, error: null, source: "kod" }]);
  assert.match(photoUnsureText(nothing), /kodla da okunamadı/);
  const mail = renderPhotoMail({ branchName: "Marina", date: DAY, check: failed, link: "x" });
  assert.match(plain(mail.text), /kodla da okunamadı/);
  assert.doesNotMatch(plain(mail.text), /kodla okundu ama/);
});

// ——— E-posta: yalnız yöneticinin; fark satır satır ———



const farkCheck = (): LafposPhotoCheck => ({ ...check([{ photoId: 1, raw: detailedZ({ card: 850, cash: 340 }), error: null, source: "ai", model: PHOTO_STRONG_MODEL }]) });

test("Fotoğraf e-postası (gün sonu e-postasından sonra eklenen fotoğraf): her fotoğrafta (uyumlu da), satır satır, içerik başına bir kez", () => {
  const c = farkCheck();
  assert.equal(photoMailNeeded(c), true);
  // Sahibin isteği (25 Kasım 2026): "z raporu yükleyince mail gelmedi" — uyumlu fotoğraf da bildirilir
  const ok = check([{ photoId: 1, raw: detailedZ(), error: null }]);
  assert.equal(ok.state, "uyumlu");
  assert.equal(photoMailNeeded(ok), true, "uyumlu fotoğraf da e-posta gönderir");
  assert.equal(plain(renderPhotoMail({ branchName: "Marina", date: DAY, check: ok, link: "x" }).subject), "Kasa raporu KR-20261124 · Marina · 24 Kasım Salı · gün sonu fotoğrafı alındı · LafPOS'la aynı");
  assert.equal(photoMailNeeded(null), false);
  // İkinci fotoğraf (aynı okunuş) da yeni içeriktir
  assert.notEqual(photoCheckHash(ok), photoCheckHash({ ...ok, photos: ok.photos + 1 }));
  const mail = renderPhotoMail({ branchName: "Marina", date: DAY, check: c, link: "https://ladmin.test/panel/kasa?gun=2026-11-24" });
  assert.equal(plain(mail.subject), "Kasa raporu KR-20261124 · Marina · 24 Kasım Salı · gün sonu fotoğrafı LafPOS'tan FARKLI");
  const t = plain(mail.text);
  assert.match(t, /Yazarkasa kartı: fotoğrafta 850 ₺ · LafPOS'ta 800 ₺ · FARK/);
  assert.match(t, /Okuyan: Yapay zekâ \(Claude Opus 5\.5\)/);
  assert.match(t, /Panelde aç: https:\/\/ladmin\.test/);
  assert.match(plain(mail.html), /Yazarkasa kartı/);
  // Aynı karşılaştırma aynı özet (yeniden gönderilmez); anı farklı olsa da
  assert.equal(photoCheckHash(c), photoCheckHash({ ...c, at: "2026-11-25T09:00:00.000Z" }));
  assert.notEqual(photoCheckHash(c), photoCheckHash(check([{ photoId: 1, raw: detailedZ({ card: 860, cash: 330 }), error: null }])));
  const unsure: LafposPhotoCheck = { ...check([{ photoId: 1, raw: parsePavoOcr([line("~~~(20)")]).raw, error: null, source: "kod", model: OCR_MODEL }]) };
  assert.equal(unsure.state, "belirsiz");
  assert.equal(photoMailNeeded(unsure), true);
  assert.equal(plain(renderPhotoMail({ branchName: "Marina", date: DAY, check: unsure, link: "x" }).subject), "Kasa raporu KR-20261124 · Marina · 24 Kasım Salı · gün sonu fotoğrafı okunamadı, yönetici baksın");
});
