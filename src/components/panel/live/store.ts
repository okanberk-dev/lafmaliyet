"use client";

import { useSyncExternalStore } from "react";

import type { LiveResponse } from "@/lib/live";

/**
 * Açık sekmenin canlı verisi (tek örnek; bileşenler useLive ile okur). /api/canli'yi yalnız gerektiğinde ister:
 * açılışta, bildirim gelince, sekmeye dönünce, ağ geri gelince ve seyrek bir yedek kontrolde (uyarı motoru,
 * alert-center.tsx). ETag ile sorar: değişiklik yoksa sunucu 304 döner, veri inmez. Sunucu saatiyle cihaz saati
 * arasındaki fark tutulur; sayaçlar sunucu saatiyle sayar (kasadaki tabletin saati yanlış olsa da alarm zamanında).
 *
 * Depo bir kullanıcıya bağlıdır (bindLive; kabuk açılınca uyarı motoru bağlar). Giriş ile panel arası yumuşak gezinme
 * olduğu için modül bellekte kalır: oturum düşünce (401) veri silinir, kabuk kapanınca ya da başka kullanıcı gelince
 * depo boşalır. Ortak tablette önceki kişinin hatırlatıcısı ya da karaoke tutarı sıradakine geçmez, yeni oturum canlı
 * veriyi yeniden ister (denetim KA-01).
 */

export interface LiveState {
  data: LiveResponse | null;
  /** Sunucu saati − cihaz saati (ms) */
  offset: number;
  error: string | null;
  /** Oturum düştü (401) ya da yanıt başka bir kullanıcının: veri tutulmaz, depo yeniden bağlanana kadar istek atılmaz */
  signedOut: boolean;
  /** Son başarılı yanıt (200 ya da 304), cihaz saatiyle */
  checkedAt: number;
  /** Verinin son değiştiği an (200), cihaz saatiyle */
  changedAt: number;
}

const EMPTY: LiveState = { data: null, offset: 0, error: null, signedOut: false, checkedAt: 0, changedAt: 0 };
let state: LiveState = EMPTY;
let etag: string | null = null;
let inflight: Promise<void> | null = null;
/** Deponun kullanıcısı (kabuktaki oturum); bağlanmadıysa null */
let owner: number | null = null;
/** Depo boşaltılınca artar: önceki oturumun yolda kalan yanıtı yeni depoya yazılmaz */
let generation = 0;
const listeners = new Set<() => void>();

function set(patch: Partial<LiveState>) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

export function subscribeLive(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const getLive = () => state;
const serverSnapshot: LiveState = EMPTY;

export function useLive(): LiveState {
  return useSyncExternalStore(subscribeLive, getLive, () => serverSnapshot);
}

/** Sunucu saatine göre şimdi (ms) */
export const liveNow = () => Date.now() + state.offset;

/** Depoyu boşaltır (veri, ETag, "oturum düştü" bayrağı ve kullanıcısı); yolda kalan istek yazılmaz */
export function resetLive() {
  generation += 1;
  etag = null;
  inflight = null;
  owner = null;
  state = EMPTY;
  for (const fn of listeners) fn();
}

/**
 * Depoyu kabuktaki kullanıcıya bağlar (uyarı motoru, kabuk açılınca). Başka kullanıcının verisini tutuyorsa ya da
 * oturum düşmüşse önce boşaltılır: aynı kişi yeniden girdiğinde de canlı veri yeniden istenir.
 */
export function bindLive(userId: number) {
  if (owner !== userId || state.signedOut) resetLive();
  owner = userId;
}

/** Oturum yok ya da yanıt bu kabuğun kullanıcısının değil: veri ve ETag silinir, yeniden bağlanana kadar istek yok */
function signOut() {
  etag = null;
  set({ ...EMPTY, signedOut: true });
}

/** Canlı veriyi yeniden ister (aynı anda tek istek; ikinci çağrı ilkini bekler) */
export function refreshLive(): Promise<void> {
  if (state.signedOut) return Promise.resolve();
  if (inflight) return inflight;
  const gen = generation;
  inflight = (async () => {
    const sent = Date.now();
    try {
      const res = await fetch("/api/canli", { headers: etag ? { "If-None-Match": etag } : undefined, cache: "no-store", credentials: "same-origin" });
      if (gen !== generation) return;
      if (res.status === 401) return signOut();
      if (res.status === 304) return set({ checkedAt: Date.now(), error: null });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as LiveResponse;
      if (gen !== generation) return;
      // Çerez başka bir kullanıcının (başka sekmede hesap değişti): bu kabuğa yazılmaz
      if (owner !== null && data.me.id !== owner) return signOut();
      etag = res.headers.get("ETag");
      // Yanıtın yolda geçen yarısı kadar düzeltme
      const received = Date.now();
      const offset = Date.parse(data.serverNow) - (sent + (received - sent) / 2);
      set({ data, offset: Number.isFinite(offset) ? offset : 0, error: null, checkedAt: received, changedAt: received });
    } catch (e) {
      if (gen === generation) set({ error: e instanceof Error ? e.message : "Bağlantı yok" });
    } finally {
      if (gen === generation) inflight = null;
    }
  })();
  return inflight;
}

/** Eylemden hemen sonra (ör. alarm susturuldu) ekran beklemeden değişsin; sunucunun yanıtı sonra gelir */
export function patchLive(fn: (data: LiveResponse) => LiveResponse) {
  if (!state.data) return;
  set({ data: fn(state.data) });
  etag = null;
}
