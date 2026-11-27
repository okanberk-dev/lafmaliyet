import { ListChecks } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageSkeleton } from "@/components/ui/misc";
import { absentReason, checklistBoundaries, checklistDay, checklistKey, listTitle } from "@/lib/checklists";
import { addDays, clockSuffixTR } from "@/lib/reminders";
import { adminActor } from "@/lib/roles";
import { requireCan } from "@/server/auth/dal";
import { loadChecklistDay, loadChecklistTemplates } from "@/server/data/checklists";

import { nextRefreshAt } from "../bugun/logic";
import { TodayRefresh } from "../bugun/today-refresh";
import { ListCard } from "./list-card";
import { todayState } from "./status";
import { KontrolTabs } from "./tabs";

export const metadata: Metadata = { title: "Kontrol listeleri" };

const TITLE = "Kontrol listeleri";
const DESCRIPTION = "Açılış ve kapanışta maddeleri işaretleyin; her dokunuş hemen kaydedilir.";

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
          <PageHeader path="/panel/kontrol" role="staff" title={TITLE} description={DESCRIPTION} />
          <PageSkeleton rows={4} />
        </>
      }
    >
      <ChecklistsContent />
    </Suspense>
  );
}

async function ChecklistsContent() {
  const user = adminActor(await requireCan("kayit.yaz"));
  const admin = user.role === "admin";
  const now = new Date();
  const day = checklistDay(now);
  const [lists, templates] = await Promise.all([loadChecklistDay(day, user.role, now), admin ? loadChecklistTemplates({ scoped: true }) : Promise.resolve([])]);
  // Bugün liste yoksa yarının ilk listesi (rolün gördükleri; saat şablondan): boş durum ne zaman başlayacağını söyler
  const tomorrow = lists.length ? null : ((await loadChecklistDay(addDays(day, 1), user.role, now))[0] ?? null);
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
      <PageHeader path="/panel/kontrol" role={user.role} title={TITLE} description={DESCRIPTION} tabs={<KontrolTabs current="/panel/kontrol" role={user.role} />} />
      <TodayRefresh at={nextRefreshAt(now, checklistBoundaries({ day, lists }))} renderedAt={now.toISOString()} />
      {lists.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {lists.map((l, i) => (
            <ListCard key={checklistKey(l)} list={l} state={states[i]} next={i === nextIndex} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<ListChecks />}
          title="Bugün açık liste yok"
          description={
            tomorrow
              ? `${listTitle(tomorrow.name)} yarın ${clockSuffixTR(tomorrow.opensAt)} başlar.`
              : admin
                ? "Listeleri düzenle ekranından açılış ve kapanış listelerini açın."
                : "Yönetici bir liste açınca burada görünür."
          }
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
