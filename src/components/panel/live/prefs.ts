"use client";

import { useSyncExternalStore } from "react";

import type { Role } from "@/lib/constants";

/**
 * Bu cihazın uyarı tercihleri (tarayıcıda saklanır; her cihaz kendi karar verir: kasadaki tablet çalar, yöneticinin
 * telefonu çalmayabilir). Varsayılan: personelde karaoke alarmları ve sipariş zili açık, yöneticide kapalı; sesli uyarı
 * ve kişisel hatırlatmalar herkeste açık; sesler sistemin varsayılan çıkışından (hoparlör seçilene kadar).
 */
export interface DevicePrefs {
  /** Bu cihazda ses çalınsın */
  sound: boolean;
  /** Karaoke başlangıç / az kaldı / süre doldu uyarıları bu cihazda */
  karaokeAlarms: boolean;
  /** laffogato.net'ten yeni uygulama siparişi gelince zil (bar ekranı, docs/SITE-SIPARIS.md) bu cihazda */
  orderAlerts: boolean;
  /** Saatli kişisel hatırlatmalar bu cihazda */
  reminderAlerts: boolean;
  /** Bitime kaç dakika kala uyarılsın (0: uyarma) */
  warnMinutes: number;
  /** Karaoke ekranında ekran kararmasın */
  wakeLock: boolean;
  /** Uyarıların çalacağı hoparlörün kimliği ("" = sistemin varsayılanı; ör. Bluetooth'ta müzik çalarken bilgisayarın kendi hoparlörü) */
  outputId: string;
  /** O hoparlörün adı (kimlik değişirse adla yeniden bulunur) */
  outputLabel: string;
}

const KEY = "laf:cihaz-uyarilari";
const WARN_CHOICES = [0, 5, 10, 15] as const;
export { WARN_CHOICES };

export function defaultPrefs(role: Role): DevicePrefs {
  return { sound: true, karaokeAlarms: role === "staff", orderAlerts: role === "staff", reminderAlerts: true, warnMinutes: 10, wakeLock: role === "staff", outputId: "", outputLabel: "" };
}

let cache: { role: Role; prefs: DevicePrefs } | null = null;
const listeners = new Set<() => void>();

function read(role: Role): DevicePrefs {
  if (cache?.role === role) return cache.prefs;
  let prefs = defaultPrefs(role);
  try {
    const raw = window.localStorage.getItem(`${KEY}:${role}`);
    if (raw) {
      const p = JSON.parse(raw) as Partial<DevicePrefs>;
      prefs = {
        sound: typeof p.sound === "boolean" ? p.sound : prefs.sound,
        karaokeAlarms: typeof p.karaokeAlarms === "boolean" ? p.karaokeAlarms : prefs.karaokeAlarms,
        orderAlerts: typeof p.orderAlerts === "boolean" ? p.orderAlerts : prefs.orderAlerts,
        reminderAlerts: typeof p.reminderAlerts === "boolean" ? p.reminderAlerts : prefs.reminderAlerts,
        warnMinutes: WARN_CHOICES.includes(p.warnMinutes as (typeof WARN_CHOICES)[number]) ? (p.warnMinutes as number) : prefs.warnMinutes,
        wakeLock: typeof p.wakeLock === "boolean" ? p.wakeLock : prefs.wakeLock,
        outputId: typeof p.outputId === "string" && p.outputId.length <= 256 ? p.outputId : prefs.outputId,
        outputLabel: typeof p.outputLabel === "string" ? p.outputLabel.slice(0, 200) : prefs.outputLabel,
      };
    }
  } catch {
    // Gizli pencere ya da kapalı depolama: varsayılanlar
  }
  cache = { role, prefs };
  return prefs;
}

export function updatePrefs(role: Role, patch: Partial<DevicePrefs>) {
  const next = { ...read(role), ...patch };
  cache = { role, prefs: next };
  try {
    window.localStorage.setItem(`${KEY}:${role}`, JSON.stringify(next));
  } catch {
    // Saklanamadı: bu oturumda geçerli kalır
  }
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  // Başka sekmede değişirse burada da
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith(KEY)) {
      cache = null;
      fn();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

/** Sunucu ve ilk çizimdeki varsayılanlar rol başına bir kez: her çağrıda yeni nesne React'e "değişti" der */
const serverPrefs = new Map<Role, DevicePrefs>();

export function usePrefs(role: Role): DevicePrefs {
  return useSyncExternalStore(
    subscribe,
    () => read(role),
    () => {
      let p = serverPrefs.get(role);
      if (!p) serverPrefs.set(role, (p = defaultPrefs(role)));
      return p;
    },
  );
}
