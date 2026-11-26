import "server-only";

import { and, desc, eq, gte, isNull, lt, lte, or, sql } from "drizzle-orm";

import { businessDate, changesText, computeCash, revisionChanges, revisionDataOf } from "@/lib/cash-report";
import { cashDaySubject } from "@/lib/cash-requests";
import { cashOutNoteOf, cashOutsTotal, type CashOutKind } from "@/lib/cash-outs";
import { bankPosHash, renderPavoMail } from "@/lib/lafpos/bank-pos";
import { bankPosSchema, posDaySchema, posZSchema, type BankPos, type PosIkram, type PosOffDevice, type PosOkc, type PosPayment } from "@/lib/lafpos/day";
import { lafposPhotoNeed, type LafposPhotoCheck } from "@/lib/lafpos/foto";
import { lafposDayDetail, type LafposDayDetail } from "@/lib/lafpos/gun-ayrinti";
import {
  AUTO_FIELDS,
  autoMissing,
  autoValuesOf,
  autoValuesOfReport,
  catchUpOrder,
  compareDays,
  dayEndPending,
  dayEndSubjectNoCount,
  dayHash,
  humanDeviceFill,
  LAFPOS_AUTO_BY,
  mergeAuto,
  photoCheckHash,
  photoMailNeeded,
  renderDayEnd,
  renderPhotoMail,
  renderStaffDayEnd,
  type AutoValues,
  type ReportState,
} from "@/lib/lafpos/gun-sonu";
import { isLafposDay } from "@/lib/lafpos/switch";
import { emailKey } from "@/lib/notify-recipients";
import { DELETED_REPORT_DAYS } from "@/lib/photo-rules";
import { addDays, longDateTR } from "@/lib/reminders";
import { adoptPendingDayPhotos, lockCashReport, lockLateDay, okcServerColumns, type CashTx } from "@/server/cash/report-store";
import { onNextReport, onReportSaved } from "@/server/closed-days";
import { loadCashSettings } from "@/server/data/cash-reports";
import { schema as s, type DB } from "@/server/db";
import { loadLafposSwitchDay } from "@/server/lafpos/status";
import { lafposBranchId } from "@/server/lafpos/branch";
import { APP_URL } from "@/server/notify/digest-template";
import { activeDigestRecipients, sendableRecipients } from "@/server/notify/recipients";
import { isEmailConfigured, resolveFrom, sendEmail, type SendOptions } from "@/server/notify/resend";
import { loadNotifySettings } from "@/server/notify/settings";
import { strongRecheckDayPhotos, type StrongRecheckDeps } from "@/server/photo-read/lafpos";
import { fetchTillOnlineRow } from "@/server/site-sales/sync";
import { supersede } from "@/server/staff-requests/core";

import { applyPhotoZNo, dayPhotoIds, linkPendingPhotos, photoCheckOf, refreshDayPhotoCheck } from "./foto";

/*
 * LafPOS gün sonunun otomasyonu (docs/LAFPOS.md › Gün sonu otomasyonu): LafPOS'un şubesinin (Marina; kütükten türetilir, lafposBranchId)
 * gün sonu geçiş gününden itibaren gelince
 *
 * 1. Kasa raporu kendiliğinden yazılır (rapor yoksa; LafPOS'ta sayım yoksa yazılmaz, uydurulmaz). Düzeltme gelince
 *    yalnız elle değişmemiş alanlar güncellenir. Elle girilmiş raporun Z'sine ve kasasına dokunulmaz; yalnız boş cihaz
 *    alanları (Banka POS, yazarkasa) dolar (humanDeviceFill).
 * 2. Gün sonu e-postası kasa raporu alıcılarına gider (Tuzla'nın kasa e-postası gibi; personel ve pasif hesap düşer),
 *    içerik başına bir kez; düzeltme "düzeltildi" notuyla bir kez daha. Pavo'nun sonucu beklenirken (cihaz Pavo, önceki
 *    gün de geldi) en çok PAVO_WAIT_MS beklenir: karşılaştırma aynı e-postaya girer. Başarısızsa hata kaydedilir, günlük
 *    iş yeniden dener.
 * 3. Çalışanların kısa e-postası (Kasa › Rapor alıcıları › Çalışanlar): sayım varsa "gün sonu alındı" günde bir kez,
 *    sayım yoksa "kasa sayılmadı" uyarısı günde bir kez. Sonucu notification_log'a yazılır; düşerse günlük iş yeniden dener.
 *
 * Tetik: `POST /api/pos/gun` yanıtı döndükten sonra (after(); kasa e-postayı beklemez) ve günlük iş (son 7 gün, işi bekleyen
 * gün önce ve yeniden eskiye; geçiş günü sonradan girildiyse eksik günler). Pavo'yu bekleyen gün (LafPOS günü yeniden
 * göndermedi) beklemesi dolunca canlı yoklamadan (en çok 5 dakikada bir) ya da kontrol işinden (22:07, 22:37) biter:
 * finishWaitingDayEnds. Tuzla (ModPOS) bu yoldan hiç geçmez.
 */

/** Günlük işin geriye baktığı gün sayısı (geçiş günü sonradan girilse de en çok bu kadar eski gün işlenir) */
export const DAY_END_LOOKBACK_DAYS = 7;
/** Sürmekte olan gönderimin işareti bu kadar eskiyse bırakılmış sayılır */
const SENDING_STALE_MS = 5 * 60_000;
/**
 * Pavo'nun banka gün sonu çoğu zaman günün kapanışından bir iki dakika sonra biter ve LafPOS günü yeniden gönderir (24
 * Kasım 2026: 58 sn). Cihaz Pavo'ysa gün sonu e-postası Pavo'nun sonucunu en çok bu kadar bekler (günün İLK gelişinden;
 * yeniden gönderim beklemeyi uzatmaz): karşılaştırma aynı e-postaya girer, yöneticiye ikinci bir Pavo e-postası gitmez.
 *
 * Bekleme hiçbir zaman sonraki bir tetiğe kalmaz (25 Kasım 2026 akşamı: LafPOS ikinci gönderimi yapmadı, gece hiçbir tetik
 * yoktu, e-posta gitmedi): beklemeye alan gönderimin kendi after()'ı süresi içinde Pavo'nun sonucunu yoklar, gelmezse
 * e-postayı Pavo'suz gönderir (settlePavoWait); sonuç sonra gelirse kısa Pavo e-postası gider. Yeni LafPOS ilk gövdeyi Pavo
 * bitince (ya da atlanınca) gönderir ve `bankPosPending` ile beklenip beklenmeyeceğini açıkça söyler
 */
export const PAVO_WAIT_MS = 2 * 60_000;
/** Canlı yoklamanın bekleyen gün sonuna bakma aralığı (sunucu örneği başına) */
const WAIT_POLL_GAP_MS = 5 * 60_000;

/** Gün sonu otomasyonunun seçenekleri: `noPavoWait` Pavo beklemesini bitirir (settlePavoWait'in süresi doldu) */
export type DayEndOptions = SendOptions & { noPavoWait?: boolean };

export type AutoReportResult = "written" | "updated" | "unchanged" | "human" | "no-count" | "old" | "deleted" | "skipped";
/** "waiting": Pavo'nun sonucu bekleniyor (PAVO_WAIT_MS), sonraki gönderim ya da günlük iş gönderir */
export type DayEndEmailResult = "sent" | "failed" | "off" | "same" | "busy" | "skipped" | "waiting";
/** Çalışanların kısa e-postası: "skipped" alıcı yok, gün eski ya da bu gönderimde sırası değil */
export type StaffEmailResult = "sent" | "failed" | "same" | "skipped";
/** Kısa Pavo e-postası: "included" karşılaştırma gün sonu e-postasıyla gitti; "waiting" gün sonu e-postası henüz gitmedi (onunla gider) */
export type PavoEmailResult = "sent" | "failed" | "off" | "same" | "busy" | "skipped" | "waiting";
/**
 * Fotoğraf e-postası: "skipped" fotoğraf yok ya da LafPOS'u tutuyor; "waiting" gün sonu e-postası henüz gitmedi (fark onunla
 * gider); "same" bu karşılaştırma daha önce gitti (gün sonu e-postasıyla ya da kendisi)
 */
export type PhotoEmailResult = "sent" | "failed" | "off" | "same" | "busy" | "skipped" | "waiting";

/** Fotoğraf karşılaştırmasının gittiğinin kaydı (notification_log): içerik başına bir anahtar */
const photoMailKey = (branchId: string, date: string, check: LafposPhotoCheck) => `lafpos-foto:${branchId}:${date}:${photoCheckHash(check)}`;

interface StoredDay {
  z: ReturnType<typeof posZSchema.parse>;
  payments: PosPayment[];
  ikram: PosIkram[];
  /** Pavo karşılaştırması (gelmediyse ya da okunamıyorsa null); günün özetine (hash) girmez: geldiğinde gün sonu yinelenmez */
  bankPos: BankPos | null;
  /** Faz 2 ayrıntısı (yazarkasadan geçmeyen, iptaller, düzeltme; src/lib/lafpos/gun-ayrinti.ts); özete girmez */
  detail: LafposDayDetail;
  /** Gün sonu tam: yazarkasanın cihaz belgeleri ve yazarkasadan geçmeyen (raporun yazarkasa alanları ve Banka POS) */
  okc: PosOkc | null;
  offDevice: PosOffDevice | null;
  hash: string;
  /** Son gönderimin geldiği an */
  receivedAt: Date;
}

async function loadStoredDay(db: DB | CashTx, date: string, branchId: string): Promise<StoredDay | null> {
  const [row] = await db
    .select({
      z: s.posDayReports.z,
      payments: s.posDayReports.payments,
      ikram: s.posDayReports.ikram,
      bankPos: s.posDayReports.bankPos,
      offDevice: s.posDayReports.offDevice,
      refunds: s.posDayReports.refunds,
      iptal: s.posDayReports.iptal,
      revision: s.posDayReports.revision,
      correction: s.posDayReports.correction,
      cashMoves: s.posDayReports.cashMoves,
      okc: s.posDayReports.okc,
      collections: s.posDayReports.collections,
      shiftCounts: s.posDayReports.shiftCounts,
      discountLines: s.posDayReports.discountLines,
      receivedAt: s.posDayReports.receivedAt,
    })
    .from(s.posDayReports)
    .where(and(eq(s.posDayReports.date, date), eq(s.posDayReports.branchId, branchId)))
    .limit(1);
  if (!row) return null;
  const z = posZSchema.safeParse(row.z);
  if (!z.success) return null;
  const bankPos = row.bankPos ? bankPosSchema.safeParse(row.bankPos) : null;
  // Saklanan Faz 2 alanları aynı şemayla (bozuk ya da yoksa yok sayılır)
  const sh = posDaySchema.shape;
  const offDevice = row.offDevice ? (sh.offDevice.parse(row.offDevice) ?? null) : null;
  const okc = row.okc ? (sh.okc.parse(row.okc) ?? null) : null;
  const detail = lafposDayDetail({
    z: z.data,
    offDevice: offDevice ?? undefined,
    refunds: row.refunds ? sh.refunds.parse(row.refunds) : undefined,
    iptal: row.iptal ? sh.iptal.parse(row.iptal) : undefined,
    revision: row.revision ?? undefined,
    correction: row.correction ? sh.correction.parse(row.correction) : undefined,
    cashMoves: row.cashMoves ? sh.cashMoves.parse(row.cashMoves) : undefined,
    okc: okc ?? undefined,
    collections: row.collections ? sh.collections.parse(row.collections) : undefined,
    shiftCounts: row.shiftCounts ? sh.shiftCounts.parse(row.shiftCounts) : undefined,
    discountLines: row.discountLines ? sh.discountLines.parse(row.discountLines) : undefined,
  });
  return {
    z: z.data,
    payments: row.payments ?? [],
    ikram: row.ikram ?? [],
    bankPos: bankPos?.success ? bankPos.data : null,
    detail,
    okc,
    offDevice,
    hash: dayHash({ z: row.z, payments: row.payments, ikram: row.ikram }),
    receivedAt: row.receivedAt,
  };
}

/**
 * Günün LafPOS'tan ilk gelişi (aynı Z'nin sürüm geçmişindeki en eski gönderim; yoksa son gelişi) ve son gövdenin Pavo
 * beklentisi (`bankPosPending`; eski LafPOS göndermez)
 */
async function dayArrival(db: DB, date: string, branchId: string, day: StoredDay): Promise<{ firstAt: Date; pending: boolean | undefined }> {
  const [first] = await db
    .select({ at: sql<Date | string>`min(${s.posDayRevisions.receivedAt})` })
    .from(s.posDayRevisions)
    .where(and(eq(s.posDayRevisions.date, date), eq(s.posDayRevisions.branchId, branchId), eq(s.posDayRevisions.zNo, day.z.zNo)));
  const [last] = await db
    .select({ body: s.posDayRevisions.body })
    .from(s.posDayRevisions)
    .where(and(eq(s.posDayRevisions.date, date), eq(s.posDayRevisions.branchId, branchId)))
    .orderBy(desc(s.posDayRevisions.id))
    .limit(1);
  const firstAt = first?.at ? new Date(first.at) : day.receivedAt;
  const pending = (last?.body as { bankPosPending?: unknown } | undefined)?.bankPosPending;
  return { firstAt: firstAt.getTime() < day.receivedAt.getTime() ? firstAt : day.receivedAt, pending: typeof pending === "boolean" ? pending : undefined };
}

/**
 * Gün sonu e-postası Pavo'nun sonucunu mu bekler: sonuç henüz yok, günün yazarkasası Pavo ve gün ilk gelişinden bu yana
 * PAVO_WAIT_MS geçmedi. LafPOS `bankPosPending` gönderdiyse ona uyulur (false: banka gün sonu başlamayacak ya da bitti,
 * beklenmez); göndermediyse (eski LafPOS) şubenin önceki LafPOS gününde Pavo sonucu varsa beklenir (otomatik banka gün
 * sonu açık; kapalıysa beklemek boşuna)
 */
async function waitsForPavo(db: DB, date: string, branchId: string, day: StoredDay, now: Date): Promise<boolean> {
  if (day.bankPos || day.okc?.provider !== "pavo") return false;
  const arrival = await dayArrival(db, date, branchId, day);
  if (arrival.pending === false || now.getTime() - arrival.firstAt.getTime() >= PAVO_WAIT_MS) return false;
  if (arrival.pending === true) return true;
  const [prev] = await db
    .select({ bankPos: s.posDayReports.bankPos })
    .from(s.posDayReports)
    .where(and(eq(s.posDayReports.branchId, branchId), lt(s.posDayReports.date, date)))
    .orderBy(desc(s.posDayReports.date))
    .limit(1);
  return Boolean(prev?.bankPos);
}

/**
 * Gün LafPOS'un şubesinin LafPOS günü mü (geçiş günü seçili ve gün ondan önce değil). LafPOS'un şubesinin geçiş günü
 * ayarın kendisidir (branchSwitchDay; şube lafposBranchId), bu dosyanın her işi o şubenin günüdür
 */
export async function isCountedLafposDay(db: DB, date: string): Promise<boolean> {
  return isLafposDay(date, await loadLafposSwitchDay(db));
}

async function ensureState(tx: CashTx, date: string, branchId: string) {
  await tx.insert(s.lafposDayEnds).values({ date, branchId }).onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(s.lafposDayEnds)
    .where(and(eq(s.lafposDayEnds.date, date), eq(s.lafposDayEnds.branchId, branchId)))
    .for("update")
    .limit(1);
  return row;
}

/**
 * Kasa raporunu LafPOS'un gün sonundan yazar ya da günceller (tek işlem; geç raporun ve raporun kilidi altında).
 * Rapor yoksa ve LafPOS'ta sayım varsa yeni rapor (gönderen "LafPOS (otomatik)"); rapor bu otomasyonunsa elle
 * değişmemiş alanlar düzeltmeyle güncellenir (önceki sürüm geçmişe); başka biri girdiyse ("human") Z'ye, kasaya ve nota
 * dokunulmaz, yalnız boş cihaz alanları (Banka POS, yazarkasa) dolar (fillHumanDevice).
 */
export async function writeAutoReport(db: DB, date: string, now = new Date()): Promise<AutoReportResult> {
  const branchId = await lafposBranchId(db);
  if (!(await isCountedLafposDay(db, date))) return "skipped";
  return db.transaction(async (tx) => {
    await lockLateDay(tx, date, branchId);
    const day = await loadStoredDay(tx, date, branchId);
    if (!day) return "skipped";
    const state = await ensureState(tx, date, branchId);
    const prev = await lockCashReport(tx, date, branchId);
    const device = { bankPos: day.bankPos, okc: day.okc, offDevice: day.offDevice };
    const outs = await tx
      .select({ kind: s.cashOuts.kind, amount: s.cashOuts.amount, store: s.cashOuts.store, description: s.cashOuts.description })
      .from(s.cashOuts)
      .where(and(eq(s.cashOuts.date, date), eq(s.cashOuts.branchId, branchId)));
    const lines = outs.map((o) => ({ ...o, kind: o.kind as CashOutKind }));
    const [before] = await tx
      .select({ date: s.cashReports.date, counted: s.cashReports.countedCash, handed: s.cashReports.handedOver })
      .from(s.cashReports)
      .where(and(lt(s.cashReports.date, date), eq(s.cashReports.branchId, branchId)))
      .orderBy(desc(s.cashReports.date))
      .limit(1);
    const carry = before ? { date: before.date, amount: Math.round((before.counted - before.handed) * 100) / 100 } : null;
    const next = autoValuesOf(date, day.z, { count: lines.length, total: cashOutsTotal(lines), note: cashOutNoteOf(lines) }, carry, device);
    // Eksikler: cihaz boşlukları ve (otomatik rapor varken) gün sonu fotoğrafı; rapor yokken fotoğraf beklemede sayılır
    const missingFor = (attached: number | null, check: typeof state.photoCheck = null) =>
      attached === null ? autoMissing(day.z, device) : autoMissing(day.z, device, { attached, check });
    const setState = (patch: Partial<typeof s.lafposDayEnds.$inferInsert>) =>
      tx
        .update(s.lafposDayEnds)
        .set({ dayHash: day.hash, missing: missingFor(null), updatedAt: now, ...patch })
        .where(and(eq(s.lafposDayEnds.date, date), eq(s.lafposDayEnds.branchId, branchId)));

    // Otomatik rapor yönetici tarafından silindiyse yeniden yazılmaz
    if (!prev && state.autoValues) return "deleted";
    if (!prev) {
      if (next.countedCash === null) {
        await setState({ reportId: null, autoValues: null });
        return "no-count";
      }
      // Geçiş günü çok sonradan girildiyse eski günlere rapor yazılmaz (geç rapor yöneticinin işi)
      if (date < addDays(businessDate(now), -DAY_END_LOOKBACK_DAYS)) {
        await setState({});
        return "old";
      }
      const values = toColumns(next);
      let [row] = await tx
        .insert(s.cashReports)
        .values({
          date,
          branchId,
          ...values,
          cashDiff: computeCash(values).cashDiff,
          submittedBy: null,
          submittedByName: LAFPOS_AUTO_BY,
          countedBy: null,
          countedByName: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await onReportSaved(tx, date, now, branchId);
      await onNextReport(tx, row, now);
      await supersede(tx, { kinds: ["kasa-gec"], subject: cashDaySubject(date, branchId) }, "LafPOS gün sonundan rapor yazıldı", now, DELETED_REPORT_DAYS);
      await tx.insert(s.activityLog).values({ userName: LAFPOS_AUTO_BY, userId: null, action: "Kasa raporu (LafPOS otomatik)", detail: `${longDateTR(date)}: Z ${day.z.zNo}` });
      // Rapor yokken (sayım yok) eklenen gün sonu fotoğrafları şimdi bağlanır; yazarkasa alanları geldiyse sunucu sütunları
      row = (await linkPendingPhotos(tx, row, state.pendingPhotos, now)).row;
      if (row.okcZNo && row.okcTotal !== null) row = await serverColumns(tx, row);
      const check = await photoCheckOf(tx, row, { ...device, z: day.z }, now);
      await setState({ reportId: row.id, autoValues: next, pendingPhotos: [], photoCheck: check, missing: missingFor((await dayPhotoIds(tx, row.id)).length, check) });
      // LafPOS yazarkasa Z no'su göndermediyse bekleyen fotoğrafta (Pavo'nun detaylı Z'si) okunan
      await applyPhotoZNo(tx, row, check, now);
      return "written";
    }

    if (state.reportId !== prev.id || !state.autoValues) {
      // Sayım yokken bekleyen gün sonu fotoğrafları elle girilen rapora bağlanır (yoksa sahipsiz kalırdı)
      if (state.pendingPhotos.length && (await adoptPendingDayPhotos(tx, prev, now)) > 0) await serverColumns(tx, prev);
      // Elle girilmiş rapor (yönetici gün sonundan önce ya da sayımsız günde girdi): Z'ye ve kasaya dokunulmaz, yalnız boş
      // cihaz alanları LafPOS'tan dolar (bulgu 6); elle girilen alan ezilmez
      await fillHumanDevice(tx, (await lockCashReport(tx, date, branchId)) ?? prev, next, now);
      await setState({ autoValues: null, missing: [] });
      return "human";
    }
    const merged = mergeAuto(autoValuesOfReport(prev), state.autoValues as AutoValues, next);
    const attached = (await dayPhotoIds(tx, prev.id)).length;
    if (!merged.changed.length) {
      // Pavo sonucu geldi ama rakam aynı (ya da elle düzeltildi): karşılaştırma yine yenilenir (Pavo'nun batch'leri)
      const check = await photoCheckOf(tx, prev, { ...device, z: day.z }, now);
      await setState({ autoValues: merged.auto, photoCheck: check, missing: missingFor(attached, check) });
      await applyPhotoZNo(tx, prev, check, now);
      return "unchanged";
    }
    await tx.insert(s.cashReportRevisions).values({
      reportId: prev.id,
      date: prev.date,
      revision: prev.revision,
      data: revisionDataOf(prev),
      submittedBy: prev.submittedBy,
      submittedByName: prev.submittedByName,
      submittedAt: prev.updatedAt,
    });
    const values = toColumns(merged.values);
    const fields = { ...prev, ...values };
    let [row] = await tx
      .update(s.cashReports)
      .set({ ...values, cashDiff: computeCash(fields).cashDiff, revision: prev.revision + 1, submittedBy: null, submittedByName: LAFPOS_AUTO_BY, emailStatus: null, emailError: null, updatedAt: now })
      .where(eq(s.cashReports.id, prev.id))
      .returning();
    // Yazarkasa Z no'su ya da günlük toplamı değiştiyse sunucu sütunları (kümülatif, yazarkasa dışı) formun kaydındaki gibi
    // yeniden hesaplanır
    if ((prev.okcZNo ?? null) !== (row.okcZNo ?? null) || (prev.okcTotal ?? null) !== (row.okcTotal ?? null)) row = await serverColumns(tx, row);
    const changes = revisionChanges(revisionDataOf(prev), revisionDataOf(row));
    await tx.insert(s.activityLog).values({
      userName: LAFPOS_AUTO_BY,
      userId: null,
      action: "Kasa raporu güncellendi (LafPOS otomatik)",
      detail: `${longDateTR(date)}: ${changesText(changes)}${merged.kept.length ? ` · elle düzeltilen korundu: ${merged.kept.length} alan` : ""}`,
    });
    const check = await photoCheckOf(tx, row, { ...device, z: day.z }, now);
    await setState({ autoValues: merged.auto, photoCheck: check, missing: missingFor(attached, check) });
    await applyPhotoZNo(tx, row, check, now);
    return "updated";
  });
}

/**
 * Elle girilmiş raporun boş cihaz alanlarını LafPOS'un gün sonundan doldurur (humanDeviceFill; bulgu 6). Önceki sürüm
 * geçmişe, işlem geçmişine "LafPOS (otomatik)" adına satır. Gönderen ve sayan değişmez (inceleme, 25 Kasım 2026): Z, kasa
 * ve not elle girenindir; rapor listesi, kart başlığı ve e-posta gönderen olarak onu gösterir. Z, kasa ve not değişmez; e-postanın durumu kalır (rapor yeniden e-postalanmaz, gün sonu e-postası cihazları
 * zaten söyler). Yazarkasa alanları dolduysa sunucu sütunları formun kaydındaki gibi hesaplanır. Yazılacak yoksa hiçbir
 * şey yazılmaz
 */
async function fillHumanDevice(tx: CashTx, prev: typeof s.cashReports.$inferSelect, next: AutoValues, now: Date): Promise<void> {
  const fill = humanDeviceFill(prev, next);
  if (!Object.keys(fill).length) return;
  await tx.insert(s.cashReportRevisions).values({
    reportId: prev.id,
    date: prev.date,
    revision: prev.revision,
    data: revisionDataOf(prev),
    submittedBy: prev.submittedBy,
    submittedByName: prev.submittedByName,
    submittedAt: prev.updatedAt,
  });
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const set: Partial<typeof s.cashReports.$inferInsert> = {};
  if ("bankPos" in fill) set.bankPos = num(fill.bankPos);
  for (const f of ["okcReceipts", "okcTotal", "okcCash", "okcCard", "okcMealCard", "okcOther", "okcVatTotal"] as const) if (f in fill) set[f] = num(fill[f]);
  if ("okcZNo" in fill) set.okcZNo = typeof fill.okcZNo === "string" ? fill.okcZNo : null;
  if ("okcVat" in fill) set.okcVat = Array.isArray(fill.okcVat) && fill.okcVat.length ? fill.okcVat : null;
  let [row] = await tx
    .update(s.cashReports)
    .set({ ...set, revision: prev.revision + 1, updatedAt: now })
    .where(eq(s.cashReports.id, prev.id))
    .returning();
  if (row.okcZNo && row.okcTotal !== null && ((prev.okcZNo ?? null) !== row.okcZNo || (prev.okcTotal ?? null) !== row.okcTotal)) row = await serverColumns(tx, row);
  const changes = revisionChanges(revisionDataOf(prev), revisionDataOf(row));
  await tx.insert(s.activityLog).values({
    userName: LAFPOS_AUTO_BY,
    userId: null,
    action: "Kasa raporu güncellendi (LafPOS otomatik)",
    detail: `${longDateTR(prev.date)}: elle girilen rapora cihaz alanları yazıldı · ${changesText(changes)}`,
  });
}

/** Sunucu sütunları (kümülatif, yazarkasa dışı tahsilat; report-store okcServerColumns): değiştiyse yazılır */
async function serverColumns(tx: CashTx, row: typeof s.cashReports.$inferSelect): Promise<typeof s.cashReports.$inferSelect> {
  const server = await okcServerColumns(tx, row);
  if (server.okcCumTotal === row.okcCumTotal && server.okcCumVat === row.okcCumVat && server.okcOutside === row.okcOutside) return row;
  const [next] = await tx.update(s.cashReports).set(server).where(eq(s.cashReports.id, row.id)).returning();
  return next;
}

/** Otomatik değerler → rapor sütunları (sayısal sütunlarda boş 0 değil: çağıran sayımı olmayan raporu yazmaz) */
function toColumns(v: AutoValues) {
  const num = (f: (typeof AUTO_FIELDS)[number]) => (typeof v[f] === "number" ? (v[f] as number) : 0);
  const opt = (f: (typeof AUTO_FIELDS)[number]) => (typeof v[f] === "number" ? (v[f] as number) : null);
  const text = (f: (typeof AUTO_FIELDS)[number]) => (typeof v[f] === "string" ? (v[f] as string) : null);
  // Gün sonu tam: Banka POS (Pavo) ve yazarkasa alanları (LafPOS'un cihaz belgeleri); cihaz rakamı yoksa boş
  const vat = Array.isArray(v.okcVat) && v.okcVat.length ? v.okcVat : null;
  return {
    bankPos: opt("bankPos"),
    okcReceipts: opt("okcReceipts"),
    okcTotal: opt("okcTotal"),
    okcCash: opt("okcCash"),
    okcCard: opt("okcCard"),
    okcMealCard: opt("okcMealCard"),
    okcOther: opt("okcOther"),
    okcVat: vat,
    okcVatTotal: opt("okcVatTotal"),
    zNo: text("zNo"),
    okcZNo: text("okcZNo"),
    receipts: opt("receipts"),
    zTotal: num("zTotal"),
    cash: num("cash"),
    card: num("card"),
    mealCard: num("mealCard"),
    online: num("online"),
    other: num("other"),
    offRevenue: opt("offRevenue"),
    discounts: opt("discounts"),
    openingCash: num("openingCash"),
    cashIn: num("cashIn"),
    cashOut: num("cashOut"),
    cashOutNote: text("cashOutNote"),
    countedCash: num("countedCash"),
    handedOver: num("handedOver"),
    note: text("note"),
  };
}

/**
 * Günün satışı (Z toplamı): LafPOS gününde (geçiş günü ve sonrası) LafPOS gün sonu, yoksa şubenin kasa raporu. Geçiş
 * gününden önceki gün ModPOS günüdür: o güne LafPOS'tan gelmiş kayıt (deneme günü) sayılmaz, kasa raporu okunur.
 * `switchDay`: şubenin geçiş günü (branchSwitchDay), çağıran bir kez yükler.
 */
async function dayTotal(db: DB, date: string, branchId: string, switchDay: string | null): Promise<number | null> {
  if (isLafposDay(date, switchDay)) {
    const [pos] = await db
      .select({ z: s.posDayReports.z })
      .from(s.posDayReports)
      .where(and(eq(s.posDayReports.date, date), eq(s.posDayReports.branchId, branchId)))
      .limit(1);
    const z = pos ? posZSchema.safeParse(pos.z) : null;
    if (z?.success) return z.data.zTotal;
  }
  const [rep] = await db
    .select({ zTotal: s.cashReports.zTotal })
    .from(s.cashReports)
    .where(and(eq(s.cashReports.date, date), eq(s.cashReports.branchId, branchId)))
    .limit(1);
  return rep ? rep.zTotal : null;
}

/**
 * Gün sonu e-postasının alıcıları: gün sonunun şubesinin kasa raporu alıcıları (açıksa; şube başına ayar, "aynı"ysa
 * bağlandığı şubeninki), kasa e-postasıyla aynı (src/server/cash/report-email.ts). Sabah e-postasının adresleri girmez:
 * yalnız sabah e-postasını alan adres (ör. muhasebeci) şubelerin kasa sonucunu da ya alır ya almaz. Personel ve pasif
 * hesabın adresi düşer.
 *
 * Rapor alıcıları boş ya da kapalıysa e-posta susmasın diye o şubeye açık etkin bildirim adreslerine gider (bütün
 * şubeler ya da bu şube seçili olanlar; "Yalnız Tuzla" adresi Marina'nın gün sonunu almaz); alıcı listesi kurulunca
 * yalnız ona döner.
 */
export async function dayEndRecipients(db: DB, branchId: string): Promise<string[]> {
  const [cash, notify] = await Promise.all([loadCashSettings(branchId, db), loadNotifySettings()]);
  const own = cash.emailEnabled ? (await sendableRecipients(db, dedupe(cash.recipients))).to : [];
  if (own.length) return own;
  if (!notify.emailEnabled) return [];
  const digest = (await activeDigestRecipients(db)).filter((r) => !r.branchIds.length || r.branchIds.includes(branchId)).map((r) => r.email);
  return (await sendableRecipients(db, dedupe(digest))).to;
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((e) => (seen.has(emailKey(e)) ? false : (seen.add(emailKey(e)), true)));
}

/** Çalışanların e-postasının türü: sayım varsa "alındı", yoksa "kasa sayılmadı" (her biri günde bir kez) */
type StaffMailKind = "alindi" | "sayim-yok";
/** Çalışan e-postasının kaydı (notification_log): şube, gün ve tür başına bir anahtar */
const staffMailKey = (branchId: string, date: string, kind: StaffMailKind) => `lafpos-gun-calisan:${branchId}:${date}:${kind}`;

/**
 * Çalışanların kısa gün sonu e-postası (Kasa raporu ayarları › Çalışanlar), yöneticinin e-postasından ayrı ve sonucu
 * notification_log'da. Sayım varsa (rapor yazıldı ya da elle girildi) "gün sonu alındı", Z no ve fiş sayısı; "tutarlar"
 * açıksa ciro ve ödeme türleri. Günde bir kez: LafPOS düzeltip yeniden gönderse de ikinci "alındı" gitmez. Sayım yoksa
 * (rapor yazılmadı) teşekkür değil, kısa bir uyarı gider: çekmeceyi LafPOS'ta sayıp günü yeniden gönderin; o da günde bir
 * kez. Rapor ayrıntısı, kasa farkı ve karaoke ödemesi gitmez.
 *
 * Yalnız dün ve bugün (iş günü): günlük iş eski günleri işlerken personele geçmiş günün e-postası gitmez. `retryOnly`:
 * yöneticinin e-postası daha önce gitti (bu tetikte "same" ya da başka gönderim sürüyor); yalnız daha önce düşen (ok =
 * false) kayıt yeniden denenir. Başarılı kayıt ezilmez: aynı anahtarla yarışan ikinci gönderim (Resend 409) düşse de
 * ilk "gitti" kaydı kalır ve "same" döner
 */
export async function sendStaffDayEnd(db: DB, date: string, now = new Date(), opts?: SendOptions & { retryOnly?: boolean }): Promise<StaffEmailResult> {
  const branchId = await lafposBranchId(db);
  if (date < addDays(businessDate(now), -1)) return "skipped";
  const cash = await loadCashSettings(branchId, db);
  // Çalışanların adresleri personelin kendisi: yöneticinin listesindeki gibi personel adresi düşürülmez
  const to = [...new Map((cash.staffRecipients ?? []).map((e) => [emailKey(e), e])).values()];
  if (!to.length) return "skipped";
  const day = await loadStoredDay(db, date, branchId);
  if (!day) return "skipped";
  const [rep] = await db
    .select({ id: s.cashReports.id })
    .from(s.cashReports)
    .where(and(eq(s.cashReports.date, date), eq(s.cashReports.branchId, branchId)))
    .limit(1);
  const kind: StaffMailKind | null = rep ? "alindi" : day.z.countedCash === null ? "sayim-yok" : null;
  if (!kind) return "skipped";
  const key = staffMailKey(branchId, date, kind);
  const [prev] = await db.select({ ok: s.notificationLog.ok }).from(s.notificationLog).where(eq(s.notificationLog.key, key)).limit(1);
  if (prev?.ok) return "same";
  if (opts?.retryOnly && !prev) return "skipped";
  if (!isEmailConfigured()) return "skipped";
  const [branch] = await db.select({ name: s.branches.name }).from(s.branches).where(eq(s.branches.id, branchId)).limit(1);
  const msg = renderStaffDayEnd({ branchName: branch?.name ?? "Marina", date, kind, z: day.z, amounts: cash.staffAmounts === true });
  // Anahtar gün ve tür başına sabit: aynı anda iki tetik aynı e-postayı iki kez göndermez (Resend 24 saat hatırlar)
  const res = await sendEmail({ from: resolveFrom((await loadNotifySettings()).from), to, ...msg, idempotencyKey: key.replace(/:/g, "-") }, opts);
  await db
    .insert(s.notificationLog)
    .values({ key, channel: "email", subject: msg.subject, recipients: to.join(", "), ok: res.ok, error: res.ok ? null : res.error })
    .onConflictDoUpdate({
      target: s.notificationLog.key,
      set: { subject: msg.subject, recipients: to.join(", "), ok: res.ok, error: res.ok ? null : res.error, sentAt: new Date() },
      setWhere: eq(s.notificationLog.ok, false),
    });
  if (res.ok) return "sent";
  const [logged] = await db.select({ ok: s.notificationLog.ok }).from(s.notificationLog).where(eq(s.notificationLog.key, key)).limit(1);
  if (logged?.ok) return "same";
  console.error("[lafpos] çalışanların gün sonu e-postası gitmedi:", date, kind, res.error);
  return "failed";
}

/**
 * Gün sonu e-postası (içerik başına bir kez). Aynı içerik daha önce gittiyse "same"; başka bir gönderim sürüyorsa "busy";
 * Pavo'nun sonucu bekleniyorsa "waiting" (waitsForPavo). Başarısızsa hata kaydedilir; bir sonraki tetik (düzeltme ya da
 * günlük iş) yeniden dener. Sayımsız giden günün ilk sayımlı e-postası "düzeltildi" değil "kasa sayıldı" der.
 */
export async function sendDayEndEmail(db: DB, date: string, report: ReportState, now = new Date(), opts?: DayEndOptions): Promise<DayEndEmailResult> {
  const branchId = await lafposBranchId(db);
  const switchDay = await loadLafposSwitchDay(db);
  if (!isLafposDay(date, switchDay)) return "skipped";
  const day = await loadStoredDay(db, date, branchId);
  if (!day) return "skipped";
  await db.insert(s.lafposDayEnds).values({ date, branchId }).onConflictDoNothing();
  if (!opts?.noPavoWait && (await waitsForPavo(db, date, branchId, day, now))) {
    const [st] = await db.select({ emailedHash: s.lafposDayEnds.emailedHash }).from(s.lafposDayEnds).where(and(eq(s.lafposDayEnds.date, date), eq(s.lafposDayEnds.branchId, branchId)));
    if (st?.emailedHash !== day.hash) return "waiting";
  }
  // Gönderimi üstlen: içerik daha önce gitmediyse ve başka bir gönderim sürmüyorsa
  const stale = new Date(now.getTime() - SENDING_STALE_MS);
  const claimed = await db
    .update(s.lafposDayEnds)
    .set({ sendingAt: now })
    .where(
      and(
        eq(s.lafposDayEnds.date, date),
        eq(s.lafposDayEnds.branchId, branchId),
        sql`${s.lafposDayEnds.emailedHash} is distinct from ${day.hash}`,
        or(isNull(s.lafposDayEnds.sendingAt), lt(s.lafposDayEnds.sendingAt, stale)),
      ),
    )
    .returning({
      emailCount: s.lafposDayEnds.emailCount,
      missing: s.lafposDayEnds.missing,
      reportId: s.lafposDayEnds.reportId,
      photoCheck: s.lafposDayEnds.photoCheck,
      pendingPhotos: s.lafposDayEnds.pendingPhotos,
      autoValues: s.lafposDayEnds.autoValues,
    });
  if (!claimed.length) {
    const [st] = await db.select({ emailedHash: s.lafposDayEnds.emailedHash }).from(s.lafposDayEnds).where(and(eq(s.lafposDayEnds.date, date), eq(s.lafposDayEnds.branchId, branchId)));
    return st?.emailedHash === day.hash ? "same" : "busy";
  }
  const st = claimed[0];
  const finish = (patch: Partial<typeof s.lafposDayEnds.$inferInsert>) =>
    db
      .update(s.lafposDayEnds)
      .set({ sendingAt: null, updatedAt: new Date(), ...patch })
      .where(and(eq(s.lafposDayEnds.date, date), eq(s.lafposDayEnds.branchId, branchId)));
  try {
    const to = await dayEndRecipients(db, branchId);
    if (!to.length) {
      await finish({ emailError: "Alıcı yok: Kasa › Rapor alıcıları ve bildirim e-postaları boş ya da kapalı" });
      return "off";
    }
    if (!isEmailConfigured()) {
      await finish({ emailError: "E-posta kurulmamış (RESEND_API_KEY)" });
      return "failed";
    }
    const [branch] = await db.select({ name: s.branches.name }).from(s.branches).where(eq(s.branches.id, branchId)).limit(1);
    const days = compareDays(date);
    const [rep, yesterday, lastWeek, online, [prevState]] = await Promise.all([
      db.select().from(s.cashReports).where(and(eq(s.cashReports.date, date), eq(s.cashReports.branchId, branchId))).limit(1),
      dayTotal(db, days.yesterday, branchId, switchDay),
      dayTotal(db, days.lastWeek, branchId, switchDay),
      fetchTillOnlineRow(date, branchId),
      db.select({ subject: s.notificationLog.subject }).from(s.notificationLog).where(eq(s.notificationLog.key, `lafpos-gun:${branchId}:${date}`)).limit(1),
    ]);
    // Önceki e-posta sayımsız günü taşıdıysa bu sayımlı ilk e-posta "kasa sayıldı"dır, düzeltme değil. Kaydın konusu son
    // başarılı gönderiminki (düşen gönderim konuyu değiştirmez, aşağıda)
    const prevNoCount = st.emailCount > 0 && dayEndSubjectNoCount(prevState?.subject ?? "");
    const recount = prevNoCount && report !== "no-count";
    const values = rep[0] ? autoValuesOfReport(rep[0]) : null;
    // Gün sonu fotoğrafı: otomatik raporda (ya da rapor yokken bekleyen) eklenen; elle girilen raporda bölüm yok
    const auto = rep[0] && st.reportId === rep[0].id && st.autoValues;
    const photo =
      auto || !rep[0]
        ? { need: lafposPhotoNeed(day), attached: rep[0] ? (await dayPhotoIds(db, rep[0].id)).length : st.pendingPhotos.length, check: st.photoCheck ?? null }
        : null;
    const msg = renderDayEnd({
      branchName: branch?.name ?? "Marina",
      date,
      z: day.z,
      payments: day.payments,
      ikram: day.ikram,
      values,
      missing: st.missing ?? [],
      report,
      // Sayımsız giden günün yine sayımsız düzeltmesi de "düzeltildi" (konu ilkinden ayrılsın); yalnız ilk sayım değil
      corrected: st.emailCount > 0 && !recount,
      recount,
      yesterday: { date: days.yesterday, zTotal: yesterday },
      lastWeek: { date: days.lastWeek, zTotal: lastWeek },
      online: online ? online.online : null,
      link: `${APP_URL}/panel/kasa?gun=${date}&sube=${encodeURIComponent(branchId)}`,
      bankPos: day.bankPos,
      okc: day.okc,
      photo,
      detail: day.detail,
    });
    const notify = await loadNotifySettings();
    const res = await sendEmail({ from: resolveFrom(notify.from), to, ...msg, idempotencyKey: `lafpos-gun-${branchId}-${date}-${day.hash}` }, opts);
    await db
      .insert(s.notificationLog)
      .values({ key: `lafpos-gun:${branchId}:${date}`, channel: "email", subject: msg.subject, recipients: to.join(", "), ok: res.ok, error: res.ok ? null : res.error })
      // Düşen gönderim konuyu değiştirmez: konu son giden e-postanınkidir (sonraki "kasa sayıldı" kararı ona bakar)
      .onConflictDoUpdate({ target: s.notificationLog.key, set: { ...(res.ok ? { subject: msg.subject, recipients: to.join(", ") } : {}), ok: res.ok, error: res.ok ? null : res.error, sentAt: new Date() } });
    if (!res.ok) {
      await finish({ emailError: res.error });
      return "failed";
    }
    // Pavo karşılaştırması bu e-postayla gittiyse kısa Pavo e-postası ayrıca gitmez
    await finish({ emailedHash: day.hash, emailCount: st.emailCount + 1, emailedAt: new Date(), emailError: null, ...(day.bankPos ? { pavoEmailedHash: bankPosHash(day.bankPos) } : {}) });
    // Fotoğraf farkı bu e-postada satır satır gitti: aynı karşılaştırma için fotoğraf e-postası ayrıca gitmez
    if (photo?.check && photoMailNeeded(photo.check)) {
      await db
        .insert(s.notificationLog)
        .values({ key: photoMailKey(branchId, date, photo.check), channel: "email", subject: msg.subject, recipients: to.join(", "), ok: true, error: null })
        .onConflictDoNothing();
    }
    return "sent";
  } catch (e) {
    await finish({ emailError: (e instanceof Error ? e.message : "bilinmeyen hata").slice(0, 300) }).catch(() => {});
    throw e;
  }
}

/**
 * Kısa Pavo e-postası (Pavo – LafPOS kart karşılaştırması): Pavo sonucu gün sonundan birkaç dakika sonra aynı günün ikinci
 * gönderimiyle gelir. Gün sonu e-postası daha önce gittiyse yalnız karşılaştırma gider (fark varsa konuda "FARK VAR");
 * gitmediyse beklenir ("waiting"): karşılaştırma gün sonu e-postasının içinde gider. Aynı karşılaştırma bir kez gider.
 * Düşerse günlük iş yeniden dener. Hata alanı gün sonu e-postasınınkine yazılmaz (yalnız bildirim kaydında).
 */
export async function sendPavoEmail(db: DB, date: string, now = new Date(), opts?: SendOptions): Promise<PavoEmailResult> {
  const branchId = await lafposBranchId(db);
  if (!isLafposDay(date, await loadLafposSwitchDay(db))) return "skipped";
  const day = await loadStoredDay(db, date, branchId);
  if (!day?.bankPos) return "skipped";
  const hash = bankPosHash(day.bankPos);
  const [st] = await db
    .select({ emailedHash: s.lafposDayEnds.emailedHash, pavoEmailedHash: s.lafposDayEnds.pavoEmailedHash })
    .from(s.lafposDayEnds)
    .where(and(eq(s.lafposDayEnds.date, date), eq(s.lafposDayEnds.branchId, branchId)));
  if (!st?.emailedHash) return "waiting";
  if (st.pavoEmailedHash === hash) return "same";
  const stale = new Date(now.getTime() - SENDING_STALE_MS);
  const claimed = await db
    .update(s.lafposDayEnds)
    .set({ sendingAt: now })
    .where(
      and(
        eq(s.lafposDayEnds.date, date),
        eq(s.lafposDayEnds.branchId, branchId),
        sql`${s.lafposDayEnds.emailedHash} is not null`,
        sql`${s.lafposDayEnds.pavoEmailedHash} is distinct from ${hash}`,
        or(isNull(s.lafposDayEnds.sendingAt), lt(s.lafposDayEnds.sendingAt, stale)),
      ),
    )
    .returning({ date: s.lafposDayEnds.date });
  if (!claimed.length) return "busy";
  const finish = (patch: Partial<typeof s.lafposDayEnds.$inferInsert>) =>
    db
      .update(s.lafposDayEnds)
      .set({ sendingAt: null, updatedAt: new Date(), ...patch })
      .where(and(eq(s.lafposDayEnds.date, date), eq(s.lafposDayEnds.branchId, branchId)));
  try {
    const to = await dayEndRecipients(db, branchId);
    if (!to.length) {
      await finish({});
      return "off";
    }
    if (!isEmailConfigured()) {
      await finish({});
      return "failed";
    }
    const [branch] = await db.select({ name: s.branches.name }).from(s.branches).where(eq(s.branches.id, branchId)).limit(1);
    const msg = renderPavoMail({ branchName: branch?.name ?? "Marina", date, bankPos: day.bankPos, link: `${APP_URL}/panel/kasa?gun=${date}&sube=${encodeURIComponent(branchId)}` });
    const notify = await loadNotifySettings();
    const res = await sendEmail({ from: resolveFrom(notify.from), to, ...msg, idempotencyKey: `lafpos-pavo-${branchId}-${date}-${hash}` }, opts);
    await db
      .insert(s.notificationLog)
      .values({ key: `lafpos-pavo:${branchId}:${date}`, channel: "email", subject: msg.subject, recipients: to.join(", "), ok: res.ok, error: res.ok ? null : res.error })
      .onConflictDoUpdate({ target: s.notificationLog.key, set: { subject: msg.subject, ok: res.ok, error: res.ok ? null : res.error, sentAt: new Date() } });
    if (!res.ok) {
      await finish({});
      return "failed";
    }
    await finish({ pavoEmailedHash: hash });
    return "sent";
  } catch (e) {
    await finish({}).catch(() => {});
    throw e;
  }
}

/**
 * Fotoğraf e-postası (yalnız yöneticinin alıcıları; sahibin isteği, 24 Kasım 2026: "mail olarak vs. bilgilerde de farklı
 * olunca belirsin"): gün sonu e-postası gittikten sonra eklenen fotoğraf LafPOS'tan farklı okunduysa ya da kodla okunup bir
 * satırı güvenle seçilmediyse ("yönetici baksın") karşılaştırma satır satır gider. Aynı karşılaştırma bir kez gider (gün
 * sonu e-postasıyla gittiyse de); uyumlu fotoğraf göndermez. Çalışanların kısa e-postasına fotoğraf hiç girmez. Fotoğraf
 * eklenince (attachLafposDayPhoto, after) ve günlük işte (runLafposDayEnd) çağrılır; düşerse günlük iş yeniden dener
 */
export async function sendPhotoEmail(db: DB, date: string, now = new Date(), opts?: SendOptions): Promise<PhotoEmailResult> {
  const branchId = await lafposBranchId(db);
  if (!isLafposDay(date, await loadLafposSwitchDay(db))) return "skipped";
  const [st] = await db
    .select({ emailedHash: s.lafposDayEnds.emailedHash, photoCheck: s.lafposDayEnds.photoCheck, reportId: s.lafposDayEnds.reportId, autoValues: s.lafposDayEnds.autoValues })
    .from(s.lafposDayEnds)
    .where(and(eq(s.lafposDayEnds.date, date), eq(s.lafposDayEnds.branchId, branchId)));
  const check = st?.photoCheck ?? null;
  if (!st || !st.reportId || !st.autoValues || !photoMailNeeded(check)) return "skipped";
  if (!st.emailedHash) return "waiting";
  const key = photoMailKey(branchId, date, check!);
  const [already] = await db.select({ ok: s.notificationLog.ok }).from(s.notificationLog).where(eq(s.notificationLog.key, key)).limit(1);
  if (already?.ok) return "same";
  const stale = new Date(now.getTime() - SENDING_STALE_MS);
  const claimed = await db
    .update(s.lafposDayEnds)
    .set({ sendingAt: now })
    .where(and(eq(s.lafposDayEnds.date, date), eq(s.lafposDayEnds.branchId, branchId), or(isNull(s.lafposDayEnds.sendingAt), lt(s.lafposDayEnds.sendingAt, stale))))
    .returning({ date: s.lafposDayEnds.date });
  if (!claimed.length) return "busy";
  const release = () =>
    db
      .update(s.lafposDayEnds)
      .set({ sendingAt: null })
      .where(and(eq(s.lafposDayEnds.date, date), eq(s.lafposDayEnds.branchId, branchId)));
  try {
    const to = await dayEndRecipients(db, branchId);
    if (!to.length) return "off";
    if (!isEmailConfigured()) return "failed";
    const [branch] = await db.select({ name: s.branches.name }).from(s.branches).where(eq(s.branches.id, branchId)).limit(1);
    const msg = renderPhotoMail({ branchName: branch?.name ?? "Marina", date, check: check!, link: `${APP_URL}/panel/kasa?gun=${date}&sube=${encodeURIComponent(branchId)}` });
    const notify = await loadNotifySettings();
    const res = await sendEmail({ from: resolveFrom(notify.from), to, ...msg, idempotencyKey: key.replace(/:/g, "-") }, opts);
    await db
      .insert(s.notificationLog)
      .values({ key, channel: "email", subject: msg.subject, recipients: to.join(", "), ok: res.ok, error: res.ok ? null : res.error })
      .onConflictDoUpdate({ target: s.notificationLog.key, set: { subject: msg.subject, ok: res.ok, error: res.ok ? null : res.error, sentAt: new Date() } });
    return res.ok ? "sent" : "failed";
  } finally {
    await release().catch(() => {});
  }
}

/** Raporun e-postadaki durumu: otomatik yazımın sonucundan ve kayıttan */
async function reportStateOf(db: DB, date: string, auto: AutoReportResult): Promise<ReportState> {
  if (auto === "written") return "auto";
  if (auto === "updated") return "updated";
  if (auto === "human") return "human";
  if (auto === "no-count") return "no-count";
  const branchId = await lafposBranchId(db);
  const [st] = await db
    .select({ reportId: s.lafposDayEnds.reportId, autoValues: s.lafposDayEnds.autoValues })
    .from(s.lafposDayEnds)
    .where(and(eq(s.lafposDayEnds.date, date), eq(s.lafposDayEnds.branchId, branchId)));
  if (st?.reportId && st.autoValues) return "auto";
  const [rep] = await db
    .select({ id: s.cashReports.id })
    .from(s.cashReports)
    .where(and(eq(s.cashReports.date, date), eq(s.cashReports.branchId, branchId)))
    .limit(1);
  return rep ? "human" : "none";
}

/**
 * Bir günün otomasyonu: önce rapor, sonra e-posta. Rapor yazılamazsa (beklenmeyen hata) e-posta yine denenir. Hata
 * fırlatmaz: sonuçları döner (after() ve günlük iş için)
 */
export async function runLafposDayEnd(
  db: DB,
  date: string,
  now = new Date(),
  opts?: DayEndOptions,
  recheck?: StrongRecheckDeps,
): Promise<{
  date: string;
  report: AutoReportResult | "error";
  email: DayEndEmailResult | "error";
  pavo: PavoEmailResult | "error";
  photo: PhotoEmailResult | "error";
  staff: StaffEmailResult | "error";
  error?: string;
}> {
  let report: AutoReportResult | "error";
  let error: string | undefined;
  try {
    report = await writeAutoReport(db, date, now);
  } catch (e) {
    console.error("[lafpos] gün sonu raporu yazılamadı:", date, e);
    report = "error";
    error = e instanceof Error ? e.message : String(e);
  }
  // LafPOS'un yeni rakamları ucuz okunuşu "fark"a çevirdiyse e-postalardan ve zilden önce bir kez güçlü model bakar
  // (strongRecheckDayPhotos); düşerse kayıtlı karşılaştırma kalır
  if (report === "written" || report === "updated" || report === "unchanged") {
    try {
      if ((await strongRecheckDayPhotos(db, date, { deadlineAt: opts?.deadlineAt, ...recheck })) > 0) await refreshDayPhotoCheck(db, date, await lafposBranchId(db), now);
    } catch (e) {
      console.error("[lafpos] gün sonu fotoğrafının güçlü okuması:", date, e instanceof Error ? e.message : e);
    }
  }
  let email: DayEndEmailResult | "error";
  try {
    email = report === "skipped" ? "skipped" : await sendDayEndEmail(db, date, await reportStateOf(db, date, report === "error" ? "skipped" : report), now, opts);
  } catch (e) {
    console.error("[lafpos] gün sonu e-postası gönderilemedi:", date, e);
    email = "error";
    error = error ?? (e instanceof Error ? e.message : String(e));
  }
  // Pavo karşılaştırması: gün sonu e-postası gittiyse ve karşılaştırma onunla gitmediyse kısa e-posta
  let pavo: PavoEmailResult | "error";
  try {
    pavo = report === "skipped" || email === "error" ? "skipped" : await sendPavoEmail(db, date, now, opts);
  } catch (e) {
    console.error("[lafpos] Pavo e-postası gönderilemedi:", date, e);
    pavo = "error";
    error = error ?? (e instanceof Error ? e.message : String(e));
  }
  // Fotoğraf ↔ LafPOS farkı: gün sonu e-postasından sonra eklenen fotoğrafın karşılaştırması (gitmediyse)
  let photo: PhotoEmailResult | "error";
  try {
    photo = report === "skipped" || email === "error" ? "skipped" : await sendPhotoEmail(db, date, now, opts);
  } catch (e) {
    console.error("[lafpos] fotoğraf e-postası gönderilemedi:", date, e);
    photo = "error";
    error = error ?? (e instanceof Error ? e.message : String(e));
  }
  // Çalışanlar: yöneticinin e-postası daha önce gittiyse ("same", "busy") yalnız daha önce düşen kayıt yeniden denenir
  // (sabah işi). Öteki her durumda (gitti, alıcı yok, düştü) kendi kaydına göre gider: yöneticinin e-postası düşse de
  // çalışanlar "alındı"yı ya da "kasa sayılmadı"yı alır. Pavo beklenirken gitmez (yöneticininkiyle gider)
  let staff: StaffEmailResult | "error";
  try {
    staff = report === "skipped" || email === "waiting" ? "skipped" : await sendStaffDayEnd(db, date, now, { ...opts, retryOnly: email === "same" || email === "busy" });
  } catch (e) {
    console.error("[lafpos] çalışanların gün sonu e-postası:", date, e);
    staff = "error";
  }
  return { date, report, email, pavo, photo, staff, ...(error ? { error } : {}) };
}

/** Bu sunucu örneğinde canlı yoklamanın bekleyen gün sonuna son baktığı an (ms) */
let lastWaitPoll = 0;

/**
 * Canlı yoklama (/api/canli) bekleyen gün sonuna şimdi baksın mı: e-posta kurulu ve bu örnekte son bakıştan 5 dakika
 * geçti. Evetse anı hemen yazar (aynı anda gelen yoklamalar ikinci kez bakmaz). Birden çok örnek aynı anda bakarsa
 * gönderim yine bir kez (lafpos_day_ends.sending_at)
 */
export function claimLafposWaitPoll(nowMs: number = Date.now()): boolean {
  if (!isEmailConfigured() || nowMs - lastWaitPoll < WAIT_POLL_GAP_MS) return false;
  lastWaitPoll = nowMs;
  return true;
}

/**
 * Gönderilmemiş gün sonu e-postasının tamamlanması (canlı yoklama ve kontrol işi): dün ve bugünün LafPOS günü e-postası
 * gitmemiş hâldeyse (içerik özeti gönderilenden farklı, gönderimi düşmemiş, başka gönderim sürmüyor ya da işareti bayat) ve
 * geleli PAVO_WAIT_MS geçtiyse o günün otomasyonu çalışır. İki durum: Pavo'yu bekleyen gün (LafPOS günü yeniden göndermedi)
 * ve gönderimi yarıda kalan gün (işlev süresi doldu, `sending_at` kaldı). Düşen gönderim (email_error) sabah işine kalır:
 * her yoklamada yeniden denenmez. Bekleyen gün yoksa tek sorgu
 */
export async function finishWaitingDayEnds(db: DB, now = new Date(), opts?: SendOptions): Promise<Awaited<ReturnType<typeof runLafposDayEnd>>[]> {
  const today = businessDate(now);
  const [branchId, switchDay] = await Promise.all([lafposBranchId(db), loadLafposSwitchDay(db)]);
  const stale = new Date(now.getTime() - SENDING_STALE_MS);
  const rows = await db
    .select({ date: s.posDayReports.date, emailedHash: s.lafposDayEnds.emailedHash, emailError: s.lafposDayEnds.emailError, sendingAt: s.lafposDayEnds.sendingAt })
    .from(s.posDayReports)
    .leftJoin(s.lafposDayEnds, and(eq(s.lafposDayEnds.date, s.posDayReports.date), eq(s.lafposDayEnds.branchId, s.posDayReports.branchId)))
    .where(
      and(
        eq(s.posDayReports.branchId, branchId),
        gte(s.posDayReports.date, addDays(today, -1)),
        lte(s.posDayReports.date, today),
        lte(s.posDayReports.receivedAt, new Date(now.getTime() - PAVO_WAIT_MS)),
      ),
    )
    .orderBy(s.posDayReports.date);
  const out: Awaited<ReturnType<typeof runLafposDayEnd>>[] = [];
  for (const r of rows) {
    // Düşen gönderim (email_error) sabahki işe kalır: her yoklamada yeniden denenmez. Süren gönderime dokunulmaz
    if (r.emailError || !isLafposDay(r.date, switchDay) || (r.sendingAt && r.sendingAt > stale)) continue;
    const day = await loadStoredDay(db, r.date, branchId);
    if (!day || r.emailedHash === day.hash) continue;
    out.push(await runLafposDayEnd(db, r.date, now, opts));
  }
  return out;
}

/** settlePavoWait'in e-postayı göndermek için süresinin sonunda bıraktığı pay (rapor, Resend; ms) */
export const SETTLE_SEND_MARGIN_MS = 12_000;
/** settlePavoWait'in Pavo'nun sonucuna bakma aralığı (ms) */
const SETTLE_POLL_MS = 3_000;

/**
 * Pavo'yu bekleyen gün sonunun aynı istekte bitmesi (POST /api/pos/gun after()'ı, ilk gönderim "waiting" döndüyse): süre
 * içinde (deadlineAt − SETTLE_SEND_MARGIN_MS) birkaç saniyede bir Pavo'nun sonucu gelmiş mi bakılır. Gelirse ("arrived")
 * e-postayı o gönderimin after()'ı gönderir; e-posta başka yoldan gittiyse "done". Gelmezse e-posta Pavo'suz gider
 * (`noPavoWait`), sonuç sonra gelirse kısa Pavo e-postası. Böylece e-posta hiçbir gece sonraki bir tetiğe kalmaz
 */
export async function settlePavoWait(
  db: DB,
  date: string,
  o: { deadlineAt: number; pollMs?: number; nowMs?: () => number; sleep?: (ms: number) => Promise<void> },
): Promise<"arrived" | "done" | Awaited<ReturnType<typeof runLafposDayEnd>>> {
  const nowMs = o.nowMs ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const branchId = await lafposBranchId(db);
  const sendBy = o.deadlineAt - SETTLE_SEND_MARGIN_MS;
  const check = async () => {
    const [row] = await db
      .select({ bankPos: s.posDayReports.bankPos, emailedHash: s.lafposDayEnds.emailedHash, dayHash: s.lafposDayEnds.dayHash })
      .from(s.posDayReports)
      .leftJoin(s.lafposDayEnds, and(eq(s.lafposDayEnds.date, s.posDayReports.date), eq(s.lafposDayEnds.branchId, s.posDayReports.branchId)))
      .where(and(eq(s.posDayReports.date, date), eq(s.posDayReports.branchId, branchId)))
      .limit(1);
    if (row?.bankPos) return "arrived" as const;
    if (row?.emailedHash && row.emailedHash === row.dayHash) return "done" as const;
    return null;
  };
  for (;;) {
    const left = sendBy - nowMs();
    if (left <= 0) break;
    await sleep(Math.min(o.pollMs ?? SETTLE_POLL_MS, left));
    const seen = await check();
    if (seen) return seen;
  }
  // Gönderimin son anı gerçek saatle (Resend onu Date.now()'la karşılaştırır); `nowMs` yalnız testte sahte
  return runLafposDayEnd(db, date, new Date(nowMs()), { deadlineAt: Date.now() + (o.deadlineAt - nowMs()), noPavoWait: true });
}

/** Sabah işinde yeni güne başlamak için son ana (`deadlineAt`) en az bu kadar kalmalı (rapor ve bir e-posta denemesi; ms) */
export const CATCH_UP_MIN_MS = 2_000;

/**
 * Günlük iş: son DAY_END_LOOKBACK_DAYS gün içindeki (geçiş gününden önce değil) LafPOS gün sonlarını işler. Rapor
 * yazılmamış, düzeltilmiş ya da e-postası gitmemiş gün tamamlanır; işlenmiş gün hiçbir şey göndermez (idempotent).
 *
 * Sıra (catchUpOrder): adımın bütçesi kısa (sabah işinde yaklaşık 8 sn), eskiden yeniye giderken en yeni gün
 * yetişmeyebilirdi. İşi bekleyen günler (dayEndPending: rapor adımı bugünkü içerikle işlenmedi ya da e-postası gitmedi)
 * önce ve yeniden eskiye (dünkü gün ilk), işlenmiş günler sona. `deadlineAt` verildiyse son ana CATCH_UP_MIN_MS'den az
 * kalınca yeni güne başlanmaz: başlanamayan bekleyen günler `left`te (adım hata sayar, sonraki tetik dener), işlenmiş
 * günler sessizce kalır.
 *
 * Kasa zinciri: yeni gün önce yazıldığından raporunun devir denetimi (açılış ↔ önceki raporun devri, notta) ondan sonra
 * yazılan eski günü görmemiş olabilir. Bu çalışmada birden çok gün yazıldıysa (ya da düzeltildiyse) en eskisinden
 * sonrakilerin raporu eskiden yeniye bir kez daha hesaplanır (writeAutoReport); devir değişmediyse hiçbir şey yazılmaz,
 * ertesi çalışma da yazmaz
 */
export async function catchUpLafposDayEnds(
  db: DB,
  now = new Date(),
  opts?: SendOptions,
): Promise<{ status: "off" | "ok" | "error"; days: Awaited<ReturnType<typeof runLafposDayEnd>>[]; left: string[] }> {
  // LafPOS'un şubesinin geçiş günü ayarın kendisidir (branchSwitchDay)
  const [switchDay, branchId] = await Promise.all([loadLafposSwitchDay(db), lafposBranchId(db)]);
  if (switchDay === null) return { status: "off", days: [], left: [] };
  const today = businessDate(now);
  const lookback = addDays(today, -DAY_END_LOOKBACK_DAYS);
  const from = switchDay > lookback ? switchDay : lookback;
  const rows = await db
    .select({
      date: s.posDayReports.date,
      z: s.posDayReports.z,
      payments: s.posDayReports.payments,
      ikram: s.posDayReports.ikram,
      doneHash: s.lafposDayEnds.dayHash,
      emailedHash: s.lafposDayEnds.emailedHash,
      seen: s.lafposDayEnds.date,
    })
    .from(s.posDayReports)
    .leftJoin(s.lafposDayEnds, and(eq(s.lafposDayEnds.date, s.posDayReports.date), eq(s.lafposDayEnds.branchId, s.posDayReports.branchId)))
    .where(and(eq(s.posDayReports.branchId, branchId), gte(s.posDayReports.date, from), lte(s.posDayReports.date, today)));
  const order = catchUpOrder(rows.map((r) => ({ date: r.date, pending: dayEndPending(r.seen ? r : null, dayHash({ z: r.z, payments: r.payments, ikram: r.ikram })) })));
  const deadlineAt = opts?.deadlineAt;
  const timeLeft = () => deadlineAt === undefined || deadlineAt - Date.now() >= CATCH_UP_MIN_MS;
  const days: Awaited<ReturnType<typeof runLafposDayEnd>>[] = [];
  const left: string[] = [];
  for (const d of order.filter((x) => x.pending)) {
    if (timeLeft()) days.push(await runLafposDayEnd(db, d.date, now, opts));
    else left.push(d.date);
  }
  const wrote = days.filter((d) => d.report === "written" || d.report === "updated").map((d) => d.date).sort();
  for (const date of wrote.slice(1)) {
    if (!timeLeft()) break;
    try {
      await writeAutoReport(db, date, now);
    } catch (e) {
      console.error("[lafpos] gün sonu raporunun devri yeniden hesaplanamadı:", date, e);
    }
  }
  for (const d of order.filter((x) => !x.pending)) {
    if (!timeLeft()) break;
    days.push(await runLafposDayEnd(db, d.date, now, opts));
  }
  const failed = (d: (typeof days)[number]) =>
    d.report === "error" || d.email === "error" || d.email === "failed" || d.pavo === "error" || d.pavo === "failed" || d.photo === "error" || d.photo === "failed" || d.staff === "error" || d.staff === "failed";
  return { status: days.some(failed) || left.length ? "error" : "ok", days, left };
}
