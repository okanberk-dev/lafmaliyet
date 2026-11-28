import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthShell } from "@/app/giris/auth-shell";
import { panelBaglantilari, YONETIM_YOLU } from "@/lib/yonetim-host";
import { getYonetimUser } from "@/server/auth/dal";

import { YonetimGirisForm } from "./giris-form";

export const metadata: Metadata = {
  title: { absolute: "Giriş · Yönetim konsolu" },
  robots: { index: false, follow: false },
};

/**
 * Yönetim konsolunun girişi (docs/planlar/yonetim-konsolu.md; eylem src/server/actions/yonetim-giris.ts). Panelin
 * kabuğunu almaz. Yalnız geçerli konsol oturumu (asıl yönetici, requireYonetim'in kuralı) /yonetim'e gider: geçersiz
 * çerez burada döngü kurmaz.
 */
export default function YonetimGirisPage() {
  return (
    <AuthShell subtitle="Yönetim konsolu">
      <Suspense fallback={<div aria-busy="true" aria-label="Yükleniyor" className="h-[420px] w-full animate-pulse rounded-2xl bg-white/15" />}>
        <GirisIcerik />
      </Suspense>
    </AuthShell>
  );
}

async function GirisIcerik() {
  if (await getYonetimUser()) redirect(YONETIM_YOLU);
  const p = panelBaglantilari();
  return <YonetimGirisForm parolaUnuttum={p.parolaUnuttum} ladminGiris={p.giris} />;
}
