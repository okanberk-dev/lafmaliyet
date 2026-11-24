"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { money, numPossessive } from "@/lib/format";
import { branchPriceTargets, effectiveText, type SlotPrices } from "@/lib/prices/branch";
import { nothingToUndoText, undoPlan } from "@/lib/prices/history";
import { toMinor } from "@/lib/site-menu/slot";
import { requireAdmin } from "@/server/auth/dal";
import { loadBatch } from "@/server/data/prices";
import { listBranches } from "@/server/branches";
import { applyPriceBatch, type BatchResult } from "@/server/prices/batch";
import { applyBranchPriceBatch, cancelBranchPrice, writeBranchPrice } from "@/server/prices/branch-write";

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

// ---------------------------------------------------------------- Şube fiyatı

/** Yeni satırın anı: saat dilimiyle (+03:00 ya da Z); geçmişe 5 dakikadan, ileriye 90 günden fazla değil (site de denetler) */
const zEffective = z
  .string()
  .max(40)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/, "Geçerlilik tarihini ve saatini seçin")
  .refine((v) => Number.isFinite(Date.parse(v)), "Geçerlilik tarihini ve saatini seçin");
const zSiteMenuId = z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/, "Kalem bulunamadı");

/** Şube kimliği: açık, fiziksel, ana şube (Tuzla) dışı */
async function branchOf(id: string): Promise<{ id: string; name: string }> {
  const branch = branchPriceTargets(await listBranches()).find((b) => b.id === id);
  if (!branch) throw new UserError("Bu şubeye şube fiyatı yazılmaz; şubeyi seçin");
  return branch;
}

const priceText = (p: SlotPrices) => `${money(p.M)}${p.L > 0 ? ` / ${money(p.L)}` : ""}`;

const branchSetSchema = z.object({
  branch: z.string().max(24),
  siteMenuId: zSiteMenuId,
  effectiveFrom: zEffective,
  /** Boy boy yeni fiyat (verilmeyen boy değişmez) ya da tabana dön */
  M: zMoney.positive("Fiyat 0'dan büyük olmalı").optional(),
  L: zMoney.positive("Fiyat 0'dan büyük olmalı").optional(),
  base: z.boolean().optional(),
});

/** Tek kalemin şube fiyatı (Fiyatlar › Şube fiyatı): bir andan itibaren, siteye yazılır */
export async function setBranchPrice(input: z.input<typeof branchSetSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = branchSetSchema.parse(input);
    const branch = await branchOf(data.branch);
    const set = data.base ? ({ base: true } as const) : { ...(data.M !== undefined ? { M: data.M } : {}), ...(data.L !== undefined ? { L: data.L } : {}) };
    const w = await writeBranchPrice(me, { siteMenuId: data.siteMenuId, branch: branch.id, effectiveFrom: data.effectiveFrom, set });
    if (w.kind === "none") throw new UserError("Şubenin o andaki fiyatı zaten bu");
    await logActivity(me, "Şube fiyatı", `${branch.name} · ${w.name} · ${effectiveText(data.effectiveFrom)}'ten ${priceText(w.before)} → ${priceText(w.after)}`);
    refresh();
    return { before: w.before, after: w.after };
  });
}

/** Anı gelmemiş şube fiyatını geri alır (iptal) */
export async function cancelBranchPriceRow(input: { branch: string; siteMenuId: string; effectiveFrom: string }) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = z.object({ branch: z.string().max(24), siteMenuId: zSiteMenuId, effectiveFrom: zEffective }).parse(input);
    const branch = await branchOf(data.branch);
    const r = await cancelBranchPrice(me, { siteMenuId: data.siteMenuId, branch: branch.id, effectiveFrom: data.effectiveFrom });
    await logActivity(me, "Şube fiyatı iptal edildi", `${branch.name} · ${r.name} · ${effectiveText(data.effectiveFrom)}`);
    refresh();
    return null;
  });
}

const branchBulkSchema = z.object({
  branch: z.string().max(24),
  effectiveFrom: zEffective,
  items: bulkSchema.shape.items,
  note: z.string().transform((v) => v.trim().slice(0, 200)),
});

/**
 * Toplu değişikliğin şube hâli (Toplu değiştir › Şube): siteye bağlı ürünlerin şubedeki fiyatı bir andan itibaren,
 * kalem kalem siteye (src/server/prices/branch-write.ts). Geri alma yok: anı gelmemiş satır Şube fiyatı'nda iptal edilir.
 */
export async function applyBranchPrices(input: z.input<typeof branchBulkSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = branchBulkSchema.parse(input);
    const branch = await branchOf(data.branch);
    const items = data.items.filter((i) => toMinor(i.to) !== toMinor(i.from));
    if (!items.length) throw new UserError("Değişecek fiyat yok");
    const result = await applyBranchPriceBatch(me, { branch: branch.id, effectiveFrom: data.effectiveFrom, items });
    await logActivity(
      me,
      "Toplu şube fiyatı",
      [`${branch.name} · ${effectiveText(data.effectiveFrom)}'ten`, data.note, `${result.applied.length} ürün${result.failed.length ? `; ${result.failed.length} değişmedi` : ""}`]
        .filter(Boolean)
        .join(" · "),
    );
    refresh();
    return result;
  });
}
