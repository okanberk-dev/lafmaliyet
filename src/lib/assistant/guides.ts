/*
 * Asistanın YAPMADIĞI işlerin rehberi (saf; docs/ASISTAN-ISLEMLER.md › Rehber konuları ve Hariç;
 * tests/asistan-islemleri.test.ts). Riskli, silmeli, toplu, şifre onayı isteyen ya da asistanın hiç önermediği
 * (hariç) işlerde asistan işi kendisi yapmaya çalışmaz: "şu ekrana gidin, şunu yapın" der, ekranın bağlantısını ve kısa
 * adımları verir. Bu liste `islem_rehberi` aracının tek kaynağıdır. Her girdi yapılandırılmıştır: konu, neden asistanın
 * yapmadığı, panel yolu (gerçek bir ekran; testte src/app/panel altındaki sayfayla ve # bölümünün kaynaktaki kimliğiyle
 * karşılaştırılır) ve adım adım yönerge. `actions` geliştiricinin izidir (hangi eylemler); asistana gitmez.
 */

import { foldName } from "@/lib/mcp/answers/common";

/** `rehber`: riskli iş, asistan yol gösterir; `haric`: asistanın hiç önermediği iş (istenirse yalnız ekran ve adımlar) */
export type GuideKind = "rehber" | "haric";

export interface OpGuide {
  /** Kısa kimlik (test ve belge için) */
  id: string;
  kind: GuideKind;
  /** Konu (kısa) */
  topic: string;
  /** Aranan sözcükler */
  keywords: readonly string[];
  /** Neden asistan yapmıyor */
  why: string;
  /** Panel yolu (bağlantı; /panel ile başlar, # bölümü olabilir) */
  path: string;
  /** Adım adım yönerge (kısa, ekrandaki adlarla) */
  steps: readonly string[];
  /** Şifre onayı ister (asistan sohbette parola istemez) */
  password?: true;
  /** Asistanın bunun yerine yapabildiği güvenli yol (varsa) */
  instead?: string;
  /** Kapsanan eylemler (geliştirici izi; asistana gitmez) */
  actions?: readonly string[];
}

export const OP_GUIDES: readonly OpGuide[] = [
  // ---------------------------------------------------------------- Silme, geri al, toplu (§3.2)
  {
    id: "silme",
    kind: "rehber",
    topic: "Silme (fatura, gider, kasadan çıkan, kayıt, hatırlatıcı, ürün, hammadde, tedarikçi…)",
    keywords: ["sil", "silme", "kaldır", "kaldir", "temizle", "yok et"],
    why: "Sahibin kuralı: silme hiçbir durumda asistanla yapılmaz.",
    path: "/panel",
    steps: [
      "Kaydın ekranını açın (fatura: Faturalar, gider: Aylık harcamalar, kasadan çıkan: Kasa, ürün: Ürünler…).",
      "Satırdaki ⋯ ya da Düzenle › Sil'e basın ve onaylayın.",
      "Yanlışlıkla sildiyseniz bildirimdeki Geri al'a 15 dakika içinde basın.",
      "Silmek yerine pasif yapmak ya da bitiş ayı vermek çoğu zaman daha güvenlidir (sabit gider, maaş, ürün).",
    ],
    actions: ["deleteInvoice", "deleteExpenseEntry", "deleteCashOut", "deleteCashReport", "deleteSupplierEntry", "deleteIngredient", "deleteProduct", "deleteReminder", "deleteUserReminder", "deleteWasteEntry"],
  },
  {
    id: "geri-al-jetonu",
    kind: "rehber",
    topic: "Silinen ya da değiştirilen kaydı geri almak (bildirimdeki Geri al)",
    keywords: ["geri al", "geri getir", "silineni geri", "yanlışlıkla sildim", "undo"],
    why: "Geri alma bilgisi tarayıcıdaki bildirimde durur, 15 dakika geçerlidir; asistanın elinde olmaz.",
    path: "/panel/hatirlaticilar#son-odenenler",
    steps: [
      "Silme ya da değişiklikten sonra ekranın altında çıkan bildirimdeki Geri al'a 15 dakika içinde basın.",
      "Ödendi işaretini geri almak için Ödemeler › Son ödenenler › kalem › Geri al (30 gün).",
      "Süre geçtiyse kaydı ilgili ekranda yeniden girin.",
    ],
    actions: ["restoreSupplierEntry", "restoreCashOut", "undoCashOutConversion", "restoreExpenseEntry", "restoreInvoice", "restoreSupplier", "unignoreParasutBill", "undoRecentPaid"],
  },
  {
    id: "toplu-fiyat",
    kind: "rehber",
    topic: "Toplu fiyat değişikliği ve geri alması",
    keywords: ["toplu", "hepsi", "bütün ürünler", "tüm ürünler", "zam yap", "yüzde", "fiyatları artır"],
    why: "Toplu işlem asistanla yapılmaz; müşteriye görünen bütün fiyatları birden değiştirir.",
    path: "/panel/urunler/fiyatlar",
    steps: [
      "Ürünler › Fiyatlar'ı açın, ürünleri kategoriye ya da ada göre süzün.",
      "% ya da ₺ olarak artışı ve yuvarlamayı seçin.",
      "Önizleme'de yeni fiyatları kontrol edin, Uygula'ya basın.",
      "Geri almak için Fiyat geçmişi › toplu değişiklik › Geri al.",
    ],
    instead: "Tek ürünün tek boyunun fiyatını asistan onay kartıyla değiştirebilir (urun_fiyati_degistir).",
    actions: ["applyBulkPrices", "undoPriceBatch"],
  },
  {
    id: "odenmedi",
    kind: "rehber",
    topic: "Faturayı ödenmedi yapmak (ödeme geri alma)",
    keywords: ["ödenmedi", "odenmedi", "ödemeyi geri al", "yanlışlıkla ödendi", "ödenmemiş yap"],
    why: "Ödeme dağıtımlarını siler; geri alma yolu Son ödenenler'dir.",
    path: "/panel/hatirlaticilar#son-odenenler",
    steps: ["Ödemeler › Son ödenenler bölümünü açın.", "Kalemi bulun › Geri al'a basın (30 gün içinde)."],
    actions: ["setInvoicePayment(unpaid)", "undoRecentPaid"],
  },
  {
    id: "coklu-donem",
    kind: "rehber",
    topic: "Birden çok dönemi birden ödendi yapmak",
    keywords: ["dönemleri", "hepsini ödendi", "şu tarihe kadar", "geçmiş aylar ödendi"],
    why: "Çok dönem kapatmak toplu işlem sayılır.",
    path: "/panel/hatirlaticilar",
    steps: ["Ödemeler › hatırlatıcının satırı › Ödendi.", "Pencerede “şu tarihe kadar hepsi” seçeneğini ve günü seçin › Kaydet."],
    instead: "Yalnız bu dönemi asistan onay kartıyla ödendi yapabilir (hatirlatici_odendi).",
    actions: ["markReminderDone(through)"],
  },
  {
    id: "hatirlatici-yeniden-ac",
    kind: "rehber",
    topic: "Kapalı tek seferlik hatırlatıcıyı yeniden açmak",
    keywords: ["hatırlatıcıyı aç", "yeniden aç", "kapalı hatırlatıcı"],
    why: "Ödendi ve KDV ödendi kayıtlarını kalıcı siler.",
    path: "/panel/hatirlaticilar",
    steps: ["Ödemeler › kapalı hatırlatıcılar listesini açın.", "Satır › Aç'a basın; ödendi kaydının silineceğini kontrol edin."],
    actions: ["setReminderActive(true)"],
  },
  {
    id: "baskasina-hatirlatici",
    kind: "rehber",
    topic: "Hatırlatıcıyı başka bir kişiye atamak",
    keywords: ["başkasına hatırlatıcı", "kişiye ata", "personele hatırlat", "kime"],
    why: "Kayıt o kişinin olur; atayan onu sonradan göremez ve silemez.",
    path: "/panel/hatirlaticilarim",
    steps: ["Hatırlatıcılarım › Ekle.", "“Kime” alanından kişiyi seçin, başlığı ve günü yazın › Kaydet."],
    actions: ["saveUserReminder(forUserId)"],
  },
  // ---------------------------------------------------------------- Ödeme, tedarikçi, fatura
  {
    id: "cari-kasa-dagitim",
    kind: "rehber",
    topic: "Kasadan tedarikçi ödemesi, elle dağıtım, ödeme ya da borç düzeltme, borçlara sayma",
    keywords: ["kasadan ödeme", "dağıtım", "borçlara say", "neye sayıldı", "ödeme düzelt", "borç ekle", "borç düzelt", "faturası geldi", "bağı kaldır", "ödemeye çevir"],
    why: "Kasa raporuna Teslim satırı açar; kalem seçimi görsel bir karar; geçmiş ay onayı isteyebilir.",
    path: "/panel/tedarikciler",
    steps: [
      "Tedarikçiler › tedarikçiyi açın.",
      "Ödeme ekle (ya da Borç ekle) › Kasadan seçeneğini, kalemleri ve ayı pencerede seçin.",
      "Dağıtım için “Borçlara say” / “Neye sayıldı”, fatura bağı için “Faturası geldi” / “Bağı kaldır” düğmeleri.",
      "Pencerede kalemleri kontrol edip Kaydet'e basın.",
    ],
    instead: "Kasadan olmayan tek bir ödeme kaydını asistan onay kartıyla hazırlayabilir (tedarikci_odemesi_ekle).",
    actions: ["saveSupplierPayment(kasa)", "applySupplierCredit", "setPaymentAllocation", "removeAllocations", "fixAllocatedDrift", "linkDebtsToInvoice", "unlinkDebts", "convertCashOutToPayment"],
  },
  {
    id: "tedarikci-karti",
    kind: "rehber",
    topic: "Tedarikçi kartı (IBAN, unvan, diğer adlar) ve geçmiş faturaları alma",
    keywords: ["iban", "unvan", "tedarikçi kartı", "vergi no", "geçmiş faturalar", "diğer ad"],
    why: "IBAN değişikliği dolandırıcılık yoludur; ad değişikliği faturaları taşır; geçmişi almak toplu işlemdir.",
    path: "/panel/tedarikciler",
    steps: ["Tedarikçiler › tedarikçi › Kart.", "Alanı değiştirin › Kaydet.", "IBAN'ı tedarikçiyi telefonla arayarak doğrulayın."],
    actions: ["saveSupplier", "importSupplierHistory"],
  },
  {
    id: "fatura",
    kind: "rehber",
    topic: "Fatura ekleme ya da düzenleme",
    keywords: ["fatura ekle", "fatura düzenle", "fatura tutarı", "fatura gir", "kdv oranı"],
    why: "Borç, KDV, cari dağıtım ve aynı numara denetimi; Paraşüt'ten gelen faturanın kilitli alanları.",
    path: "/panel/faturalar",
    steps: ["Faturalar › Fatura ekle (ya da satır › Düzenle).", "Tedarikçi, tarih, tutar ve KDV'yi girin › Kaydet."],
    instead: "Faturayı ödendi işaretlemeyi asistan onay kartıyla hazırlayabilir (fatura_odendi).",
    actions: ["saveInvoice"],
  },
  {
    id: "kdv-odendi-kaldir",
    kind: "rehber",
    topic: "KDV ödendi kaydını kaldırmak",
    keywords: ["kdv ödendi", "kdv kaydını kaldır"],
    why: "Ödeme kaydını siler, geri alınamaz.",
    path: "/panel/hatirlaticilar/nakit#kdv",
    steps: ["Nakit planı › KDV kartı.", "Dönemi bulun › “Ödendi kaydını kaldır”."],
    actions: ["forgetVatPayment"],
  },
  // ---------------------------------------------------------------- Kasa
  {
    id: "kasa-gecmis-gun",
    kind: "rehber",
    topic: "Geçmiş güne ya da raporu girilmiş güne kasadan çıkan; kasadan çıkan düzeltme",
    keywords: ["dünkü kasa", "geçmiş gün", "kasadan çıkan düzelt", "kasa satırı", "dünkü harcama"],
    why: "Kapanmış günün raporunu ve devir zincirini değiştirir.",
    path: "/panel/kasa",
    steps: ["Kasa › günü seçin.", "Kasadan çıkanlar › satır › Düzenle (ya da Ekle).", "Raporun farkını ve devri yeniden kontrol edin."],
    instead: "Bugünün kasasına, raporu henüz girilmemişse yeni satırı asistan onay kartıyla hazırlayabilir (kasadan_cikan_ekle).",
    actions: ["saveCashOut(id≠null)", "saveCashOut(geçmiş gün)"],
  },
  {
    id: "kasa-raporu",
    kind: "rehber",
    topic: "Kasa raporu gönderme ya da düzeltme, ÖKC, kasa ve fotoğraf onayları, fiş ekleme",
    keywords: ["kasa raporu", "rapor gönder", "kasa farkı düzelt", "fiş fotoğrafı", "z fotoğrafı", "kasa onayı", "fiş ekle"],
    why: "Sayım ve fotoğraf gerekir, e-posta gider, devir zinciri bozulabilir, kanıt kaldırılabilir.",
    path: "/panel/kasa",
    steps: [
      "Kasa › günü seçin › formu doldurun (sayılan nakit, Banka POS, kasadan çıkanlar).",
      "Fotoğrafı ekleyin › Gönder.",
      "Personelin istekleri için Onaylar › Kasa: kartta farkı ve fotoğrafı kontrol edip Onayla / Reddet.",
    ],
    instead: "Gün sonu rakamlarını (Z, kasa farkı, ödeme türleri) asistan gun_sonu ve kasa_raporlari ile gösterebilir.",
    actions: ["submitCashReport", "reviewCashRequest", "reviewCashOutRequest", "reviewPhotoRemoval", "attachCashOutReceipt"],
  },
  {
    id: "kapali-gun",
    kind: "rehber",
    topic: "Kapalı gün işaretlemek",
    keywords: ["kapalı gün", "kafe kapalıydı", "tatil", "açmadık"],
    why: "Açık gün sayısını ve ortalamaları değiştirir; personel isteklerini onaylar ya da geri alır.",
    path: "/panel/kasa",
    steps: ["Kasa › raporsuz günü açın.", "“Kafe kapalıydı”ya basın, kısa not yazın › Kaydet.", "Özel günler için Özel günler ekranı."],
    actions: ["saveSpecialDay(kapali)", "markClosedDay", "reviewClosedDay"],
  },
  // ---------------------------------------------------------------- Menü, satış, reçete
  {
    id: "recete",
    kind: "rehber",
    topic: "Reçeteyi doğrudan değiştirmek",
    keywords: ["reçete", "recete", "gramaj", "reçeteyi değiştir"],
    why: "Bütün reçete satırlarını yeniden yazar, siteye yazar, çakışmada seçim ister.",
    path: "/panel/urunler",
    steps: ["Ürünler › ürünü açın › Reçete.", "Satırın miktarını değiştirin › Kaydet; çakışma çıkarsa hangisinin kalacağını seçin."],
    actions: ["saveRecipe"],
  },
  {
    id: "site-bagla",
    kind: "rehber",
    topic: "Ürünü siteye bağlamak, siteden ürün açmak, site menüsünü eşitlemek",
    keywords: ["siteye bağla", "site menüsü", "siteyle eşitle", "site bağlantısı", "siteden ürün"],
    why: "Panel fiyatının üzerine sitenin fiyatı yazılır; bağlantı Tükendi'yi ve LafPOS eşleşmesini değiştirir.",
    path: "/panel/urunler/site",
    steps: ["Ürünler › Site menüsü'nü açın.", "Bağla › kalemi ve boyu seçin › fiyat farkını kontrol edin.", "Toplu eşitleme için Siteyle eşitle / Öneriler."],
    actions: ["linkProductToSite", "createProductsFromSite", "syncSiteMenuNow", "linkSuggestedProducts", "unlinkProductFromSite", "testSiteLinks"],
  },
  {
    id: "satis-eslestir",
    kind: "rehber",
    topic: "Satış satırını ya da LafPOS adını ürünle eşleştirmek",
    keywords: ["eşleştir", "eşleşmeyen", "satış satırı", "lafpos adı", "pos adı", "ürüne bağla"],
    why: "Bütün aylardaki aynı adlı satırlara uygulanır; bağlanan satırlar geri dönmez.",
    path: "/panel/satislar",
    steps: [
      "Satışlar › ayı seçin.",
      "Satış satırları (ya da LafPOS ay toplamı › eşleşmeyen ad) › satırın ürün seçicisinden ürünü ya da HİZMET'i seçin.",
      "Ret metni çıkarsa ürünü Site menüsü'nden düzeltin.",
    ],
    instead: "Eşleşmeyen LafPOS adlarını asistan lafpos_durumu ile listeleyebilir.",
    actions: ["setLineMatch", "matchLafposName", "applyLineMatches", "applyLafposMatches"],
  },
  {
    id: "ciro-satis",
    kind: "rehber",
    topic: "Ayın cirosu, satış içe aktarma, elle satış satırı",
    keywords: ["ciroyu değiştir", "satış içe aktar", "modpos dosyası", "ay bilgileri", "açık gün sayısı"],
    why: "Ciroyu ve kârı doğrudan değiştirir; şube çerezden gelir; toplu ya da silmeli işler.",
    path: "/panel/satislar",
    steps: ["Satışlar › ayı ve şubeyi seçin.", "Ay bilgileri / Satır ekle / İçe aktar › Kaydet."],
    actions: ["setMonthField", "saveMonthInfo", "saveLine", "importSales", "parseSalesFile"],
  },
  {
    id: "onay-kararlari",
    kind: "rehber",
    topic: "Personelin isteklerine karar (reçete önerisi, yeni ürün, zayi, kasa düzeltme, karaoke)",
    keywords: ["onayla", "reddet", "istek", "öneri", "onaylar", "personelin isteği"],
    why: "Başkasının isteğine verilen kararın karşı eylemi yok; görsel karşılaştırma gerekir.",
    path: "/panel/onaylar",
    steps: ["Onaylar › istek kartını açın.", "Farkı, maliyeti ya da fotoğrafı kontrol edin.", "Onayla ya da Reddet (gerekirse not yazın)."],
    instead: "Bekleyen istekleri asistan bekleyen_isler ile listeleyebilir.",
    actions: ["reviewRecipeChange", "approveNewProduct", "reviewWasteRequest", "reviewCashRequest"],
  },
  {
    id: "kontrol-maddesi-kaldir",
    kind: "rehber",
    topic: "Kontrol listesinden madde kaldırmak",
    keywords: ["maddeyi kaldır", "kontrol maddesi", "listeden çıkar"],
    why: "Ekranda adı “Kaldır”; silme gibi algılanır.",
    path: "/panel/kontrol/duzenle",
    steps: ["Kontrol listeleri › Düzenle › listeyi açın.", "Madde › Kaldır."],
    actions: ["setChecklistItemActive(false)"],
  },
  // ---------------------------------------------------------------- Hammadde, Paraşüt, stok
  {
    id: "alinan-miktar",
    kind: "rehber",
    topic: "Alınan miktarı elle yazmak (Tutarlılık)",
    keywords: ["alınan miktar", "tutarlılık", "sapma"],
    why: "Satır elle yazılınca Paraşüt eşitlemesi artık üzerine yazmaz; geri alınamaz.",
    path: "/panel/tutarlilik",
    steps: ["Tutarlılık › ayı seçin.", "Kalemin “Alınan” hücresine miktarı yazın › Kaydet.", "Not: bundan sonra Paraşüt bu satırı güncellemez."],
    actions: ["setPurchaseQty"],
  },
  {
    id: "hammadde-birimi",
    kind: "rehber",
    topic: "Hammaddenin birimi, sayım birimi ya da fiyat kaynağı",
    keywords: ["birim", "sayım birimi", "fiyat kaynağı", "kg", "lt", "litre", "gram"],
    why: "Stok değerini 1000 kat bozabilir, sayım listesini değiştirir.",
    path: "/panel/hammaddeler",
    steps: ["Hammaddeler › satır › Düzenle.", "Birimi ya da sayım birimini seçin › Kaydet."],
    instead: "Hammaddenin paket fiyatını asistan onay kartıyla değiştirebilir (hammadde_fiyati_degistir).",
    actions: ["saveIngredient"],
  },
  {
    id: "parasut-esitle",
    kind: "rehber",
    topic: "Paraşüt'ü eşitlemek, toplu ürün bağlamak, kategori kuralı, bağlantı silmek",
    keywords: ["paraşüt eşitle", "şimdi eşitle", "kategori kuralı", "önerilenleri bağla", "parasut"],
    why: "Ağır ve geniş etkili, önizlenemez; fiyatları kendiliğinden değiştirebilir.",
    path: "/panel/parasut",
    steps: ["Paraşüt › Şimdi eşitle.", "Kategori kuralları ya da Ürün → hammadde bağlantıları bölümünde değiştirin."],
    instead: "Tek bir Paraşüt ürününü hammaddeye asistan onay kartıyla bağlayabilir (parasut_urun_bagla).",
    actions: ["runParasutSync", "readParasutLines", "saveCategoryRule", "saveProductLinks", "deleteProductLink"],
  },
  {
    id: "stok-ekler",
    kind: "rehber",
    topic: "Sayımda “Listede olmayanlar” ve karaoke geçmişini almak",
    keywords: ["listede olmayan", "sayım ekleri", "karaoke geçmişi"],
    why: "Bütün listeyi yazar ve silme içerir; geçmişi almak toplu içe aktarmadır.",
    path: "/panel/sayim",
    steps: ["Sayım › Listede olmayanlar › satırları düzenleyin › Kaydet.", "Karaoke geçmişi için Karaoke › Doluluk."],
    actions: ["saveStockExtras", "importKaraokeHistory"],
  },
  // ---------------------------------------------------------------- Personel, muhasebe
  {
    id: "personel-kategori",
    kind: "rehber",
    topic: "Personel ve maaş listesi, gider kategorileri, sabit gideri aylığa çevirmek",
    keywords: ["maaş", "personel ekle", "kategori ekle", "sabit gider", "aylığa çevir"],
    why: "Bütün listeyi yazar, silme içerir, geçmiş ayları değiştirir.",
    path: "/panel/personel",
    steps: [
      "Personel › kişi › net maaş › “şu aydan itibaren” › Kaydet.",
      "Kategoriler için Aylık harcamalar › Kategoriler ya da Ayarlar › Kategoriler.",
    ],
    actions: ["saveStaff", "saveExpenseCategory", "saveCategories", "convertFixedToMonthly"],
  },
  {
    id: "gider-duzelt",
    kind: "rehber",
    topic: "Gider kaydını düzeltmek",
    keywords: ["harcama düzelt", "gider düzelt", "gideri değiştir"],
    why: "Kasaya ya da cari borca bağlı kayıtta tutar başka ekrandan düzeltilir; geçmiş ayı değiştirir.",
    path: "/panel/harcamalar",
    steps: ["Aylık harcamalar › kaydı bulun › Düzenle.", "Tutarı ya da kategoriyi değiştirin › Kaydet."],
    instead: "Yeni gider kaydını asistan onay kartıyla hazırlayabilir (harcama_ekle).",
    actions: ["saveExpenseEntry(id≠null)"],
  },
  {
    id: "vergi",
    kind: "rehber",
    topic: "Vergi sınıflandırma, düzeltme, demirbaş, muhasebeci kaydı",
    keywords: ["vergi", "demirbaş", "sınıflandır", "muhasebeci", "beyanname"],
    why: "Muhasebe yargısı ve toplu kayıt; üzerine yazınca önceki değer dönmez.",
    path: "/panel/vergi",
    steps: ["Vergi › Gelir-gider (ya da Demirbaş) sekmesi.", "Türü muhasebecinin söylediği gibi seçin › Kaydet."],
    actions: ["saveTaxClassifications", "saveTaxAdjustment", "saveTaxAsset", "saveTaxFiling"],
  },
  // ---------------------------------------------------------------- Operasyon
  {
    id: "siparis-masa",
    kind: "rehber",
    topic: "Online sipariş aşaması ve masa çağrısı",
    keywords: ["sipariş aşaması", "siparişi hazır", "masa çağrısı", "gördüm"],
    why: "Müşteriye dönük ve geri alınamaz; yanlış siparişe dokunma riski var.",
    path: "/panel/siparisler",
    steps: ["Siparişler › sipariş kartı › aşama düğmesi.", "Masa çağrıları › Gördüm."],
    actions: ["advanceSiteOrder", "ackTableCall"],
  },
  {
    id: "karaoke",
    kind: "rehber",
    topic: "Karaoke rezervasyonu ve köşk bloğu",
    keywords: ["karaoke", "rezervasyon", "köşk"],
    why: "Halka açık site takvimine yazar, misafirin kişisel verisi, misafire e-posta gider.",
    path: "/panel/karaoke",
    steps: ["Karaoke › Elle ekle.", "Günü, saati ve kişi sayısını girin › Kaydet."],
    actions: ["addDeskKaraoke", "removeDeskKaraoke"],
  },
  {
    id: "sabah-epostasi",
    kind: "rehber",
    topic: "Sabah e-postasını şimdi göndermek",
    keywords: ["sabah e-postası", "şimdi gönder", "özet e-posta"],
    why: "Birden çok alıcıya gider, geri alınamaz.",
    path: "/panel/hatirlaticilar",
    steps: ["Ödemeler › E-posta bildirimleri bölümü.", "Şimdi gönder."],
    actions: ["runDigestNow"],
  },
  {
    id: "cihaz-bildirim",
    kind: "rehber",
    topic: "Bu cihazın bildirim konuları",
    keywords: ["bildirim konuları", "telefon bildirimi", "anlık bildirim"],
    why: "Cihaza özgü; ayar tarayıcının kendisinde durur.",
    path: "/panel/hatirlaticilarim",
    steps: ["Hatırlatıcılarım › cihaz bildirimleri kartı.", "Konuların anahtarlarını açın ya da kapatın."],
    actions: ["setPushTopics"],
  },
  // ---------------------------------------------------------------- Ayarlar, LafPOS, şube, hesap
  {
    id: "ayarlar",
    kind: "rehber",
    topic: "Ayarlar (oranlar, FIFO başlangıcı, LafPOS geçiş günü, ModPOS)",
    keywords: ["ayar", "oran", "fifo", "geçiş günü", "modpos günü", "yemek kartı günlüğü"],
    why: "Geçmiş aylar dahil bütün hesapları değiştirir; ModPOS çekimi geri alınamaz bir kota harcar.",
    path: "/panel/ayarlar#oranlar",
    steps: ["Ayarlar › ilgili bölüm (Oranlar, Stok, LafPOS, ModPOS).", "Alanı değiştirin › Kaydet."],
    actions: ["saveSettings", "saveStockValuationStart", "saveLafposSwitchDay", "fetchModposDay", "saveModposFallback"],
  },
  {
    id: "lafpos-gunu-sil",
    kind: "rehber",
    topic: "LafPOS gününü silmek (409 / z_conflict onarımı)",
    keywords: ["lafpos günü", "z_conflict", "409", "gün sonu sil", "lafpos kaydını sil", "reddedildi"],
    why: "Silme ve şifre onayı ister; asistan parola istemez.",
    path: "/panel/ayarlar#lafpos",
    steps: [
      "Ayarlar › LafPOS › Durum ve onarım.",
      "“Bu günün LafPOS kaydını sil”e basın, parolanızı ekranda girin.",
      "LafPOS'ta Kasa › Geçmiş günler › o günün Z raporu › Gönder.",
    ],
    password: true,
    instead: "Retleri ve gelmeyen günleri asistan lafpos_durumu ile gösterebilir.",
    actions: ["deleteLafposDay"],
  },
  {
    id: "sube",
    kind: "rehber",
    topic: "Şube açmak, düzenlemek ya da silmek",
    keywords: ["şube aç", "yeni şube", "şube düzenle", "şube sil"],
    why: "Yapısal ayar: kalıcı kimlik, POS oranı, kasa kaynağı.",
    path: "/panel/subeler",
    steps: ["Şubeler › Yeni şube (ya da satır › Düzenle).", "Adı, türü ve kasa kaynağını girin › Kaydet."],
    actions: ["createBranch", "updateBranch", "deleteBranch"],
  },
  {
    id: "kullanicilar",
    kind: "rehber",
    topic: "Kullanıcılar (yetki, aktiflik, kilit, oturumları kapatma)",
    keywords: ["kullanıcı", "yetki", "kilit", "personel hesabı", "hesabı kapat", "oturumlarını kapat"],
    why: "Yetki ve erişim; kimi şifre onayı ister, kimi gizli bağlantı döndürür.",
    path: "/panel/kullanicilar",
    steps: ["Kullanıcılar › kişiyi açın.", "Düzenle / Aktif anahtarı / Kilidi aç (önce İşlem geçmişine bakın).", "Parola istenirse ekranda girin."],
    password: true,
    actions: ["saveUser", "setUserActive", "createUser", "deleteUser", "unlockUser", "signOutUserEverywhere"],
  },
  {
    id: "hesabim",
    kind: "rehber",
    topic: "Kendi hesabı: parola, iki adımlı doğrulama, oturumlar",
    keywords: ["parola", "şifre", "iki adımlı", "totp", "oturum", "hesabım", "kurtarma kodu"],
    why: "Şifre onayı ister ve gizli bilgi döndürür; asistan sohbette parola istemez, görmez.",
    path: "/panel/hesap",
    steps: ["Hesabım'ı açın.", "Parola / İki adımlı doğrulama / Oturumlar bölümünden işlemi seçin.", "Parolanızı yalnız ekrandaki alana girin."],
    password: true,
    actions: ["changePasswordAction", "updateProfile", "signOutOtherSessions", "beginTotpSetup", "disableTotp", "regenerateRecoveryCodes"],
  },
  {
    id: "claude-baglantisi",
    kind: "rehber",
    topic: "Claude bağlantısını kaldırmak",
    keywords: ["claude bağlantısı", "bağlı uygulama", "mcp", "bağlantıyı kaldır"],
    why: "Entegrasyon erişimi; hepsini birden kaldırmak toplu işlem.",
    path: "/panel/hesap#bagli-uygulamalar",
    steps: ["Hesabım › Bağlı uygulamalar.", "Uygulamanın satırında Kaldır."],
    actions: ["revokeConnection", "revokeAllConnections"],
  },
  // ---------------------------------------------------------------- Hariç (§4): asistan hiç önermez; istenirse ekran
  {
    id: "giris-parola-akisi",
    kind: "haric",
    topic: "Giriş, çıkış, parola sıfırlama",
    keywords: ["giriş yap", "çıkış yap", "oturumu kapat", "parolamı unuttum", "parola sıfırla", "giriş kodu"],
    why: "Oturumsuz giriş ve parola akışları; asistan oturumun içinde çalışır, çıkış sohbeti koparır.",
    path: "/panel/hesap",
    steps: ["Çıkış için menüdeki adınız › Çıkış.", "Parola değiştirmek için Hesabım › Parola.", "Parolayı unuttuysanız giriş ekranındaki “Parolamı unuttum”."],
    actions: ["loginAction", "verifyLoginCodeAction", "cancelLoginCodeAction", "logoutAction", "setPasswordWithToken", "requestPasswordReset"],
  },
  {
    id: "iki-adim-kurulum",
    kind: "haric",
    topic: "İki adımlı doğrulama kurulumu ya da bir kullanıcının iki adımlısını sıfırlamak",
    keywords: ["iki adımlıyı sıfırla", "authenticator", "doğrulama uygulaması", "2fa"],
    why: "Kurtarma kodu taşır; güvenlik düşürme sosyal mühendislikle istenebilir.",
    path: "/panel/hesap",
    steps: ["Kendi hesabınız için Hesabım › İki adımlı doğrulama › Kur.", "Başka kullanıcı için Kullanıcılar › kişi › İki adımlıyı sıfırla (parola ister)."],
    password: true,
    actions: ["confirmTotpSetup", "cancelTotpSetup", "resetUserTwoFactor"],
  },
  {
    id: "davet-baglantisi",
    kind: "haric",
    topic: "Davet ya da parola sıfırlama bağlantısı göndermek",
    keywords: ["davet", "davet bağlantısı", "erişim bağlantısı", "giriş bağlantısı gönder"],
    why: "Bağlantı hesabı ele geçirme yetkisidir; dışarı e-posta gider.",
    path: "/panel/kullanicilar",
    steps: ["Kullanıcılar › kişi › Erişim.", "Bağlantıyı oluşturun ya da e-postayla gönderin (parola ister)."],
    password: true,
    actions: ["createAccessLink", "emailAccess"],
  },
  {
    id: "yedek",
    kind: "haric",
    topic: "Yedek almak",
    keywords: ["yedek", "yedekle", "yedeği indir", "veriyi indir"],
    why: "Bütün veriyi dışarı çıkarır ve şifre onayı ister.",
    path: "/panel/ayarlar#yedek",
    steps: ["Ayarlar › Yedek.", "Yedeği indir'e basın, parolanızı ekranda girin."],
    password: true,
    actions: ["prepareBackupDownload"],
  },
  {
    id: "oauth-onay",
    kind: "haric",
    topic: "Claude'u ya da başka bir uygulamayı panele bağlamak (erişim onayı)",
    keywords: ["claude'u bağla", "uygulama bağla", "erişim izni", "oauth"],
    why: "Dış erişim yetkisi ve parola; onay yalnız onay sayfasında verilir.",
    path: "/panel/hesap#bagli-uygulamalar",
    steps: ["Bağlantıyı Claude'dan başlatın; panelin onay sayfası açılır.", "İzinleri okuyup onaylayın.", "Bağlı uygulamalar Hesabım › Bağlı uygulamalar'da görünür."],
    actions: ["approveConnection", "denyConnection"],
  },
  {
    id: "parasut-ayarlari",
    kind: "haric",
    topic: "Paraşüt bağlantı ayarları (anahtar, firma, bağlantıyı kesmek; şube başına Paraşüt hesabı)",
    keywords: ["paraşüt anahtarı", "paraşüt bağlantısını kes", "client secret", "paraşüt ayarları", "marina paraşüt", "ayrı paraşüt hesabı", "paraşüt tuzla ile aynı"],
    why: "Gizli anahtar ve entegrasyon ayarı; ayrı hesabın faturaları o şubenin olur.",
    path: "/panel/parasut",
    steps: [
      "Şubeler aynı Paraşüt firmasındaysa bir şey yapmayın (Tuzla ile aynı). Ayrı firma için Ayarlar › Şube ayarları › şube › Paraşüt hesabı › “Tuzla ile aynı”yı kapatın.",
      "Paraşüt ekranında o şubeyi seçin › Bağlantı kartı › bilgileri girin › Kaydet › Paraşüt hesabını bağla.",
      "Ayrı hesabın faturaları şubenin olsun mu: Bağlantı kartındaki “Faturalar … şubesinin” anahtarı.",
    ],
    actions: ["disconnectParasut", "saveParasutSettings", "setParasutInvoiceScope"],
  },
  {
    id: "kasa-eposta",
    kind: "haric",
    topic: "Kasa raporu e-posta alıcıları, deneme e-postası ve şube ayarları (diğer şubeyle aynı)",
    keywords: ["kasa e-postası", "kasa alıcıları", "rapor kime gidiyor", "deneme e-postası", "şube ayarları", "diğer şubeyle aynı", "tuzla ile aynı"],
    why: "Alıcılar kasa ve ön ödeme bilgisini kimin göreceğini belirler; şube başına tutulur.",
    path: "/panel/subeler",
    steps: [
      "Ayarlar › Şube ayarları (ya da Kasa › Rapor alıcıları kartı).",
      "Şubeyi açın; “Tuzla ile aynı”yı açık bırakın ya da kapatıp alıcıları ayrı düzenleyin › Kaydet; Deneme e-postası ile sınayın.",
    ],
    actions: ["updateCashSettings", "sendCashTestEmail", "setBranchSettingLink"],
  },
  {
    id: "bildirim-ayarlari",
    kind: "haric",
    topic: "E-posta bildirimi alıcıları, haftalık özet ve bildirim testleri",
    keywords: ["alıcı ekle", "bildirim alıcısı", "haftalık özet", "bildirim ayarı", "test bildirimi"],
    why: "Alıcı eklemek veri sızdırma yolu olur; testler dışarı e-posta gönderir.",
    path: "/panel/hatirlaticilar",
    steps: ["Ödemeler › E-posta bildirimleri bölümü.", "Alıcı ekleyin ya da kapatın; haftalık özeti açıp kapatın › Kaydet."],
    actions: ["addRecipient", "setRecipientActive", "deleteRecipient", "saveNotificationSettings", "sendTestNotification", "saveWeeklyEnabled", "sendWeeklySample", "previewWeekly", "previewDigest"],
  },
  {
    id: "oran-kurallari",
    kind: "haric",
    topic: "Komisyon, personel oranları, SGK, vergi kuralları, karaoke saatleri, fotoğraf okuma ayarı",
    keywords: ["komisyon oranı", "sgk oranı", "vergi kuralı", "karaoke saatleri", "fotoğraf okuma", "personel oranı"],
    why: "Sistem geneli oran ve kurallar; geçmiş dahil bütün hesapları etkiler.",
    path: "/panel/komisyonlar",
    steps: [
      "Komisyon: Komisyonlar › kanal ayarları.",
      "Personel oranları: Personel; SGK: Gelir-gider'deki SGK notu; vergi: Vergi › Kurallar.",
      "Karaoke saatleri: Karaoke › Doluluk › Saatler; fotoğraf okuma: Ayarlar › Fotoğraf.",
    ],
    actions: ["saveCommissionSettings", "saveStaffRates", "setEmployerSgkRate", "saveTaxSettings", "saveTaxOverride", "saveKaraokeHours", "updatePhotoReading"],
  },
  {
    id: "cihaz-anahtari",
    kind: "haric",
    topic: "Bu cihazda anlık bildirimi açmak ya da kapatmak",
    keywords: ["bildirimleri aç", "push", "bu cihaz"],
    why: "Cihaz ve tarayıcı anahtarları; asistan bilemez.",
    path: "/panel/hatirlaticilarim",
    steps: ["Hatırlatıcılarım › cihaz bildirimleri kartı.", "Bildirimleri aç / kapat; tarayıcının iznini verin."],
    actions: ["savePushSubscription", "deletePushSubscription", "sendTestPush"],
  },
  {
    id: "vardiya-taslak",
    kind: "haric",
    topic: "Vardiya haftasını yapay zekâyla taslak hazırlatmak",
    keywords: ["vardiya taslağı", "haftayı doldur", "otomatik vardiya"],
    why: "Yapay zekâ içinde yapay zekâ çağrısı (maliyet).",
    path: "/panel/vardiya",
    steps: ["Vardiya › haftayı seçin › Taslak hazırla.", "Taslağı kontrol edin › Kaydet."],
    instead: "Tek kişinin günlerini asistan onay kartıyla yazabilir (vardiya_hucre_yaz).",
    actions: ["draftShiftWeekAction"],
  },
  {
    id: "personel-istekleri",
    kind: "haric",
    topic: "Personelin istekleri (kasa düzeltme, geç rapor, kapalı gün, zayi silme, fotoğraf kaldırma)",
    keywords: ["personel isteği gönder", "geç rapor isteği", "düzeltme isteği"],
    why: "Bu istekleri yalnız personel gönderebilir; yönetici onları Onaylar'da karara bağlar.",
    path: "/panel/onaylar",
    steps: ["Personel isteği kendi ekranından gönderir.", "Yönetici Onaylar'da kartı açıp Onayla / Reddet."],
    actions: ["requestCashOutChange", "requestPhotoRemoval", "requestCashCorrection", "requestCashDelete", "requestLateCashReport", "requestClosedDay", "requestLateWaste", "requestWasteDelete", "requestKaraokeTimerDelete", "saveStaffSpecialDay", "deleteStaffSpecialDay", "withdrawStaffRequest"],
  },
  {
    id: "yeni-urun-onerisi",
    kind: "haric",
    topic: "Yeni ürün önerisi (personel akışı)",
    keywords: ["yeni ürün öner", "ürün önerisi"],
    why: "Personelin akışı; yönetici ürünü doğrudan Ürünler'de açar.",
    path: "/panel/urunler",
    steps: ["Ürünler › Yeni ürün.", "Adı, boyu, fiyatı ve reçeteyi girin › Kaydet."],
    actions: ["proposeNewProduct", "addProposalIngredient"],
  },
];

/** Her işte geçen fiiller ve dolgu sözcükler: tek başına rehber seçtirmez */
const STOP = new Set(["degistir", "degistirmek", "duzelt", "duzeltmek", "yap", "yapmak", "ekle", "eklemek", "istiyorum", "nasil", "lutfen", "bunu", "sunu", "icin", "olarak", "bir", "sey", "var", "mi", "misin"]);

const words = (s: string) =>
  foldName(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOP.has(w));

/**
 * Konuya göre en ilgili rehberler: anahtar sözcük birebir geçerse 3, konu ya da anahtar sözcüklerde geçen her sorgu
 * sözcüğü 1 (ilk 5 harfiyle: "silmek" "silme"yi bulur; her işte geçen fiiller sayılmaz). En iyinin yarısından az puan
 * alan düşer (gürültü); hiç eşleşme yoksa boş.
 */
export function searchGuides(query: string, limit = 3, guides: readonly OpGuide[] = OP_GUIDES): OpGuide[] {
  const q = foldName(query);
  const qWords = words(query);
  const qAll = q.split(/[^\p{L}\p{N}]+/u);
  const scored = guides.map((g, order) => {
    let score = 0;
    for (const k of g.keywords) {
      const f = foldName(k);
      // Kısa anahtar ("lt", "kg", "sil") yalnız ayrı sözcük olarak: "düzelt"in içindeki "lt" saymaz
      if (f.length < 4 ? qAll.includes(f) : q.includes(f)) score += 3;
    }
    const hay = words(`${g.topic} ${g.keywords.join(" ")}`);
    for (const w of qWords) {
      const stem = w.slice(0, 5);
      if (hay.some((h) => h === w || (stem.length >= 4 && h.startsWith(stem)))) score += 1;
    }
    return { g, score, order };
  });
  const top = Math.max(0, ...scored.map((x) => x.score));
  return scored
    .filter((x) => x.score > 0 && x.score * 2 >= top)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((x) => x.g);
}

/** Bir rehberin markdown bağlantısı: [Ekran adı](/panel/...) için yol; ad verilmezse konu */
export const guideLink = (g: Pick<OpGuide, "path" | "topic">, label?: string) => `[${label ?? g.topic}](${g.path})`;
