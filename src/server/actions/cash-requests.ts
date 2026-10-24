"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { carryCheck, changesText, diffText } from "@/lib/cash-report";
import { approvalLine, CASH_REQUEST_TEXT, correctionLog, lateApprovalLine, lateLog, reasonLog } from "@/lib/cash-requests";
import { MAX_REPORT_PHOTOS } from "@/lib/photo-rules";
import { money } from "@/lib/format";
import { longDateTR } from "@/lib/reminders";
import { requireAdmin, requireUser } from "@/server/auth/dal";
import { proposeLateReport } from "@/server/cash/late";
import { emailReport, type CashEmailOutcome } from "@/server/cash/report-email";
import { reportSchema } from "@/server/cash/report-store";
import { proposeCashCorrection, proposeCashDelete, reviewCashRequestCore } from "@/server/cash/requests";
import { cashReportIntegrity, nextReportAfter, toCashDTO } from "@/server/data/cash-reports";
import { getDb } from "@/server/db";

import { logActivity } from "./log";
import { attempt, UserError, zDate, zOptText } from "./util";

// Personelin kasa raporu istekleri ve yöneticinin kararı (docs/KASA-RAPORU.md › Sonradan düzeltme ve silme isteği, Geç
// rapor; docs/ONAYLAR.md). Kuralların çekirdeği src/server/cash/requests.ts ve late.ts; bu dosyada yalnız uçlar. "use server" dosyasındaki
// her dışa açık işlev bir uçtur: her biri kendi oturum ve rol denetimini yapar, yardımcı dışa verilmez. Geri çekme genel
// eylemle (src/server/actions/staff-requests.ts withdrawStaffRequest).

const clientKey = z
  .string()
  .min(8)
  .max(80)
  .nullish()
  .transform((v) => v ?? null);

const correctionSchema = z.object({
  date: zDate,
  baseRevision: z.number().int().min(1),
  fields: reportSchema.omit({ date: true, countedBy: true, revision: true, photos: true }),
  countedBy: z
    .number()
    .int()
    .positive()
    .nullish()
    .transform((v) => v ?? null),
  message: z.string().trim().min(5, "Nedeni en az 5 karakterle yazın").max(500, "Neden en çok 500 karakter"),
  clientKey,
});

/**
 * Personel: kayıtlı raporun düzeltme önerisi (kilitli gün ya da ertesi gün kasa alanı / sayan). Rapor onaya kadar
 * değişmez; aynı gün için bekleyen öneri varsa güncellenir. Dönüşte yalnız isteğin kimliği ve sürümü.
 */
export async function requestCashCorrection(input: z.input<typeof correctionSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    if (me.role === "admin") throw new UserError(CASH_REQUEST_TEXT.adminDirect);
    const data = correctionSchema.parse(input);
    const { row, changes } = await proposeCashCorrection(getDb(), me, data);
    await logActivity(me, "Kasa düzeltmesi önerildi", correctionLog({ date: data.date, changes, reason: data.message }));
    refresh();
    return { id: row.id, version: row.version };
  });
}

const deleteSchema = z.object({
  date: zDate,
  baseRevision: z.number().int().min(1),
  message: z.string().trim().min(3, "Nedenini yazın").max(500, "Neden en çok 500 karakter"),
  clientKey,
});

/** Personel: raporun silinmesini ister (bugün ya da dün); rapor silinene kadar yerinde kalır */
export async function requestCashDelete(input: z.input<typeof deleteSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    if (me.role === "admin") throw new UserError(CASH_REQUEST_TEXT.adminDirect);
    const data = deleteSchema.parse(input);
    const { row } = await proposeCashDelete(getDb(), me, data);
    await logActivity(me, "Kasa raporunun silinmesi istendi", [longDateTR(data.date), reasonLog(data.message)].filter(Boolean).join(" · "));
    refresh();
    return { id: row.id, version: row.version };
  });
}

const lateSchema = reportSchema.omit({ countedBy: true, revision: true, photos: true }).extend({
  zNo: z.string().trim().min(1, "Z no gerekli").max(30),
  reason: z.string().trim().min(3, "Geç girme nedenini yazın").max(300, "Neden en çok 300 karakter"),
  requestVersion: z.number().int().min(0),
  photoIds: z.array(z.number().int().positive()).min(1, CASH_REQUEST_TEXT.lateZPhoto).max(MAX_REPORT_PHOTOS),
  handedTo: z.discriminatedUnion("kind", [z.object({ kind: z.literal("user"), id: z.number().int().positive() }), z.object({ kind: z.literal("banka") })]).nullable(),
  clientKey,
});

/**
 * Personel: dünden eski, son 14 günün raporu girilmemiş bir gününü Z fotoğrafı ve Z no ile onaya gönderir (geç rapor).
 * Rapor onaya kadar hiçbir hesaba girmez; aynı gün için bekleyen isteği varsa güncellenir. Dönüşte isteğin kimliği,
 * sürümü ve kişinin kendi yazdığı sayılardan kasa farkı.
 */
export async function requestLateCashReport(input: z.input<typeof lateSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    if (me.role === "admin") throw new UserError(CASH_REQUEST_TEXT.adminDirect);
    const { reason, requestVersion, photoIds, handedTo, clientKey: key, ...fields } = lateSchema.parse(input);
    const out = await proposeLateReport(getDb(), me, { fields, reason, requestVersion, photoIds, handedTo, clientKey: key });
    if (out.created || out.row.version > 1) {
      await logActivity(me, "Geç kasa raporu onaya gönderildi", lateLog({ date: fields.date, zTotal: fields.zTotal, cashDiff: out.cashDiff, reason }));
    }
    refresh();
    return { id: out.row.id, version: out.row.version, cashDiff: out.cashDiff };
  });
}

const reviewSchema = z.object({
  id: z.number().int().positive(),
  seenVersion: z.number().int().min(1),
  seenRevision: z.number().int().min(0).nullable(),
  decision: z.enum(["approve", "reject", "close"]),
  note: zOptText(300),
  /** Geç rapor, "Düzeltip onayla": yöneticinin değerleri */
  fields: reportSchema.omit({ date: true, countedBy: true, revision: true, photos: true }).nullish(),
  /** Geç rapor: teslimi aldım / bankada gördüm */
  handoverSeen: z.boolean().optional(),
});

/**
 * Yönetici: kasa isteğini karara bağlar (Onaylar › Kasa). Düzeltme onayında rapor yeni sürümle kaydedilir ve alıcılara
 * onay satırıyla e-postalanır; silme onayında rapor silinir; geç rapor onayında rapor isteyenin adıyla girilir ("Düzeltip
 * onayla": yöneticinin değerleri 2. sürüm) ve yalnız onayda e-postalanır. Not personele görünür (tutar yazılmaz).
 */
export async function reviewCashRequest(input: z.input<typeof reviewSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = reviewSchema.parse(input);
    const out = await reviewCashRequestCore(getDb(), me, data);
    const who = out.request.requestedByName;
    const note = out.request.reviewNote ? ` · not: ${out.request.reviewNote}` : "";
    let email: CashEmailOutcome | null = null;
    let revision: number | null = null;
    let next: { date: string; opening: number } | null = null;
    let nextBroken = false;
    if (out.status === "approved" && out.kind === "kasa-duzeltme") {
      const date = out.report.date;
      revision = out.report.revision;
      email = await emailReport(out.report.id, { approval: approvalLine(who, me.name) });
      await logActivity(me, "Kasa düzeltmesi onaylandı", `${longDateTR(date)} (${who} önerdi): ${changesText(out.changes)}${note}`);
      const [integrity, nextReport] = await Promise.all([cashReportIntegrity(toCashDTO(out.report)), nextReportAfter(date)]);
      next = integrity.next ? { date: integrity.next.date, opening: integrity.next.opening } : null;
      nextBroken = Boolean(
        integrity.next && nextReport && out.prevCarry !== null && !carryCheck(nextReport.date, nextReport.openingCash, { date, amount: out.prevCarry }),
      );
    } else if (out.status === "approved" && out.kind === "kasa-silme") {
      const r = out.removed.row;
      await logActivity(
        me,
        "Kasa raporu silindi",
        [longDateTR(r.date), `Z ${money(r.zTotal)}`, `sayılan ${money(r.countedCash)}`, diffText(r.cashDiff), r.countedByName ?? r.by, out.removed.photos ? `${out.removed.photos} fotoğraf` : null, `${who} istedi`]
          .filter(Boolean)
          .join(" · "),
      );
    } else if (out.status === "approved" && out.kind === "kasa-gec") {
      const date = out.report.date;
      revision = out.report.revision;
      // Yalnız onayda e-posta: anahtar isteğe bağlı (aynı günün başka bir sürümüyle çakışmaz)
      email = await emailReport(out.report.id, {
        approval: lateApprovalLine({ requester: who, requestedAt: out.request.createdAt, approver: me.name, corrected: out.corrected }),
        idempotencyKey: `cash-${date}-r${out.report.revision}-gec${out.request.id}`,
      });
      await logActivity(
        me,
        out.corrected ? "Geç kasa raporu düzeltilip onaylandı" : "Geç kasa raporu onaylandı",
        `${lateLog({ date, zTotal: out.report.zTotal, cashDiff: out.report.cashDiff, reason: null })} (${who} girdi)${out.skippedPhotos ? ` · ${out.skippedPhotos} fotoğraf bağlanamadı` : ""}${note}`,
      );
      const integrity = await cashReportIntegrity(toCashDTO(out.report));
      next = integrity.next ? { date: integrity.next.date, opening: integrity.next.opening } : null;
    } else if (out.status === "rejected") {
      const action = out.kind === "kasa-duzeltme" ? "Kasa düzeltmesi reddedildi" : out.kind === "kasa-gec" ? "Geç kasa raporu reddedildi" : "Kasa raporunun silinmesi reddedildi";
      await logActivity(me, action, `${out.request.title} (${who} istedi)${note}`);
    } else {
      await logActivity(me, "Kasa düzeltmesi kapatıldı", `${out.request.title} (${who} önerdi) · rapor zaten bu hâlde`);
    }
    refresh();
    return { status: out.status, revision, next, nextBroken, email, skippedPhotos: out.status === "approved" && out.kind === "kasa-gec" ? out.skippedPhotos : 0 };
  });
}
