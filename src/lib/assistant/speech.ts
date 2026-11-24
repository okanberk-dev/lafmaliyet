/*
 * Asistana sesle soru (saf yardımcılar; tests/asistan-gelismis.test.ts; docs/ASISTAN.md › Sesle soru). Tarayıcının Web
 * Speech API'si (SpeechRecognition, Safari ve Chrome'da `webkitSpeechRecognition`), dil tr-TR. Ses panelin sunucusuna da
 * Anthropic'e de gitmez: yalnız tanınan METİN yazı kutusuna yazılır, kullanıcı okuyup Gönder'e basar. Tarayıcı
 * desteklemiyorsa düğme hiç çizilmez (voice-button.tsx).
 */

import { ASSISTANT_LIMITS } from "./protocol";

/** Tanıyıcının kullandığımız yüzü (TypeScript'in DOM türlerinde yok: Chrome ve Safari önekli sunar) */
export interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** Tarayıcının tanıyıcısı; yoksa null (Firefox, eski tarayıcılar, sunucu) */
export function speechRecognitionCtor(win: unknown): SpeechRecognitionCtor | null {
  if (!win || typeof win !== "object") return null;
  const w = win as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  const ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return typeof ctor === "function" ? (ctor as SpeechRecognitionCtor) : null;
}

/** Tanıyıcının ayarı: Türkçe, akarken ara sonuç, tek cümle (konuşma bitince durur) */
export function configureRecognition(r: SpeechRecognitionLike): SpeechRecognitionLike {
  r.lang = "tr-TR";
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  return r;
}

/** Tanınan sonuçların metni (kesinleşen + ara) */
export function transcriptOf(results: ArrayLike<ArrayLike<{ transcript: string }>>): string {
  let out = "";
  for (let i = 0; i < results.length; i++) out += results[i][0]?.transcript ?? "";
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Yazı kutusundaki metin + tanınan konuşma: araya boşluk, kutu boşsa ilk harf büyük; soru sınırında kesilir. Denetim
 * karakterleri atılır.
 */
export function mergeTranscript(base: string, spoken: string): string {
  const said = spoken.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!said) return base;
  const head = base.replace(/\s+$/, "");
  const text = head ? `${head} ${said}` : said.charAt(0).toLocaleUpperCase("tr-TR") + said.slice(1);
  return text.slice(0, ASSISTANT_LIMITS.message);
}

/** Tanıyıcının hata kodu → kullanıcıya kısa Türkçe not (sessizlik ve iptal not değil: null) */
export function speechErrorText(code: string): string | null {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Mikrofon izni verilmedi. Tarayıcının site ayarlarından izin verin.";
    case "audio-capture":
      return "Mikrofon bulunamadı.";
    case "network":
      return "Ses tanıma için internet bağlantısı gerekiyor.";
    case "language-not-supported":
      return "Bu tarayıcı Türkçe ses tanımayı desteklemiyor.";
    case "no-speech":
    case "aborted":
      return null;
    default:
      return "Ses tanınamadı. Yeniden deneyin ya da yazın.";
  }
}
