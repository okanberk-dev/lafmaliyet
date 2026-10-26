/**
 * Stok sayımı › "Listeye ekle": sayım listesine yeni kalem (yönetici ve personel). Kalem bir hammaddedir; paket fiyatı
 * isteğe bağlıdır: yazılmazsa 0, yazılırsa o; ikisinde de "Tahmini" açılır, yönetici Hammaddeler'den doğrular. Reçete
 * önerisindeki "Yeni malzeme" de aynı kuralla kalem açar. Saf kurallar: ad anahtarı (Türkçe büyük/küçük harf), aynı ad
 * denetimi, sayım biriminden malzeme birimi, grubun varsayılan kategori ve KDV'si, yazılan tutarın okunması, kalemin
 * yazılacak değerleri ve notu, personelin ay kuralı, zildeki "fiyatı girilmemiş" metni. Ortak sunucu çekirdeği
 * (src/server/data/count-item.ts), iki eylem, sayım formu ve tests/sayim-ekle.test.ts aynı kuralı kullanır; burada
 * veritabanı ya da tarayıcı yok.
 */

import { parseNumberTR } from "./calc/expr";
import type { CountUnit, Unit } from "./calc/types";
import { money, monthLabel, num } from "./format";

/** Kayıtlı ad: baştaki / sondaki boşluk gider, aradaki boşluklar teke iner */
export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * Aynı ad denetiminin anahtarı: Türkçe küçük harf (İ → i, I → ı) ve boşluklar sadeleşir. Türkçe olmayan klavyede
 * yazılan "VANILYA" da "Vanilya" ile aynı sayılsın diye ı da i'ye iner (anlamı ı/i farkıyla ayrılan iki kalem yok);
 * düzeltme işareti de sayılmaz (telefon klavyesinde â yok gibidir: "kase 12oz" = "Kâse 12oz").
 * Migration'daki SQL karşılığı: lower(translate(ad, 'ÇĞİIÖŞÜıÂÎÛâîû', 'çğiiöşüiaiuaiu')) (drizzle/*_sayim_yeni_kalemler.sql).
 */
export function nameKey(name: string): string {
  return cleanName(name).toLocaleLowerCase("tr-TR").replace(/ı/g, "i").replace(/â/g, "a").replace(/î/g, "i").replace(/û/g, "u");
}

/**
 * Benzer ad anahtarı: nameKey'e ek olarak Türkçe harfler de sadeleşir (ç→c, ş→s, ğ→g, ö→o, ü→u). Türkçe olmayan
 * klavyede yazılan "cilek surubu" listedeki "Çilek şurubu"dur: aynı ad denetimi ve reçetedeki malzeme araması bununla
 * karşılaştırır, ikinci bir kalem açılmaz. nameKey migration'ın SQL anahtarıyla aynı kalır (sayim_yeni_kalemler).
 */
export function looseKey(name: string): string {
  return nameKey(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export const COUNT_ITEM_NAME_MIN = 2;
export const COUNT_ITEM_NAME_MAX = 120;

/**
 * Elektronik tablonun formül ya da bağlantı diye çalıştırdığı başlangıç (=, +, -, @). Personelin yazdığı ad ve paket
 * bilgisi Hammaddeler'in ve Ürünler'in CSV'sine olduğu gibi gider; Excel böyle başlayan hücreyi açınca çalıştırır.
 * Sayımda "Listeye ekle" ve yeni ürün önerisi bunu kabul etmez.
 */
export function startsLikeFormula(text: string): boolean {
  return /^[=+\-@]/.test(text.trim());
}

/** "Ad =, +, - ya da @ ile başlayamaz" */
export const formulaStartMessage = (label: string) => `${label} =, +, - ya da @ ile başlayamaz`;

/** Sayım biriminden malzemenin kendi birimi (stok değeri ve reçete bu birimle hesaplanır) */
export const BASE_UNIT: Record<CountUnit, Unit> = { KG: "gr", LT: "ml", ADET: "adet", "DİLİM": "dilim" };

/** Paket içeriğinin önerilen değeri: KG ve LT'de 1000 (gr / ml), ADET ve DİLİM'de 1 */
export function defaultPackageSize(countUnit: CountUnit): number {
  return countUnit === "KG" || countUnit === "LT" ? 1000 : 1;
}

export interface ExistingIngredient {
  name: string;
  active: boolean;
  countUnit: string | null;
  /** Sayım listesine girdiği ay (ingredients.count_from); boşsa her ayda */
  countFrom?: string | null;
}

/** counted: aktif ve sayım listesinde; uncounted: aktif ama "Sayılmaz"; inactive: pasif */
export type CountItemDuplicate = { kind: "counted" | "uncounted" | "inactive"; name: string };

/**
 * Aynı adlı hammadde (anahtar eşleşmesi). Birden çok eşleşme varsa sayım listesindeki önce, sonra aktif, en son pasif
 * olan döner (kullanıcıya en işe yarar yönlendirme).
 */
export function findDuplicate(name: string, existing: ExistingIngredient[]): CountItemDuplicate | null {
  const key = looseKey(name);
  const same = existing.filter((e) => looseKey(e.name) === key);
  const counted = same.find((e) => e.active && e.countUnit);
  if (counted) return { kind: "counted", name: counted.name };
  const active = same.find((e) => e.active);
  if (active) return { kind: "uncounted", name: active.name };
  return same[0] ? { kind: "inactive", name: same[0].name } : null;
}

/**
 * Sayım listesinde olan ama `from` ayından sonraki bir aydan itibaren çıkan aynı adlı kalem (count_from). "Listeye
 * ekle" onu yeniden açmaz, `from` ayından itibaren de listeye alır (ör. Ekim'de eklenen şurup Eylül sayımına da girsin).
 */
export function laterCountItem<T extends ExistingIngredient>(name: string, existing: T[], from: string): T | undefined {
  const key = looseKey(name);
  return existing.find((e) => e.active && e.countUnit && e.countFrom && e.countFrom > from && looseKey(e.name) === key);
}

/** Aynı ad bulununca gösterilen metin; yönetici ne yapacağını, personel kime yazacağını okur */
export function duplicateMessage(dup: CountItemDuplicate, role: "admin" | "staff"): string {
  const n = `“${dup.name}”`;
  if (dup.kind === "counted") return `${n} zaten sayım listesinde.`;
  if (dup.kind === "uncounted")
    return role === "admin" ? `${n} hammaddelerde var ama sayılmıyor; Hammaddeler'den sayım birimini seçin.` : `${n} hammaddelerde var ama sayılmıyor; yöneticiye yazın.`;
  return role === "admin" ? `${n} pasif; Hammaddeler'den yeniden açabilirsiniz.` : `${n} pasif; yönetici Hammaddeler'den yeniden açabilir.`;
}

export const COUNT_ITEM_FALLBACK_CATEGORY = "Diğer";
/** ingredients.vat_rate sütununun varsayılanı (%1) */
export const COUNT_ITEM_FALLBACK_VAT = 0.01;

/** En sık değer; eşitlikte listede önce gelen (çağıran sayım sırasıyla verir) */
function mostCommon<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  let best: T | undefined;
  let bestN = 0;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

/**
 * Yeni kalemin kategorisi ve Alış KDV'si: sayım grubundaki (önce aktif) malzemelerin en sık kategorisi ve oranı;
 * grupta malzeme yoksa "Diğer" ve %1. Yönetici sonra Hammaddeler'den değiştirebilir.
 */
export function groupDefaults(
  rows: { countGroup: string | null; category: string; vatRate: number; active: boolean }[],
  group: string,
): { category: string; vatRate: number } {
  const inGroup = rows.filter((r) => r.countGroup === group);
  const pool = inGroup.some((r) => r.active) ? inGroup.filter((r) => r.active) : inGroup;
  return {
    category: mostCommon(pool.map((r) => r.category)) ?? COUNT_ITEM_FALLBACK_CATEGORY,
    vatRate: mostCommon(pool.map((r) => r.vatRate)) ?? COUNT_ITEM_FALLBACK_VAT,
  };
}

/**
 * "Listeye ekle"deki grup seçenekleri, sayım listesindeki sırayla (`order`), her grubun olağan sayım birimiyle
 * (gruptaki aktif sayılan kalemlerin en sık birimi; pencere bu birimle açılır). Hiçbir hammaddede yazılı olmayan grup
 * (sayım grubu boş kalemlerin toplandığı "DİĞER") seçilemez: sunucu yalnız var olan grubu kabul eder.
 */
export function countGroupOptions(
  order: string[],
  rows: { countGroup: string | null; countUnit: CountUnit | null; active: boolean }[],
): { name: string; unit: CountUnit }[] {
  return order.flatMap((name) => {
    const inGroup = rows.filter((r) => r.countGroup === name);
    if (!inGroup.length) return [];
    const units = inGroup.filter((r) => r.active && r.countUnit).map((r) => r.countUnit as CountUnit);
    return [{ name, unit: mostCommon(units) ?? "ADET" }];
  });
}

/** Kalemin yeni sırası: bütün malzemelerin en büyük sırasından sonra (sayım listesinde grubunun sonuna düşer) */
export function nextSortOrder(rows: { sortOrder: number }[]): number {
  return rows.reduce((m, r) => Math.max(m, r.sortOrder), 0) + 1;
}

/**
 * Kalemin sayım listesine girdiği ay (ingredients.count_from): eklenirken gösterilen ay (ayın ilk günlerinde geçen ayın
 * sayımına eklendiyse geçen ay). İleri bir ayın sayımında eklense de bu aydan: bugünkü listede görünsün. Daha önceki
 * aylarda, o ay sayılmadıysa listede çıkmaz (engine.stockSheet).
 */
export function countFromMonth(month: string, current: string): string {
  return month < current ? month : current;
}

/**
 * Hammaddeler'de sayım listesine giren kalemin count_from'u: yeni hammadde sayım birimiyle açıldı, "Sayılmaz" kaleme
 * sayım birimi verildi ya da pasif kalem yeniden aktif oldu. Bu aydan (daha ileri bir aydan itibaren çıkıyorsa o ay):
 * boş kalsaydı sayımı bitmiş her geçmiş ay "yarım" görünür, sayım ekranı ve hatırlatmalar kapanmış aya giderdi. O ay
 * sayılmış geçmiş aylarda kalem yine çıkar (engine.stockSheet). Geçen ayın sayımına da girecekse "Listeye ekle" o aydan
 * itibaren listeye alır.
 */
export function listedFromMonth(before: string | null, current: string): string {
  return before && before > current ? before : current;
}

// ---------------------------------------------------------------- Yazılan tutar

/** Okunan tutar: boşsa `value` null ve hata yok; okunamayan ya da sınır dışı tutarda `error` */
export interface MoneyRead {
  value: number | null;
  error: string | null;
}

/**
 * Personelin yazdığı tutar (satış fiyatı, paket fiyatı): boş bırakılabilir; Türkçe ("1.250,50") ya da noktalı
 * ("1250.5") yazılır, kuruşa yuvarlanır. Yüzde işareti tutar değildir. `label` yalın ("Satış fiyatı"), `accusative`
 * belirtme hâlinde ("Satış fiyatını") verilir.
 */
export function readMoneyText(text: string, field: { label: string; accusative: string; max: number }): MoneyRead {
  const t = text.trim();
  if (!t) return { value: null, error: null };
  const parsed = t.includes("%") ? null : parseNumberTR(t);
  if (parsed === null) return { value: null, error: `${field.accusative} sayıyla yazın` };
  const value = Math.round(parsed * 100) / 100;
  if (!(value > 0)) return { value: null, error: `${field.label} 0'dan büyük olmalı` };
  if (value > field.max) return { value: null, error: `${field.label} çok büyük` };
  return { value, error: null };
}

/** "Listeye ekle"de yazılan paket fiyatının üst sınırı (KDV hariç; fazladan yazılan sıfırlar burada durur) */
export const COUNT_ITEM_PRICE_MAX = 1_000_000;

/** "Paket fiyatı (₺, biliyorsanız)": boş bırakılabilir */
export function readPackagePrice(text: string): MoneyRead {
  return readMoneyText(text, { label: "Paket fiyatı", accusative: "Paket fiyatını", max: COUNT_ITEM_PRICE_MAX });
}

// ---------------------------------------------------------------- Kalemin yazılacak değerleri

/** Kalem nereden eklendi: Stok sayımı › Listeye ekle ya da reçete önerisindeki "Yeni malzeme" */
export type CountItemSource = "sayim" | "recete";

/**
 * Kalemin notu (Hammaddeler'de ve Tahmini dökümünde okunur): kim, ne zaman, nereden ekledi; paket fiyatını yazdıysa
 * kimin yazdığı (yönetici neyi doğrulayacağını bilsin). `date`: "23.10.2026".
 * "Sayım listesine Ayşe ekledi (23.10.2026); paket fiyatını personel KDV dahil yazdı, KDV düşülüp kaydedildi."
 */
export function countItemNote(by: string, date: string, opts: { pricedBy?: "admin" | "staff" | null; source?: CountItemSource } = {}): string {
  const base = `Sayım listesine ${by} ekledi (${date}${opts.source === "recete" ? ", reçete önerisinden" : ""})`;
  if (!opts.pricedBy) return `${base}.`;
  return opts.pricedBy === "admin" ? `${base}; paket fiyatını yönetici yazdı.` : `${base}; paket fiyatını personel KDV dahil yazdı, KDV düşülüp kaydedildi.`;
}

/** Formdan gelen kalem (sunucuda doğrulanmış) */
export interface CountItemDraft {
  name: string;
  group: string;
  countUnit: CountUnit;
  packageDesc: string | null;
  packageSize: number;
  /** Yazılmadıysa null: paket fiyatı 0 açılır */
  packagePrice: number | null;
}

/**
 * Hammaddelerde paket fiyatı KDV hariçtir. Personel fişteki ya da etiketteki fiyatı (KDV dahil) yazar: grubun KDV
 * oranıyla düşülür (120 ₺, %20 → 100 ₺). Yönetici Hammaddeler'deki gibi KDV hariç yazar. Yazılmadıysa 0.
 */
export function netPackagePrice(typed: number | null, vatRate: number, includesVat: boolean): number {
  if (typed === null) return 0;
  if (!includesVat || !(vatRate > 0)) return typed;
  return Math.round((typed / (1 + vatRate)) * 100) / 100;
}

/**
 * Yeni kalemin hammaddeler tablosuna yazılacak değerleri. Paket fiyatı yazıldıysa o, yazılmadıysa 0 (zil "Fiyatı
 * girilmemiş" der); iki durumda da "Tahmini" ve elle fiyatlı açılır, yönetici ya da ilk fatura doğrular. Yazılan fiyat
 * fiyat geçmişinin başlangıcıdır (countItemPriceRow; zam uyarısı onu taban saymaz); yöneticinin düzeltmesi kalem
 * Tahmini iken onun yerine geçer (correctsCountItemStart). Kategori ve KDV grubun en sık değerinden, sıra en sonda
 * (sayım listesinde grubunun sonuna düşer), listeye `from` ayından itibaren girer.
 */
export function newCountItemValues(
  draft: CountItemDraft,
  rows: { countGroup: string | null; category: string; vatRate: number; active: boolean; sortOrder: number }[],
  from: string,
  note: string,
  opts: { priceIncludesVat?: boolean } = {},
) {
  const defaults = groupDefaults(rows, draft.group);
  return {
    name: draft.name,
    category: defaults.category,
    supplier: null,
    packageDesc: draft.packageDesc,
    packagePrice: netPackagePrice(draft.packagePrice, defaults.vatRate, opts.priceIncludesVat ?? false),
    packageSize: draft.packageSize,
    unit: BASE_UNIT[draft.countUnit],
    vatRate: defaults.vatRate,
    note,
    isEstimate: true,
    priceSource: "manual" as const,
    countUnit: draft.countUnit,
    countGroup: draft.group,
    countFrom: from,
    sortOrder: nextSortOrder(rows),
    active: true,
  };
}

/**
 * Listeye fiyatıyla eklenen kalemin fiyat geçmişindeki başlangıç satırının notu. Zam uyarısı bu satırı taban saymaz
 * (price-impact.ts ingredientChanges): yazılan tahmin taban olsaydı ilk gerçek fiyat zam ya da indirim gibi görünürdü.
 * Sekiz kalemin migration'ındaki satırlardan ("Sayım listesine eklendi (tahmini fiyat)") ayrı: onlar taban kalır.
 */
export const COUNT_ITEM_PRICE_NOTE = "Sayım listesine eklenirken yazılan fiyat (tahmini)";

/**
 * Kalem fiyatıyla açılınca fiyat geçmişine yazılacak başlangıç satırı; fiyat yazılmadıysa (0) null. Geçmişi olmayan
 * kalemin kapanmış ayları ilk geçmiş satırının fiyatıyla değerlenir (engine.ts unitCostAtMonthEnd): satır olmasa
 * sonraki ilk zam (fatura, elle) kapanmış ayın devreden malını ve kârını değiştirirdi. Fiyatsız kalemin ilk gerçek
 * fiyatı önceki ayları da değerler.
 */
export function countItemPriceRow(ingredientId: number, values: { packagePrice: number; packageSize: number }, changedBy: string) {
  if (!(values.packagePrice > 0)) return null;
  return { ingredientId, packagePrice: values.packagePrice, packageSize: values.packageSize, changedBy, note: COUNT_ITEM_PRICE_NOTE };
}

/**
 * Yöneticinin düzelttiği başlangıç satırının notu. Düzeltilen fiyat doğrulanmış fiyattır: zam uyarısının tabanı olur
 * (COUNT_ITEM_PRICE_NOTE gibi atlanmaz), sonraki zam görünür.
 */
export const COUNT_ITEM_PRICE_FIXED_NOTE = "Sayım listesine eklenirken yazılan fiyat (düzeltildi)";

/**
 * Hammaddeler'de girilen fiyat (ya da paket içeriği) başlangıç satırını düzeltir mi: kalem hâlâ "Tahmini" ve fiyat
 * geçmişinde yalnız başlangıç satırı var (yazılan tahmin ya da onun düzeltmesi). Öyleyse yeni satır açılmaz, başlangıç
 * satırı yerinde düzelir (anı kalır): kalemin eklendiği kapanmış ay da düzeltilen fiyatla değerlenir (engine.ts
 * unitCostAtMonthEnd ilk satırdan önceki ayları ilk satırla değerler); yeni satır olsaydı o ay hep tahminde kalırdı.
 * Doğrulanmış kalemde ya da geçmişinde başka satır varken yeni satır (zam: kapanmış aya dokunmaz). Paraşüt faturası
 * bu yoldan geçmez: tarihli fiyattır, hep yeni satır.
 */
export function correctsCountItemStart(isEstimate: boolean, history: readonly { note: string | null }[]): boolean {
  return isEstimate && history.length === 1 && (history[0].note === COUNT_ITEM_PRICE_NOTE || history[0].note === COUNT_ITEM_PRICE_FIXED_NOTE);
}

/** Düzeltilen başlangıç satırının yeni değerleri (anı kalır) */
export function correctedCountItemStart(values: { packagePrice: number; packageSize: number }, changedBy: string) {
  return { packagePrice: values.packagePrice, packageSize: values.packageSize, changedBy, note: COUNT_ITEM_PRICE_FIXED_NOTE };
}

/**
 * İşlem geçmişi satırı: "Çilek şurubu · SOS / ŞURUP / PÜRE · LT · paket fiyatı 760 ₺ (tahmini)"; reçete önerisinden
 * eklendiyse sonuna "reçete önerisinden"; kalem zaten vardıysa (daha sonraki bir aydan itibaren listedeydi) hangi aydan
 * itibaren listede olduğu.
 */
export function countItemLogDetail(item: {
  name: string;
  group: string;
  countUnit: string;
  existed: boolean;
  from: string;
  packagePrice: number | null;
  source?: CountItemSource;
}): string {
  const parts = item.existed
    ? [item.name, `${monthLabel(item.from)} sayımından itibaren`]
    : [item.name, item.group, item.countUnit, item.packagePrice !== null ? `paket fiyatı ${money(item.packagePrice)} (tahmini)` : null];
  if (item.source === "recete") parts.push("reçete önerisinden");
  return parts.filter(Boolean).join(" · ");
}

/**
 * Fiyatı girilmemiş hammadde: aktif, fiyatı elle girilen (su ve buz su faturasından gelir) ve paket fiyatı 0.
 * Zil ve Hammaddeler'deki "Fiyat yok" süzgeci bu kuralı kullanır (zilin SQL'i: src/server/data/unpriced.ts).
 */
export function isUnpriced(i: { active: boolean; priceSource: string; packagePrice: number }): boolean {
  return i.active && i.priceSource === "manual" && i.packagePrice === 0;
}

/** Zil: "Fiyatı girilmemiş 2 hammadde" / "Çilek şurubu, Böğürtlen püre · Hammaddeler'den paket fiyatını girin." */
export function unpricedNotice(count: number, names: string[], max = 3): { title: string; body: string } {
  const shown = names.slice(0, max);
  const rest = count - shown.length;
  const list = rest > 0 ? `${shown.join(", ")} ve ${num(rest)} hammadde daha` : shown.join(", ");
  return { title: `Fiyatı girilmemiş ${num(count)} hammadde`, body: `${list} · Hammaddeler'den paket fiyatını girin.` };
}
