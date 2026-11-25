"use server";

import { and, asc, eq, gt, inArray, lt, ne } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { BRANCH_REQUIRED } from "@/lib/branches";
import { activeFromRange, currentMonthTR, inRange, mealCardCarry, planVersionChange, shiftMonth } from "@/lib/calc/engine";
import { resolveMonths, tillMonths } from "@/lib/cash-month";
import { businessDate } from "@/lib/cash-report";
import { FIXED_VAT_RATES, MONTH_NAMES } from "@/lib/constants";
import { monthLabel, tl } from "@/lib/format";
import { addDays } from "@/lib/reminders";
import { linkConflict, PERSON_REF_PATTERN, type LinkRow } from "@/lib/staff-link";
import { requireAdmin } from "@/server/auth/dal";
import { tillRows } from "@/server/data/cash-reports";
import { fixedReminderMessage, followFixedReminders, type FollowResult } from "@/server/data/fixed-follow";
import { lockStaffLinks } from "@/server/data/staff-links";
import { ALL_BRANCHES } from "@/lib/branches";
import { currentPhysicalBranch, withBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";
import { attempt, UserError, zMonth, zOptText, zRate, zText } from "./util";

// ---------------------------------------------------------------- Geçmiş aylar (ortak)
//
// Kira, maaş gibi tutarlar "şu aydan itibaren" değişir; önceki aylar eski tutarla kalır (Excel'de her ay
// sütunu kendi sabitini taşır). Kalemin hesaba girdiği aylar startMonth / endMonth ile sınırlanır.

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** "YYYY-MM" (o aydan itibaren) ya da "all" (bütün aylar: yanlış girilmiş tutarı düzeltmek için) */
const zEffective = z.union([zMonth, z.literal("all")], { message: "Geçerlilik ayı seçin" });
type Effective = z.infer<typeof zEffective>;

/** Kaydın sonucu: istemci ne olduğunu kullanıcıya söyleyebilsin */
type ChangeMode = "none" | "base" | "version";

const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** "Temmuz–Eylül 2026", "Eylül 2026", "Aralık 2026 – Ocak 2027" */
function spanText(months: string[]): string {
  const sorted = [...months].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === last) return monthLabel(first);
  if (first.slice(0, 4) === last.slice(0, 4)) return `${MONTH_NAMES[Number(first.slice(5)) - 1]}–${monthLabel(last)}`;
  return `${monthLabel(first)} – ${monthLabel(last)}`;
}

/**
 * Hesabı olan aylar: açık günü olan ay (elle yazılmış ya da kasa raporlarından; giderler/history-text.ts
 * closedDataMonths ile aynı etkin değer) ya da gelir-gider tablosunda elle giriş olan ay. `before` verilirse yalnızca o
 * aydan önceki (kapanmış) aylar. Kasa raporlarından açık günü gelen ay da veri ayıdır: maaş ve sabit gider sürümü onu
 * geriye dönük değiştirmesin.
 */
async function dataMonths(tx: Tx, before?: string): Promise<string[]> {
  // ŞUBE SEÇİMİNDEN BAĞIMSIZ okunur (withBranchScope ile "hepsi"). Çıktısının gittiği her yer bir SİLME /
  // DEĞİŞTİRME ENGELİ: saveStaff, staffDeleteBlockers, deleteFixedExpense, fixedDeleteBlockers — artı ay
  // seçicisinin ilk veri ayı. Seçili şubeye göre süzülürse Marina seçiliyken `past` boşalır, staffUsedMonths
  // hiçbir ay bulmaz ve Tuzla'da maaş hesabına girmiş kişi silinebilir hale gelir (docs/SUBE.md › Neyi süzer,
  // neyi süzmez). Aynısı sabit gider için geçerli. tillRows de bu kapsamın içinde: o da ay rakamını getiriyor.
  return withBranchScope(ALL_BRANCHES, async () => {
    const [rows, till] = await Promise.all([
      tx
        .select({
          month: s.months.month,
          openDays: s.months.openDays,
          posRevenue: s.months.posRevenue,
          discounts: s.months.discounts,
          offRevenue: s.months.offRevenue,
          cardShare: s.months.cardShare,
          note: s.months.note,
        })
        .from(s.months),
      tillRows(tx),
    ]);
    const ms = resolveMonths(rows, tillMonths(till, addDays(businessDate(), -1)))
      .filter((m) => (m.openDays ?? 0) > 0 && (!before || m.month < before))
      .map((m) => ({ m: m.month }));
    const ps = await tx
      .selectDistinct({ m: s.pnlEntries.month })
      .from(s.pnlEntries)
      .where(before ? lt(s.pnlEntries.month, before) : undefined);
    return [...new Set([...ms, ...ps].map((r) => r.m))].sort();
  });
}

/**
 * Geçerlilik ayı vermeyen eski bir ekran, sürümlerden habersiz taban değeri geri gönderiyor mu?
 * (Liste taban değeri gösterip "pasif yap" gibi başka bir alan için kaydederse sürüm sessizce geri alınmasın.)
 * Tutar değiştirmek isteyen ekranlar her zaman effectiveFrom göndermelidir.
 */
function echoOfBase<T>(base: T, versions: unknown[], next: T, equal: (a: T, b: T) => boolean): boolean {
  return versions.length > 0 && equal(base, next);
}

function latestBefore<V extends { fromMonth: string }>(versions: V[], month: string): V | undefined {
  return versions.filter((v) => v.fromMonth < month).sort((a, b) => b.fromMonth.localeCompare(a.fromMonth))[0];
}

/**
 * Formdan gelen şube (docs/SUBE.md): kütükte ve açık olmalı; `physical` ise fiziksel şube (personel bir şubede
 * çalışır, online kanalın personeli yok). null = işletme geneli (yalnız sabit gider), undefined = değişmez
 */
async function checkedBranch(raw: string | null | undefined, physical: boolean): Promise<string | null | undefined> {
  if (raw === undefined || raw === null) return raw;
  // Boş seçim ("Tümü"de şube sorulan form): sessizce varsayılana düşülmez (şube kapsamı C P2-12)
  if (raw === "") throw new UserError(BRANCH_REQUIRED);
  const b = (await listBranches()).find((x) => x.id === raw && x.active);
  if (!b || (physical && b.kind !== "fiziksel")) throw new UserError("Seçilen şube bulunamadı ya da kapalı (sayfayı yenileyin)");
  return b.id;
}

// ---------------------------------------------------------------- Personel

const staffRowSchema = z.object({
  id: z.number().int().positive().nullable(),
  name: zText("Personel adı", 80),
  netSalary: z.number().finite().min(0),
  extras: z.number().finite().min(0),
  /** Yemek kartı (Faz 5): Ayarlar'daki günlük tutar × gün, brütleştirilmez. Verilmezse geçerlilik ayındaki değer kalır */
  mealCard: z.boolean().optional(),
  /** Tam zamanlı ya da part-time (Faz 5); verilmezse değişmez, yeni kişide tam zamanlı */
  kind: z.enum(["full_time", "part_time"]).optional(),
  /** Part-time günlük ücret (₺; SGK brütleştirmesi yok). Verilmezse geçerlilik ayındaki değer kalır */
  dailyWage: z.number().finite().min(0).max(100_000).optional(),
  /**
   * Vardiya / hesap bağlantısı (Faz 5): panel hesabı ya da hesabı olmayan Vardiya adı ("n:<ad>"); ikisi birden olmaz.
   * null = bağlantıyı kaldır, verilmezse değişmez. Yalnız açık seçim: sunucu kendiliğinden bağlamaz
   */
  userId: z.number().int().positive().nullable().optional(),
  personRef: z.string().regex(PERSON_REF_PATTERN, "Vardiya kişisi geçersiz (sayfayı yenileyin)").nullable().optional(),
  /** Eski kullanım: false → geçen ay sonunda bitir, true → bitiş ayını kaldır. Yeni ekranlar endStaff kullanır. */
  active: z.boolean().optional(),
  /** İşe başladığı ay (null = baştan beri). Yeni kişide verilmezse geçerlilik ayı (varsayılan bu ay). */
  startMonth: zMonth.nullable().optional(),
  /** Maaş değişikliği hangi aydan itibaren; verilmezse opts.effectiveFrom, o da yoksa bu ay */
  effectiveFrom: zEffective.optional(),
  /** Çalıştığı şube (maaşı o şubenin gideri); verilmezse değişmez, yeni kişide seçili şube ("Tümü"de Tuzla) */
  branchId: z.string().max(24).optional(),
});
const staffSchema = z.array(staffRowSchema).max(200);

interface StaffChange {
  id: number;
  name: string;
  mode: ChangeMode;
  fromMonth: string | null;
}

/**
 * Personel listesini kaydeder. Net maaş / ek ödeme değişikliği varsayılan olarak bu aydan itibaren geçerlidir
 * (geçmiş aylar eski maaşla kalır); `effectiveFrom: "all"` bütün ayları düzeltir. Geçmiş bir ayın maaş
 * hesabına girmiş kişi silinemez: bitiş ayı (endStaff) verilmelidir.
 */
export async function saveStaff(
  rows: z.input<typeof staffSchema>,
  removedIds: number[] = [],
  opts: { effectiveFrom?: Effective } = {},
) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = staffSchema.parse(rows);
    const removed = z.array(z.number().int().positive()).max(200).parse(removedIds);
    const defaultEff = zEffective.optional().parse(opts.effectiveFrom);
    const cur = currentMonthTR();
    const db = getDb();
    const changes: StaffChange[] = [];
    /** Yemek kartı işaretinin taşındığı sonraki sürümler (kişi adı, aylar; inceleme bulgusu 8) */
    const carried: { name: string; months: string[] }[] = [];
    // Şubeler işlemden önce doğrulanır; yeni kişinin şubesi verilmezse seçili fiziksel şube
    const branchOf = new Map<number, string>();
    for (const [i, r] of data.entries()) {
      const b = await checkedBranch(r.branchId, true);
      if (b) branchOf.set(i, b);
    }
    const newcomerBranch = data.some((r, i) => !r.id && !branchOf.has(i)) ? (await currentPhysicalBranch()).id : null;
    for (const r of data) {
      if (r.userId && r.personRef) throw new UserError(`${r.name}: hem panel hesabı hem Vardiya adı seçilemez`);
    }
    await db.transaction(async (tx) => {
      // Bağlantı denetimi ve yazım aynı kilit altında: eşzamanlı ikinci kayıt öbürünün yazdığını görür (inceleme bulgusu 6)
      await lockStaffLinks(tx);
      const past = await dataMonths(tx, cur);
      const firstData = (await dataMonths(tx))[0] ?? null;
      // Bağlantılar (Faz 5): hesap var mı, hesabın şubesi satırın şubesi mi, aynı kişi aynı ayda iki satırda mı
      await checkStaffLinks(tx, data, removed, (i, before) => branchOf.get(i) ?? before ?? newcomerBranch!, cur);
      for (const id of removed) {
        const [row] = await tx.select().from(s.staff).where(eq(s.staff.id, id));
        if (!row) continue;
        const used = staffUsedMonths(row, past);
        if (used.length) {
          throw new UserError(
            `${row.name} ${spanText(used)} maaş hesabına girdi; silinirse o ayların personel gideri değişir. Silmek yerine ayrıldığı ayı (bitiş ayı) girin.`,
          );
        }
        await tx.delete(s.staff).where(eq(s.staff.id, id));
      }
      for (const [i, r] of data.entries()) {
        const eff = r.effectiveFrom ?? defaultEff ?? cur;
        if (!r.id) {
          const startMonth = r.startMonth !== undefined ? r.startMonth : eff === "all" ? null : eff;
          const endMonth = r.active === false ? shiftMonth(cur, -1) : null;
          const [created] = await tx
            .insert(s.staff)
            .values({
              name: r.name,
              netSalary: r.netSalary,
              extras: r.extras,
              mealCard: r.mealCard ?? false,
              kind: r.kind ?? "full_time",
              dailyWage: r.dailyWage ?? 0,
              userId: r.userId ?? null,
              personRef: r.personRef ?? null,
              sortOrder: i + 1,
              startMonth,
              endMonth,
              active: activeFromRange(endMonth, cur),
              branchId: branchOf.get(i) ?? newcomerBranch!,
            })
            .returning({ id: s.staff.id });
          changes.push({ id: created.id, name: r.name, mode: "base", fromMonth: startMonth });
          continue;
        }
        const [before] = await tx.select().from(s.staff).where(eq(s.staff.id, r.id));
        if (!before) throw new UserError(`${r.name}: personel bulunamadı (sayfayı yenileyin)`);
        // Tür sürümlenmez (Faz 5): maaş hesabına girmiş satırın türü değişirse geçmiş aylar başka kuralla hesaplanırdı
        if (r.kind !== undefined && r.kind !== before.kind && staffUsedMonths(before, past).length) {
          throw new UserError(`${r.name}: çalışma türü değişmez (geçmiş aylar maaş hesabına girdi). Bu satırı durdurup yeni kişi olarak ekleyin.`);
        }
        const set: Partial<typeof s.staff.$inferInsert> = {
          name: r.name,
          sortOrder: i + 1,
          ...(branchOf.has(i) ? { branchId: branchOf.get(i)! } : {}),
          ...(r.kind !== undefined ? { kind: r.kind } : {}),
          // Bağlantı: verilen değer (biri seçilince öteki boşalır); verilmezse değişmez
          ...(r.userId !== undefined || r.personRef !== undefined ? { userId: r.userId ?? null, personRef: r.personRef ?? null } : {}),
        };
        let startMonth = before.startMonth;
        let endMonth = before.endMonth;
        if (r.startMonth !== undefined) startMonth = r.startMonth;
        if (r.active !== undefined) {
          const nowActive = activeFromRange(endMonth, cur);
          if (r.active && !nowActive) endMonth = null;
          if (!r.active && nowActive) endMonth = shiftMonth(cur, -1);
        }
        if (startMonth && endMonth && endMonth < startMonth && r.startMonth !== undefined) {
          throw new UserError(`${r.name}: başlangıç ayı bitiş ayından (${monthLabel(endMonth)}) sonra olamaz`);
        }
        Object.assign(set, { startMonth, endMonth, active: activeFromRange(endMonth, cur) });

        // Maaş: tabana mı, sürüme mi? (önceki aylar eski maaşla kalsın). Yemek kartı ve günlük ücret maaşla birlikte
        // sürümlenir (Faz 5); verilmezse geçerlilik ayındaki değer kalır
        const versions = await tx.select().from(s.staffVersions).where(eq(s.staffVersions.staffId, r.id));
        const atEff = eff === "all" ? before : ([...versions].sort((a, b) => b.fromMonth.localeCompare(a.fromMonth)).find((v) => v.fromMonth <= eff) ?? before);
        const pay = (x: { netSalary: number; extras: number; mealCard: boolean; dailyWage: number }) => ({ netSalary: x.netSalary, extras: x.extras, mealCard: x.mealCard, dailyWage: x.dailyWage });
        const next = { netSalary: r.netSalary, extras: r.extras, mealCard: r.mealCard ?? atEff.mealCard, dailyWage: r.dailyWage ?? atEff.dailyWage };
        const equalPay = (a: ReturnType<typeof pay>, b: ReturnType<typeof pay>) =>
          same(a.netSalary, b.netSalary) && same(a.extras, b.extras) && a.mealCard === b.mealCard && same(a.dailyWage, b.dailyWage);
        const echoesBase = r.effectiveFrom === undefined && defaultEff === undefined && echoOfBase(pay(before), versions, next, equalPay);
        const plan = echoesBase ? ({ action: "none" } as const) : planVersionChange({
          base: pay(before),
          versions,
          next,
          effectiveFrom: eff,
          startMonth,
          firstDataMonth: firstData,
          equal: equalPay,
        });
        let mode: ChangeMode = "none";
        let fromMonth: string | null = null;
        if (plan.action === "base") {
          Object.assign(set, next);
          if (plan.clearVersions) await tx.delete(s.staffVersions).where(eq(s.staffVersions.staffId, r.id));
          mode = "base";
          fromMonth = eff === "all" ? null : eff;
        } else if (plan.action === "upsert") {
          await tx
            .insert(s.staffVersions)
            .values({ staffId: r.id, fromMonth: plan.fromMonth, ...next })
            .onConflictDoUpdate({ target: [s.staffVersions.staffId, s.staffVersions.fromMonth], set: next });
          mode = "version";
          fromMonth = plan.fromMonth;
        } else if (plan.action === "delete") {
          // Bir önceki ayın değerine dönüldü: o aydaki değişiklik gereksiz
          await tx.delete(s.staffVersions).where(and(eq(s.staffVersions.staffId, r.id), eq(s.staffVersions.fromMonth, plan.fromMonth)));
          mode = "version";
          fromMonth = plan.fromMonth;
        }
        // Yemek kartı "şu aydan itibaren" açılıp kapanınca önceden girilmiş sonraki sürümler (ör. planlı zam) eski işareti
        // taşıyordu: kart o ayda sessizce düşerdi. İşaret, sahibin ayrıca değiştirdiği ilk sürüme kadar taşınır
        if (eff !== "all") {
          const carry = mealCardCarry(versions, eff, atEff.mealCard, next.mealCard);
          if (carry.length) {
            await tx.update(s.staffVersions).set({ mealCard: next.mealCard }).where(inArray(s.staffVersions.id, carry.map((v) => v.id)));
            carried.push({ name: r.name, months: carry.map((v) => v.fromMonth) });
          }
        }
        await tx.update(s.staff).set(set).where(eq(s.staff.id, r.id));
        if (mode !== "none") changes.push({ id: r.id, name: r.name, mode, fromMonth });
      }
    });
    const changed = changes.filter((c) => c.mode === "version" && c.fromMonth);
    const added = changes.filter((c) => !data.some((r) => r.id === c.id) && c.fromMonth);
    const message =
      [
        changed.length ? `Maaş değişikliği ${spanText(changed.map((c) => c.fromMonth!))} itibarıyla geçerli; önceki aylar eski tutarla kaldı.` : "",
        added.length ? `${added.map((c) => c.name).join(", ")} ${spanText(added.map((c) => c.fromMonth!))} itibarıyla maaş hesabına girer.` : "",
        ...carried.map(
          (c) =>
            `${carried.length > 1 ? `${c.name}: ` : ""}Yemek kartı sonraki maaş ${c.months.length > 1 ? "değişikliklerine" : "değişikliğine"} de işlendi: ${c.months.map(monthLabel).join(", ")}.`,
        ),
      ]
        .filter(Boolean)
        .join(" ") || null;
    await logActivity(
      me,
      "Personel güncellendi",
      [
        data
          .map((r) => `${r.name} ${r.kind === "part_time" ? `günlük ${tl(r.dailyWage ?? 0)}` : tl(r.netSalary)}${r.mealCard ? " + yemek kartı" : ""}${r.userId ? " · hesaba bağlı" : r.personRef ? " · Vardiya adına bağlı" : ""}`)
          .join(", "),
        ...changes.filter((c) => c.mode !== "none").map((c) => `${c.name}: ${c.mode === "version" ? `${monthLabel(c.fromMonth!)} itibarıyla` : "bütün aylar"}`),
        removed.length ? `${removed.length} kişi silindi` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    );
    refresh();
    return { changes, message };
  });
}

/**
 * Maaş satırlarının Vardiya / hesap bağlantısı (Faz 5; src/lib/staff-link.ts): seçilen hesap var mı ve şubesine kilitliyse
 * satırın şubesi mi; aynı şubede aynı hesap ya da aynı Vardiya adı aralığı çakışan iki satıra bağlanmış mı. Kayıttaki
 * yeni değerlerle (silinenler hariç) denetlenir. Dışa açılmaz ("use server" dosyasının her dışa verdiği bir uçtur)
 */
async function checkStaffLinks(
  tx: Tx,
  data: z.infer<typeof staffSchema>,
  removed: number[],
  branchFor: (index: number, before: string | null) => string,
  cur: string,
): Promise<void> {
  if (!data.some((r) => r.userId || r.personRef)) return;
  const userIds = [...new Set(data.flatMap((r) => (r.userId ? [r.userId] : [])))];
  const users = userIds.length ? await tx.select({ id: s.users.id, name: s.users.name, branchId: s.users.branchId }).from(s.users).where(inArray(s.users.id, userIds)) : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const stored = await tx.select().from(s.staff);
  const byId = new Map(stored.map((x) => [x.id, x]));
  const rows: LinkRow[] = [];
  // Bağlantısı bu kayıtta değişen satırlar önce denetlenir: ret metni yeni seçilen satırı adlandırsın
  const changed = new Set<number>();
  for (const [i, r] of data.entries()) {
    const before = r.id ? byId.get(r.id) : undefined;
    const branch = branchFor(i, before?.branchId ?? null);
    const keep = r.userId === undefined && r.personRef === undefined;
    const userId = keep ? (before?.userId ?? null) : (r.userId ?? null);
    const personRef = keep ? (before?.personRef ?? null) : (r.personRef ?? null);
    if (userId !== null && !keep) {
      const u = userById.get(userId);
      if (!u) throw new UserError(`${r.name}: seçilen panel hesabı bulunamadı (sayfayı yenileyin)`);
      if (u.branchId && u.branchId !== branch) throw new UserError(`${r.name}: ${u.name} hesabı başka bir şubeye kilitli; bu maaş satırının şubesiyle aynı olmalı`);
    }
    const startMonth = r.startMonth !== undefined ? r.startMonth : before ? before.startMonth : (r.effectiveFrom ?? cur) === "all" ? null : (r.effectiveFrom ?? cur);
    const endMonth = before ? before.endMonth : r.active === false ? shiftMonth(cur, -1) : null;
    if (!keep && (userId !== (before?.userId ?? null) || personRef !== (before?.personRef ?? null))) changed.add(i);
    rows.push({ id: r.id, name: r.name, branchId: branch, userId, personRef, startMonth, endMonth });
  }
  const others: LinkRow[] = stored
    .filter((x) => !removed.includes(x.id) && !data.some((r) => r.id === x.id))
    .map((x) => ({ id: x.id, name: x.name, branchId: x.branchId, userId: x.userId, personRef: x.personRef, startMonth: x.startMonth, endMonth: x.endMonth }));
  const order = [...rows.keys()].sort((a, b) => Number(changed.has(b)) - Number(changed.has(a)));
  for (const i of order) {
    const conflict = linkConflict(rows[i], [...others, ...rows.filter((_, j) => j !== i)]);
    if (conflict) throw new UserError(conflict);
  }
}

/** Personelin maaş hesabına girdiği kapanmış veri ayları (doluysa silinemez; saveStaff ve staffDeleteBlockers aynı kural) */
function staffUsedMonths(row: { startMonth: string | null; endMonth: string | null; active: boolean }, closedMonths: string[]): string[] {
  return closedMonths.filter((m) => inRange(row, m));
}

/** Verilen personelden silinemeyecek olanlar ve nedeni (silme düğmesi pencere açılmadan "Durdur" önerebilsin) */
export async function staffDeleteBlockers(ids: number[]) {
  return attempt(async () => {
    await requireAdmin();
    const list = z.array(z.number().int().positive()).max(500).parse(ids);
    if (!list.length) return {} as Record<number, string>;
    const cur = currentMonthTR();
    const db = getDb();
    return db.transaction(async (tx) => {
      const rows = await tx.select().from(s.staff).where(inArray(s.staff.id, list));
      const past = await dataMonths(tx, cur);
      const out: Record<number, string> = {};
      for (const row of rows) {
        const used = staffUsedMonths(row, past);
        if (used.length) out[row.id] = `${spanText(used)} maaş hesabına girdi`;
      }
      return out;
    });
  });
}

/**
 * Personelin son çalıştığı ayı girer (o aydan sonra maaş hesabına girmez). null = bitiş ayını kaldır (yeniden başladı).
 */
export async function endStaff(id: number, lastMonth: string | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const sid = z.number().int().positive().parse(id);
    const last = lastMonth === null ? null : zMonth.parse(lastMonth);
    const cur = currentMonthTR();
    const db = getDb();
    const row = await db.transaction(async (tx) => {
      // Bağlantı denetimi ve yazım saveStaff'la aynı kilit altında (lockStaffLinks, inceleme bulgusu 6)
      await lockStaffLinks(tx);
      const [row] = await tx.select().from(s.staff).where(eq(s.staff.id, sid));
      if (!row) throw new UserError("Personel bulunamadı");
      if (last && row.startMonth && last < row.startMonth) {
        throw new UserError(`Bitiş ayı başlangıç ayından (${monthLabel(row.startMonth)}) önce olamaz`);
      }
      // Bağlı satırın aralığı uzayınca aynı kişiye bağlı başka bir satırla çakışmasın (Faz 5; src/lib/staff-link.ts)
      if (row.userId !== null || row.personRef !== null) {
        const others = await tx.select().from(s.staff).where(ne(s.staff.id, sid));
        const conflict = linkConflict({ ...row, endMonth: last }, others);
        if (conflict) throw new UserError(conflict);
      }
      await tx.update(s.staff).set({ endMonth: last, active: activeFromRange(last, cur) }).where(eq(s.staff.id, sid));
      return row;
    });
    const message = last
      ? `${row.name} ${monthLabel(last)} sonunda ayrıldı; ${monthLabel(shiftMonth(last, 1))} ve sonrasında maaş hesabına girmez. Önceki aylar değişmedi.`
      : `${row.name} yeniden aktif; bitiş ayı kaldırıldı.`;
    await logActivity(me, last ? "Personel bitiş ayı" : "Personel yeniden aktif", `${row.name}${last ? `: son ay ${monthLabel(last)}` : ""}`);
    refresh();
    return { endMonth: last, message };
  });
}

/**
 * Bir maaş değişikliğini geri alır (o aydan itibaren bir önceki tutar geçerli olur). Değişiklik yemek kartını açıp
 * kapattıysa saveStaff'ın sonraki sürümlere taşıdığı işaret de geri alınır (inceleme bulgusu LM-4 2. tur, 3): taşımanın
 * tersi aynı kuralla (mealCardCarry), sahibin işareti ayrıca değiştirdiği ilk sürümde durur
 */
export async function deleteStaffVersion(versionId: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const vid = z.number().int().positive().parse(versionId);
    const db = getDb();
    const { v, row, prev, uncarried } = await db.transaction(async (tx) => {
      const [v] = await tx.select().from(s.staffVersions).where(eq(s.staffVersions.id, vid));
      if (!v) throw new UserError("Değişiklik bulunamadı (sayfayı yenileyin)");
      const [row] = await tx.select().from(s.staff).where(eq(s.staff.id, v.staffId));
      const others = (await tx.select().from(s.staffVersions).where(eq(s.staffVersions.staffId, v.staffId))).filter((x) => x.id !== vid);
      const prev = latestBefore(others, v.fromMonth) ?? row;
      const uncarried = prev ? mealCardCarry(others, v.fromMonth, v.mealCard, prev.mealCard) : [];
      await tx.delete(s.staffVersions).where(eq(s.staffVersions.id, vid));
      if (uncarried.length) await tx.update(s.staffVersions).set({ mealCard: prev!.mealCard }).where(inArray(s.staffVersions.id, uncarried.map((x) => x.id)));
      return { v, row, prev, uncarried };
    });
    const message = [
      `${row?.name ?? "Personel"}: ${monthLabel(v.fromMonth)} değişikliği geri alındı; o aydan itibaren ${tl(prev?.netSalary ?? 0)} net maaş geçerli.`,
      uncarried.length
        ? `Yemek kartı sonraki maaş ${uncarried.length > 1 ? "değişikliklerinden" : "değişikliğinden"} de geri alındı: ${uncarried.map((x) => monthLabel(x.fromMonth)).join(", ")}.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    await logActivity(me, "Maaş değişikliği geri alındı", message);
    refresh();
    return { message };
  });
}

const rateSchema = z
  .object({ isciSgk: zRate, isciIssizlik: zRate, isverenSgk: zRate, isverenIssizlik: zRate })
  // brüt = net ÷ (1 − işçi kesintileri): toplam %100'e ulaşırsa brüt maaş sonsuz / negatif olur
  .refine((r) => r.isciSgk + r.isciIssizlik < 1, "İşçi kesintileri toplamı %100'ün altında olmalı");

export async function saveStaffRates(input: z.input<typeof rateSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = rateSchema.parse(input);
    const db = getDb();
    for (const [key, value] of Object.entries(data)) {
      await db.insert(s.settings).values({ key, value }).onConflictDoUpdate({ target: s.settings.key, set: { value, updatedAt: new Date() } });
    }
    await logActivity(me, "SGK oranları", Object.entries(data).map(([k, v]) => `${k} %${(v * 100).toFixed(2)}`).join(", "));
    refresh();
    return null;
  });
}

// ---------------------------------------------------------------- Sabit giderler

const fixedSchema = z.object({
  id: z.number().int().positive().nullable(),
  name: zText("Gider adı", 120),
  section: z.enum(["personel", "faturalar", "kira", "genel"]),
  period: z.enum(["aylik", "gunluk", "haftalik", "yillik"]),
  amount: z.number().finite().min(0),
  /**
   * Faturadaki KDV (yalnız nakit planı; gelir-gider KDV hariç kalır). Verilmezse değişmez (yeni kalemde bölümün
   * varsayılanı); null bölümün varsayılanına döndürür
   */
  vatRate: z
    .number()
    .refine((v) => FIXED_VAT_RATES.some((r) => Math.abs(r.value - v) < 1e-9), "KDV oranı %0, %1, %10 ya da %20 olabilir")
    .nullable()
    .optional(),
  note: zOptText(1000),
  /** Eski kullanım: false → geçen ay sonunda bitir, true → bitiş ayını kaldır. Yeni ekranlar endFixedExpense kullanır. */
  active: z.boolean().optional(),
  /** Tutar / dönem değişikliği hangi aydan itibaren ("all" = bütün aylar, düzeltme). Varsayılan bu ay. */
  effectiveFrom: zEffective.optional(),
  /** Kalemin başladığı ay (null = baştan beri). Yeni kalemde verilmezse geçerlilik ayı (varsayılan bu ay). */
  startMonth: zMonth.nullable().optional(),
  /** Kira: resmi (sözleşmedeki) aylık kira ve brüt / net (yalnız kira bölümünde; verilmezse değişmez) */
  officialAmount: z.number().finite().positive().max(1e9).nullable().optional(),
  officialBasis: z.enum(["brut", "net"]).nullable().optional(),
  /**
   * Kira: ev sahibi şahıs mı şirket mi (Faz 5; yalnız kira bölümünde, verilmezse değişmez). Şahıs: KDV yok, stopaj resmi
   * kiradan; şirket: %20 KDV, stopaj yok
   */
  landlordType: z.enum(["sahis", "sirket"]).nullable().optional(),
  /** Açık güne göre oranla (verilmezse değişmez; yeni kalemde kira tam ay, ötekiler oranlı) */
  prorate: z.boolean().optional(),
  /** Şube (docs/SUBE.md): null = işletme geneli (bütün şubelerde görünür); verilmezse değişmez, yeni kalemde işletme geneli */
  branchId: z.string().max(24).nullable().optional(),
});

/**
 * Sabit gideri kaydeder. Tutar ya da dönem değişirse varsayılan olarak bu aydan itibaren geçerlidir:
 * geçmiş aylar eski tutarla kalır. `effectiveFrom: "YYYY-MM"` başka bir ay, `"all"` bütün ayları düzeltir
 * (tabanı yeniden yazar, değişiklik geçmişini siler). Ad, bölüm ve not her zaman bütün aylar için değişir.
 */
export async function saveFixedExpense(input: z.input<typeof fixedSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { id, active, effectiveFrom, startMonth: startInput, officialAmount, officialBasis, landlordType, prorate, branchId: branchInput, ...data } = fixedSchema.parse(input);
    const branchId = await checkedBranch(branchInput, false);
    const branchSet = branchId !== undefined ? { branchId } : {};
    // Resmi kira yalnız kira bölümünde (başka bölüme taşınınca silinir)
    const official =
      data.section !== "kira"
        ? { officialAmount: null, officialBasis: null }
        : officialAmount !== undefined
          ? { officialAmount, officialBasis: officialAmount ? (officialBasis ?? "brut") : null }
          : {};
    // Ev sahibi türü yalnız kira bölümünde (başka bölüme taşınınca silinir; Faz 5)
    const landlord = data.section !== "kira" ? { landlordType: null } : landlordType !== undefined ? { landlordType } : {};
    const prorateSet = prorate !== undefined ? { prorate } : {};
    const cur = currentMonthTR();
    const eff: Effective = effectiveFrom ?? cur;
    const db = getDb();
    type Result = {
      id: number;
      mode: ChangeMode;
      fromMonth: string | null;
      previous: { period: string; amount: number } | null;
      /** "Sabit giderlerden ekle" ile açılmış hatırlatıcılar: tutarı izleyenler ve elle yazılmış farklı tutarlar (E-46) */
      reminders: FollowResult;
    };
    const noReminders: Result["reminders"] = { updated: [], manual: [], later: [] };
    const result = await db.transaction(async (tx): Promise<Result> => {
      let mode: ChangeMode = "none";
      let fromMonth: string | null = null;
      let previous: Result["previous"] = null;
      if (!id) {
        const all = await tx.select({ o: s.fixedExpenses.sortOrder }).from(s.fixedExpenses);
        const startMonth = startInput !== undefined ? startInput : eff === "all" ? null : eff;
        const endMonth = active === false ? shiftMonth(cur, -1) : null;
        const [row] = await tx
          .insert(s.fixedExpenses)
          .values({
            ...data,
            ...official,
            ...landlord,
            ...branchSet,
            prorate: prorate ?? data.section !== "kira",
            startMonth,
            endMonth,
            active: activeFromRange(endMonth, cur),
            sortOrder: Math.max(0, ...all.map((r) => r.o)) + 1,
          })
          .returning({ id: s.fixedExpenses.id });
        return { id: row.id, mode: "base", fromMonth: startMonth, previous: null, reminders: noReminders };
      }
      const [before] = await tx.select().from(s.fixedExpenses).where(eq(s.fixedExpenses.id, id));
      if (!before) throw new UserError("Gider bulunamadı (sayfayı yenileyin)");
      const set: Partial<typeof s.fixedExpenses.$inferInsert> = {
        name: data.name,
        section: data.section,
        note: data.note,
        ...(data.vatRate !== undefined ? { vatRate: data.vatRate } : {}),
        ...official,
        ...landlord,
        ...prorateSet,
        ...branchSet,
      };
      const startMonth = startInput !== undefined ? startInput : before.startMonth;
      let endMonth = before.endMonth;
      if (active !== undefined) {
        const nowActive = activeFromRange(endMonth, cur);
        if (active && !nowActive) endMonth = null;
        if (!active && nowActive) endMonth = shiftMonth(cur, -1);
      }
      if (startInput !== undefined && startMonth && endMonth && endMonth < startMonth) {
        throw new UserError(`Başlangıç ayı bitiş ayından (${monthLabel(endMonth)}) sonra olamaz`);
      }
      Object.assign(set, { startMonth, endMonth, active: activeFromRange(endMonth, cur) });

      // Tutar / dönem: tabana mı, sürüme mi? (önceki aylar eski tutarla kalsın)
      const versions = await tx
        .select()
        .from(s.fixedExpenseVersions)
        .where(eq(s.fixedExpenseVersions.fixedExpenseId, id))
        .orderBy(asc(s.fixedExpenseVersions.fromMonth));
      const firstData = (await dataMonths(tx))[0] ?? null;
      const atFrom = eff === "all" ? before : ([...versions].reverse().find((v) => v.fromMonth <= eff) ?? before);
      const echoesBase =
        effectiveFrom === undefined && echoOfBase(
          { period: before.period, amount: before.amount },
          versions,
          { period: data.period, amount: data.amount },
          (a, b) => a.period === b.period && same(a.amount, b.amount),
        );
      const plan = echoesBase ? ({ action: "none" } as const) : planVersionChange({
        base: { period: before.period, amount: before.amount },
        versions,
        next: { period: data.period, amount: data.amount },
        effectiveFrom: eff,
        startMonth,
        firstDataMonth: firstData,
        equal: (a, b) => a.period === b.period && same(a.amount, b.amount),
      });
      if (plan.action !== "none") previous = { period: atFrom.period, amount: atFrom.amount };
      if (plan.action === "base") {
        Object.assign(set, { period: data.period, amount: data.amount });
        if (plan.clearVersions) await tx.delete(s.fixedExpenseVersions).where(eq(s.fixedExpenseVersions.fixedExpenseId, id));
        mode = "base";
        fromMonth = eff === "all" ? null : eff;
      } else if (plan.action === "upsert") {
        await tx
          .insert(s.fixedExpenseVersions)
          .values({ fixedExpenseId: id, fromMonth: plan.fromMonth, period: data.period, amount: data.amount })
          .onConflictDoUpdate({
            target: [s.fixedExpenseVersions.fixedExpenseId, s.fixedExpenseVersions.fromMonth],
            set: { period: data.period, amount: data.amount },
          });
        mode = "version";
        fromMonth = plan.fromMonth;
      } else if (plan.action === "delete") {
        await tx
          .delete(s.fixedExpenseVersions)
          .where(and(eq(s.fixedExpenseVersions.fixedExpenseId, id), eq(s.fixedExpenseVersions.fromMonth, plan.fromMonth)));
        mode = "version";
        fromMonth = plan.fromMonth;
      }
      await tx.update(s.fixedExpenses).set(set).where(eq(s.fixedExpenses.id, id));
      const reminders = await followFixedReminders(tx, before, versions, { ...before, ...set });
      return { id, mode, fromMonth, previous, reminders };
    });
    const { mode, fromMonth } = result;
    const prevAmount = result.previous?.amount;
    const base =
      mode === "version" && fromMonth
        ? `${monthLabel(fromMonth)} itibarıyla ${tl(data.amount)}${prevAmount !== undefined ? ` (önce ${tl(prevAmount)})` : ""}; önceki aylar değişmedi.`
        : mode === "base" && id && effectiveFrom === "all"
          ? `Bütün aylarda ${tl(data.amount)} olarak düzeltildi.`
          : !id && fromMonth
            ? `${monthLabel(fromMonth)} itibarıyla hesaba girer; önceki aylar değişmedi.`
            : null;
    const reminderText = fixedReminderMessage(result.reminders);
    const message = [base, reminderText].filter(Boolean).join(" ") || null;
    for (const u of result.reminders.updated) {
      await logActivity(me, "Hatırlatıcı tutarı sabit gidere uydu", `${u.title}: ${tl(u.from)} → ${u.to === null ? "tutar yazılmaz (Giderler'i izler)" : tl(u.to)}`);
    }
    await logActivity(
      me,
      id ? "Sabit gider düzenlendi" : "Sabit gider eklendi",
      `${data.name}: ${tl(data.amount)} (${data.period})${data.vatRate ? ` + %${Math.round(data.vatRate * 100)} KDV` : ""}${landlordType ? ` · ev sahibi ${landlordType === "sahis" ? "şahıs" : "şirket"}` : ""}${mode === "version" && fromMonth ? ` · ${monthLabel(fromMonth)} itibarıyla` : mode === "base" && id ? " · bütün aylar" : ""}`,
    );
    refresh();
    // Kimlik döner: istemci yeni ya da düzenlenen satırı listede vurgulayabilsin
    return { id: result.id, mode, fromMonth, message };
  });
}

/**
 * Sabit giderin son geçerli ayını girer (o aydan sonra hesaba girmez, önceki aylar korunur).
 * null = bitiş ayını kaldır (yeniden başlat).
 */
export async function endFixedExpense(id: number, lastMonth: string | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const fid = z.number().int().positive().parse(id);
    const last = lastMonth === null ? null : zMonth.parse(lastMonth);
    const cur = currentMonthTR();
    const db = getDb();
    const [row] = await db.select().from(s.fixedExpenses).where(eq(s.fixedExpenses.id, fid));
    if (!row) throw new UserError("Gider bulunamadı");
    if (last && row.startMonth && last < row.startMonth) {
      throw new UserError(`Bitiş ayı başlangıç ayından (${monthLabel(row.startMonth)}) önce olamaz`);
    }
    await db.update(s.fixedExpenses).set({ endMonth: last, active: activeFromRange(last, cur) }).where(eq(s.fixedExpenses.id, fid));
    const overridesAfter = last
      ? (
          await db
            .select({ m: s.pnlEntries.month })
            .from(s.pnlEntries)
            .where(and(eq(s.pnlEntries.rowKey, `fixed:${fid}`), gt(s.pnlEntries.month, last)))
        ).length
      : 0;
    const message = last
      ? `${row.name} ${monthLabel(last)} sonunda bitti; ${monthLabel(shiftMonth(last, 1))} ve sonrasında hesaba girmez. Önceki aylar değişmedi.` +
        (overridesAfter ? ` Sonraki aylarda elle girilmiş ${overridesAfter} tutar yine sayılır.` : "")
      : `${row.name} yeniden aktif; bitiş ayı kaldırıldı.`;
    await logActivity(me, last ? "Sabit gider bitiş ayı" : "Sabit gider yeniden aktif", `${row.name}${last ? `: son ay ${monthLabel(last)}` : ""}`);
    refresh();
    return { endMonth: last, overridesAfter, message };
  });
}

/** Bir tutar değişikliğini geri alır (o aydan itibaren bir önceki tutar geçerli olur) */
export async function deleteFixedExpenseVersion(versionId: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const vid = z.number().int().positive().parse(versionId);
    const db = getDb();
    const [v] = await db.select().from(s.fixedExpenseVersions).where(eq(s.fixedExpenseVersions.id, vid));
    if (!v) throw new UserError("Değişiklik bulunamadı (sayfayı yenileyin)");
    const [row] = await db.select().from(s.fixedExpenses).where(eq(s.fixedExpenses.id, v.fixedExpenseId));
    const others = (await db.select().from(s.fixedExpenseVersions).where(eq(s.fixedExpenseVersions.fixedExpenseId, v.fixedExpenseId))).filter(
      (x) => x.id !== vid,
    );
    const prev = latestBefore(others, v.fromMonth) ?? row;
    await db.delete(s.fixedExpenseVersions).where(eq(s.fixedExpenseVersions.id, vid));
    const message = `${row?.name ?? "Gider"}: ${monthLabel(v.fromMonth)} değişikliği geri alındı; o aydan itibaren ${tl(prev?.amount ?? 0)} geçerli.`;
    await logActivity(me, "Sabit gider değişikliği geri alındı", message);
    refresh();
    return { message };
  });
}

/**
 * Sabit gideri siler. Geçmiş (kapanmış) bir ayın hesabına girmiş ya da gelir-gider tablosunda elle tutarı olan
 * kalem silinmez: silmek o ayların kârını değiştirirdi. Bunun yerine bitiş ayı verilir (endFixedExpense).
 */
export async function deleteFixedExpense(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const fid = z.number().int().positive().parse(id);
    const cur = currentMonthTR();
    const db = getDb();
    const deleted = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(s.fixedExpenses).where(eq(s.fixedExpenses.id, fid));
      if (!row) return null;
      const overrides = await tx
        .select({ m: s.pnlEntries.month })
        .from(s.pnlEntries)
        .where(eq(s.pnlEntries.rowKey, `fixed:${fid}`));
      if (overrides.length) {
        throw new UserError(
          `${row.name} için ${spanText(overrides.map((o) => o.m))} gelir-gider tablosunda elle girilmiş tutar var. Silmek yerine bitiş ayı verin; ya da önce o hücreleri otomatiğe döndürün.`,
        );
      }
      const used = (await dataMonths(tx, cur)).filter((m) => inRange(row, m));
      if (used.length) {
        throw new UserError(
          `${row.name} ${spanText(used)} kâr/zarar hesabına girdi; silinirse o aylar değişir. Silmek yerine bitiş ayı verin: kalem geçmiş aylarda kalır, yeni aylara girmez.`,
        );
      }
      await tx.delete(s.fixedExpenses).where(eq(s.fixedExpenses.id, fid));
      return row;
    });
    if (deleted) await logActivity(me, "Sabit gider silindi", deleted.name);
    refresh();
    return null;
  });
}

// ---------------------------------------------------------------- Tek seferlik yatırımlar

const investmentSchema = z.object({
  id: z.number().int().positive().nullable(),
  name: zText("Yatırım adı", 160),
  amount: z.number().finite().min(0),
  date: zOptText(10),
  note: zOptText(1000),
});

export async function saveInvestment(input: z.input<typeof investmentSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { id, ...data } = investmentSchema.parse(input);
    const db = getDb();
    let savedId: number;
    if (id) {
      await db.update(s.investments).set(data).where(eq(s.investments.id, id));
      savedId = id;
    } else {
      const [row] = await db.insert(s.investments).values(data).returning({ id: s.investments.id });
      savedId = row.id;
    }
    await logActivity(me, "Yatırım kaydı", `${data.name}: ${tl(data.amount)}`);
    refresh();
    return { id: savedId };
  });
}

export async function deleteInvestment(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const [d] = await getDb().delete(s.investments).where(eq(s.investments.id, id)).returning();
    if (d) await logActivity(me, "Yatırım silindi", d.name);
    refresh();
    return null;
  });
}

/** Verilen sabit giderlerden silinemeyecek olanlar ve nedeni (silme penceresi açılmadan gösterilebilir) */
export async function fixedExpenseDeleteBlockers(ids: number[]) {
  return attempt(async () => {
    await requireAdmin();
    const list = z.array(z.number().int().positive()).max(500).parse(ids);
    if (!list.length) return {} as Record<number, string>;
    const cur = currentMonthTR();
    const db = getDb();
    return db.transaction(async (tx) => {
      const rows = await tx.select().from(s.fixedExpenses).where(inArray(s.fixedExpenses.id, list));
      const past = await dataMonths(tx, cur);
      const ovs = await tx
        .select({ k: s.pnlEntries.rowKey, m: s.pnlEntries.month })
        .from(s.pnlEntries)
        .where(inArray(s.pnlEntries.rowKey, list.map((i) => `fixed:${i}`)));
      const out: Record<number, string> = {};
      for (const row of rows) {
        const o = ovs.filter((x) => x.k === `fixed:${row.id}`).map((x) => x.m);
        const used = past.filter((m) => inRange(row, m));
        if (o.length) out[row.id] = `${spanText(o)} elle girilmiş tutar var`;
        else if (used.length) out[row.id] = `${spanText(used)} hesabına girdi`;
      }
      return out;
    });
  });
}
