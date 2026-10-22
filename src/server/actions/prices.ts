"use server";

import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { tl } from "@/lib/format";
import { numPossessive } from "@/lib/prices/bulk";
import { nothingToUndoText, undoPlan } from "@/lib/prices/history";
import { splitPosDone } from "@/lib/prices/pos";
import { toMinor } from "@/lib/site-menu/slot";
import { requireAdmin } from "@/server/auth/dal";
import { loadBatch } from "@/server/data/prices";
import { getDb, schema as s } from "@/server/db";
import { applyPriceBatch, type BatchResult } from "@/server/prices/batch";

import { logActivity } from "./log";
import { attempt, UserError, zMoney } from "./util";

/**
 * Ürünler › Fiyatlar (docs/FIYATLAR.md): toplu fiyat değişikliği ve geri alması, kasada (ModPOS) değiştirilen
 * fiyatların işaretlenmesi. Yalnız yönetici (personel fiyat görmez, sahibin kararı D1).
 */

const zId = z.number().int().positive();
/** Kasada işaretlenen ürünler; `price` listede (ya da ürün kartında) görülen, kasaya yazılan fiyat */
const zPosDone = z
  .array(z.object({ productId: zId, price: zMoney.min(0) }))
  .min(1, "Ürün seçin")
  .max(500, "Bir seferde en çok 500 ürün")
  .refine((items) => new Set(items.map((i) => i.productId)).size === items.length, "Aynı ürün iki kez seçilmiş");

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

/** Ürünün kısa adı ve fiyatı: "Latte M 205 ₺" */
const posText = (r: { name: string; size: string; price: number }) => `${r.name} ${r.size} ${tl(r.price, toMinor(r.price) % 100 ? 2 : 0)}`;

/**
 * Kasada (ModPOS) değiştirildi: ürünler Kasaya işle listesinden düşer. Yalnız fiyatı hâlâ listede görülen fiyat olanlar
 * (splitPosDone); liste açıldıktan sonra fiyatı yeniden değişen (başka bir yönetici, sitenin çekmesi, zam önerisi)
 * `changed`'de bugünkü fiyatıyla döner, listede kalır. `done` "Geri al" içindir (kasadaki eski fiyat ve ne zamandan
 * beri). Satırlar kilitli okunur: fiyat denetimiyle işaret arasında fiyat değişemez.
 */
export async function markPosDone(items: z.input<typeof zPosDone>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const seen = new Map(zPosDone.parse(items).map((i) => [i.productId, i.price]));
    const { done, changed } = await getDb().transaction(async (tx) => {
      const rows = await tx
        .select({ id: s.products.id, name: s.products.name, size: s.products.size, price: s.products.price, stalePrice: s.products.posStalePrice, since: s.products.posStaleSince })
        .from(s.products)
        .where(and(inArray(s.products.id, [...seen.keys()]), isNotNull(s.products.posStalePrice)))
        .for("update");
      const split = splitPosDone(rows, seen);
      if (split.done.length) {
        await tx
          .update(s.products)
          .set({ posStalePrice: null, posStaleSince: null })
          .where(inArray(s.products.id, split.done.map((r) => r.id)));
      }
      return split;
    });
    if (done.length) await logActivity(me, "Kasaya işlendi", done.map(posText).join(", "));
    refresh();
    return {
      done: done.map((r) => ({
        productId: r.id,
        label: `${r.name} ${r.size}`,
        price: r.price,
        stalePrice: r.stalePrice!,
        since: (r.since ?? new Date()).toISOString(),
      })),
      changed: changed.map((r) => ({ productId: r.id, label: `${r.name} ${r.size}`, price: r.price })),
    };
  });
}

const restoreSchema = z
  .array(
    z.object({
      productId: zId,
      stalePrice: zMoney.min(0),
      since: z.string().refine((v) => Number.isFinite(Date.parse(v)), "Geçersiz zaman"),
    }),
  )
  .min(1)
  .max(500);

/**
 * "Kasaya işlendi"nin geri alınması: ürün listeye eski hâliyle döner. Yalnız bu arada yeniden listeye girmemiş ve
 * fiyatı hâlâ kasadakinden farklı ürünler (fiyat kasadakine döndüyse listede yeri yok).
 */
export async function restorePosPending(items: z.input<typeof restoreSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = restoreSchema.parse(items);
    const restored = await getDb().transaction(async (tx) => {
      const out: { name: string; size: string; price: number }[] = [];
      for (const it of data) {
        const [row] = await tx
          .update(s.products)
          .set({ posStalePrice: it.stalePrice, posStaleSince: new Date(it.since) })
          .where(and(eq(s.products.id, it.productId), isNull(s.products.posStalePrice), sql`abs(${s.products.price} - ${it.stalePrice}) >= 0.005`))
          .returning({ name: s.products.name, size: s.products.size, price: s.products.price });
        if (row) out.push(row);
      }
      return out;
    });
    if (restored.length) await logActivity(me, "Kasaya işlendi geri alındı", restored.map(posText).join(", "));
    refresh();
    return { restored: restored.length };
  });
}
