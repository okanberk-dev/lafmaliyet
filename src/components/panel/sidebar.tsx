"use client";

import { ExternalLink, HelpCircle, Menu, QrCode, Settings, UserRound, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ProfileDropdown, type ProfileDropdownItem } from "@/components/akmanos/profile-dropdown";
import { SPRING_PANEL } from "@/components/akmanos/lib/motion-ease";
import { LafTile } from "@/components/brand";
import { ROLES } from "@/lib/constants";
import { logoutAction } from "@/server/actions/auth";
import { loadPanelNotifications, type PanelNotification } from "@/server/actions/notifications";
import type { SearchEntry } from "@/server/data/search";

import { PanelSearch, SearchTrigger } from "./command-palette";
import { NAV_FOOTER, NAV_GROUPS, navTreeFor, type NavItem } from "./nav";
import { NotificationMenu } from "./notifications";
import { SidebarNav } from "./sidebar-nav";

type User = { name: string; email: string; role: "admin" | "staff" };

const iconButton =
  "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-background text-foreground outline-none transition-colors hover:bg-chart-bg focus-visible:ring-2 focus-visible:ring-foreground/30";

/**
 * AkmanOS "App Shell" + "Sidebar" blokları: zinc-100 kenar çubuğu; logo ve zil, geniş ⌘K araması,
 * beyaz kapta ikon karolu menü, altta profil menüsü. İçerik sağda beyaz zeminde. Mobilde üst çubuk (menü, logo,
 * arama, zil) ve yaylı açılan çekmece. Arama paleti tek örnektir; kenar çubuğu, çekmece ve üst çubuk aynı paleti açar.
 */
export function Sidebar({ user, index = [] }: { user: User; index?: SearchEntry[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const reduce = useReducedMotion();
  // Çekmece hangi sayfada açıldıysa yalnızca orada açık kalır; sayfa değişince kendiliğinden kapanır
  const [openFor, setOpenFor] = useState<string | null>(null);
  const mobileOpen = openFor === pathname;
  const [searchOpen, setSearchOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const isAdmin = user.role === "admin";
  const home = isAdmin ? "/panel" : "/panel/receteler";

  // Uyarılar kabuk açılınca yüklenir, zil her açıldığında arka planda tazelenir; masaüstü ve mobil zil aynı listeyi gösterir
  const [alerts, setAlerts] = useState<PanelNotification[] | null>(null);
  const refreshAlerts = useCallback(() => {
    loadPanelNotifications()
      .then(setAlerts)
      .catch(() => setAlerts((a) => a ?? []));
  }, []);
  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    loadPanelNotifications()
      .then((n) => alive && setAlerts(n))
      .catch(() => alive && setAlerts([]));
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  const tree = navTreeFor(user.role);
  const allowed = (i: NavItem) => i.roles.includes(user.role);
  const pages = [...NAV_GROUPS.flatMap((g) => g.items.filter(allowed)), ...NAV_FOOTER.filter(allowed)];

  const accountItems: ProfileDropdownItem[] = [
    { id: "hesap", label: "Hesabım", icon: <UserRound className="size-4" strokeWidth={1.75} />, onSelect: () => router.push("/panel/hesap") },
    ...(isAdmin
      ? [
          { id: "ayarlar", label: "Ayarlar", icon: <Settings className="size-4" strokeWidth={1.75} />, onSelect: () => router.push("/panel/ayarlar") },
          { id: "yardim", label: "Yardım", icon: <HelpCircle className="size-4" strokeWidth={1.75} />, onSelect: () => router.push("/panel/yardim") },
        ]
      : []),
  ];
  const cafeItems: ProfileDropdownItem[] = [
    { id: "site", label: "laffogato.net", icon: <ExternalLink className="size-4" strokeWidth={1.75} />, onSelect: () => window.open("https://laffogato.net", "_blank", "noopener") },
    ...(isAdmin ? [{ id: "qr", label: "QR menü önizleme", icon: <QrCode className="size-4" strokeWidth={1.75} />, onSelect: () => window.open("/menu?onizleme=1", "_blank", "noopener") }] : []),
  ];

  const closeDrawer = useCallback(() => {
    setOpenFor(null);
    menuButtonRef.current?.focus({ preventScroll: true });
  }, []);

  const openSearch = () => {
    // Çekmeceden açılırsa çekmece kapanır; palet sayfanın üstünde tek başına durur
    setOpenFor(null);
    setSearchOpen(true);
  };

  /** Kenar çubuğunun içeriği: masaüstünde sabit, mobilde çekmecenin içinde */
  const panel = (drawer: boolean) => (
    <aside data-component="sidebar" className="flex h-full min-h-0 w-full flex-col gap-5 bg-chart-card-bg p-4 sm:p-5">
      <header className="flex shrink-0 items-center gap-2.5 px-1">
        <Link href={home} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-foreground/20" aria-label="L'Affogato, ana sayfa">
          <LafTile className="size-8 rounded-lg" />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-base font-semibold tracking-tight text-foreground">L&apos;Affogato</span>
            <span className="block truncate text-[11px] text-chart-muted">Yönetim paneli</span>
          </span>
        </Link>
        {drawer ? (
          // Mobilde zil üst çubukta; çekmecede onun yerinde kapatma düğmesi durur
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeDrawer}
            className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-2xl bg-chart-metric-bg text-foreground outline-none transition-colors hover:bg-chart-bg focus-visible:ring-2 focus-visible:ring-foreground/30"
            aria-label="Menüyü kapat"
          >
            <X className="size-[18px]" strokeWidth={1.75} aria-hidden />
          </button>
        ) : isAdmin ? (
          <NotificationMenu items={alerts} onOpen={refreshAlerts} align="left" />
        ) : null}
      </header>

      {isAdmin ? (
        <div className="relative z-20 w-full shrink-0">
          <SearchTrigger onClick={openSearch} />
        </div>
      ) : null}

      <SidebarNav items={tree} pathname={pathname} />

      <footer className="relative z-20 shrink-0 border-t border-border pt-4">
        <ProfileDropdown
          name={user.name}
          handle={ROLES[user.role]}
          email={user.email}
          menuPlacement="top"
          menuAlign="start"
          accountItems={accountItems}
          workspaceItems={cafeItems}
          onSignOut={() => void logoutAction()}
          className="w-full max-w-none"
        />
      </footer>
    </aside>
  );

  // Çekmece açıkken: Esc kapatır (içinde açık profil menüsü varsa önce o kapanır), odak kapatma düğmesine gider
  useEffect(() => {
    if (!mobileOpen) return;
    closeButtonRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (drawerRef.current?.querySelector('[aria-haspopup="menu"][aria-expanded="true"]')) return;
      closeDrawer();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen, closeDrawer]);

  return (
    <>
      {/* Mobil üst çubuk */}
      <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/90 px-4 backdrop-blur-md lg:hidden">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setOpenFor(pathname)}
          className={iconButton}
          aria-label="Menüyü aç"
          aria-expanded={mobileOpen}
          aria-haspopup="dialog"
        >
          <Menu className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
        <Link href={home} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg pl-1 outline-none focus-visible:ring-2 focus-visible:ring-foreground/20" aria-label="L'Affogato, ana sayfa">
          <LafTile className="size-8 rounded-lg" />
          <span className="truncate text-sm font-semibold tracking-tight text-foreground">L&apos;Affogato</span>
        </Link>
        {isAdmin ? (
          <>
            <SearchTrigger compact onClick={openSearch} />
            <NotificationMenu items={alerts} onOpen={refreshAlerts} align="right" variant="bar" />
          </>
        ) : null}
      </header>

      {/* Masaüstü kenar çubuğu */}
      <div className="no-print fixed inset-y-0 left-0 z-30 hidden w-[17.5rem] border-r border-border lg:block">{panel(false)}</div>

      {/* Mobil çekmece */}
      <AnimatePresence>
        {mobileOpen ? (
          <>
            <motion.button
              type="button"
              aria-label="Menüyü kapat"
              tabIndex={-1}
              data-scroll-lock
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={reduce ? { duration: 0 } : SPRING_PANEL}
              className="fixed inset-0 z-40 bg-foreground/20 lg:hidden"
              onClick={closeDrawer}
            />
            <motion.div
              ref={drawerRef}
              initial={reduce ? false : { x: "-100%" }}
              animate={{ x: 0 }}
              exit={reduce ? undefined : { x: "-100%" }}
              transition={reduce ? { duration: 0 } : SPRING_PANEL}
              className="fixed inset-y-0 left-0 z-50 flex w-[min(calc(100%-3rem),20rem)] shadow-[0_12px_40px_rgba(0,0,0,0.18)] lg:hidden"
              role="dialog"
              aria-modal="true"
              aria-label="Menü"
            >
              {panel(true)}
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>

      {isAdmin ? <PanelSearch pages={pages} index={index} open={searchOpen} onOpenChange={setSearchOpen} hideTrigger /> : null}
    </>
  );
}

export function SidebarSkeleton() {
  return (
    <>
      <header className="sticky top-0 z-30 h-14 border-b border-border bg-background lg:hidden" />
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[17.5rem] border-r border-border bg-chart-card-bg lg:block" />
    </>
  );
}
