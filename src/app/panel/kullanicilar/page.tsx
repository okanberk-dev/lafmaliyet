import { and, asc, gt, isNull, lt } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Skeleton } from "@/components/ui/misc";
import { dateTimeTR } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { appUrl, isPendingInvite, MAX_TOKEN_ATTEMPTS } from "@/server/auth/tokens";
import { getDb, schema as s } from "@/server/db";
import { isEmailConfigured } from "@/server/notify/resend";

import { RolesCard, UsersEditor } from "./users-client";

export const metadata: Metadata = { title: "Kullanıcılar & roller" };

export default function UsersPage() {
  return (
    <>
      <PageHeader
        title="Kullanıcılar & roller"
        path="/panel/kullanicilar"
        description="Panele kim girer, neyi görür: kullanıcı ekleyin ya da davet gönderin."
        more="Panele kimlerin gireceğini ve neleri göreceğini belirleyin. Kullanıcı ekleyip parolasını siz verebilir ya da davet bağlantısı gönderebilirsiniz; iki adımlı doğrulamayı her kullanıcı kendisi açar."
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
  const db = getDb();
  const now = new Date();
  const [rows, links, deviceLocks] = await Promise.all([
    db
      .select({
        id: s.users.id,
        name: s.users.name,
        email: s.users.email,
        role: s.users.role,
        active: s.users.active,
        lastLoginAt: s.users.lastLoginAt,
        totpEnabled: s.users.totpEnabled,
        lockedUntil: s.users.lockedUntil,
        passwordHash: s.users.passwordHash,
      })
      .from(s.users)
      .orderBy(asc(s.users.id)),
    // Kullanılmamış, süresi geçmemiş, deneme sınırına takılmamış bağlantılar (kişi başına en çok bir tane: yenisi
    // eskisinin süresini bitirir)
    db
      .select({ userId: s.userTokens.userId, kind: s.userTokens.kind, until: s.userTokens.expiresAt })
      .from(s.userTokens)
      .where(and(isNull(s.userTokens.usedAt), gt(s.userTokens.expiresAt, now), lt(s.userTokens.attempts, MAX_TOKEN_ATTEMPTS)))
      .orderBy(asc(s.userTokens.expiresAt)),
    // Bilinen bir cihazın süren kilidi (o tarayıcıdan 10 hatalı deneme): hesap kilidi değil ama kişi o cihazdan giremez,
    // Kilidi aç onu da siler (YO-03)
    db
      .selectDistinct({ userId: s.loginDeviceLocks.userId })
      .from(s.loginDeviceLocks)
      .where(gt(s.loginDeviceLocks.lockedUntil, now)),
  ]);
  const live = new Map(links.map((l) => [l.userId, { kind: l.kind, until: dateTimeTR(l.until) }]));
  const deviceLocked = new Set(deviceLocks.map((l) => l.userId));
  return (
    <div className="space-y-4">
      <UsersEditor
        meId={me.id}
        emailConfigured={isEmailConfigured()}
        loginUrl={`${appUrl()}/giris`}
        users={rows.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          active: u.active,
          lastLoginAt: u.lastLoginAt ? dateTimeTR(u.lastLoginAt) : null,
          twoFactor: u.totpEnabled,
          locked: u.lockedUntil && u.lockedUntil > now ? "account" : deviceLocked.has(u.id) ? "device" : null,
          invite: isPendingInvite(u.passwordHash) ? (live.has(u.id) ? "pending" : "expired") : "none",
          liveLink: live.get(u.id) ?? null,
        }))}
      />
      <RolesCard />
    </div>
  );
}
