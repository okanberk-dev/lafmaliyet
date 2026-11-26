import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { receiptContextBlock, receiptFacts, type ReceiptFacts } from "@/lib/assistant/receipt";
import { businessDate } from "@/lib/cash-report";
import { ToolInputError } from "@/lib/mcp/answers/common";
import { normalizeReceipt, type ReceiptReading } from "@/lib/photo-read/receipt";
import { ReceiptRaw } from "@/lib/photo-read/schemas";
import { cashOutCategories } from "@/server/data/cash-outs";
import { getDb, schema as s } from "@/server/db";
import { recentReceipts } from "@/server/photo-read/read";
import { getPhoto, type PhotoRow } from "@/server/storage/photos";

/*
 * Sohbete eklenen fiş fotoğrafı (SALT OKUR; docs/ASISTAN-ISLEMLER.md › Fiş fotoğrafı). Fotoğrafı yönetici sohbette
 * /api/foto ile yükler ve okutur (tür "fis", kasanın fiş okuması: önce ucuz model). Burada:
 * - fotoğrafın sohbete eklenebilir olduğu denetlenir: fiş türünde, yükleyeni bu kullanıcı, bir kayda bağlanmamış ve
 *   süresi işliyor (onay bekleyen bir isteğin tuttuğu fotoğrafın süresi yoktur: o da eklenemez);
 * - son başarılı okuması (ai_calls) kasanın kurallarıyla yeniden kurulur (kategoriler ve son eklenen fişler: tekrar
 *   uyarısı), modelin mesajına veri bloğu olur ve kartın fişten gelen alanları (tarih, numara, KDV) buradan yazılır.
 * Hiçbir şey yazılmaz; fotoğraf kayda yalnız kartın Onayla'sında bağlanır (saveCashOut / saveExpenseEntry).
 */

export const RECEIPT_GONE = "Fiş fotoğrafı bulunamadı ya da süresi doldu; fotoğrafı yeniden ekleyin.";

/** Fotoğraf bu kullanıcının sohbetine eklenebilir mi (yoksa neden) */
export function chatPhotoProblem(p: PhotoRow | null, userId: number, now = new Date()): string | null {
  if (!p || p.kind !== "fis") return RECEIPT_GONE;
  if (p.createdBy !== userId) return "Bu fotoğrafı siz eklemediniz; fişi sohbete kendiniz ekleyin.";
  if (p.linkedAt !== null) return "Bu fiş zaten bir kayda bağlı; ikinci kez eklenmez.";
  // Süresiz ve bağlanmamış: onay bekleyen bir isteğin tuttuğu fotoğraf (src/server/storage/photos.ts holdPhoto)
  if (p.expiresAt === null) return "Bu fiş onay bekleyen bir isteğe bağlı; Onaylar'dan bakın.";
  if (p.expiresAt.getTime() <= now.getTime()) return RECEIPT_GONE;
  return null;
}

export interface ChatReceipt {
  photoId: number;
  reading: ReceiptReading | null;
  facts: ReceiptFacts;
  categoryName: string | null;
  cashDay: string;
}

/** Fotoğrafın son başarılı fiş okuması (yoksa null), kasanın kurallarıyla (yönetici) */
async function readingOf(photoId: number, day: string): Promise<{ reading: ReceiptReading | null; categoryName: string | null }> {
  const [call] = await getDb()
    .select({ result: s.aiCalls.result })
    .from(s.aiCalls)
    .where(and(eq(s.aiCalls.photoId, photoId), eq(s.aiCalls.feature, "fis"), eq(s.aiCalls.status, "ok")))
    .orderBy(desc(s.aiCalls.at), desc(s.aiCalls.id))
    .limit(1);
  const raw = call ? ReceiptRaw.safeParse(call.result) : null;
  if (!raw?.success) return { reading: null, categoryName: null };
  const [categories, recent] = await Promise.all([cashOutCategories("admin"), recentReceipts(day, false)]);
  const reading = normalizeReceipt(raw.data, { day, categories, recent, staff: false });
  const categoryName = reading.ok && reading.values.categoryId !== null ? (categories.find((c) => c.id === reading.values.categoryId)?.name ?? null) : null;
  return { reading, categoryName };
}

/** Sohbete eklenen fiş: denetler ve okumasını kurar; eklenemiyorsa ToolInputError (metni kullanıcıya ya da asistana) */
export async function chatReceipt(userId: number, photoId: number, now = new Date()): Promise<ChatReceipt> {
  const problem = chatPhotoProblem(await getPhoto(photoId), userId, now);
  if (problem) throw new ToolInputError(problem);
  const cashDay = businessDate(now);
  const { reading, categoryName } = await readingOf(photoId, cashDay);
  return { photoId, reading, facts: receiptFacts(reading), categoryName, cashDay };
}

/** Sohbet ucu için: fotoğrafın veri bloğu (modelin mesajına eklenir) ya da eklenemezse kullanıcıya gösterilecek metin */
export async function chatReceiptBlock(userId: number, photoId: number): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const r = await chatReceipt(userId, photoId);
    return { ok: true, text: receiptContextBlock({ photoId, reading: r.reading, categoryName: r.categoryName, cashDay: r.cashDay }) };
  } catch (e) {
    if (e instanceof ToolInputError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Onayda bayatlık: fotoğraf hâlâ bu kullanıcının, bağlanmamış ve süresi işliyor mu */
export async function chatReceiptStale(userId: number, photoId: number): Promise<string | null> {
  const problem = chatPhotoProblem(await getPhoto(photoId), userId);
  return problem ? `Fiş fotoğrafı: ${problem}` : null;
}
