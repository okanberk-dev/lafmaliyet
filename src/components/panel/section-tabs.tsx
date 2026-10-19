import { SegmentedLinks } from "@/components/ui/segmented";

import { SECTION_TABS } from "./nav";

/**
 * Aynı menü öğesinin altındaki ekranlar arasında sekme (Giderler ↔ Personel, Sayım ↔ Tutarlılık).
 * `current` o sayfanın adresidir; sayfa bunu kendisi verir, böylece bileşen sunucuda kalır.
 */
export function SectionTabs({ section, current }: { section: keyof typeof SECTION_TABS; current: string }) {
  const tabs = SECTION_TABS[section];
  return <SegmentedLinks label="Bölüm sekmeleri" value={current} options={tabs.map((t) => ({ value: t.href, label: t.label, href: t.href }))} />;
}
