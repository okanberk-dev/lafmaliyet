/**
 * KDV ve KDV-2 hatırlatıcılarında "Ödendi"nin nakit planı için kalıcı kaydı (integration_state `payments.vat-paid`;
 * saf kurallar, tests/nakit-plani.test.ts). Ödemeler'in son ödenenler listesi (`payments.recent`) 30 gün ve 30 kayıtla
 * sınırlı, faturalarla ortaktır: Eylül KDV'sinin kaydı Kasım'ın 28'inden (Ekim'in ödeme gününden) önce düşüyordu;
 * ödenen dönem yeniden tahmin olarak beliriyor, ödenen tutarın sıfırladığı devreden geri gelip Ekim'in KDV'sini
 * düşürüyordu. Bu kayıt 24 ay durur. "Geri al" o günden sonraki kayıtları siler; hatırlatıcıyı silmek silmez (ödeme
 * yapılmıştır).
 */

import { vatPeriodOf } from "./kdv";
import { nextOccurrence, postponedFrom, type ReminderRow } from "./reminders";

export const VAT_PAID_KEEP_DAYS = 730;

export interface VatPaidEntry {
  /** Hatırlatıcının kimliği */
  id: number;
  /** Ödenirken hatırlatıcının türü: asıl KDV (1 No.lu) ya da KDV-2 (tevkifat) */
  kind: "kdv" | "kdv2";
  /** Ödenen gün ve sıradaki gün (tek seferlikte null) */
  dueDate: string;
  next: string | null;
  /** Ödenen dönemler ("tarihe kadar ödendi" birkaçını kapatır) */
  periods: string[];
  /** Ödenirken hatırlatıcıdaki tutar: ilk döneme aittir */
  amount: number | null;
  /** Kaydın anı (ISO) */
  at: string;
}

/**
 * Ertelenmiş kopyanın asıl günü ("Ertelendi · asıl tarih 25.10.2026", postponeReminder): kopyanın dönemi ondan
 * bulunur. 8 Kasım'a ertelenen Eylül KDV-2'si Ekim'in değildir.
 */
export function originalDue(r: Pick<ReminderRow, "note" | "repeat">, due: string): string {
  return (r.repeat === "none" ? postponedFrom(r.note) : null) ?? due;
}

/** "Ödendi"nin kapattığı dönemler: ödenen gün ile sıradaki gün arasındaki her günün dönemi (asıl gününden) */
export function paidPeriodsOf(r: Pick<ReminderRow, "note" | "repeat" | "anchorDate">, dueDate: string, next: string | null): string[] {
  const out: string[] = [];
  let d: string | null = dueDate;
  for (let guard = 0; d && guard < 24; guard++) {
    const period = vatPeriodOf(originalDue(r, d));
    if (!out.includes(period)) out.push(period);
    if (r.repeat === "none" || !next) break;
    d = nextOccurrence(d, r.repeat, r.anchorDate);
    if (d && d >= next) break;
  }
  return out;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

/** integration_state'ten okunan değer: biçimi bozuk kayıtlar atılır */
export function parseVatPaid(v: unknown): VatPaidEntry[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (e): e is VatPaidEntry =>
      typeof e === "object" &&
      e !== null &&
      Number.isInteger(e.id) &&
      (e.kind === "kdv" || e.kind === "kdv2") &&
      typeof e.dueDate === "string" &&
      DAY.test(e.dueDate) &&
      (e.next === null || (typeof e.next === "string" && DAY.test(e.next))) &&
      Array.isArray(e.periods) &&
      e.periods.length > 0 &&
      e.periods.every((p: unknown) => typeof p === "string" && MONTH.test(p)) &&
      (e.amount === null || (typeof e.amount === "number" && Number.isFinite(e.amount) && e.amount >= 0)) &&
      typeof e.at === "string" &&
      !Number.isNaN(new Date(e.at).getTime()),
  );
}

/** Yeni kayıt eklenir (aynı hatırlatıcının aynı günü yenilenir), 24 aydan eskiler düşer */
export function addVatPaid(list: VatPaidEntry[], added: VatPaidEntry, now: string): VatPaidEntry[] {
  const cutoff = new Date(now).getTime() - VAT_PAID_KEEP_DAYS * 86_400_000;
  return [added, ...list.filter((e) => !(e.id === added.id && e.dueDate === added.dueDate))].filter((e) => new Date(e.at).getTime() >= cutoff);
}

/** "Geri al": hatırlatıcı `fromDue` gününe döndü, o günden itibaren ödenenler ödenmemiştir */
export function removeVatPaid(list: VatPaidEntry[], id: number, fromDue: string): VatPaidEntry[] {
  return list.filter((e) => e.id !== id || e.dueDate < fromDue);
}

/**
 * KDV kartındaki "Kaydı kaldır": o türün o dönemi ödenmemiş sayılır (yanlış Ödendi'den sonra hatırlatıcı silindiyse
 * Geri al yoktur). Dönem kayıtlardan çıkar; ilk dönemse tutar da (tutar ilk döneme aittir); dönemi kalmayan kayıt düşer.
 */
export function forgetVatPeriod(list: VatPaidEntry[], kind: VatPaidEntry["kind"], period: string): VatPaidEntry[] {
  const out: VatPaidEntry[] = [];
  for (const e of list) {
    if (e.kind !== kind || !e.periods.includes(period)) {
      out.push(e);
      continue;
    }
    const periods = e.periods.filter((p) => p !== period);
    if (periods.length) out.push({ ...e, periods, amount: e.periods[0] === period ? null : e.amount });
  }
  return out;
}
