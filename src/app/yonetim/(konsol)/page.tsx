import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/ui/misc";
import { SubeEkleme } from "@/components/sube-ekleme/sube-ekleme-client";
import { createBranch, releaseBranchTill, saveBranchStaff, sendBranchInstall } from "@/server/actions/branches";
import { requireYonetim } from "@/server/auth/dal";
import { subeEklemeVerisi } from "@/server/sube-ekleme";

export const metadata: Metadata = { title: "Şubeler ve kasalar" };

/**
 * Konsol › Şubeler ve kasalar (docs/planlar/yonetim-konsolu.md › K-A): ladmin'deki /panel/sube-ekleme ile aynı bileşen,
 * aynı veri ve aynı eylemler (yeni şube, kasa durumu, Bilgisayara kur, ilk personel, Kasayı serbest bırak). Eylemler
 * requireAnaAdmin'le konsol oturumunu da kabul eder (src/server/auth/dal.ts); sayfa ayrıca requireYonetim ister
 */
export default function SubelerVeKasalarPage() {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Şubeler ve kasalar</h1>
        <p className="mt-1 max-w-[60ch] text-sm leading-6 text-ink-mute">
          Yeni şube açın, şubelerin kasa durumunu görün, kasayı bilgisayara kurun, ilk personeli ayarlayın ya da kasayı serbest bırakın.
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
  return (
    <SubeEkleme
      {...veri}
      createAction={createBranch}
      installAction={sendBranchInstall}
      staffAction={saveBranchStaff}
      releaseAction={releaseBranchTill}
    />
  );
}
