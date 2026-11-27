import { z } from "zod";

import { businessDate, diffText } from "./cash-report";
import { cashOutShortLabel, type CashOutDocType, type CashOutKind } from "./cash-outs";
import { money } from "./format";
import { PHOTO_KIND_LABEL, RECEIPT_REQUEST_DAYS } from "./photo-rules";
import { addDays, dayMonthTR, longDateTR } from "./reminders";

/**
 * Kasadan çıkan istekleri ve fotoğraf kaldırma (saf; docs/KASA-RAPORU.md › Kasadan çıkan: kapanmış gün, yöneticinin
 * satırı; plan docs/planlar/personel-yetki.md §2.7). Kapanmış ya da eski bir güne yazılan kasadan çıkan beklenen nakdi
 * düşürür ve açığı örtebilir; yöneticinin kategorisindeki bir satır (maaş, avans) kârı değiştirir; Z ve POS fotoğrafı
 * kanıttır. Bunlar yöneticinin onayına gider: kapı kuralı, istek penceresi, yük (zod; her okumada yeniden çözülür),
 * personele giden görünüm, değişiklik satırları, yöneticinin kırmızı işaretleri ve metinler burada. Testler:
 * tests/kasa-istek.test.ts.
 */

/** Personelin kasadan çıkan isteği açabildiği pencere: bugün ile bu kadar gün öncesi (iş günüyle; fişin yükleme kuralıyla aynı) */
export const REQUEST_DAYS = RECEIPT_REQUEST_DAYS;
/** Kasadan çıkan isteğinin ömrü: süresi dolunca kapanır ("Süresi doldu"), fişi bırakılır */
export const CASH_OUT_REQUEST_DAYS = 14;

/** Gün istek penceresinde mi: iş günü ile 7 gün öncesi arası (ileri gün yok) */
export function requestDayAllowed(date: string, now: Date = new Date()): boolean {
  const day = businessDate(now);
  return date <= day && date >= addDays(day, -REQUEST_DAYS);
}

/** "Eski bir güne ekle"nin günleri: dünden önceki 6 gün (D−2 … D−7), en yeni önce */
export function oldRequestDays(now: Date = new Date()): string[] {
  const day = businessDate(now);
  const out: string[] = [];
  for (let i = 2; i <= REQUEST_DAYS; i++) out.push(addDays(day, -i));
  return out;
}

export type CashOutOp = "ekle" | "duzelt" | "sil";
export type CashOutGate = "direct" | "request" | "closed";

/** Kapının baktığı olgular (src/server/cash-outs/guard.ts staffCashOutGate toplar) */
export interface CashOutGateFacts {
  admin: boolean;
  /** Ekleme, düzeltme, silme ya da fotoğrafsız satıra fiş eklemek */
  op: CashOutOp | "fis";
  /** Personel bu günün kasasına doğrudan dokunabilir (staffDayOpen: bugün ve dün, ertesi günün raporu girilmediyse) */
  dayOpen: boolean;
  /** Gün personelin rapor penceresinde (bugün ya da dün; staffCanReport): kilitli dünün satırı istekle düzeltilir */
  canReport: boolean;
  /** Gün istek penceresinde (bugün ile D−7; requestDayAllowed) */
  inWindow: boolean;
  /** Satırın harcama kaydı yöneticinin kategorisinde (personelin seçemediği; staffExpenseLocked) */
  adminCategory: boolean;
  /**
   * Satır kilitli: yöneticinin bir kayda bağladığı satır (ör. tedarikçi ödemesi). Personel ne düzeltir ne silinmesini
   * ister; kural yalnız burada (kasadan çıkanın bütün personel yolları bu işlevden geçer)
   */
  rowLocked: boolean;
}

/**
 * Personelin kasadan çıkan değişikliği doğrudan mı yazılır, onaya mı gider, yoksa hiç mi olmaz. Yönetici her zaman
 * doğrudan. Kilitli satır personele kapalı. Ekleme: açık günde doğrudan, kapanmış ya da eski günde (pencere içinde)
 * istek. Fotoğrafsız satıra fiş eklemek: personelin gördüğü günde (bugün, dün) onaysız (yalnız kanıt ekler). Düzeltme ve
 * silme: yalnız bugün ve dün; gün kapandıysa (ertesi günün raporu girildi) ya da satırın harcama kaydı yöneticinin
 * kategorisindeyse istek.
 */
export function cashOutNeedsApproval(f: CashOutGateFacts): CashOutGate {
  if (f.admin) return "direct";
  if (f.op === "ekle") return f.dayOpen ? "direct" : f.inWindow ? "request" : "closed";
  if (f.rowLocked) return "closed";
  if (f.op === "fis") return f.canReport ? "direct" : "closed";
  if (!f.canReport) return "closed";
  if (!f.dayOpen || f.adminCategory) return "request";
  return "direct";
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** İstenen satır (eklemede yeni satır, düzeltmede satırın önerilen hâli) */
export const CashOutLineSchema = z.object({
  kind: z.enum(["harcama", "teslim"]),
  amount: z.number().finite().positive(),
  store: z.string().max(60).nullable(),
  description: z.string().max(200).nullable(),
  receiptDate: day.nullable(),
  receiptNo: z.string().max(40).nullable(),
  vat: z.number().finite().min(0).nullable(),
  docType: z.enum(["fis", "e_arsiv", "fatura", "yok"]),
  /** Personelin önerdiği kategori (eklemede; düzeltmede satırın şimdiki kategorisi). Yönetici onayda seçer */
  categoryId: z.number().int().positive().nullable(),
  photoId: z.number().int().positive().nullable(),
});
export type CashOutLineT = z.output<typeof CashOutLineSchema>;

/** Satırın istendiği andaki hâli (düzeltme ve silme): yöneticinin kartı "istekten sonra değişti"yi bununla bulur */
export const CashOutBeforeSchema = CashOutLineSchema.extend({
  updatedAt: z.string(),
  createdByName: z.string(),
  /** Bağlı harcama kaydı (kimlik, kategori, son değişiklik) */
  expense: z.object({ id: z.number().int().positive(), categoryId: z.number().int().positive(), updatedAt: z.string() }).nullable(),
});
export type CashOutBeforeT = z.output<typeof CashOutBeforeSchema>;

/**
 * `kasa-cikan` isteğinin yükü: işlem, gün, satır (ekleme ve düzeltme), satırın kimliği ve istendiği andaki hâli
 * (düzeltme ve silme). Önceki hâl ve kategori yalnız yöneticinin kartında okunur; personelin görünümü yalnız satırdan
 * (staffCashOutView).
 */
export const CashOutRequestPayload = z
  .object({
    op: z.enum(["ekle", "duzelt", "sil"]),
    day,
    cashOutId: z.number().int().positive().nullable(),
    line: CashOutLineSchema.nullable(),
    before: CashOutBeforeSchema.nullable(),
    /**
     * İsteği AÇAN personelin şubesi (docs/SUBE.md). Onay anındaki yönetici seçimi değil: yönetici "Tümü"den
     * onaylayınca Marina'nın kasa satırı ve onun harcama gölgesi Tuzla'ya inmesin. Bu alandan önce kaydedilmiş
     * isteklerde yok, bu yüzden isteğe bağlı: eskiler onay anındaki şubeye düşer (eski davranış).
     */
    branchId: z.string().max(24).nullish(),
  })
  .refine((p) => (p.op === "ekle" ? p.line !== null && p.cashOutId === null : p.cashOutId !== null && p.before !== null && (p.op === "sil" || p.line !== null)), "İsteğin yükü eksik");
export type CashOutRequestPayloadT = z.output<typeof CashOutRequestPayload>;

/** `foto-kaldir` isteğinin yükü: rapora bağlı ModPOS Z, yazarkasa (banka POS) Z'si ya da eski banka POS fotoğrafı */
export const PhotoRemovalPayload = z.object({
  photoId: z.number().int().positive(),
  photoKind: z.enum(["kasa-z", "kasa-pos", "kasa-okc"]),
  reportId: z.number().int().positive(),
  day,
});
export type PhotoRemovalPayloadT = z.output<typeof PhotoRemovalPayload>;
export type RemovablePhotoKind = PhotoRemovalPayloadT["photoKind"];

/**
 * Günün kasa kanıtı (G8; src/server/data/asilpos-day.ts kasaEvidence): ModPOS gününde ModPOS Z fotoğrafı, AsilPOS gününde
 * AsilPOS'un gün sonu ya da (gelmediyse) yazarkasa Z fotoğrafı
 */
export type KasaEvidence = "modpos-z" | "asilpos" | "okc-z";

/**
 * Fotoğrafın okunuşu rapordan farklıysa (net okunmuş alan, suspiciousDiffs) kaldırma kapalı mı: fotoğraf kanıttır. Otomatik
 * AsilPOS gününde personelin düğmesi ve isteği buna bakmaz (son denetim, 24 Kasım 2026): o fark fotoğraf ↔ AsilPOS
 * karşılaştırmasıdır, yalnız yöneticinin; düğmenin kaybolması personele farkı ele verirdi. Yöneticinin onayı yine bakar
 */
export function readingBlocksRemoval(o: { suspicious: number; staff: boolean; asilposAuto: boolean }): boolean {
  if (o.suspicious === 0) return false;
  return !(o.staff && o.asilposAuto);
}

/**
 * Fotoğrafın türü yüzünden kaldırılamaması (null: tür engel değil; okuma farkı ayrıca denetlenir): raporun tek ModPOS Z
 * fotoğrafı ve, yazarkasa bölümü yazılmışken, tek Banka POS Z (yazarkasa) fotoğrafı kanıttır (docs/planlar/okc-z.md
 * §16 S4: ModPOS Z'siyle aynı kural). Yazarkasa bölümü boşken o fotoğraf hiçbir rakamın kanıtı değildir, kaldırılabilir.
 * AsilPOS gününde (`evidence`, G8) ModPOS Z fotoğrafı kanıt değildir; AsilPOS'un gün sonu gelmediyse tek yazarkasa Z
 * fotoğrafı, bölüm yazılmamış olsa da, günün kanıtıdır.
 */
export function photoKindRefusal(kind: RemovablePhotoKind, o: { zCount: number; okcCount: number; okcFigures: boolean; evidence?: KasaEvidence }): string | null {
  const evidence = o.evidence ?? "modpos-z";
  if (kind === "kasa-z" && evidence === "modpos-z" && o.zCount <= 1) return CASH_OUT_REQUEST_TEXT.photoOnlyZ;
  if (kind === "kasa-okc" && (o.okcFigures || evidence === "okc-z") && o.okcCount <= 1) return CASH_OUT_REQUEST_TEXT.photoOnlyOkc;
  return null;
}

/** Personelin kendi isteğinin görünümü: işlem, gün ve satırın kendisi (kategori, önceki hâl ve gider kaydı yok) */
export interface StaffCashOutView {
  op: CashOutOp;
  day: string;
  line: { kind: CashOutKind; amount: number; store: string | null; description: string | null; docType: CashOutDocType; photo: boolean } | null;
}

export function staffCashOutView(p: CashOutRequestPayloadT): StaffCashOutView {
  const l = p.line;
  return {
    op: p.op,
    day: p.day,
    line: l ? { kind: l.kind, amount: l.amount, store: l.store, description: l.description, docType: l.docType, photo: l.photoId !== null } : null,
  };
}

/** Eylemlerin ve çekirdeğin metinleri (sunucuda kurulur, personele olduğu gibi gösterilir) */
export const CASH_OUT_REQUEST_TEXT = {
  adminDirect: "Yönetici doğrudan yapar; istek gerekmez",
  direct: "Bu değişikliği doğrudan kaydedebilirsiniz",
  closed: "Bu günün kasadan çıkanlarına artık yalnız yönetici dokunur",
  window: "Kasadan çıkan isteği bugün ile 7 gün öncesi arasına açılır; daha eskisi için yöneticiye yazın",
  rowGone: "Satır bulunamadı; silinmiş olabilir",
  noChange: "İstek satırı değiştirmiyor",
  category: "Bu kategoriye yalnız yönetici yazabilir",
  categoryChange: "Kategoriyi yönetici değiştirir; kategoriyi değiştirmeden gönderin",
  photo: "Fotoğraf bulunamadı ya da başka bir kayıtta; yeniden çekin",
  lockedDay: "Bu gün kapandı; ekleme ve düzeltme yönetici onayıyla.",
  adminLine: "Bu satır yöneticinin harcama kaydına bağlı; değişiklik ve silme yönetici onayıyla.",
  adminLineDirect: "Bu satır yöneticinin harcama kaydına bağlı; değişikliği ve silmeyi onaya gönderin",
  lockedDirect: "Bu gün kapandı; değişikliği onaya gönderin",
  receiptOnly: "Fiş yalnız fotoğrafsız alışveriş satırına eklenir",
  receiptDay: "Bu günün satırına fiş eklenemez",
  photoNotLinked: "Fotoğraf artık rapora bağlı değil; sayfayı yenileyin",
  photoOnlyZ: "Raporun tek Z fotoğrafı kaldırılamaz",
  photoOnlyOkc: "Raporun tek Banka POS Z fotoğrafı kaldırılamaz: yazarkasa rakamlarının kanıtı",
  photoDiffs: "Fotoğraftan farklı yazılan alan var; fotoğraf kanıttır, kaldırılamaz. Yöneticiye yazın",
  photoDay: "Bu günün fotoğrafına artık yalnız yönetici dokunur",
  changed: "Satır istekten sonra değişti; yeniden bakın ya da yine de uygulayın",
  receiptMissing: "Fiş fotoğrafı olmayan satır fişli onaylanamaz",
  needsApproval: "Bu değişiklik yöneticinin onayıyla olur; onaya gönderin",
  rowLocked: "Bu satır yöneticinin bir kaydına bağlı; yalnız yönetici değiştirir",
  /**
   * Müdür ("admin" düzeyinde, `kategori.tum` yok; docs/ROLLER.md › Kararlar): yöneticinin kategorisindeki (maaş, kira
   * gibi) satırı düzeltemez, taşıyamaz, silemez; o satırın isteğine de karar vermez
   */
  ownerRow: "Bu satır yöneticinin kategorisindeki bir harcama kaydına bağlı; düzeltmesini ve silinmesini yönetici yapar",
  ownerReview: "Bu satır yöneticinin kategorisindeki bir harcama kaydına bağlı; isteğe yönetici karar verir",
} as const;

export const CASH_OUT_OP_LABEL: Record<CashOutOp, string> = { ekle: "ekleme", duzelt: "düzeltme", sil: "silme" };

/** İsteğin başlığı (tutarsız, kişisel veri yok): "21 Ekim kasadan çıkan ekleme" */
export const cashOutRequestTitle = (op: CashOutOp, date: string) => `${dayMonthTR(date)} kasadan çıkan ${CASH_OUT_OP_LABEL[op]}`;
/** "21 Ekim Z raporu fotoğrafı kaldırma" */
export const photoRemovalTitle = (kind: RemovablePhotoKind, date: string) => `${dayMonthTR(date)} ${PHOTO_KIND_LABEL[kind]} fotoğrafı kaldırma`;
/** Yöneticinin kartı: "Kasadan çıkan ekleme · 21 Ekim Salı" */
export const cashOutCardTitle = (op: CashOutOp, date: string) => `Kasadan çıkan ${CASH_OUT_OP_LABEL[op]} · ${longDateTR(date)}`;
/** "Fotoğraf kaldırma · Z raporu · 21 Ekim Salı" */
export const photoCardTitle = (kind: RemovablePhotoKind, date: string) => `Fotoğraf kaldırma · ${PHOTO_KIND_LABEL[kind]} · ${longDateTR(date)}`;

/** Satırın kısa adı ve tutarı: "Migros · 412,50 ₺" (bildirim, işlem geçmişi) */
export function lineText(l: Pick<CashOutLineT, "kind" | "amount" | "store" | "description">): string {
  return `${cashOutShortLabel(l)} · ${money(l.amount)}`;
}

const KIND_WORD: Record<CashOutKind, string> = { harcama: "alışveriş", teslim: "teslim" };
const DOC_WORD: Record<CashOutDocType, string> = { fis: "fiş", e_arsiv: "e-Arşiv", fatura: "fatura", yok: "belgesiz" };
const shown = (v: string | null) => (v?.trim() ? v.trim() : "—");

/** Önerinin satırın önceki hâline göre değişiklikleri: "Tutar: 400 ₺ → 412,50 ₺" (yoksa boş) */
export function lineChanges(before: CashOutLineT, after: CashOutLineT): string[] {
  const out: string[] = [];
  if (before.kind !== after.kind) out.push(`Ne için: ${KIND_WORD[before.kind]} → ${KIND_WORD[after.kind]}`);
  if (Math.abs(before.amount - after.amount) >= 0.005) out.push(`Tutar: ${money(before.amount)} → ${money(after.amount)}`);
  if (shown(before.store) !== shown(after.store)) out.push(`${after.kind === "teslim" ? "Kime" : "Yer"}: ${shown(before.store)} → ${shown(after.store)}`);
  if (shown(before.description) !== shown(after.description)) out.push(`${after.kind === "teslim" ? "Açıklama" : "Ne alındı"}: ${shown(before.description)} → ${shown(after.description)}`);
  if ((before.receiptDate ?? null) !== (after.receiptDate ?? null)) out.push(`Fiş tarihi: ${before.receiptDate ? dayMonthTR(before.receiptDate) : "—"} → ${after.receiptDate ? dayMonthTR(after.receiptDate) : "—"}`);
  if (Math.abs((before.vat ?? 0) - (after.vat ?? 0)) >= 0.005 || (before.vat === null) !== (after.vat === null)) {
    out.push(`KDV: ${before.vat === null ? "—" : money(before.vat)} → ${after.vat === null ? "—" : money(after.vat)}`);
  }
  if (before.docType !== after.docType) out.push(`Belge: ${DOC_WORD[before.docType]} → ${DOC_WORD[after.docType]}`);
  if ((before.photoId ?? null) !== (after.photoId ?? null)) out.push(after.photoId ? "Fiş fotoğrafı eklendi" : "Fiş fotoğrafı kaldırıldı");
  return out;
}

/**
 * Satır istekten sonra değişti mi (yöneticinin kartında amber uyarı, onayda "Yine de uygula"): satırın alanları,
 * fotoğrafı, son değişikliği ya da bağlı harcama kaydı (kimlik, kategori, son değişiklik). Satır yoksa (silindi) evet.
 */
export function cashOutChanged(
  before: CashOutBeforeT,
  now: { row: Omit<CashOutLineT, "categoryId"> & { updatedAt: string }; expense: { id: number; categoryId: number; updatedAt: string } | null } | null,
): boolean {
  if (!now) return true;
  const r = now.row;
  if (r.updatedAt !== before.updatedAt) return true;
  if (lineChanges(before, { ...r, categoryId: before.categoryId }).length) return true;
  const a = before.expense;
  const b = now.expense;
  if ((a === null) !== (b === null)) return true;
  return Boolean(a && b && (a.id !== b.id || a.categoryId !== b.categoryId || a.updatedAt !== b.updatedAt));
}

/**
 * Yöneticinin kartındaki kırmızı işaretler: tutar günün kasa açığına eşit (±1 ₺; açığı örtebilir), kapanmış güne teslim
 * ya da fişsiz çıkış ekleniyor. Silmede işaret yok.
 */
export function cashOutFlags(o: { op: CashOutOp; line: Pick<CashOutLineT, "kind" | "amount" | "photoId"> | null; dayClosed: boolean; reportDiff: number | null }): string[] {
  const l = o.line;
  if (o.op === "sil" || !l) return [];
  const out: string[] = [];
  if (o.reportDiff !== null && o.reportDiff < 0 && Math.abs(l.amount - Math.abs(o.reportDiff)) <= 1) out.push(`Tutar günün kasa açığıyla aynı (${diffText(o.reportDiff)})`);
  if (o.dayClosed && o.op === "ekle") {
    if (l.kind === "teslim") out.push("Kapanmış güne teslim ekleniyor");
    else if (l.photoId === null) out.push("Kapanmış güne fişsiz çıkış ekleniyor");
  }
  return out;
}

/** İşlem geçmişinde personelin isteği: "21 Ekim Salı · ekleme · Migros · 412,50 ₺ · <not>" */
export function cashOutRequestLog(o: { op: CashOutOp; day: string; line: CashOutLineT | null; before: CashOutLineT | null; note: string | null }): string {
  const l = o.line ?? o.before;
  return [longDateTR(o.day), CASH_OUT_OP_LABEL[o.op], l ? lineText(l) : null, o.note?.trim() ? o.note.trim().slice(0, 200) : null].filter(Boolean).join(" · ");
}
