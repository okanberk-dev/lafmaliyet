import "server-only";

import { desc, eq, inArray } from "drizzle-orm";

import { supplierMatchKey } from "@/app/panel/faturalar/rules";
import { parseIgnored } from "@/lib/product-ignore";

import {
  aiCandidates,
  freshItems,
  ingredientsHash,
  inventedCount,
  MATCH_BATCH_SIZE,
  MatchAiRaw,
  matchSystemPrompt,
  matchTask,
  mergeMatchStore,
  parseMatchStore,
  pickExamples,
  shortKeys,
  validateAnswer,
  type AiMatchState,
  type MatchContext,
  type MatchExample,
  type MatchIngredientInfo,
  type MatchProduct,
  type StoredAiMatch,
} from "@/lib/product-match-ai";
import { extractMatch, matchSuggestStatus } from "@/server/ai/claude";
import { MATCH_TIMEOUTS } from "@/server/ai/run";
import { getDb, schema as s, type DB } from "@/server/db";
import { UserError } from "@/server/user-error";

import { PRODUCT_IGNORE_KEY } from "./keys";

import { unlinkedProducts } from "./sync";

/*
 * Paraşüt'te bekleyen ürünler için AI önerisi (Claude Sonnet 5.5; kurallar ve istem src/lib/product-match-ai.ts, kapılar
 * ve maliyet günlüğü src/server/ai/claude.ts; docs/PARASUT.md § 5e). Yalnız düğmeyle çalışır (sayfa açılınca istek
 * gitmez) ve **bağlantı kurmaz**: doğrulanmış öneriler integration_state'te saklanır, ekran onları gösterir, yönetici
 * "Uygula" / "Bağla" ya da toplu pencerede onaylar.
 *
 * Servise gidenler: etkin hammaddelerin kimliği, adı, birimi, kategorisi, paket açıklaması ve birim maliyeti; en çok 60
 * örnek bağlantı (ürün adı, faturadaki birim, hammadde, çarpan); partideki ürünlerin adı, açıklaması, birimi, son birim
 * fiyatı, son miktarı ve tedarikçinin adı. Kişi adı, vergi no, fatura no, tutar dökümü gitmez.
 */

/** Saklanan öneriler: { hash, items: { ürün anahtarı → öneri } } (yedeğe girer; docs/PARASUT.md § 5e) */
export const AI_SUGGESTIONS_KEY = "parasut.aiSuggestions";
/**
 * Eylemin başından AI yanıtının en geç gelmesi gereken süre: sayfa 60 sn'de kesilir, kalan ~12 sn doğrulama, saklama,
 * etkinlik günlüğü ve yanıta. Öncesindeki okumalar uzarsa servis çağrısının süresi o kadar kısalır (en çok
 * MATCH_TIMEOUTS.totalMs); kesilen çağrı "timeout" olur, ai_calls satırı kapanır ("running" kalmaz)
 */
export const MATCH_BUDGET_MS = 48_000;
/** Servis çağrısına en az bu kadar süre kalmalı; kalmadıysa yine bu kadar beklenir (hemen "timeout" yerine) */
const MIN_CALL_MS = 5_000;

type Ingredient = MatchIngredientInfo & { active: boolean };

/** Hammaddeler, bugünkü birim maliyetiyle (paket fiyatı ÷ paket boyu) */
async function matchIngredients(db: DB): Promise<Ingredient[]> {
  const rows = await db
    .select({
      id: s.ingredients.id,
      name: s.ingredients.name,
      unit: s.ingredients.unit,
      category: s.ingredients.category,
      packageDesc: s.ingredients.packageDesc,
      packagePrice: s.ingredients.packagePrice,
      packageSize: s.ingredients.packageSize,
      active: s.ingredients.active,
    })
    .from(s.ingredients);
  return rows.map(({ packagePrice, packageSize, ...i }) => ({ ...i, unitCost: packageSize ? packagePrice / packageSize : 0 }));
}

/** Bağlantılar, en yeni kalemin faturadaki birimiyle (az örnekli öğretici) */
async function exampleLinks(db: DB): Promise<MatchExample[]> {
  const [links, units] = await Promise.all([
    db.select({ productKey: s.parasutProductLinks.productKey, productName: s.parasutProductLinks.productName, ingredientId: s.parasutProductLinks.ingredientId, factor: s.parasutProductLinks.factor }).from(s.parasutProductLinks),
    db
      .selectDistinctOn([s.parasutBillLines.productKey], { productKey: s.parasutBillLines.productKey, unit: s.parasutBillLines.unit })
      .from(s.parasutBillLines)
      .innerJoin(s.invoices, eq(s.invoices.id, s.parasutBillLines.invoiceId))
      .innerJoin(s.parasutProductLinks, eq(s.parasutProductLinks.productKey, s.parasutBillLines.productKey))
      .orderBy(s.parasutBillLines.productKey, desc(s.invoices.date), desc(s.parasutBillLines.id)),
  ]);
  const unitOf = new Map(units.map((u) => [u.productKey, u.unit]));
  return links.map((l) => ({ productName: l.productName, ingredientId: l.ingredientId, factor: l.factor, lineUnit: unitOf.get(l.productKey) ?? null }));
}

async function loadStore(db: DB) {
  const [row] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, AI_SUGGESTIONS_KEY)).limit(1);
  return parseMatchStore(row?.value);
}

/** Yeni önerileri ekler (iki sekme aynı anda yazınca biri ötekini ezmesin: satır kilitlenir) */
async function saveSuggestions(db: DB, hash: string, items: Record<string, StoredAiMatch>, pendingKeys: string[], active: readonly Ingredient[]): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(s.integrationState).where(eq(s.integrationState.key, AI_SUGGESTIONS_KEY)).for("update").limit(1);
    const value = mergeMatchStore(parseMatchStore(row?.value), hash, items, pendingKeys, active);
    await tx
      .insert(s.integrationState)
      .values({ key: AI_SUGGESTIONS_KEY, value })
      .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
  });
}

/**
 * Sayfa için: düğmenin durumu, saklı öneriler ve sorulacak ürün sayısı. Servise istek göndermez. `products` sayfadaki
 * bekleyenler, `links` bağlantılar (sezgisel "aynı ürün bağlı" önerisi bunlardan)
 */
export async function aiMatchPage(products: readonly MatchProduct[], links: readonly { productName: string; ingredientId: number; factor: number }[], now = new Date()): Promise<AiMatchState> {
  const db = getDb();
  const [status, ingredients, store] = await Promise.all([matchSuggestStatus(now), matchIngredients(db), loadStore(db)]);
  const active = ingredients.filter((i) => i.active);
  const items = freshItems(store, ingredientsHash(active), products.map((p) => p.productKey), active);
  return { ...status, items, askable: aiCandidates(products, ingredients, links, items).length, batchSize: MATCH_BATCH_SIZE };
}

export interface MatchBatchResult {
  /** Bu partide sorulan ürün */
  asked: number;
  /** Sorulmayı bekleyen (sonraki partiler) */
  remaining: number;
  /** Önerinin kararları: bağlanabilir, hammadde değil, emin değil (reddedilenler dahil) */
  link: number;
  notIngredient: number;
  unsure: number;
  /** AI'nin listede olmayan hammadde önerdiği ürün sayısı (doğrulamada reddedildi, öneri "emin değil" oldu) */
  rejected: number;
  costUsd: number;
}

/**
 * Bir parti: sayfadaki bekleyenlerden sezgiselin "aynı ürün bağlı" diyemediği ve geçerli saklı önerisi olmayan ilk
 * MATCH_BATCH_SIZE ürün tek istekte sorulur, yanıt doğrulanır, saklanır. Ekran `remaining` bitene kadar yeniden çağırır.
 * Aynı anda tek istek ve günlük parti sınırı claude.ts'te, "running" satırıyla aynı işlemde denetlenir (iki sekme ya da
 * çift basış ikisi birden geçemez). Yetkiyi eylem denetler (yalnız yönetici). Bağlantı kurmaz. `startedAt`: eylemin
 * başladığı an (ms), süre bütçesi ondan sayılır
 */
export async function suggestNextBatch(me: { id: number }, now = new Date(), startedAt = Date.now()): Promise<MatchBatchResult> {
  const db = getDb();
  // şube-ayrımı: parasut.eslenmemis
  const [{ items: products }, ingredients, links, store] = await Promise.all([unlinkedProducts(40), matchIngredients(db), exampleLinks(db), loadStore(db)]);
  const active = ingredients.filter((i) => i.active);
  if (!active.length) throw new UserError("Önce hammadde ekleyin: AI yalnız listedeki hammaddelerden önerir.");
  const hash = ingredientsHash(active);
  const pendingKeys = products.map((p) => p.productKey);
  const candidates = aiCandidates(products, ingredients, links, freshItems(store, hash, pendingKeys, active));
  const empty = { asked: 0, remaining: 0, link: 0, notIngredient: 0, unsure: 0, rejected: 0, costUsd: 0 };
  if (!candidates.length) return empty;
  const batch = candidates.slice(0, MATCH_BATCH_SIZE);
  const ids = new Set(active.map((i) => i.id));
  const totalMs = Math.max(MIN_CALL_MS, Math.min(MATCH_TIMEOUTS.totalMs, MATCH_BUDGET_MS - (Date.now() - startedAt)));
  // Faturanın bağlamı (açıklama, kategori, aynı faturadaki kalemler, tedarikçinin "hammadde değil"leri): kısaltmalar
  // ("KRP END KONTY") ancak bağlamla anlaşılır
  const context = await matchContext(db, batch);
  const asked = batch.map((p) => ({ ...p, context: context.get(p.productKey) }));
  const res = await extractMatch({ userId: me.id, system: matchSystemPrompt(active, pickExamples(links, ids)), task: matchTask(asked), schema: MatchAiRaw, totalMs });
  if (!res.ok) throw new UserError(res.message);
  const items = validateAnswer(res.data, { keys: shortKeys(batch), ingredientIds: ids, units: new Map(active.map((i) => [i.id, i.unit])), at: now.toISOString() });
  await saveSuggestions(db, hash, items, pendingKeys, active);
  const list = Object.values(items);
  return {
    asked: batch.length,
    remaining: candidates.length - batch.length,
    link: list.filter((i) => i.decision === "bagla").length,
    notIngredient: list.filter((i) => i.decision === "hammadde_degil").length,
    unsure: list.filter((i) => i.decision === "emin_degil").length,
    rejected: inventedCount(items),
    costUsd: res.costUsd,
  };
}

/**
 * Partideki ürünlerin bağlamı (docs/PARASUT.md › 5e): ürünün en yeni kaleminin faturası (açıklaması ve kategorisi), aynı
 * faturadaki öteki kalemlerin adları, tedarikçinin "hammadde değil" denmiş kalemlerinin adları. Fatura no, vergi no,
 * tedarikçi dışında kişi adı ve faturanın notu (elle yazılır, kişisel bilgi taşıyabilir) gitmez
 */
export async function matchContext(db: DB, products: readonly Pick<MatchProduct, "productKey" | "supplier">[]): Promise<Map<string, MatchContext>> {
  const out = new Map<string, MatchContext>();
  if (!products.length) return out;
  const keys = products.map((p) => p.productKey);
  const bl = s.parasutBillLines;
  const latest = await db
    .selectDistinctOn([bl.productKey], { productKey: bl.productKey, invoiceId: bl.invoiceId, description: s.invoices.description, category: s.invoices.category })
    .from(bl)
    .innerJoin(s.invoices, eq(s.invoices.id, bl.invoiceId))
    .where(inArray(bl.productKey, keys))
    .orderBy(bl.productKey, desc(s.invoices.date), desc(bl.id));
  const invoiceIds = [...new Set(latest.map((l) => l.invoiceId))];
  const supplierKeys = new Set(products.map((p) => supplierMatchKey(p.supplier)));
  const [siblings, ignoredRow, supplierLines] = await Promise.all([
    invoiceIds.length ? db.select({ invoiceId: bl.invoiceId, productKey: bl.productKey, name: bl.productName }).from(bl).where(inArray(bl.invoiceId, invoiceIds)) : Promise.resolve([]),
    db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, PRODUCT_IGNORE_KEY)),
    db.selectDistinct({ productKey: bl.productKey, name: bl.productName, supplier: s.invoices.supplier }).from(bl).innerJoin(s.invoices, eq(s.invoices.id, bl.invoiceId)),
  ]);
  const ignored = new Set(parseIgnored(ignoredRow[0]?.value).map((e) => e.productKey));
  const notIngredientBySupplier = new Map<string, string[]>();
  for (const l of supplierLines) {
    const k = supplierMatchKey(l.supplier);
    if (!supplierKeys.has(k) || !ignored.has(l.productKey)) continue;
    notIngredientBySupplier.set(k, [...(notIngredientBySupplier.get(k) ?? []), l.name]);
  }
  for (const p of products) {
    const l = latest.find((x) => x.productKey === p.productKey);
    out.set(p.productKey, {
      invoiceDescription: l?.description ?? null,
      invoiceCategory: l?.category ?? null,
      otherLines: l ? siblings.filter((x) => x.invoiceId === l.invoiceId && x.productKey !== p.productKey).map((x) => x.name) : [],
      supplierNotIngredient: notIngredientBySupplier.get(supplierMatchKey(p.supplier)) ?? [],
    });
  }
  return out;
}
