"use client";

import { Coffee, LayoutGrid, Package } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { CommandPalette } from "@/components/akmanos/command-palette";
import type { CommandPaletteCategory, CommandPaletteLabels, CommandPaletteResult } from "@/components/akmanos/command-palette";
import type { SearchEntry } from "@/server/data/search";

import type { NavItem } from "./nav";

const LABELS: Partial<CommandPaletteLabels> = {
  title: "Ara",
  searchPlaceholder: "Ekran, ürün ya da hammadde arayın",
  searchTrigger: "Ara…",
  recentLabel: "Sonuçlar:",
  selectLabel: "Seç",
  openHint: "⌘K ya da Ctrl+K ile açılır",
  closeAria: "Aramayı kapat",
  moreCategoriesAria: "Diğer kategoriler",
  noResults: "Bu aramaya uyan bir şey yok.",
  copyLinkAria: "Bağlantıyı kopyala",
  removeAria: "Kaldır",
  navigate: "Gezin",
  open: "Aç",
  actions: "Eylemler",
  guide: "Yardım",
  close: "Kapat",
  returnKey: "Enter",
};

const CATEGORIES: CommandPaletteCategory[] = [
  { id: "ekran", label: "Ekranlar", icon: LayoutGrid, dividerAfter: true },
  { id: "urun", label: "Ürünler", icon: Coffee },
  { id: "hammadde", label: "Hammaddeler", icon: Package },
];

/**
 * AkmanOS "Command Palette" (src/components/akmanos/command-palette): kenar çubuğunda geniş arama düğmesi,
 * ⌘K / Ctrl+K ile her yerden açılır; kategori çipleri, klavyeyle gezinme. Ekranlar, ürünler ve hammaddeler.
 */
export function PanelSearch({ pages, index }: { pages: NavItem[]; index: SearchEntry[] }) {
  const router = useRouter();
  const { results, hrefs } = useMemo(() => {
    const hrefs = new Map<string, string>();
    const results: CommandPaletteResult[] = [];
    for (const p of pages) {
      const id = `ekran:${p.href}`;
      hrefs.set(id, p.href);
      results.push({ id, kind: "document", title: p.label, subtitle: p.excel ? `Ekran • Excel: ${p.excel}` : "Ekran", categoryId: "ekran" });
    }
    for (const e of index) {
      const id = `${e.kind}:${e.href}`;
      hrefs.set(id, e.href);
      results.push({
        id,
        kind: "integration",
        title: e.label,
        subtitle: e.hint.replace(" · ", " • "),
        categoryId: e.kind === "product" ? "urun" : "hammadde",
      });
    }
    return { results, hrefs };
  }, [pages, index]);

  return (
    <CommandPalette
      fullWidth
      showRowActions={false}
      results={results}
      categories={CATEGORIES}
      labels={LABELS}
      onSelect={(r) => {
        const href = hrefs.get(r.id);
        if (href) router.push(href);
      }}
    />
  );
}
