"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { MODPOS_DAY_INVALID, MODPOS_KEY_BROKEN, MODPOS_NOT_CONFIGURED, MODPOS_PREVIEW, modposFetchOutcome } from "@/lib/modpos/ayarlar";
import { modposKeyProblem, quotaLeft, quotaRenewsAt, renewText, requestableDay } from "@/lib/modpos/request";
import { foyZ } from "@/lib/modpos/z";
import { requireAdmin } from "@/server/auth/dal";
import { getDb } from "@/server/db";
import { writeModposFallback } from "@/server/modpos/admin";
import { loadModposSheet, readModposState } from "@/server/modpos/store";
import { canFetchModpos, syncModpos } from "@/server/modpos/sync";

import { logActivity } from "./log";
import { attempt, UserError, zDate } from "./util";

/*
 * Ayarlar › ModPOS (kasa föyü) (docs/MODPOS-API.md › Kota ve çekme sırası, Ay rakamına yedek). Bu dosyadaki her dışa
 * aktarım bir POST ucudur: ikisi de önce yönetici oturumunu denetler. Çekme src/server/modpos/sync.ts'in koşucusundan
 * geçer (sabah işiyle aynı); ayarın yazımı src/server/modpos/admin.ts'te (rol orada da denetlenir).
 */

/**
 * Elle çekimin süresi: Ayarlar sayfasının maxDuration'ı 60 sn (sayfanın sunucu eylemlerini de kapsar); istek en çok bu
 * kadar bekler, kalan pay föyün yazımı ve yanıt için
 */
const FETCH_BUDGET_MS = 50_000;

/**
 * "Bu günü çek": seçilen kasa gününün föyünü hemen çeker (günün 2 hakkından birini harcar; docs/MODPOS-API.md › Kota).
 * Kurulmamışsa, önizlemedeyse, gün ileri tarihse ya da hak dolduysa hiçbir istek gitmez. İstek denendiyse kart yenilenir
 * (son hata ve kalan hak değişir); alınan gün işlem geçmişine "gün · alındı / değişti / değişmedi · kalan hak" diye düşer.
 */
export async function fetchModposDay(input: string) {
  return attempt(async () => {
    const me = await requireAdmin();
    const day = zDate.parse(input);
    const now = new Date();
    const problem = modposKeyProblem(process.env);
    if (problem) throw new UserError(problem === "missing" ? MODPOS_NOT_CONFIGURED : MODPOS_KEY_BROKEN);
    if (!canFetchModpos(process.env)) throw new UserError(MODPOS_PREVIEW);
    if (!requestableDay(day, now)) throw new UserError(MODPOS_DAY_INVALID);
    const db = getDb();
    const state = await readModposState(db);
    if (quotaLeft(state.quota, now) <= 0) {
      throw new UserError(`ModPOS API'nin bugünkü çekim hakkı doldu: hak ${renewText(quotaRenewsAt(state.quota, now), now)} yenilenir`);
    }
    const r = await syncModpos("elle", { days: [day], deadlineAt: Date.now() + FETCH_BUDGET_MS, db });
    const got = r.days.some((d) => d.day === day && d.result !== "hata");
    const sheet = got ? await loadModposSheet(day, db) : null;
    const out = modposFetchOutcome(r, day, sheet ? { final: sheet.final, z: foyZ(sheet.foy) } : null);
    // İstek denendi: son hata, kalan hak ve (alındıysa) gün değişti
    refresh();
    if (!out.ok) throw new UserError(out.error);
    await logActivity(me, "ModPOS API verisi çekildi", out.log);
    return { title: out.title, description: out.description };
  });
}

/**
 * Ay rakamına yedek (docs/MODPOS-API.md › Ay rakamına yedek): açıkken kasa raporu olmayan günün kapanmış föyü ayın
 * rakamına girer. Ayarlar'daki onay penceresinden sonra; işlem geçmişine eski → yeni düşer.
 */
export async function saveModposFallback(input: boolean) {
  return attempt(async () => {
    const me = await requireAdmin();
    const on = z.boolean({ message: "Geçersiz değer" }).parse(input);
    const change = await writeModposFallback(getDb(), me, on);
    if (change) {
      await logActivity(me, "Ayarlar", change);
      refresh();
    }
    return { on, change };
  });
}
