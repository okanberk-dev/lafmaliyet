"use client";

import { Link2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Select } from "@/components/ui/form";
import { ToggleRow } from "@/components/ui/toggle-row";
import { setBranchSettingLink } from "@/server/actions/branch-settings";
import type { SettingLinkView } from "@/server/branch-settings-view";

/**
 * "Diğer şubeyle aynı" anahtarı (docs/SUBE.md › Şube başına ayarlar): kartın ilk satırı. Açılınca şubenin kendi değeri
 * silinir, seçilen şubeninki kullanılır; kapatılınca o anki değer şubeye kopyalanır, sonra ayrı düzenlenir. Bu şubenin
 * ayarını kullanan şubeler varsa söyler. Kasa raporu alıcıları ve Paraşüt kartları kendi metinleriyle aynı akışı taşır;
 * öbür gruplar (komisyon, ModPOS, çalışma takvimi) bunu kullanır. Birden çok kasa yokken çizilmez (`link` null).
 */
export function SameAsToggle({
  link,
  branchId,
  branchName,
  group,
  what,
  anchor,
}: {
  link: SettingLinkView | null;
  branchId: string;
  branchName: string | null;
  /** Grubun kimliği (komisyon, modpos, isletme.takvim) */
  group: string;
  /** Ne paylaşılıyor, küçük harfle ("ödeme süreleri", "ay yedeği") */
  what: string;
  /** Bağlıyken "X şubesinde düzenle" bağlantısının çapası (Şube ayarları ekranındaki kartın kimliği) */
  anchor: string;
}) {
  const [confirm, setConfirm] = useState<null | "link" | "own">(null);
  const [target, setTarget] = useState(link?.targets[0]?.id ?? "");
  const [pending, start] = useActionTransition();
  if (!link || (link.mode.kind !== "linked" && !link.targets.length && !link.sharedWith.length)) return null;
  const linked = link.mode.kind === "linked";
  const here = branchName ?? "Bu şube";
  const targetName = link.targets.find((t) => t.id === target)?.name ?? link.targets[0]?.name ?? "";

  function change(to: "link" | "own") {
    start(async () => {
      const res = await setBranchSettingLink({ branchId, group, sameAs: to === "link" ? target : null });
      if (!res.ok) return void toast.error(res.error);
      setConfirm(null);
      toast.success(to === "link" ? `${here} artık ${targetName} ile aynı ${what} kullanıyor` : `${here} kendi ${what} ayarını kullanıyor`, {
        description: to === "link" ? undefined : "Bugünkü değerler kopyalandı; şimdi ayrı düzenleyebilirsiniz.",
      });
    });
  }

  return (
    <>
      {linked || link.targets.length ? (
        <ToggleRow
          title={linked ? `${link.toName} ile aynı` : link.targets.length === 1 ? `${targetName} ile aynı` : "Diğer şubeyle aynı"}
          description={linked ? `${here}, ${link.toName} şubesinin ${what} ayarını kullanır` : `Açarsanız bu şubenin ${what} ayarı silinir, seçtiğiniz şubeninki kullanılır`}
          label={`Diğer şubeyle aynı ${what}`}
          checked={linked}
          disabled={pending}
          onChange={(v) => setConfirm(v ? "link" : "own")}
        />
      ) : null}
      {link.sharedWith.length ? (
        <p className="flex items-start gap-2 text-[13px] text-ink-mute">
          <Link2 size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {link.sharedWith.join(", ")} {link.sharedWith.length > 1 ? "şubeleri" : "şubesi"} de bu ayarı kullanıyor; buradaki değişiklik orada da geçerli olur.
          </span>
        </p>
      ) : null}
      {link.mode.kind === "linked" ? (
        <ButtonLink href={`/panel/subeler/${encodeURIComponent(link.mode.to)}#${anchor}`} variant="secondary" size="sm" className="max-sm:w-full">
          {link.toName} şubesinde düzenle
        </ButtonLink>
      ) : null}
      <ConfirmDialog
        open={confirm === "own"}
        onClose={() => setConfirm(null)}
        onConfirm={() => change("own")}
        pending={pending}
        tone="primary"
        confirmLabel="Ayır"
        title={`${here} kendi ${what} ayarını kullansın mı?`}
        description={`Bugünkü değerler (${link.toName ?? "bağlı"} şubesininki) bu şubeye kopyalanır; sonra ayrı düzenlenir.`}
      />
      <ConfirmDialog
        open={confirm === "link"}
        onClose={() => setConfirm(null)}
        onConfirm={() => change("link")}
        pending={pending}
        tone="primary"
        confirmLabel="Aynı yap"
        title={`${here} ve ${link.targets.length > 1 ? "seçilen şube" : targetName} aynı ${what} ayarını kullansın mı?`}
        description={
          <div className="space-y-3">
            <p>
              Bu şubenin kendi ayarı silinir; değer tek yerden, {targetName} şubesinden düzenlenir.
            </p>
            {link.targets.length > 1 ? (
              <Field label="Hangi şubeyle aynı" htmlFor={`${anchor}-hedef`}>
                <Select id={`${anchor}-hedef`} value={target} onChange={(e) => setTarget(e.target.value)}>
                  {link.targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
        }
      />
    </>
  );
}
