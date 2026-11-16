"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { DEFAULT_BRANCH_ID } from "@/lib/branches";
import { MODPOS_DAY_INVALID, MODPOS_KEY_BROKEN, MODPOS_NOT_CONFIGURED, MODPOS_PREVIEW, modposFetchOutcome } from "@/lib/modpos/ayarlar";
import { modposKeyProblem, quotaLeft, quotaRenewsAt, renewText, requestableDay } from "@/lib/modpos/request";
import { modposBranchIds, modposKeyEnv } from "@/lib/modpos/sube";
import { foyZ } from "@/lib/modpos/z";
import { requireAdmin } from "@/server/auth/dal";
import { listBranches } from "@/server/branches";
import { getDb } from "@/server/db";
import { writeModposFallback } from "@/server/modpos/admin";
import { loadModposSheet, readModposState } from "@/server/modpos/store";
import { canFetchModpos, sharedKeyText, syncModpos } from "@/server/modpos/sync";

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
 *
 * Şube başına (docs/MODPOS-API.md › Şubeler): kartın şubesinin anahtarı ve hakkıyla çekilir (verilmezse Tuzla). Şube
 * ModPOS'tan çekilen bir şube değilse (pasif, online kanal, kasası LafPOS) istek gitmez.
 */
export async function fetchModposDay(input: string, branchInput: string = DEFAULT_BRANCH_ID) {
  return attempt(async () => {
    const me = await requireAdmin();
    const day = zDate.parse(input);
    const branchId = z.string().max(24).parse(branchInput);
    const now = new Date();
    const db = getDb();
    const branches = await listBranches(db);
    const peers = modposBranchIds(branches);
    if (!peers.includes(branchId)) throw new UserError("Bu şubenin kasası ModPOS'tan çekilmiyor (Ayarlar › Şubeler)");
    const problem = modposKeyProblem(process.env, branchId, peers);
    if (problem === "shared") throw new UserError(sharedKeyText(branchId, branches));
    if (problem) throw new UserError((problem === "missing" ? MODPOS_NOT_CONFIGURED : MODPOS_KEY_BROKEN).replace("MODPOS_API_KEY", modposKeyEnv(branchId)));
    if (!canFetchModpos(process.env)) throw new UserError(MODPOS_PREVIEW);
    if (!requestableDay(day, now)) throw new UserError(MODPOS_DAY_INVALID);
    const state = await readModposState(db, branchId);
    if (quotaLeft(state.quota, now) <= 0) {
      throw new UserError(`ModPOS API'nin bugünkü çekim hakkı doldu: hak ${renewText(quotaRenewsAt(state.quota, now), now)} yenilenir`);
    }
    const r = await syncModpos("elle", { days: [day], deadlineAt: Date.now() + FETCH_BUDGET_MS, db, branchId, branches });
    const got = r.days.some((d) => d.day === day && d.result !== "hata");
    const sheet = got ? await loadModposSheet(day, db, { branchId }) : null;
    const out = modposFetchOutcome(r, day, sheet ? { final: sheet.final, z: foyZ(sheet.foy) } : null);
    // İstek denendi: son hata, kalan hak ve (alındıysa) gün değişti
    refresh();
    if (!out.ok) throw new UserError(out.error);
    const name = branches.find((b) => b.id === branchId)?.name ?? branchId;
    await logActivity(me, "ModPOS API verisi çekildi", peers.length > 1 ? `${name} · ${out.log}` : out.log);
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
