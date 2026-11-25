import "server-only";

import { MODPOS_GROUP } from "@/lib/branch-settings/groups";
import { DEFAULT_BRANCH_ID, type BranchRow } from "@/lib/branches";
import type { ModposDayView } from "@/lib/modpos/ayarlar";
import { missingFoyDays, nextBackfillDay } from "@/lib/modpos/plan";
import { modposKeyProblem, modposSyncFrom, MODPOS_DAILY_QUOTA, quotaLeft } from "@/lib/modpos/request";
import { modposCardSummary, type ModposCardInput, type ModposCardSummary, type ModposRun } from "@/lib/modpos/status";
import { modposBranchIds, modposKeyEnv } from "@/lib/modpos/sube";
import { finalAfter, foyWarnings, foyZ } from "@/lib/modpos/z";
import { addDays, todayTR } from "@/lib/reminders";
import { resolveBranchSetting } from "@/server/branch-settings";
import { listBranches } from "@/server/branches";
import { getDb, type DB } from "@/server/db";
import { loadBranchSwitchDay } from "@/server/lafpos/branch";

import { loadModposFallback } from "./fallback";
import { loadModposIndex, readModposState, recentModposSheets } from "./store";
import { canFetchModpos, sharedKeyText } from "./sync";

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

export interface ModposCardData {
  /** Kartın şubesi (her ModPOS şubesinin kendi anahtarı, hakkı ve günleri var; docs/MODPOS-API.md › Şubeler) */
  branchId: string;
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
  /** Ay rakamına yedek (şube ayarı `modpos`; eski kayıt settings › modposAyYedegi; varsayılan kapalı) */
  fallback: boolean;
  /** Şube ay yedeğinde başka şubenin ayarını kullanıyorsa ("Tuzla ile aynı") o şube; anahtar burada değişmez */
  fallbackFrom?: { id: string; name: string } | null;
}

/**
 * Ay rakamına yedek ayarı (docs/MODPOS-API.md › Ay rakamına yedek), şube başına (src/server/modpos/fallback.ts): yalnız
 * `true` açık, satır yoksa ya da bozuksa kapalı
 */
export { loadModposFallback };

/** Şubenin kartının bütün verisi (varsayılan Tuzla); `env` testler için (varsayılan process.env) */
export async function loadModposCard(db: DB = getDb(), now: Date = new Date(), env: Env = process.env, branchId: string = DEFAULT_BRANCH_ID, branches?: BranchRow[]): Promise<ModposCardData> {
  const from = modposSyncFrom(env);
  const [state, index, recent, fallbackSetting, switchDay, all] = await Promise.all([
    readModposState(db, branchId),
    loadModposIndex(db, branchId),
    recentModposSheets(MODPOS_RECENT_DAYS, db, branchId),
    resolveBranchSetting(MODPOS_GROUP, branchId, db),
    // Geçiş günü yalnız LafPOS'un şubesinin kasasınındır (branchSwitchDay): ModPOS şubesinin föyü eksik sayılmaya devam eder
    loadBranchSwitchDay(branchId, db),
    branches ? Promise.resolve(branches) : listBranches(db),
  ]);
  const keyProblem = modposKeyProblem(env, branchId, modposBranchIds(all));
  const fallback = fallbackSetting.value.monthFallback;
  const fallbackFrom = fallbackSetting.mode.kind === "linked" ? { id: fallbackSetting.from, name: all.find((b) => b.id === fallbackSetting.from)?.name ?? fallbackSetting.from } : null;
  const sorted = [...index.keys()].sort();
  // LafPOS'a geçiş gününden itibaren föy çekilmez: eksik sayılmaz. Sıra sabah işininki (yeniden eskiye)
  const missing = missingFoyDays(from, index, now, switchDay);
  const input: ModposCardInput = {
    now,
    keyProblem,
    keyEnv: modposKeyEnv(branchId),
    ...(keyProblem === "shared" ? { sharedText: sharedKeyText(branchId, all) } : {}),
    preview: !canFetchModpos(env),
    state,
    from,
    stored: { count: sorted.length, first: sorted[0] ?? null, last: sorted.at(-1) ?? null },
    missing: missing.length,
    // Bir sonraki sabah işinin planından (en yeni eksik gün; bekleyen gün ve kesin föyün yeniden kontrolü
    // atlanır, o sabahın dünü değil). Bugünün sabah işi çalıştı mı: son çalışmalarda bugünün bir cron'u var mı
    next: missing.length
      ? nextBackfillDay({
          now,
          from,
          have: index,
          until: switchDay,
          failed: state.dayErrors,
          hak: state.quota?.hak ?? MODPOS_DAILY_QUOTA,
          leftToday: quotaLeft(state.quota, now),
          ranToday: state.lastCronAt !== null && todayTR(new Date(state.lastCronAt)) === todayTR(now),
        })
      : null,
  };
  const today = todayTR(now);
  return {
    branchId,
    input,
    summary: modposCardSummary(input),
    today,
    // Kesinleşmiş son gün: 07:00'den önce dün henüz kesin değil (çekilirse sabah işi yeniden çeker), önceki gün
    defaultDay: now.getTime() >= finalAfter(addDays(today, -1)) ? addDays(today, -1) : addDays(today, -2),
    days: recent.map((r) => ({ day: r.day, state: r.state, final: r.final, revision: r.revision, z: foyZ(r.foy), warnings: foyWarnings(r.foy) })),
    stored: Object.fromEntries([...index].map(([d, v]) => [d, v.final])),
    lastRun: state.runs[0] ?? null,
    fallback,
    fallbackFrom,
  };
}
