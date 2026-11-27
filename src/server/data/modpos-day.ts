import "server-only";

import { branchSwitchDay, isAsilposDay } from "@/lib/asilpos/switch";
import { modposAnyKey, modposKeyProblem } from "@/lib/modpos/request";
import { sheetZ, type ModposZ } from "@/lib/modpos/z";
import { modposPairKey } from "@/lib/modpos/zil";
import { currentTillBranch } from "@/server/branch-scope";
import { getDb, type DB } from "@/server/db";
import { asilposBranchId } from "@/server/asilpos/branch";
import { loadAsilposSwitchDay } from "@/server/asilpos/status";
import { loadModposSheet, loadModposSheets, type ModposSheet } from "@/server/modpos/store";

/**
 * Yöneticinin Kasa ekranının ModPOS kasa föyü (docs/MODPOS-API.md › Nerede görünür): günün kasası ModPOS mu ve o günün
 * saklanan föyü. Yalnız veritabanını okur, **API'ye hiçbir zaman istek göndermez** (günde 2 hak; çekme yalnız sabah işi
 * ve Ayarlar'daki "Bu günü çek"; docs/MODPOS-API.md › Kota ve çekme sırası). Yalnız yönetici dalında çağrılır: föyün
 * tutarları, giderleri ve notları personele gitmez (tests/modpos-kasa.test.ts).
 *
 * `modpos`: gün ModPOS günü (AsilPOS geçiş günü boş ya da gün ondan önce; src/lib/asilpos/switch.ts). Geçiş gününden
 * itibaren AsilPOS'un şubesinin kasası AsilPOS'tur, föy karşılaştırılmaz: `sheet` ve `z` null (o güne yanlışlıkla çekilmiş
 * föy de okunmaz). Geçiş günü yalnız o şubenindir (branchSwitchDay): ModPOS'ta kalan şubenin her günü ModPOS günüdür.
 */
export interface KasaModpos {
  modpos: boolean;
  /** Saklanan föy (yoksa ya da AsilPOS günüyse null) */
  sheet: ModposSheet | null;
  /** Föyün formun diline çevrilmiş özeti (foyZ; satışsız ve kasasız günde null) */
  z: ModposZ | null;
}

/** AsilPOS günü ya da föyü okunamayan gün: kart ve rozet çıkmaz */
export const NO_MODPOS: KasaModpos = { modpos: false, sheet: null, z: null };

const withZ = (sheet: ModposSheet | null): KasaModpos => ({ modpos: true, sheet, z: sheet ? sheetZ(sheet) : null });

/**
 * Bir günün ModPOS föyü (yöneticinin gün görünümü, `?gun=`): AsilPOS gününde `{ modpos: false }` ve föy okunmaz. Föy
 * tek şubenindir (docs/MODPOS-API.md › Şubeler): verilen şube (ekranda duran raporun şubesi), yoksa seçili şube;
 * "Tümü"de Tuzla (store.ts gunSubesi). Başka şubenin föyü bu günün raporuyla karşılaştırılmaz.
 */
export async function loadKasaModpos(date: string, db: DB = getDb(), branchId?: string): Promise<KasaModpos> {
  const [switchDay, sube, asilposBranch] = await Promise.all([loadAsilposSwitchDay(db), branchId ?? currentTillBranch(), asilposBranchId(db)]);
  if (isAsilposDay(date, branchSwitchDay(switchDay, sube, asilposBranch))) return NO_MODPOS;
  // Günün görünümü ham XML'i de gösterir (ModPOS bölümünün "Ham föy"ü)
  return withZ(await loadModposSheet(date, db, { raw: true, branchId: sube }));
}

/**
 * [from, to] içindeki günlerin ModPOS föyleri (yöneticinin günden güne listesi; tek sorgu): `of(gün, şube)`
 * loadKasaModpos'un aynısını verir. Föyler (şube, gün) ile tutulur: "Tümü"de iki şubenin aynı günü birbirini ezmez,
 * satır kendi raporunun şubesinin föyünü alır; şube verilmezse `fallback` (seçili şube, "Tümü"de Tuzla). AsilPOS'un
 * şubesinin geçiş gününden itibaren günleri föysüzdür (branchSwitchDay); ModPOS'ta kalan şubenin föyleri aralığın
 * tamamında okunur.
 */
export async function loadKasaModposDays(from: string, to: string, db: DB = getDb(), fallback?: string): Promise<(date: string, branchId?: string | null) => KasaModpos> {
  const [switchDay, sube, asilposBranch] = await Promise.all([loadAsilposSwitchDay(db), fallback ?? currentTillBranch(), asilposBranchId(db)]);
  const out = new Map<string, KasaModpos>();
  const of = (date: string, branchId?: string | null): KasaModpos => {
    const b = branchId ?? sube;
    return isAsilposDay(date, branchSwitchDay(switchDay, b, asilposBranch)) ? NO_MODPOS : (out.get(modposPairKey(b, date)) ?? withZ(null));
  };
  for (const sheet of await loadModposSheets(from, to, db)) out.set(modposPairKey(sheet.branchId, sheet.day), withZ(sheet));
  return of;
}

/**
 * ModPOS anahtarı kurulu mu (biçimi doğru; docs/MODPOS-API.md › Kurulum): kurulmamışken föyü olmayan günde kart hiç
 * çıkmaz ("her sabah gelir" doğru olmazdı; durum Ayarlar › ModPOS kasa föyü kartında "Kurulmadı"). Saklanan föy
 * anahtar olmadan da görünür (önizleme canlının veritabanını okur). Şube verilirse o şubenin anahtarı (Marina'nın
 * anahtarı yokken Marina'nın günü "her sabah gelir" demesin), verilmezse herhangi bir şubeninki
 */
export function modposKeySet(env: Record<string, string | undefined> = process.env, branchId?: string): boolean {
  return branchId === undefined ? modposAnyKey(env) : modposKeyProblem(env, branchId) === null;
}
