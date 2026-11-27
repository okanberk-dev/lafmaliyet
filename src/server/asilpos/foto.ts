import "server-only";

import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { TILL_DEVICE_GROUP } from "@/lib/branch-settings/groups";
import { businessDate, LATE_REPORT_DAYS, revisionDataOf } from "@/lib/cash-report";
import { bankPosSchema, okcSchema, posZSchema, type BankPos, type PosDayZ, type PosOkc } from "@/lib/asilpos/day";
import { asilposPhotoCheck, asilposPhotoDone, asilposPhotoNeed, staffPhotoLine, type AsilposPhotoCheck, type AsilposPhotoNeed, type AsilposPhotoRead } from "@/lib/asilpos/foto";
import { ASILPOS_AUTO_BY, autoMissing, deviceCompareReport } from "@/lib/asilpos/gun-sonu";
import { isAsilposDay } from "@/lib/asilpos/switch";
import { OCR_MODEL, readingSourceOf } from "@/lib/photo-read/models";
import { KasaOkcRaw } from "@/lib/photo-read/schemas";
import { okcReadRows } from "@/lib/photo-read/summary";
import { linkedUntil, MAX_OKC_PHOTOS, MAX_REPORT_PHOTOS, OKC_PHOTOS_TEXT } from "@/lib/photo-rules";
import { addDays, longDateTR, todayTR } from "@/lib/reminders";
import { linksAnyPhoto } from "@/lib/roles";
import { resolveBranchSetting } from "@/server/branch-settings";
import { lockCashReport, lockLateDay, okcServerColumns, type CashActor, type CashReportRow, type CashTx } from "@/server/cash/report-store";
import { schema as s, type DB } from "@/server/db";
import { loadAsilposSwitchDay } from "@/server/asilpos/status";
import { asilposBranchId } from "@/server/asilpos/branch";
import type { EmailAttachment } from "@/server/notify/resend";
import { assertNotHeld } from "@/server/staff-requests/core";
import { getPhoto, keepPhoto, linkable, readPhoto } from "@/server/storage/photos";
import { UserError } from "@/server/user-error";

/*
 * AsilPOS gününün gün sonu fotoğrafı (sahibin isteği, 24 Kasım 2026: "sadece gün sonu ladmine personel foto atsın";
 * docs/ASILPOS.md › Gün sonu otomasyonu; kurallar src/lib/asilpos/foto.ts). Kasa raporu AsilPOS'tan kendiliğinden yazılır;
 * personel yalnız Pavo'nun gün sonu fişinin (mali Z basan cihazda yazarkasa Z'sinin de) fotoğrafını ekler. Fotoğraf rapora
 * bağlanır: kaydetme yok, sürüm yok, sayan değişmez, onay gerekmez (rakam değişmiyor). Rapor henüz yoksa (AsilPOS'ta sayım
 * yok) fotoğraf günün kaydında bekler, rapor yazılınca bağlanır (gun-sonu.ts writeAutoReport). Okunuşu AsilPOS'un
 * rakamlarıyla karşılaştırılır (asilpos_day_ends.photo_check); fark yöneticinin uyarısıdır.
 */

type Reader = DB | CashTx;

/** Günün AsilPOS cihaz verisi (Z, Pavo sonucu, yazarkasa belgeleri); gün gelmediyse null */
export async function asilposDayDevice(db: Reader, date: string, branchId: string): Promise<{ z: PosDayZ; bankPos: BankPos | null; okc: PosOkc | null } | null> {
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
 * Şubenin yazarkasa cihazı (AsilPOS'un son gönderdiği `okc`'den: sağlayıcı ve ayrı mali Z basıyor mu); gün sonu henüz
 * gelmediyse fotoğrafın metni için (Pavo ayrı mali Z basmaz). AsilPOS hiç göndermediyse Şube ayarları › Banka POS ve
 * yazarkasa'daki cihaz (şube ayarı kasa.cihaz; TokenX ayrı mali Z basar, Pavo basmaz); o da yoksa ya da "başka bir
 * cihaz"sa null
 */
export async function asilposOkcDeviceOf(db: Reader, branchId: string): Promise<{ provider: "pavo" | "tokenx"; zReport: boolean } | null> {
  const [rows, setting] = await Promise.all([
    db
      .select({ okc: s.posDayReports.okc })
      .from(s.posDayReports)
      .where(and(eq(s.posDayReports.branchId, branchId), isNotNull(s.posDayReports.okc)))
      .orderBy(desc(s.posDayReports.date))
      .limit(1),
    resolveBranchSetting(TILL_DEVICE_GROUP, branchId, db),
  ]);
  const okc = rows[0]?.okc ? okcSchema.safeParse(rows[0].okc) : null;
  if (okc?.success) return { provider: okc.data.provider, zReport: okc.data.zReport };
  const device = setting.value.device;
  return device === "pavo" || device === "tokenx" ? { provider: device, zReport: device === "tokenx" } : null;
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
export async function photoReads(db: Reader, ids: readonly number[]): Promise<AsilposPhotoRead[]> {
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
 * Raporun fotoğraf(lar)ını AsilPOS'la karşılaştırır; fotoğraf yoksa null. `device.z` günün Z'si: AsilPOS'un yazarkasa Z
 * no'su (`okcZNo`) yoksa fotoğrafta okunan Z no `zNoFromPhoto` olur (applyPhotoZNo yazar)
 */
export async function photoCheckOf(
  db: Reader,
  report: CashReportRow,
  device: { bankPos: BankPos | null; okc: PosOkc | null; z?: Pick<PosDayZ, "okcZNo"> | null },
  now = new Date(),
): Promise<AsilposPhotoCheck | null> {
  const ids = await dayPhotoIds(db, report.id);
  if (!ids.length) return null;
  return asilposPhotoCheck(
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
        ...(device.z ? { asilposZNo: device.z.okcZNo ?? null } : {}),
      },
    },
    now,
  );
}

/**
 * Rapor yokken bekleyen fotoğrafların karşılaştırması (AsilPOS'ta sayım yok): otomatik raporun yazacağı değerlerle
 * (deviceCompareReport). Fotoğraf e-postası rapor beklenirken de okunanı ve karşılaştırmayı söylesin; rapor yazılınca
 * aynı okunuş aynı satırları verir, e-posta ikinci kez gitmez. Fotoğraf ya da gün yoksa null
 */
export async function pendingPhotoCheck(db: Reader, date: string, branchId: string, ids: readonly number[], now = new Date()): Promise<AsilposPhotoCheck | null> {
  if (!ids.length) return null;
  const device = await asilposDayDevice(db, date, branchId);
  if (!device) return null;
  return asilposPhotoCheck(
    { day: date, reads: await photoReads(db, ids), bankPos: device.bankPos, okc: device.okc, report: deviceCompareReport({ bankPos: device.bankPos, okc: device.okc, asilposZNo: device.z.okcZNo ?? null }) },
    now,
  );
}

/** E-postaya eklenen fotoğraf en çok (bölümde en çok 3 fotoğraf olur) */
const MAIL_PHOTO_MAX = 3;
/** Eklerin toplam boyutu en çok (Resend 40 MB; e-posta telefonda da açılsın) */
const MAIL_PHOTO_BYTES = 8_000_000;

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * Fotoğraf e-postasının parçaları: her fotoğrafta okunan (okcReadRows; okunmadıysa satır yok), ekleyen(ler)in adı ve
 * fotoğrafların kendisi (ek). Depo yoksa ya da fotoğraf okunamazsa ek düşer, e-posta yine gider
 */
export async function photoMailParts(db: Reader, date: string, ids: readonly number[]): Promise<{ reads: [string, string][][]; by: string | null; attachments: EmailAttachment[] }> {
  const reads = (await photoReads(db, ids)).map((r) => (r.raw ? okcReadRows(r.raw) : []));
  const rows = ids.length ? await db.select({ id: s.photos.id, by: s.photos.createdByName }).from(s.photos).where(inArray(s.photos.id, [...ids])) : [];
  const names = [...new Set(rows.map((r) => r.by).filter((x): x is string => Boolean(x)))];
  const attachments: EmailAttachment[] = [];
  let total = 0;
  for (const [i, id] of ids.slice(0, MAIL_PHOTO_MAX).entries()) {
    const file = await readPhoto(id).catch(() => null);
    if (!file || total + file.bytes.length > MAIL_PHOTO_BYTES) continue;
    total += file.bytes.length;
    attachments.push({ filename: `gun-sonu-${date}${ids.length > 1 ? `-${i + 1}` : ""}.${EXT[file.contentType] ?? "jpg"}`, content: file.bytes, contentType: file.contentType });
  }
  return { reads, by: names.length ? names.join(", ") : null, attachments };
}

/**
 * Fotoğrafta (Pavo'nun detaylı Z'si) okunan Z no'yu raporun boş yazarkasa Z no'suna yazar: yalnız AsilPOS göndermediyse
 * (`check.zNoFromPhoto`: fotoğraf uyumlu, Z'nin günü doğrulanmış), raporda Z no yoksa ve günün son otomatik değerinde de
 * yoksa (fotoğraftan yazılanı yönetici Düzenle'yle sildiyse geri yazılmaz). Sürüm yok (boş alan doluyor, rakam değişmiyor); günün son otomatik
 * değerine de yazılır: AsilPOS sonradan Z no gönderirse onunki geçer (elle düzeltilmiş sayılmaz). Sunucu sütunları
 * (kümülatif) yeniden hesaplanır, işlem geçmişine düşer. Çağıran durum satırını yazdıktan sonra çağırır
 */
export async function applyPhotoZNo(tx: CashTx, row: CashReportRow, check: AsilposPhotoCheck | null, now = new Date()): Promise<CashReportRow> {
  const no = check?.zNoFromPhoto ?? null;
  if (!no || row.okcZNo) return row;
  const [state] = await tx
    .select({ autoValues: s.asilposDayEnds.autoValues })
    .from(s.asilposDayEnds)
    .where(and(eq(s.asilposDayEnds.date, row.date), eq(s.asilposDayEnds.branchId, row.branchId)))
    .limit(1);
  // Otomatik değer doluyken rapor boşsa biri sildi (elle düzeltilen alan): dokunulmaz
  if (!state?.autoValues || state.autoValues.okcZNo) return row;
  const [updated] = await tx.update(s.cashReports).set({ okcZNo: no }).where(eq(s.cashReports.id, row.id)).returning();
  await tx
    .update(s.asilposDayEnds)
    .set({ autoValues: { ...state.autoValues, okcZNo: no }, updatedAt: now })
    .where(and(eq(s.asilposDayEnds.date, row.date), eq(s.asilposDayEnds.branchId, row.branchId)));
  await tx.insert(s.activityLog).values({ userName: ASILPOS_AUTO_BY, userId: null, action: "Yazarkasa Z no fotoğraftan yazıldı (AsilPOS günü)", detail: `${longDateTR(row.date)}: Z no ${no}` });
  return refreshServerColumns(tx, updated);
}

/**
 * Rapor AsilPOS'un otomatik raporu mu (asilpos_day_ends.report_id bu rapor, otomatik değerler kayıtlı): personelden gizleme
 * kuralının fotoğraf durumuna bağlı olmayan, raporun kendi kaydından okunan yedeği (staffAsilposAutoOf)
 */
export async function asilposAutoReport(db: Reader, reportId: number): Promise<boolean> {
  const [row] = await db
    .select({ autoValues: s.asilposDayEnds.autoValues })
    .from(s.asilposDayEnds)
    .where(eq(s.asilposDayEnds.reportId, reportId))
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

/** Personelin fotoğraf ekleyebildiği AsilPOS günü mü: AsilPOS'un şubesi, geçiş gününden itibaren, bugünden en çok 14 gün geri */
export async function asilposPhotoDayOpen(db: Reader, date: string, branchId: string, role: "admin" | "staff", now = new Date()): Promise<boolean> {
  // AsilPOS'un şubesi kütükten (asilposBranchId); onun geçiş günü ayarın kendisidir (branchSwitchDay)
  if (branchId !== (await asilposBranchId(db))) return false;
  const today = businessDate(now);
  if (date > today || (role !== "admin" && date < addDays(today, -LATE_REPORT_DAYS))) return false;
  if (!isAsilposDay(date, await loadAsilposSwitchDay(db as DB))) return false;
  const [day] = await db
    .select({ date: s.posDayReports.date })
    .from(s.posDayReports)
    .where(and(eq(s.posDayReports.date, date), eq(s.posDayReports.branchId, branchId)))
    .limit(1);
  return Boolean(day);
}

export interface AttachResult {
  /** "linked" rapora bağlandı; "pending" rapor yok (AsilPOS'ta sayım yok), yazılınca bağlanır */
  status: "linked" | "pending";
  attached: number;
  need: AsilposPhotoNeed;
  /** Personelin satırı (staffPhotoLine) */
  line: string;
}

/**
 * Gün sonu fotoğrafını AsilPOS gününün otomatik raporuna bağlar (personel ve yönetici). Kaydetme yolu (saveCashReport)
 * kullanılmaz: raporun sürümü, gönderen ve sayan değişmez, kapı (staffCashGate) yoktur (rakam değişmiyor). Personel yalnız
 * kendi yüklediği fotoğrafı, günden 14 gün içinde ekler. Rapor elle girildiyse bu yol kapalıdır (formun Düzenle'si).
 * Rapor yoksa (sayım yok) fotoğraf günün kaydında bekler. İşlem geçmişine yazılır; eksikler ve karşılaştırma yenilenir.
 */
export async function attachAsilposDayPhotoCore(db: DB, me: CashActor, input: { date: string; branchId: string; photoId: number }, now = new Date()): Promise<AttachResult> {
  const { date, branchId, photoId } = input;
  if (!(await asilposPhotoDayOpen(db, date, branchId, me.role, now))) {
    throw new UserError(me.role === "admin" ? "Bu gün AsilPOS'un gün sonu gelmiş bir AsilPOS günü değil" : "Bu güne gün sonu fotoğrafı eklenemez (AsilPOS'un gün sonu yok ya da 14 günden eski)");
  }
  return db.transaction(async (tx) => {
    await lockLateDay(tx, date, branchId);
    const device = await asilposDayDevice(tx, date, branchId);
    if (!device) throw new UserError("AsilPOS'un bu günün gün sonu gelmedi");
    await tx.insert(s.asilposDayEnds).values({ date, branchId }).onConflictDoNothing();
    const [state] = await tx
      .select()
      .from(s.asilposDayEnds)
      .where(and(eq(s.asilposDayEnds.date, date), eq(s.asilposDayEnds.branchId, branchId)))
      .for("update")
      .limit(1);
    const p = await getPhoto(photoId, tx);
    // Başkasının fotoğrafı yalnız yöneticide ("admin" düzeyindeki müdür de yalnız kendi yüklediğini; linksAnyPhoto)
    if (!p || (p.kind !== "kasa-okc" && p.kind !== "kasa-pos") || (!linksAnyPhoto(me) && p.createdBy !== me.id)) throw new UserError("Fotoğraf bulunamadı ya da süresi doldu; yeniden çekin");
    const report = await lockCashReport(tx, date, branchId);
    if (report && (state.reportId !== report.id || !state.autoValues)) throw new UserError("Bu günün raporu elle girildi; fotoğrafı raporun Düzenle'sinden ekleyin");
    const already = report ? (await dayPhotoIds(tx, report.id)).includes(photoId) : state.pendingPhotos.includes(photoId);
    if (!already) {
      if (!linkable(p, now)) throw new UserError("Fotoğraf bulunamadı ya da süresi doldu; yeniden çekin");
      // Onay bekleyen bir isteğin (geç rapor, kasadan çıkan) fotoğrafı buraya bağlanmaz
      await assertNotHeld(tx, photoId);
    }
    const need = asilposPhotoNeed(device);
    let attached: number;
    let check: AsilposPhotoCheck | null = null;
    let pending = state.pendingPhotos;
    if (report) {
      if (!already) await linkToReport(tx, report, photoId, p.kind, now);
      const row = already ? report : await refreshServerColumns(tx, report);
      attached = (await dayPhotoIds(tx, report.id)).length;
      check = await photoCheckOf(tx, row, device, now);
      // AsilPOS Z no göndermediyse fotoğrafta okunan Z no raporun boş alanına (yöneticiye "fotoğraftan okundu")
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
      .update(s.asilposDayEnds)
      .set({ missing: report ? missing : missing.filter((m) => m !== "photo"), photoCheck: check, pendingPhotos: pending, updatedAt: now })
      .where(and(eq(s.asilposDayEnds.date, date), eq(s.asilposDayEnds.branchId, branchId)));
    if (!already) {
      await tx.insert(s.activityLog).values({
        userName: me.name,
        userId: me.id,
        action: "Gün sonu fotoğrafı (AsilPOS günü)",
        detail: `${longDateTR(date)}: ${report ? "rapora bağlandı" : "rapor yazılınca bağlanacak (AsilPOS'ta sayım yok)"}`,
      });
    }
    return { status: report ? "linked" : "pending", attached, need, line: staffPhotoLine(need, attached, check) };
  });
}

/**
 * Otomatik raporun fotoğraf karşılaştırmasını kayıtlı okunuşlarla yeniden kurar (güçlü modelin sonradan bakışından sonra,
 * gun-sonu.ts runAsilposDayEnd): karşılaştırma, eksikler ve fotoğraftan Z no. Otomatik rapor yoksa null
 */
export async function refreshDayPhotoCheck(db: DB, date: string, branchId: string, now = new Date()): Promise<AsilposPhotoCheck | null> {
  return db.transaction(async (tx) => {
    const device = await asilposDayDevice(tx, date, branchId);
    const report = await lockCashReport(tx, date, branchId);
    const [state] = await tx
      .select()
      .from(s.asilposDayEnds)
      .where(and(eq(s.asilposDayEnds.date, date), eq(s.asilposDayEnds.branchId, branchId)))
      .for("update")
      .limit(1);
    if (!device || !report || !state || state.reportId !== report.id || !state.autoValues) return null;
    const check = await photoCheckOf(tx, report, device, now);
    const attached = (await dayPhotoIds(tx, report.id)).length;
    await tx
      .update(s.asilposDayEnds)
      .set({ photoCheck: check, missing: autoMissing(device.z, device, { attached, check }), updatedAt: now })
      .where(and(eq(s.asilposDayEnds.date, date), eq(s.asilposDayEnds.branchId, branchId)));
    await applyPhotoZNo(tx, report, check, now);
    return check;
  });
}

/** Sayfanın gün sonu fotoğrafı bölümü: istenen, eklenen (bağlı ya da bekleyen) ve karşılaştırma (yalnız yöneticiye) */
export interface AsilposPhotoState {
  /** Günün otomatik raporu var mı (yoksa ve gün sonu geldiyse fotoğraf bekler) */
  auto: boolean;
  need: AsilposPhotoNeed;
  attached: number;
  pending: number;
  line: string;
  done: boolean;
  /** Yalnız yönetici */
  check: AsilposPhotoCheck | null;
}

/**
 * Günün gün sonu fotoğrafı durumu (Kasa sayfası, Bugün): AsilPOS günü değilse ya da gün sonu gelmediyse ya da rapor elle
 * girildiyse null (eski yol). `role` personel ise karşılaştırma dönmez
 */
export async function asilposPhotoState(db: DB, date: string, branchId: string, role: "admin" | "staff"): Promise<AsilposPhotoState | null> {
  if (branchId !== (await asilposBranchId(db))) return null;
  const device = await asilposDayDevice(db, date, branchId);
  if (!device) return null;
  if (!isAsilposDay(date, await loadAsilposSwitchDay(db))) return null;
  const [[state], [report]] = await Promise.all([
    db
      .select()
      .from(s.asilposDayEnds)
      .where(and(eq(s.asilposDayEnds.date, date), eq(s.asilposDayEnds.branchId, branchId)))
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
  const need = asilposPhotoNeed(device);
  const pending = state?.pendingPhotos.length ?? 0;
  const attached = report ? (await dayPhotoIds(db, report.id)).length : pending;
  const check = state?.photoCheck ?? null;
  const done = asilposPhotoDone(need, attached, check);
  return { auto, need, attached, pending, line: staffPhotoLine(need, attached, check), done, check: role === "admin" ? check : null };
}

/**
 * Yöneticinin "Banka POS'a yaz"ı: Pavo'nun gün sonu alınamadığı (Banka POS boş) günde fotoğrafta okunan toplamı raporun
 * Banka POS'una yazar. Yalnız otomatik raporda ve alan boşken; önceki sürüm geçmişe, gönderen yönetici olur (elle düzeltilen
 * alan: sonraki otomatik değer ezmez). Sayan değişmez. Karşılaştırma ve eksikler yenilenir
 */
export async function setAsilposBankPosCore(db: DB, me: CashActor, input: { date: string; branchId: string; amount: number }, now = new Date()): Promise<void> {
  if (me.role !== "admin") throw new UserError("Banka POS'u yalnız yönetici yazar");
  const { date, branchId, amount } = input;
  await db.transaction(async (tx) => {
    await lockLateDay(tx, date, branchId);
    const device = await asilposDayDevice(tx, date, branchId);
    const report = await lockCashReport(tx, date, branchId);
    const [state] = await tx
      .select()
      .from(s.asilposDayEnds)
      .where(and(eq(s.asilposDayEnds.date, date), eq(s.asilposDayEnds.branchId, branchId)))
      .for("update")
      .limit(1);
    if (!device || !report || !state || state.reportId !== report.id || !state.autoValues) throw new UserError("Bu günün AsilPOS'tan yazılmış raporu yok");
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
      .update(s.asilposDayEnds)
      .set({ photoCheck: check, missing: autoMissing(device.z, device, { attached, check }), updatedAt: now })
      .where(and(eq(s.asilposDayEnds.date, date), eq(s.asilposDayEnds.branchId, branchId)));
    await applyPhotoZNo(tx, row, check, now);
    await tx.insert(s.activityLog).values({ userName: me.name, userId: me.id, action: "Banka POS fotoğraftan yazıldı (AsilPOS günü)", detail: `${longDateTR(date)}: ${amount.toLocaleString("tr-TR")} ₺` });
  });
}

/**
 * Bugün ekranı (personel): otomatik AsilPOS raporlarının fotoğraf durumu, rapor kimliğine göre ("pending" istenen gün sonu
 * fotoğrafı eklenmedi ya da okunamadı; "done"). Elle girilen rapor listede yok
 */
export async function asilposPhotoMarks(db: DB, reportIds: readonly number[]): Promise<Map<number, "pending" | "done">> {
  const out = new Map<number, "pending" | "done">();
  if (!reportIds.length) return out;
  const rows = await db
    .select({ reportId: s.asilposDayEnds.reportId, missing: s.asilposDayEnds.missing, autoValues: s.asilposDayEnds.autoValues })
    .from(s.asilposDayEnds)
    .where(inArray(s.asilposDayEnds.reportId, [...reportIds]));
  for (const r of rows) if (r.reportId !== null && r.autoValues) out.set(r.reportId, r.missing.includes("photo") ? "pending" : "done");
  return out;
}

/**
 * Yöneticinin ay satırının rozeti (Kasa › günden güne): otomatik AsilPOS raporunda fotoğraf ↔ AsilPOS farklı ("fark"),
 * fotoğraf bekleniyor ("bekliyor"), okunamadı ("okunamadi") ya da kodla okunup güvenle seçilmedi ("bakin": yönetici
 * baksın); tamam ve elle girilen raporda yok
 */
export async function asilposPhotoBadges(db: DB, reportIds: readonly number[]): Promise<Map<number, "fark" | "bekliyor" | "okunamadi" | "bakin">> {
  const out = new Map<number, "fark" | "bekliyor" | "okunamadi" | "bakin">();
  if (!reportIds.length) return out;
  const rows = await db
    .select({ reportId: s.asilposDayEnds.reportId, missing: s.asilposDayEnds.missing, autoValues: s.asilposDayEnds.autoValues, photoCheck: s.asilposDayEnds.photoCheck })
    .from(s.asilposDayEnds)
    .where(inArray(s.asilposDayEnds.reportId, [...reportIds]));
  for (const r of rows) {
    if (r.reportId === null || !r.autoValues) continue;
    if (r.photoCheck?.state === "fark") out.set(r.reportId, "fark");
    else if (r.photoCheck?.state === "okunamadi") out.set(r.reportId, "okunamadi");
    else if (r.photoCheck?.state === "belirsiz") out.set(r.reportId, "bakin");
    else if (r.missing.includes("photo")) out.set(r.reportId, "bekliyor");
  }
  return out;
}
