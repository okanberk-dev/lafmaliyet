import "server-only";

import { staffCanReport } from "@/lib/cash-report";
import { CASH_OUT_REQUEST_TEXT, cashOutNeedsApproval, requestDayAllowed, type CashOutOp } from "@/lib/cash-out-requests";
import { ASILPOS_CASH_OUT_TEXT, staffAsilposEntryClosed } from "@/lib/asilpos/cash-moves";
import { isAsilposDay } from "@/lib/asilpos/switch";
import { currentTillBranch, staffBranchRefusal } from "@/server/branch-scope";
import { CARI_LOCKED_STAFF, cashOutPayment } from "@/server/cari/kasa";
import { closedDayRefusal } from "@/server/closed-days";
import { switchDayOf } from "@/server/pos/tills";
import { staffDayOpen } from "@/server/photo-read/rules";
import { UserError } from "@/server/user-error";

import { adminCategoryOf, type CashOutActor, type CashOutRow, type CashOutTx } from "./write";

/*
 * Personelin kasadan çıkan kapısı (docs/KASA-RAPORU.md › Kasadan çıkan: kapanmış gün, yöneticinin satırı; plan
 * docs/planlar/personel-yetki.md §2.7). Personelin bütün kasadan çıkan yolları buradan geçer: doğrudan ekleme,
 * düzeltme ve silme (src/server/actions/cash-outs.ts), istekler ve fiş ekleme (src/server/cash-outs/requests.ts). Bir
 * satırın personele kapanması (ör. yöneticinin bir ödemeye bağladığı satır) yalnız burada ve saf kuralında
 * (src/lib/cash-out-requests.ts cashOutNeedsApproval, `rowLocked`) yazılır; doğrudan yol da istek yolu da onu görür.
 */

/**
 * `restore`: silinenin "Geri al"ı (mühürlü kopyayla, 15 dakika; actions/cash-outs.ts restoreCashOut): yeni satır sayılmaz,
 * AsilPOS gününün ekleme reddi uygulanmaz (personelin az önce sildiği elle girilmiş satır geri gelir)
 */
export type CashOutTarget = { op: "ekle"; date: string; restore?: boolean } | { op: Exclude<CashOutOp, "ekle"> | "fis"; row: CashOutRow };

/**
 * Personelin değişikliği doğrudan mı yazılır ("direct") yoksa yöneticinin onayına mı gider ("request"); hiç olmuyorsa
 * UserError (gün pencere dışında, satır kilitli, gün kapalı işaretli). Yönetici her zaman "direct". İşlemin içinde,
 * satır kilitlendikten sonra çağrılır: aynı anda gelen yazımla aynı olgulara bakar.
 */
export async function staffCashOutGate(tx: CashOutTx, me: CashOutActor, target: CashOutTarget, now: Date = new Date()): Promise<"direct" | "request"> {
  // Var olan satır (düzeltme, silme, istek, fiş): şubesine kilitli personel ve müdür yalnız kendi şubesinin satırına
  // dokunur. Satır kimliğiyle gelir; yalnız günün açıklığına bakmak başka şubenin açık gününü açıyordu (21 Kasım denetimi
  // #14). Kilit oturumdan okunur: müdür buraya "admin" düzeyinde gelir (src/lib/roles.ts › opsLevel), şubesi yine kilitli
  const refusal = target.op === "ekle" ? null : await staffBranchRefusal(me, target.row.branchId);
  if (refusal) throw new UserError(refusal);
  if (me.role === "admin") return "direct";
  const date = target.op === "ekle" ? target.date : target.row.date;
  // AsilPOS gününe personel satır eklemez (sahibin kararı, 24 Kasım 2026; staffAsilposEntryClosed): kasadan çıkanlar AsilPOS'un
  // kasa hareketlerinden gelir. Doğrudan ekleme, ekleme isteği ve satırı başka güne taşıma buradan geçer. Düzeltme ve fiş
  // (AsilPOS satırına fiş fotoğrafı, kategori) açık kalır; yönetici her zaman ekler
  if (target.op === "ekle" && !target.restore) {
    // Kasanın şubesinin kendi AsilPOS günü (çok şube; kasası ModPOS olan şubede geçiş günü yok)
    const till = await currentTillBranch();
    const asilposDay = isAsilposDay(date, await switchDayOf(till, tx));
    if (staffAsilposEntryClosed({ admin: false, asilposDay })) throw new UserError(ASILPOS_CASH_OUT_TEXT.staffAdd);
  }
  const [dayOpen, adminCategory, payment] = await Promise.all([
    // Satırın kasası: var olan satırda satırın şubesi, yeni satırda kasanın şubesi (yazım da oraya iner)
    staffDayOpen(date, tx, now, target.op === "ekle" ? undefined : target.row.branchId),
    target.op === "ekle" ? false : adminCategoryOf(tx, target.row.id),
    target.op === "ekle" ? null : cashOutPayment(tx, target.row.id),
  ]);
  // Kapalı işaretli güne (yöneticinin onayladığı "Kafe kapalıydı") personel kasadan çıkan yazamaz
  // Kapalı gün satırın kasasının (yeni satırda kasanın şubesi): öteki şubenin kapalı günü bu şubenin yazımını kapatmaz
  const closed =
    target.op === "ekle" || target.op === "duzelt" ? await closedDayRefusal(date, me.role, tx, target.op === "ekle" ? await currentTillBranch() : target.row.branchId) : null;
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
