import { addDays, todayTR } from "@/lib/reminders";

import { finalAfter } from "./z";

/**
 * Hangi kasa günlerinin çekileceği (saf; tests/modpos-foy.test.ts). Günde 2 hak var (belge §4); sahibin kuralı (4 Kasım
 * 2026): **her sabah önce dünün föyü, öteki hak çekilmemiş günlere: en yeni günden eskiye doğru**. Hak sırayla:
 *
 * 1. **Dün**, kesin değilse (ertesi sabah 07:00'den sonra alınmış, kasaları kapalı föy kesindir). Sabah işi 08:00'de
 *    çalışır: dünün föyü kesinleşmiştir.
 * 2. **Hiç alınmamış günler** (ya da kesinleşmeden alınıp yeniden alınamamış), dünden önceki günden geçmişin ilk gününe
 *    (`from`: MODPOS_SYNC_FROM) doğru, **yeniden eskiye**: kaçan yakın gün (sabah işinin çalışmadığı sabah) her zaman
 *    eski günlerin önündedir. Hak günde 2 olduğundan geçmiş günde 1 gün geriye ilerler (docs/MODPOS-API.md › Kota ve
 *    çekme sırası).
 * 3. Eksik gün kalmadıysa **son 14 günün kesin olmayan föyleri** (gün açıkken ya da 07:00'den önce elle alınmış),
 *    yeniden eskiye.
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

export function planFoyDays({ now, from, have, left, until = null, failed = {} }: PlanInput): string[] {
  if (left <= 0) return [];
  const today = todayTR(now);
  const yesterday = addDays(today, -1);
  const out: string[] = [];
  const add = (d: string) => {
    if (out.length < left && !out.includes(d) && d >= from && d < today && (until === null || d < until)) out.push(d);
  };
  const ready = (d: string) => canRetry(failed[d], now);
  // 1) Dün: kesinleştiyse ve kesin föyü yoksa
  const y = have.get(yesterday);
  if (now.getTime() >= finalAfter(yesterday) && !y?.final) add(yesterday);
  // 2) Çekilmemiş (ya da kesinleşmeden alınıp yeniden alınamamış) günler: yeniden eskiye
  for (const d of backfillOrder(from, yesterday)) {
    if (out.length >= left) break;
    if (needsFetch(have.get(d), d) && now.getTime() >= finalAfter(d) && ready(d)) add(d);
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
 * Günün föyü çekilmeli mi: hiç alınmamış, ya da kesinleşme anından önce alınmış ve hâlâ kesin değil (gün içinde ya da
 * 07:00'den önce elle çekilmiş, ertesi sabah yeniden alınamamış). Kesinleşme anından sonra alınıp yine kesin olmayan
 * föy (kasa ModPOS'ta açık kalmış) burada sayılmaz: her sabah aynı sonucu verir, hak yer (son 14 günün yeniden çekimi ona
 * bakar)
 */
export function needsFetch(h: StoredDay | undefined, day: string): boolean {
  return !h || (!h.final && Date.parse(h.fetchedAt) < finalAfter(day));
}

/**
 * Sabah işinin bir sonraki çalışması (cron /api/cron/gunluk, 05:00 UTC; Vercel 05:00–06:00 arasında çalıştırır):
 * bugün henüz çalışmadıysa (`ranToday` false) ve saat 06:00 UTC'yi geçmediyse bugünkü (en erken şimdi), yoksa yarınki
 */
export function nextMorningRun(now: Date, ranToday = false): Date {
  const today = todayTR(now);
  const run = new Date(`${today}T05:00:00.000Z`);
  const windowEnd = new Date(`${today}T06:00:00.000Z`);
  if (!ranToday && now.getTime() < windowEnd.getTime()) return now.getTime() > run.getTime() ? now : run;
  return new Date(`${addDays(today, 1)}T05:00:00.000Z`);
}

/**
 * Geçmişin sıradaki günü (Ayarlar kartının "sıradaki"si): bir sonraki sabah işinin planında o sabahın dünü dışındaki,
 * föyü çekilmesi gereken ilk gün (en yeni eksik gün; bekleyen gün atlanır). Kesin föyün yeniden kontrolü
 * (planın 3. ve 4. adımı) sıradaki sayılmaz. Hak o sabah yenilenmiş sayılır; o sabah çekilecek gün yoksa null
 */
export function nextBackfillDay(i: Omit<PlanInput, "now" | "left"> & { now: Date; hak: number; ranToday?: boolean; leftToday?: number }): string | null {
  const today = todayTR(i.now);
  const pick = (run: Date, plan: string[], have: ReadonlyMap<string, StoredDay>) => {
    const yesterday = addDays(todayTR(run), -1);
    return plan.find((d) => d !== yesterday && needsFetch(have.get(d), d)) ?? null;
  };
  const run = nextMorningRun(i.now, i.ranToday ?? false);
  let have = i.have;
  // Bugünkü iş henüz çalışmadıysa bugünün kalan hakkıyla; o işte geçmişe hak kalmıyorsa yarınki işin planı, bugünkü
  // işin çekeceği günler alınmış sayılarak (yoksa yarının planı bugün çekilecek dünü eksik gün sanır)
  if (todayTR(run) === today) {
    const left = i.leftToday ?? i.hak;
    const todays = left > 0 ? planFoyDays({ ...i, now: run, left }) : [];
    const got = pick(run, todays, i.have);
    if (got) return got;
    const next = new Map(i.have);
    for (const d of todays) next.set(d, { final: true, fetchedAt: run.toISOString() });
    have = next;
  }
  const tomorrow = new Date(`${addDays(today, 1)}T05:00:00.000Z`);
  return pick(tomorrow, planFoyDays({ ...i, have, now: tomorrow, left: Math.max(2, i.hak) }), have);
}

/** Geçmişin sırası: `last`'tan `from`'a, yeniden eskiye (iki uç dahil) */
export function backfillOrder(from: string, last: string): string[] {
  const out: string[] = [];
  for (let d = last; d >= from; d = addDays(d, -1)) out.push(d);
  return out;
}

/**
 * Geçmişte eksik günler, çekilecekleri sırayla (`from`'dan düne, LafPOS'a geçiş gününden önceye; kesinleşmemiş dün
 * dahil değil): yeniden eskiye (planFoyDays'in 2. adımı). Kartın sayısı buradan
 */
export function missingFoyDays(from: string, have: ReadonlyMap<string, StoredDay>, now: Date, until: string | null = null): string[] {
  const today = todayTR(now);
  const end = until !== null && until < today ? until : today;
  return backfillOrder(from, addDays(end, -1)).filter((d) => needsFetch(have.get(d), d) && now.getTime() >= finalAfter(d));
}
