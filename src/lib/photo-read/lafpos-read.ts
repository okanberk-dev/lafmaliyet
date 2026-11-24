/**
 * LafPOS gününün gün sonu fotoğrafını okuma sırası (saf; tests/gun-sonu-foto.test.ts). Sahibin isteği (24 Kasım 2026):
 * "AI kullanarak okursa çok iyi olur ama fazla token harcamayan ve sonuç verecek şekilde olsun; eğer AI token biterse de
 * kod ile bir şey yaz". Sıra:
 *
 * 1. Fotoğrafın kayıtlı okunuşu varsa o kullanılır: aynı fotoğraf aynı iş için iki kez okunmaz (ai_calls'taki sonuç).
 * 2. Ucuz model (PHOTO_CHEAP_MODEL, kısa istem OKC_SHORT_TASK, aynı şema). Okunuş eksik ya da kendi içinde tutarsızsa
 *    (cheapReadingProblems) ya da LafPOS'un rakamlarından farklıysa güçlü model (PHOTO_STRONG_MODEL, OKC_TASK) bir kez
 *    yeniden okur: yanlış bir "fark" yöneticiye gitmeden ikinci kez bakılır. Güçlü okuma düşerse ucuz okunuş kalır.
 * 3. Yapay zekâ yoksa ya da yanıt vermiyorsa (anahtar, kapalı, sınır, kredi, yoğunluk, zaman aşımı, bağlantı…) kodla
 *    okunur (OCR + src/lib/photo-read/pavo-ocr.ts). Model yanıt verdi ama okunuş yoksa (ret, yarım, şema dışı) önce bir
 *    kez güçlü model, o da olmazsa kod. Kod da okuyamazsa okunuş yok: hiçbir rakam uydurulmaz.
 *
 * Her yapay zekâ çağrısı ai_calls'a modeli ve tutarıyla yazılır (src/server/ai/claude.ts); kod okunuşu da aynı tabloya
 * OCR_MODEL ile, ücretsiz. Sunucu tarafı src/server/photo-read/lafpos.ts.
 */

import type { AiErrorCode } from "@/server/ai/run";

import { printedAmount, round2 } from "./common";
import { OCR_MODEL } from "./models";
import type { KasaOkc } from "./schemas";

/** Bir okuma adımının sonucu (yapay zekâ ya da kod) */
export type ReadStep = { ok: true; data: KasaOkc; model: string } | { ok: false; code: AiErrorCode | "ocr"; message: string };
/** Okuma hatası (yapay zekânın kodu ya da kodla okumanın "ocr"u) */
export type ReadFailure = { code: AiErrorCode | "ocr"; message: string };

/** Model yanıt verdi ama okunuş yok: güçlü model bir kez denenir */
const RETRY_STRONG: readonly string[] = ["refusal", "incomplete", "invalid"];

export interface LafposReadDeps {
  /** Fotoğrafın kayıtlı okunuşları: son başarılı yapay zekâ okunuşu ve modeli, güçlü model denendi mi, kod okunuşu */
  previous: { reading: KasaOkc | null; model: string | null; strongTried: boolean; ocr: KasaOkc | null };
  strongModel: string;
  cheap: () => Promise<ReadStep>;
  strong: () => Promise<ReadStep>;
  ocr: () => Promise<ReadStep>;
  /** İkinci okuma gerekir mi: eksik / tutarsız ya da LafPOS'tan farklı */
  needsSecond: (raw: KasaOkc) => boolean;
}

export interface LafposReadResult {
  raw: KasaOkc | null;
  source: "ai" | "kod" | null;
  model: string | null;
  /** Atılan adımlar (günlük): "reuse", "cheap", "strong", "ocr", "reuse-ocr" */
  steps: string[];
  /** Okunuş yoksa yapay zekânın (yoksa kodun) hatası */
  error: ReadFailure | null;
  /** Kodla okumaya götüren yapay zekâ hatası (kod okuduysa da; yapay zekâ okuduysa yok) */
  aiError?: ReadFailure | null;
}

export async function runLafposRead(d: LafposReadDeps): Promise<LafposReadResult> {
  const steps: string[] = [];
  const ai = (raw: KasaOkc, model: string): LafposReadResult => ({ raw, source: "ai", model, steps, error: null });
  let first: { raw: KasaOkc; model: string } | null = null;
  let failure: ReadFailure | null = null;
  if (d.previous.reading) {
    steps.push("reuse");
    const model = d.previous.model ?? d.strongModel;
    if (model === d.strongModel || d.previous.strongTried || !d.needsSecond(d.previous.reading)) return ai(d.previous.reading, model);
    first = { raw: d.previous.reading, model };
  } else {
    const c = await d.cheap();
    steps.push("cheap");
    if (c.ok) {
      if (!d.needsSecond(c.data)) return ai(c.data, c.model);
      first = { raw: c.data, model: c.model };
    } else {
      failure = { code: c.code, message: c.message };
      if (!RETRY_STRONG.includes(c.code)) return code(d, steps, failure);
    }
  }
  const s = await d.strong();
  steps.push("strong");
  if (s.ok) return ai(s.data, s.model);
  if (first) return ai(first.raw, first.model);
  return code(d, steps, failure ?? { code: s.code, message: s.message });
}

async function code(d: LafposReadDeps, steps: string[], failure: ReadFailure): Promise<LafposReadResult> {
  if (d.previous.ocr) {
    steps.push("reuse-ocr");
    return { raw: d.previous.ocr, source: "kod", model: OCR_MODEL, steps, error: null, aiError: failure };
  }
  const o = await d.ocr();
  steps.push("ocr");
  if (o.ok) return { raw: o.data, source: "kod", model: o.model, steps, error: null, aiError: failure };
  return { raw: null, source: null, model: null, steps, error: failure, aiError: failure };
}

/**
 * Elle girilen raporun kasa formu (yazarkasa bölümü; LafPOS gününde de aynı okuma yolu): alanları yalnız yapay zekâ
 * okunuşu doldurur. Kodla okunduysa (OCR rakamının kaynağı formda görünmez, güveni ayrı) ya da hiç okunamadıysa form
 * yapay zekânın hatasını eskisi gibi gösterir ("rakamları elle yazın", gerekirse "Yeniden dene"); kod okunuşu yine
 * yöneticinin karşılaştırmasına gider. Gün sonu fotoğrafı kartı bu metni göstermez (personelden rakam istenmez)
 */
export function formFailureOf(r: LafposReadResult): ReadFailure | null {
  if (r.source === "ai" && r.raw) return null;
  return r.aiError ?? r.error ?? { code: "ocr", message: "Fotoğraf okunamadı; rakamları elle yazın." };
}

const TOL = 0.01;

/**
 * Ucuz okunuşun eksikleri ve iç tutarsızlıkları (boşsa okunuş tam): belge türü, Z'nin toplamı ve Z no'su, ödemelerin
 * toplamı = günün toplamı, KDV gruplarının toplamı = günün toplamı, batch'ler (Pavo'nun sonucu geldiyse beklenir), her
 * batch'te satış − iade = net, karşılaştırılan rakamlardan biri "low" güvenle okunduysa
 */
export function cheapReadingProblems(raw: KasaOkc, o: { expectBatches: boolean }): string[] {
  const out: string[] = [];
  const v = (a: KasaOkc["dailyTotal"]) => printedAmount(a);
  if (!raw.readable) out.push("okunamadı");
  if (raw.documentType !== "z_report" && raw.documentType !== "batch_slip") out.push("belge türü");
  let lowConfidence = false;
  if (raw.documentType === "z_report") {
    const total = v(raw.dailyTotal);
    if (total.value === null) out.push("toplam yok");
    else if (total.confidence === "low") lowConfidence = true;
    if (raw.zNo.text === null && raw.zNo.value === null) out.push("Z no yok");
    const hasCard = raw.payments.some((p) => p.kind === "card");
    const pays = raw.payments.filter((p) => p.kind === "cash" || p.kind === "meal_card" || p.kind === "other" || (hasCard ? p.kind === "card" : p.kind === "bank_subline"));
    if (!pays.length) out.push("ödeme satırı yok");
    else {
      const vals = pays.map((p) => v(p.amount));
      if (vals.some((x) => x.value === null)) out.push("ödeme okunamadı");
      else {
        if (vals.some((x) => x.confidence === "low")) lowConfidence = true;
        const sum = round2(vals.reduce((a, x) => a + x.value!, 0));
        if (total.value !== null && Math.abs(sum - total.value) > TOL) out.push("ödemeler toplamı tutmuyor");
      }
    }
    const groups = raw.kdvGroups.map((g) => v(g.total).value);
    if (total.value !== null && groups.length && groups.every((x) => x !== null) && Math.abs(round2(groups.reduce((a, x) => a! + x!, 0)!) - total.value) > TOL) out.push("KDV toplamı tutmuyor");
  }
  if (o.expectBatches && raw.batches.length === 0) out.push("batch yok");
  for (const b of raw.batches) {
    if (!b.batchNo) out.push("batch no yok");
    const sales = v(b.salesTotal);
    const net = v(b.netTotal);
    const refund = b.refundTotal.text === null && b.refundTotal.value === null ? { value: 0, confidence: "high" as const } : v(b.refundTotal);
    if (net.value === null && (sales.value === null || refund.value === null)) out.push("batch tutarı yok");
    if (net.confidence === "low" && net.value !== null) lowConfidence = true;
    if (sales.value !== null && net.value !== null && refund.value !== null && Math.abs(round2(sales.value - refund.value) - net.value) > TOL) out.push("batch tutmuyor");
  }
  if (lowConfidence) out.push("düşük güven");
  return [...new Set(out)];
}
