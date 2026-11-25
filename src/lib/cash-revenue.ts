/**
 * Günün cirosu: Z toplamından ödenmez / ikramı ayırma kuralı (saf; tests/odenmez-ciro.test.ts).
 *
 * **Sorun.** Panelin ay cirosu (`posRevenue`) günlerin Z toplamının toplamıdır ve sözleşmesi "KDV dahil, indirimler
 * düşülmüş, **ödenmezler hariç** (Patron › Ciro ile aynı anlam)" der (src/lib/calc/types.ts TillMonth.posRevenue,
 * Genel bakış'ın POS cirosu kartı, dışa aktarım). Oysa kasanın Z toplamı ödenmez / ikramı (sahip ve personel
 * tüketimi, hediye, zayi) satış olarak içerir: ödenmez da bir "ödeme türü"dür, yalnız ciroya dahil değildir. O yüzden
 * ayın cirosu ModPOS'un Patron › Raporlar › Ciro rakamından ödenmez kadar fazla çıkıyordu (Ekim 2026: ModPOS 588 bin,
 * panel 600 bin). Burada o fark kapanır: ciro = Z toplamı − (Z toplamının içindeki ödenmez).
 *
 * **Ödenmez Z toplamının içinde mi?** Günün ödeme dökümü bunu kanıtlar. Ciroya dahil ödeme türlerinin toplamı
 * (nakit + kart + yemek kartı + online + diğer; ödenmez / ikram hiçbirine girmez, src/lib/modpos/z.ts modposBucket):
 *
 * | Ödemelerin toplamı | Anlamı | Ciro |
 * |---|---|---|
 * | Z toplamı − ödenmez | Z toplamı ödenmezi İÇERİYOR | Z toplamı − ödenmez |
 * | Z toplamı | Z toplamı ödenmezi içermiyor (zaten hariç) | Z toplamı |
 * | İkisini de tutmuyor | Gün kendi içinde tutmuyor: tahmin yürütülmez | Z toplamı (bugünkü davranış) |
 *
 * Döküm tutmayan gün için uydurmak yerine bugünkü değer bırakılır: o gün zaten "ödemelerin toplamı ciroyu tutmuyor"
 * uyarısı verir (src/lib/cash-report-checks.ts, src/lib/modpos/ayarlar.ts modposDayWarnings) ve düzeltilmesi istenir.
 * Kural üç kaynağın hepsinde aynı çalışır: elle girilen kasa raporu, LafPOS gün sonu ve ModPOS kasa föyü.
 *
 * Ayrıntı: docs/KASA-RAPORU.md › Ciro ve ödenmez, docs/MODPOS-API.md › Eşleme.
 */

/** Ödemelerin Z toplamını "tuttuğu" sayılan en büyük fark (TL; src/lib/cash-report.ts CASH_TOLERANCE ile aynı) */
export const REVENUE_TOLERANCE = 1;

export interface DayRevenueInput {
  /** Z raporunun toplam satışı (KDV dahil) */
  zTotal: number;
  /** Ödenmez / ikram (ciro dışı); girilmediyse null */
  offRevenue: number | null;
  /**
   * Ciroya dahil ödeme türlerinin toplamı (nakit + kart + yemek kartı + online + diğer). Bilinmiyorsa null: o gün
   * ödenmezin Z toplamının içinde olduğu kanıtlanamaz, Z toplamı olduğu gibi ciro sayılır
   */
  payments: number | null;
}

export interface DayRevenue {
  /** Günün cirosu: ödenmez / ikram hariç, KDV dahil */
  revenue: number;
  /** Z toplamından düşülen ödenmez (0: Z toplamı zaten hariçti ya da döküm kanıtlamıyor) */
  offInZTotal: number;
  /** Ödeme dökümü Z toplamının ödenmezi içerdiğini kanıtlıyor mu */
  included: boolean;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Ödemelerin toplamı hedefi tutuyor mu (1 TL'den küçük fark) */
const fits = (payments: number, target: number) => Math.abs(r2(payments - target)) < REVENUE_TOLERANCE;

/**
 * Günün cirosu ve Z toplamından düşülen ödenmez. Ödenmez girilmemiş (null) ya da 1 TL'den küçükse, ödeme dökümü
 * bilinmiyorsa ya da döküm iki okumadan hiçbirini tutmuyorsa Z toplamı olduğu gibi döner.
 */
export function dayRevenue(r: DayRevenueInput): DayRevenue {
  const off = r.offRevenue === null ? 0 : Math.max(0, r.offRevenue);
  const none = { revenue: r2(r.zTotal), offInZTotal: 0, included: false };
  if (off < REVENUE_TOLERANCE || r.payments === null) return none;
  // Döküm Z toplamını tutuyorsa ödenmez dışarıdadır; yalnız "Z toplamı − ödenmez"i tutuyorsa içindedir
  if (fits(r.payments, r.zTotal) || !fits(r.payments, r.zTotal - off)) return none;
  return { revenue: r2(r.zTotal - off), offInZTotal: r2(off), included: true };
}
