import "server-only";

import { cache } from "react";

import { loadModel } from "./dataset";

/**
 * Maliyet modeli istek başına bir kez (React cache): /panel/onaylar'ın bölümleri (kasa, mal siparişi ve zayi, reçete)
 * ayrı Suspense'lerde aynı modeli paylaşır, her biri yeniden kurmaz. Yalnız yönetici ekranlarında çağrılır.
 */
export const loadModelOnce = cache(loadModel);
