import { z } from "zod";

import {
  changeLine,
  changesText,
  computeCash,
  diffText,
  revisionChanges,
  staffCanReport,
  staffLateDay,
  type CashReportFields,
  type CashRevisionData,
  type FieldChange,
  type LateCashPayload,
} from "./cash-report";
import { DEFAULT_BRANCH_ID } from "./branches";
import { closedBellTitle } from "./closed-days";
import { money } from "./format";
import { OKC_KNOWN_RATES, sameVat, type OkcVatLine } from "./okc-z";
import { MAX_REPORT_PHOTOS } from "./photo-rules";
import { dayLocativeTR, dayMonthTR, daysBetween, longDateTR, monthShortTR, todayTR } from "./reminders";

/**
 * Personelin kasa raporu istekleri (saf; docs/KASA-RAPORU.md › Sonradan düzeltme ve silme isteği; plan
 * docs/planlar/personel-yetki.md §2.3): isteğin yükü (zod; her okumada yeniden çözülür, raporun alanları dışında anahtar
 * taşımaz), önerinin rapora birleştirilmesi, değişiklik ve sonuç satırları, başlık, zil ve işlem geçmişi metinleri.
 * Kapı kuralı src/lib/cash-report.ts staffCashGate. Testler: tests/kasa-duzeltme-istegi.test.ts.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const amount = z.number().finite();

/**
 * Yazarkasanın KDV dökümü (kayıtlı biçim; docs/planlar/okc-z.md §7): oran %0, %1, %8, %10, %18 ya da %20, toplam ve KDV
 * eksi değil, KDV toplamdan büyük değil, oran tekrarsız
 */
export const OkcVatSchema = z
  .array(
    z
      .object({
        rate: z.number().refine((r) => OKC_KNOWN_RATES.includes(r), "KDV oranı %0, %1, %8, %10, %18 ya da %20 olmalı"),
        total: amount.min(0, "Tutar eksi olamaz"),
        vat: amount.min(0, "Tutar eksi olamaz"),
      })
      .refine((l) => l.vat <= l.total + 0.005, { message: "KDV toplamından büyük olamaz" }),
  )
  .max(OKC_KNOWN_RATES.length)
  .refine((ls) => new Set(ls.map((l) => l.rate)).size === ls.length, "Aynı KDV oranı iki kez yazılmış") satisfies z.ZodType<OkcVatLine[], unknown>;

/**
 * Raporun formu (gün hariç); bilinmeyen anahtarlar düşer. Yazarkasa alanları isteğe bağlı (`optional`): veritabanında
 * bekleyen eski istekler ve kopyalar bu anahtarları taşımaz; eksik anahtar "önerilmedi" demektir (mergeProposal)
 */
const CashFieldsSchema = z.object({
  zNo: z.string().max(30).nullable(),
  receipts: z.number().int().min(0).nullable(),
  zTotal: amount,
  cash: amount,
  card: amount,
  mealCard: amount,
  online: amount,
  other: amount,
  openingCash: amount,
  /** Sonradan geldi: önceki yüklerde yok, 0 sayılır */
  cashIn: amount.default(0),
  cashOut: amount,
  cashOutNote: z.string().max(200).nullable(),
  countedCash: amount,
  handedOver: amount,
  bankPos: amount.nullable(),
  offRevenue: amount.nullable(),
  discounts: amount.nullish().transform((v) => v ?? null),
  note: z.string().max(1000).nullable(),
  okcZNo: z.string().max(30).nullable().optional(),
  okcReceipts: z.number().int().min(0).nullable().optional(),
  okcTotal: amount.nullable().optional(),
  okcVatTotal: amount.nullable().optional(),
  okcVat: OkcVatSchema.nullable().optional(),
  okcCash: amount.nullable().optional(),
  okcCard: amount.nullable().optional(),
  okcMealCard: amount.nullable().optional(),
  okcOther: amount.nullable().optional(),
});

/** Bir sürümün kopyası (cash_report_revisions.data ile aynı alanlar) */
export const CashRevisionDataSchema = CashFieldsSchema.extend({ date: day, cashDiff: amount, countedByName: z.string().nullable() });

/** Önerilen alanlar: raporun formu (gün hariç) ve sayan */
export const ProposedSchema = CashFieldsSchema.extend({ countedBy: z.number().int().positive(), countedByName: z.string().min(1).max(200) });
export type ProposedFields = Omit<CashReportFields, "date"> & { countedBy: number; countedByName: string };

/**
 * Kasa günü isteklerinin konusu (düzeltme, silme, geç rapor): şubenin günü. Kasa şube başınadır; konu yalnız gün
 * olsaydı Tuzla'nın düzeltmesi onaylanınca Marina'nın aynı gündeki bekleyen önerisi de "başka bir istekle düzeltildi"
 * diye kapanırdı. Varsayılan şubenin (Tuzla) konusu eskisi gibi `gun:YYYY-AA-GG` (şubelerden önceki istekler de bu),
 * öteki şubeninki `gun:YYYY-AA-GG:şube`.
 */
export function cashDaySubject(date: string, branchId: string): string {
  return branchId === DEFAULT_BRANCH_ID ? `gun:${date}` : `gun:${date}:${branchId}`;
}

/** Kasa günü konusunun şubesi (cashDaySubject'in tersi; şubesiz eski konu Tuzla) */
export function cashSubjectBranch(subject: string): string {
  const m = /^gun:\d{4}-\d{2}-\d{2}:(.+)$/.exec(subject);
  return m ? m[1] : DEFAULT_BRANCH_ID;
}

/** Geç rapor isteğinin kasası: yükteki şube, yoksa (şubelerden önceki istek) Tuzla */
export function lateBranchOf(p: Pick<LatePayloadT, "branchId">): string {
  return p.branchId ?? DEFAULT_BRANCH_ID;
}

/**
 * `kasa-duzeltme` isteğinin yükü: önerinin dayandığı sürüm (`base`, `baseRevision`, `baseCountedBy`) ve önerilen
 * alanlar. `gate`: "kilitli" ertesi günün raporu girilmişti, "gec" iş günü kapandıktan sonra kasa alanı ya da sayan.
 */
export const CorrectionPayload = z.object({
  date: day,
  reportId: z.number().int().positive(),
  baseRevision: z.number().int().min(1),
  base: CashRevisionDataSchema,
  baseCountedBy: z.number().int().positive().nullable(),
  proposed: ProposedSchema,
  gate: z.enum(["kilitli", "gec"]),
});
export type CorrectionPayloadT = z.output<typeof CorrectionPayload>;

/** `kasa-silme` isteğinin yükü: istendiği andaki rapor ve fotoğraf sayısı */
export const DeletePayload = z.object({
  date: day,
  reportId: z.number().int().positive(),
  baseRevision: z.number().int().min(1),
  snapshot: CashRevisionDataSchema,
  photos: z.number().int().min(0),
});
export type DeletePayloadT = z.output<typeof DeletePayload>;

/**
 * `kasa-gec` isteğinin yükü (geç kasa raporu; src/lib/cash-report.ts LateCashPayload): raporun alanları (Z no zorunlu),
 * teslim alan (etkin bir kullanıcı ya da banka), istekte tutulan fotoğraflar (en az bir Z) ve isteyenin gördüğü kasa
 * farkı. Kasayı sayan isteyendir.
 */
export const LatePayload = CashFieldsSchema.extend({
  date: day,
  zNo: z.string().trim().min(1).max(30),
  handedTo: z
    .discriminatedUnion("kind", [z.object({ kind: z.literal("user"), id: z.number().int().positive(), name: z.string().min(1).max(200) }), z.object({ kind: z.literal("banka") })])
    .nullable(),
  // Kanıt günün kasasına göre yazımda denetlenir (src/server/cash/late.ts, kasaEvidence): ModPOS gününde Z fotoğrafı,
  // AsilPOS gününde AsilPOS'un gün sonu (fotoğrafsız) ya da yazarkasa Z fotoğrafı
  photos: z.array(z.object({ id: z.number().int().positive(), kind: z.enum(["kasa-z", "kasa-pos", "kasa-okc"]) })).max(MAX_REPORT_PHOTOS),
  cashDiff: amount,
  /**
   * İsteği AÇAN personelin kasası (docs/SUBE.md › Kasa raporu): onay anındaki yönetici seçimi değil, yoksa yönetici
   * "Tümü"den onaylayınca Marina'nın geç raporu Tuzla'ya yazılırdı. Bu alandan önceki isteklerde yok: Tuzla sayılır.
   */
  branchId: z.string().max(24).nullish(),
}) satisfies z.ZodType<LateCashPayload, unknown>;
export type LatePayloadT = z.output<typeof LatePayload>;

/** Geç raporun alanları (yükten; teslim alan, fotoğraflar ve kasa farkı hariç) */
export function lateFields(p: LatePayloadT): CashReportFields {
  const { handedTo: _to, photos: _photos, cashDiff: _diff, branchId: _branch, ...fields } = p;
  void _to;
  void _photos;
  void _diff;
  void _branch;
  return { ...fields, discounts: fields.discounts ?? null };
}

/** "Mehmet'e", "bankaya" (teslim alan; yöneticinin kartı) */
export function handedToText(h: LatePayloadT["handedTo"]): string | null {
  if (!h) return null;
  return h.kind === "banka" ? "bankaya" : h.name;
}

/** Eylemlerin ve çekirdeğin metinleri (sunucuda kurulur, personele olduğu gibi gösterilir) */
export const CASH_REQUEST_TEXT = {
  adminDirect: "Yönetici raporu doğrudan düzeltir",
  direct: "Bu değişikliği doğrudan kaydedebilirsiniz",
  closed: "Bu günün raporunu artık yalnız yönetici düzeltir",
  stale: "Rapor bu arada değişti; sayfayı yenileyin",
  noReport: "Bu günün raporu yok; sayfayı yenileyin",
  noChange: "Öneri raporu değiştirmiyor",
  deletePending: "Silme isteğiniz bekliyor; önce geri çekin",
  reviewStale: "Rapor siz bakarken değişti; yeniden bakın",
  nothingToApply: "Rapor zaten bu hâlde; isteği kapatın",
  lateWindow: "Bu gün geç rapor penceresinde değil: dünden eski son 14 gün girilir; daha eskisi için yöneticiye yazın",
  lateReported: "Bu günün raporu girilmiş; sayfayı yenileyin",
  lateBeforeFirst: "Kasa raporları bu günden sonra başladı; bu gün girilmez",
  lateClosed: "Bu gün kafe kapalı işaretli; açıksa yöneticiye yazın",
  lateTwice: "Bu gün için iki isteğiniz kapandı; bu günü yöneticiye yazın",
  lateStale: "İsteğiniz bu arada değişti ya da karara bağlandı; sayfayı yenileyin",
  lateZPhoto: "Z raporunun fotoğrafını ekleyin",
  lateOkcPhoto: "AsilPOS'un bu günün sonu gelmedi: yazarkasa (Banka POS) Z raporunun fotoğrafını ekleyin",
  /** Gün sonu tam: AsilPOS gününün gün sonu geldi; rapor AsilPOS'tan yazılır, personel yalnız fotoğraf ekler */
  lateAsilpos: "AsilPOS'un bu günün sonu geldi: rapor AsilPOS'tan yazılır. Kasa raporu sayfasında yalnız gün sonu fotoğrafını ekleyin",
  latePhoto: "Fotoğraf bulunamadı ya da başka bir kayıtta; yeniden çekin",
  lateHandedTo: "Teslim edileni kimin aldığını seçin",
  lateExists: "Bu günün raporu artık var; isteği reddedin",
  lateHandover: "Teslimi aldığınızı ya da bankada gördüğünüzü işaretleyin",
} as const;

const FIELD_KEYS = [
  "zNo",
  "receipts",
  "zTotal",
  "cash",
  "card",
  "mealCard",
  "online",
  "other",
  "openingCash",
  "cashIn",
  "cashOut",
  "cashOutNote",
  "countedCash",
  "handedOver",
  "bankPos",
  "offRevenue",
  "discounts",
  "note",
  "okcZNo",
  "okcReceipts",
  "okcTotal",
  "okcVatTotal",
  "okcVat",
  "okcCash",
  "okcCard",
  "okcMealCard",
  "okcOther",
] as const satisfies readonly (keyof CashReportFields)[];
type FieldKey = (typeof FIELD_KEYS)[number];
const TEXT_KEYS: readonly FieldKey[] = ["zNo", "okcZNo", "cashOutNote", "note"];

/**
 * İki değer aynı mı: metin kırpılarak, tutar 0,005 hassasiyetle, boş yalnız boşla; KDV dökümü sıralı ve kuruşa yuvarlı
 * (sameVat: dizi sayı gibi karşılaştırılırsa NaN verir ve öneri hep "değişti" görünürdü)
 */
function same(k: FieldKey, a: unknown, b: unknown): boolean {
  if (k === "okcVat") return sameVat(a as OkcVatLine[] | null | undefined, b as OkcVatLine[] | null | undefined);
  if (TEXT_KEYS.includes(k)) return String(a ?? "").trim() === String(b ?? "").trim();
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  return Math.abs(Number(a) - Number(b)) < 0.005;
}

/** Önerilen alanların sürüm kopyası biçimi (karşılaştırma için) */
export function proposedData(date: string, p: ProposedFields): CashRevisionData {
  const { countedBy: _counter, ...rest } = p;
  void _counter;
  return { ...rest, discounts: rest.discounts ?? null, date, cashDiff: computeCash(rest).cashDiff };
}

/**
 * Önerinin rapora uygulanması: yalnız önerinin tabandan değiştirdiği alanlar raporun şimdiki hâline yazılır; arada
 * yöneticinin düzelttiği öteki alanlar korunur. Sayan da aynı kurala bağlıdır (`base.countedBy` ile): önerinin sayanı
 * tabanla aynıysa şimdiki sayan kalır. Öneride hiç olmayan yazarkasa alanı (yazarkasa bölümünden önceki istek)
 * önerilmemiş sayılır: şimdiki değer kalır.
 */
export function mergeProposal(
  current: { data: CashRevisionData; countedBy: number | null },
  base: { data: CashRevisionData; countedBy: number | null },
  proposed: ProposedFields,
): { fields: CashReportFields; countedBy: number | null; countedByName: string | null } {
  const picked = Object.fromEntries(FIELD_KEYS.map((k) => [k, proposed[k] === undefined || same(k, base.data[k], proposed[k]) ? (current.data[k] ?? null) : (proposed[k] ?? null)]));
  const fields = { ...(picked as Omit<CashReportFields, "date">), date: current.data.date };
  const counterChanged = base.countedBy !== proposed.countedBy;
  return {
    fields,
    countedBy: counterChanged ? proposed.countedBy : current.countedBy,
    countedByName: counterChanged ? proposed.countedByName : current.data.countedByName,
  };
}

/** Önerinin tabana göre değişiklikleri (yoksa boş: eylem reddeder) */
export function proposalChanges(base: CashRevisionData, proposed: ProposedFields): FieldChange[] {
  return revisionChanges(base, proposedData(base.date, proposed));
}

/** Ertesi güne devir */
const carryOf = (f: Pick<CashReportFields, "countedCash" | "handedOver">) => Math.round((f.countedCash - f.handedOver) * 100) / 100;

/**
 * Önerinin özeti (personelin bekleyen şeridi ve yöneticinin kartı): değişen satırlar ("Teslim edilen: 2.400 ₺ → 2.040 ₺"),
 * kasa farkı değiştiyse sonuç ("Kasa farkı: 120 ₺ eksik → Kasa tutuyor"), devir değiştiyse devir satırı
 */
export function proposalSummary(before: CashRevisionData, proposed: ProposedFields): { changes: FieldChange[]; lines: string[]; result: string | null; carry: string | null } {
  const after = proposedData(before.date, proposed);
  const changes = revisionChanges(before, after);
  return { changes, lines: changes.map((c) => changeLine(c)), ...resultLines(before, after) };
}

/** İki hâlin kasa farkı ve devir satırları (değişmediyse null) */
export function resultLines(before: CashReportFields, after: CashReportFields): { result: string | null; carry: string | null } {
  const a = computeCash(before).cashDiff;
  const b = computeCash(after).cashDiff;
  const ca = carryOf(before);
  const cb = carryOf(after);
  return {
    result: Math.abs(a - b) >= 0.005 ? `Kasa farkı: ${diffText(a)} → ${diffText(b)}` : null,
    carry: Math.abs(ca - cb) >= 0.005 ? `Ertesi güne devir: ${money(ca)} → ${money(cb)}` : null,
  };
}

/** Alanın ekrandaki değeri (yöneticinin üç sütunu): tutar, metin ya da "—" */
export function fieldValue(key: FieldChange["key"], d: Partial<CashRevisionData>): string {
  if (key === "okcVat") {
    // "%10 8.110 ₺ · KDV 737,27 ₺; %20 1.240 ₺ · KDV 206,67 ₺"
    const lines = d.okcVat ?? [];
    return lines.length ? lines.map((l) => `%${l.rate} ${money(l.total)} · KDV ${money(l.vat)}`).join("; ") : "—";
  }
  const v = d[key] ?? null;
  if (v === null || v === "") return "—";
  if (key === "zNo" || key === "receipts" || key === "okcZNo" || key === "okcReceipts" || key === "countedByName") return String(v);
  if (key === "note" || key === "cashOutNote") return clip(String(v).trim(), 60);
  return money(Number(v));
}

/** Kasa farkının kısa hâli ("120 ₺ eksik", "tutuyor") */
const diffShort = (d: number) => diffText(d).replace("Kasa tutuyor", "tutuyor");

/** Metnin ilk `max` karakteri (fazlası "…") */
export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** İsteğin başlığı (tutarsız, kişisel veri yok): "22 Ekim kasa düzeltmesi" */
export const correctionTitle = (date: string) => `${dayMonthTR(date)} kasa düzeltmesi`;
/** "22 Ekim kasa raporu silme" */
export const deleteTitle = (date: string) => `${dayMonthTR(date)} kasa raporu silme`;

/**
 * Yöneticinin zil satırı: "22 Ekim kasa raporu: düzeltme önerisi", gövde "Mehmet · Teslim edilen 2.400 ₺ → 2.040 ₺ ·
 * kasa farkı 120 ₺ eksik → tutuyor" (önce kasa alanları, en çok iki değişiklik)
 */
export function correctionBell(o: { date: string; by: string; changes: readonly FieldChange[]; before: number; after: number }): { title: string; body: string } {
  const sorted = [...o.changes].sort((a, b) => Number(b.sensitive) - Number(a.sensitive));
  const shown = sorted.slice(0, 2).map((c) => changeLine(c, false));
  const more = sorted.length - shown.length;
  const diff = Math.abs(o.before - o.after) >= 0.005 ? `kasa farkı ${diffShort(o.before)} → ${diffShort(o.after)}` : null;
  return {
    title: `${dayMonthTR(o.date)} kasa raporu: düzeltme önerisi`,
    body: [o.by, ...shown, more > 0 ? `ve ${more} alan daha` : null, diff].filter(Boolean).join(" · "),
  };
}

/** Yöneticinin zil satırı: "22 Ekim kasa raporunun silinmesi istendi", gövde "Mehmet: <nedenin ilk 80 karakteri>" */
export function deleteBell(o: { date: string; by: string; reason: string | null }): { title: string; body: string } {
  return { title: `${dayMonthTR(o.date)} kasa raporunun silinmesi istendi`, body: o.reason ? `${o.by}: ${clip(o.reason.trim(), 80)}` : o.by };
}

// Ay adının belirtme hâli: "13 Ekim'i" (ünlü uyumu ay ay sabit)
const MONTHS_ACC_TR = ["Ocak'ı", "Şubat'ı", "Mart'ı", "Nisan'ı", "Mayıs'ı", "Haziran'ı", "Temmuz'u", "Ağustos'u", "Eylül'ü", "Ekim'i", "Kasım'ı", "Aralık'ı"];

/** "Önce 13 Ekim'i karara bağlayın" (daha eski bir bekleyen geç rapor varken onay kapalı) */
export function olderFirstText(date: string): string {
  return `Önce ${Number(date.slice(8, 10))}\u00a0${MONTHS_ACC_TR[Number(date.slice(5, 7)) - 1]} karara bağlayın`;
}

// Haftanın günlerinin kısa adı (pazar 0): Pazar ile Pazartesi, Cuma ile Cumartesi karışmasın
const WEEKDAY_SHORT_TR = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"] as const;

/** Gün çipi: "14 Eki Çar" (girilmemiş günler, geç raporun sayfası) */
export function shortDayTR(date: string): string {
  const weekday = WEEKDAY_SHORT_TR[new Date(`${date}T12:00:00Z`).getUTCDay()];
  return `${Number(date.slice(8, 10))} ${monthShortTR(date)} ${weekday}`;
}

/** Geç raporun başlığı (tutarsız): "14 Ekim geç kasa raporu" */
export const lateTitle = (date: string) => `${dayMonthTR(date)} geç kasa raporu`;

/** Yöneticinin zil satırı: "Geç kasa raporu onay bekliyor", gövde "14 Ekim Salı · Ayşe · Z 12.400 ₺ · 120 ₺ eksik" */
export function lateBell(o: { date: string; by: string; zTotal: number; cashDiff: number }): { title: string; body: string } {
  return { title: "Geç kasa raporu onay bekliyor", body: [longDateTR(o.date), o.by, `Z ${money(o.zTotal)}`, diffText(o.cashDiff)].join(" · ") };
}

/** Kaç gün sonra girildi: "7 gün sonra" (rapor günü ile isteğin günü arası, takvim) */
export function lateByText(date: string, at: Date): string {
  return `${daysBetween(date, todayTR(at))} gün sonra`;
}

/** İşlem geçmişinde geç rapor: "14 Ekim Salı · Z 12.400 ₺ · 120 ₺ eksik · <neden>" */
export function lateLog(o: { date: string; zTotal: number; cashDiff: number; reason: string | null }): string {
  return [longDateTR(o.date), `Z ${money(o.zTotal)}`, diffText(o.cashDiff), reasonLog(o.reason) || null].filter(Boolean).join(" · ");
}

/** E-postanın satırı: "Geç rapor · Ayşe 21 Ekim'de girdi, Mehmet onayladı" ("düzeltip onayladı") */
export function lateApprovalLine(o: { requester: string; requestedAt: Date; approver: string; corrected: boolean }): string {
  return `Geç rapor · ${o.requester} ${dayLocativeTR(todayTR(o.requestedAt))} girdi, ${o.approver} ${o.corrected ? "düzeltip onayladı" : "onayladı"}`;
}

/** Personelin kasa isteklerinin türleri (zil ve İsteklerim) */
export type CashRequestKind = "kasa-duzeltme" | "kasa-silme" | "kasa-gec" | "kasa-cikan" | "foto-kaldir" | "kapali-gun";

/** Başlığı gün ve türden kurulan istekler (öteki türlerde başlık isteğin kendi başlığıdır) */
type DayHeadKind = "kasa-duzeltme" | "kasa-silme" | "kasa-gec";
const RESULT_HEAD: Record<DayHeadKind, (d: string) => string> = {
  "kasa-duzeltme": (d) => `${d} kasa düzeltmeniz`,
  "kasa-silme": (d) => `${d} kasa raporunun silinmesi`,
  "kasa-gec": (d) => `${d} kasa raporu`,
};
const RESULT_BODY: Record<CashRequestKind, { approved: string; rejected: string }> = {
  "kasa-duzeltme": { approved: "Rapor güncellendi", rejected: "Rapor değişmedi" },
  "kasa-silme": { approved: "Rapor silindi", rejected: "Rapor yerinde kaldı" },
  "kasa-gec": { approved: "Rapor kayda geçti", rejected: "Rapor kaydedilmedi" },
  "kasa-cikan": { approved: "Kasaya işlendi", rejected: "Kasa değişmedi" },
  "foto-kaldir": { approved: "Fotoğraf rapordan çıkarıldı", rejected: "Fotoğraf yerinde kaldı" },
  "kapali-gun": { approved: "Eksik rapor ve liste uyarıları kalktı", rejected: "Raporu girin" },
};

/**
 * Personelin zilinde isteğin sonucu: "22 Ekim kasa düzeltmeniz onaylandı" / "… reddedildi" / "… kapandı" / "… süresi
 * doldu"; kasadan çıkan ve fotoğraf kaldırmada isteğin başlığıyla ("21 Ekim kasadan çıkan ekleme isteğiniz
 * onaylandı"). Gövde yöneticinin notu ("Yönetici: …") ya da sonucun kendisi ("Rapor güncellendi", "Kasaya işlendi").
 * Kapanan istekte not sistemin nedenidir ("Rapor başka bir istekle düzeltildi").
 */
export function staffResultBell(o: {
  kind: CashRequestKind;
  status: "approved" | "rejected" | "superseded" | "expired" | "revoked";
  day: string;
  note: string | null;
  /** İsteğin başlığı (kasadan çıkan ve fotoğraf kaldırmada başlık bundan) */
  title?: string;
}): { title: string; body: string } {
  // Kapalı gün: "23 Eki Per: kapalı gün onaylandı / reddedildi / geri alındı"
  if (o.kind === "kapali-gun") {
    const title = closedBellTitle(shortDayTR(o.day), o.status);
    if (o.status === "approved" || o.status === "rejected") return { title, body: o.note ? `Yönetici: ${o.note}` : RESULT_BODY[o.kind][o.status] };
    return { title, body: o.note ?? (o.status === "revoked" ? "Kapalı işareti kalktı; raporu girin" : RESULT_BODY[o.kind].rejected) };
  }
  if (o.status === "revoked") return { title: `${o.title ?? dayMonthTR(o.day)} geri alındı`, body: o.note ?? "" };
  const verb = { approved: "onaylandı", rejected: "reddedildi", superseded: "kapandı", expired: "süresi doldu" }[o.status];
  let title: string;
  if (o.kind === "kasa-cikan" || o.kind === "foto-kaldir") {
    const head = o.title ?? dayMonthTR(o.day);
    title = o.status === "expired" ? `${head} isteğinizin süresi doldu` : `${head} isteğiniz ${verb}`;
  } else {
    const head = RESULT_HEAD[o.kind](dayMonthTR(o.day));
    title = o.status === "superseded" && o.kind !== "kasa-duzeltme" ? `${head} isteğiniz kapandı` : o.status === "expired" ? `${head} isteğinizin süresi doldu` : `${head} ${verb}`;
  }
  if (o.status === "superseded" || o.status === "expired") return { title, body: o.note ?? RESULT_BODY[o.kind].rejected };
  return { title, body: o.note ? `Yönetici: ${o.note}` : RESULT_BODY[o.kind][o.status] };
}

/** Reddedilen ya da kaldırılan kapalı gün bildiriminden sonra raporun yolu, gün personelde değilse (personelin zili) */
export const CLOSED_FOLLOW_UP_TEXT = {
  late: "Kafe açıktıysa raporu Z fotoğrafıyla geç rapor olarak girin; yönetici onaylar.",
  admin: "Raporu yönetici girecek; Z raporunu yöneticiye iletin.",
} as const;

/**
 * Reddedilen ya da kaldırılan kapalı gün bildiriminden sonra o günün raporu kimde: "staff" gün raporlu ya da hâlâ
 * personelde (bugün, dün; zil staffResultBell'in metnini yazar, Kasa'daki güne götürür); "late" geç rapor penceresinde
 * (dünden eski, son 14 gün: personel Z fotoğrafıyla girer, yönetici onaylar; docs/KASA-RAPORU.md › Geç rapor);
 * "admin" ikisi de değil, raporu yönetici girer.
 */
export function closedFollowUp(day: string, now: Date, reported: boolean): "staff" | "late" | "admin" {
  if (reported || staffCanReport(day, now)) return "staff";
  return staffLateDay(day, now) ? "late" : "admin";
}

/** İşlem geçmişinde neden: ilk 200 karakter */
export const reasonLog = (reason: string | null | undefined) => (reason ?? "").trim().slice(0, 200);

/** "22 Ekim Perşembe: Teslim edilen 2.400 ₺ → 2.040 ₺ · <neden>" (personelin önerisi; değişiklikler kesilmez) */
export function correctionLog(o: { date: string; changes: readonly FieldChange[]; reason: string | null }): string {
  return [`${longDateTR(o.date)}: ${changesText([...o.changes])}`, reasonLog(o.reason) || null].filter(Boolean).join(" · ");
}

/** E-postanın onay satırı: "Yönetici onayıyla düzeltildi: Mehmet önerdi, Ayşe onayladı." */
export function approvalLine(requester: string, approver: string): string {
  return `Yönetici onayıyla düzeltildi: ${requester} önerdi, ${approver} onayladı.`;
}
