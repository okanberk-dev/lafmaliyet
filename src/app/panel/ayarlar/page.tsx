import { asc, desc } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/misc";
import { dateTimeTR } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";

import { CategoriesEditor, SettingsForm, UsersEditor } from "./settings-client";

export const metadata: Metadata = { title: "Ayarlar" };

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Ayarlar" excel="Ayarlar" />
          <PageSkeleton rows={10} />
        </>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}

async function SettingsContent() {
  const me = await requireAdmin();
  const db = getDb();
  const [model, users, log] = await Promise.all([
    loadModel(),
    db.select({ id: s.users.id, name: s.users.name, email: s.users.email, role: s.users.role, active: s.users.active, lastLoginAt: s.users.lastLoginAt }).from(s.users).orderBy(asc(s.users.id)),
    db.select().from(s.activityLog).orderBy(desc(s.activityLog.at), desc(s.activityLog.id)).limit(60),
  ]);
  const productCount = new Map<number, number>();
  for (const p of model.ds.products) productCount.set(p.categoryId, (productCount.get(p.categoryId) ?? 0) + 1);

  return (
    <>
      <PageHeader
        title="Ayarlar"
        excel="Ayarlar"
        description="Buradaki değerleri değiştirdiğinizde bütün hesaplar (reçete maliyetleri, kârlılık, gelir-gider) otomatik güncellenir."
        actions={
          <ButtonLink href="/api/export" prefetch={false}>
            Tüm veriyi Excel&apos;e aktar
          </ButtonLink>
        }
      />
      <div className="space-y-6">
        <SettingsForm settings={model.settings} water={model.water} />
        <div className="grid gap-6 xl:grid-cols-2">
          <UsersEditor users={users.map((u) => ({ ...u, lastLoginAt: u.lastLoginAt ? dateTimeTR(u.lastLoginAt) : null }))} meId={me.id} />
          <CategoriesEditor categories={model.categories.map((c) => ({ id: c.id, name: c.name, count: productCount.get(c.id) ?? 0 }))} />
        </div>
        <Card>
          <CardHeader title="Son işlemler" description="Kim, ne zaman, neyi değiştirdi (son 60 kayıt)" />
          <CardContent className="max-h-[420px] overflow-y-auto p-0">
            <ul className="divide-y divide-coffee-50 text-sm">
              {log.map((l) => (
                <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-2">
                  <span className="w-36 shrink-0 text-xs text-coffee-500 tabular">{dateTimeTR(l.at)}</span>
                  <span className="w-28 shrink-0 font-medium text-coffee-800">{l.userName}</span>
                  <span className="font-medium">{l.action}</span>
                  <span className="min-w-0 flex-1 truncate text-coffee-600" title={l.detail ?? ""}>
                    {l.detail}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
