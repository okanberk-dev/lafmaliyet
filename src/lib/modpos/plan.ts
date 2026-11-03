import { addDays, todayTR } from "@/lib/reminders";

import { finalAfter } from "./z";

/**
 * Hangi kasa günlerinin çekileceği (saf; tests/modpos-foy.test.ts). Günde 2 hak var (belge §4); sahibin kuralı (3 Kasım
 * 2026): **her sabah önce dünün föyü, sonra henüz çekilmemiş bir eski gün**. Hak sırayla:
 *
 * 1. **Dün**, kesin değilse (ertesi sabah 07:00'den sonra alınmış, kasaları kapalı föy kesindir). Sabah işi 08:00'de
 *    çalışır: dünün föyü kesinleşmiştir.
 * 2. **Hiç alınmamış eski günler**, dünden geriye `from`'a (kafenin ilk günü) kadar, yeniden eskiye: önce süren ve geçen
 *    ay tamamlanır. Hak günde 2 olduğundan geçmiş günde 1 gün ilerler (docs/MODPOS-API.md › Kota ve çekme sırası).
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
  /** Geçmişin ilk günü (MODPOS_SYNC_FROM ya da kafenin ilk günü) */
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
  // 2) Hiç alınmamış eski günler: dünden geriye, yeniden eskiye
  for (let d = yesterday; d >= from && out.length < left; d = addDays(d, -1)) {
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

/** Geçmişte eksik gün sayısı (`from`'dan düne, LafPOS'a geçiş gününden önceye; kesinleşmemiş dün dahil değil) */
export function missingFoyDays(from: string, have: ReadonlyMap<string, unknown>, now: Date, until: string | null = null): string[] {
  const today = todayTR(now);
  const end = until !== null && until < today ? until : today;
  const out: string[] = [];
  for (let d = from; d < end; d = addDays(d, 1)) if (!have.has(d) && now.getTime() >= finalAfter(d)) out.push(d);
  return out;
}
