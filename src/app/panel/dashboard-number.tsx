"use client";

import { TlCounter } from "@/components/ui/animated-counter";

/**
 * Genel bakış rakamları için kayan rakamlı sayaç (components/ui/animated-counter): değer değişince (ay, şube)
 * her basamak kendi çarkında döner; yazı `tl()` ile aynı ("12.500 ₺"). Ekran okuyucu yalnızca son değeri duyar;
 * sunucu HTML'i ve hareket azaltma tercihinde rakam hareketsiz yazılır. Değer yoksa "–".
 */
export function CountUp({ value }: { value: number | null | undefined }) {
  return <TlCounter value={value} />;
}
