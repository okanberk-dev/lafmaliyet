import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { bankPosSchema, posDaySchema, posZSchema, type BankPos, type PosDayZ, type PosPayment } from "@/lib/asilpos/day";
import { getDb, schema as s, type DB } from "@/server/db";

/*
 * AsilPOS gün sonunun YÖNETİCİ okuyucuları (panel asistanının gun_sonu aracı; src/server/assistant-reads). Ödeme
 * kanalları ve otomatik raporun eksikleri burada okunur; personelin de okuduğu src/server/data/asilpos-day.ts bunlara
 * dokunmaz (tests/personel-sizinti-kasa.test.ts). Yalnız okur.
 */

/** Okuyucu: veritabanı ya da işlem (yalnız select) */
type Reader = Pick<DB, "select">;

/**
 * Bir günün AsilPOS gün sonu, yöneticinin okuması için (panel asistanının gun_sonu aracı; src/server/assistant-reads):
 * Z ve kasa alanları, ödeme türleri, Pavo karşılaştırması, son gönderimin anı ve sırası, otomatik raporun durumu
 * (asilpos_day_ends: rapor yazıldı mı, eksikler). Geçiş gününe bakmaz (okuyan ayırır). İkram satırları ve gerekçe metinleri
 * okunmaz (ikram loadDayAsilposIkram'dan). Yalnız okur: src/server/asilpos/gun-sonu.ts'in loadStoredDay'i yazıcının
 * içindedir, dışa açık değil.
 */
export interface AsilposDayEndRead {
  receivedAt: string;
  /** AsilPOS'un gönderim sırası; eski AsilPOS göndermez: null */
  revision: number | null;
  z: PosDayZ;
  payments: PosPayment[];
  bankPos: BankPos | null;
  /** Otomatik kasa raporu: yazılan raporun kimliği (elle girilmişse ya da silindiyse null) ve eksikler; satır yoksa null */
  auto: { reportId: number | null; missing: string[] } | null;
}

export async function loadAsilposDayEnd(date: string, branchId: string, db: Reader = getDb()): Promise<AsilposDayEndRead | null> {
  const where = and(eq(s.posDayReports.date, date), eq(s.posDayReports.branchId, branchId));
  const [[row], [auto]] = await Promise.all([
    db
      .select({ z: s.posDayReports.z, payments: s.posDayReports.payments, bankPos: s.posDayReports.bankPos, revision: s.posDayReports.revision, receivedAt: s.posDayReports.receivedAt })
      .from(s.posDayReports)
      .where(where)
      .limit(1),
    db
      .select({ reportId: s.asilposDayEnds.reportId, missing: s.asilposDayEnds.missing })
      .from(s.asilposDayEnds)
      .where(and(eq(s.asilposDayEnds.date, date), eq(s.asilposDayEnds.branchId, branchId)))
      .limit(1),
  ]);
  if (!row) return null;
  const z = posZSchema.safeParse(row.z);
  if (!z.success) return null;
  const payments = posDaySchema.shape.payments.safeParse(row.payments);
  const bank = row.bankPos ? bankPosSchema.safeParse(row.bankPos) : null;
  return {
    receivedAt: row.receivedAt.toISOString(),
    revision: row.revision ?? null,
    z: z.data,
    payments: payments.success ? payments.data : [],
    bankPos: bank?.success ? bank.data : null,
    auto: auto ? { reportId: auto.reportId ?? null, missing: Array.isArray(auto.missing) ? auto.missing.filter((m): m is string => typeof m === "string") : [] } : null,
  };
}

/** Verilen günlerin AsilPOS Z toplamları (kıyas: dün, geçen hafta); gelmeyen gün yok. Yalnız okur */
export async function loadAsilposZTotals(dates: readonly string[], branchId: string, db: Reader = getDb()): Promise<Map<string, number>> {
  if (!dates.length) return new Map();
  const rows = await db
    .select({ date: s.posDayReports.date, z: s.posDayReports.z })
    .from(s.posDayReports)
    .where(and(inArray(s.posDayReports.date, [...dates]), eq(s.posDayReports.branchId, branchId)));
  const out = new Map<string, number>();
  for (const r of rows) {
    const z = posZSchema.safeParse(r.z);
    if (z.success) out.set(r.date, z.data.zTotal);
  }
  return out;
}
