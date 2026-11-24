"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { ALL_BRANCHES } from "@/lib/branches";
import { foldName, paidFixedRatesOf } from "@/lib/cash-plan";
import { dateTR, monthLabel, tl } from "@/lib/format";
import {
  addDays,
  advancePast,
  dueNotifications,
  endOfMonthAnchor,
  FIXED_REMINDER_NOTE,
  fixedReminderAt,
  fixedReminderNextAmount,
  isLastDayOfMonth,
  isProvisionalTaxReminder,
  isVatReminder,
  isVatWithholdingReminder,
  nextOccurrence,
  postponeDate,
  postponedFrom,
  postponeNote,
  postponePlan,
  taxAmountTravels,
  todayTR,
  travelingAmountKind,
  type ReminderRepeat,
  type UpcomingItem,
} from "@/lib/reminders";
import { METHOD_LABEL, type CariMethod } from "@/lib/cari/balance";
import { emailKey, recipientRefusal } from "@/lib/notify-recipients";
import { pastMonthLogSuffix, type MonthEffect } from "@/lib/cari/months";
import { reminderUnchanged } from "@/lib/recent-paid";
import { unreachable } from "@/lib/unreachable";
import { paidPeriodsOf } from "@/lib/vat-paid";
import { requireAdmin } from "@/server/auth/dal";
import { deleteRecentPayment, NeedsPastConfirm } from "@/server/cari/entries";
import { undoConversion, type ConvertSnapshot } from "@/server/cari/kasa";
import { dropAllocations } from "@/server/cari/settle";
import { forgetChangedReminder, forgetPaid, loadRecentPaid, rememberPaid } from "@/server/data/recent-paid";
import { forgetVatPaid, rememberVatPaid } from "@/server/data/vat-paid";
import { loadTermDays } from "@/server/data/suppliers";
import { currentExpenseBranch, withBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";
import { isProductionRuntime, loadEmailProblems } from "@/server/jobs/alerts";
import { invoiceNewsOf, loadDigestInvoices, loadDigestPrices, loadUpcoming, renderDigest, runReminderDigest, sendTestEmail } from "@/server/notify/digest";
import { loadDigestExtras } from "@/server/notify/digest-extras";
import { blockedAccounts } from "@/server/notify/recipients";
import { loadNotifySettings, saveNotifySettings, type NotifySettings } from "@/server/notify/settings";

import { logActivity } from "./log";
import { attempt, UserError, zDate, zMonth, zOptText, zText } from "./util";

const zId = z.number().int().positive();

const reminderSchema = z.object({
  id: z.number().int().positive().nullable(),
  title: zText("Başlık", 120),
  kind: z.enum(["odeme", "vergi", "kira", "maas", "fatura", "diger"]),
  amount: z.number({ message: "Tutar sayı olmalı" }).finite("Tutar sayı olmalı").min(0, "Tutar negatif olamaz").nullable(),
  dueDate: zDate,
  repeat: z.enum(["none", "weekly", "monthly", "quarterly", "yearly"]),
  remindDaysBefore: z.number().int().min(0, "Gün negatif olamaz").max(60, "En fazla 60 gün"),
  note: zOptText(500),
  active: z.boolean(),
  /** Ayın son günü seçiliyse tekrarlar her ayın son gününe kayar (SGK gibi); verilmezse eski davranış */
  endOfMonth: z.boolean().optional(),
  /**
   * Ödemenin şubesi (docs/SUBE.md › Ödemeler): "" / null işletme geneli. Verilmezse düzenlemede değişmez, yenide seçili
   * şube ("Tümü"nde işletme geneli)
   */
  branchId: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null)),
});

/** Ödemenin şubesi kütükte bir fiziksel şube mi (düzenlemede şimdiki şubesi pasif olsa da kalabilir) */
async function reminderBranch(branchId: string | null, keep?: string | null): Promise<string | null> {
  if (!branchId) return null;
  const b = (await listBranches()).find((x) => x.id === branchId && x.kind === "fiziksel" && (x.active || x.id === keep));
  if (!b) throw new UserError("Şube bulunamadı ya da pasif (sayfayı yenileyin)");
  return b.id;
}

export async function saveReminder(input: z.input<typeof reminderSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { id, endOfMonth, branchId, ...data } = reminderSchema.parse(input);
    const db = getDb();
    const eom = Boolean(endOfMonth) && isLastDayOfMonth(data.dueDate) && (data.repeat === "monthly" || data.repeat === "quarterly");
    const fresh = eom ? endOfMonthAnchor(data.dueDate) : data.dueDate;
    if (id) {
      const [prev] = await db.select().from(s.reminders).where(eq(s.reminders.id, id)).limit(1);
      if (!prev) throw new UserError("Hatırlatıcı bulunamadı");
      // Tarih elle değişirse tekrarların günü de yeni tarihe bağlanır
      let anchorDate = prev.dueDate !== data.dueDate ? fresh : prev.anchorDate;
      // Aynı tarihte "ayın son günü" açıldı ya da kapandı
      if (prev.dueDate === data.dueDate && endOfMonth !== undefined) {
        const wasEom = Number(prev.anchorDate.slice(8, 10)) >= 31;
        if (eom && !wasEom) anchorDate = fresh;
        if (!endOfMonth && wasEom) anchorDate = data.dueDate;
      }
      const branch = branchId === undefined ? {} : { branchId: await reminderBranch(branchId, prev.branchId) };
      await db.update(s.reminders).set({ ...data, ...branch, anchorDate }).where(eq(s.reminders.id, id));
    } else {
      const branch = branchId === undefined ? await currentExpenseBranch() : await reminderBranch(branchId);
      await db.insert(s.reminders).values({ ...data, branchId: branch, anchorDate: fresh });
    }
    await logActivity(me, id ? "Hatırlatıcı düzenlendi" : "Hatırlatıcı eklendi", `${data.title} · ${dateTR(data.dueDate)}`);
    refresh();
    return null;
  });
}

export async function deleteReminder(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const [d] = await getDb().delete(s.reminders).where(eq(s.reminders.id, zId.parse(id))).returning();
    if (d) {
      await forgetPaid("reminder", [d.id]);
      await logActivity(me, "Hatırlatıcı silindi", d.title);
    }
    refresh();
    return null;
  });
}

export async function setReminderActive(id: number, active: boolean) {
  return attempt(async () => {
    await requireAdmin();
    const rid = zId.parse(id);
    const on = z.boolean().parse(active);
    const db = getDb();
    const [r] = await db.select().from(s.reminders).where(eq(s.reminders.id, rid)).limit(1);
    if (!r) throw new UserError("Hatırlatıcı bulunamadı");
    // Yeniden açılan tekrarlı hatırlatıcı geçmişte kalmasın: bugünden sonraki ilk döneme alınır
    const today = todayTR();
    const dueDate = on && r.repeat !== "none" && r.dueDate < today ? (advancePast(r.dueDate, r.repeat as ReminderRepeat, r.anchorDate, addDaysBack(today)) ?? r.dueDate) : r.dueDate;
    await db.update(s.reminders).set({ active: on, dueDate }).where(eq(s.reminders.id, rid));
    // Kapalı tek seferliği yeniden açmak Ödendi'sini geri alır (dönemi yeniden beklenir); sonra yeniden kapatmak onu
    // ödemiş saymaz (kapatma ödeme değildir)
    if (on && !r.active && r.repeat === "none") {
      await forgetVatPaid(rid, r.dueDate);
      await forgetPaid("reminder", [rid]);
    }
    refresh();
    return null;
  });
}

/** advancePast "geçene kadar" ilerletir; bugünün kendisi de geçerli bir tarih olsun diye bir gün öncesi verilir */
function addDaysBack(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Ödendi: tekrar edenler bir sonraki döneme ilerler, tek seferlikler kapanır. `through` verilirse (gecikmiş
 * dönemden sonraki öngörülen dönem ödendiğinde) o tarihe kadarki bütün dönemler kapanır. Tekrarlı KDV, KDV-2,
 * muhtasar ve geçici vergi hatırlatıcısının tutarı o döneme aittir (her dönem başka; taxAmountTravels, K26): sıradaki
 * döneme geçerken silinir (`amountCleared`, türü `clearedKind`), geri al geri yazar; yoksa nakit planı Eylül'ün
 * tutarını Kasım'da da kesin sayardı (docs/NAKIT-PLANI.md, docs/VERGI.md). Sabit tutarlı "Kira stopajı"nın tutarı kalır.
 * KDV, KDV-2 ve geçici vergide "Ödendi" kalıcı kayda da yazılır (payments.vat-paid; geçici vergide dönem çeyrektir,
 * kurumlar vergisi yalnız ödenmiş geçici vergiyi mahsup eder).
 */
export async function markReminderDone(id: number, through?: string) {
  return attempt(async () => {
    const me = await requireAdmin();
    const rid = zId.parse(id);
    const until = through === undefined ? null : zDate.parse(through);
    const db = getDb();
    const [r] = await db.select().from(s.reminders).where(eq(s.reminders.id, rid)).limit(1);
    if (!r) throw new UserError("Hatırlatıcı bulunamadı");
    const repeat = r.repeat as ReminderRepeat;
    const next = until && until >= r.dueDate ? advancePast(r.dueDate, repeat, r.anchorDate, until) : nextOccurrence(r.dueDate, repeat, r.anchorDate);
    const clear = next !== null && taxAmountTravels(r);
    // Sabit gideri izleyen hatırlatıcı (Sabit giderlerden ekle): sıradaki dönem zamlı ayda ise tutar o ayın sürümüne
    // geçer (nakit planı ve Ödemeler aynı tutarı söyler; geri al eski tutarı yazar)
    const follow = next && !clear ? await followedAmount(r, next) : null;
    await db
      .update(s.reminders)
      .set(next ? { dueDate: next, lastDoneAt: new Date(), ...(clear ? { amount: null } : follow !== null ? { amount: follow } : {}) } : { active: false, lastDoneAt: new Date() })
      .where(eq(s.reminders.id, rid));
    await rememberPaid([{ kind: "reminder", id: rid, title: r.title, amount: r.amount, dueDate: r.dueDate, prev: snapshot(r), next }]);
    // KDV, KDV-2 ve geçici vergi: nakit planının ve Vergi'nin kalıcı kaydı (son ödenenler 30 günde düşer, bir sonraki
    // KDV gününden önce; kurumlar vergisi yalnız "Ödendi" işaretli geçici vergiyi mahsup eder)
    const vatKind = isVatWithholdingReminder(r) ? "kdv2" : isVatReminder(r) ? "kdv" : isProvisionalTaxReminder(r) ? "gecici" : null;
    if (vatKind) {
      const row = { note: r.note, repeat: r.repeat as ReminderRepeat, anchorDate: r.anchorDate };
      await rememberVatPaid({ id: rid, kind: vatKind, dueDate: r.dueDate, next, periods: paidPeriodsOf(row, r.dueDate, next, vatKind), amount: r.amount });
    }
    await logActivity(
      me,
      "Ödeme yapıldı",
      `${r.title} · ${dateTR(r.dueDate)}${r.amount ? ` · ${tl(r.amount)}` : ""}${next ? ` → sıradaki ${dateTR(next)}` : ""}${clear ? " · tutar silindi (vergi)" : ""}${follow !== null ? ` · tutar ${tl(follow)} (sabit giderdeki yeni tutar)` : ""}`,
    );
    refresh();
    // prev: "Geri al" düğmesi kaydı bu hâline döndürür (restoreReminder; tutar dahil)
    return { next, prev: snapshot(r), amountCleared: clear, clearedKind: clear ? travelingAmountKind(r) : null };
  });
}

type ReminderDbRow = typeof s.reminders.$inferSelect;

/** Sabit gideri izleyen hatırlatıcının sıradaki dönemdeki tutarı (fixedReminderNextAmount); değişmiyorsa null */
async function followedAmount(r: ReminderDbRow, nextDue: string): Promise<number | null> {
  if (!r.note?.startsWith(FIXED_REMINDER_NOTE) || r.amount === null) return null;
  const db = getDb();
  const fixed = await db.select().from(s.fixedExpenses).orderBy(asc(s.fixedExpenses.id));
  // Eşleşme nakit planınınkiyle aynı: katlanmış ad, en küçük kimlik
  const f = fixed.find((x) => foldName(x.name) === foldName(r.title));
  if (!f) return null;
  const versions = await db
    .select({ fromMonth: s.fixedExpenseVersions.fromMonth, period: s.fixedExpenseVersions.period, amount: s.fixedExpenseVersions.amount })
    .from(s.fixedExpenseVersions)
    .where(eq(s.fixedExpenseVersions.fixedExpenseId, f.id));
  if (f.endMonth && nextDue.slice(0, 7) > f.endMonth) return null;
  // Stopajlı kalemde tutar bankadan çıkan nettir (stopaj muhtasarda); yurt dışı hizmette KDV yok (KDV-2'de; docs/VERGI.md)
  const rated = paidFixedRatesOf(f, Number(nextDue.slice(0, 4)));
  return fixedReminderNextAmount({ note: r.note, amount: r.amount, dueDate: r.dueDate, repeat: r.repeat as ReminderRepeat }, rated, versions, nextDue);
}

function snapshot(r: ReminderDbRow) {
  return { dueDate: r.dueDate, anchorDate: r.anchorDate, active: r.active, lastDoneAt: r.lastDoneAt ? r.lastDoneAt.toISOString() : null, amount: r.amount, note: r.note };
}

const snapshotSchema = z.object({
  dueDate: zDate,
  anchorDate: zDate,
  active: z.boolean(),
  lastDoneAt: z
    .string()
    .max(40)
    .nullable()
    .refine((v) => v === null || !Number.isNaN(new Date(v).getTime()), "Geçersiz tarih"),
  /** Eski bildirimlerin geri al'ı tutarı taşımaz (o zaman tutar yazılmaz) */
  amount: z.number().finite().min(0).nullable().optional(),
  /** Ertelemenin yazdığı not ("Ertelendi · asıl tarih ...") geri alınınca eski hâline döner; eskilerde yok */
  note: z.string().max(500).nullable().optional(),
});

/**
 * Geri al: "Ödendi" ya da "Ertele"den önceki hâl geri yazılır. Ertelemede tekrar eden hatırlatıcı için açılan tek
 * seferlik kayıt (removeId) silinir.
 */
export async function restoreReminder(id: number, prev: z.input<typeof snapshotSchema>, removeId?: number | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const rid = zId.parse(id);
    const snap = snapshotSchema.parse(prev);
    const extra = removeId === undefined || removeId === null ? null : zId.parse(removeId);
    if (extra === rid) throw new UserError("Geçersiz geri alma");
    const db = getDb();
    const title = await db.transaction(async (tx) => {
      const [r] = await tx
        .update(s.reminders)
        .set({
          dueDate: snap.dueDate,
          anchorDate: snap.anchorDate,
          active: snap.active,
          lastDoneAt: snap.lastDoneAt ? new Date(snap.lastDoneAt) : null,
          // Ödendi / ertelemede silinen KDV tutarı geri gelir
          ...(snap.amount !== undefined ? { amount: snap.amount } : {}),
          ...(snap.note !== undefined ? { note: snap.note } : {}),
        })
        .where(eq(s.reminders.id, rid))
        .returning({ title: s.reminders.title });
      if (!r) throw new UserError("Hatırlatıcı bulunamadı");
      if (extra) await tx.delete(s.reminders).where(eq(s.reminders.id, extra));
      return r.title;
    });
    // "Ödendi"nin geri alınması Son ödenenler kaydını siler; ödemeden sonraki "Ertele"nin geri alınması ise
    // hatırlatıcıyı ödendikten sonraki hâline döndürür, o kayıt geri alınabilir kalır
    await forgetChangedReminder({ id: rid, dueDate: snap.dueDate, anchorDate: snap.anchorDate, active: snap.active });
    // Hatırlatıcı o güne döndü: o günden itibaren "Ödendi"si kalmaz (KDV'nin kalıcı kaydı)
    await forgetVatPaid(rid, snap.dueDate);
    await logActivity(me, "Hatırlatıcı geri alındı", `${title} · ${dateTR(snap.dueDate)}`);
    refresh();
    return null;
  });
}

/**
 * Ödemeler › Son ödenenler: 30 gün içinde "Ödendi" işaretlenen faturayı ödenmemişe, hatırlatıcıyı ödenmeden önceki
 * tarihine döndürür; tedarikçiye girilen cari ödemeyi siler (§3.4: dağıtımları kalkar, defterin kapattığı faturalar
 * yeniden açılır). Hatırlatıcı o zamandan beri değiştiyse (yeniden ödendi, ertelendi, düzenlendi) eski hâl yazılmaz;
 * ödeme sonradan düzenlendiyse silinmez. Ödemeye çevir'in geri alınması gider kaydını geçmiş bir aya yazacaksa
 * `{ needs: "past" }` döner, onaylanan aylarla (`confirmPast`) yeniden gönderilir (K18).
 */
export async function undoRecentPaid(kind: "invoice" | "reminder" | "cari", id: number, confirmPast?: string[]) {
  return attempt(async (): Promise<{ needs: "past"; effects: MonthEffect[] } | { needs: null }> => {
    const me = await requireAdmin();
    const k = z.enum(["invoice", "reminder", "cari"]).parse(kind);
    const rid = zId.parse(id);
    const months = z.array(zMonth).max(60).parse(confirmPast ?? []);
    const entry = (await loadRecentPaid()).find((e) => e.kind === k && e.id === rid);
    // Hata dönen durumlarda da liste yenilenir: geri alınamayan satır ekranda kalmasın (liveRecentPaid gizler)
    if (!entry) {
      refresh();
      throw new UserError("Bu ödeme artık listede yok (geri alınmış ya da 30 günü geçmiş olabilir)");
    }
    const db = getDb();
    switch (k) {
      case "invoice": {
        // ✓ hesaptaki cari ödemesini kullandıysa önce o dağıtımlar silinir; hesaptaki ödemeyle kapanmış fatura ödenmediye
        // dönmez (K7; engel aynı işlemde: reddedilirse dağıtımlar silinmez)
        const allocationIds = Array.isArray(entry.allocationIds) ? entry.allocationIds.filter((x) => Number.isInteger(x) && x > 0) : [];
        await dropAllocations(allocationIds, [rid], [rid]);
        const [row] = await db
          .update(s.invoices)
          .set({ unpaid: true, paidAt: null, paidVia: null, paymentRequestedAt: entry.requestedAt ?? null, paidByLedger: false })
          .where(eq(s.invoices.id, rid))
          .returning({ supplier: s.invoices.supplier, payable: s.invoices.payable });
        await forgetPaid("invoice", [rid]);
        if (!row) {
          refresh();
          throw new UserError("Fatura bulunamadı (silinmiş olabilir)");
        }
        await logActivity(me, "Fatura ödenmedi işaretlendi", `${row.supplier} ${tl(row.payable, 2)} · son ödenenlerden geri alındı`);
        break;
      }
      case "reminder": {
        const [cur] = await db.select().from(s.reminders).where(eq(s.reminders.id, rid)).limit(1);
        if (!cur) {
          await forgetPaid("reminder", [rid]);
          refresh();
          throw new UserError("Hatırlatıcı bulunamadı (silinmiş olabilir)");
        }
        const prev = entry.prev;
        if (!prev || !reminderUnchanged(entry, cur)) {
          refresh();
          throw new UserError("Hatırlatıcı ödendikten sonra değişti (yeniden ödendi, ertelendi ya da düzenlendi); tarihini düzenleyerek düzeltin");
        }
        // Ödendi'de silinen KDV tutarı geri yazılır; ödendikten sonra yeni yazılmış tutar ezilmez
        const amount = prev.amount === null || (typeof prev.amount === "number" && Number.isFinite(prev.amount) && prev.amount >= 0) ? prev.amount : undefined;
        // Yalnız okunan hâl hâlâ duruyorsa yazılır (okuma ile yazma arasında başka sekmeden ödenmiş / ertelenmiş olabilir)
        const [done] = await db
          .update(s.reminders)
          .set({
            dueDate: prev.dueDate,
            anchorDate: prev.anchorDate,
            active: prev.active,
            lastDoneAt: prev.lastDoneAt ? new Date(prev.lastDoneAt) : null,
            ...(amount !== undefined && cur.amount === null ? { amount } : {}),
          })
          .where(and(eq(s.reminders.id, rid), eq(s.reminders.dueDate, cur.dueDate), eq(s.reminders.anchorDate, cur.anchorDate), eq(s.reminders.active, cur.active)))
          .returning({ id: s.reminders.id });
        if (!done) {
          refresh();
          throw new UserError("Hatırlatıcı bu arada değişti; sayfa yenilendi, yeniden deneyin");
        }
        await forgetPaid("reminder", [rid]);
        await forgetVatPaid(rid, prev.dueDate);
        await logActivity(me, "Hatırlatıcı geri alındı", `${cur.title} · ${dateTR(prev.dueDate)} · son ödenenlerden`);
        break;
      }
      case "cari": {
        // "Ödemeye çevir"le açılan ödeme: çevirme geri alınır (ödeme silinir, Kasa satırı eski türüne ve gider kaydı
        // yerine döner); sonradan düzenlendiyse yapılmaz
        if (entry.conversion) {
          const snap = entry.conversion as ConvertSnapshot;
          let u: Awaited<ReturnType<typeof undoConversion>>;
          try {
            u = await db.transaction((tx) => undoConversion(tx, snap, months));
          } catch (e) {
            // Gider kaydı geçmiş aya dönecek: ay adıyla sorulur, hiçbir şey yazılmadı (K18)
            if (e instanceof NeedsPastConfirm) return { needs: "past", effects: e.effects };
            throw e;
          }
          await forgetPaid("cari", [rid]);
          await logActivity(
            me,
            "Ödemeye çevirme geri alındı",
            [dateTR(u.line.date).slice(0, 5), u.card.name, tl(u.line.amount, 2), u.expenseRestored ? "gider kaydı yeniden yazıldı" : "", "son ödenenlerden geri alındı"].filter(Boolean).join(" · ") +
              pastMonthLogSuffix(u.effects),
          );
          break;
        }
        // Ödeme silinir (dağıtımları kalkar, defterin kapattığı faturalar yeniden açılır); kaydedildikten sonra
        // düzenlendiyse silinmez. Kilit sırası kart, sonra kayıt (K24)
        const r = await db.transaction((tx) => deleteRecentPayment(tx, rid, entry));
        await forgetPaid("cari", [rid]);
        if (!r) {
          refresh();
          throw new UserError("Ödeme bulunamadı (silinmiş olabilir)");
        }
        const e = r.snapshot.entry;
        const after = [r.reopened ? `${r.reopened} fatura ödenmemişe döndü` : "", r.kept ? `${r.kept} fatura başka biçimde ödendi işaretli, bırakıldı` : ""].filter(Boolean).join("; ");
        await logActivity(
          me,
          "Cari ödeme silindi",
          [r.card.name, dateTR(e.date), tl(e.amount, 2), METHOD_LABEL[(e.method ?? "diger") as CariMethod], after, "son ödenenlerden geri alındı"].filter(Boolean).join(" · "),
        );
        break;
      }
      default:
        unreachable(k);
    }
    refresh();
    return { needs: null };
  });
}

const zPostpone = z.enum(["week", "month"]);

/**
 * Ertele (+1 hafta / +1 ay). Tek seferlik hatırlatıcının tarihi kayar. Tekrar edende seri bozulmasın diye bu dönem
 * ertelenen tarihte tek seferlik bir hatırlatıcıya taşınır, seri sıradaki döneme geçer (Kira 1 Kas → 8 Kas tek
 * sefer; aylık kira 1 Ara'dan devam eder).
 */
export async function postponeReminder(id: number, by: "week" | "month") {
  return attempt(async () => {
    const me = await requireAdmin();
    const rid = zId.parse(id);
    const step = zPostpone.parse(by);
    const db = getDb();
    const [r] = await db.select().from(s.reminders).where(eq(s.reminders.id, rid)).limit(1);
    if (!r) throw new UserError("Hatırlatıcı bulunamadı");
    if (!r.active) throw new UserError("Kapalı hatırlatıcı ertelenemez");
    // Gecikmiş dönem bugünden ertelenir; tekrar edenin yeni tarihi sıradaki dönemin üstüne binemez
    const repeat = r.repeat as ReminderRepeat;
    const { target, next, conflict } = postponePlan({ dueDate: r.dueDate, repeat, anchorDate: r.anchorDate }, step, todayTR());
    if (conflict && next) {
      throw new UserError(`Sıradaki dönem ${dateTR(next)} tarihinde; ${step === "month" ? "1 ay" : "1 hafta"} ertelemek aynı ödemeyi iki kez gösterirdi. Daha kısa erteleyin ya da tarihi düzenleyin.`);
    }
    const prev = snapshot(r);
    let createdId: number | null = null;
    if (!next) {
      // Tek seferlik de asıl gününü notunda taşır (nakit planı KDV-2'nin dönemini ondan bulur)
      await db.update(s.reminders).set({ dueDate: target, anchorDate: target, note: postponeNote(r.note, r.dueDate) }).where(eq(s.reminders.id, rid));
    } else {
      createdId = await db.transaction(async (tx) => {
        const [c] = await tx
          .insert(s.reminders)
          .values({
            title: r.title,
            kind: r.kind,
            amount: r.amount,
            dueDate: target,
            anchorDate: target,
            repeat: "none",
            remindDaysBefore: r.remindDaysBefore,
            note: postponeNote(postponedFrom(r.note) ? null : r.note, r.dueDate),
            // Kopya serinin şubesinde kalır: Marina'nın kirası ertelenince Tuzla'nın Ödemeler'ine "işletme geneli"
            // olarak düşmesin (docs/SUBE.md › Ödemeler; denetim 21 Kasım #17)
            branchId: r.branchId,
          })
          .returning({ id: s.reminders.id });
        // KDV, KDV-2, muhtasar ve geçici vergi tutarı ertelenen döneme aittir: kopyada kalır, seriden silinir (geri al
        // geri yazar; taxAmountTravels)
        await tx
          .update(s.reminders)
          .set({ dueDate: next, ...(taxAmountTravels(r) ? { amount: null } : {}) })
          .where(eq(s.reminders.id, rid));
        return c.id;
      });
    }
    await logActivity(me, "Hatırlatıcı ertelendi", `${r.title} · ${dateTR(r.dueDate)} → ${dateTR(target)}${next ? ` · seri ${dateTR(next)} tarihinden sürer` : ""}`);
    refresh();
    return { dueDate: target, next, createdId, prev };
  });
}

/**
 * Ödenmemiş faturanın vadesini ertele; vadesizse tahmini vadeden (fatura tarihi + tedarikçinin kartındaki ya da
 * ayardaki vade günü; kart Tedarikçiler'deki gibi adla ve vergi noyla bulunur) ileri alınır
 */
export async function postponeInvoice(id: number, by: "week" | "month") {
  return attempt(async () => {
    const me = await requireAdmin();
    const iid = zId.parse(id);
    const step = zPostpone.parse(by);
    const db = getDb();
    const [inv] = await db
      .select({ id: s.invoices.id, supplier: s.invoices.supplier, supplierTaxNumber: s.invoices.supplierTaxNumber, date: s.invoices.date, dueDate: s.invoices.dueDate, unpaid: s.invoices.unpaid })
      .from(s.invoices)
      .where(eq(s.invoices.id, iid))
      .limit(1);
    if (!inv) throw new UserError("Fatura bulunamadı");
    if (!inv.unpaid) throw new UserError("Bu fatura ödenmiş görünüyor");
    const [settings, termDays] = await Promise.all([loadNotifySettings(), loadTermDays()]);
    const current = inv.dueDate ?? addDays(inv.date, termDays(inv.supplier, inv.supplierTaxNumber) ?? settings.invoiceTermDays);
    // Gecikmiş vade bugünden ertelenir (eski vadeden sayılsa yine geçmişte kalırdı)
    const target = postponeDate(current, step, todayTR());
    await db.update(s.invoices).set({ dueDate: target }).where(eq(s.invoices.id, iid));
    await logActivity(me, "Fatura vadesi ertelendi", `${inv.supplier} · ${dateTR(current)} → ${dateTR(target)}`);
    refresh();
    return { dueDate: target, prev: inv.dueDate };
  });
}

/** Ödenmemiş faturanın vadesi (Faturalar ve hatırlatıcılar ekranından) */
export async function setInvoiceDueDate(id: number, dueDate: string | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const parsed = dueDate === null ? null : zDate.parse(dueDate);
    const [d] = await getDb().update(s.invoices).set({ dueDate: parsed }).where(eq(s.invoices.id, zId.parse(id))).returning();
    if (d) await logActivity(me, "Fatura vadesi", `${d.supplier} · ${parsed ? dateTR(parsed) : "vade kaldırıldı"}`);
    refresh();
    return null;
  });
}

/** Sabit giderden hatırlatıcı (kira, aidat, internet …): ilk ödeme tarihi verilir, gider döneminde tekrar eder */
export async function addFixedExpenseReminder(fixedExpenseId: number, firstDate: string) {
  return attempt(async () => {
    const me = await requireAdmin();
    const dueDate = zDate.parse(firstDate);
    const db = getDb();
    const [f] = await db.select().from(s.fixedExpenses).where(eq(s.fixedExpenses.id, zId.parse(fixedExpenseId))).limit(1);
    if (!f) throw new UserError("Sabit gider bulunamadı");
    // Biten gider: hatırlatıcı bitişten sonra başlamaz (yoksa nakit planı bitmiş gideri her ay öderdi; E-62)
    if (f.endMonth && dueDate.slice(0, 7) > f.endMonth) {
      throw new UserError(`${f.name} ${monthLabel(f.endMonth)} ayında bitiyor; ilk ödeme en geç ${monthLabel(f.endMonth)} içinde olmalı`);
    }
    const versions = await db
      .select({ fromMonth: s.fixedExpenseVersions.fromMonth, period: s.fixedExpenseVersions.period, amount: s.fixedExpenseVersions.amount })
      .from(s.fixedExpenseVersions)
      .where(eq(s.fixedExpenseVersions.fixedExpenseId, f.id));
    // İlk ödeme ayındaki sürüm, KDV dahil (nakit planı hatırlatıcının tutarını olduğu gibi öder); sonraki bir aydan
    // değişiklik girilmişse tutarsız (plan her ayın sürümünü taşır)
    // Stopajlı kalemde stopaj düşülür: bankadan çıkan net (stopaj muhtasarda); yurt dışı hizmette KDV yok (KDV-2'de;
    // docs/VERGI.md)
    const at = fixedReminderAt(paidFixedRatesOf(f, Number(dueDate.slice(0, 4))), versions, dueDate.slice(0, 7));
    if (at.period === "gunluk") throw new UserError("Günlük giderler için hatırlatıcı oluşturulmaz");
    const repeat = at.period === "yillik" ? "yearly" : at.period === "haftalik" ? "weekly" : "monthly";
    const kind = f.section === "kira" ? "kira" : f.section === "personel" ? "maas" : "odeme";
    await db.insert(s.reminders).values({
      title: f.name,
      kind,
      amount: at.amount,
      dueDate,
      anchorDate: dueDate,
      repeat,
      remindDaysBefore: 3,
      note: FIXED_REMINDER_NOTE,
      // Kalemin şubesi (boş: işletme geneli): Marina'nın kirası Marina'nın ödemesi
      branchId: f.branchId,
    });
    await logActivity(me, "Hatırlatıcı eklendi", `${f.name} · ${dateTR(dueDate)}${at.amount ? ` · ${tl(at.amount)}` : ""}`);
    refresh();
    return { dueDate, amount: at.amount, changesFrom: at.changesFrom, endMonth: f.endMonth };
  });
}

// ---------------------------------------------------------------- Bildirim adresleri ve ayarlar
const emailSchema = z.string().trim().toLowerCase().email("Geçerli bir e-posta girin");

/** Adres personel ya da pasif bir hesabınsa UserError (dışa açılmaz: "use server" dosyasının her dışa verdiği bir uçtur) */
async function refuseBlocked(email: string) {
  const reason = (await blockedAccounts(getDb(), [email])).get(emailKey(email));
  if (reason) throw new UserError(recipientRefusal("digest", { email, reason }));
}

export async function addRecipient(email: string, name: string | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const e = emailSchema.parse(email);
    const n = zOptText(80).parse(name);
    const db = getDb();
    const [dup] = await db.select({ id: s.notificationRecipients.id }).from(s.notificationRecipients).where(eq(s.notificationRecipients.email, e)).limit(1);
    if (dup) throw new UserError(`${e} zaten listede`);
    // Sabah e-postasında ödemeler, fatura tutarları ve maliyet var: personel hesabının adresi alıcı olamaz, pasif hesaba
    // gitmez (E-53; kasa alıcılarıyla aynı kural). Gönderim de aynı kuralla süzer
    await refuseBlocked(e);
    await db.insert(s.notificationRecipients).values({ email: e, name: n });
    await logActivity(me, "Bildirim adresi eklendi", e);
    refresh();
    return null;
  });
}

export async function setRecipientActive(id: number, active: boolean) {
  return attempt(async () => {
    await requireAdmin();
    const rid = zId.parse(id);
    const on = z.boolean().parse(active);
    const db = getDb();
    if (on) {
      // Yeniden açılan adres de: personel ya da pasif hesabınsa açılmaz (gönderimde zaten düşerdi)
      const [r] = await db.select({ email: s.notificationRecipients.email }).from(s.notificationRecipients).where(eq(s.notificationRecipients.id, rid)).limit(1);
      if (r) await refuseBlocked(r.email);
    }
    await db.update(s.notificationRecipients).set({ active: on }).where(eq(s.notificationRecipients.id, rid));
    refresh();
    return null;
  });
}

export async function deleteRecipient(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const [d] = await getDb().delete(s.notificationRecipients).where(eq(s.notificationRecipients.id, zId.parse(id))).returning();
    if (d) await logActivity(me, "Bildirim adresi silindi", d.email);
    refresh();
    return null;
  });
}

const notifySchema = z.object({
  emailEnabled: z.boolean(),
  from: z
    .string()
    .trim()
    .max(160)
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^(?:[^<>]+<\s*)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+\s*>?$/.test(v), "Gönderen biçimi: Ad <ad@laffogato.net>"),
  invoiceDaysBefore: z.number().int("Tam gün girin").min(0, "Gün negatif olamaz").max(30, "En fazla 30 gün önce"),
  invoiceTermDays: z.number().int("Tam gün girin").min(0, "Gün negatif olamaz").max(120, "Vade en fazla 120 gün"),
});

export async function saveNotificationSettings(input: z.input<typeof notifySchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const value: NotifySettings = notifySchema.parse(input);
    await saveNotifySettings(value);
    await logActivity(me, "Bildirim ayarları", value.emailEnabled ? `açık · ${value.from ?? "varsayılan gönderen"}` : "kapalı");
    refresh();
    return null;
  });
}

export async function sendTestNotification() {
  return attempt(async () => {
    await requireAdmin();
    const r = await sendTestEmail();
    if (!r.ok) throw new UserError(r.error);
    return { recipients: r.recipients, skipped: r.skipped };
  });
}

/**
 * E-posta önizlemesi: bugün gidecek sabah e-postasının HTML'i (gönderilmez, günlüğe yazılmaz). Gerçek gönderim gibi
 * Paraşüt bölümü (yeni faturalar, kontrol bekleyenler, eşitleme hatası), yeni zamlar, ek kutular (yükleyicileri
 * önizlemede yazmaz) ve (canlıda) günlük işlerin sorunları da girer; ödeme, yeni fatura, zam, sistem uyarısı ya da
 * haber olan ek kutu yoksa örnek bir ödeme satırıyla gösterilir.
 */
export async function previewDigest() {
  return attempt(async () => {
    await requireAdmin();
    // Gerçek gönderim gibi seçiciden bağımsız, "Tümü"yle okur (runReminderDigest): Marina seçiliyken önizlemenin zam
    // tutarı ve ek kutuları Marina'nınki oluyordu (denetim 21 Kasım #18)
    return withBranchScope(ALL_BRANCHES, digestPreview);
  });
}

async function digestPreview() {
  const { today, items } = await loadUpcoming();
  const due = dueNotifications(items);
  // Yükleyiciler yalnız okur; failedRunKey gönderimden sonra günlüğe yazmak içindir, burada kullanılmaz
  const [sent, { invoices }, prices, system, extras] = await Promise.all([
    due.length
      ? getDb()
          .select({ key: s.notificationLog.key })
          .from(s.notificationLog)
          .where(inArray(s.notificationLog.key, due.map((d) => d.key)))
      : [],
    loadDigestInvoices(),
    loadDigestPrices().catch(() => null),
    isProductionRuntime() ? loadEmailProblems("digest").catch(() => []) : [],
    loadDigestExtras(today, { preview: true }),
  ]);
  const invoiceNews = invoiceNewsOf(invoices);
  const example: UpcomingItem = {
    ref: "preview:0",
    source: "reminder",
    sourceId: 0,
    kind: "kira",
    title: "Örnek: Kira",
    detail: "Bugün haber verilecek ödeme, yeni fatura ya da zam yok; e-posta böyle görünür",
    amount: 25000,
    dueDate: today,
    daysLeft: 0,
    status: "today",
    remindDaysBefore: 3,
    repeat: "monthly",
  };
  // Gerçek gönderim de yalnız bunlardan biri varsa gider; hiçbiri yoksa örnek satırla gösterilir
  const sample = !due.length && !invoiceNews && !prices && !system.length && !extras.news;
  const rows = sample ? [{ item: example, stage: "due" as const }] : due;
  const { subject, html } = renderDigest(
    rows,
    today,
    invoiceNews || invoices.reviewCount || invoices.priceHolds ? invoices : null,
    prices,
    system.length ? { items: system } : null,
    extras.extras,
  );
  return {
    subject,
    html,
    count: due.length,
    alreadySent: sent.length,
    invoices: invoices.items.length,
    prices: prices?.changes.length ?? 0,
    syncError: Boolean(invoices.syncError),
    system: system.length,
    holds: invoices.priceHolds?.fresh ?? 0,
    boxes: extras.parts,
    sample,
  };
}

/** Bugünün hatırlatma e-postasını şimdi gönder (otomatik gönderimi beklemeden) */
export async function runDigestNow() {
  return attempt(async () => {
    await requireAdmin();
    const r = await runReminderDigest("manual");
    if (r.status === "error") throw new UserError(r.error);
    refresh();
    return r;
  });
}
