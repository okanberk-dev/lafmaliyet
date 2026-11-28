import { Globe, Settings2 } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/misc";
import { SubeEkleme } from "@/components/sube-ekleme/sube-ekleme-client";
import { konsolSubeYolu } from "@/lib/yonetim-host";
import { createBranch, releaseBranchTill, saveBranchStaff, sendBranchInstall } from "@/server/actions/branches";
import { requireYonetim } from "@/server/auth/dal";
import { subeEklemeVerisi } from "@/server/sube-ekleme";

export const metadata: Metadata = { title: "Şubeler ve kasalar" };

/**
 * Konsol › Şubeler ve kasalar (docs/planlar/yonetim-konsolu.md › K-A): ladmin'deki /panel/sube-ekleme ile aynı bileşen,
 * aynı veri ve aynı eylemler (yeni şube, kasa durumu, Bilgisayara kur, ilk personel, Kasayı serbest bırak); konsolda her
 * şube satırında "Şube işlemleri" (/yonetim/sube/[id]: kapatma, silme, tür, kasa programı, geçiş günü, kasa anahtarı).
 * Online kanallar ayrı listede (kasaları yok). Eylemler requireAnaAdmin'le konsol oturumunu da kabul eder
 * (src/server/auth/dal.ts); sayfa ayrıca requireYonetim ister
 */
export default function SubelerVeKasalarPage() {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Şubeler ve kasalar</h1>
        <p className="mt-1 max-w-[60ch] text-sm leading-6 text-ink-mute">
          Yeni şube açın, şubelerin kasa durumunu görün, kasayı bilgisayara kurun, ilk personeli ayarlayın ya da kasayı serbest bırakın. Kapatma, silme, kasa programı, geçiş günü ve kasa anahtarı şubenin Şube işlemleri sayfasında.
        </p>
      </div>
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <Icerik />
      </Suspense>
    </>
  );
}

async function Icerik() {
  await requireYonetim();
  const veri = await subeEklemeVerisi();
  const kanallar = veri.rows.filter((b) => b.kind === "online");
  return (
    <div className="space-y-4">
      <SubeEkleme
        {...veri}
        createAction={createBranch}
        installAction={sendBranchInstall}
        staffAction={saveBranchStaff}
        releaseAction={releaseBranchTill}
        yer="konsol"
      />
      {kanallar.length ? (
        <Card>
          <CardHeader icon={<Globe />} title="Online kanallar" description="Kasası olmayan satış kanalları. Kapatma ve silme Şube işlemleri sayfasında." />
          <ul className="divide-y divide-line border-t border-line">
            {kanallar.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 pr-3 pl-5 text-sm">
                <p className="flex min-w-0 flex-1 basis-56 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium break-words text-ink">{b.name}</span>
                  <code className="text-[12px] text-ink-mute">{b.id}</code>
                  {b.active ? null : <Badge tone="amber">Kapalı</Badge>}
                </p>
                <ButtonLink href={konsolSubeYolu(b.id)} size="sm" variant="secondary" className="max-sm:w-full" aria-label={`${b.name}: şube işlemleri`}>
                  <Settings2 className="size-4" aria-hidden="true" /> Şube işlemleri
                </ButtonLink>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
