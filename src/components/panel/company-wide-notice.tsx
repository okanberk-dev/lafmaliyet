import { Notice } from "@/components/ui/notice";
import { companyWideNote, type CompanyWideScreen } from "@/lib/branches";
import { currentBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";

/**
 * "Bu ekran firma geneli" notu (şube kapsamı C P1-12, P2-1; docs/SUBE.md › Neyi süzer): Vergi, Nakit planı, Faturalar,
 * Tedarikçiler, Paraşüt ve Tutarlılık şube seçiliyken de bütün şubeleri gösterir; not bunu söyler. "Tümü"de çizilmez.
 * Sunucu bileşeni: seçimi kendisi okur (sayfanın okuması "Tümü"yle sarılı olsa da notu isteğin seçimi belirler).
 */
export async function CompanyWideNotice({ screen, className }: { screen: CompanyWideScreen; className?: string }) {
  const [scope, branches] = await Promise.all([currentBranchScope(), listBranches()]);
  const note = companyWideNote(screen, scope, branches);
  if (!note) return null;
  return (
    <Notice tone="neutral" size="sm" className={className} title={note.title}>
      {note.text}
    </Notice>
  );
}
