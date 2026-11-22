import "server-only";

import { and, asc, eq, gt, lt, sql } from "drizzle-orm";

import { deskKindOfChannel, refundKindOf, type KaraokeEvent, type KaraokeSessionDTO, type KaraokeStatus, type PaymentStatus } from "@/lib/karaoke/session";
import { getDb, schema as s } from "@/server/db";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const VERSION_KEY = "karaoke_version";
/** Sürüm sayacının anahtarı (canlı uç onu eşitleme durumuyla tek sorguda okur: sync.ts › readKaraokeLive) */
export const KARAOKE_VERSION_KEY = VERSION_KEY;

/**
 * Karaoke değişim sayacı: her eşitleme ve sayaç işleminde bir artar. Canlı uç (/api/canli) bunu ETag'e koyar; açık
 * sekmenin kontrolü değişiklik yoksa tek bir birincil anahtar okumasıyla 304 alır.
 */
export async function bumpKaraokeVersion(db: Db | Tx = getDb()): Promise<void> {
  await db.execute(sql`
    insert into integration_state (key, value) values (${VERSION_KEY}, '{"v":1}'::jsonb)
    on conflict (key) do update
      set value = jsonb_build_object('v', coalesce((integration_state.value->>'v')::bigint, 0) + 1), updated_at = now()`);
}

export async function karaokeVersion(): Promise<string> {
  const [row] = await getDb().select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, VERSION_KEY)).limit(1);
  return String((row?.value as { v?: number } | undefined)?.v ?? 0);
}

type Row = typeof s.karaokeSessions.$inferSelect;

export function toSessionDTO(r: Row, opts: { admin: boolean }): KaraokeSessionDTO {
  return {
    id: r.id,
    source: r.source,
    externalId: r.externalId,
    date: r.date,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    extraMinutes: r.extraMinutes,
    endedAt: r.endedAt?.toISOString() ?? null,
    endedBy: r.endedBy,
    guests: r.guests,
    customerName: r.customerName,
    note: r.note,
    status: r.status as KaraokeStatus,
    paymentStatus: r.paymentStatus as PaymentStatus,
    // Tutar yalnız yöneticiye
    totalMinor: opts.admin ? r.totalMinor : null,
    // İadenin türü herkese (tutarsız), tutarı yalnız yöneticiye
    refund: refundKindOf({
      status: r.status as KaraokeStatus,
      paymentStatus: r.paymentStatus as PaymentStatus,
      refundMinor: r.refundMinor,
      totalMinor: r.totalMinor,
    }),
    refundMinor: opts.admin ? r.refundMinor : null,
    lastEvent: (r.lastEvent as KaraokeEvent | null) ?? null,
    lastEventAt: r.lastEventAt?.toISOString() ?? null,
    createdBy: r.createdBy,
    // Köşkte alınan satır (elle rezervasyon ya da kapatılan saat): kanaldan (sync.ts › sessionChannel)
    desk: r.source === "site" ? deskKindOfChannel(r.channel) : null,
    bookedAt: r.bookedAt?.toISOString() ?? null,
  };
}

/** [from, to) aralığında başlayan ya da o aralıkta hâlâ süren oturumlar, başlangıç sırasıyla */
export async function loadSessions(from: Date, to: Date, opts: { admin: boolean }): Promise<KaraokeSessionDTO[]> {
  const rows = await getDb()
    .select()
    .from(s.karaokeSessions)
    // Sol taraf sütun değil, ifade: sürücü Date'i kendisi çevirmez, ISO metni verilir
    .where(and(lt(s.karaokeSessions.startsAt, to), gt(sql`${s.karaokeSessions.endsAt} + make_interval(mins => ${s.karaokeSessions.extraMinutes})`, from.toISOString())))
    .orderBy(asc(s.karaokeSessions.startsAt), asc(s.karaokeSessions.id))
    .limit(500);
  return rows.map((r) => toSessionDTO(r, opts));
}

/**
 * Canlı uyarıların penceresi: 12 saat önce bitenlerden yarının sonuna (Türkiye) kadar başlayacaklar. Bitiş takvim günü
 * olduğu için gün içinde sabit kalır; canlı ucun ETag'i günü içerir, gece yarısı pencere kendiliğinden ilerler.
 */
export function liveWindow(now = Date.now()): { from: Date; to: Date } {
  const trMidnight = Date.parse(`${new Date(now + 3 * 3_600_000).toISOString().slice(0, 10)}T00:00:00Z`) - 3 * 3_600_000;
  return { from: new Date(now - 12 * 3_600_000), to: new Date(trMidnight + 2 * 86_400_000) };
}

export async function getSession(id: number): Promise<Row | null> {
  const [row] = await getDb().select().from(s.karaokeSessions).where(eq(s.karaokeSessions.id, id)).limit(1);
  return row ?? null;
}
