"use server";

import { refresh } from "next/cache";

import { pdfHref, type SaveWeekInput } from "@/lib/vardiya";
import { requireAdmin } from "@/server/auth/dal";
import { getDb } from "@/server/db";
import { saveShiftWeek, shiftLogDetail } from "@/server/vardiya/store";

import { logActivity } from "./log";
import { attempt, type ActionResult } from "./util";

// Vardiya planı (docs/VARDIYA.md): haftayı yalnız yönetici kaydeder; personel planı görür ve PDF'ini alır. Kurallar
// src/lib/vardiya.ts'te (hücrenin okunuşu ekranla aynı), yazım src/server/vardiya/store.ts'te.

/** Kaydın sonucu: kaç hücre yazıldı ve silindi, planın özeti ve güncel PDF'in adresi */
export interface SaveShiftWeekResult {
  written: number;
  removed: number;
  summary: string;
  pdf: string;
}

/**
 * Haftanın planını kaydeder: ızgaradaki her satır, hücreler ekrandaki metniyle gelir. Değişen hücre yazılır, boşaltılan
 * silinir; değişiklik yoksa hiçbir şey yazılmaz. PDF kaydedilen plandan çizildiği için kayıttan sonra kendiliğinden
 * günceldir. İşlem geçmişine şube, hafta ve özet düşer.
 */
export async function saveShiftWeekAction(input: SaveWeekInput): Promise<ActionResult<SaveShiftWeekResult>> {
  return attempt(async () => {
    const me = await requireAdmin();
    const r = await saveShiftWeek(getDb(), me, input);
    if (r.written || r.removed) {
      await logActivity(me, "Vardiya planı kaydedildi", shiftLogDetail(r));
      refresh();
    }
    return { written: r.written, removed: r.removed, summary: r.summary, pdf: pdfHref(r.branch.id, r.monday) };
  });
}
