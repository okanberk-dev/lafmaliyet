import "server-only";

import { and, asc, eq, gte } from "drizzle-orm";

import { businessDate, staffCanReport, staffDayEditable, staffLateDay } from "@/lib/cash-report";
import { KEEP_DAYS, uploadRule, type PhotoKind } from "@/lib/photo-rules";
import type { CurrentUser } from "@/server/auth/dal";
import { currentWriteBranch } from "@/server/branch-scope";
import { isClosedDay } from "@/server/closed-days";
import { getDb, schema as s } from "@/server/db";
import type { PhotoKindRules } from "@/server/storage/photo-access";

/*
 * Kasa ve fiş fotoğraflarının personel kuralları. Personel yalnız hâlâ düzenleyebildiği günlerin fotoğraflarını görür
 * ve o günlere fotoğraf ve kasadan çıkan satırı ekler; kasa raporunun kuralıyla aynı (staffDayEditable): bugün ve dün,
 * ama günün raporu varken ertesi günün raporu da girildiyse o gün kapanır. Daha eskisini yalnız yönetici; geç kasa
 * raporu (raporu olmayan, son 14 günden biri) için personel o güne Z ve POS fotoğrafı, kasadan çıkan isteği için son 7
 * güne fiş ekler (bağlanmadan bekler; kendi yüklediğini görür).
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Personel bu şubenin bu günkü kasasına (rapor, kasadan çıkanlar, fotoğraflar) hâlâ dokunabilir mi; bir sorgu. Kilit şube
 * içinde (denetim KP-06): Marina'nın bugünkü raporu Tuzla'nın dününü kapatmaz. `branchId` verilmezse personelin yazdığı
 * şube (seçili şube, "Tümü"de Tuzla); satırın ya da raporun şubesi bilinen yerde (fotoğraf, kasadan çıkan) o verilir
 */
export async function staffDayOpen(day: string, db: Db | Tx = getDb(), now: Date = new Date(), branchId?: string): Promise<boolean> {
  if (!staffCanReport(day, now)) return false;
  const branch = branchId ?? (await currentWriteBranch());
  // Bu gün ve sonrası en çok iki rapor: günün raporu var mı, ondan sonra bir rapor var mı
  const rows = await db
    .select({ date: s.cashReports.date })
    .from(s.cashReports)
    .where(and(gte(s.cashReports.date, day), eq(s.cashReports.branchId, branch)))
    .orderBy(asc(s.cashReports.date))
    .limit(2);
  return staffDayEditable(day, { hasReport: rows[0]?.date === day, laterReport: rows.some((r) => r.date > day) }, now);
}

export const cashPhotoRules: PhotoKindRules = {
  keepDays: KEEP_DAYS["kasa-z"],
  async canView(me, photo) {
    if (me.role === "admin") return true;
    const [row] = await getDb()
      .select({ date: s.cashReports.date, branchId: s.cashReports.branchId })
      .from(s.cashReportPhotos)
      .innerJoin(s.cashReports, eq(s.cashReports.id, s.cashReportPhotos.reportId))
      .where(eq(s.cashReportPhotos.photoId, photo.id))
      .limit(1);
    return Boolean(row && (await staffDayOpen(row.date, getDb(), new Date(), row.branchId)));
  },
};

/** Yazarkasa Z'si: personel kuralı kasanınki, saklama kendi süresi (400 gün, docs/planlar/okc-z.md D12) */
export const okcPhotoRules: PhotoKindRules = { ...cashPhotoRules, keepDays: KEEP_DAYS["kasa-okc"] };

/** Fiş fotoğrafı: kasadan çıkan satırının günü açıksa; yalnız harcamaya bağlı fiş yöneticinin */
export const receiptPhotoRules: PhotoKindRules = {
  keepDays: KEEP_DAYS.fis,
  async canView(me, photo) {
    if (me.role === "admin") return true;
    const [row] = await getDb().select({ date: s.cashOuts.date, branchId: s.cashOuts.branchId }).from(s.cashOuts).where(eq(s.cashOuts.photoId, photo.id)).limit(1);
    return Boolean(row && (await staffDayOpen(row.date, getDb(), new Date(), row.branchId)));
  },
};

/**
 * Personel bu güne geç kasa raporu (yöneticinin onayıyla) girebilir mi: geç rapor penceresinde (dünden eski, son 14
 * takvim günü; staffLateDay), şubenin ilk raporunun gününden sonra, o gün şubenin raporu yok ve gün şube için kapalı
 * işaretli değil. Şube personelin yazdığı şube (verilmezse seçili şube, "Tümü"de Tuzla; denetim KP-06). Fotoğraf ekleme
 * ve geç rapor isteği aynı kurala bakar (docs/KASA-RAPORU.md › Geç rapor).
 */
export async function staffLateDayOpen(day: string, db: Db | Tx = getDb(), branchId?: string): Promise<boolean> {
  if (!staffLateDay(day)) return false;
  const branch = branchId ?? (await currentWriteBranch());
  const own = eq(s.cashReports.branchId, branch);
  const [[first], [same]] = await Promise.all([
    db.select({ date: s.cashReports.date }).from(s.cashReports).where(own).orderBy(asc(s.cashReports.date)).limit(1),
    db
      .select({ date: s.cashReports.date })
      .from(s.cashReports)
      .where(and(eq(s.cashReports.date, day), own))
      .limit(1),
  ]);
  if (!first || first.date >= day || same) return false;
  return !(await isClosedDay(day, db, branch));
}

/**
 * Fotoğraf ekleme kuralı (POST /api/foto ve yeniden okuma; src/lib/photo-rules.ts uploadRule): gün gerekli ve ileri bir
 * gün değil; personel Z ve POS fotoğrafını açık güne ya da geç rapor gününe, fişi son 7 güne (kapanmış ya da eski günde
 * kasadan çıkan isteğine; fiş bağlanmadan bekler)
 */
export async function canUploadPhoto(me: CurrentUser, kind: PhotoKind, day: string | null): Promise<boolean> {
  if (kind === "kontrol") return false; // kontrol listelerinin kendi yolu var
  const rule = uploadRule(me.role, kind, day, businessDate());
  if (rule === "no" || !day) return false;
  if (rule === "yes") return true;
  if (await staffDayOpen(day)) return true;
  return rule === "open-or-late" && staffLateDayOpen(day);
}
