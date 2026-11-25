"use client";

import { Blocks } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Card, CardHeader } from "@/components/ui/card";
import { ToggleRow } from "@/components/ui/toggle-row";
import { BRANCH_FEATURES, type BranchFeature } from "@/lib/branch-features";
import { setBranchFeature } from "@/server/actions/branch-settings";

/**
 * Şube ayarları › Özellikler (şube kapsamı B6; docs/SUBE.md › Şube özellikleri): şubede hangi iş yapılıyor. Kapalı
 * özelliğin menüsü, ekranı ve bildirimi o şube seçiliyken gizlenir ("Bu şubede kullanılmıyor"); şubesine kilitli
 * personele ne ekranı ne bildirimi gider. Karaoke tek şubede açık olabilir: başka şubede açıksa anahtar kapalı ve
 * nerede açık olduğunu söyler. Her dokunuş hemen kaydedilir (tek işlem, işlem geçmişine yazılır).
 */
export function BranchFeaturesCard({
  branchId,
  branchName,
  features,
  heldBy,
}: {
  branchId: string;
  branchName: string;
  features: readonly BranchFeature[];
  /** Tek şubelik özelliğin açık olduğu öbür şubenin adı (karaoke Marina'da açıksa Tuzla'nın kartında "Marina") */
  heldBy: Partial<Record<BranchFeature, string>>;
}) {
  const [pending, start] = useActionTransition();
  // Kaydedilene dek anahtar yeni konumunda görünür; ret gelirse eski konumuna döner
  const [on, setOn] = useState<readonly BranchFeature[]>(features);

  function change(feature: BranchFeature, next: boolean) {
    const before = on;
    setOn(next ? [...on, feature] : on.filter((f) => f !== feature));
    start(async () => {
      const res = await setBranchFeature({ branchId, feature, on: next });
      if (!res.ok) {
        setOn(before);
        return void toast.error(res.error);
      }
      setOn(res.data.features);
      const label = BRANCH_FEATURES.find((f) => f.id === feature)?.label ?? feature;
      toast.success(next ? `${label} ${branchName} şubesinde açıldı` : `${label} ${branchName} şubesinde kapatıldı`);
    });
  }

  return (
    <Card id="ozellikler" className="scroll-mt-20">
      <CardHeader icon={<Blocks />} title="Özellikler" description="Şubede kullanılan işler. Kapalı olanın menüsü, ekranı ve bildirimi bu şube seçiliyken görünmez." />
      <div className="space-y-2 px-5 pb-5">
        {BRANCH_FEATURES.map((f) => {
          const checked = on.includes(f.id);
          const holder = f.single && !checked ? heldBy[f.id] : undefined;
          return (
            <ToggleRow
              key={f.id}
              title={f.label}
              description={holder ? `${holder} şubesinde açık; yalnız bir şubede olabilir. Önce oradan kapatın.` : f.description}
              label={`${branchName}: ${f.label}`}
              checked={checked}
              disabled={pending || Boolean(holder)}
              onChange={(v) => change(f.id, v)}
            />
          );
        })}
      </div>
    </Card>
  );
}
