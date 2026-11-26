import "server-only";

import { ALL_BRANCHES, type BranchScope } from "@/lib/branches";
import { featureHere } from "@/server/branches";
import { loadKontrolDigest } from "@/server/data/checklists";
import { loadCommissionDigest } from "@/server/data/commission";
import { getDb } from "@/server/db";
import { loadDocDigest } from "@/server/staff-docs";
import { loadApprovalsDigest } from "@/server/staff-requests/digest";

import { collectDigestExtras, type DigestExtrasResult, type DigestExtraSource } from "./digest-template";

/**
 * Sabah e-postasının ek kutularının kaynakları (docs/planlar/CRITIQUE2.md R11): komisyon ve hakediş (komisyon grubu),
 * dünkü kontrol listeleri (kontrol), onay bekleyen personel istekleri (dalga 10), personel belgeleri (biten ve 30 gün
 * içinde bitecek). Her grup kutusunu kendi saf modülünde kurup sınar ve buraya
 * bir satır ekler; e-postanın konusu, başlığı, düğmesi, gövdedeki yeri ve tekil anahtarı digest-template.ts'te tek
 * yerde. Kurallar:
 *
 * - `load(today, { preview })` kutuyu ya da null döner; önizlemede (`preview: true`) hiçbir şey yazmaz. Daha önce
 *   bildirilmiş olanı (notification_log'da anahtarı olan) kaynağın kendisi eler: haber yoksa null.
 * - Her kaynak en çok 4 sn (DIGEST_EXTRA_MS); hata ya da süre aşımı kutuyu düşürür, e-postayı asla bozmaz.
 * - `news: true` kutu e-postayı tek başına gönderir; `news: false` kutu yalnız zaten giden e-postaya eklenir (bugün
 *   böyle bir kaynak yok; satış tahmini 4 Kasım 2026'da kalktı, şablondaki `forecast` yuvası haber sayılmayan genel kutu).
 * - `logKeys` ("komisyon:<uyarı>", "kontrol:<gün>") tekil anahtarın tohumuna girer ve yalnız başarılı gönderimden sonra
 *   notification_log'a yazılır.
 *
 * Liste boşken e-posta, konusu, tekil anahtarı ve günlük satırları kutusuz hâliyle birebir aynı.
 */
export const DIGEST_EXTRA_SOURCES: DigestExtraSource[] = [
  // Dünkü kontrol listeleri: eksik liste ve sorunlar, günde bir kez (kontrol:<gün>; docs/KONTROL-LISTELERI.md)
  { key: "kontrol", news: true, load: (_today, ctx) => loadKontrolDigest(undefined, ctx.scope) },
  // Komisyon ve hakediş: geciken hakediş, %6 aşımı, komisyon dışı ücret; her uyarı bir kez (komisyon:<uyarı>; docs/KOMISYON.md).
  // Şubeye bağlı alıcının şubesinde yemek kartı kullanılmıyorsa kutu yok (şube özelliği; docs/SUBE.md › Şube özellikleri)
  {
    key: "commission",
    news: true,
    load: async (today, ctx) => ((await featureHere("yemek_karti", ctx.scope ?? ALL_BRANCHES)) ? loadCommissionDigest(today, ctx) : null),
  },
  // Onay bekleyenler: personel istekleri (başlık ve isteyenin adı, tutarsız) ve operasyonun bilgi satırları (Tükendi);
  // karar verilene kadar her sabah (docs/ONAYLAR.md)
  { key: "approvals", news: true, load: (_today, ctx) => loadApprovalsDigest(undefined, ctx.scope) },
  // Personel belgeleri (hijyen, sağlık raporu, SGK…): bitişe 30 gün kala bir kez, bitince bir kez
  // (belge:<id>:<bitiş>:30|bitti; docs/PERSONEL-BELGE.md). Şubeye bağlı alıcıya yalnız o şubenin kişileri
  { key: "staffDocs", news: true, load: (today, ctx) => loadDocDigest(getDb(), today, ctx.scope ?? ALL_BRANCHES) },
];

/**
 * Ek kutuları aynı anda yükler (her biri en çok 4 sn); asla hata fırlatmaz. `preview`: yalnız okuyan önizleme. `scope`:
 * şubeye bağlı alıcının e-postası (kontrol listeleri ve onay bekleyenler yalnız o şubenin; şube kapsamı C P1-11)
 */
export function loadDigestExtras(today: string, o: { preview?: boolean; scope?: BranchScope } = {}): Promise<DigestExtrasResult> {
  return collectDigestExtras(DIGEST_EXTRA_SOURCES, today, { preview: o.preview ?? false, scope: o.scope });
}
