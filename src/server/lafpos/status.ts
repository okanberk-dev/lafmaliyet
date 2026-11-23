import "server-only";

import { and, asc, count, countDistinct, desc, eq, gte, inArray, isNull, lt, sql, sum } from "drizzle-orm";

import { businessDate } from "@/lib/cash-report";
import { readLafposSwitchDay } from "@/lib/constants";
import { unmatchedIkramNames } from "@/lib/lafpos/ikram";
import { lafposSecretProblem } from "@/lib/lafpos/request";
import {
  isDayRejection,
  LAFPOS_STATE_KEY,
  missingLafposDays,
  parseLafposState,
  peekPosDay,
  withDayRejection,
  type LafposCardInput,
  type LafposOk,
  type LafposRejection,
  type LafposState,
} from "@/lib/lafpos/status";
import { isLafposDay, LAFPOS_BRANCH_ID, LAFPOS_SWITCH_KEY } from "@/lib/lafpos/switch";
import { addDays } from "@/lib/reminders";
import { closedDaysBetween } from "@/server/closed-days";
import { loadLafposIkram } from "@/server/data/lafpos-ikram";
import { getDb, schema as s, type DB } from "@/server/db";

import { receivePosDay, type EndpointResult } from "./ingest";

/**
 * LafPOS bağlantısının durumu ve onarımı (docs/LAFPOS.md › Durum ve onarım): `POST /api/pos/gun`'un her sonucu burada
 * `integration_state › lafpos`'a yazılır (son başarılı gün, son ret, güne göre açık retler, imzası doğrulanamayan
 * isteklerin sayacı), 200
 * yanıtına geçiş gününe göre `counted` ve `switchDay` eklenir; Ayarlar'daki "LafPOS (kasa)" kartının verisi de buradan
 * okunur. Gün sonunun denetimi ve yazımı ingest.ts'te (değişmedi). Durum yazımı hiçbir zaman yanıtı bozmaz.
 */

/** Kayıtlı geçiş günü (ayarlar tablosunun tek satırı; yoksa ya da bozuksa null = kasa ModPOS) */
export async function loadLafposSwitchDay(db: DB = getDb()): Promise<string | null> {
  const [row] = await db.select({ value: s.settings.value }).from(s.settings).where(eq(s.settings.key, LAFPOS_SWITCH_KEY)).limit(1);
  return readLafposSwitchDay(row?.value);
}

export async function readLafposState(db: DB = getDb()): Promise<LafposState> {
  const [row] = await db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, LAFPOS_STATE_KEY)).limit(1);
  return parseLafposState(row?.value);
}

/** Üst düzey alanları birleştirerek yazar (aynı anda iki sonuç birbirinin alanını ezmez); hata yanıtı bozmaz */
async function patchState(db: DB, patch: Partial<Record<keyof LafposState, unknown>>): Promise<void> {
  try {
    await db.execute(sql`
      insert into integration_state (key, value) values (${LAFPOS_STATE_KEY}, ${JSON.stringify(patch)}::jsonb)
      on conflict (key) do update set value = integration_state.value || ${JSON.stringify(patch)}::jsonb, updated_at = now()`);
  } catch (e) {
    console.error("[lafpos] durum yazılamadı:", e instanceof Error ? e.message : e);
  }
}

/** 200: son başarılı gün; o günün açık reddi (409 / 400) kapanır, gün yeniden yazıldı. Hata yanıtı bozmaz */
async function noteOk(db: DB, ok: LafposOk): Promise<void> {
  try {
    await db.execute(sql`
      insert into integration_state (key, value) values (${LAFPOS_STATE_KEY}, jsonb_build_object('lastOk', ${JSON.stringify(ok)}::jsonb))
      on conflict (key) do update set value = (integration_state.value #- array['rejections', ${ok.date}::text]) || jsonb_build_object('lastOk', ${JSON.stringify(ok)}::jsonb),
        updated_at = now()`);
  } catch (e) {
    console.error("[lafpos] durum yazılamadı:", e instanceof Error ? e.message : e);
  }
}

/**
 * Günlü 400 / 409: son ret olarak ve güne göre (`rejections`, aynı günün eskisinin yerine, en çok MAX_DAY_REJECTIONS)
 * yazılır. LafPOS bunları yeniden denemez; sonraki günün başarılı gönderimi ya da başka bir günün reddi bu günün
 * reddini örtmesin. Satır kilitlenir (aynı anda iki ret birbirinin gününü düşürmez); öteki alanlar üst düzey birleştirmeyle
 * korunur. Hata yanıtı bozmaz.
 */
async function noteDayRejection(db: DB, e: LafposRejection & { date: string }): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`insert into integration_state (key, value) values (${LAFPOS_STATE_KEY}, '{}'::jsonb) on conflict (key) do nothing`);
      const [row] = await tx
        .select({ value: s.integrationState.value })
        .from(s.integrationState)
        .where(eq(s.integrationState.key, LAFPOS_STATE_KEY))
        .for("update")
        .limit(1);
      const rejections = withDayRejection(parseLafposState(row?.value).rejections, e);
      await tx.execute(sql`
        update integration_state set value = value || ${JSON.stringify({ lastError: e, rejections })}::jsonb, updated_at = now()
         where key = ${LAFPOS_STATE_KEY}`);
    });
  } catch (err) {
    console.error("[lafpos] durum yazılamadı:", err instanceof Error ? err.message : err);
  }
}

/**
 * İmzası doğrulanamayan istekler (401, 413) gövdesiz sayılır ve yazımı örnek başına en çok `windowMs`'de bir yapılır:
 * imzasız istek yağmuru veritabanına yazım yağmuru olmasın. Aradaki istekler bellekte birikir, sonraki yazımda sayaca
 * eklenir (örnek kapanırsa birkaçı kaybolabilir; sayaç yaklaşık, son anı doğru).
 */
const unverifiedBuffer = { pending: 0, lastFlush: 0 };

export async function noteUnverified(db: DB, status: 401 | 413, now: Date = new Date(), windowMs = 60_000): Promise<void> {
  console.warn("[lafpos] reddedildi", status, status === 401 ? "unauthorized" : "too_large");
  unverifiedBuffer.pending += 1;
  if (now.getTime() - unverifiedBuffer.lastFlush < windowMs) return;
  const n = unverifiedBuffer.pending;
  unverifiedBuffer.pending = 0;
  unverifiedBuffer.lastFlush = now.getTime();
  try {
    const at = now.toISOString();
    await db.execute(sql`
      insert into integration_state (key, value)
        values (${LAFPOS_STATE_KEY}, jsonb_build_object('unverified', jsonb_build_object('count', ${n}::int, 'lastAt', ${at}::text, 'lastStatus', ${status}::int)))
      on conflict (key) do update set value = integration_state.value || jsonb_build_object('unverified', jsonb_build_object(
        'count', coalesce((integration_state.value->'unverified'->>'count')::int, 0) + ${n}::int,
        'lastAt', ${at}::text,
        'lastStatus', ${status}::int)), updated_at = now()`);
  } catch (e) {
    console.error("[lafpos] durum yazılamadı:", e instanceof Error ? e.message : e);
  }
}

/** Testler: sayaç tamponunu boşaltır */
export function resetUnverifiedBuffer() {
  unverifiedBuffer.pending = 0;
  unverifiedBuffer.lastFlush = 0;
}

type PosDayInput = Parameters<typeof receivePosDay>[1];

/**
 * `POST /api/pos/gun`'un sonucu (uç bunu çağırır): gün sonunu receivePosDay'e verir, sonucu durum satırına yazar.
 * 200'e `counted` (gün geçiş gününden önce değil: hesaplara giriyor) ve `switchDay` eklenir; LafPOS yanıtın gövdesini
 * okumaz, eklenen alanlar eski LafPOS'u etkilemez; o günün açık reddi kapanır. 400 ve 409 son ret olarak (alan, gün, iki Z
 * no) ve günü okunduysa güne göre yazılır, gövdesiz günlüğe düşer; 401 ve 413 yalnız sayaçtır; 503'te (anahtar yok)
 * hiçbir şey yazılmaz. Veritabanı hatası son ret olarak yazılmaya çalışılır ve yeniden fırlar (uç 500 döner, LafPOS
 * yeniden dener).
 */
export async function handlePosDay(db: DB, input: PosDayInput, now: Date = new Date(), opts: { unverifiedWindowMs?: number } = {}): Promise<EndpointResult> {
  const at = now.toISOString();
  let r: EndpointResult;
  try {
    r = await receivePosDay(db, input, now);
  } catch (e) {
    const sent = peekPosDay(input.body);
    console.warn("[lafpos] reddedildi", 500, "server_error", sent.date ?? "-", sent.zNo ?? "-");
    await patchState(db, { lastError: rejection(at, 500, "server_error", { date: sent.date, sentZNo: sent.zNo }) });
    throw e;
  }
  if (r.status === 503) return r;
  if (r.status === 401 || r.status === 413) {
    await noteUnverified(db, r.status, now, opts.unverifiedWindowMs);
    return r;
  }
  const sent = peekPosDay(input.body);
  if (r.status === 200) {
    const date = String(r.body.date);
    let switchDay: string | null;
    try {
      switchDay = await loadLafposSwitchDay(db);
    } catch (e) {
      // Gün yazıldı; geçiş günü okunamadıysa yanıt yine 200, yalnız ek alanlar yok
      console.error("[lafpos] geçiş günü okunamadı:", e instanceof Error ? e.message : e);
      return r;
    }
    const counted = isLafposDay(date, switchDay);
    await noteOk(db, { at, date, zNo: sent.zNo, lines: Number(r.body.lines ?? 0), counted });
    return { status: 200, body: { ...r.body, counted, switchDay } };
  }
  const error = String(r.body.error ?? "unknown");
  const date = typeof r.body.date === "string" ? r.body.date : sent.date;
  const zNo = typeof r.body.zNo === "number" ? r.body.zNo : null;
  console.warn("[lafpos] reddedildi", r.status, error, date ?? "-", zNo ?? "-");
  const e = rejection(at, r.status, error, { field: typeof r.body.field === "string" ? r.body.field : null, date, zNo, sentZNo: error === "z_conflict" ? sent.zNo : null });
  // Yanlış şube: kasanın şubesi ve beklenen kartta yazılsın (rejectionText)
  if (error === "wrong_branch") Object.assign(e, { sube: typeof r.body.sube === "string" ? r.body.sube : null, expected: typeof r.body.expected === "string" ? r.body.expected : null });
  if (isDayRejection(e)) await noteDayRejection(db, e);
  else await patchState(db, { lastError: e });
  return r;
}

function rejection(at: string, status: number, error: string, o: Partial<Omit<LafposRejection, "at" | "status" | "error">>): LafposRejection {
  return { at, status, error, field: o.field ?? null, date: o.date ?? null, zNo: o.zNo ?? null, sentZNo: o.sentZNo ?? null, clearedAt: null };
}

// ---------------------------------------------------------------- Ayarlar kartı

/** Kartın gün listesinde bir LafPOS günü (yalnız yöneticinin ekranı) */
export interface LafposDayRow {
  date: string;
  zNo: number;
  zTotal: number;
  receipts: number;
  lines: number;
  receivedAt: string;
  counted: boolean;
}

export interface LafposCardData extends LafposCardInput {
  /** En yeni günler (tarihe göre, en çok 14) */
  days: LafposDayRow[];
  /** Ürüne bağlanamayan POS adları (hizmet satırları hariç): en çok satılan 10 ad ve toplam sayı */
  unmatched: { posName: string; qty: number; days: number }[];
  unmatchedCount: number;
  /**
   * İkramda (ve LafPOS'ta zayi yazılan satırlarda) ürüne bağlanamayan POS adları, geçiş gününden itibaren: yalnız ikram
   * edilen kalem (personel kahvesi, tadım bardağı) satış listesine hiç düşmez, tüketime girmesi için burada bağlanır.
   * Yukarıdaki satış listesinde görünen adlar tekrar edilmez; en çok ikram edilen 10 ad ve toplam sayı. Geçiş günü boşken
   * boş (ikram hiçbir hesaba girmez)
   */
  unmatchedIkram: { posName: string; qty: number; days: number }[];
  unmatchedIkramCount: number;
}

const DAYS_SHOWN = 14;

/** Ayarlar › LafPOS (kasa): durum, geçiş günü, gelen ve gelmeyen günler, eşleşmeyen adlar (yalnız yönetici) */
export async function loadLafposCard(db: DB = getDb(), now: Date = new Date()): Promise<LafposCardData> {
  const today = businessDate(now);
  const switchDay = await loadLafposSwitchDay(db);
  const r = s.posDayReports;
  const d = s.posDailySales;
  // Kart yalnız LafPOS'un şubesinin (Marina) kaydını sayar: öteki şubenin ModPOS günleri ve satırları karışmaz, panelde
  // seçili şube de kartı değiştirmez
  const ofR = eq(r.branchId, LAFPOS_BRANCH_ID);
  const ofD = eq(d.branchId, LAFPOS_BRANCH_ID);
  const unmatchedWhere = and(isNull(d.productId), eq(d.isService, false), ofD);
  const missingFrom = switchDay && switchDay < today ? (switchDay > addDays(today, -60) ? switchDay : addDays(today, -60)) : null;
  const [state, recent, [totals], unmatched, [{ unmatchedCount }], receivedRange, closed, ikram] = await Promise.all([
    readLafposState(db),
    db.select({ date: r.date, z: r.z, receivedAt: r.receivedAt }).from(r).where(ofR).orderBy(desc(r.date)).limit(DAYS_SHOWN),
    db
      .select({ total: count(), trial: switchDay ? sql<number>`count(*) filter (where ${r.date} < ${switchDay})`.mapWith(Number) : count() })
      .from(r)
      .where(ofR),
    db
      .select({ posName: d.posName, qty: sum(d.qty).mapWith(Number), days: countDistinct(d.date) })
      .from(d)
      .where(unmatchedWhere)
      .groupBy(d.posName)
      .orderBy(desc(sum(d.qty)), asc(d.posName))
      .limit(10),
    db.select({ unmatchedCount: countDistinct(d.posName) }).from(d).where(unmatchedWhere),
    missingFrom ? db.select({ date: r.date }).from(r).where(and(gte(r.date, missingFrom), lt(r.date, today), ofR)) : Promise.resolve([]),
    // Gün sonu gelmeyen gün LafPOS'un şubesinin kapalı günüyse eksik değil (öteki şubenin kapalı günü sayılmaz)
    missingFrom ? closedDaysBetween(missingFrom, addDays(today, -1), db, LAFPOS_BRANCH_ID) : Promise.resolve([]),
    // İkramın adları geçiş gününden itibaren (okuma anındaki bağla çözülür; bağlanınca listeden düşer)
    switchDay ? loadLafposIkram(db, switchDay, {}, LAFPOS_BRANCH_ID) : Promise.resolve(null),
  ]);
  const ikramNames = ikram ? unmatchedIkramNames(ikram.lines, unmatched.map((u) => u.posName)) : { items: [], count: 0 };
  // Günlü retlerin günlerinin paneldeki kaydı (409'da silinecek olan; retten sonra yeniden yazıldıysa ret çözüldü)
  const errDates = Object.keys(state.rejections);
  const [lineCounts, errRows] = await Promise.all([
    recent.length || errDates.length
      ? db
          .select({ date: d.date, n: count() })
          .from(d)
          .where(and(inArray(d.date, [...new Set([...recent.map((x) => x.date), ...errDates])]), ofD))
          .groupBy(d.date)
      : Promise.resolve([]),
    errDates.length ? db.select({ date: r.date, z: r.z, receivedAt: r.receivedAt }).from(r).where(and(inArray(r.date, errDates), ofR)) : Promise.resolve([]),
  ]);
  const linesOf = new Map(lineCounts.map((x) => [x.date, x.n]));
  const days = recent.map((x) => ({
    date: x.date,
    zNo: x.z.zNo,
    zTotal: x.z.zTotal,
    receipts: x.z.receipts,
    lines: linesOf.get(x.date) ?? 0,
    receivedAt: x.receivedAt.toISOString(),
    counted: isLafposDay(x.date, switchDay),
  }));
  return {
    secretProblem: lafposSecretProblem(process.env),
    switchDay,
    today,
    state,
    lastDay: days[0] ? { date: days[0].date, zNo: days[0].zNo, receivedAt: days[0].receivedAt } : null,
    totalDays: totals?.total ?? 0,
    trialDays: totals?.trial ?? 0,
    missing: missingLafposDays(
      switchDay,
      today,
      receivedRange.map((x) => x.date),
      closed,
    ),
    days,
    rejectionDays: Object.fromEntries(errRows.map((x) => [x.date, { zNo: x.z.zNo, lines: linesOf.get(x.date) ?? 0, receivedAt: x.receivedAt.toISOString() }])),
    unmatched,
    unmatchedCount,
    unmatchedIkram: ikramNames.items,
    unmatchedIkramCount: ikramNames.count,
  };
}
