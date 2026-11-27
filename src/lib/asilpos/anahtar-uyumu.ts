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
 * AsilPOS › Anahtarları sına ve bir kasanın raporu değişince (yeni değeri ilk kez gördü ya da uyguladı; en çok saatte
 * bir). Sonuç ve kasaların raporu `integration_state`'in `ANAHTAR_UYUMU_KEY` satırında; anahtar, imza ve yanıtın
 * gövdesi hiçbir yere yazılmaz. Uç reddederse (401) ya da anahtarı yoksa (503) Ayarlar › AsilPOS'ta ve yöneticinin
 * zilinde uyarı, sınama geçince kalkar. Kasa yeni değeri uyguladıysa (ya da bilinmiyorsa) uyarı kırmızı: kasa şu an
 * reddediliyor; yalnız bekliyorsa turuncu: gün kapanmadan düzeltilirse hiçbir şey durmaz.
 *
 * Saf (tarayıcıda da çalışır; imza ve istek src/server/asilpos/anahtar-uyumu.ts'te). Testleri
 * tests/asilpos-anahtar-uyumu.test.ts.
 */

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

/** Bir sınamanın en uzun beklemesi */
export const SINAMA_ZAMAN_ASIMI_MS = 8_000;
/** Kasanın raporu değişince yapılan sınamanın en sık aralığı (aynı değerler için; değerler değişince hemen) */
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

export interface AnahtarUyumu {
  kasalar: Record<string, KasaRaporu>;
  sinama: Sinama | null;
}

const hedefSonucu = z.object({ durum: z.enum(["ok", "red", "kapali", "hata"]), http: z.number().nullable().catch(null) });
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
  return { kasalar, sinama: sinama.success ? sinama.data : null };
}

/** Panelin kasalara dağıttığı uçlar (adres ve en az 32 karakterlik anahtar: kurulumBaglantilari'nın koşulu) */
export function dagitilanHedefler(env: Record<string, string | undefined> = process.env): { hedef: Hedef; url: string; secret: string }[] {
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
 * Kasanın raporu değişince sınama yapılsın mı: değerler dağıtılıyorsa ve bu değerlerin sınaması yoksa ya da
 * OTOMATIK_SINAMA_ARALIGI_MS'den eskiyse (iki kasa aynı anda değişse de saatte en çok bir)
 */
export function otomatikSinamaGerekli(state: AnahtarUyumu, surum: string, now: Date): boolean {
  if (!surum) return false;
  const s = gecerliSinama(state, surum);
  return !s || now.getTime() - Date.parse(s.at) >= OTOMATIK_SINAMA_ARALIGI_MS;
}

/**
 * Yeni sınamanın sonucu, önceki sonuçla birleşik: bir uç bu kez sınanamadıysa (ağ, zaman aşımı) ve aynı değerlerin önceki
 * sınaması o uçta sorun bulduysa (red, kapalı) önceki sonuç kalır: geçici bir ağ hatası gerçek uyarıyı kaldırmasın
 */
export function sonucBirlestir(onceki: Sinama | null, yeni: Sinama): Sinama {
  if (!onceki || onceki.surum !== yeni.surum) return yeni;
  const sonuc = { ...yeni.sonuc };
  for (const h of HEDEFLER) {
    const eski = onceki.sonuc[h];
    if (sonuc[h]?.durum === "hata" && (eski?.durum === "red" || eski?.durum === "kapali")) sonuc[h] = eski;
  }
  return { ...yeni, sonuc };
}

/** Durumun kısa metni (kart) */
export function durumMetni(r: HedefSonucu | null | undefined): string {
  if (!r) return "henüz sınanmadı";
  switch (r.durum) {
    case "ok":
      return "anahtarı kabul ediyor";
    case "red":
      return "anahtarı reddediyor";
    case "kapali":
      return "kasa anahtarı tanımlı değil";
    case "hata":
      return r.http ? `sınanamadı (HTTP ${r.http})` : "sınanamadı (ulaşılamadı)";
  }
}

export interface AnahtarUyarisi {
  hedef: Hedef;
  durum: "red" | "kapali";
  /** danger: kasa yeni değeri kullanıyor (ya da bilinmiyor), şu an reddediliyor; warning: kasa gün kapanınca geçecek */
  kind: "danger" | "warning";
  title: string;
  /** Kısa: ne olur, ne zamana kadar */
  text: string;
  /** Yapılacaklar, sırayla (anahtarın değeri hiçbir zaman yazılmaz; yalnız değişkenlerin adları) */
  steps: string[];
  /** Sınamanın anı */
  at: string;
}

/** Değişkenlerin adları: panelde değerin okunduğu ad (posEnvName), uçtaki ad ve önceki değerin adı */
function adlar(hedef: Hedef, env: Record<string, string | undefined>) {
  return hedef === "uzaktan"
    ? { panel: posEnvName("CLOUD_SECRET", env), uc: TEL_UZAK_ANAHTAR_ENV, ucYeni: "ASILPOS_CLOUD_SECRET", onceki: UZAK_ONCEKI_ENV, proje: UZAKTAN_PROJESI }
    : { panel: posEnvName("SITE_SECRET", env), uc: SITE_KASA_ANAHTAR_ENV, ucYeni: null, onceki: SITE_KASA_ONCEKI_ENV, proje: "laffogato" };
}

/** Uçtaki anahtarı panelinkiyle değiştirme adımları (Vercel'de) */
function adimlar(hedef: Hedef, durum: "red" | "kapali", env: Record<string, string | undefined>): string[] {
  const a = adlar(hedef, env);
  const degisken = a.ucYeni ? `${a.uc} (${a.ucYeni} eklediyseniz onu)` : a.uc;
  const kopyala = `Panelin değeri: Vercel › lafmaliyet projesi › Settings › Environment Variables › ${a.panel} (Sensitive ise Vercel göstermez: anahtarı üretirken sakladığınız değer).`;
  const yayinla = `Aynı projede Deployments › son yayın › Redeploy ile yeniden yayınlayın.`;
  const sina = "Sonra burada Ayarlar › AsilPOS › Anahtarları sına'ya basın; uyarı kalkar.";
  if (durum === "kapali") {
    return [
      kopyala,
      `Vercel › ${a.proje} projesi › Settings › Environment Variables'ta ${a.uc}'ı bu değerle ekleyin (Production; en az 32 karakter${hedef === "site" ? ", sitenin KARAOKE_SYNC_SECRET'ından farklı" : ""}).`,
      yayinla,
      sina,
    ];
  }
  return [
    kopyala,
    `Vercel › ${a.proje} projesi › Settings › Environment Variables'ta ${degisken} değişkeninin bugünkü değerini ${a.onceki} adıyla yeni bir değişkene yazın (henüz yeni değere geçmemiş kasa çalışmaya devam etsin).`,
    `${degisken} değişkenine panelin değerini yazın.`,
    yayinla,
    sina,
  ];
}

/**
 * Uyarılar (kart ve zil): geçerli sınamada reddeden ya da anahtarı olmayan her uç. Kasalardan biri güncel değerleri
 * uyguladıysa ya da hiçbir kasa raporu yoksa (bilinmiyor) kırmızı, yalnız bekleyen kasalar varsa turuncu. Sınanmamış,
 * sınanamamış (ağ, beklenmeyen yanıt) ya da değerler sonradan değiştiyse uyarı yok
 */
export function anahtarUyarilari(o: { state: AnahtarUyumu; surum: string; now: Date; env?: Record<string, string | undefined> }): AnahtarUyarisi[] {
  const env = o.env ?? process.env;
  const s = gecerliSinama(o.state, o.surum);
  if (!s) return [];
  const { uygulayan, bekleyen } = kasalarinDurumu(o.state, o.surum, o.now);
  const kind: AnahtarUyarisi["kind"] = uygulayan.length > 0 || bekleyen.length === 0 ? "danger" : "warning";
  const out: AnahtarUyarisi[] = [];
  for (const hedef of HEDEFLER) {
    const r = s.sonuc[hedef];
    if (!r || (r.durum !== "red" && r.durum !== "kapali")) continue;
    const durum = r.durum;
    const uzak = hedef === "uzaktan";
    const yer = uzak ? "Uzaktan" : "Site";
    const yerDe = uzak ? "Uzaktan'da" : "Sitede";
    const durur = uzak ? "kasanın özeti, platform siparişleri ve uzaktan yönetim durur" : "online siparişler, masa çağrıları ve menü kasaya gelmez";
    const title =
      durum === "kapali"
        ? `${yerDe} kasa anahtarı tanımlı değil`
        : kind === "danger"
          ? `${uzak ? "Uzaktan'daki" : "Sitedeki"} anahtar eski`
          : `${yer} yeni anahtarı kabul etmiyor`;
    const text =
      kind === "danger"
        ? `Kasa panelin anahtarını kullanıyor, ${uzak ? "Uzaktan" : "site"} onu ${durum === "kapali" ? "tanımıyor" : "reddediyor"}: ${durur}.`
        : `Kasa yeni anahtara gün kapanınca geçecek; ${uzak ? "Uzaktan" : "site"} onu henüz kabul etmiyor. Gün kapanmadan düzeltin, yoksa ${durur}.`;
    out.push({ hedef, durum, kind, title, text, steps: adimlar(hedef, durum, env), at: s.at });
  }
  return out;
}

/** Zil satırının gövdesi: kısa metin ve adımlar tek paragrafta */
export function uyariGovdesi(u: AnahtarUyarisi): string {
  return `${u.text} ${u.steps.map((s, i) => `${i + 1}) ${s}`).join(" ")}`;
}
