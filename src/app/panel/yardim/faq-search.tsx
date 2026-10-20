"use client";

import { Search, SearchX } from "lucide-react";
import { useState, type ReactNode } from "react";

import { BouncyAccordionList } from "@/components/akmanos/bouncy-accordion";
import { Button } from "@/components/ui/button";
import { clearQuery, FilterBar, matches, SearchField, useQueryText } from "@/components/ui/filters";
import { EmptyState } from "@/components/ui/misc";

export type FaqEntry = {
  id: string;
  title: string;
  /** Arama için düz metin: soru + cevap + menü yolları */
  text: string;
  icon: ReactNode;
  description: ReactNode;
};
export type FaqGroup = { title: string; items: FaqEntry[] };

const CLASS_NAMES = {
  trigger: "min-h-[52px] gap-3 px-4 py-2.5",
  // Uzun sorular telefonda kısaltılmasın, alt satıra geçsin
  title: "text-sm font-medium text-pretty text-ink whitespace-normal!",
  content: "[&>div]:px-4",
  description: "text-sm leading-6 text-ink-soft sm:pl-10",
};

const total = (groups: FaqGroup[]) => groups.reduce((n, g) => n + g.items.length, 0);

/** Gruplu sorular; `open` verilirse hangi sorunun açık olduğu dışarıdan yönetilir */
function FaqList({
  groups,
  open,
  onOpen,
}: {
  groups: FaqGroup[];
  open?: Record<string, string | null>;
  onOpen?: (group: string, id: string | null) => void;
}) {
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g.title} aria-label={g.title}>
          <h3 className="mb-2 px-1 text-[13px] font-medium text-ink-mute">{g.title}</h3>
          <BouncyAccordionList
            items={g.items.map((f) => ({ id: f.id, title: f.title, icon: f.icon, description: f.description }))}
            {...(open ? { value: open[g.title] ?? null, onValueChange: (v: string | null) => onOpen?.(g.title, v) } : {})}
            classNames={CLASS_NAMES}
          />
        </section>
      ))}
    </div>
  );
}

/**
 * "Nasıl yapılır?" listesinde arama: soru ve cevabın içinde Türkçe harf duyarsız arar ("kdv", "zam", "sifre").
 * Arama adreste durur (?ara=zam). Aranınca ilk eşleşen cevap kendiliğinden açılır.
 */
export function HelpFaq({ groups }: { groups: FaqGroup[] }) {
  const [q, setQ] = useQueryText("ara");
  const [open, setOpen] = useState<Record<string, string | null>>({});
  const [lastQ, setLastQ] = useState<string | null>(null);

  const shown = groups.map((g) => ({ ...g, items: g.items.filter((f) => matches(`${g.title} ${f.title} ${f.text}`, q)) })).filter((g) => g.items.length > 0);
  const count = total(shown);

  // Arama değişince ilk sonucun cevabı açılır, arama silinince hepsi kapanır
  if (q !== lastQ) {
    setLastQ(q);
    const first = shown[0];
    setOpen(q.trim() && first ? { [first.title]: first.items[0].id } : {});
  }

  const clear = () => {
    setQ("");
    clearQuery(["ara"]);
  };

  return (
    <div className="space-y-4">
      <FilterBar active={Boolean(q.trim())} onClear={clear} shown={count} total={total(groups)} unit="soru">
        <SearchField value={q} onChange={setQ} placeholder="Soru ya da konu ara" label="Yardımda ara" className="w-full sm:w-80" />
      </FilterBar>
      {count ? (
        <FaqList groups={shown} open={open} onOpen={(g, id) => setOpen((o) => ({ ...o, [g]: id }))} />
      ) : (
        <EmptyState
          icon={<SearchX />}
          title="Bu konuda soru bulunamadı"
          description="Başka bir sözcük deneyin. Her ay yapılacaklar ve formüller bu sayfanın diğer kartlarında."
          action={
            <Button variant="secondary" onClick={clear}>
              Süzgeci temizle
            </Button>
          }
        />
      )}
    </div>
  );
}

/** Adres okunana kadar (ilk boyama) aynı liste, aramasız; yer kaymasın diye arama kutusunun yeri tutulur */
export function HelpFaqFallback({ groups }: { groups: FaqGroup[] }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-80">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-quiet" aria-hidden="true" />
          <div className="h-9 w-full rounded-xl bg-surface ring-1 ring-line-strong ring-inset pointer-coarse:h-11" aria-hidden="true" />
        </div>
        <p className="ml-auto text-[13px] whitespace-nowrap text-ink-mute tabular">{total(groups)} soru</p>
      </div>
      <FaqList groups={groups} />
    </div>
  );
}
