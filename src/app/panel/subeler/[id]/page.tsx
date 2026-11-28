import { eq } from "drizzle-orm";
import { ArrowLeft, Layers } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { AsilposBranchCard, AsilposOldSecretCard } from "@/components/sube-islemleri/kasa-anahtari";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { BRANCH_FEATURES, type BranchFeature, branchFeatures, featureBranches, hasFeature } from "@/lib/branch-features";
import { BLIND_COUNT_GROUP, CALENDAR_GROUP, COMMISSION_GROUP, ASILPOS_GROUP, MODPOS_GROUP, SHARED_FOR_NOW, SHIFT_PRESET_GROUP, TILL_DEVICE_GROUP } from "@/lib/branch-settings/groups";
import { BRANCH_ID_PATTERN, tillBranches } from "@/lib/branches";
import { effectiveSettings } from "@/lib/commission/report";
import { blindCountSettingOn } from "@/lib/kor-sayim";
import { modposKeyProblem } from "@/lib/modpos/request";
import { modposBranchIds, modposKeyEnv } from "@/lib/modpos/sube";
import { isAnaAdmin } from "@/lib/asil-yonetici";
import { LEGACY_POS_BRANCH_ID } from "@/lib/pos/tills";
import { shiftPresetsOf } from "@/lib/vardiya";
import { requireAdmin } from "@/server/auth/dal";
import { branchSettingView } from "@/server/branch-settings-view";
import { listBranches } from "@/server/branches";
import { cashSettingsCardData } from "@/server/cash/settings-card";
import { posKeyState } from "@/server/asilpos/branch";
import { getDb, schema as dbs } from "@/server/db";
import { loadPosTillIds } from "@/server/pos/tills";
import { isEmailConfigured } from "@/server/notify/resend";
import { parasutLinkCardData } from "@/server/parasut/link-card";

import { CashSettingsCard } from "../../kasa/cash-settings";
import { ChannelSettingsCard } from "../../komisyonlar/channel-settings";
import { BlindCountCard } from "./blind-count-card";
import { CalendarCard } from "./calendar-card";
import { BranchFeaturesCard } from "./features-card";
import { ParasutLinkCard } from "./parasut-card";
import { ModposBranchCard } from "./pos-card";
import { ShiftPresetsCard } from "./shift-presets-card";
import { TillDeviceCard } from "./till-device-card";

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
  const me = await requireAdmin();
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
  // Kasa bağlantısı (çok şube): kasası AsilPOS olan şubede ya da AsilPOS kurulumu yapılmış şubede (deneme günleri) AsilPOS
  // kartı (şubenin kendi geçiş günü ve anahtarı), ModPOS'tan çekilen şubede ModPOS kartı. Sunucu (saveAsilposSecret) aynı
  // kurala bakar
  const [{ ids: tillIds }, [installed]] = await Promise.all([
    loadPosTillIds(),
    getDb().select({ id: dbs.asilposInstalls.id }).from(dbs.asilposInstalls).where(eq(dbs.asilposInstalls.branchId, branch.id)).limit(1),
  ]);
  const tillHere = tillIds.includes(branch.id);
  const asilposHere = tillHere || Boolean(installed);
  const modposHere = modposBranchIds(branches).includes(branch.id);
  const [cash, parasut, commission, calendar, device, modpos, asilpos, secret, blindCount, shiftPresets] = await Promise.all([
    cashSettingsCardData(branch.id),
    parasutLinkCardData(branch.id),
    branchSettingView(COMMISSION_GROUP, branch.id),
    branchSettingView(CALENDAR_GROUP, branch.id),
    branchSettingView(TILL_DEVICE_GROUP, branch.id),
    branchSettingView(MODPOS_GROUP, branch.id),
    // Öbür şubede yalnız eski anahtarın durumu (kasa kaynağı başka şubeye geçtiyse silinebilsin)
    branchSettingView(ASILPOS_GROUP, branch.id),
    asilposHere ? posKeyState(branch.id) : Promise.resolve(null),
    branchSettingView(BLIND_COUNT_GROUP, branch.id),
    branchSettingView(SHIFT_PRESET_GROUP, branch.id),
  ]);
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
        {asilposHere && secret ? (
          <AsilposBranchCard
            data={{
              branchId: branch.id,
              switchDay: asilpos.value.switchDay,
              stored: asilpos.secrets.secret ?? "none",
              source: secret.source,
              problem: secret.problem,
              envName: secret.envName,
              sourceModpos: branch.posSource !== "asilpos",
              till: tillHere,
              legacy: branch.id === LEGACY_POS_BRANCH_ID,
            }}
            // Kasa anahtarını döndürmek ve silmek yalnız asıl yöneticide (saveAsilposSecret aynı denetimi yapar)
            anaAdmin={isAnaAdmin(me)}
          />
        ) : (asilpos.secrets.secret ?? "none") !== "none" ? (
          <AsilposOldSecretCard branchId={branch.id} anaAdmin={isAnaAdmin(me)} />
        ) : null}
        {/* Kasası ModPOS olmayan şubede de, başka şube bu şubenin ay yedeğini kullanıyorsa ("X ile aynı"; oradaki "X şubesinde
            düzenle" buraya gelir) */}
        {modposHere || modpos.link?.sharedWith.length ? (
          <ModposBranchCard
            data={{ view: modpos, keyEnv: modposKeyEnv(branch.id), keyProblem: modposHere ? modposKeyProblem(process.env, branch.id, modposBranchIds(branches)) : null, ownTill: modposHere }}
          />
        ) : null}
        <TillDeviceCard view={device} asilpos={tillHere} />
        <BlindCountCard
          branchId={branch.id}
          branchName={branch.name}
          on={blindCountSettingOn(blindCount.value.enabled, tillHere)}
          isDefault={blindCount.value.enabled === null}
          asilpos={tillHere}
        />
        {/* Yemek kartı ve platformlar bu şubede kullanılıyorsa (şube özelliği yemek_karti) ya da başka şube bu şubenin
            sürelerini kullanıyorsa (oradaki "X şubesinde düzenle" buraya gelir) */}
        {hasFeature(branch, "yemek_karti") || commission.link?.sharedWith.length ? (
          <ChannelSettingsCard settings={effectiveSettings(commission.value.channels)} branchId={branch.id} link={commission.link} anchor="komisyon" />
        ) : null}
        <CalendarCard view={calendar} />
        {/* Sabahçı ve akşamcının saatleri (Vardiya ekranı); seçilmemişse bugünkü sabit saatler */}
        <ShiftPresetsCard
          branchId={branch.id}
          branchName={branch.name}
          presets={shiftPresetsOf(branch.id, shiftPresets.value.presets)}
          isDefault={shiftPresets.value.presets === null}
        />
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
