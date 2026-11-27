// Şube kurulumu (docs/LAFPOS.md › Şube kurulumu): ana yönetici şubeyi e-postasıyla ekler; şubenin panel hesabı açılır,
// şubeye özel LafPOS kurucusunun indirme bağlantısı e-postayla gider ve şube hesabının Hesabım sayfasında durur. Kurucu
// (LafPOS-Kur.cmd) içinde panelin adresi ve tek kullanımlık kurulum kodu taşır; kasa ilk açılışta kodu bir kez verip
// şubesini ve bağlantı bilgilerini alır (POST /api/lafpos/kurulum). Bu dosya saf (tests/lafpos-kurulum.test.ts).

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
 * Hesabım › LafPOS kurulumu kartını gören tek hesap: şubenin kendi hesabı, yani bağlantının gittiği adresteki, o şubeye
 * kilitli personel hesabı (büyük-küçük harf ve boşluk fark etmez). Şubenin öbür personeli (ortak tablette sırayla giren
 * baristalar), müdürü, muhasebeci ve yönetici görmez: bağlantıdaki kod kasanın eşitleme anahtarını verir
 * (POST /api/lafpos/kurulum) ve tek kullanımlıktır. Şube hesabı yalnız personel olabilir (`branchEmailTaken`); yönetici
 * bağlantıyı Şubeler'de görür (yalnız ana yönetici)
 */
export function isBranchAccount(user: { role: string; email: string; branchId?: string | null }, install: { branchId: string; email: string }): boolean {
  const norm = (v: string) => v.trim().toLowerCase();
  return user.role === "staff" && !!user.branchId && user.branchId === install.branchId && norm(user.email) === norm(install.email);
}

/** Kurulum kodu ve indirme bağlantısının ömrü */
export const KURULUM_GUN = 14;
/** Kod: 32 bayt rastgele, base64url (43 karakter); LafPOS 24–128 karakter, harf-rakam-alt çizgi-tire kabul eder */
export const KOD_RE = /^[A-Za-z0-9_-]{24,128}$/;

/** Kanaldaki genel kurucu (herkese açık; içinde anahtar yok). Ortamda LAFPOS_KURUCU_URL ile değişir */
export const KURUCU_URL = "https://lafpos.laffogato.net/guncelleme/LafPOS-Kur.cmd";

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
  if (cmd.split(ADRES_SATIRI).length !== 2 || cmd.split(KOD_SATIRI).length !== 2) throw new Error("Kurucu şube kodunu taşımıyor (LafPOS güncel değil)");
  return cmd.replace(ADRES_SATIRI, () => `$KurulumAdresi = '${origin}'`).replace(KOD_SATIRI, () => `$KurulumKodu = '${kod}'`);
}

/** İndirilen dosyanın adı: `LafPOS-Kur-kadikoy.cmd` */
export const kurucuDosyaAdi = (branchId: string) => `LafPOS-Kur-${branchId.replace(/[^a-z0-9-]/g, "")}.cmd`;

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

/** Kasaya verilecek bağlantılar (LafPOS'un ayarlar dosyasındaki adlarıyla); yalnız tanımlı ve yeterince uzun olanlar */
export function kurulumBaglantilari(o: {
  panelUrl: string;
  syncSecret: string | null;
  env?: Record<string, string | undefined>;
}): Record<string, string> {
  const env = o.env ?? process.env;
  const out: Record<string, string> = { LAFMALIYET_URL: new URL(o.panelUrl).origin };
  if (o.syncSecret && o.syncSecret.length >= 32) out.LAFMALIYET_SYNC_SECRET = o.syncSecret;
  const pair = (urlKey: string, secretKey: string, toUrl: string, toSecret: string) => {
    const url = env[urlKey]?.trim();
    const secret = env[secretKey]?.trim();
    if (url && secret && secret.length >= 32) {
      out[toUrl] = url;
      out[toSecret] = secret;
    }
  };
  // LafPOS Uzaktan (Merkez, uzaktan yönetim) ve site: panelin ortamında tanımlıysa
  pair("LAFPOS_CLOUD_URL", "LAFPOS_CLOUD_SECRET", "LAFPOS_CLOUD_URL", "LAFPOS_CLOUD_SECRET");
  pair("LAFPOS_SITE_URL", "LAFPOS_SITE_SECRET", "LAFFOGATO_URL", "LAFFOGATO_SYNC_SECRET");
  return out;
}

/** İndirme bağlantısı: `https://ladmin.laffogato.net/lafpos/indir/<kod>` */
export const kurulumLink = (panelUrl: string, kod: string) => `${new URL(panelUrl).origin}/lafpos/indir/${encodeURIComponent(kod)}`;
