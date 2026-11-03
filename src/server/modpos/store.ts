import "server-only";

import { createHash } from "node:crypto";

import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";

import type { KasaFoyu } from "@/lib/modpos/foy";
import type { StoredDay } from "@/lib/modpos/plan";
import { parseModposState, withDayErrors, withRun, MODPOS_STATE_KEY, type ModposRun, type ModposState } from "@/lib/modpos/status";
import { isFinalFoy, sheetCanonical, sheetPrevious, sheetState, type ModposSheetPrevious } from "@/lib/modpos/z";
import { getDb, schema as s, type DB } from "@/server/db";

/**
 * ModPOS kasa föylerinin saklanması ve okunması (docs/MODPOS-API.md › Saklama). Bir kasa günü tek satırdır
 * (modpos_cash_sheets); yazım tek işlemde ve günün danışma kilidi altında (aynı gün aynı anda iki kez çekilirse ikinci
 * yazan birincinin sonucunu görür). İçerik parmak iziyle karşılaştırılır: aynıysa yalnız çekilme anı, değiştiyse sürüm
 * artar ve önceki özet saklanır.
 */

export type SheetChange = "yeni" | "degisti" | "ayni";

export interface ModposSheet {
  day: string;
  foy: KasaFoyu;
  state: "KAPALI" | "ACIK" | "BOS";
  final: boolean;
  revision: number;
  previous: ModposSheetPrevious | null;
  generatedAt: string | null;
  fetchedAt: string;
  changedAt: string;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Saklanan föyün en az biçimi (eski ya da bozuk satır okunmaz) */
function isSheet(v: unknown): v is KasaFoyu {
  const o = v as KasaFoyu | null;
  return !!o && typeof o === "object" && typeof o.kasaGunu === "string" && Array.isArray(o.kasalar) && Array.isArray(o.foysuzGunler);
}

type Row = typeof s.modposCashSheets.$inferSelect;

function toSheet(r: Row): ModposSheet | null {
  if (!isSheet(r.sheet)) return null;
  return {
    day: r.day,
    foy: r.sheet,
    state: r.state,
    final: r.final,
    revision: r.revision,
    previous: r.previous ?? null,
    generatedAt: iso(r.generatedAt),
    fetchedAt: r.fetchedAt.toISOString(),
    changedAt: r.changedAt.toISOString(),
  };
}

export function sheetFingerprint(foy: KasaFoyu): string {
  return createHash("sha256").update(sheetCanonical(foy)).digest("hex");
}

/** Föyü yazar; aynı içerik yeniden yazılmaz */
export async function storeFoy(db: DB, foy: KasaFoyu, fetchedAt: Date): Promise<{ change: SheetChange; revision: number; final: boolean; previous: ModposSheetPrevious | null }> {
  const fingerprint = sheetFingerprint(foy);
  const final = isFinalFoy(foy, fetchedAt);
  const state = sheetState(foy);
  const generatedAt = foy.olusturulma ? new Date(foy.olusturulma) : null;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`modpos-foy:${foy.kasaGunu}`}))`);
    const [old] = await tx.select().from(s.modposCashSheets).where(eq(s.modposCashSheets.day, foy.kasaGunu)).limit(1);
    if (!old) {
      await tx.insert(s.modposCashSheets).values({ day: foy.kasaGunu, sheet: foy, state, final, fingerprint, revision: 1, generatedAt, fetchedAt, changedAt: fetchedAt });
      return { change: "yeni" as const, revision: 1, final, previous: null };
    }
    // Daha önce kesinleşen gün kesin kalır (sonraki çekim de kesinleşme anından sonradır)
    const nextFinal = old.final || final;
    if (old.fingerprint === fingerprint) {
      await tx.update(s.modposCashSheets).set({ final: nextFinal, fetchedAt, generatedAt: generatedAt ?? old.generatedAt, sheet: foy }).where(eq(s.modposCashSheets.day, foy.kasaGunu));
      return { change: "ayni" as const, revision: old.revision, final: nextFinal, previous: old.previous ?? null };
    }
    const previous = isSheet(old.sheet)
      ? sheetPrevious(old.sheet, { fetchedAt: old.fetchedAt.toISOString(), generatedAt: iso(old.generatedAt), revision: old.revision })
      : null;
    const revision = old.revision + 1;
    await tx
      .update(s.modposCashSheets)
      .set({ sheet: foy, state, final: nextFinal, fingerprint, revision, previous, generatedAt, fetchedAt, changedAt: fetchedAt })
      .where(eq(s.modposCashSheets.day, foy.kasaGunu));
    return { change: "degisti" as const, revision, final: nextFinal, previous };
  });
}

/** Okuyucu: veritabanı ya da işlem (yalnız select) */
type Reader = Pick<DB, "select">;

export async function loadModposSheet(day: string, db: Reader = getDb()): Promise<ModposSheet | null> {
  const [r] = await db.select().from(s.modposCashSheets).where(eq(s.modposCashSheets.day, day)).limit(1);
  return r ? toSheet(r) : null;
}

/** [from, to] içindeki föyler, eskiden yeniye */
export async function loadModposSheets(from: string, to: string, db: Reader = getDb()): Promise<ModposSheet[]> {
  const rows = await db
    .select()
    .from(s.modposCashSheets)
    .where(and(gte(s.modposCashSheets.day, from), lte(s.modposCashSheets.day, to)))
    .orderBy(asc(s.modposCashSheets.day));
  return rows.flatMap((r) => toSheet(r) ?? []);
}

/** Planlayıcının girdisi: saklanan günler (kesin mi, son çekilme anı) */
export async function loadModposIndex(db: Reader = getDb()): Promise<Map<string, StoredDay>> {
  const rows = await db.select({ day: s.modposCashSheets.day, final: s.modposCashSheets.final, fetchedAt: s.modposCashSheets.fetchedAt }).from(s.modposCashSheets);
  return new Map(rows.map((r) => [r.day, { final: r.final, fetchedAt: r.fetchedAt.toISOString() }]));
}

/** Son çekilen föyler (Ayarlar kartının listesi) */
export async function recentModposSheets(limit: number, db: Reader = getDb()): Promise<ModposSheet[]> {
  const rows = await db.select().from(s.modposCashSheets).orderBy(desc(s.modposCashSheets.day)).limit(limit);
  return rows.flatMap((r) => toSheet(r) ?? []);
}

// ---------------------------------------------------------------- Durum (integration_state › modpos)

export async function readModposState(db: Reader = getDb()): Promise<ModposState> {
  const [row] = await db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, MODPOS_STATE_KEY)).limit(1);
  return parseModposState(row?.value);
}

/**
 * Durumu günceller: üst düzey alanlar birleştirilir, çalışma listenin başına eklenir. Satır kilitlenir (sabah işi ile
 * elle çekim aynı anda biterse biri ötekinin çalışmasını düşürmez). Hata ana sonucu bozmaz.
 */
export async function noteModposRun(
  db: DB,
  patch: Partial<Pick<ModposState, "quota" | "lastOk" | "lastError">>,
  run: ModposRun | null,
  /** Alınan ve alınamayan günler: gün hataları kilit altında güncellenir (src/lib/modpos/status.ts withDayErrors) */
  dayResults?: { ok: readonly string[]; failed: readonly { day: string; kod: string }[] },
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`insert into integration_state (key, value) values (${MODPOS_STATE_KEY}, '{}'::jsonb) on conflict (key) do nothing`);
      const [row] = await tx.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, MODPOS_STATE_KEY)).for("update").limit(1);
      const cur = parseModposState(row?.value);
      const at = run?.at ?? new Date().toISOString();
      const dayErrors = dayResults ? withDayErrors(cur.dayErrors, dayResults.ok, dayResults.failed, at) : cur.dayErrors;
      const next: ModposState = { ...cur, ...patch, runs: run ? withRun(cur.runs, run) : cur.runs, dayErrors };
      await tx.execute(sql`update integration_state set value = ${JSON.stringify(next)}::jsonb, updated_at = now() where key = ${MODPOS_STATE_KEY}`);
    });
  } catch (e) {
    console.error("[modpos] durum yazılamadı:", e instanceof Error ? e.message : e);
  }
}

// ---------------------------------------------------------------- Çalışma kirası (integration_state › modpos.kira)

/** Aynı anda tek çekim: sabah işi iki kez tetiklenirse ya da "Bu günü çek" sabah işiyle çakışırsa aynı gün iki kez çekilip iki hak harcanmasın */
export const MODPOS_LEASE_KEY = "modpos.kira";
/** Kiranın süresi: işlevin en uzun süresinden (60 sn) uzun; yarıda kesilen çalışmanın kirası kendiliğinden düşer */
export const MODPOS_LEASE_MS = 90_000;

/**
 * Kirayı alır: boşsa ya da süresi geçmişse (tek koşullu yazımla) alınır ve kimliği döner; başka çalışma tutuyorsa null.
 * Kimlik, bırakırken yalnız kendi kirasını silmek içindir
 */
export async function takeModposLease(db: DB, now: Date = new Date()): Promise<string | null> {
  const id = `${now.getTime()}-${Math.random().toString(36).slice(2, 10)}`;
  const until = new Date(now.getTime() + MODPOS_LEASE_MS).toISOString();
  const value = JSON.stringify({ id, until });
  const rows = (await db.execute(sql`
    insert into integration_state (key, value) values (${MODPOS_LEASE_KEY}, ${value}::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now()
      where (integration_state.value->>'until') is null or (integration_state.value->>'until')::timestamptz < ${now.toISOString()}::timestamptz
    returning key`)) as unknown as unknown[];
  return rows.length ? id : null;
}

/** Kirayı bırakır (yalnız kendi kirasını); hata ana sonucu bozmaz, kira süresi dolunca zaten düşer */
export async function releaseModposLease(db: DB, id: string): Promise<void> {
  try {
    await db.execute(sql`delete from integration_state where key = ${MODPOS_LEASE_KEY} and value->>'id' = ${id}`);
  } catch (e) {
    console.error("[modpos] kira bırakılamadı:", e instanceof Error ? e.message : e);
  }
}
