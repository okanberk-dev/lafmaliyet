"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Tarayıcının yerel <dialog> öğesiyle hafif bir modal pencere */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  footerStart,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Altbilginin solunda duran eylem (ör. Sil) */
  footerStart?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Arka plana tıklama yalnızca basış da arka planda başladıysa kapatır (alandan dışarı sürüklenen seçim kapatmasın)
  const downOnBackdrop = useRef(false);
  // Pencereyi açan öğe (çoğunlukla bir düğme) ve pencerenin şu an açık olup olmadığı
  const opener = useRef<HTMLElement | null>(null);
  const shown = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
      el.showModal();
      shown.current = true;
      // showModal'dan sonra odak: önce [data-autofocus], yoksa ilk alan
      requestAnimationFrame(() => {
        const target = el.querySelector<HTMLElement>("[data-autofocus], [autofocus]") ?? el.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea");
        target?.focus();
      });
    }
    if (!open && el.open) el.close();
    if (!open) shown.current = false;
  }, [open]);

  // Sayfalar pencereyi çoğunlukla koşullu bağlar ({editing ? <XDialog/> : null}). Açık bir <dialog> DOM'dan
  // sökülünce tarayıcı odağı açan düğmeye geri vermez, body'ye düşer; sökülme gerçekleşince odak elle geri verilir.
  // (Burada close() çağrılmaz: geliştirme modundaki çift etki denemesi pencereyi kapatıp onClose'u tetiklerdi.)
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

  const width = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];

  return (
    <dialog
      ref={ref}
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
        "m-auto w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] rounded-3xl bg-surface p-0 text-ink shadow-[0_12px_40px_rgba(0,0,0,0.14)] backdrop:bg-ink/20 backdrop:backdrop-blur-[2px]",
        width,
      )}
    >
      {open ? (
        <div className="flex max-h-[min(85vh,calc(100dvh-2rem))] flex-col">
          <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-5 pb-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-pretty break-words">{title}</h2>
              {description ? <p className="mt-0.5 text-sm text-pretty text-ink-mute">{description}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mt-1 -mr-1.5 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-quiet hover:bg-ink/[0.05] hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none pointer-coarse:size-10"
              aria-label="Kapat"
              title="Kapat (Esc)"
            >
              <X size={18} />
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-6 py-3">{children}</div>
          {footer || footerStart ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line-strong px-6 py-3.5">
              {footerStart ? <div className="mr-auto flex items-center gap-2">{footerStart}</div> : null}
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
