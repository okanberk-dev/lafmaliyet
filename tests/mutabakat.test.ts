// Mutabakat (docs/MUTABAKAT.md): ekstre okuma (esnek sütun eşlemesi, Türk sayı ve tarih biçimleri, CSV), eşleştirme
// (belge no, ad + tutar, tutar + gün, tutarı farklı, kararlar) ve banka POS hakediş karşılaştırması. Saf modüller:
// src/lib/mutabakat/{parse,match,pos,view}.ts. Sonda ekran, menü, yetki ve saklama kurallarının kaynak denetimi;
// veritabanıyla gidip gelen yol tests/mutabakat-db.test.ts'te.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { BANK_MATCH, expiryOf, isPosLine, KEEP_DAYS, manualCandidates, matchLines, nameHit, refHit, summarize, SUPPLIER_MATCH, type Candidate, type MatchLine } from "../src/lib/mutabakat/match";
import {
  columnMapProblem,
  decodeCsv,
  detectColumns,
  lineFingerprints,
  maskSensitive,
  parseAmount,
  parseCsv,
  parseDay,
  parseStatement,
  periodOf,
  type ParseResult,
} from "../src/lib/mutabakat/parse";
import { blockDaysError, posCardOf, posReconciliation, settlementDay, type PosSaleDay } from "../src/lib/mutabakat/pos";
import { accountName, bankScope, decisionProblem, filterRows, lineActions, missingFor, poolOf, reconcilePool, rowStatus, statementSummary, supplierScope } from "../src/lib/mutabakat/view";
import { canOpen } from "../src/lib/roles";

const ok = (r: ReturnType<typeof parseStatement>): ParseResult => {
  assert.ok(!("error" in r), `okunmalıydı: ${"error" in r ? r.error : ""}`);
  return r as ParseResult;
};

// ---------------------------------------------------------------- Okuma

test("tutar: Türk ve İngiliz biçimleri, eksi, parantez, para birimi", () => {
  assert.equal(parseAmount("1.234,56"), 1234.56);
  assert.equal(parseAmount("1,234.56"), 1234.56);
  assert.equal(parseAmount("-1.234,56"), -1234.56);
  assert.equal(parseAmount("1.234,56-"), -1234.56);
  assert.equal(parseAmount("(250,00)"), -250);
  assert.equal(parseAmount("1.234,56 TL"), 1234.56);
  assert.equal(parseAmount("₺ 12,5"), 12.5);
  assert.equal(parseAmount("1.234"), 1234);
  assert.equal(parseAmount("12.345.678"), 12345678);
  assert.equal(parseAmount("12.50"), 12.5);
  assert.equal(parseAmount("0,125"), 0.13);
  assert.equal(parseAmount("−45,00"), -45);
  assert.equal(parseAmount(99.999), 100);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("Toplam"), null);
  assert.equal(parseAmount("12a"), null);
});

test("gün: gün.ay.yıl, saatli, ISO, iki haneli yıl, Excel tarihi; olmayan gün okunmaz", () => {
  assert.equal(parseDay("05.11.2026"), "2026-11-05");
  assert.equal(parseDay("5/11/2026 14:32"), "2026-11-05");
  assert.equal(parseDay("05-11-26"), "2026-11-05");
  assert.equal(parseDay("2026-11-05T09:00:00"), "2026-11-05");
  assert.equal(parseDay(new Date(Date.UTC(2026, 10, 5))), "2026-11-05");
  // Saatli Excel hücresi: UTC 22:30 Türkiye'de ertesi gün
  assert.equal(parseDay(new Date(Date.UTC(2026, 10, 5, 22, 30))), "2026-11-06");
  assert.equal(parseDay(46331), "2026-11-05");
  assert.equal(parseDay("31.02.2026"), null);
  assert.equal(parseDay("Devir"), null);
  assert.equal(parseDay(12), null);
});

test("sütunlar başlıktan tanınır: başlık dosyanın ortasında, Borç / Alacak ayrı", () => {
  const grid = [
    ["Hesap No", "1234"],
    ["Dönem", "01.11.2026 - 30.11.2026"],
    [],
    ["İşlem Tarihi", "Valör", "Açıklama", "Dekont No", "Borç", "Alacak", "Bakiye"],
    ["02.11.2026", "02.11.2026", "ÜYE İŞYERİ POS HAKEDİŞ", "D1", "", "9.800,00", "19.800,00"],
    ["03.11.2026", "03.11.2026", "HAVALE SÜTAŞ A.Ş.", "D2", "2.500,00", "", "17.300,00"],
    ["", "", "Toplam", "", "2.500,00", "9.800,00", ""],
  ];
  const map = detectColumns(grid);
  assert.deepEqual(map, { headerRow: 3, date: 0, description: 2, amount: null, debit: 4, credit: 5, balance: 6, ref: 3 });
  const r = ok(parseStatement(grid, { kind: "banka" }));
  assert.deepEqual(
    r.lines.map((l) => [l.date, l.amount, l.ref, l.balance]),
    [
      ["2026-11-02", 9800, "D1", 19800],
      ["2026-11-03", -2500, "D2", 17300],
    ],
  );
  // Toplam satırının tarihi yok: atlandı
  assert.equal(r.skipped, 1);
  // Tedarikçi ekstresinde Borç artıdır (bize kesilen fatura), Alacak eksi (ödememiz)
  const t = ok(parseStatement(grid, { kind: "tedarikci" }));
  assert.deepEqual(t.lines.map((l) => l.amount), [-9800, 2500]);
});

test("tek tutar sütunu: işaret dosyadaki gibi; 'işaretleri çevir' tersine çevirir; 0 tutarlı satır yazılmaz", () => {
  const grid = [
    ["Tarih", "İşlem Açıklaması", "İşlem Tutarı", "Bakiye"],
    ["01/11/2026", "EFT GELEN", "1.000,00", "1.000,00"],
    ["02/11/2026", "FATURA ÖDEME", "-250,50", "749,50"],
    ["02/11/2026", "BİLGİ", "0,00", "749,50"],
  ];
  const r = ok(parseStatement(grid, { kind: "banka" }));
  assert.deepEqual(r.lines.map((l) => l.amount), [1000, -250.5]);
  assert.equal(r.map.amount, 2);
  assert.equal(r.map.balance, 3);
  assert.deepEqual(ok(parseStatement(grid, { kind: "banka", flip: true })).lines.map((l) => l.amount), [-1000, 250.5]);
});

test("sütunlar tanınmazsa başlıklar döner; elle eşleme denetlenir", () => {
  const grid = [
    ["A", "B", "C"],
    ["01.11.2026", "Market", "120,00"],
  ];
  const r = parseStatement(grid, { kind: "banka" });
  assert.ok("error" in r, "tanınmamalıydı");
  assert.deepEqual("error" in r ? r.headers : [], ["A", "B", "C"]);
  const map = { headerRow: 0, date: 0, description: 1, amount: 2, debit: null, credit: null, balance: null, ref: null };
  assert.deepEqual(ok(parseStatement(grid, { kind: "banka", map })).lines.map((l) => [l.date, l.description, l.amount]), [["2026-11-01", "Market", 120]]);
  assert.equal(columnMapProblem({ ...map, amount: null }, 3), "Tutar sütununu (ya da Borç / Alacak sütunlarını) seçin");
  assert.equal(columnMapProblem({ ...map, debit: 1 }, 3), "Tek tutar sütunu ile Borç / Alacak birlikte seçilemez");
  assert.equal(columnMapProblem({ ...map, date: 9 }, 3), "Seçilen sütun dosyada yok");
});

test("CSV: ayraç seçimi, tırnaklı hücre, BOM, Windows-1254", () => {
  const rows = parseCsv('﻿Tarih;Açıklama;Tutar\r\n01.11.2026;"HAVALE; ""ABC"" LTD";-1.250,00\r\n');
  assert.deepEqual(rows, [
    ["Tarih", "Açıklama", "Tutar"],
    ["01.11.2026", 'HAVALE; "ABC" LTD', "-1.250,00"],
  ]);
  // Virgül ayraçlı dosyada tutar tırnak içinde
  assert.deepEqual(parseCsv('Tarih,Aciklama,Tutar\n01.11.2026,Kira,"-15.000,00"')[1], ["01.11.2026", "Kira", "-15.000,00"]);
  assert.deepEqual(parseCsv("Tarih\tTutar\n01.11.2026\t5,00")[1], ["01.11.2026", "5,00"]);
  // "Ş" Windows-1254'te 0xDE: UTF-8 olarak geçersiz
  assert.equal(decodeCsv(new Uint8Array([0xde, 0x55, 0x42, 0x45])), "ŞUBE");
  assert.equal(decodeCsv(new TextEncoder().encode("ŞUBE")), "ŞUBE");
});

test("KVKK: IBAN, kart ve uzun numaralar örtülür; ad ve fatura numarası kalır", () => {
  assert.equal(maskSensitive("HAVALE AHMET YILMAZ TR12 0006 2000 1234 5678 9012 34"), "HAVALE AHMET YILMAZ TR••1234");
  assert.equal(maskSensitive("TCKN 12345678901 EFT"), "TCKN ••8901 EFT");
  assert.equal(maskSensitive("KART 5400 12** **** 1234 MIGROS"), "KART ••1234 MIGROS");
  assert.equal(maskSensitive("FATURA ABC2026000000123 05.11.2026 1.250,00"), "FATURA ABC2026000000123 05.11.2026 1.250,00");
  // Yalnız banka ekstresinde: tedarikçi ekstresinin açıklaması fatura numarasıdır
  const grid = [
    ["Tarih", "Açıklama", "Tutar"],
    ["01.11.2026", "20261100000123456", "100,00"],
  ];
  assert.equal(ok(parseStatement(grid, { kind: "tedarikci" })).lines[0].description, "20261100000123456");
  assert.equal(ok(parseStatement(grid, { kind: "banka" })).lines[0].description, "••3456");
});

test("parmak izi: aynı satır ikinci yüklemede tanınır; dosyadaki birebir iki hareket ayrı sayılır", () => {
  const l = { date: "2026-11-02", amount: 100, description: "POS", ref: null, balance: null };
  const a = lineFingerprints([l, l, { ...l, amount: 101 }]);
  assert.equal(new Set(a).size, 3);
  assert.deepEqual(lineFingerprints([l, l]), a.slice(0, 2));
  assert.deepEqual(periodOf([{ date: "2026-11-05" }, { date: "2026-11-01" }, { date: "2026-11-09" }]), { from: "2026-11-01", to: "2026-11-09" });
  assert.equal(periodOf([]), null);
});

// ---------------------------------------------------------------- Eşleştirme

let lineId = 0;
const line = (date: string, amount: number, description = "", o: Partial<MatchLine> = {}): MatchLine => ({ id: ++lineId, date, amount, description, ref: null, decision: null, matchKind: null, matchId: null, ...o });
const cand = (kind: Candidate["kind"], id: number, date: string, amount: number, label: string, o: Partial<Candidate> = {}): Candidate => ({ kind, id, date, amount, label, names: [label], ...o });

test("ad ve belge numarası: Türkçe harf sadeleşir, şirket türü sözcükleri sayılmaz", () => {
  assert.equal(nameHit("EFT SUTAS SUT URUNLERI AS", ["Sütaş"]), true);
  assert.equal(nameHit("HAVALE ABC GIDA LTD STI", ["Xyz Gıda Ltd. Şti."]), false);
  assert.equal(nameHit("KIRA ODEMESI", undefined), false);
  assert.equal(refHit({ description: "Fatura No: ABC-2026/000123", ref: null }, "ABC2026000123"), true);
  assert.equal(refHit({ description: "", ref: "A12" }, "A12"), false);
});

test("banka: aynı tutarda önce adı geçen kayıt, sonra en yakın gün; bir kayıt tek satıra gider", () => {
  const lines = [line("2026-11-03", -2500, "EFT SUTAS SUT"), line("2026-11-04", -2500, "HAVALE 4471"), line("2026-11-10", -90, "BANKA MASRAFI")];
  const candidates = [cand("odeme", 1, "2026-11-04", -2500, "Kahveci Ltd"), cand("fatura-odeme", 7, "2026-11-01", -2500, "Sütaş"), cand("harcama", 3, "2026-10-01", -90, "Eski masraf")];
  const { rows, missing } = matchLines(lines, candidates, { ...BANK_MATCH, period: { from: "2026-11-01", to: "2026-11-30" } });
  assert.deepEqual(
    rows.map((r) => [r.status, r.basis, r.candidate?.id ?? null]),
    [
      ["eslesti", "ad", 7],
      ["eslesti", "tutar", 1],
      // Aynı tutarlı kayıt 40 gün önce: pencerenin dışında
      ["yok", null, null],
    ],
  );
  assert.deepEqual(missing, []);
  assert.deepEqual(summarize(rows), { eslesti: 2, fark: 0, yok: 1, yoksay: 0, yokAmount: 90, farkAmount: 0 });
});

test("banka: tutarı farklı yalnız ad tutuyorsa; giriş çıkışla eşleşmez; dönemdeki eşleşmeyen kayıt 'ekstrede yok'", () => {
  const lines = [line("2026-11-05", -1180, "HAVALE KAHVECI LTD"), line("2026-11-06", 500, "NAKIT YATAN"), line("2026-11-07", -300, "EFT BILINMEYEN")];
  const candidates = [cand("odeme", 1, "2026-11-05", -1200, "Kahveci Ltd"), cand("harcama", 2, "2026-11-06", -500, "Tamirci"), cand("teslim", 3, "2026-11-08", 500, "Bankaya"), cand("harcama", 4, "2026-11-07", -310, "Kırtasiye")];
  const { rows, missing } = matchLines(lines, candidates, { ...BANK_MATCH, period: { from: "2026-11-01", to: "2026-11-30" } });
  assert.deepEqual(
    rows.map((r) => [r.status, r.basis, r.candidate?.id ?? null, r.diff]),
    [
      ["fark", "yakin", 1, -20],
      ["eslesti", "tutar", 3, 0],
      ["yok", null, null, 0],
    ],
  );
  assert.deepEqual(missing.map((c) => c.id), [2, 4]);
});

test("kararlar: elle eşleştirme önce gelir, yok say ve ayır kendiliğinden eşleşmeyi durdurur, silinen kayıt bayat", () => {
  const candidates = [cand("harcama", 1, "2026-11-05", -100, "Market"), cand("harcama", 2, "2026-11-05", -100, "Buz")];
  const lines = [
    line("2026-11-05", -100, "A"),
    line("2026-11-05", -100, "B", { decision: "elle", matchKind: "harcama", matchId: 1 }),
    line("2026-11-05", -100, "C", { decision: "yoksay" }),
    line("2026-11-05", -100, "D", { decision: "ayir" }),
    line("2026-11-05", -75, "E", { decision: "elle", matchKind: "harcama", matchId: 99 }),
    line("2026-11-06", -130, "F", { decision: "elle", matchKind: "harcama", matchId: 2 }),
  ];
  const { rows } = matchLines(lines, candidates, BANK_MATCH);
  const by = Object.fromEntries(rows.map((r) => [r.line.description, r]));
  assert.deepEqual([by.B.status, by.B.basis, by.B.candidate?.id], ["eslesti", "elle", 1]);
  // Elle seçilen kayıtların ikisi de kullanıldı: A'ya kayıt kalmadı
  assert.equal(by.A.status, "yok");
  assert.equal(by.C.status, "yoksay");
  assert.equal(by.D.status, "yok");
  assert.deepEqual([by.E.status, by.E.stale], ["yok", true]);
  // Elle eşleşen kaydın tutarı tutmuyorsa fark yazılır
  assert.deepEqual([by.F.status, by.F.diff], ["fark", 30]);
});

test("tedarikçi ekstresi: fatura numarası kesin eşleşmedir; tutar tutmuyorsa 'tutarı farklı'; ödeme eksi satırla eşleşir", () => {
  const lines = [
    line("2026-11-02", 1250, "ABC2026000000011"),
    line("2026-11-09", 980, "Fatura", { ref: "ABC2026000000012" }),
    line("2026-11-12", -1250, "Tahsilat"),
    line("2026-11-20", 400, "ABC2026000000099"),
  ];
  const candidates = [
    cand("fatura", 11, "2026-11-02", 1250, "ABC2026000000011", { ref: "ABC2026000000011" }),
    cand("fatura", 12, "2026-11-09", 1000, "ABC2026000000012", { ref: "ABC2026000000012" }),
    cand("odeme", 5, "2026-11-11", -1250, "Ödeme (havale)"),
    cand("fatura", 13, "2026-11-25", 700, "ABC2026000000013", { ref: "ABC2026000000013" }),
  ];
  const { rows, missing } = matchLines(lines, candidates, { ...SUPPLIER_MATCH, period: { from: "2026-11-01", to: "2026-11-30" } });
  assert.deepEqual(
    rows.map((r) => [r.status, r.basis, r.candidate?.id ?? null, r.diff]),
    [
      ["eslesti", "belge", 11, 0],
      ["fark", "belge", 12, -20],
      ["eslesti", "tutar", 5, 0],
      // Ekstrede var, panelde yok (Paraşüt'e gelmemiş fatura)
      ["yok", null, null, 0],
    ],
  );
  // Panelde var, ekstrede yok
  assert.deepEqual(missing.map((c) => c.id), [13]);
});

test("elle eşleştirme adayları: aynı yön, önce tutarı tutan, sonra günü yakın", () => {
  const free = [cand("harcama", 1, "2026-11-01", -90, "a"), cand("harcama", 2, "2026-11-20", -100, "b"), cand("teslim", 3, "2026-11-05", 100, "c"), cand("harcama", 4, "2026-11-06", -120, "d"), cand("harcama", 5, "2026-08-01", -100, "e")];
  assert.deepEqual(manualCandidates({ amount: -100, date: "2026-11-05" }, free).map((c) => c.id), [2, 4, 1]);
});

test("POS satırı: girişte POS / üye işyeri / hakediş; çıkışta yalnız komisyon ve iade; kart alışverişi değil", () => {
  const pos = (amount: number, description: string, decision: MatchLine["decision"] = null) => isPosLine({ amount, description, decision });
  assert.equal(pos(9800, "ÜYE İŞYERİ ÖDEMESİ 0012345"), true);
  assert.equal(pos(9800, "POS HAKEDİŞ"), true);
  assert.equal(pos(-196, "POS KOMİSYON KESİNTİSİ"), true);
  assert.equal(pos(-450, "POS ALIŞVERİŞ MIGROS"), false);
  assert.equal(pos(5000, "HAVALE GELEN"), false);
  assert.equal(pos(5000, "HAVALE GELEN", "pos"), true);
  assert.equal(pos(9800, "POS HAKEDİŞ", "ayir"), false);
  assert.equal(pos(9800, "POS HAKEDİŞ", "yoksay"), false);
});

// ---------------------------------------------------------------- POS hakediş

const day = (date: string, card: number, branchId = "tuzla"): PosSaleDay => ({ date, branchId, card, source: "z" });
const settings = { blockDays: 1, rates: { tuzla: 0.02, marina: 0.025 }, defaultRate: 0.02 };

test("valör günü: bloke günü eklenir, hafta sonu pazartesiye kayar", () => {
  // 2026-11-05 perşembe
  assert.equal(settlementDay("2026-11-05", 1), "2026-11-06");
  assert.equal(settlementDay("2026-11-06", 1), "2026-11-09");
  assert.equal(settlementDay("2026-11-07", 1), "2026-11-09");
  assert.equal(settlementDay("2026-11-08", 0), "2026-11-09");
  assert.equal(settlementDay("2026-11-05", 30), "2026-12-07");
  assert.equal(blockDaysError(1), null);
  assert.equal(blockDaysError(1.5), "Bloke gününü tam sayı yazın");
  assert.equal(blockDaysError(-1), "Bloke günü eksi olamaz");
  assert.equal(blockDaysError(61), "Bloke günü en çok 60");
});

test("POS: beklenen net şubenin oranıyla, valör gününde gelenle karşılaştırılır; hafta sonu tek valörde toplanır", () => {
  const { rows, totals } = posReconciliation({
    days: [day("2026-11-05", 10000), day("2026-11-05", 4000, "marina"), day("2026-11-06", 5000), day("2026-11-07", 6000), day("2026-11-08", 7000), day("2026-11-09", 3000)],
    inflows: [
      { date: "2026-11-06", amount: 13700 },
      { date: "2026-11-09", amount: 18000 },
      { date: "2026-11-09", amount: -360 },
    ],
    settings,
    coverage: { from: "2026-11-06", to: "2026-11-09" },
    today: "2026-11-12",
  });
  assert.deepEqual(
    rows.map((r) => [r.due, r.gross, r.expected, r.received, r.diff, r.status]),
    [
      // 10.000 × 0,98 + 4.000 × 0,975
      ["2026-11-06", 14000, 13700, 13700, 0, "tamam"],
      // Cuma, cumartesi, pazar: 18.000 brüt; komisyon ayrı satırda kesildi
      ["2026-11-09", 18000, 17640, 17640, 0, "tamam"],
      // Ekstre 9 Kasım'da bitiyor: 10 Kasım valörü henüz görülemez
      ["2026-11-10", 3000, 2940, 0, 0, "bekleniyor"],
    ],
  );
  assert.deepEqual(rows[0].sales.map((s) => [s.branchId, s.rate, s.net]), [
    ["marina", 0.025, 3900],
    ["tuzla", 0.02, 9800],
  ]);
  assert.deepEqual(totals, { gross: 32000, expected: 31340, received: 31340, diff: 0, lateAmount: 0, lateCount: 0, waitingAmount: 2940, effectiveRate: 0.0206 });
});

test("POS: gelmeyen gün gecikti, eksik gelen fark, sonradan gelen geç geldi, karşılığı olmayan beklenmeyen giriş", () => {
  const { rows, totals } = posReconciliation({
    days: [day("2026-11-02", 1000), day("2026-11-03", 2000), day("2026-11-04", 3000), day("2026-11-10", 500), day("2026-10-20", 900)],
    inflows: [
      { date: "2026-11-03", amount: 900 },
      // 4 Kasım valörü (1.960) iki gün geç, 6 Kasım'da geldi; 5 Kasım valörü (2.940) hiç gelmedi
      { date: "2026-11-06", amount: 1960 },
      { date: "2026-11-12", amount: 250 },
    ],
    settings,
    coverage: { from: "2026-11-01", to: "2026-11-12" },
    today: "2026-11-12",
  });
  assert.deepEqual(
    rows.map((r) => [r.due, r.expected, r.received, r.diff, r.status, r.lateDays, r.receivedOn]),
    [
      ["2026-11-03", 980, 900, -80, "fark", 0, null],
      ["2026-11-04", 1960, 1960, 0, "gec-geldi", 2, "2026-11-06"],
      ["2026-11-05", 2940, 0, -2940, "gecikti", 7, null],
      ["2026-11-11", 490, 0, -490, "gecikti", 1, null],
      ["2026-11-12", 0, 250, 250, "beklenmeyen", 0, null],
    ],
  );
  // 20 Ekim satışının valörü ekstreden önce: karşılaştırılmaz
  assert.equal(totals.lateCount, 2);
  assert.equal(totals.lateAmount, 3430);
  assert.equal(totals.diff, -3260);
});

test("POS: ekstre yokken hepsi bekleniyor; kart tutarı banka fişinden, yoksa Z'den; ekstrenin son günü gecikme sayılmaz", () => {
  const none = posReconciliation({ days: [day("2026-11-02", 1000)], inflows: [], settings, coverage: null, today: "2026-11-12" });
  assert.deepEqual(none.rows.map((r) => r.status), ["bekleniyor"]);
  assert.equal(none.totals.waitingAmount, 980);
  assert.deepEqual(posCardOf({ card: 1000, bankPos: 990 }), { card: 990, source: "banka-fisi" });
  assert.deepEqual(posCardOf({ card: 1000, bankPos: null }), { card: 1000, source: "z" });
  assert.deepEqual(posCardOf({ card: 1000, bankPos: 0 }), { card: 1000, source: "z" });
  const last = posReconciliation({ days: [day("2026-11-02", 1000)], inflows: [], settings, coverage: { from: "2026-11-01", to: "2026-11-03" }, today: "2026-11-12" });
  assert.deepEqual(last.rows.map((r) => [r.status, r.diff]), [["bekleniyor", 0]]);
});

// ---------------------------------------------------------------- Ekran kuralları (view.ts)

test("havuz: bankada POS satırları eşleştirmeye girmez, boşta kalan kayıtlar dönemle süzülür; özet POS'u ayrı sayar", () => {
  const lines = [
    line("2026-11-03", 9800, "UYE ISYERI POS HAKEDIS"),
    line("2026-11-03", -150, "POS KOMISYON KESINTISI"),
    line("2026-11-04", -500, "HAVALE TAMIRCI"),
    line("2026-11-05", 1000, "NAKIT YATAN", { decision: "pos" }),
    line("2026-11-06", -40, "MASRAF", { decision: "yoksay" }),
  ];
  // POS hakedişi kadar bir teslim kaydı: POS satırı onu "kapmaz"
  const candidates = [cand("harcama", 1, "2026-11-04", -500, "Tamirci"), cand("teslim", 2, "2026-11-03", 9800, "Bankaya"), cand("harcama", 3, "2026-12-20", -70, "Aralık")];
  const { rows, free } = reconcilePool("banka", lines, candidates, BANK_MATCH);
  assert.deepEqual(
    rows.map((r) => [r.line.description, rowStatus(r)]),
    [
      ["UYE ISYERI POS HAKEDIS", "pos"],
      ["POS KOMISYON KESINTISI", "pos"],
      ["HAVALE TAMIRCI", "eslesti"],
      ["NAKIT YATAN", "pos"],
      ["MASRAF", "yoksay"],
    ],
  );
  assert.deepEqual(free.map((c) => c.id), [2, 3]);
  assert.deepEqual(missingFor(free, { from: "2026-11-01", to: "2026-11-30" }).map((c) => c.id), [2]);
  const sum = statementSummary(rows);
  assert.deepEqual([sum.total, sum.eslesti, sum.yok, sum.yoksay, sum.pos, sum.posAmount], [5, 1, 0, 1, 3, 10650]);
  assert.deepEqual(filterRows(rows, "pos").length, 3);
  assert.deepEqual(filterRows(rows, "hepsi").length, 5);
  // Tedarikçi ekstresinde POS diye bir şey yok: açıklama ne derse desin eşleştirilir
  const sup = reconcilePool("tedarikci", [line("2026-11-03", 9800, "POS HAKEDIS")], [], SUPPLIER_MATCH);
  assert.equal(sup.rows[0].pos, false);
});

test("hesap kimliği ve havuz: banka adı sadeleşir, bütün banka hesapları tek havuz, tedarikçi kendi havuzunda", () => {
  assert.equal(accountName("  Garanti   TL "), "Garanti TL");
  assert.equal(bankScope("Garanti TL"), bankScope("GARANTİ  tl"));
  assert.notEqual(bankScope("Garanti TL"), bankScope("Garanti USD"));
  assert.equal(supplierScope(7, "sutas"), "tedarikci:kart:7");
  assert.equal(supplierScope(null, "sutas"), "tedarikci:ad:sutas");
  assert.equal(poolOf({ kind: "banka", scope: bankScope("Garanti TL") }), poolOf({ kind: "banka", scope: bankScope("Akbank") }));
  assert.equal(poolOf({ kind: "tedarikci", scope: "tedarikci:kart:7" }), "tedarikci:kart:7");
});

test("satırın düğmeleri ve kararın denetimi", () => {
  const r = (status: "eslesti" | "fark" | "yok" | "yoksay", o: { pos?: boolean; decision?: MatchLine["decision"]; amount?: number; basis?: "elle" | "tutar" | null } = {}) => ({
    status,
    pos: o.pos ?? false,
    basis: o.basis ?? null,
    line: { decision: o.decision ?? null, amount: o.amount ?? -100 },
  });
  assert.deepEqual(lineActions("banka", r("yok")), ["eslestir", "yoksay"]);
  // Bankada eşleşmeyen giriş POS hakedişi sayılabilir; tedarikçide hiç
  assert.deepEqual(lineActions("banka", r("yok", { amount: 500 })), ["eslestir", "yoksay", "pos"]);
  assert.deepEqual(lineActions("tedarikci", r("yok", { amount: 500 })), ["eslestir", "yoksay"]);
  assert.deepEqual(lineActions("banka", r("eslesti", { basis: "tutar" })), ["eslestir", "ayir"]);
  assert.deepEqual(lineActions("banka", r("eslesti", { decision: "elle", basis: "elle" })), ["eslestir", "geri-al"]);
  assert.deepEqual(lineActions("banka", r("yok", { pos: true, amount: 500 })), ["ayir"]);
  assert.deepEqual(lineActions("banka", r("yok", { pos: true, decision: "pos", amount: 500 })), ["geri-al"]);
  assert.deepEqual(lineActions("banka", r("yoksay", { decision: "yoksay" })), ["geri-al"]);
  assert.deepEqual(lineActions("banka", r("yok", { decision: "ayir" })), ["eslestir", "yoksay", "geri-al"]);

  assert.equal(decisionProblem("banka", "yoksay", { amount: -10 }), null);
  assert.equal(decisionProblem("banka", null, { amount: -10 }), null);
  assert.match(decisionProblem("tedarikci", "pos", { amount: 10 }) ?? "", /yalnız banka/);
  assert.match(decisionProblem("banka", "elle", { amount: -10 }, null) ?? "", /bulunamadı/);
  assert.match(decisionProblem("banka", "elle", { amount: 10 }, { amount: -10 }) ?? "", /giren para/);
  assert.match(decisionProblem("tedarikci", "elle", { amount: 10 }, { amount: -10 }) ?? "", /Fatura bir ödemeyle/);
  assert.equal(decisionProblem("banka", "elle", { amount: -10 }, { amount: -12 }), null);
});

// ---------------------------------------------------------------- Kurallar: yetki, menü, saklama

const read = (p: string) => readFileSync(p, "utf8");

test("ekran yalnız yöneticinin: personel açamaz, sayfa ve her eylem requireAdmin ile başlar", () => {
  assert.equal(canOpen("staff", "/panel/mutabakat"), false);
  assert.equal(canOpen("admin", "/panel/mutabakat"), true);
  assert.match(read("src/app/panel/mutabakat/page.tsx"), /await requireAdmin\(\)/);
  const actions = read("src/server/actions/mutabakat.ts");
  const exported = actions.match(/export async function \w+/g) ?? [];
  assert.ok(exported.length >= 5, "eylemler bulunamadı");
  assert.equal((actions.match(/await requireAdmin\(\)/g) ?? []).length, exported.length, "her eylem requireAdmin ile başlamalı");
  assert.match(read("src/server/mutabakat/store.ts"), /^import "server-only";/);
  assert.match(read("src/server/mutabakat/load.ts"), /^import "server-only";/);
});

test("KVKK: dosya saklanmaz, satırlar 90 gün sonra günlük işte silinir", () => {
  assert.equal(KEEP_DAYS, 90);
  assert.equal(expiryOf("2026-11-01"), "2027-01-30");
  const actions = read("src/server/actions/mutabakat.ts");
  // Dosya yalnız bellekte okunur: depoya ya da fotoğraf tablosuna yazan çağrı yok
  assert.doesNotMatch(actions + read("src/server/mutabakat/store.ts"), /putObject|savePhoto|s\.photos|writeFile/);
  assert.match(read("src/app/api/cron/gunluk/route.ts"), /purgeExpiredStatements\(/);
  const schema = read("src/server/db/schema.ts");
  assert.match(schema, /export const reconLines = pgTable\(/);
  assert.match(schema, /references\(\(\) => reconStatements\.id, \{ onDelete: "cascade" \}\)/);
});
