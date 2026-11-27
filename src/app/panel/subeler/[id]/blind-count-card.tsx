"use client";

import { EyeOff } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Card, CardHeader } from "@/components/ui/card";
import { ToggleRow } from "@/components/ui/toggle-row";
import { saveBlindCount } from "@/server/actions/branch-settings";

/**
 * Şube ayarları › Kör sayım (şube ayarı kasa.kor; docs/KASA-RAPORU.md › Kör sayım): personel kasa raporunda önce
 * çekmecedeki nakdi sayıp kilitler, olması gereken ve kasa farkı sonra görünür; kilitli sayımın değişikliği nedeniyle
 * yazılır ve yöneticiye görünür. Seçilmemişken varsayılan (kasası ModPOS olan şubede açık). AsilPOS'un şubesinin AsilPOS
 * günlerinde sayım zaten AsilPOS'ta kördür. Her dokunuş hemen kaydedilir (tek işlem, işlem geçmişine yazılır).
 */
export function BlindCountCard({ branchId, branchName, on, isDefault, asilpos }: { branchId: string; branchName: string; on: boolean; isDefault: boolean; asilpos: boolean }) {
  const [pending, start] = useActionTransition();
  const [checked, setChecked] = useState(on);

  function change(next: boolean) {
    const before = checked;
    setChecked(next);
    start(async () => {
      const res = await saveBlindCount({ branchId, enabled: next });
      if (!res.ok) {
        setChecked(before);
        return void toast.error(res.error);
      }
      toast.success(next ? `Kör sayım ${branchName} şubesinde açıldı` : `Kör sayım ${branchName} şubesinde kapatıldı`);
    });
  }

  const note = asilpos
    ? "AsilPOS günlerinde sayım zaten AsilPOS'ta kör; bu ayar yalnız panelde girilen (ModPOS) günlere uygulanır."
    : isDefault
      ? "Varsayılan: kasası ModPOS olan şubede açık."
      : null;
  return (
    <Card id="kor-sayim" className="scroll-mt-20">
      <CardHeader
        icon={<EyeOff />}
        title="Kör sayım"
        description="Personel önce çekmecedeki nakdi sayıp kilitler; olması gereken ve kasa farkı sonra görünür. Sayım sonradan değişirse nedeniyle yazılır, siz görürsünüz."
      />
      <div className="space-y-2 px-5 pb-5">
        <ToggleRow title="Kasa raporunda kör sayım" description={note ?? undefined} label={`${branchName}: kör sayım`} checked={checked} disabled={pending} onChange={change} />
      </div>
    </Card>
  );
}
