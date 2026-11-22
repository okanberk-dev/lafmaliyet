import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { ButtonLink } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/misc";
import { SegmentedLinks } from "@/components/ui/segmented";
import { addDays, todayTR } from "@/lib/reminders";
import { buildRows, canEditShifts, formatShiftCell, userRef, VARDIYA_PATH, weekLabel, weekParam, type ShiftRow } from "@/lib/vardiya";
import { requireUser } from "@/server/auth/dal";
import { currentPhysicalBranch, staffBranchLock } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { getDb } from "@/server/db";
import { loadShiftEntries, loadShiftWeek, shiftBranches } from "@/server/vardiya/store";

import { ShiftGrid, type GridRow } from "./shift-grid";

export const metadata: Metadata = { title: "Vardiya" };

/** Bir ekran bir ad: yönetici planı ayarlar, personel yalnız görür */
const TITLE = { admin: "Vardiya ayarlama", staff: "Vardiya" } as const;
const DESCRIPTION = {
  admin: "Haftanın vardiyalarını yazıp kaydedin; PDF'i kendiliğinden hazırlanır, plan sonradan düzenlenir.",
  staff: "Haftanın vardiya planı. PDF olarak açıp kaydedebilirsiniz.",
} as const;
const MORE =
  "Her kişi için günün kutusuna saatleri yazın (“10-18”, “18-02 bar”), izin için “izin”. Kaydet bütün haftayı yazar; PDF her açılışta kaydedilen plandan çizilir. Personel planı kendi ekranında görür. O gün vardiyası yazılan personel, karaoke rezervasyonlarının e-posta hatırlatmalarını alır.";

/**
 * Vardiya planı (docs/VARDIYA.md): hafta `?hafta=YYYY-AA-GG` (haftanın herhangi bir günü; yoksa bu hafta), şube panelin
 * seçicisinden (seçili fiziksel şube; "Tümü" ya da online kanal seçiliyken Tuzla; şubesine kilitli personelde kendi
 * şubesi). Yönetici ızgarayı düzenler; personel salt okunur görür.
 */
export default function VardiyaPage({ searchParams }: PageProps<"/panel/vardiya">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader path={VARDIYA_PATH} role="staff" title={TITLE.staff} description={DESCRIPTION.staff} />
          <PageSkeleton rows={8} />
        </>
      }
    >
      <VardiyaContent searchParams={searchParams} />
    </Suspense>
  );
}

const toGrid = (rows: readonly ShiftRow[]): GridRow[] => rows.map((r) => ({ ref: r.ref, userId: r.userId, name: r.name, texts: r.cells.map(formatShiftCell) }));

/** "Son değişiklik: Okan · 22 Kas 16:40" (Türkiye saati) */
function updatedLine(u: { by: string | null; at: string } | null): string | null {
  if (!u) return null;
  const at = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(new Date(u.at));
  return `Son değişiklik: ${[u.by, at].filter(Boolean).join(" · ")}`;
}

async function VardiyaContent({ searchParams }: { searchParams: PageProps<"/panel/vardiya">["searchParams"] }) {
  const user = await requireUser();
  const sp = await searchParams;
  const today = todayTR();
  const monday = weekParam(Array.isArray(sp.hafta) ? sp.hafta[0] : sp.hafta, today);
  const canEdit = canEditShifts(user.role);
  const [branch, branches, lock] = await Promise.all([currentPhysicalBranch(), listBranches(), staffBranchLock()]);
  const physical = shiftBranches(branches);
  const db = getDb();
  const prevMonday = addDays(monday, -7);
  const [week, previous] = await Promise.all([
    loadShiftWeek(db, branch, monday, { roster: canEdit, includeUserId: user.id }),
    // "Geçen haftayı kopyala" (yalnız yönetici)
    canEdit ? loadShiftEntries(db, branch.id, prevMonday) : Promise.resolve(null),
  ]);
  const thisWeek = weekParam(null, today);
  const href = (m: string, sube?: string) => `${VARDIYA_PATH}?hafta=${m}${sube ? `&sube=${encodeURIComponent(sube)}` : ""}`;
  return (
    <>
      <PageHeader
        path={VARDIYA_PATH}
        role={user.role}
        title={TITLE[user.role]}
        description={DESCRIPTION[user.role]}
        more={canEdit ? MORE : undefined}
        actions={
          <>
            <ButtonLink href={href(prevMonday)} variant="secondary" size="sm" aria-label={`Önceki hafta: ${weekLabel(prevMonday)}`}>
              <ChevronLeft size={15} aria-hidden="true" /> Önceki
            </ButtonLink>
            {monday !== thisWeek ? (
              <ButtonLink href={href(thisWeek)} variant="secondary" size="sm">
                Bu hafta
              </ButtonLink>
            ) : null}
            <ButtonLink href={href(addDays(monday, 7))} variant="secondary" size="sm" aria-label={`Sonraki hafta: ${weekLabel(addDays(monday, 7))}`}>
              Sonraki <ChevronRight size={15} aria-hidden="true" />
            </ButtonLink>
          </>
        }
      />
      <div className="space-y-4">
        {/* Birden çok şube açıkken hangi şubenin planı: seçim panelin şube seçicisine yazılır (?sube= benimsenir).
            Şubesine kilitli personelde seçici yok */}
        {physical.length > 1 && !lock ? (
          <SegmentedLinks label="Şube" value={branch.id} options={physical.map((b) => ({ value: b.id, label: b.name, href: href(monday, b.id) }))} />
        ) : null}
        <ShiftGrid
          branch={week.branch}
          monday={monday}
          today={today}
          canEdit={canEdit}
          meRef={userRef(user.id)}
          rows={toGrid(week.rows)}
          others={week.others}
          previous={previous ? toGrid(buildRows(prevMonday, [], previous.entries)) : null}
          stamp={`${week.branch.id}:${monday}:${week.updated?.at ?? "bos"}:${week.rows.length}:${week.rows.reduce((n, r) => n + r.cells.filter(Boolean).length, 0)}`}
          updatedText={updatedLine(week.updated)}
        />
      </div>
    </>
  );
}
