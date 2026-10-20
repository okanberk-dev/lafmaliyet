import type { Metadata } from "next";
import { Suspense } from "react";

import { formatExpiry } from "@/app/panel/kullanicilar/access";
import { tokenStatus } from "@/server/auth/tokens";
import { loadToken } from "@/server/auth/user-tokens";

import { InviteCard } from "./card";
import { TokenProblem } from "./problem";
import { SetPasswordForm } from "./set-password-form";

/*
 * Herkese açık: davet ve parola sıfırlama bağlantısı (/davet?t=…). Oturum gerektirmez ve oturum açmaz.
 * Sayfayı açmak bağlantıyı tüketmez (WhatsApp önizlemesi de açar); yalnızca parola kaydedilince kullanılmış sayılır.
 * Adresteki anahtar başka siteye gitmesin diye sayfa yönlendiren (referrer) bilgisi göndermez.
 */
export const metadata: Metadata = {
  title: "Parola belirle",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function InvitePage({ searchParams }: PageProps<"/davet">) {
  return (
    <div className="relative flex min-h-dvh items-start justify-center bg-background px-4 pt-10 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:items-center sm:py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgb(0_0_0/0.06)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
      />
      <div className="relative w-full max-w-[420px]">
        <Suspense fallback={<div aria-busy="true" aria-label="Yükleniyor" className="h-[460px] w-full animate-pulse rounded-3xl bg-chart-card-bg" />}>
          <InviteContent searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function InviteContent({ searchParams }: { searchParams: PageProps<"/davet">["searchParams"] }) {
  const { t } = await searchParams;
  const raw = Array.isArray(t) ? t[0] : t;
  const found = await loadToken(raw);
  const status = found ? tokenStatus(found.token, found.user) : "invalid";
  if (!found || status !== "ok") {
    return (
      <InviteCard title="Parola belirleme" subtitle="L'Affogato yönetim paneli">
        <TokenProblem status={status === "ok" ? "invalid" : status} />
      </InviteCard>
    );
  }
  const invite = found.token.kind === "invite";
  return (
    <InviteCard title={invite ? `Hoş geldiniz, ${found.user.name.split(/\s+/)[0]}` : "Yeni parola belirleyin"} subtitle={invite ? "L'Affogato paneli için parolanızı belirleyin" : "L'Affogato yönetim paneli"}>
      <SetPasswordForm token={raw!} name={found.user.name} email={found.user.email} kind={found.token.kind} until={formatExpiry(found.token.expiresAt.toISOString())} />
    </InviteCard>
  );
}
