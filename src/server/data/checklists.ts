import "server-only";

import { eq } from "drizzle-orm";

import { ALL_BRANCHES, type BranchScope, pickFormBranch, tillBranches } from "@/lib/branches";
import { businessDate } from "@/lib/cash-report";
import { adminActor, adminLevel, can } from "@/lib/roles";
import { kontrolDigestBox, photoAccess, rangeText, valueText, whoText } from "@/lib/checklists";
import { closedDayDigestLists } from "@/lib/closed-days";
import { KEEP_DAYS } from "@/lib/photo-rules";
import { addDays, longDateTR } from "@/lib/reminders";
import { logActivity } from "@/server/actions/log";
import type { CurrentUser } from "@/server/auth/dal";
import { currentBranchScope, staffBranchLock, withBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import * as store from "@/server/checklists/store";
import { closedMarksOn } from "@/server/closed-days";
import { cashReportsBetween, firstCashReportDate } from "@/server/data/cash-reports";
import { getDb, schema as s } from "@/server/db";
import type { DigestExtraLoad } from "@/server/notify/digest-template";
import type { PhotoKindRules } from "@/server/storage/photo-access";
import { keepPhoto, photoStorage } from "@/server/storage/photos";

/*
 * Kontrol listelerinin sunucu tarafı (docs/KONTROL-LISTELERI.md): veritabanı katmanını (src/server/checklists/store.ts)
 * panelin bağlantısı ve fotoğraf deposuyla bağlar; fotoğrafın kim tarafından görüleceği (PHOTO_RULES.kontrol), sabah
 * e-postasının kutusu ve yanıtların işlem geçmişi de burada. Kurallar src/lib/checklists.ts'te.
 */

export { ChecklistError, type AnswerInput, type HistoryList, type RunViewData, type TemplateDTO, type WriteResult } from "@/server/checklists/store";

/** Günün kuralları: bugünün iş günü ve fotoğraf deposu (yoksa fotoğraflı maddeler yeni kayda girmez) */
function ctxOf(now: Date): store.DayCtx {
  return { today: businessDate(now), photos: photoStorage().available };
}

/**
 * Listeleme için gün kuralları ve isteğin şube seçimi (docs/KONTROL-LISTELERI.md › Şubeler): tek şube seçiliyken o
 * şubenin ve bütün şubelerin listeleri, kayıtların yalnız o şubedeki görünür; "Tümü"de bütün şubelerin listesi her fiziksel
 * şubenin satırı (şube ayrımı). Şubesi olan personel kendi şubesinde kilitlidir (src/server/branch-scope.ts).
 */
async function listCtxOf(now: Date): Promise<store.DayCtx> {
  const [branch, branches] = await Promise.all([currentBranchScope(), listBranches()]);
  return { ...ctxOf(now), branch, physical: tillBranches(branches).map((b) => ({ id: b.id, name: b.name })) };
}

/**
 * Bütün şubelerin listesinde kaydın şubesi (şube ayrımı, 27 Kasım 2026; docs/KONTROL-LISTELERI.md › Şubeler): formun
 * gönderdiği şube (`raw`, doldurma ekranının şubesi) `formBranch(…, "checklist")` kuralıyla: etkin fiziksel şube, şubesine
 * kilitli personelde kendi şubesi; göndermeyen eski sekme seçili fiziksel şubeye yazar, "Tümü"de birden çok şube açıkken
 * reddedilir (sessizce Tuzla'ya inmez). Şubeli listede kullanılmaz: kaydı listenin şubesinde
 */
async function runBranchPick(raw: string | null | undefined): Promise<{ id: string } | { error: string }> {
  const [scope, known, lock] = await Promise.all([currentBranchScope(), listBranches(), staffBranchLock()]);
  const picked = pickFormBranch({ raw, kind: "checklist", scope, known, lock, requireExplicit: true });
  return "error" in picked ? picked : { id: picked.id! };
}

/**
 * Doldurma ekranının şubesi (bütün şubelerin listesi): şubesine kilitli personelde kendi şubesi; seçili fiziksel şube;
 * "Tümü"de adresin `?sube=`'si (Bugün'ün ve zilin şube satırı; seçici onu çereze de benimsetir), yoksa tek fiziksel şube
 * açıksa o. Birden çok şube açıkken null: ekran şubeyi sorar
 */
export async function checklistRunBranch(raw: string | null | undefined): Promise<string | null> {
  const [scope, known, lock] = await Promise.all([currentBranchScope(), listBranches(), staffBranchLock()]);
  if (lock) return lock;
  const physical = tillBranches(known);
  if (physical.some((b) => b.id === scope)) return scope;
  if (raw && physical.some((b) => b.id === raw)) return raw;
  return physical.length === 1 ? physical[0].id : null;
}

/** Şablonlar; `scoped`: isteğin şube seçimine göre (o şubenin ve bütün şubelerin), Listeler sekmesi hepsini görür */
export async function loadChecklistTemplates(o: { runs?: boolean; scoped?: boolean } = {}) {
  return store.loadTemplates(getDb(), { runs: o.runs, branch: o.scoped ? await currentBranchScope() : undefined });
}

export async function loadChecklistTemplate(id: number) {
  const [t] = await store.loadTemplates(getDb(), { ids: [id], runs: true });
  return t ?? null;
}

/** Bir günün listeleri (Bugün, sabah e-postası, Kontrol listeleri); personel yalnız kendi doldurabildiklerini görür */
export async function loadChecklistDay(day: string, role: "admin" | "staff", now: Date = new Date()) {
  return store.loadChecklistDay(getDb(), day, role, await listCtxOf(now));
}

/** Birkaç günün listeleri tek okumada (zil: bugün ve dün) */
export async function loadChecklistDays(days: string[], role: "admin" | "staff", now: Date = new Date()) {
  return store.loadChecklistDays(getDb(), days, role, await listCtxOf(now));
}

/**
 * Doldurma ekranı; şube kilidini sayfa uygular (src/app/panel/kontrol/[id]/page.tsx, branchLockAllows). `runBranch`:
 * bütün şubelerin listesinde kaydın şubesi (checklistRunBranch)
 */
export function loadRunView(templateId: number, day: string, now: Date = new Date(), runBranch: string | null = null) {
  return store.loadRunView(getDb(), templateId, day, ctxOf(now), runBranch);
}

/** Geçmiş: personel yalnız kendi doldurabildiği listeleri, listenin personele açıldığı günden görür (aralık çağıranın) */
export async function loadChecklistHistory(from: string, to: string, role: "admin" | "staff", now: Date = new Date()) {
  return store.loadHistory(getDb(), from, to, role, await listCtxOf(now));
}

/** İlk kontrol listesi günü, seçili şubenin (şube ayrımı; "Tümü"de işletmenin) */
export async function firstChecklistDay() {
  return store.firstChecklistDay(getDb(), await currentBranchScope());
}

/**
 * Yanıtı yazar (eylem ve fotoğraf yolu); fotoğraf aynı işlemde 60 gün saklanmak üzere bağlanır. Şubesine kilitli
 * personel yalnız kendi şubesinin ve bütün şubelerin listelerine yazar (docs/KONTROL-LISTELERI.md › Şubeler): listeleme
 * süzer, adresle açılan başka şubenin listesini de burası reddeder.
 */
export async function writeChecklistAnswer(me: CurrentUser, input: store.AnswerInput & { branch?: string | null }, now: Date) {
  const lock = await staffBranchLock();
  const { branch, ...answer } = input;
  return store.writeAnswer(getDb(), { ...adminActor(me), lock, runBranch: await runBranchPick(branch) }, answer as store.AnswerInput, now, {
    photos: photoStorage().available,
    linkPhoto: (id, until, tx) => keepPhoto(id, until, tx),
  });
}

/** Fotoğraf yüklemeden önce hedef madde fotoğraf alır mı (almazsa ChecklistError); şube kilidi yazımdaki gibi */
export async function checkPhotoTarget(me: CurrentUser, target: { templateId: number; date: string; itemId: number; branch?: string | null }, now: Date) {
  const lock = await staffBranchLock();
  const { branch, ...rest } = target;
  return store.checkPhotoTarget(getDb(), { ...adminActor(me), lock, runBranch: await runBranchPick(branch) }, rest, now, photoStorage().available);
}

/**
 * Yanıtın işlem geçmişine düşenleri: liste tamamlandı; aralık dışı değer; "Sorun var"; ölçüm değişti. Düz işaretler ve
 * fotoğraflar yazılmaz (yanıtın kendisi kimin ne zaman yaptığını tutar).
 */
export async function logAnswerActivity(me: CurrentUser, r: store.WriteResult): Promise<void> {
  const name = r.run.name;
  const a = r.answer;
  const item = r.item;
  if (r.changed && a) {
    if (item.type === "number" && a.value !== null) {
      if (a.status === "issue" && (r.prev?.value !== a.value || r.prev?.status !== "issue")) {
        await logActivity(me, "Kontrol: aralık dışı", `${name} · ${item.label} ${valueText(item, a.value)} (${rangeText(item)}) · Not: ${a.note ?? ""}`, { branchId: r.run.branchId });
      } else if (r.prev?.value != null && r.prev.value !== a.value) {
        await logActivity(me, "Kontrol değeri değişti", `${name} · ${item.label}: ${valueText(item, r.prev.value)} → ${valueText(item, a.value)}`, { branchId: r.run.branchId });
      }
    }
    if (item.type === "check" && a.status === "issue" && (r.prev?.status !== "issue" || r.prev.note !== a.note)) {
      await logActivity(me, "Kontrol: sorun bildirildi", `${name} · ${item.label} · Not: ${a.note ?? ""}`, { branchId: r.run.branchId });
    }
  }
  if (r.completedNow) {
    const open = r.summary.issues.filter((x) => x.open).length;
    await logActivity(me, "Kontrol listesi tamamlandı", `${name} · ${longDateTR(r.run.date)} · ${whoText(r.summary.contributors)}${open ? ` · ${open} sorun` : ""}`, { branchId: r.run.branchId });
  }
}

/**
 * Kontrol fotoğrafını personel görür mü (yönetici ve bağlanmamış fotoğrafın yükleyeni buraya gelmez,
 * src/lib/photo-rules.ts photoViewDecision): personelin doldurduğu listenin son 7 gündeki kaydındaki fotoğraf, liste
 * personele açıldıktan sonraki günlerden (Kontrol geçmişiyle aynı pencere, STAFF_HISTORY_DAYS); şubesine kilitli
 * personelde yalnız kendi şubesinin ve bütün şubelerin listelerinden.
 */
export const kontrolPhotoRules: PhotoKindRules = {
  keepDays: KEEP_DAYS.kontrol,
  async canView(me, photo) {
    // Muhasebeci kontrol listelerini görmez
    if (!can(me.role, "kayit.yaz")) return false;
    const [run, lock] = await Promise.all([store.photoRun(getDb(), photo.id), staffBranchLock()]);
    return photoAccess({ role: adminLevel(me.role), userId: me.id, createdBy: photo.createdBy, run, lock, now: new Date() });
  },
};

/**
 * Sabah e-postasının kontrol kutusu (src/server/notify/digest-extras.ts): dünün (iş günü) eksik listeleri ve sorunları,
 * günde bir kez (anahtar `kontrol:<gün>` başarılı gönderimden sonra yazılır; yazılmışsa kutu yok). Yalnız okur:
 * önizleme de aynısını gösterir. O gün kasa raporu da yoksa (kasa kullanılmaya başlandıysa) "kafe kapalıysa
 * önemsemeyin" notu.
 */
export async function loadKontrolDigest(now: Date = new Date(), scope: BranchScope = ALL_BRANCHES): Promise<DigestExtraLoad | null> {
  const day = addDays(businessDate(now), -1);
  const key = `kontrol:${day}`;
  const [sent] = await getDb().select({ key: s.notificationLog.key }).from(s.notificationLog).where(eq(s.notificationLog.key, key)).limit(1);
  if (sent) return null;
  // E-posta işletmenin tamamı içindir: bütün şubelerin listeleri, kasa raporları ve kapalı işaretleri. Şubeye bağlı
  // alıcının e-postasında (şube kapsamı C P1-11) yalnız o şubenin
  const [lists, reports, first, marks] = await withBranchScope(scope, () =>
    Promise.all([loadChecklistDay(day, "admin", now), cashReportsBetween(day, day), firstCashReportDate(), closedMarksOn(day)]),
  );
  const cashMissing = !reports.length && first !== null && first <= day;
  // Onaylı kapalı gün (dalga 10 §2.9), şube şube: kapalı işaretli şubenin hiç açılmamış listeleri, şubede günün izi
  // (kasa raporu, başlamış liste) yoksa eksik sayılmaz; hepsi düşünce kutu yok. Öteki şubenin kapalı günü bu şubenin
  // listelerini düşürmez, öteki şubenin raporu bu şubenin kapalı gününü "açık" yapmaz
  const kept = closedDayDigestLists(lists, marks, new Set(reports.map((r) => r.branchId)));
  const box = kontrolDigestBox(day, kept, cashMissing);
  return box ? { box, logKeys: [key] } : null;
}
