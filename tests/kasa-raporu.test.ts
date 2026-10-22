// Gün sonu kasa raporu: eksik / fazla hesabı, iş günü, WhatsApp metni ve bağlantısı, e-posta şablonu, alıcı adresleri
// (src/lib/cash-report.ts, src/server/notify/cash-report-template.ts) ve yetki kuralları.
// Çalıştırma: npx tsx --test tests/kasa-raporu.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  businessDate,
  computeCash,
  defaultCashRecipients,
  diffKind,
  diffText,
  parseEmails,
  reportSubject,
  staffCanReport,
  waPhone,
  whatsappLink,
  whatsappText,
  type CashReportFields,
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
  assert.match(src, /export async function submitCashReport[\s\S]*?requireUser\(\)[\s\S]*?me\.role !== "admin" && !staffCanReport\(data\.date\)/);
  // Arada başkası gönderdiyse üzerine yazılmaz
  assert.match(src, /if \(prev && prev\.revision !== revision\)/);
  for (const fn of ["deleteCashReport", "updateCashSettings", "sendCashTestEmail"]) {
    assert.match(src, new RegExp(`export async function ${fn}[\\s\\S]*?requireAdmin\\(\\)`), fn);
  }
  // Varsayılan alıcılar kodda değil, ortamda (CASH_REPORT_RECIPIENTS): yerel kurulum gerçek kişilere rapor göndermez
  const data = readFileSync(join(process.cwd(), "src/server/data/cash-reports.ts"), "utf8");
  assert.doesNotMatch(data, /[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}/i);
  assert.match(data, /: defaultCashRecipients\(process\.env\)/);
  // Personel alıcı adreslerini görmez (yalnız sayısı gider)
  const page = readFileSync(join(process.cwd(), "src/app/panel/kasa/page.tsx"), "utf8");
  assert.match(page, /recipients=\{settings\.emailEnabled \? settings\.recipients\.length : 0\}/);
});
