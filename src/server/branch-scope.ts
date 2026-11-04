import "server-only";

import { cache } from "react";

import { cookies } from "next/headers";
import { and, eq, isNull, or, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import {
  ALL_BRANCHES,
  BRANCH_COOKIE,
  branchScopeLabel,
  type BranchRow,
  type BranchScope,
  DEFAULT_BRANCH_ID,
  parseBranchScope,
} from "@/lib/branches";

import { listBranches } from "./branches";
import { getDb, type DB } from "./db";

/**
 * Panelin o anki şube seçimi (docs/SUBE.md › Seçici). Kurallar saf dosyada (src/lib/branches.ts); burada yalnız
 * Next'in isteği ve veritabanı var.
 *
 * Seçim veriyi süzer, YETKİ VERMEZ: her uç ayrıca `requireAdmin`/`requireUser` ile korunur. Adresteki `?sube=`
 * çerezden önce gelir ki paylaşılan bağlantı hep aynı şubeyi göstersin; tanınmayan ya da pasif değer "hepsi"ye
 * düşer (`parseBranchScope`).
 */
export interface BranchScopeState {
  /** Seçili şube kimliği ya da "hepsi" */
  scope: BranchScope;
  /** Kütükteki bütün şubeler (pasifler dahil; seçici yalnız etkinleri gösterir) */
  branches: BranchRow[];
  /** Ekrandaki ad: "Tümü", "Marina" */
  label: string;
  /**
   * Yeni kaydın ineceği tek şube. "Tümü" seçiliyken yazmanın hedefi belirsizdir; varsayılan şubeye
   * (Tuzla) iner ve form kullanıcıya hangi şubeye yazdığını gösterir.
   */
  writeId: string;
}

export async function branchScope(raw?: unknown, db: DB = getDb()): Promise<BranchScopeState> {
  const branches = await listBranches(db);
  const fromUrl = typeof raw === "string" && raw ? raw : null;
  const chosen = fromUrl ?? (await cookies()).get(BRANCH_COOKIE)?.value ?? null;
  const scope = parseBranchScope(chosen, branches);
  return {
    scope,
    branches,
    label: branchScopeLabel(scope, branches),
    writeId: scope === ALL_BRANCHES ? DEFAULT_BRANCH_ID : scope,
  };
}

/**
 * İsteğin şube seçimi, imza değiştirmeden. Okuma işlevlerinin hepsine parametre eklemek yerine seçim tıpkı oturum
 * gibi (`requireUser`) buradan okunur; `cache` sayesinde bir istekte çerez bir kez okunur.
 *
 * İSTEK DIŞINDA (göç betiği, arka plan işi, test, `npm run build` sırasındaki ön üretim) `cookies()` fırlatır:
 * o zaman "hepsi"ye düşeriz, yani süzme yok — betik bütün şubeleri görür, ki doğrusu budur.
 */
export const currentBranchScope = cache(async (): Promise<BranchScope> => {
  try {
    const jar = await cookies();
    return parseBranchScope(jar.get(BRANCH_COOKIE)?.value ?? null, await listBranches());
  } catch {
    return ALL_BRANCHES;
  }
});

/**
 * Yeni kaydın ineceği tek şube. "Tümü" seçiliyken hedef belirsizdir ve varsayılan şubeye (Tuzla) iner; ekranlar
 * hangi şubeye yazdıklarını kullanıcıya gösterir. İstek dışında da varsayılan şube döner.
 */
export async function currentWriteBranch(): Promise<string> {
  const scope = await currentBranchScope();
  return scope === ALL_BRANCHES ? DEFAULT_BRANCH_ID : scope;
}

/**
 * Yeni GİDERİN şubesi. Giderde "şubesiz" geçerli bir değerdir: null = işletme geneli (kira, muhasebe,
 * abonelik; sahibin kararı, docs/SUBE.md › Dalga 2'nin kararları). Bu yüzden `currentWriteBranch` kullanılmaz:
 * o "Tümü" seçiliyken Tuzla'ya düşürür ve ortak gideri Tuzla'nın gideri yapardı.
 *
 * Kural: tek şube seçiliyken gider o şubenindir; "Tümü" seçiliyken işletme genelidir. Kullanıcı hangi şubeye
 * baktığını zaten görüyor, yani seçim niyetin kendisi.
 */
export async function currentExpenseBranch(): Promise<string | null> {
  const scope = await currentBranchScope();
  return scope === ALL_BRANCHES ? null : scope;
}

/**
 * Anahtarı şubeyi içeren tabloların okunmasında kullanılır (kasa raporu, gün özeti, ModPOS föyü, ay, satış satırı):
 * aynı güne iki şube yazabildiği için süzmeden okuyan sorgu yanlış şubenin satırını döndürebilir.
 */
export async function currentBranchWhere(col: PgColumn): Promise<SQL | undefined> {
  return branchWhere(col, await currentBranchScope());
}

/**
 * Sorguya eklenecek şube koşulu. "Tümü" seçiliyken KOŞUL YOKTUR (`undefined`): pasife alınmış bir şubenin
 * geçmiş cirosu da toplama girsin diye kimlik listesiyle süzmüyoruz — pasif şube kapanmıştır, parası
 * işletmenin parasıdır.
 */
export function branchWhere(col: PgColumn, scope: BranchScope): SQL | undefined {
  return scope === ALL_BRANCHES ? undefined : eq(col, scope);
}

/**
 * Gider için şube koşulu: giderin şubesi boş olabilir ("işletme geneli", sahibin kararı 4 Kasım 2026). Tek şube
 * seçiliyken o şubenin giderleri İLE işletme geneli giderler birlikte görünür; yoksa kira, muhasebe ve abonelik
 * hiçbir şubede görünmez ve kâr olduğundan yüksek çıkar.
 */
export function branchWhereWithShared(col: PgColumn, scope: BranchScope): SQL | undefined {
  return scope === ALL_BRANCHES ? undefined : or(eq(col, scope), isNull(col));
}

/** Birden çok koşulu birleştirir; boş olanları atar (hepsi boşsa `undefined`) */
export function andWhere(...parts: (SQL | undefined)[]): SQL | undefined {
  const kept = parts.filter((p): p is SQL => Boolean(p));
  if (!kept.length) return undefined;
  return kept.length === 1 ? kept[0] : and(...kept);
}

/** Yazmadan önce: gövdeden gelen şube kimliği kütükte ve etkin mi */
export function knownBranchId(raw: unknown, branches: readonly BranchRow[]): string | null {
  if (typeof raw !== "string" || !raw) return null;
  return branches.some((b) => b.id === raw && b.active) ? raw : null;
}
