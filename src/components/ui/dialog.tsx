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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // showModal'dan sonra odak: önce [data-autofocus], yoksa ilk alan
      requestAnimationFrame(() => {
        const target = el.querySelector<HTMLElement>("[data-autofocus], [autofocus]") ?? el.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea");
        target?.focus();
      });
    }
    if (!open && el.open) el.close();
  }, [open]);

  const width = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] rounded-3xl bg-surface p-0 text-ink shadow-[0_12px_40px_rgba(0,0,0,0.14)] backdrop:bg-ink/20 backdrop:backdrop-blur-[2px]",
        width,
      )}
    >
      {open ? (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
              {description ? <p className="mt-0.5 text-sm text-ink-mute">{description}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-1 flex size-8 cursor-pointer items-center justify-center rounded-lg text-ink-quiet hover:bg-ink/[0.05] hover:text-ink"
              aria-label="Kapat"
            >
              <X size={18} />
            </button>
          </div>
          <div className="overflow-y-auto px-6 py-3">{children}</div>
          {footer || footerStart ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-strong px-6 py-3.5">
              {footerStart ? <div className="mr-auto flex items-center gap-2">{footerStart}</div> : null}
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
