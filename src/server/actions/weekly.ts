"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { SOURCE_LABELS } from "@/lib/weekly/text";
import { weeklyPreviewNote } from "@/lib/notify-recipients";
import { requireAdmin } from "@/server/auth/dal";
import { selectedBranchRow } from "@/server/branch-scope";
import { renderWeekly } from "@/server/notify/weekly-template";
import { isEmailConfigured } from "@/server/notify/resend";
import { buildWeekly } from "@/server/weekly/collect";
import { saveWeeklySettings, sendWeeklySampleTo, WEEKLY_ALL_FAILED_TEXT } from "@/server/weekly/send";

import { logActivity } from "./log";
import { attempt, UserError } from "./util";

/*
 * Haftalık özetin ayarı, önizlemesi ve örneği (Ödemeler & hatırlatıcılar › E-posta bildirimleri › Haftalık özet;
 * docs/HAFTALIK-OZET.md). Yalnız yönetici; saat requireAdmin()'den sonra okunur.
 */

/** Açık / kapalı (yalnız haftalık özet; hatırlatma e-postalarının anahtarı ayrı) */
export async function saveWeeklyEnabled(enabled: boolean) {
  return attempt(async () => {
    const me = await requireAdmin();
    const on = z.boolean().parse(enabled);
    await saveWeeklySettings({ enabled: on, by: me.name, at: new Date().toISOString() });
    await logActivity(me, "Haftalık özet", on ? "açık" : "kapalı");
    refresh();
    return null;
  });
}

/**
 * Önizleme: pazartesi gidecek e-posta bugünkü verilerle; gönderilmez, hiçbir şey yazılmaz. Haftalık özetin şube grubu
 * yok (firmaya gider, bütün şubeler; buildWeekly "Tümü"yle okur): şube seçiliyken önizleme bunu not olarak söyler (şube
 * ayrımı parça 6)
 */
export async function previewWeekly() {
  return attempt(async () => {
    await requireAdmin();
    const branch = await selectedBranchRow();
    const { summary, allFailed } = await buildWeekly(new Date(), { budgetMs: 6_000 });
    if (allFailed) throw new UserError(WEEKLY_ALL_FAILED_TEXT);
    const { subject, html } = renderWeekly(summary, { today: summary.week.day });
    return { subject, html, items: summary.items.length, failed: summary.failed.map((f) => SOURCE_LABELS[f]), empty: summary.items.length === 0, note: weeklyPreviewNote(branch?.name ?? null) };
  });
}

/** Örneği bana gönder: yalnız tıklayan yöneticinin adresine; haftanın asıl gönderimini etkilemez */
export async function sendWeeklySample() {
  return attempt(async () => {
    const me = await requireAdmin();
    if (!isEmailConfigured()) throw new UserError("E-posta kurulmamış (RESEND_API_KEY); önizleme yine çalışır.");
    const r = await sendWeeklySampleTo(me, new Date());
    // Gidemeyen örneğin satırı da "Son gönderimler"de görünsün
    refresh();
    if (!r.ok) throw new UserError(r.error);
    await logActivity(me, "Haftalık özet örneği", `${r.items} madde → ${r.to}`);
    return { to: r.to, items: r.items };
  });
}
