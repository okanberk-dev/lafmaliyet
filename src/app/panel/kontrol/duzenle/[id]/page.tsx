import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { ButtonLink } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/misc";
import { listTitle, weekdaysText } from "@/lib/checklists";
import { requireAdmin } from "@/server/auth/dal";
import { loadChecklistTemplate } from "@/server/data/checklists";
import { photoStorage } from "@/server/storage/photos";

import { TemplateEditor } from "./template-editor";

export const metadata: Metadata = { title: "Listeyi düzenle" };

/** Bir listenin sayfası (yalnız yönetici): adı, saatleri, günleri; maddeleri (ekle, düzenle, taşı, kaldır, geri ekle) */
export default function ChecklistTemplatePage({ params }: PageProps<"/panel/kontrol/duzenle/[id]">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader eyebrow="Listeleri düzenle" title="Liste" description="Yükleniyor…" />
          <PageSkeleton rows={6} />
        </>
      }
    >
      <EditorContent params={params} />
    </Suspense>
  );
}

async function EditorContent({ params }: { params: PageProps<"/panel/kontrol/duzenle/[id]">["params"] }) {
  await requireAdmin();
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id) || Number(id) <= 0) notFound();
  const t = await loadChecklistTemplate(Number(id));
  if (!t) notFound();
  const photos = photoStorage().available;
  return (
    <>
      <PageHeader
        eyebrow="Listeleri düzenle"
        title={listTitle(t.name)}
        description={`${weekdaysText(t.weekdays)} · ${t.opensAt} – ${t.dueAt}${t.active ? "" : " · pasif"}`}
        actions={
          <ButtonLink href="/panel/kontrol/duzenle" variant="ghost" size="sm">
            <ArrowLeft size={14} aria-hidden="true" /> Listeler
          </ButtonLink>
        }
      />
      {!photos ? (
        <p role="note" className="mb-4 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info">
          Fotoğraf deposu bu ortamda kurulu değil: fotoğraflı maddeler depo bağlanana kadar listede görünmez.
        </p>
      ) : null}
      <TemplateEditor key={t.id} template={t} />
    </>
  );
}
