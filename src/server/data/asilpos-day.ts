import "server-only";

import { and, count, eq, gte, inArray, lte } from "drizzle-orm";

import { branchDayKey } from "@/lib/cash-report";

import type { KasaEvidence } from "@/lib/cash-out-requests";
import { bankPosSchema, posDaySchema, posZSchema, type BankPos, type PosOffDevice, type PosOkc } from "@/lib/asilpos/day";
import { asilposDayDetail, type AsilposDayDetail } from "@/lib/asilpos/gun-ayrinti";
import { asilposDayOf, type AsilposDay } from "@/lib/asilpos/prefill";
import { branchSwitchDay, isAsilposDay } from "@/lib/asilpos/switch";
import { currentTillBranch } from "@/server/branch-scope";
import { getDb, schema as s, type DB } from "@/server/db";
import { asilposBranchId, asilposSwitchDay, loadBranchSwitchDay } from "@/server/asilpos/branch";
import { loadAsilposSwitchDay } from "@/server/asilpos/status";

/**
 * Kasa raporunun okuduğu (docs/ASILPOS.md › Kasa raporu): yalnız AsilPOS günlerinde, yani geçiş günü seçili ve gün ondan
 * önce değilse (src/lib/asilpos/switch.ts). Geçiş günü boşken ya da önceki bir günde AsilPOS'un gönderdiği gün (deneme)
 * hiçbir role görünmez, bant çıkmaz, form bugünkü gibi ModPOS'a göre elle doldurulur (sahibin 26 Ekim kararı).
 */
export async function loadKasaAsilposDay(date: string, db: DB = getDb(), branchId?: string): Promise<AsilposDay | null> {
  return (await loadKasaAsilpos(date, db, branchId)).day;
}

/**
 * Günün kasası ve AsilPOS özeti birlikte: `asilpos` gün AsilPOS günü mü (geçiş günü seçili ve gün ondan önce değil; o
 * günün gönderimi gelmemiş olsa da), `day` gelen özet (yoksa ya da AsilPOS günü değilse null). Kasa formu ve geç rapor
 * ikisine de bakar: AsilPOS gününde ModPOS Z fotoğrafı istenmez; AsilPOS'un gönderimi yoksa yazarkasa Z'si kanıttır.
 * Kasa tek şubenindir (verilen şube, yoksa kasanın şubesi): geçiş günü yalnız AsilPOS'un şubesinin kasasına uygulanır,
 * ModPOS'ta kalan şubenin her günü ModPOS günüdür (branchSwitchDay; denetim 21 Kasım #5).
 */
export async function loadKasaAsilpos(date: string, db: DB = getDb(), branchId?: string): Promise<{ asilpos: boolean; day: AsilposDay | null }> {
  const [switchDay, sube, asilposBranch] = await Promise.all([loadAsilposSwitchDay(db), branchId ?? currentTillBranch(), asilposBranchId(db)]);
  if (!isAsilposDay(date, branchSwitchDay(switchDay, sube, asilposBranch))) return { asilpos: false, day: null };
  return { asilpos: true, day: await loadAsilposDay(date, db, sube) };
}

/**
 * Gün sonu geldi ama çekmece sayılmadı (AsilPOS'ta sayım yok, kasa raporu yazılmadı; src/server/asilpos/gun-sonu.ts
 * "no-count"): Bugün ve zil "Kasa sayılmadı, AsilPOS'ta sayın" der, yönetici "girilmedi"nin nedenini görür. Yalnız şubenin
 * AsilPOS günleri; rapor girildiyse (elle ya da sayım gelince) gün listede yok
 */
export async function asilposNoCountDays(dates: readonly string[], branchId: string, db: DB = getDb()): Promise<Set<string>> {
  const out = new Set<string>();
  const switchDay = await loadBranchSwitchDay(branchId, db);
  const days = dates.filter((d) => isAsilposDay(d, switchDay));
  if (!days.length) return out;
  const [pos, reports] = await Promise.all([
    db
      .select({ date: s.posDayReports.date, z: s.posDayReports.z })
      .from(s.posDayReports)
      .where(and(eq(s.posDayReports.branchId, branchId), inArray(s.posDayReports.date, days))),
    db
      .select({ date: s.cashReports.date })
      .from(s.cashReports)
      .where(and(eq(s.cashReports.branchId, branchId), inArray(s.cashReports.date, days))),
  ]);
  const reported = new Set(reports.map((r) => r.date));
  for (const p of pos) {
    const z = posZSchema.safeParse(p.z);
    if (z.success && z.data.countedCash === null && !reported.has(p.date)) out.add(p.date);
  }
  return out;
}

/** Okuyucu: veritabanı ya da işlem (yalnız select) */
type Reader = Pick<DB, "select">;

/**
 * Günün kasa kanıtı (G8, docs/ASILPOS.md › Kasa raporu): ModPOS gününde (geçiş günü boş ya da gün ondan önce) ModPOS Z
 * fotoğrafı ("modpos-z"); AsilPOS gününde o günün AsilPOS gün sonu geldiyse o ("asilpos": fotoğraf gerekmez), gelmediyse
 * yazarkasa (Banka POS) Z fotoğrafı ("okc-z"). Geç rapor ve fotoğraf kaldırma aynı kurala bakar; işlem içinden de.
 * Geçiş günü yalnız AsilPOS'un şubesinin kasasınındır (branchSwitchDay): ModPOS'ta kalan şubede hep "modpos-z"
 */
export async function kasaEvidence(db: Reader, date: string, branchId?: string): Promise<KasaEvidence> {
  // Gün sonu şubenin kasasınındır: başka şubenin AsilPOS günü bu kasanın kanıtı sayılmaz
  const sube = branchId ?? (await currentTillBranch());
  const [switchDay, asilposBranch] = await Promise.all([asilposSwitchDay(db), asilposBranchId(db)]);
  if (!isAsilposDay(date, branchSwitchDay(switchDay, sube, asilposBranch))) return "modpos-z";
  const [day] = await db
    .select({ date: s.posDayReports.date })
    .from(s.posDayReports)
    .where(and(eq(s.posDayReports.date, date), eq(s.posDayReports.branchId, sube)))
    .limit(1);
  return day ? "asilpos" : "okc-z";
}

/**
 * Rapor AsilPOS'un otomatik raporu mu (asilpos_day_ends.report_id bu rapor, otomatik değerler kayıtlı). İşlem içinden de
 * okunur (fotoğraf kaldırma isteği, src/server/cash-outs/requests.ts)
 */
export async function asilposAutoReportOf(db: Reader, reportId: number): Promise<boolean> {
  const [row] = await db.select({ autoValues: s.asilposDayEnds.autoValues }).from(s.asilposDayEnds).where(eq(s.asilposDayEnds.reportId, reportId)).limit(1);
  return Boolean(row?.autoValues);
}

/**
 * [from, to] içindeki günlerin kasası ve AsilPOS özetleri (yöneticinin ay görünümü, zil): `of(gün, şube)`
 * loadKasaAsilpos'un aynısını verir (geçiş gününden önceki günde ya da geçiş günü boşken `{ asilpos: false, day: null }`).
 * Gün sonları (şube, gün) ile tutulur: "Tümü"de iki şubenin aynı günü birbirine karışmaz; şube verilmezse kasanın
 * şubesi (seçili fiziksel şube, "Tümü"de Tuzla). Geçiş günü yalnız AsilPOS'un şubesinin kasasınındır (branchSwitchDay).
 */
export async function loadKasaAsilposDays(
  from: string,
  to: string,
  db: DB = getDb(),
): Promise<(date: string, branchId?: string | null) => { asilpos: boolean; day: AsilposDay | null }> {
  const out = new Map<string, AsilposDay>();
  const [switchDay, sube, asilposBranch] = await Promise.all([loadAsilposSwitchDay(db), currentTillBranch(), asilposBranchId(db)]);
  const of = (date: string, branchId?: string | null) => {
    const b = branchId ?? sube;
    return isAsilposDay(date, branchSwitchDay(switchDay, b, asilposBranch)) ? { asilpos: true, day: out.get(branchDayKey(b, date)) ?? null } : { asilpos: false, day: null };
  };
  if (switchDay === null || to < switchDay) return of;
  const start = from > switchDay ? from : switchDay;
  const rows = await db
    .select({ date: s.posDayReports.date, branchId: s.posDayReports.branchId, z: s.posDayReports.z, offDevice: s.posDayReports.offDevice, okc: s.posDayReports.okc, receivedAt: s.posDayReports.receivedAt })
    .from(s.posDayReports)
    .where(and(gte(s.posDayReports.date, start), lte(s.posDayReports.date, to)));
  for (const r of rows) {
    const z = posZSchema.safeParse(r.z);
    if (z.success) out.set(branchDayKey(r.branchId, r.date), asilposDayOf(z.data, r.receivedAt, offDeviceOf(r.offDevice), okcOf(r.okc)));
  }
  return of;
}

/**
 * Günün AsilPOS özeti, geçiş gününe bakmadan (Kasa raporu loadKasaAsilposDay'den geçer): "AsilPOS'tan doldur"un verisi.
 * Yalnız Z özeti ve geliş anı okunur (sabit sütunlar); ödeme kanalları ve ikramlar okunmaz, personele gitmez. Gün
 * gelmediyse ya da özet okunamıyorsa null: düğme görünmez, form her zamanki gibi elle doldurulur.
 */
export async function loadAsilposDay(date: string, db: DB = getDb(), branchId?: string): Promise<AsilposDay | null> {
  // Tek kasanın günü: verilen şube, yoksa kasanın şubesi (seçili fiziksel şube, "Tümü"de Tuzla)
  const sube = branchId ?? (await currentTillBranch());
  const [row] = await db
    .select({ z: s.posDayReports.z, offDevice: s.posDayReports.offDevice, okc: s.posDayReports.okc, receivedAt: s.posDayReports.receivedAt })
    .from(s.posDayReports)
    .where(and(eq(s.posDayReports.date, date), eq(s.posDayReports.branchId, sube)))
    .limit(1);
  if (!row) return null;
  const z = posZSchema.safeParse(row.z);
  return z.success ? asilposDayOf(z.data, row.receivedAt, offDeviceOf(row.offDevice), okcOf(row.okc)) : null;
}

/**
 * Saklı `off_device` sütunu (Faz 2): gövdenin şemasıyla yeniden okunur; yoksa (eski gövde) ya da okunamıyorsa null.
 * Kasa raporunun kart, nakit ve toplam karşılaştırmaları bunu düşer (src/lib/asilpos/prefill.ts AsilposDay.offDevice)
 */
function offDeviceOf(raw: unknown): PosOffDevice | null {
  if (raw === null || raw === undefined) return null;
  return posDaySchema.shape.offDevice.parse(raw) ?? null;
}

/**
 * Saklı `okc` sütunu (gün sonu tam): yazarkasanın cihaz belgeleri; cihazda iptal edilen belge karşılaştırmalardan düşer
 * (asilposDayOf). Yoksa ya da okunamıyorsa null
 */
function okcOf(raw: unknown): PosOkc | null {
  if (raw === null || raw === undefined) return null;
  return posDaySchema.shape.okc.parse(raw) ?? null;
}

/**
 * Günün Pavo – AsilPOS kart karşılaştırması (src/lib/asilpos/bank-pos.ts), yalnız yöneticinin gün görünümü okur: gelmediyse
 * ya da okunamıyorsa null (kart görünmez)
 */
export async function loadAsilposBankPos(date: string, db: DB = getDb(), branchId?: string): Promise<BankPos | null> {
  const sube = branchId ?? (await currentTillBranch());
  const [row] = await db
    .select({ bankPos: s.posDayReports.bankPos })
    .from(s.posDayReports)
    .where(and(eq(s.posDayReports.date, date), eq(s.posDayReports.branchId, sube)))
    .limit(1);
  if (!row?.bankPos) return null;
  const b = bankPosSchema.safeParse(row.bankPos);
  return b.success ? b.data : null;
}

/**
 * Günün AsilPOS ayrıntısı (Faz 2; src/lib/asilpos/gun-ayrinti.ts), yalnız yöneticinin gün görünümü okur: yazarkasadan
 * geçmeyen, ödeme iptalleri, iptal edilen kalemler, yazarkasa Z no, KDV dökümü, gönderim sırası ve düzeltme; kaç kez
 * gönderildiği sürüm geçmişinden (pos_day_revisions). Gün gelmediyse ya da Z okunamıyorsa null; eski AsilPOS'un gününde
 * bölümler boş
 */
export async function loadAsilposDayDetail(date: string, db: DB = getDb(), branchId?: string): Promise<(AsilposDayDetail & { sends: number }) | null> {
  const sube = branchId ?? (await currentTillBranch());
  const where = and(eq(s.posDayReports.date, date), eq(s.posDayReports.branchId, sube));
  const [[row], sends] = await Promise.all([
    db
      .select({
        z: s.posDayReports.z,
        offDevice: s.posDayReports.offDevice,
        refunds: s.posDayReports.refunds,
        iptal: s.posDayReports.iptal,
        revision: s.posDayReports.revision,
        correction: s.posDayReports.correction,
        cashMoves: s.posDayReports.cashMoves,
        okc: s.posDayReports.okc,
        collections: s.posDayReports.collections,
        shiftCounts: s.posDayReports.shiftCounts,
        discountLines: s.posDayReports.discountLines,
      })
      .from(s.posDayReports)
      .where(where)
      .limit(1),
    db.select({ n: count() }).from(s.posDayRevisions).where(and(eq(s.posDayRevisions.date, date), eq(s.posDayRevisions.branchId, sube))),
  ]);
  if (!row) return null;
  const z = posZSchema.safeParse(row.z);
  if (!z.success) return null;
  const sh = posDaySchema.shape;
  const detail = asilposDayDetail({
    z: z.data,
    offDevice: row.offDevice ? sh.offDevice.parse(row.offDevice) : undefined,
    refunds: row.refunds ? sh.refunds.parse(row.refunds) : undefined,
    iptal: row.iptal ? sh.iptal.parse(row.iptal) : undefined,
    revision: row.revision ?? undefined,
    correction: row.correction ? sh.correction.parse(row.correction) : undefined,
    cashMoves: row.cashMoves ? sh.cashMoves.parse(row.cashMoves) : undefined,
    okc: okcOf(row.okc) ?? undefined,
    collections: row.collections ? sh.collections.parse(row.collections) : undefined,
    shiftCounts: row.shiftCounts ? sh.shiftCounts.parse(row.shiftCounts) : undefined,
    discountLines: row.discountLines ? sh.discountLines.parse(row.discountLines) : undefined,
  });
  return { ...detail, sends: Number(sends[0]?.n ?? 0) };
}
