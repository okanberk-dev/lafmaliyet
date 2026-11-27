import type { ReactNode } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import type { Role } from "@/lib/constants";

/**
 * Raporlar'ın ortak başlığı (docs/RAPORLAR.md): sekmeler kenar çubuğunun Raporlar grubundan türer (SECTION_TABS.raporlar;
 * Şube karşılaştırma · İşçilik / ciro · Kaçak raporu · Kayıp önleme). Yöneticinin; müdür yalnız İşçilik / ciro'yu kendi
 * şubesiyle açar (sekmeler rolüne göre süzülür, tek sekme kalınca çizilmez)
 */
export function ReportHeader({ path, title, description, more, actions, role = "admin" }: { path: string; title: string; description: string; more?: string; actions?: ReactNode; role?: Role }) {
  return <PageHeader path={path} role={role} title={title} description={description} more={more} actions={actions} tabs={<SectionTabs section="raporlar" current={path} role={role} />} />;
}
