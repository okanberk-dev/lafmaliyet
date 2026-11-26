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
  photosLine,
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
import { okcReconcile } from "../src/lib/okc-z";
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
  cashIn: 0,
  cashOut: 150,
  cashOutNote: "süt, buz",
  countedCash: 3_430,
  handedOver: 3_000,
  bankPos: 8_150,
  offRevenue: null,
  note: "Bir müşteri bozuk para eksik verdi",
};

test("kasa: olması gereken = açılış + nakit satış − gün içinde çıkan (giren yokken); fark sayılandan; devir teslimden sonra kalan", () => {
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

test("kart farkı (dalga 13 D5): yazarkasa kartı varsa o, yoksa banka gün sonu; eski satır birebir", () => {
  // Eski satır (yazarkasa alanı yok): bugünkü sonuç ve kaynağı banka
  const old = computeCash(day);
  assert.equal(old.cardDiff, 0);
  assert.equal(old.cardSource, "bank");
  assert.deepEqual({ ...computeCash({ ...day, okcCard: null }) }, { ...old });
  // Yazarkasa kartı banka gün sonunun önüne geçer
  const okc = computeCash({ ...day, okcCard: 8_270 });
  assert.equal(okc.cardDiff, 120);
  assert.equal(okc.cardSource, "okc");
  assert.equal(computeCash({ ...day, bankPos: null, okcCard: 8_100 }).cardDiff, -50);
  // İkisi de yok: karşılaştırma yok
  const none = computeCash({ ...day, bankPos: null, okcCard: null });
  assert.equal(none.cardDiff, null);
  assert.equal(none.cardSource, null);
  // WhatsApp'ın kart satırı da aynı kaynaktan: yazarkasa kartı yazılınca eski "Kart" bloğu yerine banka POS Z bloğu
  const w = plain(whatsappText({ ...day, bankPos: null, okcCard: 9_000 }, { by: "Ayşe" }));
  assert.match(w, /\*Banka POS Z raporu\*\n• Kredi kartı: 9\.000 ₺\n⚠️ Yazarkasa kartı ModPOS'tan 850 ₺ fazla$/m);
  assert.doesNotMatch(w, /\*Kart\*|Banka POS:|Banka gün sonu/);
});

test("düzeltmeler: yazarkasa alanları ve KDV dökümü (sıralı, kuruşa yuvarlı; aynı uzunlukta farklı döküm değişti)", () => {
  const vat = [
    { rate: 10, total: 8_110, vat: 737.27 },
    { rate: 20, total: 1_240, vat: 206.67 },
  ];
  const withOkc = rev({ okcZNo: "0188", okcReceipts: 143, okcTotal: 9_350, okcVatTotal: 943.94, okcVat: vat, okcCash: 2_450, okcCard: 6_900, okcMealCard: null, okcOther: null });
  // Aynı döküm farklı sırada ve kuruş altı farkla: değişmedi
  assert.deepEqual(revisionChanges(withOkc, { ...withOkc, okcVat: [{ rate: 20, total: 1_240.001, vat: 206.67 }, vat[0]] }), []);
  // Aynı uzunlukta farklı döküm (bir oranın KDV'si): değişti, değer yazılmadan
  const changed = revisionChanges(withOkc, { ...withOkc, okcVat: [vat[0], { rate: 20, total: 1_240, vat: 206.76 }] });
  assert.deepEqual(
    changed.map((c) => [c.key, c.label, c.from, c.to, c.sensitive]),
    [["okcVat", "KDV dökümü", "", "", false]],
  );
  assert.equal(changeLine(changed[0]), "KDV dökümü değişti");
  // Boş ve [] eşit; eski kopyada (yazarkasa anahtarı yok) boş sayılır
  assert.deepEqual(revisionChanges(rev({ okcVat: null }), rev({ okcVat: [] })), []);
  assert.deepEqual(revisionChanges(rev(), rev({ okcVat: null, okcZNo: null })), []);
  // Yazarkasa alanları eklenince: Z no metin olarak, tutarlar tutar olarak; hiçbiri hassas değil (onaysız)
  const added = revisionChanges(rev(), withOkc);
  assert.deepEqual(
    added.map((c) => [c.key, c.label, plain(c.from), plain(c.to), c.sensitive]),
    [
      ["okcTotal", "Yazarkasa toplam", "—", "9.350 ₺", false],
      ["okcCash", "Yazarkasa nakit", "—", "2.450 ₺", false],
      ["okcCard", "Yazarkasa kart", "—", "6.900 ₺", false],
      ["okcVatTotal", "Yazarkasa KDV", "—", "943,94 ₺", false],
      ["okcVat", "KDV dökümü", "", "", false],
      ["okcZNo", "Yazarkasa Z no", "—", "0188", false],
      ["okcReceipts", "Yazarkasa fiş sayısı", "—", "143", false],
    ],
  );
  // Kopya (revisionDataOf) yazarkasa alanlarını taşır; eski satırda boş
  assert.equal(revisionDataOf({ ...day, cashDiff: 0, countedByName: null }).okcVat, null);
  assert.deepEqual(revisionDataOf({ ...day, okcVat: vat, cashDiff: 0, countedByName: null }).okcVat, vat);
});

test("kasa: gün içinde giren olması gerekene eklenir (açılış + nakit satış + giren − çıkan); devir yine sayılan − teslim", () => {
  // Gün içinde 200 ₺ bozuk para ve 100 ₺ nakit bahşiş kondu: 500 + 3.200 + 300 − 150 = 3.850
  const c = computeCash({ ...day, cashIn: 300, countedCash: 3_850 });
  assert.equal(c.expectedCash, 3_850);
  assert.equal(c.cashDiff, 0);
  assert.equal(c.kind, "even");
  assert.equal(c.carryOver, 850, "devir sayılan − teslim (giren devri ayrıca değiştirmez)");
  assert.equal(computeCash({ ...day, cashIn: 300 }).cashDiff, -420, "giren yazılıp sayılmadıysa eksik");
  // İncelemenin örneği: 1.500 açılış, 12.000 nakit, 300 nakit bahşiş + 1.000 nakit tahsilat = 1.300 giren, 450 harcama
  const lafposDay = { ...day, openingCash: 1_500, cash: 12_000, cashIn: 1_300, handedOver: 0 };
  // Gün ortasında 5.000 teslim (gün içinde çıkan 5.450): LafPOS 9.350 bekler, 9.350 sayıldı
  const withHandover = computeCash({ ...lafposDay, cashOut: 5_450, countedCash: 9_350 });
  assert.deepEqual([withHandover.expectedCash, withHandover.cashDiff, withHandover.carryOver], [9_350, 0, 9_350]);
  // Teslim yok (gün içinde çıkan 450, giren çıkandan 850 fazla): LafPOS 14.350 bekler, 14.350 sayıldı
  const noHandover = computeCash({ ...lafposDay, cashOut: 450, countedCash: 14_350 });
  assert.deepEqual([noHandover.expectedCash, noHandover.cashDiff, noHandover.carryOver], [14_350, 0, 14_350]);
  // Kuruşlarda kayan nokta hatası yok
  assert.equal(computeCash({ ...day, openingCash: 0.1, cash: 0.2, cashIn: 0.1, cashOut: 0, countedCash: 0.4 }).cashDiff, 0);
  // Alan gelmeden önceki jsonb kopyası (önceki sürüm, istek yükü): giren yok, 0 sayılır
  const legacy: Partial<CashReportFields> = { ...day };
  delete legacy.cashIn;
  assert.equal(computeCash(legacy as CashReportFields).expectedCash, 3_550);
});

test("gün içinde giren: WhatsApp'ta ve e-postada nakit satışın altında, yalnız varsa", () => {
  const t = plain(whatsappText({ ...day, cashIn: 300, countedCash: 3_850 }, { by: "Zeynep" }));
  assert.match(t, /\+ Nakit satış: 3\.200 ₺\n\+ Gün içinde giren: 300 ₺\n− Gün içinde çıkan: 150 ₺ \(süt, buz\)\n= Olması gereken: 3\.850 ₺\nSayılan: 3\.850 ₺\n✅ \*Kasa tutuyor\*/);
  assert.doesNotMatch(plain(whatsappText(day, { by: "Zeynep" })), /Gün içinde giren/, "giren yoksa satır yok");
  const m = renderCashReport({ ...day, cashIn: 300, countedCash: 3_850 }, { by: "Zeynep", revision: 1, submittedAt: new Date("2026-10-21T20:15:00Z") });
  const html = plain(m.html);
  assert.ok(html.indexOf("+ Nakit satış") < html.indexOf("+ Gün içinde giren") && html.indexOf("+ Gün içinde giren") < html.indexOf("− Gün içinde çıkan"));
  assert.match(html, /Olması gereken 3\.850 ₺ · sayılan 3\.850 ₺/);
  assert.match(plain(m.text), /\+ Gün içinde giren: 300 ₺/);
  assert.doesNotMatch(renderCashReport(day, { by: "Zeynep", revision: 1, submittedAt: new Date() }).html, /Gün içinde giren/);
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
  assert.match(t, /^\*L'Affogato · Gün sonu kasa raporu KR-20261021\*\n21 Ekim Çarşamba · Zeynep\nZ no: 1234 · 87 fiş/);
  assert.match(t, /Toplam satış: 12\.450 ₺\n• Nakit: 3\.200 ₺\n• Kredi \/ banka kartı: 8\.150 ₺\n• Yemek kartı: 600 ₺\n• Online: 500 ₺\n/);
  assert.doesNotMatch(t, /Diğer/, "sıfır olan ödeme türü yazılmaz");
  assert.match(t, /− Gün içinde çıkan: 150 ₺ \(süt, buz\)\n= Olması gereken: 3\.550 ₺\nSayılan: 3\.430 ₺\n🔴 \*120 ₺ EKSİK\*/);
  assert.match(t, /Teslim edilen: 3\.000 ₺ · Ertesi güne devir: 430 ₺/);
  assert.match(t, /\*ModPOS Z raporu\*\nToplam satış/);
  // Yazarkasa bölümünden önceki rapor: bugünkü "Kart" bloğu, etiket "Banka POS" (anlam iddia edilmez, okc-z.md §3.7)
  assert.match(t, /\*Kart\*\nBanka POS: 8\.150 ₺ ✅ ModPOS ile aynı/);
  assert.doesNotMatch(t, /Banka POS Z raporu|Banka gün sonu/);
  assert.match(t, /Not: Bir müşteri bozuk para eksik verdi$/);
  const off = plain(whatsappText({ ...day, mealCard: 650, countedCash: 3_550, bankPos: 8_050 }, { by: "Ali", revision: 2 }));
  assert.match(off, /\(güncellendi\)/);
  assert.match(off, /⚠️ Ödeme türleri toplamı \(12\.500 ₺\) Z toplamından 50 ₺ fazla/);
  assert.match(off, /✅ \*Kasa tutuyor\*/);
  assert.match(off, /⚠️ ModPOS'tan 100 ₺ az/);
});

test("e-posta: konu, sonuç, döküm; not kaçışlı, metin sürümü yıldızsız", () => {
  assert.equal(plain(reportSubject(day)), "Kasa raporu KR-20261021 · 21 Ekim Çarşamba · 120 ₺ eksik");
  assert.equal(plain(reportSubject({ ...day, countedCash: 3_550 }, 2)), "Kasa raporu KR-20261021 · 21 Ekim Çarşamba · kasa tutuyor (güncellendi)");
  const m = renderCashReport({ ...day, note: "<script>alert(1)</script>" }, { by: "Zeynep", revision: 1, submittedAt: new Date("2026-10-21T20:15:00Z") });
  assert.match(plain(m.html), /120 ₺ eksik/);
  assert.match(m.html, /23:15/, "saat Türkiye saatiyle");
  assert.match(m.html, /\/panel\/kasa\?gun=2026-10-21/);
  assert.match(m.html, /<a href="[^"]*\/panel\/kasa\?gun=2026-10-21"[^>]*>Panelde aç<\/a>/, "ana eylem düğmesi raporu açar");
  assert.doesNotMatch(m.html, /<script\b/i);
  assert.match(m.html, /&lt;script&gt;/);
  assert.doesNotMatch(m.text, /\*/);
  assert.match(plain(m.text), /120 ₺ EKSİK/);
});

test("e-posta: yazılan her metin kaçışlı (ad, sayan, onay, şube, cihaz, neye çıktı, kasadan çıkan, zayi, ikram, not)", () => {
  const evil = `<img src=x onerror="alert(1)">&'`;
  const m = renderCashReport(
    { ...okcDay, cashOut: 100, cashOutNote: evil, note: evil },
    {
      by: evil,
      countedBy: `${evil}2`,
      revision: 1,
      submittedAt: new Date("2026-10-21T20:15:00Z"),
      approval: evil,
      branch: { id: "marina", name: evil },
      device: { label: evil, registerNo: evil },
      waste: { ikram: evil, zayi: evil },
      cashOuts: [{ kind: "harcama", amount: 100, store: evil, description: evil, photo: false }],
    },
  );
  assert.doesNotMatch(m.html, /<img\b/i, "ham etiket yok");
  assert.doesNotMatch(m.html, /onerror="/);
  const html = plain(m.html);
  const E = "&lt;img src=x onerror=&quot;alert\\(1\\)&quot;&gt;&amp;&#39;";
  assert.match(html, new RegExp(`<title>[^<]*${E}[^<]*</title>`), "konu (şube adı)");
  assert.match(html, new RegExp(`Gün sonu kasa raporu · KR-20261021 · ${E}<`), "başlık (şube adı)");
  assert.match(html, new RegExp(`>${E} · sayan ${E}2 · 23:15`), "gönderen ve sayan");
  assert.match(html, new RegExp(`>${E}</div>`), "onay satırı");
  assert.match(html, new RegExp(`>Banka POS Z raporu \\(yazarkasa\\) · ${E} · sicil ${E} · Z no 0188`), "cihaz adı ve sicil");
  assert.match(html, new RegExp(`>− Gün içinde çıkan<div[^>]*>${E}</div>`), "neye çıktı");
  assert.match(html, new RegExp(`· ${E} \\(${E}\\)`), "kasadan çıkan satır");
  assert.match(html, new RegExp(`>İkram:</span> ${E}<`));
  assert.match(html, new RegExp(`>Zayi:</span> ${E}<`));
  assert.match(html, new RegExp(`>Not:</strong> ${E}<`));
});

/**
 * Yazarkasa Z'li gün (docs/planlar/okc-z.md §8): ModPOS nakdi yazarkasadan 120 ₺ fazla, ModPOS toplamı online satış ve
 * nakit farkı kadar fazla; kart ve banka gün sonu aynı; tek oranlı (%10) gün
 */
const okcDay: CashReportFields = {
  ...day,
  zNo: "1235",
  receipts: 151,
  zTotal: 13_095.5,
  cash: 2_745,
  card: 8_915,
  mealCard: 0,
  online: 1_435.5,
  other: 0,
  openingCash: 500,
  cashOut: 0,
  cashOutNote: null,
  countedCash: 3_245,
  handedOver: 0,
  bankPos: 8_915,
  note: null,
  okcZNo: "0188",
  okcReceipts: 143,
  okcTotal: 11_540,
  okcVatTotal: 1_049.09,
  okcVat: [{ rate: 10, total: 11_540, vat: 1_049.09 }],
  okcCash: 2_625,
  okcCard: 8_915,
  okcMealCard: 0,
  okcOther: 0,
};

test("WhatsApp: banka POS Z bloğu yalnız Z no, nakit, kart, kart satırı ve banka gün sonu; toplam / nakit farkı yok", () => {
  const t = plain(whatsappText(okcDay, { by: "Ayşe" }));
  assert.match(t, /\n\n\*Banka POS Z raporu\*\nZ no: 0188\n• Nakit: 2\.625 ₺\n• Kredi kartı: 8\.915 ₺\n✅ Kart ModPOS ile aynı\nBanka gün sonu: 8\.915 ₺(\n\n|$)/);
  assert.doesNotMatch(t, /\*Kart\*|Banka POS:/, "eski blok yok");
  // Yazarkasanın toplamı, KDV'si, fiş sayısı ve yöneticinin karşılaştırma satırları personelin metnine girmez (İlke 8, D13)
  assert.doesNotMatch(t, /Günlük toplam|11\.540|KDV|1\.049|143 fiş|ℹ️/);
  for (const l of okcReconcile(okcDay, "admin").filter((x) => x.key !== "okc-card")) assert.ok(!t.includes(plain(l.text)), `WhatsApp: ${l.key}`);
  assert.doesNotMatch(t, /ModPOS toplamı|yazarkasa nakdi|nakitten|iki Z/i);
  // Kart tutmuyor: kısa uyarı satırı; yazarkasa kartı yoksa banka gün sonu kart kaynağıdır (D5)
  assert.match(plain(whatsappText({ ...okcDay, okcCard: 9_035, okcCash: 2_505 }, { by: "Ayşe" })), /• Kredi kartı: 9\.035 ₺\n⚠️ Yazarkasa kartı ModPOS'tan 120 ₺ fazla\nBanka gün sonu: 8\.915 ₺/);
  assert.match(plain(whatsappText({ ...okcDay, okcCard: null, bankPos: 8_795 }, { by: "Ayşe" })), /⚠️ Banka gün sonu ModPOS'tan 120 ₺ az\nBanka gün sonu: 8\.795 ₺/);
  // Yazarkasa kendi içinde tutmuyor: WhatsApp'a yazılmaz (yalnız kart satırı, D13); formda ve e-postada görünür
  const self = plain(whatsappText({ ...okcDay, okcCash: 2_000 }, { by: "Ayşe" }));
  assert.ok(okcReconcile({ ...okcDay, okcCash: 2_000 }, "staff").some((l) => l.key === "okc-self"));
  assert.doesNotMatch(self, /tutmuyor|turuncu/);
  // Banka gün sonu yazılmadıysa satırı yok; ModPOS bloğu ve kasa aynen
  assert.doesNotMatch(plain(whatsappText({ ...okcDay, bankPos: null }, { by: "Ayşe" })), /Banka gün sonu/);
  assert.match(t, /\*ModPOS Z raporu\*\nToplam satış: 13\.095,50 ₺\n• Nakit: 2\.745 ₺/);
  assert.match(t, /✅ \*Kasa tutuyor\*/);
  // Fotoğraftan farklı yazılan yazarkasa rakamı: bloğa girmeyen (günlük toplam, KDV) yalnız adıyla, kart değeriyle
  const diffs = [
    { field: "okcTotal" as const, label: "Günlük toplam", photo: 11_450, saved: 11_540, confidence: "high" as const, excused: false },
    { field: "okcV10" as const, label: "%10 KDV", photo: 1_040.91, saved: 1_049.09, confidence: "high" as const, excused: false },
    { field: "okcCard" as const, label: "Yazarkasa kredi kartı", photo: 8_951, saved: 8_915, confidence: "high" as const, excused: false },
  ];
  const wd = plain(whatsappText(okcDay, { by: "Ayşe", photoDiffs: diffs }));
  assert.match(wd, /⚠️ Fotoğraftan farklı yazılan: Günlük toplam \(banka POS Z\); %10 KDV \(banka POS Z\); Yazarkasa kredi kartı \(fotoğrafta 8\.951 ₺\)\n/);
  assert.doesNotMatch(wd, /11\.450|1\.040/);
  // E-posta (yönetici) değerleriyle
  const md = renderCashReport(okcDay, { by: "Ayşe", revision: 1, submittedAt: new Date(), photoDiffs: diffs });
  assert.match(plain(md.text), /Günlük toplam \(fotoğrafta 11\.450 ₺\); %10 KDV \(fotoğrafta 1\.040,91 ₺\)/);
  // HTML'de yazarkasa rakamının farkı banka POS Z bölümünün altında, ModPOS'unki kasanın altında
  const mh = plain(renderCashReport(okcDay, { by: "Ayşe", revision: 1, submittedAt: new Date(), photoDiffs: [...diffs, { field: "cash" as const, label: "Nakit", photo: 2_754, saved: 2_745, confidence: "high" as const, excused: false }] }).html);
  assert.match(mh, /Fotoğraftan farklı yazılan: Nakit \(fotoğrafta 2\.754 ₺\)</);
  assert.match(mh, /Fotoğraftan farklı yazılan: Günlük toplam \(fotoğrafta 11\.450 ₺\); %10 KDV \(fotoğrafta 1\.040,91 ₺\); Yazarkasa kredi kartı \(fotoğrafta 8\.951 ₺\)</);
  assert.ok(mh.indexOf("Günlük toplam (fotoğrafta") > mh.indexOf("Banka POS Z raporu (yazarkasa)"));
  assert.ok(mh.indexOf("Nakit (fotoğrafta") < mh.indexOf("Banka POS Z raporu (yazarkasa)"));
});

test("e-posta: banka POS Z bölümü yöneticinin bütün satırlarıyla; metin sürümünde günlük toplam, KDV ve karşılaştırmalar", () => {
  const m = renderCashReport(okcDay, { by: "Ayşe", revision: 1, submittedAt: new Date("2026-10-21T20:15:00Z"), photos: { z: true, okc: true, pos: false } });
  const html = plain(m.html);
  // Bölüm başlıkları (email-kit sectionTitle: başlık kendi <span>'ında, hücrenin tek metni)
  assert.match(html, />ModPOS Z raporu<\/span><\/td>/);
  assert.match(html, />Banka POS Z raporu \(yazarkasa\) · Z no 0188 · 143 fiş<\/span><\/td>/);
  assert.match(html, />Günlük toplam<div[^>]*>KDV 1\.049,09 ₺<\/div><\/td>\s*<td[^>]*>11\.540 ₺</);
  assert.match(html, />%10<div[^>]*>KDV 1\.049,09 ₺<\/div><\/td>\s*<td[^>]*>11\.540 ₺</);
  assert.match(html, />Kredi kartı<\/td>\s*<td[^>]*>8\.915 ₺</);
  assert.match(html, />Banka gün sonu<\/td>\s*<td[^>]*>8\.915 ₺</);
  // Yöneticinin satırları (okcReconcile "admin") e-postada; eski "Kart" bölümü yok
  for (const l of okcReconcile(okcDay, "admin")) assert.ok(html.includes(plain(l.text).replace(/'/g, "&#39;")), `e-posta: ${l.key}`);
  assert.deepEqual(
    okcReconcile(okcDay, "admin").map((l) => l.key),
    ["okc-card", "okc-cash", "okc-total", "okc-bank"],
  );
  assert.doesNotMatch(html, /ModPOS kart/);
  const text = plain(m.text);
  assert.match(text, /Banka POS Z raporu\nZ no: 0188\nGünlük toplam: 11\.540 ₺ \(KDV 1\.049,09 ₺\) · 143 fiş\nKDV dökümü: %10 11\.540 ₺ \(KDV 1\.049,09 ₺\)\n• Nakit: 2\.625 ₺\n• Kredi kartı: 8\.915 ₺\n✅ Kart ModPOS ile aynı\nBanka gün sonu: 8\.915 ₺\n/);
  assert.match(text, /ℹ️ Yazarkasa nakdi, ModPOS'taki nakitten 120 ₺ az\.\nℹ️ ModPOS toplamı yazarkasadan 1\.555,50 ₺ fazla\.\n✅ Banka gün sonu yazarkasa kartıyla aynı\./);
  assert.match(text, /📷 ModPOS Z ve banka POS Z fotoğrafı panelde/);
  assert.doesNotMatch(m.text, /\*/);
  // Online ve diğer satış kadar fark: açıklamalı; yemek kartı ve diğer (sıfır değilse) e-postada; kendi içinde ayrıntılı
  const off = renderCashReport({ ...okcDay, cash: 2_625, zTotal: 12_975.5, countedCash: 3_125, okcMealCard: 50, okcCash: 2_575, mealCard: 0 }, { by: "Ayşe", revision: 1, submittedAt: new Date() });
  assert.match(plain(off.text), /ℹ️ ModPOS toplamı 1\.435,50 ₺ fazla; online ve diğer satışlar kadar \(yazarkasadan geçmez\)\./);
  assert.match(plain(off.text), /• Yemek kartı: 50 ₺/);
  const selfOff = renderCashReport({ ...okcDay, okcCash: 2_000 }, { by: "Ayşe", revision: 1, submittedAt: new Date() });
  assert.match(plain(selfOff.text), /⚠️ Yazarkasa Z'si kendi içinde tutmuyor: /);
  assert.match(plain(selfOff.html), /Yazarkasa Z&#39;si kendi içinde tutmuyor: /);
  // Eski rapor (yazarkasa alanı yok): bugünkü "Kart" bölümü, etiket "Banka POS"; banka POS Z bölümü yok
  const old = renderCashReport({ ...day, bankPos: 8_050 }, { by: "Zeynep", revision: 1, submittedAt: new Date() });
  assert.match(plain(old.html), />Kart<\/span><\/td>/);
  assert.match(plain(old.html), />Banka POS<\/td>\s*<td[^>]*>8\.050 ₺</);
  assert.match(plain(old.html), /Banka POS ModPOS&#39;taki karttan 100 ₺ az\./);
  assert.doesNotMatch(old.html, /Banka POS Z raporu|Günlük toplam|Banka gün sonu/);
  assert.match(plain(old.text), /Kart\nBanka POS: 8\.050 ₺ ⚠️ ModPOS'tan 100 ₺ az/);
});

test("fotoğraflı rapor: WhatsApp başta 📷 satırı ve fotoğraftan farklı yazılan; kasadan çıkanlar altında; adres yok", () => {
  const extras = {
    photos: { z: true, okc: true, pos: false },
    photoDiffs: [{ field: "card" as const, label: "Kart", photo: 8_915, saved: 8_150, confidence: "high" as const, excused: false }],
    cashOuts: [
      { kind: "harcama" as const, amount: 112.5, store: "Migros", description: "süt, beyaz peynir", photo: true },
      { kind: "harcama" as const, amount: 37.5, store: null, description: "buz", photo: false },
      { kind: "teslim" as const, amount: 0, store: "patrona", description: null, photo: false },
    ],
  };
  const t = plain(whatsappText(day, { by: "Zeynep", ...extras }));
  assert.match(t, /Z no: 1234 · 87 fiş\n📷 ModPOS Z ve banka POS Z fotoğrafı panelde\n⚠️ Fotoğraftan farklı yazılan: Kart \(fotoğrafta 8\.915 ₺\)\n/);
  assert.match(t, /− Gün içinde çıkan: 150 ₺ \(süt, buz\)\n  · Migros \(süt, beyaz peynir\) 112,50 ₺ 📷\n  · buz 37,50 ₺\n  · Teslim \(patrona\) 0 ₺\n= Olması gereken/);
  // photosLine({ z, okc, pos }): ModPOS Z, banka POS Z (yazarkasa) ve eski banka POS fotoğrafı ("banka fişi") ayrı adlarla
  assert.equal(photosLine({ z: true, okc: false, pos: false }), "📷 ModPOS Z fotoğrafı panelde");
  assert.equal(photosLine({ z: false, okc: true, pos: false }), "📷 banka POS Z fotoğrafı panelde");
  assert.equal(photosLine({ z: false, okc: false, pos: true }), "📷 banka fişi fotoğrafı panelde");
  assert.equal(photosLine({ z: true, okc: false, pos: true }), "📷 ModPOS Z ve banka fişi fotoğrafı panelde");
  assert.equal(photosLine({ z: true, okc: true, pos: true }), "📷 ModPOS Z, banka POS Z ve banka fişi fotoğrafı panelde");
  assert.equal(photosLine({ z: false, okc: false, pos: false }), null);
  assert.equal(photosLine(null), null);
  assert.match(plain(whatsappText(day, { by: "Zeynep", photos: { z: true, okc: false, pos: false } })), /📷 ModPOS Z fotoğrafı panelde/);
  // Fotoğrafsız rapor eskisiyle aynı
  assert.equal(whatsappText(day, { by: "Zeynep", photos: { z: false, okc: false, pos: false }, photoDiffs: [], cashOuts: [] }), whatsappText(day, { by: "Zeynep" }));
  // Altıdan fazla satır: kalanı tek satırda
  const many = Array.from({ length: 8 }, (_, i) => ({ kind: "harcama" as const, amount: 10, store: `Dükkân ${i + 1}`, description: null, photo: false }));
  const tm = plain(whatsappText({ ...day, cashOut: 80 }, { by: "Zeynep", cashOuts: many }));
  assert.match(tm, /  · Dükkân 6 10 ₺\n  · ve 2 kalem daha\n/);
  assert.doesNotMatch(tm, /Dükkân 7/);

  const m = renderCashReport(day, { by: "Zeynep", revision: 1, submittedAt: new Date("2026-10-21T20:15:00Z"), ...extras });
  assert.match(m.html, /Fotoğraflar panelde: ModPOS Z, banka POS Z</);
  assert.match(renderCashReport(day, { by: "Z", revision: 1, submittedAt: new Date(), photos: { z: true, okc: false, pos: true } }).html, /Fotoğraflar panelde: ModPOS Z, banka fişi</);
  assert.match(plain(m.html), /Fotoğraftan farklı yazılan: Kart \(fotoğrafta 8\.915 ₺\)/);
  assert.match(plain(m.html), /· Migros \(süt, beyaz peynir\) 112,50 ₺ 📷/);
  assert.match(plain(m.text), /📷 ModPOS Z ve banka POS Z fotoğrafı panelde/);
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
  // (ayarlar şube başına: src/lib/branch-settings/groups.ts, kayıt yokken ortamın alıcıları)
  const data = readFileSync(join(process.cwd(), "src/server/data/cash-reports.ts"), "utf8");
  assert.doesNotMatch(data, /[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}/i);
  const groups = readFileSync(join(process.cwd(), "src/lib/branch-settings/groups.ts"), "utf8");
  assert.doesNotMatch(groups, /[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}/i);
  assert.match(groups, /\?\? defaultCashRecipients\(env\)/);
  // Personel alıcı adreslerini görmez (yalnız sayısı gider)
  const page = readFileSync(join(process.cwd(), "src/app/panel/kasa/page.tsx"), "utf8");
  assert.match(page, /const mailTo = showForm \? await cashMailTo\(settings\) : 0;/);
  // E-posta kapalıysa ya da gönderim kurulmamışsa 0: form "e-posta gider" demez (denetim UI-05)
  assert.match(page, /if \(!settings\.emailEnabled \|\| !isEmailConfigured\(\)\) return 0;\n\s+return \(await cashEmailRecipients\(getDb\(\), settings\.recipients\)\)\.length;/);
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
      // Dalga 13: alanın adı "Banka gün sonu" (yazarkasanın kart satırından ayrı; docs/planlar/okc-z.md §6.5)
      ["bankPos", "Banka gün sonu", "8.150 ₺", "—", false],
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
  // Gün içinde giren kasa alanıdır (ertesi gün değişirse onaya gider); gelmeden önceki kopyada yok, 0 sayılır
  const cashIn = revisionChanges(rev(), rev({ cashIn: 250 }));
  assert.deepEqual(cashIn.map((c) => [c.key, c.label, plain(c.from), plain(c.to), c.sensitive]), [["cashIn", "Gün içinde giren", "0 ₺", "250 ₺", true]]);
  const legacy: Partial<CashRevisionData> = { ...rev() };
  delete legacy.cashIn;
  assert.deepEqual(revisionChanges(legacy, rev()), [], "eski kopya ile 0: değişiklik yok (— → 0 ₺ görünmez)");
  assert.deepEqual(revisionChanges(legacy, rev({ cashIn: 250 })).map((c) => plain(changeLine(c))), ["Gün içinde giren: 0 ₺ → 250 ₺"]);
  assert.equal(revisionDataOf({ ...rev(), cashIn: 250 }).cashIn, 250, "sürüm kopyası gireni de saklar");
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
  assert.match(t, /^\*L'Affogato · Gün sonu kasa raporu KR-20261021\* \(güncellendi\)\n21 Ekim Çarşamba · Mehmet · sayan Ayşe\n/);
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
  // Aynı uyarı kutusunda alt alta (email-kit callout: her uyarı kendi satırında)
  assert.match(html, /Önceki devir 620 ₺ \(20 Ekim\): açılış 120 ₺ az<\/div><div[^>]*>22 Ekim açılışı \(1\.200 ₺\) bu devirle tutmuyor<\/div>/);
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
  assert.match(store, /if \(prev && me\.role !== "admin"\) \{[\s\S]*?const laterReport = await hasLaterReport\(tx, data\.date, branchId\);[\s\S]*?staffCashGate\(\{ date: data\.date, now, hasReport: true, laterReport, changes \}\)/);
  // Kilit ve zincir hep şube içinde: kasa raporunun anahtarı (gün, şube) (docs/SUBE.md)
  assert.match(store, /export async function hasLaterReport[\s\S]*?gt\(s\.cashReports\.date, date\), eq\(s\.cashReports\.branchId, branchId\)/);
  // Açılış notu ve önceki sürümün kopyası aynı işlemde, satır kilitliyken
  assert.match(store, /export async function lockCashReport[\s\S]*?\.for\("update"\)/);
  assert.match(store, /export async function writeCashReport[\s\S]*?lockCashReport\(tx, data\.date, o\.branchId\)[\s\S]*?openingNeedsNote\([\s\S]*?tx\.insert\(s\.cashReportRevisions\)/);
  const rules = read("src/server/photo-read/rules.ts");
  assert.match(rules, /export async function staffDayOpen[\s\S]*?staffDayEditable\(day, \{ hasReport: rows\[0\]\?\.date === day, laterReport: rows\.some\(\(r\) => r\.date > day\) \}, now\)/);
  assert.match(rules, /canView[\s\S]*?await staffDayOpen\(row\.date, undefined, undefined, row\.branchId\)/);
  assert.match(rules, /export async function canUploadPhoto[\s\S]*?staffDayOpen\(day\)/);
  for (const route of ["src/app/api/foto/route.ts", "src/app/api/foto/[id]/oku/route.ts"]) assert.match(read(route), /await canUploadPhoto\(/, route);
  // Kasadan çıkanlar: personelin her yolu tek kapıdan (src/server/cash-outs/guard.ts), kapı staffDayOpen'a sorar
  const outs = read("src/server/actions/cash-outs.ts");
  assert.equal(outs.match(/await staffCashOutGate\(/g)?.length, 3);
  assert.match(read("src/server/cash-outs/guard.ts"), /staffDayOpen\(date, tx, now, /);
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
  assert.match(store, /supersede\(tx, \{ kinds: \["kasa-gec"\], subject: cashDaySubject\(data\.date, branchId\) \}, me\.role === "admin" \? "Yönetici günü kendisi girdi"/);
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
