// Marina gün sonu otomasyonunun saf kuralları (docs/LAFPOS.md › Gün sonu otomasyonu): Kasa raporuna yazılan alanlar,
// düzeltmede elle değişen alanın korunması, e-postanın konusu ve "düzeltildi" notu, kıyas; kasa raporunun laffogato.net
// satırının şubesi (site #279); LafPOS kartının wrong_branch metni ve HİZMET'e bağlı ikram adları (sözleşme bulguları).
// Veritabanıyla uçtan uca: tests/lafpos-gun-sonu-db.test.ts.

import assert from "node:assert/strict";
import { test } from "node:test";

import { gunSonuStep } from "../src/lib/job-health";
import { pavoState, pavoSubject, pavoView, renderPavoMail } from "../src/lib/lafpos/bank-pos";
import { bankPosSchema, parsePosDay, type PosDayZ } from "../src/lib/lafpos/day";
import {
  autoMissing,
  autoValuesOf,
  catchUpOrder,
  compareText,
  dayEndPending,
  dayEndSubject,
  dayEndSubjectNoCount,
  dayHash,
  mergeAuto,
  renderDayEnd,
  renderStaffDayEnd,
  type AutoValues,
  type DayEndMail,
} from "../src/lib/lafpos/gun-sonu";
import { unmatchedIkramNames } from "../src/lib/lafpos/ikram";
import { rejectionText, type LafposRejection } from "../src/lib/lafpos/status";
import { siteBranchMatches, siteBranchOf } from "../src/lib/site-sales/calc";

const plain = (v: string) => v.replace(/[\u00a0\u202f]/g, " ");

const Z: PosDayZ = {
  zNo: 14,
  receipts: 63,
  zTotal: 20_000,
  cash: 12_000,
  card: 8_000,
  mealCard: 0,
  online: 0,
  other: 0,
  offRevenue: 250,
  discounts: 100,
  openingCash: 1_500,
  cashOut: 450,
  countedCash: 9_350,
  handedOver: 5_000,
  cashDiff: 0,
  cashIn: 1_300,
  expectedCash: 9_350,
};
const NO_OUTS = { count: 0, total: 0, note: null };

test("Otomatik rapor: LafPOS'un Z'si raporun alanlarına; teslim gün içinde çıkana, Banka POS eksik", () => {
  const v = autoValuesOf("2026-11-22", Z, NO_OUTS, { date: "2026-11-21", amount: 1_500 });
  assert.equal(v.zNo, "14");
  assert.equal(v.zTotal, 20_000);
  assert.equal(v.cashOut, 5_450);
  assert.equal(v.cashIn, 1_300);
  assert.equal(v.handedOver, 0);
  assert.equal(v.countedCash, 9_350);
  assert.equal(v.offRevenue, 250);
  assert.equal(v.discounts, 100);
  // Gün sonu tam (24 Kasım 2026): not cihazların boşluğunu tam söyler, personelden bir şey istemez ("panelden ekleyin" yok)
  assert.equal(v.note, "LafPOS gün sonundan otomatik yazıldı. Eksik: Banka POS: LafPOS\x27tan Pavo gün sonu gelmedi · Yazarkasa: LafPOS\x27ta cihaz belgesi yok.");
  // Panelde Kasadan çıkanlar girildiyse o kaynaktır (E-35)
  const outs = autoValuesOf("2026-11-22", Z, { count: 2, total: 700, note: "Migros, buz" }, null);
  assert.equal(outs.cashOut, 700);
  assert.equal(outs.cashOutNote, "Migros, buz");
  // Açılış önceki devirden farklıysa nota yazılır (uydurulmaz: LafPOS'taki açılış kalır)
  const carry = autoValuesOf("2026-11-22", Z, NO_OUTS, { date: "2026-11-21", amount: 1_000 });
  assert.equal(carry.openingCash, 1_500);
  assert.match(plain(String(carry.note)), /Açılış önceki raporun devrinden 500 ₺ fazla; LafPOS'taki açılış yazıldı\./);
});

test("Sayım yoksa sayılan nakit boş ve eksik (rapor yazılmaz, uydurma değer yok)", () => {
  const v = autoValuesOf("2026-11-22", { ...Z, countedCash: null, cashDiff: null }, NO_OUTS, null);
  assert.equal(v.countedCash, null);
  assert.deepEqual(autoMissing({ countedCash: null }), ["bankPos", "okc", "countedCash"]);
  // Sayım yokken rapor hiç yazılmaz: not cihazların boşluğunu söyler, sayım eksiği lafpos_day_ends.missing ve e-postada
  assert.doesNotMatch(String(v.note), /Sayılan nakit/);
});

test("Düzeltme: elle değişen alan ezilmez, değişmeyen alan LafPOS'un yeni rakamını alır", () => {
  const first = autoValuesOf("2026-11-22", Z, NO_OUTS, null);
  // Personel sayılan nakdi 9.300 diye düzeltti, Banka POS'u ekledi (Banka POS otomatik alan değil)
  const current: AutoValues = { ...first, countedCash: 9_300 };
  const corrected = autoValuesOf("2026-11-22", { ...Z, zTotal: 21_000, cash: 13_000, countedCash: 10_350 }, NO_OUTS, null);
  const m = mergeAuto(current, first, corrected);
  assert.equal(m.values.zTotal, 21_000);
  assert.equal(m.values.cash, 13_000);
  assert.equal(m.values.countedCash, 9_300, "elle düzeltilen sayım kalır");
  assert.deepEqual(m.kept, ["countedCash"]);
  assert.deepEqual(m.changed.sort(), ["cash", "zTotal"]);
  // Bir sonraki düzeltmede de korunur (otomatik değer eskisi kalır)
  assert.equal(m.auto.countedCash, 9_350);
  const again = mergeAuto(m.values, m.auto, { ...corrected, countedCash: 11_000 });
  assert.equal(again.values.countedCash, 9_300);
  // Aynı içerik: değişiklik yok
  assert.deepEqual(mergeAuto(first, first, first).changed, []);
  // Yeni gönderimde sayım yoksa kayıtlı sayım kalır
  assert.equal(mergeAuto(first, first, { ...first, countedCash: null }).values.countedCash, 9_350);
});

test("Günün içerik özeti: aynı içerik aynı, değişen rakam farklı", () => {
  const a = dayHash({ z: Z, payments: [], ikram: [] });
  assert.equal(a, dayHash({ z: { ...Z }, payments: [], ikram: [] }));
  assert.notEqual(a, dayHash({ z: { ...Z, zTotal: 20_001 }, payments: [], ikram: [] }));
});

const mail = (o: Partial<DayEndMail> = {}): DayEndMail => ({
  branchName: "Marina",
  date: "2026-11-22",
  z: Z,
  payments: [
    { name: "Nakit", zField: "cash", channel: null, count: 40, amount: 12_000 },
    { name: "Kredi kartı", zField: "card", channel: null, count: 23, amount: 8_000 },
  ],
  ikram: [{ posName: "LATTE", siteMenuId: null, slot: null, qty: 2, menuValue: 250, reason: "Müşteri" }],
  values: autoValuesOf("2026-11-22", Z, NO_OUTS, null),
  missing: ["bankPos"],
  report: "auto",
  corrected: false,
  yesterday: { date: "2026-11-21", zTotal: 18_000 },
  lastWeek: { date: "2026-11-15", zTotal: null },
  online: 420,
  link: "https://ladmin.laffogato.net/panel/kasa?gun=2026-11-22&sube=marina",
  ...o,
});

test("Gün sonu e-postası: konu Tuzla'nın kasa e-postası biçiminde (şube, tarih, kasa sonucu); ciro, ödemeler, ikram, kasa farkı, Z, kıyas ve bağlantı", () => {
  const m = renderDayEnd(mail());
  assert.equal(m.subject, "Kasa raporu KR-20261122 · Marina · 22 Kasım Pazar · kasa tutuyor");
  assert.ok(!m.subject.endsWith("."));
  const t = plain(m.text);
  assert.match(t, /Toplam satış: 20\.000 ₺/);
  assert.match(t, /Z no · fiş: 14 · 63 fiş/);
  assert.match(t, /· Kredi kartı \(23\): 8\.000 ₺/);
  assert.match(t, /Ödenmez \/ ikram \(Z\): 250 ₺/);
  assert.match(t, /İkram edilen: 2 adet · menü değeri 250 ₺/);
  assert.match(t, /Kasa farkı: tutuyor/);
  assert.match(t, /Dün \(21 Kasım Cumartesi\): 18\.000 ₺ \(%11 fazla\)/);
  assert.match(t, /Geçen hafta \(15 Kasım Pazar\): bilinmiyor/);
  assert.match(t, /Online sipariş: 420 ₺/);
  assert.match(t, /Eksik: Banka POS \(Pavo gün sonu\)\./);
  assert.doesNotMatch(t, /panelde tamamlanacak|panelden ekleyin/i);
  assert.match(t, /Panelde aç: https:\/\/ladmin\.laffogato\.net\/panel\/kasa\?gun=2026-11-22&sube=marina/);
  assert.match(m.html, /Panelde aç/);
  // Maliyet ve kâr hiç yazılmaz
  assert.doesNotMatch(t, /maliyet|kâr|marj/i);
  assert.doesNotMatch(t, /Düzeltildi/);
});

test("Z'nin online alanı paket platformlarının ödemesi: e-postada 'sitede ödendi' yazmaz (site siparişi Z'ye girmez)", () => {
  const t = plain(
    renderDayEnd(
      mail({
        z: { ...Z, card: 7_550, online: 450 },
        payments: [
          { name: "Nakit", zField: "cash", channel: null, count: 40, amount: 12_000 },
          { name: "Yemeksepeti", zField: "online", channel: "yemeksepeti", count: 1, amount: 450 },
        ],
      }),
    ).text,
  );
  assert.match(t, /Online ödeme \(paket platformu\): 450 ₺/);
  assert.match(t, /· Yemeksepeti \(1\): 450 ₺/);
  assert.doesNotMatch(t, /sitede ödendi/);
});

test("Düzeltme e-postası: konuda ve başta 'düzeltildi'; kasa farkı raporun rakamıyla", () => {
  const values = { ...autoValuesOf("2026-11-22", Z, NO_OUTS, null), countedCash: 9_300 };
  const m = renderDayEnd(mail({ corrected: true, report: "updated", values }));
  assert.equal(plain(m.subject), "Kasa raporu KR-20261122 · Marina · 22 Kasım Pazar · 50 ₺ eksik · düzeltildi");
  const t = plain(m.text);
  assert.match(t, /Düzeltildi: LafPOS bu günü yeniden gönderdi/);
  assert.match(t, /Kasa farkı: 50 ₺ eksik/);
  assert.match(t, /elle düzeltilen alanlar korundu/);
});

test("Sayım yoksa e-posta 'sayım yok' der (konuda da), rapor yazılmadığını ve LafPOS'ta nereden sayılacağını söyler", () => {
  const m = renderDayEnd(mail({ z: { ...Z, countedCash: null, cashDiff: null }, values: null, report: "no-count", missing: ["bankPos", "countedCash"] }));
  assert.equal(m.subject, "Kasa raporu KR-20261122 · Marina · 22 Kasım Pazar · sayım yok");
  const t = plain(m.text);
  assert.match(t, /Sayılan nakit: sayım yok/);
  assert.match(t, /Kasa farkı: sayım yok/);
  assert.match(t, /Kasa raporu yazılmadı/);
  assert.match(t, /Kasa › Geçmiş günler › Kasa föyü/);
});

test("konudan sayımsız gün: 'sayım yok' sonuç olarak (sonda ya da ekten önce); eski biçim sayımlı sayılır", () => {
  assert.ok(dayEndSubjectNoCount("Kasa raporu KR-20261122 · Marina · 22 Kasım Pazar · sayım yok"));
  assert.ok(dayEndSubjectNoCount("Kasa raporu KR-20261122 · Marina · 22 Kasım Pazar · sayım yok · Pavo FARK VAR"));
  assert.ok(!dayEndSubjectNoCount("Kasa raporu KR-20261122 · Marina · 22 Kasım Pazar · kasa tutuyor · kasa sayıldı"));
  assert.ok(!dayEndSubjectNoCount("Marina gün sonu · 22 Kasım Pazar"));
});

test("Sayımsız giden gün sayımla gelince: konu 'kasa sayıldı', 'düzeltildi' değil", () => {
  const m = renderDayEnd(mail({ recount: true, corrected: false }));
  assert.equal(m.subject, "Kasa raporu KR-20261122 · Marina · 22 Kasım Pazar · kasa tutuyor · kasa sayıldı");
  const t = plain(m.text);
  assert.match(t, /Önceki e-postada sayım yoktu/);
  assert.doesNotMatch(t, /Düzeltildi/);
});

test("Çalışanların e-postası: sayım varsa 'alındı' ve teşekkür; sayım yoksa uyarı, teşekkür yok", () => {
  const z = { zNo: 14, receipts: 63, zTotal: 20_000, cash: 12_000, card: 8_000, mealCard: 0, other: 0 };
  const ok = renderStaffDayEnd({ branchName: "Marina", date: "2026-11-22", kind: "alindi", z, amounts: false });
  assert.equal(ok.subject, "Marina · gün sonu alındı · 22 Kasım Pazar");
  assert.match(ok.text, /Z no: 14/);
  assert.match(ok.text, /Emeğiniz için teşekkürler/);
  assert.doesNotMatch(ok.text, /Toplam satış/, "tutarlar kapalıyken ciro yok");
  assert.match(plain(renderStaffDayEnd({ branchName: "Marina", date: "2026-11-22", kind: "alindi", z, amounts: true }).text), /Toplam satış: 20\.000,00 ₺/);
  const none = renderStaffDayEnd({ branchName: "Marina", date: "2026-11-22", kind: "sayim-yok", z, amounts: true });
  assert.equal(none.subject, "Marina · kasa sayılmadı · 22 Kasım Pazar");
  assert.match(none.text, /Kasa › Geçmiş günler › Kasa föyü/);
  assert.doesNotMatch(none.text, /teşekkür|alındı|Toplam satış/i);
});

test("Kıyas metni", () => {
  assert.equal(plain(compareText(100, 80)), "80 ₺ (%25 fazla)");
  assert.equal(plain(compareText(80, 100)), "100 ₺ (%20 az)");
  assert.equal(plain(compareText(100, 100)), "100 ₺ (aynı)");
  assert.equal(compareText(100, null), "bilinmiyor");
  assert.equal(dayEndSubject("Marina", "2026-11-23", { result: "sayım yok" }), "Kasa raporu KR-20261123 · Marina · 23 Kasım Pazartesi · sayım yok");
});

test("Günlük işin adımı: yalnız bir şey yapılınca ya da hata varsa", () => {
  assert.equal(gunSonuStep({ status: "off", days: [] }), undefined);
  assert.equal(gunSonuStep({ status: "ok", days: [{ date: "2026-11-22", report: "unchanged", email: "same" }] }), undefined);
  assert.deepEqual(gunSonuStep({ status: "ok", days: [{ date: "2026-11-22", report: "unchanged", email: "sent" }] }), { code: "ok" });
  assert.equal(gunSonuStep({ status: "error", days: [{ date: "2026-11-22", report: "written", email: "failed" }] })?.code, "error");
  assert.equal(gunSonuStep({ status: "error", days: [{ date: "2026-11-22", report: "unchanged", email: "same", staff: "failed" }] })?.code, "error", "çalışan e-postası düştüyse de");
  assert.equal(gunSonuStep({ error: "süre doldu" })?.code, "error");
  // Süre yetmediği için başlanamayan, işi bekleyen gün de hata (e-postası ya da raporu tamamlanmadı)
  assert.deepEqual(gunSonuStep({ status: "error", days: [{ date: "2026-11-21", report: "unchanged", email: "same" }], left: ["2026-11-22"] }), { code: "error", error: "2026-11-22 süre yetmedi" });
  assert.equal(gunSonuStep({ status: "ok", days: [{ date: "2026-11-22", report: "unchanged", email: "same" }], left: [] }), undefined);
});

test("Sabah işinin sırası: işi bekleyen günler önce ve yeniden eskiye (dünkü gün ilk), işlenmiş günler sona", () => {
  const h = "abc";
  // İşi bekleyen: hiç işlenmedi, rapor adımı eski içerikle, e-postası gitmedi (ya da eski içerikle gitti)
  assert.equal(dayEndPending(null, h), true);
  assert.equal(dayEndPending({ doneHash: null, emailedHash: h }, h), true, "rapor yazımı düştü");
  assert.equal(dayEndPending({ doneHash: h, emailedHash: null }, h), true, "e-posta gitmedi");
  assert.equal(dayEndPending({ doneHash: h, emailedHash: "eski" }, h), true, "düzeltmenin e-postası gitmedi");
  assert.equal(dayEndPending({ doneHash: "eski", emailedHash: "eski" }, h), true, "düzeltme gelmiş, işlenmemiş");
  assert.equal(dayEndPending({ doneHash: h, emailedHash: h }, h), false);
  const days = [
    { date: "2026-11-18", pending: false },
    { date: "2026-11-19", pending: true },
    { date: "2026-11-20", pending: false },
    { date: "2026-11-21", pending: true },
    { date: "2026-11-22", pending: true },
  ];
  assert.deepEqual(
    catchUpOrder(days).map((d) => d.date),
    ["2026-11-22", "2026-11-21", "2026-11-19", "2026-11-20", "2026-11-18"],
  );
  assert.deepEqual(days[0].date, "2026-11-18", "girdi değişmez");
});

test("laffogato.net satırı kasanın şubesinden: verilmezse Tuzla; Marina'ya şubesiz (eski) yanıt yazılmaz", () => {
  assert.equal(siteBranchOf(undefined), "tuzla");
  assert.equal(siteBranchOf(null), "tuzla");
  assert.equal(siteBranchOf("tuzla"), "tuzla");
  assert.equal(siteBranchOf("marina"), "marina");
  assert.equal(siteBranchOf("online"), null);
  assert.ok(siteBranchMatches("tuzla", "tuzla"));
  assert.ok(siteBranchMatches("tuzla", undefined), "eski site: hepsi Tuzla'nındı");
  assert.ok(siteBranchMatches("marina", "marina"));
  assert.ok(!siteBranchMatches("marina", undefined), "eski site Marina'nın rakamını veremez");
  assert.ok(!siteBranchMatches("marina", null), "şubesiz toplam Marina'nın değil");
  assert.ok(!siteBranchMatches("tuzla", null), "şubesiz toplam (iki şube) Tuzla'nın değil");
  assert.ok(!siteBranchMatches("tuzla", "marina"));
});

test("LafPOS kartı: yanlış şubeye ayarlı kasa ne yapılacağını söyler (409 wrong_branch)", () => {
  const e: LafposRejection = { at: "2026-11-22T01:00:00Z", status: 409, error: "wrong_branch", field: null, date: "2026-11-21", zNo: null, sentZNo: null, clearedAt: null, sube: "tuzla", expected: "marina" };
  const t = plain(rejectionText(e, "2026-11-22"));
  assert.match(t, /LafPOS'un kasası "tuzla" şubeye ayarlı \(21 Kasım\)/);
  assert.match(t, /"marina" şubesi için alıyor/);
  assert.match(t, /Yönetim › Ayarlar ve yedek › Şube/);
  assert.doesNotMatch(t, /^409 wrong_branch/);
  // Eski kayıtta şube alanları yok: yine açıklar
  assert.match(rejectionText({ ...e, sube: undefined, expected: undefined }, "2026-11-22"), /başka bir şubeye ayarlı/);
});

test("İkramda HİZMET'e bağlı ad (karaoke odası) 'bağlanamayan' listesine girmez; eşleştirmesiz hizmet adı kalır", () => {
  const lines = [
    { date: "2026-11-22", posName: "KARAOKE ODASI", productId: null, isService: true, qty: 1 },
    { date: "2026-11-22", posName: "ETKİNLİK ÜCRETİ", productId: null, isService: false, qty: 1 },
  ];
  assert.deepEqual(
    unmatchedIkramNames(lines, []).items.map((i) => i.posName),
    ["ETKİNLİK ÜCRETİ"],
  );
});

// ---------------------------------------------------------------- Pavo – LafPOS kart karşılaştırması


const PAVO = bankPosSchema.parse({
  status: "ok",
  batchNo: "0042",
  at: "2026-11-22T23:58:00+03:00",
  pavoCard: 8_000,
  lafposCard: 8_000,
  diff: 0,
  acquirers: [{ name: "Garanti", count: 30, total: 8_000 }],
  message: null,
});

test("Pavo: fark 0 'Uyumlu', fark varsa 'FARK VAR' (konu dahil), sonuç alınamadıysa karşılaştırılamadı", () => {
  assert.equal(pavoState(PAVO), "uyumlu");
  assert.match(pavoView(PAVO).headline, /^Uyumlu/);
  const fark = { ...PAVO, pavoCard: 8_120, diff: 120 };
  assert.equal(pavoState(fark), "fark");
  assert.match(plain(pavoView(fark).headline), /^FARK VAR: 120 ₺ \(Pavo fazla\)/);
  assert.equal(pavoSubject("Marina", "2026-11-22", fark), "Kasa raporu KR-20261122 · Marina · 22 Kasım Pazar · Pavo karşılaştırması · FARK VAR");
  assert.equal(pavoSubject("Marina", "2026-11-22", PAVO), "Kasa raporu KR-20261122 · Marina · 22 Kasım Pazar · Pavo karşılaştırması");
  // Fark gelmediyse iki tutardan
  assert.equal(pavoState({ ...PAVO, pavoCard: 7_900, diff: null }), "fark");
  assert.equal(pavoState({ ...PAVO, status: "failed", message: "Pavo yanıt vermedi" }), "yok");
  assert.match(pavoView({ ...PAVO, status: "failed", message: "Pavo yanıt vermedi" }).headline, /alınamadı \(Pavo yanıt vermedi\)/);
  const mail = renderPavoMail({ branchName: "Marina", date: "2026-11-22", bankPos: fark, link: "https://ladmin.laffogato.net/panel/kasa?gun=2026-11-22" });
  assert.match(mail.html, /FARK VAR/);
  assert.match(plain(mail.text), /LafPOS kart toplamı: 8\.000 ₺/);
});

test("Pavo: gün paketi bankPos'suz da geçerli; bozuk bankPos günü reddetmez", () => {
  const body = (extra: Record<string, unknown>) =>
    JSON.stringify({
      version: 1,
      source: "lafpos",
      date: "2026-11-22",
      z: { ...Z },
      lines: [],
      ikram: [],
      payments: [],
      ...extra,
    });
  const now = new Date("2026-11-23T00:30:00+03:00");
  const plainDay = parsePosDay(body({}), now);
  assert.ok(plainDay.ok && plainDay.data.bankPos === undefined, "eski paket");
  const withPavo = parsePosDay(body({ bankPos: PAVO }), now);
  assert.ok(withPavo.ok && withPavo.data.bankPos?.pavoCard === 8_000, "bankPos okundu");
  const broken = parsePosDay(body({ bankPos: { status: "belki" } }), now);
  assert.ok(broken.ok && broken.data.bankPos === undefined, "bozuk bankPos yok sayıldı");
  // Bilinmeyen durum (LafPOS'un eski sürümünün "running"i, ileride gelecek bir durum) karşılaştırmayı düşürmez
  const running = parsePosDay(body({ bankPos: { ...PAVO, status: "running", message: "Cihazda gün sonu sürüyor" } }), now);
  assert.ok(running.ok, "gün yazılır");
  assert.equal(running.data.bankPos?.status, "unknown");
  assert.equal(running.data.bankPos?.pavoCard, 8_000);
  assert.equal(running.data.bankPos?.message, "Cihazda gün sonu sürüyor");
});
