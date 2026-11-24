/**
 * Gün sonu fotoğrafını okuyan modeller ve okunuşun kaynağı (saf; tests/gun-sonu-foto.test.ts). Sahibin isteği (24 Kasım
 * 2026): "AI kullanarak okursa çok iyi olur ama fazla token harcamayan ve sonuç verecek şekilde olsun; eğer AI token
 * biterse de kod ile". LafPOS gününün fotoğrafı önce ucuz modelle okunur, okunuş eksik / kendi içinde tutarsız ya da
 * LafPOS'tan farklıysa bir kez güçlü modelle (src/lib/photo-read/lafpos-read.ts); yapay zekâ yoksa kodla (OCR,
 * src/server/photo-read/ocr.ts). Modeller ayardan okunur (integration_state `ai.settings` › `photoModels`), yoksa ya da
 * bilinmeyen bir modelse aşağıdaki sabitler; ayar yalnız bu listedeki modelleri kabul eder (src/server/ai/run.ts
 * MODEL_REQUEST'in modelleri).
 */

/** İlk okuma: Claude Haiku 5.5 (Opus 5.5'in girdi fiyatının kırkta biri) */
export const PHOTO_CHEAP_MODEL = "claude-haiku-5-5";
/** İkinci okuma (gerekirse, bir kez): Claude Opus 5.5 */
export const PHOTO_STRONG_MODEL = "claude-opus-5-5";
export const PHOTO_MODELS = ["claude-haiku-5-5", "claude-opus-5-5"] as const;
export type PhotoModel = (typeof PHOTO_MODELS)[number];

/** Kodla okumanın ai_calls satırındaki "modeli": ücretsiz, günlük sınıra ve fotoğraf başına okuma sınırına sayılmaz */
export const OCR_MODEL = "kod-ocr";

export interface PhotoModels {
  cheap: PhotoModel;
  strong: PhotoModel;
}

const isPhotoModel = (v: unknown): v is PhotoModel => typeof v === "string" && (PHOTO_MODELS as readonly string[]).includes(v);

/** Ayarın (ai.settings değeri) okuma modelleri; eksik ya da bilinmeyen model sabite döner */
export function photoModelsOf(settings: unknown): PhotoModels {
  const v = settings && typeof settings === "object" ? (settings as { photoModels?: unknown }).photoModels : undefined;
  const m = v && typeof v === "object" ? (v as { cheap?: unknown; strong?: unknown }) : {};
  return { cheap: isPhotoModel(m.cheap) ? m.cheap : PHOTO_CHEAP_MODEL, strong: isPhotoModel(m.strong) ? m.strong : PHOTO_STRONG_MODEL };
}

/** Okunuşun kaynağı: yapay zekâ ("ai") ya da kod ("kod") */
export type ReadingSource = "ai" | "kod";
export function readingSourceOf(model: string | null | undefined): ReadingSource {
  return model === OCR_MODEL ? "kod" : "ai";
}

const MODEL_NAME: Record<string, string> = { "claude-haiku-5-5": "Claude Haiku 5.5", "claude-opus-5-5": "Claude Opus 5.5" };
/** Modelin adı ("Claude Haiku 5.5"); bilinmiyorsa kendisi */
export const modelName = (model: string) => MODEL_NAME[model] ?? model;
