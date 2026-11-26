import "server-only";

import { and, asc, eq, gt, sql } from "drizzle-orm";

import { BLIND_COUNT_GROUP } from "@/lib/branch-settings/groups";
import { staffCanReport } from "@/lib/cash-report";
import { money } from "@/lib/format";
import { blindCountOn, BLIND_COUNT_TEXT, blindCountRefusal, countNeedsReason, countReasonError, lockOf, type BlindCountLock, type CashCountRow } from "@/lib/kor-sayim";
import { isLafposDay } from "@/lib/lafpos/switch";
import { longDateTR } from "@/lib/reminders";
import { currentVia } from "@/server/activity-via";
import { resolveBranchSetting } from "@/server/branch-settings";
import { getDb, schema as s, type DB } from "@/server/db";
import { lafposBranchId, lafposSwitchDay } from "@/server/lafpos/branch";
import { UserError } from "@/server/user-error";

/*
 * Kör sayımın sunucu yolu (docs/KASA-RAPORU.md › Kör sayım; kurallar src/lib/kor-sayim.ts). Personel önce sayımı
 * kilitler (lockCashCountCore), raporun sayılan nakdi geçerli sayıma eşit olmak zorundadır (assertBlindCount; çağıran
 * saveCashReport, yalnız personelin doğrudan yazımında). Değişiklik yeni bir satırdır, nedeniyle; işlem geçmişine düşer ve
 * yöneticinin kasa gün görünümünde görünür. Yetki ve şube çağıranda (src/server/actions/cash-report.ts lockCashCount).
 */

type Reader = Pick<DB, "select">;
type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/** Raporu yazan / sayımı kilitleyen hesap */
export interface CountActor {
  id: number;
  name: string;
  role: "admin" | "staff";
}

/** Şubenin kör sayım ayarı (null: seçilmedi, varsayılan) */
export async function blindCountSetting(branchId: string, db?: Reader): Promise<boolean | null> {
  return (await resolveBranchSetting(BLIND_COUNT_GROUP, branchId, db)).value.enabled;
}

/** Bu kasa gününde kör sayım geçerli mi (ayar; LafPOS'un şubesinin LafPOS gününde hiçbir zaman) */
export async function blindCountApplies(db: Reader, date: string, branchId: string): Promise<boolean> {
  const [setting, lafposBranch, switchDay] = await Promise.all([blindCountSetting(branchId, db), lafposBranchId(db), lafposSwitchDay(db)]);
  return blindCountOn({ setting, branchId, lafposBranch, lafposDay: branchId === lafposBranch && isLafposDay(date, switchDay) });
}

/** Günün sayım satırları, sırayla (ilk satır kör sayım) */
export async function cashCountsOn(db: Reader, date: string, branchId: string): Promise<CashCountRow[]> {
  const rows = await db
    .select({ amount: s.cashCounts.amount, reason: s.cashCounts.reason, userName: s.cashCounts.userName, at: s.cashCounts.createdAt })
    .from(s.cashCounts)
    .where(and(eq(s.cashCounts.date, date), eq(s.cashCounts.branchId, branchId)))
    .orderBy(asc(s.cashCounts.createdAt), asc(s.cashCounts.id));
  return rows.map((r) => ({ ...r, at: r.at.toISOString() }));
}

/**
 * Kasa sayfasının kör sayım bilgisi: bu günde geçerli mi ve sayım geçmişi (ayar sonradan kapatılsa da yönetici geçmişi
 * görür). Personel yalnız kilidi alır (lockOf; sayılan, an, kim), yönetici satırları
 */
export async function blindCountState(date: string, branchId: string, db: Reader = getDb()): Promise<{ on: boolean; rows: CashCountRow[] }> {
  const [on, rows] = await Promise.all([blindCountApplies(db, date, branchId), cashCountsOn(db, date, branchId)]);
  return { on, rows };
}

/**
 * Personelin raporunun sayılan nakdi kör sayıma uyuyor mu (saveCashReport'un personel yolu, işlemin içinde; yalnız
 * doğrudan yazımda: onaya giden düzeltme önerisi ve geç rapor yöneticinin onayından geçer). Kör sayım geçerli değilse
 * hiçbir şey yapmaz. `prevCounted`: kayıtlı raporun sayılanı (değişmediyse geçer)
 */
export async function assertBlindCount(tx: Tx, date: string, branchId: string, counted: number, prevCounted: number | null): Promise<void> {
  if (!(await blindCountApplies(tx, date, branchId))) return;
  const lock = lockOf(await cashCountsOn(tx, date, branchId));
  const refusal = blindCountRefusal({ lock: lock?.amount ?? null, counted, prevCounted });
  if (refusal) throw new UserError(refusal);
}

export interface LockInput {
  date: string;
  branchId: string;
  amount: number;
  /** Değişikliğin nedeni (ilk kör sayımda gerekmez) */
  reason?: string | null;
}

/**
 * Sayımı kilitler ya da değiştirir (yeni satır). Kör sayım bu günde geçerli olmalı. Personel yalnız raporunu doğrudan
 * yazabildiği günde (bugün ve dün, ertesi günün raporu girilmemiş); sonrası yöneticinin. İlk kör sayım nedensiz; önceki
 * sayım varsa ya da rapor zaten girilmişse neden zorunlu. Aynı tutar yeniden kilitlenmez (satır eklenmez). Raporun yazım
 * kilidiyle aynı gün kilidi (kasa-gec) altında. Döner: formun kilidi
 */
export async function lockCashCountCore(db: DB, me: CountActor, input: LockInput, now = new Date()): Promise<BlindCountLock> {
  const { date, branchId } = input;
  const amount = Math.round(input.amount * 100) / 100;
  return db.transaction(async (tx) => {
    // Raporun yazımıyla aynı gün kilidi (src/server/cash/report-store.ts lockLateDay): sayım ile rapor sıraya girer
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`kasa-gec:${branchId}:${date}`}))`);
    if (!(await blindCountApplies(tx, date, branchId))) throw new UserError(BLIND_COUNT_TEXT.off);
    const [report] = await tx
      .select({ id: s.cashReports.id })
      .from(s.cashReports)
      .where(and(eq(s.cashReports.date, date), eq(s.cashReports.branchId, branchId)))
      .limit(1);
    if (me.role !== "admin") {
      if (!staffCanReport(date, now)) throw new UserError(BLIND_COUNT_TEXT.closed);
      const [later] = await tx
        .select({ id: s.cashReports.id })
        .from(s.cashReports)
        .where(and(gt(s.cashReports.date, date), eq(s.cashReports.branchId, branchId)))
        .limit(1);
      if (report && later) throw new UserError(BLIND_COUNT_TEXT.closed);
    }
    const rows = await cashCountsOn(tx, date, branchId);
    const last = rows.at(-1);
    if (last && Math.abs(last.amount - amount) < 0.005) return lockOf(rows)!;
    const needsReason = countNeedsReason({ counts: rows.length, hasReport: Boolean(report) });
    const reason = needsReason ? (input.reason ?? "").trim().slice(0, 300) : null;
    if (needsReason) {
      const err = countReasonError(reason);
      if (err) throw new UserError(err);
    }
    await tx.insert(s.cashCounts).values({ branchId, date, amount, reason, userId: me.id, userName: me.name, createdAt: now });
    const detail = [longDateTR(date), money(amount), last ? `önceki ${money(last.amount)}` : null, reason ? `neden: ${reason}` : null].filter(Boolean).join(" · ");
    await tx.insert(s.activityLog).values({
      userName: me.name,
      userId: me.id,
      action: last || report ? "Kasa sayımı değişti" : "Kasa sayımı kilitlendi",
      detail: detail.slice(0, 500),
      via: currentVia(),
    });
    return lockOf([...rows, { amount, reason, userName: me.name, at: now.toISOString() }])!;
  });
}
