/**
 * Hatırlatıcı ve yaklaşan ödeme hesapları (saf fonksiyonlar; tests/reminders.test.ts).
 * Tarihler "YYYY-MM-DD" metni, gün farkları Türkiye saatine göre takvim günü.
 */

import type { FixedPeriod, FixedSection } from "./calc/types";
import type { CostMode } from "./cari/account";
import { openBalance } from "./cari/balance";
import { fixedVatRate } from "./constants";
import { money, monthLabel } from "./format";

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
  /** Bu faturaya sayılan cari ödemeler ve panel takibinin tabanı (src/lib/cari/balance.ts openBalance) */
  allocated?: number | null;
  ledgerBase?: number | null;
  /** Tedarikçinin cari kartındaki vade (gün): vadesiz faturada genel ayarın yerine geçer */
  termDays?: number | null;
}

export type UpcomingStatus = "overdue" | "today" | "soon" | "later";

/**
 * Ödeme kaleminin altındaki ipucu (docs/TEDARIKCILER.md "Hesap hareketleri"): faturasız alımın faturası olabilir
 * ("Bağla" · "Ayrı alım") ya da kasadan ödenmiş olabilir ("İşle"). `href` tedarikçinin sayfası, ilgili pencere açık.
 */
export type UpcomingHint =
  | { kind: "link"; text: string; href: string; invoiceId: number; debtIds: number[] }
  | { kind: "kasa"; text: string; href: string; cashOutId: number };

export interface UpcomingItem {
  /** "reminder:4", tekrarın öngörülen dönemi için "reminder:4@2026-11-28", fatura için "invoice:12", faturasız borç için "cari:7" */
  ref: string;
  /** Tekrar eden hatırlatıcının geciken döneminden sonraki, henüz kaydedilmemiş dönem */
  projected?: boolean;
  /** Hatırlatıcı, ödenmemiş fatura ya da tedarikçinin faturasız (elle girilen) borcu. Dallar `switch` + unreachable */
  source: "reminder" | "invoice" | "cari";
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
  /** Fatura ve faturasız borç: tedarikçinin cari kartı (kartsızda yok) */
  supplierId?: number;
  /** Hesaptaki (sayılmamış) ödemeden bu kaleme düşülen; `amount` düşüldükten sonraki tutardır (okuma anında mahsup) */
  credited?: number;
  /**
   * Sessiz kalem: "link" faturasız alımın faturası olabilir (bağlanana kadar sabah e-postasında ve nakit planında yok),
   * "kasa" kalanı işlenmemiş bir Kasa satırını tutuyor, kasadan ödenmiş olabilir (sabah e-postası hatırlatmaz; satır
   * başına bir kalem). Tutmayan satırın ipucu kalemi sessize almaz
   */
  quiet?: "link" | "kasa";
  hint?: UpcomingHint;
  /** Faturasız borcun gideri (Faturası gelecek, faturası yok, eski borç) */
  costMode?: CostMode;
  /** Faturasız borç: tedarikçinin sayfası ("Düzenle") */
  href?: string;
}

/** Faturasız borcun (cari kayıt) ödeme satırı için alanları; kalanı (`remaining`) sayılan ödemeler düşülmüş */
export interface CariDebtRow {
  id: number;
  /** Tedarikçinin (kartın) adı */
  supplier: string;
  date: string;
  dueDate: string | null;
  description: string | null;
  costMode: CostMode;
  remaining: number;
  /** Kartın vade günü (vadesiz borçta genel ayarın yerine geçer) */
  termDays?: number | null;
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

/**
 * Takvimde var olan gün mü ("YYYY-MM-DD"): "2026-13-01", "2026-02-30" ve "2026-00-10" değil (Date.parse 30 Şubat'ı
 * Mart'a taşır, ay 00'da geçersiz tarih verir). Sunucu eylemlerinin zDate'i ve sayfaların ?gun= değeri bununla denetlenir
 */
export function isCalendarDate(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

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

/** Ödemeler listesinin sırası: vade, sonra başlık */
export const byDueThenTitle = (a: UpcomingItem, b: UpcomingItem) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title, "tr");

/**
 * Ödenmemiş faturanın ödeme satırı; vadesizse fatura tarihinden sonraki tahmini vade: tedarikçinin kartındaki vade
 * günü (`termDays`), yoksa `invoiceTermDays`
 */
export function invoiceItem(inv: UnpaidInvoiceRow, today: string, invoiceDaysBefore: number, invoiceTermDays: number): UpcomingItem {
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
    // Kalan borç: Tedarikçiler'le aynı kural (ödenmemiş fatura listesi; cari takipte panelde sayılan düşülür)
    amount: openBalance({ ...inv, unpaid: true }),
    dueDate: due,
    daysLeft,
    status: statusFor(daysLeft, invoiceDaysBefore),
    remindDaysBefore: invoiceDaysBefore,
    repeat: "none",
  };
}

/** Faturasız borcun ayrıntı etiketi: "Faturasız alım · süt", "Fatura bekleniyor · süt", "Eski borç" */
export function cariDetailLabel(d: Pick<CariDebtRow, "costMode" | "description">): string {
  const what = d.description?.trim();
  const head = d.costMode === "fatura" ? "Fatura bekleniyor" : d.costMode === "devir" ? "Eski borç" : "Faturasız alım";
  return what ? `${head} · ${what}` : head;
}

/**
 * Faturasız borcun (cari kayıt) ödeme satırı: faturanınki gibi; vadesizse alım gününden kartın vade günü, yoksa
 * `invoiceTermDays` sonra. Tutar borcun kalanı (sayılan ödemeler düşülmüş)
 */
export function cariItem(d: CariDebtRow, today: string, invoiceDaysBefore: number, invoiceTermDays: number): UpcomingItem {
  const term = d.termDays ?? invoiceTermDays;
  const due = d.dueDate ?? addDays(d.date, term);
  const daysLeft = daysBetween(today, due);
  return {
    ref: `cari:${d.id}`,
    source: "cari",
    sourceId: d.id,
    kind: "odeme",
    title: d.supplier,
    detail: [cariDetailLabel(d), d.dueDate ? null : `vade tahmini (${term} gün)`].filter(Boolean).join(" · "),
    amount: d.remaining,
    dueDate: due,
    daysLeft,
    status: statusFor(daysLeft, invoiceDaysBefore),
    remindDaysBefore: invoiceDaysBefore,
    repeat: "none",
    costMode: d.costMode,
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
 * `key` bildirim günlüğünde tekil anahtardır (`kaynak:kimlik:vade:aşama`; faturasız borçta `cari:<kimlik>:…`).
 * Gecikmiş olanlar ilk 14 gün içinde bir kez hatırlatılır. Anahtar ref'ten değil kaynak + kimlikten kurulur: geciken
 * dönemin yanındaki öngörülen dönem (`reminder:4@2026-11-01`), geciken ödenince gerçek kayda (`reminder:4`) döner ve
 * aynı e-posta ikinci kez gitmez. Sessiz kalemler (faturasız alımın faturası olabilecek fatura, kasadan ödenmiş
 * olabilecek kalem) hatırlatılmaz.
 */
export function dueNotifications(items: UpcomingItem[]): { item: UpcomingItem; stage: NotifyStage; key: string }[] {
  const out: { item: UpcomingItem; stage: NotifyStage; key: string }[] = [];
  for (const item of items) {
    if (item.quiet) continue;
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
export function digestSummary({
  count = 0,
  invoices = 0,
  prices = 0,
  syncError = false,
  system = 0,
  holds = 0,
  boxes = [],
}: {
  count?: number;
  invoices?: number;
  prices?: number;
  syncError?: boolean;
  /** Günlük işlerin sorunları (Sistem uyarıları bölümü) */
  system?: number;
  /** Son e-postadan beri onaya düşen hammadde fiyatları (Paraşüt bölümü) */
  holds?: number;
  /** Haber olan ek kutuların konu parçaları, parçası olmayanın adı (komisyon, kontrol; src/server/notify/digest-extras.ts) */
  boxes?: string[];
}): string {
  return [
    count ? `${count} hatırlatma` : "",
    invoices ? `${invoices} yeni fatura` : "",
    holds ? `${holds} fiyat onayı` : "",
    ...boxes,
    prices ? `${prices} zam` : "",
    syncError ? "Paraşüt eşitleme hatası" : "",
    system ? `${system} sistem uyarısı` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function daysLeftLabel(daysLeft: number): string {
  if (daysLeft === 0) return "Bugün";
  if (daysLeft === 1) return "Yarın";
  if (daysLeft > 1) return `${daysLeft} gün kaldı`;
  if (daysLeft === -1) return "Dün geçti";
  return `${-daysLeft} gün gecikti`;
}

const CTV_NOTE = "Tutarı ve günü belediyenin tahakkukundan yazın; gün tahakkuka göre değişebilir.";

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
  /** Üç aylık ve yıllık şablonların ayları (1–12) */
  months?: number[];
}[] = [
  { key: "kdv", title: "KDV beyannamesi ve ödemesi", kind: "vergi", repeat: "monthly", dueDay: 28, remindDaysBefore: 5, note: "Önceki ayın KDV'si; takip eden ayın 28'i." },
  { key: "muhtasar", title: "Muhtasar ve prim hizmet beyannamesi", kind: "vergi", repeat: "monthly", dueDay: 26, remindDaysBefore: 5, note: "Önceki ayın stopaj ve SGK bildirimi; takip eden ayın 26'sı." },
  { key: "sgk", title: "SGK prim ödemesi", kind: "vergi", repeat: "monthly", dueDay: "son", remindDaysBefore: 5, note: "Önceki ayın primleri; takip eden ayın son günü." },
  {
    key: "gecici",
    title: "Geçici vergi beyanı ve ödemesi",
    kind: "vergi",
    repeat: "quarterly",
    dueDay: 17,
    months: [2, 5, 8, 11],
    remindDaysBefore: 7,
    note: "Çeyrek bitiminden sonraki ikinci ayın 17'si; 4. dönem (Ekim–Aralık) Şubat'ta, 2025'ten beri yeniden veriliyor.",
  },
  { key: "maas", title: "Maaş ödemesi", kind: "maas", repeat: "monthly", dueDay: 1, remindDaysBefore: 2, note: "Personel maaşları." },
  { key: "kira", title: "Kira", kind: "kira", repeat: "monthly", dueDay: 1, remindDaysBefore: 3, note: "Dükkân kirası." },
  { key: "abonelik", title: "Abonelik", kind: "fatura", repeat: "monthly", dueDay: 15, remindDaysBefore: 2, note: "İnternet, POS, yazılım, müzik gibi aylık abonelik." },
  // Yıllık vergi şablonları: kurumlar vergisi ve belediyenin tahakkuk ettirdiği yerel vergiler (düz hatırlatıcı; vergiyi
  // muhasebeci yürütür, panel tahmin yapmaz)
  { key: "kv", title: "Kurumlar vergisi beyannamesi ve ödemesi", kind: "vergi", repeat: "yearly", dueDay: "son", months: [4], remindDaysBefore: 14, note: "Önceki yılın kurumlar vergisi; Nisan'ın son günü." },
  { key: "ctv1", title: "Çevre temizlik vergisi (1. taksit)", kind: "vergi", repeat: "yearly", dueDay: "son", months: [5], remindDaysBefore: 7, note: CTV_NOTE },
  { key: "ctv2", title: "Çevre temizlik vergisi (2. taksit)", kind: "vergi", repeat: "yearly", dueDay: "son", months: [11], remindDaysBefore: 7, note: CTV_NOTE },
  {
    key: "ilan",
    title: "İlan ve reklam vergisi",
    kind: "vergi",
    repeat: "yearly",
    dueDay: "son",
    months: [1],
    remindDaysBefore: 7,
    note: "Tabelanın vergisi; yeni tabela asılmadan önce beyan edilir. Gün ve tutar belediyenin tahakkukundan.",
  },
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

/**
 * Ertelenen dönemin notu: "Ertelendi · asıl tarih 25.10.2026 · <eski not>". Tekrar edenin kopyası da, ertelenen tek
 * seferlik hatırlatıcı da bunu taşır; zaten ertelenmiş olanın notu (ilk asıl tarih) korunur. Nakit planı dönemi
 * asıl günden bulur (`postponedFrom`): 8 Kasım'a ertelenen Eylül KDV-2'si Eylül'ündür.
 */
export function postponeNote(note: string | null, dueDate: string): string {
  if (postponedFrom(note)) return note!;
  const [y, m, d] = dueDate.split("-");
  return `Ertelendi · asıl tarih ${d}.${m}.${y}${note ? ` · ${note}` : ""}`.slice(0, 500);
}

/** `postponeNote`'un asıl günü ("YYYY-MM-DD"); ertelenmemişse null */
export function postponedFrom(note: string | null): string | null {
  const m = /^Ertelendi · asıl tarih (\d{2})\.(\d{2})\.(\d{4})/.exec(note ?? "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** "Sabit giderlerden ekle"nin hatırlatıcıya yazdığı not: Ödemeler'de kaynağı, nakit planında bordro olmadığını gösterir */
export const FIXED_REMINDER_NOTE = "Sabit giderlerden";

/**
 * "Sabit giderlerden ekle"nin hatırlatıcıya yazdığı dönem ve tutar: ilk ödeme ayında geçerli sürümden (o aydan
 * geçerli zam dahil), tutar faturadaki KDV'siyle (nakit planı sabit gideri KDV dahil öder; hatırlatıcının tutarı
 * bankadan çıkan paradır, plan onu olduğu gibi kesin sayar). `gross` o ayın KDV dahil tutarı.
 *
 * Giderler'de sonraki bir aydan geçerli değişiklik zaten girilmişse `changesFrom` o ay. Tutar yine yazılır: bu
 * hatırlatıcı sabit gideri izler (fixedReminderFollows; nakit planı zamdan sonraki dönemlerde sürümün tutarını öder,
 * "Ödendi" tutarı sıradaki dönemin sürümüne taşır). Yalnız dönemi sonradan değişen kalemde (aylık → yıllık) tutar
 * yazılmaz: tutarsız hatırlatıcıya plan her ayın sürümünü dönemine çevirerek taşır. Tutar 0 ise de yazılmaz.
 *
 * Stopajlı kalemde (`withholdingRate`, saklı stopaj profili, src/lib/bordro/stopaj.ts; şahsa kira, serbest meslek, şahsa
 * internet reklamı) ödemeden kesilen stopaj düşülür: bankadan çıkan net tutardır, stopajı muhasebeci muhtasarla öder
 * (kira 160.000 brüt → 128.000). `gross` o ayın bankadan çıkan tutarıdır (KDV dahil, stopaj düşülmüş).
 */
export function fixedReminderAt(
  f: { amount: number; period: FixedPeriod; section: FixedSection; vatRate?: number | null; withholdingRate?: number | null },
  versions: readonly { fromMonth: string; period: FixedPeriod; amount: number }[],
  month: string,
): { period: FixedPeriod; amount: number | null; gross: number; vatRate: number; changesFrom: string | null } {
  let at: { fromMonth: string; period: FixedPeriod; amount: number } = { fromMonth: "", period: f.period, amount: f.amount };
  for (const v of versions) if (v.fromMonth <= month && v.fromMonth >= at.fromMonth) at = v;
  const changesFrom =
    versions
      .filter((v) => v.fromMonth > month && (v.amount !== at.amount || v.period !== at.period))
      .map((v) => v.fromMonth)
      .sort()[0] ?? null;
  const periodChanges = versions.some((v) => v.fromMonth > month && v.period !== at.period);
  const vatRate = fixedVatRate(f);
  const withheld = f.withholdingRate ?? 0;
  const gross = Math.round(at.amount * (1 + vatRate - withheld) * 100) / 100;
  return { period: at.period, amount: gross > 0 && !periodChanges ? gross : null, gross, vatRate, changesFrom };
}

/** Hatırlatıcı tekrarının sabit gider karşılığı (çeyreklik ve tek seferlik yok) */
const REPEAT_PERIOD: Partial<Record<ReminderRow["repeat"], FixedPeriod>> = { weekly: "haftalik", monthly: "aylik", yearly: "yillik" };

/**
 * Sabit gideri izleyen hatırlatıcı mı: "Sabit giderlerden ekle" ile açılmış (not), dönemi gideriyle aynı ve tutarı
 * sıradaki ödeme ayının sürümüne eşit (KDV dahil, ±1 ₺). Böyle bir hatırlatıcıda nakit planı her dönemin sürümünü öder
 * (zam uyarısı çıkmaz), "Ödendi" tutarı sıradaki dönemin sürümüne taşır. Elle başka tutar yazılmışsa izlemez
 */
export function fixedReminderFollows(
  r: Pick<ReminderRow, "note" | "amount" | "dueDate" | "repeat">,
  f: Parameters<typeof fixedReminderAt>[0],
  versions: Parameters<typeof fixedReminderAt>[1],
): boolean {
  const cadence = REPEAT_PERIOD[r.repeat];
  if (!r.note?.startsWith(FIXED_REMINDER_NOTE) || r.amount === null || !cadence) return false;
  const at = fixedReminderAt(f, versions, r.dueDate.slice(0, 7));
  return at.period === cadence && at.gross > 0 && Math.abs(at.gross - r.amount) <= 1;
}

/**
 * Sıradaki dönemi `nextDue` olan izleyen hatırlatıcının yeni tutarı (o ayın sürümü, KDV dahil); izlemiyorsa, dönemi
 * tutmuyorsa ya da tutar aynıysa null ("Ödendi" sabit gideri izleyen tutarı ileri taşır)
 */
export function fixedReminderNextAmount(
  r: Pick<ReminderRow, "note" | "amount" | "dueDate" | "repeat">,
  f: Parameters<typeof fixedReminderAt>[0],
  versions: Parameters<typeof fixedReminderAt>[1],
  nextDue: string,
): number | null {
  if (!fixedReminderFollows(r, f, versions)) return null;
  const at = fixedReminderAt(f, versions, nextDue.slice(0, 7));
  return at.period === REPEAT_PERIOD[r.repeat] && at.gross > 0 && Math.abs(at.gross - r.amount!) > 1 ? at.gross : null;
}

/** Sabit gideri izleyen hatırlatıcının sonraki bir aydan değişen tutarı (sonuç mesajı) */
export interface FixedReminderLater {
  month: string;
  amount: number;
}

/**
 * Sabit gider değişince (tutar, dönem, KDV oranı; denetim E-46) "Sabit giderlerden ekle" ile açılmış hatırlatıcının
 * tutarı ne olsun. Hatırlatıcıdaki tutar eskisinin otomatik tutarıysa (sıradaki ödeme ayının sürümü, KDV dahil; ±1 ₺)
 * hatırlatıcı gideri izler: tutarı sıradaki ödeme ayının yeni sürümü olur (sonraki bir aydan zam girildiyse bu ayınki
 * kalır, `later` o zammı söyler; nakit planı zamdan sonraki dönemlerde sürümü öder), dönemi tutmuyorsa boşalır. Elle
 * başka bir tutar yazılmışsa dokunulmaz: yeni tutar farklıysa ya da ileride değişiyorsa "manual" (uyarılır). Tutarsız
 * hatırlatıcı zaten Giderler'i izler.
 */
export function fixedReminderFollow(
  r: { amount: number | null; dueDate: string; repeat: ReminderRow["repeat"] },
  before: Parameters<typeof fixedReminderAt>[0],
  beforeVersions: Parameters<typeof fixedReminderAt>[1],
  after: Parameters<typeof fixedReminderAt>[0],
  afterVersions: Parameters<typeof fixedReminderAt>[1],
):
  | { kind: "same"; later?: FixedReminderLater }
  | { kind: "update"; amount: number | null; later?: FixedReminderLater }
  | { kind: "manual"; expected: number } {
  if (r.amount === null) return { kind: "same" };
  const month = r.dueDate.slice(0, 7);
  const cadence = REPEAT_PERIOD[r.repeat];
  const old = fixedReminderAt(before, beforeVersions, month);
  const now = fixedReminderAt(after, afterVersions, month);
  const auto = cadence !== undefined && old.period === cadence && Math.abs(old.gross - r.amount) <= 1;
  if (!auto) return now.changesFrom || Math.abs(now.gross - r.amount) > 1 ? { kind: "manual", expected: now.gross } : { kind: "same" };
  const next = now.period === cadence && now.gross > 0 ? now.gross : null;
  // Sonraki bir aydan değişen tutar (dönemi aynı): hatırlatıcı izler, mesaj söyler
  const laterAt = next !== null && now.changesFrom ? fixedReminderAt(after, afterVersions, now.changesFrom) : null;
  const later = laterAt && laterAt.period === cadence && laterAt.gross > 0 ? { later: { month: now.changesFrom!, amount: laterAt.gross } } : {};
  return next !== null && Math.abs(next - r.amount) <= 1 ? { kind: "same", ...later } : { kind: "update", amount: next, ...later };
}

const FIXED_PERIOD_LABEL: Record<FixedPeriod, string> = { aylik: "aylık", haftalik: "haftalık", yillik: "yıllık", gunluk: "günlük" };

/** "Sabit giderlerden ekle" listesindeki satır: seçilen ilk ödeme ayında hatırlatıcıya yazılacak olan (eylemle aynı) */
export function fixedReminderText(...args: Parameters<typeof fixedReminderAt>): string {
  const at = fixedReminderAt(...args);
  const period = FIXED_PERIOD_LABEL[at.period];
  const withheld = args[0].withholdingRate ?? 0;
  const vat = (at.vatRate > 0 ? ` (%${Math.round(at.vatRate * 100)} KDV dahil)` : "") + (withheld > 0 ? ` (stopaj %${Math.round(withheld * 100)} düşüldü, muhtasarda)` : "");
  const [, versions, month] = args;
  const periodFrom = versions
    .filter((v) => v.fromMonth > month && v.period !== at.period)
    .map((v) => v.fromMonth)
    .sort()[0];
  if (at.amount === null && at.gross > 0 && periodFrom)
    return `${money(at.gross)}${vat} · ${period} · ${monthLabel(periodFrom)} itibarıyla dönemi değişiyor: tutar yazılmaz, nakit planı Giderler'deki tutarı izler`;
  if (at.amount === null) return `Tutar yazılmaz · ${period}`;
  if (at.changesFrom) return `${money(at.amount)}${vat} · ${period} · ${monthLabel(at.changesFrom)} itibarıyla değişiyor: hatırlatıcı yeni tutarı izler`;
  return `${money(at.amount)}${vat} · ${period}`;
}

// KDV tevkifatı (2 No.lu KDV beyannamesi, "KDV2"): ayrı beyanname ve ödeme. Asıl KDV sayılsa tutarı o ayın kesin KDV'si
// olur, devredeni sıfırlar ve sonraki dönemi kendi gününe alırdı
const VAT_WITHHOLDING = /tevkifat|kdv\s*-?\s*2(?![\d.])|(^|\D)2\.?\s*(no|numara)|sorumlu sifat/;

/**
 * Yalnız damga vergisi (katlanmış başlık): damga geçer ama vergiye bağlanmamıştır. "KDV2 damga vergisi", "KDV damga
 * vergisi", "... damga vergisi ve gecikme zammı" ayrı ödemedir. Tahakkukla birlikte yazılan ("KDV2 + damga", "KDV2
 * ve damga vergisi", "Damga vergisi ve Eylül KDV2", "damga dahil") ya da damgayı dışarıda bırakan ("damga hariç",
 * "damga ayrı") vergi hatırlatıcısıdır.
 */
function stampOnly(t: string): boolean {
  if (!/damga/.test(t)) return false;
  const joined =
    /(\+|&|\bve\b)\s*damga|damga\s*(vergisi\s*)?(dahil|haric|ayri)|damga\b[^()]*?(\+|&|\bve\b)\s*(\S+\s+){0,2}(kdv|katma|tevkifat|sorumlu|2\.?\s*(no|numara))/;
  return !joined.test(t);
}

/**
 * 2 No.lu KDV (tevkifat) hatırlatıcısı: o dönemin KDV-2'sini plana hatırlatıcı taşır. Başlıkta tevkifat, "2 No.lu"
 * ya da "sorumlu sıfatıyla" ile birlikte KDV geçmeli; KDV'siz yalnız "2 No.lu beyanname" (panelin kendi sözü) ve
 * başka bir vergi adı yoksa. Yalnız damga vergisi ayrı bir ödemedir; "Muhtasar (gelir vergisi tevkifatı)", "Stopaj
 * tevkifat", "Kira tevkifatı beyannamesi" ve "Tevkifat beyannamesi" (muhtasar da böyle anılır) KDV-2 değildir.
 */
export function isVatWithholdingReminder(r: Pick<ReminderRow, "kind" | "title">): boolean {
  if (r.kind === "kira" || r.kind === "maas" || reminderCategory(r.kind, r.title) === "sgk") return false;
  const t = foldTR(r.title);
  if (!VAT_WITHHOLDING.test(t) || stampOnly(t)) return false;
  if (/(^|[^a-z])kdv|katma deger/.test(t)) return true;
  // "2 No.lu beyanname" ya da başlığın sonunda "Beyanname (2 No'lu)"; "Beyanname 2 numaralı şube" değil
  const declaration = /(^|\D)2\.?\s*(no|numara)\S*\s+beyan|beyan\S*\s*\(?2\.?\s*(no|numara)\S*\s*$/.test(t);
  return declaration && !/muhtasar|stopaj|gelir|kurumlar|gecici|kira|serbest meslek/.test(t);
}

/**
 * KDV ödemesi hatırlatıcısı (Ödendi'de tutarın silinmesi, şubenin nakit akışının dışı): başlıkta "KDV" ya da "katma değer".
 * Kira ve maaş türü ("Kira KDV'si"), SGK başlıkları, KDV tevkifatı ("2 No.lu KDV", "KDV2") ve yalnız damga vergisi
 * ("KDV damga vergisi") KDV ödemesi sayılmaz.
 */
export function isVatReminder(r: Pick<ReminderRow, "kind" | "title">): boolean {
  if (r.kind === "kira" || r.kind === "maas" || reminderCategory(r.kind, r.title) === "sgk") return false;
  const t = foldTR(r.title);
  return !VAT_WITHHOLDING.test(t) && !stampOnly(t) && /(^|[^a-z])kdv([^a-z]|$)|katma deger/.test(t);
}

/**
 * Tekrarlı KDV ve KDV-2 (tevkifat) hatırlatıcısının tutarı yalnız o döneme aittir (her ay o ayın satışından ve
 * faturalarından): "Ödendi" ve ertelemede seriden silinir, geri al geri yazar. Silinmezse Eylül'ün tutarı nakit planında
 * Kasım'da da kesin görünürdü. Yalnız damga vergisi ikisi de değildir, tutarı kalır.
 */
export function vatAmountTravels(r: Pick<ReminderRow, "kind" | "title" | "amount" | "repeat">): boolean {
  return r.repeat !== "none" && r.amount !== null && (isVatReminder(r) || isVatWithholdingReminder(r));
}

/**
 * Yalnız beyanname damgası hatırlatıcısı ("KDV damga vergisi", "KDV2 damga vergisi"): hangi beyannamenin damgası; damga
 * değilse ya da KDV'ye bağlı değilse null (vergi hatırlatıcısı: şubenin nakit akışının dışı, src/lib/cash-plan-branch.ts)
 */
export function vatStampReminder(r: Pick<ReminderRow, "kind" | "title">): "kdv" | "kdv2" | null {
  if (r.kind === "kira" || r.kind === "maas" || reminderCategory(r.kind, r.title) === "sgk") return null;
  const t = foldTR(r.title);
  if (!stampOnly(t)) return null;
  if (VAT_WITHHOLDING.test(t)) return "kdv2";
  return /(^|[^a-z])kdv|katma deger/.test(t) ? "kdv" : null;
}

/**
 * Muhtasar hatırlatıcısı (vergi hatırlatıcısı; şubenin nakit akışının dışı): başlıkta "muhtasar" ya da "stopaj"; KDV,
 * KDV-2, SGK ve yalnız damga vergisi değil. "Kira stopajı" da muhtasarla ödenir
 */
export function isMuhtasarReminder(r: Pick<ReminderRow, "kind" | "title">): boolean {
  const t = foldTR(r.title);
  if (!/muhtasar|stopaj/.test(t) || stampOnly(t)) return false;
  return !isVatReminder(r) && !isVatWithholdingReminder(r) && reminderCategory(r.kind, r.title) !== "sgk";
}

/** Geçici vergi hatırlatıcısı: başlıkta "geçici vergi" */
export function isProvisionalTaxReminder(r: Pick<ReminderRow, "title">): boolean {
  return /gecici\s+vergi/.test(foldTR(r.title));
}

/**
 * Tekrarlı hatırlatıcının tutarı yalnız o döneme mi ait: KDV ve KDV-2 (vatAmountTravels) ile başlığında "muhtasar" ya
 * da "geçici vergi" geçen tutarlı hatırlatıcı. "Ödendi" ve erteleme tutarı seriden siler, geri al geri yazar. Sabit
 * tutarlı "Kira stopajı"nın tutarı kalır
 */
export function taxAmountTravels(r: Pick<ReminderRow, "kind" | "title" | "amount" | "repeat">): boolean {
  if (vatAmountTravels(r)) return true;
  if (r.repeat === "none" || r.amount === null) return false;
  const t = foldTR(r.title);
  return (/muhtasar/.test(t) && !stampOnly(t)) || isProvisionalTaxReminder(r);
}

/**
 * "Ödendi" ya da ertelemede seriden silinen tutarın türü (taxAmountTravels; bildirim metni): KDV ve KDV-2 her ay,
 * muhtasar her ay, geçici vergi her dönem değişir. Tutar seride kalıyorsa null
 */
export function travelingAmountKind(r: Pick<ReminderRow, "kind" | "title" | "amount" | "repeat">): "kdv" | "muhtasar" | "gecici" | null {
  if (!taxAmountTravels(r)) return null;
  if (vatAmountTravels(r)) return "kdv";
  return isProvisionalTaxReminder(r) ? "gecici" : "muhtasar";
}

/** Ödendi bildiriminin cümlesi: "Muhtasar tutarı her ay değiştiği için silindi." */
export const AMOUNT_CLEARED_TEXT: Record<"kdv" | "muhtasar" | "gecici", string> = {
  kdv: "KDV tutarı her ay değiştiği için silindi.",
  muhtasar: "Muhtasar tutarı her ay değiştiği için silindi.",
  gecici: "Geçici vergi tutarı her dönem değiştiği için silindi.",
};

/** Yerel vergi hatırlatıcısı: çevre temizlik vergisi ("ÇTV") ya da ilan ve reklam vergisi; değilse null */
export function isLocalTaxReminder(r: Pick<ReminderRow, "title">): "ctv" | "ilan" | null {
  const t = foldTR(r.title);
  if (/cevre\s+temizlik|(^|[^a-z])ctv([^a-z]|$)/.test(t)) return "ctv";
  if (/ilan/.test(t) && /reklam/.test(t)) return "ilan";
  return null;
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

// Ay adının ekleri (ünlü uyumu ve sertleşme ay ay sabit): "Kasım'da", "Ağustos'ta", "Eylül'ün"
const MONTHS_LOC_TR = ["Ocak'ta", "Şubat'ta", "Mart'ta", "Nisan'da", "Mayıs'ta", "Haziran'da", "Temmuz'da", "Ağustos'ta", "Eylül'de", "Ekim'de", "Kasım'da", "Aralık'ta"];
const MONTHS_GEN_TR = ["Ocak'ın", "Şubat'ın", "Mart'ın", "Nisan'ın", "Mayıs'ın", "Haziran'ın", "Temmuz'un", "Ağustos'un", "Eylül'ün", "Ekim'in", "Kasım'ın", "Aralık'ın"];

/** Ayın bulunma hâli: "2026-09" (ya da "2026-09-14") → "Eylül'de" */
export function monthLocativeTR(month: string): string {
  return MONTHS_LOC_TR[Number(month.slice(5, 7)) - 1];
}

// Saatin eki okunuşun son sözcüğüne göre (ünlü uyumu ve sertleşme): birler bir, iki, üç, dört, beş, altı, yedi,
// sekiz, dokuz; onlar sıfır, on, yirmi, otuz, kırk, elli
const CLOCK_UNIT_LOC = ["", "de", "de", "te", "te", "te", "da", "de", "de", "da"];
const CLOCK_TENS_LOC = ["da", "da", "de", "da", "ta", "de"];

/**
 * Saatin bulunma ("09:42'de", "05:00'te") ya da ayrılma ("20:00'den") hâli, okunuşuna göre: dakika 00 ise saat, değilse
 * dakika okunur. Metin "24 Eki 09:42" gibi bir saatle bitebilir; saatle bitmiyorsa olduğu gibi döner.
 */
export function clockSuffixTR(text: string, kind: "loc" | "abl" = "loc"): string {
  const m = /(\d{1,2})[:.](\d{2})$/.exec(text);
  if (!m) return text;
  const n = Number(m[2]) || Number(m[1]);
  const loc = n % 10 ? CLOCK_UNIT_LOC[n % 10] : (CLOCK_TENS_LOC[Math.floor(n / 10)] ?? "de");
  return `${text}'${loc}${kind === "abl" ? "n" : ""}`;
}

/** Ayın tamlayan hâli: "2026-09" → "Eylül'ün" */
export function monthGenitiveTR(month: string): string {
  return MONTHS_GEN_TR[Number(month.slice(5, 7)) - 1];
}

// Gün ile ay arasında bölünmez boşluk: satır sarılınca "22" bir satırda, "Ekim" ötekinde kalmasın
const NBSP = "\u00a0";

/** "2026-11-01" → "1 Kasım" */
export function dayMonthTR(date: string): string {
  return `${Number(date.slice(8, 10))}${NBSP}${MONTHS_TR[Number(date.slice(5, 7)) - 1]}`;
}

/** Günün bulunma hâli: "2026-11-01" → "1 Kasım'da" */
export function dayLocativeTR(date: string): string {
  return `${Number(date.slice(8, 10))}${NBSP}${monthLocativeTR(date)}`;
}

/** Günün ayrılma hâli: "2026-11-10" → "10 Kasım'dan", "2026-08-03" → "3 Ağustos'tan" */
export function dayAblativeTR(date: string): string {
  return `${dayLocativeTR(date)}n`;
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
