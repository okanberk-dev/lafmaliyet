import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { ALL_BRANCHES, type BranchScope } from "@/lib/branches";
import { addRecentPaid, dropChangedReminder, parseRecentPaid, pruneRecentPaid, removeRecentPaid, scopeRecentPaid, type RecentPaid, type ReminderState } from "@/lib/recent-paid";
import { getDb, schema as s } from "@/server/db";
import { invoiceScopeWhere } from "@/server/invoice-scope";

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

/**
 * Son ödenenler. `scope` tek şubeyse (Ödemeler ve faturalar alanının şube kipi; şube ayrımı parça 4) yalnız şubenin ve
 * işletme genelinin faturaları ile hatırlatıcılar (hatırlatıcının şubesini ekran listesi süzer); faturasız borcun (cari)
 * ödemesi firmanın, şube kipinde yok. "Tümü"de hepsi (nakit planı da bununla okur)
 */
export async function loadRecentPaid(scope: BranchScope = ALL_BRANCHES): Promise<RecentPaid[]> {
  const db = getDb();
  const [row] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, RECENT_PAID_KEY)).limit(1);
  const list = pruneRecentPaid(parseRecentPaid(row?.value), new Date().toISOString());
  if (scope === ALL_BRANCHES) return list;
  const ids = list.filter((e) => e.kind === "invoice").map((e) => e.id);
  const inScope = ids.length
    ? await db
        .select({ id: s.invoices.id })
        .from(s.invoices)
        .where(and(inArray(s.invoices.id, ids), invoiceScopeWhere(scope)))
    : [];
  return scopeRecentPaid(list, new Set(inScope.map((r) => r.id)));
}
