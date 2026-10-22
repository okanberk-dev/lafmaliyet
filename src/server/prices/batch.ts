import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { pushFailureOf, runSiteGroups, type SiteWriteOutcome } from "@/lib/prices/bulk";
import { UserError } from "@/server/actions/util";
import { getDb, schema as s } from "@/server/db";
import { lockMenu } from "@/server/site-menu/sync";

import { recordPriceChange } from "./record";
import { writeSalePrice } from "./write";

/**
 * Toplu fiyat değişikliği ve geri alması (Ürünler › Fiyatlar; docs/FIYATLAR.md). Sitenin toplu yazma ucu yok: siteye
 * bağlı her ürün tek fiyat yazımının yolundan tek tek gider. Değişiklik bütünüyle atomik değildir (site dışarıda):
 * yazılanlar kalır, yazılamayanlar nedeniyle döner ("Tekrar dene" aynı kimlikle sürdürür, "Geri al" ikisini de kapsar).
 *
 * 1. Bağlı olmayanlar tek işlemde: önce menü kilidi (bağlamayla aynı sıra), her satır yalnız fiyatı hâlâ önizlemedeki
 *    fiyatsa ve hâlâ bağlı değilse yazılır (SQL'de iyimser denetim), geçmiş ve kasa durumu aynı işlemde.
 * 2. Bağlılar site kalemine göre gruplu: bir kalemin M ve L satırı sırayla gider (öteki boyu güncelleyen yanıt eski
 *    L fiyatını geri yazmasın), gruplar dörder dörder.
 * 3. Devre kesici: site kapalıysa (ağ, zaman aşımı, imza, 5xx) sıradakiler gönderilmez, yoldakiler biter. 40 saniyeden
 *    sonra yeni ürün gönderilmez (sayfanın maxDuration'ı 60). Sıra, devre kesici ve süre saf runSiteGroups'ta
 *    (src/lib/prices/bulk.ts; testi sahte yazımla).
 */

export interface BatchItem {
  productId: number;
  /** Önizlemedeki (bugünkü) fiyat */
  from: number;
  to: number;
}

export interface BatchResult {
  batchId: string;
  /**
   * Yazılanlar; `to` yazılan fiyat (bağlıysa sitenin kuruşu), `site` sitede de değişti, `posPending` kasada (ModPOS)
   * değiştirilecek fiyat kaldı (geri almada kasa henüz değişmemişse fiyat kasadakine döner, listeden düşer)
   */
  applied: { productId: number; label: string; from: number; to: number; site: boolean; posPending: boolean }[];
  failed: { productId: number; label: string; from: number; to: number; reason: string }[];
  /** Devre kesici açıldı: site kapalı göründü, sıradakiler gönderilmedi */
  siteDown: boolean;
}

const DEADLINE_MS = 40_000;
const SITE_CONCURRENCY = 4;

export const CHANGED_ERROR = "Fiyat bu sırada değişti; listeyi yenileyip tekrar dene";

type Row = typeof s.products.$inferSelect;

const labelOf = (p: { name: string; size: string }) => `${p.name} · ${p.size}`;

export async function applyPriceBatch(
  user: { name: string },
  items: readonly BatchItem[],
  opts: { source: "bulk" | "undo"; note: string; batchId: string },
): Promise<BatchResult> {
  const started = Date.now();
  const db = getDb();
  const result: BatchResult = { batchId: opts.batchId, applied: [], failed: [], siteDown: false };
  const fail = (item: BatchItem, label: string, reason: string) => result.failed.push({ ...item, label, reason });
  const ids = [...new Set(items.map((i) => i.productId))];
  const rows = new Map((ids.length ? await db.select().from(s.products).where(inArray(s.products.id, ids)) : []).map((r) => [r.id, r]));

  const local: { item: BatchItem; row: Row }[] = [];
  const groups = new Map<string, { item: BatchItem; row: Row }[]>();
  for (const item of items) {
    const row = rows.get(item.productId);
    if (!row) fail(item, "Silinmiş ürün", "Ürün bulunamadı");
    else if (!row.siteMenuId) local.push({ item, row });
    else groups.set(row.siteMenuId, [...(groups.get(row.siteMenuId) ?? []), { item, row }]);
  }

  // 1. Bağlı olmayanlar: tek işlem, satır sırası sabit (kilitler hep aynı sırayla alınır)
  if (local.length) {
    const now = new Date();
    const outcome = await db.transaction(async (tx) => {
      await lockMenu(tx);
      const out: { item: BatchItem; row: Row; reason: string | null; posPending: boolean }[] = [];
      for (const { item, row } of [...local].sort((a, b) => a.row.id - b.row.id)) {
        const [hit] = await tx
          .update(s.products)
          .set({ price: item.to, updatedAt: now })
          .where(and(eq(s.products.id, item.productId), isNull(s.products.siteMenuId), sql`abs(${s.products.price} - ${item.from}) < 0.005`))
          .returning({ id: s.products.id });
        if (!hit) {
          const [cur] = await tx.select({ siteMenuId: s.products.siteMenuId }).from(s.products).where(eq(s.products.id, item.productId));
          out.push({
            item,
            row,
            reason: !cur ? "Ürün bulunamadı" : cur.siteMenuId ? "Ürün bu sırada siteye bağlandı; listeyi yenileyip tekrar dene" : CHANGED_ERROR,
            posPending: false,
          });
          continue;
        }
        const pos = await recordPriceChange(
          tx,
          { productId: item.productId, before: item.from, after: item.to, source: opts.source, changedBy: user.name, batchId: opts.batchId, note: opts.note },
          now,
        );
        out.push({ item, row, reason: null, posPending: pos.posPending });
      }
      return out;
    });
    for (const o of outcome) {
      if (o.reason) fail(o.item, labelOf(o.row), o.reason);
      else result.applied.push({ ...o.item, label: labelOf(o.row), site: false, posPending: o.posPending });
    }
  }

  // 2. Bağlılar: kalem kalem, grubun içi sırayla; devre kesici ve süre sınırıyla (runSiteGroups)
  const write = async ({ item, row: loaded }: { item: BatchItem; row: Row }): Promise<SiteWriteOutcome> => {
    try {
      // Yeniden okunur: aynı kalemin öteki boyu az önce yazıldıysa satır güncel olsun
      const [row] = await db.select().from(s.products).where(eq(s.products.id, item.productId));
      if (!row) return { ok: false, reason: "Ürün bulunamadı", failure: null };
      const w = await writeSalePrice(user, row, item.to, { source: opts.source, batchId: opts.batchId, note: opts.note, consequence: "fiyat değişmedi", expectFrom: item.from });
      result.applied.push({ ...item, to: w.price, label: labelOf(loaded), site: w.site, posPending: w.posPending });
      return { ok: true };
    } catch (e) {
      // Sitenin hatası UserError'dır, nedeni cause'ta (devre kesici okur)
      if (e instanceof UserError) return { ok: false, reason: e.message, failure: pushFailureOf(e) };
      // Beklenmeyen hata (veritabanı): bu ürün yazılmadı, öbürleri sürer; sitede yazıldıysa ping panele getirir
      console.error("[fiyatlar] toplu yazım", e);
      return { ok: false, reason: "İşlem tamamlanamadı; tekrar dene", failure: null };
    }
  };
  const linked = await runSiteGroups([...groups.values()], write, { concurrency: SITE_CONCURRENCY, deadline: started + DEADLINE_MS });
  for (const f of linked.failed) fail(f.item.item, labelOf(f.item.row), f.reason);
  result.siteDown = linked.siteDown;
  return result;
}
