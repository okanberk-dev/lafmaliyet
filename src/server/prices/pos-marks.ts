// "server-only" yok ve sunucu eylemi değil: veritabanıyla gidip gelen test (tests/kasaya-isle-db.test.ts) bu dosyayı
// doğrudan çalıştırır (src/server/staff-requests/core.ts gibi). İşlevler veritabanını parametre alır; oturum ve rol
// denetimi eylemlerde (src/server/actions/pos-marks.ts, requireUser), burada yalnız kurallar.

/**
 * Kasaya işle işaretlerinin çekirdeği (docs/FIYATLAR.md; plan docs/planlar/personel-yetki.md §2.2). Personel de
 * işaretler (Kasadaki fiyatlar), onaysız: her işaret pos_marks'a kim, hangi ürün, hangi fiyat ve kasada duran eski
 * fiyatla yazılır, geri alınabilir.
 *
 * - markPos: ürünler kimlik sırasıyla kilitlenir (FOR UPDATE); personelde ürün etkin olmalı (Kasadaki fiyatlar listesi
 *   yalnız etkin ürünleri gösterir) ve bir seferde bir ürün. Fiyatı hâlâ görülen fiyat olan işaretlenir (splitPosDone),
 *   bu arada değişen `changed`'e, listede olmayan (başkası işaretledi) `already`'e (yalnız kimlik) düşer.
 * - undoPos: önce işaretler, sonra ürünler kimlik sırasıyla kilitlenir; ürünün o şubedeki en son işareti aynı kilit
 *   altında okunur; kural posUndoRefusal. Saklanan bayat fiyat ve an o şubenin kasasına geri yazılır: istemciden fiyat
 *   alınmaz.
 *
 * Kasa şube başınadır (pos_stale, pos_marks.branch_id; şube kapsamı A3): işaret yalnız kendi şubesinin satırını siler ve
 * geri alma yalnız onu geri getirir. Tuzla'da işaretlenen fiyat Marina'nın listesinde kalır. Ürün satırının kilidi fiyat
 * yazımıyla (src/server/prices/record.ts) aynı sırayı korur: önce ürün, sonra kasa satırı.
 */

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { posMarkMax, posUndoRefusal, splitPosDone } from "../../lib/prices/pos";
import type { DB } from "../db";
import * as s from "../db/schema";
import { UserError } from "../user-error";

export interface PosMarkUser {
  id: number;
  name: string;
  role: "admin" | "staff";
}

export interface MarkPosResult {
  /** İşaretlenenler: işaretin kimliği (geri alma için), ürün, kısa ad ve kasaya yazılan satış fiyatı */
  done: { markId: number; productId: number; label: string; price: number }[];
  /** Liste açıldıktan sonra fiyatı yeniden değişenler: bugünkü satış fiyatıyla listede kalır */
  changed: { productId: number; label: string; price: number }[];
  /** Zaten işaretlenmiş (listede değil): yalnız kimlik */
  already: number[];
}

const label = (r: { name: string; size: string }) => `${r.name} ${r.size}`;

/** `branchId` şubesinin kasasında değiştirildi: ürünler o şubenin listesinden düşer, her biri için bir işaret yazılır */
export async function markPos(db: DB, user: PosMarkUser, items: readonly { productId: number; price: number }[], now: Date, branchId: string): Promise<MarkPosResult> {
  if (!items.length) throw new UserError("Ürün seçin");
  if (items.length > posMarkMax(user.role)) throw new UserError(user.role === "admin" ? `Bir seferde en çok ${posMarkMax("admin")} ürün` : "Fiyatları tek tek işaretleyin");
  const seen = new Map(items.map((i) => [i.productId, i.price]));
  if (seen.size !== items.length) throw new UserError("Aynı ürün iki kez seçilmiş");
  return db.transaction(async (tx) => {
    const p = s.products;
    const locked = await tx
      .select({ id: p.id, name: p.name, size: p.size, price: p.price, active: p.active })
      .from(p)
      .where(inArray(p.id, [...seen.keys()]))
      .orderBy(asc(p.id))
      .for("update");
    if (locked.length !== seen.size) throw new UserError("Ürün bulunamadı; sayfayı yenileyin");
    // Personel yalnız kendi listesindekileri (etkin ürünler) işaretler
    if (user.role !== "admin" && locked.some((r) => !r.active)) throw new UserError("Bu ürün Kasadaki fiyatlar listesinde değil; sayfayı yenileyin");
    const ps = s.posStale;
    const stale = await tx
      .select({ productId: ps.productId, stalePrice: ps.stalePrice, since: ps.staleSince })
      .from(ps)
      .where(and(eq(ps.branchId, branchId), inArray(ps.productId, [...seen.keys()])));
    const rows = locked.map((r) => {
      const st = stale.find((x) => x.productId === r.id);
      return { ...r, stalePrice: st?.stalePrice ?? null, since: st?.since ?? null };
    });
    const listed = rows.filter((r) => r.stalePrice !== null);
    const already = rows.filter((r) => r.stalePrice === null).map((r) => r.id);
    const split = splitPosDone(listed, seen);
    const done: MarkPosResult["done"] = [];
    if (split.done.length) {
      await tx.delete(ps).where(
        and(
          eq(ps.branchId, branchId),
          inArray(
            ps.productId,
            split.done.map((r) => r.id),
          ),
        ),
      );
      const marks = await tx
        .insert(s.posMarks)
        .values(
          split.done.map((r) => ({
            productId: r.id,
            branchId,
            price: r.price,
            stalePrice: r.stalePrice!,
            staleSince: r.since ?? now,
            markedBy: user.id,
            markedByName: user.name,
            markedAt: now,
          })),
        )
        .returning({ id: s.posMarks.id, productId: s.posMarks.productId });
      for (const r of split.done) done.push({ markId: marks.find((m) => m.productId === r.id)!.id, productId: r.id, label: label(r), price: r.price });
    }
    return { done, changed: split.changed.map((r) => ({ productId: r.id, label: label(r), price: r.price })), already };
  });
}

export interface UndoPosResult {
  /** Geri alınanlar: kısa ad, işaretin fiyatı ve işaretleyenin (o andaki) adı */
  undone: { markId: number; productId: number; branchId: string; label: string; price: number; by: string }[];
  /** Geri alınamayanlar ve nedeni */
  refused: { markId: number; label: string; reason: string }[];
}

/** İşaretleri geri alır: ürün kasaya işle listesine işaretten önceki hâliyle (kasadaki fiyat, ne zamandan beri) döner */
export async function undoPos(
  db: DB,
  user: PosMarkUser,
  markIds: readonly number[],
  now: Date,
  /** Şubeye kilitli personel: işaretin şubesi onun değilse gerekçe (staffBranchRefusal; başka şubenin kasa listesine yazmaz) */
  branchRefusal: (branchId: string) => string | null = () => null,
): Promise<UndoPosResult> {
  const ids = [...new Set(markIds)];
  if (!ids.length) throw new UserError("İşaret seçin");
  return db.transaction(async (tx) => {
    const m = s.posMarks;
    const marks = await tx.select().from(m).where(inArray(m.id, ids)).orderBy(asc(m.id)).for("update");
    const productIds = [...new Set(marks.map((x) => x.productId))];
    const p = s.products;
    const products = productIds.length
      ? await tx
          .select({ id: p.id, name: p.name, size: p.size, price: p.price })
          .from(p)
          .where(inArray(p.id, productIds))
          .orderBy(asc(p.id))
          .for("update")
      : [];
    const ps = s.posStale;
    // Ürünler kilitliyken: işaretlerin şubelerindeki kasa satırları (araya fiyat yazımı ya da işaret giremez)
    const stale = productIds.length
      ? await tx.select({ branchId: ps.branchId, productId: ps.productId, stalePrice: ps.stalePrice }).from(ps).where(inArray(ps.productId, productIds))
      : [];
    const staleOf = (branchId: string, productId: number) => stale.find((x) => x.branchId === branchId && x.productId === productId)?.stalePrice ?? null;
    const out: UndoPosResult = { undone: [], refused: [] };
    for (const id of ids.filter((i) => !marks.some((x) => x.id === i))) out.refused.push({ markId: id, label: "", reason: "İşaret bulunamadı; sayfayı yenileyin" });
    for (const mark of marks) {
      const product = products.find((x) => x.id === mark.productId) ?? null;
      // Ürünün bu şubedeki en son işareti (geri alınmışlar dahil), ürün kilitliyken: araya yeni işaret giremez
      const [latest] = await tx
        .select({ id: m.id })
        .from(m)
        .where(and(eq(m.productId, mark.productId), eq(m.branchId, mark.branchId)))
        .orderBy(desc(m.id))
        .limit(1);
      const current = product ? { price: product.price, posStalePrice: staleOf(mark.branchId, mark.productId) } : null;
      const reason = branchRefusal(mark.branchId) ?? posUndoRefusal({ role: user.role, meId: user.id, now }, mark, current, latest?.id ?? null);
      const name = product ? label(product) : "";
      if (reason) {
        out.refused.push({ markId: mark.id, label: name, reason });
        continue;
      }
      // Kural satırın olmadığını söyledi (relisted değil); yine de çakışırsa saklanan durum yazılır
      await tx
        .insert(ps)
        .values({ branchId: mark.branchId, productId: mark.productId, stalePrice: mark.stalePrice, staleSince: mark.staleSince })
        .onConflictDoUpdate({ target: [ps.branchId, ps.productId], set: { stalePrice: mark.stalePrice, staleSince: mark.staleSince } });
      await tx
        .update(m)
        .set({ undoneAt: now, undoneByName: user.name })
        .where(eq(m.id, mark.id));
      // Aynı şubede aynı ürünün sıradaki işareti artık "son" değil: kasa satırı yeniden dolu
      stale.push({ branchId: mark.branchId, productId: mark.productId, stalePrice: mark.stalePrice });
      out.undone.push({ markId: mark.id, productId: mark.productId, branchId: mark.branchId, label: name, price: mark.price, by: mark.markedByName });
    }
    return out;
  });
}
