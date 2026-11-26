import type { Metadata } from "next";
import { redirect } from "next/navigation";

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
 * Zorunlu iki adımlı kurulum (src/lib/admin-security.ts; docs/DEPLOY.md › 6a): iki adımlısı kapalı yönetici girişten
 * sonra ve panelin her adresinden buraya gelir; kurana kadar panel açılmaz. Panelin dışında durur (kabuk, zil, canlı
 * veri yok) ve proxy'nin eşleştirdiği adreslerden değildir. İki adımlısı açık kişi bu sayfada kalabilir: kurulum
 * bittiğinde sayfa sunucudan yeniden çizilir, kurtarma kodları ekranda kalmalı (yönlendirme onları silerdi).
 */
export default async function TwoFactorSetupPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const me = await requireSignedIn();
  const next = setupContinueHref((await searchParams).next, homeFor(me.role));
  // Buraya işi olmayan (personel; zorunluluk kapalıyken iki adımlısız yönetici) kendi sayfasına
  if (!me.needsTwoFactor && !me.totpEnabled) redirect(next);
  return (
    <AuthShell>
      <TwoFactorSetup email={me.email} enabled={me.totpEnabled} next={next} />
    </AuthShell>
  );
}
