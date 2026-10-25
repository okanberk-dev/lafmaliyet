import { SegmentedLinks } from "@/components/ui/segmented";

/**
 * Kontrol listesi sekmeleri: yöneticide Bugün · Geçmiş · Listeler, personelde Bugün · Geçmiş (son 7 gün; dalga 10
 * §2.5). SECTION_TABS'te değil: Kontrol listeleri menünün üst düzey öğesi, Yardım'ın sekme yolu iki düzeyli bir menü
 * öğesi ister (tests/yardim.test.ts).
 */
export const KONTROL_TABS = [
  { href: "/panel/kontrol", label: "Bugün" },
  { href: "/panel/kontrol/gecmis", label: "Geçmiş" },
  { href: "/panel/kontrol/duzenle", label: "Listeler" },
] as const;

export function KontrolTabs({ current, role }: { current: (typeof KONTROL_TABS)[number]["href"]; role: "admin" | "staff" }) {
  const tabs = role === "admin" ? KONTROL_TABS : KONTROL_TABS.filter((t) => t.href !== "/panel/kontrol/duzenle");
  return <SegmentedLinks label="Kontrol listeleri sekmeleri" value={current} options={tabs.map((t) => ({ value: t.href, label: t.label, href: t.href }))} />;
}
