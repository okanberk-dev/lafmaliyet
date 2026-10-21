"use client";

import { useSyncExternalStore } from "react";

import type { LiveResponse } from "@/lib/live";

/**
 * Açık sekmenin canlı verisi (tek örnek; bileşenler useLive ile okur). /api/canli'yi yalnız gerektiğinde ister:
 * açılışta, bildirim gelince, sekmeye dönünce, ağ geri gelince ve seyrek bir yedek kontrolde (uyarı motoru,
 * alert-center.tsx). ETag ile sorar: değişiklik yoksa sunucu 304 döner, veri inmez. Sunucu saatiyle cihaz saati
 * arasındaki fark tutulur; sayaçlar sunucu saatiyle sayar (kasadaki tabletin saati yanlış olsa da alarm zamanında).
 */

export interface LiveState {
  data: LiveResponse | null;
  /** Sunucu saati − cihaz saati (ms) */
  offset: number;
  error: string | null;
  /** Oturum düştü (401): istek atılmaz */
  signedOut: boolean;
  /** Son başarılı yanıt (200 ya da 304), cihaz saatiyle */
  checkedAt: number;
  /** Verinin son değiştiği an (200), cihaz saatiyle */
  changedAt: number;
}

let state: LiveState = { data: null, offset: 0, error: null, signedOut: false, checkedAt: 0, changedAt: 0 };
let etag: string | null = null;
let inflight: Promise<void> | null = null;
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
const serverSnapshot: LiveState = state;

export function useLive(): LiveState {
  return useSyncExternalStore(subscribeLive, getLive, () => serverSnapshot);
}

/** Sunucu saatine göre şimdi (ms) */
export const liveNow = () => Date.now() + state.offset;

/** Canlı veriyi yeniden ister (aynı anda tek istek; ikinci çağrı ilkini bekler) */
export function refreshLive(): Promise<void> {
  if (state.signedOut) return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    const sent = Date.now();
    try {
      const res = await fetch("/api/canli", { headers: etag ? { "If-None-Match": etag } : undefined, cache: "no-store", credentials: "same-origin" });
      if (res.status === 401) return set({ signedOut: true, error: null });
      if (res.status === 304) return set({ checkedAt: Date.now(), error: null });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as LiveResponse;
      etag = res.headers.get("ETag");
      // Yanıtın yolda geçen yarısı kadar düzeltme
      const received = Date.now();
      const offset = Date.parse(data.serverNow) - (sent + (received - sent) / 2);
      set({ data, offset: Number.isFinite(offset) ? offset : 0, error: null, checkedAt: received, changedAt: received });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Bağlantı yok" });
    } finally {
      inflight = null;
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
