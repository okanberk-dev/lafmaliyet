/**
 * Haftalık yönetici özeti (pazartesi e-postası; docs/HAFTALIK-OZET.md): hafta hesabı, maddelerin seçimi ve sırası,
 * gönderim kaydının durumu, sabah işindeki adımın kararı ve sözcüğü. Saf modül: sunucu bağımlılığı yok, saat dışarıdan
 * gelir (tests/haftalik-ozet.test.ts sınar). Maddeleri items.ts kurar, metinler text.ts'te, e-posta
 * src/server/notify/weekly-template.ts'te, okuma ve gönderim src/server/weekly/*'da.
 */

import type { StepResult } from "@/lib/job-health";
import { addDays } from "@/lib/reminders";

/** Maddelerin kaynağı (her kaynaktan en çok bir madde) */
export type WeeklySource = "zam" | "nakit" | "kasa" | "komisyon" | "kasa-fiyat" | "zayi" | "stok" | "karaoke" | "kontrol";

export interface WeeklyItem {
  /** Kararlı kimlik, ad taşımaz: "zam:12:4", "kasa:eksik:2026-W44" (haftalik.gecmis'e yazılır) */
  key: string;
  source: WeeklySource;
  /** Tutar başlıkta */
  title: string;
  detail: string | null;
  /** Sıralama tutarı (₺, "bu ayın parası"): süren kayıp ayda, tek seferlik olgu kendi tutarıyla; null = lira değeri yok */
  tl: number | null;
  /** APP_URL'siz panel yolu */
  href: string;
  /** Bağlantı metni ("Fiyatlara bak") */
  action: string;
  /** Yalnız bir kez gösterilir (ayın stok farkı) */
  once?: boolean;
  /** Sabah e-postasının aynı olgu için notification_log anahtarları: hepsi bugün gittiyse madde düşer */
  newsKeys?: string[];
}

/** İş gününün haftası (pazartesi–pazar) ve geçen haftanın aralığı */
export interface WeekInfo {
  /** İş günü (YYYY-MM-DD) */
  day: string;
  /** 1 = pazartesi … 7 = pazar */
  weekday: number;
  /** ISO hafta: "2026-W44" */
  id: string;
  /** Geçen haftanın ISO kimliği */
  prevId: string;
  /** Bu haftanın pazartesisi */
  monday: string;
  /** Geçen hafta: pazartesi ve pazar (ikisi de dahil) */
  lastFrom: string;
  lastTo: string;
}

export interface WeeklySummary {
  week: WeekInfo;
  items: WeeklyItem[];
  /** Maddelerin üstündeki bağlam satırları (kasa cirosu, satış tahmini) */
  lines: string[];
  /** Okunamayan kaynaklar (dipnotta adlarıyla) */
  failed: WeeklySource[];
}

export const WEEKLY_MAX_ITEMS = 5;
/** Lira değeri olmayan madde en çok iki; varsa biri için yer kalır */
export const WEEKLY_MAX_PLAIN = 2;
export const WEEKLY_MIN_TL = 100;
export const WEEKLY_STOCK_MIN_TL = 500;
/** Geçen haftanın zayi ve ikramı önceki dört haftanın ortalamasının bu katını geçerse */
export const WEEKLY_WASTE_FACTOR = 1.5;
/** Pazartesi gidemezse en geç çarşamba (ISO haftanın günü) */
export const WEEKLY_LAST_WEEKDAY = 3;
/** İşin başından son an (maxDuration 60 sn) */
export const WEEKLY_DEADLINE_MS = 52_000;
/** Başlamak için kalması gereken en az süre: okuma 4 sn + gönderim 4 sn + pay */
export const WEEKLY_MIN_WINDOW_MS = 9_000;
/** Kaynak başına üst sınır (kaynaklar aynı anda okunur) */
export const WEEKLY_COLLECT_MS = 4_000;
/** Resend, tek deneme */
export const WEEKLY_SEND_MS = 4_000;
export const WEEKLY_HISTORY_WEEKS = 8;
/** Nakit planında ilk eksi gün en geç bugün + 13 */
export const WEEKLY_CASH_DAYS = 14;
/** Bakiye bundan eskiyse plana güvenilmez */
export const WEEKLY_BALANCE_MAX_AGE = 7;
/** Karaokede bundan az dolu blok madde olur */
export const WEEKLY_KARAOKE_EMPTY = 0.25;
/** Kasada bekleyen fiyat lira değeri yokken bu kadar gün beklediyse hatırlatılır */
export const WEEKLY_POS_MIN_DAYS = 3;
/** Kasa cirosu karşılaştırmasında "tam hafta": en az bu kadar raporlu gün */
export const WEEKLY_SALES_FULL_DAYS = 6;
/** "Gönderiliyor" işaretli kayıt bu kadar süre sonra yarıda kalmış sayılır */
export const WEEKLY_CLAIM_STALE_MS = 5 * 60_000;
export const WEEKLY_SETTINGS_KEY = "haftalik.settings";
export const WEEKLY_HISTORY_KEY = "haftalik.gecmis";
/** notification_log anahtarı: haftanın kaydı ("haftalik:2026-W44") ve örnekler ("haftalik-ornek:<ms>") */
export const WEEKLY_LOG_PREFIX = "haftalik:";
export const WEEKLY_SAMPLE_PREFIX = "haftalik-ornek:";

/** Gönderim kaydının hata sütunundaki işaretler */
export const CLAIM_SENDING = "Gönderiliyor";
export const CLAIM_RETRY = "Yeniden denenecek:";
export const CLAIM_UNCERTAIN = "Gönderim belirsiz:";

/** Lira değeri eşit maddelerin sırası */
export const VALUED_ORDER: WeeklySource[] = ["nakit", "zam", "kasa", "komisyon", "kasa-fiyat", "stok", "zayi"];
/** Lira değeri olmayan maddelerin sırası */
export const PLAIN_ORDER: WeeklySource[] = ["kasa", "karaoke", "kontrol", "zam", "kasa-fiyat", "komisyon"];

// ---------------------------------------------------------------- Ayar ve geçmiş (integration_state)

/** "haftalik.settings": açık / kapalı; yoksa açık */
export interface WeeklySettings {
  enabled: boolean;
  by?: string;
  at?: string;
}

/** "haftalik.gecmis": gönderilen haftalar ve maddelerinin anahtarları (en çok 8 hafta; yalnız sabah işi yazar) */
export interface WeeklyHistory {
  weeks: Record<string, { at: string; subject: string; keys: string[] }>;
}

/** Kayıtlı ayar; yoksa ya da bozuksa açık */
export function parseWeeklySettings(v: unknown): WeeklySettings {
  const x = v as Partial<WeeklySettings> | null | undefined;
  if (!x || typeof x !== "object" || typeof x.enabled !== "boolean") return { enabled: true };
  return { enabled: x.enabled, ...(typeof x.by === "string" ? { by: x.by } : {}), ...(typeof x.at === "string" ? { at: x.at } : {}) };
}

const WEEK_ID = /^\d{4}-W\d{2}$/;

/** Kayıtlı geçmiş; bozuk hafta atlanır, hiç yoksa boş */
export function parseWeeklyHistory(v: unknown): WeeklyHistory {
  const weeks: WeeklyHistory["weeks"] = {};
  const raw = (v as { weeks?: unknown } | null | undefined)?.weeks;
  if (!raw || typeof raw !== "object") return { weeks };
  for (const [id, w] of Object.entries(raw as Record<string, unknown>)) {
    const x = w as { at?: unknown; subject?: unknown; keys?: unknown } | null;
    if (!WEEK_ID.test(id) || !x || typeof x.at !== "string") continue;
    weeks[id] = { at: x.at, subject: typeof x.subject === "string" ? x.subject : "", keys: Array.isArray(x.keys) ? x.keys.filter((k): k is string => typeof k === "string") : [] };
  }
  return { weeks };
}

/** Geçmişin `keepFrom` haftasından (dahil) yenileri, en çok WEEKLY_HISTORY_WEEKS hafta */
export function pruneHistory(h: WeeklyHistory, keepFrom: string): WeeklyHistory {
  const ids = Object.keys(h.weeks)
    .filter((id) => id >= keepFrom)
    .sort()
    .reverse()
    .slice(0, WEEKLY_HISTORY_WEEKS);
  return { weeks: Object.fromEntries(ids.sort().map((id) => [id, h.weeks[id]])) };
}

// ---------------------------------------------------------------- Hafta

const utc = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
};

/** ISO haftanın günü: 1 = pazartesi … 7 = pazar (saat dilimi yok, tarih metninden) */
function isoWeekday(day: string): number {
  return ((new Date(utc(day)).getUTCDay() + 6) % 7) + 1;
}

/** Pazartesinin ISO haftası: yıl o haftanın perşembesinin yılı ("2026-12-28" → "2026-W53", "2027-01-04" → "2027-W01") */
export function isoWeekId(monday: string): string {
  const thursday = addDays(monday, 3);
  const year = Number(thursday.slice(0, 4));
  const dayOfYear = Math.round((utc(thursday) - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
  return `${year}-W${String(Math.floor((dayOfYear - 1) / 7) + 1).padStart(2, "0")}`;
}

/** İş günü (businessDate; gece 05:00'ten önce dün) → ISO haftası ve geçen haftanın aralığı */
export function weekInfo(day: string): WeekInfo {
  const weekday = isoWeekday(day);
  const monday = addDays(day, -(weekday - 1));
  const lastFrom = addDays(monday, -7);
  return { day, weekday, id: isoWeekId(monday), prevId: isoWeekId(lastFrom), monday, lastFrom, lastTo: addDays(monday, -1) };
}

// ---------------------------------------------------------------- Seçim

/** Maddenin taban tutarı (yapıcılar zaten uygular; burada güvence) */
const floorOf = (s: WeeklySource) => (s === "stok" ? WEEKLY_STOCK_MIN_TL : WEEKLY_MIN_TL);
const rank = (order: WeeklySource[], s: WeeklySource) => {
  const i = order.indexOf(s);
  return i < 0 ? order.length : i;
};

/**
 * Gönderilecek maddeler (en çok 5): taban altı lira değeri düşer; sabah e-postasının bugün ilk kez bildirdiği olgu
 * (`newsKeys` hepsi `sentToday`'de) düşer; bir kez gösterilen (`once`) daha önce gittiyse, lira değeri olmayan geçen
 * hafta gittiyse düşer. Her kaynaktan en büyüğü kalır. Lira değeri olanlar büyükten küçüğe (eşitlikte VALUED_ORDER),
 * olmayanlar PLAIN_ORDER'la sonda: en çok iki, varsa biri için yer kalır (4 + 1). Az madde doldurulmaz.
 */
export function selectItems(
  cands: readonly WeeklyItem[],
  o: { sentToday: ReadonlySet<string>; seenBefore: ReadonlySet<string>; lastWeek: ReadonlySet<string> },
): WeeklyItem[] {
  const kept = cands.filter((c) => {
    if (c.tl !== null && !(c.tl >= floorOf(c.source))) return false;
    if (c.newsKeys?.length && c.newsKeys.every((k) => o.sentToday.has(k))) return false;
    if (c.once && o.seenBefore.has(c.key)) return false;
    if (c.tl === null && o.lastWeek.has(c.key)) return false;
    return true;
  });
  const bySource = new Map<WeeklySource, WeeklyItem>();
  for (const c of kept) {
    const cur = bySource.get(c.source);
    if (!cur || (c.tl ?? -Infinity) > (cur.tl ?? -Infinity)) bySource.set(c.source, c);
  }
  const one = [...bySource.values()];
  const valued = one.filter((c) => c.tl !== null).sort((a, b) => b.tl! - a.tl! || rank(VALUED_ORDER, a.source) - rank(VALUED_ORDER, b.source));
  const plain = one.filter((c) => c.tl === null).sort((a, b) => rank(PLAIN_ORDER, a.source) - rank(PLAIN_ORDER, b.source));
  const plainTake = plain.length ? Math.min(plain.length, WEEKLY_MAX_PLAIN, Math.max(1, WEEKLY_MAX_ITEMS - valued.length)) : 0;
  const valuedTake = Math.min(valued.length, WEEKLY_MAX_ITEMS - plainTake);
  return [...valued.slice(0, valuedTake), ...plain.slice(0, plainTake)];
}

// ---------------------------------------------------------------- Gönderim kaydı ve karar

export type ClaimState = "free" | "sent" | "retry" | "busy" | "unknown";

/**
 * Haftanın notification_log satırına göre: yok → free; gitti → sent; Resend açıkça reddetti ("Yeniden denenecek: …")
 * → retry; gönderim sürüyor ("Gönderiliyor", 5 dakikadan yeni) → busy; öteki her şey (belirsiz gönderim, yarıda kalan
 * işlev) → unknown: ileti gitmiş olabilir, yeniden gönderilmez.
 */
export function claimStateOf(row: { ok: boolean; error: string | null; sentAt: string } | null, now: number): ClaimState {
  if (!row) return "free";
  if (row.ok) return "sent";
  if (row.error?.startsWith(CLAIM_RETRY)) return "retry";
  if (row.error === CLAIM_SENDING && now - Date.parse(row.sentAt) < WEEKLY_CLAIM_STALE_MS) return "busy";
  return "unknown";
}

export type WeeklyRunStatus = "sent" | "off" | "nokey" | "skip" | "late" | "retry" | "uncertain" | "norecipient" | "error";
export interface WeeklyRunResult {
  status: WeeklyRunStatus;
  weekday: number;
  error?: string;
  items?: number;
}

/**
 * Gönderime başlamadan: canlı değil, gün uygun değil (perşembe–pazar) ya da bu hafta gitti → skip; kapalı → off;
 * Resend yok → nokey; kalan süre yetmiyor → late (yarın yeniden).
 */
export function weeklyDecision(i: {
  now: number;
  deadlineAt: number;
  production: boolean;
  week: WeekInfo;
  enabled: boolean;
  emailConfigured: boolean;
  weekSent: boolean;
}): { run: true } | { run: false; result: WeeklyRunResult } {
  const stop = (status: WeeklyRunStatus) => ({ run: false as const, result: { status, weekday: i.week.weekday } });
  if (!i.production || i.week.weekday > WEEKLY_LAST_WEEKDAY || i.weekSent) return stop("skip");
  if (!i.enabled) return stop("off");
  if (!i.emailConfigured) return stop("nokey");
  if (i.deadlineAt - i.now < WEEKLY_MIN_WINDOW_MS) return stop("late");
  return { run: true };
}

/**
 * Sabah işinin `weekly` adımı (Ayarlar › Günlük işler; src/lib/job-health.ts STEP_LABELS.weekly). undefined: adım
 * yazılmaz (perşembe–pazar, bu hafta gitti, kapalıyken salı ve çarşamba). Yalnız `error` işi "Kısmen" yapar.
 */
export function weeklyStep(r: WeeklyRunResult): StepResult | undefined {
  const last = r.weekday >= WEEKLY_LAST_WEEKDAY;
  switch (r.status) {
    case "sent":
      return { code: "sent" };
    case "off":
    case "nokey":
      return r.weekday === 1 ? { code: r.status } : undefined;
    case "skip":
      return undefined;
    case "late":
      return last ? { code: "error", error: "süre yetmedi; bu haftanın özeti gönderilemedi" } : { code: "late" };
    case "retry":
      return { code: "error", error: `${r.error ?? "Resend iletiyi kabul etmedi"}; ${last ? "bu hafta gönderilemedi" : "yarın yeniden denenecek"}` };
    case "uncertain":
      return { code: "error", error: `gönderim belirsiz (${r.error ?? "Resend yanıt vermedi"}); e-posta gelmediyse Ödemeler'den örneği alın` };
    case "norecipient":
      return { code: "error", error: "etkin yönetici e-postası yok" };
    case "error":
      return { code: "error", error: r.error ?? "bilinmeyen hata" };
  }
}
