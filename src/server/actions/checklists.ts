"use server";

import { and, asc, count, eq, max, ne, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { activityChange, listTitle, MAX_ITEMS, MAX_PHOTO_ITEMS, NOTE_MAX, rangeText, staffSinceChange, weekdaysText, windowError } from "@/lib/checklists";
import { requireAdmin, requireUser } from "@/server/auth/dal";
import { ChecklistError, logAnswerActivity, writeChecklistAnswer } from "@/server/data/checklists";
import { listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";
import { deletePhoto } from "@/server/storage/photos";

import { logActivity } from "./log";
import { attempt, UserError, zDate, zOptText, zText } from "./util";

// Kontrol listeleri (docs/KONTROL-LISTELERI.md): maddeyi işaretleme (iki rol; fotoğraflar POST /api/kontrol/foto'dan)
// ve listelerin düzenlenmesi (yalnız yönetici). Yönetici hesabını etkileyen bir şey yok: parolayla onay istenmez.

const base = { templateId: z.number().int().positive(), date: zDate, itemId: z.number().int().positive() };
const note = z
  .string()
  .trim()
  .max(NOTE_MAX, "Not çok uzun (en çok 300 karakter)")
  .nullish()
  .transform((v) => v || null);
const value = z.number({ message: "Sayıyı yazın" }).finite("Sayıyı yazın").min(-100, "Değer -100 ile 1000 arasında olmalı").max(1000, "Değer -100 ile 1000 arasında olmalı");

const answerSchema = z.discriminatedUnion("op", [
  z.object({ ...base, op: z.literal("ok") }),
  z.object({
    ...base,
    op: z.literal("issue"),
    note: z.string({ message: "Sorunu kısaca yazın" }).trim().min(1, "Sorunu kısaca yazın").max(NOTE_MAX, "Not çok uzun (en çok 300 karakter)"),
  }),
  z.object({ ...base, op: z.literal("value"), value, note }),
  // Boş yazı yanıtı geri alır
  z.object({ ...base, op: z.literal("text"), text: z.string().trim().max(NOTE_MAX, "Not çok uzun (en çok 300 karakter)") }),
  z.object({ ...base, op: z.literal("note"), note }),
  z.object({ ...base, op: z.literal("clear") }),
]);

/**
 * Maddeyi işaretler: Tamam, Sorun var (not zorunlu), ölçüm (aralık dışıysa not zorunlu), kısa not, fotoğrafın notu ya da
 * geri al. Liste ilk yanıtla açılır, bütün zorunlu maddeler yanıtlanınca kendiliğinden tamamlanır. Değişen fotoğraf
 * yanıttan sonra silinir.
 */
export async function answerChecklistItem(input: z.input<typeof answerSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    const data = answerSchema.parse(input);
    const now = new Date();
    const op = data.op === "text" && !data.text ? { ...data, op: "clear" as const } : data;
    let r;
    try {
      r = await writeChecklistAnswer(me, op, now);
    } catch (e) {
      if (e instanceof ChecklistError) throw new UserError(e.message);
      throw e;
    }
    const old = r.previousPhotoId;
    if (old) after(() => deletePhoto(old).catch((e: unknown) => console.error("[kontrol] eski fotoğraf silinemedi", old, e instanceof Error ? e.message : e)));
    await logAnswerActivity(me, r);
    refresh();
    return { answer: r.answer, summary: r.summary, completedNow: r.completedNow };
  });
}

// ---------------------------------------------------------------- Listeler (yalnız yönetici)

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

const templateSchema = z
  .object({
    name: zText("Liste adı", 60),
    description: zOptText(300),
    opensAt: z.string().regex(CLOCK, "Saati 08:00 biçiminde yazın"),
    dueAt: z.string().regex(CLOCK, "Saati 08:00 biçiminde yazın"),
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1, "En az bir gün seçin")
      .transform((d) => [...new Set(d)].sort((a, b) => a - b)),
    staffAllowed: z.boolean(),
    active: z.boolean(),
    /** Listenin şubesi; boş: bütün şubeler (eski istemci alanı göndermezse de bütün şubeler) */
    branchId: z
      .string()
      .trim()
      .nullish()
      .transform((v) => v || null),
  })
  .superRefine((d, ctx) => {
    const error = windowError(d.opensAt, d.dueAt);
    if (error) ctx.addIssue({ code: "custom", message: error, path: ["dueAt"] });
  });

type TemplateInput = z.output<typeof templateSchema>;

const idSchema = z.number().int().positive();

/** Aynı adda (büyük / küçük harf farkıyla) başka liste var mı */
async function nameTaken(name: string, exceptId?: number): Promise<boolean> {
  const t = s.checklistTemplates;
  const [row] = await getDb()
    .select({ id: t.id })
    .from(t)
    .where(and(sql`lower(${t.name}) = lower(${name})`, exceptId ? ne(t.id, exceptId) : undefined))
    .limit(1);
  return Boolean(row);
}

const windowText = (d: { opensAt: string; dueAt: string }) => `${d.opensAt} – ${d.dueAt}`;

/**
 * Listenin şubesi kütükte bir fiziksel şube mi (online kanalın kafesi yok). Düzenlemede listenin şimdiki şubesi pasife
 * alınmış olsa da kalabilir; yeni seçim etkin olmalı. Ad işlem geçmişine yazılır.
 */
async function checkBranch(branchId: string | null, keep?: string | null): Promise<string | null> {
  if (!branchId) return null;
  const branches = await listBranches();
  const b = branches.find((x) => x.id === branchId && x.kind === "fiziksel" && (x.active || x.id === keep));
  if (!b) throw new UserError("Şube bulunamadı ya da pasif (sayfayı yenileyin)");
  return b.name;
}

/** Yeni liste: sona eklenir, eklendiği andan etkin (aralığı bugün çoktan açıldıysa bugün beklenmez) */
export async function createChecklistTemplate(input: z.input<typeof templateSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = templateSchema.parse(input);
    if (await nameTaken(data.name)) throw new UserError("Bu adda bir liste var");
    const branchName = await checkBranch(data.branchId);
    const db = getDb();
    const t = s.checklistTemplates;
    const [{ last }] = await db.select({ last: max(t.sortOrder) }).from(t);
    const now = new Date();
    const [row] = await db
      .insert(t)
      .values({ ...data, ...staffSinceChange(false, data.staffAllowed, now), schedule: "daily", sortOrder: (last ?? 0) + 1, activeFrom: now, inactiveFrom: data.active ? null : now })
      .returning({ id: t.id });
    await logActivity(me, "Kontrol listesi eklendi", `${data.name}${branchName ? ` · ${branchName}` : ""} · ${weekdaysText(data.weekdays)} · ${windowText(data)}`);
    refresh();
    return { id: row.id };
  });
}

/** Listeyi düzenler; etkinlik değişince anlar activityChange'ten (kapatılıp aralık açılmadan geri açılan liste hiç kapanmamış sayılır) */
export async function updateChecklistTemplate(id: number, input: z.input<typeof templateSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const tid = idSchema.parse(id);
    const data: TemplateInput = templateSchema.parse(input);
    const db = getDb();
    const t = s.checklistTemplates;
    const [prev] = await db.select().from(t).where(eq(t.id, tid)).limit(1);
    if (!prev) throw new UserError("Liste bulunamadı (sayfayı yenileyin)");
    if (await nameTaken(data.name, tid)) throw new UserError("Bu adda bir liste var");
    const branchName = await checkBranch(data.branchId, prev.branchId);
    const now = new Date();
    await db
      .update(t)
      // Personele açılınca an yazılır: personel geçmişte bundan önceki kayıtları görmez (dalga 10 §2.5)
      .set({ ...data, ...activityChange(prev, data, now), ...staffSinceChange(prev.staffAllowed, data.staffAllowed, now), updatedAt: now })
      .where(eq(t.id, tid));
    const changes = [
      prev.name !== data.name ? `ad ${prev.name} → ${data.name}` : null,
      (prev.branchId ?? null) !== data.branchId ? `şube ${branchName ?? "bütün şubeler"}` : null,
      prev.opensAt !== data.opensAt || prev.dueAt !== data.dueAt ? `saat ${prev.opensAt} – ${prev.dueAt} → ${windowText(data)}` : null,
      weekdaysText(prev.weekdays) !== weekdaysText(data.weekdays) ? `günler ${weekdaysText(prev.weekdays)} → ${weekdaysText(data.weekdays)}` : null,
      prev.staffAllowed !== data.staffAllowed ? `personel ${data.staffAllowed ? "doldurabilir" : "dolduramaz"}` : null,
      prev.active !== data.active ? (data.active ? "etkinleştirildi" : "pasife alındı") : null,
      (prev.description ?? null) !== data.description ? "açıklama" : null,
    ].filter(Boolean);
    await logActivity(me, "Kontrol listesi düzenlendi", `${data.name}${changes.length ? ` · ${changes.join(" · ")}` : ""}`);
    refresh();
    return null;
  });
}

/** Listeler'deki Etkin anahtarı (anlar activityChange'ten: yanlışlıkla kapatılıp hemen açılan liste bugünü ve geçmişi kaybetmez) */
export async function setChecklistTemplateActive(id: number, active: boolean) {
  return attempt(async () => {
    const me = await requireAdmin();
    const tid = idSchema.parse(id);
    const on = z.boolean().parse(active);
    const db = getDb();
    const t = s.checklistTemplates;
    const [prev] = await db.select().from(t).where(eq(t.id, tid)).limit(1);
    if (!prev) throw new UserError("Liste bulunamadı (sayfayı yenileyin)");
    const now = new Date();
    await db
      .update(t)
      .set({ ...activityChange(prev, { active: on, weekdays: prev.weekdays, opensAt: prev.opensAt ?? "08:00" }, now), updatedAt: now })
      .where(eq(t.id, tid));
    if (prev.active !== on) await logActivity(me, on ? "Kontrol listesi etkinleştirildi" : "Kontrol listesi pasife alındı", prev.name);
    refresh();
    return null;
  });
}

/** Kaydı olmayan liste maddeleriyle silinir; kaydı olan silinmez (geçmiş kayıtlar kalsın), pasife alınır */
export async function deleteChecklistTemplate(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const tid = idSchema.parse(id);
    const db = getDb();
    const name = await db.transaction(async (tx) => {
      const t = s.checklistTemplates;
      const [prev] = await tx.select().from(t).where(eq(t.id, tid)).for("update").limit(1);
      if (!prev) throw new UserError("Liste bulunamadı (sayfayı yenileyin)");
      const [{ n }] = await tx.select({ n: count() }).from(s.checklistRuns).where(eq(s.checklistRuns.templateId, tid));
      if (n > 0) throw new UserError("Bu listenin kayıtları var; silmek yerine pasife alın.");
      await tx.delete(t).where(eq(t.id, tid));
      return prev.name;
    });
    await logActivity(me, "Kontrol listesi silindi", name);
    refresh();
    return null;
  });
}

// ---------------------------------------------------------------- Maddeler (yalnız yönetici)

const bound = z.number({ message: "Sayı yazın" }).finite("Sayı yazın").min(-100, "Sınır -100 ile 1000 arasında olmalı").max(1000, "Sınır -100 ile 1000 arasında olmalı").nullable();

const itemSchema = z
  .object({
    label: zText("Madde adı", 120),
    type: z.enum(["check", "photo", "number", "text"]),
    section: zOptText(40),
    hint: zOptText(200),
    required: z.boolean(),
    unit: zOptText(10),
    min: bound,
    max: bound,
  })
  .refine((d) => d.type !== "number" || d.min === null || d.max === null || d.min <= d.max, { message: "En az, en çoktan büyük olamaz", path: ["max"] })
  .transform((d) => (d.type === "number" ? d : { ...d, unit: null, min: null, max: null }));

/** Madde ekler ya da düzenler (sınırlar: MAX_ITEMS madde, MAX_PHOTO_ITEMS fotoğraflı); değişiklik o gün başlamış listeye değil sonrakilere */
export async function saveChecklistItem(templateId: number, input: z.input<typeof itemSchema>, id?: number | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const tid = idSchema.parse(templateId);
    const iid = id == null ? null : idSchema.parse(id);
    const data = itemSchema.parse(input);
    const db = getDb();
    const result = await db.transaction(async (tx) => {
      const [tpl] = await tx.select().from(s.checklistTemplates).where(eq(s.checklistTemplates.id, tid)).for("update").limit(1);
      if (!tpl) throw new UserError("Liste bulunamadı (sayfayı yenileyin)");
      const i = s.checklistItems;
      const rows = await tx
        .select({ id: i.id, type: i.type, sortOrder: i.sortOrder })
        .from(i)
        .where(and(eq(i.templateId, tid), eq(i.active, true)))
        .orderBy(asc(i.sortOrder));
      const others = rows.filter((r) => r.id !== iid);
      if (others.length + 1 > MAX_ITEMS) throw new UserError(`Bir listede en çok ${MAX_ITEMS} madde olabilir`);
      if (data.type === "photo" && others.filter((r) => r.type === "photo").length + 1 > MAX_PHOTO_ITEMS) throw new UserError(`Bir listede en çok ${MAX_PHOTO_ITEMS} fotoğraflı madde olabilir`);
      const now = new Date();
      if (iid) {
        const [row] = await tx
          .update(i)
          .set({ ...data, updatedAt: now })
          .where(and(eq(i.id, iid), eq(i.templateId, tid)))
          .returning({ id: i.id });
        if (!row) throw new UserError("Madde bulunamadı (sayfayı yenileyin)");
        return { id: row.id, name: tpl.name, created: false };
      }
      const [{ last }] = await tx.select({ last: max(i.sortOrder) }).from(i).where(eq(i.templateId, tid));
      const [row] = await tx
        .insert(i)
        .values({ ...data, templateId: tid, sortOrder: (last ?? 0) + 1 })
        .returning({ id: i.id });
      await tx.update(s.checklistTemplates).set({ updatedAt: now }).where(eq(s.checklistTemplates.id, tid));
      return { id: row.id, name: tpl.name, created: true };
    });
    const range = data.type === "number" ? rangeText(data) : "";
    await logActivity(me, result.created ? "Kontrol maddesi eklendi" : "Kontrol maddesi düzenlendi", `${listTitle(result.name)} › ${data.label}${range ? ` (${range})` : ""}`);
    refresh();
    return { id: result.id };
  });
}

/** Maddeyi kendi bölümünde bir yukarı / aşağı taşır (bölümdeki komşusuyla yer değiştirir; ekran maddeleri bölüm bölüm gösterir) */
export async function moveChecklistItem(id: number, dir: "up" | "down") {
  return attempt(async () => {
    await requireAdmin();
    const iid = idSchema.parse(id);
    const d = z.enum(["up", "down"]).parse(dir);
    const db = getDb();
    await db.transaction(async (tx) => {
      const i = s.checklistItems;
      const [item] = await tx.select().from(i).where(eq(i.id, iid)).limit(1);
      if (!item || !item.active) throw new UserError("Madde bulunamadı (sayfayı yenileyin)");
      // Listenin satırı kilitlenir: aynı anda iki taşıma sırayı bozmasın
      await tx.select({ id: s.checklistTemplates.id }).from(s.checklistTemplates).where(eq(s.checklistTemplates.id, item.templateId)).for("update");
      const rows = await tx
        .select({ id: i.id, section: i.section, sortOrder: i.sortOrder })
        .from(i)
        .where(and(eq(i.templateId, item.templateId), eq(i.active, true)))
        .orderBy(asc(i.sortOrder), asc(i.id));
      const at = rows.findIndex((r) => r.id === iid);
      const sectionOf = (s: string | null) => s?.trim() || null;
      const same = rows.map((r, k) => ({ k, same: sectionOf(r.section) === sectionOf(item.section) })).filter((x) => x.same).map((x) => x.k);
      const pos = same.indexOf(at);
      const to = d === "up" ? same[pos - 1] : same[pos + 1];
      if (at < 0 || pos < 0 || to === undefined) return;
      // Sıra numaraları baştan yazılır (eşit numaralar da düzelir)
      const order = rows.map((r) => r.id);
      [order[at], order[to]] = [order[to], order[at]];
      for (const [k, rid] of order.entries()) await tx.update(i).set({ sortOrder: k + 1 }).where(eq(i.id, rid));
    });
    refresh();
    return null;
  });
}

/** Madde kaldırılır (arşiv; geçmiş kayıtlarda görünmeye devam eder) ya da geri eklenir (listenin sonuna) */
export async function setChecklistItemActive(id: number, active: boolean) {
  return attempt(async () => {
    const me = await requireAdmin();
    const iid = idSchema.parse(id);
    const on = z.boolean().parse(active);
    const db = getDb();
    const result = await db.transaction(async (tx) => {
      const i = s.checklistItems;
      const [item] = await tx.select().from(i).where(eq(i.id, iid)).limit(1);
      if (!item) throw new UserError("Madde bulunamadı (sayfayı yenileyin)");
      const [tpl] = await tx.select({ name: s.checklistTemplates.name }).from(s.checklistTemplates).where(eq(s.checklistTemplates.id, item.templateId)).for("update").limit(1);
      if (item.active === on) return { label: item.label, name: tpl?.name ?? "", changed: false };
      if (on) {
        const rows = await tx
          .select({ type: i.type })
          .from(i)
          .where(and(eq(i.templateId, item.templateId), eq(i.active, true)));
        if (rows.length + 1 > MAX_ITEMS) throw new UserError(`Bir listede en çok ${MAX_ITEMS} madde olabilir`);
        if (item.type === "photo" && rows.filter((r) => r.type === "photo").length + 1 > MAX_PHOTO_ITEMS) throw new UserError(`Bir listede en çok ${MAX_PHOTO_ITEMS} fotoğraflı madde olabilir`);
        const [{ last }] = await tx.select({ last: max(i.sortOrder) }).from(i).where(eq(i.templateId, item.templateId));
        await tx
          .update(i)
          .set({ active: true, sortOrder: (last ?? 0) + 1, updatedAt: new Date() })
          .where(eq(i.id, iid));
      } else {
        await tx.update(i).set({ active: false, updatedAt: new Date() }).where(eq(i.id, iid));
      }
      return { label: item.label, name: tpl?.name ?? "", changed: true };
    });
    if (result.changed) await logActivity(me, on ? "Kontrol maddesi geri eklendi" : "Kontrol maddesi kaldırıldı", `${listTitle(result.name)} › ${result.label}`);
    refresh();
    return null;
  });
}
