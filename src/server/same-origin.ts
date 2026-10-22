import "server-only";

/**
 * İstek panelin kendi sayfasından mı (Origin = Host). Yol işleyicileri sunucu eylemlerinin köken denetimini almaz;
 * SameSite=Lax çerez laffogato.net ve alt alan adlarından gelen isteklerde de gider (aynı site). Tarayıcı POST'ta
 * Origin'i her zaman yollar. Dosya yükleyen yollar kullanır (fatura belgesi, fotoğraf).
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}
