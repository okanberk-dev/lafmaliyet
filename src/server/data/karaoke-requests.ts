import "server-only";

import { and, asc, count, desc, eq, gt, inArray, max, min, or } from "drizzle-orm";

import { phase, sessionEnd, trClock, type KaraokeSessionDTO } from "@/lib/karaoke/session";
import { KaraokeDeletePayload, sessionName, sessionWhen, type KaraokeDeleteAsk } from "@/lib/karaoke/timer-requests";
import { waitedText } from "@/lib/staff-requests";
import { getDb, schema as s } from "@/server/db";
import { toSessionDTO } from "@/server/karaoke/board";

/*
 * Karaoke sayacı silme isteklerinin okumaları (denetim E-15; docs/KARAOKE.md › Sayacı silmek; docs/ONAYLAR.md). Tür
 * `karaoke-sil`. Personelin ve bar ekranının okuyucuları önce: yük beyaz listeyle (zamanlar), etiket, neden ve tutar
 * gitmez. Yöneticinin okuyucuları ("Yönetici" bölümü) kartın bağlamını kurar (oturumun bugünkü hâli; tutar yok,
 * panel sayacının tutarı olmaz).
 */

const DAY_MS = 86_400_000;
const KIND = "karaoke-sil" as const;
const sessionIdOf = (subject: string) => Number(subject.split(":")[1]) || 0;

/** Bekleyen silme istekleri (canlı uç, bar ekranının satırları): hangi sayaç, kim istedi; neden ve yük yok */
export async function pendingKaraokeAsks(): Promise<KaraokeDeleteAsk[]> {
  const rows = await getDb()
    .select({ id: s.staffRequests.id, subject: s.staffRequests.subject, by: s.staffRequests.requestedByName, byId: s.staffRequests.requestedBy })
    .from(s.staffRequests)
    .where(and(eq(s.staffRequests.kind, KIND), eq(s.staffRequests.status, "pending")))
    .orderBy(asc(s.staffRequests.id))
    .limit(50);
  return rows.map((r) => ({ sessionId: sessionIdOf(r.subject), requestId: r.id, by: r.by, byId: r.byId })).filter((r) => r.sessionId > 0);
}

export interface MyKaraokeRequest {
  id: number;
  status: string;
  /** "24 Eki 21:00–23:00" (yükün zamanlarından) */
  when: string | null;
  reviewNote: string | null;
  /** ISO */
  updatedAt: string;
}

/** Kişinin sayaç silme istekleri: bekleyenler ve son 7 günde sonuçlananlar (zil), en yeni önce. Yükten yalnız zamanlar */
export async function myKaraokeRequests(userId: number, now: Date = new Date()): Promise<MyKaraokeRequest[]> {
  const rows = await getDb()
    .select({
      id: s.staffRequests.id,
      status: s.staffRequests.status,
      body: s.staffRequests.payload,
      reviewNote: s.staffRequests.reviewNote,
      updatedAt: s.staffRequests.updatedAt,
    })
    .from(s.staffRequests)
    .where(
      and(
        eq(s.staffRequests.requestedBy, userId),
        eq(s.staffRequests.kind, KIND),
        or(eq(s.staffRequests.status, "pending"), gt(s.staffRequests.updatedAt, new Date(now.getTime() - 7 * DAY_MS))),
      ),
    )
    .orderBy(desc(s.staffRequests.updatedAt), desc(s.staffRequests.id))
    .limit(20);
  return rows.map((r) => {
    const p = KaraokeDeletePayload.safeParse(r.body);
    return { id: r.id, status: r.status, when: p.success ? sessionWhen(p.data) : null, reviewNote: r.reviewNote, updatedAt: r.updatedAt.toISOString() };
  });
}

// ---------------------------------------------------------------- Yönetici

/** Bekleyen sayaç silme istekleri: sayı, en eski, ilk kart ve zil kimliği (en yeni bump) */
export async function pendingKaraokeSummary(): Promise<{ count: number; oldestAt: Date | null; firstId: number | null; bumped: Date | null }> {
  const r = s.staffRequests;
  const where = and(eq(r.kind, KIND), eq(r.status, "pending"));
  const [[agg], [first]] = await Promise.all([
    getDb()
      .select({ n: count(), oldest: min(r.createdAt), bumped: max(r.bumpedAt) })
      .from(r)
      .where(where),
    getDb().select({ id: r.id }).from(r).where(where).orderBy(asc(r.createdAt), asc(r.id)).limit(1),
  ]);
  return { count: agg?.n ?? 0, oldestAt: agg?.oldest ?? null, firstId: first?.id ?? null, bumped: agg?.bumped ?? null };
}

export interface KaraokeDeleteCard {
  id: number;
  version: number;
  title: string;
  requestedBy: number | null;
  requestedByName: string;
  /** ISO */
  createdAt: string;
  waited: string;
  message: string | null;
  sessionId: number;
  /** Sayaç yok (arada silindi): onay "Kapat" olur */
  gone: boolean;
  /** Sayacın bugünkü hâli (yoksa istekteki) */
  name: string;
  when: string;
  guests: number | null;
  /** "Ayşe açtı · 21:00" */
  openedText: string;
  /** "Sürüyor · 1 saat 20 dk kaldı", "Bitti 22:40 (Mehmet)", "Süre doldu", "Başlamadı" */
  stateText: string;
  /** İstekten sonra ne değişti ("İstekten sonra 30 dk uzatıldı", "İstekten sonra bitirildi (Mehmet)") */
  changed: string[];
  /** Aynı sayaç için başka bekleyen istek (isteyenin adı) */
  otherPending: string[];
}

/** Sayacın bugünkü durumu, tutarsız tek satır */
function stateText(dto: KaraokeSessionDTO, now: number): string {
  const p = phase(dto, now);
  if (p === "done") return dto.endedAt ? `Bitti ${trClock(Date.parse(dto.endedAt)).time}${dto.endedBy ? ` (${dto.endedBy})` : ""}` : "Süresi bitti";
  if (p === "overtime") return "Süre doldu, susturulmadı";
  if (p === "upcoming") return "Başlamadı";
  const left = Math.max(0, Math.round((sessionEnd(dto) - now) / 60_000));
  return `Sürüyor · ${left >= 60 ? `${Math.floor(left / 60)} saat ${left % 60 ? `${left % 60} dk ` : ""}` : `${left} dk `}kaldı`;
}

/** Onaylar › Karaoke: bekleyen sayaç silme istekleri, en eski önce; sayacın bugünkü hâliyle */
export async function loadKaraokeRequestQueue(now: Date = new Date()): Promise<KaraokeDeleteCard[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(s.staffRequests)
    .where(and(eq(s.staffRequests.kind, KIND), eq(s.staffRequests.status, "pending")))
    .orderBy(asc(s.staffRequests.createdAt), asc(s.staffRequests.id));
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => sessionIdOf(r.subject)).filter((id) => id > 0))];
  const sessions = ids.length ? await db.select().from(s.karaokeSessions).where(inArray(s.karaokeSessions.id, ids)) : [];
  const byId = new Map(sessions.map((x) => [x.id, x]));
  const t = now.getTime();
  return rows.flatMap((r): KaraokeDeleteCard[] => {
    const parsed = KaraokeDeletePayload.safeParse(r.payload);
    if (!parsed.success) return [];
    const p = parsed.data;
    const row = byId.get(p.sessionId);
    const gone = !row || row.source !== "panel" || row.startsAt.getTime() !== Date.parse(p.startsAt);
    const dto = row && !gone ? toSessionDTO(row, { admin: false }) : null;
    const changed: string[] = [];
    if (dto) {
      const added = dto.extraMinutes - p.extraMinutes;
      if (added > 0) changed.push(`İstekten sonra ${added} dk uzatıldı`);
      if (dto.endedAt && !p.endedAt) changed.push(`İstekten sonra bitirildi${dto.endedBy ? ` (${dto.endedBy})` : ""}`);
      if (!dto.endedAt && p.endedAt) changed.push("İstekten sonra yeniden açıldı");
    }
    const others = rows.filter((o) => o.id !== r.id && o.subject === r.subject).map((o) => o.requestedByName);
    const createdBy = dto?.createdBy ?? p.createdBy;
    return [
      {
        id: r.id,
        version: r.version,
        title: r.title,
        requestedBy: r.requestedBy,
        requestedByName: r.requestedByName,
        createdAt: r.createdAt.toISOString(),
        waited: waitedText(r.createdAt, now),
        message: r.message,
        sessionId: p.sessionId,
        gone,
        name: dto ? sessionName(dto) : "Rezervasyonsuz oturum",
        when: dto ? sessionWhen(dto) : sessionWhen(p),
        guests: dto?.guests ?? p.guests,
        openedText: `${createdBy ? `${createdBy} açtı` : "Panelden açıldı"} · ${trClock(Date.parse(p.startsAt)).time}`,
        stateText: dto ? stateText(dto, t) : "Sayaç zaten silinmiş",
        changed,
        otherPending: [...new Set(others)],
      },
    ];
  });
}
