/**
 * Hata ekranının kendiliğinden yeniden denemesi (saf; src/components/panel/error-view.tsx, tests/canli-yoklama.test.ts).
 * Bar ekranı (Karaoke) gözetimsiz açık durur: arka plandaki bir yenileme veritabanının geçici hatasına denk gelirse
 * ekran "Bir şeyler ters gitti"de kalır, zil ve sayaç görünmez. Orada hata 10 saniye sonra kendiliğinden yeniden
 * denenir; döngüye girmesin diye 5 dakikada en çok 3 kez (sonrası "Tekrar dene" düğmesiyle).
 */
export const AUTO_RETRY = {
  paths: ["/panel/karaoke"],
  delayMs: 10_000,
  max: 3,
  windowMs: 5 * 60_000,
} as const;

/** Bu adreste ekran kendiliğinden yeniden dener mi (Doluluk gibi alt sayfalar hariç: biri bakıyordur) */
export function autoRetryPath(pathname: string): boolean {
  return AUTO_RETRY.paths.some((p) => pathname === p);
}

/** Pencere içindeki önceki denemelere göre bir deneme daha yapılabilir mi; yapılabiliyorsa listeye eklenir */
export function takeAutoRetry(history: number[], nowMs: number): boolean {
  const recent = history.filter((t) => nowMs - t < AUTO_RETRY.windowMs);
  history.splice(0, history.length, ...recent);
  if (recent.length >= AUTO_RETRY.max) return false;
  history.push(nowMs);
  return true;
}
