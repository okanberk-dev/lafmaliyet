/**
 * E-posta önizlemesi (npm run eposta:onizleme; docs/BILDIRIMLER.md › E-posta tasarımı): panelin her e-posta şablonunu
 * uydurma örnek verilerle (gerçek kişi ya da rakam yok) üretir, .data/eposta-onizleme/<ad>.html, <ad>.txt (düz metin) ve
 * bir index.html yazar; sonra Playwright'la (kurulu Chromium; kurulum yapılmaz) her birinin 375 px (telefon) ve 640 px
 * (masaüstü) genişlikte, açık ve koyu temada tam sayfa ekran görüntüsünü .data/eposta-onizleme/png/ altına alır ve yatay
 * taşmayı (sayfa genişliği pencereden büyük) bildirir.
 *
 *   npm run eposta:onizleme                     # hepsi, ekran görüntüleriyle
 *   npm run eposta:onizleme -- z-raporu gun-sonu # adı bunlarla başlayanlar
 *   npm run eposta:onizleme -- --png-yok         # yalnız HTML ve metin
 *
 * .data/ depoya girmez (.gitignore).
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { accessEmail, type AccessInfo } from "../src/app/panel/kullanicilar/access";
import type { CashReportFields } from "../src/lib/cash-report";
import type { ChecklistAlert } from "../src/lib/checklist-alerts";
import type { StaffMailSession } from "../src/lib/karaoke/staff-mail";
import { renderPavoMail } from "../src/lib/lafpos/bank-pos";
import type { BankPos, PosDayZ, PosOkc } from "../src/lib/lafpos/day";
import { lafposPhotoCheck, type LafposPhotoCheck } from "../src/lib/lafpos/foto";
import { autoValuesOf, renderDayEnd, renderPhotoMail, renderStaffDayEnd, type DayEndMail } from "../src/lib/lafpos/gun-sonu";
import { okcReadRows } from "../src/lib/photo-read/summary";
import type { AmountRaw, KasaOkc } from "../src/lib/photo-read/schemas";
import type { UpcomingItem } from "../src/lib/reminders";
import { weekInfo, type WeeklyItem } from "../src/lib/weekly/core";
import { renderConnectedNotice } from "../src/server/mcp/notice";
import { renderCashReport } from "../src/server/notify/cash-report-template";
import { renderChecklistAlert } from "../src/server/notify/checklist-alert-template";
import { DB_QUOTA_ABOUT, renderDigest, renderSystemAlert, type DigestBox, type DigestInvoices, type DigestPrices } from "../src/server/notify/digest-template";
import { renderKaraokeReminder } from "../src/server/notify/karaoke-reminder-template";
import { renderStaffMorning, renderStaffSoon } from "../src/server/notify/karaoke-staff-template";
import { renderWeekly } from "../src/server/notify/weekly-template";

type Mail = { subject: string; html: string; text: string };

const OUT = resolve(".data/eposta-onizleme");
const PNG = join(OUT, "png");
const LINK = "https://ladmin.laffogato.net/panel/kasa?gun=2026-11-24&sube=marina";
const H = 3600_000;
/** Türkiye saatiyle an (UTC+3) */
const tr = (date: string, hour: number, minute = 0) => Date.parse(`${date}T00:00:00Z`) - 3 * H + hour * H + minute * 60_000;

// ---------------------------------------------------------------- LafPOS günü (uydurma rakamlar)

const DAY = "2026-11-24";
const amt = (v: number | null, confidence: AmountRaw["confidence"] = "high"): AmountRaw => ({ text: v === null ? null : String(v), value: v, confidence });
const NONE: AmountRaw = { text: null, value: null, confidence: "high" };

/** Pavo'nun detaylı Z'si: banka gün sonu ve Z rakamları aynı fişte */
const detailedZ = (o: { card?: number; cash?: number; total?: number } = {}): KasaOkc => ({
  documentType: "z_report",
  fiscalMarks: { mfLogo: true, ekuNo: true, cumulativeLines: true, vatBlock: true },
  readable: true,
  title: "Z RAPORU",
  date: DAY,
  time: "23:10",
  dateConfidence: "high",
  zNo: { text: "0007", value: 7, confidence: "high" },
  receiptCount: { text: "63", value: 63, confidence: "high" },
  dailyTotal: amt(o.total ?? 11_190),
  dailyTotalLabel: "TOPLAM",
  kdvGroups: [{ rate: 10, total: amt(11_190), vat: amt(1_017.27), base: null }],
  totalVat: amt(1_017.27),
  payments: [
    { label: "NAKİT", count: null, amount: amt(o.cash ?? 3_390), kind: "cash" },
    { label: "KREDİ KARTI", count: null, amount: amt(o.card ?? 7_800), kind: "card" },
  ],
  outside: [],
  voids: amt(null),
  discounts: amt(null),
  cumulativeTotal: amt(null),
  cumulativeVat: amt(null),
  batches: [
    { bank: "Garanti BBVA", batchNo: "000278", date: DAY, salesTotal: amt(2_400), refundTotal: amt(null), netTotal: amt(2_400), transactionCount: null },
    { bank: "Garanti BBVA", batchNo: "000279", date: DAY, salesTotal: amt(5_400), refundTotal: amt(null), netTotal: amt(5_400), transactionCount: null },
  ],
  issues: [],
});

const batch = (batchNo: string, total: number, dayClosed = true) => ({ batchNo, at: "2026-11-24T20:00:00.000Z", total, trigger: "elle" as const, dayClosed });
const BANK: BankPos = {
  status: "ok",
  batchNo: "000279",
  at: "2026-11-24T20:10:00.000Z",
  pavoCard: 5_400,
  lafposCard: 5_400,
  diff: 0,
  acquirers: [{ name: "Garanti BBVA", count: 31, total: 5_400 }],
  message: null,
  errorCode: null,
  batches: [batch("000278", 2_400, false), batch("000279", 5_400)],
  dayCard: 7_800,
};
const BANK_FARK: BankPos = { ...BANK, pavoCard: 5_520, diff: 120, acquirers: [{ name: "Garanti BBVA", count: 32, total: 5_520 }], batches: [batch("000278", 2_400, false), batch("000279", 5_520)] };
const OKC: PosOkc = {
  provider: "pavo",
  zReport: false,
  docs: 63,
  cash: 3_390,
  card: 7_800,
  mealCard: 0,
  other: 0,
  total: 11_190,
  voided: { count: 0, cash: 0, card: 0 },
  vat: [{ rate: 10, total: 11_190, vat: 1_017.27 }],
};
const REPORT = { bankPos: 7_800, okcZNo: "7", okcTotal: 11_190, okcCash: 3_390, okcCard: 7_800, okcMealCard: 0, okcOther: 0, okcVat: [{ rate: 10, total: 11_190, vat: 1_017.27 }], lafposZNo: "7" };
const NOW = new Date("2026-11-25T00:30:00+03:00");
const check = (raw: KasaOkc, o: { source?: "ai" | "kod"; model?: string } = {}): LafposPhotoCheck =>
  lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw, error: null, source: o.source ?? "ai", model: o.model ?? "claude-haiku-5-5" }], bankPos: BANK, okc: OKC, report: REPORT }, NOW);

const UYUMLU = check(detailedZ());
const FARK = check(detailedZ({ card: 7_920, cash: 3_270 }), { model: "claude-opus-5-5" });
const BELIRSIZ: LafposPhotoCheck = {
  at: NOW.toISOString(),
  photos: 1,
  state: "belirsiz",
  source: "kod",
  model: "kod-ocr",
  rows: [
    { label: "Yazarkasa toplamı", photo: "11.190 ₺", lafpos: "11.190 ₺", ok: true },
    { label: "Yazarkasa kartı", photo: "okunamadı", lafpos: "7.800 ₺", ok: false, unread: true },
  ],
  issues: [],
  readBankPos: null,
};
const OKUNAMADI: LafposPhotoCheck = { at: NOW.toISOString(), photos: 1, state: "okunamadi", source: "ai", model: "claude-haiku-5-5", rows: [], issues: [], readBankPos: null };
const UNREADABLE: KasaOkc = { ...detailedZ(), documentType: "other", readable: false, zNo: NONE, receiptCount: NONE, dailyTotal: NONE, payments: [], kdvGroups: [], totalVat: NONE, batches: [] };

const Z: PosDayZ = {
  zNo: 7,
  receipts: 63,
  zTotal: 11_190,
  cash: 3_390,
  card: 7_800,
  mealCard: 0,
  online: 0,
  other: 0,
  offRevenue: 250,
  discounts: 120,
  openingCash: 1_500,
  cashOut: 450,
  countedCash: 4_320,
  handedOver: 0,
  cashDiff: -120,
  cashIn: 0,
  expectedCash: 4_440,
};
const NO_OUTS = { count: 0, total: 0, note: null };
const dayEnd = (o: Partial<DayEndMail> = {}): DayEndMail => ({
  branchName: "Marina",
  date: DAY,
  z: Z,
  payments: [
    { name: "Nakit", zField: "cash", channel: null, count: 32, amount: 3_390 },
    { name: "Kredi kartı", zField: "card", channel: null, count: 31, amount: 7_800 },
  ],
  ikram: [{ posName: "LATTE", siteMenuId: null, slot: null, qty: 2, menuValue: 250, reason: "Müşteri" }],
  values: autoValuesOf(DAY, Z, NO_OUTS, null),
  missing: [],
  report: "auto",
  corrected: false,
  yesterday: { date: "2026-11-23", zTotal: 9_800 },
  lastWeek: { date: "2026-11-17", zTotal: 12_400 },
  online: 640,
  link: LINK,
  bankPos: BANK,
  okc: OKC,
  photo: { need: { slip: true, z: false, count: 1 }, attached: 1, check: UYUMLU, reads: [okcReadRows(detailedZ())] },
  ...o,
});
const EVEN_Z: PosDayZ = { ...Z, countedCash: 4_440, cashDiff: 0 };

// ---------------------------------------------------------------- Tuzla kasa raporu (ModPOS)

const CASH_DAY: CashReportFields = {
  date: "2026-11-24",
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

// ---------------------------------------------------------------- Sabah e-postası

const item = (over: Partial<UpcomingItem>): UpcomingItem => ({
  ref: "reminder:1",
  source: "reminder",
  sourceId: 1,
  kind: "kira",
  title: "Kira",
  detail: null,
  amount: 25_000,
  dueDate: "2026-11-25",
  daysLeft: 0,
  status: "today",
  remindDaysBefore: 3,
  repeat: "monthly",
  ...over,
});
const DIGEST_ROWS = [
  { item: item({ ref: "invoice:23", source: "invoice", sourceId: 23, kind: "fatura", title: "Örnek Süt Ltd.", detail: "Fatura ÖRN2026 · vade tahmini (30 gün)", amount: 12_500.5, dueDate: "2026-11-18", daysLeft: -7, status: "overdue", repeat: "none" }), stage: "overdue" as const },
  { item: item({ title: "Kira" }), stage: "due" as const },
  { item: item({ title: "Muhasebe ücreti", amount: 4_000, dueDate: "2026-11-28", daysLeft: 3, status: "soon" }), stage: "before" as const },
  { item: item({ title: "Su faturası", amount: null, dueDate: "2026-11-27", daysLeft: 2, status: "soon" }), stage: "before" as const },
];
const DIGEST_SYSTEM = { items: [{ title: "Dünkü sabah işi çalışmadı (24 Kasım)", body: "08:00–09:00 arasında çalışması gerekiyordu: sabah e-postası gitmedi." }] };
/** Paraşüt bölümünün her parçası: yeni faturalar (biri vadeli, biri kontrol bekliyor), kontrol, kasadan alım, fiyat onayı */
const DIGEST_INVOICES: DigestInvoices = {
  items: [
    { supplier: "Örnek Kahve A.Ş.", date: "2026-11-24", payable: 8_640, category: "Mal alışı", needsReview: true },
    { supplier: "Örnek Ambalaj Ltd. Şti.", date: "2026-11-24", payable: 1_212.75, category: "Ambalaj", needsReview: false, unpaid: true, dueDate: "2026-12-24" },
  ],
  reviewCount: 2,
  stockOnlyCount: 1,
  cashOuts: { count: 1, summary: "Örnek Market 640 ₺" },
  priceHolds: { count: 2, fresh: 1, items: [{ name: "Süt", pct: 0.52 }, { name: "Çikolata sosu", pct: -0.45 }] },
};
const DIGEST_PRICES: DigestPrices = {
  changes: [
    { name: "Süt", unit: "ml", before: 0.042, after: 0.048, pct: 0.14, monthly: 690 },
    { name: "Espresso çekirdeği", unit: "gr", before: 0.62, after: 0.68, pct: 0.1, monthly: 1_180 },
    { name: "Karton bardak 12 oz", unit: "adet", before: 2.1, after: 2.4, pct: 0.14 },
  ],
  products: [
    { name: "Latte", size: "M", price: 120, suggestedPrice: 135, basis: "target", ratioBefore: 0.31, ratioAfter: 0.36 },
    { name: "Mocha", size: "L", price: 150, suggestedPrice: 158, basis: "keep", ratioBefore: 0.33, ratioAfter: 0.37 },
  ],
  productCount: 2,
  monthlyTotal: 1_870,
  basisMonth: "2026-10",
};
const COMMISSION_BOX: DigestBox = {
  title: "Komisyon ve hakediş",
  lines: [
    { strong: "Hakediş gecikti: Örnek Kart (Ekim)", text: "Beklenen ≈ 1.234 ₺; son gün 20 Kasım'dı" },
    { text: "Yemek kartı oranı %7,2 (sınır %6) olabilir", tone: "bad" },
  ],
  href: "/panel/komisyonlar",
  link: "Komisyon & hakediş'te aç",
  subjectPart: "Hakediş gecikti: Örnek Kart (Ekim)",
  headline: "Hakediş gecikti: Örnek Kart (Ekim)",
};
const KONTROL_BOX: DigestBox = {
  title: "Kontrol listeleri · 24 Kasım Salı",
  lines: [
    { strong: "Kapanış", text: "hiç açılmadı" },
    { text: "Buzdolabı: 6 °C (0–4 °C) · Ayşe: kapı açık kalmış", tone: "bad" },
    { text: "Dün kasa raporu da girilmedi; kafe kapalıysa bu bölümü önemsemeyin.", tone: "muted" },
  ],
  href: "/panel/kontrol/gecmis?gun=2026-11-24",
  link: "Kontrol geçmişi",
  subjectPart: "dünkü kapanış listesi eksik",
  headline: "Dünkü kontrol listelerinde eksik var",
};
const APPROVALS_BOX: DigestBox = {
  title: "Onay bekleyenler",
  lines: [{ strong: "1 personel isteği onay bekliyor", text: "24 Kasım kasa düzeltmesi (Mehmet)" }],
  href: "/panel/onaylar",
  link: "Onaylar'ı aç",
  subjectPart: "1 istek onay bekliyor",
  headline: "1 personel isteği onay bekliyor",
};
const FORECAST_BOX: DigestBox = { title: "Karaoke", lines: [{ text: "Bugün 3 rezervasyon · 1 rezervasyonsuz" }, { text: "Oda 20:00'de dolu", tone: "muted" }], href: "/panel/karaoke", link: "Ayrıntı", subjectPart: null, headline: null };

// ---------------------------------------------------------------- Karaoke

function session(o: Partial<StaffMailSession> & { id: number; hour: number }): StaffMailSession {
  const startsAt = tr("2026-11-25", o.hour);
  return {
    source: "site",
    date: "2026-11-25",
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(startsAt + 2 * H).toISOString(),
    extraMinutes: 0,
    endedAt: null,
    guests: 4,
    customerName: "Deniz",
    note: null,
    status: "confirmed",
    paymentStatus: "paid",
    desk: null,
    ...o,
  };
}
const KARAOKE = [session({ id: 1, hour: 14, paymentStatus: "none", desk: "booking", customerName: "Ece", guests: 6 }), session({ id: 2, hour: 20 })];

// ---------------------------------------------------------------- Haftalık özet

const weekly = (source: WeeklyItem["source"], tl: number | null, o: Partial<WeeklyItem>): WeeklyItem => ({ key: `${source}:1`, source, title: "", detail: null, tl, href: "/panel", action: "Aç", ...o });
const NB = " ";

// ---------------------------------------------------------------- Örnekler

const SAMPLES: { name: string; title: string; mail: () => Mail }[] = [
  { name: "z-raporu-tutuyor", title: "Z raporu · tutuyor", mail: () => renderPhotoMail({ branchName: "Marina", date: DAY, check: UYUMLU, link: LINK, reads: [okcReadRows(detailedZ())], by: "Ayşe", attachments: 1 }) },
  {
    name: "z-raporu-farkli",
    title: "Z raporu · LafPOS'tan farklı",
    mail: () => renderPhotoMail({ branchName: "Marina", date: DAY, check: FARK, link: LINK, reads: [okcReadRows(detailedZ({ card: 7_920, cash: 3_270 }))], by: "Mehmet", attachments: 1 }),
  },
  { name: "z-raporu-okunamadi", title: "Z raporu · okunamadı", mail: () => renderPhotoMail({ branchName: "Marina", date: DAY, check: OKUNAMADI, link: LINK, reads: [okcReadRows(UNREADABLE)], by: "Ayşe", attachments: 1 }) },
  { name: "z-raporu-belirsiz", title: "Z raporu · yönetici baksın", mail: () => renderPhotoMail({ branchName: "Marina", date: DAY, check: BELIRSIZ, link: LINK, by: "Ayşe", attachments: 2 }) },
  { name: "gun-sonu-eksik", title: "Gün sonu · 120 ₺ eksik", mail: () => renderDayEnd(dayEnd()) },
  {
    name: "gun-sonu-tutuyor",
    title: "Gün sonu · kasa tutuyor, Pavo farkı, fotoğraf farkı, düzeltme",
    mail: () =>
      renderDayEnd(
        dayEnd({
          z: EVEN_Z,
          values: autoValuesOf(DAY, EVEN_Z, NO_OUTS, null),
          corrected: true,
          bankPos: BANK_FARK,
          photo: { need: { slip: true, z: false, count: 1 }, attached: 1, check: FARK, reads: [okcReadRows(detailedZ({ card: 7_920, cash: 3_270 }))] },
          detail: { sections: [{ title: "Yazarkasadan geçmeyen", rows: [["Cari tahsilatı (kart)", "195 ₺"]] }], refunds: [], correction: "Düzeltme: gün yeniden açıldı (Geç gelen masa)" },
        }),
      ),
  },
  { name: "gun-sonu-sayim-yok", title: "Gün sonu · sayım yok", mail: () => renderDayEnd(dayEnd({ z: { ...Z, countedCash: null, cashDiff: null }, values: null, report: "no-count", missing: ["countedCash"], photo: null, bankPos: null, okc: null })) },
  { name: "pavo", title: "Pavo karşılaştırması · fark", mail: () => renderPavoMail({ branchName: "Marina", date: DAY, bankPos: BANK_FARK, link: LINK }) },
  { name: "personel-gun-sonu", title: "Personel · gün sonu alındı", mail: () => renderStaffDayEnd({ branchName: "Marina", date: DAY, kind: "alindi", z: Z, amounts: true }) },
  { name: "personel-sayim-yok", title: "Personel · kasa sayılmadı", mail: () => renderStaffDayEnd({ branchName: "Marina", date: DAY, kind: "sayim-yok", z: Z, amounts: false }) },
  { name: "kasa-raporu", title: "Kasa raporu (Tuzla, ModPOS)", mail: () => renderCashReport(CASH_DAY, { by: "Zeynep", revision: 1, submittedAt: new Date("2026-11-24T20:15:00Z"), branch: { id: "tuzla", name: "Tuzla" } }) },
  {
    name: "sabah-ozeti",
    title: "Sabah e-postası · ödemeler, faturalar, zam",
    mail: () =>
      renderDigest(
        DIGEST_ROWS,
        "2026-11-25",
        { items: [{ supplier: "Örnek Kahve A.Ş.", date: "2026-11-24", payable: 8_640, category: "Mal alışı", needsReview: true }], reviewCount: 1 },
        { changes: [{ name: "Süt", unit: "ml", before: 0.042, after: 0.048, pct: 0.14, monthly: 690 }], products: [], productCount: 0 },
      ),
  },
  {
    name: "sabah-ozeti-kutular",
    title: "Sabah e-postası · ödemesiz: Paraşüt bölümü, ek kutular, zam ve ürünler",
    mail: () => renderDigest([], "2026-11-25", DIGEST_INVOICES, DIGEST_PRICES, null, { commission: COMMISSION_BOX, kontrol: KONTROL_BOX, approvals: APPROVALS_BOX, forecast: FORECAST_BOX }),
  },
  {
    name: "sabah-ozeti-sistem",
    title: "Sabah e-postası · sistem uyarısı, eşitleme hatası, şube",
    mail: () => renderDigest(DIGEST_ROWS.slice(1, 2), "2026-11-25", { items: [], reviewCount: 0, syncError: "Paraşüt 401: oturumun süresi doldu" }, null, DIGEST_SYSTEM, { kontrol: KONTROL_BOX }, "Marina"),
  },
  { name: "sabah-ozeti-bos", title: "Sabah e-postası · yeni bir şey yok", mail: () => renderDigest([], "2026-11-25", null, null, null, { forecast: FORECAST_BOX }) },
  { name: "sistem-uyarisi", title: "Sistem uyarısı", mail: () => renderSystemAlert([{ title: "Dünkü sabah işi çalışmadı", body: "Sabah e-postası ve eşitlemeler dün yapılmadı." }], "2026-11-25") },
  {
    name: "sistem-uyarisi-iki",
    title: "Sistem uyarısı · iki sorun",
    mail: () =>
      renderSystemAlert(
        [DIGEST_SYSTEM.items[0], { title: "Paraşüt işi bu sabah çalışmadı", body: "07:00–08:00 arasında çalışması gerekiyordu; eşitlemeyi sabah işi yapacak." }],
        "2026-11-25",
      ),
  },
  {
    name: "sistem-uyarisi-kota",
    title: "Sistem uyarısı · veritabanı kotası",
    mail: () => renderSystemAlert([{ title: "Veritabanının %90'ı doldu", body: "512 MB kotanın 463 MB'ı kullanılıyor; dolunca panel kayıt yazamaz." }], "2026-11-25", DB_QUOTA_ABOUT),
  },
  {
    name: "kontrol-listesi",
    title: "Kontrol listesi hatırlatması",
    mail: () => {
      const alert: ChecklistAlert = { key: "k", kind: "late", templateId: 3, listName: "Açılış", branchId: "marina", slot: "10:00", until: "11:00", missing: ["Buzdolabı ısısı", "Kahve makinesi temizliği", "Vitrin düzeni"] };
      return renderChecklistAlert([alert], "2026-11-25");
    },
  },
  { name: "karaoke-personel-sabah", title: "Karaoke · personel sabah listesi", mail: () => renderStaffMorning(KARAOKE, "2026-11-25") },
  { name: "karaoke-personel-3-saat", title: "Karaoke · 3 saat kala", mail: () => renderStaffSoon(KARAOKE[0], tr("2026-11-25", 11)) },
  {
    name: "karaoke-misafir",
    title: "Karaoke · misafir hatırlatması",
    mail: () => renderKaraokeReminder({ firstName: "Ece", date: "2026-11-25", startsAt: tr("2026-11-25", 20), endsAt: tr("2026-11-25", 22), guests: 6, paid: false, nowMs: tr("2026-11-24", 20), siteUrl: "https://laffogato.net/" }),
  },
  {
    name: "haftalik-ozet",
    title: "Haftalık özet",
    mail: () =>
      renderWeekly(
        {
          week: weekInfo("2026-11-23"),
          items: [
            weekly("nakit", 12_400, { title: `30 Kasım Pazartesi para yetmeyebilir: tahmini −12.400${NB}₺`, href: "/panel/hatirlaticilar/nakit", action: "Nakit planını aç", detail: "O gün: Kira" }),
            weekly("zam", 4_800, { title: `Latte: Süt %14 zammı ayda ≈ 4.800${NB}₺ kâr kaybı`, href: "/panel/urunler#zamlar", action: "Fiyatlara bak" }),
          ],
          lines: [`Geçen hafta kasa cirosu 68.900${NB}₺ · önceki 4 haftaya göre %12 az`],
          failed: [],
        },
        { today: "2026-11-23" },
      ),
  },
  {
    name: "haftalik-ozet-ornek",
    title: "Haftalık özet · örnek, beş madde, okunamayan",
    mail: () =>
      renderWeekly(
        {
          week: weekInfo("2026-11-23"),
          items: [
            weekly("nakit", 12_400, { title: `30 Kasım Pazartesi para yetmeyebilir: tahmini −12.400${NB}₺`, href: "/panel/hatirlaticilar/nakit", action: "Nakit planını aç", detail: "O gün: Kira" }),
            weekly("zam", 4_800, { title: `Latte: Süt %14 zammı ayda ≈ 4.800${NB}₺ kâr kaybı`, href: "/panel/urunler#zamlar", action: "Fiyatlara bak" }),
            weekly("komisyon", 3_200, { title: "Hakediş gecikti: Örnek Kart (Ekim)", href: "/panel/komisyonlar?ay=2026-10", action: "Komisyon & hakedişe bak" }),
            weekly("kasa", 640, { title: `Kasa 3 günde toplam 640${NB}₺ eksik`, href: "/panel/kasa?ay=2026-11", action: "Kasa raporlarına bak", detail: "En büyüğü 18 Kasım Salı: 420 ₺ (Marina)" }),
            weekly("karaoke", null, { title: "Salı–Perşembe 14–17 karaoke %12 dolu", href: "/panel/karaoke/doluluk", action: "Doluluğa bak" }),
          ],
          lines: [`Geçen hafta kasa cirosu 68.900${NB}₺ · önceki 4 haftaya göre %12 az`],
          failed: ["stok"],
        },
        { today: "2026-11-24", sample: true },
      ),
  },
  { name: "haftalik-ozet-sakin", title: "Haftalık özet · sakin hafta", mail: () => renderWeekly({ week: weekInfo("2026-11-23"), items: [], lines: [], failed: ["nakit", "karaoke"] }, { today: "2026-11-23" }) },
  { name: "claude-baglandi", title: "Claude bağlantısı", mail: () => renderConnectedNotice({ name: "Okan", label: "Claude", host: "claude.ai", at: new Date("2026-11-25T09:12:00Z"), base: "https://ladmin.laffogato.net" }) },
  ...(["invite", "password", "reset"] as const).map((kind) => ({
    name: `erisim-${kind}`,
    title: `Giriş bilgileri · ${kind}`,
    mail: () => {
      const info: AccessInfo = {
        kind,
        userId: 7,
        name: "Ayşe Örnek",
        email: "ayse@example.com",
        loginUrl: "https://ladmin.laffogato.net/giris",
        ...(kind === "password" ? { password: "deneme-parola-123" } : { link: "https://ladmin.laffogato.net/davet?t=ornek", expiresAt: "2026-11-27T20:00:00.000Z" }),
      };
      return accessEmail(info);
    },
  })),
];

// ---------------------------------------------------------------- Yazım ve ekran görüntüsü

interface PwPage {
  goto(url: string): Promise<unknown>;
  screenshot(o: { path: string; fullPage: boolean }): Promise<unknown>;
  evaluate<T>(fn: () => T): Promise<T>;
}
interface PwContext {
  newPage(): Promise<PwPage>;
  close(): Promise<void>;
}
interface PwBrowser {
  newContext(o: { viewport: { width: number; height: number }; deviceScaleFactor: number; colorScheme: "light" | "dark" }): Promise<PwContext>;
  close(): Promise<void>;
}

const escHtml = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function main() {
  const args = process.argv.slice(2);
  const noPng = args.includes("--png-yok");
  const filters = args.filter((a) => !a.startsWith("--"));
  const list = filters.length ? SAMPLES.filter((s) => filters.some((f) => s.name.startsWith(f))) : SAMPLES;
  if (!list.length) throw new Error(`Eşleşen örnek yok. Adlar: ${SAMPLES.map((s) => s.name).join(", ")}`);
  // Hepsi üretilirken eski ekran görüntüleri silinir (adı değişen örneğin eskisi kalmasın)
  if (!filters.length) rmSync(PNG, { recursive: true, force: true });
  mkdirSync(PNG, { recursive: true });

  const rendered = list.map((s) => ({ ...s, out: s.mail() }));
  for (const r of rendered) {
    writeFileSync(join(OUT, `${r.name}.html`), r.out.html);
    writeFileSync(join(OUT, `${r.name}.txt`), `${r.out.subject}\n\n${r.out.text}\n`);
  }
  const shots = [375, 640].flatMap((w) => (["light", "dark"] as const).map((c) => ({ w, c })));
  writeFileSync(
    join(OUT, "index.html"),
    `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>E-posta önizlemesi</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#171717;background:#fafafa}li{margin:0 0 14px}small{color:#6b6b74}a{color:#171717}.s{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}.s a{font-size:13px}</style></head>
<body><h1>E-posta önizlemesi</h1><p>${rendered.length} şablon · uydurma örnek veriler · <code>npm run eposta:onizleme</code></p><ol>
${rendered
  .map(
    (r) =>
      `<li><a href="${r.name}.html"><strong>${escHtml(r.title)}</strong></a> · <a href="${r.name}.txt">düz metin</a><br><small>${escHtml(r.out.subject)}</small><div class="s">${shots
        .map(({ w, c }) => `<a href="png/${r.name}-${w}-${c}.png">${w} px ${c === "light" ? "açık" : "koyu"}</a>`)
        .join("")}</div></li>`,
  )
  .join("\n")}
</ol></body></html>`,
  );
  console.log(`${rendered.length} e-posta yazıldı: ${OUT}`);
  if (noPng) return;

  // Playwright projeye kurulu değil; makinedeki genel kurulumdan (NODE_PATH) yüklenir
  const req = createRequire(join(process.cwd(), "package.json"));
  let chromium: { launch(): Promise<PwBrowser> };
  try {
    chromium = (req("playwright") as { chromium: typeof chromium }).chromium;
  } catch {
    console.error("Playwright bulunamadı; ekran görüntüsü alınmadı (HTML ve metin yazıldı). Kurulum yapılmaz.");
    return;
  }
  const browser = await chromium.launch();
  const overflow: string[] = [];
  try {
    for (const { w, c } of shots) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1, colorScheme: c });
      const page = await ctx.newPage();
      for (const r of rendered) {
        await page.goto(pathToFileURL(join(OUT, `${r.name}.html`)).href);
        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        if (width > w) overflow.push(`${r.name} ${w} px ${c}: sayfa ${width} px`);
        await page.screenshot({ path: join(PNG, `${r.name}-${w}-${c}.png`), fullPage: true });
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`${rendered.length * shots.length} ekran görüntüsü: ${PNG}`);
  if (overflow.length) {
    console.log(`Yatay taşma (${overflow.length}):\n${overflow.map((x) => `  ${x}`).join("\n")}`);
    process.exitCode = 1;
  } else console.log("Yatay taşma yok.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
