"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/server/auth/dal";
import { getDb } from "@/server/db";
import { resolveErrors } from "@/server/errors/store";

import { logActivity } from "./log";
import { attempt } from "./util";

const idSchema = z.number().int().positive();

/**
 * Ayarlar › Hata kaydı › Çözüldü (docs/HATA-KAYDI.md): satır açık listeden çıkar; aynı hata yeniden görülürse kendiliğinden
 * yeniden açılır. Yalnız yönetici. Satır silinmez (sayısı ve ilk görülüşü kalır; sabah işi 30 gün sonra siler).
 */
export async function resolveErrorEntry(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const n = await resolveErrors(getDb(), [idSchema.parse(id)]);
    if (n) await logActivity(me, "Hata kaydı", "1 hata çözüldü işaretlendi");
    refresh();
    return { resolved: n };
  });
}

/** Ayarlar › Hata kaydı › Hepsi çözüldü: açık satırların hepsi */
export async function resolveAllErrorEntries() {
  return attempt(async () => {
    const me = await requireAdmin();
    const n = await resolveErrors(getDb(), "all");
    if (n) await logActivity(me, "Hata kaydı", `${n} hata çözüldü işaretlendi`);
    refresh();
    return { resolved: n };
  });
}
