import { parasutKey } from "@/lib/parasut/accounts";

/*
 * Paraşüt'ün integration_state anahtarları (docs/PARASUT.md). Şube başına Paraşüt hesabı (src/lib/parasut/accounts.ts):
 * hesabın eşitleme durumu hesap adıyla saklanır (`parasutKey`): varsayılan hesapta eski ad, öbürlerinde `<ad>:<hesap>`.
 * İşletme geneli olanlar (yok sayılan ve silinen faturalar, ürün fiyatı işaretleri, hammadde değil listesi) tek kayıttır;
 * yok sayılan faturanın anahtarı hesabıyla öneklenir (qualifyBillKey).
 */

/** Hesap başına: gider faturası imleci (son fatura tarihi) */
export const CURSOR_KEY = "parasut.cursor";
/** İşletme geneli: ürün bağlantısının fiyatı uygulandı işaretleri (applyProductLinks) */
export const PRICE_KEY = "parasut.prices";
/** Hesap başına: yarım turun kalınan sayfası */
export const RESUME_KEY = "parasut.resume";
/** Hesap başına: Paraşüt kişi kimliği → ad önbelleği (kişi kimlikleri hesabın) */
export const CONTACTS_KEY = "parasut.contacts";
/** Hesap başına: içeri alınmamış e-faturaların sayısı */
export const PENDING_KEY = "parasut.pendingEInvoices";
/** Hesap başına: gelen e-faturaların imleci (son e-fatura tarihi); gider faturalarınınkinden ayrı */
export const E_CURSOR_KEY = "parasut.eInvoiceCursor";
/**
 * Hesap başına: ödenmemiş Paraşüt faturalarının Paraşüt'teki son vadesi (dış kimlik → vade): panelde ertelenen vade,
 * Paraşüt'teki vade değişmedikçe eşitlemede ezilmesin (syncedDueDate)
 */
export const DUE_KEY = "parasut.dueDates";
/** İşletme geneli: panelde silinen Paraşüt faturaları (bir sonraki eşitlemede geri gelmesin; anahtar hesapla önekli) */
export const IGNORE_KEY = "parasut.ignore";
/** Hesap başına: tedarikçi geçmişinin kaldığı yer: Paraşüt kişi kimliği → sonraki çalışmanın okuyacağı sayfa */
export const HISTORY_KEY = "parasut.supplierHistory";
/**
 * Hesap başına: geç girilen faturalar: görülmüş en büyük gider faturası kimliği ve bitmemiş taramanın yeri
 * (late-bills.ts). Paraşüt kimlikleri artarak verilir; tarihi eski ama yeni girilmiş fatura (kâğıt fatura, KDV'si
 * sonraki yıl sonuna kadar indirilebilir) 75 günlük pencerenin dışında kalsa da kimliği büyüktür (catchLateBills)
 */
export const LAST_BILL_KEY = "parasut.lastBillId";
/** Hesap başına: eski faturaların vergi nosu tamamlamasının kaldığı yer (tax-backfill.ts) */
export const TAX_BACKFILL_KEY = "parasut.taxBackfill";
/** Hesap başına: panele girmeyen iadeler (returns.ts) */
export const RETURNS_KEY = "parasut.returns";
/** Hesap başına: belgesi geçici hatayla alınamayan e-faturaların deneme sayısı (lines.ts; fatura kimliğiyle) */
export const UBL_RETRY_KEY = "parasut.ublRetries";
/** İşletme geneli: "hammadde değil" işaretlenen ürünler */
export const PRODUCT_IGNORE_KEY = "parasut.productIgnore";
/** İşletme geneli: "hep hammadde değil" kuralı açık tedarikçiler (src/lib/product-ignore.ts IgnoredSupplier) */
export const SUPPLIER_IGNORE_KEY = "parasut.supplierIgnore";

/** Eşitlemenin kendi durumu; "Oturumu sıfırla" ve firma değişimi bunları siler (vergi no tamamlaması da baştan başlar) */
export const PARASUT_STATE_KEYS = [CURSOR_KEY, RESUME_KEY, PENDING_KEY, E_CURSOR_KEY, HISTORY_KEY, LAST_BILL_KEY, TAX_BACKFILL_KEY];

/** Hesabın sıfırlanacak durum anahtarları ("Oturumu sıfırla", firma değişimi) */
export const parasutStateKeys = (account: string) => PARASUT_STATE_KEYS.map((k) => parasutKey(k, account));

/**
 * Hesabın bütün kayıtları: şube başka şubenin hesabına bağlanınca silinir (oturum ve bağlanma isteği ayrıca). Ödeme
 * takibinin başlangıcı (payments.since, src/server/data/suppliers.ts) da hesap başına
 */
export const parasutAccountKeys = (account: string) =>
  [...PARASUT_STATE_KEYS, CONTACTS_KEY, DUE_KEY, RETURNS_KEY, UBL_RETRY_KEY, "parasut.settings", "payments.since"].map((k) => parasutKey(k, account));
