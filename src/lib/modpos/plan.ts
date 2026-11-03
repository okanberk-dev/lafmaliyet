import { addDays, todayTR } from "@/lib/reminders";

import { finalAfter } from "./z";

/**
 * Hangi kasa günlerinin çekileceği (saf; tests/modpos-foy.test.ts). Günde 2 hak var (belge §4); sahibin kuralı (3 Kasım
 * 2026): **her sabah önce dünün föyü, öteki hak geçmişe: ModPOS'un ilk ciro gününden başlayıp ileriye, bitene kadar**.
 * Hak sırayla:
 *
 * 1. **Dün**, kesin değilse (ertesi sabah 07:00'den sonra alınmış, kasaları kapalı föy kesindir). Sabah işi 08:00'de
 *    çalışır: dünün föyü kesinleşmiştir. Ardından **kaçan yakın günler** (catchUpDays): canlı çekim başladıktan sonra
 *    dün olarak alınamamış ya da sabah işinin çalışmadığı son 14 günün eksikleri, yeniden eskiye (alınamayan gün
 *    beklemesini doldurunca). Yakın günün föyü geçmişin sonuna (aylar sonrasına) kalmasın diye; ilk kurulumda boştur.
 * 2. **Hiç alınmamış eski günler**, ModPOS'un ilk ciro gününden (`start`; historyStart) ileriye, eskiden yeniye: geçmiş
 *    ilk günden bugüne doğru dolar. `from` ile `start` arasındaki günler (ilk ciro gününden önce: büyük olasılıkla kasa
 *    açılmamış) en sona kalır, yine eskiden yeniye: hiçbir gün atlanmaz. Hak günde 2 olduğundan geçmiş günde 1 gün
 *    ilerler (docs/MODPOS-API.md › Kota ve çekme sırası).
 * 3. Eksik gün kalmadıysa **son 14 günün kesin olmayan föyleri** (gün açıkken ya da 07:00'den önce elle alınmış),
 *    yeniden yeniye.
 * 4. Hiçbiri yoksa **son 7 günün en eski kontrol edilen kesin föyü** (kapanıştan sonra düzeltme olduysa görünsün).
 *
 * Bugün (açık gün) hiçbir zaman kendiliğinden çekilmez: tutarlar değişir, hak harcanır. LafPOS'a geçiş gününden
 * (`until`) itibaren kasa LafPOS'tur: o günler hiç çekilmez (föyü hiçbir yer okumaz). **Alınamayan gün** (`failed`:
 * bozuk yanıt, 500…) her sabah yeniden denenmez: 2, 4, 8… gün (en çok 32) bekler; geçmiş onda takılmaz, sıradaki
 * eksik güne geçer. Dün bundan muaftır (her sabah bir kez denenir).
 */

export interface StoredDay {
  final: boolean;
  /** Son çekildiği an (ISO) */
  fetchedAt: string;
}

export interface PlanInput {
  now: Date;
  /** Geçmişin ilk günü (MODPOS_SYNC_FROM ya da kafenin ilk ayının ilk günü): bundan önce hiçbir gün çekilmez */
  from: string;
  /** ModPOS'un ilk ciro günü (historyStart): geçmiş buradan ileriye çekilir; yoksa ya da `from`'dan önceyse `from` */
  start?: string | null;
  /** Saklanan günler */
  have: ReadonlyMap<string, StoredDay>;
  /** Bu çalışmada kullanılabilecek hak */
  left: number;
  /** LafPOS'a geçiş günü: bu gün ve sonrası çekilmez (null: geçiş yok) */
  until?: string | null;
  /** Alınamayan günler: kaç kez, en son ne zaman (src/lib/modpos/status.ts dayErrors) */
  failed?: Readonly<Record<string, { count: number; lastAt: string }>>;
}

/** Alınamayan günün bekleme süresi: 2^kez gün, en çok 32 */
export function retryWaitDays(count: number): number {
  return Math.min(32, 2 ** Math.max(1, count));
}

/** Alınamayan gün yeniden denenebilir mi (son denemeden bu yana bekleme süresi geçti mi) */
export function canRetry(e: { count: number; lastAt: string } | undefined, now: Date): boolean {
  if (!e) return true;
  const last = Date.parse(e.lastAt);
  return Number.isNaN(last) || now.getTime() - last >= retryWaitDays(e.count) * 86_400_000 - 3_600_000;
}

/** Yeniden kontrol edilecek kesin günlerin geriye bakışı */
const RECHECK_DAYS = 7;
/** Kesin olmayan föylerin yeniden çekileceği geriye bakış */
const PROVISIONAL_DAYS = 14;

export function planFoyDays({ now, from, have, left, start = null, until = null, failed = {} }: PlanInput): string[] {
  if (left <= 0) return [];
  const today = todayTR(now);
  const yesterday = addDays(today, -1);
  const out: string[] = [];
  const add = (d: string) => {
    if (out.length < left && !out.includes(d) && d >= from && d < today && (until === null || d < until)) out.push(d);
  };
  const ready = (d: string) => canRetry(failed[d], now);
  // 1) Dün: kesinleştiyse ve kesin föyü yoksa; sonra kaçan yakın günler
  const y = have.get(yesterday);
  if (now.getTime() >= finalAfter(yesterday) && !y?.final) add(yesterday);
  for (const d of catchUpDays({ now, from, have, until, failed })) add(d);
  // 2) Hiç alınmamış eski günler: ilk ciro gününden ileriye (eskiden yeniye), sonra ondan önceki günler
  for (const d of backfillOrder(from, start, yesterday)) {
    if (out.length >= left) break;
    if (!have.has(d) && now.getTime() >= finalAfter(d) && ready(d)) add(d);
  }
  // 3) Kesin olmayan föyler (yalnız kesinleşme anı geçtiyse: erken yeniden çekmek aynı sonucu verir)
  for (let i = 1; i <= PROVISIONAL_DAYS; i++) {
    const d = addDays(today, -i);
    const h = have.get(d);
    if (h && !h.final && now.getTime() >= finalAfter(d) && ready(d)) add(d);
  }
  // 4) En eski kontrol edilen yakın kesin gün
  if (out.length < left) {
    const recent = [...have.entries()]
      .filter(([d, h]) => h.final && d >= addDays(today, -RECHECK_DAYS) && d < today && !out.includes(d))
      .sort((a, b) => a[1].fetchedAt.localeCompare(b[1].fetchedAt) || a[0].localeCompare(b[0]));
    for (const [d, h] of recent) {
      // Aynı gün iki kez kontrol edilmez: son çekim bugünse atla
      if (todayTR(new Date(h.fetchedAt)) === today) continue;
      add(d);
    }
  }
  return out;
}

/**
 * Canlı çekimin başladığı gün: "dün" olarak denenmiş en eski gün. Saklanan gün, günü bittikten en geç iki gün sonra
 * çekildiyse; alınamayan gün (dayErrors), son denemesi gününden en geç 15 gün sonraysa (dün olarak denenip beklemeyle
 * yeniden denenmiş: ilk kurulumda ilk "dün" alınamadıysa da sayılır). Geçmişten çekilen ya da denenen günler aylar
 * sonra alındığı için sayılmaz; hiç yoksa (ilk kurulum) null
 */
export function liveFromOf(have: ReadonlyMap<string, StoredDay>, failed: Readonly<Record<string, { count: number; lastAt: string }>> = {}): string | null {
  let min: string | null = null;
  const consider = (d: string, at: string, within: number) => {
    const t = Date.parse(at);
    if (Number.isNaN(t)) return;
    if (todayTR(new Date(t)) <= addDays(d, within) && (min === null || d < min)) min = d;
  };
  for (const [d, h] of have) consider(d, h.fetchedAt, 2);
  for (const [d, e] of Object.entries(failed)) consider(d, e.lastAt, PROVISIONAL_DAYS + 1);
  return min;
}

/**
 * Kaçan yakın günler, eskiden yeniye: canlı çekimin başladığı günden (liveFromOf) itibaren, dünden önceki son 13 günde
 * (dün dahil 14) kesin föyü olmayan (hiç alınmamış ya da kesinleşmeden alınmış), kesinleşme anı geçmiş ve beklemesi
 * dolmuş günler: dün olarak alınamamış, o sabah iş çalışmamış ya da gün içinde kasa açılmadan elle çekilip ertesi sabah
 * yeniden alınamamış. Eskiden yeniye: uzun bir kesintiden sonra en eski kaçan gün pencereden düşmeden alınır. Geçmişin
 * ilk günü ve LafPOS'a geçiş günü sınırları geçerli. İlk kurulumda boş (geçmiş ilk ciro gününden)
 */
export function catchUpDays({ now, from, have, until = null, failed = {} }: Pick<PlanInput, "now" | "from" | "have" | "until" | "failed">): string[] {
  const live = liveFromOf(have, failed);
  if (live === null) return [];
  const today = todayTR(now);
  const out: string[] = [];
  for (let i = PROVISIONAL_DAYS; i >= 2; i--) {
    const d = addDays(today, -i);
    if (d < live || d < from) continue;
    if (until !== null && d >= until) continue;
    // Kesinleşme anından önce alınmış föy yeniden çekilir; ondan sonra alınıp yine kesin olmayan (kasa ModPOS'ta açık
    // kalmış) her sabah çekilmez: aynı sonucu verir, geçmişin hakkını yer (son 14 günün yeniden çekimi ona bakar)
    const h = have.get(d);
    const stale = !h || (!h.final && Date.parse(h.fetchedAt) < finalAfter(d));
    if (stale && now.getTime() >= finalAfter(d) && canRetry(failed[d], now)) out.push(d);
  }
  return out;
}

/** Sabah işinin bir sonraki çalışması (08:00 TR = 05:00 UTC; cron /api/cron/gunluk): bugün henüz çalışmadıysa bugün */
export function nextMorningRun(now: Date): Date {
  const today = todayTR(now);
  const run = new Date(`${today}T05:00:00.000Z`);
  return now.getTime() < run.getTime() ? run : new Date(`${addDays(today, 1)}T05:00:00.000Z`);
}

/**
 * Geçmişin sıradaki günü (Ayarlar kartının "sıradaki"si): bir sonraki sabah işinin planında o sabahın dünü dışındaki
 * ilk gün (kaçan yakın gün ya da geçmiş; bekleyen gün atlanır). Hak o sabah yenilenmiş sayılır
 */
export function nextBackfillDay(i: Omit<PlanInput, "now" | "left"> & { now: Date; hak: number }): string | null {
  const run = nextMorningRun(i.now);
  const yesterday = addDays(todayTR(run), -1);
  return planFoyDays({ ...i, now: run, left: Math.max(2, i.hak) }).find((d) => d !== yesterday) ?? null;
}

/**
 * Geçmişin sırası: `start`'tan (ilk ciro günü) `last`'a eskiden yeniye, sonra `from`'dan `start`'ın önceki gününe.
 * `start` yoksa, `from`'dan önceyse ya da `last`'tan sonraysa yalnız `from` → `last`
 */
export function backfillOrder(from: string, start: string | null, last: string): string[] {
  const first = start !== null && start > from && start <= last ? start : from;
  const out: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) out.push(d);
  for (let d = from; d < first; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Geçmişte eksik günler, çekilecekleri sırayla (`from`'dan düne, LafPOS'a geçiş gününden önceye; kesinleşmemiş dün
 * dahil değil): ilk ciro gününden ileriye, sonra ondan önceki günler (planFoyDays'in 2. adımı). Kartın sayısı ve
 * "sıradaki gün"ü buradan
 */
export function missingFoyDays(from: string, have: ReadonlyMap<string, unknown>, now: Date, until: string | null = null, start: string | null = null): string[] {
  const today = todayTR(now);
  const end = until !== null && until < today ? until : today;
  return backfillOrder(from, start, addDays(end, -1)).filter((d) => !have.has(d) && now.getTime() >= finalAfter(d));
}

/** Ayın Satışlar'daki rakamları (months): ilk ciro ayı ve açık gün sayısı */
export interface HistoryMonth {
  month: string;
  posRevenue: number | null;
  openDays: number | null;
}

export type HistoryStartSource = "ayar" | "foy" | "ay" | "baslangic";

export interface HistoryStart {
  /** ModPOS'un ilk ciro günü (geçmişin çekilmeye başlandığı gün) */
  day: string;
  /**
   * Nereden bilindiği: "ayar" MODPOS_SYNC_FROM; "foy" saklanan föylerin en eski satışlı günü (ay tahmininden önce);
   * "ay" Satışlar'daki ilk cirolu ayın açık gün sayısı (ayın son N günü); "baslangic" bilgi yok, `from`
   */
  source: HistoryStartSource;
}

const monthDays = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

/**
 * ModPOS'un ilk ciro günü (saf): MODPOS_SYNC_FROM kurulduysa odur. Yoksa Satışlar'daki ilk cirolu ay (ModPOS'un ay
 * cirosu): ayın açık gün sayısı N ayın gününden azsa kafe en geç ayın son N gününün ilkinde açılmıştır (Temmuz 2026: 23
 * açık gün → 9 Temmuz); açık gün yoksa ayın 1'i. Saklanan föylerde daha önce satışlı bir gün varsa o. Tahmin en geç
 * gündür: ondan önce satış olduysa (arada kapalı gün) o günler geçmişin sonunda yine çekilir (backfillOrder).
 */
export function historyStart(i: { from: string; explicit: boolean; months: readonly HistoryMonth[]; firstSale: string | null }): HistoryStart {
  if (i.explicit) return { day: i.from, source: "ayar" };
  const m = [...i.months]
    .filter((x) => /^\d{4}-\d{2}$/.test(x.month) && (x.posRevenue ?? 0) > 0 && x.month >= i.from.slice(0, 7))
    .sort((a, b) => a.month.localeCompare(b.month))[0];
  let est: string | null = null;
  if (m) {
    const dim = monthDays(m.month);
    const open = m.openDays ?? 0;
    est = open >= 1 && open < dim ? `${m.month}-${String(dim - open + 1).padStart(2, "0")}` : `${m.month}-01`;
    if (est < i.from) est = i.from;
  }
  if (i.firstSale !== null && i.firstSale >= i.from && (est === null || i.firstSale < est)) return { day: i.firstSale, source: "foy" };
  return est !== null ? { day: est, source: "ay" } : { day: i.from, source: "baslangic" };
}
