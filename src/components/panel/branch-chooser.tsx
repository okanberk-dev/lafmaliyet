import { Store } from "lucide-react";

import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { BRANCH_PARAM } from "@/lib/branches";

/**
 * "Hangi şubenin …?" seçimi (şube kapsamı C P1-5, P1-6; docs/SUBE.md › Yazarken hangi şube): şube başına tutulan bir
 * formun (kasa raporu, stok sayımı) sayfası "Tümü" ya da online kanal seçiliyken birden çok kasa açıksa formu çizmez;
 * önce şubeyi sorar. Önceden form sessizce Tuzla'nınkini açıyordu. Her düğme sayfanın kendi adresini `?sube=` ile açar;
 * seçici onu çereze benimsetir ve adresten düşürür (src/components/panel/branch-picker.tsx), öteki sorgu alanları kalır.
 * Sunucu bileşeni: istemci kodu yok, düğmeler bağlantıdır (44 px).
 */
export function BranchChooser({
  title,
  description,
  path,
  params = {},
  branches,
}: {
  title: string;
  description: string;
  path: string;
  /** Korunacak sorgu alanları (ör. `gun`, `ay`) */
  params?: Record<string, string | undefined>;
  branches: readonly { id: string; name: string }[];
}) {
  const href = (id: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    q.set(BRANCH_PARAM, id);
    return `${path}?${q}`;
  };
  return (
    <Card>
      <CardHeader icon={<Store />} title={title} description={description} />
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {branches.map((b) => (
            <ButtonLink key={b.id} href={href(b.id)} variant="secondary" className="min-h-11 max-sm:flex-1">
              {b.name}
            </ButtonLink>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
