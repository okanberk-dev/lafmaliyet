import { z } from "zod";

import { posEnv, posEnvName, type PosEnvKey } from "./env";
import { SITE_KASA_ANAHTAR_ENV, SITE_KASA_ONCEKI_ENV, TEL_UZAK_ANAHTAR_ENV, UZAK_ONCEKI_ENV, UZAKTAN_PROJESI } from "./eski-adlar";

/**
 * Anahtar değişiminin uyumu (docs/ASILPOS.md › Şube kurulumu › Anahtar değişimi). Panel kasalara AsilPOS Uzaktan'ın ve
 * sitenin (laffogato.net) adresini ve anahtarını dağıtır (`GET /api/panel/pos/baglanti`); kasa değişeni gün kapanınca
 * uygular ve sonraki sorgularda `uygulanan=<sürüm>` der. 26 Kasım 2026'da iki anahtar panelde değişti, kasa gece yenisine
 * geçti, ama Uzaktan ve site eskisini tutuyordu: kasanın her isteği reddedildi, Uzaktan perşembe bütün gün dondu.
 *
 * Panel bu yüzden kendi değerinin iki uçta kabul edildiğini sınar: kasanın da çağırdığı ucuz, imzalı, veri vermeyen birer
 * uca (`SINAMA_YOLU`) panelin dağıttığı anahtarla imzalı bir GET. Sınama günde birkaç kez: sabah işi, Ayarlar ›
 * AsilPOS › Anahtarları sına ve kasa bağlantıyı sorunca (aynı değerler için en çok saatte bir; değerler değişince hemen):
 * yalnız Uzaktan ya da site değişse de en geç bir saatte görülür. Sonuç ve kasaların raporu `integration_state`'in
 * `ANAHTAR_UYUMU_KEY` satırında; anahtar, imza ve yanıtın gövdesi hiçbir yere yazılmaz. Uç reddederse (401) ya da
 * anahtarı yoksa (503) Ayarlar › AsilPOS'ta ve yöneticinin zilinde uyarı, sınama geçince kalkar. Kasa yeni değeri
 * uyguladıysa (ya da bilinmiyorsa) uyarı kırmızı: kasa şu an reddediliyor; yalnız bekliyorsa turuncu: gün kapanmadan
 * düzeltilirse hiçbir şey durmaz.
 *
 * İki anahtarlı geçiş (inceleme 27 Kasım): Uzaktan ve sitenin yeni sürümü imzalı isteğe verdiği 2xx yanıtta panelin
 * anahtarının hangi değerle eşleştiğini söyler (`ANAHTAR_BASLIGI`: `simdiki` ya da `onceki`; sır yok). Başlığı gören
 * panel o ucun önceki anahtarı (`_ONCEKI`) tanıdığını bilir (`destek`); görmediyse (eski sürüm) turuncu uyarının adımı
 * uçtaki değeri değiştirtmez, paneli eskiye döndürtür: `_ONCEKI`'yi tanımayan uçta değeri değiştirmek bekleyen kasayı
 * hemen keserdi. Uç panelin değerini yalnız önceki değer olarak kabul ediyorsa turuncu "panelin anahtarı eski"
 * (`_ONCEKI` silinmesin). Uzaktan'ın açık durum ucu `_ONCEKI` tanımlı mı söyler (`ONCEKI_BAYRAGI_YOLU`); bütün kasalar
 * güncel değeri uyguladığı hâlde tanımlıysa silmeyi hatırlatır.
 *
 * Saf (tarayıcıda da çalışır; imza ve istek src/server/asilpos/anahtar-uyumu.ts'te). Testleri
 * tests/asilpos-anahtar-uyumu.test.ts.
 */

type Env = Record<string, string | undefined>;

/** integration_state anahtarı (yeni kayıt: eski adı yok) */
export const ANAHTAR_UYUMU_KEY = "asilpos-anahtar-uyumu";

export type Hedef = "uzaktan" | "site";
export const HEDEFLER: readonly Hedef[] = ["uzaktan", "site"];
export const HEDEF_ADI: Record<Hedef, string> = { uzaktan: "AsilPOS Uzaktan", site: "laffogato.net" };

/**
 * Sınanan uç: kasanın da aynı anahtarla çağırdığı, imzalı ve ucuz. Uzaktan'ınki platform anahtarları (şubesiz sorguda
 * boş liste döner, Redis'e dokunmaz), sitenin ucu sipariş sürümü (veri yok, yalnız işaret)
 */
export const SINAMA_YOLU: Record<Hedef, string> = { uzaktan: "/api/uzaktan/anahtarlar", site: "/api/pos/orders/version" };

/** Panelin değişkenleri (öneksiz; posEnv önce ASILPOS_, yoksa eski adı okur) */
const PANEL_ENV: Record<Hedef, { url: PosEnvKey; secret: PosEnvKey }> = {
  uzaktan: { url: "CLOUD_URL", secret: "CLOUD_SECRET" },
  site: { url: "SITE_URL", secret: "SITE_SECRET" },
};

/**
 * Uzaktan ve sitenin imzalı isteğe verdiği 2xx yanıttaki başlık: isteğin imzası şimdiki anahtarla mı (`simdiki`), önceki
 * anahtarla mı (`onceki`, `_ONCEKI`) tuttu. Sır taşımaz. Eski sürüm göndermez
 */
export const ANAHTAR_BASLIGI = "x-laf-anahtar";
export type AnahtarEslesmesi = "simdiki" | "onceki";

/**
 * Önceki anahtarın (`_ONCEKI`) tanımlı olduğunu söyleyen açık uç (imzasız, gövdesi `{ onceki: boolean }`): yalnız
 * Uzaktan'da (`/api/health`). Alan yoksa (eski sürüm) bilinmiyor
 */
export const ONCEKI_BAYRAGI_YOLU: Partial<Record<Hedef, string>> = { uzaktan: "/api/health" };

/** Bir sınamanın en uzun beklemesi */
export const SINAMA_ZAMAN_ASIMI_MS = 8_000;
/**
 * Kasa bağlantıyı sorunca yapılan sınamanın en sık aralığı (aynı değerler için; değerler değişince hemen). Kasanın raporu
 * değişmese de: yalnız Uzaktan ya da site değişirse (`_ONCEKI` erken silindi, değer `_ONCEKI`'siz değişti) uyarı en geç
 * bir saatte çıkar. Saatte en çok iki imzalı GET (ve Uzaktan'ın açık durum ucu)
 */
export const OTOMATIK_SINAMA_ARALIGI_MS = 60 * 60_000;
/** Elle sınamanın en sık aralığı: aynı değerlerle bundan yakın sınama yeniden istek atmaz, son sonucu verir */
export const ELLE_SINAMA_ARALIGI_MS = 15_000;
/** Kasanın raporu bu kadar eskiyse sayılmaz (kaldırılmış ya da kapalı kasa) */
export const KASA_RAPORU_GUN = 3;
/** Kasanın raporunun yeniden yazılma aralığı (değişmediyse): kasa 10 dakikada bir sorar, her soru yazılmaz */
export const KASA_RAPORU_TAZELEME_MS = 60 * 60_000;

export type SinamaDurumu = "ok" | "red" | "kapali" | "hata";
export type SinamaTetigi = "cron" | "elle" | "kasa";

export interface HedefSonucu {
  durum: SinamaDurumu;
  /** Ucun HTTP yanıtı; ulaşılamadıysa null */
  http: number | null;
  /** 2xx yanıtın `ANAHTAR_BASLIGI`'ı: panelin anahtarı uçta şimdiki mi, önceki mi; başlık yoksa (eski sürüm) alan yok */
  anahtar?: AnahtarEslesmesi;
  /** Uçta önceki anahtar (`_ONCEKI`) tanımlı mı (`ONCEKI_BAYRAGI_YOLU`); bilinmiyorsa alan yok */
  oncekiTanimli?: boolean;
}

export interface Sinama {
  at: string;
  /** Sınanan değerlerin sürümü (dagitilanBaglantilar surum): değerler değişince sonuç eskir */
  surum: string;
  tetik: SinamaTetigi;
  /** Yalnız panelin dağıttığı uçlar */
  sonuc: Partial<Record<Hedef, HedefSonucu>>;
}

/** Bir kasanın son bağlantı sorgusu: uyguladığı ve o an güncel olan sürüm */
export interface KasaRaporu {
  uygulanan: string;
  guncel: string;
  at: string;
}

/**
 * Uç önceki anahtarı (`_ONCEKI`) tanıyor mu: son 2xx yanıtında `ANAHTAR_BASLIGI` vardıysa true, yoksa false (eski
 * sürüm); hiç 2xx görülmediyse alan yok (bilinmiyor). Her 2xx yanıtla yenilenir (geri dönülen eski sürüm de görülür)
 */
export type OncekiDestegi = Partial<Record<Hedef, boolean>>;

export interface AnahtarUyumu {
  kasalar: Record<string, KasaRaporu>;
  sinama: Sinama | null;
  destek: OncekiDestegi;
}

const hedefSonucu = z
  .object({
    durum: z.enum(["ok", "red", "kapali", "hata"]),
    http: z.number().nullable().catch(null),
    anahtar: z.enum(["simdiki", "onceki"]).optional().catch(undefined),
    oncekiTanimli: z.boolean().optional().catch(undefined),
  })
  // Bozuk isteğe bağlı alan yok sayılır (alan hiç yazılmamış gibi)
  .transform(({ anahtar, oncekiTanimli, ...r }): HedefSonucu => ({ ...r, ...(anahtar ? { anahtar } : {}), ...(oncekiTanimli === undefined ? {} : { oncekiTanimli }) }));
const sinamaSchema = z.object({
  at: z.string(),
  surum: z.string(),
  tetik: z.enum(["cron", "elle", "kasa"]).catch("cron"),
  sonuc: z.object({ uzaktan: hedefSonucu.optional().catch(undefined), site: hedefSonucu.optional().catch(undefined) }),
});
const kasaSchema = z.object({ uygulanan: z.string().catch(""), guncel: z.string().catch(""), at: z.string() });

/** Kayıtlı değer; bozuk parça yok sayılır */
export function parseAnahtarUyumu(v: unknown): AnahtarUyumu {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const sinama = sinamaSchema.safeParse(o.sinama);
  const kasalar: Record<string, KasaRaporu> = {};
  if (o.kasalar && typeof o.kasalar === "object") {
    for (const [id, r] of Object.entries(o.kasalar as Record<string, unknown>)) {
      const p = kasaSchema.safeParse(r);
      if (p.success) kasalar[id] = p.data;
    }
  }
  const destek: OncekiDestegi = {};
  if (o.destek && typeof o.destek === "object") {
    for (const h of HEDEFLER) {
      const v = (o.destek as Record<string, unknown>)[h];
      if (typeof v === "boolean") destek[h] = v;
    }
  }
  return { kasalar, sinama: sinama.success ? sinama.data : null, destek };
}

/** Yanıtın `ANAHTAR_BASLIGI`'ı; yoksa ya da tanınmıyorsa null */
export function anahtarEslesmesi(v: string | null | undefined): AnahtarEslesmesi | null {
  const t = v?.trim().toLowerCase();
  return t === "simdiki" || t === "onceki" ? t : null;
}

/** Açık durum ucunun gövdesindeki `onceki` bayrağı; alan yoksa ya da boolean değilse null (bilinmiyor) */
export function oncekiBayragi(json: unknown): boolean | null {
  const v = json && typeof json === "object" ? (json as Record<string, unknown>).onceki : undefined;
  return typeof v === "boolean" ? v : null;
}

/** Yeni sınamadan sonra uçların önceki anahtar desteği: 2xx yanıt veren uçta başlık var mıydı; öbürlerinde eski bilgi kalır */
export function destekGuncelle(onceki: OncekiDestegi, sonuc: Sinama["sonuc"]): OncekiDestegi {
  const out: OncekiDestegi = { ...onceki };
  for (const h of HEDEFLER) if (sonuc[h]?.durum === "ok") out[h] = sonuc[h]?.anahtar !== undefined;
  return out;
}

/** Uç panelin anahtarını şimdiki değeri olarak kabul ediyor mu (2xx; önceki değer olarak kabul uyumlu sayılmaz) */
export function hedefUyumlu(r: HedefSonucu | null | undefined): boolean {
  return r?.durum === "ok" && r.anahtar !== "onceki";
}

/** Panelin kasalara dağıttığı uçlar (adres ve en az 32 karakterlik anahtar: kurulumBaglantilari'nın koşulu) */
export function dagitilanHedefler(env: Env = process.env): { hedef: Hedef; url: string; secret: string }[] {
  return HEDEFLER.flatMap((hedef) => {
    const url = posEnv(PANEL_ENV[hedef].url, env)?.trim();
    const secret = posEnv(PANEL_ENV[hedef].secret, env)?.trim();
    return url && secret && secret.length >= 32 ? [{ hedef, url, secret }] : [];
  });
}

/** Sınama adresi: kasanın kurduğu gibi `<adres><yol>` (adresin sonundaki eğik çizgi atılır) */
export function sinamaAdresi(hedef: Hedef, base: string): URL {
  return new URL(`${base.replace(/\/+$/, "")}${SINAMA_YOLU[hedef]}`);
}

/** Yanıtın anlamı: 2xx kabul, 401 anahtar tutmadı, 503 uçta anahtar yok; başkası (ve ağ hatası) sınanamadı */
export function yanitDurumu(status: number): SinamaDurumu {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401) return "red";
  if (status === 503) return "kapali";
  return "hata";
}

/** Sonuç bu değerlerin mi (değerler sınamadan sonra değiştiyse sonuç eskidir: uyarı yok, "henüz sınanmadı") */
export function gecerliSinama(state: AnahtarUyumu, surum: string): Sinama | null {
  return state.sinama && surum && state.sinama.surum === surum ? state.sinama : null;
}

/**
 * Kasaların durumu (son KASA_RAPORU_GUN günde soranlar): güncel değerleri uygulayanlar ve gün kapanmasını bekleyenler
 * (eski sürüm ya da hiç uygulamamış). Şube kimlikleri sıralı
 */
export function kasalarinDurumu(state: AnahtarUyumu, guncel: string, now: Date): { uygulayan: string[]; bekleyen: string[] } {
  const uygulayan: string[] = [];
  const bekleyen: string[] = [];
  for (const [id, r] of Object.entries(state.kasalar).sort(([a], [b]) => a.localeCompare(b))) {
    if (now.getTime() - Date.parse(r.at) > KASA_RAPORU_GUN * 86_400_000) continue;
    (guncel && r.uygulanan === guncel ? uygulayan : bekleyen).push(id);
  }
  return { uygulayan, bekleyen };
}

/**
 * Kasanın bu sorgusu yazılmalı mı: rapor yoksa, uygulanan ya da güncel sürüm değiştiyse (`degisti`) ya da son yazım
 * KASA_RAPORU_TAZELEME_MS'den eskiyse (kasanın canlı olduğu görünsün)
 */
export function kasaRaporuYazilsin(onceki: KasaRaporu | undefined, yeni: { uygulanan: string; guncel: string }, now: Date): { yaz: boolean; degisti: boolean } {
  const degisti = !onceki || onceki.uygulanan !== yeni.uygulanan || onceki.guncel !== yeni.guncel;
  return { yaz: degisti || now.getTime() - Date.parse(onceki.at) >= KASA_RAPORU_TAZELEME_MS, degisti };
}

/**
 * Kasa bağlantıyı sorunca sınama yapılsın mı (raporu değişmese de): değerler dağıtılıyorsa ve bu değerlerin sınaması
 * yoksa ya da OTOMATIK_SINAMA_ARALIGI_MS'den eskiyse (birden çok kasa sorsa da saatte en çok bir)
 */
export function otomatikSinamaGerekli(state: AnahtarUyumu, surum: string, now: Date): boolean {
  if (!surum) return false;
  const s = gecerliSinama(state, surum);
  return !s || now.getTime() - Date.parse(s.at) >= OTOMATIK_SINAMA_ARALIGI_MS;
}

/**
 * Yeni sınamanın sonucu, önceki sonuçla birleşik: bir uç bu kez sınanamadıysa (ağ, zaman aşımı) ve aynı değerlerin önceki
 * sınaması o uçta sorun bulduysa (red, kapalı, yalnız önceki değer olarak kabul) önceki sonuç kalır: geçici bir ağ
 * hatası gerçek uyarıyı kaldırmasın
 */
export function sonucBirlestir(onceki: Sinama | null, yeni: Sinama): Sinama {
  if (!onceki || onceki.surum !== yeni.surum) return yeni;
  const sonuc = { ...yeni.sonuc };
  for (const h of HEDEFLER) {
    const eski = onceki.sonuc[h];
    if (sonuc[h]?.durum === "hata" && eski && eski.durum !== "hata" && !hedefUyumlu(eski)) sonuc[h] = eski;
  }
  return { ...yeni, sonuc };
}

/** Durumun kısa metni (kart) */
export function durumMetni(r: HedefSonucu | null | undefined): string {
  if (!r) return "henüz sınanmadı";
  switch (r.durum) {
    case "ok":
      return r.anahtar === "onceki" ? "panelin anahtarını yalnız önceki değer olarak kabul ediyor" : "anahtarı kabul ediyor";
    case "red":
      return "anahtarı reddediyor";
    case "kapali":
      return "kasa anahtarı tanımlı değil";
    case "hata":
      return r.http ? `sınanamadı (HTTP ${r.http})` : "sınanamadı (ulaşılamadı)";
  }
}

/** Kartta uç "önceki anahtarı tanır" bilgisinin metni (belge ve uyarının adımı bu metne bakın der) */
export const DESTEK_METNI = "önceki anahtarı da tanır";

/** Kartta ucun durumunun yanındaki notlar: önceki anahtar desteği (`destek`) ve uçta tanımlı önceki anahtar */
export function hedefNotlari(r: HedefSonucu | null | undefined, destek: boolean | undefined): string[] {
  const out: string[] = [];
  if (destek === true) out.push(DESTEK_METNI);
  else if (destek === false) out.push("önceki anahtarı tanımıyor (eski sürüm)");
  if (r?.oncekiTanimli === true) out.push("önceki anahtar tanımlı");
  return out;
}

/**
 * Uyarının nedeni: uç panelin anahtarını reddediyor (401), uçta anahtar yok (503), uç panelin anahtarını yalnız önceki
 * değer (`_ONCEKI`) olarak kabul ediyor (panel güncellenmeli) ya da bütün kasalar geçtiği hâlde uçta önceki anahtar
 * tanımlı (silinmeli)
 */
export type UyariDurumu = "red" | "kapali" | "onceki" | "oncekiKaldi";

export interface AnahtarUyarisi {
  hedef: Hedef;
  durum: UyariDurumu;
  /**
   * danger: kasa yeni değeri kullanıyor (ya da bilinmiyor), şu an reddediliyor; warning: kasa gün kapanınca geçecek ya da
   * panelin değeri eski (`_ONCEKI` silinirse kasa kesilir); info: eski anahtar gereksiz yere geçerli
   */
  kind: "danger" | "warning" | "info";
  title: string;
  /** Kısa: ne olur, ne zamana kadar */
  text: string;
  /** Yapılacaklar, sırayla (anahtarın değeri hiçbir zaman yazılmaz; yalnız değişkenlerin adları) */
  steps: string[];
  /** Sınamanın anı */
  at: string;
}

/** Değişkenlerin adları (panelde değerin okunduğu ad: posEnvName; uçtaki ad ve önceki değerin adı) ve yerin ekli adları */
function adlar(hedef: Hedef, env: Env) {
  return hedef === "uzaktan"
    ? {
        panel: posEnvName("CLOUD_SECRET", env),
        uc: TEL_UZAK_ANAHTAR_ENV,
        ucYeni: "ASILPOS_CLOUD_SECRET",
        onceki: UZAK_ONCEKI_ENV,
        // Uzaktan önceki değeri iki adla da okur: önceki bir değişimden kalan yeni adlısı eski adlıyı gölgelemesin
        oncekiYeni: "ASILPOS_CLOUD_SECRET_ONCEKI",
        proje: UZAKTAN_PROJESI,
        Yer: "Uzaktan",
        yer: "Uzaktan",
        yerIn: "Uzaktan'ın",
        YerDe: "Uzaktan'da",
        YerDeki: "Uzaktan'daki",
        yerDeki: "Uzaktan'daki",
        yerE: "Uzaktan'a",
        durur: "kasanın özeti, platform siparişleri ve uzaktan yönetim durur",
      }
    : {
        panel: posEnvName("SITE_SECRET", env),
        uc: SITE_KASA_ANAHTAR_ENV,
        ucYeni: null,
        onceki: SITE_KASA_ONCEKI_ENV,
        oncekiYeni: null,
        proje: "laffogato",
        Yer: "Site",
        yer: "site",
        yerIn: "sitenin",
        YerDe: "Sitede",
        YerDeki: "Sitedeki",
        yerDeki: "sitedeki",
        yerE: "siteye",
        durur: "online siparişler, masa çağrıları ve menü kasaya gelmez",
      };
}

/**
 * Yapılacaklar (Vercel'de). Uç reddediyorsa ve kasa yalnız bekliyorsa (turuncu) uçtaki değer ancak uç önceki anahtarı
 * tanıyorsa (`destek`) değiştirilir; tanıdığı görülmediyse panel eskiye döner (uçtaki değeri değiştirmek bekleyen kasayı
 * hemen keserdi; inceleme 27 Kasım). Kırmızıda kasa zaten yeni değerde: uçtaki değer panelinkine geçer
 */
function adimlar(hedef: Hedef, durum: UyariDurumu, kind: AnahtarUyarisi["kind"], destek: boolean | undefined, env: Env): string[] {
  const a = adlar(hedef, env);
  const degisken = a.ucYeni ? `${a.uc} (${a.ucYeni} eklediyseniz onu)` : a.uc;
  const ucVercel = `Vercel › ${a.proje} projesi › Settings › Environment Variables`;
  const panelVercel = `Vercel › lafmaliyet projesi › Settings › Environment Variables › ${a.panel}`;
  const kopyala = `Panelin değeri: ${panelVercel} (Sensitive ise Vercel göstermez: anahtarı üretirken sakladığınız değer).`;
  const yayinla = `Aynı projede Deployments › son yayın › Redeploy ile yeniden yayınlayın.`;
  const sina = "Sonra burada Ayarlar › AsilPOS › Anahtarları sına'ya basın; uyarı kalkar.";
  switch (durum) {
    case "kapali":
      return [
        kopyala,
        `${ucVercel}'ta ${a.uc}'ı bu değerle ekleyin (Production; en az 32 karakter${hedef === "site" ? ", sitenin KARAOKE_SYNC_SECRET'ından farklı" : ""}).`,
        yayinla,
        sina,
      ];
    case "onceki":
      return [
        `${a.YerDeki} yeni değeri (${a.uc}${a.ucYeni ? ` ya da ${a.ucYeni}` : ""}; anahtarı üretirken sakladığınız) panele yazın: ${panelVercel}.`,
        yayinla,
        `Kasalar yeni değeri 10 dakika içinde alır, gün kapanınca uygular. O zamana dek ${a.yerDeki} ${a.onceki}'yi silmeyin: kasa bugün onunla bağlanıyor.`,
        sina,
      ];
    case "oncekiKaldi":
      return [`${ucVercel}'ta ${a.onceki}'yi${a.oncekiYeni ? ` (varsa ${a.oncekiYeni}'yi de)` : ""} silin.`, yayinla, sina];
    case "red":
      if (kind === "warning" && destek !== true) {
        return [
          `${a.YerDeki} değeri şimdi değiştirmeyin: ${a.yerIn} önceki anahtarı (${a.onceki}) tanıdığı görülmedi; değiştirmek gün kapanmasını bekleyen kasayı hemen keser.`,
          `Paneldeki değeri eskisine (${a.yerDeki} bugünkü değer; anahtarı üretirken sakladığınız) döndürün: ${panelVercel}.`,
          `Panelin projesinde Deployments › son yayın › Redeploy ile yeniden yayınlayın, gün kapanmadan: kasa bekleyen yeni değeri 10 dakika içinde bırakır.`,
          sina,
          `Yeni anahtara sonra Anahtar değişimi sırasıyla geçin (önce ${a.yer}, sonra panel); bunun için bu kartta ${HEDEF_ADI[hedef]} "${DESTEK_METNI}" demeli.`,
        ];
      }
      return [
        kopyala,
        `${ucVercel}'ta ${degisken} değişkeninin bugünkü değerini ${a.onceki} adıyla yeni bir değişkene yazın${a.oncekiYeni ? ` (önceki bir değişimden kalan ${a.oncekiYeni} varsa silin: iki ad birden olmasın)` : ""}; ${destek === true ? "henüz yeni değere geçmemiş kasa çalışmaya devam eder" : `${a.yer} önceki anahtarı tanıyorsa henüz yeni değere geçmemiş kasa da çalışmaya devam eder`}.`,
        `${degisken} değişkenine panelin değerini yazın.`,
        yayinla,
        sina,
        `Bütün kasalar güncel değerleri uygulayınca (bu kartta) ${a.onceki}'yi silin ve yeniden yayınlayın.`,
      ];
  }
}

/**
 * Uyarılar (kart ve zil), uç başına en çok bir:
 * - geçerli sınamada reddeden ya da anahtarı olmayan uç: kasalardan biri güncel değerleri uyguladıysa ya da hiçbir kasa
 *   raporu yoksa (bilinmiyor) kırmızı, yalnız bekleyen kasalar varsa turuncu;
 * - panelin anahtarını yalnız önceki değer (`_ONCEKI`) olarak kabul eden uç: turuncu, panel güncellenmeli, `_ONCEKI`
 *   silinmemeli (silinirse kasalar kesilir);
 * - bütün kasalar güncel değerleri uyguladığı hâlde önceki anahtarı tanımlı uç: bilgi, silinmeli.
 * Sınanmamış, sınanamamış (ağ, beklenmeyen yanıt) ya da değerler sonradan değiştiyse uyarı yok
 */
export function anahtarUyarilari(o: { state: AnahtarUyumu; surum: string; now: Date; env?: Env }): AnahtarUyarisi[] {
  const env = o.env ?? process.env;
  const s = gecerliSinama(o.state, o.surum);
  if (!s) return [];
  const { uygulayan, bekleyen } = kasalarinDurumu(o.state, o.surum, o.now);
  const kirmizi = uygulayan.length > 0 || bekleyen.length === 0;
  const hepsiUyguladi = uygulayan.length > 0 && bekleyen.length === 0;
  const out: AnahtarUyarisi[] = [];
  for (const hedef of HEDEFLER) {
    const r = s.sonuc[hedef];
    if (!r) continue;
    const a = adlar(hedef, env);
    const uyari = (durum: UyariDurumu, kind: AnahtarUyarisi["kind"], title: string, text: string) =>
      out.push({ hedef, durum, kind, title, text, steps: adimlar(hedef, durum, kind, o.state.destek[hedef], env), at: s.at });
    if (r.durum === "red" || r.durum === "kapali") {
      const kind = kirmizi ? "danger" : "warning";
      const title = r.durum === "kapali" ? `${a.YerDe} kasa anahtarı tanımlı değil` : kind === "danger" ? `${a.YerDeki} anahtar eski` : `${a.Yer} yeni anahtarı kabul etmiyor`;
      const text =
        kind === "danger"
          ? `Kasa panelin anahtarını kullanıyor, ${a.yer} onu ${r.durum === "kapali" ? "tanımıyor" : "reddediyor"}: ${a.durur}.`
          : `Kasa yeni anahtara gün kapanınca geçecek; ${a.yer} onu henüz kabul etmiyor. Gün kapanmadan düzeltin, yoksa ${a.durur}.`;
      uyari(r.durum, kind, title, text);
    } else if (r.durum === "ok" && r.anahtar === "onceki") {
      uyari(
        "onceki",
        "warning",
        `Panelin ${a.yer} anahtarı eski`,
        `${a.Yer} yeni anahtara geçmiş, panel kasalara hâlâ eskisini dağıtıyor: ${a.yer} onu yalnız önceki değer (${a.onceki}) olarak kabul ediyor. Önce paneli güncelleyin; ${a.onceki} silinirse ${a.durur}.`,
      );
    } else if (hedefUyumlu(r) && r.oncekiTanimli === true && hepsiUyguladi) {
      uyari(
        "oncekiKaldi",
        "info",
        `${a.YerDe} önceki anahtar hâlâ tanımlı`,
        `Bütün kasalar güncel değerleri uyguladı; eski anahtar ${a.onceki} ile hâlâ geçerli. Silin: eski anahtarı bilen biri ${a.yerE} kasa gibi bağlanabilir.`,
      );
    }
  }
  return out;
}

/** Zil satırının gövdesi: kısa metin ve adımlar tek paragrafta */
export function uyariGovdesi(u: AnahtarUyarisi): string {
  return `${u.text} ${u.steps.map((s, i) => `${i + 1}) ${s}`).join(" ")}`;
}
