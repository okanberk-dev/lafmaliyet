"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { CHANNEL_KEYS, CHANNELS, channelDef } from "@/lib/commission/channels";
import {
  channelMonthChange,
  effectiveSettings,
  markValues,
  MEAL_MAX_PAY_DAYS,
  parseCommissionSettings,
  PLATFORM_MAX_PAY_DAYS,
  type ChannelMonthChange,
} from "@/lib/commission/report";
import { monthLabel } from "@/lib/format";
import { addDays, isCalendarDate, todayTR } from "@/lib/reminders";
import { requireAdmin } from "@/server/auth/dal";
import { COMMISSION_SETTINGS_KEY, ensureCommissionSince } from "@/server/data/commission";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";
import { attempt, UserError, zMonth, zOptText, type ActionResult } from "./util";

// Komisyon & hakediş (yalnız yönetici; docs/KOMISYON.md): kanalın ayına hakedişin geldiği gün ve tutar, kanalın
// ekstresindeki satış ve not; kanalların ödeme süresi. Banka hesabı panele bağlı değil: hiçbir şey kendiliğinden
// işaretlenmez. İkisi de yazma yoludur: hakediş takibinin başladığı gün yoksa burada yazılır.

const ACTION = "Komisyon & hakediş";
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Gerçek bir gün (2026-02-31 değil) */
const zDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Günü seçin")
  .refine(isCalendarDate, "Günü seçin");
const zTL = (empty: string) => z.number({ message: empty }).finite("Tutarı sayı olarak yazın").max(10_000_000, "Tutar çok büyük");

const monthInput = z.object({
  channel: z.enum(CHANNEL_KEYS, { message: "Kanal seçin" }),
  month: zMonth,
  received: z.object({ on: zDay, amount: zTL("Gelen tutarı yazın").positive("Gelen tutarı yazın") }).nullable(),
  sales: zTL("Satışı sayı olarak yazın").min(0, "Satış eksi olamaz").nullable(),
  note: zOptText(200),
});

export type ChannelMonthInput = z.input<typeof monthInput>;

/**
 * Kanalın satış ayı: gelen hakediş (gün ve tutar; null işareti kaldırır), kanalın ekstresindeki satış (KDV dahil; null
 * Z'deki toplama döner) ve not. Hepsi boşalınca satır silinir. Önceki değerler döner: bildirimdeki "Geri al" onlarla
 * aynı eylemi çağırır.
 */
export async function saveChannelMonth(input: ChannelMonthInput): Promise<ActionResult<{ previous: ChannelMonthInput; change: ChannelMonthChange }>> {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = monthInput.parse(input);
    const today = todayTR();
    if (data.month > today.slice(0, 7)) throw new UserError("Gelecek ay işaretlenemez");
    if (data.received && (data.received.on < `${data.month}-01` || data.received.on > addDays(today, 1))) {
      throw new UserError("Gün ayın başından önce ya da yarından sonra olamaz");
    }
    const received = data.received ? { on: data.received.on, amount: r2(data.received.amount) } : null;
    const sales = data.sales === null ? null : r2(data.sales);
    const note = data.note;
    const prev = await getDb().transaction(async (tx) => {
      const where = and(eq(s.commissionMonths.channel, data.channel), eq(s.commissionMonths.month, data.month));
      const [row] = await tx.select().from(s.commissionMonths).where(where).for("update");
      if (!received && sales === null && !note) {
        if (row) await tx.delete(s.commissionMonths).where(eq(s.commissionMonths.id, row.id));
      } else {
        const values = { receivedOn: received?.on ?? null, received: received?.amount ?? null, sales, note, updatedBy: me.id, updatedByName: me.name, updatedAt: new Date() };
        await tx
          .insert(s.commissionMonths)
          .values({ channel: data.channel, month: data.month, ...values })
          .onConflictDoUpdate({ target: [s.commissionMonths.channel, s.commissionMonths.month], set: values });
      }
      return row ?? null;
    });
    await ensureCommissionSince();

    // Önceki değerler (Geri al aynı eylemle yazar) ve farkın bildirimi ile işlem geçmişi (saf, testli: report.ts)
    const before = markValues(prev);
    const { change, log } = channelMonthChange(before, { received, sales, note }, `${channelDef(data.channel).label} ${monthLabel(data.month)}`);
    if (log) await logActivity(me, ACTION, log);
    refresh();
    return { previous: { channel: data.channel, month: data.month, ...before }, change };
  });
}

const settingsInput = z.object({
  channels: z.partialRecord(
    z.enum(CHANNEL_KEYS),
    z.object({
      payDays: z
        .number({ message: "Ödeme süresini gün olarak yazın" })
        .int("Ödeme süresini tam gün yazın")
        .min(1, "Ödeme süresi en az 1 gün")
        .max(PLATFORM_MAX_PAY_DAYS, `Ödeme süresi en çok ${PLATFORM_MAX_PAY_DAYS} gün`),
    }),
  ),
});

/** Kanalların ödeme süresi (hakedişin son günü = ayın son faturası + süre); yemek kartında en çok 30 gün */
export async function saveCommissionSettings(input: z.input<typeof settingsInput>): Promise<ActionResult<{ changed: number }>> {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = settingsInput.parse(input);
    for (const [key, v] of Object.entries(data.channels)) {
      if (v && channelDef(key as (typeof CHANNEL_KEYS)[number]).kind === "meal" && v.payDays > MEAL_MAX_PAY_DAYS) {
        throw new UserError(`Yemek kartında ödeme süresi en çok ${MEAL_MAX_PAY_DAYS} gün olabilir (yönetmelik)`);
      }
    }
    const { before, next } = await getDb().transaction(async (tx) => {
      const [row] = await tx.select().from(s.integrationState).where(eq(s.integrationState.key, COMMISSION_SETTINGS_KEY)).for("update");
      const before = effectiveSettings(parseCommissionSettings(row?.value));
      const next = effectiveSettings({ ...before, ...data.channels });
      const value = { channels: Object.fromEntries(CHANNELS.map((c) => [c.key, { payDays: next[c.key].payDays }])) };
      await tx
        .insert(s.integrationState)
        .values({ key: COMMISSION_SETTINGS_KEY, value })
        .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
      return { before, next };
    });
    await ensureCommissionSince();
    const changed = CHANNELS.filter((c) => before[c.key].payDays !== next[c.key].payDays);
    if (changed.length) {
      await logActivity(me, ACTION, `Kanallar: ${changed.map((c) => `${c.label} ödeme süresi ${before[c.key].payDays} → ${next[c.key].payDays} gün`).join(" · ")}`);
    }
    refresh();
    return { changed: changed.length };
  });
}
