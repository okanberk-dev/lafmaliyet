// Fotoğraftan okuma: şemanın API biçimi, yazılan tutarın yeniden okunması, Z raporu / banka POS / fiş okumalarının
// forma gidecek hâli ve denetimleri, formun yalnız boş alanları doldurması, kayıttan sonra "fotoğraftan farklı",
// kasadan çıkanların notu ve uyarısı (src/lib/photo-read/*, src/lib/cash-outs.ts). Girdiler canlıda alınmış beş
// yanıt (tests/fixtures/foto; sentetik fişler, docs/planlar/fotograf.md §10).
// Çalıştırma: npx tsx --test tests/fotograf-okuma.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  cashOutCheck,
  cashOutLabel,
  cashOutNoteOf,
  cashOutShortLabel,
  cashOutShortLine,
  cashOutWritesExpense,
  staffCategory,
  staffExpenseLocked,
  staffToExpenses,
} from "../src/lib/cash-outs";
import { claudeSchema } from "../src/lib/photo-read/claude-schema";
import { businessDayOf, clean, DOC_NAMES, foldName, printedAmount, tidyStore, validDay } from "../src/lib/photo-read/common";
import {
  FISCAL_Z_CARD_TEXT,
  fieldText,
  normalizePos,
  normalizeZ,
  photoDiffs,
  photoDiffText,
  posPromptMarks,
  prefillPlan,
  prefillSummary,
  savedFields,
  suspiciousDiffs,
  type CashReading,
} from "../src/lib/photo-read/kasa";
import { expenseDateFor, normalizeReceipt, receiptToStore, type ReceiptContext } from "../src/lib/photo-read/receipt";
import { KasaPosRaw, KasaZRaw, ReceiptRaw, type KasaPos, type KasaZ, type Receipt } from "../src/lib/photo-read/schemas";

/** Boşlukları (₺ önündeki bölünmez boşluk dahil) düz boşluğa çevirir */
const plain = (s: string) => s.replace(/ /g, " ");
const fixture = (name: string) => JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "foto", `${name}.json`), "utf8")).json;
const Z: KasaZ = KasaZRaw.parse(fixture("z"));
const POS: KasaPos = KasaPosRaw.parse(fixture("pos"));
const WRONG: KasaZ = KasaZRaw.parse(fixture("yanlis-belge"));
const FIS: Receipt = ReceiptRaw.parse(fixture("fis-soluk"));
const TALIMAT: Receipt = ReceiptRaw.parse(fixture("fis-talimat"));
const clone = <T>(v: T): T => structuredClone(v);

const CATS: ReceiptContext["categories"] = [
  { id: 1, name: "Nakit malzeme alımı", section: "mal" },
  { id: 2, name: "Bakım & onarım", section: "genel" },
];
const ctx = (over: Partial<ReceiptContext> = {}): ReceiptContext => ({ day: "2026-10-21", categories: CATS, recent: [], staff: true, ...over });

/** Şemadaki her düğüm */
function* nodes(v: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(v)) for (const x of v) yield* nodes(x);
  else if (v && typeof v === "object") {
    yield v as Record<string, unknown>;
    for (const x of Object.values(v)) yield* nodes(x);
  }
}

test("şema: enum'lar kalır, her nesne additionalProperties:false, API'nin almadığı sınırlar yok", () => {
  for (const schema of [KasaZRaw, KasaPosRaw, ReceiptRaw]) {
    const json = claudeSchema(schema);
    const all = [...nodes(json)];
    assert.ok(!JSON.stringify(json).includes('"$schema"'));
    for (const n of all) {
      for (const k of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "pattern", "maxItems"]) assert.ok(!(k in n && typeof n[k] !== "object"), `${k} kaldı`);
      if (n.type === "object") assert.equal(n.additionalProperties, false);
    }
  }
  const z = claudeSchema(KasaZRaw) as { properties: Record<string, { enum?: string[]; items?: { properties: Record<string, { enum?: string[] }> } }> };
  assert.deepEqual(z.properties.documentType.enum, ["z_report", "fiscal_z_report", "bank_pos_end_of_day", "purchase_receipt", "invoice", "other"]);
  const pos = claudeSchema(KasaPosRaw) as { properties: Record<string, { enum?: string[] }> };
  assert.deepEqual(pos.properties.documentType.enum, ["bank_pos_end_of_day", "z_report", "fiscal_z_report", "purchase_receipt", "invoice", "other"]);
  assert.deepEqual(z.properties.paymentLines.items!.properties.kind.enum, ["cash", "card", "meal_card", "online", "other", "comp", "unknown"]);
  // Canlıda denenen yanıtlar şemaya uyar
  for (const f of ["z", "yanlis-belge"]) assert.ok(KasaZRaw.safeParse(fixture(f)).success, f);
  assert.ok(KasaPosRaw.safeParse(fixture("pos")).success);
  for (const f of ["fis-soluk", "fis-talimat"]) assert.ok(ReceiptRaw.safeParse(fixture(f)).success, f);
});

test("yazılan tutar yeniden okunur: yıldız, TL, eksi; metin ile sayı tutmazsa metin geçer, güven düşer", () => {
  assert.deepEqual(printedAmount({ text: "*12.975,50", value: 12975.5, confidence: "high" }), { value: 12975.5, confidence: "high", mismatch: false });
  assert.deepEqual(printedAmount({ text: "8.915,00 TL", value: 8915, confidence: "high" }), { value: 8915, confidence: "high", mismatch: false });
  assert.deepEqual(printedAmount({ text: "-74,15", value: -74.15, confidence: "medium" }), { value: -74.15, confidence: "medium", mismatch: false });
  assert.deepEqual(printedAmount({ text: "3.402,50", value: 3420.5, confidence: "high" }), { value: 3402.5, confidence: "low", mismatch: true });
  assert.deepEqual(printedAmount({ text: null, value: null, confidence: "low" }), { value: null, confidence: "low", mismatch: false });
  // Metin okunamazsa modelin sayısı
  assert.deepEqual(printedAmount({ text: "?", value: 15, confidence: "medium" }), { value: 15, confidence: "medium", mismatch: false });
  // Banka POS fişinin İngilizce yazımı modelin sayısıyla tutar
  assert.deepEqual(printedAmount({ text: "12,975.50", value: 12975.5, confidence: "high" }), { value: 12975.5, confidence: "high", mismatch: false });
  // Basamak kayması (metin yüzde birinden küçük okunursa): modelin sayısı kalır, alan turuncu olur
  assert.deepEqual(printedAmount({ text: "12,98", value: 12975.5, confidence: "high" }), { value: 12975.5, confidence: "low", mismatch: true });
  assert.deepEqual(printedAmount({ text: "12.975.500", value: 12975.5, confidence: "high" }), { value: 12975.5, confidence: "low", mismatch: true });
  // Sıfır basamak kayması değildir: model 0 yazdıysa metindeki tutar geçer (eskiden 0 kalıyordu); metin 0 ise o geçer
  assert.deepEqual(printedAmount({ text: "12,50", value: 0, confidence: "high" }), { value: 12.5, confidence: "low", mismatch: true });
  assert.deepEqual(printedAmount({ text: "0,00", value: 12.5, confidence: "high" }), { value: 0, confidence: "low", mismatch: true });
});

test("ortak: temizlik, takvim günü, 05:00'ten önce basılan fiş bir önceki güne", () => {
  assert.equal(clean("  MİGROS\u0007 \n TİC  ", 40), "MİGROS TİC");
  assert.equal(clean("x".repeat(50), 10), `${"x".repeat(9)}…`);
  assert.equal(clean("   ", 10), null);
  assert.ok(validDay("2026-10-21") && !validDay("2026-02-30") && !validDay("21.10.2026"));
  assert.equal(businessDayOf("2026-10-22", "00:30"), "2026-10-21");
  assert.equal(businessDayOf("2026-10-22", "04:59"), "2026-10-21");
  assert.equal(businessDayOf("2026-10-21", "23:48"), "2026-10-21");
  assert.equal(businessDayOf("2026-10-21", null), "2026-10-21");
  assert.equal(businessDayOf(null, "23:48"), null);
  assert.equal(foldName("MİGROS TİCARET A.Ş."), foldName("Migros"));
  assert.equal(tidyStore("MİGROS TİCARET A.Ş."), "Migros");
  assert.equal(tidyStore("İSTANBUL GIDA SAN. VE TİC. LTD. ŞTİ."), "İstanbul Gıda");
  assert.equal(tidyStore("BÜFE ÇİÇEK"), "Büfe Çiçek");
  assert.equal(tidyStore("TİCARET A.Ş."), "TİCARET A.Ş.");
});

test("Z raporu: ödeme türleri, indirim, ikram, Z no, fiş sayısı; uyarı yok", () => {
  const r = normalizeZ(Z, { day: "2026-10-21", prevZNo: "0186" });
  assert.equal(r.ok, true);
  assert.equal(r.printedDay, "2026-10-21");
  const v = Object.fromEntries(Object.entries(r.values).map(([k, x]) => [k, x!.value]));
  assert.deepEqual(v, { zTotal: 12975.5, cash: 3420.5, card: 8915, mealCard: 640, online: 0, other: 0, discounts: 310, offRevenue: 245, zNo: "0187", receipts: 143 });
  assert.ok(Object.values(r.values).every((x) => x!.confidence === "high"));
  assert.deepEqual(r.checks, []);
  assert.deepEqual(r.missing, []);
});

test("Z raporu: Z no sırası, tarih, tutmayan toplam, tanınmayan ve ikram satırı, iade", () => {
  const gap = normalizeZ(Z, { day: "2026-10-21", prevZNo: "0185" });
  assert.deepEqual(gap.checks.map((c) => [c.level, c.text]), [["info", "Önceki raporun Z no'su 0185; bu 0187. Arada 1 Z raporu girilmemiş olabilir."]]);
  const old = normalizeZ(Z, { day: "2026-10-21", prevZNo: "0187" });
  assert.deepEqual(old.checks[0], { fields: ["zNo"], level: "warn", text: "Z no (0187) önceki raporunkinden (0187) büyük değil; eski bir Z raporu olabilir." });
  // Gece yarısından sonra basılan rapor bir önceki günündür: tarih uyarısı yok
  const late = clone(Z);
  late.date = "2026-10-22";
  late.time = "00:30";
  assert.deepEqual(normalizeZ(late, { day: "2026-10-21", prevZNo: null }).checks, []);
  const wrongDay = normalizeZ(Z, { day: "2026-10-22", prevZNo: null });
  assert.equal(plain(wrongDay.checks[0].text), "Fişteki tarih 21 Ekim Çarşamba; bu rapor 22 Ekim Perşembe için. Doğru günün Z raporu mu?");
  // Nakit 3.402,50 okunsa: ödeme türleri Z'yi tutmaz, toplam ve ödeme alanları turuncu
  const misread = clone(Z);
  misread.paymentLines[0].amount = { text: "3.402,50", value: 3402.5, confidence: "high" };
  const sum = normalizeZ(misread, { day: "2026-10-21", prevZNo: null });
  assert.deepEqual(sum.checks[0].fields, ["zTotal", "cash", "card", "mealCard", "online", "other"]);
  assert.equal(plain(sum.checks[0].text), "Ödeme türlerinin toplamı 12.957,50 ₺: Z toplamından 18 ₺ az. Bir tutar yanlış okunmuş olabilir.");
  // Tanınmayan satır Diğer'e, ikram satırı ödenmez / ikrama (basılı toplam yoksa)
  const odd = clone(Z);
  odd.paymentLines.push({ label: "KUPON", amount: { text: "50,00", value: 50, confidence: "high" }, kind: "unknown" });
  odd.paymentLines.push({ label: "İKRAM", amount: { text: "120,00", value: 120, confidence: "high" }, kind: "comp" });
  odd.comps = { text: null, value: null, confidence: "low" };
  odd.refunds = { text: "35,00", value: 35, confidence: "high" };
  const r = normalizeZ(odd, { day: "2026-10-21", prevZNo: null });
  assert.equal(r.values.other!.value, 50);
  assert.equal(r.values.offRevenue!.value, 120);
  const texts = r.checks.map((c) => plain(c.text));
  assert.ok(texts.includes("Tanınmayan ödeme satırı “KUPON” (50 ₺) Diğer'e eklendi; doğru mu?"));
  assert.ok(texts.includes("“İKRAM” ödenmez / ikram olarak alındı."));
  assert.ok(texts.includes("Z raporunda 35 ₺ iade var; nedenini nota yazın."));
  // Uyarılar bilgilerden önce
  const levels = r.checks.map((c) => c.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => (a === b ? 0 : a === "warn" ? -1 : 1)));
});

test("Z raporu: soluk fiş, okunamayan toplam ve ödeme bölümü, metin ile sayı tutmuyor", () => {
  const faded = clone(Z);
  faded.issues = ["faded"];
  faded.paymentLines[1].amount.confidence = "medium";
  const r = normalizeZ(faded, { day: "2026-10-21", prevZNo: null });
  const issue = r.checks.find((c) => c.text.startsWith("Baskı silik"))!;
  // Görüntü sorunu güveni "high" olmayan alanları turuncu yapar (Z no ve fiş sayısının güveni yok: orta sayılır)
  assert.deepEqual(issue.fields.sort(), ["card", "receipts", "zNo"]);
  const blank = clone(Z);
  blank.total = { text: null, value: null, confidence: "low" };
  blank.paymentLines = [];
  assert.deepEqual(normalizeZ(blank, { day: "2026-10-21", prevZNo: null }).missing, ["zTotal", "cash", "card"]);
  const unreadLine = clone(Z);
  unreadLine.paymentLines[2].amount = { text: null, value: null, confidence: "low" };
  const u = normalizeZ(unreadLine, { day: "2026-10-21", prevZNo: null });
  assert.equal(u.values.mealCard, undefined);
  assert.ok(u.missing.includes("mealCard"));
  const mismatch = clone(Z);
  mismatch.total = { text: "*12.975,50", value: 12795.5, confidence: "high" };
  const m = normalizeZ(mismatch, { day: "2026-10-21", prevZNo: null });
  assert.deepEqual(m.values.zTotal, { value: 12975.5, confidence: "low" });
  assert.equal(m.checks[0].text, "Okuma tutarsız (fişte “*12.975,50”); fişle karşılaştırın.");
  // Okunamayan fotoğraf: hiçbir alan dolmaz
  const unreadable = clone(Z);
  unreadable.readable = false;
  const x = normalizeZ(unreadable, { day: "2026-10-21", prevZNo: null });
  assert.equal(x.ok, false);
  assert.equal(x.error, "Fotoğraf okunamadı: rakamlar seçilmiyor. Fişi düz tutup ışıkta yeniden çekin ya da elle yazın.");
  assert.deepEqual(x.values, {});
});

test("Z bölümüne POS fişi: belge türü yanlışsa hiçbir alan dolmaz, Banka POS Z bölümüne okutulabilir", () => {
  const r = normalizeZ(WRONG, { day: "2026-10-21", prevZNo: null });
  assert.equal(r.ok, false);
  // Düğme "kasa-pos" der: dağıtımdan önce açılmış sayfa onu tanır; yeni form "kasa-okc"ye çevirir (cash-form onSwitch)
  assert.equal(r.switchTo, "kasa-pos");
  assert.equal(r.error, "Bu bir banka gün sonu fişi gibi görünüyor, Z raporu değil.");
  assert.deepEqual(r.values, {});
  assert.deepEqual(prefillPlan(r, { card: "" }), { fill: [], differs: [], unsure: [], missing: [] });
  const receipt = clone(Z);
  receipt.documentType = "purchase_receipt";
  const x = normalizeZ(receipt, { day: "2026-10-21", prevZNo: null });
  assert.equal(x.error, "Bu bir alışveriş fişi gibi görünüyor. ModPOS Z raporunun fotoğrafını çekin.");
  assert.equal(x.switchTo, null);
  // Tanınmayan belge: "Bu bir başka bir belge" değil
  const other = clone(Z);
  other.documentType = "other";
  assert.equal(normalizeZ(other, { day: "2026-10-21", prevZNo: null }).error, "Bu başka bir belge gibi görünüyor. ModPOS Z raporunun fotoğrafını çekin.");
  const otherPos = clone(POS);
  otherPos.documentType = "other";
  assert.equal(normalizePos(otherPos, { day: "2026-10-21" }).error, "Bu başka bir belge gibi görünüyor. Banka POS gün sonu fişinin fotoğrafını çekin.");
});

/**
 * Yazarkasanın (banka POS) mali Z'si, modelin bütün rakamlarını okuduğu hâliyle: ModPOS fikstürünün tutarları ve Z no'su
 * (en kötü durum: belge türü dışında her şey dolu gelir)
 */
function fiscalZ(): KasaZ {
  const r = clone(Z);
  r.documentType = "fiscal_z_report";
  r.zNo = "0188";
  return r;
}
function fiscalPos(): KasaPos {
  const r = clone(POS);
  r.documentType = "fiscal_z_report";
  r.bank = null;
  r.batchNo = null;
  // POS_TASK alanları boş bırakmasını ister; okumuşsa da (toplam Z'nin NET SATIŞ'ı) hiçbiri forma gitmez
  r.salesTotal = { text: "*12.300,00", value: 12300, confidence: "high" };
  r.netTotal = { text: "*12.300,00", value: 12300, confidence: "high" };
  return r;
}

test("yazarkasa Z'si ModPOS bölümüne: hiçbir alan dolmaz, Banka POS Z bölümüne okutulur (banka gün sonu fişi de)", () => {
  const empty = { zTotal: "", cash: "", card: "", mealCard: "", online: "", other: "", offRevenue: "", discounts: "", zNo: "", receipts: "", bankPos: "" };
  const r = normalizeZ(fiscalZ(), { day: "2026-10-21", prevZNo: "0187" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "Bu yazarkasanın (banka POS) Z raporu gibi görünüyor, ModPOS'unki değil.");
  assert.equal(r.switchTo, "kasa-pos");
  assert.ok(!r.advice, "kırmızı hata ve düğme");
  assert.deepEqual([r.values, r.missing, r.checks, r.printedDay], [{}, [], [], null]);
  assert.deepEqual(prefillPlan(r, empty), { fill: [], differs: [], unsure: [], missing: [] });
  // Z no ModPOS'un sırasına karışmaz: önceki ModPOS Z no'suyla denetlenmez, kayıttan sonra "Fotoğraftan farklı" olmaz
  assert.deepEqual(photoDiffs([r], savedFields({ zTotal: 12975.5, cash: 3420.5, card: 8915, mealCard: 640, online: 0, other: 0, offRevenue: 245, zNo: "0187", receipts: 143, bankPos: null })), []);
  // Banka gün sonu fişi de aynı bölüme gider, kendi metniyle
  const bank = normalizeZ(WRONG, { day: "2026-10-21", prevZNo: null });
  assert.deepEqual([bank.ok, bank.switchTo, bank.values], [false, "kasa-pos", {}]);
  assert.equal(DOC_NAMES.fiscal_z_report, "yazarkasa (banka POS) Z raporu");
});

test("yazarkasa Z'si Banka POS bölümüne: Banka POS dolmaz, düğme yok, K.KARTI satırı yönergesi (turuncu)", () => {
  const r = normalizePos(fiscalPos(), { day: "2026-10-21" });
  assert.equal(r.ok, false);
  assert.equal(r.kind, "kasa-pos");
  assert.equal(r.advice, true);
  assert.equal(r.switchTo, null, "öteki bölüme okut yok");
  assert.equal(r.error, FISCAL_Z_CARD_TEXT);
  assert.equal(r.error, "Bu yazarkasanın Z raporu. Banka POS'a Z'deki K.KARTI (kredi kartı) satırını yazın; toplamı ya da altındaki banka satırlarını değil.");
  assert.deepEqual([r.values, r.missing, r.checks], [{}, [], []]);
  assert.deepEqual(prefillPlan(r, { bankPos: "" }), { fill: [], differs: [], unsure: [], missing: [] });
  assert.deepEqual(posPromptMarks(r), { warn: null, unsure: null });
  // Personelin yazdığı K.KARTI (8.480) okunan toplamla (12.300) karşılaştırılmaz
  assert.deepEqual(photoDiffs([r], savedFields({ zTotal: 12975.5, cash: 3420.5, card: 8915, mealCard: 640, online: 0, other: 0, offRevenue: 245, zNo: "0187", receipts: 143, bankPos: 8480 })), []);
  // Öteki yönler aynen: ModPOS'un Z'si ModPOS bölümüne, okunamayan yazarkasa Z'si de yönerge
  const unreadable = fiscalPos();
  unreadable.readable = false;
  assert.equal(normalizePos(unreadable, { day: "2026-10-21" }).error, FISCAL_Z_CARD_TEXT);
});

test("eski okumalar: kayıtlı yanıtlar ve eski belge türleri aynen ayrışır, aynı sonucu verir", () => {
  // Enum'a değer eklemek eski ai_calls.result'ları bozmaz: kayıtlı yanıt olduğu gibi geçer
  assert.deepEqual(KasaZRaw.parse(fixture("z")), fixture("z"));
  assert.deepEqual(KasaZRaw.parse(fixture("yanlis-belge")), fixture("yanlis-belge"));
  assert.deepEqual(KasaPosRaw.parse(fixture("pos")), fixture("pos"));
  for (const t of ["z_report", "bank_pos_end_of_day", "purchase_receipt", "invoice", "other"]) {
    assert.ok(KasaZRaw.safeParse({ ...fixture("z"), documentType: t }).success, `Z ${t}`);
    assert.ok(KasaPosRaw.safeParse({ ...fixture("pos"), documentType: t }).success, `POS ${t}`);
  }
  // Eski yanıtın sonucu değişmedi (Z raporu ve banka POS fişi dolar, yanlış belge Banka POS Z bölümüne)
  assert.equal(normalizeZ(Z, { day: "2026-10-21", prevZNo: "0186" }).values.zTotal!.value, 12975.5);
  assert.equal(normalizePos(POS, { day: "2026-10-21" }).values.bankPos!.value, 8915);
  assert.equal(normalizeZ(WRONG, { day: "2026-10-21", prevZNo: null }).switchTo, "kasa-pos");
  // Bilinmeyen tür (silinmiş ya da uydurma) reddedilir
  assert.equal(KasaZRaw.safeParse({ ...fixture("z"), documentType: "okc_z" }).success, false);
});

test("banka POS: net toplam; satış − iade tutmazsa uyarı; Z raporu Z bölümüne", () => {
  const r = normalizePos(POS, { day: "2026-10-21" });
  assert.deepEqual(r.values, { bankPos: { value: 8915, confidence: "high" } });
  assert.deepEqual(r.checks, []);
  const off = clone(POS);
  off.refundTotal = { text: "120,00", value: 120, confidence: "high" };
  assert.equal(plain(normalizePos(off, { day: "2026-10-21" }).checks[0].text), "Net toplam 8.915 ₺, satış − iade 8.795 ₺; fişle karşılaştırın.");
  const noNet = clone(POS);
  noNet.netTotal = { text: null, value: null, confidence: "low" };
  noNet.refundTotal = { text: "15,00", value: 15, confidence: "medium" };
  assert.deepEqual(normalizePos(noNet, { day: "2026-10-21" }).values.bankPos, { value: 8900, confidence: "medium" });
  const two = clone(POS);
  two.issues = ["multiple_documents"];
  assert.equal(normalizePos(two, { day: "2026-10-21" }).checks[0].text, "Fişte birden fazla cihaz ya da gün var; yalnız bu günün toplamını yazın.");
  const z = clone(POS);
  z.documentType = "z_report";
  const w = normalizePos(z, { day: "2026-10-21" });
  assert.equal(w.switchTo, "kasa-z");
  assert.equal(w.error, "Bu ModPOS'un Z raporu gibi görünüyor, banka POS'unki değil.");
  assert.ok(!w.advice, "ModPOS'un Z'si kırmızı hata, ModPOS bölümüne okutulur");
  const nothing = clone(POS);
  nothing.netTotal = { text: null, value: null, confidence: "low" };
  nothing.salesTotal = { text: null, value: null, confidence: "low" };
  assert.deepEqual(normalizePos(nothing, { day: "2026-10-21" }).missing, ["bankPos"]);
  const wrongDay = normalizePos(POS, { day: "2026-10-22" });
  assert.equal(plain(wrongDay.checks[0].text), "Fişteki tarih 21 Ekim Çarşamba; bu rapor 22 Ekim Perşembe için. Doğru günün POS fişi mi?");
});

test("ikinci POS fişi: net okunmayan ya da denetime takılan rakam seçilince de turuncu kalır", () => {
  assert.deepEqual(posPromptMarks(normalizePos(POS, { day: "2026-10-21" })), { warn: null, unsure: null });
  // Orta güven: soruda ve alanda "net değil"
  const faint = clone(POS);
  faint.netTotal.confidence = "medium";
  assert.deepEqual(posPromptMarks(normalizePos(faint, { day: "2026-10-21" })), { warn: "Fotoğrafta net değil; fişle karşılaştırın.", unsure: "Fotoğrafta net değil; fişle karşılaştırın." });
  // Tahmin: soruda söylenir, seçilirse alan turuncu kalır
  const guess = clone(POS);
  guess.netTotal = { text: "1.200,00", value: 1200, confidence: "low" };
  guess.salesTotal = { text: "1.200,00", value: 1200, confidence: "low" };
  const g = posPromptMarks(normalizePos(guess, { day: "2026-10-21" }));
  assert.equal(plain(g.unsure!), "Fotoğrafta net okunamadı (1.200 ₺); fişle karşılaştırın.");
  assert.equal(g.warn, g.unsure);
  // Net okunmuş ama denetime takılmış: alan denetimin metniyle turuncu, soruda ek satır yok
  const off = clone(POS);
  off.refundTotal = { text: "120,00", value: 120, confidence: "high" };
  const w = posPromptMarks(normalizePos(off, { day: "2026-10-21" }));
  assert.equal(w.unsure, null);
  assert.equal(plain(w.warn!), "Net toplam 8.915 ₺, satış − iade 8.795 ₺; fişle karşılaştırın.");
});

test("forma uygulama: yalnız boş alanlar dolar; farklı yazılan kalır; tahmin yazılmaz; okunamayan söylenir", () => {
  const r: CashReading = normalizeZ(Z, { day: "2026-10-21", prevZNo: null });
  const empty = { zTotal: "", cash: "", card: "", mealCard: "", online: "", other: "", offRevenue: "", zNo: "", receipts: "", bankPos: "" };
  const all = prefillPlan(r, empty);
  assert.equal(all.fill.length, 9);
  assert.deepEqual(all.fill.find((f) => f.field === "zTotal"), { field: "zTotal", text: "12975,5", warn: null });
  assert.ok(!all.fill.some((f) => f.field === "discounts"), "formda olmayan alan atlanır");
  assert.equal(prefillSummary("kasa-z", all), "Z raporundan dolduruldu: 9 alan. Kontrol edip gönderin.");
  // Kart elle 8.951 yazılmış: kalır, fotoğraftaki gösterilir; aynı yazılan (0187 / 187) sorun değil
  const typed = prefillPlan(r, { ...empty, card: "8951", zNo: "187" });
  assert.ok(!typed.fill.some((f) => f.field === "card" || f.field === "zNo"));
  assert.deepEqual(typed.differs, [{ field: "card", photo: 8915, text: "8915" }]);
  assert.equal(prefillSummary("kasa-z", typed), "Z raporundan dolduruldu: 7 alan. Turuncu olanları fişle karşılaştırıp gönderin.");
  // Orta güven doldurulur ama turuncu; düşük güven (tahmin) doldurulmaz
  const unsure = clone(r);
  unsure.values.cash = { value: 3420.5, confidence: "medium" };
  unsure.values.card = { value: 8915, confidence: "low" };
  const p = prefillPlan(unsure, empty);
  assert.equal(p.fill.find((f) => f.field === "cash")!.warn, "Fotoğrafta net değil; fişle karşılaştırın.");
  assert.deepEqual(p.unsure, [{ field: "card", photo: 8915, text: "8915" }]);
  assert.ok(!p.fill.some((f) => f.field === "card"));
  // Uyarı metni alanın turuncu nedenidir
  const old = normalizeZ(Z, { day: "2026-10-21", prevZNo: "0190" });
  assert.match(prefillPlan(old, empty).fill.find((f) => f.field === "zNo")!.warn!, /eski bir Z raporu/);
  // Okunamayan alanlar (boşsa) personel yazar
  const blank = clone(Z);
  blank.total = { text: null, value: null, confidence: "low" };
  const b = prefillPlan(normalizeZ(blank, { day: "2026-10-21", prevZNo: null }), empty);
  assert.deepEqual(b.missing, ["zTotal"]);
  assert.equal(fieldText("receipts", 143), "143");
  assert.equal(fieldText("zNo", "0187"), "0187");
});

const SAVED = savedFields({ zTotal: 12975.5, cash: 3420.5, card: 8951, mealCard: 640, online: 0, other: 0, offRevenue: 245, zNo: "0187", receipts: 143, bankPos: 8915 });

test("fotoğraftan farklı: net okunmuş değerden ayrılan kayıt alarmdır; soluk okumanın düzeltilmesi değildir", () => {
  const z = normalizeZ(Z, { day: "2026-10-21", prevZNo: null });
  const pos = normalizePos(POS, { day: "2026-10-21" });
  const diffs = photoDiffs([z, pos], SAVED);
  assert.deepEqual(diffs.map((d) => [d.field, d.photo, d.saved]), [["card", 8915, 8951]]);
  assert.equal(plain(photoDiffText(diffs[0])), "Kart (fotoğrafta 8.915 ₺, raporda 8.951 ₺)");
  assert.equal(plain(photoDiffText(diffs[0], false)), "Kart (fotoğrafta 8.915 ₺)");
  assert.equal(suspiciousDiffs([z, pos], SAVED).length, 1);
  // Orta güvenle okunan alan düzeltildiyse alarm yok
  const faint = clone(z);
  faint.values.card = { value: 8915, confidence: "medium" };
  assert.equal(photoDiffs([faint], SAVED).length, 1);
  assert.equal(suspiciousDiffs([faint], SAVED).length, 0);
  // İlgisiz bir uyarı (Z no sırası) net okunmuş kartın alarmını gizlemez; yalnız Z no farkını bağışlar
  const warned = normalizeZ(Z, { day: "2026-10-21", prevZNo: "0190" });
  assert.deepEqual(suspiciousDiffs([warned], SAVED).map((d) => d.field), ["card"]);
  assert.deepEqual(photoDiffs([warned], { ...SAVED, zNo: "0191" }).map((d) => [d.field, d.excused]), [["card", false], ["zNo", true]]);
  assert.deepEqual(suspiciousDiffs([warned], { ...SAVED, zNo: "0191" }).map((d) => d.field), ["card"]);
  // 1 ₺'nin altındaki fark ve baştaki sıfırlar fark sayılmaz; boş bırakılan alan "boş"
  assert.deepEqual(photoDiffs([z], { ...SAVED, card: 8915.4, zNo: "187" }), []);
  const empty = photoDiffs([pos], { ...SAVED, bankPos: null });
  assert.equal(plain(photoDiffText(empty[0])), "Banka POS (fotoğrafta 8.915 ₺, raporda boş)");
  // Yazarkasa bölümü yazılmış raporda aynı alan bugünkü adıyla
  const okcSaved = photoDiffs([pos], { ...SAVED, bankPos: null, okcTotal: 12975.5 });
  assert.equal(plain(photoDiffText(okcSaved[0])), "Banka gün sonu (fotoğrafta 8.915 ₺, raporda boş)");
  // İki cihazın POS fişi toplandıysa fark yok
  const second = clone(pos);
  second.values.bankPos = { value: 1200, confidence: "high" };
  assert.deepEqual(photoDiffs([pos, second], { ...SAVED, bankPos: 10115 }), []);
  assert.equal(photoDiffs([pos, second], { ...SAVED, bankPos: 1200 }).length, 0);
  // Uzun Z raporu iki fotoğrafla: her alan onu okuyan son okumadan
  const tail = clone(z);
  tail.values = { card: { value: 8951, confidence: "high" } };
  assert.deepEqual(photoDiffs([z, tail], SAVED), []);
  // Okunamayan okuma karşılaştırmaya girmez
  assert.deepEqual(photoDiffs([normalizeZ(WRONG, { day: "2026-10-21", prevZNo: null })], SAVED), []);
});

test("fotoğraftan farklı: alarmı yalnız o alana düşen uyarı ya da başka güne ait / birden çok fişli okuma bağışlar", () => {
  const read = (raw: typeof Z, day = "2026-10-21") => normalizeZ(raw, { day, prevZNo: null });
  // Toplam tutmuyor: Z toplamı ve ödeme alanları turuncu; onların düzeltilmesi alarm değil
  const misread = clone(Z);
  misread.paymentLines[0].amount = { text: "3.402,50", value: 3402.5, confidence: "high" };
  assert.deepEqual(photoDiffs([read(misread)], SAVED).map((d) => [d.field, d.excused]), [["cash", true], ["card", true]]);
  assert.deepEqual(suspiciousDiffs([read(misread)], SAVED), []);
  // Fişin günü raporun günü değil ya da fotoğrafta birden çok fiş: okumanın bütünü şüpheli
  assert.equal(photoDiffs([read(Z, "2026-10-22")], SAVED).length, 1);
  assert.deepEqual(suspiciousDiffs([read(Z, "2026-10-22")], SAVED), []);
  const several = clone(Z);
  several.issues = ["multiple_documents"];
  assert.deepEqual(suspiciousDiffs([read(several)], SAVED), []);
  // Görüntü sorunu yalnız net okunmamış alanlara düşer; net okunmuş kartın farkı yine alarm
  const faded = clone(Z);
  faded.issues = ["faded"];
  assert.deepEqual(suspiciousDiffs([read(faded)], SAVED).map((d) => d.field), ["card"]);
  // Fişe basılmış "talimat" alarmı gizleyemez
  const injected = clone(Z);
  injected.issues = ["contains_instructions"];
  assert.deepEqual(suspiciousDiffs([read(injected)], SAVED).map((d) => d.field), ["card"]);
  // Tanınmayan satır yalnız Diğer'i bağışlar
  const odd = clone(Z);
  odd.total = { text: "*13.025,50", value: 13025.5, confidence: "high" };
  odd.paymentLines.push({ label: "KUPON", amount: { text: "50,00", value: 50, confidence: "high" }, kind: "unknown" });
  assert.deepEqual(photoDiffs([read(odd)], { ...SAVED, zTotal: 13025.5 }).map((d) => [d.field, d.excused]), [["card", false], ["other", true]]);
  // POS: satış − iade tutmuyorsa Banka POS'un düzeltilmesi alarm değil; başka günün fişi de
  const off = clone(POS);
  off.refundTotal = { text: "120,00", value: 120, confidence: "high" };
  assert.deepEqual(suspiciousDiffs([normalizePos(off, { day: "2026-10-21" })], { ...SAVED, bankPos: 8795 }), []);
  assert.deepEqual(suspiciousDiffs([normalizePos(POS, { day: "2026-10-22" })], { ...SAVED, bankPos: 8795 }), []);
  assert.deepEqual(suspiciousDiffs([normalizePos(POS, { day: "2026-10-21" })], { ...SAVED, bankPos: 8795 }).map((d) => d.field), ["bankPos"]);
});

test("fiş: toplam (verilen nakit ya da para üstü değil), KDV, özet, kategori; soluk baskı", () => {
  const r = normalizeReceipt(FIS, ctx());
  assert.equal(r.ok, true);
  assert.equal(r.docType, "fis");
  assert.deepEqual(r.values, {
    amount: 412.5,
    receiptDate: "2026-10-21",
    store: "Migros",
    summary: "süt, beyaz peynir, buz, peçete, deterjan",
    vat: 15.31,
    receiptNo: "0045",
    paymentMethod: "nakit",
    categoryId: 1,
  });
  assert.equal(r.toExpensesDefault, true);
  assert.deepEqual(
    r.checks.map((c) => c.text),
    ["Baskı silik; turuncu alanları fişle karşılaştırın."],
  );
});

test("fiş: yazılı talimat yok sayılır ve söylenir; toplam KDV yoksa satırların toplamı", () => {
  const r = normalizeReceipt(TALIMAT, ctx({ day: "2026-10-22" }));
  assert.equal(r.values.amount, 155);
  assert.equal(r.values.vat, 16.42);
  assert.equal(r.values.categoryId, 1);
  assert.ok(r.checks.some((c) => c.text === "Fişte alışılmadık yazılar var; rakamları fişle tek tek karşılaştırın."));
});

test("fiş: kartla ödenmiş, fatura, tekrar, tarih, kategori listede değil, tutmayan KDV ve kalemler", () => {
  const card = clone(FIS);
  card.paymentMethod = "card";
  assert.ok(normalizeReceipt(card, ctx()).checks.some((c) => c.text === "Fiş kartla ödenmiş görünüyor. Para kasadan çıkmadıysa buraya eklemeyin."));
  const archive = clone(FIS);
  archive.documentType = "e_archive_invoice";
  const a = normalizeReceipt(archive, ctx({ staff: false }));
  assert.equal(a.docType, "e_arsiv");
  assert.equal(a.toExpensesDefault, false);
  assert.ok(a.checks.some((c) => c.level === "info" && c.text === "Bu bir e-Arşiv fatura. Paraşüt'e de gelecekse Aylık harcamalar'a eklemeyin."));
  // Personele bu bilgi pencerede ayrıca söylenir
  assert.ok(!normalizeReceipt(archive, ctx()).checks.some((c) => c.level === "info"));
  const dup = normalizeReceipt(FIS, ctx({ staff: false, recent: [{ date: "2026-10-21", amount: 412.5, store: "Migros", receiptNo: null }] }));
  assert.ok(dup.checks.some((c) => plain(c.text) === "Bu fiş zaten eklenmiş olabilir: Migros · 412,50 ₺ · 21.10.2026."));
  // Personele genel metin: eşleşen satır yöneticinin kaydı olabilir (tutar, yer ve gün gitmez; plan §2.7)
  const staffDup = normalizeReceipt(FIS, ctx({ recent: [{ date: "2026-10-21", amount: 412.5, store: "Migros", receiptNo: null }] }));
  assert.ok(staffDup.checks.some((c) => c.text === "Bu fiş zaten eklenmiş olabilir; yönetici bakacak."));
  assert.ok(!staffDup.checks.some((c) => c.text.includes("Migros")));
  // Harcama kaydının açıklaması da mağaza adıyla başlar
  assert.ok(normalizeReceipt(FIS, ctx({ recent: [{ date: "2026-10-20", amount: 412.5, store: "Migros · süt, buz", receiptNo: null }] })).checks.some((c) => c.text.startsWith("Bu fiş zaten")));
  assert.ok(!normalizeReceipt(FIS, ctx({ recent: [{ date: "2026-10-21", amount: 400, store: "Migros", receiptNo: null }] })).checks.some((c) => c.text.startsWith("Bu fiş zaten")));
  const future = normalizeReceipt(FIS, ctx({ day: "2026-10-19" }));
  assert.ok(future.checks.some((c) => c.text === "Fişin tarihi ileri bir gün (21 Ekim Çarşamba)."));
  const past = normalizeReceipt(FIS, ctx({ day: "2026-10-30" }));
  assert.ok(past.checks.some((c) => c.text === "Fişin tarihi 21 Ekim Çarşamba; 9 gün önce. Doğru fiş mi?"));
  const cat = clone(FIS);
  cat.categoryId = 99;
  const c = normalizeReceipt(cat, ctx());
  assert.equal(c.values.categoryId, 1);
  assert.equal(c.confidence.categoryId, "low");
  assert.ok(c.checks.some((x) => x.fields.includes("categoryId") && x.text === "Kategori seçin."));
  const vat = clone(FIS);
  vat.vatTotal = { text: "*25,31", value: 25.31, confidence: "high" };
  assert.ok(normalizeReceipt(vat, ctx()).checks.some((x) => plain(x.text) === "KDV satırlarının toplamı 15,31 ₺, fişteki toplam KDV 25,31 ₺."));
  const items = clone(FIS);
  items.items.pop();
  assert.ok(normalizeReceipt(items, ctx()).checks.some((x) => plain(x.text) === "Kalemlerin toplamı 486,65 ₺, fiş toplamı 412,50 ₺; toplamı fişle karşılaştırın."));
  const noTotal = clone(FIS);
  noTotal.total = { text: null, value: null, confidence: "low" };
  assert.ok(normalizeReceipt(noTotal, ctx()).checks.some((x) => x.text === "Toplam okunamadı; tutarı elle yazın."));
  const big = clone(FIS);
  big.total = { text: "*25.000,00", value: 25000, confidence: "high" };
  big.items = [];
  assert.ok(normalizeReceipt(big, ctx()).checks.some((x) => plain(x.text) === "Tutar alışılmadık büyük (25.000 ₺); fişle karşılaştırın."));
  const z = clone(FIS);
  z.documentType = "z_report";
  assert.equal(normalizeReceipt(z, ctx()).error, "Bu bir Z raporu, kasadan ödenen bir fiş değil.");
  const pos = clone(FIS);
  pos.documentType = "bank_pos_end_of_day";
  assert.equal(normalizeReceipt(pos, ctx()).error, "Bu bir banka POS fişi, kasadan ödenen bir fiş değil.");
});

test("fiş: saklanan okumada satıcının vergi numarası yok (şahıs şirketinde TC kimlik no olabilir)", () => {
  assert.equal(FIS.storeTaxNo, "6220529513");
  const stored = receiptToStore(FIS);
  assert.equal(stored.storeTaxNo, null);
  assert.deepEqual({ ...stored, storeTaxNo: FIS.storeTaxNo }, FIS);
  assert.ok(ReceiptRaw.safeParse(stored).success, "saklanan hâl şemaya uyar");
});

test("harcama tarihi: fişin tarihi kasa gününden en çok 3 gün önceyse o, değilse kasanın günü", () => {
  assert.equal(expenseDateFor("2026-10-21", "2026-10-21"), "2026-10-21");
  assert.equal(expenseDateFor("2026-10-21", "2026-10-18"), "2026-10-18");
  assert.equal(expenseDateFor("2026-10-21", "2026-10-17"), "2026-10-21");
  assert.equal(expenseDateFor("2026-10-21", "2026-10-22"), "2026-10-21");
  assert.equal(expenseDateFor("2026-10-21", null), "2026-10-21");
});

test("kasadan çıkanlar: ad, akşam raporunun notu, uyarı ve personelin kuralları", () => {
  const migros = { kind: "harcama" as const, amount: 412.5, store: "Migros", description: "süt, beyaz peynir" };
  const buz = { kind: "harcama" as const, amount: 95, store: null, description: "buz" };
  const teslim = { kind: "teslim" as const, amount: 500, store: "patrona", description: null };
  assert.equal(cashOutLabel(migros), "Migros · süt, beyaz peynir");
  assert.equal(cashOutLabel(teslim), "Teslim · patrona");
  assert.equal(cashOutShortLabel(migros), "Migros");
  assert.equal(cashOutNoteOf([migros, buz, teslim]), "Migros, buz, teslim (patrona)");
  assert.equal(cashOutNoteOf([]), null);
  assert.equal(plain(cashOutShortLine(migros)), "Migros (süt, beyaz peynir) 412,50 ₺");
  assert.equal(plain(cashOutShortLine(teslim)), "Teslim (patrona) 500 ₺");
  assert.equal(plain(cashOutCheck(400, [412.5, 95])!), "Kasadan çıkanların toplamı 507,50 ₺; burada 400 ₺ yazılı. Fişler kasadan ödendiyse tutarı düzeltin.");
  assert.equal(cashOutCheck(507, [412.5, 95]), null);
  assert.equal(cashOutCheck(600, [412.5, 95]), null);
  assert.equal(cashOutCheck(0, []), null);
  assert.equal(staffToExpenses("harcama", "fis"), true);
  assert.equal(staffToExpenses("harcama", "yok"), true);
  assert.equal(staffToExpenses("harcama", "fatura"), false);
  assert.equal(staffToExpenses("harcama", "e_arsiv"), false);
  assert.equal(staffToExpenses("teslim", "fis"), false);
  assert.equal(staffCategory({ section: "mal", panelGroup: "diger", active: true }), true);
  assert.equal(staffCategory({ section: "genel", panelGroup: "diger", active: true }), true);
  assert.equal(staffCategory({ section: "personel", panelGroup: "personel", active: true }), false);
  assert.equal(staffCategory({ section: "genel", panelGroup: "reklam", active: true }), false);
  assert.equal(staffCategory({ section: "mal", panelGroup: "diger", active: false }), false);
});

test("kasadan çıkanın harcama kaydı: personelin düzeltmesi açmaz ve silmez, geri alma olduğu gibi getirir", () => {
  const writes = (o: Partial<Parameters<typeof cashOutWritesExpense>[0]>) =>
    cashOutWritesExpense({ admin: false, mode: "new", kind: "harcama", docType: "fis", requested: false, hasExpense: false, ...o });
  // Yeni satır: personel kurala göre, yönetici anahtarla
  assert.equal(writes({}), true);
  assert.equal(writes({ docType: "yok" }), true);
  assert.equal(writes({ docType: "fatura", requested: true }), false);
  assert.equal(writes({ kind: "teslim" }), false);
  assert.equal(writes({ admin: true }), false);
  assert.equal(writes({ admin: true, docType: "fatura", requested: true }), true);
  // Yöneticinin faturaya açtığı kayıt personelin düzeltmesiyle silinmez (tutar değişse de)
  assert.equal(writes({ mode: "edit", docType: "fatura", hasExpense: true }), true);
  // Yöneticinin Aylık harcamalar'dan sildiği kayıt personelin düzeltmesiyle geri gelmez
  assert.equal(writes({ mode: "edit", docType: "fis", requested: true }), false);
  // Teslime çevrilen satırın kaydı kalkar (kayıt yöneticinin kategorisindeyse eylem reddeder: staffExpenseLocked)
  assert.equal(writes({ mode: "edit", kind: "teslim", hasExpense: true }), false);
  // Yönetici düzeltmede anahtarla açar ya da kaldırır
  assert.equal(writes({ admin: true, mode: "edit", hasExpense: true }), false);
  assert.equal(writes({ admin: true, mode: "edit", requested: true }), true);
  // Geri alma silinen satırdaki gibi: faturanın kaydı geri gelir, kaydı olmayan fişe açılmaz
  assert.equal(writes({ mode: "restore", docType: "fatura", requested: true }), true);
  assert.equal(writes({ mode: "restore", docType: "fis", requested: false }), false);
  assert.equal(writes({ admin: true, mode: "restore", requested: true }), true);
  assert.equal(writes({ mode: "restore", kind: "teslim", requested: true }), false);
  // Yöneticinin kategorisindeki (ya da kapatılmış kategorideki) kayıt personele kapalı: silme, teslime çevirme, taşıma
  assert.equal(staffExpenseLocked({ section: "personel", panelGroup: "personel", active: true }), true);
  assert.equal(staffExpenseLocked({ section: "genel", panelGroup: "reklam", active: true }), true);
  assert.equal(staffExpenseLocked({ section: "mal", panelGroup: "diger", active: false }), true);
  assert.equal(staffExpenseLocked({ section: "mal", panelGroup: "diger", active: true }), false);
  assert.equal(staffExpenseLocked({ section: "genel", panelGroup: "diger", active: true }), false);
  assert.equal(staffExpenseLocked(null), false);
  assert.equal(staffExpenseLocked(undefined), false);
});

test("İndirim (kasa grubu): Z okuması boş İndirim'i doldurur, yazılanı değiştirmez; kayıtta yalnız yazılmışsa karşılaştırılır", () => {
  const r = normalizeZ(Z, { day: "2026-10-21", prevZNo: null });
  const empty = { zTotal: "", cash: "", card: "", mealCard: "", online: "", other: "", offRevenue: "", discounts: "", zNo: "", receipts: "", bankPos: "" };
  const plan = prefillPlan(r, empty);
  assert.deepEqual(plan.fill.find((f) => f.field === "discounts"), { field: "discounts", text: "310", warn: null });
  assert.equal(plan.fill.length, 10);
  // Elle yazılmış indirim kalır; fotoğraftaki farklıysa önerilir
  const typed = prefillPlan(r, { ...empty, discounts: "300" });
  assert.ok(!typed.fill.some((f) => f.field === "discounts"));
  assert.deepEqual(typed.differs, [{ field: "discounts", photo: 310, text: "310" }]);
  // Kayıtlı rapor: boş indirim karşılaştırılmaz (eski raporlarda alan yoktu), yazılan farklıysa "fotoğraftan farklı"
  assert.equal("discounts" in SAVED, false);
  assert.deepEqual(photoDiffs([r], SAVED).map((d) => d.field), ["card"]);
  const withDisc = savedFields({ zTotal: 12975.5, cash: 3420.5, card: 8951, mealCard: 640, online: 0, other: 0, offRevenue: 245, discounts: 300, zNo: "0187", receipts: 143, bankPos: 8915 });
  assert.deepEqual(photoDiffs([r], withDisc).map((d) => [d.field, d.label]), [["card", "Kart"], ["discounts", "İndirim"]]);
  assert.deepEqual(photoDiffs([r], { ...withDisc, discounts: 310 }).map((d) => d.field), ["card"]);
});
