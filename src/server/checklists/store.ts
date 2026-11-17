// "server-only" yok: veritabanıyla gidip gelen test (tests/kontrol-listeleri-db.test.ts) bu dosyayı doğrudan çalıştırır
// (Claude bağlantısının src/server/mcp/store.ts'i gibi). Her işlev veritabanını parametre alır; sunucu tarafındaki
// sarmalayıcılar (getDb, fotoğraf deposu, işlem geçmişi) src/server/data/checklists.ts'te. "use client" dosyası buraya
// uzanmaz.

import { and, asc, eq, gte, inArray, isNull, lte, min, or } from "drizzle-orm";

import { ALL_BRANCHES, type BranchScope } from "@/lib/branches";
import type { AlertList } from "@/lib/checklist-alerts";
import { businessDate } from "@/lib/cash-report";
import {
  absentReason,
  appliesOn,
  canAnswerDay,
  staffSeesRun,
  DAY_CLOSED_TEXT,
  inRange,
  LIST_CHANGED_TEXT,
  opensMinute,
  rangeText,
  runSummary,
  sameAnswer,
  nextVersions,
  slotLocked,
  slotLockedText,
  snapshotItems,
  type AnswerContent,
  type AnswerLite,
  type ChecklistItemSnap,
  type ChecklistItemType,
  type ChecklistLite,
  type RunLite,
  type TemplateTiming,
} from "@/lib/checklists";
import { keepUntil } from "@/lib/photo-rules";
import { addDays } from "@/lib/reminders";
import type { DB } from "@/server/db";
import * as s from "@/server/db/schema";

/*
 * Kontrol listelerinin veritabanı tarafı (docs/KONTROL-LISTELERI.md): şablonlar, günün listeleri, doldurma ekranı,
 * geçmiş ve yanıt yazımı. Kurallar src/lib/checklists.ts'te (saf). Yanıt tek işlemde yazılır: şablon paylaşımlı,
 * günün kaydı yazma kilidiyle okunur; aynı listeyi iki telefon aynı anda doldurursa tamamlanma bir kez yazılır, aynı
 * maddede son yazan geçer, öncekinin hâli sürümlere geçer.
 */

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Db = DB | Tx;

/** Yanıt yazılamadı: metin kişiye gösterilir, `status` fotoğraf yolunun HTTP kodu */
export class ChecklistError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface ItemDTO extends ChecklistItemSnap {
  sortOrder: number;
  active: boolean;
}

export interface TemplateDTO {
  id: number;
  name: string;
  description: string | null;
  /** Listenin şubesi; boş: bütün şubeler */
  branchId: string | null;
  opensAt: string;
  dueAt: string;
  weekdays: number[];
  staffAllowed: boolean;
  /** "Personel doldurabilir"in açıldığı an (ISO); boş: baştan beri. Personel bundan önceki günleri görmez */
  staffSince: string | null;
  active: boolean;
  activeFrom: string;
  inactiveFrom: string | null;
  sortOrder: number;
  createdAt: string;
  /** Etkin maddeler, sırasıyla */
  items: ItemDTO[];
  /** Kaldırılan (arşivlenen) maddeler */
  archived: ItemDTO[];
  /** Kaydı var mı (varsa silinmez, pasife alınır) */
  hasRuns: boolean;
}

type TemplateRow = typeof s.checklistTemplates.$inferSelect;
type ItemRow = typeof s.checklistItems.$inferSelect;
type RunRow = typeof s.checklistRuns.$inferSelect;
type AnswerRow = typeof s.checklistAnswers.$inferSelect;

const itemDto = (i: ItemRow): ItemDTO => ({
  id: i.id,
  label: i.label,
  type: i.type,
  section: i.section,
  hint: i.hint,
  required: i.required,
  unit: i.unit,
  min: i.min,
  max: i.max,
  sortOrder: i.sortOrder,
  active: i.active,
});

/** Şablonun bir güne uygulanıp uygulanmadığına bakılan alanları */
export const timingOf = (t: Pick<TemplateDTO, "weekdays" | "opensAt" | "activeFrom" | "inactiveFrom">): TemplateTiming => ({
  weekdays: t.weekdays,
  opensAt: t.opensAt,
  activeFrom: t.activeFrom,
  inactiveFrom: t.inactiveFrom,
});

const rowTiming = (t: TemplateRow): TemplateTiming => ({
  weekdays: t.weekdays,
  opensAt: t.opensAt ?? "08:00",
  activeFrom: t.activeFrom.toISOString(),
  inactiveFrom: t.inactiveFrom?.toISOString() ?? null,
});

export function answerLite(a: AnswerRow): AnswerLite {
  return {
    id: a.id,
    itemId: a.itemId,
    status: a.status,
    value: a.value,
    textValue: a.textValue,
    note: a.note,
    photoId: a.photoId,
    photoAt: a.photoAt?.toISOString() ?? null,
    by: a.answeredByName,
    at: a.answeredAt.toISOString(),
    history: a.history ?? [],
  };
}

/**
 * Şablonlar (yalnız günlük listeler), maddeleriyle; `ids` verilirse yalnız onlar. `runs`: kaydı olanı da işaretle (bir
 * sorgu daha; düzenleme ekranı için). `branch`: tek şube seçiliyken o şubenin ve bütün şubelerin (şubesiz) listeleri;
 * "Tümü" ya da verilmemişse hepsi.
 */
export async function loadTemplates(db: Db, o: { ids?: number[]; runs?: boolean; branch?: BranchScope } = {}): Promise<TemplateDTO[]> {
  const t = s.checklistTemplates;
  const branch = o.branch && o.branch !== ALL_BRANCHES ? or(eq(t.branchId, o.branch), isNull(t.branchId)) : undefined;
  const rows = await db
    .select()
    .from(t)
    .where(and(eq(t.schedule, "daily"), o.ids ? inArray(t.id, o.ids) : undefined, branch))
    .orderBy(asc(t.sortOrder), asc(t.id));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [items, used] = await Promise.all([
    db
      .select()
      .from(s.checklistItems)
      .where(inArray(s.checklistItems.templateId, ids))
      .orderBy(asc(s.checklistItems.sortOrder), asc(s.checklistItems.id)),
    o.runs ? db.selectDistinct({ id: s.checklistRuns.templateId }).from(s.checklistRuns).where(inArray(s.checklistRuns.templateId, ids)) : Promise.resolve([]),
  ]);
  const usedIds = new Set(used.map((u) => u.id));
  return rows.map((r) => {
    const mine = items.filter((i) => i.templateId === r.id).map(itemDto);
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      branchId: r.branchId,
      opensAt: r.opensAt ?? "08:00",
      dueAt: r.dueAt ?? "11:00",
      weekdays: r.weekdays,
      staffAllowed: r.staffAllowed,
      staffSince: r.staffSince?.toISOString() ?? null,
      active: r.active,
      activeFrom: r.activeFrom.toISOString(),
      inactiveFrom: r.inactiveFrom?.toISOString() ?? null,
      sortOrder: r.sortOrder,
      createdAt: r.createdAt.toISOString(),
      items: mine.filter((i) => i.active),
      archived: mine.filter((i) => !i.active),
      hasRuns: usedIds.has(r.id),
    };
  });
}

/** Günlük listenin o günkü kaydı (günlük listede sıra 1) */
function runWhere(templateId: number, date: string) {
  const r = s.checklistRuns;
  return and(eq(r.templateId, templateId), eq(r.date, date), eq(r.seq, 1));
}

/** Kayıt yoksa şablonun bugünkü maddeleri (fotoğraf deposu yoksa fotoğraflı maddeler çıkar) */
const currentItems = (t: TemplateDTO, photos: boolean) => snapshotItems(t.items, { photos });

/** Bir listenin günü: kayıt varsa kaydın adı, aralığı ve maddeleri, yoksa şablonunki */
function liteOf(t: TemplateDTO, run: RunRow | undefined, answers: AnswerLite[], photos: boolean): ChecklistLite {
  const items = run ? run.items : currentItems(t, photos);
  const summary: RunLite | null = run ? runSummary(items, answers, run.completedAt?.toISOString() ?? null) : null;
  return {
    templateId: t.id,
    name: run?.name ?? t.name,
    opensAt: run?.opensAt ?? t.opensAt,
    dueAt: run?.dueAt ?? t.dueAt,
    required: items.filter((i) => i.required).length,
    photos: items.filter((i) => i.required && i.type === "photo").length,
    staffAllowed: t.staffAllowed,
    run: summary,
  };
}

/**
 * Liste o gün beklenir mi: bugün için şablon etkin olmalı ve güne uymalı (appliesOn); geçmiş bir gün için yalnız o
 * günün kuralı (o gün etkin miydi). Kaydı olan liste her zaman listelenir.
 */
const expectedOn = (t: TemplateDTO, day: string, today: string) => (day < today || t.active) && appliesOn(timingOf(t), day);

/** Açılış saatine, sonra şablonun sırasına göre */
const byOpening = (templates: TemplateDTO[]) => (a: ChecklistLite, b: ChecklistLite) =>
  opensMinute(a.opensAt) - opensMinute(b.opensAt) || templates.findIndex((t) => t.id === a.templateId) - templates.findIndex((t) => t.id === b.templateId);

export interface DayCtx {
  /** Bugünün iş günü (bugünün listesi için şablon etkin olmalı) */
  today: string;
  /** Fotoğraf deposu var mı (yoksa fotoğraflı maddeler yeni kayda girmez) */
  photos: boolean;
  /** Şube seçimi: günün listeleri ve geçmiş bu şubenin ve şubesiz listeleri gösterir (yoksa hepsi) */
  branch?: BranchScope;
}

/**
 * Günlerin listeleri (Bugün, zil, sabah e-postası, Kontrol listeleri ekranı): her gün o gün beklenen ve o gün kaydı olan
 * etkin listeler, açılış saatine göre. Pasif liste o gün kaydı olsa da çıkmaz (kaydı Geçmiş'te kalır): pasife alınan
 * liste ne Bugün'de ne zilde ne e-postada hatırlatılır. Personel yalnız "Personel doldurabilir" listeleri görür. Günler
 * birlikte okunur (zil: bugün ve dün): şablon, madde, kayıt ve yanıt için birer sorgu, maliyet modeli yok.
 */
export async function loadChecklistDays(db: Db, days: string[], role: "admin" | "staff", ctx: DayCtx): Promise<Map<string, ChecklistLite[]>> {
  const out = new Map<string, ChecklistLite[]>(days.map((d) => [d, []]));
  const templates = await loadTemplates(db, { branch: ctx.branch });
  const visible = templates.filter((t) => t.active && (role === "admin" || t.staffAllowed));
  if (!visible.length || !days.length) return out;
  const r = s.checklistRuns;
  const runs = await db
    .select()
    .from(r)
    .where(and(inArray(r.date, days), eq(r.seq, 1), inArray(r.templateId, visible.map((t) => t.id))));
  const answers = runs.length ? (await db.select().from(s.checklistAnswers).where(inArray(s.checklistAnswers.runId, runs.map((x) => x.id)))).map((a) => ({ runId: a.runId, a: answerLite(a) })) : [];
  for (const day of out.keys()) {
    // Personel: liste personele açılmadan önceki günler (dünkü kayıt, Bugün'ün dünkü listeler satırı) görünmez
    const lists = visible.flatMap((t) => {
      if (role !== "admin" && !staffSeesRun(t, day)) return [];
      const run = runs.find((x) => x.templateId === t.id && x.date === day);
      if (!run && !expectedOn(t, day, ctx.today)) return [];
      return [liteOf(t, run, run ? answers.filter((x) => x.runId === run.id).map((x) => x.a) : [], ctx.photos)];
    });
    out.set(day, lists.sort(byOpening(templates)));
  }
  return out;
}

/**
 * Personele e-posta hatırlatmasının listeleri (saatlik iş, src/server/notify/checklist-alerts.ts): bir günün etkin ve
 * personelin doldurabildiği, o gün beklenen ya da kaydı olan listeleri; kaydın (yoksa şablonun) maddeleri ve yanıtlar.
 */
export async function loadAlertLists(db: Db, day: string, ctx: DayCtx): Promise<AlertList[]> {
  const templates = (await loadTemplates(db)).filter((t) => t.active && t.staffAllowed);
  if (!templates.length) return [];
  const r = s.checklistRuns;
  const runs = await db
    .select()
    .from(r)
    .where(and(eq(r.date, day), eq(r.seq, 1), inArray(r.templateId, templates.map((t) => t.id))));
  const answers = runs.length ? await db.select().from(s.checklistAnswers).where(inArray(s.checklistAnswers.runId, runs.map((x) => x.id))) : [];
  return templates.flatMap((t) => {
    const run = runs.find((x) => x.templateId === t.id);
    if (!run && !expectedOn(t, day, ctx.today)) return [];
    return [
      {
        templateId: t.id,
        name: run?.name ?? t.name,
        branchId: t.branchId,
        opensAt: run?.opensAt ?? t.opensAt,
        dueAt: run?.dueAt ?? t.dueAt,
        items: run ? run.items : currentItems(t, ctx.photos),
        answers: run ? answers.filter((a) => a.runId === run.id).map((a) => ({ itemId: a.itemId, photoAt: a.photoAt?.toISOString() ?? null })) : [],
      },
    ];
  });
}

/** Bir günün listeleri (loadChecklistDays'in tek günlüğü) */
export async function loadChecklistDay(db: Db, day: string, role: "admin" | "staff", ctx: DayCtx): Promise<ChecklistLite[]> {
  return (await loadChecklistDays(db, [day], role, ctx)).get(day) ?? [];
}

/** Doldurma ekranının verisi */
export interface RunViewData {
  template: TemplateDTO;
  day: string;
  /** Kayıt varsa kaydın (açıldığı andaki) adı ve aralığı */
  name: string;
  opensAt: string;
  dueAt: string;
  run: { id: number; completedAt: string | null; completedByName: string | null } | null;
  items: ChecklistItemSnap[];
  answers: AnswerLite[];
  summary: RunLite;
  /** Form yerine gösterilecek ret ("Bu liste kapalı." …); null: doldurulabilir */
  refusal: string | null;
  /** Liste bugün neden yok (yönetici ipucu): pasif, haftanın günleri, "yarından" */
  absent: string | null;
}

/** Doldurma ekranı: şablon, günün kaydı (yoksa şablonun bugünkü maddeleri) ve yanıtlar; şablon yoksa null */
export async function loadRunView(db: Db, templateId: number, day: string, ctx: DayCtx): Promise<RunViewData | null> {
  const [t] = await loadTemplates(db, { ids: [templateId] });
  if (!t) return null;
  const [run] = await db.select().from(s.checklistRuns).where(runWhere(t.id, day)).limit(1);
  const answers = run ? (await db.select().from(s.checklistAnswers).where(eq(s.checklistAnswers.runId, run.id))).map(answerLite) : [];
  const items = run ? run.items : currentItems(t, ctx.photos);
  const absent = absentReason({ ...timingOf(t), active: t.active }, day);
  const refusal = !t.active ? "Bu liste kapalı." : !run && absent ? "Bu liste bugün yok." : !items.length ? "Bu listede madde yok." : null;
  return {
    template: t,
    day,
    name: run?.name ?? t.name,
    opensAt: run?.opensAt ?? t.opensAt,
    dueAt: run?.dueAt ?? t.dueAt,
    run: run ? { id: run.id, completedAt: run.completedAt?.toISOString() ?? null, completedByName: run.completedByName } : null,
    items,
    answers,
    summary: runSummary(items, answers, run?.completedAt?.toISOString() ?? null),
    refusal,
    absent,
  };
}

/** Bir günün geçmiş görünümündeki listesi: şablon, kayıt (yoksa null), maddeler ve yanıtlar */
export interface HistoryList {
  template: TemplateDTO;
  lite: ChecklistLite;
  run: { id: number; opensAt: string; dueAt: string; completedAt: string | null; completedByName: string | null } | null;
  items: ChecklistItemSnap[];
  answers: AnswerLite[];
}

/**
 * Geçmiş: [from, to] günlerinin listeleri, en yeni gün önce. Her gün o gün beklenen ve kaydı olan listeler; kaydı
 * olmayan günün maddeleri şablonun bugünkü maddeleridir (yaklaşık: haftanın günleri de bugünkü seçimden). Pasif liste
 * de listelenir (kaydı geçmişte kalır). Personel (dalga 10 §2.5) yalnız "Personel doldurabilir" listeleri, listenin
 * personele açıldığı günden itibaren görür: yönetici listelerinin kaydı SQL'de süzülür, hiç okunmaz. Pencere (son 7
 * gün) çağıranın aralığıdır (historyRange).
 */
export async function loadHistory(db: Db, from: string, to: string, role: "admin" | "staff", ctx: DayCtx): Promise<{ day: string; lists: HistoryList[] }[]> {
  const templates = await loadTemplates(db, { branch: ctx.branch });
  const visible = templates.filter((t) => role === "admin" || t.staffAllowed);
  const r = s.checklistRuns;
  const runs = visible.length
    ? await db
        .select()
        .from(r)
        .where(and(gte(r.date, from), lte(r.date, to), eq(r.seq, 1), inArray(r.templateId, visible.map((t) => t.id))))
    : [];
  const shown = runs.filter((x) => role === "admin" || staffSeesRun(visible.find((t) => t.id === x.templateId)!, x.date));
  const answers = shown.length ? await db.select().from(s.checklistAnswers).where(inArray(s.checklistAnswers.runId, shown.map((x) => x.id))) : [];
  const out: { day: string; lists: HistoryList[] }[] = [];
  for (let day = to; day >= from; day = addDays(day, -1)) {
    const lists = visible.flatMap((t): HistoryList[] => {
      if (role !== "admin" && !staffSeesRun(t, day)) return [];
      const run = shown.find((x) => x.templateId === t.id && x.date === day);
      if (!run && !expectedOn(t, day, ctx.today)) return [];
      const mine = run ? answers.filter((a) => a.runId === run.id).map(answerLite) : [];
      const lite = liteOf(t, run, mine, ctx.photos);
      return [
        {
          template: t,
          lite,
          run: run ? { id: run.id, opensAt: lite.opensAt, dueAt: lite.dueAt, completedAt: run.completedAt?.toISOString() ?? null, completedByName: run.completedByName } : null,
          items: run ? run.items : currentItems(t, ctx.photos),
          answers: mine,
        },
      ];
    });
    lists.sort((a, b) => byOpening(templates)(a.lite, b.lite));
    out.push({ day, lists });
  }
  return out;
}

/** İlk kontrol listesi günü (geçmiş bundan eskiye gitmez): ilk kayıt ya da ilk şablonun eklendiği iş günü */
export async function firstChecklistDay(db: Db): Promise<string | null> {
  const [[run], [tpl]] = await Promise.all([
    db.select({ d: min(s.checklistRuns.date) }).from(s.checklistRuns),
    db.select({ at: min(s.checklistTemplates.createdAt) }).from(s.checklistTemplates),
  ]);
  const days = [run?.d ?? null, tpl?.at ? businessDate(new Date(tpl.at)) : null].filter((d): d is string => Boolean(d)).sort();
  return days[0] ?? null;
}

// ---------------------------------------------------------------- Yanıt yazımı

/** Yanıtın işlemi: tamam, sorun var, ölçüm, kısa not, fotoğrafın notu, geri al, fotoğraf (yalnız fotoğraf yolundan) */
export type AnswerOp =
  | { op: "ok" }
  | { op: "issue"; note: string }
  | { op: "value"; value: number; note: string | null }
  | { op: "text"; text: string }
  | { op: "note"; note: string | null }
  | { op: "clear" }
  | { op: "photo"; photoId: number };

export type AnswerInput = { templateId: number; date: string; itemId: number } & AnswerOp;

/** Hangi madde türü hangi işlemi alır (fotoğraf yalnız fotoğraf yolundan gelir) */
const OPS: Record<ChecklistItemType, AnswerOp["op"][]> = {
  check: ["ok", "issue", "clear"],
  number: ["value", "clear"],
  text: ["text", "clear"],
  photo: ["photo", "note", "clear"],
};

export interface WriteResult {
  /** Yazılan yanıt; geri alındıysa null */
  answer: AnswerLite | null;
  prev: AnswerLite | null;
  /** Değişen ya da geri alınan fotoğraf: yanıttan sonra silinir */
  previousPhotoId: number | null;
  item: ChecklistItemSnap;
  run: { id: number; name: string; date: string };
  summary: RunLite;
  /** Bu yanıtla tamamlandı / tamamlanmışken eksildi */
  completedNow: boolean;
  reopened: boolean;
  /** false: yanıt öncekiyle aynıydı, bir şey yazılmadı */
  changed: boolean;
}

export interface WriteDeps {
  /** Fotoğraf deposu var mı (yoksa yeni kaydın anlık görüntüsüne fotoğraflı madde girmez) */
  photos: boolean;
  /** Fotoğrafı yanıta bağlar, aynı işlemde (src/server/storage/photos.ts keepPhoto) */
  linkPhoto(photoId: number, until: Date, tx: Tx): Promise<void>;
}

interface Me {
  id: number;
  name: string;
  role: "admin" | "staff";
}

type NextAnswer = AnswerContent & { photoAt: Date | null };

/**
 * Bir yanıtı yazar (sunucu eylemi ve fotoğraf yolu ortak): yetki (liste etkin, personelse "Personel doldurabilir"),
 * gün kuralı (yalnız bugün; açılmış kayıt 05:30'a kadar), günün kaydını ilk yanıtta açma (anlık görüntü), yanıtı yazma
 * (öncekinin hâli sürümlere), tamamlanma. Fotoğraf: yükleyenin, bağlanmamış "kontrol" fotoğrafı olmalı; aynı işlemde
 * 60 gün saklanmak üzere bağlanır. Sorunlu (aralık dışı ya da "Sorun var") yanıt geri alınamaz: kayıt silinmesin,
 * değeri değiştirilir.
 */
export async function writeAnswer(db: DB, me: Me, input: AnswerInput, now: Date, deps: WriteDeps): Promise<WriteResult> {
  return db.transaction(async (tx) => {
    const t = s.checklistTemplates;
    const [tpl] = await tx
      .select()
      .from(t)
      .where(and(eq(t.id, input.templateId), eq(t.schedule, "daily")))
      .for("share")
      .limit(1);
    if (!tpl) throw new ChecklistError("Liste bulunamadı.", 404);
    if (!tpl.active) throw new ChecklistError("Bu liste kapalı.", 409);
    if (me.role !== "admin" && !tpl.staffAllowed) throw new ChecklistError("Bu listeyi yalnız yönetici doldurur.", 403);
    if (input.date > businessDate(now)) throw new ChecklistError("Bu gün için liste doldurulamaz.", 400);

    let [run] = await tx.select().from(s.checklistRuns).where(runWhere(tpl.id, input.date)).for("update").limit(1);
    if (!canAnswerDay(input.date, now, Boolean(run))) throw new ChecklistError(DAY_CLOSED_TEXT, 409);
    if (!run) {
      // Geri alınacak ya da notu yazılacak yanıt yokken kayıt açılmaz
      if (input.op === "clear" || input.op === "note") throw new ChecklistError(LIST_CHANGED_TEXT, 409);
      if (!appliesOn(rowTiming(tpl), input.date)) throw new ChecklistError("Bu liste bugün yok.", 409);
      const rows = await tx.select().from(s.checklistItems).where(eq(s.checklistItems.templateId, tpl.id));
      const snap = snapshotItems(rows.map(itemDto), { photos: deps.photos });
      if (!snap.length) throw new ChecklistError("Bu listede madde yok.", 409);
      // İki telefon aynı anda ilk yanıtı verirse ikincisi kaydı açmaz, birincinin kaydını kilitleyip ona yazar
      await tx
        .insert(s.checklistRuns)
        .values({ templateId: tpl.id, date: input.date, seq: 1, name: tpl.name, opensAt: tpl.opensAt, dueAt: tpl.dueAt, items: snap })
        .onConflictDoNothing();
      [run] = await tx.select().from(s.checklistRuns).where(runWhere(tpl.id, input.date)).for("update").limit(1);
      if (!run) throw new ChecklistError(LIST_CHANGED_TEXT, 409);
    }

    const item = run.items.find((i) => i.id === input.itemId);
    if (!item) throw new ChecklistError(LIST_CHANGED_TEXT, 409);
    if (!OPS[item.type].includes(input.op)) throw new ChecklistError("Bu madde bu şekilde işaretlenemez.", 400);
    // Saatlik bölüm (Tuvalet çizelgesi): saati gelmeden işaretlenmez
    if (slotLocked(input.date, item.section, now)) throw new ChecklistError(slotLockedText(item.section), 409);

    const a = s.checklistAnswers;
    const [prevRow] = await tx
      .select()
      .from(a)
      .where(and(eq(a.runId, run.id), eq(a.itemId, item.id)))
      .limit(1);
    const prev = prevRow ? answerLite(prevRow) : null;
    const runRef = { id: run.id, name: run.name, date: run.date };

    // Yeni hâl
    let next: NextAnswer | null;
    switch (input.op) {
      case "ok":
        next = { status: "ok", value: null, textValue: null, note: null, photoId: null, photoAt: null };
        break;
      case "issue":
        if (!input.note.trim()) throw new ChecklistError("Sorunu kısaca yazın");
        next = { status: "issue", value: null, textValue: null, note: input.note.trim(), photoId: null, photoAt: null };
        break;
      case "value": {
        const ok = inRange(item, input.value);
        const note = input.note?.trim() || null;
        if (!ok && !note) throw new ChecklistError(`Değer aralık dışında (${rangeText(item)}): ne yapıldığını nota yazın.`);
        next = { status: ok ? "ok" : "issue", value: input.value, textValue: null, note, photoId: null, photoAt: null };
        break;
      }
      case "text":
        if (!input.text.trim()) throw new ChecklistError("Notu yazın");
        next = { status: "ok", value: null, textValue: input.text.trim(), note: null, photoId: null, photoAt: null };
        break;
      case "note":
        if (!prev?.photoAt) throw new ChecklistError("Önce fotoğrafı çekin.", 409);
        next = { status: prev.status, value: prev.value, textValue: prev.textValue, note: input.note?.trim() || null, photoId: prev.photoId, photoAt: prevRow!.photoAt };
        break;
      case "photo": {
        const [photo] = await tx
          .select({ id: s.photos.id, kind: s.photos.kind, createdBy: s.photos.createdBy, linkedAt: s.photos.linkedAt, expiresAt: s.photos.expiresAt })
          .from(s.photos)
          .where(eq(s.photos.id, input.photoId))
          .for("update")
          .limit(1);
        if (!photo || photo.kind !== "kontrol" || photo.createdBy !== me.id || photo.linkedAt !== null || (photo.expiresAt !== null && photo.expiresAt <= now)) {
          throw new ChecklistError("Fotoğraf bulunamadı; yeniden çekin.", 409);
        }
        await deps.linkPhoto(photo.id, keepUntil("kontrol", input.date), tx);
        // Fotoğrafın notu yeniden çekince kalır
        next = { status: "ok", value: null, textValue: null, note: prev?.note ?? null, photoId: photo.id, photoAt: now };
        break;
      }
      case "clear":
        next = null;
        break;
    }

    let answer: AnswerLite | null = prev;
    let changed = false;
    if (next === null) {
      if (prev) {
        // Sorun kaydı silinmez (ilk aralık dışı ölçüm kaybolmasın): değer değiştirilir, geri alınmaz
        if (prev.status === "issue" || prev.history.some((v) => v.status === "issue")) {
          throw new ChecklistError("Sorun bildirilen madde geri alınamaz; yeni hâlini işaretleyin.", 409);
        }
        await tx.delete(a).where(eq(a.id, prev.id));
        answer = null;
        changed = true;
      }
    } else if (!prev || !sameAnswer(prev, next)) {
      const values = {
        status: next.status,
        value: next.value,
        textValue: next.textValue,
        note: next.note,
        photoId: next.photoId,
        photoAt: next.photoAt,
        history: nextVersions(prev, next),
        answeredBy: me.id,
        answeredByName: me.name,
        answeredAt: now,
      };
      const [row] = prev
        ? await tx.update(a).set(values).where(eq(a.id, prev.id)).returning()
        : await tx
            .insert(a)
            .values({ runId: run.id, itemId: item.id, ...values })
            .returning();
      answer = answerLite(row);
      changed = true;
    }

    const previousPhotoId = prev?.photoId != null && prev.photoId !== (answer?.photoId ?? null) ? prev.photoId : null;
    const all = (await tx.select().from(a).where(eq(a.runId, run.id))).map(answerLite);
    const summary = runSummary(run.items, all, run.completedAt?.toISOString() ?? null);
    let completedNow = false;
    let reopened = false;
    if (summary.complete && !run.completedAt) {
      await tx.update(s.checklistRuns).set({ completedAt: now, completedBy: me.id, completedByName: me.name, updatedAt: now }).where(eq(s.checklistRuns.id, run.id));
      summary.completedAt = now.toISOString();
      completedNow = true;
    } else if (!summary.complete && run.completedAt) {
      await tx.update(s.checklistRuns).set({ completedAt: null, completedBy: null, completedByName: null, updatedAt: now }).where(eq(s.checklistRuns.id, run.id));
      summary.completedAt = null;
      reopened = true;
    } else if (changed) {
      await tx.update(s.checklistRuns).set({ updatedAt: now }).where(eq(s.checklistRuns.id, run.id));
    }
    return { answer, prev, previousPhotoId, item, run: runRef, summary, completedNow, reopened, changed };
  });
}

/**
 * Fotoğraf yüklemeden önce: bu maddeye fotoğraf yazılabilir mi (writeAnswer'ın ilk adımları, yazmadan). Olmayacak bir
 * yanıt için fotoğraf depoya hiç girmesin.
 */
export async function checkPhotoTarget(db: Db, me: Me, target: { templateId: number; date: string; itemId: number }, now: Date, photos: boolean): Promise<void> {
  const [t] = await loadTemplates(db, { ids: [target.templateId] });
  if (!t) throw new ChecklistError("Liste bulunamadı.", 404);
  if (!t.active) throw new ChecklistError("Bu liste kapalı.", 409);
  if (me.role !== "admin" && !t.staffAllowed) throw new ChecklistError("Bu listeyi yalnız yönetici doldurur.", 403);
  if (target.date > businessDate(now)) throw new ChecklistError("Bu gün için liste doldurulamaz.", 400);
  if (!photos) throw new ChecklistError("Fotoğraf deposu bu ortamda kurulu değil.", 503);
  const [run] = await db.select({ items: s.checklistRuns.items }).from(s.checklistRuns).where(runWhere(t.id, target.date)).limit(1);
  if (!canAnswerDay(target.date, now, Boolean(run))) throw new ChecklistError(DAY_CLOSED_TEXT, 409);
  if (!run && !appliesOn(timingOf(t), target.date)) throw new ChecklistError("Bu liste bugün yok.", 409);
  const item = (run ? run.items : currentItems(t, photos)).find((i) => i.id === target.itemId);
  if (!item) throw new ChecklistError(LIST_CHANGED_TEXT, 409);
  if (item.type !== "photo") throw new ChecklistError("Bu madde bu şekilde işaretlenemez.", 400);
  if (slotLocked(target.date, item.section, now)) throw new ChecklistError(slotLockedText(item.section), 409);
}

/**
 * Fotoğrafın bağlı olduğu kaydın günü, listenin personele açık olup olmadığı ve açıldığı an (fotoğrafı kim görür);
 * bağlı değilse null
 */
export async function photoRun(db: Db, photoId: number): Promise<{ date: string; staffAllowed: boolean; staffSince: string | null } | null> {
  const [row] = await db
    .select({ date: s.checklistRuns.date, staffAllowed: s.checklistTemplates.staffAllowed, staffSince: s.checklistTemplates.staffSince })
    .from(s.checklistAnswers)
    .innerJoin(s.checklistRuns, eq(s.checklistRuns.id, s.checklistAnswers.runId))
    .innerJoin(s.checklistTemplates, eq(s.checklistTemplates.id, s.checklistRuns.templateId))
    .where(eq(s.checklistAnswers.photoId, photoId))
    .limit(1);
  return row ? { date: row.date, staffAllowed: row.staffAllowed, staffSince: row.staffSince?.toISOString() ?? null } : null;
}
