import "server-only";

import { and, desc, eq, gte, isNull, lt, lte, or, sql } from "drizzle-orm";

import { businessDate, changesText, computeCash, revisionChanges, revisionDataOf } from "@/lib/cash-report";
import { cashDaySubject } from "@/lib/cash-requests";
import { cashOutNoteOf, cashOutsTotal, type CashOutKind } from "@/lib/cash-outs";
import { bankPosHash, renderPavoMail } from "@/lib/lafpos/bank-pos";
import { bankPosSchema, posDaySchema, posZSchema, type BankPos, type PosIkram, type PosPayment } from "@/lib/lafpos/day";
import { lafposDayDetail, type LafposDayDetail } from "@/lib/lafpos/gun-ayrinti";
import {
  AUTO_FIELDS,
  autoMissing,
  autoValuesOf,
  autoValuesOfReport,
  compareDays,
  dayHash,
  LAFPOS_AUTO_BY,
  mergeAuto,
  renderDayEnd,
  type AutoValues,
  type ReportState,
} from "@/lib/lafpos/gun-sonu";
import { branchSwitchDay, isLafposDay, LAFPOS_BRANCH_ID } from "@/lib/lafpos/switch";
import { emailKey } from "@/lib/notify-recipients";
import { DELETED_REPORT_DAYS } from "@/lib/photo-rules";
import { addDays, longDateTR } from "@/lib/reminders";
import { lockCashReport, lockLateDay, okcServerColumns, type CashTx } from "@/server/cash/report-store";
import { onNextReport, onReportSaved } from "@/server/closed-days";
import { loadCashSettings } from "@/server/data/cash-reports";
import { schema as s, type DB } from "@/server/db";
import { loadLafposSwitchDay } from "@/server/lafpos/status";
import { APP_URL } from "@/server/notify/digest-template";
import { activeDigestEmails, sendableRecipients } from "@/server/notify/recipients";
import { isEmailConfigured, resolveFrom, sendEmail, type SendOptions } from "@/server/notify/resend";
import { loadNotifySettings } from "@/server/notify/settings";
import { fetchTillOnlineRow } from "@/server/site-sales/sync";
import { supersede } from "@/server/staff-requests/core";

/*
 * LafPOS gün sonunun otomasyonu (docs/LAFPOS.md › Gün sonu otomasyonu): LafPOS'un şubesinin (Marina, LAFPOS_BRANCH_ID)
 * gün sonu geçiş gününden itibaren gelince
 *
 * 1. Kasa raporu kendiliğinden yazılır (rapor yoksa; LafPOS'ta sayım yoksa yazılmaz, uydurulmaz). Düzeltme gelince
 *    yalnız elle değişmemiş alanlar güncellenir. Personelin girdiği rapora hiç dokunulmaz.
 * 2. Gün sonu e-postası kasa raporu alıcılarına ve bildirim adreslerine gider (personel ve pasif hesap düşer), içerik
 *    başına bir kez; düzeltme "düzeltildi" notuyla bir kez daha. Başarısızsa hata kaydedilir, günlük iş yeniden dener.
 *
 * Tetik: `POST /api/pos/gun` yanıtı döndükten sonra (after(); kasa e-postayı beklemez) ve günlük iş (son 7 gün; geçiş günü
 * sonradan girildiyse eksik günler). Tuzla (ModPOS) bu yoldan hiç geçmez.
 */

/** Günlük işin geriye baktığı gün sayısı (geçiş günü sonradan girilse de en çok bu kadar eski gün işlenir) */
export const DAY_END_LOOKBACK_DAYS = 7;
/** Sürmekte olan gönderimin işareti bu kadar eskiyse bırakılmış sayılır */
const SENDING_STALE_MS = 5 * 60_000;

export type AutoReportResult = "written" | "updated" | "unchanged" | "human" | "no-count" | "old" | "deleted" | "skipped";
export type DayEndEmailResult = "sent" | "failed" | "off" | "same" | "busy" | "skipped";
/** Kısa Pavo e-postası: "included" karşılaştırma gün sonu e-postasıyla gitti; "waiting" gün sonu e-postası henüz gitmedi (onunla gider) */
export type PavoEmailResult = "sent" | "failed" | "off" | "same" | "busy" | "skipped" | "waiting";

interface StoredDay {
  z: ReturnType<typeof posZSchema.parse>;
  payments: PosPayment[];
  ikram: PosIkram[];
  /** Pavo karşılaştırması (gelmediyse ya da okunamıyorsa null); günün özetine (hash) girmez: geldiğinde gün sonu yinelenmez */
  bankPos: BankPos | null;
  /** Faz 2 ayrıntısı (yazarkasadan geçmeyen, iptaller, düzeltme; src/lib/lafpos/gun-ayrinti.ts); özete girmez */
  detail: LafposDayDetail;
  hash: string;
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
  const detail = lafposDayDetail({
    z: z.data,
    offDevice: row.offDevice ? sh.offDevice.parse(row.offDevice) : undefined,
    refunds: row.refunds ? sh.refunds.parse(row.refunds) : undefined,
    iptal: row.iptal ? sh.iptal.parse(row.iptal) : undefined,
    revision: row.revision ?? undefined,
    correction: row.correction ? sh.correction.parse(row.correction) : undefined,
    cashMoves: row.cashMoves ? sh.cashMoves.parse(row.cashMoves) : undefined,
  });
  return {
    z: z.data,
    payments: row.payments ?? [],
    ikram: row.ikram ?? [],
    bankPos: bankPos?.success ? bankPos.data : null,
    detail,
    hash: dayHash({ z: row.z, payments: row.payments, ikram: row.ikram }),
  };
}

/** Gün LafPOS'un şubesinin LafPOS günü mü (geçiş günü seçili ve gün ondan önce değil) */
export async function isCountedLafposDay(db: DB, date: string): Promise<boolean> {
  return isLafposDay(date, branchSwitchDay(await loadLafposSwitchDay(db), LAFPOS_BRANCH_ID));
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
 * değişmemiş alanlar düzeltmeyle güncellenir (önceki sürüm geçmişe); başka biri girdiyse dokunulmaz.
 */
export async function writeAutoReport(db: DB, date: string, now = new Date()): Promise<AutoReportResult> {
  const branchId = LAFPOS_BRANCH_ID;
  if (!(await isCountedLafposDay(db, date))) return "skipped";
  return db.transaction(async (tx) => {
    await lockLateDay(tx, date, branchId);
    const day = await loadStoredDay(tx, date, branchId);
    if (!day) return "skipped";
    const state = await ensureState(tx, date, branchId);
    const prev = await lockCashReport(tx, date, branchId);
    const missing = autoMissing(day.z);
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
    const next = autoValuesOf(date, day.z, { count: lines.length, total: cashOutsTotal(lines), note: cashOutNoteOf(lines) }, carry);
    const setState = (patch: Partial<typeof s.lafposDayEnds.$inferInsert>) =>
      tx
        .update(s.lafposDayEnds)
        .set({ dayHash: day.hash, missing, updatedAt: now, ...patch })
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
      const [row] = await tx
        .insert(s.cashReports)
        .values({
          date,
          branchId,
          ...values,
          cashDiff: computeCash({ ...values, bankPos: null, okcCard: null }).cashDiff,
          submittedBy: null,
          submittedByName: LAFPOS_AUTO_BY,
          countedBy: null,
          countedByName: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await onReportSaved(tx, date, now);
      await onNextReport(tx, row, now);
      await supersede(tx, { kinds: ["kasa-gec"], subject: cashDaySubject(date, branchId) }, "LafPOS gün sonundan rapor yazıldı", now, DELETED_REPORT_DAYS);
      await tx.insert(s.activityLog).values({ userName: LAFPOS_AUTO_BY, userId: null, action: "Kasa raporu (LafPOS otomatik)", detail: `${longDateTR(date)}: Z ${day.z.zNo}` });
      await setState({ reportId: row.id, autoValues: next });
      return "written";
    }

    if (state.reportId !== prev.id || !state.autoValues) {
      await setState({ autoValues: null, missing: [] });
      return "human";
    }
    const merged = mergeAuto(autoValuesOfReport(prev), state.autoValues as AutoValues, next);
    if (!merged.changed.length) {
      await setState({ autoValues: merged.auto });
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
    // Yazarkasa Z no'su değiştiyse sunucu sütunları (kümülatif, yazarkasa dışı) formun kaydındaki gibi yeniden hesaplanır
    if ((prev.okcZNo ?? null) !== (row.okcZNo ?? null)) {
      const server = await okcServerColumns(tx, row);
      if (server.okcCumTotal !== row.okcCumTotal || server.okcCumVat !== row.okcCumVat || server.okcOutside !== row.okcOutside) {
        [row] = await tx.update(s.cashReports).set(server).where(eq(s.cashReports.id, row.id)).returning();
      }
    }
    const changes = revisionChanges(revisionDataOf(prev), revisionDataOf(row));
    await tx.insert(s.activityLog).values({
      userName: LAFPOS_AUTO_BY,
      userId: null,
      action: "Kasa raporu güncellendi (LafPOS otomatik)",
      detail: `${longDateTR(date)}: ${changesText(changes)}${merged.kept.length ? ` · elle düzeltilen korundu: ${merged.kept.length} alan` : ""}`,
    });
    await setState({ autoValues: merged.auto });
    return "updated";
  });
}

/** Otomatik değerler → rapor sütunları (sayısal sütunlarda boş 0 değil: çağıran sayımı olmayan raporu yazmaz) */
function toColumns(v: AutoValues) {
  const num = (f: (typeof AUTO_FIELDS)[number]) => (typeof v[f] === "number" ? (v[f] as number) : 0);
  const opt = (f: (typeof AUTO_FIELDS)[number]) => (typeof v[f] === "number" ? (v[f] as number) : null);
  const text = (f: (typeof AUTO_FIELDS)[number]) => (typeof v[f] === "string" ? (v[f] as string) : null);
  return {
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

/** Gün sonu e-postasının alıcıları: kasa raporu alıcıları ve etkin bildirim adresleri (açıksa), personel ve pasif hesap düşer */
export async function dayEndRecipients(db: DB): Promise<string[]> {
  const [cash, notify] = await Promise.all([loadCashSettings(), loadNotifySettings()]);
  const list = [...(cash.emailEnabled ? cash.recipients : []), ...(notify.emailEnabled ? await activeDigestEmails(db) : [])];
  const seen = new Set<string>();
  const unique = list.filter((e) => (seen.has(emailKey(e)) ? false : (seen.add(emailKey(e)), true)));
  return (await sendableRecipients(db, unique)).to;
}

/**
 * Çalışanların kısa gün sonu e-postası (Kasa raporu ayarları › Çalışanlar): "gün sonu alındı", Z no ve fiş sayısı;
 * "tutarlar" açıksa ciro ve ödeme türleri. Rapor ayrıntısı, kasa farkı ve karaoke ödemesi gitmez.
 */
async function sendStaffDayEnd(date: string, branchName: string, z: { zNo: number; receipts: number; zTotal: number; cash: number; card: number; mealCard: number; other: number }, hash: string, from: string | null | undefined, opts?: SendOptions) {
  const cash = await loadCashSettings();
  if (!cash.staffRecipients?.length) return;
  const tlText = (v: number) => `${v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
  const rows: [string, string][] = [["Z no", String(z.zNo)], ["Fiş sayısı", String(z.receipts)]];
  if (cash.staffAmounts) {
    rows.push(["Toplam satış", tlText(z.zTotal)], ["Nakit", tlText(z.cash)], ["Kart", tlText(z.card)]);
    if (z.mealCard) rows.push(["Yemek kartı", tlText(z.mealCard)]);
    if (z.other) rows.push(["Diğer", tlText(z.other)]);
  }
  const subject = `${branchName} · gün sonu alındı · ${longDateTR(date)}`;
  const text = [`${branchName} gün sonu alındı (${longDateTR(date)}).`, "", ...rows.map(([k, v]) => `${k}: ${v}`), "", "Emeğiniz için teşekkürler."].join("\n");
  const html = `<!doctype html><html lang="tr"><body style="font-family:Inter,Arial,sans-serif;color:#171a26"><h2 style="margin:0 0 12px">${branchName} · gün sonu alındı</h2><p style="color:#5f6371;margin:0 0 12px">${longDateTR(date)}</p><table style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#5f6371">${k}</td><td style="padding:4px 0;font-weight:600">${v}</td></tr>`).join("")}</table><p style="margin-top:16px">Emeğiniz için teşekkürler.</p></body></html>`;
  await sendEmail({ from: resolveFrom(from), to: cash.staffRecipients!, subject, html, text, idempotencyKey: `lafpos-gun-calisan-${date}-${hash}` }, opts);
}

/**
 * Gün sonu e-postası (içerik başına bir kez). Aynı içerik daha önce gittiyse "same"; başka bir gönderim sürüyorsa "busy".
 * Başarısızsa hata kaydedilir; bir sonraki tetik (düzeltme ya da günlük iş) yeniden dener.
 */
export async function sendDayEndEmail(db: DB, date: string, report: ReportState, now = new Date(), opts?: SendOptions): Promise<DayEndEmailResult> {
  const branchId = LAFPOS_BRANCH_ID;
  const switchDay = branchSwitchDay(await loadLafposSwitchDay(db), branchId);
  if (!isLafposDay(date, switchDay)) return "skipped";
  const day = await loadStoredDay(db, date, branchId);
  if (!day) return "skipped";
  await db.insert(s.lafposDayEnds).values({ date, branchId }).onConflictDoNothing();
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
    .returning({ emailCount: s.lafposDayEnds.emailCount, missing: s.lafposDayEnds.missing, reportId: s.lafposDayEnds.reportId });
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
    const to = await dayEndRecipients(db);
    if (!to.length) {
      await finish({ emailError: "Alıcı yok: kasa raporu alıcıları ve bildirim adresleri boş ya da kapalı" });
      return "off";
    }
    if (!isEmailConfigured()) {
      await finish({ emailError: "E-posta kurulmamış (RESEND_API_KEY)" });
      return "failed";
    }
    const [branch] = await db.select({ name: s.branches.name }).from(s.branches).where(eq(s.branches.id, branchId)).limit(1);
    const days = compareDays(date);
    const [rep, yesterday, lastWeek, online] = await Promise.all([
      db.select().from(s.cashReports).where(and(eq(s.cashReports.date, date), eq(s.cashReports.branchId, branchId))).limit(1),
      dayTotal(db, days.yesterday, branchId, switchDay),
      dayTotal(db, days.lastWeek, branchId, switchDay),
      fetchTillOnlineRow(date, branchId),
    ]);
    const values = rep[0] ? autoValuesOfReport(rep[0]) : null;
    const msg = renderDayEnd({
      branchName: branch?.name ?? "Marina",
      date,
      z: day.z,
      payments: day.payments,
      ikram: day.ikram,
      values,
      missing: st.missing ?? [],
      report,
      corrected: st.emailCount > 0,
      yesterday: { date: days.yesterday, zTotal: yesterday },
      lastWeek: { date: days.lastWeek, zTotal: lastWeek },
      online: online ? online.online : null,
      link: `${APP_URL}/panel/kasa?gun=${date}&sube=${encodeURIComponent(branchId)}`,
      bankPos: day.bankPos,
      detail: day.detail,
    });
    const notify = await loadNotifySettings();
    const res = await sendEmail({ from: resolveFrom(notify.from), to, ...msg, idempotencyKey: `lafpos-gun-${branchId}-${date}-${day.hash}` }, opts);
    await db
      .insert(s.notificationLog)
      .values({ key: `lafpos-gun:${branchId}:${date}`, channel: "email", subject: msg.subject, recipients: to.join(", "), ok: res.ok, error: res.ok ? null : res.error })
      .onConflictDoUpdate({ target: s.notificationLog.key, set: { subject: msg.subject, ok: res.ok, error: res.ok ? null : res.error, sentAt: new Date() } });
    if (!res.ok) {
      await finish({ emailError: res.error });
      return "failed";
    }
    // Pavo karşılaştırması bu e-postayla gittiyse kısa Pavo e-postası ayrıca gitmez
    await finish({ emailedHash: day.hash, emailCount: st.emailCount + 1, emailedAt: new Date(), emailError: null, ...(day.bankPos ? { pavoEmailedHash: bankPosHash(day.bankPos) } : {}) });
    // Çalışanlara kısa e-posta (yönetim e-postasından sonra, içerik başına bir kez; düşmesi yönetim e-postasını etkilemez)
    await sendStaffDayEnd(date, branch?.name ?? "Marina", day.z, day.hash, notify.from, opts).catch(() => undefined);
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
  const branchId = LAFPOS_BRANCH_ID;
  if (!isLafposDay(date, branchSwitchDay(await loadLafposSwitchDay(db), branchId))) return "skipped";
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
    const to = await dayEndRecipients(db);
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

/** Raporun e-postadaki durumu: otomatik yazımın sonucundan ve kayıttan */
async function reportStateOf(db: DB, date: string, auto: AutoReportResult): Promise<ReportState> {
  if (auto === "written") return "auto";
  if (auto === "updated") return "updated";
  if (auto === "human") return "human";
  if (auto === "no-count") return "no-count";
  const [st] = await db
    .select({ reportId: s.lafposDayEnds.reportId, autoValues: s.lafposDayEnds.autoValues })
    .from(s.lafposDayEnds)
    .where(and(eq(s.lafposDayEnds.date, date), eq(s.lafposDayEnds.branchId, LAFPOS_BRANCH_ID)));
  if (st?.reportId && st.autoValues) return "auto";
  const [rep] = await db
    .select({ id: s.cashReports.id })
    .from(s.cashReports)
    .where(and(eq(s.cashReports.date, date), eq(s.cashReports.branchId, LAFPOS_BRANCH_ID)))
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
  opts?: SendOptions,
): Promise<{ date: string; report: AutoReportResult | "error"; email: DayEndEmailResult | "error"; pavo: PavoEmailResult | "error"; error?: string }> {
  let report: AutoReportResult | "error";
  let error: string | undefined;
  try {
    report = await writeAutoReport(db, date, now);
  } catch (e) {
    console.error("[lafpos] gün sonu raporu yazılamadı:", date, e);
    report = "error";
    error = e instanceof Error ? e.message : String(e);
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
  return { date, report, email, pavo, ...(error ? { error } : {}) };
}

/**
 * Günlük iş: son DAY_END_LOOKBACK_DAYS gün içindeki (geçiş gününden önce değil) LafPOS gün sonlarını işler. Rapor
 * yazılmamış, düzeltilmiş ya da e-postası gitmemiş gün tamamlanır; işlenmiş gün hiçbir şey göndermez (idempotent).
 */
export async function catchUpLafposDayEnds(db: DB, now = new Date(), opts?: SendOptions): Promise<{ status: "off" | "ok" | "error"; days: Awaited<ReturnType<typeof runLafposDayEnd>>[] }> {
  const switchDay = branchSwitchDay(await loadLafposSwitchDay(db), LAFPOS_BRANCH_ID);
  if (switchDay === null) return { status: "off", days: [] };
  const today = businessDate(now);
  const lookback = addDays(today, -DAY_END_LOOKBACK_DAYS);
  const from = switchDay > lookback ? switchDay : lookback;
  const rows = await db
    .select({ date: s.posDayReports.date })
    .from(s.posDayReports)
    .where(and(eq(s.posDayReports.branchId, LAFPOS_BRANCH_ID), gte(s.posDayReports.date, from), lte(s.posDayReports.date, today)))
    .orderBy(s.posDayReports.date);
  const days = [];
  for (const r of rows) days.push(await runLafposDayEnd(db, r.date, now, opts));
  return { status: days.some((d) => d.report === "error" || d.email === "error" || d.email === "failed" || d.pavo === "error" || d.pavo === "failed") ? "error" : "ok", days };
}
