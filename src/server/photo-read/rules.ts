import "server-only";

import { eq } from "drizzle-orm";

import { businessDate, staffCanReport } from "@/lib/cash-report";
import { KEEP_DAYS, type PhotoKind } from "@/lib/photo-rules";
import type { CurrentUser } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";
import type { PhotoKindRules } from "@/server/storage/photo-access";

/*
 * Kasa ve fiş fotoğraflarının personel kuralları. Personel yalnız hâlâ düzenleyebildiği günlerin (bugün ve dün, kasa
 * raporunun kuralı) fotoğraflarını görür ve o günlere fotoğraf ekler; daha eskisini yalnız yönetici. Kasa grubunun
 * kilidi (ertesi günün raporu girilince dün kapanır) gelince bu iki kural ona bakar.
 */

/** Personel bu günün kasasına fotoğraf ve satır ekleyebilir mi */
export function staffDayOpen(day: string): boolean {
  return staffCanReport(day);
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
    return Boolean(row && staffDayOpen(row.date));
  },
};

/** Fiş fotoğrafı: kasadan çıkan satırının günü açıksa; yalnız harcamaya bağlı fiş yöneticinin */
export const receiptPhotoRules: PhotoKindRules = {
  keepDays: KEEP_DAYS.fis,
  async canView(me, photo) {
    if (me.role === "admin") return true;
    const [row] = await getDb().select({ date: s.cashOuts.date }).from(s.cashOuts).where(eq(s.cashOuts.photoId, photo.id)).limit(1);
    return Boolean(row && staffDayOpen(row.date));
  },
};

/** Fotoğraf ekleme kuralı (POST /api/foto): gün gerekli ve ileri bir gün değil; personel yalnız açık günlere */
export function canUploadPhoto(me: CurrentUser, kind: PhotoKind, day: string | null): boolean {
  if (kind === "kontrol") return false; // kontrol listelerinin kendi yolu var
  if (!day || day > businessDate()) return false;
  return me.role === "admin" || staffDayOpen(day);
}
