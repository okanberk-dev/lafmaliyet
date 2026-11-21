import "server-only";

import { and, desc, eq, gte, lt, lte } from "drizzle-orm";

import { isLafposDay } from "@/lib/lafpos/switch";
import { normalizeZ } from "@/lib/photo-read/kasa";
import { normalizeOkc, okcReadingOnLafposDay, okcToLegacyPos, toStaffReading } from "@/lib/photo-read/okc";
import { OKC_TASK, RECEIPT_TASK, SYSTEM, Z_TASK } from "@/lib/photo-read/prompts";
import type { PhotoReading } from "@/lib/photo-read/reading";
import { normalizeReceipt, receiptToStore } from "@/lib/photo-read/receipt";
import { KasaOkcRaw, KasaZRaw, ReceiptRaw } from "@/lib/photo-read/schemas";
import { addDays } from "@/lib/reminders";
import { extractImage, type AiErrorCode } from "@/server/ai/claude";
import { OKC_EFFORT, OKC_MAX_TOKENS, OKC_TIMEOUTS, RETRYABLE, type AiImageType } from "@/server/ai/run";
import type { CurrentUser } from "@/server/auth/dal";
import { currentTillBranch } from "@/server/branch-scope";
import { cashOutCategories } from "@/server/data/cash-outs";
import { previousOkc } from "@/server/data/cash-reports";
import { lafposSwitchDayOf } from "@/server/data/lafpos-ikram";
import { getDb, schema as s } from "@/server/db";

export interface ReadOutcome {
  reading: PhotoReading | null;
  /** Okunamadı (servis, sınır, kapalı): fotoğraf yine saklandı; metin personele */
  readError: string | null;
  readCode: AiErrorCode | null;
  /** "Yeniden dene" anlamlı mı */
  canRetry: boolean;
}

/**
 * Kasanın şubesinde bu günden önceki son raporun Z no'su (Z no sırası denetimi; "eski bir Z raporu olabilir"). Her
 * şubenin kendi ModPOS'u ve Z sayacı var (docs/SUBE.md): öteki şubenin Z'siyle karşılaştırılmaz. Şube formun kasasıdır
 * (`currentTillBranch`; yazarkasa Z'sinin `previousOkc`'si gibi)
 */
async function previousZNo(day: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ zNo: s.cashReports.zNo })
    .from(s.cashReports)
    .where(and(lt(s.cashReports.date, day), eq(s.cashReports.branchId, await currentTillBranch())))
    .orderBy(desc(s.cashReports.date))
    .limit(1);
  return row?.zNo ?? null;
}

/**
 * Büyüklük denetimi için son 28 günün toplamları (plan §5.1): yazarkasa toplamları, hiç yoksa ModPOS Z toplamları
 * (yazarkasa bölümü kullanılmaya başlamadan önceki günler). Önceki yazarkasa Z'si (`previousOkc`, Z no sırası ve
 * kümülatif zinciri) kayıtlı raporların okc_* sütunlarından okunur; zincir denetimi burada, okumada yapılır (D17)
 */
async function okcTypical(day: string): Promise<number[]> {
  const rows = await getDb()
    .select({ okc: s.cashReports.okcTotal, z: s.cashReports.zTotal })
    .from(s.cashReports)
    .where(and(gte(s.cashReports.date, addDays(day, -28)), lt(s.cashReports.date, day)));
  const okc = rows.map((r) => r.okc).filter((v): v is number => v !== null && v > 0);
  return okc.length ? okc : rows.map((r) => r.z).filter((v) => v > 0);
}

/**
 * Aynı fişin ikinci kez eklenmesine karşı: günün ±1 kasadan çıkanları ve (yöneticide) ±7 gün harcama kayıtları. Personel
 * için harcama kayıtları okunmaz (yöneticinin maaş, kira gibi kayıtları; tekrar uyarısı personelde genel metindir,
 * ayrıntılı eşleşme yöneticinin onay kartında)
 */
async function recentReceipts(day: string, staff: boolean) {
  const db = getDb();
  const outs = (
    await db
      .select({ date: s.cashOuts.date, receiptDate: s.cashOuts.receiptDate, amount: s.cashOuts.amount, store: s.cashOuts.store, receiptNo: s.cashOuts.receiptNo })
      .from(s.cashOuts)
      .where(and(gte(s.cashOuts.date, addDays(day, -1)), lte(s.cashOuts.date, addDays(day, 1))))
  ).map((o) => ({ date: o.receiptDate ?? o.date, amount: o.amount, store: o.store, receiptNo: o.receiptNo }));
  if (staff) return outs;
  const entries = await db
    .select({ date: s.expenseEntries.date, amount: s.expenseEntries.amount, store: s.expenseEntries.description, cashOutId: s.expenseEntries.cashOutId })
    .from(s.expenseEntries)
    .where(and(gte(s.expenseEntries.date, addDays(day, -7)), lte(s.expenseEntries.date, addDays(day, 7))));
  return [
    ...outs,
    // Kasadan çıkanın harcama kaydı zaten yukarıda (satırın kendisi)
    ...entries.filter((e) => e.cashOutId === null).map((e) => ({ date: e.date, amount: e.amount, store: e.store, receiptNo: null })),
  ];
}

/**
 * Fotoğrafı türüne göre okur ve forma gidecek hâle getirir. Okuma hatası isteği bozmaz: fotoğraf saklanmıştır,
 * personel rakamları elle yazar ya da yeniden dener.
 *
 * Yazarkasa Z'si (`kasa-okc`, plan §4.4, §7): `OKC_TASK` + `KasaOkcRaw`, efor `OKC_EFFORT`, tek 50 sn'lik deneme; önceki
 * Z ve son 28 günün toplamları okumayla paralel okunur, kimlikler ve zincir sunucuda. Personel kümülatifi, yazarkasa
 * dışı tahsilatı ve yöneticinin satırlarını almaz (toStaffReading, D17); ham sonuç ai_calls.result'ta tam durur.
 * `kasa-pos` geçiştir (D2): eski sayfanın isteği; fotoğraf çağıranda `kasa-okc` yapılmıştır, aynı okuma yapılır ve
 * ai_calls'a `kasa-okc` yazılır, yanıt eski biçimde (okcToLegacyPos).
 */
export async function readPhotoFor(
  kind: "kasa-z" | "kasa-okc" | "kasa-pos" | "fis",
  input: { photoId: number; bytes: Uint8Array; contentType: AiImageType; day: string; me: CurrentUser },
): Promise<ReadOutcome> {
  const feature = kind === "kasa-pos" ? "kasa-okc" : kind;
  const base = { feature, userId: input.me.id, photoId: input.photoId, image: { bytes: input.bytes, mediaType: input.contentType }, system: SYSTEM } as const;
  const failed = (code: AiErrorCode, message: string): ReadOutcome => ({ reading: null, readError: message, readCode: code, canRetry: RETRYABLE.includes(code) });
  if (kind === "kasa-z") {
    const [prevZNo, res] = await Promise.all([previousZNo(input.day), extractImage({ ...base, task: Z_TASK(input.day), schema: KasaZRaw })]);
    if (!res.ok) return failed(res.code, res.message);
    return { reading: normalizeZ(res.data, { day: input.day, prevZNo }), readError: null, readCode: null, canRetry: false };
  }
  if (kind === "kasa-okc" || kind === "kasa-pos") {
    const [prev, recentTotals, switchDay, res] = await Promise.all([
      previousOkc(input.day),
      okcTypical(input.day),
      // Günün kasası: LafPOS gününde ModPOS Z bölümü yok, oraya okutma önerilmez (denetim E-39)
      lafposSwitchDayOf(getDb()).catch(() => null),
      extractImage({ ...base, task: OKC_TASK(input.day), schema: KasaOkcRaw, effort: OKC_EFFORT, maxTokens: OKC_MAX_TOKENS, timeouts: OKC_TIMEOUTS }),
    ]);
    if (!res.ok) return failed(res.code, res.message);
    const normalized = normalizeOkc(res.data, { day: input.day, prev, recentTotals });
    const full = isLafposDay(input.day, switchDay) ? okcReadingOnLafposDay(normalized) : normalized;
    const reading = input.me.role === "admin" ? full : toStaffReading(full);
    return { reading: kind === "kasa-pos" ? okcToLegacyPos(reading) : reading, readError: null, readCode: null, canRetry: false };
  }
  const staff = input.me.role !== "admin";
  const [categories, recent] = await Promise.all([cashOutCategories(input.me.role), recentReceipts(input.day, staff)]);
  const res = await extractImage({ ...base, task: RECEIPT_TASK(input.day, categories), schema: ReceiptRaw, stored: receiptToStore });
  if (!res.ok) return failed(res.code, res.message);
  return { reading: { kind: "fis", ...normalizeReceipt(res.data, { day: input.day, categories, recent, staff }) }, readError: null, readCode: null, canRetry: false };
}

