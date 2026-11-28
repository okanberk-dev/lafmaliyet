import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/ui/misc";
import { panelBaglantilari } from "@/lib/yonetim-host";
import { requireYonetim } from "@/server/auth/dal";
import { yoneticiHesaplariVerisi } from "@/server/yonetici-hesaplari";

import { HesapDurumu, Yoneticiler } from "./yoneticiler-client";

export const metadata: Metadata = { title: "Yöneticiler" };

/**
 * Yönetim konsolu › Yöneticiler (docs/ROLLER.md › Yönetici hesapları; docs/planlar/yonetim-konsolu.md › K-B): yönetici
 * hesaplarını yalnız asıl yönetici yönetir. Liste ve işlemler var olan sunucu eylemleriyle (createUser, saveUser,
 * setUserActive, deleteUser, resetUserTwoFactor, unlockUser, signOutUserEverywhere, createAccessLink); hepsi konsol
 * oturumunu kabul eder, yönetici hesabına dokunan işte requireAnaAdmin ister. Üstte asıl yöneticinin kendi hesabının
 * durumu (iki adımlı, kalan kurtarma kodu); kendi hesabı ladmin › Hesabım'da. Sayfa requireYonetim ister
 */
export default function YoneticilerPage() {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Yöneticiler</h1>
        <p className="mt-1 max-w-[60ch] text-sm leading-6 text-ink-mute">
          Yönetici hesaplarını yalnız asıl yönetici açar ve yönetir. Müdür, muhasebeci ve personel hesapları ladmin › Kullanıcılar&apos;da kalır.
        </p>
      </div>
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <Icerik />
      </Suspense>
    </>
  );
}

async function Icerik() {
  const me = await requireYonetim();
  const v = await yoneticiHesaplariVerisi(me.id);
  return (
    <div className="flex flex-col gap-5">
      <HesapDurumu ikiAdim={v.benim.ikiAdim} kalanKod={v.benim.kalanKod} hesabim={panelBaglantilari().hesabim} />
      <Yoneticiler
        meId={me.id}
        yoneticiler={v.yoneticiler}
        adaylar={v.adaylar}
        subeler={v.subeler}
        emailConfigured={v.emailConfigured}
        twoFactorRequired={v.twoFactorRequired}
        hesabim={panelBaglantilari().hesabim}
      />
    </div>
  );
}
