"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { DRAFT_MAX_LINES, DRAFT_MAX_QTY, DRAFT_NOTE_MAX } from "@/lib/reorder/draft";
import { num } from "@/lib/format";
import { requireAdmin, requireUser } from "@/server/auth/dal";
import { draftDeps } from "@/server/data/order-drafts";
import { getDb } from "@/server/db";
import { approveCleanCore, reviewDraftCore, sendDraftCore, submitDraftCore, undoDraftSendCore } from "@/server/order-drafts/core";
import { pushDraftToAdmins, pushDraftToRequester } from "@/server/order-drafts/notify";

import { logActivity } from "./log";
import { attempt, zOptText } from "./util";

/*
 * Personelin mal siparişi taslağı (docs/MAL-SIPARISI.md › Personelin sipariş taslağı; plan
 * docs/planlar/personel-yetki.md §2.4). Kurallar çekirdekte (src/server/order-drafts/core.ts); bu dosyada yalnız uçlar.
 * "use server" dosyasındaki her dışa açık işlev bir uçtur: her biri kendi oturum ve rol denetimini yapar, yardımcı dışa
 * verilmez. Geri çekme genel eylemle (withdrawStaffRequest). Personelin yanıtlarında tutar, fiyat ve mesaj yok;
 * gönderimde yalnız siparişin kimliği ve WhatsApp bağlantısı.
 */

const zId = z.number().int().positive();
const zLines = z
  .array(z.object({ ingredientId: zId, qty: z.number().finite().min(0, "Miktar eksi olamaz").max(DRAFT_MAX_QTY, "Miktar çok büyük") }))
  .min(1, "Kalem yok")
  .max(DRAFT_MAX_LINES, `Bir taslakta en çok ${DRAFT_MAX_LINES} kalem`)
  .refine((l) => l.some((x) => x.qty > 0), "En az bir kalemin miktarı 0'dan büyük olmalı");

const submitSchema = z.object({
  clientKey: z.string().min(8).max(80).nullish().transform((v) => v ?? null),
  supplierKey: z.string().trim().min(1).max(200),
  lines: zLines,
  supplierNote: zOptText(DRAFT_NOTE_MAX),
});

/** Personel: taslağı onaya gönderir (yönetici reddedilir). Dönüş: isteğin kimliği ve bir yönetici cihazına ulaşıldı mı */
export async function submitOrderDraft(input: z.input<typeof submitSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    const data = submitSchema.parse(input);
    const out = await submitDraftCore(getDb(), me, data, draftDeps());
    const p = out.payload;
    const n = p.lines.filter((l) => l.qty > 0).length;
    if (out.created || out.pushDue) await logActivity(me, "Mal siparişi taslağı", `${p.supplier}: ${num(n)} kalem · onaya gönderildi${out.created ? "" : " (güncellendi)"}`);
    if (out.pushDue) after(() => pushDraftToAdmins(out.row.id, `Mal siparişi onay bekliyor: ${p.supplier}`, `${num(n)} kalem · ${me.name} hazırladı`));
    refresh();
    return { id: out.row.id, notified: out.notified };
  });
}

const reviewSchema = z.object({
  id: zId,
  seenVersion: z.number().int().min(1),
  decision: z.enum(["approve", "reject"]),
  lines: z
    .array(z.object({ ingredientId: zId, qty: z.number().finite().min(0).max(DRAFT_MAX_QTY, "Miktar çok büyük") }))
    .max(DRAFT_MAX_LINES)
    .nullish()
    .transform((v) => v ?? null),
  supplierNote: zOptText(DRAFT_NOTE_MAX),
  note: zOptText(300),
});

/**
 * Yönetici: taslağı onaylar (miktarları değiştirebilir, tedarikçiye notu düzenler) ya da reddeder (not zorunlu). Not
 * personele görünür; mesaja girmez.
 */
export async function reviewOrderDraft(input: z.input<typeof reviewSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = reviewSchema.parse(input);
    const out = await reviewDraftCore(getDb(), me, data, draftDeps());
    const r = out.row;
    const tail = [out.result?.edited ? "miktar değişti" : "", r.reviewNote ? `not: ${r.reviewNote}` : ""].filter(Boolean).join(" · ");
    const supplier = out.payload.supplier;
    if (out.status === "approved") {
      await logActivity(me, "Mal siparişi taslağı onaylandı", `${r.title} (${r.requestedByName} hazırladı${tail ? ` · ${tail}` : ""})`);
      after(() => pushDraftToRequester(r.requestedBy, r.id, `${supplier} siparişi onaylandı`, "WhatsApp'tan gönderin"));
    } else {
      await logActivity(me, "Mal siparişi taslağı reddedildi", `${r.title} (${r.requestedByName} hazırladı${tail ? ` · ${tail}` : ""})`);
      after(() => pushDraftToRequester(r.requestedBy, r.id, `${supplier} siparişi reddedildi`, r.reviewNote ? `Yönetici: ${r.reviewNote}` : "Yeniden hazırlayın"));
    }
    refresh();
    return { status: out.status };
  });
}

const cleanSchema = z.object({ items: z.array(z.object({ id: zId, seenVersion: z.number().int().min(1) })).min(1).max(30) });

/** Yönetici: işaretsiz ve önerinin aynısı olan taslakları onaylar (her biri ayrı; düşenler nedeniyle döner) */
export async function approveCleanDrafts(input: z.input<typeof cleanSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = cleanSchema.parse(input);
    const out = await approveCleanCore(getDb(), me, data.items, draftDeps());
    for (const a of out.approved) await logActivity(me, "Mal siparişi taslağı onaylandı", `${a.title} (${a.requestedByName} hazırladı · işaretsiz)`);
    after(async () => {
      for (const a of out.approved) await pushDraftToRequester(a.requestedBy, a.id, `${a.supplier} siparişi onaylandı`, "WhatsApp'tan gönderin");
    });
    refresh();
    return { approved: out.approved.length, skipped: out.skipped };
  });
}

/**
 * Personel (yönetici de): onaylı taslağı gönderir. Önce kayıt, sonra bağlantı: istemci dönen bağlantıyı açar. Aynı
 * kişi 10 dakika içinde aynı siparişi yeniden açabilir (yeni kayıt açılmaz). Dönüş yalnız siparişin kimliği ve bağlantı.
 */
export async function sendApprovedDraft(input: { id: number }) {
  return attempt(async () => {
    const me = await requireUser();
    const { id } = z.object({ id: zId }).parse(input);
    const out = await sendDraftCore(getDb(), me, { id }, draftDeps());
    if (!out.again) await logActivity(me, "Mal siparişi gönderildi", `${out.supplier}: ${num(out.lineCount)} kalem · WhatsApp${out.approvedByName ? ` · ${out.approvedByName} onayladı` : ""}`);
    refresh();
    return { orderId: out.orderId, href: out.href };
  });
}

/** Personel: gönderimi geri alır (yalnız gönderen, 10 dakika içinde, mal gelmeden ve faturası bağlanmadan) */
export async function undoDraftSend(input: { id: number }) {
  return attempt(async () => {
    const me = await requireUser();
    const { id } = z.object({ id: zId }).parse(input);
    const out = await undoDraftSendCore(getDb(), me, { id });
    await logActivity(me, "Mal siparişi geri alındı", `${out.title} · tedarikçiye iptal yazılmalı`);
    after(() => pushDraftToAdmins(id, `${me.name} ${out.supplier} siparişini geri aldı`, "Tedarikçiye iptal yazılmalı"));
    refresh();
    return null;
  });
}
