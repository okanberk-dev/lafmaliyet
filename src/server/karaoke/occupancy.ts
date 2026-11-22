import "server-only";

import { and, asc, count, eq, gt, lt, sql } from "drizzle-orm";

import { businessDay, DEFAULT_ROOM_HOURS, occSessionsOf, parseRoomHours, type OccSession, type RoomHours } from "@/lib/karaoke/occupancy";
import { DESK_BLOCK_CHANNEL } from "@/lib/karaoke/session";
import { getDb, schema as s } from "@/server/db";

/**
 * Doluluk haritasının verisi (yalnız yönetici; hesap src/lib/karaoke/occupancy.ts'te): oturumların hesaba giren
 * sütunları (ad ve not okunmaz), oda saatleri ve verinin nereden başladığı. Ayrıntı: docs/KARAOKE.md › Doluluk haritası.
 */

const HOURS_KEY = "karaoke.hours";

/** Köşkün kapattığı saatler doluluk verisi değildir (rezervasyon, ciro ve doluluk saymaz; docs/KARAOKE.md) */
const notBlock = () => sql`${s.karaokeSessions.channel} is distinct from ${DESK_BLOCK_CHANNEL}`;

/**
 * [from, to) aralığında başlayan ya da o aralıkta hâlâ süren oturumlar (uzatma dahil), başlangıç sırasıyla. Kapatılan
 * saatler gelmez (occSessionsOf da ayıklar)
 */
export async function loadOccupancySessions(from: Date, to: Date): Promise<OccSession[]> {
  const k = s.karaokeSessions;
  const rows = await getDb()
    .select({
      id: k.id,
      source: k.source,
      startsAt: k.startsAt,
      endsAt: k.endsAt,
      extraMinutes: k.extraMinutes,
      endedAt: k.endedAt,
      guests: k.guests,
      status: k.status,
      paymentStatus: k.paymentStatus,
      totalMinor: k.totalMinor,
      bookedAt: k.bookedAt,
      cancelledAt: k.cancelledAt,
      lastEvent: k.lastEvent,
      lastEventAt: k.lastEventAt,
      channel: k.channel,
    })
    .from(k)
    // Sol taraf sütun değil, ifade: sürücü Date'i kendisi çevirmez, ISO metni verilir (board.ts loadSessions gibi)
    .where(and(lt(k.startsAt, to), gt(sql`${k.endsAt} + make_interval(mins => ${k.extraMinutes})`, from.toISOString()), notBlock()))
    .orderBy(asc(k.startsAt), asc(k.id))
    // Günde ~10 oturumla 6 ay ~2.000 satır; sınır yalnız taşmaya karşı
    .limit(20_000);
  return occSessionsOf(rows);
}

/** Oda saatleri: kaydedilmediyse varsayılan (her gün 12:00–24:00, sitenin karaoke saatleri) */
export async function readKaraokeHours(): Promise<{ hours: RoomHours; saved: boolean }> {
  const [row] = await getDb().select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, HOURS_KEY)).limit(1);
  const hours = parseRoomHours(row?.value);
  return { hours: hours ?? DEFAULT_ROOM_HOURS, saved: hours !== null };
}

export async function writeKaraokeHours(h: RoomHours, by: string): Promise<void> {
  const value = { open: h.open, close: h.close, by, at: new Date().toISOString() };
  await getDb()
    .insert(s.integrationState)
    .values({ key: HOURS_KEY, value })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
}

/**
 * Verinin başladığı yer: ilk site rezervasyonunun ve ilk rezervasyonsuz sayacın iş günü, ilk veri ayı, oturum sayısı
 * (kapatılan saatler sayılmaz)
 */
export async function karaokeCoverage(): Promise<{ firstSiteDay: string | null; firstTimerDay: string | null; firstMonth: string | null; total: number }> {
  const k = s.karaokeSessions;
  const [row] = await getDb()
    .select({
      site: sql<Date | null>`min(${k.startsAt}) filter (where ${k.source} = 'site')`.mapWith(k.startsAt),
      panel: sql<Date | null>`min(${k.startsAt}) filter (where ${k.source} = 'panel')`.mapWith(k.startsAt),
      total: count(),
    })
    .from(k)
    .where(notBlock());
  const day = (d: Date | null | undefined) => (d ? businessDay(d.getTime()) : null);
  const firstSiteDay = day(row?.site);
  const firstTimerDay = day(row?.panel);
  const first = [firstSiteDay, firstTimerDay].filter((d): d is string => d !== null).sort()[0] ?? null;
  return { firstSiteDay, firstTimerDay, firstMonth: first?.slice(0, 7) ?? null, total: row?.total ?? 0 };
}
