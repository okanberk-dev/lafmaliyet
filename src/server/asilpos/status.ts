import "server-only";

import { and, asc, count, countDistinct, desc, eq, gte, inArray, isNull, lt, sql, sum, type SQL } from "drizzle-orm";

import { businessDate } from "@/lib/cash-report";
import { unmatchedIkramNames } from "@/lib/asilpos/ikram";
import {
  isDayRejection,
  ASILPOS_STATE_KEY,
  ASILPOS_STATE_KEY_NEW,
  missingAsilposDays,
  stateKeysOf,
  parseAsilposState,
  peekPosDay,
  withDayRejection,
  type AsilposCardInput,
  type AsilposOk,
  type AsilposRejection,
  type AsilposState,
} from "@/lib/asilpos/status";
import { sentWorkedStaffRefs } from "@/lib/asilpos/day";
import type { NextOpening } from "@/lib/asilpos/devir";
import type { WorkedStaffAnswer } from "@/lib/asilpos/personel";
import { isAsilposDay } from "@/lib/asilpos/switch";
import { singleTill } from "@/lib/pos/tills";
import { addDays } from "@/lib/reminders";
import { closedDaysBetween } from "@/server/closed-days";
import { loadAsilposIkram } from "@/server/data/asilpos-ikram";
import { getDb, schema as s, type DB } from "@/server/db";

import { posKeyState, switchDayOf } from "./branch";
import { asilposNextOpening } from "./devir";
import { workedStaffAnswer } from "./personel";
import { receivePosDay, type EndpointResult } from "./ingest";

/**
 * AsilPOS bağlantısının durumu ve onarımı (docs/ASILPOS.md › Durum ve onarım): `POST /api/pos/gun`'un her sonucu burada
 * `integration_state`'in kasanın durum satırına (stateKeysOf: `<ad>:<şube>`, eski adla) yazılır (son başarılı gün, son ret,
 * güne göre açık retler; imzası doğrulanamayan isteklerin sayacı genel satırda: imza tutmayan istek şubeye bağlanamaz), 200
 * yanıtına geçiş gününe göre `counted` ve `switchDay` eklenir; Ayarlar'daki "AsilPOS (kasa)" kartının verisi de buradan
 * okunur. Gün sonunun denetimi ve yazımı ingest.ts'te (değişmedi). Durum yazımı hiçbir zaman yanıtı bozmaz.
 */

/**
 * Bir kasanın durumu (çok şube; stateKeysOf): şubenin satırı (yeni adlı önce; Marina'nınki genel satır). İmzası
 * doğrulanamayan isteklerin sayacı (`unverified`) her zaman genel satırdan
 */
export async function readAsilposState(db: DB, branchId: string): Promise<AsilposState> {
  const keys = stateKeysOf(branchId).read;
  const global = [ASILPOS_STATE_KEY_NEW, ASILPOS_STATE_KEY];
  const rows = await db
    .select({ key: s.integrationState.key, value: s.integrationState.value })
    .from(s.integrationState)
    .where(inArray(s.integrationState.key, [...new Set([...keys, ...global])]));
  const pick = (ks: readonly string[]) => ks.map((k) => rows.find((r) => r.key === k)).find((r) => r !== undefined);
  const state = parseAsilposState(pick(keys)?.value);
  const unverified = parseAsilposState(pick(global)?.value).unverified;
  return { ...state, unverified };
}

/**
 * Durum satırına tek ifadeyle yazar: eski adlı satıra (ASILPOS_STATE_KEY; yoksa `first` ile açılır) ve varsa yeni adlı
 * satıra (ASILPOS_STATE_KEY_NEW; temizlik PR'ı A3 yazar, oradan geri dönülürse kalır) aynı değişiklik (`next`, eski değer
 * `integration_state.value`). Okuma yeni adlıyı önce okur (readAsilposState): yalnız eski adlıya yazılsaydı yeni
 * sonuçlar görünmezdi
 */
function writeState(db: Pick<DB, "execute">, branchId: string | null, first: SQL, next: SQL) {
  // Şubesi bilinmeyen sonuç (imza tutmadı) genel satıra; kasanınki şubenin satırına (stateKeysOf)
  const [yeniKey, eskiKey] = branchId === null ? [ASILPOS_STATE_KEY_NEW, ASILPOS_STATE_KEY] : [stateKeysOf(branchId).read[0], stateKeysOf(branchId).write];
  return db.execute(sql`
    with yeni as (update integration_state set value = ${next}, updated_at = now() where key = ${yeniKey})
    insert into integration_state (key, value) values (${eskiKey}, ${first})
    on conflict (key) do update set value = ${next}, updated_at = now()`);
}

/** Üst düzey alanları birleştirerek yazar (aynı anda iki sonuç birbirinin alanını ezmez); hata yanıtı bozmaz */
async function patchState(db: DB, branchId: string | null, patch: Partial<Record<keyof AsilposState, unknown>>): Promise<void> {
  try {
    await writeState(db, branchId, sql`${JSON.stringify(patch)}::jsonb`, sql`integration_state.value || ${JSON.stringify(patch)}::jsonb`);
  } catch (e) {
    console.error("[asilpos] durum yazılamadı:", e instanceof Error ? e.message : e);
  }
}

/** 200: son başarılı gün; o günün açık reddi (409 / 400) kapanır, gün yeniden yazıldı. Hata yanıtı bozmaz */
async function noteOk(db: DB, branchId: string, ok: AsilposOk): Promise<void> {
  try {
    await writeState(
      db,
      branchId,
      sql`jsonb_build_object('lastOk', ${JSON.stringify(ok)}::jsonb)`,
      sql`(integration_state.value #- array['rejections', ${ok.date}::text]) || jsonb_build_object('lastOk', ${JSON.stringify(ok)}::jsonb)`,
    );
  } catch (e) {
    console.error("[asilpos] durum yazılamadı:", e instanceof Error ? e.message : e);
  }
}

/**
 * Günlü 400 / 409: son ret olarak ve güne göre (`rejections`, aynı günün eskisinin yerine, en çok MAX_DAY_REJECTIONS)
 * yazılır. AsilPOS bunları yeniden denemez; sonraki günün başarılı gönderimi ya da başka bir günün reddi bu günün
 * reddini örtmesin. Satır kilitlenir (aynı anda iki ret birbirinin gününü düşürmez); öteki alanlar üst düzey birleştirmeyle
 * korunur. Hata yanıtı bozmaz.
 */
async function noteDayRejection(db: DB, branchId: string, e: AsilposRejection & { date: string }): Promise<void> {
  const keys = stateKeysOf(branchId);
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`insert into integration_state (key, value) values (${keys.write}, '{}'::jsonb) on conflict (key) do nothing`);
      // Eski adlı satır ve varsa yeni adlısı (writeState): her biri kendi retlerine eklenir
      const rows = await tx
        .select({ key: s.integrationState.key, value: s.integrationState.value })
        .from(s.integrationState)
        .where(inArray(s.integrationState.key, keys.read))
        .orderBy(asc(s.integrationState.key))
        .for("update");
      for (const row of rows) {
        const rejections = withDayRejection(parseAsilposState(row.value).rejections, e);
        await tx.execute(sql`
          update integration_state set value = value || ${JSON.stringify({ lastError: e, rejections })}::jsonb, updated_at = now()
           where key = ${row.key}`);
      }
    });
  } catch (err) {
    console.error("[asilpos] durum yazılamadı:", err instanceof Error ? err.message : err);
  }
}

/**
 * İmzası doğrulanamayan istekler (401, 413) gövdesiz sayılır ve yazımı örnek başına en çok `windowMs`'de bir yapılır:
 * imzasız istek yağmuru veritabanına yazım yağmuru olmasın. Aradaki istekler bellekte birikir, sonraki yazımda sayaca
 * eklenir (örnek kapanırsa birkaçı kaybolabilir; sayaç yaklaşık, son anı doğru).
 */
const unverifiedBuffer = { pending: 0, lastFlush: 0 };

export async function noteUnverified(db: DB, status: 401 | 413, now: Date = new Date(), windowMs = 60_000): Promise<void> {
  console.warn("[asilpos] reddedildi", status, status === 401 ? "unauthorized" : "too_large");
  unverifiedBuffer.pending += 1;
  if (now.getTime() - unverifiedBuffer.lastFlush < windowMs) return;
  const n = unverifiedBuffer.pending;
  unverifiedBuffer.pending = 0;
  unverifiedBuffer.lastFlush = now.getTime();
  try {
    const at = now.toISOString();
    await writeState(
      db,
      null,
      sql`jsonb_build_object('unverified', jsonb_build_object('count', ${n}::int, 'lastAt', ${at}::text, 'lastStatus', ${status}::int))`,
      sql`integration_state.value || jsonb_build_object('unverified', jsonb_build_object(
        'count', coalesce((integration_state.value->'unverified'->>'count')::int, 0) + ${n}::int,
        'lastAt', ${at}::text,
        'lastStatus', ${status}::int))`,
    );
  } catch (e) {
    console.error("[asilpos] durum yazılamadı:", e instanceof Error ? e.message : e);
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
 * 200'e `counted` (gün geçiş gününden önce değil: hesaplara giriyor), `switchDay` ve kasa zincirinin `nextOpening`'i
 * (ertesi günün beklenen açılışı; sayılmayan günde null, src/server/asilpos/devir.ts) eklenir; gövde `workedStaffRefs`
 * taşıdıysa `staff: { counted, unknown, otherBranch }` (personel kimliklerinin sınıfı, src/lib/asilpos/personel.ts); eski
 * AsilPOS bilmediği alanları atar; o günün açık reddi kapanır. 400 ve 409 son ret olarak (alan, gün, iki Z
 * no) ve günü okunduysa güne göre yazılır, gövdesiz günlüğe düşer; 401 ve 413 yalnız sayaçtır; 503'te (anahtar yok)
 * hiçbir şey yazılmaz. Veritabanı hatası son ret olarak yazılmaya çalışılır ve yeniden fırlar (uç 500 döner, AsilPOS
 * yeniden dener).
 */
export async function handlePosDay(db: DB, input: PosDayInput, now: Date = new Date(), opts: { unverifiedWindowMs?: number } = {}): Promise<EndpointResult> {
  const at = now.toISOString();
  // Kasanın şubesi: imzanın tuttuğu anahtarın şubesi (resolvePosCaller); durum o şubenin satırına yazılır
  const branchId = input.branchId;
  let r: EndpointResult;
  try {
    r = await receivePosDay(db, input, now);
  } catch (e) {
    const sent = peekPosDay(input.body);
    console.warn("[asilpos] reddedildi", 500, "server_error", sent.date ?? "-", sent.zNo ?? "-");
    await patchState(db, branchId, { lastError: rejection(at, 500, "server_error", { date: sent.date, sentZNo: sent.zNo }) });
    throw e;
  }
  if (r.status === 503) return r;
  if (r.status === 401 || r.status === 413 || branchId === null) {
    if (r.status === 401 || r.status === 413) await noteUnverified(db, r.status, now, opts.unverifiedWindowMs);
    return r;
  }
  const sent = peekPosDay(input.body);
  if (r.status === 200) {
    const date = String(r.body.date);
    let switchDay: string | null;
    try {
      // Kasanın kendi şubesinin geçiş günü (kasası ModPOS olan şubenin günü deneme: null)
      switchDay = await switchDayOf(branchId, db);
    } catch (e) {
      // Gün yazıldı; geçiş günü okunamadıysa yanıt yine 200, yalnız ek alanlar yok
      console.error("[asilpos] geçiş günü okunamadı:", e instanceof Error ? e.message : e);
      return r;
    }
    const counted = isAsilposDay(date, switchDay);
    await noteOk(db, branchId, { at, date, zNo: sent.zNo, lines: Number(r.body.lines ?? 0), counted });
    // Kasa zinciri (Faz 3): ertesi günün beklenen açılışı (devir.ts asilposNextOpening; gün az önce yazıldı). Okunamazsa
    // alan yazılmaz (AsilPOS "lafmaliyet söylemedi" sayar, kendi sayımına döner); yanıt yine 200
    let nextOpening: NextOpening | null | undefined;
    try {
      nextOpening = counted ? await asilposNextOpening(db, date, branchId) : null;
    } catch (e) {
      console.error("[asilpos] devir okunamadı:", e instanceof Error ? e.message : e);
    }
    // Personel bağlantısı (LM-4b): gövde çalışanların kimliklerini taşıdıysa her birinin lafmaliyet'teki karşılığı
    // (sayılan / bilinmeyen / başka şube; personel.ts). Okunamazsa alan yazılmaz; yanıt yine 200
    const refs = sentWorkedStaffRefs(input.body);
    let staff: WorkedStaffAnswer | undefined;
    if (refs !== undefined) {
      try {
        staff = await workedStaffAnswer(db, refs, date, branchId);
      } catch (e) {
        console.error("[asilpos] personel kimlikleri okunamadı:", e instanceof Error ? e.message : e);
      }
    }
    return { status: 200, body: { ...r.body, counted, switchDay, ...(nextOpening !== undefined ? { nextOpening } : {}), ...(staff ? { staff } : {}) } };
  }
  const error = String(r.body.error ?? "unknown");
  const date = typeof r.body.date === "string" ? r.body.date : sent.date;
  const zNo = typeof r.body.zNo === "number" ? r.body.zNo : null;
  console.warn("[asilpos] reddedildi", r.status, error, date ?? "-", zNo ?? "-");
  const e = rejection(at, r.status, error, { field: typeof r.body.field === "string" ? r.body.field : null, date, zNo, sentZNo: error === "z_conflict" ? sent.zNo : null });
  // Yanlış şube: kasanın şubesi ve beklenen kartta yazılsın (rejectionText)
  if (error === "wrong_branch") Object.assign(e, { sube: typeof r.body.sube === "string" ? r.body.sube : null, expected: typeof r.body.expected === "string" ? r.body.expected : null });
  if (isDayRejection(e)) await noteDayRejection(db, branchId, e);
  else await patchState(db, branchId, { lastError: e });
  return r;
}

function rejection(at: string, status: number, error: string, o: Partial<Omit<AsilposRejection, "at" | "status" | "error">>): AsilposRejection {
  return { at, status, error, field: o.field ?? null, date: o.date ?? null, zNo: o.zNo ?? null, sentZNo: o.sentZNo ?? null, clearedAt: null };
}

// ---------------------------------------------------------------- Ayarlar kartı

/** Kartın gün listesinde bir AsilPOS günü (yalnız yöneticinin ekranı) */
export interface AsilposDayRow {
  date: string;
  zNo: number;
  zTotal: number;
  receipts: number;
  lines: number;
  receivedAt: string;
  counted: boolean;
}

export interface AsilposCardData extends AsilposCardInput {
  /** Kasanın şubesi: bölüm yalnız onun kaydını sayar (çok şube: "Tümü"de kasa başına bir bölüm) */
  branchId: string;
  /** En yeni günler (tarihe göre, en çok 14) */
  days: AsilposDayRow[];
  /** Ürüne bağlanamayan POS adları (hizmet satırları hariç): en çok satılan 10 ad ve toplam sayı */
  unmatched: { posName: string; qty: number; days: number }[];
  unmatchedCount: number;
  /**
   * İkramda (ve AsilPOS'ta zayi yazılan satırlarda) ürüne bağlanamayan POS adları, geçiş gününden itibaren: yalnız ikram
   * edilen kalem (personel kahvesi, tadım bardağı) satış listesine hiç düşmez, tüketime girmesi için burada bağlanır.
   * Yukarıdaki satış listesinde görünen adlar tekrar edilmez; en çok ikram edilen 10 ad ve toplam sayı. Geçiş günü boşken
   * boş (ikram hiçbir hesaba girmez)
   */
  unmatchedIkram: { posName: string; qty: number; days: number }[];
  unmatchedIkramCount: number;
}

const DAYS_SHOWN = 14;

/**
 * Ayarlar › AsilPOS (kasa), bir kasanın bölümü: durum, geçiş günü, gelen ve gelmeyen günler, eşleşmeyen adlar (yalnız
 * yönetici). Çok şube: her kasanın kendi bölümü (şube seçiliyken yalnız o şubeninki; src/lib/pos-cards.ts)
 */
export async function loadAsilposCard(db: DB = getDb(), branchId: string, now: Date = new Date()): Promise<AsilposCardData> {
  const today = businessDate(now);
  const [switchDay, secret] = await Promise.all([switchDayOf(branchId, db), posKeyState(branchId, db)]);
  const r = s.posDayReports;
  const d = s.posDailySales;
  // Bölüm yalnız bu kasanın şubesinin kaydını sayar: öteki şubenin günleri ve satırları karışmaz
  const ofR = eq(r.branchId, branchId);
  const ofD = eq(d.branchId, branchId);
  const unmatchedWhere = and(isNull(d.productId), eq(d.isService, false), ofD);
  const missingFrom = switchDay && switchDay < today ? (switchDay > addDays(today, -60) ? switchDay : addDays(today, -60)) : null;
  const [state, recent, [totals], unmatched, [{ unmatchedCount }], receivedRange, closed, ikram] = await Promise.all([
    readAsilposState(db, branchId),
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
    // Gün sonu gelmeyen gün AsilPOS'un şubesinin kapalı günüyse eksik değil (öteki şubenin kapalı günü sayılmaz)
    missingFrom ? closedDaysBetween(missingFrom, addDays(today, -1), db, branchId) : Promise.resolve([]),
    // İkramın adları geçiş gününden itibaren (okuma anındaki bağla çözülür; bağlanınca listeden düşer)
    switchDay ? loadAsilposIkram(db, singleTill(branchId, switchDay), {}, branchId) : Promise.resolve(null),
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
    counted: isAsilposDay(x.date, switchDay),
  }));
  return {
    branchId,
    secretProblem: secret.problem,
    secretSource: secret.source,
    secretEnvName: secret.envName,
    switchDay,
    today,
    state,
    lastDay: days[0] ? { date: days[0].date, zNo: days[0].zNo, receivedAt: days[0].receivedAt } : null,
    totalDays: totals?.total ?? 0,
    trialDays: totals?.trial ?? 0,
    missing: missingAsilposDays(
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
