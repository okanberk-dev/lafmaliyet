import "server-only";

import { and, count, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";

import { ALL_BRANCHES, type BranchScope } from "@/lib/branches";
import { businessDate } from "@/lib/cash-report";
import { STAFF_SPECIAL_LIMITS, STAFF_SPECIAL_TEXT, staffSpecialCheck, type StaffSpecialInput } from "@/lib/closed-days";
import type { SpecialKind } from "@/lib/takvim";
import { addDays, daysBetween } from "@/lib/reminders";
import { requestDayStart } from "@/lib/staff-requests";
import { lockSpecialDays } from "@/server/closed-days";
import { schema as s, type DB } from "@/server/db";
import type { Actor } from "@/server/staff-requests/core";
import { UserError } from "@/server/user-error";

/*
 * Personelin özel günleri (onaysız; plan docs/planlar/personel-yetki.md §2.9; docs/SATIS-TAHMINI.md › Personelin özel
 * günleri): yarından 60 gün ileriye, en çok 3 günlük maç, AVM etkinliği, kampanya ya da diğer; kişinin gelecekte
 * kapsadığı günler en çok 14, iş gününde en çok 20 yazım. Kişi yalnız kendi girdiği, başlamamış ve yöneticinin
 * dokunmadığı satırı değiştirir ya da siler. Yazımlar özel günlerin danışma kilidi altında (yöneticinin yazımıyla
 * sıraya girer). Sunucu eylemi değil: src/server/actions/special-days-staff.ts (tests/kapali-gun-db.test.ts).
 */

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/**
 * Kişinin şubesinin özel günleri (docs/SUBE.md › Kapalı gün): maç, AVM etkinliği ve kampanya şubesizdir, her şubede
 * görünür; kapalı gün şubenindir: tek şube seçiliyken (personelin kilitli şubesi ya da seçicisi) o şubenin ve işletme
 * genelinin kapalı günleri. "Tümü"de koşul yok. Liste ve çakışma denetimi aynı koşulu kullanır: Tuzla'nın kapalı günü
 * Marina'nın personelinin maçını "çakışıyor" diye reddetmesin
 */
const specialScopeWhere = (scope: BranchScope) =>
  scope === ALL_BRANCHES ? undefined : or(ne(s.specialDays.kind, "kapali"), isNull(s.specialDays.branchId), eq(s.specialDays.branchId, scope));

export interface StaffSpecialSave extends StaffSpecialInput {
  id?: number | null;
  note: string | null;
}

export interface StaffSpecialValues {
  kind: SpecialKind;
  title: string;
  dateFrom: string;
  dateTo: string;
  effect: number;
  note: string | null;
}

/** Kişinin bugünkü özel gün yazımları (işlem geçmişinden; iş günü 05:00'te döner) */
async function writesToday(tx: Tx, me: Actor, now: Date): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(s.activityLog)
    .where(and(eq(s.activityLog.userId, me.id), gte(s.activityLog.at, requestDayStart(now)), sql`${s.activityLog.action} like 'Özel gün%'`));
  return row?.n ?? 0;
}

/** Kişinin bu satır dışındaki satırlarının gelecekte (yarından sonra) kapsadığı gün sayısı */
async function ownFutureDays(tx: Tx, me: Actor, today: string, exceptId: number | null): Promise<number> {
  const rows = await tx
    .select({ from: s.specialDays.dateFrom, to: s.specialDays.dateTo })
    .from(s.specialDays)
    .where(and(eq(s.specialDays.createdBy, me.id), eq(s.specialDays.byStaff, true), gte(s.specialDays.dateTo, addDays(today, 1)), exceptId ? ne(s.specialDays.id, exceptId) : undefined));
  return rows.reduce((a, r) => {
    const from = r.from > today ? r.from : addDays(today, 1);
    return a + Math.max(0, daysBetween(from, r.to) + 1);
  }, 0);
}

/** Düzenlenen satır: kişinin kendi girdiği mi, başladı mı, yönetici dokundu mu */
async function editable(tx: Tx, me: Actor, id: number, today: string) {
  const [row] = await tx.select().from(s.specialDays).where(eq(s.specialDays.id, id)).for("update").limit(1);
  if (!row) throw new UserError("Özel gün bulunamadı (sayfayı yenileyin)");
  return {
    row,
    state: {
      own: row.createdBy === me.id && row.byStaff && row.kind !== "kapali",
      started: row.dateFrom <= today,
      adminTouched: row.updatedBy !== null && row.updatedBy !== me.id,
    },
  };
}

/**
 * Personelin özel günü: ekler ya da (id ile) kendi satırını düzenler. Dönüşte satırın kimliği ve önceki değerler.
 * `scope`: kişinin şube seçimi; çakışma yalnız o şubenin ve işletme genelinin kapalı günleriyle aranır
 */
export async function saveStaffSpecialCore(db: DB, me: Actor, input: StaffSpecialSave, now = new Date(), scope: BranchScope = ALL_BRANCHES): Promise<{ id: number; created: boolean; values: StaffSpecialValues }> {
  if (me.role === "admin") throw new UserError(STAFF_SPECIAL_TEXT.adminDirect);
  const dateTo = input.dateTo || input.dateFrom;
  const title = input.title.trim();
  return db.transaction(async (tx) => {
    await lockSpecialDays(tx);
    const today = businessDate(now);
    const editing = input.id ? (await editable(tx, me, input.id, today)).state : null;
    const overlapping = await tx
      .select({ id: s.specialDays.id, title: s.specialDays.title })
      .from(s.specialDays)
      .where(and(lte(s.specialDays.dateFrom, dateTo), gte(s.specialDays.dateTo, input.dateFrom), input.id ? ne(s.specialDays.id, input.id) : undefined, specialScopeWhere(scope)));
    const refusal = staffSpecialCheck(
      { kind: input.kind, title, dateFrom: input.dateFrom, dateTo, effect: input.effect },
      { today, ownFutureDays: await ownFutureDays(tx, me, today, input.id ?? null), overlapping: overlapping.map((o) => o.title), writesToday: await writesToday(tx, me, now), editing },
    );
    if (refusal) throw new UserError(refusal);
    const values: StaffSpecialValues = { kind: input.kind as SpecialKind, title, dateFrom: input.dateFrom, dateTo, effect: input.effect, note: input.note?.trim() || null };
    if (input.id) {
      await tx
        .update(s.specialDays)
        .set({ ...values, updatedBy: me.id, updatedByName: me.name, updatedAt: now })
        .where(eq(s.specialDays.id, input.id));
      return { id: input.id, created: false, values };
    }
    const [row] = await tx
      .insert(s.specialDays)
      .values({ ...values, byStaff: true, createdBy: me.id, createdByName: me.name })
      .returning({ id: s.specialDays.id });
    return { id: row.id, created: true, values };
  });
}

/** Personel kendi başlamamış, yöneticinin dokunmadığı özel gününü siler; silinenin değerleri döner */
export async function deleteStaffSpecialCore(db: DB, me: Actor, id: number, now = new Date()): Promise<StaffSpecialValues> {
  if (me.role === "admin") throw new UserError(STAFF_SPECIAL_TEXT.adminDirect);
  return db.transaction(async (tx) => {
    await lockSpecialDays(tx);
    const today = businessDate(now);
    const { row, state } = await editable(tx, me, id, today);
    if (!state.own || state.started || state.adminTouched) throw new UserError(STAFF_SPECIAL_TEXT.locked);
    if ((await writesToday(tx, me, now)) >= STAFF_SPECIAL_LIMITS.dailyWrites) throw new UserError(STAFF_SPECIAL_TEXT.daily);
    await tx.delete(s.specialDays).where(eq(s.specialDays.id, id));
    return { kind: row.kind as SpecialKind, title: row.title, dateFrom: row.dateFrom, dateTo: row.dateTo, effect: row.effect, note: row.note };
  });
}

/** Personelin listesindeki satır (sabit sütunlar; tahmin tutarı, gerçekleşen etki ve başkasının notu yok) */
export interface StaffSpecialRow {
  id: number;
  kind: SpecialKind;
  title: string;
  dateFrom: string;
  dateTo: string;
  effect: number;
  /** Yalnız kişinin kendi satırında */
  note: string | null;
  /** Personelin satırında ekleyen ("Ahmet ekledi"); yöneticinin satırında null */
  addedBy: string | null;
  /** Kişi bu satırı değiştirebilir: kendi girdiği, başlamamış, yöneticinin dokunmadığı */
  editable: boolean;
  /** Kapalı günün şubesi (boş: bütün şubeler); öbür türlerde null. Sayfa "Tümü"de şubenin adını yazar */
  branchId: string | null;
  /** "Tümü"de birden çok kasa açıkken kapalı günün şubesi ("Marina", "Bütün şubeler"); sayfa doldurur */
  branchName?: string | null;
}

/**
 * Personelin "Yaklaşan" listesi: bugün ile 60 gün ilerisi arasındaki özel günler. Yalnız special_days okunur, sabit
 * sütunlarla (tests/personel-sizinti-kasa.test.ts). `scope`: kişinin şube seçimi (kilitli personelde kendi şubesi);
 * öbür şubenin kapalı günü listeye girmez (`specialScopeWhere`)
 */
export async function staffSpecialList(db: DB, me: { id: number }, now = new Date(), scope: BranchScope = ALL_BRANCHES): Promise<StaffSpecialRow[]> {
  const today = businessDate(now);
  const rows = await db
    .select({
      id: s.specialDays.id,
      kind: s.specialDays.kind,
      title: s.specialDays.title,
      dateFrom: s.specialDays.dateFrom,
      dateTo: s.specialDays.dateTo,
      effect: s.specialDays.effect,
      note: s.specialDays.note,
      byStaff: s.specialDays.byStaff,
      createdBy: s.specialDays.createdBy,
      createdByName: s.specialDays.createdByName,
      updatedBy: s.specialDays.updatedBy,
      branchId: s.specialDays.branchId,
    })
    .from(s.specialDays)
    .where(and(gte(s.specialDays.dateTo, today), lte(s.specialDays.dateFrom, addDays(today, 60)), specialScopeWhere(scope)))
    .orderBy(s.specialDays.dateFrom, s.specialDays.id);
  return rows.map((r) => {
    const own = r.createdBy === me.id && r.byStaff && r.kind !== "kapali";
    return {
      id: r.id,
      kind: r.kind as SpecialKind,
      title: r.title,
      dateFrom: r.dateFrom,
      dateTo: r.dateTo,
      effect: r.effect,
      note: own ? r.note : null,
      addedBy: r.byStaff ? r.createdByName : null,
      editable: own && r.dateFrom > today && (r.updatedBy === null || r.updatedBy === me.id),
      branchId: r.kind === "kapali" ? r.branchId : null,
    };
  });
}
