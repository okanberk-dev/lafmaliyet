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
  description: string;
  opensAt: string;
  dueAt: string;
  items: SeedItem[];
}

/** integration_state anahtarı: listeler bir kez eklendi (silinen liste geri gelmez) */
export const CHECKLIST_SEED_KEY = "kontrol.seeded";

const FRIDGE = { type: "number", unit: "°C", min: 0, max: 4 } as const;

export const DEFAULT_CHECKLISTS: SeedTemplate[] = [
  {
    name: "Açılış",
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
      { section: "Not", label: "Eksik malzeme ya da arıza", type: "text", required: false, hint: "Yoksa boş bırakın." },
    ],
  },
  {
    name: "Kapanış",
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
