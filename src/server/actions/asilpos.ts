"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { businessDate } from "@/lib/cash-report";
import { dayMonthYearTR } from "@/lib/asilpos/switch";
import type { StepUpConfirm } from "@/lib/step-up";
import { adminActor } from "@/lib/roles";
import { requireAdmin } from "@/server/auth/dal";
import { requireStepUp } from "@/server/auth/step-up";
import { getDb, schema as s } from "@/server/db";
import { removeAsilposDay, writeAsilposSwitchDay } from "@/server/asilpos/admin";

import { logActivity } from "./log";
import { attempt, UserError, zDate } from "./util";

/*
 * Ayarlar › AsilPOS (kasa) (docs/ASILPOS.md › Geçiş günü, Durum ve onarım). Bu dosyadaki her dışa aktarım bir POST ucudur:
 * ikisi de önce yönetici oturumunu denetler; yazımlar src/server/asilpos/admin.ts'te (rol orada da denetlenir).
 */

const switchSchema = z.object({ branchId: z.string().min(1).max(24), day: z.union([z.null(), zDate]) });

/**
 * Bir kasanın AsilPOS'a geçiş günü (null: boşalt, kasa ModPOS gibi). Çok şube: `branchId` bölümün şubesi; yalnız kasası
 * AsilPOS olan şube. Ayarlar'daki onay penceresinden sonra; FIFO başlangıcı gibi parola istemez (veri yazılmaz ya da
 * silinmez, yalnız okuyanlar değişir), işlem geçmişine eski → yeni düşer. Kapalı dönemi etkileyen değişiklik yazılmaz.
 */
export async function saveAsilposSwitchDay(input: z.input<typeof switchSchema>) {
  return attempt(async () => {
    const me = adminActor(await requireAdmin());
    const { branchId, day } = switchSchema.parse(input);
    const change = await writeAsilposSwitchDay(getDb(), me, branchId, day, businessDate());
    if (change) {
      await logActivity(me, "Ayarlar", change);
      refresh();
    }
    return { change };
  });
}

const deleteSchema = z.object({ branchId: z.string().min(1).max(24), date: zDate, zNo: z.number().int().nonnegative() });

/**
 * Bir günün AsilPOS kaydını siler (409 z_conflict'in çözümü; deneme günlerinin temizliği): yöneticinin kendi parolasıyla
 * (silinen gün sonu geri getirilemez, ancak AsilPOS yeniden gönderir). Parola, gün hâlâ kayıtlıyken ve yazımdan önce
 * sorulur; silme gün sonunun yazımıyla aynı kilit altında, gördüğü Z'ye koşullu. Gün bölümün şubesinin (`branchId`; çok
 * şube) günüdür, çekirdek (removeAsilposDay) de yalnız onu siler: öteki şubenin aynı günkü kaydı "gün kayıtlı" sayılıp
 * boşuna parola sorulmaz, silinmez.
 */
export async function deleteAsilposDay(input: z.input<typeof deleteSchema>, confirm?: StepUpConfirm) {
  return attempt(async () => {
    const me = adminActor(await requireAdmin());
    const data = deleteSchema.parse(input);
    const db = getDb();
    const [rep] = await db
      .select({ z: s.posDayReports.z })
      .from(s.posDayReports)
      .where(and(eq(s.posDayReports.date, data.date), eq(s.posDayReports.branchId, data.branchId)))
      .limit(1);
    if (!rep) throw new UserError("Bu günün AsilPOS kaydı yok (silinmiş olabilir); sayfayı yenileyin");
    await requireStepUp(me, confirm, `AsilPOS günü silme: ${data.date}`, "AsilPOS");
    const r = await removeAsilposDay(db, me, data.branchId, data.date, data.zNo);
    await logActivity(me, "AsilPOS günü silindi", `${dayMonthYearTR(data.date)} · Z ${r.zNo} · ${r.lines} satır`);
    refresh();
    return r;
  });
}
