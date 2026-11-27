/**
 * Önce ucuz model, gerekirse bir kez güçlü model (saf; tests/foto-ucuz-once.test.ts). Sahibin isteği (25 Kasım 2026):
 * "rapor ve z raporlarını ai okusun ama ucuz model ile okut". AsilPOS gününün gün sonu fotoğrafı zaten böyle okunuyordu
 * (asilpos-read.ts); ModPOS'un Z raporu (kasa-z), elle girilen raporun yazarkasa Z'si (kasa-okc) ve kasadan çıkan fiş (fis)
 * de aynı sıraya geçti:
 *
 * 1. Ucuz model (ayardan, varsayılan Claude Haiku 5.5) aynı şema ve istemle okur.
 * 2. Okunuş eksik ya da kendi içinde tutarsızsa (aşağıdaki *Problems) güçlü model (varsayılan Claude Opus 5.5) bir kez
 *    yeniden okur; güçlü okuma düşerse ucuz okunuş kalır (formda yine her rakam denetlenir, renkler ve uyarılar aynı).
 * 3. Ucuz model yanıt verip okunuş vermediyse (ret, yarım, şema dışı) ya da zaman aşımı / yoğunluk ise güçlü model bir
 *    kez denenir. Kapılar (anahtar yok, kapalı, sınır, fotoğraf başına 3 okuma) güçlü modeli de kapatır: denenmez.
 *
 * Maliyet: fotoğrafın tokenı Haiku'da Opus'un kırkta biri; çoğu net fiş tek ucuz çağrıyla biter.
 */

import type { AiErrorCode } from "@/server/ai/run";

import { printedAmount, round2 } from "./common";
import type { KasaZ, Receipt } from "./schemas";

export type CheapStep<T> = { ok: true; data: T; model: string } | { ok: false; code: AiErrorCode; message: string };

/** Ucuz model yanıt verdi ama okunuş yok ya da servis geçici olarak yanıtsız: güçlü model bir kez denenir */
const RETRY_STRONG: readonly AiErrorCode[] = ["refusal", "incomplete", "invalid", "timeout", "overloaded"];

export interface CheapFirstResult<T> {
  result: CheapStep<T>;
  /** Atılan adımlar (günlük): "cheap", "strong" */
  steps: string[];
  /** Ucuz okunuşun sorunları (güçlü modele gerekçe); yoksa boş */
  problems: string[];
}

export async function cheapFirst<T>(d: { cheap: () => Promise<CheapStep<T>>; strong: () => Promise<CheapStep<T>>; problems: (data: T) => string[] }): Promise<CheapFirstResult<T>> {
  const steps = ["cheap"];
  const c = await d.cheap();
  let problems: string[] = [];
  if (c.ok) {
    problems = d.problems(c.data);
    if (!problems.length) return { result: c, steps, problems };
  } else if (!RETRY_STRONG.includes(c.code)) {
    return { result: c, steps, problems };
  }
  const s = await d.strong();
  steps.push("strong");
  if (s.ok) return { result: s, steps, problems };
  return { result: c.ok ? c : s, steps, problems };
}

const TOL = 0.01;

/**
 * ModPOS Z raporunun (kasa-z) ucuz okunuşunun sorunları: belge türü, okunamadı, toplam yok, Z no yok, ödeme satırı yok
 * ya da okunamadı, ödemelerin toplamı Z toplamını da Z toplamı − ödenmezi de tutmuyor (kasa formunun kuralı, KP-08),
 * toplamda ya da bir ödemede düşük / orta güven
 */
export function zReadProblems(raw: KasaZ): string[] {
  const out: string[] = [];
  if (raw.documentType !== "z_report") out.push("belge türü");
  if (!raw.readable) out.push("okunamadı");
  const total = printedAmount(raw.total);
  if (total.value === null) out.push("toplam yok");
  else if (total.confidence !== "high" || total.mismatch) out.push("düşük güven");
  if (!raw.zNo) out.push("Z no yok");
  const pays = raw.paymentLines.filter((p) => p.kind !== "comp");
  if (!pays.length) out.push("ödeme satırı yok");
  else {
    const vals = pays.map((p) => printedAmount(p.amount));
    if (pays.some((x) => x.amount.text !== null && printedAmount(x.amount).value === null)) out.push("ödeme okunamadı");
    if (vals.some((v) => v.value !== null && (v.confidence !== "high" || v.mismatch))) out.push("düşük güven");
    if (pays.some((x) => x.kind === "unknown")) out.push("tanınmayan ödeme");
    if (total.value !== null && vals.every((v) => v.value !== null)) {
      const sum = round2(vals.reduce((a, v) => a + v.value!, 0));
      const comps = printedAmount(raw.comps).value ?? 0;
      if (Math.abs(sum - total.value) > TOL && Math.abs(sum - round2(total.value - comps)) > TOL) out.push("ödemeler toplamı tutmuyor");
    }
  }
  return [...new Set(out)];
}

/**
 * Kasadan çıkan fişin (fis) ucuz okunuşunun sorunları: belge türü (fiş, e-Arşiv ya da fatura değil), okunamadı, toplam
 * yok ya da düşük / orta güven, kalemlerin toplamı fişin toplamını tutmuyor (kalemlerin hepsi okunduysa), KDV
 * satırlarının toplamı toplam KDV'yi tutmuyor
 */
export function receiptReadProblems(raw: Receipt): string[] {
  const out: string[] = [];
  if (raw.documentType !== "purchase_receipt" && raw.documentType !== "e_archive_invoice" && raw.documentType !== "invoice") out.push("belge türü");
  if (!raw.readable) out.push("okunamadı");
  const total = printedAmount(raw.total);
  if (total.value === null) out.push("toplam yok");
  else if (total.confidence !== "high" || total.mismatch) out.push("düşük güven");
  const items = raw.items.map((i) => printedAmount(i.amount));
  if (total.value !== null && items.length && items.length < 30 && items.every((v) => v.value !== null)) {
    const sum = round2(items.reduce((a, v) => a + v.value!, 0));
    if (Math.abs(sum - total.value) > TOL) out.push("kalemler tutmuyor");
  }
  const vat = printedAmount(raw.vatTotal);
  const lines = raw.vatLines.map((l) => printedAmount(l.amount));
  if (vat.value !== null && lines.length && lines.every((v) => v.value !== null)) {
    const sum = round2(lines.reduce((a, v) => a + v.value!, 0));
    if (Math.abs(sum - vat.value) > TOL) out.push("KDV tutmuyor");
  }
  return [...new Set(out)];
}
