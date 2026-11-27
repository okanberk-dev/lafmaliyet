import "server-only";

import { and, eq, isNotNull, sql } from "drizzle-orm";

import { createPosMappingIndex } from "@/lib/calc/pos-paste";
import { ESKI_KASA_KAYNAGI, GUN_KILIDI_ONEKI } from "@/lib/asilpos/eski-adlar";
import { parsePosDay, POS_DAY_MAX_BYTES, resolvePosLine, siteSlotKey, type PosDayPush } from "@/lib/asilpos/day";
import { checkAsilposRequest } from "@/lib/asilpos/request";
import { isAsilposDay } from "@/lib/asilpos/switch";
import { onAsilposDaySaved } from "@/server/closed-days";
import { schema as s, type DB } from "@/server/db";

import { asilposBranchId, switchDayOf } from "./branch";
import { detachAsilposCashOuts, syncAsilposCashOuts } from "./cash-moves";

/**
 * AsilPOS'un gün sonunun alınması (docs/ASILPOS.md): `POST /api/pos/gun`'un çekirdeği. Uç yalnız isteği okuyup buraya
 * verir; denetim sırası anahtar (503), boyut (413), imza (401), gövde (400), sonra yazım (o güne başka bir Z ile
 * yazılmış özet varsa 409, hiçbir şey yazılmaz). Veritabanını parametre alır
 * (tests/asilpos-db.test.ts doğrudan çalıştırır).
 */

/**
 * AsilPOS'un anahtarı (Şube ayarları'nda saklanan, yoksa ASILPOS_SYNC_SECRET; en az 32 karakter); yoksa uçların hepsi 503
 * (src/server/asilpos/branch.ts asilposSecret)
 */
export { asilposRequestSecret, asilposSecret } from "./branch";

export interface EndpointResult {
  status: number;
  body: Record<string, unknown>;
}

/** 200 yanıtında en çok bu kadar eşleşmeyen POS adı (AsilPOS bağlantı ekranında gösterir) */
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
 * eşleştirmesi (resolvePosLine). Gün AsilPOS günüyse ve satış varsa o günün kapalı işareti kalkar (onAsilposDaySaved).
 * Sayılan AsilPOS gününde kasa hareketleri "Kasadan çıkanlar"a satır satır yazılır (Faz 3; cash-moves.ts), aynı işlemde;
 * sayılmayan günde o günün AsilPOS satırları AsilPOS'tan ayrılır (detachAsilposCashOuts "drop"). `branch`: AsilPOS'un
 * şubesi (uç bir kez okur ve verir; verilmezse asilposBranchId).
 */
export async function storePosDay(db: DB, day: PosDayPush, now: Date = new Date(), branch?: string): Promise<StorePosDayResult> {
  // Gün sonunun şubesi: AsilPOS'un kurulu olduğu şube (türetilmiş, src/server/asilpos/branch.ts; 21 Kasım 2026'dan beri
  // Marina; Tuzla ModPOS'ta, geçiş günü de yalnız onun kasasınındır; docs/SUBE.md)
  const branchId = branch ?? (await asilposBranchId(db));
  return db.transaction(async (tx) => {
    // Kilit ve Z denetimi (gün, şube) başına: başka şubenin aynı günkü kaydı (ör. Tuzla'daki eski deneme günü) bu şubenin
    // gün sonunu engellemez
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${GUN_KILIDI_ONEKI}${branchId}:${day.date}`}))`);
    const [stored] = await tx
      .select({ z: s.posDayReports.z, receivedAt: s.posDayReports.receivedAt })
      .from(s.posDayReports)
      .where(and(eq(s.posDayReports.date, day.date), eq(s.posDayReports.branchId, branchId)))
      .limit(1);
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
    // (src/server/asilpos/rematch.ts)
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
        // Faz 2: indirimden önceki liste değeri ve ek işareti (eski AsilPOS göndermez: brüt boş, ek değil)
        gross: l.gross ?? null,
        isAddon: l.isAddon ?? false,
        // Şube fiyatı: dondurulan liste fiyatları (eski AsilPOS göndermez: null, durum "Bilinmiyor")
        listPrices: l.listPrices ?? null,
        isService: m.isService,
        // AsilPOS'un hizmet işareti ayrıca: Satışlar'daki eşleştirme bu satırı ürüne bağlayamaz (sonraki gün sonu geri alırdı)
        asilposService: l.isService,
        createdAt: now,
        branchId,
      };
    });
    // Pavo karşılaştırması (bankPos): alanı taşımayan gönderim (eski AsilPOS ya da Pavo sonucundan önceki düzeltme)
    // kayıtlı karşılaştırmayı silmez; alan geldiyse (null da) yerine geçer. Düzeltme de öyle: AsilPOS onu yalnız
    // düzeltmeden sonraki ilk gövdeyle yollar, sonraki gönderim (Pavo sonucu) silmez. Faz 2'nin gün verisi (yazarkasadan
    // geçmeyen, iadeler, iptaller, sıra) günün kendisidir: gelmediyse (eski AsilPOS) boşalır
    const report = {
      z: day.z,
      payments: day.payments,
      ikram: day.ikram,
      offDevice: day.offDevice ?? null,
      refunds: day.refunds ?? null,
      iptal: day.iptal ?? null,
      cashMoves: day.cashMoves ?? null,
      // Gün sonu tam (24 Kasım 2026): yazarkasanın cihaz belgeleri, tahsilatlar, vardiya sayımları, indirim satırları
      // (günün kendisi: gelmediyse boşalır, eski AsilPOS)
      okc: day.okc ?? null,
      collections: day.collections ?? null,
      shiftCounts: day.shiftCounts ?? null,
      discountLines: day.discountLines ?? null,
      revision: day.revision ?? null,
      // Gönderenin adı eski adla saklanır (yeni kasa yeni adı gönderse de; geri dönüş güvenli, plan A1)
      source: ESKI_KASA_KAYNAGI,
      receivedAt: now,
      ...(day.bankPos !== undefined ? { bankPos: day.bankPos } : {}),
      ...(day.correction !== undefined ? { correction: day.correction } : {}),
      // Çalışanların personel kimlikleri (LM-4b): bankPos gibi, alanı taşımayan gönderim kayıtlı listeyi silmez
      ...(day.workedStaffRefs !== undefined ? { workedStaff: day.workedStaffRefs } : {}),
    };
    // Çakışma hedefi (gün, şube) olmalı: şema 0056'dan sonra tek başına `date` benzersiz DEĞİL ve Postgres
    // "no unique or exclusion constraint matching" diye düşer.
    await tx
      .insert(s.posDayReports)
      .values({ date: day.date, branchId, ...report })
      .onConflictDoUpdate({ target: [s.posDayReports.date, s.posDayReports.branchId], set: report });
    await tx
      .delete(s.posDailySales)
      .where(and(eq(s.posDailySales.date, day.date), eq(s.posDailySales.branchId, branchId)));
    if (rows.length) await tx.insert(s.posDailySales).values(rows);
    // Sürüm geçmişi: kabul edilen her gövde, okunmuş hâliyle (yalnız eklenir; docs/ASILPOS.md › Sürüm geçmişi)
    await tx.insert(s.posDayRevisions).values({ date: day.date, branchId, revision: day.revision ?? null, zNo: day.z.zNo, correction: day.correction ?? null, body: day, receivedAt: now });
    // Satışlı AsilPOS günü kafenin açık olduğunun kanıtı (E-36): yalnız geçiş gününden sonraki günde, kasa raporunun
    // gelişi gibi o günün kapalı işaretini ve bekleyen "Kafe kapalıydı" bildirimini kaldırır; deneme günü dokunmaz.
    // Aynı günün satışlı gün sonu daha önce geldiyse (düzeltme) o andan sonra konan işaret yöneticinin kanıtı görerek
    // verdiği karardır: yeniden gönderim onu kaldırmaz
    const soldSince = stored && (stored.z.receipts > 0 || stored.z.zTotal > 0) ? stored.receivedAt : null;
    await onAsilposDaySaved(tx, day.date, day.z, now, soldSince, branchId);
    // Kasa hareketleri satır satır "Kasadan çıkanlar"a (Faz 3; cash-moves.ts): yalnız sayılan AsilPOS gününde ve gövde
    // listeyi taşıyorsa (eski AsilPOS ya da okunamayan liste satırlara dokunmaz). Deneme günü (geçişten önce) yazmaz; gün
    // sayılan iken yazılmış satırları varsa (geçiş günü sonradan sonraya alındı) onları AsilPOS'tan ayırır: AsilPOS'un
    // açtığı satır kalkar, sahiplenilen elle satır ve tedarikçi ödemesine bağlı satır kalır (inceleme LM-3)
    if (isAsilposDay(day.date, await switchDayOf(branchId, tx))) {
      if (day.cashMoves !== undefined) await syncAsilposCashOuts(tx, day.date, day.cashMoves, branchId);
    } else await detachAsilposCashOuts(tx, day.date, "drop", { branchId });
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
 * AsilPOS yeniden dener).
 */
export async function receivePosDay(
  db: DB,
  input: { secret: string | null; url: URL; body: string; timestamp: string | null; signature: string | null },
  now: Date = new Date(),
): Promise<EndpointResult> {
  const check = checkAsilposRequest({ ...input, method: "POST", maxBytes: POS_DAY_MAX_BYTES, now: now.getTime() });
  if (!check.ok) return { status: check.status, body: { error: check.error } };
  const parsed = parsePosDay(input.body, now);
  if (!parsed.ok) return { status: 400, body: { error: "invalid", field: parsed.field } };
  // Kasa başka şubeye ayarlıysa (ör. Tuzla'nın kasası ModPOS'ta): gün yazılmaz, kasa ayarını düzeltene kadar bekler.
  // Beklenen şube kütükten (kasa kaynağı AsilPOS olan şube; yoksa Marina, asilposBranchId)
  const expected = await asilposBranchId(db);
  if (parsed.data.sube && parsed.data.sube !== expected) return { status: 409, body: { error: "wrong_branch", sube: parsed.data.sube, expected } };
  const r = await storePosDay(db, parsed.data, now, expected);
  if (!r.ok) return { status: 409, body: { error: "z_conflict", date: parsed.data.date, zNo: r.zNo } };
  return { status: 200, body: { ok: true, date: parsed.data.date, lines: r.lines, matched: r.matched, unmatched: r.unmatched } };
}
