"use client";

import { openCalls } from "@/lib/site-orders/calls";
import { cn } from "@/lib/utils";

import { useClock } from "./live/clock";
import { useLive } from "./live/store";
import { badgeText } from "./nav";

/**
 * Menüdeki "Siparişler" satırının sayısı: açık uygulama siparişleri ve 15 dakikadan yeni masa çağrıları. Ek istek yok:
 * kabuğun canlı verisinden (alert-center.tsx /api/canli'yi zaten yönetir); süresi dolan çağrı dakikada bir düşer.
 * Bağlantı kurulu değilse ya da veri henüz gelmediyse 0.
 */
export function useOpenOrdersCount(): number {
  const live = useLive();
  const now = useClock(60_000);
  const o = live.data?.orders;
  if (!o?.configured || !now) return 0;
  return o.list.length + openCalls(o.calls, now).length;
}

/** Sayı rozeti (9'dan fazlası "9+"); sıfırsa hiçbir şey. Ekran okuyucuya "N açık" */
export function OrdersNavBadge({ className }: { className?: string }) {
  const n = useOpenOrdersCount();
  const text = badgeText(n);
  if (!text) return null;
  return (
    <span className={cn("flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-warn px-1.5 text-[11px] leading-none font-semibold text-white tabular", className)}>
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">, {n} açık</span>
    </span>
  );
}
