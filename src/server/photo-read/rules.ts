import "server-only";

import { asc, eq, gte } from "drizzle-orm";

import { businessDate, staffCanReport, staffDayEditable } from "@/lib/cash-report";
import { KEEP_DAYS, type PhotoKind } from "@/lib/photo-rules";
import type { CurrentUser } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";
import type { PhotoKindRules } from "@/server/storage/photo-access";

/*
 * Kasa ve fiş fotoğraflarının personel kuralları. Personel yalnız hâlâ düzenleyebildiği günlerin fotoğraflarını görür
 * ve o günlere fotoğraf ve kasadan çıkan satırı ekler; kasa raporunun kuralıyla aynı (staffDayEditable): bugün ve dün,
 * ama günün raporu varken ertesi günün raporu da girildiyse o gün kapanır. Daha eskisini yalnız yönetici.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Personel bu günün kasasına (rapor, kasadan çıkanlar, fotoğraflar) hâlâ dokunabilir mi; bir sorgu */
export async function staffDayOpen(day: string, db: Db | Tx = getDb()): Promise<boolean> {
  if (!staffCanReport(day)) return false;
  // Bu gün ve sonrası en çok iki rapor: günün raporu var mı, ondan sonra bir rapor var mı
  const rows = await db.select({ date: s.cashReports.date }).from(s.cashReports).where(gte(s.cashReports.date, day)).orderBy(asc(s.cashReports.date)).limit(2);
  return staffDayEditable(day, { hasReport: rows[0]?.date === day, laterReport: rows.some((r) => r.date > day) });
}

export const cashPhotoRules: PhotoKindRules = {
  keepDays: KEEP_DAYS["kasa-z"],
  async canView(me, photo) {
    if (me.role === "admin") return true;
    const [row] = await getDb()
      .select({ date: s.cashReports.date })
      .from(s.cashReportPhotos)
      .innerJoin(s.cashReports, eq(s.cashReports.id, s.cashReportPhotos.reportId))
      .where(eq(s.cashReportPhotos.photoId, photo.id))
      .limit(1);
    return Boolean(row && (await staffDayOpen(row.date)));
  },
};

/** Fiş fotoğrafı: kasadan çıkan satırının günü açıksa; yalnız harcamaya bağlı fiş yöneticinin */
export const receiptPhotoRules: PhotoKindRules = {
  keepDays: KEEP_DAYS.fis,
  async canView(me, photo) {
    if (me.role === "admin") return true;
    const [row] = await getDb().select({ date: s.cashOuts.date }).from(s.cashOuts).where(eq(s.cashOuts.photoId, photo.id)).limit(1);
    return Boolean(row && (await staffDayOpen(row.date)));
  },
};

/** Fotoğraf ekleme kuralı (POST /api/foto): gün gerekli ve ileri bir gün değil; personel yalnız açık günlere */
export async function canUploadPhoto(me: CurrentUser, kind: PhotoKind, day: string | null): Promise<boolean> {
  if (kind === "kontrol") return false; // kontrol listelerinin kendi yolu var
  if (!day || day > businessDate()) return false;
  return me.role === "admin" || staffDayOpen(day);
}
