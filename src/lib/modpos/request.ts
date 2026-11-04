import { addDays, dayMonthTR, todayTR } from "@/lib/reminders";

import { isFoyDay, type FoyHata } from "./foy";

/**
 * ModPOS Kasa Föyü API'sinin isteği, kotası ve hata metinleri (saf; sunucu ve testler paylaşır; tests/modpos-foy.test.ts).
 * Belge: docs/modpos-kasa-foyu-api.md; kurgu: docs/MODPOS-API.md.
 *
 * Anahtar yalnız sunucuda: `MODPOS_API_KEY` (Vercel › Production). Yoksa bağlantı kapalıdır ("Kurulmadı"), hiçbir istek
 * gitmez. `MODPOS_API_URL` (isteğe bağlı) ucun adresi; `MODPOS_SYNC_FROM` (isteğe bağlı, YYYY-MM-DD) geçmişin geriye
 * doğru tamamlanacağı ilk gün.
 */

export const MODPOS_DEFAULT_URL = "https://api.gafdigi.com/api/v2/external/raporlar/kasa-foyu";
/** Geçmiş föylerin geriye doğru tamamlanacağı ilk gün: kafenin ilk ayı (MODPOS_SYNC_FROM yoksa) */
export const MODPOS_DEFAULT_FROM = "2026-07-01";
/** Günlük hak (belge §4); yanıtın başlığı başka bir sayı derse o geçerli */
export const MODPOS_DAILY_QUOTA = 2;
/** Belgenin önerdiği istemci zaman aşımı */
export const MODPOS_TIMEOUT_MS = 60_000;

type Env = Record<string, string | undefined>;

/** Anahtarın sorunu: yok ya da biçimi bozuk (boşluk / satır sonu içeriyor, çok kısa); sorun yoksa null */
export function modposKeyProblem(env: Env): "missing" | "format" | null {
  const raw = env.MODPOS_API_KEY;
  if (raw === undefined || !raw.trim()) return "missing";
  const v = raw.trim();
  if (/\s/.test(v) || v.length < 16 || v.length > 512) return "format";
  return null;
}

/** Kullanılabilir anahtar (yoksa ya da bozuksa null) */
export function modposKeyFrom(env: Env): string | null {
  return modposKeyProblem(env) === null ? env.MODPOS_API_KEY!.trim() : null;
}

/** Ucun adresi: MODPOS_API_URL (https olmalı) ya da belgedeki adres */
export function modposUrlFrom(env: Env): string {
  const v = env.MODPOS_API_URL?.trim();
  return v && /^https:\/\/[^\s?#]+$/.test(v) ? v.replace(/\/+$/, "") : MODPOS_DEFAULT_URL;
}

/** Geçmişin ilk günü: MODPOS_SYNC_FROM (takvimde olan gün) ya da kafenin ilk ayının ilk günü */
export function modposSyncFrom(env: Env): string {
  return modposSyncFromSet(env) ? env.MODPOS_SYNC_FROM!.trim() : MODPOS_DEFAULT_FROM;
}

/** MODPOS_SYNC_FROM geçerli bir günle kurulu mu: kuruluysa geçmiş dünden o güne kadar geriye çekilir */
export function modposSyncFromSet(env: Env): boolean {
  const v = env.MODPOS_SYNC_FROM?.trim();
  return Boolean(v && isFoyDay(v));
}

/** İstenen günün adresi */
export function foyUrl(base: string, day: string): string {
  return `${base}?tarih=${encodeURIComponent(day)}`;
}

/** Son bilinen kota (yanıt başlıklarından ya da föyün `<kota>`'sından); `day` gözlendiği Türkiye günü */
export interface ModposQuota {
  day: string;
  hak: number;
  kalan: number;
  /** Hakkın yenileneceği an (ofsetli) */
  yenilenme: string | null;
  /** Gözlendiği an */
  at: string;
}

/** Başlıklardan kota: X-Kota-Hak, X-Kota-Kalan, X-Kota-Yenilenme (biri yoksa ya da bozuksa null) */
export function quotaFromHeaders(get: (name: string) => string | null, now: Date): ModposQuota | null {
  // Eksik ya da boş başlık 0 değildir (Number(null) = 0): hak 0 sanılsa ertesi günlerde hiç istek gitmezdi
  const rawHak = get("x-kota-hak")?.trim();
  const rawKalan = get("x-kota-kalan")?.trim();
  if (!rawHak || !rawKalan) return null;
  const hak = Number(rawHak);
  const kalan = Number(rawKalan);
  if (!Number.isInteger(hak) || !Number.isInteger(kalan) || hak < 0 || kalan < 0) return null;
  const y = get("x-kota-yenilenme")?.trim() || null;
  return { day: todayTR(now), hak, kalan, yenilenme: y && !Number.isNaN(Date.parse(y)) ? y : null, at: now.toISOString() };
}

/**
 * Şu an kalan hak: son bilinen kota bugünün (TR) ve yenilenme anı gelmediyse onun kalanı; yoksa günlük hakkın tamamı.
 * Gün Türkiye saatiyle 00:00'da başlar (belge §4); sınır isteğin yapıldığı güne göre sayılır. Yeni günün hakkı en az
 * 1'dir: kota yalnız yanıttan öğrenilir, saklanan "hak 0" yeni günde de 0 sayılsa hiç istek gitmez, kota da hiç
 * yenilenmezdi (429 hak düşürmez; gerçekten hak yoksa ilk istek KOTA_DOLDU alır ve durur).
 */
export function quotaLeft(q: ModposQuota | null, now: Date): number {
  const daily = q && q.hak >= 1 ? q.hak : MODPOS_DAILY_QUOTA;
  if (!q || q.day !== todayTR(now)) return daily;
  if (q.yenilenme && now.getTime() >= Date.parse(q.yenilenme)) return daily;
  return Math.max(0, q.kalan);
}

/** Hakkın yenileneceği an: bilinen yenilenme ya da yarının 00:00'ı (TR) */
export function quotaRenewsAt(q: ModposQuota | null, now: Date): string {
  if (q?.yenilenme && q.day === todayTR(now)) return q.yenilenme;
  return `${addDays(todayTR(now), 1)}T00:00:00+03:00`;
}

/** Anahtarın kendisiyle ilgili hatalar: düzeltilmeden hiçbir gün çekilemez (gün gün denemek anlamsız) */
const KEY_ERRORS = new Set(["ANAHTAR_GEREKLI", "ANAHTAR_GECERSIZ", "ANAHTAR_PASIF", "ANAHTAR_SURESI_DOLDU", "IP_IZINSIZ", "YETKI_YOK", "KAPSAM_GECERSIZ"]);

export function isKeyError(kod: string): boolean {
  return KEY_ERRORS.has(kod);
}

/** "00:00" biçiminde saat (TR) */
function hourTR(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(new Date(t));
}

/** Yenilenme anının yazısı: "bu gece 00:00'da" ya da "4 Kasım 00:00'da" */
export function renewText(iso: string | null, now: Date): string {
  const h = hourTR(iso);
  if (!iso || !h) return "gece yarısı";
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(Date.parse(iso)));
  return day === addDays(todayTR(now), 1) && h === "00:00" ? "bu gece 00:00'da" : `${dayMonthTR(day)} ${h}'da`;
}

/**
 * Servisin hata yanıtının yöneticiye okunur açıklaması (UserError gibi: kısa, sonda nokta yok, ne yapılacağı iki
 * noktadan sonra). Kod tanınmazsa servisin mesajı ve HTTP durumu
 */
export function modposErrorText(status: number, hata: FoyHata | null, now: Date = new Date()): string {
  const kod = hata?.kod ?? "";
  switch (kod) {
    case "ANAHTAR_GEREKLI":
    case "ANAHTAR_GECERSIZ":
      return "ModPOS API anahtarı geçersiz: Vercel'deki MODPOS_API_KEY'i kontrol edin";
    case "ANAHTAR_PASIF":
      return "ModPOS API anahtarı kullanıma kapalı: Gafdigi'den anahtarı açtırın";
    case "ANAHTAR_SURESI_DOLDU":
      return "ModPOS API anahtarının süresi dolmuş: Gafdigi'den yeni anahtar alıp Vercel'e yazın";
    case "IP_IZINSIZ":
      return "ModPOS isteği panelin sunucusundan kabul etmiyor (IP kısıtı): Gafdigi'den anahtarın IP kısıtını kaldırtın, Vercel'in sabit IP'si yok";
    case "YETKI_YOK":
      return "ModPOS API anahtarının rapor yetkisi yok: Gafdigi'den kasa föyü yetkisi isteyin";
    case "KAPSAM_GECERSIZ":
      return "ModPOS API anahtarı bir markaya ya da şubeye bağlı değil: Gafdigi'den anahtarı işletmeye bağlatın";
    case "KOTA_DOLDU":
      return `ModPOS API'nin günlük ${hata?.gunlukHak ?? MODPOS_DAILY_QUOTA} çekim hakkı doldu: hak ${renewText(hata?.yenilenme ?? null, now)} yenilenir`;
    case "COK_FAZLA_ISTEK":
      return "ModPOS kısa sürede çok istek aldı: birkaç dakika sonra yeniden deneyin";
    case "RAPOR_URETILEMEDI":
      return "ModPOS API veriyi hazırlayamadı (hak geri verildi): sonra yeniden denenecek";
    case "SERVIS_KULLANILAMIYOR":
      return "ModPOS servisi şu an kullanılamıyor: sonra yeniden denenecek";
    case "TARIH_GEREKLI":
    case "TARIH_GECERSIZ":
      return "ModPOS tarihi kabul etmedi (geçersiz gün)";
    case "ILERI_TARIH":
      return "ModPOS API ileri tarihi kabul etmedi: yalnız bugün ve önceki günler çekilir";
  }
  if (status === 429) return "ModPOS istek sınırına takıldı: sonra yeniden denenecek";
  if (status >= 500) return `ModPOS şu an yanıt vermiyor (HTTP ${status}): sonra yeniden denenecek`;
  const msg = hata?.mesaj ? `: ${hata.mesaj.slice(0, 160)}` : "";
  return `ModPOS isteği kabul etmedi (HTTP ${status}${kod ? `, ${kod}` : ""})${msg}`;
}

/** İstenebilecek gün: takvimde olan, bugünden (TR) sonra olmayan (ileri tarih kabul edilmez) */
export function requestableDay(day: string, now: Date): boolean {
  return isFoyDay(day) && day <= todayTR(now);
}
