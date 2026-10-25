import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, schema as s } from "@/server/db";
import { sendPush } from "@/server/push/send";

/*
 * Mal siparişi taslağının push bildirimleri (konu `approvals`, etiket `istek-<id>`; docs/BILDIRIMLER.md). Metinlerde
 * tutar ve fiyat yok (tests/mal-siparisi-taslak.test.ts). Eylemler yanıttan sonra (after) çağırır; hata fırlatmaz.
 */

/** Etkin yöneticiler */
async function adminIds(): Promise<number[]> {
  const rows = await getDb()
    .select({ id: s.users.id })
    .from(s.users)
    .where(and(eq(s.users.role, "admin"), eq(s.users.active, true)));
  return rows.map((r) => r.id);
}

/** Yöneticilere: yeni ya da güncellenen taslak, geri alınan gönderim */
export async function pushDraftToAdmins(id: number, title: string, body: string): Promise<void> {
  try {
    await sendPush("approvals", { kind: "approvals", title, body, url: `/panel/onaylar#istek-${id}`, tag: `istek-${id}` }, { userIds: await adminIds() });
  } catch (e) {
    console.error("[mal-taslak] push", e instanceof Error ? e.message : e);
  }
}

/** Taslağı hazırlayana: onaylandı ya da reddedildi */
export async function pushDraftToRequester(userId: number | null, id: number, title: string, body: string): Promise<void> {
  if (userId === null) return;
  try {
    await sendPush("approvals", { kind: "approvals", title, body, url: "/panel/hizli-sayim/siparis", tag: `istek-${id}` }, { userIds: [userId] });
  } catch (e) {
    console.error("[mal-taslak] push", e instanceof Error ? e.message : e);
  }
}
