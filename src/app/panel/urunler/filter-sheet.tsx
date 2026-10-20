"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { motion, useDragControls } from "motion/react";
import { useEffect, useId, useRef, type ReactNode } from "react";

import { SPRING_PANEL } from "@/components/akmanos/lib/motion-ease";
import { Button, buttonClass } from "@/components/ui/button";
import { useCalmMotion } from "@/components/ui/motion";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { showLabel } from "./filter-text";

/**
 * Telefon süzgeci (Ürünler, Hammaddeler). Telefonda süzgeç çipleri ve seçimler arama kutusunun altında yer
 * kaplamaz: arama kutusunun yanında "Süzgeç" düğmesi (etkin süzgeç sayısı rozette), dokununca alttan açılan
 * pencere. Süzgeçler adreste olduğundan liste pencere açıkken de anında süzülür; alttaki düğme kaç kaydın
 * kaldığını söyler ve pencereyi kapatır.
 */

/**
 * Pencerede iki sütunlu ızgaradaki çip (FilterChip className): hücreyi doldurur, ad solda, sayı sağda, 44px.
 * Sayılar değişince çiplerin genişliği ve satır sayısı değişmez; ad ile noktasını tek <span>'e sarın.
 */
export const SHEET_CHIP = "h-11 w-full justify-between px-3.5 text-sm";

/** "Süzgeç" düğmesi (44px); rozet etkin süzgeç sayısı */
export function FilterSheetButton({ count, onClick, className }: { count: number; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-filter-sheet-trigger=""
      aria-haspopup="dialog"
      aria-label={count ? `Süzgeç, ${count} süzgeç etkin` : "Süzgeç"}
      className={cn(buttonClass("secondary", "md"), "h-11 gap-2 px-3.5 pointer-coarse:h-11", count ? "text-ink ring-ink/30" : "text-ink-soft", className)}
    >
      <SlidersHorizontal size={16} aria-hidden="true" />
      Süzgeç
      {count ? (
        <span className="-mr-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1.5 text-[11px] leading-none font-semibold text-white tabular" aria-hidden="true">
          {count}
        </span>
      ) : null}
    </button>
  );
}

/** Düğmenin altındaki özet satırı ("Dikkat · Espresso Bazlı"): hangi süzgeçlerin açık olduğu görünsün; dokununca pencere açılır */
export function FilterSummaryLine({ text, onClick, className }: { text: string; onClick: () => void; className?: string }) {
  if (!text) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("-my-1 flex min-h-11 min-w-0 cursor-pointer items-center gap-1.5 text-left text-[13px] leading-5 text-ink-soft", className)}
    >
      <span className="shrink-0 text-ink-mute">Süzgeç:</span>{" "}
      <span className="min-w-0 font-medium text-pretty text-ink">{text}</span>
    </button>
  );
}

/** Pencerenin bir bölümü: küçük başlık + içerik */
export function SheetSection({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-ink-soft">{title}</h3>
        {aside ? <span className="text-xs text-ink-mute">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** Pencerede aç/kapa satırı: satırın tamamı dokunulabilir (etiket anahtarı tetikler), en az 56px */
export function SheetToggle({
  title,
  description,
  checked,
  onChange,
  label,
}: {
  title: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  /** Anahtarın erişilebilir adı */
  label: string;
}) {
  return (
    <label className="flex min-h-14 cursor-pointer items-center justify-between gap-4 rounded-2xl bg-panel px-4 py-2.5 select-none">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{title}</span>
        {description ? <span className="mt-0.5 block text-xs leading-5 text-ink-mute">{description}</span> : null}
      </span>
      <Switch checked={checked} onChange={onChange} label={label} className="pointer-coarse:h-11" />
    </label>
  );
}

/**
 * Alttan açılan süzgeç penceresi (yerel <dialog>: odak içeride kalır, Esc kapatır, arka sayfa kaymaz).
 * Tutamaktan aşağı çekmek, arka plana dokunmak ya da alttaki düğme kapatır. Alt kenar güvenli alana uyar.
 */
export function FilterSheet({
  open,
  onClose,
  title = "Süzgeç",
  children,
  onClear,
  canClear,
  shown,
  unit,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  onClear: () => void;
  /** Varsayılandan farklı süzgeç var mı ("Temizle" etkin) */
  canClear: boolean;
  /** Süzgeçlere uyan kayıt sayısı ve birimi: "84 ürünü göster" */
  shown: number;
  unit: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const reduce = useCalmMotion();
  const drag = useDragControls();
  // Kapanınca odak açan düğmeye döner (iOS'ta dokunulan düğme odak almaz: o zaman sayfanın Süzgeç düğmesi)
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      const active = document.activeElement;
      opener.current =
        active instanceof HTMLElement && active !== document.body ? active : document.querySelector<HTMLElement>("[data-filter-sheet-trigger]");
      el.showModal();
    }
    if (!open && el.open) {
      el.close();
      const back = opener.current;
      if (back?.isConnected && back.offsetParent !== null) back.focus({ preventScroll: true });
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // Arka plana (pencerenin üstündeki boşluğa) dokunmak kapatır
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-0 mt-auto h-fit max-h-full w-full max-w-full overflow-visible border-0 bg-transparent p-0 text-ink backdrop:bg-ink/25 backdrop:backdrop-blur-[2px] sm:mx-auto sm:max-w-lg"
    >
      {open ? (
        <motion.div
          drag="y"
          dragListener={false}
          dragControls={drag}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.6 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 80 || info.velocity.y > 500) onClose();
          }}
          initial={reduce ? false : { y: "100%" }}
          animate={{ y: 0 }}
          transition={reduce ? { duration: 0 } : SPRING_PANEL}
          className="flex max-h-[calc(100dvh-2.5rem)] flex-col rounded-t-3xl bg-surface shadow-[0_-12px_40px_rgba(0,0,0,0.14)]"
        >
          {/* Tutamak ve başlık: buradan aşağı çekince kapanır */}
          <div className="shrink-0 cursor-grab touch-none px-5 pt-2.5 active:cursor-grabbing" onPointerDown={(e) => drag.start(e)}>
            <span className="mx-auto block h-1.5 w-10 rounded-full bg-panel-deep" aria-hidden="true" />
            <div className="flex items-center justify-between gap-3 pt-2 pb-1">
              <h2 id={titleId} className="text-lg font-semibold tracking-tight">
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="-mr-2 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-ink-quiet hover:bg-ink/[0.05] hover:text-ink"
                aria-label="Kapat"
              >
                <X size={20} />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 pt-2 pb-5">{children}</div>
          <div className="flex shrink-0 items-center gap-2 border-t border-line-strong px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button variant="ghost" className="h-11 pointer-coarse:h-11" disabled={!canClear} onClick={onClear}>
              Temizle
            </Button>
            <Button className="h-11 flex-1 pointer-coarse:h-11" onClick={onClose} aria-live="polite">
              {showLabel(shown, unit)}
            </Button>
          </div>
        </motion.div>
      ) : null}
    </dialog>
  );
}
