"use client";

import { ChevronLeft, X } from "lucide-react";
import { motion, useDragControls } from "motion/react";
import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const PHONE = "(max-width: 639.98px)";

function subscribePhone(cb: () => void) {
  const mq = window.matchMedia(PHONE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** Telefon genişliği (sm altı); sunucuda ve hidrasyonda false */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}

/** Alt sayfanın altbilgi düğmeleri: telefonda eşit genişlik, en az 44px (dokunmatikte Button'un 44px'i, farede 48px) */
export const SHEET_BTN = "max-sm:h-12 max-sm:flex-1 max-sm:text-[15px]";

/**
 * Telefonda alttan açılan sayfa (tutamaçtan aşağı çekince kapanır), sm'den itibaren ortalanmış pencere.
 * Tarayıcının <dialog> öğesiyle: Esc ve arka plan kapatır, odak içeride kalır, kapanınca açan düğmeye döner.
 * Gövde kendi içinde kayar; altbilgi iPhone ev çubuğunun üstünde durur. `data-sheet` globals.css'teki
 * açılış hareketini alır. Dokunmatikte ilk alana kendiliğinden odaklanılmaz (klavye listeyi örtmesin).
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  footerStart,
  onBack,
  size = "md",
  bodyClassName,
  label,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  footerStart?: ReactNode;
  /** Başlığın solunda geri oku (çok adımlı sayfa) */
  onBack?: () => void;
  size?: "sm" | "md" | "lg";
  bodyClassName?: string;
  /** Başlık metin değilse ekran okuyucu adı */
  label?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const downOnBackdrop = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const shown = useRef(false);
  const drag = useDragControls();
  const phone = useIsPhone();
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
      el.showModal();
      shown.current = true;
      requestAnimationFrame(() => {
        const explicit = el.querySelector<HTMLElement>("[data-autofocus]");
        const fine = window.matchMedia("(pointer: fine)").matches;
        const target = explicit && (fine || explicit.dataset.autofocus === "always") ? explicit : panel.current;
        target?.focus({ preventScroll: true });
      });
    }
    if (!open && el.open) el.close();
    if (!open) shown.current = false;
  }, [open]);

  // Koşullu bağlanan pencere sökülünce odak açan düğmeye geri verilir (ui/dialog ile aynı)
  useEffect(() => {
    const el = ref.current;
    return () => {
      const back = opener.current;
      if (!el || !back || !shown.current) return;
      queueMicrotask(() => {
        if (el.isConnected || !back.isConnected) return;
        const active = document.activeElement;
        if (!active || active === document.body) back.focus({ preventScroll: true });
      });
    };
  }, []);

  const width = { sm: "sm:max-w-md", md: "sm:max-w-lg", lg: "sm:max-w-2xl" }[size];

  return (
    <dialog
      ref={ref}
      data-sheet
      aria-label={label}
      aria-labelledby={label ? undefined : titleId}
      onClose={() => {
        shown.current = false;
        onClose();
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === ref.current;
      }}
      onClick={(e) => {
        if (e.target === ref.current && downOnBackdrop.current) onClose();
        downOnBackdrop.current = false;
      }}
      className={cn(
        // Tam ekran saydam kap: panelin dışına dokunmak arka plana dokunmaktır
        "fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 text-ink open:flex open:items-end open:justify-center sm:open:items-center",
        // iOS'ta ekran klavyesi düzeni küçültmez: panel klavyenin üstüne çıkar (bottom-nav.tsx, --keyboard-inset)
        "max-sm:pb-(--keyboard-inset,0px)",
        "backdrop:bg-ink/25 backdrop:backdrop-blur-[2px] dark:backdrop:bg-black/60",
      )}
    >
      {open ? (
        <motion.div
          ref={panel}
          tabIndex={-1}
          drag={phone ? "y" : false}
          dragListener={false}
          dragControls={drag}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.9 }}
          dragSnapToOrigin
          onDragEnd={(_, info) => {
            if (info.offset.y > 96 || info.velocity.y > 600) onClose();
          }}
          className={cn(
            "flex w-full flex-col bg-surface shadow-[0_12px_40px_rgba(0,0,0,0.14)] outline-none",
            "max-h-[min(92dvh,calc(var(--vvh,100dvh)-0.5rem))] rounded-t-3xl pb-[env(safe-area-inset-bottom)]",
            "sm:max-h-[min(88vh,calc(100dvh-2rem))] sm:w-[calc(100%-2rem)] sm:rounded-3xl sm:pb-0",
            width,
          )}
        >
          {/* Tutamaç ve başlık: telefonda aşağı çekince kapanır */}
          <div className="shrink-0 touch-none select-none sm:touch-auto sm:select-auto" onPointerDown={(e) => phone && drag.start(e)}>
            <div className="flex justify-center pt-2 pb-1 sm:hidden" aria-hidden="true">
              <span className="h-1.5 w-10 rounded-full bg-panel-deep" />
            </div>
            <div className="flex items-start gap-2 px-5 pt-2 pb-3 sm:px-6 sm:pt-5">
              {onBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="-ml-2 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-ink-mute hover:bg-panel hover:text-ink sm:pointer-fine:size-9"
                  aria-label="Geri"
                >
                  <ChevronLeft size={20} />
                </button>
              ) : null}
              <div className="min-w-0 flex-1 pt-1.5 sm:pt-0">
                <h2 id={titleId} className="text-lg leading-6 font-semibold tracking-tight text-pretty break-words">
                  {title}
                </h2>
                {description ? <div className="mt-0.5 text-sm text-pretty text-ink-mute">{description}</div> : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                onPointerDown={(e) => e.stopPropagation()}
                className="-mr-2 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-ink-quiet hover:bg-panel hover:text-ink sm:-mt-1 sm:pointer-fine:size-9"
                aria-label="Kapat"
                title="Kapat (Esc)"
              >
                <X size={18} />
              </button>
            </div>
          </div>
          <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 sm:px-6", bodyClassName)}>{children}</div>
          {footer || footerStart ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line-strong px-5 py-3 sm:px-6 sm:py-3.5">
              {footerStart ? <div className="mr-auto flex items-center gap-2">{footerStart}</div> : null}
              {footer}
            </div>
          ) : null}
        </motion.div>
      ) : null}
    </dialog>
  );
}
