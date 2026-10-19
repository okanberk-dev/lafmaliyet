"use client";

import { RecordsStackIllustration } from "@/components/akmanos/empty-state/empty-state";

import { useCalmMotion } from "./motion";

/**
 * Boş durumun kayıt kartı yığını. Sunucu çiziminde ve hidrasyonda hareketsiz ve görünür gelir (opacity 0'da
 * beklemez); sonra, hareket azaltılmadıysa kartlar hafifçe süzülür.
 */
export function EmptyIllustration() {
  const calm = useCalmMotion();
  return <RecordsStackIllustration reduceMotion={calm} />;
}
