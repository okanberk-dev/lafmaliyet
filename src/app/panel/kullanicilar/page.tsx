import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Skeleton } from "@/components/ui/misc";
import { dateTimeTR } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";

import { RolesCard, UsersEditor } from "./users-client";

export const metadata: Metadata = { title: "Kullanıcılar & roller" };

export default function UsersPage() {
  return (
    <>
      <PageHeader
        title="Kullanıcılar & roller"
        eyebrow="Ayarlar"
        description="Panele kimlerin gireceğini ve neleri göreceğini belirleyin. İki adımlı doğrulamayı her kullanıcı kendisi açar."
      />
      <Suspense
        fallback={
          <div aria-busy="true" aria-label="Yükleniyor" className="space-y-4">
            <Skeleton className="h-[360px] rounded-3xl" />
            <Skeleton className="h-[420px] rounded-3xl" />
          </div>
        }
      >
        <UsersContent />
      </Suspense>
    </>
  );
}

async function UsersContent() {
  const me = await requireAdmin();
  const rows = await getDb()
    .select({
      id: s.users.id,
      name: s.users.name,
      email: s.users.email,
      role: s.users.role,
      active: s.users.active,
      lastLoginAt: s.users.lastLoginAt,
      totpEnabled: s.users.totpEnabled,
      lockedUntil: s.users.lockedUntil,
    })
    .from(s.users)
    .orderBy(asc(s.users.id));
  const now = new Date();
  return (
    <div className="space-y-4">
      <UsersEditor
        meId={me.id}
        users={rows.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          active: u.active,
          lastLoginAt: u.lastLoginAt ? dateTimeTR(u.lastLoginAt) : null,
          twoFactor: u.totpEnabled,
          locked: Boolean(u.lockedUntil && u.lockedUntil > now),
        }))}
      />
      <RolesCard />
    </div>
  );
}
