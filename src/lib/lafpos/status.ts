import { z } from "zod";

import { dateTimeTR } from "@/lib/format";
import { addDays, dayLocativeTR, dayMonthTR } from "@/lib/reminders";

import { dayMonthYearTR, daysUntilText, isLafposDay } from "./switch";

/**
 * LafPOS bağlantısının durumu (docs/LAFPOS.md › Durum ve onarım; saf, testleri tests/lafpos.test.ts): `POST /api/pos/gun`
 * her sonucu `integration_state`'in "lafpos" satırına yazar (src/server/lafpos/status.ts), Ayarlar'daki "LafPOS (kasa)"
 * kartı buradaki özetle okur. Reddedilen gün sonu iz bırakır: son başarılı gün, son ret (durum, hata, alan, gün, Z) ve
 * imzası doğrulanamayan isteklerin sayacı.
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
  /** Yönetici o günün kaydını sildi (409'un çözümü); LafPOS yeniden gönderince yazılır */
  clearedAt: string | null;
}

/** İmzası doğrulanamayan istekler (401, 413): yalnız sayaç ve zaman; gövde okunmaz, ayrıntı saklanmaz */
export interface LafposUnverified {
  count: number;
  lastAt: string;
  lastStatus: number;
}

export interface LafposState {
  lastOk: LafposOk | null;
  lastError: LafposRejection | null;
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
});
const unverifiedSchema = z.object({ count: z.number(), lastAt: z.string(), lastStatus: z.number() });

/** Kayıtlı değer (bozuk parça yok sayılır, öteki parçalar kalır) */
export function parseLafposState(v: unknown): LafposState {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const part = <T>(schema: z.ZodType<T>, x: unknown): T | null => {
    const r = schema.safeParse(x);
    return r.success ? r.data : null;
  };
  return { lastOk: part(okSchema, o.lastOk), lastError: part(rejectionSchema, o.lastError), unverified: part(unverifiedSchema, o.unverified) };
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
      return `${day ?? "O gün"} için panelde Z ${e.zNo ?? "?"} kayıtlı; LafPOS ${e.sentZNo !== null ? `Z ${e.sentZNo}` : "başka bir Z"} gönderdi, hiçbir şey yazılmadı. Paneldeki yanlışsa bu günün kaydını silin, LafPOS yeniden gönderince yazılır; LafPOS'taki fazlaysa orada düzeltin.`;
    case "invalid":
      return `Gün sonu sözleşmeye uymadı${day ? ` (${day})` : ""}: ilk sorunlu alan ${e.field ?? "bilinmiyor"}. Hiçbir şey yazılmadı; LafPOS'un sürümü panelle uyumlu mu?`;
    case "server_error":
      return `Panel gün sonunu yazamadı${day ? ` (${day})` : ""}: veritabanı hatası. LafPOS kendisi yeniden dener; sürerse Vercel günlüğünde [lafpos].`;
    default:
      return `${e.status} ${e.error}${day ? ` (${day})` : ""}`;
  }
}

/** İmzası tutmayan isteklerin metni */
export function unverifiedText(u: LafposUnverified): string {
  const what =
    u.lastStatus === 413
      ? "Gövdesi 256 KB'ı aşan istek"
      : "İmzası tutmayan istek (anahtar iki tarafta aynı mı, kafedeki makinenin saati doğru mu, ±5 dakika?)";
  return `${what}: son ${dateTimeTR(u.lastAt)}, toplam ${u.count.toLocaleString("tr-TR")}.`;
}

/** Ayarlar kartının okuduğu her şey (src/server/lafpos/status.ts › loadLafposCard) */
export interface LafposCardInput {
  /** Anahtarın sorunu (src/lib/lafpos/request.ts › lafposSecretProblem); null: bağlantı açık */
  secretProblem: "missing" | "short" | "same_as_site" | null;
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
}

export type CardTone = "gray" | "green" | "blue" | "amber" | "red";

export interface LafposCardSummary {
  tone: CardTone;
  /** Rozet */
  badge: string;
  /** Kartın başlık satırı (telefonda kapalı bölümün özeti de bu) */
  headline: string;
  /** Ek satırlar */
  lines: string[];
}

const SECRET_TEXT: Record<"missing" | "short" | "same_as_site", string> = {
  missing: "LAFPOS_SYNC_SECRET yok",
  short: "LAFPOS_SYNC_SECRET 32 karakterden kısa",
  same_as_site: "LAFPOS_SYNC_SECRET sitenin anahtarıyla (KARAOKE_SYNC_SECRET) aynı",
};

/** Geçiş gününden bu yana: "10 Kasım'dan beri" */
const sinceText = (d: string) => `${dayLocativeTR(d)}n beri`;

/**
 * Kartın özeti. Sakin dil (sahibin 26 Ekim kararı): kurulmamış bağlantı ve seçilmemiş geçiş günü hata değildir, kasa
 * ModPOS'tur. Kırmızı yalnız iki durumda: geçiş günü seçili ama bağlantı kapalı (LafPOS günleri gelemez) ya da son
 * gönderim başarılı olandan sonra reddedildi.
 */
export function lafposCardSummary(c: LafposCardInput): LafposCardSummary {
  const lines: string[] = [];
  const last = c.lastDay ? `Son gün sonu ${dayText(c.lastDay.date, c.today)} (Z ${c.lastDay.zNo}), alındı ${dateTimeTR(c.lastDay.receivedAt)}.` : null;
  const ok = c.state.lastOk;
  const err = c.state.lastError;
  const freshError = err !== null && err.clearedAt === null && (!ok || Date.parse(err.at) > Date.parse(ok.at));

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
    lines.push(`Gün sonu gelmeyen ${c.missing.length} gün: ${shown.join(", ")}${more > 0 ? ` ve ${more} gün daha` : ""}. LafPOS'ta giden kutusuna bakın.`);
  }
  if (freshError) {
    tone = "red";
    badge = "Ret";
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
