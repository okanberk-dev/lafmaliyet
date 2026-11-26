"use server";

import { and, eq, isNull } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { businessDate } from "@/lib/cash-report";
import { closeRefusal, monthTitle, periodStateOf } from "@/lib/closed-period";
import { dateTR } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { loadClosedPeriods, periodCheckOf, saveClosedPeriods } from "@/server/closed-period";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";
import { attempt, UserError, zMonth } from "./util";

// Dönem kapanışı (docs/DONEM-KAPANISI.md): ayı kapatma, yeniden açma ve kapalı döneme düşen kaydın kararı. Yalnız
// yönetici. Kurallar src/lib/closed-period.ts, okumalar src/server/closed-period.ts.

/** Ayı kapatır: o anki fatura ve harcama sağlaması saklanır; ay sonradan değişirse Ayarlar söyler */
export async function closePeriod(month: string) {
  return attempt(async () => {
    const me = await requireAdmin();
    const m = zMonth.parse(month);
    const db = getDb();
    const done = await db.transaction(async (tx) => {
      const p = await loadClosedPeriods(tx);
      const refusal = closeRefusal(m, businessDate(), p);
      if (refusal) throw new UserError(refusal);
      const check = await periodCheckOf(tx, m, p);
      await saveClosedPeriods(tx, { months: { ...p.months, [m]: { at: new Date().toISOString(), by: me.name, check } } });
      return check;
    });
    await logActivity(me, "Dönem kapatıldı", `${monthTitle(m)}: ${done.invoices} fatura, ${done.expenses} harcama`);
    refresh();
    return done;
  });
}

/**
 * Ayı yeniden açar: bekleyen kayıtlar kendiliğinden o aya girer, verilen kararlar yerinde kalır. Gerekçe işlem
 * geçmişine yazılır (beyan edilmiş ayı açmak bilinçli olsun)
 */
export async function reopenPeriod(month: string, reason: string) {
  return attempt(async () => {
    const me = await requireAdmin();
    const m = zMonth.parse(month);
    const why = z.string().trim().min(3, "Neden açtığınızı kısaca yazın").max(300, "Gerekçe çok uzun").parse(reason);
    const db = getDb();
    await db.transaction(async (tx) => {
      const p = await loadClosedPeriods(tx);
      if (!p.months[m]) throw new UserError(`${monthTitle(m)} zaten açık; sayfayı yenileyin`);
      const months = { ...p.months };
      delete months[m];
      await saveClosedPeriods(tx, { months });
    });
    await logActivity(me, "Dönem yeniden açıldı", `${monthTitle(m)} · gerekçe: ${why}`);
    refresh();
    return null;
  });
}

const decisionInput = z.object({
  kind: z.enum(["invoice", "expense"]),
  id: z.number().int().positive(),
  /** move: bugünün ayında sayılır (belgenin tarihi değişmez); accept: kapalı aya bilerek işlenir */
  decision: z.enum(["move", "accept"]),
});

/**
 * Kapalı döneme düşen kaydın kararı. "Bu aya al": kayıt bugünün (iş günü) ayında sayılır. "Kapalı aya işle": kapalı
 * ayın rakamı bilerek değişir; kapanış sağlaması da yenilenir (bilerek yapılan değişiklik "kapanıştan sonra değişti"
 * uyarısı vermesin). Karar yalnız hâlâ bekleyen kayda yazılır (iki sekmeden iki karar çakışmaz)
 */
export async function decideHeldRecord(input: z.input<typeof decisionInput>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const d = decisionInput.parse(input);
    const db = getDb();
    const today = businessDate();
    const out = await db.transaction(async (tx) => {
      const p = await loadClosedPeriods(tx);
      const [row] =
        d.kind === "invoice"
          ? await tx
              .select({ date: s.invoices.date, createdAt: s.invoices.createdAt, periodDate: s.invoices.periodDate, label: s.invoices.supplier, amount: s.invoices.payable })
              .from(s.invoices)
              .where(eq(s.invoices.id, d.id))
              .for("update")
          : await tx
              .select({ date: s.expenseEntries.date, createdAt: s.expenseEntries.createdAt, periodDate: s.expenseEntries.periodDate, label: s.expenseEntries.description, amount: s.expenseEntries.amount })
              .from(s.expenseEntries)
              .where(eq(s.expenseEntries.id, d.id))
              .for("update");
      if (!row) throw new UserError("Kayıt bulunamadı; silinmiş olabilir. Sayfayı yenileyin.");
      const st = periodStateOf(row, p);
      if (st.kind !== "held") throw new UserError("Bu kayıt artık beklemiyor (karar verilmiş ya da dönem açılmış); sayfayı yenileyin");
      const periodDate = d.decision === "move" ? today : row.date;
      if (d.kind === "invoice") await tx.update(s.invoices).set({ periodDate }).where(and(eq(s.invoices.id, d.id), isNull(s.invoices.periodDate)));
      else await tx.update(s.expenseEntries).set({ periodDate }).where(and(eq(s.expenseEntries.id, d.id), isNull(s.expenseEntries.periodDate)));
      if (d.decision === "accept") {
        const closed = p.months[st.month];
        if (closed) {
          const check = await periodCheckOf(tx, st.month, p);
          await saveClosedPeriods(tx, { months: { ...p.months, [st.month]: { ...closed, check } } });
        }
      }
      return { month: st.month, label: row.label ?? "", amount: row.amount, date: row.date, periodDate };
    });
    const what = `${d.kind === "invoice" ? "Fatura" : "Harcama"} ${dateTR(out.date)} ${out.label}`.trim();
    await logActivity(
      me,
      d.decision === "move" ? "Kapalı döneme düşen kayıt bu aya alındı" : "Kapalı döneme düşen kayıt kapalı aya işlendi",
      d.decision === "move" ? `${what} → ${dateTR(out.periodDate)} tarihinde sayılır (${monthTitle(out.month)} kapalı)` : `${what} → ${monthTitle(out.month)} rakamı değişti`,
    );
    refresh();
    return { periodDate: out.periodDate };
  });
}
