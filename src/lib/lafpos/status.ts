import { z } from "zod";

import { dateTimeTR } from "@/lib/format";
import { addDays, dayLocativeTR, dayMonthTR } from "@/lib/reminders";

import { dayMonthYearTR, daysUntilText, isLafposDay } from "./switch";

/**
 * LafPOS bağlantısının durumu (docs/LAFPOS.md › Durum ve onarım; saf, testleri tests/lafpos.test.ts): `POST /api/pos/gun`
 * her sonucu `integration_state`'in "lafpos" satırına yazar (src/server/lafpos/status.ts), Ayarlar'daki "LafPOS (kasa)"
 * kartı buradaki özetle okur. Reddedilen gün sonu iz bırakır: son başarılı gün, son ret (durum, hata, alan, gün, Z),
 * güne göre açık retler ve imzası doğrulanamayan isteklerin sayacı.
 *
 * LafPOS 400 ve 409'u kalıcı sayar, kendisi yeniden denemez (giden kutusunda bir yıl bekletir): gün ancak LafPOS'ta
 * elle yeniden gönderilince gelir (LAFPOS_RESEND_PATH). Bu yüzden günlü 400 ve 409 güne göre saklanır (`rejections`):
 * sonraki günün başarılı gönderimi ya da başka bir günün reddi onu örtmez; yalnız o günün yeniden yazılması kapatır.
 */

/** integration_state anahtarı */
export const LAFPOS_STATE_KEY = "lafpos";

/** Son yazılan gün sonu */
export interface LafposOk {
  at: string;
  date: string;
  zNo: number | null;
  lines: number;
  /** Gün geçiş gününden önce değil: hesaplara giriyor */
  counted: boolean;
}

/** İmzası doğrulanmış ama yazılmamış son gönderim (400, 409, 500) */
export interface LafposRejection {
  at: string;
  status: number;
  error: string;
  /** 400: ilk sorunlu alanın yolu */
  field: string | null;
  date: string | null;
  /** 409: paneldeki Z no */
  zNo: number | null;
  /** 409: LafPOS'un gönderdiği Z no */
  sentZNo: number | null;
  /** Yönetici o günün kaydını sildi (409'un çözümü); gün LafPOS'tan elle yeniden gönderilince yazılır */
  clearedAt: string | null;
  /** 409 wrong_branch: kasanın gönderdiği şube ve panelin beklediği (eski kayıtta yok) */
  sube?: string | null;
  expected?: string | null;
}

/** LafPOS'ta reddedilen ya da silinen günü yeniden gönderen yol (LafPOS kendisi yeniden denemez) */
export const LAFPOS_RESEND_PATH = "LafPOS'ta Kasa › Geçmiş günler › o günün Z raporu › Gönder";

/** LafPOS'un reddi yeniden denemediğinin ve elle gönderimin cümlesi (kart, silme penceresi) */
export const LAFPOS_RESEND_HINT = `LafPOS reddedilen ya da silinen günü kendisi yeniden göndermez: ${LAFPOS_RESEND_PATH}'e basın.`;

/** Güne göre saklanan açık retlerin üst sınırı (en eskisi düşer) */
export const MAX_DAY_REJECTIONS = 10;

/** İmzası doğrulanamayan istekler (401, 413): yalnız sayaç ve zaman; gövde okunmaz, ayrıntı saklanmaz */
export interface LafposUnverified {
  count: number;
  lastAt: string;
  lastStatus: number;
}

export interface LafposState {
  lastOk: LafposOk | null;
  /** Son ret, her türü (kart bundan yalnız güne bağlanamayanı gösterir: 500 ve gövdesi okunamayan 400) */
  lastError: LafposRejection | null;
  /** Günlü 400 ve 409, güne göre: o gün yeniden yazılınca (200) ya da en çok MAX_DAY_REJECTIONS'ı aşınca düşer */
  rejections: Record<string, LafposRejection>;
  unverified: LafposUnverified | null;
}

const okSchema = z.object({
  at: z.string(),
  date: z.string(),
  zNo: z.number().nullable().catch(null),
  lines: z.number().catch(0),
  counted: z.boolean().catch(false),
});
const rejectionSchema = z.object({
  at: z.string(),
  status: z.number(),
  error: z.string(),
  field: z.string().nullable().catch(null),
  date: z.string().nullable().catch(null),
  zNo: z.number().nullable().catch(null),
  sentZNo: z.number().nullable().catch(null),
  clearedAt: z.string().nullable().catch(null),
  sube: z.string().nullable().optional().catch(null),
  expected: z.string().nullable().optional().catch(null),
});
const unverifiedSchema = z.object({ count: z.number(), lastAt: z.string(), lastStatus: z.number() });

/** Kayıtlı değer (bozuk parça yok sayılır, öteki parçalar kalır) */
export function parseLafposState(v: unknown): LafposState {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const part = <T>(schema: z.ZodType<T>, x: unknown): T | null => {
    const r = schema.safeParse(x);
    return r.success ? r.data : null;
  };
  const rejections: Record<string, LafposRejection> = {};
  if (o.rejections && typeof o.rejections === "object") {
    for (const [date, x] of Object.entries(o.rejections as Record<string, unknown>)) {
      const r = part(rejectionSchema, x);
      if (r && /^\d{4}-\d{2}-\d{2}$/.test(date)) rejections[date] = { ...r, date };
    }
  }
  return { lastOk: part(okSchema, o.lastOk), lastError: part(rejectionSchema, o.lastError), rejections, unverified: part(unverifiedSchema, o.unverified) };
}

/** Günlü ret mi (400 ya da 409, günü okunmuş): güne göre izlenir */
export function isDayRejection(e: LafposRejection): e is LafposRejection & { date: string } {
  return e.date !== null && e.error !== "server_error";
}

/** Günün retini ekler (aynı günün eskisinin yerine); MAX_DAY_REJECTIONS'ı aşarsa en eski anlı düşer */
export function withDayRejection(cur: Record<string, LafposRejection>, e: LafposRejection & { date: string }, max = MAX_DAY_REJECTIONS): Record<string, LafposRejection> {
  const all = Object.values({ ...cur, [e.date]: e }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (b.date ?? "").localeCompare(a.date ?? ""));
  return Object.fromEntries(all.slice(0, max).map((x) => [x.date, x]));
}

/** Retin gününün paneldeki kaydı (pos_day_reports; yoksa null) */
export type RejectionDay = { zNo: number; lines: number; receivedAt: string } | null;

/**
 * Günlü retin durumu, o günün paneldeki kaydına göre (son başarılı gönderimin gününe değil):
 * - "resolved": gün retten sonra yeniden yazıldı (LafPOS düzeltip gönderdi);
 * - "cleared": yönetici kaydı sildi ya da 409'un günü panelde yok; gün LafPOS'tan elle gönderilmeyi bekliyor;
 * - "open": ret duruyor (409'da panelde eski Z, 400'de eski kayıt ya da hiçbir şey).
 */
export function dayRejectionStatus(e: LafposRejection, day: Pick<NonNullable<RejectionDay>, "receivedAt"> | null): "open" | "cleared" | "resolved" {
  if (day && Date.parse(day.receivedAt) > Date.parse(e.at) && (e.clearedAt === null || Date.parse(day.receivedAt) > Date.parse(e.clearedAt))) return "resolved";
  if (e.clearedAt !== null || (e.error === "z_conflict" && !day)) return "cleared";
  return "open";
}

/** Gövdeden günü ve Z no'yu okur (yalnız durum kaydı için; sözleşme denetimi day.ts'te). Okunamazsa null */
export function peekPosDay(raw: string): { date: string | null; zNo: number | null } {
  try {
    const o = JSON.parse(raw) as { date?: unknown; z?: { zNo?: unknown } };
    const date = typeof o?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null;
    const zNo = typeof o?.z?.zNo === "number" && Number.isFinite(o.z.zNo) ? o.z.zNo : null;
    return { date, zNo };
  } catch {
    return { date: null, zNo: null };
  }
}

/** "26 Ekim" (yıl bu yılsa yazılmaz) */
const dayText = (d: string, today: string) => (d.slice(0, 4) === today.slice(0, 4) ? dayMonthTR(d) : dayMonthYearTR(d));

/** Son retin kullanıcıya metni (yöneticiye; Ayarlar kartı) */
export function rejectionText(e: LafposRejection, today: string): string {
  const day = e.date ? dayText(e.date, today) : null;
  switch (e.error) {
    case "z_conflict":
      return `${day ?? "O gün"} için panelde Z ${e.zNo ?? "?"} kayıtlı; LafPOS ${e.sentZNo !== null ? `Z ${e.sentZNo}` : "başka bir Z"} gönderdi, hiçbir şey yazılmadı. LafPOS'taki doğruysa bu günün kaydını silin, sonra ${LAFPOS_RESEND_PATH}'e basın (LafPOS reddedilen günü kendisi yeniden denemez); LafPOS'taki fazlaysa orada düzeltin.`;
    case "invalid":
      return `Gün sonu sözleşmeye uymadı${day ? ` (${day})` : ""}: ilk sorunlu alan ${e.field ?? "bilinmiyor"}. Hiçbir şey yazılmadı; LafPOS'un sürümü panelle uyumlu mu? Düzeltilince ${LAFPOS_RESEND_PATH}'e basın (LafPOS kendisi yeniden denemez).`;
    case "wrong_branch":
      return `LafPOS'un kasası${e.sube ? ` "${e.sube}"` : " başka bir"} şubeye ayarlı${day ? ` (${day})` : ""}; panel LafPOS'un gün sonunu ${e.expected ? `"${e.expected}"` : "LafPOS'un"} şubesi için alıyor, hiçbir şey yazılmadı. LafPOS'ta Yönetim › Ayarlar ve yedek › Şube'yi düzeltin, sonra ${LAFPOS_RESEND_PATH}'e basın (LafPOS kendisi yeniden denemez).`;
    case "server_error":
      return `Panel gün sonunu yazamadı${day ? ` (${day})` : ""}: veritabanı hatası. LafPOS kendisi yeniden dener; sürerse Vercel günlüğünde [lafpos].`;
    default:
      return `${e.status} ${e.error}${day ? ` (${day})` : ""}`;
  }
}

/** Zilde günlü ret bu kadar gün durur (retin anından); çözülmeyen ret Ayarlar › LafPOS kartında kalır */
export const REJECTION_BELL_DAYS = 7;

/** Retin zil satırı (src/server/bell/lafpos.ts zilin satırına çevirir) */
export interface RejectionBell {
  /** Gün ve neden başına sabit: LafPOS aynı günü aynı nedenle yeniden gönderip yine reddedilse de satır yinelenmez */
  id: string;
  date: string;
  /** Retin anı */
  at: string;
  title: string;
  body: string;
}

/** Retin zildeki kısa nedeni (başlıkta) */
function rejectionReason(e: LafposRejection): string {
  switch (e.error) {
    case "z_conflict":
      return "Z numarası çakıştı";
    case "invalid":
      return "gönderim sözleşmeye uymadı";
    case "wrong_branch":
      return "kasa başka şubeye ayarlı";
    default:
      return `${e.status} ${e.error}`;
  }
}

/**
 * Zilin gövdesi: gün, ne oldu ve ne yapılacağı, kısa (zilde iki satır görünür; tamamı Ayarlar › LafPOS kartında,
 * rejectionText). LafPOS reddedilen günü kendisi yeniden göndermez: her yol LafPOS'tan elle Gönder'le biter
 */
function rejectionBellBody(e: LafposRejection & { date: string }, today: string): string {
  const day = dayText(e.date, today);
  switch (e.error) {
    case "z_conflict":
      return `${day}: panelde Z ${e.zNo ?? "?"} kayıtlı, LafPOS ${e.sentZNo !== null ? `Z ${e.sentZNo}` : "başka bir Z"} gönderdi. LafPOS'taki doğruysa Ayarlar › LafPOS'ta bu günün kaydını silin, sonra LafPOS'tan o günü Gönder'e basın.`;
    case "invalid":
      return `${day}: ilk sorunlu alan ${e.field ?? "bilinmiyor"}. LafPOS'un sürümünü panelle uyumlu yapın, sonra LafPOS'tan o günü Gönder'e basın.`;
    case "wrong_branch":
      return `${day}: LafPOS ${e.sube ? `"${e.sube}"` : "başka bir şube"} için gönderdi, panel ${e.expected ? `"${e.expected}"` : "LafPOS'un şubesini"} bekliyor. LafPOS'ta Yönetim › Ayarlar ve yedek › Şube'yi düzeltin, sonra o günü Gönder'e basın.`;
    default:
      return `${day}: hiçbir şey yazılmadı. Ayarlar › LafPOS'a bakın.`;
  }
}

/**
 * Zilin LafPOS retleri (yalnız yönetici; docs/LAFPOS.md › Durum ve onarım): sayılan LafPOS gününün (geçiş günü ve
 * sonrası) açık günlü reddi (409 wrong_branch, 409 z_conflict, 400 invalid; dayRejectionStatus "open") son
 * REJECTION_BELL_DAYS günde geldiyse bir satır: "Marina gün sonu alınamadı: <neden>", gövdede gün ve ne yapılacağı. O
 * günün gün sonu panele yazılmadı: Kasa raporu kendiliğinden yazılmaz, gün sonu e-postası gitmez. Kimlik gün ve
 * nedenden (aynı gün aynı nedenle yeniden reddedilse yinelenmez; başka bir neden yeni satırdır); gün yeniden yazılınca ya
 * da yönetici kaydı silince ("Gönder bekleniyor", kart söyler) satır kalkar. Deneme günü (geçişten önce) zile düşmez.
 * `received`: retlerin günlerinin paneldeki kaydının son gelişi (kaydı olmayan gün yok). En yeni gün önce
 */
export function rejectionBells(o: {
  rejections: Record<string, LafposRejection>;
  switchDay: string | null;
  received: Record<string, string>;
  branchName: string;
  today: string;
  now: Date;
}): RejectionBell[] {
  const out: RejectionBell[] = [];
  for (const e of Object.values(o.rejections)) {
    if (!isDayRejection(e) || !isLafposDay(e.date, o.switchDay)) continue;
    if (o.now.getTime() - Date.parse(e.at) >= REJECTION_BELL_DAYS * 86_400_000) continue;
    const receivedAt = o.received[e.date];
    if (dayRejectionStatus(e, receivedAt ? { receivedAt } : null) !== "open") continue;
    out.push({ id: `lafpos-ret-${e.date}-${e.error}`, date: e.date, at: e.at, title: `${o.branchName} gün sonu alınamadı: ${rejectionReason(e)}`, body: rejectionBellBody(e, o.today) });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Silinen (ya da panelde olmayan) 409 gününün satırı: LafPOS'tan elle gönderim bekleniyor */
export function clearedText(e: LafposRejection, today: string): string {
  const day = e.date ? dayText(e.date, today) : "O gün";
  const what = e.clearedAt ? `${day} kaydı ${dateTimeTR(e.clearedAt)} silindi` : `${day} kaydı panelde yok`;
  return `${what}. ${LAFPOS_RESEND_HINT}`;
}

/** İmzası doğrulanamayan isteklerin metni (yabancı bir istek de olabilir: suçlamadan) */
export function unverifiedText(u: LafposUnverified): string {
  const what =
    u.lastStatus === 413
      ? "Gövdesi 256 KB'ı aşan istek geldi; LafPOS'tansa gönderdiğine bakın"
      : "İmzası doğrulanamayan istek geldi; LafPOS'tansa anahtarı ve kafedeki saati (±5 dk) denetleyin";
  return `${what}. Son ${dateTimeTR(u.lastAt)}, şimdiye dek en az ${u.count.toLocaleString("tr-TR")} kez.`;
}

/** İmzasız istek son başarılı gönderimden sonra mı geldi (önceyse bağlantı o günden beri çalışıyor: uyarı değil) */
export function isUnverifiedAfterOk(state: LafposState): boolean {
  const u = state.unverified;
  return u !== null && (!state.lastOk || Date.parse(u.lastAt) > Date.parse(state.lastOk.at));
}

/** Ayarlar kartının okuduğu her şey (src/server/lafpos/status.ts › loadLafposCard) */
export interface LafposCardInput {
  /** Anahtarın sorunu (src/lib/lafpos/request.ts › lafposSecretProblem); null: bağlantı açık */
  secretProblem: "missing" | "short" | "same_as_site" | null;
  /**
   * Kullanılan anahtar nereden: Şube ayarları'nda saklanan ("panel", şifreli) ya da ortamdaki LAFPOS_SYNC_SECRET
   * ("ortam"); anahtar yoksa null. Eski çağıranlar vermeyebilir
   */
  secretSource?: "panel" | "ortam" | null;
  switchDay: string | null;
  /** İş günü */
  today: string;
  state: LafposState;
  /** En son tarihli LafPOS günü */
  lastDay: { date: string; zNo: number; receivedAt: string } | null;
  /** Saklanan LafPOS günleri */
  totalDays: number;
  /** Geçiş gününden önceki (ya da geçiş günü yokken bütün) günler: hesaplara girmez */
  trialDays: number;
  /** Geçiş gününden düne LafPOS günü gelmeyen günler (onaylı kapalı günler hariç) */
  missing: string[];
  /** Günlü retlerin günlerinin paneldeki kaydı (state.rejections'ın anahtarları; kaydı olmayan gün yok) */
  rejectionDays: Record<string, NonNullable<RejectionDay>>;
}

/** Kartta gösterilen günlü ret */
export interface CardDayRejection {
  rejection: LafposRejection & { date: string };
  day: RejectionDay;
  status: "open" | "cleared";
}

export type CardTone = "gray" | "green" | "blue" | "amber" | "red";

export interface LafposCardSummary {
  /** Bağlantının durumu (rozet rengi) */
  tone: CardTone;
  /** Rozet */
  badge: string;
  /** Kartın başlık satırı */
  headline: string;
  /** Ek satırlar */
  lines: string[];
  /** Günlü açık ve elle gönderim bekleyen retler, en yeni gün önce (çözülenler yok) */
  dayRejections: CardDayRejection[];
  /** Güne bağlanamayan son ret (500, gövdesi okunamayan 400); `fresh`: son başarılı gönderimden sonra */
  undated: { rejection: LafposRejection; fresh: boolean } | null;
  /** Kırmızı gösterilen ret sayısı (açık günlü retler ve taze güne bağlanamayan ret); anahtar yokken 0 */
  alerts: number;
  /** Telefonda kapalı bölümün özeti */
  short: string;
}

const SECRET_TEXT: Record<"missing" | "short" | "same_as_site", string> = {
  missing: "LAFPOS_SYNC_SECRET yok",
  short: "LAFPOS_SYNC_SECRET 32 karakterden kısa",
  same_as_site: "LAFPOS_SYNC_SECRET sitenin anahtarıyla (KARAOKE_SYNC_SECRET) aynı",
};

/** Geçiş gününden bu yana: "10 Kasım'dan beri" */
const sinceText = (d: string) => `${dayLocativeTR(d)}n beri`;

/**
 * Güne bağlanamayan ret (500 ya da gövdesi okunamayan 400) taze mi: gününe göre izlenemez, son başarılı gönderimden
 * sonraysa açık sayılır (500'ü LafPOS kendisi yeniden dener; sonraki başarılı gönderim bağlantının döndüğünü gösterir)
 */
export function isFreshRejection(e: LafposRejection, ok: LafposOk | null): boolean {
  return e.clearedAt === null && (!ok || Date.parse(e.at) > Date.parse(ok.at));
}

/**
 * Kartın özeti. Sakin dil (sahibin 26 Ekim kararı): kurulmamış bağlantı ve seçilmemiş geçiş günü hata değildir, kasa
 * ModPOS'tur. Rozet bağlantının durumudur; kırmızı yalnız geçiş günü seçili ama bağlantı kapalıyken (LafPOS günleri
 * gelemez). Retler kartta ayrı kutulardadır (açık günlü ret ve taze güne bağlanamayan ret kırmızı, elle gönderim
 * bekleyen turuncu); telefonda kapalı özetin başına yazılır.
 */
export function lafposCardSummary(c: LafposCardInput): LafposCardSummary {
  const s = summaryOf(c);
  const linked = c.secretProblem === null;
  const dayRejections: CardDayRejection[] = [];
  for (const e of Object.values(c.state.rejections)) {
    if (!isDayRejection(e)) continue;
    const day = c.rejectionDays[e.date] ?? null;
    const status = dayRejectionStatus(e, day);
    if (status !== "resolved") dayRejections.push({ rejection: e, day, status });
  }
  dayRejections.sort((a, b) => b.rejection.date.localeCompare(a.rejection.date));
  const last = c.state.lastError;
  const undated = last && !isDayRejection(last) ? { rejection: last, fresh: isFreshRejection(last, c.state.lastOk) } : null;
  const open = dayRejections.filter((x) => x.status === "open");
  const waiting = dayRejections.filter((x) => x.status === "cleared");
  const alerts = linked ? open.length + (undated?.fresh ? 1 : 0) : 0;
  const prefix: string[] = [];
  if (alerts === 1) prefix.push(open.length ? `${dayText(open[0].rejection.date, c.today)} gönderimi reddedildi` : "Son gönderim reddedildi");
  else if (alerts > 1) prefix.push(`${alerts} gönderim reddedildi`);
  if (linked && waiting.length) {
    prefix.push(`${waiting.length === 1 ? dayText(waiting[0].rejection.date, c.today) : `${waiting.length} gün`} için LafPOS'tan Gönder bekleniyor`);
  }
  return { ...s, dayRejections, undated, alerts, short: [...prefix, s.headline].join(" · ") };
}

function summaryOf(c: LafposCardInput): Omit<LafposCardSummary, "dayRejections" | "undated" | "alerts" | "short"> {
  const lines: string[] = [];
  const last = c.lastDay ? `Son gün sonu ${dayText(c.lastDay.date, c.today)} (Z ${c.lastDay.zNo}), alındı ${dateTimeTR(c.lastDay.receivedAt)}.` : null;

  if (c.secretProblem) {
    if (c.switchDay) {
      return {
        tone: "red",
        badge: "Bağlantı kapalı",
        headline: `Geçiş günü seçili (${dayMonthYearTR(c.switchDay)}) ama ${SECRET_TEXT[c.secretProblem]}: LafPOS günleri gelemez.`,
        lines: [last].filter((x): x is string => x !== null),
      };
    }
    if (c.secretProblem !== "missing") lines.push(`${SECRET_TEXT[c.secretProblem]}: bağlantı kapalı. Ayrı, en az 32 karakterlik bir anahtar üretin.`);
    if (c.totalDays) lines.push(`Daha önce gelen ${c.totalDays} gün saklanıyor, hiçbir hesaba girmiyor.`);
    return { tone: c.secretProblem === "missing" ? "gray" : "amber", badge: "Kurulmadı", headline: "Henüz kurulmadı · kasada ModPOS kullanılıyor.", lines };
  }

  let tone: CardTone;
  let badge: string;
  let headline: string;
  if (!c.switchDay) {
    tone = "green";
    badge = "Bağlı";
    headline = c.totalDays
      ? "Bağlı · geçiş günü seçilmedi: LafPOS günleri saklanıyor, hesaplara girmiyor."
      : "Bağlı · geçiş günü seçilmedi: henüz gün sonu gelmedi. Kasa ModPOS.";
    if (last) lines.push(last);
    if (c.totalDays) lines.push(`${c.totalDays} deneme günü (sayılmıyor).`);
  } else if (c.switchDay > c.today) {
    tone = "blue";
    badge = "Geçiş bekliyor";
    headline = `Geçiş günü ${dayMonthYearTR(c.switchDay)} (${daysUntilText(c.switchDay, c.today)}). O güne kadar kasa ModPOS.`;
    if (last) lines.push(last);
    if (c.trialDays) lines.push(`${c.trialDays} deneme günü (sayılmıyor).`);
  } else {
    tone = "green";
    badge = "LafPOS";
    headline = `Kasa LafPOS (${sinceText(c.switchDay)}).`;
    if (c.lastDay && isLafposDay(c.lastDay.date, c.switchDay)) lines.push(last!);
    else if (c.switchDay < c.today) {
      tone = "amber";
      lines.push("Geçiş gününden beri henüz gün sonu gelmedi.");
    }
    if (c.trialDays) lines.push(`Geçiş gününden önceki ${c.trialDays} gün deneme (sayılmıyor).`);
  }
  if (c.missing.length) {
    if (tone === "green") tone = "amber";
    const shown = c.missing.slice(-6).map((d) => dayText(d, c.today));
    const more = c.missing.length - shown.length;
    lines.push(
      `Gün sonu gelmeyen ${c.missing.length} gün: ${shown.join(", ")}${more > 0 ? ` ve ${more} gün daha` : ""}. LafPOS'ta Yönetim › Entegrasyon'daki giden kutusuna bakın; reddedilen gün Kasa › Geçmiş günler › Z raporu › Gönder ile yeniden gider.`,
    );
  }
  return { tone, badge, headline, lines };
}

/**
 * Geçiş gününden düne (iş günü) LafPOS günü gelmeyen günler, en çok son `limit` gün: `received` gelen günler,
 * `closed` onaylı kapalı günler. Bugünün gün sonu henüz alınmamış olabilir: bugün sayılmaz.
 */
export function missingLafposDays(switchDay: string | null, today: string, received: Iterable<string>, closed: Iterable<string>, limit = 60): string[] {
  if (!switchDay) return [];
  const to = addDays(today, -1);
  const floor = addDays(to, -(limit - 1));
  const from = switchDay > floor ? switchDay : floor;
  if (from > to) return [];
  const have = new Set([...received, ...closed]);
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (!have.has(d)) out.push(d);
  return out;
}
