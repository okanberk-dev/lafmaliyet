import type { Instrumentation } from "next";

/*
 * Next'in sunucu hata kancası (docs/HATA-KAYDI.md): sayfa, API yolu, sunucu eylemi ve ara katmanda yakalanmayan her hata
 * panelin hata kaydına (Ayarlar › Hata kaydı) yazılır; Vercel'in günlüğü Hobby'de yalnız bir saat tutar. Next hatayı
 * günlüğe kendisi yazmaya devam eder. Kayda yalnız hatanın adı, iletisi (kişisel veri ve anahtar temizlenmiş), yığının
 * ilk satırları, Next'in hata kodu ve yol gider; isteğin başlıkları (çerez, oturum, yetki), gövdesi ve sorgu dizgesi
 * gitmez (src/lib/error-log.ts › requestErrorEntry). Kayıt beklenmez, isteği yavaşlatmaz ve bozamaz
 * (src/server/errors/store.ts › reportError). Yalnız Node.js çalışma ortamında (veritabanı sürücüsü orada).
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const [{ requestErrorEntry }, { reportError }] = await Promise.all([import("./lib/error-log"), import("./server/errors/store")]);
      void reportError(() => requestErrorEntry(err, { path: request.path, method: request.method }, context));
    } catch {
      // Kayıt hiçbir zaman Next'in hata akışını bozmaz
    }
  }
};
