import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { setupContinueHref } from "@/lib/admin-security";
import { homeFor } from "@/lib/roles";
import { requireSignedIn } from "@/server/auth/dal";

import { AuthShell } from "../auth-shell";
import { TwoFactorSetup } from "./setup";

export const metadata: Metadata = {
  title: "İki adımlı doğrulamayı kurun",
  robots: { index: false, follow: false },
};

/**
 * Zorunlu iki adımlı kurulum (yalnız ADMIN_2FA_REQUIRED=1 iken; src/lib/admin-security.ts; docs/DEPLOY.md › 6a): iki adımlısı kapalı yönetici girişten
 * sonra ve panelin her adresinden buraya gelir; kurana kadar panel açılmaz. Panelin dışında durur (kabuk, zil, canlı
 * veri yok) ve proxy'nin eşleştirdiği adreslerden değildir. İki adımlısı açık kişi bu sayfada kalabilir: kurulum
 * bittiğinde sayfa sunucudan yeniden çizilir, kurtarma kodları ekranda kalmalı (yönlendirme onları silerdi). Oturum ve
 * adres okunana kadar kartın yeri tutulur (cacheComponents: istek verisi Suspense içinde okunur).
 */
export default function TwoFactorSetupPage({ searchParams }: PageProps<"/giris/iki-adim">) {
  return (
    <AuthShell>
      <Suspense fallback={<div aria-busy="true" aria-label="Yükleniyor" className="h-[420px] w-full animate-pulse rounded-2xl bg-white/15" />}>
        <SetupContent searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

async function SetupContent({ searchParams }: { searchParams: PageProps<"/giris/iki-adim">["searchParams"] }) {
  const me = await requireSignedIn();
  const next = setupContinueHref((await searchParams).next, homeFor(me.role));
  // Buraya işi olmayan (personel; zorunluluk kapalıyken iki adımlısız yönetici) kendi sayfasına
  if (!me.needsTwoFactor && !me.totpEnabled) redirect(next);
  return <TwoFactorSetup userId={me.id} email={me.email} enabled={me.totpEnabled} next={next} />;
}
