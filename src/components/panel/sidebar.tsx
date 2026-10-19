"use client";

import { ExternalLink, HelpCircle, Menu, QrCode, Settings, UserRound, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { NotificationDropdown } from "@/components/akmanos/notification-dropdown";
import { ProfileDropdown, type ProfileDropdownItem } from "@/components/akmanos/profile-dropdown";
import { SPRING_PANEL } from "@/components/akmanos/lib/motion-ease";
import { LafTile } from "@/components/brand";
import { ROLES } from "@/lib/constants";
import { logoutAction } from "@/server/actions/auth";
import { loadPanelNotifications, type PanelNotification } from "@/server/actions/notifications";
import type { SearchEntry } from "@/server/data/search";

import { PanelSearch } from "./command-palette";
import { NAV_FOOTER, NAV_GROUPS, navTreeFor, type NavItem } from "./nav";
import { SidebarNav } from "./sidebar-nav";

type User = { name: string; email: string; role: "admin" | "staff" };

/** Zil: son ayın uyarıları (Genel bakış'taki "Dikkat edilmesi gerekenler") */
function Notifications({ items, align }: { items: PanelNotification[] | null; align: "left" | "right" }) {
  const router = useRouter();
  if (!items) return <span className="size-9 shrink-0" aria-hidden="true" />;
  const hrefs = new Map(items.map((n) => [n.id, n.href]));
  return (
    <NotificationDropdown
      key={items.length}
      notifications={items}
      menuAlign={align}
      onItemSelect={(n) => router.push(hrefs.get(n.id) ?? "/panel")}
      onViewAll={() => router.push("/panel")}
    />
  );
}

/**
 * AkmanOS "App Shell" + "Sidebar" blokları: zinc-100 kenar çubuğu; logo ve zil, geniş ⌘K araması,
 * beyaz kapta ikon karolu menü, altta profil menüsü. İçerik sağda beyaz zeminde. Mobilde üst çubuk ve
 * yaylı açılan çekmece.
 */
export function Sidebar({ user, index = [] }: { user: User; index?: SearchEntry[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const reduce = useReducedMotion();
  // Çekmece hangi sayfada açıldıysa yalnızca orada açık kalır; sayfa değişince kendiliğinden kapanır
  const [openFor, setOpenFor] = useState<string | null>(null);
  const mobileOpen = openFor === pathname;

  const isAdmin = user.role === "admin";
  // Uyarılar kabuk açılınca bir kez yüklenir; masaüstü ve mobil zil aynı listeyi gösterir
  const [alerts, setAlerts] = useState<PanelNotification[] | null>(null);
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

  const panel = (
    <aside data-component="sidebar" className="flex h-full min-h-0 w-full flex-col gap-5 bg-chart-card-bg p-4 sm:p-5">
      <header className="flex shrink-0 items-center gap-2.5 px-1">
        <LafTile className="size-8 rounded-lg" />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-base font-semibold tracking-tight text-foreground">L&apos;Affogato</span>
          <span className="block truncate text-[11px] text-chart-muted">Yönetim paneli</span>
        </span>
        {isAdmin ? <Notifications items={alerts} align="left" /> : null}
      </header>

      {isAdmin ? (
        <div className="relative z-20 w-full shrink-0">
          <PanelSearch pages={pages} index={index} />
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

  // Esc çekmeceyi kapatır
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenFor(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  return (
    <>
      {/* Mobil üst çubuk */}
      <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur-md lg:hidden">
        <button
          type="button"
          onClick={() => setOpenFor(pathname)}
          className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-background text-foreground outline-none transition-colors hover:bg-chart-bg focus-visible:ring-2 focus-visible:ring-foreground/30"
          aria-label="Menüyü aç"
        >
          <Menu className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <LafTile className="size-8 rounded-lg" />
          <span className="truncate text-sm font-semibold tracking-tight text-foreground">L&apos;Affogato</span>
        </div>
        {isAdmin ? <Notifications items={alerts} align="right" /> : null}
      </header>

      {/* Masaüstü kenar çubuğu */}
      <div className="no-print fixed inset-y-0 left-0 z-30 hidden w-[17.5rem] border-r border-border lg:block">{panel}</div>

      {/* Mobil çekmece */}
      <AnimatePresence>
        {mobileOpen ? (
          <>
            <motion.button
              type="button"
              aria-label="Menüyü kapat"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={reduce ? { duration: 0 } : SPRING_PANEL}
              className="fixed inset-0 z-40 bg-foreground/20 lg:hidden"
              onClick={() => setOpenFor(null)}
            />
            <motion.div
              initial={reduce ? false : { x: "-100%" }}
              animate={{ x: 0 }}
              exit={reduce ? undefined : { x: "-100%" }}
              transition={reduce ? { duration: 0 } : SPRING_PANEL}
              className="fixed inset-y-0 left-0 z-50 flex w-[min(100%,17.5rem)] shadow-[0_12px_40px_rgba(0,0,0,0.18)] lg:hidden"
              role="dialog"
              aria-modal="true"
              aria-label="Menü"
            >
              <div className="relative flex h-full w-full">
                {panel}
                <button
                  type="button"
                  onClick={() => setOpenFor(null)}
                  className="absolute top-4 right-3 flex size-9 cursor-pointer items-center justify-center rounded-lg text-chart-muted outline-none transition-colors hover:bg-chart-bg hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/20"
                  aria-label="Menüyü kapat"
                >
                  <X className="size-4" strokeWidth={1.75} aria-hidden />
                </button>
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
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
