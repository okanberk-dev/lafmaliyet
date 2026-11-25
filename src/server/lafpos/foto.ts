import "server-only";

import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { businessDate, LATE_REPORT_DAYS, revisionDataOf } from "@/lib/cash-report";
import { bankPosSchema, okcSchema, posZSchema, type BankPos, type PosDayZ, type PosOkc } from "@/lib/lafpos/day";
import { lafposPhotoCheck, lafposPhotoDone, lafposPhotoNeed, staffPhotoLine, type LafposPhotoCheck, type LafposPhotoNeed, type LafposPhotoRead } from "@/lib/lafpos/foto";
import { autoMissing } from "@/lib/lafpos/gun-sonu";
import { isLafposDay, LAFPOS_BRANCH_ID, branchSwitchDay } from "@/lib/lafpos/switch";
import { OCR_MODEL, readingSourceOf } from "@/lib/photo-read/models";
import { KasaOkcRaw } from "@/lib/photo-read/schemas";
import { linkedUntil, MAX_OKC_PHOTOS, MAX_REPORT_PHOTOS, OKC_PHOTOS_TEXT } from "@/lib/photo-rules";
import { addDays, longDateTR, todayTR } from "@/lib/reminders";
import { lockCashReport, lockLateDay, okcServerColumns, type CashActor, type CashReportRow, type CashTx } from "@/server/cash/report-store";
import { schema as s, type DB } from "@/server/db";
import { loadLafposSwitchDay } from "@/server/lafpos/status";
import { assertNotHeld } from "@/server/staff-requests/core";
import { getPhoto, keepPhoto, linkable } from "@/server/storage/photos";
import { UserError } from "@/server/user-error";

/*
 * LafPOS gününün gün sonu fotoğrafı (sahibin isteği, 24 Kasım 2026: "sadece gün sonu ladmine personel foto atsın";
 * docs/LAFPOS.md › Gün sonu otomasyonu; kurallar src/lib/lafpos/foto.ts). Kasa raporu LafPOS'tan kendiliğinden yazılır;
 * personel yalnız Pavo'nun gün sonu fişinin (mali Z basan cihazda yazarkasa Z'sinin de) fotoğrafını ekler. Fotoğraf rapora
 * bağlanır: kaydetme yok, sürüm yok, sayan değişmez, onay gerekmez (rakam değişmiyor). Rapor henüz yoksa (LafPOS'ta sayım
 * yok) fotoğraf günün kaydında bekler, rapor yazılınca bağlanır (gun-sonu.ts writeAutoReport). Okunuşu LafPOS'un
 * rakamlarıyla karşılaştırılır (lafpos_day_ends.photo_check); fark yöneticinin uyarısıdır.
 */

type Reader = DB | CashTx;

/** Günün LafPOS cihaz verisi (Z, Pavo sonucu, yazarkasa belgeleri); gün gelmediyse null */
export async function lafposDayDevice(db: Reader, date: string, branchId: string): Promise<{ z: PosDayZ; bankPos: BankPos | null; okc: PosOkc | null } | null> {
  const [row] = await db
    .select({ z: s.posDayReports.z, bankPos: s.posDayReports.bankPos, okc: s.posDayReports.okc })
    .from(s.posDayReports)
    .where(and(eq(s.posDayReports.date, date), eq(s.posDayReports.branchId, branchId)))
    .limit(1);
  if (!row) return null;
  const z = posZSchema.safeParse(row.z);
  if (!z.success) return null;
  const bank = row.bankPos ? bankPosSchema.safeParse(row.bankPos) : null;
  const okc = row.okc ? okcSchema.safeParse(row.okc) : null;
  return { z: z.data, bankPos: bank?.success ? bank.data : null, okc: okc?.success ? okc.data : null };
}

/**
 * Şubenin yazarkasa cihazı (LafPOS'un son gönderdiği `okc`'den: sağlayıcı ve ayrı mali Z basıyor mu); gün sonu henüz
 * gelmediyse fotoğrafın metni için (Pavo ayrı mali Z basmaz). Hiç gelmediyse null
 */
export async function lafposOkcDeviceOf(db: Reader, branchId: string): Promise<{ provider: "pavo" | "tokenx"; zReport: boolean } | null> {
  const rows = await db
    .select({ okc: s.posDayReports.okc })
    .from(s.posDayReports)
    .where(and(eq(s.posDayReports.branchId, branchId), isNotNull(s.posDayReports.okc)))
    .orderBy(desc(s.posDayReports.date))
    .limit(1);
  const okc = rows[0]?.okc ? okcSchema.safeParse(rows[0].okc) : null;
  return okc?.success ? { provider: okc.data.provider, zReport: okc.data.zReport } : null;
}

/** Rapora bağlı gün sonu fotoğrafları (yazarkasa bölümü: kasa-okc, eski kasa-pos), eklenme sırasıyla */
export async function dayPhotoIds(db: Reader, reportId: number): Promise<number[]> {
  const rows = await db
    .select({ id: s.cashReportPhotos.photoId })
    .from(s.cashReportPhotos)
    .where(and(eq(s.cashReportPhotos.reportId, reportId), inArray(s.cashReportPhotos.kind, ["kasa-okc", "kasa-pos"])))
    .orderBy(s.cashReportPhotos.photoId);
  return rows.map((r) => r.id);
}

/**
 * Fotoğrafların okunuşu: son başarılı yapay zekâ okunuşu (ai_calls; güçlü model ucuzdan sonra okuduysa onunki), yoksa son
 * başarılı kod okunuşu (OCR_MODEL), yoksa son hatası; hiç okunmadıysa ikisi de boş. Kaynak ve model okunuşla birlikte
 */
export async function photoReads(db: Reader, ids: readonly number[]): Promise<LafposPhotoRead[]> {
  if (!ids.length) return [];
  const calls = await db
    .select({ photoId: s.aiCalls.photoId, model: s.aiCalls.model, status: s.aiCalls.status, result: s.aiCalls.result, error: s.aiCalls.error })
    .from(s.aiCalls)
    .where(and(inArray(s.aiCalls.photoId, [...ids]), inArray(s.aiCalls.feature, ["kasa-okc", "kasa-pos"])))
    .orderBy(desc(s.aiCalls.at), desc(s.aiCalls.id));
  return ids.map((id) => {
    const mine = calls.filter((c) => c.photoId === id);
    const ok = mine.find((c) => c.status === "ok" && c.model !== OCR_MODEL) ?? mine.find((c) => c.status === "ok");
    if (ok) {
      const raw = KasaOkcRaw.safeParse(ok.result);
      return { photoId: id, raw: raw.success ? raw.data : null, error: raw.success ? null : "okunamadı", source: readingSourceOf(ok.model), model: ok.model };
    }
    const failed = mine.find((c) => c.status !== "running");
    return { photoId: id, raw: null, error: failed ? (failed.error ?? "okunamadı") : null, ...(failed ? { source: readingSourceOf(failed.model), model: failed.model } : {}) };
  });
}

/**
 * Raporun fotoğraf(lar)ını LafPOS'la karşılaştırır; fotoğraf yoksa null. `device.z` günün Z'si: LafPOS'un yazarkasa Z
 * no'su (`okcZNo`) yoksa fotoğrafta okunan Z no `zNoFromPhoto` olur (applyPhotoZNo yazar)
 */
export async function photoCheckOf(
  db: Reader,
  report: CashReportRow,
  device: { bankPos: BankPos | null; okc: PosOkc | null; z?: Pick<PosDayZ, "okcZNo"> | null },
  now = new Date(),
): Promise<LafposPhotoCheck | null> {
  const ids = await dayPhotoIds(db, report.id);
  if (!ids.length) return null;
  return lafposPhotoCheck(
    {
      day: report.date,
      reads: await photoReads(db, ids),
      bankPos: device.bankPos,
      okc: device.okc,
      report: {
        bankPos: report.bankPos,
        okcZNo: report.okcZNo ?? null,
        okcTotal: report.okcTotal ?? null,
        okcCash: report.okcCash ?? null,
        okcCard: report.okcCard ?? null,
        okcMealCard: report.okcMealCard ?? null,
        okcOther: report.okcOther ?? null,
        okcVat: report.okcVat ?? null,
        ...(device.z ? { lafposZNo: device.z.okcZNo ?? null } : {}),
      },
    },
    now,
  );
}

/**
 * Fotoğrafta (Pavo'nun detaylı Z'si) okunan Z no'yu raporun boş yazarkasa Z no'suna yazar: yalnız LafPOS göndermediyse
 * (`check.zNoFromPhoto`: fotoğraf uyumlu, Z'nin günü doğrulanmış), raporda Z no yoksa ve günün son otomatik değerinde de
 * yoksa (fotoğraftan yazılanı yönetici Düzenle'yle sildiyse geri yazılmaz). Sürüm yok (boş alan doluyor, rakam değişmiyor); günün son otomatik
 * değerine de yazılır: LafPOS sonradan Z no gönderirse onunki geçer (elle düzeltilmiş sayılmaz). Sunucu sütunları
 * (kümülatif) yeniden hesaplanır, işlem geçmişine düşer. Çağıran durum satırını yazdıktan sonra çağırır
 */
export async function applyPhotoZNo(tx: CashTx, row: CashReportRow, check: LafposPhotoCheck | null, now = new Date()): Promise<CashReportRow> {
  const no = check?.zNoFromPhoto ?? null;
  if (!no || row.okcZNo) return row;
  const [state] = await tx
    .select({ autoValues: s.lafposDayEnds.autoValues })
    .from(s.lafposDayEnds)
    .where(and(eq(s.lafposDayEnds.date, row.date), eq(s.lafposDayEnds.branchId, row.branchId)))
    .limit(1);
  // Otomatik değer doluyken rapor boşsa biri sildi (elle düzeltilen alan): dokunulmaz
  if (!state?.autoValues || state.autoValues.okcZNo) return row;
  const [updated] = await tx.update(s.cashReports).set({ okcZNo: no }).where(eq(s.cashReports.id, row.id)).returning();
  await tx
    .update(s.lafposDayEnds)
    .set({ autoValues: { ...state.autoValues, okcZNo: no }, updatedAt: now })
    .where(and(eq(s.lafposDayEnds.date, row.date), eq(s.lafposDayEnds.branchId, row.branchId)));
  await tx.insert(s.activityLog).values({ userName: "LafPOS (otomatik)", userId: null, action: "Yazarkasa Z no fotoğraftan yazıldı (LafPOS günü)", detail: `${longDateTR(row.date)}: Z no ${no}` });
  return refreshServerColumns(tx, updated);
}

/**
 * Rapor LafPOS'un otomatik raporu mu (lafpos_day_ends.report_id bu rapor, otomatik değerler kayıtlı): personelden gizleme
 * kuralının fotoğraf durumuna bağlı olmayan, raporun kendi kaydından okunan yedeği (staffLafposAutoOf)
 */
export async function lafposAutoReport(db: Reader, reportId: number): Promise<boolean> {
  const [row] = await db
    .select({ autoValues: s.lafposDayEnds.autoValues })
    .from(s.lafposDayEnds)
    .where(eq(s.lafposDayEnds.reportId, reportId))
    .limit(1);
  return Boolean(row?.autoValues);
}

/** Fotoğrafı rapora bağlar (gün sonu fotoğrafı bölümü; rapor başına en çok 6, yazarkasa bölümüne en çok 3) */
async function linkToReport(tx: CashTx, report: CashReportRow, photoId: number, kind: string, now: Date): Promise<void> {
  const linked = await tx.select({ id: s.cashReportPhotos.photoId, kind: s.cashReportPhotos.kind }).from(s.cashReportPhotos).where(eq(s.cashReportPhotos.reportId, report.id));
  if (linked.some((l) => l.id === photoId)) return;
  if (linked.length >= MAX_REPORT_PHOTOS) throw new UserError(`Bir rapora en çok ${MAX_REPORT_PHOTOS} fotoğraf eklenir`);
  if (linked.filter((l) => l.kind === "kasa-okc" || l.kind === "kasa-pos").length >= MAX_OKC_PHOTOS) throw new UserError(OKC_PHOTOS_TEXT);
  await tx.insert(s.cashReportPhotos).values({ reportId: report.id, photoId, kind: kind === "kasa-pos" ? "kasa-pos" : "kasa-okc" });
  await keepPhoto(photoId, linkedUntil("kasa-okc", report.date, todayTR(now)), tx);
}

/**
 * Bekleyen fotoğrafları (rapor yokken eklenenler) yeni yazılan otomatik rapora bağlar (writeAutoReport, aynı işlemde);
 * yazarkasa fotoğrafı bağlandıysa sunucu sütunları yeniden hesaplanır. Bağlananların sayısı
 */
export async function linkPendingPhotos(tx: CashTx, report: CashReportRow, pending: readonly number[], now = new Date()): Promise<{ row: CashReportRow; linked: number }> {
  let linked = 0;
  for (const id of pending) {
    const p = await getPhoto(id, tx);
    if (!p || (p.kind !== "kasa-okc" && p.kind !== "kasa-pos")) continue;
    await linkToReport(tx, report, id, p.kind, now);
    linked++;
  }
  return { row: linked ? await refreshServerColumns(tx, report) : report, linked };
}

/** Yazarkasa fotoğrafı bağlanınca sunucu sütunları (kümülatif, yazarkasa dışı) formun kaydındaki gibi yeniden */
async function refreshServerColumns(tx: CashTx, row: CashReportRow): Promise<CashReportRow> {
  const server = await okcServerColumns(tx, row);
  if (server.okcCumTotal === row.okcCumTotal && server.okcCumVat === row.okcCumVat && server.okcOutside === row.okcOutside) return row;
  const [next] = await tx.update(s.cashReports).set(server).where(eq(s.cashReports.id, row.id)).returning();
  return next;
}

/** Personelin fotoğraf ekleyebildiği LafPOS günü mü: LafPOS'un şubesi, geçiş gününden itibaren, bugünden en çok 14 gün geri */
export async function lafposPhotoDayOpen(db: Reader, date: string, branchId: string, role: "admin" | "staff", now = new Date()): Promise<boolean> {
  if (branchId !== LAFPOS_BRANCH_ID) return false;
  const today = businessDate(now);
  if (date > today || (role !== "admin" && date < addDays(today, -LATE_REPORT_DAYS))) return false;
  if (!isLafposDay(date, branchSwitchDay(await loadLafposSwitchDay(db as DB), branchId))) return false;
  const [day] = await db
    .select({ date: s.posDayReports.date })
    .from(s.posDayReports)
    .where(and(eq(s.posDayReports.date, date), eq(s.posDayReports.branchId, branchId)))
    .limit(1);
  return Boolean(day);
}

export interface AttachResult {
  /** "linked" rapora bağlandı; "pending" rapor yok (LafPOS'ta sayım yok), yazılınca bağlanır */
  status: "linked" | "pending";
  attached: number;
  need: LafposPhotoNeed;
  /** Personelin satırı (staffPhotoLine) */
  line: string;
}

/**
 * Gün sonu fotoğrafını LafPOS gününün otomatik raporuna bağlar (personel ve yönetici). Kaydetme yolu (saveCashReport)
 * kullanılmaz: raporun sürümü, gönderen ve sayan değişmez, kapı (staffCashGate) yoktur (rakam değişmiyor). Personel yalnız
 * kendi yüklediği fotoğrafı, günden 14 gün içinde ekler. Rapor elle girildiyse bu yol kapalıdır (formun Düzenle'si).
 * Rapor yoksa (sayım yok) fotoğraf günün kaydında bekler. İşlem geçmişine yazılır; eksikler ve karşılaştırma yenilenir.
 */
export async function attachLafposDayPhotoCore(db: DB, me: CashActor, input: { date: string; branchId: string; photoId: number }, now = new Date()): Promise<AttachResult> {
  const { date, branchId, photoId } = input;
  if (!(await lafposPhotoDayOpen(db, date, branchId, me.role, now))) {
    throw new UserError(me.role === "admin" ? "Bu gün LafPOS'un gün sonu gelmiş bir LafPOS günü değil" : "Bu güne gün sonu fotoğrafı eklenemez (LafPOS'un gün sonu yok ya da 14 günden eski)");
  }
  return db.transaction(async (tx) => {
    await lockLateDay(tx, date, branchId);
    const device = await lafposDayDevice(tx, date, branchId);
    if (!device) throw new UserError("LafPOS'un bu günün gün sonu gelmedi");
    await tx.insert(s.lafposDayEnds).values({ date, branchId }).onConflictDoNothing();
    const [state] = await tx
      .select()
      .from(s.lafposDayEnds)
      .where(and(eq(s.lafposDayEnds.date, date), eq(s.lafposDayEnds.branchId, branchId)))
      .for("update")
      .limit(1);
    const p = await getPhoto(photoId, tx);
    if (!p || (p.kind !== "kasa-okc" && p.kind !== "kasa-pos") || (me.role !== "admin" && p.createdBy !== me.id)) throw new UserError("Fotoğraf bulunamadı ya da süresi doldu; yeniden çekin");
    const report = await lockCashReport(tx, date, branchId);
    if (report && (state.reportId !== report.id || !state.autoValues)) throw new UserError("Bu günün raporu elle girildi; fotoğrafı raporun Düzenle'sinden ekleyin");
    const already = report ? (await dayPhotoIds(tx, report.id)).includes(photoId) : state.pendingPhotos.includes(photoId);
    if (!already) {
      if (!linkable(p, now)) throw new UserError("Fotoğraf bulunamadı ya da süresi doldu; yeniden çekin");
      // Onay bekleyen bir isteğin (geç rapor, kasadan çıkan) fotoğrafı buraya bağlanmaz
      await assertNotHeld(tx, photoId);
    }
    const need = lafposPhotoNeed(device);
    let attached: number;
    let check: LafposPhotoCheck | null = null;
    let pending = state.pendingPhotos;
    if (report) {
      if (!already) await linkToReport(tx, report, photoId, p.kind, now);
      const row = already ? report : await refreshServerColumns(tx, report);
      attached = (await dayPhotoIds(tx, report.id)).length;
      check = await photoCheckOf(tx, row, device, now);
      // LafPOS Z no göndermediyse fotoğrafta okunan Z no raporun boş alanına (yöneticiye "fotoğraftan okundu")
      await applyPhotoZNo(tx, row, check, now);
    } else {
      if (!already) {
        if (pending.length >= MAX_OKC_PHOTOS) throw new UserError(OKC_PHOTOS_TEXT);
        pending = [...pending, photoId];
        await keepPhoto(photoId, linkedUntil("kasa-okc", date, todayTR(now)), tx);
      }
      attached = pending.length;
    }
    const missing = autoMissing(device.z, device, { attached, check });
    await tx
      .update(s.lafposDayEnds)
      .set({ missing: report ? missing : missing.filter((m) => m !== "photo"), photoCheck: check, pendingPhotos: pending, updatedAt: now })
      .where(and(eq(s.lafposDayEnds.date, date), eq(s.lafposDayEnds.branchId, branchId)));
    if (!already) {
      await tx.insert(s.activityLog).values({
        userName: me.name,
        userId: me.id,
        action: "Gün sonu fotoğrafı (LafPOS günü)",
        detail: `${longDateTR(date)}: ${report ? "rapora bağlandı" : "rapor yazılınca bağlanacak (LafPOS'ta sayım yok)"}`,
      });
    }
    return { status: report ? "linked" : "pending", attached, need, line: staffPhotoLine(need, attached, check) };
  });
}

/**
 * Otomatik raporun fotoğraf karşılaştırmasını kayıtlı okunuşlarla yeniden kurar (güçlü modelin sonradan bakışından sonra,
 * gun-sonu.ts runLafposDayEnd): karşılaştırma, eksikler ve fotoğraftan Z no. Otomatik rapor yoksa null
 */
export async function refreshDayPhotoCheck(db: DB, date: string, branchId: string, now = new Date()): Promise<LafposPhotoCheck | null> {
  return db.transaction(async (tx) => {
    const device = await lafposDayDevice(tx, date, branchId);
    const report = await lockCashReport(tx, date, branchId);
    const [state] = await tx
      .select()
      .from(s.lafposDayEnds)
      .where(and(eq(s.lafposDayEnds.date, date), eq(s.lafposDayEnds.branchId, branchId)))
      .for("update")
      .limit(1);
    if (!device || !report || !state || state.reportId !== report.id || !state.autoValues) return null;
    const check = await photoCheckOf(tx, report, device, now);
    const attached = (await dayPhotoIds(tx, report.id)).length;
    await tx
      .update(s.lafposDayEnds)
      .set({ photoCheck: check, missing: autoMissing(device.z, device, { attached, check }), updatedAt: now })
      .where(and(eq(s.lafposDayEnds.date, date), eq(s.lafposDayEnds.branchId, branchId)));
    await applyPhotoZNo(tx, report, check, now);
    return check;
  });
}

/** Sayfanın gün sonu fotoğrafı bölümü: istenen, eklenen (bağlı ya da bekleyen) ve karşılaştırma (yalnız yöneticiye) */
export interface LafposPhotoState {
  /** Günün otomatik raporu var mı (yoksa ve gün sonu geldiyse fotoğraf bekler) */
  auto: boolean;
  need: LafposPhotoNeed;
  attached: number;
  pending: number;
  line: string;
  done: boolean;
  /** Yalnız yönetici */
  check: LafposPhotoCheck | null;
}

/**
 * Günün gün sonu fotoğrafı durumu (Kasa sayfası, Bugün): LafPOS günü değilse ya da gün sonu gelmediyse ya da rapor elle
 * girildiyse null (eski yol). `role` personel ise karşılaştırma dönmez
 */
export async function lafposPhotoState(db: DB, date: string, branchId: string, role: "admin" | "staff"): Promise<LafposPhotoState | null> {
  if (branchId !== LAFPOS_BRANCH_ID) return null;
  const device = await lafposDayDevice(db, date, branchId);
  if (!device) return null;
  if (!isLafposDay(date, branchSwitchDay(await loadLafposSwitchDay(db), branchId))) return null;
  const [[state], [report]] = await Promise.all([
    db
      .select()
      .from(s.lafposDayEnds)
      .where(and(eq(s.lafposDayEnds.date, date), eq(s.lafposDayEnds.branchId, branchId)))
      .limit(1),
    db
      .select({ id: s.cashReports.id })
      .from(s.cashReports)
      .where(and(eq(s.cashReports.date, date), eq(s.cashReports.branchId, branchId)))
      .limit(1),
  ]);
  const auto = Boolean(report && state?.reportId === report.id && state.autoValues);
  // Elle girilmiş rapor: eski yol (form)
  if (report && !auto) return null;
  const need = lafposPhotoNeed(device);
  const pending = state?.pendingPhotos.length ?? 0;
  const attached = report ? (await dayPhotoIds(db, report.id)).length : pending;
  const check = state?.photoCheck ?? null;
  const done = lafposPhotoDone(need, attached, check);
  return { auto, need, attached, pending, line: staffPhotoLine(need, attached, check), done, check: role === "admin" ? check : null };
}

/**
 * Yöneticinin "Banka POS'a yaz"ı: Pavo'nun gün sonu alınamadığı (Banka POS boş) günde fotoğrafta okunan toplamı raporun
 * Banka POS'una yazar. Yalnız otomatik raporda ve alan boşken; önceki sürüm geçmişe, gönderen yönetici olur (elle düzeltilen
 * alan: sonraki otomatik değer ezmez). Sayan değişmez. Karşılaştırma ve eksikler yenilenir
 */
export async function setLafposBankPosCore(db: DB, me: CashActor, input: { date: string; branchId: string; amount: number }, now = new Date()): Promise<void> {
  if (me.role !== "admin") throw new UserError("Banka POS'u yalnız yönetici yazar");
  const { date, branchId, amount } = input;
  await db.transaction(async (tx) => {
    await lockLateDay(tx, date, branchId);
    const device = await lafposDayDevice(tx, date, branchId);
    const report = await lockCashReport(tx, date, branchId);
    const [state] = await tx
      .select()
      .from(s.lafposDayEnds)
      .where(and(eq(s.lafposDayEnds.date, date), eq(s.lafposDayEnds.branchId, branchId)))
      .for("update")
      .limit(1);
    if (!device || !report || !state || state.reportId !== report.id || !state.autoValues) throw new UserError("Bu günün LafPOS'tan yazılmış raporu yok");
    if (report.bankPos !== null) throw new UserError("Banka POS zaten yazılı; değiştirmek için raporu Düzenle'yle açın");
    await tx.insert(s.cashReportRevisions).values({
      reportId: report.id,
      date: report.date,
      revision: report.revision,
      data: revisionDataOf(report),
      submittedBy: report.submittedBy,
      submittedByName: report.submittedByName,
      submittedAt: report.updatedAt,
    });
    const [row] = await tx
      .update(s.cashReports)
      .set({ bankPos: Math.round(amount * 100) / 100, revision: report.revision + 1, submittedBy: me.id, submittedByName: me.name, updatedAt: now })
      .where(eq(s.cashReports.id, report.id))
      .returning();
    const check = await photoCheckOf(tx, row, device, now);
    const attached = (await dayPhotoIds(tx, row.id)).length;
    await tx
      .update(s.lafposDayEnds)
      .set({ photoCheck: check, missing: autoMissing(device.z, device, { attached, check }), updatedAt: now })
      .where(and(eq(s.lafposDayEnds.date, date), eq(s.lafposDayEnds.branchId, branchId)));
    await applyPhotoZNo(tx, row, check, now);
    await tx.insert(s.activityLog).values({ userName: me.name, userId: me.id, action: "Banka POS fotoğraftan yazıldı (LafPOS günü)", detail: `${longDateTR(date)}: ${amount.toLocaleString("tr-TR")} ₺` });
  });
}

/**
 * Bugün ekranı (personel): otomatik LafPOS raporlarının fotoğraf durumu, rapor kimliğine göre ("pending" istenen gün sonu
 * fotoğrafı eklenmedi ya da okunamadı; "done"). Elle girilen rapor listede yok
 */
export async function lafposPhotoMarks(db: DB, reportIds: readonly number[]): Promise<Map<number, "pending" | "done">> {
  const out = new Map<number, "pending" | "done">();
  if (!reportIds.length) return out;
  const rows = await db
    .select({ reportId: s.lafposDayEnds.reportId, missing: s.lafposDayEnds.missing, autoValues: s.lafposDayEnds.autoValues })
    .from(s.lafposDayEnds)
    .where(inArray(s.lafposDayEnds.reportId, [...reportIds]));
  for (const r of rows) if (r.reportId !== null && r.autoValues) out.set(r.reportId, r.missing.includes("photo") ? "pending" : "done");
  return out;
}

/**
 * Yöneticinin ay satırının rozeti (Kasa › günden güne): otomatik LafPOS raporunda fotoğraf ↔ LafPOS farklı ("fark"),
 * fotoğraf bekleniyor ("bekliyor"), okunamadı ("okunamadi") ya da kodla okunup güvenle seçilmedi ("bakin": yönetici
 * baksın); tamam ve elle girilen raporda yok
 */
export async function lafposPhotoBadges(db: DB, reportIds: readonly number[]): Promise<Map<number, "fark" | "bekliyor" | "okunamadi" | "bakin">> {
  const out = new Map<number, "fark" | "bekliyor" | "okunamadi" | "bakin">();
  if (!reportIds.length) return out;
  const rows = await db
    .select({ reportId: s.lafposDayEnds.reportId, missing: s.lafposDayEnds.missing, autoValues: s.lafposDayEnds.autoValues, photoCheck: s.lafposDayEnds.photoCheck })
    .from(s.lafposDayEnds)
    .where(inArray(s.lafposDayEnds.reportId, [...reportIds]));
  for (const r of rows) {
    if (r.reportId === null || !r.autoValues) continue;
    if (r.photoCheck?.state === "fark") out.set(r.reportId, "fark");
    else if (r.photoCheck?.state === "okunamadi") out.set(r.reportId, "okunamadi");
    else if (r.photoCheck?.state === "belirsiz") out.set(r.reportId, "bakin");
    else if (r.missing.includes("photo")) out.set(r.reportId, "bekliyor");
  }
  return out;
}
