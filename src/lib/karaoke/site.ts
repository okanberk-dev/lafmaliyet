import { z } from "zod";

import { PAYMENT_STATUSES, type SiteReservation } from "./session";

/**
 * Sitenin yanıtını doğrular: bozuk ya da beklenmeyen satır atlanır (eşitlemeyi durdurmaz), bilinmeyen durum
 * "requested" / "none" sayılır (site yeni bir değer eklese de panel çökmez). Metinler kısaltılır.
 */
const iso = z.string().max(40).refine((v) => Number.isFinite(Date.parse(v)), "Geçersiz zaman");

const reservationSchema = z.object({
  id: z.string().min(1).max(64),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startHour: z.number().int().min(0).max(30),
  hours: z.number().int().min(1).max(24),
  startsAt: iso,
  endsAt: iso,
  guests: z.number().int().min(0).max(1000).catch(0),
  status: z.enum(["requested", "confirmed", "cancelled"]).catch("requested"),
  paymentStatus: z.enum(PAYMENT_STATUSES as [string, ...string[]]).catch("none"),
  firstName: z.string().catch("").transform((v) => v.trim().slice(0, 40)),
  note: z.string().catch("").transform((v) => v.trim().slice(0, 300)),
  totalMinor: z.number().int().min(0).catch(0),
  channel: z.string().catch("").transform((v) => v.slice(0, 20)),
  createdAt: z.string().catch("").transform((v) => v.slice(0, 40)),
  updatedAt: z.string().catch("").transform((v) => v.slice(0, 40)),
});

const responseSchema = z.object({
  now: iso,
  from: z.string(),
  to: z.string(),
  complete: z.boolean(),
  reservations: z.array(z.unknown()).max(5000),
});

export interface SiteSnapshot {
  now: string;
  from: string;
  to: string;
  complete: boolean;
  reservations: SiteReservation[];
  /** Okunamayıp atlanan satır sayısı */
  skipped: number;
}

export function parseSiteResponse(json: unknown): SiteSnapshot {
  const res = responseSchema.parse(json);
  const reservations: SiteReservation[] = [];
  let skipped = 0;
  for (const raw of res.reservations) {
    const r = reservationSchema.safeParse(raw);
    if (r.success && Date.parse(r.data.endsAt) > Date.parse(r.data.startsAt)) reservations.push(r.data as SiteReservation);
    else skipped++;
  }
  return { now: res.now, from: res.from, to: res.to, complete: res.complete, reservations, skipped };
}
