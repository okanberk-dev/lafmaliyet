import type { ReactNode } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";

/**
 * Raporlar'ın ortak başlığı (docs/RAPORLAR.md): sekmeler kenar çubuğunun Raporlar grubundan türer (SECTION_TABS.raporlar;
 * Şube karşılaştırma · İşçilik / ciro · Kaçak raporu · Kayıp önleme). Hepsi yalnız yöneticinin
 */
export function ReportHeader({ path, title, description, more, actions }: { path: string; title: string; description: string; more?: string; actions?: ReactNode }) {
  return <PageHeader path={path} title={title} description={description} more={more} actions={actions} tabs={<SectionTabs section="raporlar" current={path} role="admin" />} />;
}
