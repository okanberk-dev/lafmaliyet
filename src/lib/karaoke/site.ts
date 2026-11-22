import { z } from "zod";

import {
  DESK_BLOCK_CHANNEL,
  DESK_CHANNEL,
  deskKindOfChannel,
  isCancelledBooking,
  PAYMENT_STATUSES,
  type KaraokeStatus,
  type PaymentStatus,
  type SiteReservation,
} from "./session";

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
  // İsteğe bağlı: site bugün göndermiyor; gönderirse iptal anı ondan (yoksa ya da bozuksa yok sayılır)
  cancelledAt: z.string().max(40).optional().catch(undefined),
  // İsteğe bağlı (site 29 Ekim 2026'dan beri gönderir): iptalin iade tutarı; eski site göndermez, bozuksa yok sayılır
  refundMinor: z.number().int().min(0).nullable().optional().catch(undefined),
  // İsteğe bağlı (site 22 Kasım 2026'dan beri gönderir; ekleme): köşkte alınan satır ve kapatılan saat. Eski site
  // göndermez, bozuksa yok sayılır; `block` yoksa okunuşta türetilir (readDeskFlags)
  desk: z.boolean().optional().catch(undefined),
  block: z.boolean().optional().catch(undefined),
});

/** Sitenin kapatılan saat notunun başı ("Kapalı" ya da "Kapalı: özel etkinlik"; sitenin DESK_BLOCK_NOTE_PREFIX'i) */
export const DESK_BLOCK_NOTE_PREFIX = "Kapalı";

/**
 * Köşkte alınan satırın iki işareti: `desk` site göndermezse false (eski site elle satır bilmiyordu); `block` göndermezse
 * sitenin kuralıyla türetilir (isDeskBlock: elle satır, ücretsiz, notu "Kapalı" ile başlıyor). Elle olmayan satır hiçbir
 * zaman kapatılan saat sayılmaz.
 */
export function readDeskFlags(r: { desk?: boolean; block?: boolean; totalMinor: number; note: string }): { desk: boolean; block: boolean } {
  const desk = r.desk === true;
  if (!desk) return { desk: false, block: false };
  const block = typeof r.block === "boolean" ? r.block : r.totalMinor === 0 && r.note.startsWith(DESK_BLOCK_NOTE_PREFIX);
  return { desk, block };
}

export { DESK_BLOCK_CHANNEL, DESK_CHANNEL, deskKindOfChannel };

/** Panelin `karaoke_sessions.channel` sütunu: elle satırda "desk" / "desk-block" (migration yok), değilse sitenin kanalı */
export function sessionChannel(r: Pick<SiteReservation, "channel" | "desk" | "block">): string | null {
  if (r.block) return DESK_BLOCK_CHANNEL;
  if (r.desk) return DESK_CHANNEL;
  return r.channel || null;
}

/**
 * Sitenin tek satırını doğrular (GET'in her satırı ve elle eklemenin 201 yanıtı aynı biçimde): okunamazsa null.
 * İşaretler normalleşir (readDeskFlags).
 */
export function parseSiteReservation(raw: unknown): SiteReservation | null {
  const r = reservationSchema.safeParse(raw);
  if (!r.success || !(Date.parse(r.data.endsAt) > Date.parse(r.data.startsAt))) return null;
  const flags = readDeskFlags(r.data);
  return { ...(r.data as SiteReservation), ...flags };
}

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
  /** Atlanan satırlardan kimliği okunabilenler: sitede duruyorlar, panelin kopyası silinmez (`goneSiteRows`) */
  skippedIds: string[];
}

/** Atlanan ham satırın kimliği (boş olmayan metinse); okunamazsa null */
function rawId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const id = (raw as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 && id.length <= 64 ? id : null;
}

export function parseSiteResponse(json: unknown): SiteSnapshot {
  const res = responseSchema.parse(json);
  const reservations: SiteReservation[] = [];
  const skippedIds: string[] = [];
  let skipped = 0;
  for (const raw of res.reservations) {
    const r = parseSiteReservation(raw);
    if (r) reservations.push(r);
    else {
      skipped++;
      const id = rawId(raw);
      if (id) skippedIds.push(id);
    }
  }
  return { now: res.now, from: res.from, to: res.to, complete: res.complete, reservations, skipped, skippedIds };
}

/**
 * Sitede artık olmayan (silinmiş) rezervasyonların paneldeki satırları: eşitleme bunları kaldırır. Yalnız eksiksiz
 * yanıtta. Okunamayıp atlanan satır silinmiş sayılmaz (denetim 21 Kasım #33): sitede duruyor, panel bu kez okuyamadı;
 * silinirse sayacın uzatması, "bitti" işareti ve iptal anı gider, satır yeniden okununca sahte "yeni rezervasyon"
 * bildirimi gider. Kimliği okunabilen atlanan satırın kopyası kalır; kimliği de okunamayan bir satır varsa hangi
 * rezervasyon olduğu bilinmediği için bu çekmede hiçbir satır silinmez.
 */
export function goneSiteRows<T extends { externalId: string | null }>(snapshot: Pick<SiteSnapshot, "complete" | "reservations" | "skipped" | "skippedIds">, existing: readonly T[]): T[] {
  if (!snapshot.complete || snapshot.skipped > snapshot.skippedIds.length) return [];
  const seen = new Set([...snapshot.reservations.map((r) => r.id), ...snapshot.skippedIds]);
  return existing.filter((r) => r.externalId && !seen.has(r.externalId));
}

/** Sitenin zaman metni → Date; boş ya da bozuksa null */
export function siteTime(v: string | null | undefined): Date | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
}

/**
 * Rezervasyonun iptal anı (doluluk haritasının "son dakika iptal"i; docs/KARAOKE.md › Doluluk haritası). Satır iptal
 * edilmiş bir rezervasyon değilse null (yeniden açılan iptal de boşalır). Site anı gönderirse o; panel anı zaten
 * biliyorsa korunur. Yoksa iptale geçişi panel gördüyse (önceki satır iptal değildi) sitenin son değişikliği
 * (updatedAt; ping saniyeler içinde gelir), o da yoksa şimdi. Önceki satırda iptal anı yoksa bilinmez (null). İlk kez
 * iptal hâlinde görülen satırda (ilk eşitleme, geçmişten alma) yalnız ödeme akışı yoksa (ödeme yok ya da bekliyor)
 * updatedAt: iade adımları updatedAt'i sonradan oynatır, ödenmiş ya da iade edilmişte zaman bilinmez. Gelecekteki an
 * şimdiye kırpılır (iki sunucunun saat farkı).
 */
export function cancelledAtFor(
  prev: { cancelledAt: Date | null; status: KaraokeStatus; paymentStatus: PaymentStatus } | null,
  r: Pick<SiteReservation, "status" | "paymentStatus" | "updatedAt" | "cancelledAt">,
  now: Date,
): Date | null {
  if (!isCancelledBooking(r)) return null;
  const clamp = (d: Date) => (d.getTime() > now.getTime() ? now : d);
  const site = siteTime(r.cancelledAt);
  if (site) return clamp(site);
  if (prev?.cancelledAt) return prev.cancelledAt;
  const updated = siteTime(r.updatedAt);
  if (prev) return isCancelledBooking(prev) ? null : clamp(updated ?? now);
  return updated && (r.paymentStatus === "none" || r.paymentStatus === "pending") ? clamp(updated) : null;
}
