/*
 * Kodla okuma: yerel OCR (tesseract.js, WebAssembly; docs/FOTOGRAF.md › Kodla okuma). Yapay zekâ yokken (anahtar, kredi,
 * sınır, hata) LafPOS gününün gün sonu fotoğrafı burada okunur, satırlar Pavo fişinin ayrıştırıcısına gider
 * (src/lib/photo-read/pavo-ocr.ts). Çalışma anında ağ yok: Türkçe dil verisi pakette (@tesseract.js-data/tur, yalnız
 * LSTM'li 4.0.0_best_int, ~2 MB), çekirdek tesseract.js-core'dan; ikisi de Vercel işlevinin izine next.config.ts ›
 * outputFileTracingIncludes ile konur, tesseract.js serverExternalPackages'tadır (worker_threads ile kendi dosyasını
 * açar, paketlenmez). Önbelleğe yazılmaz (cacheMethod "none": işlevin diski salt okunur). Her okuma kendi işçisini açar
 * ve kapatır; süre sınırını aşan okuma işçiyi öldürür, yarım sonuç dönmez.
 *
 * "server-only" yok: testler (tests/gun-sonu-foto-ocr.test.ts) doğrudan çağırır; yalnız sunucu modülleri içe aktarır.
 */

import { join } from "node:path";

import type { OcrLine } from "@/lib/photo-read/pavo-ocr";

/** Paketle gelen Türkçe dil verisi (LSTM, tur.traineddata.gz) */
export const OCR_LANG_DIR = join(process.cwd(), "node_modules/@tesseract.js-data/tur/4.0.0_best_int");
/** Fotoğraf yolunun bütçesinde kodla okumanın payı (src/server/photo-read/lafpos.ts) */
export const OCR_TIMEOUT_MS = 15_000;

/**
 * Görseli (JPEG, PNG, WebP) okur, satırları sözcük güvenleriyle döner. Süre dolarsa ya da OCR çalışamazsa hata fırlatır
 * (çağıran okunuşu "yok" sayar, rakam uydurmaz)
 */
export async function ocrImage(bytes: Uint8Array, o: { timeoutMs?: number } = {}): Promise<OcrLine[]> {
  const { createWorker, OEM, PSM } = await import("tesseract.js");
  const timeoutMs = o.timeoutMs ?? OCR_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
  let done = false;
  const work = (async () => {
    worker = await createWorker("tur", OEM.LSTM_ONLY, { langPath: OCR_LANG_DIR, cacheMethod: "none", gzip: true });
    if (done) return [];
    // Fiş tek sütun: tek blok; sağa yaslanmış tutarların arasındaki boşluk korunur
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: "1" });
    const res = await worker.recognize(Buffer.from(bytes), {}, { blocks: true, text: false });
    const lines = (res.data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
    return lines.map((l) => ({
      text: l.text.trim(),
      confidence: l.confidence,
      words: l.words.map((w) => ({ text: w.text, confidence: w.confidence })),
    }));
  })();
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`OCR süresi doldu (${timeoutMs} ms)`)), timeoutMs);
      }),
    ]);
  } finally {
    done = true;
    clearTimeout(timer);
    work.catch(() => undefined);
    const w = worker as { terminate: () => Promise<unknown> } | null;
    if (w) await w.terminate().catch(() => undefined);
    else
      void work.then(
        () => (worker as { terminate: () => Promise<unknown> } | null)?.terminate().catch(() => undefined),
        () => undefined,
      );
  }
}
