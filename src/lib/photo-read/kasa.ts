/**
 * Kasa raporu fotoğrafının okunması: ModPOS Z raporu ve banka POS gün sonu fişi (saf; tests/fotograf-okuma.test.ts).
 * Model rakamları yazıldığı gibi aktarır; toplamlar, denetimler ve forma eşleme burada. Belge beklenen tür değilse
 * hiçbir alan dolmaz (Z bölümüne POS fişi okutulunca kart alt toplamları "kart" ödemesi gibi gelirdi). Yazarkasanın
 * (banka POS) mali Z'si iki bölümde de alan doldurmaz: ModPOS bölümünde mali rakamlar ModPOS alanlarına ve Z no'su
 * ModPOS'un Z no sırasına karışırdı; Banka POS bölümünde toplamı Banka POS'a yazılırdı (kartın satırı değil). Kendi
 * bölümü dalga 13 PR-b'de gelir (docs/planlar/okc-z.md); o zamana kadar Banka POS bölümü K.KARTI satırını elle
 * yazdırır. Okuma formu yalnız boş alanlarda doldurur (İndirim dahil); personelin yazdığı değer üzerine yazılmaz.
 * Kayıttan sonra kaydedilen değerlerle okunan değerler karşılaştırılır ("Fotoğraftan farklı"). Ayrıntı: docs/FOTOGRAF.md.
 */

import { parseNumberTR } from "@/lib/calc/expr";
import { money } from "@/lib/format";
import { OKC_FIELD_LABELS, OKC_PREFILL_ENABLED, OKC_SUGGEST_TEXT, type OkcField, type OkcVatLine } from "@/lib/okc-z";
import { longDateTR } from "@/lib/reminders";

import { businessDayOf, clean, DOC_NAMES, IMAGE_ISSUES, ISSUE_TEXT, lowest, printedAmount, round2, UNREADABLE_TEXT, type Confidence } from "./common";
import type { AmountRaw, IssueRaw, KasaPos, KasaZ } from "./schemas";

export type { Confidence } from "./common";

/**
 * ModPOS alanları, banka gün sonu (`bankPos`) ve yazarkasanın (banka POS) mali Z alanları (`okc*`, dalga 13 PR-b,
 * src/lib/okc-z.ts). Yazarkasa anahtarları ModPOS'unkilerden ayrıdır: iki sayaç birbiriyle karşılaştırılmaz.
 */
export type ReadField = "zTotal" | "cash" | "card" | "mealCard" | "online" | "other" | "discounts" | "offRevenue" | "zNo" | "receipts" | "bankPos" | OkcField;
/**
 * Kasa fotoğrafının türü: `kasa-okc` yazarkasanın mali Z'si (src/lib/photo-read/okc.ts); `kasa-pos` yalnız eski
 * fotoğraflar, eski okumalar ve geçişteki eski sayfalar için kalır (plan D2, §6.3, §6.6)
 */
export type CashPhotoKind = "kasa-z" | "kasa-pos" | "kasa-okc";
/** Okumanın türü (fotoğrafın türüyle aynı) */
export type CashReadKind = CashPhotoKind;

/** Tutar alanları (ötekiler Z no'lar ve fiş sayıları) */
export const MONEY_FIELDS: readonly ReadField[] = [
  "zTotal",
  "cash",
  "card",
  "mealCard",
  "online",
  "other",
  "discounts",
  "offRevenue",
  "bankPos",
  "okcTotal",
  "okcVatTotal",
  "okcCash",
  "okcCard",
  "okcMealCard",
  "okcOther",
  "okcT1",
  "okcV1",
  "okcT10",
  "okcV10",
  "okcT20",
  "okcV20",
];

/** Z no gibi metin olarak karşılaştırılan ve fiş sayısı gibi tam sayı olan alanlar */
const ZNO_FIELDS: readonly ReadField[] = ["zNo", "okcZNo"];
const COUNT_FIELDS: readonly ReadField[] = ["receipts", "okcReceipts"];

/** Alanların adı (uyarı ve "fotoğraftan farklı" metinlerinde; kasa formundaki etiketlerle aynı sözcükler) */
export const FIELD_LABELS: Record<ReadField, string> = {
  zTotal: "Toplam satış",
  cash: "Nakit",
  card: "Kart",
  mealCard: "Yemek kartı",
  online: "Online",
  other: "Diğer",
  discounts: "İndirim",
  offRevenue: "Ödenmez / ikram",
  zNo: "Z no",
  receipts: "Fiş sayısı",
  bankPos: "Banka POS",
  ...OKC_FIELD_LABELS,
};

export interface ReadValue {
  value: number | string;
  confidence: Confidence;
  /**
   * Yazarkasa okumasında kimliklerin sonucu (src/lib/okc-z.ts): "confirmed" iki ayrı basılı rakam birbirini tutuyor
   * (orta güvende de mavi dolar), "failed" bir kimlik tutmadı (forma yazılmaz, öneri olur). Yoksa denetlenemedi
   */
  status?: "confirmed" | "failed";
  /** "failed" alanın tek, sade nedeni (personel metni) */
  reason?: string;
}

export interface ReadCheck {
  /** Turuncu olacak alanlar (boşsa yalnız kutuda görünür) */
  fields: ReadField[];
  level: "warn" | "info";
  text: string;
  /** Okumanın bütününe dair (fiş başka bir günün, fotoğrafta birden çok fiş): kayıttaki farklar alarm sayılmaz */
  whole?: boolean;
  /** Yalnız yöneticiye (yazarkasa okumasının ayrıntılı metinleri; personelin yanıtından çıkar, plan D17) */
  admin?: true;
}

/** Yazarkasa okumasının yalnız yöneticiye ve sunucuya giden kısmı (personelin yanıtından çıkar, plan D17) */
export interface OkcAdminInfo {
  documentZNo: string | null;
  cumTotal: number | null;
  cumVat: number | null;
  /** Yazarkasa toplamı dışındaki tahsilatlar (faturalı satış, bilgi fişi…) */
  outside: number | null;
  voids: number | null;
}

export interface CashReading {
  kind: CashReadKind;
  ok: boolean;
  /** Okunamadı ya da yanlış belge: kırmızı satır, hiçbir alan dolmaz */
  error: string | null;
  /**
   * `error` bir hata değil yönerge: belge tanındı ama bu bölümün alanını doldurmaz, personel rakamı fişten yazar (Banka
   * POS bölümünde yazarkasanın Z'si: hangi satır). Turuncu; "Yeniden dene" ve öteki bölüm düğmesi yok
   */
  advice?: boolean;
  /** Yanlış bölüme okutulan fiş: aynı fotoğraf öteki bölüme okutulabilir */
  switchTo: CashPhotoKind | null;
  /** Fişteki iş günü (05:00'ten önce basılan bir önceki gün) */
  printedDay: string | null;
  values: Partial<Record<ReadField, ReadValue>>;
  /** Fişte olması gerekirken okunamayanlar: personel fişten yazar */
  missing: ReadField[];
  checks: ReadCheck[];
  /** Yazarkasa okumasında okunan KDV dökümü (sıfır gruplar yok, orana göre sıralı) */
  okcVat?: OkcVatLine[];
  /** Yazarkasa okumasında yalnız yöneticiye ve sunucuya (kümülatif, toplam dışı tahsilat) */
  okcAdmin?: OkcAdminInfo;
}

/**
 * ModPOS günlük dökümü geldiğinde Z toplamları ondan da dolabilsin diye form bu biçimi uygular (fotoğraf o zaman
 * yalnız kanıt olur). Bugün tek kaynak fotoğraf.
 */
export interface CashPrefill {
  source: "photo" | "modpos";
  values: CashReading["values"];
  checks: ReadCheck[];
}

const PAYMENT_FIELD = { cash: "cash", card: "card", meal_card: "mealCard", online: "online", other: "other" } as const;
const PAYMENT_FIELDS: readonly ReadField[] = ["cash", "card", "mealCard", "online", "other"];

export const failed = (kind: CashReadKind, error: string, switchTo: CashPhotoKind | null = null): CashReading => ({
  kind,
  ok: false,
  error,
  switchTo,
  printedDay: null,
  values: {},
  missing: [],
  checks: [],
});

/** "Bu bir alışveriş fişi gibi görünüyor." (tanınmayan belge: "Bu başka bir belge gibi görünüyor.") */
export function looksLike(documentType: string): string {
  const name = documentType === "other" ? undefined : DOC_NAMES[documentType];
  return name ? `Bu bir ${name} gibi görünüyor.` : `Bu ${DOC_NAMES.other} gibi görünüyor.`;
}

/** Banka POS bölümüne okutulan yazarkasa Z'sinin yönergesi: Banka POS'a Z'nin kart satırı yazılır */
export const FISCAL_Z_CARD_TEXT = "Bu yazarkasanın Z raporu. Banka POS'a Z'deki K.KARTI (kredi kartı) satırını yazın; toplamı ya da altındaki banka satırlarını değil.";

/**
 * Yanlış belgenin metni: ModPOS bölümüne yazarkasanın Z'si ya da POS fişi Banka POS bölümüne, Banka POS bölümüne
 * ModPOS'un Z'si ModPOS bölümüne okutulabilir. Banka POS bölümüne okutulan yazarkasa Z'si yalnız yönergedir (alan yok)
 */
function wrongDocument(expected: CashPhotoKind, documentType: string): CashReading {
  if (expected === "kasa-z") {
    if (documentType === "fiscal_z_report") return failed("kasa-z", "Bu yazarkasanın (banka POS) Z raporu gibi görünüyor, ModPOS'unki değil.", "kasa-pos");
    return documentType === "bank_pos_end_of_day"
      ? failed("kasa-z", "Bu bir banka POS gün sonu fişi gibi görünüyor, Z raporu değil.", "kasa-pos")
      : failed("kasa-z", `${looksLike(documentType)} ModPOS Z raporunun fotoğrafını çekin.`);
  }
  if (documentType === "fiscal_z_report") return { ...failed("kasa-pos", FISCAL_Z_CARD_TEXT), advice: true };
  return documentType === "z_report"
    ? failed("kasa-pos", "Bu ModPOS'un Z raporu gibi görünüyor, banka POS'unki değil.", "kasa-z")
    : failed("kasa-pos", `${looksLike(documentType)} Banka POS gün sonu fişinin fotoğrafını çekin.`);
}

/** Tutar okunurken fişteki metinle modelin sayısı tutmadıysa uyarı */
export function mismatchCheck(field: ReadField, a: AmountRaw): ReadCheck {
  return { fields: [field], level: "warn", text: `Okuma tutarsız (fişte “${clean(a.text, 30) ?? ""}”); fişle karşılaştırın.` };
}

/**
 * Fotoğrafın sorunları: görüntü sorunları güveni "high" olmayan alanları turuncu yapar. Birden çok fiş okumanın
 * bütününü şüpheli yapar (rakam öteki fişten okunmuş olabilir)
 */
export function issueChecks(issues: IssueRaw[], values: Partial<Record<ReadField, ReadValue>>, skip: IssueRaw[] = []): ReadCheck[] {
  const unsure = (Object.keys(values) as ReadField[]).filter((f) => values[f]!.confidence !== "high");
  const out: ReadCheck[] = [];
  for (const issue of [...new Set(issues)]) {
    if (issue === "not_a_document" || skip.includes(issue)) continue;
    const check: ReadCheck = { fields: IMAGE_ISSUES.includes(issue) ? unsure : [], level: "warn", text: ISSUE_TEXT[issue] };
    if (issue === "multiple_documents") check.whole = true;
    out.push(check);
  }
  return out;
}

/** Fişteki gün raporun günü değilse uyarı (okumanın bütünü başka bir günün olabilir). `question`: "Z raporu mu" */
export function dayCheck(printedDay: string | null, day: string, question: string): ReadCheck | null {
  if (!printedDay || printedDay === day) return null;
  return { fields: [], level: "warn", text: `Fişteki tarih ${longDateTR(printedDay)}; bu rapor ${longDateTR(day)} için. Doğru günün ${question}?`, whole: true };
}

/** Sıra: önce uyarılar, sonra bilgiler (ekranda en çok dördü) */
export const ordered = (checks: (ReadCheck | null)[]) => {
  const list = checks.filter((c): c is ReadCheck => c !== null);
  return [...list.filter((c) => c.level === "warn"), ...list.filter((c) => c.level === "info")];
};

/** Z raporu okuması → forma gidecek değerler ve denetimler */
export function normalizeZ(raw: KasaZ, ctx: { day: string; prevZNo: string | null }): CashReading {
  if (raw.documentType !== "z_report") return wrongDocument("kasa-z", raw.documentType);
  if (!raw.readable || raw.issues.includes("not_a_document")) return failed("kasa-z", UNREADABLE_TEXT);
  const values: Partial<Record<ReadField, ReadValue>> = {};
  const checks: (ReadCheck | null)[] = [];
  const imageTrouble = raw.issues.some((i) => IMAGE_ISSUES.includes(i));

  const total = printedAmount(raw.total);
  if (total.value !== null) values.zTotal = { value: total.value, confidence: total.confidence };
  if (total.mismatch) checks.push(mismatchCheck("zTotal", raw.total));

  // Ödeme satırları türlerine göre toplanır; alanın güveni satırlarının en düşüğü. Hiçbir satırı okunamayan alan
  // doldurulmaz, "okunamadı" olur
  const sums = new Map<ReadField, { value: number; confidence: Confidence; read: boolean }>();
  const add = (field: ReadField, value: number | null, confidence: Confidence) => {
    const prev = sums.get(field);
    sums.set(field, {
      value: round2((prev?.value ?? 0) + (value ?? 0)),
      confidence: lowest(prev?.confidence ?? "high", value === null ? "low" : confidence),
      read: Boolean(prev?.read) || value !== null,
    });
  };
  const comps: { label: string; value: number | null; confidence: Confidence }[] = [];
  for (const line of raw.paymentLines) {
    const a = printedAmount(line.amount);
    const label = clean(line.label, 40) ?? "?";
    if (line.kind === "comp") {
      comps.push({ label, value: a.value, confidence: a.confidence });
      checks.push({ fields: [], level: "info", text: `“${label}” ödenmez / ikram olarak alındı.` });
      continue;
    }
    const field: ReadField = line.kind === "unknown" ? "other" : PAYMENT_FIELD[line.kind];
    add(field, a.value, a.confidence);
    if (a.mismatch) checks.push(mismatchCheck(field, line.amount));
    if (line.kind === "unknown") {
      checks.push({ fields: ["other"], level: "warn", text: `Tanınmayan ödeme satırı “${label}” (${a.value === null ? "okunamadı" : money(a.value)}) Diğer'e eklendi; doğru mu?` });
    }
  }
  // Ödeme bölümü okunduysa satırı olmayan nakit ve kart 0'dır (ModPOS 0,00 satırlarını da basar; eksikse turuncu)
  if (raw.paymentLines.length) {
    for (const f of ["cash", "card"] as const) if (!sums.has(f)) sums.set(f, { value: 0, confidence: "medium", read: true });
  }
  const unreadLines: ReadField[] = [];
  for (const [field, s] of sums) {
    if (s.read) values[field] = { value: s.value, confidence: s.confidence };
    else unreadLines.push(field);
  }

  if (raw.discounts.text !== null) {
    const d = printedAmount(raw.discounts);
    if (d.value !== null) values.discounts = { value: d.value, confidence: d.confidence };
    if (d.mismatch) checks.push(mismatchCheck("discounts", raw.discounts));
    if (d.value !== null && total.value !== null && d.value >= total.value && d.value > 0) {
      checks.push({ fields: ["discounts"], level: "warn", text: "İndirim Z toplamından büyük görünüyor; kontrol edin." });
    }
  }
  // Ödenmez / ikram: basılmış toplamı, yoksa ödeme bölümündeki ikram satırları
  if (raw.comps.text !== null) {
    const c = printedAmount(raw.comps);
    if (c.value !== null) values.offRevenue = { value: c.value, confidence: c.confidence };
    if (c.mismatch) checks.push(mismatchCheck("offRevenue", raw.comps));
  } else if (comps.length) {
    values.offRevenue = {
      value: round2(comps.reduce((a, c) => a + (c.value ?? 0), 0)),
      confidence: comps.reduce<Confidence>((a, c) => lowest(a, c.value === null ? "low" : c.confidence), "high"),
    };
  }
  if (raw.refunds.text !== null) {
    const r = printedAmount(raw.refunds);
    if (r.value !== null && r.value > 0) checks.push({ fields: [], level: "info", text: `Z raporunda ${money(r.value)} iade var; nedenini nota yazın.` });
  }

  // Z no ve fiş sayısının güveni yok: görüntü sorunu varsa turuncu
  const plainConfidence: Confidence = imageTrouble ? "medium" : "high";
  const zNo = clean(raw.zNo, 30);
  if (zNo) values.zNo = { value: zNo, confidence: plainConfidence };
  if (raw.receiptCount !== null && raw.receiptCount >= 0 && raw.receiptCount <= 100_000) values.receipts = { value: raw.receiptCount, confidence: plainConfidence };

  // Ödeme türlerinin toplamı Z toplamını tutmalı (form canlı kutusu da söyler; burada okunan alanlar turuncu olur)
  const paid = PAYMENT_FIELDS.filter((f) => values[f]);
  if (values.zTotal && paid.length) {
    const sum = round2(paid.reduce((a, f) => a + Number(values[f]!.value), 0));
    const diff = round2(sum - Number(values.zTotal.value));
    if (Math.abs(diff) >= 1) {
      checks.push({
        fields: ["zTotal", ...paid],
        level: "warn",
        text: `Ödeme türlerinin toplamı ${money(sum)}: Z toplamından ${money(Math.abs(diff))} ${diff > 0 ? "fazla" : "az"}. Bir tutar yanlış okunmuş olabilir.`,
      });
    }
  }

  const printedDay = businessDayOf(raw.date, raw.time);
  checks.push(dayCheck(printedDay, ctx.day, "Z raporu mu"));
  // Z no sırayla artar: arada atlanan ya da eski bir Z raporu
  const cur = zNo && /^\d+$/.test(zNo) ? Number(zNo) : null;
  const prev = ctx.prevZNo && /^\d+$/.test(ctx.prevZNo.trim()) ? Number(ctx.prevZNo.trim()) : null;
  if (cur !== null && prev !== null) {
    if (cur > prev + 1) checks.push({ fields: [], level: "info", text: `Önceki raporun Z no'su ${ctx.prevZNo!.trim()}; bu ${zNo}. Arada ${cur - prev - 1} Z raporu girilmemiş olabilir.` });
    else if (cur <= prev) checks.push({ fields: ["zNo"], level: "warn", text: `Z no (${zNo}) önceki raporunkinden (${ctx.prevZNo!.trim()}) büyük değil; eski bir Z raporu olabilir.` });
  }
  checks.push(...issueChecks(raw.issues, values));

  const missing: ReadField[] = [];
  if (!values.zTotal) missing.push("zTotal");
  if (!raw.paymentLines.length) missing.push("cash", "card");
  missing.push(...unreadLines.filter((f) => !missing.includes(f)));
  return { kind: "kasa-z", ok: true, error: null, switchTo: null, printedDay, values, missing, checks: ordered(checks) };
}

/** Banka POS gün sonu fişi okuması → Banka POS alanı (yazarkasanın Z'si alan doldurmaz, yönerge olur) */
export function normalizePos(raw: KasaPos, ctx: { day: string }): CashReading {
  if (raw.documentType !== "bank_pos_end_of_day") return wrongDocument("kasa-pos", raw.documentType);
  if (!raw.readable || raw.issues.includes("not_a_document")) return failed("kasa-pos", UNREADABLE_TEXT);
  const values: Partial<Record<ReadField, ReadValue>> = {};
  const checks: (ReadCheck | null)[] = [];
  const net = printedAmount(raw.netTotal);
  const sales = printedAmount(raw.salesTotal);
  const refunds = raw.refundTotal.text === null ? null : printedAmount(raw.refundTotal);
  if (net.mismatch) checks.push(mismatchCheck("bankPos", raw.netTotal));
  if (sales.mismatch) checks.push(mismatchCheck("bankPos", raw.salesTotal));
  if (refunds?.mismatch) checks.push(mismatchCheck("bankPos", raw.refundTotal));
  // Satış − iade bizim hesabımız; net yazılmamışsa o kullanılır
  const computed = sales.value === null ? null : round2(sales.value - (refunds?.value ?? 0));
  if (net.value !== null) {
    values.bankPos = { value: net.value, confidence: net.confidence };
    if (computed !== null && Math.abs(net.value - computed) >= 1) {
      checks.push({ fields: ["bankPos"], level: "warn", text: `Net toplam ${money(net.value)}, satış − iade ${money(computed)}; fişle karşılaştırın.` });
    }
  } else if (computed !== null) {
    values.bankPos = { value: computed, confidence: lowest(sales.confidence, refunds?.confidence ?? "high") };
  }
  if (raw.issues.includes("multiple_documents")) {
    checks.push({ fields: ["bankPos"], level: "warn", text: "Fişte birden fazla cihaz ya da gün var; yalnız bu günün toplamını yazın." });
  }
  const printedDay = businessDayOf(raw.date, raw.time);
  checks.push(dayCheck(printedDay, ctx.day, "POS fişi mi"));
  checks.push(...issueChecks(raw.issues, values, ["multiple_documents"]));
  return { kind: "kasa-pos", ok: true, error: null, switchTo: null, printedDay, values, missing: values.bankPos ? [] : ["bankPos"], checks: ordered(checks) };
}

/** Formdaki metin: tutar "12975,5" (form böyle gösterir), Z no olduğu gibi, fiş sayısı tam sayı */
export function fieldText(field: ReadField, value: number | string): string {
  if (ZNO_FIELDS.includes(field)) return String(value);
  if (COUNT_FIELDS.includes(field)) return String(Math.round(Number(value)));
  return String(round2(Number(value))).replace(".", ",");
}

/** Formdaki değer okunanla aynı mı (tutarlar 0,005 hassasiyetle; Z no baştaki sıfırlar sayılmadan) */
export function sameValue(field: ReadField, typed: string, value: number | string): boolean {
  if (ZNO_FIELDS.includes(field)) return normalizeZNo(typed) === normalizeZNo(String(value));
  const n = parseNumberTR(typed);
  return n !== null && Math.abs(n - Number(value)) < 0.005;
}

const normalizeZNo = (s: string) => s.trim().replace(/^0+(?=\d)/, "");

/** Alanın turuncu nedeni: önce uyarı metni, yoksa güveni orta */
export function fieldWarnings(reading: CashReading): Partial<Record<ReadField, string>> {
  const out: Partial<Record<ReadField, string>> = {};
  for (const c of reading.checks) if (c.level === "warn") for (const f of c.fields) out[f] ??= c.text;
  return out;
}

export const UNSURE_TEXT = "Fotoğrafta net değil; fişle karşılaştırın.";
export const MISSING_TEXT = "Fotoğrafta okunamadı; fişten yazın.";

export interface PrefillPlan {
  /** Boş alanlara yazılacaklar; `warn` turuncu nedeni (yoksa yalnız "Fotoğraftan") */
  fill: { field: ReadField; text: string; warn: string | null }[];
  /** Yazılanla farklı olanlar: değer kalır, "Fotoğrafta …" ve "Fotoğraftakini yaz" görünür */
  differs: { field: ReadField; photo: number | string; text: string }[];
  /**
   * Güveni düşük (tahmin) ya da bir kimliği tutmayan (yazarkasa, `reason` ile): doldurulmaz, turuncu "fişten yazın" ve
   * "Fotoğraftakini yaz" görünür
   */
  unsure: { field: ReadField; photo: number | string; text: string; reason?: string }[];
  /** Fişte olması gerekirken okunamayanlar (boşsa turuncu) */
  missing: ReadField[];
}

/**
 * Okumanın forma uygulanışı: yalnız boş alanlar dolar; yazılmış ve farklı olan değer kalır. Güveni düşük okuma
 * (fotoğrafta tahmin) alana yazılmaz: personel fişe bakıp yazar ya da "Fotoğraftakini yaz"a basar. `current` formdaki
 * alanlar: formda olmayan alan atlanır.
 */
export function prefillPlan(reading: CashReading, current: Partial<Record<ReadField, string>>, o: { okcPrefill?: boolean } = {}): PrefillPlan {
  const plan: PrefillPlan = { fill: [], differs: [], unsure: [], missing: [] };
  if (!reading.ok) return plan;
  // Yazarkasa Z'si canlı değerlendirmeden geçene kadar yalnız öneri (src/lib/okc-z.ts OKC_PREFILL_ENABLED)
  const suggestOnly = reading.kind === "kasa-okc" && !(o.okcPrefill ?? OKC_PREFILL_ENABLED);
  const warns = fieldWarnings(reading);
  for (const [field, v] of Object.entries(reading.values) as [ReadField, ReadValue][]) {
    if (!(field in current)) continue;
    const typed = (current[field] ?? "").trim();
    const text = fieldText(field, v.value);
    if (typed) {
      if (!sameValue(field, typed, v.value)) plan.differs.push({ field, photo: v.value, text });
      continue;
    }
    // Yazarkasa (D7): tutmayan alan yazılmaz; doğrulanan alan orta güvende de mavi dolar; güveni düşük hiç dolmaz
    if (v.status === "failed") plan.unsure.push({ field, photo: v.value, text, reason: v.reason ?? warns[field] ?? UNSURE_TEXT });
    else if (suggestOnly) plan.unsure.push({ field, photo: v.value, text, reason: warns[field] ?? (v.confidence === "high" ? OKC_SUGGEST_TEXT : UNSURE_TEXT) });
    else if (v.confidence === "low") plan.unsure.push({ field, photo: v.value, text });
    else if (v.status === "confirmed") plan.fill.push({ field, text, warn: null });
    else plan.fill.push({ field, text, warn: warns[field] ?? (v.confidence === "medium" ? UNSURE_TEXT : null) });
  }
  plan.missing = reading.missing.filter((f) => f in current && !(current[f] ?? "").trim());
  return plan;
}

/**
 * İkinci banka POS fişi (iki cihaz) "Toplama ekle" / "Yerine yaz" ile sorulur; seçmek kişinin onayıdır. Rakam net
 * değilse (`unsure`: soruda da söylenir) ya da bir denetime takıldıysa (`warn`) seçilen değer yine de turuncu kalır,
 * tahmin edilen rakam temiz bir "Fotoğraftan" gibi görünmez.
 */
export function posPromptMarks(reading: CashReading): { warn: string | null; unsure: string | null } {
  const v = reading.values.bankPos;
  if (!v) return { warn: null, unsure: null };
  const unsure = v.confidence === "low" ? `Fotoğrafta net okunamadı (${money(Number(v.value))}); fişle karşılaştırın.` : v.confidence === "medium" ? UNSURE_TEXT : null;
  return { warn: v.confidence === "low" ? unsure : (fieldWarnings(reading).bankPos ?? unsure), unsure };
}

/** Okumadan sonraki yeşil satır */
export function prefillSummary(kind: CashReadKind, plan: PrefillPlan): string {
  const doc = kind === "kasa-z" ? "Z raporu" : kind === "kasa-okc" ? "Banka POS Z raporu" : "Banka POS fişi";
  const orange = plan.fill.some((f) => f.warn) || plan.unsure.length > 0 || plan.missing.length > 0 || plan.differs.length > 0;
  if (kind === "kasa-okc" && plan.fill.length && plan.fill.every((f) => f.field === "bankPos")) return "Banka gün sonu fişinden dolduruldu: Banka gün sonu.";
  if (plan.fill.length) {
    const from = kind === "kasa-z" ? "Z raporundan" : kind === "kasa-okc" ? "Banka POS Z raporundan" : "Banka POS fişinden";
    return `${from} dolduruldu: ${plan.fill.length} alan. ${orange ? "Turuncu olanları fişle karşılaştırıp gönderin." : "Kontrol edip gönderin."}`;
  }
  if (plan.differs.length) return `${doc} okundu; ${plan.differs.length} alan yazdığınızdan farklı.`;
  if (orange) return `${doc} okundu; turuncu alanları fişten yazın.`;
  return `${doc} okundu; yazdıklarınız fotoğrafla aynı.`;
}

export interface PhotoDiff {
  field: ReadField;
  label: string;
  photo: number | string;
  /** Raporda yazılan; boş bırakılan alan null */
  saved: number | string | null;
  confidence: Confidence;
  /**
   * Değerin geldiği okumada bu alanı turuncu yapan bir uyarı vardı (tutmayan toplam, tanınmayan satır, tutarsız
   * okuma) ya da okumanın bütünü şüpheliydi (başka bir günün fişi, fotoğrafta birden çok fiş)
   */
  excused: boolean;
}

export type SavedFields = Partial<Record<ReadField, number | string | null>>;

/**
 * Kaydedilmiş raporun karşılaştırılan alanları. İndirim yalnız yazıldıysa karşılaştırılır: alan isteğe bağlı ve eski
 * raporlarda hiç yoktu; boş bırakılan indirim "fotoğraftan farklı" sayılmaz (kasaya giren bir para değil).
 */
export function savedFields(f: {
  zTotal: number;
  cash: number;
  card: number;
  mealCard: number;
  online: number;
  other: number;
  offRevenue: number | null;
  discounts?: number | null;
  zNo: string | null;
  receipts: number | null;
  bankPos: number | null;
  okcZNo?: string | null;
  okcReceipts?: number | null;
  okcTotal?: number | null;
  okcVatTotal?: number | null;
  okcCash?: number | null;
  okcCard?: number | null;
  okcMealCard?: number | null;
  okcOther?: number | null;
  okcVat?: OkcVatLine[] | null;
}): SavedFields {
  const out: SavedFields = { zTotal: f.zTotal, cash: f.cash, card: f.card, mealCard: f.mealCard, online: f.online, other: f.other, offRevenue: f.offRevenue, zNo: f.zNo, receipts: f.receipts, bankPos: f.bankPos };
  if (f.discounts != null) out.discounts = f.discounts;
  // Yazarkasa alanları yalnız bölüm yazıldıysa karşılaştırılır (eski raporlarda hiç yok; bölüm isteğe bağlı, D15)
  if (f.okcTotal != null) {
    Object.assign(out, {
      okcZNo: f.okcZNo ?? null,
      okcReceipts: f.okcReceipts ?? null,
      okcTotal: f.okcTotal,
      okcVatTotal: f.okcVatTotal ?? null,
      okcCash: f.okcCash ?? null,
      okcCard: f.okcCard ?? null,
      okcMealCard: f.okcMealCard ?? null,
      okcOther: f.okcOther ?? null,
    });
    // KDV dökümü: oranın satırı yoksa o oran boş (yazılmamış) sayılır
    for (const rate of [1, 10, 20] as const) {
      const line = (f.okcVat ?? []).find((l) => l.rate === rate);
      out[`okcT${rate}`] = line?.total ?? null;
      out[`okcV${rate}`] = line?.vat ?? null;
    }
  }
  return out;
}

/**
 * Kaydedilen rapor ile okunanlar: her alan için o alanı okuyan son okuma (uzun Z raporu iki fotoğrafla çekilebilir).
 * Tutarlar 1 ₺, Z no metin (baştaki sıfırlar sayılmadan), fiş sayısı tam sayı farkıyla. Banka POS iki cihazın fişi
 * okunduysa okumaların toplamına da eşit sayılır ("Toplama ekle"). Okumalar eskiden yeniye sırayla verilir.
 */
export function photoDiffs(readings: CashReading[], saved: SavedFields): PhotoDiff[] {
  const ok = readings.filter((r) => r.ok);
  const out: PhotoDiff[] = [];
  for (const field of Object.keys(FIELD_LABELS) as ReadField[]) {
    if (!(field in saved)) continue;
    const source = [...ok].reverse().find((r) => r.values[field] !== undefined);
    if (!source) continue;
    const read = source.values[field]!;
    const s = saved[field] ?? null;
    let differs: boolean;
    if (ZNO_FIELDS.includes(field)) differs = s === null || normalizeZNo(String(s)) !== normalizeZNo(String(read.value));
    else if (COUNT_FIELDS.includes(field)) differs = s === null || Math.round(Number(s)) !== Math.round(Number(read.value));
    else {
      const same = (v: number) => s !== null && Math.abs(Number(s) - v) < 1;
      differs = !same(Number(read.value));
      if (differs && field === "bankPos") {
        const all = ok.filter((r) => r.kind === "kasa-pos" && r.values.bankPos).map((r) => Number(r.values.bankPos!.value));
        if (all.length > 1 && same(round2(all.reduce((a, v) => a + v, 0)))) differs = false;
      }
    }
    if (differs) {
      // Tutmayan alan (yazarkasa kimliği) da özürlüdür: forma yazılmamıştı, personel fişten yazdı
      const excused = read.status === "failed" || source.checks.some((c) => c.level === "warn" && (c.whole === true || c.fields.includes(field)));
      out.push({ field, label: FIELD_LABELS[field], photo: read.value, saved: s, confidence: read.confidence, excused });
    }
  }
  return out;
}

/**
 * Alarm sayılan farklar: net (high) okunmuş ve kendisine bir uyarı düşmemiş alan. Turuncu bir alanın (soluk baskı,
 * tutmayan toplam, tanınmayan satır) ya da başka güne ait / birden çok fişli okumanın düzeltilmesi alarm değil. İlgisiz
 * bir uyarı (ör. Z no sırası, fişte alışılmadık yazılar) net okunmuş öteki alanların alarmını gizlemez.
 */
export function suspiciousDiffs(readings: CashReading[], saved: SavedFields): PhotoDiff[] {
  return photoDiffs(readings, saved).filter((d) => d.confidence === "high" && !d.excused);
}

const shown = (d: PhotoDiff, v: number | string | null) => (v === null ? "boş" : ZNO_FIELDS.includes(d.field) || COUNT_FIELDS.includes(d.field) ? String(v) : money(Number(v)));

/** "Kart (fotoğrafta 8.915 ₺, raporda 8.951 ₺)" */
export function photoDiffText(d: PhotoDiff, withSaved = true): string {
  return withSaved ? `${d.label} (fotoğrafta ${shown(d, d.photo)}, raporda ${shown(d, d.saved)})` : `${d.label} (fotoğrafta ${shown(d, d.photo)})`;
}
