import "server-only";

import { eq } from "drizzle-orm";

import type { ModposDayView } from "@/lib/modpos/ayarlar";
import { missingFoyDays } from "@/lib/modpos/plan";
import { modposKeyProblem, modposSyncFrom } from "@/lib/modpos/request";
import { modposCardSummary, readModposFallback, MODPOS_FALLBACK_KEY, type ModposCardInput, type ModposCardSummary, type ModposRun } from "@/lib/modpos/status";
import { foyWarnings, foyZ } from "@/lib/modpos/z";
import { addDays, todayTR } from "@/lib/reminders";
import { getDb, schema as s, type DB } from "@/server/db";

import { loadModposIndex, readModposState, recentModposSheets } from "./store";
import { canFetchModpos } from "./sync";

/**
 * Ayarlar › ModPOS (kasa föyü) kartının verisi (docs/MODPOS-API.md › Nerede görünür): bağlantının durumu
 * (modposCardSummary'nin girdisi: anahtarın sorunu, önizleme mi, integration_state › modpos, geçmişin ilk günü, saklanan
 * ve eksik günler), son çekilen günler (Z özeti ve uyarılarıyla) ve ay rakamına yedek ayarı. Yalnız okur: sayfa açılışı
 * hiçbir zaman ModPOS'a istek göndermez (günde 2 hak; docs/MODPOS-API.md › Kota ve çekme sırası). Yalnız yönetici
 * (Ayarlar sayfası requireAdmin); föyün parası personele gitmez.
 */

/** Kartta listelenen son gün sayısı */
export const MODPOS_RECENT_DAYS = 14;

type Env = Record<string, string | undefined>;
/** Okuyucu: veritabanı ya da işlem (yalnız select) */
type Reader = Pick<DB, "select">;

export interface ModposCardData {
  /** Özetin girdisi (src/lib/modpos/status.ts) ve özeti */
  input: ModposCardInput;
  summary: ModposCardSummary;
  /** Bugün (TR, takvim günü): "Bu günü çek"in en geç günü */
  today: string;
  /** Tarih alanının ilk değeri: dün (TR) */
  defaultDay: string;
  /** Son çekilen günler, yeniden eskiye */
  days: ModposDayView[];
  /** Saklanan bütün günler ve kesin mi (onay penceresi "zaten var" desin) */
  stored: Record<string, boolean>;
  /** Son çalışma (sabah işi ya da elle) */
  lastRun: ModposRun | null;
  /** Ay rakamına yedek (settings › modposAyYedegi; varsayılan kapalı) */
  fallback: boolean;
}

/** Ay rakamına yedek ayarı (docs/MODPOS-API.md › Ay rakamına yedek): yalnız `true` açık, satır yoksa ya da bozuksa kapalı */
export async function loadModposFallback(db: Reader = getDb()): Promise<boolean> {
  const [row] = await db.select({ value: s.settings.value }).from(s.settings).where(eq(s.settings.key, MODPOS_FALLBACK_KEY)).limit(1);
  return readModposFallback(row?.value);
}

/** Kartın bütün verisi; `env` testler için (varsayılan process.env) */
export async function loadModposCard(db: DB = getDb(), now: Date = new Date(), env: Env = process.env): Promise<ModposCardData> {
  const [state, index, recent, fallback] = await Promise.all([readModposState(db), loadModposIndex(db), recentModposSheets(MODPOS_RECENT_DAYS, db), loadModposFallback(db)]);
  const sorted = [...index.keys()].sort();
  const from = modposSyncFrom(env);
  const input: ModposCardInput = {
    now,
    keyProblem: modposKeyProblem(env),
    preview: !canFetchModpos(env),
    state,
    from,
    stored: { count: sorted.length, first: sorted[0] ?? null, last: sorted.at(-1) ?? null },
    missing: missingFoyDays(from, index, now).length,
  };
  const today = todayTR(now);
  return {
    input,
    summary: modposCardSummary(input),
    today,
    defaultDay: addDays(today, -1),
    days: recent.map((r) => ({ day: r.day, state: r.state, final: r.final, revision: r.revision, z: foyZ(r.foy), warnings: foyWarnings(r.foy) })),
    stored: Object.fromEntries([...index].map(([d, v]) => [d, v.final])),
    lastRun: state.runs[0] ?? null,
    fallback,
  };
}
