/**
 * Hatırlatıcı ve yaklaşan ödeme hesapları (saf fonksiyonlar; tests/reminders.test.ts).
 * Tarihler "YYYY-MM-DD" metni, gün farkları Türkiye saatine göre takvim günü.
 */

export type ReminderKind = "odeme" | "vergi" | "kira" | "maas" | "fatura" | "diger";
export type ReminderRepeat = "none" | "weekly" | "monthly" | "quarterly" | "yearly";

export const REMINDER_KINDS: { value: ReminderKind; label: string }[] = [
  { value: "odeme", label: "Ödeme" },
  { value: "vergi", label: "Vergi / SGK" },
  { value: "kira", label: "Kira" },
  { value: "maas", label: "Maaş" },
  { value: "fatura", label: "Fatura" },
  { value: "diger", label: "Diğer" },
];

export const REMINDER_REPEATS: { value: ReminderRepeat; label: string }[] = [
  { value: "none", label: "Bir kez" },
  { value: "weekly", label: "Her hafta" },
  { value: "monthly", label: "Her ay" },
  { value: "quarterly", label: "Üç ayda bir" },
  { value: "yearly", label: "Her yıl" },
];

export interface ReminderRow {
  id: number;
  title: string;
  kind: ReminderKind;
  amount: number | null;
  dueDate: string;
  anchorDate: string;
  repeat: ReminderRepeat;
  remindDaysBefore: number;
  note: string | null;
  active: boolean;
}

export interface UnpaidInvoiceRow {
  id: number;
  supplier: string;
  invoiceNo: string | null;
  date: string;
  dueDate: string | null;
  payable: number;
  /** Kalan borç; kısmen ödenmişse payable yerine bu gösterilir */
  outstanding?: number | null;
}

export type UpcomingStatus = "overdue" | "today" | "soon" | "later";

export interface UpcomingItem {
  /** "reminder:4", tekrarın öngörülen dönemi için "reminder:4@2026-11-28", fatura için "invoice:12" */
  ref: string;
  /** Tekrar eden hatırlatıcının geciken döneminden sonraki, henüz kaydedilmemiş dönem */
  projected?: boolean;
  source: "reminder" | "invoice";
  sourceId: number;
  kind: ReminderKind;
  title: string;
  detail: string | null;
  amount: number | null;
  dueDate: string;
  daysLeft: number;
  status: UpcomingStatus;
  remindDaysBefore: number;
  repeat: ReminderRepeat;
}

/** Türkiye'de bugünün tarihi (Vercel UTC'de çalışır) */
export function todayTR(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const toUTC = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
};
const fromUTC = (t: number) => new Date(t).toISOString().slice(0, 10);

export function daysBetween(from: string, to: string): number {
  return Math.round((toUTC(to) - toUTC(from)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  return fromUTC(toUTC(date) + days * 86_400_000);
}

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Ay ekler; gün, çapa gününe göre ayın son gününe kırpılır (31 Ocak → 28 Şubat → 31 Mart) */
export function addMonthsAnchored(date: string, months: number, anchorDay: number): string {
  const [y, m] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const day = Math.min(anchorDay, lastDay(ny, nm));
  return `${ny}-${String(nm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Tekrar eden hatırlatıcının bir sonraki tarihi */
export function nextOccurrence(dueDate: string, repeat: ReminderRepeat, anchorDate: string): string | null {
  const anchorDay = Number(anchorDate.slice(8, 10)) || Number(dueDate.slice(8, 10));
  switch (repeat) {
    case "none":
      return null;
    case "weekly":
      return addDays(dueDate, 7);
    case "monthly":
      return addMonthsAnchored(dueDate, 1, anchorDay);
    case "quarterly":
      return addMonthsAnchored(dueDate, 3, anchorDay);
    case "yearly":
      return addMonthsAnchored(dueDate, 12, anchorDay);
  }
}

export function statusFor(daysLeft: number, remindDaysBefore: number): UpcomingStatus {
  if (daysLeft < 0) return "overdue";
  if (daysLeft === 0) return "today";
  if (daysLeft <= Math.max(remindDaysBefore, 7)) return "soon";
  return "later";
}

/**
 * Yaklaşan ve gecikmiş ödemeler: etkin hatırlatıcılar + vadesi olan ödenmemiş faturalar.
 * Vadesiz ödenmemiş faturalar fatura tarihinden `invoiceTermDays` sonra vadeli sayılır.
 */
export function upcomingItems(
  reminders: ReminderRow[],
  invoices: UnpaidInvoiceRow[],
  today: string,
  { horizonDays = 45, invoiceDaysBefore = 3, invoiceTermDays = 30 }: { horizonDays?: number; invoiceDaysBefore?: number; invoiceTermDays?: number } = {},
): UpcomingItem[] {
  const out: UpcomingItem[] = [];
  for (const r of reminders) {
    if (!r.active) continue;
    const horizon = Math.max(horizonDays, r.remindDaysBefore);
    const daysLeft = daysBetween(today, r.dueDate);
    if (daysLeft > horizon) continue;
    const base = {
      source: "reminder" as const,
      sourceId: r.id,
      kind: r.kind,
      title: r.title,
      detail: r.note,
      amount: r.amount,
      remindDaysBefore: r.remindDaysBefore,
      repeat: r.repeat,
    };
    out.push({ ...base, ref: `reminder:${r.id}`, dueDate: r.dueDate, daysLeft, status: statusFor(daysLeft, r.remindDaysBefore) });
    // Geciken bir dönem "ödendi" işaretlenmediyse sonraki dönem de görünsün ve hatırlatılsın
    if (daysLeft < 0 && r.repeat !== "none") {
      let next = nextOccurrence(r.dueDate, r.repeat, r.anchorDate);
      for (let guard = 0; next && next < today && guard < 120; guard++) next = nextOccurrence(next, r.repeat, r.anchorDate);
      if (next) {
        const left = daysBetween(today, next);
        if (left <= horizon) {
          out.push({ ...base, ref: `reminder:${r.id}@${next}`, projected: true, dueDate: next, daysLeft: left, status: statusFor(left, r.remindDaysBefore) });
        }
      }
    }
  }
  for (const inv of invoices) {
    const due = inv.dueDate ?? addDays(inv.date, invoiceTermDays);
    const daysLeft = daysBetween(today, due);
    if (daysLeft > horizonDays) continue;
    out.push({
      ref: `invoice:${inv.id}`,
      source: "invoice",
      sourceId: inv.id,
      kind: "fatura",
      title: inv.supplier,
      detail: [inv.invoiceNo ? `Fatura ${inv.invoiceNo}` : "Ödenmemiş fatura", inv.dueDate ? null : `vade tahmini (${invoiceTermDays} gün)`].filter(Boolean).join(" · "),
      amount: inv.outstanding !== null && inv.outstanding !== undefined && inv.outstanding > 0 ? inv.outstanding : inv.payable,
      dueDate: due,
      daysLeft,
      status: statusFor(daysLeft, invoiceDaysBefore),
      remindDaysBefore: invoiceDaysBefore,
      repeat: "none",
    });
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title, "tr"));
}

export type NotifyStage = "before" | "due" | "overdue";

/**
 * Bugün e-postayla haber verilmesi gerekenler. Her aşama (önceden / gününde / gecikti) bir kez gider;
 * `key` bildirim günlüğünde tekil anahtardır. Gecikmiş olanlar ilk 14 gün içinde bir kez hatırlatılır.
 */
export function dueNotifications(items: UpcomingItem[]): { item: UpcomingItem; stage: NotifyStage; key: string }[] {
  const out: { item: UpcomingItem; stage: NotifyStage; key: string }[] = [];
  for (const item of items) {
    let stage: NotifyStage | null = null;
    if (item.daysLeft < 0 && item.daysLeft >= -14) stage = "overdue";
    else if (item.daysLeft === 0) stage = "due";
    else if (item.daysLeft > 0 && item.daysLeft <= item.remindDaysBefore) stage = "before";
    if (stage) out.push({ item, stage, key: `${item.ref}:${item.dueDate}:${stage}` });
  }
  return out;
}

export function daysLeftLabel(daysLeft: number): string {
  if (daysLeft === 0) return "Bugün";
  if (daysLeft === 1) return "Yarın";
  if (daysLeft > 1) return `${daysLeft} gün kaldı`;
  if (daysLeft === -1) return "Dün geçti";
  return `${-daysLeft} gün gecikti`;
}

/**
 * Hazır şablonlar. Vergi tarihleri genel takvimdir (takip eden ayın günü); işletmenize göre
 * muhasebecinizle kontrol edin. dueDay ayın günü, "son" ayın son günü.
 */
export const REMINDER_PRESETS: {
  key: string;
  title: string;
  kind: ReminderKind;
  repeat: ReminderRepeat;
  dueDay: number | "son";
  remindDaysBefore: number;
  note: string;
  /** Üç aylıklar için ilk ay (1–12) */
  months?: number[];
}[] = [
  { key: "kdv", title: "KDV beyannamesi ve ödemesi", kind: "vergi", repeat: "monthly", dueDay: 28, remindDaysBefore: 5, note: "Önceki ayın KDV'si; takip eden ayın 28'i." },
  { key: "muhtasar", title: "Muhtasar ve prim hizmet beyannamesi", kind: "vergi", repeat: "monthly", dueDay: 26, remindDaysBefore: 5, note: "Önceki ayın stopaj ve SGK bildirimi; takip eden ayın 26'sı." },
  { key: "sgk", title: "SGK prim ödemesi", kind: "vergi", repeat: "monthly", dueDay: "son", remindDaysBefore: 5, note: "Önceki ayın primleri; takip eden ayın son günü." },
  { key: "gecici", title: "Geçici vergi beyanı ve ödemesi", kind: "vergi", repeat: "quarterly", dueDay: 17, months: [2, 5, 8, 11], remindDaysBefore: 7, note: "Çeyrek bitiminden sonraki ikinci ayın 17'si." },
  { key: "maas", title: "Maaş ödemesi", kind: "maas", repeat: "monthly", dueDay: 1, remindDaysBefore: 2, note: "Personel maaşları." },
];

/** Tekrar eden hatırlatıcıyı, tarihi verilen günü geçene kadar ilerletir (ödendi / yeniden etkinleştirme) */
export function advancePast(dueDate: string, repeat: ReminderRepeat, anchorDate: string, through: string): string | null {
  let next = nextOccurrence(dueDate, repeat, anchorDate);
  for (let guard = 0; next && next <= through && guard < 600; guard++) next = nextOccurrence(next, repeat, anchorDate);
  return next;
}

/** Şablonun çapa tarihi: "son gün" şablonlarında gün 31 yazılır, her ay son güne kırpılır */
export function presetAnchor(preset: (typeof REMINDER_PRESETS)[number], firstDate: string): string {
  return preset.dueDay === "son" ? `${firstDate.slice(0, 8)}31` : firstDate;
}

/** Şablonun bugünden sonraki ilk tarihi */
export function presetFirstDate(preset: (typeof REMINDER_PRESETS)[number], today: string): string {
  const [y, m] = today.split("-").map(Number);
  for (let i = 0; i < 15; i++) {
    const total = y * 12 + (m - 1) + i;
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    if (preset.months && !preset.months.includes(nm)) continue;
    const day = preset.dueDay === "son" ? lastDay(ny, nm) : Math.min(preset.dueDay, lastDay(ny, nm));
    const date = `${ny}-${String(nm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (date >= today) return date;
  }
  return today;
}
