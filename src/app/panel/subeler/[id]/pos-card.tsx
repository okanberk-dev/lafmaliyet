"use client";

import { ReceiptTurkishLira } from "lucide-react";

import { SameAsToggle } from "@/components/panel/same-as-toggle";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import type { ModposSetting } from "@/lib/branch-settings/groups";
import type { BranchSettingView } from "@/server/branch-settings-view";

import { ModposFallbackSwitch } from "../../ayarlar/modpos-client";

// Şubenin AsilPOS bağlantısı (kasa anahtarı) kartı ortak bileşende: src/components/sube-islemleri/kasa-anahtari.tsx
// (ladmin'in Şube ayarları ve Yönetim konsolunun Şube işlemleri aynı bileşeni kullanır)

/** ModPOS kartının verisi: ay yedeği (şube ayarı modpos) ve anahtarın yalnız durumu (anahtar ortamda) */
export interface ModposBranchData {
  view: BranchSettingView<ModposSetting>;
  /** Şubenin anahtarının ortam adı (MODPOS_API_KEY, MODPOS_API_KEY_MARINA) */
  keyEnv: string;
  /** Anahtarın sorunu (yok, bozuk, başka şubeyle aynı); null: tanımlı */
  keyProblem: string | null;
  /** Şubenin kasası ModPOS'tan çekiliyor; false: yalnız başka şube bu şubenin ay yedeğini kullandığı için çizilir */
  ownTill: boolean;
}

/**
 * Şube ayarları › ModPOS (şube ayarı modpos; docs/MODPOS-API.md › Şubeler): yalnız kasası ModPOS olan şubede. Anahtar
 * şube başına ortamda durur (burada yalnız durumu); ay rakamına yedek şube başına, "Diğer şubeyle aynı" ile. Günlerin
 * çekimi ve durumu Ayarlar › ModPOS API'de.
 */
export function ModposBranchCard({ data }: { data: ModposBranchData }) {
  const { view } = data;
  const linked = view.link?.mode.kind === "linked";
  return (
    <Card id="modpos" className="scroll-mt-20">
      <CardHeader
        icon={<ReceiptTurkishLira />}
        title="ModPOS"
        description={
          data.ownTill
            ? "Bu şubenin kasası ModPOS: kasa föyü her sabah ModPOS API'den çekilir."
            : `Bu şubenin kasası ModPOS'tan çekilmiyor; ay yedeği ayarı ${view.link?.sharedWith.join(", ") ?? ""} için burada tutulur.`
        }
      />
      <div className="space-y-3 px-5 pb-5">
        {data.ownTill ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-surface px-4 py-3 text-sm ring-1 ring-line">
            <span className="min-w-0 flex-1 basis-48">
              <Badge tone={data.keyProblem ? "amber" : "green"} dot>
                {data.keyProblem ? "Anahtar sorunlu" : "Anahtar tanımlı"}
              </Badge>
            </span>
            <ButtonLink href={`/panel/ayarlar?sube=${encodeURIComponent(view.branchId)}#modpos`} variant="secondary" size="sm" className="max-sm:w-full">
              Ayarlar › ModPOS API
            </ButtonLink>
          </div>
        ) : null}
        {data.keyProblem ? <Notice tone="warn" size="sm" title="ModPOS anahtarı sorunlu" text="Ayrıntı ve ne yapılacağı Ayarlar › ModPOS API'de." tech={data.keyEnv} /> : null}
        <SameAsToggle link={view.link} branchId={view.branchId} branchName={view.branchName} group="modpos" what="ay yedeği" anchor="modpos" />
        {linked ? (
          <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-ink ring-1 ring-line">
            <span className="text-ink-mute">Ay rakamına yedek:</span> {view.value.monthFallback ? "açık" : "kapalı"}
          </p>
        ) : (
          <ModposFallbackSwitch on={view.value.monthFallback} branchId={view.branchId} />
        )}
      </div>
    </Card>
  );
}
