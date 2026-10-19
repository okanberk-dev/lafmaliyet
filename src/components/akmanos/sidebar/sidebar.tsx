"use client";

import { useState } from "react";
import { BrandLogoMark } from "@/components/akmanos/branding/brand-logo-mark";
import { ProductNameMark } from "@/components/akmanos/branding/product-name-mark";
import { ProfileDropdown } from "@/components/akmanos/profile-dropdown";
import { CommandPalette } from "@/components/akmanos/command-palette";
import { SwitchWorkspace } from "@/components/akmanos/switch-workspace";
import { PRODUCT_NAME } from "@/components/akmanos/lib/brand";
import { cn } from "@/components/akmanos/lib/cn";
import {
  DEFAULT_SIDEBAR_LOGO_SRC,
  DEFAULT_SIDEBAR_PAGES,
  DEFAULT_SIDEBAR_TITLE,
  type SidebarNavItem,
} from "./constants";
import { SidebarNav } from "./sidebar-nav";

export type SidebarProps = {
  siteTitle?: string;
  logoSrc?: string;
  logoAlt?: string;
  pages?: SidebarNavItem[];
  activePageId?: string;
  activeChildId?: string;
  onPageSelect?: (pageId: string, childId?: string) => void;
  /** Flush layout for App Shell — no card radius, fills parent height. */
  embedded?: boolean;
  className?: string;
};

export function Sidebar({
  siteTitle = DEFAULT_SIDEBAR_TITLE,
  logoSrc = DEFAULT_SIDEBAR_LOGO_SRC,
  logoAlt = "",
  pages = DEFAULT_SIDEBAR_PAGES,
  activePageId: activePageIdProp,
  activeChildId: activeChildIdProp,
  onPageSelect,
  embedded = false,
  className,
}: SidebarProps) {
  const [activePageId, setActivePageId] = useState(
    activePageIdProp ?? pages[0]?.id ?? "",
  );
  const [activeChildId, setActiveChildId] = useState(
    activeChildIdProp ?? pages[0]?.children?.[0]?.id,
  );

  function handlePageSelect(pageId: string, childId?: string) {
    setActivePageId(pageId);
    if (childId) {
      setActiveChildId(childId);
    } else {
      setActiveChildId(undefined);
    }
    onPageSelect?.(pageId, childId);
  }

  return (
    <aside
      data-component="sidebar"
      className={cn(
        "flex w-full flex-col gap-5 bg-chart-card-bg p-4 sm:p-5",
        embedded
          ? "h-full min-h-0 max-w-none rounded-none"
          : "h-full min-h-[36rem] max-w-[17.5rem] rounded-3xl",
        className,
      )}
    >
      <header className="flex shrink-0 items-center gap-2.5 px-1">
        <BrandLogoMark src={logoSrc} alt={logoAlt} />
        <span className="truncate text-base font-semibold tracking-tight text-foreground">
          {siteTitle === PRODUCT_NAME || siteTitle === DEFAULT_SIDEBAR_TITLE ? (
            <ProductNameMark />
          ) : (
            siteTitle
          )}
        </span>
      </header>

      <div className="relative z-50 w-full shrink-0">
        <SwitchWorkspace fullWidth />
      </div>

      <div className="relative z-20 w-full shrink-0">
        <CommandPalette fullWidth />
      </div>

      <SidebarNav
        items={pages}
        activePageId={activePageIdProp ?? activePageId}
        activeChildId={activeChildIdProp ?? activeChildId}
        onPageSelect={handlePageSelect}
        className="relative z-0 min-h-0 flex-1"
      />

      <footer className="relative z-20 shrink-0 border-t border-border pt-4">
        <ProfileDropdown menuPlacement="top" className="w-full max-w-none" />
      </footer>
    </aside>
  );
}
