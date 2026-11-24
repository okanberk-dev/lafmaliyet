/*
 * Panel asistanının sayfa bağlamı (saf; tarayıcı ve sunucu birlikte kullanır, tests/asistan-gelismis.test.ts;
 * docs/ASISTAN.md › Sayfa bağlamı). Asistan açık olan ekranı bilir:
 *
 * - Tarayıcı her soruda açık ekranın yolunu (`/panel/kasa`) ve adresteki seçili ayı (`?ay=2026-11`) ya da günü
 *   (`?gun=2026-11-24`) gönderir (`page`); başka bir şey gitmez (sorgunun geri kalanı, #çapa, başlık yok).
 * - Sunucu bundan tek kısa satır yazar (pageContextLine) ve sistem isteminin DEĞİŞKEN bloğuna, önbellek işaretinden
 *   SONRA ekler: araçlar + sabit istem bayt bayt aynı kalır, önbellekten okunur (loop.ts › assistantParams). Şube zaten
 *   o blokta (panelin seçicisi, sunucuda okunur).
 * - Asistan boşken o ekrana özel 3–4 öneri çipi (suggestionsFor; en uzun eşleşen yol, yoksa genel liste).
 *
 * Yol yalnız panelin kendi biçimindeyse kabul edilir (küçük harf, rakam, tire; en çok 120 karakter); ekranın adı
 * menüden gelir (mobileTitleFor), istemciden gelen hiçbir metin isteme olduğu gibi yazılmaz.
 */

import { z } from "zod";

import { mobileTitleFor } from "@/components/panel/nav";

const PATH = /^\/panel(?:\/[a-z0-9-]{1,40}){0,4}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** İstekteki sayfa bilgisi (isteğe bağlı; bozuksa istek reddedilmez, alan düşer: assistantRequest) */
export const assistantPage = z
  .object({
    path: z.string().max(120).regex(PATH),
    month: z.string().regex(MONTH).optional(),
    day: z.string().regex(DAY).optional(),
  })
  .strict();

export type AssistantPage = z.output<typeof assistantPage>;

/** Tarayıcının adresinden sayfa bilgisi (yol + ?ay / ?gun); panelin dışındaysa null */
export function pageFromLocation(pathname: string, search: string): AssistantPage | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (!PATH.test(path)) return null;
  const q = new URLSearchParams(search);
  const month = q.get("ay") ?? undefined;
  const day = q.get("gun") ?? undefined;
  return { path, ...(month && MONTH.test(month) ? { month } : {}), ...(day && DAY.test(day) ? { day } : {}) };
}

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

const monthText = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const dayText = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

/**
 * Değişken bağlamın sayfa satırı: ekranın menüdeki adı ve yolu, varsa ekranda seçili ay ya da gün. Sayfa yoksa boş.
 * "Bu", "buradaki" gibi sorular bu ekranı kastedebilir; soruda başka bir dönem ya da şube geçiyorsa o geçerlidir.
 */
export function pageContextLine(page: AssistantPage | null | undefined): string {
  if (!page) return "";
  const parsed = assistantPage.safeParse(page);
  if (!parsed.success) return "";
  const p = parsed.data;
  const screen = mobileTitleFor(p.path);
  const period = [p.month ? `ekranda seçili ay: ${monthText(p.month)}` : null, p.day ? `seçili gün: ${dayText(p.day)}` : null].filter(Boolean).join(", ");
  return `Yöneticinin açık ekranı: ${screen} (${p.path})${period ? `; ${period}` : ""}. "Bu", "burada" gibi sorular bu ekranı ve dönemi kastediyor olabilir; soruda başka dönem ya da şube geçiyorsa onu kullan.`;
}

/** Ekrana özel öneriler: yol öneki → 3–4 soru. Sıra önemsiz; en uzun eşleşen önek kazanır */
export const PAGE_SUGGESTIONS: readonly { path: string; items: readonly string[] }[] = [
  { path: "/panel", items: ["Bu ay nasıl gidiyor?", "Ay sonu tahmini ne?", "Dünkü gün sonu nasıldı?", "Bekleyen ne var?"] },
  { path: "/panel/bugun", items: ["Bugün ne yapmam lazım?", "Bugün kim çalışıyor?", "Bekleyen ne var?", "Ne bitmek üzere?"] },
  { path: "/panel/kasa", items: ["Bugünkü kasa farkını açıkla", "Dün kasa tuttu mu?", "Bu hafta girilmemiş kasa günü var mı?", "Dünkü gün sonu nasıldı?"] },
  { path: "/panel/parasut", items: ["Bağlanmayı bekleyen ürünleri özetle", "En çok tekrar eden bağlanmamış ürün hangisi?", "Paraşüt eşitlemesi ne zaman çalışır?"] },
  { path: "/panel/vardiya", items: ["Bu hafta kimin vardiyası eksik?", "Bugün kim çalışıyor?", "Bu haftanın planını özetle"] },
  { path: "/panel/hatirlaticilar", items: ["Geciken ödemeler neler?", "Bu hafta ne ödemem lazım?", "Önümüzdeki 6 haftanın nakit planı nasıl?"] },
  { path: "/panel/hatirlaticilar/nakit", items: ["Önümüzdeki 6 haftanın nakit planı nasıl?", "Hangi hafta nakit sıkışır?", "Geciken ödemeler neler?"] },
  { path: "/panel/tedarikciler", items: ["En çok kime borcumuz var?", "Vadesi geçen tedarikçi borçları neler?", "Bu ay en çok kimden aldık?"] },
  { path: "/panel/faturalar", items: ["Vadesi geçen faturalar hangileri?", "Bu hafta vadesi gelen faturalar?", "En çok kime borcumuz var?"] },
  { path: "/panel/urunler", items: ["En az kâr bırakan ürünler hangileri?", "En çok kazandıran ürünler?", "Son zamlar kârı nasıl etkiledi?"] },
  { path: "/panel/urunler/fiyatlar", items: ["Fiyatı güncellenmesi gereken ürünler?", "Son zamlar kârı nasıl etkiledi?", "Kasada eski fiyatı duran ürün var mı?"] },
  { path: "/panel/hammaddeler", items: ["Son zamlar kârı nasıl etkiledi?", "Hammadde fiyatı nereden gelir?", "Ne bitmek üzere?"] },
  { path: "/panel/satislar", items: ["Dün en çok ne sattı?", "Bu hafta en çok satanlar?", "Hafta içi ve hafta sonu satışı nasıl?"] },
  { path: "/panel/sayim", items: ["Ne bitmek üzere?", "Tahmini stokta kritik malzemeler?", "Tahmini stok nasıl hesaplanıyor?"] },
  { path: "/panel/zayi", items: ["Dünkü ikram ve zayi ne kadar?", "Zayi ile ikram farkı ne?", "Zayi nasıl kaydedilir?"] },
  { path: "/panel/gelir-gider", items: ["Bu ay kâr nasıl?", "Giderler geçen aya göre nasıl?", "Başabaş için ne kadar ciro lazım?"] },
  { path: "/panel/onaylar", items: ["Onay bekleyen ne var?", "Bugün ne yapmam lazım?", "Bekleyen ne var?"] },
];

/** Ekranın eşleşmediği yerde (ya da sayfa bilinmezken) */
export const DEFAULT_SUGGESTIONS: readonly string[] = ["Dünkü gün sonu nasıldı?", "Bugün kim çalışıyor?", "Bu ay nasıl gidiyor?", "Bekleyen ne var?"];

/** Açık ekranın önerileri: en uzun eşleşen yol (alt sayfa da: /panel/urunler/12 → Ürünler); "/panel" yalnız tam eşleşir */
export function suggestionsFor(pathname: string | null | undefined): readonly string[] {
  if (!pathname) return DEFAULT_SUGGESTIONS;
  const path = pathname.length > 1 ? pathname.replace(/[?#].*$/, "").replace(/\/+$/, "") : pathname;
  let best: (typeof PAGE_SUGGESTIONS)[number] | null = null;
  for (const s of PAGE_SUGGESTIONS) {
    const hit = s.path === "/panel" ? path === "/panel" : path === s.path || path.startsWith(`${s.path}/`);
    if (hit && (!best || s.path.length > best.path.length)) best = s;
  }
  return best?.items ?? DEFAULT_SUGGESTIONS;
}
