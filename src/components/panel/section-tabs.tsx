import { SegmentedLinks } from "@/components/ui/segmented";

import { sectionTabsFor, type SECTION_TABS } from "./nav";

/**
 * Aynı menü öğesinin altındaki ekranlar arasında sekme (Giderler ↔ Personel, Sayım ↔ Zayi & ikram ↔ Tutarlılık).
 * `current` o sayfanın adresidir; sayfa bunu kendisi verir, böylece bileşen sunucuda kalır. `role` kişinin açabildiği
 * sekmeleri seçer (personel Tutarlılık'ı görmez); tek sekme kalırsa hiçbir şey çizilmez.
 */
export function SectionTabs({ section, current, role }: { section: keyof typeof SECTION_TABS; current: string; role: "admin" | "staff" }) {
  const tabs = sectionTabsFor(section, role);
  if (!tabs.length) return null;
  return <SegmentedLinks label="Bölüm sekmeleri" value={current} options={tabs.map((t) => ({ value: t.href, label: t.label, href: t.href }))} />;
}
