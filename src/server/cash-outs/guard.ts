import "server-only";

import { eq } from "drizzle-orm";

import { staffCanReport } from "@/lib/cash-report";
import { CASH_OUT_REQUEST_TEXT, cashOutNeedsApproval, requestDayAllowed, type CashOutOp } from "@/lib/cash-out-requests";
import { staffExpenseLocked } from "@/lib/cash-outs";
import { currentWriteBranch } from "@/server/branch-scope";
import { CARI_LOCKED_STAFF, cashOutPayment } from "@/server/cari/kasa";
import { closedDayRefusal } from "@/server/closed-days";
import { schema as s } from "@/server/db";
import { staffDayOpen } from "@/server/photo-read/rules";
import { UserError } from "@/server/user-error";

import type { CashOutActor, CashOutRow, CashOutTx } from "./write";

/*
 * Personelin kasadan çıkan kapısı (docs/KASA-RAPORU.md › Kasadan çıkan: kapanmış gün, yöneticinin satırı; plan
 * docs/planlar/personel-yetki.md §2.7). Personelin bütün kasadan çıkan yolları buradan geçer: doğrudan ekleme,
 * düzeltme ve silme (src/server/actions/cash-outs.ts), istekler ve fiş ekleme (src/server/cash-outs/requests.ts). Bir
 * satırın personele kapanması (ör. yöneticinin bir ödemeye bağladığı satır) yalnız burada ve saf kuralında
 * (src/lib/cash-out-requests.ts cashOutNeedsApproval, `rowLocked`) yazılır; doğrudan yol da istek yolu da onu görür.
 */

/** `branchId` (ekle): satırın yazılacağı şube; verilmezse personelin yazdığı şube (seçili şube, "Tümü"de Tuzla) */
export type CashOutTarget = { op: "ekle"; date: string; branchId?: string } | { op: Exclude<CashOutOp, "ekle"> | "fis"; row: CashOutRow };

/** Satırın bağlı harcama kaydı yöneticinin kategorisinde mi (personelin seçemediği; maaş, avans, kapatılmış kategori) */
async function adminCategoryOf(tx: CashOutTx, cashOutId: number): Promise<boolean> {
  const [cur] = await tx
    .select({ section: s.expenseCategories.section, panelGroup: s.expenseCategories.panelGroup, active: s.expenseCategories.active })
    .from(s.expenseEntries)
    .innerJoin(s.expenseCategories, eq(s.expenseCategories.id, s.expenseEntries.categoryId))
    .where(eq(s.expenseEntries.cashOutId, cashOutId))
    .limit(1);
  return staffExpenseLocked(cur);
}

/**
 * Personelin değişikliği doğrudan mı yazılır ("direct") yoksa yöneticinin onayına mı gider ("request"); hiç olmuyorsa
 * UserError (gün pencere dışında, satır kilitli, gün kapalı işaretli). Yönetici her zaman "direct". İşlemin içinde,
 * satır kilitlendikten sonra çağrılır: aynı anda gelen yazımla aynı olgulara bakar.
 */
export async function staffCashOutGate(tx: CashOutTx, me: CashOutActor, target: CashOutTarget, now: Date = new Date()): Promise<"direct" | "request"> {
  if (me.role === "admin") return "direct";
  const date = target.op === "ekle" ? target.date : target.row.date;
  // Kilit ve kapalı gün satırın şubesinde (denetim KP-04, KP-06): öteki şubenin raporu bu şubenin gününü kapatmaz
  const branchId = target.op === "ekle" ? (target.branchId ?? (await currentWriteBranch())) : target.row.branchId;
  const [dayOpen, adminCategory, payment] = await Promise.all([
    staffDayOpen(date, tx, now, branchId),
    target.op === "ekle" ? false : adminCategoryOf(tx, target.row.id),
    target.op === "ekle" ? null : cashOutPayment(tx, target.row.id),
  ]);
  // Kapalı işaretli güne (yöneticinin onayladığı "Kafe kapalıydı") personel kasadan çıkan yazamaz
  const closed = target.op === "ekle" || target.op === "duzelt" ? await closedDayRefusal(date, me.role, tx, branchId) : null;
  if (closed) throw new UserError(closed);
  const gate = cashOutNeedsApproval({
    admin: false,
    op: target.op,
    dayOpen,
    canReport: staffCanReport(date, now),
    inWindow: requestDayAllowed(date, now),
    adminCategory,
    // Satırın kilidi: yöneticinin bir tedarikçi ödemesine bağladığı satır (docs/TEDARIKCILER.md "Hesap hareketleri");
    // personel düzeltemez, silemez, istek de açamaz (tutarıyla görünür)
    rowLocked: payment !== null,
  });
  if (gate === "closed" && payment !== null) throw new UserError(CARI_LOCKED_STAFF);
  if (gate === "closed") throw new UserError(target.op === "ekle" ? CASH_OUT_REQUEST_TEXT.window : target.op === "fis" ? CASH_OUT_REQUEST_TEXT.receiptDay : CASH_OUT_REQUEST_TEXT.closed);
  return gate;
}
