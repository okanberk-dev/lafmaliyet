import "server-only";

import { and, eq, gte, lte } from "drizzle-orm";

import { ALL_BRANCHES, tillBranches } from "@/lib/branches";
import { businessDate } from "@/lib/cash-report";
import { lossSummary, staffPersonKey, type LossCashReport, type LossDay, type LossPerson, type LossSummary, type LossWasteEntry } from "@/lib/kayip-onleme";
import { LAFPOS_AUTO_BY } from "@/lib/lafpos/gun-sonu";
import { branchSwitchDay, isLafposDay, lafposBranchOf } from "@/lib/lafpos/switch";
import { addDays, shiftMonth } from "@/lib/reminders";
import { monthDays } from "@/lib/sube-karsilastirma";
import { requireAdmin } from "@/server/auth/dal";
import { listBranches } from "@/server/branches";
import { loadModel } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";
import { loadLafposSwitchDay } from "@/server/lafpos/status";

export interface LossData {
  months: string[];
  from: string;
  to: string;
  branches: { id: string; name: string; lafpos: boolean }[];
  summary: LossSummary;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
/** Kimliği silinmiş kişi (hesap silindi, ad kaldı): adıyla */
const nameKey = (name: string) => `x:${name.trim().toLocaleLowerCase("tr-TR")}`;

/**
 * Kişi bazında kayıp önleme özeti (docs/RAPORLAR.md › Kayıp önleme; hesap src/lib/kayip-onleme.ts). Yalnız yönetici;
 * soldaki seçiciden bağımsız, açık fiziksel şubeler. Yalnız okur; LafPOS'un göndermediği alan (iptal eden, ikram eden,
 * indirim yapan, LafPOS'ta kasayı sayan) uydurulmaz: ekran bunu yazar.
 */
export async function loadLossSummary(lastMonth: string, span: number, now: Date = new Date()): Promise<LossData | null> {
  await requireAdmin();
  const db = getDb();
  const today = businessDate(now);
  const current = today.slice(0, 7);
  const last = lastMonth > current ? current : lastMonth;
  const months = Array.from({ length: span }, (_, i) => shiftMonth(last, i - span + 1));
  const from = `${months[0]}-01`;
  const monthEnd = addDays(`${shiftMonth(last, 1)}-01`, -1);
  const to = monthEnd < today ? monthEnd : today;

  const all = await listBranches(db);
  const branches = tillBranches(all);
  if (!branches.length) return null;
  const lafposBranch = lafposBranchOf(all);

  const [cash, waste, posDays, shifts, staff, users, switchDay, model] = await Promise.all([
    db
      .select({
        branchId: s.cashReports.branchId,
        date: s.cashReports.date,
        cashDiff: s.cashReports.cashDiff,
        discounts: s.cashReports.discounts,
        offRevenue: s.cashReports.offRevenue,
        countedBy: s.cashReports.countedBy,
        countedByName: s.cashReports.countedByName,
        submittedBy: s.cashReports.submittedBy,
        submittedByName: s.cashReports.submittedByName,
      })
      .from(s.cashReports)
      .where(and(gte(s.cashReports.date, from), lte(s.cashReports.date, to))),
    db
      .select({
        branchId: s.wasteEntries.branchId,
        date: s.wasteEntries.date,
        kind: s.wasteEntries.kind,
        productId: s.wasteEntries.productId,
        ingredientId: s.wasteEntries.ingredientId,
        qty: s.wasteEntries.qty,
        factor: s.wasteEntries.factor,
        createdBy: s.wasteEntries.createdBy,
        createdByName: s.wasteEntries.createdByName,
      })
      .from(s.wasteEntries)
      .where(and(gte(s.wasteEntries.date, from), lte(s.wasteEntries.date, to))),
    db
      .select({ date: s.posDayReports.date, branchId: s.posDayReports.branchId, z: s.posDayReports.z, ikram: s.posDayReports.ikram, iptal: s.posDayReports.iptal, workedStaff: s.posDayReports.workedStaff })
      .from(s.posDayReports)
      .where(and(gte(s.posDayReports.date, from), lte(s.posDayReports.date, to))),
    db
      .select({ branchId: s.shifts.branchId, date: s.shifts.date, personRef: s.shifts.personRef, personName: s.shifts.personName })
      .from(s.shifts)
      .where(and(eq(s.shifts.kind, "work"), gte(s.shifts.date, from), lte(s.shifts.date, to))),
    db.select({ id: s.staff.id, name: s.staff.name, userId: s.staff.userId, personRef: s.staff.personRef }).from(s.staff),
    db.select({ id: s.users.id, name: s.users.name }).from(s.users),
    loadLafposSwitchDay(db),
    loadModel({ scope: ALL_BRANCHES }),
  ]);

  // Adlar: hesap adı önce, sonra personel ve Vardiya'daki ad
  const names = new Map<string, string>();
  for (const x of shifts) if (!names.has(x.personRef)) names.set(x.personRef, x.personName);
  for (const x of staff) names.set(staffPersonKey(x), x.name);
  for (const u of users) names.set(`u:${u.id}`, u.name);
  const staffById = new Map(staff.map((x) => [x.id, x]));
  const person = (id: number | null, name: string | null): LossPerson | null => {
    if (id) return { key: `u:${id}`, name: names.get(`u:${id}`) ?? name ?? `#${id}` };
    return name ? { key: nameKey(name), name } : null;
  };

  const cashReports: LossCashReport[] = cash.map((r) => ({
    branchId: r.branchId,
    date: r.date,
    cashDiff: r.cashDiff,
    // Sayan; eski raporda gönderen. LafPOS'un otomatik raporunda ikisi de yok (LafPOS kasayı sayanı göndermiyor)
    person: r.countedBy || r.countedByName ? person(r.countedBy, r.countedByName) : r.submittedByName === LAFPOS_AUTO_BY ? null : person(r.submittedBy, r.submittedByName),
  }));
  const wasteEntries: LossWasteEntry[] = waste.map((w) => ({
    branchId: w.branchId,
    date: w.date,
    kind: w.kind as "zayi" | "ikram",
    cost: r2(model.wasteCost(w)),
    person: person(w.createdBy, w.createdByName || null),
  }));

  const reportOf = new Map(cash.map((r) => [`${r.branchId}|${r.date}`, r]));
  const posOf = new Map(posDays.map((p) => [`${p.branchId}|${p.date}`, p]));
  const shiftWorkers = new Map<string, string[]>();
  for (const x of shifts) {
    const k = `${x.branchId}|${x.date}`;
    shiftWorkers.set(k, [...(shiftWorkers.get(k) ?? []), x.personRef]);
  }
  const days: LossDay[] = [];
  for (const b of branches) {
    const switchOf = branchSwitchDay(switchDay, b.id, lafposBranch);
    for (const m of months) {
      for (const date of monthDays(m, to)) {
        const k = `${b.id}|${date}`;
        const report = reportOf.get(k);
        // LafPOS'un geçiş gününden önceki gün sonları deneme günüdür: hiçbir hesaba girmez (Kıyas'la aynı)
        const pos = posOf.get(k);
        const lafpos = pos && isLafposDay(date, switchOf) ? pos : null;
        if (!report && !lafpos) continue;
        const values: LossDay["values"] = { cashDiff: report ? report.cashDiff : null };
        if (lafpos) {
          values.iptal = lafpos.iptal ? r2(lafpos.iptal.reduce((a, x) => a + x.listValue, 0)) : null;
          values.ikram = r2(lafpos.ikram.filter((x) => x.kind !== "zayi").reduce((a, x) => a + x.menuValue, 0));
          values.discount = lafpos.z.discounts;
        } else if (report) {
          values.iptal = null;
          values.ikram = report.offRevenue;
          values.discount = report.discounts;
        }
        const fromLafpos = lafpos?.workedStaff ?? null;
        const planned = shiftWorkers.get(k);
        const workers = fromLafpos
          ? [...new Set(fromLafpos.map((ref) => {
              const id = Number(ref.slice(2));
              const row = staffById.get(id);
              return row ? staffPersonKey(row) : ref;
            }))]
          : planned?.length
            ? [...new Set(planned)]
            : null;
        days.push({ branchId: b.id, date, workers, workersFrom: fromLafpos ? "lafpos" : planned?.length ? "vardiya" : undefined, values });
      }
    }
  }

  const ids = new Set(branches.map((b) => b.id));
  return {
    months,
    from,
    to,
    branches: branches.map((b) => ({ id: b.id, name: b.name, lafpos: b.id === lafposBranch && switchDay !== null })),
    summary: lossSummary({
      cash: cashReports.filter((r) => ids.has(r.branchId)),
      waste: wasteEntries.filter((w) => ids.has(w.branchId)),
      days,
      names,
    }),
  };
}
