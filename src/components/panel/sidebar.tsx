"use client";

import { LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Wordmark } from "@/components/brand";
import { ROLES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { logoutAction } from "@/server/actions/auth";

import { NAV_GROUPS } from "./nav";

export function Sidebar({ user }: { user: { name: string; email: string; role: "admin" | "staff" } }) {
  const pathname = usePathname();
  // Çekmece hangi sayfada açıldıysa yalnızca orada açık kalır; sayfa değişince kendiliğinden kapanır
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === pathname;
  const setOpen = (v: boolean) => setOpenFor(v ? pathname : null);

  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(user.role)) })).filter(
    (g) => g.items.length,
  );
  const isActive = (href: string) => (href === "/panel" ? pathname === "/panel" : pathname.startsWith(href));

  const nav = (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4 scroll-thin" aria-label="Panel menüsü">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-coffee-400 uppercase">{g.title}</p>
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    title={item.excel ? `Excel: ${item.excel}` : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active ? "bg-coffee-800 text-white shadow-sm" : "text-coffee-200 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <Icon size={17} className={active ? "text-coffee-200" : "text-coffee-400"} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const footer = (
    <div className="border-t border-white/10 p-3">
      <div className="flex items-center gap-3 rounded-lg px-2 py-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-coffee-700 text-sm font-semibold text-coffee-50">
          {user.name.slice(0, 1).toLocaleUpperCase("tr-TR")}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{user.name}</p>
          <p className="truncate text-xs text-coffee-400">{ROLES[user.role]}</p>
        </div>
        <form action={logoutAction}>
          <button type="submit" className="rounded-md p-2 text-coffee-300 hover:bg-white/10 hover:text-white" title="Çıkış yap" aria-label="Çıkış yap">
            <LogOut size={16} />
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobil üst çubuk */}
      <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between border-b border-coffee-900 bg-coffee-950 px-4 text-white lg:hidden">
        <Link href={user.role === "admin" ? "/panel" : "/panel/sayim"}>
          <Wordmark />
        </Link>
        <button type="button" onClick={() => setOpen(true)} className="rounded-md p-2 hover:bg-white/10" aria-label="Menüyü aç">
          <Menu size={20} />
        </button>
      </header>

      {/* Masaüstü kenar çubuğu */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-coffee-950 lg:flex">
        <div className="flex h-16 items-center px-5 text-white">
          <Link href={user.role === "admin" ? "/panel" : "/panel/sayim"}>
            <Wordmark sub="Yönetim paneli" />
          </Link>
        </div>
        {nav}
        {footer}
      </aside>

      {/* Mobil çekmece */}
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <button type="button" className="absolute inset-0 bg-coffee-950/50" onClick={() => setOpen(false)} aria-label="Menüyü kapat" />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-coffee-950 shadow-2xl">
            <div className="flex h-14 items-center justify-between px-4 text-white">
              <Wordmark />
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-2 hover:bg-white/10" aria-label="Menüyü kapat">
                <X size={20} />
              </button>
            </div>
            {nav}
            {footer}
          </aside>
        </div>
      ) : null}
    </>
  );
}

export function SidebarSkeleton() {
  return (
    <>
      <header className="sticky top-0 z-30 h-14 border-b border-coffee-900 bg-coffee-950 lg:hidden" />
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-coffee-950 lg:block" />
    </>
  );
}
