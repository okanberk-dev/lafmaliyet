"use server";

import { and, eq, gte, lte } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { businessDate } from "@/lib/cash-report";
import { foldTR, specialSummary } from "@/lib/ozel-gun";
import { rangeTR } from "@/lib/takvim";
import { addDays, daysBetween } from "@/lib/reminders";
import { requireAdmin } from "@/server/auth/dal";
import { lockSpecialDays, revokeClosedRequests } from "@/server/closed-days";
import { getDb, schema as s } from "@/server/db";
import { SPECIAL_MAX_AHEAD_DAYS, SPECIAL_MAX_SPAN_DAYS, SPECIAL_PAST_DAYS } from "@/server/special-days";

import { logActivity } from "./log";
import { attempt, UserError, type ActionResult } from "./util";

// Özel günler (yalnız yönetici; docs/OZEL-GUNLER.md): derbi, AVM etkinliği, kampanya ve kafe kapalı günleri.
// Satış tahmini 4 Kasım 2026'da kaldırıldı; bu eylemler oradan buraya taşındı ve tahmin işini tetiklemiyor.
// Personelin kendi girdileri ayrı dosyada (special-days-staff.ts).

/** Özel gün en çok bu kadar gün sürer */
const MAX_SPAN_DAYS = SPECIAL_MAX_SPAN_DAYS;

/** Gerçek bir gün (2026-02-31 değil) */
const zDay = (empty: string) =>
  z
    .string({ message: empty })
    .regex(/^\d{4}-\d{2}-\d{2}$/, empty)
    .refine((v) => addDays(v, 0) === v, empty);

const specialInput = z.object({
  id: z.number().int().positive().optional(),
  kind: z.enum(["derbi", "avm", "kampanya", "kapali", "diger"], { message: "Ne olduğunu seçin" }),
  title: z.string({ message: "Ad gerekli" }).trim().min(1, "Ad gerekli").max(60, "Ad en çok 60 karakter"),
  dateFrom: zDay("Başlangıç gününü seçin"),
  dateTo: z.union([zDay("Bitiş gününü seçin"), z.literal(""), z.null()]).optional(),
  effect: z.union([z.literal(0.3), z.literal(0.15), z.literal(0), z.literal(-0.15), z.literal(-0.3)], { message: "Satışa etkisini seçin" }),
  note: z
    .string()
    .trim()
    .max(200, "Not en çok 200 karakter")
    .nullish()
    .transform((v) => v || null),
});

export type SpecialDayInput = z.input<typeof specialInput>;
export interface SpecialDayValues {
  kind: "derbi" | "avm" | "kampanya" | "kapali" | "diger";
  title: string;
  dateFrom: string;
  dateTo: string;
  effect: 0.3 | 0.15 | 0 | -0.15 | -0.3;
  note: string | null;
}

/**
 * Özel gün ekler ya da (id ile) düzenler. Kafe kapalıda etki −1 (tahmin 0). Bitiş boşsa aynı gün; en çok 14 gün. Geriye
 * bitişi en çok 60 gün önce olan (tahmin 60 günün kasa raporunu okur: geçmiş gün normal günlerin ortalamasından çıkar,
 * daha eskisi hiçbir şeyi değiştirmez ve listede görünmez), ileriye 1 yıl.
 */
export async function saveSpecialDay(input: SpecialDayInput): Promise<ActionResult<{ id: number; summary: string }>> {
  return attempt(async () => {
    const me = await requireAdmin();
    const d = specialInput.parse(input);
    const dateTo = d.dateTo || d.dateFrom;
    if (dateTo < d.dateFrom) throw new UserError("Bitiş başlangıçtan önce olamaz");
    if (daysBetween(d.dateFrom, dateTo) + 1 > MAX_SPAN_DAYS) throw new UserError(`En çok ${MAX_SPAN_DAYS} gün seçilebilir`);
    const today = businessDate();
    if (dateTo < addDays(today, -SPECIAL_PAST_DAYS)) throw new UserError(`En çok ${SPECIAL_PAST_DAYS} gün geriye işaretlenebilir`);
    if (dateTo > addDays(today, SPECIAL_MAX_AHEAD_DAYS)) throw new UserError("En çok 1 yıl ileriye girilebilir");
    const effect = d.kind === "kapali" ? -1 : d.effect;
    const values = { kind: d.kind, title: d.title, dateFrom: d.dateFrom, dateTo, effect, note: d.note };
    // Personelin yazımlarıyla aynı danışma kilidi (src/server/closed-days.ts lockSpecialDays): çakışma ve sınırlar yarışmaz
    const id = await getDb().transaction(async (tx) => {
      await lockSpecialDays(tx);
      // Aynı adla üst üste binen ikinci kayıt etkiyi iki kez çarpar (aynı maç yanlışlıkla iki kez girilmiş)
      const overlapping = await tx
        .select({ id: s.specialDays.id, title: s.specialDays.title, dateFrom: s.specialDays.dateFrom, dateTo: s.specialDays.dateTo })
        .from(s.specialDays)
        .where(and(lte(s.specialDays.dateFrom, dateTo), gte(s.specialDays.dateTo, d.dateFrom)));
      const twin = overlapping.find((r) => r.id !== d.id && foldTR(r.title) === foldTR(d.title));
      if (twin) throw new UserError(`Bu günlerde aynı adla bir özel gün var (${rangeTR(twin.dateFrom, twin.dateTo)}); onu düzenleyin`);
      if (d.id) {
        // Son düzenleyen yazılır: yöneticinin dokunduğu personel satırını personel artık değiştiremez
        const [row] = await tx
          .update(s.specialDays)
          .set({ ...values, updatedBy: me.id, updatedByName: me.name, updatedAt: new Date() })
          .where(eq(s.specialDays.id, d.id))
          .returning({ id: s.specialDays.id });
        if (!row) throw new UserError("Özel gün bulunamadı (sayfayı yenileyin)");
        return row.id;
      }
      const [row] = await tx
        .insert(s.specialDays)
        .values({ ...values, createdBy: me.id, createdByName: me.name })
        .returning({ id: s.specialDays.id });
      return row.id;
    });
    const summary = specialSummary(values);
    await logActivity(me, d.id ? "Özel gün güncellendi" : "Özel gün", summary);
    refresh();
    return { id, summary };
  });
}

/** Özel günü siler; önceki değerleri döner (bildirimdeki "Geri al" onlarla yeniden ekler) */
export async function deleteSpecialDay(id: number): Promise<ActionResult<SpecialDayValues>> {
  return attempt(async () => {
    const me = await requireAdmin();
    const key = z.number().int().positive().parse(id);
    const row = await getDb().transaction(async (tx) => {
      await lockSpecialDays(tx);
      const [gone] = await tx.delete(s.specialDays).where(eq(s.specialDays.id, key)).returning();
      if (!gone) throw new UserError("Özel gün bulunamadı (sayfayı yenileyin)");
      // Onaylanmış kapalı gün bildiriminin satırı: istek "geri alındı" olur, eksik rapor uyarıları geri gelir
      if (gone.kind === "kapali") await revokeClosedRequests(tx, gone.id, "Yönetici kapalı işaretini kaldırdı");
      return gone;
    });
    const values: SpecialDayValues = {
      kind: row.kind,
      title: row.title,
      dateFrom: row.dateFrom,
      dateTo: row.dateTo,
      // Kapalı günün etkisi formda yok (−1 kendiliğinden); öteki değerler formun seçenekleri
      effect: row.kind === "kapali" ? 0 : ([0.3, 0.15, 0, -0.15, -0.3].find((v) => Math.abs(v - row.effect) < 1e-9) as SpecialDayValues["effect"] | undefined) ?? 0,
      note: row.note,
    };
    await logActivity(me, "Özel gün silindi", specialSummary({ ...values, effect: row.effect }));
    refresh();
    return values;
  });
}

