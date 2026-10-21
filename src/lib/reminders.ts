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
  /** Tedarikçinin cari kartındaki vade (gün): vadesiz faturada genel ayarın yerine geçer */
  termDays?: number | null;
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
 * Vadesiz ödenmemiş faturalar fatura tarihinden tedarikçinin vade günü (`termDays`), yoksa `invoiceTermDays` sonra
 * vadeli sayılır.
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
    const item = invoiceItem(inv, today, invoiceDaysBefore, invoiceTermDays);
    if (item.daysLeft <= horizonDays) out.push(item);
  }
  return out.sort(byDueThenTitle);
}

const byDueThenTitle = (a: UpcomingItem, b: UpcomingItem) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title, "tr");

/**
 * Ödenmemiş faturanın ödeme satırı; vadesizse fatura tarihinden sonraki tahmini vade: tedarikçinin kartındaki vade
 * günü (`termDays`), yoksa `invoiceTermDays`
 */
function invoiceItem(inv: UnpaidInvoiceRow, today: string, invoiceDaysBefore: number, invoiceTermDays: number): UpcomingItem {
  const term = inv.termDays ?? invoiceTermDays;
  const due = inv.dueDate ?? addDays(inv.date, term);
  const daysLeft = daysBetween(today, due);
  return {
    ref: `invoice:${inv.id}`,
    source: "invoice",
    sourceId: inv.id,
    kind: "fatura",
    title: inv.supplier,
    detail: [inv.invoiceNo ? `Fatura ${inv.invoiceNo}` : "Ödenmemiş fatura", inv.dueDate ? null : `vade tahmini (${term} gün)`].filter(Boolean).join(" · "),
    amount: inv.outstanding !== null && inv.outstanding !== undefined && inv.outstanding > 0 ? inv.outstanding : inv.payable,
    dueDate: due,
    daysLeft,
    status: statusFor(daysLeft, invoiceDaysBefore),
    remindDaysBefore: invoiceDaysBefore,
    repeat: "none",
  };
}

/**
 * Vadesi listenin ufkundan (45 gün) sonra olan ödenmemiş faturalar: takvimde kendi ayında görünsün ("daha ilerisi
 * takvimde"). upcomingItems'in dışarıda bıraktıklarıdır.
 */
export function laterInvoiceItems(
  invoices: UnpaidInvoiceRow[],
  today: string,
  { horizonDays = 45, invoiceDaysBefore = 3, invoiceTermDays = 30 }: { horizonDays?: number; invoiceDaysBefore?: number; invoiceTermDays?: number } = {},
): UpcomingItem[] {
  return invoices
    .map((inv) => invoiceItem(inv, today, invoiceDaysBefore, invoiceTermDays))
    .filter((i) => i.daysLeft > horizonDays)
    .sort(byDueThenTitle);
}

export type NotifyStage = "before" | "due" | "overdue";

/**
 * Bugün e-postayla haber verilmesi gerekenler. Her aşama (önceden / gününde / gecikti) bir kez gider;
 * `key` bildirim günlüğünde tekil anahtardır (`kaynak:kimlik:vade:aşama`). Gecikmiş olanlar ilk 14 gün içinde bir
 * kez hatırlatılır. Anahtar ref'ten değil kaynak + kimlikten kurulur: geciken dönemin yanındaki öngörülen dönem
 * (`reminder:4@2026-11-01`), geciken ödenince gerçek kayda (`reminder:4`) döner ve aynı e-posta ikinci kez gitmez.
 */
export function dueNotifications(items: UpcomingItem[]): { item: UpcomingItem; stage: NotifyStage; key: string }[] {
  const out: { item: UpcomingItem; stage: NotifyStage; key: string }[] = [];
  for (const item of items) {
    let stage: NotifyStage | null = null;
    if (item.daysLeft < 0 && item.daysLeft >= -14) stage = "overdue";
    else if (item.daysLeft === 0) stage = "due";
    else if (item.daysLeft > 0 && item.daysLeft <= item.remindDaysBefore) stage = "before";
    if (stage) out.push({ item, stage, key: `${item.source}:${item.sourceId}:${item.dueDate}:${stage}` });
  }
  return out;
}

/**
 * Sabah e-postasında ne olduğu, tek satır ("2 hatırlatma · 4 yeni fatura · 1 zam"): "şimdi gönder" bildirimi ve
 * önizleme açıklaması. Hiçbir bölüm yoksa boş döner.
 */
export function digestSummary({ count = 0, invoices = 0, prices = 0, syncError = false }: { count?: number; invoices?: number; prices?: number; syncError?: boolean }): string {
  return [count ? `${count} hatırlatma` : "", invoices ? `${invoices} yeni fatura` : "", prices ? `${prices} zam` : "", syncError ? "Paraşüt eşitleme hatası" : ""].filter(Boolean).join(" · ");
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
  { key: "kira", title: "Kira", kind: "kira", repeat: "monthly", dueDay: 1, remindDaysBefore: 3, note: "Dükkân kirası." },
  { key: "abonelik", title: "Abonelik", kind: "fatura", repeat: "monthly", dueDay: 15, remindDaysBefore: 2, note: "İnternet, POS, yazılım, müzik gibi aylık abonelik." },
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

// ---------------------------------------------------------------- Görünüm yardımcıları (ekran ve e-posta)

const MONTHS_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const WEEKDAYS_TR = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

/** Türkçe karakterleri ASCII'ye indirip küçültür (başlıktan tür tahmini için) */
function foldTR(s: string): string {
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u");
}

/** Ekrandaki ikon ve renk: veritabanındaki türe ek olarak SGK ve abonelik başlıktan ayrılır */
export type ReminderCategory = "kira" | "vergi" | "sgk" | "maas" | "abonelik" | "fatura" | "odeme" | "diger";

export const CATEGORY_LABEL: Record<ReminderCategory, string> = {
  kira: "Kira",
  vergi: "Vergi",
  sgk: "SGK",
  maas: "Maaş",
  abonelik: "Abonelik",
  fatura: "Fatura",
  odeme: "Ödeme",
  diger: "Diğer",
};

export function reminderCategory(kind: ReminderKind, title: string): ReminderCategory {
  const t = foldTR(title);
  if (kind === "kira") return "kira";
  if (kind === "maas") return "maas";
  if (/(sgk|ssk|bagkur)/.test(t) && !/muhtasar/.test(t)) return "sgk";
  if (kind === "vergi") return "vergi";
  if (/(abonelik|uyelik|netflix|spotify|youtube|internet|yazilim|lisans|bulut|icloud|adobe)/.test(t)) return "abonelik";
  if (kind === "fatura" || /(fatura|elektrik|dogalgaz|telefon|gsm)|(^|\s)su(\s|$)/.test(t)) return "fatura";
  if (/(kira|aidat)/.test(t)) return "kira";
  if (/(maas|bordro|avans)/.test(t)) return "maas";
  if (/(kdv|vergi|muhtasar|stopaj|beyan|damga)/.test(t)) return "vergi";
  return kind === "diger" ? "diger" : "odeme";
}

/** Zaman çizelgesi grupları: geciken, bugün, bu hafta (pazara kadar), bu ay, daha sonra */
export type TimelineGroup = "overdue" | "today" | "week" | "month" | "later";

export const TIMELINE_GROUPS: { key: TimelineGroup; label: string }[] = [
  { key: "overdue", label: "Gecikti" },
  { key: "today", label: "Bugün" },
  { key: "week", label: "Bu hafta" },
  { key: "month", label: "Bu ay" },
  { key: "later", label: "Daha sonra" },
];

/** Haftanın pazar günü (Türkiye'de hafta pazartesi başlar) */
export function weekEnd(today: string): string {
  const dow = new Date(toUTC(today)).getUTCDay();
  return addDays(today, (7 - dow) % 7);
}

/** Ayın son günü */
export function monthEnd(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `${date.slice(0, 8)}${String(lastDay(y, m)).padStart(2, "0")}`;
}

export function isLastDayOfMonth(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && monthEnd(date) === date;
}

/** "Her ayın son günü" çapası: gün 31 yazılır, her ay son güne kırpılır (presetAnchor ile aynı) */
export function endOfMonthAnchor(date: string): string {
  return `${date.slice(0, 8)}31`;
}

export function timelineGroup(dueDate: string, today: string): TimelineGroup {
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  if (dueDate <= weekEnd(today)) return "week";
  if (dueDate <= monthEnd(today)) return "month";
  return "later";
}

/** Ödemeler listesinin ufku: gecikenler ve önümüzdeki 45 gün (son karo da bu kadar: "45 gün içinde") */
export const UPCOMING_HORIZON_DAYS = 45;

/** Üstteki özet karoları (dokununca liste süzülür) */
export type SummaryRange = "gecikmis" | "hafta" | "ay" | "45gun";
export const SUMMARY_RANGES = ["gecikmis", "hafta", "ay", "45gun"] as const;

/** Adresteki aralık (?aralik=…); eski "30gun" bağlantıları "45gun" sayılır */
export function parseSummaryRange(raw: string): SummaryRange | null {
  if (raw === "30gun") return "45gun";
  return (SUMMARY_RANGES as readonly string[]).includes(raw) ? (raw as SummaryRange) : null;
}

export function inSummaryRange(dueDate: string, range: SummaryRange, today: string): boolean {
  if (range === "gecikmis") return dueDate < today;
  if (dueDate < today) return false;
  if (range === "hafta") return dueDate <= weekEnd(today);
  if (range === "ay") return dueDate <= monthEnd(today);
  return dueDate <= addDays(today, UPCOMING_HORIZON_DAYS);
}

export function summarize(items: Pick<UpcomingItem, "dueDate" | "amount">[], today: string): Record<SummaryRange, { count: number; total: number }> {
  const out = Object.fromEntries(SUMMARY_RANGES.map((r) => [r, { count: 0, total: 0 }])) as Record<SummaryRange, { count: number; total: number }>;
  for (const i of items) {
    for (const r of SUMMARY_RANGES) {
      if (!inSummaryRange(i.dueDate, r, today)) continue;
      out[r].count++;
      out[r].total += i.amount ?? 0;
    }
  }
  return out;
}

/** Erteleme: +1 hafta ya da +1 ay (ay sonu kırpılır: 31 Ocak → 28 Şubat) */
export type PostponeBy = "week" | "month";

/**
 * Ertelenmiş tarih. `today` verilirse gecikmiş ödeme bugünden sayılır (13.09'da gecikmiş fatura 20.10'da
 * "1 hafta ertele" → 27.10; eski vadeden sayılsaydı 20.09 olur, yine gecikmiş kalırdı).
 */
export function postponeDate(dueDate: string, by: PostponeBy, today?: string): string {
  const base = today && dueDate < today ? today : dueDate;
  return by === "week" ? addDays(base, 7) : addMonthsAnchored(base, 1, Number(base.slice(8, 10)));
}

/**
 * Tekrar eden hatırlatıcıyı ertelemek: bu dönem tek seferlik bir kopya olarak yeni tarihe alınır, seri sıradaki
 * döneminden sürer. Yeni tarih sıradaki (henüz gelmemiş) dönemin günü ya da sonrası ise aynı ödeme iki kez
 * görünürdü (aylık 28.10 → "1 ay ertele" 28.11 = seri de 28.11): bu erteleme sunulmaz (`conflict`).
 */
export function postponePlan(
  r: { dueDate: string; repeat: ReminderRepeat; anchorDate: string },
  by: PostponeBy,
  today: string,
): { target: string; next: string | null; conflict: boolean } {
  const target = postponeDate(r.dueDate, by, today);
  const next = r.repeat === "none" ? null : nextOccurrence(r.dueDate, r.repeat, r.anchorDate);
  return { target, next, conflict: next !== null && next >= today && target >= next };
}

/**
 * Listenin ufkundan (45 gün) sonraki tarihi olan etkin hatırlatıcıların şimdiki dönemi: takvimde kendi ayında
 * görünsün (yıllık, erken ödenmiş aylık, ileri ertelenmiş tek seferlik). upcomingItems'in dışarıda bıraktıklarıdır.
 */
export function laterReminderItems(reminders: ReminderRow[], today: string, horizonDays = UPCOMING_HORIZON_DAYS): UpcomingItem[] {
  const out: UpcomingItem[] = [];
  for (const r of reminders) {
    if (!r.active) continue;
    const daysLeft = daysBetween(today, r.dueDate);
    if (daysLeft <= Math.max(horizonDays, r.remindDaysBefore)) continue;
    out.push({
      ref: `reminder:${r.id}`,
      source: "reminder",
      sourceId: r.id,
      kind: r.kind,
      title: r.title,
      detail: r.note,
      amount: r.amount,
      dueDate: r.dueDate,
      daysLeft,
      status: statusFor(daysLeft, r.remindDaysBefore),
      remindDaysBefore: r.remindDaysBefore,
      repeat: r.repeat,
    });
  }
  return out.sort(byDueThenTitle);
}

/**
 * Paraşüt eşitlemesinde faturanın vadesi (sync.ts). Panelde değiştirilen vade (ertele, "Vade tarihi", fatura
 * formu) Paraşüt'teki vade o zamandan beri aynıysa korunur; Paraşüt'te vade değiştiyse Paraşüt'ünki gelir.
 * Paraşüt vade göndermezse paneldeki kalır. `seen`: önceki eşitlemede Paraşüt'ün gönderdiği vade; kayıt yoksa
 * (undefined: ilk bağlanma ya da kayıt tutulmadan önceki fatura) Paraşüt'ünki alınır.
 */
export function syncedDueDate(local: string | null, incoming: string | null, seen: string | null | undefined): string | null {
  if (incoming === null) return local;
  if (seen === undefined || incoming !== seen) return incoming;
  return local;
}

/** Gün sayısının iyelik eki: 1'i, 2'si, 6'sı, 9'u, 10'u, 20'si, 26'sı */
function dayPossessiveSuffix(day: number): string {
  const units: Record<number, string> = { 1: "i", 2: "si", 3: "ü", 4: "ü", 5: "i", 6: "sı", 7: "si", 8: "i", 9: "u" };
  const tens: Record<number, string> = { 10: "u", 20: "si", 30: "u" };
  return day % 10 === 0 ? (tens[day] ?? "u") : units[day % 10];
}

/** "28'i", "26'sı" */
export function dayPossessive(day: number): string {
  return `${day}'${dayPossessiveSuffix(day)}`;
}

/** "28'inde", "26'sında", "30'unda" */
export function dayLocative(day: number): string {
  const s = dayPossessiveSuffix(day);
  return `${day}'${s}${/[ıu]$/.test(s) ? "nda" : "nde"}`;
}

/** Tekrar rozeti: "Her ay 28'inde", "Her ayın son günü", "Her hafta Salı", "Üç ayda bir · 17'sinde", "Her yıl 17 Şubat" */
export function repeatLabel(repeat: ReminderRepeat, dueDate: string, anchorDate?: string | null): string | null {
  const anchorDay = Number((anchorDate ?? "").slice(8, 10)) || Number(dueDate.slice(8, 10));
  const endOfMonth = anchorDay >= 31;
  switch (repeat) {
    case "none":
      return null;
    case "weekly":
      return `Her hafta ${WEEKDAYS_TR[new Date(toUTC(dueDate)).getUTCDay()]}`;
    case "monthly":
      return endOfMonth ? "Her ayın son günü" : `Her ay ${dayLocative(anchorDay)}`;
    case "quarterly":
      return endOfMonth ? "Üç ayda bir · ay sonu" : `Üç ayda bir · ${dayLocative(anchorDay)}`;
    case "yearly":
      return `Her yıl ${Number(dueDate.slice(8, 10))} ${MONTHS_TR[Number(dueDate.slice(5, 7)) - 1]}`;
  }
}

/** Takvim karosu: "Eki" */
export function monthShortTR(date: string): string {
  return MONTHS_TR[Number(date.slice(5, 7)) - 1].slice(0, 3);
}

/** "Ekim 2026" */
export function monthTitleTR(month: string): string {
  return `${MONTHS_TR[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** "20 Ekim Salı" */
export function longDateTR(date: string): string {
  return `${Number(date.slice(8, 10))} ${MONTHS_TR[Number(date.slice(5, 7)) - 1]} ${WEEKDAYS_TR[new Date(toUTC(date)).getUTCDay()]}`;
}

/** "2026-10" + 1 → "2026-11" */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Ay takvimi: pazartesiden başlayan haftalar; baştaki ve sondaki günler komşu aylardan */
export function monthGrid(month: string): string[][] {
  const first = `${month}-01`;
  const lead = (new Date(toUTC(first)).getUTCDay() + 6) % 7;
  const start = addDays(first, -lead);
  const last = monthEnd(first);
  const weeks: string[][] = [];
  let d = start;
  while (weeks.length < 6) {
    const week = Array.from({ length: 7 }, (_, i) => addDays(d, i));
    weeks.push(week);
    d = addDays(d, 7);
    if (d > last) break;
  }
  return weeks;
}

/**
 * Takvimde ileriki dönemler: etkin, tekrar eden hatırlatıcıların sıradaki tarihinden sonraki dönemleri
 * (from–to arasında, bugünden önce olmayanlar). Kayıtlı dönem listede zaten olduğu için dahil edilmez.
 */
export function projectedOccurrences(reminders: ReminderRow[], from: string, to: string, today: string): { reminder: ReminderRow; date: string }[] {
  const out: { reminder: ReminderRow; date: string }[] = [];
  const start = from > today ? from : today;
  for (const r of reminders) {
    if (!r.active || r.repeat === "none") continue;
    let next = nextOccurrence(r.dueDate, r.repeat, r.anchorDate);
    for (let guard = 0; next && next <= to && guard < 400; guard++) {
      if (next >= start) out.push({ reminder: r, date: next });
      next = nextOccurrence(next, r.repeat, r.anchorDate);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.reminder.title.localeCompare(b.reminder.title, "tr"));
}

/** Şablondan yeni hatırlatıcı formunun ilk değerleri */
export function presetDraft(preset: (typeof REMINDER_PRESETS)[number], today: string) {
  const dueDate = presetFirstDate(preset, today);
  return {
    title: preset.title,
    kind: preset.kind,
    repeat: preset.repeat,
    remindDaysBefore: preset.remindDaysBefore,
    note: preset.note,
    dueDate,
    endOfMonth: preset.dueDay === "son",
  };
}
