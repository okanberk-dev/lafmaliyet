"use client";

import { useReducedMotion } from "motion/react";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Hareket azaltma tercihi + "henüz hidrasyon bitmedi" bilgisi. Sunucu HTML'inde ve hidrasyon sırasında true
 * döner: sayfa ilk boyamada görünür gelir (yavaş telefonda içerik JS yüklenene kadar opacity 0'da kalmaz),
 * giriş animasyonları yalnızca istemcide sonradan bağlanan öğelerde (sekme, filtre, sayfa geçişi) oynar.
 * Hidrasyondan sonra, kullanıcı hareketi azaltmadıysa false olur ve etkileşim animasyonları normal çalışır.
 */
export function useCalmMotion(): boolean {
  const reduce = useReducedMotion();
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return Boolean(reduce) || !hydrated;
}
