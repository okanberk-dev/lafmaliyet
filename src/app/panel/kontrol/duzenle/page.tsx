import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { requireAdmin } from "@/server/auth/dal";
import { loadChecklistTemplates } from "@/server/data/checklists";
import { photoStorage } from "@/server/storage/photos";

import { KontrolTabs } from "../tabs";
import { TemplatesClient } from "./templates-client";

export const metadata: Metadata = { title: "Listeleri düzenle" };

const DESCRIPTION =
  "Açılış, kapanış ve istediğiniz başka listeler. Maddeleri, saat aralığını ve fotoğraf isteyen maddeleri buradan değiştirin. Değişiklik, o gün başlamış bir listeye değil sonrakilere uygulanır.";

/** Listeleri düzenle (yalnız yönetici): listeler, etkin / pasif, yeni liste */
export default function ChecklistTemplatesPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader path="/panel/kontrol/duzenle" title="Listeleri düzenle" description={DESCRIPTION} />
          <PageSkeleton rows={4} />
        </>
      }
    >
      <TemplatesContent />
    </Suspense>
  );
}

async function TemplatesContent() {
  await requireAdmin();
  const templates = await loadChecklistTemplates();
  const storage = photoStorage();
  return (
    <>
      <PageHeader path="/panel/kontrol/duzenle" title="Listeleri düzenle" description={DESCRIPTION} tabs={<KontrolTabs current="/panel/kontrol/duzenle" role="admin" />} />
      {!storage.available ? (
        <Notice
          tone="neutral"
          className="mb-4"
          title="Fotoğraf deposu kurulmadı: fotoğraflı maddeler görünmez"
        >
          Depo bağlanana kadar fotoğraf isteyen maddeler listelerde görünmez.
        </Notice>
      ) : null}
      <TemplatesClient
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          opensAt: t.opensAt,
          dueAt: t.dueAt,
          weekdays: t.weekdays,
          staffAllowed: t.staffAllowed,
          active: t.active,
          items: t.items.length,
          photos: t.items.filter((i) => i.type === "photo").length,
          numbers: t.items.filter((i) => i.type === "number").length,
        }))}
      />
    </>
  );
}
