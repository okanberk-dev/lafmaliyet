/**
 * Kontrol listelerinin hazır gelen iki listesi: Açılış ve Kapanış (saf; scripts/seed.ts ensureChecklistSeed bir kez
 * ekler, silinen liste geri gelmez). Saatler sahibin varsayılanı (docs/planlar/KALAN-ISLER.md § 5): açılış 08:00–11:00,
 * kapanış 22:00–02:00 (gün 05:00'te döner). Maddeler bir başlangıçtır, gıda güvenliği danışmanıyla gözden geçirilip
 * Kontrol listeleri › Listeler'den değiştirilir. Fotoğraflı her maddenin ipucu, fotoğrafta insan olmasın der.
 */

import { PHOTO_PRIVACY_HINT, type ChecklistItemType } from "./checklists";

export interface SeedItem {
  label: string;
  type: ChecklistItemType;
  section?: string;
  hint?: string;
  required?: boolean;
  unit?: string;
  min?: number;
  max?: number;
}

export interface SeedTemplate {
  name: string;
  /** Listenin şubesi (branches.id); boş: bütün şubeler */
  branchId?: string;
  description: string;
  opensAt: string;
  dueAt: string;
  items: SeedItem[];
}

/** integration_state anahtarı: listeler bir kez eklendi (silinen liste geri gelmez) */
export const CHECKLIST_SEED_KEY = "kontrol.seeded";

const FRIDGE = { type: "number", unit: "°C", min: 0, max: 4 } as const;

/**
 * Gıda güvenliği maddeleri (sahibin isteği, 17 Kasım 2026; FIFO 18 Kasım): SKT, ikinci raf ömrü etiketi, yerde ürün,
 * FIFO (ilk giren ilk çıkar). İki şubenin
 * açılış listesinin sonuna "Gıda güvenliği" bölümü olarak girer; var olan veritabanında ensureFoodSafetyItems
 * (scripts/seed.ts) bir kez ekler.
 */
export const FOOD_SAFETY_ITEMS: SeedItem[] = [
  {
    section: "Gıda güvenliği",
    label: "SKT'ler kontrol edildi; tarihi geçen ürün ayrıldı",
    type: "check",
    hint: "Dolap, depo ve vitrindeki ürünlerin son kullanma tarihine bakın; tarihi geçeni kullanmayın, fire olarak ayırın.",
  },
  {
    section: "Gıda güvenliği",
    label: "İkinci raf ömrü etiketleri vuruldu",
    type: "check",
    hint: "Açılan ya da hazırlanan her ürüne (süt, krema, sos, hazırlanan ürünler) açılış ve son kullanma tarihini yazan etiket yapıştırın.",
  },
  {
    section: "Gıda güvenliği",
    label: "Yere temas eden ürün yok",
    type: "check",
    hint: "Depo ve dolaplarda koli, kasa ve ürün yerde durmasın; raf ya da palet üzerinde olsun.",
  },
  {
    section: "Gıda güvenliği",
    label: "FIFO uygulandı: ilk giren ilk çıkar",
    type: "check",
    hint: "Yeni gelen ürünü eskisinin arkasına dizin; önce gelen ve tarihi en yakın ürün önce kullanılsın. Dolap, depo ve vitrin.",
  },
];

/**
 * integration_state anahtarları: gıda güvenliği maddeleri var olan açılış listelerine bir kez eklendi. Her anahtar
 * eksik maddeleri ekler; yeni madde gelince yeni anahtar eklenir (ilki SKT, etiket, yerde ürün; ikincisi FIFO, 18 Kasım
 * 2026). Listede aynı adda madde varsa atlanır.
 */
export const FOOD_SAFETY_SEED_KEYS = ["kontrol.gida.seeded", "kontrol.gida.fifo.seeded"] as const;
/** Gıda güvenliği maddelerinin ekleneceği listeler (adıyla; adı değişmiş ya da silinmiş liste atlanır) */
export const FOOD_SAFETY_LISTS = ["Açılış", "Marina Açılış"] as const;

export const DEFAULT_CHECKLISTS: SeedTemplate[] = [
  {
    name: "Açılış",
    // Karaoke odası Tuzla'da: hazır iki liste Tuzla'nın (Marina'nın listeleri MARINA_CHECKLISTS)
    branchId: "tuzla",
    description: "Kafeyi açarken. Sıcaklıkları ölçün; fotoğrafları tezgâh ve salon hazır olunca çekin.",
    opensAt: "08:00",
    dueAt: "11:00",
    items: [
      { section: "Bar", label: "Espresso makinesi açıldı, gruplardan su geçirildi", type: "check", hint: "İlk kahveden önce her gruptan birkaç saniye su akıtın." },
      { section: "Bar", label: "Bar buzdolabı sıcaklığı", ...FRIDGE, hint: "Termometreyi dolabın orta rafında okuyun." },
      { section: "Bar", label: "Derin dondurucu sıcaklığı", type: "number", unit: "°C", min: -30, max: -18, required: false, hint: "Dondurucu yoksa boş bırakın." },
      { section: "Bar", label: "Süt ve sütlü ürünlerin tarihlerine bakıldı; açılan kutuya tarih yazıldı", type: "check" },
      { section: "Bar", label: "Buz makinesi çalışıyor, haznesi temiz", type: "check" },
      { section: "Bar", label: "Tezgâh, kesme tahtaları ve bar ekipmanı dezenfekte edildi", type: "check" },
      { section: "Bar", label: "Bar tezgâhı hazır", type: "photo", hint: `Tezgâhın tamamı görünsün. ${PHOTO_PRIVACY_HINT}` },
      { section: "Salon", label: "Masalar, sandalyeler ve menüler silindi", type: "check" },
      { section: "Salon", label: "Lavabo: sabun, kâğıt havlu ve tuvalet kâğıdı tam; çöp boş", type: "check" },
      { section: "Salon", label: "Salon hazır", type: "photo", hint: PHOTO_PRIVACY_HINT },
      { section: "Karaoke odası", label: "Oda havalandırıldı; ses sistemi ve ekran denendi", type: "check" },
      { section: "Karaoke odası", label: "Mikrofonlar şarjlı, yedek pil ve mikrofon kılıfı yeterli", type: "check" },
      ...FOOD_SAFETY_ITEMS,
      { section: "Not", label: "Eksik malzeme ya da arıza", type: "text", required: false, hint: "Yoksa boş bırakın." },
    ],
  },
  {
    name: "Kapanış",
    branchId: "tuzla",
    description: "Son misafir çıkınca, kasa raporundan önce. Fotoğrafları temizlik bitince çekin.",
    opensAt: "22:00",
    dueAt: "02:00",
    items: [
      {
        section: "Karaoke odası",
        label: "Mikrofonlar alkollü mendille silindi, kullanılan kılıflar atıldı",
        type: "check",
        hint: "Tutma yeri ve ızgara dahil; mikrofonu ıslatmayın.",
      },
      { section: "Karaoke odası", label: "Koltuklar, masa ve kumanda / şarkı tableti silindi; çöp toplandı", type: "check" },
      { section: "Karaoke odası", label: "Unutulan eşya kontrol edildi", type: "check", hint: "Bulunanı kasaya kaldırıp nota yazın." },
      { section: "Karaoke odası", label: "Ses sistemi ve ekran kapatıldı", type: "check" },
      { section: "Karaoke odası", label: "Karaoke odası toparlandı", type: "photo", hint: PHOTO_PRIVACY_HINT },
      { section: "Bar", label: "Espresso makinesi: gruplar fırçalandı, kör filtreyle deterjanlı yıkama yapıldı", type: "check" },
      { section: "Bar", label: "Buhar çubuğu temizlendi; sürahi ve potlar yıkandı", type: "check" },
      { section: "Bar", label: "Açık süt, krema ve soslar dolaba kaldırıldı, üzerlerine tarih yazıldı", type: "check" },
      { section: "Bar", label: "Bar buzdolabı sıcaklığı", ...FRIDGE },
      { section: "Bar", label: "Bar ve tezgâh temiz", type: "photo", hint: PHOTO_PRIVACY_HINT },
      { section: "Salon ve genel", label: "Yerler süpürüldü ve silindi", type: "check" },
      { section: "Salon ve genel", label: "Lavabo temizlendi", type: "check" },
      { section: "Salon ve genel", label: "Çöpler çıkarıldı, kovalara yeni poşet takıldı", type: "check" },
      { section: "Salon ve genel", label: "Salon kapanış hâli", type: "photo", hint: PHOTO_PRIVACY_HINT },
      { section: "Salon ve genel", label: "Işıklar, klima ve cihazlar kapandı; kapılar kilitlendi", type: "check" },
      { section: "Not", label: "Arıza, eksik ya da bulunan eşya", type: "text", required: false },
    ],
  },
];

/** integration_state anahtarı: Marina'nın listeleri bir kez eklendi (silinen liste geri gelmez) */
export const MARINA_CHECKLIST_SEED_KEY = "kontrol.marina.seeded";

const FREEZER = { type: "number", unit: "°C", min: -30, max: -18 } as const;

/**
 * Marina şubesinin açılış ve kapanış listeleri (sahibin listesi, 16 Kasım 2026). Marina'da karaoke yok, teras var:
 * karaoke maddesi yerine teras, çikolata şelalesi ve portakal suyu makinesi maddeleri. Saatler Tuzla'nınkiyle aynı
 * başlar, Listeler'den değiştirilir.
 */
export const MARINA_CHECKLISTS: SeedTemplate[] = [
  {
    name: "Marina Açılış",
    branchId: "marina",
    description: "Marina'yı açarken. Buzdolabı ve dondurucu derecelerini yazın.",
    opensAt: "08:00",
    dueAt: "11:00",
    items: [
      { section: "Bar ve vitrin", label: "Espresso makinesini ve değirmeni aç", type: "check" },
      { section: "Bar ve vitrin", label: "Işıkları, menü ekranlarını ve vitrini aç", type: "check" },
      { section: "Bar ve vitrin", label: "POS'u aç, kasayı say", type: "check" },
      { section: "Bar ve vitrin", label: "Fırını aç", type: "check" },
      { section: "Bar ve vitrin", label: "Çikolata şelalesini aç", type: "check" },
      { section: "Bar ve vitrin", label: "Portakal suyu makinesini doldur", type: "check" },
      { section: "Bar ve vitrin", label: "Test kahvesi yap, tadını kontrol et", type: "check" },
      { section: "Bar ve vitrin", label: "Pastaları vitrine diz, tarihlerini kontrol et", type: "check" },
      { section: "Bar ve vitrin", label: "Buzdolabı sıcaklığı", ...FRIDGE, hint: "Termometreyi dolabın orta rafında okuyun." },
      { section: "Bar ve vitrin", label: "Dondurucu sıcaklığı", ...FREEZER },
      { section: "Bar ve vitrin", label: "İçecek dolaplarını doldur", type: "check" },
      { section: "Bar ve vitrin", label: "Bar tezgahını sil", type: "check" },
      { section: "Salon", label: "Vitrin camlarını içten ve dıştan sil", type: "check" },
      { section: "Salon", label: "İçerideki uzun masayı ve sandalyeleri sil", type: "check" },
      { section: "Salon", label: "Kapı camlarını sil", type: "check" },
      { section: "Salon", label: "İçeriyi süpür", type: "check" },
      { section: "Salon", label: "İçeriyi paspasla", type: "check" },
      { section: "Salon", label: "Çöp kovalarını kontrol et, poşetleri tak", type: "check" },
      { section: "Teras", label: "Terasın yerlerini süpür", type: "check" },
      { section: "Teras", label: "Terasın yerlerini paspasla", type: "check" },
      { section: "Teras", label: "Teras masalarını sil", type: "check" },
      { section: "Teras", label: "Teras sandalyelerini ve minderlerini sil", type: "check" },
      { section: "Teras", label: "Minderleri düzelt, iplerini bağla", type: "check" },
      { section: "Teras", label: "Temiz kül tablalarını masalara koy", type: "check" },
      { section: "Teras", label: "Teras camlarını ve kapılarını kontrol et, kirliyse sil", type: "check" },
      { section: "Teras", label: "Hava soğuksa ısıtıcıları aç", type: "check", required: false, hint: "Hava soğuk değilse boş bırakın." },
      { section: "Kafe önü ve güvenlik", label: "Kafe önünü süpür", type: "check" },
      { section: "Kafe önü ve güvenlik", label: "Yangın dolabının önü boş mu kontrol et", type: "check" },
      ...FOOD_SAFETY_ITEMS,
    ],
  },
  {
    name: "Marina Kapanış",
    branchId: "marina",
    description: "Son misafir çıkınca. Gün sonu raporunu almadan önce bar ve terası toparlayın.",
    opensAt: "22:00",
    dueAt: "02:00",
    items: [
      { section: "Bar", label: "Çikolata şelalesini kapat, boşalt, yıka", type: "check" },
      { section: "Bar", label: "Portakal suyu makinesini boşalt, yıka", type: "check" },
      { section: "Bar", label: "Espresso makinesini yıka (backflush)", type: "check" },
      { section: "Bar", label: "Steam wand'ı temizle", type: "check" },
      { section: "Bar", label: "Değirmenin altını temizle", type: "check" },
      { section: "Bar", label: "Lavaboyu ve tezgahı temizle", type: "check" },
      { section: "Bar", label: "Kalan pastalar (yarına kalan ya da fire)", type: "text", hint: "Ör. 2 cheesecake yarına, 1 tiramisu fire. Kalan yoksa \"yok\" yazın." },
      { section: "Bar", label: "Açık sütleri tarihle, dolaba koy", type: "check" },
      { section: "Teras", label: "Teras masalarını sil", type: "check" },
      { section: "Teras", label: "Minderleri topla", type: "check" },
      { section: "Teras", label: "Kül tablalarını yıka", type: "check" },
      { section: "Salon", label: "Yeri paspasla", type: "check" },
      { section: "Salon", label: "Çöpleri çıkar", type: "check" },
      { section: "Kapanış", label: "Gün sonu raporunu al, kasayı say", type: "check" },
      { section: "Kapanış", label: "Isıtıcıları kapat", type: "check" },
      { section: "Kapanış", label: "Klimayı ve ışıkları kapat (dolaplar açık kalır)", type: "check" },
      { section: "Kapanış", label: "Terası ve kapıyı kilitle", type: "check" },
      { section: "Kapanış", label: "Alarmı kur", type: "check" },
    ],
  },
];

/** integration_state anahtarı: Tuzla'nın tuvalet çizelgesi bir kez eklendi (silinen liste geri gelmez) */
export const TUZLA_HOURLY_SEED_KEY = "kontrol.tuzla.tuvalet.seeded";

/** Tuvalet çizelgesinin saatleri: 10:00'dan gece 01:00'e, saat başı (16 saat) */
export const TOILET_HOURS = ["10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "00", "01"].map((h) => `${h}:00`);

/**
 * Tuzla'nın saatlik tuvalet çizelgesi (sahibin isteği, 17 Kasım 2026; yalnız Tuzla). Her saat bir bölümdür ("10:00"):
 * bölüm adı saat olduğu için maddeleri o saatten 10 dakika önce açılır (lib/checklists.ts sectionSlot), önceden
 * doldurulamaz. Her saatte: tuvalet kontrolü imzası ve fotoğrafı (zorunlu); bahçe ve odalardaki boşların toplandığının
 * imzası (zorunlu) ve fotoğrafı (isteğe bağlı: yalnız misafir yokken çekilir, misafir varken çekilmez). İmza, maddeyi
 * işaretleyen kişinin adı ve saatidir. Son saat 01:30: 01:00'in imzasına yarım saat.
 */
export const TUZLA_HOURLY_CHECKLISTS: SeedTemplate[] = [
  {
    name: "Tuvalet çizelgesi",
    branchId: "tuzla",
    description:
      "Saat başı tuvalete bakın, imzalayıp fotoğrafını yükleyin; bahçe ve odalardaki boşları toplayıp imzalayın. Bahçe ve odaların fotoğrafını yalnız içeride misafir yokken çekin.",
    opensAt: "10:00",
    dueAt: "01:30",
    items: TOILET_HOURS.flatMap((h): SeedItem[] => [
      {
        section: h,
        label: `${h} Tuvalet kontrol edildi ve temizlendi`,
        type: "check",
        hint: "Sabun, kâğıt havlu ve tuvalet kâğıdı tam; çöp boş; zemin kuru. Eksik ya da arıza varsa Sorun var'a yazın.",
      },
      { section: h, label: `${h} Tuvalet fotoğrafı`, type: "photo", hint: `İçeride kimse yokken çekin. ${PHOTO_PRIVACY_HINT}` },
      { section: h, label: `${h} Bahçe ve odalardaki boşlar toplandı`, type: "check", hint: "Boş bardak, fincan, tabak ve şişeler toplandı; masalar silindi." },
      {
        section: h,
        label: `${h} Bahçe ve odalar fotoğrafı`,
        type: "photo",
        required: false,
        hint: `Yalnız bahçede ve odalarda misafir yokken çekin; misafir varsa çekmeyin, boş bırakın. ${PHOTO_PRIVACY_HINT}`,
      },
    ]),
  },
];
