import "server-only";

import { planFoyDays } from "@/lib/modpos/plan";
import { modposKeyProblem, modposSyncFrom, MODPOS_DAILY_QUOTA, quotaLeft, requestableDay, type ModposQuota } from "@/lib/modpos/request";
import { todayTR } from "@/lib/reminders";
import { runDaysText, type ModposDayResult, type ModposError, type ModposRun, type ModposTrigger } from "@/lib/modpos/status";
import { getDb, type DB } from "@/server/db";

import { fetchKasaFoyu } from "./client";
import { loadModposIndex, noteModposRun, readModposState, storeFoy, type SheetChange } from "./store";

/**
 * ModPOS kasa föylerinin çekilmesi (docs/MODPOS-API.md › Çekme): sabah işi (`cron`, /api/cron/gunluk) ve Ayarlar ›
 * ModPOS kasa föyü'ndeki "Bu günü çek" (`elle`) aynı koşucudan geçer.
 *
 * - Kurulmamışsa (`MODPOS_API_KEY` yok) ya da önizleme dağıtımıysa hiçbir istek gitmez (önizlemeler canlının
 *   veritabanını ve hakkını paylaşır).
 * - Hak son bilinen kotadan (yanıt başlıkları) hesaplanır; dolmuşsa istek gitmez. Günler planlayıcıdan
 *   (src/lib/modpos/plan.ts) ya da elle seçilen gün.
 * - Her gün kendi isteği; hak dolarsa (429) ya da anahtar çalışmazsa (401 / 403) çalışma durur, günlük hata (400, 5xx,
 *   bozuk yanıt) yalnız o günü düşürür. Yeniden deneme yok: hak harcanmasın.
 * - Süre: istek başına en çok `deadlineAt`'e kalan süre; 5 sn'den azı kaldıysa yeni istek başlamaz.
 */

export interface ModposSyncDay {
  day: string;
  result: ModposDayResult;
  text?: string;
  /** Değiştiyse yeni sürüm */
  revision?: number;
}

export type ModposSyncStatus = "off" | "preview" | "nothing" | "ok" | "partial" | "kota" | "error";

export interface ModposSyncResult {
  status: ModposSyncStatus;
  days: ModposSyncDay[];
  /** Çalışmadan sonra kalan hak (bilinmiyorsa null) */
  left: number | null;
  /** Hata ya da hak doldu metni */
  error?: string;
}

export interface SyncOptions {
  now?: Date;
  /** Son an (Date.now() cinsinden) */
  deadlineAt: number;
  /** Elle: yalnız bu günler (planlayıcı kullanılmaz) */
  days?: string[];
  db?: DB;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
}

/** Önizlemeler canlının veritabanını ve ModPOS hakkını paylaşır: hiçbir şey çekmez, yazmaz */
export function canFetchModpos(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV !== "preview";
}

const MIN_REQUEST_MS = 5_000;

export async function syncModpos(trigger: ModposTrigger, o: SyncOptions): Promise<ModposSyncResult> {
  const env = o.env ?? process.env;
  if (!canFetchModpos(env)) return { status: "preview", days: [], left: null };
  // Anahtar yoksa veritabanına da gidilmez: adım yazılmaz, eski kota "hak doldu" demez (docs/MODPOS-API.md › Nerede görünür)
  if (modposKeyProblem(env)) return { status: "off", days: [], left: null };
  const started = o.now ?? new Date();
  // Verilen `now` bütün çalışmanın saatidir: sonraki istekler ve çalışmanın sonu ona geçen süre eklenerek (duvar saati
  // olsa ikinci günün kotası ve kesinliği başka bir güne göre yazılırdı; tests/modpos-db.test.ts)
  const wall0 = Date.now();
  const clock = () => (o.now ? new Date(o.now.getTime() + (Date.now() - wall0)) : new Date());
  const db = o.db ?? getDb();
  const [state, have] = await Promise.all([readModposState(db), loadModposIndex(db)]);
  let quota: ModposQuota | null = state.quota;
  const left0 = quotaLeft(quota, started);
  // Elle verilen günler tekilleşir: aynı gün iki kez istenip iki hak harcanmasın
  const wanted = o.days
    ? [...new Set(o.days)].filter((d) => requestableDay(d, started)).slice(0, Math.max(0, left0))
    : planFoyDays({ now: started, from: modposSyncFrom(env), have, left: left0 });
  if (!wanted.length) {
    // Hak dolduysa da çekilecek gün yoksa da istek gitmez; elle çekimde nedeni söylenir
    if (left0 <= 0) return { status: "kota", days: [], left: 0, error: "ModPOS'un bugünkü çekim hakkı doldu" };
    return { status: "nothing", days: [], left: left0 };
  }
  const days: ModposSyncDay[] = [];
  let lastOk: { at: string; day: string } | null = null;
  let lastError: ModposError | null = null;
  let stop: "kota" | "error" | null = null;
  let stopText: string | undefined;
  for (const day of wanted) {
    const remaining = o.deadlineAt - Date.now();
    if (remaining < MIN_REQUEST_MS) {
      // Hiçbir istek başlamadan süre bittiyse "çekilecek gün yok" değil: süre doldu (ertesi sabah yeniden denenir)
      if (!days.length) {
        stop = "error";
        stopText = "ModPOS föyü çekilemedi: süre doldu, sonra yeniden denenecek";
        lastError = { at: clock().toISOString(), day: null, kod: "SURE_DOLDU", text: stopText, keyError: false };
      }
      break;
    }
    const now = o.now && days.length === 0 ? o.now : clock();
    const r = await fetchKasaFoyu(day, { now, timeoutMs: remaining - 1_000, fetchImpl: o.fetchImpl, env });
    if (r.status === "off") return { status: "off", days: [], left: null };
    if (r.status === "ok") {
      // Başlık da föyün <kota>'sı da yoksa kalan hak elle düşülür (bir sonraki istek boşuna 429 almasın)
      quota = r.quota ?? { day: todayTR(now), hak: quota?.hak ?? MODPOS_DAILY_QUOTA, kalan: Math.max(0, quotaLeft(quota, now) - 1), yenilenme: null, at: now.toISOString() };
      const stored = await storeFoy(db, r.foy, now);
      days.push({ day, result: changeResult(stored.change), ...(stored.change === "degisti" ? { revision: stored.revision } : {}) });
      lastOk = { at: now.toISOString(), day };
      continue;
    }
    if (r.status === "kota") {
      quota = r.quota;
      lastError = { at: now.toISOString(), day, kod: "KOTA_DOLDU", text: r.text, keyError: false };
      stop = "kota";
      stopText = r.text;
      break;
    }
    if (r.quota) quota = r.quota;
    days.push({ day, result: "hata", text: r.text });
    lastError = { at: now.toISOString(), day, kod: r.kod, text: r.text, keyError: r.keyError };
    if (r.keyError || r.kod === "SERVIS_KULLANILAMIYOR" || r.kod === "COK_FAZLA_ISTEK" || r.http === 0) {
      stop = "error";
      stopText = r.text;
      break;
    }
  }
  const failed = days.filter((d) => d.result === "hata");
  const okCount = days.length - failed.length;
  const status: ModposSyncStatus =
    stop === "kota" ? (okCount ? "partial" : "kota") : failed.length || stop === "error" ? (okCount ? "partial" : "error") : days.length ? "ok" : "nothing";
  const endNow = clock();
  const run: ModposRun = {
    at: endNow.toISOString(),
    trigger,
    days: days.map((d) => ({ day: d.day, result: d.result })),
    status,
    text: stopText ?? failed[0]?.text ?? (days.length ? runDaysText(days, endNow) : null),
  };
  await noteModposRun(db, { quota, ...(lastOk ? { lastOk } : {}), ...(lastError ? { lastError } : lastOk ? { lastError: null } : {}) }, run);
  return { status, days, left: quota ? quotaLeft(quota, endNow) : null, ...(stopText || failed.length ? { error: stopText ?? failed[0]?.text } : {}) };
}

function changeResult(c: SheetChange): ModposDayResult {
  return c;
}
