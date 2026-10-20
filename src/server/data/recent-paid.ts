import "server-only";

import { eq } from "drizzle-orm";

import { addRecentPaid, dropChangedReminder, parseRecentPaid, pruneRecentPaid, removeRecentPaid, type RecentPaid, type ReminderState } from "@/lib/recent-paid";
import { getDb, schema as s } from "@/server/db";

/** integration_state anahtarı: son 30 günde "Ödendi" işaretlenenler (Ödemeler › Son ödenenler) */
export const RECENT_PAID_KEY = "payments.recent";

/** Listeyi kilitleyip değiştirir. Yardımcı bir kayıttır: yazılamazsa asıl işlem (ödendi) bozulmaz. */
async function update(change: (list: RecentPaid[]) => RecentPaid[]) {
  try {
    await getDb().transaction(async (tx) => {
      const [row] = await tx.select().from(s.integrationState).where(eq(s.integrationState.key, RECENT_PAID_KEY)).for("update");
      const value = change(parseRecentPaid(row?.value));
      await tx
        .insert(s.integrationState)
        .values({ key: RECENT_PAID_KEY, value })
        .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
    });
  } catch (e) {
    console.error("recent paid", e);
  }
}

export async function rememberPaid(added: Omit<RecentPaid, "at">[]) {
  if (!added.length) return;
  const at = new Date().toISOString();
  await update((list) => addRecentPaid(list, added.map((e) => ({ ...e, at })), at));
}

export async function forgetPaid(kind: RecentPaid["kind"], ids: number[]) {
  if (!ids.length) return;
  await update((list) => removeRecentPaid(list, kind, ids));
}

/** Hatırlatıcı geri yüklendi: kaydı artık geri alınamıyorsa düşer (bkz. dropChangedReminder) */
export async function forgetChangedReminder(cur: ReminderState) {
  await update((list) => dropChangedReminder(list, cur));
}

export async function loadRecentPaid(): Promise<RecentPaid[]> {
  const [row] = await getDb().select().from(s.integrationState).where(eq(s.integrationState.key, RECENT_PAID_KEY)).limit(1);
  return pruneRecentPaid(parseRecentPaid(row?.value), new Date().toISOString());
}
