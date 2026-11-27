import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageSkeleton } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { BRANCH_PARAM, tillBranches } from "@/lib/branches";
import { ANSWER_GRACE_MIN, branchLockAllows, checklistDay, checklistHref, clockInstant, listTitle, nowBusinessMinute, RUN_BRANCH_QUESTION, sharedListName } from "@/lib/checklists";
import { addDays, longDateTR } from "@/lib/reminders";
import { adminActor } from "@/lib/roles";
import { requireCan } from "@/server/auth/dal";
import { staffBranchLock } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { checklistRunBranch, loadRunView } from "@/server/data/checklists";
import { photoStorage } from "@/server/storage/photos";

import { TodayRefresh } from "../../bugun/today-refresh";
import { RunForm } from "./run-form";

export const metadata: Metadata = { title: "Kontrol listesi" };

/**
 * Bir listeyi doldurma (telefonda): bugünün (iş günü) kaydı, maddeler bölüm bölüm; her yanıt dokunulduğu an kaydedilir
 * (docs/KONTROL-LISTELERI.md). İki rol de açar; personel yalnız "Personel doldurabilir" listeyi, şubesine kilitliyse
 * yalnız kendi şubesinin ve bütün şubelerin listesini (adresle başka şubenin listesi açılmaz). Gece 05:00–05:30
 * arasında dünün yarım kalan kaydı açılır: başlamış liste o yarım saatte bitirilebilir. Bütün şubelerin listesi şubenin
 * kendi kaydıdır (şube ayrımı): seçili fiziksel şube, kilitli personelin şubesi ya da Bugün'ün şube satırının `?sube=`'si;
 * "Tümü"de birden çok şube açıkken önce "Hangi şubenin listesi?" sorulur.
 */
export default function ChecklistRunPage({ params, searchParams }: PageProps<"/panel/kontrol/[id]">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader path="/panel/kontrol" role="staff" title="Kontrol listesi" description="Yükleniyor…" />
          <PageSkeleton rows={6} />
        </>
      }
    >
      <RunContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const ADMIN_HINT: Record<string, string> = {
  "Bu liste kapalı.": "Listeyi Listeleri düzenle ekranından açabilirsiniz.",
  "Bu listede madde yok.": "Maddeleri Listeleri düzenle ekranından ekleyin.",
};

async function RunContent({ params, searchParams }: { params: PageProps<"/panel/kontrol/[id]">["params"]; searchParams: PageProps<"/panel/kontrol/[id]">["searchParams"] }) {
  const user = adminActor(await requireCan("kayit.yaz"));
  const admin = user.role === "admin";
  const { id } = await params;
  const tid = Number(id);
  if (!/^\d{1,9}$/.test(id) || tid <= 0) notFound();
  const sube = (await searchParams)[BRANCH_PARAM];
  const now = new Date();
  const today = checklistDay(now);
  // Bütün şubelerin listesinde kaydın şubesi (şubeli listede yok sayılır; kayıt listenin şubesinde)
  const [runBranch, lock, branches] = await Promise.all([checklistRunBranch(typeof sube === "string" ? sube : null), admin ? null : staffBranchLock(), listBranches()]);
  const first = await loadRunView(tid, today, now, runBranch);
  let view = first;
  if (!view) notFound();
  if (!admin && !view.template.staffAllowed) redirect("/panel/kontrol");
  // Şubesine kilitli personel başka şubenin listesini açmaz (docs/KONTROL-LISTELERI.md › Şubeler; yazım da reddeder)
  if (!admin && !branchLockAllows(view.template.branchId, lock)) redirect("/panel/kontrol");
  const physical = tillBranches(branches);
  const shared = view.template.branchId === null;
  // "Tümü"de birden çok fiziksel şube açıkken bütün şubelerin listesi: önce şube (kayıt şube başına; sessizce Tuzla'ya inmez)
  if (view.branchId === null) {
    return (
      <>
        <PageHeader path="/panel/kontrol" role={user.role} title={listTitle(view.name)} description={RUN_BRANCH_QUESTION} />
        <EmptyState
          title={RUN_BRANCH_QUESTION}
          description="Bu liste bütün şubelerin; her şube kendi listesini doldurur. Şubeyi seçin."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {physical.map((b) => (
                <ButtonLink key={b.id} href={checklistHref({ templateId: tid, branchId: b.id, shared: true })} variant="secondary">
                  {b.name}
                </ButtonLink>
              ))}
            </div>
          }
        />
      </>
    );
  }
  const chosen = view.branchId;
  // 05:00–05:30: dünün başlamış ama bitmemiş kaydı hâlâ bitirilebilir (lib/checklists.ts canAnswerDay)
  if (nowBusinessMinute(now) < ANSWER_GRACE_MIN && !view.run) {
    const yesterday = await loadRunView(tid, addDays(today, -1), now, chosen);
    if (yesterday?.run && !yesterday.summary.complete && yesterday.summary.lastAt) view = yesterday;
  }
  const grace = view.day !== today;
  // Bütün şubelerin listesi birden çok şube açıkken şubenin adıyla ("Marina · Açılış listesi")
  const branchName = shared && physical.length > 1 ? (physical.find((b) => b.id === chosen)?.name ?? chosen) : null;
  const title = listTitle(sharedListName(view.name, branchName));
  const header = <PageHeader path="/panel/kontrol" role={user.role} title={title} description={`${longDateTR(view.day)} · ${view.opensAt} – ${view.dueAt}`} />;
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
        <Notice tone="warn" className="mb-4" title="Dünün listesi: 05:30'a kadar bitirilebilir" text="Yeni gün 05:00'te başladı." />
      ) : null}
      <RunForm
        key={`${tid}:${view.day}:${chosen}`}
        templateId={tid}
        branch={shared ? chosen : null}
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
