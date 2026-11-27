"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { zFormBranch } from "@/lib/branches";
import { qtyText, WASTE_KIND_LABEL } from "@/lib/waste";
import { asActor, opsLevel } from "@/lib/roles";
import { requireCan } from "@/server/auth/dal";
import { formBranch, withBranchScope } from "@/server/branch-scope";
import { getDb } from "@/server/db";
import { addWaste, removeWaste } from "@/server/waste/core";

import { logActivity } from "./log";
import { attempt, zClientKey, zDate, zOptText } from "./util";

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
    /** Formun anahtarı: aynı anahtarla ikinci istek yeni kayıt açmaz (UI-01) */
    clientKey: zClientKey,
    /** Formun şubesi (wasteBranch); göndermeyen eski sekmede seçili fiziksel şube */
    branchId: zFormBranch,
  })
  .refine((d) => (d.productId === null) !== (d.ingredientId === null), "Bir ürün ya da bir hammadde seçin");

/**
 * Zayi ve ikramın şubesi (docs/SUBE.md › Yazarken hangi şube): formun gösterdiği şube (`formBranch(raw, "waste")`;
 * etkin fiziksel şube, şubesine kilitli personelde kendi şubesi), gönderim anındaki seçim değil. "Tümü"de birden çok
 * kasa açıkken şubeyi göndermeyen form reddedilir (sessizce Tuzla'ya inmez). Asistan planın şubesiyle çağırır
 * (withBranchScope; tek şube kapsamında eski kural geçerli)
 */
const wasteBranch = (raw: string | null | undefined) => formBranch(raw, "waste", { requireExplicit: true });

export async function addWasteEntry(input: z.input<typeof entrySchema>) {
  return attempt(async () => {
    const me = await requireCan("kayit.yaz");
    const { branchId, ...data } = entrySchema.parse(input);
    const sube = await wasteBranch(branchId);
    // Yazım formun şubesinin kapsamında: kilit, kapalı gün ve AsilPOS okumaları da o şubenin
    const target = await withBranchScope(sube, () => addWaste(getDb(), asActor(me, opsLevel(me.role)), data, undefined, sube));
    // Aynı anahtarın tekrarı: kayıt zaten yazılmış ve işlem geçmişinde; ikinci satır yazılmaz
    if (!target.repeated) await logActivity(me, `${WASTE_KIND_LABEL[data.kind]} kaydı`, `${target.name} ${qtyText(data.qty, target.unit)}${data.reason ? ` · ${data.reason}` : ""}`);
    refresh();
    return { id: target.id, name: target.name, unit: target.unit, qty: target.qty, repeated: target.repeated };
  });
}

export async function deleteWasteEntry(id: number) {
  return attempt(async () => {
    const me = await requireCan("kayit.yaz");
    const row = await removeWaste(getDb(), asActor(me, opsLevel(me.role)), z.number().int().positive().parse(id));
    await logActivity(me, `${WASTE_KIND_LABEL[row.kind as "zayi" | "ikram"]} kaydı silindi`, `${row.name} ${qtyText(row.qty, row.unit)} (${row.date})`);
    refresh();
    return null;
  });
}
