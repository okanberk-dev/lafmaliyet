/**
 * E-fatura belgesi (UBL) okuma sırası. Belgesi geçici bir hatayla (Paraşüt 5xx, zaman aşımı, hız sınırı) alınamayan
 * faturanın deneme sayısı tutulur (kayıt kimliği → sayı, integration_state): denenmiş olanlar sıranın sonuna alınır
 * (az denenen önce), böylece hep aynı hatayı veren tek bir belge en yeni fatura olarak sıranın başında kalıp
 * ötekileri bekletmez; UBL_MAX_TRIES denemede alınamazsa okunamadı sayılır (bir daha denenmez). Saf modül;
 * tests/parasut-lines.test.ts.
 */

export const UBL_MAX_TRIES = 5;

export type UblRetries = Record<string, number>;

/** Okuma sırası: hiç denenmemişler önce (verilen sırayla, en yeni önce), sonra az denenenler */
export function orderLineReads<T extends { id: number }>(rows: T[], retries: UblRetries): T[] {
  const tries = (r: T) => retries[String(r.id)] ?? 0;
  return [...rows].sort((a, b) => tries(a) - tries(b));
}

/**
 * Belge geçici bir hatayla alınamadı: "skip" bu turda atlanır (deneme sayılır), "stop" okuma bırakılır (oturum
 * hatası ya da art arda ikinci hata: sorun Paraşüt'ün kendisinde), "give-up" okunamadı sayılır. `tries` bu
 * faturanın önceki denemeleri, `streak` bu turda art arda gelen önceki hatalar.
 */
export function afterTransientFailure(tries: number, streak: number, auth: boolean): "skip" | "stop" | "give-up" {
  if (auth) return "stop";
  if (tries + 1 >= UBL_MAX_TRIES) return "give-up";
  return streak + 1 >= 2 ? "stop" : "skip";
}
