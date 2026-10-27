"use server";

import { and, eq, notInArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { SEPARATE_CATEGORIES } from "@/lib/constants";
import { dateTR } from "@/lib/format";
import { linkChange } from "@/lib/price-hold";
import { bulkPrice } from "@/lib/supplier-prices";
import { requireAdmin } from "@/server/auth/dal";
import { newerPriceInvoice, supersedeHolds } from "@/server/data/price-holds";
import { getDb, schema as s } from "@/server/db";
import { recomputePurchaseQuantities } from "@/server/parasut/sync";

import { logActivity } from "./log";
import { attempt, UserError, zOptText } from "./util";

const zId = z.number().int().positive();
const h = s.ingredientPriceHolds;

/** Karar bu kadar gün geri alınabilir (kartın "Son kararlar"ı 3 günü gösterir, bildirimde de Geri al var) */
const UNDO_DAYS = 30;
const NOT_PENDING = "Bu fiyat önerisi artık geçerli değil; sayfayı yenileyin.";
const NEW_PENDING = "Bu hammadde için yeni bir fiyat önerisi var; önce onu karara bağlayın.";

/**
 * Karardan sonra alınan miktar yeniden hesaplanır: bekleyen fiyatın bağlantısının faturaları alınan miktara ve stok
 * partilerine girmez (onaylanınca girer, reddedilince yalnız o fatura dışarıda kalır, geri alınınca yine dışarıda;
 * src/server/data/purchase-lots-query.ts suspectFactorLine). Hatası kararı bozmaz: sonraki eşitleme yeniden hesaplar
 */
async function recountPurchases() {
  try {
    await recomputePurchaseQuantities();
  } catch (err) {
    console.error("[fiyat onayı] alınan miktar yeniden hesaplanamadı", err);
  }
}

/** "Sütaş KLA12 21.10.2026" (işlem geçmişi) */
const sourceText = (x: { supplier: string; invoiceNo: string | null; invoiceDate: string }) => `${x.supplier}${x.invoiceNo ? ` ${x.invoiceNo}` : ""} ${dateTR(x.invoiceDate)}`;
const unitOf = (price: number, size: number) => (size > 0 ? price / size : 0);
const isUniqueViolation = (e: unknown) => ((e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code) === "23505";

/**
 * Onay bekleyen fiyatı uygular: hammaddenin paket fiyatı ve boyu önerilen olur, "Tahmini" kalkar (aynı işlemde: tahmini
 * fiyatın yerine ilk gerçek fiyat; işlem geçmişine de yazılır), fiyat geçmişine "Paraşüt" olarak yazılır (zam uyarısı
 * bundan sonra işler). Hammaddenin fiyatı arada elle değiştiyse önerilen yine yazılır; değiştirilen fiyat "Geri al" için
 * saklanır. Bağlantı öneri anından beri değiştiyse, faturanın kalemi fiyat kapsamından çıktıysa ya da hammaddenin daha
 * yeni bir faturası geldiyse öneri geçersiz sayılır, fiyat yazılmaz.
 */
export async function approvePriceHold(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const hid = zId.parse(id);
    const db = getDb();
    // Bağlantı önce ve işlemin dışında denetlenir: geçersiz kalan öneri öyle kalmalı (hata işlemi geri alsa bu yazı da
    // geri alınırdı); sayfa yenilenir, kullanıcıya nedeni söylenir
    const [hold] = await db.select().from(h).where(eq(h.id, hid)).limit(1);
    if (!hold || hold.status !== "pending") throw new UserError(NOT_PENDING);
    const [[link], [line], newer] = await Promise.all([
      db.select().from(s.parasutProductLinks).where(eq(s.parasutProductLinks.productKey, hold.productKey)).limit(1),
      db
        .select({ id: s.parasutBillLines.id })
        .from(s.parasutBillLines)
        .innerJoin(s.invoices, eq(s.invoices.id, s.parasutBillLines.invoiceId))
        .where(and(eq(s.parasutBillLines.invoiceId, hold.invoiceId), eq(s.parasutBillLines.productKey, hold.productKey), notInArray(s.invoices.category, SEPARATE_CATEGORIES)))
        .limit(1),
      // Eşitleme daha yeni faturayı değerlendirince bekleyen öneriyi zaten geçersiz sayar; arada kalan öneride (yarıda
      // kalan eşitleme, aynı anda okunan kalemler) eski faturanın fiyatı yenisinin üstüne yazılmasın
      newerPriceInvoice(hold),
    ]);
    const changed = linkChange(hold, link);
    const stale = changed
      ? { note: changed, message: "Paraşüt bağlantısı değişti; bu öneri geçersiz oldu." }
      : !line
        ? { note: "Faturadaki kalem artık yok", message: "Faturadaki kalem artık yok (fatura kafe dışına taşınmış olabilir); bu öneri geçersiz oldu." }
        : newer
          ? { note: "Daha yeni fatura geldi", message: `Bu hammaddenin daha yeni bir faturası var (${newer.supplier} ${dateTR(newer.date)}); bu öneri geçersiz oldu.` }
          : null;
    if (stale) {
      await supersedeHolds([hold.id], stale.note);
      // Geçersiz kalan öneri bağlantının faturalarını artık dışarıda bırakmaz: alınan miktar bütün aylarda yeniden yazılır
      await recountPurchases();
      refresh();
      throw new UserError(stale.message);
    }
    const done = await db.transaction(async (tx) => {
      // Aynı öneriyi iki sekme aynı anda karara bağlamasın
      const [cur] = await tx.select().from(h).where(eq(h.id, hid)).for("update");
      if (!cur || cur.status !== "pending") throw new UserError(NOT_PENDING);
      const [ing] = await tx.select().from(s.ingredients).where(eq(s.ingredients.id, cur.ingredientId)).for("update");
      if (!ing) throw new UserError("Hammadde bulunamadı; sayfayı yenileyin.");
      const now = new Date();
      await tx
        .update(s.ingredients)
        .set({ packagePrice: cur.packagePrice, packageSize: cur.packageSize, isEstimate: false, updatedAt: now })
        .where(eq(s.ingredients.id, ing.id));
      await tx.insert(s.ingredientPrices).values({
        ingredientId: ing.id,
        packagePrice: cur.packagePrice,
        packageSize: cur.packageSize,
        changedBy: "Paraşüt",
        note: `${cur.supplier}${cur.invoiceNo ? ` ${cur.invoiceNo}` : ""} (${cur.invoiceDate}) · onaylayan: ${me.name}`,
      });
      await tx
        .update(h)
        .set({
          status: "approved",
          decidedBy: me.id,
          decidedByName: me.name,
          decidedAt: now,
          prevPackagePrice: ing.packagePrice,
          prevPackageSize: ing.packageSize,
          prevIsEstimate: ing.isEstimate,
        })
        .where(eq(h.id, cur.id));
      return { hold: cur, name: ing.name, unit: ing.unit, before: unitOf(ing.packagePrice, ing.packageSize), after: unitOf(cur.packagePrice, cur.packageSize), wasEstimate: ing.isEstimate };
    });
    await recountPurchases();
    await logActivity(
      me,
      "Fiyat onaylandı",
      `${done.name}: ${bulkPrice(done.before, done.unit)} → ${bulkPrice(done.after, done.unit)} (${sourceText(done.hold)})${done.wasEstimate ? " · tahmini fiyat kalktı" : ""}`,
    );
    refresh();
    return { name: done.name, unit: done.unit, before: done.before, after: done.after };
  });
}

const rejectSchema = z.object({
  id: zId,
  /** Bu Paraşüt ürününden fiyat güncellemesi kapansın (sonraki faturaların miktarı yine sayılır) */
  stopUpdates: z.boolean(),
  note: zOptText(300),
});

/**
 * Önerilen fiyatı uygulamaz: hammadde şimdiki fiyatında kalır. Sonraki faturada fiyat yine %40'tan fazla farklıysa
 * yeniden sorulur (reddedilen fatura sorulmaz); `stopUpdates` o üründen fiyat güncellemesini kapatır. Reddedilen
 * faturanın miktarı alınana ve stok partilerine girmez (çarpanı şüpheli kaldı); Tutarlılık o ayın alımını elle yazdırır.
 */
export async function rejectPriceHold(input: z.input<typeof rejectSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = rejectSchema.parse(input);
    const db = getDb();
    const done = await db.transaction(async (tx) => {
      const [cur] = await tx.select().from(h).where(eq(h.id, data.id)).for("update");
      if (!cur || cur.status !== "pending") throw new UserError(NOT_PENDING);
      const [ing] = await tx.select({ name: s.ingredients.name, unit: s.ingredients.unit }).from(s.ingredients).where(eq(s.ingredients.id, cur.ingredientId));
      // Yalnız gerçekten kapatılan güncelleme kaydedilir: "Geri al" başka bir nedenle kapalı olanı açmasın
      const stopped = data.stopUpdates
        ? await tx
            .update(s.parasutProductLinks)
            .set({ updatePrice: false })
            .where(and(eq(s.parasutProductLinks.productKey, cur.productKey), eq(s.parasutProductLinks.ingredientId, cur.ingredientId), eq(s.parasutProductLinks.updatePrice, true)))
            .returning({ id: s.parasutProductLinks.id })
        : [];
      await tx
        .update(h)
        .set({ status: "rejected", decidedBy: me.id, decidedByName: me.name, decidedAt: new Date(), note: data.note, stoppedUpdates: stopped.length > 0 })
        .where(eq(h.id, cur.id));
      return { hold: cur, name: ing?.name ?? cur.productName, unit: ing?.unit ?? "adet", stopped: stopped.length > 0 };
    });
    await recountPurchases();
    await logActivity(
      me,
      "Fiyat reddedildi",
      `${done.name}: ${bulkPrice(unitOf(done.hold.packagePrice, done.hold.packageSize), done.unit)} uygulanmadı (${sourceText(done.hold)})${done.stopped ? " · bu üründen fiyat güncellemesi kapatıldı" : ""}${data.note ? ` · not: ${data.note}` : ""}`,
    );
    refresh();
    return { name: done.name, stoppedUpdates: done.stopped };
  });
}

/**
 * Onayı ya da reddi geri alır (bildirimdeki ve "Son kararlar"daki Geri al; 30 gün): öneri yeniden onay bekler. Onay
 * geri alınınca değiştirilen fiyat, paket boyu ve "Tahmini" işareti yazılır; fiyat o arada değiştiyse (yeni fatura,
 * elle) geri alınmaz. Red geri alınınca kapatılan fiyat güncellemesi yeniden açılır. Karardan sonra hammaddenin daha
 * yeni faturası geldiyse ikisi de geri alınmaz: öneri eskidi.
 */
export async function undoPriceHold(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const hid = zId.parse(id);
    const db = getDb();
    const done = await db
      .transaction(async (tx) => {
        const [cur] = await tx.select().from(h).where(eq(h.id, hid)).for("update");
        if (!cur || (cur.status !== "approved" && cur.status !== "rejected")) throw new UserError("Bu karar artık geri alınamaz; sayfayı yenileyin.");
        if (!cur.decidedAt || Date.now() - cur.decidedAt.getTime() > UNDO_DAYS * 86_400_000) throw new UserError(`Karar ${UNDO_DAYS} günden eski; geri alınamaz. Hammaddeler'den elle düzeltin.`);
        const [other] = await tx.select({ id: h.id }).from(h).where(and(eq(h.ingredientId, cur.ingredientId), eq(h.status, "pending"))).limit(1);
        if (other) throw new UserError(NEW_PENDING);
        // Fiyatı artık daha yeni fatura belirliyor: yeniden bekleyen öneriye eşitleme bir daha bakmaz, onaylanırsa eski
        // faturanın fiyatı yenisinin üstüne yazılırdı
        const newer = await newerPriceInvoice(cur, tx);
        if (newer) {
          const hint =
            cur.status === "approved" ? " Hammaddeler'den elle düzeltin." : cur.stoppedUpdates ? " Kapatılan fiyat güncellemesini Paraşüt sayfasından açabilirsiniz." : "";
          throw new UserError(`Bu karardan sonra daha yeni bir fatura geldi (${newer.supplier} ${dateTR(newer.date)}); geri alınamaz.${hint}`);
        }
        const [ing] = await tx.select().from(s.ingredients).where(eq(s.ingredients.id, cur.ingredientId)).for("update");
        if (!ing) throw new UserError("Hammadde bulunamadı; sayfayı yenileyin.");
        let reopened = false;
        if (cur.status === "approved") {
          if (Math.abs(ing.packagePrice - cur.packagePrice) > 1e-9 || Math.abs(ing.packageSize - cur.packageSize) > 1e-9) {
            throw new UserError("Fiyat sonradan değişti; geri alınamaz. Hammaddeler'den elle düzeltin.");
          }
          await tx
            .update(s.ingredients)
            .set({ packagePrice: cur.prevPackagePrice, packageSize: cur.prevPackageSize, isEstimate: cur.prevIsEstimate, updatedAt: new Date() })
            .where(eq(s.ingredients.id, ing.id));
          await tx.insert(s.ingredientPrices).values({
            ingredientId: ing.id,
            packagePrice: cur.prevPackagePrice,
            packageSize: cur.prevPackageSize,
            changedBy: me.name,
            note: "Fiyat onayı geri alındı",
          });
        } else if (cur.stoppedUpdates) {
          const opened = await tx
            .update(s.parasutProductLinks)
            .set({ updatePrice: true })
            .where(and(eq(s.parasutProductLinks.productKey, cur.productKey), eq(s.parasutProductLinks.ingredientId, cur.ingredientId)))
            .returning({ id: s.parasutProductLinks.id });
          reopened = opened.length > 0;
        }
        await tx.update(h).set({ status: "pending", decidedBy: null, decidedByName: null, decidedAt: null, note: null, stoppedUpdates: false }).where(eq(h.id, cur.id));
        return { hold: cur, name: ing.name, unit: ing.unit, reopened };
      })
      .catch((e: unknown) => {
        // Aynı anda gelen yeni öneri (eşitleme) kısmi tekil dizine takılır
        throw isUniqueViolation(e) ? new UserError(NEW_PENDING) : e;
      });
    const { hold, name, unit, reopened } = done;
    await recountPurchases();
    await logActivity(
      me,
      "Fiyat kararı geri alındı",
      hold.status === "approved"
        ? `${name}: ${bulkPrice(unitOf(hold.packagePrice, hold.packageSize), unit)} → ${bulkPrice(unitOf(hold.prevPackagePrice, hold.prevPackageSize), unit)} (onay geri alındı; öneri yeniden onay bekliyor)`
        : `${name}: red geri alındı; öneri yeniden onay bekliyor${reopened ? " · fiyat güncellemesi yeniden açıldı" : ""}`,
    );
    refresh();
    return { name, status: hold.status };
  });
}
