import "server-only";

import { cache } from "react";

import { loadModel } from "./dataset";

/**
 * Maliyet modeli istek başına bir kez (React cache): /panel/onaylar'ın bölümleri (kasa, zayi ve ikram, reçete)
 * ayrı Suspense'lerde aynı modeli paylaşır, her biri yeniden kurmaz. Yalnız yönetici ekranlarında çağrılır.
 */
export const loadModelOnce = cache(loadModel);

/**
 * Bir şubenin maliyet modeli istek başına bir kez (React cache; anahtar şubenin kimliği). Onaylar › Zayi ve ikram
 * kartının bağlamı (kayıtlı ikram, AsilPOS günleri) isteğin şubesinden okunur, yöneticinin seçiminden değil (denetim
 * 21 Kasım #28; src/server/data/waste-requests.ts loadWasteRequestQueue).
 */
export const loadBranchModelOnce = cache((branchId: string) => loadModel({ scope: branchId }));
