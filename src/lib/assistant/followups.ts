/*
 * Asistan yanıtının takip önerileri (saf; tests/asistan-gelismis.test.ts; docs/ASISTAN.md › Takip önerileri). Ek bir API
 * çağrısı yoktur: model aynı yanıtın sonuna 2–3 kısa soruyu etiketli bir blokla yazar (sistem istemi, prompt.ts):
 *
 *   <takip>
 *   - Geçen haftayla kıyaslar mısın?
 *   - Hangi gün kasa tutmadı?
 *   </takip>
 *
 * Tarayıcı bloğu yanıttan ayırır: metin bloksuz görünür (akarken yarım gelen "<tak" da gizlenir), sorular yanıtın altında
 * çip olur, dokununca soru olarak gider. Bloğun içi veridir: her satır düz yazıya indirilir (etiket, markdown işareti,
 * denetim karakteri atılır), bağlantı ya da adres taşıyan satır düşer, en çok 3 soru, her biri en çok 80 karakter.
 * İş yaptıran satır da düşer (ACTION: "Latte fiyatını 1 ₺ yap", "ödendi olarak işaretler misin?"): öneri yalnız soru ya
 * da bakma isteğidir; araç verisine gömülü bir istem enjeksiyonu tek dokunuşluk bir işlem isteği üretemesin (işlem yine
 * onay kartı isterdi; bu ikinci kat). Ekranda React yazısı olarak çizilir (HTML yok). Geçmişe (sonraki isteğe) yalnız
 * bloksuz metin gider.
 */

export const FOLLOWUP_OPEN = "<takip>";
export const FOLLOWUP_CLOSE = "</takip>";
export const FOLLOWUP_MAX = 3;
export const FOLLOWUP_CHARS = 80;

/** Akan metnin sonunda yarım kalmış açılış etiketi ("<", "<ta", "<taki"): ekranda bir an görünmesin */
function partialOpenAt(text: string): number {
  for (let n = Math.min(FOLLOWUP_OPEN.length - 1, text.length); n > 0; n--) {
    if (FOLLOWUP_OPEN.startsWith(text.slice(-n))) return text.length - n;
  }
  return -1;
}

/**
 * İşlem isteği: iş yapan bir fiil kökü emir ekiyle ("yap", "ekleyin", "silelim mi") ya da rica biçiminde ("işaretler
 * misin", "kaydedebilir misiniz"). Edilgen ve üçüncü kişi soruları geçer ("nasıl kaydedilir?", "ne eklendi?", "fark
 * yapar mı?", "ödemem lazım").
 */
const ACTION_STEMS = "yap|ekle|sil|değiştir|güncelle|işaretle|onayla|kapat|öde|ayarla|kaydet|kayded|düzelt|düzenle|gönder|aktar|taşı|iptal et|iptal ed|artır|azalt|düşür|sıfırla|tamamla|ertele|oluştur";
const IMPERATIVE = "|ın|in|un|ün|yın|yin|yun|yün|ınız|iniz|yınız|yiniz|alım|elim|yalım|yelim|sana|sene";
const REQUEST = "ar|er|ır|ir|ur|ür|r|abilir|ebilir|yabilir|yebilir";
const ACTION = new RegExp(
  `(?<!\\p{L})(?:${ACTION_STEMS})(?:(?:${IMPERATIVE})(?:\\s+(?:mı|mi))?|(?:${REQUEST})\\s+(?:mı|mi|mu|mü)(?:sın|sin|sun|sün|sınız|siniz|sunuz|sünüz))(?!\\p{L})`,
  "iu",
);

/** Bir öneri satırı → düz soru (geçersizse null) */
export function cleanFollowup(line: string): string | null {
  let q = line
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g, " ")
    .replace(/<[^>]*>?/g, " ")
    .replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/, "")
    .replace(/[*_`#>|[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, "")
    .trim();
  if (!q || q.length > FOLLOWUP_CHARS) return null;
  // Adres ya da bağlantı taşıyan satır öneri değildir (istem enjeksiyonuyla gelen bir "soruya" dokunulmasın)
  if (/:\/\/|\bwww\.|javascript:|data:|\(\/|\/panel\b/i.test(q)) return null;
  // İş yaptıran satır öneri değildir (yukarıda ACTION)
  if (ACTION.test(q.toLocaleLowerCase("tr-TR"))) return null;
  if (!/[\p{L}\p{N}]/u.test(q)) return null;
  q = q.charAt(0).toLocaleUpperCase("tr-TR") + q.slice(1);
  return q;
}

/**
 * Yanıt metni → görünen metin ve takip soruları. Son `<takip>` bloğu metinden çıkar (kapanmamışsa metnin sonuna dek
 * blok sayılır: akış sürüyordur); sonrasında metin kalırsa (kapanıştan sonra) görünen metne eklenir. `streaming`:
 * yanıt hâlâ akıyor, sondaki yarım açılış etiketi de gizlenir (bitince gizlenmez: "a <" gibi bir metin kesilmesin).
 */
export function splitFollowups(text: string, streaming = false): { body: string; followups: string[] } {
  const at = text.lastIndexOf(FOLLOWUP_OPEN);
  if (at < 0) {
    const partial = streaming ? partialOpenAt(text) : -1;
    return { body: partial >= 0 ? text.slice(0, partial).trimEnd() : text, followups: [] };
  }
  const rest = text.slice(at + FOLLOWUP_OPEN.length);
  const end = rest.indexOf(FOLLOWUP_CLOSE);
  const inner = end >= 0 ? rest.slice(0, end) : rest;
  const after = end >= 0 ? rest.slice(end + FOLLOWUP_CLOSE.length).trim() : "";
  const body = [text.slice(0, at).trimEnd(), after].filter(Boolean).join("\n\n");
  const seen = new Set<string>();
  const followups: string[] = [];
  for (const line of inner.split("\n")) {
    const q = cleanFollowup(line);
    if (!q) continue;
    const key = q.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) continue;
    seen.add(key);
    followups.push(q);
    if (followups.length >= FOLLOWUP_MAX) break;
  }
  return { body, followups };
}

/** sessionStorage / geçmişten okunan öneriler: biçimi bozuk olan düşer, yine temizlenir */
export function restoreFollowups(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.flatMap((x) => (typeof x === "string" ? [cleanFollowup(x)] : [])).filter((x): x is string => !!x).slice(0, FOLLOWUP_MAX);
  return out.length ? out : undefined;
}
