"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { numPossessive } from "@/lib/prices/bulk";
import { nothingToUndoText, undoPlan } from "@/lib/prices/history";
import { toMinor } from "@/lib/site-menu/slot";
import { requireAdmin } from "@/server/auth/dal";
import { loadBatch } from "@/server/data/prices";
import { applyPriceBatch, type BatchResult } from "@/server/prices/batch";

import { logActivity } from "./log";
import { attempt, UserError, zMoney } from "./util";

/**
 * Ürünler › Fiyatlar (docs/FIYATLAR.md): toplu fiyat değişikliği ve geri alması. Yalnız yönetici. Kasada (ModPOS)
 * değiştirilen fiyatların işaretlenmesi ve geri alınması personelle ortak, ayrı dosyada (src/server/actions/pos-marks.ts).
 */

const zId = z.number().int().positive();
const bulkSchema = z.object({
  items: z
    .array(z.object({ productId: zId, from: zMoney.min(0), to: zMoney.positive("Yeni fiyat 0'dan büyük olmalı") }))
    .min(1, "Değişecek fiyat yok")
    .max(200, "Bir seferde en çok 200 ürün")
    .refine((items) => new Set(items.map((i) => i.productId)).size === items.length, "Aynı ürün iki kez seçilmiş"),
  /** Kuralın özeti (geçmişte toplu değişikliğin başlığı) */
  note: z.string().transform((v) => v.trim().slice(0, 200)),
  /** "Tekrar dene": ilk denemenin kimliği (geri alma ikisini birlikte kapsar) */
  batchId: z.uuid().nullish(),
});

/** İşlem geçmişinin özeti: "+%10 · 5 ₺'ye yukarı · 32 ürün (10'u sitede de); 2 değişmedi" */
function batchLog(note: string, r: BatchResult): string {
  const site = r.applied.filter((a) => a.site).length;
  return [
    note,
    `${r.applied.length} ürün${site ? ` (${numPossessive(site)} sitede de)` : ""}${r.failed.length ? `; ${r.failed.length} değişmedi` : ""}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Toplu değişikliği uygular (src/server/prices/batch.ts): bağlı olmayanlar tek işlemde, siteye bağlılar kalem kalem
 * önce siteye. Kuruşu aynı kalanlar gönderilmez. Sonuç: yazılanlar, yazılamayanlar (nedeniyle) ve sitenin kapalı
 * göründüğü; kısmi sonuç hata değildir.
 */
export async function applyBulkPrices(input: z.input<typeof bulkSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = bulkSchema.parse(input);
    const items = data.items.filter((i) => toMinor(i.to) !== toMinor(i.from));
    if (!items.length) throw new UserError("Değişecek fiyat yok");
    const result = await applyPriceBatch(me, items, { source: "bulk", note: data.note, batchId: data.batchId ?? crypto.randomUUID() });
    await logActivity(me, "Toplu fiyat değişikliği", batchLog(data.note, result));
    refresh();
    return result;
  });
}

/**
 * Toplu değişikliği geri alır: yalnız fiyatı hâlâ toplu değişikliğin yazdığı ürünler eski fiyatına döner (süre sınırı
 * yok, sahibin kararı D9); geri alma da toplu bir değişikliktir (kaynak "Geri alındı"), kendisi geri alınmaz.
 */
export async function undoPriceBatch(batchId: string) {
  return attempt(async () => {
    const me = await requireAdmin();
    const id = z.uuid("Toplu değişiklik bulunamadı").parse(batchId);
    const rows = await loadBatch(id);
    if (!rows.length) throw new UserError("Toplu değişiklik bulunamadı; sayfayı yenileyin");
    if (rows.some((r) => r.source !== "bulk")) throw new UserError("Geri alma geri alınamaz; fiyatı yeniden değiştirin");
    const plan = undoPlan(
      rows.map((r) => ({ id: r.id, productId: r.productId, label: `${r.name} · ${r.size}`, priceBefore: r.priceBefore, price: r.price, changedAt: r.changedAt.toISOString() })),
      new Map(rows.map((r) => [r.productId, r.current])),
    );
    if (!plan.revert.length) throw new UserError(nothingToUndoText(plan));
    const note = `Geri alındı: ${rows.find((r) => r.note)?.note ?? "toplu değişiklik"}`.slice(0, 200);
    const result = await applyPriceBatch(
      me,
      plan.revert.map((r) => ({ productId: r.productId, from: r.from, to: r.to })),
      { source: "undo", note, batchId: crypto.randomUUID() },
    );
    await logActivity(me, "Toplu fiyat geri alındı", batchLog(note, result));
    refresh();
    return { ...result, skipped: plan.skipped };
  });
}
