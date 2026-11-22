"use client";

import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Telefon genişliği (Tailwind sm altı): pencere alttan açılan sayfa (bottom sheet) olur */
const SHEET_QUERY = "(width < 40rem)";
/** Bu kadar aşağı çekilen ya da hızlı fırlatılan sayfa kapanır */
const DISMISS_PX = 110;
const DISMISS_SPEED = 0.6; // px/ms

function springBack(el: HTMLElement) {
  el.style.transition = "transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)";
  el.style.transform = "";
}

/*
 * Tarayıcının kendiliğinden kapattığı pencerelerin yeniden açılması. Chrome, arada dokunma olmadan üst üste açılmış
 * pencereleri tek Esc ile birlikte kapatabilir (ör. bir pencere ve içindeki onay). Sayfa hâlâ açık istiyorsa
 * pencereler İLK AÇILIŞ SIRASIYLA yeniden açılır: onay, ait olduğu pencerenin arkasında kalmaz.
 */
let openCounter = 0;
const openOrder = new WeakMap<HTMLDialogElement, number>();
const reopenQueue = new Map<HTMLDialogElement, () => void>();
let reopenTimer: ReturnType<typeof setTimeout> | null = null;

function markOpened(el: HTMLDialogElement) {
  openOrder.set(el, ++openCounter);
}

function queueReopen(el: HTMLDialogElement, reopen: () => void) {
  reopenQueue.set(el, reopen);
  if (reopenTimer) return;
  reopenTimer = setTimeout(() => {
    reopenTimer = null;
    const items = [...reopenQueue].sort(([a], [b]) => (openOrder.get(a) ?? 0) - (openOrder.get(b) ?? 0));
    reopenQueue.clear();
    for (const [, reopen] of items) reopen();
  }, 0);
}

/**
 * Tarayıcının yerel <dialog> öğesiyle hafif bir modal pencere.
 * Masaüstü ve tablette ortada `rounded-3xl` kart; telefonda (sm altı) alttan açılan tam genişlikte sayfa: üstü
 * yuvarlak, en çok ekranın %92'si, içerik kendi içinde kayar, altbilgi altta sabit ve güvenli alanı (ana ekran
 * çubuğu) gözetir. Telefonda başlık bölgesinden aşağı çekince kapanır. API iki durumda da aynıdır.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  footerStart,
  footerStartOnPhone = "footer",
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
  /**
   * Telefonda `footerStart` nerede dursun: "footer" (varsayılan) altbilgide; "body" formun sonunda ayrı bir satırda,
   * altta yapışık satırda yalnızca Vazgeç / Kaydet kalır (ikincil ve yıkıcı eylemler başparmağın dinlendiği köşeden
   * uzak). sm ve üstünde her iki durumda da altbilginin solunda.
   */
  footerStartOnPhone?: "footer" | "body";
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Arka plana tıklama yalnızca basış da arka planda başladıysa kapatır (alandan dışarı sürüklenen seçim kapatmasın)
  const downOnBackdrop = useRef(false);
  // Pencereyi açan öğe (çoğunlukla bir düğme) ve pencerenin şu an açık olup olmadığı
  const opener = useRef<HTMLElement | null>(null);
  const shown = useRef(false);
  // Telefonda aşağı çekerek kapatma
  const drag = useRef<{ id: number; y0: number; t0: number; dy: number; active: boolean } | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sayfa kapanmayı reddedebilir (ör. "Parola kopyalanmadı, yine de kapatılsın mı?"); tarayıcı pencereyi kendisi
  // kapattıysa (Esc'ye üst üste basınca Chrome iptal olayını atlayabilir) ve sayfa hâlâ açık istiyorsa yeniden açılır
  const wantOpen = useRef(open);
  useLayoutEffect(() => {
    wantOpen.current = open;
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
      // Önceki açılışta aşağı çekilip kapatıldıysa sayfa yerine dönsün
      el.style.removeProperty("transform");
      el.style.removeProperty("transition");
      el.showModal();
      markOpened(el);
      shown.current = true;
      // showModal'dan sonra odak: önce [data-autofocus], yoksa ilk alan. Dokunmatik ekranda klavye açan bir alana
      // kendiliğinden odaklanılmaz: ekran klavyesi açılıp formun yarısını örtmesin (alana dokununca açılır). Tek
      // amacı yazmak olan pencerede (hücre tutarı, doğrulama kodu) alan data-autofocus="always" ile işaretlenir.
      requestAnimationFrame(() => {
        const touch = window.matchMedia("(pointer: coarse)").matches;
        const explicit = el.querySelector<HTMLElement>("[data-autofocus], [autofocus]");
        const keyboard = (t: HTMLElement) => t.matches("textarea, input:not([type=checkbox], [type=radio], [type=range], [type=button], [type=submit], [type=date], [type=month])");
        const target = touch
          ? explicit && (!keyboard(explicit) || explicit.dataset.autofocus === "always")
            ? explicit
            : null
          : (explicit ?? el.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea"));
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
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      const back = opener.current;
      if (!el || !back || !shown.current) return;
      queueMicrotask(() => {
        if (el.isConnected || !back.isConnected) return;
        const active = document.activeElement;
        if (!active || active === document.body) back.focus({ preventScroll: true });
      });
    };
  }, []);

  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !window.matchMedia(SHEET_QUERY).matches) return;
    if ((e.target as Element).closest("button, a, input, select, textarea, [role=button]")) return;
    drag.current = { id: e.pointerId, y0: e.clientY, t0: e.timeStamp, dy: 0, active: false };
    // Parmak (ya da fare) başlıktan çıksa da hareket izlensin
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || d.id !== e.pointerId || !el) return;
    const dy = e.clientY - d.y0;
    if (!d.active) {
      if (dy < -6) drag.current = null;
      if (dy <= 6) return;
      d.active = true;
      el.style.transition = "none";
    }
    d.dy = Math.max(0, dy);
    el.style.transform = `translateY(${d.dy}px)`;
  };
  const onHandleUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = ref.current;
    drag.current = null;
    if (!d?.active || !el) return;
    const speed = d.dy / Math.max(1, e.timeStamp - d.t0);
    if (e.type !== "pointercancel" && (d.dy > DISMISS_PX || (speed > DISMISS_SPEED && d.dy > 30))) {
      el.style.transition = "transform 0.18s ease-in";
      el.style.transform = "translateY(100%)";
      dismissTimer.current = setTimeout(() => {
        onClose();
        // Sayfa kapanmayı reddettiyse (ör. kayıt sürüyor) pencere görünmez kalmasın: yerine döner
        dismissTimer.current = setTimeout(() => {
          if (el.isConnected && el.open) springBack(el);
        }, 250);
      }, 170);
    } else {
      springBack(el);
    }
  };

  const width = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  const hasFooter = Boolean(footer || footerStart);
  const startInBody = Boolean(footerStart) && footerStartOnPhone === "body";
  // Telefonda altbilgide düğme kalmıyorsa (yalnız footerStart vardı ve forma taşındı) altbilgi gizlenir
  const phoneFooter = Boolean(footer) || (Boolean(footerStart) && !startInBody);

  return (
    <dialog
      ref={ref}
      data-sheet
      // close ve cancel React ağacında üst bileşenlere de ulaşır: içteki bir pencerenin (ör. ConfirmDialog) olayı
      // bu pencereyi kapatmasın
      onClose={(e) => {
        if (e.target !== e.currentTarget) return;
        shown.current = false;
        onClose();
        const el = ref.current;
        if (!el) return;
        queueReopen(el, () => {
          if (wantOpen.current && el.isConnected && !el.open) {
            el.showModal();
            shown.current = true;
          }
        });
      }}
      onCancel={(e) => {
        if (e.target !== e.currentTarget) return;
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
        "m-auto w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] rounded-3xl bg-surface p-0 text-ink shadow-[0_12px_40px_rgba(0,0,0,0.14)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop:bg-ink/20 backdrop:backdrop-blur-[2px] dark:backdrop:bg-black/60",
        width,
        // Telefonda alttan açılan sayfa. iOS'ta ekran klavyesi düzeni küçültmez: sayfa klavyenin üstüne çıkar
        // (--keyboard-inset) ve görünür alana sığar (--vvh); ikisi de bottom-nav.tsx'te yazılır, yoksa 0 / 100dvh.
        "max-sm:mb-(--keyboard-inset,0px) max-sm:w-full max-sm:max-w-none max-sm:max-h-[min(92dvh,calc(var(--vvh,100dvh)-0.5rem))] max-sm:rounded-b-none max-sm:shadow-[0_-8px_40px_rgba(0,0,0,0.16)]",
      )}
    >
      {open ? (
        <div className="flex max-h-[min(85dvh,calc(100dvh-2rem))] flex-col max-sm:max-h-[min(92dvh,calc(var(--vvh,100dvh)-0.5rem))]">
          <div
            className="shrink-0 max-sm:touch-none"
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
          >
            {/* Telefonda tutamaç: sayfanın aşağı çekilebildiğini gösterir */}
            <div aria-hidden="true" className="flex justify-center pt-2 sm:hidden">
              <span className="h-1 w-9 rounded-full bg-ink/15" />
            </div>
            <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3 max-sm:px-5 max-sm:pt-2.5">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight text-pretty break-words">{title}</h2>
                {description ? <p className="mt-0.5 text-sm text-pretty text-ink-mute">{description}</p> : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="-mt-1 -mr-1.5 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-quiet hover:bg-ink/[0.05] hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none pointer-coarse:size-11 max-sm:-mr-2.5"
                aria-label="Kapat"
                title="Kapat (Esc)"
              >
                <X size={18} />
              </button>
            </div>
          </div>
          <div
            className={cn(
              "min-h-0 overflow-y-auto overscroll-contain px-6 py-3 max-sm:px-5",
              !phoneFooter && "max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]",
            )}
          >
            {children}
            {startInBody ? (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 sm:hidden [&_a]:min-h-11 [&_button]:min-h-11">{footerStart}</div>
            ) : null}
          </div>
          {hasFooter ? (
            <div
              className={cn(
                "flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line-strong px-6 py-3.5",
                !phoneFooter && "max-sm:hidden",
                // Telefonda başparmakla: düğmeler satırı eşit paylaşır, 48px yüksekliğindedir ve ana ekran çubuğunun
                // üstünde kalır
                "max-sm:px-5 max-sm:pt-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:[&>a]:flex-1 max-sm:[&>button]:flex-1 max-sm:[&_a]:min-h-12 max-sm:[&_button]:min-h-12",
              )}
            >
              {footerStart ? <div className={cn("mr-auto flex items-center gap-2", startInBody && "max-sm:hidden")}>{footerStart}</div> : null}
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
