"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { qtyText, WASTE_KIND_LABEL } from "@/lib/waste";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db";
import { addWaste, removeWaste } from "@/server/waste/core";

import { logActivity } from "./log";
import { attempt, zDate, zOptText } from "./util";

// Zayi ve ikram: personel ve yönetici girer. Personelin doğrudan yolu bugün ve dün (dünün kasa raporu kilitlenene
// kadar); önceki 14 güne kayıt ve başkasının ya da kilitli günün kaydının silinmesi istekle (waste-requests.ts).
// Yönetici herhangi bir geçmiş güne girer, her kaydı siler. Kurallar çekirdekte (src/server/waste/core.ts): kip,
// kapalı işaretli gün, kalemin çözümü; her silme aynı kaydın bekleyen silme isteklerini kapatır. Kayıt bir menü
// ürünü ya da bir hammaddedir; ad ve birim kayıt anında saklanır.

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
    const target = await addWaste(getDb(), me, data);
    await logActivity(me, `${WASTE_KIND_LABEL[data.kind]} kaydı`, `${target.name} ${qtyText(data.qty, target.unit)}${data.reason ? ` · ${data.reason}` : ""}`);
    refresh();
    return { id: target.id, name: target.name, unit: target.unit };
  });
}

export async function deleteWasteEntry(id: number) {
  return attempt(async () => {
    const me = await requireUser();
    const row = await removeWaste(getDb(), me, z.number().int().positive().parse(id));
    await logActivity(me, `${WASTE_KIND_LABEL[row.kind as "zayi" | "ikram"]} kaydı silindi`, `${row.name} ${qtyText(row.qty, row.unit)} (${row.date})`);
    refresh();
    return null;
  });
}
