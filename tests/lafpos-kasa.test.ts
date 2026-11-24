// Kasa raporu LafPOS'la uzlaşır (denetim B09: E-09, E-35, E-36, E-40; LafPOS planı G6, G7, G8, G11), saf kurallar:
// raporun LafPOS'tan farklı yazılanları ve metinlere girişi, "Gün içinde çıkan"ın iki kaynağı (panelin Kasadan
// çıkanlar'ı kaynak, LafPOS'un harcama + teslimi bilgi), kapalı gün kanıtı, kasa e-postasının anahtarı, raporsuz LafPOS
// gününün ay satırı, geç rapor ve fotoğraf kaldırmanın kanıtı, kartla bahşiş ve cari tahsilatı. Veritabanında:
// tests/lafpos-kasa-db.test.ts.
// Çalıştırma: npx tsx --test tests/lafpos-kasa.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { missingSentence, tillMonths, type TillRow } from "../src/lib/cash-month";
import { photoKindRefusal } from "../src/lib/cash-out-requests";
import { cashEmailKey, cashLogKey, cashReportText, computeCash, whatsappText, withCardExtra, type CashReportFields } from "../src/lib/cash-report";
import { closedEvidenceText, EMPTY_EVIDENCE, hasPanelEvidence } from "../src/lib/closed-days";
import { posZSchema, type PosDayZ } from "../src/lib/lafpos/day";
import { lafposDiffs, lafposDiffsLine, lafposDiffText } from "../src/lib/lafpos/diffs";
import { lafposCardExtra, lafposDayOf, lafposHandedGap, lafposOutsCheck, lafposPrefill, lafposSummary } from "../src/lib/lafpos/prefill";
import { okcReconcile } from "../src/lib/okc-z";
import { prefillPlan } from "../src/lib/photo-read/kasa";
import { renderCashReport } from "../src/server/notify/cash-report-template";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
/** ₺ ve gün-ay arasındaki bölünmez boşluk düz boşluğa */
const plain = (s: string) => s.replace(/ /g, " ");

/**
 * Belgenin örneği (docs/LAFPOS.md › Kasa alanlarının eşlemesi): açılış 1.500, nakit 12.000, giren 1.300, harcama 450,
 * gün ortasında teslim 5.000; LafPOS 9.350 sayar
 */
const Z: PosDayZ = posZSchema.parse({
  zNo: 14,
  receipts: 63,
  zTotal: 20_000,
  cash: 12_000,
  card: 8_000,
  mealCard: 0,
  online: 0,
  other: 0,
  offRevenue: 0,
  discounts: 0,
  openingCash: 1_500,
  cashOut: 450,
  countedCash: 9_350,
  handedOver: 5_000,
  cashDiff: 0,
  cashIn: 1_300,
  expectedCash: 9_350,
});
const DAY = lafposDayOf(Z, "2026-11-12T00:30:00.000Z");

/** Personelin LafPOS'tan doldurup gönderdiği rapor (Teslim Kasadan çıkanlar'da) */
const report = (o: Partial<CashReportFields> = {}): CashReportFields => ({
  date: "2026-11-11",
  zNo: "14",
  receipts: 63,
  zTotal: 20_000,
  cash: 12_000,
  card: 8_000,
  mealCard: 0,
  online: 0,
  other: 0,
  openingCash: 1_500,
  cashIn: 1_300,
  cashOut: 5_450,
  cashOutNote: null,
  countedCash: 9_350,
  handedOver: 0,
  bankPos: null,
  offRevenue: 0,
  discounts: 0,
  note: null,
  ...o,
});

test("E-40: kasa e-postasının anahtarı rapor satırına özgü; silinip aynı gün yeniden girilen rapor yeni anahtarla gider", () => {
  assert.equal(cashEmailKey({ id: 41, revision: 1 }), "cash-41-r1");
  assert.equal(cashEmailKey({ id: 41, revision: 2 }), "cash-41-r2");
  // Silinen 25 Ekim raporu (satır 41, r1) ve aynı gün yeniden girilen (satır 57, yine r1)
  assert.notEqual(cashEmailKey({ id: 57, revision: 1 }), cashEmailKey({ id: 41, revision: 1 }));
  // Varsayılan anahtar bununla; geç raporun onayı kendi anahtarını verir, işlem geçmişinin anahtarı şubenin gününe göre
  // (cashLogKey; Tuzla'nınki bugünkü gibi, 21 Kasım denetimi #2)
  const email = read("src/server/cash/report-email.ts");
  assert.match(email, /idempotencyKey: o\.idempotencyKey \?\? cashEmailKey\(row\)/);
  assert.doesNotMatch(email, /`cash-\$\{row\.date\}-r\$\{row\.revision\}`/);
  assert.match(email, /key: cashLogKey\(row\)/);
  assert.equal(cashLogKey({ date: "2026-10-25", revision: 1, branchId: "tuzla" }), "cash:2026-10-25:r1");
});

test("E-09: LafPOS'tan farklı yazılan: sayılan nakit 9.350 (LafPOS 9.000); aynı yazılan rapor fark vermez", () => {
  assert.deepEqual(lafposDiffs(report(), DAY), []);
  const z9000 = lafposDayOf({ ...Z, countedCash: 9_000 }, DAY.receivedAt);
  const diffs = lafposDiffs(report(), z9000);
  assert.deepEqual(diffs.map((d) => d.field), ["countedCash"]);
  assert.equal(plain(lafposDiffText(diffs[0])), "Sayılan nakit 9.350 ₺ (LafPOS'ta 9.000 ₺)");
  assert.equal(plain(lafposDiffsLine(diffs)!), "LafPOS'tan farklı yazılan: Sayılan nakit 9.350 ₺ (LafPOS'ta 9.000 ₺)");
  // Z alanları alan alan; boş bırakılan isteğe bağlı alan (Z no, fiş, ödenmez, indirim) farklı sayılmaz
  const z = lafposDiffs(report({ cash: 11_900, zNo: "15", receipts: null, offRevenue: null, discounts: null }), DAY);
  assert.deepEqual(
    z.map((d) => [d.field, d.saved, d.lafpos]),
    [
      ["zNo", "15", "14"],
      ["cash", 11_900, 12_000],
    ],
  );
  // LafPOS'ta sayım yoksa sayılan karşılaştırılmaz
  assert.deepEqual(lafposDiffs(report({ countedCash: 9_000 }), lafposDayOf({ ...Z, countedCash: null }, DAY.receivedAt)), []);
});

test("E-09: teslim sayımdan sonra yazıldıysa (Teslim edilen) aynı para iki biçimde: çıkan + teslim ve devir karşılaştırılır", () => {
  // Personel: harcama 450 gün içinde, 5.000'i sayımdan sonra teslim; sayılan 14.350, devir 9.350 → LafPOS'la aynı
  assert.deepEqual(lafposDiffs(report({ cashOut: 450, handedOver: 5_000, countedCash: 14_350 }), DAY), []);
  assert.equal(computeCash(report({ cashOut: 450, handedOver: 5_000, countedCash: 14_350 })).cashDiff, computeCash(report()).cashDiff);
  // Devir farklı: "Ertesi güne devir (sayılan − teslim) 9.000 ₺ (LafPOS'ta 9.350 ₺)"
  const d = lafposDiffs(report({ cashOut: 450, handedOver: 5_000, countedCash: 14_000 }), DAY);
  assert.deepEqual(
    d.map((x) => [x.field, x.saved, x.lafpos]),
    [["carry", 9_000, 9_350]],
  );
  // Teslim çıkanda yok, Teslim edilen de 0: çıkan farkı
  assert.deepEqual(
    lafposDiffs(report({ cashOut: 450 }), DAY).map((x) => [x.field, x.saved, x.lafpos]),
    [["cashOut", 450, 5_450]],
  );
});

test("E-35: LafPOS'un teslimi panelde yoksa formun alanı 450 kalır, öneri 5.450; teslim Kasadan çıkanlar'a eklenince uzlaşır", () => {
  // Panelin Kasadan çıkanlar'ı 450 (fiş): alan kendiliğinden 450, LafPOS'ta 5.450 (birleşik)
  const plan = prefillPlan(lafposPrefill(Z), { cashOut: "450", countedCash: "" });
  assert.deepEqual(plan.differs.map((d) => [d.field, d.photo]), [["cashOut", 5_450]]);
  assert.deepEqual(plan.fill.map((f) => [f.field, f.text]), [["countedCash", "9350"]]);
  // Bilgi satırı: ne yapılacağı söylenir (öneriyi almak fişsiz çıkış yapardı)
  const note = lafposOutsCheck(DAY.till, 450)!;
  assert.equal(note.level, "info");
  assert.equal(
    plain(note.text),
    "LafPOS'ta harcama 450 ₺ + teslim 5.000 ₺; Kasadan çıkanlar'da 450 ₺. Teslimi Kasadan çıkanlar'a \"Teslim\" olarak ekleyin; Gün içinde çıkan kendiliğinden 5.450 ₺ olur.",
  );
  assert.equal(lafposOutsCheck(DAY.till, 5_450), null, "teslim eklendi: uzlaştı");
  assert.match(plain(lafposOutsCheck(DAY.till, 0)!.text), /Kasadan çıkanlar'a bir şey girilmedi\. 5\.450 ₺ LafPOS'ta var, panelde yok/);
  assert.match(plain(lafposOutsCheck(DAY.till, 6_000)!.text), /Panelde 550 ₺ fazla/);
  // Teslim eklenince kayıtlı raporun farkı 0 (sahte "5.000 ₺ eksik" yok)
  assert.equal(computeCash(report()).cashDiff, 0);
  assert.equal(computeCash(report({ cashOut: 450 })).cashDiff, -5_000, "öneri alınmadan gönderilirse (teslim girilmedi) 5.000 eksik görünür");
  // Geç rapor ve düzeltme kartı: fark LafPOS'taki teslim kadarsa fişsiz değil
  assert.deepEqual(lafposHandedGap(5_450, 450, DAY.till), { handed: 5_000, rest: 0 });
  assert.equal(lafposHandedGap(5_450, 450, null), null, "ModPOS gününde (LafPOS yok) fişsiz kalır");
  // Panelde hiç satır yok: 5.000 LafPOS'taki teslim, 450 fişsiz
  assert.deepEqual(lafposHandedGap(5_450, 0, DAY.till), { handed: 5_000, rest: 450 });
  assert.equal(lafposHandedGap(3_450, 450, DAY.till), null, "fark teslimden azsa ayrıştırılmaz");
  assert.equal(lafposHandedGap(450, 450, { spent: 450, handed: 0 }), null);
  // Teslimin bir kısmı panelde "Teslim" (inceleme D3): 15:00'te 3.000 girildi, 20:00'deki 2.000 girilmedi. Panelde 450
  // fiş + 3.000 Teslim = 3.450; rapor LafPOS'tan 5.450: fark 2.000 girilmemiş teslim, fişsiz yok
  assert.deepEqual(lafposHandedGap(5_450, 3_450, DAY.till, 3_000), { handed: 2_000, rest: 0 });
  assert.deepEqual(lafposHandedGap(5_950, 3_450, DAY.till, 3_000), { handed: 2_000, rest: 500 }, "kalan yine fişsiz");
  assert.equal(lafposHandedGap(5_450, 5_450, DAY.till, 5_000), null, "teslimin tamamı girildi: fark yok");
  assert.equal(lafposHandedGap(5_950, 5_450, DAY.till, 5_000), null, "teslimin tamamı girildi: fazlası fişsiz");
});

test("E-36: LafPOS'un satışlı gün sonu kapalı gün kanıtı (kırmızı satır, tutar yok); satışsız gün sonu yalnız uyarı", () => {
  const sold = { ...EMPTY_EVIDENCE, lafpos: { zNo: 14, receipts: 63, zTotal: 11_800 } };
  assert.equal(hasPanelEvidence(sold), true);
  assert.deepEqual(closedEvidenceText(sold).red, ["LafPOS'ta Z 14 · 63 fiş"]);
  assert.doesNotMatch(closedEvidenceText(sold).red.join(" "), /11\.800|₺/, "tutar yazılmaz");
  const empty = { ...EMPTY_EVIDENCE, lafpos: { zNo: 15, receipts: 0, zTotal: 0 } };
  assert.equal(hasPanelEvidence(empty), false);
  assert.deepEqual(closedEvidenceText(empty), { red: [], warn: ["LafPOS'ta Z 15 alınmış, satış yok"], info: [] });
  // Geçiş günü boşken ya da önceki günde kanıt hiç gelmez (null): bugünkü gibi
  assert.equal(hasPanelEvidence({ ...EMPTY_EVIDENCE, lafpos: null }), false);
  assert.deepEqual(closedEvidenceText({ ...EMPTY_EVIDENCE, lafpos: null }), { red: [], warn: [], info: [] });
  // Sunucu: kanıt yalnız LafPOS gününde okunur (şube şube; şube verilmezse LafPOS'un şubesinin günü); gün sonu yazımı
  // kapalı işareti yalnız satışlı LafPOS gününde kaldırır (geçiş günü gün sonunun şubesinin kasasından)
  const server = read("src/server/closed-days.ts");
  assert.match(server, /if \(!isLafposDay\(date, branchSwitchDay\(readLafposSwitchDay\(setting\?\.value\), branch\)\)\) return null;/);
  assert.match(
    server,
    /if \(z\.receipts <= 0 && z\.zTotal <= 0\) return;\n\s+const \[setting\][\s\S]*?if \(!isLafposDay\(date, branchSwitchDay\(readLafposSwitchDay\(setting\?\.value\), branchId\)\)\) return;\n\s+await lockClosedDay\(tx, date\);/,
  );
  const ingest = read("src/server/lafpos/ingest.ts");
  assert.match(ingest, /const soldSince = stored && \(stored\.z\.receipts > 0 \|\| stored\.z\.zTotal > 0\) \? stored\.receivedAt : null;/);
  assert.match(ingest, /await onLafposDaySaved\(tx, day\.date, day\.z, now, soldSince\);/);
});

test("G6: raporsuz LafPOS günü ayın rakamına girer, gün yine 'rapor yok'; rapor varsa rapor kazanır", () => {
  const r = (date: string, o: Partial<TillRow> = {}): TillRow => ({ date, zTotal: 10_000, card: 7_000, mealCard: 0, discounts: null, offRevenue: null, ...o });
  const rows: TillRow[] = [
    r("2026-11-01"),
    r("2026-11-02"),
    r("2026-11-02", { zTotal: 99_999, source: "lafpos" }),
    r("2026-11-03", { zTotal: 6_000, card: 3_000, discounts: 120, source: "lafpos" }),
  ];
  const [m] = tillMonths(rows, "2026-11-03", "2026-11-01");
  assert.equal(m.reported, 2, "yalnız kasa raporları");
  assert.equal(m.posRevenue, 26_000, "LafPOS'un 3 Kasım'ı sayılır, 2 Kasım'ınki değil (rapor kazanır)");
  assert.equal(m.openDays, 3);
  assert.equal(m.discounts, 120);
  assert.deepEqual(m.missing, ["2026-11-03"], "rapor yine eksik");
  assert.deepEqual(m.lafpos, ["2026-11-03"]);
  assert.equal(plain(missingSentence(m)), "1 gün rapor yok: 3 Kasım. Ciro ve açık gün bu günlerde LafPOS'un gün sonundan sayıldı.");
  // Geçiş günü boşken yükleyici LafPOS satırı vermez: sonuç bugünküyle aynı (lafpos alanı yok)
  const [plainMonth] = tillMonths([r("2026-11-01"), r("2026-11-02")], "2026-11-03", "2026-11-01");
  assert.equal("lafpos" in plainMonth, false);
  assert.equal(plain(missingSentence(plainMonth)), "1 gün rapor yok: 3 Kasım. O günler açıksanız ciro ve açık gün eksik kalır.");
  // Yükleyici: geçiş gününden itibaren, raporu olan günü rapora bırakır; dataset'in LafPOS satış sınırları yalnız raporlara bakar
  const loader = read("src/server/data/cash-reports.ts");
  assert.match(loader, /if \(switchDay === null \|\| \(to !== undefined && to < switchDay\)\) return \[\];/);
  // ModPOS föyü (ay rakamına yedek) LafPOS'tan da sonra gelir: rapor > LafPOS > ModPOS (docs/MODPOS-API.md › Ay rakamına yedek)
  // Öncelik şube içinde (tillKey: şube, gün): "Tümü"de bir şubenin raporu öteki şubenin aynı günkü yedek satırını düşürmez
  assert.match(loader, /\.\.\.lafpos\.filter\(\(r\) => !have\.has\(tillKey\(r\)\)\),\n\s+\.\.\.modpos\.filter\(\(r\) => !taken\.has\(tillKey\(r\)\) && r\.date >= \(runFrom\.get\(r\.branchId \?\? ""\) \?\? ""\)\),/);
  const dataset = read("src/server/data/dataset.ts");
  // Rapor sınaması tek yerden (isReportRow): üçüncü kaynak (ModPOS) rapor sanılmaz
  assert.match(dataset, /const reportRows = till\.filter\(isReportRow\);/);
  // LafPOS'un günleriyle yalnız LafPOS'un şubesinin raporları (denetim 21 Kasım #5: Marina'nın raporu Tuzla'nın LafPOS'unu beklemez).
  // Birleşme mergeSales'te: hem görünümün satışı hem su litresinin "Tümü" satışı aynı kuralı kullanır (#4)
  assert.match(dataset, /const reportRows = input\.till\.filter\(\(r\) => isReportRow\(r\) && isLafposBranch\(r\.branchId\)\);/);
  assert.match(dataset, /lastTillDay: reportRows\.at\(-1\)\?\.date \?\? null,/);
});

test("G6: kapalı işaretli gün yalnız satışlı LafPOS gün sonuyla 'rapor yok' olur; satışsız Z kapalı kalır", () => {
  const r = (date: string, o: Partial<TillRow> = {}): TillRow => ({ date, zTotal: 10_000, card: 7_000, mealCard: 0, discounts: null, offRevenue: null, ...o });
  // 2 Kasım: kapalı işaretli, LafPOS yanlışlıkla açılmış (Z 15, satış yok)
  const idle = tillMonths([r("2026-11-01"), r("2026-11-02", { zTotal: 0, card: 0, receipts: 0, source: "lafpos" }), r("2026-11-03")], "2026-11-03", "2026-11-01", [], ["2026-11-02"]);
  assert.deepEqual(idle[0].missing, []);
  assert.deepEqual(idle[0].closed, ["2026-11-02"]);
  assert.equal(plain(missingSentence(idle[0])), "1 gün kapalı işaretli: 2 Kasım.");
  // Satışlı LafPOS günü kapalı işareti geçersiz kılar (fiş ya da Z toplamı): gün eksik, ciro LafPOS'tan
  for (const sold of [{ zTotal: 4_000, receipts: 12 }, { zTotal: 0, receipts: 3 }]) {
    const [m] = tillMonths([r("2026-11-01"), r("2026-11-02", { ...sold, card: 0, source: "lafpos" }), r("2026-11-03")], "2026-11-03", "2026-11-01", [], ["2026-11-02"]);
    assert.deepEqual(m.missing, ["2026-11-02"]);
    assert.deepEqual(m.closed, []);
  }
  // Eksik günlerin sayısı yalnız eksik günlerden: kapalı satışsız LafPOS günü "N günün cirosu LafPOS'tan" sayısına girmez
  const mixed = tillMonths([r("2026-11-01"), r("2026-11-02", { zTotal: 0, card: 0, receipts: 0, source: "lafpos" })], "2026-11-03", "2026-11-01", [], ["2026-11-02"]);
  assert.equal(plain(missingSentence(mixed[0])), "1 gün rapor yok: 3 Kasım. O günler açıksanız ciro ve açık gün eksik kalır. 1 gün kapalı işaretli: 2 Kasım.");
  // Yükleyici fiş sayısını yedek satıra taşır
  const loader = read("src/server/data/cash-reports.ts");
  assert.match(loader, /offRevenue: d\.offRevenue,\n\s+receipts: d\.receipts,/);
  assert.match(loader, /payments: Math\.round\(\(d\.cash \+ d\.card \+ d\.mealCard \+ d\.online \+ d\.other\) \* 100\) \/ 100,\n\s+source: "lafpos" as const,/);
});

test("G8: fotoğraf kaldırma günün kanıtına göre: LafPOS gününde ModPOS Z fotoğrafı kanıt değil; gün sonu gelmediyse tek yazarkasa Z'si kanıt", () => {
  assert.match(photoKindRefusal("kasa-z", { zCount: 1, okcCount: 0, okcFigures: false })!, /tek Z/);
  assert.equal(photoKindRefusal("kasa-z", { zCount: 1, okcCount: 0, okcFigures: false, evidence: "lafpos" }), null);
  assert.equal(photoKindRefusal("kasa-z", { zCount: 1, okcCount: 1, okcFigures: false, evidence: "okc-z" }), null);
  assert.equal(photoKindRefusal("kasa-okc", { zCount: 0, okcCount: 1, okcFigures: false, evidence: "modpos-z" }), null);
  assert.ok(photoKindRefusal("kasa-okc", { zCount: 0, okcCount: 1, okcFigures: false, evidence: "okc-z" }));
  assert.equal(photoKindRefusal("kasa-okc", { zCount: 0, okcCount: 2, okcFigures: false, evidence: "okc-z" }), null);
  // Geç rapor: istemci ve sunucu aynı kural
  const late = read("src/server/cash/late.ts");
  assert.match(late, /if \(evidence === "modpos-z" && !photos\.some\(\(p\) => p\.kind === "kasa-z"\)\) throw new UserError\(CASH_REQUEST_TEXT\.lateZPhoto\);/);
  assert.match(late, /if \(evidence === "okc-z" && !photos\.some\(\(p\) => p\.kind === "kasa-okc"\)\) throw new UserError\(CASH_REQUEST_TEXT\.lateOkcPhoto\);/);
  const form = read("src/app/panel/kasa/cash-form.tsx");
  assert.match(form, /if \(!lafposMode && !photos\.some\(\(p\) => p\.kind === "kasa-z"\)\)/);
  assert.match(form, /if \(lafposMode && !lafpos && !photos\.some\(\(p\) => p\.kind === "kasa-okc"\)\)/);
});

test("G7: LafPOS gününde form açılışta LafPOS'tan dolar (kaydetmez), Z bölümü LafPOS'un, ModPOS Z fotoğrafı yok", () => {
  const form = read("src/app/panel/kasa/cash-form.tsx");
  assert.match(
    form,
    /const \[opening\] = useState\(\(\) => withLafpos\(initialValues\(report \?\? initial, carry, cashOuts\), report === null \? lafpos : null, initial === null \? "fill" : "compare"\)\);/,
  );
  const fn = form.slice(form.indexOf("function withLafpos("), form.indexOf("interface PosPrompt"));
  assert.match(fn, /prefillPlan\(lafpos\.prefill, /);
  assert.doesNotMatch(fn, /submitCashReport|start\(/, "kaydetmez");
  // Yazılmış değerlerle açılan form (Düzenle, öneri, Düzeltip onayla) yalnız karşılaştırır: hiçbir alan kendiliğinden değişmez
  assert.match(fn, /if \(mode === "compare"\) \{[\s\S]*?return \{ values: v, marks: /);
  assert.match(form, /withLafpos\(initialValues\(report, carry, cashOuts\), lafpos, "compare"\)/);
  assert.match(form, /title=\{lafposMode \? "LafPOS gün sonu \(Z\)" : "ModPOS Z raporu"\}/);
  // Fiş fotoğrafları kartında LafPOS gününde ModPOS Z bölümü yok; gün sonu geldiyse yazarkasa fişi Gün sonu fotoğrafı kartında
  assert.match(form, /\[\.\.\.\(lafposMode \? \[\] : \(\["kasa-z"\] as const\)\), \.\.\.\(dayPhotoCard \? \[\] : \(\["kasa-okc"\] as const\)\)\]/);
  // Fişler varken "Gün içinde çıkan"a LafPOS'takini yazdırmaz (panelin Kasadan çıkanlar'ı kaynak, E-35)
  assert.match(form, /m\.suggest && !\(k === "cashOut" && m\.suggest\.from === "lafpos" && cashOuts\.length\)/);
});

test("Metinler: LafPOS gününde Z bölümü ve 'LafPOS'tan farklı yazılan'; geçiş günü boşken metin bugünkü gibi", () => {
  const f = { ...report({ countedCash: 9_350 }), okcOutside: null };
  const diffs = lafposDiffs(f, lafposDayOf({ ...Z, countedCash: 9_000 }, DAY.receivedAt));
  const base = { by: "Ayşe" };
  const today = whatsappText(f, base);
  assert.match(today, /\*ModPOS Z raporu\*/);
  assert.doesNotMatch(today, /LafPOS/);
  const wa = plain(whatsappText(f, { ...base, kasa: "LafPOS", lafposDiffs: diffs }));
  assert.match(wa, /\*LafPOS gün sonu \(Z\)\*/);
  assert.match(wa, /⚠️ LafPOS'tan farklı yazılan: Sayılan nakit 9\.350 ₺ \(LafPOS'ta 9\.000 ₺\)/);
  assert.match(plain(cashReportText(f, { ...base, kasa: "LafPOS", lafposDiffs: diffs }, "admin")), /LafPOS'tan farklı yazılan: Sayılan nakit 9\.350 ₺/);
  const mail = renderCashReport(f, { ...base, revision: 1, submittedAt: new Date("2026-11-11T20:30:00Z"), kasa: "LafPOS", lafposDiffs: diffs });
  assert.match(plain(mail.html), /LafPOS&#39;tan farklı yazılan: Sayılan nakit 9\.350 ₺ \(LafPOS&#39;ta 9\.000 ₺\)/);
  assert.match(plain(mail.html), /LafPOS gün sonu \(Z\)/);
  assert.match(plain(mail.text), /LafPOS'tan farklı yazılan/);
  const modpos = renderCashReport(f, { ...base, revision: 1, submittedAt: new Date("2026-11-11T20:30:00Z") });
  assert.match(modpos.html, /ModPOS Z raporu/);
  assert.doesNotMatch(modpos.html, /LafPOS/);
});

test("G11: LafPOS'un kartla bahşişi ve cari tahsilatı kart farkından her okurda düşer; tutar yalnız yöneticinin metninde", () => {
  const z = posZSchema.parse({ ...Z, cardTips: 120, cardCollections: 400 });
  assert.equal(lafposCardExtra(z), 520);
  assert.equal(lafposCardExtra(Z), 0, "eski gövde");
  assert.equal(lafposDayOf(z, DAY.receivedAt).cardExtra, 520);
  const f = report({ bankPos: 8_520 });
  assert.equal(computeCash(f).cardDiff, 520);
  assert.equal(computeCash(withCardExtra(f, 520)).cardDiff, 0);
  assert.equal(withCardExtra(f, 0), f, "LafPOS'ta yoksa rapor olduğu gibi");
  const okc = { ...f, okcTotal: 20_520, okcCash: 12_000, okcCard: 8_520, okcZNo: "88" };
  assert.equal(okcReconcile(okc, "staff")[0].tone, "warn");
  const staff = okcReconcile(withCardExtra(okc, 520), "staff")[0];
  assert.equal(staff.tone, "good");
  assert.doesNotMatch(staff.text, /520/, "personelde tutar yok");
  assert.match(plain(okcReconcile(withCardExtra(okc, 520), "admin")[0].text), /kartla bahşiş ve cari tahsilatı \(520 ₺\) düşüldü/);
  // Personelin formu, kayıtlı görünümü ve WhatsApp'ı aynı günün özetini alır (denetim incelemesi D2/U2): personel
  // ekranında sahte kart farkı, WhatsApp'ta "aynı" olmaz
  const page = read("src/app/panel/kasa/page.tsx");
  assert.doesNotMatch(page, /lafposForStaff/);
  assert.equal(page.match(/lafpos=\{lafposState\.day\}/g)?.length, 2, "kasa formu ve geç rapor");
  // WhatsApp aynı özetle (LafPOS'un otomatik gününde personelden yalnız fotoğraf farkı süzülür: staffPhotoDiffs)
  assert.match(page, /const extras = extrasFrom\(photoInfo, outs, report, lafposState\);[\s\S]*\.\.\.extras,/, "WhatsApp aynı özetle");
  // WhatsApp metni de (personel): kart aynı, tutar yok, düşüldüğü yazar
  const wa = whatsappText(okc, { by: "Ayşe", kasa: "LafPOS", cardExtra: 520 });
  // LafPOS gününde karşılaştırma LafPOS'un adıyla (denetim E-39)
  assert.match(wa, /✅ Kart LafPOS ile aynı \(bahşiş \/ cari tahsilatı düşüldü\)/);
  assert.doesNotMatch(plain(wa), /(?<![\d.])520 ₺/, "kartla bahşiş ve cari tahsilatının tutarı yok (8.520 yazarkasa kartı)");
});

test("G11: personelin formdaki kart sonucu WhatsApp'taki sonuçla aynı (yalnız Banka POS; inceleme D2/U2/U3)", () => {
  const day = lafposDayOf(posZSchema.parse({ ...Z, cardTips: 150 }), DAY.receivedAt);
  // Personelin gönderdiği: kart LafPOS'tan 8.000, banka POS 8.150 (bahşiş 150)
  const f = report({ bankPos: 8_150 });
  // Form (okc-card.tsx): modpos.cardExtra = lafpos.cardExtra; kayıtlı görünüm (CashBreakdown) withCardExtra
  const form = okcReconcile({ ...f, cardExtra: day.cardExtra }, "staff");
  assert.equal(form[0].tone, "good");
  assert.match(form[0].text, /Kart: banka pos ile ModPOS aynı\. LafPOS'taki kartla bahşiş ve cari tahsilatı düşüldü\./);
  assert.equal(computeCash(withCardExtra(f, day.cardExtra)).cardDiff, 0, "kayıtlı görünümün farkı");
  const wa = plain(whatsappText(f, { by: "Ayşe", kasa: "LafPOS", cardExtra: day.cardExtra }));
  assert.match(wa, /\*Kart\*\nBanka POS: 8\.150 ₺ ✅ LafPOS ile aynı \(bahşiş \/ cari tahsilatı düşüldü\)/);
  assert.doesNotMatch(wa, /(?<![\d.])150 ₺/, "personelin metninde tutar yok");
  // Yöneticinin e-postası: satır tutarıyla, fark yok; metin sürümü de söyler
  const mail = renderCashReport(f, { by: "Ayşe", revision: 1, submittedAt: new Date("2026-11-11T20:00:00Z"), kasa: "LafPOS", cardExtra: day.cardExtra });
  const html = plain(mail.html);
  assert.match(html, /− LafPOS kartla bahşiş \+ cari tahsilatı[\s\S]{0,400}150 ₺/);
  assert.match(html, /Fark[\s\S]{0,400}Yok/);
  assert.match(plain(mail.text), /Banka POS: 8\.150 ₺ ✅ LafPOS ile aynı \(LafPOS kartla bahşiş \+ cari tahsilatı 150 ₺ düşüldü\)/);
  // Kayıtlı görünümün satırı: yöneticiye tutar, personele "düşüldü"
  const summary = read("src/app/panel/kasa/cash-summary.tsx");
  assert.match(summary, /<Line label=\{CARD_EXTRA_LABEL\} value=\{audience === "admin" \? money\(cardExtra\) : "düşüldü"\} \/>/);
  // LafPOS'ta yoksa metin bugünkü gibi
  assert.equal(plain(whatsappText(report({ bankPos: 8_000 }), { by: "Ayşe" })).includes("düşüldü"), false);
});

test("inceleme U1/U4/U5/U6: geç rapor ve onay formu karşılaştırmayı doğru söyler; Girilmemiş günler LafPOS kanıtına bakar", () => {
  const form = read("src/app/panel/kasa/cash-form.tsx");
  // U1: günün satırları gelmeyen formda (geç rapor, Düzeltip onayla) "Kasadan çıkanlar'a bir şey girilmedi" denmez
  assert.match(form, /const lafposOuts = lafpos && mode === "report" \? lafposOutsCheck\(lafpos\.till, outsTotal\) : null;/);
  // U4: yazılmış değerlerle açılan form "doldu" demez; Düzeltip onayla'da yazan personel
  assert.match(form, /const \[lafposCompared, setLafposCompared\] = useState\(lafpos !== null && report === null && initial !== null\);/);
  assert.match(form, /setLafposCompared\(lafpos !== null\);/, "Düzenle (ve öneri) karşılaştırır");
  assert.match(form, /"Yazılan rakamlar LafPOS'un gün sonuyla karşılaştırıldı: farklı olanlar turuncu, altında LafPOS'taki\."/);
  assert.match(form, /Önceki yazdıklarınız LafPOS'un gün sonuyla karşılaştırıldı, farklı olanlar turuncu/);
  assert.match(form, /review \? "staff" : "self",/);
  assert.doesNotMatch(form, /Personelin yazdığı değişmedi; farklı olanlar turuncu/);
  const plan = (fill: number, differs: number) => ({ fill: new Array(fill).fill(null), differs: new Array(differs).fill(null), missing: [] });
  assert.equal(lafposSummary(plan(0, 0), "staff"), "Personelin yazdıkları LafPOS'takiyle aynı.");
  assert.equal(lafposSummary(plan(0, 2), "staff"), "LafPOS'ta 2 alan personelin yazdığından farklı; turuncu olanlara bakın.");
  assert.equal(lafposSummary(plan(0, 2)), "LafPOS'ta 2 alan yazdığınızdan farklı; turuncu olanlara bakın.");
  // U5: gün sonu gelmeyen LafPOS gününde zorunlu Z no LafPOS'unki
  assert.match(form, /LafPOS gün sonu bölümündeki Z no'yu LafPOS › Kasa › Geçmiş günler'den yazın\./);
  assert.match(form, /"LafPOS'un Z no'su gerekli \(LafPOS › Kasa › Geçmiş günler\)"/);
  assert.doesNotMatch(form, /Z raporunun fotoğrafı ve Z no zorunlu\."\}/, "LafPOS notu yazarkasa Z no'suna yönlendirmez");
  // U6: LafPOS gün sonu gelen gün depo yokken de girilir; bekleyen raporda "0 fotoğraf" denmez
  const late = read("src/app/panel/kasa/late-report.tsx");
  assert.match(late, /const shown = storage \? days : days\.filter\(\(d\) => d\.lafpos\);/);
  assert.match(late, /LafPOS'un gün sonu gelen günlerde fotoğraf gerekmez, ötekilerde Z raporunun fotoğrafıyla/);
  assert.match(late, /"LafPOS gün sonuyla gönderildi; fotoğraf gerekmez"/);
  const loader = read("src/server/data/cash-late.ts");
  assert.match(loader, /\.map\(\(d\) => \(lafposDays\.has\(d\.date\) \? \{ \.\.\.d, lafpos: true as const \} : d\)\);/);
  assert.match(loader, /if \(switchDay === null \|\| to < switchDay\) return new Set\(\);/, "geçiş günü boşken hiç yok");
});
