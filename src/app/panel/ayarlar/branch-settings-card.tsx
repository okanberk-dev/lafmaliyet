import { Building2, ChevronRight } from "lucide-react";

import { ButtonLink } from "@/components/ui/button";
import { CASH_REPORT_GROUP } from "@/lib/branch-settings/groups";
import { settingMode, settingModeText } from "@/lib/branch-settings/rules";
import { tillBranches } from "@/lib/branches";
import { currentBranchScope } from "@/server/branch-scope";
import { settingLinks } from "@/server/branch-settings";
import { listBranches } from "@/server/branches";

import { SectionCard } from "./section-card";

/**
 * Şube başına ayarlara giriş (docs/SUBE.md › Şube başına ayarlar): ayarların kendisi Şube ayarları ekranında
 * (/panel/subeler/[id]). Tek şube seçiliyken doğrudan o şubenin ekranı, "Tümü"de şube listesi açılır (her satırda
 * "Kendi ayarı / Tuzla ile aynı"). Telefonda öteki bölümlerle aynı satır, dokununca ekran açılır.
 */
export async function BranchSettingsLinkCard() {
  const [scope, branches, links] = await Promise.all([currentBranchScope(), listBranches(), settingLinks(CASH_REPORT_GROUP.id)]);
  const tills = tillBranches(branches);
  const selected = tills.find((b) => b.id === scope) ?? (tills.length === 1 ? tills[0] : null);
  const href = selected ? `/panel/subeler/${encodeURIComponent(selected.id)}` : "/panel/subeler";
  const summary = selected
    ? `${selected.name} · alıcılar: ${settingModeText(settingMode(CASH_REPORT_GROUP, selected.id, links), branches).toLocaleLowerCase("tr-TR")}`
    : tills.map((b) => `${b.name}: ${settingModeText(settingMode(CASH_REPORT_GROUP, b.id, links), branches).toLocaleLowerCase("tr-TR")}`).join(" · ");
  return (
    <SectionCard
      id="sube-ayarlari"
      href={href}
      icon={<Building2 />}
      title="Şube ayarları"
      summary={summary}
      description="Şubeye göre değişen ayarlar: kasa raporu alıcıları, çalışanların gün sonu e-postası ve Paraşüt hesabı. Bir şube öbürüyle aynı ayarı kullanabilir; değer tek yerden düzenlenir."
      actions={
        <ButtonLink href={href} variant="primary">
          {selected ? `${selected.name} ayarları` : "Şubeleri aç"} <ChevronRight size={16} />
        </ButtonLink>
      }
    />
  );
}
