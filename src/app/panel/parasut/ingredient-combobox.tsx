"use client";

import { Check, ChevronDown, SearchX } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Dialog } from "@/components/ui/dialog";
import { fieldControl, SearchInput } from "@/components/ui/form";
import { searchIngredients } from "@/lib/ingredient-search";
import { cn } from "@/lib/utils";

export interface ComboIngredient {
  id: number;
  name: string;
  unit: string;
  category: string;
}

/** Kategoriye göre gruplanmış hammaddeler: sayfada bir kez kurulur, bütün satırların seçicisi paylaşır */
export type IngredientGroups = readonly (readonly [string, readonly (ComboIngredient & { active: boolean })[]])[];

export function groupIngredients(ingredients: readonly ComboIngredient[]): IngredientGroups {
  const m = new Map<string, (ComboIngredient & { active: boolean })[]>();
  for (const i of ingredients) {
    const cat = i.category || "Diğer";
    m.set(cat, [...(m.get(cat) ?? []), { ...i, active: true }]);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "tr"));
}

/**
 * Aranabilir tek hammadde seçici (sahibin isteği, 25 Kasım 2026; docs/PARASUT.md › 5): Paraşüt sayfasının her bekleyen
 * kartında 108 seçenekli tam liste vardı (sayfa ~90 bin karakter). Kapalıyken yalnız alan gibi görünen düğme çizilir;
 * liste dokununca arama kutulu pencerede açılır ve hammaddeler sayfada bir kez kurulur (`groups`, paylaşılır). Arama ve
 * Enter kuralı reçete önerisindeki seçiciyle aynı (src/lib/ingredient-search.ts: Türkçe harf, büyük/küçük harf farkı
 * gözetmez). Telefonda tam genişlik, satırlar en az 44 px.
 */
export function IngredientCombobox({
  value,
  onChange,
  groups,
  unitLabel,
  label,
  placeholder = "Hammadde seçin…",
  className,
  autoOpen = false,
  id: buttonId,
}: {
  /** Alanın etiketi için düğmenin kimliği */
  id?: string;
  /** Seçili hammaddenin kimliği (boş metin: seçilmedi; formların taslağıyla aynı biçim) */
  value: string;
  onChange: (id: string) => void;
  groups: IngredientGroups;
  unitLabel: (unit: string) => string;
  /** Ekran okuyucu etiketi ("SÜT 1 L için hammadde") */
  label: string;
  placeholder?: string;
  className?: string;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
  const id = value ? Number(value) : null;
  const chosen = useMemo(() => (id ? groups.flatMap(([, list]) => list).find((i) => i.id === id) : undefined), [groups, id]);
  return (
    <>
      <button
        id={buttonId}
        type="button"
        aria-haspopup="dialog"
        aria-label={chosen ? `${label}: ${chosen.name}` : label}
        onClick={() => setOpen(true)}
        className={cn(fieldControl, "flex h-9 w-full cursor-pointer items-center gap-2 text-left pointer-coarse:h-11", className)}
      >
        <span className={cn("min-w-0 flex-1 truncate", chosen ? "font-medium text-ink" : "text-ink-quiet")}>
          {chosen ? `${chosen.name} (${unitLabel(chosen.unit)})` : placeholder}
        </span>
        <ChevronDown size={16} className="shrink-0 text-ink-mute" aria-hidden="true" />
      </button>
      {open ? (
        <ComboDialog
          groups={groups}
          value={id}
          unitLabel={unitLabel}
          title={label}
          onPick={(picked) => {
            onChange(String(picked));
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/** Arama kutusu ve listedeki seçenekler arasında ok tuşlarıyla gezinme */
function moveFocus(list: HTMLElement | null, from: Element | null, dir: 1 | -1): HTMLElement | null {
  const items = [...(list?.querySelectorAll<HTMLElement>("[data-option]") ?? [])];
  if (!items.length) return null;
  const at = from ? items.indexOf(from as HTMLElement) : -1;
  const next = at < 0 ? (dir > 0 ? items[0] : items.at(-1)) : items[at + dir];
  next?.focus();
  return next ?? null;
}

function ComboDialog({
  groups,
  value,
  unitLabel,
  title,
  onPick,
  onClose,
}: {
  groups: IngredientGroups;
  value: number | null;
  unitLabel: (unit: string) => string;
  title: string;
  onPick: (id: number) => void;
  onClose: () => void;
}) {
  const searchId = useId();
  const [q, setQ] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const search = useMemo(() => searchIngredients(groups, q, value), [groups, q, value]);

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      moveFocus(listRef.current, null, 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (search.enterPick) return onPick(search.enterPick.id);
      if (window.matchMedia("(pointer: coarse)").matches) e.currentTarget.blur();
      else moveFocus(listRef.current, null, 1);
    }
  }

  function onListKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const moved = moveFocus(listRef.current, document.activeElement, e.key === "ArrowDown" ? 1 : -1);
    if (!moved && e.key === "ArrowUp") document.getElementById(searchId)?.focus();
  }

  return (
    <Dialog open onClose={onClose} title="Hammadde seç" description={title}>
      <div className="min-h-[min(26rem,60dvh)] pb-2" onKeyDown={onListKey} ref={listRef}>
        <div className="sticky -top-3 z-10 -mx-1 -mt-3 bg-surface px-1 pt-3 pb-2">
          <SearchInput
            id={searchId}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="Hammadde ara"
            aria-label="Hammadde ara"
            autoComplete="off"
            enterKeyHint="search"
            data-autofocus="always"
          />
        </div>
        {search.groups.length ? (
          <div className="space-y-2">
            {search.groups.map(([cat, list]) => (
              <section key={cat} aria-label={cat}>
                <p className="px-3 pt-2 pb-1 text-xs font-semibold text-ink-mute">{cat}</p>
                <ul>
                  {list.map((i) => {
                    const selected = i.id === value;
                    return (
                      <li key={i.id}>
                        <button
                          type="button"
                          data-option
                          aria-current={selected ? "true" : undefined}
                          onClick={() => onPick(i.id)}
                          className={cn(
                            "flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm text-ink hover:bg-panel focus-visible:bg-panel focus-visible:ring-2 focus-visible:ring-ink/25 focus-visible:outline-none pointer-coarse:text-base",
                            selected && "bg-panel font-medium",
                          )}
                        >
                          <span className="min-w-0 flex-1 break-words">{i.name}</span>
                          <span className="shrink-0 text-xs text-ink-mute">{unitLabel(i.unit)}</span>
                          {selected ? <Check size={15} className="shrink-0 text-ink" aria-hidden="true" /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 px-2 py-6 text-center">
            <SearchX size={22} className="text-ink-quiet" aria-hidden="true" />
            <p className="text-sm text-ink-soft">{q.trim() ? `“${q.trim()}” listede bulunamadı. Hammaddeler'den ekleyin.` : "Listede hammadde yok."}</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
