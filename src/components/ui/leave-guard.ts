"use client";

import { useEffect, useState } from "react";

/**
 * Şube seçicinin geçiş isteği (src/components/panel/branch-picker.tsx; detail: seçimi `?sube=` ile yapan adres).
 * Şube değişince baştan kurulan form (Stok sayımı) bunu `useLeaveGuard`'a verir: kaydedilmemiş değişiklik varken olay
 * iptal edilir, seçici yerinde kalır ve form kendi onay penceresini açar; "Kaydetmeden geç" o adrese gider, seçici
 * `?sube=`'yi çereze benimsetir (`branchLinkStep`).
 */
export const BRANCH_LEAVE = "panel:sube";

/**
 * Kaydedilmemiş formdan çıkış koruması (Stok sayımı): kirliyken sayfa kapatılır ya da yenilenirse
 * tarayıcı sorar (beforeunload); panel içi bağlantılara (menü, alt çubuk) dokunulunca geçiş yakalama evresinde
 * durdurulur ve adresi `leaveHref` olur: form kendi onay penceresini açar, "Kaydetmeden geç" o adrese gider.
 * `events`: aynı korumayı isteyen özel olayların adları (ay seçicisi, şube seçicisi `BRANCH_LEAVE`; detail = adres).
 */
export function useLeaveGuard(dirty: boolean, ...events: string[]): [string | null, (href: string | null) => void] {
  const [leaveHref, setLeaveHref] = useState<string | null>(null);
  // Olay listesi her çizimde yeni dizi: etki adların kendisine bağlı
  const eventKey = events.join(" ");
  useEffect(() => {
    if (!dirty) return;
    const names = eventKey ? eventKey.split(" ") : [];
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
    for (const name of names) window.addEventListener(name, onEvent);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      for (const name of names) window.removeEventListener(name, onEvent);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, eventKey]);
  return [leaveHref, setLeaveHref];
}
