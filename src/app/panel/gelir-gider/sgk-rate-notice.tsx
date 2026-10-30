"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Notice, NoticeLink } from "@/components/ui/notice";
import { setEmployerSgkRate } from "@/server/actions/tax";

/**
 * Gelir-gider'deki SGK oranı uyarısı (plan docs/planlar/vergi.md K19, §4.6; görünüm docs/planlar/ux-sade.md U3):
 * Maaşlar'daki işveren oranı vergi ve nakit planının oranından farklıysa tek satır, iki oran başlıkta. Oran kendiliğinden
 * değişmez; sahip Muhasebeciye sorulacaklar › SGK oranı'nı işaretleyince düğme çıkar (yoksa "Muhasebeciye sor"),
 * onaydan sonra yalnız `isverenSgk` yazılır (geçmiş ayların gelir-gideri de değişir). Para riski: hiç katlanmaz.
 */
export function SgkRateNotice({ text, target, targetText, currentText, canApply }: { text: string; target: number; targetText: string; currentText: string; canApply: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, run] = useActionTransition();
  return (
    <>
      <Notice
        tone="warn"
        risk="para"
        className="mb-6"
        title={`SGK oranı: Maaşlar'da ${currentText}, vergide ${targetText}`}
        action={canApply ? (
          <Button variant="secondary" size="xs" onClick={() => setOpen(true)} disabled={pending}>
            Oranı {targetText} yap
          </Button>
        ) : (
          <NoticeLink href="/panel/vergi/kurallar#sorular">Muhasebeciye sor</NoticeLink>
        )}
      >
        <p>{text}</p>
        <p>
          <NoticeLink href="/panel/personel#sgk-oranlari">Maaşlar › SGK oranları</NoticeLink>
        </p>
      </Notice>
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
    </>
  );
}
