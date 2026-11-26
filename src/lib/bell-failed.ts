import type { Role } from "@/lib/constants";

/**
 * Zilin okunamayan bölümleri (denetim bulgu 88). Zil bölüm bölüm paralel okunur; Neon uyanırken bir okuma zaman aşımına
 * düşerse o bölüm önceden sessizce boş görünürdü: eksik kasa raporu, geciken kontrol listesi, onay isteği ya da "sabah
 * işi çalışmadı" uyarısı kaybolur, menü "Dikkat isteyen bir şey yok" diyebilirdi. Artık düşen her bölüm kendi grubunda
 * tek bir "{Grup} yüklenemedi" satırı bırakır; aynı gruptan birden çok kaynak düşerse satır birdir, gövdesi neyin
 * okunamadığını sayar. Satır okunmamış sayılmaz (geçici; rozeti şişirmez), kimliği grup ve günden türer. Maliyet modeli
 * ("Maliyet uyarıları yüklenemedi") ve ödemeler ("Ödemeler yüklenemedi") kendi satırlarını zaten koyar
 * (src/server/actions/notifications.ts modelFailed, paymentsFailedRow).
 */

/** Zilin bir kaynağı: grubu, gövdede adı (role göre) ve satırın bağlantısı */
const PARTS = {
  hatirlatici: { group: "hatirlatici", what: "hatırlatıcılarınız", href: "/panel/hatirlaticilarim" },
  recete: { group: "onay", what: { admin: "reçete önerileri", staff: "önerilerinizin sonucu" }, href: { admin: "/panel/onaylar", staff: "/panel/receteler#onerilerim" } },
  istek: { group: "onay", what: { admin: "personel istekleri", staff: "isteklerinizin sonucu" }, href: { admin: "/panel/onaylar", staff: "/panel/kasa#isteklerim" } },
  bekletme: { group: "onay", what: "bekleyen fiyat onayları", href: "/panel/onaylar" },
  zayi: { group: "onay", what: { admin: "zayi istekleri", staff: "zayi isteklerinizin sonucu" }, href: { admin: "/panel/onaylar", staff: "/panel/zayi" } },
  karaoke: { group: "onay", what: { admin: "karaoke istekleri", staff: "karaoke isteklerinizin sonucu" }, href: { admin: "/panel/onaylar", staff: "/panel/karaoke" } },
  kasa: { group: "kasa", what: "kasa raporları", href: "/panel/kasa" },
  kontrol: { group: "kontrol", what: "kontrol listeleri", href: "/panel/kontrol" },
  fatura: { group: "fatura", what: "faturalar", href: "/panel/faturalar" },
  komisyon: { group: "fatura", what: "komisyon hakedişleri", href: "/panel/komisyonlar" },
  sistem: { group: "sistem", what: "günlük işlerin durumu", href: "/panel/ayarlar" },
  guvenlik: { group: "sistem", what: "yeni cihazdan girişler", href: "/panel/hesap" },
  alici: { group: "sistem", what: "bildirim alıcıları", href: "/panel/ayarlar" },
  modpos: { group: "sistem", what: "ModPOS anahtarı", href: "/panel/ayarlar" },
  fiyatsiz: { group: "uyari", what: "fiyatı girilmemiş hammaddeler", href: "/panel/hammaddeler?durum=fiyatsiz" },
  fiyat: { group: "uyari", what: "kasada değişecek fiyatlar", href: { admin: "/panel/urunler/fiyatlar?sekme=kasa", staff: "/panel/kasa/fiyatlar" } },
  tukendi: { group: "uyari", what: "tükenen ürünler", href: "/panel/urunler" },
  sayim: { group: "uyari", what: "stok sayımı", href: "/panel/sayim" },
  vardiya: { group: "uyari", what: "vardiya planı", href: "/panel/vardiya" },
  operasyon: { group: "uyari", what: "operasyon uyarıları", href: "/panel" },
} as const;

export type BellPart = keyof typeof PARTS;
export type BellGroup = (typeof PARTS)[BellPart]["group"];

/** Grubun "yüklenemedi" başlığı (zildeki grup adlarıyla: personelde Onaylar "İsteklerim") */
const TITLE: Record<BellGroup, string | Record<Role, string>> = {
  sistem: "Sistem uyarıları yüklenemedi",
  hatirlatici: "Hatırlatıcılar yüklenemedi",
  onay: { admin: "Onaylar yüklenemedi", staff: "İstekleriniz yüklenemedi" },
  kasa: "Kasa yüklenemedi",
  kontrol: "Kontrol listeleri yüklenemedi",
  fatura: "Faturalar yüklenemedi",
  uyari: "Uyarılar yüklenemedi",
};

const byRole = <T>(v: T | Record<Role, T>, role: Role): T => (typeof v === "object" && v !== null && "admin" in v ? (v as Record<Role, T>)[role] : (v as T));

/** Zil satırının şekli (src/server/actions/notifications.ts PanelNotification ile aynı) */
export interface FailedBellRow {
  id: string;
  kind: "warning";
  title: string;
  body: string;
  timeLabel: string;
  unread: false;
  href: string;
  group: BellGroup;
}

/**
 * Düşen kaynakların satırları, grup başına bir tane (kaynakların sırası korunur; bağlantı grubun ilk düşen kaynağınınki).
 * Kimlik `okunamadi-{grup}-{gün}`: aynı gün yeniden düşerse aynı satır.
 */
export function failedBellRows(parts: readonly BellPart[], role: Role, day: string): FailedBellRow[] {
  const groups = new Map<BellGroup, BellPart[]>();
  for (const p of parts) {
    const g = PARTS[p].group;
    const list = groups.get(g) ?? [];
    if (!list.includes(p)) list.push(p);
    groups.set(g, list);
  }
  return [...groups].map(([group, list]) => {
    const what = list.map((p) => byRole<string>(PARTS[p].what, role));
    const joined = what.length > 1 ? `${what.slice(0, -1).join(", ")} ve ${what.at(-1)}` : what[0];
    return {
      id: `okunamadi-${group}-${day}`,
      kind: "warning",
      title: byRole(TITLE[group], role),
      body: `${joined.charAt(0).toLocaleUpperCase("tr-TR")}${joined.slice(1)} şu an okunamadı; zili birazdan yeniden açın.`,
      timeLabel: "",
      unread: false,
      href: byRole<string>(PARTS[list[0]].href, role),
      group,
    };
  });
}

/** Bir kaynağın düştüğünü bildiren geri çağırma (zilin her bölümü kendi kaynaklarını bununla söyler) */
export type BellFailed = (part: BellPart, error: unknown) => void;

/** Varsayılan geri çağırma: yalnız günlüğe yazar (zilin dışında tek başına çağrılan bölüm için) */
export const logBellFailed: BellFailed = (part, error) => console.error(`Zil: ${part} okunamadı`, error);
