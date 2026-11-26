"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { tl } from "@/lib/format";
import { genitive } from "@/lib/recipe-change";
import { toMinor } from "@/lib/site-menu/slot";
import { namedTill, zFormBranch } from "@/lib/branches";
import { adminActor } from "@/lib/roles";
import { requireCan } from "@/server/auth/dal";
import { formBranch, staffBranchRefusal } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { loadTillScope } from "@/server/data/till-scope";
import { getDb } from "@/server/db";
import { markPos, undoPos } from "@/server/prices/pos-marks";

import { logActivity } from "./log";
import { attempt, UserError, zMoney } from "./util";

/*
 * Kasaya işle (docs/FIYATLAR.md; dalga 10 §2.2): kasada (ModPOS) değiştirilen fiyatın işaretlenmesi ve geri alınması.
 * Personel de işaretler (Kasadaki fiyatlar, onaysız: fiyatı ModPOS'ta zaten personel değiştirir); her işaret kişinin
 * adıyla pos_marks'a ve İşlem geçmişine yazılır, yönetici Fiyatlar › Kasaya işle › Son işaretlenenler'den geri alır.
 * Kurallar çekirdekte (src/server/prices/pos-marks.ts); dönüşte yalnız ad, satış fiyatı ve kimlikler (maliyet yok).
 */

const zId = z.number().int().positive();
/** Kasada işaretlenen ürünler; `price` listede (ya da ürün kartında) görülen, kasaya yazılan satış fiyatı */
const zPosDone = z
  .array(z.object({ productId: zId, price: zMoney.min(0) }))
  .min(1, "Ürün seçin")
  .max(500, "Bir seferde en çok 500 ürün");
/** Geri alınacak işaretlerin kimlikleri; istemciden fiyat alınmaz (saklanan bayat fiyat ürüne geri yazılır) */
const zUndo = z.array(zId).min(1, "İşaret seçin").max(500, "Bir seferde en çok 500 işaret");

/** İşlem geçmişinde kasanın adı, birden çok kasa açıkken: "Marina: " (tek kasada boş) */
async function tillPrefix(branchId: string): Promise<string> {
  const named = namedTill(await listBranches(), branchId);
  return named ? `${named.name}: ` : "";
}

/** Ürünün kısa adı ve fiyatı: "Latte M 205 ₺" */
const posText = (r: { label: string; price: number }) => `${r.label} ${tl(r.price, toMinor(r.price) % 100 ? 2 : 0)}`;

/**
 * Kasada (ModPOS) değiştirildi: ürünler listeden düşer, her biri için işaret yazılır. Personel bir seferde tek ürün ve
 * yalnız etkin ürün. Fiyatı bu arada yeniden değişen `changed`'de bugünkü satış fiyatıyla döner; başkasının az önce
 * işaretlediği `already`'de (yalnız kimlik). `done` "Geri al" içindir (işaretin kimliği). LafPOS gününde (geçiş
 * gününden itibaren; denetim E-39) personel işaretlemez: LafPOS'ta ürün fiyatını kasiyer değiştiremez, liste ve görev
 * personelde yok; kendi işaretini geri alması (undoPosMarks) sürer.
 *
 * `branchId`: listenin gösterdiği kasa (şube kapsamı A3; docs/SUBE.md › Yazarken hangi şube): işaret yalnız o şubenin
 * kasasından düşer. Kimliği göndermeyen eski sekme seçime göre yazar; "Tümü"de birden çok kasa açıkken kimlik
 * gelmediyse reddedilir (`formBranch`, kasa türü). Şubesine kilitli personel yalnız kendi şubesini işaretler.
 */
export async function markPosDone(items: z.input<typeof zPosDone>, branchId?: string | null) {
  return attempt(async () => {
    const me = adminActor(await requireCan("kayit.yaz"));
    const data = zPosDone.parse(items);
    const till = await formBranch(zFormBranch.parse(branchId), "till", { requireExplicit: true });
    if (me.role !== "admin" && (await loadTillScope(undefined, undefined, till)).lafpos) throw new UserError("Kasada LafPOS kullanılıyor: fiyatı LafPOS'ta yönetici değiştirir, işaretlemeniz gerekmez");
    const r = await markPos(getDb(), { id: me.id, name: me.name, role: me.role }, data, new Date(), till);
    if (r.done.length) await logActivity(me, "Kasaya işlendi", `${await tillPrefix(till)}${r.done.map(posText).join(", ")}`);
    refresh();
    return {
      done: r.done.map((d) => ({ markId: d.markId, productId: d.productId, label: d.label, price: d.price })),
      changed: r.changed.map((c) => ({ productId: c.productId, label: c.label, price: c.price })),
      already: r.already,
    };
  });
}

/**
 * İşaretlerin geri alınması: ürün listeye işaretten önceki hâliyle döner. Personel yalnız kendi işaretini, 30 dakika
 * içinde; herkes için yalnız ürünün son işareti ve ürün listeye yeniden girmemişse (posUndoRefusal). Alınamayanlar
 * nedeniyle döner; hiçbiri alınamadıysa ilk neden hata olarak gösterilir.
 */
export async function undoPosMarks(ids: z.input<typeof zUndo>) {
  return attempt(async () => {
    const me = adminActor(await requireCan("kayit.yaz"));
    const data = zUndo.parse(ids);
    // Şubeye kilitli personel yalnız kendi şubesinin işaretini geri alır (hesabı sonradan başka şubeye kilitlenmiş olsa da)
    const refusals = new Map(me.role === "admin" ? [] : await Promise.all((await listBranches()).map(async (b) => [b.id, await staffBranchRefusal(me, b.id)] as const)));
    const r = await undoPos(getDb(), { id: me.id, name: me.name, role: me.role }, data, new Date(), (id) => refusals.get(id) ?? null);
    if (!r.undone.length && r.refused.length) throw new UserError(r.refused[0].reason);
    if (r.undone.length) {
      // Başkasının işaretiyse kimin olduğu yazılır: "Latte M 205 ₺ (Ayşe'nin işareti)"; birden çok kasada şube önde
      const branches = await listBranches();
      const till = (id: string) => (namedTill(branches, id) ? `${namedTill(branches, id)!.name}: ` : "");
      await logActivity(me, "Kasaya işlendi geri alındı", r.undone.map((u) => `${till(u.branchId)}${posText(u)}${u.by === me.name ? "" : ` (${genitive(u.by)} işareti)`}`).join(", "));
    }
    refresh();
    return { undone: r.undone.length, refused: r.refused.map((x) => ({ label: x.label, reason: x.reason })) };
  });
}
