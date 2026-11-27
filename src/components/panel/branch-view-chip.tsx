import { showViewChip, type ViewArea, viewChipText } from "@/lib/branch-view";
import { getCurrentUser } from "@/server/auth/dal";
import { currentBranchScope, currentBranchView, staffBranchLock } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";

import { BranchViewChipClient } from "./branch-view-chip-client";

/**
 * Ekranın şube görünümü çipi (şube ayrımı D; docs/SUBE.md › Şube ayrımı): alanın ekranında, tek şube seçiliyken
 * "Marina görünümü · Firma geneline geç" ya da "Firma geneli · Marina seçili · Yalnız Marina'yı göster". Düğme kişinin
 * Hesabım'daki tercihini o alan için değiştirir (`saveBranchView`), sayfa yeniden çizilir. Bütün ekranlar için bağlantı
 * Hesabım › Şube görünümü. "Tümü"de, tek şube açıkken, bütün şubeleri görmeyen rolde ve şubesine kilitli hesapta yok
 * (`showViewChip`). Alan ekranlarında CompanyWideNotice'in yerini alır; o yalnız hep firma geneli kalan ekranlarda kalır.
 * Sunucu bileşeni: seçimi ve tercihi kendisi okur (sayfanın okuması başka kapsamla sarılı olsa da).
 */
export async function BranchViewChip({ area, className }: { area: ViewArea; className?: string }) {
  const [user, scope, branches, lock] = await Promise.all([getCurrentUser(), currentBranchScope(), listBranches(), staffBranchLock()]);
  if (!user) return null;
  const activeBranches = branches.filter((b) => b.active).length;
  if (!showViewChip({ scope, activeBranches, role: user.role, locked: lock !== null || user.role === "manager" })) return null;
  const branch = branches.find((b) => b.id === scope);
  if (!branch) return null;
  const mode = await currentBranchView(area);
  return <BranchViewChipClient area={area} mode={mode} text={viewChipText(area, mode, branch.name)} className={className} />;
}
