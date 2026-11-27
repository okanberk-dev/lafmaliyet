// Şube kurulumu (docs/ASILPOS.md › Şube kurulumu): ana yönetici şubeyi e-postasıyla ekler; şubenin panel hesabı açılır,
// şubeye özel AsilPOS kurucusunun indirme bağlantısı e-postayla gider ve şube hesabının Hesabım sayfasında durur. Kurucu
// (AsilPOS-Kur.cmd) içinde panelin adresi ve tek kullanımlık kurulum kodu taşır; kasa ilk açılışta kodu bir kez verip
// şubesini ve bağlantı bilgilerini alır (POST /api/asilpos/kurulum; kurulu eski kasalar eski yolu çağırır, ikisi aynı
// işleyici). Bu dosya saf (tests/asilpos-kurulum.test.ts).

import { posEnv, type PosEnvKey } from "./env";
import { ESKI_WEB_KURUCU, KANAL_ALANI, TEL_UZAK_ADRES_ENV, TEL_UZAK_ANAHTAR_ENV } from "./eski-adlar";

/** Şube ekleyebilen tek hesap (sahibin kararı, 26 Kasım 2026). Ortamda LADMIN_ANA_ADMIN ile değişir */
export const ANA_ADMIN_EMAIL = "info@nextgenlab.com.tr";

export function anaAdminEmail(env: Record<string, string | undefined> = process.env): string {
  const v = env.LADMIN_ANA_ADMIN?.trim().toLowerCase();
  return v && v.includes("@") ? v : ANA_ADMIN_EMAIL;
}

/** Ana yönetici mi: yönetici rolünde ve e-postası ana yöneticininki (büyük-küçük harf fark etmez) */
export function isAnaAdmin(user: { role: string; email: string } | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  return !!user && user.role === "admin" && user.email.trim().toLowerCase() === anaAdminEmail(env);
}

export const ANA_ADMIN_ONLY = "Şube yalnız ana yönetici hesabıyla eklenir";

/**
 * Hesabım › AsilPOS kurulumu kartını gören tek hesap: şubenin kendi hesabı, yani bağlantının gittiği adresteki, o şubeye
 * kilitli personel hesabı (büyük-küçük harf ve boşluk fark etmez). Şubenin öbür personeli (ortak tablette sırayla giren
 * baristalar), müdürü, muhasebeci ve yönetici görmez: bağlantıdaki kod kasanın eşitleme anahtarını verir
 * (POST /api/asilpos/kurulum) ve tek kullanımlıktır. Şube hesabı yalnız personel olabilir (`branchEmailTaken`); yönetici
 * bağlantıyı Şubeler'de görür (yalnız ana yönetici)
 */
export function isBranchAccount(user: { role: string; email: string; branchId?: string | null }, install: { branchId: string; email: string }): boolean {
  const norm = (v: string) => v.trim().toLowerCase();
  return user.role === "staff" && !!user.branchId && user.branchId === install.branchId && norm(user.email) === norm(install.email);
}

/** Kurulum kodu ve indirme bağlantısının ömrü */
export const KURULUM_GUN = 14;
/** Kod: 32 bayt rastgele, base64url (43 karakter); AsilPOS 24–128 karakter, harf-rakam-alt çizgi-tire kabul eder */
export const KOD_RE = /^[A-Za-z0-9_-]{24,128}$/;

/** Kanaldaki genel kurucunun yeni adı */
export const WEB_KURUCU = "AsilPOS-Kur.cmd";

/**
 * Kanaldaki genel kurucu (herkese açık; içinde anahtar yok), denenme sırasıyla: önce yeni ad, kanal onu henüz
 * yayımlamıyorsa (404) eski ad. Kanalın alan adı değişmedi
 */
export const KURUCU_URLLERI: readonly string[] = [`https://${KANAL_ALANI}/guncelleme/${WEB_KURUCU}`, `https://${KANAL_ALANI}/guncelleme/${ESKI_WEB_KURUCU}`];

/** İndirilecek kurucunun adayları: ortamda ASILPOS_KURUCU_URL (ya da eski adı) tanımlıysa yalnız o, yoksa KURUCU_URLLERI */
export function kurucuAdresleri(env: Record<string, string | undefined> = process.env): string[] {
  const own = posEnv("KURUCU_URL", env)?.trim();
  return own ? [own] : [...KURUCU_URLLERI];
}

/**
 * Genel kurucuyu indirir: adaylar sırayla denenir, 404'te sonrakine geçilir (kanal yeni adı yayımlamamış olabilir);
 * başka hata ya da son adayın 404'ü hata verir
 */
export async function fetchKurucu(urls: readonly string[], fetchImpl: typeof fetch = fetch): Promise<string> {
  for (const [i, url] of urls.entries()) {
    const res = await fetchImpl(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (res.ok) return res.text();
    if (res.status !== 404 || i === urls.length - 1) throw new Error(`HTTP ${res.status} (${url})`);
  }
  throw new Error("Kurucu adresi yok");
}

const ADRES_SATIRI = "$KurulumAdresi = ''";
const KOD_SATIRI = "$KurulumKodu = ''";

/**
 * Genel kurucuya şubenin adresini ve kodunu yazar: kurucudaki iki boş satır (`$KurulumAdresi = ''`, `$KurulumKodu = ''`)
 * doldurulur. Satır yoksa (eski kurucu) ya da değer biçime uymuyorsa hata: kodsuz kurucu şubeye bağlanmaz
 */
export function kurucuWithCode(cmd: string, adres: string, kod: string): string {
  if (!KOD_RE.test(kod)) throw new Error("Kurulum kodu geçersiz");
  const origin = new URL(adres).origin;
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(origin) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) throw new Error("Panel adresi https olmalı");
  if (cmd.split(ADRES_SATIRI).length !== 2 || cmd.split(KOD_SATIRI).length !== 2) throw new Error("Kurucu şube kodunu taşımıyor (AsilPOS güncel değil)");
  return cmd.replace(ADRES_SATIRI, () => `$KurulumAdresi = '${origin}'`).replace(KOD_SATIRI, () => `$KurulumKodu = '${kod}'`);
}

/** İndirilen dosyanın adı: `AsilPOS-Kur-kadikoy.cmd` */
export const kurucuDosyaAdi = (branchId: string) => `AsilPOS-Kur-${branchId.replace(/[^a-z0-9-]/g, "")}.cmd`;

export type KurulumDurumu = "bekliyor" | "kuruldu" | "suresi-doldu" | "iptal";

export function kurulumDurumu(row: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now: Date = new Date()): KurulumDurumu {
  if (row.usedAt) return "kuruldu";
  if (row.revokedAt) return "iptal";
  if (row.expiresAt.getTime() <= now.getTime()) return "suresi-doldu";
  return "bekliyor";
}

export const KURULUM_DURUM_ETIKET: Record<KurulumDurumu, string> = {
  bekliyor: "Kurulum bekliyor",
  kuruldu: "Kasa kuruldu",
  "suresi-doldu": "Süresi doldu",
  iptal: "İptal edildi",
};

/** Kasaya verilecek bağlantılar (AsilPOS'un ayarlar dosyasındaki adlarıyla); yalnız tanımlı ve yeterince uzun olanlar */
export function kurulumBaglantilari(o: {
  panelUrl: string;
  syncSecret: string | null;
  env?: Record<string, string | undefined>;
}): Record<string, string> {
  const env = o.env ?? process.env;
  const out: Record<string, string> = { LAFMALIYET_URL: new URL(o.panelUrl).origin };
  if (o.syncSecret && o.syncSecret.length >= 32) out.LAFMALIYET_SYNC_SECRET = o.syncSecret;
  const pair = (urlKey: PosEnvKey, secretKey: PosEnvKey, toUrl: string, toSecret: string) => {
    const url = posEnv(urlKey, env)?.trim();
    const secret = posEnv(secretKey, env)?.trim();
    if (url && secret && secret.length >= 32) {
      out[toUrl] = url;
      out[toSecret] = secret;
    }
  };
  // AsilPOS Uzaktan (Merkez, uzaktan yönetim) ve site: panelin ortamında tanımlıysa (ASILPOS_* ya da eski adı). Kasaya
  // giden anahtar adları kasanın ayarlar dosyasınınkiler: Uzaktan'ınki eski adla gider (kurulu kasanın beyaz listesi;
  // `surum` özeti adları da kapsar, ad değişirse her kasa ayarını yeniden yazıp yeniden başlar)
  pair("CLOUD_URL", "CLOUD_SECRET", TEL_UZAK_ADRES_ENV, TEL_UZAK_ANAHTAR_ENV);
  pair("SITE_URL", "SITE_SECRET", "LAFFOGATO_URL", "LAFFOGATO_SYNC_SECRET");
  return out;
}

/** İndirme bağlantısı: `https://ladmin.laffogato.net/asilpos/indir/<kod>` */
export const kurulumLink = (panelUrl: string, kod: string) => `${new URL(panelUrl).origin}/asilpos/indir/${encodeURIComponent(kod)}`;
