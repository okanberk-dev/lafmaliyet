"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { businessDate } from "@/lib/cash-report";
import { durumMetni, ELLE_SINAMA_ARALIGI_MS, gecerliSinama, HEDEF_ADI, HEDEFLER, hedefUyumlu, type Sinama } from "@/lib/asilpos/anahtar-uyumu";
import { dagitilanBaglantilar } from "@/lib/asilpos/baglanti-dagitim";
import { dayMonthYearTR } from "@/lib/asilpos/switch";
import type { StepUpConfirm } from "@/lib/step-up";
import { adminActor } from "@/lib/roles";
import { requireAdmin, requireAnaAdmin } from "@/server/auth/dal";
import { requireStepUp } from "@/server/auth/step-up";
import { getDb, schema as s } from "@/server/db";
import { removeAsilposDay, writeAsilposSwitchDay } from "@/server/asilpos/admin";
import { readAnahtarUyumu, sinaAnahtarlar } from "@/server/asilpos/anahtar-uyumu";

import { logActivity } from "./log";
import { attempt, UserError, zDate } from "./util";

/*
 * Ayarlar › AsilPOS (kasa) (docs/ASILPOS.md › Geçiş günü, Durum ve onarım, Anahtar değişimi). Bu dosyadaki her dışa aktarım
 * bir POST ucudur: hepsi önce yönetici oturumunu denetler; yazımlar src/server/asilpos/admin.ts'te (rol orada da denetlenir).
 */

const switchSchema = z.object({ branchId: z.string().min(1).max(24), day: z.union([z.null(), zDate]) });

/**
 * Bir kasanın AsilPOS'a geçiş günü (null: boşalt, kasa ModPOS gibi). Çok şube: `branchId` bölümün şubesi; yalnız kasası
 * AsilPOS olan şube. Ayarlar'daki onay penceresinden sonra; FIFO başlangıcı gibi parola istemez (veri yazılmaz ya da
 * silinmez, yalnız okuyanlar değişir), işlem geçmişine eski → yeni düşer. Kapalı dönemi etkileyen değişiklik yazılmaz.
 * Yalnız asıl yönetici (docs/ROLLER.md › Asıl yönetici; 28 Kasım 2026).
 */
export async function saveAsilposSwitchDay(input: z.input<typeof switchSchema>) {
  return attempt(async () => {
    const me = adminActor(await requireAnaAdmin("gecisGunu"));
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

/** Sınamanın tek satırlık özeti (işlem geçmişi ve bildirim): "AsilPOS Uzaktan: anahtarı kabul ediyor · laffogato.net: …" */
function sinamaOzeti(sinama: Sinama): string {
  return HEDEFLER.filter((h) => sinama.sonuc[h])
    .map((h) => `${HEDEF_ADI[h]}: ${durumMetni(sinama.sonuc[h])}`)
    .join(" · ");
}

/**
 * Ayarlar › AsilPOS › Anahtarları sına (docs/ASILPOS.md › Anahtar değişimi): Uzaktan ve site panelin kasalara dağıttığı
 * anahtarı şimdi kabul ediyor mu (src/server/asilpos/anahtar-uyumu.ts sinaAnahtarlar). Anahtar değişiminden sonra (önce
 * Uzaktan ve site, sonra panel) ve uyarıyı düzelttikten sonra basılır. Aynı değerler ELLE_SINAMA_ARALIGI_MS içinde
 * sınandıysa yeniden istek atılmaz, son sonuç döner. İşlem geçmişine yalnız durumlar düşer (anahtar yok)
 */
export async function testAsilposKeys() {
  return attempt(async () => {
    const me = adminActor(await requireAdmin());
    const { surum } = dagitilanBaglantilar();
    if (!surum) throw new UserError("Panel kasalara Uzaktan ve site anahtarı dağıtmıyor (ASILPOS_CLOUD_* ve ASILPOS_SITE_* tanımlı değil)");
    const db = getDb();
    const son = gecerliSinama(await readAnahtarUyumu(db), surum);
    const sinama = son && Date.now() - Date.parse(son.at) < ELLE_SINAMA_ARALIGI_MS ? son : await sinaAnahtarlar(db, { tetik: "elle" });
    if (!sinama) throw new UserError("Sınanacak uç yok");
    const ozet = sinamaOzeti(sinama);
    if (sinama !== son) await logActivity(me, "AsilPOS anahtarları sınandı", ozet);
    refresh();
    const sonuclar = HEDEFLER.map((h) => sinama.sonuc[h]).filter((r) => r !== undefined);
    // Uç panelin anahtarını yalnız önceki değer olarak kabul ediyorsa uyumlu değil: panel güncellenmeli (`_ONCEKI` silinmesin)
    const panelEski = sonuclar.some((r) => r.durum === "ok" && r.anahtar === "onceki") && !sonuclar.some((r) => r.durum === "red" || r.durum === "kapali");
    return { ok: sonuclar.every(hedefUyumlu), panelEski, ozet };
  });
}
