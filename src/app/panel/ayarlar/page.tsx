import { desc } from "drizzle-orm";
import { Download, HardDriveDownload } from "lucide-react";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { dateTimeTR } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";

import { SettingsNav } from "./section-nav";
import { SECTION_SCROLL_MARGIN, SETTINGS_SECTIONS } from "./sections";
import { ActivityLog, CategoriesEditor, SettingsForm } from "./settings-client";

export const metadata: Metadata = { title: "Ayarlar" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Ayarlar"
        eyebrow="Sistem"
        excel="Ayarlar"
        description="Buradaki değerleri değiştirdiğinizde bütün hesaplar (reçete maliyetleri, kârlılık, gelir-gider) otomatik güncellenir."
      />
      <Suspense fallback={<SettingsSkeleton />}>
        <SettingsContent />
      </Suspense>
    </>
  );
}

/**
 * Geniş ekranda solda bölüm gezinmesi, sağda kartlar; daha dar ekranda gezinme üstte şerit olur.
 * Kaydedilmemiş değişiklik varken (form `data-dirty`) alttaki yüzen kaydet çubuğu son kartı örtmesin diye boşluk bırakılır.
 */
function SettingsLayout({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  return (
    <div className="xl:grid xl:grid-cols-[13.5rem_minmax(0,1fr)] xl:gap-8">
      {nav}
      <div className="@container min-w-0 space-y-4 has-[[data-dirty]]:pb-28">{children}</div>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <SettingsLayout
      nav={
        <>
          <div className="mb-4 flex gap-1 overflow-hidden xl:hidden">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-28 shrink-0" />
            ))}
          </div>
          <div className="hidden space-y-2 rounded-3xl bg-panel p-3 xl:block" aria-hidden="true">
            {SETTINGS_SECTIONS.map((sec) => (
              <div key={sec.id} className="h-11 animate-pulse rounded-lg bg-surface/70" />
            ))}
          </div>
        </>
      }
    >
      <div className="space-y-4" aria-busy="true" aria-label="Yükleniyor">
        <Skeleton className="h-64 rounded-3xl" />
        <Skeleton className="h-72 rounded-3xl" />
        <Skeleton className="h-56 rounded-3xl" />
        <Skeleton className="h-72 rounded-3xl" />
      </div>
    </SettingsLayout>
  );
}

/** Yedek: bütün veriyi Excel dosyası olarak indirir (/api/export, yalnızca yönetici) */
function BackupCard() {
  return (
    <Card id="yedek" className={SECTION_SCROLL_MARGIN}>
      <CardHeader
        icon={<HardDriveDownload />}
        title="Yedek"
        description="Özet, ürün kârlılığı, reçete kartları, hammaddeler, faturalar, sabit giderler, personel ve ayarlar tek bir Excel dosyasına iner."
        actionsClassName="max-sm:w-full"
        actions={
          <ButtonLink href="/api/export" prefetch={false} variant="secondary" className="max-sm:w-full">
            <Download size={16} /> Tüm veriyi Excel&apos;e aktar
          </ButtonLink>
        }
      />
    </Card>
  );
}

async function SettingsContent() {
  await requireAdmin();
  const db = getDb();
  const [model, log] = await Promise.all([
    loadModel(),
    db.select().from(s.activityLog).orderBy(desc(s.activityLog.at), desc(s.activityLog.id)).limit(60),
  ]);
  const productCount = new Map<number, number>();
  for (const p of model.ds.products) productCount.set(p.categoryId, (productCount.get(p.categoryId) ?? 0) + 1);

  return (
    <SettingsLayout nav={<SettingsNav />}>
      <SettingsForm settings={model.settings} water={model.water} />
      <div className="grid gap-4 @5xl:grid-cols-2">
        <CategoriesEditor categories={model.categories.map((c) => ({ id: c.id, name: c.name, count: productCount.get(c.id) ?? 0 }))} />
        <ActivityLog entries={log.map((l) => ({ id: l.id, at: dateTimeTR(l.at), userName: l.userName, action: l.action, detail: l.detail }))} />
      </div>
      <BackupCard />
    </SettingsLayout>
  );
}
