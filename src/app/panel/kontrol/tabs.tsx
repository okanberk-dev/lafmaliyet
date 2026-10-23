import { SegmentedLinks } from "@/components/ui/segmented";

/**
 * Yöneticinin kontrol listesi sekmeleri: Bugün · Geçmiş · Listeler. SECTION_TABS'te değil: Kontrol listeleri menünün
 * üst düzey öğesi, Yardım'ın sekme yolu iki düzeyli bir menü öğesi ister (tests/yardim.test.ts).
 */
export const KONTROL_TABS = [
  { href: "/panel/kontrol", label: "Bugün" },
  { href: "/panel/kontrol/gecmis", label: "Geçmiş" },
  { href: "/panel/kontrol/duzenle", label: "Listeler" },
] as const;

export function KontrolTabs({ current }: { current: (typeof KONTROL_TABS)[number]["href"] }) {
  return <SegmentedLinks label="Kontrol listeleri sekmeleri" value={current} options={KONTROL_TABS.map((t) => ({ value: t.href, label: t.label, href: t.href }))} />;
}
