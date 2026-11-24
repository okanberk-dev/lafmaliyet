/*
 * Asistanın YAPMADIĞI işlerin rehberi (saf; docs/ASISTAN-ISLEMLER.md › Rehber konuları; tests/asistan-islemleri.test.ts).
 * Riskli, silmeli, toplu ya da şifre onayı isteyen işlerde asistan "şu ekrana gidin, şunu yapın" der ve ekranın
 * bağlantısını verir. Bu liste `islem_rehberi` aracının tek kaynağıdır; yollar panelin gerçek ekranlarıdır (testte
 * yönetici menüsüyle karşılaştırılır).
 */

import { foldName } from "@/lib/mcp/answers/common";

export interface OpGuide {
  /** Konu (kısa) */
  topic: string;
  /** Aranan sözcükler */
  keywords: readonly string[];
  /** Neden asistan yapmıyor */
  why: string;
  /** Panel yolu (bağlantı) */
  path: string;
  /** Ne yapılacak */
  steps: string;
  /** Şifre onayı ister (asistan sohbette parola istemez) */
  password?: true;
}

export const OP_GUIDES: readonly OpGuide[] = [
  {
    topic: "Silme (fatura, gider, kasadan çıkan, kayıt, hatırlatıcı, ürün, hammadde…)",
    keywords: ["sil", "silme", "kaldır", "kaldir", "çıkar", "temizle"],
    why: "Sahibin kuralı: silme hiçbir durumda asistanla yapılmaz.",
    path: "/panel",
    steps: "İlgili ekranda satır › Sil › onaylayın; bildirimdeki Geri al 15 dakika durur. Mümkünse önce pasif yapmayı ya da bitiş ayı vermeyi düşünün.",
  },
  {
    topic: "Toplu fiyat değişikliği ve geri alması",
    keywords: ["toplu", "hepsi", "bütün ürünler", "zam yap", "yüzde"],
    why: "Toplu işlem asistanla yapılmaz; müşteriye görünen fiyatları birden değiştirir.",
    path: "/panel/urunler/fiyatlar",
    steps: "Fiyatlar › ürünleri süzün › % ya da ₺ › yuvarlama › Önizleme › Uygula. Geri almak için Fiyat geçmişi › toplu değişiklik › Geri al.",
  },
  {
    topic: "Faturayı ödenmedi yapmak (ödeme geri alma)",
    keywords: ["ödenmedi", "odenmedi", "ödemeyi geri al", "yanlışlıkla ödendi"],
    why: "Ödeme dağıtımlarını siler; geri alma yolu Son ödenenler'dir.",
    path: "/panel/hatirlaticilar",
    steps: "Ödemeler › Son ödenenler › kalem › Geri al (30 gün).",
  },
  {
    topic: "Birden çok dönemi birden ödendi yapmak",
    keywords: ["dönemleri", "hepsini ödendi", "şu tarihe kadar"],
    why: "Çok dönem kapatmak toplu işlem sayılır.",
    path: "/panel/hatirlaticilar",
    steps: "Ödemeler › satır › Ödendi › “şu tarihe kadar hepsi” seçeneği.",
  },
  {
    topic: "Kasadan ödeme, elle dağıtım, ödeme ya da borç düzeltme, yeni tedarikçi kartı",
    keywords: ["kasadan ödeme", "dağıtım", "borçlara say", "neye sayıldı", "ödeme düzelt", "borç ekle", "faturası geldi", "bağı kaldır"],
    why: "Kasa raporuna Teslim satırı açar, kalem seçimi görsel bir karar, geçmiş ay onayı isteyebilir.",
    path: "/panel/tedarikciler",
    steps: "Tedarikçiler › tedarikçi › Ödeme ekle ya da Borç ekle; kasadan ödeme, kalem seçimi ve ay onayı pencerede.",
  },
  {
    topic: "Tedarikçi kartı (IBAN, unvan, diğer adlar) ve geçmiş faturaları alma",
    keywords: ["iban", "unvan", "tedarikçi kartı", "vergi no", "geçmiş faturalar"],
    why: "IBAN değişikliği dolandırıcılık yoludur; ad değişikliği faturaları taşır.",
    path: "/panel/tedarikciler",
    steps: "Tedarikçiler › tedarikçi › Kart › alanı değiştirin › Kaydet. IBAN'ı tedarikçiyi arayarak doğrulayın.",
  },
  {
    topic: "Fatura ekleme ya da düzenleme",
    keywords: ["fatura ekle", "fatura düzenle", "fatura tutarı", "kdv"],
    why: "Borç, KDV, cari dağıtım ve aynı numara denetimi; Paraşüt'ün kilitli alanları.",
    path: "/panel/faturalar",
    steps: "Faturalar › Fatura ekle ya da satır › Düzenle.",
  },
  {
    topic: "Geçmiş güne ya da raporu girilmiş güne kasadan çıkan; kasadan çıkan düzeltme",
    keywords: ["dünkü kasa", "geçmiş gün", "kasadan çıkan düzelt", "kasa satırı"],
    why: "Kapanmış günün raporunu ve devir zincirini değiştirir.",
    path: "/panel/kasa",
    steps: "Kasa › gün › Kasadan çıkanlar › satır › Düzenle ya da Ekle.",
  },
  {
    topic: "Kasa raporu gönderme ya da düzeltme, kasa ve fotoğraf onayları",
    keywords: ["kasa raporu", "z raporu", "rapor gönder", "kasa farkı düzelt", "fiş fotoğrafı"],
    why: "Sayım ve fotoğraf gerekir, e-posta gider, devir zinciri bozulabilir.",
    path: "/panel/kasa",
    steps: "Kasa › formu doldurun › fotoğraf › Gönder. Onaylar › kartta farkı ve fotoğrafı kontrol edin.",
  },
  {
    topic: "Gider kaydını düzeltmek",
    keywords: ["harcama düzelt", "gider düzelt"],
    why: "Kasaya ya da cari borca bağlı kayıtta tutar başka ekrandan düzeltilir; geçmiş ayı değiştirir.",
    path: "/panel/harcamalar",
    steps: "Aylık harcamalar › kayıt › Düzenle.",
  },
  {
    topic: "Reçeteyi doğrudan değiştirmek",
    keywords: ["reçete", "recete", "gramaj"],
    why: "Bütün reçete satırlarını yeniden yazar, siteye yazar, çakışmada seçim ister.",
    path: "/panel/urunler",
    steps: "Ürünler › ürün › Reçete › satırı değiştirin › Kaydet.",
  },
  {
    topic: "Ürünü siteye bağlamak, siteden ürün açmak, site menüsünü eşitlemek",
    keywords: ["siteye bağla", "site menüsü", "eşitle", "bağlantıyı kaldır"],
    why: "Panel fiyatının üzerine sitenin fiyatı yazılır; bağlantı Tükendi'yi ve LafPOS eşleşmesini değiştirir.",
    path: "/panel/urunler/site",
    steps: "Ürün kartı › Site menüsü › Bağla › kalemi ve boyu seçin › fiyat farkını kontrol edin.",
  },
  {
    topic: "Satış satırını ya da LafPOS adını ürünle eşleştirmek",
    keywords: ["eşleştir", "eşleşmeyen", "satış satırı", "lafpos adı"],
    why: "Bütün aylardaki aynı adlı satırlara uygulanır; geri alması kısmi.",
    path: "/panel/satislar",
    steps: "Satışlar › ay › Satış satırları (ya da LafPOS ay toplamı) › satırın ürün seçicisi › ürünü seçin.",
  },
  {
    topic: "Personelin isteklerine karar (reçete önerisi, yeni ürün, zayi silme, kasa düzeltme)",
    keywords: ["onayla", "reddet", "istek", "öneri", "onaylar"],
    why: "Başkasının isteğine verilen kararın karşı eylemi yok; görsel karşılaştırma gerekir.",
    path: "/panel/onaylar",
    steps: "Onaylar › istek kartı › farkı ya da maliyeti kontrol edin › Onayla / Reddet (not yazın).",
  },
  {
    topic: "Alınan miktarı elle yazmak (Tutarlılık)",
    keywords: ["alınan miktar", "tutarlılık", "sapma"],
    why: "Satır elle yazılınca Paraşüt eşitlemesi artık üzerine yazmaz; geri alınamaz.",
    path: "/panel/tutarlilik",
    steps: "Tutarlılık › ay › kalemin Alınan hücresi › miktarı yazın › Kaydet.",
  },
  {
    topic: "Hammaddenin birimi, sayım birimi ya da fiyat kaynağı",
    keywords: ["birim", "sayım birimi", "fiyat kaynağı", "kg", "lt"],
    why: "Stok değerini 1000 kat bozabilir, sayım listesini değiştirir.",
    path: "/panel/hammaddeler",
    steps: "Hammaddeler › satır › Düzenle › birim › Kaydet.",
  },
  {
    topic: "Paraşüt'ü eşitlemek, toplu ürün bağlamak, kategori kuralı",
    keywords: ["paraşüt eşitle", "şimdi eşitle", "kategori kuralı", "önerilenleri bağla"],
    why: "Ağır ve geniş etkili, önizlenemez; fiyatları kendiliğinden değiştirebilir.",
    path: "/panel/parasut",
    steps: "Paraşüt › Şimdi eşitle / Kategori kuralları / Ürün → hammadde bağlantıları.",
  },
  {
    topic: "Kapalı gün işaretlemek",
    keywords: ["kapalı gün", "kafe kapalıydı", "tatil"],
    why: "Açık gün sayısını ve ortalamaları değiştirir.",
    path: "/panel/kasa",
    steps: "Kasa › raporsuz gün › “Kafe kapalıydı” › not yazın.",
  },
  {
    topic: "Personel ve maaş listesi, kategoriler, sabit gideri aylığa çevirmek",
    keywords: ["maaş", "personel ekle", "kategori ekle", "sabit gider"],
    why: "Bütün listeyi yazar, geçmiş ayları değiştirir.",
    path: "/panel/personel",
    steps: "Personel › kişi › net maaş › “şu aydan itibaren” › Kaydet. Kategoriler Aylık harcamalar › Kategoriler'de.",
  },
  {
    topic: "Ayın cirosu, satış içe aktarma, elle satış satırı",
    keywords: ["ciro", "satış içe aktar", "modpos dosyası", "ay bilgileri"],
    why: "Ciroyu ve kârı doğrudan değiştirir; toplu ya da silmeli işler.",
    path: "/panel/satislar",
    steps: "Satışlar › ay ve şube seç › ay bilgileri / Satır ekle / İçe aktar.",
  },
  {
    topic: "Vergi sınıflandırma, düzeltme, demirbaş",
    keywords: ["vergi", "demirbaş", "sınıflandır", "muhasebeci"],
    why: "Muhasebe yargısı ve toplu kayıt; üzerine yazınca önceki değer dönmez.",
    path: "/panel/vergi",
    steps: "Vergi › türü muhasebecinin söylediği gibi seçin › Kaydet.",
  },
  {
    topic: "Karaoke rezervasyonu",
    keywords: ["karaoke", "rezervasyon"],
    why: "Halka açık site takvimine yazar, misafirin kişisel verisi, misafire e-posta gider.",
    path: "/panel/karaoke",
    steps: "Karaoke › Elle ekle › bilgileri girin.",
  },
  {
    topic: "Ayarlar (oranlar, FIFO başlangıcı, LafPOS geçiş günü, e-posta alıcıları)",
    keywords: ["ayar", "oran", "fifo", "geçiş günü", "alıcı", "bildirim"],
    why: "Geçmiş aylar dahil bütün hesapları değiştirir; alıcı eklemek veri sızdırma yolu olur.",
    path: "/panel/ayarlar",
    steps: "Ayarlar › ilgili kart › alanı değiştirin › Kaydet.",
  },
  {
    topic: "LafPOS gününü silmek (409 onarımı)",
    keywords: ["lafpos günü", "z_conflict", "409", "gün sonu sil"],
    why: "Silme ve şifre onayı ister; asistan parola istemez.",
    path: "/panel/ayarlar#lafpos",
    steps: "Ayarlar › LafPOS › Durum ve onarım › “Bu günün LafPOS kaydını sil” › parola › LafPOS'ta Kasa › Geçmiş günler › Z raporu › Gönder.",
    password: true,
  },
  {
    topic: "Şube açmak ya da düzenlemek",
    keywords: ["şube aç", "yeni şube", "şube düzenle"],
    why: "Yapısal ayar: kalıcı kimlik, POS oranı, kasa kaynağı.",
    path: "/panel/subeler",
    steps: "Şubeler › Yeni şube ya da satır › Düzenle.",
  },
  {
    topic: "Kullanıcılar (yetki, aktiflik, kilit, oturumları kapatma)",
    keywords: ["kullanıcı", "yetki", "kilit", "personel hesabı", "davet"],
    why: "Yetki ve erişim; kimi şifre onayı ister, kimi gizli bağlantı döndürür.",
    path: "/panel/kullanicilar",
    steps: "Kullanıcılar › kişi › Düzenle / Aktif anahtarı / Kilidi aç (önce İşlem geçmişine bakın).",
    password: true,
  },
  {
    topic: "Kendi hesabı: parola, iki adımlı doğrulama, oturumlar",
    keywords: ["parola", "şifre", "iki adımlı", "totp", "oturum", "hesabım"],
    why: "Şifre onayı ister ve gizli bilgi döndürür; asistan sohbette parola istemez, görmez.",
    path: "/panel/hesap",
    steps: "Hesabım › Parola / İki adımlı doğrulama / Oturumlar.",
    password: true,
  },
  {
    topic: "Yedek almak",
    keywords: ["yedek", "yedekle", "indir"],
    why: "Bütün veriyi dışarı çıkarır ve şifre onayı ister.",
    path: "/panel/ayarlar#yedek",
    steps: "Ayarlar › Yedek › Yedeği indir › parola.",
    password: true,
  },
  {
    topic: "Claude bağlantısını kaldırmak",
    keywords: ["claude bağlantısı", "bağlı uygulama", "mcp"],
    why: "Entegrasyon erişimi; toplusu toplu işlem.",
    path: "/panel/hesap#bagli-uygulamalar",
    steps: "Hesabım › Bağlı uygulamalar › Kaldır.",
  },
];

/** Konuya göre en ilgili rehberler (sözcük ve konu eşleşmesi); hiç eşleşme yoksa boş */
export function searchGuides(query: string, limit = 3, guides: readonly OpGuide[] = OP_GUIDES): OpGuide[] {
  const q = foldName(query);
  const words = q.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  const scored = guides.map((g) => {
    let score = 0;
    for (const k of g.keywords) if (q.includes(foldName(k))) score += 3;
    const topic = foldName(`${g.topic} ${g.keywords.join(" ")}`);
    for (const w of words) if (topic.includes(w)) score += 1;
    return { g, score };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.g);
}
