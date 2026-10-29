import "server-only";

import { and, eq, like } from "drizzle-orm";

import { foldName } from "@/lib/cash-plan";
import { monthLabel, tl } from "@/lib/format";
import { FIXED_REMINDER_NOTE, fixedReminderFollow } from "@/lib/reminders";
import { paidFixedRates } from "@/lib/tax/rules";
import { schema as s, type DB } from "@/server/db";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

// Sabit gideri izleyen hatırlatıcılar (denetim E-46): Giderler'de tutar, dönem, KDV ya da stopaj değişince (costs.ts
// saveFixedExpense, Vergi › sınıflandırma tax.ts saveTaxClassifications) aynı kuralla güncellenir.

/**
 * Sabit gider değişince "Sabit giderlerden ekle" ile açılmış (notu FIXED_REMINDER_NOTE), adı eski ya da yeni adla aynı
 * etkin hatırlatıcılar (denetim E-46): otomatik tutarı sıradaki ödeme ayının yeni sürümüne uyar (sonraki bir aydan
 * değişiyorsa bu ayınki kalır; hatırlatıcı gideri izler, nakit planı zamdan sonra yeni tutarı öder, mesaj söyler; dönemi
 * değişirse boşalır); elle başka tutar yazılmışsa dokunulmaz, sonuç mesajında uyarılır. Kaydın işleminde
 */
export async function followFixedReminders(
  tx: Tx,
  before: typeof s.fixedExpenses.$inferSelect,
  beforeVersions: (typeof s.fixedExpenseVersions.$inferSelect)[],
  after: typeof s.fixedExpenses.$inferSelect,
): Promise<FollowResult> {
  const out: FollowResult = { updated: [], manual: [], later: [] };
  const names = new Set([foldName(before.name), foldName(after.name)]);
  const rems = (
    await tx
      .select({ id: s.reminders.id, title: s.reminders.title, amount: s.reminders.amount, dueDate: s.reminders.dueDate, repeat: s.reminders.repeat, note: s.reminders.note })
      .from(s.reminders)
      .where(and(eq(s.reminders.active, true), like(s.reminders.note, `${FIXED_REMINDER_NOTE}%`)))
  ).filter((r) => names.has(foldName(r.title)));
  if (!rems.length) return out;
  const afterVersions = await tx.select().from(s.fixedExpenseVersions).where(eq(s.fixedExpenseVersions.fixedExpenseId, before.id));
  for (const r of rems) {
    // Stopajlı kalemde hatırlatıcının tutarı bankadan çıkan nettir (stopaj muhtasarda); yurt dışı hizmette KDV yok
    // (KDV-2'de; docs/VERGI.md)
    const year = Number(r.dueDate.slice(0, 4));
    const rated = (x: typeof before) => paidFixedRates(x, year);
    const f = fixedReminderFollow(r, rated(before), beforeVersions, rated(after), afterVersions);
    if (f.kind === "update") {
      await tx.update(s.reminders).set({ amount: f.amount }).where(eq(s.reminders.id, r.id));
      out.updated.push({ title: r.title, from: r.amount!, to: f.amount });
    } else if (f.kind === "manual") out.manual.push({ title: r.title, amount: r.amount!, expected: f.expected });
    if (f.kind !== "manual" && f.later) out.later.push({ title: r.title, ...f.later });
  }
  return out;
}

export interface FollowResult {
  updated: { title: string; from: number; to: number | null }[];
  manual: { title: string; amount: number; expected: number }[];
  /** Gideri izleyen hatırlatıcı: sonraki bir aydan değişen tutar (hatırlatıcı o aydan yeni tutarla sayılır) */
  later: { title: string; month: string; amount: number }[];
}

/** Sonuç mesajının hatırlatıcı cümlesi: "Ödemeler'deki “Kira” hatırlatıcısı 192.000 ₺ → 240.000 ₺." */
export function fixedReminderMessage(r: FollowResult): string | null {
  const parts = [
    ...r.updated.map((u) =>
      u.to === null
        ? `Ödemeler'deki “${u.title}” hatırlatıcısının tutarı kaldırıldı (önce ${tl(u.from)}): dönemi değiştiği için nakit planı Giderler'deki tutarı her ay izler.`
        : `Ödemeler'deki “${u.title}” hatırlatıcısı da güncellendi: ${tl(u.from)} → ${tl(u.to)} (KDV dahil).`,
    ),
    ...r.later.map((l) => `Ödemeler'deki “${l.title}” hatırlatıcısı ${monthLabel(l.month)} itibarıyla ${tl(l.amount)} (KDV dahil) sayılır; nakit planı da öyle öder.`),
    ...r.manual.map((m) => `Ödemeler'deki “${m.title}” hatırlatıcısında ${tl(m.amount)} yazılı, sabit giderde ${tl(m.expected)} (KDV dahil): kontrol edin.`),
  ];
  return parts.length ? parts.join(" ") : null;
}
