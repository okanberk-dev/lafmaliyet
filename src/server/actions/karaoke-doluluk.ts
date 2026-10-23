"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { HistoryRun } from "@/lib/karaoke/history";
import { hoursText, monthsRange } from "@/lib/karaoke/occupancy-text";
import { requireAdmin } from "@/server/auth/dal";
import { importKaraokeHistory } from "@/server/karaoke/history";
import { readKaraokeHours, writeKaraokeHours } from "@/server/karaoke/occupancy";

import { logActivity } from "./log";
import { attempt, UserError, type ActionResult } from "./util";

// Karaoke doluluk haritası (yalnız yönetici; docs/KARAOKE.md › Doluluk haritası): oda saatleri ve geçmişin siteden
// alınması. Personel bu ekranı açamaz; eylemler de yöneticiyi ayrıca denetler.

const hoursSchema = z
  .object({
    open: z.number().int().min(5, "Açılış 05:00 ile 23:00 arasında olmalı").max(23, "Açılış 05:00 ile 23:00 arasında olmalı"),
    close: z.number().int().min(6, "Kapanış en geç ertesi gün 05:00 olabilir").max(29, "Kapanış en geç ertesi gün 05:00 olabilir"),
  })
  .refine((v) => v.close > v.open, "Kapanış açılıştan sonra olmalı");

/** Oda saatleri: doluluk bu saatlere göre hesaplanır (değişiklik geçmiş aylara da uygulanır) */
export async function saveKaraokeHours(input: z.input<typeof hoursSchema>): Promise<ActionResult> {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = hoursSchema.parse(input);
    const before = await readKaraokeHours();
    if (before.saved && before.hours.open === data.open && before.hours.close === data.close) return null;
    await writeKaraokeHours(data, me.name);
    await logActivity(me, "Karaoke oda saatleri", `${hoursText(before.hours)} → ${hoursText(data)}`);
    refresh();
    return null;
  });
}

/** Siteden geçmiş rezervasyonlar: en çok 45 sn (sayfanın süresi 60 sn); süre yetmezse kalanı "Devam et" ile */
export async function importKaraokeHistoryNow(): Promise<ActionResult<HistoryRun>> {
  return attempt(async () => {
    const me = await requireAdmin();
    const r = await importKaraokeHistory({ deadline: Date.now() + 45_000 });
    if (r.status === "off") throw new UserError("laffogato.net bağlantısı kurulmamış (KARAOKE_SYNC_SECRET)");
    // Hata da durumu (son deneme) değiştirir: sayfa yenilenir
    refresh();
    if (r.status === "error" && !r.read.length) throw new UserError(r.error ?? "Geçmiş alınamadı");
    if (r.read.length) {
      const what = r.reread ? "Karaoke geçmişi siteden yeniden alındı" : "Karaoke geçmişi siteden alındı";
      const detail = `${monthsRange(r.read)} · ${r.reservations} rezervasyon (${r.created} yeni, ${r.updated} güncellenen)${r.error ? ` · ${r.error}` : ""}`;
      await logActivity(me, what, detail);
    }
    return r;
  });
}
