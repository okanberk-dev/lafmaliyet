// Gün sonu kasa raporu: eksik / fazla hesabı, iş günü, WhatsApp metni ve bağlantısı, e-posta şablonu, alıcı adresleri
// (src/lib/cash-report.ts, src/server/notify/cash-report-template.ts) ve yetki kuralları.
// Çalıştırma: npx tsx --test tests/kasa-raporu.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  businessDate,
  carryCheck,
  carryChecks,
  carryDiffText,
  carryWarning,
  changeLine,
  changesText,
  computeCash,
  defaultCashRecipients,
  diffKind,
  diffText,
  historyOf,
  isLateEdit,
  LATE_REPORT_DAYS,
  lastRevision,
  lateCorrections,
  lateMissingDays,
  nextCheckOf,
  nextWarning,
  openingNeedsNote,
  parseEmails,
  reportSubject,
  revisionChanges,
  revisionDataOf,
  staffCanReport,
  staffDayEditable,
  staffLateDay,
  waPhone,
  whatsappLink,
  whatsappText,
  zNoOrder,
  type CashReportFields,
  type CashRevisionData,
} from "../src/lib/cash-report";
import { renderCashReport } from "../src/server/notify/cash-report-template";

/** Boşlukları (₺ önündeki bölünmez boşluk dahil) düz boşluğa çevirir */
const plain = (s: string) => s.replace(/ /g, " ");

const day: CashReportFields = {
  date: "2026-10-21",
  zNo: "1234",
  receipts: 87,
  zTotal: 12_450,
  cash: 3_200,
  card: 8_150,
  mealCard: 600,
  online: 500,
  other: 0,
  openingCash: 500,
  cashOut: 150,
  cashOutNote: "süt, buz",
  countedCash: 3_430,
  handedOver: 3_000,
  bankPos: 8_150,
  offRevenue: null,
  note: "Bir müşteri bozuk para eksik verdi",
};

test("kasa: olması gereken = açılış + nakit satış − gün içinde çıkan; fark sayılandan; devir teslimden sonra kalan", () => {
  const c = computeCash(day);
  assert.equal(c.expectedCash, 3_550);
  assert.equal(c.cashDiff, -120);
  assert.equal(c.kind, "short");
  assert.equal(c.carryOver, 430);
  assert.equal(c.paymentsTotal, 12_450);
  assert.equal(c.paymentsDiff, 0);
  assert.equal(c.cardDiff, 0);
  // Kuruşlu tutarlarda kayan nokta hatası yok
  assert.equal(computeCash({ ...day, openingCash: 0.1, cash: 0.2, cashOut: 0, countedCash: 0.3 }).cashDiff, 0);
  // Banka POS girilmediyse kart karşılaştırılmaz
  assert.equal(computeCash({ ...day, bankPos: null }).cardDiff, null);
  assert.equal(computeCash({ ...day, bankPos: 8_050 }).cardDiff, -100);
  assert.equal(computeCash({ ...day, mealCard: 650 }).paymentsDiff, 50);
});

test("fark: 1 ₺ altı tutuyor, eksik ve fazla metni", () => {
  assert.equal(diffKind(-0.5), "even");
  assert.equal(diffKind(-1), "short");
  assert.equal(diffKind(1), "over");
  assert.equal(plain(diffText(-120)), "120 ₺ eksik");
  assert.equal(plain(diffText(30.5)), "30,50 ₺ fazla");
  assert.equal(diffText(0.4), "Kasa tutuyor");
});

test("iş günü: gece 05:00'e kadar kapanan gün bir önceki güne yazılır; personel bugünü ve dünü girer", () => {
  // 22 Ekim 00:30 (Türkiye) → 21 Ekim
  assert.equal(businessDate(new Date("2026-10-21T21:30:00Z")), "2026-10-21");
  assert.equal(businessDate(new Date("2026-10-22T01:59:00Z")), "2026-10-21");
  // 22 Ekim 05:30 → 22 Ekim
  assert.equal(businessDate(new Date("2026-10-22T02:30:00Z")), "2026-10-22");
  const now = new Date("2026-10-22T18:00:00Z");
  assert.equal(staffCanReport("2026-10-22", now), true);
  assert.equal(staffCanReport("2026-10-21", now), true);
  assert.equal(staffCanReport("2026-10-20", now), false);
  assert.equal(staffCanReport("2026-10-23", now), false);
});

test("WhatsApp: numara wa.me biçimine, metin bağlantıda kodlu; numara yoksa sohbet seçici", () => {
  assert.equal(waPhone("0532 123 45 67"), "905321234567");
  assert.equal(waPhone("+90 (532) 123-45-67"), "905321234567");
  assert.equal(waPhone("5321234567"), "905321234567");
  assert.equal(waPhone("123"), null);
  assert.equal(waPhone(""), null);
  assert.equal(whatsappLink("a\nb ç", null), "https://wa.me/?text=a%0Ab%20%C3%A7");
  assert.equal(whatsappLink("x", "0532 123 45 67"), "https://wa.me/905321234567?text=x");
});

test("WhatsApp metni: ayrıntılı, farklar öne çıkar", () => {
  const t = plain(whatsappText(day, { by: "Zeynep" }));
  assert.match(t, /^\*L'Affogato · Gün sonu kasa raporu\*\n21 Ekim Çarşamba · Zeynep\nZ no: 1234 · 87 fiş/);
  assert.match(t, /Toplam satış: 12\.450 ₺\n• Nakit: 3\.200 ₺\n• Kredi \/ banka kartı: 8\.150 ₺\n• Yemek kartı: 600 ₺\n• Online: 500 ₺\n/);
  assert.doesNotMatch(t, /Diğer/, "sıfır olan ödeme türü yazılmaz");
  assert.match(t, /− Gün içinde çıkan: 150 ₺ \(süt, buz\)\n= Olması gereken: 3\.550 ₺\nSayılan: 3\.430 ₺\n🔴 \*120 ₺ EKSİK\*/);
  assert.match(t, /Teslim edilen: 3\.000 ₺ · Ertesi güne devir: 430 ₺/);
  assert.match(t, /Banka POS gün sonu: 8\.150 ₺ ✅ ModPOS ile aynı/);
  assert.match(t, /Not: Bir müşteri bozuk para eksik verdi$/);
  const off = plain(whatsappText({ ...day, mealCard: 650, countedCash: 3_550, bankPos: 8_050 }, { by: "Ali", revision: 2 }));
  assert.match(off, /\(güncellendi\)/);
  assert.match(off, /⚠️ Ödeme türleri toplamı \(12\.500 ₺\) Z toplamından 50 ₺ fazla/);
  assert.match(off, /✅ \*Kasa tutuyor\*/);
  assert.match(off, /⚠️ ModPOS'tan 100 ₺ az/);
});

test("e-posta: konu, sonuç, döküm; not kaçışlı, metin sürümü yıldızsız", () => {
  assert.equal(plain(reportSubject(day)), "Kasa raporu · 21 Ekim Çarşamba · 120 ₺ eksik");
  assert.equal(plain(reportSubject({ ...day, countedCash: 3_550 }, 2)), "Kasa raporu · 21 Ekim Çarşamba · kasa tutuyor (güncellendi)");
  const m = renderCashReport({ ...day, note: "<script>alert(1)</script>" }, { by: "Zeynep", revision: 1, submittedAt: new Date("2026-10-21T20:15:00Z") });
  assert.match(plain(m.html), /120 ₺ eksik/);
  assert.match(m.html, /23:15/, "saat Türkiye saatiyle");
  assert.match(m.html, /\/panel\/kasa\?gun=2026-10-21/);
  assert.doesNotMatch(m.html, /<script>/);
  assert.match(m.html, /&lt;script&gt;/);
  assert.doesNotMatch(m.text, /\*/);
  assert.match(plain(m.text), /120 ₺ EKSİK/);
});

test("fotoğraflı rapor: WhatsApp başta 📷 satırı ve fotoğraftan farklı yazılan; kasadan çıkanlar altında; adres yok", () => {
  const extras = {
    photos: { z: true, pos: true },
    photoDiffs: [{ field: "card" as const, label: "Kart", photo: 8_915, saved: 8_150, confidence: "high" as const, excused: false }],
    cashOuts: [
      { kind: "harcama" as const, amount: 112.5, store: "Migros", description: "süt, beyaz peynir", photo: true },
      { kind: "harcama" as const, amount: 37.5, store: null, description: "buz", photo: false },
      { kind: "teslim" as const, amount: 0, store: "patrona", description: null, photo: false },
    ],
  };
  const t = plain(whatsappText(day, { by: "Zeynep", ...extras }));
  assert.match(t, /Z no: 1234 · 87 fiş\n📷 Z ve POS fotoğrafı panelde\n⚠️ Fotoğraftan farklı yazılan: Kart \(fotoğrafta 8\.915 ₺\)\n/);
  assert.match(t, /− Gün içinde çıkan: 150 ₺ \(süt, buz\)\n  · Migros \(süt, beyaz peynir\) 112,50 ₺ 📷\n  · buz 37,50 ₺\n  · Teslim \(patrona\) 0 ₺\n= Olması gereken/);
  assert.match(plain(whatsappText(day, { by: "Zeynep", photos: { z: true, pos: false } })), /📷 Z fotoğrafı panelde/);
  assert.match(plain(whatsappText(day, { by: "Zeynep", photos: { z: false, pos: true } })), /📷 POS fotoğrafı panelde/);
  // Fotoğrafsız rapor eskisiyle aynı
  assert.equal(whatsappText(day, { by: "Zeynep", photos: { z: false, pos: false }, photoDiffs: [], cashOuts: [] }), whatsappText(day, { by: "Zeynep" }));
  // Altıdan fazla satır: kalanı tek satırda
  const many = Array.from({ length: 8 }, (_, i) => ({ kind: "harcama" as const, amount: 10, store: `Dükkân ${i + 1}`, description: null, photo: false }));
  const tm = plain(whatsappText({ ...day, cashOut: 80 }, { by: "Zeynep", cashOuts: many }));
  assert.match(tm, /  · Dükkân 6 10 ₺\n  · ve 2 kalem daha\n/);
  assert.doesNotMatch(tm, /Dükkân 7/);

  const m = renderCashReport(day, { by: "Zeynep", revision: 1, submittedAt: new Date("2026-10-21T20:15:00Z"), ...extras });
  assert.match(m.html, /Fotoğraflar panelde: Z raporu, banka POS/);
  assert.match(plain(m.html), /Fotoğraftan farklı yazılan: Kart \(fotoğrafta 8\.915 ₺\)/);
  assert.match(plain(m.html), /· Migros \(süt, beyaz peynir\) 112,50 ₺ 📷/);
  assert.match(plain(m.text), /📷 Z ve POS fotoğrafı panelde/);
  for (const out of [m.html, m.text, t]) {
    assert.doesNotMatch(out, /\/api\/foto/, "fotoğrafın adresi metne girmez");
    assert.doesNotMatch(out, /blob\.vercel-storage/);
    assert.doesNotMatch(out, /<img/);
  }
});

test("alıcı adresleri: ayırıcılar, küçük harf, tekrar ve geçersiz", () => {
  assert.deepEqual(parseEmails("Patron@ornek.com, muhasebe@ornek.com.tr\npatron@ornek.com; yanlis@ ; a@b"), {
    valid: ["patron@ornek.com", "muhasebe@ornek.com.tr"],
    invalid: ["yanlis@", "a@b"],
  });
  assert.deepEqual(parseEmails("  "), { valid: [], invalid: [] });
});

test("varsayılan alıcılar ortamdan: ayrıştırılır, yoksa boş", () => {
  assert.deepEqual(defaultCashRecipients({ CASH_REPORT_RECIPIENTS: "Patron@ornek.com;\nmuhasebe@ornek.com.tr, yanlis@" }), ["patron@ornek.com", "muhasebe@ornek.com.tr"]);
  assert.deepEqual(defaultCashRecipients({}), []);
  assert.deepEqual(defaultCashRecipients({ CASH_REPORT_RECIPIENTS: "  " }), []);
});

test("yetki: personel bugünü ve dünü gönderir, silme ve ayarlar yöneticinin; varsayılan alıcılar", () => {
  const src = readFileSync(join(process.cwd(), "src/server/actions/cash-report.ts"), "utf8");
  assert.match(src, /export async function submitCashReport[\s\S]*?requireUser\(\)[\s\S]*?saveCashReport\(getDb\(\), me, data\)/);
  // Yazım yolu ayrı (sunucu eylemi olmayan) modülde: personel kuralı ve sürüm denetimi orada
  const store = readFileSync(join(process.cwd(), "src/server/cash/report-store.ts"), "utf8");
  assert.match(store, /export async function saveCashReport[\s\S]*?me\.role !== "admin" && !staffCanReport\(data\.date, now\)/);
  // Arada başkası gönderdiyse üzerine yazılmaz
  assert.match(store, /export function assertRevision[\s\S]*?if \(prev && prev\.revision !== revision\)/);
  assert.match(store, /export async function writeCashReport[\s\S]*?assertRevision\(prev, o\.revision\)/);
  for (const fn of ["deleteCashReport", "updateCashSettings", "sendCashTestEmail"]) {
    assert.match(src, new RegExp(`export async function ${fn}[\\s\\S]*?requireAdmin\\(\\)`), fn);
  }
  // Varsayılan alıcılar kodda değil, ortamda (CASH_REPORT_RECIPIENTS): yerel kurulum gerçek kişilere rapor göndermez
  const data = readFileSync(join(process.cwd(), "src/server/data/cash-reports.ts"), "utf8");
  assert.doesNotMatch(data, /[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}/i);
  assert.match(data, /: defaultCashRecipients\(process\.env\)/);
  // Personel alıcı adreslerini görmez (yalnız sayısı gider)
  const page = readFileSync(join(process.cwd(), "src/app/panel/kasa/page.tsx"), "utf8");
  assert.match(page, /const mailTo = settings\.emailEnabled && showForm \? \(await cashEmailRecipients\(getDb\(\), settings\.recipients\)\)\.length : 0;/);
  assert.match(page, /recipients=\{mailTo\}/);
});

// ---------------------------------------------------------------- Kasa bütünlüğü: açılış ↔ devir, düzeltmeler, kilit

test("açılış ↔ önceki devir: 1 ₺ altı tutar; az / fazla; arada rapor girilmemiş gün", () => {
  const prev = { date: "2026-10-20", amount: 1_200 };
  assert.equal(carryCheck("2026-10-21", 1_200.99, prev), null, "0,99 ₺ fark tutuyor");
  assert.equal(carryCheck("2026-10-21", 1_500, null), null, "ilk rapor: karşılaştırılacak devir yok");
  const less = carryCheck("2026-10-21", 1_080, prev)!;
  assert.deepEqual(less, { date: "2026-10-21", prevDate: "2026-10-20", carry: 1_200, opening: 1_080, diff: -120, gapDays: 0 });
  assert.equal(plain(carryDiffText(less)), "120 ₺ az");
  const more = carryCheck("2026-10-23", 1_230, prev)!;
  assert.equal(plain(carryDiffText(more)), "30 ₺ fazla");
  assert.equal(more.gapDays, 2);
  assert.equal(plain(carryWarning(less)), "Önceki devir 1.200 ₺ (20 Ekim): açılış 120 ₺ az");
  assert.equal(plain(nextWarning(less)), "21 Ekim açılışı (1.080 ₺) bu devirle tutmuyor");
});

test("açılış ↔ devir zinciri: her raporun açılışı bir öncekinin devriyle; sonradan düzeltilen önceki gün de yakalanır", () => {
  const r = (date: string, openingCash: number, countedCash: number, handedOver: number) => ({ date, openingCash, countedCash, handedOver });
  const reports = [r("2026-10-21", 500, 3_430, 3_000), r("2026-10-20", 400, 900, 400), r("2026-10-22", 430, 2_000, 1_500)];
  // 20 Ekim'in açılışı önceki aydan devirle (before), 21'i 20'nin devriyle (500), 22'si 21'inkiyle (430)
  assert.deepEqual([...carryChecks(reports, { date: "2026-10-19", amount: 400 }).keys()], []);
  const before = carryChecks(reports, { date: "2026-10-19", amount: 350 });
  assert.deepEqual([...before.keys()], ["2026-10-20"]);
  assert.equal(before.get("2026-10-20")!.diff, 50);
  // 21 Ekim sonradan düzeltildi: devri 430'dan 330'a indi, 22'nin açılışı artık tutmuyor
  const edited = carryChecks([reports[0], { ...reports[1] }, { ...reports[2] }].map((x) => (x.date === "2026-10-21" ? { ...x, countedCash: 3_330 } : x)), null);
  const c = edited.get("2026-10-22")!;
  assert.equal(c.prevDate, "2026-10-21");
  assert.equal(c.carry, 330);
  assert.equal(c.diff, 100);
  assert.equal(nextCheckOf(edited.values(), "2026-10-21"), c, "21'in devriyle tutmayan sonraki rapor");
  assert.equal(nextCheckOf(edited.values(), "2026-10-22"), null);
});

test("açılış devirle tutmuyorsa not zorunlu: yeni raporda ya da açılış değiştiyse", () => {
  const check = carryCheck("2026-10-21", 1_080, { date: "2026-10-20", amount: 1_200 });
  assert.equal(openingNeedsNote({ check, openingCash: 1_080, prevOpening: null, note: null }), true, "yeni rapor");
  assert.equal(openingNeedsNote({ check, openingCash: 1_080, prevOpening: null, note: "  " }), true, "boşluk not değil");
  assert.equal(openingNeedsNote({ check, openingCash: 1_080, prevOpening: null, note: "patron 120 aldı" }), false);
  assert.equal(openingNeedsNote({ check, openingCash: 1_080, prevOpening: 1_100, note: null }), true, "açılış değişti");
  assert.equal(openingNeedsNote({ check, openingCash: 1_080, prevOpening: 1_080, note: null }), false, "açılışa dokunmayan düzeltme (ör. Z yazım hatası) engellenmez");
  assert.equal(openingNeedsNote({ check: null, openingCash: 1_080, prevOpening: null, note: null }), false);
});

const rev = (o: Partial<CashRevisionData> = {}): CashRevisionData => ({ ...day, discounts: null, cashDiff: -120, countedByName: "Ayşe", ...o });

test("düzeltmeler: değişen alanlar, tutar biçimi, boş, metin alanı içeriksiz, kasa alanı işaretli", () => {
  assert.deepEqual(revisionChanges(rev(), rev()), []);
  const changes = revisionChanges(rev(), rev({ countedCash: 3_530, note: "bozuk para", bankPos: null, zNo: "1235", countedByName: "Mehmet", discounts: 250 }));
  assert.deepEqual(
    changes.map((c) => [c.key, c.label, plain(c.from), plain(c.to), c.sensitive]),
    [
      ["countedCash", "Sayılan nakit", "3.430 ₺", "3.530 ₺", true],
      ["discounts", "İndirim", "—", "250 ₺", false],
      ["bankPos", "Banka POS", "8.150 ₺", "—", false],
      ["zNo", "Z no", "1234", "1235", false],
      ["note", "Not", "", "", false],
      // Sayan da kasa alanı sayılır (dalga 10): ertesi gün değişirse yönetici uyarılır, personel onayla değiştirir
      ["countedByName", "Sayan", "Ayşe", "Mehmet", true],
    ],
  );
  assert.equal(plain(changeLine(changes[0])), "Sayılan nakit: 3.430 ₺ → 3.530 ₺");
  assert.equal(changeLine(changes[4]), "Not değişti");
  assert.equal(plain(changesText([changes[0], changes[4]])), "Sayılan nakit 3.430 ₺ → 3.530 ₺; Not değişti");
  // Kuruş altı fark değişiklik değil; eski bir kopyada olmayan alan boş sayılır
  assert.deepEqual(revisionChanges(rev({ cash: 3_200.001 }), rev()), []);
  const old: Partial<CashRevisionData> = { ...rev() };
  delete old.discounts;
  assert.deepEqual(revisionChanges(old, rev()), []);
});

test("geç düzeltme: iş günü ertesi gün 05:00'te kapanır", () => {
  // 21 Ekim'in raporu: aynı gece 23:59 ve ertesi gün 04:59 düzeltme normal, 05:01 sonrası geç
  assert.equal(isLateEdit("2026-10-21", new Date("2026-10-21T20:59:00Z")), false);
  assert.equal(isLateEdit("2026-10-21", new Date("2026-10-22T01:59:00Z")), false);
  assert.equal(isLateEdit("2026-10-21", new Date("2026-10-22T02:01:00Z")), true);
});

test("düzeltme geçmişi: sürümler sırayla karşılaştırılır, en yeni önce; geç ve kasa alanı değişen işaretli", () => {
  const report = {
    ...day,
    discounts: null,
    revision: 3,
    cashDiff: -20,
    countedByName: "Ayşe",
    submittedByName: "Mehmet",
    createdAt: "2026-10-21T20:10:00Z",
    updatedAt: "2026-10-22T07:05:00Z",
    countedCash: 3_530,
  };
  const revisions = [
    { revision: 2, data: rev({ note: "ilk not" }), submittedByName: "Ayşe", submittedAt: "2026-10-21T20:40:00Z" },
    { revision: 1, data: rev(), submittedByName: "Ayşe", submittedAt: "2026-10-21T20:10:00Z" },
  ];
  const h = historyOf(report, revisions);
  assert.deepEqual(
    h.entries.map((e) => [e.revision, e.by, e.late, e.changes.map((c) => c.key)]),
    [
      [3, "Mehmet", true, ["countedCash", "note"]],
      [2, "Ayşe", false, ["note"]],
    ],
  );
  assert.deepEqual(h.first, { at: "2026-10-21T20:10:00Z", by: "Ayşe" });
  // Ertesi gün yalnız not değiştiyse geç düzeltme sayılmaz
  assert.equal(historyOf({ ...report, countedCash: 3_430 }, revisions).entries[0].late, false);
  // Bu özellikten önceki rapor: geçmiş ilk kopyadan başlar, ilk göndereni bilinmez
  const older = historyOf(report, [revisions[0]]);
  assert.equal(older.entries.length, 1);
  assert.equal(older.first.by, null);
  // Son düzeltme (zil): şimdiki sürüm ile bir önceki kopya
  assert.deepEqual(lastRevision(report, revisions)?.changes.map((c) => c.key), ["countedCash", "note"]);
  assert.equal(lastRevision(report, revisions)?.late, true);
  assert.equal(lastRevision({ ...report, revision: 1 }, []), null);
});

test("eski rapor (sayan boş): gönderen saymış sayılır; ilk düzeltmede yapılmamış bir 'Sayan' değişikliği görünmez", () => {
  // Bu özellikten önce kaydedilmiş satır: counted_by_name boş. Form sayanı gönderenle açar, düzeltmenin kopyası da onunla
  const old = { ...rev({ receipts: 80 }), countedByName: null, submittedByName: "Ayşe" };
  assert.equal(revisionDataOf(old).countedByName, "Ayşe");
  assert.equal(revisionDataOf({ ...old, countedByName: "Mehmet" }).countedByName, "Mehmet");
  const fixed = { ...rev({ receipts: 81 }), submittedByName: "Ayşe" };
  assert.deepEqual(
    revisionChanges(revisionDataOf(old), revisionDataOf(fixed)).map((c) => c.key),
    ["receipts"],
    "eylemin işlem geçmişine yazdığı değişiklik",
  );
  // Sayanı boş kaydedilmiş bir kopya da (geçmiş, son düzeltme: e-posta ve WhatsApp'taki "Değişen:") aynı kuralla
  const report = { ...fixed, revision: 2, createdAt: "2026-10-21T20:10:00Z", updatedAt: "2026-10-21T20:40:00Z" };
  const snaps = [{ revision: 1, data: rev({ receipts: 80, countedByName: null }), submittedByName: "Ayşe", submittedAt: "2026-10-21T20:10:00Z" }];
  assert.deepEqual(historyOf(report, snaps).entries[0].changes.map((c) => c.key), ["receipts"]);
  assert.deepEqual(lastRevision(report, snaps)?.changes.map((c) => c.key), ["receipts"]);
  // Başka biri sayan seçildiyse gerçek değişiklik
  assert.deepEqual(
    lastRevision({ ...report, countedByName: "Mehmet" }, snaps)?.changes.map((c) => [c.key, c.from, c.to]),
    [
      ["receipts", "80", "81"],
      ["countedByName", "Ayşe", "Mehmet"],
    ],
  );
});

test("zil: ertesi gün kasa düzeltmesi ardından gelen not düzeltmesiyle kaybolmaz; yöneticinin kendi düzeltmesi sayılmaz", () => {
  // 21 Ekim: akşam gönderildi (1), ertesi sabah Ayşe sayılan nakdi değiştirdi (2), sonra yalnız not ekledi (3)
  const revisions = [
    { revision: 1, data: rev(), submittedBy: 3, submittedByName: "Ayşe", submittedAt: "2026-10-21T20:10:00Z" },
    { revision: 2, data: rev({ countedCash: 3_530 }), submittedBy: 3, submittedByName: "Ayşe", submittedAt: "2026-10-22T07:00:00Z" },
  ];
  const report = {
    ...rev({ countedCash: 3_530, note: "sabah tekrar saydık" }),
    revision: 3,
    submittedBy: 3,
    submittedByName: "Ayşe",
    createdAt: "2026-10-21T20:10:00Z",
    updatedAt: "2026-10-22T07:30:00Z",
  };
  assert.equal(lastRevision(report, revisions)?.late, false, "son düzeltme yalnız not");
  const late = lateCorrections(report, revisions, 1)!;
  assert.equal(late.revision, 2, "bildirimin kimliği en yeni geç düzeltmeden: not düzeltmesi yeniden çaldırmaz");
  assert.deepEqual(late.by, ["Ayşe"]);
  assert.deepEqual(late.changes.map((c) => plain(changeLine(c, false))), ["Sayılan nakit 3.430 ₺ → 3.530 ₺"]);
  // Yöneticinin (1) kendi sabah düzeltmesi kendi zilinde yok; başka bir yöneticinin (2) zilinde var
  const own = { ...rev({ countedCash: 3_530 }), revision: 2, submittedBy: 1, submittedByName: "Yönetici", createdAt: report.createdAt, updatedAt: "2026-10-22T07:00:00Z" };
  assert.equal(lateCorrections(own, revisions.slice(0, 1), 1), null);
  assert.equal(lateCorrections(own, revisions.slice(0, 1), 2)?.revision, 2);
  // Önce Ayşe (2), sonra yönetici (3) ertesi gün değiştirdi: yönetici yalnız Ayşe'ninkini görür; herkesinki eskiden yeniye
  const both = { ...rev({ countedCash: 3_530, handedOver: 3_100 }), revision: 3, submittedBy: 1, submittedByName: "Yönetici", createdAt: report.createdAt, updatedAt: "2026-10-22T09:00:00Z" };
  assert.deepEqual(lateCorrections(both, revisions, 1), { revision: 2, by: ["Ayşe"], changes: late.changes });
  const all = lateCorrections(both, revisions, null)!;
  assert.equal(all.revision, 3);
  assert.deepEqual(all.by, ["Ayşe", "Yönetici"]);
  assert.deepEqual(all.changes.map((c) => c.key), ["countedCash", "handedOver"]);
  // Aynı akşam düzeltilen ya da ertesi gün yalnız Z / not değişen rapor zile düşmez
  assert.equal(lateCorrections({ ...report, countedCash: 3_430, note: day.note }, [revisions[0], { ...revisions[1], data: rev({ zTotal: 12_500 }) }], 1), null);
  assert.equal(lateCorrections({ ...own, updatedAt: "2026-10-21T21:00:00Z" }, revisions.slice(0, 1), 2), null);
});

test("WhatsApp ve e-posta: sayan, değişenler, açılış ↔ devir, ertesi gün, İndirim; not kaçışlı", () => {
  const carry = carryCheck("2026-10-21", 500, { date: "2026-10-20", amount: 620 })!;
  const next = carryCheck("2026-10-22", 1_200, { date: "2026-10-21", amount: 430 })!;
  const changes = revisionChanges(rev(), rev({ countedCash: 3_530, note: "x" }));
  const f = { ...day, discounts: 3_200 };
  const t = plain(whatsappText(f, { by: "Mehmet", countedBy: "Ayşe", revision: 2, carry, next, changes }));
  assert.match(t, /^\*L'Affogato · Gün sonu kasa raporu\* \(güncellendi\)\n21 Ekim Çarşamba · Mehmet · sayan Ayşe\n/);
  assert.match(t, /\*Değişen:\* Sayılan nakit 3\.430 ₺ → 3\.530 ₺; Not değişti/);
  assert.match(t, /• Online: 500 ₺\n• İndirim: 3\.200 ₺\n/);
  assert.match(t, /Açılış \(devir\): 500 ₺\n⚠️ Önceki devir 620 ₺ \(20 Ekim\): açılış 120 ₺ az\n\+ Nakit satış/);
  assert.match(t, /Ertesi güne devir: 430 ₺\n⚠️ 22 Ekim açılışı \(1\.200 ₺\) bu devirle tutmuyor/);
  // Sayan gönderenle aynıysa yazılmaz; ilk gönderimde "Değişen" yok
  const same = plain(whatsappText(day, { by: "Ayşe", countedBy: "Ayşe", revision: 1, changes }));
  assert.match(same, /21 Ekim Çarşamba · Ayşe\n/);
  assert.doesNotMatch(same, /Değişen|sayan|İndirim/);

  const m = renderCashReport({ ...f, note: "<b>x</b>" }, { by: "Mehmet", countedBy: "Ayşe", revision: 2, submittedAt: new Date("2026-10-21T20:15:00Z"), carry, next, changes });
  const html = plain(m.html);
  assert.match(html, /Mehmet · sayan Ayşe · 23:15 · güncellendi/);
  assert.match(html, /Değişen: Sayılan nakit 3\.430 ₺ → 3\.530 ₺; Not değişti/);
  assert.match(html, />İndirim</);
  assert.match(html, /Önceki devir 620 ₺ \(20 Ekim\): açılış 120 ₺ az<br>22 Ekim açılışı \(1\.200 ₺\) bu devirle tutmuyor/);
  assert.doesNotMatch(m.html, /<b>x<\/b>/);
  assert.equal(m.subject, renderCashReport(f, { by: "Mehmet", revision: 2, submittedAt: new Date() }).subject, "konu değişmez");
  assert.match(plain(m.text), /⚠️ 22 Ekim açılışı/);
});

test("personelin kilidi: bugün ve dün; günün raporu varken ertesi günün raporu girildiyse yalnız yönetici", () => {
  const now = new Date("2026-10-22T18:00:00Z");
  assert.equal(staffDayEditable("2026-10-21", { hasReport: true, laterReport: false }, now), true);
  assert.equal(staffDayEditable("2026-10-21", { hasReport: true, laterReport: true }, now), false);
  assert.equal(staffDayEditable("2026-10-21", { hasReport: false, laterReport: true }, now), true, "unutulan dünü girmek serbest");
  assert.equal(staffDayEditable("2026-10-22", { hasReport: true, laterReport: false }, now), true);
  assert.equal(staffDayEditable("2026-10-20", { hasReport: false, laterReport: false }, now), false);
});

test("kilit her yerde aynı kural: rapor eylemi, kasa sayfası, kasadan çıkanlar ve fotoğraflar (staffDayOpen)", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const store = read("src/server/cash/report-store.ts");
  // Ertesi günün raporu girildiyse (kilitli) personelin değişikliği onaya döner (staffCashGate; dalga 10)
  assert.match(store, /if \(prev && me\.role !== "admin"\) \{[\s\S]*?const laterReport = await hasLaterReport\(tx, data\.date\);[\s\S]*?staffCashGate\(\{ date: data\.date, now, hasReport: true, laterReport, changes \}\)/);
  assert.match(store, /export async function hasLaterReport[\s\S]*?gt\(s\.cashReports\.date, date\)/);
  // Açılış notu ve önceki sürümün kopyası aynı işlemde, satır kilitliyken
  assert.match(store, /export async function lockCashReport[\s\S]*?\.for\("update"\)/);
  assert.match(store, /export async function writeCashReport[\s\S]*?lockCashReport\(tx, data\.date\)[\s\S]*?openingNeedsNote\([\s\S]*?tx\.insert\(s\.cashReportRevisions\)/);
  const rules = read("src/server/photo-read/rules.ts");
  assert.match(rules, /export async function staffDayOpen[\s\S]*?staffDayEditable\(day, \{ hasReport: rows\[0\]\?\.date === day, laterReport: rows\.some\(\(r\) => r\.date > day\) \}, now\)/);
  assert.match(rules, /canView[\s\S]*?await staffDayOpen\(row\.date\)/);
  assert.match(rules, /export async function canUploadPhoto[\s\S]*?staffDayOpen\(day\)/);
  for (const route of ["src/app/api/foto/route.ts", "src/app/api/foto/[id]/oku/route.ts"]) assert.match(read(route), /await canUploadPhoto\(/, route);
  // Kasadan çıkanlar: personelin her yolu tek kapıdan (src/server/cash-outs/guard.ts), kapı staffDayOpen'a sorar
  const outs = read("src/server/actions/cash-outs.ts");
  assert.equal(outs.match(/await staffCashOutGate\(/g)?.length, 3);
  assert.match(read("src/server/cash-outs/guard.ts"), /staffDayOpen\(date, tx, now\)/);
  const page = read("src/app/panel/kasa/page.tsx");
  assert.match(page, /staffDayEditable\(date, \{ hasReport: Boolean\(report\), laterReport: next !== null \}\)/);
  assert.match(page, /const canEdit = admin \|\| staffOpen;/);
});

test("kapanmış gün: personel fotoğrafları görmez (küçük resim ve büyütme yok, /api/foto 403 vermesin); WhatsApp satırları kalır", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const page = read("src/app/panel/kasa/page.tsx");
  // Fotoğraf bilgisi WhatsApp metni için personelin girebildiği günde okunur (e-postadakiyle aynı satırlar)
  assert.match(page, /const photoInfo = report && \(admin \|\| staffCanReport\(date\)\) \?/);
  // Fotoğrafların kendisi yalnız görebilene: /api/foto'nun kuralı (staffDayOpen) düzenleme kuralıyla aynı
  assert.match(page, /const showPhotos = canEdit;/);
  assert.match(page, /saved=\{report \? \{ photos: showPhotos \? \(photoInfo\?\.photos \?\? \[\]\) : \[\], readings: photoInfo\?\.readings \?\? \[\] \} : null\}/);
  assert.match(page, /<CashOutsCard[^>]*?showPhotos=\{showPhotos\}/);
  const outs = read("src/app/panel/kasa/cash-outs.tsx");
  // Küçük resim ve büyütme yalnız görebilene; ötekine fiş simgesi ve açılmayan satır
  assert.equal(outs.match(/photoUrl\(/g)?.length, 1, "fotoğrafın adresi tek yerde");
  assert.match(outs, /\{o\.photoId && showPhotos \? \([^)]*?<img src=\{photoUrl\(o\.photoId\)\}/);
  assert.match(outs, /\) : o\.photoId && showPhotos \? \(\s*<button\s+type="button"\s+onClick=\{\(\) => setViewer\(/);
  assert.doesNotMatch(outs, /: o\.photoId \? \(/);
});

// ---------------------------------------------------------------- Geç kasa raporu (dalga 10, plan §2.6)

test("geç rapor penceresi: dünden eski, son 14 takvim günü; bugün, dün ve ileri yok; 05:00 dönüşü", () => {
  const at = (local: string) => new Date(`${local}:00+03:00`);
  const now = at("2026-10-24T10:00");
  assert.equal(LATE_REPORT_DAYS, 14);
  assert.equal(staffLateDay("2026-10-24", now), false, "bugün");
  assert.equal(staffLateDay("2026-10-25", now), false, "ileri");
  assert.equal(staffLateDay("2026-10-23", now), false, "dün: normal form");
  assert.equal(staffLateDay("2026-10-22", now), true, "2 gün önce");
  assert.equal(staffLateDay("2026-10-10", now), true, "14 gün önce");
  assert.equal(staffLateDay("2026-10-09", now), false, "15 gün önce");
  // Gece 04:59: iş günü hâlâ dün (23 Ekim); 05:00'te döner
  assert.equal(staffLateDay("2026-10-22", at("2026-10-24T04:59")), false);
  assert.equal(staffLateDay("2026-10-21", at("2026-10-24T04:59")), true);
  assert.equal(staffLateDay("2026-10-09", at("2026-10-24T04:59")), true);
  assert.equal(staffLateDay("2026-10-22", at("2026-10-24T05:00")), true);
  assert.equal(staffLateDay("2026-10-09", at("2026-10-24T05:00")), false);
});

test("Z no sırası: önceki ve sonraki halkayla; sayı değilse ya da komşu yoksa yargı yok", () => {
  const plain = (t: string) => t.replace(/\u00a0/g, " ");
  const prev = { date: "2026-10-13", zNo: "1203" };
  const next = { date: "2026-10-15", zNo: "1206", pending: true };
  const ok = zNoOrder(prev, "1204", next);
  assert.equal(ok.ok, true);
  assert.equal(plain(ok.text), "Z no 1204 · önceki 1203 (13 Ekim) · sonraki 1206 (15 Ekim, onay bekliyor)");
  const low = zNoOrder(prev, "1203", next);
  assert.equal(low.ok, false);
  assert.match(plain(low.text), /^Z no sırası tutmuyor: önceki 1203 \(13 Ekim\)/);
  const high = zNoOrder(prev, "1207", next);
  assert.equal(high.ok, false);
  assert.match(plain(high.text), /sonraki 1206 \(15 Ekim, onay bekliyor\)/);
  // Komşunun Z no'su yoksa o yön denetlenmez; ikisi de yoksa yargı yok
  assert.equal(zNoOrder({ date: "2026-10-13", zNo: null }, "1204", null).ok, null);
  assert.equal(zNoOrder(null, "1204", { date: "2026-10-15", zNo: "1206" }).ok, true);
  assert.equal(zNoOrder(prev, "A-12", next).ok, null, "sayı olmayan Z no denetlenmez");
  assert.equal(zNoOrder(prev, null, next).ok, null);
  // Baştaki sıfırlar ve boşluk sayıyı değiştirmez
  assert.equal(zNoOrder({ date: "2026-10-13", zNo: "0099" }, " 100 ", null).ok, true);
});

test("girilmemiş günler: ilk rapordan sonra, dünden eski 14 gün; raporlu ve kapalı gün atlanır, bekleyen ve reddedilen işaretli", () => {
  const now = new Date("2026-10-24T10:00:00+03:00");
  const reports = ["2026-10-08", "2026-10-12", "2026-10-20", "2026-10-23"];
  const days = lateMissingDays(reports, "2026-10-08", ["2026-10-14", "2026-10-15"], new Map([["2026-10-18", "pending"], ["2026-10-17", "rejected"]] as const), now);
  // Pencere 10 Ekim – 22 Ekim (dün normal formda); en yeni önce
  assert.deepEqual(days, [
    { date: "2026-10-22", state: "missing" },
    { date: "2026-10-21", state: "missing" },
    { date: "2026-10-19", state: "missing" },
    { date: "2026-10-18", state: "pending" },
    { date: "2026-10-17", state: "rejected" },
    { date: "2026-10-16", state: "missing" },
    { date: "2026-10-13", state: "missing" },
    { date: "2026-10-11", state: "missing" },
    { date: "2026-10-10", state: "missing" },
  ]);
  // İlk raporun günü ve öncesi listelenmez; hiç rapor yoksa liste boş
  assert.deepEqual(
    lateMissingDays(["2026-10-20"], "2026-10-20", [], new Map(), now).map((d) => d.date),
    ["2026-10-22", "2026-10-21"],
  );
  assert.deepEqual(lateMissingDays([], null, [], new Map(), now), []);
});

test("geç rapor kaynakta: geç kipte kasadan çıkan kartı ve DTO yok; e-posta yalnız onayda ve tek; yazım yolu sunucu eylemi değil", () => {
  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  // Personelin geç rapor görünümü: kasadan çıkanların kartı ve satırları gitmez, form boş listeyle açılır
  const page = read("src/app/panel/kasa/page.tsx");
  const lateView = page.slice(page.indexOf("async function StaffLateDay"), page.indexOf("async function SiteDayRow"));
  assert.ok(lateView.length > 100);
  assert.doesNotMatch(lateView, /CashOutsCard|cashOutsOn|CashOutDTO|whatsapp|SiteDayRow|loadCashSettings/);
  const lateUi = read("src/app/panel/kasa/late-report.tsx");
  assert.doesNotMatch(lateUi, /CashOutsCard|CashOutDTO/);
  assert.match(lateUi, /cashOuts=\{\[\]\}/);
  // E-posta yalnız yöneticinin onayında: istek eyleminde yok, onayda tek çağrı (düzeltip onaylasa da) ve isteğe bağlı anahtarla
  const actions = read("src/server/actions/cash-requests.ts");
  const request = actions.slice(actions.indexOf("export async function requestLateCashReport"), actions.indexOf("const reviewSchema"));
  assert.doesNotMatch(request, /emailReport/);
  const lateBranch = actions.slice(actions.indexOf('out.kind === "kasa-gec"'), actions.indexOf('} else if (out.status === "rejected")'));
  assert.equal(lateBranch.match(/emailReport\(/g)?.length, 1);
  assert.match(lateBranch, /idempotencyKey: `cash-\$\{date\}-r\$\{out\.report\.revision\}-gec\$\{out\.request\.id\}`/);
  for (const f of ["src/server/cash/late.ts", "src/server/cash/late-chain.ts", "src/server/cash/report-store.ts", "src/server/cash/report-email.ts"]) {
    assert.match(read(f), /^import "server-only";/, f);
    assert.doesNotMatch(read(f), /"use server"/, f);
  }
  assert.doesNotMatch(actions, /export const reportSchema|export async function emailReport/);
  // 05:00 dönüşü: personelin dünü artık geç rapor ise kaydetmez, onaya çevirir
  const store = read("src/server/cash/report-store.ts");
  assert.match(store, /if \(revision === 0 && staffLateDay\(data\.date, now\)\)[\s\S]*?return \{ kind: "needsApproval", request: "kasa-gec", gate: "gec" \};/);
  assert.match(store, /supersede\(tx, \{ kinds: \["kasa-gec"\], subject: `gun:\$\{data\.date\}` \}, me\.role === "admin" \? "Yönetici günü kendisi girdi"/);
});

test("geç rapor kartı: düzeltirken teslim işareti de görünür (personel 0, yönetici teslim yazınca onaylanabilsin); vazgeçince sıfırlanır", () => {
  const src = readFileSync(join(process.cwd(), "src/app/panel/onaylar/kasa-cards.tsx"), "utf8");
  const item = src.slice(src.indexOf("function LateItem"));
  assert.match(item, /\{\(handover \|\| correcting\) && !blocked \? \(\s*<Checkbox/);
  // Düzeltirken etiket personelin eski tutarını yazmaz
  const label = item.slice(item.indexOf("<Checkbox"), item.indexOf("/>", item.indexOf("<Checkbox")));
  assert.match(label, /correcting\s*\?\s*handover\s*\?\s*"Teslimi aldım \/ bankada gördüm \(formdaki Teslim edilen tutar\)"/);
  assert.doesNotMatch(label.slice(label.indexOf("correcting"), label.indexOf("`Bu teslimi")), /money\(|f\.handedOver/);
  assert.match(item, /onCancel=\{\(\) => \{\s*setCorrecting\(false\);\s*setSeen\(false\);\s*\}\}/);
  // İstemci ve sunucu denetimi kalır
  assert.match(item, /if \(\(handover \|\| fields\.handedOver > 0\) && !seen\) return void toast\.error/);
  const late = readFileSync(join(process.cwd(), "src/server/cash/late.ts"), "utf8");
  assert.match(late, /if \(\(requested\.handedOver > 0 \|\| finalFields\.handedOver > 0\) && !input\.handoverSeen\) throw new UserError\(CASH_REQUEST_TEXT\.lateHandover\)/);
});
