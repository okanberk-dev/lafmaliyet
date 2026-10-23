import "server-only";

import { and, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";

import { monthLabel } from "@/lib/format";
import {
  historyCancelledAt,
  historyChanged,
  historyPlan,
  historyProgress,
  historyValues,
  parseHistoryState,
  personalDataCutoff,
  recordHistoryMonth,
  retryAfterMs,
  writeErrorText,
  type HistoryResult,
  type HistoryState,
  type HistoryWindow,
} from "@/lib/karaoke/history";
import { parseSiteResponse, type SiteSnapshot } from "@/lib/karaoke/site";
import { fetchFailure, karaokePullError } from "@/lib/karaoke/sync-text";
import { todayTR } from "@/lib/reminders";
import { getDb, schema as s } from "@/server/db";
import { signedSiteFetch, SITE_TIMEOUT_MS } from "@/server/site-link";

import { bumpKaraokeVersion } from "./board";
import { errorCodeOf, explain, karaokeSecret, siteUrl, syncKaraoke, type SyncResult } from "./sync";

/**
 * Karaoke geçmişi (sunucu; kurallar src/lib/karaoke/history.ts): laffogato.net'in geçmiş rezervasyonlarını ay ay alır
 * ("Geçmişi siteden al", Doluluk ekranı) ve KVKK saklama süresi dolan oturumların adını ve notunu siler (sabah işi).
 * Düzenli eşitleme (sync.ts) dünden sonrasına bakar; bu ondan önceki günlere. Ayrıntı: docs/KARAOKE.md › Doluluk haritası.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const STATE_KEY = "karaoke_history";
/** Bir pencereye bu kadar süre kalmadıysa başlanmaz: sitenin 8 sn sınırı ve yazma payı */
const WINDOW_BUDGET_MS = SITE_TIMEOUT_MS + 1_000;

export async function readHistoryState(): Promise<HistoryState> {
  const [row] = await getDb().select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, STATE_KEY)).limit(1);
  return parseHistoryState(row?.value);
}

/** Durumu satır kilidiyle değiştirir (ayların kaydı iki çalışmada birbirini silmesin); `tx` verilirse onun içinde */
async function updateHistory(change: (st: HistoryState) => HistoryState, tx?: Tx): Promise<HistoryState> {
  const run = async (t: Tx) => {
    const [row] = await t.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, STATE_KEY)).for("update");
    const value = change(parseHistoryState(row?.value));
    await t
      .insert(s.integrationState)
      .values({ key: STATE_KEY, value })
      .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
    return value;
  };
  return tx ? run(tx) : getDb().transaction(run);
}

class SiteError extends Error {}

/** Sitenin hata yanıtının açıklaması: geçmişte 400 tarih penceresinin reddidir; 503'te gövdedeki kod (anahtar mı, veritabanı mı) */
function siteErrorText(status: number, code: string | null): string {
  if (status === 400 || status === 422) return "Site geçmiş tarihleri vermiyor (laffogato.net'in panel ucu güncellenmeli)";
  if (status === 429) return "Site çok sık istek geldiğini söyledi; birkaç dakika sonra yeniden deneyin";
  return explain(status, code);
}

/** Bir ayın penceresi; 429'da sitenin söylediği kadar (en çok 10 sn) bekleyip bir kez daha sorar */
async function fetchWindow(secret: string, w: HistoryWindow, deadline: number): Promise<SiteSnapshot> {
  const url = new URL("/api/panel/karaoke", siteUrl());
  url.searchParams.set("from", w.from);
  url.searchParams.set("to", w.to);
  for (let attempt = 0; ; attempt++) {
    const res = await signedSiteFetch(secret, url);
    if (res.status === 429 && attempt === 0) {
      const wait = retryAfterMs(res.headers.get("retry-after"));
      if (wait !== null && Date.now() + wait < deadline - WINDOW_BUDGET_MS) {
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
    }
    if (!res.ok) throw new SiteError(siteErrorText(res.status, await errorCodeOf(res)));
    try {
      return parseSiteResponse(await res.json());
    } catch (e) {
      // Gövde okunurken dolan süre zaman aşımıdır (8 sn), bozuk yanıt değil
      if (e instanceof Error && e.name === "TimeoutError") throw e;
      throw new SiteError("Sitenin yanıtı okunamadı");
    }
  }
}

/** Bir ayın rezervasyonlarını yazar: yeni satır adsız ve notsuz, var olanın yalnız rezervasyon sütunları; silme yok */
async function applyWindow(tx: Tx, w: HistoryWindow, snapshot: SiteSnapshot, now: Date): Promise<{ count: number; created: number; updated: number }> {
  const k = s.karaokeSessions;
  // Pencerenin dışındaki satır yazılmaz (düzenli eşitlemenin günlerine girmesin)
  const list = [...new Map(snapshot.reservations.filter((r) => r.date >= w.from && r.date <= w.to).map((r) => [r.id, r])).values()];
  const existing = list.length
    ? await tx
        .select({
          id: k.id,
          externalId: k.externalId,
          date: k.date,
          startsAt: k.startsAt,
          endsAt: k.endsAt,
          guests: k.guests,
          status: k.status,
          paymentStatus: k.paymentStatus,
          totalMinor: k.totalMinor,
          channel: k.channel,
          bookedAt: k.bookedAt,
          cancelledAt: k.cancelledAt,
        })
        .from(k)
        .where(inArray(k.externalId, list.map((r) => r.id)))
    : [];
  const byExt = new Map(existing.map((r) => [r.externalId, r]));
  const inserts: (typeof k.$inferInsert)[] = [];
  let updated = 0;
  for (const r of list) {
    const prev = byExt.get(r.id);
    const values = { ...historyValues(r), cancelledAt: historyCancelledAt(prev ?? null, r, now) };
    if (!prev) {
      // KVKK: geçmiş yalnız istatistik için; ad ve not alınmaz
      inserts.push({ ...values, customerName: null, note: null });
      continue;
    }
    if (!historyChanged(prev, values)) continue;
    await tx
      .update(k)
      .set({ ...values, updatedAt: now })
      .where(eq(k.id, prev.id));
    updated++;
  }
  const created = inserts.length ? (await tx.insert(k).values(inserts).onConflictDoNothing().returning({ id: k.id })).length : 0;
  return { count: list.length, created, updated };
}

/**
 * Geçmişi siteden alır: ay ay, en yeni aydan (pencere başına bir imzalı istek, en çok 31 gün; sitenin sınırı 400 gün).
 * `deadline`a yetmeyen ay bir sonraki çalışmaya kalır ("Devam et"). Her ay düzenli eşitlemeyle aynı kilitle tek
 * işlemde yazılır; zil çalmaz, bildirim gitmez, eşitlemenin durumuna dokunulmaz.
 */
export async function importKaraokeHistory(opts: { deadline: number }): Promise<HistoryResult> {
  const secret = karaokeSecret();
  if (!secret) return { status: "off" };
  const today = todayTR();
  // Son gün burada yazılmaz: ilk ayla birlikte (recordHistoryMonth); hiç ay okunmazsa durum yalnız son denemeyi taşır
  const plan = historyPlan(await readHistoryState(), today);

  const read: string[] = [];
  let reservations = 0;
  let created = 0;
  let updated = 0;
  let error: string | null = null;
  let next = 0;
  for (; next < plan.windows.length; next++) {
    if (Date.now() > opts.deadline - WINDOW_BUDGET_MS) break;
    const w = plan.windows[next];
    let snapshot: SiteSnapshot;
    try {
      snapshot = await fetchWindow(secret, w, opts.deadline);
    } catch (e) {
      if (e instanceof SiteError) error = e.message;
      else {
        // Ağ hatası ve zaman aşımı düzenli eşitlemenin sözleriyle (sync-text.ts); ham metin ("fetch failed") yalnız günlükte
        error = karaokePullError(fetchFailure(e));
        console.warn("[karaoke] geçmiş:", e instanceof Error ? e.message : e);
      }
      break;
    }
    if (!snapshot.complete) {
      error = `Site ${monthLabel(w.month)} için eksik yanıt verdi`;
      break;
    }
    const now = new Date();
    // Yazım hatası da (bağlantı koptu, zaman aşımı) aynı yoldan biter: önceki aylar zaten yazıldı, son deneme kaydedilmeli
    // ve açık sekmeler o satırları görmeli (sürüm artışı). Bu ayın işlemi bütünüyle geri alınır, "Devam et" ondan sürer.
    let r: Awaited<ReturnType<typeof applyWindow>>;
    try {
      r = await getDb().transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('karaoke-sync'))`);
        const out = await applyWindow(tx, w, snapshot, now);
        await updateHistory((st) => recordHistoryMonth(st, plan.through, w.month, { count: out.count, at: now.toISOString() }), tx);
        return out;
      });
    } catch (e) {
      error = writeErrorText(e);
      break;
    }
    read.push(w.month);
    reservations += r.count;
    created += r.created;
    updated += r.updated;
  }

  const state = await updateHistory((st) => ({ ...st, lastRunAt: new Date().toISOString(), lastError: error ? error.slice(0, 300) : null }));
  if (created || updated) await bumpKaraokeVersion();
  const progress = historyProgress(state, today);
  const remaining = plan.windows.slice(next).map((w) => w.month);
  return {
    status: error ? "error" : remaining.length ? "partial" : "ok",
    reread: plan.reread,
    read,
    remaining,
    done: progress.done,
    total: progress.total,
    reservations,
    created,
    updated,
    error,
  };
}

// ---------------------------------------------------------------- KVKK

/**
 * Saklama süresi (3 × 366 gün, sitenin kuralı) dolan oturumların adını ve notunu siler; satır istatistik için kalır.
 * İki kaynak da: sayacın etiketi de bir ad olabilir. İşlem geçmişine dokunmaz (docs/KARAOKE.md › KVKK). Silinen satır
 * sayısını döner.
 */
export async function clearOldKaraokePersonalData(now = new Date()): Promise<number> {
  const k = s.karaokeSessions;
  const rows = await getDb()
    .update(k)
    .set({ customerName: null, note: null, updatedAt: now })
    .where(and(lt(k.date, personalDataCutoff(todayTR(now))), or(isNotNull(k.customerName), isNotNull(k.note))))
    .returning({ id: k.id });
  return rows.length;
}

/**
 * Sabah işinin karaoke adımı: eşitleme ve KVKK temizliği yan yana (biri bozulsa öteki çalışır). Temizlik hata verirse
 * adım hata olur (Ayarlar › Günlük işler'de "Karaoke eşitlemesi: KVKK temizliği: …").
 */
export async function dailyKaraoke(): Promise<SyncResult> {
  const [sync, kvkk] = await Promise.all([
    syncKaraoke("cron").catch((e: Error): SyncResult => ({ status: "error", error: e.message })),
    clearOldKaraokePersonalData().then(
      () => null,
      (e: Error) => e.message,
    ),
  ]);
  if (kvkk !== null && sync.status !== "error") return { status: "error", error: `KVKK temizliği: ${kvkk}` };
  return sync;
}
