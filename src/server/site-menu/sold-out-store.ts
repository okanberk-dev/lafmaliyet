import "server-only";

import { eq, sql } from "drizzle-orm";

import { parseSoldOut, SOLD_OUT_KEY, STAFF_TOGGLE_LIMIT, type SoldOutMarker, type SoldOutRecord } from "@/lib/site-menu/sold-out";
import type { SiteMenuItem } from "@/lib/site-menu/schema";
import { getDb, schema as s } from "@/server/db";

/**
 * Tükenenler kartının kaydı (dalga 10 §2.1; kurallar src/lib/site-menu/sold-out.ts): integration_state
 * `menu_sold_out`. Yazımlar çağıranın işleminde ve satır kilidiyle (FOR UPDATE): iki barista aynı anda dokununca biri
 * ötekinin kaydını silmez, ortak tavan kilit altında yeniden sayılır. `"use server"` değildir; eylem
 * src/server/actions/menu-status.ts, çekirdek src/server/site-menu/sold-out-core.ts.
 */

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Reader = Pick<ReturnType<typeof getDb>, "select">;

/** Kayıt (kilitsiz okuma: kart, Bugün, zil) */
export async function readMarkers(db: Reader = getDb()): Promise<SoldOutRecord> {
  const [row] = await db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, SOLD_OUT_KEY)).limit(1);
  return parseSoldOut(row?.value);
}

/** Kaydı işlem boyunca kilitler (satır yoksa önce boş satır açılır) ve okur */
export async function lockSoldOut(tx: Tx): Promise<SoldOutRecord> {
  await tx.execute(sql`insert into integration_state (key, value) values (${SOLD_OUT_KEY}, ${JSON.stringify({ items: {}, toggles: {} })}::jsonb) on conflict (key) do nothing`);
  const [row] = await tx.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, SOLD_OUT_KEY)).for("update");
  return parseSoldOut(row?.value);
}

/** Kilitli kaydı yazar; hız sınırının penceresinden eski işlem anları atılır */
export async function saveSoldOut(tx: Tx, record: SoldOutRecord, now: Date): Promise<void> {
  const toggles = Object.fromEntries(Object.entries(record.toggles).filter(([, at]) => now.getTime() - Date.parse(at) < STAFF_TOGGLE_LIMIT.windowMs));
  await tx
    .update(s.integrationState)
    .set({ value: { items: record.items, toggles }, updatedAt: now })
    .where(eq(s.integrationState.key, SOLD_OUT_KEY));
}

/** Kalemin kaydını yazar (kilit altında) */
export async function writeMarker(tx: Tx, id: string, marker: SoldOutMarker, now: Date): Promise<void> {
  const record = await lockSoldOut(tx);
  record.items[id] = marker;
  await saveSoldOut(tx, record, now);
}

/** Kalemin kaydını düşürür (kilit altında); kayıt yoksa bir şey yazmaz */
export async function dropMarker(tx: Tx, id: string, now: Date): Promise<void> {
  const record = await lockSoldOut(tx);
  if (!record.items[id]) return;
  delete record.items[id];
  await saveSoldOut(tx, record, now);
}

/**
 * Panelin yalnız fiyat yazımı (updateProductPrice, saveRecipe, toplu Fiyatlar; src/server/site-menu/push.ts ›
 * applyPushed) sitede kalemin damgasını ilerletir. Kalem kartla kapatılmışsa ve kayıt yazımdan önceki damgaya aitse
 * kayıt yeni damgaya taşınır: panelin kendi fiyat değişikliği personelin kaydını geçersiz kılmaz. Sitede başka bir
 * şey değiştiyse (damga farklı) dokunulmaz: kalem yöneticiye kalır. Çağıran menü kilidini tutar.
 */
export async function carrySoldOutMarker(tx: Tx, prevUpdatedAt: string | null, item: Pick<SiteMenuItem, "id" | "isActive" | "updatedAt">): Promise<void> {
  if (!prevUpdatedAt || item.isActive || !item.updatedAt || item.updatedAt === prevUpdatedAt) return;
  // Kilitsiz bakış: kayıt yoksa (çoğu fiyat yazımı) satır kilitlenmez
  if ((await readMarkers(tx)).items[item.id]?.siteUpdatedAt !== prevUpdatedAt) return;
  const record = await lockSoldOut(tx);
  const marker = record.items[item.id];
  if (!marker || marker.siteUpdatedAt !== prevUpdatedAt) return;
  record.items[item.id] = { ...marker, siteUpdatedAt: item.updatedAt };
  await saveSoldOut(tx, record, new Date());
}
