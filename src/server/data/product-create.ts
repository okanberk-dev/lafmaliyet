import "server-only";

import { and, eq, max } from "drizzle-orm";

import { categoryFireDefault } from "@/app/panel/urunler/logic";
import { UserError } from "@/server/actions/util";
import { getDb, schema as s } from "@/server/db";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export interface NewProduct {
  name: string;
  size: "M" | "L" | "Tek";
  categoryId: number;
  /** Satış fiyatı (KDV dahil) */
  price: number;
}

export interface NewRecipeLine {
  ingredientId: number;
  qty: number;
  qtyExpr: string | null;
  note: string | null;
}

/**
 * Yeni ürünü (ve varsa reçetesini) yazar; Ürünler › Yeni ürün (createProduct) ve personelin yeni ürün önerisinin onayı
 * (approveNewProduct) aynı kuralla açar, çağıran kendi işleminde (tx) çağırır. Aynı ad + boyda ürün varsa UserError.
 * Kopyalamada (`copyFromId`) kaynağın ürüne özel fire oranı, notu ve reçetesi de gelir (Excel'de kart bloğu
 * kopyalanınca G16 ve notlar da taşınır). Kopyasız yeni ürün, kategorisindeki ürünlerin en sık kullandığı zayi oranını
 * alır (categoryFireDefault); `items` verilirse reçetesi o satırlardır. Sıra en sonda; aktiflik ve QR menüde
 * görünürlük varsayılan (açık). laffogato.net menüsüne bağlanmaz (bağlantı Ürünler › Site menüsü'nde).
 */
export async function insertProduct(tx: Tx, data: NewProduct, opts: { copyFromId?: number | null; note?: string | null; items?: NewRecipeLine[] } = {}) {
  const copyFromId = opts.copyFromId ?? null;
  const [dup] = await tx
    .select({ id: s.products.id })
    .from(s.products)
    .where(and(eq(s.products.name, data.name), eq(s.products.size, data.size)));
  if (dup) throw new UserError(`“${data.name} · ${data.size}” zaten var; başka bir boy seçin ya da adı değiştirin`);
  let initial: { fireOverride: number | null; note: string | null };
  if (copyFromId) {
    const [src] = await tx.select({ fireOverride: s.products.fireOverride, note: s.products.note }).from(s.products).where(eq(s.products.id, copyFromId));
    if (!src) throw new UserError("Kopyalanacak ürün bulunamadı; sayfayı yenileyip tekrar deneyin");
    initial = src;
  } else {
    const peers = await tx.select({ id: s.products.id, fireOverride: s.products.fireOverride }).from(s.products).where(eq(s.products.categoryId, data.categoryId));
    initial = { fireOverride: categoryFireDefault(peers), note: opts.note ?? null };
  }
  const [{ m }] = await tx.select({ m: max(s.products.sortOrder) }).from(s.products);
  const [created] = await tx
    .insert(s.products)
    .values({ ...data, ...initial, sortOrder: (m ?? 0) + 1 })
    .returning({ id: s.products.id });
  // Kopyada kaynağın satırları kendi sırasıyla; öneriden gelen satırlar yazıldığı sırayla
  const lines = copyFromId
    ? (await tx.select().from(s.recipeItems).where(eq(s.recipeItems.productId, copyFromId))).map((it) => ({
        ingredientId: it.ingredientId,
        qty: it.qty,
        qtyExpr: it.qtyExpr,
        note: it.note,
        sortOrder: it.sortOrder,
      }))
    : (opts.items ?? []).map((it, i) => ({ ...it, sortOrder: i + 1 }));
  if (lines.length) await tx.insert(s.recipeItems).values(lines.map((l) => ({ ...l, productId: created.id })));
  return { id: created.id, lines: lines.length, fireOverride: initial.fireOverride, noteCopied: !!(copyFromId && initial.note) };
}
