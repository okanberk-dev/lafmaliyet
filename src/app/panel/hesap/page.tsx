import { eq } from "drizzle-orm";
import { KeyRound, PlugZap, UserRound } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { ROLES } from "@/lib/constants";
import { requireUser } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";
import { loadMyConnections } from "@/server/mcp/connections";

import { ConnectionsCard } from "./connections";
import { AccountAvatar, PasswordForm, ProfileForm } from "./password-form";
import { SessionsCard } from "./sessions";
import { TwoFactorCard } from "./two-factor";

export const metadata: Metadata = { title: "Hesabım" };

export default function AccountPage() {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <PageHeader title="Hesabım" path="/panel/hesap" description="Bilgileriniz, giriş parolanız ve iki adımlı doğrulama." />
      <Suspense fallback={<AccountSkeleton />}>
        <Account />
      </Suspense>
    </div>
  );
}

function AccountSkeleton() {
  return (
    <div aria-busy="true" aria-label="Yükleniyor" className="space-y-4">
      <Skeleton className="h-[320px] rounded-3xl" />
      <Skeleton className="h-[280px] rounded-3xl" />
    </div>
  );
}

async function Account() {
  const user = await requireUser();
  // Bağlı uygulamalar (Claude bağlantısı) yalnız yöneticide; okunamazsa sayfanın geri kalanı yine açılır
  const [[security], connections] = await Promise.all([
    getDb().select({ totpEnabled: s.users.totpEnabled, recoveryCodes: s.users.recoveryCodes }).from(s.users).where(eq(s.users.id, user.id)).limit(1),
    user.role === "admin"
      ? loadMyConnections(user.id).catch((e) => {
          console.error("Bağlı uygulamalar okunamadı", e);
          return null;
        })
      : null,
  ]);
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-col items-center px-5 pt-8 pb-6 text-center">
          <AccountAvatar name={user.name} />
          {/* Uzun ad ve e-posta telefonda kesilmez, alt satıra geçer */}
          <p className="mt-4 max-w-full text-lg leading-7 font-semibold tracking-tight text-balance break-words text-ink">
            <span className="sr-only">Ad: </span>
            {user.name}
          </p>
          <p className="max-w-full text-sm break-all text-ink-mute">
            <span className="sr-only">E-posta: </span>
            {user.email}
          </p>
          <Badge tone={user.role === "admin" ? "solid" : "gray"} className="mt-3">
            <span className="sr-only">Rol: </span>
            {ROLES[user.role]}
          </Badge>
        </div>
        <div className="border-t border-line">
          <CardHeader icon={<UserRound />} title="Hesap bilgileri" description="Giriş yaparken bu e-postayı kullanırsınız." />
          <CardContent>
            <ProfileForm name={user.name} email={user.email} />
          </CardContent>
        </div>
      </Card>
      <Card>
        <CardHeader
          icon={<KeyRound />}
          title="Parola değiştir"
          description="En az 8 karakter; kolay tahmin edilen parolalar (12345678, kafenin adı, e-postanız) kabul edilmez. Değişince diğer cihazlardaki oturumlar kapanır."
        />
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>
      <Card>
        <TwoFactorCard enabled={Boolean(security?.totpEnabled)} recoveryLeft={security?.recoveryCodes?.length ?? 0} />
      </Card>
      <Card>
        <SessionsCard />
      </Card>
      {user.role === "admin" ? (
        <Card id="bagli-uygulamalar" className="scroll-mt-[calc(var(--mobile-top-h)+1.5rem)]">
          {connections ? (
            <ConnectionsCard rows={connections.rows} calls={connections.calls} mcpUrl={connections.mcpUrl} />
          ) : (
            <>
              <CardHeader icon={<PlugZap />} title="Bağlı uygulamalar" />
              <CardContent>
                <p className="rounded-2xl bg-bad-soft px-4 py-3 text-[13px] text-bad">Bağlı uygulamalar okunamadı; sayfayı yenileyin.</p>
              </CardContent>
            </>
          )}
        </Card>
      ) : null}
    </div>
  );
}
