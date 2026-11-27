import { z } from "zod";

import { DURUM_ANAHTARI, ZIL_ONEKI } from "./eski-adlar";

import { dateTimeTR } from "@/lib/format";
import { addDays, dayLocativeTR, dayMonthTR } from "@/lib/reminders";

import { dayMonthYearTR, daysUntilText, isAsilposDay } from "./switch";

/**
 * AsilPOS bağlantısının durumu (docs/ASILPOS.md › Durum ve onarım; saf, testleri tests/asilpos.test.ts): `POST /api/pos/gun`
 * her sonucu `integration_state`'in durum satırına (ASILPOS_STATE_KEY) yazar (src/server/asilpos/status.ts), Ayarlar'daki "AsilPOS (kasa)"
 * kartı buradaki özetle okur. Reddedilen gün sonu iz bırakır: son başarılı gün, son ret (durum, hata, alan, gün, Z),
 * güne göre açık retler ve imzası doğrulanamayan isteklerin sayacı.
 *
 * AsilPOS 400 ve 409'u kalıcı sayar, kendisi yeniden denemez (giden kutusunda bir yıl bekletir): gün ancak AsilPOS'ta
 * elle yeniden gönderilince gelir (ASILPOS_RESEND_PATH). Bu yüzden günlü 400 ve 409 güne göre saklanır (`rejections`):
 * sonraki günün başarılı gönderimi ya da başka bir günün reddi onu örtmez; yalnız o günün yeniden yazılması kapatır.
 */

/**
 * integration_state anahtarı: eski adla yazılır (src/lib/asilpos/eski-adlar.ts DURUM_ANAHTARI; geri dönüş güvenli, plan
 * A1). Okurken önce yeni ad (ASILPOS_STATE_KEY_NEW; temizlik PR'ı A3 taşıdıktan sonra o vardır); o satır varsa her yazım
 * ona da gider (src/server/asilpos/status.ts writeState), yoksa A3'ten geri dönülünce yazımlar görünmezdi
 */
export const ASILPOS_STATE_KEY = DURUM_ANAHTARI;
export const ASILPOS_STATE_KEY_NEW = "asilpos";

/**
 * Bir kasanın durum satırının anahtarları (çok şube, 27 Kasım 2026): `<ad>:<şube>`, yeni adlı önce okunur, eski adlı
 * yazılır (`write`). Genel satır (ASILPOS_STATE_KEY) imzası doğrulanamayan isteklerin sayacını taşır (imza tutmayan istek
 * bir şubeye bağlanamaz) ve eski tek kasalı kurulumun şubesinin (Marina) satırı yokken onun durumu olarak okunur (göç 0099
 * Marina'nınkini kopyalar)
 */
export function stateKeysOf(branchId: string): { read: [string, string]; write: string } {
  return { read: [`${ASILPOS_STATE_KEY_NEW}:${branchId}`, `${ASILPOS_STATE_KEY}:${branchId}`], write: `${ASILPOS_STATE_KEY}:${branchId}` };
}

/** Son yazılan gün sonu */
export interface AsilposOk {
  at: string;
  date: string;
  zNo: number | null;
  lines: number;
  /** Gün geçiş gününden önce değil: hesaplara giriyor */
  counted: boolean;
}

/** İmzası doğrulanmış ama yazılmamış son gönderim (400, 409, 500) */
export interface AsilposRejection {
  at: string;
  status: number;
  error: string;
  /** 400: ilk sorunlu alanın yolu */
  field: string | null;
  date: string | null;
  /** 409: paneldeki Z no */
  zNo: number | null;
  /** 409: AsilPOS'un gönderdiği Z no */
  sentZNo: number | null;
  /** Yönetici o günün kaydını sildi (409'un çözümü); gün AsilPOS'tan elle yeniden gönderilince yazılır */
  clearedAt: string | null;
  /** 409 wrong_branch: kasanın gönderdiği şube ve panelin beklediği (eski kayıtta yok) */
  sube?: string | null;
  expected?: string | null;
}

/** AsilPOS'ta reddedilen ya da silinen günü yeniden gönderen yol (AsilPOS kendisi yeniden denemez) */
export const ASILPOS_RESEND_PATH = "AsilPOS'ta Kasa › Geçmiş günler › o günün Z raporu › Gönder";

/** AsilPOS'un reddi yeniden denemediğinin ve elle gönderimin cümlesi (kart, silme penceresi) */
export const ASILPOS_RESEND_HINT = `AsilPOS reddedilen ya da silinen günü kendisi yeniden göndermez: ${ASILPOS_RESEND_PATH}'e basın.`;

/** Güne göre saklanan açık retlerin üst sınırı (en eskisi düşer) */
export const MAX_DAY_REJECTIONS = 10;

/** İmzası doğrulanamayan istekler (401, 413): yalnız sayaç ve zaman; gövde okunmaz, ayrıntı saklanmaz */
export interface AsilposUnverified {
  count: number;
  lastAt: string;
  lastStatus: number;
}

export interface AsilposState {
  lastOk: AsilposOk | null;
  /** Son ret, her türü (kart bundan yalnız güne bağlanamayanı gösterir: 500 ve gövdesi okunamayan 400) */
  lastError: AsilposRejection | null;
  /** Günlü 400 ve 409, güne göre: o gün yeniden yazılınca (200) ya da en çok MAX_DAY_REJECTIONS'ı aşınca düşer */
  rejections: Record<string, AsilposRejection>;
  unverified: AsilposUnverified | null;
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
export function parseAsilposState(v: unknown): AsilposState {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const part = <T>(schema: z.ZodType<T>, x: unknown): T | null => {
    const r = schema.safeParse(x);
    return r.success ? r.data : null;
  };
  const rejections: Record<string, AsilposRejection> = {};
  if (o.rejections && typeof o.rejections === "object") {
    for (const [date, x] of Object.entries(o.rejections as Record<string, unknown>)) {
      const r = part(rejectionSchema, x);
      if (r && /^\d{4}-\d{2}-\d{2}$/.test(date)) rejections[date] = { ...r, date };
    }
  }
  return { lastOk: part(okSchema, o.lastOk), lastError: part(rejectionSchema, o.lastError), rejections, unverified: part(unverifiedSchema, o.unverified) };
}

/** Günlü ret mi (400 ya da 409, günü okunmuş): güne göre izlenir */
export function isDayRejection(e: AsilposRejection): e is AsilposRejection & { date: string } {
  return e.date !== null && e.error !== "server_error";
}

/** Günün retini ekler (aynı günün eskisinin yerine); MAX_DAY_REJECTIONS'ı aşarsa en eski anlı düşer */
export function withDayRejection(cur: Record<string, AsilposRejection>, e: AsilposRejection & { date: string }, max = MAX_DAY_REJECTIONS): Record<string, AsilposRejection> {
  const all = Object.values({ ...cur, [e.date]: e }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (b.date ?? "").localeCompare(a.date ?? ""));
  return Object.fromEntries(all.slice(0, max).map((x) => [x.date, x]));
}

/** Retin gününün paneldeki kaydı (pos_day_reports; yoksa null) */
export type RejectionDay = { zNo: number; lines: number; receivedAt: string } | null;

/**
 * Günlü retin durumu, o günün paneldeki kaydına göre (son başarılı gönderimin gününe değil):
 * - "resolved": gün retten sonra yeniden yazıldı (AsilPOS düzeltip gönderdi);
 * - "cleared": yönetici kaydı sildi ya da 409'un günü panelde yok; gün AsilPOS'tan elle gönderilmeyi bekliyor;
 * - "open": ret duruyor (409'da panelde eski Z, 400'de eski kayıt ya da hiçbir şey).
 */
export function dayRejectionStatus(e: AsilposRejection, day: Pick<NonNullable<RejectionDay>, "receivedAt"> | null): "open" | "cleared" | "resolved" {
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
export function rejectionText(e: AsilposRejection, today: string): string {
  const day = e.date ? dayText(e.date, today) : null;
  switch (e.error) {
    case "z_conflict":
      return `${day ?? "O gün"} için panelde Z ${e.zNo ?? "?"} kayıtlı; AsilPOS ${e.sentZNo !== null ? `Z ${e.sentZNo}` : "başka bir Z"} gönderdi, hiçbir şey yazılmadı. AsilPOS'taki doğruysa bu günün kaydını silin, sonra ${ASILPOS_RESEND_PATH}'e basın (AsilPOS reddedilen günü kendisi yeniden denemez); AsilPOS'taki fazlaysa orada düzeltin.`;
    case "invalid":
      return `Gün sonu sözleşmeye uymadı${day ? ` (${day})` : ""}: ilk sorunlu alan ${e.field ?? "bilinmiyor"}. Hiçbir şey yazılmadı; AsilPOS'un sürümü panelle uyumlu mu? Düzeltilince ${ASILPOS_RESEND_PATH}'e basın (AsilPOS kendisi yeniden denemez).`;
    case "wrong_branch":
      return `AsilPOS'un kasası${e.sube ? ` "${e.sube}"` : " başka bir"} şubeye ayarlı${day ? ` (${day})` : ""}; panel AsilPOS'un gün sonunu ${e.expected ? `"${e.expected}"` : "AsilPOS'un"} şubesi için alıyor, hiçbir şey yazılmadı. AsilPOS'ta Yönetim › Ayarlar ve yedek › Şube'yi düzeltin, sonra ${ASILPOS_RESEND_PATH}'e basın (AsilPOS kendisi yeniden denemez).`;
    case "server_error":
      return `Panel gün sonunu yazamadı${day ? ` (${day})` : ""}: veritabanı hatası. AsilPOS kendisi yeniden dener; sürerse Vercel günlüğünde [asilpos].`;
    default:
      return `${e.status} ${e.error}${day ? ` (${day})` : ""}`;
  }
}

/** Zilde günlü ret bu kadar gün durur (retin anından); çözülmeyen ret Ayarlar › AsilPOS kartında kalır */
export const REJECTION_BELL_DAYS = 7;

/** Retin zil satırı (src/server/bell/asilpos.ts zilin satırına çevirir) */
export interface RejectionBell {
  /** Gün ve neden başına sabit: AsilPOS aynı günü aynı nedenle yeniden gönderip yine reddedilse de satır yinelenmez */
  id: string;
  date: string;
  /** Retin anı */
  at: string;
  title: string;
  body: string;
}

/** Retin zildeki kısa nedeni (başlıkta) */
function rejectionReason(e: AsilposRejection): string {
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
 * Zilin gövdesi: gün, ne oldu ve ne yapılacağı, kısa (zilde iki satır görünür; tamamı Ayarlar › AsilPOS kartında,
 * rejectionText). AsilPOS reddedilen günü kendisi yeniden göndermez: her yol AsilPOS'tan elle Gönder'le biter
 */
function rejectionBellBody(e: AsilposRejection & { date: string }, today: string): string {
  const day = dayText(e.date, today);
  switch (e.error) {
    case "z_conflict":
      return `${day}: panelde Z ${e.zNo ?? "?"} kayıtlı, AsilPOS ${e.sentZNo !== null ? `Z ${e.sentZNo}` : "başka bir Z"} gönderdi. AsilPOS'taki doğruysa Ayarlar › AsilPOS'ta bu günün kaydını silin, sonra AsilPOS'tan o günü Gönder'e basın.`;
    case "invalid":
      return `${day}: ilk sorunlu alan ${e.field ?? "bilinmiyor"}. AsilPOS'un sürümünü panelle uyumlu yapın, sonra AsilPOS'tan o günü Gönder'e basın.`;
    case "wrong_branch":
      return `${day}: AsilPOS ${e.sube ? `"${e.sube}"` : "başka bir şube"} için gönderdi, panel ${e.expected ? `"${e.expected}"` : "AsilPOS'un şubesini"} bekliyor. AsilPOS'ta Yönetim › Ayarlar ve yedek › Şube'yi düzeltin, sonra o günü Gönder'e basın.`;
    default:
      return `${day}: hiçbir şey yazılmadı. Ayarlar › AsilPOS'a bakın.`;
  }
}

/**
 * Zilin AsilPOS retleri (yalnız yönetici; docs/ASILPOS.md › Durum ve onarım): sayılan AsilPOS gününün (geçiş günü ve
 * sonrası) açık günlü reddi (409 wrong_branch, 409 z_conflict, 400 invalid; dayRejectionStatus "open") son
 * REJECTION_BELL_DAYS günde geldiyse bir satır: "Marina gün sonu alınamadı: <neden>", gövdede gün ve ne yapılacağı. O
 * günün gün sonu panele yazılmadı: Kasa raporu kendiliğinden yazılmaz, gün sonu e-postası gitmez. Kimlik gün ve
 * nedenden (aynı gün aynı nedenle yeniden reddedilse yinelenmez; başka bir neden yeni satırdır); gün yeniden yazılınca ya
 * da yönetici kaydı silince ("Gönder bekleniyor", kart söyler) satır kalkar. Deneme günü (geçişten önce) zile düşmez.
 * `received`: retlerin günlerinin paneldeki kaydının son gelişi (kaydı olmayan gün yok). En yeni gün önce
 */
export function rejectionBells(o: {
  rejections: Record<string, AsilposRejection>;
  switchDay: string | null;
  received: Record<string, string>;
  branchName: string;
  today: string;
  now: Date;
}): RejectionBell[] {
  const out: RejectionBell[] = [];
  for (const e of Object.values(o.rejections)) {
    if (!isDayRejection(e) || !isAsilposDay(e.date, o.switchDay)) continue;
    if (o.now.getTime() - Date.parse(e.at) >= REJECTION_BELL_DAYS * 86_400_000) continue;
    const receivedAt = o.received[e.date];
    if (dayRejectionStatus(e, receivedAt ? { receivedAt } : null) !== "open") continue;
    out.push({ id: `${ZIL_ONEKI}-ret-${e.date}-${e.error}`, date: e.date, at: e.at, title: `${o.branchName} gün sonu alınamadı: ${rejectionReason(e)}`, body: rejectionBellBody(e, o.today) });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Silinen (ya da panelde olmayan) 409 gününün satırı: AsilPOS'tan elle gönderim bekleniyor */
export function clearedText(e: AsilposRejection, today: string): string {
  const day = e.date ? dayText(e.date, today) : "O gün";
  const what = e.clearedAt ? `${day} kaydı ${dateTimeTR(e.clearedAt)} silindi` : `${day} kaydı panelde yok`;
  return `${what}. ${ASILPOS_RESEND_HINT}`;
}

/** İmzası doğrulanamayan isteklerin metni (yabancı bir istek de olabilir: suçlamadan) */
export function unverifiedText(u: AsilposUnverified): string {
  const what =
    u.lastStatus === 413
      ? "Gövdesi 256 KB'ı aşan istek geldi; AsilPOS'tansa gönderdiğine bakın"
      : "İmzası doğrulanamayan istek geldi; AsilPOS'tansa anahtarı ve kafedeki saati (±5 dk) denetleyin";
  return `${what}. Son ${dateTimeTR(u.lastAt)}, şimdiye dek en az ${u.count.toLocaleString("tr-TR")} kez.`;
}

/** İmzasız istek son başarılı gönderimden sonra mı geldi (önceyse bağlantı o günden beri çalışıyor: uyarı değil) */
export function isUnverifiedAfterOk(state: AsilposState): boolean {
  const u = state.unverified;
  return u !== null && (!state.lastOk || Date.parse(u.lastAt) > Date.parse(state.lastOk.at));
}

/** Ayarlar kartının okuduğu her şey (src/server/asilpos/status.ts › loadAsilposCard) */
export interface AsilposCardInput {
  /** Anahtarın sorunu (src/lib/asilpos/request.ts › asilposSecretProblem); null: bağlantı açık */
  secretProblem: "missing" | "short" | "same_as_site" | "same_as_other_branch" | null;
  /**
   * Kullanılan anahtar nereden: Şube ayarları'nda saklanan ("panel", şifreli) ya da ortamdaki ASILPOS_SYNC_SECRET
   * ("ortam"); anahtar yoksa null. Eski çağıranlar vermeyebilir
   */
  secretSource?: "panel" | "ortam" | null;
  /**
   * Ortamda anahtarın okunduğu değişkenin adı (src/lib/asilpos/env.ts posEnvName: sahip yeni adı eklemediyse eski adı);
   * metinler bunu söyler. Verilmezse yeni ad
   */
  secretEnvName?: string;
  switchDay: string | null;
  /** İş günü */
  today: string;
  state: AsilposState;
  /** En son tarihli AsilPOS günü */
  lastDay: { date: string; zNo: number; receivedAt: string } | null;
  /** Saklanan AsilPOS günleri */
  totalDays: number;
  /** Geçiş gününden önceki (ya da geçiş günü yokken bütün) günler: hesaplara girmez */
  trialDays: number;
  /** Geçiş gününden düne AsilPOS günü gelmeyen günler (onaylı kapalı günler hariç) */
  missing: string[];
  /** Günlü retlerin günlerinin paneldeki kaydı (state.rejections'ın anahtarları; kaydı olmayan gün yok) */
  rejectionDays: Record<string, NonNullable<RejectionDay>>;
}

/** Kartta gösterilen günlü ret */
export interface CardDayRejection {
  rejection: AsilposRejection & { date: string };
  day: RejectionDay;
  status: "open" | "cleared";
}

export type CardTone = "gray" | "green" | "blue" | "amber" | "red";

export interface AsilposCardSummary {
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
  undated: { rejection: AsilposRejection; fresh: boolean } | null;
  /** Kırmızı gösterilen ret sayısı (açık günlü retler ve taze güne bağlanamayan ret); anahtar yokken 0 */
  alerts: number;
  /** Telefonda kapalı bölümün özeti */
  short: string;
}

/** Anahtarın sorununun metni; `name`: ortamda okunan değişkenin adı */
const secretText = (p: "missing" | "short" | "same_as_site" | "same_as_other_branch", name = "ASILPOS_SYNC_SECRET"): string =>
  p === "missing"
    ? `${name} yok`
    : p === "short"
      ? `${name} 32 karakterden kısa`
      : p === "same_as_other_branch"
        ? "Anahtar başka bir şubenin AsilPOS anahtarıyla aynı"
        : `${name} sitenin anahtarıyla (KARAOKE_SYNC_SECRET) aynı`;

/** Geçiş gününden bu yana: "10 Kasım'dan beri" */
const sinceText = (d: string) => `${dayLocativeTR(d)}n beri`;

/**
 * Güne bağlanamayan ret (500 ya da gövdesi okunamayan 400) taze mi: gününe göre izlenemez, son başarılı gönderimden
 * sonraysa açık sayılır (500'ü AsilPOS kendisi yeniden dener; sonraki başarılı gönderim bağlantının döndüğünü gösterir)
 */
export function isFreshRejection(e: AsilposRejection, ok: AsilposOk | null): boolean {
  return e.clearedAt === null && (!ok || Date.parse(e.at) > Date.parse(ok.at));
}

/**
 * Kartın özeti. Sakin dil (sahibin 26 Ekim kararı): kurulmamış bağlantı ve seçilmemiş geçiş günü hata değildir, kasa
 * ModPOS'tur. Rozet bağlantının durumudur; kırmızı yalnız geçiş günü seçili ama bağlantı kapalıyken (AsilPOS günleri
 * gelemez). Retler kartta ayrı kutulardadır (açık günlü ret ve taze güne bağlanamayan ret kırmızı, elle gönderim
 * bekleyen turuncu); telefonda kapalı özetin başına yazılır.
 */
export function asilposCardSummary(c: AsilposCardInput): AsilposCardSummary {
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
    prefix.push(`${waiting.length === 1 ? dayText(waiting[0].rejection.date, c.today) : `${waiting.length} gün`} için AsilPOS'tan Gönder bekleniyor`);
  }
  return { ...s, dayRejections, undated, alerts, short: [...prefix, s.headline].join(" · ") };
}

function summaryOf(c: AsilposCardInput): Omit<AsilposCardSummary, "dayRejections" | "undated" | "alerts" | "short"> {
  const lines: string[] = [];
  const last = c.lastDay ? `Son gün sonu ${dayText(c.lastDay.date, c.today)} (Z ${c.lastDay.zNo}), alındı ${dateTimeTR(c.lastDay.receivedAt)}.` : null;

  if (c.secretProblem) {
    if (c.switchDay) {
      return {
        tone: "red",
        badge: "Bağlantı kapalı",
        headline: `Geçiş günü seçili (${dayMonthYearTR(c.switchDay)}) ama ${secretText(c.secretProblem, c.secretEnvName)}: AsilPOS günleri gelemez.`,
        lines: [last].filter((x): x is string => x !== null),
      };
    }
    if (c.secretProblem !== "missing") lines.push(`${secretText(c.secretProblem, c.secretEnvName)}: bağlantı kapalı. Ayrı, en az 32 karakterlik bir anahtar üretin.`);
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
      ? "Bağlı · geçiş günü seçilmedi: AsilPOS günleri saklanıyor, hesaplara girmiyor."
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
    badge = "AsilPOS";
    headline = `Kasa AsilPOS (${sinceText(c.switchDay)}).`;
    if (c.lastDay && isAsilposDay(c.lastDay.date, c.switchDay)) lines.push(last!);
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
      `Gün sonu gelmeyen ${c.missing.length} gün: ${shown.join(", ")}${more > 0 ? ` ve ${more} gün daha` : ""}. AsilPOS'ta Yönetim › Entegrasyon'daki giden kutusuna bakın; reddedilen gün Kasa › Geçmiş günler › Z raporu › Gönder ile yeniden gider.`,
    );
  }
  return { tone, badge, headline, lines };
}

/**
 * Geçiş gününden düne (iş günü) AsilPOS günü gelmeyen günler, en çok son `limit` gün: `received` gelen günler,
 * `closed` onaylı kapalı günler. Bugünün gün sonu henüz alınmamış olabilir: bugün sayılmaz.
 */
export function missingAsilposDays(switchDay: string | null, today: string, received: Iterable<string>, closed: Iterable<string>, limit = 60): string[] {
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
