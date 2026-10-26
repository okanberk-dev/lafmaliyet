"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { businessDate } from "@/lib/cash-report";
import { dayMonthYearTR } from "@/lib/lafpos/switch";
import type { StepUpConfirm } from "@/lib/step-up";
import { requireAdmin } from "@/server/auth/dal";
import { requireStepUp } from "@/server/auth/step-up";
import { getDb, schema as s } from "@/server/db";
import { removeLafposDay, writeLafposSwitchDay } from "@/server/lafpos/admin";

import { logActivity } from "./log";
import { attempt, UserError, zDate } from "./util";

/*
 * Ayarlar › LafPOS (kasa) (docs/LAFPOS.md › Geçiş günü, Durum ve onarım). Bu dosyadaki her dışa aktarım bir POST ucudur:
 * ikisi de önce yönetici oturumunu denetler; yazımlar src/server/lafpos/admin.ts'te (rol orada da denetlenir).
 */

/**
 * LafPOS'a geçiş günü (null: boşalt, kasa ModPOS). Ayarlar'daki onay penceresinden sonra; FIFO başlangıcı gibi parola
 * istemez (veri yazılmaz ya da silinmez, yalnız okuyanlar değişir), işlem geçmişine eski → yeni düşer.
 */
export async function saveLafposSwitchDay(input: string | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const day = z.union([z.null(), zDate]).parse(input);
    const change = await writeLafposSwitchDay(getDb(), me, day, businessDate());
    if (change) {
      await logActivity(me, "Ayarlar", change);
      refresh();
    }
    return { change };
  });
}

const deleteSchema = z.object({ date: zDate, zNo: z.number().int().nonnegative() });

/**
 * Bir günün LafPOS kaydını siler (409 z_conflict'in çözümü; deneme günlerinin temizliği): yöneticinin kendi parolasıyla
 * (silinen gün sonu geri getirilemez, ancak LafPOS yeniden gönderir). Parola, gün hâlâ kayıtlıyken ve yazımdan önce
 * sorulur; silme gün sonunun yazımıyla aynı kilit altında, gördüğü Z'ye koşullu.
 */
export async function deleteLafposDay(input: z.input<typeof deleteSchema>, confirm?: StepUpConfirm) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = deleteSchema.parse(input);
    const db = getDb();
    const [rep] = await db.select({ z: s.posDayReports.z }).from(s.posDayReports).where(eq(s.posDayReports.date, data.date)).limit(1);
    if (!rep) throw new UserError("Bu günün LafPOS kaydı yok (silinmiş olabilir); sayfayı yenileyin");
    await requireStepUp(me, confirm, `LafPOS günü silme: ${data.date}`, "LafPOS");
    const r = await removeLafposDay(db, me, data.date, data.zNo);
    await logActivity(me, "LafPOS günü silindi", `${dayMonthYearTR(data.date)} · Z ${r.zNo} · ${r.lines} satır`);
    refresh();
    return r;
  });
}
