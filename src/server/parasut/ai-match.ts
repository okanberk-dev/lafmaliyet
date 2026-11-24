import "server-only";

import { and, count, desc, eq, gte } from "drizzle-orm";

import {
  aiCandidates,
  freshItems,
  ingredientsHash,
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
  type MatchExample,
  type MatchIngredientInfo,
  type MatchProduct,
  type StoredAiMatch,
} from "@/lib/product-match-ai";
import { extractMatch, matchSuggestStatus } from "@/server/ai/claude";
import { getDb, schema as s, type DB } from "@/server/db";
import { UserError } from "@/server/user-error";

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
/** Bundan yeni "running" çağrısı varsa başka sekmede öneri sürüyor (çağrı en çok 52 sn) */
const RUNNING_MS = 70_000;

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
async function saveSuggestions(db: DB, hash: string, items: Record<string, StoredAiMatch>, pendingKeys: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(s.integrationState).where(eq(s.integrationState.key, AI_SUGGESTIONS_KEY)).for("update").limit(1);
    const value = mergeMatchStore(parseMatchStore(row?.value), hash, items, pendingKeys);
    await tx
      .insert(s.integrationState)
      .values({ key: AI_SUGGESTIONS_KEY, value })
      .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
  });
}

/** Başka sekmede (ya da yöneticide) öneri isteği sürüyor mu */
async function matchRunning(db: DB, now: Date): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(s.aiCalls)
    .where(and(eq(s.aiCalls.feature, "eslestirme"), eq(s.aiCalls.status, "running"), gte(s.aiCalls.at, new Date(now.getTime() - RUNNING_MS))));
  return (row?.n ?? 0) > 0;
}

/**
 * Sayfa için: düğmenin durumu, saklı öneriler ve sorulacak ürün sayısı. Servise istek göndermez. `products` sayfadaki
 * bekleyenler, `links` bağlantılar (sezgisel "aynı ürün bağlı" önerisi bunlardan)
 */
export async function aiMatchPage(products: readonly MatchProduct[], links: readonly { productName: string; ingredientId: number; factor: number }[], now = new Date()): Promise<AiMatchState> {
  const db = getDb();
  const [status, ingredients, store] = await Promise.all([matchSuggestStatus(now), matchIngredients(db), loadStore(db)]);
  const hash = ingredientsHash(ingredients.filter((i) => i.active));
  const items = freshItems(store, hash, products.map((p) => p.productKey));
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
  /** AI'nin listede olmayan hammadde önerdiği ürün sayısı (reddedildi) */
  rejected: number;
  costUsd: number;
}

/**
 * Bir parti: sayfadaki bekleyenlerden sezgiselin "aynı ürün bağlı" diyemediği ve geçerli saklı önerisi olmayan ilk
 * MATCH_BATCH_SIZE ürün tek istekte sorulur, yanıt doğrulanır, saklanır. Ekran `remaining` bitene kadar yeniden çağırır.
 * Yetkiyi eylem denetler (yalnız yönetici). Bağlantı kurmaz
 */
export async function suggestNextBatch(me: { id: number }, now = new Date()): Promise<MatchBatchResult> {
  const db = getDb();
  if (await matchRunning(db, now)) throw new UserError("AI önerisi başka bir sekmede sürüyor; bitince sayfayı yenileyin.");
  const [{ items: products }, ingredients, links, store] = await Promise.all([unlinkedProducts(40), matchIngredients(db), exampleLinks(db), loadStore(db)]);
  const active = ingredients.filter((i) => i.active);
  if (!active.length) throw new UserError("Önce hammadde ekleyin: AI yalnız listedeki hammaddelerden önerir.");
  const hash = ingredientsHash(active);
  const pendingKeys = products.map((p) => p.productKey);
  const candidates = aiCandidates(products, ingredients, links, freshItems(store, hash, pendingKeys));
  const empty = { asked: 0, remaining: 0, link: 0, notIngredient: 0, unsure: 0, rejected: 0, costUsd: 0 };
  if (!candidates.length) return empty;
  const batch = candidates.slice(0, MATCH_BATCH_SIZE);
  const ids = new Set(active.map((i) => i.id));
  const res = await extractMatch({ userId: me.id, system: matchSystemPrompt(active, pickExamples(links, ids)), task: matchTask(batch), schema: MatchAiRaw });
  if (!res.ok) throw new UserError(res.message);
  const items = validateAnswer(res.data, { keys: shortKeys(batch), ingredientIds: ids, at: now.toISOString() });
  await saveSuggestions(db, hash, items, pendingKeys);
  const list = Object.values(items);
  return {
    asked: batch.length,
    remaining: candidates.length - batch.length,
    link: list.filter((i) => i.decision === "bagla").length,
    notIngredient: list.filter((i) => i.decision === "hammadde_degil").length,
    unsure: list.filter((i) => i.decision === "emin_degil").length,
    rejected: res.data.oneriler.filter((o) => o.hammadde_id !== null && !ids.has(o.hammadde_id)).length,
    costUsd: res.costUsd,
  };
}
