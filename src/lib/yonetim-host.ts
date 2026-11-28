/**
 * Yönetim konsolu (docs/planlar/yonetim-konsolu.md; docs/ROLLER.md › Asıl yönetici): panelle aynı uygulama ve aynı
 * veritabanı, ayrı alan adı (yonetim.laffogato.net), ayrı oturum, yalnız asıl yönetici. Bu dosya saf: konsolun adresi,
 * bir isteğin konsol adresine gelip gelmediği, konsol adresinde hangi yolların açık olduğu ve konsolun bağlantıları.
 * Proxy (src/proxy.ts) ve next.config.ts buradan okur. Testler: tests/yonetim-host.test.ts.
 *
 * Panel adresinde (ladmin.laffogato.net) hiçbir şey değişmez: proxy'nin oradaki kapsamı aynen kalır, konsolun kuralları
 * yalnız konsol alan adına bağlı eşleşmelerle (`has: host`) çalışır. Kasanın çağırdığı uçlar konsol adresinde açılmaz:
 * kasa yanlışlıkla konsol adresine ayarlanırsa 404 ve `yanlis_adres` alır.
 */

import { posEnv } from "./asilpos/env";
import { KANAL_ALANI } from "./asilpos/eski-adlar";

type Env = Record<string, string | undefined>;

/**
 * Konsolun alan adları: canlı ad ve yerel deneme adı (`yonetim.localhost:3000`). Proxy'nin eşleştiricisi sabit olmak
 * zorunda (ortam değişkeni okuyamaz), aynı iki ad orada da yazılı (tests/yonetim-host.test.ts ikisini karşılaştırır).
 * `YONETIM_URL` yalnız bu adlardan birini gösterebilir: başka bir adda konsolun kuralları çalışmaz, tam panel açılırdı.
 */
export const YONETIM_HOSTLARI = ["yonetim.laffogato.net", "yonetim.localhost"] as const;

/** Konsolun varsayılan adresi (ortamda `YONETIM_URL` yoksa ya da geçersizse) */
export const YONETIM_VARSAYILAN = "https://yonetim.laffogato.net";

/** Konsolun kök yolu ve girişi (iki adreste de aynı) */
export const YONETIM_YOLU = "/yonetim";
export const YONETIM_GIRIS = "/yonetim/giris";
/** Geçersiz konsol çerezini silip girişe gönderen yol (route handler; çerez yalnız adresteki özet tutarsa silinir) */
export const YONETIM_OTURUM_BITTI = "/yonetim/oturum-bitti";

/** Panelin adresi (`APP_URL`): parola sıfırlama, "ladmin'e git" ve kurulum bağlantıları hep buradan */
export const PANEL_VARSAYILAN = "https://ladmin.laffogato.net";

/** Konsol girişi: iki adımlı zorunluyken (ADMIN_2FA_REQUIRED) kurmamış asıl yönetici; kurulum panelde (panel oturumu ister) */
export const YONETIM_KURULUM_GEREKLI = "İki adımlı doğrulama zorunlu. Önce ladmin'e girip kurun, sonra buradan girin.";

/** Kasa yanlışlıkla konsol adresine ayarlanırsa `/api/*` yanıtının gövdesi (404) */
export const YANLIS_ADRES = { error: "yanlis_adres" } as const;

/** Host başlığından ad: küçük harf, kapı numarası ve sondaki nokta atılır */
export function hostAdi(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().split(":", 1)[0].replace(/\.$/, "");
}

/** İstek konsolun adresine mi geldi (Host başlığı; adlar YONETIM_HOSTLARI) */
export function isYonetimHost(host: string | null | undefined): boolean {
  return (YONETIM_HOSTLARI as readonly string[]).includes(hostAdi(host));
}

/** Adres kökeni (sonunda / yok): https, yerel adlarda http de; konsolda ayrıca ad YONETIM_HOSTLARI'ndan. Geçersizse null */
function koken(value: string | undefined, konsol: boolean): string | null {
  const v = value?.trim();
  if (!v) return null;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return null;
  }
  const yerel = url.hostname === "localhost" || url.hostname.endsWith(".localhost");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && yerel)) return null;
  if (url.username || url.password) return null;
  if (konsol && !isYonetimHost(url.host)) return null;
  return url.origin;
}

/**
 * Ortamda açıkça tanımlı ve geçerli konsol adresi, yoksa null. Panel adresindeki `/yonetim` yalnız bu varken konsola
 * yönlenir (next.config.ts): alan adı Vercel'e eklenmeden önce konsol panel adresinde denenebilsin
 */
export function yonetimUrlAcik(env: Env = process.env): string | null {
  return koken(env.YONETIM_URL, true);
}

/**
 * Panel adresindeki `/yonetim/*` için next.config.ts yönlendirmesi: yalnız `YONETIM_URL` ortamda açıkça tanımlı ve
 * geçerliyse, yalnız panelin alan adında (`has: host`, tam ad), geçici. Değişken yoksa boş: panel adresinde konsol kendi
 * girişiyle doğrudan açılır (alan adı Vercel'e eklenmeden önce denenebilsin)
 */
export function panelYonetimYonlendirmesi(panelHost: string, env: Env = process.env) {
  const hedef = yonetimUrlAcik(env);
  if (!hedef) return [];
  const value = panelHost.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [{ source: `${YONETIM_YOLU}/:path*`, has: [{ type: "host" as const, value }], destination: `${hedef}${YONETIM_YOLU}/:path*`, permanent: false }];
}

/** Konsolun adresi: `YONETIM_URL` (geçerliyse), yoksa YONETIM_VARSAYILAN; sonunda / yok */
export function yonetimUrl(env: Env = process.env): string {
  return yonetimUrlAcik(env) ?? YONETIM_VARSAYILAN;
}

/** Panelin adresi: `APP_URL` (sunucunun `appUrl()`'iyle aynı kural), yoksa PANEL_VARSAYILAN; sonunda / yok */
export function panelUrl(env: Env = process.env): string {
  return (env.APP_URL?.trim() || PANEL_VARSAYILAN).replace(/\/+$/, "");
}

/** Konsola ait mutlak bağlantı (`yol` / ile başlar): ör. yonetimLink("/yonetim/lisans") */
export function yonetimLink(yol: string, env: Env = process.env): string {
  return `${yonetimUrl(env)}${yol.startsWith("/") ? yol : `/${yol}`}`;
}

/**
 * Konsolun panele verdiği bağlantılar: hepsi `APP_URL`'den, isteğin geldiği adresten değil (kasa kurulum bağlantısı ya
 * da parola sıfırlama konsolu göstermesin). "Parolamı unuttum" panelin giriş sayfasını sıfırlama adımında açar
 */
export function panelBaglantilari(env: Env = process.env) {
  const app = panelUrl(env);
  return { ladmin: `${app}/panel`, giris: `${app}/giris`, parolaUnuttum: `${app}/giris?parola=unuttum` } as const;
}

/** Konsolun sekmeleri (kabuk: src/app/yonetim/(konsol)/layout.tsx) */
export const KONSOL_SEKMELERI = [
  { href: YONETIM_YOLU, label: "Şubeler ve kasalar" },
  { href: `${YONETIM_YOLU}/lisans`, label: "Lisans ve güncelleme" },
] as const;

/** Lisans ve güncelleme sekmesinin sabit açıklaması */
export const LISANS_ACIKLAMA =
  "Lisans, dükkânlar ve güncelleme gönderme AsilPOS Merkez'de; AsilPOS Uzaktan'daki üye girişinizle girilir, ladmin parolasıyla değil.";

/**
 * AsilPOS Merkez'in adresi (lisans, dükkânlar, güncelleme gönderme; AsilPOS Uzaktan'ın `/merkez`'i, üye girişiyle):
 * Uzaktan'ın ortamdaki adresi (`ASILPOS_CLOUD_URL` ya da eski adı, src/lib/asilpos/env.ts), yoksa kanalın alan adı
 * (KANAL_ALANI). Yalnız https kökeni alınır
 */
export function merkezUrl(env: Env = process.env): string {
  const varsayilan = `https://${KANAL_ALANI}`;
  let kok = varsayilan;
  try {
    const u = new URL(posEnv("CLOUD_URL", env)?.trim() || varsayilan);
    if (u.protocol === "https:" && !u.username && !u.password) kok = u.origin;
  } catch {
    // geçersiz adres: varsayılan
  }
  return `${kok}/merkez`;
}

/** Yol `taban`ın kendisi ya da altında mı (yol parçası sınırında: "/yonetim" ve "/yonetim/…" evet, "/yonetimx" hayır) */
function altinda(yol: string, taban: string): boolean {
  return yol === taban || yol.startsWith(`${taban}/`);
}

/** Konsol adresinde açık olan tek tek yollar (simgeler, robots, tarayıcının CSP raporu ve hata bildirimi) */
const ACIK_YOLLAR: readonly string[] = ["/favicon.ico", "/icon.png", "/apple-icon.png", "/robots.txt", "/api/csp-rapor", "/api/hata"];
/** Konsol adresinde altıyla birlikte açık olan yollar: konsolun kendisi, Next'in derlenmiş dosyaları, simge klasörleri */
const ACIK_KLASORLER: readonly string[] = [YONETIM_YOLU, "/_next", "/icons", "/brand"];

/** Konsol adresinde bir isteğin ne olacağı */
export type KonsolKarari =
  /** İzin listesinde: olduğu gibi geçer */
  | { tur: "gec" }
  /** Konsolun karşılığına (sorgu düşer) */
  | { tur: "yonlendir"; hedef: string }
  /** `/api/*`: 404 ve gövde YANLIS_ADRES (kasa yanlış adrese ayarlanırsa anlaşılır hata) */
  | { tur: "yanlis-adres" }
  /** Başka her şey (kasa kurucusunun indirme yolları, /davet, /baglan, /menu, OAuth, manifest…): 404 */
  | { tur: "yok" };

/**
 * Konsol adresindeki yolun kararı. İzin listesi: `/yonetim/*`, `/_next/*`, simgeler, robots.txt, CSP raporu ve hata
 * bildirimi. Kök adres `/yonetim`'e, `/panel/*` konsola, `/giris/*` konsolun girişine yönlenir; `/api/*` 404
 * `yanlis_adres`; gerisi 404
 */
export function konsolYolu(pathname: string): KonsolKarari {
  if (ACIK_YOLLAR.includes(pathname) || ACIK_KLASORLER.some((k) => altinda(pathname, k))) return { tur: "gec" };
  if (pathname === "/" || altinda(pathname, "/panel")) return { tur: "yonlendir", hedef: YONETIM_YOLU };
  if (altinda(pathname, "/giris")) return { tur: "yonlendir", hedef: YONETIM_GIRIS };
  if (altinda(pathname, "/api")) return { tur: "yanlis-adres" };
  return { tur: "yok" };
}
