import {
  dayMonthTR,
  isMuhtasarReminder,
  isProvisionalTaxReminder,
  isVatReminder,
  isVatWithholdingReminder,
  reminderCategory,
  type ReminderRow,
} from "@/lib/reminders";

import { isKvReminder, type TaxCalendarRow } from "./view";

/*
 * Vergi Özet'in "günü geçmiş vergi ödemesi" satırı (docs/planlar/ux-sade.md §7.2, K12): Ödemeler'deki vergi ve SGK
 * hatırlatıcılarından günü geçmiş ve hâlâ açık olanlar. Ödemeler'in "Gecikti" grubuyla aynı kayıtlar (etkin, günü
 * bugünden önce); yeni sorgu yok, `loadTaxView`'un okuduğu hatırlatıcılar. Kırmızı ve "Ödedim" düğmesi Ödemeler'de
 * kalır: Ödemeler'deki gün çoğu zaman yasal günden erkendir (SGK 26 ↔ ayın sonu). Saf; `src/lib/calc` değil.
 */

type TaxReminderKind = TaxCalendarRow["kind"] | "vergi";

/** Hatırlatıcının vergi sınıfı (takvim satırının türü); vergi ya da SGK değilse null */
export function taxReminderKind(r: Pick<ReminderRow, "kind" | "title">): TaxReminderKind | null {
  if (reminderCategory(r.kind, r.title) === "sgk") return "sgk";
  if (isVatReminder(r)) return "kdv1";
  if (isVatWithholdingReminder(r)) return "kdv2";
  if (isMuhtasarReminder(r)) return "mphb";
  if (isProvisionalTaxReminder(r)) return "gecici";
  if (isKvReminder(r)) return "kv";
  return r.kind === "vergi" ? "vergi" : null;
}

/** Günü geçmiş (bugünden önce), etkin vergi ve SGK hatırlatıcıları, güne göre */
export function overdueTaxReminders<R extends ReminderRow>(reminders: readonly R[], today: string): R[] {
  return reminders
    .filter((r) => r.active && r.dueDate < today && taxReminderKind(r) !== null)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id - b.id);
}

export interface OverdueTaxNotice {
  count: number;
  /** "Ödemeler'de günü geçmiş 2 vergi ödemesi" ya da tek ödemede "…: SGK prim ödemesi" */
  title: string;
  /** "SGK prim ödemesi 26 Ekim, KDV ödemesi 28 Ekim" (en çok 3, fazlası "+k") */
  text: string;
  /** Yasal son günü gelmemişler: "SGK prim ödemesi: Ödemeler'deki gün 26 Ekim, yasal son gün 2 Kasım." */
  details: string[];
}

/**
 * Satırın metinleri. Yasal gün takvimdeki aynı dönemin satırından (satırın `reminderDue`'su hatırlatıcının günü,
 * türü hatırlatıcının sınıfı); satır yoksa (yasal gün de geçti ya da tür takvimde Ödemeler gününü taşımıyor) cümle yok
 */
export function overdueTaxNotice(
  reminders: readonly ReminderRow[],
  today: string,
  calendar: readonly Pick<TaxCalendarRow, "kind" | "due" | "reminderDue">[],
): OverdueTaxNotice | null {
  const list = overdueTaxReminders(reminders, today);
  if (!list.length) return null;
  const shown = list.slice(0, 3).map((r) => `${r.title} ${dayMonthTR(r.dueDate)}`);
  const more = list.length - shown.length;
  const details: string[] = [];
  for (const r of list) {
    const kind = taxReminderKind(r);
    const row = calendar.find((c) => c.kind === kind && c.reminderDue === r.dueDate);
    if (row && row.due > today) details.push(`${r.title}: Ödemeler'deki gün ${dayMonthTR(r.dueDate)}, yasal son gün ${dayMonthTR(row.due)}.`);
  }
  return {
    count: list.length,
    title: list.length === 1 ? `Ödemeler'de günü geçmiş vergi ödemesi: ${list[0].title}` : `Ödemeler'de günü geçmiş ${list.length} vergi ödemesi`,
    text: `${shown.join(", ")}${more > 0 ? ` +${more}` : ""}`,
    details,
  };
}
