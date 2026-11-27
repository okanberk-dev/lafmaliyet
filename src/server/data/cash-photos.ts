import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import type { CashReportExtras, CashReportFields } from "@/lib/cash-report";
import type { Role } from "@/lib/constants";
import { normalizePos, normalizeZ, savedFields, suspiciousDiffs, type CashPhotoKind, type CashReading } from "@/lib/photo-read/kasa";
import { normalizeOkc, okcReadFigures, toStaffReading, type OkcReadFigures } from "@/lib/photo-read/okc";
import { KasaOkcRaw, KasaPosRaw, KasaZRaw } from "@/lib/photo-read/schemas";
import { asilposDiffs } from "@/lib/asilpos/diffs";
import { asilposMovesPending, unreceiptedCashOut, type AsilposDay } from "@/lib/asilpos/prefill";
import { cashOutsOn, cashOutsShownTo, type CashOutDTO } from "@/server/data/cash-outs";
import { loadKasaAsilpos } from "@/server/data/asilpos-day";
import { getDb, schema as s } from "@/server/db";

/** Rapora bağlı fotoğraf (ekranda küçük resim ve "Z raporu · 23:52 · Ayşe") */
export interface CashPhotoDTO {
  id: number;
  kind: CashPhotoKind;
  createdAt: string;
  byName: string | null;
}

export interface CashPhotoInfo {
  photos: CashPhotoDTO[];
  /** Fotoğrafların son başarılı okumaları, eskiden yeniye (sunucuda saklanan okumadan yeniden hesaplanır) */
  readings: CashReading[];
}

/** Okumayı kim alır: personele yazarkasa okumasının kümülatifi, yazarkasa dışı tahsilatı ve yöneticinin satırları gitmez (D17) */
export type ReadingAudience = "admin" | "staff";

const forAudience = (r: CashReading, audience: ReadingAudience) => (audience === "admin" ? r : toStaffReading(r));

/**
 * Raporların fotoğrafları ve okumaları. Okuma ai_calls.result'tan (doğrulanmış ham okuma) saf kodla yeniden
 * çıkarılır; yalnız ham okumaya ve raporun gününe bakar. Z no sırası denetimi (önceki raporun Z no'su) okurken formda
 * söylenir, burada yapılmaz: sonradan geçmiş bir güne girilen rapor kayıtlı raporun "Fotoğraftan farklı" alarmını
 * değiştirmesin.
 */
export async function cashReportPhotoInfo(reports: { id: number; date: string }[], audience: ReadingAudience = "staff"): Promise<Map<number, CashPhotoInfo>> {
  const out = new Map<number, CashPhotoInfo>();
  if (!reports.length) return out;
  const db = getDb();
  const links = await db
    .select({ reportId: s.cashReportPhotos.reportId, id: s.photos.id, kind: s.photos.kind, createdAt: s.photos.createdAt, byName: s.photos.createdByName })
    .from(s.cashReportPhotos)
    .innerJoin(s.photos, eq(s.photos.id, s.cashReportPhotos.photoId))
    .where(inArray(s.cashReportPhotos.reportId, reports.map((r) => r.id)))
    .orderBy(asc(s.photos.createdAt), asc(s.photos.id));
  if (!links.length) return out;
  const calls = await db
    .select({ photoId: s.aiCalls.photoId, feature: s.aiCalls.feature, result: s.aiCalls.result })
    .from(s.aiCalls)
    .where(and(inArray(s.aiCalls.photoId, links.map((l) => l.id)), eq(s.aiCalls.status, "ok")))
    .orderBy(desc(s.aiCalls.at), desc(s.aiCalls.id));
  const dayOf = new Map(reports.map((r) => [r.id, r.date]));
  for (const l of links) {
    if (l.kind !== "kasa-z" && l.kind !== "kasa-pos" && l.kind !== "kasa-okc") continue;
    const info = out.get(l.reportId) ?? { photos: [], readings: [] };
    info.photos.push({ id: l.id, kind: l.kind, createdAt: l.createdAt.toISOString(), byName: l.byName });
    // Fotoğrafın şimdiki türüyle yapılmış son başarılı okuma (öteki bölüme okutulduysa tür değişmiştir)
    const call = calls.find((c) => c.photoId === l.id && c.feature === l.kind);
    const reading = call ? readingOf(l.kind, call.result, dayOf.get(l.reportId)!) : null;
    if (reading) info.readings.push(forAudience(reading, audience));
    out.set(l.reportId, info);
  }
  return out;
}

/**
 * İstekte tutulan fotoğraflar (geç kasa raporu; rapora bağlı değil): küçük resim bilgisi ve son başarılı okumaları,
 * okuma raporun gününe (D) göre yeniden kurulur. Silinmiş ya da süresi dolmuş fotoğraf listede yok. Sıra istekteki gibi.
 */
export async function heldPhotoInfo(photoIds: readonly number[], day: string, audience: ReadingAudience = "staff"): Promise<CashPhotoInfo> {
  if (!photoIds.length) return { photos: [], readings: [] };
  const db = getDb();
  const now = new Date();
  const rows = await db
    .select({ id: s.photos.id, kind: s.photos.kind, createdAt: s.photos.createdAt, byName: s.photos.createdByName, expiresAt: s.photos.expiresAt })
    .from(s.photos)
    .where(inArray(s.photos.id, [...photoIds]));
  const calls = rows.length
    ? await db
        .select({ photoId: s.aiCalls.photoId, feature: s.aiCalls.feature, result: s.aiCalls.result })
        .from(s.aiCalls)
        .where(and(inArray(s.aiCalls.photoId, rows.map((r) => r.id)), eq(s.aiCalls.status, "ok")))
        .orderBy(desc(s.aiCalls.at), desc(s.aiCalls.id))
    : [];
  const info: CashPhotoInfo = { photos: [], readings: [] };
  for (const id of photoIds) {
    const p = rows.find((r) => r.id === id);
    if (!p || (p.kind !== "kasa-z" && p.kind !== "kasa-pos" && p.kind !== "kasa-okc") || (p.expiresAt && p.expiresAt.getTime() <= now.getTime())) continue;
    info.photos.push({ id: p.id, kind: p.kind, createdAt: p.createdAt.toISOString(), byName: p.byName });
    const call = calls.find((c) => c.photoId === p.id && c.feature === p.kind);
    const reading = call ? readingOf(p.kind, call.result, day) : null;
    if (reading) info.readings.push(forAudience(reading, audience));
  }
  return info;
}

type Reader = Pick<ReturnType<typeof getDb>, "select">;

/** Fotoğrafların son başarılı yazarkasa Z okumaları, fotoğrafların sırasıyla (raporun gününe göre yeniden kurulur) */
async function okcReadingsOf(db: Reader, photoIds: readonly number[], day: string): Promise<CashReading[]> {
  if (!photoIds.length) return [];
  const calls = await db
    .select({ photoId: s.aiCalls.photoId, result: s.aiCalls.result })
    .from(s.aiCalls)
    .where(and(inArray(s.aiCalls.photoId, [...photoIds]), eq(s.aiCalls.feature, "kasa-okc"), eq(s.aiCalls.status, "ok")))
    .orderBy(desc(s.aiCalls.at), desc(s.aiCalls.id));
  const out: CashReading[] = [];
  for (const id of photoIds) {
    const call = calls.find((c) => c.photoId === id);
    const reading = call ? readingOf("kasa-okc", call.result, day) : null;
    if (reading) out.push(reading);
  }
  return out;
}

/**
 * Raporun sunucu sütunlarının girdisi (writeCashReport, işlem içinden; docs/planlar/okc-z.md §6.1): rapora bağlı
 * yazarkasa Z fotoğraflarının (eskiden yeniye) okumalarından birleşik rakamlar. Fotoğraf ya da okuma yoksa null
 */
export async function okcReadOfReport(db: Reader, reportId: number, day: string): Promise<OkcReadFigures | null> {
  const links = await db
    .select({ id: s.photos.id })
    .from(s.cashReportPhotos)
    .innerJoin(s.photos, eq(s.photos.id, s.cashReportPhotos.photoId))
    .where(and(eq(s.cashReportPhotos.reportId, reportId), eq(s.photos.kind, "kasa-okc")))
    .orderBy(asc(s.photos.createdAt), asc(s.photos.id));
  return okcReadFigures(await okcReadingsOf(db, links.map((l) => l.id), day));
}

/**
 * Tek fotoğrafın son başarılı okuması (fotoğrafın şimdiki türüyle), raporun gününe göre yeniden kurulur; okunmadıysa
 * null. Fotoğraf kaldırma isteği ve onayı bununla fotoğrafın okuma farkına bakar.
 */
export async function photoReadingOf(db: Pick<ReturnType<typeof getDb>, "select">, photoId: number, kind: CashPhotoKind, day: string): Promise<CashReading | null> {
  const [call] = await db
    .select({ result: s.aiCalls.result })
    .from(s.aiCalls)
    .where(and(eq(s.aiCalls.photoId, photoId), eq(s.aiCalls.feature, kind), eq(s.aiCalls.status, "ok")))
    .orderBy(desc(s.aiCalls.at), desc(s.aiCalls.id))
    .limit(1);
  return call ? readingOf(kind, call.result, day) : null;
}

function readingOf(kind: CashPhotoKind, result: unknown, day: string): CashReading | null {
  if (kind === "kasa-z") {
    const raw = KasaZRaw.safeParse(result);
    return raw.success ? normalizeZ(raw.data, { day, prevZNo: null }) : null;
  }
  // Yazarkasa Z'si: kayıtlı okuma önceki Z'siz yeniden kurulur (alan değerleri ve farklar için; zincir yalnız okumada).
  // Tam okumadır (yöneticinin satırları ve kümülatifiyle); personele forAudience ile süzülür. PR-b'de fotoğrafın son
  // başarılı okumasıdır; aynı fotoğrafın okumalarının birleştirilmesi PR-c'de (plan §5.6)
  if (kind === "kasa-okc") {
    const raw = KasaOkcRaw.safeParse(result);
    return raw.success ? normalizeOkc(raw.data, { day, prev: { z: null } }) : null;
  }
  const raw = KasaPosRaw.safeParse(result);
  return raw.success ? normalizePos(raw.data, { day }) : null;
}

/**
 * Yüklenmiş bilgiden WhatsApp ve e-posta ekleri: fotoğraflar, net okunmuş ama farklı yazılan alanlar, kasadan çıkanlar;
 * AsilPOS gününde (`asilpos`: gün AsilPOS günü mü ve gelen özeti; src/server/data/asilpos-day.ts loadKasaAsilpos) Z
 * bölümünün adı ve AsilPOS'tan farklı yazılanlar (E-09). Verilmezse ModPOS: metin bugünkü gibi
 */
export function extrasFrom(info: CashPhotoInfo | undefined, outs: CashOutDTO[], report: CashReportFields, asilpos?: { asilpos: boolean; day: AsilposDay | null } | null): CashReportExtras {
  return {
    ...(asilpos?.asilpos ? { kasa: "AsilPOS" as const, asilposDiffs: asilpos.day ? asilposDiffs(report, asilpos.day) : null, cardExtra: asilpos.day?.cardExtra || null, offDevice: asilpos.day?.offDevice ?? null } : {}),
    // ModPOS Z'si, banka POS Z'si (yazarkasa; geçişte eski sayfanın yüklemesi de kasa-okc olur) ve eski banka fişi ayrı
    // adlarla (photosLine; docs/planlar/okc-z.md §8)
    photos: info?.photos.length
      ? { z: info.photos.some((p) => p.kind === "kasa-z"), okc: info.photos.some((p) => p.kind === "kasa-okc"), pos: info.photos.some((p) => p.kind === "kasa-pos") }
      : null,
    photoDiffs: info ? suspiciousDiffs(info.readings, savedFields(report)) : null,
    photoRead: Boolean(info?.readings.length),
    cashOuts: outs.map((o) => ({ kind: o.kind, amount: o.amount, store: o.store, description: o.description, photo: o.photoId !== null })),
    // Fişsiz çıkış (bulgu 2): onay kartlarıyla aynı hesap; AsilPOS gününde girilmemiş teslim fişsiz sayılmaz, gün sonu
    // gelmemişse (hareketler bekleniyor) ve Kasadan çıkanlar'dan önceki günde hesaplanmaz
    unreceipted: asilposMovesPending(asilpos) ? null : unreceiptedCashOut(report.cashOut, outs, asilpos?.asilpos ? (asilpos.day?.till ?? null) : null, report.date).unreceipted || null,
  };
}

/**
 * Kayıtlı raporun WhatsApp ve e-posta ekleri (AsilPOS gününde AsilPOS'tan farklı yazılanlar da). `viewer`: metni ekranda
 * alan kişinin rolü (WhatsApp); müdüre yöneticinin kategorisindeki satır yalnız tutarıyla (cashOutsShownTo). E-posta
 * (alıcıları yönetici ve muhasebe) verilmeden bütün satırla
 */
export async function cashReportExtras(report: { id: number; branchId: string } & CashReportFields, viewer?: Role): Promise<CashReportExtras> {
  // Raporun kendi kasası: kasadan çıkanlar ve AsilPOS günü raporun şubesinin
  const [info, outs, asilpos] = await Promise.all([cashReportPhotoInfo([report]), cashOutsOn(report.date, report.branchId), loadKasaAsilpos(report.date, undefined, report.branchId)]);
  return extrasFrom(info.get(report.id), viewer ? await cashOutsShownTo(viewer, outs) : outs, report, asilpos);
}
