import "server-only";

import { and, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";

import { CATCH_UP, needsCatchUp } from "@/lib/karaoke/freshness";
import { detectEvent, pushMessages, type KaraokeEvent, type SiteReservation } from "@/lib/karaoke/session";
import { cancelledAtFor, goneSiteRows, parseSiteResponse, sessionChannel, siteTime, type SiteSnapshot } from "@/lib/karaoke/site";
import { fetchFailure, karaokePullError, siteErrorCode } from "@/lib/karaoke/sync-text";
import { addDays, todayTR } from "@/lib/reminders";
import { featureAudienceIds } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";
import { sendPush } from "@/server/push/send";
import { signedSiteFetch, siteLinkSecret, siteUrl } from "@/server/site-link";

import { bumpKaraokeVersion, KARAOKE_VERSION_KEY } from "./board";

// Anahtar, adres ve imzalı istek menü bağlantısıyla ortak (src/server/site-link.ts)
export { siteUrl };

/** Paylaşılan anahtar (iki projede aynı, en az 32 karakter); yoksa bağlantı kapalı */
export function karaokeSecret(): string | null {
  return siteLinkSecret();
}

const STATE_KEY = "karaoke_sync";

export interface SyncState {
  /** Son başarılı eşitleme */
  lastOkAt: string | null;
  /** Son deneme (başarılı ya da değil) */
  lastTryAt: string | null;
  lastError: string | null;
  /** Sitenin son pingi */
  lastPingAt: string | null;
  /** Uygulanan son yanıtın site saati (eski yanıt yenisinin üstüne yazılmasın) */
  lastSiteNow: string | null;
  /** Son eşitlemede sitede kaç rezervasyon vardı (pencerede) */
  count: number | null;
}

const EMPTY: SyncState = { lastOkAt: null, lastTryAt: null, lastError: null, lastPingAt: null, lastSiteNow: null, count: null };

export async function readSyncState(): Promise<SyncState> {
  const [row] = await getDb().select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, STATE_KEY)).limit(1);
  return { ...EMPTY, ...((row?.value as Partial<SyncState> | undefined) ?? {}) };
}

/**
 * Canlı ucun karaoke işaretleri tek sorguda: sürüm (ETag'e girer) ve eşitlemenin durumu (uyarı satırı ve kopyanın
 * tazelenmesi; src/lib/karaoke/freshness.ts)
 */
export async function readKaraokeLive(): Promise<{ version: string; sync: SyncState }> {
  const rows = await getDb()
    .select({ key: s.integrationState.key, value: s.integrationState.value })
    .from(s.integrationState)
    .where(inArray(s.integrationState.key, [KARAOKE_VERSION_KEY, STATE_KEY]));
  const value = (key: string) => rows.find((r) => r.key === key)?.value;
  return {
    version: String((value(KARAOKE_VERSION_KEY) as { v?: number } | undefined)?.v ?? 0),
    sync: { ...EMPTY, ...((value(STATE_KEY) as Partial<SyncState> | undefined) ?? {}) },
  };
}

async function patchState(patch: Partial<SyncState>, db: { execute: (query: SQL) => Promise<unknown> } = getDb()) {
  await db.execute(sql`
    insert into integration_state (key, value) values (${STATE_KEY}, ${JSON.stringify(patch)}::jsonb)
    on conflict (key) do update set value = integration_state.value || ${JSON.stringify(patch)}::jsonb, updated_at = now()`);
}

export async function notePing(): Promise<void> {
  await patchState({ lastPingAt: new Date().toISOString() });
}

export type SyncResult =
  | { status: "off" }
  | { status: "fresh" }
  | { status: "ok"; created: number; updated: number; removed: number; events: number; skipped: number }
  | { status: "error"; error: string };

/** Sayfa açılışında site en çok bu kadar sürede bir sorulur (ping yoksa bile liste bayatlamasın) */
const PAGE_SYNC_INTERVAL_MS = 5 * 60_000;

/**
 * Sitenin hata yanıtının yöneticiye okunur açıklaması; `code` gövdedeki hata kodu (503'te anahtar yok mu, veritabanı mı;
 * src/lib/karaoke/sync-text.ts). Geçmişi siteden alma da kullanır: history.ts.
 */
export function explain(status: number, code?: string | null): string {
  return karaokePullError({ kind: "http", status, code });
}

/** Hata yanıtının gövdesindeki kod ({"error":"unavailable"}); gövde okunamazsa null */
export async function errorCodeOf(res: Response): Promise<string | null> {
  try {
    return siteErrorCode(await res.json());
  } catch {
    return null;
  }
}

/**
 * Sitenin rezervasyonlarını çeker ve panelin kopyasına yazar. Pencere: dünden 90 gün sonrasına. Site her karaoke
 * değişikliğinde ping atar (/api/karaoke/ping); sayfa açılışı en çok beş dakikada bir sorar (ping kaçtıysa). Çekme
 * imzalıdır (src/lib/karaoke/signature.ts), panele yalnız ad, saat, kişi sayısı, durum ve not gelir.
 *
 * Yeni / iptal / saat değişikliği olayları web push ile bildirilir; ilk eşitlemede (geçmiş kayıtlar ilk kez
 * gelirken) ve bitmiş rezervasyonlarda bildirim gitmez. Eşzamanlı iki eşitleme sırayla yazar; eski yanıt yenisinin
 * üstüne yazılmaz. Sitede artık olmayan (silinen) rezervasyon, yanıt eksiksizse panelden de kalkar.
 */
export async function syncKaraoke(trigger: "ping" | "page" | "manual" | "cron" | "screen"): Promise<SyncResult> {
  const secret = karaokeSecret();
  if (!secret) return { status: "off" };
  const state = await readSyncState();
  if (trigger === "page" && state.lastOkAt && Date.now() - Date.parse(state.lastOkAt) < PAGE_SYNC_INTERVAL_MS) return { status: "fresh" };

  const from = addDays(todayTR(), -1);
  const to = addDays(from, 90);
  const url = new URL("/api/panel/karaoke", siteUrl());
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  const tryAt = new Date().toISOString();
  const failed = async (message: string): Promise<SyncResult> => {
    const error = message.slice(0, 300);
    await patchState({ lastTryAt: tryAt, lastError: error });
    // Hata ilk kez görünüyor ya da değişti: açık ekranlar uyarı satırını göstersin (canlı ucun ETag'i sürümden)
    if (state.lastError !== error) await bumpKaraokeVersion();
    return { status: "error", error };
  };
  let res: Response;
  try {
    res = await signedSiteFetch(secret, url);
  } catch (e) {
    return failed(karaokePullError(fetchFailure(e)));
  }
  if (!res.ok) return failed(explain(res.status, await errorCodeOf(res)));
  let snapshot: SiteSnapshot;
  try {
    snapshot = parseSiteResponse(await res.json());
  } catch (e) {
    // Gövde okunurken dolan süre zaman aşımıdır (8 sn), bozuk yanıt değil
    return failed(karaokePullError(e instanceof Error && e.name === "TimeoutError" ? { kind: "timeout" } : { kind: "format" }));
  }

  const firstSync = !state.lastOkAt;
  const now = new Date();
  const db = getDb();
  const applied = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('karaoke-sync'))`);
    const [cur] = await tx.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, STATE_KEY)).limit(1);
    const curState = (cur?.value as Partial<SyncState> | undefined) ?? {};
    const lastSiteNow = curState.lastSiteNow;
    // Arada daha yeni bir yanıt uygulandıysa bu eski kalır
    if (lastSiteNow && Date.parse(lastSiteNow) > Date.parse(snapshot.now)) return null;

    const existing = await tx
      .select()
      .from(s.karaokeSessions)
      .where(and(eq(s.karaokeSessions.source, "site"), gte(s.karaokeSessions.date, from), lte(s.karaokeSessions.date, to)));
    const byExt = new Map(existing.map((r) => [r.externalId, r]));
    // Tarihi pencerenin dışından içine kaymış rezervasyonlar da bulunsun (kimlik tekil)
    const outside = snapshot.reservations.map((r) => r.id).filter((id) => !byExt.has(id));
    if (outside.length) {
      for (const r of await tx.select().from(s.karaokeSessions).where(inArray(s.karaokeSessions.externalId, outside))) byExt.set(r.externalId, r);
    }
    const events: { event: KaraokeEvent; r: SiteReservation }[] = [];
    let created = 0;
    let updated = 0;
    for (const r of snapshot.reservations) {
      const prev = byExt.get(r.id);
      const event = detectEvent(prev ? { status: prev.status, paymentStatus: prev.paymentStatus, startsAt: prev.startsAt.getTime(), endsAt: prev.endsAt.getTime() } : null, r);
      const values = {
        externalId: r.id,
        source: "site" as const,
        date: r.date,
        startsAt: new Date(r.startsAt),
        endsAt: new Date(r.endsAt),
        guests: r.guests || null,
        customerName: r.firstName || null,
        note: r.note || null,
        status: r.status,
        paymentStatus: r.paymentStatus,
        totalMinor: r.totalMinor,
        // İptalin iadesi: "iade yok" ile "iade edildi" ayrımı (site göndermezse boş)
        refundMinor: r.refundMinor ?? null,
        // Köşkte alınan satır "desk", kapatılan saat "desk-block" (migration yok; DTO'nun `desk`'i buradan)
        channel: sessionChannel(r),
        extUpdatedAt: r.updatedAt || null,
        // Doluluk haritası için: rezervasyonun yapıldığı an ve iptal anı (docs/KARAOKE.md › Doluluk haritası)
        bookedAt: siteTime(r.createdAt),
        cancelledAt: cancelledAtFor(prev ?? null, r, now),
      };
      // Geçmiş ya da ilk eşitlemedeki kayıtlar olaysız yazılır (zil çalmaz, bildirim gitmez); kapatılan saat rezervasyon
      // değildir: ne eklenmesi ne kaldırılması zil çalar (köşkte elle alınan rezervasyon her rezervasyon gibi çalar)
      const notify = event !== null && !firstSync && Date.parse(r.endsAt) > now.getTime() && !r.block;
      const eventCols = notify ? { lastEvent: event, lastEventAt: now } : {};
      if (!prev) {
        await tx.insert(s.karaokeSessions).values({ ...values, ...eventCols });
        created++;
      } else {
        const same =
          prev.date === values.date &&
          prev.startsAt.getTime() === values.startsAt.getTime() &&
          prev.endsAt.getTime() === values.endsAt.getTime() &&
          prev.guests === values.guests &&
          prev.customerName === values.customerName &&
          prev.note === values.note &&
          prev.status === values.status &&
          prev.paymentStatus === values.paymentStatus &&
          prev.totalMinor === values.totalMinor &&
          // Yeniden satılan saatin iadesi yalnız bunu değiştirir (sitedeki updatedAt ve ödeme durumu aynı kalabilir)
          prev.refundMinor === values.refundMinor &&
          prev.channel === values.channel &&
          (prev.bookedAt?.getTime() ?? null) === (values.bookedAt?.getTime() ?? null) &&
          (prev.cancelledAt?.getTime() ?? null) === (values.cancelledAt?.getTime() ?? null);
        if (same && !notify) continue;
        // Saat değiştiyse sayaçtaki uzatma ve "bitti" sıfırlanır (yeni saatle yeniden çalsın)
        const timer = event === "changed" ? { extraMinutes: 0, endedAt: null, endedBy: null } : {};
        await tx
          .update(s.karaokeSessions)
          .set({ ...values, ...eventCols, ...timer, updatedAt: now })
          .where(eq(s.karaokeSessions.id, prev.id));
        updated++;
      }
      if (notify && event) events.push({ event, r });
    }
    // Sitede artık olmayan rezervasyon kalkar; okunamayıp atlanan satır silinmiş sayılmaz (goneSiteRows)
    let removed = 0;
    const gone = goneSiteRows(snapshot, existing).map((r) => r.id);
    if (gone.length) {
      await tx.delete(s.karaokeSessions).where(inArray(s.karaokeSessions.id, gone));
      removed = gone.length;
    }
    // Önceki çekme hatalıydıysa da: ekranların uyarı satırı kalksın
    if (created || updated || removed || curState.lastError) await bumpKaraokeVersion(tx);
    await patchState({ lastOkAt: now.toISOString(), lastTryAt: tryAt, lastError: null, lastSiteNow: snapshot.now, count: snapshot.reservations.length }, tx);
    return { created, updated, removed, events };
  });
  if (!applied) return { status: "fresh" };

  if (applied.events.length) {
    try {
      await announce(applied.events, now.getTime());
    } catch (e) {
      console.error("[karaoke] bildirim", (e as Error).message);
    }
  }
  return { status: "ok", created: applied.created, updated: applied.updated, removed: applied.removed, events: applied.events.length, skipped: snapshot.skipped };
}

/**
 * Kopyayı gerekiyorsa tazeler (kural src/lib/karaoke/freshness.ts): canlı uç (açık bir sekme sorduğunda, yanıttan sonra)
 * ve hızlı sayaç / uzatma (çakışma denetiminden önce, daha kısa `maxAgeMs` ile) çağırır. Gerekmiyorsa siteye gidilmez;
 * son deneme hatalı ve yeniyse de (site düşükken her istek 8 sn beklemesin). `state` verilirse yeniden okunmaz.
 */
export async function ensureKaraokeFresh(opts: { maxAgeMs?: number; state?: SyncState } = {}): Promise<SyncResult> {
  if (!karaokeSecret()) return { status: "off" };
  const state = opts.state ?? (await readSyncState());
  const rules = opts.maxAgeMs === undefined ? CATCH_UP : { ...CATCH_UP, staleMs: opts.maxAgeMs };
  if (!needsCatchUp(state, Date.now(), rules)) return { status: "fresh" };
  return syncKaraoke("screen");
}

/**
 * Olayları cihazlara bildirir: üçten fazlaysa tek özet bildirim; misafirin adı bildirime yazılmaz (kilit ekranı). Yalnız
 * karaokenin kitlesine (`featureAudience`: yönetici, şubesiz personel ve karaokesi açık şubenin personeli; docs/SUBE.md ›
 * Şube özellikleri): başka şubeye kilitli personelin cihazı karaoke zili çalmaz; karaoke hiçbir şubede açık değilse kimse
 */
async function announce(events: { event: KaraokeEvent; r: SiteReservation }[], nowMs: number) {
  const fresh = events.some((e) => e.event === "created");
  if (!events.length) return;
  const userIds = await featureAudienceIds("karaoke");
  for (const m of pushMessages(events, nowMs)) {
    await sendPush("karaoke", {
      kind: "karaoke",
      title: m.title,
      body: m.body,
      url: "/panel/karaoke",
      tag: `karaoke-${m.event}-${nowMs}`,
      requireInteraction: m.event === "created",
      ring: fresh,
    }, { userIds });
  }
}
