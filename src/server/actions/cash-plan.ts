"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { EXCLUDABLE_KEY, parseCashPlanState, type CashPlanState } from "@/lib/cash-plan";
import { money } from "@/lib/format";
import { todayTR } from "@/lib/reminders";
import { requireAdmin } from "@/server/auth/dal";
import { CASH_PLAN_KEY } from "@/server/data/cash-plan";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";
import { attempt, zMoney } from "./util";

/**
 * Nakit planının ayarını satır kilidiyle değiştirir (aynı anda iki kayıt birbirinin alanını silmesin). Kayıttaki eski
 * devreden KDV (`vatCarry`) ve kaldırılan tahminlerin anahtarları (`kdv`, `vergi`) okunup olduğu gibi geri yazılır
 */
async function updateState(change: (state: CashPlanState) => CashPlanState) {
  await getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(s.integrationState).where(eq(s.integrationState.key, CASH_PLAN_KEY)).for("update");
    const value = change(parseCashPlanState(row?.value));
    await tx
      .insert(s.integrationState)
      .values({ key: CASH_PLAN_KEY, value })
      .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
  });
}

const zBalance = zMoney.min(-100_000_000, "Tutar çok küçük").max(100_000_000, "Tutar çok büyük").nullable();

/** Elinizdeki para (banka + kasa, bugün): plan bu tutardan başlar; null kaldırır. Eksi olabilir (kredili hesap) */
export async function saveCashBalance(amount: number | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const value = zBalance.parse(amount);
    const rounded = value === null ? null : Math.round(value * 100) / 100;
    await updateState((st) => ({ ...st, balance: rounded, balanceDate: rounded === null ? null : todayTR(), balanceBy: rounded === null ? null : me.name }));
    await logActivity(me, "Nakit planı: bakiye", rounded === null ? "kaldırıldı" : money(rounded));
    refresh();
    return null;
  });
}

const zExcluded = z.array(z.string().regex(EXCLUDABLE_KEY, "Geçersiz kalem")).max(200);

/** Tahmine katılanlar: kapatılan kalemlerin anahtarları (sales, online, salary, sgk, goods, fixed:<id>, expense:<id>) */
export async function saveCashPlanExcluded(keys: string[]) {
  return attempt(async () => {
    const me = await requireAdmin();
    const excluded = [...new Set(zExcluded.parse(keys))];
    await updateState((st) => ({ ...st, excluded }));
    await logActivity(me, "Nakit planı: tahmin ayarı", excluded.length ? `${excluded.length} kalem tahmine katılmıyor` : "bütün kalemler tahmine katılıyor");
    refresh();
    return null;
  });
}
