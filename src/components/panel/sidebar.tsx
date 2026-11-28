"use client";

import { ChevronDown, ExternalLink, HelpCircle, Menu, QrCode, Settings, Store, UserRound, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ProfileDropdown, type ProfileDropdownItem } from "@/components/akmanos/profile-dropdown";
import { SPRING_PANEL } from "@/components/akmanos/lib/motion-ease";
import { LafTile } from "@/components/brand";
import { actionFailure, toastUnreachable } from "@/components/ui/action-error";
import { forgetAssistantData } from "@/lib/assistant/history";
import { BRANCH_FEATURE_IDS, featureInScope } from "@/lib/branch-features";
import { ROLES, type Role } from "@/lib/constants";
import { ALERTS_REFRESH_EVENT } from "@/lib/live-poll";
import { homeFor } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { logoutAction } from "@/server/actions/auth";
import { loadPanelNotifications, type PanelNotification } from "@/server/actions/notifications";
import { topBarBranchLabel, type BranchRow, type BranchScope } from "@/lib/branches";
import type { SearchEntry } from "@/server/data/search";

import { BottomNav, BottomNavSkeleton } from "./bottom-nav";
import { BranchPicker } from "./branch-picker";
import { AlertCenter } from "./live/alert-center";
import { forgetDeviceOnSignOut } from "./live/push-client";
import { PanelSearch, SearchTrigger } from "./command-palette";
import { isSamePage, mobileTitleFor, NAV_FOOTER, NAV_GROUPS, navTreeFor, overdueCount, screenFeatureOn, type NavItem } from "./nav";
import { NotificationMenu } from "./notifications";
import { SidebarNav } from "./sidebar-nav";
import { ThemeChoice } from "./theme-choice";

type User = { id: number; name: string; email: string; role: Role };

/** Tarayıcı deposu (kapalıysa null: gizli sekme, engelli site verisi) */
function safeStore(kind: "localStorage" | "sessionStorage"): Storage | null {
  try {
    return window[kind];
  } catch {
    return null;
  }
}

const iconButton =
  "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-background text-foreground outline-none transition-colors hover:bg-chart-bg focus-visible:ring-2 focus-visible:ring-foreground/30";

/** Zil listesi en çok bu kadar sürede bir, sekme yeniden görünür olunca tazelenir (PWA arka plandan dönünce) */
const ALERTS_STALE_MS = 60_000;

/**
 * AkmanOS "App Shell" + "Sidebar" blokları: zinc-100 kenar çubuğu; logo ve zil, geniş ⌘K araması,
 * beyaz kapta ikon karolu menü, altta profil menüsü. İçerik sağda beyaz zeminde.
 * Telefon ve tablette (lg altı): üstte 56px yapışkan çubuk (logo, sayfa başlığı, arama, zil), altta alt menü
 * (bottom-nav.tsx) ve "Tümü"yle açılan yaylı çekmece. Arama paleti tek örnektir; kenar çubuğu, çekmece ve üst çubuk
 * aynı paleti açar.
 */
interface BranchPick {
  scope: BranchScope;
  branches: readonly BranchRow[];
  /** Şubesi belirlenmiş personel: seçici kilitli */
  locked?: boolean;
}

/**
 * `assistant`: alt menüde panel asistanının sekmesi (yalnız yönetici ve asistan açıkken; panel düzeni sunucuda verir,
 * docs/ASISTAN.md)
 */
export function Sidebar({
  user,
  index = [],
  branch,
  assistant = false,
}: {
  user: User;
  index?: SearchEntry[];
  branch?: BranchPick;
  assistant?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const reduce = useReducedMotion();
  // Çekmece hangi sayfada açıldıysa yalnızca orada açık kalır; sayfa değişince kendiliğinden kapanır ve kapalı kalır:
  // adres değişince açıldığı yol da unutulur (denetim UI-04). Unutulmasaydı o sayfaya Geri tuşuyla ya da alt menüden
  // dönünce çekmece kendiliğinden yeniden açılırdı
  const [openFor, setOpenFor] = useState<string | null>(null);
  if (openFor !== null && openFor !== pathname) setOpenFor(null);
  const mobileOpen = openFor === pathname;
  const [searchOpen, setSearchOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const navMenuRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  // Çekmeceyi açan düğme (alt menüdeki "Tümü" ya da personelin üst çubuktaki düğmesi): kapanınca odak ona döner
  const openerRef = useRef<HTMLElement | null>(null);

  const isAdmin = user.role === "admin";
  // Personelin ana sayfası girişteki açılış sayfasıyla aynı (src/lib/roles.ts)
  const home = homeFor(user.role);

  // Uyarılar kabuk açılınca yüklenir, zil her açıldığında arka planda tazelenir; masaüstü ve mobil zil aynı listeyi gösterir.
  // Okuma düşerse (ağ, sunucu, panel güncellendi) liste boş sayılmaz: zil "okunamadı" der, önceki liste kalır (E-49)
  const [alerts, setAlerts] = useState<PanelNotification[] | null>(null);
  const [alertsFailure, setAlertsFailure] = useState<"stale" | "failed" | null>(null);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const fetchedAt = useRef(0);
  // Okumaların sırası: şube değişince gelen yeni okuma, ondan önce başlamış eski okumanın yanıtıyla ezilmesin
  const alertsSeq = useRef(0);
  const refreshAlerts = useCallback(() => {
    const seq = ++alertsSeq.current;
    fetchedAt.current = Date.now();
    setAlertsLoading(true);
    loadPanelNotifications()
      .then((n) => {
        if (seq !== alertsSeq.current) return;
        setAlerts(n);
        setAlertsFailure(null);
      })
      .catch((e: unknown) => seq === alertsSeq.current && setAlertsFailure(actionFailure(e)))
      .finally(() => seq === alertsSeq.current && setAlertsLoading(false));
  }, []);
  useEffect(() => {
    let alive = true;
    const seq = ++alertsSeq.current;
    const current = () => alive && seq === alertsSeq.current;
    fetchedAt.current = Date.now();
    loadPanelNotifications()
      .then((n) => current() && setAlerts(n))
      .catch((e: unknown) => current() && setAlertsFailure(actionFailure(e)))
      .finally(() => current() && setAlertsLoading(false));
    // Telefonda panel çoğunlukla arka plandan geri açılır: görünür olunca (en çok dakikada bir) tazelenir
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - fetchedAt.current > ALERTS_STALE_MS) refreshAlerts();
    };
    document.addEventListener("visibilitychange", onVisible);
    // Onay bildirimi öndeki sekmeye geldi (sistem bildirimi çıkmadı): zil hemen tazelenir (alert-center.tsx)
    window.addEventListener(ALERTS_REFRESH_EVENT, refreshAlerts);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(ALERTS_REFRESH_EVENT, refreshAlerts);
    };
  }, [refreshAlerts]);

  // Şube değişince (seçici ya da ?sube= bağlantısı) zil ve alt menünün Ödemeler rozeti yeni kapsamı göstersin: sunucu
  // ödemeleri, komisyonu, kasayı ve kontrol listelerini seçili şubeye göre süzer (bulgu 89). İlk okuma yukarıda
  const branchScope = branch?.scope;
  const prevScope = useRef(branchScope);
  useEffect(() => {
    if (prevScope.current === branchScope) return;
    prevScope.current = branchScope;
    refreshAlerts();
  }, [branchScope, refreshAlerts]);

  // Ödemeler ekranında (ya da Bugün'ün ödeme kartında) ödenen kayıtlar alt menüdeki rozete yansısın: o ekrandan çıkınca
  // liste tazelenir
  const prevPath = useRef(pathname);
  useEffect(() => {
    const prev = prevPath.current;
    prevPath.current = pathname;
    if (
      prev !== pathname &&
      (prev.startsWith("/panel/hatirlaticilar") || prev.startsWith("/panel/onaylar") || prev.startsWith("/panel/receteler") || prev.startsWith("/panel/bugun"))
    )
      refreshAlerts();
  }, [pathname, refreshAlerts]);
  const overdue = overdueCount(alerts);

  // Seçili kapsamda açık şube özellikleri (karaoke, uygulama siparişi, garson çağır, yemek kartı; docs/SUBE.md › Şube
  // özellikleri): kapalı özelliğin ekranı kenar çubuğunda, çekmecede, alt menüde ve paletde yok
  const features = branch ? BRANCH_FEATURE_IDS.filter((f) => featureInScope(f, branch.scope, branch.branches)) : undefined;
  const tree = navTreeFor(user.role, features);
  const title = mobileTitleFor(pathname);
  // Telefonun üst çubuğunda görülen şube (tek şube açıkken yok)
  const barBranch = branch ? topBarBranchLabel(branch.scope, branch.branches) : null;
  const allowed = (i: NavItem) => i.roles.includes(user.role) && screenFeatureOn(i.href, features);
  const pages = [...NAV_GROUPS.flatMap((g) => g.items.filter(allowed)), ...NAV_FOOTER.filter(allowed)];

  // Yardım iki rolde: her rol kendi sayfasına (personelinkinde yönetici bölümleri yok)
  const accountItems: ProfileDropdownItem[] = [
    { id: "hesap", label: "Hesabım", icon: <UserRound className="size-4" strokeWidth={1.75} />, onSelect: () => router.push("/panel/hesap") },
    ...(isAdmin ? [{ id: "ayarlar", label: "Ayarlar", icon: <Settings className="size-4" strokeWidth={1.75} />, onSelect: () => router.push("/panel/ayarlar") }] : []),
    { id: "yardim", label: "Yardım", icon: <HelpCircle className="size-4" strokeWidth={1.75} />, onSelect: () => router.push(isAdmin ? "/panel/yardim" : user.role === "accountant" ? "/panel/muhasebe#yardim" : "/panel/yardim/personel") },
  ];
  const cafeItems: ProfileDropdownItem[] = [
    { id: "site", label: "laffogato.net", icon: <ExternalLink className="size-4" strokeWidth={1.75} />, onSelect: () => window.open("https://laffogato.net", "_blank", "noopener") },
    ...(isAdmin ? [{ id: "qr", label: "QR menü önizleme", icon: <QrCode className="size-4" strokeWidth={1.75} />, onSelect: () => window.open("/menu?onizleme=1", "_blank", "noopener") }] : []),
  ];

  const openDrawer = () => {
    openerRef.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    setOpenFor(pathname);
  };

  const closeDrawer = useCallback(() => {
    setOpenFor(null);
    const back = openerRef.current?.isConnected ? openerRef.current : (navMenuRef.current ?? menuButtonRef.current);
    back?.focus({ preventScroll: true });
  }, []);

  const openSearch = () => {
    // Çekmeceden açılırsa çekmece kapanır; palet sayfanın üstünde tek başına durur
    setOpenFor(null);
    setSearchOpen(true);
  };

  /** Kenar çubuğunun içeriği: masaüstünde sabit, mobilde çekmecenin içinde */
  const panel = (drawer: boolean) => (
    <aside
      data-component="sidebar"
      className={cn(
        "flex h-full min-h-0 w-full flex-col gap-5 bg-chart-card-bg p-4 sm:p-5",
        drawer && "pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]",
      )}
    >
      <header className="flex shrink-0 items-center gap-2.5 px-1">
        <Link href={home} className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-foreground/20" aria-label="L'Affogato, ana sayfa">
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
        ) : (
          <NotificationMenu items={alerts} failure={alertsFailure} loading={alertsLoading} onOpen={refreshAlerts} align="left" role={user.role} />
        )}
      </header>

      {isAdmin ? (
        <div className="relative z-20 w-full shrink-0">
          <SearchTrigger onClick={openSearch} />
        </div>
      ) : null}

      {branch ? <BranchPicker scope={branch.scope} branches={branch.branches} locked={branch.locked} /> : null}

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
          appearance={<ThemeChoice inMenu className="dark:bg-panel" />}
          onSignOut={() => {
            // Asistanın cihazdaki sohbet geçmişi bu kullanıcıyla gider (docs/ASISTAN.md › Sohbet geçmişi)
            forgetAssistantData(user.id, [safeStore("localStorage"), safeStore("sessionStorage")]);
            void forgetDeviceOnSignOut().finally(() => logoutAction().catch(toastUnreachable));
          }}
          className="w-full max-w-none"
        />
      </footer>
    </aside>
  );

  // Çekmece açıkken: Esc kapatır (içinde açık profil menüsü varsa önce o kapanır), odak kapatma düğmesine gider;
  // Tab odağı çekmecenin içinde döndürür (arkadaki sayfaya kaçmaz)
  useEffect(() => {
    if (!mobileOpen) return;
    closeButtonRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      const drawer = drawerRef.current;
      if (e.key === "Tab" && drawer) {
        const focusables = [...drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
          (el) => el.tabIndex >= 0 && el.getClientRects().length > 0,
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (!drawer.contains(active)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (e.key !== "Escape") return;
      if (drawer?.querySelector('[aria-haspopup="menu"][aria-expanded="true"]')) return;
      closeDrawer();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen, closeDrawer]);

  return (
    <>
      {/* Telefon ve tablet üst çubuğu: logo (ana sayfa), sayfa başlığı, arama ve zil (personelde menü düğmesi). Karaoke
          şeridi varken onun altında yapışır (--alarm-h, globals.css). Zil açıkken sayfanın yüzen düğmelerinin (z-30)
          üstüne çıkar: listenin alt bağlantıları "Yeni" düğmesinin altında kalmaz; çekmece (z-40/50) yine üstte */}
      {/* data-mobile-top: telefonda asistanın tam ekran sayfası açıkken etkisiz (inert) yapılır (panel-assistant.tsx) */}
      <header className="no-print sticky top-(--alarm-h) z-30 flex h-14 items-center gap-1.5 border-b border-border bg-background/90 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(0.625rem,env(safe-area-inset-left))] backdrop-blur-md has-[[data-component=notification-dropdown][data-open]]:z-[35] lg:hidden" data-mobile-top>
        <Link
          href={home}
          className="flex size-11 shrink-0 items-center justify-center rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
          aria-label="L'Affogato, ana sayfa"
        >
          <LafTile className="size-8 rounded-lg" />
        </Link>
        {/* Sayfa başlığı ve altında görülen şube (birden çok şube açıkken; docs/SUBE.md › Telefonda üst çubuk). Seçici
            çekmecede: şubeye dokununca çekmece açılır; şubesi kilitli personelde yalnız ad */}
        <div className="flex min-w-0 flex-1 flex-col justify-center pl-0.5">
          <p className="truncate text-[15px] leading-5 font-semibold tracking-tight text-foreground">{title}</p>
          {barBranch ? (
            branch?.locked ? (
              <p className="flex min-w-0 items-center gap-1 text-xs leading-4 text-ink-mute" data-top-branch>
                <Store className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className="sr-only">Şube: </span>
                <span className="truncate">{barBranch}</span>
              </p>
            ) : (
              <button
                type="button"
                onClick={openDrawer}
                data-top-branch
                className="-my-1 flex min-w-0 cursor-pointer items-center gap-1 self-start rounded-md py-1 text-xs leading-4 text-ink-mute outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-foreground/30"
                aria-label={`Şube: ${barBranch}. Değiştirmek için menüyü açın`}
                aria-haspopup="dialog"
              >
                <Store className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className="truncate">{barBranch}</span>
                <ChevronDown className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
              </button>
            )
          ) : null}
        </div>
        {isAdmin ? (
          <>
            <SearchTrigger compact onClick={openSearch} />
            <NotificationMenu items={alerts} failure={alertsFailure} loading={alertsLoading} onOpen={refreshAlerts} align="right" variant="bar" role={user.role} />
          </>
        ) : (
          <>
            <NotificationMenu items={alerts} failure={alertsFailure} loading={alertsLoading} onOpen={refreshAlerts} align="right" variant="bar" role={user.role} />
            <button
              ref={menuButtonRef}
              type="button"
              onClick={openDrawer}
              className={iconButton}
              aria-label="Menüyü aç"
              aria-expanded={mobileOpen}
              aria-haspopup="dialog"
            >
              <Menu className="size-4" strokeWidth={1.75} aria-hidden />
            </button>
          </>
        )}
      </header>

      {/* Masaüstü kenar çubuğu. Zil açıkken karaoke şeridinin (z-70) üstüne çıkar: açılan pencere kenar çubuğundan
          sağa taşar, "Tümünü okundu say" şeridin altında kalmasın */}
      <div className="no-print fixed inset-y-0 left-0 z-30 hidden w-[17.5rem] border-r border-border has-[[data-component=notification-dropdown][data-open]]:z-[75] lg:block">
        {panel(false)}
      </div>

      {/* Mobil çekmece. Kapanırken (perde solarken, çekmece kayarken) dokunuş almaz: arkadaki sayfaya ve alt menüye
          ilk dokunuş perdeye gidip boşa gitmesin. Kapanırken yeniden açılırsa dokunuşlar geri gelir. */}
      <AnimatePresence>
        {mobileOpen ? (
          <>
            <motion.button
              type="button"
              aria-label="Menüyü kapat"
              tabIndex={-1}
              data-scroll-lock
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1, pointerEvents: "auto" }}
              exit={reduce ? undefined : { opacity: 0, pointerEvents: "none" }}
              transition={reduce ? { duration: 0 } : SPRING_PANEL}
              className="fixed inset-0 z-40 bg-foreground/20 lg:hidden dark:bg-black/60"
              onClick={closeDrawer}
            />
            <motion.div
              ref={drawerRef}
              // Başka bir ekranın bağlantısı: çekmece geçiş bitene dek açık kalır (dokunulan satırda bekleme halkası),
              // adres değişince kendiliğinden kapanır (mobileOpen); kapanma gezinmeyi kesmez. Bulunulan ekranın
              // bağlantısında adres değişmeyeceği için hemen kapanır.
              onClickCapture={(e) => {
                const link = (e.target as Element).closest("a[href]");
                if (link && !link.getAttribute("target") && isSamePage(link.getAttribute("href"), pathname)) setOpenFor(null);
              }}
              initial={reduce ? false : { x: "-100%" }}
              animate={{ x: 0, pointerEvents: "auto" }}
              exit={reduce ? undefined : { x: "-100%", pointerEvents: "none" }}
              transition={reduce ? { duration: 0 } : SPRING_PANEL}
              className="fixed top-(--alarm-h) bottom-0 left-0 z-50 flex w-[min(calc(100%-3rem),20rem)] shadow-[0_12px_40px_rgba(0,0,0,0.18)] lg:hidden"
              role="dialog"
              aria-modal="true"
              aria-label="Menü"
            >
              {panel(true)}
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>

      <BottomNav
        role={user.role}
        pathname={pathname}
        overdue={overdue}
        menuOpen={mobileOpen}
        onMenu={openDrawer}
        menuButtonRef={navMenuRef}
        assistant={isAdmin && assistant}
        features={features}
      />

      <AlertCenter role={user.role} userId={user.id} branchScope={branch?.scope ?? null} />

      {isAdmin ? <PanelSearch pages={pages} index={index} open={searchOpen} onOpenChange={setSearchOpen} hideTrigger /> : null}
    </>
  );
}

export function SidebarSkeleton() {
  return (
    <>
      <header className="sticky top-0 z-30 h-14 border-b border-border bg-background lg:hidden" />
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[17.5rem] border-r border-border bg-chart-card-bg lg:block" />
      <BottomNavSkeleton />
    </>
  );
}
