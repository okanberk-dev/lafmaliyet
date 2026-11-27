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
  type FormBranchKind,
  otherBranchError,
  parseBranchScope,
  pickFormBranch,
  shownScopeError,
  tillBranches,
} from "@/lib/branches";

import { type BranchViewPrefs, effectiveView, parseBranchView, type ViewArea, type ViewMode, viewScope } from "@/lib/branch-view";
import { BRANCH_ROLES } from "@/lib/roles";

import { getCurrentUser } from "./auth/dal";
import { listBranches } from "./branches";
import { getDb, schema as s, type DB } from "./db";
import { UserError } from "./user-error";

/**
 * Panelin o anki şube seçimi (docs/SUBE.md › Seçici). Kurallar saf dosyada (src/lib/branches.ts); burada yalnız
 * Next'in isteği ve veritabanı var.
 *
 * Seçim veriyi süzer, YETKİ VERMEZ: her uç ayrıca `requireAdmin`/`requireUser` ile korunur. `branchScope(raw)`'a
 * verilen değer çerezden önce gelir; tanınmayan ya da pasif değer "hepsi"ye düşer (`parseBranchScope`). Panelin
 * sayfaları adresteki `?sube=`'yi okumaz: seçici onu her bağlantıda bir kez çereze benimsetir ve adresten düşürür
 * (src/components/panel/branch-picker.tsx › `branchLinkStep`).
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
  if (!user || !(BRANCH_ROLES as readonly string[]).includes(user.role) || !user.branchId) return null;
  // Müdürün şubesi hep etkindir (değilse oturumu açılmaz: src/server/auth/dal.ts › managerWithoutBranch)
  return branches.some((b) => b.id === user.branchId && b.active) ? user.branchId : null;
}

/**
 * Müdürün kilidi (docs/ROLLER.md): müdür öteki şubeyi HİÇBİR yoldan okuyamaz. Personelin kilidi seçimi ve yazımı
 * belirler; müdürde ayrıca `withBranchScope("hepsi" ya da başka şube, …)` ile açılan okumalar da (işletme geneli
 * kartlar, şubeleri yan yana koyan yükleyiciler) şubesine daraltılır (`currentBranchScope`). İstek dışında null.
 */
const managerLock = cache(async (): Promise<string | null> => {
  const user = await requestUser();
  return user?.role === "manager" && user.branchId ? user.branchId : null;
});

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
export async function staffBranchRefusal(_me: { role: string }, branchId: string | null | undefined): Promise<string | null> {
  // Kilit eyleme gelen role değil OTURUMA bakar: müdür çekirdeğe "admin" düzeyinde girer (src/lib/roles.ts › opsLevel),
  // şubesi yine kilitlidir. Yöneticinin ve şubesiz personelin kilidi yok (null)
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
  const override = scopeOverride.getStore();
  if (override !== undefined) {
    // Müdür: işletme geneli ya da başka şubenin okuması kendi şubesine daralır (öteki şube hiç okunmaz)
    const lock = await managerLock();
    return lock ?? override;
  }
  return requestBranchScope();
}

/**
 * Seçiciden bağımsız okuma: `fn` içindeki bütün okumalar (kasa raporu, ay, satış, ModPOS föyü, AsilPOS) verilen kapsamı
 * görür. İşletme geneli ekranlar (vergi, ödemeler ve nakit planı, tutarlılık) "Tümü" ile, şube başına ekranlar (stok
 * sayımı) yazdıkları şubeyle okur; okuma işlevlerinin imzası değişmez.
 */
export function withBranchScope<T>(scope: BranchScope, fn: () => Promise<T>): Promise<T> {
  return scopeOverride.run(scope, fn);
}

// ---------------------------------------------------------------- Şube görünümü (şube ayrımı D, 27 Kasım 2026)

/**
 * İsteğin kullanıcısının şube görünümü tercihi (`users.branch_view`; docs/SUBE.md › Şube ayrımı): istek başına tek küçük
 * okuma. Oturum (`readSessionUser`, `CurrentUser`) değişmedi; tercih yalnız onu soran ekranda okunur. İstek dışında,
 * oturumsuz ya da okunamazsa boş (rolün varsayılanı geçer)
 */
export const userBranchView = cache(async (): Promise<BranchViewPrefs> => {
  const user = await requestUser();
  if (!user) return {};
  try {
    const [row] = await getDb().select({ v: s.users.branchView }).from(s.users).where(eq(s.users.id, user.id)).limit(1);
    return parseBranchView(row?.v);
  } catch (e) {
    console.error("[şube görünümü] tercih okunamadı; varsayılan", e);
    return {};
  }
});

/** `withBranchView` ile verilen tercih (testler, bağlantı anahtarının sahibi); yoksa isteğin kullanıcısınınki */
const viewOverride = new AsyncLocalStorage<BranchViewPrefs>();

/**
 * Hesap şubesine kilitli mi (müdür; şubesi seçilmiş ve etkin personel): kilitli hesapta her alan "sube", tercih okunmaz.
 * İstek başına bir kez
 */
const requestViewLock = cache(async (): Promise<boolean> => {
  if (await managerLock()) return true;
  return (await lockedBranch(await listBranches())) !== null;
});

/**
 * Alanın geçerli kipi ("sube" ya da "firma"; src/lib/branch-view.ts › effectiveView): kilitli hesapta hep "sube";
 * öteki hesapta `withBranchView`'ın tercihi, yoksa kişinin tercihi, yoksa rolün varsayılanı. Oturum yoksa (bağlantı
 * anahtarı, arka plan işi, test) yöneticinin varsayılanı
 */
export async function currentBranchView(area: ViewArea): Promise<ViewMode> {
  const [user, locked] = await Promise.all([requestUser(), requestViewLock()]);
  const prefs = viewOverride.getStore() ?? (await userBranchView());
  return effectiveView(area, user?.role ?? "admin", locked, prefs);
}

/**
 * Alanın okuma kapsamı: firma kipinde "Tümü", şube kipinde seçim (`currentBranchScope`). Alanın yükleyicisi bugünkü
 * `withBranchScope(ALL_BRANCHES, …)` yerine `withBranchScope(await areaScope("vergi"), …)` ile okur; çağrının üstünde
 * kaydın işareti durur (`// şube-ayrımı: …`, tests/sube-ayrimi.test.ts). Müdürün kilidi okumanın kendisinde kalır:
 * "Tümü" dönse de `currentBranchScope` onu şubesine daraltır
 */
export async function areaScope(area: ViewArea): Promise<BranchScope> {
  const scope = await currentBranchScope();
  if (scope === ALL_BRANCHES) return scope;
  return viewScope(scope, await currentBranchView(area));
}

/**
 * Tercihi istekten bağımsız verir: `fn` içindeki `currentBranchView` / `areaScope` bu tercihi okur (testler; bağlantı
 * anahtarının sahibinin tercihi). Kilit yine geçerli: müdürde her alan "sube"
 */
export function withBranchView<T>(prefs: BranchViewPrefs, fn: () => Promise<T>): Promise<T> {
  return viewOverride.run(prefs, fn);
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
 * Formun gösterdiği şube (docs/SUBE.md › Yazarken hangi şube): kasa, sayım, zayi, satış ve ay bilgisi, gider. Sayfa formu
 * çizerken şubenin kimliğini forma koyar; yazım gönderim anındaki çereze değil bu kimliğe iner: çerez sekmeler arasında
 * ortaktır, başka sekmede seçici değişince eski sekmenin Tuzla formu Marina'ya yazıyordu (21 Kasım denetimi #12; 24 Kasım
 * şube kapsamı taraması). Kural saf dosyada (`pickFormBranch`, src/lib/branches.ts):
 * - kimlik türüne uymalı (kasa, sayım, zayi ve satışta etkin fiziksel şube; giderde etkin şube ya da "isletme"), şubesine
 *   kilitli personelde kendi şubesi; değilse UserError;
 * - kimliği göndermeyen eski sekme bugünkü gibi seçime göre yazar; online kanal seçiliyken satış reddedilir;
 * - `requireExplicit`: "Tümü"de birden çok kasa açıkken kimlik gelmediyse UserError ("Şubeyi seçin"), Tuzla'ya düşülmez.
 * Eylem yazımı `withBranchScope(şube, …)` içinde çalıştırır: kapı, kilit ve okumalar da aynı şubeye bakar. Giderde null
 * işletme genelidir.
 */
export async function formBranch(raw: string | null | undefined, kind: "expense", opts?: { requireExplicit?: boolean }): Promise<string | null>;
export async function formBranch(raw: string | null | undefined, kind: Exclude<FormBranchKind, "expense">, opts?: { requireExplicit?: boolean }): Promise<string>;
export async function formBranch(raw: string | null | undefined, kind: FormBranchKind, opts?: { requireExplicit?: boolean }): Promise<string | null> {
  const [scope, known, lock] = await Promise.all([currentBranchScope(), listBranches(), staffBranchLock()]);
  const picked = pickFormBranch({ raw, kind, scope, known, lock, requireExplicit: opts?.requireExplicit });
  if ("error" in picked) throw new UserError(picked.error);
  // Şube göndermeyen yazım (eski sekme) "Tümü"de birden çok kasa açıkken varsayılan şubeye iner: bugün izin verilir
  // (kasa, sayım, kasadan çıkan; sayfalar artık şubeyi sorar), ama izi kalsın. Eski sekmeler bitince requireExplicit
  // açılabilir (docs/SUBE.md › Yazarken hangi şube)
  if (!raw && kind !== "expense" && !known.some((b) => b.id === scope && b.kind === "fiziksel") && tillBranches(known).length > 1) {
    console.warn("[şube] yazım şube göndermedi; varsayılan şubeye yazıldı (eski sekme?)", { kind, scope: scope.replace(/[\r\n]/g, " ").slice(0, 40), to: picked.id });
  }
  return picked.id;
}

/**
 * Formun gösterdiği kasa (kasa raporu, geç rapor, düzeltme ve silme isteği, kasadan çıkan; docs/SUBE.md › Yazarken
 * hangi şube): `formBranch(raw, "till")`. Sayfa formu `currentTillBranch` ile çizer ve kasanın kimliğini forma koyar.
 * Kimliği göndermeyen eski sekme bugünkü gibi seçili kasaya yazar.
 */
export async function formTillBranch(raw: string | null | undefined): Promise<string> {
  return formBranch(raw, "till");
}

/**
 * Formun gösterdiği sayımın şubesi (stok sayımı, "Listede olmayanlar", "Listeye ekle"): `formBranch(raw, "count")`.
 * Sayfa formu `currentPhysicalBranch` ile çizer ve şubenin kimliğini forma koyar. Öbür şubenin kalemi eşlenmez, ezilmez.
 */
export async function formCountBranch(raw: string | null | undefined): Promise<string> {
  return formBranch(raw, "count");
}

/**
 * Formun gösterdiği kapsam ile eylem anındaki seçim tutmalı (kapsamla silen yazımlar; `shownScopeError`). Tutmazsa
 * UserError "Şube seçimi başka sekmede değişti; sayfayı yenileyin"
 */
export async function assertShownScope(shown: unknown): Promise<BranchScope> {
  const current = await currentBranchScope();
  const error = shownScopeError(shown, current);
  if (error) throw new UserError(error);
  return current;
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
