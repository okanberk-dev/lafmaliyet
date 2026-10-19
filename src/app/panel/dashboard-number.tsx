"use client";

import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { tl } from "@/lib/format";

const formatTl = (v: number) => tl(v);

/**
 * Genel bakış rakamları için AkmanOS sayaç (charts/animated-number): değer açılışta ve ay değişince
 * yumuşakça sayılır, biçim her karede `tl()` ile Türkçe kalır. Ekran okuyucu yalnızca son değeri duyar;
 * hareket azaltma tercihinde sayaç doğrudan son değeri yazar.
 */
export function CountUp({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <>{tl(value)}</>;
  return (
    <>
      <span className="sr-only">{tl(value)}</span>
      <span aria-hidden="true">
        <AnimatedNumber value={value} format={formatTl} />
      </span>
    </>
  );
}
