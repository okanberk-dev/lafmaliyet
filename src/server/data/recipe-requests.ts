import "server-only";

import { and, count, desc, eq, exists, gt, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";

import { ALL_BRANCHES, type BranchScope } from "@/lib/branches";
import { proposalGroupKey, type ProductSize, type ProposedProduct, type RequestKind, type RequestStatus } from "@/lib/recipe-change";
import { getDb, schema as s, type DB } from "@/server/db";

/**
 * Reçete önerisinin şubesi önerenin hesabının şubesidir (şube ayrımı, 27 Kasım 2026; docs/SUBE.md › Şube ayrımı ›
 * Ayarsız sızıntılar): tek şube seçiliyken yalnız o şubenin personelinin önerileri ve şubesi bilinmeyenler (şubesiz
 * hesap, silinmiş hesap; `requestInScope` gibi: onay bekleyen iş gizlenmesin). Önerinin kendi şube sütunu yok; hesabın
 * şubesi sonradan değişirse öneri yeni şubesinde görünür. "Tümü"de koşul yok. Önceden Marina
 * seçiliyken Onaylar, Bugün, zil ve Reçete defteri Tuzla personelinin önerilerini de gösteriyordu
 */
export function proposerScopeWhere(scope: BranchScope): SQL | undefined {
  if (scope === ALL_BRANCHES) return undefined;
  const u = s.users;
  const r = s.recipeChangeRequests;
  // Hesap silinince öneren boşalır (on delete set null): şubesi bilinmez, her kapsamda görünür
  return or(
    isNull(r.requestedBy),
    exists(
      getDb()
        .select({ one: sql`1` })
        .from(u)
        .where(and(eq(u.id, r.requestedBy), or(isNull(u.branchId), eq(u.branchId, scope)))),
    ),
  );
}

export interface RecipeRequestRow {
  id: number;
  kind: RequestKind;
  /** Değişiklik önerisinde ürün; yeni ürün önerisinde onaylanana kadar null (onayda açılan ürün) */
  productId: number | null;
  /** Ürün varsa bugünkü adı ve boyu, yoksa önerilen */
  productName: string;
  size: ProductSize;
  /** Yalnız yeni ürün önerisinde: önerilen ad, boy ve kategori */
  proposed: ProposedProduct | null;
  /** Yeni ürün önerisinde personelin yazdığı satış fiyatı (yazılmadıysa ya da eski öneride null) */
  proposedPrice: number | null;
  status: RequestStatus;
  requestedBy: number | null;
  requestedByName: string;
  before: typeof s.recipeChangeRequests.$inferSelect.before;
  after: typeof s.recipeChangeRequests.$inferSelect.after;
  message: string | null;
  /** Personel öneriyi her güncellediğinde artar; yönetici gördüğü sürümü onaylar (seenVersion) */
  version: number;
  reviewNote: string | null;
  reviewedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  reviewedAt: Date | null;
}

const columns = {
  id: s.recipeChangeRequests.id,
  kind: s.recipeChangeRequests.kind,
  productId: s.recipeChangeRequests.productId,
  currentName: s.products.name,
  currentSize: s.products.size,
  proposed: s.recipeChangeRequests.proposed,
  status: s.recipeChangeRequests.status,
  requestedBy: s.recipeChangeRequests.requestedBy,
  requestedByName: s.recipeChangeRequests.requestedByName,
  before: s.recipeChangeRequests.before,
  after: s.recipeChangeRequests.after,
  message: s.recipeChangeRequests.message,
  version: s.recipeChangeRequests.version,
  reviewNote: s.recipeChangeRequests.reviewNote,
  reviewedByName: s.recipeChangeRequests.reviewedByName,
  createdAt: s.recipeChangeRequests.createdAt,
  updatedAt: s.recipeChangeRequests.updatedAt,
  reviewedAt: s.recipeChangeRequests.reviewedAt,
};

/**
 * Yeni ürün önerisinin ürünü onaylanana kadar yok (productId boş): ürün tablosu sol birleşimle okunur, ad ve boy
 * ürün yoksa önerilenden gelir.
 */
function toRow({
  currentName,
  currentSize,
  ...r
}: Omit<RecipeRequestRow, "productName" | "size" | "proposedPrice"> & { currentName: string | null; currentSize: ProductSize | null }): RecipeRequestRow {
  const proposedPrice = r.proposed?.price;
  return {
    ...r,
    productName: currentName ?? r.proposed?.name ?? "?",
    size: currentSize ?? r.proposed?.size ?? "M",
    proposedPrice: typeof proposedPrice === "number" && proposedPrice > 0 ? proposedPrice : null,
  };
}

const select = () => getDb().select(columns).from(s.recipeChangeRequests).leftJoin(s.products, eq(s.products.id, s.recipeChangeRequests.productId));

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

/** Onay bekleyen öneri sayısı, iki tür birlikte; `scope` verilirse önerenin şubesine göre (`proposerScopeWhere`) */
export async function countPendingRequests(scope: BranchScope = ALL_BRANCHES): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(s.recipeChangeRequests)
    .where(and(eq(s.recipeChangeRequests.status, "pending"), proposerScopeWhere(scope)));
  return row?.n ?? 0;
}

/** Onay bekleyenler türüne göre: reçete değişikliği ve yeni ürün önerisi (reçete defterindeki şerit); önerenin şubesine göre */
export async function countPendingByKind(scope: BranchScope = ALL_BRANCHES): Promise<Record<RequestKind, number>> {
  const rows = await getDb()
    .select({ kind: s.recipeChangeRequests.kind, n: count() })
    .from(s.recipeChangeRequests)
    .where(and(eq(s.recipeChangeRequests.status, "pending"), proposerScopeWhere(scope)))
    .groupBy(s.recipeChangeRequests.kind);
  return { change: rows.find((r) => r.kind === "change")?.n ?? 0, new: rows.find((r) => r.kind === "new")?.n ?? 0 };
}

/**
 * Yönetici: bekleyenler (eskiden yeniye) ve son `days` günde karara bağlananlar (yeniden eskiye); `scope` verilirse
 * önerenin şubesine göre (`proposerScopeWhere`)
 */
export async function loadReviewQueue(days = 30, scope: BranchScope = ALL_BRANCHES): Promise<{ pending: RecipeRequestRow[]; recent: RecipeRequestRow[] }> {
  const inScope = proposerScopeWhere(scope);
  const [pending, recent] = await Promise.all([
    select()
      .where(and(eq(s.recipeChangeRequests.status, "pending"), inScope))
      .orderBy(s.recipeChangeRequests.createdAt, s.recipeChangeRequests.id),
    select()
      .where(and(inArray(s.recipeChangeRequests.status, ["approved", "rejected", "withdrawn"]), gt(s.recipeChangeRequests.updatedAt, daysAgo(days)), inScope))
      .orderBy(desc(s.recipeChangeRequests.updatedAt), s.recipeChangeRequests.id)
      .limit(40),
  ]);
  return { pending: pending.map(toRow), recent: recent.map(toRow) };
}

/** Kişinin önerileri: bekleyenler ve son `days` günde sonuçlananlar (yeniden eskiye) */
export async function loadMyRequests(userId: number, days = 14): Promise<RecipeRequestRow[]> {
  const rows = await select()
    .where(
      and(
        eq(s.recipeChangeRequests.requestedBy, userId),
        or(eq(s.recipeChangeRequests.status, "pending"), gt(s.recipeChangeRequests.updatedAt, daysAgo(days))),
      ),
    )
    // Aynı işlemde açılan boylar (yeni ürün önerisi) kendi sırasıyla: M, L
    .orderBy(desc(s.recipeChangeRequests.updatedAt), s.recipeChangeRequests.id)
    .limit(50);
  return rows.map(toRow);
}

/** Ürün başına bekleyen değişiklik önerisi sayısı (yöneticinin reçete defterindeki rozet); önerenin şubesine göre */
export async function pendingByProduct(scope: BranchScope = ALL_BRANCHES): Promise<Map<number, number>> {
  const rows = await getDb()
    .select({ productId: s.recipeChangeRequests.productId, n: count() })
    .from(s.recipeChangeRequests)
    .where(
      and(eq(s.recipeChangeRequests.status, "pending"), eq(s.recipeChangeRequests.kind, "change"), isNotNull(s.recipeChangeRequests.productId), proposerScopeWhere(scope)),
    )
    .groupBy(s.recipeChangeRequests.productId);
  return new Map(rows.flatMap((r) => (r.productId === null ? [] : [[r.productId, r.n] as const])));
}

/**
 * Bekleyen yeni ürün önerilerinin ad ve boyu (öneri penceresi aynı ad + boyu göndermeden uyarır): önerenin şubesine göre
 * (`pendingNewProposalRows`). Reçete defteri personelin ve müdürün kilitli şubesiyle çağırır
 */
export async function pendingNewProposals(scope: BranchScope = ALL_BRANCHES): Promise<{ name: string; size: ProductSize }[]> {
  return (await pendingNewProposalRows(getDb(), scope)).map(({ name, size }) => ({ name, size }));
}

/**
 * Bekleyen yeni ürün önerilerinin ad, boy ve önereni; işlem içinde (kilit altında) da okunur.
 *
 * Şube ayrımı (doğrulama, 27 Kasım 2026): önerinin şubesi önerenin hesabının şubesidir (`proposerScopeWhere`'in kuralı).
 * - `others: "gizle"` (ekranın listesi; varsayılan): tek şube seçiliyken yalnız o şubenin personelinin ve şubesi
 *   bilinmeyenlerin önerileri. Önceden Site menüsü ve Reçete defteri (müdürün kilidini de aşarak) Tuzla personelinin
 *   önerisini adıyla gösteriyordu.
 * - `others: "adsiz"` (aynı ad + boy denetimi, eylemin kilidi altında): menü ortak olduğu için bütün şubelerin önerisine
 *   bakılır; öbür şubenin önerisinde önereni yazılmaz (`by: null`, ileti "öbür şubede bekleyen").
 * "Tümü"de ikisi de bütün öneriler, önerenin adıyla.
 */
export async function pendingNewProposalRows(
  db: Pick<DB, "select"> = getDb(),
  scope: BranchScope = ALL_BRANCHES,
  others: "gizle" | "adsiz" = "gizle",
): Promise<{ name: string; size: ProductSize; by: string | null }[]> {
  const rows = await db
    .select({ proposed: s.recipeChangeRequests.proposed, by: s.recipeChangeRequests.requestedByName, requestedBy: s.recipeChangeRequests.requestedBy, branchId: s.users.branchId })
    .from(s.recipeChangeRequests)
    .leftJoin(s.users, eq(s.users.id, s.recipeChangeRequests.requestedBy))
    .where(and(eq(s.recipeChangeRequests.status, "pending"), eq(s.recipeChangeRequests.kind, "new")));
  // proposerScopeWhere'in kuralı: öneren silinmiş (boş) ya da şubesiz hesap her şubede; öbür şubenin hesabı yalnız orada
  const mine = (r: (typeof rows)[number]) => scope === ALL_BRANCHES || r.requestedBy === null || !r.branchId || r.branchId === scope;
  return rows.flatMap((r): { name: string; size: ProductSize; by: string | null }[] => {
    if (!r.proposed) return [];
    if (mine(r)) return [{ name: r.proposed.name, size: r.proposed.size, by: r.by }];
    return others === "adsiz" ? [{ name: r.proposed.name, size: r.proposed.size, by: null }] : [];
  });
}

/**
 * Yeni ürün önerisinin kilidi: iki kişi aynı ad + boyu aynı anda öneremesin, onaylanırken araya öneri ya da aynı adlı
 * ürün girmesin (boş productId benzersiz dizine girmez). Öneri, onay, Ürünler › Yeni ürün ve Site menüsü › "Panelde aç
 * ve bağla" alır; menü kilidi (lockMenu) gerekiyorsa önce o alınır, öneri ve onay menü kilidini hiç almaz.
 */
export const lockNewProducts = (tx: { execute: (query: SQL) => Promise<unknown> }) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('yeni-urun-onerisi'))`);


/** Yeni ürün önerisinin daha önce eklenmiş öteki boyu: ürünün bugünkü adı, boyu ve kategorisi */
export interface NewProposalPair {
  productId: number;
  name: string;
  size: ProductSize;
  categoryId: number;
}

/**
 * Yeni ürün önerilerinin daha önce onaylanıp eklenmiş kardeş boyu (aynı kişi, aynı önerilen ad, başka boy; ürünü
 * duruyor; denetim E-55): onaylanan boy onun adını alır (pairedName). Birden çoksa en son onaylanan. Onay eylemi
 * kendi işleminde (yeni ürün kilidiyle) çağırır, Onaylar sayfası kartı çizerken.
 */
export async function approvedNewPairs(
  db: Pick<DB, "select">,
  reqs: readonly { id: number; requestedBy: number | null; requestedByName: string; name: string; size: ProductSize }[],
): Promise<Map<number, NewProposalPair>> {
  const out = new Map<number, NewProposalPair>();
  if (!reqs.length) return out;
  const users = [...new Set(reqs.flatMap((r) => (r.requestedBy !== null ? [r.requestedBy] : [])))];
  const names = [...new Set(reqs.flatMap((r) => (r.requestedBy === null ? [r.requestedByName] : [])))];
  const rows = await db
    .select({
      id: s.recipeChangeRequests.id,
      requestedBy: s.recipeChangeRequests.requestedBy,
      requestedByName: s.recipeChangeRequests.requestedByName,
      proposed: s.recipeChangeRequests.proposed,
      productId: s.products.id,
      name: s.products.name,
      size: s.products.size,
      categoryId: s.products.categoryId,
    })
    .from(s.recipeChangeRequests)
    .innerJoin(s.products, eq(s.products.id, s.recipeChangeRequests.productId))
    .where(
      and(
        eq(s.recipeChangeRequests.kind, "new"),
        eq(s.recipeChangeRequests.status, "approved"),
        or(
          users.length ? inArray(s.recipeChangeRequests.requestedBy, users) : undefined,
          names.length ? and(isNull(s.recipeChangeRequests.requestedBy), inArray(s.recipeChangeRequests.requestedByName, names)) : undefined,
        ),
      ),
    )
    .orderBy(desc(s.recipeChangeRequests.reviewedAt), desc(s.recipeChangeRequests.id));
  for (const req of reqs) {
    const key = proposalGroupKey(req);
    const pair = rows.find((r) => r.id !== req.id && r.proposed && r.size !== req.size && proposalGroupKey({ ...r, name: r.proposed.name }) === key);
    if (pair) out.set(req.id, { productId: pair.productId, name: pair.name, size: pair.size, categoryId: pair.categoryId });
  }
  return out;
}
