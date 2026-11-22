"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useRef, useSyncExternalStore, type KeyboardEvent } from "react";

import { readThemePref, saveThemePref, THEME_EVENT, THEME_KEY, THEME_OPTIONS, type ThemePref } from "@/lib/theme";
import { cn } from "@/lib/utils";

const ICON = { sistem: Monitor, acik: Sun, koyu: Moon } as const;

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_KEY || e.key === null) onChange();
  };
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Sunucuda ve hidrasyonda seçim bilinmez (localStorage): o an hiçbir seçenek işaretli değil, hemen ardından gelir */
const serverPref = () => null;

/** Geçerli görünüm seçimi; seçici başka yerde değişince (aynı sekme ya da öteki sekme) güncellenir */
export function useThemePref(): ThemePref | null {
  return useSyncExternalStore(subscribe, readThemePref, serverPref);
}

/**
 * Görünüm seçici: Sistem · Açık · Koyu. Ayarlar › Görünüm ve profil menüsünde. Seçim hemen uygulanır, bu tarayıcıda
 * saklanır. Her seçenek 44 px yüksek (dokunma hedefi). Profil menüsünün içinde `inMenu`: seçenekler menuitemradio,
 * Tab ile gezilir; dışarıda radiogroup, ok tuşlarıyla.
 */
export function ThemeChoice({ inMenu, className, label = "Görünüm" }: { inMenu?: boolean; className?: string; label?: string }) {
  const pref = useThemePref();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = THEME_OPTIONS.findIndex((o) => o.value === pref);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (inMenu) return;
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (Math.max(0, current) + step + THEME_OPTIONS.length) % THEME_OPTIONS.length;
    saveThemePref(THEME_OPTIONS[next]!.value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role={inMenu ? "group" : "radiogroup"}
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("grid grid-cols-3 gap-1 rounded-xl bg-panel p-1 dark:bg-surface", className)}
    >
      {THEME_OPTIONS.map((o, i) => {
        const Icon = ICON[o.value];
        const on = pref === o.value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role={inMenu ? "menuitemradio" : "radio"}
            aria-checked={on}
            tabIndex={inMenu || on || (current < 0 && i === 0) ? 0 : -1}
            onClick={() => saveThemePref(o.value)}
            className={cn(
              "flex min-h-11 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-[10px] px-2 text-[13px] font-medium transition-colors",
              on
                ? "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_rgb(0_0_0/0.04)] dark:bg-ink dark:text-on-solid dark:shadow-none"
                : "text-ink-mute hover:text-ink",
            )}
          >
            <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Seçimin kısa adı (Ayarlar'da kapalı satırın özeti) */
export function themePrefLabel(pref: ThemePref | null): string {
  if (pref === null) return "";
  return pref === "sistem" ? "Sistem (cihazın ayarı)" : pref === "acik" ? "Açık" : "Koyu";
}
