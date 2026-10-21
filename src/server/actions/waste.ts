"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { businessDate, staffCanReport } from "@/lib/cash-report";
import { countFactor } from "@/lib/calc/engine";
import { productLabel, qtyText, WASTE_KIND_LABEL } from "@/lib/waste";
import { requireUser } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";
import { attempt, UserError, zDate, zOptText } from "./util";

// Zayi ve ikram: personel ve yönetici girer (personel bugünü ve dünü; yönetici herhangi bir geçmiş günü). Kayıt bir
// menü ürünü ya da bir hammaddedir; ad ve birim kayıt anında saklanır. Personel yalnız kendi kaydını, girdiği gün
// geçmeden siler.

const entrySchema = z
  .object({
    date: zDate,
    kind: z.enum(["zayi", "ikram"]),
    productId: z.number().int().positive().nullable(),
    ingredientId: z.number().int().positive().nullable(),
    qty: z.number({ message: "Miktar girin" }).finite().positive("Miktar sıfırdan büyük olmalı").max(10_000, "Miktar çok büyük"),
    reason: zOptText(60),
    note: zOptText(300),
  })
  .refine((d) => (d.productId === null) !== (d.ingredientId === null), "Bir ürün ya da bir hammadde seçin");

export async function addWasteEntry(input: z.input<typeof entrySchema>) {
  return attempt(async () => {
    const me = await requireUser();
    const data = entrySchema.parse(input);
    if (data.date > businessDate()) throw new UserError("İleri bir güne kayıt girilemez");
    if (me.role !== "admin" && !staffCanReport(data.date)) throw new UserError("Personel yalnız bugüne ve düne kayıt girebilir");
    const db = getDb();
    let target: { name: string; unit: string; factor: number };
    if (data.productId !== null) {
      const [p] = await db.select({ name: s.products.name, size: s.products.size, active: s.products.active }).from(s.products).where(eq(s.products.id, data.productId)).limit(1);
      if (!p || !p.active) throw new UserError("Ürün bulunamadı (sayfayı yenileyin)");
      if (!Number.isInteger(data.qty)) throw new UserError("Ürün adetle girilir (ör. 2)");
      target = { name: productLabel(p), unit: "adet", factor: 1 };
    } else {
      const [i] = await db
        .select({ name: s.ingredients.name, unit: s.ingredients.unit, countUnit: s.ingredients.countUnit, active: s.ingredients.active })
        .from(s.ingredients)
        .where(eq(s.ingredients.id, data.ingredientId!))
        .limit(1);
      if (!i || !i.active) throw new UserError("Hammadde bulunamadı (sayfayı yenileyin)");
      target = i.countUnit ? { name: i.name, unit: i.countUnit, factor: countFactor(i.countUnit) } : { name: i.name, unit: i.unit, factor: 1 };
    }
    const [row] = await db
      .insert(s.wasteEntries)
      .values({ ...data, ...target, createdBy: me.id, createdByName: me.name })
      .returning({ id: s.wasteEntries.id });
    await logActivity(me, `${WASTE_KIND_LABEL[data.kind]} kaydı`, `${target.name} ${qtyText(data.qty, target.unit)}${data.reason ? ` · ${data.reason}` : ""}`);
    refresh();
    return { id: row.id, name: target.name, unit: target.unit };
  });
}

export async function deleteWasteEntry(id: number) {
  return attempt(async () => {
    const me = await requireUser();
    const db = getDb();
    const [row] = await db.select().from(s.wasteEntries).where(eq(s.wasteEntries.id, z.number().int().positive().parse(id))).limit(1);
    if (!row) throw new UserError("Kayıt bulunamadı");
    if (me.role !== "admin" && (row.createdBy !== me.id || !staffCanReport(row.date))) {
      throw new UserError("Bu kaydı yalnız giren kişi o gün ya da yönetici silebilir");
    }
    await db.delete(s.wasteEntries).where(eq(s.wasteEntries.id, row.id));
    await logActivity(me, `${WASTE_KIND_LABEL[row.kind as "zayi" | "ikram"]} kaydı silindi`, `${row.name} ${qtyText(row.qty, row.unit)} (${row.date})`);
    refresh();
    return null;
  });
}
