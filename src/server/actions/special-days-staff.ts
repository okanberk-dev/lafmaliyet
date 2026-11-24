"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { STAFF_SPECIAL_TEXT } from "@/lib/closed-days";
import { specialSummary } from "@/lib/ozel-gun";
import { isCalendarDate } from "@/lib/reminders";
import { requireUser } from "@/server/auth/dal";
import { currentBranchScope, staffBranchLock } from "@/server/branch-scope";
import { getDb } from "@/server/db";
import { deleteStaffSpecialCore, saveStaffSpecialCore } from "@/server/staff-special";

import { logActivity } from "./log";
import { attempt, UserError } from "./util";

// Personelin özel günleri (/panel/ozel-gunler; docs/SATIS-TAHMINI.md › Personelin özel günleri): onaysız, sınırlı;
// yönetici bilgi alır (zil) ve Satış tahmini'nde düzenleyebilir. Kuralların çekirdeği src/server/forecast/staff-special.ts.
// "use server" dosyasındaki her dışa açık işlev bir uçtur: her biri kendi oturum ve rol denetimini yapar.

/** Takvimde var olan gün (2027-02-30 değil) */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Günü seçin").refine(isCalendarDate, "Geçersiz tarih");

const saveInput = z.object({
  id: z.number().int().positive().nullish(),
  kind: z.string().max(20),
  title: z.string().max(60, "Ad en çok 60 karakter"),
  dateFrom: day,
  dateTo: z.union([day, z.literal(""), z.null()]).optional(),
  effect: z.number().finite(),
  note: z.string().max(200, "Not en çok 200 karakter").nullish(),
});

/**
 * Personel: yaklaşan bir maç, AVM etkinliği, kampanya ya da diğer özel gün ekler ya da kendi satırını düzenler. Dönüşte
 * yalnız satırın kimliği (tahmin tutarı ve gerçekleşen etki yok).
 */
export async function saveStaffSpecialDay(input: z.input<typeof saveInput>) {
  return attempt(async () => {
    const me = await requireUser();
    if (me.role === "admin") throw new UserError(STAFF_SPECIAL_TEXT.adminDirect);
    const d = saveInput.parse(input);
    const out = await saveStaffSpecialCore(
      getDb(),
      me,
      { id: d.id ?? null, kind: d.kind, title: d.title, dateFrom: d.dateFrom, dateTo: d.dateTo || d.dateFrom, effect: d.effect, note: d.note ?? null },
      undefined,
      await currentBranchScope(),
      // Yeni günün şubesi: şubesine kilitli personelde kendi şubesi (şube kapsamı C P1-10)
      await staffBranchLock(),
    );
    await logActivity(me, out.created ? "Özel gün" : "Özel gün güncellendi", specialSummary(out.values));
    refresh();
    return { id: out.id };
  });
}

/** Personel: kendi başlamamış, yöneticinin dokunmadığı özel gününü siler. Dönüşte yalnız tamam */
export async function deleteStaffSpecialDay(id: number) {
  return attempt(async () => {
    const me = await requireUser();
    if (me.role === "admin") throw new UserError(STAFF_SPECIAL_TEXT.adminDirect);
    const key = z.number().int().positive().parse(id);
    const values = await deleteStaffSpecialCore(getDb(), me, key);
    await logActivity(me, "Özel gün silindi", specialSummary(values));
    refresh();
    return null;
  });
}
