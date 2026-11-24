"use client";

import { Search, SearchX } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { FaqChat, openFor } from "@/components/ui/faq-chat";
import { clearQuery, FilterBar, matches, SearchField, useQueryText } from "@/components/ui/filters";
import { EmptyState } from "@/components/ui/misc";

export type FaqEntry = {
  id: string;
  title: string;
  /** Arama için düz metin: soru + cevap + menü yolları */
  text: string;
  /** Sorunun başındaki küçük konu ikonu */
  icon: ReactNode;
  /** Cevap balonunun içi: cevap ve altındaki bağlantılar */
  description: ReactNode;
};
export type FaqGroup = { title: string; items: FaqEntry[] };

const total = (groups: FaqGroup[]) => groups.reduce((n, g) => n + g.items.length, 0);

/**
 * Gruplu sorular, her grup bir sohbet (FaqChat); soru kimliği sayfada çapa (/panel/yardim#claude). `open` verilirse
 * hangi sorunun açık olduğu dışarıdan yönetilir. `round` değişince liste yeniden kurulur: aramada süzülen balonlar
 * eski yerlerinden uçmaz, ilk sonucun cevabı yerinde açık gelir.
 */
function FaqList({
  groups,
  open,
  onOpen,
  round,
}: {
  groups: FaqGroup[];
  open?: Record<string, string | null>;
  onOpen?: (group: string, id: string | null) => void;
  round?: string;
}) {
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g.title} aria-label={g.title}>
          <h3 className="mb-2 px-1 text-[13px] font-medium text-ink-mute">{g.title}</h3>
          <FaqChat
            key={round}
            anchors
            items={g.items.map((f) => ({ id: f.id, question: f.title, answer: f.description, icon: f.icon }))}
            {...(open ? { value: open[g.title] ?? null, onValueChange: (v: string | null) => onOpen?.(g.title, v) } : {})}
          />
        </section>
      ))}
    </div>
  );
}

/**
 * "Nasıl yapılır?" listesinde arama: soru ve cevabın içinde Türkçe harf duyarsız arar ("kdv", "zam", "sifre").
 * Arama adreste durur (?ara=zam). Aranınca ilk eşleşen cevap kendiliğinden açılır. Çapalı bağlantıda
 * (/panel/yardim#claude) o soru açılır ve ekrana gelir.
 */
export function HelpFaq({ groups }: { groups: FaqGroup[] }) {
  const [q, setQ] = useQueryText("ara");
  const [open, setOpen] = useState<Record<string, string | null>>({});
  const [lastQ, setLastQ] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const shown = groups.map((g) => ({ ...g, items: g.items.filter((f) => matches(`${g.title} ${f.title} ${f.text}`, q)) })).filter((g) => g.items.length > 0);
  const count = total(shown);

  // Arama değişince ilk sonucun cevabı açılır, arama silinince hepsi kapanır
  if (q !== lastQ) {
    setLastQ(q);
    const first = shown[0];
    setOpen(q.trim() && first ? { [first.title]: first.items[0].id } : {});
  }

  // Sayfa akıp geldiği için tarayıcının çapa kaydırması soruya ulaşamayabilir: soru açılınca bir kez kaydırılır
  useEffect(() => {
    let frame = 0;
    const fromHash = () => {
      const hit = openFor(groups, window.location.hash);
      if (!hit) return;
      setOpen(hit);
      const [id] = Object.values(hit);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.scrollIntoView({ block: "start" }));
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", fromHash);
    };
  }, [groups]);

  const clear = () => {
    setQ("");
    clearQuery(["ara"]);
  };

  return (
    <div ref={root} className="space-y-4">
      <FilterBar active={Boolean(q.trim())} onClear={clear} shown={count} total={total(groups)} unit="soru">
        <SearchField value={q} onChange={setQ} placeholder="Soru ya da konu ara" label="Yardımda ara" className="w-full sm:w-80" />
      </FilterBar>
      {count ? (
        <FaqList groups={shown} open={open} onOpen={(g, id) => setOpen((o) => ({ ...o, [g]: id }))} round={q} />
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
