import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageSkeleton } from "@/components/ui/misc";
import { ANSWER_GRACE_MIN, checklistDay, clockInstant, listTitle, nowBusinessMinute } from "@/lib/checklists";
import { addDays, longDateTR } from "@/lib/reminders";
import { requireUser } from "@/server/auth/dal";
import { loadRunView } from "@/server/data/checklists";
import { photoStorage } from "@/server/storage/photos";

import { TodayRefresh } from "../../bugun/today-refresh";
import { RunForm } from "./run-form";

export const metadata: Metadata = { title: "Kontrol listesi" };

/**
 * Bir listeyi doldurma (telefonda): bugünün (iş günü) kaydı, maddeler bölüm bölüm; her yanıt dokunulduğu an kaydedilir
 * (docs/KONTROL-LISTELERI.md). İki rol de açar; personel yalnız "Personel doldurabilir" listeyi. Gece 05:00–05:30
 * arasında dünün yarım kalan kaydı açılır: başlamış liste o yarım saatte bitirilebilir.
 */
export default function ChecklistRunPage({ params }: PageProps<"/panel/kontrol/[id]">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader eyebrow="Kontrol listesi" title="Kontrol listesi" description="Yükleniyor…" />
          <PageSkeleton rows={6} />
        </>
      }
    >
      <RunContent params={params} />
    </Suspense>
  );
}

const ADMIN_HINT: Record<string, string> = {
  "Bu liste kapalı.": "Listeyi Listeleri düzenle ekranından açabilirsiniz.",
  "Bu listede madde yok.": "Maddeleri Listeleri düzenle ekranından ekleyin.",
};

async function RunContent({ params }: { params: PageProps<"/panel/kontrol/[id]">["params"] }) {
  const user = await requireUser();
  const admin = user.role === "admin";
  const { id } = await params;
  const tid = Number(id);
  if (!/^\d{1,9}$/.test(id) || tid <= 0) notFound();
  const now = new Date();
  const today = checklistDay(now);
  let view = await loadRunView(tid, today, now);
  if (!view) notFound();
  if (!admin && !view.template.staffAllowed) redirect("/panel/kontrol");
  // 05:00–05:30: dünün başlamış ama bitmemiş kaydı hâlâ bitirilebilir (lib/checklists.ts canAnswerDay)
  if (nowBusinessMinute(now) < ANSWER_GRACE_MIN && !view.run) {
    const yesterday = await loadRunView(tid, addDays(today, -1), now);
    if (yesterday?.run && !yesterday.summary.complete && yesterday.summary.lastAt) view = yesterday;
  }
  const grace = view.day !== today;
  const title = listTitle(view.name);
  const header = <PageHeader eyebrow="Kontrol listesi" title={title} description={`${longDateTR(view.day)} · ${view.opensAt} – ${view.dueAt}`} />;
  const back = (
    <ButtonLink href="/panel/kontrol" variant="ghost" size="sm">
      <ArrowLeft size={14} aria-hidden="true" /> Kontrol listeleri
    </ButtonLink>
  );

  if (view.refusal) {
    const hint =
      view.refusal === "Bu liste bugün yok."
        ? view.absent === "yarından"
          ? "Liste bugünün saat aralığı açıldıktan sonra eklendi ya da açıldı; yarından itibaren doldurulur."
          : admin
            ? "Günleri Listeleri düzenle ekranından değiştirebilirsiniz."
            : undefined
        : admin
          ? ADMIN_HINT[view.refusal]
          : undefined;
    return (
      <>
        {header}
        <EmptyState title={view.refusal} description={hint} action={back} />
      </>
    );
  }

  return (
    <>
      {header}
      {/* Gece 05:30'da (yeni gün, dünün yarım listesinin süresi biter), sekmeye uzun aradan sonra ve geri tuşuyla dönülünce yenilenir */}
      <TodayRefresh at={clockInstant(addDays(view.day, 1), "05:30").getTime()} renderedAt={now.toISOString()} />
      {view.template.description ? <p className="-mt-3 mb-5 max-w-3xl text-sm leading-6 text-ink-mute">{view.template.description}</p> : null}
      {grace ? (
        <p role="note" className="mb-4 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
          Dünün listesi: yeni gün 05:00&apos;te başladı, başlanmış liste 05:30&apos;a kadar bitirilebilir.
        </p>
      ) : null}
      <RunForm
        key={`${tid}:${view.day}`}
        templateId={tid}
        day={view.day}
        title={title}
        items={view.items}
        answers={view.answers}
        completedAt={view.run?.completedAt ?? null}
        renderedAt={now.toISOString()}
        photos={photoStorage().available}
        me={user.name}
      />
    </>
  );
}
