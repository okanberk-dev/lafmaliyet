"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * Tarayıcıda (localStorage) tutulan küçük kimlik listesi: paletteki son açılanlar, okunmuş bildirimler.
 * Yalnızca bu tarayıcıya özel kolaylık; okunamazsa (gizli pencere, engellenmiş depolama) boş liste döner.
 * Aynı anahtarı kullanan bileşenler ve diğer sekmeler değişikliği hemen görür.
 */
const EVENT = "laf-local-list";

function read(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

export function useLocalList(key: string, max = 200): [string[], (next: string[]) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => "",
  );
  const list = useMemo(() => {
    try {
      const v: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }, [raw]);
  const write = useCallback(
    (next: string[]) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(next.slice(0, max)));
        window.dispatchEvent(new Event(EVENT));
      } catch {
        // Depolama kapalıysa sessizce geçilir; liste yalnızca bir kolaylık
      }
    },
    [key, max],
  );
  return [list, write];
}
