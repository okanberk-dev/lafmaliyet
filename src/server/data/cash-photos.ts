import "server-only";

import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";

import type { CashReportExtras, CashReportFields } from "@/lib/cash-report";
import { normalizePos, normalizeZ, savedFields, suspiciousDiffs, type CashPhotoKind, type CashReading } from "@/lib/photo-read/kasa";
import { KasaPosRaw, KasaZRaw } from "@/lib/photo-read/schemas";
import { addDays } from "@/lib/reminders";
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
 * çıkarılır; Z no denetimi için raporun gününden önceki son raporun Z no'su kullanılır (okurkenki gibi).
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
  const dates = reports.map((r) => r.date).sort();
  const earlier = await db
    .select({ date: s.cashReports.date, zNo: s.cashReports.zNo })
    .from(s.cashReports)
    .where(and(gte(s.cashReports.date, addDays(dates[0], -60)), lt(s.cashReports.date, dates[dates.length - 1])))
    .orderBy(asc(s.cashReports.date));
  const prevZNo = (day: string) => [...earlier].reverse().find((r) => r.date < day)?.zNo ?? null;
  const dayOf = new Map(reports.map((r) => [r.id, r.date]));
  for (const l of links) {
    if (l.kind !== "kasa-z" && l.kind !== "kasa-pos") continue;
    const info = out.get(l.reportId) ?? { photos: [], readings: [] };
    info.photos.push({ id: l.id, kind: l.kind, createdAt: l.createdAt.toISOString(), byName: l.byName });
    // Fotoğrafın şimdiki türüyle yapılmış son başarılı okuma (öteki bölüme okutulduysa tür değişmiştir)
    const call = calls.find((c) => c.photoId === l.id && c.feature === l.kind);
    const day = dayOf.get(l.reportId)!;
    const reading = call ? readingOf(l.kind, call.result, day, prevZNo(day)) : null;
    if (reading) info.readings.push(reading);
    out.set(l.reportId, info);
  }
  return out;
}

function readingOf(kind: CashPhotoKind, result: unknown, day: string, prevZNo: string | null): CashReading | null {
  if (kind === "kasa-z") {
    const raw = KasaZRaw.safeParse(result);
    return raw.success ? normalizeZ(raw.data, { day, prevZNo }) : null;
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
