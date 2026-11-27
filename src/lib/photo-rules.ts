/**
 * Fotoğraflar için saf kurallar (sunucu ve istemci birlikte kullanır; tests/foto-altyapi.test.ts sınar): türler,
 * boyut sınırları, görselin piksel ölçüsü (dosyanın başlığından; görsel sunucuda hiç çözülmez), saklama süreleri,
 * kimin görebileceğinin ilk adımları ve yükleme hatalarının metni. Depo ve yetki kayıtları
 * src/server/storage/photos.ts ve photo-access.ts'te; ayrıntı docs/FOTOGRAF.md.
 */

import { addDays } from "./reminders";

/**
 * `kasa-okc`: yazarkasanın (banka POS) mali Z'si (dalga 13 PR-b). `kasa-pos` (banka gün sonu fişi) eski fotoğraflar ve
 * geçiş içindir: yeni yükleme ve yeniden okuma onu `kasa-okc` yapar (docs/planlar/okc-z.md D2)
 */
export type PhotoKind = "kasa-z" | "kasa-pos" | "kasa-okc" | "fis" | "kontrol";
export const PHOTO_KINDS: readonly PhotoKind[] = ["kasa-z", "kasa-pos", "kasa-okc", "fis", "kontrol"];

export type PhotoMime = "image/jpeg" | "image/png" | "image/webp";
export const PHOTO_MIMES: readonly PhotoMime[] = ["image/jpeg", "image/png", "image/webp"];

/** Telefonda küçültülen fotoğraf (en çok 2576 px / ~3,7 MP JPEG) çoğunlukla 0,4–1,2 MB olur ve 1,8 MB'ı aşmaz; 2 MB küçültülmemiş (ya da elle gönderilmiş) dosyayı keser */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
/** Kısa kenarı bundan küçük fotoğrafta rakam okunmaz; uzun kenarı bundan büyüğü küçültülmemiştir */
export const MIN_PHOTO_EDGE = 200;
export const MAX_PHOTO_EDGE = 4096;
export const PHOTO_SIZE_ERROR = "Fotoğraf çok küçük ya da çok büyük; yeniden çekin.";

/** Bir kayda bağlanmamış (form bırakılmış) fotoğraf bu kadar gün sonra silinir */
export const UNLINKED_DAYS = 2;
/** Bağı kalkan (satır silindi, fotoğraf değişti) fotoğraf: geri alma payı */
export const RELEASED_DAYS = 7;
/** Silinen kasa raporunun fotoğrafları: yanlışlıkla silinen rapor için kanıt */
export const DELETED_REPORT_DAYS = 30;
/**
 * Bağlandıktan sonra saklama: kasa raporundan, fişin tarihinden ya da kontrol cevabından itibaren gün. Yazarkasa Z'si
 * 400 gün: yıllık vergi mutabakatı bir takvim yılını kapsar (docs/planlar/okc-z.md D12)
 */
export const KEEP_DAYS: Record<PhotoKind, number> = { "kasa-z": 180, "kasa-pos": 180, "kasa-okc": 400, fis: 400, kontrol: 60 };

/** Kişi başına saatte en çok bu kadar yükleme (yanlışlıkla döngüye giren telefon depoyu doldurmasın) */
export const UPLOADS_PER_HOUR = 30;
/** Bir fotoğraf en çok bu kadar okunur (yeniden dene, diğer bölüme okut) */
export const MAX_READS_PER_PHOTO = 3;
/** Bir kasa raporuna en çok bu kadar fotoğraf bağlanır */
export const MAX_REPORT_PHOTOS = 6;
/** Yazarkasa (banka POS) Z bölümüne en çok bu kadar fotoğraf: uzun fiş üst ve alt parça olarak çekilir (docs/planlar/okc-z.md §3.4) */
export const MAX_OKC_PHOTOS = 3;
export const OKC_PHOTOS_TEXT = `Yazarkasa Z bölümüne en çok ${MAX_OKC_PHOTOS} fotoğraf eklenir`;

/** Fotoğraftan okumanın durumu (src/server/ai/claude.ts aiStatus): açık, kapalı, anahtar yok, bugünkü sınır doldu */
export type ReadingState = "on" | "off" | "nokey" | "cap";

/** Okuma açık değilken fotoğraf düğmelerinin altındaki tek satır (fotoğraf yine kanıt olarak eklenir) */
export function readingOffText(state: ReadingState, admin: boolean): string | null {
  if (state === "nokey") return "Fotoğraftan okuma bu ortamda kapalı; rakamları elle yazın.";
  if (state === "off") return `Fotoğraftan okuma kapalı; rakamları elle yazın.${admin ? " Ayarlar › Fotoğraftan okuma'dan açılır." : ""}`;
  if (state === "cap") return "Bugünkü okuma sınırı doldu; fotoğraf yine eklenir.";
  return null;
}

/**
 * Personelin kasadan çıkan isteği ve fişi bu kadar gün geriye açılır (iş günü ile 7 gün öncesi;
 * src/lib/cash-out-requests.ts REQUEST_DAYS bu sabittir)
 */
export const RECEIPT_REQUEST_DAYS = 7;

/**
 * Fotoğraf ekleme kuralı (POST /api/foto ve yeniden okuma; src/server/photo-read/rules.ts canUploadPhoto): gün gerekli
 * ve ileri bir gün değil; kontrol listelerinin kendi yolu var. Yönetici her güne ekler ("yes"). Personel Z ve POS
 * fotoğrafını personelin hâlâ açık günüyle (staffDayOpen) ya da geç kasa raporunun gününe (staffLateDayOpen: dünden
 * eski, son 14 gün, raporu olmayan; "open-or-late"), fişi kasadan çıkan isteğinin penceresindeki güne (iş günü ile 7
 * gün öncesi: açık günde doğrudan satır, kapanmış ya da eski günde istek) ekler. Veritabanına bakan kısım çağıranda.
 */
export function uploadRule(role: "admin" | "staff", kind: PhotoKind, day: string | null, today: string): "no" | "yes" | "open-or-late" {
  if (kind === "kontrol" || !day || day > today) return "no";
  if (role === "admin") return "yes";
  if (kind === "fis") return day >= addDays(today, -RECEIPT_REQUEST_DAYS) ? "yes" : "no";
  return "open-or-late";
}

export const PHOTO_KIND_LABEL: Record<PhotoKind, string> = {
  "kasa-z": "Z raporu",
  "kasa-pos": "Banka POS",
  "kasa-okc": "Yazarkasa Z",
  fis: "Fiş",
  kontrol: "Kontrol listesi",
};

export function isPhotoKind(v: unknown): v is PhotoKind {
  return typeof v === "string" && (PHOTO_KINDS as readonly string[]).includes(v);
}

export function photoExt(mime: PhotoMime): "jpg" | "png" | "webp" {
  return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
}

/** Fotoğrafın panel içindeki tek adresi (Blob adresi hiçbir yerde görünmez) */
export const photoUrl = (id: number) => `/api/foto/${id}`;

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

/**
 * Görselin piksel ölçüsü, yalnız başlığından: PNG (IHDR), JPEG (SOF0–SOF15) ve WebP (VP8, VP8L, VP8X). Görsel
 * çözülmez (sıkıştırma bombasına karşı); tanınmazsa null.
 */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const b = bytes;
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && ascii(b, 12, 4) === "IHDR") {
    return positive(u32be(b, 16), u32be(b, 20));
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 3 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) {
        i += 1; // dolgu baytı
        continue;
      }
      // Uzunluksuz işaretler: TEM, RSTn, SOI, EOI
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        i += 2;
        continue;
      }
      const len = u16be(b, i + 2);
      if (len < 2) return null;
      // SOF0–SOF15; C4 (DHT), C8 (JPG) ve CC (DAC) çerçeve değil
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (i + 9 > b.length) return null;
        return positive(u16be(b, i + 7), u16be(b, i + 5));
      }
      if (marker === 0xda) return null; // görüntü verisi başladı, ölçü yok
      i += 2 + len;
    }
    return null;
  }
  if (b.length >= 30 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8 " && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return positive((b[26] | (b[27] << 8)) & 0x3fff, (b[28] | (b[29] << 8)) & 0x3fff);
    }
    if (chunk === "VP8L" && b[20] === 0x2f) {
      const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
      return positive((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (chunk === "VP8X") return positive(u24le(b, 24) + 1, u24le(b, 27) + 1);
  }
  return null;
}

function positive(width: number, height: number) {
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Ölçü sınırların dışındaysa hata metni (ölçü okunamadıysa denetlenmez: tür zaten içerikten denetlendi) */
export function sizeProblem(size: { width: number; height: number } | null): string | null {
  if (!size) return null;
  const long = Math.max(size.width, size.height);
  const short = Math.min(size.width, size.height);
  return long > MAX_PHOTO_EDGE || short < MIN_PHOTO_EDGE ? PHOTO_SIZE_ERROR : null;
}

/** Şimdiden `days` gün sonrası */
export function daysFrom(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

/** Bağlanan fotoğrafın silineceği an: dayanak günün (rapor günü, kasadan çıkanın günü) İstanbul gece yarısı + türün saklama günü */
export function keepUntil(kind: PhotoKind, anchorDay: string): Date {
  return new Date(`${addDays(anchorDay, KEEP_DAYS[kind])}T00:00:00+03:00`);
}

/**
 * Kayda bağlarken silinme anı: dayanak gün bugünden eskiyse (geçmiş bir güne sonradan girilen rapor ya da satır) süre
 * bugünden sayılır; yoksa 180 günden eski bir güne eklenen fotoğraf ertesi sabah silinirdi.
 */
export function linkedUntil(kind: PhotoKind, anchorDay: string, today: string): Date {
  return keepUntil(kind, anchorDay < today ? today : anchorDay);
}

/**
 * Fotoğrafı kim görür, ilk adımlar: süresi dolmuş → hayır; yönetici → evet; yükleyen kişi bağlanmamış fotoğrafını
 * görür (formdaki küçük resim); kalanı türün kuralı (PHOTO_RULES, src/server/storage/photo-access.ts) söyler.
 */
export function photoViewDecision(
  me: { id: number; role: "admin" | "staff" },
  photo: { createdBy: number | null; linkedAt: Date | string | null; expiresAt: Date | string | null },
  now: Date = new Date(),
): "yes" | "no" | "rules" {
  if (photo.expiresAt !== null && new Date(photo.expiresAt).getTime() <= now.getTime()) return "no";
  if (me.role === "admin") return "yes";
  if (photo.linkedAt === null && photo.createdBy === me.id) return "yes";
  return "rules";
}

/** "Z raporu · 23:52 · Ayşe"; `label` türün adının yerine (AsilPOS gününde "Pavo gün sonu fişi") */
export function photoCaption(kind: PhotoKind, createdAt: Date | string, byName: string | null, label?: string): string {
  const time = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(new Date(createdAt));
  return [label ?? PHOTO_KIND_LABEL[kind], time, byName].filter(Boolean).join(" · ");
}

function errorOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const e = (body as { error?: unknown }).error;
  return typeof e === "string" && e.trim() ? e.trim() : null;
}

/** Yükleme hatası: sunucunun JSON hatası, yoksa (ör. barındırmanın 413'ü) durum koduna göre */
export function uploadErrorText(status: number, body: unknown): string {
  const msg = errorOf(body);
  if (msg) return msg;
  if (status === 0) return "Bağlantı kurulamadı; internetinizi kontrol edip yeniden deneyin.";
  if (status === 413) return "Fotoğraf 2 MB'tan büyük; uygulama küçültemedi, yeniden deneyin.";
  if (status === 401 || status === 403) return "Oturum kapanmış; sayfayı yenileyip yeniden giriş yapın.";
  if (status >= 500) return "Fotoğraf kaydedilemedi; biraz sonra yeniden deneyin.";
  return `Fotoğraf yüklenemedi (hata ${status}).`;
}
