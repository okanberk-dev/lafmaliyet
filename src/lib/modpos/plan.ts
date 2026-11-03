import { addDays, todayTR } from "@/lib/reminders";

import { finalAfter } from "./z";

/**
 * Hangi kasa günlerinin çekileceği (saf; tests/modpos-foy.test.ts). Günde 2 hak var (belge §4); hak sırayla:
 *
 * 1. **Dün**, kesin değilse (ertesi sabah 07:00'den sonra alınmış, kasaları kapalı föy kesindir). Sabah işi 08:00'de
 *    çalışır: dünün föyü kesinleşmiştir.
 * 2. **Son 14 günün kesin olmayan föyleri** (gün açıkken ya da 07:00'den önce alınmış), yeniden yeniye.
 * 3. **Hiç alınmamış günler**, dünden geriye `from`'a (kafenin ilk günü) kadar, yeniden eskiye: önce süren ve geçen ay
 *    tamamlanır. Hak günde 2 olduğundan geçmiş günde ~1 gün ilerler (docs/MODPOS-API.md › Geçmiş).
 * 4. Hiçbiri yoksa **son 7 günün en eski kontrol edilen kesin föyü** (kapanıştan sonra düzeltme olduysa görünsün).
 *
 * Bugün (açık gün) hiçbir zaman kendiliğinden çekilmez: tutarlar değişir, hak harcanır.
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
}

/** Yeniden kontrol edilecek kesin günlerin geriye bakışı */
const RECHECK_DAYS = 7;
/** Kesin olmayan föylerin yeniden çekileceği geriye bakış */
const PROVISIONAL_DAYS = 14;

export function planFoyDays({ now, from, have, left }: PlanInput): string[] {
  if (left <= 0) return [];
  const today = todayTR(now);
  const yesterday = addDays(today, -1);
  const out: string[] = [];
  const add = (d: string) => {
    if (out.length < left && !out.includes(d) && d >= from && d < today) out.push(d);
  };
  // 1) Dün: kesinleştiyse ve kesin föyü yoksa
  const y = have.get(yesterday);
  if (now.getTime() >= finalAfter(yesterday) && !y?.final) add(yesterday);
  // 2) Kesin olmayan föyler (yalnız kesinleşme anı geçtiyse: erken yeniden çekmek aynı sonucu verir)
  for (let i = 1; i <= PROVISIONAL_DAYS; i++) {
    const d = addDays(today, -i);
    const h = have.get(d);
    if (h && !h.final && now.getTime() >= finalAfter(d)) add(d);
  }
  // 3) Hiç alınmamış günler: dünden geriye
  for (let d = yesterday; d >= from && out.length < left; d = addDays(d, -1)) {
    if (!have.has(d) && now.getTime() >= finalAfter(d)) add(d);
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

/** Geçmişte eksik gün sayısı (`from`'dan düne; kesinleşmemiş dün dahil değil) */
export function missingFoyDays(from: string, have: ReadonlyMap<string, unknown>, now: Date): string[] {
  const today = todayTR(now);
  const out: string[] = [];
  for (let d = from; d < today; d = addDays(d, 1)) if (!have.has(d) && now.getTime() >= finalAfter(d)) out.push(d);
  return out;
}
