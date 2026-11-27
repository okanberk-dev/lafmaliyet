import "server-only";

import { DEFAULT_BRANCH_ID, type BranchRow } from "@/lib/branches";
import { planFoyDays } from "@/lib/modpos/plan";
import { modposAnyKey, modposKeyProblem, modposSyncFrom, MODPOS_DAILY_QUOTA, quotaLeft, requestableDay, type ModposQuota } from "@/lib/modpos/request";
import { todayTR } from "@/lib/reminders";
import { runDaysText, type ModposDayResult, type ModposError, type ModposRun, type ModposTrigger } from "@/lib/modpos/status";
import { combineModposResults, modposBranchIds, modposKeyEnv, parseModposSubeMap, resolveModposSube, splitFoyByBranch, splitNoticeText } from "@/lib/modpos/sube";
import { listBranches } from "@/server/branches";
import { getDb, type DB } from "@/server/db";
import { loadBranchSwitchDay } from "@/server/asilpos/branch";

import { fetchKasaFoyu } from "./client";
import { loadModposIndex, noteModposRun, readModposState, releaseModposLease, storeFoy, takeModposLease, type SheetChange } from "./store";

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
 * - **Şube başına** (docs/MODPOS-API.md › Şubeler; src/lib/modpos/sube.ts): her çalışma tek şubenin anahtarıyla, o
 *   şubenin hakkı, kirası, durumu ve saklanan günleriyle yürür. Gelen föy kasaların şube adına göre ayrılır, her parça
 *   kendi şubesinin gününe yazılır; çekenin şubesi hep yazılır (kasası yoksa boş föy). Sabah işi bütün ModPOS
 *   şubelerini sırayla çeker (syncModposAll).
 */

export interface ModposSyncDay {
  day: string;
  /** Çeken şube (sabah işinin birleşik sonucunda günler şubeyle ayrılır) */
  branchId?: string;
  result: ModposDayResult;
  text?: string;
  /** Alınamadıysa servisin ya da istemcinin kodu */
  kod?: string;
  /** Değiştiyse yeni sürüm */
  revision?: number;
}

export type ModposSyncStatus = "off" | "preview" | "busy" | "nothing" | "ok" | "partial" | "kota" | "error";

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
  /** Hangi şubenin anahtarıyla (varsayılan Tuzla) */
  branchId?: string;
  /** Şube kütüğü (verilmezse okunur): föyün ayrılması ve ortak anahtar denetimi için */
  branches?: BranchRow[];
}

/** Önizlemeler canlının veritabanını ve ModPOS hakkını paylaşır: hiçbir şey çekmez, yazmaz */
export function canFetchModpos(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV !== "preview";
}

const MIN_REQUEST_MS = 5_000;

export async function syncModpos(trigger: ModposTrigger, o: SyncOptions): Promise<ModposSyncResult> {
  const env = o.env ?? process.env;
  const branchId = o.branchId ?? DEFAULT_BRANCH_ID;
  if (!canFetchModpos(env)) return { status: "preview", days: [], left: null };
  // Anahtar yoksa veritabanına da gidilmez: adım yazılmaz, eski kota "hak doldu" demez (docs/MODPOS-API.md › Nerede görünür)
  const own = modposKeyProblem(env, branchId);
  if (own === "missing" || own === "format") return { status: "off", days: [], left: null };
  const db = o.db ?? getDb();
  const branches = o.branches ?? (await listBranches(db));
  const peers = modposBranchIds(branches);
  // Başka şubenin anahtarıyla aynı anahtar: o şubenin föyü bu şubenin günü diye yazılırdı (src/lib/modpos/sube.ts)
  if (modposKeyProblem(env, branchId, peers) === "shared") {
    return { status: "error", days: [], left: null, error: sharedKeyText(branchId, branches) };
  }
  // Aynı anda tek çekim (sabah işi iki kez tetiklenirse, "Bu günü çek" sabah işiyle çakışırsa): ikinci "busy" döner,
  // istek göndermez. Kira duvar saatiyle (çalışmanın verilen saati değil); şube başına (her şubenin kendi hakkı)
  const lease = await takeModposLease(db, undefined, branchId);
  if (!lease) return { status: "busy", days: [], left: null, error: "Başka bir ModPOS çekimi sürüyor: biraz sonra yeniden deneyin" };
  try {
    return await runSync(trigger, o, env, db, { branchId, branches, peers });
  } finally {
    await releaseModposLease(db, lease, branchId);
  }
}

/** Şubenin adı (kütükte yoksa kimliği) */
const nameOf = (id: string, branches: readonly BranchRow[]) => branches.find((b) => b.id === id)?.name ?? id;

/** Ortak anahtarın metni (Ayarlar kartı ve sabah işi) */
export function sharedKeyText(branchId: string, branches: readonly BranchRow[]): string {
  return `${modposKeyEnv(branchId)} başka bir şubenin ModPOS anahtarıyla aynı: ${nameOf(branchId, branches)} için Gafdigi'den şubenin kendi anahtarını alıp Vercel'e yazın (aynı anahtarla şubeler karışırdı)`;
}

/**
 * Sabah işi: ModPOS'lu her şube (açık, fiziksel, kasası ModPOS; src/lib/modpos/sube.ts modposBranchIds) kendi
 * anahtarıyla sırayla çekilir; anahtarı tanımlı olmayan şube atlanır. Süre bütün şubelerin ortak sınırıdır. Sonuç tek
 * adım (combineModposResults): bir şubenin hatası ötekini durdurmaz.
 */
export async function syncModposAll(trigger: ModposTrigger, o: SyncOptions): Promise<ModposSyncResult> {
  const env = o.env ?? process.env;
  if (!canFetchModpos(env)) return { status: "preview", days: [], left: null };
  if (!modposAnyKey(env)) return { status: "off", days: [], left: null };
  const db = o.db ?? getDb();
  const branches = o.branches ?? (await listBranches(db));
  const runs: Parameters<typeof combineModposResults<ModposSyncDay>>[0][number][] = [];
  for (const id of modposBranchIds(branches)) {
    if (modposKeyProblem(env, id) === "missing") continue;
    const result = await syncModpos(trigger, { ...o, env, db, branches, branchId: id }).catch(
      (e: Error): ModposSyncResult => ({ status: "error", days: [], left: null, error: e.message }),
    );
    runs.push({ branchId: id, name: nameOf(id, branches), result: { ...result, days: result.days.map((d) => ({ ...d, branchId: id })) } });
  }
  return combineModposResults(runs);
}

/** Alınamayan gün yanıtı 2xx ise (bozuk, büyük, yarıda kesik) sorun büyük olasılıkla her günde aynıdır: çalışma durur, ikinci hak harcanmaz */
const SYSTEMIC = new Set(["BOZUK", "BUYUK", "BAGLANTI"]);

interface BranchContext {
  branchId: string;
  branches: BranchRow[];
  /** ModPOS'lu şubeler, sırayla */
  peers: string[];
}

async function runSync(trigger: ModposTrigger, o: SyncOptions, env: Record<string, string | undefined>, db: DB, b: BranchContext): Promise<ModposSyncResult> {
  const { branchId } = b;
  // Föyün ayrılması: kasanın şube adı → panelin şubesi; kendi anahtarı olan şubenin kasası bu föyden alınmaz
  const subeMap = parseModposSubeMap(env);
  const resolve = (sube: string) => resolveModposSube(sube, b.branches, subeMap);
  const keyed = new Set(b.peers.filter((id) => modposKeyProblem(env, id, b.peers) === null));
  const notices = new Set<string>();
  const started = o.now ?? new Date();
  // Verilen `now` bütün çalışmanın saatidir: sonraki istekler ve çalışmanın sonu ona geçen süre eklenerek (duvar saati
  // olsa ikinci günün kotası ve kesinliği başka bir güne göre yazılırdı; tests/modpos-db.test.ts)
  const wall0 = Date.now();
  const clock = () => (o.now ? new Date(o.now.getTime() + (Date.now() - wall0)) : new Date());
  const from = modposSyncFrom(env);
  // AsilPOS'a geçiş günü yalnız AsilPOS'un şubesinin kasasınındır: ModPOS'ta kalan şubenin (Tuzla) föyü çekilmeye devam
  // eder (branchSwitchDay; denetim 21 Kasım #5)
  const [state, have, switchDay] = await Promise.all([
    readModposState(db, branchId),
    loadModposIndex(db, branchId),
    loadBranchSwitchDay(branchId, db),
  ]);
  if (trigger === "cron") {
    // Sabah işinin çalıştığı an (istek gitmese de): kartın "sıradaki"si bugünün işi çalıştı mı diye bakar
    await noteModposRun(db, { lastCronAt: started.toISOString() }, null, undefined, branchId);
  }
  let quota: ModposQuota | null = state.quota;
  const left0 = quotaLeft(quota, started);
  // Elle verilen günler tekilleşir: aynı gün iki kez istenip iki hak harcanmasın
  const plan = (now: Date, left: number, failed: typeof state.dayErrors) =>
    planFoyDays({ now, from, have, left, until: switchDay, failed });
  const wanted = o.days ? [...new Set(o.days)].filter((d) => requestableDay(d, started)).slice(0, Math.max(0, left0)) : plan(started, left0, state.dayErrors);
  if (!wanted.length) {
    // Hak dolduysa da çekilecek gün yoksa da istek gitmez; elle çekimde nedeni söylenir
    if (left0 <= 0) return { status: "kota", days: [], left: 0, error: "ModPOS API'nin bugünkü çekim hakkı doldu" };
    return { status: "nothing", days: [], left: left0 };
  }
  const days: ModposSyncDay[] = [];
  let lastOk: { at: string; day: string } | null = null;
  let lastError: ModposError | null = null;
  let stop: "kota" | "error" | null = null;
  let stopText: string | undefined;
  // Hakkı geri veren hata (400'ler hak düşürmez, 500'de hak geri verilir; belge §4): sabah işinde o hak sıradaki güne
  // gider (en çok MODPOS_DAILY_QUOTA kez; elle çekimde verilen gün dışında gün çekilmez)
  const queue = [...wanted];
  let extra = 0;
  const failedNow: Record<string, { count: number; lastAt: string; kod: string }> = { ...state.dayErrors };
  for (let i = 0; i < queue.length; i++) {
    const day = queue[i];
    const remaining = o.deadlineAt - Date.now();
    if (remaining < MIN_REQUEST_MS) {
      // Hiçbir istek başlamadan süre bittiyse "çekilecek gün yok" değil: süre doldu (ertesi sabah yeniden denenir)
      if (!days.length) {
        stop = "error";
        stopText = "ModPOS API verisi çekilemedi: süre doldu, sonra yeniden denenecek";
        lastError = { at: clock().toISOString(), day: null, kod: "SURE_DOLDU", text: stopText, keyError: false };
      }
      break;
    }
    const now = o.now && days.length === 0 ? o.now : clock();
    const r = await fetchKasaFoyu(day, { now, timeoutMs: remaining - 1_000, fetchImpl: o.fetchImpl, env, branchId });
    if (r.status === "off") return { status: "off", days: [], left: null };
    if (r.status === "ok") {
      // Başlık da föyün <kota>'sı da yoksa kalan hak elle düşülür (bir sonraki istek boşuna 429 almasın)
      quota = r.quota ?? { day: todayTR(now), hak: quota?.hak ?? MODPOS_DAILY_QUOTA, kalan: Math.max(0, quotaLeft(quota, now) - 1), yenilenme: null, at: now.toISOString() };
      // Şube şube: çekenin föyü (ham XML'iyle) ve föyde kasası olan öteki şubelerinki, her biri kendi gününe
      const split = splitFoyByBranch(r.foy, { own: branchId, resolve, keyed });
      const stored = await storeFoy(db, split.parts.get(branchId)!, now, r.raw, branchId);
      for (const [id, part] of split.parts) if (id !== branchId) await storeFoy(db, part, now, null, id);
      const notice = splitNoticeText(split);
      if (notice) notices.add(notice);
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
    days.push({ day, result: "hata", text: r.text, kod: r.kod });
    lastError = { at: now.toISOString(), day, kod: r.kod, text: r.text, keyError: r.keyError };
    if (r.keyError || r.kod === "SERVIS_KULLANILAMIYOR" || r.kod === "COK_FAZLA_ISTEK" || r.http === 0 || (r.http >= 200 && r.http < 300 && SYSTEMIC.has(r.kod))) {
      stop = "error";
      stopText = r.text;
      break;
    }
    const refunded = (r.http >= 400 && r.http < 500 && r.http !== 429) || r.http === 500;
    if (!o.days && refunded && extra < MODPOS_DAILY_QUOTA) {
      // Alınamayan gün bu çalışmada beklemeye girer (planlayıcı onu yeniden önermesin); sıradaki çekilmemiş gün eklenir
      failedNow[day] = { count: (failedNow[day]?.count ?? 0) + 1, lastAt: now.toISOString(), kod: r.kod };
      const next = plan(now, queue.length + 1, failedNow).find((d) => !queue.includes(d));
      if (next) {
        queue.push(next);
        extra++;
      }
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
    text: [stopText ?? failed[0]?.text ?? (days.length ? runDaysText(days, endNow) : null), ...notices].filter(Boolean).join(" · ") || null,
  };
  // Gün hataları: alınan gün silinir, alınamayanın sayısı artar (planlayıcı onu bekletir; anahtar hatası güne yazılmaz)
  const dayResults = {
    ok: days.filter((d) => d.result !== "hata").map((d) => d.day),
    failed: days.filter((d) => d.result === "hata" && !(lastError?.keyError && lastError.day === d.day)).map((d) => ({ day: d.day, kod: d.kod ?? "HATA" })),
  };
  await noteModposRun(db, { quota, ...(lastOk ? { lastOk } : {}), ...(lastError ? { lastError } : lastOk ? { lastError: null } : {}) }, run, dayResults, branchId);
  return { status, days, left: quota ? quotaLeft(quota, endNow) : null, ...(stopText || failed.length ? { error: stopText ?? failed[0]?.text } : {}) };
}

function changeResult(c: SheetChange): ModposDayResult {
  return c;
}
