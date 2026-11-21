import "server-only";

import { and, asc, eq, gte, isNotNull, lte } from "drizzle-orm";

import { createPosMappingIndex } from "@/lib/calc/pos-paste";
import { readLafposSwitchDay } from "@/lib/constants";
import { posDaySchema, resolvePosLine, siteSlotKey } from "@/lib/lafpos/day";
import { lafposLineKind, type LafposIkramData, type LafposIkramLine } from "@/lib/lafpos/ikram";
import { branchSwitchDay, isLafposDay, LAFPOS_SWITCH_KEY } from "@/lib/lafpos/switch";
import { productLabel } from "@/lib/waste";
import { currentBranchWhere, currentTillBranch } from "@/server/branch-scope";
import { getDb, schema as s, type DB } from "@/server/db";

/**
 * LafPOS'un ikramları (denetim E-38; kural src/lib/lafpos/ikram.ts, docs/LAFPOS.md › İkram). Yalnız geçiş günü
 * seçiliyken ve geçiş gününden itibaren okunur: pos_day_reports.ikram satırları panel ürününe gün sonu satırlarıyla
 * aynı sırayla bağlanır (sitenin kalemi ve boyu, sonra POS adı eşleştirmesi; okuma anındaki bağla: ürün sonradan
 * bağlanınca geçmiş ikram da bulunur). Geçiş günü boşken bu dosyadaki hiçbir okuma yapılmaz.
 */

const ikramSchema = posDaySchema.shape.ikram;

/** Okuyucu: veritabanı ya da işlem (yalnız select) */
type Reader = Pick<DB, "select">;

/** Geçiş günü (yoksa null); işlem içinden de okunur (zayi kaydının reddi) */
export async function lafposSwitchDayOf(db: Reader): Promise<string | null> {
  const [setting] = await db.select({ value: s.settings.value }).from(s.settings).where(eq(s.settings.key, LAFPOS_SWITCH_KEY)).limit(1);
  return readLafposSwitchDay(setting?.value);
}

/**
 * Geçiş gününden itibaren (verilirse `from`..`to` aralığında) gelen gün sonlarının ikram ve zayi satırları ve günleri
 * (veri kümesi, Zayi'nin günü, kasa e-postası). İkramı okunamayan günün satırları atlanır, gün yine "gün sonu geldi"
 * sayılır.
 */
export async function loadLafposIkram(db: Reader, switchDay: string, range: { from?: string; to?: string } = {}, branchId?: string): Promise<LafposIkramData> {
  const from = range.from && range.from > switchDay ? range.from : switchDay;
  // Şube verilirse yalnız o şubenin gün sonları (tek kasanın günü); yoksa seçili şube ("Tümü"de hepsi)
  const sube = branchId !== undefined ? eq(s.posDayReports.branchId, branchId) : await currentBranchWhere(s.posDayReports.branchId);
  const [rows, linked, mappings] = await Promise.all([
    db
      .select({ date: s.posDayReports.date, ikram: s.posDayReports.ikram })
      .from(s.posDayReports)
      .where(and(gte(s.posDayReports.date, from), range.to ? lte(s.posDayReports.date, range.to) : undefined, sube))
      .orderBy(asc(s.posDayReports.date)),
    db.select({ id: s.products.id, siteMenuId: s.products.siteMenuId, slot: s.products.siteMenuSlot }).from(s.products).where(isNotNull(s.products.siteMenuId)),
    db.select().from(s.posMappings),
  ]);
  const bySite = new Map<string, number>();
  for (const p of linked) if (p.siteMenuId && p.slot) bySite.set(siteSlotKey(p.siteMenuId, p.slot), p.id);
  const index = createPosMappingIndex(mappings);
  const lines: LafposIkramLine[] = [];
  for (const r of rows) {
    const parsed = ikramSchema.safeParse(r.ikram);
    if (!parsed.success) continue;
    for (const l of parsed.data) {
      const m = resolvePosLine({ ...l, isService: false }, bySite, (n) => index.get(n));
      // "Zayi: Döküldü" zayidir, öteki her satır (ödenmez dahil) ikram (src/lib/lafpos/ikram.ts lafposLineKind)
      const { kind, reason } = lafposLineKind(l.reason);
      lines.push({ date: r.date, kind, posName: l.posName, productId: m.productId, qty: l.qty, menuValue: l.menuValue, reason });
    }
  }
  return { switchDay, days: rows.map((r) => r.date), lines };
}

/** Bir günün LafPOS ikramı, ürünün paneldeki adıyla (Zayi'nin günü, kasa raporunun özeti) */
export interface DayLafposIkram {
  /** Gün LafPOS günü (geçiş günü seçili ve gün ondan önce değil) */
  switchDay: string;
  /** O günün gün sonu geldi mi (gelmediyse ikram henüz yok; paneldeki ürün ikramı sayılır) */
  received: boolean;
  /** Z'deki ödenmez tutarı (yalnız yöneticinin e-postası) */
  offRevenue: number | null;
  lines: (LafposIkramLine & { name: string })[];
}

/**
 * Günün LafPOS ikramı; gün LafPOS günü değilse (geçiş günü boş ya da gün ondan önce) null: ekran, e-posta ve kasa
 * özeti bugünkü gibi yalnız panelden. Ad: ürün bulunduysa paneldeki adı ("Latte M"), yoksa LafPOS'taki ad. Geçiş günü
 * yalnız LafPOS'un şubesinin kasasınındır (branchSwitchDay): ModPOS'ta kalan şubede hep null.
 */
export async function loadDayLafposIkram(date: string, db: Reader = getDb(), branchId?: string): Promise<DayLafposIkram | null> {
  // Günün gün sonu tek kasanındır: verilen şube, yoksa kasanın şubesi ("Tümü"de Tuzla)
  const sube = branchId ?? (await currentTillBranch());
  const switchDay = branchSwitchDay(await lafposSwitchDayOf(db), sube);
  if (!switchDay || !isLafposDay(date, switchDay)) return null;
  const [data, [day], products] = await Promise.all([
    loadLafposIkram(db, switchDay, { from: date, to: date }, sube),
    db.select({ z: s.posDayReports.z }).from(s.posDayReports).where(and(eq(s.posDayReports.date, date), eq(s.posDayReports.branchId, sube))).limit(1),
    db.select({ id: s.products.id, name: s.products.name, size: s.products.size }).from(s.products),
  ]);
  const byId = new Map(products.map((p) => [p.id, p]));
  const off = (day?.z as { offRevenue?: unknown } | undefined)?.offRevenue;
  return {
    switchDay,
    received: Boolean(day),
    offRevenue: typeof off === "number" && Number.isFinite(off) ? off : null,
    lines: data.lines.map((l) => {
      const p = l.productId !== null ? byId.get(l.productId) : undefined;
      return { ...l, name: p ? productLabel(p) : l.posName };
    }),
  };
}
