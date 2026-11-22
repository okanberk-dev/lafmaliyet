"use client";

import { useSyncExternalStore } from "react";

import { onlyComputerFor } from "@/lib/audio-output";
import type { Role } from "@/lib/constants";

/**
 * Bu cihazın uyarı tercihleri (tarayıcıda saklanır; her cihaz kendi karar verir: kasadaki tablet çalar, yöneticinin
 * telefonu çalmayabilir). Varsayılan: karaoke alarmları (başladı, az kaldı, süre doldu) her iki rolde açık (22 Kasım
 * 2026: bar ekranı yönetici hesabıyla açıkken sayaç saatinde başlamıyor, süre dolunca ötmüyordu; isteyen cihaz kapatır,
 * ekran kapalı olduğunu söyler); sipariş zili personelde açık, yöneticide kapalı; sesli uyarı ve kişisel hatırlatmalar
 * herkeste açık; sesler sistemin varsayılan çıkışından (hoparlör seçilene kadar).
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
  /**
   * Uyarılar yalnız bu bilgisayarın seçilen hoparlöründen; hoparlör yoksa genel hoparlöre düşmez, susar. null: şubenin
   * varsayılanı (yalnız soldan Tuzla seçiliyken açık; "Tümü"de ve Marina'da kapalı; src/lib/audio-output.ts › onlyComputerFor)
   */
  onlyComputer: boolean | null;
}

const KEY = "laf:cihaz-uyarilari";
const WARN_CHOICES = [0, 5, 10, 15] as const;
export { WARN_CHOICES };
/**
 * Saklanan kaydın sürümü. 2: karaoke alarmlarının varsayılanı iki rolde açık (22 Kasım 2026). Kayıt her tercih
 * değişikliğinde bütün tercihleri yazar: sürümsüz (eski) bir yönetici kaydındaki "kapalı" çoğunlukla seçim değil, eski
 * varsayılandır (hoparlör seçen bar bilgisayarı da yazmıştı) ve ayırt edilemez; açık sayılır. Seçilen her değer (2'li
 * kayıt, personelin eski kaydı, yöneticinin eski "açık"ı) korunur.
 */
const PREFS_VERSION = 2;

export function defaultPrefs(role: Role): DevicePrefs {
  return { sound: true, karaokeAlarms: true, orderAlerts: role === "staff", reminderAlerts: true, warnMinutes: 10, wakeLock: role === "staff", outputId: "", outputLabel: "", onlyComputer: null };
}

/**
 * Saklanan kayıt → tercihler (saf; tests/canli-yoklama.test.ts). Bozuk alan varsayılana döner. Sürümsüz yönetici
 * kaydında `karaokeAlarms: false` eski varsayılandır, yeni varsayılan (açık) geçer.
 */
export function parsePrefs(raw: unknown, role: Role): DevicePrefs {
  const prefs = defaultPrefs(role);
  if (!raw || typeof raw !== "object") return prefs;
  const p = raw as Partial<DevicePrefs> & { v?: unknown };
  const legacyAdminOff = p.v !== PREFS_VERSION && role === "admin" && p.karaokeAlarms === false;
  return {
    sound: typeof p.sound === "boolean" ? p.sound : prefs.sound,
    karaokeAlarms: typeof p.karaokeAlarms === "boolean" && !legacyAdminOff ? p.karaokeAlarms : prefs.karaokeAlarms,
    orderAlerts: typeof p.orderAlerts === "boolean" ? p.orderAlerts : prefs.orderAlerts,
    reminderAlerts: typeof p.reminderAlerts === "boolean" ? p.reminderAlerts : prefs.reminderAlerts,
    warnMinutes: WARN_CHOICES.includes(p.warnMinutes as (typeof WARN_CHOICES)[number]) ? (p.warnMinutes as number) : prefs.warnMinutes,
    wakeLock: typeof p.wakeLock === "boolean" ? p.wakeLock : prefs.wakeLock,
    outputId: typeof p.outputId === "string" && p.outputId.length <= 256 ? p.outputId : prefs.outputId,
    outputLabel: typeof p.outputLabel === "string" ? p.outputLabel.slice(0, 200) : prefs.outputLabel,
    onlyComputer: typeof p.onlyComputer === "boolean" ? p.onlyComputer : prefs.onlyComputer,
  };
}

let cache: { role: Role; prefs: DevicePrefs } | null = null;
const listeners = new Set<() => void>();

function read(role: Role): DevicePrefs {
  if (cache?.role === role) return cache.prefs;
  let prefs = defaultPrefs(role);
  try {
    const raw = window.localStorage.getItem(`${KEY}:${role}`);
    if (raw) prefs = parsePrefs(JSON.parse(raw), role);
  } catch {
    // Gizli pencere ya da kapalı depolama: varsayılanlar
  }
  cache = { role, prefs };
  return prefs;
}

/** Bu cihazın tercihleri bileşen dışında (test ve uyarı motoru) */
export const currentPrefs = (role: Role): DevicePrefs => read(role);

export function updatePrefs(role: Role, patch: Partial<DevicePrefs>) {
  const next = { ...read(role), ...patch };
  cache = { role, prefs: next };
  try {
    window.localStorage.setItem(`${KEY}:${role}`, JSON.stringify({ ...next, v: PREFS_VERSION }));
  } catch {
    // Saklanamadı: bu oturumda geçerli kalır
  }
  for (const fn of listeners) fn();
}

/** Bu cihazın panel şube seçimi (kabuktan, AlertCenter); "yalnız bu bilgisayar"ın varsayılanı buna bağlı */
let branchScope: string | null = null;

export function setBranchScope(scope: string | null) {
  if (scope === branchScope) return;
  branchScope = scope;
  cache = null;
  for (const fn of listeners) fn();
}

/** "Yalnız bu bilgisayar" bu cihazda açık mı (elle seçildiyse o, seçilmediyse şubenin varsayılanı) */
export function onlyComputerOn(prefs: DevicePrefs): boolean {
  return onlyComputerFor(prefs.onlyComputer, branchScope);
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
