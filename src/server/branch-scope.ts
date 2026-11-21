import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
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
  DEFAULT_BRANCHES,
  formTillError,
  otherBranchError,
  parseBranchScope,
} from "@/lib/branches";

import { getCurrentUser } from "./auth/dal";
import { listBranches } from "./branches";
import { getDb, type DB } from "./db";
import { UserError } from "./user-error";

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
  /** Şubesi olan personel: seçim kişinin şubesinde kilitli, seçici değiştiremez */
  locked: boolean;
}

/** İstekteki kullanıcı (istekte bir kez okunur; istek dışında null) */
const requestUser = cache(async () => {
  try {
    return await getCurrentUser();
  } catch {
    return null;
  }
});

/**
 * Personel hesabının şubesi (docs/SUBE.md › Personel hesabının şubesi): şubesi seçilmiş personelin bütün okuma ve
 * yazmaları o şubededir; çerez ve `?sube=` yok sayılır. Şube pasife alındıysa ya da kişide şube yoksa null (serbest).
 */
async function lockedBranch(branches: readonly BranchRow[]): Promise<string | null> {
  const user = await requestUser();
  if (!user || user.role !== "staff" || !user.branchId) return null;
  return branches.some((b) => b.id === user.branchId && b.active) ? user.branchId : null;
}

/** Şubesi seçilmiş personelin kilitli şubesi (seçim ucu bununla başka şubeye geçişi reddeder); yoksa null */
export async function staffBranchLock(): Promise<string | null> {
  return lockedBranch(await listBranches());
}

/**
 * Kimliğiyle açılan kayıt şubesine kilitli personelin şubesinde mi (docs/SUBE.md › Personel hesabının şubesi; 21 Kasım
 * denetimi #14). Kilit yalnız seçimi ve yeni kaydın şubesini belirliyordu; kasadan çıkan satırı, zayi kaydı, kasa
 * raporu ve fotoğraf kimliğiyle açılınca kimse satırın şubesini kişinin şubesiyle karşılaştırmıyordu. Kaydı kimliğiyle
 * açan her personel yolu buna sorar: başka şubenin kaydında metin (eylem UserError atar, fotoğraf kuralı görmez der),
 * yoksa null. Yönetici, şubesiz personel ve şubesi pasif personel serbest (`otherBranchError`).
 */
export async function staffBranchRefusal(me: { role: string }, branchId: string | null | undefined): Promise<string | null> {
  if (me.role === "admin") return null;
  const branches = await listBranches();
  return otherBranchError(branchId, branches, await lockedBranch(branches));
}

export async function branchScope(raw?: unknown, db: DB = getDb()): Promise<BranchScopeState> {
  const branches = await listBranches(db);
  const locked = await lockedBranch(branches);
  const fromUrl = typeof raw === "string" && raw ? raw : null;
  const chosen = locked ?? fromUrl ?? (await cookies()).get(BRANCH_COOKIE)?.value ?? null;
  const scope = parseBranchScope(chosen, branches);
  return {
    scope,
    branches,
    label: branchScopeLabel(scope, branches),
    writeId: scope === ALL_BRANCHES ? DEFAULT_BRANCH_ID : scope,
    locked: locked !== null,
  };
}

/**
 * İsteğin şube seçimi, imza değiştirmeden. Okuma işlevlerinin hepsine parametre eklemek yerine seçim tıpkı oturum
 * gibi (`requireUser`) buradan okunur; `cache` sayesinde bir istekte çerez bir kez okunur.
 *
 * İSTEK DIŞINDA (göç betiği, arka plan işi, test, `npm run build` sırasındaki ön üretim) `cookies()` fırlatır:
 * o zaman "hepsi"ye düşeriz, yani süzme yok — betik bütün şubeleri görür, ki doğrusu budur.
 */
const requestBranchScope = cache(async (): Promise<BranchScope> => {
  try {
    const jar = await cookies();
    const branches = await listBranches();
    const locked = await lockedBranch(branches);
    return parseBranchScope(locked ?? jar.get(BRANCH_COOKIE)?.value ?? null, branches);
  } catch {
    return ALL_BRANCHES;
  }
});

/** `withBranchScope` ile verilen kapsam (yoksa isteğin seçimi) */
const scopeOverride = new AsyncLocalStorage<BranchScope>();

export async function currentBranchScope(): Promise<BranchScope> {
  return scopeOverride.getStore() ?? requestBranchScope();
}

/**
 * Seçiciden bağımsız okuma: `fn` içindeki bütün okumalar (kasa raporu, ay, satış, ModPOS föyü, LafPOS) verilen kapsamı
 * görür. İşletme geneli ekranlar (vergi, ödemeler ve nakit planı, tutarlılık) "Tümü" ile, şube başına ekranlar (stok
 * sayımı) yazdıkları şubeyle okur; okuma işlevlerinin imzası değişmez.
 */
export function withBranchScope<T>(scope: BranchScope, fn: () => Promise<T>): Promise<T> {
  return scopeOverride.run(scope, fn);
}

/**
 * Yeni kaydın ineceği tek şube. "Tümü" seçiliyken hedef belirsizdir ve varsayılan şubeye (Tuzla) iner; ekranlar
 * hangi şubeye yazdıklarını kullanıcıya gösterir. İstek dışında da varsayılan şube döner.
 */
export async function currentWriteBranch(): Promise<string> {
  const scope = await currentBranchScope();
  return scope === ALL_BRANCHES ? DEFAULT_BRANCH_ID : scope;
}

/**
 * Yeni giderin şubesi: seçili şube; "Tümü" seçiliyken işletme geneli (null; gider şubesi boş kalabilir, sahibin kararı
 * 4 Kasım 2026). Gider her şubenin görünümünde işletme geneli olarak sayılır (branchWhereWithShared).
 */
export async function currentExpenseBranch(): Promise<string | null> {
  const scope = await currentBranchScope();
  return scope === ALL_BRANCHES ? null : scope;
}

/**
 * Şube başına tutulan fiziksel işin (stok sayımı, zayi) şubesi: seçili fiziksel şube; "Tümü" ya da online kanal
 * seçiliyken varsayılan şube (Tuzla). Kanalın stoğu ve zayisi olmaz; ekranlar hangi şubeye yazdıklarını gösterir.
 */
export async function currentPhysicalBranch(): Promise<BranchRow> {
  const [scope, branches] = await Promise.all([currentBranchScope(), listBranches()]);
  const chosen = branches.find((b) => b.id === scope && b.kind === "fiziksel");
  const fallback = DEFAULT_BRANCHES.find((b) => b.id === DEFAULT_BRANCH_ID)!;
  return chosen ?? branches.find((b) => b.id === DEFAULT_BRANCH_ID) ?? { ...fallback, active: true };
}

/**
 * Kasanın şubesi (kasa raporu, kasadan çıkan, geç rapor, ModPOS föyü): seçili fiziksel şube; "Tümü" ya da online kanal
 * seçiliyken varsayılan şube (Tuzla). Online kanalın kasası olmaz (docs/SUBE.md › Kurallar): kanal seçiliyken girilen
 * rapor "online" şubesine yazılmasın. Kasa sayfası okurken de bunu kullanır; form bu kasanın kimliğini gönderir ki
 * gösterdiği kasaya yazsın (`formTillBranch`).
 */
export async function currentTillBranch(): Promise<string> {
  return (await currentPhysicalBranch()).id;
}

/**
 * Formun gösterdiği kasa (kasa raporu, geç rapor, düzeltme ve silme isteği, kasadan çıkan; docs/SUBE.md › Yazarken
 * hangi şube). Sayfa formu `currentTillBranch` ile çizer ve kasanın kimliğini forma koyar; yazım gönderim anındaki
 * çereze değil bu kimliğe iner: çerez sekmeler arasında ortaktır, başka sekmede seçici değişince eski sekmenin Tuzla
 * formu Marina'ya yazıyordu (21 Kasım denetimi #12). Kimlik etkin bir fiziksel şube olmalı, şubesine kilitli personelde
 * kendi şubesi (`formTillError`); değilse UserError. Kimliği göndermeyen eski sekme bugünkü gibi seçili kasaya yazar.
 * Eylem yazımı `withBranchScope(kasa, …)` içinde çalıştırır: kapı, kilit ve okumalar da aynı kasaya bakar.
 */
export async function formTillBranch(raw: string | null | undefined): Promise<string> {
  if (!raw) return currentTillBranch();
  const [branches, lock] = await Promise.all([listBranches(), staffBranchLock()]);
  const error = formTillError(raw, branches, lock);
  if (error) throw new UserError(error);
  return raw;
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
