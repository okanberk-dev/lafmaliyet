"use client";

import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { setEmployerSgkRate } from "@/server/actions/tax";

/**
 * Gelir-gider'deki SGK oranı uyarısı (plan docs/planlar/vergi.md K19, §4.6): Ayarlar'daki işveren oranı vergi ve nakit
 * planının oranından farklıysa tek satır. Oran kendiliğinden değişmez; sahip Muhasebeciye sorulacaklar › SGK oranı'nı
 * işaretleyince düğme çıkar, onaydan sonra yalnız `isverenSgk` yazılır (geçmiş ayların gelir-gideri de değişir).
 */
export function SgkRateNotice({ text, target, targetText, canApply }: { text: string; target: number; targetText: string; canApply: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, run] = useActionTransition();
  return (
    <div className="mb-6 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-2xl bg-warn-soft px-4 py-3 text-[13px] leading-5 text-warn" role="note">
      <p className="flex min-w-0 flex-1 basis-72 items-start gap-1.5 font-medium text-pretty">
        <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0">{text}</span>
      </p>
      {canApply ? (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)} disabled={pending}>
          Ayarlar&apos;daki oranı {targetText} yap
        </Button>
      ) : null}
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`İşveren SGK oranı ${targetText} olsun mu?`}
        description={`Ayarlar bütün aylar için tek değerdir: personel maliyeti ve Gelir-gider, geçmiş aylar dahil, ${targetText} ile yeniden hesaplanır. Öteki üç oran değişmez.`}
        confirmLabel={`${targetText} yap`}
        tone="primary"
        pending={pending}
        onConfirm={() =>
          run(async () => {
            const r = await setEmployerSgkRate(target);
            if (!r.ok) return void toast.error(r.error, { duration: 10_000 });
            setOpen(false);
            toast.success(`İşveren SGK oranı ${targetText} yapıldı`);
          })
        }
      />
    </div>
  );
}
