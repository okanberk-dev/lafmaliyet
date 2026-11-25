import { ArrowLeft, Layers } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { BRANCH_FEATURES, type BranchFeature, branchFeatures, featureBranches } from "@/lib/branch-features";
import { SHARED_FOR_NOW } from "@/lib/branch-settings/groups";
import { BRANCH_ID_PATTERN, tillBranches } from "@/lib/branches";
import { requireAdmin } from "@/server/auth/dal";
import { listBranches } from "@/server/branches";
import { cashSettingsCardData } from "@/server/cash/settings-card";
import { isEmailConfigured } from "@/server/notify/resend";
import { parasutLinkCardData } from "@/server/parasut/link-card";

import { CashSettingsCard } from "../../kasa/cash-settings";
import { BranchFeaturesCard } from "./features-card";
import { ParasutLinkCard } from "./parasut-card";

export const metadata: Metadata = { title: "Şube ayarları" };

/**
 * Şube ayarları (/panel/subeler/[id]; docs/SUBE.md › Şube başına ayarlar), yalnız yönetici. Şubeye göre değişebilen
 * ayarlar tek sütunda, grup başına bir kart; "aynı" sunulan grupta "Diğer şubeyle aynı" seçimi. Şube adresten gelir:
 * panelin şube seçicisini değiştirmez, seçici ile form ayrışmaz. Kasa sayfasındaki kartla aynı bileşen.
 */
export default function BranchSettingsPage({ params }: PageProps<"/panel/subeler/[id]">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader path="/panel/subeler" title="Şube ayarları" description="Yükleniyor…" />
          <PageSkeleton rows={4} />
        </>
      }
    >
      <BranchSettingsContent params={params} />
    </Suspense>
  );
}

async function BranchSettingsContent({ params }: { params: PageProps<"/panel/subeler/[id]">["params"] }) {
  await requireAdmin();
  const { id } = await params;
  if (!BRANCH_ID_PATTERN.test(id)) notFound();
  const branches = await listBranches();
  const branch = branches.find((b) => b.id === id);
  if (!branch) notFound();
  const others = tillBranches(branches).filter((b) => b.id !== id);
  const header = (
    <PageHeader
      path="/panel/subeler"
      title="Şube ayarları"
      description={`${branch.name}: şubede kullanılan özellikler ve şubeye göre değişen ayarlar. "Diğer şubeyle aynı" açıkken değer tek yerden düzenlenir.`}
      actions={
        <ButtonLink href="/panel/subeler" variant="ghost" size="sm">
          <ArrowLeft size={14} aria-hidden="true" /> Şubeler
        </ButtonLink>
      }
    />
  );
  if (branch.kind !== "fiziksel") {
    return (
      <>
        {header}
        <Notice tone="neutral" title={`${branch.name} online kanal: kasası yok, şube ayarı da yok`} text="Şube ayarları fiziksel şubelerde tutulur." />
      </>
    );
  }
  const [cash, parasut] = await Promise.all([cashSettingsCardData(branch.id), parasutLinkCardData(branch.id)]);
  // Tek şubelik özelliğin (karaoke) öbür şubedeki sahibi: kartta anahtar kapalı, "Marina şubesinde açık"
  const heldBy: Partial<Record<BranchFeature, string>> = {};
  for (const f of BRANCH_FEATURES.filter((x) => x.single)) {
    const holder = featureBranches(branches, f.id).find((b) => b.id !== branch.id);
    if (holder) heldBy[f.id] = holder.name;
  }
  return (
    <>
      {header}
      <div className="mx-auto max-w-2xl space-y-4">
        {others.length ? (
          <nav className="flex flex-wrap items-center gap-2" aria-label="Öbür şubelerin ayarları">
            <span className="text-sm text-ink-mute">Öbür şube:</span>
            {others.map((b) => (
              <ButtonLink key={b.id} href={`/panel/subeler/${encodeURIComponent(b.id)}`} variant="secondary" size="sm">
                {b.name}
              </ButtonLink>
            ))}
          </nav>
        ) : null}
        {branch.active ? null : <Notice tone="warn" size="sm" title={`${branch.name} kapalı`} text="Ayarları durur; şube yeniden açılınca kullanılır." />}
        <BranchFeaturesCard branchId={branch.id} branchName={branch.name} features={branchFeatures(branch)} heldBy={heldBy} />
        <CashSettingsCard {...cash} emailConfigured={isEmailConfigured()} />
        <ParasutLinkCard data={parasut} />
        <Card>
          <CardHeader icon={<Layers />} title="Şimdilik bütün şubelerde ortak" description="Bu ayarlar şubeye göre değişmez; tek yerden düzenlenir." />
          <ul className="flex flex-wrap gap-2 px-5 pb-5">
            {SHARED_FOR_NOW.map((g) => (
              <li key={g.id}>
                <Badge tone="gray">{g.label}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
