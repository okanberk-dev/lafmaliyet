import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { lafposPhotoCheck, type LafposPhotoReport } from "@/lib/lafpos/foto";
import { bankPosAuto } from "@/lib/lafpos/gun-sonu";
import { branchSwitchDay, isLafposDay, LAFPOS_BRANCH_ID } from "@/lib/lafpos/switch";
import { cheapReadingProblems, runLafposRead, type LafposReadResult, type ReadStep } from "@/lib/photo-read/lafpos-read";
import { OCR_MODEL } from "@/lib/photo-read/models";
import { parsePavoOcr } from "@/lib/photo-read/pavo-ocr";
import { OKC_SHORT_TASK, OKC_TASK, SYSTEM } from "@/lib/photo-read/prompts";
import { KasaOkcRaw, type KasaOkc } from "@/lib/photo-read/schemas";
import { extractImage, loadAiSettings, type AiResult } from "@/server/ai/claude";
import { OKC_EFFORT, OKC_MAX_TOKENS, type AiClient, type AiImageType, type AiTimeouts } from "@/server/ai/run";
import { schema as s, type DB } from "@/server/db";
import { lafposDayDevice } from "@/server/lafpos/foto";
import { loadLafposSwitchDay } from "@/server/lafpos/status";

import { ocrImage, OCR_TIMEOUT_MS } from "./ocr";

/*
 * LafPOS gününün gün sonu fotoğrafının ekonomik okunuşu (sahibin isteği, 24 Kasım 2026; docs/FOTOGRAF.md › LafPOS gününün
 * fotoğrafı; sıra src/lib/photo-read/lafpos-read.ts). Önce ucuz model (ayardan, varsayılan Claude Haiku 5.5) kısa istemle;
 * okunuş eksik / tutarsız ya da LafPOS'un rakamlarından farklıysa bir kez güçlü model (varsayılan Claude Opus 5.5); yapay
 * zekâ yoksa kodla (OCR + Pavo fişinin ayrıştırıcısı). Fotoğrafın kayıtlı okunuşu yeniden kullanılır (ai_calls). Her
 * çağrı ai_calls'a modeli ve tutarıyla yazılır (extractImage); kod okunuşu OCR_MODEL ile, ücretsiz.
 *
 * Süre (fotoğraf yolu 60 sn'de kesilir): ucuz en çok 15 sn, güçlü en çok 25 sn, OCR en çok 15 sn. En kötü yol (ucuz yanıt
 * verip okunuş vermedi, güçlü de düştü, OCR) 55 sn'ye sığar; güçlü okuma süreyi aşarsa ucuz okunuş kalır.
 *
 * Görsel küçültülmez: telefon fotoğrafı zaten en çok 2576 px JPEG'e küçültür (src/lib/photo-compress.ts; modellerin en
 * yüksek çözünürlüğü), termal fişin rakamları bu çözünürlüğe ihtiyaç duyar; sunucu görseli hiç çözmez (sıkıştırma
 * bombasına karşı, src/lib/photo-rules.ts). Görselin tokenı Haiku'da ~4.800 token × 0,10 $/M ≈ 0,0005 $: maliyet
 * modelden gelir (Opus girdi fiyatının kırkta biri), çözünürlükten değil.
 */

/** Ucuz okuma: tek 15 sn'lik deneme (hızlı dönen hata kalan sürede bir kez yeniden denenir) */
export const CHEAP_TIMEOUTS: AiTimeouts = { timeout: 15_000, maxRetries: 1, totalMs: 15_000 };
/** Güçlü okuma (gerekirse): 25 sn */
export const STRONG_TIMEOUTS: AiTimeouts = { timeout: 25_000, maxRetries: 1, totalMs: 25_000 };

export interface LafposPhotoInput {
  photoId: number;
  bytes: Uint8Array;
  contentType: AiImageType;
  day: string;
  userId: number;
  /** Formun kasası (currentTillBranch) */
  branchId: string;
}

/**
 * Raporun karşılaştırılan alanları: günün kasa raporu varsa onunki, yoksa LafPOS'un cihaz verisinden (otomatik raporun
 * yazacağı değerler: Banka POS = Pavo'nun gün sonları, yazarkasa alanları cihaz belgelerinden)
 */
async function compareReport(db: DB, day: string, branchId: string, device: NonNullable<Awaited<ReturnType<typeof lafposDayDevice>>>): Promise<LafposPhotoReport> {
  const [rep] = await db
    .select()
    .from(s.cashReports)
    .where(and(eq(s.cashReports.date, day), eq(s.cashReports.branchId, branchId)))
    .limit(1);
  const lafposZNo = device.z.okcZNo ?? null;
  if (rep) {
    return {
      bankPos: rep.bankPos,
      okcZNo: rep.okcZNo ?? null,
      okcTotal: rep.okcTotal ?? null,
      okcCash: rep.okcCash ?? null,
      okcCard: rep.okcCard ?? null,
      okcMealCard: rep.okcMealCard ?? null,
      okcOther: rep.okcOther ?? null,
      okcVat: rep.okcVat ?? null,
      lafposZNo,
    };
  }
  // Otomatik raporun yazacağı yazarkasa alanları (src/lib/lafpos/gun-sonu.ts okcAuto ile aynı eşleme)
  const okc = device.okc;
  return {
    bankPos: bankPosAuto(device.bankPos).value,
    okcZNo: lafposZNo,
    okcTotal: okc?.total ?? null,
    okcCash: okc?.cash ?? null,
    okcCard: okc?.card ?? null,
    okcMealCard: okc?.mealCard ?? null,
    okcOther: okc?.other ?? null,
    okcVat: okc?.vat?.length ? okc.vat : null,
    lafposZNo,
  };
}

/** Fotoğrafın kayıtlı okunuşları (yazarkasa bölümü): son başarılı yapay zekâ okunuşu, güçlü model denendi mi, kod okunuşu */
async function previousReads(db: DB, photoId: number, strongModel: string): Promise<{ reading: KasaOkc | null; model: string | null; strongTried: boolean; ocr: KasaOkc | null }> {
  const rows = await db
    .select({ model: s.aiCalls.model, status: s.aiCalls.status, result: s.aiCalls.result })
    .from(s.aiCalls)
    .where(and(eq(s.aiCalls.photoId, photoId), inArray(s.aiCalls.feature, ["kasa-okc", "kasa-pos"])))
    .orderBy(desc(s.aiCalls.at), desc(s.aiCalls.id));
  const parse = (r: unknown) => {
    const p = KasaOkcRaw.safeParse(r);
    return p.success ? p.data : null;
  };
  const ai = rows.find((r) => r.status === "ok" && r.model !== OCR_MODEL && parse(r.result));
  const ocr = rows.find((r) => r.status === "ok" && r.model === OCR_MODEL && parse(r.result));
  return {
    reading: ai ? parse(ai.result) : null,
    model: ai?.model ?? null,
    strongTried: rows.some((r) => r.model === strongModel && r.status !== "running"),
    ocr: ocr ? parse(ocr.result) : null,
  };
}

/**
 * LafPOS gününün gün sonu fotoğrafını okur (yazarkasa bölümü). LafPOS günü değilse (şube, geçiş günü, LafPOS'un gün sonu
 * gelmedi) null: çağıran eski yolla okur. `client` ve `ocr` yalnız testte
 */
export async function readLafposDayPhoto(
  db: DB,
  input: LafposPhotoInput,
  o: { client?: AiClient; ocr?: (bytes: Uint8Array) => Promise<Awaited<ReturnType<typeof ocrImage>>> } = {},
): Promise<LafposReadResult | null> {
  const { photoId, day, branchId, userId } = input;
  if (branchId !== LAFPOS_BRANCH_ID) return null;
  if (!isLafposDay(day, branchSwitchDay(await loadLafposSwitchDay(db), branchId))) return null;
  const device = await lafposDayDevice(db, day, branchId);
  if (!device) return null;
  const [settings, report] = await Promise.all([loadAiSettings(), compareReport(db, day, branchId, device)]);
  const { cheap, strong } = settings.photoModels;
  const image = { bytes: input.bytes, mediaType: input.contentType };
  const base = { feature: "kasa-okc" as const, userId, photoId, image, system: SYSTEM, schema: KasaOkcRaw, maxTokens: OKC_MAX_TOKENS, ...(o.client ? { client: o.client } : {}) };
  // Okuyan model: istenen; sunucu tarafı yedek model yanıt verdiyse o (ai_calls.served_model)
  const step = (res: AiResult<KasaOkc>, model: string): ReadStep => (res.ok ? { ok: true, data: res.data, model: res.fallback ? res.servedModel : model } : { ok: false, code: res.code, message: res.message });
  const differs = (raw: KasaOkc) => {
    const c = lafposPhotoCheck({ day, reads: [{ photoId, raw, error: null, source: "ai" }], bankPos: device.bankPos, okc: device.okc, report });
    return c.state === "fark" || c.state === "okunamadi";
  };
  const result = await runLafposRead({
    previous: await previousReads(db, photoId, strong),
    strongModel: strong,
    cheap: async () => step(await extractImage({ ...base, model: cheap, task: OKC_SHORT_TASK(day), effort: "low", timeouts: CHEAP_TIMEOUTS }), cheap),
    strong: async () => step(await extractImage({ ...base, model: strong, task: OKC_TASK(day), effort: OKC_EFFORT, timeouts: STRONG_TIMEOUTS }), strong),
    ocr: async () => {
      const t0 = Date.now();
      try {
        const lines = await (o.ocr ?? ((b: Uint8Array) => ocrImage(b, { timeoutMs: OCR_TIMEOUT_MS })))(input.bytes);
        const { raw, found } = parsePavoOcr(lines);
        await db.insert(s.aiCalls).values({ feature: "kasa-okc", model: OCR_MODEL, servedModel: OCR_MODEL, status: "ok", userId, photoId, ms: Date.now() - t0, costUsd: 0, result: raw });
        if (!found.length) console.warn("[foto] kodla okuma: fişte rakam seçilmedi", photoId);
        return { ok: true, data: raw, model: OCR_MODEL };
      } catch (e) {
        const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
        console.error("[foto] kodla okuma", photoId, message);
        await db.insert(s.aiCalls).values({ feature: "kasa-okc", model: OCR_MODEL, servedModel: OCR_MODEL, status: "error", errorCode: "ocr", error: message, userId, photoId, ms: Date.now() - t0, costUsd: 0 });
        return { ok: false, code: "ocr", message };
      }
    },
    needsSecond: (raw) => cheapReadingProblems(raw, { expectBatches: Boolean(device.bankPos?.batches?.length || device.bankPos?.batchNo) }).length > 0 || differs(raw),
  });
  return result;
}
