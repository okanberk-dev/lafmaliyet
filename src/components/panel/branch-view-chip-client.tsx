"use client";

import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Notice, NoticeLink } from "@/components/ui/notice";
import { BRANCH_VIEW_HREF, type ViewArea, type ViewChipText, type ViewMode } from "@/lib/branch-view";
import { saveBranchView } from "@/server/actions/branch-view";

/**
 * Şube görünümü çipinin düğmesi (sunucu tarafı: branch-view-chip.tsx). Basınca alanın tercihi öbür kipe geçer ve sayfa
 * yeniden çizilir; hata bildirimle döner, ekran olduğu gibi kalır
 */
export function BranchViewChipClient({ area, mode, text, className }: { area: ViewArea; mode: ViewMode; text: ViewChipText; className?: string }) {
  const [pending, run] = useActionTransition();
  const flip = () =>
    run(async () => {
      const res = await saveBranchView({ area, mode: text.switchTo });
      if (!res.ok) toast.error(res.error);
    });
  return (
    <Notice
      tone="neutral"
      size="sm"
      className={className}
      title={text.title}
      text={
        <span data-view-mode={mode} className="block space-y-0.5">
          {text.firmOnly ? <span className="block">{text.firmOnly}.</span> : null}
          <span className="block">
            Bütün ekranlar için: <NoticeLink href={BRANCH_VIEW_HREF}>Hesabım › Şube görünümü</NoticeLink>
          </span>
        </span>
      }
      action={
        <Button size="xs" variant="secondary" onClick={flip} disabled={pending} aria-busy={pending || undefined}>
          {text.switchLabel}
        </Button>
      }
    />
  );
}
