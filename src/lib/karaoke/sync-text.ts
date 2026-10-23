/**
 * Karaoke çekmesinin hata metinleri (saf; sunucu ve testler paylaşır: tests/karaoke-baglanti.test.ts). Yönetici
 * kartında (Karaoke › Bu ay), Ayarlar › laffogato.net'te ve bar ekranının uyarı satırında görünür; docs/KARAOKE.md ›
 * Sorun giderme ne yapılacağını söyler. Menü ve satış bağlantılarının sözleriyle aynı (src/lib/site-menu/push.ts,
 * src/server/site-sales/sync.ts). Önceden sitenin her 503'ü "KARAOKE_SYNC_SECRET tanımlı değil" sayılıyordu (sitenin
 * veritabanı kısa süre okunamayınca da: yönetici gereksiz yere anahtarı değiştirip siteyi yeniden yayımlardı), ağ ve
 * biçim hataları İngilizce ham metin ya da JSON olarak yazılıyordu.
 */

export type KaraokePullFailure =
  /** Site 8 sn'de yanıt vermedi */
  | { kind: "timeout" }
  /** Siteye ulaşılamadı (ad çözülemedi, bağlantı kurulamadı) */
  | { kind: "network" }
  /** Yanıt JSON değil ya da beklenen biçimde değil */
  | { kind: "format" }
  /** Sitenin HTTP hatası; `code` gövdedeki hata kodu ({"error":"unavailable"}) */
  | { kind: "http"; status: number; code?: string | null };

export function karaokePullError(f: KaraokePullFailure): string {
  if (f.kind === "timeout") return "Site 8 saniyede yanıt vermedi";
  if (f.kind === "network") return "Siteye ulaşılamadı";
  if (f.kind === "format") return "Sitenin yanıtı okunamadı (site ile panel uyumsuz olabilir)";
  switch (f.status) {
    case 401:
      return "Site isteği reddetti (imza): iki projedeki KARAOKE_SYNC_SECRET aynı mı, sunucu saatleri doğru mu?";
    case 404:
      return "Sitede panel ucu yok (laffogato.net güncel değil)";
    case 400:
      return "Site tarih aralığını kabul etmedi";
    case 503:
      if (f.code === "not_configured") return "Sitede KARAOKE_SYNC_SECRET tanımlı değil";
      if (f.code === "unavailable") return "Sitenin veritabanı şu an okunamıyor; birazdan yeniden denenecek";
      return "Sitede bağlantı kapalı ya da sitenin veritabanı okunamadı";
    default:
      return `Site yanıt vermedi (HTTP ${f.status})`;
  }
}

/** fetch'in fırlattığı hata: zaman aşımı mı, ağ mı */
export function fetchFailure(e: unknown): { kind: "timeout" } | { kind: "network" } {
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? { kind: "timeout" } : { kind: "network" };
}

/** Hata yanıtının gövdesindeki kod ({"error":"unavailable"}); yoksa ya da okunamazsa null */
export function siteErrorCode(json: unknown): string | null {
  const code = json && typeof json === "object" ? (json as { error?: unknown }).error : undefined;
  return typeof code === "string" && code ? code.slice(0, 40) : null;
}
