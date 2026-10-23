"use server";

import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { countFactor } from "@/lib/calc/engine";
import { businessDate } from "@/lib/cash-report";
import { SEPARATE_CATEGORIES } from "@/lib/constants";
import { dateTR, num } from "@/lib/format";
import { mobileE164, qtyLabel } from "@/lib/reorder/message";
import { REORDER_SETTINGS_KEY } from "@/lib/reorder/types";
import { addDays, todayTR } from "@/lib/reminders";
import { requireAdmin, requireUser } from "@/server/auth/dal";
import { loadSupplierIndex, orderSnapshot } from "@/server/data/reorder";
import { getDb, schema as s } from "@/server/db";
import { matchSupplierOrders } from "@/server/reorder/match";

import { logActivity } from "./log";
import { attempt, UserError, zOptText } from "./util";

/*
 * Mal siparişinin eylemleri (docs/MAL-SIPARISI.md). Hızlı sayım ve "Geldi" işareti iki role açık; sipariş listesi,
 * gönderme, gönderilenler ve kalemler yalnız yöneticinin (her eylem kendi yetkisini denetler: proxy yalnız sayfa
 * yönlendirmesidir).
 */

const zId = z.number().int().positive();
/** "26.10" (işlem geçmişinde siparişin günü) */
const shortDay = (d: string) => dateTR(d).slice(0, 5);
const orderRef = (o: { supplier: string; sentAt: Date }) => `${o.supplier} ${shortDay(todayTR(o.sentAt))}`;

// ---------------------------------------------------------------- Hızlı sayım (iki rol)

/**
 * Bugünün (iş günü, 05:00'te döner) hızlı sayımını kaydeder; gün sunucunun saatinden. Kalem takipte ve sayılabilir
 * olmalı. `qty` null bugünkü sayımı siler. `base`: kişinin formu açtığında gördüğü bugünkü miktar; arada başkası o
 * kalemi kaydettiyse hiçbir şey yazılmaz (Stok sayımı ile aynı kural), sayfa yenilenir.
 */
export async function saveQuickCounts(entries: { ingredientId: number; qty: number | null; base?: number | null }[]) {
  return attempt(async () => {
    const me = await requireUser();
    const data = z
      .array(
        z.object({
          ingredientId: zId,
          qty: z.number().finite().min(0, "Miktar negatif olamaz").max(1_000_000, "Miktar çok büyük").nullable(),
          base: z.number().finite().nullable().optional(),
        }),
      )
      .max(200, "Bir seferde en çok 200 kalem")
      .parse(entries);
    if (!data.length) return { saved: 0, removed: 0 };
    if (new Set(data.map((e) => e.ingredientId)).size !== data.length) throw new UserError("Aynı kalem iki kez gönderildi; sayfayı yenileyin.");
    const now = new Date();
    const day = businessDate(now);
    const db = getDb();
    const ids = data.map((e) => e.ingredientId);
    const i = s.ingredients;
    const ings = new Map(
      (
        await db
          .select({ id: i.id, name: i.name, countUnit: i.countUnit, active: i.active, priceSource: i.priceSource, tracked: s.reorderItems.ingredientId })
          .from(i)
          .leftJoin(s.reorderItems, eq(s.reorderItems.ingredientId, i.id))
          .where(inArray(i.id, ids))
      ).map((r) => [r.id, r]),
    );
    for (const id of ids) {
      const ing = ings.get(id);
      if (!ing || ing.tracked === null || !ing.active || !ing.countUnit || ing.priceSource === "water") {
        throw new UserError(`${ing?.name ?? "Bir kalem"} hızlı sayım listesinde değil; sayfayı yenileyin.`);
      }
    }
    const q = s.quickCounts;
    const { saved, removed } = await db.transaction(async (tx) => {
      const checked = data.filter((e) => e.base !== undefined);
      if (checked.length) {
        const current = new Map(
          (
            await tx
              .select({ id: q.ingredientId, qty: q.qty })
              .from(q)
              .where(and(eq(q.day, day), inArray(q.ingredientId, checked.map((e) => e.ingredientId))))
          ).map((r) => [r.id, r.qty]),
        );
        const stale = checked.filter((e) => {
          const cur = current.get(e.ingredientId) ?? null;
          return cur !== e.base && cur !== e.qty;
        });
        if (stale.length) {
          const names = stale.map((e) => ings.get(e.ingredientId)!.name);
          // Form yeni değerleri alsın: dokunulmayan satırlar güncellenir, çakışanlar işaretlenir
          refresh();
          throw new UserError(
            `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` ve ${names.length - 3} kalem daha` : ""} bu arada başkası tarafından kaydedildi; hiçbir şey kaydedilmedi. İşaretli satırları kontrol edip yeniden kaydedin.`,
          );
        }
      }
      const clear = data.filter((e) => e.qty === null).map((e) => e.ingredientId);
      const gone = clear.length ? (await tx.delete(q).where(and(eq(q.day, day), inArray(q.ingredientId, clear))).returning({ id: q.id })).length : 0;
      const filled = data.filter((e) => e.qty !== null);
      for (const e of filled) {
        const factor = countFactor(ings.get(e.ingredientId)!.countUnit);
        await tx
          .insert(q)
          .values({ ingredientId: e.ingredientId, day, qty: e.qty!, factor, countedAt: now, countedBy: me.id, countedByName: me.name })
          .onConflictDoUpdate({ target: [q.ingredientId, q.day], set: { qty: e.qty!, factor, countedAt: now, countedBy: me.id, countedByName: me.name } });
      }
      return { saved: filled.length, removed: gone };
    });
    const parts = [saved ? `${saved} kalem` : "", removed ? `${removed} silindi` : ""].filter(Boolean);
    if (parts.length) await logActivity(me, "Hızlı sayım", parts.join(", "));
    refresh();
    return { saved, removed };
  });
}

/**
 * "Geldi": sipariş edilen mal geldi (hızlı sayımdan önce işaretlenir; işaretlenmezse sipariş listesinde ikinci kez
 * "siparişte" sayılır). Personel de işaretler. Geri alma: faturası bağlanmamışsa yönetici her zaman, personel yalnız
 * kendi işaretini 30 dakika içinde.
 */
export async function markOrderReceived(input: { id: number; received: boolean }) {
  return attempt(async () => {
    const me = await requireUser();
    const { id, received } = z.object({ id: zId, received: z.boolean() }).parse(input);
    const db = getDb();
    const o = s.supplierOrders;
    const [order] = await db.select().from(o).where(eq(o.id, id)).limit(1);
    if (!order) throw new UserError("Sipariş bulunamadı; sayfayı yenileyin.");
    const now = new Date();
    if (received) {
      const [row] = await db
        .update(o)
        .set({ receivedAt: now, receivedBy: me.id, receivedByName: me.name, updatedAt: now })
        .where(and(eq(o.id, id), eq(o.status, "open"), isNull(o.receivedAt)))
        .returning({ id: o.id });
      if (!row) throw new UserError("Bu sipariş zaten işaretli; sayfayı yenileyin.");
      await logActivity(me, "Mal siparişi geldi", orderRef(order));
    } else {
      const own = order.receivedBy === me.id && order.receivedAt !== null && now.getTime() - order.receivedAt.getTime() < 30 * 60_000;
      if (order.status !== "open" || order.invoiceId !== null || !order.receivedAt || (me.role !== "admin" && !own)) throw new UserError("Geri almak için yöneticiye yazın.");
      await db
        .update(o)
        .set({ receivedAt: null, receivedBy: null, receivedByName: null, updatedAt: now })
        .where(and(eq(o.id, id), eq(o.status, "open"), isNull(o.invoiceId)));
      await logActivity(me, "Mal siparişi geldi işareti kaldırıldı", orderRef(order));
    }
    refresh();
    return null;
  });
}

// ---------------------------------------------------------------- Gönderme (yönetici)

const sentSchema = z.object({
  requestId: z.string().uuid("Geçersiz istek"),
  supplierKey: z.string().trim().min(1, "Tedarikçi gerekli").max(200),
  lines: z
    .array(z.object({ ingredientId: zId, qty: z.number().finite().positive("Miktar 0'dan büyük olmalı").max(9999, "Miktar çok büyük") }))
    .min(1, "Gönderilecek kalem yok")
    .max(40, "Bir siparişte en çok 40 kalem"),
  note: zOptText(300),
  message: z.string().trim().min(1, "Mesaj boş").max(4000, "Mesaj çok uzun"),
  channel: z.enum(["whatsapp", "kopya"]),
});

/**
 * Gönderilen siparişi kaydeder (WhatsApp'ta aç ya da "Gönderildi say"). Aynı istek kimliği ikinci sipariş açmaz (çift
 * dokunuş, yeniden deneme). Satırlar sunucudaki güncel veriden kurulur (ad, birim, teslim süresi, öneri, eldeki, hedef,
 * beklenen fiyat); istemciden yalnız miktar alınır. Numara yalnız WhatsApp'la ve cep numarasıysa saklanır.
 */
export async function recordOrderSent(input: z.input<typeof sentSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = sentSchema.parse(input);
    const db = getDb();
    const o = s.supplierOrders;
    const [existing] = await db.select({ id: o.id }).from(o).where(eq(o.requestId, data.requestId)).limit(1);
    if (existing) return { id: existing.id };
    if (new Set(data.lines.map((l) => l.ingredientId)).size !== data.lines.length) throw new UserError("Aynı kalem iki kez yazılmış; sayfayı yenileyin.");
    const snap = await orderSnapshot(
      data.supplierKey,
      data.lines.map((l) => ({ ingredientId: l.ingredientId, qty: Math.round(l.qty * 100) / 100 })),
    );
    if ("error" in snap) throw new UserError(snap.error);
    const now = new Date();
    const [row] = await db
      .insert(o)
      .values({
        requestId: data.requestId,
        supplier: snap.supplier.name,
        phone: data.channel === "whatsapp" ? mobileE164(snap.supplier.card?.phone) : null,
        channel: data.channel,
        message: data.message,
        note: data.note,
        lines: snap.lines,
        sentAt: now,
        sentBy: me.id,
        sentByName: me.name,
        expectedOn: addDays(todayTR(now), snap.maxLead),
      })
      .onConflictDoNothing({ target: o.requestId })
      .returning({ id: o.id });
    if (!row) {
      const [again] = await db.select({ id: o.id }).from(o).where(eq(o.requestId, data.requestId)).limit(1);
      if (again) return { id: again.id };
      throw new UserError("Sipariş kaydedilemedi; yeniden deneyin.");
    }
    await logActivity(me, "Mal siparişi gönderildi", `${snap.supplier.name}: ${num(snap.lines.length)} kalem · ${data.channel === "whatsapp" ? "WhatsApp" : "kopyalandı"}`);
    refresh();
    return { id: row.id };
  });
}

/** Siparişin iptali (gönderdikten hemen sonra "Geri al" da bunu çağırır): açık, gelmemiş ve faturası bağlanmamış */
export async function cancelOrder(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const oid = zId.parse(id);
    const db = getDb();
    const o = s.supplierOrders;
    const now = new Date();
    const [row] = await db
      .update(o)
      .set({ status: "cancelled", closedAt: now, closedByName: me.name, updatedAt: now })
      .where(and(eq(o.id, oid), eq(o.status, "open"), isNull(o.receivedAt), isNull(o.invoiceId)))
      .returning({ supplier: o.supplier, sentAt: o.sentAt });
    if (!row) throw new UserError("Bu sipariş iptal edilemez: gelmiş, faturası bağlı ya da zaten kapalı. Kapat ile kapatın.");
    await logActivity(me, "Mal siparişi iptal edildi", orderRef(row));
    refresh();
    return null;
  });
}

const closeSchema = z.object({ id: zId, note: zOptText(300) });

/** Siparişi kapatır (farkı tedarikçiyle konuştuktan sonra; not isteğe bağlı) */
export async function closeOrder(input: z.input<typeof closeSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { id, note } = closeSchema.parse(input);
    const db = getDb();
    const o = s.supplierOrders;
    const now = new Date();
    const [row] = await db
      .update(o)
      .set({ status: "closed", closedAt: now, closedByName: me.name, closeNote: note, updatedAt: now })
      .where(and(eq(o.id, id), eq(o.status, "open")))
      .returning({ supplier: o.supplier, sentAt: o.sentAt });
    if (!row) throw new UserError("Sipariş zaten kapalı; sayfayı yenileyin.");
    await logActivity(me, "Mal siparişi kapatıldı", `${orderRef(row)}${note ? ` · ${note}` : ""}`);
    refresh();
    return null;
  });
}

/** Kapanan (iptal olmayan) siparişi 30 gün içinde yeniden açar; teslim kontrolü hemen yenilenir */
export async function reopenOrder(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const oid = zId.parse(id);
    const db = getDb();
    const o = s.supplierOrders;
    const now = new Date();
    const [order] = await db.select({ status: o.status, closedAt: o.closedAt, supplier: o.supplier, sentAt: o.sentAt }).from(o).where(eq(o.id, oid)).limit(1);
    if (!order || order.status !== "closed" || !order.closedAt || now.getTime() - order.closedAt.getTime() > 30 * 86_400_000) {
      throw new UserError("Yalnız son 30 günde kapanan sipariş yeniden açılır.");
    }
    const [row] = await db
      .update(o)
      .set({ status: "open", closedAt: null, closedByName: null, closeNote: null, updatedAt: now })
      .where(and(eq(o.id, oid), eq(o.status, "closed")))
      .returning({ id: o.id });
    if (!row) throw new UserError("Sipariş bu arada değişti; sayfayı yenileyin.");
    await matchSupplierOrders({ orderIds: [oid] }).catch((e) => console.error("[mal-siparisi] teslim kontrolü", e));
    await logActivity(me, "Mal siparişi yeniden açıldı", orderRef(order));
    refresh();
    return null;
  });
}

const invoiceSchema = z.object({ id: zId, invoiceId: zId.nullable() });

/**
 * Siparişin faturasını elle seçer ya da eşleşmeyi kaldırır ("Fatura yok"): eşitleme o siparişe artık fatura aramaz.
 * Fatura başka bir siparişe bağlı olamaz; kafe dışı (karaoke box, Alp Koç) fatura seçilemez.
 */
export async function setOrderInvoice(input: z.input<typeof invoiceSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { id, invoiceId } = invoiceSchema.parse(input);
    const db = getDb();
    const o = s.supplierOrders;
    if (invoiceId !== null) {
      const [inv] = await db.select({ category: s.invoices.category }).from(s.invoices).where(eq(s.invoices.id, invoiceId)).limit(1);
      if (!inv || SEPARATE_CATEGORIES.includes(inv.category)) throw new UserError("Fatura bulunamadı; sayfayı yenileyin.");
      const [other] = await db
        .select({ id: o.id })
        .from(o)
        .where(and(eq(o.invoiceId, invoiceId), ne(o.id, id)))
        .limit(1);
      if (other) throw new UserError("Bu fatura başka bir siparişe bağlı.");
    }
    const now = new Date();
    let row: { supplier: string; sentAt: Date; receivedByName: string | null } | undefined;
    try {
      [row] = await db
        .update(o)
        .set({ invoiceId, manualMatch: true, deliveryCheck: null, checkedAt: null, updatedAt: now })
        .where(and(eq(o.id, id), eq(o.status, "open")))
        .returning({ supplier: o.supplier, sentAt: o.sentAt, receivedByName: o.receivedByName });
    } catch (e) {
      if (((e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code) === "23505") throw new UserError("Bu fatura başka bir siparişe bağlı.");
      throw e;
    }
    if (!row) throw new UserError("Sipariş kapalı; önce yeniden açın.");
    // Faturanın yazdığı "geldi", fatura kalkınca geri alınır (elle "Geldi" kalır)
    if (invoiceId === null && row.receivedByName === "Fatura") {
      await db.update(o).set({ receivedAt: null, receivedByName: null }).where(eq(o.id, id));
    }
    await matchSupplierOrders({ orderIds: [id] }).catch((e) => console.error("[mal-siparisi] teslim kontrolü", e));
    await logActivity(me, "Mal siparişi faturası değişti", `${orderRef(row)}: ${invoiceId === null ? "fatura yok" : `fatura #${invoiceId}`}`);
    refresh();
    return null;
  });
}

// ---------------------------------------------------------------- Kalemler (yönetici)

/** Takibe alır: etkin, sayım birimi olan, su ya da buz olmayan hammaddeler */
export async function trackIngredients(ids: number[]) {
  return attempt(async () => {
    const me = await requireAdmin();
    const list = z.array(zId).min(1, "Kalem seçin").max(60).parse(ids);
    const db = getDb();
    const i = s.ingredients;
    const rows = await db.select({ id: i.id, name: i.name, active: i.active, countUnit: i.countUnit, priceSource: i.priceSource }).from(i).where(inArray(i.id, list));
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of list) {
      const r = byId.get(id);
      if (!r) throw new UserError("Hammadde bulunamadı; sayfayı yenileyin.");
      if (!r.active || !r.countUnit || r.priceSource === "water") throw new UserError(`${r.name} takip edilemez: pasif, sayım birimi yok ya da su / buz. Hammaddeler'den sayım birimi seçin.`);
    }
    const added = await db
      .insert(s.reorderItems)
      .values(list.map((id) => ({ ingredientId: id, updatedBy: me.name })))
      .onConflictDoNothing()
      .returning({ id: s.reorderItems.ingredientId });
    if (added.length) await logActivity(me, "Mal siparişi kalemleri", `${added.length} kalem eklendi`);
    refresh();
    return { added: added.length };
  });
}

/** Takipten çıkarır; geri almak için satırın kopyasını döner (restoreReorderItem) */
export async function untrackIngredient(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const iid = zId.parse(id);
    const db = getDb();
    const [row] = await db.delete(s.reorderItems).where(eq(s.reorderItems.ingredientId, iid)).returning();
    if (!row) throw new UserError("Kalem zaten takipte değil; sayfayı yenileyin.");
    const [ing] = await db.select({ name: s.ingredients.name }).from(s.ingredients).where(eq(s.ingredients.id, iid)).limit(1);
    await logActivity(me, "Mal siparişi kalemleri", `${ing?.name ?? iid} takipten çıktı`);
    refresh();
    return {
      ingredientId: row.ingredientId,
      parBase: row.parBase,
      leadDays: row.leadDays,
      supplier: row.supplier,
      orderName: row.orderName,
      orderUnit: row.orderUnit,
      orderUnitSize: row.orderUnitSize,
    };
  });
}

const snapshotSchema = z.object({
  ingredientId: zId,
  parBase: z.number().finite().min(0).nullable(),
  leadDays: z.number().int().min(0).max(60).nullable(),
  supplier: z.string().trim().max(200).nullable(),
  orderName: z.string().trim().max(200).nullable(),
  orderUnit: z.string().trim().max(40).nullable(),
  orderUnitSize: z.number().finite().positive().nullable(),
});

/** "Geri al": takipten çıkan kalemi kayıtlı alanlarıyla geri koyar */
export async function restoreReorderItem(snapshot: z.input<typeof snapshotSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = snapshotSchema.parse(snapshot);
    const db = getDb();
    const [ing] = await db.select({ name: s.ingredients.name }).from(s.ingredients).where(eq(s.ingredients.id, data.ingredientId)).limit(1);
    if (!ing) throw new UserError("Hammadde bulunamadı.");
    await db
      .insert(s.reorderItems)
      .values({ ...data, updatedBy: me.name })
      .onConflictDoNothing();
    await logActivity(me, "Mal siparişi kalemleri", `${ing.name} yeniden takipte`);
    refresh();
    return null;
  });
}

const itemSchema = z.object({
  ingredientId: zId,
  /** Tedarikçinin grubu (Tedarikçiler'deki anahtar); null: varsayılan (son alınan) */
  supplierKey: z.string().trim().max(200).nullable(),
  leadDays: z.number().int("Teslim süresi tam gün olmalı").min(0, "Teslim süresi eksi olamaz").max(60, "Teslim süresi en çok 60 gün").nullable(),
  /** Sayım biriminde (KG, LT, ADET, DİLİM) */
  parCount: z.number().finite().min(0, "Hedef eksi olamaz").max(1_000_000, "Hedef çok büyük").nullable(),
  orderName: zOptText(120),
  orderUnit: zOptText(30),
  /** 1 sipariş biriminin içeriği, sayım biriminde */
  orderUnitCount: z.number().finite().positive("Birimin içeriği 0'dan büyük olmalı").max(1_000_000, "Birimin içeriği çok büyük").nullable(),
});

/** Kalemin tedarikçisini, teslim süresini, hedefini, mesajdaki adını ve sipariş birimini kaydeder (boş = varsayılan) */
export async function saveReorderItem(input: z.input<typeof itemSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = itemSchema.parse(input);
    const db = getDb();
    const [ing] = await db.select({ name: s.ingredients.name, countUnit: s.ingredients.countUnit }).from(s.ingredients).where(eq(s.ingredients.id, data.ingredientId)).limit(1);
    if (!ing) throw new UserError("Hammadde bulunamadı; sayfayı yenileyin.");
    let supplier: string | null = null;
    if (data.supplierKey) {
      const g = (await loadSupplierIndex()).byKey.get(data.supplierKey);
      if (!g) throw new UserError("Tedarikçi bulunamadı; listeden seçin.");
      supplier = g.name;
    }
    const f = countFactor(ing.countUnit);
    const values = {
      supplier,
      leadDays: data.leadDays,
      parBase: data.parCount === null ? null : data.parCount * f,
      orderName: data.orderName,
      orderUnit: data.orderUnit,
      orderUnitSize: data.orderUnitCount === null ? null : data.orderUnitCount * f,
      updatedBy: me.name,
      updatedAt: new Date(),
    };
    const [row] = await db.update(s.reorderItems).set(values).where(eq(s.reorderItems.ingredientId, data.ingredientId)).returning({ id: s.reorderItems.ingredientId });
    if (!row) throw new UserError(`${ing.name} takipte değil; sayfayı yenileyin.`);
    const unit = ing.countUnit ?? "";
    await logActivity(
      me,
      "Mal siparişi kalemi",
      `${ing.name}: hedef ${data.parCount === null ? "öneri" : qtyLabel(data.parCount, unit)}, teslim ${data.leadDays === null ? "varsayılan" : `${data.leadDays} gün`}, ${supplier ?? "son alınan tedarikçi"}`,
    );
    refresh();
    return null;
  });
}

const leadSchema = z.object({ ingredientIds: z.array(zId).min(1).max(100), leadDays: z.number().int("Tam gün yazın").min(0, "Teslim süresi eksi olamaz").max(60, "Teslim süresi en çok 60 gün") });

/** Bir tedarikçinin takipteki kalemlerine aynı teslim süresini yazar */
export async function setLeadDays(input: z.input<typeof leadSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = leadSchema.parse(input);
    const rows = await getDb()
      .update(s.reorderItems)
      .set({ leadDays: data.leadDays, updatedBy: me.name, updatedAt: new Date() })
      .where(inArray(s.reorderItems.ingredientId, data.ingredientIds))
      .returning({ id: s.reorderItems.ingredientId });
    await logActivity(me, "Mal siparişi kalemleri", `${rows.length} kalemin teslim süresi ${data.leadDays} gün`);
    refresh();
    return { updated: rows.length };
  });
}

const settingsSchema = z.object({
  countWeekdays: z
    .array(z.number().int().min(1).max(7))
    .min(1, "En az bir sayım günü seçin")
    .max(7)
    .refine((d) => new Set(d).size === d.length, "Aynı gün iki kez seçilmiş"),
  marginPct: z.number().finite().min(0, "Emniyet payı eksi olamaz").max(1, "Emniyet payı en çok %100"),
  defaultLeadDays: z.number().int("Tam gün yazın").min(0, "Teslim süresi eksi olamaz").max(30, "Teslim süresi en çok 30 gün"),
  signature: z.string().trim().min(1, "Mesajdaki adı yazın").max(60, "Mesajdaki ad çok uzun"),
});

const WEEKDAY_SHORT = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

/** Sayım günleri, emniyet payı, varsayılan teslim süresi ve mesajdaki ad */
export async function saveReorderSettings(input: z.input<typeof settingsSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = settingsSchema.parse(input);
    const value = { ...data, countWeekdays: [...data.countWeekdays].sort((a, b) => a - b) };
    await getDb()
      .insert(s.integrationState)
      .values({ key: REORDER_SETTINGS_KEY, value })
      .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
    await logActivity(
      me,
      "Mal siparişi ayarları",
      `Sayım: ${value.countWeekdays.map((d) => WEEKDAY_SHORT[d - 1]).join(", ")} · pay %${num(value.marginPct * 100, 0)} · teslim ${value.defaultLeadDays} gün`,
    );
    refresh();
    return null;
  });
}
