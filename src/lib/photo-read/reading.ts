/**
 * Fotoğraf yükleme yolunun yanıtı (POST /api/foto ve /api/foto/{id}/oku): istemci ve sunucu aynı biçimi kullanır.
 * Okuma kasa (Z, banka POS) ya da fiş olabilir; okunamadıysa `readError` (fotoğraf yine saklanmıştır).
 */

import type { PhotoKind } from "@/lib/photo-rules";

import type { CashReading } from "./kasa";
import type { ReceiptReading } from "./receipt";

export type PhotoReading = CashReading | (ReceiptReading & { kind: "fis" });

export interface PhotoUploadResponse {
  ok: true;
  photo: { id: number; kind: PhotoKind; url: string };
  reading: PhotoReading | null;
  readError: string | null;
  /** src/server/ai/run.ts AiErrorCode (ekranda yalnız metin gösterilir) */
  readCode: string | null;
  /** "Yeniden dene" anlamlı mı */
  canRetry: boolean;
}
