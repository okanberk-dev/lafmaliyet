// Tedarikçiler (cari hesaplar) ekranının kuralları (src/app/panel/tedarikciler/logic.ts): faturaların karta adla
// eşleşmesi, kalan borç ve vade, ödeme durumu, adres parçaları, IBAN / VKN / TCKN denetimi, telefon bağlantıları ve
// ödeme talebi metni. Seed verisiyle (excel-data.json) gruplamanın faturaları kaybetmediği de sınanır.
// Çalıştırma: npx tsx --test tests/tedarikciler.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  aliasCandidates,
  assignSlugs,
  bankFromIban,
  cardFor,
  cardIndex,
  cleanAliases,
  compareSuppliers,
  dueOf,
  dueTone,
  dueWhen,
  formatIban,
  fillFromInfo,
  formatPhone,
  groupSuppliers,
  ibanProblem,
  ibansInText,
  isValidTckn,
  isValidVkn,
  mailtoHref,
  matchesSupplierFilter,
  mergeInfo,
  missingInfo,
  nameConflict,
  normalizeIban,
  paidInParasut,
  parseSupplierFilter,
  parseSupplierSort,
  paymentRequestText,
  PLACEHOLDER_SUPPLIER_NAME,
  payState,
  phoneE164,
  summarize,
  supplierHaystack,
  supplierSlug,
  taxNumberCheck,
  telHref,
  transferNote,
  whatsappHref,
  type LedgerInvoice,
  type SupplierCard,
} from "../src/app/panel/tedarikciler/logic";
import { listBreakdowns, paidInMonth, supplierBreakdowns } from "../src/app/panel/tedarikciler/breakdowns";
import { pathOf } from "../src/app/panel/yardim/nav-paths";
import { navTreeFor } from "../src/components/panel/nav";
import { laterInvoiceItems, upcomingItems } from "../src/lib/reminders";
import { canOpen } from "../src/lib/roles";
import { contactInfo, newInvoicePayment, sameSupplier } from "../src/server/parasut/mapping";
import { parseUbl } from "../src/server/parasut/ubl";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const ds = excelToDataset(data);

const TODAY = "2026-10-21";

function card(p: Partial<SupplierCard> & { id: number; name: string }): SupplierCard {
  return {
    aliases: [],
    legalName: null,
    taxNumber: null,
    taxOffice: null,
    iban: null,
    bankName: null,
    accountHolder: null,
    contactName: null,
    phone: null,
    email: null,
    address: null,
    paymentTermDays: null,
    paymentMethod: null,
    paidOnDelivery: false,
    note: null,
    ...p,
  };
}

let nextId = 1;
function inv(p: Partial<LedgerInvoice> & { supplier: string; payable: number }): LedgerInvoice & { id: number } {
  return { id: nextId++, date: "2026-10-01", unpaid: true, outstanding: null, dueDate: null, paidAt: null, paymentRequestedAt: null, ...p };
}

test("kart eşleşmesi: büyük/küçük harf, I/ı, boşluk ve parantezli not sayılmaz; diğer adlar da karta gider", () => {
  const sutas = card({ id: 1, name: "Sütaş", aliases: ["SÜTAŞ SÜT ÜRÜNLERİ A.Ş."] });
  const kaldi = card({ id: 2, name: "Kaldi" });
  const index = cardIndex([sutas, kaldi]);
  assert.equal(cardFor(index, "SÜTAŞ")?.id, 1);
  assert.equal(cardFor(index, "  sütaş  ")?.id, 1);
  assert.equal(cardFor(index, "Sütaş Süt Ürünleri A.Ş.")?.id, 1, "diğer ad, büyük/küçük harf farkıyla");
  assert.equal(cardFor(index, "KALDI")?.id, 2, "I → ı → i");
  assert.equal(cardFor(index, "Kaldi (ödenmedi)")?.id, 2, "parantezli not sayılmaz");
  assert.equal(cardFor(index, "Kaldi Coffee"), null, "başka ad eşleşmez (yalnız tam anahtar)");
  // Bir ad hem bir kartın adı hem ötekinin diğer adıysa adın sahibi kazanır
  const a = card({ id: 3, name: "Pruva", aliases: ["Erbak"] });
  const b = card({ id: 4, name: "Erbak" });
  assert.equal(cardFor(cardIndex([a, b]), "Erbak")?.id, 4);
});

test("kart kaydı: ad ve diğer adlar başka bir kartla çakışamaz; eski ad diğer adlara geçer", () => {
  const others = [card({ id: 1, name: "Sütaş", aliases: ["Sütaş A.Ş."] }), card({ id: 2, name: "Kaldi" })];
  assert.deepEqual(nameConflict({ id: null, name: "SÜTAŞ", aliases: [] }, others), { name: "SÜTAŞ", owner: "Sütaş" });
  assert.deepEqual(nameConflict({ id: null, name: "Yeni", aliases: ["sütaş a.ş."] }, others), { name: "sütaş a.ş.", owner: "Sütaş" });
  assert.equal(nameConflict({ id: 1, name: "Sütaş", aliases: ["Sütaş A.Ş.", "Sütaş Süt"] }, others), null, "kart kendi adlarıyla çakışmaz");
  assert.equal(nameConflict({ id: null, name: "Kaldi Coffee", aliases: [] }, others), null);

  assert.deepEqual(cleanAliases("Sütaş", ["  SÜTAŞ  ", "Sütaş A.Ş.", "sütaş a.ş.", "", "Sütaş   Süt"]), ["Sütaş A.Ş.", "Sütaş Süt"]);
  // Ad değişince eski ad (faturaları o adla duruyor) diğer adlara eklenir; aynı anahtarsa eklenmez
  assert.deepEqual(cleanAliases("Sütaş A.Ş.", [], "Sütaş"), ["Sütaş"]);
  assert.deepEqual(cleanAliases("SÜTAŞ", [], "Sütaş"), []);
});

test("vade: faturadaki vade, yoksa fatura tarihi + vade günü (tahmini); kısa durum metni", () => {
  assert.deepEqual(dueOf({ date: "2026-10-01", dueDate: "2026-10-15" }, 30), { date: "2026-10-15", estimated: false });
  assert.deepEqual(dueOf({ date: "2026-10-01", dueDate: null }, 30), { date: "2026-10-31", estimated: true });
  assert.deepEqual(dueOf({ date: "2026-10-01" }, 0), { date: "2026-10-01", estimated: true });
  assert.equal(dueWhen("2026-10-21", TODAY), "bugün");
  assert.equal(dueWhen("2026-10-22", TODAY), "yarın");
  assert.equal(dueWhen("2026-10-26", TODAY), "5 gün kaldı");
  assert.equal(dueWhen("2026-10-20", TODAY), "1 gün gecikti");
  assert.equal(dueWhen("2026-10-18", TODAY), "3 gün gecikti");
  assert.deepEqual(["2026-10-18", "2026-10-21", "2026-10-28", "2026-10-29"].map((d) => dueTone(d, TODAY)), ["bad", "warn", "warn", "ok"], "SOON_DAYS (7) içi turuncu");
});

test("ödeme durumu: ödenmedi → talep edildi → ödendi; Paraşüt'te ödenmiş görünen ipucu", () => {
  assert.equal(payState({ unpaid: true }), "unpaid");
  assert.equal(payState({ unpaid: true, paymentRequestedAt: "2026-10-20" }), "requested");
  // Ödendiyse talep tarihi geçmiş bilgidir
  assert.equal(payState({ unpaid: false, paymentRequestedAt: "2026-10-20" }), "paid");
  assert.equal(paidInParasut({ unpaid: true, parasutUnpaid: false }), true);
  assert.equal(paidInParasut({ unpaid: true, parasutUnpaid: null }), false, "Paraşüt'ün bilgisi yok (e-fatura)");
  assert.equal(paidInParasut({ unpaid: false, parasutUnpaid: false }), false);
});

test("hesap özeti: kalan borç (kısmi ödemede kalan), geciken, 7 gün içinde, talep edilen, iade, son ödeme", () => {
  const list = [
    // Gecikmiş: vade 10.10
    inv({ supplier: "A", payable: 1000, date: "2026-09-10", dueDate: "2026-10-10" }),
    // Kısmen ödenmiş, vade 3 gün sonra: kalan sayılır, talep edildi
    inv({ supplier: "A", payable: 2000, outstanding: 500, date: "2026-10-01", dueDate: "2026-10-24", paymentRequestedAt: "2026-10-20" }),
    // Vadesiz: 30 gün sonrası (31.10) tahmini, "yakında" değil
    inv({ supplier: "A", payable: 300, date: "2026-10-01" }),
    // Ödenmiş
    inv({ supplier: "A", payable: 700, unpaid: false, paidAt: "2026-10-05", date: "2026-09-01" }),
    inv({ supplier: "A", payable: 50, unpaid: false, paidAt: "2026-10-12", date: "2025-12-30" }),
    // İade faturası (eksi, ödendi sayılır)
    inv({ supplier: "A", payable: -100, unpaid: false, date: "2026-10-02" }),
  ];
  const s = summarize(list, { today: TODAY, termDays: 30 });
  assert.equal(s.count, 6);
  assert.equal(s.invoiced, 3950);
  assert.equal(s.year, 3900, "geçen yılın faturası bu yılın toplamına girmez");
  assert.equal(s.openCount, 3);
  assert.equal(s.open, 1800, "1000 + kalan 500 + 300");
  assert.equal(s.overdueCount, 1);
  assert.equal(s.overdue, 1000);
  assert.equal(s.soonCount, 1);
  assert.equal(s.soon, 500);
  assert.equal(s.requestedCount, 1);
  assert.equal(s.requested, 500);
  assert.deepEqual(s.nextDue, { date: "2026-10-10", estimated: false });
  assert.equal(s.lastInvoice, "2026-10-02");
  assert.equal(s.lastPaid, "2026-10-12");
  // Kartın vade günü tahmini vadeyi değiştirir: 0 gün = fatura günü (gecikmiş)
  const s0 = summarize([inv({ supplier: "B", payable: 300, date: "2026-10-01" })], { today: TODAY, termDays: 0 });
  assert.equal(s0.overdueCount, 1);
  assert.deepEqual(s0.nextDue, { date: "2026-10-01", estimated: true });
});

test("gruplama: kartlı adlar kartta (diğer adlarıyla), kartsız adlar ayrı; faturasız kart da listede", () => {
  const cards = [card({ id: 7, name: "Sütaş", aliases: ["SÜTAŞ SÜT ÜRÜNLERİ A.Ş."], paymentTermDays: 15 }), card({ id: 8, name: "Yeni Tedarikçi" })];
  const list = [
    inv({ supplier: "Sütaş", payable: 100, date: "2026-10-03" }),
    inv({ supplier: "SÜTAŞ SÜT ÜRÜNLERİ A.Ş.", payable: 200, date: "2026-10-10" }),
    inv({ supplier: "Kaldi (ödenmedi)", payable: 300, date: "2026-10-04" }),
    inv({ supplier: "KALDI", payable: 400, date: "2026-10-08", unpaid: false }),
  ];
  const groups = groupSuppliers(list, cards, { today: TODAY, termDays: 30 });
  assert.deepEqual(
    groups.map((g) => [g.name, g.card?.id ?? null, g.invoices.length]),
    [
      ["KALDI", null, 2],
      ["Sütaş", 7, 2],
      ["Yeni Tedarikçi", 8, 0],
    ],
  );
  const sutas = groups.find((g) => g.card?.id === 7)!;
  assert.deepEqual(sutas.names, ["SÜTAŞ SÜT ÜRÜNLERİ A.Ş.", "Sütaş"], "en yeni faturadaki ad önce");
  assert.deepEqual(
    sutas.invoices.map((i) => i.date),
    ["2026-10-10", "2026-10-03"],
  );
  assert.equal(sutas.termDays, 15, "kartın vade günü");
  assert.equal(sutas.summary.open, 300);
  const kaldi = groups.find((g) => g.key === "kaldi")!;
  assert.deepEqual(kaldi.names, ["KALDI"], "aynı anahtarın yazılışları tek ad (en yeni)");
  assert.equal(kaldi.termDays, 30, "kart yoksa genel ayar");
  assert.equal(kaldi.slug, "kaldi");
  assert.equal(sutas.slug, "sutas");
  assert.equal(groups.find((g) => g.card?.id === 8)!.slug, "yeni-tedarikci");
});

test("adres parçası: Türkçe harf ASCII'ye iner, aynı parçaya düşenler sırayla ayrılır", () => {
  assert.equal(supplierSlug("sütaş"), "sutas");
  assert.equal(supplierSlug("çağdaş gıda & içecek"), "cagdas-gida-icecek");
  assert.equal(supplierSlug("kılavuz ipm"), "kilavuz-ipm");
  assert.equal(supplierSlug("İMGE"), "imge");
  assert.equal(supplierSlug("—"), "tedarikci");
  const slugs = assignSlugs(["sütaş", "sutas", "sutas 2", "kaldi"]);
  assert.equal(slugs.get("kaldi"), "kaldi");
  assert.equal(slugs.get("sutas"), "sutas");
  assert.equal(slugs.get("sutas 2"), "sutas-2");
  assert.equal(slugs.get("sütaş"), "sutas-3", "çakışan anahtar sırayla sonraki boş parçayı alır");
  // Sıra girdiden bağımsız: liste ve tedarikçi sayfası aynı parçayı bulur
  assert.deepEqual([...assignSlugs(["kaldi", "sutas 2", "sutas", "sütaş"])].sort(), [...slugs].sort());
});

test("seed: Excel faturaları tedarikçi tedarikçi toplanır, fatura kaybolmaz", () => {
  const list = ds.invoices.map((i) => ({ ...i, outstanding: null }));
  const groups = groupSuppliers(list, [], { today: TODAY, termDays: 30 });
  assert.equal(
    groups.reduce((a, g) => a + g.invoices.length, 0),
    ds.invoices.length,
  );
  assert.equal(groups.length, new Set(ds.invoices.map((i) => i.supplier.trim().toLocaleLowerCase("tr-TR"))).size);
  const total = Math.round(ds.invoices.reduce((a, i) => a + i.payable, 0) * 100) / 100;
  assert.equal(Math.round(groups.reduce((a, g) => a + g.summary.invoiced, 0) * 100) / 100, total);
  // Adres parçaları benzersiz
  assert.equal(new Set(groups.map((g) => g.slug)).size, groups.length);
});

test("liste: süzgeç ve sıra adresten doğrulanır; borç, vade, son fatura ve ad sırası", () => {
  assert.equal(parseSupplierFilter("geciken"), "geciken");
  assert.equal(parseSupplierFilter("bozuk"), "tumu");
  assert.equal(parseSupplierSort("vade"), "vade");
  assert.equal(parseSupplierSort(null), "borc");
  const base = { count: 1, invoiced: 0, year: 0, openCount: 0, open: 0, requestedCount: 0, requested: 0, overdueCount: 0, overdue: 0, soonCount: 0, soon: 0, nextDue: null, nextSoonDue: null, lastInvoice: null, lastPaid: null };
  const rows = [
    { name: "Çay Evi", hasCard: true, missing: [], summary: { ...base, open: 500, openCount: 1, nextDue: { date: "2026-11-01", estimated: false }, lastInvoice: "2026-10-01" } },
    { name: "Ayşe", hasCard: true, missing: ["iban" as const], summary: { ...base, open: 500, openCount: 1, overdue: 500, overdueCount: 1, nextDue: { date: "2026-10-01", estimated: false }, lastInvoice: "2026-09-01" } },
    { name: "Zeytin", hasCard: true, missing: [], summary: { ...base, lastInvoice: "2026-10-15" } },
    // Kartsız ve borçsuz (tek seferlik alım): eksik sayılmaz
    { name: "Pazar", hasCard: false, missing: ["iban" as const, "vergi" as const, "iletisim" as const], summary: { ...base, lastInvoice: "2026-08-01" } },
  ];
  const names = (sort: Parameters<typeof compareSuppliers>[0]) => [...rows].sort(compareSuppliers(sort)).map((r) => r.name);
  assert.deepEqual(names("borc"), ["Ayşe", "Çay Evi", "Pazar", "Zeytin"], "eşit borçta geciken önce");
  assert.deepEqual(names("vade"), ["Ayşe", "Çay Evi", "Pazar", "Zeytin"], "vadesi olmayan sonda (aralarında ad sırası)");
  assert.deepEqual(names("son"), ["Zeytin", "Çay Evi", "Ayşe", "Pazar"]);
  assert.deepEqual(names("ad"), ["Ayşe", "Çay Evi", "Pazar", "Zeytin"], "Türkçe sıra: Ç, C'den sonra");
  assert.deepEqual(
    rows.filter((r) => matchesSupplierFilter(r, "borclu")).map((r) => r.name),
    ["Çay Evi", "Ayşe"],
  );
  assert.deepEqual(
    rows.filter((r) => matchesSupplierFilter(r, "geciken")).map((r) => r.name),
    ["Ayşe"],
  );
  assert.deepEqual(
    rows.filter((r) => matchesSupplierFilter(r, "eksik")).map((r) => r.name),
    ["Ayşe"],
  );
  // Arama: IBAN boşluklu ve boşluksuz yazılınca da bulunur
  const hay = supplierHaystack({ name: "Sütaş", names: ["SÜTAŞ A.Ş."], legalName: null, taxNumber: "1234567890", iban: "TR290006400000112345678901", phone: null, contactName: "Ali", email: null });
  assert.match(hay, /TR29 0006 4000/);
  assert.match(hay, /TR290006400000112345678901/);
  assert.match(hay, /1234567890/);
});

test("eksik bilgi: IBAN (peşin çalışılanda aranmaz), vergi no, telefon ya da e-posta", () => {
  assert.deepEqual(missingInfo(null), ["iban", "vergi", "iletisim"]);
  assert.deepEqual(missingInfo({ iban: null, taxNumber: "1234567890", phone: null, email: "a@b.co", paidOnDelivery: true }), []);
  assert.deepEqual(missingInfo({ iban: "TR29…", taxNumber: null, phone: "0532", email: null, paidOnDelivery: false }), ["vergi"]);
});

test("IBAN: boşluk ve küçük harf sadeleşir, dörderli yazılır, kontrol hanesi ve uzunluk denetlenir, banka koddan bulunur", () => {
  assert.equal(normalizeIban(" tr29 0006 4000 0011-2345.6789 01 "), "TR290006400000112345678901");
  assert.equal(formatIban("TR290006400000112345678901"), "TR29 0006 4000 0011 2345 6789 01");
  assert.equal(ibanProblem(""), null, "boş alan geçerli");
  assert.equal(ibanProblem("TR29 0006 4000 0011 2345 6789 01"), null);
  assert.equal(ibanProblem("tr070006200006298765432101"), null);
  assert.equal(ibanProblem("DE89 3704 0044 0532 0130 00"), null, "yurt dışı IBAN");
  assert.match(ibanProblem("TR29 0006 4000 0011 2345 6789 02")!, /kontrol hanesi/);
  assert.match(ibanProblem("TR29 0006 4000 0011 2345 6789")!, /26 karakter/);
  assert.match(ibanProblem("12345")!, /iki harf/);
  assert.equal(bankFromIban("TR29 0006 4000 0011 2345 6789 01"), "İş Bankası");
  assert.equal(bankFromIban("TR070006200006298765432101"), "Garanti BBVA");
  assert.equal(bankFromIban("TR620001001234567890123456"), "Ziraat Bankası");
  assert.equal(bankFromIban("DE89370400440532013000"), null);
});

test("vergi no: VKN ve TCKN kontrol haneleri; hane sayısı yanlışsa hata, kontrol hanesi tutmazsa uyarı", () => {
  assert.equal(isValidVkn("1234567890"), true);
  assert.equal(isValidVkn("1234567891"), false);
  assert.equal(isValidTckn("10000000146"), true);
  assert.equal(isValidTckn("10000000147"), false);
  assert.equal(isValidTckn("01234567890"), false, "0 ile başlamaz");
  assert.equal(taxNumberCheck(""), null);
  assert.equal(taxNumberCheck("123 456 7890"), null);
  assert.deepEqual(taxNumberCheck("12345"), { error: "Vergi no 10 haneli (VKN) ya da 11 haneli (TCKN) olur; 5 hane yazıldı" });
  assert.ok("warning" in (taxNumberCheck("1234567891") ?? {}));
  assert.ok("warning" in (taxNumberCheck("10000000147") ?? {}));
});

test("telefon: Türkiye numarası her yazılışta aynı; WhatsApp yalnız cep numarasına; e-posta bağlantısı", () => {
  for (const raw of ["0532 123 45 67", "05321234567", "532 123 45 67", "+90 532 123 45 67", "90 (532) 123-45-67", "0090 532 123 45 67"]) {
    assert.equal(phoneE164(raw), "+905321234567", raw);
  }
  assert.equal(phoneE164("0212 555 12 34"), "+902125551234");
  assert.equal(phoneE164("12"), null);
  assert.equal(phoneE164(""), null);
  assert.equal(telHref("0532 123 45 67"), "tel:+905321234567");
  assert.equal(whatsappHref("0532 123 45 67"), "https://wa.me/905321234567");
  assert.equal(whatsappHref("0212 555 12 34"), null, "sabit hat WhatsApp'a gitmez");
  assert.equal(whatsappHref("+49 151 23456789", "Merhaba"), "https://wa.me/4915123456789?text=Merhaba");
  assert.equal(formatPhone("+905321234567"), "0532 123 45 67");
  assert.equal(formatPhone("+49 151 23456789"), "+49 151 23456789");
  assert.equal(mailtoHref("muhasebe@sutas.com.tr", "Ödeme talebi", "Tutar: 1 ₺"), "mailto:muhasebe@sutas.com.tr?subject=%C3%96deme%20talebi&body=Tutar%3A%201%20%E2%82%BA");
  assert.equal(mailtoHref("yanlis"), null);
});

test("ödeme talebi: alıcı (hesap sahibi > unvan > ad), IBAN, banka, tutar, havale açıklaması ve faturalar", () => {
  const lines = [
    { date: "2026-10-18", invoiceNo: "SUT2026000000156", amount: 4250, dueDate: null },
    { date: "2026-10-14", invoiceNo: "SUT2026000000123", amount: 4200.5, dueDate: "2026-10-28" },
  ];
  assert.equal(transferNote(lines), "SUT2026000000156, SUT2026000000123 nolu faturalar");
  assert.equal(transferNote([{ date: "2026-10-14", invoiceNo: null, amount: 1, dueDate: null }]), "14.10.2026 tarihli fatura");
  assert.equal(
    transferNote([
      { date: "2026-10-14", invoiceNo: "A1", amount: 1, dueDate: null },
      { date: "2026-10-15", invoiceNo: null, amount: 1, dueDate: null },
    ]),
    "A1, 15.10.2026 tarihli faturalar",
  );
  assert.equal(
    transferNote([1, 2, 3, 4].map((d) => ({ date: `2026-10-0${d}`, invoiceNo: `N${d}`, amount: 1, dueDate: null }))),
    "4 fatura (01.10.2026 – 04.10.2026)",
  );
  const text = paymentRequestText({
    payer: "L'Affogato",
    name: "Sütaş",
    card: { legalName: "SÜTAŞ SÜT ÜRÜNLERİ A.Ş.", iban: "TR290006400000112345678901", bankName: null, accountHolder: null, taxNumber: "1234567890" },
    lines,
  });
  // Tutardaki bölünmez boşluk (tl) karşılaştırmada düz boşluk sayılır
  const nbsp = (s: string) => s.replace(/ /g, " ");
  assert.equal(
    nbsp(text),
    [
      "Ödeme talebi · L'Affogato",
      "Alıcı: SÜTAŞ SÜT ÜRÜNLERİ A.Ş.",
      "IBAN: TR29 0006 4000 0011 2345 6789 01",
      "Banka: İş Bankası",
      "Vergi no: 1234567890",
      "Tutar: 8.450,50 ₺",
      "Açıklama: SUT2026000000156, SUT2026000000123 nolu faturalar",
      "",
      "Faturalar (2):",
      "• 14.10.2026 · SUT2026000000123 · 4.200,50 ₺ · vade 28.10.2026",
      "• 18.10.2026 · SUT2026000000156 · 4.250 ₺",
    ].join("\n"),
  );
  // Kartı yoksa ad yazılır ve IBAN'ın eksik olduğu söylenir; hesap sahibi unvandan önce gelir
  assert.match(nbsp(paymentRequestText({ name: "Kaldi", card: null, lines: [] })), /Alıcı: Kaldi\nIBAN: \(kartta yok\)\nTutar: 0 ₺/);
  assert.match(
    paymentRequestText({ name: "X", card: { legalName: "X LTD", iban: null, bankName: "Akbank", accountHolder: "Ayşe Yılmaz", taxNumber: null }, lines: [] }),
    /Alıcı: Ayşe Yılmaz[\s\S]*Banka: Akbank/,
  );
});

test("diğer ad önerisi: aynı firmanın farklı yazılmış kartsız adları (şirket ekleri sayılmaz)", () => {
  const groups = [
    { key: "yemek sepeti", name: "Yemek Sepeti", card: { id: 1 } },
    { key: "yemek sepeti elektronik iletisim", name: "YEMEK SEPETİ ELEKTRONİK İLETİŞİM A.Ş.", card: null },
    { key: "sütaş", name: "Sütaş", card: null },
    { key: "trendyol go", name: "Trendyol Go", card: null },
  ];
  assert.deepEqual(aliasCandidates({ key: "yemek sepeti", name: "Yemek Sepeti", names: ["Yemek Sepeti"] }, groups, sameSupplier), ["YEMEK SEPETİ ELEKTRONİK İLETİŞİM A.Ş."]);
  // Kartı olan ad önerilmez (o başka bir kartta)
  assert.deepEqual(aliasCandidates({ key: "x", name: "Yemek Sepeti A.Ş.", names: [] }, groups, sameSupplier), ["YEMEK SEPETİ ELEKTRONİK İLETİŞİM A.Ş."]);
});

test("eşitleme: yeni fatura ödenmedi gelir; iade, komisyon, peşin çalışılan tedarikçininki ve takipten eskiler değil", () => {
  const since = "2026-09-21";
  const d = { payable: 1200, date: "2026-10-14", parasutUnpaid: false, commission: false };
  assert.deepEqual(newInvoicePayment(d, null, since), { unpaid: true, paidAt: null, paidVia: null }, "Paraşüt'te ödendi olsa da ödenmedi gelir");
  assert.deepEqual(newInvoicePayment({ ...d, parasutUnpaid: null }, null, since), { unpaid: true, paidAt: null, paidVia: null }, "e-fatura");
  assert.deepEqual(newInvoicePayment({ ...d, payable: -300 }, null, since), { unpaid: false, paidAt: null, paidVia: null }, "iade faturası borç değildir");
  assert.deepEqual(newInvoicePayment(d, { paymentMethod: "kart" }, since), { unpaid: false, paidAt: "2026-10-14", paidVia: "kart" }, "peşin: fatura günü, kartın ödeme şekli");
  assert.deepEqual(newInvoicePayment(d, { paymentMethod: null }, since), { unpaid: false, paidAt: "2026-10-14", paidVia: null });
  // Takip başlamadan önceki fatura (geçmişi yeniden alırken): Paraşüt'ünki; e-faturada bilgi yok, ödendi
  const old = { ...d, date: "2026-03-02" };
  assert.deepEqual(newInvoicePayment(old, null, since), { unpaid: false, paidAt: null, paidVia: null });
  assert.deepEqual(newInvoicePayment({ ...old, parasutUnpaid: true }, null, since), { unpaid: true, paidAt: null, paidVia: null });
  assert.deepEqual(newInvoicePayment({ ...old, parasutUnpaid: null }, null, since), { unpaid: false, paidAt: null, paidVia: null });
  assert.deepEqual(newInvoicePayment({ ...d, date: since }, null, since).unpaid, true, "başlangıç günü takipte");
  // Komisyon hakedişten düşülür: ödendi gelir (fatura günü), peşin kartından önce
  assert.deepEqual(newInvoicePayment({ ...d, commission: true }, null, since), { unpaid: false, paidAt: "2026-10-14", paidVia: null });
  assert.deepEqual(newInvoicePayment({ ...d, commission: true }, { paymentMethod: "kart" }, since).paidVia, null);
});

test("eşitleme kaynağı: ödeme durumunu kullanıcı işaretler, eşitleme var olan faturanınkini değiştirmez", () => {
  const sync = readFileSync(join(root, "src/server/parasut/sync.ts"), "utf8");
  // İki yeni fatura yolu da aynı kural: Paraşüt'ün bilgisi (e-faturada yok), komisyon kategorisi, peşin kartı, başlangıç
  // Komisyon yalnız kategori güvenilirse (ipucu tahmini değil)
  assert.equal(sync.match(/commission: category === COMMISSION_CATEGORY && !categoryNeedsReview\(reason\) \},\s*ctx\.paidOnDelivery\(supplier\),\s*ctx\.paymentsSince/g)?.length, 2);
  assert.match(sync, /parasutUnpaid: d\.unpaid, commission:/, "gider faturası");
  assert.match(sync, /parasutUnpaid: null, commission:/, "e-fatura");
  // Var olan faturada yalnız Paraşüt'ün ipucu (parasutUnpaid) yazılır, "ödenmedi" yazılmaz; Paraşüt faturayı kapatınca
  // panelde ödenmedi duranın bilinen kalanı korunur; yer tutucu adla açılmış fatura peşin kartına düşerse ödendi olur
  assert.match(sync, /\.set\(\{ \.\.\.common, \.\.\.\(keepOutstanding \? \{ outstanding: match\.outstanding \} : \{\}\), \.\.\.supplierFix, \.\.\.settle, dueDate \}\)/);
  assert.match(sync, /const keepOutstanding = match\.unpaid && !d\.unpaid;/);
  assert.match(sync, /supplierFix\.supplier && match\.origin === "parasut" && match\.unpaid && !match\.paidAt && !match\.paymentRequestedAt \? ctx\.paidOnDelivery\(supplierFix\.supplier\)/);
  // Excel'i yeniden yükleme ödeme takibinin başlangıcını da siler (eski tarih kalsa faturalar "ödenmedi" yığılırdı)
  const seed = readFileSync(join(root, "scripts/seed.ts"), "utf8");
  assert.match(seed, /key IN \('payments\.recent', 'payments\.since'\)/);
  const common = sync.slice(sync.indexOf("const common = {"), sync.indexOf("let invoiceId: number;"));
  assert.match(common, /parasutUnpaid: d\.unpaid/);
  assert.doesNotMatch(common, /\bunpaid:/);
  assert.doesNotMatch(sync, /unpaid: false,\s*source: "parasut"/, "e-fatura kaydı sabit 'ödendi' açılmaz");
  const lines = readFileSync(join(root, "src/server/parasut/lines.ts"), "utf8");
  // Belge okunurken ödeme durumu iki durumda değişir: geçmişten "ödendi" açılmış, Paraşüt'te ödeme kaydı olmayan
  // e-faturanın vadesi gelmemişse ödenmedi olur; kalemlerden güvenilir kuralla komisyon çıkarsa ödendi olur
  assert.equal(lines.match(/patch\.unpaid = /g)?.length, 2);
  assert.match(lines, /const commission = recat\.category === COMMISSION_CATEGORY && !categoryNeedsReview\(recat\.reason\);/);
  assert.match(lines, /row\.parasutUnpaid === null &&\s*row\.date < since &&\s*!row\.unpaid &&\s*!row\.paidAt/);
});

test("kart: Paraşüt'ün geçici adı ('Paraşüt tedarikçisi') diğer ad olamaz", () => {
  assert.deepEqual(cleanAliases("Sütaş", ["Paraşüt tedarikçisi", "SÜTAŞ A.Ş."]), ["SÜTAŞ A.Ş."]);
  assert.equal(PLACEHOLDER_SUPPLIER_NAME, "Paraşüt tedarikçisi");
  const sync = readFileSync(join(root, "src/server/parasut/sync.ts"), "utf8");
  const einvoice = readFileSync(join(root, "src/server/parasut/einvoice.ts"), "utf8");
  assert.match(sync, /const PLACEHOLDER_SUPPLIER = "Paraşüt tedarikçisi";/, "eşitlemenin geçici adıyla aynı");
  assert.match(einvoice, /PLACEHOLDER_E_SUPPLIER = "Paraşüt tedarikçisi";/);
});

test("ödeme talebi: seçilen iade tutardan düşülür, ayrı listelenir, havale açıklamasına girmez", () => {
  const text = (
    paymentRequestText({
      name: "Sütaş",
      card: { legalName: "SÜTAŞ A.Ş.", iban: null, bankName: null, accountHolder: null, taxNumber: null },
      lines: [
        { date: "2026-09-19", invoiceNo: "SUT1", amount: 8450.5, dueDate: "2026-10-19" },
        { date: "2026-10-02", invoiceNo: "IAD7", amount: -1200, dueDate: null },
      ],
    })
  ).replace(/\u00a0/g, " ");
  assert.match(text, /Tutar: 7\.250,50 ₺ \(faturalar 8\.450,50 ₺ − iade 1\.200 ₺\)/);
  assert.match(text, /Açıklama: SUT1 nolu fatura\n/);
  assert.match(text, /Faturalar \(1\):\n• 19\.09\.2026 · SUT1/);
  assert.match(text, /Düşülen iadeler \(1\):\n• 02\.10\.2026 · IAD7 · −1\.200 ₺/);
});

test("özet: '7 gün içinde'nin ilk vadesi gecikmişleri saymaz; ödenmedi duran iade vadeye ve gecikmeye girmez", () => {
  const open = (date: string, payable: number, dueDate: string) => ({ supplier: "A", date, payable, unpaid: true, dueDate, paymentRequestedAt: null, paidAt: null, outstanding: null });
  const s = summarize([open("2026-09-01", 500, "2026-10-20"), open("2026-10-01", 300, "2026-10-22"), open("2026-10-05", -200, "2026-10-10")], { today: TODAY, termDays: 30 });
  assert.equal(s.nextDue?.date, "2026-10-20", "en erken vade gecikmiş olabilir");
  assert.equal(s.nextSoonDue, "2026-10-22", "pencerede ilk gelen");
  assert.deepEqual([s.overdueCount, s.overdue, s.soonCount, s.soon], [1, 500, 1, 300], "iade gecikmiş sayılmaz");
  assert.equal(s.open, 600, "iade kalan borçtan düşer");
});

test("Ödemeler: vadesiz faturanın tahmini vadesi tedarikçinin kartındaki vade gününden, yoksa genel ayardan", () => {
  const row = { id: 5, supplier: "Sütaş", invoiceNo: "S1", date: "2026-10-01", dueDate: null, payable: 1000 };
  const [withCard] = upcomingItems([], [{ ...row, termDays: 10 }], TODAY, { invoiceTermDays: 30 });
  assert.deepEqual([withCard.dueDate, withCard.detail, withCard.status], ["2026-10-11", "Fatura S1 · vade tahmini (10 gün)", "overdue"]);
  const [general] = upcomingItems([], [row], TODAY, { invoiceTermDays: 30 });
  assert.deepEqual([general.dueDate, general.detail], ["2026-10-31", "Fatura S1 · vade tahmini (30 gün)"]);
  // Faturada vade yazılıysa kartın vade günü sayılmaz
  const [due] = upcomingItems([], [{ ...row, dueDate: "2026-10-25", termDays: 10 }], TODAY, { invoiceTermDays: 30 });
  assert.deepEqual([due.dueDate, due.detail], ["2026-10-25", "Fatura S1"]);
  // 0 gün (peşin): fatura günü
  assert.equal(laterInvoiceItems([{ ...row, date: "2027-01-10", termDays: 0 }], TODAY, { invoiceTermDays: 30 })[0].dueDate, "2027-01-10");
});

/** Satıcı bilgileri dolu bir UBL-TR belgesi (kalemsiz) */
const partyUbl = (opts: { account?: string; note?: string; party?: string }) => `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>SUT2026000000123</cbc:ID>
  <cbc:IssueDate>2026-10-14</cbc:IssueDate>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  ${opts.note ? `<cbc:Note>${opts.note}</cbc:Note>` : ""}
  <cac:AccountingSupplierParty><cac:Party>
    ${
      opts.party ??
      `<cbc:WebsiteURI>https://www.sutas.com.tr</cbc:WebsiteURI>
    <cac:PartyIdentification><cbc:ID schemeID="MERSISNO">0123456789000015</cbc:ID></cac:PartyIdentification>
    <cac:PartyIdentification><cbc:ID schemeID="VKN">1234567890</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name>SÜTAŞ SÜT ÜRÜNLERİ A.Ş.</cbc:Name></cac:PartyName>
    <cac:PostalAddress>
      <cbc:StreetName>Atatürk Cad.</cbc:StreetName><cbc:BuildingNumber>12</cbc:BuildingNumber>
      <cbc:CitySubdivisionName>Karacabey</cbc:CitySubdivisionName><cbc:CityName>Bursa</cbc:CityName><cbc:PostalZone>16700</cbc:PostalZone>
      <cac:Country><cbc:Name>Türkiye</cbc:Name></cac:Country>
    </cac:PostalAddress>
    <cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>Karacabey</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:Contact><cbc:Telephone>0224 676 10 00</cbc:Telephone><cbc:ElectronicMail>muhasebe@sutas.com.tr</cbc:ElectronicMail></cac:Contact>`
    }
  </cac:Party></cac:AccountingSupplierParty>
  <cac:PaymentMeans><cbc:PaymentMeansCode>42</cbc:PaymentMeansCode><cbc:PaymentDueDate>2026-11-13</cbc:PaymentDueDate>${opts.account ?? ""}</cac:PaymentMeans>
  <cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="TRY">0</cbc:TaxExclusiveAmount><cbc:PayableAmount currencyID="TRY">0</cbc:PayableAmount></cac:LegalMonetaryTotal>
</Invoice>`;

test("faturadan doldur: e-faturadaki satıcı bilgileri (unvan, VKN, vergi dairesi, adres, telefon, e-posta, IBAN, banka)", () => {
  const account = `<cac:PayeeFinancialAccount><cbc:ID>TR29 0006 4000 0011 2345 6789 01</cbc:ID><cbc:CurrencyCode>TRY</cbc:CurrencyCode>
    <cac:FinancialInstitutionBranch><cbc:Name>Karacabey</cbc:Name><cac:FinancialInstitution><cbc:Name>Türkiye İş Bankası</cbc:Name></cac:FinancialInstitution></cac:FinancialInstitutionBranch></cac:PayeeFinancialAccount>`;
  assert.deepEqual(parseUbl(partyUbl({ account })).supplierInfo, {
    legalName: "SÜTAŞ SÜT ÜRÜNLERİ A.Ş.",
    taxNumber: "1234567890",
    taxOffice: "Karacabey",
    address: "Atatürk Cad. No: 12, 16700 Karacabey/Bursa",
    phone: "0224 676 10 00",
    email: "muhasebe@sutas.com.tr",
    iban: "TR290006400000112345678901",
    bankName: "Türkiye İş Bankası",
  });
  // Ödeme alanında hesap yoksa notlardaki geçerli IBAN; banka IBAN'daki koddan
  const fromNote = parseUbl(partyUbl({ note: "Banka bilgileri: Garanti IBAN: TR07 0006 2000 0629 8765 4321 01 · eski hesap TR00 0000 0000 0000 0000 0000 00" })).supplierInfo;
  assert.equal(fromNote.iban, "TR070006200006298765432101");
  assert.equal(fromNote.bankName, "Garanti BBVA");
  // Şahıs şirketi: ad soyad ve TCKN
  const person = parseUbl(
    partyUbl({
      party: `<cac:PartyIdentification><cbc:ID schemeID="TCKN">10000000146</cbc:ID></cac:PartyIdentification><cac:Person><cbc:FirstName>Ayşe</cbc:FirstName><cbc:FamilyName>Yılmaz</cbc:FamilyName></cac:Person>`,
    }),
  ).supplierInfo;
  assert.deepEqual([person.legalName, person.taxNumber, person.taxOffice, person.iban], ["Ayşe Yılmaz", "10000000146", null, null]);
});

test("faturadan doldur: Paraşüt kişi kartı, kaynakların birleşmesi ve formun yalnız boş alanları", () => {
  const c = contactInfo({ name: "Sütaş A.Ş.", tax_number: "1234567890", tax_office: "Karacabey", address: "Atatürk Cad. 12", district: "Karacabey", city: "Bursa", phone: "", email: "info@sutas.com.tr", iban: "TR070006200006298765432101" });
  assert.deepEqual(c, { legalName: "Sütaş A.Ş.", taxNumber: "1234567890", taxOffice: "Karacabey", address: "Atatürk Cad. 12, Karacabey/Bursa", phone: null, email: "info@sutas.com.tr", iban: "TR070006200006298765432101", bankName: null });
  // Önce gelen kaynak kazanır; geçersiz IBAN ve vergi no alınmaz, banka IBAN'dan
  const merged = mergeInfo({ legalName: "  SÜTAŞ   A.Ş. ", iban: "TR00 1234", taxNumber: "123", email: "yanlis" }, c);
  assert.deepEqual(merged, { legalName: "SÜTAŞ A.Ş.", taxNumber: "1234567890", taxOffice: "Karacabey", address: "Atatürk Cad. 12, Karacabey/Bursa", phone: null, email: "info@sutas.com.tr", iban: "TR070006200006298765432101", bankName: "Garanti BBVA" });
  const form = { legalName: "Sütaş (elle)", taxNumber: "", taxOffice: "", address: "", phone: "0532 000 00 00", email: "", iban: "", bankName: "" };
  const { patch, filled } = fillFromInfo(form, merged);
  assert.deepEqual(filled, ["taxNumber", "taxOffice", "iban", "bankName", "email", "address"], "dolu alanlara (unvan, telefon) dokunulmaz");
  assert.equal(patch.iban, "TR07 0006 2000 0629 8765 4321 01");
  assert.equal(patch.legalName, undefined);
  assert.deepEqual(ibansInText("IBAN: TR290006400000112345678901, TR29 0006 4000 0011 2345 6789 01 ve tr070006200006298765432101"), ["TR290006400000112345678901", "TR070006200006298765432101"]);
});

test("özet kartları: dökümün toplamı kartın rakamı; listede tedarikçi tedarikçi, tedarikçi sayfasında fatura fatura", () => {
  const list = [
    inv({ supplier: "A", payable: 1000, date: "2026-09-10", dueDate: "2026-10-10" }),
    inv({ supplier: "A", payable: 2000, outstanding: 500, date: "2026-10-01", dueDate: "2026-10-24" }),
    inv({ supplier: "B", payable: 300, date: "2026-10-01" }),
    inv({ supplier: "B", payable: 700, unpaid: false, paidAt: "2026-10-05", date: "2026-09-01" }),
    inv({ supplier: "B", payable: 50, unpaid: false, paidAt: "2026-09-30", date: "2026-09-01" }),
  ];
  const groups = groupSuppliers(list, [], { today: TODAY, termDays: 30 });
  const rows = groups.map((g) => ({ slug: g.slug, name: g.name, summary: g.summary, ...((p) => ({ paidThisMonth: p.amount, paidThisMonthCount: p.count }))(paidInMonth(g.invoices, "2026-10")) }));
  const b = listBreakdowns(rows);
  const total = (gs: { rows: { amount: number }[] }[]) => gs.flatMap((g) => g.rows).reduce((a, r) => a + r.amount, 0);
  assert.equal(total(b.open), groups.reduce((a, g) => a + g.summary.open, 0));
  assert.equal(total(b.open), 1800);
  assert.equal(total(b.overdue), 1000);
  assert.equal(total(b.soon), 500);
  assert.equal(total(b.paid), 700, "yalnız ödeme günü bu ayda olan");
  assert.deepEqual(
    b.open[0].rows.map((r) => [r.label, r.href]),
    [
      ["A", "/panel/tedarikciler/a"],
      ["B", "/panel/tedarikciler/b"],
    ],
  );
  const a = groups.find((g) => g.key === "a")!;
  const sb = supplierBreakdowns(a.invoices.map((i) => ({ ...i, invoiceNo: null })), { today: TODAY, termDays: 30, rowHref: (id) => `#fatura-${id}` });
  assert.equal(total(sb.open), a.summary.open);
  assert.equal(total(sb.overdue), a.summary.overdue);
  assert.equal(total(sb.year), a.summary.year);
  assert.match(sb.overdue[0].rows[0].sub!, /vade 10\.10\.2026 · 11 gün gecikti/);
});

test("sayfalar: her özet kartı dökümüyle; menüde Satış & gider altında, yalnız yönetici", () => {
  for (const file of ["src/app/panel/tedarikciler/page.tsx", "src/app/panel/tedarikciler/[cari]/page.tsx"]) {
    const src = readFileSync(join(root, file), "utf8");
    const stats = src.match(/<Stat\s/g)?.length ?? 0;
    assert.equal(stats, 4, file);
    assert.equal(src.match(/<StatBreakdown\s/g)?.length ?? 0, stats, file);
  }
  assert.deepEqual(pathOf("/panel/tedarikciler"), ["Satış & gider", "Tedarikçiler"]);
  assert.equal(canOpen("staff", "/panel/tedarikciler"), false);
  assert.equal(canOpen("staff", "/panel/tedarikciler/sutas"), false);
  assert.ok(!navTreeFor("staff").some((n) => n.href === "/panel/tedarikciler" || n.children?.some((c) => c.href === "/panel/tedarikciler")));
});
