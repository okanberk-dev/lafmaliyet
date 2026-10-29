"use client";

import { ChevronRight } from "lucide-react";
import { LayoutGroup, motion, useReducedMotion, type Transition } from "motion/react";
import Link, { useLinkStatus } from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode, type RefObject } from "react";

import { Icon } from "@/components/akmanos/icons/icon";
import { SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { cn } from "@/lib/utils";

import { activeChildOf, activeGroupOf, keepGroupOpen, navLit, pathMatches, revealDelta, type NavNode } from "./nav";

/**
 * AkmanOS "Sidebar" bloğundaki SidebarNav (src/components/akmanos/sidebar/sidebar-nav.tsx), Next.js bağlantıları
 * ve adres çubuğuna göre etkin durumla. Beyaz liste kabı, ikon karolu üst öğeler, yaylı açılan alt listeler ve
 * fareyi izleyen tek vurgu (layoutId) aynen korunur.
 *
 * Tek tıklamada açılsın diye: vurgu tıklama almaz (pointer-events-none) ve yalnız fareyle ya da klavye odağıyla
 * taşınır. Eskiden fareyle tıklamanın odak değişimi (önceki bağlantının blur'u) vurguyu basma ile bırakma arasında
 * silip yeniden kuruyordu; basılan öğe DOM'dan kalkınca Chrome/Edge click'i hiç göndermiyor, ilk tıklama boşa
 * gidiyordu. Dokunmatikte "üstüne gelme" yok: iOS ilk dokunuşu üzerine gelme sayıp tıklamayı yutmaz.
 */
const SUBLIST_TRANSITION: Transition = { type: "spring", duration: 0.55, bounce: 0.12 };
/** Adres değişince (ya da kutu görünür olunca) etkin satır bu süre boyunca izlenir: grubun yaylı açılışı ~0,55 sn */
const REVEAL_FOLLOW_MS = 1000;
const REVEAL_RELEASE = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/**
 * Etkin sayfanın satırı kaydırma kutusunun dışında kalmasın (Vergi grubu listenin sonunda; 900 px yüksek dizüstünde
 * Muhasebeci kutunun altındaydı, telefonun çekmecesinde Nakit planı da). Adres değişince, çekmece açılınca ve kutu
 * görünür olunca (masaüstü genişliğine geçince) kutu yalnız gereken kadar kaydırılır. Grup açılırken kutunun kaydırma
 * payı içerik büyüdükçe artar: açılış sürerken her boyut değişiminde yeniden bakılır. Yalnız kutu kaydırılır
 * (scrollIntoView sayfayı da kaydırabilirdi); kullanıcı listeye dokunur, kaydırır ya da tuşa basarsa bırakılır.
 */
function useRevealActive(box: RefObject<HTMLDivElement | null>, pathname: string) {
  useEffect(() => {
    const el = box.current;
    const list = el?.firstElementChild;
    if (!el || !list) return;
    const shown = () => el.getClientRects().length > 0;
    let until = performance.now() + REVEAL_FOLLOW_MS;
    let wasShown = shown();
    const reveal = () => {
      const now = shown();
      if (now && !wasShown) until = performance.now() + REVEAL_FOLLOW_MS;
      wasShown = now;
      if (!now || performance.now() > until) return;
      const link = el.querySelector<HTMLElement>('a[aria-current="page"]');
      if (!link) return;
      // Kullanıcının kapattığı grupta satır görünmez: grubun başlığı gösterilir
      const target = link.closest("[inert]")?.closest("li")?.querySelector("button") ?? link;
      const delta = revealDelta(el.getBoundingClientRect(), target.getBoundingClientRect());
      if (delta) el.scrollTop += delta;
    };
    const release = () => {
      until = 0;
    };
    const observer = new ResizeObserver(reveal);
    observer.observe(el);
    observer.observe(list);
    const opts = { passive: true, capture: true };
    for (const t of REVEAL_RELEASE) el.addEventListener(t, release, opts);
    return () => {
      observer.disconnect();
      for (const t of REVEAL_RELEASE) el.removeEventListener(t, release, opts);
    };
  }, [box, pathname]);
}

function SubList({ open, children }: { open: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  // İlk yükseklik animasyonsuz uygulanır: sayfa açıldığında etkin grup kapalıdan açılırken görünmesin
  const [settled, setSettled] = useState(false);
  const reduce = useReducedMotion();

  // Yükseklik ResizeObserver'la izlenir; her çizimde (fare her satıra geçtiğinde) yeniden kurulmaz
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setHeight(node.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      initial={false}
      animate={{ height: open ? height : 0 }}
      transition={reduce || !settled ? { duration: 0 } : SUBLIST_TRANSITION}
      onAnimationComplete={() => {
        if (height > 0 && !settled) setSettled(true);
      }}
      className="overflow-hidden"
    >
      {/* Kapalı grubun bağlantıları sekmeyle ve ekran okuyucuyla da ulaşılmaz */}
      <div ref={ref} inert={!open} className="flex flex-col gap-0.5 py-0.5 pr-1 pl-8">
        {children}
      </div>
    </motion.div>
  );
}

/**
 * Tıklanan bağlantının bekleme halkası (useLinkStatus): ekran önceden yüklenmemişse (geliştirmede, ya da kapalı
 * gruptan hemen tıklanınca) sunucudan gelene dek döner; hızlı geçişte hiç görünmez (globals.css, .nav-pending).
 * Yeri hep ayrılı, belirince yazı kaymaz.
 */
function PendingMark({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" data-pending={pending || undefined} className={cn("nav-pending shrink-0", className)} />;
}

/** Odak klavyeyle mi geldi: fareyle tıklamada false (vurgu tıklama sırasında taşınmasın); seçiciyi tanımayan tarayıcıda true */
function focusVisible(el: EventTarget) {
  try {
    return el instanceof Element && el.matches(":focus-visible");
  } catch {
    return true;
  }
}

export function SidebarNav({ items, pathname, label = "Sayfalar" }: { items: NavNode[]; pathname: string; label?: string }) {
  const reduce = useReducedMotion();
  // Masaüstü kenar çubuğu ile mobil çekmece aynı anda takılı olabilir: vurgular birbirine uçmasın diye ayrı grup
  const groupId = useId();
  const activeParent = activeGroupOf(items, pathname);
  // Kullanıcının açıp kapattıkları; etkin sayfanın grubu her zaman açık
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  // Başka bölüme gidilince önceki grup kendiliğinden kapanmaz: alttaki satırlar tıklanan öğeyle birlikte yukarı kaymaz
  const [shownParent, setShownParent] = useState(activeParent);
  if (shownParent !== activeParent) {
    setShownParent(activeParent);
    setToggled((t) => keepGroupOpen(t, shownParent));
  }
  // Farenin üstünde durduğu öğe ve klavye odağı (ayrı tutulur: fareyle tıklamanın blur'u vurguyu oynatmaz)
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const isOpen = (id: string) => toggled[id] ?? id === activeParent;
  const scrollBox = useRef<HTMLDivElement>(null);
  useRevealActive(scrollBox, pathname);
  const lit = (key: string, active: boolean) => navLit(key, active, hovered ?? focused);

  const highlight = (rounded: string) => (
    <motion.span
      layoutId="panel-nav-highlight"
      aria-hidden="true"
      transition={reduce ? { duration: 0 } : SPRING_SWAP}
      className={cn("pointer-events-none absolute inset-0 bg-chart-bg", rounded)}
    />
  );
  const point = (key: string) => ({
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType === "mouse") setHovered(key);
    },
    onFocus: (e: FocusEvent) => {
      if (focusVisible(e.target)) setFocused(key);
    },
    onBlur: () => setFocused((f) => (f === key ? null : f)),
  });
  const tile = (icon: NavNode["icon"], strong: boolean) => (
    <span
      className={cn(
        "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-lg bg-chart-card-bg transition-colors",
        strong ? "text-foreground" : "text-chart-muted",
      )}
    >
      <Icon icon={icon} size="sm" />
    </span>
  );

  return (
    <nav aria-label={label} className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="shrink-0 px-2 text-[0.65rem] font-medium tracking-wide text-chart-muted uppercase">{label}</p>
      <div ref={scrollBox} className="sidebar-nav-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <LayoutGroup id={`panel-nav${groupId}`}>
          {/* Fare listeden çıkınca vurgu etkin sayfaya döner; satır aralarındaki 2px boşlukta zıplamaz */}
          <ul onPointerLeave={() => setHovered(null)} className="flex flex-col gap-0.5 rounded-2xl bg-chart-metric-bg p-1.5">
            {items.map((item) => {
              const key = `p-${item.id}`;
              if (!item.children) {
                const active = pathMatches(pathname, item.href!);
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href!}
                      aria-current={active ? "page" : undefined}
                      {...point(key)}
                      className="relative flex h-11 min-h-11 w-full items-center gap-2 rounded-xl pr-2.5 pl-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
                    >
                      {lit(key, active) ? highlight("rounded-xl") : null}
                      {tile(item.icon, active)}
                      <span className={cn("relative z-10 min-w-0 flex-1 truncate", active ? "font-semibold" : "font-medium")}>{item.label}</span>
                      <PendingMark className="relative z-10" />
                    </Link>
                  </li>
                );
              }
              const open = isOpen(item.id);
              const parentActive = activeParent === item.id;
              // Grupta tek alt öğe yanar: Fiyatlar'da Ürünler, Nakit planı'nda Ödemeler yanmaz (en uzun eşleşen adres)
              const activeChild = activeChildOf(item.children, pathname);
              return (
                <li key={item.id} className="flex flex-col">
                  <div className="relative flex h-11 min-h-11 w-full items-stretch rounded-xl" {...point(key)}>
                    {lit(key, parentActive && !open) ? highlight("rounded-xl") : null}
                    {/* Düğme satırın tamamını kaplar (44px): üst ve alt kenara dokunmak da grubu açar */}
                    <button
                      type="button"
                      onClick={() => setToggled((t) => ({ ...t, [item.id]: !open }))}
                      aria-expanded={open}
                      className="relative z-10 flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl pr-2.5 pl-2 text-left text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
                    >
                      {tile(item.icon, parentActive)}
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <motion.span
                        animate={{ rotate: open ? 90 : 0 }}
                        transition={reduce ? { duration: 0 } : SPRING_SWAP}
                        className="flex size-7 shrink-0 items-center justify-center text-chart-muted"
                      >
                        <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
                      </motion.span>
                    </button>
                  </div>
                  <SubList open={open}>
                    {item.children.map((child) => {
                      const active = child.id === activeChild;
                      const ck = `c-${child.id}`;
                      return (
                        <Link
                          key={child.id}
                          href={child.href}
                          aria-current={active ? "page" : undefined}
                          tabIndex={open ? undefined : -1}
                          {...point(ck)}
                          className={cn(
                            "relative flex h-9 min-h-9 items-center rounded-lg px-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-foreground/20 pointer-coarse:h-11",
                            active ? "font-medium text-foreground" : "text-chart-muted hover:text-foreground",
                          )}
                        >
                          {lit(ck, active) ? highlight("rounded-lg") : null}
                          {/* Soldaki girintide, üst öğenin karosu hizasında: etkin sayfanın noktası, beklerken halka */}
                          {active ? <span aria-hidden="true" className="pointer-events-none absolute top-1/2 -left-2.5 size-1 -translate-y-1/2 rounded-full bg-foreground" /> : null}
                          <PendingMark className="absolute top-1/2 -left-[15px] -translate-y-1/2" />
                          <span className="relative z-10 min-w-0 flex-1 truncate">{child.label}</span>
                        </Link>
                      );
                    })}
                  </SubList>
                </li>
              );
            })}
          </ul>
        </LayoutGroup>
      </div>
    </nav>
  );
}
