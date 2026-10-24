import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import type { CashReportExtras, CashReportFields } from "@/lib/cash-report";
import { normalizePos, normalizeZ, savedFields, suspiciousDiffs, type CashPhotoKind, type CashReading } from "@/lib/photo-read/kasa";
import { KasaPosRaw, KasaZRaw } from "@/lib/photo-read/schemas";
import { cashOutsOn, type CashOutDTO } from "@/server/data/cash-outs";
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

/**
 * Raporların fotoğrafları ve okumaları. Okuma ai_calls.result'tan (doğrulanmış ham okuma) saf kodla yeniden
 * çıkarılır; yalnız ham okumaya ve raporun gününe bakar. Z no sırası denetimi (önceki raporun Z no'su) okurken formda
 * söylenir, burada yapılmaz: sonradan geçmiş bir güne girilen rapor kayıtlı raporun "Fotoğraftan farklı" alarmını
 * değiştirmesin.
 */
export async function cashReportPhotoInfo(reports: { id: number; date: string }[]): Promise<Map<number, CashPhotoInfo>> {
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
    if (l.kind !== "kasa-z" && l.kind !== "kasa-pos") continue;
    const info = out.get(l.reportId) ?? { photos: [], readings: [] };
    info.photos.push({ id: l.id, kind: l.kind, createdAt: l.createdAt.toISOString(), byName: l.byName });
    // Fotoğrafın şimdiki türüyle yapılmış son başarılı okuma (öteki bölüme okutulduysa tür değişmiştir)
    const call = calls.find((c) => c.photoId === l.id && c.feature === l.kind);
    const reading = call ? readingOf(l.kind, call.result, dayOf.get(l.reportId)!) : null;
    if (reading) info.readings.push(reading);
    out.set(l.reportId, info);
  }
  return out;
}

/**
 * İstekte tutulan fotoğraflar (geç kasa raporu; rapora bağlı değil): küçük resim bilgisi ve son başarılı okumaları,
 * okuma raporun gününe (D) göre yeniden kurulur. Silinmiş ya da süresi dolmuş fotoğraf listede yok. Sıra istekteki gibi.
 */
export async function heldPhotoInfo(photoIds: readonly number[], day: string): Promise<CashPhotoInfo> {
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
    if (!p || (p.kind !== "kasa-z" && p.kind !== "kasa-pos") || (p.expiresAt && p.expiresAt.getTime() <= now.getTime())) continue;
    info.photos.push({ id: p.id, kind: p.kind, createdAt: p.createdAt.toISOString(), byName: p.byName });
    const call = calls.find((c) => c.photoId === p.id && c.feature === p.kind);
    const reading = call ? readingOf(p.kind, call.result, day) : null;
    if (reading) info.readings.push(reading);
  }
  return info;
}

function readingOf(kind: CashPhotoKind, result: unknown, day: string): CashReading | null {
  if (kind === "kasa-z") {
    const raw = KasaZRaw.safeParse(result);
    return raw.success ? normalizeZ(raw.data, { day, prevZNo: null }) : null;
  }
  const raw = KasaPosRaw.safeParse(result);
  return raw.success ? normalizePos(raw.data, { day }) : null;
}

/** Yüklenmiş bilgiden WhatsApp ve e-posta ekleri: fotoğraflar, net okunmuş ama farklı yazılan alanlar, kasadan çıkanlar */
export function extrasFrom(info: CashPhotoInfo | undefined, outs: CashOutDTO[], report: CashReportFields): CashReportExtras {
  return {
    photos: info?.photos.length ? { z: info.photos.some((p) => p.kind === "kasa-z"), pos: info.photos.some((p) => p.kind === "kasa-pos") } : null,
    photoDiffs: info ? suspiciousDiffs(info.readings, savedFields(report)) : null,
    cashOuts: outs.map((o) => ({ kind: o.kind, amount: o.amount, store: o.store, description: o.description, photo: o.photoId !== null })),
  };
}

/** Kayıtlı raporun WhatsApp ve e-posta ekleri */
export async function cashReportExtras(report: { id: number } & CashReportFields): Promise<CashReportExtras> {
  const [info, outs] = await Promise.all([cashReportPhotoInfo([report]), cashOutsOn(report.date)]);
  return extrasFrom(info.get(report.id), outs, report);
}
