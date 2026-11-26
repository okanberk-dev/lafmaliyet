"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { monthTitle } from "@/lib/closed-period";
import { readRecipients } from "@/lib/muhasebe/paket";
import { requireAdmin } from "@/server/auth/dal";
import { getDb } from "@/server/db";
import { loadPackageSettings, savePackageSettings, sendAccountingPackage } from "@/server/muhasebe/paket";

import { logActivity } from "./log";
import { attempt, UserError, zMonth } from "./util";

// Muhasebeci paketi (docs/MUHASEBE-PAKETI.md): alıcılar, ay kapanınca kendiliğinden gönderim ve "Şimdi gönder". Yalnız
// yönetici. Veri, dosya ve gönderim src/server/muhasebe/paket.ts.

const settingsInput = z.object({ recipients: z.string().max(2000, "Çok uzun"), auto: z.boolean() });

/** Alıcılar ve kendiliğinden gönderim; boş alıcı listesi geçerli (e-posta gitmez) */
export async function savePackageOptions(input: z.input<typeof settingsInput>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const d = settingsInput.parse(input);
    const read = readRecipients(d.recipients);
    if (!read.ok) throw new UserError(read.error);
    const db = getDb();
    const cur = await loadPackageSettings(db);
    await savePackageSettings(db, { ...cur, recipients: read.emails, auto: d.auto });
    await logActivity(me, "Muhasebeci paketi ayarlandı", `${read.emails.length ? read.emails.join(", ") : "alıcı yok"} · ay kapanınca ${d.auto ? "gönderilir" : "gönderilmez"}`);
    refresh();
    return { recipients: read.emails, auto: d.auto };
  });
}

/** "Şimdi gönder": seçili ayın paketi muhasebeci alıcılarına (her basışta yeniden) */
export async function sendPackageNow(month: string) {
  return attempt(async () => {
    const me = await requireAdmin();
    const m = zMonth.parse(month);
    const r = await sendAccountingPackage({ trigger: "manual", month: m, by: me });
    if (r.status === "error") throw new UserError(r.error);
    if (r.status !== "sent") throw new UserError("Paket gönderilmedi");
    refresh();
    return { month: monthTitle(r.month), to: r.to, dropped: r.dropped };
  });
}
