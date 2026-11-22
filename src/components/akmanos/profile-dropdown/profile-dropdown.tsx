"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from "motion/react";
import {
  Building2,
  ChevronsUpDown,
  CreditCard,
  LogOut,
  Settings,
  User,
  UserPlus,
  Users,
} from "lucide-react";
import {
  AvatarFallback,
  AvatarImage,
  LiquidMetalAvatar,
} from "@/components/akmanos/liquid-metal-avatar";
import { SPRING_PANEL, SPRING_PRESS, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { cn } from "@/components/akmanos/lib/cn";
import {
  profileMenuInlineAlignClasses,
  useProfileMenuInlineAlign,
  type ProfileMenuInlineAlign,
} from "./profile-menu-align";

/**
 * Vurgu yalnız fare ile ve klavye odağıyla (:focus-visible) değişir: dokunuşta ve tıklamanın verdiği odakta DOM
 * değişmez. Yoksa tıklanan satırın vurgusu mousedown ile odak arasında silinip yeniden çizilir, tarayıcı ilk
 * tıklamayı düşürür; iOS da ilk dokunuşu "üstüne gelme" sayar (kenar menüsüyle aynı düzeltme).
 */
const mouseOnly = (fn: () => void) => (e: PointerEvent) => {
  if (e.pointerType === "mouse") fn();
};
const focusVisibleOnly = (fn: () => void) => (e: FocusEvent) => {
  if (e.currentTarget.matches(":focus-visible")) fn();
};

export type ProfileDropdownItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
};

export type ProfileDropdownProps = {
  name?: string;
  email?: string;
  handle?: string;
  avatarSrc?: string;
  avatarAlt?: string;
  accountItems?: ProfileDropdownItem[];
  workspaceItems?: ProfileDropdownItem[];
  /** Panel: "Görünüm" bölümü (Sistem / Açık / Koyu seçici), Kafe ile Çıkış arasında */
  appearance?: ReactNode;
  onSignOut?: () => void;
  /** Gallery: start open, ignore outside click */
  preview?: boolean;
  /** Menu opens above trigger when used in bottom-aligned shells (e.g. sidebar). */
  menuPlacement?: "bottom" | "top";
  /**
   * Horizontal menu alignment relative to the trigger.
   * `auto`: right in LTR, left in RTL, centered on mobile.
   */
  menuAlign?: "auto" | ProfileMenuInlineAlign;
  className?: string;
};

const DEFAULT_ACCOUNT: ProfileDropdownItem[] = [
  {
    id: "profile",
    label: "Profile",
    icon: <User className="size-4" strokeWidth={1.75} />,
  },
  {
    id: "settings",
    label: "Settings",
    icon: <Settings className="size-4" strokeWidth={1.75} />,
  },
  {
    id: "billing",
    label: "Billing",
    icon: <CreditCard className="size-4" strokeWidth={1.75} />,
  },
];

const DEFAULT_WORKSPACE: ProfileDropdownItem[] = [
  {
    id: "switch",
    label: "Switch workspace",
    icon: <Building2 className="size-4" strokeWidth={1.75} />,
  },
  {
    id: "invite",
    label: "Invite members",
    icon: <UserPlus className="size-4" strokeWidth={1.75} />,
  },
  {
    id: "workspace-settings",
    label: "Workspace settings",
    icon: <Users className="size-4" strokeWidth={1.75} />,
  },
];

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

export function ProfileDropdown({
  name = "Gökhan",
  email = "hello@gkhn.dev",
  handle = "@gokhanf4",
  avatarSrc,
  avatarAlt,
  accountItems = DEFAULT_ACCOUNT,
  workspaceItems = DEFAULT_WORKSPACE,
  appearance,
  onSignOut,
  preview = false,
  menuPlacement = "bottom",
  menuAlign = "auto",
  className,
}: ProfileDropdownProps) {
  const reduceMotion = useReducedMotion();
  const resolvedMenuAlign = useProfileMenuInlineAlign(menuAlign);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(preview);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const initials = initialsFromName(name);

  useEffect(() => {
    if (!open) {
      setHoveredKey(null);
    }
  }, [open]);

  useEffect(() => {
    if (preview || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const el = rootRef.current;
      if (!el) return;
      const target = e.target as Node | null;
      if (target && !el.contains(target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
    };
  }, [open, preview]);

  const runItem = (item: ProfileDropdownItem) => {
    item.onSelect?.();
    if (!preview) setOpen(false);
  };

  return (
    <div
      ref={rootRef}
      data-component="profile-dropdown"
      data-gfa-profile-dropdown
      className={cn("relative inline-flex font-sans", className)}
    >
      <motion.button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        whileTap={reduceMotion || preview ? undefined : { scale: 0.98 }}
        transition={SPRING_PRESS}
        onClick={() => {
          if (preview) return;
          setOpen((v) => !v);
        }}
        className={cn(
          "inline-flex max-w-[16rem] items-center gap-2.5 rounded-2xl py-1.5 pr-2.5 pl-1 outline-none",
          "bg-chart-metric-bg transition-colors",
          "hover:bg-chart-bg",
          "focus-visible:ring-2 focus-visible:ring-foreground/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          menuPlacement === "top" && "w-full max-w-none",
        )}
      >
        <LiquidMetalAvatar
          size="sm"
          className="size-9 shrink-0 [&_[data-slot=avatar]]:inset-[2.5px]"
          speed={0.28}
          softness={0.62}
        >
          {avatarSrc ? <AvatarImage src={avatarSrc} alt={avatarAlt ?? name} /> : null}
          <AvatarFallback>{initials}</AvatarFallback>
        </LiquidMetalAvatar>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[0.8125rem] font-semibold tracking-tight text-foreground">
            {name}
          </span>
          <span className="block truncate text-[0.68rem] text-chart-muted">
            {handle}
          </span>
        </span>

        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={reduceMotion ? { duration: 0 } : SPRING_SWAP}
          className="flex size-7 shrink-0 items-center justify-center text-chart-muted"
        >
          <ChevronsUpDown className="size-4" strokeWidth={1.75} aria-hidden />
        </motion.span>
      </motion.button>

      <AnimatePresence>
        {open ? (
          <motion.div
            id={menuId}
            role="menu"
            aria-label="Profil menüsü"
            initial={
              reduceMotion
                ? false
                : {
                    opacity: 0,
                    scale: 0.96,
                    y: menuPlacement === "top" ? 8 : -8,
                  }
            }
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={
              reduceMotion
                ? undefined
                : {
                    opacity: 0,
                    scale: 0.96,
                    y: menuPlacement === "top" ? 8 : -8,
                  }
            }
            transition={reduceMotion ? { duration: 0 } : SPRING_PANEL}
            className={cn(
              "absolute z-[100] w-[17.5rem] overflow-hidden",
              "rounded-2xl bg-chart-metric-bg shadow-[0_12px_40px_rgba(0,0,0,0.14)] backdrop-blur-xl",
              "dark:shadow-[0_12px_40px_rgba(0,0,0,0.45)]",
              profileMenuInlineAlignClasses(resolvedMenuAlign, menuPlacement),
              preview && "pointer-events-none",
            )}
          >
            <LayoutGroup id="profile-dropdown-menu">
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={
                  reduceMotion ? { duration: 0 } : { ...SPRING_SWAP, delay: 0.04 }
                }
                className="flex items-center gap-3 px-3.5 py-3.5"
              >
                <LiquidMetalAvatar
                  size="md"
                  className="size-11 shrink-0 [&_[data-slot=avatar]]:inset-[3.5px]"
                  speed={0.28}
                  softness={0.62}
                >
                  {avatarSrc ? <AvatarImage src={avatarSrc} alt="" /> : null}
                  <AvatarFallback>{initials}</AvatarFallback>
                </LiquidMetalAvatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.9rem] font-semibold tracking-tight text-foreground">
                    {name}
                  </p>
                  <p className="truncate text-[0.72rem] text-chart-muted">
                    {handle}
                  </p>
                  <p className="truncate text-[0.68rem] text-chart-muted/80">
                    {email}
                  </p>
                </div>
              </motion.div>

              <div className="mx-3 h-px bg-border" />

              <Section label="Hesap">
                {accountItems.map((item, index) => (
                  <MenuRow
                    key={item.id}
                    item={item}
                    index={index}
                    rowKey={`account-${item.id}`}
                    hoveredKey={hoveredKey}
                    reduceMotion={reduceMotion}
                    onHover={setHoveredKey}
                    onSelect={() => runItem(item)}
                  />
                ))}
              </Section>

              <div className="mx-3 h-px bg-border" />

              <Section label="Kafe">
                {workspaceItems.map((item, index) => (
                  <MenuRow
                    key={item.id}
                    item={item}
                    index={index}
                    rowKey={`workspace-${item.id}`}
                    hoveredKey={hoveredKey}
                    reduceMotion={reduceMotion}
                    onHover={setHoveredKey}
                    onSelect={() => runItem(item)}
                  />
                ))}
              </Section>

              <div className="mx-3 h-px bg-border" />

              {appearance ? (
                <>
                  <Section label="Görünüm">
                    <div className="px-1 pb-0.5">{appearance}</div>
                  </Section>
                  <div className="mx-3 h-px bg-border" />
                </>
              ) : null}

              <div className="p-1.5 pb-2">
                <motion.button
                  type="button"
                  role="menuitem"
                  initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { ...SPRING_SWAP, delay: 0.12 }
                  }
                  onPointerEnter={mouseOnly(() => setHoveredKey("sign-out"))}
                  onPointerLeave={mouseOnly(() => setHoveredKey(null))}
                  onFocus={focusVisibleOnly(() => setHoveredKey("sign-out"))}
                  onBlur={() => setHoveredKey(null)}
                  onClick={() => {
                    onSignOut?.();
                    if (!preview) setOpen(false);
                  }}
                  className={cn(
                    "relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[0.8125rem] font-medium",
                    "text-red-600 outline-none dark:text-red-400",
                    "focus-visible:ring-2 focus-visible:ring-red-500/30",
                  )}
                >
                  {hoveredKey === "sign-out" ? (
                    <motion.span
                      layoutId="profile-dropdown-highlight"
                      transition={
                        reduceMotion ? { duration: 0 } : SPRING_SWAP
                      }
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 rounded-xl bg-red-50 dark:bg-red-500/15"
                    />
                  ) : null}
                  <LogOut
                    className="relative z-10 size-4 shrink-0 text-red-600 dark:text-red-400"
                    strokeWidth={1.75}
                  />
                  <span className="relative z-10">Çıkış yap</span>
                </motion.button>
              </div>
            </LayoutGroup>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="px-1.5 py-1.5">
      <p className="px-2.5 pt-0.5 pb-1 text-[0.65rem] font-medium tracking-wide text-chart-muted uppercase">
        {label}
      </p>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function MenuRow({
  item,
  index,
  rowKey,
  hoveredKey,
  reduceMotion,
  onHover,
  onSelect,
}: {
  item: ProfileDropdownItem;
  index: number;
  rowKey: string;
  hoveredKey: string | null;
  reduceMotion: boolean | null;
  onHover: (key: string | null) => void;
  onSelect: () => void;
}) {
  const isHighlighted = hoveredKey === rowKey;

  return (
    <motion.button
      type="button"
      role="menuitem"
      initial={
        reduceMotion ? false : { opacity: 0, x: -10, filter: "blur(4px)" }
      }
      animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { ...SPRING_SWAP, delay: 0.04 + index * 0.045 }
      }
      onPointerEnter={mouseOnly(() => onHover(rowKey))}
      onPointerLeave={mouseOnly(() => onHover(null))}
      onFocus={focusVisibleOnly(() => onHover(rowKey))}
      onBlur={() => onHover(null)}
      onClick={onSelect}
      className={cn(
        "relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[0.8125rem] font-medium",
        "text-foreground outline-none focus-visible:ring-2 focus-visible:ring-foreground/20",
      )}
    >
      {isHighlighted ? (
        <motion.span
          layoutId="profile-dropdown-highlight"
          transition={reduceMotion ? { duration: 0 } : SPRING_SWAP}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-xl bg-chart-bg"
        />
      ) : null}
      <span className="relative z-10 flex size-4 shrink-0 items-center justify-center text-chart-muted">
        {item.icon}
      </span>
      <span className="relative z-10">{item.label}</span>
    </motion.button>
  );
}
