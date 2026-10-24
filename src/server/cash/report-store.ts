import "server-only";

import { count, desc, eq, gt, lt } from "drizzle-orm";
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
  type CashReportFields,
  type FieldChange,
} from "@/lib/cash-report";
import { DELETED_REPORT_DAYS, linkedUntil, MAX_REPORT_PHOTOS } from "@/lib/photo-rules";
import { todayTR } from "@/lib/reminders";
import { zAmount, zDate, zOptText } from "@/server/actions/util";
import { schema as s, type DB } from "@/server/db";
import { getPhoto, keepPhoto, linkable, releasePhoto } from "@/server/storage/photos";
import { UserError } from "@/server/user-error";

/*
 * Kasa raporunun yazım yolu (docs/KASA-RAPORU.md): formun şeması, raporun kaydı (yeni ya da yeni sürüm) ve silinmesi.
 * Personelin ve yöneticinin gönderimi (submitCashReport) ve yöneticinin onayları (src/server/actions/cash-requests.ts)
 * aynı işlevlerden geçer: devir, açılış notu, teslim, sayan ve fotoğraf denetimleri tek yerde. Sunucu eylemi değil
 * ("use server" yok): dışarıdan çağrılan uç yok; oturum ve rol denetimi eylemlerde. Veritabanını ya da işlemi parametre
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
  if (prev && prev.revision !== o.revision) {
    throw new UserError(`Bu günün raporunu az önce ${prev.submittedByName} gönderdi; sayfayı yenileyip onun girdiklerini kontrol edin`);
  }
  if (!prev && o.revision !== 0) throw new UserError("Rapor bu arada silinmiş; sayfayı yenileyin");
  const submitter = o.submittedBy ?? { id: actor.id, name: actor.name };
  // Kasayı sayan: etkin bir kullanıcı ya da raporda zaten kayıtlı olan (sonradan pasif olsa da)
  const counter = await resolveCounter(tx, o.countedBy ?? submitter.id ?? actor.id, prev ? (prev.countedBy ?? prev.submittedBy) : null);
  // Açılış önceki raporun devriyle tutmuyorsa nedeni nota yazılır (yeni raporda ya da açılış değiştiyse)
  const check = carryCheck(data.date, data.openingCash, await carryBefore(tx, data.date));
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

export type SaveResult = { kind: "saved" } & WriteResult;

/**
 * Formdan gönderilen raporu kaydeder (personel ve yönetici; submitCashReport). İleri gün yok; personel yalnız bugünü ve
 * dünü girer, ertesi günün raporu girildiyse kayıtlı raporu düzeltemez (staffDayEditable).
 */
export async function saveCashReport(db: DB, me: CashActor, input: ReportInput, now = new Date()): Promise<SaveResult> {
  const { revision, photos, countedBy, ...data } = input;
  if (data.date > businessDate(now)) throw new UserError("İleri bir günün raporu girilemez");
  if (me.role !== "admin" && !staffCanReport(data.date, now)) throw new UserError("Personel yalnız bugünün ve dünün raporunu girebilir; daha eskisi için yöneticiye yazın");
  return db.transaction(async (tx) => {
    const prev = await lockCashReport(tx, data.date);
    // Ertesi günün raporu girildiyse personel bu raporu düzeltemez: ertesi günün açılışı bu raporun devrine dayanır
    // (staffDayEditable). Eksik bir günü sonradan girmek serbest (rapor yok)
    if (prev && me.role !== "admin" && (await hasLaterReport(tx, data.date))) throw new UserError("Ertesi günün raporu girildi; bu raporu artık yalnız yönetici düzeltebilir");
    const out = await writeCashReport(tx, me, data, { revision, countedBy, photos, prev });
    return { kind: "saved" as const, ...out };
  });
}

/**
 * Raporu siler (işlemin içinde; yönetici): fotoğrafların bağı kalkar, 30 gün daha saklanır; önceki sürümleri raporla
 * gider (cascade). Silinen raporun değerleri dönüşte (işlem geçmişine yazılır).
 */
export async function removeCashReport(tx: CashTx, id: number) {
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
  return { row, photos: links.length };
}
