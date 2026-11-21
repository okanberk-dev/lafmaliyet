"use client";

import { useEffect } from "react";

/**
 * Bar ekranı (Siparişler, Karaoke) açıkken ekran kararmasın (Screen Wake Lock; destek yoksa bir şey yapmaz). Cihazın
 * "Ekran açık kalsın" tercihiyle (Bu cihazda uyarılar)
 */
export function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let alive = true;
    const acquire = async () => {
      try {
        if (document.visibilityState === "visible") lock = await navigator.wakeLock.request("screen");
      } catch {
        // Pil tasarrufu ya da izin: sessizce geç
      }
    };
    const onVisible = () => {
      if (alive && document.visibilityState === "visible" && (!lock || lock.released)) void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [on]);
}
