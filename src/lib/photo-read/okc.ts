/**
 * Yazarkasanın (banka POS, yeni nesil ÖKC) mali Z raporunun okunması (dalga 13 PR-b, docs/planlar/okc-z.md §3.3, §5;
 * saf, tests/okc-z.test.ts). Model rakamları yazıldığı gibi aktarır (`KasaOkcRaw`); kimlikler src/lib/okc-z.ts'te.
 * Her alanın durumu: doğrulandı (iki ayrı basılı rakam birbirini tutuyor; orta güvende de mavi dolar), tutmadı
 * (forma yazılmaz, nedeniyle öneri olur) ya da denetlenemedi (güvenine göre). Kümülatif ve yazarkasa dışı tahsilat
 * günün rakamı olarak hiçbir alana gitmez; yalnız yöneticiye ve sunucuya (`okcAdmin`), personelin yanıtından
 * `toStaffReading` ile çıkar (D17). Banka gün sonu fişi bu bölümde yedektir: yalnız `bankPos`'u doldurur.
 */

import { money } from "@/lib/format";
import { normalizeVat, OKC_PREFILL_ENABLED, OKC_SUGGEST_TEXT, okcChecks, SUM_TOL, zNoNumber, type OkcContext, type OkcField, type OkcFigures, type OkcVatGroup } from "@/lib/okc-z";
import { addDays, dayMonthTR } from "@/lib/reminders";

import { businessDayOf, clean, IMAGE_ISSUES, ISSUE_TEXT, lowest, printedAmount, round2, UNREADABLE_TEXT, type Confidence } from "./common";
import { dayCheck, failed, FISCAL_Z_CARD_TEXT, issueChecks, looksLike, mismatchCheck, ordered, type CashReading, type ReadCheck, type ReadField, type ReadValue } from "./kasa";
import type { AmountRaw, KasaOkc } from "./schemas";

export interface OkcReadContext extends OkcContext {
  /**
   * Z elle ve bazen ertesi sabah alınıyorsa (adım 0 madde 2 doğrularsa) açılır: basılı gün = rapor günü + 1, saat ≥
   * 05:00 ve Z no = önceki + 1 → başka günün fişi sayılmaz, yöneticiye bilgi. Varsayılan kapalı (plan §5.4)
   */
  nextMorningZ?: boolean;
}

/** Uzun fişin kesik kalan kısmı (bu türde ayrı metin, plan §3.4) */
export const OKC_CUT_OFF_TEXT = "Fişin bir kısmı fotoğrafta yok; kalan kısmını ayrıca çekin.";

/** Tek fotoğrafta temel alanlardan biri tutmadı ya da düşük güvende: üst / alt yarı önerisi (plan §3.4, D11) */
export const OKC_HALVES_TEXT = "Fişin üst ve alt yarısını ayrı çekerseniz rakamlar daha net okunur.";

/** Yanlış belgenin metni (plan §3.3); ModPOS Z'si ModPOS bölümüne okutulabilir */
function wrongOkcDocument(documentType: KasaOkc["documentType"]): CashReading {
  switch (documentType) {
    case "software_z":
      return failed("kasa-okc", "Bu ModPOS'un Z raporu gibi görünüyor.", "kasa-z");
    case "x_report":
      return failed("kasa-okc", "Bu bir X raporu (gün içi) gibi görünüyor; yazarkasadan Z raporunu alıp çekin.");
    case "period_report":
      return failed("kasa-okc", "Bu bir mali hafıza / dönem raporu gibi görünüyor; günün Z raporunu çekin.");
    default:
      return failed("kasa-okc", `${looksLike(documentType)} Yazarkasanın Z raporunun fotoğrafını çekin.`);
  }
}

/**
 * AsilPOS gününde (geçiş gününden itibaren; denetim E-39) ModPOS Z bölümü yok: yazılım Z'si (AsilPOS'un gün sonu çıktısı)
 * yazarkasa bölümüne çekilirse "ModPOS bölümüne okut" önerilmez, kasanın rakamları gün sonuyla kendiliğinden gelir.
 * Ayrı mali Z basan cihazda (TokenX) ya da cihaz bilinmiyorsa yazarkasanın Z'si istenir; Pavo ayrı mali Z basmaz
 * (AsilPOS'ta `zReport: false`), orada Pavo'nun gün sonu fişi (detaylı Z) istenir
 */
export const OKC_SOFTWARE_Z_ASILPOS_TEXT = "Bu kasanın (AsilPOS) gün sonu gibi görünüyor; onun rakamları panele kendiliğinden gelir. Banka POS'un (yazarkasa) Z raporunu çekin.";
/** Aynısı Pavo gününde (24 Kasım 2026, Marina): Pavo ayrı mali Z basmaz, gün sonu fişi istenir */
export const OKC_SOFTWARE_Z_PAVO_TEXT = "Bu AsilPOS'un kendi raporu (mali Z değil); rakamları panele kendiliğinden gelir. Pavo'nun gün sonu fişinin (detaylı Z) fotoğrafını çekin.";

/** Yalnız banka gün sonu fişi okundu (ModPOS günü, ayrı mali Z basan cihaz): yazarkasanın Z'si de istenir */
export const OKC_BATCH_SLIP_TEXT = "Bu banka gün sonu fişi; yalnız Banka gün sonu okundu. Yazarkasanın Z raporunu da çekin.";
/**
 * Aynısı AsilPOS gününde (ayrı mali Z basmayan cihaz, ör. Pavo): yazarkasa rakamları AsilPOS'tan gelir, ikinci bir Z
 * istenmez (24 Kasım 2026, Marina: kör kasada AsilPOS'un bastığı kâğıtta yalnız banka gün sonu var; "Z değil, Z'yi de
 * çekin" yanlış yönergeydi)
 */
export const OKC_BATCH_SLIP_ASILPOS_TEXT = "Banka gün sonu okundu; yazarkasa rakamları AsilPOS'tan gelir.";

/** Günün yazarkasa cihazı (AsilPOS'un `okc`'si): sağlayıcı ve ayrı mali Z basıyor mu */
export interface AsilposOkcDevice {
  provider: "pavo" | "tokenx";
  zReport: boolean;
}

/** Cihaz ayrı mali Z basıyor mu (TokenX); bilinmiyorsa basar sayılır (eski metin, yazarkasanın Z'si istenir) */
const separateZ = (device: AsilposOkcDevice | null | undefined) => !device || (device.provider === "tokenx" && device.zReport);

/**
 * Yazarkasa okumasını AsilPOS gününe uyarlar: ModPOS bölümüne okutma önerisi kalkar; ayrı mali Z basmayan cihazda (Pavo)
 * yazılım Z'sinin metni Pavo'nun fişini, yalnız banka gün sonunun bilgisi "rakamlar AsilPOS'tan gelir" der
 */
export function okcReadingOnAsilposDay(r: CashReading, device?: AsilposOkcDevice | null): CashReading {
  if (r.kind !== "kasa-okc") return r;
  if (!r.ok) return r.switchTo === "kasa-z" ? { ...r, error: separateZ(device) ? OKC_SOFTWARE_Z_ASILPOS_TEXT : OKC_SOFTWARE_Z_PAVO_TEXT, switchTo: null } : r;
  if (separateZ(device) || !r.checks.some((c) => c.text === OKC_BATCH_SLIP_TEXT)) return r;
  return { ...r, checks: r.checks.map((c) => (c.text === OKC_BATCH_SLIP_TEXT ? { ...c, text: OKC_BATCH_SLIP_ASILPOS_TEXT } : c)) };
}

/**
 * AsilPOS'un kendi gün sonu kâğıdı (kapanışta fiş yazıcısından; 24 Kasım 2026, Marina): kasanın rakamlarını gören basınca
 * önce AsilPOS'un yönetim raporu ("GÜN SONU · Z n", NET CİRO, altında "AsilPOS yönetim raporudur, mali Z değildir"),
 * ardından Pavo'nun banka gün sonu ("BANKA GÜN SONU · PAVO"); kör kasada (kasa.rakam yok) yalnız banka kısmı. Gün
 * açıkken basılan ara raporun başlığı "ARA RAPOR (X)" (aynı düzen, aynı dipnot). Mali değildir: Z no'su AsilPOS'un kendi
 * sayacı, NET CİRO'su AsilPOS'un cirosu; yazarkasa alanlarına ve Z no'ya hiç gitmez. Tanıma: basılı başlık (model de kod
 * da ilk başlığı aynen yazar; ayraç "·", "-", "|", "—" ya da hiç) ya da "NET CİRO" etiketi ("NET CİRO:", "NET CİRO (KDV
 * DAHİL)" da); ikisinde de mali işaret (MF logosu, EKÜ NO, KÜM. satırları) olmamalı: AsilPOS'un kâğıdında hiçbiri yoktur,
 * başlığı "GÜN SONU - Z 7" okunmuş gerçek bir mali Z AsilPOS'un kâğıdı sayılmaz
 */
export function isAsilposPaper(raw: Pick<KasaOkc, "title" | "dailyTotalLabel" | "fiscalMarks">): boolean {
  if (raw.fiscalMarks.mfLogo || raw.fiscalMarks.ekuNo || raw.fiscalMarks.cumulativeLines) return false;
  const title = upTR(raw.title);
  if (MANAGEMENT_TITLE.test(title) || BANK_TITLE.test(title) || INTERIM_TITLE.test(title)) return true;
  // Etiketin noktalaması ve eki atılır: "NET CİRO:", "NET CİRO (KDV DAHİL)"
  const label = upTR(raw.dailyTotalLabel).replace(/[^A-Z0-9ÇĞİÖŞÜ]+/g, " ").trim();
  return /^NET\s*C[İI]RO(\s|$)/.test(label);
}

const upTR = (v: string | null) => (v ?? "").toLocaleUpperCase("tr-TR");
/** "GÜN SONU · Z 31", "GÜN SONU - Z31", "GÜN SONU Z 31", "GÜN SONU | Z 31"; "GÜN SONU Z NO: 7" değil */
const MANAGEMENT_TITLE = /G[ÜU]N\s*SONU\s*[^A-Z0-9ÇĞİÖŞÜ]{0,2}\s*Z\s*\d/;
/** "BANKA GÜN SONU · PAVO" (ayraç isteğe bağlı) */
const BANK_TITLE = /BANKA\s*G[ÜU]N\s*SONU\s*[^A-Z0-9ÇĞİÖŞÜ]{0,2}\s*PAVO/;
/** "ARA RAPOR (X)": gün açıkken AsilPOS'un ara raporu */
const INTERIM_TITLE = /ARA\s*RAPOR\s*\(?\s*X\b/;

const NO_AMOUNT: AmountRaw = { text: null, value: null, confidence: "low" };

/**
 * Okunuşun karşılaştırılan ve forma giden hâli (yeni şema değeri yok: eski ai_calls satırları da aynı yoldan geçer).
 * Yalnız AsilPOS'un kâğıdı dönüşür: banka kısmı okunduysa banka gün sonu fişi (`batch_slip`); Z no, toplam, ödeme ve KDV
 * (AsilPOS'un kendi rakamları) atılır, model `z_report` dese de. Banka kısmı ("BANKA GÜN SONU · PAVO" başlığı ya da model
 * `batch_slip` dedi) var ama hiçbir banka satırı okunmadıysa (satırlar kadraj dışı, ya da kartla satış yok: "İşlem
 * yok") okunamamış banka gün sonu fişidir (personele "Z'yi çekin" denmez); banka kısmı yoksa yazılım Z'si (ARA RAPOR da).
 * Öteki her okunuş olduğu gibi: banka satırı da okunmuş bir yazılım Z'si (Tuzla'da ModPOS Z'si; ya da Pavo'nun detaylı
 * Z'si yanlış sınıflanmış) yanlış belge kalır, ModPOS bölümüne okut önerisi ve güçlü modelin ikinci bakışı korunur
 */
export function okcPaperView(raw: KasaOkc): KasaOkc {
  if (!isAsilposPaper(raw)) return raw;
  const bankPart = raw.batches.length > 0 || raw.documentType === "batch_slip" || BANK_TITLE.test(upTR(raw.title));
  return {
    ...raw,
    documentType: bankPart ? "batch_slip" : "software_z",
    readable: raw.readable && (raw.batches.length > 0 || !bankPart),
    zNo: { text: null, value: null, confidence: "low" },
    receiptCount: { text: null, value: null, confidence: "low" },
    dailyTotal: NO_AMOUNT,
    dailyTotalLabel: null,
    kdvGroups: [],
    totalVat: NO_AMOUNT,
    payments: [],
    outside: [],
    voids: NO_AMOUNT,
    discounts: NO_AMOUNT,
    cumulativeTotal: NO_AMOUNT,
    cumulativeVat: NO_AMOUNT,
  };
}

/** AsilPOS'un banka gün sonu kâğıdı okundu ama banka satırları yok (kadraj dışı ya da "İşlem yok") */
export const OKC_ASILPOS_BANK_UNREAD_TEXT = "Bu AsilPOS'un banka gün sonu kâğıdı ama banka satırları okunamadı; Bankalar ve TOPLAM görünecek şekilde yeniden çekin.";

/**
 * Yalnız banka gün sonu fişi okundu ama Z'nin izleri var (Z no, günün toplamı, nakit / kart / yemek kartı / diğer satırı,
 * KDV) ya da başlığı Z ya da detaylı Z diyor; AsilPOS'un kâğıdı değil: ucuz okuma Pavo'nun detaylı Z'sini banka fişi
 * sanmış olabilir. Güçlü model bir kez bakar (yoksa Z no hiç okunmaz, karşılaştırma sessizce "uyumlu" kalır)
 */
export function slipWithZTraces(raw: KasaOkc): boolean {
  if (raw.documentType !== "batch_slip" || isAsilposPaper(raw)) return false;
  const has = (a: AmountRaw) => a.text !== null || a.value !== null;
  const title = (raw.title ?? "").toLocaleUpperCase("tr-TR");
  return (
    raw.zNo.text !== null ||
    raw.zNo.value !== null ||
    has(raw.dailyTotal) ||
    raw.kdvGroups.length > 0 ||
    has(raw.totalVat) ||
    raw.payments.some((p) => p.kind === "cash" || p.kind === "card" || p.kind === "meal_card" || p.kind === "other") ||
    /(^|[^A-ZÇĞİÖŞÜ])Z([^A-ZÇĞİÖŞÜ]|$)|DETAYLI/.test(title)
  );
}

const PAY_FIELD = { cash: "okcCash", card: "okcCard", meal_card: "okcMealCard", other: "okcOther", unknown: "okcOther" } as const;

/**
 * Banka gün sonu fişi raporun gününe mi ait: aynı gün ya da ertesi gün (fiş çoğu zaman ertesi sabah, kasa açılınca
 * basılır). Partilerin tarihi de fişin başlık tarihi de bu kuralla denetlenir (denetim E-69)
 */
const slipDayFits = (slipDay: string, day: string) => slipDay === day || slipDay === addDays(day, 1);

/** Banka gün sonu fişlerinin neti (net yoksa satış − iade) ve uyarıları (bugünkü normalizePos kuralları) */
function batchesOf(raw: KasaOkc, day: string): { value: number; confidence: Confidence; count: number; checks: ReadCheck[]; dayWarned: boolean } | null {
  let value = 0;
  let confidence: Confidence = "high";
  let count = 0;
  const checks: ReadCheck[] = [];
  /** Uyarılan yanlış günler: iki POS'un partisi aynı yanlış günden ise tek uyarı (E-69; kutuda dört satır var) */
  const warnedDays = new Set<string>();
  for (const b of raw.batches) {
    const net = printedAmount(b.netTotal);
    const sales = printedAmount(b.salesTotal);
    const refunds = b.refundTotal.text === null ? null : printedAmount(b.refundTotal);
    for (const [a, r] of [
      [b.netTotal, net],
      [b.salesTotal, sales],
      [b.refundTotal, refunds],
    ] as [AmountRaw, ReturnType<typeof printedAmount> | null][]) {
      if (r?.mismatch) checks.push(mismatchCheck("bankPos", a));
    }
    const computed = sales.value === null ? null : round2(sales.value - (refunds?.value ?? 0));
    if (net.value !== null) {
      value += net.value;
      confidence = lowest(confidence, net.confidence);
      if (computed !== null && Math.abs(net.value - computed) >= 1) {
        checks.push({ fields: ["bankPos"], level: "warn", text: `Banka gün sonunda net ${money(net.value)}, satış − iade ${money(computed)}; fişle karşılaştırın.` });
      }
    } else if (computed !== null) {
      value += computed;
      confidence = lowest(confidence, lowest(sales.confidence, refunds?.confidence ?? "high"));
    } else continue;
    count++;
    const slipDay = businessDayOf(b.date, null);
    if (slipDay && !slipDayFits(slipDay, day) && !warnedDays.has(slipDay)) {
      warnedDays.add(slipDay);
      checks.push({ fields: ["bankPos"], level: "warn", text: `Banka gün sonu fişinin tarihi ${dayMonthTR(slipDay)}; bu rapor ${dayMonthTR(day)} için. Doğru günün fişi mi?` });
    }
  }
  return count ? { value: round2(value), confidence, count, checks, dayWarned: warnedDays.size > 0 } : null;
}

/**
 * Yazarkasa Z okuması → forma gidecek değerler, alan durumları ve denetimler. `ctx.prev.cum` yalnız sunucuda verilir
 * (zincir, K6); formdaki canlı denetim kümülatifsiz çalışır.
 */
export function normalizeOkc(read: KasaOkc, ctx: OkcReadContext): CashReading {
  const raw = okcPaperView(read);
  if (raw.documentType !== "z_report" && raw.documentType !== "batch_slip") return wrongOkcDocument(raw.documentType);
  if (!raw.readable || raw.issues.includes("not_a_document")) return failed("kasa-okc", raw !== read && raw.documentType === "batch_slip" && !raw.batches.length ? OKC_ASILPOS_BANK_UNREAD_TEXT : UNREADABLE_TEXT);
  const values: Partial<Record<ReadField, ReadValue>> = {};
  const checks: (ReadCheck | null)[] = [];
  const issues = (fieldValues: Partial<Record<ReadField, ReadValue>>) =>
    issueChecks(raw.issues, fieldValues).map((c) => (c.text === ISSUE_TEXT.cut_off ? { ...c, text: OKC_CUT_OFF_TEXT } : c));

  // Yalnız banka gün sonu fişi: yalnız Banka gün sonu okunur (doldurma kapısı açıksa dolar), yazarkasa alanları boş kalır (plan §5.5)
  if (raw.documentType === "batch_slip") {
    const b = batchesOf(raw, ctx.day);
    if (b) values.bankPos = { value: b.value, confidence: b.confidence };
    checks.push(...(b?.checks ?? []));
    if (b && b.count > 1) checks.push({ fields: [], level: "info", text: `${b.count} banka gün sonu toplandı: ${money(b.value)}.` });
    checks.push({ fields: [], level: "info", text: OKC_BATCH_SLIP_TEXT });
    const printedDay = businessDayOf(raw.date, raw.time);
    // Fişin başlık tarihi partilerinkiyle aynı kuralla (ertesi gün de olur) ve partiler zaten uyarmadıysa: tek tarih
    // uyarısı (E-69; önceden ertesi sabah basılmış fişi bir kural kabul edip öbürü uyarıyordu)
    if (raw.dateConfidence !== "low" && printedDay && !slipDayFits(printedDay, ctx.day) && !b?.dayWarned) checks.push(dayCheck(printedDay, ctx.day, "banka gün sonu fişi mi"));
    checks.push(...issues(values));
    return { kind: "kasa-okc", ok: true, error: null, switchTo: null, printedDay, values, missing: values.bankPos ? [] : ["bankPos"], checks: ordered(checks) };
  }

  const imageTrouble = raw.issues.some((i) => IMAGE_ISSUES.includes(i));
  const put = (field: OkcField, a: AmountRaw): number | null => {
    const p = printedAmount(a);
    if (p.mismatch) checks.push(mismatchCheck(field, a));
    if (p.value !== null) values[field] = { value: p.value, confidence: p.confidence };
    return p.value;
  };

  const total = put("okcTotal", raw.dailyTotal);
  const vatTotal = put("okcVatTotal", raw.totalVat);

  // KDV dökümü: sıfır gruplar atılır; alanı olan oranlar (%1, %10, %20) forma, hepsi kimliklere ve döküme
  const groups: OkcVatGroup[] = [];
  for (const g of raw.kdvGroups) {
    const t = printedAmount(g.total);
    const v = printedAmount(g.vat);
    const b = g.base && g.base.text !== null ? printedAmount(g.base) : null;
    if (!(t.value !== null && Math.abs(t.value) >= 0.005) && !(v.value !== null && Math.abs(v.value) >= 0.005)) continue;
    groups.push({ rate: g.rate, total: t.value, vat: v.value, base: b?.value ?? null });
    if (g.rate === 1 || g.rate === 10 || g.rate === 20) {
      const tf = `okcT${g.rate}` as const;
      const vf = `okcV${g.rate}` as const;
      if (t.mismatch) checks.push(mismatchCheck(tf, g.total));
      if (v.mismatch) checks.push(mismatchCheck(vf, g.vat));
      if (t.value !== null) values[tf] = { value: t.value, confidence: t.confidence };
      if (v.value !== null) values[vf] = { value: v.value, confidence: v.confidence };
    }
  }

  // Ödemeler: türlerine göre toplanır, alanın güveni satırlarının en düşüğü. KASA NAKİT (drawer) toplamaya girmez.
  // Banka alt satırları karta eklenmez; kart satırı hiç yoksa kart = Σ banka satırları (plan §5.2)
  const sums = new Map<OkcField, { value: number; confidence: Confidence; read: boolean }>();
  const add = (field: OkcField, value: number | null, confidence: Confidence) => {
    const prev = sums.get(field);
    sums.set(field, {
      value: round2((prev?.value ?? 0) + (value ?? 0)),
      confidence: lowest(prev?.confidence ?? "high", value === null ? "low" : confidence),
      read: Boolean(prev?.read) || value !== null,
    });
  };
  let subTotal = 0;
  let subConfidence: Confidence = "high";
  let subRead = false;
  const hasCardLine = raw.payments.some((p) => p.kind === "card");
  for (const line of raw.payments) {
    const a = printedAmount(line.amount);
    const label = clean(line.label, 40) ?? "?";
    if (line.kind === "drawer") continue;
    if (line.kind === "bank_subline") {
      subTotal = round2(subTotal + (a.value ?? 0));
      subConfidence = lowest(subConfidence, a.value === null ? "low" : a.confidence);
      subRead ||= a.value !== null;
      if (a.mismatch) checks.push(mismatchCheck("okcCard", line.amount));
      continue;
    }
    const field = PAY_FIELD[line.kind];
    add(field, a.value, a.confidence);
    if (a.mismatch) checks.push(mismatchCheck(field, line.amount));
    if (line.kind === "unknown") {
      checks.push({ fields: ["okcOther"], level: "warn", text: `Tanınmayan ödeme satırı “${label}” (${a.value === null ? "okunamadı" : money(a.value)}) Diğer'e eklendi; doğru mu?` });
    }
  }
  if (!hasCardLine && subRead) {
    sums.set("okcCard", { value: subTotal, confidence: subConfidence, read: true });
    checks.push({ fields: [], level: "info", admin: true, text: "Z'de kart satırı yok; banka satırları toplanıp kart yazıldı." });
  }
  // Ödeme bölümü okunduysa satırı olmayan nakit ve kart 0'dır (eksikse turuncu)
  const paymentsRead = raw.payments.some((p) => p.kind !== "drawer");
  if (paymentsRead) for (const f of ["okcCash", "okcCard"] as const) if (!sums.has(f)) sums.set(f, { value: 0, confidence: "medium", read: true });
  const unreadLines: ReadField[] = [];
  for (const [field, s] of sums) {
    if (s.read) values[field] = { value: s.value, confidence: s.confidence };
    else unreadLines.push(field);
  }

  // Z no ve fiş sayısı (sayaçlar): güveni kendi; görüntü sorunu varsa en çok "medium"
  const cap = (c: Confidence): Confidence => (imageTrouble ? lowest(c, "medium") : c);
  const zNo = clean(raw.zNo.text, 30) ?? (raw.zNo.value !== null ? String(raw.zNo.value) : null);
  if (zNo) values.okcZNo = { value: zNo, confidence: cap(raw.zNo.confidence) };
  const receipts = raw.receiptCount.value ?? (raw.receiptCount.text !== null && /^\s*\d+\s*$/.test(raw.receiptCount.text) ? Number(raw.receiptCount.text) : null);
  if (receipts !== null) values.okcReceipts = { value: receipts, confidence: cap(raw.receiptCount.confidence) };

  // Yalnız yöneticiye: kümülatif (günlük toplamdan küçükse yok sayılır), toplam dışı tahsilat, fiş iptali
  const cumT = raw.cumulativeTotal.text === null && raw.cumulativeTotal.value === null ? null : printedAmount(raw.cumulativeTotal).value;
  const cumV = raw.cumulativeVat.text === null && raw.cumulativeVat.value === null ? null : printedAmount(raw.cumulativeVat).value;
  const cumTotal = cumT !== null && (total === null || cumT >= total - SUM_TOL) ? cumT : null;
  const cumVat = cumTotal !== null && cumV !== null && (vatTotal === null || cumV >= vatTotal - SUM_TOL) ? cumV : null;
  const outsideLines = raw.outside.map((o) => printedAmount(o.amount).value).filter((v): v is number => v !== null);
  const outside = outsideLines.length ? round2(outsideLines.reduce((a, v) => a + v, 0)) : null;
  const voids = raw.voids.text === null ? null : printedAmount(raw.voids).value;
  if (outside !== null && outside > 1) checks.push({ fields: [], level: "info", admin: true, text: `Z'de toplam dışında ${money(outside)} tahsilat var (faturalı satış, bilgi fişi…); toplama eklenmedi.` });
  if (voids !== null && voids > 0) checks.push({ fields: [], level: "info", admin: true, text: `Z'de ${money(voids)} fiş iptali var (toplamdan zaten düşülmüş).` });

  // Kimlikler (okc-z.ts): alan durumları ve nedenleri
  const num = (f: OkcField) => (values[f] === undefined ? null : Number(values[f]!.value));
  const figures: OkcFigures = {
    zNo,
    receipts,
    total,
    vatTotal,
    groups,
    cash: num("okcCash"),
    card: num("okcCard"),
    mealCard: num("okcMealCard") ?? (paymentsRead ? 0 : null),
    other: num("okcOther") ?? (paymentsRead ? 0 : null),
    outside,
    bankSublines: hasCardLine && subRead ? subTotal : null,
    cumTotal,
    cumVat,
    totalLabel: raw.dailyTotalLabel,
  };
  const res = okcChecks(figures, ctx);
  for (const [f, s] of Object.entries(res.status) as [OkcField, "confirmed" | "failed"][]) {
    const v = values[f];
    if (!v) continue;
    values[f] = s === "failed" ? { ...v, status: s, reason: res.reasons[f] } : { ...v, status: s };
  }
  for (const c of res.checks) {
    // Ayrıntılı metin yöneticiye; personele yalnız işlemsel satırlar (Z no) ve okumayı durduran satır
    if (c.whole) checks.push({ fields: [], level: "warn", text: c.text, whole: true });
    else checks.push({ fields: [], level: c.level, admin: true, text: c.text });
    if (c.staff && !c.whole) checks.push({ fields: c.level === "warn" ? c.fields : [], level: c.level, text: c.staff });
  }
  // Aynı Z no: okumanın bütünü durur, hiçbir alan yazılmaz, hepsi öneri olur
  if (res.stopped) {
    const why = res.checks.find((c) => c.whole)?.text ?? "Fişle karşılaştırın.";
    for (const f of Object.keys(values) as ReadField[]) values[f] = { ...values[f]!, status: "failed", reason: why };
  }

  // Aynı şeritte banka gün sonu: Banka gün sonu da okunur (iki fiş toplanır); metin kapıdan bağımsız (dolmayabilir)
  const b = batchesOf(raw, ctx.day);
  if (b) {
    values.bankPos = { value: b.value, confidence: b.confidence };
    checks.push(...b.checks);
    checks.push({ fields: [], level: "info", text: b.count > 1 ? `${b.count} banka gün sonu toplandı: ${money(b.value)}.` : `Aynı fişte banka gün sonu da var: Banka gün sonu ${money(b.value)}.` });
  }

  // Tarih (plan §5.4): düşük güvenli tarih denetlenmez; ertesi sabah alınan Z yalnız istisna açıkken bu güne sayılır
  const printedDay = businessDayOf(raw.date, raw.time);
  if (raw.dateConfidence !== "low" && printedDay && printedDay !== ctx.day) {
    const prevNo = ctx.prev.z ? zNoNumber(ctx.prev.z.zNo) : null;
    const cur = zNoNumber(zNo);
    const morning = /^(\d{1,2})[:.](\d{2})/.exec(raw.time?.trim() ?? "");
    const nextMorning = ctx.nextMorningZ && printedDay === addDays(ctx.day, 1) && morning !== null && Number(morning[1]) >= 5 && cur !== null && prevNo !== null && cur === prevNo + 1;
    if (nextMorning) checks.push({ fields: [], level: "info", admin: true, text: `Z ertesi sabah alınmış (${dayMonthTR(printedDay)} ${morning[1].padStart(2, "0")}:${morning[2]}); bu güne yazıldı.` });
    else checks.push(dayCheck(printedDay, ctx.day, "Z raporu mu"));
  }
  checks.push(...issues(values));

  const missing: ReadField[] = [];
  if (!values.okcTotal) missing.push("okcTotal");
  if (!paymentsRead) missing.push("okcCash", "okcCard");
  missing.push(...unreadLines.filter((f) => !missing.includes(f)));
  const okcVat = normalizeVat(groups.filter((g) => g.total !== null && g.vat !== null).map((g) => ({ rate: g.rate, total: g.total!, vat: g.vat! })));
  return {
    kind: "kasa-okc",
    ok: true,
    error: null,
    switchTo: null,
    printedDay,
    values,
    missing,
    checks: ordered(checks),
    okcVat,
    okcAdmin: { documentZNo: zNo, cumTotal, cumVat, outside, voids },
    ...(outside !== null && outside > 1 ? { extraTakings: true as const } : {}),
  };
}

/**
 * Personelin okuma yanıtı (D17): kümülatif, yazarkasa dışı tahsilat ve yöneticinin ayrıntılı satırları çıkar. Sunucu
 * personele yalnız bunu döner (tests/personel-sizinti-kasa.test.ts, adım b5).
 */
export function toStaffReading(r: CashReading): CashReading {
  const { okcAdmin: _admin, ...rest } = r;
  void _admin;
  return { ...rest, checks: r.checks.filter((c) => !c.admin) };
}

/** Rapora bağlı yazarkasa Z fotoğraflarının okumalarından sunucu sütunlarının girdisi (plan §6.1) */
export interface OkcReadFigures {
  zNo: string | null;
  total: number | null;
  vatTotal: number | null;
  cumTotal: number | null;
  cumVat: number | null;
  outside: number | null;
}

/**
 * Okumaların (eskiden yeniye) birleşik rakamları: her rakam onu okuyan son okumadan (uzun fiş üst ve alt parça olarak
 * çekilebilir; KÜM. satırları çoğunlukla alt parçada, D11, D17). Kümülatif toplam ve KDV aynı okumadan, birlikte.
 * Yazarkasa Z'si okunmadıysa (yanlış belge, yalnız banka fişi) null
 */
export function okcReadFigures(readings: readonly CashReading[]): OkcReadFigures | null {
  const ok = readings.filter((r) => r.ok && r.kind === "kasa-okc" && r.okcAdmin).reverse();
  if (!ok.length) return null;
  const last = <T>(pick: (r: CashReading) => T | null | undefined): T | null => {
    for (const r of ok) {
      const v = pick(r);
      if (v !== null && v !== undefined) return v;
    }
    return null;
  };
  const num = (r: CashReading, f: "okcTotal" | "okcVatTotal") => (r.values[f] ? Number(r.values[f]!.value) : null);
  const cum = ok.find((r) => r.okcAdmin!.cumTotal !== null)?.okcAdmin ?? null;
  return {
    zNo: last((r) => r.okcAdmin!.documentZNo),
    total: last((r) => num(r, "okcTotal")),
    vatTotal: last((r) => num(r, "okcVatTotal")),
    cumTotal: cum?.cumTotal ?? null,
    cumVat: cum?.cumVat ?? null,
    outside: last((r) => r.okcAdmin!.outside),
  };
}

/** Temel alanlardan biri tutmadı ya da düşük güvende: üst / alt yarı önerisi gösterilir (plan §3.4) */
export function okcNeedsHalves(r: CashReading): boolean {
  if (r.kind !== "kasa-okc" || !r.ok) return false;
  return (["okcTotal", "okcCash", "okcCard", "okcZNo"] as const).some((f) => r.values[f]?.status === "failed" || r.values[f]?.confidence === "low");
}

/**
 * Geçiş (plan D2, §7): eski sayfa `kasa-pos` gönderdi, fotoğraf `kasa-okc` olarak okundu; eski sayfaya eski biçimde
 * yanıt. Tür "kasa-pos", değerlerde yalnız banka gün sonu fişinden okunan `bankPos` (yazarkasa Z'sinin toplamı ya da
 * kartı asla) ve yalnız onun uyarıları. Fişte banka gün sonu yoksa PR-a'nın yönergesi (Z'nin kart satırını elle
 * yazın). Yazarkasa okuması forma kendiliğinden yazılmadıkça (`OKC_PREFILL_ENABLED`) `bankPos` öneri olarak döner:
 * güveni "low" (eski sayfanın `prefillPlan`'ı yalnız düşük güvenli değeri yazmaz) ve nedeni.
 */
export function okcToLegacyPos(r: CashReading, o: { okcPrefill?: boolean } = {}): CashReading {
  if (!r.ok) return { ...failed("kasa-pos", r.error ?? UNREADABLE_TEXT, r.switchTo === "kasa-z" ? "kasa-z" : null), ...(r.advice ? { advice: true } : {}) };
  const bank = r.values.bankPos;
  if (!bank) return { ...failed("kasa-pos", FISCAL_Z_CARD_TEXT), advice: true, printedDay: r.printedDay };
  const prefill = o.okcPrefill ?? OKC_PREFILL_ENABLED;
  const value: ReadValue = prefill ? { value: bank.value, confidence: bank.confidence } : { value: bank.value, confidence: "low", status: "failed", reason: OKC_SUGGEST_TEXT };
  return {
    kind: "kasa-pos",
    ok: true,
    error: null,
    switchTo: null,
    printedDay: r.printedDay,
    values: { bankPos: value },
    missing: [],
    checks: r.checks.filter((c) => !c.admin && c.fields.length > 0 && c.fields.every((f) => f === "bankPos")),
  };
}
