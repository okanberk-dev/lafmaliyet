import { ArrowLeft, CalendarClock } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AsilposSwitchDayForm } from "@/components/sube-islemleri/gecis-gunu";
import { AsilposBranchCard, AsilposOldSecretCard } from "@/components/sube-islemleri/kasa-anahtari";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { canliBaslik } from "@/lib/asilpos/kasa-acilis";
import { kasaDurumMetni } from "@/lib/asilpos/kasa-durumu";
import { BRANCH_ID_PATTERN, BRANCH_KIND_LABEL, BRANCH_POS_SOURCE_LABEL } from "@/lib/branches";
import { YONETIM_YOLU } from "@/lib/yonetim-host";
import { requireYonetim } from "@/server/auth/dal";
import { subeIslemVerisi } from "@/server/sube-islemleri";

import { DurumKarti, KasaProgramiKarti, SilKarti } from "./sube-islemleri";

export const metadata: Metadata = { title: "Şube işlemleri" };

/**
 * Yönetim konsolu › Şubeler ve kasalar › şube (docs/SUBE.md › Şube işlemleri; docs/planlar/yonetim-konsolu.md › K-A):
 * şubeyi kapatma ve yeniden açma, tür ve kasa programı, AsilPOS'a geçiş günü, kasa anahtarını döndürme ve silme, eski
 * anahtarı silme, şubeyi silme. Var olan sunucu eylemleri (updateBranch, saveAsilposSwitchDay, saveAsilposSecret,
 * deleteBranch; requireAnaAdmin yalnız konsol oturumunu kabul eder) ve ladmin'le ortak bileşenler
 * (src/components/sube-islemleri). Her yıkıcı işlem onaylı, kasa anahtarı parolayla; son günlerde kasadan gün sonu gelen
 * şubede (canlı) sayfanın başında ve pencerelerde kırmızı uyarı. Sayfa requireYonetim ister
 */
export default function SubeIslemleriPage({ params }: PageProps<"/yonetim/sube/[id]">) {
  return (
    <>
      <div className="mb-4">
        <ButtonLink href={YONETIM_YOLU} variant="ghost" size="sm">
          <ArrowLeft className="size-3.5" aria-hidden /> Şubeler ve kasalar
        </ButtonLink>
      </div>
      <Suspense fallback={<PageSkeleton rows={4} />}>
        <Icerik params={params} />
      </Suspense>
    </>
  );
}

async function Icerik({ params }: { params: PageProps<"/yonetim/sube/[id]">["params"] }) {
  await requireYonetim();
  const { id } = await params;
  if (!BRANCH_ID_PATTERN.test(id)) notFound();
  const v = await subeIslemVerisi(id);
  if (!v) notFound();
  const { branch } = v;
  const canli = v.canli ? canliBaslik(branch.name) : null;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xl font-semibold tracking-tight text-ink">
          {branch.name}
          {branch.active ? null : <Badge tone="amber">Kapalı</Badge>}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-mute">
          <code className="text-[13px]">{branch.id}</code>
          <span>· {BRANCH_KIND_LABEL[branch.kind]}</span>
          <span>· Kasa programı: {BRANCH_POS_SOURCE_LABEL[branch.posSource]}</span>
          {v.kasa ? <span>· {kasaDurumMetni(v.kasa)}</span> : null}
        </p>
      </div>
      {canli ? <Notice tone="bad" title={canli} text="Kapatma, silme, kasa programı ve kasa anahtarı değişikliği bugünkü kasayı durdurabilir." /> : null}
      <DurumKarti branch={branch} rows={v.rows} canli={canli} />
      <KasaProgramiKarti key={`${branch.kind}:${branch.posSource}`} branch={branch} rows={v.rows} canli={canli} />
      {v.gecis ? (
        <Card id="gecis-gunu">
          <CardHeader icon={<CalendarClock />} title="AsilPOS'a geçiş günü" description="Bu günden itibaren şubenin gün sonu AsilPOS'tan sayılır. Kapalı dönemi etkileyen değişiklik yazılmaz." />
          <div className="px-5 pb-5">
            <AsilposSwitchDayForm branchId={branch.id} {...v.gecis} />
          </div>
        </Card>
      ) : branch.kind === "fiziksel" ? (
        <Notice tone="neutral" size="sm" title="Geçiş günü yalnız kasa programı AsilPOS olan şubede seçilir." />
      ) : null}
      {v.asilpos ? (
        <AsilposBranchCard data={v.asilpos} yer="konsol" canli={canli} />
      ) : v.eskiAnahtar ? (
        <AsilposOldSecretCard branchId={branch.id} yer="konsol" />
      ) : null}
      <SilKarti branch={branch} silinemez={v.silinemez} canli={canli} />
    </div>
  );
}
