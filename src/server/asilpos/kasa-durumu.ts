import "server-only";

import { and, eq, gt, inArray, isNotNull, isNull, max } from "drizzle-orm";

import { kasaKaydi, type KasaKaydi } from "@/lib/asilpos/kasa-acilis";
import { kasaDurumu, type KasaDurumu } from "@/lib/asilpos/kasa-durumu";
import { getDb, schema as s, type DB } from "@/server/db";
import { posKeyState } from "@/server/asilpos/branch";

type Reader = Pick<DB, "select">;
type Writer = Pick<DB, "insert">;

/**
 * Şubenin kasa kaydı (integration_state; göç yok): kasa açılışı (`yol: "acilis"`), kurulum kodu (`"kod"`) ve "Kasayı
 * serbest bırak" (`"serbest"`, durum "bos") yazar. Varsa kasa durumunun ölçütünün yerine geçer (src/lib/asilpos/kasa-durumu.ts)
 */
export const KASA_KAYDI_PREFIX = "asilpos.kasa:";
/** Şube kasa kurulumu için hazırlandı ("Bilgisayara kur" ya da e-postalı yeni şube): `{at, by}`; kasa açılışında listelenir */
export const HAZIRLIK_PREFIX = "asilpos.hazirlik:";

const stateKeys = (prefix: string, ids: readonly string[]) => ids.map((id) => `${prefix}${id}`);

async function readStates(db: Reader, prefix: string, ids: readonly string[]): Promise<Map<string, unknown>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ key: s.integrationState.key, value: s.integrationState.value }).from(s.integrationState).where(inArray(s.integrationState.key, stateKeys(prefix, ids)));
  return new Map(rows.map((r) => [r.key.slice(prefix.length), r.value]));
}

async function writeState(db: Writer, key: string, value: unknown): Promise<void> {
  await db
    .insert(s.integrationState)
    .values({ key, value })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
}

/** Şubelerin kasa kayıtları (bozuk kayıt yokmuş gibi) */
export async function readKasaKayitlari(ids: readonly string[], db: Reader = getDb()): Promise<Map<string, KasaKaydi>> {
  const out = new Map<string, KasaKaydi>();
  for (const [id, v] of await readStates(db, KASA_KAYDI_PREFIX, ids)) {
    const k = kasaKaydi(v);
    if (k) out.set(id, k);
  }
  return out;
}

export async function readKasaKaydi(id: string, db: Reader = getDb()): Promise<KasaKaydi | null> {
  return (await readKasaKayitlari([id], db)).get(id) ?? null;
}

/** Şubenin kasa kaydını yazar (eylemin ya da ucun işleminin içinden de) */
export async function writeKasaKaydi(db: Writer, id: string, kayit: KasaKaydi): Promise<void> {
  await writeState(db, `${KASA_KAYDI_PREFIX}${id}`, kayit);
}

/** Hazırlanmış şubeler (kasa açılışında ModPOS şubesi de listelenir) */
export async function readHazirlik(ids: readonly string[], db: Reader = getDb()): Promise<Set<string>> {
  return new Set((await readStates(db, HAZIRLIK_PREFIX, ids)).keys());
}

/** "Bilgisayara kur" denildi: şube kasa açılışında seçilebilir (kasa programı ModPOS kalsa da) */
export async function writeHazirlik(db: Writer, id: string, by: string, now: Date = new Date()): Promise<void> {
  await writeState(db, `${HAZIRLIK_PREFIX}${id}`, { at: now.toISOString(), by });
}

/** Şubenin son kabul edilen gün sonunun geldiği an (ISO); yoksa null (serbest bırakmanın "canlı şube" uyarısı) */
export async function lastDayReceivedAt(id: string, db: Reader = getDb()): Promise<string | null> {
  const [row] = await db.select({ at: max(s.posDayReports.receivedAt) }).from(s.posDayReports).where(eq(s.posDayReports.branchId, id));
  return row?.at ? new Date(row.at).toISOString() : null;
}

/**
 * Şubelerin AsilPOS kasa durumu (Şube ekleme sayfası, "Bilgisayara kur" onayı, kasa açılışı; kural
 * src/lib/asilpos/kasa-durumu.ts). Yalnız okur: açık kasa kaydı, anahtarın durumu (posKeyState, önbelleksiz), kurulum
 * kodları ve son kabul edilen gün sonu. Anahtar üretmez, kasanın çağırdığı uçlara dokunmaz
 */
export async function loadKasaDurumlari(branchIds: readonly string[], db: DB = getDb(), now: Date = new Date()): Promise<Record<string, KasaDurumu>> {
  const ids = [...new Set(branchIds)];
  if (!ids.length) return {};
  const [used, pending, days, keys, kayitlar] = await Promise.all([
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
    readKasaKayitlari(ids, db),
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
        kayit: kayitlar.get(id) ?? null,
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
