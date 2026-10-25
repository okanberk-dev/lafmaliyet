"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { tl } from "@/lib/format";
import { genitive } from "@/lib/recipe-change";
import { toMinor } from "@/lib/site-menu/slot";
import { requireUser } from "@/server/auth/dal";
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

/** Ürünün kısa adı ve fiyatı: "Latte M 205 ₺" */
const posText = (r: { label: string; price: number }) => `${r.label} ${tl(r.price, toMinor(r.price) % 100 ? 2 : 0)}`;

/**
 * Kasada (ModPOS) değiştirildi: ürünler listeden düşer, her biri için işaret yazılır. Personel bir seferde tek ürün ve
 * yalnız etkin ürün. Fiyatı bu arada yeniden değişen `changed`'de bugünkü satış fiyatıyla döner; başkasının az önce
 * işaretlediği `already`'de (yalnız kimlik). `done` "Geri al" içindir (işaretin kimliği).
 */
export async function markPosDone(items: z.input<typeof zPosDone>) {
  return attempt(async () => {
    const me = await requireUser();
    const data = zPosDone.parse(items);
    const r = await markPos(getDb(), { id: me.id, name: me.name, role: me.role }, data, new Date());
    if (r.done.length) await logActivity(me, "Kasaya işlendi", r.done.map(posText).join(", "));
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
    const me = await requireUser();
    const data = zUndo.parse(ids);
    const r = await undoPos(getDb(), { id: me.id, name: me.name, role: me.role }, data, new Date());
    if (!r.undone.length && r.refused.length) throw new UserError(r.refused[0].reason);
    if (r.undone.length) {
      // Başkasının işaretiyse kimin olduğu yazılır: "Latte M 205 ₺ (Ayşe'nin işareti)"
      await logActivity(me, "Kasaya işlendi geri alındı", r.undone.map((u) => `${posText(u)}${u.by === me.name ? "" : ` (${genitive(u.by)} işareti)`}`).join(", "));
    }
    refresh();
    return { undone: r.undone.length, refused: r.refused.map((x) => ({ label: x.label, reason: x.reason })) };
  });
}
