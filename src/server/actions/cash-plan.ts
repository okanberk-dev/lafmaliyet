"use server";

import { eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { shiftMonth } from "@/lib/calc/engine";
import { EXCLUDABLE_KEY, parseCashPlanState, type CashPlanState } from "@/lib/cash-plan";
import { money, monthLabel } from "@/lib/format";
import { isVatReminder, isVatWithholdingReminder, todayTR, type ReminderRepeat } from "@/lib/reminders";
import { paidPeriodsOf } from "@/lib/vat-paid";
import { requireAdmin } from "@/server/auth/dal";
import { CASH_PLAN_KEY } from "@/server/data/cash-plan";
import { forgetPaid, loadRecentPaid } from "@/server/data/recent-paid";
import { forgetVatPaidPeriod } from "@/server/data/vat-paid";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";
import { attempt, UserError, zMoney } from "./util";

/** Nakit planının ayarını satır kilidiyle değiştirir (aynı anda iki kayıt birbirinin alanını silmesin) */
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

/** Tahmine katılanlar: kapatılan kalemlerin anahtarları (sales, online, salary, sgk, goods, kdv, fixed:<id>) */
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

const zCarry = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Ay seçin"),
    amount: zMoney.min(0, "Tutar eksi olamaz").max(100_000_000, "Tutar çok büyük"),
  })
  .nullable();

/**
 * Muhasebecinin son KDV beyannamesindeki "sonraki döneme devreden KDV": tahmin zinciri bu aydan devam eder (src/lib/kdv.ts).
 * null kaldırır (panelin kendi hesabı kullanılır). Ay son 12 bitmiş aydan biri olmalı.
 */
export async function saveVatCarry(input: { month: string; amount: number } | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = zCarry.parse(input);
    const cur = todayTR().slice(0, 7);
    if (data && (data.month < shiftMonth(cur, -12) || data.month > shiftMonth(cur, -1))) throw new UserError("Beyanname ayı son 12 aydan biri olmalı");
    const carry = data ? { month: data.month, amount: Math.round(data.amount * 100) / 100, date: todayTR(), by: me.name } : null;
    await updateState((st) => ({ ...st, vatCarry: carry }));
    await logActivity(me, "Nakit planı: devreden KDV", carry ? `${monthLabel(carry.month)} beyannamesi · ${money(carry.amount)}` : "kaldırıldı");
    refresh();
    return null;
  });
}

/**
 * KDV kartı: yanlış "Ödendi" kaydını kaldırır (Ödendi'den sonra hatırlatıcı silindiyse ya da Geri al'ın 30 günü
 * geçtiyse başka yolu yok). Dönem kalıcı kayıttan çıkar; o dönemi kapatan son ödenenler kaydı da silinir (yoksa 30 gün
 * daha ödenmiş sayılırdı). Hatırlatıcılara dokunulmaz.
 */
export async function forgetVatPayment(kind: "kdv" | "kdv2", period: string) {
  return attempt(async () => {
    const me = await requireAdmin();
    const k = z.enum(["kdv", "kdv2"]).parse(kind);
    const p = z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Geçersiz dönem")
      .parse(period);
    await forgetVatPaidPeriod(k, p);
    const recent = (await loadRecentPaid()).filter((e) => e.kind === "reminder" && e.dueDate);
    if (recent.length) {
      const rows = await getDb()
        .select()
        .from(s.reminders)
        .where(
          inArray(
            s.reminders.id,
            recent.map((e) => e.id),
          ),
        );
      const byId = new Map(rows.map((r) => [r.id, r]));
      const covering = recent.filter((e) => {
        const r = byId.get(e.id);
        if (!r) return false;
        const rk = isVatWithholdingReminder(r) ? "kdv2" : isVatReminder(r) ? "kdv" : null;
        return rk === k && paidPeriodsOf({ note: r.note, repeat: r.repeat as ReminderRepeat, anchorDate: r.anchorDate }, e.dueDate!, e.next ?? null).includes(p);
      });
      await forgetPaid(
        "reminder",
        covering.map((e) => e.id),
      );
    }
    await logActivity(me, "Nakit planı: Ödendi kaydı kaldırıldı", `${monthLabel(p)} ${k === "kdv2" ? "KDV-2" : "KDV"}`);
    refresh();
    return null;
  });
}
