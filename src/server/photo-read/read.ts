import "server-only";

import { and, desc, gte, lt, lte } from "drizzle-orm";

import { normalizePos, normalizeZ } from "@/lib/photo-read/kasa";
import { POS_TASK, RECEIPT_TASK, SYSTEM, Z_TASK } from "@/lib/photo-read/prompts";
import type { PhotoReading } from "@/lib/photo-read/reading";
import { normalizeReceipt, receiptToStore } from "@/lib/photo-read/receipt";
import { KasaPosRaw, KasaZRaw, ReceiptRaw } from "@/lib/photo-read/schemas";
import { addDays } from "@/lib/reminders";
import { extractImage, type AiErrorCode } from "@/server/ai/claude";
import { RETRYABLE, type AiImageType } from "@/server/ai/run";
import type { CurrentUser } from "@/server/auth/dal";
import { cashOutCategories } from "@/server/data/cash-outs";
import { getDb, schema as s } from "@/server/db";

export interface ReadOutcome {
  reading: PhotoReading | null;
  /** Okunamadı (servis, sınır, kapalı): fotoğraf yine saklandı; metin personele */
  readError: string | null;
  readCode: AiErrorCode | null;
  /** "Yeniden dene" anlamlı mı */
  canRetry: boolean;
}

/** Bu günden önceki son raporun Z no'su (Z no sırası denetimi) */
async function previousZNo(day: string): Promise<string | null> {
  const [row] = await getDb().select({ zNo: s.cashReports.zNo }).from(s.cashReports).where(lt(s.cashReports.date, day)).orderBy(desc(s.cashReports.date)).limit(1);
  return row?.zNo ?? null;
}

/** Aynı fişin ikinci kez eklenmesine karşı: günün ±1 kasadan çıkanları ve ±7 gün harcama kayıtları */
async function recentReceipts(day: string) {
  const db = getDb();
  const [outs, entries] = await Promise.all([
    db
      .select({ date: s.cashOuts.date, receiptDate: s.cashOuts.receiptDate, amount: s.cashOuts.amount, store: s.cashOuts.store, receiptNo: s.cashOuts.receiptNo })
      .from(s.cashOuts)
      .where(and(gte(s.cashOuts.date, addDays(day, -1)), lte(s.cashOuts.date, addDays(day, 1)))),
    db
      .select({ date: s.expenseEntries.date, amount: s.expenseEntries.amount, store: s.expenseEntries.description, cashOutId: s.expenseEntries.cashOutId })
      .from(s.expenseEntries)
      .where(and(gte(s.expenseEntries.date, addDays(day, -7)), lte(s.expenseEntries.date, addDays(day, 7)))),
  ]);
  return [
    ...outs.map((o) => ({ date: o.receiptDate ?? o.date, amount: o.amount, store: o.store, receiptNo: o.receiptNo })),
    // Kasadan çıkanın harcama kaydı zaten yukarıda (satırın kendisi)
    ...entries.filter((e) => e.cashOutId === null).map((e) => ({ date: e.date, amount: e.amount, store: e.store, receiptNo: null })),
  ];
}

/**
 * Fotoğrafı türüne göre okur ve forma gidecek hâle getirir. Okuma hatası isteği bozmaz: fotoğraf saklanmıştır,
 * personel rakamları elle yazar ya da yeniden dener.
 */
export async function readPhotoFor(
  kind: "kasa-z" | "kasa-pos" | "fis",
  input: { photoId: number; bytes: Uint8Array; contentType: AiImageType; day: string; me: CurrentUser },
): Promise<ReadOutcome> {
  const base = { feature: kind, userId: input.me.id, photoId: input.photoId, image: { bytes: input.bytes, mediaType: input.contentType }, system: SYSTEM } as const;
  const failed = (code: AiErrorCode, message: string): ReadOutcome => ({ reading: null, readError: message, readCode: code, canRetry: RETRYABLE.includes(code) });
  if (kind === "kasa-z") {
    const [prevZNo, res] = await Promise.all([previousZNo(input.day), extractImage({ ...base, task: Z_TASK(input.day), schema: KasaZRaw })]);
    if (!res.ok) return failed(res.code, res.message);
    return { reading: normalizeZ(res.data, { day: input.day, prevZNo }), readError: null, readCode: null, canRetry: false };
  }
  if (kind === "kasa-pos") {
    const res = await extractImage({ ...base, task: POS_TASK(input.day), schema: KasaPosRaw });
    if (!res.ok) return failed(res.code, res.message);
    return { reading: normalizePos(res.data, { day: input.day }), readError: null, readCode: null, canRetry: false };
  }
  const staff = input.me.role !== "admin";
  const [categories, recent] = await Promise.all([cashOutCategories(input.me.role), recentReceipts(input.day)]);
  const res = await extractImage({ ...base, task: RECEIPT_TASK(input.day, categories), schema: ReceiptRaw, stored: receiptToStore });
  if (!res.ok) return failed(res.code, res.message);
  return { reading: { kind: "fis", ...normalizeReceipt(res.data, { day: input.day, categories, recent, staff }) }, readError: null, readCode: null, canRetry: false };
}

