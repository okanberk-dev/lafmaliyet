import "server-only";

import { and, gt, inArray, isNotNull, isNull, max } from "drizzle-orm";

import { kasaDurumu, type KasaDurumu } from "@/lib/asilpos/kasa-durumu";
import { getDb, schema as s, type DB } from "@/server/db";
import { posKeyState } from "@/server/asilpos/branch";

/**
 * Şubelerin AsilPOS kasa durumu (Şube ekleme sayfası, "Bilgisayara kur" onayı; kural src/lib/asilpos/kasa-durumu.ts).
 * Yalnız okur: anahtarın durumu (posKeyState, önbelleksiz), kurulum kodları ve son kabul edilen gün sonu. Anahtar üretmez,
 * kasanın çağırdığı uçlara dokunmaz
 */
export async function loadKasaDurumlari(branchIds: readonly string[], db: DB = getDb(), now: Date = new Date()): Promise<Record<string, KasaDurumu>> {
  const ids = [...new Set(branchIds)];
  if (!ids.length) return {};
  const [used, pending, days, keys] = await Promise.all([
    db
      .selectDistinct({ branchId: s.asilposInstalls.branchId })
      .from(s.asilposInstalls)
      .where(and(inArray(s.asilposInstalls.branchId, ids), isNotNull(s.asilposInstalls.usedAt))),
    db
      .select({ branchId: s.asilposInstalls.branchId, expiresAt: max(s.asilposInstalls.expiresAt) })
      .from(s.asilposInstalls)
      .where(and(inArray(s.asilposInstalls.branchId, ids), isNull(s.asilposInstalls.usedAt), isNull(s.asilposInstalls.revokedAt), gt(s.asilposInstalls.expiresAt, now)))
      .groupBy(s.asilposInstalls.branchId),
    db
      .select({ branchId: s.posDayReports.branchId, date: max(s.posDayReports.date), receivedAt: max(s.posDayReports.receivedAt) })
      .from(s.posDayReports)
      .where(inArray(s.posDayReports.branchId, ids))
      .groupBy(s.posDayReports.branchId),
    Promise.all(ids.map(async (id) => [id, (await posKeyState(id, db)).secret !== null] as const)),
  ]);
  const usedSet = new Set(used.map((r) => r.branchId));
  const pendingOf = new Map(pending.map((r) => [r.branchId, r.expiresAt]));
  const dayOf = new Map(days.map((r) => [r.branchId, r]));
  const keyOf = new Map(keys);
  const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null);
  const out: Record<string, KasaDurumu> = {};
  for (const id of ids) {
    const day = dayOf.get(id);
    const receivedAt = iso(day?.receivedAt);
    out[id] = kasaDurumu(
      {
        anahtar: keyOf.get(id) ?? false,
        kodKullanildi: usedSet.has(id),
        bekleyen: iso(pendingOf.get(id)),
        sonGun: day?.date && receivedAt ? { date: day.date, receivedAt } : null,
      },
      now,
    );
  }
  return out;
}

/** Tek şubenin kasa durumu */
export async function loadKasaDurumu(branchId: string, db: DB = getDb(), now: Date = new Date()): Promise<KasaDurumu> {
  return (await loadKasaDurumlari([branchId], db, now))[branchId] ?? { durum: "yok" };
}
