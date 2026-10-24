import { z } from "zod";

import {
  changeLine,
  changesText,
  computeCash,
  diffText,
  revisionChanges,
  type CashReportFields,
  type CashRevisionData,
  type FieldChange,
} from "./cash-report";
import { money } from "./format";
import { dayMonthTR, longDateTR } from "./reminders";

/**
 * Personelin kasa raporu istekleri (saf; docs/KASA-RAPORU.md › Sonradan düzeltme ve silme isteği; plan
 * docs/planlar/personel-yetki.md §2.3): isteğin yükü (zod; her okumada yeniden çözülür, raporun alanları dışında anahtar
 * taşımaz), önerinin rapora birleştirilmesi, değişiklik ve sonuç satırları, başlık, zil ve işlem geçmişi metinleri.
 * Kapı kuralı src/lib/cash-report.ts staffCashGate. Testler: tests/kasa-duzeltme-istegi.test.ts.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const amount = z.number().finite();

/** Raporun formu (gün hariç); bilinmeyen anahtarlar düşer */
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
  cashOut: amount,
  cashOutNote: z.string().max(200).nullable(),
  countedCash: amount,
  handedOver: amount,
  bankPos: amount.nullable(),
  offRevenue: amount.nullable(),
  discounts: amount.nullish().transform((v) => v ?? null),
  note: z.string().max(1000).nullable(),
});

/** Bir sürümün kopyası (cash_report_revisions.data ile aynı alanlar) */
export const CashRevisionDataSchema = CashFieldsSchema.extend({ date: day, cashDiff: amount, countedByName: z.string().nullable() });

/** Önerilen alanlar: raporun formu (gün hariç) ve sayan */
export const ProposedSchema = CashFieldsSchema.extend({ countedBy: z.number().int().positive(), countedByName: z.string().min(1).max(200) });
export type ProposedFields = Omit<CashReportFields, "date"> & { countedBy: number; countedByName: string };

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
  "cashOut",
  "cashOutNote",
  "countedCash",
  "handedOver",
  "bankPos",
  "offRevenue",
  "discounts",
  "note",
] as const satisfies readonly (keyof CashReportFields)[];
type FieldKey = (typeof FIELD_KEYS)[number];
const TEXT_KEYS: readonly FieldKey[] = ["zNo", "cashOutNote", "note"];

/** İki değer aynı mı: metin kırpılarak, tutar 0,005 hassasiyetle, boş yalnız boşla */
function same(k: FieldKey, a: unknown, b: unknown): boolean {
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
 * tabanla aynıysa şimdiki sayan kalır.
 */
export function mergeProposal(
  current: { data: CashRevisionData; countedBy: number | null },
  base: { data: CashRevisionData; countedBy: number | null },
  proposed: ProposedFields,
): { fields: CashReportFields; countedBy: number | null; countedByName: string | null } {
  const picked = Object.fromEntries(FIELD_KEYS.map((k) => [k, same(k, base.data[k], proposed[k]) ? (current.data[k] ?? null) : (proposed[k] ?? null)]));
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
  const v = d[key] ?? null;
  if (v === null || v === "") return "—";
  if (key === "zNo" || key === "receipts" || key === "countedByName") return String(v);
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

/** Personelin kasa isteklerinin türleri (zil ve İsteklerim) */
export type CashRequestKind = "kasa-duzeltme" | "kasa-silme" | "kasa-gec";

const RESULT_HEAD: Record<CashRequestKind, (d: string) => string> = {
  "kasa-duzeltme": (d) => `${d} kasa düzeltmeniz`,
  "kasa-silme": (d) => `${d} kasa raporunun silinmesi`,
  "kasa-gec": (d) => `${d} kasa raporu`,
};
const RESULT_BODY: Record<CashRequestKind, { approved: string; rejected: string }> = {
  "kasa-duzeltme": { approved: "Rapor güncellendi", rejected: "Rapor değişmedi" },
  "kasa-silme": { approved: "Rapor silindi", rejected: "Rapor yerinde kaldı" },
  "kasa-gec": { approved: "Rapor kayda geçti", rejected: "Rapor kaydedilmedi" },
};

/**
 * Personelin zilinde isteğin sonucu: "22 Ekim kasa düzeltmeniz onaylandı" / "… reddedildi" / "… kapandı" / "… süresi
 * doldu"; gövde yöneticinin notu ("Yönetici: …") ya da sonucun kendisi ("Rapor güncellendi", "Rapor değişmedi").
 * Kapanan istekte not sistemin nedenidir ("Rapor başka bir istekle düzeltildi").
 */
export function staffResultBell(o: { kind: CashRequestKind; status: "approved" | "rejected" | "superseded" | "expired"; day: string; note: string | null }): { title: string; body: string } {
  const head = RESULT_HEAD[o.kind](dayMonthTR(o.day));
  const verb = { approved: "onaylandı", rejected: "reddedildi", superseded: "kapandı", expired: "süresi doldu" }[o.status];
  const title = o.status === "superseded" && o.kind !== "kasa-duzeltme" ? `${head} isteğiniz kapandı` : o.status === "expired" ? `${head} isteğinizin süresi doldu` : `${head} ${verb}`;
  if (o.status === "superseded" || o.status === "expired") return { title, body: o.note ?? RESULT_BODY[o.kind].rejected };
  return { title, body: o.note ? `Yönetici: ${o.note}` : RESULT_BODY[o.kind][o.status] };
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
