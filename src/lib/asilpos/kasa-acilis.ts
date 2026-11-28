// Kasa açılışı (docs/ASILPOS.md › Kasa açılışı; tasarım docs/planlar/kasa-acilis-ve-asil-yonetici.md › P-B2): yeni kasa
// "Denemeyi bitir" derken asıl yöneticinin ladmin hesabıyla girer (POST /api/asilpos/acilis/giris), şubesini seçer
// (POST /api/asilpos/acilis/bagla) ve ilk personelin PIN'lerini aldığını onaylar (POST /api/asilpos/acilis/teslim).
// Kasası kurulu şube seçilemez; bilgisayar değişikliği yalnız asıl yöneticinin "Kasayı serbest bırak"ıyla (Yönetim
// konsolu › Şubeler ve kasalar; ladmin'de yok). Kasaya giden metinler adres yazmaz, "Yönetim konsolu" der
// (docs/planlar/yonetim-konsolu.md). Kurallar ve metinler burada; bu dosya saf (tests/kasa-acilis.test.ts). Sunucu
// tarafı src/server/asilpos/acilis.ts.

import type { KasaDurumu } from "./kasa-durumu";

/** Belirtecin amacı (imzalı kısa ömürlü belirteç; src/server/auth/session.ts) ve ömrü */
export const ACILIS_AMACI = "kasa-acilis";
export const BELIRTEC_DAKIKA = 15;

/** Uçlar (README uç tablosu, docs/ASILPOS.md › Kasa açılışı) */
export const ACILIS_YOLLARI = {
  giris: "/api/asilpos/acilis/giris",
  bagla: "/api/asilpos/acilis/bagla",
  teslim: "/api/asilpos/acilis/teslim",
} as const;

/** Ret ve not cümleleri (kasa ekranda `mesaj`ı gösterir) */
export const YALNIZ_ASIL_ACAR = "Kasayı yalnız asıl yönetici açar";
export const KURULU_NEDEN = "Kurulu: değiştirmek için Yönetim konsolu";
export const OTURUM_DOLDU = "Giriş süresi doldu ya da hesap değişti; yeniden giriş yapın";
export const IKI_ADIM_GEREKLI = "İki adımlı doğrulama kodunu girin";
export const IKI_ADIM_KURULMALI = "Bu hesapta iki adımlı doğrulama zorunlu: önce ladmin › Hesabım'dan kurun";

/** "Kasayı serbest bırak" penceresinin onay cümlesi */
export const SERBEST_ONAY = "Bu şubenin kasası ladmin bağlantısını kaybeder; yeni bilgisayar şubeyi kasada seçebilir.";
/**
 * Son bu kadar günde gün sonu gelen şube canlı sayılır: serbest bırakma ve Yönetim konsolunun yıkıcı şube işlemleri
 * (kapatma, silme, kasa programı, kasa anahtarı) uyarıyı belirgin gösterir
 */
export const CANLI_GUN = 7;
/** Canlı şubenin uyarı başlığı ("Marina canlı: son 7 günde kasadan gün sonu geldi") */
export const canliBaslik = (ad: string) => `${ad} canlı: son ${CANLI_GUN} günde kasadan gün sonu geldi`;

/** Kasanın kendini tanıttığı alan: kasa kimliği (Merkez kurulum kimliği ya da kasanın ürettiği), sürüm, açık anahtar */
export interface KasaBilgisi {
  kimlik: string;
  surum: string | null;
  /** Kasanın RSA-OAEP açık anahtarı (SPKI DER, base64 ya da base64url); ilk personelin PIN'leri bununla şifrelenir */
  acikAnahtar: string | null;
}

const KIMLIK_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SURUM_RE = /^[\w.+-]{1,40}$/;
const ANAHTAR_RE = /^[A-Za-z0-9+/_=-]{200,1400}$/;

/**
 * İstekteki `kasa` alanı: kimlik zorunlu (8-64 karakter; harf, rakam, alt çizgi, tire); sürüm ve açık anahtar isteğe
 * bağlı, biçimi tutmazsa yok sayılır (anahtarın kendisi sunucuda ayrıca denetlenir). Kimlik yoksa ya da bozuksa null
 */
export function kasaBilgisi(raw: unknown): KasaBilgisi | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.kimlik !== "string" || !KIMLIK_RE.test(o.kimlik)) return null;
  return {
    kimlik: o.kimlik,
    surum: typeof o.surum === "string" && SURUM_RE.test(o.surum) ? o.surum : null,
    acikAnahtar: typeof o.acikAnahtar === "string" && ANAHTAR_RE.test(o.acikAnahtar.trim()) ? o.acikAnahtar.trim() : null,
  };
}

/**
 * Kurulum kodu isteğindeki isteğe bağlı kasa alanları (kimlik, surum, acikAnahtar gövdenin üst düzeyinde; eski kasa
 * yalnız `kod` ve `surum` gönderir). Kimlik yoksa sürüm yine okunur
 */
export function kodKasaBilgisi(body: Record<string, unknown> | null): { kimlik: string | null; surum: string | null; acikAnahtar: string | null } {
  const k = kasaBilgisi({ kimlik: body?.kimlik, surum: body?.surum, acikAnahtar: body?.acikAnahtar });
  if (k) return k;
  const surum = typeof body?.surum === "string" && SURUM_RE.test(body.surum) ? body.surum : null;
  return { kimlik: null, surum, acikAnahtar: null };
}

// ---------------------------------------------------------------- Kasa kaydı

/** Kasanın şubeye bağlanma yolu: ladmin girişi, kurulum kodu ya da asıl yöneticinin serbest bırakması */
export type KasaYolu = "acilis" | "kod" | "serbest";

/** integration_state `asilpos.kasa:<şube>`: şubenin kasası açıkça kurulu ya da boş */
export interface KasaKaydi {
  durum: "kurulu" | "bos";
  kimlik: string | null;
  surum: string | null;
  at: string;
  by: string;
  yol: KasaYolu;
}

/** Kayıttan okur; bozuksa null (yokmuş gibi: eski ölçüt geçerli) */
export function kasaKaydi(raw: unknown): KasaKaydi | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.durum !== "kurulu" && o.durum !== "bos") return null;
  if (o.yol !== "acilis" && o.yol !== "kod" && o.yol !== "serbest") return null;
  return {
    durum: o.durum,
    kimlik: typeof o.kimlik === "string" ? o.kimlik : null,
    surum: typeof o.surum === "string" ? o.surum : null,
    at: typeof o.at === "string" ? o.at : "",
    by: typeof o.by === "string" ? o.by : "",
    yol: o.yol,
  };
}

/** Şube kasada listelenir mi: açık, fiziksel ve (hazırlanmış ya da kasa programı AsilPOS) */
export function acilistaListelenir(b: { active: boolean; kind: string; posSource: string }, hazirlandi: boolean): boolean {
  return b.active && b.kind === "fiziksel" && (hazirlandi || b.posSource === "asilpos");
}

/** Giriş yanıtındaki şube satırı */
export interface AcilisSubesi {
  id: string;
  ad: string;
  kasa: { durum: "bos" | "kurulu"; sonGun: string | null };
  buKasa: boolean;
  secilebilir: boolean;
  neden?: string;
}

/** Şube satırı: kurulu ve bu kasa değilse seçilemez ("Kurulu: değiştirmek için Yönetim konsolu") */
export function acilisSubesi(b: { id: string; name: string }, d: KasaDurumu, buKasa: boolean): AcilisSubesi {
  const kurulu = d.durum === "kurulu";
  const secilebilir = !kurulu || buKasa;
  return {
    id: b.id,
    ad: b.name,
    kasa: { durum: kurulu ? "kurulu" : "bos", sonGun: kurulu ? d.sonGun : null },
    buKasa,
    secilebilir,
    ...(secilebilir ? {} : { neden: KURULU_NEDEN }),
  };
}

/** Bu istek bu şubenin kasasından mı: kayıtlı kimlik aynı ya da istek şubenin anahtarıyla imzalı */
export function buKasaMi(o: { kayit: KasaKaydi | null; kimlik: string; imzaSubesi: string | null; subeId: string }): boolean {
  if (o.imzaSubesi === o.subeId) return true;
  return o.kayit?.durum === "kurulu" && !!o.kayit.kimlik && o.kayit.kimlik === o.kimlik;
}

/** 409 `zaten_kurulu`'nun cümlesi */
export const zatenKuruluMesaji = (ad: string) => `${ad} şubesinde kurulu bir kasa var. Bilgisayar değişecekse Yönetim konsolu › Şubeler ve kasalar › Kasayı serbest bırak.`;

/** 409 `sube_hazir_degil`'in cümlesi: ModPOS şubesi kasa kurulumu için hazırlanmadı */
export const hazirDegilMesaji = (ad: string) =>
  `${ad} şubesinin kasa programı ModPOS ve şube kasa kurulumu için hazırlanmadı: Yönetim konsolu › Şubeler ve kasalar › Bilgisayara kur`;

/** Asıl yöneticiye giden e-postanın konusu */
export const baglandiKonusu = (ad: string) => `${ad} kasası yeni bir bilgisayara bağlandı`;

// ---------------------------------------------------------------- İlk personel

/** Kasadaki roller: Patron, Müdür, Barista (kasada `kasiyer`, "Kasiyer / Barista"); AsilPOS shared/permissions.ts */
export const ILK_PERSONEL_ROLLERI = [
  { rol: "patron", etiket: "Patron" },
  { rol: "mudur", etiket: "Müdür" },
  { rol: "kasiyer", etiket: "Barista" },
] as const;

export type IlkPersonelRolu = (typeof ILK_PERSONEL_ROLLERI)[number]["rol"];
export interface IlkPersonel {
  rol: IlkPersonelRolu;
  ad: string;
  pin: string;
}

export const rolEtiketi = (rol: IlkPersonelRolu) => ILK_PERSONEL_ROLLERI.find((r) => r.rol === rol)!.etiket;

/**
 * Kasanın deneme dönemindeki örnek PIN'leri (AsilPOS server/db/seed.ts DEMO_USERS): giriş ekranında herkese görünür,
 * gerçek kullanımda kasa reddeder. Panel de reddeder; ayrıca tek rakamın tekrarı (4444, 55555) tahmin edilir
 */
export const ORNEK_PINLER: readonly string[] = ["1897", "2468", "1111", "2222", "3333"];
export const ILK_PERSONEL_AD_MAX = 40;

/** PIN'in hatası: 4-6 rakam, örnek PIN ya da tek rakamın tekrarı olamaz. Hata metni PIN'i içermez */
export function pinHatasi(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return "PIN 4-6 rakam olmalı";
  if (ORNEK_PINLER.includes(pin)) return "Bu PIN kasanın deneme dönemindeki örnek PIN'i, herkes biliyor: başka bir PIN seçin";
  if (/^(\d)\1+$/.test(pin)) return "Tek rakamın tekrarı olan PIN kolay tahmin edilir: başka bir PIN seçin";
  return null;
}

/**
 * İlk personel listesinin hatası (null: geçerli). Her satır ya boş ya da ad + PIN; en az bir satır dolu; her rol bir
 * kez; PIN'ler birbirinden farklı (kasada PIN tekil). Metin PIN'i içermez
 */
export function ilkPersonelHatasi(list: readonly { rol: string; ad: string; pin: string }[]): string | null {
  if (!list.length) return "En az bir kişinin adını ve PIN'ini yazın";
  const seen = new Set<string>();
  const pins = new Set<string>();
  for (const p of list) {
    const r = ILK_PERSONEL_ROLLERI.find((x) => x.rol === p.rol);
    if (!r) return "Rol tanınmadı";
    if (seen.has(p.rol)) return `${r.etiket} iki kez yazılmış`;
    seen.add(p.rol);
    const ad = p.ad.trim();
    if (!ad) return `${r.etiket}: ad gerekli`;
    if (ad.length > ILK_PERSONEL_AD_MAX) return `${r.etiket}: ad en çok ${ILK_PERSONEL_AD_MAX} karakter`;
    const h = pinHatasi(p.pin);
    if (h) return `${r.etiket}: ${h}`;
    if (pins.has(p.pin)) return "Üç PIN birbirinden farklı olmalı";
    pins.add(p.pin);
  }
  return null;
}

/** Formdaki üç satırdan dolu olanlar (ad ya da PIN yazılmış); hepsi boşsa boş liste */
export function doluSatirlar(rows: readonly { rol: IlkPersonelRolu; ad: string; pin: string }[]): IlkPersonel[] {
  return rows.filter((r) => r.ad.trim() || r.pin.trim()).map((r) => ({ rol: r.rol, ad: r.ad.trim(), pin: r.pin.trim() }));
}

/** Kasaya teslimden (yanıtta gönderildikten) sonra onay gelmezse PIN'ler bu kadar sonra silinir */
export const TESLIM_SAAT = 24;
/** Hiç teslim edilmeyen ilk personel kaydı bu kadar sonra silinir */
export const BEKLEME_GUN = 30;

/**
 * integration_state `asilpos.ilk-personel:<şube>`: `muhur` mühürlü JSON ([{rol, ad, pin}]; src/server/secret-box.ts,
 * amaç "asilpos-ilk-personel"). `gonderildi`: kasaya ilk gönderildiği an (bağlama ya da kurulum kodu yanıtında);
 * `teslim`: kasanın onayladığı an (o zaman mühür silinir, iz kalır). Düz PIN hiçbir yerde durmaz
 */
export interface IlkPersonelKaydi {
  v: 1;
  muhur?: string;
  at: string;
  by: string;
  roller?: IlkPersonelRolu[];
  gonderildi?: string;
  teslim?: string;
}

export function ilkPersonelKaydi(raw: unknown): IlkPersonelKaydi | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || typeof o.at !== "string") return null;
  const roller = Array.isArray(o.roller) ? o.roller.filter((r): r is IlkPersonelRolu => ILK_PERSONEL_ROLLERI.some((x) => x.rol === r)) : undefined;
  return {
    v: 1,
    at: o.at,
    by: typeof o.by === "string" ? o.by : "",
    ...(typeof o.muhur === "string" && o.muhur ? { muhur: o.muhur } : {}),
    ...(roller ? { roller } : {}),
    ...(typeof o.gonderildi === "string" ? { gonderildi: o.gonderildi } : {}),
    ...(typeof o.teslim === "string" ? { teslim: o.teslim } : {}),
  };
}

/**
 * Tembel temizlik (ayrı zamanlayıcı yok; okuma anında): mühür, gönderimden TESLIM_SAAT sonra silinir (iz kalır); hiç
 * gönderilmemiş kayıt BEKLEME_GUN sonra tümden silinir. Döner: kaydın yeni hâli (null: sil) ve değişti mi
 */
export function ilkPersonelTemizle(k: IlkPersonelKaydi, now: Date = new Date()): { kayit: IlkPersonelKaydi | null; degisti: boolean } {
  if (!k.muhur) return { kayit: k, degisti: false };
  const t = now.getTime();
  if (k.gonderildi && t - Date.parse(k.gonderildi) >= TESLIM_SAAT * 3_600_000) {
    const iz: IlkPersonelKaydi = { ...k };
    delete iz.muhur;
    return { kayit: iz, degisti: true };
  }
  if (!k.gonderildi && t - Date.parse(k.at) >= BEKLEME_GUN * 86_400_000) return { kayit: null, degisti: true };
  return { kayit: k, degisti: false };
}

/** Ekranda görünen durum: PIN hiçbir zaman görünmez */
export type IlkPersonelDurumu = "yok" | "ayarli" | "gonderildi" | "teslim";

export function ilkPersonelDurumu(k: IlkPersonelKaydi | null): IlkPersonelDurumu {
  if (!k) return "yok";
  if (k.teslim) return "teslim";
  if (k.muhur) return k.gonderildi ? "gonderildi" : "ayarli";
  return k.gonderildi ? "gonderildi" : "yok";
}

export const ILK_PERSONEL_ETIKET: Record<IlkPersonelDurumu, string> = {
  yok: "İlk personel ayarlı değil",
  ayarli: "İlk personel ayarlı",
  gonderildi: "İlk personel kasaya gönderildi",
  teslim: "İlk personel teslim edildi",
};
