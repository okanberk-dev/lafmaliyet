"use server";

import { count, desc, eq, gt, lt } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import {
  businessDate,
  carryCheck,
  carryDiffText,
  changesText,
  computeCash,
  diffText,
  openingNeedsNote,
  parseEmails,
  revisionChanges,
  revisionDataOf,
  staffCanReport,
  waPhone,
  whatsappLink,
  whatsappText,
  type CashReportFields,
} from "@/lib/cash-report";
import { money } from "@/lib/format";
import { DELETED_REPORT_DAYS, linkedUntil, MAX_REPORT_PHOTOS } from "@/lib/photo-rules";
import { longDateTR, todayTR } from "@/lib/reminders";
import type { TillOnlineRow } from "@/lib/site-sales/calc";
import { requireAdmin, requireUser } from "@/server/auth/dal";
import { cashReportExtras } from "@/server/data/cash-photos";
import { cashReportIntegrity, cashReportsBetween, getCashReport, loadCashSettings, nextReportAfter, saveCashSettings, toCashDTO } from "@/server/data/cash-reports";
import { dayWaste } from "@/server/data/waste";
import { getDb, schema as s } from "@/server/db";
import { renderCashReport } from "@/server/notify/cash-report-template";
import { fetchTillOnlineRow } from "@/server/site-sales/sync";
import { isEmailConfigured, resolveFrom, sendEmail } from "@/server/notify/resend";
import { loadNotifySettings } from "@/server/notify/settings";
import { getPhoto, keepPhoto, linkable, releasePhoto } from "@/server/storage/photos";

import { logActivity } from "./log";
import { attempt, UserError, zAmount, zDate, zOptText } from "./util";

// Gün sonu kasa raporu: personel (ve yönetici) her akşam girer; kayıt iş günü başına bir tane, yeniden gönderilince
// güncellenir. Gönderilince kasa raporu alıcılarına e-posta gider; WhatsApp metni ekranda hazırlanır (docs/KASA-RAPORU.md).

const reportSchema = z.object({
  date: zDate,
  zNo: zOptText(30),
  receipts: z.number().int().min(0).max(100_000).nullable(),
  zTotal: zAmount,
  cash: zAmount,
  card: zAmount,
  mealCard: zAmount,
  online: zAmount,
  other: zAmount,
  openingCash: zAmount,
  cashOut: zAmount,
  cashOutNote: zOptText(200),
  countedCash: zAmount,
  handedOver: zAmount,
  bankPos: zAmount.nullable(),
  offRevenue: zAmount.nullable(),
  /** Z raporundaki indirim (isteğe bağlı; eski bir sekme göndermezse boş) */
  discounts: zAmount.nullish().transform((v) => v ?? null),
  note: zOptText(1000),
  /** Kasayı sayan (etkin bir kullanıcı); gönderilmezse gönderen */
  countedBy: z.number().int().positive().nullish(),
  /** Formun açıldığı andaki sürüm (0: yeni): arada başkası gönderdiyse üzerine yazılmaz */
  revision: z.number().int().min(0),
  /** Bu gönderimle eklenen Z ve banka POS fotoğrafları (henüz bağlanmamış; eskileri bağlı kalır) */
  photos: z.array(z.number().int().positive()).max(MAX_REPORT_PHOTOS).default([]),
});

export type CashEmailOutcome = { status: "sent" | "failed" | "off"; error: string | null; to: number };

/**
 * Raporu alıcılara e-postalar. `site`: laffogato.net'in o günkü online satış satırı (önceden başlatılmış istek; yoksa
 * burada sorulur). Site ulaşılamazsa ya da 8 saniyede yanıt vermezse satır yazılmaz; e-posta yine gider.
 */
async function emailReport(reportId: number, site?: Promise<TillOnlineRow | null>): Promise<CashEmailOutcome> {
  const [row] = await getDb().select().from(s.cashReports).where(eq(s.cashReports.id, reportId)).limit(1);
  if (!row) throw new UserError("Rapor bulunamadı");
  const settings = await loadCashSettings();
  let outcome: CashEmailOutcome;
  if (!settings.emailEnabled || !settings.recipients.length) {
    outcome = { status: "off", error: null, to: 0 };
  } else if (!isEmailConfigured()) {
    outcome = { status: "failed", error: "E-posta kurulmamış (RESEND_API_KEY); rapor kaydedildi, WhatsApp ile gönderebilirsiniz.", to: 0 };
  } else {
    const dto = toCashDTO(row);
    const waste = await dayWaste(row.date);
    const online = await (site ?? fetchTillOnlineRow(row.date));
    // Yeniden gönderimde de değişenler aynı: son kopya yeniden okunur (anahtar cash-{gün}-r{sürüm} değişmez)
    const [extras, integrity] = await Promise.all([cashReportExtras(dto), cashReportIntegrity(dto)]);
    const msg = renderCashReport(dto, { by: dto.submittedByName, revision: dto.revision, submittedAt: row.updatedAt, waste, ikramValue: waste.ikramValue || null, online, ...extras, ...integrity });
    const notify = await loadNotifySettings();
    const res = await sendEmail({ from: resolveFrom(notify.from), to: settings.recipients, ...msg, idempotencyKey: `cash-${row.date}-r${row.revision}` });
    outcome = res.ok ? { status: "sent", error: null, to: settings.recipients.length } : { status: "failed", error: res.error, to: 0 };
    await getDb()
      .insert(s.notificationLog)
      .values({ key: `cash:${row.date}:r${row.revision}`, channel: "email", subject: msg.subject, recipients: settings.recipients.join(", "), ok: res.ok, error: res.ok ? null : res.error })
      .onConflictDoUpdate({ target: s.notificationLog.key, set: { ok: res.ok, error: res.ok ? null : res.error, sentAt: new Date() } });
  }
  await getDb()
    .update(s.cashReports)
    .set({ emailStatus: outcome.status, emailError: outcome.error, emailedAt: outcome.status === "sent" ? new Date() : row.emailedAt })
    .where(eq(s.cashReports.id, row.id));
  return outcome;
}

/** Raporu kaydeder (yoksa ekler, varsa günceller), alıcılara e-postalar; WhatsApp metnini ve bağlantısını döner */
export async function submitCashReport(input: z.input<typeof reportSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    const { revision, photos, countedBy, ...data } = reportSchema.parse(input);
    const today = businessDate();
    if (data.date > today) throw new UserError("İleri bir günün raporu girilemez");
    if (me.role !== "admin" && !staffCanReport(data.date)) throw new UserError("Personel yalnız bugünün ve dünün raporunu girebilir; daha eskisi için yöneticiye yazın");
    if (data.handedOver > data.countedCash) throw new UserError("Teslim edilen, sayılan nakitten fazla olamaz");
    const fields: CashReportFields = data;
    const c = computeCash(fields);
    // laffogato.net'in o günkü online satışı e-postaya bilgi satırı olarak girer: istek kayıtla aynı anda başlar, site
    // yavaşsa e-posta en çok 8 saniye bekler, ulaşılamazsa satırsız gider (kasa rakamlarına hiç girmez)
    const site = fetchTillOnlineRow(data.date);
    const db = getDb();
    const { row: saved, changes, prevCarry } = await db.transaction(async (tx) => {
      const [prev] = await tx.select().from(s.cashReports).where(eq(s.cashReports.date, data.date)).for("update").limit(1);
      if (prev && prev.revision !== revision) {
        throw new UserError(`Bu günün raporunu az önce ${prev.submittedByName} gönderdi; sayfayı yenileyip onun girdiklerini kontrol edin`);
      }
      if (!prev && revision !== 0) throw new UserError("Rapor bu arada silinmiş; sayfayı yenileyin");
      // Ertesi günün raporu girildiyse personel bu raporu düzeltemez: ertesi günün açılışı bu raporun devrine dayanır
      // (staffDayEditable). Eksik bir günü sonradan girmek serbest (rapor yok)
      if (prev && me.role !== "admin") {
        const [later] = await tx.select({ id: s.cashReports.id }).from(s.cashReports).where(gt(s.cashReports.date, data.date)).limit(1);
        if (later) throw new UserError("Ertesi günün raporu girildi; bu raporu artık yalnız yönetici düzeltebilir");
      }
      // Kasayı sayan: etkin bir kullanıcı ya da raporda zaten kayıtlı olan (sonradan pasif olsa da)
      const counterId = countedBy ?? me.id;
      const [counter] = await tx.select({ id: s.users.id, name: s.users.name, active: s.users.active }).from(s.users).where(eq(s.users.id, counterId)).limit(1);
      const kept = prev ? (prev.countedBy ?? prev.submittedBy) : null;
      if (!counter || (!counter.active && counter.id !== kept)) throw new UserError("Sayan kişi bulunamadı; listeden seçin");
      // Açılış önceki raporun devriyle tutmuyorsa nedeni nota yazılır (yeni raporda ya da açılış değiştiyse)
      const [before] = await tx
        .select({ date: s.cashReports.date, counted: s.cashReports.countedCash, handed: s.cashReports.handedOver })
        .from(s.cashReports)
        .where(lt(s.cashReports.date, data.date))
        .orderBy(desc(s.cashReports.date))
        .limit(1);
      const check = carryCheck(data.date, data.openingCash, before ? { date: before.date, amount: Math.round((before.counted - before.handed) * 100) / 100 } : null);
      if (check && openingNeedsNote({ check, openingCash: data.openingCash, prevOpening: prev?.openingCash ?? null, note: data.note })) {
        throw new UserError(`Açılış önceki günün devrinden farklı (${carryDiffText(check)}): nedenini nota yazın`);
      }
      // Yerine yenisi gelen sürüm geçmişe: satır kilitliyken aynı işlemde (iki gönderim bir sürümü kaybetmez)
      if (prev) {
        await tx.insert(s.cashReportRevisions).values({
          reportId: prev.id,
          date: prev.date,
          revision: prev.revision,
          data: revisionDataOf(prev),
          submittedBy: prev.submittedBy,
          submittedByName: prev.submittedByName,
          submittedAt: prev.updatedAt,
        });
      }
      const values = {
        ...data,
        cashDiff: c.cashDiff,
        submittedBy: me.id,
        submittedByName: me.name,
        countedBy: counter.id,
        countedByName: counter.name,
        emailStatus: null,
        emailError: null,
        updatedAt: new Date(),
      };
      const [row] = prev
        ? await tx
            .update(s.cashReports)
            .set({ ...values, revision: prev.revision + 1 })
            .where(eq(s.cashReports.id, prev.id))
            .returning()
        : await tx.insert(s.cashReports).values(values).returning();
      // Fotoğraflar kanıttır: yalnız eklenir (yeniden gönderimde eskileri bağlı kalır), rapor gününden 180 gün saklanır
      // (geçmiş bir güne sonradan eklenen bugünden)
      const ids = [...new Set(photos)];
      if (ids.length) {
        const [{ n }] = await tx.select({ n: count() }).from(s.cashReportPhotos).where(eq(s.cashReportPhotos.reportId, row.id));
        if (n + ids.length > MAX_REPORT_PHOTOS) throw new UserError(`Bir rapora en çok ${MAX_REPORT_PHOTOS} fotoğraf eklenir`);
        for (const id of ids) {
          const p = await getPhoto(id, tx);
          if (!p || (p.kind !== "kasa-z" && p.kind !== "kasa-pos") || !linkable(p) || (me.role !== "admin" && p.createdBy !== me.id)) {
            throw new UserError("Fotoğraf bulunamadı ya da süresi doldu; yeniden çekin");
          }
          await tx.insert(s.cashReportPhotos).values({ reportId: row.id, photoId: id, kind: p.kind });
          await keepPhoto(id, linkedUntil(p.kind, data.date, todayTR()), tx);
        }
      }
      return {
        row,
        changes: prev ? revisionChanges(revisionDataOf(prev), revisionDataOf(row)) : [],
        prevCarry: prev ? Math.round((prev.countedCash - prev.handedOver) * 100) / 100 : null,
      };
    });
    const email = await emailReport(saved.id, site);
    await logActivity(
      me,
      saved.revision > 1 ? "Kasa raporu güncellendi" : "Kasa raporu",
      `${longDateTR(data.date)}: ${diffText(c.cashDiff)}${changes.length ? ` · ${changesText(changes)}` : ""}`,
    );
    refresh();
    const dto = toCashDTO(saved);
    const [settings, waste, extras, integrity, nextReport] = await Promise.all([
      loadCashSettings(),
      dayWaste(data.date),
      cashReportExtras(dto),
      cashReportIntegrity(dto),
      nextReportAfter(data.date),
    ]);
    const text = whatsappText(dto, { by: me.name, revision: saved.revision, waste, ...extras, ...integrity });
    return {
      id: saved.id,
      revision: saved.revision,
      cashDiff: c.cashDiff,
      email,
      whatsapp: { text, link: whatsappLink(text, settings.whatsapp) },
      next: integrity.next ?? null,
      // Bu düzeltmeyle mi bozuldu: sonraki raporun açılışı önceki sürümün devriyle tutuyordu
      nextBroken: Boolean(
        integrity.next && nextReport && prevCarry !== null && !carryCheck(nextReport.date, nextReport.openingCash, { date: data.date, amount: prevCarry }),
      ),
    };
  });
}

/** E-posta gitmediyse yeniden dener (yönetici ya da raporu gönderen, raporun günü geçmeden) */
export async function resendCashReportEmail(id: number) {
  return attempt(async () => {
    const me = await requireUser();
    const [row] = await getDb().select().from(s.cashReports).where(eq(s.cashReports.id, z.number().int().positive().parse(id))).limit(1);
    if (!row) throw new UserError("Rapor bulunamadı");
    if (me.role !== "admin" && (row.submittedBy !== me.id || !staffCanReport(row.date))) throw new UserError("Bu raporu yalnız yönetici yeniden gönderebilir");
    const email = await emailReport(row.id);
    refresh();
    return email;
  });
}

export async function deleteCashReport(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const reportId = z.number().int().positive().parse(id);
    // Yanlışlıkla silinen raporun fotoğrafları 30 gün daha saklanır (bağları raporla birlikte silinir)
    const { row, photos } = await getDb().transaction(async (tx) => {
      const links = await tx.select({ photoId: s.cashReportPhotos.photoId }).from(s.cashReportPhotos).where(eq(s.cashReportPhotos.reportId, reportId));
      for (const l of links) await releasePhoto(l.photoId, DELETED_REPORT_DAYS, tx);
      // Önceki sürümleri raporla gider (cascade): silinen raporun değerleri işlem geçmişinde kalır
      const [row] = await tx
        .delete(s.cashReports)
        .where(eq(s.cashReports.id, reportId))
        .returning({
          date: s.cashReports.date,
          zTotal: s.cashReports.zTotal,
          countedCash: s.cashReports.countedCash,
          cashDiff: s.cashReports.cashDiff,
          by: s.cashReports.submittedByName,
          countedByName: s.cashReports.countedByName,
        });
      if (!row) throw new UserError("Rapor bulunamadı");
      return { row, photos: links.length };
    });
    await logActivity(
      me,
      "Kasa raporu silindi",
      [longDateTR(row.date), `Z ${money(row.zTotal)}`, `sayılan ${money(row.countedCash)}`, diffText(row.cashDiff), row.countedByName ?? row.by, photos ? `${photos} fotoğraf` : null]
        .filter(Boolean)
        .join(" · "),
    );
    refresh();
    return null;
  });
}

const settingsSchema = z.object({
  recipients: z.string().max(2000),
  emailEnabled: z.boolean(),
  whatsapp: z.string().max(40),
});

export async function updateCashSettings(input: z.input<typeof settingsSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = settingsSchema.parse(input);
    const { valid, invalid } = parseEmails(data.recipients);
    if (invalid.length) throw new UserError(`Geçersiz e-posta: ${invalid.slice(0, 3).join(", ")}`);
    if (valid.length > 10) throw new UserError("En çok 10 adres girilebilir");
    if (data.emailEnabled && !valid.length) throw new UserError("E-posta açıkken en az bir adres girin");
    const whatsapp = data.whatsapp.trim() ? waPhone(data.whatsapp) : null;
    if (data.whatsapp.trim() && !whatsapp) throw new UserError("WhatsApp numarası geçersiz (ör. 0532 123 45 67)");
    await saveCashSettings({ recipients: valid, emailEnabled: data.emailEnabled, whatsapp });
    await logActivity(me, "Kasa raporu alıcıları", valid.join(", ") || "e-posta kapalı");
    refresh();
    return { recipients: valid, whatsapp };
  });
}

/** Alıcılara deneme e-postası: son raporla (yoksa örnek bir raporla), konusu "[Deneme]" */
export async function sendCashTestEmail() {
  return attempt(async () => {
    await requireAdmin();
    const settings = await loadCashSettings();
    if (!settings.recipients.length) throw new UserError("Önce bir adres girin");
    if (!isEmailConfigured()) throw new UserError("E-posta kurulmamış: Vercel'de RESEND_API_KEY tanımlı değil");
    const [last] = await cashReportsBetween("2000-01-01", businessDate());
    const sample: CashReportFields = last ?? {
      date: businessDate(),
      zNo: "0001",
      receipts: 42,
      zTotal: 10_000,
      cash: 2_500,
      card: 7_000,
      mealCard: 500,
      online: 0,
      other: 0,
      openingCash: 500,
      cashOut: 100,
      cashOutNote: "süt",
      countedCash: 2_880,
      handedOver: 2_400,
      bankPos: 7_000,
      offRevenue: null,
      discounts: null,
      note: "Örnek rapor",
    };
    const msg = renderCashReport(sample, { by: last?.submittedByName ?? "Örnek", revision: 1, submittedAt: new Date() });
    const notify = await loadNotifySettings();
    const res = await sendEmail({ from: resolveFrom(notify.from), to: settings.recipients, ...msg, subject: `[Deneme] ${msg.subject}` });
    if (!res.ok) throw new UserError(res.error);
    return { to: settings.recipients.length };
  });
}

/** Ekranda kayıtlı raporun WhatsApp metni (rapor zaten gönderilmişken "WhatsApp ile gönder" için) */
export async function cashReportWhatsapp(date: string) {
  return attempt(async () => {
    const me = await requireUser();
    const d = zDate.parse(date);
    if (me.role !== "admin" && !staffCanReport(d)) throw new UserError("Bu raporu yalnız yönetici görebilir");
    const r = await getCashReport(d);
    if (!r) throw new UserError("Bu günün raporu yok");
    const [settings, waste, extras, integrity] = await Promise.all([loadCashSettings(), dayWaste(d), cashReportExtras(r), cashReportIntegrity(r)]);
    const text = whatsappText(r, { by: r.submittedByName, revision: r.revision, waste, ...extras, ...integrity });
    return { text, link: whatsappLink(text, settings.whatsapp) };
  });
}
