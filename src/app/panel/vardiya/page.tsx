import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { BranchChooser } from "@/components/panel/branch-chooser";
import { PageHeader } from "@/components/panel/page-header";
import { ButtonLink } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/misc";
import { SegmentedLinks } from "@/components/ui/segmented";
import { addDays, todayTR } from "@/lib/reminders";
import { buildRows, canEditShifts, formatShiftCell, userRef, VARDIYA_PATH, weekLabel, weekParam, type ShiftRow } from "@/lib/vardiya";
import { requireUser } from "@/server/auth/dal";
import { currentBranchScope, currentPhysicalBranch, staffBranchLock } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { getDb } from "@/server/db";
import { shiftDraftState } from "@/server/vardiya/draft";
import { loadShiftPresets } from "@/server/vardiya/presets";
import { loadShiftEntries, loadShiftWeek, shiftBranches } from "@/server/vardiya/store";

import { ShiftGrid, type GridRow } from "./shift-grid";

export const metadata: Metadata = { title: "Vardiya" };
// "Yazarak doldur" bu sayfanın sunucu eylemiyle çalışır (istek en çok 45 sn bekler; src/server/ai/run.ts AI_TIMEOUTS)
export const maxDuration = 60;

/** Bir ekran bir ad: yönetici planı ayarlar, personel yalnız görür */
const TITLE = { admin: "Vardiya ayarlama", staff: "Vardiya" } as const;
const DESCRIPTION = {
  admin: "Haftanın vardiyalarını yazıp kaydedin; PDF'i kendiliğinden hazırlanır, plan sonradan düzenlenir.",
  staff: "Haftanın vardiya planı. PDF olarak açıp kaydedebilirsiniz.",
} as const;
const MORE =
  "Her kişi için günün kutusuna saatleri yazın (“10-18”, “18-02 bar”), izin için “izin”. “Yazarak doldur”a haftayı düz cümleyle yazınca kutular taslak olarak dolar; yazdığınız metin ve listedeki adlar bunun için Claude'a (Anthropic) gönderilir. Kaydet bütün haftayı yazar; PDF her açılışta kaydedilen plandan çizilir. Personel planı kendi ekranında görür. O gün vardiyası yazılan personel, karaoke rezervasyonlarının e-posta hatırlatmalarını alır.";

/**
 * Vardiya planı (docs/VARDIYA.md): hafta `?hafta=YYYY-AA-GG` (haftanın herhangi bir günü; yoksa bu hafta), şube panelin
 * seçicisinden (seçili fiziksel şube; şubesine kilitli personelde kendi şubesi). "Tümü" ya da online kanal seçiliyken
 * birden çok şube açıksa önce "Hangi şubenin vardiyası?" sorulur; tek şube açıksa o şube. Yönetici ızgarayı düzenler;
 * personel salt okunur görür.
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
  const hafta = Array.isArray(sp.hafta) ? sp.hafta[0] : sp.hafta;
  const monday = weekParam(hafta, today);
  const canEdit = canEditShifts(user.role);
  const [scope, branches, lock] = await Promise.all([currentBranchScope(), listBranches(), staffBranchLock()]);
  const physical = shiftBranches(branches);
  // "Tümü" ya da online kanal seçiliyken birden çok şube açıksa plan çizilmeden önce şube sorulur (kasa ve sayımla aynı
  // kural; docs/VARDIYA.md › Ekran): plan şube başına yazılır, önceden sessizce Tuzla'nın planı açılıyor ve Kaydet
  // Tuzla'ya yazıyordu. Şubesine kilitli personelin seçimi zaten kendi şubesidir
  if (physical.length > 1 && !physical.some((b) => b.id === scope)) {
    return (
      <>
        <PageHeader path={VARDIYA_PATH} role={user.role} title={TITLE[user.role]} description={DESCRIPTION[user.role]} more={canEdit ? MORE : undefined} />
        <BranchChooser
          title="Hangi şubenin vardiyası?"
          description={canEdit ? "Vardiya planı şube başına yazılır. Şubeyi seçin; plan o şubeyle açılır, Kaydet o şubeye yazar." : "Vardiya planı şube başına. Şubeyi seçin; o şubenin planı açılır."}
          path={VARDIYA_PATH}
          params={{ hafta: hafta ? monday : undefined }}
          branches={physical}
        />
      </>
    );
  }
  const branch = await currentPhysicalBranch();
  const db = getDb();
  const prevMonday = addDays(monday, -7);
  const [week, previous, draft, presets] = await Promise.all([
    loadShiftWeek(db, branch, monday, { roster: canEdit, includeUserId: user.id }),
    // "Geçen haftayı kopyala" (yalnız yönetici)
    canEdit ? loadShiftEntries(db, branch.id, prevMonday) : Promise.resolve(null),
    // "Yazarak doldur" kullanılabilir mi (yalnız yönetici; anahtarın kendisi sayfaya gelmez)
    canEdit ? shiftDraftState() : Promise.resolve(null),
    // Sabahçı ve akşamcının saatleri: şubenin ayarı (Şube ayarları › Hazır vardiyalar), yoksa bugünkü sabit saatler
    loadShiftPresets(branch.id, db),
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
        {/* Şube değişince ızgara baştan kurulur (doldurma biçimi şubenin hazır vardiyasına göre açılır) */}
        <ShiftGrid
          key={week.branch.id}
          branch={week.branch}
          presets={presets}
          monday={monday}
          today={today}
          canEdit={canEdit}
          meRef={userRef(user.id)}
          rows={toGrid(week.rows)}
          others={week.others}
          previous={previous ? toGrid(buildRows(prevMonday, [], previous.entries)) : null}
          stamp={`${week.branch.id}:${monday}:${week.updated?.at ?? "bos"}:${week.rows.length}:${week.rows.reduce((n, r) => n + r.cells.filter(Boolean).length, 0)}`}
          updatedText={updatedLine(week.updated)}
          draftState={draft}
        />
      </div>
    </>
  );
}
