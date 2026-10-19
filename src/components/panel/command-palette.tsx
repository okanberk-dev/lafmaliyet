"use client";

import { Clock, Coffee, CornerDownLeft, LayoutGrid, Package, Search, X, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { CommandPaletteKbd } from "@/components/akmanos/command-palette/command-palette-kbd";
import { EASE_OUT, SPRING_PANEL } from "@/components/akmanos/lib/motion-ease";
import { fold } from "@/components/ui/filters";
import { cn } from "@/lib/utils";
import type { SearchEntry } from "@/server/data/search";

import { useLocalList } from "./local-list";
import type { NavItem } from "./nav";

/**
 * AkmanOS "Command Palette" görünümünde panel araması: ⌘K / Ctrl+K ile her yerden açılır; ekranlar, ürünler ve
 * hammaddeler. Arama Türkçe harf ve aksan duyarsızdır ("sut" → "Süt"), ekranların anahtar sözcüklerine de bakar
 * ("kira" → Giderler). Ok tuşları gezinir, Enter açar, Esc kapatır; rakam tuşları aramaya yazılır.
 * Son açılan beş kayıt bu tarayıcıda hatırlanır.
 */

type Group = "ekran" | "urun" | "hammadde";

const GROUPS: { id: Group; label: string; icon: LucideIcon }[] = [
  { id: "ekran", label: "Ekranlar", icon: LayoutGrid },
  { id: "urun", label: "Ürünler", icon: Coffee },
  { id: "hammadde", label: "Hammaddeler", icon: Package },
];

interface Entry {
  id: string;
  group: Group;
  title: string;
  subtitle: string;
  href: string;
  icon: LucideIcon;
  /** Katlanmış başlık (sıralama için) */
  t: string;
  /** Katlanmış başlık + alt satır + anahtar sözcükler (eşleşme için) */
  hay: string;
}

interface Section {
  id: string;
  label: string;
  items: Entry[];
  /** Sınırın dışında kalan eşleşme sayısı */
  more: number;
  group?: Group;
  /** İlk öğenin düz listedeki sırası (klavye seçimi için) */
  offset: number;
}

const RECENT_KEY = "laf:arama:son";
/** Kategori seçili değilken her gruptan gösterilen en fazla sonuç */
const GROUP_LIMIT = 8;
const CATEGORY_LIMIT = 80;

function buildEntries(pages: NavItem[], index: SearchEntry[]): Entry[] {
  const seen = new Set<string>();
  const out: Entry[] = [];
  const push = (e: Entry) => {
    let id = e.id;
    for (let n = 2; seen.has(id); n++) id = `${e.id}#${n}`;
    seen.add(id);
    out.push({ ...e, id });
  };
  for (const p of pages) {
    push({
      id: `ekran:${p.href}`,
      group: "ekran",
      title: p.label,
      subtitle: p.excel ? `Ekran · Excel: ${p.excel}` : "Ekran",
      href: p.href,
      icon: p.icon,
      t: fold(p.label),
      hay: fold([p.label, p.excel, p.keywords].filter(Boolean).join(" ")),
    });
  }
  for (const e of index) {
    const group: Group = e.kind === "product" ? "urun" : "hammadde";
    push({
      id: `${e.kind}:${e.href}`,
      group,
      title: e.label,
      subtitle: e.hint,
      href: e.href,
      icon: group === "urun" ? Coffee : Package,
      t: fold(e.label),
      hay: fold(`${e.label} ${e.hint}`),
    });
  }
  return out;
}

/** Küçük puan daha iyi: tam eşleşme, başlangıç, sözcük başı, başlıkta geçiyor, yalnızca alt satırda */
function score(e: Entry, q: string, words: string[]): number {
  if (e.t === q) return 0;
  if (e.t.startsWith(q)) return 1;
  if (e.t.split(/[\s·()/,.-]+/).some((w) => w.startsWith(words[0]))) return 2;
  if (words.every((w) => e.t.includes(w))) return 3;
  return 4;
}

const noop = () => () => {};

function useShortcutLabel() {
  return useSyncExternalStore(
    noop,
    () => (/Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘K" : "Ctrl K"),
    () => "⌘K",
  );
}

/** Kenar çubuğundaki geniş arama düğmesi ya da (compact) mobil üst çubuktaki ikon düğmesi */
export function SearchTrigger({ onClick, compact, className }: { onClick: () => void; compact?: boolean; className?: string }) {
  const kbd = useShortcutLabel();
  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label="Ara"
        aria-haspopup="dialog"
        className={cn(
          "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-background text-foreground outline-none transition-colors hover:bg-chart-bg focus-visible:ring-2 focus-visible:ring-foreground/30",
          className,
        )}
      >
        <Search className="size-4" strokeWidth={1.75} aria-hidden />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-keyshortcuts="Meta+K Control+K"
      className={cn(
        "inline-flex h-11 min-h-11 w-full cursor-pointer items-center gap-2 rounded-2xl bg-chart-metric-bg px-3 text-sm outline-none transition-colors hover:bg-chart-bg focus-visible:ring-2 focus-visible:ring-foreground/30",
        className,
      )}
    >
      <Search className="size-4 shrink-0 text-chart-muted" strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-left text-chart-muted">Ekran, ürün, hammadde</span>
      <CommandPaletteKbd className="shrink-0 normal-case pointer-coarse:hidden">{kbd}</CommandPaletteKbd>
    </button>
  );
}

function PaletteDialog({ entries, onClose }: { entries: Entry[]; onClose: () => void }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const uid = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Group | null>(null);
  const [active, setActive] = useState(0);
  const [recentIds, setRecentIds] = useLocalList(RECENT_KEY, 5);

  const { sections, flat, counts, total } = useMemo(() => {
    const q = fold(query).trim().replace(/\s+/g, " ");
    const words = q ? q.split(" ") : [];
    const hits = words.length ? entries.filter((e) => words.every((w) => e.hay.includes(w))) : entries;
    const counts: Record<Group, number> = { ekran: 0, urun: 0, hammadde: 0 };
    for (const e of hits) counts[e.group]++;
    const pool = category ? hits.filter((e) => e.group === category) : hits;

    let sections: Section[];
    if (!words.length && !category) {
      // Boş arama: son açılanlar + ekranlar; ürün ve hammaddeler yazınca gelir
      const byId = new Map(entries.map((e) => [e.id, e]));
      const recent = recentIds.map((id) => byId.get(id)).filter((e): e is Entry => Boolean(e));
      const recentSet = new Set(recent.map((e) => e.id));
      sections = [
        { id: "son", label: "Son açılanlar", items: recent, more: 0, offset: 0 },
        { id: "ekran", label: "Ekranlar", items: pool.filter((e) => e.group === "ekran" && !recentSet.has(e.id)), more: 0, offset: 0 },
      ];
    } else {
      const limit = category ? CATEGORY_LIMIT : GROUP_LIMIT;
      sections = GROUPS.map((g) => {
        const scored = pool
          .filter((e) => e.group === g.id)
          .map((e) => ({ e, s: words.length ? score(e, q, words) : 0 }))
          .sort((a, b) => a.s - b.s);
        return {
          section: { id: g.id, group: g.id, label: g.label, items: scored.slice(0, limit).map((x) => x.e), more: Math.max(0, scored.length - limit), offset: 0 },
          best: scored[0]?.s ?? 99,
        };
      })
        // En iyi eşleşmenin olduğu grup üstte (ör. "latte" yazınca önce ürünler)
        .sort((a, b) => a.best - b.best)
        .map((x) => x.section);
    }
    const shown: Section[] = [];
    let offset = 0;
    for (const s of sections) {
      if (!s.items.length) continue;
      shown.push({ ...s, offset });
      offset += s.items.length;
    }
    sections = shown;
    return { sections, flat: sections.flatMap((s) => s.items), counts, total: pool.length };
  }, [entries, query, category, recentIds]);

  const sel = flat.length ? Math.min(active, flat.length - 1) : -1;

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  // Kapanınca odak paleti açan düğmeye döner
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const go = useCallback(
    (e: Entry) => {
      setRecentIds([e.id, ...recentIds.filter((id) => id !== e.id)]);
      onClose();
      router.push(e.href);
    },
    [onClose, recentIds, router, setRecentIds],
  );

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      if (query) {
        setQuery("");
        setActive(0);
      } else onClose();
      return;
    }
    if (!flat.length) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const step = ev.key === "ArrowDown" ? 1 : -1;
      setActive((sel + step + flat.length) % flat.length);
    } else if (ev.key === "Enter" && !ev.nativeEvent.isComposing) {
      ev.preventDefault();
      go(flat[sel]);
    }
  };

  const pickCategory = (g: Group | null) => {
    setCategory(g);
    setActive(0);
  };

  const transition = reduce ? { duration: 0 } : { duration: 0.2, ease: EASE_OUT };
  const hasQuery = query.trim().length > 0;

  return (
    <>
      <motion.div
        data-scroll-lock
        aria-hidden="true"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={reduce ? undefined : { opacity: 0 }}
        transition={reduce ? { duration: 0 } : SPRING_PANEL}
        className="fixed inset-0 z-[60] bg-foreground/15"
        onClick={onClose}
      />
      <div className="pointer-events-none fixed inset-0 z-[61] flex items-start justify-center p-3 sm:px-4 sm:pt-[12vh]">
        <motion.div
          data-component="command-palette"
          role="dialog"
          aria-modal="true"
          aria-label="Panelde ara"
          onKeyDown={onKeyDown}
          initial={reduce ? false : { opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? undefined : { opacity: 0, y: 6, scale: 0.98 }}
          transition={transition}
          className="pointer-events-auto flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-chart-card-bg shadow-[0_24px_80px_rgba(0,0,0,0.12)] ring-1 ring-border sm:max-h-[min(38rem,76dvh)]"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border pr-2 pl-4">
            <Search className="size-[18px] shrink-0 text-chart-muted" strokeWidth={1.75} aria-hidden />
            <input
              type="search"
              role="combobox"
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls={`${uid}-list`}
              aria-activedescendant={sel >= 0 ? `${uid}-o${sel}` : undefined}
              aria-label="Ekran, ürün ya da hammadde arayın"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="go"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder="Ekran, ürün, hammadde ara"
              className="h-14 min-w-0 flex-1 bg-transparent text-base text-foreground placeholder:text-chart-muted focus:outline-none sm:h-12 sm:text-sm [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setActive(0);
                }}
                aria-label="Aramayı temizle"
                className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-chart-muted transition-colors hover:bg-chart-metric-bg hover:text-foreground pointer-coarse:size-10"
              >
                <X className="size-4" strokeWidth={1.75} aria-hidden />
              </button>
            ) : null}
            <CommandPaletteKbd className="mr-2 shrink-0 normal-case max-sm:hidden pointer-coarse:hidden">Esc</CommandPaletteKbd>
            <button
              type="button"
              onClick={onClose}
              className="hidden h-10 shrink-0 cursor-pointer items-center rounded-lg px-2.5 text-sm font-medium text-foreground hover:bg-chart-metric-bg max-sm:inline-flex pointer-coarse:inline-flex"
            >
              Kapat
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none] max-sm:px-2 [&::-webkit-scrollbar]:hidden" role="group" aria-label="Kategori">
            {[{ id: null, label: "Tümü", icon: Search }, ...GROUPS].map((g) => {
              const on = category === g.id;
              const count = g.id ? counts[g.id] : undefined;
              return (
                <button
                  key={g.id ?? "tumu"}
                  type="button"
                  aria-pressed={on}
                  onClick={() => pickCategory(g.id)}
                  className={cn(
                    "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium whitespace-nowrap transition-colors max-sm:px-2 pointer-coarse:h-10",
                    on ? "bg-chart-metric-bg text-foreground ring-1 ring-border" : "text-chart-muted hover:bg-chart-metric-bg hover:text-foreground",
                  )}
                >
                  {g.id ? <g.icon className="size-3.5 shrink-0 max-sm:hidden" strokeWidth={1.75} aria-hidden /> : null}
                  {g.label}
                  {hasQuery && count !== undefined ? <span className="tabular text-chart-muted">{count}</span> : null}
                </button>
              );
            })}
          </div>

          <div ref={listRef} id={`${uid}-list`} role="listbox" aria-label="Sonuçlar" className="command-palette-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
            {sections.map((s) => (
              <div key={s.id} role="group" aria-labelledby={`${uid}-g-${s.id}`}>
                <p id={`${uid}-g-${s.id}`} className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[0.65rem] font-medium tracking-wide text-chart-muted uppercase">
                  {s.id === "son" ? <Clock className="size-3" strokeWidth={2} aria-hidden /> : null}
                  {s.label}
                </p>
                {s.items.map((e, j) => {
                  const i = s.offset + j;
                  const on = i === sel;
                  return (
                    <div
                      key={e.id}
                      id={`${uid}-o${i}`}
                      role="option"
                      aria-selected={on}
                      data-active={on}
                      onClick={() => go(e)}
                      onMouseMove={() => {
                        if (!on) setActive(i);
                      }}
                      className={cn(
                        "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 transition-colors",
                        on ? "bg-chart-metric-bg shadow-[0_1px_2px_rgb(0_0_0/0.05)]" : "hover:bg-chart-metric-bg/60",
                      )}
                    >
                      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg text-chart-muted", on ? "bg-chart-bg" : "bg-chart-metric-bg ring-1 ring-border")}>
                        <e.icon className="size-4" strokeWidth={1.75} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{e.title}</span>
                        <span className="block truncate text-xs text-chart-muted">{e.subtitle}</span>
                      </span>
                      {on ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-foreground px-2.5 py-1 text-xs font-medium text-background max-sm:hidden pointer-coarse:hidden">
                          Aç <CornerDownLeft className="size-3" strokeWidth={2} aria-hidden />
                        </span>
                      ) : null}
                    </div>
                  );
                })}
                {s.more > 0 && s.group ? (
                  <button
                    type="button"
                    onClick={() => pickCategory(s.group!)}
                    className="mt-0.5 flex h-9 w-full cursor-pointer items-center rounded-xl px-2 text-left text-xs font-medium text-chart-muted hover:bg-chart-metric-bg/60 hover:text-foreground pointer-coarse:h-10"
                  >
                    +{s.more} sonuç daha · yalnız {s.label.toLocaleLowerCase("tr-TR")}
                  </button>
                ) : null}
              </div>
            ))}

            {!flat.length ? (
              <div className="px-4 py-10 text-center" role="status">
                <p className="text-sm font-medium text-foreground">{hasQuery ? `“${query.trim()}” için sonuç yok` : "Bu kategoride kayıt yok"}</p>
                <p className="mt-1 text-[13px] text-chart-muted">
                  {category ? "Başka bir kategoride olabilir." : "Yazımı kontrol edin; Türkçe karakter gerekmez (sut = süt)."}
                </p>
                {category ? (
                  <button type="button" onClick={() => pickCategory(null)} className="mt-3 inline-flex h-9 cursor-pointer items-center rounded-xl bg-chart-metric-bg px-3 text-[13px] font-medium text-foreground ring-1 ring-border hover:bg-chart-bg">
                    Tüm kategorilerde ara
                  </button>
                ) : null}
              </div>
            ) : !hasQuery && !category ? (
              <p className="px-2 pt-3 pb-1 text-xs text-chart-muted">Ürün ya da hammadde bulmak için adını yazın ya da yukarıdan bir kategori seçin.</p>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-2.5 text-xs text-chart-muted max-sm:hidden pointer-coarse:hidden">
            <span className="flex items-center gap-1.5">
              <CommandPaletteKbd>↑</CommandPaletteKbd>
              <CommandPaletteKbd>↓</CommandPaletteKbd> Gezin
            </span>
            <span className="flex items-center gap-1.5">
              <CommandPaletteKbd className="normal-case">Enter</CommandPaletteKbd> Aç
            </span>
            <span className="flex items-center gap-1.5">
              <CommandPaletteKbd className="normal-case">Esc</CommandPaletteKbd> Kapat
            </span>
            {hasQuery || category ? (
              <span className="ml-auto tabular" aria-live="polite">
                {total.toLocaleString("tr-TR")} sonuç
              </span>
            ) : null}
          </div>
        </motion.div>
      </div>
    </>
  );
}

/**
 * Panel araması. `open` verilmezse kendi düğmesi ve durumuyla çalışır; kabuk tek bir örneği açık/kapalı durumu
 * kendisi tutarak kullanır (kenar çubuğu, çekmece ve mobil üst çubuk aynı paleti açar).
 */
export function PanelSearch({
  pages,
  index,
  open: openProp,
  onOpenChange,
  hideTrigger,
}: {
  pages: NavItem[];
  index: SearchEntry[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Düğmeyi gizle (palet başka bir düğmeyle açılıyorsa) */
  hideTrigger?: boolean;
}) {
  const [own, setOwn] = useState(false);
  const open = openProp ?? own;
  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setOwn(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );
  const entries = useMemo(() => buildEntries(pages, index), [pages, index]);
  // Her açılış yeni bir oturum: kapanış animasyonu bitmeden yeniden açılsa da arama boş başlar
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((n) => n + 1);
  }

  // ⌘K / Ctrl+K her yerden açar ya da kapatır (açık bir pencere varken açılmaz)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "k") return;
      if (!open && document.querySelector("dialog[open]")) return;
      e.preventDefault();
      setOpen(!open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const close = useCallback(() => setOpen(false), [setOpen]);

  return (
    <>
      {hideTrigger ? null : <SearchTrigger onClick={() => setOpen(true)} />}
      <AnimatePresence>{open ? <PaletteDialog key={session} entries={entries} onClose={close} /> : null}</AnimatePresence>
    </>
  );
}
