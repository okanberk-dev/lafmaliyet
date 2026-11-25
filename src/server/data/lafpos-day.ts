import "server-only";

import { and, count, eq, gte, inArray, lte } from "drizzle-orm";

import { branchDayKey } from "@/lib/cash-report";

import type { KasaEvidence } from "@/lib/cash-out-requests";
import { readLafposSwitchDay } from "@/lib/constants";
import { bankPosSchema, posDaySchema, posZSchema, type BankPos, type PosOffDevice, type PosOkc } from "@/lib/lafpos/day";
import { lafposDayDetail, type LafposDayDetail } from "@/lib/lafpos/gun-ayrinti";
import { lafposDayOf, type LafposDay } from "@/lib/lafpos/prefill";
import { branchSwitchDay, isLafposDay, LAFPOS_SWITCH_KEY } from "@/lib/lafpos/switch";
import { currentTillBranch } from "@/server/branch-scope";
import { getDb, schema as s, type DB } from "@/server/db";
import { lafposBranchId, loadBranchSwitchDay } from "@/server/lafpos/branch";
import { loadLafposSwitchDay } from "@/server/lafpos/status";

/**
 * Kasa raporunun okuduğu (docs/LAFPOS.md › Kasa raporu): yalnız LafPOS günlerinde, yani geçiş günü seçili ve gün ondan
 * önce değilse (src/lib/lafpos/switch.ts). Geçiş günü boşken ya da önceki bir günde LafPOS'un gönderdiği gün (deneme)
 * hiçbir role görünmez, bant çıkmaz, form bugünkü gibi ModPOS'a göre elle doldurulur (sahibin 26 Ekim kararı).
 */
export async function loadKasaLafposDay(date: string, db: DB = getDb(), branchId?: string): Promise<LafposDay | null> {
  return (await loadKasaLafpos(date, db, branchId)).day;
}

/**
 * Günün kasası ve LafPOS özeti birlikte: `lafpos` gün LafPOS günü mü (geçiş günü seçili ve gün ondan önce değil; o
 * günün gönderimi gelmemiş olsa da), `day` gelen özet (yoksa ya da LafPOS günü değilse null). Kasa formu ve geç rapor
 * ikisine de bakar: LafPOS gününde ModPOS Z fotoğrafı istenmez; LafPOS'un gönderimi yoksa yazarkasa Z'si kanıttır.
 * Kasa tek şubenindir (verilen şube, yoksa kasanın şubesi): geçiş günü yalnız LafPOS'un şubesinin kasasına uygulanır,
 * ModPOS'ta kalan şubenin her günü ModPOS günüdür (branchSwitchDay; denetim 21 Kasım #5).
 */
export async function loadKasaLafpos(date: string, db: DB = getDb(), branchId?: string): Promise<{ lafpos: boolean; day: LafposDay | null }> {
  const [switchDay, sube, lafposBranch] = await Promise.all([loadLafposSwitchDay(db), branchId ?? currentTillBranch(), lafposBranchId(db)]);
  if (!isLafposDay(date, branchSwitchDay(switchDay, sube, lafposBranch))) return { lafpos: false, day: null };
  return { lafpos: true, day: await loadLafposDay(date, db, sube) };
}

/**
 * Gün sonu geldi ama çekmece sayılmadı (LafPOS'ta sayım yok, kasa raporu yazılmadı; src/server/lafpos/gun-sonu.ts
 * "no-count"): Bugün ve zil "Kasa sayılmadı, LafPOS'ta sayın" der, yönetici "girilmedi"nin nedenini görür. Yalnız şubenin
 * LafPOS günleri; rapor girildiyse (elle ya da sayım gelince) gün listede yok
 */
export async function lafposNoCountDays(dates: readonly string[], branchId: string, db: DB = getDb()): Promise<Set<string>> {
  const out = new Set<string>();
  const switchDay = await loadBranchSwitchDay(branchId, db);
  const days = dates.filter((d) => isLafposDay(d, switchDay));
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
 * Günün kasa kanıtı (G8, docs/LAFPOS.md › Kasa raporu): ModPOS gününde (geçiş günü boş ya da gün ondan önce) ModPOS Z
 * fotoğrafı ("modpos-z"); LafPOS gününde o günün LafPOS gün sonu geldiyse o ("lafpos": fotoğraf gerekmez), gelmediyse
 * yazarkasa (Banka POS) Z fotoğrafı ("okc-z"). Geç rapor ve fotoğraf kaldırma aynı kurala bakar; işlem içinden de.
 * Geçiş günü yalnız LafPOS'un şubesinin kasasınındır (branchSwitchDay): ModPOS'ta kalan şubede hep "modpos-z"
 */
export async function kasaEvidence(db: Reader, date: string, branchId?: string): Promise<KasaEvidence> {
  // Gün sonu şubenin kasasınındır: başka şubenin LafPOS günü bu kasanın kanıtı sayılmaz
  const sube = branchId ?? (await currentTillBranch());
  const [[setting], lafposBranch] = await Promise.all([
    db.select({ value: s.settings.value }).from(s.settings).where(eq(s.settings.key, LAFPOS_SWITCH_KEY)).limit(1),
    lafposBranchId(db),
  ]);
  if (!isLafposDay(date, branchSwitchDay(readLafposSwitchDay(setting?.value), sube, lafposBranch))) return "modpos-z";
  const [day] = await db
    .select({ date: s.posDayReports.date })
    .from(s.posDayReports)
    .where(and(eq(s.posDayReports.date, date), eq(s.posDayReports.branchId, sube)))
    .limit(1);
  return day ? "lafpos" : "okc-z";
}

/**
 * Rapor LafPOS'un otomatik raporu mu (lafpos_day_ends.report_id bu rapor, otomatik değerler kayıtlı). İşlem içinden de
 * okunur (fotoğraf kaldırma isteği, src/server/cash-outs/requests.ts)
 */
export async function lafposAutoReportOf(db: Reader, reportId: number): Promise<boolean> {
  const [row] = await db.select({ autoValues: s.lafposDayEnds.autoValues }).from(s.lafposDayEnds).where(eq(s.lafposDayEnds.reportId, reportId)).limit(1);
  return Boolean(row?.autoValues);
}

/**
 * [from, to] içindeki günlerin kasası ve LafPOS özetleri (yöneticinin ay görünümü, zil): `of(gün, şube)`
 * loadKasaLafpos'un aynısını verir (geçiş gününden önceki günde ya da geçiş günü boşken `{ lafpos: false, day: null }`).
 * Gün sonları (şube, gün) ile tutulur: "Tümü"de iki şubenin aynı günü birbirine karışmaz; şube verilmezse kasanın
 * şubesi (seçili fiziksel şube, "Tümü"de Tuzla). Geçiş günü yalnız LafPOS'un şubesinin kasasınındır (branchSwitchDay).
 */
export async function loadKasaLafposDays(
  from: string,
  to: string,
  db: DB = getDb(),
): Promise<(date: string, branchId?: string | null) => { lafpos: boolean; day: LafposDay | null }> {
  const out = new Map<string, LafposDay>();
  const [switchDay, sube, lafposBranch] = await Promise.all([loadLafposSwitchDay(db), currentTillBranch(), lafposBranchId(db)]);
  const of = (date: string, branchId?: string | null) => {
    const b = branchId ?? sube;
    return isLafposDay(date, branchSwitchDay(switchDay, b, lafposBranch)) ? { lafpos: true, day: out.get(branchDayKey(b, date)) ?? null } : { lafpos: false, day: null };
  };
  if (switchDay === null || to < switchDay) return of;
  const start = from > switchDay ? from : switchDay;
  const rows = await db
    .select({ date: s.posDayReports.date, branchId: s.posDayReports.branchId, z: s.posDayReports.z, offDevice: s.posDayReports.offDevice, okc: s.posDayReports.okc, receivedAt: s.posDayReports.receivedAt })
    .from(s.posDayReports)
    .where(and(gte(s.posDayReports.date, start), lte(s.posDayReports.date, to)));
  for (const r of rows) {
    const z = posZSchema.safeParse(r.z);
    if (z.success) out.set(branchDayKey(r.branchId, r.date), lafposDayOf(z.data, r.receivedAt, offDeviceOf(r.offDevice), okcOf(r.okc)));
  }
  return of;
}

/**
 * Günün LafPOS özeti, geçiş gününe bakmadan (Kasa raporu loadKasaLafposDay'den geçer): "LafPOS'tan doldur"un verisi.
 * Yalnız Z özeti ve geliş anı okunur (sabit sütunlar); ödeme kanalları ve ikramlar okunmaz, personele gitmez. Gün
 * gelmediyse ya da özet okunamıyorsa null: düğme görünmez, form her zamanki gibi elle doldurulur.
 */
export async function loadLafposDay(date: string, db: DB = getDb(), branchId?: string): Promise<LafposDay | null> {
  // Tek kasanın günü: verilen şube, yoksa kasanın şubesi (seçili fiziksel şube, "Tümü"de Tuzla)
  const sube = branchId ?? (await currentTillBranch());
  const [row] = await db
    .select({ z: s.posDayReports.z, offDevice: s.posDayReports.offDevice, okc: s.posDayReports.okc, receivedAt: s.posDayReports.receivedAt })
    .from(s.posDayReports)
    .where(and(eq(s.posDayReports.date, date), eq(s.posDayReports.branchId, sube)))
    .limit(1);
  if (!row) return null;
  const z = posZSchema.safeParse(row.z);
  return z.success ? lafposDayOf(z.data, row.receivedAt, offDeviceOf(row.offDevice), okcOf(row.okc)) : null;
}

/**
 * Saklı `off_device` sütunu (Faz 2): gövdenin şemasıyla yeniden okunur; yoksa (eski gövde) ya da okunamıyorsa null.
 * Kasa raporunun kart, nakit ve toplam karşılaştırmaları bunu düşer (src/lib/lafpos/prefill.ts LafposDay.offDevice)
 */
function offDeviceOf(raw: unknown): PosOffDevice | null {
  if (raw === null || raw === undefined) return null;
  return posDaySchema.shape.offDevice.parse(raw) ?? null;
}

/**
 * Saklı `okc` sütunu (gün sonu tam): yazarkasanın cihaz belgeleri; cihazda iptal edilen belge karşılaştırmalardan düşer
 * (lafposDayOf). Yoksa ya da okunamıyorsa null
 */
function okcOf(raw: unknown): PosOkc | null {
  if (raw === null || raw === undefined) return null;
  return posDaySchema.shape.okc.parse(raw) ?? null;
}

/**
 * Günün Pavo – LafPOS kart karşılaştırması (src/lib/lafpos/bank-pos.ts), yalnız yöneticinin gün görünümü okur: gelmediyse
 * ya da okunamıyorsa null (kart görünmez)
 */
export async function loadLafposBankPos(date: string, db: DB = getDb(), branchId?: string): Promise<BankPos | null> {
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
 * Günün LafPOS ayrıntısı (Faz 2; src/lib/lafpos/gun-ayrinti.ts), yalnız yöneticinin gün görünümü okur: yazarkasadan
 * geçmeyen, ödeme iptalleri, iptal edilen kalemler, yazarkasa Z no, KDV dökümü, gönderim sırası ve düzeltme; kaç kez
 * gönderildiği sürüm geçmişinden (pos_day_revisions). Gün gelmediyse ya da Z okunamıyorsa null; eski LafPOS'un gününde
 * bölümler boş
 */
export async function loadLafposDayDetail(date: string, db: DB = getDb(), branchId?: string): Promise<(LafposDayDetail & { sends: number }) | null> {
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
  const detail = lafposDayDetail({
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
