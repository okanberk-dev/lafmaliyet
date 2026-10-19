import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { ROLES } from "@/lib/constants";
import { requireUser } from "@/server/auth/dal";

import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Hesabım" };

export default function AccountPage() {
  return (
    <>
      <PageHeader title="Hesabım" />
      <Suspense fallback={<Skeleton className="h-64 max-w-xl" />}>
        <Account />
      </Suspense>
    </>
  );
}

async function Account() {
  const user = await requireUser();
  return (
    <div className="grid max-w-3xl gap-6 md:grid-cols-2">
      <Card>
        <CardHeader title="Bilgilerim" />
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="text-coffee-500">Ad:</span> {user.name}
          </p>
          <p>
            <span className="text-coffee-500">E-posta:</span> {user.email}
          </p>
          <p>
            <span className="text-coffee-500">Rol:</span> {ROLES[user.role]}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader title="Parola değiştir" />
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
