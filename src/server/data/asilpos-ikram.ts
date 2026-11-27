import "server-only";

import { and, asc, eq, gte, isNotNull, lte, or } from "drizzle-orm";

import { createPosMappingIndex } from "@/lib/calc/pos-paste";
import { posDaySchema, posZSchema, resolvePosLine, siteSlotKey, type PosIptal } from "@/lib/asilpos/day";
import { iptalWasteLines, asilposCompKind, asilposLineKind, asilposZKinds, type AsilposIkramData, type AsilposIkramLine, type AsilposZKinds } from "@/lib/asilpos/ikram";
import { isAsilposDay } from "@/lib/asilpos/switch";
import { countedTillIds, earliestSwitchDay, singleTill, switchDayFor, tillDayKey, type SwitchDays } from "@/lib/pos/tills";
import { productLabel } from "@/lib/waste";
import { currentBranchWhere, currentTillBranch } from "@/server/branch-scope";
import { getDb, schema as s, type DB } from "@/server/db";
import { loadSwitchDays } from "@/server/pos/tills";

/**
 * AsilPOS'un ikramları (denetim E-38; kural src/lib/asilpos/ikram.ts, docs/ASILPOS.md › İkram). Yalnız geçiş günü
 * seçiliyken ve geçiş gününden itibaren okunur: pos_day_reports.ikram satırları panel ürününe gün sonu satırlarıyla
 * aynı sırayla bağlanır (sitenin kalemi ve boyu, sonra POS adı eşleştirmesi; okuma anındaki bağla: ürün sonradan
 * bağlanınca geçmiş ikram da bulunur). Geçiş günü boşken bu dosyadaki hiçbir okuma yapılmaz.
 */

const ikramSchema = posDaySchema.shape.ikram;
/** Saklanan iptaller (Faz 2; bozuk ya da yoksa okunmaz): hazırlanmışları zayi tüketimidir */
const iptalSchema = posDaySchema.shape.iptal;

/** Okuyucu: veritabanı ya da işlem (yalnız select) */
type Reader = Pick<DB, "select">;

/** Kasa başına geçiş günleri (src/server/pos/tills.ts); işlem içinden de okunur (zayi kaydının reddi) */
export async function asilposSwitchDaysOf(db: Reader): Promise<SwitchDays> {
  return loadSwitchDays(db);
}

/**
 * Geçiş gününden itibaren (verilirse `from`..`to` aralığında) gelen gün sonlarının ikram ve zayi satırları ve günleri
 * (veri kümesi, Zayi'nin günü, kasa e-postası). İkramı okunamayan günün satırları atlanır, gün yine "gün sonu geldi"
 * sayılır. Faz 2: AsilPOS'un türü (`kind`) nedenin ön ekinden önce gelir; günün hazırlanmış iptalleri zayi satırı olarak
 * eklenir ("İptal (hazırlanmıştı)", src/lib/asilpos/ikram.ts iptalWasteLines): tüketime zayi olarak girer, waste_entries'e
 * yazılmaz.
 *
 * Çok şube (27 Kasım 2026): her kasanın günü kendi geçiş gününden itibaren (`switchDays`; kasası AsilPOS olmayan şubenin
 * deneme günü okunmaz). Şube verilirse yalnız o kasanın günleri; yoksa seçili şube ("Tümü"de bütün kasalar). Satırlar ve
 * `tillDays` (şube, gün) anahtarlı: iki kasanın aynı günü ayrı sayılır
 */
export async function loadAsilposIkram(db: Reader, switchDays: SwitchDays, range: { from?: string; to?: string } = {}, branchId?: string): Promise<AsilposIkramData> {
  const tills = countedTillIds(switchDays).filter((id) => branchId === undefined || id === branchId);
  const fromOf = (id: string) => {
    const sd = switchDayFor(switchDays, id)!;
    return range.from && range.from > sd ? range.from : sd;
  };
  // Şube verilirse yalnız o şubenin gün sonları (tek kasanın günü); yoksa seçili şube ("Tümü"de hepsi)
  const sube = branchId !== undefined ? undefined : await currentBranchWhere(s.posDayReports.branchId);
  const perTill = or(...tills.map((id) => and(eq(s.posDayReports.branchId, id), gte(s.posDayReports.date, fromOf(id)))));
  const [rows, linked, mappings] = await Promise.all([
    tills.length
      ? db
          .select({ date: s.posDayReports.date, branchId: s.posDayReports.branchId, ikram: s.posDayReports.ikram, iptal: s.posDayReports.iptal })
          .from(s.posDayReports)
          .where(and(perTill, range.to ? lte(s.posDayReports.date, range.to) : undefined, sube))
          .orderBy(asc(s.posDayReports.date), asc(s.posDayReports.branchId))
      : Promise.resolve([]),
    db.select({ id: s.products.id, siteMenuId: s.products.siteMenuId, slot: s.products.siteMenuSlot }).from(s.products).where(isNotNull(s.products.siteMenuId)),
    db.select().from(s.posMappings),
  ]);
  const bySite = new Map<string, number>();
  for (const p of linked) if (p.siteMenuId && p.slot) bySite.set(siteSlotKey(p.siteMenuId, p.slot), p.id);
  const index = createPosMappingIndex(mappings);
  const lines: AsilposIkramLine[] = [];
  const resolve = (l: { posName: string; siteMenuId: string | null; slot: "M" | "L" | null }) => resolvePosLine({ ...l, isService: false }, bySite, (n) => index.get(n));
  for (const r of rows) {
    const parsed = ikramSchema.safeParse(r.ikram);
    if (parsed.success) {
      for (const l of parsed.data) {
        const m = resolve(l);
        // Zayi satırı zayidir, öteki her satır (ödenmez dahil) ikram: AsilPOS'un türü, yoksa nedenin ön eki (asilposLineKind)
        const { kind, reason } = asilposLineKind(l.reason, l.kind);
        lines.push({
          date: r.date,
          branchId: r.branchId,
          kind,
          compKind: asilposCompKind(l.reason, l.kind),
          personKind: l.personKind ?? null,
          posName: l.posName,
          productId: m.productId,
          isService: m.isService,
          qty: l.qty,
          menuValue: l.menuValue,
          reason,
        });
      }
    }
    const iptal = r.iptal ? iptalSchema.safeParse(r.iptal) : null;
    if (iptal?.success && iptal.data) lines.push(...iptalWasteLines(r.date, iptal.data, resolve).map((l) => ({ ...l, branchId: r.branchId })));
  }
  const switchDay = earliestSwitchDay(Object.fromEntries(tills.map((id) => [id, switchDayFor(switchDays, id)]))) ?? earliestSwitchDay(switchDays) ?? "";
  return { switchDay, days: [...new Set(rows.map((r) => r.date))], tillDays: rows.map((r) => tillDayKey(r.branchId, r.date)), lines };
}

/** Bir günün AsilPOS ikramı, ürünün paneldeki adıyla (Zayi'nin günü, kasa raporunun özeti) */
export interface DayAsilposIkram {
  /** Gün AsilPOS günü (geçiş günü seçili ve gün ondan önce değil) */
  switchDay: string;
  /** O günün gün sonu geldi mi (gelmediyse ikram henüz yok; paneldeki ürün ikramı sayılır) */
  received: boolean;
  /** Z'deki ödenmez tutarı (yalnız yöneticinin e-postası) */
  offRevenue: number | null;
  /** Faz 2: AsilPOS'un Z'sindeki türe göre toplamlar ve satışın eşitliğinin girdileri (asilposIkramCheck); eski AsilPOS'ta null */
  zByKind: AsilposZKinds | null;
  /** Ad: paneldeki ürün adı, yoksa AsilPOS'taki ad. Hazırlanmış iptaller zayi satırı olarak burada (`iptal`) */
  lines: (AsilposIkramLine & { name: string })[];
  /** Faz 2: hazırlanmamış iptaller (tüketim değil, yalnız bilgi); gün iptal listesi taşımıyorsa (eski AsilPOS) null */
  unprepared: (PosIptal & { name: string })[] | null;
}

/**
 * Günün AsilPOS ikramı; gün AsilPOS günü değilse (geçiş günü boş ya da gün ondan önce) null: ekran, e-posta ve kasa
 * özeti bugünkü gibi yalnız panelden. Ad: ürün bulunduysa paneldeki adı ("Latte M"), yoksa AsilPOS'taki ad. Geçiş günü
 * şubenin kendi kasasınındır (switchDayFor): kasası ModPOS olan şubede hep null.
 */
export async function loadDayAsilposIkram(date: string, db: Reader = getDb(), branchId?: string): Promise<DayAsilposIkram | null> {
  // Günün gün sonu tek kasanındır: verilen şube, yoksa kasanın şubesi ("Tümü"de Tuzla)
  const sube = branchId ?? (await currentTillBranch());
  const switchDay = switchDayFor(await asilposSwitchDaysOf(db), sube);
  if (!switchDay || !isAsilposDay(date, switchDay)) return null;
  const [data, [day], products] = await Promise.all([
    loadAsilposIkram(db, singleTill(sube, switchDay), { from: date, to: date }, sube),
    db
      .select({ z: s.posDayReports.z, iptal: s.posDayReports.iptal })
      .from(s.posDayReports)
      .where(and(eq(s.posDayReports.date, date), eq(s.posDayReports.branchId, sube)))
      .limit(1),
    db.select({ id: s.products.id, name: s.products.name, size: s.products.size }).from(s.products),
  ]);
  const byId = new Map(products.map((p) => [p.id, p]));
  const z = day ? posZSchema.safeParse(day.z) : null;
  const off = (day?.z as { offRevenue?: unknown } | undefined)?.offRevenue;
  const zd = z?.success ? z.data : null;
  const iptal = day?.iptal ? iptalSchema.safeParse(day.iptal) : null;
  return {
    switchDay,
    received: Boolean(day),
    offRevenue: typeof off === "number" && Number.isFinite(off) ? off : null,
    zByKind: zd ? asilposZKinds(zd) : null,
    lines: data.lines.map((l) => {
      const p = l.productId !== null ? byId.get(l.productId) : undefined;
      return { ...l, name: p ? productLabel(p) : l.posName };
    }),
    unprepared: iptal?.success && iptal.data ? iptal.data.filter((l) => !l.prepared).map((l) => ({ ...l, name: l.posName })) : null,
  };
}
