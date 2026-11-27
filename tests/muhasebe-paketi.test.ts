// Muhasebeci paketi (docs/MUHASEBE-PAKETI.md): ayarlar, gönderim günü, özet (karar bekleyen toplama girmez), çalışma
// kitabının sekmeleri ve toplamları, e-postanın metni. Veritabanı yok.
// Çalıştırma: npx tsx --test tests/muhasebe-paketi.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import ExcelJS from "exceljs";

import {
  autoSendMonth,
  buildPackageWorkbook,
  packageFileName,
  packageSummary,
  parsePackageSettings,
  readRecipients,
  type PackageData,
} from "../src/lib/muhasebe/paket";
import { renderPackageMail } from "../src/server/notify/muhasebe-template";

const base = { recipients: ["muhasebe@ornek.com"], auto: true, last: null, autoMonth: null };

test("ayarlar: bozuk alan varsayılana döner, geçersiz adres atlanır, adresler küçük harf ve tekil", () => {
  assert.deepEqual(parsePackageSettings(null), { recipients: [], auto: true, last: null, autoMonth: null }, "boş değer varsayılan olmalı");
  const p = parsePackageSettings({ recipients: ["A@Ornek.com", "a@ornek.com", "bozuk", 5], auto: false, last: { month: "2026-13", at: "x", to: [] }, autoMonth: "2026-10" });
  assert.deepEqual(p.recipients, ["a@ornek.com"], "geçersiz adres atlanmalı, aynı adres bir kez");
  assert.equal(p.auto, false, "kapalı ayar korunmalı");
  assert.equal(p.last, null, "bozuk son gönderim atlanmalı");
  assert.equal(p.autoMonth, "2026-10", "kendiliğinden gönderilen ay okunmalı");
});

test("alıcı metni: virgül, boşluk ya da satırla ayrılır; geçersiz adres ve fazlası reddedilir", () => {
  assert.deepEqual(readRecipients(" a@x.com,\nB@x.com ; a@x.com "), { ok: true, emails: ["a@x.com", "b@x.com"] }, "ayraçlar ve tekrar");
  assert.deepEqual(readRecipients(""), { ok: true, emails: [] }, "boş metin geçerli (e-posta gitmez)");
  const bad = readRecipients("a@x.com muhasebe");
  assert.ok(!bad.ok && /"muhasebe" geçerli bir e-posta adresi değil/.test(bad.error), "geçersiz adres söylenmeli");
  const many = readRecipients("1@x.com 2@x.com 3@x.com 4@x.com 5@x.com 6@x.com");
  assert.ok(!many.ok && /En çok 5/.test(many.error), "beşten fazla adres reddedilmeli");
});

test("gönderim günü: ayın 1'i (2'si, 3'ü yedek), geçen ay için, bir kez", () => {
  assert.deepEqual(autoSendMonth("2026-12-01", base), { month: "2026-11" }, "ayın 1'inde geçen ay");
  assert.deepEqual(autoSendMonth("2027-01-03", base), { month: "2026-12" }, "3'ünde de (sabah işi kaçtıysa), yıl dönümünde aralık");
  assert.deepEqual(autoSendMonth("2026-12-04", base), { skip: "day" }, "4'ünde gitmez");
  assert.deepEqual(autoSendMonth("2026-12-01", { ...base, auto: false }), { skip: "off" }, "ayar kapalıysa gitmez");
  assert.deepEqual(autoSendMonth("2026-12-01", { ...base, recipients: [] }), { skip: "norecipient" }, "alıcı yoksa gitmez");
  assert.deepEqual(autoSendMonth("2026-12-02", { ...base, autoMonth: "2026-11" }), { skip: "sent" }, "aynı ay ikinci kez gitmez");
});

const DATA: PackageData = {
  month: "2026-10",
  scope: "Bütün şubeler",
  createdAt: new Date("2026-11-01T06:00:00.000Z"),
  closed: { at: "2026-11-05T09:00:00.000Z", by: "Okan" },
  invoices: [
    { date: "2026-10-03", accountDate: "2026-10-03", supplier: "Sütçü & Oğulları", taxNumber: "123", invoiceNo: "A1", category: "Hammadde & İçecek", amount: 1000, discount: 0, vat: 100, payable: 1100, unpaid: false, branch: "Tuzla", source: "Paraşüt", status: null },
    { date: "2026-10-20", accountDate: "2026-10-20", held: true, supplier: "Geç", taxNumber: null, invoiceNo: null, category: "Ambalaj", amount: 500, discount: 0, vat: 100, payable: 600, unpaid: true, branch: "Marina", source: "Paraşüt", status: "Ekim 2026 kapalı döneme düştü" },
    { date: "2026-10-28", accountDate: "2026-11-12", supplier: "Alınan", taxNumber: null, invoiceNo: null, category: "Ambalaj", amount: 50, discount: 0, vat: 10, payable: 60, unpaid: true, branch: "Marina", source: "Elle", status: "Kasım'da sayılır" },
  ],
  expenses: [{ date: "2026-10-12", accountDate: "2026-10-12", category: "Temizlik", description: "Deterjan", amount: 200, vat: 33.33, payment: "Nakit", document: "Fiş", branch: "Tuzla", status: null }],
  cash: [
    { date: "2026-10-01", branch: "Tuzla", zNo: "1", zTotal: 5000, cash: 2000, card: 3000, mealCard: 0, online: 0, other: 0, cashOut: 100, cashDiff: -5, okcZNo: "77", okcTotal: 4800, okcVat: 436.36 },
  ],
  vat: [
    { date: "2026-10-01", branch: "Tuzla", zNo: "77", rate: 10, total: 4400, vat: 400 },
    { date: "2026-10-01", branch: "Tuzla", zNo: "77", rate: 20, total: 400, vat: 66.67 },
  ],
  fixed: [{ name: "Kira", section: "Kira", amount: 120000, period: "Yıllık", monthly: 10000, branch: "Tuzla", note: null }],
};

test("özet: karar bekleyen ve başka aya alınan fatura toplama girmez; KDV oran oran", () => {
  const s = packageSummary(DATA);
  assert.equal(s.invoices, 1, "yalnız bu ayda sayılan fatura");
  assert.equal(s.invoicePayable, 1100, "ödenecek toplamı yalnız sayılanlardan");
  assert.equal(s.heldInvoices, 1, "karar bekleyen ayrı sayılmalı");
  assert.equal(s.expenseTotal, 200, "harcama toplamı");
  assert.deepEqual(s.vatByRate, [
    { rate: 10, total: 4400, vat: 400 },
    { rate: 20, total: 400, vat: 66.67 },
  ], "yazarkasa KDV oran oran");
  assert.equal(s.fixedMonthly, 10000, "sabit giderin ayın karşılığı");
});

test("çalışma kitabı: altı sekme, toplamlar, tarih ve dosya adı; yazılıp okunabilir", async () => {
  const wb = buildPackageWorkbook(DATA);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Özet", "Faturalar", "Harcamalar", "Kasa raporları", "Z KDV dökümü", "Sabit giderler"], "sekmeler");
  const buf = await wb.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buf as ArrayBuffer);
  const inv = back.getWorksheet("Faturalar")!;
  assert.equal(inv.getCell("A3").value, "Belge tarihi", "üçüncü satır başlık");
  assert.equal(inv.getCell("B4").value, "Sütçü & Oğulları", "ilk fatura satırı");
  assert.ok(inv.getCell("A4").value instanceof Date, "belge tarihi Excel tarihi olmalı");
  const total = inv.getRow(7);
  assert.equal(total.getCell(1).value, "TOPLAM", "üç faturadan sonra toplam satırı");
  assert.equal(total.getCell(9).value, 1100, "toplam yalnız sayılan faturanın ödeneceği");
  const empty = buildPackageWorkbook({ ...DATA, invoices: [], expenses: [], cash: [], vat: [], fixed: [] });
  assert.equal(empty.getWorksheet("Harcamalar")!.getCell("A4").value, "Bu ay harcama yok", "boş tablo söylenmeli");
  assert.equal(packageFileName("2026-10"), "laffogato-muhasebe-2026-10.xlsx", "dosya adı");
});

test("şubenin paketi: KDV yok (vergi şubeye bölünmez); KDV sütunları, Özet'in KDV satırları ve Z KDV dökümü yalnız bütün şubelerde", async () => {
  const wb = buildPackageWorkbook({ ...DATA, scope: "Marina", branchFile: true, vat: [] });
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Özet", "Faturalar", "Harcamalar", "Kasa raporları", "Sabit giderler"], "Z KDV dökümü yok");
  const buf = await wb.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buf as ArrayBuffer);
  const text = (name: string) => {
    const out: string[] = [];
    back.getWorksheet(name)!.eachRow((r) => r.eachCell((c) => out.push(String(c.value ?? ""))));
    return out;
  };
  const ov = text("Özet");
  assert.equal(ov.some((c) => /KDV'si|Yazarkasa KDV/.test(c)), false, "Özet'te KDV satırı yok");
  assert.ok(ov.some((c) => /Şubenin paketi: KDV sütunları, KDV toplamları ve Z KDV dökümü yok; vergi şubeye bölünmez/.test(c)), "neden yazılı");
  for (const name of ["Faturalar", "Harcamalar", "Kasa raporları"]) assert.equal(text(name).some((c) => /^(KDV|Yazarkasa KDV)$/.test(c)), false, `${name}: KDV sütunu yok`);
  // Sütunlar kaymadan: faturanın ödeneceği ve toplamı yerinde
  const inv = back.getWorksheet("Faturalar")!;
  assert.equal(inv.getCell("H3").value, "Ödenecek");
  assert.equal(inv.getRow(7).getCell(8).value, 1100, "toplam yalnız sayılan faturanın ödeneceği");
  assert.equal(back.getWorksheet("Kasa raporları")!.getCell("M4").value, 4800, "yazarkasa Z toplamı kalır");
  // Bütün şubelerin paketi bugünkü gibi
  const all = buildPackageWorkbook(DATA);
  assert.ok(all.getWorksheet("Z KDV dökümü"));
  assert.equal(all.getWorksheet("Faturalar")!.getCell("H3").value, "KDV");
});

test("e-posta: konu, özet satırları, kaçış ve ek adı", () => {
  const m = renderPackageMail(DATA, packageSummary(DATA), { auto: true });
  assert.equal(m.subject, "Muhasebe paketi · Ekim 2026", "konu");
  assert.match(m.text, /Ekim 2026 kapandı\. Ayın paketi ekte\./, "kendiliğinden gönderimin girişi");
  assert.match(m.text, /1 fatura · ödenecek 1\.100,00\s₺/, "fatura özeti");
  assert.match(m.text, /1 fatura kapalı döneme düştü, karar bekliyor/, "bekleyen söylenmeli");
  assert.match(m.text, /Yazarkasa KDV %10: 400,00\s₺/, "KDV satırı");
  assert.match(m.text, /Ek: laffogato-muhasebe-2026-10\.xlsx/, "ek adı");
  assert.ok(!m.html.includes("<script"), "kullanıcı metni kaçışlı olmalı");
  const manual = renderPackageMail({ ...DATA, closed: null }, packageSummary(DATA), { auto: false });
  assert.match(manual.text, /Ekim 2026 paketi ekte\./, "elle gönderimin girişi");
  assert.match(manual.text, /Dönem panelde henüz kapatılmadı/, "kapanmamış dönem söylenmeli");
});
