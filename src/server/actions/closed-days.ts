"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { CLOSED_REASON_MAX, CLOSED_TEXT } from "@/lib/closed-days";
import { longDateTR } from "@/lib/reminders";
import { requireAdmin, requireUser } from "@/server/auth/dal";
import { markClosedDayCore, proposeClosedDay, reviewClosedDayCore } from "@/server/closed-day-requests";
import { getDb, schema as s } from "@/server/db";
import { fetchSiteDayCounts } from "@/server/site-sales/sync";

import { logActivity } from "./log";
import { attempt, UserError, zDate, zOptText } from "./util";

// "Kafe kapalıydı" (docs/KASA-RAPORU.md › Kafe kapalıydı; docs/ONAYLAR.md): personelin dün için bildirimi, yöneticinin
// kararı ve yöneticinin doğrudan işareti. Kuralların çekirdeği src/server/closed-day-requests.ts. Geri çekme genel
// eylemle (withdrawStaffRequest; kişi başına günde bir). "use server" dosyasındaki her dışa açık işlev bir uçtur.

const clientKey = z
  .string()
  .min(8)
  .max(80)
  .nullish()
  .transform((v) => v ?? null);

/** Formun şubesi (açıldığı andaki seçim): kapalı gün şube başına (denetim KP-05); eski sekme göndermez */
const branchId = z.string().min(1).max(24).optional();

const requestInput = z.object({ date: zDate, branchId, reason: zOptText(CLOSED_REASON_MAX), clientKey });

/** Personel: dün kafe kapalıydı (yöneticinin onayına gider). Dönüşte yalnız isteğin kimliği */
export async function requestClosedDay(input: z.input<typeof requestInput>) {
  return attempt(async () => {
    const me = await requireUser();
    if (me.role === "admin") throw new UserError(CLOSED_TEXT.adminOnly);
    const d = requestInput.parse(input);
    const out = await proposeClosedDay(getDb(), me, d);
    if (out.created) await logActivity(me, "Kapalı gün bildirildi", [longDateTR(d.date), d.reason].filter(Boolean).join(" · "));
    refresh();
    return { id: out.row.id };
  });
}

const reviewInput = z.object({
  id: z.number().int().positive(),
  seenVersion: z.number().int().min(1),
  decision: z.enum(["approve", "reject"]),
  note: zOptText(300),
});

/**
 * Yönetici: kapalı gün bildirimini karara bağlar (Onaylar › Kasa). Onayda kanıt yeniden sayılır (sitenin sayıları da
 * sorulur; site okunamazsa onayı kapatmaz); kırmızı varsa ret. Not bütün personele görünür.
 */
export async function reviewClosedDay(input: z.input<typeof reviewInput>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const d = reviewInput.parse(input);
    const site = d.decision === "approve" ? await fetchSiteDayCountsFor(d.id) : null;
    const out = await reviewClosedDayCore(getDb(), me, { ...d, site });
    const note = out.request.reviewNote ? ` · not: ${out.request.reviewNote}` : "";
    await logActivity(
      me,
      out.status === "approved" ? "Kapalı gün onaylandı" : "Kapalı gün reddedildi",
      `${longDateTR(out.payload.date)} · ${out.request.requestedByName} bildirdi${out.payload.reason ? ` · ${out.payload.reason}` : ""}${note}`,
    );
    refresh();
    return { status: out.status };
  });
}

/** İsteğin gününün site sayıları (onaydan önce; işlemin dışında, 8 sn sınırlı) */
async function fetchSiteDayCountsFor(id: number) {
  const [row] = await getDb().select({ day: s.staffRequests.day }).from(s.staffRequests).where(eq(s.staffRequests.id, id)).limit(1);
  return row?.day ? fetchSiteDayCounts(row.day) : null;
}

const markInput = z.object({ date: zDate, branchId, note: zOptText(CLOSED_REASON_MAX) });

/** Yönetici: raporsuz bir günü doğrudan kapalı işaretler (Kasa › raporsuz gün); o günün bekleyen bildirimleri onaylanır */
export async function markClosedDay(input: z.input<typeof markInput>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const d = markInput.parse(input);
    const out = await markClosedDayCore(getDb(), me, d);
    if (out.created) await logActivity(me, "Kapalı gün işaretlendi", [longDateTR(d.date), d.note].filter(Boolean).join(" · "));
    refresh();
    return { created: out.created };
  });
}
