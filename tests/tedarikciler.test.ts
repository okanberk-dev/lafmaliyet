// Tedarikçiler (cari hesaplar) ekranının kuralları (src/app/panel/tedarikciler/logic.ts): faturaların karta adla
// eşleşmesi, kalan borç ve vade, ödeme durumu, adres parçaları, IBAN / VKN / TCKN denetimi, telefon bağlantıları ve
// ödeme talebi metni. Seed verisiyle (excel-data.json) gruplamanın faturaları kaybetmediği de sınanır.
// Çalıştırma: npx tsx --test tests/tedarikciler.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { supplierMatchKey } from "../src/app/panel/faturalar/rules";
import {
  aliasCandidates,
  assignSlugs,
  bankFromIban,
  cardFor,
  cardIndex,
  cleanAliases,
  cleanTaxNumber,
  compareSuppliers,
  DUMMY_TAX_NUMBERS,
  dueOf,
  dueTone,
  dueWhen,
  formatIban,
  fillFromInfo,
  formatPhone,
  groupSuppliers,
  ibanProblem,
  ibansInText,
  isHiddenSupplier,
  isValidTckn,
  isValidVkn,
  mailtoHref,
  matchesSupplierFilter,
  mergeInfo,
  missingInfo,
  nameConflict,
  nameMoveBlock,
  nameMoveLines,
  nameMoves,
  normalizeIban,
  paidInParasut,
  parseSupplierFilter,
  parseSupplierSort,
  paymentRequestText,
  PLACEHOLDER_SUPPLIER_NAME,
  payState,
  phoneE164,
  sameTaxNames,
  sharedTaxNotes,
  summarize,
  supplierHaystack,
  supplierPairKey,
  supplierResolver,
  supplierSlug,
  taxKey,
  taxNameIndex,
  taxNumberCheck,
  taxPreview,
  taxPreviewLines,
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
    hiddenOn: null,
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
  assert.match(nbsp(paymentRequestText({ name: "Kaldi", card: null, lines: [] })), /Alıcı: Kaldi\nIBAN: \(girilmemiş\)\nTutar: 0 ₺/);
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
  // Komisyon yalnız kategori güvenilirse (ipucu tahmini değil). Peşin kartı Tedarikçiler'deki gibi adla ve faturanın
  // vergi nosuyla bulunur (gider faturasında e-belgenin ya da kişi kartının, e-faturada belgenin numarası)
  assert.equal(
    sync.match(/commission: category === COMMISSION_CATEGORY && !categoryNeedsReview\(reason\) \},\s*ctx\.paidOnDelivery\(supplier, (?:taxRaw|d\.supplierTaxNo)\),\s*ctx\.paymentsSince/g)?.length,
    2,
  );
  assert.match(sync, /parasutUnpaid: d\.unpaid, commission:/, "gider faturası");
  assert.match(sync, /parasutUnpaid: null, commission:/, "e-fatura");
  // Var olan faturada yalnız Paraşüt'ün ipucu (parasutUnpaid) yazılır, "ödenmedi" yazılmaz; Paraşüt faturayı kapatınca
  // panelde ödenmedi duranın bilinen kalanı korunur; yer tutucu adla açılmış fatura peşin kartına düşerse ödendi olur
  assert.match(sync, /\.set\(\{ \.\.\.common, \.\.\.\(keepOutstanding \? \{ outstanding: match\.outstanding \} : \{\}\), \.\.\.supplierFix, \.\.\.settle, dueDate \}\)/);
  assert.match(sync, /const keepOutstanding = match\.unpaid && !d\.unpaid;/);
  assert.match(
    sync,
    /supplierFix\.supplier && match\.origin === "parasut" && match\.unpaid && !match\.paidAt && !match\.paymentRequestedAt \? ctx\.paidOnDelivery\(supplierFix\.supplier, taxRaw \?\? match\.supplierTaxNumber\)/,
  );
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

test("isHiddenSupplier: listeden kaldırılan borçsuz tedarikçi gizli; borç ya da sonraki tarihli fatura geri getirir", () => {
  const hidden = { hiddenOn: "2026-10-10" };
  assert.equal(isHiddenSupplier(null, { openCount: 0, lastInvoice: null }), false);
  assert.equal(isHiddenSupplier({ hiddenOn: null }, { openCount: 0, lastInvoice: "2026-09-01" }), false);
  assert.equal(isHiddenSupplier(hidden, { openCount: 0, lastInvoice: "2026-09-01" }), true);
  // Kaldırıldığı gün tarihli fatura (o gün zaten görülmüştü) geri getirmez; ertesi günün faturası getirir
  assert.equal(isHiddenSupplier(hidden, { openCount: 0, lastInvoice: "2026-10-10" }), true);
  assert.equal(isHiddenSupplier(hidden, { openCount: 0, lastInvoice: "2026-10-11" }), false);
  // Geçmişten gelen ödenmemiş fatura da geri getirir: borç listeden gizlenmez
  assert.equal(isHiddenSupplier(hidden, { openCount: 1, lastInvoice: "2025-03-01" }), false);
});

// ---------------------------------------------------------------- Vergi no ile eşleşme (docs/planlar/vkn.md)

// Kontrol hanesi tutan, yer tutucu olmayan numaralar
const X = "7810030532";
const Y = "4567890128";
const Z = "1122334455";
const W = "9988776658";

/** Vergi noyla fatura (Paraşüt'ten gelmiş gibi) */
function tinv(supplier: string, tax: string | null, date = "2026-10-01", payable = 100) {
  return inv({ supplier, payable, date, supplierTaxNumber: tax });
}

type IdInvoice = LedgerInvoice & { id: number };

/** Bugünkü (vergi nosuz) gruplama: kartın adı ya da diğer adı, yoksa adın kendi grubu; vergi no yok sayılır */
function nameOnlyGroups(invoices: readonly IdInvoice[], cards: readonly SupplierCard[]) {
  const index = cardIndex(cards);
  const byId = new Map<string, { key: string; ids: number[]; names: string[] }>();
  for (const c of cards) byId.set(`kart:${c.id}`, { key: supplierMatchKey(c.name), ids: [], names: [] });
  for (const i of [...invoices].sort((a, b) => b.date.localeCompare(a.date))) {
    const k = supplierMatchKey(i.supplier);
    const c = index.get(k);
    const id = c ? `kart:${c.id}` : `ad:${k}`;
    const g = byId.get(id) ?? { key: k, ids: [], names: [] };
    byId.set(id, g);
    g.ids.push(i.id);
  }
  const slugs = assignSlugs([...byId.values()].map((g) => g.key));
  return [...byId.values()].map((g) => ({ key: g.key, slug: slugs.get(g.key), ids: [...g.ids].sort((a, b) => a - b) })).sort((a, b) => a.key.localeCompare(b.key));
}

const shape = (groups: readonly { key: string; slug: string; invoices: readonly IdInvoice[] }[]) =>
  groups.map((g) => ({ key: g.key, slug: g.slug, ids: g.invoices.map((i) => i.id).sort((a, b) => a - b) })).sort((a, b) => a.key.localeCompare(b.key));

test("vergi no: saklanan biçim rakam (10/11 hane); eşleşmede kontrol hanesi ve yer tutucu numara elenir", () => {
  assert.equal(cleanTaxNumber(" 781 003 05.32 "), X, "boşluk ve nokta atılır");
  assert.equal(cleanTaxNumber("12345"), null, "yanlış uzunluk");
  assert.equal(cleanTaxNumber("1234567891"), "1234567891", "kontrol hanesi tutmayan saklanır");
  assert.equal(taxKey("1234567891"), null, "… ama eşleşmede kullanılmaz");
  assert.equal(taxKey(`TR ${X}`), X);
  assert.equal(taxKey("10000000146"), "10000000146", "TCKN");
  assert.equal(taxKey(null), null);
  // 1234567890 VKN kontrol hanesini geçer: bu yüzden yer tutucu listesinde
  assert.equal(isValidVkn("1234567890"), true);
  for (const d of DUMMY_TAX_NUMBERS) assert.equal(taxKey(d), null, d);
  assert.equal(cleanTaxNumber("1234567890"), "1234567890", "yer tutucu da saklanır");
});

test("vergi no: aynı numaralı iki kartsız ad tek tedarikçi; anahtar en küçük ad anahtarı, ad en yenisi", () => {
  const list = [tinv("KALDI KAHVE TİC. A.Ş.", X, "2026-10-12"), tinv("Kaldi Kahve Ltd", X, "2026-10-02"), tinv("Sütaş", null)];
  const groups = groupSuppliers(list, [], { today: TODAY, termDays: 30 });
  assert.equal(groups.length, 2);
  const g = groups.find((x) => x.taxNumbers.length)!;
  assert.equal(g.key, "kaldi kahve ltd", "tarihe bakmadan en küçük anahtar: her çağıranda aynı adres");
  assert.equal(g.slug, "kaldi-kahve-ltd");
  assert.equal(g.name, "KALDI KAHVE TİC. A.Ş.", "görünen ad en yeni faturadaki");
  assert.deepEqual(g.names, ["KALDI KAHVE TİC. A.Ş.", "Kaldi Kahve Ltd"]);
  assert.deepEqual(g.keys.sort(), ["kaldi kahve ltd", "kaldi kahve tic. a.ş."]);
  assert.deepEqual(g.viaTax, ["KALDI KAHVE TİC. A.Ş."], "anahtar dışındaki ad vergi noyla geldi");
  assert.deepEqual(g.taxNumbers, [{ taxNumber: X, count: 2 }]);
  assert.equal(g.taxNumber, X);
  assert.deepEqual(g.sharedTax, []);
});

test("vergi no: ad köprüsü — vergi nosuz Excel satırı, aynı adla vergi nolu faturanın grubuna katılır", () => {
  const list = [tinv("Kaldi", null, "2026-03-01"), tinv("Kaldi", X, "2026-10-01"), tinv("KALDI KAHVE TİC. A.Ş.", X, "2026-10-08")];
  const groups = groupSuppliers(list, [], { today: TODAY, termDays: 30 });
  assert.equal(groups.length, 1, "Excel'deki Kaldi ayrılmaz (bugünkü ad gruplamasından geri gidiş olmaz)");
  assert.equal(groups[0].key, "kaldi");
  assert.equal(groups[0].invoices.length, 3);
  assert.deepEqual(groups[0].viaTax, ["KALDI KAHVE TİC. A.Ş."]);
});

test("vergi no: numarası yazılmamış karta, kartın faturalarındaki numarayla başka adla gelen fatura da düşer", () => {
  const kaldi = card({ id: 1, name: "Kaldi", paymentTermDays: 15 });
  const list = [tinv("Kaldi", X, "2026-10-01"), tinv("KALDI KAHVE TİC. A.Ş.", X, "2026-10-05"), tinv("Kaldi", null, "2026-02-01")];
  const groups = groupSuppliers(list, [kaldi], { today: TODAY, termDays: 30 });
  assert.equal(groups.length, 1);
  const g = groups[0];
  assert.equal(g.card?.id, 1);
  assert.equal(g.invoices.length, 3);
  assert.deepEqual(g.viaTax, ["KALDI KAHVE TİC. A.Ş."]);
  assert.equal(g.taxNumber, X, "kartta yoksa faturalardaki tek numara");
  const { resolve } = supplierResolver([kaldi], list);
  assert.equal(resolve("KALDI KAHVE TİC. A.Ş.", X).via, "vergi");
  assert.equal(resolve("Kaldi", null).via, "ad");
});

test("vergi no: kartta yazılı numarayla bilinmeyen ad karta gider; kartın numarası faturalardakinden önce gelir", () => {
  const sutas = card({ id: 3, name: "Sütaş", taxNumber: Y });
  const list = [tinv("SÜTAŞ SÜT ÜRÜNLERİ A.Ş.", Y), tinv("Sütaş", null)];
  const groups = groupSuppliers(list, [sutas], { today: TODAY, termDays: 30 });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].invoices.length, 2);
  assert.equal(groups[0].taxNumber, Y);
  const { resolve } = supplierResolver([sutas], []);
  assert.equal(resolve("Bambaşka Ad", Y).card?.id, 3, "çiftlerde olmasa da kartın numarası bulur");
  assert.equal(resolve("Bambaşka Ad", ` ${Y.slice(0, 3)}.${Y.slice(3)} `).card?.id, 3, "biçim farkı sayılmaz");
});

test("vergi no: ad önce gelir — B'nin diğer adıyla A'nın numarası B'ye gider; ikisi de şeritte birbirini görür", () => {
  const a = card({ id: 1, name: "Opera AVM", taxNumber: X });
  const b = card({ id: 2, name: "Opera Gayrimenkul", aliases: ["OPERA GAYRİMENKUL A.Ş."] });
  const list = [tinv("Opera AVM", X), tinv("OPERA GAYRİMENKUL A.Ş.", X)];
  const groups = groupSuppliers(list, [a, b], { today: TODAY, termDays: 30 });
  const ga = groups.find((g) => g.card?.id === 1)!;
  const gb = groups.find((g) => g.card?.id === 2)!;
  assert.equal(ga.invoices.length, 1);
  assert.equal(gb.invoices.length, 1, "kartın diğer adı her zaman kazanır (iki firmayı ayırmanın yolu)");
  assert.deepEqual(ga.sharedTax, [{ taxNumber: X, others: [{ name: "Opera Gayrimenkul", slug: gb.slug, cardId: 2, count: 1 }] }]);
  assert.deepEqual(gb.sharedTax, [{ taxNumber: X, others: [{ name: "Opera AVM", slug: ga.slug, cardId: 1, count: 1 }] }]);
});

test("vergi no: iki kartta aynı numara eşleşmede kullanılmaz; adsız fatura kendi adının grubunda kalır", () => {
  const a = card({ id: 1, name: "Kaldi", taxNumber: X });
  const b = card({ id: 2, name: "Kaldi Kahve", taxNumber: X });
  const list = [tinv("KALDI KAHVE TİC. A.Ş.", X), tinv("Kaldi", null)];
  const groups = groupSuppliers(list, [a, b], { today: TODAY, termDays: 30 });
  const legal = groups.find((g) => !g.card)!;
  assert.equal(legal.key, "kaldi kahve tic. a.ş.", "iki kart arasında karar verilemez: bugünkü gibi kendi adı");
  assert.equal(groups.find((g) => g.card?.id === 2)!.invoices.length, 0);
  assert.deepEqual(
    groups.find((g) => g.card?.id === 2)!.sharedTax[0].others.map((o) => o.name),
    ["KALDI KAHVE TİC. A.Ş.", "Kaldi"],
    "Türkçe sıra: ı, i'den önce",
  );
  assert.equal(supplierResolver([a, b], list).resolve("Başka Ad", X).card, null);
  // Kartlardan birinin kendi adıyla gelen faturası numarayı taşıyorsa numara faturalar üzerinden o karta bağlanır
  const bridged = groupSuppliers([...list, tinv("Kaldi", X)], [a, b], { today: TODAY, termDays: 30 });
  assert.equal(bridged.find((g) => g.card?.id === 1)!.invoices.length, 3);
});

test("vergi no: Paraşüt'ün geçici adı numarasıyla gerçek tedarikçisine gider, hiçbir şeyi köprülemez", () => {
  const P = PLACEHOLDER_SUPPLIER_NAME;
  const list = [tinv("Kaldi", X, "2026-10-01"), tinv(P, X, "2026-10-09"), tinv(P, Z, "2026-10-09"), tinv("Pruva", W), tinv(P, W, "2026-10-10")];
  const groups = groupSuppliers(list, [], { today: TODAY, termDays: 30 });
  const kaldi = groups.find((g) => g.key === "kaldi")!;
  assert.equal(kaldi.invoices.length, 2, "vergi nosu bilinen geçici ad gerçek tedarikçide");
  assert.deepEqual(kaldi.names, ["Kaldi"], "geçici ad başka grubun adlarına yazılmaz (Faturadan doldur bütün geçicilere bakmasın)");
  assert.equal(kaldi.name, "Kaldi");
  const placeholder = groups.find((g) => g.key === supplierMatchKey(P))!;
  assert.equal(placeholder.invoices.length, 1, "bağlanmayan numaralı geçici ad kendi grubunda");
  assert.deepEqual(placeholder.names, [P]);
  // İki geçici fatura farklı numaralarla iki adlı tedarikçiyi birleştirmez
  const two = groupSuppliers([tinv("A Ltd", X), tinv("B Ltd", Y), tinv(P, X), tinv(P, Y)], [], { today: TODAY, termDays: 30 });
  assert.deepEqual(two.map((g) => [g.key, g.invoices.length]).sort(), [["a ltd", 2], ["b ltd", 2]]);
});

test("vergi no: kontrol hanesi tutmayan ya da yer tutucu numara iki adı birleştirmez", () => {
  const list = [tinv("Ali Usta", "1234567890"), tinv("Veli Usta", "1234567890"), tinv("Can Gıda", "1234567891"), tinv("Cem Gıda", "1234567891")];
  const groups = groupSuppliers(list, [], { today: TODAY, termDays: 30 });
  assert.equal(groups.length, 4);
  assert.ok(groups.every((g) => !g.taxNumbers.length && g.taxNumber === null));
});

test("vergi no: iki numaralı tek ad bölünmez; iki numara da sayılarıyla yazılır", () => {
  const list = [tinv("Metro", X), tinv("Metro", X), tinv("Metro", Y), tinv("Metro Turizm", Y)];
  const groups = groupSuppliers(list, [], { today: TODAY, termDays: 30 });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].taxNumbers, [
    { taxNumber: Y, count: 2 },
    { taxNumber: X, count: 2 },
  ], "çok faturalı önce, eşitse numara sırası");
  assert.equal(groups[0].taxNumber, null, "birden çok numara: tek numara yok");
});

test("vergi no: sonuç girdinin sırasından ve tarihlerden bağımsız (liste, adres parçaları, ⌘K aynı adresi bulur)", () => {
  const cards = [card({ id: 1, name: "Kaldi" }), card({ id: 2, name: "Sütaş", taxNumber: Y })];
  const list = [
    tinv("Kaldi", X, "2026-10-01"),
    tinv("KALDI KAHVE TİC. A.Ş.", X, "2026-10-05"),
    tinv("SÜTAŞ A.Ş.", Y, "2026-09-01"),
    tinv("Pruva", Z, "2026-08-01"),
    tinv("PRUVA GIDA LTD", Z, "2026-10-03"),
    tinv("Erbak", null, "2026-07-01"),
    tinv(PLACEHOLDER_SUPPLIER_NAME, Z, "2026-10-04"),
  ];
  const base = shape(groupSuppliers(list, cards, { today: TODAY, termDays: 30 }));
  for (let n = 0; n < 5; n++) {
    const shuffled = [...list].sort(() => Math.random() - 0.5);
    assert.deepEqual(shape(groupSuppliers(shuffled, [...cards].reverse(), { today: TODAY, termDays: 30 })), base);
  }
  // loadSupplierRefs biçimi: (ad, vergi no) çiftleri tekrarsız, tarih o çiftin en yenisi
  const refs = new Map<string, { supplier: string; supplierTaxNumber: string | null; date: string }>();
  for (const i of list) {
    const k = `${i.supplier}|${i.supplierTaxNumber ?? ""}`;
    const cur = refs.get(k);
    if (!cur || i.date > cur.date) refs.set(k, { supplier: i.supplier, supplierTaxNumber: i.supplierTaxNumber ?? null, date: i.date });
  }
  const fromRefs = groupSuppliers(
    [...refs.values()].map((r) => ({ ...r, payable: 0, unpaid: false })),
    cards,
    { today: TODAY, termDays: 0 },
  );
  assert.deepEqual(
    fromRefs.map((g) => [g.key, g.slug]).sort(),
    base.map((g) => [g.key, g.slug]).sort(),
  );
});

test("vergi no: iki kartı bağlayan numarada adın vergi nolu kardeşleri tek karta gittiyse vergi nosuz satırı da onları izler", () => {
  const a = card({ id: 1, name: "Kaldi", taxNumber: X });
  const b = card({ id: 2, name: "Pruva" });
  // "Pruva" faturası X'i taşıyor: X ile Pruva kartı da aynı kümede (çakışma)
  const list = [tinv("Pruva", X), tinv("Kaldi Kahve", X), tinv("Kaldi Kahve", null, "2026-01-01")];
  const groups = groupSuppliers(list, [a, b], { today: TODAY, termDays: 30 });
  const ga = groups.find((g) => g.card?.id === 1)!;
  assert.deepEqual(ga.invoices.map((i) => i.supplierTaxNumber ?? null).sort(), [X, null].sort(), "Excel'deki Kaldi Kahve de Kaldi kartında");
  assert.equal(groups.find((g) => g.card?.id === 2)!.invoices.length, 1);
  // Kardeşleri iki ayrı karta gitmişse vergi nosuz satır kendi adında kalır
  const c = card({ id: 3, name: "Erbak", taxNumber: Z });
  const split = groupSuppliers([tinv("Su Ltd", X), tinv("Su Ltd", Z), tinv("Su Ltd", null)], [a, c], { today: TODAY, termDays: 30 });
  assert.deepEqual(
    split.map((g) => [g.card?.id ?? g.key, g.invoices.length]).sort(),
    [[1, 1], [3, 1], ["su ltd", 1]].sort(),
  );
});

test("vergi no: iki kartta duran addan kart açılırsa öteki faturalar da gelir; pencere söyler, listeden kaldırma durur", () => {
  const pruva = card({ id: 1, name: "Pruva", taxNumber: X });
  const erbak = card({ id: 2, name: "Erbak", taxNumber: Z });
  const list = [tinv("Su Ltd", X), tinv("Su Ltd", Z), tinv("Su Ltd", null, "2025-03-01"), tinv("Damla", Y), tinv("DAMLA SU A.Ş.", Y)];
  const groups = groupSuppliers(list, [pruva, erbak], { today: TODAY, termDays: 30 });
  const su = groups.find((g) => !g.card && g.key === "su ltd")!;
  assert.equal(su.invoices.length, 1, "vergi nosuz satır kendi adında (iki kart arasında karar verilemez)");
  const index = taxNameIndex(groups);
  const moves = nameMoves(index, su.names, null);
  assert.deepEqual(moves, { names: [{ name: "Su Ltd", count: 2 }], cards: ["Erbak", "Pruva"], count: 2 });
  // Önizleme olanla aynı: bu adla kart açılınca (listeden kaldırırken açılan gizli kart ya da Bilgileri ekle) iki
  // kartın "Su Ltd" faturaları da ona geçer
  const after = groupSuppliers(list, [pruva, erbak, card({ id: 3, name: "Su Ltd", hiddenOn: TODAY })], { today: TODAY, termDays: 30 });
  const count = (id: number) => after.find((g) => g.card?.id === id)!.invoices.length;
  assert.deepEqual([count(1), count(2), count(3)], [0, 0, su.invoices.length + moves.count]);
  assert.deepEqual(nameMoveLines(moves), ["“Su Ltd” adıyla gelen 2 fatura “Erbak”, “Pruva” tedarikçilerinden bu tedarikçiye geçer (ad önce gelir)."]);
  assert.equal(
    nameMoveBlock(su.name, moves, su.invoices.length),
    "“Su Ltd” adıyla gelen 2 fatura daha vergi nolarıyla “Erbak”, “Pruva” tedarikçilerinde duruyor; bu tedarikçi listeden kaldırılsa onlar da buraya geçerdi. Buradaki faturanın tedarikçi adını Faturalar'dan doğru firmanın adıyla değiştirin.",
  );
  // Kartsız tedarikçiye ilk cari kaydı da aynı kartı açar (ensureCard): aynı engel, kendi fiiliyle
  assert.equal(
    nameMoveBlock(su.name, moves, su.invoices.length, "bu tedarikçiye borç ya da ödeme girilse"),
    "“Su Ltd” adıyla gelen 2 fatura daha vergi nolarıyla “Erbak”, “Pruva” tedarikçilerinde duruyor; bu tedarikçiye borç ya da ödeme girilse onlar da buraya geçerdi. Buradaki faturanın tedarikçi adını Faturalar'dan doğru firmanın adıyla değiştirin.",
  );
  // Kartın kendi faturaları sayılmaz: Pruva'ya diğer ad olarak "Su Ltd" yazılırsa yalnız Erbak'taki gelir
  assert.deepEqual(nameMoves(index, ["Pruva", "su  LTD"], 1), { names: [{ name: "Su Ltd", count: 1 }], cards: ["Erbak"], count: 1 });
  assert.deepEqual(nameMoveLines(nameMoves(index, ["Su Ltd"], 1)), ["“Su Ltd” adıyla gelen 1 fatura “Erbak” tedarikçisinden bu tedarikçiye geçer (ad önce gelir)."]);
  // Kartsız kümenin adları başka kartta durmaz: ondan açılan kart yalnız kendi faturalarını alır (boşuna uyarı yok)
  const damla = groups.find((g) => !g.card && g.keys.includes("damla"))!;
  assert.equal(damla.invoices.length, 2);
  assert.equal(nameMoves(index, damla.names, null).count, 0);
  assert.deepEqual(nameMoveLines(nameMoves(index, ["Bambaşka"], null)), []);
  // Vergi nosu olmayan veride hiçbir ad başka kartta durmaz
  const plain = taxNameIndex(groupSuppliers(list.map((i) => ({ ...i, supplierTaxNumber: null })), [pruva, erbak], { today: TODAY, termDays: 30 }));
  assert.deepEqual(plain.viaTax, {});
  // Sunucu da aynı kuralla durur: kartsız tedarikçi için kart açılmadan (ve borçtan) önce bakılır
  const actions = readFileSync(join(root, "src/server/actions/suppliers.ts"), "utf8");
  const remove = actions.slice(actions.indexOf("export async function removeSupplier"), actions.indexOf("const hasInfo"));
  assert.match(remove, /const moves = g\.card \? null : nameMoves\(taxNameIndex\(groups\), g\.names, null\);\s*if \(moves\?\.count\) throw new UserError\(nameMoveBlock\(g\.name, moves, g\.invoices\.length\)\);/);
  assert.ok(remove.indexOf("nameMoves(") < remove.indexOf("if (g.summary.openCount)"), "borçtan önce");
  assert.ok(remove.indexOf("nameMoves(") < remove.indexOf(".insert(s.suppliers)"), "kart açılmadan önce");
});

test("vergi no: vergi nosu olmayan veride gruplar, anahtarlar ve adresler bugünküyle aynı (seed ve örnekler)", () => {
  const seedList = ds.invoices.map((i) => ({ ...i, outstanding: null }));
  assert.deepEqual(shape(groupSuppliers(seedList, [], { today: TODAY, termDays: 30 })), nameOnlyGroups(seedList, []));
  const cards = [card({ id: 1, name: "Sütaş", aliases: ["SÜTAŞ SÜT ÜRÜNLERİ A.Ş."] }), card({ id: 2, name: "Kaldi" }), card({ id: 3, name: "Boş Kart" })];
  const list = [
    tinv("Sütaş", null),
    tinv("SÜTAŞ SÜT ÜRÜNLERİ A.Ş.", null),
    tinv("KALDI (iade)", null),
    tinv("Erbak", null),
    tinv("erbak", null),
    tinv(PLACEHOLDER_SUPPLIER_NAME, null),
    tinv("Sutas", null),
  ];
  assert.deepEqual(shape(groupSuppliers(list, cards, { today: TODAY, termDays: 30 })), nameOnlyGroups(list, cards));
  // Faturalarda yalnız geçersiz ya da yer tutucu numara varsa da aynı
  const dummy = list.map((i, n) => ({ ...i, supplierTaxNumber: n % 2 ? "1234567890" : "1111111111" }));
  assert.deepEqual(shape(groupSuppliers(dummy, cards, { today: TODAY, termDays: 30 })), nameOnlyGroups(dummy, cards));
  // Vergi nosuz gruplarda yeni alanlar boş
  for (const g of groupSuppliers(list, cards, { today: TODAY, termDays: 30 })) {
    assert.deepEqual([g.viaTax, g.taxNumbers, g.sharedTax], [[], [], []], g.key);
  }
});

test("vergi no: eşitlemenin yeni faturası (çiftlerde yok) adıyla bulunur; peşin kartı ve vade günü Tedarikçiler'le aynı", () => {
  const kaldi = card({ id: 1, name: "Kaldi", paidOnDelivery: true, paymentTermDays: 7 });
  const refs = [{ supplier: "Kaldi", supplierTaxNumber: X }];
  const { resolve } = supplierResolver([kaldi], refs);
  assert.equal(resolve("KALDI KAHVE TİC. A.Ş.", X).card?.id, 1, "bilinen numarayla yeni ad");
  assert.equal(resolve("Kaldi", Y).card?.id, 1, "kartın adı zaten kazanır");
  // Kartsız adın bağlı olduğu numara: yeni numarayla gelen fatura adın kümesine katılır
  const r2 = supplierResolver([kaldi], [{ supplier: "Kaldi Kahve Ltd", supplierTaxNumber: X }, { supplier: "Kaldi", supplierTaxNumber: X }]);
  assert.equal(r2.resolve("Kaldi Kahve Ltd", Z).card?.id, 1, "yeni numara henüz çiftlerde yok: ad bağlar");
  assert.equal(r2.resolve("Başka Firma", Z).card, null);
  // Vade günü: resolve ile bulunan kartınki = grubun termDays (Ödemeler ve Tedarikçiler aynı vadeyi bulur)
  const list = [tinv("Kaldi", X), tinv("KALDI KAHVE TİC. A.Ş.", X), tinv("Erbak", null)];
  const groups = groupSuppliers(list, [kaldi], { today: TODAY, termDays: 30 });
  const r3 = supplierResolver([kaldi], list);
  for (const g of groups) for (const i of g.invoices) assert.equal(r3.resolve(i.supplier, i.supplierTaxNumber).card?.paymentTermDays ?? 30, g.termDays, i.supplier);
});

test("vergi no: Faturalar'daki bağlantı anahtarı (ad, vergi no) her faturayı kendi tedarikçisinin sayfasına götürür", () => {
  const cards = [card({ id: 1, name: "Kaldi" }), card({ id: 2, name: "Pruva", taxNumber: Z }), card({ id: 3, name: "Erbak", taxNumber: W })];
  const list = [
    tinv("Kaldi", X),
    tinv("KALDI KAHVE TİC. A.Ş.", X),
    tinv("KALDI KAHVE TİC. A.Ş.", null),
    tinv("Su Ltd", Z),
    tinv("Su Ltd", W),
    tinv("Su Ltd", null),
    tinv("Damla", null),
  ];
  const groups = groupSuppliers(list, cards, { today: TODAY, termDays: 30 });
  const slugs = Object.fromEntries(groups.flatMap((g) => g.invoices.map((i) => [supplierPairKey(i.supplier, i.supplierTaxNumber), g.slug] as const)));
  for (const g of groups) for (const i of g.invoices) assert.equal(slugs[supplierPairKey(i.supplier, i.supplierTaxNumber)], g.slug, `${i.supplier} ${i.supplierTaxNumber}`);
  // Aynı ad üç tedarikçide olabilir (numaralar iki ayrı kartta, numarasızı kendi adında): ad tek başına yetmez
  assert.deepEqual([Z, W, null].map((t) => slugs[supplierPairKey("Su Ltd", t)]), ["pruva", "erbak", "su-ltd"]);
  assert.equal(supplierPairKey("KALDI (iade)", ` ${X} `), `kaldi|${X}`);
  assert.equal(supplierPairKey("Kaldi", "1234567890"), "kaldi|", "eşleşmeye girmeyen numara anahtara da girmez");
});

test("vergi no: eksik bilgi, arama ve ödeme talebi faturalardaki numarayı da kullanır", () => {
  assert.deepEqual(missingInfo(null, X), ["iban", "iletisim"], "faturalardan bilinen numara eksik sayılmaz");
  assert.deepEqual(missingInfo({ iban: "TR…", taxNumber: null, phone: "0532", email: null, paidOnDelivery: false }, null), ["vergi"]);
  const hay = supplierHaystack({ name: "Kaldi", names: [], legalName: null, taxNumber: null, taxNumbers: [X, Y], iban: null, phone: null, contactName: null, email: null });
  assert.match(hay, new RegExp(Y));
  const text = paymentRequestText({ name: "Kaldi", card: null, taxNumber: X, lines: [] });
  assert.match(text, new RegExp(`Vergi no: ${X}`), "kartsız tedarikçide de faturalardaki numara");
  const own = paymentRequestText({ name: "Kaldi", card: { legalName: null, iban: null, bankName: null, accountHolder: null, taxNumber: Y }, taxNumber: X, lines: [] });
  assert.match(own, new RegExp(`Vergi no: ${Y}`), "kartta yazılı numara önce gelir");
});

test("vergi no önizlemesi: gelecek adlar, adıyla başka kartta kalanlar, numarası başka kartta da yazılı olan", () => {
  const kaldi = card({ id: 1, name: "Kaldi" });
  const opera = card({ id: 2, name: "Opera AVM" });
  const list = [
    tinv("KALDI KAHVE TİC. A.Ş.", X, "2026-10-01"),
    tinv("KALDI KAHVE TİC. A.Ş.", null, "2026-03-01"),
    tinv("Kaldi Kahve Ltd", X),
    tinv("Opera AVM", Y),
    tinv("Opera Gayrimenkul", Y),
    tinv(PLACEHOLDER_SUPPLIER_NAME, X),
  ];
  const groups = groupSuppliers(list, [kaldi, opera], { today: TODAY, termDays: 30 });
  const index = taxNameIndex(groups);
  // Kaldi kartına X yazılırsa: kartsız grubun bütün adları (vergi nosuz satırıyla) gelir; geçici ad sayılmaz
  const p = taxPreview(index, X, { cardId: 1, slug: null });
  assert.deepEqual(p, {
    join: {
      names: [
        { name: "KALDI KAHVE TİC. A.Ş.", count: 2 },
        { name: "Kaldi Kahve Ltd", count: 1 },
      ],
      count: 3,
    },
    stay: [],
    sharedCards: [],
  });
  assert.deepEqual(taxPreviewLines(p), ["Bu vergi noyla gelen 3 fatura da bu tedarikçide toplanır: KALDI KAHVE TİC. A.Ş. (2), Kaldi Kahve Ltd (1)."]);
  // Yeni kart Y ile: Opera AVM kendi adıyla kalır, Opera Gayrimenkul (vergi noyla bağlanmış) gelir
  const q = taxPreview(index, ` ${Y} `, { cardId: null, slug: null });
  assert.deepEqual(q.join.names, [{ name: "Opera Gayrimenkul", count: 1 }]);
  assert.deepEqual(q.stay, ["Opera AVM"]);
  assert.deepEqual(taxPreviewLines(q)[1], "“Opera AVM” adıyla eşleşen faturalar orada kalır (ad önce gelir).");
  // Kartsız tedarikçinin kendi sayfasında açılan kart: kendi faturaları zaten adlarıyla gelir
  const legal = groups.find((g) => g.key === "kaldi kahve ltd")!;
  assert.equal(taxPreview(index, X, { cardId: null, slug: legal.slug }).join.count, 0);
  // Numara başka kartta yazılıysa eşleşme ikisinde de çalışmaz
  const shared = taxNameIndex(groupSuppliers(list, [kaldi, { ...opera, taxNumber: X }], { today: TODAY, termDays: 30 }));
  assert.deepEqual(shared.cardTax[X], [{ id: 2, name: "Opera AVM" }]);
  const s = taxPreview(shared, X, { cardId: 1, slug: null });
  assert.deepEqual(s, { join: { names: [], count: 0 }, stay: [], sharedCards: ["Opera AVM"] });
  assert.deepEqual(taxPreviewLines(s), ["Bu vergi no “Opera AVM” tedarikçisinde de kayıtlı: vergi noyla eşleşme ikisinde de çalışmaz, faturalar adlarına göre ayrılır."]);
  assert.deepEqual(taxPreview(shared, X, { cardId: 2, slug: null }).sharedCards, [], "kartın kendi numarası kendisiyle çakışmaz");
  // Geçersiz numara önizleme vermez
  assert.deepEqual(taxPreviewLines(taxPreview(index, "1234567891", { cardId: 1, slug: null })), []);
});

test("vergi no şeridi: öteki tedarikçi başına bir not; yapılabilecek olan söylenir, olmayan söylenmez", () => {
  const shared = [
    {
      taxNumber: X,
      others: [
        { name: "Kaldi Kahve", slug: "kaldi-kahve", cardId: 2, count: 4 },
        { name: "KALDI LTD", slug: "kaldi-ltd", cardId: null, count: 1 },
      ],
    },
    { taxNumber: Y, others: [{ name: "Kaldi Kahve", slug: "kaldi-kahve", cardId: 2, count: 4 }] },
  ];
  const notes = sharedTaxNotes({ hasCard: true, count: 3, names: ["Kaldi"] }, shared);
  assert.deepEqual(
    notes.map((n) => n.slug),
    ["kaldi-kahve", "kaldi-ltd"],
    "aynı tedarikçi iki numarada bir kez",
  );
  assert.equal(notes[0].text, `“Kaldi Kahve” tedarikçisi de aynı vergi nosunu (${X}) taşıyor; faturaları ayrı duruyor.`, "ikisi de faturalı: yalnız bilgi");
  assert.equal(notes[1].text, `“KALDI LTD” adıyla gelen faturalarda da bu vergi no (${X}) var. Aynı firmaysa Düzenle'den diğer adlara ekleyin.`);
  // Faturasız kart silinebilir: o zaman adı öteki kartın diğer adlarına eklenebilir
  const empty = sharedTaxNotes({ hasCard: true, count: 3, names: ["Kaldi"] }, [{ taxNumber: X, others: [{ name: "Kaldi Kahve", slug: "k", cardId: 2, count: 0 }] }]);
  assert.match(empty[0].text, /Aynı firmaysa o tedarikçiyi Düzenle'den silip adını buradaki ‘Diğer adlar’a ekleyin\.$/);
  const mine = sharedTaxNotes({ hasCard: true, count: 0, names: [] }, [{ taxNumber: X, others: [{ name: "Kaldi", slug: "k", cardId: 2, count: 5 }] }]);
  assert.match(mine[0].text, /Aynı firmaysa bu tedarikçiyi Düzenle'den silip adını onun ‘Diğer adlar’ına ekleyin\.$/);
  // Kartsız tedarikçinin adları kartın diğer adlarına eklenebilir
  const cardless = sharedTaxNotes({ hasCard: false, count: 2, names: ["KALDI LTD", "Kaldi Ltd Şti"] }, [{ taxNumber: X, others: [{ name: "Kaldi", slug: "kaldi", cardId: 1, count: 5 }] }]);
  assert.match(cardless[0].text, /onun sayfasında Düzenle'den bu adları diğer adlara ekleyin\.$/);
});

test("vergi no: listede adın altında aynı vergi noyla toplanan öteki adlar", () => {
  const sutas = card({ id: 1, name: "Sütaş", aliases: ["Sütaş A.Ş."] });
  const groups = groupSuppliers(
    [tinv("Kaldi", null, "2026-03-01"), tinv("Kaldi", X, "2026-10-01"), tinv("KALDI KAHVE TİC. A.Ş.", X, "2026-10-08"), tinv("Sütaş A.Ş.", Y), tinv("SÜTAŞ SÜT ÜRÜNLERİ A.Ş.", Y), tinv("Erbak", null)],
    [sutas],
    { today: TODAY, termDays: 30 },
  );
  const of = (name: string) => sameTaxNames(groups.find((g) => g.name === name)!);
  assert.deepEqual(of("KALDI KAHVE TİC. A.Ş."), ["Kaldi"], "kartsızda görünen addan başkası");
  assert.deepEqual(of("Sütaş"), ["SÜTAŞ SÜT ÜRÜNLERİ A.Ş."], "kartlıda yalnız vergi noyla gelen (diğer ad değil)");
  assert.deepEqual(of("Erbak"), []);
});
