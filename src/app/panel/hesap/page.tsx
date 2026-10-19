import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { ROLES } from "@/lib/constants";
import { requireUser } from "@/server/auth/dal";

import { AccountAvatar, PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Hesabım" };

export default function AccountPage() {
  return (
    <div className="mx-auto w-full max-w-lg">
      <PageHeader title="Hesabım" eyebrow="Sistem" description="Bilgileriniz ve giriş parolanız." />
      <Suspense fallback={<AccountSkeleton />}>
        <Account />
      </Suspense>
    </div>
  );
}

function AccountSkeleton() {
  return (
    <div aria-busy="true" aria-label="Yükleniyor">
      <Skeleton className="h-[560px] rounded-3xl" />
    </div>
  );
}

async function Account() {
  const user = await requireUser();
  return (
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
        <CardHeader icon={<KeyRound />} title="Parola değiştir" description="Yeni parola en az 8 karakter olmalı." />
        <CardContent>
          <PasswordForm />
        </CardContent>
      </div>
    </Card>
  );
}
