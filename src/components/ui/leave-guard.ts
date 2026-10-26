"use client";

import { useEffect, useState } from "react";

/**
 * Kaydedilmemiş formdan çıkış koruması (Stok sayımı): kirliyken sayfa kapatılır ya da yenilenirse
 * tarayıcı sorar (beforeunload); panel içi bağlantılara (menü, alt çubuk) dokunulunca geçiş yakalama evresinde
 * durdurulur ve adresi `leaveHref` olur: form kendi onay penceresini açar, "Kaydetmeden geç" o adrese gider.
 * `event`: aynı korumayı isteyen özel olayın adı (ay seçicisi; detail = adres).
 */
export function useLeaveGuard(dirty: boolean, event?: string): [string | null, (href: string | null) => void] {
  const [leaveHref, setLeaveHref] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    const onEvent = (e: Event) => {
      e.preventDefault();
      setLeaveHref((e as CustomEvent<string>).detail);
    };
    const onClick = (e: globalThis.MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      // Kilitli bağlantıları (aria-disabled) kendi onClick'i durdurur
      if (!a || a.target === "_blank" || a.hasAttribute("download") || a.getAttribute("aria-disabled") === "true") return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaveHref(url.pathname + url.search + url.hash);
    };
    window.addEventListener("beforeunload", warn);
    if (event) window.addEventListener(event, onEvent);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      if (event) window.removeEventListener(event, onEvent);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, event]);
  return [leaveHref, setLeaveHref];
}
