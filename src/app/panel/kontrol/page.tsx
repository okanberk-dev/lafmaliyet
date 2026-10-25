import { ListChecks } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageSkeleton } from "@/components/ui/misc";
import { absentReason, checklistBoundaries, checklistDay } from "@/lib/checklists";
import { requireUser } from "@/server/auth/dal";
import { loadChecklistDay, loadChecklistTemplates } from "@/server/data/checklists";

import { nextRefreshAt } from "../bugun/logic";
import { TodayRefresh } from "../bugun/today-refresh";
import { ListCard } from "./list-card";
import { todayState } from "./status";
import { KontrolTabs } from "./tabs";

export const metadata: Metadata = { title: "Kontrol listeleri" };

const TITLE = "Kontrol listeleri";
const DESCRIPTION = "Açılışta ve kapanışta maddeleri tek tek işaretleyin; sıcaklığı yazın, istenen yerde fotoğraf çekin. Her madde dokunduğunuz an kaydedilir.";

/**
 * Kontrol listeleri: bugünün (iş günü, 05:00'te döner) açılış / kapanış listeleri, açılış saatine göre (docs/KONTROL-LISTELERI.md).
 * İki rol de açar; personel yalnız "Personel doldurabilir" listeleri görür. Yöneticiye sekmeler (Geçmiş, Listeler) ve
 * bugün olmayan listeler satırı. Liste saatlerinde ve sekmeye geri dönülünce ekran kendiliğinden yenilenir.
 */
export default function ChecklistsPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader eyebrow="Günlük" title={TITLE} description={DESCRIPTION} />
          <PageSkeleton rows={4} />
        </>
      }
    >
      <ChecklistsContent />
    </Suspense>
  );
}

async function ChecklistsContent() {
  const user = await requireUser();
  const admin = user.role === "admin";
  const now = new Date();
  const day = checklistDay(now);
  const [lists, templates] = await Promise.all([loadChecklistDay(day, user.role, now), admin ? loadChecklistTemplates() : Promise.resolve([])]);
  const states = lists.map((l) => todayState(l, now));
  // Sıradaki: önce geciken, yoksa açık olan ilk liste
  const nextIndex = states.indexOf("overdue") >= 0 ? states.indexOf("overdue") : states.indexOf("open");
  const shown = new Set(lists.map((l) => l.templateId));
  const absent = templates.flatMap((t) => {
    const why = shown.has(t.id) ? null : absentReason(t, day);
    return why ? [`${t.name} (${why})`] : [];
  });
  return (
    <>
      <PageHeader eyebrow="Günlük" title={TITLE} description={DESCRIPTION} tabs={<KontrolTabs current="/panel/kontrol" role={user.role} />} />
      <TodayRefresh at={nextRefreshAt(now, checklistBoundaries({ day, lists }))} renderedAt={now.toISOString()} />
      {lists.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {lists.map((l, i) => (
            <ListCard key={l.templateId} list={l} state={states[i]} next={i === nextIndex} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<ListChecks />}
          title="Bugün için kontrol listesi yok"
          description={admin ? "Listeleri düzenle ekranından açılış ve kapanış listelerini açın." : "Yönetici bir liste açınca burada görünür."}
          action={
            admin ? (
              <ButtonLink href="/panel/kontrol/duzenle" variant="primary">
                Listeleri düzenle
              </ButtonLink>
            ) : undefined
          }
        />
      )}
      {admin && absent.length ? <p className="mt-4 text-[13px] text-ink-mute">Bugün olmayan listeler: {absent.join(" · ")}</p> : null}
    </>
  );
}
