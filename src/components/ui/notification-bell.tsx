"use client";

import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useVelocity,
  type AnimationPlaybackControls,
  type MotionValue,
} from "motion/react";
import { useEffect, useRef, type ComponentProps } from "react";

import { cn } from "@/lib/utils";

import { AnimatedCounter } from "./animated-counter";
import { useCalmMotion } from "./motion";
import { badgeOf, bellLabel, ringVelocity } from "./notification-bell-core";

/**
 * Bildirim zili (rare-ui notification-bell'den uyarlandı): okunmamış sayısı artınca zil tepesinden sallanır, dili
 * (tokmak) gecikmeyle peşinden gelir; rozetteki rakam kayan sayaçla (animated-counter) döner. Panel uyarlaması:
 * - Zil çizimi panelin lucide ziliyle aynı (çizgi 1,75); rare-ui'nin dolgulu zili ve iOS renkleri yok. Rozet panelin
 *   siyah rozeti (`bg-foreground text-background`), 9'dan fazlası "9+".
 * - İlk okuma zili çaldırmaz (`count` null → sayı gelince): yalnız sayfa açıkken yeni bildirim gelince sallanır.
 * - Sunucu HTML'i, hidrasyon ve hareket azaltma tercihinde (`useCalmMotion`) zil sallanmaz, rakam dönmez.
 * - Düğme sıradan bir <button>: `ref`, `onClick`, `aria-*` olduğu gibi geçer (rare-ui'deki Slot sarmalayıcısı yok).
 *   Etiket verilmezse "Bildirimler, N okunmamış".
 */

// düşük sönüm: bir süre sallanmaya devam eder
const SWING = { type: "spring", stiffness: 220, damping: 10, mass: 1, restDelta: 0.01 } as const;
const CLAPPER_SPRING = { stiffness: 300, damping: 14, mass: 1 };
const CLAPPER_SWEEP = 13;
const CLAPPER_VELOCITY = 450;
const POP = { type: "spring", stiffness: 600, damping: 22 } as const;
const INSTANT = { duration: 0 } as const;

function useBellRing(count: number | null, calm: boolean) {
  const swing = useMotionValue(0);
  const swingVelocity = useVelocity(swing);
  // dil zilin hızını izler, kendiliğinden geride kalır
  const lag = useTransform(swingVelocity, [-CLAPPER_VELOCITY, 0, CLAPPER_VELOCITY], [CLAPPER_SWEEP, 0, -CLAPPER_SWEEP], { clamp: true });
  const clapper = useSpring(lag, CLAPPER_SPRING);
  const previous = useRef<number | null>(count);
  const ringing = useRef<AnimationPlaybackControls | null>(null);

  useEffect(() => {
    const velocity = ringVelocity(previous.current, count, swing.getVelocity());
    // bilinmeyen (yükleniyor / okunamadı) değer önceki sayıyı silmez: yeniden okununca aynı sayı zili çaldırmaz
    if (count !== null) previous.current = count;
    if (velocity === null || calm) return;
    ringing.current?.stop();
    ringing.current = animate(swing, 0, { ...SWING, velocity });
  }, [count, calm, swing]);

  useEffect(() => () => ringing.current?.stop(), []);

  return { swing, clapper };
}

/** lucide Bell'in çizimi; gövde ve dil ayrı, dil kendi tepesinden döner */
function BellGlyph({ swing, clapper }: { swing: MotionValue<number>; clapper: MotionValue<number> }) {
  return (
    <motion.svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-[18px] overflow-visible"
      // zil tepesinden asılı; ortasından dönerse yanlış görünür
      style={{ rotate: swing, transformOrigin: "50% 10%" }}
    >
      <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
      {/* dil, zilin içinden (y ≈ 14) sarkan kısa bir sarkaç gibi döner */}
      <motion.path d="M10.268 21a2 2 0 0 0 3.464 0" style={{ rotate: clapper, transformBox: "fill-box", transformOrigin: "50% -700%" }} />
    </motion.svg>
  );
}

export type NotificationBellProps = Omit<ComponentProps<"button">, "children" | "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd"> & {
  /** Okunmamış sayısı; null: henüz okunmadı (zil çalmaz, rozet yok) */
  count: number | null;
  /** Rozetin kenar halkası gibi zemine bağlı sınıflar */
  badgeClassName?: string;
};

export function NotificationBell({ count, badgeClassName, className, type = "button", ...props }: NotificationBellProps) {
  const calm = useCalmMotion();
  const { swing, clapper } = useBellRing(count, calm);
  const badge = badgeOf(count);

  return (
    <button
      type={type}
      data-slot="notification-bell"
      aria-label={bellLabel(count)}
      {...props}
      className={cn(
        "relative inline-flex size-11 cursor-pointer items-center justify-center text-foreground outline-none transition-[background-color,transform] focus-visible:ring-2 focus-visible:ring-foreground/30 active:scale-95 motion-reduce:active:scale-100",
        className,
      )}
    >
      <BellGlyph swing={swing} clapper={clapper} />
      <AnimatePresence initial={false}>
        {badge ? (
          <motion.span
            key="badge"
            data-slot="notification-bell-badge"
            aria-hidden="true"
            initial={calm ? false : { scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={calm ? { opacity: 0, transition: INSTANT } : { scale: 0, opacity: 0 }}
            transition={calm ? INSTANT : POP}
            className={cn(
              "pointer-events-none absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center overflow-hidden rounded-full bg-foreground px-1 text-[10px] leading-none font-semibold text-background",
              badgeClassName,
            )}
          >
            <AnimatedCounter value={badge.value} duration={0.45} suffix={badge.plus ? "+" : undefined} />
          </motion.span>
        ) : null}
      </AnimatePresence>
    </button>
  );
}

export default NotificationBell;
