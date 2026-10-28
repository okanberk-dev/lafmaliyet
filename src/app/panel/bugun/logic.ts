// Bugün ekranının saf mantığı (sunucuda ve testlerde çalışır; veritabanı ve tarayıcı yok): günün işleri rol rol, her
// birinin durumu ve ilgili ekranın adresi, Şimdi / Sonra / Tamam bölümleri, sayfa başlığı, "Bugün kafede" satırları ve
// ekranın kendiliğinden yenileneceği an. Olguları sunucu toplar (src/server/data/today.ts); yöneticiye ait olgular
// personel için hiç yüklenmez. Satırların kuralları ve yeni satır ekleme: docs/BUGUN.md. Testler: tests/bugun.test.ts.

import { CASH_OUT_INVOICES_HREF } from "@/lib/cash-outs";
import { businessDate, carryChecks, CASH_EVENING_HOUR, DAY_TURN_HOUR, diffKind, diffText, isCashEvening, lateCorrections, type CashRevisionRow } from "@/lib/cash-report";
import { isStarted, itemsText, lateFinish, listState, listTitle, nowBusinessMinute, opensMinute, timeTR, whoText, type ChecklistLite } from "@/lib/checklists";
import { MONTH_NAMES } from "@/lib/constants";
import { unpricedNotice } from "@/lib/count-item";
import { money, monthLabel, num } from "@/lib/format";
import { staffForecastLines, type StaffForecastView } from "@/lib/forecast/text";
import { JOBS_HREF, systemAlerts, type JobHealth, type JobKey } from "@/lib/job-health";
import { isPlayable, phase, sessionEnd, sessionStart, trClock, type KaraokeSessionDTO } from "@/lib/karaoke/session";
import type { KasaName } from "@/lib/lafpos/kasa";
import { kasaName } from "@/lib/lafpos/switch";
import { holdAlert, HOLDS_HREF } from "@/lib/price-hold";
import { pendingSummary } from "@/lib/recipe-change";
import { addDays, dayMonthTR, longDateTR, shiftMonth, todayTR, type UpcomingItem } from "@/lib/reminders";
import { KIND_COUNT_LABEL, RETIRED_REQUEST_KINDS, waitedText, type StaffRequestKind } from "@/lib/staff-requests";

import type { TaskStatus } from "../dashboard-tasks";
import { COUNT_GRACE_DAYS, staffLateEditNotice, unpricedExtrasNotice, type StaffLateEdit, type UnpricedExtras } from "../sayim/logic";

import { checklistYesterday, posRow } from "./rows-ops";
import type { OpsDayFacts } from "./rows-ops";

/**
 * Satırların anahtarları. İkinci paketin grupları kendi satırlarını ekler (docs/planlar/CRITIQUE2.md R14): kontrol
 * `liste-dun`, `liste-{templateId}` ve okunamazsa `liste`; komisyon `komisyon`. Hızlı sayım ve mal siparişi satırları
 * (`hizli-sayim`, `mal-siparisi`, `mal-taslak`) 26 Eki 2026'da özellikleriyle birlikte kaldırıldı.
 */
export type DayTaskKey =
  | "isler"
  | "kasa-dun"
  | "liste-dun"
  | `liste-${number}`
  | "liste"
  | "odeme"
  | "komisyon"
  | "fatura"
  | "urun"
  | "fiyat-yok"
  | "onay"
  | "fiyat-onay"
  | "zam"
  | "modpos"
  | "sayim-gecen"
  | "sayim-personel"
  | "sayim-ek-fiyat"
  | "zayi"
  | "kasa"
  | "sayim-son";

export interface DayTask {
  key: DayTaskKey;
  title: string;
  /** Genel bakış'taki "Bu ayın işleri"yle aynı durumlar (done / todo / warn / later) */
  status: TaskStatus;
  /** Rozet; verilmezse durumun adı yazılır (Tamam, Yapılacak, Sorun var, Sonra) */
  badge?: string;
  /** Bir iki satırlık açıklama */
  detail: string;
  /** İlgili ekranın tam adresi (gün, ay, süzgeç, bölüm) */
  href: string;
  /** Bağlantının kısa adı, ör. "Raporu gir" */
  action: string;
}

/** Kasa raporunun Bugün'e giden kısmı (fotoğraf, kasadan çıkanlar, e-posta durumu gerekmez) */
export interface CashLite {
  date: string;
  cashDiff: number;
  zTotal: number;
  cash: number;
  card: number;
  submittedByName: string;
  revision: number;
  note: string | null;
  /** Yalnız yönetici: kasanın bütünlük uyarıları (CASH_FLAGS); varsa satır "sorun var" olur */
  flags?: string[];
}

/** Kasanın bütünlük uyarıları (kasa'nın carryChecks ve lateCorrections'ı; docs/KASA-RAPORU.md › Açılış ve devir) */
export const CASH_FLAGS = { carry: "Açılış devirle tutmuyor", late: "Ertesi gün düzeltildi" } as const;

/** Günün olguları. Yöneticiye ait alanlar personelin olgusunda hiç doldurulmaz; mantık da rolü ayrıca denetler */
export interface DayFacts {
  role: "admin" | "staff";
  now: Date;
  /**
   * LafPOS'a geçiş günü (iki rol; yalnız metinler: günün kasası "ModPOS" ya da "LafPOS", src/lib/lafpos/switch.ts
   * kasaName). Yoksa ya da null her metin bugünkü gibi ModPOS der
   */
  lafposSwitch?: string | null;
  /** Dünün ve bugünün (iş günü) raporu, ilk raporun günü; null: okunamadı */
  cash: { today: CashLite | null; yesterday: CashLite | null; firstDate: string | null } | null;
  /**
   * Yalnız personel: iş gününün zayi / ikram kayıtları (src/lib/waste.ts summarize özeti); `lafpos`: iş günü LafPOS
   * günü (ürün ikramı LafPOS'ta işaretlenir; yoksa ya da false bugünkü gibi)
   */
  waste?: { count: number; zayi: string | null; ikram: string | null; lafpos?: boolean } | null;
  /**
   * Bu ayın (takvim) sayılan / sayılacak kalemi; geçen ayın sayımı var mı (sayım ya da ek kalem) ve orada sayılan /
   * sayılacak kalem
   */
  stock: { month: string; counted: number; total: number; prevMonth: string; prevHasData: boolean; prevCounted: number; prevTotal: number } | null;
  // ---- Yalnız yönetici
  /** Günlük işlerin ciddi sorunları (ops'un sistem uyarıları, yalnız canlıda; systemIssues) */
  system?: { title: string; body: string }[] | null;
  /** Ödemeler & hatırlatıcılar listesi (loadUpcoming); null: okunamadı */
  payments?: UpcomingItem[] | null;
  /**
   * Geciken hakedişler (yemek kartı ve platformlar; src/server/data/commission.ts loadOverduePayouts): kanal, satış ayı
   * ve son gün, en eski son gün önce
   */
  commission?: { overdue: { label: string; month: string; due: string }[] } | null;
  /** Kontrol bekleyen faturalar */
  /**
   * Kontrol bekleyen faturalar; `stockOnly`: bunların kalemi hammaddeye bağlı ama mal alışı sayılmayanları (E-07);
   * `cashOuts`: kasadan faturalı alımlar, faturası Faturalar'da yok ve Aylık harcamalar'a yazılmadı (E-42; sayı ve
   * "Migros 2.400,00 ₺ ve 1 alım daha"); `duplicates`: Aylık harcamalar'a yazılmışken faturası sonradan gelenler (iki
   * kez sayılıyor)
   */
  invoices?: { review: number; stockOnly?: number; cashOuts?: { count: number; summary: string; duplicates?: number } | null } | null;
  /** Hammaddeye bağlanmayı bekleyen fatura ürünleri */
  unlinked?: number | null;
  /** Fiyatı girilmemiş hammaddeler (ilk birkaç ad) */
  unpriced?: { count: number; names: string[] } | null;
  /**
   * Onay bekleyenler: reçete değişiklikleri ve yeni ürün önerileri (ürün başına bir) ve ürün adları; personel
   * istekleri türüne göre (staff_requests) ve hepsinin en eskisinin anı (docs/ONAYLAR.md)
   */
  approvals?: { changes: number; newProducts: number; names: string[]; requests?: { kind: StaffRequestKind; count: number }[]; oldestAt?: string | null } | null;
  /** Paraşüt faturasında %40'tan fazla farklı gelen, onay bekleyen hammadde fiyatları */
  holds?: { count: number; items: { name: string; pct: number | null }[] } | null;
  /** Hammadde zammı uyarısı (priceAlert; Genel bakış ve zille aynı metin) ve fiyatına bakılacak ürün sayısı */
  prices?: { detail: string; href: string; count: number } | null;
  /**
   * Sayımın yöneticiye uyarıları (src/server/data/count-alerts.ts; zil ile aynı metin): bu ayın ve geçen ayın fiyatı
   * girilmemiş ek kalemleri ve personelin ay bittikten sonra geçen ayın sayımına yaptığı kayıtlar
   */
  countAlerts?: { extras: UnpricedExtras[]; late: { month: string; edits: StaffLateEdit[] } | null } | null;
  /**
   * Kasada (ModPOS) değişecek fiyatlar, en eskisinin anı ve bugünün kasası (operasyonun yükleyicisi,
   * src/server/data/today-ops.ts; LafPOS gününde yalnız siteye bağlı olmayan ürünler)
   */
  pos?: { count: number; oldest: string | null; kasa?: KasaName } | null;
  // ---- İkisi (kontrol listeleri)
  /** Dünün (iş günü) kontrol listeleri: tamamlanmayan ve sorunlu olan (docs/KONTROL-LISTELERI.md); personelde kendininkiler */
  checklistsYesterday?: { day: string; lists: ChecklistLite[] } | null;
  /** Bugünün (iş günü) kontrol listeleri; personelde yalnız personelin doldurabildikleri. null: okunamadı */
  checklists?: { day: string; lists: ChecklistLite[] } | null;
  // ---- İkisi (dalga 10; docs/planlar/personel-yetki.md)
  /** Operasyonun olguları (Tükendi, kasaya işle): tipi ve satırları rows-ops.ts'te */
  ops?: OpsDayFacts | null;
  /**
   * Dün kafe kapalı mıydı: yöneticinin onayladığı ya da personelin bildirdiği, onay bekleyen kapalı gün (özel günün
   * `kapali` satırı; src/server/closed-days.ts). Yoksa null
   */
  closed?: { yesterday: { state: "approved" | "pending" | "rejected"; by: string; requestId: number | null; note?: string | null } | null } | null;
}

/** Günün saatleri: takvim günü, iş günü (05:00'te döner), akşam, ayın günü ve sayımın ayları */
export interface DayContext {
  /** Takvim günü (Türkiye): ödemeler, hatırlatıcılar ve sayım */
  today: string;
  /** İş günü: kasa ve zayi (Kasa ve Zayi ekranlarıyla aynı) */
  day: string;
  yesterday: string;
  /** 20:00 ve sonrası ya da gece 05:00'ten önce: bugünün kasa raporu beklenir */
  evening: boolean;
  dayOfMonth: number;
  /** Takvim günü ayın son günü (ay sonu sayımı) */
  lastDay: boolean;
  month: string;
  prevMonth: string;
}

export function dayContext(now: Date): DayContext {
  const today = todayTR(now);
  const day = businessDate(now);
  const month = today.slice(0, 7);
  return {
    today,
    day,
    yesterday: addDays(day, -1),
    evening: isCashEvening(now),
    dayOfMonth: Number(today.slice(8, 10)),
    lastDay: addDays(today, 1).slice(0, 7) !== month,
    month,
    prevMonth: shiftMonth(month, -1),
  };
}

/** Metni en çok `max` karaktere kısaltır; kısalınca sonuna "…" (o da sayılır) */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Zayi / ikram özetinin en uzun hâli */
export const WASTE_SUMMARY_MAX = 140;

/** Cümle sonu: nokta, soru ya da üç nokta yoksa nokta eklenir */
const sentence = (s: string) => (/[.!?…]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/** Gece 05:00'ten önce iş günü dündür: kasa ve zayi açıklaması hangi güne baktığını tarihle söyler */
const dated = (c: DayContext, date: string, text: string) => (c.day !== c.today ? `${longDateTR(date)} · ${text}` : text);

/** Bir satırın kuralı: olgulardan satır (ya da satırlar), çıkmazsa null. Operasyonun satırları rows-ops.ts'te */
export type DayRow = (f: DayFacts, c: DayContext) => DayTask | DayTask[] | null;
type Row = DayRow;

// ---------------------------------------------------------------- Kasa

/** Bütünlük uyarıları için raporun gerekenleri (CashReportDTO bunları taşır) */
export type CashFlagReport = Parameters<typeof lateCorrections>[0] & { id: number };

/**
 * Yöneticinin kasa satırlarının bütünlük uyarıları, rapor gününe göre (kasa'nın kuralları, zil ile aynı;
 * docs/KASA-RAPORU.md › Açılış ve devir, Düzeltmeler). "Açılış devirle tutmuyor": açılış kendinden önceki raporun
 * ertesi güne devriyle tutmuyor; zincir `before`'dan, listenin en eski raporundan önceki son raporun devrinden başlar
 * (previousCarryOver), dünün raporu yoksa bugünün açılışı ondan önceki raporla karşılaştırılır. "Ertesi gün
 * düzeltildi": rapor iş günü kapandıktan sonra kasa alanı değiştirilerek düzeltildi; bakan yöneticinin (`viewer`)
 * kendi düzeltmesi sayılmaz. `revisions`: raporların kayıtlı önceki sürümleri. Listenin sırası önemsiz.
 */
export function cashFlags(
  reports: CashFlagReport[],
  before: { date: string; amount: number } | null,
  revisions: (CashRevisionRow & { reportId: number })[],
  viewer: number,
): Map<string, string[]> {
  const checks = carryChecks(reports, before);
  return new Map(
    reports.map((r) => {
      const late = r.revision > 1 && lateCorrections(r, revisions.filter((x) => x.reportId === r.id), viewer) !== null;
      return [r.date, [...(checks.has(r.date) ? [CASH_FLAGS.carry] : []), ...(late ? [CASH_FLAGS.late] : [])]];
    }),
  );
}

/** Eksik kasa ya da bütünlük uyarısı sorun, fazla yapılacak (bakılmalı), tutuyorsa tamam */
function cashStatus(r: CashLite): TaskStatus {
  const kind = diffKind(r.cashDiff);
  if (kind === "short" || r.flags?.length) return "warn";
  return kind === "over" ? "todo" : "done";
}

/** Rozet kasa farkıdır; kasa tutuyor ama bütünlük uyarısı varsa uyarı ("Kasa tutuyor" kırmızı rozette çelişirdi) */
function cashBadge(r: CashLite): string {
  return diffKind(r.cashDiff) === "even" && r.flags?.length ? r.flags[0] : diffText(r.cashDiff);
}

/** "Mehmet · Z 12.400 ₺ · nakit 3.100 ₺ · kart 9.300 ₺ · güncellendi · Not: …" (`full` değilse yalnız gönderen ve Z) */
function cashDetail(r: CashLite, full: boolean): string {
  const flags = r.flags ?? [];
  const parts = [`${r.submittedByName} · Z ${money(r.zTotal)}`];
  if (full) parts.push(`nakit ${money(r.cash)}`, `kart ${money(r.card)}`);
  // Ertesi gün düzeltildiyse "güncellendi" ayrıca yazılmaz
  if (full && r.revision > 1 && !flags.includes(CASH_FLAGS.late)) parts.push("güncellendi");
  if (flags.length && diffKind(r.cashDiff) === "even") parts.push(diffText(r.cashDiff));
  parts.push(...flags);
  if (full && r.note?.trim()) parts.push(`Not: ${clip(r.note.trim(), 120)}`);
  return parts.join(" · ");
}

/** Dünün raporu: yöneticiye farkı ve bütünlüğü; ikisine de girilmediyse (kasa kullanılmaya başladıysa) */
const cashYesterday: Row = (f, c) => {
  const admin = f.role === "admin";
  const title = "Dünkü kasa raporu";
  const href = `/panel/kasa?gun=${c.yesterday}`;
  if (!f.cash) return admin ? { key: "kasa-dun", title, status: "later", badge: "Okunamadı", detail: "Kasa raporları şu an okunamadı.", href: "/panel/kasa", action: "Kasa raporu" } : null;
  const r = f.cash.yesterday;
  if (r) return admin ? { key: "kasa-dun", title, status: cashStatus(r), badge: cashBadge(r), detail: dated(c, r.date, cashDetail(r, true)), href, action: "Rapora bak" } : null;
  // Kasa hiç kullanılmadıysa ya da ilk rapor dünden sonraysa dünün raporu beklenmez (kurulum sakin açılır)
  if (!f.cash.firstDate || c.yesterday < f.cash.firstDate) return null;
  // Dün kafe kapalıydı (dalga 10 §2.9): onaylıysa satır yok; bildirim bekliyorsa yöneticiye "Onaya bak", personele
  // "Onayda"; reddedildiyse personele yöneticinin notu
  const closed = f.closed?.yesterday ?? null;
  if (closed?.state === "approved") return null;
  if (closed?.state === "pending") {
    return admin
      ? {
          key: "kasa-dun",
          title,
          status: "todo",
          badge: "Onay bekliyor",
          detail: `${closed.by} ${longDateTR(c.yesterday)} için kafe kapalıydı dedi. Onaylamadan önce o günün ${kasaName(c.yesterday, f.lafposSwitch ?? null)} / banka POS'una bakın.`,
          href: closed.requestId ? `/panel/onaylar#istek-${closed.requestId}` : "/panel/onaylar",
          action: "Onaya bak",
        }
      : {
          key: "kasa-dun",
          title,
          status: "todo",
          badge: "Onayda",
          detail: `${closed.by} kapalıydı dedi (onay bekliyor). Kafe açıktıysa raporu bugün girin; yarından itibaren yöneticinin onayıyla girilir.`,
          href,
          action: "Dünü gir",
        };
  }
  if (closed?.state === "rejected" && !admin) {
    return {
      key: "kasa-dun",
      title,
      status: "todo",
      badge: "Girilmedi",
      detail: `Yönetici bildirimi reddetti${closed.note ? `: ${clip(closed.note, 120)}` : ""}. Raporu bugün girin.`,
      href,
      action: "Dünü gir",
    };
  }
  return admin
    ? {
        key: "kasa-dun",
        title,
        status: "todo",
        badge: "Girilmedi",
        detail: `${longDateTR(c.yesterday)} raporu girilmedi. Kafe açıktıysa personel bugün de girebilir; daha sonra yalnız sizin onayınızla girilir.`,
        href,
        action: "Raporu gir",
      }
    : {
        key: "kasa-dun",
        title,
        status: "todo",
        badge: "Girilmedi",
        // Yarından itibaren geç rapor (Z fotoğrafıyla, yöneticinin onayıyla; docs/KASA-RAPORU.md › Geç rapor)
        detail: `${longDateTR(c.yesterday)} raporu girilmedi. Kafe açıktıysa bugün girin; kapalıysa raporun sayfasında “Kafe kapalıydı” deyin. Yarından itibaren yöneticinin onayıyla girilir.`,
        href,
        action: "Dünü gir",
      };
};

/**
 * Personelin akşam kasa satırı ve zili (src/server/bell/kasa.ts): ModPOS gününde Z raporu ModPOS'tan alınır; LafPOS
 * gününde (geçiş gününden itibaren) LafPOS'ta "Günü kapat" gün sonunu panele gönderir, form ondan dolar
 */
export function eveningCashText(kasa: KasaName): string {
  return kasa === "LafPOS"
    ? "Kapanışta LafPOS'ta Günü kapat'a basın (gün sonu panele gönderilir), kasadaki nakdi sayıp girin."
    : "Kapanışta ModPOS'tan Z raporunu alın, kasadaki nakdi sayıp girin.";
}

/** Bugünün (iş günü) raporu: gündüz "Akşam", 20:00'den sonra yapılacak; gönderilince yöneticiye farkı */
const cashToday: Row = (f, c) => {
  const href = `/panel/kasa?gun=${c.day}`;
  if (f.role === "admin") {
    const title = "Bugünkü kasa raporu";
    // Okunamadıysa dünün satırı zaten söylüyor
    if (!f.cash) return null;
    const r = f.cash.today;
    if (r) return { key: "kasa", title, status: cashStatus(r), badge: cashBadge(r), detail: dated(c, r.date, cashDetail(r, false)), href, action: "Raporu aç" };
    if (c.evening) return { key: "kasa", title, status: "todo", badge: "Girilmedi", detail: dated(c, c.day, "Henüz girilmedi; personel kapanışta girer."), href, action: "Kasa raporu" };
    return { key: "kasa", title, status: "later", badge: "Akşam", detail: "Personel kapanışta girer.", href, action: "Kasa raporu" };
  }
  const title = "Kasa raporu";
  if (!f.cash) return { key: "kasa", title, status: "later", badge: "Okunamadı", detail: "Kasa raporları şu an okunamadı.", href: "/panel/kasa", action: "Kasa raporu" };
  const r = f.cash.today;
  if (r) return { key: "kasa", title, status: "done", badge: "Gönderildi", detail: dated(c, r.date, `${r.submittedByName} gönderdi · ${diffText(r.cashDiff)}`), href, action: "Raporu aç" };
  if (c.evening) return { key: "kasa", title, status: "todo", detail: dated(c, c.day, eveningCashText(kasaName(c.day, f.lafposSwitch ?? null))), href: "/panel/kasa", action: "Raporu gir" };
  return { key: "kasa", title, status: "later", badge: "Akşam", detail: "Kapanışta girilir: Z raporu ve kasa sayımı.", href: "/panel/kasa", action: "Kasa raporu" };
};

// ---------------------------------------------------------------- Zayi (personel)

/** Zayi / ikram: gün içinde bilgi, akşam rapordan önce yapılacak, rapor gönderilince tamam */
const wasteRow: Row = (f, c) => {
  const w = f.waste;
  if (!w) return null;
  const summary = clip([w.ikram ? `İkram: ${w.ikram}` : null, w.zayi ? `Zayi: ${w.zayi}` : null].filter(Boolean).join(" · "), WASTE_SUMMARY_MAX);
  const entries = w.count > 0 ? (summary ? `${num(w.count)} kayıt · ${summary}` : `${num(w.count)} kayıt`) : null;
  const base = { key: "zayi" as const, title: "Zayi & ikram", href: "/panel/zayi", action: "Zayi / ikram ekle" };
  if (f.cash?.today) return { ...base, status: "done", detail: dated(c, c.day, entries ?? "Bugün kayıt yok.") };
  if (c.evening) {
    return {
      ...base,
      status: "todo",
      badge: "Rapordan önce",
      detail: dated(
        c,
        c.day,
        entries
          ? `${sentence(entries)} Eksik varsa kasa raporundan önce ekleyin.`
          : w.lafpos
            ? "Bugün kayıt yok. Atılan bir şey ya da hammadde ikramı olduysa kasa raporundan önce girin; ürün ikramı LafPOS'ta işaretlenir."
            : "Bugün kayıt yok. Atılan ya da ikram edilen olduysa kasa raporundan önce girin.",
      ),
    };
  }
  const during = w.lafpos
    ? "Atılan, dökülen bir şey ya da hammadde ikramı olursa o an girin; ürün ikramı LafPOS'ta işaretlenir."
    : "Atılan, dökülen ya da ödenmeden verilen olursa o an girin; kasa raporuna geçer.";
  return { ...base, status: "later", badge: "Gün içinde", detail: entries ?? during };
};

// ---------------------------------------------------------------- Sayım (ikisi)

/**
 * Ayın ilk 10 gününde geçen ayın sayımı yoksa ya da yarım kaldıysa (Stok sayımı ekranının açılış ayı kuralıyla aynı:
 * sayim/logic.ts defaultCountMonth, tamam = countStatus). Ay sonu sayımı kapanıştan sonra yapılır, çoğu zaman ertesi
 * sabah biter: gece yarısı "Ay sonu stok sayımı" satırı kalkınca yarım sayım burada sürer ve geçen aya götürür. Ay
 * adreste sabittir (ekran ay vermeyen açılışı çözülen aya yönlendirir); kalan kalemler yanlış aya yazılmaz.
 */
const countPrevious: Row = (f, c) => {
  const s = f.stock;
  if (!s || c.dayOfMonth > COUNT_GRACE_DAYS) return null;
  const base = { key: "sayim-gecen" as const, title: "Geçen ayın stok sayımı", href: `/panel/sayim?ay=${s.prevMonth}` };
  const month = monthLabel(s.prevMonth);
  if (!s.prevHasData) {
    return {
      ...base,
      status: "todo",
      badge: "Girilmedi",
      detail: f.role === "admin" ? `${month} sayımı yok: devreden stok 0 sayılır, alınan malın tamamı o ayın maliyeti olur.` : `${month} ay sonu sayımı girilmedi; buradan girebilirsiniz.`,
      action: "Sayım gir",
    };
  }
  if (s.prevCounted >= s.prevTotal) return null;
  const progress = `${num(s.prevCounted)} / ${num(s.prevTotal)}`;
  return {
    ...base,
    status: "todo",
    badge: progress,
    detail:
      f.role === "admin"
        ? `${month} sayımı yarım kaldı: ${progress} kalem sayıldı, kalanların stoğu 0 sayılır.`
        : `${month} ay sonu sayımı yarım kaldı: ${progress} kalem sayıldı; kalanları da girin.`,
    action: "Sayıma devam",
  };
};

/**
 * Personel geçen ayın sayımını ay bittikten sonra değiştirdi (yalnız yönetici; zil ile aynı metin). Son kayıt son üç iş
 * gününde olduğu sürece satır; sonrası yalnız zilde kalır.
 */
const countStaffEdit: Row = (f, c) => {
  const late = f.countAlerts?.late;
  const n = late ? staffLateEditNotice(late.month, late.edits) : null;
  if (!n || businessDate(new Date(n.lastAt)) < addDays(c.day, -2)) return null;
  return { key: "sayim-personel", title: n.title, status: "todo", badge: "Kontrol et", detail: n.body, href: n.href, action: "Sayıma bak" };
};

/** Sayımda fiyatı girilmemiş ek kalemler, bu ay ve geçen ay (yalnız yönetici; zil ile aynı metin, denetim E-22) */
const countExtrasPrice: Row = (f) => {
  const notices = (f.countAlerts?.extras ?? []).flatMap((u) => {
    const n = unpricedExtrasNotice(u);
    return n ? [{ u, n }] : [];
  });
  if (!notices.length) return null;
  const total = notices.reduce((a, x) => a + x.u.count, 0);
  return {
    key: "sayim-ek-fiyat",
    title: "Sayımda fiyatı olmayan ek kalemler",
    status: "todo",
    badge: `${num(total)} kalem`,
    detail: notices.length === 1 ? `${notices[0].n.title}: ${notices[0].n.body}` : `${notices.map((x) => x.n.title).join(" · ")}. Birim fiyatı girilmezse kapanış stoğuna 0 ₺ girer.`,
    href: notices[0].n.href,
    action: "Fiyatı gir",
  };
};

/** Ayın son günü (takvim): sayımın ilerlemesi, sayım formundaki "n / toplam kalem sayıldı" ile aynı kural */
const countMonthEnd: Row = (f, c) => {
  const s = f.stock;
  if (!c.lastDay || !s || s.total <= 0) return null;
  const base = { key: "sayim-son" as const, title: "Ay sonu stok sayımı", href: `/panel/sayim?ay=${s.month}` };
  if (s.counted <= 0) return { ...base, status: "todo", badge: "Bugün", detail: "Bugün ayın son günü: kapanıştan sonra sayın. Telefondan grup grup girilir.", action: "Sayıma başla" };
  if (s.counted < s.total) {
    const progress = `${num(s.counted)} / ${num(s.total)}`;
    return { ...base, status: "todo", badge: progress, detail: `${progress} kalem sayıldı; kalanları da girin.`, action: "Sayıma devam" };
  }
  return { ...base, status: "done", detail: `${num(s.total)} kalemin hepsi sayıldı.`, action: "Sayımı aç" };
};

// ---------------------------------------------------------------- Kontrol listeleri (ikisi)

/** Bugünün listesinin satırı (docs/BUGUN.md › Kontrol listeleri): aralıktan önce sonra, aralıkta yapılacak, son saatten sonra gecikti */
function listRow(f: DayFacts, day: string, l: ChecklistLite, nowBm: number): DayTask {
  const admin = f.role === "admin";
  const run = l.run;
  const base = { key: `liste-${l.templateId}` as const, title: listTitle(l.name), href: `/panel/kontrol/${l.templateId}` };
  const state = listState(l, nowBm, false);
  const started = isStarted(l);
  const progress = run ? `${num(run.done)} / ${num(run.required)}` : `0 / ${num(l.required)}`;
  if (state === "done" && run) {
    const who = [whoText(run.contributors), run.completedAt ? timeTR(run.completedAt) : null].filter(Boolean).join(" · ");
    const open = run.issues.filter((x) => x.open);
    if (open.length && admin) {
      return { ...base, status: "warn", badge: `${num(open.length)} sorun`, detail: clip(`${who} · ${open.map((x) => x.text).join("; ")}`, 140), action: "Listeye bak" };
    }
    if (open.length) return { ...base, status: "done", badge: "Tamam", detail: `${who} · ${num(open.length)} sorun bildirildi`, action: "Listeye bak" };
    const late = lateFinish({ date: day, dueAt: l.dueAt, completedAt: run.completedAt }) ? " · geç" : "";
    return { ...base, status: "done", badge: "Tamam", detail: `${who}${late}${run.photos ? ` · ${num(run.photos)} fotoğraf` : ""}`, action: "Listeye bak" };
  }
  if (state === "overdue") {
    const detail = started ? `${progress} madde · son saat ${l.dueAt} idi.` : `Henüz başlanmadı · son saat ${l.dueAt} idi.`;
    return { ...base, status: "warn", badge: "Gecikti", detail: admin ? detail : `${detail} Gün 05:00'te kapanır.`, action: started ? "Devam et" : "Listeyi aç" };
  }
  if (started && run) {
    const left = run.photosLeft ? ` ${num(run.photosLeft)} fotoğraf kaldı.` : "";
    return { ...base, status: "todo", badge: progress, detail: `${progress} madde · ${whoText(run.contributors)} · son saat ${l.dueAt}.${left}`, action: "Devam et" };
  }
  if (state === "before") {
    return { ...base, status: "later", badge: `${l.opensAt}–${l.dueAt}`, detail: `${itemsText(l)} · ${l.opensAt} – ${l.dueAt} arası.`, action: "Listeyi aç" };
  }
  return { ...base, status: "todo", detail: `${itemsText(l)} · son saat ${l.dueAt}.`, action: "Listeyi aç" };
}

/** Bugünün kontrol listeleri, açılış saatine göre; okunamadıysa tek gri satır */
const checklistRows: Row = (f) => {
  const c = f.checklists;
  if (c === undefined) return null;
  if (c === null) {
    return { key: "liste", title: "Kontrol listeleri", status: "later", badge: "Okunamadı", detail: "Kontrol listeleri şu an okunamadı.", href: "/panel/kontrol", action: "Kontrol listeleri" };
  }
  const nowBm = nowBusinessMinute(f.now);
  return [...c.lists].sort((a, b) => opensMinute(a.opensAt) - opensMinute(b.opensAt)).map((l) => listRow(f, c.day, l, nowBm));
};

// ---------------------------------------------------------------- Yalnız yönetici

/**
 * `isler` satırının uyarıları (yalnız canlıda): ops'un sistem uyarılarının ciddileri, Genel bakış şeridindekiler
 * (src/lib/job-health.ts systemAlerts). Zil ve şerit Paraşüt işinin eşitleme hatasını zilin kendi "Paraşüt eşitlemesi
 * başarısız" satırına bırakır; Bugün'de öyle bir satır yok (Faturalar satırı eşitlemeyi sormaz), bu yüzden uyarılar o
 * yinelenme denetimi olmadan alınır. Bunun yerine Paraşüt işinin hatası ya da yarıda kesilmesi, o çalışmadan sonra
 * başlayan bir eşitleme başarılı olunca düşer (sabah işinin yeniden denemesi ya da Paraşüt › Şimdi eşitle; zilin
 * eşitleme satırı da o an kalkar): yapılacak bir şey kalmamışken ertesi sabaha kadar "sorun var" denmez.
 * `lastSyncOkAt`: günlük eşitlemenin (tedarikçi geçmişi hariç) son başarılı çalışmasının başlangıcı.
 */
export function systemIssues(
  o: { production: boolean; cronSecret: boolean; health: Record<JobKey, JobHealth> },
  now: Date,
  lastSyncOkAt: string | null,
): { title: string; body: string }[] {
  const run = o.health.parasut.run;
  const synced = run !== null && lastSyncOkAt !== null && Date.parse(lastSyncOkAt) > Date.parse(run.startedAt);
  return systemAlerts({ production: o.production, cronSecret: o.cronSecret, now, health: o.health, parasutSyncErrorAt: null })
    .filter((a) => a.level === "danger" && !(synced && a.id.startsWith("is-parasut-")))
    .map(({ title, body }) => ({ title, body }));
}

/** Günlük işlerin ciddi sorunları (sabah işi çalışmadı / hata verdi, Paraşüt işi hata verdi, CRON_SECRET yok) */
const systemRow: Row = (f) => {
  const items = f.system;
  if (!items?.length) return null;
  const [first, ...rest] = items;
  return {
    key: "isler",
    title: "Günlük işler",
    status: "warn",
    badge: rest.length ? `${num(items.length)} sorun` : undefined,
    detail: `${first.title}: ${sentence(first.body)}${rest.length ? ` Ayrıca: ${rest.map((r) => r.title).join(", ")}.` : ""}`,
    href: JOBS_HREF,
    action: "Günlük işlere bak",
  };
};

/** Tutarı bilinenlerin toplamı parantez içinde (hiçbirinin tutarı yoksa yazılmaz) */
function amountOf(items: UpcomingItem[]): string {
  const total = items.reduce((a, i) => a + (i.amount ?? 0), 0);
  return total > 0 ? ` (${money(total)})` : "";
}

/** Ödemeler: geciken sorun, bugünkü yapılacak, ikisi de yoksa tamam (yaklaşanlar bilgi olarak) */
const paymentsRow: Row = (f) => {
  const base = { key: "odeme" as const, title: "Ödemeler", href: "/panel/hatirlaticilar" };
  const items = f.payments;
  if (!items) return { ...base, status: "later", badge: "Okunamadı", detail: "Ödeme listesi şu an okunamadı.", action: "Ödemeler" };
  const overdue = items.filter((i) => i.status === "overdue");
  const today = items.filter((i) => i.status === "today");
  const soon = items.filter((i) => i.status === "soon");
  if (overdue.length) {
    return {
      ...base,
      status: "warn",
      badge: `${num(overdue.length)} gecikti`,
      detail: `${num(overdue.length)} ödeme gecikti${amountOf(overdue)}. Ödendiyse işaretleyin.${today.length ? ` Bugün: ${num(today.length)} ödeme${amountOf(today)}.` : ""}`,
      action: "Ödemelere bak",
    };
  }
  if (today.length) {
    const titles = `${today
      .slice(0, 2)
      .map((i) => i.title)
      .join(", ")}${today.length > 2 ? "…" : ""}`;
    return { ...base, status: "todo", badge: "Bugün", detail: `${num(today.length)} ödeme bugün${amountOf(today)}: ${titles}`, action: "Ödemelere bak" };
  }
  return { ...base, status: "done", detail: `Bugün ödenecek yok.${soon.length ? ` Yaklaşan ${num(soon.length)} ödeme${amountOf(soon)}.` : ""}`, action: "Ödemeler" };
};

/**
 * Hakedişler (docs/KOMISYON.md): ödeme süresi geçen ve "Hakediş geldi" işaretlenmeyen yemek kartı ya da platform
 * hakedişi varsa; yoksa satır çıkmaz. En eski son gün yazılır. Ay, Komisyon & hakediş'teki gibi hakedişin satış ayıdır
 * (platformda son gün 90 güne kadar sonra); bu yıldan değilse yılıyla.
 */
const commissionRow: Row = (f, c) => {
  const list = f.role === "admin" ? f.commission?.overdue : null;
  if (!list?.length) return null;
  const [first] = list;
  const name = MONTH_NAMES[Number(first.month.slice(5, 7)) - 1];
  const month = first.month.slice(0, 4) === c.today.slice(0, 4) ? name : monthLabel(first.month);
  const more = list.length > 1 ? ` ${num(list.length - 1)} hakediş daha gecikti.` : "";
  return {
    key: "komisyon",
    title: "Hakedişler",
    status: "warn",
    badge: `${num(list.length)} gecikti`,
    detail: `${first.label} hakedişi (${month} satışları): son gün ${dayMonthTR(first.due)}.${more} Geldiyse işaretleyin.`,
    href: "/panel/komisyonlar",
    action: "Hakedişlere bak",
  };
};

/**
 * Faturalar: kontrol bekleyenler. Paraşüt eşitlemesinin hatası burada değil, `isler` satırında (ops'un sistem
 * uyarıları; docs/planlar/CRITIQUE.md §3 today): aynı hata iki satırda yazılmaz.
 */
const invoicesRow: Row = (f) => {
  const inv = f.invoices;
  if (!inv) return null;
  // Kasadan faturalı alımlar (E-42): faturası Faturalar'da yok, hiçbir hesaba girmedi; ya da Aylık harcamalar'a
  // yazılmışken faturası geldi, iki kez sayılıyor
  const cash = inv.cashOuts?.count || inv.cashOuts?.duplicates ? inv.cashOuts : null;
  const twice = cash?.duplicates ?? 0;
  const cashText = cash
    ? [
        cash.count
          ? `${num(cash.count)} kasadan faturalı alım Faturalar'da yok (${cash.summary}): Faturalar'a ekleyin ya da Aylık harcamalar'a yazın, yoksa gelir-gidere girmez`
          : "",
        twice ? `${num(twice)} kasa alımı iki kez sayılıyor (Aylık harcamalar'a yazılmıştı, faturası sonra geldi): gider kaydını silin` : "",
      ]
        .filter(Boolean)
        .join("; ")
    : "";
  const cashCount = (cash?.count ?? 0) + twice;
  if (inv.review > 0) {
    const stockOnly = Math.min(inv.stockOnly ?? 0, inv.review);
    const guessed = inv.review - stockOnly;
    // Stoğa girip gelir-gidere girmeyen (kalemi hammaddeye bağlı, kategorisi mal alışı değil) tek dokunuşla onaylanmaz
    const why = [
      guessed ? `${stockOnly ? `${num(guessed)} faturanın ` : ""}kategorisi tahminle yazıldı, doğruysa tek dokunuşla onaylayın` : "",
      stockOnly ? `${num(stockOnly)} fatura mal alışı sayılmıyor (kalemi hammaddeye bağlı): kategorisini mal alışı yapın ya da bilerek böyleyse Kalsın deyin` : "",
    ].filter(Boolean);
    return {
      key: "fatura",
      title: "Faturalar",
      status: "todo",
      badge: `${num(inv.review + cashCount)} kontrol`,
      detail: `${num(inv.review)} fatura kontrol bekliyor: ${why.join("; ")}.${cash ? ` Ayrıca ${cashText}.` : ""}`,
      href: "/panel/faturalar?durum=kontrol",
      action: "Kontrol et",
    };
  }
  if (cash) {
    return {
      key: "fatura",
      title: "Faturalar",
      status: "todo",
      badge: `${num(cashCount)} kasa alımı`,
      detail: `${cashText.charAt(0).toLocaleUpperCase("tr-TR")}${cashText.slice(1)}.`,
      href: CASH_OUT_INVOICES_HREF,
      action: "Kontrol et",
    };
  }
  return { key: "fatura", title: "Faturalar", status: "done", detail: "Kontrol bekleyen fatura yok.", href: "/panel/faturalar", action: "Faturalar" };
};

const unlinkedRow: Row = (f) => {
  const n = f.unlinked ?? 0;
  if (n <= 0) return null;
  return {
    key: "urun",
    title: "Ürün bağlantıları",
    status: "todo",
    badge: `${num(n)} bekliyor`,
    detail: `${num(n)} fatura ürünü hammaddeye bağlanmayı bekliyor; bir kez bağlanınca fiyat ve miktar sonraki faturalardan kendiliğinden gelir.`,
    href: "/panel/parasut?durum=bekleyen",
    action: "Bağla",
  };
};

/** Fiyatı girilmemiş hammaddeler (çoğu sayımda "Listeye ekle" ile eklenen kalem; zil ile aynı metin) */
const unpricedRow: Row = (f) => {
  const u = f.unpriced;
  if (!u || u.count <= 0) return null;
  return {
    key: "fiyat-yok",
    title: "Fiyatı girilmemiş hammaddeler",
    status: "todo",
    badge: `${num(u.count)} hammadde`,
    detail: unpricedNotice(u.count, u.names).body,
    href: "/panel/hammaddeler?durum=fiyatsiz",
    action: "Fiyatı gir",
  };
};

/** Onay satırında türlerin sırası: kasa istekleri, reçete önerileri, zayi istekleri */
const KASA_KINDS: StaffRequestKind[] = ["kasa-duzeltme", "kasa-silme", "kasa-gec", "kasa-cikan", "foto-kaldir", "kapali-gun"];
const OPS_KINDS: StaffRequestKind[] = ["zayi-gec", "zayi-sil"];

/**
 * Onaylar (yönetici): reçete önerileri ve personel istekleri. İstek yoksa reçete metni ("Personelin önerdiği 2 reçete
 * değişikliği … onay bekliyor: Latte, …"); varsa türler tek satırda ve en eskisinin beklediği ("1 kasa düzeltmesi ·
 * 2 reçete değişikliği · 1 geç zayi / ikram · en eskisi 2 gündür"). Kaldırılan türler (eski mal siparişi taslağı)
 * sayılmaz: yükleyici de okumaz, satır yine de onlarla şişmez. Tutar yok.
 */
const approvalsRow: Row = (f) => {
  const a = f.role === "admin" ? f.approvals : null;
  const retired: readonly StaffRequestKind[] = RETIRED_REQUEST_KINDS;
  const requests = (a?.requests ?? []).filter((r) => r.count > 0 && !retired.includes(r.kind));
  const asked = requests.reduce((n, r) => n + r.count, 0);
  const n = (a?.changes ?? 0) + (a?.newProducts ?? 0) + asked;
  if (!a || n <= 0) return null;
  const base = { key: "onay" as const, title: "Onaylar", status: "todo" as const, badge: `${num(n)} bekliyor`, href: "/panel/onaylar", action: "İncele" };
  if (!asked) {
    const names = a.names.slice(0, 3).join(", ");
    return { ...base, detail: `Personelin önerdiği ${pendingSummary(a.changes, a.newProducts)}${names ? `: ${names}${a.names.length > 3 ? "…" : ""}` : "."}` };
  }
  const count = (kinds: StaffRequestKind[]) =>
    kinds.flatMap((k) => {
      const c = requests.filter((r) => r.kind === k).reduce((x, r) => x + r.count, 0);
      return c ? [`${num(c)} ${KIND_COUNT_LABEL[k]}`] : [];
    });
  const parts = [
    ...count(KASA_KINDS),
    ...(a.changes ? [`${num(a.changes)} reçete değişikliği`] : []),
    ...(a.newProducts ? [`${num(a.newProducts)} yeni ürün önerisi`] : []),
    ...count(OPS_KINDS),
  ];
  const oldest = a.oldestAt ? ` · en eskisi ${waitedText(new Date(a.oldestAt), f.now)}` : "";
  return { ...base, detail: `${parts.join(" · ")}${oldest}` };
};

/** Onay bekleyen hammadde fiyatları (Genel bakış'taki uyarıyla aynı metin) */
const holdsRow: Row = (f) => {
  const h = f.holds;
  const alert = h && h.count > 0 ? holdAlert(h.items) : null;
  if (!h || !alert) return null;
  return { key: "fiyat-onay", title: "Fiyat onayı", status: "todo", badge: `${num(h.count)} hammadde`, detail: alert.detail, href: HOLDS_HREF, action: "İncele" };
};

const pricesRow: Row = (f) => {
  const p = f.prices;
  if (!p) return null;
  return { key: "zam", title: "Hammadde zammı", status: "todo", badge: `${num(p.count)} ürün`, detail: p.detail, href: p.href, action: "Fiyatlara bak" };
};

/**
 * Yöneticinin satır sırası (Şimdi / Sonra / Tamamlananlar bölümlerinde de korunur). Yorumdaki yuvalar ikinci paketin
 * satırlarıdır (docs/planlar/CRITIQUE2.md R14; olgusu, fonksiyonu ve testiyle o gruplar ekler).
 */
const ADMIN_ROWS: Row[] = [
  systemRow, // isler
  cashYesterday, // kasa-dun
  checklistYesterday, // liste-dun
  paymentsRow, // odeme
  commissionRow, // komisyon
  invoicesRow, // fatura
  unlinkedRow, // urun
  unpricedRow, // fiyat-yok
  approvalsRow, // onay
  holdsRow, // fiyat-onay
  pricesRow, // zam
  posRow, // modpos
  countPrevious, // sayim-gecen
  countStaffEdit, // sayim-personel
  countExtrasPrice, // sayim-ek-fiyat
  checklistRows, // liste-{templateId} (açılış saatine göre)
  cashToday, // kasa
  countMonthEnd, // sayim-son
];

/**
 * Personelin satır sırası; yönetici satırları burada hiç yok. Operasyonun satırları (rows-ops.ts) personelin olgusu
 * gelince çıkar: dünün listeleri ve kasadaki fiyatlar
 */
const STAFF_ROWS: Row[] = [
  cashYesterday, // kasa-dun
  checklistYesterday, // liste-dun
  countPrevious, // sayim-gecen
  checklistRows, // liste-{templateId} (açılış saatine göre)
  posRow, // modpos
  wasteRow, // zayi
  cashToday, // kasa
  countMonthEnd, // sayim-son
];

/** Günün işleri, rolün sırasıyla */
export function dayTasks(f: DayFacts): DayTask[] {
  const c = dayContext(f.now);
  return (f.role === "admin" ? ADMIN_ROWS : STAFF_ROWS).flatMap((row) => row(f, c) ?? []);
}

/**
 * Ekrandaki bölümler: Şimdi (sorunlu ve yapılacak), Sonra (zamanı gelmemiş), Tamamlananlar; her biri günün sırasıyla.
 * Sıradaki iş: ilk sorunlu, yoksa ilk yapılacak. Açık bir kontrol listesi varken sabahtan beri geciken liste ("Gecikti")
 * sıradaki iş olmaz: gece kapanışta önce süresi işleyen Kapanış listesi, gecikmiş Açılış listesi arkasından. Dünün
 * kontrol listeleri (`liste-dun`; geçmişe bakmak) başka yapılacak ya da sorunlu satır varken sıradaki olmaz (iki rolde).
 */
export function splitTasks(tasks: DayTask[]): { now: DayTask[]; later: DayTask[]; done: DayTask[]; next: DayTask | null } {
  const isList = (t: DayTask) => t.key.startsWith("liste-") && t.key !== "liste-dun";
  const open = (t: DayTask) => t.status === "warn" || t.status === "todo";
  const othersOpen = tasks.some((t) => open(t) && t.key !== "liste-dun");
  const eligible = tasks.filter((t) => !(t.key === "liste-dun" && othersOpen));
  const openList = eligible.find((t) => t.status === "todo" && isList(t));
  const urgent = eligible.find((t) => t.status === "warn" && !(openList && isList(t) && t.badge === "Gecikti"));
  return {
    now: tasks.filter(open),
    later: tasks.filter((t) => t.status === "later"),
    done: tasks.filter((t) => t.status === "done"),
    next: urgent ?? openList ?? eligible.find((t) => t.status === "warn") ?? eligible.find((t) => t.status === "todo") ?? null,
  };
}

/** Sayfa başlığının özeti: "3 iş bekliyor (1 sorun)", "Şimdilik iş yok · 2 iş sonra", "Bugünün işleri tamam" (+ hatırlatıcı) */
export function daySummary(tasks: DayTask[], reminders: number): { open: number; warn: number; later: number; done: number; total: number; headline: string } {
  const count = (s: TaskStatus) => tasks.filter((t) => t.status === s).length;
  const warn = count("warn");
  const open = count("todo") + warn;
  const later = count("later");
  const head = open ? `${num(open)} iş bekliyor${warn ? ` (${num(warn)} sorun)` : ""}` : later ? `Şimdilik iş yok · ${num(later)} iş sonra` : "Bugünün işleri tamam";
  return { open, warn, later, done: count("done"), total: tasks.length, headline: reminders > 0 ? `${head} · ${num(reminders)} hatırlatıcı` : head };
}

// ---------------------------------------------------------------- Bugün kafede

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Türkiye UTC+3, yaz saati yok (panelin her yerindeki varsayım) */
const TR_OFFSET_MS = 3 * HOUR_MS;

/** İş gününün aralığı: [gün 05:00, ertesi gün 05:00) Türkiye saatiyle */
export function businessDayRange(day: string): { from: Date; to: Date } {
  const from = Date.parse(`${day}T00:00:00Z`) - TR_OFFSET_MS + DAY_TURN_HOUR * HOUR_MS;
  return { from: new Date(from), to: new Date(from + DAY_MS) };
}

export interface KaraokeToday {
  /** Sitenin rezervasyonları ve bar ekranından açılan rezervasyonsuz oturumlar (iptal ve ödenmemiş tutma sayılmaz) */
  reservations: number;
  walkIns: number;
  /** Süren oturum: bitiş saati (uzatmalar dahil), süresi doldu mu */
  active: { until: string; overtime: boolean } | null;
  /** Sıradaki oturum */
  next: { time: string; guests: number | null; name: string | null } | null;
  /** Kartın değişeceği sıradaki an (bir oturumun başlaması ya da bitmesi; kendiliğinden yenileme), yoksa null */
  changeAt: number | null;
}

/** İş gününde başlayan oturumların özeti (tutar hiçbir rolde taşınmaz) */
export function karaokeToday(sessions: KaraokeSessionDTO[], day: string, nowMs: number): KaraokeToday {
  const { from, to } = businessDayRange(day);
  const list = sessions
    .filter((s) => {
      const p = phase(s, nowMs);
      const start = sessionStart(s);
      return isPlayable(s) && p !== "cancelled" && p !== "held" && start >= from.getTime() && start < to.getTime();
    })
    .sort((a, b) => sessionStart(a) - sessionStart(b) || a.id - b.id);
  // Süresi dolup bitirilmeyen oturum önce: bar ekranında alarmı çalıyor, odaya haber verilmeli
  const active = list.find((s) => phase(s, nowMs) === "overtime") ?? list.find((s) => phase(s, nowMs) === "active") ?? null;
  const next = list.find((s) => phase(s, nowMs) === "upcoming") ?? null;
  const changes = list
    .filter((s) => phase(s, nowMs) === "upcoming" || phase(s, nowMs) === "active")
    .flatMap((s) => [sessionStart(s), sessionEnd(s)])
    .filter((t) => t > nowMs);
  return {
    reservations: list.filter((s) => s.source === "site").length,
    walkIns: list.filter((s) => s.source === "panel").length,
    active: active ? { until: trClock(sessionEnd(active)).time, overtime: phase(active, nowMs) === "overtime" } : null,
    next: next ? { time: trClock(sessionStart(next)).time, guests: next.guests, name: next.customerName } : null,
    changeAt: changes.length ? Math.min(...changes) : null,
  };
}

/** Uygulama siparişleri: sitenin son listesinin kopyasından yalnız sayılar (ad, tutar taşınmaz) */
export interface OrdersLite {
  /** Listenin son doğrulandığı an: panelin siteden son başarılı çekmesi (liste değişmese de) */
  at: string | null;
  /** Hazırlanacaklar (yeni ve hazırlanan) */
  open: number;
  /** Tezgâhta teslim bekleyen gel-al'lar */
  ready: number;
}

/** Sipariş listesinin kopyası bundan eskiyse sayı gösterilmez (bağlantı kopmuş olabilir) */
export const ORDERS_FRESH_MS = 30 * 60_000;

export interface CafeLine {
  key: "yogunluk" | "tatli" | "oda" | "karaoke" | "siradaki" | "siparis" | "tukendi";
  text: string;
  tone: "info" | "warn";
  /** Satırın götürdüğü adres; verilmezse bar ekranı (tahmin satırları bağlantısız) */
  href?: string;
}

/**
 * "Bugün kafede" kartının satırları. laffogato.net bağlantısı kurulu değilse ve bugün oturum yoksa karaoke satırı
 * yazılmaz; liste boşsa kart çizilmez. Tutar hiçbir rolde yazılmaz. `busy`: personelin satış tahmini görünümü
 * (yoğunluk ve tatlı sayısı, tutarsız; docs/SATIS-TAHMINI.md); verilirse satırları başta. `extra`: operasyonun
 * satırları (Tükendi; rows-ops.ts soldOutLine), sonda.
 */
export function cafeLines(
  i: { karaoke: KaraokeToday | null; orders: OrdersLite | null; configured: boolean },
  nowMs: number,
  busy?: StaffForecastView | null,
  extra: CafeLine[] = [],
): CafeLine[] {
  // Yoğunluk satırı personelin Özel günler ekranına götürür (maç, AVM etkinliği, kampanya; dalga 10 §2.9)
  const out: CafeLine[] = busy ? staffForecastLines(busy).map((l) => (l.key === "yogunluk" ? { ...l, href: "/panel/ozel-gunler" } : l)) : [];
  const k = i.karaoke;
  const any = k ? k.reservations + k.walkIns > 0 : false;
  if (k && (i.configured || any)) {
    if (k.active) out.push(k.active.overtime ? { key: "oda", text: "Süre doldu: odaya haber verin", tone: "warn" } : { key: "oda", text: `Oda dolu · bitiş ${k.active.until}`, tone: "info" });
    const counts = [k.reservations ? `${num(k.reservations)} rezervasyon` : "rezervasyon yok", k.walkIns ? `${num(k.walkIns)} rezervasyonsuz` : null].filter(Boolean).join(" · ");
    out.push({ key: "karaoke", text: any ? `Bugün ${counts}` : "Bugün karaoke rezervasyonu yok", tone: "info" });
    if (k.next) out.push({ key: "siradaki", text: [`Sıradaki ${k.next.time}`, k.next.guests ? `${num(k.next.guests)} kişi` : null, k.next.name?.trim() || null].filter(Boolean).join(" · "), tone: "info" });
  }
  const o = i.orders;
  const fresh = Boolean(o?.at && nowMs - Date.parse(o.at) <= ORDERS_FRESH_MS);
  if (i.configured && o && fresh && (o.open > 0 || o.ready > 0)) {
    const text = o.open > 0 ? `${num(o.open)} açık uygulama siparişi${o.ready > 0 ? ` · ${num(o.ready)} teslime hazır` : ""}` : `${num(o.ready)} uygulama siparişi teslime hazır`;
    out.push({ key: "siparis", text, tone: "info" });
  }
  return [...out, ...extra];
}

// ---------------------------------------------------------------- Kendiliğinden yenileme

/** Satırların değiştiği saatler (Türkiye): gece yarısı (takvim günü), 05:00 (iş günü) ve 20:00 (akşam) */
const REFRESH_HOURS = [0, DAY_TURN_HOUR, CASH_EVENING_HOUR];

/**
 * Ekranın kendiliğinden yenileneceği an (epoch ms): sıradaki 00:00, 05:00 ya da 20:00 (Türkiye); `extra` verilirse
 * (ör. karaoke oturumunun başlaması / bitmesi, ikinci paketin kontrol listelerinin saatleri) ondan önceyse o.
 */
export function nextRefreshAt(now: Date, extra: number[] = []): number {
  const t = now.getTime();
  const midnight = Math.floor((t + TR_OFFSET_MS) / DAY_MS) * DAY_MS - TR_OFFSET_MS;
  const marks = [0, 1].flatMap((d) => REFRESH_HOURS.map((h) => midnight + d * DAY_MS + h * HOUR_MS));
  return Math.min(...[...marks, ...extra].filter((x) => Number.isFinite(x) && x > t));
}
