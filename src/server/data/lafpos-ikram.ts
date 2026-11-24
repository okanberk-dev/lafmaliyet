import "server-only";

import { and, asc, eq, gte, isNotNull, lte } from "drizzle-orm";

import { createPosMappingIndex } from "@/lib/calc/pos-paste";
import { readLafposSwitchDay } from "@/lib/constants";
import { posDaySchema, posZSchema, resolvePosLine, siteSlotKey, type PosIptal } from "@/lib/lafpos/day";
import { iptalWasteLines, lafposCompKind, lafposLineKind, type LafposIkramData, type LafposIkramLine } from "@/lib/lafpos/ikram";
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
/** Saklanan iptaller (Faz 2; bozuk ya da yoksa okunmaz): hazırlanmışları zayi tüketimidir */
const iptalSchema = posDaySchema.shape.iptal;

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
 * sayılır. Faz 2: LafPOS'un türü (`kind`) nedenin ön ekinden önce gelir; günün hazırlanmış iptalleri zayi satırı olarak
 * eklenir ("İptal (hazırlanmıştı)", src/lib/lafpos/ikram.ts iptalWasteLines): tüketime zayi olarak girer, waste_entries'e
 * yazılmaz.
 */
export async function loadLafposIkram(db: Reader, switchDay: string, range: { from?: string; to?: string } = {}, branchId?: string): Promise<LafposIkramData> {
  const from = range.from && range.from > switchDay ? range.from : switchDay;
  // Şube verilirse yalnız o şubenin gün sonları (tek kasanın günü); yoksa seçili şube ("Tümü"de hepsi)
  const sube = branchId !== undefined ? eq(s.posDayReports.branchId, branchId) : await currentBranchWhere(s.posDayReports.branchId);
  const [rows, linked, mappings] = await Promise.all([
    db
      .select({ date: s.posDayReports.date, ikram: s.posDayReports.ikram, iptal: s.posDayReports.iptal })
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
  const resolve = (l: { posName: string; siteMenuId: string | null; slot: "M" | "L" | null }) => resolvePosLine({ ...l, isService: false }, bySite, (n) => index.get(n));
  for (const r of rows) {
    const parsed = ikramSchema.safeParse(r.ikram);
    if (parsed.success) {
      for (const l of parsed.data) {
        const m = resolve(l);
        // Zayi satırı zayidir, öteki her satır (ödenmez dahil) ikram: LafPOS'un türü, yoksa nedenin ön eki (lafposLineKind)
        const { kind, reason } = lafposLineKind(l.reason, l.kind);
        lines.push({
          date: r.date,
          kind,
          compKind: lafposCompKind(l.reason, l.kind),
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
    if (iptal?.success && iptal.data) lines.push(...iptalWasteLines(r.date, iptal.data, resolve));
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
  /** Faz 2: LafPOS'un Z'sindeki türe göre toplamlar (lafposIkramCheck); eski LafPOS'ta null */
  zByKind: { ikram: number; odenmez: number; zayi: number } | null;
  /** Ad: paneldeki ürün adı, yoksa LafPOS'taki ad. Hazırlanmış iptaller zayi satırı olarak burada (`iptal`) */
  lines: (LafposIkramLine & { name: string })[];
  /** Faz 2: hazırlanmamış iptaller (tüketim değil, yalnız bilgi); gün iptal listesi taşımıyorsa (eski LafPOS) null */
  unprepared: (PosIptal & { name: string })[] | null;
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
    zByKind: zd && zd.ikramTotal !== undefined && zd.odenmezTotal !== undefined && zd.zayiTotal !== undefined ? { ikram: zd.ikramTotal, odenmez: zd.odenmezTotal, zayi: zd.zayiTotal } : null,
    lines: data.lines.map((l) => {
      const p = l.productId !== null ? byId.get(l.productId) : undefined;
      return { ...l, name: p ? productLabel(p) : l.posName };
    }),
    unprepared: iptal?.success && iptal.data ? iptal.data.filter((l) => !l.prepared).map((l) => ({ ...l, name: l.posName })) : null,
  };
}
