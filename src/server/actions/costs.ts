"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { tl } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";
import { attempt, zOptText, zRate, zText } from "./util";

// ---------------------------------------------------------------- Personel

const staffSchema = z.array(
  z.object({
    id: z.number().int().positive().nullable(),
    name: zText("Personel adı", 80),
    netSalary: z.number().finite().min(0),
    extras: z.number().finite().min(0),
    active: z.boolean(),
  }),
);

export async function saveStaff(rows: z.input<typeof staffSchema>, removedIds: number[]) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = staffSchema.parse(rows);
    const db = getDb();
    await db.transaction(async (tx) => {
      for (const id of removedIds) await tx.delete(s.staff).where(eq(s.staff.id, id));
      for (const [i, r] of data.entries()) {
        const values = { name: r.name, netSalary: r.netSalary, extras: r.extras, active: r.active, sortOrder: i + 1 };
        if (r.id) await tx.update(s.staff).set(values).where(eq(s.staff.id, r.id));
        else await tx.insert(s.staff).values(values);
      }
    });
    await logActivity(me, "Personel güncellendi", data.map((r) => `${r.name} ${tl(r.netSalary)}`).join(", "));
    refresh();
    return null;
  });
}

const rateSchema = z.object({ isciSgk: zRate, isciIssizlik: zRate, isverenSgk: zRate, isverenIssizlik: zRate });

export async function saveStaffRates(input: z.input<typeof rateSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = rateSchema.parse(input);
    const db = getDb();
    for (const [key, value] of Object.entries(data)) {
      await db.insert(s.settings).values({ key, value }).onConflictDoUpdate({ target: s.settings.key, set: { value, updatedAt: new Date() } });
    }
    await logActivity(me, "SGK oranları", Object.entries(data).map(([k, v]) => `${k} %${(v * 100).toFixed(2)}`).join(", "));
    refresh();
    return null;
  });
}

// ---------------------------------------------------------------- Sabit giderler

const fixedSchema = z.object({
  id: z.number().int().positive().nullable(),
  name: zText("Gider adı", 120),
  section: z.enum(["personel", "faturalar", "kira", "genel"]),
  period: z.enum(["aylik", "gunluk", "haftalik", "yillik"]),
  amount: z.number().finite().min(0),
  note: zOptText(1000),
  active: z.boolean(),
});

export async function saveFixedExpense(input: z.input<typeof fixedSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { id, ...data } = fixedSchema.parse(input);
    const db = getDb();
    let savedId: number;
    if (id) {
      await db.update(s.fixedExpenses).set(data).where(eq(s.fixedExpenses.id, id));
      savedId = id;
    } else {
      const all = await db.select({ o: s.fixedExpenses.sortOrder }).from(s.fixedExpenses);
      const [row] = await db
        .insert(s.fixedExpenses)
        .values({ ...data, sortOrder: Math.max(0, ...all.map((r) => r.o)) + 1 })
        .returning({ id: s.fixedExpenses.id });
      savedId = row.id;
    }
    await logActivity(me, id ? "Sabit gider düzenlendi" : "Sabit gider eklendi", `${data.name}: ${tl(data.amount)} (${data.period})`);
    refresh();
    // Kimlik döner: istemci yeni ya da düzenlenen satırı listede vurgulayabilsin
    return { id: savedId };
  });
}

export async function deleteFixedExpense(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const [d] = await getDb().delete(s.fixedExpenses).where(eq(s.fixedExpenses.id, id)).returning();
    if (d) await logActivity(me, "Sabit gider silindi", d.name);
    refresh();
    return null;
  });
}

// ---------------------------------------------------------------- Tek seferlik yatırımlar

const investmentSchema = z.object({
  id: z.number().int().positive().nullable(),
  name: zText("Yatırım adı", 160),
  amount: z.number().finite().min(0),
  date: zOptText(10),
  note: zOptText(1000),
});

export async function saveInvestment(input: z.input<typeof investmentSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { id, ...data } = investmentSchema.parse(input);
    const db = getDb();
    let savedId: number;
    if (id) {
      await db.update(s.investments).set(data).where(eq(s.investments.id, id));
      savedId = id;
    } else {
      const [row] = await db.insert(s.investments).values(data).returning({ id: s.investments.id });
      savedId = row.id;
    }
    await logActivity(me, "Yatırım kaydı", `${data.name}: ${tl(data.amount)}`);
    refresh();
    return { id: savedId };
  });
}

export async function deleteInvestment(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const [d] = await getDb().delete(s.investments).where(eq(s.investments.id, id)).returning();
    if (d) await logActivity(me, "Yatırım silindi", d.name);
    refresh();
    return null;
  });
}
