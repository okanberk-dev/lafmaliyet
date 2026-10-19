import { eq } from "drizzle-orm";
import { KeyRound, UserRound } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { ROLES } from "@/lib/constants";
import { requireUser } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";

import { AccountAvatar, PasswordForm, ProfileForm } from "./password-form";
import { TwoFactorCard } from "./two-factor";

export const metadata: Metadata = { title: "Hesabım" };

export default function AccountPage() {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <PageHeader title="Hesabım" eyebrow="Sistem" description="Bilgileriniz, giriş parolanız ve iki adımlı doğrulama." />
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
  const [security] = await getDb()
    .select({ totpEnabled: s.users.totpEnabled, recoveryCodes: s.users.recoveryCodes })
    .from(s.users)
    .where(eq(s.users.id, user.id))
    .limit(1);
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-col items-center px-5 pt-8 pb-6 text-center">
          <AccountAvatar name={user.name} />
          <p className="mt-4 max-w-full truncate text-lg leading-7 font-semibold tracking-tight text-ink">
            <span className="sr-only">Ad: </span>
            {user.name}
          </p>
          <p className="max-w-full truncate text-sm text-ink-mute">
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
        <CardHeader icon={<KeyRound />} title="Parola değiştir" description="En az 8 karakter. Değişince diğer cihazlardaki oturumlar kapanır." />
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>
      <Card>
        <TwoFactorCard enabled={Boolean(security?.totpEnabled)} recoveryLeft={security?.recoveryCodes?.length ?? 0} />
      </Card>
    </div>
  );
}
