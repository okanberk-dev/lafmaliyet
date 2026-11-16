import "server-only";

import { eq } from "drizzle-orm";

import { ALL_BRANCHES } from "@/lib/branches";
import { businessDate } from "@/lib/cash-report";
import { kontrolDigestBox, photoAccess, rangeText, valueText, whoText } from "@/lib/checklists";
import { KEEP_DAYS } from "@/lib/photo-rules";
import { addDays, longDateTR } from "@/lib/reminders";
import { logActivity } from "@/server/actions/log";
import type { CurrentUser } from "@/server/auth/dal";
import { currentBranchScope, withBranchScope } from "@/server/branch-scope";
import * as store from "@/server/checklists/store";
import { isClosedDay } from "@/server/closed-days";
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
 * şubenin ve bütün şubelerin listeleri görünür. Şubesi olan personel kendi şubesinde kilitlidir (src/server/branch-scope.ts).
 */
async function listCtxOf(now: Date): Promise<store.DayCtx> {
  return { ...ctxOf(now), branch: await currentBranchScope() };
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

export function loadRunView(templateId: number, day: string, now: Date = new Date()) {
  return store.loadRunView(getDb(), templateId, day, ctxOf(now));
}

/** Geçmiş: personel yalnız kendi doldurabildiği listeleri, listenin personele açıldığı günden görür (aralık çağıranın) */
export async function loadChecklistHistory(from: string, to: string, role: "admin" | "staff", now: Date = new Date()) {
  return store.loadHistory(getDb(), from, to, role, await listCtxOf(now));
}

export function firstChecklistDay() {
  return store.firstChecklistDay(getDb());
}

/** Yanıtı yazar (eylem ve fotoğraf yolu); fotoğraf aynı işlemde 60 gün saklanmak üzere bağlanır */
export function writeChecklistAnswer(me: CurrentUser, input: store.AnswerInput, now: Date) {
  return store.writeAnswer(getDb(), me, input, now, { photos: photoStorage().available, linkPhoto: (id, until, tx) => keepPhoto(id, until, tx) });
}

/** Fotoğraf yüklemeden önce hedef madde fotoğraf alır mı (almazsa ChecklistError) */
export function checkPhotoTarget(me: CurrentUser, target: { templateId: number; date: string; itemId: number }, now: Date) {
  return store.checkPhotoTarget(getDb(), me, target, now, photoStorage().available);
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
        await logActivity(me, "Kontrol: aralık dışı", `${name} · ${item.label} ${valueText(item, a.value)} (${rangeText(item)}) · Not: ${a.note ?? ""}`);
      } else if (r.prev?.value != null && r.prev.value !== a.value) {
        await logActivity(me, "Kontrol değeri değişti", `${name} · ${item.label}: ${valueText(item, r.prev.value)} → ${valueText(item, a.value)}`);
      }
    }
    if (item.type === "check" && a.status === "issue" && (r.prev?.status !== "issue" || r.prev.note !== a.note)) {
      await logActivity(me, "Kontrol: sorun bildirildi", `${name} · ${item.label} · Not: ${a.note ?? ""}`);
    }
  }
  if (r.completedNow) {
    const open = r.summary.issues.filter((x) => x.open).length;
    await logActivity(me, "Kontrol listesi tamamlandı", `${name} · ${longDateTR(r.run.date)} · ${whoText(r.summary.contributors)}${open ? ` · ${open} sorun` : ""}`);
  }
}

/**
 * Kontrol fotoğrafını personel görür mü (yönetici ve bağlanmamış fotoğrafın yükleyeni buraya gelmez,
 * src/lib/photo-rules.ts photoViewDecision): personelin doldurduğu listenin son 7 gündeki kaydındaki fotoğraf, liste
 * personele açıldıktan sonraki günlerden (Kontrol geçmişiyle aynı pencere, STAFF_HISTORY_DAYS).
 */
export const kontrolPhotoRules: PhotoKindRules = {
  keepDays: KEEP_DAYS.kontrol,
  async canView(me, photo) {
    const run = await store.photoRun(getDb(), photo.id);
    return photoAccess({ role: me.role, userId: me.id, createdBy: photo.createdBy, run, now: new Date() });
  },
};

/**
 * Sabah e-postasının kontrol kutusu (src/server/notify/digest-extras.ts): dünün (iş günü) eksik listeleri ve sorunları,
 * günde bir kez (anahtar `kontrol:<gün>` başarılı gönderimden sonra yazılır; yazılmışsa kutu yok). Yalnız okur:
 * önizleme de aynısını gösterir. O gün kasa raporu da yoksa (kasa kullanılmaya başlandıysa) "kafe kapalıysa
 * önemsemeyin" notu.
 */
export async function loadKontrolDigest(now: Date = new Date()): Promise<DigestExtraLoad | null> {
  const day = addDays(businessDate(now), -1);
  const key = `kontrol:${day}`;
  const [sent] = await getDb().select({ key: s.notificationLog.key }).from(s.notificationLog).where(eq(s.notificationLog.key, key)).limit(1);
  if (sent) return null;
  // E-posta işletmenin tamamı içindir: bütün şubelerin listeleri ve kasa raporları
  const [lists, reports, first] = await withBranchScope(ALL_BRANCHES, () => Promise.all([loadChecklistDay(day, "admin", now), cashReportsBetween(day, day), firstCashReportDate()]));
  const cashMissing = !reports.length && first !== null && first <= day;
  // Onaylı kapalı gün (dalga 10 §2.9): hiç açılmamış listeler eksik sayılmaz, kutu yok
  if (cashMissing && !lists.some((l) => l.run) && (await isClosedDay(day))) return null;
  const box = kontrolDigestBox(day, lists, cashMissing);
  return box ? { box, logKeys: [key] } : null;
}
