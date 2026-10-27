import "server-only";

import { eq, isNotNull, sql } from "drizzle-orm";

import { createPosMappingIndex } from "@/lib/calc/pos-paste";
import { parsePosDay, POS_DAY_MAX_BYTES, resolvePosLine, siteSlotKey, type PosDayPush } from "@/lib/lafpos/day";
import { checkLafposRequest, lafposSecretFrom } from "@/lib/lafpos/request";
import { schema as s, type DB } from "@/server/db";

/**
 * LafPOS'un gün sonunun alınması (docs/LAFPOS.md): `POST /api/pos/gun`'un çekirdeği. Uç yalnız isteği okuyup buraya
 * verir; denetim sırası anahtar (503), boyut (413), imza (401), gövde (400), sonra yazım (o güne başka bir Z ile
 * yazılmış özet varsa 409, hiçbir şey yazılmaz). Veritabanını parametre alır
 * (tests/lafpos-db.test.ts doğrudan çalıştırır).
 */

/** LafPOS'un anahtarı (LAFPOS_SYNC_SECRET, en az 32 karakter); yoksa iki uç da 503 */
export function lafposSecret(): string | null {
  return lafposSecretFrom(process.env);
}

export interface EndpointResult {
  status: number;
  body: Record<string, unknown>;
}

/** 200 yanıtında en çok bu kadar eşleşmeyen POS adı (LafPOS bağlantı ekranında gösterir) */
export const UNMATCHED_MAX = 50;

/**
 * Yazımın sonucu: yazıldı (satır sayısı, ürüne ya da hizmete bağlanan satır sayısı, ürüne bağlanamayan POS adları:
 * çok satılan önce, en çok UNMATCHED_MAX) ya da o güne başka bir Z ile yazılmış özet var (`zNo` kayıtlı olanınki; hiçbir
 * şey yazılmadı)
 */
export type StorePosDayResult = { ok: true; lines: number; matched: number; unmatched: string[] } | { ok: false; zNo: number };

/**
 * Bir iş gününü yazar, idempotent: günün danışma kilidi altında özet (pos_day_reports) yenilenir, günün satırları
 * silinip yenisi yazılır; hepsi tek işlem. Aynı gün aynı Z no ile yeniden gelirse (düzeltme) öncekinin yerine geçer, aynı
 * anda iki gönderim sırayla yazılır. O güne başka bir Z no ile yazılmış özet varsa hiçbir şey yazılmaz (`ok: false`):
 * önceki Z'yi ve günün satırlarını sessizce silmek yerine uç 409 döner. Ürün: önce sitenin kalemi ve boyu, yoksa POS
 * eşleştirmesi (resolvePosLine).
 */
export async function storePosDay(db: DB, day: PosDayPush, now: Date = new Date()): Promise<StorePosDayResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`lafpos-gun:${day.date}`}))`);
    const [stored] = await tx.select({ z: s.posDayReports.z }).from(s.posDayReports).where(eq(s.posDayReports.date, day.date)).limit(1);
    if (stored && stored.z.zNo !== day.z.zNo) return { ok: false, zNo: stored.z.zNo };
    const linked = await tx
      .select({ id: s.products.id, siteMenuId: s.products.siteMenuId, slot: s.products.siteMenuSlot })
      .from(s.products)
      .where(isNotNull(s.products.siteMenuId));
    const mappings = await tx.select().from(s.posMappings);
    const bySite = new Map<string, number>();
    for (const p of linked) if (p.siteMenuId && p.slot) bySite.set(siteSlotKey(p.siteMenuId, p.slot), p.id);
    const index = createPosMappingIndex(mappings);
    // Sitenin kalemi ve boyu satırla saklanır: ürün sonradan siteye bağlanınca satır yeniden gönderim olmadan bulunur
    // (src/server/lafpos/rematch.ts)
    const rows = day.lines.map((l) => {
      const m = resolvePosLine(l, bySite, (n) => index.get(n));
      return {
        date: day.date,
        posName: l.posName,
        productId: m.productId,
        siteMenuId: l.siteMenuId,
        slot: l.slot,
        qty: l.qty,
        revenue: l.revenue,
        isService: m.isService,
        // LafPOS'un hizmet işareti ayrıca: Satışlar'daki eşleştirme bu satırı ürüne bağlayamaz (sonraki gün sonu geri alırdı)
        lafposService: l.isService,
        createdAt: now,
      };
    });
    const report = { z: day.z, payments: day.payments, ikram: day.ikram, source: day.source, receivedAt: now };
    await tx
      .insert(s.posDayReports)
      .values({ date: day.date, ...report })
      .onConflictDoUpdate({ target: s.posDayReports.date, set: report });
    await tx.delete(s.posDailySales).where(eq(s.posDailySales.date, day.date));
    if (rows.length) await tx.insert(s.posDailySales).values(rows);
    const unmatched = rows
      .filter((r) => r.productId === null && !r.isService)
      .sort((a, b) => b.qty - a.qty || a.posName.localeCompare(b.posName, "tr"))
      .slice(0, UNMATCHED_MAX)
      .map((r) => r.posName);
    return { ok: true, lines: rows.length, matched: rows.filter((r) => r.productId !== null || r.isService).length, unmatched };
  });
}

/**
 * `POST /api/pos/gun`: imzalı gövdeyi denetler ve yazar. Yanıtlar: 200 `{ ok, date, lines, matched, unmatched }`
 * (`matched`: ürüne ya da hizmete bağlanan satır; `unmatched`: ürüne bağlanamayan POS adları, en çok 50), 400
 * `{ error: "invalid", field }` (ilk sorunlu alanın yolu), 401 `{ error: "unauthorized" }`, 409
 * `{ error: "z_conflict", date, zNo }` (o güne başka bir Z ile yazılmış özet var; `zNo` kayıtlı olanınki, hiçbir şey
 * yazılmadı), 413 `{ error: "too_large" }`, 503 `{ error: "not_configured" }`. Veritabanı hatası fırlar (uç 500 döner,
 * LafPOS yeniden dener).
 */
export async function receivePosDay(
  db: DB,
  input: { secret: string | null; url: URL; body: string; timestamp: string | null; signature: string | null },
  now: Date = new Date(),
): Promise<EndpointResult> {
  const check = checkLafposRequest({ ...input, method: "POST", maxBytes: POS_DAY_MAX_BYTES, now: now.getTime() });
  if (!check.ok) return { status: check.status, body: { error: check.error } };
  const parsed = parsePosDay(input.body, now);
  if (!parsed.ok) return { status: 400, body: { error: "invalid", field: parsed.field } };
  const r = await storePosDay(db, parsed.data, now);
  if (!r.ok) return { status: 409, body: { error: "z_conflict", date: parsed.data.date, zNo: r.zNo } };
  return { status: 200, body: { ok: true, date: parsed.data.date, lines: r.lines, matched: r.matched, unmatched: r.unmatched } };
}
