import { XMLParser } from "fast-xml-parser";

/**
 * ModPOS (Gafdigi) Kasa Föyü API'sinin yanıtı (saf; sunucu, betik ve testler paylaşır; tests/modpos-foy.test.ts).
 * Belge: docs/modpos-kasa-foyu-api.md; panelin kurgusu: docs/MODPOS-API.md.
 *
 * Yanıt bir kasa gününün XML föyüdür (`<kasaFoyu>`) ya da hatadır (`<hata>`). Burada okunur, doğrulanır ve panelin
 * biçimine çevrilir:
 * - Tutarlar TL, iki ondalığa yuvarlanır (ondalık ayırıcı nokta; "28450.5"). Biçimi bozuk tutar reddedilir (alanın yolu
 *   hatada), boş öğe (`<defter/>`) null'dır.
 * - **Kişisel veri saklanmaz** (docs/LAFPOS.md › Güvenlik ve KVKK kuralı): personel adları (açılış, kapanış, ara kasa)
 *   ve cari tahsilatın müşteri adı okunmaz. Giderin açıklaması ve kasa notları yöneticinin verisinde kalır.
 * - Tekrar eden öğeler (kasa, odeme, kirilim, gider, tahsilat, araKasa, uyari, foysuzGun) her zaman dizidir; kayıt
 *   yoksa boş dizi.
 * - DOCTYPE / ENTITY taşıyan gövde hiç ayrıştırılmaz (genişleme saldırısı); servis bunları göndermez.
 */

export const MODPOS_DAYANAK = ["Z_RAPORU", "CANLI", "OTOMATIK_KAPANIS"] as const;
export type ModposDayanak = (typeof MODPOS_DAYANAK)[number];

/** Uyarı kodları (belge §5.5); listede olmayan kod da saklanır, metni servisin mesajıdır */
export const MODPOS_UYARI = {
  GUN_ACIK: "Gün henüz kapanmadı",
  OTOMATIK_KAPANDI: "Gün 06:00'da kendiliğinden kapandı",
  KAPANISTAN_SONRA_CIRO_DEGISTI: "Kapanıştan sonra ciro değişti",
  Z_BEKLENEN_NAKIT_TUTMUYOR: "Güncel beklenen nakit Z raporundakinden farklı",
  DEFTER_GIRILMEMIS: "Kasa defteri girilmemiş",
  KASA_FARKI: "Kasada fark var",
  DEGISIM_DENKLESMEDI: "Ürün değişimi mahsubu denkleşmemiş",
} as const;

export interface FoyKirilim {
  ad: string;
  tutar: number;
}

export interface FoyOdeme {
  yontem: string;
  kod: string;
  ciroyaDahil: boolean;
  /** Satışlardan gelen */
  satis: number;
  /** Aynı yöntemle alınan cari tahsilat */
  cariTahsilat: number;
  /** Sistemde görünen (satış + cari tahsilat) */
  sistem: number;
  /** Kasa defterine yazılan; defter girilmediyse null */
  defter: number | null;
  /** Defter − sistem (eksi: açık); defter yoksa null */
  fark: number | null;
  /** Banka ya da kurum kırılımı */
  kirilim: FoyKirilim[];
}

export interface FoyGider {
  kategori: string | null;
  aciklama: string | null;
  tutar: number;
}

/** Cari tahsilat: müşterinin adı okunmaz (KVKK) */
export interface FoyTahsilat {
  tutar: number;
  yontem: string | null;
  zaman: string | null;
}

export interface FoyNakitKasa {
  /** Z_RAPORU, CANLI, OTOMATIK_KAPANIS; tanınmayan değer olduğu gibi */
  dayanak: string | null;
  acilis: number | null;
  nakitSatis: number | null;
  nakitCariTahsilat: number | null;
  gider: number | null;
  /** açılış + nakit satış + nakit cari tahsilat − gider */
  beklenen: number | null;
  sayilan: number | null;
  /** sayılan − beklenen */
  fark: number | null;
}

/** Ara kasa (gün içi sayım): personelin adı okunmaz */
export interface FoyAraKasa {
  no: number | null;
  zaman: string | null;
  ciro: number | null;
  nakit: number | null;
  adisyonSayisi: number | null;
  gider: number | null;
  beklenen: number | null;
  sayilan: number | null;
  fark: number | null;
}

export interface FoyUyari {
  kod: string;
  mesaj: string;
  tutar: number | null;
}

export interface FoyKasa {
  sube: string;
  kasaAdi: string;
  gunNo: number | null;
  /** Z raporu numarası, metin (baştaki sıfırlar korunur) */
  zNo: string | null;
  durum: "ACIK" | "KAPALI";
  otomatikKapandi: boolean;
  acilis: { zaman: string | null; nakit: number | null };
  /** Gün açıksa zaman ve nakit null */
  kapanis: { zaman: string | null; nakit: number | null };
  satis: { ciro: number; ciroDisi: number; adisyonSayisi: number; kisiSayisi: number | null; bahsis: number };
  odemeler: FoyOdeme[];
  defterGirildi: boolean;
  giderler: { toplam: number; kalemler: FoyGider[] };
  cariTahsilatlar: { toplam: number; nakit: number; kalemler: FoyTahsilat[] };
  nakitKasa: FoyNakitKasa | null;
  araKasalar: FoyAraKasa[];
  notlar: { kapanis: string | null; fark: string | null };
  uyarilar: FoyUyari[];
}

export interface FoysuzGun {
  sube: string;
  ciro: number;
  adisyonSayisi: number | null;
  odemeler: { yontem: string; kod: string; tutar: number }[];
}

export interface FoyOzet {
  kasaSayisi: number | null;
  acikKasa: number | null;
  kapaliKasa: number | null;
  otomatikKapanan: number | null;
  ciro: number | null;
  ciroDisi: number | null;
  adisyonSayisi: number | null;
  kisiSayisi: number | null;
  bahsis: number | null;
  gider: number | null;
  cariTahsilat: number | null;
  kasaFarki: number | null;
  odemeler: { yontem: string; kod: string; tutar: number }[];
  foysuzGunSayisi: number | null;
  foysuzCiro: number | null;
}

export interface FoyKota {
  gunlukHak: number | null;
  kullanilan: number | null;
  kalan: number | null;
  yenilenme: string | null;
}

/** Bir kasa gününün föyü (panelin saklayıp okuduğu biçim; kişisel ad yok) */
export interface KasaFoyu {
  kasaGunu: string;
  olusturulma: string | null;
  kasalar: FoyKasa[];
  foysuzGunler: FoysuzGun[];
  ozet: FoyOzet | null;
  kota: FoyKota | null;
}

/** Servisin hata yanıtı (`<hata>`) */
export interface FoyHata {
  kod: string;
  mesaj: string;
  /** KOTA_DOLDU'da hakkın yenileneceği an */
  yenilenme: string | null;
  gunlukHak: number | null;
}

export type FoyParse = { ok: true; foy: KasaFoyu } | { ok: false; hata: FoyHata } | { ok: false; bozuk: string };

/** Yanıt en çok 2 MB okunur (bir günün föyü birkaç KB) */
export const FOY_MAX_BYTES = 2 * 1024 * 1024;

const MAX_TL = 100_000_000;
const round2 = (v: number) => Math.round(v * 100) / 100;
const AMOUNT = /^-?\d{1,12}(\.\d{1,6})?$/;
const INT = /^\d{1,9}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Ofsetli zaman: "2026-11-01T09:42:10+03:00" (ofsetsiz zaman güne yanlış düşer, reddedilir) */
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

/** Tekrar eden öğelerin yolları: "gider" giderler'in içinde dizi, nakitKasa ve araKasa'nın içinde tek tutardır */
const ARRAYS = new Set([
  "kasaFoyu.kasa",
  "kasaFoyu.kasa.odeme",
  "kasaFoyu.kasa.odeme.kirilim",
  "kasaFoyu.kasa.giderler.gider",
  "kasaFoyu.kasa.cariTahsilatlar.tahsilat",
  "kasaFoyu.kasa.araKasa",
  "kasaFoyu.kasa.uyari",
  "kasaFoyu.foysuzGun",
  "kasaFoyu.foysuzGun.odeme",
  "kasaFoyu.ozet.odeme",
]);

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // Yalnız XML'in beş yerleşik varlığı (&amp; …); DOCTYPE zaten reddedilir
  processEntities: true,
  htmlEntities: false,
  jPath: true,
  isArray: (_name, jpath) => typeof jpath === "string" && ARRAYS.has(jpath),
});

type Node = Record<string, unknown>;

class Bozuk extends Error {}

/** Takvimde olan gün (2026-02-30 değil) */
export function isFoyDay(v: string): boolean {
  if (!DAY.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return y >= 2020 && t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function node(v: unknown, path: string, required = false): Node | null {
  if (v === undefined || v === "" || v === null) {
    if (required) throw new Bozuk(path);
    return null;
  }
  if (typeof v !== "object" || Array.isArray(v)) throw new Bozuk(path);
  return v as Node;
}

function list(v: unknown, path: string): Node[] {
  if (v === undefined || v === null || v === "") return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.flatMap((x, i) => {
    const n = node(x, `${path}.${i}`);
    return n ? [n] : [];
  });
}

/** Metin öğe: boşsa null; en çok `max` karakter, boşluklar teke */
function text(v: unknown, path: string, max = 200): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") throw new Bozuk(path);
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

function reqText(v: unknown, path: string, max = 200): string {
  const t = text(v, path, max);
  if (t === null) throw new Bozuk(path);
  return t;
}

function amount(v: unknown, path: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !AMOUNT.test(v.trim())) throw new Bozuk(path);
  const n = Number(v.trim());
  if (!Number.isFinite(n) || Math.abs(n) > MAX_TL) throw new Bozuk(path);
  return round2(n) === 0 ? 0 : round2(n);
}

/** Eksi olmayan tutar (satış, ciro, gider): boşsa 0 */
function money0(v: unknown, path: string): number {
  const n = amount(v, path);
  if (n !== null && n < 0) throw new Bozuk(path);
  return n ?? 0;
}

/** Eksi olabilen tutar (fark): boşsa 0 değil null */
const signed = amount;

function int(v: unknown, path: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !INT.test(v.trim())) throw new Bozuk(path);
  return Number(v.trim());
}

function bool(v: unknown, path: string): boolean {
  if (v === undefined || v === null || v === "") return false;
  if (v === "true") return true;
  if (v === "false") return false;
  throw new Bozuk(path);
}

function time(v: unknown, path: string): string | null {
  const t = text(v, path, 40);
  if (t === null) return null;
  if (!TIME.test(t) || Number.isNaN(Date.parse(t))) throw new Bozuk(path);
  return t;
}

function odeme(n: Node, path: string): FoyOdeme {
  return {
    yontem: text(n.yontem, `${path}.yontem`, 60) ?? reqText(n.kod, `${path}.kod`, 40),
    kod: reqText(n.kod, `${path}.kod`, 40).toUpperCase(),
    ciroyaDahil: bool(n.ciroyaDahil, `${path}.ciroyaDahil`),
    satis: signed(n.satis, `${path}.satis`) ?? 0,
    cariTahsilat: signed(n.cariTahsilat, `${path}.cariTahsilat`) ?? 0,
    sistem: signed(n.sistem, `${path}.sistem`) ?? 0,
    defter: signed(n.defter, `${path}.defter`),
    fark: signed(n.fark, `${path}.fark`),
    kirilim: list(n.kirilim, `${path}.kirilim`).map((k, i) => ({
      ad: text(k.ad, `${path}.kirilim.${i}.ad`, 80) ?? "Adsız",
      tutar: signed(k.tutar, `${path}.kirilim.${i}.tutar`) ?? 0,
    })),
  };
}

function kasa(n: Node, path: string): FoyKasa {
  const durum = reqText(n.durum, `${path}.durum`, 10).toUpperCase();
  if (durum !== "ACIK" && durum !== "KAPALI") throw new Bozuk(`${path}.durum`);
  const acilis = node(n.acilis, `${path}.acilis`);
  const kapanis = node(n.kapanis, `${path}.kapanis`);
  const satis = node(n.satis, `${path}.satis`, true)!;
  const giderler = node(n.giderler, `${path}.giderler`);
  const cari = node(n.cariTahsilatlar, `${path}.cariTahsilatlar`);
  const nk = node(n.nakitKasa, `${path}.nakitKasa`);
  const notlar = node(n.notlar, `${path}.notlar`);
  const giderList = giderler ? list(giderler.gider, `${path}.giderler.gider`) : [];
  const tahsilatList = cari ? list(cari.tahsilat, `${path}.cariTahsilatlar.tahsilat`) : [];
  return {
    sube: text(n.sube, `${path}.sube`, 120) ?? "",
    kasaAdi: text(n.kasaAdi, `${path}.kasaAdi`, 120) ?? "",
    gunNo: int(n.gunNo, `${path}.gunNo`),
    zNo: text(n.zNo, `${path}.zNo`, 40),
    durum,
    otomatikKapandi: bool(n.otomatikKapandi, `${path}.otomatikKapandi`),
    acilis: { zaman: time(acilis?.zaman, `${path}.acilis.zaman`), nakit: signed(acilis?.nakit, `${path}.acilis.nakit`) },
    kapanis: { zaman: time(kapanis?.zaman, `${path}.kapanis.zaman`), nakit: signed(kapanis?.nakit, `${path}.kapanis.nakit`) },
    satis: {
      ciro: signed(satis.ciro, `${path}.satis.ciro`) ?? 0,
      ciroDisi: money0(satis.ciroDisi, `${path}.satis.ciroDisi`),
      adisyonSayisi: int(satis.adisyonSayisi, `${path}.satis.adisyonSayisi`) ?? 0,
      kisiSayisi: int(satis.kisiSayisi, `${path}.satis.kisiSayisi`),
      bahsis: money0(satis.bahsis, `${path}.satis.bahsis`),
    },
    odemeler: list(n.odeme, `${path}.odeme`).map((o, i) => odeme(o, `${path}.odeme.${i}`)),
    defterGirildi: bool(n.defterGirildi, `${path}.defterGirildi`),
    giderler: {
      toplam: giderler ? (signed(giderler.toplam, `${path}.giderler.toplam`) ?? 0) : 0,
      kalemler: giderList.map((g, i) => ({
        kategori: text(g.kategori, `${path}.giderler.gider.${i}.kategori`, 80),
        aciklama: text(g.aciklama, `${path}.giderler.gider.${i}.aciklama`, 200),
        tutar: signed(g.tutar, `${path}.giderler.gider.${i}.tutar`) ?? 0,
      })),
    },
    cariTahsilatlar: {
      toplam: cari ? (signed(cari.toplam, `${path}.cariTahsilatlar.toplam`) ?? 0) : 0,
      nakit: cari ? (signed(cari.nakit, `${path}.cariTahsilatlar.nakit`) ?? 0) : 0,
      // Müşterinin adı (musteri) bilerek okunmaz
      kalemler: tahsilatList.map((t, i) => ({
        tutar: signed(t.tutar, `${path}.cariTahsilatlar.tahsilat.${i}.tutar`) ?? 0,
        yontem: text(t.yontem, `${path}.cariTahsilatlar.tahsilat.${i}.yontem`, 60),
        zaman: time(t.zaman, `${path}.cariTahsilatlar.tahsilat.${i}.zaman`),
      })),
    },
    nakitKasa: nk
      ? {
          dayanak: text(nk.dayanak, `${path}.nakitKasa.dayanak`, 40)?.toUpperCase() ?? null,
          acilis: signed(nk.acilis, `${path}.nakitKasa.acilis`),
          nakitSatis: signed(nk.nakitSatis, `${path}.nakitKasa.nakitSatis`),
          nakitCariTahsilat: signed(nk.nakitCariTahsilat, `${path}.nakitKasa.nakitCariTahsilat`),
          gider: signed(nk.gider, `${path}.nakitKasa.gider`),
          beklenen: signed(nk.beklenen, `${path}.nakitKasa.beklenen`),
          sayilan: signed(nk.sayilan, `${path}.nakitKasa.sayilan`),
          fark: signed(nk.fark, `${path}.nakitKasa.fark`),
        }
      : null,
    // Personelin adı (personel) bilerek okunmaz
    araKasalar: list(n.araKasa, `${path}.araKasa`).map((a, i) => ({
      no: int(a.no, `${path}.araKasa.${i}.no`),
      zaman: time(a.zaman, `${path}.araKasa.${i}.zaman`),
      ciro: signed(a.ciro, `${path}.araKasa.${i}.ciro`),
      nakit: signed(a.nakit, `${path}.araKasa.${i}.nakit`),
      adisyonSayisi: int(a.adisyonSayisi, `${path}.araKasa.${i}.adisyonSayisi`),
      gider: signed(a.gider, `${path}.araKasa.${i}.gider`),
      beklenen: signed(a.beklenen, `${path}.araKasa.${i}.beklenen`),
      sayilan: signed(a.sayilan, `${path}.araKasa.${i}.sayilan`),
      fark: signed(a.fark, `${path}.araKasa.${i}.fark`),
    })),
    notlar: { kapanis: text(notlar?.kapanis, `${path}.notlar.kapanis`, 500), fark: text(notlar?.fark, `${path}.notlar.fark`, 500) },
    uyarilar: list(n.uyari, `${path}.uyari`).map((u, i) => ({
      kod: reqText(u.kod, `${path}.uyari.${i}.kod`, 60).toUpperCase(),
      mesaj: text(u.mesaj, `${path}.uyari.${i}.mesaj`, 200) ?? "",
      tutar: signed(u.tutar, `${path}.uyari.${i}.tutar`),
    })),
  };
}

function yontemTutar(n: Node, path: string): { yontem: string; kod: string; tutar: number } {
  const kod = reqText(n.kod, `${path}.kod`, 40).toUpperCase();
  return { yontem: text(n.yontem, `${path}.yontem`, 60) ?? kod, kod, tutar: signed(n.tutar ?? n.satis, `${path}.tutar`) ?? 0 };
}

function ozet(n: Node): FoyOzet {
  return {
    kasaSayisi: int(n.kasaSayisi, "ozet.kasaSayisi"),
    acikKasa: int(n.acikKasa, "ozet.acikKasa"),
    kapaliKasa: int(n.kapaliKasa, "ozet.kapaliKasa"),
    otomatikKapanan: int(n.otomatikKapanan, "ozet.otomatikKapanan"),
    ciro: signed(n.ciro, "ozet.ciro"),
    ciroDisi: signed(n.ciroDisi, "ozet.ciroDisi"),
    adisyonSayisi: int(n.adisyonSayisi, "ozet.adisyonSayisi"),
    kisiSayisi: int(n.kisiSayisi, "ozet.kisiSayisi"),
    bahsis: signed(n.bahsis, "ozet.bahsis"),
    gider: signed(n.gider, "ozet.gider"),
    cariTahsilat: signed(n.cariTahsilat, "ozet.cariTahsilat"),
    kasaFarki: signed(n.kasaFarki, "ozet.kasaFarki"),
    odemeler: list(n.odeme, "ozet.odeme").map((o, i) => yontemTutar(o, `ozet.odeme.${i}`)),
    foysuzGunSayisi: int(n.foysuzGunSayisi, "ozet.foysuzGunSayisi"),
    foysuzCiro: signed(n.foysuzCiro, "ozet.foysuzCiro"),
  };
}

function kota(n: Node | null, path: string): FoyKota | null {
  if (!n) return null;
  return {
    gunlukHak: int(n.gunlukHak, `${path}.gunlukHak`),
    kullanilan: int(n.kullanilan, `${path}.kullanilan`),
    kalan: int(n.kalan, `${path}.kalan`),
    yenilenme: time(n.yenilenme, `${path}.yenilenme`),
  };
}

/**
 * Yanıtın gövdesi → föy, servisin hatası ya da bozuk gövde (`bozuk`: ilk sorunlu alanın yolu, "kasa.0.odeme.1.satis";
 * gövde XML değilse "govde"). `istenen` verilirse föyün günü onunla aynı olmalı (başka günün föyü saklanmaz).
 */
export function parseKasaFoyu(body: string, istenen?: string): FoyParse {
  if (body.length > FOY_MAX_BYTES) return { ok: false, bozuk: "govde" };
  if (/<!DOCTYPE|<!ENTITY/i.test(body)) return { ok: false, bozuk: "govde" };
  let doc: Node;
  try {
    doc = parser.parse(body) as Node;
  } catch {
    return { ok: false, bozuk: "govde" };
  }
  try {
    if (doc.hata !== undefined) {
      const h = node(doc.hata, "hata", true)!;
      const ay = node(h.ayrinti, "hata.ayrinti");
      return {
        ok: false,
        hata: {
          kod: (text(h.kod, "hata.kod", 60) ?? "BILINMIYOR").toUpperCase(),
          mesaj: text(h.mesaj, "hata.mesaj", 300) ?? "",
          yenilenme: ay ? time(ay.yenilenme, "hata.ayrinti.yenilenme") : null,
          gunlukHak: ay ? int(ay.gunlukHak, "hata.ayrinti.gunlukHak") : null,
        },
      };
    }
    const root = node(doc.kasaFoyu, "kasaFoyu", true)!;
    const kasaGunu = reqText(root.kasaGunu, "kasaGunu", 10);
    if (!isFoyDay(kasaGunu) || (istenen !== undefined && kasaGunu !== istenen)) throw new Bozuk("kasaGunu");
    const kasalar = list(root.kasa, "kasa").map((k, i) => kasa(k, `kasa.${i}`));
    const foysuz = list(root.foysuzGun, "foysuzGun").map((f, i) => ({
      sube: text(f.sube, `foysuzGun.${i}.sube`, 120) ?? "",
      ciro: signed(f.ciro, `foysuzGun.${i}.ciro`) ?? 0,
      adisyonSayisi: int(f.adisyonSayisi, `foysuzGun.${i}.adisyonSayisi`),
      odemeler: list(f.odeme, `foysuzGun.${i}.odeme`).map((o, j) => yontemTutar(o, `foysuzGun.${i}.odeme.${j}`)),
    }));
    const oz = node(root.ozet, "ozet");
    return {
      ok: true,
      foy: {
        kasaGunu,
        olusturulma: time(root.olusturulma, "olusturulma"),
        kasalar,
        foysuzGunler: foysuz,
        ozet: oz ? ozet(oz) : null,
        kota: kota(node(root.kota, "kota"), "kota"),
      },
    };
  } catch (e) {
    if (e instanceof Bozuk) return { ok: false, bozuk: e.message };
    throw e;
  }
}
