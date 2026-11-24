"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { Toaster } from "sonner";

import { TOAST_ICONS } from "./toast-icon";
import { toastLayout, type ToastLayout, type ToastScene } from "./toast-layout";

type ToasterProps = Omit<ComponentProps<typeof Toaster>, "position" | "offset" | "mobileOffset" | "icons">;

const PHONE = "(width < 40rem)";
const BELOW_LG = "(width < 64rem)";

/** Açık modal pencereler, açılış sırasıyla (en üstteki sonda) */
function openModals(order: HTMLDialogElement[]): HTMLDialogElement[] {
  const live = order.filter((d) => d.isConnected && d.open && d.matches(":modal"));
  for (const d of document.querySelectorAll<HTMLDialogElement>("dialog[open]")) {
    if (!live.includes(d) && d.matches(":modal")) live.push(d);
  }
  return live;
}

/**
 * Sonner bildirimleri tarayıcının üst katmanında (top layer).
 *
 * - Bildirim alanı `popover="manual"` bir kaptadır; sayfada bir modal pencere (<dialog>, telefonda alttan açılan
 *   sayfa) açıkken kap o pencerenin İÇİNE taşınır ve yeniden gösterilir. Böylece bildirim pencerenin üstünde durur
 *   ve dokunulabilir: modal pencerenin dışındaki her şey etkisizdir (inert), dışarıdaki bir bildirime dokunmak
 *   altındaki düğmeye (ör. pencerenin Kapat ✕'i) giderdi. Pencere kapanınca kap gövdeye döner.
 * - Yer (toast-layout.ts): telefonda panelde başparmağın yetiştiği altta, alt menünün üstünde ("Geri al"
 *   kolayca basılır); pencere açıkken, ekran klavyesi açıkken ya da altta yüzen bir çubuk varken üstte. Pencere
 *   açıkken üstte ekranın kenarına yakın durur, alttan açılan sayfanın başlığını ve Kapat düğmesini örtmez.
 *   Tablette (lg altı) üst çubuğun altında, masaüstünde üstte.
 * Popover desteklemeyen tarayıcıda kap sıradan bir öğe gibi davranır (bildirimler z-index'le görünür).
 * - Kart (rare-ui toast'tan uyarlandı): solda hareketli ikon karosu (`TOAST_ICONS`, toast-icon.tsx), 21 px köşe, ince
 *   çizgi, panelin gölgesi; eylem düğmesi ("Geri al") karo köşesinde gri, kapatma düğmesi farede kartın üstüne
 *   gelince görünür (dokunmatikte hep görünür). Biçim globals.css › "Bildirim kartı". `toast.*` API'si aynı.
 */
export function TopLayerToaster({ toastOptions, ...props }: ToasterProps) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [scene, setScene] = useState<ToastScene>({ phone: false, belowLg: false, shell: false, modal: false, keyboard: false, bottomBar: false });

  useEffect(() => {
    const el = document.createElement("div");
    el.dataset.toastHost = "";
    // Popover'ın tarayıcı stilleri (kenarlık, zemin, ortalama) sıfırlanır: kap görünmez, bildirimler kendi sabit
    // konumlarında (sonner) durur
    el.style.cssText = "margin:0;width:0;height:0;overflow:visible;border:0;background:transparent;padding:0;inset:auto";
    const popover = typeof el.showPopover === "function";
    if (popover) el.setAttribute("popover", "manual");
    document.body.appendChild(el);

    const phone = window.matchMedia(PHONE);
    const belowLg = window.matchMedia(BELOW_LG);
    let order: HTMLDialogElement[] = [];
    let raf = 0;

    const raise = () => {
      if (!popover) return;
      try {
        if (el.matches(":popover-open")) el.hidePopover();
        el.showPopover();
      } catch {
        // Kap DOM'dan ayrıldıysa ya da tarayıcı reddederse bildirimler sayfada kalır
      }
    };

    const sync = () => {
      cancelAnimationFrame(raf);
      order = openModals(order);
      const top = order.at(-1) ?? null;
      const parent = top ?? document.body;
      if (el.parentElement !== parent || !el.isConnected) {
        parent.appendChild(el);
        raise();
      } else if (popover && !el.matches(":popover-open")) raise();
      setHost(el);
      const next: ToastScene = {
        phone: phone.matches,
        belowLg: belowLg.matches,
        shell: document.querySelector('[data-component="app-shell"]') !== null,
        modal: top !== null,
        keyboard: document.documentElement.dataset.keyboard === "open",
        bottomBar: document.querySelector("[data-floating-bar], [data-bottom-bar]") !== null,
      };
      // Değişmediyse yeniden çizilmez (DOM her değiştiğinde denetlenir)
      setScene((prev) => ((Object.keys(next) as (keyof ToastScene)[]).every((k) => prev[k] === next[k]) ? prev : next));
    };
    // DOM değişiklikleri sık olur; denetim kare başına bir kez
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(sync);
    };

    // İlk yerleşim bir sonraki karede (etkinin içinde eşzamanlı durum güncellemesi yok)
    schedule();

    const observer = new MutationObserver((records) => {
      let now = false;
      for (const r of records) {
        if (r.type === "attributes" && r.target instanceof HTMLDialogElement) {
          if (r.target.open && !order.includes(r.target)) order.push(r.target);
          now = true;
        }
      }
      // Pencere açılınca hemen taşı (açılış hareketi boyunca bildirim pencerenin arkasında kalmasın)
      if (now || !el.isConnected) sync();
      else schedule();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "data-floating-bar", "data-bottom-bar"] });
    const htmlObserver = new MutationObserver(schedule);
    htmlObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-keyboard"] });
    phone.addEventListener("change", schedule);
    belowLg.addEventListener("change", schedule);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      htmlObserver.disconnect();
      phone.removeEventListener("change", schedule);
      belowLg.removeEventListener("change", schedule);
      try {
        if (popover) el.hidePopover();
      } catch {
        // zaten kapalı
      }
      el.remove();
      setHost(null);
    };
  }, []);

  if (!host) return null;
  const layout: ToastLayout = toastLayout(scene);
  return createPortal(
    <Toaster
      {...props}
      position={layout.position}
      offset={layout.offset}
      mobileOffset={layout.offset}
      containerAriaLabel="Bildirimler"
      icons={TOAST_ICONS}
      toastOptions={{ closeButtonAriaLabel: "Bildirimi kapat", ...toastOptions }}
    />,
    host,
  );
}
