import "server-only";

import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import { z } from "zod";

import {
  businessDate,
  carryCheck,
  carryDiffText,
  computeCash,
  OKC_FORM_KEYS,
  openingNeedsNote,
  revisionChanges,
  revisionDataOf,
  staffCanReport,
  staffCashGate,
  staffLateDay,
  type CashReportFields,
  type FieldChange,
} from "@/lib/cash-report";
import { CASH_REQUEST_TEXT, cashDaySubject } from "@/lib/cash-requests";
import { money } from "@/lib/format";
import { normalizeVat, OKC_KNOWN_RATES, okcCumulativeToStore, okcFormError, type OkcVatInput, type OkcVatLine } from "@/lib/okc-z";
import { DELETED_REPORT_DAYS, linkedUntil, MAX_OKC_PHOTOS, MAX_REPORT_PHOTOS, OKC_PHOTOS_TEXT } from "@/lib/photo-rules";
import { longDateTR, todayTR } from "@/lib/reminders";
import { zAmount, zDate, zOptText } from "@/server/actions/util";
import { onNextReport, onReportSaved } from "@/server/closed-days";
import { okcReadOfReport } from "@/server/data/cash-photos";
import { previousOkc } from "@/server/data/cash-reports";
import { currentTillBranch } from "@/server/branch-scope";
import { schema as s, type DB } from "@/server/db";
import { assertNotHeld, supersede } from "@/server/staff-requests/core";
import { sendableRecipients } from "@/server/notify/recipients";
import { getPhoto, keepPhoto, linkable, releasePhoto } from "@/server/storage/photos";
import { UserError } from "@/server/user-error";
import { currentVia } from "@/server/activity-via";

/*
 * Kasa raporunun yazım yolu (docs/KASA-RAPORU.md): formun şeması, raporun kaydı (yeni ya da yeni sürüm) ve silinmesi.
 * Personelin ve yöneticinin gönderimi (submitCashReport) ve yöneticinin onayları (src/server/actions/cash-requests.ts)
 * aynı işlevlerden geçer: devir, açılış notu, teslim, sayan ve fotoğraf denetimleri tek yerde. Sunucu eylemi değil
 * (dışarıdan çağrılan uç yok); oturum ve rol denetimi eylemlerde. Veritabanını ya da işlemi parametre
 * alır (tests/kasa-istek-db.test.ts doğrudan çalıştırır).
 */

/** Açık bir işlem */
export type CashTx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/** Raporu yazan hesap (CurrentUser'ın gereken alanları) */
export interface CashActor {
  id: number;
  name: string;
  role: "admin" | "staff";
}

export type CashReportRow = typeof s.cashReports.$inferSelect;

/** Eksik yazarkasa anahtarı "gönderilmedi"dir (eski sayfa): `optional`, boş metin null */
const okcAmount = zAmount.nullable().optional();

/** Formdan gelen yazarkasa tutarları ve dökümü (oranın toplamı ya da KDV'si boş olabilir) */
type OkcInput = Parameters<typeof okcFormError>[0] & { okcVat?: readonly OkcVatInput[] | null };

export const reportSchema = z.object({
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
  /** Gün içinde kasaya giren (cashOut'la aynı tutar kuralı; eski bir sekme göndermezse 0) */
  cashIn: zAmount.default(0),
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
  /**
   * Yazarkasanın (banka POS) mali Z'si (dalga 13; docs/planlar/okc-z.md §3.2, §7): isteğe bağlı. Anahtarı hiç olmayan
   * gönderim (eski sayfa) kayıtlı değerlere dokunmaz. Zorunluluk ve döküm kuralları okcFieldsIn'de (formla aynı metin)
   */
  okcZNo: z
    .string()
    .trim()
    .max(30)
    .nullable()
    .transform((v) => v || null)
    .optional(),
  okcReceipts: z.number().int().min(0).max(100_000).nullable().optional(),
  okcTotal: okcAmount,
  okcVatTotal: okcAmount,
  /** Oran oran döküm: oranın toplamı ya da KDV'si boş gelebilir (kural ikisini birlikte ister) */
  okcVat: z
    .array(z.object({ rate: z.number().finite(), total: zAmount.nullable(), vat: zAmount.nullable() }))
    .max(OKC_KNOWN_RATES.length)
    .nullable()
    .optional(),
  okcCash: okcAmount,
  okcCard: okcAmount,
  okcMealCard: okcAmount,
  okcOther: okcAmount,
});

export type ReportInput = z.output<typeof reportSchema>;

/**
 * Formun yazarkasa alanları kayıtlı biçime (plan §3.2, §6.1; form aynı kuralı okcFormError ile söyler): bölüm boş
 * kalabilir; herhangi bir tutar yazıldıysa günlük toplam, nakit ve kredi kartı gerekli; bir oranın toplamı ile KDV'si
 * birlikte, KDV toplamdan büyük değil, oran %0 / %1 / %8 / %10 / %18 / %20 ve tekrarsız. Döküm sıfır gruplar atılmış,
 * orana göre sıralı (boşsa null). Gönderilmeyen anahtar eksik kalır (yazımda kayıtlı değer korunur, withOkcOf)
 */
export function okcFieldsIn<T extends OkcInput>(data: T): Omit<T, "okcVat"> & { okcVat?: OkcVatLine[] | null } {
  const err = okcFormError(data);
  if (err) throw new UserError(err);
  if (data.okcVat === undefined) return data as Omit<T, "okcVat">;
  const lines = data.okcVat ?? [];
  for (const l of lines) if (!OKC_KNOWN_RATES.includes(l.rate)) throw new UserError(`KDV oranı %${l.rate} olamaz: %1, %10 ya da %20 yazın`);
  if (new Set(lines.map((l) => l.rate)).size !== lines.length) throw new UserError("Aynı KDV oranı iki kez yazılmış");
  const vat = normalizeVat(lines.filter((l): l is OkcVatLine => l.total !== null && l.vat !== null));
  return { ...data, okcVat: vat.length ? vat : null };
}

/** Yazarkasa alanlarının kayıtlı hâli: gönderilmeyen anahtar (eski sayfa, eski istek) kayıtlı değeri korur; yeni raporda boş */
export function withOkcOf(data: CashReportFields, prev: Pick<CashReportRow, (typeof OKC_FORM_KEYS)[number]> | null): CashReportFields {
  const out: CashReportFields = { ...data };
  for (const k of OKC_FORM_KEYS) if (out[k] === undefined) (out as unknown as Record<string, unknown>)[k] = prev ? prev[k] : null;
  return out;
}

/**
 * Günün kilidi (danışma kilidi, işlemin sonuna kadar): aynı günün geç rapor isteği (late.ts), onayı ve yöneticinin
 * doğrudan girişi (saveCashReport) sıraya girer. Raporun satırından ve istek satırından önce alınır: raporu henüz olmayan
 * günde satır kilidi yoktur, onay ile doğrudan giriş aynı günü yazarken birbirini ters sırayla beklemesin.
 */
export async function lockLateDay(tx: CashTx, date: string, branchId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`kasa-gec:${branchId}:${date}`}))`);
}

/** Günün raporunu kilitleyerek okur (FOR UPDATE); yoksa null */
export async function lockCashReport(tx: CashTx, date: string, branchId: string): Promise<CashReportRow | null> {
  const [row] = await tx
    .select()
    .from(s.cashReports)
    .where(and(eq(s.cashReports.date, date), eq(s.cashReports.branchId, branchId)))
    .for("update")
    .limit(1);
  return row ?? null;
}

/** Bu günden sonra girilmiş bir rapor var mı (varsa bu raporun devri ertesi günün açılışına dayanak olmuştur) */
export async function hasLaterReport(tx: CashTx, date: string, branchId: string): Promise<boolean> {
  const [later] = await tx
    .select({ id: s.cashReports.id })
    .from(s.cashReports)
    .where(and(gt(s.cashReports.date, date), eq(s.cashReports.branchId, branchId)))
    .limit(1);
  return Boolean(later);
}

/**
 * Kasayı sayan: etkin bir kullanıcı ya da raporda zaten kayıtlı olan (sonradan pasif olsa da). `kept`: kayıtlı raporun
 * sayanı (yeni raporda null)
 */
export async function resolveCounter(tx: CashTx, counterId: number, kept: number | null): Promise<{ id: number; name: string }> {
  const [counter] = await tx.select({ id: s.users.id, name: s.users.name, active: s.users.active }).from(s.users).where(eq(s.users.id, counterId)).limit(1);
  if (!counter || (!counter.active && counter.id !== kept)) throw new UserError("Sayan kişi bulunamadı; listeden seçin");
  return { id: counter.id, name: counter.name };
}

/** Bu günden önceki son raporun ertesi güne devri (işlemin içinden) */
export async function carryBefore(tx: CashTx, date: string, branchId: string): Promise<{ date: string; amount: number } | null> {
  const [before] = await tx
    .select({ date: s.cashReports.date, counted: s.cashReports.countedCash, handed: s.cashReports.handedOver })
    .from(s.cashReports)
    .where(and(lt(s.cashReports.date, date), eq(s.cashReports.branchId, branchId)))
    .orderBy(desc(s.cashReports.date))
    .limit(1);
  return before ? { date: before.date, amount: Math.round((before.counted - before.handed) * 100) / 100 } : null;
}

/** Ekranda görülen sürüm hâlâ raporun sürümü mü (arada başkası gönderdiyse üzerine yazılmaz) */
export function assertRevision(prev: CashReportRow | null, revision: number): void {
  if (prev && prev.revision !== revision) {
    throw new UserError(`Bu günün raporunu az önce ${prev.submittedByName} gönderdi; sayfayı yenileyip onun girdiklerini kontrol edin`);
  }
  if (!prev && revision !== 0) throw new UserError("Rapor bu arada silinmiş; sayfayı yenileyin");
}

/** Kişinin bu şubenin bu günkü raporu için bekleyen silme isteği var mı (varken raporu düzenleyemez ve düzeltme öneremez) */
export async function ownDeletePending(tx: CashTx, userId: number, date: string, branchId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: s.staffRequests.id })
    .from(s.staffRequests)
    .where(
      and(eq(s.staffRequests.kind, "kasa-silme"), eq(s.staffRequests.subject, cashDaySubject(date, branchId)), eq(s.staffRequests.requestedBy, userId), eq(s.staffRequests.status, "pending")),
    )
    .limit(1);
  return Boolean(row);
}

export interface WriteOptions {
  /** Formun açıldığı andaki sürüm (0: yeni rapor) */
  revision: number;
  /**
   * Raporun şubesi (docs/SUBE.md). Kasa raporunun anahtarı (gün, şube): aynı güne her şube kendi raporunu girer,
   * bu yüzden okuma, kilit ve devir zinciri hep şube içinde kalır. Çağıran panelin seçimini geçer.
   */
  branchId: string;
  /** Kasayı sayan; boşsa raporu gönderen */
  countedBy?: number | null;
  /** Bu gönderimle eklenen fotoğraflar (bağlanmamış) */
  photos?: readonly number[];
  /** Raporu gönderen; verilmezse yazan hesap (geç raporun onayında isteyen personel) */
  submittedBy?: { id: number | null; name: string };
  /** İşlemin içinde kilitlenmiş satır (verilmezse burada kilitlenir; null: rapor yok) */
  prev?: CashReportRow | null;
  /**
   * Fotoğrafları tutan istek (geç raporun onayı): o isteğin kendi fotoğrafları bağlanabilir; başka bir bekleyen isteğin
   * tuttuğu fotoğraf hiçbir zaman bağlanmaz (assertNotHeld)
   */
  heldBy?: number;
  /** Sayan sonradan pasif olsa da kabul edilir (geç raporun onayında sayan isteyendir) */
  keepCounter?: boolean;
  /**
   * Açılış notu denetimi atlanır: yalnız yöneticinin "Düzeltip onayla"sında isteyenin 1. sürümü için (aynı işlemde
   * yazılan 2. sürüm denetlenir)
   */
  skipOpeningNote?: boolean;
}

export interface WriteResult {
  row: CashReportRow;
  /** Yerine yenisi gelen sürüm (yeni raporda null) */
  prev: CashReportRow | null;
  /** Önceki sürümle farklar (yeni raporda boş) */
  changes: FieldChange[];
  /** Önceki sürümün ertesi güne devri (sonraki raporun zinciri bu düzeltmeyle mi bozuldu) */
  prevCarry: number | null;
}

/**
 * Raporu yazar (işlemin içinde): yoksa ekler, varsa yeni sürüm olarak günceller (önceki sürümün kopyası aynı işlemde
 * cash_report_revisions'a). Denetimler: ekranda görülen sürüm, teslim ≤ sayılan, sayan, açılışın önceki devirle tutmaması
 * (nedeni notta), fotoğraflar (Z / POS, bağlanabilir, personelde kendisinin, rapor başına en çok 6).
 */
export async function writeCashReport(tx: CashTx, actor: CashActor, data: CashReportFields, o: WriteOptions): Promise<WriteResult> {
  if (data.handedOver > data.countedCash) throw new UserError("Teslim edilen, sayılan nakitten fazla olamaz");
  const prev = o.prev === undefined ? await lockCashReport(tx, data.date, o.branchId) : o.prev;
  assertRevision(prev, o.revision);
  // Yazarkasa alanları: gönderilmeyen anahtar kayıtlı değeri korur; kural formla aynı (okcFormError), döküm normal biçimde
  const okc = withOkcOf(data, prev);
  const okcError = okcFormError(okc);
  if (okcError) throw new UserError(okcError);
  const okcVat = normalizeVat(okc.okcVat);
  const submitter = o.submittedBy ?? { id: actor.id, name: actor.name };
  // Kasayı sayan: etkin bir kullanıcı ya da raporda zaten kayıtlı olan (sonradan pasif olsa da)
  const counterId = o.countedBy ?? submitter.id ?? actor.id;
  const counter = await resolveCounter(tx, counterId, prev ? (prev.countedBy ?? prev.submittedBy) : o.keepCounter ? counterId : null);
  // Açılış önceki raporun devriyle tutmuyorsa nedeni nota yazılır (yeni raporda ya da açılış değiştiyse)
  const check = o.skipOpeningNote ? null : carryCheck(data.date, data.openingCash, await carryBefore(tx, data.date, o.branchId));
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
    ...okc,
    discounts: data.discounts ?? null,
    okcVat: okcVat.length ? okcVat : null,
    cashDiff: computeCash(okc).cashDiff,
    submittedBy: submitter.id,
    submittedByName: submitter.name,
    countedBy: counter.id,
    countedByName: counter.name,
    emailStatus: null,
    emailError: null,
    updatedAt: new Date(),
  };
  const [written] = prev
    ? await tx
        .update(s.cashReports)
        .set({ ...values, revision: prev.revision + 1 })
        .where(eq(s.cashReports.id, prev.id))
        .returning()
    : await tx.insert(s.cashReports).values({ ...values, branchId: o.branchId }).returning();
  let row = written;
  // Yeni rapor: gün açık demektir (kapalı işareti ve bildirimi kalkar); önceki gün kapalı işaretliyse Z no ve açılış
  // sürekliliği denetlenir (src/server/closed-days.ts)
  if (!prev) {
    await onReportSaved(tx, row.date, new Date(), row.branchId);
    await onNextReport(tx, row);
  }
  // Fotoğraflar kanıttır: yalnız eklenir (yeniden gönderimde eskileri bağlı kalır), rapor gününden 180 gün saklanır
  // (geçmiş bir güne sonradan eklenen bugünden)
  const ids = [...new Set(o.photos ?? [])];
  // LafPOS günü: sayım yokken eklenip bekleyen gün sonu fotoğrafları elle girilen bu rapora bağlanır (kaybolmaz)
  let okcLinked = !prev && (await adoptPendingDayPhotos(tx, row)) > 0;
  if (ids.length) {
    const linked = await tx.select({ kind: s.cashReportPhotos.kind }).from(s.cashReportPhotos).where(eq(s.cashReportPhotos.reportId, row.id));
    if (linked.length + ids.length > MAX_REPORT_PHOTOS) throw new UserError(`Bir rapora en çok ${MAX_REPORT_PHOTOS} fotoğraf eklenir`);
    let okcCount = linked.filter((l) => l.kind === "kasa-okc").length;
    for (const id of ids) {
      const p = await getPhoto(id, tx);
      // kasa-okc: yazarkasa Z'si; geçişte eski sayfanın banka POS fotoğrafı da sunucuda kasa-okc olur (okc-z.md D2)
      if (!p || (p.kind !== "kasa-z" && p.kind !== "kasa-pos" && p.kind !== "kasa-okc") || !linkable(p) || (actor.role !== "admin" && p.createdBy !== actor.id)) {
        throw new UserError("Fotoğraf bulunamadı ya da süresi doldu; yeniden çekin");
      }
      // Yazarkasa Z bölümüne en çok 3 fotoğraf (uzun fişin parçaları)
      if (p.kind === "kasa-okc" && ++okcCount > MAX_OKC_PHOTOS) throw new UserError(OKC_PHOTOS_TEXT);
      // Onay bekleyen bir isteğin (geç rapor) fotoğrafı başka bir kayda bağlanmaz
      await assertNotHeld(tx, id, o.heldBy);
      await tx.insert(s.cashReportPhotos).values({ reportId: row.id, photoId: id, kind: p.kind });
      await keepPhoto(id, linkedUntil(p.kind, data.date, todayTR()), tx);
      if (p.kind === "kasa-okc") okcLinked = true;
    }
  }
  // Sunucu sütunları (kümülatif, yazarkasa dışı tahsilat; plan §6.1, D10): yeni raporda, yazarkasa fotoğrafı bağlanınca ya
  // da yazarkasa Z no'su veya günlük toplamı değişince yeniden hesaplanır. Başka bir düzeltme onlara dokunmaz: yöneticinin
  // temizlediği kümülatif, rapor yeni bir yazarkasa okumasıyla ya da değişen Z no / toplamla yeniden yazılana kadar boş kalır
  if (!prev || okcLinked || (prev.okcZNo ?? null) !== (row.okcZNo ?? null) || (prev.okcTotal ?? null) !== (row.okcTotal ?? null)) {
    const server = await okcServerColumns(tx, row);
    if (server.okcCumTotal !== row.okcCumTotal || server.okcCumVat !== row.okcCumVat || server.okcOutside !== row.okcOutside) {
      [row] = await tx.update(s.cashReports).set(server).where(eq(s.cashReports.id, row.id)).returning();
    }
  }
  return {
    row,
    prev,
    changes: prev ? revisionChanges(revisionDataOf(prev), revisionDataOf(row)) : [],
    prevCarry: prev ? Math.round((prev.countedCash - prev.handedOver) * 100) / 100 : null,
  };
}

/**
 * Raporun sunucu sütunları (plan §6.1, D10; src/lib/okc-z.ts okcCumulativeToStore): rapora bağlı yazarkasa Z
 * fotoğraflarının okumalarından. Okunan Z no kaydedilen Z no'ya ve okunan günlük toplam kaydedilen toplama (±0,01) eşit
 * değilse (elle düzeltilmiş ya da elle girilmiş rapor) üçü de boş; kümülatif yalnız inandırıcıysa (zincir tutuyor, ilk
 * kümülatif ya da aradaki girilmemiş Z'lerle büyümüş), zincir son saklanan kümülatife bağlanır (previousOkc). Yazarkasa
 * dışı tahsilat 1 ₺'yi geçerse
 */
/**
 * LafPOS gününün bekleyen gün sonu fotoğrafları (lafpos_day_ends.pending_photos: LafPOS sayımsız kapandı, rapor yokken
 * personel ekledi) günün raporuna bağlanır ve bekleyen liste boşalır. Otomatik rapor kendi yolunda bağlar
 * (src/server/lafpos/foto.ts linkPendingPhotos); bu, rapor elle girildiğinde (formun kaydı ya da LafPOS'un sonraki
 * gönderiminde elle girilmiş rapor) fotoğrafın sahipsiz kalmaması içindir. Sınırı aşan ya da bulunamayan fotoğraf
 * atlanır (kayıt düşmez). Bağlananların sayısı
 */
export async function adoptPendingDayPhotos(tx: CashTx, row: CashReportRow, now = new Date()): Promise<number> {
  const [state] = await tx
    .select({ pending: s.lafposDayEnds.pendingPhotos })
    .from(s.lafposDayEnds)
    .where(and(eq(s.lafposDayEnds.date, row.date), eq(s.lafposDayEnds.branchId, row.branchId)))
    .for("update")
    .limit(1);
  if (!state?.pending.length) return 0;
  const linked = await tx.select({ id: s.cashReportPhotos.photoId, kind: s.cashReportPhotos.kind }).from(s.cashReportPhotos).where(eq(s.cashReportPhotos.reportId, row.id));
  let total = linked.length;
  let okc = linked.filter((l) => l.kind === "kasa-okc" || l.kind === "kasa-pos").length;
  let adopted = 0;
  for (const id of state.pending) {
    if (linked.some((l) => l.id === id)) continue;
    const p = await getPhoto(id, tx);
    if (!p || (p.kind !== "kasa-okc" && p.kind !== "kasa-pos")) continue;
    if (total >= MAX_REPORT_PHOTOS || okc >= MAX_OKC_PHOTOS) break;
    await tx.insert(s.cashReportPhotos).values({ reportId: row.id, photoId: id, kind: p.kind });
    await keepPhoto(id, linkedUntil("kasa-okc", row.date, todayTR(now)), tx);
    total++;
    okc++;
    adopted++;
  }
  await tx
    .update(s.lafposDayEnds)
    .set({ pendingPhotos: [], updatedAt: now })
    .where(and(eq(s.lafposDayEnds.date, row.date), eq(s.lafposDayEnds.branchId, row.branchId)));
  return adopted;
}

export async function okcServerColumns(tx: CashTx, row: CashReportRow): Promise<{ okcCumTotal: number | null; okcCumVat: number | null; okcOutside: number | null }> {
  const none = { okcCumTotal: null, okcCumVat: null, okcOutside: null };
  if (!row.okcZNo || row.okcTotal === null) return none;
  const read = await okcReadOfReport(tx, row.id, row.date);
  if (!read) return none;
  // Kümülatif zinciri raporun kendi kasasının (şubenin) zinciridir: başka şubenin yazarkasası karışmaz
  const { cum } = await previousOkc(row.date, tx, row.branchId);
  const out = okcCumulativeToStore({
    savedZNo: row.okcZNo,
    savedTotal: row.okcTotal,
    readZNo: read.zNo,
    readTotal: read.total,
    readVatTotal: read.vatTotal,
    cumTotal: read.cumTotal,
    cumVat: read.cumVat,
    outside: read.outside,
    prevCum: cum,
  });
  return { okcCumTotal: out.cumTotal, okcCumVat: out.cumVat, okcOutside: out.outside };
}

/**
 * Yöneticinin "Kümülatifi temizle"si (plan §3.7, §6.1): yanlış okunup saklanmış kümülatifin iki sütununu boşaltır; zincir
 * bir önceki saklanan kümülatife bağlanır. Raporun sürümü ve gönderim anı değişmez (personelin yazdığı alan değil),
 * işlem geçmişine düşer (aynı işlemde). Yalnız yönetici
 */
export async function clearOkcCumulativeCore(db: DB, me: CashActor, reportId: number): Promise<{ date: string; cumTotal: number | null; cumVat: number | null }> {
  if (me.role !== "admin") throw new UserError("Kümülatifi yalnız yönetici temizler");
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(s.cashReports).where(eq(s.cashReports.id, reportId)).for("update").limit(1);
    if (!row) throw new UserError("Rapor bulunamadı");
    if (row.okcCumTotal === null && row.okcCumVat === null) throw new UserError("Bu raporda saklanmış kümülatif yok");
    await tx.update(s.cashReports).set({ okcCumTotal: null, okcCumVat: null }).where(eq(s.cashReports.id, row.id));
    const detail = [
      longDateTR(row.date),
      row.okcZNo ? `Banka POS Z no ${row.okcZNo}` : null,
      row.okcCumTotal !== null ? `kümülatif ${money(row.okcCumTotal)}` : null,
      row.okcCumVat !== null ? `KDV ${money(row.okcCumVat)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    await tx.insert(s.activityLog).values({ userName: me.name, userId: me.id, action: "Yazarkasa kümülatifi temizlendi", detail, via: currentVia() });
    return { date: row.date, cumTotal: row.okcCumTotal, cumVat: row.okcCumVat };
  });
}

export type SaveResult =
  | ({ kind: "saved" } & WriteResult)
  | { kind: "needsApproval"; request: "kasa-duzeltme"; gate: "kilitli" | "gec" }
  | { kind: "needsApproval"; request: "kasa-gec"; gate: "gec" };

/**
 * Formdan gönderilen raporu kaydeder (personel ve yönetici; submitCashReport). İleri gün yok; personel yalnız bugünü ve
 * dünü girer. Personelin kayıtlı rapordaki değişikliği kapıdan geçer (staffCashGate): ertesi günün raporu girildiyse
 * (kilitli) ya da iş günü kapandıktan sonra kasa alanı veya sayan değiştiyse hiçbir şey yazılmaz, "needsApproval" döner
 * ve form yazılanları koruyarak düzeltme önerisine geçer (src/server/cash/requests.ts). Kendi silme isteği bekleyen
 * raporu personel düzenleyemez. Gün bu arada personelin penceresinden çıktıysa (05:00 dönüşü) ve raporu yoksa geç
 * rapor olur: hiçbir şey yazılmaz, "needsApproval" (kasa-gec) döner, form geç rapora geçer (src/server/cash/late.ts).
 * Yeni rapor aynı günün bekleyen geç rapor isteklerini kapatır ("Yönetici günü kendisi girdi"; fotoğrafları 30 gün).
 */
export async function saveCashReport(db: DB, me: CashActor, input: ReportInput, now = new Date()): Promise<SaveResult> {
  const { revision, photos, countedBy, ...form } = input;
  // Raporun şubesi: formun gösterdiği kasa (docs/SUBE.md › Yazarken hangi şube). submitCashReport formun kasasını
  // doğrular ve bunu onun kapsamında çağırır (formTillBranch, withBranchScope): gönderim anındaki çerez başka sekmede
  // değişmiş olabilir. Gün bir kez değil, şube başına bir kez girilir
  const branchId = await currentTillBranch();
  const data = okcFieldsIn(form);
  if (data.date > businessDate(now)) throw new UserError("İleri bir günün raporu girilemez");
  if (me.role !== "admin" && !staffCanReport(data.date, now)) {
    // 05:00 dönüşü: dünün formu artık geç rapor (yöneticinin onayıyla); yazılanlar formda kalır
    if (revision === 0 && staffLateDay(data.date, now)) {
      const [had] = await db
        .select({ id: s.cashReports.id })
        .from(s.cashReports)
        .where(and(eq(s.cashReports.date, data.date), eq(s.cashReports.branchId, branchId)))
        .limit(1);
      if (!had) return { kind: "needsApproval", request: "kasa-gec", gate: "gec" };
    }
    throw new UserError("Personel yalnız bugünün ve dünün raporunu girebilir; daha eskisi için yöneticiye yazın");
  }
  return db.transaction(async (tx) => {
    await lockLateDay(tx, data.date, branchId);
    const prev = await lockCashReport(tx, data.date, branchId);
    if (prev && me.role !== "admin") {
      assertRevision(prev, revision);
      if (await ownDeletePending(tx, me.id, data.date, branchId)) throw new UserError(CASH_REQUEST_TEXT.deletePending);
      // Ertesi günün raporu girildiyse (ertesi günün açılışı bu raporun devrine dayanır) ya da iş günü kapandıktan sonra
      // kasa alanı ya da sayan değiştiyse personel doğrudan kaydetmez: yöneticinin onayına gider
      const laterReport = await hasLaterReport(tx, data.date, branchId);
      const counter = await resolveCounter(tx, countedBy ?? me.id, prev.countedBy ?? prev.submittedBy);
      // Gönderilmeyen yazarkasa alanı (eski sayfa) kayıtlı değerdir, değişiklik sayılmaz
      const sent = withOkcOf(data, prev);
      const changes = revisionChanges(revisionDataOf(prev), { ...sent, discounts: sent.discounts ?? null, cashDiff: computeCash(sent).cashDiff, countedByName: counter.name });
      const gate = staffCashGate({ date: data.date, now, hasReport: true, laterReport, changes });
      if (gate === "closed") throw new UserError(CASH_REQUEST_TEXT.closed);
      if (gate === "request") return { kind: "needsApproval" as const, request: "kasa-duzeltme" as const, gate: laterReport ? ("kilitli" as const) : ("gec" as const) };
    }
    const out = await writeCashReport(tx, me, data, { revision, countedBy, photos, prev, branchId });
    // Gün artık raporlu: bekleyen geç rapor istekleri kapanır (reddedilmez), Z fotoğrafları kanıt olarak 30 gün kalır
    if (!prev) {
      // Yalnız bu şubenin günü: başka şubenin aynı gün için bekleyen geç raporu açık kalır
      await supersede(tx, { kinds: ["kasa-gec"], subject: cashDaySubject(data.date, branchId) }, me.role === "admin" ? "Yönetici günü kendisi girdi" : "Bu günün raporu girildi", now, DELETED_REPORT_DAYS);
    }
    return { kind: "saved" as const, ...out };
  });
}

/**
 * Kasa e-postasının gönderim anındaki alıcıları: kayıtlı adreslerden personel hesabının ya da pasif hesabın adresi düşer
 * (ayarlar kaydedildikten sonra personele indirilen, pasif yapılan ya da personel hesabı açılan adres: kasa e-postasında
 * karaoke ön ödemesi var). Hesabı olmayan adres (muhasebeci) kalır. Kural ayarı kaydederken de denetlenir
 * (updateCashSettings); gönderim ona güvenmez. Sıra korunur. Düşenler `dropped`ta (yönetici zilde ve ayarda görür;
 * src/lib/notify-recipients.ts).
 */
export async function cashEmailRecipients(db: DB | CashTx, emails: readonly string[]): Promise<string[]> {
  return (await sendableRecipients(db, emails)).to;
}

/**
 * Raporu siler (işlemin içinde; yönetici): fotoğrafların bağı kalkar, 30 gün daha saklanır; önceki sürümleri raporla
 * gider (cascade). Aynı günün bekleyen düzeltme, silme ve fotoğraf kaldırma istekleri kapanır ("Rapor silindi";
 * reddedilmez), silmeyi onaylanan istek (`exceptRequestId`) hariç. Silinen raporun değerleri dönüşte (işlem
 * geçmişine yazılır).
 */
export async function removeCashReport(tx: CashTx, id: number, o: { exceptRequestId?: number } = {}) {
  const links = await tx.select({ photoId: s.cashReportPhotos.photoId }).from(s.cashReportPhotos).where(eq(s.cashReportPhotos.reportId, id));
  for (const l of links) await releasePhoto(l.photoId, DELETED_REPORT_DAYS, tx);
  const [row] = await tx.delete(s.cashReports).where(eq(s.cashReports.id, id)).returning({
    date: s.cashReports.date,
    zTotal: s.cashReports.zTotal,
    countedCash: s.cashReports.countedCash,
    cashDiff: s.cashReports.cashDiff,
    by: s.cashReports.submittedByName,
    countedByName: s.cashReports.countedByName,
    branchId: s.cashReports.branchId,
  });
  if (!row) throw new UserError("Rapor bulunamadı");
  // Yalnız bu raporun istekleri: şubenin günündeki düzeltme ve silme, raporun fotoğraflarının kaldırma istekleri. Gün
  // ile kapatılsaydı Tuzla'nın raporu silinince Marina'nın aynı gündeki istekleri de kapanırdı
  const superseded = [
    ...(await supersede(tx, { kinds: ["kasa-duzeltme", "kasa-silme"], subject: cashDaySubject(row.date, row.branchId), exceptId: o.exceptRequestId }, "Rapor silindi")),
    ...(await supersede(tx, { kinds: ["foto-kaldir"], subjects: links.map((l) => `foto:${l.photoId}`), exceptId: o.exceptRequestId }, "Rapor silindi")),
  ].sort((a, b) => a - b);
  return { row, photos: links.length, superseded };
}
