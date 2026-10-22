/**
 * Kasadan ödenen fişin okunması (saf; tests/fotograf-okuma.test.ts): tutar, KDV, yer, ne alındığı, tarih ve önerilen
 * kategori; denetimler (kartla ödenmiş fiş, tutmayan kalemler, KDV oranı, tarih, tekrar eklenen fiş). Toplam, para
 * üstü ya da verilen nakit değil "TOPLAM"dır (istem böyle sorar; burada kalem toplamıyla da karşılaştırılır).
 */

import { dateTR, money } from "@/lib/format";
import { addDays, longDateTR } from "@/lib/reminders";

import { clean, foldName, IMAGE_ISSUES, ISSUE_TEXT, lowest, printedAmount, round2, tidyStore, UNREADABLE_TEXT, validDay, type Confidence } from "./common";
import type { Receipt } from "./schemas";

export type ReceiptDocType = "fis" | "e_arsiv" | "fatura";
export type ReceiptField = "amount" | "receiptDate" | "store" | "summary" | "vat" | "categoryId";
export type PaymentMethod = "nakit" | "kart" | "diger";

export interface ReceiptCheck {
  fields: ReceiptField[];
  level: "warn" | "info";
  text: string;
}

export interface ReceiptReading {
  ok: boolean;
  error: string | null;
  docType: ReceiptDocType;
  values: {
    amount: number | null;
    receiptDate: string | null;
    store: string | null;
    summary: string | null;
    vat: number | null;
    receiptNo: string | null;
    paymentMethod: PaymentMethod | null;
    categoryId: number | null;
  };
  confidence: Partial<Record<ReceiptField, Confidence>>;
  checks: ReceiptCheck[];
  /** Aylık harcamalar'a da yazılsın mı (yöneticinin anahtarının ilk hâli): fatura ve e-Arşiv Paraşüt'ten gelir */
  toExpensesDefault: boolean;
}

export interface ReceiptContext {
  /** Kasanın iş günü */
  day: string;
  /** Seçilebilen kategoriler (personelde yalnız alım kategorileri) */
  categories: { id: number; name: string; section: string }[];
  /** Son eklenenler (günün ±1 kasadan çıkanları, ±7 gün harcamalar): aynı fiş iki kez eklenmesin */
  recent: { date: string; amount: number; store: string | null; receiptNo: string | null }[];
  staff: boolean;
}

/** Bu tutarın üstü alışılmadık (kasadan ödenen fiş için) */
export const LARGE_RECEIPT = 20_000;

const DOC_TYPE: Record<Receipt["documentType"], ReceiptDocType> = {
  purchase_receipt: "fis",
  e_archive_invoice: "e_arsiv",
  invoice: "fatura",
  other: "fis",
  z_report: "fis",
  bank_pos_end_of_day: "fis",
};

const EMPTY_VALUES: ReceiptReading["values"] = { amount: null, receiptDate: null, store: null, summary: null, vat: null, receiptNo: null, paymentMethod: null, categoryId: null };

const failed = (error: string): ReceiptReading => ({ ok: false, error, docType: "fis", values: EMPTY_VALUES, confidence: {}, checks: [], toExpensesDefault: false });

/** Aynı mağaza: sade adları eşit ya da biri ötekinin başı ("Migros" / "Migros · süt, buz" harcama açıklaması) */
function sameStore(a: string | null, b: string | null): boolean {
  const x = foldName(a);
  const y = foldName(b);
  return Boolean(x && y && (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `)));
}

/** Gün farkı (b − a) */
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function normalizeReceipt(raw: Receipt, ctx: ReceiptContext): ReceiptReading {
  if (raw.documentType === "z_report") return failed("Bu bir Z raporu, kasadan ödenen bir fiş değil.");
  if (raw.documentType === "bank_pos_end_of_day") return failed("Bu bir banka POS fişi, kasadan ödenen bir fiş değil.");
  if (!raw.readable || raw.issues.includes("not_a_document")) return failed(UNREADABLE_TEXT);

  const checks: ReceiptCheck[] = [];
  const confidence: Partial<Record<ReceiptField, Confidence>> = {};
  const imageTrouble = raw.issues.some((i) => IMAGE_ISSUES.includes(i));
  const plain: Confidence = imageTrouble ? "medium" : "high";
  const docType = DOC_TYPE[raw.documentType];

  const total = printedAmount(raw.total);
  const amount = total.value !== null && total.value > 0 ? total.value : null;
  if (amount !== null) confidence.amount = total.confidence;
  if (total.mismatch) checks.push({ fields: ["amount"], level: "warn", text: `Okuma tutarsız (fişte “${clean(raw.total.text, 30) ?? ""}”); fişle karşılaştırın.` });

  // KDV: fişteki toplam KDV, yazılmamışsa oran satırlarının toplamı (bizim hesabımız)
  const lines = raw.vatLines.map((l) => printedAmount(l.amount)).filter((a) => a.value !== null);
  const linesSum = lines.length ? round2(lines.reduce((a, l) => a + l.value!, 0)) : null;
  const linesConfidence = lines.reduce<Confidence>((a, l) => lowest(a, l.confidence), "high");
  const vatTotal = raw.vatTotal.text === null ? null : printedAmount(raw.vatTotal);
  let vat: number | null = null;
  if (vatTotal?.value != null) {
    vat = vatTotal.value;
    confidence.vat = vatTotal.confidence;
    if (linesSum !== null && Math.abs(linesSum - vatTotal.value) >= 0.05) {
      checks.push({ fields: ["vat"], level: "warn", text: `KDV satırlarının toplamı ${money(linesSum)}, fişteki toplam KDV ${money(vatTotal.value)}.` });
    }
  } else if (linesSum !== null) {
    vat = linesSum;
    confidence.vat = linesConfidence;
  }
  if (vat !== null && amount !== null && vat > (amount * 20) / 120 + 0.5) {
    checks.push({ fields: ["vat"], level: "warn", text: "KDV, toplamın %20'sinden fazla görünüyor; kontrol edin." });
  }

  // Ad ve özet serbest metin: yanlışı zararsız, turuncu olmaz (tutarlar ve tarih olur)
  const store = tidyStore(clean(raw.store, 60));
  if (store) confidence.store = "high";
  const summary = clean(raw.itemSummary.toLocaleLowerCase("tr-TR"), 80);
  if (summary) confidence.summary = "high";
  const receiptDate = validDay(raw.date) ? raw.date : null;
  if (receiptDate) confidence.receiptDate = plain;
  const receiptNo = clean(raw.receiptNo, 40);

  // Kategori yalnız gönderilen listeden; değilse ilk alım (mal) kategorisi önerilir ve seçmesi istenir
  let categoryId = raw.categoryId !== null && ctx.categories.some((c) => c.id === raw.categoryId) ? raw.categoryId : null;
  if (categoryId !== null) confidence.categoryId = "high";
  else {
    categoryId = ctx.categories.find((c) => c.section === "mal")?.id ?? null;
    confidence.categoryId = "low";
    checks.push({ fields: ["categoryId"], level: "warn", text: "Kategori seçin." });
  }

  const paymentMethod: PaymentMethod | null = raw.paymentMethod === "cash" ? "nakit" : raw.paymentMethod === "card" ? "kart" : raw.paymentMethod === "other" ? "diger" : null;
  if (paymentMethod === "kart") checks.push({ fields: [], level: "warn", text: "Fiş kartla ödenmiş görünüyor. Para kasadan çıkmadıysa buraya eklemeyin." });

  // Fatura Paraşüt'ten de gelir: Aylık harcamalar'a ikinci kez yazılmasın (personele pencere ayrı söyler)
  const invoice = docType === "e_arsiv" || docType === "fatura";
  if (invoice && !ctx.staff) {
    checks.push({ fields: [], level: "info", text: `Bu bir ${docType === "e_arsiv" ? "e-Arşiv fatura" : "fatura"}. Paraşüt'e de gelecekse Aylık harcamalar'a eklemeyin.` });
  }

  if (amount === null) checks.push({ fields: ["amount"], level: "warn", text: "Toplam okunamadı; tutarı elle yazın." });
  else {
    const items = raw.items.map((i) => printedAmount(i.amount).value).filter((v): v is number => v !== null);
    if (items.length) {
      const sum = round2(items.reduce((a, v) => a + v, 0));
      if (Math.abs(sum - amount) > Math.max(1, amount * 0.01)) {
        checks.push({ fields: ["amount"], level: "warn", text: `Kalemlerin toplamı ${money(sum)}, fiş toplamı ${money(amount)}; toplamı fişle karşılaştırın.` });
      }
    }
    if (amount > LARGE_RECEIPT) checks.push({ fields: ["amount"], level: "warn", text: `Tutar alışılmadık büyük (${money(amount)}); fişle karşılaştırın.` });
  }

  if (receiptDate) {
    const ahead = dayDiff(ctx.day, receiptDate);
    if (ahead > 1) checks.push({ fields: ["receiptDate"], level: "warn", text: `Fişin tarihi ileri bir gün (${longDateTR(receiptDate)}).` });
    else if (ahead < -7) checks.push({ fields: ["receiptDate"], level: "warn", text: `Fişin tarihi ${longDateTR(receiptDate)}; ${-ahead} gün önce. Doğru fiş mi?` });
  }

  // Aynı fiş: tutar (±0,01), tarih (±1 gün) ve fiş no ya da mağaza adı tutuyor
  if (amount !== null) {
    const date = receiptDate ?? ctx.day;
    const dup = ctx.recent.find(
      (r) =>
        Math.abs(r.amount - amount) <= 0.01 &&
        Math.abs(dayDiff(r.date, date)) <= 1 &&
        ((receiptNo !== null && r.receiptNo !== null && r.receiptNo.trim() === receiptNo) || sameStore(r.store, store)),
    );
    if (dup) checks.push({ fields: ["amount"], level: "warn", text: `Bu fiş zaten eklenmiş olabilir: ${dup.store ?? store ?? "fiş"} · ${money(dup.amount)} · ${dateTR(dup.date)}.` });
  }

  // Fotoğrafın sorunları: görüntü sorunu güveni "high" olmayan alanları turuncu yapar
  const unsure = (Object.keys(confidence) as ReceiptField[]).filter((f) => confidence[f] !== "high" && f !== "categoryId");
  for (const issue of [...new Set(raw.issues)]) {
    if (issue === "not_a_document") continue;
    checks.push({ fields: IMAGE_ISSUES.includes(issue) ? unsure : [], level: "warn", text: ISSUE_TEXT[issue] });
  }

  return {
    ok: true,
    error: null,
    docType,
    values: { amount, receiptDate, store, summary, vat, receiptNo, paymentMethod, categoryId },
    confidence,
    checks: [...checks.filter((c) => c.level === "warn"), ...checks.filter((c) => c.level === "info")],
    toExpensesDefault: !invoice,
  };
}

/**
 * ai_calls.result'ta saklanan fiş okuması: satıcının vergi numarası düşer (şahıs şirketinde TC kimlik no olabilir;
 * hiçbir yerde kullanılmaz). Kalanı fotoğrafla birlikte silinir (src/server/storage/photos.ts).
 */
export function receiptToStore(raw: Receipt): Receipt {
  return { ...raw, storeTaxNo: null };
}

/** Harcamanın tarihi: fişin tarihi kasanın gününden en çok 3 gün önceyse o, değilse kasanın günü */
export function expenseDateFor(cashDay: string, receiptDate: string | null): string {
  if (!receiptDate || !validDay(receiptDate)) return cashDay;
  return receiptDate <= cashDay && receiptDate >= addDays(cashDay, -3) ? receiptDate : cashDay;
}
