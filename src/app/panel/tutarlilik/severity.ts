import type { Tone } from "@/components/ui/badge";

/**
 * Reçete ↔ fatura oranının önem derecesi. Sunucu sayfası (metrik satırı) ile istemci tablosu (rozet, filtre)
 * aynı eşikleri kullansın diye ayrı, "use client" olmayan bir dosyada.
 *
 * Yeşil < 1,15× tutarlı · turuncu 1,15–1,5× stok ya da fire olabilir · kırmızı > 1,5× kontrol edilmeli.
 * Ayda hiç kullanılmadığı hâlde alım girilmişse (oran hesaplanamaz) de kırmızı sayılır.
 */
export const RATIO_WARN = 1.15;
export const RATIO_BAD = 1.5;

export type Severity = "big" | "diff" | "ok" | "none";

export function severityOf(r: { usage: number; purchased: number | null; ratio: number | null; held?: unknown; rejected?: unknown }): Severity {
  // Çarpanı onay bekleyen ya da fiyatı reddedilen faturası alınana girmeyen malzemede alınan eksik: derece verilmez
  if (r.purchased === null || r.held || r.rejected) return "none";
  if (r.ratio === null) return r.purchased > 0 && !r.usage ? "big" : "ok";
  if (r.ratio > RATIO_BAD) return "big";
  if (r.ratio >= RATIO_WARN) return "diff";
  return "ok";
}

/**
 * Her derecenin rozet tonu, şerit rengi (anlamsal belirteç) ve metni. Renk tek başına anlam taşımaz:
 * rozet ve lejant her zaman `range` ya da `label` metniyle birlikte çizilir.
 */
export const SEVERITY: Record<Exclude<Severity, "none">, { label: string; range: string; hint: string; tone: Tone; bar: string }> = {
  ok: { label: "Tutarlı", range: "< 1,15×", hint: "tutarlı", tone: "green", bar: "bg-good" },
  diff: { label: "Fark var", range: "1,15–1,5×", hint: "stok veya fire olabilir", tone: "amber", bar: "bg-warn" },
  big: { label: "Büyük fark", range: "> 1,5×", hint: "reçete, fire ya da ikram kontrol edilmeli", tone: "red", bar: "bg-bad" },
};

/** Oranı okuma rehberi (lejant ve ipuçlarında aynı cümleler) */
export const RATIO_GUIDE = {
  below1: "1×'in altı = alınandan fazla kullanıldı; önceki ayın stoğundan harcanmış.",
  bottles: "Büyük şişeli sos, püre ve şuruplar birkaç ay yettiği için tek aylık oranları yüksek çıkabilir.",
  fastMovers: "Asıl bakılacaklar hızlı tükenenler: espresso, süt, dondurma, tatlılar, şişe su.",
};

/** Tablo satırının stok karşılaştırması (insights.consistency ile aynı adlar) */
export type StockCheck = "complete" | "needsPurchase" | "held" | "rejected" | "noCount";

export interface ScopeRow {
  purchased: number | null;
  stock: StockCheck;
  varianceAmount: number | null;
  diffAmount: number | null;
  /** Bu ayın çarpanı onay bekleyen faturaları (alınana girmedi) */
  held?: { invoices: number } | null;
  /** Bu ayın fiyatı reddedilen faturaları (alınana girmedi; alım elle yazılır) */
  rejected?: { invoices: number } | null;
}

/**
 * Tablonun varsayılan kapsamı: alımı girilen, iki ayı sayılan ya da alınana girmeyen (çarpanı onay bekleyen, fiyatı
 * reddedilen) faturası olan malzemeler (karşılaştırılacak ya da bakılacak bir şeyi olanlar). Hiçbiri yoksa bütün
 * satırlar. `hidden` = yalnızca reçete kullanımı olan, "Alımı girilmeyenler" ile açılan satırlar. Sapma toplamı
 * yalnızca stok karşılaştırması tamam olan satırlardan gelir; bu yüzden varsayılan alt toplam sayfadaki "Sayım
 * sapması" ile aynıdır.
 */
export function tableScope<T extends ScopeRow>(rows: T[], showAll: boolean): { scope: T[]; focus: T[]; hidden: number } {
  const focus = rows.filter((r) => r.purchased !== null || r.stock !== "noCount" || Boolean(r.held) || Boolean(r.rejected));
  const scope = showAll || !focus.length ? rows : focus;
  return { scope, focus, hidden: rows.length - focus.length };
}

/** Görünen satırların fark ve sapma toplamı (boş değerler 0) */
export function scopeTotals(rows: ScopeRow[]): { diff: number; variance: number } {
  return {
    diff: rows.reduce((a, r) => a + (r.diffAmount ?? 0), 0),
    variance: rows.reduce((a, r) => a + (r.stock === "complete" ? (r.varianceAmount ?? 0) : 0), 0),
  };
}
