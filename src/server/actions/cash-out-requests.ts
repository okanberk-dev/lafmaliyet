"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { BRANCH_ID_MAX } from "@/lib/branches";
import { CASH_OUT_REQUEST_TEXT, cashOutRequestLog, lineText } from "@/lib/cash-out-requests";
import { cashOutLabel } from "@/lib/cash-outs";
import { money } from "@/lib/format";
import { PHOTO_KIND_LABEL } from "@/lib/photo-rules";
import { genitive } from "@/lib/recipe-change";
import { longDateTR } from "@/lib/reminders";
import { requireAdmin, requireUser } from "@/server/auth/dal";
import { formTillBranch, withBranchScope } from "@/server/branch-scope";
import { attachCashOutReceiptCore, proposeCashOutChange, proposePhotoRemoval, reviewCashOutRequestCore, reviewPhotoRemovalCore } from "@/server/cash-outs/requests";
import { getDb } from "@/server/db";

import { logActivity } from "./log";
import { attempt, UserError, zAmount, zDate, zOptText } from "./util";

// Kasadan çıkan istekleri, fiş ekleme ve fotoğraf kaldırma (docs/KASA-RAPORU.md › Kasadan çıkan: kapanmış gün,
// yöneticinin satırı; docs/ONAYLAR.md). Kuralların çekirdeği src/server/cash-outs/requests.ts; bu dosyada yalnız uçlar.
// "use server" dosyasındaki her dışa açık işlev bir uçtur: her biri kendi oturum ve rol denetimini yapar, yardımcı dışa
// verilmez. Geri çekme genel eylemle (src/server/actions/staff-requests.ts withdrawStaffRequest).

const clientKey = z
  .string()
  .min(8)
  .max(80)
  .nullish()
  .transform((v) => v ?? null);

const lineSchema = z.object({
  kind: z.enum(["harcama", "teslim"]),
  amount: zAmount.refine((v) => v > 0, "Tutar girin"),
  store: zOptText(60),
  description: zOptText(200),
  receiptDate: zDate.nullable(),
  receiptNo: zOptText(40),
  vat: zAmount.nullable(),
  docType: z.enum(["fis", "e_arsiv", "fatura", "yok"]),
  categoryId: z.number().int().positive().nullable(),
  photoId: z.number().int().positive().nullable(),
});

const changeSchema = z.object({
  op: z.enum(["ekle", "duzelt", "sil"]),
  date: zDate.nullable(),
  cashOutId: z.number().int().positive().nullable(),
  line: lineSchema.nullable(),
  message: zOptText(200),
  /** Formun gösterdiği kasa (docs/SUBE.md › Yazarken hangi şube); göndermeyen eski sekmede seçili kasa */
  branchId: z.string().max(BRANCH_ID_MAX).nullish(),
  clientKey,
});

/**
 * Personel: kasadan çıkan isteği (kapanmış ya da eski güne ekleme; kilitli dünün ya da yöneticinin kategorisindeki
 * satırın düzeltilmesi ve silinmesi). Hiçbir şey yazılmaz; yönetici onaylayınca kasaya işlenir. Dönüşte yalnız isteğin
 * kimliği ve sürümü. Ekleme isteği formun gösterdiği kasanındır (formTillBranch), gönderim anındaki seçimin değil.
 */
export async function requestCashOutChange(input: z.input<typeof changeSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    if (me.role === "admin") throw new UserError(CASH_OUT_REQUEST_TEXT.adminDirect);
    const data = changeSchema.parse(input);
    const out = await withBranchScope(await formTillBranch(data.branchId), () => proposeCashOutChange(getDb(), me, data));
    if (out.created || out.row.version > 1) {
      await logActivity(me, "Kasadan çıkan isteği", cashOutRequestLog({ op: out.payload.op, day: out.payload.day, line: out.payload.line, before: out.payload.before, note: data.message }));
    }
    refresh();
    return { id: out.row.id, version: out.row.version };
  });
}

const receiptSchema = z.object({ cashOutId: z.number().int().positive(), photoId: z.number().int().positive() });

/** Fotoğrafsız alışveriş satırına fiş fotoğrafı (onaysız; yalnız kanıt, tutar ve kategori değişmez) */
export async function attachCashOutReceipt(input: z.input<typeof receiptSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    const data = receiptSchema.parse(input);
    const row = await attachCashOutReceiptCore(getDb(), me, data);
    await logActivity(me, "Kasadan çıkan: fiş eklendi", [longDateTR(row.date), cashOutLabel(row), money(row.amount)].join(" · "));
    refresh();
    return null;
  });
}

const removalSchema = z.object({ photoId: z.number().int().positive(), message: zOptText(200), clientKey });

/** Personel: rapora bağlı yanlış Z / POS fotoğrafının kaldırılmasını ister (yönetici onaylarsa rapordan çıkar) */
export async function requestPhotoRemoval(input: z.input<typeof removalSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    if (me.role === "admin") throw new UserError(CASH_OUT_REQUEST_TEXT.adminDirect);
    const data = removalSchema.parse(input);
    const out = await proposePhotoRemoval(getDb(), me, data);
    if (out.created) {
      await logActivity(me, "Fotoğraf kaldırma istendi", [PHOTO_KIND_LABEL[out.payload.photoKind], longDateTR(out.payload.day), data.message].filter(Boolean).join(" · "));
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
  toExpenses: z.boolean().nullish(),
  categoryId: z.number().int().positive().nullish(),
  force: z.boolean().optional(),
});

/**
 * Yönetici: kasadan çıkan isteğini karara bağlar (Onaylar › Kasa). Onay yöneticinin yazım yolundan geçer (satırı açan
 * isteyen); kasa raporu değişmez. Not personele görünür (tutar yazılmaz).
 */
export async function reviewCashOutRequest(input: z.input<typeof reviewSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = reviewSchema.parse(input);
    const out = await reviewCashOutRequestCore(getDb(), me, { ...data, note: data.note });
    const who = `${genitive(out.request.requestedByName)} isteği`;
    const note = out.request.reviewNote ? ` · not: ${out.request.reviewNote}` : "";
    if (out.status === "rejected") {
      await logActivity(me, "Kasa isteği reddedildi", `${out.request.title} (${out.request.requestedByName} istedi)${note}`);
    } else if (out.op === "sil") {
      await logActivity(me, "Kasadan çıkan silindi", [longDateTR(out.snapshot.date), cashOutLabel(out.snapshot), money(out.snapshot.amount), who].join(" · ") + note);
    } else {
      await logActivity(
        me,
        out.op === "ekle" ? "Kasadan çıkan" : "Kasadan çıkan düzeltildi",
        [longDateTR(out.date), lineText(out.line), out.line.photoId ? "fişli" : null, out.expenseId !== null ? "harcamalara yazıldı" : null, who].filter(Boolean).join(" · ") + note,
      );
    }
    refresh();
    return { status: out.status };
  });
}

const photoReviewSchema = z.object({
  id: z.number().int().positive(),
  seenVersion: z.number().int().min(1),
  decision: z.enum(["approve", "reject"]),
  note: zOptText(300),
});

/** Yönetici: fotoğraf kaldırma isteğini karara bağlar; onayda okuma farkı işlem geçmişine yazılır, fotoğraf 30 gün kalır */
export async function reviewPhotoRemoval(input: z.input<typeof photoReviewSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = photoReviewSchema.parse(input);
    const out = await reviewPhotoRemovalCore(getDb(), me, data);
    const note = out.request.reviewNote ? ` · not: ${out.request.reviewNote}` : "";
    const head = `${PHOTO_KIND_LABEL[out.payload.photoKind]} · ${longDateTR(out.payload.day)} · ${out.request.requestedByName} istedi`;
    if (out.status === "approved") {
      await logActivity(me, "Fotoğraf rapordan çıkarıldı", `${head}${out.diffs.length ? ` · okuma: ${out.diffs.join("; ")}` : " · okuma farkı yok"}${note}`);
    } else {
      await logActivity(me, "Fotoğraf kaldırma reddedildi", `${head}${note}`);
    }
    refresh();
    return { status: out.status };
  });
}
