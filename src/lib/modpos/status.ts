import { z } from "zod";

import { dayMonthYearTR } from "@/lib/lafpos/switch";
import { dayAblativeTR, dayMonthTR, todayTR } from "@/lib/reminders";

import { MODPOS_DAILY_QUOTA, quotaLeft, quotaRenewsAt, renewText, type ModposQuota } from "./request";

/**
 * ModPOS kasa föyü bağlantısının durumu (saf; Ayarlar › ModPOS kasa föyü kartı, zil ve sabah işi okur;
 * tests/modpos-foy.test.ts). integration_state › `modpos`'ta saklanır: son kota, son başarılı ve başarısız çekim, son 10
 * çalışma. Bozuk alan atılır, kalanı okunur. Anahtar burada yoktur (yalnız Vercel'in ortam değişkeninde).
 */

export const MODPOS_STATE_KEY = "modpos";
/** Saklanan çalışma sayısı */
export const MODPOS_RUNS_KEEP = 10;

export type ModposTrigger = "cron" | "elle";
export type ModposDayResult = "yeni" | "degisti" | "ayni" | "hata";

export interface ModposRun {
  at: string;
  trigger: ModposTrigger;
  days: { day: string; result: ModposDayResult }[];
  /** Çalışmanın sonu: tamam, hak doldu, hata, çekilecek gün yok */
  status: "ok" | "kota" | "error" | "nothing" | "partial";
  text: string | null;
}


export interface ModposError {
  at: string;
  day: string | null;
  kod: string;
  text: string;
  /** Anahtarın kendisiyle ilgili (geçersiz, süresi dolmuş, IP, yetki): düzeltilmeden hiçbir gün çekilmez */
  keyError: boolean;
}

/** Alınamayan günün kaydı: kaç kez, en son ne zaman, hangi kodla (planlayıcı tekrar tekrar aynı günde takılmasın) */
export interface ModposDayError {
  count: number;
  lastAt: string;
  kod: string;
}

/** Saklanan gün hatası sayısı (en eskisi düşer) */
export const MODPOS_DAY_ERRORS_KEEP = 40;

export interface ModposState {
  quota: ModposQuota | null;
  lastOk: { at: string; day: string } | null;
  lastError: ModposError | null;
  runs: ModposRun[];
  /** Alınamayan günler (gün → kayıt); gün alınınca silinir */
  dayErrors: Record<string, ModposDayError>;
  /** Sabah işinin son çalıştığı an (istek gitmese de; kartın "sıradaki"si bugünün işi çalıştı mı diye bakar) */
  lastCronAt: string | null;
}

const quotaSchema = z.object({
  day: z.string(),
  hak: z.number().int().min(0),
  kalan: z.number().int().min(0),
  yenilenme: z.string().nullable(),
  at: z.string(),
});
const okSchema = z.object({ at: z.string(), day: z.string() });
const dayErrorSchema = z.object({ count: z.number().int().min(1), lastAt: z.string(), kod: z.string() });
const errorSchema = z.object({ at: z.string(), day: z.string().nullable(), kod: z.string(), text: z.string(), keyError: z.boolean() });
const runSchema = z.object({
  at: z.string(),
  trigger: z.enum(["cron", "elle"]),
  days: z.array(z.object({ day: z.string(), result: z.enum(["yeni", "degisti", "ayni", "hata"]) })),
  status: z.enum(["ok", "kota", "error", "nothing", "partial"]),
  text: z.string().nullable(),
});

/** Saklanan durumu okur: bozuk alan null (ya da boş liste), kalanı geçerli */
export function parseModposState(v: unknown): ModposState {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const runs = Array.isArray(o.runs) ? o.runs.flatMap((r) => (runSchema.safeParse(r).success ? [r as ModposRun] : [])) : [];
  return {
    quota: quotaSchema.nullable().catch(null).parse(o.quota ?? null),
    lastOk: okSchema.nullable().catch(null).parse(o.lastOk ?? null),
    lastError: errorSchema.nullable().catch(null).parse(o.lastError ?? null),
    runs: runs.slice(0, MODPOS_RUNS_KEEP),
    dayErrors: o.dayErrors && typeof o.dayErrors === "object" && !Array.isArray(o.dayErrors)
      ? Object.fromEntries(
          Object.entries(o.dayErrors as Record<string, unknown>).flatMap(([d, v]) => {
            const r = dayErrorSchema.safeParse(v);
            return /^\d{4}-\d{2}-\d{2}$/.test(d) && r.success ? [[d, r.data] as const] : [];
          }),
        )
      : {},
    lastCronAt: typeof o.lastCronAt === "string" && !Number.isNaN(Date.parse(o.lastCronAt)) ? o.lastCronAt : null,
  };
}

/**
 * Gün hatalarını günceller: alınan günler silinir, alınamayanların sayısı artar (en çok MODPOS_DAY_ERRORS_KEEP; en
 * eskisi düşer). Planlayıcı alınamayan günü bekletir (src/lib/modpos/plan.ts), geçmiş onda takılmaz
 */
export function withDayErrors(cur: Readonly<Record<string, ModposDayError>>, ok: readonly string[], failed: readonly { day: string; kod: string }[], at: string): Record<string, ModposDayError> {
  const next: Record<string, ModposDayError> = { ...cur };
  for (const d of ok) delete next[d];
  for (const f of failed) next[f.day] = { count: (cur[f.day]?.count ?? 0) + 1, lastAt: at, kod: f.kod };
  const keep = Object.entries(next).sort((a, b) => b[1].lastAt.localeCompare(a[1].lastAt)).slice(0, MODPOS_DAY_ERRORS_KEEP);
  return Object.fromEntries(keep);
}

/** Yeni çalışmayı listenin başına ekler (en çok MODPOS_RUNS_KEEP) */
export function withRun(runs: readonly ModposRun[], run: ModposRun): ModposRun[] {
  return [run, ...runs].slice(0, MODPOS_RUNS_KEEP);
}

/** "1 Temmuz'dan" (ay adının ekiyle; eskiden hep "'den" yazılıyordu); başka yılsa ek yılın okunuşuna bağlı olduğundan
 * "1 Temmuz 2025 tarihinden" */
function sinceText(day: string, now: Date): string {
  return day.slice(0, 4) === todayTR(now).slice(0, 4) ? dayAblativeTR(day) : `${dayMonthYearTR(day)} tarihinden`;
}

/** Günün yazısı: bu yılsa "2 Kasım", değilse "2 Kasım 2025" */
export function modposDayText(day: string, now: Date): string {
  return day.slice(0, 4) === todayTR(now).slice(0, 4) ? dayMonthTR(day) : dayMonthYearTR(day);
}

const RESULT_TEXT: Record<ModposDayResult, string> = { yeni: "alındı", degisti: "değişti", ayni: "değişmedi", hata: "alınamadı" };

/** Çalışmanın özeti: "2 Kasım alındı · 14 Ekim değişmedi" */
export function runDaysText(days: ModposRun["days"], now: Date): string {
  return days.map((d) => `${modposDayText(d.day, now)} ${RESULT_TEXT[d.result]}`).join(" · ");
}

export type ModposTone = "gray" | "green" | "blue" | "amber" | "red";

export interface ModposCardInput {
  now: Date;
  keyProblem: "missing" | "format" | null;
  /** Önizleme (Preview) dağıtımı: canlının veritabanını paylaşır, çekmez */
  preview: boolean;
  state: ModposState;
  from: string;
  /** Saklanan gün sayısı ve en eski / en yeni gün */
  stored: { count: number; first: string | null; last: string | null };
  /** Geçmişte eksik günler (from → dün) */
  missing: number;
  /** Geçmişin sıradaki günü (bir sonraki sabah işinin dünden sonraki ilk günü); eksik yoksa ya da bilinmiyorsa yok */
  next?: string | null;
}

export interface ModposCardSummary {
  tone: ModposTone;
  badge: string;
  headline: string;
  lines: string[];
  /** Akordeonun kapalıyken özeti */
  short: string;
  /** Kalan hak (bugün) */
  left: number;
  /** Elle çekim düğmesi açık mı (kurulu, önizleme değil, hak var) */
  canFetch: boolean;
  /** Düğme kapalıysa nedeni */
  fetchBlocked: string | null;
}

/**
 * Kartın özeti. Sakin dil (LafPOS kartıyla aynı kural): kurulmamış bağlantı gri "Kurulmadı"dır, hata değil; kırmızı
 * yalnız anahtar çalışmadığında (geçersiz, süresi dolmuş, IP, yetki). Hak dolması turuncu değil mavidir: olağandır;
 * hak yenilendiyse son denemenin KOTA_DOLDU'su hiç anılmaz (tests/modpos-foy.test.ts).
 */
export function modposCardSummary(c: ModposCardInput): ModposCardSummary {
  const left = quotaLeft(c.state.quota, c.now);
  // quotaLeft'le aynı kural: yeni günün hakkı en az 1
  const hak = c.state.quota && c.state.quota.hak >= 1 ? c.state.quota.hak : MODPOS_DAILY_QUOTA;
  const renew = renewText(quotaRenewsAt(c.state.quota, c.now), c.now);
  if (c.keyProblem === "missing") {
    return {
      tone: "gray",
      badge: "Kurulmadı",
      headline: "ModPOS API anahtarı tanımlı değil",
      lines: ["Vercel › lafmaliyet › Settings › Environment Variables'a (yalnız Production) MODPOS_API_KEY eklenip yeniden yayınlanınca her sabah dünün kasa verisi ModPOS API'den gelir."],
      short: "Kurulmadı",
      left,
      canFetch: false,
      fetchBlocked: "Anahtar tanımlı değil",
    };
  }
  if (c.keyProblem === "format") {
    return {
      tone: "red",
      badge: "Anahtar bozuk",
      headline: "MODPOS_API_KEY'in biçimi bozuk (boşluk ya da satır sonu var, ya da çok kısa)",
      lines: ["Vercel'deki değeri Gafdigi'nin verdiği anahtarla aynen değiştirip yeniden yayınlayın."],
      short: "Anahtar bozuk",
      left,
      canFetch: false,
      fetchBlocked: "Anahtar bozuk",
    };
  }
  const lines: string[] = [];
  const st = c.stored;
  if (st.count && st.first && st.last) {
    lines.push(`${modposDayText(st.first, c.now)} – ${modposDayText(st.last, c.now)} arası ${st.count} günün ModPOS API verisi var.`);
  }
  if (c.missing > 0) {
    const days = Math.ceil(c.missing / Math.max(1, hak - 1));
    const next = c.next ? `; sıradaki ${modposDayText(c.next, c.now)}` : "";
    lines.push(
      `${sinceText(c.from, c.now)} bu yana ${c.missing} günün ModPOS API verisi henüz yok: her sabah dünün verisinden sonra kalan hakla en yeni eksik günden eskiye doğru bir gün çekilir${next} (yaklaşık ${days} gün sürer).`,
    );
  }
  lines.push(`Bugün kalan çekim hakkı: ${left} / ${hak}${left < hak ? ` (hak ${renew} yenilenir)` : ""}.`);
  const ok = c.state.lastOk;
  if (ok) lines.push(`Son başarılı çekim: ${modposDayText(ok.day, c.now)} verisi, ${timeText(ok.at, c.now)}.`);
  // Tekrar tekrar alınamayan günler (planlayıcı bekletir: 2, 4, 8… gün): sessizce takılı kalmasın
  const stuck = Object.entries(c.state.dayErrors ?? {})
    .filter(([, e]) => e.count >= 2)
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (stuck.length) {
    const shown = stuck.slice(0, 3).map(([d, e]) => `${modposDayText(d, c.now)} (${e.count} kez, ${e.kod})`);
    lines.push(`Tekrar tekrar alınamayan ${stuck.length} gün: ${shown.join(", ")}${stuck.length > 3 ? " …" : ""}; aralıklı yeniden denenir, geçmiş diğer günlerle sürer.`);
  }
  const err = c.state.lastError;
  // Hak doldu bir hata değildir: hak yenilendiyse (left > 0) eski KOTA_DOLDU güncel sayılmaz
  const quotaErr = err?.kod === "KOTA_DOLDU";
  const errFresh = err && (!ok || err.at > ok.at) && !(quotaErr && left > 0);
  if (c.preview) {
    return { tone: "gray", badge: "Önizleme", headline: "Önizleme dağıtımı ModPOS API'den çekmez", lines, short: "Önizleme", left, canFetch: false, fetchBlocked: "Önizlemede çekilmez" };
  }
  if (errFresh && err.keyError) {
    return { tone: "red", badge: "Hata", headline: err.text, lines, short: "Hata", left, canFetch: left > 0, fetchBlocked: left > 0 ? null : `Bugünkü hak doldu; ${renew} yenilenir` };
  }
  if (errFresh && quotaErr) {
    // Burada left 0'dır (yukarıdaki kural): düğme kapalı, metin yenilenme anını bugüne göre söyler
    return {
      tone: "blue",
      badge: "Hak doldu",
      headline: `Bugünkü çekim hakkı doldu; hak ${renew} yenilenir`,
      lines,
      short: "Bugünkü hak doldu",
      left,
      canFetch: false,
      fetchBlocked: `Bugünkü hak doldu; ${renew} yenilenir`,
    };
  }
  // Hiç çekim kaydı yok ama föy saklı (komut satırının --dosya --kaydet'i durum yazmaz): "henüz çekilmedi" denmez
  if (!ok && !errFresh && !st.count) {
    return {
      tone: "amber",
      badge: "Henüz çekilmedi",
      headline: "Anahtar tanımlı; ilk veri yarın sabah 08:00'de gelir ya da aşağıdan şimdi çekilebilir",
      lines,
      short: "Henüz çekilmedi",
      left,
      canFetch: left > 0,
      fetchBlocked: left > 0 ? null : `Bugünkü hak doldu; ${renew} yenilenir`,
    };
  }
  const headline = errFresh ? `Son deneme: ${err.text}` : "Her sabah 08:00'de dünün kasa verisi ModPOS API'den geliyor";
  return {
    tone: errFresh ? "amber" : "green",
    badge: errFresh ? "Uyarı" : "Bağlı",
    headline,
    lines,
    short: errFresh ? "Son deneme hata verdi" : `Bağlı · ${st.count} gün`,
    left,
    canFetch: left > 0,
    fetchBlocked: left > 0 ? null : `Bugünkü hak doldu; ${renew} yenilenir`,
  };
}

/** "bugün 08:02", "dün 23:10", "2 Kasım 08:02" (TR) */
export function timeText(iso: string, now: Date): string {
  const t = new Date(iso);
  // Bozuk saklanmış an sayfayı düşürmesin
  if (Number.isNaN(t.getTime())) return "bilinmeyen bir anda";
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(t);
  const hm = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(t);
  const today = todayTR(now);
  if (day === today) return `bugün ${hm}`;
  const y = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  if (day === y) return `dün ${hm}`;
  return `${modposDayText(day, now)} ${hm}`;
}

/**
 * Ay rakamına yedek (settings › `modposAyYedegi`, varsayılan kapalı; docs/MODPOS-API.md › Ay rakamı): açıkken kasa
 * raporu (ve LafPOS gün sonu) olmayan günün cirosu, kartı, yemek kartı ve ödenmezi kapanmış ModPOS föyünden aya girer;
 * gün yine "rapor yok" sayılır. Kapalıyken föy hiçbir hesaba girmez, yalnız yöneticinin ekranlarında görünür.
 */
export const MODPOS_FALLBACK_KEY = "modposAyYedegi";

/** Kayıtlı ayarın okunması: yalnız `true` açık (bozuk ya da eksik değer kapalı) */
export function readModposFallback(v: unknown): boolean {
  return v === true;
}
