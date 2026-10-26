import "server-only";

import { photoViewDecision, type PhotoKind } from "@/lib/photo-rules";
import type { CurrentUser } from "@/server/auth/dal";
import { kontrolPhotoRules } from "@/server/data/checklists";
import { cashPhotoRules, okcPhotoRules, receiptPhotoRules } from "@/server/photo-read/rules";

import type { PhotoRow } from "./photos";

/**
 * Fotoğrafı kim görür: tür başına sabit kayıt (her tür derleme anında kurallı; tembel yüklenen bir yolun kaçırabileceği
 * yan etkili kayıt yok). Sıra photoViewDecision'da: süresi dolmuş → hayır, yönetici → evet, yükleyen bağlanmamış
 * fotoğrafını görür; kalanı türün `canView`'i. Görülemeyen fotoğraf 403 "Bu fotoğrafı görme yetkiniz yok." (kimlikler
 * sıralı ve herkes girişli: açık metin, fotoğrafın varlığını saklamaktan iyidir).
 */
export interface PhotoKindRules {
  /** Personel görebilir mi (yönetici ve bağlanmamış fotoğrafın yükleyeni buraya gelmez) */
  canView(me: CurrentUser, photo: PhotoRow): Promise<boolean>;
  /** Bağlandıktan sonra saklama (gün) */
  keepDays: number;
}

export const PHOTO_RULES: Record<PhotoKind, PhotoKindRules> = {
  "kasa-z": cashPhotoRules,
  "kasa-pos": cashPhotoRules,
  "kasa-okc": okcPhotoRules,
  fis: receiptPhotoRules,
  // Kontrol listeleri: personel yalnız kendi doldurabildiği listenin son 7 günkü fotoğraflarını (src/lib/checklists.ts photoAccess)
  kontrol: kontrolPhotoRules,
};

export const FORBIDDEN_TEXT = "Bu fotoğrafı görme yetkiniz yok.";

export async function canViewPhoto(me: CurrentUser, photo: PhotoRow, now = new Date()): Promise<boolean> {
  const first = photoViewDecision(me, photo, now);
  if (first !== "rules") return first === "yes";
  return PHOTO_RULES[photo.kind].canView(me, photo);
}
