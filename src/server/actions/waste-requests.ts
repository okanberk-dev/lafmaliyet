"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { genitive } from "@/lib/recipe-change";
import { longDateTR } from "@/lib/reminders";
import { wasteRequestLog } from "@/lib/waste-requests";
import { zFormBranch } from "@/lib/branches";
import { asActor, opsLevel } from "@/lib/roles";
import { requireCan } from "@/server/auth/dal";
import { reviewBranchRefusal } from "@/server/staff-requests/branch";
import { formBranch, withBranchScope } from "@/server/branch-scope";
import { getDb } from "@/server/db";
import { pushNewRequest } from "@/server/staff-requests/push";
import { proposeLateWaste, proposeWasteDelete, reviewWasteRequestCore } from "@/server/waste/core";

import { logActivity } from "./log";
import { attempt, UserError, zDate, zOptText } from "./util";

// Geç zayi / ikram ve silme isteği (docs/ZAYI-IKRAM.md › Geç kayıt ve silme isteği; docs/ONAYLAR.md). Kurallar
// çekirdekte (src/server/waste/core.ts); bu dosyada yalnız uçlar. "use server" dosyasındaki her dışa açık işlev bir
// uçtur: her biri kendi oturum ve rol denetimini yapar, yardımcı dışa verilmez. Geri çekme genel eylemle
// (src/server/actions/staff-requests.ts withdrawStaffRequest). Personelin yanıtında yalnız isteğin kimliği ve sürümü.

const clientKey = z
  .string()
  .min(8)
  .max(80)
  .nullish()
  .transform((v) => v ?? null);

/** Yöneticiye açıklama / neden: zorunlu, 3–300 */
const zMessage = z.string().trim().min(3, "Açıklama en az 3 karakter olmalı").max(300, "Açıklama en çok 300 karakter");

const lateSchema = z
  .object({
    date: zDate,
    kind: z.enum(["zayi", "ikram"]),
    productId: z.number().int().positive().nullable(),
    ingredientId: z.number().int().positive().nullable(),
    qty: z.number({ message: "Miktar girin" }).finite().positive("Miktar sıfırdan büyük olmalı").max(10_000, "Miktar çok büyük"),
    reason: zOptText(60),
    note: zOptText(300),
    message: zMessage,
    clientKey,
    /** Formun şubesi (addWasteEntry gibi); göndermeyen eski sekmede seçili fiziksel şube */
    branchId: zFormBranch,
  })
  .refine((d) => (d.productId === null) !== (d.ingredientId === null), "Bir ürün ya da bir hammadde seçin");

/**
 * Personel: geç zayi / ikram kaydı isteği (kilitli dün ve dünden önceki 14 gün). Kayıt onaya kadar yazılmaz; yönetici
 * onaylayınca isteyenin adıyla girer.
 */
export async function requestLateWaste(input: z.input<typeof lateSchema>) {
  return attempt(async () => {
    const me = await requireCan("kayit.yaz");
    // Yönetici ve müdür doğrudan girer
    if (opsLevel(me.role) === "admin") throw new UserError("Yönetici doğrudan girer; istek gerekmez");
    const { branchId, ...data } = lateSchema.parse(input);
    // Kaydın ineceği şube formun gösterdiği (addWasteEntry ile aynı kapı); kilit de o şubenin kasasından
    const sube = await formBranch(branchId, "waste", { requireExplicit: true });
    const out = await withBranchScope(sube, () => proposeLateWaste(getDb(), asActor(me, "staff"), data, undefined, sube));
    pushNewRequest(out);
    if (out.created) {
      const p = out.payload;
      await logActivity(me, "Geç zayi / ikram kaydı istendi", wasteRequestLog({ name: p.name, qty: p.qty, unit: p.unit, dayText: longDateTR(p.date), reason: p.reason, message: data.message }));
    }
    refresh();
    return { id: out.row.id, version: out.row.version };
  });
}

const deleteSchema = z.object({ id: z.number().int().positive(), message: zMessage, clientKey });

/** Personel: başkasının ya da kilitli günün kaydının silinmesini ister (14 güne kadar) */
export async function requestWasteDelete(input: z.input<typeof deleteSchema>) {
  return attempt(async () => {
    const me = await requireCan("kayit.yaz");
    if (opsLevel(me.role) === "admin") throw new UserError("Yönetici doğrudan siler; istek gerekmez");
    const data = deleteSchema.parse(input);
    const out = await proposeWasteDelete(getDb(), asActor(me, "staff"), data);
    pushNewRequest(out);
    if (out.created || out.row.version > 1) {
      const e = out.payload.entry;
      await logActivity(me, "Zayi kaydının silinmesi istendi", wasteRequestLog({ name: e.name, qty: e.qty, unit: e.unit, dayText: `${longDateTR(e.date)} · ${e.createdByName} girmişti`, reason: null, message: data.message }));
    }
    refresh();
    return { id: out.row.id, version: out.row.version };
  });
}

const reviewSchema = z.object({
  id: z.number().int().positive(),
  seenVersion: z.number().int().min(1),
  decision: z.enum(["approve", "reject"]),
  note: zOptText(300),
});

/**
 * Yönetici: zayi isteğini karara bağlar (Onaylar › Zayi ve ikram). Geç kaydın onayı kaydı isteyenin adıyla yazar;
 * silme onayı kaydı, istendiği hâliyle duruyorsa siler (yoksa istek kapanır). Not personele görünür (tutar yazılmaz).
 */
export async function reviewWasteRequest(input: z.input<typeof reviewSchema>) {
  return attempt(async () => {
    // Yönetici ve müdür (yalnız şubesinin isteği)
    const me = await requireCan("onay");
    const data = reviewSchema.parse(input);
    const branchRefusal = await reviewBranchRefusal(getDb(), me, data.id);
    if (branchRefusal) throw new UserError(branchRefusal);
    const out = await reviewWasteRequestCore(getDb(), asActor(me, opsLevel(me.role)), data);
    const r = out.request;
    const tail = `(${r.requestedByName} istedi${r.reviewNote && out.status !== "gone" ? ` · not: ${r.reviewNote}` : ""})`;
    const late = out.kind === "zayi-gec";
    if (out.status === "rejected") await logActivity(me, late ? "Geç kayıt reddedildi" : "Silme reddedildi", `${r.title} ${tail}`);
    else if (out.status === "gone") await logActivity(me, "Silme isteği kapandı", `${r.title} ${tail} · kayıt zaten silinmişti`);
    else await logActivity(me, late ? "Geç kayıt onaylandı" : "Silme onaylandı", `${r.title} ${tail}`);
    refresh();
    return { status: out.status, who: genitive(r.requestedByName) };
  });
}
