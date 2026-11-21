"use server";

import { and, count, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { dateTR } from "@/lib/format";
import { todayTR } from "@/lib/reminders";
import { anchorTimeOnEdit, completeTarget, isTime, postponeTarget, type UserRepeat } from "@/lib/user-reminders";
import { requireUser } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";

import { attempt, UserError, zDate, zOptText, zText } from "./util";

// Kişisel hatırlatıcılar: her eylem yalnız oturumdaki kişinin KENDİ kayıtlarına dokunur (sorgu userId ile
// süzülür); başkasının kimliği verilse de "bulunamadı" döner. İşlem geçmişine yazılmaz (kişisel not, işletme
// kaydı değil).
//
// Tek istisna EKLEME (4 Kasım 2026, sahibin isteği): yönetici hatırlatıcıyı başka bir kullanıcıya atayabilir
// (İbrahim, Damla ...). Atanan kayıt o kişinindir — yalnız o görür, erteler, tamamlar ve siler; atayan onu
// sonradan göremez ve değiştiremez. Kim kurduğu `createdByName`'de durur, ekranda "… kurdu" diye görünür.

const zId = z.number().int().positive();
/** Kişi başına açık hatırlatıcı sınırı (yanlışlıkla döngüyle eklenen yüzlercesi listeyi ve sabah bildirimini boğmasın) */
const MAX_ACTIVE = 200;
const zTime = z
  .string()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isTime(v), "Saat SS:DD biçiminde olmalı (ör. 15:30)");

const reminderSchema = z.object({
  id: zId.nullable(),
  title: zText("Başlık", 120),
  note: zOptText(500),
  dueDate: zDate,
  dueTime: zTime,
  repeat: z.enum(["none", "daily", "weekly", "monthly"]),
  sound: z.enum(["tek", "surekli", "yok"]).default("tek"),
  /** Yalnız EKLEMEDE ve yalnız yöneticide: hatırlatıcıyı bu kullanıcıya kur (boşsa kendine) */
  forUserId: zId.nullish().transform((v) => v ?? null),
});

const mine = (id: number, userId: number) => and(eq(s.userReminders.id, id), eq(s.userReminders.userId, userId));

export async function saveUserReminder(input: z.input<typeof reminderSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    const { id, forUserId, ...data } = reminderSchema.parse(input);
    const db = getDb();
    if (id) {
      const [prev] = await db.select().from(s.userReminders).where(mine(id, me.id)).limit(1);
      if (!prev) throw new UserError("Hatırlatıcı bulunamadı");
      // Tarih elle değişirse tekrarın günü de yeni tarihe bağlanır; tamamlanmış tek seferlik yeniden açılır. Saat de:
      // elle değişen saat serinin saati olur, ertelenmiş dönemin formundaki erteleme saati olmaz (anchorTimeOnEdit)
      const anchorDate = prev.dueDate !== data.dueDate || prev.repeat !== data.repeat ? data.dueDate : prev.anchorDate;
      const anchorTime = anchorTimeOnEdit(prev, data.dueTime);
      // Sahibi değişmez: atama yalnız eklemede olur, sonradan devredilmez
      await db
        .update(s.userReminders)
        .set({ ...data, anchorDate, anchorTime, active: true, updatedAt: new Date() })
        .where(mine(id, me.id));
    } else {
      const hedef = await assignTarget(me, forUserId);
      const [{ n }] = await db
        .select({ n: count() })
        .from(s.userReminders)
        .where(and(eq(s.userReminders.userId, hedef), eq(s.userReminders.active, true)));
      if (n >= MAX_ACTIVE) {
        throw new UserError(
          hedef === me.id
            ? `En fazla ${MAX_ACTIVE} açık hatırlatıcı olabilir; tamamlananları ya da gereksizleri silin`
            : `Bu kişinin ${MAX_ACTIVE} açık hatırlatıcısı var; önce birkaçını kapatması gerekir`,
        );
      }
      await db.insert(s.userReminders).values({
        ...data,
        userId: hedef,
        anchorDate: data.dueDate,
        anchorTime: data.dueTime,
        // Kendine kurduğunda "kim kurdu" yazılmaz: liste sade kalsın
        createdBy: hedef === me.id ? null : me.id,
        createdByName: hedef === me.id ? null : me.name,
      });
    }
    refresh();
    return null;
  });
}

/**
 * Hatırlatıcı kime kurulacak. Boşsa kendine. Başkası verildiyse YALNIZ yönetici kurabilir ve hedef etkin bir
 * kullanıcı olmalı; personel başkasına kuramaz (kendi kimliğini vermesi serbesttir).
 */
async function assignTarget(me: { id: number; role: string }, forUserId: number | null): Promise<number> {
  if (forUserId === null || forUserId === me.id) return me.id;
  if (me.role !== "admin") throw new UserError("Hatırlatıcıyı yalnız kendinize kurabilirsiniz");
  const [hedef] = await getDb()
    .select({ id: s.users.id })
    .from(s.users)
    .where(and(eq(s.users.id, forUserId), eq(s.users.active, true)))
    .limit(1);
  if (!hedef) throw new UserError("Kişi bulunamadı");
  return hedef.id;
}

export async function deleteUserReminder(id: number) {
  return attempt(async () => {
    const me = await requireUser();
    const [d] = await getDb().delete(s.userReminders).where(mine(zId.parse(id), me.id)).returning({ id: s.userReminders.id });
    if (!d) throw new UserError("Hatırlatıcı bulunamadı");
    refresh();
    return null;
  });
}

type Snapshot = { dueDate: string; dueTime: string | null; active: boolean; doneAt: string | null };

/**
 * Tamamlandı: tekrar eden bir sonraki döneme serinin saatiyle ilerler (bugünü geçene kadar; "1 saat sonra" ertelemesi
 * yalnız o dönemindi, `completeTarget`), tek seferlik kapanır. Dönen `prev` bildirimdeki "Geri al" ile kaydı eski
 * hâline getirir (saat çapası hiç değişmediği için geri almada yazılmaz).
 */
export async function completeUserReminder(id: number) {
  return attempt(async () => {
    const me = await requireUser();
    const rid = zId.parse(id);
    const db = getDb();
    const [r] = await db.select().from(s.userReminders).where(mine(rid, me.id)).limit(1);
    if (!r) throw new UserError("Hatırlatıcı bulunamadı");
    if (!r.active) throw new UserError("Bu hatırlatıcı zaten tamamlanmış");
    const prev: Snapshot = { dueDate: r.dueDate, dueTime: r.dueTime, active: r.active, doneAt: r.doneAt?.toISOString() ?? null };
    const target = completeTarget({ dueDate: r.dueDate, dueTime: r.dueTime, anchorDate: r.anchorDate, anchorTime: r.anchorTime, repeat: r.repeat as UserRepeat }, todayTR());
    await db
      .update(s.userReminders)
      .set(target ? { ...target, doneAt: new Date(), updatedAt: new Date() } : { active: false, doneAt: new Date(), updatedAt: new Date() })
      .where(mine(rid, me.id));
    refresh();
    const next = target?.dueDate ?? null;
    return { next, prev, nextLabel: next ? dateTR(next) : null };
  });
}

const snapshotSchema = z.object({
  dueDate: zDate,
  dueTime: zTime,
  active: z.boolean(),
  doneAt: z
    .string()
    .max(40)
    .nullable()
    .refine((v) => v === null || !Number.isNaN(new Date(v).getTime()), "Geçersiz tarih"),
});

/** Geri al: "Tamamlandı" ya da "Ertele"den önceki hâl */
export async function restoreUserReminder(id: number, prev: z.input<typeof snapshotSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    const snap = snapshotSchema.parse(prev);
    const [r] = await getDb()
      .update(s.userReminders)
      .set({ dueDate: snap.dueDate, dueTime: snap.dueTime, active: snap.active, doneAt: snap.doneAt ? new Date(snap.doneAt) : null, updatedAt: new Date() })
      .where(mine(zId.parse(id), me.id))
      .returning({ id: s.userReminders.id });
    if (!r) throw new UserError("Hatırlatıcı bulunamadı");
    refresh();
    return null;
  });
}

/** Ertele: bir saat (saatliyse) ya da ertesi gün. Yalnız bu dönemin tarih ve saati kayar; çapalar (gün, saat) kalır */
export async function postponeUserReminder(id: number, by: "hour" | "day") {
  return attempt(async () => {
    const me = await requireUser();
    const rid = zId.parse(id);
    const step = z.enum(["hour", "day"]).parse(by);
    const db = getDb();
    const [r] = await db.select().from(s.userReminders).where(mine(rid, me.id)).limit(1);
    if (!r) throw new UserError("Hatırlatıcı bulunamadı");
    if (!r.active) throw new UserError("Tamamlanmış hatırlatıcı ertelenemez");
    const prev: Snapshot = { dueDate: r.dueDate, dueTime: r.dueTime, active: r.active, doneAt: r.doneAt?.toISOString() ?? null };
    const target = postponeTarget(r, step, new Date());
    await db.update(s.userReminders).set({ ...target, updatedAt: new Date() }).where(mine(rid, me.id));
    refresh();
    return { ...target, prev };
  });
}
