import { z } from "zod";

import { money } from "./format";
import { addDays, dayMonthTR, daysBetween, longDateTR } from "./reminders";

/**
 * Kapalı gün ve personelin özel günleri (saf; plan docs/planlar/personel-yetki.md §2.9; docs/SATIS-TAHMINI.md ›
 * Personelin özel günleri, docs/KASA-RAPORU.md › Kafe kapalıydı). Tek kavram: özel günlerin `kapali` satırı. Personel
 * yalnız dün için "Kafe kapalıydı" der (yöneticinin onayıyla, kanıta karşı); ileri tarihli maç, AVM etkinliği,
 * kampanya ve diğerini onaysız ekler (sınırlı). Kanıt sayıları, kırmızı kural, sınırlar ve metinler burada; testler
 * tests/kapali-gun.test.ts.
 */

// ---------------------------------------------------------------- Kapalı günler

/** Özel günün tarih aralığı ve türü (special_days) */
export interface SpecialRange {
  kind: string;
  dateFrom: string;
  dateTo: string;
}

/**
 * [from, to] içindeki kapalı işaretli günler, artan sırayla ve tekrarsız. Raporu olan gün kapalı sayılmaz (kafe o gün
 * açılmış; ay bilgisi, komisyon ve eksik rapor listesi kapalı günü raporlu günün önüne koymaz).
 */
export function closedDaysIn(special: readonly SpecialRange[], from: string, to: string, reported: Iterable<string> = []): string[] {
  if (from > to) return [];
  const have = new Set(reported);
  const days = new Set<string>();
  for (const r of special) {
    if (r.kind !== "kapali" || r.dateTo < from || r.dateFrom > to) continue;
    for (let d = r.dateFrom < from ? from : r.dateFrom; d <= r.dateTo && d <= to; d = addDays(d, 1)) if (!have.has(d)) days.add(d);
  }
  return [...days].sort();
}

/** Üst üste günleri aralıklara toplar: ["3","4","5","9"] → [{3,5},{9,9}] (yöneticinin kartlarında "3 gün üst üste") */
export function consecutiveRuns(days: readonly string[]): { from: string; to: string; days: string[] }[] {
  const out: { from: string; to: string; days: string[] }[] = [];
  for (const d of [...new Set(days)].sort()) {
    const last = out[out.length - 1];
    if (last && addDays(last.to, 1) === d) {
      last.to = d;
      last.days.push(d);
    } else out.push({ from: d, to: d, days: [d] });
  }
  return out;
}

// ---------------------------------------------------------------- Kanıt

/**
 * İşlem geçmişinde kanıt sayılmayan personel işlemleri (adın başıyla): hesap, parola, iki adımlı doğrulama, kurtarma
 * kodları, diğer cihazlar, oturum, bildirim ayarı, hatırlatıcı, özel gün ve kapalı gün. Kalan her yazım (silme kayıtları
 * dahil) o gün panelde çalışıldığını gösterir.
 */
export const EVIDENCE_IGNORED_ACTIONS: readonly string[] = [
  "Hesap",
  "Parola",
  "Hatalı parola",
  "İki adımlı",
  "Kurtarma",
  "Diğer cihazlar",
  "Oturumlar",
  "Bildirim",
  "Hatırlatıcı",
  "Özel gün",
  "Kapalı gün",
];

/** Bu işlem kapalı gün için kanıt sayılır mı */
export function isEvidenceAction(action: string): boolean {
  return !EVIDENCE_IGNORED_ACTIONS.some((p) => action.startsWith(p));
}

/** Bir günün panelde ve sitede bıraktığı izler (closedDayEvidence sayar; tutar yok) */
export interface ClosedEvidence {
  /** Kasa raporu var */
  report: boolean;
  cashOuts: number;
  waste: number;
  /** Açılan kontrol listesi */
  checklists: number;
  /** Karaoke oturumu (iş günü penceresinde başlayan, iptal edilmemiş) */
  karaoke: number;
  /** Personelin İşlem geçmişindeki yazımları (iş günü penceresinde; hesap ve hatırlatıcı hariç) */
  staffWrites: number;
  /**
   * Aynı şubenin önceki ve sonraki raporunun Z no'ları arasında bu güne düşen boşluk (şube başına, mergeBranchContinuity):
   * "red" kesin, "warn" arada başka raporsuz gün var
   */
  zGap: { level: "red" | "warn"; text: string } | null;
  /** Aynı şubenin sonraki raporunun açılışı önceki raporunun devriyle tutmuyor (yalnız uyarı) */
  opening: { ok: boolean; text: string } | null;
  /** Sitenin sayıları (null: okunamadı ya da bağlantı kapalı; yönetici kartı ayrı sorar) */
  site?: { cafe: number; manual: number; counter: number; shop: number } | null;
  /**
   * LafPOS'un o günkü gün sonu (denetim E-36; yalnız LafPOS günlerinde, geçiş günü seçili ve gün ondan önce değilse):
   * Z no, fiş sayısı ve Z toplamı. Geçiş günü boşken ya da gün ondan önceyse hep null (deneme günleri kanıt değil)
   */
  lafpos?: { zNo: number; receipts: number; zTotal: number } | null;
}

export const EMPTY_EVIDENCE: ClosedEvidence = { report: false, cashOuts: 0, waste: 0, checklists: 0, karaoke: 0, staffWrites: 0, zGap: null, opening: null };

/** Kanıtın satırları: kırmızı (onayı kapatır), uyarı ve bilgi; tutar yazılmaz */
export interface EvidenceLines {
  red: string[];
  warn: string[];
  info: string[];
}

/**
 * Kanıtın yönetici kartındaki satırları. Kırmızı (onay kapalı): kasa raporu, LafPOS'ta satışlı gün sonu, kasadan
 * çıkan, zayi / ikram, açılan kontrol listesi, karaoke, personelin işlem geçmişi yazımı, Z no boşluğu, sitede kafe, elle
 * girilen ya da kasada ödenen sipariş. Uyarı: açılış devri, arada başka raporsuz gün varken Z boşluğu, LafPOS'ta satışsız
 * gün sonu. Bilgi: mağaza kolisi. Tutar yazılmaz (LafPOS'ta yalnız Z no ve fiş sayısı).
 */
export function closedEvidenceText(e: ClosedEvidence): EvidenceLines {
  const red: string[] = [];
  const warn: string[] = [];
  const info: string[] = [];
  if (e.report) red.push("Kasa raporu girilmiş");
  if (e.lafpos) (lafposSold(e.lafpos) ? red : warn).push(lafposEvidenceText(e.lafpos));
  if (e.cashOuts) red.push(`${e.cashOuts} kasadan çıkan satırı`);
  if (e.waste) red.push(`${e.waste} zayi / ikram kaydı`);
  if (e.checklists) red.push(`${e.checklists} kontrol listesi açılmış`);
  if (e.karaoke) red.push(`${e.karaoke} karaoke oturumu`);
  if (e.staffWrites) red.push(`İşlem geçmişinde personelin ${e.staffWrites} kaydı`);
  if (e.zGap) (e.zGap.level === "red" ? red : warn).push(e.zGap.text);
  if (e.opening && !e.opening.ok) warn.push(e.opening.text);
  else if (e.opening) info.push(e.opening.text);
  if (e.site) {
    if (e.site.cafe) red.push(`Sitede ${e.site.cafe} kafe siparişi`);
    if (e.site.manual) red.push(`Panelden elle girilen ${e.site.manual} sipariş`);
    if (e.site.counter) red.push(`Kasada ödenen ${e.site.counter} uygulama siparişi`);
    if (e.site.shop) info.push(`Sitede ${e.site.shop} mağaza siparişi (kargo; kafe açıklığını göstermez)`);
  }
  return { red, warn, info };
}

/** LafPOS'un gün sonunda satış var mı (fiş ya da Z toplamı): kafe açıktı */
export function lafposSold(z: NonNullable<ClosedEvidence["lafpos"]>): boolean {
  return z.receipts > 0 || z.zTotal > 0;
}

/** "LafPOS'ta Z 14 · 63 fiş" (tutar yok); satışsız gün sonu "LafPOS'ta Z 14 alınmış, satış yok" */
export function lafposEvidenceText(z: NonNullable<ClosedEvidence["lafpos"]>): string {
  return lafposSold(z) ? `LafPOS'ta Z ${z.zNo}${z.receipts > 0 ? ` · ${z.receipts} fiş` : ""}` : `LafPOS'ta Z ${z.zNo} alınmış, satış yok`;
}

/**
 * Panelde iz var mı (personelin isteği yalnız iz yokken açılır; site sayılmaz, yönetici kartında ayrı). LafPOS'un
 * satışlı gün sonu da iz sayılır (yalnız LafPOS günlerinde gelir; E-36)
 */
export function hasPanelEvidence(e: ClosedEvidence): boolean {
  return e.report || (e.lafpos ? lafposSold(e.lafpos) : false) || e.cashOuts > 0 || e.waste > 0 || e.checklists > 0 || e.karaoke > 0 || e.staffWrites > 0 || e.zGap?.level === "red";
}

const zNumber = (z: string | null | undefined): number | null => {
  const t = (z ?? "").trim();
  return /^\d+$/.test(t) ? Number(t) : null;
};

/**
 * Z no sürekliliği: önceki ve sonraki raporun Z no'ları arasındaki boşluk. Boşluk arada raporsuz (ve kapalı işaretli
 * olmayan) öteki günlerin sayısından büyükse bu güne de bir Z düşmüştür (kırmızı); değilse uyarı. Z no sayı değilse ya
 * da komşu yoksa yargı yok.
 */
export function zGapOf(
  date: string,
  prev: { date: string; zNo: string | null } | null,
  next: { date: string; zNo: string | null } | null,
  otherOpenDays: number,
): ClosedEvidence["zGap"] {
  const p = zNumber(prev?.zNo);
  const q = zNumber(next?.zNo);
  if (p === null || q === null || !prev || !next) return null;
  const gap = q - p - 1;
  if (gap <= 0) return null;
  const text = `Z no ${prev.zNo} (${dayMonthTR(prev.date)}) ile ${next.zNo} (${dayMonthTR(next.date)}) arasında ${gap} Z eksik`;
  return gap > otherOpenDays ? { level: "red", text } : { level: "warn", text: `${text}; arada raporsuz başka gün de var` };
}

/** Açılış sürekliliği: "25 Eki açılışı 23 Eki devriyle tutuyor" ya da "… 600 ₺ az" */
export function openingText(prev: { date: string; carry: number } | null, next: { date: string; opening: number } | null): ClosedEvidence["opening"] {
  if (!prev || !next) return null;
  const diff = Math.round((next.opening - prev.carry) * 100) / 100;
  const head = `${dayMonthTR(next.date)} açılışı ${dayMonthTR(prev.date)} devriyle`;
  if (Math.abs(diff) < 1) return { ok: true, text: `${head} tutuyor` };
  return { ok: false, text: `${head} tutmuyor: ${money(Math.abs(diff))} ${diff < 0 ? "az" : "fazla"}` };
}

/**
 * Şube şube bakılan Z no ve açılış süreklilikleri tek kanıtta (docs/SUBE.md › Kasa raporu "Tümü"de): her şubenin Z
 * sırası ve devri yalnız kendi raporlarıyla karşılaştırılır (Tuzla'nın Z'si Marina'nınkiyle değil), kapalı gün ise
 * işletmenindir. Z boşluğu herhangi bir şubede kırmızıysa kırmızı, yoksa ilk uyarı; açılış ilk tutmayan, yoksa ilk
 * tutan. Şubesiz (hiç komşu raporu olmayan) gün için ikisi de null.
 */
export function mergeBranchContinuity(parts: readonly Pick<ClosedEvidence, "zGap" | "opening">[]): Pick<ClosedEvidence, "zGap" | "opening"> {
  const zGap = parts.find((p) => p.zGap?.level === "red")?.zGap ?? parts.find((p) => p.zGap)?.zGap ?? null;
  const opening = parts.find((p) => p.opening && !p.opening.ok)?.opening ?? parts.find((p) => p.opening)?.opening ?? null;
  return { zGap, opening };
}

// ---------------------------------------------------------------- Kapalı gün bildirimi

export const CLOSED_REASON_MAX = 60;
/** Kişinin son 30 günde açabildiği bildirim */
export const CLOSED_REQUESTS_PER_30 = 3;

/** `kapali-gun` isteğinin yükü */
export const ClosedDayPayload = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(CLOSED_REASON_MAX).nullable(),
});
export type ClosedDayPayloadT = z.output<typeof ClosedDayPayload>;

/** İsteğin başlığı (tutarsız): "23 Ekim kapalı gün" */
export const closedTitle = (date: string) => `${dayMonthTR(date)} kapalı gün`;
/** Kapalı satırının adı (Satış tahmini › Özel günler) */
export const closedSpecialTitle = (reason: string | null) => (reason?.trim() ? reason.trim().slice(0, 60) : "Kafe kapalı");

export const CLOSED_TEXT = {
  onlyYesterday: "Yalnız dün için kafe kapalıydı diyebilirsiniz",
  evidence: "O gün panelde kayıt var; kafe açık görünüyor. Raporu girin ya da yöneticiye söyleyin.",
  already: "Bu gün için bildiriminiz var",
  rejected: "Yönetici bu gün için bildirimi reddetti; raporu girin",
  approved: "Bu gün zaten kapalı işaretli",
  tooMany: "Son 30 günde en çok 3 kapalı gün bildirebilirsiniz; yöneticiye yazın",
  withdrawOnce: "Kapalı gün bildirimi günde bir kez geri çekilebilir",
  adminOnly: "Yönetici doğrudan işaretler",
  red: "O gün kayıt var; kapalı onaylanamaz. Raporu girdirin ya da reddedin",
  reportExists: "Bu günün kasa raporu var; kafe açık",
  refusal: "Bu gün kafe kapalı işaretli; kayıt girilemez. Kapalı değilse yöneticiye söyleyin",
  future: "Bugün ya da ileri bir gün kapalı işaretlenemez",
} as const;

/** Personelin kasa sayfasındaki pencere metni */
export const closedDialogText = (date: string) =>
  `Yönetici onaylayınca ${longDateTR(date)} için eksik kasa raporu ve kontrol listesi uyarıları kalkar. Kafe açıktıysa bunun yerine raporu girin.`;

/** Personelin zil satırı: "23 Eki Per: kapalı gün onaylandı" */
export function closedBellTitle(shortDay: string, status: "approved" | "rejected" | "revoked" | "superseded" | "expired"): string {
  const verb = { approved: "onaylandı", rejected: "reddedildi", revoked: "geri alındı", superseded: "kapandı", expired: "süresi doldu" }[status];
  return `${shortDay}: kapalı gün ${verb}`;
}

// ---------------------------------------------------------------- Personelin özel günleri

/** Personelin seçebildiği türler ve etkiler (kapalı yok; ±%30 yöneticinin) */
export const STAFF_SPECIAL_KINDS = ["derbi", "avm", "kampanya", "diger"] as const;
export type StaffSpecialKind = (typeof STAFF_SPECIAL_KINDS)[number];
export const STAFF_EFFECTS = [0.15, 0, -0.15] as const;

export const STAFF_SPECIAL_LIMITS = {
  /** En geç bugünden bu kadar gün ileriye */
  aheadDays: 60,
  /** Bir özel gün en çok bu kadar gün sürer */
  maxSpan: 3,
  /** Kişinin gelecekte kapsadığı günler toplamı */
  futureDays: 14,
  /** Personelin iş gününde en çok yazımı (ekleme, düzeltme, silme; hepsi birlikte) */
  dailyWrites: 20,
} as const;

export const STAFF_SPECIAL_TEXT = {
  title: "Ad gerekli",
  order: "Bitiş başlangıçtan önce olamaz",
  span: "En çok 3 gün seçilebilir",
  ahead: "En çok 60 gün ileriye girilebilir",
  tomorrow: "Özel gün yarından itibaren girilebilir",
  overlap: (name: string) => `Bu günlerde zaten bir özel gün var: ${name}`,
  future: "Gelecekte en çok 14 gün işaretleyebilirsiniz",
  locked: "Başlamış ya da yöneticinin düzenlediği özel gün değiştirilemez",
  daily: "Bugün en çok 20 değişiklik yapılabilir; yarın yeniden deneyin",
  kind: "Bu türü yönetici girer",
  effect: "Etkiyi listeden seçin",
  adminDirect: "Yönetici özel günleri Satış tahmini'nde düzenler",
} as const;

export interface StaffSpecialInput {
  kind: string;
  title: string;
  dateFrom: string;
  dateTo: string;
  effect: number;
}

/**
 * Personelin özel gün girdisi geçerli mi (null: evet). `ctx`: iş günü, kişinin bu satır dışındaki gelecekte kapsadığı
 * günler (bugünden sonra), bu satır dışında aralıkla çakışan özel günlerin adları, bugünkü yazım sayısı; düzenlemede satır
 * başlamış mı, yönetici dokunmuş mu.
 */
export function staffSpecialCheck(
  input: StaffSpecialInput,
  ctx: { today: string; ownFutureDays: number; overlapping: readonly string[]; writesToday: number; editing?: { started: boolean; adminTouched: boolean; own: boolean } | null },
): string | null {
  const L = STAFF_SPECIAL_LIMITS;
  const T = STAFF_SPECIAL_TEXT;
  if (ctx.writesToday >= L.dailyWrites) return T.daily;
  if (ctx.editing && (ctx.editing.started || ctx.editing.adminTouched || !ctx.editing.own)) return T.locked;
  if (!(STAFF_SPECIAL_KINDS as readonly string[]).includes(input.kind)) return T.kind;
  if (!(STAFF_EFFECTS as readonly number[]).some((e) => Math.abs(e - input.effect) < 1e-9)) return T.effect;
  if (!input.title.trim()) return T.title;
  if (input.dateTo < input.dateFrom) return T.order;
  if (input.dateFrom <= ctx.today) return T.tomorrow;
  if (daysBetween(input.dateFrom, input.dateTo) + 1 > L.maxSpan) return T.span;
  if (input.dateTo > addDays(ctx.today, L.aheadDays)) return T.ahead;
  if (ctx.overlapping.length) return T.overlap(ctx.overlapping[0]);
  if (ctx.ownFutureDays + daysBetween(input.dateFrom, input.dateTo) + 1 > L.futureDays) return T.future;
  return null;
}

/** Personelin listesindeki ikinci satır: "25 Eki Cmt · Derbi / maç · +%15 · Ahmet ekledi" (tutar ve not yok) */
export function staffSpecialLine(range: string, tail: string, addedBy: string | null): string {
  return [range, tail, addedBy ? `${addedBy} ekledi` : null].filter(Boolean).join(" · ");
}
