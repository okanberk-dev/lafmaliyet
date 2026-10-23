"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { PHOTO_KIND_LABEL } from "@/lib/photo-rules";
import { longDateTR } from "@/lib/reminders";
import { saveAiSettings } from "@/server/ai/claude";
import { requireAdmin } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";
import { deletePhoto, getPhoto, PhotoError } from "@/server/storage/photos";

import { logActivity } from "./log";
import { attempt, UserError } from "./util";

/** Fotoğrafın günü (rapor ya da kasadan çıkan satırı), işlem geçmişine */
async function photoDay(id: number): Promise<string | null> {
  const db = getDb();
  const [report] = await db
    .select({ date: s.cashReports.date })
    .from(s.cashReportPhotos)
    .innerJoin(s.cashReports, eq(s.cashReports.id, s.cashReportPhotos.reportId))
    .where(eq(s.cashReportPhotos.photoId, id))
    .limit(1);
  if (report) return report.date;
  const [out] = await db.select({ date: s.cashOuts.date }).from(s.cashOuts).where(eq(s.cashOuts.photoId, id)).limit(1);
  return out?.date ?? null;
}

/** Yönetici bir fotoğrafı hemen siler: rapor ve satırlar kalır, yalnız fotoğraf gider */
export async function deleteStoredPhoto(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const pid = z.number().int().positive().parse(id);
    const photo = await getPhoto(pid);
    if (!photo) throw new UserError("Fotoğraf bulunamadı; silinmiş olabilir");
    const day = await photoDay(pid);
    try {
      await deletePhoto(pid);
    } catch (e) {
      if (e instanceof PhotoError) throw new UserError(e.message);
      throw e;
    }
    await logActivity(me, "Fotoğraf silindi", [PHOTO_KIND_LABEL[photo.kind], day ? longDateTR(day) : null].filter(Boolean).join(" · "));
    refresh();
    return null;
  });
}

const readingSchema = z.object({
  enabled: z.boolean(),
  dailyCap: z.number({ message: "Sayı girin" }).int("Tam sayı girin").min(0, "0 ile 500 arası").max(500, "0 ile 500 arası"),
});

/** Ayarlar › Fotoğraftan okuma: aç / kapat ve günlük sınır */
export async function updatePhotoReading(input: z.input<typeof readingSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = readingSchema.parse(input);
    await saveAiSettings(data);
    await logActivity(me, "Fotoğraftan okuma", `${data.enabled ? "açık" : "kapalı"} · günde en çok ${data.dailyCap}`);
    refresh();
    return data;
  });
}
