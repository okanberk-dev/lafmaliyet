import "server-only";

import { isLafposDay } from "@/lib/lafpos/switch";
import { modposKeyProblem } from "@/lib/modpos/request";
import { sheetZ, type ModposZ } from "@/lib/modpos/z";
import { addDays } from "@/lib/reminders";
import { getDb, type DB } from "@/server/db";
import { loadLafposSwitchDay } from "@/server/lafpos/status";
import { loadModposSheet, loadModposSheets, type ModposSheet } from "@/server/modpos/store";

/**
 * Yöneticinin Kasa ekranının ModPOS kasa föyü (docs/MODPOS-API.md › Nerede görünür): günün kasası ModPOS mu ve o günün
 * saklanan föyü. Yalnız veritabanını okur, **API'ye hiçbir zaman istek göndermez** (günde 2 hak; çekme yalnız sabah işi
 * ve Ayarlar'daki "Bu günü çek"; docs/MODPOS-API.md › Kota ve çekme sırası). Yalnız yönetici dalında çağrılır: föyün
 * tutarları, giderleri ve notları personele gitmez (tests/modpos-kasa.test.ts).
 *
 * `modpos`: gün ModPOS günü (LafPOS geçiş günü boş ya da gün ondan önce; src/lib/lafpos/switch.ts). Geçiş gününden
 * itibaren kasa LafPOS'tur, föy karşılaştırılmaz: `sheet` ve `z` null (o güne yanlışlıkla çekilmiş föy de okunmaz).
 */
export interface KasaModpos {
  modpos: boolean;
  /** Saklanan föy (yoksa ya da LafPOS günüyse null) */
  sheet: ModposSheet | null;
  /** Föyün formun diline çevrilmiş özeti (foyZ; satışsız ve kasasız günde null) */
  z: ModposZ | null;
}

/** LafPOS günü ya da föyü okunamayan gün: kart ve rozet çıkmaz */
export const NO_MODPOS: KasaModpos = { modpos: false, sheet: null, z: null };

const withZ = (sheet: ModposSheet | null): KasaModpos => ({ modpos: true, sheet, z: sheet ? sheetZ(sheet) : null });

/**
 * Bir günün ModPOS föyü (yöneticinin gün görünümü, `?gun=`): LafPOS gününde `{ modpos: false }` ve föy okunmaz
 */
export async function loadKasaModpos(date: string, db: DB = getDb()): Promise<KasaModpos> {
  if (isLafposDay(date, await loadLafposSwitchDay(db))) return NO_MODPOS;
  // Günün görünümü ham XML'i de gösterir (ModPOS bölümünün "Ham föy"ü)
  return withZ(await loadModposSheet(date, db, { raw: true }));
}

/**
 * [from, to] içindeki günlerin ModPOS föyleri (yöneticinin günden güne listesi; tek sorgu, seçili şubeyle): `of(gün,
 * şube)` loadKasaModpos'un aynısını verir; şube verilince yalnız o şubenin föyü ("Tümü"de Marina'nın raporu Tuzla'nın
 * föyüyle karşılaştırılmaz). Geçiş günü bu aralıktaysa yalnız ondan önceki günler okunur; aralığın tamamı LafPOS ise hiç
 * okunmaz.
 */
export async function loadKasaModposDays(from: string, to: string, db: DB = getDb()): Promise<(date: string, branchId?: string) => KasaModpos> {
  const switchDay = await loadLafposSwitchDay(db);
  const out = new Map<string, KasaModpos>();
  const of = (date: string, branchId?: string): KasaModpos => (isLafposDay(date, switchDay) ? NO_MODPOS : (out.get(branchId === undefined ? date : `${date}|${branchId}`) ?? withZ(null)));
  const end = switchDay !== null && switchDay <= to ? addDays(switchDay, -1) : to;
  if (end < from) return of;
  for (const sheet of await loadModposSheets(from, end, db)) {
    const view = withZ(sheet);
    out.set(`${sheet.day}|${sheet.branchId}`, view);
    if (!out.has(sheet.day)) out.set(sheet.day, view);
  }
  return of;
}

/**
 * ModPOS anahtarı kurulu mu (biçimi doğru; docs/MODPOS-API.md › Kurulum): kurulmamışken föyü olmayan günde kart hiç
 * çıkmaz ("her sabah gelir" doğru olmazdı; durum Ayarlar › ModPOS kasa föyü kartında "Kurulmadı"). Saklanan föy
 * anahtar olmadan da görünür (önizleme canlının veritabanını okur)
 */
export function modposKeySet(env: Record<string, string | undefined> = process.env): boolean {
  return modposKeyProblem(env) === null;
}
