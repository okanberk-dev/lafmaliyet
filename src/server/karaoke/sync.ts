import "server-only";

import { and, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";

import { detectEvent, eventMessage, type KaraokeEvent, type SiteReservation } from "@/lib/karaoke/session";
import { signedHeaders } from "@/lib/karaoke/signature";
import { parseSiteResponse, type SiteSnapshot } from "@/lib/karaoke/site";
import { addDays, todayTR } from "@/lib/reminders";
import { getDb, schema as s } from "@/server/db";
import { sendPush } from "@/server/push/send";

import { bumpKaraokeVersion } from "./board";

/** Paylaşılan anahtar (iki projede aynı, en az 32 karakter); yoksa bağlantı kapalı */
export function karaokeSecret(): string | null {
  const v = process.env.KARAOKE_SYNC_SECRET?.trim();
  return v && v.length >= 32 ? v : null;
}

/** Sitenin adresi (rezervasyonlar buradan çekilir) */
export function siteUrl(): string {
  return (process.env.LAFFOGATO_URL?.trim() || "https://laffogato.net").replace(/\/+$/, "");
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

/** Sitenin hata yanıtının yöneticiye okunur açıklaması */
function explain(status: number): string {
  if (status === 401) return "Site isteği reddetti (imza): iki projedeki KARAOKE_SYNC_SECRET aynı mı, sunucu saatleri doğru mu?";
  if (status === 503) return "Sitede KARAOKE_SYNC_SECRET tanımlı değil";
  if (status === 404) return "Sitede panel ucu yok (laffogato.net güncel değil)";
  return `Site yanıt vermedi (HTTP ${status})`;
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
export async function syncKaraoke(trigger: "ping" | "page" | "manual" | "cron"): Promise<SyncResult> {
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
  let snapshot: SiteSnapshot;
  try {
    const res = await fetch(url, { headers: signedHeaders(secret, "GET", url), signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!res.ok) throw new Error(explain(res.status));
    snapshot = parseSiteResponse(await res.json());
  } catch (e) {
    const error = e instanceof Error ? (e.name === "TimeoutError" ? "Site 8 saniyede yanıt vermedi" : e.message) : "Bilinmeyen hata";
    await patchState({ lastTryAt: tryAt, lastError: error.slice(0, 300) });
    return { status: "error", error };
  }

  const firstSync = !state.lastOkAt;
  const now = new Date();
  const db = getDb();
  const applied = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('karaoke-sync'))`);
    const [cur] = await tx.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, STATE_KEY)).limit(1);
    const lastSiteNow = (cur?.value as Partial<SyncState> | undefined)?.lastSiteNow;
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
        channel: r.channel || null,
        extUpdatedAt: r.updatedAt || null,
      };
      // Geçmiş ya da ilk eşitlemedeki kayıtlar olaysız yazılır (zil çalmaz, bildirim gitmez)
      const notify = event !== null && !firstSync && Date.parse(r.endsAt) > now.getTime();
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
          prev.channel === values.channel;
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
    let removed = 0;
    if (snapshot.complete) {
      const seen = new Set(snapshot.reservations.map((r) => r.id));
      const gone = existing.filter((r) => r.externalId && !seen.has(r.externalId)).map((r) => r.id);
      if (gone.length) {
        await tx.delete(s.karaokeSessions).where(inArray(s.karaokeSessions.id, gone));
        removed = gone.length;
      }
    }
    if (created || updated || removed) await bumpKaraokeVersion(tx);
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

/** Olayları cihazlara bildirir: üçten fazlaysa tek özet bildirim */
async function announce(events: { event: KaraokeEvent; r: SiteReservation }[], nowMs: number) {
  const messages = events.map(({ event, r }) => ({
    event,
    ...eventMessage(event, { startsAt: Date.parse(r.startsAt), endsAt: Date.parse(r.endsAt), guests: r.guests, name: r.firstName, status: r.status, paymentStatus: r.paymentStatus }, nowMs),
  }));
  const fresh = messages.some((m) => m.event === "created");
  const list = messages.length > 3 ? [{ title: `${messages.length} karaoke güncellemesi`, body: messages.slice(0, 2).map((m) => `${m.title}: ${m.body}`).join(" · "), event: "created" as const }] : messages;
  for (const m of list) {
    await sendPush("karaoke", {
      kind: "karaoke",
      title: m.title,
      body: m.body,
      url: "/panel/karaoke",
      tag: `karaoke-${m.event}-${nowMs}`,
      requireInteraction: m.event === "created",
      ring: fresh,
    });
  }
}
