"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { BRANCH_ID_MAX } from "@/lib/branches";
import { businessDate } from "@/lib/cash-report";
import { CASH_OUT_REQUEST_TEXT } from "@/lib/cash-out-requests";
import { cashOutLabel, cashOutUndoJson, readCashOutUndo, type CashOutSnapshot } from "@/lib/cash-outs";
import { money } from "@/lib/format";
import { longDateTR } from "@/lib/reminders";
import { asActor, opsLevel, realRoleOf } from "@/lib/roles";
import { requireCan } from "@/server/auth/dal";
import { formTillBranch, staffBranchRefusal, withBranchScope } from "@/server/branch-scope";
import { assertCashOutDeletable, lockCashOutLink, syncLinkedCashOut } from "@/server/cari/kasa";
import { staffCashOutGate } from "@/server/cash-outs/guard";
import { cashOutSchema, lockCashOut, removeCashOut, writeCashOut, type CashOutActor, type CashOutData, type CashOutInput } from "@/server/cash-outs/write";
import { getDb } from "@/server/db";
import { open, seal } from "@/server/secret-box";

import { logActivity } from "./log";
import { attempt, UserError } from "./util";

// Gün içinde kasadan çıkanlar (docs/KASA-RAPORU.md, docs/FOTOGRAF.md): personel ve yönetici ekler. Alışveriş satırı
// Aylık harcamalar'a da yazılabilir; o kayıt expense_entries.cash_out_id ile satıra ve fişin fotoğrafına bağlıdır.
// Personelin yeni satırı kurala göre yazılır (fiş evet, fatura / e-Arşiv hayır: Paraşüt'ten de gelir), yalnız alım
// kategorilerinde; teslim hiçbir zaman. Personelin düzeltmesi kaydı açmaz ve silmez (yöneticinin Aylık harcamalar'daki
// kararı kalır); geri alma silineni olduğu gibi getirir (cashOutWritesExpense). Akşam raporunun "Gün içinde kasadan
// çıkan" tutarı bunlardan dolar. Yazım yolu src/server/cash-outs/write.ts; personelin her yolu kapıdan geçer
// (src/server/cash-outs/guard.ts staffCashOutGate): kapanmış gün ve yöneticinin kategorisindeki satır onaya gider
// (src/server/actions/cash-out-requests.ts), burada yalnız doğrudan yazılanlar.

export type { CashOutInput };

/** "21 Ekim Salı · Migros · 412,50 ₺ · fişli · harcamalara yazıldı" */
function logDetail(d: CashOutData, expense: boolean) {
  return [longDateTR(d.date), cashOutLabel(d), money(d.amount), d.photoId ? "fişli" : null, expense ? "harcamalara yazıldı" : null].filter(Boolean).join(" · ");
}

/**
 * Satırı yazar (yeni, düzeltme ya da geri alma), tek işlemde. Personelde kapı: kapanmış güne ya da yöneticinin
 * kategorisindeki satıra doğrudan yazılmaz (istek yolu); satır başka bir güne taşınıyorsa o gün de açık olmalı.
 */
async function persist(me: CashOutActor, d: CashOutData, opts: { restore?: boolean; restoreId?: number; branchId?: string } = {}) {
  if (d.date > businessDate()) throw new UserError("İleri bir günün kasasına eklenemez");
  const admin = me.role === "admin";
  // Tedarikçiler (cari) yalnız yöneticinin: "admin" düzeyinde yazan müdür bağlı satırda personel gibi kilitli
  const owner = realRoleOf(me) === "admin";
  const saved = await getDb().transaction(async (tx) => {
    // Tedarikçi ödemesine bağlı satır (src/server/cari/kasa.ts): personel ve müdür düzeltemez, yöneticide önce kart kilitlenir
    const link = d.id ? await lockCashOutLink(tx, d.id, owner) : null;
    const prev = d.id ? await lockCashOut(tx, d.id) : null;
    if (d.id && !prev) throw new UserError("Satır bulunamadı; silinmiş olabilir");
    // Müdür "admin" düzeyinde yazar ama şubesine kilitli: var olan satır kendi şubesinin olmalı (kilit oturumdan)
    if (admin && prev) {
      const refusal = await staffBranchRefusal(me, prev.branchId);
      if (refusal) throw new UserError(refusal);
    }
    if (!admin) {
      const gate = await staffCashOutGate(tx, me, prev ? { op: "duzelt", row: prev } : { op: "ekle", date: d.date, restore: opts.restore });
      const moved = prev && prev.date !== d.date ? await staffCashOutGate(tx, me, { op: "ekle", date: d.date }) : "direct";
      if (gate === "request" || moved === "request") throw new UserError(CASH_OUT_REQUEST_TEXT.needsApproval);
    }
    const supplier = prev ? await syncLinkedCashOut(tx, prev.id, link, { admin: owner, kind: d.kind, amount: d.amount, date: d.date }) : null;
    return { ...(await writeCashOut(tx, me, d, { prev, restore: opts.restore, restoreId: opts.restoreId, branchId: opts.branchId })), supplier };
  });
  await logActivity(me, saved.updated ? "Kasadan çıkan düzeltildi" : "Kasadan çıkan", logDetail(d, saved.expenseId !== null) + (saved.supplier ? ` · ${saved.supplier} ödemesi de güncellendi` : ""));
  refresh();
  return { id: saved.id, expenseId: saved.expenseId };
}

const saveSchema = cashOutSchema.extend({
  /** Formun gösterdiği kasa (docs/SUBE.md › Yazarken hangi şube); göndermeyen eski sekmede seçili kasa */
  branchId: z.string().max(BRANCH_ID_MAX).nullish(),
});

/**
 * Kasadan çıkan satırını ekler ya da düzeltir. Yeni satır formun gösterdiği kasaya yazılır (formTillBranch), gönderim
 * anındaki seçime değil: başka sekmede seçici değişince Tuzla'nın kartından eklenen satır Marina'nın kasasına
 * iniyordu. Personelin kapısı da o kasanın gününe bakar; düzeltilen satır kendi şubesinde kalır.
 */
export async function saveCashOut(input: z.input<typeof saveSchema>) {
  return attempt(async () => {
    const me = await requireCan("kayit.yaz");
    const { branchId, ...d } = saveSchema.parse(input);
    // Müdür "admin" düzeyinde yazar ama bütün kategorileri seçemez: kural yazım yolunda (writeCashOut, gerçek rol
    // `realRole`), isteğin onayı da aynı kuraldan geçer (docs/ROLLER.md › Kararlar)
    const till = await formTillBranch(branchId);
    return withBranchScope(till, () => persist(asActor(me, opsLevel(me.role)), d));
  });
}

/**
 * Siler (bağlı harcama kaydıyla); fotoğraf 7 gün daha saklanır. Geri almak için silinenin mühürlü kopyası döner
 * (`undo`; istemci içini okuyamaz ve değiştiremez). Personel kapanmış günün ve yöneticinin kategorisindeki satırı
 * silmez: silinmesini ister (kayıt onunla giderdi; geri alma da o kategoriye yazamazdı).
 */
export async function deleteCashOut(id: number) {
  return attempt(async (): Promise<{ undo: string }> => {
    const actor = await requireCan("kayit.yaz");
    const me = asActor(actor, opsLevel(actor.role));
    const cid = z.number().int().positive().parse(id);
    const snap = await getDb().transaction(async (tx) => {
      const row = await lockCashOut(tx, cid);
      if (!row) throw new UserError("Satır bulunamadı; silinmiş olabilir");
      const otherBranch = await staffBranchRefusal(me, row.branchId);
      if (otherBranch) throw new UserError(otherBranch);
      // Bağlı satır: müdüre de personel gibi kilitli (tedarikçinin adı ve ödeme günü yalnız yöneticiye)
      await assertCashOutDeletable(tx, cid, actor.role === "admin");
      if (me.role !== "admin" && (await staffCashOutGate(tx, me, { op: "sil", row })) === "request") throw new UserError(CASH_OUT_REQUEST_TEXT.needsApproval);
      return removeCashOut(tx, row);
    });
    await logActivity(me, "Kasadan çıkan silindi", [longDateTR(snap.date), cashOutLabel(snap), money(snap.amount)].join(" · "));
    refresh();
    return { undo: seal(cashOutUndoJson(me.id, cid, snap, Date.now()), "cashout-undo") };
  });
}

/** Hatanın kırdığı kısıt (sürücünün hatası ya da Drizzle'ın sardığı) */
const constraintOf = (e: unknown) =>
  (e as { constraint_name?: string })?.constraint_name ?? (e as { cause?: { constraint_name?: string } })?.cause?.constraint_name;

/**
 * Silineni geri getirir (fotoğraf yeniden bağlanır). Yalnız deleteCashOut'un mühürlü kopyasıyla: aynı kişi, 15 dakika
 * içinde. Harcama kaydı silinmeden önceki gibi: varsa aynı kategori, açıklama, ödeme şekli ve notla geri gelir, yoksa
 * açılmaz (personelde de). İstemcinin yazdığı bir kopya kabul edilmez. Satır eski numarasıyla geri gelir: aynı "Geri
 * al" ikinci kez (çift dokunuş, yeniden gönderilen istek) kopya açmaz.
 */
export async function restoreCashOut(undo: string) {
  return attempt(async () => {
    const actor = await requireCan("kayit.yaz");
    const me = asActor(actor, opsLevel(actor.role));
    const sealed = z.string().max(8000).safeParse(undo);
    const opened = sealed.success ? readCashOutUndo(open(sealed.data, "cashout-undo"), me.id, Date.now()) : null;
    if (!opened) throw new UserError("Geri alma süresi doldu; satırı yeniden ekleyin");
    const snap: CashOutSnapshot = opened.snap;
    const d = cashOutSchema.parse({
      id: null,
      date: snap.date,
      kind: snap.kind,
      amount: snap.amount,
      store: snap.store,
      description: snap.description,
      receiptDate: snap.receiptDate,
      receiptNo: snap.receiptNo,
      vat: snap.vat,
      docType: snap.docType,
      categoryId: snap.expense?.categoryId ?? null,
      toExpenses: snap.expense !== null,
      photoId: snap.photoId,
      expenseNote: snap.expense?.note ?? null,
      expenseDescription: snap.expense?.description,
      expensePaymentMethod: snap.expense?.paymentMethod,
    });
    try {
      // Satır mühürlü görüntüdeki şubesine döner; alanı olmayan eski görüntüde eski davranış (seçili şube)
      return await persist(me, d, { restore: true, restoreId: opened.id, branchId: snap.branchId ?? undefined });
    } catch (e) {
      if (constraintOf(e) === "cash_outs_pkey") throw new UserError("Bu satır zaten geri alındı");
      throw e;
    }
  });
}
