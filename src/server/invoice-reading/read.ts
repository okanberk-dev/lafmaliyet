import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { sniffMime } from "@/lib/documents";
import { INVOICE_SYSTEM, invoiceTask, InvoiceReadingRaw, normalizeInvoiceReading, readingFits, type InvoiceReading, type ReadingUnit } from "@/lib/invoice-reading";
import type { ReadingState } from "@/lib/photo-rules";
import { AI_INVOICE_MODEL, aiStatus, extractDocument } from "@/server/ai/claude";
import { aiErrorText } from "@/server/ai/run";
import { getDb, schema as s } from "@/server/db";
import { DocumentError, getInvoiceDocument } from "@/server/documents";
import { ParasutError } from "@/server/parasut/client";

/*
 * Faturayı okuma (docs/FATURA-OKUMA.md): faturanın belgesi (Paraşüt e-fatura PDF'i ya da görseli, yoksa yüklenen dosya;
 * "Faturayı aç"ın açtığı belge) Claude Haiku 5.5'e gider, kalemin paket boyu döner. Fatura + ürün başına bir okuma
 * saklanır (invoice_readings); kart ve form onu gösterir, "Yeniden oku" üzerine yazar. Okuma fiyat yazmaz: çarpanı
 * sahibi tek dokunuşla değiştirir. Sabah işinde hiç çalışmaz (yalnız yönetici ekranı açınca ya da düğmeyle).
 */

const r = s.invoiceReadings;

/** "running" kalan okuma (yarıda kalan istek) bu kadar sonra yeniden okunabilir */
const STALE_RUNNING_MS = 90_000;
/** Sayfanın süresi 60 sn: belge indirmesiyle birlikte okuma en geç bu sürede biter */
const BUDGET_MS = 55_000;
/** Belge geç inerse okumaya bu kadardan az süre kaldıysa denenmez */
const MIN_READ_MS = 8_000;

export type ReadingRow = typeof r.$inferSelect;

export interface ReadTarget {
  invoiceId: number;
  productKey: string;
  /** Kalem bizim verimizden: ad, açıklama, miktar, birim, KDV hariç net */
  line: { name: string; description: string | null; quantity: number; unit: string | null; netTotal: number };
  ingredient: { name: string; unit: ReadingUnit };
  userId: number;
  /**
   * auto: kartın kendiliğinden okuması (saklanan okuma ya da okunamama nedeni varsa o döner, yeniden sorulmaz);
   * manual: düğme (saklanan okuma döner, okunamadıysa yeniden okunur); force: Yeniden oku (her zaman okunur)
   */
  mode: "auto" | "manual" | "force";
}

export type ReadOutcome =
  | { status: "ok"; reading: InvoiceReading; cached: boolean }
  /** Okunamadı; `stored`: bu fatura için saklandı (kart gösterir, kendiliğinden yeniden okunmaz) */
  | { status: "error"; message: string; stored: boolean }
  /** Başka bir sekme ya da yönetici şu an okuyor */
  | { status: "busy" };

/** Ekranlar için okuma durumu (anahtar, Ayarlar › Fotoğraftan okuma, bugünkü sınır) */
export async function invoiceReadingState(): Promise<ReadingState> {
  return (await aiStatus()).state;
}

/**
 * Faturaların saklanan okumaları ("fatura|ürün" → satır). `busy`: şu an okunuyor (başka sekme ya da yönetici); yarıda
 * kalan okuma 90 sn sonra yeniden okunabilir
 */
export async function loadInvoiceReadings(pairs: { invoiceId: number; productKey: string }[]): Promise<Map<string, ReadingRow & { busy: boolean }>> {
  const ids = [...new Set(pairs.map((p) => p.invoiceId))];
  if (!ids.length) return new Map();
  const keys = new Set(pairs.map((p) => readingKey(p.invoiceId, p.productKey)));
  const rows = await getDb().select().from(r).where(inArray(r.invoiceId, ids));
  const now = Date.now();
  return new Map(
    rows
      .filter((x) => keys.has(readingKey(x.invoiceId, x.productKey)))
      .map((x) => [readingKey(x.invoiceId, x.productKey), { ...x, busy: x.status === "running" && now - x.createdAt.getTime() < STALE_RUNNING_MS }]),
  );
}

export const readingKey = (invoiceId: number, productKey: string) => `${invoiceId}|${productKey}`;

type Claim = { kind: "busy" } | { kind: "cached"; row: ReadingRow } | { kind: "claimed"; prev: ReadingRow | null };

/** Okumayı üstlenir: aynı fatura aynı anda iki kez okunmasın (iki sekme, iki yönetici, sayfa yenilenmesi) */
async function claim(t: ReadTarget): Promise<Claim> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(r)
      .where(and(eq(r.invoiceId, t.invoiceId), eq(r.productKey, t.productKey)))
      .for("update");
    if (row) {
      if (row.status === "running" && Date.now() - row.createdAt.getTime() < STALE_RUNNING_MS) return { kind: "busy" };
      // Saklanan okuma yeniden sorulmaz (hammadde başka birimdeyse okuma eskidir); okunamama nedeni yalnız kendiliğinden
      // okumada döner: düğme yeniden dener
      if (t.mode !== "force" && row.status === "ok" && row.result && readingFits(row.result, t.ingredient.unit)) return { kind: "cached", row };
      if (t.mode === "auto" && row.status === "error") return { kind: "cached", row };
      await tx.update(r).set({ status: "running", createdAt: new Date(), createdBy: t.userId }).where(eq(r.id, row.id));
      return { kind: "claimed", prev: row.status === "running" ? null : row };
    }
    const [ins] = await tx.insert(r).values({ invoiceId: t.invoiceId, productKey: t.productKey, status: "running", createdBy: t.userId }).onConflictDoNothing().returning({ id: r.id });
    return ins ? { kind: "claimed", prev: null } : { kind: "busy" };
  });
}

/** Faturanın belgesi okunacak hâliyle; yoksa ya da alınamazsa Türkçe neden */
async function documentFor(invoiceId: number): Promise<{ ok: true; input: Parameters<typeof extractDocument>[0]["input"] } | { ok: false; message: string }> {
  try {
    const doc = await getInvoiceDocument(invoiceId);
    const mime = sniffMime(doc.bytes);
    if (mime === "application/pdf") return { ok: true, input: { document: { bytes: doc.bytes, mediaType: mime } } };
    if (mime) return { ok: true, input: { image: { bytes: doc.bytes, mediaType: mime } } };
    return { ok: false, message: "Faturanın belgesi PDF ya da görsel değil; faturayı açıp bakın." };
  } catch (e) {
    if (e instanceof DocumentError) return { ok: false, message: e.message };
    if (e instanceof ParasutError) return { ok: false, message: `Paraşüt'ten alınamadı: ${e.message}` };
    console.error("[fatura] okuma: belge alınamadı", invoiceId, e instanceof Error ? e.message : e);
    return { ok: false, message: "Faturanın belgesi alınamadı; biraz sonra yeniden deneyin." };
  }
}

/**
 * Bir fatura kaleminin paket boyunu okur ve saklar. Kapılar fotoğraftakiyle aynı (anahtar, Ayarlar › Fotoğraftan
 * okuma, günlük sınır): kapalıyken belge de indirilmez, hiçbir şey saklanmaz. Okunamazsa neden saklanır (kendiliğinden
 * okuma bir daha denemez, düğme dener); "Yeniden oku" tutmazsa önceki okuma kalır.
 */
export async function readInvoiceLine(t: ReadTarget): Promise<ReadOutcome> {
  const started = Date.now();
  const st = await aiStatus();
  if (st.state !== "on") return { status: "error", message: aiErrorText(st.state, st.cap, "fatura"), stored: false };
  const c = await claim(t);
  if (c.kind === "busy") return { status: "busy" };
  if (c.kind === "cached") return c.row.status === "ok" && c.row.result ? { status: "ok", reading: c.row.result, cached: true } : { status: "error", message: c.row.error ?? "Fatura okunamadı.", stored: true };
  const db = getDb();
  const where = and(eq(r.invoiceId, t.invoiceId), eq(r.productKey, t.productKey));

  /**
   * Okunamadı: önceki okuma varsa o kalır (neden yalnız ekranda); yoksa neden saklanır. `keep: false` (kapı: bu arada
   * kapandı ya da sınır doldu; beklenmeyen hata) hiçbir şey saklamaz, okuma sonra yeniden denenebilir.
   */
  const fail = async (message: string, o: { aiCallId?: number | null; keep?: boolean } = {}): Promise<ReadOutcome> => {
    const prev = c.prev;
    if (prev) {
      await db.update(r).set({ status: prev.status, error: prev.error, createdAt: prev.createdAt, createdBy: prev.createdBy }).where(where);
      if (prev.status === "ok") return { status: "error", message, stored: false };
    }
    if (o.keep === false) {
      if (!prev) await db.delete(r).where(and(where, eq(r.status, "running")));
      return { status: "error", message, stored: false };
    }
    await db
      .update(r)
      .set({ status: "error", error: message.slice(0, 300), result: null, model: o.aiCallId ? AI_INVOICE_MODEL : null, aiCallId: o.aiCallId ?? null, costUsd: 0 })
      .where(where);
    return { status: "error", message, stored: true };
  };

  try {
    const doc = await documentFor(t.invoiceId);
    if (!doc.ok) return await fail(doc.message);
    const left = BUDGET_MS - (Date.now() - started);
    if (left < MIN_READ_MS) return await fail("Faturanın belgesi geç geldi; yeniden okuyun.");
    const res = await extractDocument({
      userId: t.userId,
      input: doc.input,
      system: INVOICE_SYSTEM,
      task: invoiceTask({ name: t.line.name, description: t.line.description, quantity: t.line.quantity, lineUnit: t.line.unit, netTotal: t.line.netTotal, ingredient: t.ingredient.name, unit: t.ingredient.unit }),
      schema: InvoiceReadingRaw,
      totalMs: Math.min(45_000, left),
    });
    // Kapıdan dönen (çağrı kaydı yok) saklanmaz: sınır yarın açılır, okuma yeniden denenir
    if (!res.ok) return await fail(res.message, { aiCallId: res.callId, keep: res.callId !== null });
    const reading = normalizeInvoiceReading(res.data, { quantity: t.line.quantity, unit: t.ingredient.unit });
    await db.update(r).set({ status: "ok", result: reading, error: null, model: res.servedModel, aiCallId: res.callId, costUsd: res.costUsd }).where(where);
    return { status: "ok", reading, cached: false };
  } catch (e) {
    console.error("[fatura] okuma", t.invoiceId, e instanceof Error ? e.message : e);
    return fail("Fatura okunamadı; biraz sonra yeniden deneyin.", { keep: false });
  }
}
