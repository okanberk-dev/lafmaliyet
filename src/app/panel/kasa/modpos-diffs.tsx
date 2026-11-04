import { Notice } from "@/components/ui/notice";
import { modposDiffText, type ModposDiff } from "@/lib/modpos/compare";

/**
 * Raporun ModPOS kasa föyünden farklı yazılan alanları (docs/MODPOS-API.md › Nerede görünür; yalnız yöneticiye):
 * gün görünümünün "ModPOS kasa föyü" kartı ve günden güne listesinin gün ayrıntısı aynı kutuyu gösterir. Para alanı
 * olduğu için `risk="para"` (katlanmaz). İstemci bileşeni de içe aktarır: yalnız çekirdeğin metin yardımcısını okur
 * (föyün ayrıştırıcısı tarayıcıya gitmez).
 */
export function ModposDiffList({ diffs }: { diffs: readonly ModposDiff[] | null | undefined }) {
  if (!diffs?.length) return null;
  return (
    <Notice
      tone="warn"
      risk="para"
      size="sm"
      title={`ModPOS API'den farklı yazılan ${diffs.length} alan`}
      text={
        <>
          <ul className="list-disc pl-4">
            {diffs.map((d) => (
              <li key={d.field} className="break-words">
                {modposDiffText(d)}
              </li>
            ))}
          </ul>
          <span className="mt-1 block">Yanlış yazıldıysa raporu düzeltin; kapanıştan sonraki bir düzeltmeyse nota yazın.</span>
        </>
      }
    />
  );
}
