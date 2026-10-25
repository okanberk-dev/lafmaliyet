import "server-only";

import { and, count, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";

import {
  businessDate,
  carryCheck,
  carryDiffText,
  computeCash,
  openingNeedsNote,
  revisionChanges,
  revisionDataOf,
  staffCanReport,
  staffCashGate,
  staffLateDay,
  type CashReportFields,
  type FieldChange,
} from "@/lib/cash-report";
import { CASH_REQUEST_TEXT } from "@/lib/cash-requests";
import { DELETED_REPORT_DAYS, linkedUntil, MAX_REPORT_PHOTOS } from "@/lib/photo-rules";
import { todayTR } from "@/lib/reminders";
import { zAmount, zDate, zOptText } from "@/server/actions/util";
import { onNextReport, onReportSaved } from "@/server/closed-days";
import { schema as s, type DB } from "@/server/db";
import { assertNotHeld, supersede } from "@/server/staff-requests/core";
import { getPhoto, keepPhoto, linkable, releasePhoto } from "@/server/storage/photos";
import { UserError } from "@/server/user-error";

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

export type ReportInput = z.output<typeof reportSchema>;

/** Günün raporunu kilitleyerek okur (FOR UPDATE); yoksa null */
export async function lockCashReport(tx: CashTx, date: string): Promise<CashReportRow | null> {
  const [row] = await tx.select().from(s.cashReports).where(eq(s.cashReports.date, date)).for("update").limit(1);
  return row ?? null;
}

/** Bu günden sonra girilmiş bir rapor var mı (varsa bu raporun devri ertesi günün açılışına dayanak olmuştur) */
export async function hasLaterReport(tx: CashTx, date: string): Promise<boolean> {
  const [later] = await tx.select({ id: s.cashReports.id }).from(s.cashReports).where(gt(s.cashReports.date, date)).limit(1);
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
export async function carryBefore(tx: CashTx, date: string): Promise<{ date: string; amount: number } | null> {
  const [before] = await tx
    .select({ date: s.cashReports.date, counted: s.cashReports.countedCash, handed: s.cashReports.handedOver })
    .from(s.cashReports)
    .where(lt(s.cashReports.date, date))
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

/** Kişinin bu günün raporu için bekleyen silme isteği var mı (varken raporu düzenleyemez ve düzeltme öneremez) */
export async function ownDeletePending(tx: CashTx, userId: number, date: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: s.staffRequests.id })
    .from(s.staffRequests)
    .where(and(eq(s.staffRequests.kind, "kasa-silme"), eq(s.staffRequests.subject, `gun:${date}`), eq(s.staffRequests.requestedBy, userId), eq(s.staffRequests.status, "pending")))
    .limit(1);
  return Boolean(row);
}

export interface WriteOptions {
  /** Formun açıldığı andaki sürüm (0: yeni rapor) */
  revision: number;
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
  const prev = o.prev === undefined ? await lockCashReport(tx, data.date) : o.prev;
  assertRevision(prev, o.revision);
  const submitter = o.submittedBy ?? { id: actor.id, name: actor.name };
  // Kasayı sayan: etkin bir kullanıcı ya da raporda zaten kayıtlı olan (sonradan pasif olsa da)
  const counterId = o.countedBy ?? submitter.id ?? actor.id;
  const counter = await resolveCounter(tx, counterId, prev ? (prev.countedBy ?? prev.submittedBy) : o.keepCounter ? counterId : null);
  // Açılış önceki raporun devriyle tutmuyorsa nedeni nota yazılır (yeni raporda ya da açılış değiştiyse)
  const check = o.skipOpeningNote ? null : carryCheck(data.date, data.openingCash, await carryBefore(tx, data.date));
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
    discounts: data.discounts ?? null,
    cashDiff: computeCash(data).cashDiff,
    submittedBy: submitter.id,
    submittedByName: submitter.name,
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
  // Yeni rapor: gün açık demektir (kapalı işareti ve bildirimi kalkar); önceki gün kapalı işaretliyse Z no ve açılış
  // sürekliliği denetlenir (src/server/closed-days.ts)
  if (!prev) {
    await onReportSaved(tx, row.date);
    await onNextReport(tx, row);
  }
  // Fotoğraflar kanıttır: yalnız eklenir (yeniden gönderimde eskileri bağlı kalır), rapor gününden 180 gün saklanır
  // (geçmiş bir güne sonradan eklenen bugünden)
  const ids = [...new Set(o.photos ?? [])];
  if (ids.length) {
    const [{ n }] = await tx.select({ n: count() }).from(s.cashReportPhotos).where(eq(s.cashReportPhotos.reportId, row.id));
    if (n + ids.length > MAX_REPORT_PHOTOS) throw new UserError(`Bir rapora en çok ${MAX_REPORT_PHOTOS} fotoğraf eklenir`);
    for (const id of ids) {
      const p = await getPhoto(id, tx);
      if (!p || (p.kind !== "kasa-z" && p.kind !== "kasa-pos") || !linkable(p) || (actor.role !== "admin" && p.createdBy !== actor.id)) {
        throw new UserError("Fotoğraf bulunamadı ya da süresi doldu; yeniden çekin");
      }
      // Onay bekleyen bir isteğin (geç rapor) fotoğrafı başka bir kayda bağlanmaz
      await assertNotHeld(tx, id, o.heldBy);
      await tx.insert(s.cashReportPhotos).values({ reportId: row.id, photoId: id, kind: p.kind });
      await keepPhoto(id, linkedUntil(p.kind, data.date, todayTR()), tx);
    }
  }
  return {
    row,
    prev,
    changes: prev ? revisionChanges(revisionDataOf(prev), revisionDataOf(row)) : [],
    prevCarry: prev ? Math.round((prev.countedCash - prev.handedOver) * 100) / 100 : null,
  };
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
  const { revision, photos, countedBy, ...data } = input;
  if (data.date > businessDate(now)) throw new UserError("İleri bir günün raporu girilemez");
  if (me.role !== "admin" && !staffCanReport(data.date, now)) {
    // 05:00 dönüşü: dünün formu artık geç rapor (yöneticinin onayıyla); yazılanlar formda kalır
    if (revision === 0 && staffLateDay(data.date, now)) {
      const [had] = await db.select({ id: s.cashReports.id }).from(s.cashReports).where(eq(s.cashReports.date, data.date)).limit(1);
      if (!had) return { kind: "needsApproval", request: "kasa-gec", gate: "gec" };
    }
    throw new UserError("Personel yalnız bugünün ve dünün raporunu girebilir; daha eskisi için yöneticiye yazın");
  }
  return db.transaction(async (tx) => {
    const prev = await lockCashReport(tx, data.date);
    if (prev && me.role !== "admin") {
      assertRevision(prev, revision);
      if (await ownDeletePending(tx, me.id, data.date)) throw new UserError(CASH_REQUEST_TEXT.deletePending);
      // Ertesi günün raporu girildiyse (ertesi günün açılışı bu raporun devrine dayanır) ya da iş günü kapandıktan sonra
      // kasa alanı ya da sayan değiştiyse personel doğrudan kaydetmez: yöneticinin onayına gider
      const laterReport = await hasLaterReport(tx, data.date);
      const counter = await resolveCounter(tx, countedBy ?? me.id, prev.countedBy ?? prev.submittedBy);
      const changes = revisionChanges(revisionDataOf(prev), { ...data, discounts: data.discounts ?? null, cashDiff: computeCash(data).cashDiff, countedByName: counter.name });
      const gate = staffCashGate({ date: data.date, now, hasReport: true, laterReport, changes });
      if (gate === "closed") throw new UserError(CASH_REQUEST_TEXT.closed);
      if (gate === "request") return { kind: "needsApproval" as const, request: "kasa-duzeltme" as const, gate: laterReport ? ("kilitli" as const) : ("gec" as const) };
    }
    const out = await writeCashReport(tx, me, data, { revision, countedBy, photos, prev });
    // Gün artık raporlu: bekleyen geç rapor istekleri kapanır (reddedilmez), Z fotoğrafları kanıt olarak 30 gün kalır
    if (!prev) {
      await supersede(tx, { kinds: ["kasa-gec"], subject: `gun:${data.date}` }, me.role === "admin" ? "Yönetici günü kendisi girdi" : "Bu günün raporu girildi", now, DELETED_REPORT_DAYS);
    }
    return { kind: "saved" as const, ...out };
  });
}

/**
 * Kasa e-postasının alıcılarından personel hesaplarına ait olanlar (küçük harfle): kasa e-postasında karaoke ön ödemesi
 * var, personel tutarları görmez (updateCashSettings reddeder)
 */
export async function staffEmailsIn(db: DB | CashTx, emails: readonly string[]): Promise<string[]> {
  if (!emails.length) return [];
  const rows = await db
    .select({ email: s.users.email })
    .from(s.users)
    .where(and(eq(s.users.role, "staff"), inArray(sql`lower(${s.users.email})`, emails.map((e) => e.toLocaleLowerCase("en")))));
  return rows.map((r) => r.email.toLocaleLowerCase("en"));
}

/**
 * Kasa e-postasının gönderim anındaki alıcıları: kayıtlı adreslerden personel hesaplarına ait olanlar düşer (ayarlar
 * kaydedildikten sonra personele indirilen ya da personel hesabı açılan adres: kasa e-postasında karaoke ön ödemesi
 * var). Kural ayarı kaydederken de denetlenir (updateCashSettings); gönderim ona güvenmez. Sıra korunur.
 */
export async function cashEmailRecipients(db: DB | CashTx, emails: readonly string[]): Promise<string[]> {
  const staff = new Set(await staffEmailsIn(db, emails));
  return emails.filter((e) => !staff.has(e.toLocaleLowerCase("en")));
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
  });
  if (!row) throw new UserError("Rapor bulunamadı");
  const superseded = await supersede(tx, { kinds: ["kasa-duzeltme", "kasa-silme", "foto-kaldir"], day: row.date, exceptId: o.exceptRequestId }, "Rapor silindi");
  return { row, photos: links.length, superseded };
}
