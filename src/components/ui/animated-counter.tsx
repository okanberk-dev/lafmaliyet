"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps, ReactNode, Ref } from "react";
import { animate, AnimatePresence, motion, useMotionValue, useTransform, type Transition } from "motion/react";

import { cn } from "@/lib/utils";
import { num } from "@/lib/format";
import { useCalmMotion } from "@/components/ui/motion";
import { format, isNegative, measure, mod, toCells } from "./animated-counter-core";

/**
 * Kayan rakamlı sayaç (rare-ui animated-counter'dan uyarlandı): değer değişince her basamak kendi çarkında
 * yeni rakama döner; artışta yukarı, azalışta aşağı. Panel uyarlaması:
 * - Biçim Türkçe ve `tl()` / `num()` ile aynı: 12.500 ₺, 12.500,50 ₺; eksi değer başta "-" ile.
 * - Sunucu HTML'i ve hidrasyon son değeri hareketsiz gösterir (`useCalmMotion`); yavaş telefonda boş kalmaz.
 *   Hareket azaltma tercihinde de çark dönmez, rakam doğrudan değişir.
 * - Ekran okuyucu yalnız son değeri okur; dönen çark `aria-hidden`.
 */

const FACES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
// sondaki 0, 9'dan 0'a dönüşü aynı yüze indirir
const WHEEL = [...FACES, 0];

// maske rakamın çevresindeki boşlukta söner; duran rakam tam görünür
const LINE = 1.5;
// doğrusal geçiş sert kenar gibi görünür, yumuşatılmış eğri kullanılır
const FADE = `linear-gradient(to bottom,
  rgba(0,0,0,0) 0%,
  rgba(0,0,0,0.06) 5.5%,
  rgba(0,0,0,0.5) 11%,
  rgba(0,0,0,0.94) 16.5%,
  #000 22%,
  #000 78%,
  rgba(0,0,0,0.94) 83.5%,
  rgba(0,0,0,0.5) 89%,
  rgba(0,0,0,0.06) 94.5%,
  rgba(0,0,0,0) 100%)`;

const EASE = [0.22, 1, 0.36, 1] as const;
const BOUNCE = 0.18;
const LEAVE = { duration: 0.18, ease: EASE } as const;
const INSTANT = { duration: 0 } as const;
const NBSP = " ";

const spring = (duration: number): Transition => ({ type: "spring", visualDuration: duration, bounce: BOUNCE });

// bir kez kurulur; React her değişimde basamak başına 21 span'i yeniden karşılaştırmaz
const SIZER = FACES.map((face) => (
  <span key={face} aria-hidden className="invisible [grid-area:1/1]">
    {face}
  </span>
));

const STACK = WHEEL.map((face, index) => (
  <span key={index} className="flex items-center justify-center" style={{ height: `${LINE}em` }}>
    {face}
  </span>
));

function useWheel(from: number, digit: number, dir: number, duration: number, calm: boolean) {
  const pos = useMotionValue(from);
  const goal = useRef(from);

  // bağımlılık değil okunur: yalnız yön değişimi bütün sütunları yeniden başlatmasın
  const heading = useRef(dir);
  useEffect(() => {
    heading.current = dir;
  }, [dir]);

  useEffect(() => {
    if (calm) {
      goal.current = digit;
      pos.set(digit);
      return;
    }
    // yalnız yüz değişince hedefle; yoksa yön değişimi çarkı uzun yoldan döndürür
    if (mod(goal.current, 10) !== digit) {
      // çarkın şu anki yerinden hedefle; hızla değişen değer tur birikmesi yapmasın
      const at = pos.get();
      goal.current = heading.current < 0 ? at - mod(at - digit, 10) : at + mod(digit - at, 10);
    }
    const roll = animate(pos, goal.current, spring(duration));
    return () => roll.stop();
  }, [digit, duration, calm, pos]);

  return useTransform(pos, (p) => `${(-mod(p, 10) * 100) / WHEEL.length}%`);
}

type SlotProps = { calm: boolean; dep: number; shift: Transition };

const shifts = ({ calm, dep, shift }: SlotProps) => ({ layout: !calm, layoutDependency: dep, transition: shift });

const fades = (calm: boolean) => ({
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, transition: calm ? INSTANT : LEAVE },
});

function Fixed({ children, ...slot }: SlotProps & { children: ReactNode }) {
  return (
    <motion.span {...shifts(slot)} className="inline-block whitespace-pre">
      {children}
    </motion.span>
  );
}

function Mark({ char, ref, ...slot }: SlotProps & { char: string; ref?: Ref<HTMLSpanElement> }) {
  return (
    <motion.span ref={ref} data-slot="animated-counter-mark" {...shifts(slot)} {...fades(slot.calm)} className="inline-block">
      {char}
    </motion.span>
  );
}

const Digit = memo(function Digit({
  digit,
  from,
  dir,
  duration,
  ref,
  ...slot
}: SlotProps & {
  digit: number;
  from: number;
  dir: number;
  duration: number;
  // popLayout ayrılan sütunu bununla ölçer
  ref?: Ref<HTMLSpanElement>;
}) {
  const y = useWheel(from, digit, dir, duration, slot.calm);
  return (
    <motion.span
      ref={ref}
      data-slot="animated-counter-digit"
      {...shifts(slot)}
      {...fades(slot.calm)}
      className="relative inline-grid overflow-hidden"
      style={{ height: `${LINE}em`, lineHeight: LINE, maskImage: FADE, WebkitMaskImage: FADE }}
    >
      {/* eşit genişlikli rakamı olmayan yazı tiplerinde en geniş yüzün genişliği */}
      {SIZER}
      <motion.span style={{ y }} className="absolute inset-x-0 top-0">
        {STACK}
      </motion.span>
    </motion.span>
  );
});

export type AnimatedCounterProps = Omit<
  ComponentProps<"span">,
  "children" | "prefix" | "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd"
> & {
  value: number;
  /** Ondalık basamak (tl: 0, kuruşlu tutar: 2) */
  decimals?: number;
  /** Saniye cinsinden dönüş süresi */
  duration?: number;
  /** En az tam basamak sayısı (baştaki sıfırlar) */
  padStart?: number;
  separator?: string;
  decimalSeparator?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
};

export function AnimatedCounter({
  value,
  decimals = 0,
  duration = 0.6,
  padStart = 1,
  separator = ".",
  decimalSeparator = ",",
  prefix,
  suffix,
  className,
  ...props
}: AnimatedCounterProps) {
  const calm = useCalmMotion();

  const shape = measure(value, decimals, padStart, duration);
  const chars = format(shape, separator, decimalSeparator);
  const cells = toCells(chars, shape.width);
  const negative = isNegative(shape);

  const [previous, setPrevious] = useState(shape.amount);
  const [dir, setDir] = useState(1);
  if (previous !== shape.amount) {
    setDir(shape.amount >= previous ? 1 : -1);
    setPrevious(shape.amount);
  }

  // ilk boyamadaki yüzler; sonradan eklenen basamak 0'dan dönerek gelir
  const [seed] = useState(() => {
    const faces: Record<number, number> = {};
    for (const cell of cells) if (cell.kind === "digit") faces[cell.key] = cell.digit;
    return faces;
  });

  const shift = useMemo<Transition>(() => (calm ? INSTANT : spring(shape.pace)), [calm, shape.pace]);
  const slot: SlotProps = { calm, dep: chars.length, shift };

  return (
    <span data-slot="animated-counter" className={cn("inline-flex items-center tabular-nums", className)} {...props}>
      {prefix != null && <Fixed {...slot}>{prefix}</Fixed>}

      <span className="sr-only">
        {negative ? "-" : ""}
        {chars}
      </span>

      <span aria-hidden className="inline-flex select-none items-center">
        {negative && <Fixed {...slot}>-</Fixed>}
        <AnimatePresence mode="popLayout" initial={false}>
          {cells.map((cell) =>
            cell.kind === "digit" ? (
              <Digit key={cell.key} {...slot} digit={cell.digit} from={seed[cell.key] ?? 0} dir={dir} duration={shape.pace} />
            ) : (
              <Mark key={cell.key} {...slot} char={cell.char} />
            ),
          )}
        </AnimatePresence>
      </span>

      {suffix != null && <Fixed {...slot}>{suffix}</Fixed>}
    </span>
  );
}

/**
 * Panel kartlarının sayacı: `tl()` ("12.500 ₺") ya da `num()` ("12.500") ile aynı yazı, kayan rakamlarla.
 * Değer yoksa `tl()` / `num()` gibi "–" yazar.
 */
export function TlCounter({
  value,
  kind = "tl",
  digits = 0,
  className,
}: {
  value: number | null | undefined;
  kind?: "tl" | "num";
  digits?: number;
  className?: string;
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <>{num(value)}</>;
  return (
    <AnimatedCounter value={value} decimals={digits} suffix={kind === "tl" ? `${NBSP}₺` : undefined} className={className} />
  );
}

export default AnimatedCounter;
