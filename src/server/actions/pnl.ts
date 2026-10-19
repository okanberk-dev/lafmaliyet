"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { monthLabel, tl } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";
import { attempt, zMonth } from "./util";

const zKey = z.string().regex(/^(manual|fixed|personnel|commission|stock):[\wçğıöşüÇĞİÖŞÜ:.\- ]{1,80}$/, "Geçersiz satır");

/** Gelir-gider tablosunda bir hücreyi elle girer (null = hesaplanan değere dön / boşalt). */
export async function setPnlCell(month: string, rowKey: string, amount: number | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const m = zMonth.parse(month);
    const key = zKey.parse(rowKey);
    const db = getDb();
    if (amount === null) {
      await db.delete(s.pnlEntries).where(and(eq(s.pnlEntries.month, m), eq(s.pnlEntries.rowKey, key)));
    } else {
      const v = z.number().finite().parse(amount);
      await db
        .insert(s.pnlEntries)
        .values({ month: m, rowKey: key, amount: v })
        .onConflictDoUpdate({ target: [s.pnlEntries.month, s.pnlEntries.rowKey], set: { amount: v, updatedAt: new Date() } });
    }
    await logActivity(me, "Gelir-gider hücresi", `${monthLabel(m)} · ${key}: ${amount === null ? "otomatiğe döndü" : tl(amount)}`);
    refresh();
    return null;
  });
}

/** Ayın cirosu (KDV dahil) ya da açık gün sayısı */
export async function setMonthField(month: string, field: "posRevenue" | "openDays", value: number | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const m = zMonth.parse(month);
    const v =
      value === null
        ? null
        : field === "openDays"
          ? z.number().int().min(0).max(31, "En fazla 31 gün").parse(Math.round(value))
          : z.number().finite().min(0).parse(value);
    await getDb()
      .insert(s.months)
      .values({ month: m, [field]: v })
      .onConflictDoUpdate({ target: s.months.month, set: { [field]: v, updatedAt: new Date() } });
    await logActivity(me, field === "openDays" ? "Açık gün" : "Aylık ciro", `${monthLabel(m)}: ${v === null ? "boş" : field === "openDays" ? `${v} gün` : tl(v)}`);
    refresh();
    return null;
  });
}
