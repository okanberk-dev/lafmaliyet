"use client";

import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import Link, { useLinkStatus } from "next/link";
import { useEffect, type Ref } from "react";

import { Icon } from "@/components/akmanos/icons/icon";
import { SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { cn } from "@/lib/utils";

import { badgeText, BOTTOM_NAV, bottomNavActive } from "./nav";
import { useOpenOrdersCount } from "./orders-badge";

/** Ekran klavyesi açıyor sayılan alanlar (onay kutusu, düğme, kaydırıcı değil) */
const TEXT_FIELD =
  "textarea, input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]):not([type=reset]):not([type=file]):not([type=color]):not([type=image]):not([type=hidden])";

function opensKeyboard(el: Element | null) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  return el.matches(TEXT_FIELD) && !el.matches(":disabled, [readonly]");
}

/**
 * Dokunmatik ekranda bir yazı alanı odaktayken `<html data-keyboard="open">`: alt menü gizlenir ve
 * --mobile-nav-h 0 olur (globals.css), yüzen çubuklar klavyenin hemen üstüne iner. Görünür alanın yüksekliği
 * `--vvh`, ekran klavyesinin düzenin altından örttüğü pay `--keyboard-inset` olarak yazılır: iOS'ta klavye düzeni
 * küçültmez, alttan açılan pencereler (ui/dialog) bu payla klavyenin üstüne çıkar; Android'de düzen küçülür, pay 0.
 *
 * Android'de klavye geri tuşuyla kapanınca odak alanda kalır: görünür alan klavyeyle küçülüp sonra eski boyuna
 * döndüyse klavye kapanmış sayılır (menü geri gelir); alana yeniden dokununca alan yine küçülür ve menü gizlenir.
 */
function useViewportState() {
  useEffect(() => {
    const root = document.documentElement;
    const coarse = window.matchMedia("(pointer: coarse)");
    const vv = window.visualViewport;
    let raf = 0;
    // Klavye kapalıyken görünür alanın yüksekliği (en büyüğü); ekran döndürülünce yeniden ölçülür
    let base = vv?.height ?? window.innerHeight;
    let width = window.innerWidth;
    // Odaktaki alan için klavyenin görünür alanı küçülttüğü görüldü mü / sonra eski boyuna döndü mü
    let shrunk = false;
    let closedByViewport = false;

    const keyboardShown = () => Boolean(vv && vv.scale < 1.01 && vv.height < base * 0.85);

    const measure = () => {
      if (!vv) return;
      if (window.innerWidth !== width) {
        width = window.innerWidth;
        base = vv.height;
      }
      // Yakınlaştırılmışken (iki parmak) ölçüler klavyeyi göstermez
      if (vv.scale > 1.01) return;
      base = Math.max(base, vv.height);
      root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty("--keyboard-inset", `${Math.round(inset)}px`);
    };

    const sync = () => {
      cancelAnimationFrame(raf);
      // Odak bir alandan ötekine geçerken (focusout → focusin) menü bir an görünüp kaybolmasın
      raf = requestAnimationFrame(() => {
        const focused = coarse.matches && opensKeyboard(document.activeElement);
        let open = false;
        if (!focused) {
          shrunk = false;
          closedByViewport = false;
        } else if (keyboardShown()) {
          shrunk = true;
          closedByViewport = false;
          open = true;
        } else if (shrunk) {
          // Klavye açılmıştı, alan odakta kaldığı hâlde görünür alan eski boyuna döndü: klavye kapandı
          closedByViewport = true;
        } else {
          // Klavye henüz açılıyor (ya da ölçülemiyor): odak varken açık say
          open = !closedByViewport;
        }
        if (open) root.dataset.keyboard = "open";
        else delete root.dataset.keyboard;
      });
    };
    const onFocusIn = () => {
      shrunk = false;
      closedByViewport = false;
      sync();
    };
    const onResize = () => {
      measure();
      sync();
    };

    measure();
    sync();
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", sync);
    vv?.addEventListener("resize", onResize);
    vv?.addEventListener("scroll", measure);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", sync);
      vv?.removeEventListener("resize", onResize);
      vv?.removeEventListener("scroll", measure);
      delete root.dataset.keyboard;
      root.style.removeProperty("--vvh");
      root.style.removeProperty("--keyboard-inset");
    };
  }, []);
}

/**
 * Dokunulan öğenin bekleme işareti (useLinkStatus): ekran önceden yüklenmemişse ikonun arkasında hap belirip yanıp
 * söner, ekran gelince etkin hap oraya kayar. Hızlı geçişte hiç görünmez (globals.css, .nav-pending-pill).
 */
function PendingPill() {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" data-pending={pending || undefined} className="nav-pending-pill absolute inset-0 rounded-full bg-chart-bg" />;
}

/**
 * Telefon ve tabletin alt menüsü (lg altında): 64px + güvenli alan, her öğe hücrenin tamamı kadar dokunma alanı.
 * Etkin öğenin ikonunun arkasında zinc-100 hap yaylı kayar (kenar çubuğundaki vurgu gibi). Yönetici için son öğe
 * "Tümü": çekmeceyi açar. "Ödemeler" öğesinde gecikmiş ödeme sayısı kırmızı rozetle görünür.
 */
export function BottomNav({
  role,
  pathname,
  overdue = 0,
  menuOpen = false,
  onMenu,
  menuButtonRef,
}: {
  role: "admin" | "staff";
  pathname: string;
  overdue?: number;
  menuOpen?: boolean;
  onMenu?: () => void;
  menuButtonRef?: Ref<HTMLButtonElement>;
}) {
  const reduce = useReducedMotion();
  useViewportState();
  const items = BOTTOM_NAV[role];
  const active = bottomNavActive(items, pathname, menuOpen);
  const badge = badgeText(overdue);
  // Siparişler öğesinin sayısı: açık uygulama siparişi ve masa çağrısı (kabuğun canlı verisinden; ek istek yok)
  const openOrders = useOpenOrdersCount();
  const ordersBadge = badgeText(openOrders);

  return (
    <nav
      data-mobile-nav
      aria-label="Alt menü"
      className="mobile-nav no-print fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] backdrop-blur-md lg:hidden"
    >
      <LayoutGroup id="mobile-nav">
        <ul className="mx-auto grid h-16 max-w-xl" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
          {items.map((item) => {
            const on = active === item.id;
            const showBadge = item.badge === "overdue" && badge;
            const showOrders = item.badge === "orders" && ordersBadge;
            const body = (
              <>
                <span className="relative flex h-8 w-14 items-center justify-center">
                  {item.href ? <PendingPill /> : null}
                  {on ? (
                    // Tıklama almaz: hap bir hücreden ötekine kayarken üstünden geçtiği öğeye dokunuş yutulmaz
                    <motion.span
                      layoutId="mobile-nav-pill"
                      aria-hidden="true"
                      transition={reduce ? { duration: 0 } : SPRING_SWAP}
                      className="pointer-events-none absolute inset-0 rounded-full bg-chart-bg dark:bg-ink"
                    />
                  ) : null}
                  {/* Koyu temada etkin sekme beyaz hap, ikonu koyu (docs/KOYU-TEMA.md) */}
                  <span className={cn("relative z-10", on && "dark:text-on-solid")}>
                    <Icon icon={item.icon} size="lg" />
                  </span>
                  {showBadge ? (
                    <span
                      aria-hidden="true"
                      className="absolute -top-1 right-1.5 z-20 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-bad px-1 text-[10px] leading-none font-semibold text-on-solid tabular ring-2 ring-background"
                    >
                      {badge}
                    </span>
                  ) : null}
                  {showOrders ? (
                    <span
                      aria-hidden="true"
                      className="absolute -top-1 right-1.5 z-20 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warn px-1 text-[10px] leading-none font-semibold text-on-solid tabular ring-2 ring-background"
                    >
                      {ordersBadge}
                    </span>
                  ) : null}
                </span>
                <span className={cn("max-w-full truncate px-0.5 text-[11px] leading-4", on ? "font-semibold text-foreground" : "font-medium")}>{item.label}</span>
              </>
            );
            const cls = cn(
              "flex h-full w-full cursor-pointer flex-col items-center justify-center gap-1 outline-none transition-colors select-none focus-visible:ring-2 focus-visible:ring-foreground/30 focus-visible:ring-inset",
              on ? "text-foreground" : "text-chart-muted active:text-foreground",
            );
            const label = showBadge ? `${item.label}, ${overdue} gecikmiş ödeme` : showOrders ? `${item.label}, ${openOrders} açık` : item.label;
            return (
              <li key={item.id} className="min-w-0">
                {item.href ? (
                  <Link href={item.href} aria-current={on && !menuOpen ? "page" : undefined} aria-label={label} className={cls}>
                    {body}
                  </Link>
                ) : (
                  <button ref={menuButtonRef} type="button" onClick={onMenu} aria-label={label} aria-haspopup="dialog" aria-expanded={menuOpen} className={cls}>
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </LayoutGroup>
    </nav>
  );
}

/** Kabuk yüklenirken alt menünün yeri (aynı yükseklik, boş) */
export function BottomNavSkeleton() {
  return <div aria-hidden="true" className="fixed inset-x-0 bottom-0 z-30 h-[calc(4rem+env(safe-area-inset-bottom))] border-t border-border bg-background lg:hidden" />;
}
