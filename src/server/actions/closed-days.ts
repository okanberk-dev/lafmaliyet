"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { CLOSED_REASON_MAX, CLOSED_TEXT, closedRequestBranch } from "@/lib/closed-days";
import { longDateTR } from "@/lib/reminders";
import { asActor, opsLevel } from "@/lib/roles";
import { requireCan } from "@/server/auth/dal";
import { reviewBranchRefusal } from "@/server/staff-requests/branch";
import { formTillBranch, withBranchScope } from "@/server/branch-scope";
import { markClosedDayCore, proposeClosedDay, reviewClosedDayCore } from "@/server/closed-day-requests";
import { getDb, schema as s } from "@/server/db";
import { fetchSiteDayCounts } from "@/server/site-sales/sync";
import { pushNewRequest } from "@/server/staff-requests/push";

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

/** Formun gösterdiği kasa (docs/SUBE.md › Yazarken hangi şube); göndermeyen eski sekme seçili kasaya yazar */
const tillId = z.string().max(24).nullish();

const requestInput = z.object({ date: zDate, reason: zOptText(CLOSED_REASON_MAX), clientKey, branchId: tillId });

/** Personel: dün kafe kapalıydı (yöneticinin onayına gider). Dönüşte yalnız isteğin kimliği */
export async function requestClosedDay(input: z.input<typeof requestInput>) {
  return attempt(async () => {
    const me = await requireCan("kayit.yaz");
    // Yönetici ve müdür doğrudan işaretler (markClosedDay)
    if (opsLevel(me.role) === "admin") throw new UserError(CLOSED_TEXT.adminOnly);
    const { branchId, ...d } = requestInput.parse(input);
    // Bildirim formun kasasına (başka sekmede seçici değiştiyse de): kanıt ve işaret o şubenin
    const till = await formTillBranch(branchId);
    const out = await withBranchScope(till, () => proposeClosedDay(getDb(), asActor(me, "staff"), d));
    pushNewRequest(out);
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
    // Yönetici ve müdür (yalnız şubesinin bildirimi)
    const me = await requireCan("onay");
    const d = reviewInput.parse(input);
    const branchRefusal = await reviewBranchRefusal(getDb(), me, d.id);
    if (branchRefusal) throw new UserError(branchRefusal);
    const site = d.decision === "approve" ? await fetchSiteDayCountsFor(d.id) : null;
    const out = await reviewClosedDayCore(getDb(), asActor(me, opsLevel(me.role)), { ...d, site });
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

/** İsteğin gününün, bildirilen şubenin site sayıları (onaydan önce; işlemin dışında, 8 sn sınırlı) */
async function fetchSiteDayCountsFor(id: number) {
  const [row] = await getDb()
    .select({ day: s.staffRequests.day, subject: s.staffRequests.subject, payload: s.staffRequests.payload })
    .from(s.staffRequests)
    .where(eq(s.staffRequests.id, id))
    .limit(1);
  return row?.day ? fetchSiteDayCounts(row.day, closedRequestBranch(row)) : null;
}

const markInput = z.object({ date: zDate, note: zOptText(CLOSED_REASON_MAX), branchId: tillId });

/**
 * Yönetici ve müdür: raporsuz bir günü doğrudan kapalı işaretler (Kasa › raporsuz gün); o günün bekleyen bildirimleri
 * onaylanır. Müdürün kasası formTillBranch'te şubesine kilitli
 */
export async function markClosedDay(input: z.input<typeof markInput>) {
  return attempt(async () => {
    const me = await requireCan("isletme.yonet");
    const { branchId, ...d } = markInput.parse(input);
    const till = await formTillBranch(branchId);
    const out = await withBranchScope(till, () => markClosedDayCore(getDb(), asActor(me, opsLevel(me.role)), d));
    if (out.created) await logActivity(me, "Kapalı gün işaretlendi", [longDateTR(d.date), d.note].filter(Boolean).join(" · "));
    refresh();
    return { created: out.created };
  });
}
