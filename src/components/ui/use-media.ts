"use client";

import { useSyncExternalStore } from "react";

/** CSS medya sorgusunun sonucu; sunucuda ve hidrasyonda `serverValue` (varsayılan false) */
export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** Telefon genişliği (Tailwind sm altı, 640px) */
export function useIsPhone(): boolean {
  return useMediaQuery("(width < 40rem)");
}
